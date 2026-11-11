import {describe, expect, it} from 'vitest'
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
  statusOf,
  type CheckRunView,
  type ReadRequest,
  type RequiredCheck,
  type RequiredChecksClient,
  type StatusView,
} from './required-checks.ts'

describe('parseDeclaredContexts', () => {
  const settings = (contexts: string) =>
    `branches:\n  - name: main\n    protection:\n      required_status_checks:\n        strict: true\n        contexts:\n${contexts}\n`

  it('reads the contexts declared for main, including a quoted colon', () => {
    expect(parseDeclaredContexts(settings("          - Lint\n          - 'Security: Private Leak Scan'"))).toEqual([
      'Lint',
      'Security: Private Leak Scan',
    ])
  })

  it('reads the main branch when other branches are declared first', () => {
    const text =
      'branches:\n  - name: other\n    protection:\n      required_status_checks:\n        contexts:\n          - Nope\n  - name: main\n    protection:\n      required_status_checks:\n        contexts:\n          - Lint\n'
    expect(parseDeclaredContexts(text)).toEqual(['Lint'])
  })

  it('drops entries that are not strings, so an unquoted colon cannot pass as a context', () => {
    expect(parseDeclaredContexts(settings('          - Lint\n          - Security: Private Leak Scan'))).toEqual([
      'Lint',
    ])
  })

  it.each([
    ['no branches key', 'repository:\n  name: x\n'],
    ['branches that is not a list', 'branches: nope\n'],
    ['a list without main', 'branches:\n  - name: other\n'],
    ['main without protection', 'branches:\n  - name: main\n'],
    ['protection without status checks', 'branches:\n  - name: main\n    protection: {}\n'],
    [
      'contexts that is not a list',
      'branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts: Lint\n',
    ],
    ['a document that is not a mapping', '- a\n- b\n'],
    ['an empty document', ''],
  ])('returns an empty list for %s', (_name, text) => {
    expect(parseDeclaredContexts(text)).toEqual([])
  })

  it('throws on YAML that does not parse', () => {
    expect(() => parseDeclaredContexts('a: [unclosed')).toThrow()
  })
})

describe('statusOf and isTransient', () => {
  it('reads a numeric status from whatever was thrown', () => {
    expect(statusOf({status: 503})).toBe(503)
    expect(statusOf(Object.assign(new Error('x'), {status: 404}))).toBe(404)
  })

  it.each([
    ['a string status', {status: '500'}],
    ['nothing', {}],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 7],
  ])('reads no status from %s', (_name, value) => {
    expect(statusOf(value)).toBeUndefined()
  })

  it.each([429, 500, 502, 503, 599])('retries a %i', status => {
    expect(isTransient({status})).toBe(true)
  })

  it.each([200, 301, 400, 401, 403, 404, 409, 422, 428])('does not retry a %i', status => {
    expect(isTransient({status})).toBe(false)
  })

  it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'])(
    'retries a network error %s that has no status',
    code => {
      expect(isTransient({code})).toBe(true)
    },
  )

  it('does not retry another code, no code, or a network code that arrives with a non-transient status', () => {
    expect(isTransient({code: 'EACCES'})).toBe(false)
    expect(isTransient(new Error('boom'))).toBe(false)
    expect(isTransient(null)).toBe(false)
    expect(isTransient({status: 404, code: 'ECONNRESET'})).toBe(false)
    expect(isTransient({status: 503, code: 'EACCES'})).toBe(true)
  })
})

describe('DeadlineError and CutOffError', () => {
  it('make a cut-off request a deadline error, so one catch covers both', () => {
    expect(new CutOffError()).toBeInstanceOf(DeadlineError)
    expect(new CutOffError()).toBeInstanceOf(Error)
    expect(new DeadlineError()).not.toBeInstanceOf(CutOffError)
  })
})

describe('evaluateChecks', () => {
  const lint = (appId: number | null = null): RequiredCheck => ({context: 'Lint', appId})
  const run = (overrides: Partial<CheckRunView> = {}): CheckRunView => ({
    id: 1,
    name: 'Lint',
    status: 'completed',
    conclusion: 'success',
    appId: 15_368,
    ...overrides,
  })
  const status = (state: string): StatusView => ({context: 'Lint', state})

  it('passes a required check whose run succeeded', () => {
    expect(evaluateChecks([lint()], [run()], [])).toEqual({failed: [], pending: []})
  })

  it.each(['success', 'skipped', 'neutral'])('counts a %s conclusion as passed', conclusion => {
    expect(evaluateChecks([lint()], [run({conclusion})], [])).toEqual({failed: [], pending: []})
  })

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'])(
    'fails a completed run that ended %s',
    conclusion => {
      expect(evaluateChecks([lint()], [run({conclusion})], [])).toEqual({failed: ['Lint'], pending: []})
    },
  )

  it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
    'keeps a %s run pending, whatever its conclusion',
    runStatus => {
      expect(evaluateChecks([lint()], [run({status: runStatus, conclusion: null})], [])).toEqual({
        failed: [],
        pending: ['Lint'],
      })
      expect(evaluateChecks([lint()], [run({status: runStatus, conclusion: 'failure'})], [])).toEqual({
        failed: [],
        pending: ['Lint'],
      })
    },
  )

  it('keeps a check with nothing reported pending', () => {
    expect(evaluateChecks([lint()], [], [])).toEqual({failed: [], pending: ['Lint']})
    expect(evaluateChecks([lint()], [run({name: 'Other'})], [{context: 'Other', state: 'success'}])).toEqual({
      failed: [],
      pending: ['Lint'],
    })
  })

  it('passes a check that has no requirement list at all', () => {
    expect(evaluateChecks([], [run({conclusion: 'failure'})], [status('failure')])).toEqual({failed: [], pending: []})
  })

  it('matches a bound requirement on the app only', () => {
    expect(evaluateChecks([lint(15_368)], [run({appId: 999})], [])).toEqual({failed: [], pending: ['Lint']})
    expect(evaluateChecks([lint(15_368)], [run({appId: null})], [])).toEqual({failed: [], pending: ['Lint']})
    expect(evaluateChecks([lint(15_368)], [run({appId: 15_368})], [])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint(null)], [run({appId: 999})], [])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint(null)], [run({appId: null})], [])).toEqual({failed: [], pending: []})
  })

  it('does not let a failing run from another app fail a bound requirement', () => {
    const runs = [run({id: 50, appId: 999, conclusion: 'failure'}), run({id: 1, appId: 15_368})]
    expect(evaluateChecks([lint(15_368)], runs, [])).toEqual({failed: [], pending: []})
  })

  it('takes the newest run (highest id) of a name, whatever the order', () => {
    const old = run({id: 3, conclusion: 'failure'})
    const fresh = run({id: 9, conclusion: 'success'})
    expect(evaluateChecks([lint()], [old, fresh], [])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint()], [fresh, old], [])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint()], [run({id: 9, conclusion: 'failure'}), run({id: 3})], [])).toEqual({
      failed: ['Lint'],
      pending: [],
    })
  })

  it('does not reorder the caller’s runs', () => {
    const runs = [run({id: 3}), run({id: 9})]
    evaluateChecks([lint()], runs, [])
    expect(runs.map(item => item.id)).toEqual([3, 9])
  })

  it('judges a status alone, and takes the first status of a context as the newest', () => {
    expect(evaluateChecks([lint()], [], [status('success')])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint()], [], [status('failure')])).toEqual({failed: ['Lint'], pending: []})
    expect(evaluateChecks([lint()], [], [status('error')])).toEqual({failed: ['Lint'], pending: []})
    expect(evaluateChecks([lint()], [], [status('pending')])).toEqual({failed: [], pending: ['Lint']})
    expect(evaluateChecks([lint()], [], [status('success'), status('failure')])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint()], [], [status('failure'), status('success')])).toEqual({
      failed: ['Lint'],
      pending: [],
    })
  })

  it('needs both to pass when a context has a run and a status', () => {
    expect(evaluateChecks([lint()], [run()], [status('success')])).toEqual({failed: [], pending: []})
    expect(evaluateChecks([lint()], [run()], [status('pending')])).toEqual({failed: [], pending: ['Lint']})
    expect(evaluateChecks([lint()], [run()], [status('failure')])).toEqual({failed: ['Lint'], pending: []})
    expect(evaluateChecks([lint()], [run({conclusion: 'failure'})], [status('success')])).toEqual({
      failed: ['Lint'],
      pending: [],
    })
    expect(evaluateChecks([lint()], [run({status: 'queued', conclusion: null})], [status('failure')])).toEqual({
      failed: ['Lint'],
      pending: [],
    })
  })

  it('names every failed and every pending context, in the order required', () => {
    const required = [
      {context: 'A', appId: null},
      {context: 'B', appId: null},
      {context: 'C', appId: null},
      {context: 'D', appId: null},
    ]
    const runs = [
      run({name: 'A', conclusion: 'failure'}),
      run({name: 'B', status: 'queued', conclusion: null}),
      run({name: 'C'}),
    ]
    expect(evaluateChecks(required, runs, [])).toEqual({failed: ['A'], pending: ['B', 'D']})
  })
})

describe('sameChecks', () => {
  const check = (context: string, appId: number | null = null): RequiredCheck => ({context, appId})

  it('is true for the same contexts bound to the same apps, in any order', () => {
    expect(sameChecks([], [])).toBe(true)
    expect(sameChecks([check('A', 1), check('B')], [check('B'), check('A', 1)])).toBe(true)
  })

  it('is false when a context is added, removed, renamed or rebound', () => {
    expect(sameChecks([check('A')], [])).toBe(false)
    expect(sameChecks([], [check('A')])).toBe(false)
    expect(sameChecks([check('A')], [check('B')])).toBe(false)
    expect(sameChecks([check('A', 1)], [check('A', 2)])).toBe(false)
    expect(sameChecks([check('A', 1)], [check('A')])).toBe(false)
    expect(sameChecks([check('A')], [check('A'), check('A')])).toBe(false)
  })

  it('does not mistake a context that holds the key separator for another binding', () => {
    expect(sameChecks([check('A\0null')], [check('A')])).toBe(false)
  })

  it('does not reorder the caller’s lists', () => {
    const left = [check('B'), check('A')]
    sameChecks(left, left)
    expect(left.map(item => item.context)).toEqual(['B', 'A'])
  })
})

interface Scripted {
  /** `getBranch` answers; an Error is thrown. */
  branch?: () => unknown
  runs?: (
    page: number,
  ) =>
    readonly {id: number; name: string; status: string; conclusion: string | null; app?: {id: number} | null}[] | Error
  statuses?: (page: number) => readonly {context: string; state: string}[] | Error
}

function fake(scripted: Scripted = {}) {
  const calls: {name: string; params: Record<string, unknown>; signal: AbortSignal | undefined}[] = []
  const take = (name: string, params: unknown) => {
    const {request, ...rest} = params as {request?: {signal?: AbortSignal}}
    calls.push({name, params: rest, signal: request?.signal})
  }
  const client = {
    rest: {
      repos: {
        getBranch: async (params: unknown) => {
          take('getBranch', params)
          const answer = scripted.branch?.() ?? {data: {protection: {required_status_checks: {checks: []}}}}
          if (answer instanceof Error) throw answer
          return answer
        },
        listCommitStatusesForRef: async (params: {page: number}) => {
          take('listStatuses', params)
          const answer = scripted.statuses?.(params.page) ?? []
          if (answer instanceof Error) throw answer
          return {data: answer}
        },
      },
      checks: {
        listForRef: async (params: {page: number}) => {
          take('listRuns', params)
          const answer = scripted.runs?.(params.page) ?? []
          if (answer instanceof Error) throw answer
          return {data: {check_runs: answer}}
        },
      },
    },
  } as unknown as RequiredChecksClient
  // A read wrapper that hands each operation its own signal and does nothing else.
  const signals: AbortSignal[] = []
  const read: ReadRequest = async operation => {
    const signal = new AbortController().signal
    signals.push(signal)
    return operation(signal)
  }
  return {client, calls, read, signals}
}

const protectionWith = (checks: readonly {context: string; app_id?: number | null}[] | undefined) => ({
  data: {protection: {required_status_checks: checks === undefined ? {} : {checks}}},
})

describe('readRequiredChecks', () => {
  const declared = ['Lint', 'Test']

  it('returns the live list with each app, `null` where none is bound, and reads main through the wrapper', async () => {
    const f = fake({
      branch: () =>
        protectionWith([{context: 'Lint', app_id: 15_368}, {context: 'Test'}, {context: 'Extra', app_id: null}]),
    })
    const result = await readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: f.read, declared})

    expect(result).toEqual({
      kind: 'ok',
      checks: [
        {context: 'Lint', appId: 15_368},
        {context: 'Test', appId: null},
        {context: 'Extra', appId: null},
      ],
    })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.name).toBe('getBranch')
    expect(f.calls[0]?.params).toEqual({owner: 'o', repo: 'r', branch: 'main'})
    expect(f.calls[0]?.signal).toBe(f.signals[0])
  })

  it('is `empty` for an empty list, a missing list and a branch without protection', async () => {
    for (const answer of [protectionWith([]), protectionWith(undefined), {data: {}}, {data: {protection: {}}}]) {
      const f = fake({branch: () => answer})
      expect(await readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: f.read, declared})).toEqual({
        kind: 'empty',
      })
    }
  })

  it('is `short` and names every declared context the live list lacks, in declared order', async () => {
    const f = fake({branch: () => protectionWith([{context: 'Other'}])})
    expect(await readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: f.read, declared})).toEqual({
      kind: 'short',
      missing: ['Lint', 'Test'],
    })
    const g = fake({branch: () => protectionWith([{context: 'Test'}])})
    expect(await readRequiredChecks({client: g.client, owner: 'o', repo: 'r', read: g.read, declared})).toEqual({
      kind: 'short',
      missing: ['Lint'],
    })
  })

  it('accepts a live list of exactly the declared contexts, and an empty declared list', async () => {
    const f = fake({branch: () => protectionWith([{context: 'Lint'}, {context: 'Test'}])})
    expect((await readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: f.read, declared})).kind).toBe(
      'ok',
    )
    expect((await readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: f.read, declared: []})).kind).toBe(
      'ok',
    )
  })

  it('is `unreadable` when the read fails, whatever the failure, and never echoes it', async () => {
    for (const error of [Object.assign(new Error('secret body'), {status: 403}), new Error('boom')]) {
      const f = fake({branch: () => error})
      const result = await readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: f.read, declared})
      expect(result).toEqual({kind: 'unreadable'})
    }
  })

  it('lets a deadline error and a cut-off propagate instead of reporting an unreadable list', async () => {
    const f = fake()
    for (const error of [new DeadlineError(), new CutOffError()]) {
      const failing: ReadRequest = async () => {
        throw error
      }
      await expect(readRequiredChecks({client: f.client, owner: 'o', repo: 'r', read: failing, declared})).rejects.toBe(
        error,
      )
    }
  })
})

describe('readCheckRuns and readCommitStatuses', () => {
  const runRow = (id: number, name = `Run ${String(id)}`) => ({
    id,
    name,
    status: 'completed',
    conclusion: 'success',
    app: {id: 15_368},
  })
  const rows = (from: number, count: number) => Array.from({length: count}, (_, index) => runRow(from + index))
  const statusRows = (from: number, count: number) =>
    Array.from({length: count}, (_, index) => ({context: `S ${String(from + index)}`, state: 'success'}))

  it('maps each run to its view, with `null` for a run that has no app', async () => {
    const f = fake({
      runs: () => [
        {id: 4, name: 'Lint', status: 'completed', conclusion: 'success', app: {id: 15_368}},
        {id: 5, name: 'Test', status: 'in_progress', conclusion: null, app: null},
      ],
    })
    const {runs, capped} = await readCheckRuns({client: f.client, owner: 'o', repo: 'r', read: f.read, ref: 'abc'})

    expect(runs).toEqual([
      {id: 4, name: 'Lint', status: 'completed', conclusion: 'success', appId: 15_368},
      {id: 5, name: 'Test', status: 'in_progress', conclusion: null, appId: null},
    ])
    expect(capped).toBe(false)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.params).toEqual({owner: 'o', repo: 'r', ref: 'abc', filter: 'latest', per_page: 100, page: 1})
    expect(f.calls[0]?.signal).toBe(f.signals[0])
  })

  it('maps each status to its context and state and asks for a hundred to a page', async () => {
    const f = fake({
      statuses: () => [
        {context: 'A', state: 'success'},
        {context: 'B', state: 'failure'},
      ],
    })
    const {statuses, capped} = await readCommitStatuses({
      client: f.client,
      owner: 'o',
      repo: 'r',
      read: f.read,
      ref: 'abc',
    })

    expect(statuses).toEqual([
      {context: 'A', state: 'success'},
      {context: 'B', state: 'failure'},
    ])
    expect(capped).toBe(false)
    expect(f.calls[0]?.params).toEqual({owner: 'o', repo: 'r', ref: 'abc', per_page: 100, page: 1})
    expect(f.calls[0]?.signal).toBe(f.signals[0])
  })

  it('reads page after page until a short one and keeps the order', async () => {
    const f = fake({runs: page => (page === 1 ? rows(1, 100) : page === 2 ? rows(101, 100) : rows(201, 7))})
    const {runs, capped} = await readCheckRuns({client: f.client, owner: 'o', repo: 'r', read: f.read, ref: 'abc'})

    expect(runs.map(run => run.id)).toEqual(Array.from({length: 207}, (_, index) => index + 1))
    expect(capped).toBe(false)
    expect(f.calls.map(call => call.params.page)).toEqual([1, 2, 3])
    expect(f.signals).toHaveLength(3)
  })

  it('reads one more, empty, page after a full one', async () => {
    const f = fake({statuses: page => (page === 1 ? statusRows(1, 100) : [])})
    const {statuses, capped} = await readCommitStatuses({
      client: f.client,
      owner: 'o',
      repo: 'r',
      read: f.read,
      ref: 'abc',
    })

    expect(statuses).toHaveLength(100)
    expect(capped).toBe(false)
    expect(f.calls.map(call => call.params.page)).toEqual([1, 2])
  })

  it('stops after page 50 and says so when that page was full', async () => {
    const f = fake({runs: page => rows(page * 1000, 100)})
    const {runs, capped} = await readCheckRuns({client: f.client, owner: 'o', repo: 'r', read: f.read, ref: 'abc'})

    expect(capped).toBe(true)
    expect(runs).toHaveLength(5000)
    expect(f.calls).toHaveLength(50)
    expect(f.calls.at(-1)?.params.page).toBe(50)

    const g = fake({statuses: page => statusRows(page * 1000, 100)})
    const result = await readCommitStatuses({client: g.client, owner: 'o', repo: 'r', read: g.read, ref: 'abc'})
    expect(result.capped).toBe(true)
    expect(result.statuses).toHaveLength(5000)
    expect(g.calls).toHaveLength(50)
  })

  it('is not capped when page 50 is the first short one, and stops at 50 pages of 99', async () => {
    const f = fake({runs: page => (page < 50 ? rows(page * 1000, 100) : rows(60_000, 3))})
    const result = await readCheckRuns({client: f.client, owner: 'o', repo: 'r', read: f.read, ref: 'abc'})
    expect(result.capped).toBe(false)
    expect(result.runs).toHaveLength(4903)
    expect(f.calls).toHaveLength(50)

    const g = fake({runs: page => rows(page * 1000, 99)})
    const short = await readCheckRuns({client: g.client, owner: 'o', repo: 'r', read: g.read, ref: 'abc'})
    expect(short.capped).toBe(false)
    expect(g.calls).toHaveLength(1)
  })

  it('throws when a page read fails, and lets a deadline error through as it is', async () => {
    const failure = Object.assign(new Error('secret body'), {status: 500})
    const f = fake({runs: page => (page === 1 ? rows(1, 100) : failure), statuses: () => failure})
    await expect(readCheckRuns({client: f.client, owner: 'o', repo: 'r', read: f.read, ref: 'abc'})).rejects.toBe(
      failure,
    )
    await expect(readCommitStatuses({client: f.client, owner: 'o', repo: 'r', read: f.read, ref: 'abc'})).rejects.toBe(
      failure,
    )

    const late = new DeadlineError()
    const failing: ReadRequest = async () => {
      throw late
    }
    await expect(readCheckRuns({client: f.client, owner: 'o', repo: 'r', read: failing, ref: 'abc'})).rejects.toBe(late)
    await expect(readCommitStatuses({client: f.client, owner: 'o', repo: 'r', read: failing, ref: 'abc'})).rejects.toBe(
      late,
    )
  })
})
