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
 * - Errors reach stderr as fixed codes, never an upstream message or token.
 */

import type {Octokit} from '@octokit/rest'

import {appendStepSummary} from '@fro-bot/core/output'
import {parse} from 'yaml'

/** The slice of Octokit this module calls. */
export interface ProtectionDriftOctokit {
  readonly rest: {
    readonly issues: Pick<Octokit['rest']['issues'], 'listForRepo' | 'create' | 'createComment' | 'update'>
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
    `- When: ${facts.at}`,
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
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Defaults to `appendFileSync`; a test passes a recorder. */
  readonly append?: (path: string, content: string) => void
}

/** The numbers of the open issues that carry the `protection-drift` label, pull requests excluded. */
async function openIssueNumbers(octokit: ProtectionDriftOctokit): Promise<readonly number[]> {
  const pageSize = 100
  const maxPages = 50
  let found = Array.of<number>()
  for (const page of Array.from({length: maxPages}, (_, index) => index + 1)) {
    const response = await octokit.rest.issues.listForRepo({
      owner: 'fro-bot',
      repo: '.github',
      state: 'open',
      labels: 'protection-drift',
      per_page: pageSize,
      page,
    })
    found = found.concat(response.data.filter(issue => issue.pull_request === undefined).map(issue => issue.number))
    if (response.data.length < pageSize) break
  }
  return found
}

/**
 * The CLI body. Reads the event from `GITHUB_EVENT_PATH`, the declared settings from `common-settings.yaml`
 * and `.github/settings.yml`, and the token from `GITHUB_TOKEN`; opens, comments on or closes the
 * `protection-drift` issue; writes a job summary; returns the exit code.
 */
export async function runProtectionDrift(params: RunProtectionDriftParams): Promise<number> {
  const {env} = params
  const fail = (code: string): number => {
    params.stderr(`::error::protection-drift: ${code}\n`)
    return 1
  }
  const summarize = (markdown: string): void => {
    appendStepSummary(markdown, {onMissing: 'skip', env, append: params.append})
  }

  let payload: unknown
  try {
    payload = JSON.parse(params.readFile(String(env.GITHUB_EVENT_PATH)))
  } catch {
    return fail('EVENT_UNREADABLE')
  }
  const fields = recordOf(payload) ?? {}

  let declared: DeclaredProtection
  try {
    declared = parseDeclaredProtection(params.readFile('common-settings.yaml'), params.readFile('.github/settings.yml'))
  } catch {
    return fail('SETTINGS_UNREADABLE')
  }

  const event: DriftEvent = {
    action: fields.action,
    rule: fields.rule,
    changes: fields.changes,
    sender: fields.sender,
  }
  const assessment = assessEvent(event, declared)
  if (assessment.kind === 'ignored') {
    params.stdout(`protection-drift: ignored (${assessment.reason})\n`)
    return 0
  }
  if (assessment.kind === 'malformed') return fail('MALFORMED_EVENT')

  const token = env.GITHUB_TOKEN ?? ''
  if (token === '') return fail('MISSING_TOKEN')

  try {
    const octokit = await params.createClient(token)
    const updatedAt: unknown = Reflect.get(new Object(event.rule), 'updated_at')
    const at = typeof updatedAt === 'string' ? updatedAt : params.now().toISOString()
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

    const open = await openIssueNumbers(octokit)
    // The oldest open issue; `Math.min` of nothing is Infinity, which is no issue.
    const oldest = Math.min(...open)
    const action = planAction(assessment, Number.isFinite(oldest))
    const target = {owner: 'fro-bot', repo: '.github'}

    if (action === 'open') {
      const created = await octokit.rest.issues.create({
        ...target,
        title: 'Protection drift: main branch protection',
        body: report,
        labels: ['protection-drift'],
      })
      summarize(`### Protection drift: issue opened\n\n${report}\n- Issue: ${created.data.html_url}\n`)
      params.stdout(`protection-drift: opened #${String(created.data.number)}\n`)
    } else if (action === 'comment') {
      await octokit.rest.issues.createComment({...target, issue_number: oldest, body: report})
      summarize(`### Protection drift: comment added\n\n${report}\n- Issue: #${String(oldest)}\n`)
      params.stdout(`protection-drift: commented on #${String(oldest)}\n`)
    } else if (action === 'close') {
      await octokit.rest.issues.createComment({
        ...target,
        issue_number: oldest,
        body: `The settings automation wrote the \`main\` rule at ${at} and every declared setting is present and matching. Closing.`,
      })
      await octokit.rest.issues.update({...target, issue_number: oldest, state: 'closed', state_reason: 'completed'})
      summarize(`### Protection drift: issue closed\n\n- Issue: #${String(oldest)}\n`)
      params.stdout(`protection-drift: closed #${String(oldest)}\n`)
    } else if (assessment.absent.length > 0) {
      summarize(
        `### Protection drift: fields not reported\n\nThese declared fields were not reported by the event, so they count neither as drift nor as a match, and the issue cannot close on this write: ${assessment.absent.map(field => `\`${field}\``).join(', ')}.\n`,
      )
      params.stdout('protection-drift: absent fields, issue left as it is\n')
    } else {
      params.stdout('protection-drift: no drift\n')
    }
  } catch {
    return fail('API_FAILED')
  }
  return 0
}
