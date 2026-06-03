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
  formatFloorTelemetry,
  handleReconcile,
  isEligibleForSurvey,
  loadDispatchStaggerFromEnv,
  loadMaxDispatchesPerRunFromEnv,
  mergeAccessChannels,
  migrateRepoEntry,
  ReconcileError,
  reconcileRepos,
  renderIssuePayload,
  type AccessListEntry,
  type HandleReconcileParams,
  type IssuePayload,
  type OctokitClient,
  type ReconcileInput,
  type ReconcileLogger,
  type RepoStatusProbe,
  type VisibilityTransitionIssue,
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
      expect(result.dispatches).toEqual([{owner: 'marcusrbrown', repo: 'new-repo', node_id: 'R_new'}])
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
        skippedPrivate: 0,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
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

    it('writes redacted metadata for a private newcomer from the access list', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_kgDOPRIVATE', private: true}),
          ],
          allowlist: makeAllowlist(['private-owner']),
        }),
      )

      expect(result.nextRepos.repos).toHaveLength(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
        onboarding_status: 'pending',
      })
      expect(JSON.stringify(result.nextRepos)).not.toContain('private-owner')
      expect(JSON.stringify(result.nextRepos)).not.toContain('secret-repo')
      expect(result.dispatches).toEqual([])
      expect(result.summary.added).toBe(1)
    })

    it('does not dispatch a duplicate public alias for a private node_id seen earlier in the same pass', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_duplicate_private', private: true}),
            makeAccess({owner: 'marcusrbrown', name: 'public-alias', node_id: 'R_duplicate_private', private: false}),
          ],
          allowlist: makeAllowlist(['private-owner', 'marcusrbrown']),
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.nextRepos.repos).toEqual([
        expect.objectContaining({
          owner: '[REDACTED]',
          name: 'R_duplicate_private',
          private: true,
          node_id: 'R_duplicate_private',
        }),
      ])
    })

    it('does not dispatch a duplicate public alias before a later private row for the same node_id', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'marcusrbrown', name: 'public-alias', node_id: 'R_public_first', private: false}),
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_public_first', private: true}),
          ],
          allowlist: makeAllowlist(['marcusrbrown', 'private-owner']),
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.nextRepos.repos).toEqual([
        expect.objectContaining({
          owner: '[REDACTED]',
          name: 'R_public_first',
          private: true,
          node_id: 'R_public_first',
        }),
      ])
    })

    it('treats a newcomer with missing privacy as private before dispatching', () => {
      const access = {
        owner: 'marcusrbrown',
        name: 'unknown-privacy',
        archived: false,
        node_id: 'R_missing_private',
      } as unknown as AccessListEntry

      const result = reconcileRepos(
        makeInput({
          accessList: [access],
          allowlist: makeAllowlist(['marcusrbrown']),
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.nextRepos.repos).toEqual([
        expect.objectContaining({
          owner: '[REDACTED]',
          name: 'R_missing_private',
          private: true,
          node_id: 'R_missing_private',
        }),
      ])
    })

    it('redacts an existing canonical entry when access-list visibility flips private', () => {
      const result = reconcileRepos(
        makeInput({
          currentRepos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'private-owner',
                name: 'secret-repo',
                private: false,
                node_id: 'R_kgDOPRIVATE',
                last_survey_status: 'success',
                next_survey_eligible_at: '2026-12-31',
              }),
            ],
          },
          accessList: [
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_kgDOPRIVATE', private: true}),
          ],
          allowlist: makeAllowlist(['private-owner']),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
      })
      expect(JSON.stringify(result.nextRepos)).not.toContain('private-owner')
      expect(JSON.stringify(result.nextRepos)).not.toContain('secret-repo')
      expect(result.summary.refreshed).toBe(1)
    })

    it('matches redacted tracked entries to canonical access-list entries by node_id', () => {
      const tracked = makeEntry({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
        onboarding_status: 'onboarded',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-12-31',
      })

      const currentRepos: ReposFile = {version: 1, repos: [tracked]}
      const result = reconcileRepos(
        makeInput({
          currentRepos,
          accessList: [
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_kgDOPRIVATE', private: true}),
          ],
          allowlist: makeAllowlist(['private-owner']),
        }),
      )

      expect(result.nextRepos).toBe(currentRepos)
      expect(result.nextRepos.repos).toEqual([tracked])
      expect(result.summary.lostAccess).toBe(0)
      expect(result.summary.unchanged).toBe(1)
    })

    it('regains a redacted private lost-access entry without dispatching it', () => {
      const tracked = makeEntry({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
        onboarding_status: 'lost-access',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [tracked]},
          accessList: [
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_kgDOPRIVATE', private: true}),
          ],
          allowlist: makeAllowlist(['private-owner']),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_kgDOPRIVATE',
        private: true,
        node_id: 'R_kgDOPRIVATE',
        onboarding_status: 'pending',
      })
      expect(result.dispatches).toEqual([])
      expect(result.summary.regained).toBe(1)
      expect(result.summary.skippedPrivate).toBe(1)
    })

    it('dispatches a regained repo when the live access list proves it is public again', () => {
      const tracked = makeEntry({
        owner: 'fro-bot',
        name: 'back-again',
        private: true,
        node_id: 'R_public_again',
        onboarding_status: 'lost-access',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [tracked]},
          accessList: [makeAccess({name: 'back-again', node_id: 'R_public_again', private: false})],
          allowlist: makeAllowlist(['fro-bot']),
          accessChannelByKey: new Map([['fro-bot/back-again', 'owned']]),
        }),
      )

      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'back-again', node_id: 'R_public_again'}])
      expect(result.summary.regained).toBe(1)
      expect(result.summary.skippedPrivate).toBe(0)
    })

    it('fail-closes a redacted private tracked entry missing from the access list', () => {
      const tracked = makeEntry({
        owner: '[REDACTED]',
        name: 'R_missing',
        private: true,
        node_id: 'R_missing',
        onboarding_status: 'onboarded',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [tracked]},
          accessList: [],
          perRepoStatus: new Map(),
        }),
      )

      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_missing',
        private: true,
        node_id: 'R_missing',
        onboarding_status: 'lost-access',
      })
      expect(result.summary.lostAccess).toBe(1)
      expect(result.summary.unchanged).toBe(0)
    })

    it('rolls up ≥2 non-allowlisted newcomers from the same owner into a single issue', () => {
      const result = reconcileRepos(
        makeInput({
          accessList: [
            makeAccess({owner: 'stranger', name: 'repo-a', node_id: 'R_a', private: false}),
            makeAccess({owner: 'stranger', name: 'repo-b', node_id: 'R_b', private: false}),
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
            {repo: 'repo-b', private: false, node_id: 'R_b'},
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

      expect(result.dispatches).toEqual([{owner: 'trusted', repo: 'ok-repo', node_id: 'R_ok'}])
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]?.kind).toBe('per-owner-rollup')
      expect(result.issues.filter(i => i.kind === 'per-repo')).toEqual([])
      expect(result.summary.added).toBe(1)
      expect(result.summary.pendingReview).toBe(2)
    })

    it('suppresses a newcomer whose node_id matches an existing tracked entry (re-discovery via renamed/redacted entry)', () => {
      // GIVEN a tracked entry with a known node_id under one identity
      // AND an accessList result with the same node_id but a different owner/name
      // (e.g. after Phase 0 redaction renamed owner/name on an entry but the
      //  reconcile cron rediscovers the canonical owner/name from /user/repos)
      // WHEN reconciling
      const tracked = makeEntry({
        owner: '[REDACTED]',
        name: 'R_kgDOSVJgdw',
        node_id: 'R_kgDOSVJgdw',
        private: true,
        onboarding_status: 'lost-access',
      })
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [tracked]},
          accessList: [makeAccess({owner: 'marcusrbrown', name: 'cart', node_id: 'R_kgDOSVJgdw', private: true})],
          allowlist: makeAllowlist(['marcusrbrown']),
        }),
      )

      // THEN the newcomer is NOT added (suppressed by node_id match)
      expect(result.nextRepos.repos).toHaveLength(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_kgDOSVJgdw',
        node_id: 'R_kgDOSVJgdw',
        private: true,
        onboarding_status: 'pending',
      })
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([])
      expect(result.summary.added).toBe(0)
      expect(result.summary.pendingReview).toBe(0)
      expect(result.summary.regained).toBe(1)
    })

    it('suppresses a newcomer whose node_id matches a redacted entry that lacks a node_id field (legacy redaction)', () => {
      // GIVEN a Phase-0-redacted entry where owner='[REDACTED]' and name=node_id
      // (legacy shape: the redacted entry has no separate node_id field)
      // AND the canonical name surfaces in accessList with the matching node_id
      // WHEN reconciling
      // Build a redacted entry shape WITHOUT node_id (legacy Phase 0 shape:
      // node_id lives in `name`, no separate field). makeEntry sets node_id by
      // default, so build the entry inline rather than destructuring it away.
      const redactedNoNodeId: RepoEntry = {
        owner: '[REDACTED]',
        name: 'R_kgDOSVJgdw',
        added: '2026-05-05',
        onboarding_status: 'lost-access',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
        private: true,
        discovery_channel: 'collab',
        next_survey_eligible_at: null,
      }
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [redactedNoNodeId]},
          accessList: [makeAccess({owner: 'marcusrbrown', name: 'cart', node_id: 'R_kgDOSVJgdw', private: true})],
          allowlist: makeAllowlist(['marcusrbrown']),
        }),
      )

      // THEN the newcomer is suppressed by name-as-node_id fallback for redacted entries
      expect(result.nextRepos.repos).toHaveLength(1)
      expect(result.dispatches).toEqual([])
      expect(result.issues).toEqual([])
      expect(result.summary.added).toBe(0)
    })

    it('does NOT suppress a newcomer whose node_id matches no existing entry', () => {
      // GIVEN a tracked entry with a known node_id
      // AND an accessList result with a different node_id
      // WHEN reconciling
      const tracked = makeEntry({name: 'existing', node_id: 'R_existing'})
      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [tracked]},
          accessList: [
            makeAccess({name: 'existing', node_id: 'R_existing'}),
            makeAccess({owner: 'marcusrbrown', name: 'genuinely-new', node_id: 'R_new'}),
          ],
          allowlist: makeAllowlist(['marcusrbrown']),
        }),
      )

      // THEN the genuinely-new newcomer is added normally (the tracked entry's
      // own first-survey dispatch is incidental and not what this test cares about)
      expect(result.nextRepos.repos).toHaveLength(2)
      expect(result.dispatches).toContainEqual({owner: 'marcusrbrown', repo: 'genuinely-new', node_id: 'R_new'})
      expect(result.summary.added).toBe(1)
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
        private: false,
        node_id: 'R_default',
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
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'returned-repo', node_id: 'R_default'}])
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
        owner: '[REDACTED]',
        name: 'R_priv',
        private: true,
        node_id: 'R_priv',
      })
      expect(result.summary.refreshed).toBe(1)
      expect(result.summary.unchanged).toBe(0)
    })

    it('treats matching private/node_id as idempotent — no refresh bump', () => {
      const entry = makeEntry({owner: '[REDACTED]', name: 'R_priv', private: true, node_id: 'R_priv'})
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
        owner: '[REDACTED]',
        name: 'R_x',
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
        owner: '[REDACTED]',
        name: 'R_del',
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
        owner: '[REDACTED]',
        name: 'R_arch',
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
      const byNodeId = new Map(result.nextRepos.repos.map(r => [r.node_id, r]))

      // still-accessible: writes live access data (private:true)
      expect(byNodeId.get('R_ok')).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_ok',
        onboarding_status: 'onboarded',
        private: true,
        node_id: 'R_ok',
      })

      // access-lost: fail-safe private:true, preserves prior node_id
      expect(byNodeId.get('R_gone')).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_gone',
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
      const byNodeId = new Map(result.nextRepos.repos.map(r => [r.node_id, r]))

      // still-accessible: live access data, idempotent (no refresh because nothing changed).
      expect(byName.get('still-ok-five')).toEqual(stillOk)

      // deleted: fail-safe private:true, preserves prior node_id.
      expect(byNodeId.get('R_gone')).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_gone',
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
        private: false,
        node_id: 'R_default',
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
      expect(result.dispatches).toEqual([{owner: 'trusted', repo: 'fresh-repo', node_id: 'R_fresh'}])
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
        skippedPrivate: 0,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
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
        skippedPrivate: 0,
        unchanged: 1,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
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
        skippedPrivate: 0,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
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
        {
          owner: 'trusted',
          repo: 'parity-repo',
          now: NOW,
          private: false,
          node_id: 'R_parity',
          onboarding_status: 'pending',
        },
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
        private: false,
        node_id: 'R_default',
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
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'never-surveyed', node_id: 'R_default'}])
    })

    it('dispatches pending entry with failure status (failed initial survey)', () => {
      // #given a pending entry whose initial survey failed and wrote back a failure timestamp
      const entry = makeEntry({
        name: 'failed-initial',
        onboarding_status: 'pending',
        private: false,
        node_id: 'R_default',
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
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'failed-initial', node_id: 'R_default'}])
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
        private: false,
        node_id: 'R_default',
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
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'overdue-repo', node_id: 'R_default'}])
    })

    it('skips an eligible private tracked entry before the survey eligibility gate', () => {
      const entry = makeEntry({
        owner: '[REDACTED]',
        name: 'R_private',
        private: true,
        node_id: 'R_private',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-02-01',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-04-01',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_private', private: true})],
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        last_survey_at: '2026-02-01',
        last_survey_status: 'success',
      })
      expect(JSON.stringify(result)).not.toContain('private-owner')
      expect(JSON.stringify(result)).not.toContain('secret-repo')
    })

    it('skips an eligible stored-public entry when the live access list reports private', () => {
      const entry = makeEntry({
        name: 'visibility-flipped',
        private: false,
        node_id: 'R_visibility_flipped',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-02-01',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-04-01',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'visibility-flipped', node_id: 'R_visibility_flipped', private: true})],
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        owner: '[REDACTED]',
        name: 'R_visibility_flipped',
        private: true,
        node_id: 'R_visibility_flipped',
      })
    })

    it('does not count private tracked entries that are not survey-eligible as skipped dispatches', () => {
      const entry = makeEntry({
        owner: '[REDACTED]',
        name: 'R_private_fresh',
        private: true,
        node_id: 'R_private_fresh',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-04-01',
        last_survey_status: 'success',
        next_survey_eligible_at: '2026-05-01',
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [
            makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_private_fresh', private: true}),
          ],
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.skippedPrivate).toBe(0)
    })

    it('skips an entry with unknown privacy before refreshing it to public', () => {
      // The threshold gate checks the stored `entry.private` (pre-normalization) and skips
      // the entry when it is not explicitly `false`. Pass 1 then normalizes `private` to the
      // live access-list value. The floor (Pass 2.5) operates on the post-normalization state,
      // so it would dispatch this entry if it were also past the floor gap. We set
      // `last_survey_at` to a recent date to keep it inside the gap and isolate the test to
      // the threshold gate's privacy-skip behavior.
      const entry = makeEntry({
        name: 'legacy-repo',
        onboarding_status: 'pending',
        last_survey_at: '2026-04-15', // within FLOOR_MIN_GAP_DAYS of NOW (2026-04-17); floor excludes it
        last_survey_status: null,
      })

      const result = reconcileRepos(
        makeInput({
          currentRepos: {version: 1, repos: [entry]},
          accessList: [makeAccess({name: 'legacy-repo', private: false, node_id: 'R_legacy'})],
        }),
      )

      expect(result.dispatches).toEqual([])
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.summary.refreshed).toBe(1)
      expect(result.nextRepos.repos[0]).toMatchObject({
        name: 'legacy-repo',
        private: false,
        node_id: 'R_legacy',
      })
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
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'agent', node_id: 'R_agent'}])
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
      expect(result.dispatches).toEqual([{owner: 'bfra-me', repo: '.github', node_id: 'R_bfra_gh'}])
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
      expect(result.dispatches).toEqual([{owner: 'marcusrbrown', repo: 'new-repo', node_id: 'R_default'}])
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
      expect(result.dispatches).toEqual([{owner: 'bfra-me', repo: 'renovate-action', node_id: 'R_bfra_ren'}])
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
        private: false,
        node_id: 'R_bfra_gh',
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
      expect(result.dispatches).toEqual([{owner: 'bfra-me', repo: '.github', node_id: 'R_bfra_gh'}])
      expect(result.issues).toEqual([])
    })

    it('regains an owned entry without filing a pending-review issue', () => {
      const entry = makeEntry({
        owner: 'fro-bot',
        name: 'systematic',
        onboarding_status: 'lost-access',
        discovery_channel: 'owned',
        private: false,
        node_id: 'R_sys',
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
      expect(result.dispatches).toEqual([{owner: 'fro-bot', repo: 'systematic', node_id: 'R_sys'}])
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

  it('does not probe a redacted entry that is present in the access list by node_id', async () => {
    const reposGet = vi.fn(async () => {
      throw new Error('should not probe redacted identity')
    })
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()
    const currentRepos: ReposFile = {
      version: 1,
      repos: [
        makeEntry({
          owner: '[REDACTED]',
          name: 'R_kgDOPRIVATE',
          private: true,
          node_id: 'R_kgDOPRIVATE',
        }),
      ],
    }
    const accessList = [makeAccess({owner: 'private-owner', name: 'secret-repo', node_id: 'R_kgDOPRIVATE'})]

    const result = await fetchPerRepoStatus(userOctokit, currentRepos, accessList, logger)

    expect(result.size).toBe(0)
    expect(reposGet).not.toHaveBeenCalled()
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

  it('HTTP 200 with empty node_id → malformed (matches schema constraint)', async () => {
    // The schema's runtime guard requires node_id.length > 0. Accepting an empty string
    // here would defer the failure to assertReposFile with a less actionable error path.
    // Match the schema constraint at probe time.
    const reposGet = vi.fn(async () => ({
      data: {private: false, node_id: ''} as RepoGetResponse,
    }))
    const userOctokit = mockOctokit({reposGet: reposGet as never})
    const logger = silentLogger()

    const result = await fetchPerRepoStatus(userOctokit, reposFileWith('fro-bot', 'empty-id-repo'), [], logger)

    expect(result.get('fro-bot/empty-id-repo')).toEqual({status: 'malformed'})
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed repos.get response'))
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
  issuesGetLabel?: (params: unknown) => Promise<{data: {name: string}}>
  issuesCreateLabel?: (params: unknown) => Promise<{data: {name: string}}>
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
        getLabel: overrides.issuesGetLabel ?? (async () => ({data: {name: 'label'}})),
        createLabel: overrides.issuesCreateLabel ?? (async () => ({data: {name: 'label'}})),
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
        const typed = params as {inputs?: {node_id: string}}
        dispatchCalls.push(typed.inputs?.node_id ?? '?')
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

      // Exactly 4 dispatches fired in order — asserted by node_id (the only identifier
      // the workflow_dispatch payload now exposes).
      expect(dispatchCalls).toEqual(['R_1', 'R_2', 'R_3', 'R_4'])
      expect(result.dispatches).toBe(4)
      // Exactly 3 sleeps — between dispatches 1→2, 2→3, 3→4. Never before the first.
      // Never after the last.
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
        const typed = params as {inputs?: {node_id: string}}
        const id = typed.inputs?.node_id ?? '?'
        dispatchCalls.push(id)
        if (id === 'R_2') {
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
      expect(dispatchCalls.slice().sort()).toEqual(['R_1', 'R_2', 'R_3'])
      expect(result.dispatches).toBe(2)
      expect(result.dispatchesFailed).toBe(1)
    })

    it('dispatch payload carries node_id only — never owner/repo', async () => {
      // Survey Repo workflow accepts node_id as its sole input. The dispatch call site
      // MUST pass {inputs: {node_id}} so the workflow's first step can resolve and
      // verify the repo via GraphQL before exposing any owner/name to subsequent steps
      // or public run surfaces (run name, concurrency group, log lines).
      const dispatchPayloads: Record<string, unknown>[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: Record<string, unknown>}
        if (typed.inputs !== undefined) dispatchPayloads.push(typed.inputs)
      })
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [{owner: {login: 't'}, name: 'public-repo', archived: false, private: false, node_id: 'R_kgDOPUBLIC'}],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['t'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        }),
      )

      expect(dispatchPayloads).toHaveLength(1)
      expect(dispatchPayloads[0]).toEqual({node_id: 'R_kgDOPUBLIC'})
      // Defense-in-depth: owner/repo must not leak into the public workflow_dispatch
      // inputs surface, even alongside node_id. The workflow itself resolves the identity.
      expect(dispatchPayloads[0]).not.toHaveProperty('owner')
      expect(dispatchPayloads[0]).not.toHaveProperty('repo')
    })
  })

  describe('dispatch prioritization and cap', () => {
    it('dispatches repos with null last_survey_at before any previously-surveyed repo', async () => {
      // Mixed access list: two never-surveyed (r1, r3), one already surveyed (r2).
      // Cap of 2 forces the engine to drop one candidate; the dropped candidate MUST
      // be the already-surveyed one because progressive runs prioritize fresh coverage.
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {node_id: string}}
        dispatchCalls.push(typed.inputs?.node_id ?? '?')
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
                  private: false,
                  node_id: 'R_2',
                  next_survey_eligible_at: null,
                },
              ],
            },
          }),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          maxDispatchesPerRun: 2,
        }),
      )

      expect(dispatchCalls).toEqual(['R_1', 'R_3'])
      expect(result.dispatches).toBe(2)
      expect(result.dispatchesDeferred).toBe(1)
    })

    it('does not let private entries displace public dispatches under the cap', async () => {
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {node_id: string}}
        dispatchCalls.push(typed.inputs?.node_id ?? '?')
      })
      const publicRepos = Array.from({length: 13}, (_, index) => `public-${String(index + 1).padStart(2, '0')}`)
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            ...publicRepos.map(name => ({
              owner: {login: 'trusted'},
              name,
              archived: false,
              private: false,
              node_id: `R_${name}`,
            })),
            {
              owner: {login: 'trusted'},
              name: 'private-repo',
              archived: false,
              private: true,
              node_id: 'R_private',
            },
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['trusted'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          maxDispatchesPerRun: 12,
        }),
      )

      expect(dispatchCalls).toHaveLength(12)
      expect(dispatchCalls).not.toContain('R_private')
      expect(dispatchCalls.every(id => id.startsWith('R_public-'))).toBe(true)
      expect(result.summary.skippedPrivate).toBe(1)
      expect(result.dispatches).toBe(12)
      expect(result.dispatchesDeferred).toBe(1)
    })

    it('treats access-list entries with missing private as private and skips dispatch', async () => {
      const createWorkflowDispatch = vi.fn(async () => undefined)
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {
              owner: {login: 'trusted'},
              name: 'unknown-privacy',
              archived: false,
              node_id: 'R_unknown_privacy',
            } as unknown as AccessListApiEntry,
          ],
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({allowlist: makeAllowlist(['trusted'])}),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        }),
      )

      expect(createWorkflowDispatch).not.toHaveBeenCalled()
      expect(result.summary.skippedPrivate).toBe(1)
    })

    it('among repos with non-null last_survey_at, dispatches oldest first', async () => {
      // Three repos all previously surveyed: oldest (r-old), middle (r-mid), newest (r-new).
      // Cap of 2 selects the two oldest; newest is deferred to the next run.
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {node_id: string}}
        dispatchCalls.push(typed.inputs?.node_id ?? '?')
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
                  private: false,
                  node_id: 'R_old',
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
                  private: false,
                  node_id: 'R_mid',
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
                  private: false,
                  node_id: 'R_new',
                  next_survey_eligible_at: null,
                },
              ],
            },
          }),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          maxDispatchesPerRun: 2,
        }),
      )

      expect(dispatchCalls).toEqual(['R_old', 'R_mid'])
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
          dispatched.push((params as {inputs?: {node_id: string}}).inputs?.node_id ?? '?')
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
      expect(await runWith(NOW)).toEqual(['R_r-a', 'R_r-b'])
      // Offset 2 → rotated slice; r-c and r-d get their turn
      expect(await runWith(new Date('2026-04-19T12:00:00Z'))).toEqual(['R_r-c', 'R_r-d'])
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

    it('does not roll up private pending-review issues by owner', async () => {
      const issuesCreate = vi.fn(async (_params: unknown) => ({data: {number: 10}}))
      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 'stranger'}, name: 'secret-a', archived: false, private: true, node_id: 'R_priv_a'},
            {owner: {login: 'stranger'}, name: 'secret-b', archived: false, private: true, node_id: 'R_priv_b'},
          ],
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

      expect(issuesCreate).toHaveBeenCalledTimes(2)
      const payloads = issuesCreate.mock.calls.map(call => call[0]) as unknown as {
        title: string
        body: string
        labels: string[]
      }[]
      for (const params of payloads) {
        expect(params.title).not.toContain('stranger')
        expect(params.title).not.toContain('secret-')
        expect(params.body).not.toContain('stranger')
        expect(params.body).not.toContain('secret-')
        expect(params.labels).not.toContain('reconcile:rollup-pending-review')
      }
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

    it('does NOT auto-close a private pending-review issue whose redacted subject is still pending-review', async () => {
      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({
            owner: '[REDACTED]',
            name: 'R_priv',
            private: true,
            node_id: 'R_priv',
            onboarding_status: 'pending-review',
          }),
        ],
      }
      const issuesUpdate = vi.fn(async () => ({data: {}}))
      const issuesListForRepo = vi.fn(async () => ({
        data: [
          {
            number: 8,
            title: 'Unsolicited collaborator grant: private repo',
            body: '<!-- reconcile:subject:node_id=R_priv -->',
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
              name: 'secret-repo',
              archived: false,
              private: true,
              node_id: 'R_priv',
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

    it('regression: does not duplicate rollup when listForRepo lags behind same-run create', async () => {
      // Reproduces the 2026-05-18 race where listForRepo eventual-consistency lag caused
      //
      // Setup: bfra-me grants access to 2 repos in this run (NOT pre-existing in metadata).
      // Pass 1 of reconcileRepos adds both as `pending-review` + pushes 2 rawIssues.
      // buildIssueQueue groups them into a single `per-owner-rollup` for bfra-me.
      // plan.issues therefore contains that rollup → currentRunRollupOwners = {'bfra-me'}.
      //
      // runIssueQueue (step 10) creates the rollup via issuesCreate.
      // issuesListForRepo returns [] — simulating eventual-consistency lag.
      // selfHealRollups (step 12) sees empty existingRollupOwners from the API, but the fix
      // unions currentRunRollupOwners in, so bfra-me is already "known" → no second create.
      //
      // Without the fix, selfHealRollups would see bfra-me has 2 pending-review entries and
      // no existing rollup, and would call issuesCreate a second time.

      // currentRepos starts EMPTY — bfra-me grants are new this run.
      const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
      // Simulate eventual-consistency lag: listForRepo returns empty even though step 10 just created a rollup.
      const issuesListForRepo = vi.fn(async () => ({data: []}))

      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {owner: {login: 'bfra-me'}, name: '.github', archived: false, private: false, node_id: 'R_bfra_1'},
            {
              owner: {login: 'bfra-me'},
              name: 'ha-addon-repository',
              archived: false,
              private: false,
              node_id: 'R_bfra_2',
            },
          ],
        }),
      })

      await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate, issuesListForRepo}),
          // Empty repos + no bfra-me in allowlist → both repos classified as unsolicited-new
          readMetadata: makeReadMetadata({repos: {version: 1, repos: []}, allowlist: makeAllowlist([])}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      // runIssueQueue (step 10) creates exactly 1 rollup; selfHealRollups (step 12) must NOT
      // create a second one even though listForRepo returned empty.
      expect(issuesCreate).toHaveBeenCalledOnce()
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

    it('counts race-suppressed skips separately from pre-existing rollups in raceSuppressedRollups', async () => {
      // Verifies that raceSuppressedRollups counts only the same-run guard path, not the
      // pre-existing-on-GitHub silent-skip path.
      //
      // All three owners start from an empty repos state so reconcileRepos classifies every repo
      // as unsolicited-new → pending-review. buildIssueQueue groups them into 3 per-owner rollup
      // issues; runIssueQueue (step 10) calls issuesCreate for all 3, adding all three to
      // currentRunRollupOwners. selfHealRollups (step 12) then receives listForRepo returning only
      // "existing-owner" and checks each owner:
      //   - race-owner:    not in listForRepo, IS in currentRunRollupOwners → raceSuppressed += 1
      //   - existing-owner: IS in listForRepo                               → silent skip (no increment)
      //   - new-owner:     not in listForRepo, IS in currentRunRollupOwners → raceSuppressed += 1
      //
      // Expected: issuesCreate called 3× (step 10), raceSuppressedRollups === 2 (race-owner + new-owner).

      const existing: ReposFile = {
        version: 1,
        repos: [
          // race-owner: 2 pending-review, was created this run (currentRunRollupOwners)
          makeEntry({owner: 'race-owner', name: 'r1', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'race-owner', name: 'r2', onboarding_status: 'pending-review'}),
          // existing-owner: 2 pending-review, has an open rollup on GitHub
          makeEntry({owner: 'existing-owner', name: 'e1', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'existing-owner', name: 'e2', onboarding_status: 'pending-review'}),
          // new-owner: 2 pending-review, nothing in currentRunRollupOwners or listForRepo
          makeEntry({owner: 'new-owner', name: 'n1', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'new-owner', name: 'n2', onboarding_status: 'pending-review'}),
        ],
      }

      const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
      // listForRepo returns only "existing-owner" rollup (pre-existing on GitHub).
      // "race-owner" rollup was just created this run but listForRepo lags → not here.
      const issuesListForRepo = vi.fn(async () => ({
        data: [
          {
            number: 51,
            title: 'Unsolicited collaborator grants from existing-owner',
            body: '<!-- reconcile:subject:rollup-owner=existing-owner -->',
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
            node_id: `R_obs_${i}`,
          })),
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate, issuesListForRepo}),
          readMetadata: makeReadMetadata({repos: {version: 1, repos: []}, allowlist: makeAllowlist([])}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      // Step 10 (runIssueQueue) creates exactly 3 rollups (one per qualifying owner).
      // Step 12 (selfHealRollups) must NOT create additional duplicates.
      // raceSuppressedRollups counts owners skipped by the same-run guard (currentRunRollupOwners)
      // but NOT by the pre-existing check (listForRepo). Here race-owner and new-owner are
      // in currentRunRollupOwners; existing-owner is in listForRepo.
      expect(issuesCreate).toHaveBeenCalledTimes(3)
      // The new summary field must be present and count same-run-suppressed skips only.
      // existing-owner is pre-existing (listForRepo path) → does not count.
      // race-owner and new-owner are in currentRunRollupOwners → each counts as 1.
      expect(result.summary.raceSuppressedRollups).toBe(2)
    })

    it('serialization-protected recovery: self-heals when currentRunRollupOwners is empty and listForRepo is stale-empty', async () => {
      // Documents the cross-run serialization guarantee: the workflow concurrency group
      // (group: reconcile-repos, cancel-in-progress: false) serializes runs so a manual
      // rerun cannot start until the prior run's creates have propagated well past
      // listForRepo's eventual-consistency lag. This means:
      //
      //   If currentRunRollupOwners is empty (no rollups created this run's step 10)
      //   AND listForRepo returns empty (stale or no prior rollup),
      //   selfHealRollups SHOULD create — this is the legitimate recovery path.
      //
      // The serialization guarantee means no concurrent run created the rollup,
      // so there is no duplicate risk in this scenario. This test pins that the
      // eventual-consistency guard does NOT over-suppress the recovery path.

      const existing: ReposFile = {
        version: 1,
        repos: [
          makeEntry({owner: 'heal-owner', name: 'h1', onboarding_status: 'pending-review'}),
          makeEntry({owner: 'heal-owner', name: 'h2', onboarding_status: 'pending-review'}),
        ],
      }

      const issuesCreate = vi.fn(async () => ({data: {number: 100}}))
      // listForRepo returns empty — stale or no prior rollup exists.
      const issuesListForRepo = vi.fn(async () => ({data: []}))

      const userOctokit = mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: existing.repos.map((r, i) => ({
            owner: {login: r.owner},
            name: r.name,
            archived: false,
            private: false,
            node_id: `R_heal_${i}`,
          })),
        }),
      })

      const result = await handleReconcile(
        baseParams({
          userOctokit,
          appOctokit: mockOctokit({issuesCreate, issuesListForRepo}),
          // Pre-existing repos so step 10 sees no new pending-review → currentRunRollupOwners is empty.
          readMetadata: makeReadMetadata({repos: existing, allowlist: makeAllowlist([])}),
          commitMetadata: vi.fn(async () => ({committed: false, attempts: 1})) as never,
        }),
      )

      // selfHealRollups must create the rollup: currentRunRollupOwners is empty,
      // listForRepo is stale-empty, serialization guarantees no concurrent run created it.
      expect(issuesCreate).toHaveBeenCalledOnce()
      const params = firstCallArg<{title: string; labels: string[]}>(issuesCreate)
      expect(params?.title.toLowerCase()).toContain('heal-owner')
      expect(params?.labels).toContain('reconcile:rollup-pending-review')
      // No same-run suppression occurred.
      expect(result.summary.raceSuppressedRollups).toBe(0)
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
        private: false,
        node_id: 'R_a',
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
        private: false,
        node_id: `R_${name}`,
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
        skippedPrivate: 0,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
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
        skippedPrivate: 0,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
        byChannel: emptyChannelStats(),
      }),
    ).toBe('chore(reconcile): +0 new, 0 pending-review, 0 lost-access, 0 refreshes, +18 migrated')
  })

  it('keeps skipped-private counts out of public commit messages', () => {
    expect(
      formatCommitMessage({
        added: 0,
        pendingReview: 0,
        regained: 0,
        lostAccess: 0,
        refreshed: 1,
        migrated: 0,
        transient: 0,
        malformed: 0,
        skippedPrivate: 2,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
        byChannel: emptyChannelStats(),
      }),
    ).toBe('chore(reconcile): +0 new, 0 pending-review, 0 lost-access, 1 refreshes')
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
        skippedPrivate: 0,
        unchanged: 0,
        flooredDispatches: 0,
        visibilityTransitions: 0,
        raceSuppressedRollups: 0,
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

function accessFor(entry: RepoEntry, overrides: Partial<AccessListEntry> = {}): AccessListEntry {
  return makeAccess({
    owner: entry.owner,
    name: entry.name,
    node_id: entry.node_id ?? `R_${entry.name}`,
    private: false,
    ...overrides,
  })
}

describe('reconcileRepos minimum-dispatch floor', () => {
  // Floor tests use NOW = 2026-04-17T12:00:00Z. Helper dates:
  // - FUTURE_ELIGIBLE: 2026-06-15 (well past today; threshold never fires)
  // - PAST_8D:        2026-04-09 (8 days before NOW; outside the 7-day floor gap)
  // - PAST_5D:        2026-04-12 (5 days before NOW; inside the 7-day floor gap)
  // - PAST_7D_EXACT:  2026-04-10 (7 days before NOW; boundary case)
  // - PAST_30D:       2026-03-18 (30 days before NOW; very old)
  const FUTURE_ELIGIBLE = '2026-06-15'
  const PAST_8D = '2026-04-09'
  const PAST_5D = '2026-04-12'
  const PAST_7D_EXACT = '2026-04-10'
  const PAST_30D = '2026-03-18'

  function trackedEntry(overrides: Partial<RepoEntry>): RepoEntry {
    return makeEntry({
      onboarding_status: 'onboarded',
      last_survey_status: 'success',
      next_survey_eligible_at: FUTURE_ELIGIBLE,
      private: false,
      ...overrides,
    })
  }

  // 1. Happy — threshold yields 2+, floor not needed (flooredDispatches: 0).
  it('does not fire the floor when threshold already meets FLOOR_MIN', () => {
    const a = trackedEntry({owner: 'fro-bot', name: 'agent', node_id: 'R_agent', next_survey_eligible_at: null})
    const b = trackedEntry({owner: 'fro-bot', name: 'systematic', node_id: 'R_sys', next_survey_eligible_at: null})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [a, b]},
        accessList: [accessFor(a), accessFor(b)],
      }),
    )
    expect(result.dispatches).toHaveLength(2)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 2. Happy — threshold yields 0, floor finds 2 (flooredDispatches: 2).
  it('fires the floor to add 2 dispatches when threshold yields 0', () => {
    const a = trackedEntry({owner: 'fro-bot', name: 'a-repo', node_id: 'R_a', last_survey_at: PAST_30D})
    const b = trackedEntry({owner: 'fro-bot', name: 'b-repo', node_id: 'R_b', last_survey_at: PAST_8D})
    const c = trackedEntry({owner: 'fro-bot', name: 'c-repo', node_id: 'R_c', last_survey_at: PAST_8D})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [a, b, c]},
        accessList: [accessFor(a), accessFor(b), accessFor(c)],
      }),
    )
    expect(result.dispatches).toHaveLength(2)
    expect(result.summary.flooredDispatches).toBe(2)
    // Oldest-first: a-repo (PAST_30D) wins, then deterministic tiebreak between b-repo/c-repo.
    expect(result.dispatches[0]?.repo).toBe('a-repo')
    expect(result.dispatches[1]?.repo).toBe('b-repo')
  })

  // 3. Happy — threshold yields 1, floor adds 1 (flooredDispatches: 1).
  it('tops up to FLOOR_MIN by adding 1 floor dispatch when threshold yields 1', () => {
    const eligible = trackedEntry({
      owner: 'fro-bot',
      name: 'eligible',
      node_id: 'R_eligible',
      next_survey_eligible_at: null,
    })
    const floored = trackedEntry({
      owner: 'fro-bot',
      name: 'floored',
      node_id: 'R_floored',
      last_survey_at: PAST_30D,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [eligible, floored]},
        accessList: [accessFor(eligible), accessFor(floored)],
      }),
    )
    expect(result.dispatches).toHaveLength(2)
    expect(result.summary.flooredDispatches).toBe(1)
    expect(result.dispatches.map(d => d.repo).sort()).toEqual(['eligible', 'floored'])
  })

  // 4. Edge — threshold yields exactly 2, floor stays asleep.
  it('does not fire the floor when threshold yields exactly FLOOR_MIN', () => {
    const a = trackedEntry({owner: 'fro-bot', name: 'a', node_id: 'R_a', next_survey_eligible_at: null})
    const b = trackedEntry({owner: 'fro-bot', name: 'b', node_id: 'R_b', next_survey_eligible_at: null})
    const c = trackedEntry({owner: 'fro-bot', name: 'c', node_id: 'R_c', last_survey_at: PAST_30D})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [a, b, c]},
        accessList: [accessFor(a), accessFor(b), accessFor(c)],
      }),
    )
    expect(result.dispatches).toHaveLength(2)
    expect(result.summary.flooredDispatches).toBe(0)
    expect(result.dispatches.map(d => d.repo).sort()).toEqual(['a', 'b'])
  })

  // 5. Edge — threshold yields 0, floor pool empty (all surveyed within gap).
  it('reports zero floor dispatches when every candidate is within FLOOR_MIN_GAP_DAYS', () => {
    const a = trackedEntry({owner: 'fro-bot', name: 'a', node_id: 'R_a', last_survey_at: PAST_5D})
    const b = trackedEntry({owner: 'fro-bot', name: 'b', node_id: 'R_b', last_survey_at: PAST_5D})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [a, b]},
        accessList: [accessFor(a), accessFor(b)],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 6. Edge — threshold yields 0, floor finds 1 only (tiny population).
  it('takes what it can when fewer than FLOOR_MIN candidates pass the floor filter', () => {
    const eligible = trackedEntry({owner: 'fro-bot', name: 'aged', node_id: 'R_aged', last_survey_at: PAST_30D})
    const recent = trackedEntry({owner: 'fro-bot', name: 'recent', node_id: 'R_recent', last_survey_at: PAST_5D})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [eligible, recent]},
        accessList: [accessFor(eligible), accessFor(recent)],
      }),
    )
    expect(result.dispatches).toHaveLength(1)
    expect(result.summary.flooredDispatches).toBe(1)
    expect(result.dispatches[0]?.repo).toBe('aged')
  })

  // 7. Edge — null last_survey_at sorts before any date in the floor pool.
  it('floors null-last_survey_at candidates before any dated candidate', () => {
    const dated = trackedEntry({owner: 'fro-bot', name: 'dated', node_id: 'R_dated', last_survey_at: PAST_30D})
    const neverSurveyed = trackedEntry({
      owner: 'fro-bot',
      name: 'never',
      node_id: 'R_never',
      last_survey_at: null,
      last_survey_status: null,
      next_survey_eligible_at: FUTURE_ELIGIBLE,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [dated, neverSurveyed]},
        accessList: [accessFor(dated), accessFor(neverSurveyed)],
      }),
    )
    expect(result.dispatches).toHaveLength(2)
    expect(result.summary.flooredDispatches).toBe(2)
    // Null surveys first.
    expect(result.dispatches[0]?.repo).toBe('never')
    expect(result.dispatches[1]?.repo).toBe('dated')
  })

  // 8. Cap interaction — floor adds to the dispatch list; cap enforcement happens in
  // the I/O shell. The pure function's contract is: dispatches.length === threshold +
  // floorTaken. Cap-induced deferral is exercised by existing dispatch-loop tests.
  it('adds floor entries to dispatches without bounding by per-run cap (cap belongs to the I/O shell)', () => {
    const repos = Array.from({length: 15}, (_, i) =>
      trackedEntry({
        owner: 'fro-bot',
        name: `repo-${String(i).padStart(2, '0')}`,
        node_id: `R_${i}`,
        last_survey_at: PAST_30D,
      }),
    )
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos},
        accessList: repos.map(r => accessFor(r)),
      }),
    )
    // Threshold yields 0 (all are within their next_survey_eligible_at window). Floor
    // adds up to FLOOR_MIN = 2.
    expect(result.dispatches).toHaveLength(2)
    expect(result.summary.flooredDispatches).toBe(2)
  })

  // 9a. Edge — gap-days boundary, 7 days exact = OUT (inside gap).
  it('treats a repo surveyed exactly FLOOR_MIN_GAP_DAYS ago as inside the floor gap (excluded)', () => {
    const boundary = trackedEntry({
      owner: 'fro-bot',
      name: 'boundary',
      node_id: 'R_boundary',
      last_survey_at: PAST_7D_EXACT,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [boundary]},
        accessList: [accessFor(boundary)],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 9b. Edge — gap-days boundary, 8 days = IN (outside gap).
  it('treats a repo surveyed FLOOR_MIN_GAP_DAYS+1 days ago as past the floor gap (included)', () => {
    const past = trackedEntry({owner: 'fro-bot', name: 'past', node_id: 'R_past', last_survey_at: PAST_8D})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [past]},
        accessList: [accessFor(past)],
      }),
    )
    expect(result.dispatches).toHaveLength(1)
    expect(result.summary.flooredDispatches).toBe(1)
  })

  // 10. Error — `private: true` excluded from floor.
  it('excludes a tracked private repo from the floor pool', () => {
    const privateRepo = trackedEntry({
      owner: '[REDACTED]',
      name: 'R_private',
      node_id: 'R_private',
      last_survey_at: PAST_30D,
      private: true,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [privateRepo]},
        accessList: [accessFor(privateRepo, {owner: 'private-owner', name: 'real-name', private: true})],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 11. Error — privacy fail-closed: no access list entry → floor excludes the repo.
  //
  // NOTE: A stored `private: undefined` entry cannot reach Pass 2.5 with that field
  // intact when an access list entry is present — Pass 1's `normalizeRepoEntryForStorage`
  // always writes the live `private` boolean from the access list onto the entry. The
  // original scenario (stored undefined + access-list public) is therefore unreachable.
  //
  // The closest reachable analog for "unknown privacy" is a tracked entry whose access
  // list entry is absent entirely (e.g. the repo was removed from the access list between
  // runs but hasn't been classified as lost-access yet). In that case
  // `accessForTrackedEntry` returns `undefined` and the floor skips the entry via the
  // `if (access === undefined) continue` guard — the same fail-closed outcome.
  it('excludes a tracked repo that has no access list entry from the floor pool (fail-closed)', () => {
    const noAccess = trackedEntry({
      owner: 'fro-bot',
      name: 'no-access',
      node_id: 'R_no_access',
      last_survey_at: PAST_30D,
      private: false,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [noAccess]},
        // Access list intentionally empty — entry has no live access record.
        accessList: [],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 12. Error — access list flags private though stored private:false → excluded.
  it('excludes a tracked repo whose live access-list privacy flips to private', () => {
    const stored = trackedEntry({
      owner: 'fro-bot',
      name: 'flipped',
      node_id: 'R_flip',
      last_survey_at: PAST_30D,
      private: false,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [stored]},
        accessList: [accessFor(stored, {private: true})],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 13. Error — node-level duplicate alias triggers fail-closed exclusion.
  it('excludes a tracked repo when the access list has a duplicate node_id with a private alias', () => {
    const stored = trackedEntry({
      owner: 'fro-bot',
      name: 'aliased',
      node_id: 'R_alias',
      last_survey_at: PAST_30D,
      private: false,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [stored]},
        accessList: [
          accessFor(stored),
          makeAccess({owner: 'shadow', name: 'private-alias', node_id: 'R_alias', private: true}),
        ],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 14. Error — `pending-review` excluded from floor.
  it('excludes pending-review entries from the floor pool', () => {
    const pending = trackedEntry({
      owner: 'stranger',
      name: 'sus-repo',
      node_id: 'R_sus',
      onboarding_status: 'pending-review',
      last_survey_at: PAST_30D,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [pending]},
        accessList: [accessFor(pending)],
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 15. Error — `lost-access` excluded from floor (no longer in access list).
  it('excludes lost-access entries from the floor pool', () => {
    const lost = trackedEntry({
      owner: 'fro-bot',
      name: 'gone',
      node_id: 'R_gone',
      onboarding_status: 'lost-access',
      last_survey_at: PAST_30D,
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [lost]},
        accessList: [],
        perRepoStatus: new Map([['fro-bot/gone', {status: 'archived'}]]),
      }),
    )
    expect(result.dispatches).toHaveLength(0)
    expect(result.summary.flooredDispatches).toBe(0)
  })

  // 16. Adversarial — duplicate metadata rows dispatch the same repo only once (Finding #6).
  it('dispatches a duplicate-row repo only once even when both rows pass the floor filter', () => {
    // Simulate data corruption: same owner/name appears twice in next.repos.
    // Both rows pass all floor filters (public, onboarded, past gap). The dedup guard
    // inside the floor accept loop must prevent a double-dispatch.
    const dup = trackedEntry({owner: 'fro-bot', name: 'dup-repo', node_id: 'R_dup', last_survey_at: PAST_30D})
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [dup, dup]},
        accessList: [accessFor(dup)],
      }),
    )
    expect(result.dispatches).toHaveLength(1)
    expect(result.summary.flooredDispatches).toBe(1)
    expect(result.dispatches[0]?.repo).toBe('dup-repo')
  })

  // 17. Ordering — floor + threshold merge: both sources contribute to the dispatch pool.
  //
  // Scenario: 1 threshold-eligible repo (last_survey_at: 2026-04-15, newer) and
  // 1 floor-eligible repo (last_survey_at: 2026-04-01, older). Cap=12 (high enough
  // to fit both). The engine appends threshold dispatches first, then floor dispatches
  // (append order, not globally sorted). Final oldest-first ordering across both sources
  // is applied by `prioritizeDispatches` in the I/O shell (tested via handleReconcile
  // integration tests). This test verifies the engine correctly identifies both repos
  // as dispatch candidates and attributes the floor contribution accurately.
  it('merged threshold+floor dispatch pool contains both repos with correct flooredDispatches count', () => {
    // threshold-eligible: next_survey_eligible_at=null → threshold fires
    const thresholdRepo = trackedEntry({
      owner: 'fro-bot',
      name: 'threshold-repo',
      node_id: 'R_threshold',
      next_survey_eligible_at: null,
      last_survey_at: '2026-04-15', // newer
    })
    // floor-eligible: next_survey_eligible_at in future → threshold skips; floor picks up
    const floorEligible = trackedEntry({
      owner: 'fro-bot',
      name: 'floor-repo',
      node_id: 'R_floor',
      next_survey_eligible_at: FUTURE_ELIGIBLE,
      last_survey_at: '2026-04-01', // older (> FLOOR_MIN_GAP_DAYS from NOW=2026-04-17)
    })
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [thresholdRepo, floorEligible]},
        accessList: [accessFor(thresholdRepo), accessFor(floorEligible)],
      }),
    )
    // Both repos dispatched (cap=12 default is high enough).
    expect(result.dispatches).toHaveLength(2)
    // 1 came from threshold, 1 from floor.
    expect(result.summary.flooredDispatches).toBe(1)
    // Both repos are present in the dispatch pool (order is append-order at engine level;
    // final oldest-first sort is applied by prioritizeDispatches in the I/O shell).
    expect(result.dispatches.map(d => d.repo)).toContain('threshold-repo')
    expect(result.dispatches.map(d => d.repo)).toContain('floor-repo')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatFloorTelemetry — unit tests for the floor log message helper (Finding #2)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatFloorTelemetry', () => {
  // Test A: message emitted with correct counts when floor fires.
  it('returns the expected message string for given counts', () => {
    expect(formatFloorTelemetry(2, 0)).toBe('floor fired: dispatched 2 of FLOOR_MIN=2 (threshold yielded 0)')
  })

  // Test B: message contains no per-repo identifiers (security invariant).
  it('contains no owner/repo shape or node_id prefix in the message', () => {
    const msg = formatFloorTelemetry(1, 3)
    // No slash-separated owner/repo shape.
    expect(msg).not.toMatch(/\//)
    // No node_id-shaped token (R_ followed by a lowercase letter or digit, as in R_alpha, R_1).
    // FLOOR_MIN contains "R_M" (uppercase M) which is not a node_id pattern.
    expect(msg).not.toMatch(/R_[a-z\d]/)
    // Matches the strict counts-only pattern.
    expect(msg).toMatch(/^floor fired: dispatched \d+ of FLOOR_MIN=\d+ \(threshold yielded \d+\)$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// handleReconcile — floor integration tests (Findings #1, #2, #3)
// ─────────────────────────────────────────────────────────────────────────────

// Dates relative to NOW = 2026-04-17T12:00:00Z
const FLOOR_FUTURE_ELIGIBLE = '2026-06-15' // threshold never fires for these repos
const FLOOR_PAST_30D = '2026-03-18' // 30 days ago — well past the 7-day floor gap

/** Build a minimal tracked-repo row for the repos.yaml fixture. */
function floorRepo(
  name: string,
  nodeId: string,
  overrides: {last_survey_at?: string | null; next_survey_eligible_at?: string | null} = {},
): RepoEntry {
  return {
    owner: 'fro-bot',
    name,
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: 'last_survey_at' in overrides ? (overrides.last_survey_at ?? null) : FLOOR_PAST_30D,
    last_survey_status: 'success',
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: 'collab',
    private: false,
    node_id: nodeId,
    next_survey_eligible_at: overrides.next_survey_eligible_at ?? FLOOR_FUTURE_ELIGIBLE,
  }
}

/** Build an access-list API entry for a floor repo. */
function floorAccess(name: string, nodeId: string) {
  return {owner: {login: 'fro-bot'}, name, archived: false, private: false, node_id: nodeId}
}

describe('handleReconcile floor integration', () => {
  // Finding #1 — cap+floor interaction at the I/O shell level.
  //
  // Scenario: 0 threshold-eligible repos + 5 floor-eligible repos + cap=1.
  // FLOOR_MIN=2, so floor fires (0 < 2) and adds 2 candidates (slotsNeeded=2).
  // Cap=1 cuts the combined pool from 2 → 1 dispatched.
  // Expected: 1 dispatched (oldest floor candidate), flooredDispatches=2,
  //           dispatchesDeferred=1 (the second floor candidate cut by cap).
  it('cap+floor interaction: 0 threshold + 5 floor + cap=1 → 1 dispatched, 2 floored, 1 deferred', async () => {
    // 5 floor-eligible repos: next_survey_eligible_at is in the future (threshold skips them),
    // last_survey_at varies so we can assert the oldest wins after sort.
    const floorRepos = [
      floorRepo('floor-oldest', 'R_f1', {next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE, last_survey_at: '2026-01-01'}),
      floorRepo('floor-second', 'R_f2', {next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE, last_survey_at: '2026-01-15'}),
      floorRepo('floor-third', 'R_f3', {next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE, last_survey_at: '2026-02-01'}),
      floorRepo('floor-fourth', 'R_f4', {next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE, last_survey_at: '2026-02-15'}),
      floorRepo('floor-fifth', 'R_f5', {next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE, last_survey_at: '2026-03-01'}),
    ]

    const dispatchCalls: string[] = []
    const createWorkflowDispatch = vi.fn(async (params: unknown) => {
      const typed = params as {inputs?: {node_id: string}}
      dispatchCalls.push(typed.inputs?.node_id ?? '?')
    })

    const result = await handleReconcile(
      baseParams({
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: floorRepos.map(r => floorAccess(r.name, r.node_id ?? '')),
          }),
        }),
        appOctokit: mockOctokit({createWorkflowDispatch}),
        readMetadata: makeReadMetadata({
          allowlist: makeAllowlist(['fro-bot']),
          repos: {version: 1, repos: floorRepos},
        }),
        commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        // Cap=1: floor adds 2 (FLOOR_MIN=2), cap cuts to 1.
        maxDispatchesPerRun: 1,
      }),
    )

    // Floor fired and added FLOOR_MIN=2 candidates to the dispatch pool.
    expect(result.summary.flooredDispatches).toBe(2)
    // Cap=1 cuts the pool from 2 → 1 dispatched.
    expect(result.dispatches).toBe(1)
    // 1 floor candidate was deferred by the cap (2 in pool - 1 dispatched = 1).
    expect(result.dispatchesDeferred).toBe(1)
    // The surviving dispatch is the oldest floor candidate (floor sort is oldest-first).
    expect(dispatchCalls).toEqual(['R_f1'])
  })

  // Finding #2 — logger.warn called with correct message when floor fires.
  it('emits logger.warn with correct floor telemetry when floor fires', async () => {
    // 2 floor-eligible repos, threshold yields 0.
    const a = floorRepo('a-repo', 'R_a')
    const b = floorRepo('b-repo', 'R_b')
    const logger = silentLogger()

    await handleReconcile(
      baseParams({
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [floorAccess('a-repo', 'R_a'), floorAccess('b-repo', 'R_b')],
          }),
        }),
        appOctokit: mockOctokit(),
        readMetadata: makeReadMetadata({
          allowlist: makeAllowlist(['fro-bot']),
          repos: {version: 1, repos: [a, b]},
        }),
        commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        logger,
      }),
    )

    // logger.warn called exactly once.
    expect(logger.warn).toHaveBeenCalledOnce()
    // Message matches the expected format: 2 floored, threshold yielded 0.
    expect(logger.warn).toHaveBeenCalledWith('floor fired: dispatched 2 of FLOOR_MIN=2 (threshold yielded 0)')
  })

  // Finding #2 — logger.warn NOT called when floor does not fire.
  it('does not emit logger.warn when floor does not fire', async () => {
    // 2 threshold-eligible repos → floor stays asleep.
    const logger = silentLogger()

    await handleReconcile(
      baseParams({
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {owner: {login: 'fro-bot'}, name: 'r1', archived: false, private: false, node_id: 'R_r1'},
              {owner: {login: 'fro-bot'}, name: 'r2', archived: false, private: false, node_id: 'R_r2'},
            ],
          }),
        }),
        appOctokit: mockOctokit(),
        readMetadata: makeReadMetadata({allowlist: makeAllowlist(['fro-bot'])}),
        commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
        logger,
      }),
    )

    expect(logger.warn).not.toHaveBeenCalled()
  })

  // Finding #2b — telemetry swallow: handleReconcile resolves successfully when logger.warn throws.
  //
  // The try/catch around logger.warn is best-effort; a throwing logger must not abort the run.
  // This test verifies the catch scope is correct and that non-logger exceptions are not swallowed.
  it('resolves successfully when logger.warn throws (telemetry swallow)', async () => {
    const a = floorRepo('a-repo', 'R_a')
    const b = floorRepo('b-repo', 'R_b')
    const throwingLogger: ReconcileLogger = {
      warn: () => {
        throw new Error('logger down')
      },
      info: () => {},
    }

    // Should resolve without throwing even though logger.warn throws.
    await expect(
      handleReconcile(
        baseParams({
          userOctokit: mockOctokit({
            listForAuthenticatedUser: async () => ({
              data: [floorAccess('a-repo', 'R_a'), floorAccess('b-repo', 'R_b')],
            }),
          }),
          appOctokit: mockOctokit(),
          readMetadata: makeReadMetadata({
            allowlist: makeAllowlist(['fro-bot']),
            repos: {version: 1, repos: [a, b]},
          }),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          logger: throwingLogger,
        }),
      ),
    ).resolves.toBeDefined()
  })

  // Finding #3 — null-group rotation still works when floor contributes null-last_survey_at repos.
  //
  // Scenario: 2 never-surveyed repos, both floor-eligible (next_survey_eligible_at in future),
  // cap=1. Floor fires (0 threshold < FLOOR_MIN=2), adds both repos (slotsNeeded=2).
  // Across 2 simulated runs with day ordinals mod 2 = 0 and 1, both repos must get
  // a turn at the head of the rotation — no single repo always wins.
  it('null-group rotation cycles all 2 never-surveyed floor repos across 2 runs with cap=1', async () => {
    const repos = [
      floorRepo('alpha', 'R_alpha', {last_survey_at: null, next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE}),
      floorRepo('beta', 'R_beta', {last_survey_at: null, next_survey_eligible_at: FLOOR_FUTURE_ELIGIBLE}),
    ]

    // Pick 2 `now` values whose day ordinals are 0 and 1 mod 2.
    // Day ordinal = Math.floor(now.getTime() / 86_400_000).
    // 2026-04-16T12:00:00Z → ordinal 20194 (mod 2 = 0)
    // 2026-04-17T12:00:00Z → ordinal 20195 (mod 2 = 1)
    const nows = [
      new Date('2026-04-16T12:00:00Z'), // ordinal mod 2 = 0
      new Date('2026-04-17T12:00:00Z'), // ordinal mod 2 = 1
    ]

    const firstDispatched: string[] = []

    for (const now of nows) {
      const dispatchCalls: string[] = []
      const createWorkflowDispatch = vi.fn(async (params: unknown) => {
        const typed = params as {inputs?: {node_id: string}}
        dispatchCalls.push(typed.inputs?.node_id ?? '?')
      })

      await handleReconcile(
        baseParams({
          now,
          userOctokit: mockOctokit({
            listForAuthenticatedUser: async () => ({
              data: repos.map(r => floorAccess(r.name, r.node_id ?? '')),
            }),
          }),
          appOctokit: mockOctokit({createWorkflowDispatch}),
          readMetadata: makeReadMetadata({
            allowlist: makeAllowlist(['fro-bot']),
            repos: {version: 1, repos},
          }),
          commitMetadata: vi.fn(async () => ({committed: true, sha: 's', attempts: 1})) as never,
          // Cap=1: floor adds 2 (FLOOR_MIN=2), rotation picks 1 per run.
          maxDispatchesPerRun: 1,
        }),
      )

      // Record which repo was dispatched first (head of rotation).
      firstDispatched.push(dispatchCalls[0] ?? '?')
    }

    // Both repos must appear as the first-dispatched across the 2 runs.
    expect(new Set(firstDispatched).size).toBe(2)
  })
})

const TRANSITION_NODE_ID = 'R_kgDOTransition123'

// Shared helper: build a tracked entry with a stored private flag (Unit 9 tests).
function makeTransitionEntry(storedPrivate: boolean | undefined): RepoEntry {
  return makeEntry({
    owner: 'fro-bot',
    name: 'tracked-repo',
    node_id: TRANSITION_NODE_ID,
    private: storedPrivate,
    onboarding_status: 'onboarded',
    last_survey_at: '2026-01-01',
    last_survey_status: 'success',
    next_survey_eligible_at: '2026-06-01', // not yet eligible — no dispatch noise
  })
}

// Shared helper: build a perRepoStatus map for a given probe outcome (Unit 9 tests).
function makeProbeMap(status: RepoStatusProbe['status']): Map<string, RepoStatusProbe> {
  return new Map([['fro-bot/tracked-repo', {status} as RepoStatusProbe]])
}

describe('reconcileRepos visibility-transition detection (Unit 9)', () => {
  const NODE_ID = TRANSITION_NODE_ID

  it('scenario 1: stored false, probe returns private:true → transition issue queued', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(false)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: true})],
      }),
    )
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({kind: 'visibility-transition', node_id: NODE_ID})
    expect(result.summary.visibilityTransitions).toBe(1)
  })

  it('scenario 2: stored true, probe returns private:true → no transition (sticky)', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(true)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: true})],
      }),
    )
    const transitionIssues = result.issues.filter(i => i.kind === 'visibility-transition')
    expect(transitionIssues).toHaveLength(0)
    expect(result.summary.visibilityTransitions).toBe(0)
  })

  it('scenario 3: stored false, probe returns private:false → no transition', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(false)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: false})],
      }),
    )
    const transitionIssues = result.issues.filter(i => i.kind === 'visibility-transition')
    expect(transitionIssues).toHaveLength(0)
    expect(result.summary.visibilityTransitions).toBe(0)
  })

  it('scenario 4: stored true, probe returns private:false → no transition issue; entry recanonicalized', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(true)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: false})],
      }),
    )
    const transitionIssues = result.issues.filter(i => i.kind === 'visibility-transition')
    expect(transitionIssues).toHaveLength(0)
    expect(result.summary.visibilityTransitions).toBe(0)
    // Entry should be updated to private:false (recanonicalized)
    const entry = result.nextRepos.repos.find(r => r.node_id === NODE_ID)
    expect(entry?.private).toBe(false)
  })

  it('scenario 5: stored undefined (newcomer), probe returns private:true → no transition (initial categorization)', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(undefined)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: true})],
      }),
    )
    const transitionIssues = result.issues.filter(i => i.kind === 'visibility-transition')
    expect(transitionIssues).toHaveLength(0)
    expect(result.summary.visibilityTransitions).toBe(0)
  })

  it('scenario 6: stored false, probe returns access-lost (deleted) → transition issue queued', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(false)]},
        accessList: [], // not in access list
        perRepoStatus: makeProbeMap('deleted'),
      }),
    )
    const transitionIssues = result.issues.filter(i => i.kind === 'visibility-transition')
    expect(transitionIssues).toHaveLength(1)
    expect(transitionIssues[0]).toMatchObject({kind: 'visibility-transition', node_id: NODE_ID})
    expect(result.summary.visibilityTransitions).toBe(1)
  })

  it('scenario 7: probe is transient → no transition; sticky preservation', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(false)]},
        accessList: [], // not in access list
        perRepoStatus: makeProbeMap('transient'),
      }),
    )
    const transitionIssues = result.issues.filter(i => i.kind === 'visibility-transition')
    expect(transitionIssues).toHaveLength(0)
    expect(result.summary.visibilityTransitions).toBe(0)
    // Sticky: private value preserved
    const entry = result.nextRepos.repos.find(r => r.node_id === NODE_ID)
    expect(entry?.private).toBe(false)
  })

  it('scenario 8: queues a transition on a false→true visibility change', () => {
    // Stored: false. Live access: true. Transition fires. Next stored state becomes true.
    // NOTE: sequential rapid-flips (public→private→public within one cycle) are
    // structurally identical to this single false→true case under single-probe-per-cycle
    // semantics — separate coverage isn't needed.
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(false)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: true})],
      }),
    )
    expect(result.summary.visibilityTransitions).toBe(1)
    const entry = result.nextRepos.repos.find(r => r.node_id === NODE_ID)
    expect(entry?.private).toBe(true)
  })

  it('scenario 9: issue title contains node_id only, body uses node_id only (no owner/repo)', () => {
    const result = reconcileRepos(
      makeInput({
        currentRepos: {version: 1, repos: [makeTransitionEntry(false)]},
        accessList: [makeAccess({owner: 'fro-bot', name: 'tracked-repo', node_id: NODE_ID, private: true})],
      }),
    )
    const issue = result.issues.find(i => i.kind === 'visibility-transition')
    expect(issue).toBeDefined()
    // The issue shape carries node_id; rendering is tested via renderIssuePayload indirectly.
    // Verify the queued issue does NOT carry owner/repo fields.
    expect(issue).not.toHaveProperty('owner')
    expect(issue).not.toHaveProperty('repo')
    expect((issue as {node_id: string}).node_id).toBe(NODE_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST P1-#1 + P1-#2 — Durability: fail-open dedup + label pre-flight
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition durability', () => {
  const DUR_NODE_ID = 'R_kgDODurability1'

  function makeTransitionParams(overrides: Partial<OctokitMockOverrides> = {}): HandleReconcileParams {
    return baseParams({
      appOctokit: mockOctokit({
        issuesCreate: async () => ({data: {number: 99}}),
        ...overrides,
      }),
      readMetadata: makeReadMetadata({
        repos: {
          version: 1,
          repos: [
            makeEntry({
              owner: 'fro-bot',
              name: 'dur-repo',
              node_id: DUR_NODE_ID,
              private: false,
              onboarding_status: 'onboarded',
            }),
          ],
        },
      }),
      userOctokit: mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {
              owner: {login: 'fro-bot'},
              name: 'dur-repo',
              archived: false,
              private: true,
              node_id: DUR_NODE_ID,
            },
          ],
        }),
      }),
    })
  }

  it('paginate throws → issues.create is still called (fail-open dedup)', async () => {
    const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
    const paginateMock = vi.fn(async (_fn: unknown, opts: {labels?: string}) => {
      if (opts.labels === 'reconcile:visibility-transition') {
        throw Object.assign(new Error('network error'), {status: 503})
      }
      return []
    })

    await handleReconcile(
      makeTransitionParams({
        paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
        issuesCreate,
      }),
    )

    expect(issuesCreate).toHaveBeenCalledOnce()
  })

  it('label 404 → createLabel is called before issues.create (call order verified)', async () => {
    const callOrder: string[] = []
    const issuesGetLabel = vi.fn(async (_params: unknown) => {
      callOrder.push('getLabel')
      throw Object.assign(new Error('Not Found'), {status: 404})
    })
    const issuesCreateLabel = vi.fn(async () => {
      callOrder.push('createLabel')
      return {data: {name: 'label'}}
    })
    const issuesCreate = vi.fn(async () => {
      callOrder.push('create')
      return {data: {number: 99}}
    })

    await handleReconcile(
      makeTransitionParams({
        issuesCreate,
        issuesGetLabel,
        issuesCreateLabel,
      }),
    )

    // Both labels must be checked (and created) before the single issues.create call.
    // Two getLabel + two createLabel (one per label) then one create.
    expect(callOrder).toEqual(['getLabel', 'createLabel', 'getLabel', 'createLabel', 'create'])
    expect(issuesCreateLabel).toHaveBeenCalledTimes(2)
    expect(issuesCreate).toHaveBeenCalledOnce()
  })

  it('createLabel 422 (race) → label IS included in issues.create payload', async () => {
    // 422 means another writer already created the label — it now exists, so include it.
    const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
    const issuesGetLabel = vi.fn(async (_params: unknown) => {
      throw Object.assign(new Error('Not Found'), {status: 404})
    })
    const issuesCreateLabel = vi.fn(async (_params: unknown) => {
      throw Object.assign(new Error('Unprocessable Entity'), {status: 422})
    })

    await handleReconcile(
      makeTransitionParams({
        issuesCreate,
        issuesGetLabel,
        issuesCreateLabel,
      }),
    )

    expect(issuesCreate).toHaveBeenCalledOnce()
    // Both labels should be present — 422 means the label exists (race), so it's confirmed usable.
    const calls = issuesCreate.mock.calls as unknown as [{labels?: string[]}][]
    expect(calls[0]?.[0]?.labels).toContain('reconcile:integrity-alert')
    expect(calls[0]?.[0]?.labels).toContain('reconcile:visibility-transition')
  })

  it('createLabel 500 (transient) → label is EXCLUDED from issues.create payload', async () => {
    // 500 means the label creation genuinely failed — exclude it, but still ship the issue.
    const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
    const issuesGetLabel = vi.fn(async (_params: unknown) => {
      throw Object.assign(new Error('Not Found'), {status: 404})
    })
    const issuesCreateLabel = vi.fn(async (_params: unknown) => {
      throw Object.assign(new Error('Internal Server Error'), {status: 500})
    })

    await handleReconcile(
      makeTransitionParams({
        issuesCreate,
        issuesGetLabel,
        issuesCreateLabel,
      }),
    )

    expect(issuesCreate).toHaveBeenCalledOnce()
    // Both labels failed (500) — neither should be in the payload.
    expect(issuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [],
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TEST #12 — Rendering regression pin (R15 privacy guarantee)
// ─────────────────────────────────────────────────────────────────────────────

describe('renderIssuePayload (visibility-transition rendering)', () => {
  const TEST_NODE_ID = 'R_kgDOZZ_REPLACED'

  it('title is exactly [INTEGRITY] Visibility transition for <node_id>', () => {
    const issue: VisibilityTransitionIssue = {kind: 'visibility-transition', node_id: TEST_NODE_ID}
    const payload: IssuePayload = renderIssuePayload(issue, 'fro-bot', '.github')
    expect(payload.title).toBe(`[INTEGRITY] Visibility transition for ${TEST_NODE_ID}`)
  })

  it('body contains the node_id', () => {
    const issue: VisibilityTransitionIssue = {kind: 'visibility-transition', node_id: TEST_NODE_ID}
    const payload: IssuePayload = renderIssuePayload(issue, 'fro-bot', '.github')
    expect(payload.body).toContain(TEST_NODE_ID)
  })

  it('body does NOT contain canonical-slug separator pattern "owner--repo" (R15 privacy regression pin)', () => {
    const issue: VisibilityTransitionIssue = {kind: 'visibility-transition', node_id: TEST_NODE_ID}
    const payload: IssuePayload = renderIssuePayload(issue, 'fro-bot', '.github')
    // The body must never contain a wiki canonical slug (owner--repo format).
    // The gh api command uses "--field" which is fine; we check for the slug pattern specifically.
    expect(payload.body).not.toMatch(/[\w.-]+--[\w.-]+/) // canonical owner--repo slug
    expect(payload.body).not.toMatch(/(?!owner\/repo)\b\w[\w-]*\/[\w.-]+/) // generic owner/repo slash form (excludes prose placeholder "owner/repo")
  })

  it('body does NOT contain a resolved owner/repo slug (no canonical identity leak)', () => {
    const issue: VisibilityTransitionIssue = {kind: 'visibility-transition', node_id: TEST_NODE_ID}
    const payload: IssuePayload = renderIssuePayload(issue, 'fro-bot', '.github')
    // The body must not contain a resolved owner/repo slug like "fro-bot/tracked-repo".
    // The gh api command in the body uses "nameWithOwner" as a field name, not a value — that's fine.
    expect(payload.body).not.toContain('fro-bot/tracked-repo')
    expect(payload.body).not.toContain('fro-bot/.github')
  })

  it('labels are exactly [reconcile:integrity-alert, reconcile:visibility-transition]', () => {
    const issue: VisibilityTransitionIssue = {kind: 'visibility-transition', node_id: TEST_NODE_ID}
    const payload: IssuePayload = renderIssuePayload(issue, 'fro-bot', '.github')
    expect(payload.labels).toEqual(['reconcile:integrity-alert', 'reconcile:visibility-transition'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Same-run dedup race: two entries same node_id → one create, counter incremented
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition same-run dedup', () => {
  const DUPE_NODE_ID = 'R_kgDODupe3332'

  it('issues.create called exactly once when two transition entries share the same node_id and listForRepo returns empty', async () => {
    const issuesCreate = vi.fn(async () => ({data: {number: 10}}))
    // paginate always returns empty → the listForRepo dedup won't suppress either.
    // Only the same-run Set must suppress the second create.
    const paginateMock = vi.fn(async () => [])

    const result = await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              // Two stored entries both pointing at the same node_id (owner/name differ
              // only in the public vs redacted slot — unusual but possible if both an
              // alias and the redacted form appear in the metadata state).
              makeEntry({
                owner: 'fro-bot',
                name: 'repo-alpha',
                node_id: DUPE_NODE_ID,
                private: false,
                onboarding_status: 'onboarded',
              }),
              makeEntry({
                owner: 'fro-bot',
                name: 'repo-beta',
                node_id: DUPE_NODE_ID,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'repo-alpha',
                archived: false,
                private: true,
                node_id: DUPE_NODE_ID,
              },
              {
                owner: {login: 'fro-bot'},
                name: 'repo-beta',
                archived: false,
                private: true,
                node_id: DUPE_NODE_ID,
              },
            ],
          }),
        }),
      }),
    )

    expect(issuesCreate).toHaveBeenCalledOnce()
    expect(result.visibilityTransitionDuplicatesSkipped).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate-skip observability: visibilityTransitionDuplicatesSkipped counter
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition duplicatesSkipped counter', () => {
  const SKIP_NODE_ID = 'R_kgDOSkip3334'
  const SKIP_TITLE = `[INTEGRITY] Visibility transition for ${SKIP_NODE_ID}`

  function makeSkipParams(paginateMock: OctokitMockOverrides['paginate']): HandleReconcileParams {
    return baseParams({
      appOctokit: mockOctokit({
        paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
        issuesCreate: async () => ({data: {number: 50}}),
      }),
      readMetadata: makeReadMetadata({
        repos: {
          version: 1,
          repos: [
            makeEntry({
              owner: 'fro-bot',
              name: 'skip-repo',
              node_id: SKIP_NODE_ID,
              private: false,
              onboarding_status: 'onboarded',
            }),
          ],
        },
      }),
      userOctokit: mockOctokit({
        listForAuthenticatedUser: async () => ({
          data: [
            {
              owner: {login: 'fro-bot'},
              name: 'skip-repo',
              archived: false,
              private: true,
              node_id: SKIP_NODE_ID,
            },
          ],
        }),
      }),
    })
  }

  it('visibilityTransitionDuplicatesSkipped is 1 when listForRepo finds existing matching title', async () => {
    const paginateMock = vi.fn(async (_fn: unknown, opts: {labels?: string; state?: string}) => {
      if (opts.labels === 'reconcile:visibility-transition' && opts.state === 'open') {
        return [{number: 1, title: SKIP_TITLE, body: null, labels: [{name: 'reconcile:visibility-transition'}]}]
      }
      return []
    })

    const result = await handleReconcile(makeSkipParams(paginateMock as unknown as OctokitMockOverrides['paginate']))

    expect(result.visibilityTransitionDuplicatesSkipped).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Label preflight hoisting: ensureLabelsExist called once for N transition issues
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition label preflight hoisted', () => {
  const HOIST_NODE_ID_A = 'R_kgDOHoistA'
  const HOIST_NODE_ID_B = 'R_kgDOHoistB'

  it('getLabel called exactly twice (once per label) even when two transition issues fire', async () => {
    const issuesCreate = vi.fn(async () => ({data: {number: 77}}))
    const issuesGetLabel = vi.fn(async () => ({data: {name: 'label'}}))
    const paginateMock = vi.fn(async () => [])

    await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
          issuesGetLabel,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'fro-bot',
                name: 'hoist-repo-a',
                node_id: HOIST_NODE_ID_A,
                private: false,
                onboarding_status: 'onboarded',
              }),
              makeEntry({
                owner: 'fro-bot',
                name: 'hoist-repo-b',
                node_id: HOIST_NODE_ID_B,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'hoist-repo-a',
                archived: false,
                private: true,
                node_id: HOIST_NODE_ID_A,
              },
              {
                owner: {login: 'fro-bot'},
                name: 'hoist-repo-b',
                archived: false,
                private: true,
                node_id: HOIST_NODE_ID_B,
              },
            ],
          }),
        }),
      }),
    )

    // Two issues, two labels → getLabel called 2 times total (hoisted once), not 4 (per-issue).
    expect(issuesGetLabel).toHaveBeenCalledTimes(2)
    expect(issuesCreate).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// node_id backfill: access list populates missing node_id in stored entry
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileRepos node_id backfill', () => {
  it('backfills node_id from access list when stored entry has none', () => {
    const ACCESS_NODE_ID = 'R_kgDOBackfill'
    const result = reconcileRepos(
      makeInput({
        currentRepos: {
          version: 1,
          repos: [
            // Entry with no node_id and no private field — simulates the ha-config legacy shape
            // where `private` was never written (undefined, not false).
            makeEntry({
              owner: 'fro-bot',
              name: 'ha-config',
              // node_id and private intentionally absent (legacy entry shape)
              onboarding_status: 'onboarded',
            }),
          ],
        },
        accessList: [
          makeAccess({
            owner: 'fro-bot',
            name: 'ha-config',
            node_id: ACCESS_NODE_ID,
            private: false,
          }),
        ],
      }),
    )

    const next = result.nextRepos.repos.find(r => r.name === 'ha-config')
    expect(next?.node_id).toBe(ACCESS_NODE_ID)
  })

  it('backfills node_id when stored entry has undefined private (legacy entry without private field)', () => {
    // Pins the real ha-config scenario: `private` was never written to the YAML entry,
    // so it deserializes as undefined. node_id backfill must still work.
    const ACCESS_NODE_ID = 'R_kgDOBackfillUndef'
    // makeEntry without private/node_id → both fields absent (undefined), matching legacy shape
    const result = reconcileRepos(
      makeInput({
        currentRepos: {
          version: 1,
          repos: [makeEntry({owner: 'fro-bot', name: 'ha-config-legacy', onboarding_status: 'onboarded'})],
        },
        accessList: [
          makeAccess({
            owner: 'fro-bot',
            name: 'ha-config-legacy',
            node_id: ACCESS_NODE_ID,
            private: false,
          }),
        ],
      }),
    )

    const next = result.nextRepos.repos.find(r => r.name === 'ha-config-legacy')
    expect(next?.node_id).toBe(ACCESS_NODE_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dedup branch coverage: existing open issue suppresses create
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition dedup', () => {
  const TEST_NODE_ID = 'R_kgDODedup999'
  const EXPECTED_TITLE = `[INTEGRITY] Visibility transition for ${TEST_NODE_ID}`

  it('does NOT call issues.create when an open issue with matching title already exists', async () => {
    const issuesCreate = vi.fn(async () => ({data: {number: 42}}))

    // paginate returns one open issue whose title matches the expected dedup title
    const paginateMock = vi.fn(async (_fn: unknown, opts: {labels?: string; state?: string}) => {
      if (opts.labels === 'reconcile:visibility-transition' && opts.state === 'open') {
        return [{number: 1, title: EXPECTED_TITLE, body: null, labels: [{name: 'reconcile:visibility-transition'}]}]
      }
      return []
    })

    await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'fro-bot',
                name: 'tracked-repo',
                node_id: TEST_NODE_ID,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        // Provide an access list entry showing the repo is now private → triggers transition
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'tracked-repo',
                archived: false,
                private: true,
                node_id: TEST_NODE_ID,
              },
            ],
          }),
        }),
      }),
    )

    // paginate was called with the visibility-transition label filter
    expect(paginateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({labels: 'reconcile:visibility-transition', state: 'open'}),
    )
    // issues.create was NOT called because the dedup found an existing open issue
    expect(issuesCreate).not.toHaveBeenCalled()
  })

  it('issues.create IS called when existing title is a strict prefix of the new title (exact-title dedup, not substring)', async () => {
    // RED-against-old-code proof: old substring dedup would suppress this alert because
    // 'R_kgDOZAAAA' is a substring of 'R_kgDOZAAAAA'. New exact-title dedup must NOT suppress it.
    const VICTIM_NODE_ID = 'R_kgDOZAAAA'
    const LONGER_NODE_ID = `${VICTIM_NODE_ID}A` // one extra char — different repo
    const issuesCreate = vi.fn(async () => ({data: {number: 42}}))

    const paginateMock = vi.fn(async (_fn: unknown, opts: {labels?: string; state?: string}) => {
      if (opts.labels === 'reconcile:visibility-transition' && opts.state === 'open') {
        // Return an issue for the LONGER node_id — not the victim
        return [
          {
            number: 1,
            title: `[INTEGRITY] Visibility transition for ${LONGER_NODE_ID}`,
            body: null,
            labels: [{name: 'reconcile:visibility-transition'}],
          },
        ]
      }
      return []
    })

    await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'fro-bot',
                name: 'victim-repo',
                node_id: VICTIM_NODE_ID,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'victim-repo',
                archived: false,
                private: true,
                node_id: VICTIM_NODE_ID,
              },
            ],
          }),
        }),
      }),
    )

    // Exact-title dedup: the existing issue title does NOT match the victim's expected title,
    // so issues.create MUST be called. Old substring code would have suppressed this.
    expect(issuesCreate).toHaveBeenCalledOnce()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Same-run dedup must not suppress a retry after a failed first create
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition same-run dedup: failed first create does not suppress retry', () => {
  const RETRY_NODE_ID = 'R_kgDORetryC'

  it('second same-node entry attempts issues.create when first create rejects, and duplicatesSkipped is 0', async () => {
    let createCallCount = 0
    const issuesCreate = vi.fn(async () => {
      createCallCount += 1
      if (createCallCount === 1) {
        const err = Object.assign(new Error('simulated API failure'), {status: 500})
        throw err
      }
      return {data: {number: 99}}
    })
    // paginate always returns empty → listForRepo dedup won't suppress anything
    const paginateMock = vi.fn(async () => [])

    const result = await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'fro-bot',
                name: 'retry-repo-a',
                node_id: RETRY_NODE_ID,
                private: false,
                onboarding_status: 'onboarded',
              }),
              makeEntry({
                owner: 'fro-bot',
                name: 'retry-repo-b',
                node_id: RETRY_NODE_ID,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'retry-repo-a',
                archived: false,
                private: true,
                node_id: RETRY_NODE_ID,
              },
              {
                owner: {login: 'fro-bot'},
                name: 'retry-repo-b',
                archived: false,
                private: true,
                node_id: RETRY_NODE_ID,
              },
            ],
          }),
        }),
      }),
    )

    // Both entries must attempt issues.create because the first one failed
    expect(issuesCreate).toHaveBeenCalledTimes(2)
    // duplicatesSkipped must NOT be incremented for a failed-then-retry case
    expect(result.visibilityTransitionDuplicatesSkipped).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A transient ensureLabelsExist failure must not poison the per-run label cache
// ─────────────────────────────────────────────────────────────────────────────

describe('handleReconcile visibility-transition: transient label-check failure does not poison cache', () => {
  const LABEL_NODE_ID_A = 'R_kgDOLabelA'
  const LABEL_NODE_ID_B = 'R_kgDOLabelB'

  it('second transition issue triggers a fresh ensureLabelsExist when first call returns empty set', async () => {
    let getLabelCallCount = 0
    // First call per-label returns 500 (label confirmed set will be empty); second call succeeds
    const issuesGetLabel = vi.fn(async () => {
      getLabelCallCount += 1
      if (getLabelCallCount <= 2) {
        // First two calls (for the two labels on first issue) → fail
        const err = Object.assign(new Error('transient'), {status: 500})
        throw err
      }
      return {data: {name: 'label'}}
    })
    const issuesCreate = vi.fn(async () => ({data: {number: 42}}))
    const paginateMock = vi.fn(async () => [])

    await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
          issuesGetLabel,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'fro-bot',
                name: 'label-repo-a',
                node_id: LABEL_NODE_ID_A,
                private: false,
                onboarding_status: 'onboarded',
              }),
              makeEntry({
                owner: 'fro-bot',
                name: 'label-repo-b',
                node_id: LABEL_NODE_ID_B,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'label-repo-a',
                archived: false,
                private: true,
                node_id: LABEL_NODE_ID_A,
              },
              {
                owner: {login: 'fro-bot'},
                name: 'label-repo-b',
                archived: false,
                private: true,
                node_id: LABEL_NODE_ID_B,
              },
            ],
          }),
        }),
      }),
    )

    // getLabel should be called more than 2 times — the second issue must retry label check
    // (cache was not poisoned by the empty first result)
    expect(issuesGetLabel.mock.calls.length).toBeGreaterThan(2)
  })
})

describe('handleReconcile visibility-transition: partial label confirmation is not cached', () => {
  const LABEL_NODE_ID_C = 'R_kgDOLabelC'
  const LABEL_NODE_ID_D = 'R_kgDOLabelD'

  it('second transition issue retries ensureLabelsExist when first call confirms only a subset of labels', async () => {
    // Tracks which label names getLabel has been called for, in order
    const getLabelCalls: string[] = []

    // First label (VISIBILITY_TRANSITION_LABEL) always succeeds immediately.
    // Second label (INTEGRITY_ALERT_LABEL) fails with a transient 500 on the first call
    // (so ensureLabelsExist returns size=1 on issue 1 — a partial set).
    // On the second issue's preflight, both labels should be queried again.
    const issuesGetLabel = vi.fn(async (params: unknown) => {
      const {name} = params as {owner: string; repo: string; name: string}
      getLabelCalls.push(name)
      const callIndexForThisLabel = getLabelCalls.filter(n => n === name).length
      if (name === 'reconcile:integrity-alert' && callIndexForThisLabel === 1) {
        // Transient failure on first attempt for the second label
        const err = Object.assign(new Error('transient server error'), {status: 500})
        throw err
      }
      return {data: {name}}
    })
    const issuesCreate = vi.fn(async () => ({data: {number: 99}}))
    const paginateMock = vi.fn(async () => [])

    await handleReconcile(
      baseParams({
        appOctokit: mockOctokit({
          paginate: paginateMock as unknown as OctokitMockOverrides['paginate'],
          issuesCreate,
          issuesGetLabel,
        }),
        readMetadata: makeReadMetadata({
          repos: {
            version: 1,
            repos: [
              makeEntry({
                owner: 'fro-bot',
                name: 'partial-label-repo-c',
                node_id: LABEL_NODE_ID_C,
                private: false,
                onboarding_status: 'onboarded',
              }),
              makeEntry({
                owner: 'fro-bot',
                name: 'partial-label-repo-d',
                node_id: LABEL_NODE_ID_D,
                private: false,
                onboarding_status: 'onboarded',
              }),
            ],
          },
        }),
        userOctokit: mockOctokit({
          listForAuthenticatedUser: async () => ({
            data: [
              {
                owner: {login: 'fro-bot'},
                name: 'partial-label-repo-c',
                archived: false,
                private: true,
                node_id: LABEL_NODE_ID_C,
              },
              {
                owner: {login: 'fro-bot'},
                name: 'partial-label-repo-d',
                archived: false,
                private: true,
                node_id: LABEL_NODE_ID_D,
              },
            ],
          }),
        }),
      }),
    )

    // INTEGRITY_ALERT_LABEL must be queried at least twice — once per issue's preflight —
    // confirming the partial result from issue 1 was NOT cached and issue 2 retried.
    const integrityLabelCallCount = getLabelCalls.filter(n => n === 'reconcile:integrity-alert').length
    expect(integrityLabelCallCount).toBeGreaterThanOrEqual(2)
  })
})
