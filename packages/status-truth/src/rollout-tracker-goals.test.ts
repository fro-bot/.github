import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {buildMarkerComment} from '@fro-bot/dispatch/dispatch-marker'
import {MAX_ITEMS_PER_GOAL, MAX_PROMPT_LENGTH} from '@fro-bot/dispatch/dispatch-model'
import {isPromptSafe, parseBriefReference} from '@fro-bot/dispatch/dispatch-plan'
import {extractItemPrompts, parseDecomposition} from '@fro-bot/dispatch/dispatch-receipts'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  goalBriefMarker,
  goalMarker,
  goalReaders,
  goalReposMarker,
  memoizeReaders,
  parityFollowsComment,
  parityFollowsMarker,
  planAnswers,
  planGoals,
  type GoalBatch,
  type GoalComment,
  type GoalIssue,
  type GoalPlanInput,
  type GoalReaders,
  type PartActivity,
} from './rollout-tracker-goals.ts'

const COMMIT = 'a'.repeat(40)
const systematic = {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic'}
const spaceBus = {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus'}
const dashboard = {nameWithOwner: 'fro-bot/dashboard', nodeId: 'R_dashboard'}

const input = (changes: Partial<GoalPlanInput> = {}): GoalPlanInput => ({
  program: 'harness',
  domain: 'harness-tools',
  tracker: {repo: 'fro-bot/.github', number: 5000},
  brief: {commit: COMMIT, url: `https://github.com/fro-bot/.github/blob/${COMMIT}/program-domains.json`},
  eligible: [systematic, spaceBus, dashboard],
  part0Names: new Set([systematic.nameWithOwner.toLowerCase(), spaceBus.nameWithOwner.toLowerCase()]),
  partIssues: new Map([
    [systematic.nameWithOwner.toLowerCase(), 11],
    [spaceBus.nameWithOwner.toLowerCase(), 12],
    [dashboard.nameWithOwner.toLowerCase(), 13],
  ]),
  projectItems: [],
  ...changes,
})

interface ReaderState {
  goals?: readonly GoalIssue[] | 'fail'
  comments?: Record<number, readonly GoalComment[] | 'fail'>
  /** The merged Part 0 pull request URL by repo; a repo not listed has none, and `'fail'` fails the read. */
  part0?: Record<string, string | 'fail'>
  /** The activity of each repo's part issue; a repo not listed has none (no comment, no label), and `'fail'` fails the read. */
  activity?: Record<string, PartActivity | 'fail'>
}

const NO_ACTIVITY: PartActivity = {createdAt: Date.parse('2026-10-01T00:00:00Z'), labels: [], labeled: [], comments: []}
/** A part issue whose parity-follows comment exists, written by this account. */
const anchoredActivity = (author = 'fro-bot', program = 'harness'): PartActivity => ({
  ...NO_ACTIVITY,
  comments: [
    {
      id: 900,
      author,
      at: Date.parse('2026-11-24T00:00:00Z'),
      body: parityFollowsComment(program, 'https://github.com/marcusrbrown/systematic/pull/7'),
    },
  ],
})

function readers(state: ReaderState = {}): GoalReaders & {reads: string[]} {
  const reads: string[] = []
  return {
    reads,
    goalIssues: () => {
      reads.push('goals')
      if (state.goals === 'fail') throw new Error('boom')
      return state.goals ?? []
    },
    goalComments: number => {
      reads.push(`comments ${number}`)
      const comments = state.comments?.[number]
      if (comments === 'fail' || comments === undefined) throw new Error('boom')
      return comments
    },
    mergedPart0: (repo, partIssue) => {
      reads.push(`part0 ${repo}#${partIssue}`)
      const merged = state.part0?.[repo]
      if (merged === 'fail') throw new Error('boom')
      return merged ?? null
    },
    partActivity: (repo, partIssue) => {
      reads.push(`activity ${repo}#${partIssue}`)
      const activity = state.activity?.[repo]
      if (activity === 'fail') throw new Error('boom')
      return activity ?? NO_ACTIVITY
    },
  }
}

/** The members a goal of this batch records by default: the first batch of `input()` is dashboard; a parity batch is its repo. */
const defaultMembers = (batch: string): {nameWithOwner: string}[] =>
  [systematic, spaceBus, dashboard].some(repo => batch === `parity-${repo.nodeId}`)
    ? [systematic, spaceBus, dashboard].filter(repo => batch === `parity-${repo.nodeId}`)
    : [dashboard]

/** A goal as the preflight's own body writes it: the members, the brief commit and the key. */
const goal = (batch: string, number: number, changes: Partial<GoalIssue> = {}): GoalIssue => ({
  number,
  state: 'open',
  pull_request: false,
  author: 'fro-bot',
  body: `A goal.\n\n${goalReposMarker(defaultMembers(batch).map(repo => repo.nameWithOwner))}\n${goalBriefMarker(COMMIT)}\n${goalMarker('harness', batch)}\n`,
  ...changes,
})

/** A goal created for exactly these repos. */
const goalFor = (
  batch: string,
  number: number,
  repos: readonly {nameWithOwner: string}[],
  changes: Partial<GoalIssue> = {},
) =>
  goal(batch, number, {
    body: `A goal.\n\n${goalReposMarker(repos.map(repo => repo.nameWithOwner))}\n${goalBriefMarker(COMMIT)}\n${goalMarker('harness', batch)}\n`,
    ...changes,
  })

const parityName = (repo: {nodeId: string}): string => `parity-${repo.nodeId}`
const checklistComment = (id: number, lines: readonly string[], author = 'fro-bot'): GoalComment => ({
  id,
  author,
  body: ['<!-- fro-bot:cross-repo-items:start -->', ...lines, '<!-- fro-bot:cross-repo-items:end -->'].join('\n'),
})
const lineFor = (repo: {nameWithOwner: string}): string => `- [ ] ${repo.nameWithOwner}: an ask`

function batchesOf(result: ReturnType<typeof planGoals>): GoalBatch[] {
  return result.goal_batches
}

describe('goalMarker', () => {
  it('names the program and the batch in the form the plan fixes', () => {
    expect(goalMarker('harness', 'initial')).toBe('<!-- fro-bot-program-goal program:harness batch:initial -->')
  })
})

describe('the first batch', () => {
  it('lists every eligible repo without Part 0, once every part issue exists', () => {
    const result = planGoals(input(), readers())

    expect(result.goal_error).toBeNull()
    const [first, ...rest] = batchesOf(result)
    expect(rest).toStrictEqual([])
    expect(first).toMatchObject({
      batch: 'initial',
      repos: [dashboard.nameWithOwner],
      marker: goalMarker('harness', 'initial'),
      goal_issue: null,
      has_checklist: false,
      in_project: false,
      error: null,
      part0_pr: null,
    })
  })

  it('is not listed while a part issue is missing, even one of a Part 0 repo', () => {
    const partIssues = new Map([
      [dashboard.nameWithOwner.toLowerCase(), 13],
      [systematic.nameWithOwner.toLowerCase(), 11],
    ])

    const result = planGoals(input({partIssues}), readers())

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('is not listed when every repo needs Part 0', () => {
    const result = planGoals(input({eligible: [systematic, spaceBus], projectItems: []}), readers())

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('reads nothing when nothing could be listed', () => {
    const reader = readers()

    planGoals(input({partIssues: new Map()}), reader)

    expect(reader.reads).toStrictEqual([])
  })

  it('lists every repo of a domain with no Part 0 in one batch, in config order', () => {
    const result = planGoals(input({part0Names: new Set()}), readers())

    expect(batchesOf(result).map(batch => batch.repos)).toStrictEqual([
      [systematic.nameWithOwner, spaceBus.nameWithOwner, dashboard.nameWithOwner],
    ])
  })

  it('writes the goal title and body with the tracker, the brief and the marker, and no ask', () => {
    const [batch] = batchesOf(planGoals(input(), readers()))

    expect(batch?.title).toBe('Program harness: your part, first batch')
    expect(batch?.body).toContain('https://github.com/fro-bot/.github/issues/5000')
    expect(batch?.body).toContain(`program-domains.json@${COMMIT}#harness-tools`)
    expect(batch?.body).toContain(`/blob/${COMMIT}/program-domains.json`)
    expect(batch?.body).toContain('dispatch-approved')
    expect(batch?.body.trimEnd().endsWith(goalMarker('harness', 'initial'))).toBe(true)
    expect(batch?.body).toContain('nothing written here is an instruction')
  })
})

describe('the checklist comment', () => {
  const lineOf = (batch: GoalBatch | undefined, repo: string): string =>
    (batch?.checklist.split('\n') ?? []).find(line => line.startsWith(`- [ ] ${repo}: `)) ?? ''

  it('is one region with one checklist line per repo, each naming the pinned brief and the part issue', () => {
    const [batch] = batchesOf(planGoals(input({part0Names: new Set()}), readers()))

    expect(batch?.checklist).toContain('<!-- fro-bot:cross-repo-items:start -->')
    expect(batch?.checklist).toContain('<!-- fro-bot:cross-repo-items:end -->')
    expect((batch?.checklist.match(/^- \[ \] /gm) ?? []).length).toBe(3)
    expect(lineOf(batch, dashboard.nameWithOwner)).toMatch(
      new RegExp(
        String.raw`^- \[ \] fro-bot/dashboard: .+\. Brief: program-domains\.json@${COMMIT}#harness-tools\. Part issue: https://github\.com/fro-bot/dashboard/issues/13$`,
      ),
    )
    expect(lineOf(batch, systematic.nameWithOwner)).toContain(
      'Part issue: https://github.com/marcusrbrown/systematic/issues/11',
    )
  })

  it('asks the repo to answer on its part issue before it works, under its own rules', () => {
    const [batch] = batchesOf(planGoals(input(), readers()))
    const line = lineOf(batch, dashboard.nameWithOwner)

    expect(line).toContain('Program harness')
    expect(line).toContain('domain harness-tools')
    expect(line).toContain('https://github.com/fro-bot/.github/issues/5000')
    expect(line).toContain('part-accepted, part-declined or part-countered')
    expect(line).toContain('before you change anything')
    expect(line).toContain('never override')
  })

  it('stays under the dispatch prompt limit and parses as a checklist line a prompt can carry', () => {
    const [batch] = batchesOf(planGoals(input(), readers()))
    const prompt = lineOf(batch, dashboard.nameWithOwner).replace(`- [ ] ${dashboard.nameWithOwner}: `, '')

    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt.length).toBeLessThan(MAX_PROMPT_LENGTH)
    expect(prompt).not.toContain('\n')
  })

  it('is a single line per repo: a part issue URL or repo name cannot add a line', () => {
    const [batch] = batchesOf(planGoals(input(), readers()))

    expect(batch?.checklist.split('\n').filter(line => line.startsWith('- ['))).toHaveLength(1)
  })
})

describe('the seam with dispatch: the checklist comment as dispatch reads it', () => {
  it('parses into one item per repo, each with a safe prompt that names the pinned brief', () => {
    const [batch] = batchesOf(planGoals(input({part0Names: new Set()}), readers()))
    const parsed = parseDecomposition(batch?.checklist ?? '')

    expect(parsed.ok).toBe(true)
    expect(parsed.items.map(item => `${item.target.owner}/${item.target.name}`)).toStrictEqual(batch?.repos)
    const prompts = [...extractItemPrompts(batch?.checklist ?? '').values()]
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(isPromptSafe(prompt)).toBe(true)
      expect(parseBriefReference(prompt)).toStrictEqual({commit: COMMIT, domain: 'harness-tools'})
    }
  })

  it('parses a parity batch the same way', () => {
    const batch = batchesOf(
      planGoals(
        input(),
        readers({
          part0: {[systematic.nameWithOwner]: 'https://github.com/marcusrbrown/systematic/pull/7'},
          activity: {[systematic.nameWithOwner]: anchoredActivity()},
        }),
      ),
    )[1]

    expect(parseDecomposition(batch?.checklist ?? '').items.map(item => item.target.name)).toStrictEqual(['systematic'])
  })
})

describe('goalReposMarker', () => {
  it('names the repos a goal was created for, in one comment line', () => {
    expect(goalReposMarker(['fro-bot/a', 'fro-bot/b'])).toBe('<!-- fro-bot-program-goal-repos fro-bot/a,fro-bot/b -->')
  })

  it('is part of every goal body the preflight writes, ahead of the brief commit and the key', () => {
    const [batch] = batchesOf(planGoals(input({part0Names: new Set()}), readers()))

    expect(batch?.body).toContain(
      `${goalReposMarker([systematic.nameWithOwner, spaceBus.nameWithOwner, dashboard.nameWithOwner])}\n${goalBriefMarker(COMMIT)}\n${goalMarker('harness', 'initial')}`,
    )
  })
})

describe('a repo that becomes eligible after the first batch', () => {
  const two = [systematic, spaceBus]
  const project = (...numbers: number[]) =>
    numbers.map(number => ({content_repo: 'fro-bot/.github', content_number: number}))
  const created = (changes: Partial<GoalIssue> = {}) => goalFor('initial', 50, two, changes)
  const complete = {
    comments: {
      50: [
        checklistComment(
          1,
          two.map(repo => lineFor(repo)),
        ),
      ],
    },
  }
  const noPart0 = {part0Names: new Set<string>()}

  it('gets its own join batch, the first batch is not listed again, and no checklist is posted on the first goal', () => {
    const result = planGoals(input({...noPart0, projectItems: project(50)}), readers({goals: [created()], ...complete}))

    expect(batchesOf(result).map(batch => [batch.batch, batch.repos, batch.goal_issue])).toStrictEqual([
      [`join-${dashboard.nodeId}`, [dashboard.nameWithOwner], null],
    ])
    expect(batchesOf(result)[0]).toMatchObject({
      marker: goalMarker('harness', `join-${dashboard.nodeId}`),
      title: 'Program harness: your part, joining after the first batch',
      error: null,
      part0_pr: null,
    })
    expect(batchesOf(result)[0]?.checklist).toContain(`- [ ] ${dashboard.nameWithOwner}: `)
    expect(batchesOf(result)[0]?.checklist).not.toContain(systematic.nameWithOwner)
    expect(batchesOf(result)[0]?.body).toContain(goalReposMarker([dashboard.nameWithOwner]))
  })

  it('writes the join ask like the first batch, not like a parity ask', () => {
    const [batch] = batchesOf(
      planGoals(input({...noPart0, projectItems: project(50)}), readers({goals: [created()], ...complete})),
    )

    expect(batch?.checklist).not.toContain('Part 0 has merged')
    expect(batch?.checklist).toContain('Part issue: https://github.com/fro-bot/dashboard/issues/13')
  })

  it('keeps the first batch at the repos its goal was created for, when the checklist is still missing', () => {
    const result = planGoals(input(noPart0), readers({goals: [created()], comments: {50: []}}))

    expect(
      batchesOf(result).map(batch => [batch.batch, batch.repos, batch.goal_issue, batch.has_checklist]),
    ).toStrictEqual([
      ['initial', two.map(repo => repo.nameWithOwner), 50, false],
      [`join-${dashboard.nodeId}`, [dashboard.nameWithOwner], null, false],
    ])
    expect(batchesOf(result)[0]?.checklist).not.toContain(dashboard.nameWithOwner)
  })

  it('lists a join batch for a closed first goal too', () => {
    const result = planGoals(input(noPart0), readers({goals: [created({state: 'closed'})], comments: {50: []}}))

    expect(batchesOf(result).map(batch => batch.batch)).toStrictEqual([`join-${dashboard.nodeId}`])
  })

  it('lists nothing more once the join goal, its checklist and its Project item exist', () => {
    const join = goalFor(`join-${dashboard.nodeId}`, 60, [dashboard])
    const result = planGoals(
      input({...noPart0, projectItems: project(50, 60)}),
      readers({
        goals: [created(), join],
        comments: {...complete.comments, 60: [checklistComment(2, [lineFor(dashboard)])]},
      }),
    )

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('reuses a join goal that is missing its checklist, and writes only that', () => {
    const join = goalFor(`join-${dashboard.nodeId}`, 60, [dashboard])
    const result = planGoals(
      input({...noPart0, projectItems: project(50, 60)}),
      readers({goals: [created(), join], comments: {...complete.comments, 60: []}}),
    )

    expect(
      batchesOf(result).map(batch => [batch.batch, batch.goal_issue, batch.has_checklist, batch.in_project]),
    ).toStrictEqual([[`join-${dashboard.nodeId}`, 60, false, true]])
  })

  it('does not join a repo that has no part issue yet', () => {
    const partIssues = new Map([
      [systematic.nameWithOwner.toLowerCase(), 11],
      [spaceBus.nameWithOwner.toLowerCase(), 12],
    ])

    const result = planGoals(
      input({...noPart0, partIssues, projectItems: project(50)}),
      readers({goals: [created()], ...complete}),
    )

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('never joins a repo with Part 0: its batch is the parity batch', () => {
    const result = planGoals(
      input({part0Names: new Set([dashboard.nameWithOwner.toLowerCase()]), projectItems: project(50)}),
      readers({goals: [created()], ...complete}),
    )

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('defers the checklist, with nothing posted, when a recorded member has left the eligible set since the goal was created', () => {
    const result = planGoals(
      input({...noPart0, eligible: [systematic, dashboard]}),
      readers({goals: [created()], comments: {50: []}}),
    )

    expect(batchesOf(result).map(batch => [batch.batch, batch.error, batch.checklist])).toStrictEqual([
      ['initial', 'a member of the goal is not ready, so its checklist waits', ''],
      [`join-${dashboard.nodeId}`, null, expect.stringContaining(dashboard.nameWithOwner)],
    ])
  })

  const unrecorded = 'the goal does not record its members and brief commit'
  const bare = (batch = 'initial') => `A goal.\n${goalMarker('harness', batch)}\n`

  it("defers a missing checklist for a goal that records nothing, and never guesses members from today's repos", () => {
    const result = planGoals(
      input(noPart0),
      readers({goals: [goal('initial', 50, {body: bare()})], comments: {50: []}}),
    )

    expect(batchesOf(result).map(batch => [batch.batch, batch.error, batch.checklist])).toStrictEqual([
      ['initial', unrecorded, ''],
    ])
  })

  it('does not defer a goal that records nothing once its checklist exists: only the Project item is missing', () => {
    const result = planGoals(
      input(noPart0),
      readers({
        goals: [goal('initial', 50, {body: bare()})],
        comments: {
          50: [
            checklistComment(
              1,
              [systematic, spaceBus, dashboard].map(repo => lineFor(repo)),
            ),
          ],
        },
      }),
    )

    expect(batchesOf(result)[0]).toMatchObject({goal_issue: 50, has_checklist: true, in_project: false, error: null})
  })

  it.each([
    ['a repo name that is not a name', `<!-- fro-bot-program-goal-repos not a name -->\n${goalBriefMarker(COMMIT)}`],
    ['an empty list', `<!-- fro-bot-program-goal-repos  -->\n${goalBriefMarker(COMMIT)}`],
    [
      'a list with an empty item',
      `<!-- fro-bot-program-goal-repos fro-bot/a,,fro-bot/b -->\n${goalBriefMarker(COMMIT)}`,
    ],
    ['no brief commit', goalReposMarker([dashboard.nameWithOwner])],
    [
      'a short brief commit',
      `${goalReposMarker([dashboard.nameWithOwner])}\n<!-- fro-bot-program-goal-brief abc123 -->`,
    ],
    [
      'an upper-case brief commit',
      `${goalReposMarker([dashboard.nameWithOwner])}\n<!-- fro-bot-program-goal-brief ${'A'.repeat(40)} -->`,
    ],
    [
      'two different brief commits',
      `${goalReposMarker([dashboard.nameWithOwner])}\n${goalBriefMarker(COMMIT)}\n${goalBriefMarker('b'.repeat(40))}`,
    ],
  ])('defers a missing checklist for a goal body with %s', (_name, lines) => {
    const body = `A goal.\n${lines}\n${goalMarker('harness', 'initial')}\n`

    const result = planGoals(input(noPart0), readers({goals: [goal('initial', 50, {body})], comments: {50: []}}))

    expect(batchesOf(result).map(batch => [batch.error, batch.checklist])).toStrictEqual([[unrecorded, '']])
  })

  it('takes the repos from a recorded line only when it is a line of its own', () => {
    const body = `A goal. <!-- fro-bot-program-goal-repos ${systematic.nameWithOwner} -->\n${goalMarker('harness', 'initial')}\n`

    const result = planGoals(input(noPart0), readers({goals: [goal('initial', 50, {body})], comments: {50: []}}))

    expect(batchesOf(result)[0]?.error).toBe('the goal does not record its members and brief commit')
  })
})

describe('goalBriefMarker', () => {
  it('names the brief commit a goal was created at, in one comment line', () => {
    expect(goalBriefMarker(COMMIT)).toBe(`<!-- fro-bot-program-goal-brief ${COMMIT} -->`)
  })

  it('is part of every goal body the preflight writes, between the members and the key', () => {
    const [batch] = batchesOf(planGoals(input(), readers()))

    expect(batch?.body).toContain(
      `${goalReposMarker([dashboard.nameWithOwner])}\n${goalBriefMarker(COMMIT)}\n${goalMarker('harness', 'initial')}`,
    )
  })
})

describe("resuming a goal from what was created, not from today's inputs", () => {
  const OLD = COMMIT
  const NEW = 'b'.repeat(40)
  const advanced = {brief: {commit: NEW, url: `https://github.com/fro-bot/.github/blob/${NEW}/program-domains.json`}}
  const two = [systematic, spaceBus]
  const noPart0 = {part0Names: new Set<string>()}
  const created = () => goalFor('initial', 50, two)
  const project = [{content_repo: 'fro-bot/.github', content_number: 50}]
  const noDashboard = new Map([
    [systematic.nameWithOwner.toLowerCase(), 11],
    [spaceBus.nameWithOwner.toLowerCase(), 12],
  ])
  const checklistOf = (result: ReturnType<typeof planGoals>) =>
    batchesOf(result).find(batch => batch.batch === 'initial')?.checklist ?? ''

  it('writes a missing checklist at the recorded commit, after main has moved on', () => {
    const result = planGoals(
      input({...noPart0, ...advanced, eligible: two, partIssues: noDashboard, projectItems: project}),
      readers({goals: [created()], comments: {50: []}}),
    )

    expect(checklistOf(result)).toContain(`program-domains.json@${OLD}#harness-tools`)
    expect(checklistOf(result)).not.toContain(NEW)
  })

  it('writes the checklist for every recorded member, however many are eligible now', () => {
    const result = planGoals(
      input({...noPart0, ...advanced, eligible: two, partIssues: noDashboard, projectItems: project}),
      readers({goals: [created()], comments: {50: []}}),
    )

    expect((checklistOf(result).match(/^- \[ \] /gm) ?? []).length).toBe(2)
    expect(batchesOf(result)[0]?.repos).toStrictEqual(two.map(repo => repo.nameWithOwner))
  })

  it('writes the goal body for an existing goal with the recorded commit too, so nothing advertises the new pin', () => {
    const result = planGoals(
      input({...noPart0, ...advanced, eligible: two, partIssues: noDashboard, projectItems: project}),
      readers({goals: [created()], comments: {50: []}}),
    )

    expect(batchesOf(result)[0]?.body).toContain(goalBriefMarker(OLD))
    expect(batchesOf(result)[0]?.body).not.toContain(NEW)
  })

  describe('a recorded member whose part issue is missing from the Project', () => {
    const without = new Map([
      [spaceBus.nameWithOwner.toLowerCase(), 12],
      [dashboard.nameWithOwner.toLowerCase(), 13],
    ])

    it('defers the repair with a fixed reason and writes no checklist: never a subset', () => {
      const result = planGoals(
        input({...noPart0, ...advanced, eligible: two, partIssues: without, projectItems: project}),
        readers({goals: [created()], comments: {50: []}}),
      )

      expect(
        batchesOf(result).map(batch => [batch.batch, batch.error, batch.checklist, batch.goal_issue]),
      ).toStrictEqual([['initial', 'a member of the goal is not ready, so its checklist waits', '', 50]])
      expect(result.goal_error).toBeNull()
    })

    it('posts exactly one complete checklist at the original commit once the part issue returns', () => {
      const posted: string[] = []
      const run = (partIssues: ReadonlyMap<string, number>, comments: GoalComment[]) => {
        const result = planGoals(
          input({...noPart0, ...advanced, eligible: two, partIssues, projectItems: project}),
          readers({goals: [created()], comments: {50: comments}}),
        )
        const batch = batchesOf(result).find(candidate => candidate.batch === 'initial')
        if (batch !== undefined && batch.error === null && !batch.has_checklist) {
          posted.push(batch.checklist)
          comments.push({id: comments.length + 1, author: 'fro-bot', body: batch.checklist})
        }
        return result
      }
      const comments: GoalComment[] = []

      run(without, comments)
      run(without, comments)
      run(noDashboard, comments)
      const afterwards = run(noDashboard, comments)

      expect(posted).toHaveLength(1)
      expect((posted[0]?.match(/^- \[ \] /gm) ?? []).length).toBe(2)
      expect(posted[0]).toContain(`program-domains.json@${OLD}#harness-tools`)
      expect(batchesOf(afterwards)).toStrictEqual([])
    })
  })

  it('does the same for a join goal: its one member and the recorded commit', () => {
    const join = goalFor(`join-${dashboard.nodeId}`, 60, [dashboard])

    const result = planGoals(
      input({
        ...noPart0,
        ...advanced,
        projectItems: [...project, {content_repo: 'fro-bot/.github', content_number: 60}],
      }),
      readers({
        goals: [created(), join],
        comments: {
          50: [
            checklistComment(
              1,
              two.map(repo => lineFor(repo)),
            ),
          ],
          60: [],
        },
      }),
    )

    const batch = batchesOf(result).find(candidate => candidate.batch === `join-${dashboard.nodeId}`)
    expect(batch?.checklist).toContain(`program-domains.json@${OLD}#harness-tools`)
    expect(batch?.error).toBeNull()
  })

  it('does the same for a parity goal, and waits, listing nothing, while its repo has no part issue', () => {
    const parity = goalFor(parityName(systematic), 70, [systematic])
    const items = [...project, {content_repo: 'fro-bot/.github', content_number: 70}]
    const comments = {
      50: [
        checklistComment(
          1,
          two.map(repo => lineFor(repo)),
        ),
      ],
      70: [],
    }

    const withAnchor = {[systematic.nameWithOwner]: anchoredActivity()}
    const ready = planGoals(
      input({...advanced, projectItems: items}),
      readers({goals: [created(), parity], comments, activity: withAnchor}),
    )
    const missing = planGoals(
      input({...advanced, projectItems: items, partIssues: new Map([[spaceBus.nameWithOwner.toLowerCase(), 12]])}),
      readers({goals: [created(), parity], comments, activity: withAnchor}),
    )

    const parityBatch = batchesOf(ready).find(batch => batch.batch === parityName(systematic))
    expect(parityBatch?.checklist).toContain(`program-domains.json@${OLD}#harness-tools`)
    expect(batchesOf(missing).map(batch => batch.batch)).not.toContain(parityName(systematic))
  })
})

describe('a parity batch', () => {
  const mergedPart0 = {[systematic.nameWithOwner]: 'https://github.com/marcusrbrown/systematic/pull/7'}
  const anchor = {[systematic.nameWithOwner]: anchoredActivity()}

  it('is listed for a Part 0 repo whose Part 0 pull request merged and whose parity-follows comment exists, as its own batch and goal', () => {
    const reader = readers({part0: mergedPart0, activity: anchor})

    const result = planGoals(input(), reader)

    expect(batchesOf(result).map(batch => [batch.batch, batch.repos])).toStrictEqual([
      ['initial', [dashboard.nameWithOwner]],
      [parityName(systematic), [systematic.nameWithOwner]],
    ])
    expect(batchesOf(result)[1]).toMatchObject({
      marker: goalMarker('harness', parityName(systematic)),
      part0_pr: 'https://github.com/marcusrbrown/systematic/pull/7',
      title: 'Program harness: parity ask for marcusrbrown/systematic',
    })
    expect(reader.reads).toContain('part0 marcusrbrown/systematic#11')
  })

  it('says in the ask that Part 0 has merged', () => {
    const batch = batchesOf(planGoals(input(), readers({part0: mergedPart0, activity: anchor}))).find(
      candidate => candidate.batch === parityName(systematic),
    )

    expect(batch?.checklist).toContain('Part 0 has merged in this repository')
    expect(batch?.body).toContain('https://github.com/marcusrbrown/systematic/pull/7')
  })

  it.each([
    ['no comment at all', NO_ACTIVITY],
    ['a comment by another account', anchoredActivity('marcusrbrown')],
    ['the marker of another program', anchoredActivity('fro-bot', 'other')],
  ])('is in no batch after Part 0 merged while the parity-follows comment is missing: %s', (_name, activity) => {
    const result = planGoals(input(), readers({part0: mergedPart0, activity: {[systematic.nameWithOwner]: activity}}))

    expect(batchesOf(result).map(batch => batch.batch)).toStrictEqual(['initial'])
    expect(result.part0_unreadable).toStrictEqual([])
  })

  it('takes the parity-follows comment of fro-bot[bot] too, the other identity the tracker may post as', () => {
    const result = planGoals(
      input(),
      readers({part0: mergedPart0, activity: {[systematic.nameWithOwner]: anchoredActivity('fro-bot[bot]')}}),
    )

    expect(batchesOf(result).map(batch => batch.batch)).toStrictEqual(['initial', parityName(systematic)])
  })

  it('holds a repo back, by name, when its part issue cannot be read', () => {
    const result = planGoals(input(), readers({part0: mergedPart0, activity: {[systematic.nameWithOwner]: 'fail'}}))

    expect(result.part0_unreadable).toStrictEqual([systematic.nameWithOwner])
    expect(batchesOf(result).map(batch => batch.batch)).toStrictEqual(['initial'])
  })

  it('names the marker as a fixed line', () => {
    expect(parityFollowsMarker('harness')).toBe('<!-- fro-bot-program-parity-follows program=harness -->')
  })

  it('is in no batch while Part 0 has not merged, whatever the first batch does', () => {
    const result = planGoals(input(), readers())

    expect(batchesOf(result).map(batch => batch.repos.join(','))).toStrictEqual([dashboard.nameWithOwner])
  })

  it('is not listed for a repo whose part issue does not exist', () => {
    const partIssues = new Map([
      [spaceBus.nameWithOwner.toLowerCase(), 12],
      [dashboard.nameWithOwner.toLowerCase(), 13],
    ])

    const result = planGoals(input({partIssues}), readers({part0: mergedPart0}))

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('leaves out a repo whose Part 0 read fails, and says so by name, without failing the others', () => {
    const result = planGoals(input(), readers({part0: {[systematic.nameWithOwner]: 'fail'}}))

    expect(result.goal_error).toBeNull()
    expect(result.part0_unreadable).toStrictEqual([systematic.nameWithOwner])
    expect(batchesOf(result).map(batch => batch.batch)).toStrictEqual(['initial'])
  })

  it('does not repair the missing checklist of an existing parity goal without the parity-follows comment', () => {
    const projectItems = [{content_repo: 'fro-bot/.github', content_number: 90}]
    const goals = [goal(parityName(systematic), 90)]

    const waiting = planGoals(input({projectItems}), readers({goals, comments: {90: []}}))
    const ready = planGoals(input({projectItems}), readers({goals, comments: {90: []}, activity: anchor}))

    const waitingBatch = batchesOf(waiting).find(batch => batch.batch === parityName(systematic))
    const readyBatch = batchesOf(ready).find(batch => batch.batch === parityName(systematic))
    expect(waitingBatch).toMatchObject({
      goal_issue: 90,
      checklist: '',
      error: 'the parity-follows comment is missing, so its checklist waits',
    })
    expect(readyBatch).toMatchObject({goal_issue: 90, error: null})
    expect(readyBatch?.checklist).toContain(systematic.nameWithOwner)
  })

  it('holds back an existing parity goal, by name, when its part issue cannot be read for the repair', () => {
    const result = planGoals(
      input(),
      readers({
        goals: [goal(parityName(systematic), 90)],
        comments: {90: []},
        activity: {[systematic.nameWithOwner]: 'fail'},
      }),
    )

    expect(result.part0_unreadable).toStrictEqual([systematic.nameWithOwner])
    expect(batchesOf(result).map(batch => batch.batch)).not.toContain(parityName(systematic))
  })

  it('does not ask about Part 0 again for a repo whose keyed goal already exists', () => {
    const reader = readers({
      part0: mergedPart0,
      goals: [goal(parityName(systematic), 90)],
      comments: {90: [checklistComment(1, [lineFor(systematic)])]},
    })

    planGoals(input({projectItems: [{content_repo: 'fro-bot/.github', content_number: 90}]}), reader)

    expect(reader.reads.filter(read => read.startsWith('part0'))).not.toContain('part0 marcusrbrown/systematic#11')
  })
})

describe('repair: what exists is reused, and only what is missing is listed', () => {
  const project = (...numbers: number[]) =>
    numbers.map(number => ({content_repo: 'fro-bot/.github', content_number: number}))

  it('lists nothing once the keyed goal, its checklist comment and its Project item all exist', () => {
    const result = planGoals(
      input({projectItems: project(50)}),
      readers({goals: [goal('initial', 50)], comments: {50: [checklistComment(1, [lineFor(dashboard)])]}}),
    )

    expect(batchesOf(result)).toStrictEqual([])
    expect(result.goal_error).toBeNull()
  })

  it('keeps the batch listed with the goal reused when the run stopped before the checklist', () => {
    const result = planGoals(
      input({projectItems: project(50)}),
      readers({goals: [goal('initial', 50)], comments: {50: []}}),
    )

    expect(batchesOf(result)[0]).toMatchObject({goal_issue: 50, has_checklist: false, in_project: true})
  })

  it('keeps the batch listed when only the Project item is missing', () => {
    const result = planGoals(
      input(),
      readers({goals: [goal('initial', 50)], comments: {50: [checklistComment(1, [lineFor(dashboard)])]}}),
    )

    expect(batchesOf(result)[0]).toMatchObject({goal_issue: 50, has_checklist: true, in_project: false})
  })

  it('keeps the batch listed when the goal is on the Project but has no checklist, and when it has neither', () => {
    const none = planGoals(input(), readers({goals: [goal('initial', 50)], comments: {50: []}}))

    expect(batchesOf(none)[0]).toMatchObject({goal_issue: 50, has_checklist: false, in_project: false})
  })

  it('keeps an approved goal at the brief commit it was approved with: an older commit in its checklist counts', () => {
    const older = `- [ ] ${dashboard.nameWithOwner}: an ask. Brief: program-domains.json@${'b'.repeat(40)}#harness-tools. Part issue: x`

    const result = planGoals(
      input({projectItems: project(50)}),
      readers({goals: [goal('initial', 50)], comments: {50: [checklistComment(1, [older])]}}),
    )

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('needs the checklist to name each of the batch repos', () => {
    const result = planGoals(
      input({part0Names: new Set(), projectItems: project(50)}),
      readers({
        goals: [goalFor('initial', 50, [systematic, spaceBus, dashboard])],
        comments: {50: [checklistComment(1, [lineFor(dashboard)])]},
      }),
    )

    expect(batchesOf(result)[0]).toMatchObject({goal_issue: 50, has_checklist: false})
  })

  it('counts a checklist only from a comment by fro-bot, with the region markers', () => {
    const fake = checklistComment(1, [lineFor(dashboard)], 'octocat')
    const bare: GoalComment = {id: 2, author: 'fro-bot', body: lineFor(dashboard)}

    const result = planGoals(
      input({projectItems: project(50)}),
      readers({goals: [goal('initial', 50)], comments: {50: [fake, bare]}}),
    )

    expect(batchesOf(result)[0]).toMatchObject({has_checklist: false})
  })

  it('counts a checklist by fro-bot[bot] too', () => {
    const result = planGoals(
      input({projectItems: project(50)}),
      readers({
        goals: [goal('initial', 50)],
        comments: {50: [checklistComment(1, [lineFor(dashboard)], 'fro-bot[bot]')]},
      }),
    )

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('takes the oldest goal that carries the key', () => {
    const result = planGoals(
      input(),
      readers({goals: [goal('initial', 70), goal('initial', 50)], comments: {50: [], 70: []}}),
    )

    expect(batchesOf(result)[0]?.goal_issue).toBe(50)
  })

  it.each([
    ['a pull request', {pull_request: true}],
    ['an issue by someone else', {author: 'octocat'}],
    ['an issue by an impostor', {author: 'fro-bot-impostor'}],
    ['an issue with no marker', {body: 'A goal.'}],
    ['an issue for another program', {body: `A goal.\n${goalMarker('other', 'initial')}`}],
    ['an issue for another batch', {body: `A goal.\n${goalMarker('harness', 'parity-x')}`}],
    [
      'an issue whose marker is a prefix of another batch',
      {body: `${goalMarker('harness', 'initial')}`.replace(' -->', 'x -->')},
    ],
  ])('does not reuse %s', (_name, changes) => {
    const result = planGoals(input(), readers({goals: [goal('initial', 50, changes)], comments: {50: []}}))

    expect(batchesOf(result)[0]?.goal_issue).toBeNull()
  })

  it('reuses a goal written as fro-bot[bot]', () => {
    const result = planGoals(
      input(),
      readers({goals: [goal('initial', 50, {author: 'fro-bot[bot]'})], comments: {50: []}}),
    )

    expect(batchesOf(result)[0]?.goal_issue).toBe(50)
  })

  it('does not list a goal the operator closed, with or without a checklist: closed means done', () => {
    const closed = planGoals(input(), readers({goals: [goal('initial', 50, {state: 'closed'})], comments: {50: []}}))

    expect(batchesOf(closed)).toStrictEqual([])
    expect(closed.goal_error).toBeNull()
  })

  it('matches the Project item by tracker repo and number, ignoring case', () => {
    const result = planGoals(
      input({projectItems: [{content_repo: 'Fro-Bot/.GitHub', content_number: 50}]}),
      readers({goals: [goal('initial', 50)], comments: {50: [checklistComment(1, [lineFor(dashboard)])]}}),
    )

    expect(batchesOf(result)).toStrictEqual([])
  })

  it('does not count a Project item with the goal number in another repo', () => {
    const result = planGoals(
      input({projectItems: [{content_repo: 'fro-bot/agent', content_number: 50}]}),
      readers({goals: [goal('initial', 50)], comments: {50: [checklistComment(1, [lineFor(dashboard)])]}}),
    )

    expect(batchesOf(result)[0]?.in_project).toBe(false)
  })
})

describe('a read that fails', () => {
  it('stops the goal duty with a fixed error and lists nothing, when the goal issues cannot be read', () => {
    const result = planGoals(input(), readers({goals: 'fail'}))

    expect(result.goal_error).toBe('goal issues cannot be read')
    expect(batchesOf(result)).toStrictEqual([])
    expect(result.goal_instructions).toContain('goal issues cannot be read')
    expect(result.goal_instructions).toContain('open no goal issue')
  })

  it('stops only that batch, with its reason and nothing to write, when the comments of a reused goal cannot be read', () => {
    const result = planGoals(input(), readers({goals: [goal('initial', 50)], comments: {50: 'fail'}}))

    expect(result.goal_error).toBeNull()
    expect(batchesOf(result).map(batch => [batch.batch, batch.error, batch.checklist])).toStrictEqual([
      ['initial', 'goal comments cannot be read', ''],
    ])
  })

  it('lists the other batches normally while one batch cannot be read', () => {
    const result = planGoals(
      input({projectItems: [{content_repo: 'fro-bot/.github', content_number: 70}]}),
      readers({
        goals: [goal('initial', 50), goalFor(parityName(systematic), 70, [systematic])],
        comments: {50: 'fail', 70: []},
        part0: {[systematic.nameWithOwner]: 'https://github.com/marcusrbrown/systematic/pull/7'},
        activity: {[systematic.nameWithOwner]: anchoredActivity()},
      }),
    )

    expect(batchesOf(result).map(batch => [batch.batch, batch.error])).toStrictEqual([
      ['initial', 'goal comments cannot be read'],
      [parityName(systematic), null],
    ])
  })

  it('names nothing of the failure', () => {
    const result = planGoals(input(), readers({goals: 'fail'}))

    expect(JSON.stringify(result)).not.toContain('boom')
  })
})

describe('a line that does not fit', () => {
  it('stops that batch with a fixed error and no text to write, and leaves the others', () => {
    const long = 'x'.repeat(MAX_PROMPT_LENGTH)
    const result = planGoals(
      input({program: long, part0Names: new Set([systematic.nameWithOwner.toLowerCase()])}),
      readers(),
    )

    expect(batchesOf(result)).not.toHaveLength(0)
    for (const batch of batchesOf(result)) {
      expect(batch.error).toBe('the checklist line is over the dispatch prompt limit')
      expect(batch.checklist).toBe('')
      expect(batch.title).not.toBe('')
    }
  })

  it('does not stop a batch whose line fits', () => {
    const result = planGoals(input(), readers())

    expect(batchesOf(result).every(batch => batch.error === null)).toBe(true)
  })

  it('stops a batch of more repos than a goal may carry', () => {
    const many = Array.from({length: MAX_ITEMS_PER_GOAL + 1}, (_, index) => ({
      nameWithOwner: `fro-bot/repo-${index}`,
      nodeId: `R_${index}`,
    }))

    const result = planGoals(
      input({
        eligible: many,
        part0Names: new Set(),
        partIssues: new Map(many.map((repo, index) => [repo.nameWithOwner, index + 1])),
      }),
      readers(),
    )

    expect(batchesOf(result)[0]?.error).toBe('the batch has more repos than one goal may carry')
    expect(batchesOf(result)[0]?.checklist).toBe('')
  })

  it('lets a batch of exactly the most a goal may carry through', () => {
    const many = Array.from({length: MAX_ITEMS_PER_GOAL}, (_, index) => ({
      nameWithOwner: `fro-bot/repo-${index}`,
      nodeId: `R_${index}`,
    }))

    const result = planGoals(
      input({
        eligible: many,
        part0Names: new Set(),
        partIssues: new Map(many.map((repo, index) => [repo.nameWithOwner.toLowerCase(), index + 1])),
      }),
      readers(),
    )

    expect(batchesOf(result)[0]?.error).toBeNull()
  })
})

describe('the instructions', () => {
  const text = (state: ReaderState = {}, changes: Partial<GoalPlanInput> = {}) =>
    planGoals(input(changes), readers(state)).goal_instructions

  it('are empty when no batch needs work and nothing failed', () => {
    expect(text({}, {partIssues: new Map()})).toBe('')
  })

  it('carry the batches as JSON and tell the agent to reuse, write only what is missing and never approve', () => {
    const result = planGoals(input(), readers())
    const instructions = result.goal_instructions

    expect(instructions.startsWith('\n\n')).toBe(true)
    expect(instructions).toContain(JSON.stringify(result.goal_batches))
    expect(instructions).toContain('cross-repo-goal')
    expect(instructions).toContain('as fro-bot')
    expect(instructions).toContain('If `goal_issue` is a number')
    expect(instructions).toContain('If `has_checklist` is false')
    expect(instructions).toContain('If `in_project` is false')
    expect(instructions).toContain('character for character')
    expect(instructions).toContain('Never apply `dispatch-approved`')
    expect(instructions).toContain('never edit or delete an existing checklist comment')
    expect(instructions).toContain('the next run lists the batch again')
  })

  it('carry an explicit exception to the public item set, for a goal created in this run and only after a live check', () => {
    const instructions = planGoals(input(), readers()).goal_instructions

    expect(instructions).toContain('Exception to the public item set')
    expect(instructions).toContain('a goal issue you created in this run')
    expect(instructions).toContain(
      'only after you have read live that its repository is public and that the issue is an item of the Project',
    )
    expect(instructions).toContain('name only that goal issue and its repos')
    expect(instructions).toContain('Every other item outside the public item set stays out')
  })

  it('tell the agent to write nothing for a stopped batch and to say why on the tracker', () => {
    const long = 'x'.repeat(MAX_PROMPT_LENGTH)
    const instructions = text({}, {program: long})

    expect(instructions).toContain('For an entry whose `error` is a message, write nothing for it')
  })
})

describe('goalReaders from fixtures', () => {
  const read = (env: Record<string, string | undefined>) => goalReaders('fro-bot/.github', env)

  it('reads the goal issues from the fixture', () => {
    const issues = [goal('initial', 5)]

    expect(read({ROLLOUT_TRACKER_GOAL_ISSUES_JSON: JSON.stringify(issues)}).goalIssues()).toStrictEqual(issues)
  })

  it.each([
    ['not JSON', 'nope'],
    ['not a list', '{}'],
    ['a list of something else', '[1]'],
    ['an issue with no author', JSON.stringify([{number: 1, state: 'open', pull_request: false, body: ''}])],
    [
      'an issue number that is not an integer',
      JSON.stringify([{number: 1.5, state: 'open', pull_request: false, author: 'a', body: ''}]),
    ],
  ])('fails the goal issue read for %s', (_name, text) => {
    expect(() => read({ROLLOUT_TRACKER_GOAL_ISSUES_JSON: text}).goalIssues()).toThrow()
  })

  it('reads the comments of a goal by number, taking the author as a name or a login object', () => {
    const env = {
      ROLLOUT_TRACKER_GOAL_COMMENTS_JSON: JSON.stringify({
        '5': [
          {id: 1, author: 'fro-bot', body: 'a'},
          {id: 2, author: {login: 'octocat'}, body: 'b'},
        ],
      }),
    }

    expect(read(env).goalComments(5)).toStrictEqual([
      {id: 1, author: 'fro-bot', body: 'a'},
      {id: 2, author: 'octocat', body: 'b'},
    ])
  })

  it.each([
    ['a goal the fixture lacks', {'6': []}],
    ['a list of something else', {'5': [{id: 'x'}]}],
    ['an answer that is not a list', {'5': {}}],
  ])('fails the comment read for %s', (_name, listed) => {
    expect(() => read({ROLLOUT_TRACKER_GOAL_COMMENTS_JSON: JSON.stringify(listed)}).goalComments(5)).toThrow()
  })

  /** A reference to the part issue from a pull request or issue, as the timeline's cross-referenced event reports it. */
  const reference = (number: number, changes: Record<string, unknown> = {}) => ({
    number,
    repo: 'fro-bot/space-bus',
    pull_request: true,
    merged: true,
    ...changes,
  })
  const part0 = (references: unknown) => ({
    ROLLOUT_TRACKER_PART0_JSON: JSON.stringify({'Fro-Bot/Space-Bus': {references}}),
  })

  it('finds a merged pull request of the repo that references the part issue, ignoring the case of the name', () => {
    expect(read(part0([reference(3)])).mergedPart0('fro-bot/space-bus', 12)).toBe(
      'https://github.com/fro-bot/space-bus/pull/3',
    )
  })

  it('takes the lowest merged pull request among several, and skips one that did not merge', () => {
    const env = part0([reference(9), reference(4), reference(3, {merged: false})])

    expect(read(env).mergedPart0('fro-bot/space-bus', 12)).toBe('https://github.com/fro-bot/space-bus/pull/4')
  })

  it.each([
    ['a merged pull request of another repository', [reference(3, {repo: 'fro-bot/agent'})]],
    ['a repository whose name only starts the same', [reference(3, {repo: 'fro-bot/space-bus-x'})]],
    ['a merged issue, which is not a pull request', [reference(3, {pull_request: false})]],
    ['a pull request that has not merged', [reference(3, {merged: false})]],
    ['no reference at all', []],
  ])('finds no Part 0 for %s', (_name, references) => {
    expect(read(part0(references)).mergedPart0('fro-bot/space-bus', 12)).toBeNull()
  })

  it('reads no comment: a pull request linked in a comment is not a reference', () => {
    const env = {
      ROLLOUT_TRACKER_PART0_JSON: JSON.stringify({
        'fro-bot/space-bus': {
          references: [],
          comments: [{id: 1, author: 'marcusrbrown', body: 'https://github.com/fro-bot/space-bus/pull/3'}],
        },
      }),
    }

    expect(read(env).mergedPart0('fro-bot/space-bus', 12)).toBeNull()
  })

  it.each([
    ['a repo the fixture lacks', {ROLLOUT_TRACKER_PART0_JSON: '{}'}],
    ['a fixture with no references', {ROLLOUT_TRACKER_PART0_JSON: JSON.stringify({'fro-bot/space-bus': {}})}],
    ['references that are not a list', part0({})],
    ['a reference with no number', part0([{repo: 'fro-bot/space-bus', pull_request: true, merged: true}])],
    ['a reference whose merged is not a boolean', part0([reference(3, {merged: 'yes'})])],
    ['not JSON', {ROLLOUT_TRACKER_PART0_JSON: 'nope'}],
  ])('fails the Part 0 read for %s', (_name, env) => {
    expect(() => read(env).mergedPart0('fro-bot/space-bus', 12)).toThrow()
  })
})

describe('memoizeReaders', () => {
  it('asks each question once, a failure included, and ignores the case of a repo name', () => {
    const base = readers({
      goals: 'fail',
      part0: {[systematic.nameWithOwner]: 'https://github.com/marcusrbrown/systematic/pull/7'},
    })
    const memo = memoizeReaders(base)

    expect(() => memo.goalIssues()).toThrow()
    expect(() => memo.goalIssues()).toThrow()
    expect(memo.mergedPart0('marcusrbrown/systematic', 11)).toBe('https://github.com/marcusrbrown/systematic/pull/7')
    expect(memo.mergedPart0('marcusrbrown/Systematic', 11)).toBe('https://github.com/marcusrbrown/systematic/pull/7')
    expect(memo.partActivity(spaceBus.nameWithOwner, 12)).toStrictEqual(NO_ACTIVITY)
    expect(memo.partActivity(spaceBus.nameWithOwner, 12)).toStrictEqual(NO_ACTIVITY)
    expect(base.reads).toStrictEqual([
      'goals',
      'part0 marcusrbrown/systematic#11',
      `activity ${spaceBus.nameWithOwner}#12`,
    ])
  })
})

describe('planAnswers: the anchor is strict', () => {
  const NOW = Date.parse('2026-11-25T12:00:00Z')
  const clock = {now: NOW, answerWindowMs: 3 * 86_400_000, outcomeWindowMs: 14 * 86_400_000}
  const state = buildMarkerComment({
    goal: 'fro-bot/.github#50',
    items: [
      {
        id: 'item',
        target: {owner: 'fro-bot', name: 'dashboard'},
        promptHash: 'abcdabcdabcdabcd',
        status: 'dispatched',
        epoch: NOW - 1000,
      },
    ],
    markerHash: '',
  })
  const plan = (at: number) =>
    planAnswers(
      input({eligible: [dashboard]}),
      readers({
        goals: [goal('initial', 50)],
        comments: {50: [{id: 2, author: 'fro-bot', body: state}]},
        activity: {
          [dashboard.nameWithOwner]: {
            ...NO_ACTIVITY,
            labels: ['part-accepted'],
            labeled: [{label: 'part-accepted', actor: 'fro-bot', at}],
          },
        },
      }),
      clock,
    ).parts[0]

  it('does not count an accept at the instant of the anchor, and counts one a millisecond later', () => {
    expect(plan(NO_ACTIVITY.createdAt)?.state).toBe('awaiting-answer')
    expect(plan(NO_ACTIVITY.createdAt + 1)?.state).toBe('accepted')
  })

  it('plans nothing for a repo with no part issue, and says nothing in the prompt', () => {
    const result = planAnswers(input({eligible: [dashboard], partIssues: new Map()}), readers(), clock)

    expect(result.parts).toStrictEqual([])
    expect(result.answer_instructions).toBe('')
  })
})

describe('partActivity from fixtures', () => {
  const timeline = (entries: readonly unknown[]) =>
    JSON.stringify({
      'marcusrbrown/Systematic': {
        created_at: '2026-10-01T00:00:00Z',
        labels: ['part-accepted', 'x'],
        timeline: entries,
      },
    })
  const read = (text: string | undefined) => goalReaders('fro-bot/.github', {ROLLOUT_TRACKER_PART_ACTIVITY_JSON: text})

  it('reads the creation time, the labels, the labeled events and the comments, names compared ignoring case', () => {
    const activity = read(
      timeline([
        {
          event: 'labeled',
          id: 0,
          login: 'fro-bot',
          label: 'part-accepted',
          created_at: '2026-11-01T00:00:00Z',
          body: '',
        },
        {event: 'commented', id: 5, login: 'marcusrbrown', label: '', created_at: '2026-11-02T00:00:00Z', body: 'hi'},
      ]),
    ).partActivity('marcusrbrown/systematic', 11)

    expect(activity).toStrictEqual({
      createdAt: Date.parse('2026-10-01T00:00:00Z'),
      labels: ['part-accepted', 'x'],
      labeled: [{label: 'part-accepted', actor: 'fro-bot', at: Date.parse('2026-11-01T00:00:00Z')}],
      comments: [{id: 5, author: 'marcusrbrown', at: Date.parse('2026-11-02T00:00:00Z'), body: 'hi'}],
    })
  })

  it.each([
    ['not JSON', 'nope'],
    [
      'a repo it lacks',
      JSON.stringify({'fro-bot/other': {created_at: '2026-10-01T00:00:00Z', labels: [], timeline: []}}),
    ],
    [
      'a creation time that is not a time',
      JSON.stringify({'marcusrbrown/systematic': {created_at: 'soon', labels: [], timeline: []}}),
    ],
    [
      'labels that are not a list',
      JSON.stringify({'marcusrbrown/systematic': {created_at: '2026-10-01T00:00:00Z', labels: 'x', timeline: []}}),
    ],
    [
      'an event that is neither labeled nor commented',
      timeline([{event: 'closed', id: 0, login: 'a', label: '', created_at: '2026-11-01T00:00:00Z', body: ''}]),
    ],
    [
      'an event time that is not a time',
      timeline([{event: 'labeled', id: 0, login: 'a', label: 'x', created_at: 'soon', body: ''}]),
    ],
    [
      'a comment with no id',
      timeline([{event: 'commented', login: 'a', label: '', created_at: '2026-11-01T00:00:00Z', body: ''}]),
    ],
  ])('fails the read for %s', (_name, text) => {
    expect(() => read(text).partActivity('marcusrbrown/systematic', 11)).toThrow()
  })
})

describe('goalReaders through gh', () => {
  let directory = ''

  afterEach(() => {
    vi.unstubAllEnvs()
    if (directory !== '') rmSync(directory, {recursive: true, force: true})
    directory = ''
  })

  function stubGh(): {log: () => string[]; set: (name: string, text: string) => void} {
    directory = mkdtempSync(join(tmpdir(), 'goal-readers-'))
    writeFileSync(
      join(directory, 'gh'),
      [
        '#!/bin/sh',
        'printf "%s\n" "$*" >> "$FAKE_GH_LOG"',
        'case "$*" in',
        '  "api --paginate repos/fro-bot/.github/issues?state=all&creator=fro-bot&labels=cross-repo-goal&per_page=100 --jq "*) cat "$FAKE_GOALS" ;;',
        '  "api --paginate repos/fro-bot/.github/issues/50/comments?per_page=100 --jq "*) cat "$FAKE_COMMENTS" ;;',
        '  "api --paginate repos/marcusrbrown/systematic/issues/11/timeline?per_page=100 --jq "*labeled*) cat "$FAKE_TIMELINE" ;;',
        '  "api repos/marcusrbrown/systematic/issues/11 --jq "*) cat "$FAKE_ISSUE" ;;',
        '  "api --paginate repos/marcusrbrown/systematic/issues/11/timeline?per_page=100 --jq "*) cat "$FAKE_PART0" ;;',
        '  *) echo unexpected >&2; exit 1 ;;',
        'esac',
      ].join('\n'),
    )
    chmodSync(join(directory, 'gh'), 0o755)
    const files: Record<string, string> = {}
    for (const [name, variable] of [
      ['goals', 'FAKE_GOALS'],
      ['comments', 'FAKE_COMMENTS'],
      ['part0', 'FAKE_PART0'],
      ['timeline', 'FAKE_TIMELINE'],
      ['issue', 'FAKE_ISSUE'],
    ] as const) {
      files[name] = join(directory, `${name}.ndjson`)
      writeFileSync(files[name], '')
      vi.stubEnv(variable, files[name])
    }
    vi.stubEnv('FAKE_GH_LOG', join(directory, 'gh.log'))
    writeFileSync(join(directory, 'gh.log'), '')
    vi.stubEnv('PATH', `${directory}:${process.env.PATH ?? ''}`)
    return {
      log: () =>
        readFileSync(join(directory, 'gh.log'), 'utf8')
          .split('\n')
          .filter(line => line !== ''),
      set: (name, text) => writeFileSync(files[name] as string, text),
    }
  }

  const readers = () => goalReaders('fro-bot/.github', {})

  it('lists the goal issues Fro Bot created with the goal label, in every state, across every page', () => {
    const gh = stubGh()
    gh.set(
      'goals',
      `${JSON.stringify(goal('initial', 5))}\n${JSON.stringify(goal('parity-x', 6, {state: 'closed'}))}\n`,
    )

    const issues = readers().goalIssues()

    expect(issues.map(issue => [issue.number, issue.state])).toStrictEqual([
      [5, 'open'],
      [6, 'closed'],
    ])
    expect(gh.log()).toStrictEqual([
      'api --paginate repos/fro-bot/.github/issues?state=all&creator=fro-bot&labels=cross-repo-goal&per_page=100 --jq .[] | {number, state: .state, pull_request: (.pull_request != null), author: (.user.login // ""), body: (.body // "")}',
    ])
  })

  it('fails the goal issue read on a cut-off record', () => {
    const gh = stubGh()
    gh.set('goals', JSON.stringify(goal('initial', 5)).slice(0, 30))

    expect(() => readers().goalIssues()).toThrow()
  })

  it('fails the goal issue read when gh fails', () => {
    stubGh()
    vi.stubEnv('FAKE_GOALS', join(directory, 'missing.ndjson'))

    expect(() => readers().goalIssues()).toThrow()
  })

  it('reads the comments of a goal across every page', () => {
    const gh = stubGh()
    gh.set('comments', `${JSON.stringify({id: 1, author: 'fro-bot', body: 'x'})}\n`)

    expect(readers().goalComments(50)).toStrictEqual([{id: 1, author: 'fro-bot', body: 'x'}])
    expect(gh.log()).toStrictEqual([
      'api --paginate repos/fro-bot/.github/issues/50/comments?per_page=100 --jq .[] | {id, author: (.user.login // ""), body: (.body // "")}',
    ])
  })

  const ref = (number: number, changes: Record<string, unknown> = {}) =>
    JSON.stringify({number, repo: 'marcusrbrown/systematic', pull_request: true, merged: true, ...changes})

  it('finds a merged Part 0 pull request from one read of the part issue timeline, and reads no comment', () => {
    const gh = stubGh()
    gh.set('part0', `${ref(8, {merged: false})}\n${ref(7)}\n${ref(2, {repo: 'fro-bot/agent'})}\n`)

    expect(readers().mergedPart0('marcusrbrown/systematic', 11)).toBe(
      'https://github.com/marcusrbrown/systematic/pull/7',
    )
    expect(gh.log()).toStrictEqual([
      'api --paginate repos/marcusrbrown/systematic/issues/11/timeline?per_page=100 --jq .[] | select(.event == "cross-referenced") | {number: .source.issue.number, repo: (.source.issue.repository.full_name // ""), pull_request: (.source.issue.pull_request != null), merged: (.source.issue.pull_request.merged_at != null)}',
    ])
  })

  it('finds none when the referencing pull request did not merge', () => {
    const gh = stubGh()
    gh.set('part0', `${ref(8, {merged: false})}\n`)

    expect(readers().mergedPart0('marcusrbrown/systematic', 11)).toBeNull()
  })

  it('fails the read on a cut-off record', () => {
    const gh = stubGh()
    gh.set('part0', ref(7).slice(0, 20))

    expect(() => readers().mergedPart0('marcusrbrown/systematic', 11)).toThrow()
  })

  it('fails the read when gh fails', () => {
    stubGh()
    vi.stubEnv('FAKE_PART0', join(directory, 'missing.ndjson'))

    expect(() => readers().mergedPart0('marcusrbrown/systematic', 11)).toThrow()
  })

  const event = (changes: Record<string, unknown>) =>
    JSON.stringify({
      event: 'labeled',
      id: 0,
      login: 'fro-bot',
      label: 'part-accepted',
      created_at: '2026-11-01T00:00:00Z',
      body: '',
      ...changes,
    })

  it('reads the creation time and labels of a part issue, then its labeled and commented events across every page', () => {
    const gh = stubGh()
    gh.set('issue', `${JSON.stringify({created_at: '2026-10-01T00:00:00Z', labels: ['part-accepted']})}\n`)
    gh.set(
      'timeline',
      `${event({})}\n${event({event: 'commented', id: 9, login: 'fro-bot', label: '', body: 'why'})}\n`,
    )

    const activity = readers().partActivity('marcusrbrown/systematic', 11)

    expect(activity.labels).toStrictEqual(['part-accepted'])
    expect(activity.labeled.map(entry => entry.actor)).toStrictEqual(['fro-bot'])
    expect(activity.comments).toStrictEqual([
      {id: 9, author: 'fro-bot', at: Date.parse('2026-11-01T00:00:00Z'), body: 'why'},
    ])
    expect(gh.log()).toStrictEqual([
      'api repos/marcusrbrown/systematic/issues/11 --jq {created_at, labels: [.labels[].name]}',
      'api --paginate repos/marcusrbrown/systematic/issues/11/timeline?per_page=100 --jq .[] | select(.event == "labeled" or .event == "commented") | {event, id: (.id // 0), login: (.actor.login // .user.login // ""), label: (.label.name // ""), created_at, body: ((.body // "") | .[0:4000])}',
    ])
  })

  it('fails the read on a cut-off timeline record, and when gh fails', () => {
    const gh = stubGh()
    gh.set('issue', JSON.stringify({created_at: '2026-10-01T00:00:00Z', labels: []}))
    gh.set('timeline', event({}).slice(0, 25))

    expect(() => readers().partActivity('marcusrbrown/systematic', 11)).toThrow()

    vi.stubEnv('FAKE_ISSUE', join(directory, 'missing.json'))
    expect(() => readers().partActivity('marcusrbrown/systematic', 11)).toThrow()
  })
})
