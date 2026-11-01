import type {Octokit} from '@octokit/rest'
import type {RegistryIo} from './registry-io.ts'

import process from 'node:process'
import {createOctokit, OctokitLoadError} from '@fro-bot/core/github'
import {retry} from '@fro-bot/core/retry'

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
const CONFLICT_ALERT_TITLE_PREFIX = 'Conflicted data promotion PR:'
type MergeLabel = 'automerge' | 'needs-review'

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
  conflicted: boolean
  conflictAlertIssueNumber: number | null
  /**
   * True when the mergeable-state FETCH itself failed with a retryable error (timeout/5xx/rate-limit)
   * and we could not determine whether the PR is born-conflicted.
   * Distinct from a successfully-fetched `mergeable_state === 'unknown'` (GitHub still computing),
   * which is not an alarm condition. When true, callers should treat the run as non-clean (exit non-zero).
   */
  mergeabilityUnavailable: boolean
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

  // The changed-file list alone decides: `data` keeps history, so commits ahead of `main` (for
  // example the merge-back, whose first-parent diff is empty) do not mean there is anything to promote.
  if ((comparison.data.files?.length ?? 0) === 0) {
    return {
      createdPullRequest: false,
      pullRequestNumber: null,
      pullRequestUrl: null,
      label: null,
      journalIssueNumber: null,
      staleAlertIssueNumber: null,
      conflicted: false,
      conflictAlertIssueNumber: null,
      mergeabilityUnavailable: false,
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
    const mergeableState = await maybeUpdateBehindPullRequest({
      octokit,
      owner,
      repo,
      pullRequestNumber: existingPullRequest.number,
      logger,
    })
    await addLabel({octokit, owner, repo, issueNumber: existingPullRequest.number, label})

    const conflicted = mergeableState === 'dirty'
    const mergeabilityUnavailable = mergeableState === 'unavailable'
    let conflictAlertIssueNumber: number | null = null
    if (conflicted) {
      try {
        conflictAlertIssueNumber = await maybeCreateConflictAlert({
          octokit,
          owner,
          repo,
          pullRequestNumber: existingPullRequest.number,
          pullRequestUrl: existingPullRequest.html_url,
          headBranch,
          baseBranch,
        })
      } catch (error: unknown) {
        if (!isRetryableGitHubApiError(error)) throw error
        logger.warn(
          `${formatApiWarning(error, `creating conflict alert for PR #${existingPullRequest.number}`)}; next run will retry the alert.`,
        )
      }
    }

    return {
      createdPullRequest: true,
      pullRequestNumber: existingPullRequest.number,
      pullRequestUrl: existingPullRequest.html_url,
      label,
      journalIssueNumber: null,
      staleAlertIssueNumber,
      conflicted,
      conflictAlertIssueNumber,
      mergeabilityUnavailable,
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

    const mergeableState = await maybeUpdateBehindPullRequest({
      octokit,
      owner,
      repo,
      pullRequestNumber: pullRequest.data.number,
      logger,
    })
    await addLabel({octokit, owner, repo, issueNumber: pullRequest.data.number, label})

    const conflicted = mergeableState === 'dirty'
    const mergeabilityUnavailable = mergeableState === 'unavailable'
    let conflictAlertIssueNumber: number | null = null
    if (conflicted) {
      try {
        conflictAlertIssueNumber = await maybeCreateConflictAlert({
          octokit,
          owner,
          repo,
          pullRequestNumber: pullRequest.data.number,
          pullRequestUrl: pullRequest.data.html_url,
          headBranch,
          baseBranch,
        })
      } catch (error: unknown) {
        if (!isRetryableGitHubApiError(error)) throw error
        logger.warn(
          `${formatApiWarning(error, `creating conflict alert for PR #${pullRequest.data.number}`)}; next run will retry the alert.`,
        )
      }
    }

    return {
      createdPullRequest: true,
      pullRequestNumber: pullRequest.data.number,
      pullRequestUrl: pullRequest.data.html_url,
      label,
      journalIssueNumber: null,
      staleAlertIssueNumber,
      conflicted,
      conflictAlertIssueNumber,
      mergeabilityUnavailable,
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
        const mergeableState = await maybeUpdateBehindPullRequest({
          octokit,
          owner,
          repo,
          pullRequestNumber: pullRequest.number,
          logger,
        })
        await addLabel({octokit, owner, repo, issueNumber: pullRequest.number, label})

        const conflicted = mergeableState === 'dirty'
        const mergeabilityUnavailable = mergeableState === 'unavailable'
        let conflictAlertIssueNumber: number | null = null
        if (conflicted) {
          try {
            conflictAlertIssueNumber = await maybeCreateConflictAlert({
              octokit,
              owner,
              repo,
              pullRequestNumber: pullRequest.number,
              pullRequestUrl: pullRequest.html_url,
              headBranch,
              baseBranch,
            })
          } catch (error: unknown) {
            if (!isRetryableGitHubApiError(error)) throw error
            logger.warn(
              `${formatApiWarning(error, `creating conflict alert for PR #${pullRequest.number}`)}; next run will retry the alert.`,
            )
          }
        }

        return {
          createdPullRequest: true,
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.html_url,
          label,
          journalIssueNumber: null,
          staleAlertIssueNumber,
          conflicted,
          conflictAlertIssueNumber,
          mergeabilityUnavailable,
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
      conflicted: false,
      conflictAlertIssueNumber: null,
      mergeabilityUnavailable: false,
    }
  }
}

async function maybeUpdateBehindPullRequest(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
  logger: MergeDataPrLogger
}): Promise<string | null> {
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

    return 'unavailable'
  }

  if (pullRequest.data.mergeable_state === 'unknown') {
    params.logger.warn(
      `PR #${params.pullRequestNumber} mergeability stayed unknown after ${MERGEABLE_STATE_RETRY_COUNT + 1} checks; leaving the branch unchanged for this run.`,
    )

    return 'unknown'
  }

  if (pullRequest.data.mergeable_state !== 'behind') {
    return pullRequest.data.mergeable_state
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
      return 'behind'
    }

    // The server-side merge of `main` into the head conflicts: the PR is conflicted, so route it to
    // the conflict alert rather than failing the run with a generic API error.
    if (isMergeConflictError(error)) {
      return 'dirty'
    }

    if (isRetryableGitHubApiError(error)) {
      params.logger.warn(
        `${formatApiWarning(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)}; continuing because the PR already exists and a later run can retry the branch update.`,
      )

      return null
    }

    throw toMergeDataPrError(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)
  }

  return 'behind'
}

async function maybeCreateConflictAlert(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
  pullRequestUrl: string
  headBranch: string
  baseBranch: string
}): Promise<number | null> {
  // Paginate exhaustively over every open issue so dedup holds regardless of how many
  // are open; a single page could miss an existing alert and file a duplicate each run.
  const existingIssues = await params.octokit.paginate(params.octokit.rest.issues.listForRepo, {
    owner: params.owner,
    repo: params.repo,
    state: 'open',
    per_page: 100,
  })

  const existingAlert = existingIssues.find(issue => issue.title.startsWith(CONFLICT_ALERT_TITLE_PREFIX))

  if (existingAlert !== undefined) {
    return null
  }

  const alert = await params.octokit.rest.issues.create({
    owner: params.owner,
    repo: params.repo,
    title: `${CONFLICT_ALERT_TITLE_PREFIX} ${params.headBranch} -> ${params.baseBranch} (PR #${params.pullRequestNumber})`,
    body: createConflictAlertBody(params),
  })

  return alert.data.number
}

/**
 * File one open alert issue per exact `title`, paginating every open issue so dedup holds however
 * many are open. An existing alert keeps its place and gets the current `body`, so a persistent
 * condition stays one issue whose text follows the latest run. Returns the issue number.
 */
export async function upsertAlertIssue(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  title: string
  body: string
}): Promise<number> {
  const existingIssues = await params.octokit.paginate(params.octokit.rest.issues.listForRepo, {
    owner: params.owner,
    repo: params.repo,
    state: 'open',
    per_page: 100,
  })

  const existingAlert = existingIssues.find(issue => issue.title === params.title)

  if (existingAlert !== undefined) {
    await params.octokit.rest.issues.update({
      owner: params.owner,
      repo: params.repo,
      issue_number: existingAlert.number,
      body: params.body,
    })

    return existingAlert.number
  }

  const alert = await params.octokit.rest.issues.create({
    owner: params.owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
  })

  return alert.data.number
}

async function waitForKnownMergeableState(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
}) {
  return retry(async () => getPullRequest(params), {
    attempts: MERGEABLE_STATE_RETRY_COUNT + 1,
    delayMs: () => MERGEABLE_STATE_RETRY_DELAY_MS,
    retryResult: pullRequest => pullRequest.data.mergeable_state === 'unknown',
  })
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
  // The newest one-parent commit is the newest write: a merge-back has two parents and says nothing
  // about how long `data` writes have waited for promotion.
  const lastCommitDate = params.comparison.commits.findLast(commit => commit.parents.length === 1)?.commit?.committer
    ?.date

  if (lastCommitDate === undefined || lastCommitDate === null) {
    return null
  }

  const lastCommitAt = new Date(lastCommitDate)

  if (Number.isNaN(lastCommitAt.valueOf()) || params.now.getTime() - lastCommitAt.getTime() <= STALE_DIVERGENCE_MS) {
    return null
  }

  const alertTitle = `Stale data branch divergence: ${params.headBranch} is older than 14 days`

  // Paginate exhaustively over every open issue so dedup holds regardless of how many
  // are open; a single page could miss an existing alert and file a duplicate each run.
  const existingIssues = await params.octokit.paginate(params.octokit.rest.issues.listForRepo, {
    owner: params.owner,
    repo: params.repo,
    state: 'open',
    per_page: 100,
  })

  const existingAlert = existingIssues.find(issue => issue.title.startsWith('Stale data branch divergence:'))

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

    // The head commit's associated PRs include closed and merged ones, e.g. the last promotion.
    const pullRequest = response.data.find(candidate => {
      return (
        candidate.state === 'open' &&
        candidate.head?.ref === params.headBranch &&
        candidate.base?.ref === params.baseBranch
      )
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
  return retry(async () => findExistingPullRequestByBranch(params), {
    attempts: REDISCOVER_PULL_REQUEST_RETRY_COUNT + 1,
    delayMs: () => REDISCOVER_PULL_REQUEST_RETRY_DELAY_MS,
    shouldRetry: isRetryableGitHubApiError,
    retryResult: pullRequest => pullRequest === null,
  })
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
    ? 'automerge'
    : 'needs-review'
}

function createPullRequestBody(params: {
  baseBranch: string
  headBranch: string
  changedFiles: {filename: string}[]
}): string {
  return [
    `Automated data merge from ${params.headBranch} into ${params.baseBranch}.`,
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
    `Data merge from ${params.headBranch} into ${params.baseBranch} hit merge conflicts.`,
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
    `Latest write on ${params.headBranch}: ${params.lastCommitDate}.`,
    'Review the branch and merge backlog before autonomous data changes drift further.',
  ].join('\n')
}

function createConflictAlertBody(params: {
  pullRequestNumber: number
  pullRequestUrl: string
  headBranch: string
  baseBranch: string
}): string {
  const resolution =
    params.headBranch === DEFAULT_HEAD_BRANCH
      ? `Only the Fro Bot App writes \`${params.headBranch}\`, so do not push to it. The next merge-data run merges \`${params.baseBranch}\` back into it; if the PR is still conflicted after that run, the conflicting paths need a Fro Bot writer on \`${params.headBranch}\` to settle them.`
      : 'Manual resolution is required: resolve the conflicts, push to the head branch, and re-run the promotion.'
  return [
    `PR #${params.pullRequestNumber} (${params.pullRequestUrl}) is born conflicted.`,
    '',
    `The \`${params.headBranch}\` → \`${params.baseBranch}\` data promotion cannot be merged automatically.`,
    resolution,
    '',
    'This alert will not be duplicated while this issue remains open.',
  ].join('\n')
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  try {
    return await createOctokit(process.env.GITHUB_TOKEN, {
      missingToken: () =>
        new MergeDataPrError({
          code: 'MISSING_TOKEN',
          message: 'mergeDataPr requires params.octokit or GITHUB_TOKEN in the environment',
          remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
        }),
    })
  } catch (error: unknown) {
    if (!(error instanceof OctokitLoadError)) throw error
    if (error.reason === 'not-a-constructor') throw new TypeError('Invalid @octokit/rest Octokit export')
    throw new MergeDataPrError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }
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

/**
 * The CLI body: promotes `data` to `main`, prints the result as one JSON line, and returns exit code
 * 1 when the promotion PR is conflicted or its mergeability could not be read.
 */
export async function runMergeDataPr(
  io: RegistryIo,
  merge: () => Promise<MergeDataPrResult> = mergeDataPr,
): Promise<number> {
  const result = await merge()
  io.stdout(`${JSON.stringify(result)}\n`)

  return result.conflicted || result.mergeabilityUnavailable ? 1 : 0
}
