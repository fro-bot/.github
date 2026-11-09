/**
 * Approves and squash-merges a qualifying `data` → `main` promotion pinned to the commit the privacy
 * gates checked, once the required checks have passed on that commit.
 *
 * - Every decision is deterministic: no agent and no LLM. The token is `FRO_BOT_PAT` (`GH_TOKEN`), the
 *   `fro-bot` user, a code owner; the App pushed `data` last, so the last-push rule is met.
 * - Before anything else the live protection of `main` is read, and it must list every context declared in
 *   `.github/settings.yml`. A read that fails, or a list that is empty or short, stops the run with exit 1.
 * - The PR is re-read before the wait, on every poll, before the approval and before the merge. A moved
 *   head, a closed PR, a missing `automerge` label or a `hold-merge` label stops the run with exit 0.
 * - The repository variable `PROMOTION_SELF_MERGE` must be exactly `on` when the step starts for the run to
 *   be live, and `on` again in a fresh read before the approval and before the merge. A run that started
 *   as a dry run stays one to the end, whatever the variable becomes; it waits and polls as a live run
 *   does, then stops right before the approval.
 * - Every request goes through one deadline check and carries an abort signal sized to the time left. The
 *   wait has 60 minutes and the approval and merge a further 10; a request issued after its deadline, or cut
 *   off in flight, ends the run with TIMEOUT and a summary. A write that is cut off is reconciled with one
 *   more read, which has 2 minutes of its own. The step needs at most 72 minutes, which leaves 18 of the
 *   job's 90 for the steps before it.
 * - The live required list is read again on every poll, and a change restarts the wait.
 * - Exit 0: merged, held, dry run, stale, timed out, 409 or behind. Exit 1: a failed check, unreadable or
 *   short protection, an approval that did not count, any other API failure. Stderr carries fixed codes
 *   only, never an upstream message, a token or a payload.
 * - The clock and the sleep are injected, so no test waits for real.
 */

import type {Octokit} from '@octokit/rest'

import {appendStepSummary} from '@fro-bot/core/output'
import {retry} from '@fro-bot/core/retry'
import {parse} from 'yaml'

/** The slice of Octokit this module calls, so a test builds a fake of exactly these methods. */
export interface SelfMergeOctokit {
  readonly rest: {
    readonly repos: Pick<Octokit['rest']['repos'], 'getBranch' | 'listCommitStatusesForRef'>
    readonly checks: Pick<Octokit['rest']['checks'], 'listForRef'>
    readonly pulls: Pick<Octokit['rest']['pulls'], 'get' | 'createReview' | 'merge'>
    readonly actions: Pick<Octokit['rest']['actions'], 'getRepoVariable'>
  }
}

export interface SelfMergeInput {
  readonly octokit: SelfMergeOctokit
  readonly owner: string
  readonly repo: string
  /** The promotion PR, or `null` when the PR step opened none. */
  readonly pullRequest: number | null
  /** The `data` commit the privacy gates checked. */
  readonly pin: string
  /** Whether the tree diff at the pin qualifies. */
  readonly qualifies: boolean
  /** `vars.PROMOTION_SELF_MERGE` as the step started. Only `on` starts a live run. */
  readonly switchAtStart: string | undefined
  /** The contexts declared for `main` in `.github/settings.yml`. */
  readonly declaredContexts: readonly string[]
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** An abort signal that fires after `ms`; the real one is `AbortSignal.timeout`. */
  readonly signal: (ms: number) => AbortSignal
}

export type SelfMergeCode =
  | 'NO_PULL_REQUEST'
  | 'NOT_QUALIFYING'
  | 'CLOSED_UNMERGED'
  | 'ALREADY_MERGED'
  | 'STALE_HEAD'
  | 'NOT_LABELED'
  | 'HOLD_MERGE'
  | 'DRY_RUN'
  | 'TIMEOUT'
  | 'CHECK_FAILED'
  | 'PROTECTION_EMPTY'
  | 'PROTECTION_SHORT'
  | 'PROTECTION_UNREADABLE'
  | 'PROTECTION_CHANGED'
  | 'NO_DECLARED_CONTEXTS'
  | 'SWITCH_UNREADABLE'
  | 'SWITCH_TURNED_OFF'
  | 'APPROVE_FAILED'
  | 'OPEN_WAITING'
  | 'MERGE_FAILED'
  | 'MERGED_AFTER_CUT_OFF'
  | 'MERGE_CUT_OFF'
  | 'MERGE_UNKNOWN'
  | 'APPROVAL_UNKNOWN'
  | 'MERGE_BLOCKED'
  | 'API_FAILED'
  | 'MERGED'

export interface SelfMergeOutcome {
  readonly exitCode: 0 | 1
  readonly code: SelfMergeCode
  /** Markdown for the job summary. */
  readonly summary: string
}

interface RequiredCheck {
  readonly context: string
  readonly appId: number | null
}

interface PullView {
  readonly state: string
  readonly merged: boolean
  readonly headSha: string
  readonly labels: readonly string[]
  readonly mergeableState: string
}

interface CheckRunView {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly appId: number | null
}

interface StatusView {
  readonly context: string
  readonly state: string
}

/** Codes whose summary text is built from the run, so the caller supplies it. */
type DynamicCode = 'TIMEOUT' | 'CHECK_FAILED' | 'PROTECTION_EMPTY' | 'PROTECTION_SHORT' | 'APPROVAL_UNKNOWN'
type FixedCode = Exclude<SelfMergeCode, DynamicCode>

/** Settings that read as numbers and durations, inside a function so a mutant in them is exercised. */
function limits() {
  return {
    waitMs: 60 * 60 * 1000,
    // Time after the wait for the post-wait reads, the approval and the merge.
    reserveMs: 10 * 60 * 1000,
    // The one read that reconciles a write that was cut off, outside the deadline.
    reconcileMs: 2 * 60 * 1000,
    // Times the wait starts over because the live required list changed under it.
    maxRestarts: 3,
    pollMs: 60 * 1000,
    transientAttempts: 3,
    transientBaseMs: 2000,
    mergeableRereads: 3,
    mergeableDelayMs: 2000,
    pageSize: 100,
    maxPages: 50,
    // 60 minutes at one poll a minute is 61 polls; one more is the bound if the clock never moves.
    maxPolls: 62,
  }
}

function titles(): Readonly<Record<SelfMergeCode, string>> {
  return {
    NO_PULL_REQUEST: 'no pull request',
    NOT_QUALIFYING: 'not qualifying',
    CLOSED_UNMERGED: 'closed unmerged',
    ALREADY_MERGED: 'already merged',
    STALE_HEAD: 'stale head',
    NOT_LABELED: 'not labeled automerge',
    HOLD_MERGE: 'held by hold-merge',
    DRY_RUN: 'dry run',
    TIMEOUT: 'timed out',
    CHECK_FAILED: 'a required check failed',
    PROTECTION_EMPTY: 'required checks missing',
    PROTECTION_SHORT: 'required checks missing',
    PROTECTION_UNREADABLE: 'protection unreadable',
    PROTECTION_CHANGED: 'required checks kept changing',
    NO_DECLARED_CONTEXTS: 'no declared checks',
    SWITCH_UNREADABLE: 'switch unreadable',
    SWITCH_TURNED_OFF: 'switched off after approval',
    APPROVE_FAILED: 'approval failed',
    OPEN_WAITING: 'open, waiting',
    MERGE_FAILED: 'merge failed',
    MERGED_AFTER_CUT_OFF: 'merged after a cut-off request',
    MERGE_CUT_OFF: 'merge cut off',
    MERGE_UNKNOWN: 'merge state unknown',
    APPROVAL_UNKNOWN: 'approval unknown',
    MERGE_BLOCKED: 'merge blocked',
    API_FAILED: 'GitHub API failure',
    MERGED: 'merged',
  }
}

function details(): Readonly<Record<FixedCode, string>> {
  return {
    NO_PULL_REQUEST: 'The PR step opened no promotion pull request, so there is nothing to approve.',
    NOT_QUALIFYING:
      'The promotion has a path outside `knowledge/` and `metadata/`, so it waits for the operator. Nothing was approved.',
    CLOSED_UNMERGED: 'The pull request is closed and not merged. Nothing was approved.',
    ALREADY_MERGED: 'The pull request is already merged. Nothing was approved.',
    STALE_HEAD:
      'The pull request head is not the pinned commit the promotion gates checked, so nothing was approved. The next daily run handles the new head.',
    NOT_LABELED: 'The pull request does not carry the `automerge` label. Nothing was approved.',
    HOLD_MERGE: 'The pull request carries the `hold-merge` label, so it waits for the operator. Nothing was approved.',
    DRY_RUN:
      'Dry run: the repository variable `PROMOTION_SELF_MERGE` is not `on`, so the run would approve and merge the pull request but did not. Nothing was approved.',
    PROTECTION_UNREADABLE:
      'The branch protection of `main` could not be read, so the required checks are unknown. Nothing was approved.',
    PROTECTION_CHANGED:
      'The required checks for `main` kept changing while the run waited, so the run stopped before it settled on a list. The pull request stays open and the next daily run starts again. Nothing was approved.',
    NO_DECLARED_CONTEXTS:
      'No required contexts are declared for `main` in `.github/settings.yml`, so the live list cannot be compared. Nothing was approved.',
    SWITCH_UNREADABLE:
      'The repository variable `PROMOTION_SELF_MERGE` could not be read, so the run cannot tell whether self-merge is on.',
    SWITCH_TURNED_OFF:
      'The pull request was approved, then `PROMOTION_SELF_MERGE` was turned off before the merge, so it was not merged.',
    APPROVE_FAILED: 'GitHub refused the approval, so the pull request was not merged.',
    OPEN_WAITING:
      'GitHub refused the merge because the head or the base moved. The pull request stays open and the next daily run handles it.',
    MERGE_FAILED: 'The merge did not complete and the pull request is not merged.',
    MERGED_AFTER_CUT_OFF: 'The merge request was cut off at the deadline, but the pull request is merged.',
    MERGE_CUT_OFF:
      'The merge request was cut off at the deadline. Read again afterwards, the pull request is still open, so the merge has not gone through, though GitHub may still accept it. Check the pull request.',
    MERGE_UNKNOWN:
      'The merge request failed or was cut off, and the pull request could not be read afterwards, so whether GitHub accepted the merge is not known. Check the pull request.',
    MERGE_BLOCKED:
      'GitHub refused the merge although the pull request was approved: the approval did not count or a change request is outstanding. The pull request stays open.',
    API_FAILED: 'A GitHub API call failed, so the run stopped. Nothing further was done.',
    MERGED:
      'The promotion gates passed on the pinned commit, the required checks passed on it, and the pull request was approved as `fro-bot` and squash-merged pinned to it.',
  }
}

function failsRun(code: SelfMergeCode): boolean {
  return new Set<SelfMergeCode>([
    'CHECK_FAILED',
    'PROTECTION_EMPTY',
    'PROTECTION_SHORT',
    'PROTECTION_UNREADABLE',
    'NO_DECLARED_CONTEXTS',
    'SWITCH_UNREADABLE',
    'APPROVE_FAILED',
    'MERGE_FAILED',
    'MERGE_CUT_OFF',
    'MERGE_UNKNOWN',
    'APPROVAL_UNKNOWN',
    'MERGE_BLOCKED',
    'API_FAILED',
  ]).has(code)
}

function list(names: readonly string[]): string {
  return names.map(name => `\`${name}\``).join(', ')
}

/** What an outcome needs to know about the run: the pull request, the pin, and whether an approval was submitted. */
interface OutcomeContext {
  readonly pullRequest: number | null
  readonly pin: string
  readonly approved?: boolean
}

/** The run as it unfolds: `approved` once `createReview` succeeded, `waiting` until the checks have settled. */
interface RunState {
  readonly pullRequest: number
  readonly pin: string
  approved: boolean
  waiting: boolean
  pending: readonly string[]
}

function outcomeOf(context: OutcomeContext, code: FixedCode): SelfMergeOutcome {
  return build(context, code, details()[code])
}

function outcomeWith(context: OutcomeContext, code: DynamicCode, detail: string): SelfMergeOutcome {
  return build(context, code, detail)
}

/** What a summary says once an approval is on the pull request: it was submitted, and it stays. */
function afterApproval(detail: string): string {
  return `${detail.replace(' Nothing was approved.', '').replace(' Nothing further was done.', '')} The approval was already submitted as \`fro-bot\` on the pinned commit and stays on the pull request until the head moves or someone dismisses it; check the pull request.`
}

function build(context: OutcomeContext, code: SelfMergeCode, detail: string): SelfMergeOutcome {
  return {exitCode: failsRun(code) ? 1 : 0, code, summary: summaryFor(context, titles()[code], detail, code)}
}

/** The job summary: title, what happened and what to do, then the pull request and the pin. */
function summaryFor(context: OutcomeContext, title: string, detail: string, code?: SelfMergeCode): string {
  const said =
    context.approved === true && code !== 'MERGED' && code !== 'MERGED_AFTER_CUT_OFF' ? afterApproval(detail) : detail
  const facts = [
    context.pullRequest === null ? undefined : `- Pull request: #${String(context.pullRequest)}`,
    `- Pinned commit: ${/^[0-9a-f]{40}$/u.test(context.pin) ? `\`${context.pin}\`` : 'not available'}`,
  ].filter(fact => fact !== undefined)
  return [`### Promotion self-merge: ${title}`, '', said, '', ...facts, ''].join('\n')
}

/** Thrown by the deadline check; carries nothing, because the outcome is built from the run's state. */
class DeadlineError extends Error {}

/** A request that was in flight when its signal fired: it was sent, so a write may or may not have happened. */
class CutOffError extends DeadlineError {}

/** The outcome of a run whose deadline passed: the wait ran out, or the time after it did. */
function timeoutOutcome(state: RunState): SelfMergeOutcome {
  const detail = state.waiting
    ? `The required checks did not settle within 60 minutes${state.pending.length > 0 ? ` (still waiting on: ${list(state.pending)})` : ''}. The pull request stays open and the next daily run catches it up and merges it. Nothing was approved.`
    : 'The time reserved for the approval and the merge ran out after the required checks passed. The pull request stays open and the next daily run handles it. Nothing was approved.'
  return outcomeWith(state, 'TIMEOUT', detail)
}

/** A property of whatever was thrown; `Object()` makes a primitive, `null` or `undefined` safe to read. */
function propertyOf(error: unknown, name: string): unknown {
  return Reflect.get(new Object(error), name)
}

/** The status of a thrown GitHub error, if it has one. */
function statusOf(error: unknown): number | undefined {
  const status = propertyOf(error, 'status')
  return typeof status === 'number' ? status : undefined
}

function isTransient(error: unknown): boolean {
  const status = statusOf(error)
  if (status !== undefined) return status === 429 || status >= 500
  const code = propertyOf(error, 'code')
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND'
}

/** The contexts declared for `main` in the text of `.github/settings.yml`; empty when there are none. */
export function parseDeclaredContexts(text: string): readonly string[] {
  const document: unknown = parse(text)
  const branches = isRecord(document) ? document.branches : undefined
  if (!Array.isArray(branches)) return []
  const declared: readonly unknown[] = branches
  const main = declared.find(branch => isRecord(branch) && branch.name === 'main')
  const protection = isRecord(main) ? main.protection : undefined
  const checks = isRecord(protection) ? protection.required_status_checks : undefined
  const contexts = isRecord(checks) ? checks.contexts : undefined
  if (!Array.isArray(contexts)) return []
  return contexts.filter((context: unknown): context is string => typeof context === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fixed stop for a pull request that cannot be approved as it stands, or `null` when it can. */
function guard(input: Pick<SelfMergeInput, 'pullRequest' | 'pin'>, pull: PullView): SelfMergeOutcome | null {
  if (pull.merged) return outcomeOf(input, 'ALREADY_MERGED')
  if (pull.state !== 'open') return outcomeOf(input, 'CLOSED_UNMERGED')
  if (pull.headSha !== input.pin) return outcomeOf(input, 'STALE_HEAD')
  if (pull.labels.includes('hold-merge')) return outcomeOf(input, 'HOLD_MERGE')
  if (!pull.labels.includes('automerge')) return outcomeOf(input, 'NOT_LABELED')
  return null
}

/** Whether a check run has finished and, if so, whether it passed. */
function runOutcome(run: CheckRunView): {readonly done: boolean; readonly ok: boolean} {
  return {
    done: run.status === 'completed',
    ok: run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral',
  }
}

/** Whether a commit status has finished and, if so, whether it passed. */
function statusOutcome(status: StatusView): {readonly done: boolean; readonly ok: boolean} {
  return {
    done: status.state === 'success' || status.state === 'failure' || status.state === 'error',
    ok: status.state === 'success',
  }
}

/**
 * Judges each required check on the pinned commit. A check run counts when its name and app match the
 * requirement (any app when none is named), the newest of several winning; a commit status, which has no
 * app, is matched by context and the newest wins. When a context has both, both must pass: either failing
 * fails the context, either pending keeps it waiting, and an absent one leaves the other to decide alone.
 */
function evaluateChecks(
  required: readonly RequiredCheck[],
  runs: readonly CheckRunView[],
  statuses: readonly StatusView[],
): {readonly failed: readonly string[]; readonly pending: readonly string[]} {
  const failed: string[] = []
  const pending: string[] = []
  for (const check of required) {
    const matching = runs.filter(
      run => run.name === check.context && (check.appId === null || run.appId === check.appId),
    )
    const newest = matching.toSorted((left, right) => right.id - left.id)[0]
    const status = statuses.find(candidate => candidate.context === check.context)
    const reported = [
      ...(newest === undefined ? [] : [runOutcome(newest)]),
      ...(status === undefined ? [] : [statusOutcome(status)]),
    ]
    // Nothing reported yet counts as not done.
    if (reported.some(outcome => outcome.done && !outcome.ok)) failed.push(check.context)
    else if (reported.length === 0 || reported.some(outcome => !outcome.done)) pending.push(check.context)
  }
  return {failed, pending}
}

/** Whether two required-check lists name the same contexts bound to the same apps. */
function sameChecks(left: readonly RequiredCheck[], right: readonly RequiredCheck[]): boolean {
  const keys = (checks: readonly RequiredCheck[]): readonly string[] =>
    checks.map(check => `${check.context}\0${String(check.appId)}`).toSorted()
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right))
}

/** Runs `selfMerge`'s decisions. Any thrown GitHub failure that is not mapped below ends as `API_FAILED`. */
export async function selfMerge(input: SelfMergeInput): Promise<SelfMergeOutcome> {
  if (input.pullRequest === null) return outcomeOf(input, 'NO_PULL_REQUEST')
  if (!input.qualifies) return outcomeOf(input, 'NOT_QUALIFYING')
  const state: RunState = {pullRequest: input.pullRequest, pin: input.pin, approved: false, waiting: true, pending: []}
  try {
    return await promote(input, state)
  } catch (error: unknown) {
    return error instanceof DeadlineError ? timeoutOutcome(state) : outcomeOf(state, 'API_FAILED')
  }
}

async function promote(input: SelfMergeInput, state: RunState): Promise<SelfMergeOutcome> {
  const {octokit, owner, repo} = input
  const {pullRequest} = state
  const config = limits()

  // One deadline for every request: the wait has `waitMs` from the start, and once the checks have settled
  // the approval and the merge have `reserveMs` more. A restart of the wait goes back to the wait deadline.
  const start = input.now()
  const waitDeadline = start + config.waitMs
  const hardDeadline = waitDeadline + config.reserveMs
  let deadline = waitDeadline
  const enter = (waiting: boolean): void => {
    state.waiting = waiting
    deadline = waiting ? waitDeadline : hardDeadline
  }
  // Every request carries a signal that fires when its deadline does. A request that fails with its signal
  // fired was cut off in flight, whatever error Octokit made of it (it turns an abort into a 500).
  const timed = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const remaining = deadline - input.now()
    if (remaining < 0) throw new DeadlineError()
    const signal = input.signal(remaining)
    try {
      return await operation(signal)
    } catch (error: unknown) {
      throw signal.aborted ? new CutOffError() : error
    }
  }
  // A sleep never runs past the deadline.
  const sleep = async (ms: number): Promise<void> => {
    const left = Math.min(ms, deadline - input.now())
    if (left > 0) await input.sleep(left)
  }
  const read = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> =>
    retry(async () => timed(operation), {
      attempts: config.transientAttempts,
      delayMs: attempt => attempt * config.transientBaseMs,
      shouldRetry: isTransient,
      sleep,
    })

  const readProtection = async (): Promise<SelfMergeOutcome | readonly RequiredCheck[]> => {
    let response: Awaited<ReturnType<SelfMergeOctokit['rest']['repos']['getBranch']>>
    try {
      response = await read(async signal =>
        octokit.rest.repos.getBranch({owner, repo, branch: 'main', request: {signal}}),
      )
    } catch (error: unknown) {
      if (error instanceof DeadlineError) throw error
      return outcomeOf(state, 'PROTECTION_UNREADABLE')
    }
    const checks = response.data.protection?.required_status_checks?.checks ?? []
    if (checks.length === 0) {
      return outcomeWith(
        state,
        'PROTECTION_EMPTY',
        'The live required-check list for `main` is empty, so the checks this promotion must pass are unknown. Nothing was approved.',
      )
    }
    const live = checks.map(check => ({context: check.context, appId: check.app_id ?? null}))
    const missing = input.declaredContexts.filter(context => !live.some(check => check.context === context))
    if (missing.length > 0) {
      return outcomeWith(
        state,
        'PROTECTION_SHORT',
        `The live required-check list for \`main\` is missing declared contexts: ${list(missing)}. Nothing was approved.`,
      )
    }
    return live
  }

  const viewOf = (data: {
    state: string
    merged: boolean
    head: {sha: string}
    labels: readonly {name: string}[]
    mergeable_state: string
  }): PullView => ({
    state: data.state,
    merged: data.merged,
    headSha: data.head.sha,
    labels: data.labels.map(label => label.name),
    mergeableState: data.mergeable_state,
  })

  const readPull = async (): Promise<PullView> =>
    viewOf(
      (await read(async signal => octokit.rest.pulls.get({owner, repo, pull_number: pullRequest, request: {signal}})))
        .data,
    )

  /** One read of the pull request that has the time of its own, for a write that was cut off; `null` if it fails. */
  const reconcile = async (): Promise<PullView | null> => {
    try {
      const response = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullRequest,
        request: {signal: input.signal(config.reconcileMs)},
      })
      return viewOf(response.data)
    } catch {
      return null
    }
  }

  const pages = async <T>(fetchPage: (page: number) => Promise<readonly T[]>): Promise<readonly T[]> => {
    let all = Array.of<T>()
    for (const page of Array.from({length: config.maxPages}, (_, index) => index + 1)) {
      const items = await fetchPage(page)
      all = all.concat(items)
      if (items.length < config.pageSize) break
    }
    return all
  }

  const readRuns = async (): Promise<readonly CheckRunView[]> =>
    pages(async page => {
      const response = await read(async signal =>
        octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: input.pin,
          filter: 'latest',
          per_page: config.pageSize,
          page,
          request: {signal},
        }),
      )
      return response.data.check_runs.map(run => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        appId: run.app?.id ?? null,
      }))
    })

  const readStatuses = async (): Promise<readonly StatusView[]> =>
    pages(async page => {
      const response = await read(async signal =>
        octokit.rest.repos.listCommitStatusesForRef({
          owner,
          repo,
          ref: input.pin,
          per_page: config.pageSize,
          page,
          request: {signal},
        }),
      )
      return response.data.map(status => ({context: status.context, state: status.state}))
    })

  /** `on`, anything else as given, or `unreadable` (an error, and a 404 too: a PAT without access sees none). */
  const readSwitch = async (): Promise<string | undefined | 'unreadable'> => {
    try {
      const response = await read(async signal =>
        octokit.rest.actions.getRepoVariable({owner, repo, name: 'PROMOTION_SELF_MERGE', request: {signal}}),
      )
      return response.data.value
    } catch (error: unknown) {
      if (error instanceof DeadlineError) throw error
      return 'unreadable'
    }
  }

  if (input.declaredContexts.length === 0) return outcomeOf(state, 'NO_DECLARED_CONTEXTS')

  const initial = await readProtection()
  if (!Array.isArray(initial)) return initial as SelfMergeOutcome
  let required = initial as readonly RequiredCheck[]

  // One poll per attempt, a minute apart. The attempts are bounded by `retry`, so the wait ends even if the
  // clock never moves; it ends sooner once the wait has used up its 60 minutes. A poll reads the live
  // required list first. It answers with the outcome that stops the run, with `changed` when the list differs
  // (the wait starts over on it), or with the names of the checks still pending.
  const poll = async (): Promise<SelfMergeOutcome | 'changed' | readonly string[]> => {
    const stopped = guard(state, await readPull())
    if (stopped !== null) return stopped
    const live = await readProtection()
    if (!Array.isArray(live)) return live as SelfMergeOutcome
    if (!sameChecks(required, live as readonly RequiredCheck[])) {
      required = live as readonly RequiredCheck[]
      return 'changed'
    }
    const verdict = evaluateChecks(required, await readRuns(), await readStatuses())
    if (verdict.failed.length > 0) {
      return outcomeWith(
        state,
        'CHECK_FAILED',
        `These required checks failed on the pinned commit: ${list(verdict.failed)}. Nothing was approved.`,
      )
    }
    return verdict.pending
  }

  // The wait, then a last fresh read of the required list. A list that changed (a context added, removed or
  // rebound) starts the wait over on the new list, inside the same absolute deadline. The answer is the
  // outcome that stops the run, `changed`, or `null` for a wait that settled on a list that held.
  const attempt = async (): Promise<SelfMergeOutcome | 'changed' | null> => {
    enter(true)
    const polled = await retry(poll, {
      attempts: config.maxPolls,
      delayMs: () => config.pollMs,
      retryResult: result => Array.isArray(result) && result.length > 0 && input.now() - start < config.waitMs,
      sleep,
    })
    if (!Array.isArray(polled)) return polled as SelfMergeOutcome | 'changed'
    state.pending = polled as readonly string[]
    if (polled.length > 0) return timeoutOutcome(state)

    enter(false)
    const recheck = await readProtection()
    if (!Array.isArray(recheck)) return recheck as SelfMergeOutcome
    const same = sameChecks(required, recheck as readonly RequiredCheck[])
    required = recheck as readonly RequiredCheck[]
    return same ? null : 'changed'
  }
  const waited = await retry(attempt, {attempts: config.maxRestarts + 1, retryResult: result => result === 'changed'})
  if (waited === 'changed') return outcomeOf(state, 'PROTECTION_CHANGED')
  if (waited !== null) return waited

  const beforeApproval = guard(state, await readPull())
  if (beforeApproval !== null) return beforeApproval

  // Only a run that started live can approve or merge, and only while a fresh read still says `on`.
  if (input.switchAtStart !== 'on') return outcomeOf(state, 'DRY_RUN')
  const approvalSwitch = await readSwitch()
  if (approvalSwitch === 'unreadable') return outcomeOf(state, 'SWITCH_UNREADABLE')
  if (approvalSwitch !== 'on') return outcomeOf(state, 'DRY_RUN')

  try {
    await timed(async signal =>
      octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullRequest,
        commit_id: input.pin,
        event: 'APPROVE',
        body: `Approved by Merge Data Branch: ${input.pin} touches only knowledge/ and metadata/ and passed the promotion gates.`,
        request: {signal},
      }),
    )
    state.approved = true
  } catch (error: unknown) {
    if (error instanceof CutOffError) return approvalUnknown(state, await reconcile())
    if (error instanceof DeadlineError) throw error
    if (statusOf(error) === 422) {
      const stale = guard(state, await readPull())
      if (stale !== null) return stale
    }
    return outcomeOf(state, 'APPROVE_FAILED')
  }

  // `mergeable_state` is computed lazily: re-read it while it says `unknown`, guarding every read.
  const settle = async (): Promise<{stop: SelfMergeOutcome | null; pull: PullView}> =>
    retry(
      async () => {
        const pull = await readPull()
        return {stop: guard(state, pull), pull}
      },
      {
        attempts: config.mergeableRereads + 1,
        delayMs: () => config.mergeableDelayMs,
        retryResult: result => result.stop === null && result.pull.mergeableState === 'unknown',
        sleep,
      },
    )

  const ready = await settle()
  if (ready.stop !== null) return ready.stop

  const mergeSwitch = await readSwitch()
  if (mergeSwitch === 'unreadable') return outcomeOf(state, 'SWITCH_UNREADABLE')
  if (mergeSwitch !== 'on') return outcomeOf(state, 'SWITCH_TURNED_OFF')

  try {
    const merged = await timed(async signal =>
      octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: pullRequest,
        sha: input.pin,
        merge_method: 'squash',
        request: {signal},
      }),
    )
    return outcomeOf(state, merged.data.merged ? 'MERGED' : 'MERGE_FAILED')
  } catch (error: unknown) {
    const cutOff = error instanceof CutOffError
    if (error instanceof DeadlineError && !cutOff) throw error
    const status = statusOf(error)
    if (status === 409) return outcomeOf(state, 'OPEN_WAITING')
    if (status === 405) {
      const after = await settle()
      if (after.stop !== null) return after.stop
      return outcomeOf(state, after.pull.mergeableState === 'behind' ? 'OPEN_WAITING' : 'MERGE_BLOCKED')
    }
    // The merge may have gone through before the failure or the cut-off: look before reporting.
    const pull = await reconcile()
    if (pull === null) return outcomeOf(state, 'MERGE_UNKNOWN')
    if (pull.merged) return outcomeOf(state, cutOff ? 'MERGED_AFTER_CUT_OFF' : 'MERGED')
    return outcomeOf(state, cutOff ? 'MERGE_CUT_OFF' : 'MERGE_FAILED')
  }
}

/** The outcome of an approval request that was cut off: what a read afterwards showed, if it showed anything. */
function approvalUnknown(state: RunState, pull: PullView | null): SelfMergeOutcome {
  const seen =
    pull === null
      ? 'The pull request could not be read afterwards.'
      : `Read again afterwards, the pull request is ${pull.merged ? 'merged' : pull.state}.`
  return outcomeWith(
    state,
    'APPROVAL_UNKNOWN',
    `The approval request was cut off at the deadline, so it is not known whether GitHub recorded it. ${seen} Check its reviews and dismiss the approval if the promotion should not merge.`,
  )
}

export interface RunSelfMergeParams {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The text of `.github/settings.yml`. */
  readonly readSettings: () => string
  readonly createClient: (token: string) => Promise<SelfMergeOctokit>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly signal: (ms: number) => AbortSignal
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Defaults to `appendFileSync`; a test passes a recorder. */
  readonly append?: (path: string, content: string) => void
}

/**
 * The CLI body. Reads `PROMOTION_PR`, `PROMOTION_PIN`, `PROMOTION_QUALIFIES` and `PROMOTION_SELF_MERGE`
 * from the env and the token from `GH_TOKEN`, runs `selfMerge`, writes the outcome as a job summary and
 * returns the exit code. An outcome that stops the run is a line on stdout; one that fails it is a fixed
 * `::error::` line on stderr.
 */
export async function runSelfMerge(params: RunSelfMergeParams): Promise<number> {
  const {env} = params
  const fail = (code: string): number => {
    params.stderr(`::error::promotion-self-merge: ${code}\n`)
    return 1
  }
  const finish = (outcome: SelfMergeOutcome): number => {
    appendStepSummary(outcome.summary, {onMissing: 'skip', env, append: params.append})
    if (outcome.exitCode === 0) {
      params.stdout(`promotion-self-merge: ${outcome.code}\n`)
      return 0
    }
    return fail(outcome.code)
  }

  // A value from the env is shown in a summary only after it has been checked, so a bad one is never echoed.
  const pinText = String(env.PROMOTION_PIN)
  const pin = /^[0-9a-f]{40}$/u.test(pinText) ? pinText : ''
  const prText = env.PROMOTION_PR ?? ''
  if (prText === '') return finish(outcomeOf({pullRequest: null, pin}, 'NO_PULL_REQUEST'))
  const pullRequest = /^[1-9]\d*$/u.test(prText) ? Number(prText) : null
  const stop = (code: string, title: string, detail: string): number => {
    appendStepSummary(summaryFor({pullRequest, pin}, title, detail), {onMissing: 'skip', env, append: params.append})
    return fail(code)
  }
  if (pullRequest === null) {
    return stop(
      'INVALID_PULL_REQUEST',
      'invalid pull request number',
      'The pull request number from the PR step is not a positive integer, so the run stopped before it read anything. Check the "Open data merge PR" step and its outputs.',
    )
  }
  if (pin === '') {
    return stop(
      'INVALID_PIN',
      'invalid pinned commit',
      'The pinned commit from the pin step is not a 40-character commit id, so the run stopped before it read anything. Check the "Pin the data commit" step.',
    )
  }
  if (env.PROMOTION_QUALIFIES !== 'true') return finish(outcomeOf({pullRequest, pin}, 'NOT_QUALIFYING'))

  const token = env.GH_TOKEN ?? ''
  if (token === '') {
    return stop(
      'MISSING_TOKEN',
      'no token',
      "The step has no `FRO_BOT_PAT`, so it cannot read the checks or approve. Check the repository secret and the step's env.",
    )
  }

  let declaredContexts: readonly string[]
  try {
    declaredContexts = parseDeclaredContexts(params.readSettings())
  } catch {
    return stop(
      'SETTINGS_UNREADABLE',
      'settings unreadable',
      '`.github/settings.yml` could not be read or parsed, so the declared checks are unknown. Check the file on `main`.',
    )
  }

  let octokit: SelfMergeOctokit
  try {
    octokit = await params.createClient(token)
  } catch {
    return stop(
      'API_FAILED',
      'GitHub API failure',
      'The GitHub client could not be created, so the run stopped before it read anything. Check the token.',
    )
  }

  return finish(
    await selfMerge({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      pullRequest,
      pin,
      qualifies: true,
      switchAtStart: env.PROMOTION_SELF_MERGE,
      declaredContexts,
      now: params.now,
      sleep: params.sleep,
      signal: params.signal,
    }),
  )
}
