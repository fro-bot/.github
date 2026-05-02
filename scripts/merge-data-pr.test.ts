import type {MergeDataPrLogger, OctokitClient} from './merge-data-pr.ts'
import {describe, expect, it, vi} from 'vitest'
import {mergeDataPr, MergeDataPrError} from './merge-data-pr.ts'

interface CreateIssueParams {
  owner: string
  repo: string
  title: string
  body: string
}

function isoDaysAgo(daysAgo: number): string {
  return new Date(Date.UTC(2026, 3, 16 - daysAgo, 0, 0, 0)).toISOString()
}

interface MockOverrides {
  compareCommitsWithBasehead?: (params: {owner: string; repo: string; basehead: string}) => Promise<unknown>
  listPullRequestsAssociatedWithCommit?: (params: {owner: string; repo: string; commit_sha: string}) => Promise<unknown>
  listPullRequests?: (params: {
    owner: string
    repo: string
    state: 'open' | 'closed' | 'all'
    head?: string
    base?: string
    per_page?: number
  }) => Promise<unknown>
  getPullRequest?: (params: {owner: string; repo: string; pull_number: number}) => Promise<unknown>
  createPullRequest?: (params: {
    owner: string
    repo: string
    title: string
    head: string
    base: string
    body: string
  }) => Promise<unknown>
  updateBranch?: (params: {
    owner: string
    repo: string
    pull_number: number
    expected_head_sha?: string
  }) => Promise<unknown>
  addLabels?: (params: {owner: string; repo: string; issue_number: number; labels: string[]}) => Promise<unknown>
  createIssue?: (params: {owner: string; repo: string; title: string; body: string}) => Promise<unknown>
  listForRepo?: (params: {
    owner: string
    repo: string
    state: 'open' | 'closed' | 'all'
    per_page?: number
  }) => Promise<unknown>
}

function mockOctokit(overrides?: MockOverrides): OctokitClient {
  return {
    rest: {
      repos: {
        compareCommitsWithBasehead:
          overrides?.compareCommitsWithBasehead ??
          (async () => ({
            data: {
              files: [{filename: 'knowledge/runbooks/test.md'}],
              merge_base_commit: {sha: 'merge-base-sha', commit: {committer: {date: isoDaysAgo(1)}}},
              commits: [{sha: 'data-commit-sha', commit: {committer: {date: isoDaysAgo(1)}}}],
              ahead_by: 1,
              behind_by: 0,
              total_commits: 1,
            },
          })),
        listPullRequestsAssociatedWithCommit:
          overrides?.listPullRequestsAssociatedWithCommit ?? (async () => ({data: []})),
      },
      pulls: {
        list: overrides?.listPullRequests ?? (async () => ({data: []})),
        get:
          overrides?.getPullRequest ??
          (async () => ({
            data: {mergeable_state: 'clean', head: {sha: 'data-commit-sha'}},
          })),
        create:
          overrides?.createPullRequest ??
          (async () => ({
            data: {number: 42, html_url: 'https://github.com/fro-bot/.github/pull/42'},
          })),
        updateBranch: overrides?.updateBranch ?? (async () => ({data: {}})),
      },
      issues: {
        addLabels: overrides?.addLabels ?? (async () => ({data: {labels: [{name: 'auto-merge'}]}})),
        create:
          overrides?.createIssue ??
          (async () => ({
            data: {number: 99, html_url: 'https://github.com/fro-bot/.github/issues/99'},
          })),
        listForRepo: overrides?.listForRepo ?? (async () => ({data: []})),
      },
    },
  } as unknown as OctokitClient
}

function mockLogger(): MergeDataPrLogger {
  return {
    warn: vi.fn(),
  }
}

describe('mergeDataPr', () => {
  it('opens PR with auto-merge label when only knowledge and metadata files changed', async () => {
    const createPullRequest = vi.fn(async () => ({
      data: {number: 42, html_url: 'https://github.com/fro-bot/.github/pull/42'},
    }))
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'auto-merge'}]}}))
    const octokit = mockOctokit({createPullRequest, addLabels})

    // #when the merge PR script runs for docs-only changes
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it opens and labels the PR for auto-merge
    expect(result.createdPullRequest).toBe(true)
    expect(result.label).toBe('auto-merge')
    expect(result.pullRequestNumber).toBe(42)
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 42,
      labels: ['auto-merge'],
    })
  })

  it('opens PR with needs-review label when code files changed', async () => {
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'needs-review'}]}}))
    const octokit = mockOctokit({
      compareCommitsWithBasehead: async () => ({
        data: {
          files: [{filename: 'scripts/merge-data-pr.ts'}],
          merge_base_commit: {sha: 'merge-base-sha', commit: {committer: {date: isoDaysAgo(1)}}},
          commits: [{sha: 'code-commit-sha', commit: {committer: {date: isoDaysAgo(1)}}}],
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
        },
      }),
      addLabels,
    })

    // #when the merge PR script runs for code changes
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it marks the PR for manual review
    expect(result.createdPullRequest).toBe(true)
    expect(result.label).toBe('needs-review')
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 42,
      labels: ['needs-review'],
    })
  })

  it('is a no-op when data and main are identical', async () => {
    const createPullRequest = vi.fn(async () => ({
      data: {number: 42, html_url: 'https://github.com/fro-bot/.github/pull/42'},
    }))
    const octokit = mockOctokit({
      compareCommitsWithBasehead: async () => ({
        data: {
          files: [],
          merge_base_commit: {sha: 'merge-base-sha', commit: {committer: {date: isoDaysAgo(1)}}},
          commits: [],
          ahead_by: 0,
          behind_by: 0,
          total_commits: 0,
        },
      }),
      createPullRequest,
    })

    // #when the merge PR script runs with no diff
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it exits without opening a PR
    expect(result.createdPullRequest).toBe(false)
    expect(result.label).toBeNull()
    expect(createPullRequest).not.toHaveBeenCalled()
  })

  it('creates a journal entry when merge conflicts are detected', async () => {
    let createIssueParams: CreateIssueParams | undefined
    const createIssue = vi.fn(async (params: CreateIssueParams) => {
      createIssueParams = params

      return {
        data: {number: 99, html_url: 'https://github.com/fro-bot/.github/issues/99'},
      }
    })
    const octokit = mockOctokit({
      createIssue,
      createPullRequest: async () => {
        // #given GitHub rejects the PR with merge conflicts
        throw Object.assign(new Error('Merge conflict'), {
          status: 422,
          response: {data: {message: 'Merge conflict'}},
        })
      },
    })

    // #when the merge PR script runs
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it records a journal entry instead of failing hard
    expect(result.createdPullRequest).toBe(false)
    expect(result.journalIssueNumber).toBe(99)
    expect(createIssueParams).toBeDefined()
    if (createIssueParams == null) {
      throw new Error('expected merge conflict journal issue parameters')
    }
    const issueParams: CreateIssueParams = createIssueParams
    expect(issueParams.owner).toBe('fro-bot')
    expect(issueParams.repo).toBe('.github')
    expect(issueParams.title).toContain('Merge conflict')
  })

  it('creates a stale-divergence alert when data is more than two weeks ahead', async () => {
    let createIssueParams: CreateIssueParams | undefined
    const createIssue = vi.fn(async (params: CreateIssueParams) => {
      createIssueParams = params

      return {
        data: {number: 77, html_url: 'https://github.com/fro-bot/.github/issues/77'},
      }
    })
    const octokit = mockOctokit({
      compareCommitsWithBasehead: async () => ({
        data: {
          files: [{filename: 'metadata/repos.yaml'}],
          merge_base_commit: {sha: 'merge-base-sha', commit: {committer: {date: isoDaysAgo(20)}}},
          commits: [{sha: 'stale-data-commit-sha', commit: {committer: {date: isoDaysAgo(20)}}}],
          ahead_by: 3,
          behind_by: 0,
          total_commits: 3,
        },
      }),
      createIssue,
    })

    // #when the merge PR script runs on a stale branch
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it emits a stale-divergence alert alongside the PR
    expect(result.createdPullRequest).toBe(true)
    expect(result.staleAlertIssueNumber).toBe(77)
    expect(createIssueParams).toBeDefined()
    if (createIssueParams == null) {
      throw new Error('expected stale divergence issue parameters')
    }
    const issueParams: CreateIssueParams = createIssueParams
    expect(issueParams.owner).toBe('fro-bot')
    expect(issueParams.repo).toBe('.github')
    expect(issueParams.title).toContain('Stale data branch divergence')
  })

  it('reuses existing PR and applies label when one already exists for data branch', async () => {
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'auto-merge'}]}}))
    const createPullRequest = vi.fn(async () => ({
      data: {number: 42, html_url: 'https://github.com/fro-bot/.github/pull/42'},
    }))
    const octokit = mockOctokit({
      listPullRequestsAssociatedWithCommit: async () => ({
        data: [
          {
            number: 55,
            html_url: 'https://github.com/fro-bot/.github/pull/55',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }),
      createPullRequest,
      addLabels,
    })

    // #given an existing PR already targets data -> main
    // #when the merge PR script runs
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it reuses the existing PR and does not create a new one
    expect(result.createdPullRequest).toBe(true)
    expect(result.pullRequestNumber).toBe(55)
    expect(result.pullRequestUrl).toBe('https://github.com/fro-bot/.github/pull/55')
    expect(createPullRequest).not.toHaveBeenCalled()
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 55,
      labels: ['auto-merge'],
    })
  })

  it('updates a newly created PR branch when mergeable_state is behind', async () => {
    const updateBranch = vi.fn(async () => ({data: {}}))
    const getPullRequest = vi.fn(async () => ({
      data: {mergeable_state: 'behind', head: {sha: 'new-pr-head-sha'}},
    }))
    const octokit = mockOctokit({getPullRequest, updateBranch})

    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(getPullRequest).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 42,
    })
    expect(updateBranch).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 42,
      expected_head_sha: 'new-pr-head-sha',
    })
  })

  it('updates an existing PR branch when mergeable_state is behind', async () => {
    const updateBranch = vi.fn(async () => ({data: {}}))
    const getPullRequest = vi.fn(async () => ({
      data: {mergeable_state: 'behind', head: {sha: 'existing-pr-head-sha'}},
    }))
    const octokit = mockOctokit({
      listPullRequestsAssociatedWithCommit: async () => ({
        data: [
          {
            number: 55,
            html_url: 'https://github.com/fro-bot/.github/pull/55',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }),
      getPullRequest,
      updateBranch,
    })

    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.pullRequestNumber).toBe(55)
    expect(getPullRequest).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 55,
    })
    expect(updateBranch).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 55,
      expected_head_sha: 'existing-pr-head-sha',
    })
  })

  it('retries mergeable_state unknown until it resolves behind', async () => {
    vi.useFakeTimers()

    try {
      const updateBranch = vi.fn(async () => ({data: {}}))
      const getPullRequest = vi.fn(async () => ({
        data: {mergeable_state: 'behind', head: {sha: 'resolved-head-sha'}},
      }))
      getPullRequest
        .mockResolvedValueOnce({data: {mergeable_state: 'unknown', head: {sha: 'new-pr-head-sha'}}})
        .mockResolvedValueOnce({data: {mergeable_state: 'behind', head: {sha: 'resolved-head-sha'}}})
      const octokit = mockOctokit({getPullRequest, updateBranch})

      const resultPromise = mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.createdPullRequest).toBe(true)
      expect(getPullRequest).toHaveBeenCalledTimes(2)
      expect(updateBranch).toHaveBeenCalledWith({
        owner: 'fro-bot',
        repo: '.github',
        pull_number: 42,
        expected_head_sha: 'resolved-head-sha',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips updateBranch after bounded unknown mergeability retries', async () => {
    vi.useFakeTimers()

    try {
      const logger = mockLogger()
      const updateBranch = vi.fn(async () => ({data: {}}))
      const getPullRequest = vi.fn(async () => ({
        data: {mergeable_state: 'unknown', head: {sha: 'new-pr-head-sha'}},
      }))
      const octokit = mockOctokit({getPullRequest, updateBranch})

      const resultPromise = mergeDataPr({octokit, logger, now: new Date('2026-04-16T00:00:00.000Z')})

      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.createdPullRequest).toBe(true)
      expect(getPullRequest).toHaveBeenCalledTimes(3)
      expect(updateBranch).not.toHaveBeenCalled()
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        'PR #42 mergeability stayed unknown after 3 checks; leaving the branch unchanged for this run.',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips updateBranch when mergeability resolves to a known non-behind state', async () => {
    vi.useFakeTimers()

    try {
      const updateBranch = vi.fn(async () => ({data: {}}))
      const getPullRequest = vi.fn(async () => ({
        data: {mergeable_state: 'clean', head: {sha: 'resolved-head-sha'}},
      }))
      getPullRequest
        .mockResolvedValueOnce({data: {mergeable_state: 'unknown', head: {sha: 'new-pr-head-sha'}}})
        .mockResolvedValueOnce({data: {mergeable_state: 'clean', head: {sha: 'resolved-head-sha'}}})
      const octokit = mockOctokit({getPullRequest, updateBranch})

      const resultPromise = mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.createdPullRequest).toBe(true)
      expect(getPullRequest).toHaveBeenCalledTimes(2)
      expect(updateBranch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats updateBranch expected_head_sha 422 as a no-op race', async () => {
    const updateBranch = vi.fn(async () => {
      throw Object.assign(new Error('Validation Failed'), {
        status: 422,
        response: {
          data: {
            message: 'Validation Failed',
            errors: [{field: 'expected_head_sha', message: 'Head SHA is out of date'}],
          },
        },
      })
    })
    const octokit = mockOctokit({
      getPullRequest: async () => ({
        data: {mergeable_state: 'behind', head: {sha: 'existing-pr-head-sha'}},
      }),
      updateBranch,
    })

    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(updateBranch).toHaveBeenCalledOnce()
  })

  it('throws a structured error when updateBranch returns a non-race 422', async () => {
    const updateBranch = vi.fn(async () => {
      throw Object.assign(new Error('Validation Failed'), {
        status: 422,
        response: {
          data: {
            message: 'Validation Failed',
            errors: [{field: 'base', message: 'Branch update blocked by protection rule'}],
          },
        },
      })
    })
    const octokit = mockOctokit({
      getPullRequest: async () => ({
        data: {mergeable_state: 'behind', head: {sha: 'existing-pr-head-sha'}},
      }),
      updateBranch,
    })

    const error = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')}).catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(MergeDataPrError)
    expect((error as MergeDataPrError).message).toContain('updating PR #42 branch')
  })

  it('warns and continues when updateBranch fails transiently', async () => {
    const logger = mockLogger()
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'auto-merge'}]}}))
    const updateBranch = vi.fn(async () => {
      throw Object.assign(new Error('Branch update failed'), {status: 503})
    })
    const octokit = mockOctokit({
      addLabels,
      getPullRequest: async () => ({
        data: {mergeable_state: 'behind', head: {sha: 'existing-pr-head-sha'}},
      }),
      updateBranch,
    })

    const result = await mergeDataPr({octokit, logger, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(result.pullRequestNumber).toBe(42)
    expect(updateBranch).toHaveBeenCalledOnce()
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 42,
      labels: ['auto-merge'],
    })
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('updating PR #42 branch'))
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('continuing because the PR already exists and a later run can retry the branch update'),
    )
  })

  it('warns and continues when fetching a newly created PR fails', async () => {
    const logger = mockLogger()
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'auto-merge'}]}}))
    const octokit = mockOctokit({
      addLabels,
      getPullRequest: async () => {
        throw Object.assign(new Error('PR lookup failed'), {status: 503})
      },
    })

    const result = await mergeDataPr({octokit, logger, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(result.label).toBe('auto-merge')
    expect(result.pullRequestNumber).toBe(42)
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 42,
      labels: ['auto-merge'],
    })
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'GitHub API error while fetching PR #42: PR lookup failed; continuing because the PR already exists and a later run can retry the branch update.',
    )
  })

  it('warns and continues when fetching a newly created PR hits a transient transport error', async () => {
    const logger = mockLogger()
    const octokit = mockOctokit({
      getPullRequest: async () => {
        throw Object.assign(new Error('socket hang up'), {code: 'ECONNRESET'})
      },
    })

    const result = await mergeDataPr({octokit, logger, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(result.pullRequestNumber).toBe(42)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('fetching PR #42'))
  })

  it('throws when mergeability probing fails permanently after an unknown retry', async () => {
    vi.useFakeTimers()

    try {
      const getPullRequest = vi.fn(async () => ({
        data: {mergeable_state: 'behind', head: {sha: 'resolved-head-sha'}},
      }))
      getPullRequest
        .mockResolvedValueOnce({data: {mergeable_state: 'unknown', head: {sha: 'new-pr-head-sha'}}})
        .mockRejectedValueOnce(Object.assign(new Error('PR not found'), {status: 404}))
      const octokit = mockOctokit({getPullRequest})

      const resultPromise = mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})
      const errorPromise = resultPromise.catch((error: unknown) => error)

      await vi.runAllTimersAsync()

      const error = await errorPromise

      expect(error).toBeInstanceOf(MergeDataPrError)
      expect((error as MergeDataPrError).message).toContain('fetching PR #42')
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when fetching a newly created PR fails permanently', async () => {
    const octokit = mockOctokit({
      getPullRequest: async () => {
        throw Object.assign(new Error('PR not found'), {status: 404})
      },
    })

    const error = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')}).catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(MergeDataPrError)
    expect((error as MergeDataPrError).message).toContain('fetching PR #42')
  })

  it('throws when fetching an existing PR fails permanently', async () => {
    const octokit = mockOctokit({
      listPullRequestsAssociatedWithCommit: async () => ({
        data: [
          {
            number: 55,
            html_url: 'https://github.com/fro-bot/.github/pull/55',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }),
      getPullRequest: async () => {
        throw Object.assign(new Error('PR not found'), {status: 404})
      },
    })

    const error = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')}).catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(MergeDataPrError)
    expect((error as MergeDataPrError).message).toContain('fetching PR #55')
  })

  it('warns and continues when fetching an existing PR fails', async () => {
    const logger = mockLogger()
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'auto-merge'}]}}))
    const octokit = mockOctokit({
      listPullRequestsAssociatedWithCommit: async () => ({
        data: [
          {
            number: 55,
            html_url: 'https://github.com/fro-bot/.github/pull/55',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }),
      getPullRequest: async () => {
        throw Object.assign(new Error('PR lookup failed'), {status: 503})
      },
      addLabels,
    })

    const result = await mergeDataPr({octokit, logger, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(result.pullRequestNumber).toBe(55)
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 55,
      labels: ['auto-merge'],
    })
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'GitHub API error while fetching PR #55: PR lookup failed; continuing because the PR already exists and a later run can retry the branch update.',
    )
  })

  it('reuses the existing PR when createPullRequest returns a duplicate-PR 422', async () => {
    const addLabels = vi.fn(async () => ({data: {labels: [{name: 'auto-merge'}]}}))
    const listPullRequests = async () => {
      return {
        data: [
          {
            number: 88,
            html_url: 'https://github.com/fro-bot/.github/pull/88',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }
    }
    const octokit = mockOctokit({
      addLabels,
      listPullRequests,
      createPullRequest: async () => {
        // #given GitHub reports the PR already exists after the initial lookup missed it
        throw Object.assign(new Error('Validation Failed'), {
          status: 422,
          response: {
            data: {
              message: 'Validation Failed',
              errors: [{message: 'A pull request already exists for fro-bot:data.'}],
            },
          },
        })
      },
    })

    // #when the merge PR script runs during that race
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it recovers by reusing the existing PR instead of journaling a fake conflict
    expect(result.createdPullRequest).toBe(true)
    expect(result.pullRequestNumber).toBe(88)
    expect(result.pullRequestUrl).toBe('https://github.com/fro-bot/.github/pull/88')
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: '.github',
      issue_number: 88,
      labels: ['auto-merge'],
    })
  })

  it('retries duplicate-PR rediscovery before failing when the PR is not listed immediately', async () => {
    vi.useFakeTimers()

    try {
      const listPullRequests = vi.fn(async () => ({
        data: [
          {
            number: 88,
            html_url: 'https://github.com/fro-bot/.github/pull/88',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }))
      listPullRequests.mockResolvedValueOnce({data: []}).mockResolvedValueOnce({
        data: [
          {
            number: 88,
            html_url: 'https://github.com/fro-bot/.github/pull/88',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      })
      const octokit = mockOctokit({
        listPullRequests,
        createPullRequest: async () => {
          throw Object.assign(new Error('Validation Failed'), {
            status: 422,
            response: {
              data: {
                message: 'Validation Failed',
                errors: [{message: 'A pull request already exists for fro-bot:data.'}],
              },
            },
          })
        },
      })

      const resultPromise = mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.createdPullRequest).toBe(true)
      expect(result.pullRequestNumber).toBe(88)
      expect(listPullRequests).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries duplicate-PR rediscovery after a transient pull listing failure', async () => {
    vi.useFakeTimers()

    try {
      const listPullRequests = vi.fn(async () => ({
        data: [
          {
            number: 88,
            html_url: 'https://github.com/fro-bot/.github/pull/88',
            head: {ref: 'data'},
            base: {ref: 'main'},
          },
        ],
      }))
      listPullRequests
        .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), {code: 'ECONNRESET'}))
        .mockResolvedValueOnce({
          data: [
            {
              number: 88,
              html_url: 'https://github.com/fro-bot/.github/pull/88',
              head: {ref: 'data'},
              base: {ref: 'main'},
            },
          ],
        })
      const octokit = mockOctokit({
        listPullRequests,
        createPullRequest: async () => {
          throw Object.assign(new Error('Validation Failed'), {
            status: 422,
            response: {
              data: {
                message: 'Validation Failed',
                errors: [{message: 'A pull request already exists for fro-bot:data.'}],
              },
            },
          })
        },
      })

      const resultPromise = mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

      await vi.runAllTimersAsync()

      const result = await resultPromise

      expect(result.createdPullRequest).toBe(true)
      expect(result.pullRequestNumber).toBe(88)
      expect(listPullRequests).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('detects duplicate-PR 422s from the top-level message', async () => {
    const listPullRequests = vi.fn(async () => ({
      data: [
        {
          number: 88,
          html_url: 'https://github.com/fro-bot/.github/pull/88',
          head: {ref: 'data'},
          base: {ref: 'main'},
        },
      ],
    }))
    const octokit = mockOctokit({
      listPullRequests,
      createPullRequest: async () => {
        throw Object.assign(new Error('A pull request already exists for fro-bot:data.'), {
          status: 422,
          response: {
            data: {
              message: 'A pull request already exists for fro-bot:data.',
              errors: [],
            },
          },
        })
      },
    })

    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(true)
    expect(result.pullRequestNumber).toBe(88)
  })

  it('creates a journal entry when merge conflicts are reported in 422 error items', async () => {
    const createIssue = vi.fn(async () => ({
      data: {number: 99, html_url: 'https://github.com/fro-bot/.github/issues/99'},
    }))
    const octokit = mockOctokit({
      createIssue,
      createPullRequest: async () => {
        throw Object.assign(new Error('Validation Failed'), {
          status: 422,
          response: {
            data: {
              message: 'Validation Failed',
              errors: [{message: 'Merge conflict between base and head branches'}],
            },
          },
        })
      },
    })

    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    expect(result.createdPullRequest).toBe(false)
    expect(result.journalIssueNumber).toBe(99)
    expect(createIssue).toHaveBeenCalledOnce()
  })

  it('throws a structured error for non-conflict 422 createPullRequest failures', async () => {
    const octokit = mockOctokit({
      createPullRequest: async () => {
        throw Object.assign(new Error('Validation Failed'), {
          status: 422,
          response: {
            data: {
              message: 'Validation Failed',
              errors: [{field: 'base', message: 'Branch update blocked by protection rule'}],
            },
          },
        })
      },
    })

    const error = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')}).catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(MergeDataPrError)
    expect((error as MergeDataPrError).message).toContain('creating data -> main pull request')
  })

  it('skips stale-divergence alert when an existing open alert issue matches', async () => {
    const createIssue = vi.fn(async () => ({
      data: {number: 77, html_url: 'https://github.com/fro-bot/.github/issues/77'},
    }))
    const listForRepo = vi.fn(async () => ({
      data: [
        {
          number: 60,
          title: 'Stale data branch divergence: data is older than 14 days',
          state: 'open' as const,
        },
      ],
    }))
    const octokit = mockOctokit({
      compareCommitsWithBasehead: async () => ({
        data: {
          files: [{filename: 'metadata/repos.yaml'}],
          merge_base_commit: {sha: 'merge-base-sha', commit: {committer: {date: isoDaysAgo(20)}}},
          commits: [{sha: 'stale-data-commit-sha', commit: {committer: {date: isoDaysAgo(20)}}}],
          ahead_by: 3,
          behind_by: 0,
          total_commits: 3,
        },
      }),
      createIssue,
      listForRepo,
    })

    // #given the data branch is stale and an existing stale alert is already open
    // #when the merge PR script runs
    const result = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')})

    // #then it does NOT create a duplicate stale alert
    expect(result.staleAlertIssueNumber).toBeNull()
    expect(createIssue).not.toHaveBeenCalled()
    expect(listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'fro-bot',
        repo: '.github',
        state: 'open',
      }),
    )
  })

  it('throws a structured error on non-conflict API failures', async () => {
    const octokit = mockOctokit({
      compareCommitsWithBasehead: async () => {
        // #given GitHub compare fails unexpectedly
        throw Object.assign(new Error('Compare failed'), {status: 500})
      },
    })

    // #when the merge PR script runs
    const error = await mergeDataPr({octokit, now: new Date('2026-04-16T00:00:00.000Z')}).catch(
      (error: unknown) => error,
    )

    // #then it surfaces a structured API error
    expect(error).toBeInstanceOf(MergeDataPrError)
    expect((error as MergeDataPrError).code).toBe('API_ERROR')
    expect((error as MergeDataPrError).message).toContain('Compare failed')
  })
})
