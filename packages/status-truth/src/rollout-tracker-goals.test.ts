import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {MAX_ITEMS_PER_GOAL, MAX_PROMPT_LENGTH} from '@fro-bot/dispatch/dispatch-model'
import {isPromptSafe, parseBriefReference} from '@fro-bot/dispatch/dispatch-plan'
import {extractItemPrompts, parseDecomposition} from '@fro-bot/dispatch/dispatch-receipts'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  goalMarker,
  goalReaders,
  planGoals,
  type GoalBatch,
  type GoalComment,
  type GoalIssue,
  type GoalPlanInput,
  type GoalReaders,
} from './rollout-tracker-goals.ts'

const COMMIT = 'a'.repeat(40)
const systematic = {nameWithOwner: 'marcusrbrown/systematic', nodeId: 'R_systematic'}
const spaceBus = {nameWithOwner: 'fro-bot/space-bus', nodeId: 'R_space_bus'}
const dashboard = {nameWithOwner: 'fro-bot/dashboard', nodeId: 'R_dashboard'}

const input = (changes: Partial<GoalPlanInput> = {}): GoalPlanInput => ({
  program: 'harness',
  domain: 'harness-tools',
  operator: 'marcusrbrown',
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
}

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
  }
}

const goal = (batch: string, number: number, changes: Partial<GoalIssue> = {}): GoalIssue => ({
  number,
  state: 'open',
  pull_request: false,
  author: 'fro-bot',
  body: `A goal.\n\n${goalMarker('harness', batch)}\n`,
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
        readers({part0: {[systematic.nameWithOwner]: 'https://github.com/marcusrbrown/systematic/pull/7'}}),
      ),
    )[1]

    expect(parseDecomposition(batch?.checklist ?? '').items.map(item => item.target.name)).toStrictEqual(['systematic'])
  })
})

describe('a parity batch', () => {
  const mergedPart0 = {[systematic.nameWithOwner]: 'https://github.com/marcusrbrown/systematic/pull/7'}

  it('is listed for a Part 0 repo whose Part 0 pull request merged, as its own batch and goal', () => {
    const reader = readers({part0: mergedPart0})

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
    const batch = batchesOf(planGoals(input(), readers({part0: mergedPart0}))).find(
      candidate => candidate.batch === parityName(systematic),
    )

    expect(batch?.checklist).toContain('Part 0 has merged in this repository')
    expect(batch?.body).toContain('https://github.com/marcusrbrown/systematic/pull/7')
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
      readers({goals: [goal('initial', 50)], comments: {50: [checklistComment(1, [lineFor(dashboard)])]}}),
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

  it('stops the goal duty, and lists nothing, when the comments of a reused goal cannot be read', () => {
    const result = planGoals(input(), readers({goals: [goal('initial', 50)], comments: {50: 'fail'}}))

    expect(result.goal_error).toBe('goal comments cannot be read')
    expect(batchesOf(result)).toStrictEqual([])
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

  it('tell the agent to write nothing for a stopped batch and to say why on the tracker', () => {
    const long = 'x'.repeat(MAX_PROMPT_LENGTH)
    const instructions = text({}, {program: long})

    expect(instructions).toContain('For an entry whose `error` is a message, write nothing for it')
  })
})

describe('goalReaders from fixtures', () => {
  const read = (env: Record<string, string | undefined>) => goalReaders('fro-bot/.github', 'marcusrbrown', env)

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

  const part0 = (comments: unknown[], merged: Record<string, unknown>) => ({
    ROLLOUT_TRACKER_PART0_JSON: JSON.stringify({'Fro-Bot/Space-Bus': {comments, merged}}),
  })
  const link = (author: string, url: string, id = 1) => ({id, author, body: `Part 0 is ${url}`})

  it('finds the repo ignoring case, and a pull request linked by the operator, by name ignoring case', () => {
    const env = part0([link('MarcusRBrown', 'https://github.com/fro-bot/space-bus/pull/3')], {'3': true})

    expect(read(env).mergedPart0('fro-bot/space-bus', 12)).toBe('https://github.com/fro-bot/space-bus/pull/3')
  })

  it.each(['fro-bot', 'fro-bot[bot]'])('counts a link by %s', author => {
    const env = part0([link(author, 'https://github.com/fro-bot/space-bus/pull/3')], {'3': true})

    expect(read(env).mergedPart0('fro-bot/space-bus', 12)).toBe('https://github.com/fro-bot/space-bus/pull/3')
  })

  it('takes the lowest merged pull request among several links, and skips one that did not merge', () => {
    const env = part0(
      [
        link('fro-bot', 'https://github.com/fro-bot/space-bus/pull/9'),
        link('fro-bot', 'https://github.com/fro-bot/space-bus/pull/4', 2),
        link('fro-bot', 'https://github.com/fro-bot/space-bus/pull/3', 3),
      ],
      {'3': false, '4': true, '9': true},
    )

    expect(read(env).mergedPart0('fro-bot/space-bus', 12)).toBe('https://github.com/fro-bot/space-bus/pull/4')
  })

  it.each([
    ['a link by someone else', [link('octocat', 'https://github.com/fro-bot/space-bus/pull/3')]],
    ['a pull request of another repository', [link('fro-bot', 'https://github.com/fro-bot/agent/pull/3')]],
    [
      'a repository whose name only starts the same',
      [link('fro-bot', 'https://github.com/fro-bot/space-bus-x/pull/3')],
    ],
    ['an issue link', [link('fro-bot', 'https://github.com/fro-bot/space-bus/issues/3')]],
    ['no link', []],
  ])('finds no Part 0 for %s', (_name, comments) => {
    expect(read(part0(comments, {'3': true})).mergedPart0('fro-bot/space-bus', 12)).toBeNull()
  })

  it.each([
    ['a repo the fixture lacks', {ROLLOUT_TRACKER_PART0_JSON: '{}'}],
    [
      'a fixture with no merge map',
      {ROLLOUT_TRACKER_PART0_JSON: JSON.stringify({'fro-bot/space-bus': {comments: []}})},
    ],
    [
      'a linked pull request the merge map lacks',
      part0([link('fro-bot', 'https://github.com/fro-bot/space-bus/pull/3')], {}),
    ],
    [
      'a merge answer that is not a boolean',
      part0([link('fro-bot', 'https://github.com/fro-bot/space-bus/pull/3')], {'3': 'yes'}),
    ],
  ])('fails the Part 0 read for %s', (_name, env) => {
    expect(() => read(env).mergedPart0('fro-bot/space-bus', 12)).toThrow()
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
        '  "api --paginate repos/marcusrbrown/systematic/issues/11/comments?per_page=100 --jq "*) cat "$FAKE_PART0" ;;',
        '  "api repos/marcusrbrown/systematic/pulls/7 --jq .merged") echo true ;;',
        '  "api repos/marcusrbrown/systematic/pulls/8 --jq .merged") echo false ;;',
        '  "api repos/marcusrbrown/systematic/pulls/9 --jq .merged") echo maybe ;;',
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

  const readers = () => goalReaders('fro-bot/.github', 'marcusrbrown', {})

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

  it('finds a merged Part 0 pull request: reads the part issue comments, then each linked pull request of that repo in order', () => {
    const gh = stubGh()
    gh.set(
      'part0',
      `${JSON.stringify({id: 1, author: 'marcusrbrown', body: 'https://github.com/marcusrbrown/systematic/pull/8 then https://github.com/marcusrbrown/systematic/pull/7 and https://github.com/fro-bot/agent/pull/2'})}\n`,
    )

    expect(readers().mergedPart0('marcusrbrown/systematic', 11)).toBe(
      'https://github.com/marcusrbrown/systematic/pull/7',
    )
    expect(gh.log().map(line => line.split(' --jq')[0])).toStrictEqual([
      'api --paginate repos/marcusrbrown/systematic/issues/11/comments?per_page=100',
      'api repos/marcusrbrown/systematic/pulls/7',
    ])
  })

  it('finds none when the linked pull request did not merge', () => {
    const gh = stubGh()
    gh.set(
      'part0',
      `${JSON.stringify({id: 1, author: 'fro-bot', body: 'https://github.com/marcusrbrown/systematic/pull/8'})}\n`,
    )

    expect(readers().mergedPart0('marcusrbrown/systematic', 11)).toBeNull()
  })

  it('fails the read when gh answers something that is not true or false', () => {
    const gh = stubGh()
    gh.set(
      'part0',
      `${JSON.stringify({id: 1, author: 'fro-bot', body: 'https://github.com/marcusrbrown/systematic/pull/9'})}\n`,
    )

    expect(() => readers().mergedPart0('marcusrbrown/systematic', 11)).toThrow()
  })
})
