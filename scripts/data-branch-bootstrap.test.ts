import type {OctokitClient} from './data-branch-bootstrap.js'
import {describe, expect, it, vi} from 'vitest'
import {bootstrapDataBranch, DataBranchBootstrapError} from './data-branch-bootstrap.js'

function mockOctokit(overrides?: {
  getBranch?: OctokitClient['rest']['repos']['getBranch']
  createRef?: OctokitClient['rest']['git']['createRef']
}): OctokitClient {
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
        createRef: overrides?.createRef ?? (async () => ({data: {ref: 'refs/heads/data'}})),
      },
    },
  }
}

describe('bootstrapDataBranch', () => {
  it('creates data branch from main HEAD SHA when branch does not exist', async () => {
    const createRef = vi.fn(async () => ({data: {ref: 'refs/heads/data'}}))
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        // #given data is missing and main exists
        if (branch === 'data') {
          throw Object.assign(new Error('Not Found'), {status: 404})
        }

        return {data: {name: 'main', commit: {sha: 'main-head-sha'}}}
      },
      createRef,
    })

    // #when the bootstrap runs
    const result = await bootstrapDataBranch({octokit})

    // #then it creates data from main HEAD
    expect(result.created).toBe(true)
    expect(result.ref).toBe('refs/heads/data')
    expect(result.sha).toBe('main-head-sha')
    expect(createRef).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      ref: 'refs/heads/data',
      sha: 'main-head-sha',
    })
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
