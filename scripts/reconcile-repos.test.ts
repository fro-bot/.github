import type {CommitMetadataParams, CommitMetadataResult} from './commit-metadata.ts'
import type {AllowlistFile, RepoEntry, ReposFile} from './schemas.ts'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

import {
  DISPATCH_DEFAULTS,
  handleReconcile,
  isSurveyStale,
  loadDispatchStaggerFromEnv,
  loadMaxDispatchesPerRunFromEnv,
  ReconcileError,
  reconcileRepos,
  SURVEY_STALENESS_MS,
  type AccessListEntry,
  type HandleReconcileParams,
  type OctokitClient,
  type ReconcileInput,
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
      // Fresh surveys on both — not stale, so no re-survey dispatch from the staleness gate.
      const drift = makeEntry({
        name: 'drift-repo',
        onboarding_status: 'onboarded',
        has_renovate: false,
        last_survey_at: '2026-04-10',
        last_survey_status: 'success',
      })
      const gone = makeEntry({
        name: 'gone-repo',
        onboarding_status: 'onboarded',
        last_survey_at: '2026-04-10',
        last_survey_status: 'success',
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

function silentLogger(): {warn: ReturnType<typeof vi.fn<(message: string) => void>>} {
  return {warn: vi.fn<(message: string) => void>()}
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
      const existing: ReposFile = {
        version: 1,
        repos: [makeEntry({name: 'stable-repo', onboarding_status: 'pending'})],
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
          // Fresh survey — not stale, so the test isolates the field-probe behavior.
          makeEntry({
            name: 'probe-fail-repo',
            onboarding_status: 'onboarded',
            has_fro_bot_workflow: true,
            has_renovate: true,
            last_survey_at: '2026-04-10',
            last_survey_status: 'success',
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

      expect(dispatchCalls).toEqual(['r1', 'r2', 'r3'])
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
})

describe('isSurveyStale', () => {
  const JUST_BEFORE = SURVEY_STALENESS_MS - 1
  const EXACTLY = SURVEY_STALENESS_MS
  const JUST_AFTER = SURVEY_STALENESS_MS + 1

  it('treats null as stale (never surveyed)', () => {
    expect(isSurveyStale(null, new Date('2026-04-17T12:00:00Z'))).toBe(true)
  })

  it('treats a malformed date string as stale (recoverable corruption)', () => {
    expect(isSurveyStale('not-a-date', new Date('2026-04-17T12:00:00Z'))).toBe(true)
  })

  it('treats exactly 30 days old as stale (inclusive boundary)', () => {
    const anchor = new Date('2026-04-01T00:00:00Z')
    const now = new Date(anchor.getTime() + EXACTLY)
    expect(isSurveyStale('2026-04-01', now)).toBe(true)
  })

  it('treats just under 30 days as fresh', () => {
    const anchor = new Date('2026-04-01T00:00:00Z')
    const now = new Date(anchor.getTime() + JUST_BEFORE)
    expect(isSurveyStale('2026-04-01', now)).toBe(false)
  })

  it('treats just over 30 days as stale', () => {
    const anchor = new Date('2026-04-01T00:00:00Z')
    const now = new Date(anchor.getTime() + JUST_AFTER)
    expect(isSurveyStale('2026-04-01', now)).toBe(true)
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
