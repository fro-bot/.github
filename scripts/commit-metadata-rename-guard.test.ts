/**
 * Behavior tests for the `metadata/repos.yaml` rename guard, driven through `commitMetadata`
 * and every production writer of that file: reconcile, invitation acceptance, survey results,
 * and survey resets. Each writer runs against one in-memory fake of the `data` branch, so the
 * assertions are about what ends up on the branch and what reaches (public) output.
 */
import type {HandleReconcileParams} from './reconcile-repos.ts'

import {Buffer} from 'node:buffer'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {parse, stringify} from 'yaml'

import {commitMetadata, CommitMetadataError, type OctokitClient} from './commit-metadata.ts'
import {handleInvitations} from './handle-invitation.ts'
import {handleReconcile} from './reconcile-repos.ts'

// `record-survey-result.ts` and `reset-survey-status.ts` are CLI entry points that build their own
// Octokit from `GITHUB_TOKEN`. Handing them the fake through a static module shim lets the real
// scripts run end to end.
const octokitShim = vi.hoisted(() => {
  const shim: {client: {rest: unknown; paginate: unknown} | undefined} = {client: undefined}
  class Octokit {
    readonly rest = shim.client?.rest
    readonly paginate = shim.client?.paginate
  }
  return {shim, Octokit}
})
vi.mock('@octokit/rest', () => ({Octokit: octokitShim.Octokit}))

const NODE_ID = 'R_kgDOWIDGET'
const REPOS_PATH = 'metadata/repos.yaml'
const NOW = new Date('2026-04-17T12:00:00Z')

/** Fragments that must never reach public output: owner, both repo names, node ID, wiki paths. */
const FORBIDDEN_IN_PUBLIC_OUTPUT = ['acme', 'old-widget', 'new-widget', NODE_ID, 'knowledge/wiki', 'contents/']

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function repoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
}

function reposFile(...repos: Record<string, unknown>[]): {version: 1; repos: Record<string, unknown>[]} {
  return {version: 1, repos}
}

function apiError(status: number, message = 'API error'): Error {
  return Object.assign(new Error(message), {status})
}

interface FakeBranchOptions {
  repos: unknown
  /** Wiki repo pages present on the branch, by slug, with their content. */
  pages?: Record<string, string>
  /** When set, every wiki page lookup fails with this HTTP status. */
  pageLookupStatus?: number
  /** Path the fake serves as the metadata file under test. */
  metadataPath?: string
  /** Number of 409s returned before a write is accepted. */
  conflictsBeforeWrite?: number
  /** Runs when a 409 is returned, so a test can change the branch between attempts. */
  onConflict?: (branch: FakeBranch) => void
}

interface FakeBranch {
  octokit: OctokitClient
  pages: Record<string, string>
  pageLookupStatus: number | undefined
  repos: () => unknown
  writes: unknown[]
  pageLookups: string[]
  createWorkflowDispatch: ReturnType<typeof vi.fn>
}

function createFakeBranch(options: FakeBranchOptions): FakeBranch {
  let repos = options.repos
  let revision = 0
  let conflicts = options.conflictsBeforeWrite ?? 0

  const branch: FakeBranch = {
    octokit: undefined as unknown as OctokitClient,
    pages: {...options.pages},
    pageLookupStatus: options.pageLookupStatus,
    repos: () => repos,
    writes: [],
    pageLookups: [],
    createWorkflowDispatch: vi.fn(async () => undefined),
  }

  const getContent = async ({path}: {path: string}): Promise<unknown> => {
    if (path === (options.metadataPath ?? REPOS_PATH)) {
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

  const createOrUpdateFileContents = async (params: {content: string}): Promise<unknown> => {
    if (conflicts > 0) {
      conflicts -= 1
      options.onConflict?.(branch)
      throw apiError(409, 'conflict')
    }
    repos = parse(Buffer.from(params.content, 'base64').toString('utf8'))
    revision += 1
    branch.writes.push(repos)
    return {data: {commit: {sha: `commit-${revision}`}}}
  }

  // One superset client: the data-branch endpoints under test plus inert stubs for the unrelated
  // endpoints the reconcile and invitation shells touch around the commit.
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
      apps: {listReposAccessibleToInstallation: async () => ({data: []})},
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

/** A page body with no `node_id` frontmatter: lookup must key on the path, not page identity. */
const ID_LESS_PAGE = '---\ntitle: Old Widget\ntype: repo\n---\n\nHistorical notes.\n'

function expectRedacted(text: string): void {
  for (const fragment of FORBIDDEN_IN_PUBLIC_OUTPUT) {
    expect(text).not.toContain(fragment)
  }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject')
    },
    (error: unknown) => error,
  )
}

// ---------------------------------------------------------------------------
// commitMetadata (shared guard)
// ---------------------------------------------------------------------------

function rename(file: unknown): unknown {
  const state = file as {version: 1; repos: Record<string, unknown>[]}
  return {...state, repos: state.repos.map(row => ({...row, name: 'new-widget'}))}
}

async function write(branch: FakeBranch, mutator: (current: unknown) => unknown, path = REPOS_PATH) {
  return commitMetadata({octokit: branch.octokit, path, message: 'chore(metadata): test', mutator})
}

describe('commitMetadata rename guard', () => {
  it('rejects a rename while the old page exists, with a redacted blocked error', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const error = await caught(write(branch, rename))

    expect(error).toBeInstanceOf(CommitMetadataError)
    expect(error).toMatchObject({code: 'WIKI_PAGE_RENAME_BLOCKED'})
    const blocked = error as CommitMetadataError
    expectRedacted(`${blocked.message}\n${blocked.remediation}\n${String(blocked.stack)}`)
    expect(blocked.cause).toBeUndefined()
    expect(branch.writes).toEqual([])
  })

  it('allows the rename once absence of the old page is verified', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const result = await write(branch, rename)

    expect(result).toMatchObject({committed: true, attempts: 1})
    expect(branch.pageLookups).toEqual(['acme--old-widget'])
    expect(branch.repos()).toMatchObject({repos: [{name: 'new-widget'}]})
  })

  it('keeps a page for a different repo from blocking an unrelated rename', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--other': ID_LESS_PAGE}})

    await expect(write(branch, rename)).resolves.toMatchObject({committed: true})
  })

  it.each([401, 403, 429, 500, 503])(
    'fails closed when the page lookup is unreadable (HTTP %i), without echoing the request path',
    async status => {
      const branch = createFakeBranch({repos: reposFile(repoRow()), pageLookupStatus: status})

      const error = await caught(write(branch, rename))

      expect(error).toMatchObject({code: 'WIKI_STATE_UNVERIFIABLE'})
      const blocked = error as CommitMetadataError
      expectRedacted(`${blocked.message}\n${blocked.remediation}\n${String(blocked.stack)}`)
      expect(blocked.cause).toBeUndefined()
      expect(branch.writes).toEqual([])
    },
  )

  it('blocks a rename whose successor row carries a different stable identity', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const error = await caught(write(branch, () => reposFile(repoRow({name: 'new-widget', node_id: 'R_kgDOOTHER'}))))

    expect(error).toMatchObject({code: 'WIKI_PAGE_RENAME_BLOCKED'})
    expect(branch.writes).toEqual([])
  })

  it('blocks removal of an ID-less old row when its page exists', async () => {
    const branch = createFakeBranch({
      repos: reposFile(repoRow({node_id: undefined})),
      pages: {'acme--old-widget': ID_LESS_PAGE},
    })

    const error = await caught(write(branch, () => reposFile(repoRow({name: 'new-widget'}))))

    expect(error).toMatchObject({code: 'WIKI_PAGE_RENAME_BLOCKED'})
  })

  it('preserves a visibility downgrade even though the old page still exists', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const result = await write(branch, () =>
      reposFile(repoRow({owner: '[REDACTED]', name: NODE_ID, private: true, node_id: NODE_ID})),
    )

    expect(result.committed).toBe(true)
    expect(branch.pageLookups).toEqual([])
    expect(branch.repos()).toMatchObject({repos: [{owner: '[REDACTED]', private: true}]})
  })

  it('preserves a downgrade to unknown visibility', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const result = await write(branch, () => reposFile(repoRow({private: undefined})))

    expect(result.committed).toBe(true)
    expect(branch.pageLookups).toEqual([])
  })

  it('does not look at the wiki when no public name is removed', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const result = await write(branch, current => ({
      ...(current as {version: 1}),
      repos: (current as {repos: Record<string, unknown>[]}).repos.map(row => ({
        ...row,
        last_survey_at: '2026-04-16',
      })),
    }))

    expect(result.committed).toBe(true)
    expect(branch.pageLookups).toEqual([])
  })

  it('does not look at the wiki when the write is a no-op', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const result = await write(branch, current => structuredClone(current))

    expect(result.committed).toBe(false)
    expect(branch.pageLookups).toEqual([])
  })

  it('applies to exactly metadata/repos.yaml and no other metadata file', async () => {
    const branch = createFakeBranch({
      repos: reposFile(repoRow()),
      pages: {'acme--old-widget': ID_LESS_PAGE},
      metadataPath: 'metadata/repos-archive.yaml',
    })

    const result = await write(branch, rename, 'metadata/repos-archive.yaml')

    expect(result.committed).toBe(true)
    expect(branch.pageLookups).toEqual([])
  })

  describe('retry', () => {
    it('revalidates against the fresh tree after a 409: a page that appears between attempts blocks the rename', async () => {
      const branch = createFakeBranch({
        repos: reposFile(repoRow()),
        conflictsBeforeWrite: 1,
        onConflict: current => {
          current.pages['acme--old-widget'] = ID_LESS_PAGE
        },
      })

      const error = await caught(write(branch, rename))

      expect(error).toMatchObject({code: 'WIKI_PAGE_RENAME_BLOCKED'})
      expect(branch.pageLookups).toEqual(['acme--old-widget', 'acme--old-widget'])
      expect(branch.writes).toEqual([])
    })

    it('fails closed when the tree becomes unreadable between attempts', async () => {
      const branch = createFakeBranch({
        repos: reposFile(repoRow()),
        conflictsBeforeWrite: 1,
        onConflict: current => {
          current.pageLookupStatus = 503
        },
      })

      const error = await caught(write(branch, rename))

      expect(error).toMatchObject({code: 'WIKI_STATE_UNVERIFIABLE'})
      expect(branch.pageLookups).toHaveLength(2)
      expect(branch.writes).toEqual([])
    })

    it('commits on the retry when the old page stays verifiably absent', async () => {
      const branch = createFakeBranch({repos: reposFile(repoRow()), conflictsBeforeWrite: 1})

      const result = await write(branch, rename)

      expect(result).toMatchObject({committed: true, attempts: 2})
      expect(branch.pageLookups).toEqual(['acme--old-widget', 'acme--old-widget'])
    })
  })
})

// ---------------------------------------------------------------------------
// Writer: reconcile
// ---------------------------------------------------------------------------

describe('reconcile writer', () => {
  const allowlist = {version: 1, approved_inviters: []}

  interface UserScenario {
    /** Live access list as GitHub reports it. */
    access: {owner: string; name: string; private: boolean; node_id: string}[]
    /** Stored name that GitHub no longer serves directly (renamed away). */
    goneName?: string
    /** Where a node ID lookup resolves to. */
    resolvedTo?: {owner: string; name: string}
  }

  function makeUserOctokit(scenario: UserScenario): OctokitClient {
    const current = scenario.access[0]
    return {
      paginate: async (fn: (opts: unknown) => Promise<{data: unknown[]}>, opts: unknown) => (await fn(opts)).data,
      graphql: async () => ({
        node: {
          __typename: 'Repository',
          name: scenario.resolvedTo?.name ?? current?.name,
          owner: {login: scenario.resolvedTo?.owner ?? current?.owner},
        },
      }),
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
            if (repo === scenario.goneName) throw apiError(404, 'Not Found')
            return {
              data: {
                private: current?.private ?? false,
                node_id: current?.node_id ?? NODE_ID,
                id: 4242,
                name: current?.name,
                owner: {login: current?.owner},
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

  async function reconcile(branch: FakeBranch, scenario: UserScenario) {
    const params: HandleReconcileParams = {
      userOctokit: makeUserOctokit(scenario),
      appOctokit: branch.octokit,
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
      logger: {warn: vi.fn(), info: vi.fn()},
      workflowFile: 'survey-repo.yaml',
      workflowRef: 'main',
    }
    return handleReconcile(params)
  }

  const renamedAway: UserScenario = {
    access: [{owner: 'acme', name: 'new-widget', private: false, node_id: NODE_ID}],
    goneName: 'old-widget',
  }

  it('blocks a single-row rename while the old page exists (even without page identity)', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const error = await caught(reconcile(branch, renamedAway))

    expect(error).toMatchObject({code: 'WIKI_PAGE_RENAME_BLOCKED'})
    expectRedacted((error as Error).message)
    expect(branch.writes).toEqual([])
    expect(branch.repos()).toMatchObject({repos: [{name: 'old-widget'}]})
    expect(branch.createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('commits the rename once the old page is verifiably absent', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const result = await reconcile(branch, renamedAway)

    expect(result.committed).toBe(true)
    expect(branch.pageLookups).toEqual(['acme--old-widget'])
    expect(branch.repos()).toMatchObject({repos: [{owner: 'acme', name: 'new-widget', node_id: NODE_ID}]})
  })

  it('blocks a duplicate-row merge that would drop a name whose page still exists', async () => {
    const duplicates = reposFile(repoRow({name: 'new-widget'}), repoRow({name: 'old-widget'}))
    const branch = createFakeBranch({repos: duplicates, pages: {'acme--old-widget': ID_LESS_PAGE}})

    const error = await caught(
      reconcile(branch, {access: [{owner: 'acme', name: 'new-widget', private: false, node_id: NODE_ID}]}),
    )

    expect(error).toMatchObject({code: 'WIKI_PAGE_RENAME_BLOCKED'})
    expect(branch.writes).toEqual([])
    expect((branch.repos() as {repos: unknown[]}).repos).toHaveLength(2)
  })

  it('merges duplicate rows once the dropped name has no page', async () => {
    const duplicates = reposFile(repoRow({name: 'new-widget'}), repoRow({name: 'old-widget'}))
    const branch = createFakeBranch({repos: duplicates})

    const result = await reconcile(branch, {
      access: [{owner: 'acme', name: 'new-widget', private: false, node_id: NODE_ID}],
    })

    expect(result.committed).toBe(true)
    expect(branch.repos()).toMatchObject({repos: [{name: 'new-widget'}]})
    expect((branch.repos() as {repos: unknown[]}).repos).toHaveLength(1)
  })

  it('fails closed when the data-tree page lookup is unreadable', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pageLookupStatus: 500})

    const error = await caught(reconcile(branch, renamedAway))

    expect(error).toMatchObject({code: 'WIKI_STATE_UNVERIFIABLE'})
    expectRedacted((error as Error).message)
    expect(branch.writes).toEqual([])
  })

  it('still records a public → private downgrade while the old page exists', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const result = await reconcile(branch, {
      access: [{owner: 'acme', name: 'old-widget', private: true, node_id: NODE_ID}],
    })

    expect(result.committed).toBe(true)
    expect(branch.pageLookups).toEqual([])
    expect(branch.repos()).toMatchObject({repos: [{owner: '[REDACTED]', name: NODE_ID, private: true}]})
  })
})

// ---------------------------------------------------------------------------
// Writer: invitation acceptance
// ---------------------------------------------------------------------------

function makeInvitationOctokit(dispatch: ReturnType<typeof vi.fn>): OctokitClient {
  return {
    rest: {
      repos: {
        listInvitationsForAuthenticatedUser: async () => ({
          data: [
            {
              id: 101,
              inviter: {login: 'marcusrbrown'},
              repository: {name: 'new-widget', node_id: NODE_ID, private: false, owner: {login: 'acme'}},
            },
          ],
        }),
        get: async () => ({data: {node_id: NODE_ID, private: false}}),
        acceptInvitationForAuthenticatedUser: async () => undefined,
      },
      activity: {starRepoForAuthenticatedUser: async () => undefined},
      actions: {createWorkflowDispatch: dispatch},
    },
  } as unknown as OctokitClient
}

async function acceptInvitations(branch: FakeBranch) {
  const dispatch = vi.fn(async () => undefined)
  const result = await handleInvitations({
    octokit: makeInvitationOctokit(dispatch),
    metadataOctokit: branch.octokit,
    owner: 'fro-bot',
    repo: '.github',
    allowlistPath: 'metadata/allowlist.yaml',
    reposPath: REPOS_PATH,
    now: NOW,
    workflowFile: 'survey-repo.yaml',
    workflowRef: 'main',
    bootstrapDataBranch: vi.fn(async () => ({})),
    readMetadata: async path =>
      path.endsWith('allowlist.yaml')
        ? {version: 1, approved_inviters: [{username: 'marcusrbrown', added: '2025-04-15', role: 'owner'}]}
        : structuredClone(branch.repos()),
    // `commitMetadata` intentionally omitted: the production writer must reach the real guard.
  })
  return {...result, dispatch}
}

describe('invitation writer', () => {
  it('blocks accepting an invitation that renames a tracked repo while the old page exists', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const {processed, dispatch} = await acceptInvitations(branch)

    expect(processed).toHaveLength(1)
    expect(processed[0]).toMatchObject({status: 'failed', errorCode: 'API_ERROR'})
    expectRedacted((processed[0] as {message: string}).message)
    expect(branch.writes).toEqual([])
    expect(branch.repos()).toMatchObject({repos: [{name: 'old-widget'}]})
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('records the rename when the old page is verifiably absent', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const {processed, dispatch} = await acceptInvitations(branch)

    expect(processed[0]).toMatchObject({status: 'accepted'})
    expect(branch.pageLookups).toEqual(['acme--old-widget'])
    expect(branch.repos()).toMatchObject({repos: [{name: 'new-widget', node_id: NODE_ID}]})
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('fails closed on an unreadable data tree', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pageLookupStatus: 502})

    const {processed} = await acceptInvitations(branch)

    expect(processed[0]).toMatchObject({status: 'failed'})
    expectRedacted((processed[0] as {message: string}).message)
    expect(branch.writes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Writers: survey results and survey resets (CLI entry points)
// ---------------------------------------------------------------------------

class ExitSignal extends Error {
  readonly exitCode: number

  constructor(exitCode: number) {
    super(`process.exit(${exitCode})`)
    this.exitCode = exitCode
  }
}

async function runCli(
  script: 'record-survey-result' | 'reset-survey-status',
  env: Record<string, string>,
  branch: FakeBranch,
): Promise<{exitCode: number; stdout: string; stderr: string}> {
  vi.resetModules()
  octokitShim.shim.client = branch.octokit
  vi.stubEnv('GITHUB_TOKEN', 'test-token')
  vi.stubEnv('GITHUB_REPOSITORY', 'fro-bot/.github')
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)

  const originalArgv1 = process.argv[1]
  process.argv[1] = fileURLToPath(new URL(`./${script}.ts`, import.meta.url))

  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0)
  }) as typeof process.exit)

  let exitCode = 0
  try {
    await (script === 'record-survey-result' ? import('./record-survey-result.ts') : import('./reset-survey-status.ts'))
  } catch (error: unknown) {
    if (!(error instanceof ExitSignal)) throw error
    exitCode = error.exitCode
  } finally {
    process.argv[1] = originalArgv1 as string
  }

  return {exitCode, stdout: stdout.join(''), stderr: stderr.join('')}
}

describe('survey result writer (record-survey-result)', () => {
  const renameEnv = {
    REPO_OWNER: 'acme',
    REPO_NAME: 'new-widget',
    REPO_PRIVATE: 'false',
    REPO_NODE_ID: NODE_ID,
    SURVEY_STATUS: 'success',
    SURVEY_AT: '2026-04-17T00:00:00Z',
  }

  it('blocks a survey write-back that renames the entry while the old page exists', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const result = await runCli('record-survey-result', renameEnv, branch)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('would remove 1 public repository name(s)')
    expectRedacted(result.stderr)
    expect(result.stdout).toBe('')
    expect(branch.writes).toEqual([])
  })

  it('commits the rename write-back once the old page is verifiably absent', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const result = await runCli('record-survey-result', renameEnv, branch)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({committed: true, status: 'success'})
    expect(branch.repos()).toMatchObject({repos: [{name: 'new-widget', last_survey_status: 'success'}]})
  })

  it('fails closed on an unreadable data tree', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pageLookupStatus: 500})

    const result = await runCli('record-survey-result', renameEnv, branch)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('could not verify wiki page state')
    expectRedacted(result.stderr)
    expect(branch.writes).toEqual([])
  })

  it('does not interfere with an ordinary survey write-back that keeps the name', async () => {
    const branch = createFakeBranch({
      repos: reposFile(repoRow({name: 'new-widget'})),
      pages: {'acme--new-widget': ID_LESS_PAGE},
    })

    const result = await runCli('record-survey-result', renameEnv, branch)

    expect(result.exitCode).toBe(0)
    expect(branch.pageLookups).toEqual([])
  })
})

describe('survey reset writer (reset-survey-status)', () => {
  it('records a reset that downgrades a public entry to private even though its old page exists', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow()), pages: {'acme--old-widget': ID_LESS_PAGE}})

    const result = await runCli('reset-survey-status', {TARGETS: `node_id:${NODE_ID}`}, branch)

    expect(result.exitCode).toBe(0)
    expect(branch.pageLookups).toEqual([])
    expect(branch.repos()).toMatchObject({
      repos: [{owner: '[REDACTED]', name: NODE_ID, private: true, last_survey_at: null}],
    })
  })

  it('resets an ordinary public entry without consulting the wiki', async () => {
    const branch = createFakeBranch({repos: reposFile(repoRow())})

    const result = await runCli('reset-survey-status', {TARGETS: 'acme/old-widget'}, branch)

    expect(result.exitCode).toBe(0)
    expect(branch.pageLookups).toEqual([])
    expect(branch.repos()).toMatchObject({repos: [{name: 'old-widget', last_survey_at: null}]})
  })
})

beforeEach(() => {
  octokitShim.shim.client = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
