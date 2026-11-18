/**
 * Opens or reuses the `data` -> `main` promotion PR and labels it `automerge` or `needs-review`.
 *
 * An open promotion PR is reused only while the base it recorded is the merge base of the pinned `data` commit and
 * `main`, the `main` commit this run's merge-back absorbed. A PR with another base is closed with a marker comment
 * and replaced by a fresh PR in the same run, because the merge-back moved its merge base and GitHub then dismisses
 * an approval given to it. A PR that carries `hold-merge` is never replaced, so no replacement has a hold to lose.
 * A closed, unmerged PR keeps the promotion closed unless a bot left the marker comment on it and a bot closed it
 * (the operator closed any other).
 */

import type {Octokit} from '@octokit/rest'
import type {RegistryIo} from './registry-io.ts'

import process from 'node:process'
import {createOctokit, OctokitLoadError} from '@fro-bot/core/github'
import {writeGithubOutputs} from '@fro-bot/core/output'
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
/** The label that stops the self-merge step; `promotion-self-merge.ts` reads the same name. */
const HOLD_MERGE_LABEL = 'hold-merge'
/**
 * The first line of the comment a run leaves on a promotion PR it closes because its merge base moved. A later run
 * reads it, on a comment by a bot, to tell that closure from the operator's.
 */
const REPLACED_PULL_REQUEST_MARKER = '<!-- merge-data-pr: replaced, merge base moved -->'
type MergeLabel = 'automerge' | 'needs-review'

export interface MergeDataPrParams {
  owner?: string
  repo?: string
  baseBranch?: string
  headBranch?: string
  octokit?: OctokitClient
  now?: Date
  logger?: MergeDataPrLogger
  /**
   * The `data` commit the privacy gates checked. The compare runs against it, the PR is never brought up
   * to date (a push after the gates would move the head they checked), and `mergeableState` reports
   * `behind` instead.
   */
  pin?: string
  /** The qualification of the promotion at the pin. When given it decides the label; otherwise the file list does. */
  qualifies?: boolean
  /**
   * Whether to open a PR when the newest closed `data` -> `main` PR was closed unmerged. Defaults to true;
   * the promotion run passes false unless the run asked for a review refresh.
   */
  recreateClosedPullRequest?: boolean
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
  /** The PR head as the API reports it, or null when no PR was read or opened. */
  headSha: string | null
  /** `mergeable_state` of the PR: `behind` is reported, not repaired, for a pinned run. Null when no PR was read. */
  mergeableState: string | null
  /** True when the run left the newest closed PR closed because the operator closed it. */
  closedPullRequestKept: boolean
  /** True when a pin was given and the PR head is another commit, so the labels were left as they were. */
  headMovedFromPin: boolean
  /** True when a pin was given and the PR head could not be freshly read, so the labels were left as they were. */
  headUnverified: boolean
  /** The number of the open PR this run closed because its merge base moved and replaced with `pullRequestNumber`, or null. */
  replacedPullRequestNumber: number | null
}

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

export interface MergeDataPrLogger {
  warn: (message: string) => void
}

export type MergeDataPrErrorCode = 'MISSING_TOKEN' | 'OCTOKIT_LOAD_FAILED' | 'API_ERROR' | 'INVALID_PIN'

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

  const comparison = await compareBranches({octokit, owner, repo, baseBranch, headRef: params.pin ?? headBranch})

  // The changed-file list alone decides: `data` keeps history, so commits ahead of `main` (for
  // example the merge-back, whose first-parent diff is empty) do not mean there is anything to promote.
  if ((comparison.data.files?.length ?? 0) === 0) {
    return emptyResult({label: null, staleAlertIssueNumber: null})
  }

  const files = comparison.data.files ?? []
  const label = params.qualifies === undefined ? selectLabel(files) : params.qualifies ? 'automerge' : 'needs-review'
  const staleAlertIssueNumber = await maybeCreateStaleDivergenceAlert({
    octokit,
    owner,
    repo,
    baseBranch,
    headBranch,
    comparison: comparison.data,
    now,
  })

  const settle = {octokit, owner, repo, headBranch, baseBranch, logger, label, staleAlertIssueNumber, pin: params.pin}

  const existingPullRequest = await findExistingPullRequest({
    octokit,
    owner,
    repo,
    headBranch,
    baseBranch,
    commitSha: comparison.data.commits.at(-1)?.sha,
  })

  // An open PR is reused unless its base is not the merge base of the pin and `baseBranch`; then the run closes it
  // and falls through to the create below, so the fresh PR is created after this run's merge-back like any new one.
  const mergeBaseSha = comparison.data.merge_base_commit?.sha ?? null
  let replacedPullRequestNumber: number | null = null

  if (existingPullRequest !== null) {
    if (!(await replacePullRequestWithStaleBase({...settle, mergeBaseSha}, existingPullRequest))) {
      return settlePullRequest(settle, existingPullRequest)
    }
    replacedPullRequestNumber = existingPullRequest.number
  } else if (params.recreateClosedPullRequest === false) {
    // The commit lookup can miss an open PR, so look by branch before the closed-PR rule can hide it.
    const openByBranch = await findExistingPullRequestByBranch({octokit, owner, repo, headBranch, baseBranch})
    if (openByBranch === null) {
      // A closed, unmerged promotion PR is the operator's decision: only a run that asked for a review
      // refresh opens another. A PR this code closed for a moved merge base is not (see the marker).
      const newestClosed = await readNewestClosedPullRequest({octokit, owner, repo, headBranch, baseBranch, logger})
      if (newestClosed.closedByOperator) {
        return {...emptyResult({label: null, staleAlertIssueNumber}), closedPullRequestKept: true}
      }
    } else {
      if (!(await replacePullRequestWithStaleBase({...settle, mergeBaseSha}, openByBranch))) {
        return settlePullRequest(settle, openByBranch)
      }
      replacedPullRequestNumber = openByBranch.number
    }
  }

  const settleNew = {...settle, replacedPullRequestNumber}

  try {
    const pullRequest = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `chore(data): merge ${headBranch} into ${baseBranch}`,
      head: headBranch,
      base: baseBranch,
      body: createPullRequestBody({baseBranch, headBranch, changedFiles: files}),
    })

    return await settlePullRequest(settleNew, {
      number: pullRequest.data.number,
      html_url: pullRequest.data.html_url,
      headSha: pullRequest.data.head?.sha ?? null,
    })
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
        return settlePullRequest(settleNew, pullRequest)
      }
    }

    if (!isMergeConflictError(error)) {
      throw toMergeDataPrError(error, `creating ${headBranch} -> ${baseBranch} pull request`)
    }

    const journalEntry = await octokit.rest.issues.create({
      owner,
      repo,
      title: `Merge conflict: ${headBranch} -> ${baseBranch}`,
      body: createConflictJournalBody({baseBranch, headBranch, changedFiles: files}),
    })

    return {...emptyResult({label: null, staleAlertIssueNumber}), journalIssueNumber: journalEntry.data.number}
  }
}

function emptyResult(params: {label: MergeLabel | null; staleAlertIssueNumber: number | null}): MergeDataPrResult {
  return {
    createdPullRequest: false,
    pullRequestNumber: null,
    pullRequestUrl: null,
    label: params.label,
    journalIssueNumber: null,
    staleAlertIssueNumber: params.staleAlertIssueNumber,
    conflicted: false,
    conflictAlertIssueNumber: null,
    mergeabilityUnavailable: false,
    headSha: null,
    mergeableState: null,
    closedPullRequestKept: false,
    headMovedFromPin: false,
    headUnverified: false,
    replacedPullRequestNumber: null,
  }
}

/** What the three routes to a PR (found by commit, created, found by branch after a duplicate 422) share. */
async function settlePullRequest(
  context: {
    octokit: OctokitClient
    owner: string
    repo: string
    headBranch: string
    baseBranch: string
    logger: MergeDataPrLogger
    label: MergeLabel
    staleAlertIssueNumber: number | null
    pin: string | undefined
    /** The PR this run closed for a moved merge base, when `pullRequest` replaces one. */
    replacedPullRequestNumber?: number | null
  },
  pullRequest: {number: number; html_url: string; headSha?: string | null},
): Promise<MergeDataPrResult> {
  const {octokit, owner, repo, headBranch, baseBranch, logger} = context
  const replacedPullRequestNumber = context.replacedPullRequestNumber ?? null
  if (replacedPullRequestNumber !== null) {
    logger.warn(`replaced #${replacedPullRequestNumber} with #${pullRequest.number}: its merge base moved`)
  }
  const state = await maybeUpdateBehindPullRequest({
    octokit,
    owner,
    repo,
    pullRequestNumber: pullRequest.number,
    logger,
    pin: context.pin,
  })
  // The labels describe the commit the gates checked. They apply only when the PR head was freshly read and
  // is the pin. A head that is another commit, or one that could not be read (the create response is not a
  // read), keeps the labels the PR has; the self-merge step stops on a mismatch, and a later gated run
  // labels the new head.
  const readHead = state.headSha
  const headMoved = context.pin !== undefined && readHead !== null && readHead !== context.pin
  const headUnverified = context.pin !== undefined && readHead === null
  if (headMoved) {
    logger.warn(
      `PR #${pullRequest.number} head is not the pinned commit the gates checked; leaving its labels as they are.`,
    )
  } else if (headUnverified) {
    logger.warn(`PR #${pullRequest.number} head could not be read; leaving its labels as they are.`)
  } else {
    await replaceLabel({octokit, owner, repo, issueNumber: pullRequest.number, label: context.label})
  }

  const conflicted = state.mergeableState === 'dirty'
  const mergeabilityUnavailable = state.mergeableState === 'unavailable'
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
    label: headMoved || headUnverified ? null : context.label,
    journalIssueNumber: null,
    staleAlertIssueNumber: context.staleAlertIssueNumber,
    conflicted,
    conflictAlertIssueNumber,
    mergeabilityUnavailable,
    headSha: state.headSha ?? pullRequest.headSha ?? null,
    mergeableState: state.mergeableState,
    closedPullRequestKept: false,
    headMovedFromPin: headMoved,
    headUnverified,
    replacedPullRequestNumber,
  }
}

async function maybeUpdateBehindPullRequest(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
  logger: MergeDataPrLogger
  pin: string | undefined
}): Promise<{mergeableState: string | null; headSha: string | null}> {
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

    return {mergeableState: 'unavailable', headSha: null}
  }

  const headSha = pullRequest.data.head.sha

  if (pullRequest.data.mergeable_state === 'unknown') {
    params.logger.warn(
      `PR #${params.pullRequestNumber} mergeability stayed unknown after ${MERGEABLE_STATE_RETRY_COUNT + 1} checks; leaving the branch unchanged for this run.`,
    )

    return {mergeableState: 'unknown', headSha}
  }

  if (pullRequest.data.mergeable_state !== 'behind') {
    return {mergeableState: pullRequest.data.mergeable_state, headSha}
  }

  // A pinned run has already gated its commit: a push now would move the head past what the gates saw.
  // The merge-back keeps `data` current, so the next run catches the PR up.
  if (params.pin !== undefined) {
    params.logger.warn(
      `PR #${params.pullRequestNumber} is behind the base branch; leaving the head unchanged so the gated commit stays the head.`,
    )

    return {mergeableState: 'behind', headSha}
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
      return {mergeableState: 'behind', headSha}
    }

    // The server-side merge of `main` into the head conflicts: the PR is conflicted, so route it to
    // the conflict alert rather than failing the run with a generic API error.
    if (isMergeConflictError(error)) {
      return {mergeableState: 'dirty', headSha}
    }

    if (isRetryableGitHubApiError(error)) {
      params.logger.warn(
        `${formatApiWarning(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)}; continuing because the PR already exists and a later run can retry the branch update.`,
      )

      return {mergeableState: null, headSha}
    }

    throw toMergeDataPrError(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)
  }

  return {mergeableState: 'behind', headSha}
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
  headRef: string
}) {
  try {
    return await params.octokit.rest.repos.compareCommitsWithBasehead({
      owner: params.owner,
      repo: params.repo,
      basehead: `${params.baseBranch}...${params.headRef}`,
    })
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `comparing ${params.baseBranch}...${params.headRef}`)
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
}): Promise<FoundPullRequest | null> {
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

    return pullRequest === undefined ? null : toFoundPullRequest(pullRequest)
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
}): Promise<FoundPullRequest | null> {
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

    return pullRequest === undefined ? null : toFoundPullRequest(pullRequest)
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `discovering existing ${params.headBranch} -> ${params.baseBranch} pull request`)
  }
}

/** An open promotion PR a lookup found. `baseSha` is the base branch commit the PR recorded when it was opened. */
interface FoundPullRequest {
  number: number
  html_url: string
  baseSha: string | null
}

function toFoundPullRequest(pullRequest: {
  number: number
  html_url: string
  base?: {sha?: string} | null
}): FoundPullRequest {
  return {number: pullRequest.number, html_url: pullRequest.html_url, baseSha: pullRequest.base?.sha ?? null}
}

/**
 * Closes an open promotion PR whose recorded base is not `mergeBaseSha`, the merge base of the pinned head and
 * `baseBranch`, and returns whether it did.
 *
 * A merge-back brings `baseBranch` commits into the head, which changes the PR's merge base after a review was
 * given, and GitHub then dismisses that review ("The merge-base changed after approval."). The merge base of the
 * pin and `baseBranch` is the commit the merge-back absorbed, and `baseBranch` advancing after the merge-back does
 * not change it; a PR opened after the merge-back records it as its base and keeps its approval. This applies to
 * `automerge` and `needs-review` PRs alike, except one that carries `hold-merge`: that PR stays open, so the hold
 * is never moved to another PR, and once the operator removes the label the next run replaces it.
 *
 * Only a base that can be compared decides. When the merge base, or the PR's base, is missing the PR is reused and
 * the run logs one fixed line: the check protects the approval, and a missing value does not stop a promotion that
 * would otherwise proceed (the self-merge step still refuses to merge without a standing approval). A failure to read
 * the labels, or to comment on or close the PR, throws, so a stale PR never reaches the approval step as if it had
 * been replaced.
 */
async function replacePullRequestWithStaleBase(
  context: {
    octokit: OctokitClient
    owner: string
    repo: string
    logger: MergeDataPrLogger
    mergeBaseSha: string | null
  },
  pullRequest: FoundPullRequest,
): Promise<boolean> {
  const {octokit, owner, repo, logger, mergeBaseSha} = context
  if (mergeBaseSha === null || pullRequest.baseSha === null) {
    logger.warn(`could not compare the merge base of PR #${pullRequest.number}; reusing it.`)
    return false
  }
  if (pullRequest.baseSha === mergeBaseSha) return false

  // The labels are read before anything is written: a held PR is left as it is.
  let labels
  try {
    labels = await octokit.paginate(octokit.rest.issues.listLabelsOnIssue, {
      owner,
      repo,
      issue_number: pullRequest.number,
      per_page: 100,
    })
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `reading the labels of PR #${pullRequest.number}`)
  }
  if (labels.some(label => label.name === HOLD_MERGE_LABEL)) {
    logger.warn(
      `PR #${pullRequest.number} carries ${HOLD_MERGE_LABEL}; its merge base moved, so it stays open and is not replaced while held.`,
    )
    return false
  }

  // The comment goes first: a close without the marker would read as the operator's closure on a later run, and a
  // marker on a PR whose close failed counts only with a bot as the closing actor (see the closed-PR rule).
  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullRequest.number,
      body: createReplacedPullRequestComment(),
    })
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `commenting on PR #${pullRequest.number}`)
  }
  try {
    await octokit.rest.pulls.update({owner, repo, pull_number: pullRequest.number, state: 'closed'})
  } catch (error: unknown) {
    throw toMergeDataPrError(error, `closing PR #${pullRequest.number}`)
  }

  return true
}

function createReplacedPullRequestComment(): string {
  return [
    REPLACED_PULL_REQUEST_MARKER,
    'A fresh promotion PR replaces this one: its merge base moved, and GitHub would dismiss an approval on it.',
  ].join('\n')
}

async function waitForExistingPullRequestByBranch(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  headBranch: string
  baseBranch: string
}): Promise<FoundPullRequest | null> {
  return retry(async () => findExistingPullRequestByBranch(params), {
    attempts: REDISCOVER_PULL_REQUEST_RETRY_COUNT + 1,
    delayMs: () => REDISCOVER_PULL_REQUEST_RETRY_DELAY_MS,
    shouldRetry: isRetryableGitHubApiError,
    retryResult: pullRequest => pullRequest === null,
  })
}

/**
 * Gives the PR `label` and takes the other of the two off it. The new label goes on first, so the PR is
 * never unlabeled; any other label, `hold-merge` included, is left as it is.
 */
async function replaceLabel(params: {
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

  const stale: MergeLabel = params.label === 'automerge' ? 'needs-review' : 'automerge'
  try {
    await params.octokit.rest.issues.removeLabel({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      name: stale,
    })
  } catch (error: unknown) {
    // The PR never carried the other label: nothing to remove.
    if (getErrorStatus(error) === 404) return
    throw toMergeDataPrError(error, `removing ${stale} label from PR #${params.issueNumber}`)
  }
}

/**
 * Reads the newest closed promotion PR. `closedByOperator` is true for a closed, unmerged PR that this code did not
 * close for a moved merge base. The code's own closure needs both signs: the marker comment by a bot and a bot as
 * the actor of the latest `closed` event, so a PR that was marked but then closed by the operator stays closed.
 * An unreadable event list counts as the operator's closure.
 */
async function readNewestClosedPullRequest(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  headBranch: string
  baseBranch: string
  logger: MergeDataPrLogger
}): Promise<{closedByOperator: boolean}> {
  try {
    const response = await params.octokit.rest.pulls.list({
      owner: params.owner,
      repo: params.repo,
      state: 'closed',
      head: `${params.owner}:${params.headBranch}`,
      base: params.baseBranch,
      sort: 'created',
      direction: 'desc',
      per_page: 1,
    })
    const newest = response.data[0]
    if (newest === undefined || newest.merged_at !== null) return {closedByOperator: false}

    const target = {octokit: params.octokit, owner: params.owner, repo: params.repo, pullRequestNumber: newest.number}
    if (!(await hasReplacedMarker(target)) || !(await wasClosedByBot({...target, logger: params.logger}))) {
      return {closedByOperator: true}
    }

    return {closedByOperator: false}
  } catch (error: unknown) {
    throw toMergeDataPrError(
      error,
      `looking up the newest closed ${params.headBranch} -> ${params.baseBranch} pull request`,
    )
  }
}

async function hasReplacedMarker(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
}): Promise<boolean> {
  const comments = await params.octokit.paginate(params.octokit.rest.issues.listComments, {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.pullRequestNumber,
    per_page: 100,
  })

  return comments.some(
    comment => comment.user?.type === 'Bot' && comment.body?.startsWith(REPLACED_PULL_REQUEST_MARKER),
  )
}

async function wasClosedByBot(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
  logger: MergeDataPrLogger
}): Promise<boolean> {
  try {
    const events = await params.octokit.paginate(params.octokit.rest.issues.listEvents, {
      owner: params.owner,
      repo: params.repo,
      issue_number: params.pullRequestNumber,
      per_page: 100,
    })

    return events.findLast(event => event.event === 'closed')?.actor?.type === 'Bot'
  } catch {
    params.logger.warn(
      `could not read the closing event of PR #${params.pullRequestNumber}; treating it as closed by the operator.`,
    )
    return false
  }
}

/** A file counts under both its names: a rename out of `scripts/` into `knowledge/` is not a knowledge-only change. */
function selectLabel(files: {filename: string; previous_filename?: string}[]): MergeLabel {
  const isAllowed = (path: string): boolean => AUTO_MERGE_PATH_PREFIXES.some(prefix => path.startsWith(prefix))

  return files.every(
    file => isAllowed(file.filename) && (file.previous_filename === undefined || isAllowed(file.previous_filename)),
  )
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

const PROMOTION_PIN_PATTERN = /^[0-9a-f]{40}$/u

/**
 * The promotion params the workflow passes as env: `PROMOTION_PIN` (the gated `data` commit),
 * `PROMOTION_QUALIFIES` and `PROMOTION_REFRESH_REVIEW`. Without a pin there are none, and the run behaves
 * as it did before the pin existed. With one, anything but the exact string `true` is false, so a missing
 * value fails safe to `needs-review` and a closed PR staying closed.
 */
export function promotionParamsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): Pick<MergeDataPrParams, 'pin' | 'qualifies' | 'recreateClosedPullRequest'> {
  const pin = env.PROMOTION_PIN
  if (pin === undefined || pin === '') return {}
  if (!PROMOTION_PIN_PATTERN.test(pin)) {
    throw new MergeDataPrError({
      code: 'INVALID_PIN',
      message: 'PROMOTION_PIN must be a 40-character commit SHA',
      remediation: 'Pass the pinned data commit from the pin step.',
    })
  }

  return {
    pin,
    qualifies: env.PROMOTION_QUALIFIES === 'true',
    recreateClosedPullRequest: env.PROMOTION_REFRESH_REVIEW === 'true',
  }
}

export interface MergeDataPrIo extends RegistryIo {
  /** The env of the run. When given, the PR number and head are written to `$GITHUB_OUTPUT`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Defaults to `appendFileSync`; a test passes a recorder. */
  readonly append?: (path: string, content: string) => void
}

/**
 * The CLI body: promotes `data` to `main`, prints the result as one JSON line, writes the PR number and
 * head as step outputs, and returns exit code 1 when the promotion PR is conflicted or its mergeability
 * could not be read.
 */
export async function runMergeDataPr(io: MergeDataPrIo, merge?: () => Promise<MergeDataPrResult>): Promise<number> {
  const result = await (merge ?? (async () => mergeDataPr(promotionParamsFromEnv(io.env ?? process.env))))()
  io.stdout(`${JSON.stringify(result)}\n`)
  if (io.env !== undefined) {
    writeGithubOutputs(
      {'pull-request': String(result.pullRequestNumber ?? ''), head: result.headSha ?? ''},
      {onMissing: 'skip', env: io.env, append: io.append},
    )
  }

  return result.conflicted || result.mergeabilityUnavailable ? 1 : 0
}
