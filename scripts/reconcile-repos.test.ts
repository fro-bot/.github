import {describe, expect, it} from 'vitest'

import {reconcileRepos, type AccessListEntry, type ReconcileInput} from './reconcile-repos.ts'
import {addRepoEntry} from './repos-metadata.ts'
import {assertReposFile, type AllowlistFile, type RepoEntry, type ReposFile} from './schemas.ts'

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
        unchanged: 0,
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
    it('leaves a pending, still-accessible entry unchanged when no field drift', () => {
      const entry = makeEntry({onboarding_status: 'pending', name: 'stable-repo'})
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

  describe('mixed and edge cases', () => {
    it('handles multiple simultaneous changes (new + lost + refresh) in one run', () => {
      const drift = makeEntry({
        name: 'drift-repo',
        onboarding_status: 'onboarded',
        has_renovate: false,
      })
      const gone = makeEntry({name: 'gone-repo', onboarding_status: 'onboarded'})

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
        unchanged: 0,
      })
    })

    it('reports all-zero counters and value-equal nextRepos when nothing changes', () => {
      const entry = makeEntry({name: 'stable-repo', onboarding_status: 'pending'})
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
        unchanged: 1,
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
        unchanged: 0,
      })
    })

    it('merges safely on concurrent-writer retry: entry added between calls is preserved', () => {
      // GIVEN an initial currentRepos@v1 reconciled once
      const entryA = makeEntry({name: 'a-repo', onboarding_status: 'pending'})
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
  })
})
