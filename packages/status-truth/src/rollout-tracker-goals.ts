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
  /** `initial`, or `parity-<node ID>` for a repo whose Part 0 has merged. Part of the goal's key. */
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
  /** The URL of a merged Part 0 pull request linked on the repo's part issue by the operator or Fro Bot; null when there is none. */
  mergedPart0: (repo: string, partIssue: number) => string | null
}

export interface GoalPlanInput {
  readonly program: string
  readonly domain: string
  /** The program operator's login, whose link of a Part 0 pull request counts. */
  readonly operator: string
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

/** The line a goal body ends with, which identifies the goal for a batch of a program. The key is a validated program key and a batch name. */
export function goalMarker(program: string, batch: string): string {
  return `<!-- fro-bot-program-goal program:${program} batch:${batch} -->`
}

function batchName(repo: ConfirmedRepo | undefined): string {
  return repo === undefined ? 'initial' : `parity-${repo.nodeId}`
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
    marker,
    '',
  ].join('\n')
}

interface Candidate {
  /** Undefined for the first batch. */
  readonly parityRepo: ConfirmedRepo | undefined
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
 * part issue on the Project; each repo with Part 0 gets its own batch once a Part 0 pull request linked on its part
 * issue by the operator or Fro Bot has merged. A batch whose keyed goal, checklist comment and Project item all
 * exist is not listed again, and any other is: the goal is reused and only what is missing is written. A goal that
 * is closed is done and is not listed. A failed read of the goals or their comments stops the whole duty with a fixed
 * message; a failed read of one repo's Part 0 only holds that repo back. Nothing is read when no batch could be
 * listed, and nothing is written here: the batches are for the tracker's agent.
 */
export function planGoals(input: GoalPlanInput, readers: GoalReaders): GoalPlan {
  const lower = (repo: ConfirmedRepo): string => repo.nameWithOwner.toLowerCase()
  const withPartIssue = input.eligible.filter(repo => input.partIssues.has(lower(repo)))
  const everyPartIssueExists = input.eligible.length > 0 && withPartIssue.length === input.eligible.length
  const first = input.eligible.filter(repo => !input.part0Names.has(lower(repo)))
  const candidates: Candidate[] = [
    ...(everyPartIssueExists && first.length > 0 ? [{parityRepo: undefined, repos: first}] : []),
    ...withPartIssue
      .filter(repo => input.part0Names.has(lower(repo)))
      .map((repo): Candidate => ({parityRepo: repo, repos: [repo]})),
  ]
  const stopped = (goalError: string): GoalPlan => {
    const plan = {goal_batches: [], goal_error: goalError, part0_unreadable: []}
    return {...plan, goal_instructions: instructions(input, plan)}
  }
  if (candidates.length === 0) return {goal_batches: [], goal_error: null, part0_unreadable: [], goal_instructions: ''}

  let goals: readonly GoalIssue[]
  try {
    goals = readers.goalIssues()
  } catch {
    return stopped(GOAL_ISSUES_UNREADABLE)
  }

  const batches: GoalBatch[] = []
  const unreadable: string[] = []
  for (const candidate of candidates) {
    const marker = goalMarker(input.program, batchName(candidate.parityRepo))
    const goal = findGoal(goals, marker)
    if (goal?.state === 'closed') continue
    let part0Pr: string | null = null
    if (candidate.parityRepo !== undefined && goal === undefined) {
      try {
        part0Pr = readers.mergedPart0(
          candidate.parityRepo.nameWithOwner,
          input.partIssues.get(lower(candidate.parityRepo)) ?? 0,
        )
      } catch {
        unreadable.push(candidate.parityRepo.nameWithOwner)
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

function buildBatch(
  input: GoalPlanInput,
  candidate: Candidate,
  marker: string,
  state: {goal: GoalIssue | undefined; checklist: boolean; inProject: boolean; part0Pr: string | null},
): GoalBatch {
  const parity = candidate.parityRepo !== undefined
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
    batch: batchName(candidate.parityRepo),
    marker,
    title: parity
      ? `Program ${input.program}: parity ask for ${candidate.repos[0]?.nameWithOwner ?? ''}`
      : `Program ${input.program}: your part, first batch`,
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

/** The first merged pull request of `repo` among the URLs that the operator or Fro Bot linked in these comments, oldest first. */
function mergedPullIn(
  repo: string,
  comments: readonly GoalComment[],
  operator: string,
  isMerged: (number: number) => boolean,
): string | null {
  const linkers = new Set([...FROBOT_COMMENT_AUTHORS, operator.toLowerCase()])
  const numbers = new Set<number>()
  for (const comment of comments) {
    if (!linkers.has(comment.author.toLowerCase())) continue
    for (const match of comment.body.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?!\d)/g)) {
      if (match[1]?.toLowerCase() === repo.toLowerCase() && match[2] !== undefined) numbers.add(Number(match[2]))
    }
  }
  const merged = [...numbers].toSorted((left, right) => left - right).find(number => isMerged(number))
  return merged === undefined ? null : `https://github.com/${repo}/pull/${merged}`
}

/**
 * The readers a run uses: `gh` in production, and with the fixture variables, in tests, the values they carry. A
 * fixture that lacks what a read asks for fails that read like a failed call.
 *   ROLLOUT_TRACKER_GOAL_ISSUES_JSON    — [{number, state, pull_request, author, body}]: the goal issues
 *   ROLLOUT_TRACKER_GOAL_COMMENTS_JSON  — {"<number>": [{id, author, body}]}: the comments of each goal issue
 *   ROLLOUT_TRACKER_PART0_JSON          — {"owner/repo": {"comments": [{id, author, body}], "merged": {"<pr>": boolean}}}:
 *                                         the comments of the repo's part issue and whether each linked pull request merged
 */
export function goalReaders(trackerRepo: string, operator: string, env: Env): GoalReaders {
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
        if (!isRecord(listed) || !Array.isArray(listed.comments) || !isRecord(listed.merged)) {
          throw new TypeError(GOAL_COMMENTS_UNREADABLE)
        }
        const merged = listed.merged
        return mergedPullIn(
          repo,
          listed.comments.map(record => parseGoalComment(record)),
          operator,
          number => {
            const answer = merged[String(number)]
            if (typeof answer !== 'boolean') throw new TypeError(GOAL_COMMENTS_UNREADABLE)
            return answer
          },
        )
      }
      return mergedPullIn(repo, readComments(repo, partIssue), operator, number => {
        const answer = gh(['api', `repos/${repo}/pulls/${number}`, '--jq', '.merged']).trim()
        if (answer !== 'true' && answer !== 'false') throw new TypeError(GOAL_COMMENTS_UNREADABLE)
        return answer === 'true'
      })
    },
  }
}
