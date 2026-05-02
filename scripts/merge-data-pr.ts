import type {Octokit} from '@octokit/rest'
import process from 'node:process'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BASE_BRANCH = 'main'
const DEFAULT_HEAD_BRANCH = 'data'
const AUTO_MERGE_PATH_PREFIXES = ['knowledge/', 'metadata/'] as const
const STALE_DIVERGENCE_MS = 14 * 24 * 60 * 60 * 1000
const MERGEABLE_STATE_RETRY_COUNT = 2
const MERGEABLE_STATE_RETRY_DELAY_MS = 1000
const REDISCOVER_PULL_REQUEST_RETRY_COUNT = 1
const REDISCOVER_PULL_REQUEST_RETRY_DELAY_MS = 1000

type OctokitConstructor = new (params: {auth: string}) => OctokitClient
type MergeLabel = 'auto-merge' | 'needs-review'

export interface MergeDataPrParams {
  owner?: string
  repo?: string
  baseBranch?: string
  headBranch?: string
  octokit?: OctokitClient
  now?: Date
  logger?: MergeDataPrLogger
}

export interface MergeDataPrResult {
  createdPullRequest: boolean
  pullRequestNumber: number | null
  pullRequestUrl: string | null
  label: MergeLabel | null
  journalIssueNumber: number | null
  staleAlertIssueNumber: number | null
}

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

export interface MergeDataPrLogger {
  warn: (message: string) => void
}

export type MergeDataPrErrorCode = 'MISSING_TOKEN' | 'OCTOKIT_LOAD_FAILED' | 'API_ERROR'

const DEFAULT_LOGGER: MergeDataPrLogger = {
  warn(message) {
    process.stderr.write(`merge-data-pr: ${message}\n`)
  },
}

export class MergeDataPrError extends Error {
  readonly code: MergeDataPrErrorCode
  readonly remediation: string
  readonly status?: number
  readonly errorCode?: string

  constructor(params: {
    code: MergeDataPrErrorCode
    message: string
    remediation: string
    status?: number
    errorCode?: string
  }) {
    super(params.message)
    this.name = 'MergeDataPrError'
    this.code = params.code
    this.remediation = params.remediation
    this.status = params.status
    this.errorCode = params.errorCode
  }
}

export async function mergeDataPr(params: MergeDataPrParams = {}): Promise<MergeDataPrResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const baseBranch = params.baseBranch ?? DEFAULT_BASE_BRANCH
  const headBranch = params.headBranch ?? DEFAULT_HEAD_BRANCH
  const now = params.now ?? new Date()
  const octokit = params.octokit ?? (await createOctokitFromEnv())
  const logger = params.logger ?? DEFAULT_LOGGER

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
    await maybeUpdateBehindPullRequest({
      octokit,
      owner,
      repo,
      pullRequestNumber: existingPullRequest.number,
      logger,
    })
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

    await maybeUpdateBehindPullRequest({octokit, owner, repo, pullRequestNumber: pullRequest.data.number, logger})
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
    if (isAlreadyExistsPullRequestError(error)) {
      const pullRequest = await waitForExistingPullRequestByBranch({
        octokit,
        owner,
        repo,
        headBranch,
        baseBranch,
      })

      if (pullRequest !== null) {
        await maybeUpdateBehindPullRequest({
          octokit,
          owner,
          repo,
          pullRequestNumber: pullRequest.number,
          logger,
        })
        await addLabel({octokit, owner, repo, issueNumber: pullRequest.number, label})

        return {
          createdPullRequest: true,
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.html_url,
          label,
          journalIssueNumber: null,
          staleAlertIssueNumber,
        }
      }
    }

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

async function maybeUpdateBehindPullRequest(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
  logger: MergeDataPrLogger
}): Promise<void> {
  let pullRequest

  try {
    pullRequest = await waitForKnownMergeableState(params)
  } catch (error: unknown) {
    if (!isRetryableGitHubApiError(error)) {
      throw error
    }

    params.logger.warn(
      `${formatApiWarning(error, `fetching PR #${params.pullRequestNumber}`)}; continuing because the PR already exists and a later run can retry the branch update.`,
    )

    return
  }

  if (pullRequest.data.mergeable_state === 'unknown') {
    params.logger.warn(
      `PR #${params.pullRequestNumber} mergeability stayed unknown after ${MERGEABLE_STATE_RETRY_COUNT + 1} checks; leaving the branch unchanged for this run.`,
    )

    return
  }

  if (pullRequest.data.mergeable_state !== 'behind') {
    return
  }

  try {
    await params.octokit.rest.pulls.updateBranch({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullRequestNumber,
      expected_head_sha: pullRequest.data.head.sha,
    })
  } catch (error: unknown) {
    if (isExpectedHeadShaRace(error)) {
      return
    }

    if (isRetryableGitHubApiError(error)) {
      params.logger.warn(
        `${formatApiWarning(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)}; continuing because the PR already exists and a later run can retry the branch update.`,
      )

      return
    }

    throw toMergeDataPrError(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)
  }
}

async function waitForKnownMergeableState(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
}) {
  let pullRequest = await getPullRequest(params)

  for (
    let attemptsRemaining = MERGEABLE_STATE_RETRY_COUNT;
    pullRequest.data.mergeable_state === 'unknown';
    attemptsRemaining--
  ) {
    if (attemptsRemaining === 0) {
      return pullRequest
    }

    await delay(MERGEABLE_STATE_RETRY_DELAY_MS)
    pullRequest = await getPullRequest(params)
  }

  return pullRequest
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

async function getPullRequest(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
}) {
  try {
    return await params.octokit.rest.pulls.get({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullRequestNumber,
    })
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `fetching PR #${params.pullRequestNumber}`)
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

async function findExistingPullRequestByBranch(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  headBranch: string
  baseBranch: string
}): Promise<{number: number; html_url: string} | null> {
  try {
    const response = await params.octokit.rest.pulls.list({
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      head: `${params.owner}:${params.headBranch}`,
      base: params.baseBranch,
      per_page: 30,
    })

    const pullRequest = response.data.find(candidate => {
      return candidate.head?.ref === params.headBranch && candidate.base?.ref === params.baseBranch
    })

    return pullRequest === undefined ? null : {number: pullRequest.number, html_url: pullRequest.html_url}
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `discovering existing ${params.headBranch} -> ${params.baseBranch} pull request`)
  }
}

async function waitForExistingPullRequestByBranch(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  headBranch: string
  baseBranch: string
}): Promise<{number: number; html_url: string} | null> {
  let attemptsRemaining = REDISCOVER_PULL_REQUEST_RETRY_COUNT

  while (true) {
    try {
      const pullRequest = await findExistingPullRequestByBranch(params)

      if (pullRequest !== null || attemptsRemaining === 0) {
        return pullRequest
      }
    } catch (error: unknown) {
      if (!isRetryableGitHubApiError(error) || attemptsRemaining === 0) {
        throw error
      }
    }

    await delay(REDISCOVER_PULL_REQUEST_RETRY_DELAY_MS)
    attemptsRemaining--
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
  return has422Message(error, 'merge conflict')
}

function isStatus422(error: unknown): boolean {
  return getErrorStatus(error) === 422
}

function isExpectedHeadShaRace(error: unknown): boolean {
  if (!isStatus422(error) || !isRecord(error) || !('response' in error) || !isRecord(error.response)) {
    return false
  }

  const data = error.response.data

  if (!isRecord(data) || !('errors' in data) || !Array.isArray(data.errors)) {
    return false
  }

  return data.errors.some(item => {
    return (
      isRecord(item) &&
      item.field === 'expected_head_sha' &&
      typeof item.message === 'string' &&
      item.message.toLowerCase().includes('head sha')
    )
  })
}

function isRetryableGitHubApiError(error: unknown): boolean {
  const status = getErrorStatus(error)

  if (status === 429 || (status != null && status >= 500)) {
    return true
  }

  const errorCode = getErrorCode(error)

  if (
    errorCode === 'ECONNRESET' ||
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'ETIMEDOUT'
  ) {
    return true
  }

  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()

  return message.includes('secondary rate limit') || message.includes('timeout') || message.includes('timed out')
}

function formatApiWarning(error: unknown, action: string): string {
  return toMergeDataPrError(error, action).message
}

function getErrorStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === 'number' ? error.status : undefined
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined
  }

  if (typeof error.errorCode === 'string') {
    return error.errorCode
  }

  return typeof error.code === 'string' ? error.code : undefined
}

function isAlreadyExistsPullRequestError(error: unknown): boolean {
  return has422Message(error, 'a pull request already exists')
}

function has422Message(error: unknown, fragment: string): boolean {
  if (!isStatus422(error) || !isRecord(error) || !('response' in error) || !isRecord(error.response)) {
    return false
  }

  const data = error.response.data

  if (!isRecord(data)) {
    return false
  }

  const normalizedFragment = fragment.toLowerCase()

  if (typeof data.message === 'string' && data.message.toLowerCase().includes(normalizedFragment)) {
    return true
  }

  if (!('errors' in data) || !Array.isArray(data.errors)) {
    return false
  }

  return data.errors.some(item => {
    return isRecord(item) && typeof item.message === 'string' && item.message.toLowerCase().includes(normalizedFragment)
  })
}

function toMergeDataPrError(error: unknown, action: string): MergeDataPrError {
  if (error instanceof MergeDataPrError) {
    return error
  }

  const message = error instanceof Error ? error.message : `Unknown error while ${action}`

  return new MergeDataPrError({
    code: 'API_ERROR',
    message: `GitHub API error while ${action}: ${message}`,
    remediation:
      'Retry once. If the failure persists, inspect repository permissions, branch state, and GitHub API health.',
    status: getErrorStatus(error),
    errorCode: getErrorCode(error),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds)
  })
}

async function main(): Promise<void> {
  const result = await mergeDataPr()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
