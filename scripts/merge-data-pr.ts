import process from 'node:process'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BASE_BRANCH = 'main'
const DEFAULT_HEAD_BRANCH = 'data'
const AUTO_MERGE_PATH_PREFIXES = ['knowledge/', 'metadata/'] as const
const STALE_DIVERGENCE_MS = 14 * 24 * 60 * 60 * 1000

type OctokitConstructor = new (params: {auth: string}) => OctokitClient
type MergeLabel = 'auto-merge' | 'needs-review'

export interface MergeDataPrParams {
  owner?: string
  repo?: string
  baseBranch?: string
  headBranch?: string
  octokit?: OctokitClient
  now?: Date
}

export interface MergeDataPrResult {
  createdPullRequest: boolean
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  label: MergeLabel | null
  journalIssueNumber: number | null
  staleAlertIssueNumber: number | null
}

export interface OctokitClient {
  rest: {
    repos: {
      compareCommitsWithBasehead: (params: {owner: string; repo: string; basehead: string}) => Promise<{
        data: {
          files?: {
            filename: string
          }[]
          merge_base_commit?: {
            sha: string
            commit?: {
              committer?: {
                date?: string | null
              }
            }
          }
          commits: {
            sha: string
            commit?: {
              committer?: {
                date?: string | null
              }
            }
          }[]
          ahead_by: number
          behind_by: number
          total_commits: number
        }
      }>
      listPullRequestsAssociatedWithCommit: (params: {owner: string; repo: string; commit_sha: string}) => Promise<{
        data: {
          number: number
          html_url: string
          head?: {
            ref?: string
          }
          base?: {
            ref?: string
          }
        }[]
      }>
    }
    pulls: {
      create: (params: {
        owner: string
        repo: string
        title: string
        head: string
        base: string
        body: string
      }) => Promise<{
        data: {
          number: number
          html_url: string
        }
      }>
    }
    issues: {
      addLabels: (params: {owner: string; repo: string; issue_number: number; labels: string[]}) => Promise<{
        data: {
          labels: {
            name: string
          }[]
        }
      }>
      create: (params: {owner: string; repo: string; title: string; body: string}) => Promise<{
        data: {
          number: number
          html_url: string
        }
      }>
      listForRepo: (params: {
        owner: string
        repo: string
        state: 'open' | 'closed' | 'all'
        per_page?: number
      }) => Promise<{
        data: {
          number: number
          title: string
          state: string
        }[]
      }>
    }
  }
}

export type MergeDataPrErrorCode = 'MISSING_TOKEN' | 'OCTOKIT_LOAD_FAILED' | 'API_ERROR'

export class MergeDataPrError extends Error {
  readonly code: MergeDataPrErrorCode
  readonly remediation: string

  constructor(params: {code: MergeDataPrErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'MergeDataPrError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

export async function mergeDataPr(params: MergeDataPrParams = {}): Promise<MergeDataPrResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const baseBranch = params.baseBranch ?? DEFAULT_BASE_BRANCH
  const headBranch = params.headBranch ?? DEFAULT_HEAD_BRANCH
  const now = params.now ?? new Date()
  const octokit = params.octokit ?? (await createOctokitFromEnv())

  const comparison = await compareBranches({octokit, owner, repo, baseBranch, headBranch})

  if (
    comparison.data.ahead_by === 0 ||
    comparison.data.total_commits === 0 ||
    (comparison.data.files?.length ?? 0) === 0
  ) {
    return {
      createdPullRequest: false,
      pullRequestNumber: null,
      pullRequestUrl: null,
      label: null,
      journalIssueNumber: null,
      staleAlertIssueNumber: null,
    }
  }

  const label = selectLabel(comparison.data.files ?? [])
  const staleAlertIssueNumber = await maybeCreateStaleDivergenceAlert({
    octokit,
    owner,
    repo,
    baseBranch,
    headBranch,
    comparison: comparison.data,
    now,
  })

  const existingPullRequest = await findExistingPullRequest({
    octokit,
    owner,
    repo,
    headBranch,
    baseBranch,
    commitSha: comparison.data.commits.at(-1)?.sha,
  })

  if (existingPullRequest !== null) {
    await addLabel({octokit, owner, repo, issueNumber: existingPullRequest.number, label})

    return {
      createdPullRequest: true,
      pullRequestNumber: existingPullRequest.number,
      pullRequestUrl: existingPullRequest.html_url,
      label,
      journalIssueNumber: null,
      staleAlertIssueNumber,
    }
  }

  try {
    const pullRequest = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `chore(data): merge ${headBranch} into ${baseBranch}`,
      head: headBranch,
      base: baseBranch,
      body: createPullRequestBody({baseBranch, headBranch, changedFiles: comparison.data.files ?? []}),
    })

    await addLabel({octokit, owner, repo, issueNumber: pullRequest.data.number, label})

    return {
      createdPullRequest: true,
      pullRequestNumber: pullRequest.data.number,
      pullRequestUrl: pullRequest.data.html_url,
      label,
      journalIssueNumber: null,
      staleAlertIssueNumber,
    }
  } catch (error: unknown) {
    if (!isMergeConflictError(error)) {
      throw toMergeDataPrError(error, `creating ${headBranch} -> ${baseBranch} pull request`)
    }

    const journalEntry = await octokit.rest.issues.create({
      owner,
      repo,
      title: `Merge conflict: ${headBranch} -> ${baseBranch}`,
      body: createConflictJournalBody({baseBranch, headBranch, changedFiles: comparison.data.files ?? []}),
    })

    return {
      createdPullRequest: false,
      pullRequestNumber: null,
      pullRequestUrl: null,
      label: null,
      journalIssueNumber: journalEntry.data.number,
      staleAlertIssueNumber,
    }
  }
}

async function compareBranches(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  baseBranch: string
  headBranch: string
}) {
  try {
    return await params.octokit.rest.repos.compareCommitsWithBasehead({
      owner: params.owner,
      repo: params.repo,
      basehead: `${params.baseBranch}...${params.headBranch}`,
    })
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `comparing ${params.baseBranch}...${params.headBranch}`)
  }
}

async function maybeCreateStaleDivergenceAlert(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  baseBranch: string
  headBranch: string
  comparison: Awaited<ReturnType<typeof compareBranches>>['data']
  now: Date
}): Promise<number | null> {
  const lastCommitDate = params.comparison.commits.at(-1)?.commit?.committer?.date

  if (lastCommitDate === undefined || lastCommitDate === null) {
    return null
  }

  const lastCommitAt = new Date(lastCommitDate)

  if (Number.isNaN(lastCommitAt.valueOf()) || params.now.getTime() - lastCommitAt.getTime() <= STALE_DIVERGENCE_MS) {
    return null
  }

  const alertTitle = `Stale data branch divergence: ${params.headBranch} is older than 14 days`

  const existingIssues = await params.octokit.rest.issues.listForRepo({
    owner: params.owner,
    repo: params.repo,
    state: 'open',
    per_page: 30,
  })

  const existingAlert = existingIssues.data.find(issue => issue.title.startsWith('Stale data branch divergence:'))

  if (existingAlert !== undefined) {
    return null
  }

  const alert = await params.octokit.rest.issues.create({
    owner: params.owner,
    repo: params.repo,
    title: alertTitle,
    body: createStaleAlertBody({
      baseBranch: params.baseBranch,
      headBranch: params.headBranch,
      aheadBy: params.comparison.ahead_by,
      lastCommitDate,
    }),
  })

  return alert.data.number
}

async function findExistingPullRequest(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  headBranch: string
  baseBranch: string
  commitSha: string | undefined
}): Promise<{number: number; html_url: string} | null> {
  if (params.commitSha === undefined) {
    return null
  }

  try {
    const response = await params.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner: params.owner,
      repo: params.repo,
      commit_sha: params.commitSha,
    })

    const pullRequest = response.data.find(candidate => {
      return candidate.head?.ref === params.headBranch && candidate.base?.ref === params.baseBranch
    })

    return pullRequest === undefined ? null : {number: pullRequest.number, html_url: pullRequest.html_url}
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `discovering existing pull requests for ${params.commitSha}`)
  }
}

async function addLabel(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  issueNumber: number
  label: MergeLabel
}): Promise<void> {
  try {
    await params.octokit.rest.issues.addLabels({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      labels: [params.label],
    })
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `adding ${params.label} label to PR #${params.issueNumber}`)
  }
}

function selectLabel(files: {filename: string}[]): MergeLabel {
  return files.every(file => AUTO_MERGE_PATH_PREFIXES.some(prefix => file.filename.startsWith(prefix)))
    ? 'auto-merge'
    : 'needs-review'
}

function createPullRequestBody(params: {
  baseBranch: string
  headBranch: string
  changedFiles: {filename: string}[]
}): string {
  return [
    `Automated weekly merge from ${params.headBranch} into ${params.baseBranch}.`,
    '',
    'Changed paths:',
    ...params.changedFiles.map(file => `- ${file.filename}`),
  ].join('\n')
}

function createConflictJournalBody(params: {
  baseBranch: string
  headBranch: string
  changedFiles: {filename: string}[]
}): string {
  return [
    `Weekly merge from ${params.headBranch} into ${params.baseBranch} hit merge conflicts.`,
    '',
    'Changed paths awaiting manual resolution:',
    ...params.changedFiles.map(file => `- ${file.filename}`),
  ].join('\n')
}

function createStaleAlertBody(params: {
  baseBranch: string
  headBranch: string
  aheadBy: number
  lastCommitDate: string
}): string {
  return [
    `${params.headBranch} is still ${params.aheadBy} commit(s) ahead of ${params.baseBranch}.`,
    `Latest commit on ${params.headBranch}: ${params.lastCommitDate}.`,
    'Review the branch and merge backlog before autonomous data changes drift further.',
  ].join('\n')
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new MergeDataPrError({
      code: 'MISSING_TOKEN',
      message: 'mergeDataPr requires params.octokit or GITHUB_TOKEN in the environment',
      remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
    })
  }

  const Octokit = await loadOctokitConstructor()

  return new Octokit({auth: token})
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')

  if (!isRecord(loaded) || !('Octokit' in loaded)) {
    throw new MergeDataPrError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }

  const octokit = loaded.Octokit

  if (typeof octokit !== 'function') {
    throw new TypeError('Invalid @octokit/rest Octokit export')
  }

  return octokit as OctokitConstructor
}

function isMergeConflictError(error: unknown): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === 422
}

function toMergeDataPrError(error: unknown, action: string): MergeDataPrError {
  const message = error instanceof Error ? error.message : `Unknown error while ${action}`

  return new MergeDataPrError({
    code: 'API_ERROR',
    message: `GitHub API error while ${action}: ${message}`,
    remediation:
      'Retry once. If the failure persists, inspect repository permissions, branch state, and GitHub API health.',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function main(): Promise<void> {
  const result = await mergeDataPr()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
