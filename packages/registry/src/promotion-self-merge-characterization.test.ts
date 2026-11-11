/**
 * Characterization of the required-check readers, pinned through the promotion step's own entry point
 * (`selfMerge`) with scripted fake responses. It records every request in order, with the size of the
 * abort signal it carried, and the outcome. It was written against the readers while they were closures
 * inside `promote`, and it must stay green, unedited in meaning, after they move to `required-checks.ts`:
 * a different request, a different order, a different signal or a different outcome is a behaviour change.
 */

import {describe, expect, it} from 'vitest'
import {selfMerge, type SelfMergeInput, type SelfMergeOctokit} from './promotion-self-merge.ts'

const PIN = 'a'.repeat(40)
const DECLARED = ['Lint', 'Test', 'CodeQL'] as const
const WAIT_MS = 60 * 60 * 1000
const RESERVE_MS = 10 * 60 * 1000
const MINUTE = 60_000

interface Call {
  readonly name: string
  readonly params: Record<string, unknown>
  /** Size in ms of the abort signal the request carried; `undefined` when it carried none. */
  readonly signalMs: number | undefined
}

interface RunRow {
  readonly id: number
  readonly name: string
  readonly status?: string
  readonly conclusion?: string | null
  readonly app?: number | null
}

interface StatusRow {
  readonly context: string
  readonly state: string
}

interface CheckRow {
  readonly context: string
  readonly app_id?: number | null
}

interface Scenario {
  /** What `getBranch` does on its n-th call (1-based); an Error is thrown, `'hang'` stalls until the signal fires. */
  readonly branch?: (
    call: number,
  ) => {checks?: readonly CheckRow[]} | 'no-protection' | 'no-checks-key' | Error | 'hang'
  /** Check runs for a page on a poll (both 1-based); an Error is thrown, `'hang'` stalls. */
  readonly runs?: (poll: number, page: number, call: number) => readonly RunRow[] | Error | 'hang'
  readonly statuses?: (poll: number, page: number, call: number) => readonly StatusRow[] | Error | 'hang'
  /** Milliseconds each request takes on the fake clock. */
  readonly cost?: number
}

class ApiStatusError extends Error {
  readonly status: number

  constructor(status: number, message = 'upstream body with a secret') {
    super(message)
    this.status = status
  }
}

const GREEN_ROWS: readonly RunRow[] = [
  {id: 1, name: 'Lint', app: 15_368},
  {id: 2, name: 'Test', app: 15_368},
  {id: 3, name: 'CodeQL', app: 57_789},
]

function liveChecks(contexts: readonly string[] = DECLARED): readonly CheckRow[] {
  return contexts.map(context => ({context, app_id: context === 'CodeQL' ? 57_789 : 15_368}))
}

const PROTECTED = [...DECLARED, 'Security: Private Leak Scan']

function protectedChecks(): readonly CheckRow[] {
  return [...liveChecks(DECLARED), {context: 'Security: Private Leak Scan', app_id: null}]
}

function world(scenario: Scenario = {}) {
  const clock = {now: 1_000_000}
  const calls: Call[] = []
  const sleeps: number[] = []
  const counts: Record<string, number> = {}
  const sizes = new Map<AbortSignal, number>()
  const controllers = new Map<AbortSignal, AbortController>()
  let polls = 0

  const record = (name: string, params: unknown): number => {
    const {request, ...rest} = params as {request?: {signal?: AbortSignal}}
    calls.push({name, params: rest, signalMs: request?.signal === undefined ? undefined : sizes.get(request.signal)})
    counts[name] = (counts[name] ?? 0) + 1
    clock.now += scenario.cost ?? 0
    return counts[name]
  }
  const stall = async (params: unknown): Promise<never> =>
    new Promise<never>((_resolve, reject) => {
      const signal = (params as {request?: {signal?: AbortSignal}}).request?.signal
      setTimeout(() => {
        if (signal !== undefined) controllers.get(signal)?.abort()
        reject(new ApiStatusError(500, 'The operation was aborted'))
      }, 0)
    })

  const octokit = {
    rest: {
      repos: {
        getBranch: async (params: unknown) => {
          const call = record('getBranch', params)
          const answer = scenario.branch?.(call) ?? {checks: liveChecks()}
          if (answer === 'hang') return stall(params)
          if (answer instanceof Error) throw answer
          if (answer === 'no-protection') return {data: {}}
          if (answer === 'no-checks-key') return {data: {protection: {required_status_checks: {}}}}
          return {data: {protection: {required_status_checks: {checks: answer.checks}}}}
        },
        listCommitStatusesForRef: async (params: {page: number}) => {
          const call = record('listStatuses', params)
          const answer = (scenario.statuses ?? (() => [{context: 'Security: Private Leak Scan', state: 'success'}]))(
            polls,
            params.page,
            call,
          )
          if (answer === 'hang') return stall(params)
          if (answer instanceof Error) throw answer
          return {data: answer}
        },
      },
      checks: {
        listForRef: async (params: {page: number}) => {
          const call = record('listRuns', params)
          if (params.page === 1) polls += 1
          const answer = (scenario.runs ?? (() => GREEN_ROWS))(polls, params.page, call)
          if (answer === 'hang') return stall(params)
          if (answer instanceof Error) throw answer
          return {
            data: {
              check_runs: answer.map(run => ({
                id: run.id,
                name: run.name,
                status: run.status ?? 'completed',
                conclusion: run.conclusion === undefined ? 'success' : run.conclusion,
                app: run.app === null ? null : {id: run.app ?? 15_368},
              })),
            },
          }
        },
      },
      pulls: {
        get: async (params: unknown) => {
          record('getPull', params)
          return {
            data: {
              state: 'open',
              merged: false,
              head: {sha: PIN},
              labels: [{name: 'automerge'}],
              mergeable_state: 'clean',
            },
          }
        },
        listReviews: async (params: unknown) => {
          record('listReviews', params)
          return {data: []}
        },
        createReview: async (params: unknown) => {
          record('approve', params)
          return {data: {}}
        },
        merge: async (params: unknown) => {
          record('merge', params)
          return {data: {merged: true, sha: 'c'.repeat(40)}}
        },
      },
      actions: {
        getRepoVariable: async (params: unknown) => {
          record('getVariable', params)
          return {data: {name: 'PROMOTION_SELF_MERGE', value: 'on'}}
        },
      },
    },
  } as unknown as SelfMergeOctokit

  const input = (overrides: Partial<SelfMergeInput> = {}): SelfMergeInput => ({
    octokit,
    owner: 'fro-bot',
    repo: '.github',
    pullRequest: 77,
    pin: PIN,
    qualifies: true,
    switchAtStart: 'on',
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
  return {input, calls, sleeps, clock, named, order}
}

describe('required-check readers, through selfMerge: the request transcript', () => {
  it('reads the protection, the pull request, the runs and the statuses in a fixed order with fixed signals', async () => {
    const w = world()
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.calls).toEqual([
      {name: 'getBranch', params: {owner: 'fro-bot', repo: '.github', branch: 'main'}, signalMs: WAIT_MS},
      {name: 'getPull', params: {owner: 'fro-bot', repo: '.github', pull_number: 77}, signalMs: WAIT_MS},
      {name: 'getBranch', params: {owner: 'fro-bot', repo: '.github', branch: 'main'}, signalMs: WAIT_MS},
      {
        name: 'listRuns',
        params: {owner: 'fro-bot', repo: '.github', ref: PIN, filter: 'latest', per_page: 100, page: 1},
        signalMs: WAIT_MS,
      },
      {
        name: 'listStatuses',
        params: {owner: 'fro-bot', repo: '.github', ref: PIN, per_page: 100, page: 1},
        signalMs: WAIT_MS,
      },
      {name: 'getBranch', params: {owner: 'fro-bot', repo: '.github', branch: 'main'}, signalMs: WAIT_MS + RESERVE_MS},
      {name: 'getPull', params: {owner: 'fro-bot', repo: '.github', pull_number: 77}, signalMs: WAIT_MS + RESERVE_MS},
      {
        name: 'getVariable',
        params: {owner: 'fro-bot', repo: '.github', name: 'PROMOTION_SELF_MERGE'},
        signalMs: WAIT_MS + RESERVE_MS,
      },
      {
        name: 'approve',
        params: {
          owner: 'fro-bot',
          repo: '.github',
          pull_number: 77,
          commit_id: PIN,
          event: 'APPROVE',
          body: `Approved by Merge Data Branch: ${PIN} touches only knowledge/ and metadata/ and passed the promotion gates.`,
        },
        signalMs: WAIT_MS + RESERVE_MS,
      },
      {name: 'getPull', params: {owner: 'fro-bot', repo: '.github', pull_number: 77}, signalMs: WAIT_MS + RESERVE_MS},
      {
        name: 'getVariable',
        params: {owner: 'fro-bot', repo: '.github', name: 'PROMOTION_SELF_MERGE'},
        signalMs: WAIT_MS + RESERVE_MS,
      },
      {
        name: 'merge',
        params: {owner: 'fro-bot', repo: '.github', pull_number: 77, sha: PIN, merge_method: 'squash'},
        signalMs: WAIT_MS + RESERVE_MS,
      },
    ])
    expect(w.sleeps).toEqual([])
  })

  it('repeats the protection, run and status reads on every poll while a check is pending', async () => {
    const w = world({
      runs: poll => [
        {id: 1, name: 'Lint', app: 15_368},
        {
          id: 2,
          name: 'Test',
          app: 15_368,
          status: poll < 2 ? 'in_progress' : 'completed',
          conclusion: poll < 2 ? null : 'success',
        },
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.order().slice(0, 12)).toEqual([
      'getBranch',
      'getPull',
      'getBranch',
      'listRuns',
      'listStatuses',
      'getPull',
      'getBranch',
      'listRuns',
      'listStatuses',
      'getBranch',
      'getPull',
      'getVariable',
    ])
    expect(w.sleeps).toEqual([MINUTE])
    // The second poll started a minute later, so its signal is a minute shorter.
    expect(w.named('listRuns').map(call => call.signalMs)).toEqual([WAIT_MS, WAIT_MS - MINUTE])
  })
})

describe('required-check readers, through selfMerge: paging', () => {
  it('reads check-run pages of 100 until a short page, then the statuses', async () => {
    const filler = (from: number, count: number): readonly RunRow[] =>
      Array.from({length: count}, (_, index) => ({id: from + index, name: `Other ${String(from + index)}`}))
    const w = world({
      runs: (_poll, page) => {
        if (page === 1) return filler(100, 100)
        if (page === 2) return filler(200, 100)
        return GREEN_ROWS
      },
    })
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.named('listRuns').map(call => call.params.page)).toEqual([1, 2, 3])
    expect(w.named('listStatuses').map(call => call.params.page)).toEqual([1])
  })

  it('reads an empty page after a full one, and finds a required run on an early page', async () => {
    const w = world({
      runs: (_poll, page) => {
        if (page === 1) {
          return [
            ...GREEN_ROWS,
            ...Array.from({length: 97}, (_, index) => ({id: 10 + index, name: `Other ${String(index)}`})),
          ]
        }
        return []
      },
    })
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.named('listRuns').map(call => call.params.page)).toEqual([1, 2])
  })

  it('reads status pages until a short page, and finds a required status that is only on a later page', async () => {
    const noise = Array.from({length: 100}, (_, index) => ({context: `Noise ${String(index)}`, state: 'success'}))
    const w = world({
      branch: () => ({checks: protectedChecks()}),
      statuses: (_poll, page) => (page === 1 ? noise : [{context: 'Security: Private Leak Scan', state: 'success'}]),
    })
    const outcome = await selfMerge(w.input({declaredContexts: PROTECTED}))

    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.named('listStatuses').map(call => call.params.page)).toEqual([1, 2])
  })

  it('stops at the page cap of 50 pages of runs and judges what it read', async () => {
    const full = (page: number): readonly RunRow[] =>
      Array.from({length: 100}, (_, index) => ({id: page * 1000 + index, name: `Other ${String(index)}`}))
    const w = world({runs: (_poll, page) => full(page)})
    const outcome = await selfMerge(w.input())

    // Nothing required was on any page, so the checks are pending and the wait runs out.
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(Math.max(...w.named('listRuns').map(call => Number(call.params.page)))).toBe(50)
    expect(w.named('listRuns').length % 50).toBe(0)
  })
})

describe('required-check readers, through selfMerge: judging statuses and apps', () => {
  it('takes the first status of a context as the newest: failure before success fails, success before failure passes', async () => {
    const failFirst = world({
      branch: () => ({checks: protectedChecks()}),
      statuses: () => [
        {context: 'Security: Private Leak Scan', state: 'failure'},
        {context: 'Security: Private Leak Scan', state: 'success'},
      ],
    })
    expect(await selfMerge(failFirst.input({declaredContexts: PROTECTED}))).toMatchObject({
      exitCode: 1,
      code: 'CHECK_FAILED',
    })
    expect(failFirst.order()).not.toContain('approve')

    const passFirst = world({
      branch: () => ({checks: protectedChecks()}),
      statuses: () => [
        {context: 'Security: Private Leak Scan', state: 'success'},
        {context: 'Security: Private Leak Scan', state: 'failure'},
      ],
    })
    expect(await selfMerge(passFirst.input({declaredContexts: PROTECTED}))).toMatchObject({
      exitCode: 0,
      code: 'MERGED',
    })
  })

  it('names the failed context in the summary and nothing else from the response', async () => {
    const w = world({
      branch: () => ({checks: protectedChecks()}),
      statuses: () => [{context: 'Security: Private Leak Scan', state: 'error'}],
    })
    const outcome = await selfMerge(w.input({declaredContexts: PROTECTED}))
    expect(outcome.code).toBe('CHECK_FAILED')
    expect(outcome.summary).toContain('`Security: Private Leak Scan`')
  })

  it('keeps a context waiting while its status is pending, and waits a minute between polls', async () => {
    const w = world({
      branch: () => ({checks: protectedChecks()}),
      statuses: poll => [{context: 'Security: Private Leak Scan', state: poll < 3 ? 'pending' : 'success'}],
    })
    const outcome = await selfMerge(w.input({declaredContexts: PROTECTED}))
    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.sleeps).toEqual([MINUTE, MINUTE])
  })

  it('binds a requirement to its app: another app with the same name does not count, a null app matches any', async () => {
    const bound = world({
      runs: () => [
        {id: 1, name: 'Lint', app: 999},
        {id: 2, name: 'Test', app: 15_368},
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    expect(await selfMerge(bound.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})

    const unbound = world({
      branch: () => ({checks: DECLARED.map(context => ({context, app_id: null}))}),
      runs: () => [
        {id: 1, name: 'Lint', app: 999},
        {id: 2, name: 'Test', app: null},
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    expect(await selfMerge(unbound.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
  })

  it('reads a missing app_id on a live check as unbound', async () => {
    const w = world({
      branch: () => ({checks: DECLARED.map(context => ({context}))}),
      runs: () => [
        {id: 1, name: 'Lint', app: 999},
        {id: 2, name: 'Test', app: null},
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
  })

  it('takes the highest run id as the newest run of a name', async () => {
    const w = world({
      runs: () => [
        {id: 9, name: 'Lint', app: 15_368, conclusion: 'failure'},
        {id: 10, name: 'Lint', app: 15_368, conclusion: 'success'},
        {id: 2, name: 'Test', app: 15_368},
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
  })
})

describe('required-check readers, through selfMerge: an empty, short or unreadable required list', () => {
  it('stops with PROTECTION_EMPTY (exit 1) before reading anything else when the live list is empty', async () => {
    const w = world({branch: () => ({checks: []})})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_EMPTY'})
    expect(outcome.summary).toContain('### Promotion self-merge: required checks missing')
    expect(outcome.summary).toContain('The live required-check list for `main` is empty')
    expect(w.order()).toEqual(['getBranch'])
  })

  it.each([
    ['no protection object', 'no-protection'],
    ['no checks key', 'no-checks-key'],
  ] as const)('stops with PROTECTION_EMPTY when the branch has %s', async (_name, answer) => {
    const w = world({branch: () => answer})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_EMPTY'})
    expect(w.order()).toEqual(['getBranch'])
  })

  it('stops with PROTECTION_SHORT (exit 1) naming every declared context the live list lacks', async () => {
    const w = world({branch: () => ({checks: liveChecks(['Lint'])})})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_SHORT'})
    expect(outcome.summary).toContain('missing declared contexts: `Test`, `CodeQL`.')
    expect(w.order()).toEqual(['getBranch'])
  })

  it('accepts a live list that holds more than the declared contexts', async () => {
    const w = world({
      branch: () => ({checks: liveChecks([...DECLARED, 'Extra'])}),
      runs: () => [...GREEN_ROWS, {id: 4, name: 'Extra'}],
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
  })

  it.each([401, 403, 404, 422])('gives PROTECTION_UNREADABLE (exit 1) on a %i, without a retry', async status => {
    const w = world({branch: () => new ApiStatusError(status)})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_UNREADABLE'})
    expect(outcome.summary).not.toContain('secret')
    expect(w.order()).toEqual(['getBranch'])
    expect(w.sleeps).toEqual([])
  })

  it('gives PROTECTION_UNREADABLE when a different error without a status is thrown', async () => {
    const w = world({branch: () => new Error('boom')})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_UNREADABLE'})
    expect(w.order()).toEqual(['getBranch'])
  })

  it('stops with NO_DECLARED_CONTEXTS before any request when none are declared', async () => {
    const w = world()
    expect(await selfMerge(w.input({declaredContexts: []}))).toMatchObject({exitCode: 1, code: 'NO_DECLARED_CONTEXTS'})
    expect(w.calls).toEqual([])
  })
})

describe('required-check readers, through selfMerge: transient errors', () => {
  it('retries a 503 on the protection read after two seconds', async () => {
    const w = world({branch: call => (call === 1 ? new ApiStatusError(503) : {checks: liveChecks()})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.sleeps).toEqual([2000])
    expect(
      w
        .named('getBranch')
        .slice(0, 2)
        .map(call => call.signalMs),
    ).toEqual([WAIT_MS, WAIT_MS - 2000])
  })

  it('gives up after three attempts on the protection read: 2 s then 4 s, then PROTECTION_UNREADABLE', async () => {
    const w = world({branch: () => new ApiStatusError(502)})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_UNREADABLE'})
    expect(w.order()).toEqual(['getBranch', 'getBranch', 'getBranch'])
    expect(w.sleeps).toEqual([2000, 4000])
  })

  it.each([
    ['429', new ApiStatusError(429)],
    ['500', new ApiStatusError(500)],
    ['ECONNRESET', Object.assign(new Error('reset'), {code: 'ECONNRESET'})],
    ['ETIMEDOUT', Object.assign(new Error('timed out'), {code: 'ETIMEDOUT'})],
    ['ECONNREFUSED', Object.assign(new Error('refused'), {code: 'ECONNREFUSED'})],
    ['ENOTFOUND', Object.assign(new Error('not found'), {code: 'ENOTFOUND'})],
  ])('retries a %s on a check-run read', async (_name, error) => {
    const w = world({runs: (_poll, _page, call) => (call === 1 ? error : GREEN_ROWS)})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.sleeps).toEqual([2000])
    expect(w.named('listRuns').length).toBe(2)
  })

  it('does not retry a 404 on a check-run read: the run ends as API_FAILED (exit 1) and sends no approval', async () => {
    const w = world({runs: () => new ApiStatusError(404)})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 1, code: 'API_FAILED'})
    expect(w.named('listRuns').length).toBe(1)
    expect(w.order()).not.toContain('approve')
    expect(w.sleeps).toEqual([])
  })

  it('retries a transient status read and then reads the same page again', async () => {
    const w = world({statuses: (_poll, _page, call) => (call === 1 ? new ApiStatusError(500) : [])})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.named('listStatuses').map(call => call.params.page)).toEqual([1, 1])
    expect(w.sleeps).toEqual([2000])
  })

  it('gives API_FAILED (exit 1) when a status read keeps failing', async () => {
    const w = world({statuses: () => new ApiStatusError(503)})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 1, code: 'API_FAILED'})
    expect(w.named('listStatuses').length).toBe(3)
    expect(w.sleeps).toEqual([2000, 4000])
    expect(outcome.summary).not.toContain('secret')
  })
})

describe('required-check readers, through selfMerge: a request that is cut off or late', () => {
  it('ends with TIMEOUT (exit 0, nothing approved) when the first protection read is cut off', async () => {
    const w = world({branch: () => 'hang'})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.order()).toEqual(['getBranch'])
    expect(w.sleeps).toEqual([])
  })

  it('ends with TIMEOUT, not PROTECTION_UNREADABLE, when a later protection read is cut off', async () => {
    const w = world({branch: call => (call === 1 ? {checks: liveChecks()} : 'hang')})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.order()).not.toContain('approve')
  })

  it('ends with TIMEOUT when a check-run read is cut off', async () => {
    const w = world({runs: () => 'hang'})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.order()).not.toContain('approve')
  })

  it('ends with TIMEOUT when a status read is cut off', async () => {
    const w = world({statuses: () => 'hang'})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.order()).not.toContain('approve')
  })

  it('sends no request once the wait deadline has passed', async () => {
    const w = world({cost: WAIT_MS + 1})
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.order()).toEqual(['getBranch'])
  })

  it('shortens the signal of a request by the time already spent', async () => {
    const w = world({cost: 1000})
    await selfMerge(w.input())

    expect(w.named('getBranch').map(call => call.signalMs)).toEqual([
      WAIT_MS,
      WAIT_MS - 2000,
      WAIT_MS + RESERVE_MS - 5000,
    ])
    expect(w.named('listRuns')[0]?.signalMs).toBe(WAIT_MS - 3000)
    expect(w.named('listStatuses')[0]?.signalMs).toBe(WAIT_MS - 4000)
  })
})

describe('required-check readers, through selfMerge: the required list changes under the wait', () => {
  it('starts the wait over on a changed list and reads the new list again afterwards', async () => {
    const w = world({
      branch: call => ({checks: call <= 2 ? liveChecks() : liveChecks([...DECLARED, 'Extra'])}),
      runs: () => [...GREEN_ROWS, {id: 4, name: 'Extra'}],
    })
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    // initial read; poll (same list), runs, statuses; the last read before the approval sees the new list and
    // the wait starts over: pull, live list, runs.
    expect(w.order().slice(0, 10)).toEqual([
      'getBranch',
      'getPull',
      'getBranch',
      'listRuns',
      'listStatuses',
      'getBranch',
      'getPull',
      'getBranch',
      'listRuns',
      'listStatuses',
    ])
  })

  it('treats the same contexts bound to a different app as a change', async () => {
    const w = world({
      branch: call => ({
        checks: call === 1 ? liveChecks() : [{context: 'Lint', app_id: 1}, ...liveChecks(['Test', 'CodeQL'])],
      }),
      runs: () => [{id: 1, name: 'Lint', app: 1}, ...GREEN_ROWS.slice(1)],
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.named('getBranch').length).toBeGreaterThan(3)
  })

  it('ignores the order of the live list', async () => {
    const w = world({
      branch: call => ({checks: call === 1 ? liveChecks() : [...liveChecks()].reverse()}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.named('listRuns').length).toBe(1)
  })

  it('gives PROTECTION_CHANGED (exit 0) when the list changes on every restart', async () => {
    const w = world({
      branch: call => ({checks: liveChecks([...DECLARED, `Extra ${String(call)}`])}),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'PROTECTION_CHANGED'})
    expect(w.order()).not.toContain('approve')
  })
})
