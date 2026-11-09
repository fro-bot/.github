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
 * - The repository variable `PROMOTION_SELF_MERGE` must be exactly `on` for an approval or a merge. It is
 *   read through the API before the approval and again before the merge. Any other value is a dry run: the
 *   run waits and polls as a live run does, then stops right before the approval.
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
  | 'NO_DECLARED_CONTEXTS'
  | 'SWITCH_UNREADABLE'
  | 'SWITCH_TURNED_OFF'
  | 'APPROVE_FAILED'
  | 'OPEN_WAITING'
  | 'MERGE_FAILED'
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
type DynamicCode = 'TIMEOUT' | 'CHECK_FAILED' | 'PROTECTION_EMPTY' | 'PROTECTION_SHORT'
type FixedCode = Exclude<SelfMergeCode, DynamicCode>

/** Settings that read as numbers and durations, inside a function so a mutant in them is exercised. */
function limits() {
  return {
    waitMs: 60 * 60 * 1000,
    pollMs: 60 * 1000,
    transientAttempts: 3,
    transientBaseMs: 2000,
    mergeableRereads: 3,
    mergeableDelayMs: 2000,
    pageSize: 100,
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
    NO_DECLARED_CONTEXTS: 'no declared checks',
    SWITCH_UNREADABLE: 'switch unreadable',
    SWITCH_TURNED_OFF: 'switched off after approval',
    APPROVE_FAILED: 'approval failed',
    OPEN_WAITING: 'open, waiting',
    MERGE_FAILED: 'merge failed',
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
    'MERGE_BLOCKED',
    'API_FAILED',
  ]).has(code)
}

function list(names: readonly string[]): string {
  return names.map(name => `\`${name}\``).join(', ')
}

function outcomeOf(input: Pick<SelfMergeInput, 'pullRequest' | 'pin'>, code: FixedCode): SelfMergeOutcome {
  return build(input, code, details()[code])
}

function outcomeWith(
  input: Pick<SelfMergeInput, 'pullRequest' | 'pin'>,
  code: DynamicCode,
  detail: string,
): SelfMergeOutcome {
  return build(input, code, detail)
}

function build(
  input: Pick<SelfMergeInput, 'pullRequest' | 'pin'>,
  code: SelfMergeCode,
  detail: string,
): SelfMergeOutcome {
  const facts = [
    input.pullRequest === null ? undefined : `- Pull request: #${String(input.pullRequest)}`,
    `- Pinned commit: \`${input.pin}\``,
  ].filter(fact => fact !== undefined)
  return {
    exitCode: failsRun(code) ? 1 : 0,
    code,
    summary: [`### Promotion self-merge: ${titles()[code]}`, '', detail, '', ...facts, ''].join('\n'),
  }
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
 * app, is matched by context and the newest wins. A check run decides before a status does.
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
    // Nothing reported yet counts as not done.
    const outcome = newest === undefined ? undefined : runOutcome(newest)
    const fromStatus = outcome === undefined && status !== undefined ? statusOutcome(status) : outcome
    if (fromStatus === undefined || !fromStatus.done) pending.push(check.context)
    else if (!fromStatus.ok) failed.push(check.context)
  }
  return {failed, pending}
}

/** Runs `selfMerge`'s decisions. Any thrown GitHub failure that is not mapped below ends as `API_FAILED`. */
export async function selfMerge(input: SelfMergeInput): Promise<SelfMergeOutcome> {
  if (input.pullRequest === null) return outcomeOf(input, 'NO_PULL_REQUEST')
  if (!input.qualifies) return outcomeOf(input, 'NOT_QUALIFYING')
  try {
    return await promote(input, input.pullRequest)
  } catch {
    return outcomeOf(input, 'API_FAILED')
  }
}

async function promote(input: SelfMergeInput, pullRequest: number): Promise<SelfMergeOutcome> {
  const {octokit, owner, repo} = input
  const config = limits()
  const read = async <T>(operation: () => Promise<T>): Promise<T> =>
    retry(operation, {
      attempts: config.transientAttempts,
      delayMs: attempt => attempt * config.transientBaseMs,
      shouldRetry: isTransient,
      sleep: input.sleep,
    })

  const readProtection = async (): Promise<SelfMergeOutcome | readonly RequiredCheck[]> => {
    let response: Awaited<ReturnType<SelfMergeOctokit['rest']['repos']['getBranch']>>
    try {
      response = await read(async () => octokit.rest.repos.getBranch({owner, repo, branch: 'main'}))
    } catch {
      return outcomeOf(input, 'PROTECTION_UNREADABLE')
    }
    const checks = response.data.protection?.required_status_checks?.checks ?? []
    if (checks.length === 0) {
      return outcomeWith(
        input,
        'PROTECTION_EMPTY',
        'The live required-check list for `main` is empty, so the checks this promotion must pass are unknown. Nothing was approved.',
      )
    }
    const live = checks.map(check => ({context: check.context, appId: check.app_id ?? null}))
    const missing = input.declaredContexts.filter(context => !live.some(check => check.context === context))
    if (missing.length > 0) {
      return outcomeWith(
        input,
        'PROTECTION_SHORT',
        `The live required-check list for \`main\` is missing declared contexts: ${list(missing)}. Nothing was approved.`,
      )
    }
    return live
  }

  const readPull = async (): Promise<PullView> => {
    const response = await read(async () => octokit.rest.pulls.get({owner, repo, pull_number: pullRequest}))
    return {
      state: response.data.state,
      merged: response.data.merged,
      headSha: response.data.head.sha,
      labels: response.data.labels.map(label => label.name),
      mergeableState: response.data.mergeable_state,
    }
  }

  const pages = async <T>(fetchPage: (page: number) => Promise<readonly T[]>, page = 1): Promise<readonly T[]> => {
    const items = await read(async () => fetchPage(page))
    if (items.length < config.pageSize) return items
    return [...items, ...(await pages(fetchPage, page + 1))]
  }

  const readRuns = async (): Promise<readonly CheckRunView[]> =>
    pages(async page => {
      const response = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: input.pin,
        filter: 'latest',
        per_page: config.pageSize,
        page,
      })
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
      const response = await octokit.rest.repos.listCommitStatusesForRef({
        owner,
        repo,
        ref: input.pin,
        per_page: config.pageSize,
        page,
      })
      return response.data.map(status => ({context: status.context, state: status.state}))
    })

  /** `on`, anything else as given, `undefined` when unset, or `unreadable`. */
  const readSwitch = async (): Promise<string | undefined | 'unreadable'> => {
    try {
      const response = await read(async () =>
        octokit.rest.actions.getRepoVariable({owner, repo, name: 'PROMOTION_SELF_MERGE'}),
      )
      return response.data.value
    } catch (error: unknown) {
      return statusOf(error) === 404 ? undefined : 'unreadable'
    }
  }

  if (input.declaredContexts.length === 0) return outcomeOf(input, 'NO_DECLARED_CONTEXTS')

  const protection = await readProtection()
  if (!Array.isArray(protection)) return protection as SelfMergeOutcome
  const required = protection as readonly RequiredCheck[]

  const start = input.now()
  for (;;) {
    const stopped = guard(input, await readPull())
    if (stopped !== null) return stopped
    const verdict = evaluateChecks(required, await readRuns(), await readStatuses())
    if (verdict.failed.length > 0) {
      return outcomeWith(
        input,
        'CHECK_FAILED',
        `These required checks failed on the pinned commit: ${list(verdict.failed)}. Nothing was approved.`,
      )
    }
    if (verdict.pending.length === 0) break
    if (input.now() - start >= config.waitMs) {
      return outcomeWith(
        input,
        'TIMEOUT',
        `The required checks did not settle within 60 minutes (still waiting on: ${list(verdict.pending)}). The pull request stays open and the next daily run catches it up and merges it. Nothing was approved.`,
      )
    }
    await input.sleep(config.pollMs)
  }

  const recheck = await readProtection()
  if (!Array.isArray(recheck)) return recheck as SelfMergeOutcome

  const beforeApproval = guard(input, await readPull())
  if (beforeApproval !== null) return beforeApproval

  const startedLive = input.switchAtStart === 'on'
  const approvalSwitch = await readSwitch()
  if (approvalSwitch === 'unreadable' && startedLive) return outcomeOf(input, 'SWITCH_UNREADABLE')
  if (approvalSwitch !== 'on') return outcomeOf(input, 'DRY_RUN')

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullRequest,
      commit_id: input.pin,
      event: 'APPROVE',
      body: `Approved by Merge Data Branch: ${input.pin} touches only knowledge/ and metadata/ and passed the promotion gates.`,
    })
  } catch (error: unknown) {
    if (statusOf(error) === 422) {
      const stale = guard(input, await readPull())
      if (stale !== null) return stale
    }
    return outcomeOf(input, 'APPROVE_FAILED')
  }

  // `mergeable_state` is computed lazily: re-read it while it says `unknown`, guarding every read.
  const settle = async (): Promise<PullView | SelfMergeOutcome> => {
    let pull = await readPull()
    for (let rereads = 0; ; rereads += 1) {
      const stopped = guard(input, pull)
      if (stopped !== null) return stopped
      if (pull.mergeableState !== 'unknown' || rereads >= config.mergeableRereads) return pull
      await input.sleep(config.mergeableDelayMs)
      pull = await readPull()
    }
  }

  const ready = await settle()
  if ('code' in ready) return ready

  const mergeSwitch = await readSwitch()
  if (mergeSwitch === 'unreadable') return outcomeOf(input, 'SWITCH_UNREADABLE')
  if (mergeSwitch !== 'on') return outcomeOf(input, 'SWITCH_TURNED_OFF')

  try {
    const merged = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pullRequest,
      sha: input.pin,
      merge_method: 'squash',
    })
    return outcomeOf(input, merged.data.merged ? 'MERGED' : 'MERGE_FAILED')
  } catch (error: unknown) {
    const status = statusOf(error)
    if (status === 409) return outcomeOf(input, 'OPEN_WAITING')
    if (status === 405) {
      const after = await settle()
      if ('code' in after) return after
      return outcomeOf(input, after.mergeableState === 'behind' ? 'OPEN_WAITING' : 'MERGE_BLOCKED')
    }
    // The merge may have gone through before the failure: look before reporting.
    try {
      const pull = await readPull()
      if (pull.merged) return outcomeOf(input, 'MERGED')
    } catch {
      // The state is unknown; report the merge as failed.
    }
    return outcomeOf(input, 'MERGE_FAILED')
  }
}

export interface RunSelfMergeParams {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The text of `.github/settings.yml`. */
  readonly readSettings: () => string
  readonly createClient: (token: string) => Promise<SelfMergeOctokit>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
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

  const pin = env.PROMOTION_PIN ?? ''
  const prText = env.PROMOTION_PR ?? ''
  if (prText === '') return finish(outcomeOf({pullRequest: null, pin}, 'NO_PULL_REQUEST'))
  if (!/^[1-9]\d*$/u.test(prText)) return fail('INVALID_PULL_REQUEST')
  const pullRequest = Number(prText)
  if (!/^[0-9a-f]{40}$/u.test(pin)) return fail('INVALID_PIN')
  if (env.PROMOTION_QUALIFIES !== 'true') return finish(outcomeOf({pullRequest, pin}, 'NOT_QUALIFYING'))

  const token = env.GH_TOKEN ?? ''
  if (token === '') return fail('MISSING_TOKEN')

  let declaredContexts: readonly string[]
  try {
    declaredContexts = parseDeclaredContexts(params.readSettings())
  } catch {
    return fail('SETTINGS_UNREADABLE')
  }

  let octokit: SelfMergeOctokit
  try {
    octokit = await params.createClient(token)
  } catch {
    return fail('API_FAILED')
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
    }),
  )
}
