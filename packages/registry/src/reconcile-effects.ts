/**
 * The writes of a reconcile run: star sync, the survey dispatch loop with its stagger, the issue queue, label
 * creation, and the auto-close and self-heal passes. Every failure here is non-blocking: it is logged and the
 * run continues.
 */

import type {RestEndpointMethodTypes} from '@octokit/rest'
import type {OctokitClient, ReconcileLogger} from './reconcile-model.ts'
import process from 'node:process'
import {isApiStatus, isRecord} from '@fro-bot/core/guards'
import {NODE_ID_PATTERN, type AllowlistFile, type RepoEntry, type ReposFile} from '@fro.bot/wiki-write-core/schemas'
import {isGitHubRateLimit} from './reconcile-discovery.ts'
import {renderIssuePayload, type IssuePayload} from './reconcile-issues.ts'
import {
  PENDING_REVIEW_LABEL,
  RENAME_PENDING_LABEL,
  RENAME_PENDING_LABELS,
  ROLLUP_LABEL,
  TRANSITION_LABELS,
  VISIBILITY_TRANSITION_LABEL,
} from './reconcile-labels.ts'
import {
  indexAccessListByNodeId,
  storedRepoNodeId,
  type AccessListEntry,
  type DispatchRequest,
  type IssueQueueEntry,
  type PerOwnerRollupIssue,
} from './reconcile-plan.ts'

export const DEFAULT_WORKFLOW_FILE = 'survey-repo.yaml'

export const DEFAULT_WORKFLOW_REF = 'main'

export const DEFAULT_DISPATCH_TIMEOUT_MS = 15_000

/**
 * Delay (ms) inserted between consecutive Survey Repo dispatches.
 *
 * Surveys share a single upstream LLM seat through cliproxy.fro.bot. Concurrent kickoffs
 * saturate upstream rate limits (see marcusrbrown/infra#144). Staggering the starts gives
 * each survey's session breathing room to progress through its LLM calls before the next
 * one begins.
 *
 * Default: 90s between dispatches. Combined with {@link DEFAULT_MAX_DISPATCHES_PER_RUN}
 * this keeps the full fan-out inside the workflow job timeout even when the access list
 * grows. Override via `RECONCILE_DISPATCH_STAGGER_MS` env var or `dispatchStaggerMs` param.
 * Tests pass 0.
 */
const DEFAULT_DISPATCH_STAGGER_MS = 90_000

/**
 * Maximum number of Survey Repo dispatches fired in a single reconcile run.
 *
 * Each survey run consumes upstream LLM capacity for ~5 minutes. Limiting dispatches per
 * run keeps the scheduled job inside its timeout and bounds peak concurrent surveys to a
 * level the single OAuth seat can sustain. Skipped candidates are dispatched on subsequent
 * runs once the staleness gate makes them eligible again.
 *
 * Default: 12 dispatches. Override via `RECONCILE_MAX_DISPATCHES_PER_RUN` env var or
 * `maxDispatchesPerRun` param. A value of 0 or negative disables the cap (dispatch all
 * eligible candidates).
 */
const DEFAULT_MAX_DISPATCHES_PER_RUN = 12

// Built from the schema's node-ID pattern (minus its anchors) so the marker, the producer filter and the
// row schema accept exactly the same IDs, including legacy base64 IDs with `=` padding.
const NODE_ID_MARKER_PATTERN = new RegExp(
  `<!-- reconcile:subject:node_id=(${NODE_ID_PATTERN.source.slice(1, -1)}) -->`,
  NODE_ID_PATTERN.flags,
)

const ROLLUP_OWNER_MARKER_PATTERN = /<!-- reconcile:subject:rollup-owner=([\w-]+) -->/

/**
 * Star collab/contrib-channel repos that `@fro-bot` has not yet starred.
 *
 * Fetches the authenticated user's full starred set ONCE via a single paginated read
 * (`listReposStarredByAuthenticatedUser`), builds a case-insensitive `Set<string>` of
 * `owner/name` keys, then for each candidate:
 *   - Key IS in the set → `starsAlreadyPresent++` (no API call).
 *   - Key NOT in the set → calls `starRepoForAuthenticatedUser` → `starsAdded++` on success.
 *     On error: `starFailures++`; if rate-limited → counts-only warn + `break` (remaining
 *     candidates retry next run); else counts-only warn + continue.
 *
 * If the initial paginated read fails, the function is fail-safe: it does NOT blind-star
 * every candidate (which would waste write calls and risk rate-limit storms). Instead it
 * logs one counts-only warn and returns `{starsAdded: 0, starsAlreadyPresent: 0,
 * starFailures: candidates.length}` so all candidates retry next run.
 *
 * This reads @fro-bot's full starred set once per run; the single-read win assumes the
 * starred set stays close in size to the candidate set. If @fro-bot accumulates many stars
 * outside the reconcile candidate set, revisit whether per-candidate checks become cheaper.
 *
 * Telemetry is counts-only; canonical owner/name never appears in any log or warn message.
 *
 * A star is a user action — MUST use `userOctokit` (the FRO_BOT_POLL_PAT), never an App token.
 *
 * Exported for unit tests; the sole production caller is `handleReconcile`.
 *
 * @internal
 */
export async function syncStars(params: {
  userOctokit: OctokitClient
  candidates: {owner: string; name: string}[]
  logger: ReconcileLogger
}): Promise<{starsAdded: number; starsAlreadyPresent: number; starFailures: number}> {
  // Short-circuit: nothing to do.
  if (params.candidates.length === 0) {
    return {starsAdded: 0, starsAlreadyPresent: 0, starFailures: 0}
  }

  // Fetch the full starred set in one paginated read.
  let starredSet: Set<string>
  try {
    const starred = await params.userOctokit.paginate(
      params.userOctokit.rest.activity.listReposStarredByAuthenticatedUser,
      {per_page: 100},
    )
    starredSet = new Set(starred.map(r => `${r.owner.login.toLowerCase()}/${r.name.toLowerCase()}`))
  } catch (readError: unknown) {
    // Fail-safe: do NOT blind-star candidates. Return all as failures so they retry next run.
    const status = isRecord(readError) && typeof readError.status === 'number' ? readError.status : 'unknown'
    if (isGitHubRateLimit(readError)) {
      params.logger.warn(
        `reconcile: star sync skipped — starred-set read rate limited (status=${status}); retrying next run.`,
      )
    } else {
      const kind = readError instanceof Error ? readError.name : 'unknown'
      params.logger.warn(
        `reconcile: star sync skipped — could not read starred set (status=${status}, kind=${kind}); retrying next run.`,
      )
    }
    return {starsAdded: 0, starsAlreadyPresent: 0, starFailures: params.candidates.length}
  }

  let starsAdded = 0
  let starsAlreadyPresent = 0
  let starFailures = 0

  for (const candidate of params.candidates) {
    const key = `${candidate.owner.toLowerCase()}/${candidate.name.toLowerCase()}`
    if (starredSet.has(key)) {
      starsAlreadyPresent += 1
      continue
    }

    // Not in the starred set — attempt to star it.
    try {
      await params.userOctokit.rest.activity.starRepoForAuthenticatedUser({
        owner: candidate.owner,
        repo: candidate.name,
      })
      starsAdded += 1
    } catch (starError: unknown) {
      starFailures += 1
      if (isGitHubRateLimit(starError)) {
        const status = isRecord(starError) && typeof starError.status === 'number' ? starError.status : 'unknown'
        params.logger.warn(
          `reconcile: star sync stopped early on rate limit (status=${status}); remaining candidates retry next run.`,
        )
        break
      }
      const status = isRecord(starError) && typeof starError.status === 'number' ? starError.status : 'unknown'
      const kind = starError instanceof Error ? starError.name : 'unknown'
      params.logger.warn(`reconcile: star sync failed (status=${status}, kind=${kind}); continuing.`)
    }
  }

  return {starsAdded, starsAlreadyPresent, starFailures}
}

export async function runDispatches(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  workflowFile: string
  workflowRef: string
  dispatches: DispatchRequest[]
  timeoutMs: number
  /**
   * Delay (ms) inserted BETWEEN consecutive dispatches (not before the first, not after
   * the last). Zero disables staggering entirely — test suites pass 0 for speed.
   */
  staggerMs: number
  logger: ReconcileLogger
  /**
   * Per-key index of repos in `nextRepos` so the dispatch loop can resolve channel +
   * last_survey_at without scanning. Used to emit the first-survey-of-channel info log
   * for owned and contrib entries that have never been surveyed.
   */
  entryByKey: Map<string, RepoEntry>
  /**
   * Sleep implementation. Injected for test speed — production uses `setTimeout`-backed
   * Promise; tests pass a no-op or a deterministic fake clock.
   */
  sleep?: (ms: number) => Promise<void>
}): Promise<{succeeded: number; failed: number}> {
  const sleep = params.sleep ?? defaultSleep
  let succeeded = 0
  let failed = 0
  for (let i = 0; i < params.dispatches.length; i += 1) {
    const dispatch = params.dispatches[i]
    if (dispatch === undefined) continue

    // First-survey-of-channel observability: emit an info line when an owned or contrib
    // entry is being surveyed for the first time. Collab is intentionally excluded —
    // the milestone matters less for the historical channel that's been around since
    // the original collab-only design. Owned entries are auto-discovered (so seeing
    // them flow through to first survey is meaningful), and contrib entries are
    // operator-curated (so first-survey is the moment the trust signal was honored).
    const entry = params.entryByKey.get(`${dispatch.owner}/${dispatch.repo}`)
    if (entry !== undefined && entry.last_survey_at === null) {
      const channel = entry.discovery_channel ?? 'collab'
      if (channel === 'owned' || channel === 'contrib') {
        params.logger.info(`reconcile: first survey for new ${channel} entry: ${dispatch.owner}/${dispatch.repo}`)
      }
    }

    // Stagger BETWEEN dispatches only — never before the first, never after the last.
    // This keeps the first survey's kickoff latency unchanged and avoids trailing idle time.
    if (i > 0 && params.staggerMs > 0) {
      await sleep(params.staggerMs)
    }
    try {
      await dispatchWithTimeout(
        async () =>
          params.writerOctokit.rest.actions.createWorkflowDispatch({
            owner: params.owner,
            repo: params.repo,
            workflow_id: params.workflowFile,
            ref: params.workflowRef,
            // The only identifier exposed to the public workflow_dispatch surface is
            // the GraphQL node_id. The Survey Repo workflow's first step resolves it
            // back to owner/repo via App-token GraphQL and aborts unless the repo is
            // definitively public. owner/repo are kept on DispatchRequest for internal
            // telemetry (logger, prioritization) but never reach the Actions API.
            inputs: {node_id: dispatch.node_id},
          }),
        params.timeoutMs,
      )
      succeeded += 1
    } catch (error: unknown) {
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      const kind = error instanceof Error ? error.name : 'unknown'
      params.logger.warn(`reconcile: dispatch failed (status=${status}, kind=${kind}); continuing.`)
    }
  }
  return {succeeded, failed}
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Parse `RECONCILE_DISPATCH_STAGGER_MS` from env. Returns the default when unset, empty,
 * or non-numeric. Negative values clamp to 0 (no stagger). Upper-bounded at 300s (5 min)
 * to prevent accidental workflow-timeout triggers from bad operator config.
 *
 * Exported for direct env-parsing tests; production callers use it implicitly via
 * {@link HandleReconcileParams.dispatchStaggerMs}.
 */
export function loadDispatchStaggerFromEnv(): number {
  const raw = process.env.RECONCILE_DISPATCH_STAGGER_MS
  if (raw === undefined || raw === '') return DEFAULT_DISPATCH_STAGGER_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_DISPATCH_STAGGER_MS
  if (parsed < 0) return 0
  if (parsed > 300_000) return 300_000
  return parsed
}

/**
 * Parse `RECONCILE_MAX_DISPATCHES_PER_RUN` from env. Returns the default when unset, empty,
 * or non-numeric. A value of 0 or negative disables the cap (dispatch all eligible
 * candidates, matching pre-cap behavior).
 *
 * Exported for direct env-parsing tests; production callers use it implicitly via
 * {@link HandleReconcileParams.maxDispatchesPerRun}.
 */
export function loadMaxDispatchesPerRunFromEnv(): number {
  const raw = process.env.RECONCILE_MAX_DISPATCHES_PER_RUN
  if (raw === undefined || raw === '') return DEFAULT_MAX_DISPATCHES_PER_RUN
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_DISPATCHES_PER_RUN
  return parsed
}

/**
 * Internal default exposed for test parity with {@link loadDispatchStaggerFromEnv}
 * and {@link loadMaxDispatchesPerRunFromEnv}.
 */
export const DISPATCH_DEFAULTS = {
  staggerMs: DEFAULT_DISPATCH_STAGGER_MS,
  maxDispatchesPerRun: DEFAULT_MAX_DISPATCHES_PER_RUN,
} as const

async function dispatchWithTimeout<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('dispatch timed out'), {name: 'DispatchTimeoutError'}))
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(), timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Derived from Octokit's paginated list-for-repo response element type.
type ListForRepoResponseItem = RestEndpointMethodTypes['issues']['listForRepo']['response']['data'][number]

export async function runIssueQueue(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  issues: IssueQueueEntry[]
  logger: ReconcileLogger
}): Promise<{
  perRepoSucceeded: number
  rollupSucceeded: number
  visibilityTransitionSucceeded: number
  /**
   * Count of visibility-transition creates suppressed as duplicates this run (both the
   * listForRepo-existing-title path and the same-run Set path).
   */
  visibilityTransitionDuplicatesSkipped: number
  renamePendingSucceeded: number
  /** Rename-pending creates suppressed because an open issue already carries the node marker (or same-run repeat). */
  renamePendingDuplicatesSkipped: number
  failed: number
}> {
  let perRepoSucceeded = 0
  let rollupSucceeded = 0
  let visibilityTransitionSucceeded = 0
  let visibilityTransitionDuplicatesSkipped = 0
  let renamePendingSucceeded = 0
  let renamePendingDuplicatesSkipped = 0
  let failed = 0
  const attemptedRenameNodeIds = new Set<string>()
  let cachedRenameLabels: Set<string> | null = null

  // Same-run dedup Set. Two visibility-transition queue entries for the same
  // node_id in one reconcile plan can both pass the listForRepo dedup check because the
  // Issues API is eventually consistent (a just-created issue may not appear in listForRepo
  // yet). Tracking successfully-created node_ids here and skipping on second occurrence
  // prevents duplicates regardless of API lag. Both guards (listForRepo + this Set) apply.
  const attemptedTransitionNodeIds = new Set<string>()

  // Label preflight: ensureLabelsExist is hoisted out of the per-issue loop. Labels don't
  // change mid-run; calling it per-issue wastes 2 round-trips × N issues. We call it lazily
  // on the first visibility-transition issue and reuse when the result is confirmed (non-empty).
  let cachedConfirmedLabels: Set<string> | null = null

  for (const issue of params.issues) {
    try {
      if (issue.kind === 'visibility-transition') {
        // Same-run Set dedup — skip if this node_id was already successfully created this run.
        // The set is populated AFTER a successful create, so a failed first attempt does not
        // suppress a subsequent retry for the same node_id.
        if (attemptedTransitionNodeIds.has(issue.node_id)) {
          params.logger.info(
            `reconcile: visibility-transition duplicate skipped (same-run set, node_id=${issue.node_id})`,
          )
          visibilityTransitionDuplicatesSkipped += 1
          continue
        }

        // Dedup: skip if an open issue with the same node_id already exists.
        // Fail-open: if paginate throws, treat as "no existing issue found" and proceed
        // to create — better to risk a duplicate than to silently drop the alert.
        let existing: ListForRepoResponseItem[] = []
        try {
          existing = await params.writerOctokit.paginate(params.writerOctokit.rest.issues.listForRepo, {
            owner: params.owner,
            repo: params.repo,
            state: 'open',
            labels: VISIBILITY_TRANSITION_LABEL,
            per_page: 100,
          })
        } catch (listError: unknown) {
          const status = isRecord(listError) && typeof listError.status === 'number' ? listError.status : 'unknown'
          params.logger.warn(
            `reconcile: dedup list failed for visibility-transition (status=${status}); proceeding with issue creation.`,
          )
        }
        // Exact-title match: the title is fully derived from node_id, so exact equality
        // is functionally equivalent to marker extraction and cheaper (no body fetch needed).
        const expectedTitle = `[INTEGRITY] Visibility transition for ${issue.node_id}`
        const alreadyOpen = existing.some(i => i.title === expectedTitle)
        if (alreadyOpen) {
          params.logger.info(
            `reconcile: visibility-transition duplicate skipped (existing open issue, node_id=${issue.node_id})`,
          )
          visibilityTransitionDuplicatesSkipped += 1
          continue
        }

        // Label preflight: ensureLabelsExist is called lazily on the first visibility-transition
        // issue and cached for reuse. The cache is committed only when every required label is
        // confirmed (labels.size equals TRANSITION_LABELS.length). A partial result — where a
        // transient failure excluded one or more labels — is never cached: the cache stays null
        // so each subsequent issue retries the full preflight until a complete set is confirmed.
        // Regardless of whether the cache is committed, the current issue always uses the freshly
        // computed label set from this call, not an empty fallback.
        let confirmedLabels: Set<string>
        if (cachedConfirmedLabels === null) {
          const labels = await ensureLabelsExist(
            params.writerOctokit,
            params.owner,
            params.repo,
            TRANSITION_LABELS,
            params.logger,
          )
          if (labels.size === TRANSITION_LABELS.length) {
            cachedConfirmedLabels = labels
          }
          confirmedLabels = labels
        } else {
          confirmedLabels = cachedConfirmedLabels
        }
        const payload = renderIssuePayload(issue, params.owner, params.repo)
        const filteredPayload: IssuePayload = {
          ...payload,
          labels: payload.labels.filter(l => confirmedLabels.has(l)),
        }
        if (filteredPayload.labels.length === 0) {
          params.logger.warn(
            `reconcile: all labels unconfirmed for visibility-transition issue (node_id=${issue.node_id}); shipping unlabeled.`,
          )
        }
        await callIssuesCreate(params.writerOctokit, filteredPayload)
        // Mark as successfully created — only after the create call succeeds.
        // This ensures a failed create does not suppress a subsequent retry for the same node_id.
        attemptedTransitionNodeIds.add(issue.node_id)
      } else if (issue.kind === 'rename-pending') {
        if (attemptedRenameNodeIds.has(issue.node_id)) {
          renamePendingDuplicatesSkipped += 1
          continue
        }
        // Search before create, by the node marker in the body. Unlike the visibility alert this
        // fails CLOSED: a failed search throws into the catch below (counted as a failed issue,
        // retried next run) rather than risking a duplicate operator issue every day.
        const open = (await params.writerOctokit.paginate(params.writerOctokit.rest.issues.listForRepo, {
          owner: params.owner,
          repo: params.repo,
          state: 'open',
          labels: RENAME_PENDING_LABEL,
          per_page: 100,
        })) as unknown as OpenIssueEntry[]
        if (
          open.some(
            existing =>
              isRenamePendingIssue(existing) && NODE_ID_MARKER_PATTERN.exec(existing.body ?? '')?.[1] === issue.node_id,
          )
        ) {
          renamePendingDuplicatesSkipped += 1
          params.logger.info('reconcile: rename-pending duplicate skipped (existing open issue)')
          continue
        }

        let confirmedLabels: Set<string>
        if (cachedRenameLabels === null) {
          const labels = await ensureLabelsExist(
            params.writerOctokit,
            params.owner,
            params.repo,
            RENAME_PENDING_LABELS,
            params.logger,
          )
          if (labels.size === RENAME_PENDING_LABELS.length) cachedRenameLabels = labels
          confirmedLabels = labels
        } else {
          confirmedLabels = cachedRenameLabels
        }
        const payload = renderIssuePayload(issue, params.owner, params.repo)
        await callIssuesCreate(params.writerOctokit, {
          ...payload,
          labels: payload.labels.filter(label => confirmedLabels.has(label)),
        })
        attemptedRenameNodeIds.add(issue.node_id)
      } else {
        const payload = renderIssuePayload(issue, params.owner, params.repo)
        await callIssuesCreate(params.writerOctokit, payload)
      }
      /**
       * Counter semantics: these counts reflect issues.create API acknowledgements, not
       * confirmed-created alerts. An ambiguous 5xx (where the API processed the request but
       * the response was lost in transit) may over-count `failed` or under-count the success
       * counters. This is acceptable at current scale (visibility transitions are rare events);
       * a listForRepo reconciliation pass would be needed only if these counters drive SLO/alerting.
       */
      switch (issue.kind) {
        case 'per-repo': {
          perRepoSucceeded += 1
          break
        }
        case 'per-owner-rollup': {
          rollupSucceeded += 1
          break
        }
        case 'visibility-transition': {
          visibilityTransitionSucceeded += 1
          break
        }
        case 'rename-pending': {
          renamePendingSucceeded += 1
          break
        }
        default: {
          // Exhaustiveness guard: adding a new IssueQueueEntry kind must update the switch above.
          const exhaustive: never = issue
          throw new Error(`runIssueQueue: unhandled issue kind: ${JSON.stringify(exhaustive)}`)
        }
      }
    } catch (error: unknown) {
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      params.logger.warn(`reconcile: issue creation failed (status=${status}); continuing.`)
    }
  }
  return {
    perRepoSucceeded,
    rollupSucceeded,
    visibilityTransitionSucceeded,
    visibilityTransitionDuplicatesSkipped,
    renamePendingSucceeded,
    renamePendingDuplicatesSkipped,
    failed,
  }
}

/**
 * Ensure a set of labels exist in the repo. For each label:
 * - If it exists (getLabel succeeds): confirmed.
 * - If 404: attempt createLabel.
 *   - createLabel succeeds or 422 (race — already created): confirmed.
 *   - createLabel other failure: excluded from returned set (log and continue).
 * - getLabel non-404 failure: excluded from returned set (log and continue).
 *
 * Returns a Set<string> of confirmed-usable label names. The caller MUST filter
 * the issue payload to only these labels before calling issues.create.
 */
async function ensureLabelsExist(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  labels: readonly {name: string; color: string; description: string}[],
  logger: ReconcileLogger,
): Promise<Set<string>> {
  const confirmed = new Set<string>()
  for (const {name, color, description} of labels) {
    try {
      await octokit.rest.issues.getLabel({owner, repo, name})
      confirmed.add(name)
      continue
    } catch (getError: unknown) {
      if (!isApiStatus(getError, 404)) {
        const status = isRecord(getError) && typeof getError.status === 'number' ? getError.status : 'unknown'
        logger.warn(`reconcile: label check failed for "${name}" (status=${status}); excluding from issue labels.`)
        continue
      }
    }
    // Label not found (404) — create it.
    try {
      await octokit.rest.issues.createLabel({owner, repo, name, color, description})
      confirmed.add(name)
    } catch (createError: unknown) {
      if (isApiStatus(createError, 422)) {
        // Race with another writer (e.g. Update-Repo-Settings) — label now exists; include it.
        confirmed.add(name)
      } else {
        const status = isRecord(createError) && typeof createError.status === 'number' ? createError.status : 'unknown'
        logger.warn(`reconcile: label creation failed for "${name}" (status=${status}); excluding from issue labels.`)
      }
    }
  }
  return confirmed
}

interface OpenIssueEntry {
  number: number
  title: string
  body: string | null
  labels: {name?: string}[]
}

export async function autoCloseStaleIssues(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  nextRepos: ReposFile
  accessList: AccessListEntry[]
  logger: ReconcileLogger
}): Promise<number> {
  const pendingReviewNodeIds = new Set<string>()
  const pendingReviewOwners = new Map<string, number>()
  const accessByKey = new Map(params.accessList.map(a => [`${a.owner}/${a.name}`, a]))
  const accessByNodeId = indexAccessListByNodeId(params.accessList)
  for (const entry of params.nextRepos.repos) {
    if (entry.onboarding_status !== 'pending-review') continue
    const nodeId = storedRepoNodeId(entry)
    const access = accessByKey.get(`${entry.owner}/${entry.name}`) ?? accessByNodeId.get(nodeId ?? '')
    const reviewNodeId = access?.node_id ?? nodeId
    if (reviewNodeId !== undefined) pendingReviewNodeIds.add(reviewNodeId)
    const reviewOwner = access?.owner ?? entry.owner
    pendingReviewOwners.set(reviewOwner, (pendingReviewOwners.get(reviewOwner) ?? 0) + 1)
  }

  let closed = 0
  try {
    const issues = (await params.writerOctokit.paginate(params.writerOctokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      labels: PENDING_REVIEW_LABEL,
      per_page: 100,
    })) as unknown as OpenIssueEntry[]

    for (const issue of issues) {
      const labelNames = issue.labels.map(l => l.name).filter((n): n is string => typeof n === 'string')
      const isRollup = labelNames.includes(ROLLUP_LABEL)
      const body = issue.body ?? ''
      let stale = false
      if (isRollup) {
        const ownerMatch = ROLLUP_OWNER_MARKER_PATTERN.exec(body)
        const rollupOwner = ownerMatch?.[1]
        if (rollupOwner === undefined) continue
        const count = pendingReviewOwners.get(rollupOwner) ?? 0
        stale = count < 2
      } else {
        const nodeMatch = NODE_ID_MARKER_PATTERN.exec(body)
        const nodeId = nodeMatch?.[1]
        if (nodeId === undefined) continue
        stale = !pendingReviewNodeIds.has(nodeId)
      }
      if (!stale) continue

      try {
        await params.writerOctokit.rest.issues.update({
          owner: params.owner,
          repo: params.repo,
          issue_number: issue.number,
          state: 'closed',
        })
        closed += 1
      } catch (error: unknown) {
        const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
        params.logger.warn(`reconcile: failed to close stale issue #${issue.number} (status=${status}).`)
      }
    }
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: failed to list pending-review issues (status=${status}).`)
  }
  return closed
}

/** Re-checks the label on listed issues so a list result is never trusted beyond what the query promised. */
function isRenamePendingIssue(issue: OpenIssueEntry): boolean {
  return issue.labels.some(label => label.name === RENAME_PENDING_LABEL)
}

/**
 * Close open rename-pending issues whose node is no longer pending (the rename was applied, or the
 * node left the tracked set). Modeled on {@link autoCloseStaleIssues}: matches by the node marker in
 * the body, and logs status only. The caller skips this pass when field probes failed this run, since
 * a missing probe is no information and must not close (then re-open) an issue.
 */
export async function autoCloseResolvedRenameIssues(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  pendingNodeIds: ReadonlySet<string>
  logger: ReconcileLogger
}): Promise<number> {
  let closed = 0
  try {
    const issues = (await params.writerOctokit.paginate(params.writerOctokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      labels: RENAME_PENDING_LABEL,
      per_page: 100,
    })) as unknown as OpenIssueEntry[]

    for (const issue of issues) {
      if (!isRenamePendingIssue(issue)) continue
      const nodeId = NODE_ID_MARKER_PATTERN.exec(issue.body ?? '')?.[1]
      if (nodeId === undefined || params.pendingNodeIds.has(nodeId)) continue

      try {
        await params.writerOctokit.rest.issues.update({
          owner: params.owner,
          repo: params.repo,
          issue_number: issue.number,
          state: 'closed',
        })
        closed += 1
      } catch (error: unknown) {
        const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
        params.logger.warn(`reconcile: failed to close resolved rename issue #${issue.number} (status=${status}).`)
      }
    }
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: failed to list rename-pending issues (status=${status}).`)
  }
  return closed
}

/**
 * Self-healing pass that recovers missing per-owner rollup issues.
 *
 * In-process race (same run): the GitHub Issues listing API has eventual-consistency lag —
 * a rollup POSTed in step 10 may not appear in a subsequent listForRepo call. The
 * `currentRunRollupOwners` set carries every owner whose rollup was attempted in this run
 * (success or failure) so the skip is observable as `raceSuppressed` rather than silently
 * conflated with pre-existing rollups.
 *
 * Cross-run race: two reconcile runs overlapping (e.g., scheduled + manual rerun) could
 * theoretically produce duplicate rollups if both see an empty listForRepo. This is closed
 * operationally by the workflow concurrency group (`group: reconcile-repos,
 * cancel-in-progress: false`): a manual rerun queues behind the prior run and starts only
 * after it fully completes, far longer than listForRepo's few-second lag. No persistent
 * timestamp or distributed lock is needed — the serialization guarantee comes from the
 * workflow scheduler, not from this code.
 */
export async function selfHealRollups(params: {
  writerOctokit: OctokitClient
  owner: string
  repo: string
  nextRepos: ReposFile
  accessList: AccessListEntry[]
  allowlist: AllowlistFile
  logger: ReconcileLogger
  currentRunRollupOwners: ReadonlySet<string>
}): Promise<{created: number; raceSuppressed: number}> {
  const allowlistedOwners = new Set(params.allowlist.approved_inviters.map(i => i.username))
  const pendingReviewByOwner = new Map<string, RepoEntry[]>()
  for (const entry of params.nextRepos.repos) {
    if (entry.onboarding_status !== 'pending-review') continue
    if (allowlistedOwners.has(entry.owner)) continue // allowlisted owners are never rolled up
    const bucket = pendingReviewByOwner.get(entry.owner) ?? []
    bucket.push(entry)
    pendingReviewByOwner.set(entry.owner, bucket)
  }

  // Only owners with ≥2 pending-review entries qualify for a rollup.
  const qualifyingOwners = [...pendingReviewByOwner.entries()].filter(([, entries]) => entries.length >= 2)
  if (qualifyingOwners.length === 0) return {created: 0, raceSuppressed: 0}

  // existingRollupOwners: ONLY owners with rollups confirmed on GitHub via listForRepo.
  // Kept separate from currentRunRollupOwners so each skip path is observable independently.
  let existingRollupOwners: Set<string>
  try {
    const openRollups = (await params.writerOctokit.paginate(params.writerOctokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      labels: ROLLUP_LABEL,
      per_page: 100,
    })) as unknown as OpenIssueEntry[]
    existingRollupOwners = new Set()
    for (const issue of openRollups) {
      const body = issue.body ?? ''
      const match = ROLLUP_OWNER_MARKER_PATTERN.exec(body)
      if (match?.[1] !== undefined) existingRollupOwners.add(match[1])
    }
    // NOTE: do NOT union currentRunRollupOwners here. They are checked separately below
    // so the same-run eventual-consistency guard is observable in raceSuppressed.
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: self-heal rollup listing failed (status=${status}); skipping.`)
    return {created: 0, raceSuppressed: 0}
  }

  const accessByKey = new Map(params.accessList.map(a => [`${a.owner}/${a.name}`, a]))
  let created = 0
  let raceSuppressed = 0
  for (const [owner, entries] of qualifyingOwners) {
    if (existingRollupOwners.has(owner)) continue // pre-existing on GitHub — silent skip
    if (params.currentRunRollupOwners.has(owner)) {
      // Same-run race suppression: a rollup was already attempted for this owner in step 10.
      // The eventual-consistency guard is firing — observable via raceSuppressed.
      raceSuppressed += 1
      params.logger.info(`selfHealRollups: skipped owner=${owner} (already created earlier in this run)`)
      continue
    }
    const rollupEntries: PerOwnerRollupIssue['entries'] = []
    for (const entry of entries) {
      const access = accessByKey.get(`${entry.owner}/${entry.name}`)
      if (access === undefined) continue // missing node_id — skip to avoid leaking name
      rollupEntries.push({repo: entry.name, private: access.private, node_id: access.node_id})
    }
    if (rollupEntries.length < 2) continue // missing access data leaves us without ≥2 identifiable entries

    // Self-healed rollups always use 'unsolicited-new' as the reason. The original reason
    // ('unsolicited-new' or 'unsolicited-regain') is not tracked on the RepoEntry itself
    // (it's only known at the moment the pending-review state is established), so once the
    // original rollup issue is closed we lose that signal. Operator triages by visiting the
    // listed entries in `repos.yaml`; the title wording is a minor simplification.
    const rollupIssue: PerOwnerRollupIssue = {
      kind: 'per-owner-rollup',
      owner,
      entries: rollupEntries,
      reason: 'unsolicited-new',
    }
    try {
      await callIssuesCreate(params.writerOctokit, renderIssuePayload(rollupIssue, params.owner, params.repo))
      created += 1
    } catch (error: unknown) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      params.logger.warn(`reconcile: self-heal rollup creation failed (status=${status}); continuing.`)
    }
  }
  return {created, raceSuppressed}
}

/**
 * Thin wrapper around `issues.create` that widens our `IssuePayload` shape to match the
 * full Octokit request parameter type (which includes optional request-level fields like
 * `headers` that we never set). The cast-through-unknown is safe because every property
 * we do set is structurally compatible with Octokit's signature.
 */
export async function callIssuesCreate(octokit: OctokitClient, payload: IssuePayload): Promise<void> {
  await octokit.rest.issues.create(payload as unknown as Parameters<OctokitClient['rest']['issues']['create']>[0])
}
