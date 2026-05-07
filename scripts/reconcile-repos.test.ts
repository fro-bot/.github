import type {CommitMetadataParams, CommitMetadataResult} from './commit-metadata.ts'
import type {AllowlistFile, DiscoveryChannel, RepoEntry, ReposFile} from './schemas.ts'
import {Buffer} from 'node:buffer'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

import {
  containsFroBotAgentReference,
  DISPATCH_DEFAULTS,
  fetchPerRepoStatus,
  formatCommitMessage,
  handleReconcile,
  isEligibleForSurvey,
  loadDispatchStaggerFromEnv,
  loadMaxDispatchesPerRunFromEnv,
  mergeAccessChannels,
  migrateRepoEntry,
  ReconcileError,
  reconcileRepos,
  type AccessListEntry,
  type HandleReconcileParams,
  type OctokitClient,
  type ReconcileInput,
  type RepoStatusProbe,
} from './reconcile-repos.ts'
import {addRepoEntry} from './repos-metadata.ts'
import {assertReposFile} from './schemas.ts'

const NOW = new Date('2026-04-17T12:00:00Z')

function makeAllowlist(usernames: string[] = []): AllowlistFile {
  return {
    version: 1,
    approved_inviters: usernames.map(u => ({username: u, added: '2026-01-01', role: 'owner'})),
  }
}

function makeAccess(overrides: Partial<AccessListEntry> = {}): AccessListEntry {
  return {
    owner: 'fro-bot',
    name: 'test-repo',
    archived: false,
    private: false,
    node_id: 'R_default',
    ...overrides,
  }
}

function reposFileWith(owner: string, name: string): ReposFile {
  return {
    version: 1,
    repos: [makeEntry({owner, name})],
  }
}

function emptyChannelStats() {
  return {
    collab: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
    owned: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
    contrib: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
  }
}

function makeEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    owner: 'fro-bot',
    name: 'test-repo',
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: null,
    last_survey_status: null,
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: 'collab',
    next_survey_eligible_at: null,
    ...overrides,
  }
}

function makeInput(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    currentRepos: {version: 1, repos: []},
    accessList: [],
    perRepoStatus: new Map(),
    allowlist: makeAllowlist(),
    fieldProbes: new Map(),
    now: NOW,
    ...overrides,
  }
}

describe('reconcileRepos', () => {
  describe('newcomers (untracked repos appearing in accessList)', () => {
    it('adds an allowlisted newcomer with pending status and queues a dispatch', () => {
      // GIVEN an accessible repo from an allowlisted owner, not yet tracked
      // WHEN reconciling
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'marcusrbrown', name: 'new-repo', node_id: 'R_new'})],
          allowlist: makeAllowlist(['marcusrbrown']),
        }),
      )

      // THEN it's added as pending with a dispatch queued and no issue
      expect(result.nextRepos.repos).toHaveLength(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: 'marcusrbrown',
        name: 'new-repo',
        onboarding_status: 'pending',
      })
      expect(result.dispatches).toEqual([{owner: 'marcusrbrown', repo: 'new-repo'}])
      expect(result.issues).toEqual([])
      expect(result.summary).toEqual({
        added: 1,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 0,
        migrated: 0,
        transient: 0,
        malformed: 0,
        unchanged: 0,
        // dispatched/deferred populated by the I/O shell, not the engine
        byChannel: {
          collab: {tracked: 1, dispatched: 0, deferred: 0, lostAccess: 0},
          owned: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
          contrib: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
        },
      })
    })

    it('adds a non-allowlisted newcomer as pending-review and files a per-repo issue', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'stranger', name: 'sus-repo', node_id: 'R_sus', private: false})],
          allowlist: makeAllowlist([]),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: 'stranger',
        name: 'sus-repo',
        onboarding_status: 'pending-review',
      })
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([
        {
          kind: 'per-repo',
          owner: 'stranger',
          repo: 'sus-repo',
          reason: 'unsolicited-new',
          private: false,
          node_id: 'R_sus',
        },
      ])
      expect(result.summary.added).toBe(0)
      expect(result.summary.pendingReview).toBe(1)
    })

    it('rolls up ≥2 non-allowlisted newcomers from the same owner into a single issue', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'stranger', name: 'repo-a', node_id: 'R_a', private: false}),
            makeAccess({owner: 'stranger', name: 'repo-b', node_id: 'R_b', private: true}),
          ],
          allowlist: makeAllowlist([]),
        }),
      )

      expect(result.nextRepos.repos).toHaveLength(2)
      expect(result.nextRepos.repos.every(r => r.onboarding_status === 'pending-review')).toBe(true)
      expect(result.issues).toEqual([
        {
          kind: 'per-owner-rollup',
          owner: 'stranger',
          reason: 'unsolicited-new',
          entries: [
            {repo: 'repo-a', private: false, node_id: 'R_a'},
            {repo: 'repo-b', private: true, node_id: 'R_b'},
          ],
        },
      ])
      expect(result.summary.pendingReview).toBe(2)
    })

    it('processes mixed batch: one allowlisted dispatch, one per-owner rollup, zero per-repo', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'trusted', name: 'ok-repo', node_id: 'R_ok'}),
            makeAccess({owner: 'stranger', name: 'repo-a', node_id: 'R_a'}),
            makeAccess({owner: 'stranger', name: 'repo-b', node_id: 'R_b'}),
          ],
          allowlist: makeAllowlist(['trusted']),
        }),
      )

      expect(result.dispatches).toEqual([{owner: 'trusted', repo: 'ok-repo'}])
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]?.kind).toBe('per-owner-rollup')
      expect(result.issues.filter(i => i.kind === 'per-repo')).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(2)
    })
  })

  describe('tracked entries — still accessible', () => {
    it('leaves a pending-review, still-accessible entry unchanged when no field drift', () => {
      const entry = makeEntry({
        onboarding_status: 'pending-review',
        name: 'stable-repo',
        private: false,
        node_id: 'R_default',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'stable-repo'})],
          fieldProbes: new Map([['fro-bot/stable-repo', {has_fro_bot_workflow: false, has_renovate: false}]]),
        }),
      )

      expect(result.nextRepos.repos).toEqual([entry])
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([])
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.refreshed).toBe(0)
    })

    it('flips fields on tracked onboarded entry when probe differs, status unchanged', () => {
      const entry = makeEntry({
        name: 'drifted-repo',
        onboarding_status: 'onboarded',
        has_fro_bot_workflow: true,
        has_renovate: false,
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'drifted-repo'})],
          fieldProbes: new Map([['fro-bot/drifted-repo', {has_fro_bot_workflow: true, has_renovate: true}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'drifted-repo',
        onboarding_status: 'onboarded',
        has_fro_bot_workflow: true,
        has_renovate: true,
      })
      expect(result.summary.refreshed).toBe(1)
      expect(result.summary.unchanged).toBe(0)
    })

    it('preserves pending-review status on still-accessible entry but refreshes fields on drift', () => {
      const entry = makeEntry({
        name: 'sus-repo',
        onboarding_status: 'pending-review',
        has_renovate: false,
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'sus-repo'})],
          fieldProbes: new Map([['fro-bot/sus-repo', {has_fro_bot_workflow: false, has_renovate: true}]]),
        }),
      )

      expect(result.nextRepos.repos[0]?.onboarding_status).toBe('pending-review')
      expect(result.nextRepos.repos[0]?.has_renovate).toBe(true)
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([])
      expect(result.summary.refreshed).toBe(1)
    })
  })

  describe('tracked entries — lost access', () => {
    it('flips tracked repo absent from access list with probe=deleted to lost-access, preserving other fields', () => {
      const entry = makeEntry({
        name: 'gone-repo',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-01-15',
        last_survey_status: 'success',
        has_fro_bot_workflow: true,
        has_renovate: true,
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/gone-repo', {status: 'deleted'}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual({
        ...entry,
        onboarding_status: 'lost-access',
        private: true,
      })
      expect(result.summary.lostAccess).toBe(1)
    })

    it('flips tracked repo absent from access list with probe=revoked to lost-access', () => {
      const entry = makeEntry({name: 'revoked-repo', onboarding_status: 'onboarded'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/revoked-repo', {status: 'revoked'}]]),
        }),
      )

      expect(result.nextRepos.repos[0]?.onboarding_status).toBe('lost-access')
      expect(result.summary.lostAccess).toBe(1)
    })

    it('flips tracked repo present in access list with archived:true to lost-access from Pass 1 data', () => {
      const entry = makeEntry({name: 'archived-repo', onboarding_status: 'onboarded'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'archived-repo', archived: true})],
        }),
      )

      expect(result.nextRepos.repos[0]?.onboarding_status).toBe('lost-access')
      expect(result.summary.lostAccess).toBe(1)
    })

    it('treats tracked repo absent from access list with probe=still-accessible as transient — no change', () => {
      const entry = makeEntry({name: 'flaky-repo', onboarding_status: 'onboarded'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([
            ['fro-bot/flaky-repo', {status: 'still-accessible', private: false, node_id: 'R_flaky'}],
          ]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual(entry)
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.lostAccess).toBe(0)
    })

    it('treats tracked repo absent from access list with probe=transient — no change', () => {
      const entry = makeEntry({name: 'flaky-repo', onboarding_status: 'onboarded'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/flaky-repo', {status: 'transient', httpStatus: 502}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual(entry)
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.lostAccess).toBe(0)
    })

    it('treats tracked repo absent from access list with probe=malformed — no change', () => {
      const entry = makeEntry({name: 'broken-repo', onboarding_status: 'onboarded'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/broken-repo', {status: 'malformed'}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual(entry)
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.lostAccess).toBe(0)
    })
  })

  describe('tracked entries — regained access', () => {
    it('flips lost-access back to pending for allowlisted owner, queues dispatch, preserves history', () => {
      // GIVEN a lost-access entry with full survey history
      const entry = makeEntry({
        name: 'returned-repo',
        onboarding_status: 'lost-access',
        last_survey_at: '2026-01-10',
        last_survey_status: 'success',
        has_fro_bot_workflow: true,
        has_renovate: false,
      })
      // WHEN it shows up in the access list again with an allowlisted owner
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'returned-repo'})],
          allowlist: makeAllowlist(['fro-bot']),
        }),
      )

      // THEN status flips to pending, dispatch is queued, history preserved
      expect(result.nextRepos.repos[0]).toEqual({
        ...entry,
        onboarding_status: 'pending',
        private: false,
        node_id: 'R_default',
      })
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'returned-repo'}])
      expect(result.issues).toEqual([])
      expect(result.summary.regained).toBe(1)
    })

    it('flips lost-access back to pending-review for non-allowlisted owner, files per-repo issue', () => {
      const entry = makeEntry({
        owner: 'stranger',
        name: 'returned-sus',
        onboarding_status: 'lost-access',
        last_survey_at: '2025-12-01',
        last_survey_status: 'failure',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({owner: 'stranger', name: 'returned-sus', node_id: 'R_sus', private: false})],
          allowlist: makeAllowlist([]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual({
        ...entry,
        onboarding_status: 'pending-review',
        private: false,
        node_id: 'R_sus',
      })
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([
        {
          kind: 'per-repo',
          owner: 'stranger',
          repo: 'returned-sus',
          reason: 'unsolicited-regain',
          private: false,
          node_id: 'R_sus',
        },
      ])
      expect(result.summary.regained).toBe(1)
    })
  })

  describe('private/node_id merge from access list and probes', () => {
    it('writes private:false and node_id from access list for a public still-accessible repo (no prior fields)', () => {
      const entry = makeEntry({name: 'pub-repo'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'pub-repo', private: false, node_id: 'R_pub'})],
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'pub-repo',
        private: false,
        node_id: 'R_pub',
      })
      expect(result.summary.refreshed).toBe(1)
      expect(result.summary.unchanged).toBe(0)
    })

    it('writes private:true and node_id from access list for a private still-accessible repo (no prior fields)', () => {
      const entry = makeEntry({name: 'priv-repo'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'priv-repo', private: true, node_id: 'R_priv'})],
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'priv-repo',
        private: true,
        node_id: 'R_priv',
      })
      expect(result.summary.refreshed).toBe(1)
      expect(result.summary.unchanged).toBe(0)
    })

    it('treats matching private/node_id as idempotent — no refresh bump', () => {
      const entry = makeEntry({name: 'stable', private: true, node_id: 'R_priv'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'stable', private: true, node_id: 'R_priv'})],
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual(entry)
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.refreshed).toBe(0)
    })

    it('bumps refreshed on public→private transition (same node_id)', () => {
      const entry = makeEntry({name: 'flip-repo', private: false, node_id: 'R_x'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'flip-repo', private: true, node_id: 'R_x'})],
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'flip-repo',
        private: true,
        node_id: 'R_x',
      })
      expect(result.summary.refreshed).toBe(1)
      // No transition signal here; that's covered by a later unit.
    })

    it('applies fail-safe private:true on probe-decided lost-access (deleted, had prior private:false)', () => {
      const entry = makeEntry({name: 'deleted-repo', private: false, node_id: 'R_del'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/deleted-repo', {status: 'deleted'}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'deleted-repo',
        onboarding_status: 'lost-access',
        private: true,
        node_id: 'R_del',
      })
      expect(result.summary.lostAccess).toBe(1)
    })

    it('applies fail-safe private:true on probe-decided lost-access (revoked, no prior private field)', () => {
      const entry = makeEntry({name: 'revoked-repo'}) // no private, no node_id
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/revoked-repo', {status: 'revoked'}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'revoked-repo',
        onboarding_status: 'lost-access',
        private: true,
      })
      // No prior node_id, so the entry should not have node_id introduced
      expect(result.nextRepos.repos[0]).not.toHaveProperty('node_id')
      expect(result.summary.lostAccess).toBe(1)
    })

    it('applies fail-safe private:true on archived access-lost (overrides access.private:false)', () => {
      const entry = makeEntry({name: 'archived-repo', onboarding_status: 'onboarded'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'archived-repo', archived: true, private: false, node_id: 'R_arch'})],
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'archived-repo',
        onboarding_status: 'lost-access',
        private: true, // fail-safe overrides access.private:false
        node_id: 'R_arch',
      })
      expect(result.summary.lostAccess).toBe(1)
    })

    it('preserves sticky private on transient probe (entry had prior private:true)', () => {
      const entry = makeEntry({name: 'flaky-repo', private: true, node_id: 'R_flaky'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/flaky-repo', {status: 'transient', httpStatus: 502}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual(entry)
      expect(result.nextRepos.repos[0]?.private).toBe(true)
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.lostAccess).toBe(0)
    })

    it('preserves sticky absent-private on malformed probe (no prior private field)', () => {
      const entry = makeEntry({name: 'broken-repo'}) // no private, no node_id
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          perRepoStatus: new Map([['fro-bot/broken-repo', {status: 'malformed'}]]),
        }),
      )

      expect(result.nextRepos.repos[0]).toEqual(entry)
      expect(result.nextRepos.repos[0]).not.toHaveProperty('private')
      expect(result.summary.unchanged).toBe(1)
    })

    it('regain writes live private/node_id from access list (overrides sticky)', () => {
      const entry = makeEntry({
        name: 'returned-repo',
        onboarding_status: 'lost-access',
        private: true,
        node_id: 'R_old',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'returned-repo', private: false, node_id: 'R_new'})],
          allowlist: makeAllowlist(['fro-bot']),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'returned-repo',
        onboarding_status: 'pending',
        private: false,
        node_id: 'R_new',
      })
      expect(result.summary.regained).toBe(1)
    })

    it('integration: mixed states produce correct per-entry private/node_id', () => {
      // Three entries:
      // 1. still-accessible — entry has private:false, access has private:true (changed)
      // 2. access-lost via probe (deleted) — entry has private:false, expect fail-safe true
      // 3. regain — entry was lost-access with private:true, access shows private:false
      const stillAccessible = makeEntry({
        name: 'still-ok',
        private: false,
        node_id: 'R_ok',
      })
      const gone = makeEntry({
        name: 'gone-repo',
        private: false,
        node_id: 'R_gone',
      })
      const returning = makeEntry({
        name: 'returning-repo',
        onboarding_status: 'lost-access',
        private: true,
        node_id: 'R_stale',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [stillAccessible, gone, returning]},
          accessList: [
            makeAccess({name: 'still-ok', private: true, node_id: 'R_ok'}), // privacy flipped
            makeAccess({name: 'returning-repo', private: false, node_id: 'R_fresh'}),
          ],
          perRepoStatus: new Map([['fro-bot/gone-repo', {status: 'deleted'}]]),
          allowlist: makeAllowlist(['fro-bot']),
        }),
      )

      expect(result.nextRepos.repos).toHaveLength(3)
      const byName = new Map(result.nextRepos.repos.map(r => [r.name, r]))

      // still-accessible: writes live access data (private:true)
      expect(byName.get('still-ok')).toMatchObject({
        onboarding_status: 'onboarded',
        private: true,
        node_id: 'R_ok',
      })

      // access-lost: fail-safe private:true, preserves prior node_id
      expect(byName.get('gone-repo')).toMatchObject({
        onboarding_status: 'lost-access',
        private: true,
        node_id: 'R_gone',
      })

      // regain: writes live access data (private:false overrides sticky private:true)
      expect(byName.get('returning-repo')).toMatchObject({
        onboarding_status: 'pending',
        private: false,
        node_id: 'R_fresh',
      })
    })

    it('preserves absent private on transient probe with no prior privacy state', () => {
      // Symmetric to the malformed-no-prior test above. Transient must not introduce
      // a private:false default; legacy entries must remain absent until a real probe lands.
      const entry = makeEntry({name: 'transient-legacy'})
      // Confirm the fixture is genuinely without `private`/`node_id`.
      expect(entry).not.toHaveProperty('private')
      expect(entry).not.toHaveProperty('node_id')

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [],
          perRepoStatus: new Map([['fro-bot/transient-legacy', {status: 'transient', httpStatus: 502}]]),
        }),
      )

      const next = result.nextRepos.repos[0]
      expect(next).not.toHaveProperty('private')
      expect(next).not.toHaveProperty('node_id')
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.lostAccess).toBe(0)
    })

    it('integration: all 5 probe states in one run produce correct per-entry shape', () => {
      // Extends the 3-state integration above to exercise transient + malformed alongside
      // still-accessible / deleted / regain in a single reconcile pass. Plan scenario #11
      // explicitly requires "all 5 probe states in one run."
      const stillOk = makeEntry({name: 'still-ok-five', private: false, node_id: 'R_ok'})
      const goneDeleted = makeEntry({name: 'gone-five', private: false, node_id: 'R_gone'})
      const transientPriorPrivate = makeEntry({name: 'flaky-five', private: true, node_id: 'R_flaky'})
      const malformedLegacy = makeEntry({name: 'malformed-five'})
      const returning = makeEntry({
        name: 'returning-five',
        onboarding_status: 'lost-access',
        private: true,
        node_id: 'R_stale',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {
            version: 1,
            repos: [stillOk, goneDeleted, transientPriorPrivate, malformedLegacy, returning],
          },
          accessList: [
            makeAccess({name: 'still-ok-five', private: false, node_id: 'R_ok'}),
            makeAccess({name: 'returning-five', private: false, node_id: 'R_fresh'}),
          ],
          perRepoStatus: new Map([
            ['fro-bot/gone-five', {status: 'deleted'}],
            ['fro-bot/flaky-five', {status: 'transient', httpStatus: 503}],
            ['fro-bot/malformed-five', {status: 'malformed'}],
          ]),
          allowlist: makeAllowlist(['fro-bot']),
        }),
      )

      expect(result.nextRepos.repos).toHaveLength(5)
      const byName = new Map(result.nextRepos.repos.map(r => [r.name, r]))

      // still-accessible: live access data, idempotent (no refresh because nothing changed).
      expect(byName.get('still-ok-five')).toEqual(stillOk)

      // deleted: fail-safe private:true, preserves prior node_id.
      expect(byName.get('gone-five')).toMatchObject({
        onboarding_status: 'lost-access',
        private: true,
        node_id: 'R_gone',
      })

      // transient + prior private:true: sticky-preserved (no flip, no field churn).
      expect(byName.get('flaky-five')).toEqual(transientPriorPrivate)

      // malformed + legacy (no prior private): sticky-preserve absence, no fields introduced.
      expect(byName.get('malformed-five')).not.toHaveProperty('private')
      expect(byName.get('malformed-five')).not.toHaveProperty('node_id')

      // regain: writes live access data over sticky.
      expect(byName.get('returning-five')).toMatchObject({
        onboarding_status: 'pending',
        private: false,
        node_id: 'R_fresh',
      })

      // Summary shape: 1 lost-access (gone), 3 unchanged (still-ok + flaky + malformed),
      // 1 added/refresh delta from regain.
      expect(result.summary.lostAccess).toBe(1)
      expect(result.summary.unchanged).toBeGreaterThanOrEqual(3)
    })

    it('bumps summary.transient and summary.malformed independently when probes degrade', () => {
      // Distinct counters let operators distinguish API-incident days (sustained transient)
      // from upstream contract anomalies (sustained malformed) without cross-referencing
      // warn logs in the Actions UI.
      const flaky = makeEntry({name: 'flaky-counter', private: true, node_id: 'R_flaky'})
      const malformedEntry = makeEntry({name: 'malformed-counter', private: false, node_id: 'R_malf'})

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [flaky, malformedEntry]},
          accessList: [],
          perRepoStatus: new Map([
            ['fro-bot/flaky-counter', {status: 'transient', httpStatus: 502}],
            ['fro-bot/malformed-counter', {status: 'malformed'}],
          ]),
        }),
      )

      expect(result.summary.transient).toBe(1)
      expect(result.summary.malformed).toBe(1)
      expect(result.summary.unchanged).toBe(2)
      expect(result.summary.lostAccess).toBe(0)
    })

    it('throws on unknown probe state — exhaustiveness guard', () => {
      // RepoStatusProbe is a discriminated union with a default branch that asserts the
      // probe variant has been narrowed to `never`. Adding a new variant later without
      // updating the switch must fail loudly rather than silently flipping to lost-access.
      const entry = makeEntry({name: 'novel-state'})
      const bogusProbe = {status: 'cosmic-ray-bit-flip'} as unknown as RepoStatusProbe

      expect(() =>
        reconcileRepos(
          makeInput({
            currentRepos: {version: 1, repos: [entry]},
            accessList: [],
            perRepoStatus: new Map([['fro-bot/novel-state', bogusProbe]]),
          }),
        ),
      ).toThrow(/unhandled RepoStatusProbe variant/)
    })
  })

  describe('mixed and edge cases', () => {
    it('handles multiple simultaneous changes (new + lost + refresh) in one run', () => {
      // Fresh surveys on both — next_survey_eligible_at is in the future (post-NOW), so
      // the cadence gate excludes them. NOW = 2026-04-17; eligibility 2026-05-09 keeps
      // them out of the dispatch list.
      const drift = makeEntry({
        name: 'drift-repo',
        onboarding_status: 'onboarded',
        has_renovate: false,
        last_survey_at: '2026-04-10',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-05-09',
      })
      const gone = makeEntry({
        name: 'gone-repo',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-04-10',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-05-09',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [drift, gone]},
          accessList: [
            makeAccess({name: 'drift-repo'}),
            makeAccess({owner: 'trusted', name: 'fresh-repo', node_id: 'R_fresh'}),
          ],
          perRepoStatus: new Map([['fro-bot/gone-repo', {status: 'deleted'}]]),
          fieldProbes: new Map([['fro-bot/drift-repo', {has_fro_bot_workflow: false, has_renovate: true}]]),
          allowlist: makeAllowlist(['trusted']),
        }),
      )

      expect(result.nextRepos.repos).toHaveLength(3)
      const byName = new Map(result.nextRepos.repos.map(r => [r.name, r]))
      expect(byName.get('drift-repo')?.has_renovate).toBe(true)
      expect(byName.get('drift-repo')?.onboarding_status).toBe('onboarded')
      expect(byName.get('gone-repo')?.onboarding_status).toBe('lost-access')
      expect(byName.get('fresh-repo')?.onboarding_status).toBe('pending')
      expect(result.dispatches).toEqual([{owner: 'trusted', repo: 'fresh-repo'}])
      expect(result.issues).toEqual([])
      expect(result.summary).toEqual({
        added: 1,
        pendingReview: 0,
        regained: 0,
        lostAccess: 1,
        refreshed: 1,
        migrated: 0,
        transient: 0,
        malformed: 0,
        unchanged: 0,
        // dispatched/deferred populated by the I/O shell, not the engine
        byChannel: {
          collab: {tracked: 3, dispatched: 0, deferred: 0, lostAccess: 1},
          owned: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
          contrib: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
        },
      })
    })

    it('reports all-zero counters and value-equal nextRepos when nothing changes', () => {
      // Use pending-review: it's excluded from the dispatch gate, so this entry
      // truly produces zero side-effects. Add matching private/node_id so the
      // privacy field check is also a no-op.
      const entry = makeEntry({
        name: 'stable-repo',
        onboarding_status: 'pending-review',
        private: false,
        node_id: 'R_default',
      })
      const current: ReposFile = {version: 1, repos: [entry]}
      const result = reconcileRepos(
        makeInput({
          currentRepos: current,
          accessList: [makeAccess({name: 'stable-repo'})],
        }),
      )

      expect(result.nextRepos).toEqual(current)
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([])
      expect(result.summary).toEqual({
        added: 0,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 0,
        migrated: 0,
        transient: 0,
        malformed: 0,
        unchanged: 1,
        byChannel: {
          collab: {tracked: 1, dispatched: 0, deferred: 0, lostAccess: 0},
          owned: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
          contrib: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
        },
      })
    })

    it('handles empty currentRepos and empty accessList as a no-op', () => {
      const result = reconcileRepos(makeInput({}))

      expect(result.nextRepos).toEqual({version: 1, repos: []})
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([])
      expect(result.summary).toEqual({
        added: 0,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 0,
        migrated: 0,
        transient: 0,
        malformed: 0,
        unchanged: 0,
        byChannel: emptyChannelStats(),
      })
    })

    it('merges safely on concurrent-writer retry: entry added between calls is preserved', () => {
      // GIVEN an initial currentRepos@v1 reconciled once
      // Add matching private/node_id so the privacy field check is also a no-op.
      const entryA = makeEntry({name: 'a-repo', onboarding_status: 'pending', private: false, node_id: 'R_default'})
      const v1: ReposFile = {version: 1, repos: [entryA]}
      const accessList = [makeAccess({name: 'a-repo'})]
      reconcileRepos(makeInput({currentRepos: v1, accessList}))

      // WHEN a concurrent writer appends entryC before reconcile retries with currentRepos@v2
      const entryC = makeEntry({name: 'c-repo', onboarding_status: 'pending'})
      const v2: ReposFile = {version: 1, repos: [entryA, entryC]}
      const result2 = reconcileRepos(makeInput({currentRepos: v2, accessList}))

      // THEN entryC survives — no incorrect lost-access flip, counted as unchanged
      expect(result2.nextRepos.repos).toEqual([entryA, entryC])
      expect(result2.summary.lostAccess).toBe(0)
      expect(result2.summary.unchanged).toBe(2)
    })

    it('produces newcomer entries structurally identical to addRepoEntry output (parity)', () => {
      const access = makeAccess({owner: 'trusted', name: 'parity-repo', node_id: 'R_parity'})
      const allowlist = makeAllowlist(['trusted'])
      const result = reconcileRepos(makeInput({accessList: [access], allowlist}))

      const direct = addRepoEntry(
        {version: 1, repos: []},
        {owner: 'trusted', repo: 'parity-repo', now: NOW, onboarding_status: 'pending'},
      )

      // Schema-validated on both sides, then structural equality
      assertReposFile(result.nextRepos)
      assertReposFile(direct)
      expect(result.nextRepos.repos[0]).toEqual(direct.repos[0])
    })

    it('does not mutate currentRepos input when producing nextRepos', () => {
      // GIVEN an input with one entry
      const entry = makeEntry({name: 'gone-repo', onboarding_status: 'onboarded'})
      const currentRepos: ReposFile = {version: 1, repos: [entry]}
      const frozenSnapshot = JSON.stringify(currentRepos)

      // WHEN reconcile flips the entry to lost-access
      reconcileRepos(
        makeInput({
          currentRepos,
          perRepoStatus: new Map([['fro-bot/gone-repo', {status: 'deleted'}]]),
        }),
      )

      // THEN the original currentRepos object is unchanged
      expect(JSON.stringify(currentRepos)).toBe(frozenSnapshot)
      expect(entry.onboarding_status).toBe('onboarded')
    })

    it('throws when accessList contains duplicate owner/name pairs', () => {
      expect(() =>
        reconcileRepos(
          makeInput({
            accessList: [
              makeAccess({owner: 'dupe', name: 'same-repo', node_id: 'R_1'}),
              makeAccess({owner: 'dupe', name: 'same-repo', node_id: 'R_2'}),
            ],
          }),
        ),
      ).toThrow(/duplicate/i)
    })

    it('dispatches pending entry with null last_survey_at (never surveyed)', () => {
      // #given a pending entry that has never been surveyed (null survey fields)
      const entry = makeEntry({
        name: 'never-surveyed',
        onboarding_status: 'pending',
        last_survey_at: null,
        last_survey_status: null,
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'never-surveyed'})],
        }),
      )
      // #then the entry is dispatched for its initial survey
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'never-surveyed'}])
    })

    it('dispatches pending entry with failure status (failed initial survey)', () => {
      // #given a pending entry whose initial survey failed and wrote back a failure timestamp
      const entry = makeEntry({
        name: 'failed-initial',
        onboarding_status: 'pending',
        last_survey_at: '2026-04-19',
        last_survey_status: 'failure',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'failed-initial'})],
        }),
      )
      // #then the entry is dispatched for retry (failure ≠ success, so eligible)
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'failed-initial'}])
    })

    it('does not dispatch pending-review entry (requires human approval)', () => {
      // #given a pending-review entry with null survey fields
      const entry = makeEntry({
        name: 'needs-approval',
        onboarding_status: 'pending-review',
        last_survey_at: null,
        last_survey_status: null,
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'needs-approval'})],
        }),
      )
      // #then no dispatch — pending-review entries need human promotion first
      expect(result.dispatches).toEqual([])
    })

    it('does not dispatch pending entry with recent successful survey', () => {
      // #given a pending entry that was surveyed successfully recently (promotion
      // should have moved it to onboarded, but even if it didn't, the success +
      // not-yet-eligible combination means no re-dispatch is needed)
      const entry = makeEntry({
        name: 'recently-succeeded',
        onboarding_status: 'pending',
        last_survey_at: '2026-04-16',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-05-15',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'recently-succeeded'})],
        }),
      )
      // #then no dispatch — success + not-yet-eligible → skip
      expect(result.dispatches).toEqual([])
    })

    // Integration: full reconcileRepos pipeline through isEligibleForSurvey with a
    // past eligibility date. Pins the wiring at classifyTracked:318/322 — proves the
    // helper is actually consulted on the dispatch path, not just exercised in unit-test
    // isolation. Without this, a future refactor that drops the isEligibleForSurvey call
    // from classifyTracked would still pass all standalone helper tests.
    it('dispatches an onboarded entry whose next_survey_eligible_at has passed', () => {
      // #given an onboarded entry whose eligibility was 2 weeks ago (NOW = 2026-04-17)
      const entry = makeEntry({
        name: 'overdue-repo',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-03-01',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-04-03',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'overdue-repo'})],
        }),
      )
      // #then the entry is dispatched (eligibility passed)
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'overdue-repo'}])
    })
  })

  describe('discovery channels (owned + contrib)', () => {
    // Owned and contrib are pre-trusted: owned because we own the repo, contrib because
    // the operator named it explicitly in metadata/allowlist.yaml. Both bypass the
    // pending-review issue path that exists for non-allowlisted collab newcomers.

    it('tags an owned newcomer with discovery_channel: owned and dispatches as pending', () => {
      // #given an accessible repo from the fro-bot owned channel, not yet tracked
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'fro-bot', name: 'agent', node_id: 'R_agent'})],
          accessChannelByKey: new Map([['fro-bot/agent', 'owned']]),
        }),
      )

      // #then it's added as pending with discovery_channel: owned, dispatch queued, no issue
      expect(result.nextRepos.repos).toHaveLength(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: 'fro-bot',
        name: 'agent',
        onboarding_status: 'pending',
        discovery_channel: 'owned',
      })
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'agent'}])
      expect(result.issues).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(0)
    })

    it('tags a contrib newcomer with discovery_channel: contrib and dispatches as pending', () => {
      // #given a contrib repo surfaced via the allowlist's approved_contrib_orgs
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'bfra-me', name: '.github', node_id: 'R_bfra_gh'})],
          accessChannelByKey: new Map([['bfra-me/.github', 'contrib']]),
        }),
      )

      // #then dispatched with discovery_channel: contrib; no pending-review issue
      expect(result.nextRepos.repos[0]?.discovery_channel).toBe('contrib')
      expect(result.dispatches).toEqual([{owner: 'bfra-me', repo: '.github'}])
      expect(result.issues).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(0)
    })

    it('falls back to discovery_channel: collab when accessChannelByKey is missing the entry', () => {
      // #given a collab access list (channel map missing the key — preserves existing behavior)
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'marcusrbrown', name: 'new-repo'})],
          allowlist: makeAllowlist(['marcusrbrown']),
          // accessChannelByKey not supplied — defaults to all-collab
        }),
      )

      expect(result.nextRepos.repos[0]?.discovery_channel).toBe('collab')
      expect(result.dispatches).toEqual([{owner: 'marcusrbrown', repo: 'new-repo'}])
    })

    it('skips pending-review for owned newcomers from a non-allowlisted owner', () => {
      // #given an owned-channel newcomer with empty allowlist
      // #then it bypasses the allowlist gate (owned is always trusted)
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'fro-bot', name: 'agent', node_id: 'R_agent'})],
          accessChannelByKey: new Map([['fro-bot/agent', 'owned']]),
          allowlist: makeAllowlist([]), // intentionally empty
        }),
      )

      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(0)
      expect(result.dispatches).toHaveLength(1)
      expect(result.issues).toEqual([])
    })

    it('skips pending-review for contrib newcomers regardless of approved_inviters', () => {
      // #given a contrib newcomer whose owner is not in approved_inviters
      // #then dispatched directly; allowlist-via-channel-map is sufficient trust
      const result = reconcileRepos(
        makeInput({
          accessList: [makeAccess({owner: 'bfra-me', name: 'renovate-action', node_id: 'R_bfra_ren'})],
          accessChannelByKey: new Map([['bfra-me/renovate-action', 'contrib']]),
          allowlist: makeAllowlist([]),
        }),
      )

      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(0)
      expect(result.dispatches).toEqual([{owner: 'bfra-me', repo: 'renovate-action'}])
      expect(result.issues).toEqual([])
    })

    it('preserves discovery_channel on tracked owned entries through field refresh', () => {
      // #given a tracked owned entry whose probed fields drift
      const entry = makeEntry({
        owner: 'fro-bot',
        name: 'agent',
        onboarding_status: 'onboarded',
        discovery_channel: 'owned',
        next_survey_eligible_at: '2026-05-01', // not yet eligible
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({owner: 'fro-bot', name: 'agent', node_id: 'R_agent'})],
          accessChannelByKey: new Map([['fro-bot/agent', 'owned']]),
          fieldProbes: new Map([['fro-bot/agent', {has_fro_bot_workflow: true, has_renovate: true}]]),
        }),
      )

      // #then channel is preserved (sticky); fields refresh
      expect(result.nextRepos.repos[0]?.discovery_channel).toBe('owned')
      expect(result.nextRepos.repos[0]?.has_fro_bot_workflow).toBe(true)
      expect(result.nextRepos.repos[0]?.has_renovate).toBe(true)
      expect(result.summary.refreshed).toBe(1)
    })

    it('flips a contrib entry to lost-access when the access list drops it', () => {
      // #given a tracked contrib entry no longer surfaced (e.g., fro-bot.yaml was deleted)
      const entry = makeEntry({
        owner: 'bfra-me',
        name: '.github',
        onboarding_status: 'onboarded',
        discovery_channel: 'contrib',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [], // not in any channel's access list anymore
          perRepoStatus: new Map([['bfra-me/.github', {status: 'revoked'}]]),
        }),
      )

      // #then status flips to lost-access; channel is preserved
      expect(result.nextRepos.repos[0]?.onboarding_status).toBe('lost-access')
      expect(result.nextRepos.repos[0]?.discovery_channel).toBe('contrib')
      expect(result.summary.lostAccess).toBe(1)
    })

    it('regains a contrib entry when the access list resurfaces it', () => {
      // #given a lost-access contrib entry that re-appears via access list
      const entry = makeEntry({
        owner: 'bfra-me',
        name: '.github',
        onboarding_status: 'lost-access',
        discovery_channel: 'contrib',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({owner: 'bfra-me', name: '.github', node_id: 'R_bfra_gh'})],
          accessChannelByKey: new Map([['bfra-me/.github', 'contrib']]),
        }),
      )

      // #then regained as pending; dispatched directly (contrib is trusted, no issue)
      expect(result.nextRepos.repos[0]?.onboarding_status).toBe('pending')
      expect(result.summary.regained).toBe(1)
      expect(result.dispatches).toEqual([{owner: 'bfra-me', repo: '.github'}])
      expect(result.issues).toEqual([])
    })

    it('regains an owned entry without filing a pending-review issue', () => {
      const entry = makeEntry({
        owner: 'fro-bot',
        name: 'systematic',
        onboarding_status: 'lost-access',
        discovery_channel: 'owned',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({owner: 'fro-bot', name: 'systematic', node_id: 'R_sys'})],
          accessChannelByKey: new Map([['fro-bot/systematic', 'owned']]),
          allowlist: makeAllowlist([]), // owner not in approved_inviters; channel trust suffices
        }),
      )

      expect(result.nextRepos.repos[0]?.onboarding_status).toBe('pending')
      expect(result.summary.regained).toBe(1)
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'systematic'}])
      expect(result.issues).toEqual([])
    })

    it('handles a mixed access list with collab + owned + contrib in one pass', () => {
      // #given access entries spanning all three channels
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'marcusrbrown', name: 'collab-repo'}),
            makeAccess({owner: 'fro-bot', name: 'agent', node_id: 'R_agent'}),
            makeAccess({owner: 'bfra-me', name: '.github', node_id: 'R_bfra_gh'}),
          ],
          accessChannelByKey: new Map([
            ['fro-bot/agent', 'owned'],
            ['bfra-me/.github', 'contrib'],
            // marcusrbrown/collab-repo intentionally absent — defaults to collab
          ]),
          allowlist: makeAllowlist(['marcusrbrown']),
        }),
      )

      expect(result.nextRepos.repos).toHaveLength(3)
      expect(result.summary.added).toBe(3)
      expect(result.summary.pendingReview).toBe(0)
      expect(result.dispatches).toHaveLength(3)
      const byName = new Map(result.nextRepos.repos.map(r => [r.name, r.discovery_channel]))
      expect(byName.get('collab-repo')).toBe('collab')
      expect(byName.get('agent')).toBe('owned')
      expect(byName.get('.github')).toBe('contrib')
    })
  })
})

//
// ─────────────────────────────────────────────────────────────────────────────
// fetchPerRepoStatus — 5-state classification unit tests
// ─────────────────────────────────────────────────────────────────────────────
//

describe('fetchPerRepoStatus 5-state classification', () => {
  it('HTTP 200 with valid body, entry not in access list → revoked', async () => {
    const reposGet = vi.fn(async () => ({
      data: {private: true, node_id: 'R_test'} as RepoGetResponse,
    }))
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'secret-repo'), [], logger)

    expect(result.get('fro-bot/secret-repo')).toEqual({status: 'revoked'})
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('HTTP 404 → deleted', async () => {
    const reposGet = vi.fn(async () => {
      throw apiError(404, 'Not Found')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'gone-repo'), [], logger)

    expect(result.get('fro-bot/gone-repo')).toEqual({status: 'deleted'})
  })

  it('HTTP 451 → revoked', async () => {
    const reposGet = vi.fn(async () => {
      throw apiError(451, 'Unavailable For Legal Reasons')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'taken-down-repo'), [], logger)

    expect(result.get('fro-bot/taken-down-repo')).toEqual({status: 'revoked'})
  })

  it('HTTP 403 → revoked', async () => {
    const reposGet = vi.fn(async () => {
      throw apiError(403, 'Forbidden')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'blocked-repo'), [], logger)

    expect(result.get('fro-bot/blocked-repo')).toEqual({status: 'revoked'})
  })

  it('HTTP 429 → transient (primary rate-limit, not revoked)', async () => {
    const reposGet = vi.fn(async () => {
      throw apiError(429, 'Too Many Requests')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'rate-limited'), [], logger)

    expect(result.get('fro-bot/rate-limited')).toEqual({status: 'transient', httpStatus: 429})
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate-limit'))
  })

  it('HTTP 403 with Retry-After header → transient (secondary rate-limit, not revoked)', async () => {
    const reposGet = vi.fn(async () => {
      throw Object.assign(new Error('Forbidden'), {
        status: 403,
        response: {headers: {'retry-after': '60'}},
      })
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'secondary-limited'), [], logger)

    expect(result.get('fro-bot/secondary-limited')).toEqual({status: 'transient', httpStatus: 403})
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate-limit'))
  })

  it('HTTP 403 with x-ratelimit-remaining: 0 → transient (rate-limit signal in headers)', async () => {
    const reposGet = vi.fn(async () => {
      throw Object.assign(new Error('API rate limit exceeded'), {
        status: 403,
        response: {headers: {'x-ratelimit-remaining': '0'}},
      })
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'header-limited'), [], logger)

    expect(result.get('fro-bot/header-limited')).toEqual({status: 'transient', httpStatus: 403})
  })

  it('HTTP 403 with rate-limit message body → transient (rate-limit signal in body)', async () => {
    const reposGet = vi.fn(async () => {
      throw Object.assign(new Error('You have triggered an abuse detection mechanism'), {
        status: 403,
      })
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'abuse-flagged'), [], logger)

    expect(result.get('fro-bot/abuse-flagged')).toEqual({status: 'transient', httpStatus: 403})
  })

  it('HTTP 502 → transient with httpStatus', async () => {
    const reposGet = vi.fn(async () => {
      throw apiError(502, 'Bad Gateway')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'flaky-repo'), [], logger)

    expect(result.get('fro-bot/flaky-repo')).toEqual({status: 'transient', httpStatus: 502})
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('transient API error (502)'))
  })

  it('HTTP 503 → transient with httpStatus', async () => {
    const reposGet = vi.fn(async () => {
      throw apiError(503, 'Service Unavailable')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'overloaded-repo'), [], logger)

    expect(result.get('fro-bot/overloaded-repo')).toEqual({status: 'transient', httpStatus: 503})
  })

  it('network error → transient without httpStatus', async () => {
    const reposGet = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'offline-repo'), [], logger)

    expect(result.get('fro-bot/offline-repo')).toEqual({status: 'transient'})
    expect(result.get('fro-bot/offline-repo')).not.toHaveProperty('httpStatus')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network error'))
  })

  it('HTTP 200 with malformed body (empty data) → malformed', async () => {
    const reposGet = vi.fn(async () => ({
      data: {} as RepoGetResponse,
    }))
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'broken-repo'), [], logger)

    expect(result.get('fro-bot/broken-repo')).toEqual({status: 'malformed'})
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed repos.get response'))
  })

  it('HTTP 200 malformed body with private as non-boolean → malformed', async () => {
    const reposGet = vi.fn(async () => ({
      data: {private: 'not-a-bool', node_id: 'R_ok'} as unknown as RepoGetResponse,
    }))
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'weird-repo'), [], logger)

    expect(result.get('fro-bot/weird-repo')).toEqual({status: 'malformed'})
  })

  it('HTTP 422 (other 4xx) → throws ReconcileError', async () => {
    expect.assertions(1)
    const reposGet = vi.fn(async () => {
      throw apiError(422, 'Unprocessable')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    await expect(fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'weird-repo'), [], logger)).rejects.toThrow(
      ReconcileError,
    )
  })
})

//
// ─────────────────────────────────────────────────────────────────────────────
// Unit 3 — I/O shell tests for `handleReconcile`
// ─────────────────────────────────────────────────────────────────────────────
//

interface OctokitMockOverrides {
  paginate?: (fn: unknown, opts: unknown) => Promise<unknown[]>
  listForAuthenticatedUser?: (opts: unknown) => Promise<{data: AccessListApiEntry[]}>
  reposGet?: (params: {owner: string; repo: string}) => Promise<{data: RepoGetResponse}>
  getBranch?: (params: {owner: string; repo: string; branch: string}) => Promise<{data: BranchResponse}>
  getContent?: (params: {owner: string; repo: string; path: string}) => Promise<unknown>
  createOrUpdateFileContents?: (params: unknown) => Promise<unknown>
  createRef?: (params: unknown) => Promise<unknown>
  createWorkflowDispatch?: (params: unknown) => Promise<unknown>
  issuesCreate?: (params: unknown) => Promise<{data: {number: number}}>
  issuesUpdate?: (params: unknown) => Promise<unknown>
  issuesListForRepo?: (params: unknown) => Promise<{data: IssueListEntry[]}>
}

interface AccessListApiEntry {
  owner: {login: string}
  name: string
  archived: boolean
  private: boolean
  node_id: string
}

interface RepoGetResponse {
  archived?: boolean
  private?: boolean
  node_id?: string
}

interface BranchResponse {
  name: string
  commit: {
    sha: string
    author: {login: string} | null
    committer?: {login: string} | null
  }
}

interface IssueListEntry {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: {name: string}[]
}

function apiError(status: number, message = 'API error'): Error {
  return Object.assign(new Error(message), {status})
}

/**
 * Extract the first positional argument of the first recorded call on a vi.fn mock.
 * Bypasses the `[]` tuple inference that `noUncheckedIndexedAccess` flags when mocks
 * are created with untyped `async () => ...` bodies.
 */
function firstCallArg<A>(fn: {mock: {calls: unknown[]}}): A | undefined {
  const call = fn.mock.calls[0] as [A] | undefined
  return call?.[0]
}

function notFoundGetBranch(): (params: unknown) => Promise<never> {
  return async () => {
    throw apiError(404, 'Not Found')
  }
}

/**
 * Build a getContent mock that returns base64-encoded fro-bot.yaml content for
 * specific repos and 404 for everything else. Used by the discovery-channels
 * integration tests to verify forge-resistance + content-probe behavior end-to-end.
 */
function contentByRepo(
  byOwnerName: Map<string, string>,
): (params: {owner: string; repo: string; path: string}) => Promise<unknown> {
  return async ({owner, repo, path}) => {
    if (path !== '.github/workflows/fro-bot.yaml') {
      throw apiError(404, 'Not Found')
    }
    const content = byOwnerName.get(`${owner}/${repo}`)
    if (content === undefined) throw apiError(404, 'Not Found')
    return {
      data: {
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content, 'utf8').toString('base64'),
      },
    }
  }
}

function mockOctokit(overrides: OctokitMockOverrides = {}): OctokitClient {
  const defaultListForAuthenticatedUser: (opts: unknown) => Promise<{data: AccessListApiEntry[]}> = async () => ({
    data: [],
  })
  const listForAuthenticatedUser = overrides.listForAuthenticatedUser ?? defaultListForAuthenticatedUser
  const defaultPaginate: (fn: unknown, opts: unknown) => Promise<unknown[]> = async (fn, opts) => {
    const call = fn as (opts: unknown) => Promise<{data: unknown[]}>
    const response = await call(opts)
    return response.data
  }

  return {
    paginate: overrides.paginate ?? defaultPaginate,
    rest: {
      repos: {
        listForAuthenticatedUser,
        get:
          overrides.reposGet ??
          (async () => ({
            data: {archived: false, private: false, node_id: 'R_default'} as RepoGetResponse,
          })),
        getBranch:
          overrides.getBranch ??
          (async () => ({
            data: {
              name: 'data',
              commit: {
                sha: 'data-tip-sha',
                author: {login: 'fro-bot[bot]'},
              },
            } satisfies BranchResponse,
          })),
        getContent:
          overrides.getContent ??
          (async () => {
            throw apiError(404, 'Not Found')
          }),
        createOrUpdateFileContents:
          overrides.createOrUpdateFileContents ?? (async () => ({data: {commit: {sha: 'x'}}})),
      },
      git: {
        createRef: overrides.createRef ?? (async () => ({data: {ref: 'refs/heads/data'}})),
      },
      actions: {
        createWorkflowDispatch: overrides.createWorkflowDispatch ?? (async () => undefined),
      },
      apps: {
        // Stub for the App-installation enumeration used by fetchOwnedRepos. Returns
        // an empty `data` array so the default paginate (which unwraps `response.data`)
        // produces an empty list, matching the production behavior of paginate
        // automatically extracting the `repositories` array from this endpoint.
        // Tests that need real owned-repo behavior pass `paginate: appPaginate(fixtures)`.
        listReposAccessibleToInstallation: async () => ({data: []}),
      },
      issues: {
        create: overrides.issuesCreate ?? (async () => ({data: {number: 1}})),
        update: overrides.issuesUpdate ?? (async () => ({data: {}})),
        listForRepo: overrides.issuesListForRepo ?? (async () => ({data: [] as IssueListEntry[]})),
      },
    },
  } as unknown as OctokitClient
}

function makeReadMetadata(
  opts: {allowlist?: AllowlistFile; repos?: ReposFile} = {},
): (path: string) => Promise<unknown> {
  const allowlist = opts.allowlist ?? makeAllowlist([])
  const repos = opts.repos ?? {version: 1, repos: []}
  return async (path: string) => {
    if (path.endsWith('allowlist.yaml')) return allowlist
    if (path.endsWith('repos.yaml')) return repos
    throw new Error(`unexpected readMetadata path: ${path}`)
  }
}

function silentLogger(): {
  warn: ReturnType<typeof vi.fn<(message: string) => void>>
  info: ReturnType<typeof vi.fn<(message: string) => void>>
} {
  return {
    warn: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
  }
}

function baseParams(overrides: Partial<HandleReconcileParams> = {}): HandleReconcileParams {
  return {
    userOctokit: overrides.userOctokit ?? mockOctokit(),
    appOctokit: overrides.appOctokit ?? mockOctokit(),
    owner: overrides.owner ?? 'fro-bot',
    repo: overrides.repo ?? '.github',
    allowlistPath: overrides.allowlistPath ?? 'metadata/allowlist.yaml',
    reposPath: overrides.reposPath ?? 'metadata/repos.yaml',
    now: overrides.now ?? NOW,
    readMetadata: overrides.readMetadata ?? makeReadMetadata(),
    commitMetadata:
      overrides.commitMetadata ?? (vi.fn(async () => ({committed: true, sha: 'commit-sha', attempts: 1})) as never),
    bootstrapDataBranch:
      overrides.bootstrapDataBranch ??
      (vi.fn(async () => ({created: false, ref: 'refs/heads/data', sha: 'data-sha'})) as never),
    dispatchTimeoutMs: overrides.dispatchTimeoutMs ?? 100,
    dispatchStaggerMs: overrides.dispatchStaggerMs ?? 0,
    // Tests default to the cap disabled so existing dispatch-count assertions remain valid.
    // Specific tests that exercise the cap override this.
    maxDispatchesPerRun: overrides.maxDispatchesPerRun ?? 0,
    dispatchSleep: overrides.dispatchSleep,
    logger: overrides.logger ?? silentLogger(),
    workflowFile: overrides.workflowFile ?? 'survey-repo.yaml',
    workflowRef: overrides.workflowRef ?? 'main',
  }
}

describe('handleReconcile (I/O shell)', () => {
  describe('orchestration order', () => {
    it('calls bootstrapDataBranch exactly once before any metadata read', async () => {
      const calls: string[] = []
      const bootstrap = vi.fn(async () => {
        calls.push('bootstrap')
        return {created: false, ref: 'refs/heads/data', sha: 'x'}
      })
      const readMetadata = vi.fn(async (path: string) => {
        calls.push(`read:${path}`)
        if (path.endsWith('allowlist.yaml')) return makeAllowlist([])
        return {version: 1, repos: []}
      })

      await handleReconcile(
        baseParams({
          bootstrapDataBranch: bootstrap as never,
          readMetadata,
        }),
      )

      expect(bootstrap).toHaveBeenCalledOnce()
      expect(calls[0]).toBe('bootstrap')
      // both reads happen after bootstrap
      expect(calls.slice(1).every(c => c.startsWith('read:'))).toBe(true)
    })

    it('invokes commitMetadata BEFORE any createWorkflowDispatch (commit-before-dispatch)', async () => {
      const calls: string[] = []
      const commitMetadata = vi.fn(async (params: CommitMetadataParams): Promise<CommitMetadataResult> => {
        calls.push('commit')
        // Drive the mutator once so it returns a sensible result
        await params.mutator({version: 1, repos: []})
        return {committed: true, sha: 'commit-sha', attempts: 1}
      })
      const createWorkflowDispatch = vi.fn(async () => {
        calls.push('dispatch')
      })
      const appOctokit = mockOctokit({createWorkflowDispatch})
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {
              owner: {login: 'marcusrbrown'},
              name: 'new-repo',
              archived: false,
              private: false,
              node_id: 'R_new',
            },
          ],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit,
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['marcusrbrown'])}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(calls).toEqual(['commit', 'dispatch'])
      expect(commitMetadata).toHaveBeenCalledOnce()
      expect(createWorkflowDispatch).toHaveBeenCalledOnce()
    })

    it('mixed newcomers produces one commit, one dispatch, one per-repo issue', async () => {
      const commitMetadata = vi.fn(async (params: CommitMetadataParams): Promise<CommitMetadataResult> => {
        await params.mutator({version: 1, repos: []})
        return {committed: true, sha: 'sha', attempts: 1}
      })
      const createWorkflowDispatch = vi.fn(async () => undefined)
      const issuesCreate = vi.fn(async () => ({data: {number: 42}}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 'trusted'}, name: 'ok-repo', archived: false, private: false, node_id: 'R_ok'},
            {owner: {login: 'stranger'}, name: 'sus-repo', archived: false, private: false, node_id: 'R_sus'},
          ],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch, issuesCreate}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['trusted'])}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(commitMetadata).toHaveBeenCalledOnce()
      expect(createWorkflowDispatch).toHaveBeenCalledOnce()
      expect(issuesCreate).toHaveBeenCalledOnce()
    })

    it('skips commit, dispatch, and issue create when reconcile summary is all zero', async () => {
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))
      const createWorkflowDispatch = vi.fn(async () => undefined)
      const issuesCreate = vi.fn(async () => ({data: {number: 1}}))
      // Use pending-review: it's excluded from the dispatch gate, so the entry
      // truly produces zero side-effects (no dispatches, no commits).
      // Add matching private/node_id matching the mock access-list entry below.
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({name: 'stable-repo', onboarding_status: 'pending-review', private: false, node_id: 'R_stable'}),
        ],
      }
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 'fro-bot'}, name: 'stable-repo', archived: false, private: false, node_id: 'R_stable'},
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch, issuesCreate}),
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(commitMetadata).not.toHaveBeenCalled()
      expect(createWorkflowDispatch).not.toHaveBeenCalled()
      expect(issuesCreate).not.toHaveBeenCalled()
      expect(result.committed).toBe(false)
      expect(result.summary.added).toBe(0)
      expect(result.summary.unchanged).toBe(1)
    })
  })

  describe('field probes (integration)', () => {
    it('omits a failed field probe from the map — reconcile treats as no-change', async () => {
      const existing: ReposFile = {
        version: 1,
        repos: [
          // Fresh survey — next_survey_eligible_at in the future, so the test isolates
          // the field-probe behavior from the cadence dispatch gate.
          makeEntry({
            name: 'probe-fail-repo',
            onboarding_status: 'onboarded',
            has_fro_bot_workflow: true,
            has_renovate: true,
            private: false,
            node_id: 'R_x',
            last_survey_at: '2026-04-10',
            last_survey_status: 'success',
            next_survey_eligible_at: '2026-05-09',
          }),
        ],
      }
      const commitMetadata = vi.fn(async () => ({committed: false, attempts: 1}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 'fro-bot'}, name: 'probe-fail-repo', archived: false, private: false, node_id: 'R_x'}],
        }),
        getContent: async () => {
          throw apiError(500, 'Internal Server Error')
        },
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: commitMetadata as never,
        }),
      )

      // probe failed → omitted → reconcile sees no probe → no-change → unchanged counter
      expect(result.summary.unchanged).toBe(1)
      expect(result.summary.refreshed).toBe(0)
      expect(commitMetadata).not.toHaveBeenCalled()
    })

    it('flips all tracked entries to lost-access when /user/repos returns 0 repos', async () => {
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({name: 'a', onboarding_status: 'onboarded'}),
          makeEntry({name: 'b', onboarding_status: 'onboarded'}),
        ],
      }
      const reposGet = vi.fn(async () => {
        throw apiError(404)
      })
      let seenNext: ReposFile | null = null
      const commitMetadata = vi.fn(async (params: CommitMetadataParams): Promise<CommitMetadataResult> => {
        const next = (await params.mutator(existing)) as ReposFile
        seenNext = next
        return {committed: true, sha: 'sha', attempts: 1}
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit: mockOctokit({
            listForAuthenticatedUser: async () => ({data: []}),
            reposGet,
          }),
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(result.summary.lostAccess).toBe(2)
      expect(seenNext).not.toBeNull()
      const resolvedNext = seenNext as unknown as ReposFile
      expect(resolvedNext.repos.every(r => r.onboarding_status === 'lost-access')).toBe(true)
      expect(reposGet).toHaveBeenCalledTimes(2)
    })
  })

  describe('dispatch loop', () => {
    it('continues after a dispatch failure (dispatch #2 of 3 fails)', async () => {
      const dispatchCalls: {owner: string; repo: string}[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {owner: string; repo: string}}
        const inputs = typed.inputs ?? {owner: '', repo: ''}
        dispatchCalls.push(inputs)
        if (dispatchCalls.length === 2) throw apiError(500, 'dispatch boom')
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 't'}, name: 'r1', archived: false, private: false, node_id: 'R_1'},
            {owner: {login: 't'}, name: 'r2', archived: false, private: false, node_id: 'R_2'},
            {owner: {login: 't'}, name: 'r3', archived: false, private: false, node_id: 'R_3'},
          ],
        }),
      })

      const logger = silentLogger()
      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          logger,
        }),
      )

      expect(dispatchCalls).toHaveLength(3)
      expect(result.dispatches).toBe(2)
      expect(result.dispatchesFailed).toBe(1)
      expect(logger.warn).toHaveBeenCalled()
    })

    it('staggers between dispatches but not before the first or after the last', async () => {
      // Verifies the stagger contract documented in the triage for marcusrbrown/infra#144.
      // For N dispatches we expect exactly N-1 stagger sleeps, never called before dispatch 1
      // (to keep first-survey latency unchanged) and never after dispatch N (to avoid trailing
      // idle time inside the 10-minute workflow job timeout).
      const dispatchCalls: string[] = []
      const sleepCalls: number[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {owner: string; repo: string}}
        dispatchCalls.push(typed.inputs?.repo ?? '?')
      })
      const dispatchSleep = vi.fn(async (ms: number) => {
        sleepCalls.push(ms)
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 't'}, name: 'r1', archived: false, private: false, node_id: 'R_1'},
            {owner: {login: 't'}, name: 'r2', archived: false, private: false, node_id: 'R_2'},
            {owner: {login: 't'}, name: 'r3', archived: false, private: false, node_id: 'R_3'},
            {owner: {login: 't'}, name: 'r4', archived: false, private: false, node_id: 'R_4'},
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          dispatchStaggerMs: 5000,
          dispatchSleep,
        }),
      )

      // Exactly 4 dispatches fired in order.
      expect(dispatchCalls).toEqual(['r1', 'r2', 'r3', 'r4'])
      expect(result.dispatches).toBe(4)
      // Exactly 3 sleeps — between r1→r2, r2→r3, r3→r4. Never before r1. Never after r4.
      expect(sleepCalls).toEqual([5000, 5000, 5000])
      expect(dispatchSleep).toHaveBeenCalledTimes(3)
    })

    it('skips stagger entirely when dispatchStaggerMs is 0', async () => {
      const dispatchSleep = vi.fn(async () => {
        /* no-op */
      })
      const createWorkflowDispatch = vi.fn(async () => undefined)
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 't'}, name: 'r1', archived: false, private: false, node_id: 'R_1'},
            {owner: {login: 't'}, name: 'r2', archived: false, private: false, node_id: 'R_2'},
          ],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          dispatchStaggerMs: 0,
          dispatchSleep,
        }),
      )

      // No sleeps at all when stagger is 0 — the conditional `if (params.staggerMs > 0)`
      // short-circuits before calling sleep. Critical for test-suite speed.
      expect(dispatchSleep).not.toHaveBeenCalled()
      expect(createWorkflowDispatch).toHaveBeenCalledTimes(2)
    })

    it('treats a dispatch timeout as failure and continues to the next', async () => {
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {owner: string; repo: string}}
        const name = typed.inputs?.repo ?? '?'
        dispatchCalls.push(name)
        if (name === 'r2') {
          await new Promise(() => {
            /* never resolves — simulates hang */
          })
        }
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 't'}, name: 'r1', archived: false, private: false, node_id: 'R_1'},
            {owner: {login: 't'}, name: 'r2', archived: false, private: false, node_id: 'R_2'},
            {owner: {login: 't'}, name: 'r3', archived: false, private: false, node_id: 'R_3'},
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          dispatchTimeoutMs: 20, // tight timeout for test speed
        }),
      )

      // All three repos are attempted regardless of day-rotation order; a timeout on
      // one should not block the others from dispatching.
      expect(dispatchCalls.slice().sort()).toEqual(['r1', 'r2', 'r3'])
      expect(result.dispatches).toBe(2)
      expect(result.dispatchesFailed).toBe(1)
    })
  })

  describe('dispatch prioritization and cap', () => {
    it('dispatches repos with null last_survey_at before any previously-surveyed repo', async () => {
      // Mixed access list: two never-surveyed (r1, r3), one already surveyed (r2).
      // Cap of 2 forces the engine to drop one candidate; the dropped candidate MUST
      // be the already-surveyed one because progressive runs prioritize fresh coverage.
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {repo: string}}
        dispatchCalls.push(typed.inputs?.repo ?? '?')
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 't'}, name: 'r1', archived: false, private: false, node_id: 'R_1'},
            {owner: {login: 't'}, name: 'r2', archived: false, private: false, node_id: 'R_2'},
            {owner: {login: 't'}, name: 'r3', archived: false, private: false, node_id: 'R_3'},
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({
            allowlist: makeAllowlist(['t']),
            repos: {
              version: 1,
              repos: [
                {
                  // Stale survey (>30d old against NOW=2026-04-17) so r2 is a dispatch
                  // candidate alongside the null-last-survey-at r1 and r3.
                  owner: 't',
                  name: 'r2',
                  added: '2026-02-01',
                  onboarding_status: 'onboarded',
                  last_survey_at: '2026-02-01',
                  last_survey_status: 'success',
                  has_fro_bot_workflow: false,
                  has_renovate: false,
                  discovery_channel: 'collab',
                  next_survey_eligible_at: null,
                },
              ],
            },
          }),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          maxDispatchesPerRun: 2,
        }),
      )

      expect(dispatchCalls).toEqual(['r1', 'r3'])
      expect(result.dispatches).toBe(2)
      expect(result.dispatchesDeferred).toBe(1)
    })

    it('among repos with non-null last_survey_at, dispatches oldest first', async () => {
      // Three repos all previously surveyed: oldest (r-old), middle (r-mid), newest (r-new).
      // Cap of 2 selects the two oldest; newest is deferred to the next run.
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {repo: string}}
        dispatchCalls.push(typed.inputs?.repo ?? '?')
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 't'}, name: 'r-old', archived: false, private: false, node_id: 'R_old'},
            {owner: {login: 't'}, name: 'r-mid', archived: false, private: false, node_id: 'R_mid'},
            {owner: {login: 't'}, name: 'r-new', archived: false, private: false, node_id: 'R_new'},
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({
            allowlist: makeAllowlist(['t']),
            repos: {
              version: 1,
              repos: [
                {
                  owner: 't',
                  name: 'r-old',
                  added: '2026-01-01',
                  onboarding_status: 'onboarded',
                  last_survey_at: '2026-01-15',
                  last_survey_status: 'success',
                  has_fro_bot_workflow: false,
                  has_renovate: false,
                  discovery_channel: 'collab',
                  next_survey_eligible_at: null,
                },
                {
                  owner: 't',
                  name: 'r-mid',
                  added: '2026-02-01',
                  onboarding_status: 'onboarded',
                  last_survey_at: '2026-02-15',
                  last_survey_status: 'success',
                  has_fro_bot_workflow: false,
                  has_renovate: false,
                  discovery_channel: 'collab',
                  next_survey_eligible_at: null,
                },
                {
                  owner: 't',
                  name: 'r-new',
                  added: '2026-03-01',
                  onboarding_status: 'onboarded',
                  last_survey_at: '2026-03-15',
                  last_survey_status: 'success',
                  has_fro_bot_workflow: false,
                  has_renovate: false,
                  discovery_channel: 'collab',
                  next_survey_eligible_at: null,
                },
              ],
            },
          }),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          maxDispatchesPerRun: 2,
        }),
      )

      expect(dispatchCalls).toEqual(['r-old', 'r-mid'])
      expect(result.dispatches).toBe(2)
      expect(result.dispatchesDeferred).toBe(1)
    })

    it('treats cap <= 0 as disabled (dispatches all eligible candidates)', async () => {
      // Six never-surveyed repos + cap of 0 (disabled) → all six dispatch.
      const dispatchCount = {n: 0}
      const createWorkflowDispatch = vi.fn(async () => {
        dispatchCount.n += 1
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: Array.from({length: 6}, (_, i) => ({
            owner: {login: 't'},
            name: `r${i + 1}`,
            archived: false,
            private: false,
            node_id: `R_${i + 1}`,
          })),
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          maxDispatchesPerRun: 0,
        }),
      )

      expect(dispatchCount.n).toBe(6)
      expect(result.dispatches).toBe(6)
      expect(result.dispatchesDeferred).toBe(0)
    })

    it('rotates the null-group selection window daily so all never-surveyed repos eventually dispatch', async () => {
      // Four never-surveyed repos (r-a, r-b, r-c, r-d sorted alphabetically).
      // Cap of 2. dayOrdinal(NOW=2026-04-17) = 20560; 20560 % 4 = 0 → selects [r-a, r-b].
      // dayOrdinal(2026-04-19) = 20562; 20562 % 4 = 2 → rotates to [r-c, r-d, r-a, r-b] → selects [r-c, r-d].
      // This proves repos that sort later don't starve when the null group exceeds the cap.
      const repos = ['r-a', 'r-b', 'r-c', 'r-d']
      const makeOctokit = () =>
        mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: repos.map(name => ({
              owner: {login: 't'},
              name,
              archived: false,
              private: false,
              node_id: `R_${name}`,
            })),
          }),
        })

      const runWith = async (now: Date) => {
        const dispatched: string[] = []
        const createWorkflowDispatch = vi.fn(async (params: unknown) => {
          dispatched.push((params as {inputs?: {repo: string}}).inputs?.repo ?? '?')
        })
        await handleReconcile(
          baseParams({
            userOctokit: makeOctokit(),
            appOctokit: mockOctokit({createWorkflowDispatch}),
            readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
            commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
            now,
            maxDispatchesPerRun: 2,
          }),
        )
        return dispatched
      }

      // Offset 0 → first slice
      expect(await runWith(NOW)).toEqual(['r-a', 'r-b'])
      // Offset 2 → rotated slice; r-c and r-d get their turn
      expect(await runWith(new Date('2026-04-19T12:00:00Z'))).toEqual(['r-c', 'r-d'])
    })
  })

  describe('issue creation and auto-close', () => {
    it('creates a public-repo per-repo issue with owner/repo in title and body', async () => {
      const issuesCreate = vi.fn(async () => ({data: {number: 7}}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 'stranger'}, name: 'leaked-repo', archived: false, private: false, node_id: 'R_pub'}],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate}),
          readMetadata: makeReadMetadata({}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        }),
      )

      expect(issuesCreate).toHaveBeenCalledOnce()
      const params = firstCallArg<{title: string; body: string; labels: string[]}>(issuesCreate)
      expect(params?.title).toContain('stranger/leaked-repo')
      expect(params?.body).toContain('stranger/leaked-repo')
      expect(params?.body).toContain('R_pub')
      expect(params?.labels).toContain('reconcile:pending-review')
    })

    it('creates a private-repo per-repo issue with generic title, no owner/repo anywhere, node_id in body', async () => {
      const issuesCreate = vi.fn(async () => ({data: {number: 8}}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 'stranger'}, name: 'secret-repo', archived: false, private: true, node_id: 'R_priv'}],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate}),
          readMetadata: makeReadMetadata({}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        }),
      )

      expect(issuesCreate).toHaveBeenCalledOnce()
      const params = firstCallArg<{title: string; body: string}>(issuesCreate)
      expect(params?.title).not.toContain('secret-repo')
      expect(params?.title).not.toContain('stranger/secret-repo')
      expect(params?.body).not.toContain('secret-repo')
      expect(params?.body).toContain('R_priv')
    })

    it('continues through remaining issues when one issue creation fails', async () => {
      let created = 0
      const issuesCreate = vi.fn(async () => {
        created += 1
        if (created === 1) throw apiError(500, 'issue boom')
        return {data: {number: 100 + created}}
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 'a'}, name: 'r1', archived: false, private: false, node_id: 'R_1'},
            {owner: {login: 'b'}, name: 'r2', archived: false, private: false, node_id: 'R_2'},
          ],
        }),
      })
      const logger = silentLogger()

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate}),
          readMetadata: makeReadMetadata({}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          logger,
        }),
      )

      expect(issuesCreate).toHaveBeenCalledTimes(2)
      expect(result.issuesFailed).toBe(1)
      expect(result.perRepoIssues).toBe(1)
      expect(logger.warn).toHaveBeenCalled()
    })

    it('auto-closes a stale pending-review issue when the subject is no longer pending-review', async () => {
      // entry is promoted — no longer pending-review
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({
            owner: 'stranger',
            name: 'promoted-repo',
            onboarding_status: 'pending', // operator promoted
          }),
        ],
      }
      const issuesListForRepo = vi.fn(async () => ({
        data: [
          {
            number: 42,
            title: 'Unsolicited collaborator grant: stranger/promoted-repo',
            body: '<!-- reconcile:subject:node_id=R_prom -->\nbody text',
            state: 'open' as const,
            labels: [{name: 'reconcile:pending-review'}],
          },
        ],
      }))
      const issuesUpdate = vi.fn(async () => ({data: {}}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {
              owner: {login: 'stranger'},
              name: 'promoted-repo',
              archived: false,
              private: false,
              node_id: 'R_prom',
            },
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesListForRepo, issuesUpdate}),
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      expect(issuesUpdate).toHaveBeenCalledOnce()
      const params = firstCallArg<{issue_number: number; state: string}>(issuesUpdate)
      expect(params?.issue_number).toBe(42)
      expect(params?.state).toBe('closed')
      expect(result.closedStaleIssues).toBe(1)
    })

    it('does NOT auto-close an open issue whose subject is still pending-review', async () => {
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({
            owner: 'stranger',
            name: 'still-sus-repo',
            onboarding_status: 'pending-review',
          }),
        ],
      }
      const issuesUpdate = vi.fn(async () => ({data: {}}))
      const issuesListForRepo = vi.fn(async () => ({
        data: [
          {
            number: 7,
            title: 'Unsolicited collaborator grant: stranger/still-sus-repo',
            body: '<!-- reconcile:subject:node_id=R_sus -->',
            state: 'open' as const,
            labels: [{name: 'reconcile:pending-review'}],
          },
        ],
      }))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {
              owner: {login: 'stranger'},
              name: 'still-sus-repo',
              archived: false,
              private: false,
              node_id: 'R_sus',
            },
          ],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesListForRepo, issuesUpdate}),
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      expect(issuesUpdate).not.toHaveBeenCalled()
    })
  })

  describe('self-healing rollup', () => {
    it('re-files a rollup issue when ≥2 pending-review entries exist for same owner but no open rollup issue', async () => {
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({owner: 'bad', name: 'r1', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'bad', name: 'r2', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'bad', name: 'r3', onboarding_status: 'pending-review'}),
        ],
      }
      const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
      // No open rollup issue exists; simulate prior one was closed manually
      const issuesListForRepo = vi.fn(async () => ({data: []}))

      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: existing.repos.map((r, i) => ({
            owner: {login: r.owner},
            name: r.name,
            archived: false,
            private: false,
            node_id: `R_exist_${i}`,
          })),
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate, issuesListForRepo}),
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      // The self-healing loop should file one rollup issue since none exists
      expect(issuesCreate).toHaveBeenCalledOnce()
      const params = firstCallArg<{title: string; labels: string[]}>(issuesCreate)
      expect(params?.title.toLowerCase()).toContain('bad')
      expect(params?.labels).toContain('reconcile:rollup-pending-review')
    })

    it('does not file a new rollup when an open rollup issue already exists for that owner', async () => {
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({owner: 'bad', name: 'r1', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'bad', name: 'r2', onboarding_status: 'pending-review'}),
        ],
      }
      const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
      const issuesListForRepo = vi.fn(async () => ({
        data: [
          {
            number: 50,
            title: 'Unsolicited collaborator grants from bad',
            body: '<!-- reconcile:subject:rollup-owner=bad -->',
            state: 'open' as const,
            labels: [{name: 'reconcile:pending-review'}, {name: 'reconcile:rollup-pending-review'}],
          },
        ],
      }))

      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: existing.repos.map((r, i) => ({
            owner: {login: r.owner},
            name: r.name,
            archived: false,
            private: false,
            node_id: `R_exist_${i}`,
          })),
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate, issuesListForRepo}),
          readMetadata: makeReadMetadata({repos: existing}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      expect(issuesCreate).not.toHaveBeenCalled()
    })
  })

  describe('data branch integrity check', () => {
    it('passes when data branch tip is authored by fro-bot[bot]', async () => {
      const getBranch = vi.fn(async () => ({
        data: {name: 'data', commit: {sha: 'sha1', author: {login: 'fro-bot[bot]'}}},
      }))
      const issuesCreate = vi.fn(async () => ({data: {number: 1}}))
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'r', archived: false, private: false, node_id: 'R_1'}],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({getBranch, issuesCreate}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(result.integrityCheck).toBe('ok')
      expect(commitMetadata).toHaveBeenCalledOnce()
      // Integrity alert issue should NOT be filed
      const alertCalls = (issuesCreate.mock.calls as unknown as [{labels?: string[]}][]).filter(c => {
        const p = c[0]
        return p.labels?.includes('reconcile:integrity-alert') ?? false
      })
      expect(alertCalls).toHaveLength(0)
    })

    it('passes when data branch tip is authored by fro-bot user (PAT writes)', async () => {
      // Fro Bot writes that go through FRO_BOT_PAT (survey-repo record-survey-result,
      // fro-bot agent wiki-ingest) are attributed to the `fro-bot` user account. The
      // integrity check accepts it alongside `fro-bot[bot]` because both identities
      // belong to the same autonomous operator.
      const getBranch = vi.fn(async () => ({
        data: {name: 'data', commit: {sha: 'pat-sha', author: {login: 'fro-bot'}}},
      }))
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'r', archived: false, private: false, node_id: 'R_1'}],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({getBranch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(result.integrityCheck).toBe('ok')
      expect(commitMetadata).toHaveBeenCalledOnce()
    })

    it('aborts with DATA_BRANCH_TAMPER and files an integrity-alert issue for unexpected author', async () => {
      const getBranch = vi.fn(async () => ({
        data: {name: 'data', commit: {sha: 'evil-sha', author: {login: 'impostor'}}},
      }))
      const issuesCreate = vi.fn(async () => ({data: {number: 1}}))
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'r', archived: false, private: false, node_id: 'R_1'}],
        }),
      })

      await expect(
        handleReconcile(
          baseParams({
            userOctokit,
            appOctokit: mockOctokit({getBranch, issuesCreate}),
            readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
            commitMetadata: commitMetadata as never,
          }),
        ),
      ).rejects.toMatchObject({code: 'DATA_BRANCH_TAMPER'})

      // Alert issue is filed; no commit is attempted
      expect(issuesCreate).toHaveBeenCalledOnce()
      const params = firstCallArg<{labels: string[]; body: string}>(issuesCreate)
      expect(params?.labels).toContain('reconcile:integrity-alert')
      expect(params?.body).toContain('impostor')
      expect(params?.body).toContain('evil-sha')
      expect(commitMetadata).not.toHaveBeenCalled()
    })

    it('skips the integrity check in the bootstrap case (data branch does not exist)', async () => {
      const getBranch = notFoundGetBranch()
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'r', archived: false, private: false, node_id: 'R_1'}],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({getBranch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(result.integrityCheck).toBe('skipped-no-data-branch')
      expect(commitMetadata).toHaveBeenCalledOnce()
    })

    it('skips the integrity check when data branch was just bootstrapped this run', async () => {
      // bootstrapDataBranch returns created:true when it created the branch from main HEAD
      // this run. The branch now exists but its tip commit is inherited from main — authored
      // by whoever merged the last PR, not fro-bot[bot]. The check must be skipped to avoid
      // a false-positive DATA_BRANCH_TAMPER on every first run after a main merge.
      const bootstrap = vi.fn(async () => ({created: true, ref: 'refs/heads/data', sha: 'new-data-sha'}))
      const getBranch = vi.fn(async () => ({
        data: {name: 'data', commit: {sha: 'main-sha', author: {login: 'human-merger'}}},
      }))
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))
      const issuesCreate = vi.fn(async () => ({data: {number: 1}}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'r', archived: false, private: false, node_id: 'R_1'}],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({getBranch, issuesCreate}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: commitMetadata as never,
          bootstrapDataBranch: bootstrap as never,
        }),
      )

      expect(result.integrityCheck).toBe('skipped-just-bootstrapped')
      expect(commitMetadata).toHaveBeenCalledOnce()
      // getBranch would normally be called by verifyDataBranchIntegrity — but we're skipping
      // that step entirely on bootstrap, so it should never be invoked. No getBranch call
      // also means no path to file a reconcile:integrity-alert issue.
      expect(getBranch).not.toHaveBeenCalled()
      expect(issuesCreate).not.toHaveBeenCalled()
    })
  })

  describe('commit error handling', () => {
    it('propagates CONFLICT_EXHAUSTED from commitMetadata and skips all dispatches', async () => {
      const conflictError = Object.assign(new Error('conflict'), {
        name: 'CommitMetadataError',
        code: 'CONFLICT_EXHAUSTED',
        remediation: 'retry',
      })
      const commitMetadata = vi.fn(async () => {
        throw conflictError
      })
      const createWorkflowDispatch = vi.fn(async () => undefined)
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'r', archived: false, private: false, node_id: 'R_1'}],
        }),
      })

      await expect(
        handleReconcile(
          baseParams({
            userOctokit,
            appOctokit: mockOctokit({createWorkflowDispatch}),
            readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
            commitMetadata: commitMetadata as never,
          }),
        ),
      ).rejects.toMatchObject({code: 'CONFLICT_EXHAUSTED'})

      expect(createWorkflowDispatch).not.toHaveBeenCalled()
    })

    it('re-runs reconcileRepos on 409-retry: mutator called twice with v1 then v2, merges concurrent entry', async () => {
      // The scenario requires hasChanges=true so the commit path actually executes. We
      // give reconcile a brand-new repo `b` in the access list, simulating a new grant
      // that reconcile wants to add. Meanwhile a concurrent writer (handle-invitation)
      // appends `concurrent-c` to repos.yaml between our initial read and the 409 retry.
      const v1: ReposFile = {version: 1, repos: [makeEntry({name: 'a', onboarding_status: 'pending'})]}
      const v2: ReposFile = {
        version: 1,
        repos: [
          makeEntry({name: 'a', onboarding_status: 'pending'}),
          makeEntry({name: 'concurrent-c', onboarding_status: 'pending'}),
        ],
      }

      const mutatorInvocations: ReposFile[] = []
      const commitMetadata = vi.fn(async (params: CommitMetadataParams): Promise<CommitMetadataResult> => {
        // First invocation with v1 (pre-concurrent-write state)
        const first = (await params.mutator(v1)) as ReposFile
        mutatorInvocations.push(first)
        // Second invocation with v2 (simulates 409 retry post-concurrent-write)
        const second = (await params.mutator(v2)) as ReposFile
        mutatorInvocations.push(second)
        return {committed: true, sha: 'sha', attempts: 2}
      })

      // Access list has both `a` (tracked) and `b` (new) — reconcile wants to add `b`.
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 'fro-bot'}, name: 'a', archived: false, private: false, node_id: 'R_a'},
            {owner: {login: 'fro-bot'}, name: 'b', archived: false, private: false, node_id: 'R_b'},
          ],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          readMetadata: makeReadMetadata({repos: v1, allowlist: makeAllowlist(['fro-bot'])}),
          commitMetadata: commitMetadata as never,
        }),
      )

      expect(mutatorInvocations).toHaveLength(2)
      // First invocation: v1 + add b → 2 entries (a, b)
      expect(mutatorInvocations[0]?.repos.map(r => r.name).sort()).toEqual(['a', 'b'])
      // Second invocation: v2 (a + concurrent-c) + add b → 3 entries. Crucially, concurrent-c
      // is preserved (no incorrect lost-access flip) because it's not in accessList and has no
      // probe (perRepoStatus was computed from the initial v1 read, so c wasn't probed).
      expect(mutatorInvocations[1]?.repos.map(r => r.name).sort()).toEqual(['a', 'b', 'concurrent-c'])
      expect(mutatorInvocations[1]?.repos.find(r => r.name === 'concurrent-c')?.onboarding_status).toBe('pending')
    })
  })

  describe('env-based auth and MISSING_TOKEN', () => {
    it('throws MISSING_TOKEN with env-var name and no token value when FRO_BOT_POLL_PAT is missing', async () => {
      const saved = process.env.FRO_BOT_POLL_PAT
      delete process.env.FRO_BOT_POLL_PAT
      try {
        const caught = await handleReconcile({
          appOctokit: mockOctokit(),
          owner: 'fro-bot',
          repo: '.github',
          readMetadata: makeReadMetadata(),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
          bootstrapDataBranch: vi.fn(async () => ({created: false, ref: 'refs/heads/data', sha: 's'})) as never,
        }).catch((error: unknown) => error)

        expect(caught).toBeInstanceOf(ReconcileError)
        const re = caught as ReconcileError
        expect(re.code).toBe('MISSING_TOKEN')
        expect(re.message).toContain('FRO_BOT_POLL_PAT')
        // Token hygiene: message must not contain any real token-looking substring
        // Token hygiene: message must not contain any GitHub token prefix pattern or substring
        // that could be confused for a real token value.
        expect(re.message).not.toMatch(/gh[pso]_|github_pat_/)
      } finally {
        if (saved !== undefined) process.env.FRO_BOT_POLL_PAT = saved
      }
    })

    it('throws MISSING_TOKEN when GITHUB_TOKEN is missing (app token not minted)', async () => {
      const savedUser = process.env.FRO_BOT_POLL_PAT
      const savedApp = process.env.GITHUB_TOKEN
      process.env.FRO_BOT_POLL_PAT = 'fake-pat-value-for-test'
      delete process.env.GITHUB_TOKEN
      try {
        const caught = await handleReconcile({
          userOctokit: mockOctokit(),
          owner: 'fro-bot',
          repo: '.github',
          readMetadata: makeReadMetadata(),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
          bootstrapDataBranch: vi.fn(async () => ({created: false, ref: 'refs/heads/data', sha: 's'})) as never,
        }).catch((error: unknown) => error)

        expect(caught).toBeInstanceOf(ReconcileError)
        const re = caught as ReconcileError
        expect(re.code).toBe('MISSING_TOKEN')
        expect(re.message).toContain('GITHUB_TOKEN')
        expect(re.message).not.toContain('fake-pat-value-for-test')
      } finally {
        if (savedUser === undefined) {
          delete process.env.FRO_BOT_POLL_PAT
        } else {
          process.env.FRO_BOT_POLL_PAT = savedUser
        }
        if (savedApp !== undefined) process.env.GITHUB_TOKEN = savedApp
      }
    })
  })

  describe('discovery channels (owned + contrib through full pipeline)', () => {
    // These tests exercise fetchOwnedRepos and fetchContribRepos via handleReconcile,
    // not just the engine. The mock `paginate` returns the owned-org repo list; the
    // mock `getContent` serves fro-bot.yaml content for contrib probes.

    interface InstallationRepoFixture {
      owner: {login: string}
      name: string
      archived: boolean
      fork: boolean
      private: boolean
      node_id: string
    }

    function makeInstallationRepo(overrides: Partial<InstallationRepoFixture> = {}): InstallationRepoFixture {
      return {
        owner: {login: 'fro-bot'},
        name: 'agent',
        archived: false,
        fork: false,
        private: false,
        node_id: 'R_inst',
        ...overrides,
      }
    }

    /**
     * App-side paginate mock for `apps.listReposAccessibleToInstallation`. Always
     * returns the supplied installation repo list regardless of which function the
     * shell passes in. The real Octokit paginate auto-extracts `data.repositories`;
     * tests bypass that machinery and provide the unwrapped list directly.
     */
    function appPaginate(
      installationRepos: InstallationRepoFixture[],
    ): (fn: unknown, opts: unknown) => Promise<unknown[]> {
      return async () => installationRepos
    }
    // `contentByRepo` is hoisted to module scope (see top of file).

    const TRUSTED_WORKFLOW = `name: Fro Bot
on: [issues, pull_request]
jobs:
  agent:
    uses: fro-bot/agent/.github/workflows/fro-bot.yaml@v0.42.1
`

    const SPOOFED_WORKFLOW = `name: not-the-agent
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "fro-bot/agent is great"
`

    it('owned channel: surfaces fro-bot org repos with discovery_channel: owned, skips fro-bot/.github', async () => {
      // #given the App installation enumeration returns 4 fro-bot repos including .github
      const installationRepos = [
        makeInstallationRepo({name: 'agent', node_id: 'R_agent'}),
        makeInstallationRepo({name: 'systematic', node_id: 'R_systematic'}),
        makeInstallationRepo({name: 'fro-bot.github.io', node_id: 'R_pages'}),
        makeInstallationRepo({name: '.github', node_id: 'R_self_excluded'}),
      ]

      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      // #when reconcile runs
      const result = await handleReconcile(
        baseParams({
          appOctokit: mockOctokit({paginate: appPaginate(installationRepos)}),
          readMetadata: makeReadMetadata(),
          commitMetadata: commitMetadata as never,
        }),
      )

      // #then 3 owned repos are surfaced (.github excluded), all with channel=owned
      expect(result.summary.added).toBe(3)
      expect(result.dispatches).toBe(3)
      expect(result.summary.pendingReview).toBe(0) // owned bypasses pending-review
    })

    it('owned channel: skips archived and forked repos', async () => {
      const installationRepos = [
        makeInstallationRepo({name: 'agent', node_id: 'R_agent'}),
        makeInstallationRepo({name: 'archive-test', node_id: 'R_arch', archived: true}),
        makeInstallationRepo({name: 'fork-test', node_id: 'R_fork', fork: true}),
      ]

      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      const result = await handleReconcile(
        baseParams({
          appOctokit: mockOctokit({paginate: appPaginate(installationRepos)}),
          readMetadata: makeReadMetadata(),
          commitMetadata: commitMetadata as never,
        }),
      )

      // Only `agent` should survive both filters
      expect(result.summary.added).toBe(1)
    })

    it('contrib channel: surfaces approved_contrib_repos with content-verified fro-bot.yaml', async () => {
      // #given allowlist with two contrib repos
      const allowlist: AllowlistFile = {
        version: 1,
        approved_inviters: [],
        approved_contrib_repos: ['bfra-me/.github', 'other-org/no-workflow'],
      }

      // #and bfra-me/.github has a trusted workflow; other-org/no-workflow has none
      const contentMap = new Map([['bfra-me/.github', TRUSTED_WORKFLOW]])

      // reposGet drives both probeContribRepoMetadata (for contrib) and the per-repo
      // status probe (for tracked entries). We need to handle both.
      const reposGet = async ({owner, repo}: {owner: string; repo: string}) => {
        if (owner === 'bfra-me' && repo === '.github') {
          return {data: {archived: false, fork: false, private: false, node_id: 'R_bfra_gh'} as RepoGetResponse}
        }
        if (owner === 'other-org' && repo === 'no-workflow') {
          return {data: {archived: false, fork: false, private: false, node_id: 'R_other'} as RepoGetResponse}
        }
        return {data: {archived: false, private: false, node_id: 'R_default'} as RepoGetResponse}
      }

      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      const result = await handleReconcile(
        baseParams({
          appOctokit: mockOctokit({
            paginate: appPaginate([]), // no owned repos
            getContent: contentByRepo(contentMap),
            reposGet,
          }),
          readMetadata: makeReadMetadata({allowlist}),
          commitMetadata: commitMetadata as never,
        }),
      )

      // Only bfra-me/.github passes content verification
      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(0) // contrib bypasses pending-review
    })

    it('contrib channel: rejects repos with spoofed fro-bot.yaml (forge resistance)', async () => {
      // #given allowlist names a repo whose fro-bot.yaml only mentions fro-bot/agent
      // in a non-uses position (run: echo)
      const allowlist: AllowlistFile = {
        version: 1,
        approved_inviters: [],
        approved_contrib_repos: ['attacker-org/spoof-repo'],
      }

      const contentMap = new Map([['attacker-org/spoof-repo', SPOOFED_WORKFLOW]])

      const reposGet = async ({owner, repo}: {owner: string; repo: string}) => {
        if (owner === 'attacker-org' && repo === 'spoof-repo') {
          return {
            data: {archived: false, fork: false, private: false, node_id: 'R_attacker'} as RepoGetResponse,
          }
        }
        return {data: {archived: false, private: false, node_id: 'R_default'} as RepoGetResponse}
      }

      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      const result = await handleReconcile(
        baseParams({
          appOctokit: mockOctokit({
            paginate: appPaginate([]),
            getContent: contentByRepo(contentMap),
            reposGet,
          }),
          readMetadata: makeReadMetadata({allowlist}),
          commitMetadata: commitMetadata as never,
        }),
      )

      // Spoofed workflow is rejected; nothing is added
      expect(result.summary.added).toBe(0)
    })

    it('contrib channel: distinguishes 403 (App not installed) from 404 (no signal file) in warn logs', async () => {
      const allowlist: AllowlistFile = {
        version: 1,
        approved_inviters: [],
        approved_contrib_repos: ['locked-org/private-repo', 'open-org/no-workflow'],
      }

      const reposGet = async ({owner}: {owner: string; repo: string}) => {
        if (owner === 'locked-org') throw apiError(403, 'Forbidden')
        if (owner === 'open-org') {
          return {data: {archived: false, fork: false, private: false, node_id: 'R_open'} as RepoGetResponse}
        }
        return {data: {archived: false, private: false, node_id: 'R_default'} as RepoGetResponse}
      }

      const logger = silentLogger()
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      await handleReconcile(
        baseParams({
          appOctokit: mockOctokit({
            paginate: appPaginate([]),
            reposGet,
            // open-org/no-workflow has no fro-bot.yaml — getContent throws 404 by default
          }),
          readMetadata: makeReadMetadata({allowlist}),
          commitMetadata: commitMetadata as never,
          logger,
        }),
      )

      // 403 logs distinctly from 404
      const warnMessages = logger.warn.mock.calls.map(call => call[0])
      const has403Warn = warnMessages.some(m => /locked-org\/private-repo.*403.*App not installed/.test(m))
      expect(has403Warn).toBe(true)
    })

    it('contrib channel: warns when approved_contrib_orgs is set (v1 ignores it)', async () => {
      const allowlist: AllowlistFile = {
        version: 1,
        approved_inviters: [],
        approved_contrib_orgs: ['bfra-me'],
        approved_contrib_repos: [],
      }

      const logger = silentLogger()
      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      await handleReconcile(
        baseParams({
          appOctokit: mockOctokit({paginate: appPaginate([])}),
          readMetadata: makeReadMetadata({allowlist}),
          commitMetadata: commitMetadata as never,
          logger,
        }),
      )

      const warnMessages = logger.warn.mock.calls.map(call => call[0])
      const hasOrgsWarn = warnMessages.some(m => m.includes('approved_contrib_orgs is not yet supported'))
      expect(hasOrgsWarn).toBe(true)
    })

    it('mixed pipeline: collab + owned + contrib all surface with correct channels', async () => {
      // #given collab access list, owned installation repos, and contrib allowlist
      const collabRepos: AccessListApiEntry[] = [
        {owner: {login: 'marcusrbrown'}, name: 'collab-repo', archived: false, private: false, node_id: 'R_collab'},
      ]

      const installationRepos = [makeInstallationRepo({name: 'agent', node_id: 'R_agent'})]

      const allowlist: AllowlistFile = {
        version: 1,
        approved_inviters: [{username: 'marcusrbrown', added: '2026-01-01', role: 'owner'}],
        approved_contrib_repos: ['bfra-me/.github'],
      }

      const reposGet = async ({owner, repo}: {owner: string; repo: string}) => {
        if (owner === 'bfra-me' && repo === '.github') {
          return {data: {archived: false, fork: false, private: false, node_id: 'R_bfra'} as RepoGetResponse}
        }
        return {data: {archived: false, private: false, node_id: 'R_default'} as RepoGetResponse}
      }

      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({data: collabRepos}),
      })

      const appOctokit = mockOctokit({
        paginate: appPaginate(installationRepos),
        getContent: contentByRepo(new Map([['bfra-me/.github', TRUSTED_WORKFLOW]])),
        reposGet,
      })

      const commitMetadata = vi.fn(async () => ({committed: true, sha: 's', attempts: 1}))

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit,
          readMetadata: makeReadMetadata({allowlist}),
          commitMetadata: commitMetadata as never,
        }),
      )

      // 3 entries: collab + owned + contrib
      expect(result.summary.added).toBe(3)
      expect(result.summary.pendingReview).toBe(0)
      expect(result.dispatches).toBe(3)
    })
  })

  describe('per-channel observability', () => {
    it('emits first-survey info log for never-surveyed owned entries only', async () => {
      // GIVEN one owned entry with last_survey_at: null already onboarded
      const entry: RepoEntry = {
        owner: 'fro-bot',
        name: 'agent',
        added: '2026-05-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: true,
        has_renovate: false,
        discovery_channel: 'owned',
        next_survey_eligible_at: null,
      }
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: vi.fn(async () => ({
          data: [{owner: {login: 'fro-bot'}, name: 'agent', archived: false, private: false, node_id: 'R_a'}],
        })),
      })
      const logger = silentLogger()

      await handleReconcile(
        baseParams({
          userOctokit,
          readMetadata: makeReadMetadata({repos: {version: 1, repos: [entry]}}),
          logger,
        }),
      )

      const infoCalls = logger.info.mock.calls.flat()
      expect(infoCalls).toContain('reconcile: first survey for new owned entry: fro-bot/agent')
    })

    it('does NOT emit first-survey info log for collab newcomers', async () => {
      // GIVEN a collab newcomer (allowlisted owner, fresh dispatch)
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: vi.fn(async () => ({
          data: [
            {owner: {login: 'marcusrbrown'}, name: 'collab-newcomer', archived: false, private: false, node_id: 'R_c'},
          ],
        })),
      })
      const logger = silentLogger()

      await handleReconcile(
        baseParams({
          userOctokit,
          readMetadata: makeReadMetadata({
            repos: {version: 1, repos: []},
            allowlist: makeAllowlist(['marcusrbrown']),
          }),
          logger,
        }),
      )

      const infoCalls = logger.info.mock.calls.flat()
      expect(infoCalls.some((c: string) => c.includes('first survey for new collab'))).toBe(false)
    })

    it('does NOT re-emit first-survey log when an owned entry already has a last_survey_at', async () => {
      // GIVEN an owned entry that has already been surveyed once
      const entry: RepoEntry = {
        owner: 'fro-bot',
        name: 'agent',
        added: '2026-05-01',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-04-01', // previously surveyed
        last_survey_status: 'success',
        has_fro_bot_workflow: true,
        has_renovate: false,
        discovery_channel: 'owned',
        next_survey_eligible_at: '2026-04-20', // eligible (past)
      }
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: vi.fn(async () => ({
          data: [{owner: {login: 'fro-bot'}, name: 'agent', archived: false, private: false, node_id: 'R_a'}],
        })),
      })
      const logger = silentLogger()

      await handleReconcile(
        baseParams({
          userOctokit,
          readMetadata: makeReadMetadata({repos: {version: 1, repos: [entry]}}),
          logger,
        }),
      )

      const infoCalls = logger.info.mock.calls.flat()
      expect(infoCalls.some((c: string) => c.includes('first survey for new'))).toBe(false)
    })

    it('populates byChannel.dispatched and byChannel.deferred after cap selection', async () => {
      // GIVEN 3 collab entries that are all eligible, with maxDispatchesPerRun=2
      const entries: RepoEntry[] = ['a', 'b', 'c'].map(name => ({
        owner: 'marcusrbrown',
        name,
        added: '2026-01-01',
        onboarding_status: 'onboarded',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
        discovery_channel: 'collab',
        next_survey_eligible_at: null,
      }))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: vi.fn(async () => ({
          data: entries.map(e => ({
            owner: {login: e.owner},
            name: e.name,
            archived: false,
            private: false,
            node_id: `R_${e.name}`,
          })),
        })),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          readMetadata: makeReadMetadata({repos: {version: 1, repos: entries}}),
          maxDispatchesPerRun: 2,
        }),
      )

      // 2 dispatched, 1 deferred — all collab
      expect(result.summary.byChannel.collab.dispatched).toBe(2)
      expect(result.summary.byChannel.collab.deferred).toBe(1)
      expect(result.summary.byChannel.owned.dispatched).toBe(0)
      expect(result.summary.byChannel.contrib.dispatched).toBe(0)
    })
  })
})

describe('migrateRepoEntry', () => {
  // Backfills new schema fields on legacy entries that predate the cadence rollout.
  // Returns the input by reference when both fields are already populated (idempotent).

  it('backfills discovery_channel as collab and computes next_survey_eligible_at from last_survey_at', () => {
    // GIVEN a legacy entry with last_survey_at populated and both new fields missing
    const legacy = makeEntry({
      last_survey_at: '2026-04-27',
      discovery_channel: undefined,
      next_survey_eligible_at: undefined,
    })

    // WHEN migrating
    const migrated = migrateRepoEntry(legacy, NOW)

    // THEN both fields are populated (channel = collab, eligibility = baseDate + 30d + jitter)
    expect(migrated.discovery_channel).toBe('collab')
    expect(migrated.next_survey_eligible_at).toMatch(/^2026-05-(2[7-9]|30)$/)
    // AND nothing else changed
    expect({
      ...migrated,
      discovery_channel: legacy.discovery_channel,
      next_survey_eligible_at: legacy.next_survey_eligible_at,
    }).toEqual(legacy)
  })

  it('leaves next_survey_eligible_at null when last_survey_at is null', () => {
    const legacy = makeEntry({
      last_survey_at: null,
      discovery_channel: undefined,
      next_survey_eligible_at: undefined,
    })

    const migrated = migrateRepoEntry(legacy, NOW)

    expect(migrated.discovery_channel).toBe('collab')
    expect(migrated.next_survey_eligible_at).toBe(null)
  })

  it('treats malformed last_survey_at as never-surveyed (next_survey_eligible_at = null)', () => {
    const legacy = makeEntry({
      last_survey_at: 'not-a-date',
      discovery_channel: undefined,
      next_survey_eligible_at: undefined,
    })

    const migrated = migrateRepoEntry(legacy, NOW)

    expect(migrated.discovery_channel).toBe('collab')
    expect(migrated.next_survey_eligible_at).toBe(null)
  })

  it('returns the input by reference when both fields are already populated (idempotent)', () => {
    const fresh = makeEntry({
      last_survey_at: '2026-04-27',
      discovery_channel: 'owned',
      next_survey_eligible_at: '2026-05-15',
    })

    const migrated = migrateRepoEntry(fresh, NOW)

    expect(migrated).toBe(fresh) // referential equality
  })

  it('backfills only the missing field when only one is absent', () => {
    // GIVEN an entry with channel set (e.g. by addRepoEntry default) but eligibility missing
    const partial = makeEntry({
      last_survey_at: '2026-04-27',
      discovery_channel: 'owned',
      next_survey_eligible_at: undefined,
    })

    const migrated = migrateRepoEntry(partial, NOW)

    // THEN channel is preserved (not overwritten with 'collab')
    expect(migrated.discovery_channel).toBe('owned')
    // AND eligibility is computed using the existing channel's interval (owned = 14d)
    expect(migrated.next_survey_eligible_at).toMatch(/^2026-05-(1[1-4])$/)
  })
})

describe('reconcileRepos legacy migration', () => {
  it('migrates legacy entries on first reconcile run and bumps summary.migrated', () => {
    // GIVEN a tracked entry missing both new fields and an unchanged access list
    const legacy = makeEntry({
      owner: 'marcusrbrown',
      name: 'legacy-repo',
      onboarding_status: 'onboarded',
      last_survey_at: '2026-04-01',
      discovery_channel: undefined,
      next_survey_eligible_at: undefined,
    })

    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [legacy]},
        accessList: [makeAccess({owner: 'marcusrbrown', name: 'legacy-repo', node_id: 'R_legacy'})],
        fieldProbes: new Map([['marcusrbrown/legacy-repo', {has_fro_bot_workflow: false, has_renovate: false}]]),
      }),
    )

    // THEN summary.migrated counts the migration
    expect(result.summary.migrated).toBe(1)
    // AND the entry now carries both new fields
    expect(result.nextRepos.repos[0]?.discovery_channel).toBe('collab')
    // last_survey_at: 2026-04-01 + collab 30d + jitter[0..3] → 2026-05-01..04
    expect(result.nextRepos.repos[0]?.next_survey_eligible_at).toMatch(/^2026-05-0[1-4]$/)
  })

  it('subsequent reconcile run on already-migrated state has summary.migrated === 0', () => {
    // GIVEN an entry that has both new fields set (post-migration steady state)
    const migrated = makeEntry({
      owner: 'marcusrbrown',
      name: 'migrated-repo',
      onboarding_status: 'onboarded',
      last_survey_at: '2026-04-01',
      discovery_channel: 'collab',
      next_survey_eligible_at: '2026-05-01',
      private: false,
      node_id: 'R_mig',
    })

    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [migrated]},
        accessList: [makeAccess({owner: 'marcusrbrown', name: 'migrated-repo', node_id: 'R_mig'})],
        fieldProbes: new Map([['marcusrbrown/migrated-repo', {has_fro_bot_workflow: false, has_renovate: false}]]),
      }),
    )

    expect(result.summary.migrated).toBe(0)
    // AND nextRepos referential identity preserved (no-op fast path)
    expect(result.nextRepos.repos[0]).toBe(migrated)
  })

  it('a migration-only run (no other changes) is NOT a no-op — produces a real commit plan', () => {
    // GIVEN 18 legacy entries, all access still healthy, no field-probe drift
    const legacyEntries = Array.from({length: 18}, (_, i) =>
      makeEntry({
        owner: 'marcusrbrown',
        name: `legacy-${i.toString().padStart(2, '0')}`,
        onboarding_status: 'onboarded',
        last_survey_at: null, // never-surveyed → not eligible-storm
        discovery_channel: undefined,
        next_survey_eligible_at: undefined,
      }),
    )
    const accessList = legacyEntries.map((e, i) => makeAccess({owner: e.owner, name: e.name, node_id: `R_l${i}`}))
    const fieldProbes = new Map(
      legacyEntries.map(e => [`${e.owner}/${e.name}`, {has_fro_bot_workflow: false, has_renovate: false}]),
    )
    const initial = {version: 1, repos: legacyEntries} as const

    const result = reconcileRepos(
      makeInput({
        currentRepos: initial,
        accessList,
        fieldProbes,
      }),
    )

    // THEN migrated counter is 18
    expect(result.summary.migrated).toBe(18)
    // AND the run is NOT classified as no-op (must produce a commit so the migration persists)
    expect(result.nextRepos.repos).not.toBe(initial.repos)
    // AND every entry is now populated
    for (const entry of result.nextRepos.repos) {
      expect(entry.discovery_channel).toBe('collab')
    }
  })
})

describe('formatCommitMessage', () => {
  it('emits the steady-state format when summary.migrated === 0', () => {
    expect(
      formatCommitMessage({
        added: 1,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 2,
        migrated: 0,
        transient: 0,
        malformed: 0,
        unchanged: 0,
        byChannel: emptyChannelStats(),
      }),
    ).toBe('chore(reconcile): +1 new, 0 pending-review, 0 lost-access, 2 refreshes')
  })

  it('appends the +N migrated suffix when summary.migrated > 0', () => {
    expect(
      formatCommitMessage({
        added: 0,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 0,
        migrated: 18,
        transient: 0,
        malformed: 0,
        unchanged: 0,
        byChannel: emptyChannelStats(),
      }),
    ).toBe('chore(reconcile): +0 new, 0 pending-review, 0 lost-access, 0 refreshes, +18 migrated')
  })

  it('includes the migrated suffix alongside other non-zero counters', () => {
    expect(
      formatCommitMessage({
        added: 1,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 1,
        migrated: 18,
        transient: 0,
        malformed: 0,
        unchanged: 0,
        byChannel: emptyChannelStats(),
      }),
    ).toBe('chore(reconcile): +1 new, 0 pending-review, 0 lost-access, 1 refreshes, +18 migrated')
  })
})

describe('isEligibleForSurvey', () => {
  // Cadence model: null next_survey_eligible_at means "never computed" → always eligible
  it('returns true when next_survey_eligible_at is null (never surveyed)', () => {
    expect(isEligibleForSurvey(null, new Date('2026-05-01T12:00:00Z'))).toBe(true)
  })

  // Cadence model: a malformed eligible-at string treated as eligible (don't lose coverage)
  it('returns true when next_survey_eligible_at is a malformed date string', () => {
    expect(isEligibleForSurvey('not-a-date', new Date('2026-05-01T12:00:00Z'))).toBe(true)
  })

  // Boundary: now equals eligible-at → eligible (inclusive boundary)
  it('returns true when now equals next_survey_eligible_at (inclusive boundary)', () => {
    expect(isEligibleForSurvey('2026-05-01', new Date('2026-05-01T00:00:00Z'))).toBe(true)
  })

  // Boundary: now is one day before eligible-at → not eligible
  it('returns false when now is one day before next_survey_eligible_at', () => {
    expect(isEligibleForSurvey('2026-05-01', new Date('2026-04-30T23:59:59Z'))).toBe(false)
  })

  // Boundary: now is one day after eligible-at → eligible
  it('returns true when now is one day after next_survey_eligible_at', () => {
    expect(isEligibleForSurvey('2026-05-01', new Date('2026-05-02T00:00:00Z'))).toBe(true)
  })
})

describe('loadDispatchStaggerFromEnv', () => {
  const ENV_KEY = 'RECONCILE_DISPATCH_STAGGER_MS'

  function withEnv<T>(value: string | undefined, run: () => T): T {
    const saved = process.env[ENV_KEY]
    if (value === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = value
    try {
      return run()
    } finally {
      if (saved === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = saved
    }
  }

  it('returns the default when unset', () => {
    withEnv(undefined, () => {
      expect(loadDispatchStaggerFromEnv()).toBe(DISPATCH_DEFAULTS.staggerMs)
    })
  })

  it('returns the default when empty string', () => {
    withEnv('', () => {
      expect(loadDispatchStaggerFromEnv()).toBe(DISPATCH_DEFAULTS.staggerMs)
    })
  })

  it('returns the default when non-numeric', () => {
    withEnv('not-a-number', () => {
      expect(loadDispatchStaggerFromEnv()).toBe(DISPATCH_DEFAULTS.staggerMs)
    })
  })

  it('returns the parsed value within bounds', () => {
    withEnv('12345', () => {
      expect(loadDispatchStaggerFromEnv()).toBe(12345)
    })
  })

  it('clamps negative values to 0', () => {
    withEnv('-500', () => {
      expect(loadDispatchStaggerFromEnv()).toBe(0)
    })
  })

  it('clamps values over 300_000 to the 300s ceiling', () => {
    withEnv('999999', () => {
      expect(loadDispatchStaggerFromEnv()).toBe(300_000)
    })
  })
})

describe('loadMaxDispatchesPerRunFromEnv', () => {
  const ENV_KEY = 'RECONCILE_MAX_DISPATCHES_PER_RUN'

  function withEnv<T>(value: string | undefined, run: () => T): T {
    const saved = process.env[ENV_KEY]
    if (value === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = value
    try {
      return run()
    } finally {
      if (saved === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = saved
    }
  }

  it('returns the default when unset', () => {
    withEnv(undefined, () => {
      expect(loadMaxDispatchesPerRunFromEnv()).toBe(DISPATCH_DEFAULTS.maxDispatchesPerRun)
    })
  })

  it('returns the default when empty string', () => {
    withEnv('', () => {
      expect(loadMaxDispatchesPerRunFromEnv()).toBe(DISPATCH_DEFAULTS.maxDispatchesPerRun)
    })
  })

  it('returns the default when non-numeric', () => {
    withEnv('not-a-number', () => {
      expect(loadMaxDispatchesPerRunFromEnv()).toBe(DISPATCH_DEFAULTS.maxDispatchesPerRun)
    })
  })

  it('returns the parsed value as-is (positive)', () => {
    withEnv('10', () => {
      expect(loadMaxDispatchesPerRunFromEnv()).toBe(10)
    })
  })

  it('returns 0 verbatim (disables the cap in the caller)', () => {
    withEnv('0', () => {
      expect(loadMaxDispatchesPerRunFromEnv()).toBe(0)
    })
  })

  it('returns negative verbatim (disables the cap in the caller)', () => {
    withEnv('-1', () => {
      expect(loadMaxDispatchesPerRunFromEnv()).toBe(-1)
    })
  })
})

//
// ─────────────────────────────────────────────────────────────────────────────
// Pure helper tests for discovery-channel shell logic
// ─────────────────────────────────────────────────────────────────────────────
//

describe('containsFroBotAgentReference (forge resistance)', () => {
  it('accepts a workflow that calls fro-bot/agent with a version tag', () => {
    const yaml = `name: Fro Bot
on: [issues, pull_request]
jobs:
  agent:
    uses: fro-bot/agent/.github/workflows/fro-bot.yaml@v0.42.1
`
    expect(containsFroBotAgentReference(yaml)).toBe(true)
  })

  it('accepts a workflow that calls fro-bot/agent at main', () => {
    const yaml = `jobs:
  agent:
    uses: fro-bot/agent/.github/workflows/fro-bot.yaml@main
`
    expect(containsFroBotAgentReference(yaml)).toBe(true)
  })

  it('accepts a workflow that calls fro-bot/agent at a SHA', () => {
    const yaml = `jobs:
  agent:
    uses: fro-bot/agent@6c45d8ce66b0b69f1b80b23f283ed455deb59517
`
    expect(containsFroBotAgentReference(yaml)).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(containsFroBotAgentReference('')).toBe(false)
  })

  it('rejects a workflow that does not reference fro-bot/agent', () => {
    const yaml = `name: foo
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects a workflow that mentions fro-bot but not fro-bot/agent', () => {
    // Forge attempt: drop the literal string `fro-bot` somewhere in a workflow file
    // without actually invoking the agent action. Should not pass.
    const yaml = `name: not-the-agent
on: [push]
jobs:
  spoof:
    runs-on: ubuntu-latest
    steps:
      - run: echo "fro-bot is cool"
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects a YAML referencing fro-bot/something-else', () => {
    const yaml = `jobs:
  agent:
    uses: fro-bot/something-else@main
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects fro-bot/agent appearing only in a comment', () => {
    // Adversarial: spoof attempt via comment-only reference. The agent isn't actually
    // invoked anywhere — the comment is just text the parser ignores.
    const yaml = `# uses: fro-bot/agent@main (someday maybe)
name: spoof
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo not-the-agent
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects fro-bot/agent appearing only in a string value (name field)', () => {
    // Adversarial: spoof via string literal in a non-uses position.
    const yaml = `name: 'fro-bot/agent (just kidding)'
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects fro-bot/agent appearing only in a run: shell command', () => {
    // Adversarial: spoof via run-shell content.
    const yaml = `name: spoof
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "fro-bot/agent is cool"
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects fro-bot/agent appearing only in a with: input value', () => {
    // Adversarial: spoof via `with:` action input.
    const yaml = `name: spoof
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: fro-bot/agent
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects fro-bot/agent-fork (typo-squat via shared prefix)', () => {
    // Adversarial: a different action whose path happens to start with `fro-bot/agent`.
    // The structural check requires exact path match, not substring.
    const yaml = `jobs:
  agent:
    uses: fro-bot/agent-fork@main
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects not-fro-bot/agent (typo-squat via owner)', () => {
    const yaml = `jobs:
  agent:
    uses: not-fro-bot/agent@main
`
    expect(containsFroBotAgentReference(yaml)).toBe(false)
  })

  it('rejects malformed YAML (parse failure fails closed)', () => {
    expect(containsFroBotAgentReference(': not\nvalid: : yaml :\n - -')).toBe(false)
  })

  it('rejects a YAML scalar (no jobs structure)', () => {
    expect(containsFroBotAgentReference('just a string')).toBe(false)
  })
})

function makeMergeEntry(owner: string, name: string): AccessListEntry {
  return {owner, name, archived: false, private: false, node_id: `R_${owner}_${name}`}
}

describe('mergeAccessChannels (precedence + dedup)', () => {
  // Local alias to keep test bodies short without recreating the helper per-test.
  const entry = makeMergeEntry

  it('returns empty results when all channels are empty', () => {
    const result = mergeAccessChannels({collab: [], owned: [], contrib: []})
    expect(result.accessList).toEqual([])
    expect(result.accessChannelByKey.size).toBe(0)
  })

  it('tags collab-only entries with collab channel', () => {
    const result = mergeAccessChannels({collab: [entry('marcusrbrown', 'foo')], owned: [], contrib: []})
    expect(result.accessList).toHaveLength(1)
    expect(result.accessChannelByKey.get('marcusrbrown/foo')).toBe('collab')
  })

  it('tags owned-only entries with owned channel', () => {
    const result = mergeAccessChannels({collab: [], owned: [entry('fro-bot', 'agent')], contrib: []})
    expect(result.accessList).toHaveLength(1)
    expect(result.accessChannelByKey.get('fro-bot/agent')).toBe('owned')
  })

  it('tags contrib-only entries with contrib channel', () => {
    const result = mergeAccessChannels({collab: [], owned: [], contrib: [entry('bfra-me', '.github')]})
    expect(result.accessList).toHaveLength(1)
    expect(result.accessChannelByKey.get('bfra-me/.github')).toBe('contrib')
  })

  it('collab wins over owned for the same key', () => {
    // #given the same owner/name appears in both collab and owned
    const result = mergeAccessChannels({
      collab: [entry('fro-bot', 'agent')],
      owned: [entry('fro-bot', 'agent')],
      contrib: [],
    })
    // #then collab wins; only one entry; no duplicate keys
    expect(result.accessList).toHaveLength(1)
    expect(result.accessChannelByKey.get('fro-bot/agent')).toBe('collab')
  })

  it('owned wins over contrib for the same key', () => {
    const result = mergeAccessChannels({
      collab: [],
      owned: [entry('shared', 'repo')],
      contrib: [entry('shared', 'repo')],
    })
    expect(result.accessList).toHaveLength(1)
    expect(result.accessChannelByKey.get('shared/repo')).toBe('owned')
  })

  it('collab wins over both owned and contrib for the same key', () => {
    const result = mergeAccessChannels({
      collab: [entry('shared', 'repo')],
      owned: [entry('shared', 'repo')],
      contrib: [entry('shared', 'repo')],
    })
    expect(result.accessList).toHaveLength(1)
    expect(result.accessChannelByKey.get('shared/repo')).toBe('collab')
  })

  it('preserves all three channels when keys are distinct', () => {
    const result = mergeAccessChannels({
      collab: [entry('marcusrbrown', 'collab')],
      owned: [entry('fro-bot', 'agent')],
      contrib: [entry('bfra-me', '.github')],
    })
    expect(result.accessList).toHaveLength(3)
    expect(result.accessChannelByKey.get('marcusrbrown/collab')).toBe('collab')
    expect(result.accessChannelByKey.get('fro-bot/agent')).toBe('owned')
    expect(result.accessChannelByKey.get('bfra-me/.github')).toBe('contrib')
  })

  it('produces an accessList that passes validateAccessList (no duplicates)', () => {
    // #given overlapping channels
    const result = mergeAccessChannels({
      collab: [entry('shared', 'repo'), entry('marcusrbrown', 'foo')],
      owned: [entry('shared', 'repo'), entry('fro-bot', 'agent')],
      contrib: [entry('bfra-me', '.github')],
    })
    // #then reconcileRepos accepts it without throwing on the duplicate-key check
    expect(() =>
      reconcileRepos({
        currentRepos: {version: 1, repos: []},
        accessList: result.accessList,
        accessChannelByKey: result.accessChannelByKey,
        perRepoStatus: new Map(),
        allowlist: makeAllowlist(['marcusrbrown']),
        fieldProbes: new Map(),
        now: NOW,
      }),
    ).not.toThrow()
  })
})

describe('reconcileRepos byChannel summary', () => {
  it('counts tracked entries per channel', () => {
    // GIVEN 3 entries: 2 collab, 1 owned (no access changes, no probe drift)
    const entries = [
      makeEntry({owner: 'marcusrbrown', name: 'a', discovery_channel: 'collab'}),
      makeEntry({owner: 'marcusrbrown', name: 'b', discovery_channel: 'collab'}),
      makeEntry({owner: 'fro-bot', name: 'agent', discovery_channel: 'owned'}),
    ]
    const accessList = entries.map(e => makeAccess({owner: e.owner, name: e.name, node_id: `R_${e.name}`}))
    const channelMap = new Map<string, DiscoveryChannel>(
      entries.map(e => [`${e.owner}/${e.name}`, e.discovery_channel ?? 'collab']),
    )
    const fieldProbes = new Map(
      entries.map(e => [
        `${e.owner}/${e.name}`,
        {has_fro_bot_workflow: e.has_fro_bot_workflow, has_renovate: e.has_renovate},
      ]),
    )

    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: entries},
        accessList,
        accessChannelByKey: channelMap,
        fieldProbes,
      }),
    )

    expect(result.summary.byChannel.collab.tracked).toBe(2)
    expect(result.summary.byChannel.owned.tracked).toBe(1)
    expect(result.summary.byChannel.contrib.tracked).toBe(0)
  })

  it('counts lost-access transitions per channel', () => {
    // GIVEN one onboarded contrib entry that is no longer in the access list
    const lost = makeEntry({
      owner: 'bfra-me',
      name: 'gone-repo',
      onboarding_status: 'onboarded',
      discovery_channel: 'contrib',
    })

    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [lost]},
        accessList: [],
        perRepoStatus: new Map([['bfra-me/gone-repo', {status: 'archived'}]]),
      }),
    )

    expect(result.summary.byChannel.contrib.lostAccess).toBe(1)
    expect(result.summary.byChannel.collab.lostAccess).toBe(0)
    expect(result.summary.byChannel.owned.lostAccess).toBe(0)
  })

  it('counts newcomers per channel (added entries inherit channel from accessChannelByKey)', () => {
    const channelMap = new Map<string, DiscoveryChannel>([
      ['fro-bot/agent', 'owned'],
      ['bfra-me/works', 'contrib'],
    ])
    const result = reconcileRepos(
      makeInput({
        accessList: [
          makeAccess({owner: 'fro-bot', name: 'agent', node_id: 'R_a'}),
          makeAccess({owner: 'bfra-me', name: 'works', node_id: 'R_w'}),
        ],
        accessChannelByKey: channelMap,
      }),
    )

    expect(result.summary.byChannel.owned.tracked).toBe(1)
    expect(result.summary.byChannel.contrib.tracked).toBe(1)
    expect(result.summary.byChannel.collab.tracked).toBe(0)
  })
})
