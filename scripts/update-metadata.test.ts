import type {DataBranchBootstrapResult} from './data-branch-bootstrap.ts'
import type {DiscoveryClient, OctokitClient} from './update-metadata.ts'

import {Buffer} from 'node:buffer'
import process from 'node:process'

import {beforeEach, describe, expect, it, vi} from 'vitest'

// BDD: buildRenovateFile
// Given: a list of detected repo names
// When: buildRenovateFile is called
// Then: returns a RenovateFile with names sorted and deduplicated

// BDD: discoverRenovateRepos
// Given: an Octokit client and a target owner
// When: discoverRenovateRepos is called
// Then: lists installation-accessible repos, filters to owner (excluding archived
//       and forks), probes each for .github/workflows/renovate.yaml, returns
//       matching names in discovery order

const {mocks, mockOctokit} = vi.hoisted(() => {
  const mocks = {
    listReposAccessibleToInstallation: vi.fn(),
    getContent: vi.fn(),
    paginate: vi.fn(),
  }
  return {
    mocks,
    mockOctokit: {
      paginate: mocks.paginate,
      rest: {
        apps: {
          listReposAccessibleToInstallation: mocks.listReposAccessibleToInstallation,
        },
        repos: {
          getContent: mocks.getContent,
        },
      },
    } satisfies DiscoveryClient,
  }
})

// Test fixture builder so each repo carries the realistic owner/archived/fork shape
// returned by `apps.listReposAccessibleToInstallation`.
function repo(name: string, opts?: {owner?: string; archived?: boolean; fork?: boolean}) {
  return {
    name,
    archived: opts?.archived ?? false,
    fork: opts?.fork ?? false,
    owner: {login: opts?.owner ?? 'fro-bot'},
  }
}

describe('buildRenovateFile', () => {
  it('wraps names in the renovate.yaml schema shape', async () => {
    // #given a list of repo names
    // #when buildRenovateFile is called
    // #then it returns the canonical {repositories: {with-renovate: ...}} shape
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile(['agent', '.github'])
    expect(result).toEqual({repositories: {'with-renovate': ['.github', 'agent']}})
  })

  it('sorts names alphabetically using locale order', async () => {
    // #given an unsorted list
    // #when buildRenovateFile is called
    // #then the output is alphabetically sorted via localeCompare
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile(['tokentoilet', 'agent', '.github'])
    expect(result.repositories['with-renovate']).toEqual(['.github', 'agent', 'tokentoilet'])
  })

  it('deduplicates duplicate repo names', async () => {
    // #given a list with duplicates
    // #when buildRenovateFile is called
    // #then the duplicates are collapsed to a single entry
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile(['agent', 'agent', '.github'])
    expect(result.repositories['with-renovate']).toEqual(['.github', 'agent'])
  })

  it('returns empty list shape for empty input', async () => {
    // #given an empty input list
    // #when buildRenovateFile is called
    // #then the schema is preserved with an empty array
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile([])
    expect(result).toEqual({repositories: {'with-renovate': []}})
  })
})

describe('discoverRenovateRepos', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns repos containing .github/workflows/renovate.yaml in discovery order', async () => {
    // #given the installation lists three fro-bot repos and two have a Renovate workflow
    // #when discoverRenovateRepos is called for fro-bot
    // #then it returns matching names in pagination order (sort happens in buildRenovateFile)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('agent'), repo('.github'), repo('tokentoilet')])
    // probe order matches input order; resolve = present, reject 404 = absent
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent', '.github'])
  })

  it('calls paginate against listReposAccessibleToInstallation with per_page=100', async () => {
    // #given a target owner
    // #when discoverRenovateRepos is called
    // #then paginate uses the App installation listing endpoint (works for users and orgs)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([])

    await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(mocks.paginate).toHaveBeenCalledTimes(1)
    expect(mocks.paginate).toHaveBeenCalledWith(mocks.listReposAccessibleToInstallation, {per_page: 100})
  })

  it('filters out repos owned by accounts other than the target owner', async () => {
    // #given the installation lists repos under multiple owners
    // #when discoverRenovateRepos is called for fro-bot
    // #then repos owned by anyone other than fro-bot are skipped (no probe call)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([
      repo('agent', {owner: 'fro-bot'}),
      repo('config', {owner: 'marcusrbrown'}),
      repo('.github', {owner: 'fro-bot'}),
    ])
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent', '.github'])
    expect(mocks.getContent).toHaveBeenCalledTimes(2)
    expect(mocks.getContent).not.toHaveBeenCalledWith(expect.objectContaining({repo: 'config'}))
  })

  it('skips archived repos (no probe call for them)', async () => {
    // #given an archived repo in the listing
    // #when discoverRenovateRepos is called
    // #then no probe is issued for the archived repo and it is excluded from output
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('archived-repo', {archived: true}), repo('agent')])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent'])
    expect(mocks.getContent).toHaveBeenCalledTimes(1)
    expect(mocks.getContent).toHaveBeenCalledWith(expect.objectContaining({repo: 'agent'}))
  })

  it('skips forks (no probe call for them)', async () => {
    // #given a forked repo in the listing
    // #when discoverRenovateRepos is called
    // #then no probe is issued for the fork and it is excluded from output
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('forked-repo', {fork: true}), repo('agent')])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent'])
    expect(mocks.getContent).toHaveBeenCalledTimes(1)
  })

  it('treats 404 from probe as missing-config (not an error)', async () => {
    // #given a repo whose probe returns 404
    // #when discoverRenovateRepos is called
    // #then the repo is omitted from the result without throwing
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('no-renovate')])
    mocks.getContent.mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual([])
  })

  it('rethrows non-404 errors with repo context so the offending repo is identifiable', async () => {
    // #given a repo whose probe returns 500
    // #when discoverRenovateRepos is called
    // #then the error wraps the original with owner/repo and status context, and exposes the original via cause
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('broken-repo')])
    const original = Object.assign(new Error('Server Error'), {status: 500})
    mocks.getContent.mockRejectedValueOnce(original)

    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toThrow(/fro-bot\/broken-repo.*status=500/)
    // Re-run to inspect the cause chain (the previous expect consumed the rejection).
    mocks.paginate.mockResolvedValueOnce([repo('broken-repo')])
    mocks.getContent.mockRejectedValueOnce(original)
    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toMatchObject({cause: original})
  })

  it('propagates paginate rejections without probing any repos', async () => {
    // #given the installation listing call itself fails
    // #when discoverRenovateRepos is called
    // #then the error propagates and no per-repo probes happen
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API down'))

    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toThrow('API down')
    expect(mocks.getContent).not.toHaveBeenCalled()
  })

  it('returns an empty array when the installation has no repos', async () => {
    // #given an empty installation listing
    // #when discoverRenovateRepos is called
    // #then it returns []
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([])

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual([])
    expect(mocks.getContent).not.toHaveBeenCalled()
  })

  it('probes the canonical workflow path (.github/workflows/renovate.yaml)', async () => {
    // #given a single repo
    // #when discoverRenovateRepos is called
    // #then it probes exactly the canonical path under the correct owner/repo
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('agent')])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(mocks.getContent).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: 'agent',
      path: '.github/workflows/renovate.yaml',
    })
  })
})

// ─── Discovery / writer split (least-privilege App tokens) ──────────────────

const MUTATING_METHODS = ['createOrUpdateFileContents', 'createRef', 'update', 'create', 'createWorkflowDispatch']

interface SplitCall {
  client: 'discovery' | 'writer'
  method: string
  args?: unknown
}

/**
 * Adversarial discovery client: only installation listing and the single fixed
 * renovate probe path succeed. Anything else — every mutating call, any other
 * getContent path, any other read — throws.
 */
function makeDiscoveryClient(calls: SplitCall[], repos: ReturnType<typeof repo>[]) {
  const forbidden = (method: string) => () => {
    calls.push({client: 'discovery', method})
    throw new Error(`discovery client must not call ${method}`)
  }
  const listReposAccessibleToInstallation = vi.fn()
  const client = {
    paginate: vi.fn(async (fn: unknown) => {
      calls.push({client: 'discovery', method: 'paginate'})
      if (fn !== listReposAccessibleToInstallation) throw new Error('discovery paginate on unexpected endpoint')
      return repos
    }),
    rest: {
      apps: {listReposAccessibleToInstallation},
      repos: {
        getContent: vi.fn(async (args: {owner: string; repo: string; path: string}) => {
          calls.push({client: 'discovery', method: 'getContent', args})
          if (args.path !== '.github/workflows/renovate.yaml') {
            throw new Error(`discovery getContent outside probe path: ${args.path}`)
          }
          return {status: 200, data: {content: 'SECRET-RESPONSE-BODY'}}
        }),
        getBranch: forbidden('getBranch'),
        ...Object.fromEntries(MUTATING_METHODS.map(m => [m, forbidden(`repos.${m}`)])),
      },
      git: Object.fromEntries(MUTATING_METHODS.map(m => [m, forbidden(`git.${m}`)])),
      issues: Object.fromEntries(MUTATING_METHODS.map(m => [m, forbidden(`issues.${m}`)])),
      actions: Object.fromEntries(MUTATING_METHODS.map(m => [m, forbidden(`actions.${m}`)])),
    },
  }
  // `satisfies`, not a cast: the extra forbidden members stay on the object (that is the point of
  // the adversarial double) while the narrow production type is checked against it.
  return client satisfies DiscoveryClient
}

/**
 * Adversarial writer client: throws on installation listing and on reads of any
 * repo other than fro-bot/.github. Writes and same-repo reads succeed.
 */
function makeWriterClient(calls: SplitCall[]) {
  const guardRepo = (method: string, args: {owner: string; repo: string}) => {
    calls.push({client: 'writer', method, args})
    if (args.owner !== 'fro-bot' || args.repo !== '.github') {
      throw new Error(`writer client must not touch ${args.owner}/${args.repo}`)
    }
  }
  const listReposAccessibleToInstallation = vi.fn(() => {
    calls.push({client: 'writer', method: 'listReposAccessibleToInstallation'})
    throw new Error('writer client must not enumerate the installation')
  })
  const client = {
    paginate: vi.fn(async (fn: unknown) => {
      calls.push({client: 'writer', method: 'paginate'})
      if (fn === listReposAccessibleToInstallation) throw new Error('writer client must not enumerate the installation')
      return []
    }),
    rest: {
      apps: {listReposAccessibleToInstallation},
      repos: {
        getBranch: vi.fn(async (args: {owner: string; repo: string}) => {
          guardRepo('getBranch', args)
          return {data: {commit: {sha: 'abc'}, protected: false}}
        }),
        getContent: vi.fn(async (args: {owner: string; repo: string; path: string}) => {
          guardRepo('getContent', args)
          if (args.path === 'metadata/renovate.yaml') {
            return {
              data: {
                sha: 'file-sha',
                content: Buffer.from('repositories:\n  with-renovate: []\n').toString('base64'),
                encoding: 'base64',
                type: 'file',
              },
            }
          }
          throw Object.assign(new Error('Not Found'), {status: 404})
        }),
        createOrUpdateFileContents: vi.fn(async (args: {owner: string; repo: string}) => {
          guardRepo('createOrUpdateFileContents', args)
          return {data: {commit: {sha: 'new-sha'}}}
        }),
      },
    },
  }
  // Cast kept: `commitMetadata` takes the full `OctokitClient` (`CommitMetadataParams.octokit`),
  // so a writer double must present as one. Narrowing that belongs to commit-metadata.ts.
  return client as unknown as OctokitClient
}

describe('runUpdateMetadata (discovery/writer split)', () => {
  it('completes a full run under both adversarial mocks, committing through the writer only', async () => {
    // #given a discovery client that rejects writes/other paths and a writer that rejects enumeration/other repos
    const {runUpdateMetadata} = await import('./update-metadata.ts')
    const calls: SplitCall[] = []
    const discovery = makeDiscoveryClient(calls, [repo('agent'), repo('.github'), repo('archived', {archived: true})])
    const writer = makeWriterClient(calls)
    const commit = vi.fn(async (params: {octokit?: OctokitClient; mutator: (c: unknown) => unknown}) => {
      expect(params.octokit).toBe(writer)
      expect(await params.mutator({})).toEqual({repositories: {'with-renovate': ['.github', 'agent']}})
      return {committed: true, sha: 'new-sha', attempts: 1}
    })

    // #when the run executes
    const summary = await runUpdateMetadata({discovery, writer, owner: 'fro-bot', commit})

    // #then discovery probed only the fixed path and the writer carried the commit
    expect(summary).toEqual({owner: 'fro-bot', detected: 2, committed: true, attempts: 1})
    expect(commit).toHaveBeenCalledTimes(1)
    const discoveryCalls = calls.filter(c => c.client === 'discovery')
    expect(discoveryCalls.length).toBeGreaterThan(0)
    for (const c of calls.filter(c => c.method === 'getContent' && c.client === 'discovery')) {
      expect((c.args as {path: string}).path).toBe('.github/workflows/renovate.yaml')
    }
    expect(calls.filter(c => c.client === 'writer' && c.method === 'listReposAccessibleToInstallation')).toEqual([])
  })

  it('runs the real commitMetadata end to end: writer receives all writes, discovery receives none', async () => {
    // #given the real commitMetadata with an injected no-op bootstrap
    const {runUpdateMetadata} = await import('./update-metadata.ts')
    const calls: SplitCall[] = []
    const discovery = makeDiscoveryClient(calls, [repo('agent')])
    const writer = makeWriterClient(calls)

    // #when the run executes with the default commit implementation
    const {commitMetadata} = await import('./commit-metadata.ts')
    const bootstrapDataBranch = async (): Promise<DataBranchBootstrapResult> => ({
      created: false,
      ref: 'refs/heads/data',
      sha: 'data-sha',
    })
    const summary = await runUpdateMetadata({
      discovery,
      writer,
      owner: 'fro-bot',
      commit: async params => commitMetadata({...params, bootstrapDataBranch}),
    })

    // #then the file was written via the writer and nothing mutating hit discovery
    expect(summary.committed).toBe(true)
    expect(calls.filter(c => c.client === 'writer' && c.method === 'createOrUpdateFileContents')).toHaveLength(1)
    expect(calls.filter(c => c.client === 'discovery').every(c => ['paginate', 'getContent'].includes(c.method))).toBe(
      true,
    )
  })

  it('logs the summary only — never a response body', async () => {
    // #given probes returning a recognizable body
    const {runUpdateMetadata} = await import('./update-metadata.ts')
    const calls: SplitCall[] = []
    const discovery = makeDiscoveryClient(calls, [repo('agent')])
    const writer = makeWriterClient(calls)
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const errWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const consoleSpies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ]
    try {
      // #when the run executes
      await runUpdateMetadata({
        discovery,
        writer,
        owner: 'fro-bot',
        commit: async () => ({committed: false, attempts: 1}),
      })
      // #then no stream or console output carries the body
      const output = [
        ...write.mock.calls.map(c => String(c[0])),
        ...errWrite.mock.calls.map(c => String(c[0])),
        ...consoleSpies.flatMap(s => s.mock.calls.map(c => c.join(' '))),
      ].join('\n')
      expect(output).not.toContain('SECRET-RESPONSE-BODY')
    } finally {
      write.mockRestore()
      errWrite.mockRestore()
      for (const s of consoleSpies) s.mockRestore()
    }
  })

  it('discovery mock rejects non-probe getContent paths (adversarial self-check)', async () => {
    // #given the adversarial discovery mock
    const calls: SplitCall[] = []
    const discovery = makeDiscoveryClient(calls, [])
    // #then any other path throws
    await expect(
      discovery.rest.repos.getContent({owner: 'fro-bot', repo: 'agent', path: 'metadata/repos.yaml'}),
    ).rejects.toThrow(/outside probe path/)
  })
})

describe('createClientsFromEnv', () => {
  it('rejects a missing writer token before any discovery client is built or called', async () => {
    // #given only the discovery token is set
    const {runFromEnv} = await import('./update-metadata.ts')
    const createClient = vi.fn()
    const commit = vi.fn()

    // #when the entry point runs
    await expect(runFromEnv({UPDATE_METADATA_DISCOVERY_TOKEN: 'd'}, createClient, commit)).rejects.toThrow(
      /UPDATE_METADATA_WRITER_TOKEN is required/,
    )

    // #then no client was created and nothing was committed
    expect(createClient).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('rejects an empty writer token before any discovery call', async () => {
    const {runFromEnv} = await import('./update-metadata.ts')
    const createClient = vi.fn()
    await expect(
      runFromEnv({UPDATE_METADATA_DISCOVERY_TOKEN: 'd', UPDATE_METADATA_WRITER_TOKEN: ''}, createClient, vi.fn()),
    ).rejects.toThrow(/UPDATE_METADATA_WRITER_TOKEN is required/)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects a missing discovery token', async () => {
    const {runFromEnv} = await import('./update-metadata.ts')
    const createClient = vi.fn()
    await expect(runFromEnv({UPDATE_METADATA_WRITER_TOKEN: 'w'}, createClient, vi.fn())).rejects.toThrow(
      /UPDATE_METADATA_DISCOVERY_TOKEN is required/,
    )
    expect(createClient).not.toHaveBeenCalled()
  })

  it('builds one client per token and never reuses a token across roles', async () => {
    // #given both tokens
    const {runFromEnv} = await import('./update-metadata.ts')
    const calls: SplitCall[] = []
    const discoveryClient = makeDiscoveryClient(calls, [repo('agent')])
    const writerClient = makeWriterClient(calls)
    // Cast kept: `runFromEnv`'s single `createClient` factory returns the full `OctokitClient` for
    // both roles, so the narrow discovery double must present as one here.
    const createClient = vi.fn(async (token: string) =>
      token === 'd-tok' ? (discoveryClient as unknown as OctokitClient) : writerClient,
    )
    const commit = vi.fn(async (params: {octokit?: OctokitClient}) => {
      expect(params.octokit).toBe(writerClient)
      return {committed: false, attempts: 1}
    })

    // #when the entry point runs
    await runFromEnv(
      {UPDATE_METADATA_DISCOVERY_TOKEN: 'd-tok', UPDATE_METADATA_WRITER_TOKEN: 'w-tok'},
      createClient,
      commit,
    )

    // #then each token produced exactly one client
    expect(createClient.mock.calls.map(c => c[0]).sort()).toEqual(['d-tok', 'w-tok'])
  })
})
