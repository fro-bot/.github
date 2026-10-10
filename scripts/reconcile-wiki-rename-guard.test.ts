import type {OctokitClient} from './commit-metadata.ts'
/**
 * Behavior tests for reconcile's wiki rename guard. `handleReconcile` runs end to end against one
 * in-memory fake of the `data` branch and the real `commitMetadata`, and every assertion is about
 * the decoded `metadata/repos.yaml` that ends up persisted (plus the commit message and the
 * public warning), not about internal counters.
 */
import type {HandleReconcileParams} from './reconcile-repos.ts'

import {Buffer} from 'node:buffer'
import {describe, expect, it, vi} from 'vitest'
import {parse, stringify} from 'yaml'
import {handleReconcile} from './reconcile-repos.ts'

const NODE_ID = 'R_kgDOWIDGET'
const OTHER_NODE_ID = 'R_kgDOGADGET'
const REPOS_PATH = 'metadata/repos.yaml'
const NOW = new Date('2026-04-17T12:00:00Z')

/** A page body with no `node_id` frontmatter: lookup must key on the path, not page identity. */
const ID_LESS_PAGE = '---\ntitle: Old Widget\ntype: repo\n---\n\nHistorical notes.\n'

/** Fragments that must never reach public output: owner, repo names, node IDs, wiki paths. */
const FORBIDDEN_IN_PUBLIC_OUTPUT = ['acme', 'widget', 'gadget', NODE_ID, OTHER_NODE_ID, 'knowledge/wiki', 'contents/']

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function repoRow(overrides: Row = {}): Row {
  const row: Row = {
    owner: 'acme',
    name: 'old-widget',
    added: '2026-01-01',
    onboarding_status: 'onboarded',
    last_survey_at: '2026-04-15',
    last_survey_status: 'success',
    has_fro_bot_workflow: false,
    has_renovate: false,
    discovery_channel: 'collab',
    next_survey_eligible_at: '2026-12-31',
    private: false,
    node_id: NODE_ID,
    ...overrides,
  }
  // `undefined` overrides delete the field, matching how absent fields look on disk.
  for (const [field, value] of Object.entries(row)) {
    if (value === undefined) delete row[field]
  }
  return row
}

/** Past-due eligibility, so the row is dispatched under whatever name it ends up with. */
function dueRow(overrides: Row = {}): Row {
  return repoRow({next_survey_eligible_at: '2026-04-01', ...overrides})
}

function reposFile(...repos: Row[]): {version: 1; repos: Row[]} {
  return {version: 1, repos}
}

function apiError(status: number, message = 'API error'): Error {
  return Object.assign(new Error(message), {status})
}

interface FakeBranchOptions {
  repos: unknown
  /** Wiki repo pages present on the branch, by slug. */
  pages?: Record<string, string>
  /** When set, every wiki page lookup fails with this HTTP status. */
  pageLookupStatus?: number
  /** Number of 409s returned before a write is accepted. */
  conflictsBeforeWrite?: number
  /** Runs when a 409 is returned, so a test can change the branch between attempts. */
  onConflict?: (branch: FakeBranch) => void
}

interface FakeBranch {
  octokit: OctokitClient
  pages: Record<string, string>
  pageLookupStatus: number | undefined
  /** Decoded `metadata/repos.yaml` as currently persisted on the branch. */
  repos: () => {repos: Row[]}
  writes: unknown[]
  messages: string[]
  pageLookups: string[]
  createWorkflowDispatch: ReturnType<typeof vi.fn>
}

/**
 * Discovery client: answers installation enumeration (empty) and nothing else. Any other call
 * (data-branch reads, writes) hits an undefined method and fails, so a wiki lookup misrouted
 * to discovery turns into an unverifiable page and breaks the assertions below.
 */
function makeDiscoveryOctokit(): OctokitClient {
  return {
    paginate: async () => [],
    rest: {apps: {listReposAccessibleToInstallation: async () => ({data: []})}},
  } as unknown as OctokitClient
}

function createFakeBranch(options: FakeBranchOptions): FakeBranch {
  let repos = options.repos
  let revision = 0
  let conflicts = options.conflictsBeforeWrite ?? 0

  const branch: FakeBranch = {
    octokit: undefined as unknown as OctokitClient,
    pages: {...options.pages},
    pageLookupStatus: options.pageLookupStatus,
    repos: () => repos as {repos: Row[]},
    writes: [],
    messages: [],
    pageLookups: [],
    createWorkflowDispatch: vi.fn(async () => undefined),
  }

  const getContent = async ({path}: {path: string}): Promise<unknown> => {
    if (path === REPOS_PATH) {
      const content = stringify(repos, {indent: 2, lineWidth: 0, singleQuote: true})
      return {
        data: {
          type: 'file',
          sha: `sha-${revision}`,
          encoding: 'base64',
          content: Buffer.from(content).toString('base64'),
        },
      }
    }

    const page = /^knowledge\/wiki\/repos\/(.+)\.md$/.exec(path)
    if (page?.[1] !== undefined) {
      branch.pageLookups.push(page[1])
      if (branch.pageLookupStatus !== undefined) {
        // Mirrors Octokit, whose request errors embed the request path in their message.
        throw apiError(
          branch.pageLookupStatus,
          `GET /repos/fro-bot/.github/contents/${path} - ${branch.pageLookupStatus}`,
        )
      }
      const content = branch.pages[page[1]]
      if (content !== undefined) {
        return {
          data: {type: 'file', sha: 'page-sha', encoding: 'base64', content: Buffer.from(content).toString('base64')},
        }
      }
    }

    throw apiError(404, 'Not Found')
  }

  const createOrUpdateFileContents = async (params: {content: string; message: string}): Promise<unknown> => {
    if (conflicts > 0) {
      conflicts -= 1
      options.onConflict?.(branch)
      throw apiError(409, 'conflict')
    }
    repos = parse(Buffer.from(params.content, 'base64').toString('utf8'))
    revision += 1
    branch.writes.push(repos)
    branch.messages.push(params.message)
    return {data: {commit: {sha: `commit-${revision}`}}}
  }

  // The data-branch endpoints under test plus inert stubs for the unrelated endpoints the
  // reconcile shell touches around the commit.
  branch.octokit = {
    paginate: async (fn: (opts: unknown) => Promise<{data: unknown[]}>, opts: unknown) => (await fn(opts)).data,
    rest: {
      repos: {
        getBranch: async ({branch: name}: {branch: string}) => ({
          data: {
            name,
            protected: false,
            protection: {enabled: false},
            commit: {sha: 'data-tip', author: {login: 'fro-bot[bot]'}},
          },
        }),
        getContent,
        createOrUpdateFileContents,
      },
      git: {createRef: async () => ({data: {ref: 'refs/heads/data'}})},
      actions: {createWorkflowDispatch: branch.createWorkflowDispatch},
      // The writer is repo-scoped: it must never enumerate the installation.
      apps: {
        listReposAccessibleToInstallation: async () => {
          throw new Error('writer client must not enumerate the installation')
        },
      },
      issues: {
        create: async () => ({data: {number: 1}}),
        update: async () => ({data: {}}),
        listForRepo: async () => ({data: []}),
        getLabel: async () => ({data: {name: 'label'}}),
        createLabel: async () => ({data: {name: 'label'}}),
      },
      activity: {
        listReposStarredByAuthenticatedUser: async () => ({data: []}),
        starRepoForAuthenticatedUser: async () => undefined,
      },
    },
  } as unknown as OctokitClient

  return branch
}

interface AccessEntry {
  owner: string
  name: string
  private: boolean
  node_id: string
}

interface UserScenario {
  /** Live access list as GitHub reports it. */
  access: AccessEntry[]
  /** Stored names that GitHub no longer serves directly (renamed away): REST 404, node ID still resolves. */
  goneNames?: string[]
  /** Stored names whose REST probe fails with this HTTP status. */
  failingNames?: Record<string, number>
  /** Numeric repository ID the REST probe reports. */
  databaseId?: number
}

function makeUserOctokit(scenario: UserScenario): OctokitClient {
  const first = scenario.access[0]
  return {
    paginate: async (fn: (opts: unknown) => Promise<{data: unknown[]}>, opts: unknown) => (await fn(opts)).data,
    graphql: async (_query: string, variables: {id: string}) => {
      const resolved = scenario.access.find(entry => entry.node_id === variables.id) ?? first
      return {node: {__typename: 'Repository', name: resolved?.name, owner: {login: resolved?.owner}}}
    },
    rest: {
      repos: {
        listForAuthenticatedUser: async () => ({
          data: scenario.access.map(entry => ({
            owner: {login: entry.owner},
            name: entry.name,
            archived: false,
            private: entry.private,
            node_id: entry.node_id,
          })),
        }),
        get: async ({repo}: {repo: string}) => {
          if (scenario.goneNames?.includes(repo) === true) throw apiError(404, 'Not Found')
          const failing = scenario.failingNames?.[repo]
          if (failing !== undefined) throw apiError(failing, 'Server Error')
          const served = scenario.access.find(entry => entry.name === repo) ?? first
          const servedIndex = served === undefined ? 0 : scenario.access.indexOf(served)
          return {
            data: {
              private: served?.private ?? false,
              node_id: served?.node_id ?? NODE_ID,
              // Distinct per repository unless a scenario pins it, as on GitHub.
              id: scenario.databaseId ?? 4242 + servedIndex,
              name: served?.name,
              owner: {login: served?.owner},
            },
          }
        },
        getContent: async () => {
          throw apiError(404, 'Not Found')
        },
      },
      activity: {
        listReposStarredByAuthenticatedUser: async () => ({data: []}),
        starRepoForAuthenticatedUser: async () => undefined,
      },
    },
  } as unknown as OctokitClient
}

const allowlist = {version: 1, approved_inviters: [{username: 'acme', added: '2026-01-01', role: 'owner'}]}

async function reconcile(branch: FakeBranch, scenario: UserScenario) {
  const logger = {warn: vi.fn<(message: string) => void>(), info: vi.fn<(message: string) => void>()}
  const params: HandleReconcileParams = {
    userOctokit: makeUserOctokit(scenario),
    discoveryOctokit: makeDiscoveryOctokit(),
    writerOctokit: branch.octokit,
    owner: 'fro-bot',
    repo: '.github',
    allowlistPath: 'metadata/allowlist.yaml',
    reposPath: REPOS_PATH,
    now: NOW,
    readMetadata: async path => (path.endsWith('allowlist.yaml') ? allowlist : structuredClone(branch.repos())),
    bootstrapDataBranch: vi.fn(async () => ({created: false, ref: 'refs/heads/data', sha: 'data-tip'})),
    dispatchTimeoutMs: 100,
    dispatchStaggerMs: 0,
    maxDispatchesPerRun: 0,
    logger,
    workflowFile: 'survey-repo.yaml',
    workflowRef: 'main',
    // `commitMetadata` intentionally omitted: the real helper writes to the fake branch.
  }
  return {result: await handleReconcile(params), logger}
}

const widgetNew: AccessEntry = {owner: 'acme', name: 'new-widget', private: false, node_id: NODE_ID}
const gadgetNew: AccessEntry = {owner: 'acme', name: 'new-gadget', private: false, node_id: OTHER_NODE_ID}
const newcomer: AccessEntry = {owner: 'acme', name: 'fresh', private: false, node_id: 'R_kgDOFRESH'}

function names(branch: FakeBranch): string[] {
  return branch.repos().repos.map(row => String(row.name))
}

function dispatchedNodeIds(branch: FakeBranch): string[] {
  return branch.createWorkflowDispatch.mock.calls.map(
    call => (call as unknown as [{inputs: {node_id: string}}])[0].inputs.node_id,
  )
}

function guardWarnings(logger: {warn: {mock: {calls: unknown[][]}}}): string[] {
  return logger.warn.mock.calls.map(call => String(call[0])).filter(message => message.includes('wiki page'))
}

// ---------------------------------------------------------------------------
// Renames and merges
// ---------------------------------------------------------------------------

describe('reconcile wiki rename guard', () => {
  const renamedAway = {access: [widgetNew], goneNames: ['old-widget']}

  it('keeps the old row of a blocked rename and still commits other changes', async () => {
    const original = dueRow()
    const branch = createFakeBranch({repos: reposFile(original), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const {result} = await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

    expect(result.committed).toBe(true)
    expect(branch.repos().repos[0]).toEqual(original)
    expect(names(branch)).toEqual(['old-widget', 'fresh'])
    // The kept repo is not surveyed under its new name; the newcomer still is.
    expect(dispatchedNodeIds(branch)).toEqual(['R_kgDOFRESH'])
  })

  it('does not survey a kept repo through the minimum-dispatch floor either', async () => {
    const stale = repoRow({last_survey_at: '2026-03-01'})
    const branch = createFakeBranch({repos: reposFile(stale), pages: {'acme--old-widget': ID_LESS_PAGE}})

    await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

    expect(dispatchedNodeIds(branch)).not.toContain(NODE_ID)
  })

  // Reconcile no longer applies a rename on any path (plan 2026-10-09-004, R3): a redirected rename is
  // reported as pending and moved by the operator workflow. The planner therefore never removes a public
  // name, so the guard has nothing to hold on the rename paths; these cases pin that the row stays put.
  it('reports a rename as pending and leaves the row alone even when the old page is verifiably absent', async () => {
    const original = dueRow()
    const branch = createFakeBranch({repos: reposFile(original)})

    const {result, logger} = await reconcile(branch, renamedAway)

    expect(result).toMatchObject({committed: false, renamesPending: 1, wikiGuardKept: 0})
    expect(branch.repos().repos[0]).toEqual(original)
    expect(names(branch)).toEqual(['old-widget'])
    expect(dispatchedNodeIds(branch)).toEqual([])
    expect(guardWarnings(logger)).toEqual([])
  })

  it('reports both renames as pending, whether or not an old page exists, and dispatches neither', async () => {
    const branch = createFakeBranch({
      repos: reposFile(dueRow(), dueRow({name: 'old-gadget', node_id: OTHER_NODE_ID})),
      pages: {'acme--old-widget': ID_LESS_PAGE},
    })

    const {result} = await reconcile(branch, {access: [widgetNew, gadgetNew], goneNames: ['old-widget', 'old-gadget']})

    expect(result.renamesPending).toBe(2)
    expect(branch.repos().repos.map(row => [row.name, row.node_id])).toEqual([
      ['old-widget', NODE_ID],
      ['old-gadget', OTHER_NODE_ID],
    ])
    expect(dispatchedNodeIds(branch)).toEqual([])
  })

  it('keeps the old row when wiki state is unverifiable', async () => {
    const original = dueRow()
    const branch = createFakeBranch({repos: reposFile(original), pageLookupStatus: 500})

    const {result} = await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

    // No rename is planned, so no wiki lookup is needed (or attempted) and nothing is "unverifiable".
    expect(result).toMatchObject({committed: true, wikiGuardKept: 0, wikiGuardUnverifiable: 0, renamesPending: 1})
    expect(branch.pageLookups).toEqual([])
    expect(branch.repos().repos[0]).toEqual(original)
    expect(names(branch)).toEqual(['old-widget', 'fresh'])
  })

  it('writes nothing when the only change is a pending rename', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const {result} = await reconcile(branch, renamedAway)

    expect(result).toMatchObject({committed: false, wikiGuardKept: 0, wikiGuardUnverifiable: 0, renamesPending: 1})
    expect(branch.writes).toEqual([])
  })

  it('a commit retry after a conflict keeps a pending-rename row untouched, and every downstream action follows', async () => {
    const original = dueRow()
    const branch = createFakeBranch({
      repos: reposFile(original),
      conflictsBeforeWrite: 1,
      onConflict: current => {
        current.pages['acme--old-widget'] = ID_LESS_PAGE
      },
    })

    const {result, logger} = await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

    expect(branch.repos().repos[0]).toEqual(original)
    expect(names(branch)).toEqual(['old-widget', 'fresh'])
    // No rename is planned on any attempt, so the wiki is never consulted.
    expect(branch.pageLookups).toEqual([])
    // The persisted (final) plan drives dispatches, message, warning and result counts.
    expect(dispatchedNodeIds(branch)).toEqual(['R_kgDOFRESH'])
    expect(branch.messages).toEqual(['chore(reconcile): +1 new, 0 pending-review, 0 lost-access, 0 refreshes'])
    expect(guardWarnings(logger)).toEqual([])
    expect(result).toMatchObject({committed: true, wikiGuardKept: 0, wikiGuardUnverifiable: 0, renamesPending: 1})
  })

  it('a commit retry after the wiki tree turns unreadable still keeps a pending-rename row untouched', async () => {
    const original = dueRow()
    const branch = createFakeBranch({
      repos: reposFile(original),
      conflictsBeforeWrite: 1,
      onConflict: current => {
        current.pageLookupStatus = 503
      },
    })

    const {result, logger} = await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

    expect(branch.repos().repos[0]).toEqual(original)
    expect(names(branch)).toEqual(['old-widget', 'fresh'])
    expect(dispatchedNodeIds(branch)).toEqual(['R_kgDOFRESH'])
    expect(branch.messages).toEqual(['chore(reconcile): +1 new, 0 pending-review, 0 lost-access, 0 refreshes'])
    expect(guardWarnings(logger)).toEqual([])
    expect(result).toMatchObject({committed: true, wikiGuardKept: 0, wikiGuardUnverifiable: 0})
  })

  it('does not attempt a commit when the only finding is a pending rename', async () => {
    const original = dueRow()
    const branch = createFakeBranch({
      repos: reposFile(original),
      conflictsBeforeWrite: 1,
      onConflict: current => {
        current.pages['acme--old-widget'] = ID_LESS_PAGE
      },
    })

    const {result, logger} = await reconcile(branch, renamedAway)

    // A rename report is issue-only: no data-branch write is attempted, so the conflict never fires.
    expect(result).toMatchObject({committed: false, wikiGuardKept: 0, renamesPending: 1})
    expect(branch.writes).toEqual([])
    expect(dispatchedNodeIds(branch)).toEqual([])
    expect(guardWarnings(logger)).toEqual([])
  })

  describe('duplicate rows', () => {
    it('keeps both original associations of a blocked merge, with canonical ID enrichment and unrelated updates', async () => {
      const identified = repoRow({name: 'old-widget', node_id: NODE_ID})
      const idLessCanonical = repoRow({name: 'new-widget', node_id: undefined})
      const branch = createFakeBranch({
        repos: reposFile(identified, idLessCanonical),
        pages: {'acme--old-widget': ID_LESS_PAGE, 'acme--new-widget': ID_LESS_PAGE},
      })

      const {result} = await reconcile(branch, {
        access: [widgetNew, newcomer],
        goneNames: ['old-widget'],
        databaseId: 4242,
      })

      expect(result.committed).toBe(true)
      const stored = branch.repos().repos
      expect(stored.map(row => row.name)).toEqual(['old-widget', 'new-widget', 'fresh'])
      expect(stored[0]).toMatchObject({owner: 'acme', private: false, node_id: NODE_ID})
      // Canonical row gained the stable ID the access list proves; both rows stay public.
      expect(stored[1]).toMatchObject({owner: 'acme', private: false, node_id: NODE_ID})
    })

    describe.each([
      ['canonical row first', (old: Row, canonical: Row) => [canonical, old]],
      ['old-name row first', (old: Row, canonical: Row) => [old, canonical]],
    ])('blocked merge, %s', (_order, arrange) => {
      const gadget = (overrides: Row = {}) => dueRow({name: 'gadget', node_id: OTHER_NODE_ID, ...overrides})
      const gadgetAccess: AccessEntry = {owner: 'acme', name: 'gadget', private: false, node_id: OTHER_NODE_ID}

      it('does not survey the retained duplicate identity (threshold), while unrelated repos still are', async () => {
        const rows = arrange(dueRow({name: 'old-widget'}), dueRow({name: 'new-widget'}))
        const branch = createFakeBranch({
          repos: reposFile(...rows, gadget()),
          pages: {'acme--old-widget': ID_LESS_PAGE},
        })

        const {result} = await reconcile(branch, {access: [widgetNew, gadgetAccess]})

        expect(names(branch)).toHaveLength(3)
        expect(names(branch)).toEqual(expect.arrayContaining(['gadget', 'new-widget', 'old-widget']))
        expect(dispatchedNodeIds(branch)).toEqual([OTHER_NODE_ID])
        expect(result.wikiGuardKept).toBe(1)
      })

      it('does not survey the retained duplicate identity through the floor either', async () => {
        const stale = {last_survey_at: '2026-03-01', next_survey_eligible_at: '2026-12-31'}
        const rows = arrange(repoRow({name: 'old-widget', ...stale}), repoRow({name: 'new-widget', ...stale}))
        // One due repo leaves the floor a free slot; the stale duplicates are its oldest candidates.
        const branch = createFakeBranch({
          repos: reposFile(...rows, gadget()),
          pages: {'acme--old-widget': ID_LESS_PAGE},
        })

        await reconcile(branch, {access: [widgetNew, gadgetAccess]})

        expect(dispatchedNodeIds(branch)).toEqual([OTHER_NODE_ID])
      })
    })

    it('merges once the dropped name has no page', async () => {
      const duplicates = reposFile(repoRow({name: 'new-widget'}), repoRow({name: 'old-widget'}))
      const branch = createFakeBranch({repos: duplicates})

      const {result} = await reconcile(branch, {access: [widgetNew]})

      expect(result.committed).toBe(true)
      expect(names(branch)).toEqual(['new-widget'])
    })

    it('keeps both rows of a merge whose dropped name still has a page', async () => {
      const duplicates = reposFile(repoRow({name: 'new-widget'}), repoRow({name: 'old-widget'}))
      const branch = createFakeBranch({repos: duplicates, pages: {'acme--old-widget': ID_LESS_PAGE}})

      await reconcile(branch, {access: [widgetNew, newcomer]})

      expect(names(branch)).toEqual(['new-widget', 'old-widget', 'fresh'])
    })

    it('leaves no public sibling of a resolved restrictive downgrade', async () => {
      // Two rows of one repo, linked only by database_id. The ID-less public row is not in the
      // access list and its probe is transient, so it is left public by classification; its sibling
      // is downgraded by the access list. Merging must not let the public row survive.
      const ghost = repoRow({name: 'ghost', node_id: undefined, database_id: 42, last_survey_at: '2026-04-16'})
      const known = repoRow({name: 'new-widget', database_id: 42, last_survey_at: '2026-04-01'})
      const branch = createFakeBranch({repos: reposFile(ghost, known)})

      const {result} = await reconcile(branch, {
        access: [{...widgetNew, private: true}],
        failingNames: {ghost: 500},
        databaseId: 42,
      })

      expect(result.committed).toBe(true)
      const stored = branch.repos().repos
      expect(stored.filter(row => row.private === false)).toEqual([])
      expect(stored.map(row => row.name)).not.toContain('ghost')
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({owner: '[REDACTED]', name: NODE_ID, private: true})
    })
  })

  describe('visibility downgrades', () => {
    it('still records a public → private downgrade while the old page exists', async () => {
      const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

      const {result} = await reconcile(branch, {
        access: [{owner: 'acme', name: 'old-widget', private: true, node_id: NODE_ID}],
      })

      expect(result).toMatchObject({committed: true, wikiGuardKept: 0})
      expect(branch.repos().repos).toMatchObject([{owner: '[REDACTED]', name: NODE_ID, private: true}])
    })

    it('persists only the redacted successor of an ID-less downgrade, never a stale public alias', async () => {
      const idLess = repoRow({name: 'old-widget', node_id: undefined})
      const branch = createFakeBranch({repos: reposFile(idLess), pages: {'acme--old-widget': ID_LESS_PAGE}})

      const {result, logger} = await reconcile(branch, {
        access: [{owner: 'acme', name: 'old-widget', private: true, node_id: NODE_ID}],
      })

      expect(result.committed).toBe(true)
      const stored = branch.repos().repos
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({owner: '[REDACTED]', name: NODE_ID, private: true, node_id: NODE_ID})
      expect(stored.filter(row => row.private === false)).toEqual([])
      expect(result.wikiGuardKept).toBe(0)
      expect(guardWarnings(logger)).toEqual([])
    })
  })

  describe('shared slugs', () => {
    const dotted = (overrides: Row = {}) =>
      dueRow({name: 'alpha.beta', node_id: NODE_ID, last_survey_at: '2026-04-16', ...overrides})
    const dashed = (overrides: Row = {}) =>
      dueRow({name: 'alpha-beta', node_id: OTHER_NODE_ID, last_survey_at: '2026-04-16', ...overrides})

    it('keeps the blocked public alias without undoing another repo’s downgrade', async () => {
      // `alpha.beta` and `alpha-beta` share the page slug `acme--alpha-beta`.
      const branch = createFakeBranch({
        repos: reposFile(dotted(), dashed()),
        pages: {'acme--alpha-beta': ID_LESS_PAGE},
      })

      const {result} = await reconcile(branch, {
        access: [
          {owner: 'acme', name: 'gamma', private: false, node_id: NODE_ID},
          {owner: 'acme', name: 'alpha-beta', private: true, node_id: OTHER_NODE_ID},
        ],
        goneNames: ['alpha.beta'],
      })

      expect(result.committed).toBe(true)
      const stored = branch.repos().repos
      expect(stored.map(row => [row.owner, row.name, row.private])).toEqual([
        ['acme', 'alpha.beta', false],
        ['[REDACTED]', OTHER_NODE_ID, true],
      ])
    })

    it.each([
      ['page present', {pages: {'acme--alpha-beta': ID_LESS_PAGE}}],
      ['wiki state unverifiable', {pageLookupStatus: 500}],
    ])('keeps a same-slug rename `alpha.beta` → `alpha-beta` when %s', async (_label, options) => {
      const original = dotted()
      const branch = createFakeBranch({repos: reposFile(original), ...options})

      await reconcile(branch, {
        access: [{owner: 'acme', name: 'alpha-beta', private: false, node_id: NODE_ID}, newcomer],
        goneNames: ['alpha.beta'],
      })

      expect(branch.repos().repos[0]).toEqual(original)
      expect(names(branch)).toEqual(['alpha.beta', 'fresh'])
    })

    it('reports a same-slug rename as pending instead of applying it on verified absence', async () => {
      const branch = createFakeBranch({repos: reposFile(dotted())})

      const {result} = await reconcile(branch, {
        access: [{owner: 'acme', name: 'alpha-beta', private: false, node_id: NODE_ID}],
        goneNames: ['alpha.beta'],
      })

      expect(result.renamesPending).toBe(1)
      expect(branch.pageLookups).toEqual([])
      expect(names(branch)).toEqual(['alpha.beta'])
    })

    it('treats a case-only rename as a pending rename, not a removal', async () => {
      const branch = createFakeBranch({
        repos: reposFile(repoRow({name: 'Widget'})),
        pages: {'acme--widget': ID_LESS_PAGE},
      })

      const {result} = await reconcile(branch, {access: [{...widgetNew, name: 'widget'}]})

      // The database_id refresh is still written; the name is not.
      expect(result).toMatchObject({committed: true, wikiGuardKept: 0, renamesPending: 1})
      expect(branch.pageLookups).toEqual([])
      expect(names(branch)).toEqual(['Widget'])
    })
  })

  describe('commit message and warning', () => {
    it('claims no rename or merge for a blocked rename plus a newcomer', async () => {
      const branch = createFakeBranch({repos: reposFile(dueRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

      await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

      expect(branch.messages).toEqual(['chore(reconcile): +1 new, 0 pending-review, 0 lost-access, 0 refreshes'])
    })

    it('claims no merge for a blocked merge', async () => {
      const duplicates = reposFile(repoRow({name: 'new-widget'}), repoRow({name: 'old-widget'}))
      const branch = createFakeBranch({repos: duplicates, pages: {'acme--old-widget': ID_LESS_PAGE}})

      await reconcile(branch, {access: [widgetNew, newcomer]})

      expect(branch.messages[0]).not.toMatch(/renamed|merged/)
    })

    it('claims an applied merge', async () => {
      const duplicates = reposFile(repoRow({name: 'new-widget'}), repoRow({name: 'old-widget'}))
      const branch = createFakeBranch({repos: duplicates})

      await reconcile(branch, {access: [widgetNew]})

      expect(branch.messages[0]).toMatch(/\+1 merged/)
    })

    it('claims no rename in the commit message for two pending renames', async () => {
      const branch = createFakeBranch({
        repos: reposFile(dueRow(), dueRow({name: 'old-gadget', node_id: OTHER_NODE_ID})),
        pages: {'acme--old-widget': ID_LESS_PAGE},
      })

      await reconcile(branch, {access: [widgetNew, gadgetNew, newcomer], goneNames: ['old-widget', 'old-gadget']})

      expect(branch.messages).toHaveLength(1)
      expect(branch.messages[0]).not.toMatch(/renamed|merged/)
    })

    it('emits no wiki-guard warning and no identifying text for a pending rename', async () => {
      const branch = createFakeBranch({repos: reposFile(repoRow()), pageLookupStatus: 500})

      const {logger} = await reconcile(branch, {...renamedAway, access: [widgetNew, newcomer]})

      expect(guardWarnings(logger)).toEqual([])
      const everything = [...logger.warn.mock.calls, ...logger.info.mock.calls].map(call => String(call[0])).join('\n')
      for (const fragment of FORBIDDEN_IN_PUBLIC_OUTPUT) expect(everything).not.toContain(fragment)
      expect(everything).not.toContain('500')
    })
  })
})
