/**
 * Approves open Renovate PRs that carry `automerge`, one per sweep, pinned to the head whose required checks
 * passed. GitHub's native auto-merge, which Renovate arms, does the merge: this module has no merge call, no
 * auto-merge call and no way to dismiss a review (the Octokit slice it takes holds none).
 *
 * - A sweep is one run of the CLI. It never reads an event payload to pick a PR: it lists the open PRs against
 *   `main` and judges each from current state, so a lost or replaced event costs nothing.
 * - A candidate is a PR authored by the App (type `Bot`, numeric id), from a head in this repository whose ref
 *   starts with `renovate/`, carrying `automerge`. Anything else is not listed at all. A candidate then fails
 *   qualification when it carries `hold-merge`, when a commit's resolved author is not the App or the commit is
 *   unverified, or when it touches a Renovate config file. The committer is not tested: GitHub's web flow
 *   commits for the App.
 * - Before any PR is judged the live required list of `main` is read and must name every context declared in
 *   `.github/settings.yml`. A list that is unreadable, empty or short stops the sweep with exit 1.
 * - Each PR is judged once, from scratch: behind `main` (measured), the required checks on its head, an
 *   approval already given on that head. A PR whose checks are pending or failed waits for the next sweep.
 * - One approval per sweep, lowest PR number first; the others that are ready are `deferred`. The slot is used
 *   once a request is sent, whatever the response, and in a dry run by the first `would-approve`.
 * - The mode is `RENOVATE_APPROVE` as the step started: only `on` is live, anything else is a dry run for the
 *   whole sweep. Right before an approval a fresh read must still agree (PR, `main`, required list, and in a
 *   live sweep the variable) and can only stop the approval.
 * - A list that reaches the API's cap, or a read that fails, is an `error` for that PR and no approval; the
 *   other PRs are still judged. Every request goes through one wrapper with an abort signal sized to what is
 *   left of one budget for the sweep; when it is spent the remaining candidates are `error`.
 * - Exit 0 when no candidate ended in `error` or `approval-unknown`. Exit 1 otherwise, and when the required
 *   list or the candidate list could not be trusted. The job summary and stderr carry fixed strings, outcome
 *   codes, PR numbers, short SHAs and required-check names only: never a response body, a token, a title or a
 *   branch name.
 * - The clock, the sleep and the signal are injected, so no test waits for real.
 */

import type {Octokit} from '@octokit/rest'

import {appendStepSummary} from '@fro-bot/core/output'
import {retry} from '@fro-bot/core/retry'
import {
  CutOffError,
  DeadlineError,
  evaluateChecks,
  isTransient,
  parseDeclaredContexts,
  readCheckRuns,
  readCommitStatuses,
  readRequiredChecks,
  sameChecks,
  type ReadRequest,
} from './required-checks.ts'

/** The slice of Octokit this module calls. It holds no merge, no auto-merge and no dismiss method. */
export interface ApproveOctokit {
  readonly rest: {
    readonly repos: Pick<
      Octokit['rest']['repos'],
      'compareCommitsWithBasehead' | 'getBranch' | 'listCommitStatusesForRef'
    >
    readonly checks: Pick<Octokit['rest']['checks'], 'listForRef'>
    readonly pulls: Pick<
      Octokit['rest']['pulls'],
      'createReview' | 'get' | 'list' | 'listCommits' | 'listFiles' | 'listReviews'
    >
    readonly actions: Pick<Octokit['rest']['actions'], 'getRepoVariable'>
  }
}

export interface SweepInput {
  readonly octokit: ApproveOctokit
  readonly owner: string
  readonly repo: string
  /** `vars.RENOVATE_APPROVE` as the step started. Only `on` makes the sweep live. */
  readonly modeAtStart: string | undefined
  /** The contexts declared for `main` in `.github/settings.yml`. */
  readonly declaredContexts: readonly string[]
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** An abort signal that fires after `ms`; the real one is `AbortSignal.timeout`. */
  readonly signal: (ms: number) => AbortSignal
}

export type OutcomeCode =
  | 'held'
  | 'foreign-commit'
  | 'config-change'
  | 'behind'
  | 'checks-failed'
  | 'checks-pending'
  | 'already-approved'
  | 'deferred'
  | 'head-moved'
  | 'no-longer-qualifies'
  | 'protection-changed'
  | 'switch-off'
  | 'would-approve'
  | 'approved'
  | 'approved-not-armed'
  | 'approval-unknown'
  | 'error'

/** Why a sweep stopped before it judged any PR, or ran out of budget while it did. */
export type StopCode =
  | 'NO_DECLARED_CONTEXTS'
  | 'REQUIRED_UNREADABLE'
  | 'REQUIRED_EMPTY'
  | 'REQUIRED_SHORT'
  | 'CANDIDATES_UNREADABLE'
  | 'TIMEOUT'
  | 'API_FAILED'

/** One candidate in the report: the PR, the head that was judged, what came of it, and what to read next. */
export interface Row {
  readonly number: number
  readonly head: string
  readonly outcome: OutcomeCode
  readonly detail: string
  /** Whether native auto-merge is armed on the PR. */
  readonly armed: boolean
}

export interface SweepResult {
  readonly exitCode: 0 | 1
  readonly live: boolean
  readonly stop: StopCode | null
  readonly rows: readonly Row[]
}

/** A PR as the sweep needs it, from a list item or a single read. */
interface PullData {
  readonly number: number
  readonly state: string
  readonly user: {readonly id: number; readonly type: string} | null
  readonly head: {readonly sha: string; readonly ref: string; readonly repo: {readonly id: number} | null}
  readonly base: {readonly ref: string; readonly repo: {readonly id: number}}
  readonly labels: readonly {readonly name: string}[]
  readonly auto_merge: unknown
}

interface PullView {
  readonly number: number
  readonly open: boolean
  readonly baseIsMain: boolean
  readonly byApp: boolean
  readonly sameRepository: boolean
  readonly renovateBranch: boolean
  readonly headSha: string
  readonly labels: readonly string[]
  readonly armed: boolean
}

/** Numbers and durations, inside a function so a mutant in them is exercised. */
function limits() {
  return {
    // One budget for the whole sweep: the reads, the approval and the review reconcile after it.
    budgetMs: 10 * 60 * 1000,
    // The one read that reconciles an approval that was cut off, outside the spent budget.
    reconcileMs: 2 * 60 * 1000,
    transientAttempts: 3,
    transientBaseMs: 2000,
    pageSize: 100,
    // The compare lists at most 250 commits a PR may hold and 300 files, on its first page only.
    commitCap: 250,
    fileCap: 300,
    // Pages of a hundred for the PR list and the reviews: 50.
    listCap: 5000,
    shortSha: 7,
  }
}

/** The identity of the App that Renovate commits and opens PRs as, and the user that approves. */
function identity() {
  return {appId: 109_017_866, appType: 'Bot', approver: 'fro-bot'}
}

/** The Renovate config files the approver never lets through: they decide which updates are labelled. */
function configPaths(): readonly string[] {
  return ['default.json', '.github/renovate.json5']
}

function list(names: readonly string[]): string {
  return names.map(name => `\`${name}\``).join(', ')
}

function isApp(user: unknown): boolean {
  const app = identity()
  // `Object()` makes a primitive, `null` or `undefined` safe to read.
  const candidate = new Object(user)
  return Reflect.get(candidate, 'type') === app.appType && Reflect.get(candidate, 'id') === app.appId
}

function viewOf(data: PullData): PullView {
  return {
    number: data.number,
    open: data.state === 'open',
    baseIsMain: data.base.ref === 'main',
    byApp: isApp(data.user),
    sameRepository: data.head.repo !== null && data.head.repo.id === data.base.repo.id,
    renovateBranch: data.head.ref.startsWith('renovate/'),
    headSha: data.head.sha,
    labels: data.labels.map(label => label.name),
    armed: data.auto_merge !== null,
  }
}

/** Whether a PR is one the approver considers at all: by the App, from this repository's `renovate/` branch, labelled. */
function isCandidate(view: PullView): boolean {
  return (
    view.open &&
    view.baseIsMain &&
    view.byApp &&
    view.sameRepository &&
    view.renovateBranch &&
    view.labels.includes('automerge')
  )
}

/** The head as the report shows it: seven characters of a real commit id, or nothing. */
function shortHead(sha: string): string {
  return /^[0-9a-f]{40}$/u.test(sha) ? sha.slice(0, limits().shortSha) : 'unknown'
}

/** A commit counts when GitHub resolved its author to the App and verified its signature. */
function isAppCommit(entry: object): boolean {
  const verification: unknown = Reflect.get(new Object(Reflect.get(entry, 'commit')), 'verification')
  return isApp(Reflect.get(entry, 'author')) && Reflect.get(new Object(verification), 'verified') === true
}

/** Whether a changed file is, or was renamed from, one of the Renovate config files. */
function touchesConfig(file: {readonly filename: string; readonly previous_filename?: string}): boolean {
  const paths = new Set<string | undefined>(configPaths())
  return paths.has(file.filename) || paths.has(file.previous_filename)
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/** A changed file the compare listed, or `null` when the entry is not one. */
function fileOf(entry: unknown): {readonly filename: string; readonly previous_filename?: string} | null {
  if (!isObject(entry)) return null
  const filename: unknown = Reflect.get(entry, 'filename')
  const previous: unknown = Reflect.get(entry, 'previous_filename')
  if (typeof filename !== 'string') return null
  if (previous !== undefined && typeof previous !== 'string') return null
  return previous === undefined ? {filename} : {filename, previous_filename: previous}
}

/** What a compare of `main` against one head SHA shows. */
type Compared =
  | {readonly kind: 'capped'}
  | {readonly kind: 'malformed'}
  | {readonly kind: 'ok'; readonly behind: boolean; readonly foreign: boolean; readonly config: boolean}

/** Fixed text for each outcome that has none of its own. */
function details(): Readonly<Record<Exclude<OutcomeCode, 'checks-failed' | 'checks-pending' | 'error'>, string>> {
  return {
    held: 'carries hold-merge',
    'foreign-commit': 'a commit is not by the App, or is unverified',
    'config-change': 'changes a Renovate config file',
    behind: 'behind main; Renovate rebases it',
    'already-approved': 'already approved by fro-bot on this head',
    deferred: 'ready; another PR was approved in this sweep',
    'head-moved': 'the head changed before the approval',
    'no-longer-qualifies': 'closed, unlabelled or held before the approval',
    'protection-changed': 'the required checks for main changed before the approval',
    'switch-off': 'RENOVATE_APPROVE was no longer on before the approval',
    'would-approve': 'dry run: RENOVATE_APPROVE is not on',
    approved: 'approved on this head',
    'approved-not-armed': 'approved; auto-merge is not armed, merge it by hand',
    'approval-unknown': 'the approval failed or was cut off and no approval was found; check the reviews',
  }
}

/** The fixed reasons a PR ends as `error`. */
function errorDetails() {
  return {
    read: 'a GitHub read failed',
    capped: 'a list reached the API cap',
    budget: 'the sweep ran out of time',
    switch: 'RENOVATE_APPROVE could not be read',
    list: 'the required checks for main could not be read',
  }
}

/** Runs the sweep. Any thrown failure that is not mapped below ends it as `API_FAILED`. */
export async function sweep(input: SweepInput): Promise<SweepResult> {
  const live = input.modeAtStart === 'on'
  const stopped = (stop: StopCode, rows: readonly Row[] = []): SweepResult => ({exitCode: 1, live, stop, rows})
  if (input.declaredContexts.length === 0) return stopped('NO_DECLARED_CONTEXTS')
  try {
    return await run(input, live)
  } catch (error: unknown) {
    return stopped(error instanceof DeadlineError ? 'TIMEOUT' : 'API_FAILED')
  }
}

async function run(input: SweepInput, live: boolean): Promise<SweepResult> {
  const {octokit, owner, repo} = input
  const config = limits()
  const budgetEnd = input.now() + config.budgetMs

  // Every request carries a signal that fires when the budget does. A request that fails with its signal
  // fired was cut off in flight, whatever error Octokit made of it (it turns an abort into a 500).
  const timed = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const remaining = budgetEnd - input.now()
    if (remaining <= 0) throw new DeadlineError()
    const signal = input.signal(remaining)
    try {
      return await operation(signal)
    } catch (error: unknown) {
      throw signal.aborted ? new CutOffError() : error
    }
  }
  const read: ReadRequest = async operation =>
    retry(async () => timed(operation), {
      attempts: config.transientAttempts,
      delayMs: attempt => attempt * config.transientBaseMs,
      shouldRetry: isTransient,
      sleep: input.sleep,
    })
  const client = {client: octokit, owner, repo, read}

  /** Pages of a hundred, read to the end. `capped` when the list reached `cap`, so there may be more. */
  const readList = async <T>(
    fetchPage: (page: number) => Promise<readonly T[]>,
    cap: number,
  ): Promise<{readonly items: readonly T[]; readonly capped: boolean}> => {
    let all = Array.of<T>()
    for (const page of Array.from({length: Math.ceil(cap / config.pageSize)}, (_, index) => index + 1)) {
      const items = await fetchPage(page)
      all = all.concat(items)
      if (items.length < config.pageSize) break
    }
    return {items: all, capped: all.length >= cap}
  }

  const requiredList = async () => readRequiredChecks({...client, declared: input.declaredContexts})

  const initial = await requiredList()
  if (initial.kind === 'unreadable') return {exitCode: 1, live, stop: 'REQUIRED_UNREADABLE', rows: []}
  if (initial.kind === 'empty') return {exitCode: 1, live, stop: 'REQUIRED_EMPTY', rows: []}
  if (initial.kind === 'short') return {exitCode: 1, live, stop: 'REQUIRED_SHORT', rows: []}
  const required = initial.checks

  let listed: {readonly items: readonly PullData[]; readonly capped: boolean}
  try {
    listed = await readList(
      async page =>
        (
          await read(async signal =>
            octokit.rest.pulls.list({
              owner,
              repo,
              state: 'open',
              base: 'main',
              per_page: config.pageSize,
              page,
              request: {signal},
            }),
          )
        ).data,
      config.listCap,
    )
  } catch (error: unknown) {
    if (error instanceof DeadlineError) throw error
    return {exitCode: 1, live, stop: 'CANDIDATES_UNREADABLE', rows: []}
  }
  if (listed.capped) return {exitCode: 1, live, stop: 'CANDIDATES_UNREADABLE', rows: []}

  const candidates = listed.items
    .map(viewOf)
    .filter(isCandidate)
    .toSorted((left, right) => left.number - right.number)

  const reasons = errorDetails()
  const texts = details()

  /**
   * Compares the current `main` with one head SHA, which gives the commits and the changed files of exactly
   * that head, whatever the branch is moved to afterwards, and how far `main` is ahead of it. The answer is
   * complete or it is not an answer: more commits than were returned, a file list at the compare's cap, a count
   * that is not a number or an entry that is not what it should be all fail closed.
   */
  const compareHead = async (head: string): Promise<Compared> => {
    const fetchPage = async (page: number) =>
      (
        await read(async signal =>
          octokit.rest.repos.compareCommitsWithBasehead({
            owner,
            repo,
            basehead: `main...${head}`,
            per_page: config.pageSize,
            page,
            request: {signal},
          }),
        )
      ).data
    const first = await fetchPage(1)
    const total: unknown = first.total_commits
    if (typeof total !== 'number') return {kind: 'malformed'}
    if (total > config.commitCap) return {kind: 'capped'}
    const commits: unknown[] = Array.isArray(first.commits) ? [...first.commits] : []
    for (const page of Array.from({length: Math.ceil(config.commitCap / config.pageSize) - 1}, (_, i) => i + 2)) {
      if (commits.length >= total) break
      commits.push(...(await fetchPage(page)).commits)
    }
    const changed: unknown = first.files
    if (commits.length !== total || !Array.isArray(changed)) return {kind: 'malformed'}
    if (changed.length >= config.fileCap) return {kind: 'capped'}
    const files = changed.map(fileOf)
    if (!commits.every(isObject) || files.includes(null)) return {kind: 'malformed'}
    return {
      kind: 'ok',
      // Anything but a count of zero is not up to date: a missing or odd count never reads as current.
      behind: first.behind_by !== 0,
      foreign: commits.length === 0 || !commits.every(isAppCommit),
      config: files.some(file => file !== null && touchesConfig(file)),
    }
  }

  /** The reviews of a PR, read to the end. */
  const readReviews = async (number: number) =>
    readList(
      async page =>
        (
          await read(async signal =>
            octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: number,
              per_page: config.pageSize,
              page,
              request: {signal},
            }),
          )
        ).data,
      config.listCap,
    )

  const isApproval = (
    review: {
      readonly user?: {readonly login: string} | null
      readonly state: string
      readonly commit_id?: string | null
    },
    head: string,
  ): boolean => review.user?.login === identity().approver && review.state === 'APPROVED' && review.commit_id === head

  /**
   * Looks for the approval this sweep sent in the PR's reviews. The whole walk shares one signal of
   * `reconcileMs`, outside the spent budget, and no page is retried. A page that fails, a signal that fires or
   * a list that reaches its cap before the approval turns up leaves it unknown; `null` says the walk failed.
   */
  const reconcile = async (number: number) => {
    const signal = input.signal(config.reconcileMs)
    try {
      const reviews = await readList(
        async page =>
          (
            await octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: number,
              per_page: config.pageSize,
              page,
              request: {signal},
            })
          ).data,
        config.listCap,
      )
      return reviews.items
    } catch {
      return null
    }
  }

  /** `on`, anything else as given, or `unreadable` (an error, and a 404 too: a PAT without access sees none). */
  const readSwitch = async (): Promise<string | undefined | 'unreadable'> => {
    try {
      const response = await read(async signal =>
        octokit.rest.actions.getRepoVariable({owner, repo, name: 'RENOVATE_APPROVE', request: {signal}}),
      )
      return response.data.value
    } catch (error: unknown) {
      if (error instanceof DeadlineError) throw error
      return 'unreadable'
    }
  }

  let slotUsed = false

  const judge = async (pull: PullView): Promise<Row> => {
    const head = pull.headSha
    const row = (outcome: OutcomeCode, detail: string, armed = pull.armed): Row => ({
      number: pull.number,
      head: shortHead(head),
      outcome,
      detail,
      armed,
    })
    const fixed = (outcome: keyof typeof texts, armed = pull.armed): Row => row(outcome, texts[outcome], armed)
    /** The row that stops a PR on what its compare shows, or `null` when the compare allows an approval. */
    const stopFor = (compared: Compared, armed: boolean): Row | null => {
      if (compared.kind === 'capped') return row('error', reasons.capped, armed)
      if (compared.kind === 'malformed') return row('error', reasons.read, armed)
      if (compared.foreign) return fixed('foreign-commit', armed)
      if (compared.config) return fixed('config-change', armed)
      if (compared.behind) return fixed('behind', armed)
      return null
    }

    if (pull.labels.includes('hold-merge')) return fixed('held')

    const stop = stopFor(await compareHead(head), pull.armed)
    if (stop !== null) return stop

    const runs = await readCheckRuns({...client, ref: head})
    const statuses = await readCommitStatuses({...client, ref: head})
    if (runs.capped || statuses.capped) return row('error', reasons.capped)
    const verdict = evaluateChecks(required, runs.runs, statuses.statuses)
    if (verdict.failed.length > 0) return row('checks-failed', `failed: ${list(verdict.failed)}`)
    if (verdict.pending.length > 0) return row('checks-pending', `waiting on: ${list(verdict.pending)}`)

    const reviews = await readReviews(pull.number)
    if (reviews.capped) return row('error', reasons.capped)
    if (reviews.items.some(review => isApproval(review, head))) return fixed('already-approved')

    if (slotUsed) return fixed('deferred')

    // The fresh read: the PR, the commits and files of the pinned head against the current `main`, the required
    // list again, and in a live sweep the variable. It can only stop the approval.
    const fresh = viewOf(
      (await read(async signal => octokit.rest.pulls.get({owner, repo, pull_number: pull.number, request: {signal}})))
        .data,
    )
    if (!isCandidate(fresh) || fresh.labels.includes('hold-merge')) return fixed('no-longer-qualifies', fresh.armed)
    if (fresh.headSha !== head) return fixed('head-moved', fresh.armed)
    const stopped = stopFor(await compareHead(head), fresh.armed)
    if (stopped !== null) return stopped
    const again = await requiredList()
    if (again.kind !== 'ok') return row('error', reasons.list, fresh.armed)
    if (!sameChecks(required, again.checks)) return fixed('protection-changed', fresh.armed)

    if (!live) {
      slotUsed = true
      return fixed('would-approve', fresh.armed)
    }
    const mode = await readSwitch()
    if (mode === 'unreadable') return row('error', reasons.switch, fresh.armed)
    if (mode !== 'on') return fixed('switch-off', fresh.armed)

    slotUsed = true
    const sent = fresh.armed ? 'approved' : 'approved-not-armed'
    try {
      await timed(async signal =>
        octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: pull.number,
          commit_id: head,
          event: 'APPROVE',
          body: `Approved by Renovate Approve: this PR carries automerge and every required check passed on ${head}.`,
          request: {signal},
        }),
      )
    } catch (error: unknown) {
      if (error instanceof DeadlineError && !(error instanceof CutOffError)) throw error
      // A failed or cut-off request does not say whether it was recorded: one read of the reviews does.
      const history = await reconcile(pull.number)
      if (history === null || !history.some(review => isApproval(review, head))) {
        return fixed('approval-unknown', fresh.armed)
      }
    }
    return fixed(sent, fresh.armed)
  }

  const rows: Row[] = []
  let spent = false
  for (const pull of candidates) {
    const failed = (reason: string): Row => ({
      number: pull.number,
      head: shortHead(pull.headSha),
      outcome: 'error',
      detail: reason,
      armed: pull.armed,
    })
    if (spent) {
      rows.push(failed(reasons.budget))
      continue
    }
    try {
      rows.push(await judge(pull))
    } catch (error: unknown) {
      spent = error instanceof DeadlineError
      rows.push(failed(spent ? reasons.budget : reasons.read))
    }
  }
  const bad = rows.some(row => row.outcome === 'error' || row.outcome === 'approval-unknown')
  return {exitCode: bad ? 1 : 0, live, stop: null, rows}
}

/** The job summary: the mode, then one table row per candidate. */
export function summaryOf(result: SweepResult): string {
  const mode = result.live ? 'live' : 'dry run'
  const title = `### Renovate approve (${mode})`
  if (result.stop !== null) return [title, '', stopText(result.stop), ''].join('\n')
  if (result.rows.length === 0) return [title, '', 'No open Renovate PR carries `automerge`.', ''].join('\n')
  const lines = result.rows.map(
    row => `| #${String(row.number)} | ${row.head} | ${row.outcome} | ${row.detail} | ${row.armed ? 'yes' : 'no'} |`,
  )
  return [
    title,
    '',
    '| PR | Head | Outcome | Detail | Auto-merge armed |',
    '| --- | --- | --- | --- | --- |',
    ...lines,
    '',
  ].join('\n')
}

function stopText(stop: StopCode): string {
  const texts: Readonly<Record<StopCode, string>> = {
    NO_DECLARED_CONTEXTS:
      'No required contexts are declared for `main` in `.github/settings.yml`, so the live list cannot be compared. Nothing was approved.',
    REQUIRED_UNREADABLE:
      'The branch protection of `main` could not be read, so the required checks are unknown. Nothing was approved.',
    REQUIRED_EMPTY: 'The live required-check list for `main` is empty, so no PR was judged. Nothing was approved.',
    REQUIRED_SHORT:
      'The live required-check list for `main` is missing declared contexts, so no PR was judged. Nothing was approved.',
    CANDIDATES_UNREADABLE:
      'The open pull requests could not be listed to the end, so no PR was judged. Nothing was approved.',
    TIMEOUT: 'The sweep ran out of time before it could judge the pull requests. Nothing further was done.',
    API_FAILED: 'A GitHub API call failed, so the sweep stopped. Nothing further was done.',
  }
  return texts[stop]
}

export interface RunApproveParams {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The text of `.github/settings.yml`. */
  readonly readSettings: () => string
  readonly createClient: (token: string) => Promise<ApproveOctokit>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly signal: (ms: number) => AbortSignal
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Defaults to `appendFileSync`; a test passes a recorder. */
  readonly append?: (path: string, content: string) => void
}

/**
 * The CLI body. Reads the token from `GH_TOKEN`, the repository from `GITHUB_REPOSITORY` and the mode from
 * `RENOVATE_APPROVE`, runs `sweep`, writes the report as a job summary and returns the exit code. A line per
 * candidate goes to stdout; a failure is a fixed `::error::` line on stderr.
 */
export async function runApprove(params: RunApproveParams): Promise<number> {
  const {env} = params
  const summarize = (text: string): void => {
    appendStepSummary(text, {onMissing: 'skip', env, append: params.append})
  }
  const live = env.RENOVATE_APPROVE === 'on'
  const fail = (code: string, summary: string): number => {
    summarize(`### Renovate approve (${live ? 'live' : 'dry run'})\n\n${summary}\n`)
    params.stderr(`::error::renovate-approve: ${code}\n`)
    return 1
  }

  const token = env.GH_TOKEN ?? ''
  if (token === '') {
    return fail(
      'MISSING_TOKEN',
      "The step has no `FRO_BOT_PAT`, so it cannot read the pull requests or approve. Check the repository secret and the step's env.",
    )
  }
  const slug = /^([\w.-]+)\/([\w.-]+)$/u.exec(String(env.GITHUB_REPOSITORY))
  if (slug === null) {
    return fail(
      'INVALID_REPOSITORY',
      '`GITHUB_REPOSITORY` is not `owner/name`, so the sweep stopped before it read anything.',
    )
  }
  const owner = String(slug[1])
  const repo = String(slug[2])

  let declaredContexts: readonly string[]
  try {
    declaredContexts = parseDeclaredContexts(params.readSettings())
  } catch {
    return fail(
      'SETTINGS_UNREADABLE',
      '`.github/settings.yml` could not be read or parsed, so the declared checks are unknown. Check the file on `main`.',
    )
  }

  let octokit: ApproveOctokit
  try {
    octokit = await params.createClient(token)
  } catch {
    return fail(
      'API_FAILED',
      'The GitHub client could not be created, so the sweep stopped before it read anything. Check the token.',
    )
  }

  const result = await sweep({
    octokit,
    owner,
    repo,
    modeAtStart: env.RENOVATE_APPROVE,
    declaredContexts,
    now: params.now,
    sleep: params.sleep,
    signal: params.signal,
  })
  summarize(summaryOf(result))
  for (const row of result.rows) params.stdout(`renovate-approve: #${String(row.number)} ${row.outcome}\n`)
  if (result.stop !== null) {
    params.stderr(`::error::renovate-approve: ${result.stop}\n`)
    return 1
  }
  if (result.exitCode !== 0) {
    params.stderr('::error::renovate-approve: CANDIDATE_ERROR\n')
    return 1
  }
  return 0
}
