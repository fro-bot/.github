import type {OctokitClient} from './merge-data-pr.js'
import {describe, expect, it, vi} from 'vitest'
import {mergeDataPr, MergeDataPrError} from './merge-data-pr.js'

interface CreateIssueParams {
  owner: string
  repo: string
  title: string
  body: string
}

function isoDaysAgo(daysAgo: number): string {
  return new Date(Date.UTC(2026, 3, 16 - daysAgo, 0, 0, 0)).toISOString()
}

function mockOctokit(overrides?: {
  compareCommitsWithBasehead?: OctokitClient['rest']['repos']['compareCommitsWithBasehead']
  listPullRequestsAssociatedWithCommit?: OctokitClient['rest']['repos']['listPullRequestsAssociatedWithCommit']
  createPullRequest?: OctokitClient['rest']['pulls']['create']
  addLabels?: OctokitClient['rest']['issues']['addLabels']
  createIssue?: OctokitClient['rest']['issues']['create']
}): OctokitClient {
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
        create:
          overrides?.createPullRequest ??
          (async () => ({
            data: {number: 42, html_url: 'https://github.com/fro-bot/.github/pull/42'},
          })),
      },
      issues: {
        addLabels: overrides?.addLabels ?? (async () => ({data: {labels: [{name: 'auto-merge'}]}})),
        create:
          overrides?.createIssue ??
          (async () => ({
            data: {number: 99, html_url: 'https://github.com/fro-bot/.github/issues/99'},
          })),
      },
    },
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
        throw Object.assign(new Error('Merge conflict'), {status: 422})
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
