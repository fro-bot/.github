/**
 * Decides, from the tree diff alone, whether a `data` → `main` promotion qualifies for self-merge and
 * whether a `Merge Data Branch` run should proceed.
 *
 * - A promotion qualifies when every path that really differs between the two branch tips sits under
 *   `knowledge/` or `metadata/`. Both sides of a rename or copy count. Labels never decide this.
 * - The three-dot diff names what `data` changed since the merge base. A path whose tree entry (mode
 *   and object) at the `data` tip already equals the one at the `main` tip is dropped first: `main`
 *   already has that content, for example from a squash merge.
 * - A diff that cannot be parsed does not qualify. Nothing here prints a path, because the decision
 *   runs before the privacy gates.
 * - The module only decides. Its git access is the `PromotionGit` seam; the real adapter lives in
 *   `promotion-qualify-cli.ts`.
 */

import {appendStepSummary, writeGithubOutputs} from '@fro-bot/core/output'

/** The two branch tips a promotion compares: `base` is `main`, `head` is `data`. */
export type PromotionSide = 'base' | 'head'

export interface PromotionGit {
  /** Raw `git diff --name-status -M -z base...head`. */
  readonly diffNameStatus: () => Promise<string>
  /** The tree entry (`<mode> <type> <id>`) of `path` at the tip of `side`, or `null` when the path is absent there. */
  readonly entryAt: (side: PromotionSide, path: string) => Promise<string | null>
}

export type Qualification =
  | {readonly state: 'empty'}
  | {readonly state: 'qualifies'}
  | {readonly state: 'disqualified'; readonly reason: 'path-outside-allowlist' | 'malformed-diff'}

export interface PromotionTrigger {
  readonly eventName: string
  /** `github.event.schedule`: the cron string that fired, unset or empty for any other event. */
  readonly schedule?: string | undefined
  /** `inputs.refresh-review` as the runner renders a boolean: `true` or `false`, unset or empty for any other event. */
  readonly refreshReview?: string | undefined
}

export type RunReason = 'no-changes' | 'held-for-review' | 'qualifies' | 'weekly'

export interface RunDecision {
  readonly run: boolean
  readonly reason: RunReason
}

export interface LabelDecision {
  readonly add: 'automerge' | 'needs-review'
  readonly remove: 'automerge' | 'needs-review'
}

/**
 * Every path named by a `git diff --name-status -M -z` listing, both sides of a rename or copy included,
 * or `null` when the listing is malformed: an unknown status, a missing path, an empty field or a record
 * that does not end in a NUL.
 */
export function parseNameStatus(raw: string): readonly string[] | null {
  const fields = raw.split('\0')
  // A well-formed listing ends in a NUL, so its last field is empty; an empty listing is that field alone.
  if (fields.pop() !== '') return null

  // A bounded pass over the fields: `owed` counts the paths the current record still has to carry.
  const paths: string[] = []
  let owed = 0
  for (const field of fields) {
    if (owed === 0) {
      owed = pathCount(field)
      if (owed === 0) return null
    } else {
      if (field === '') return null
      paths.push(field)
      owed -= 1
    }
  }
  return owed === 0 ? paths : null
}

/** The number of paths a status carries: one for A, M, D and T, two for a scored rename or copy, zero for anything else. */
function pathCount(status: string): number {
  if (['A', 'M', 'D', 'T'].includes(status)) return 1
  if (/^[RC]\d+$/u.test(status)) return 2
  return 0
}

function isAllowedPath(path: string): boolean {
  return path.startsWith('knowledge/') || path.startsWith('metadata/')
}

/**
 * Qualification of the live `base...head` diff: parse it, drop the paths `main` already has at the same
 * mode and object, and require every remaining path to be allowed.
 */
export async function qualifyPromotion(git: PromotionGit): Promise<Qualification> {
  const paths = parseNameStatus(await git.diffNameStatus())
  if (paths === null) return {state: 'disqualified', reason: 'malformed-diff'}

  const remaining: string[] = []
  for (const path of new Set(paths)) {
    const base = await git.entryAt('base', path)
    const head = await git.entryAt('head', path)
    if (base !== head) remaining.push(path)
  }

  if (remaining.length === 0) return {state: 'empty'}
  return remaining.every(isAllowedPath)
    ? {state: 'qualifies'}
    : {state: 'disqualified', reason: 'path-outside-allowlist'}
}

/**
 * The weekly run comes from the trigger, not the clock: the Sunday schedule entry, or a dispatch that
 * asks for a review refresh. A late Sunday run that starts on Monday is still the weekly run.
 */
export function isWeeklyRun(trigger: PromotionTrigger): boolean {
  if (trigger.eventName === 'schedule') return trigger.schedule === '0 22 * * 0'
  return trigger.eventName === 'workflow_dispatch' && trigger.refreshReview === 'true'
}

/**
 * Whether the promotion job runs. A qualifying promotion always runs. The weekly run always runs, which
 * keeps the merge-back and the update of a `needs-review` promotion on today's weekly cadence. Any other
 * run with nothing to promote is `no-changes`, and one with a non-qualifying promotion is held.
 */
export function decideRun(qualification: Qualification, weekly: boolean): RunDecision {
  if (qualification.state === 'qualifies') return {run: true, reason: 'qualifies'}
  if (weekly) return {run: true, reason: 'weekly'}
  return qualification.state === 'empty' ? {run: false, reason: 'no-changes'} : {run: false, reason: 'held-for-review'}
}

/** The one label to set and the one to remove, so a promotion carries exactly one of the two. */
export function labelDecision(qualifies: boolean): LabelDecision {
  return qualifies ? {add: 'automerge', remove: 'needs-review'} : {add: 'needs-review', remove: 'automerge'}
}

export interface RunPromotionQualifyParams {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly git: PromotionGit
  readonly stderr: (text: string) => void
  /** Defaults to `appendFileSync`; a test passes a recorder. */
  readonly append?: (path: string, content: string) => void
}

/**
 * The CLI body. Reads the trigger from `GITHUB_EVENT_NAME`, `PROMOTION_SCHEDULE` and
 * `PROMOTION_REFRESH_REVIEW`, writes `run`, `reason` and `qualifies` to `$GITHUB_OUTPUT`, and adds a
 * summary when the run does not proceed. Failures reach stderr as fixed codes, never as upstream text.
 */
export async function runPromotionQualify(params: RunPromotionQualifyParams): Promise<number> {
  const {env} = params
  const eventName = env.GITHUB_EVENT_NAME ?? ''
  if (eventName === '') {
    params.stderr('promotion-qualify: GITHUB_EVENT_NAME is required\n')
    return 1
  }

  let qualification: Qualification
  try {
    qualification = await qualifyPromotion(params.git)
  } catch {
    params.stderr('promotion-qualify: GIT_FAILED\n')
    return 1
  }

  const weekly = isWeeklyRun({
    eventName,
    schedule: env.PROMOTION_SCHEDULE,
    refreshReview: env.PROMOTION_REFRESH_REVIEW,
  })
  const decision = decideRun(qualification, weekly)

  try {
    writeGithubOutputs(
      {
        run: String(decision.run),
        reason: decision.reason,
        qualifies: String(qualification.state === 'qualifies'),
      },
      {onMissing: 'throw', env, append: params.append},
    )
    appendStepSummary(summaryFor(decision), {onMissing: 'skip', env, append: params.append})
  } catch {
    params.stderr('promotion-qualify: OUTPUT_FAILED\n')
    return 1
  }
  return 0
}

function summaryFor(decision: RunDecision): string {
  if (decision.reason === 'held-for-review') {
    return [
      '### Promotion held for review',
      '',
      'The `data` → `main` diff has a path outside `knowledge/` and `metadata/`, so the daily run leaves its head alone.',
      'The weekly run (Sunday 22:00 UTC) or a dispatch with `refresh-review` updates it. The unowned-changes alert also waits for the weekly run.',
      '',
    ].join('\n')
  }
  if (decision.reason === 'no-changes') {
    return [
      '### Promotion skipped',
      '',
      'There are no changes to promote: nothing differs between `data` and `main` once content `main` already has is ignored.',
      '',
    ].join('\n')
  }
  return ''
}
