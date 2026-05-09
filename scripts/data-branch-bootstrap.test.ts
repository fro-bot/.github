import type {OctokitClient} from './data-branch-bootstrap.ts'
import {describe, expect, it, vi} from 'vitest'
import {bootstrapDataBranch, DataBranchBootstrapError} from './data-branch-bootstrap.ts'

interface MockOverrides {
  getBranch?: (params: {owner: string; repo: string; branch: string}) => Promise<unknown>
  getCommit?: (params: {owner: string; repo: string; commit_sha: string}) => Promise<unknown>
  createCommit?: (params: {
    owner: string
    repo: string
    message: string
    tree: string
    parents: string[]
    author: {name: string; email: string}
    committer: {name: string; email: string}
  }) => Promise<unknown>
  createRef?: (params: {owner: string; repo: string; ref: string; sha: string}) => Promise<unknown>
}

function mockOctokit(overrides?: MockOverrides): OctokitClient {
  return {
    rest: {
      repos: {
        getBranch:
          overrides?.getBranch ??
          (async ({branch}: {branch: string}) => ({
            data: {
              name: branch,
              commit: {sha: `${branch}-sha`},
            },
          })),
      },
      git: {
        getCommit:
          overrides?.getCommit ??
          (async (params: {commit_sha: string}) => ({
            data: {sha: params.commit_sha, tree: {sha: `${params.commit_sha}-tree`}},
          })),
        createCommit: overrides?.createCommit ?? (async () => ({data: {sha: 'data-bootstrap-sha'}})),
        createRef: overrides?.createRef ?? (async () => ({data: {ref: 'refs/heads/data'}})),
      },
    },
  } as unknown as OctokitClient
}

describe('bootstrapDataBranch', () => {
  it('creates data branch from a Fro Bot-authored same-tree commit when branch does not exist', async () => {
    const createCommit = vi.fn(async () => ({data: {sha: 'data-restore-sha'}}))
    const createRef = vi.fn(async () => ({data: {ref: 'refs/heads/data'}}))
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        // #given data is missing and main exists
        if (branch === 'data') {
          throw Object.assign(new Error('Not Found'), {status: 404})
        }

        return {data: {name: 'main', commit: {sha: 'main-head-sha'}}}
      },
      getCommit: async () => ({data: {sha: 'main-head-sha', tree: {sha: 'main-tree-sha'}}}),
      createCommit,
      createRef,
    })

    // #when the bootstrap runs
    const result = await bootstrapDataBranch({octokit})

    // #then it creates data from a same-tree commit attributed to the Fro Bot bot identity
    expect(result.created).toBe(true)
    expect(result.ref).toBe('refs/heads/data')
    expect(result.sha).toBe('data-restore-sha')
    expect(createCommit).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      message: 'chore(data): restore data branch',
      tree: 'main-tree-sha',
      parents: ['main-head-sha'],
      author: {
        name: 'fro-bot[bot]',
        email: '109017866+fro-bot[bot]@users.noreply.github.com',
      },
      committer: {
        name: 'fro-bot[bot]',
        email: '109017866+fro-bot[bot]@users.noreply.github.com',
      },
    })
    expect(createRef).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      ref: 'refs/heads/data',
      sha: 'data-restore-sha',
    })
  })

  it('treats a concurrent createRef race as success when data exists afterward', async () => {
    let dataLookups = 0
    const createRef = vi.fn(async () => {
      throw Object.assign(new Error('Reference already exists'), {status: 422})
    })
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        if (branch === 'data') {
          dataLookups += 1
          if (dataLookups === 1) {
            throw Object.assign(new Error('Not Found'), {status: 404})
          }
          return {data: {name: 'data', commit: {sha: 'concurrent-data-sha'}}}
        }

        return {data: {name: 'main', commit: {sha: 'main-head-sha'}}}
      },
      getCommit: async (params: {commit_sha: string}) => ({
        data: {
          sha: params.commit_sha,
          tree: {sha: 'main-tree-sha'},
          message: 'chore(data): restore data branch',
          author: {
            name: 'fro-bot[bot]',
            email: '109017866+fro-bot[bot]@users.noreply.github.com',
          },
          committer: {
            name: 'fro-bot[bot]',
            email: '109017866+fro-bot[bot]@users.noreply.github.com',
          },
          parents: params.commit_sha === 'concurrent-data-sha' ? [{sha: 'main-head-sha'}] : [],
        },
      }),
      createCommit: async () => ({data: {sha: 'data-restore-sha'}}),
      createRef,
    })

    const result = await bootstrapDataBranch({octokit})

    expect(result).toEqual({created: false, ref: 'refs/heads/data', sha: 'concurrent-data-sha'})
    expect(createRef).toHaveBeenCalledOnce()
  })

  it('treats a concurrent createRef race as success when another writer already advanced data', async () => {
    let dataLookups = 0
    const getCommit = vi.fn(async (params: {commit_sha: string}) => ({
      data: {
        sha: params.commit_sha,
        tree: {sha: params.commit_sha === 'main-head-sha' ? 'main-tree-sha' : 'writer-tree-sha'},
        message: params.commit_sha === 'main-head-sha' ? 'main commit' : 'chore(reconcile): update metadata',
        parents: params.commit_sha === 'writer-commit-sha' ? [{sha: 'data-restore-sha'}] : [],
      },
    }))
    const createRef = vi.fn(async () => {
      throw Object.assign(new Error('Reference already exists'), {status: 422})
    })
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        if (branch === 'data') {
          dataLookups += 1
          if (dataLookups === 1) {
            throw Object.assign(new Error('Not Found'), {status: 404})
          }

          return {data: {name: 'data', commit: {sha: 'writer-commit-sha'}}}
        }

        return {data: {name: 'main', commit: {sha: 'main-head-sha'}}}
      },
      getCommit,
      createCommit: async () => ({data: {sha: 'data-restore-sha'}}),
      createRef,
    })

    const result = await bootstrapDataBranch({octokit})

    expect(result).toEqual({created: false, ref: 'refs/heads/data', sha: 'writer-commit-sha'})
    expect(getCommit).toHaveBeenCalledOnce()
    expect(getCommit).toHaveBeenCalledWith({owner: 'fro-bot', repo: '.github', commit_sha: 'main-head-sha'})
    expect(createRef).toHaveBeenCalledOnce()
  })

  it('throws a structured error when createRef returns 422 but data still does not exist', async () => {
    const createRef = vi.fn(async () => {
      throw Object.assign(new Error('Reference already exists'), {status: 422})
    })
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        if (branch === 'data') {
          throw Object.assign(new Error('Not Found'), {status: 404})
        }

        return {data: {name: 'main', commit: {sha: 'main-head-sha'}}}
      },
      getCommit: async () => ({data: {sha: 'main-head-sha', tree: {sha: 'main-tree-sha'}, parents: []}}),
      createCommit: async () => ({data: {sha: 'data-restore-sha'}}),
      createRef,
    })

    const error = await bootstrapDataBranch({octokit}).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(DataBranchBootstrapError)
    expect((error as DataBranchBootstrapError).code).toBe('API_ERROR')
    expect((error as DataBranchBootstrapError).message).toContain('creating data from main')
  })

  it('is a no-op when data branch already exists', async () => {
    const createRef = vi.fn(async () => ({data: {ref: 'refs/heads/data'}}))
    const octokit = mockOctokit({createRef})

    // #when the bootstrap runs against an existing branch
    const result = await bootstrapDataBranch({octokit})

    // #then it does not create a new ref
    expect(result.created).toBe(false)
    expect(result.ref).toBe('refs/heads/data')
    expect(result.sha).toBe('data-sha')
    expect(createRef).not.toHaveBeenCalled()
  })

  it('throws a structured error when main branch is not found', async () => {
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        // #given data is missing and main is also missing
        throw Object.assign(new Error(branch === 'main' ? 'Main Not Found' : 'Data Not Found'), {status: 404})
      },
    })

    // #when the bootstrap runs
    const error = await bootstrapDataBranch({octokit}).catch((error: unknown) => error)

    // #then it returns a structured main-branch error
    expect(error).toBeInstanceOf(DataBranchBootstrapError)
    expect((error as DataBranchBootstrapError).code).toBe('MAIN_BRANCH_NOT_FOUND')
    expect((error as DataBranchBootstrapError).remediation).toContain('main')
  })

  it('throws a structured error on non-404 API failures', async () => {
    const octokit = mockOctokit({
      getBranch: async () => {
        // #given GitHub returns an unexpected API failure
        throw Object.assign(new Error('GitHub exploded'), {status: 500})
      },
    })

    // #when the bootstrap runs
    const error = await bootstrapDataBranch({octokit}).catch((error: unknown) => error)

    // #then it surfaces a structured API error
    expect(error).toBeInstanceOf(DataBranchBootstrapError)
    expect((error as DataBranchBootstrapError).code).toBe('API_ERROR')
    expect((error as DataBranchBootstrapError).message).toContain('GitHub exploded')
  })
})
