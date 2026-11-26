/**
 * The goal duty of a domain program: which batches of the program's repositories still need a goal issue, its
 * checklist comment or its Project item. The preflight decides this and writes every word that is dispatched, so
 * the checklist line an operator approves is never composed by the agent that opens the goal. Every failure is a
 * fixed message that names nothing of the content or of the failure.
 *
 * Regexes and other values whose mutants matter are built inside the functions that use them.
 */

import type {ConfirmedRepo} from './program-trackers.ts'
import {execFileSync} from 'node:child_process'
import {FROBOT_COMMENT_AUTHORS, MAX_ITEMS_PER_GOAL, MAX_PROMPT_LENGTH} from '@fro-bot/dispatch/dispatch-model'

type Env = Readonly<Record<string, string | undefined>>

/** One batch of repos that gets one goal issue, from the preflight to the agent: every text is already written. */
export interface GoalBatch {
  /**
   * `initial`; `join-<node ID>` for a repo that became eligible after the first goal was created; or
   * `parity-<node ID>` for a repo whose Part 0 has merged. Part of the goal's key.
   */
  readonly batch: string
  /** The line the goal body ends with and a re-run finds the goal by: `program:<key> batch:<name>`. */
  readonly marker: string
  readonly title: string
  readonly body: string
  /** The whole checklist comment; empty when `error` is set. */
  readonly checklist: string
  /** The repos the batch covers, as `owner/name`, in config order. */
  readonly repos: string[]
  /** The number of the goal issue that already carries the key, in any state; null when there is none. */
  readonly goal_issue: number | null
  /** Whether a checklist comment by Fro Bot already names every repo of the batch on that goal. */
  readonly has_checklist: boolean
  /** Whether that goal is already an item of the program's Project. */
  readonly in_project: boolean
  /** A fixed message when the batch cannot be written, in which case nothing is written for it; otherwise null. */
  readonly error: string | null
  /** The merged Part 0 pull request of a parity batch; null for the first batch. */
  readonly part0_pr: string | null
}

/** What the preflight adds to a domain program's output for the goal duty. */
export interface GoalPlan {
  /** The batches that need work, the first batch ahead of the parity batches. Empty when nothing needs work. */
  goal_batches: GoalBatch[]
  /** A fixed message when the goals cannot be listed this run; no goal is written then. */
  goal_error: string | null
  /** The Part 0 repos whose Part 0 pull request could not be read this run, by name; they get no batch yet. */
  part0_unreadable: string[]
  /** The text that follows the bootstrap duty in the tracker prompt; empty when there is no goal duty. It starts with a blank line. */
  goal_instructions: string
}

/** One issue of the tracker repo that carries the `cross-repo-goal` label and was created by `fro-bot`. */
export interface GoalIssue {
  readonly number: number
  readonly state: string
  readonly pull_request: boolean
  readonly author: string
  readonly body: string
}

export interface GoalComment {
  readonly id: number
  readonly author: string
  readonly body: string
}

/** Everything the plan reads. Each reader throws on a failed or partial read, and the plan turns that into a fixed message. */
export interface GoalReaders {
  goalIssues: () => readonly GoalIssue[]
  goalComments: (number: number) => readonly GoalComment[]
  /** The URL of a merged pull request in the repo that references its part issue (a `cross-referenced` timeline event); null when there is none. */
  mergedPart0: (repo: string, partIssue: number) => string | null
}

export interface GoalPlanInput {
  readonly program: string
  readonly domain: string
  readonly tracker: {readonly repo: string; readonly number: number}
  readonly brief: {readonly commit: string; readonly url: string}
  /** The program's repos that are eligible and public now, in config order. */
  readonly eligible: readonly ConfirmedRepo[]
  /** The lower-cased names of the repos whose first ask is Part 0. */
  readonly part0Names: ReadonlySet<string>
  /** The oldest part issue on the Project of each repo that has one, by lower-cased name. */
  readonly partIssues: ReadonlyMap<string, number>
  readonly projectItems: readonly {readonly content_repo: string; readonly content_number: number}[]
}

const ITEMS_START = '<!-- fro-bot:cross-repo-items:start -->'
const ITEMS_END = '<!-- fro-bot:cross-repo-items:end -->'
const GOAL_ISSUES_UNREADABLE = 'goal issues cannot be read'
const GOAL_COMMENTS_UNREADABLE = 'goal comments cannot be read'
const PART0_UNREADABLE = 'part 0 references cannot be read'

/**
 * The line of a goal body that records the repos the goal was created for, ahead of the key. A batch's members are
 * fixed when its goal is created, so a repo that becomes eligible later gets a batch of its own and never a
 * replacement checklist on the existing goal.
 */
export function goalReposMarker(repos: readonly string[]): string {
  return `<!-- fro-bot-program-goal-repos ${repos.join(',')} -->`
}

/** The repos a goal body records, lower-cased; null when it records none or the line is not a clean list of names. */
function recordedRepos(body: string): ReadonlySet<string> | null {
  const open = '<!-- fro-bot-program-goal-repos '
  const line = body.split('\n').find(candidate => candidate.startsWith(open) && candidate.endsWith(' -->'))
  if (line === undefined) return null
  const names = line.slice(open.length, Math.max(open.length, line.length - ' -->'.length)).split(',')
  if (!names.every(name => /^[\w.-]+\/[\w.-]+$/.test(name))) return null
  return new Set(names.map(name => name.toLowerCase()))
}

/** The line a goal body ends with, which identifies the goal for a batch of a program. The key is a validated program key and a batch name. */
export function goalMarker(program: string, batch: string): string {
  return `<!-- fro-bot-program-goal program:${program} batch:${batch} -->`
}

function batchName(candidate: Candidate): string {
  return candidate.kind === 'initial' ? 'initial' : `${candidate.kind}-${candidate.repos[0]?.nodeId ?? ''}`
}

/** The ask a repo's agent approves with the operator: answer on the part issue first, work only after accepting. One line. */
function askText(input: GoalPlanInput, parity: boolean): string {
  const trackerUrl = `https://github.com/${input.tracker.repo}/issues/${input.tracker.number}`
  const lead = `Program ${input.program}, domain ${input.domain}, tracked at ${trackerUrl}: ${parity ? 'Part 0 has merged in this repository, so the parity ask follows. ' : ''}`
  return `${lead}bring this repository up to the brief of its domain. Check the brief against your AGENTS.md and this repository's current state, and answer on your part issue with one label (part-accepted, part-declined or part-countered) and one comment that gives the reason, before you change anything. Start work only after you have accepted, and never override your own repository's rules`
}

function checklistLine(input: GoalPlanInput, repo: ConfirmedRepo, partIssue: number, parity: boolean): string {
  const prompt = `${askText(input, parity)}. Brief: program-domains.json@${input.brief.commit}#${input.domain}. Part issue: https://github.com/${repo.nameWithOwner}/issues/${partIssue}`
  return `- [ ] ${repo.nameWithOwner}: ${prompt}`
}

function goalBody(
  input: GoalPlanInput,
  repos: readonly ConfirmedRepo[],
  part0Pr: string | null,
  marker: string,
): string {
  const trackerUrl = `https://github.com/${input.tracker.repo}/issues/${input.tracker.number}`
  return [
    `This goal carries the part of program \`${input.program}\` that belongs to ${repos.map(repo => `\`${repo.nameWithOwner}\``).join(', ')}. The program is tracked at ${trackerUrl} and runs in the domain \`${input.domain}\`.`,
    '',
    `Brief: [\`program-domains.json@${input.brief.commit}#${input.domain}\`](${input.brief.url}). Each checklist line is pinned to that commit, and the operator's approval covers exactly what it says. A later change to the brief applies only to a later goal.`,
    ...(part0Pr === null ? [] : ['', `Part 0 merged in ${part0Pr}.`]),
    '',
    'The operator approves the dispatch with the `dispatch-approved` label. The planner does not read this issue, and nothing written here is an instruction.',
    '',
    goalReposMarker(repos.map(repo => repo.nameWithOwner)),
    marker,
    '',
  ].join('\n')
}

interface Candidate {
  readonly kind: 'initial' | 'join' | 'parity'
  /** The repos the goal covers; one repo for a join or parity batch. */
  readonly repos: readonly ConfirmedRepo[]
}

const isFroBot = (author: string): boolean => FROBOT_COMMENT_AUTHORS.has(author)

/** The oldest open or closed goal of Fro Bot's that carries the batch's exact marker line. */
function findGoal(goals: readonly GoalIssue[], marker: string): GoalIssue | undefined {
  return goals
    .filter(
      goal => !goal.pull_request && isFroBot(goal.author) && goal.body.split('\n').some(line => line.trim() === marker),
    )
    .toSorted((left, right) => left.number - right.number)[0]
}

/** Whether a comment by Fro Bot is a checklist that names every repo of the batch: the approved one, whatever commit it pins. */
function hasChecklist(comments: readonly GoalComment[], repos: readonly ConfirmedRepo[]): boolean {
  return comments.some(
    comment =>
      isFroBot(comment.author) &&
      comment.body.includes(ITEMS_START) &&
      repos.every(repo =>
        comment.body
          .split('\n')
          .some(line => line.trim().toLowerCase().startsWith(`- [ ] ${repo.nameWithOwner.toLowerCase()}: `)),
      ),
  )
}

function instructions(input: GoalPlanInput, plan: Pick<GoalPlan, 'goal_batches' | 'goal_error'>): string {
  const intro = '\n\nGoals. '
  if (plan.goal_error !== null) {
    return `${intro}The goals of the program ${input.program} cannot be listed (${plan.goal_error}), so open no goal issue and write no checklist this run, and tell the operator in your tracker comment that the check failed, with that message.`
  }
  if (plan.goal_batches.length === 0) return ''
  return `${intro}The program ${input.program} dispatches through goals: one issue labeled cross-repo-goal for each batch of repos, opened as fro-bot and never as the operator, each with one checklist comment. The preflight has already decided which batches need work and wrote every text, so do not search for batches or write a checklist line yourself. These are the batches that need work (JSON array of batch, marker, title, body, checklist, repos, goal_issue, has_checklist, in_project, error and part0_pr):\n${JSON.stringify(plan.goal_batches)}\nFor each entry whose \`error\` is null, in order:\n1. If \`goal_issue\` is a number, that issue is the batch's goal: file no new one. Otherwise create one issue in ${input.tracker.repo} as fro-bot with the label cross-repo-goal (create the label first when the repository has none), with that entry's \`title\` and \`body\` exactly, character for character.\n2. If \`has_checklist\` is false, post that entry's \`checklist\` as one comment on the goal issue, exactly, character for character, with nothing added. If it is true, post nothing: an existing checklist keeps the brief commit it was approved with.\n3. If \`in_project\` is false, add the goal issue to the Project.\n4. Name the goal's URL and its repos in your tracker comment, and say that it waits for the operator's \`dispatch-approved\`.\nFor an entry whose \`error\` is a message, write nothing for it: say in your tracker comment that the batch is stopped, with that message.\nNever apply \`dispatch-approved\`, never edit or delete an existing checklist comment, never change the title or body of an existing goal, and never open a goal for a batch that is not in the list. If a write fails, stop and say so in your tracker comment: the next run lists the batch again.`
}

/**
 * Plan the goal duty. The first batch is every eligible repo without Part 0, listed once every eligible repo has its
 * part issue on the Project, and its members are fixed when its goal is created: a repo that is eligible later gets
 * a `join` batch of its own, and an existing goal never gets a replacement checklist. Each repo with Part 0 gets its
 * own `parity` batch once a pull request in that repo that references its part issue (a `cross-referenced` timeline
 * event) has merged. A batch whose keyed goal, checklist comment and Project item all
 * exist is not listed again, and any other is: the goal is reused and only what is missing is written. A goal that
 * is closed is done and is not listed. A failed read of the goals or their comments stops the whole duty with a fixed
 * message; a failed read of one repo's Part 0 only holds that repo back. Nothing is read when no batch could be
 * listed, and nothing is written here: the batches are for the tracker's agent.
 */
export function planGoals(input: GoalPlanInput, readers: GoalReaders): GoalPlan {
  const lower = (repo: ConfirmedRepo): string => repo.nameWithOwner.toLowerCase()
  const hasPartIssue = (repo: ConfirmedRepo): boolean => input.partIssues.has(lower(repo))
  const withPartIssue = input.eligible.filter(repo => hasPartIssue(repo))
  const everyPartIssueExists = input.eligible.length > 0 && withPartIssue.length === input.eligible.length
  const first = input.eligible.filter(repo => !input.part0Names.has(lower(repo)))
  const parityRepos = withPartIssue.filter(repo => input.part0Names.has(lower(repo)))
  const stopped = (goalError: string): GoalPlan => {
    const plan = {goal_batches: [], goal_error: goalError, part0_unreadable: []}
    return {...plan, goal_instructions: instructions(input, plan)}
  }
  // Nothing can be listed, and nothing is read, unless some repo that needs no Part 0 has its part issue (the first
  // batch, or a join after it) or some repo with Part 0 does (its parity batch).
  const nothing = {goal_batches: [], goal_error: null, part0_unreadable: [], goal_instructions: ''}
  if (!first.some(repo => hasPartIssue(repo)) && parityRepos.length === 0) return nothing

  let goals: readonly GoalIssue[]
  try {
    goals = readers.goalIssues()
  } catch {
    return stopped(GOAL_ISSUES_UNREADABLE)
  }

  // The first batch's members are fixed when its goal is created. Until then it is every eligible repo without
  // Part 0, once every part issue exists. A repo that is eligible later and not among the members joins on its own.
  const initialGoal = findGoal(goals, goalMarker(input.program, 'initial'))
  const recorded = initialGoal === undefined ? null : recordedRepos(initialGoal.body)
  const members =
    initialGoal === undefined
      ? everyPartIssueExists
        ? first
        : []
      : first.filter(repo => hasPartIssue(repo) && (recorded === null || recorded.has(lower(repo))))
  const joiners =
    initialGoal === undefined || recorded === null
      ? []
      : first.filter(repo => hasPartIssue(repo) && !recorded.has(lower(repo)))
  const candidates: Candidate[] = [
    ...(members.length > 0 ? [{kind: 'initial' as const, repos: members}] : []),
    ...joiners.map((repo): Candidate => ({kind: 'join', repos: [repo]})),
    ...parityRepos.map((repo): Candidate => ({kind: 'parity', repos: [repo]})),
  ]

  const batches: GoalBatch[] = []
  const unreadable: string[] = []
  for (const candidate of candidates) {
    const marker = goalMarker(input.program, batchName(candidate))
    const goal = candidate.kind === 'initial' ? initialGoal : findGoal(goals, marker)
    if (goal?.state === 'closed') continue
    let part0Pr: string | null = null
    const parityRepo = candidate.kind === 'parity' ? candidate.repos[0] : undefined
    if (parityRepo !== undefined && goal === undefined) {
      try {
        part0Pr = readers.mergedPart0(parityRepo.nameWithOwner, input.partIssues.get(lower(parityRepo)) ?? 0)
      } catch {
        unreadable.push(parityRepo.nameWithOwner)
        continue
      }
      if (part0Pr === null) continue
    }
    let checklist = false
    if (goal !== undefined) {
      try {
        checklist = hasChecklist(readers.goalComments(goal.number), candidate.repos)
      } catch {
        return stopped(GOAL_COMMENTS_UNREADABLE)
      }
    }
    const inProject =
      goal !== undefined &&
      input.projectItems.some(
        item =>
          item.content_repo.toLowerCase() === input.tracker.repo.toLowerCase() && item.content_number === goal.number,
      )
    if (goal !== undefined && checklist && inProject) continue
    batches.push(buildBatch(input, candidate, marker, {goal, checklist, inProject, part0Pr}))
  }

  const plan = {goal_batches: batches, goal_error: null, part0_unreadable: unreadable}
  return {...plan, goal_instructions: instructions(input, plan)}
}

function titleOf(input: GoalPlanInput, candidate: Candidate): string {
  const name = candidate.repos[0]?.nameWithOwner ?? ''
  if (candidate.kind === 'parity') return `Program ${input.program}: parity ask for ${name}`
  if (candidate.kind === 'join') return `Program ${input.program}: your part, joining after the first batch`
  return `Program ${input.program}: your part, first batch`
}

function buildBatch(
  input: GoalPlanInput,
  candidate: Candidate,
  marker: string,
  state: {goal: GoalIssue | undefined; checklist: boolean; inProject: boolean; part0Pr: string | null},
): GoalBatch {
  const parity = candidate.kind === 'parity'
  const lines = candidate.repos.map(repo =>
    checklistLine(input, repo, input.partIssues.get(repo.nameWithOwner.toLowerCase()) ?? 0, parity),
  )
  const tooLong = lines.some(line => line.slice(line.indexOf(': ') + 2).length > MAX_PROMPT_LENGTH)
  const error = tooLong
    ? 'the checklist line is over the dispatch prompt limit'
    : candidate.repos.length > MAX_ITEMS_PER_GOAL
      ? 'the batch has more repos than one goal may carry'
      : null
  return {
    batch: batchName(candidate),
    marker,
    title: titleOf(input, candidate),
    body: goalBody(input, candidate.repos, state.part0Pr, marker),
    checklist:
      error === null
        ? [
            `Checklist of program ${input.program}, one line for each repo of this batch.`,
            ITEMS_START,
            ...lines,
            ITEMS_END,
            '',
          ].join('\n')
        : '',
    repos: candidate.repos.map(repo => repo.nameWithOwner),
    goal_issue: state.goal?.number ?? null,
    has_checklist: state.checklist,
    in_project: state.inProject,
    error,
    part0_pr: state.part0Pr,
  }
}

// ─── Readers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseGoalIssue(value: unknown): GoalIssue {
  if (
    !isRecord(value) ||
    typeof value.number !== 'number' ||
    !Number.isSafeInteger(value.number) ||
    typeof value.state !== 'string' ||
    typeof value.pull_request !== 'boolean' ||
    typeof value.author !== 'string' ||
    typeof value.body !== 'string'
  ) {
    throw new TypeError(GOAL_ISSUES_UNREADABLE)
  }
  return {
    number: value.number,
    state: value.state,
    pull_request: value.pull_request,
    author: value.author,
    body: value.body,
  }
}

function parseGoalComment(value: unknown): GoalComment {
  const author =
    isRecord(value) && isRecord(value.author) ? value.author.login : isRecord(value) ? value.author : undefined
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof author !== 'string' ||
    typeof value.body !== 'string'
  ) {
    throw new TypeError(GOAL_COMMENTS_UNREADABLE)
  }
  return {id: value.id, author, body: value.body}
}

function ndjson(output: string): unknown[] {
  return output
    .split('\n')
    .filter(line => line.trim() !== '')
    .map((line): unknown => JSON.parse(line))
}

function gh(args: readonly string[]): string {
  return execFileSync('gh', [...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function readComments(repo: string, issue: number): GoalComment[] {
  return ndjson(
    gh([
      'api',
      '--paginate',
      `repos/${repo}/issues/${issue}/comments?per_page=100`,
      '--jq',
      '.[] | {id, author: (.user.login // ""), body: (.body // "")}',
    ]),
  ).map(record => parseGoalComment(record))
}

/** One `cross-referenced` event of a part issue's timeline: what referenced it, and whether that merged. */
interface PartReference {
  readonly number: number
  readonly repo: string
  readonly pull_request: boolean
  readonly merged: boolean
}

function parsePartReference(value: unknown): PartReference {
  if (
    !isRecord(value) ||
    typeof value.number !== 'number' ||
    !Number.isSafeInteger(value.number) ||
    typeof value.repo !== 'string' ||
    typeof value.pull_request !== 'boolean' ||
    typeof value.merged !== 'boolean'
  ) {
    throw new TypeError(PART0_UNREADABLE)
  }
  return {number: value.number, repo: value.repo, pull_request: value.pull_request, merged: value.merged}
}

/** The lowest merged pull request of `repo` among the references to its part issue, as a URL; null when there is none. */
function mergedPullIn(repo: string, references: readonly PartReference[]): string | null {
  const merged = references
    .filter(
      reference => reference.pull_request && reference.merged && reference.repo.toLowerCase() === repo.toLowerCase(),
    )
    .toSorted((left, right) => left.number - right.number)[0]
  return merged === undefined ? null : `https://github.com/${repo}/pull/${merged.number}`
}

/**
 * The readers a run uses: `gh` in production, and with the fixture variables, in tests, the values they carry. A
 * fixture that lacks what a read asks for fails that read like a failed call.
 *   ROLLOUT_TRACKER_GOAL_ISSUES_JSON    — [{number, state, pull_request, author, body}]: the goal issues
 *   ROLLOUT_TRACKER_GOAL_COMMENTS_JSON  — {"<number>": [{id, author, body}]}: the comments of each goal issue
 *   ROLLOUT_TRACKER_PART0_JSON          — {"owner/repo": {"references": [{number, repo, pull_request, merged}]}}:
 *                                         what references the repo's part issue on its timeline (cross-referenced events)
 */
export function goalReaders(trackerRepo: string, env: Env): GoalReaders {
  return {
    goalIssues: () => {
      if (env.ROLLOUT_TRACKER_GOAL_ISSUES_JSON !== undefined) {
        const parsed: unknown = JSON.parse(env.ROLLOUT_TRACKER_GOAL_ISSUES_JSON)
        if (!Array.isArray(parsed)) throw new TypeError(GOAL_ISSUES_UNREADABLE)
        return parsed.map(record => parseGoalIssue(record))
      }
      return ndjson(
        gh([
          'api',
          '--paginate',
          `repos/${trackerRepo}/issues?state=all&creator=fro-bot&labels=cross-repo-goal&per_page=100`,
          '--jq',
          '.[] | {number, state: .state, pull_request: (.pull_request != null), author: (.user.login // ""), body: (.body // "")}',
        ]),
      ).map(record => parseGoalIssue(record))
    },
    goalComments: number => {
      if (env.ROLLOUT_TRACKER_GOAL_COMMENTS_JSON !== undefined) {
        const parsed: unknown = JSON.parse(env.ROLLOUT_TRACKER_GOAL_COMMENTS_JSON)
        const listed = isRecord(parsed) ? parsed[String(number)] : undefined
        if (!Array.isArray(listed)) throw new TypeError(GOAL_COMMENTS_UNREADABLE)
        return listed.map(record => parseGoalComment(record))
      }
      return readComments(trackerRepo, number)
    },
    mergedPart0: (repo, partIssue) => {
      if (env.ROLLOUT_TRACKER_PART0_JSON !== undefined) {
        const parsed: unknown = JSON.parse(env.ROLLOUT_TRACKER_PART0_JSON)
        const listed = isRecord(parsed)
          ? Object.entries(parsed).find(([name]) => name.toLowerCase() === repo.toLowerCase())?.[1]
          : undefined
        if (!isRecord(listed) || !Array.isArray(listed.references)) throw new TypeError(PART0_UNREADABLE)
        return mergedPullIn(
          repo,
          listed.references.map(record => parsePartReference(record)),
        )
      }
      return mergedPullIn(
        repo,
        ndjson(
          gh([
            'api',
            '--paginate',
            `repos/${repo}/issues/${partIssue}/timeline?per_page=100`,
            '--jq',
            '.[] | select(.event == "cross-referenced") | {number: .source.issue.number, repo: (.source.issue.repository.full_name // ""), pull_request: (.source.issue.pull_request != null), merged: (.source.issue.pull_request.merged_at != null)}',
          ]),
        ).map(record => parsePartReference(record)),
      )
    },
  }
}
