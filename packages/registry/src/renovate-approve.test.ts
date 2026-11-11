import {describe, expect, it} from 'vitest'
import {
  runApprove,
  summaryOf,
  sweep,
  type ApproveOctokit,
  type OutcomeCode,
  type Row,
  type RunApproveParams,
  type StopCode,
  type SweepInput,
  type SweepResult,
} from './renovate-approve.ts'

const DECLARED = ['Lint', 'Test', 'Security: Private Leak Scan', 'CodeQL'] as const
const APP = {id: 109_017_866, type: 'Bot'} as const
const MINUTE = 60_000
const BUDGET = 10 * MINUTE

const sha = (n: number, fill = 'a'): string => `${n.toString(16).padStart(8, '0')}${fill.repeat(32)}`

interface ApiError extends Error {
  status: number
}

function apiError(status: number, message = 'upstream body with a secret'): ApiError {
  return Object.assign(new Error(message), {status})
}

interface CommitSpec {
  readonly author?: unknown
  readonly verified?: boolean | undefined
  readonly noVerification?: boolean
}

interface ReviewSpec {
  readonly login?: string | null
  readonly state?: string
  readonly commit?: string
}

interface RunSpec {
  readonly id?: number
  readonly name: string
  readonly status?: string
  readonly conclusion?: string | null
  readonly app?: number | null
}

interface PrSpec {
  readonly number: number
  head?: string
  ref?: string
  labels?: readonly string[]
  author?: unknown
  headRepoId?: number | null
  baseRepoId?: number
  state?: string
  base?: string
  armed?: boolean
  title?: string
  commits?: readonly CommitSpec[]
  files?: readonly {filename: string; previous_filename?: string}[]
  /** Commits `main` is ahead of the head by, per compare call on this PR (1-based) or a fixed value. */
  behindBy?: number | string | null | undefined | ((call: number) => unknown)
  runs?: readonly RunSpec[]
  statuses?: readonly {context: string; state: string}[]
  reviews?: ReviewSpec[]
}

interface Scenario {
  readonly prs?: readonly PrSpec[]
  /** `getBranch` on its n-th call (1-based); an Error is thrown. */
  readonly protection?: (call: number) => unknown
  readonly variable?: (call: number) => string | undefined | Error
  /** What `createReview` does on its n-th call. `recorded` also stores the review before it throws. */
  readonly approve?: (call: number) => 'ok' | Error | 'hang' | {readonly recordedThen: Error | 'hang'}
  /** Runs inside `pulls.get` before it answers, to change the PR between the judging and the fresh read. */
  readonly onGet?: (pr: PrSpec, call: number) => void
  readonly listError?: (page: number) => Error | undefined
  readonly listPageSize?: (page: number) => number | undefined
  /** The extra rows a list page holds, to make a list reach its cap. */
  readonly fill?: Partial<Record<'commits' | 'files' | 'reviews' | 'runs' | 'statuses', number>>
  readonly failRead?: (name: string, pr: number, call: number) => Error | undefined
  readonly hang?: (name: string, call: number) => boolean
  readonly cost?: number | ((name: string, call: number) => number)
  readonly reviewsError?: (call: number) => Error | undefined
  /** Extra review rows on the n-th `listReviews` call, to make only the reconcile read reach its cap. */
  readonly reviewsFill?: (call: number) => number
}

function checksFor(contexts: readonly string[]) {
  return contexts.map(context => ({context, app_id: context === 'CodeQL' ? 57_789 : 15_368}))
}

function protectionOf(checks: readonly {context: string; app_id: number | null}[]) {
  return {data: {protection: {required_status_checks: {checks}}}}
}

const GREEN_RUNS: readonly RunSpec[] = [
  {name: 'Lint', app: 15_368},
  {name: 'Test', app: 15_368},
  {name: 'CodeQL', app: 57_789},
]
const GREEN_STATUSES = [{context: 'Security: Private Leak Scan', state: 'success'}]

function pr(number: number, overrides: Partial<PrSpec> = {}): PrSpec {
  return {number, ...overrides}
}

function world(scenario: Scenario = {}) {
  const clock = {now: 5_000_000}
  const calls: {name: string; params: Record<string, unknown>; signalMs: number | undefined}[] = []
  const counts: Record<string, number> = {}
  const sleeps: number[] = []
  const sizes = new Map<AbortSignal, number>()
  const controllers = new Map<AbortSignal, AbortController>()
  const prs: PrSpec[] = (scenario.prs ?? []).map(spec => ({...spec}))
  const byNumber = (number: number): PrSpec => {
    const found = prs.find(candidate => candidate.number === number)
    if (found === undefined) throw apiError(404, 'no such pr')
    return found
  }
  const byHead = (ref: string): PrSpec => {
    const found = prs.find(candidate => (candidate.head ?? sha(candidate.number)) === ref)
    if (found === undefined) throw apiError(404, 'no such head')
    return found
  }

  const record = (name: string, params: unknown): number => {
    const {request, ...rest} = params as {request?: {signal?: AbortSignal}}
    calls.push({
      name,
      params: rest,
      signalMs: request?.signal === undefined ? undefined : sizes.get(request.signal),
    })
    counts[name] = (counts[name] ?? 0) + 1
    const cost = scenario.cost ?? 0
    clock.now += typeof cost === 'number' ? cost : cost(name, counts[name] ?? 0)
    return counts[name] ?? 0
  }
  const stall = async (params: unknown): Promise<never> =>
    new Promise<never>((_resolve, reject) => {
      const signal = (params as {request?: {signal?: AbortSignal}}).request?.signal
      setTimeout(() => {
        if (signal !== undefined) controllers.get(signal)?.abort()
        reject(Object.assign(new Error('The operation was aborted'), {status: 500}))
      }, 0)
    })
  const gate = async (name: string, params: unknown, number?: number): Promise<number> => {
    const call = record(name, params)
    if (scenario.hang?.(name, call) === true) await stall(params)
    const failure = scenario.failRead?.(name, number ?? 0, call)
    if (failure !== undefined) throw failure
    return call
  }

  const authorOf = (spec: PrSpec) => ('author' in spec ? spec.author : APP)
  const dataOf = (spec: PrSpec) => ({
    number: spec.number,
    title: spec.title ?? 'Update dependency left-pad to v9',
    state: spec.state ?? 'open',
    user: authorOf(spec),
    head: {
      sha: spec.head ?? sha(spec.number),
      ref: spec.ref ?? 'renovate/left-pad-9.x',
      repo: spec.headRepoId === null ? null : {id: spec.headRepoId ?? 1},
    },
    base: {ref: spec.base ?? 'main', repo: {id: spec.baseRepoId ?? 1}},
    labels: (spec.labels ?? ['automerge']).map(name => ({name})),
    auto_merge: spec.armed === false ? null : {enabled_by: {login: 'fro-bot'}, merge_method: 'squash'},
  })
  const page = <T>(items: readonly T[], params: {page: number; per_page: number}, fill = 0): readonly T[] => {
    const all =
      fill > 0
        ? [...items, ...Array.from({length: fill}, (_, index) => items[index % Math.max(1, items.length)] as T)]
        : items
    return all.slice((params.page - 1) * params.per_page, params.page * params.per_page)
  }

  const octokit = {
    rest: {
      repos: {
        getBranch: async (params: unknown) => {
          const call = await gate('getBranch', params)
          const answer = scenario.protection?.(call) ?? protectionOf(checksFor(DECLARED))
          if (answer instanceof Error) throw answer
          return answer
        },
        compareCommitsWithBasehead: async (params: {basehead: string}) => {
          const head = params.basehead.replace(/^main\.\.\./u, '')
          const spec = byHead(head)
          const call = await gate('compare', params, spec.number)
          const behindBy = typeof spec.behindBy === 'function' ? spec.behindBy(call) : (spec.behindBy ?? 0)
          return {data: {behind_by: behindBy, status: 'ahead'}}
        },
        listCommitStatusesForRef: async (params: {ref: string; page: number; per_page: number}) => {
          const spec = byHead(params.ref)
          await gate('listStatuses', params, spec.number)
          return {data: page(spec.statuses ?? GREEN_STATUSES, params, scenario.fill?.statuses)}
        },
      },
      checks: {
        listForRef: async (params: {ref: string; page: number; per_page: number}) => {
          const spec = byHead(params.ref)
          await gate('listRuns', params, spec.number)
          const runs = (spec.runs ?? GREEN_RUNS).map((run, index) => ({
            id: run.id ?? index + 1,
            name: run.name,
            status: run.status ?? 'completed',
            conclusion: run.conclusion === undefined ? 'success' : run.conclusion,
            app: run.app === null ? null : {id: run.app ?? 15_368},
          }))
          return {data: {check_runs: page(runs, params, scenario.fill?.runs)}}
        },
      },
      pulls: {
        list: async (params: {page: number; per_page: number}) => {
          await gate('list', params)
          const failure = scenario.listError?.(params.page)
          if (failure !== undefined) throw failure
          const size = scenario.listPageSize?.(params.page)
          if (size !== undefined) {
            return {
              data: Array.from({length: size}, (_, index) =>
                dataOf(pr(10_000 + params.page * 1000 + index, {ref: 'feature/x'})),
              ),
            }
          }
          return {data: page(prs.map(dataOf), params)}
        },
        get: async (params: {pull_number: number}) => {
          const spec = byNumber(params.pull_number)
          const call = await gate('get', params, spec.number)
          scenario.onGet?.(spec, call)
          return {data: dataOf(spec)}
        },
        listCommits: async (params: {pull_number: number; page: number; per_page: number}) => {
          const spec = byNumber(params.pull_number)
          await gate('listCommits', params, spec.number)
          const commits = (spec.commits ?? [{}]).map((commit, index) => ({
            sha: sha(index + 1, 'c'),
            author: 'author' in commit ? commit.author : APP,
            commit: {
              verification:
                commit.noVerification === true ? undefined : {verified: 'verified' in commit ? commit.verified : true},
            },
          }))
          return {data: page(commits, params, scenario.fill?.commits)}
        },
        listFiles: async (params: {pull_number: number; page: number; per_page: number}) => {
          const spec = byNumber(params.pull_number)
          await gate('listFiles', params, spec.number)
          return {data: page(spec.files ?? [{filename: 'package.json'}], params, scenario.fill?.files)}
        },
        listReviews: async (params: {pull_number: number; page: number; per_page: number}) => {
          const spec = byNumber(params.pull_number)
          const call = await gate('listReviews', params, spec.number)
          const failure = scenario.reviewsError?.(call)
          if (failure !== undefined) throw failure
          const reviews = (spec.reviews ?? []).map(review => ({
            user: review.login === null ? null : {login: review.login ?? 'fro-bot'},
            state: review.state ?? 'APPROVED',
            commit_id: review.commit ?? spec.head ?? sha(spec.number),
          }))
          return {data: page(reviews, params, scenario.reviewsFill?.(call) ?? scenario.fill?.reviews)}
        },
        createReview: async (params: {pull_number: number; commit_id: string}) => {
          const spec = byNumber(params.pull_number)
          const call = await gate('approve', params, spec.number)
          const behavior = scenario.approve?.(call) ?? 'ok'
          const record = () => {
            spec.reviews = [...(spec.reviews ?? []), {login: 'fro-bot', state: 'APPROVED', commit: params.commit_id}]
          }
          if (behavior === 'hang') return stall(params)
          if (behavior instanceof Error) throw behavior
          if (behavior === 'ok') {
            record()
            return {data: {}}
          }
          record()
          if (behavior.recordedThen === 'hang') return stall(params)
          throw behavior.recordedThen
        },
      },
      actions: {
        getRepoVariable: async (params: unknown) => {
          const call = await gate('getVariable', params)
          const value = (scenario.variable ?? (() => 'on'))(call)
          if (value instanceof Error) throw value
          if (value === undefined) throw apiError(404, 'Not Found')
          return {data: {name: 'RENOVATE_APPROVE', value}}
        },
      },
    },
  } as unknown as ApproveOctokit

  const input = (overrides: Partial<SweepInput> = {}): SweepInput => ({
    octokit,
    owner: 'fro-bot',
    repo: '.github',
    modeAtStart: 'on',
    declaredContexts: DECLARED,
    now: () => clock.now,
    sleep: async ms => {
      sleeps.push(ms)
      clock.now += ms
    },
    signal: ms => {
      const controller = new AbortController()
      controllers.set(controller.signal, controller)
      sizes.set(controller.signal, ms)
      return controller.signal
    },
    ...overrides,
  })
  const named = (name: string) => calls.filter(call => call.name === name)
  const order = () => calls.map(call => call.name)
  return {octokit, input, calls, named, order, sleeps, clock, prs}
}

type World = ReturnType<typeof world>

/** The outcome codes by PR number. */
function outcomes(result: SweepResult): Record<number, string> {
  return Object.fromEntries(result.rows.map(row => [row.number, row.outcome]))
}

function rowOf(result: SweepResult, number: number): Row {
  const row = result.rows.find(candidate => candidate.number === number)
  if (row === undefined) throw new Error(`no row for #${String(number)}`)
  return row
}

const LIVE = async (w: World) => sweep(w.input({modeAtStart: 'on'}))
const DRY = async (w: World) => sweep(w.input({modeAtStart: undefined}))

function approvalBody(head: string): string {
  return `Approved by Renovate Approve: this PR carries automerge and every required check passed on ${head}.`
}

describe('sweep: the happy path (AE1, AE2)', () => {
  it('approves the one qualifying PR, pinned to its head, and reports it', async () => {
    const w = world({prs: [pr(7)]})
    const result = await LIVE(w)

    expect(result).toEqual({
      exitCode: 0,
      live: true,
      stop: null,
      rows: [{number: 7, head: sha(7).slice(0, 7), outcome: 'approved', detail: 'approved on this head', armed: true}],
    })
    expect(w.named('approve')).toHaveLength(1)
    expect(w.named('approve')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 7,
      commit_id: sha(7),
      event: 'APPROVE',
      body: approvalBody(sha(7)),
    })
    expect(approvalBody(sha(7)).includes('\n')).toBe(false)
  })

  it('reads in a fixed order and sends nothing but one review', async () => {
    const w = world({prs: [pr(7)]})
    await LIVE(w)

    expect(w.order()).toEqual([
      'getBranch',
      'list',
      'listCommits',
      'listFiles',
      'compare',
      'listRuns',
      'listStatuses',
      'listReviews',
      'get',
      'compare',
      'getBranch',
      'getVariable',
      'approve',
    ])
    expect(w.calls[1]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      state: 'open',
      base: 'main',
      per_page: 100,
      page: 1,
    })
    expect(w.named('listCommits')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 7,
      per_page: 100,
      page: 1,
    })
    expect(w.named('listFiles')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 7,
      per_page: 100,
      page: 1,
    })
    expect(w.named('listReviews')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      pull_number: 7,
      per_page: 100,
      page: 1,
    })
    expect(w.named('compare')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      basehead: `main...${sha(7)}`,
      per_page: 1,
    })
    expect(w.named('getBranch')[0]?.params).toEqual({owner: 'fro-bot', repo: '.github', branch: 'main'})
    expect(w.named('getVariable')[0]?.params).toEqual({owner: 'fro-bot', repo: '.github', name: 'RENOVATE_APPROVE'})
    expect(w.named('get')[0]?.params).toEqual({owner: 'fro-bot', repo: '.github', pull_number: 7})
    expect(w.named('listRuns')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      ref: sha(7),
      filter: 'latest',
      per_page: 100,
      page: 1,
    })
    expect(w.named('listStatuses')[0]?.params).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      ref: sha(7),
      per_page: 100,
      page: 1,
    })
  })

  it('has no way to merge, arm auto-merge or dismiss: the client it is given holds none', async () => {
    const w = world({prs: [pr(7)]})
    const pulls = w.octokit.rest.pulls as Record<string, unknown>
    expect(Object.keys(pulls).toSorted()).toEqual([
      'createReview',
      'get',
      'list',
      'listCommits',
      'listFiles',
      'listReviews',
    ])
    expect('merge' in pulls).toBe(false)
    await LIVE(w)
    expect(w.order().filter(name => name === 'approve')).toHaveLength(1)
  })

  it('judges a major update like any candidate: the PR title is never read (AE4)', async () => {
    const w = world({prs: [pr(7, {title: 'Update dependency react to v20 (major)'})]})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({7: 'approved'})
  })

  it('reports an empty sweep with exit 0 and reads nothing per PR', async () => {
    const w = world({prs: []})
    const result = await LIVE(w)
    expect(result).toEqual({exitCode: 0, live: true, stop: null, rows: []})
    expect(w.order()).toEqual(['getBranch', 'list'])
  })
})

describe('sweep: the mode is fixed at the start (AE8)', () => {
  it('is a dry run unless the variable is exactly `on`: would-approve, no review, no variable read', async () => {
    for (const mode of [undefined, '', 'off', 'ON', 'true', ' on', 'on ']) {
      const w = world({prs: [pr(7)]})
      const result = await sweep(w.input({modeAtStart: mode}))

      expect(result.live).toBe(false)
      expect(result.rows).toEqual([
        {
          number: 7,
          head: sha(7).slice(0, 7),
          outcome: 'would-approve',
          detail: 'dry run: RENOVATE_APPROVE is not on',
          armed: true,
        },
      ])
      expect(result.exitCode).toBe(0)
      expect(w.named('approve')).toEqual([])
      expect(w.named('getVariable')).toEqual([])
    }
  })

  it('still does the fresh read in a dry run, and the fresh read can stop it', async () => {
    const w = world({
      prs: [pr(7)],
      onGet: spec => {
        spec.labels = ['automerge', 'hold-merge']
      },
    })
    const result = await DRY(w)
    expect(outcomes(result)).toEqual({7: 'no-longer-qualifies'})
    expect(w.named('get')).toHaveLength(1)
  })

  it('stays a dry run whatever the variable becomes: it is never asked', async () => {
    const w = world({prs: [pr(7)], variable: () => 'on'})
    const result = await DRY(w)
    expect(outcomes(result)).toEqual({7: 'would-approve'})
    expect(w.named('getVariable')).toHaveLength(0)
  })

  it('reads the variable again in a live sweep, and stops when it is not `on` any more', async () => {
    for (const value of ['off', '', 'ON', 'true']) {
      const w = world({prs: [pr(7)], variable: () => value})
      const result = await LIVE(w)
      expect(rowOf(result, 7)).toMatchObject({
        outcome: 'switch-off',
        detail: 'RENOVATE_APPROVE was no longer on before the approval',
      })
      expect(result.exitCode).toBe(0)
      expect(w.named('approve')).toEqual([])
    }
  })

  it('does not use the slot on a switch-off: the next PR is judged the same way, and stopped too', async () => {
    const w = world({prs: [pr(7), pr(8)], variable: () => 'off'})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({7: 'switch-off', 8: 'switch-off'})
  })

  it.each([
    ['a 404 (unset or no access)', apiError(404, 'Not Found')],
    ['a 500', apiError(500)],
    ['a 403', apiError(403)],
  ])('ends as an error, exit 1, when the variable read is %s', async (_name, error) => {
    const w = world({prs: [pr(7)], variable: () => error})
    const result = await LIVE(w)
    expect(rowOf(result, 7)).toMatchObject({outcome: 'error', detail: 'RENOVATE_APPROVE could not be read'})
    expect(result.exitCode).toBe(1)
    expect(w.named('approve')).toEqual([])
  })

  it('ends the sweep, not just the PR, when the variable read is cut off', async () => {
    const w = world({prs: [pr(1), pr(2)], hang: name => name === 'getVariable'})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'error', 2: 'error'})
    expect(rowOf(result, 1).detail).toBe('the sweep ran out of time')
    expect(rowOf(result, 2).detail).toBe('the sweep ran out of time')
    expect(w.named('listCommits')).toHaveLength(1)
  })

  it('retries a transient failure of the variable read before it gives up', async () => {
    const w = world({prs: [pr(7)], variable: call => (call === 1 ? apiError(503) : 'on')})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({7: 'approved'})
    expect(w.sleeps).toEqual([2000])
  })
})

describe('sweep: one approval per sweep, lowest number first', () => {
  it('approves the lower number and defers the other, whatever the order GitHub lists them in', async () => {
    const w = world({prs: [pr(9), pr(3)]})
    const result = await LIVE(w)

    expect(result.rows.map(row => row.number)).toEqual([3, 9])
    expect(outcomes(result)).toEqual({3: 'approved', 9: 'deferred'})
    expect(rowOf(result, 9).detail).toBe('ready; another PR was approved in this sweep')
    expect(w.named('approve')).toHaveLength(1)
    expect(w.named('approve')[0]?.params.pull_number).toBe(3)
    expect(result.exitCode).toBe(0)
  })

  it('applies the cap in a dry run too: would-approve for the lower number, deferred for the other', async () => {
    const w = world({prs: [pr(9), pr(3)]})
    const result = await DRY(w)
    expect(outcomes(result)).toEqual({3: 'would-approve', 9: 'deferred'})
  })

  it('does not fresh-read a deferred PR', async () => {
    const w = world({prs: [pr(3), pr(9)]})
    await LIVE(w)
    expect(w.named('get').map(call => call.params.pull_number)).toEqual([3])
  })

  it('lets a pending or failing PR go first without taking the slot', async () => {
    const w = world({
      prs: [
        pr(1, {runs: [{name: 'Lint', status: 'in_progress', conclusion: null}, ...GREEN_RUNS.slice(1)]}),
        pr(2, {runs: [{name: 'Lint', conclusion: 'failure'}, ...GREEN_RUNS.slice(1)]}),
        pr(3),
      ],
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'checks-pending', 2: 'checks-failed', 3: 'approved'})
  })

  it('does not use the slot for a PR the fresh read stops, so the next ready PR is approved', async () => {
    const w = world({
      prs: [pr(1), pr(2)],
      onGet: spec => {
        if (spec.number === 1) spec.head = sha(1, 'f')
      },
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'head-moved', 2: 'approved'})
  })

  it('uses the slot once a review request is sent, whatever came back', async () => {
    const w = world({prs: [pr(1), pr(2)], approve: () => apiError(422), reviewsError: () => undefined})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approval-unknown', 2: 'deferred'})
    expect(w.named('approve')).toHaveLength(1)
  })
})

describe('sweep: an existing approval is respected (AE3)', () => {
  it('leaves a PR alone when fro-bot approved this head: no review call, and the slot is not used', async () => {
    const w = world({prs: [pr(1, {reviews: [{}]}), pr(2)]})
    const result = await LIVE(w)

    expect(outcomes(result)).toEqual({1: 'already-approved', 2: 'approved'})
    expect(rowOf(result, 1).detail).toBe('already approved by fro-bot on this head')
    expect(w.named('approve')).toHaveLength(1)
    expect(w.named('approve')[0]?.params.pull_number).toBe(2)
  })

  it.each([
    ['an approval of an older head', {commit: sha(1, 'b')}],
    ['a dismissed approval', {state: 'DISMISSED'}],
    ['a comment', {state: 'COMMENTED'}],
    ['a change request', {state: 'CHANGES_REQUESTED'}],
    ['an approval by someone else', {login: 'marcusrbrown'}],
    ['an approval by the App', {login: 'fro-bot[bot]'}],
    ['an approval with no user', {login: null}],
  ] as const)('does not count %s', async (_name, review) => {
    const w = world({prs: [pr(1, {reviews: [review]})]})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved'})
  })

  it('finds the approval on a later page of reviews', async () => {
    const filler = Array.from({length: 100}, () => ({login: 'someone', state: 'COMMENTED'}))
    const w = world({prs: [pr(1, {reviews: [...filler, {}]})]})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'already-approved'})
    expect(w.named('listReviews').map(call => call.params.page)).toEqual([1, 2])
  })

  it('shows already-approved before the checks only if they passed: a red PR stays red (diagram order)', async () => {
    const w = world({
      prs: [pr(1, {reviews: [{}], runs: [{name: 'Lint', conclusion: 'failure'}, ...GREEN_RUNS.slice(1)]})],
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'checks-failed'})
  })

  it('is idempotent: a second sweep after the first approval approves nothing new', async () => {
    const w = world({prs: [pr(1)]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
    expect(outcomes(await LIVE(w))).toEqual({1: 'already-approved'})
    expect(w.named('approve')).toHaveLength(1)
  })
})

describe('sweep: who is a candidate (AE5, AE10)', () => {
  const notCandidates: readonly (readonly [string, Partial<PrSpec>])[] = [
    ['a PR without the automerge label', {labels: ['dependencies']}],
    ['a PR with a similar label', {labels: ['automerge-later', 'Automerge']}],
    ['a PR with no labels', {labels: []}],
    ['the data promotion PR (a non-renovate branch)', {ref: 'data', labels: ['automerge']}],
    ['a branch that only contains renovate/', {ref: 'feature/renovate/x'}],
    ['a branch that starts with renovate- but not renovate/', {ref: 'renovate-x'}],
    ['a PR from a fork', {headRepoId: 2}],
    ['a PR whose head repository is gone', {headRepoId: null}],
    ['a person on a renovate/ branch', {author: {id: 1234, type: 'User'}}],
    ['a bot that is not the App', {author: {id: 29_139_614, type: 'Bot'}}],
    ['a user that has the App id but not the type', {author: {id: APP.id, type: 'User'}}],
    ['a PR with no author', {author: null}],
    ['a PR whose author has no id', {author: {type: 'Bot'}}],
    ['a PR whose author has no type', {author: {id: APP.id}}],
    ['a closed PR', {state: 'closed'}],
    ['a PR against another base', {base: 'develop'}],
  ]

  it.each(notCandidates)('does not list %s at all', async (_name, overrides) => {
    const w = world({prs: [pr(5, overrides)]})
    const result = await LIVE(w)
    expect(result).toEqual({exitCode: 0, live: true, stop: null, rows: []})
    expect(w.order()).toEqual(['getBranch', 'list'])
  })

  it('judges the candidates among a mix, and only those', async () => {
    const w = world({
      prs: [
        pr(1, {labels: []}),
        pr(2, {author: {id: 1, type: 'User'}}),
        pr(3),
        pr(4, {headRepoId: 9}),
        pr(5, {ref: 'data'}),
      ],
    })
    const result = await LIVE(w)
    expect(result.rows.map(row => row.number)).toEqual([3])
  })

  it('does not throw on a null head repository that comes with a person as author', async () => {
    const w = world({prs: [pr(1, {headRepoId: null, author: {id: 5, type: 'User'}}), pr(2)]})
    const result = await LIVE(w)
    expect(result.exitCode).toBe(0)
    expect(outcomes(result)).toEqual({2: 'approved'})
  })

  it('reads the PR list to the end: a second page of candidates is judged', async () => {
    const many = Array.from({length: 100}, (_, index) => pr(100 + index, {ref: 'feature/x'}))
    const w = world({prs: [...many, pr(300)]})
    const result = await LIVE(w)
    expect(w.named('list').map(call => call.params.page)).toEqual([1, 2])
    expect(outcomes(result)).toEqual({300: 'approved'})
  })
})

describe('sweep: qualification', () => {
  it('holds a PR that carries hold-merge, before it reads anything of the PR', async () => {
    const w = world({prs: [pr(1, {labels: ['automerge', 'hold-merge']})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'held', detail: 'carries hold-merge'})
    expect(result.exitCode).toBe(0)
    expect(w.order()).toEqual(['getBranch', 'list'])
  })

  const appCommit = {}
  it.each([
    ['another user', [{author: {id: 1, type: 'User'}}]],
    ['a bot that is not the App', [{author: {id: 29_139_614, type: 'Bot'}}]],
    ['the App id with the wrong type', [{author: {id: APP.id, type: 'User'}}]],
    ['no resolved author', [{author: null}]],
    ['an empty author object', [{author: {}}]],
    ['an unverified commit', [{verified: false}]],
    ['a commit with no verification data', [{noVerification: true}]],
    ['a commit with verified undefined', [{verified: undefined}]],
    ['one bad commit among App commits', [appCommit, {author: {id: 1, type: 'User'}}, appCommit]],
    ['one unverified commit among App commits', [appCommit, appCommit, {verified: false}]],
    ['no commits at all', []],
  ] as const)('refuses a PR with %s as a foreign commit (AE5, AE9)', async (_name, commits) => {
    const w = world({prs: [pr(1, {commits})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({
      outcome: 'foreign-commit',
      detail: 'a commit is not by the App, or is unverified',
    })
    expect(result.exitCode).toBe(0)
    expect(w.named('listFiles')).toEqual([])
    expect(w.named('approve')).toEqual([])
  })

  it('accepts several App commits, a committer that is not the App, and reads every page of commits', async () => {
    const commits = Array.from({length: 150}, () => ({}))
    const w = world({prs: [pr(1, {commits})]})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved'})
    expect(w.named('listCommits').map(call => call.params.page)).toEqual([1, 2])
  })

  it('finds a bad commit on the second page of commits', async () => {
    const commits = [...Array.from({length: 100}, () => ({})), {author: {id: 1, type: 'User'}}]
    const w = world({prs: [pr(1, {commits})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'foreign-commit'})
  })

  it.each([
    ['default.json', {filename: 'default.json'}],
    ['.github/renovate.json5', {filename: '.github/renovate.json5'}],
    ['a rename away from default.json', {filename: 'config/default.json', previous_filename: 'default.json'}],
    ['a rename away from .github/renovate.json5', {filename: 'x.json5', previous_filename: '.github/renovate.json5'}],
    ['a rename onto default.json', {filename: 'default.json', previous_filename: 'old.json'}],
    ['a rename onto .github/renovate.json5', {filename: '.github/renovate.json5', previous_filename: 'old.json5'}],
  ])('refuses a PR that changes %s as a config change (AE6)', async (_name, file) => {
    const w = world({prs: [pr(1, {files: [{filename: 'package.json'}, file]})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'config-change', detail: 'changes a Renovate config file'})
    expect(result.exitCode).toBe(0)
    expect(w.named('compare')).toEqual([])
  })

  it.each([
    ['sub/default.json', {filename: 'sub/default.json'}],
    ['renovate.json5 at the root', {filename: 'renovate.json5'}],
    ['.github/renovate.json5.bak', {filename: '.github/renovate.json5.bak'}],
    ['.github/workflows/x.yaml', {filename: '.github/workflows/x.yaml'}],
    ['a rename of an ordinary file', {filename: 'b.ts', previous_filename: 'a.ts'}],
  ])('lets a PR through that touches %s', async (_name, file) => {
    const w = world({prs: [pr(1, {files: [file]})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
  })

  it('finds a config file on the second page of files', async () => {
    const files = [
      ...Array.from({length: 100}, (_, index) => ({filename: `src/f${String(index)}.ts`})),
      {filename: 'default.json'},
    ]
    const w = world({prs: [pr(1, {files})]})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'config-change'})
    expect(w.named('listFiles').map(call => call.params.page)).toEqual([1, 2])
  })

  it('lets a PR that changes workflows or settings files through (accepted in the origin)', async () => {
    const w = world({
      prs: [pr(1, {files: [{filename: '.github/workflows/main.yaml'}, {filename: '.github/settings.yml'}]})],
    })
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
  })
})

describe('sweep: behind main', () => {
  it('does not approve a PR that is behind main, and measures it with the comparison', async () => {
    const w = world({prs: [pr(1, {behindBy: 3})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'behind', detail: 'behind main; Renovate rebases it'})
    expect(result.exitCode).toBe(0)
    expect(w.named('listRuns')).toEqual([])
    expect(w.named('approve')).toEqual([])
  })

  it('treats one commit behind as behind and zero as up to date', async () => {
    expect(outcomes(await LIVE(world({prs: [pr(1, {behindBy: 1})]})))).toEqual({1: 'behind'})
    expect(outcomes(await LIVE(world({prs: [pr(1, {behindBy: 0})]})))).toEqual({1: 'approved'})
  })

  it.each([
    ['a string', '0'],
    ['undefined', undefined],
    ['null', null],
  ])('does not read behind_by %s as up to date', async (_name, value) => {
    const w = world({prs: [pr(1, {behindBy: () => value})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'behind'})
    expect(result.exitCode).toBe(0)
    expect(w.named('approve')).toEqual([])
  })

  it('judges the other PRs when one comparison fails', async () => {
    const w = world({
      prs: [pr(1), pr(2)],
      failRead: (name, number) => (name === 'compare' && number === 1 ? apiError(404) : undefined),
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'error', 2: 'approved'})
    expect(result.exitCode).toBe(1)
  })
})

describe('sweep: the required checks on the head', () => {
  it.each(['success', 'skipped', 'neutral'])('counts a %s required run as passed', async conclusion => {
    const w = world({prs: [pr(1, {runs: [{name: 'Lint', conclusion}, ...GREEN_RUNS.slice(1)]})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
  })

  it('counts a skipped Fro Bot check as passed when it is required', async () => {
    const contexts = [...DECLARED, 'Fro Bot']
    const w = world({
      protection: () => protectionOf(checksFor(contexts)),
      prs: [pr(1, {runs: [...GREEN_RUNS, {name: 'Fro Bot', conclusion: 'skipped'}]})],
    })
    const result = await sweep(w.input({declaredContexts: contexts}))
    expect(outcomes(result)).toEqual({1: 'approved'})
  })

  it('names a required context that has no run and no status as pending', async () => {
    const w = world({prs: [pr(1, {runs: GREEN_RUNS.slice(1), statuses: []})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({
      outcome: 'checks-pending',
      detail: 'waiting on: `Lint`, `Security: Private Leak Scan`',
    })
    expect(result.exitCode).toBe(0)
    expect(w.named('approve')).toEqual([])
  })

  it('names a failed required check', async () => {
    const w = world({
      prs: [
        pr(1, {runs: [{name: 'Test', conclusion: 'timed_out'}, GREEN_RUNS[0] as RunSpec, GREEN_RUNS[2] as RunSpec]}),
      ],
    })
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'checks-failed', detail: 'failed: `Test`'})
    expect(result.exitCode).toBe(0)
  })

  it('reports a failure ahead of a pending check', async () => {
    const w = world({
      prs: [
        pr(1, {
          runs: [
            {name: 'Lint', conclusion: 'failure'},
            {name: 'Test', status: 'queued', conclusion: null},
            GREEN_RUNS[2] as RunSpec,
          ],
        }),
      ],
    })
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'checks-failed', detail: 'failed: `Lint`'})
  })

  it('needs a status of the same name as a run to pass too: a pending status keeps it pending', async () => {
    const contexts = [...DECLARED]
    const w = world({
      protection: () => protectionOf(checksFor(contexts)),
      prs: [
        pr(1, {
          runs: [...GREEN_RUNS, {name: 'Security: Private Leak Scan', app: 15_368}],
          statuses: [{context: 'Security: Private Leak Scan', state: 'pending'}],
        }),
      ],
    })
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({
      outcome: 'checks-pending',
      detail: 'waiting on: `Security: Private Leak Scan`',
    })
  })

  it('ignores a passing run from another app that has a required name', async () => {
    const w = world({prs: [pr(1, {runs: [{name: 'Lint', app: 999}, ...GREEN_RUNS.slice(1)]})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'checks-pending'})
  })

  it('reads the checks of each head, not of main or of another PR', async () => {
    const w = world({prs: [pr(1), pr(2)]})
    await LIVE(w)
    expect(w.named('listRuns').map(call => call.params.ref)).toEqual([sha(1), sha(2)])
  })

  it('reads every page of runs and statuses', async () => {
    const noise = Array.from({length: 100}, (_, index) => ({id: 1000 + index, name: `Other ${String(index)}`}))
    const w = world({prs: [pr(1, {runs: [...noise, ...GREEN_RUNS.map((run, index) => ({...run, id: index + 1}))]})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
    expect(w.named('listRuns').map(call => call.params.page)).toEqual([1, 2])
  })

  it('fails closed on a list of runs or statuses that reaches the page cap, and judges the next PR', async () => {
    const runs = world({prs: [pr(1), pr(2)], fill: {runs: 4997}})
    const fromRuns = await LIVE(runs)
    expect(rowOf(fromRuns, 1)).toMatchObject({outcome: 'error', detail: 'a list reached the API cap'})
    expect(fromRuns.exitCode).toBe(1)

    const statuses = world({prs: [pr(1)], fill: {statuses: 4999}})
    const fromStatuses = await LIVE(statuses)
    expect(rowOf(fromStatuses, 1)).toMatchObject({outcome: 'error', detail: 'a list reached the API cap'})
  })
})

describe('sweep: the fresh read right before the approval (AE7)', () => {
  it('refuses a PR whose head moved since it was judged, and approves neither head (AE7)', async () => {
    const w = world({
      prs: [pr(1)],
      onGet: spec => {
        spec.head = sha(1, 'f')
      },
    })
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'head-moved', detail: 'the head changed before the approval'})
    expect(rowOf(result, 1).head).toBe(sha(1).slice(0, 7))
    expect(result.exitCode).toBe(0)
    expect(w.named('approve')).toEqual([])
  })

  it.each([
    [
      'the label removed',
      (spec: PrSpec) => {
        spec.labels = []
      },
    ],
    [
      'hold-merge added',
      (spec: PrSpec) => {
        spec.labels = ['automerge', 'hold-merge']
      },
    ],
    [
      'the PR closed',
      (spec: PrSpec) => {
        spec.state = 'closed'
      },
    ],
    [
      'the PR retargeted',
      (spec: PrSpec) => {
        spec.base = 'develop'
      },
    ],
    [
      'the author changed',
      (spec: PrSpec) => {
        spec.author = {id: 1, type: 'User'}
      },
    ],
    [
      'the head repository gone',
      (spec: PrSpec) => {
        spec.headRepoId = null
      },
    ],
    [
      'the branch renamed',
      (spec: PrSpec) => {
        spec.ref = 'feature/x'
      },
    ],
  ])('refuses a PR that no longer qualifies: %s', async (_name, change) => {
    const w = world({prs: [pr(1)], onGet: spec => change(spec)})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({
      outcome: 'no-longer-qualifies',
      detail: 'closed, unlabelled or held before the approval',
    })
    expect(result.exitCode).toBe(0)
    expect(w.named('approve')).toEqual([])
  })

  it('refuses a PR that has fallen behind main since, judged against the current main', async () => {
    const w = world({prs: [pr(1, {behindBy: call => (call === 1 ? 0 : 2)})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'behind'})
    expect(w.named('compare')).toHaveLength(2)
    expect(w.named('approve')).toEqual([])
  })

  it('refuses when the required list changed: a context added, removed or rebound', async () => {
    const changes = [
      protectionOf(checksFor([...DECLARED, 'Extra'])),
      protectionOf(checksFor(DECLARED).map(check => (check.context === 'Lint' ? {...check, app_id: 1} : check))),
    ]
    for (const changed of changes) {
      const w = world({
        prs: [pr(1, {runs: [...GREEN_RUNS, {name: 'Extra'}]})],
        protection: call => (call === 1 ? protectionOf(checksFor(DECLARED)) : changed),
      })
      const result = await LIVE(w)
      expect(rowOf(result, 1)).toMatchObject({
        outcome: 'protection-changed',
        detail: 'the required checks for main changed before the approval',
      })
      expect(result.exitCode).toBe(0)
      expect(w.named('approve')).toEqual([])
    }
  })

  it('accepts the same list in another order', async () => {
    const w = world({
      prs: [pr(1)],
      protection: call => protectionOf(call === 1 ? checksFor(DECLARED) : checksFor([...DECLARED].reverse())),
    })
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
  })

  it.each([
    ['unreadable', () => apiError(403)],
    ['empty', () => protectionOf([])],
    ['short', () => protectionOf(checksFor(['Lint']))],
  ])('ends as an error, exit 1, when the required list is %s at the fresh read', async (_name, later) => {
    const w = world({prs: [pr(1)], protection: call => (call === 1 ? protectionOf(checksFor(DECLARED)) : later())})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'error', detail: 'the required checks for main could not be read'})
    expect(result.exitCode).toBe(1)
    expect(w.named('approve')).toEqual([])
  })

  it('uses the armed state from the fresh read for the report and the outcome', async () => {
    const w = world({
      prs: [pr(1, {armed: false})],
      onGet: spec => {
        spec.armed = true
      },
    })
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'approved', armed: true})

    const reverse = world({
      prs: [pr(1, {armed: true})],
      onGet: spec => {
        spec.armed = false
      },
    })
    expect(rowOf(await LIVE(reverse), 1)).toMatchObject({outcome: 'approved-not-armed', armed: false})
  })

  it('shows the armed state of the PR as listed for a PR that stops earlier', async () => {
    const w = world({prs: [pr(1, {armed: false, behindBy: 1}), pr(2, {armed: true, behindBy: 1})]})
    const result = await LIVE(w)
    expect(result.rows.map(row => row.armed)).toEqual([false, true])
  })

  it('approves without armed auto-merge, and says so (approved-not-armed)', async () => {
    const w = world({prs: [pr(1, {armed: false})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toEqual({
      number: 1,
      head: sha(1).slice(0, 7),
      outcome: 'approved-not-armed',
      detail: 'approved; auto-merge is not armed, merge it by hand',
      armed: false,
    })
    expect(w.named('approve')).toHaveLength(1)
    expect(result.exitCode).toBe(0)
  })
})

describe('sweep: reads that fail or reach a cap are errors for that PR only (AE: fail closed)', () => {
  it('turns a commit list at the 250-commit API cap into an error for that PR', async () => {
    const w = world({prs: [pr(1, {commits: Array.from({length: 250}, () => ({}))}), pr(2)]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'error', detail: 'a list reached the API cap'})
    expect(rowOf(result, 2).outcome).toBe('approved')
    expect(result.exitCode).toBe(1)
    expect(
      w
        .named('listCommits')
        .filter(call => call.params.pull_number === 1)
        .map(call => call.params.page),
    ).toEqual([1, 2, 3])
  })

  it('accepts 249 commits', async () => {
    const w = world({prs: [pr(1, {commits: Array.from({length: 249}, () => ({}))})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
  })

  it('turns a file list at the 3000-file API cap into an error for that PR', async () => {
    const files = Array.from({length: 3000}, (_, index) => ({filename: `src/f${String(index)}.ts`}))
    const w = world({prs: [pr(1, {files})]})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'error', detail: 'a list reached the API cap'})
    expect(result.exitCode).toBe(1)
    expect(w.named('listFiles')).toHaveLength(30)
    expect(w.named('compare')).toEqual([])
  })

  it('accepts 2999 files', async () => {
    const files = Array.from({length: 2999}, (_, index) => ({filename: `src/f${String(index)}.ts`}))
    const w = world({prs: [pr(1, {files})]})
    expect(outcomes(await LIVE(w))).toEqual({1: 'approved'})
  })

  it('turns a review list at its cap into an error for that PR', async () => {
    const w = world({prs: [pr(1, {reviews: [{login: 'x', state: 'COMMENTED'}]})], fill: {reviews: 4999}})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'error', detail: 'a list reached the API cap'})
    expect(w.named('approve')).toEqual([])
  })

  it.each([
    ['listCommits', 500],
    ['listFiles', 403],
    ['listRuns', 404],
    ['listStatuses', 404],
    ['listReviews', 403],
    ['get', 404],
  ])('turns a failed %s read (%i) into an error for that PR and judges the others', async (name, status) => {
    const w = world({
      prs: [pr(1), pr(2)],
      failRead: (read, number) => (read === name && number === 1 ? apiError(status) : undefined),
    })
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({outcome: 'error', detail: 'a GitHub read failed'})
    expect(rowOf(result, 2).outcome).toBe('approved')
    expect(result.exitCode).toBe(1)
    expect(w.named('approve').map(call => call.params.pull_number)).toEqual([2])
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('retries a transient failure of a PR read and carries on', async () => {
    const w = world({
      prs: [pr(1)],
      failRead: (name, _number, call) => (name === 'listFiles' && call === 1 ? apiError(502) : undefined),
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved'})
    expect(w.sleeps).toEqual([2000])
  })

  it('gives up on a read that keeps failing: 2 s then 4 s, three attempts', async () => {
    const w = world({prs: [pr(1)], failRead: name => (name === 'listCommits' ? apiError(503) : undefined)})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'error'})
    expect(w.sleeps).toEqual([2000, 4000])
    expect(w.named('listCommits')).toHaveLength(3)
  })

  it('does not retry a 4xx read', async () => {
    const w = world({prs: [pr(1)], failRead: name => (name === 'listCommits' ? apiError(422) : undefined)})
    await LIVE(w)
    expect(w.named('listCommits')).toHaveLength(1)
    expect(w.sleeps).toEqual([])
  })
})

describe('sweep: the required list gates the whole sweep', () => {
  it.each([
    ['unreadable', () => apiError(403), 'REQUIRED_UNREADABLE'],
    ['empty', () => protectionOf([]), 'REQUIRED_EMPTY'],
    ['short', () => protectionOf(checksFor(['Lint'])), 'REQUIRED_SHORT'],
  ])('judges no PR and exits 1 when the list is %s', async (_name, answer, stop) => {
    const w = world({prs: [pr(1)], protection: answer})
    const result = await LIVE(w)
    expect(result).toEqual({exitCode: 1, live: true, stop, rows: []})
    expect(w.order()).toEqual(['getBranch'])
  })

  it('stops before any request when no contexts are declared', async () => {
    const w = world({prs: [pr(1)]})
    const result = await sweep(w.input({declaredContexts: []}))
    expect(result).toEqual({exitCode: 1, live: true, stop: 'NO_DECLARED_CONTEXTS', rows: []})
    expect(w.calls).toEqual([])
  })

  it('reports the mode in a stopped dry run too', async () => {
    const w = world({prs: [pr(1)], protection: () => protectionOf([])})
    expect((await DRY(w)).live).toBe(false)
  })

  it('exits 1 with CANDIDATES_UNREADABLE when the PR list cannot be read, and judges nothing', async () => {
    const w = world({prs: [pr(1)], listError: () => apiError(500)})
    const result = await LIVE(w)
    expect(result).toEqual({exitCode: 1, live: true, stop: 'CANDIDATES_UNREADABLE', rows: []})
    expect(w.named('list')).toHaveLength(3)
  })

  it('exits 1 with CANDIDATES_UNREADABLE when the list fails on a later page', async () => {
    const many = Array.from({length: 100}, (_, index) => pr(100 + index, {ref: 'feature/x'}))
    const w = world({prs: [...many, pr(300)], listError: page => (page === 2 ? apiError(403) : undefined)})
    const result = await LIVE(w)
    expect(result.stop).toBe('CANDIDATES_UNREADABLE')
    expect(result.rows).toEqual([])
  })

  it('exits 1 with CANDIDATES_UNREADABLE when the PR list reaches its page cap', async () => {
    const w = world({prs: [pr(1)], listPageSize: () => 100})
    const result = await LIVE(w)
    expect(result).toEqual({exitCode: 1, live: true, stop: 'CANDIDATES_UNREADABLE', rows: []})
    expect(w.named('list')).toHaveLength(50)
  })

  it('accepts a PR list that ends on its last allowed page', async () => {
    const w = world({prs: [pr(1)], listPageSize: page => (page < 50 ? 100 : 99)})
    const result = await LIVE(w)
    expect(result.stop).toBeNull()
    expect(w.named('list')).toHaveLength(50)
  })
})

describe('sweep: a review request that fails or is cut off', () => {
  it('finds the approval GitHub recorded before a server error and does not send a second review', async () => {
    const w = world({prs: [pr(1), pr(2)], approve: () => ({recordedThen: apiError(502)})})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved', 2: 'deferred'})
    expect(w.named('approve')).toHaveLength(1)
    expect(result.exitCode).toBe(0)
  })

  it('reads the reviews once after a failed request and reports approval-unknown when none is there (exit 1)', async () => {
    const w = world({prs: [pr(1), pr(2)], approve: () => apiError(500)})
    const result = await LIVE(w)
    expect(rowOf(result, 1)).toMatchObject({
      outcome: 'approval-unknown',
      detail: 'the approval failed or was cut off and no approval was found; check the reviews',
    })
    expect(rowOf(result, 2).outcome).toBe('deferred')
    expect(result.exitCode).toBe(1)
    expect(w.named('approve')).toHaveLength(1)
    // judging read the reviews once; the reconcile read them again
    expect(w.named('listReviews').filter(call => call.params.pull_number === 1)).toHaveLength(2)
  })

  it.each([
    ['a 422', apiError(422)],
    ['a 403', apiError(403)],
    ['an error with no status', new Error('socket hang up')],
  ])('also reads the reviews after %s', async (_name, error) => {
    const w = world({prs: [pr(1)], approve: () => error})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approval-unknown'})
    expect(w.named('listReviews')).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('finds the recorded approval after a request that was cut off in flight', async () => {
    const w = world({prs: [pr(1)], approve: () => ({recordedThen: 'hang'})})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved'})
  })

  it('reports approval-unknown after a cut-off request with no approval recorded', async () => {
    const w = world({prs: [pr(1), pr(2)], approve: () => 'hang'})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approval-unknown', 2: 'deferred'})
    expect(result.exitCode).toBe(1)
  })

  it('reports approval-unknown when the reconcile read fails', async () => {
    const w = world({
      prs: [pr(1)],
      approve: () => apiError(500),
      reviewsError: call => (call >= 2 ? apiError(500) : undefined),
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approval-unknown'})
    expect(result.exitCode).toBe(1)
    // no retry of the reconcile read
    expect(w.named('listReviews')).toHaveLength(2)
  })

  it('finds the approval on a later page of the reconcile read', async () => {
    const filler = Array.from({length: 100}, () => ({login: 'x', state: 'COMMENTED'}))
    const w = world({prs: [pr(1, {reviews: filler})], approve: () => ({recordedThen: apiError(500)})})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved'})
    expect(w.named('listReviews').map(call => call.params.page)).toEqual([1, 2, 1, 2])
  })

  it('reports approval-unknown when the reconcile list reaches its cap without the approval', async () => {
    const w = world({
      prs: [pr(1, {reviews: [{login: 'x', state: 'COMMENTED'}]})],
      approve: () => apiError(500),
      reviewsFill: call => (call >= 2 ? 4999 : 0),
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approval-unknown'})
    expect(w.named('listReviews').filter(call => call.params.page === 50)).toHaveLength(1)
  })

  it('gives the reconcile read a signal of its own, outside the budget', async () => {
    const w = world({prs: [pr(1)], approve: () => apiError(500), cost: 1000})
    await LIVE(w)
    const reviews = w.named('listReviews')
    expect(reviews.at(-1)?.signalMs).toBe(2 * MINUTE)
  })

  it('still reconciles when the budget is spent by the approval request itself', async () => {
    const w = world({
      prs: [pr(1)],
      approve: () => ({recordedThen: 'hang'}),
      cost: (name, call) => (name === 'approve' && call === 1 ? BUDGET : 0),
    })
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'approved'})
  })
})

describe('sweep: one budget for every request', () => {
  it('gives each request a signal sized to what is left, from ten minutes down', async () => {
    const w = world({prs: [pr(1)], cost: 1000})
    await LIVE(w)
    const sizes = w.calls.map(call => call.signalMs)
    expect(sizes[0]).toBe(BUDGET)
    expect(sizes[1]).toBe(BUDGET - 1000)
    expect(sizes.every((size, index) => size === BUDGET - index * 1000)).toBe(true)
  })

  it('exits 1 with TIMEOUT when the budget is spent before the required list is read', async () => {
    const w = world({prs: [pr(1)], cost: BUDGET + 1})
    const result = await LIVE(w)
    expect(result).toEqual({exitCode: 1, live: true, stop: 'TIMEOUT', rows: []})
    expect(w.order()).toEqual(['getBranch'])
  })

  it('exits 1 with TIMEOUT when the PR list is cut off', async () => {
    const w = world({prs: [pr(1)], hang: name => name === 'list'})
    const result = await LIVE(w)
    expect(result.stop).toBe('TIMEOUT')
    expect(result.exitCode).toBe(1)
  })

  it('exits 1 with TIMEOUT when the required list read is cut off', async () => {
    const w = world({prs: [pr(1)], hang: name => name === 'getBranch'})
    const result = await LIVE(w)
    expect(result.stop).toBe('TIMEOUT')
  })

  it('turns every remaining candidate into an error when the budget runs out mid-sweep', async () => {
    const w = world({
      prs: [pr(1), pr(2), pr(3)],
      cost: (name, call) => (name === 'listCommits' && call === 2 ? BUDGET : 0),
    })
    const result = await LIVE(w)
    expect(result.exitCode).toBe(1)
    expect(result.stop).toBeNull()
    expect(outcomes(result)).toEqual({1: 'approved', 2: 'error', 3: 'error'})
    expect(rowOf(result, 2).detail).toBe('the sweep ran out of time')
    expect(rowOf(result, 3).detail).toBe('the sweep ran out of time')
    expect(w.named('listCommits')).toHaveLength(2)
    expect(w.named('approve')).toHaveLength(1)
  })

  it('turns a request that is cut off in flight into the same error, without a retry', async () => {
    const w = world({prs: [pr(1), pr(2)], hang: (name, call) => name === 'listFiles' && call === 1})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'error', 2: 'error'})
    expect(rowOf(result, 1).detail).toBe('the sweep ran out of time')
    expect(w.named('listFiles')).toHaveLength(1)
    expect(w.sleeps).toEqual([])
  })

  it('sends no request once the budget has run out', async () => {
    const w = world({prs: [pr(1), pr(2)], cost: (name, call) => (name === 'listStatuses' && call === 1 ? BUDGET : 0)})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'error', 2: 'error'})
    expect(w.named('listStatuses')).toHaveLength(1)
    expect(w.named('listCommits')).toHaveLength(1)
  })

  it('does not approve when the budget ran out before the review request', async () => {
    const w = world({prs: [pr(1)], cost: (name, call) => (name === 'getVariable' && call === 1 ? BUDGET : 0)})
    const result = await LIVE(w)
    expect(outcomes(result)).toEqual({1: 'error'})
    expect(w.named('approve')).toEqual([])
  })

  it('maps an unexpected thrown value outside the PRs to API_FAILED', async () => {
    const w = world({prs: [pr(1)]})
    const broken = {
      ...w.input(),
      octokit: {
        rest: {
          ...(w.octokit.rest as object),
          repos: {...(w.octokit.rest.repos as object), getBranch: async () => ({data: null})},
        },
      } as unknown as ApproveOctokit,
    }
    const result = await sweep(broken)
    expect(result).toEqual({exitCode: 1, live: true, stop: 'API_FAILED', rows: []})
  })
})

describe('sweep: the report never carries response text', () => {
  it('leaves titles, branch names, labels, logins and error bodies out of every row', async () => {
    const w = world({
      prs: [
        pr(1, {title: 'SECRET-TITLE', ref: 'renovate/SECRET-BRANCH'}),
        pr(2, {
          title: 'SECRET-TITLE-2',
          ref: 'renovate/SECRET-BRANCH-2',
          commits: [{author: {id: 1, type: 'User', login: 'SECRET-LOGIN'}}],
        }),
      ],
      failRead: name => (name === 'get' ? apiError(500, 'SECRET-BODY') : undefined),
    })
    const result = await LIVE(w)
    const text = JSON.stringify(result) + summaryOf(result)
    for (const secret of ['SECRET-TITLE', 'SECRET-BRANCH', 'SECRET-LOGIN', 'SECRET-BODY']) {
      expect(text).not.toContain(secret)
    }
  })

  it('shows the head as seven characters of a real commit id, and `unknown` for anything else', async () => {
    const w = world({
      prs: [
        pr(1, {head: 'not-a-sha', behindBy: 1}),
        pr(2, {head: `${'0123456789abcdef'.repeat(2)}01234567`, behindBy: 1}),
        pr(3, {head: 'A'.repeat(40), behindBy: 1}),
      ],
    })
    const result = await LIVE(w)
    expect(result.rows.map(row => row.head)).toEqual(['unknown', '0123456', 'unknown'])
  })

  it('shows `unknown` for a head with a real id plus something before or after it', async () => {
    const real = '0123456789abcdef0123456789abcdef01234567'
    const w = world({
      prs: [
        pr(1, {head: `${real}0`, behindBy: 1}),
        pr(2, {head: `x${real}`, behindBy: 1}),
        pr(3, {head: real, behindBy: 1}),
      ],
    })
    const result = await LIVE(w)
    expect(result.rows.map(row => row.head)).toEqual(['unknown', 'unknown', '0123456'])
  })
})

describe('summaryOf', () => {
  const row = (number: number, outcome: OutcomeCode, detail: string, armed: boolean): Row => ({
    number,
    head: 'abc1234',
    outcome,
    detail,
    armed,
  })

  it('renders one table with a row per candidate', () => {
    const result: SweepResult = {
      exitCode: 0,
      live: true,
      stop: null,
      rows: [
        row(3, 'approved', 'approved on this head', true),
        row(9, 'deferred', 'ready; another PR was approved in this sweep', false),
      ],
    }
    expect(summaryOf(result)).toBe(
      [
        '### Renovate approve (live)',
        '',
        '| PR | Head | Outcome | Detail | Auto-merge armed |',
        '| --- | --- | --- | --- | --- |',
        '| #3 | abc1234 | approved | approved on this head | yes |',
        '| #9 | abc1234 | deferred | ready; another PR was approved in this sweep | no |',
        '',
      ].join('\n'),
    )
  })

  it('names the dry run', () => {
    const result: SweepResult = {
      exitCode: 0,
      live: false,
      stop: null,
      rows: [row(3, 'would-approve', 'dry run: RENOVATE_APPROVE is not on', true)],
    }
    expect(summaryOf(result).split('\n')[0]).toBe('### Renovate approve (dry run)')
  })

  it('says so when no PR is a candidate', () => {
    expect(summaryOf({exitCode: 0, live: true, stop: null, rows: []})).toBe(
      ['### Renovate approve (live)', '', 'No open Renovate PR carries `automerge`.', ''].join('\n'),
    )
  })

  it.each([
    [
      'NO_DECLARED_CONTEXTS',
      'No required contexts are declared for `main` in `.github/settings.yml`, so the live list cannot be compared. Nothing was approved.',
    ],
    [
      'REQUIRED_UNREADABLE',
      'The branch protection of `main` could not be read, so the required checks are unknown. Nothing was approved.',
    ],
    ['REQUIRED_EMPTY', 'The live required-check list for `main` is empty, so no PR was judged. Nothing was approved.'],
    [
      'REQUIRED_SHORT',
      'The live required-check list for `main` is missing declared contexts, so no PR was judged. Nothing was approved.',
    ],
    [
      'CANDIDATES_UNREADABLE',
      'The open pull requests could not be listed to the end, so no PR was judged. Nothing was approved.',
    ],
    ['TIMEOUT', 'The sweep ran out of time before it could judge the pull requests. Nothing further was done.'],
    ['API_FAILED', 'A GitHub API call failed, so the sweep stopped. Nothing further was done.'],
  ] as const)('explains a stop: %s', (stop: StopCode, text) => {
    expect(summaryOf({exitCode: 1, live: true, stop, rows: []})).toBe(
      ['### Renovate approve (live)', '', text, ''].join('\n'),
    )
  })
})

function runParams(overrides: Partial<RunApproveParams> = {}, w = world({prs: [pr(7)]})) {
  const out: string[] = []
  const err: string[] = []
  const appended: {path: string; content: string}[] = []
  const params: RunApproveParams = {
    env: {
      GH_TOKEN: 'token',
      GITHUB_REPOSITORY: 'fro-bot/.github',
      RENOVATE_APPROVE: 'on',
      GITHUB_STEP_SUMMARY: '/tmp/summary',
    },
    readSettings: () =>
      `branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts:\n${DECLARED.map(context => `          - '${context}'`).join('\n')}\n`,
    createClient: async () => w.octokit,
    now: () => w.clock.now,
    sleep: async ms => {
      w.clock.now += ms
    },
    signal: ms => AbortSignal.timeout(ms + 1_000_000_000),
    stdout: text => out.push(text),
    stderr: text => err.push(text),
    append: (path, content) => appended.push({path, content}),
    ...overrides,
  }
  return {params, out, err, appended, w}
}

describe('runApprove', () => {
  it('maps the env to a sweep, writes the report as the job summary and exits 0', async () => {
    const t = runParams()
    expect(await runApprove(t.params)).toBe(0)

    expect(t.out).toEqual(['renovate-approve: #7 approved\n'])
    expect(t.err).toEqual([])
    expect(t.appended).toEqual([
      {
        path: '/tmp/summary',
        content: [
          '### Renovate approve (live)',
          '',
          '| PR | Head | Outcome | Detail | Auto-merge armed |',
          '| --- | --- | --- | --- | --- |',
          `| #7 | ${sha(7).slice(0, 7)} | approved | approved on this head | yes |`,
          '',
        ].join('\n'),
      },
    ])
    expect(t.w.named('approve')).toHaveLength(1)
    expect(t.w.named('getBranch')[0]?.params).toMatchObject({owner: 'fro-bot', repo: '.github'})
  })

  it('takes the owner and repository from GITHUB_REPOSITORY', async () => {
    const t = runParams({env: {GH_TOKEN: 't', GITHUB_REPOSITORY: 'some-org/some.repo-name_1', RENOVATE_APPROVE: 'on'}})
    await runApprove(t.params)
    expect(t.w.named('getBranch')[0]?.params).toMatchObject({owner: 'some-org', repo: 'some.repo-name_1'})
  })

  it('is a dry run unless RENOVATE_APPROVE is exactly `on`, and the summary says so', async () => {
    const t = runParams({env: {GH_TOKEN: 't', GITHUB_REPOSITORY: 'fro-bot/.github', GITHUB_STEP_SUMMARY: '/tmp/s'}})
    expect(await runApprove(t.params)).toBe(0)
    expect(t.out).toEqual(['renovate-approve: #7 would-approve\n'])
    expect(t.appended[0]?.content.startsWith('### Renovate approve (dry run)\n')).toBe(true)
    expect(t.w.named('approve')).toEqual([])
  })

  it('writes a line per candidate and nothing else to stdout', async () => {
    const t = runParams({}, world({prs: [pr(7), pr(9)]}))
    await runApprove(t.params)
    expect(t.out).toEqual(['renovate-approve: #7 approved\n', 'renovate-approve: #9 deferred\n'])
  })

  it('exits 1 with a fixed CANDIDATE_ERROR line when a candidate ended in error', async () => {
    const t = runParams(
      {},
      world({prs: [pr(7)], failRead: name => (name === 'listFiles' ? apiError(404, 'SECRET') : undefined)}),
    )
    expect(await runApprove(t.params)).toBe(1)
    expect(t.err).toEqual(['::error::renovate-approve: CANDIDATE_ERROR\n'])
    expect(t.out).toEqual(['renovate-approve: #7 error\n'])
    expect(JSON.stringify([t.err, t.out, t.appended])).not.toContain('SECRET')
  })

  it('exits 1 on approval-unknown with the same fixed line', async () => {
    const t = runParams({}, world({prs: [pr(7)], approve: () => apiError(500)}))
    expect(await runApprove(t.params)).toBe(1)
    expect(t.err).toEqual(['::error::renovate-approve: CANDIDATE_ERROR\n'])
  })

  it.each([
    ['REQUIRED_UNREADABLE', () => apiError(403)],
    ['REQUIRED_EMPTY', () => protectionOf([])],
    ['REQUIRED_SHORT', () => protectionOf(checksFor(['Lint']))],
  ])('exits 1 with the %s code and a summary when the list cannot be trusted', async (code, protection) => {
    const t = runParams({}, world({prs: [pr(7)], protection}))
    expect(await runApprove(t.params)).toBe(1)
    expect(t.err).toEqual([`::error::renovate-approve: ${code}\n`])
    expect(t.out).toEqual([])
    expect(t.appended).toHaveLength(1)
  })

  it('writes the summary of a stop through the runner file only', async () => {
    const t = runParams(
      {env: {GH_TOKEN: 't', GITHUB_REPOSITORY: 'fro-bot/.github', RENOVATE_APPROVE: 'on'}},
      world({prs: [pr(7)], protection: () => protectionOf([])}),
    )
    expect(await runApprove(t.params)).toBe(1)
    expect(t.appended).toEqual([])
  })

  it.each([undefined, ''])('fails closed with MISSING_TOKEN when GH_TOKEN is %j and reads nothing', async token => {
    const t = runParams({
      env: {
        GH_TOKEN: token,
        GITHUB_REPOSITORY: 'fro-bot/.github',
        RENOVATE_APPROVE: 'on',
        GITHUB_STEP_SUMMARY: '/tmp/s',
      },
    })
    expect(await runApprove(t.params)).toBe(1)
    expect(t.err).toEqual(['::error::renovate-approve: MISSING_TOKEN\n'])
    expect(t.w.calls).toEqual([])
    expect(t.appended[0]?.content).toBe(
      "### Renovate approve (live)\n\nThe step has no `FRO_BOT_PAT`, so it cannot read the pull requests or approve. Check the repository secret and the step's env.\n",
    )
  })

  it('names the dry run in the summary of a failure before the sweep starts', async () => {
    const t = runParams({
      env: {GH_TOKEN: undefined, GITHUB_REPOSITORY: 'fro-bot/.github', GITHUB_STEP_SUMMARY: '/tmp/s'},
    })
    expect(await runApprove(t.params)).toBe(1)
    expect(t.appended[0]?.content.startsWith('### Renovate approve (dry run)\n\n')).toBe(true)
  })

  it.each([undefined, '', 'fro-bot', 'fro-bot/', '/repo', 'a/b/c', 'a b/c', 'a/b c'])(
    'fails with INVALID_REPOSITORY when GITHUB_REPOSITORY is %j',
    async repository => {
      const t = runParams({env: {GH_TOKEN: 't', GITHUB_REPOSITORY: repository, GITHUB_STEP_SUMMARY: '/tmp/s'}})
      expect(await runApprove(t.params)).toBe(1)
      expect(t.err).toEqual(['::error::renovate-approve: INVALID_REPOSITORY\n'])
      expect(t.appended[0]?.content).toBe(
        '### Renovate approve (dry run)\n\n`GITHUB_REPOSITORY` is not `owner/name`, so the sweep stopped before it read anything.\n',
      )
      expect(t.w.calls).toEqual([])
    },
  )

  it('fails with SETTINGS_UNREADABLE when the settings cannot be read or parsed', async () => {
    for (const readSettings of [
      () => {
        throw new Error('ENOENT secret path')
      },
      () => 'a: [unclosed',
    ]) {
      const t = runParams({readSettings})
      expect(await runApprove(t.params)).toBe(1)
      expect(t.err).toEqual(['::error::renovate-approve: SETTINGS_UNREADABLE\n'])
      expect(t.appended[0]?.content).toBe(
        '### Renovate approve (live)\n\n`.github/settings.yml` could not be read or parsed, so the declared checks are unknown. Check the file on `main`.\n',
      )
      expect(JSON.stringify(t.appended)).not.toContain('secret')
      expect(t.w.calls).toEqual([])
    }
  })

  it('stops with NO_DECLARED_CONTEXTS when the settings declare none', async () => {
    const t = runParams({readSettings: () => 'branches: []\n'})
    expect(await runApprove(t.params)).toBe(1)
    expect(t.err).toEqual(['::error::renovate-approve: NO_DECLARED_CONTEXTS\n'])
    expect(t.w.calls).toEqual([])
  })

  it('fails with API_FAILED when the client cannot be created, and never echoes the cause', async () => {
    const t = runParams({
      createClient: async () => {
        throw new Error('bad credentials SECRET')
      },
    })
    expect(await runApprove(t.params)).toBe(1)
    expect(t.err).toEqual(['::error::renovate-approve: API_FAILED\n'])
    expect(t.appended[0]?.content).toBe(
      '### Renovate approve (live)\n\nThe GitHub client could not be created, so the sweep stopped before it read anything. Check the token.\n',
    )
    expect(JSON.stringify([t.err, t.out, t.appended])).not.toContain('SECRET')
  })

  it('passes the token to the client factory and nothing else', async () => {
    const tokens: string[] = []
    const w = world({prs: [pr(7)]})
    const t = runParams(
      {
        createClient: async token => {
          tokens.push(token)
          return w.octokit
        },
      },
      w,
    )
    await runApprove(t.params)
    expect(tokens).toEqual(['token'])
  })

  it('uses the injected clock, sleep and signal', async () => {
    const w = world({
      prs: [pr(7)],
      failRead: (name, _n, call) => (name === 'listCommits' && call === 1 ? apiError(503) : undefined),
    })
    const slept: number[] = []
    const sized: number[] = []
    const t = runParams(
      {
        sleep: async ms => {
          slept.push(ms)
        },
        signal: ms => {
          sized.push(ms)
          return AbortSignal.timeout(1_000_000_000)
        },
      },
      w,
    )
    expect(await runApprove(t.params)).toBe(0)
    expect(slept).toEqual([2000])
    expect(sized[0]).toBe(BUDGET)
  })

  it('does not throw when GITHUB_STEP_SUMMARY is unset', async () => {
    const t = runParams({env: {GH_TOKEN: 't', GITHUB_REPOSITORY: 'fro-bot/.github', RENOVATE_APPROVE: 'on'}})
    expect(await runApprove(t.params)).toBe(0)
    expect(t.appended).toEqual([])
  })
})
