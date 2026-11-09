/**
 * Reports drift in the `main` branch protection rule. It runs on every `branch_protection_rule` event and
 * is stateless: it compares the rule the event carries with the declared settings and acts on the open
 * `protection-drift` issue.
 *
 * - The settings automation is the Fro Bot App bot, identified by actor type `Bot` and numeric id
 *   109017866, never by login. The `fro-bot` user is never the settings automation.
 * - An event is drift when the rule was deleted, when any declared field is present and different, or when
 *   the actor is not the settings automation. Drift opens one issue, or comments on the one that is open.
 * - The open issue closes only on an event from the settings automation in which every declared field is
 *   present and matching. A field the event does not report is neither drift nor a match: it is listed in
 *   the job summary, and it keeps the issue open.
 * - Nothing is reverted or blocked; the daily settings run restores the rule.
 * - Event order is kept in the issues themselves. Every report and comment ends with one hidden marker,
 *   the `updated_at` of its event, and nothing else. A match closes an issue only if its own `updated_at` is
 *   strictly newer than every recorded one (an empty or unusable one counts as newer than anything, and a
 *   match with no usable time never closes). After it closes, it reads the comments again and reopens if a
 *   newer report landed; a run that comments on an issue reads its state again and reopens it if it was
 *   closed in the meantime.
 * - Only the token's own markers count. The identity `github.token` writes as (`github-actions[bot]`, type
 *   `Bot`) is passed in by the CLI, and a marker in an issue body or comment by anyone else is ignored.
 * - Every request carries an abort signal of 30 seconds or what is left of a 6-minute budget, and a write
 *   does not start in the last 90 seconds, which are kept for the reads that check it. A request that is cut
 *   off, or that finds the budget spent, ends the run with exit 1 and a summary that says the state of the
 *   issues is uncertain; it is never retried.
 * - Runs are not serialized: a burst of events each get a run. Two runs that both open an issue are
 *   reconciled afterwards, the later issue closing as a duplicate of the oldest, and a match closes every
 *   open issue. Issue reads retry on a transient failure; writes are never retried blindly.
 * - Errors reach stderr as fixed codes, never an upstream message or token.
 */

import type {Octokit} from '@octokit/rest'

import {appendStepSummary} from '@fro-bot/core/output'
import {retry} from '@fro-bot/core/retry'
import {parse} from 'yaml'

/** The slice of Octokit this module calls. */
export interface ProtectionDriftOctokit {
  readonly rest: {
    readonly issues: Pick<
      Octokit['rest']['issues'],
      'listForRepo' | 'get' | 'listComments' | 'create' | 'createComment' | 'update'
    >
  }
}

export interface DeclaredProtection {
  readonly reviewCount: number
  readonly codeOwners: boolean
  readonly dismissStale: boolean
  readonly lastPush: boolean
  readonly strict: boolean
  readonly enforceAdmins: boolean
  readonly contexts: readonly string[]
}

export interface DriftEvent {
  readonly action: unknown
  readonly rule: unknown
  readonly changes: unknown
  readonly sender: unknown
}

export type Assessment =
  | {readonly kind: 'ignored'; readonly reason: 'other-rule' | 'other-action'}
  | {readonly kind: 'malformed'}
  | {
      readonly kind: 'evaluated'
      readonly deleted: boolean
      readonly settingsActor: boolean
      readonly mismatched: readonly string[]
      readonly absent: readonly string[]
    }

export type DriftAction = 'none' | 'open' | 'comment' | 'close'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

/** The `protection` block of the branch named `main` in a parsed settings document. */
function mainProtection(text: string): Record<string, unknown> | undefined {
  const document: unknown = parse(text)
  const branches = isRecord(document) ? document.branches : undefined
  if (!Array.isArray(branches)) return undefined
  const declared: readonly unknown[] = branches
  const main = declared.find(branch => isRecord(branch) && branch.name === 'main')
  return recordOf(isRecord(main) ? main.protection : undefined)
}

/**
 * The declared protection of `main`: the review fields and `enforce_admins` from common settings, the
 * contexts and `strict` from the repo file, each repo value overriding the common one field by field.
 * Throws when a field is missing or has the wrong type, so a half-read declaration never passes.
 */
export function parseDeclaredProtection(commonText: string, repoText: string): DeclaredProtection {
  const incomplete = (): never => {
    throw new TypeError('declared protection is incomplete')
  }
  const common = mainProtection(commonText) ?? incomplete()
  const repo = mainProtection(repoText)
  const reviews = {
    ...recordOf(common.required_pull_request_reviews),
    ...recordOf(repo?.required_pull_request_reviews),
  }
  const checks = {...recordOf(common.required_status_checks), ...recordOf(repo?.required_status_checks)}
  const enforceAdmins = repo?.enforce_admins ?? common.enforce_admins
  const contexts = Array.isArray(checks.contexts)
    ? (checks.contexts as readonly unknown[]).filter((context): context is string => typeof context === 'string')
    : []

  const {required_approving_review_count: reviewCount} = reviews
  const {require_code_owner_reviews: codeOwners} = reviews
  const {dismiss_stale_reviews: dismissStale} = reviews
  const {require_last_push_approval: lastPush} = reviews
  const {strict} = checks
  if (
    typeof reviewCount !== 'number' ||
    typeof codeOwners !== 'boolean' ||
    typeof dismissStale !== 'boolean' ||
    typeof lastPush !== 'boolean' ||
    typeof strict !== 'boolean' ||
    typeof enforceAdmins !== 'boolean' ||
    contexts.length === 0
  ) {
    return incomplete()
  }
  return {reviewCount, codeOwners, dismissStale, lastPush, strict, enforceAdmins, contexts}
}

/** Whether the sender is the settings automation: the Fro Bot App bot, by type and numeric id. */
function isSettingsActor(sender: unknown): boolean {
  return isRecord(sender) && sender.type === 'Bot' && sender.id === 109_017_866
}

/** `true` match, `false` differs, `undefined` the event did not report a usable value. */
function numberMatches(actual: unknown, expected: number): boolean | undefined {
  return Number.isInteger(actual) ? actual === expected : undefined
}

function booleanMatches(actual: unknown, expected: boolean): boolean | undefined {
  return typeof actual === 'boolean' ? actual === expected : undefined
}

/** An enforcement level of `off` means the requirement is not enforced; the other two levels enforce it. */
function levelEnforced(actual: unknown): boolean | undefined {
  if (actual === 'off') return false
  return actual === 'everyone' || actual === 'non_admins' ? true : undefined
}

function contextsMatch(actual: unknown, declared: readonly string[]): boolean | undefined {
  if (!Array.isArray(actual)) return undefined
  const reported: readonly unknown[] = actual
  if (!reported.every(context => typeof context === 'string')) return undefined
  return declared.every(context => reported.includes(context))
}

/**
 * Judges an event against the declared protection. Fields are checked in a fixed order, and each is
 * present and matching, present and different, or absent.
 */
export function assessEvent(event: DriftEvent, declared: DeclaredProtection): Assessment {
  const rule = event.rule
  if (!isRecord(rule)) return {kind: 'malformed'}
  if (rule.name !== 'main') return {kind: 'ignored', reason: 'other-rule'}
  if (event.action !== 'created' && event.action !== 'edited' && event.action !== 'deleted') {
    return {kind: 'ignored', reason: 'other-action'}
  }

  const settingsActor = isSettingsActor(event.sender)
  if (event.action === 'deleted') return {kind: 'evaluated', deleted: true, settingsActor, mismatched: [], absent: []}

  const judged: readonly (readonly [string, boolean | undefined])[] = [
    ['pull_request_reviews_enforcement_level', levelEnforced(rule.pull_request_reviews_enforcement_level)],
    ['required_approving_review_count', numberMatches(rule.required_approving_review_count, declared.reviewCount)],
    ['require_code_owner_review', booleanMatches(rule.require_code_owner_review, declared.codeOwners)],
    ['dismiss_stale_reviews_on_push', booleanMatches(rule.dismiss_stale_reviews_on_push, declared.dismissStale)],
    ['require_last_push_approval', booleanMatches(rule.require_last_push_approval, declared.lastPush)],
    ['required_status_checks_enforcement_level', levelEnforced(rule.required_status_checks_enforcement_level)],
    [
      'strict_required_status_checks_policy',
      booleanMatches(rule.strict_required_status_checks_policy, declared.strict),
    ],
    ['required_status_checks', contextsMatch(rule.required_status_checks, declared.contexts)],
    ['admin_enforced', booleanMatches(rule.admin_enforced, declared.enforceAdmins)],
  ]
  return {
    kind: 'evaluated',
    deleted: false,
    settingsActor,
    mismatched: judged.filter(([, verdict]) => verdict === false).map(([field]) => field),
    absent: judged.filter(([, verdict]) => verdict === undefined).map(([field]) => field),
  }
}

/** What to do about the open issue (`existing`) given the assessment. */
export function planAction(assessment: Assessment, existing: boolean): DriftAction {
  if (assessment.kind !== 'evaluated') return 'none'
  const drift = assessment.deleted || assessment.mismatched.length > 0 || !assessment.settingsActor
  if (drift) return existing ? 'comment' : 'open'
  return existing && assessment.absent.length === 0 ? 'close' : 'none'
}

export interface ReportFacts {
  readonly action: string
  readonly login: unknown
  readonly type: unknown
  readonly id: unknown
  readonly at: string
  readonly changes: unknown
  readonly mismatched: readonly string[]
  readonly absent: readonly string[]
  readonly deleted: boolean
  readonly settingsActor: boolean
}

/** Text that is safe inside an inline code span in an issue: no backticks, no line breaks, at most 80 characters. */
function inline(value: string): string {
  return value
    .replaceAll('`', '')
    .replaceAll(/[\r\n]+/gu, ' ')
    .slice(0, 80)
}

function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? inline(String(value)) : 'unknown'
}

function changeLines(changes: unknown): readonly string[] {
  if (!isRecord(changes)) return []
  return Object.entries(changes).map(([key, change]) => {
    const from = isRecord(change) ? change.from : undefined
    const shown =
      typeof from === 'string' || typeof from === 'number' || typeof from === 'boolean'
        ? inline(String(from))
        : undefined
    return `  - \`${inline(key)}\`${shown === undefined ? '' : ` (was \`${shown}\`)`}`
  })
}

function listLines(fields: readonly string[]): readonly string[] {
  return fields.map(field => `  - \`${field}\``)
}

/** The body of the issue and of each comment: who, when, what GitHub reported, and what differs. */
export function renderReport(facts: ReportFacts): string {
  const changes = changeLines(facts.changes)
  return [
    facts.settingsActor
      ? 'The branch protection rule for `main` no longer matches the declared settings after a write by the settings automation.'
      : 'The branch protection rule for `main` was edited outside the settings automation, or no longer matches the declared settings.',
    '',
    `- Actor: \`${scalar(facts.login)}\` (type \`${scalar(facts.type)}\`, id \`${scalar(facts.id)}\`)`,
    `- When: ${/^[\dTZ:.+-]+$/u.test(facts.at) ? facts.at : 'unknown'}`,
    `- Event: \`${inline(facts.action)}\`${facts.deleted ? ' (the rule no longer exists)' : ''}`,
    ...(changes.length === 0 ? ['- Reported changes: none reported'] : ['- Reported changes:', ...changes]),
    ...(facts.mismatched.length === 0
      ? ['- Fields that differ from the declared settings: none']
      : ['- Fields that differ from the declared settings:', ...listLines(facts.mismatched)]),
    ...(facts.absent.length === 0
      ? []
      : ['- Fields the event did not report (never counted as drift or as a match):', ...listLines(facts.absent)]),
    '',
    'Nothing was reverted. The daily [Update Repo Settings](https://github.com/fro-bot/.github/actions/workflows/update-repo-settings.yaml) run restores the declared settings, and this issue closes itself when a later write by the settings automation shows every declared setting present and matching.',
    '',
  ].join('\n')
}

export interface RunProtectionDriftParams {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly readFile: (path: string) => string
  readonly createClient: (token: string) => Promise<ProtectionDriftOctokit>
  readonly now: () => Date
  /** The wait between read retries; a test passes a recorder. */
  readonly sleep: (ms: number) => Promise<void>
  /** An abort signal that fires after `ms`; the real one is `AbortSignal.timeout`. */
  readonly signal: (ms: number) => AbortSignal
  /** The identity `github.token` writes as: only markers by this author count. */
  readonly author: MarkerAuthor
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Defaults to `appendFileSync`; a test passes a recorder. */
  readonly append?: (path: string, content: string) => void
}

/** Who wrote a body or comment: a login and a type, as GitHub reports them. */
export interface MarkerAuthor {
  readonly login: string
  readonly type: string
}

/** Thrown when a request was cut off in flight, or the budget had no time left to send it. */
class CutOffError extends Error {}

/**
 * The client with a deadline on every request. A request gets a signal of `requestMs` or what is left of the
 * budget, whichever is less. A write (a new issue, a comment, a close) does not start in the last `reserveMs`,
 * which stay for the reads and the reopen that check it. A request whose signal fired, or that has no budget
 * left, throws `CutOffError`, whatever error the client made of the abort.
 */
function bounded(
  octokit: ProtectionDriftOctokit,
  params: RunProtectionDriftParams,
  start: number,
): ProtectionDriftOctokit {
  const requestMs = 30_000
  const budgetMs = 6 * 60_000
  const reserveMs = 90_000
  const call = async <T>(write: boolean, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const left = start + budgetMs - params.now().getTime()
    if (left - (write ? reserveMs : 0) < 0) throw new CutOffError()
    const signal = params.signal(Math.min(requestMs, left))
    try {
      return await operation(signal)
    } catch (error: unknown) {
      throw signal.aborted ? new CutOffError() : error
    }
  }
  const {issues} = octokit.rest
  return {
    rest: {
      issues: {
        listForRepo: async (request: NonNullable<Parameters<typeof issues.listForRepo>[0]>) =>
          call(false, async signal => issues.listForRepo({...request, request: {signal}})),
        get: async (request: NonNullable<Parameters<typeof issues.get>[0]>) =>
          call(false, async signal => issues.get({...request, request: {signal}})),
        listComments: async (request: NonNullable<Parameters<typeof issues.listComments>[0]>) =>
          call(false, async signal => issues.listComments({...request, request: {signal}})),
        create: async (request: NonNullable<Parameters<typeof issues.create>[0]>) =>
          call(true, async signal => issues.create({...request, request: {signal}})),
        createComment: async (request: NonNullable<Parameters<typeof issues.createComment>[0]>) =>
          call(true, async signal => issues.createComment({...request, request: {signal}})),
        // Reopening is part of the check after a write, so it uses the time the writes leave.
        update: async (request: NonNullable<Parameters<typeof issues.update>[0]>) =>
          call(request.state !== 'open', async signal => issues.update({...request, request: {signal}})),
      },
    },
  } as unknown as ProtectionDriftOctokit
}

/** Whether a thrown GitHub error is worth another try: a 429, a 5xx, or a dropped connection. */
function isTransient(error: unknown): boolean {
  const status: unknown = Reflect.get(new Object(error), 'status')
  if (typeof status === 'number') return status === 429 || status >= 500
  const code: unknown = Reflect.get(new Object(error), 'code')
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND'
}

/** The numbers of the open issues that carry the `protection-drift` label, oldest first, pull requests excluded. */
async function openIssueNumbers(
  octokit: ProtectionDriftOctokit,
  sleep: (ms: number) => Promise<void>,
): Promise<readonly number[]> {
  const pageSize = 100
  const maxPages = 50
  let found = Array.of<number>()
  for (const page of Array.from({length: maxPages}, (_, index) => index + 1)) {
    const response = await retry(
      async () =>
        octokit.rest.issues.listForRepo({
          owner: 'fro-bot',
          repo: '.github',
          state: 'open',
          labels: 'protection-drift',
          per_page: pageSize,
          page,
        }),
      {attempts: 3, delayMs: attempt => attempt * 2000, shouldRetry: isTransient, sleep},
    )
    found = found.concat(response.data.filter(issue => issue.pull_request === undefined).map(issue => issue.number))
    if (response.data.length < pageSize) break
  }
  return found.toSorted((left, right) => left - right)
}

function numbersText(numbers: readonly number[]): string {
  return numbers.map(number => `#${String(number)}`).join(', ')
}

/** The hidden marker: the time of the event that wrote the report, and nothing else. A bad time is left out. */
function markerFor(updatedAt: unknown): string {
  const usable =
    typeof updatedAt === 'string' && /^[\dTZ:.+-]+$/u.test(updatedAt) && !Number.isNaN(Date.parse(updatedAt))
  return `<!-- protection-drift:updated_at=${usable ? updatedAt : ''} -->`
}

/** A body or comment and who wrote it, as GitHub reports it. */
interface Written {
  readonly body: string
  readonly user: {readonly login?: string; readonly type?: string} | null | undefined
}

/**
 * The newest time recorded in the markers of what `author` wrote, in milliseconds; minus infinity when there
 * is none (an issue opened before the marker existed). A marker with no usable time is newer than any time.
 * Anything written by anyone else is ignored.
 */
function newestRecorded(written: readonly Written[], author: MarkerAuthor): number {
  const times = written
    .filter(entry => entry.user?.login === author.login && entry.user.type === author.type)
    .flatMap(entry => [...entry.body.matchAll(/<!-- protection-drift:updated_at=(\S*) -->/gu)])
    .map(match => Date.parse(String(match[1])))
    .map(time => (Number.isNaN(time) ? Number.POSITIVE_INFINITY : time))
  return Math.max(Number.NEGATIVE_INFINITY, ...times)
}

/** Whether an event at `matchTime` is strictly newer than `recorded`; a time that is not one never is. */
function isNewerThan(matchTime: unknown, recorded: number): boolean {
  const time = typeof matchTime === 'string' ? Date.parse(matchTime) : Number.NaN
  return time > recorded
}

async function retryRead<T>(operation: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  return retry(operation, {attempts: 3, delayMs: attempt => attempt * 2000, shouldRetry: isTransient, sleep})
}

/** The state of an issue, and its body with who wrote it, read with retries. */
async function readIssue(
  octokit: ProtectionDriftOctokit,
  number: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{state: string; written: Written}> {
  const issue = await retryRead(
    async () => octokit.rest.issues.get({owner: 'fro-bot', repo: '.github', issue_number: number}),
    sleep,
  )
  return {state: issue.data.state, written: {body: String(issue.data.body), user: issue.data.user}}
}

async function readComments(
  octokit: ProtectionDriftOctokit,
  number: number,
  sleep: (ms: number) => Promise<void>,
): Promise<readonly Written[]> {
  const pageSize = 100
  const maxPages = 50
  let found = Array.of<Written>()
  for (const page of Array.from({length: maxPages}, (_, index) => index + 1)) {
    const response = await retryRead(
      async () =>
        octokit.rest.issues.listComments({
          owner: 'fro-bot',
          repo: '.github',
          issue_number: number,
          per_page: pageSize,
          page,
        }),
      sleep,
    )
    found = found.concat(response.data.map(comment => ({body: String(comment.body), user: comment.user})))
    if (response.data.length < pageSize) break
  }
  return found
}

/** The job summary and the stdout line for a run that tried to close issues. */
function reportClosing(
  result: {readonly closed: readonly number[]; readonly kept: readonly number[]; readonly reopened: readonly number[]},
  summarize: (title: string, detail: string) => void,
  stdout: (text: string) => void,
): void {
  const {closed, kept, reopened} = result
  const parts = [
    closed.length > 0 ? `closed ${numbersText(closed)}` : undefined,
    kept.length > 0 ? `left open ${numbersText(kept)}` : undefined,
    reopened.length > 0 ? `reopened ${numbersText(reopened)}` : undefined,
  ].filter(part => part !== undefined)
  stdout(`protection-drift: ${parts.join('; ')}\n`)

  if (kept.length === 0 && reopened.length === 0) {
    summarize('issues closed', `- Issues: ${numbersText(closed)}`)
    return
  }
  const lines = [
    closed.length > 0 ? `- Closed: ${numbersText(closed)}` : undefined,
    kept.length > 0 ? `- Left open: ${numbersText(kept)}` : undefined,
    reopened.length > 0 ? `- Reopened: ${numbersText(reopened)}` : undefined,
  ].filter(line => line !== undefined)
  const keptOnly = closed.length === 0 && reopened.length === 0
  const detail = keptOnly
    ? 'A drift report on these issues is as new as this event or newer, or this event has no usable time, so the match did not close them. The next write by the settings automation that is newer than the drift closes them.'
    : [
        kept.length > 0
          ? 'A drift report on the issues left open is as new as this event or newer, or this event has no usable time, so the match did not close them.'
          : undefined,
        reopened.length > 0
          ? 'A drift report newer than this event was recorded while the issues were closing, so they were reopened.'
          : undefined,
      ]
        .filter(sentence => sentence !== undefined)
        .join(' ')
  const title = keptOnly
    ? 'issues left open'
    : closed.length === 0 && kept.length === 0
      ? 'issues reopened'
      : 'issues partly closed'
  summarize(title, `${detail}\n\n${lines.join('\n')}`)
}

/**
 * The CLI body. Reads the event from `GITHUB_EVENT_PATH`, the declared settings from `common-settings.yaml`
 * and `.github/settings.yml`, and the token from `GITHUB_TOKEN`; opens, comments on or closes the
 * `protection-drift` issues; writes a job summary on every path; returns the exit code.
 */
export async function runProtectionDrift(params: RunProtectionDriftParams): Promise<number> {
  const {env} = params
  /** The job summary: a title, what happened and what to do, then the event facts. */
  const summarize = (title: string, detail: string, facts: readonly string[] = []): void => {
    const lines = [`### Protection drift: ${title}`, '', detail, '', ...facts]
    appendStepSummary(`${lines.join('\n')}${facts.length > 0 ? '\n' : ''}`, {
      onMissing: 'skip',
      env,
      append: params.append,
    })
  }
  const fail = (code: string, title: string, detail: string, facts: readonly string[] = []): number => {
    summarize(title, detail, facts)
    params.stderr(`::error::protection-drift: ${code}\n`)
    return 1
  }

  let payload: unknown
  try {
    payload = JSON.parse(params.readFile(String(env.GITHUB_EVENT_PATH)))
  } catch {
    return fail(
      'EVENT_UNREADABLE',
      'event unreadable',
      'The event payload could not be read or parsed, so nothing was checked. Re-run the workflow for this event.',
    )
  }
  const fields = recordOf(payload) ?? {}
  const eventFacts = typeof fields.action === 'string' ? [`- Event: \`${inline(fields.action)}\``] : []

  let declared: DeclaredProtection
  try {
    declared = parseDeclaredProtection(params.readFile('common-settings.yaml'), params.readFile('.github/settings.yml'))
  } catch {
    return fail(
      'SETTINGS_UNREADABLE',
      'settings unreadable',
      '`common-settings.yaml` or `.github/settings.yml` could not be read or is incomplete, so the declared values are unknown. No issue was changed. Check both files on the default branch and re-run the workflow for this event.',
    )
  }

  const event: DriftEvent = {
    action: fields.action,
    rule: fields.rule,
    changes: fields.changes,
    sender: fields.sender,
  }
  const assessment = assessEvent(event, declared)
  if (assessment.kind === 'ignored') {
    summarize(
      'ignored',
      assessment.reason === 'other-rule'
        ? 'The event is for a rule other than `main`. Nothing to do.'
        : 'The event action is not created, edited or deleted. Nothing to do.',
      eventFacts,
    )
    params.stdout(`protection-drift: ignored (${assessment.reason})\n`)
    return 0
  }
  if (assessment.kind === 'malformed') {
    return fail(
      'MALFORMED_EVENT',
      'malformed event',
      'The event has no rule object, so nothing was checked. Re-run the workflow for this event.',
      eventFacts,
    )
  }

  const token = env.GITHUB_TOKEN ?? ''
  if (token === '') {
    return fail(
      'MISSING_TOKEN',
      'no token',
      'The workflow token is empty, so no issue was read or changed. Check the job permissions and re-run the workflow for this event.',
      eventFacts,
    )
  }

  const updatedAt: unknown = Reflect.get(new Object(event.rule), 'updated_at')
  const at = typeof updatedAt === 'string' ? updatedAt : params.now().toISOString()
  const start = params.now().getTime()
  try {
    const octokit = bounded(await params.createClient(token), params, start)
    const report = renderReport({
      action: String(event.action),
      login: Reflect.get(new Object(event.sender), 'login'),
      type: Reflect.get(new Object(event.sender), 'type'),
      id: Reflect.get(new Object(event.sender), 'id'),
      at,
      changes: event.changes,
      mismatched: assessment.mismatched,
      absent: assessment.absent,
      deleted: assessment.deleted,
      settingsActor: assessment.settingsActor,
    })

    const open = await openIssueNumbers(octokit, params.sleep)
    const action = planAction(assessment, open.length > 0)
    const target = {owner: 'fro-bot', repo: '.github'}
    // The report as it is written to an issue: it ends with the time of this event, for the runs that follow.
    const written = `${report}${markerFor(updatedAt)}\n`
    const reopen = async (number: number): Promise<void> => {
      await octokit.rest.issues.update({...target, issue_number: number, state: 'open'})
    }
    /** Reads the issue back after a report was written to it; a close that happened in between is undone. */
    const reopenIfClosed = async (number: number): Promise<boolean> => {
      const closed = (await readIssue(octokit, number, params.sleep)).state === 'closed'
      if (closed) await reopen(number)
      return closed
    }

    if (action === 'open') {
      const created = await octokit.rest.issues.create({
        ...target,
        title: 'Protection drift: main branch protection',
        body: written,
        labels: ['protection-drift'],
      })
      // Runs are not serialized, so another run may have opened an issue at the same time: the oldest wins.
      const older = (await openIssueNumbers(octokit, params.sleep)).find(number => number < created.data.number)
      if (older === undefined) {
        summarize('issue opened', `${report}\n- Issue: ${created.data.html_url}`)
        params.stdout(`protection-drift: opened #${String(created.data.number)}\n`)
      } else {
        // The older issue takes the report. It is read back before the new one closes, so a match that closed
        // it in the meantime is undone and some issue stays open.
        await octokit.rest.issues.createComment({...target, issue_number: older, body: written})
        await reopenIfClosed(older)
        await octokit.rest.issues.createComment({
          ...target,
          issue_number: created.data.number,
          body: `Duplicate of #${String(older)}: another run opened that issue for the same drift first, and this event is reported there.`,
        })
        await octokit.rest.issues.update({
          ...target,
          issue_number: created.data.number,
          state: 'closed',
          state_reason: 'not_planned',
        })
        summarize(
          'issue opened, closed as a duplicate',
          `${report}\n- Issue: #${String(created.data.number)} was closed as a duplicate of #${String(older)}, which carries this report.`,
        )
        params.stdout(
          `protection-drift: opened #${String(created.data.number)}, closed as a duplicate of #${String(older)}\n`,
        )
      }
    } else if (action === 'comment') {
      // The oldest report carries the comments; the list is oldest first, so it is the first.
      const oldest = Math.min(...open)
      await octokit.rest.issues.createComment({...target, issue_number: oldest, body: written})
      const reopened = await reopenIfClosed(oldest)
      summarize(
        'comment added',
        `${report}\n- Issue: #${String(oldest)}${reopened ? `\n- Issue: #${String(oldest)} was closed while this report was posted, so it was reopened.` : ''}`,
      )
      params.stdout(`protection-drift: commented on #${String(oldest)}${reopened ? ', reopened' : ''}\n`)
    } else if (action === 'close') {
      // Each issue closes only if this event is newer than every report on it, and is checked again afterwards.
      const closed = Array.of<number>()
      const kept = Array.of<number>()
      const reopened = Array.of<number>()
      for (const number of open) {
        const before = [
          (await readIssue(octokit, number, params.sleep)).written,
          ...(await readComments(octokit, number, params.sleep)),
        ]
        if (!isNewerThan(updatedAt, newestRecorded(before, params.author))) {
          kept.push(number)
          continue
        }
        await octokit.rest.issues.createComment({
          ...target,
          issue_number: number,
          body: `The settings automation wrote the \`main\` rule at ${at} and every declared setting is present and matching. Closing.`,
        })
        await octokit.rest.issues.update({...target, issue_number: number, state: 'closed', state_reason: 'completed'})
        const after = await readComments(octokit, number, params.sleep)
        if (isNewerThan(updatedAt, newestRecorded(after, params.author))) {
          closed.push(number)
        } else {
          await reopen(number)
          reopened.push(number)
        }
      }
      reportClosing({closed, kept, reopened}, summarize, params.stdout)
    } else if (assessment.absent.length > 0) {
      summarize(
        'fields not reported',
        `These declared fields were not reported by the event, so they count neither as drift nor as a match, and the issue cannot close on this write: ${assessment.absent.map(field => `\`${field}\``).join(', ')}.`,
      )
      params.stdout('protection-drift: absent fields, issue left as it is\n')
    } else {
      summarize(
        'no drift',
        'The rule matches the declared settings and no `protection-drift` issue is open. Nothing to do.',
        [...eventFacts, `- When: ${at}`],
      )
      params.stdout('protection-drift: no drift\n')
    }
  } catch (error: unknown) {
    if (error instanceof CutOffError) {
      return fail(
        'REQUEST_TIMEOUT',
        'request cut off',
        'A GitHub request did not answer in time and was cut off, so the state of the issues is not certain: one may have been opened, commented on or closed before the cut-off. Check the open `protection-drift` issues and re-run the workflow for this event.',
        eventFacts,
      )
    }
    return fail(
      'API_FAILED',
      'GitHub API failure',
      'A GitHub API call failed, so the state of the issues is not certain: one may have been opened, commented on or closed before the failure. Check the open `protection-drift` issues and re-run the workflow for this event.',
      eventFacts,
    )
  }
  return 0
}
