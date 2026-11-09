import {describe, expect, it} from 'vitest'
import {
  parseDeclaredContexts,
  runSelfMerge,
  selfMerge,
  type SelfMergeInput,
  type SelfMergeOctokit,
  type SelfMergeOutcome,
} from './promotion-self-merge.ts'

const PIN = 'a'.repeat(40)
const MOVED = 'b'.repeat(40)
const DECLARED = ['Lint', 'Test', 'Security: Private Leak Scan', 'CodeQL'] as const
const MINUTE = 60_000

interface ApiError extends Error {
  status: number
}

function apiError(status: number, message = 'upstream body with a secret'): ApiError {
  return Object.assign(new Error(message), {status})
}

/** Plays `items` in order, then repeats the last. An `Error` item is thrown. */
function script<T>(...items: readonly (T | Error)[]): () => T {
  let index = 0
  return () => {
    const item = items[Math.min(index, items.length - 1)]
    index += 1
    if (item instanceof Error) throw item
    return item as T
  }
}

interface PullState {
  state?: 'open' | 'closed'
  merged?: boolean
  head?: string
  labels?: readonly string[]
  mergeable?: string
}

interface RunState {
  id?: number
  name: string
  status?: string
  conclusion?: string | null
  app?: number | null
}

const GREEN_RUNS: readonly RunState[] = [
  {name: 'Lint', app: 15_368, conclusion: 'success'},
  {name: 'Test', app: 15_368, conclusion: 'success'},
  {name: 'CodeQL', app: 57_789, conclusion: 'success'},
]

interface Scenario {
  /** `getBranch` answers; an Error is thrown. */
  protection?: () => unknown
  pulls?: () => PullState | Error
  /** Check runs by page (1-based) per poll; the function gets the poll number (1-based). */
  runs?: (poll: number, page: number) => readonly RunState[] | Error
  statuses?: (poll: number, page: number) => readonly {context: string; state: string}[] | Error
  variable?: () => string | undefined | Error
  approve?: () => unknown
  merge?: () => unknown
  /** Milliseconds every API call takes on the fake clock, or per call: its name and its count so far (1-based). */
  callCost?: number | ((name: string, count: number) => number)
  /** Whether a call hangs until its abort signal fires, like a request that stalls in flight. */
  hang?: (name: string, count: number) => boolean
}

function checksFor(contexts: readonly string[]) {
  return contexts.map(context => ({context, app_id: context === 'CodeQL' ? 57_789 : 15_368}))
}

function protectionOf(checks: readonly {context: string; app_id: number | null}[] | undefined) {
  return {data: {protection: {required_status_checks: checks === undefined ? {} : {checks}}}}
}

/** A fake world: an in-memory Octokit, a fake clock, and a log of the calls that matter. */
function world(scenario: Scenario = {}) {
  const clock = {now: 1_000_000}
  const log: string[] = []
  const sleeps: number[] = []
  const requests: Record<string, unknown[]> = {}
  let polls = 0
  const signals: {name: string; ms: number}[] = []
  const controllers = new Map<AbortSignal, AbortController>()
  const sizes = new Map<AbortSignal, number>()
  const record = (name: string, params: unknown) => {
    const {request, ...rest} = params as {request?: {signal?: AbortSignal}}
    if (request?.signal !== undefined) signals.push({name, ms: sizes.get(request.signal) ?? -1})
    ;(requests[name] ??= []).push(rest)
    const cost = scenario.callCost ?? 0
    clock.now += typeof cost === 'number' ? cost : cost(name, requests[name]?.length ?? 0)
  }
  /** A request that stalls: its signal fires (the timer of a real one) and the request fails the way Octokit does. */
  const stall = async (params: unknown): Promise<never> =>
    new Promise<never>((_resolve, reject) => {
      const signal = (params as {request?: {signal?: AbortSignal}}).request?.signal
      setTimeout(() => {
        if (signal !== undefined) controllers.get(signal)?.abort()
        reject(Object.assign(new Error('The operation was aborted'), {status: 500}))
      }, 0)
    })
  const maybeHang = async (name: string, params: unknown): Promise<void> => {
    if (scenario.hang?.(name, requests[name]?.length ?? 0) === true) await stall(params)
  }
  const pulls: () => PullState | Error = scenario.pulls ?? (() => ({}))
  const protection = scenario.protection ?? (() => protectionOf(checksFor(DECLARED)))
  const octokit = {
    rest: {
      repos: {
        getBranch: async (params: unknown) => {
          record('getBranch', params)
          await maybeHang('getBranch', params)
          return protection()
        },
        listCommitStatusesForRef: async (params: {page: number}) => {
          record('listStatuses', params)
          await maybeHang('listStatuses', params)
          const result = (scenario.statuses ?? (() => [{context: 'Security: Private Leak Scan', state: 'success'}]))(
            polls,
            params.page,
          )
          if (result instanceof Error) throw result
          return {data: result}
        },
      },
      checks: {
        listForRef: async (params: {page: number}) => {
          record('listRuns', params)
          await maybeHang('listRuns', params)
          if (params.page === 1) polls += 1
          const result = (scenario.runs ?? (() => GREEN_RUNS))(polls, params.page)
          if (result instanceof Error) throw result
          return {
            data: {
              check_runs: result.map((run, index) => ({
                id: run.id ?? index + 1,
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
          await maybeHang('getPull', params)
          const pull = pulls()
          if (pull instanceof Error) throw pull
          return {
            data: {
              state: pull.state ?? 'open',
              merged: pull.merged ?? false,
              head: {sha: pull.head ?? PIN},
              labels: (pull.labels ?? ['automerge']).map(name => ({name})),
              mergeable_state: pull.mergeable ?? 'clean',
            },
          }
        },
        createReview: async (params: unknown) => {
          record('approve', params)
          await maybeHang('approve', params)
          log.push('approve')
          return (scenario.approve ?? (() => ({data: {}})))()
        },
        merge: async (params: unknown) => {
          record('merge', params)
          await maybeHang('merge', params)
          log.push('merge')
          return (scenario.merge ?? (() => ({data: {merged: true, sha: 'c'.repeat(40)}})))()
        },
      },
      actions: {
        getRepoVariable: async (params: unknown) => {
          record('getVariable', params)
          await maybeHang('getVariable', params)
          const value = (scenario.variable ?? (() => 'on'))()
          if (value instanceof Error) throw value
          if (value === undefined) throw apiError(404, 'Not Found')
          return {data: {name: 'PROMOTION_SELF_MERGE', value}}
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
  return {octokit, input, clock, log, sleeps, requests, signals, polls: () => polls}
}

function summaryOf(outcome: SelfMergeOutcome): string {
  return outcome.summary
}

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

const APPROVAL_BODY = `Approved by Merge Data Branch: ${PIN} touches only knowledge/ and metadata/ and passed the promotion gates.`
const LIVE = {exitCode: 0, code: 'MERGED'}

describe('selfMerge: the happy path (AE1)', () => {
  it('approves the pinned commit with a one-line body and merges pinned to it, squashing', async () => {
    const w = world()
    const outcome = await selfMerge(w.input())

    expect(outcome).toMatchObject(LIVE)
    expect(w.log).toEqual(['approve', 'merge'])
    expect(w.requests.approve).toEqual([
      {owner: 'fro-bot', repo: '.github', pull_number: 77, commit_id: PIN, event: 'APPROVE', body: APPROVAL_BODY},
    ])
    expect(w.requests.merge).toEqual([
      {owner: 'fro-bot', repo: '.github', pull_number: 77, sha: PIN, merge_method: 'squash'},
    ])
    expect(APPROVAL_BODY.includes('\n')).toBe(false)
    expect(w.sleeps).toEqual([])
  })

  it('names the pull request, the pin and the outcome in the summary', async () => {
    const outcome = await selfMerge(world().input())
    expect(outcome.summary).toBe(
      [
        '### Promotion self-merge: merged',
        '',
        'The promotion gates passed on the pinned commit, the required checks passed on it, and the pull request was approved as `fro-bot` and squash-merged pinned to it.',
        '',
        '- Pull request: #77',
        `- Pinned commit: \`${PIN}\``,
        '',
      ].join('\n'),
    )
  })

  it('reads the branch protection of main, the pull request, the checks and statuses of the pin', async () => {
    const w = world()
    await selfMerge(w.input())
    expect(w.requests.getBranch?.[0]).toEqual({owner: 'fro-bot', repo: '.github', branch: 'main'})
    expect(w.requests.getPull?.[0]).toEqual({owner: 'fro-bot', repo: '.github', pull_number: 77})
    expect(w.requests.listRuns?.[0]).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      ref: PIN,
      filter: 'latest',
      per_page: 100,
      page: 1,
    })
    expect(w.requests.listStatuses?.[0]).toEqual({owner: 'fro-bot', repo: '.github', ref: PIN, per_page: 100, page: 1})
    expect(w.requests.getVariable?.[0]).toEqual({owner: 'fro-bot', repo: '.github', name: 'PROMOTION_SELF_MERGE'})
  })

  it('waits for checks that are still running, polling a minute apart', async () => {
    const w = world({
      runs: poll => [
        {name: 'Lint', app: 15_368, conclusion: 'success'},
        {
          name: 'Test',
          app: 15_368,
          status: poll < 3 ? 'in_progress' : 'completed',
          conclusion: poll < 3 ? null : 'success',
        },
        {name: 'CodeQL', app: 57_789, conclusion: 'success'},
      ],
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.sleeps).toEqual([MINUTE, MINUTE])
    expect(w.polls()).toBe(3)
  })

  it('treats a missing run as pending until it appears', async () => {
    const w = world({runs: poll => (poll < 2 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS)})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.sleeps).toEqual([MINUTE])
  })
})

describe('selfMerge: what counts as a passing check', () => {
  it.each(['success', 'skipped', 'neutral'])('counts a %s check run as passing', async conclusion => {
    const w = world({runs: () => [{name: 'Lint', conclusion}, {name: 'Test'}, {name: 'CodeQL', app: 57_789}]})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('counts a skipped Fro Bot run and a neutral check as passing', async () => {
    const contexts = [...DECLARED, 'Fro Bot']
    const w = world({
      protection: () => protectionOf(checksFor(contexts)),
      runs: () => [...GREEN_RUNS, {name: 'Fro Bot', conclusion: 'skipped'}],
    })
    expect(await selfMerge(w.input({declaredContexts: contexts}))).toMatchObject(LIVE)
  })

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'])(
    'fails the run on a %s check run at the pin (exit 1)',
    async conclusion => {
      const w = world({runs: () => [{name: 'Lint', conclusion}, {name: 'Test'}, {name: 'CodeQL', app: 57_789}]})
      const outcome = await selfMerge(w.input())
      expect(outcome).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
      expect(outcome.summary).toContain('`Lint`')
      expect(w.log).toEqual([])
    },
  )

  it('waits on queued and in-progress runs', async () => {
    for (const status of ['queued', 'in_progress', 'waiting', 'pending']) {
      const w = world({
        runs: () => [{name: 'Lint', status, conclusion: null}, {name: 'Test'}, {name: 'CodeQL', app: 57_789}],
      })
      const outcome = await selfMerge(w.input())
      expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    }
  })

  it('ignores a check run from another app that has the required name', async () => {
    const w = world({
      runs: () => [{name: 'Lint', app: 999, conclusion: 'success'}, {name: 'Test'}, {name: 'CodeQL', app: 57_789}],
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.log).toEqual([])
  })

  it('does not let a failing run from another app fail the required one', async () => {
    const w = world({
      runs: () => [
        {id: 50, name: 'Lint', app: 999, conclusion: 'failure'},
        {id: 1, name: 'Lint', app: 15_368, conclusion: 'success'},
        {name: 'Test', id: 2},
        {name: 'CodeQL', app: 57_789, id: 3},
      ],
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('takes any app when the required check names none', async () => {
    const w = world({
      protection: () => protectionOf(DECLARED.map(context => ({context, app_id: null}))),
      runs: () => [
        {name: 'Lint', app: 1},
        {name: 'Test', app: 2},
        {name: 'CodeQL', app: 3},
      ],
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('uses the newest of several runs with the same name and app', async () => {
    const w = world({
      runs: () => [
        {id: 10, name: 'Lint', conclusion: 'failure'},
        {id: 11, name: 'Lint', conclusion: 'success'},
        {id: 2, name: 'Test'},
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    const stale = world({
      runs: () => [
        {id: 12, name: 'Lint', conclusion: 'failure'},
        {id: 11, name: 'Lint', conclusion: 'success'},
        {id: 2, name: 'Test'},
        {id: 3, name: 'CodeQL', app: 57_789},
      ],
    })
    expect(await selfMerge(stale.input())).toMatchObject({code: 'CHECK_FAILED'})
  })

  it('reads a second page of check runs', async () => {
    const filler = Array.from({length: 100}, (_, index) => ({id: 1000 + index, name: `Other ${String(index)}`}))
    const w = world({runs: (_poll, page) => (page === 1 ? filler : GREEN_RUNS)})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.requests.listRuns).toHaveLength(2)
    expect((w.requests.listRuns?.[1] as {page: number}).page).toBe(2)
  })

  it('stops paging at a short page, and after an empty page following a full one', async () => {
    const full = Array.from({length: 100}, (_, index) => ({id: 1000 + index, name: `Other ${String(index)}`}))
    const short = world({runs: () => GREEN_RUNS})
    await selfMerge(short.input())
    expect(short.requests.listRuns).toHaveLength(1)
    const exact = world({runs: (_poll, page) => (page === 1 ? [...full] : page === 2 ? [] : GREEN_RUNS)})
    expect(await selfMerge(exact.input())).toMatchObject({code: 'TIMEOUT'})
    expect((exact.requests.listRuns ?? []).slice(0, 2)).toHaveLength(2)
  })

  it('reads a commit status by context for a check that posts no run, newest first', async () => {
    const pending = world({
      statuses: () => [
        {context: 'Security: Private Leak Scan', state: 'success'},
        {context: 'Security: Private Leak Scan', state: 'failure'},
      ],
    })
    expect(await selfMerge(pending.input())).toMatchObject(LIVE)
    const failed = world({
      statuses: () => [
        {context: 'Security: Private Leak Scan', state: 'failure'},
        {context: 'Security: Private Leak Scan', state: 'success'},
      ],
    })
    expect(await selfMerge(failed.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
  })

  it.each(['failure', 'error'])('fails on a %s status', async state => {
    const w = world({statuses: () => [{context: 'Security: Private Leak Scan', state}]})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
  })

  it('waits on a pending status and on a missing one', async () => {
    const pending = world({statuses: () => [{context: 'Security: Private Leak Scan', state: 'pending'}]})
    expect(await selfMerge(pending.input())).toMatchObject({code: 'TIMEOUT'})
    const missing = world({statuses: () => [{context: 'Some other context', state: 'success'}]})
    expect(await selfMerge(missing.input())).toMatchObject({code: 'TIMEOUT'})
  })

  describe('a context that has both a check run and a commit status', () => {
    const SECURITY = {context: 'Security: Private Leak Scan', state: 'success'}
    const lintRun = (conclusion: string | null, status = 'completed'): readonly RunState[] => [
      {name: 'Lint', app: 15_368, conclusion, status},
      {name: 'Test', app: 15_368},
      {name: 'CodeQL', app: 57_789},
    ]
    const lintStatus = (state: string) => [{context: 'Lint', state}, SECURITY]

    it('passes when both succeed, and approves only then', async () => {
      const w = world({runs: () => lintRun('success'), statuses: () => lintStatus('success')})
      expect(await selfMerge(w.input())).toMatchObject(LIVE)
      expect(w.log).toEqual(['approve', 'merge'])
    })

    it.each(['failure', 'error'])('fails when the run succeeds and the status is a %s', async state => {
      const w = world({runs: () => lintRun('success'), statuses: () => lintStatus(state)})
      const outcome = await selfMerge(w.input())
      expect(outcome).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
      expect(outcome.summary).toContain('`Lint`')
      expect(w.log).toEqual([])
    })

    it('keeps waiting when the run succeeds and the status is pending, and approves nothing', async () => {
      const w = world({runs: () => lintRun('success'), statuses: () => lintStatus('pending')})
      const outcome = await selfMerge(w.input())
      expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
      expect(outcome.summary).toContain('`Lint`')
      expect(w.log).toEqual([])
    })

    it('goes on once the pending status turns green', async () => {
      const w = world({
        runs: () => lintRun('success'),
        statuses: poll => lintStatus(poll < 3 ? 'pending' : 'success'),
      })
      expect(await selfMerge(w.input())).toMatchObject(LIVE)
      expect(w.sleeps).toEqual([MINUTE, MINUTE])
    })

    it.each(['failure', 'cancelled', 'timed_out'])(
      'fails when the status succeeds and the run is a %s',
      async conclusion => {
        const w = world({runs: () => lintRun(conclusion), statuses: () => lintStatus('success')})
        expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
        expect(w.log).toEqual([])
      },
    )

    it.each(['in_progress', 'queued'])('keeps waiting when the status succeeds and the run is %s', async status => {
      const w = world({runs: () => lintRun(null, status), statuses: () => lintStatus('success')})
      expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
      expect(w.log).toEqual([])
    })

    it('fails, and does not wait, when one side has failed and the other is pending', async () => {
      const statusFailed = world({runs: () => lintRun(null, 'in_progress'), statuses: () => lintStatus('failure')})
      expect(await selfMerge(statusFailed.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
      expect(statusFailed.sleeps).toEqual([])
      const runFailed = world({runs: () => lintRun('failure'), statuses: () => lintStatus('pending')})
      expect(await selfMerge(runFailed.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
      expect(runFailed.sleeps).toEqual([])
    })

    it('lets a skipped or neutral run pass beside a successful status', async () => {
      for (const conclusion of ['skipped', 'neutral']) {
        const w = world({runs: () => lintRun(conclusion), statuses: () => lintStatus('success')})
        expect(await selfMerge(w.input())).toMatchObject(LIVE)
      }
    })

    it('lets the status decide alone when the run is from another app', async () => {
      const otherApp = (): readonly RunState[] => [
        {name: 'Lint', app: 99, conclusion: 'failure'},
        {name: 'Test', app: 15_368},
        {name: 'CodeQL', app: 57_789},
      ]
      const pass = world({runs: otherApp, statuses: () => lintStatus('success')})
      expect(await selfMerge(pass.input())).toMatchObject(LIVE)
      const fail = world({runs: otherApp, statuses: () => lintStatus('failure')})
      expect(await selfMerge(fail.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
    })

    it('lets the run decide alone when no status carries the context', async () => {
      const pass = world({runs: () => lintRun('success'), statuses: () => [SECURITY]})
      expect(await selfMerge(pass.input())).toMatchObject(LIVE)
      const fail = world({runs: () => lintRun('failure'), statuses: () => [SECURITY]})
      expect(await selfMerge(fail.input())).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
    })

    it('reports a context once even when both its run and its status fail', async () => {
      const w = world({runs: () => lintRun('failure'), statuses: () => lintStatus('failure')})
      const outcome = await selfMerge(w.input())
      expect(outcome.summary.match(/`Lint`/gu)).toHaveLength(1)
    })
  })

  it('reads a second page of statuses', async () => {
    const filler = Array.from({length: 100}, (_, index) => ({context: `Other ${String(index)}`, state: 'success'}))
    const w = world({
      statuses: (_poll, page) => (page === 1 ? filler : [{context: 'Security: Private Leak Scan', state: 'success'}]),
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.requests.listStatuses).toHaveLength(2)
  })

  it('reports a failed check ahead of one that is still pending', async () => {
    const w = world({
      runs: () => [
        {name: 'Lint', status: 'in_progress', conclusion: null},
        {name: 'Test', conclusion: 'failure'},
        {name: 'CodeQL', app: 57_789},
      ],
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
    expect(outcome.summary).toContain('`Test`')
    expect(outcome.summary).not.toContain('`Lint`')
  })

  it('also waits on a required check the declared list does not name', async () => {
    const w = world({
      protection: () => protectionOf(checksFor([...DECLARED, 'Extra'])),
    })
    expect(await selfMerge(w.input())).toMatchObject({code: 'TIMEOUT'})
  })
})

describe('selfMerge: the live protection must hold every declared context (AE8)', () => {
  it('stops with exit 1 and says why when the required list is empty', async () => {
    const w = world({protection: () => protectionOf([])})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_EMPTY'})
    expect(outcome.summary).toContain('The live required-check list for `main` is empty')
    expect(w.log).toEqual([])
    expect(w.requests.getPull).toBeUndefined()
  })

  it('stops when the protection carries no checks at all', async () => {
    const w = world({protection: () => protectionOf(undefined)})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_EMPTY'})
  })

  it('stops when main has no protection block', async () => {
    const w = world({protection: () => ({data: {}})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_EMPTY'})
  })

  it('stops when the list is short, and names the missing contexts', async () => {
    const w = world({protection: () => protectionOf(checksFor(['Lint', 'Test']))})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_SHORT'})
    expect(outcome.summary).toContain('`CodeQL`')
    expect(outcome.summary).toContain('`Security: Private Leak Scan`')
    expect(outcome.summary).not.toContain('`Lint`')
  })

  it('passes when the live list has more contexts than declared', async () => {
    const w = world({protection: () => protectionOf(checksFor([...DECLARED, 'Extra']))})
    const outcome = await selfMerge(w.input())
    expect(outcome.code).not.toBe('PROTECTION_SHORT')
  })

  it('stops with exit 1 when the protection read fails with a 404', async () => {
    const w = world({
      protection: () => {
        throw apiError(404)
      },
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'PROTECTION_UNREADABLE'})
    expect(outcome.summary).not.toContain('secret')
  })

  it('stops with exit 1 when nothing is declared', async () => {
    const w = world()
    expect(await selfMerge(w.input({declaredContexts: []}))).toMatchObject({exitCode: 1, code: 'NO_DECLARED_CONTEXTS'})
    expect(w.requests.getBranch).toBeUndefined()
  })

  it('re-reads the protection before the approval and stops if it has weakened since the wait began', async () => {
    const w = world({
      protection: script(protectionOf(checksFor(DECLARED)), protectionOf(checksFor(['Lint']))),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_SHORT'})
    expect(w.log).toEqual([])
  })
})

describe('selfMerge: runs that stop before any approval', () => {
  it('has nothing to do without a pull request', async () => {
    const w = world()
    expect(await selfMerge(w.input({pullRequest: null}))).toMatchObject({exitCode: 0, code: 'NO_PULL_REQUEST'})
    expect(w.requests.getBranch).toBeUndefined()
  })

  it('leaves a promotion that does not qualify to the operator', async () => {
    const w = world()
    expect(await selfMerge(w.input({qualifies: false}))).toMatchObject({exitCode: 0, code: 'NOT_QUALIFYING'})
    expect(w.requests.getBranch).toBeUndefined()
    expect(w.log).toEqual([])
  })

  it.each([
    [{state: 'closed' as const}, 'CLOSED_UNMERGED'],
    [{state: 'closed' as const, merged: true}, 'ALREADY_MERGED'],
    [{merged: true}, 'ALREADY_MERGED'],
    [{head: MOVED}, 'STALE_HEAD'],
    [{labels: ['needs-review']}, 'NOT_LABELED'],
    [{labels: []}, 'NOT_LABELED'],
    [{labels: ['automerge', 'hold-merge']}, 'HOLD_MERGE'],
    [{labels: ['hold-merge']}, 'HOLD_MERGE'],
  ])('stops with exit 0 before waiting for %j: %s', async (pull, code) => {
    const w = world({pulls: () => pull})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code})
    expect(w.log).toEqual([])
    expect(w.requests.listRuns).toBeUndefined()
    expect(w.sleeps).toEqual([])
  })

  it('prefers a merged pull request over a moved head, and a closed one over a hold', async () => {
    const merged = world({pulls: () => ({state: 'closed', merged: true, head: MOVED, labels: ['hold-merge']})})
    expect(await selfMerge(merged.input())).toMatchObject({code: 'ALREADY_MERGED'})
    const closed = world({pulls: () => ({state: 'closed', head: MOVED, labels: ['hold-merge']})})
    expect(await selfMerge(closed.input())).toMatchObject({code: 'CLOSED_UNMERGED'})
    const stale = world({pulls: () => ({head: MOVED, labels: ['hold-merge']})})
    expect(await selfMerge(stale.input())).toMatchObject({code: 'STALE_HEAD'})
    const held = world({pulls: () => ({labels: ['hold-merge']})})
    expect(await selfMerge(held.input())).toMatchObject({code: 'HOLD_MERGE'})
  })
})

describe('selfMerge: the kill switch and the dry run (AE10)', () => {
  it.each([undefined, '', 'off', 'ON', 'true', 'yes', ' on'])(
    'waits and polls like a live run, then says what it would approve and approves nothing (switch %j)',
    async value => {
      const w = world({variable: () => value})
      const outcome = await selfMerge(w.input({switchAtStart: value}))
      expect(outcome).toMatchObject({exitCode: 0, code: 'DRY_RUN'})
      expect(outcome.summary).toContain('would approve')
      expect(outcome.summary).toContain('`PROMOTION_SELF_MERGE`')
      expect(w.log).toEqual([])
      expect(w.requests.listRuns).toBeDefined()
    },
  )

  it('keeps waiting through a dry run until the checks settle', async () => {
    const w = world({
      variable: () => undefined,
      runs: poll => (poll < 3 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS),
    })
    expect(await selfMerge(w.input({switchAtStart: undefined}))).toMatchObject({code: 'DRY_RUN'})
    expect(w.sleeps).toEqual([MINUTE, MINUTE])
  })

  it('stops before the approval when the variable is turned off during the wait', async () => {
    const w = world({variable: () => 'off'})
    expect(await selfMerge(w.input({switchAtStart: 'on'}))).toMatchObject({exitCode: 0, code: 'DRY_RUN'})
    expect(w.log).toEqual([])
  })

  it('does not merge when the variable is turned off between the approval and the merge', async () => {
    const w = world({variable: script<string | undefined>('on', 'off')})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'SWITCH_TURNED_OFF'})
    expect(w.log).toEqual(['approve'])
    expect(outcome.summary).toContain('approved')
  })

  it('reads the variable twice on a live run: before the approval and before the merge', async () => {
    const w = world()
    await selfMerge(w.input())
    expect(w.requests.getVariable).toHaveLength(2)
  })

  it('treats an unset variable (404) as unreadable when the run started live, because a PAT without access sees none', async () => {
    const w = world({variable: () => undefined})
    expect(await selfMerge(w.input({switchAtStart: 'on'}))).toMatchObject({exitCode: 1, code: 'SWITCH_UNREADABLE'})
    expect(w.log).toEqual([])
  })

  it('stays a dry run on a 404 when the run did not start live', async () => {
    const w = world({variable: () => undefined})
    expect(await selfMerge(w.input({switchAtStart: undefined}))).toMatchObject({exitCode: 0, code: 'DRY_RUN'})
    expect(w.log).toEqual([])
  })

  it('fails closed with exit 1 when a run that started live cannot read the variable', async () => {
    const w = world({
      variable: () => {
        throw apiError(403)
      },
    })
    expect(await selfMerge(w.input({switchAtStart: 'on'}))).toMatchObject({exitCode: 1, code: 'SWITCH_UNREADABLE'})
    expect(w.log).toEqual([])
  })

  it('fails closed before the merge when the variable becomes unreadable after the approval', async () => {
    const w = world({variable: script<string | undefined>('on', apiError(403))})
    expect(await selfMerge(w.input({switchAtStart: 'on'}))).toMatchObject({exitCode: 1, code: 'SWITCH_UNREADABLE'})
    expect(w.log).toEqual(['approve'])
  })

  it('stays a dry run, without failing, when the variable is unreadable and the run did not start live', async () => {
    const w = world({
      variable: () => {
        throw apiError(403)
      },
    })
    expect(await selfMerge(w.input({switchAtStart: undefined}))).toMatchObject({exitCode: 0, code: 'DRY_RUN'})
  })
})

describe('selfMerge: a moving head, labels and state during the wait', () => {
  it('stops as stale, without approving, when the head moves mid-wait; a cancelled check on the old commit does not fail the run', async () => {
    const w = world({
      pulls: script<PullState>({}, {head: MOVED}),
      runs: poll => (poll < 2 ? GREEN_RUNS.slice(0, 1) : [{name: 'Lint', conclusion: 'cancelled'}]),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'STALE_HEAD'})
    expect(w.log).toEqual([])
  })

  it('does not approve when hold-merge is added during the wait', async () => {
    const w = world({
      pulls: script<PullState>({}, {labels: ['automerge', 'hold-merge']}),
      runs: poll => (poll < 2 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'HOLD_MERGE'})
    expect(w.log).toEqual([])
  })

  it('stops when the pull request is closed or merged during the wait', async () => {
    const closed = world({pulls: script<PullState>({}, {state: 'closed'}), runs: () => GREEN_RUNS.slice(0, 1)})
    expect(await selfMerge(closed.input())).toMatchObject({code: 'CLOSED_UNMERGED'})
    const merged = world({pulls: script<PullState>({}, {merged: true}), runs: () => GREEN_RUNS.slice(0, 1)})
    expect(await selfMerge(merged.input())).toMatchObject({code: 'ALREADY_MERGED'})
  })

  it('re-reads the head after the checks pass and stops if it moved just before the approval', async () => {
    const w = world({pulls: script<PullState>({}, {head: MOVED})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'STALE_HEAD'})
    expect(w.log).toEqual([])
  })

  it('reads the pull request once per poll, once before the approval and once before the merge', async () => {
    const w = world()
    await selfMerge(w.input())
    // the one poll, before the approval, before the merge
    expect(w.requests.getPull).toHaveLength(3)
  })
})

describe('selfMerge: the bounded wait (AE5)', () => {
  it('ends at exactly 60 minutes with exit 0 and a summary, never approving', async () => {
    const w = world({runs: () => GREEN_RUNS.slice(0, 1)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.sleeps).toHaveLength(60)
    expect(new Set(w.sleeps)).toEqual(new Set([MINUTE]))
    expect(w.polls()).toBe(61)
    expect(w.log).toEqual([])
    expect(outcome.summary).toContain('did not settle within 60 minutes')
    expect(outcome.summary).toContain('`Test`')
    expect(outcome.summary).toContain('next daily run')
  })

  it('counts the time the API calls take against the wait', async () => {
    const w = world({runs: () => GREEN_RUNS.slice(0, 1), callCost: 1000})
    expect(await selfMerge(w.input())).toMatchObject({code: 'TIMEOUT'})
    // three calls a poll cost 3 s, so a poll comes every 63 s and the wait ends after about 58 of them
    expect(w.polls()).toBeGreaterThan(55)
    expect(w.polls()).toBeLessThan(60)
  })

  it('ends the wait after 62 polls even when the clock never moves', async () => {
    const w = world({runs: () => GREEN_RUNS.slice(0, 1)})
    const input = w.input({
      sleep: async ms => {
        w.sleeps.push(ms)
      },
    })
    expect(await selfMerge({...input, now: () => 0})).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.polls()).toBe(62)
    expect(w.sleeps).toHaveLength(61)
  })

  it('reads at most 50 pages of check runs and statuses a poll, then judges what it has', async () => {
    const full = Array.from({length: 100}, (_, index) => ({id: 1000 + index, name: `Other ${String(index)}`}))
    const fullStatuses = Array.from({length: 100}, (_, index) => ({
      context: `Other ${String(index)}`,
      state: 'success',
    }))
    const w = world({runs: () => full, statuses: () => fullStatuses})
    expect(await selfMerge(w.input())).toMatchObject({code: 'TIMEOUT'})
    expect(w.requests.listRuns).toHaveLength(50 * w.polls())
    expect(w.requests.listStatuses).toHaveLength(50 * w.polls())
    const pages = (w.requests.listRuns as {page: number}[]).map(request => request.page)
    expect(Math.max(...pages)).toBe(50)
  })

  it('passes on the last poll before the deadline', async () => {
    const w = world({runs: poll => (poll < 61 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS)})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.polls()).toBe(61)
  })
})

describe('selfMerge: transient failures', () => {
  it('retries a 503 on one poll and keeps waiting', async () => {
    const w = world({runs: script<readonly RunState[] | Error>(apiError(503), GREEN_RUNS)})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.sleeps).toEqual([2000])
  })

  it.each([500, 502, 429])('retries a %i', async status => {
    const w = world({pulls: script<PullState | Error>(apiError(status), {})})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('retries a dropped connection', async () => {
    const reset = Object.assign(new Error('socket hang up'), {code: 'ECONNRESET'})
    const w = world({
      statuses: script<readonly {context: string; state: string}[] | Error>(reset, [
        {context: 'Security: Private Leak Scan', state: 'success'},
      ]),
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it.each(['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'])('retries %s', async code => {
    const failure = Object.assign(new Error('x'), {code})
    const w = world({pulls: script<PullState | Error>(failure, {})})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('backs off 2 s and then 4 s, and gives up on the third failure with exit 1', async () => {
    const w = world({runs: () => apiError(503)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'API_FAILED'})
    expect(w.sleeps).toEqual([2000, 4000])
    expect(outcome.summary).not.toContain('secret')
  })

  it('does not retry a 404 or a 403', async () => {
    for (const status of [404, 403, 401, 422]) {
      const w = world({pulls: () => apiError(status)})
      expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'API_FAILED'})
      expect(w.sleeps).toEqual([])
      expect(w.requests.getPull).toHaveLength(1)
    }
  })

  it('does not retry an error with no status and no network code', async () => {
    const w = world({pulls: () => new Error('boom')})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'API_FAILED'})
    expect(w.requests.getPull).toHaveLength(1)
  })

  it('does not retry the approval or the merge', async () => {
    const approving = world({
      approve: () => {
        throw apiError(503)
      },
    })
    expect(await selfMerge(approving.input())).toMatchObject({exitCode: 1, code: 'APPROVE_FAILED'})
    expect(approving.requests.approve).toHaveLength(1)
  })
})

describe('selfMerge: the approval', () => {
  it('stops as stale when the approval is refused with a 422 because the head moved', async () => {
    const w = world({
      approve: () => {
        throw apiError(422)
      },
      pulls: script<PullState>({}, {}, {head: MOVED}),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'STALE_HEAD'})
    expect(w.log).toEqual(['approve'])
  })

  it('fails with exit 1 on a 422 when the head has not moved', async () => {
    const w = world({
      approve: () => {
        throw apiError(422)
      },
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'APPROVE_FAILED'})
    expect(w.log).toEqual(['approve'])
  })

  it.each([401, 403, 404, 500])('fails with exit 1 on a %i from the approval, and merges nothing', async status => {
    const w = world({
      approve: () => {
        throw apiError(status)
      },
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'APPROVE_FAILED'})
    expect(w.log).toEqual(['approve'])
    expect(outcome.summary).not.toContain('secret')
    // only a 422 re-reads the pull request: the poll and the check before the approval are the two reads
    expect(w.requests.getPull).toHaveLength(2)
  })

  it('does not approve a dry run, a held promotion or a stale head', async () => {
    for (const scenario of [
      {variable: () => 'off'},
      {pulls: script<PullState>({}, {labels: ['automerge', 'hold-merge']})},
      {pulls: script<PullState>({}, {head: MOVED})},
    ]) {
      const w = world(scenario)
      await selfMerge(w.input())
      expect(w.log).not.toContain('approve')
    }
  })
})

describe('selfMerge: the merge (AE6)', () => {
  it('reports a 409 as open and waiting, with exit 0', async () => {
    const w = world({
      merge: () => {
        throw apiError(409)
      },
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'OPEN_WAITING'})
    expect(w.log).toEqual(['approve', 'merge'])
    expect(outcome.summary).toContain('next daily run')
  })

  it('reports a 405 while the pull request is behind as open and waiting, with exit 0', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {}, {mergeable: 'behind'}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'OPEN_WAITING'})
  })

  it('exits 1 on a 405 while the pull request stays blocked after the approval', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {}, {mergeable: 'blocked'}),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'MERGE_BLOCKED'})
    expect(outcome.summary).toContain('did not count')
  })

  it('exits 1 on a 405 for a conflicted pull request', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {}, {mergeable: 'dirty'}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_BLOCKED'})
  })

  it('re-reads an unknown mergeable_state after a 405 before it decides', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {}, {mergeable: 'unknown'}, {mergeable: 'unknown'}, {mergeable: 'behind'}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'OPEN_WAITING'})
    expect(w.sleeps).toEqual([2000, 2000])
  })

  it('gives up on an unknown mergeable_state after three re-reads and exits 1', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {}, {mergeable: 'unknown'}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_BLOCKED'})
    expect(w.sleeps).toEqual([2000, 2000, 2000])
  })

  it('merges after an unknown mergeable_state resolves to clean', async () => {
    const w = world({pulls: script<PullState>({}, {}, {mergeable: 'unknown'}, {mergeable: 'clean'})})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.sleeps).toEqual([2000])
  })

  it('exits 1 when an unknown mergeable_state resolves to blocked and the merge is refused', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {mergeable: 'unknown'}, {mergeable: 'blocked'}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_BLOCKED'})
  })

  it('stops before the merge when the head moved after the approval', async () => {
    const w = world({pulls: script<PullState>({}, {}, {head: MOVED})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'STALE_HEAD'})
    expect(w.log).toEqual(['approve'])
  })

  it('does not re-read a stopped pull request whose mergeable_state is unknown', async () => {
    const w = world({pulls: script<PullState>({}, {}, {head: MOVED, mergeable: 'unknown'})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'STALE_HEAD'})
    expect(w.sleeps).toEqual([])
    expect(w.requests.getPull).toHaveLength(3)
  })

  it('stops before the merge when hold-merge was added after the approval', async () => {
    const w = world({pulls: script<PullState>({}, {}, {labels: ['automerge', 'hold-merge']})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'HOLD_MERGE'})
    expect(w.log).toEqual(['approve'])
  })

  it('exits 1 on any other merge failure when the pull request is not merged', async () => {
    const w = world({
      merge: () => {
        throw apiError(500)
      },
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'MERGE_FAILED'})
    expect(w.requests.merge).toHaveLength(1)
    expect(outcome.summary).not.toContain('secret')
  })

  it('reports merged when an ambiguous merge failure left the pull request merged', async () => {
    const w = world({
      merge: () => {
        throw apiError(502)
      },
      pulls: script<PullState>({}, {}, {}, {merged: true, state: 'closed'}),
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.requests.merge).toHaveLength(1)
  })

  it('exits 1 when the merge answers 200 but did not merge', async () => {
    const w = world({merge: () => ({data: {merged: false, message: 'nope'}})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_FAILED'})
  })

  it('exits 1 when the pull request cannot be re-read after a failed merge', async () => {
    const w = world({
      merge: () => {
        throw apiError(500)
      },
      pulls: script<PullState | Error>({}, {}, {}, apiError(404)),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_UNKNOWN'})
  })
})

describe('selfMerge: summaries for every outcome', () => {
  const heading = (outcome: SelfMergeOutcome) => summaryOf(outcome).split('\n')[0]

  it.each([
    [{pullRequest: null}, {}, 'no pull request'],
    [{qualifies: false}, {}, 'not qualifying'],
  ])('titles the early stops %#', async (input, scenario, title) => {
    const outcome = await selfMerge(world(scenario).input(input))
    expect(heading(outcome)).toBe(`### Promotion self-merge: ${title}`)
  })

  it.each([
    [{state: 'closed' as const}, 'closed unmerged'],
    [{merged: true}, 'already merged'],
    [{head: MOVED}, 'stale head'],
    [{labels: ['needs-review']}, 'not labeled automerge'],
    [{labels: ['automerge', 'hold-merge']}, 'held by hold-merge'],
  ])('titles the pull request stop %j', async (pull, title) => {
    const outcome = await selfMerge(world({pulls: () => pull}).input())
    expect(heading(outcome)).toBe(`### Promotion self-merge: ${title}`)
    expect(outcome.summary).toContain('- Pull request: #77')
    expect(outcome.summary).toContain(`- Pinned commit: \`${PIN}\``)
  })

  it('titles a dry run, a timeout and a failed check', async () => {
    expect(heading(await selfMerge(world({variable: () => undefined}).input({switchAtStart: undefined})))).toBe(
      '### Promotion self-merge: dry run',
    )
    expect(heading(await selfMerge(world({runs: () => []}).input()))).toBe('### Promotion self-merge: timed out')
    expect(heading(await selfMerge(world({runs: () => [{name: 'Lint', conclusion: 'failure'}]}).input()))).toBe(
      '### Promotion self-merge: a required check failed',
    )
  })

  it('titles the protection stops', async () => {
    expect(heading(await selfMerge(world({protection: () => protectionOf([])}).input()))).toBe(
      '### Promotion self-merge: required checks missing',
    )
    expect(heading(await selfMerge(world({protection: () => protectionOf(checksFor(['Lint']))}).input()))).toBe(
      '### Promotion self-merge: required checks missing',
    )
    expect(
      heading(
        await selfMerge(
          world({
            protection: () => {
              throw apiError(404)
            },
          }).input(),
        ),
      ),
    ).toBe('### Promotion self-merge: protection unreadable')
    expect(heading(await selfMerge(world().input({declaredContexts: []})))).toBe(
      '### Promotion self-merge: no declared checks',
    )
  })

  it('titles the switch, approval, merge and API failures', async () => {
    const unreadable = world({
      variable: () => {
        throw apiError(403)
      },
    })
    expect(heading(await selfMerge(unreadable.input()))).toBe('### Promotion self-merge: switch unreadable')
    expect(heading(await selfMerge(world({variable: script<string | undefined>('on', 'off')}).input()))).toBe(
      '### Promotion self-merge: switched off after approval',
    )
    expect(
      heading(
        await selfMerge(
          world({
            approve: () => {
              throw apiError(403)
            },
          }).input(),
        ),
      ),
    ).toBe('### Promotion self-merge: approval failed')
    expect(
      heading(
        await selfMerge(
          world({
            merge: () => {
              throw apiError(409)
            },
          }).input(),
        ),
      ),
    ).toBe('### Promotion self-merge: open, waiting')
    expect(
      heading(
        await selfMerge(
          world({
            merge: () => {
              throw apiError(500)
            },
          }).input(),
        ),
      ),
    ).toBe('### Promotion self-merge: merge failed')
    expect(
      heading(
        await selfMerge(
          world({
            merge: () => {
              throw apiError(405)
            },
            pulls: script<PullState>({}, {}, {}, {mergeable: 'blocked'}),
          }).input(),
        ),
      ),
    ).toBe('### Promotion self-merge: merge blocked')
    expect(heading(await selfMerge(world({pulls: () => apiError(404)}).input()))).toBe(
      '### Promotion self-merge: GitHub API failure',
    )
  })
})

describe('runSelfMerge', () => {
  const SETTINGS = `branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts:\n${DECLARED.map(context => `          - '${context}'`).join('\n')}\n`

  function harness(
    env: Record<string, string | undefined>,
    scenario: Scenario = {},
    settings: () => string = () => SETTINGS,
  ) {
    const w = world(scenario)
    const out: string[] = []
    const err: string[] = []
    const writes: {path: string; content: string}[] = []
    const tokens: (string | undefined)[] = []
    const run = async () =>
      runSelfMerge({
        env: {
          GH_TOKEN: 'pat-value',
          PROMOTION_PR: '77',
          PROMOTION_PIN: PIN,
          PROMOTION_QUALIFIES: 'true',
          PROMOTION_SELF_MERGE: 'on',
          GITHUB_STEP_SUMMARY: '/summary',
          ...env,
        },
        readSettings: settings,
        createClient: async token => {
          tokens.push(token)
          return w.octokit
        },
        now: () => w.clock.now,
        sleep: async ms => {
          w.sleeps.push(ms)
          w.clock.now += ms
        },
        signal: ms => AbortSignal.timeout(ms),
        stdout: text => out.push(text),
        stderr: text => err.push(text),
        append: (path, content) => writes.push({path, content}),
      })
    return {run, w, out, err, writes, tokens}
  }

  it('merges a qualifying promotion, prints the outcome code and writes the summary', async () => {
    const h = harness({})
    expect(await h.run()).toBe(0)
    expect(h.w.log).toEqual(['approve', 'merge'])
    expect(h.out).toEqual(['promotion-self-merge: MERGED\n'])
    expect(h.err).toEqual([])
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0]?.path).toBe('/summary')
    expect(h.writes[0]?.content).toContain('### Promotion self-merge: merged')
    expect(h.tokens).toEqual(['pat-value'])
  })

  it('reads the declared contexts from the settings it was given', async () => {
    const h = harness({}, {protection: () => protectionOf(checksFor(['Lint']))})
    expect(await h.run()).toBe(1)
    expect(h.err).toEqual(['::error::promotion-self-merge: PROTECTION_SHORT\n'])
    expect(h.out).toEqual([])
    expect(h.writes[0]?.content).toContain('required checks missing')
  })

  it('has nothing to do, without a token, when there is no pull request', async () => {
    const h = harness({PROMOTION_PR: '', GH_TOKEN: undefined})
    expect(await h.run()).toBe(0)
    expect(h.out).toEqual(['promotion-self-merge: NO_PULL_REQUEST\n'])
    expect(h.tokens).toEqual([])
  })

  it('treats an unset pull request the same way', async () => {
    const h = harness({PROMOTION_PR: undefined, GH_TOKEN: undefined})
    expect(await h.run()).toBe(0)
    expect(h.out).toEqual(['promotion-self-merge: NO_PULL_REQUEST\n'])
  })

  it('leaves a promotion that does not qualify alone, without a token', async () => {
    for (const value of ['false', '', undefined, 'TRUE']) {
      const h = harness({PROMOTION_QUALIFIES: value, GH_TOKEN: undefined})
      expect(await h.run()).toBe(0)
      expect(h.out).toEqual(['promotion-self-merge: NOT_QUALIFYING\n'])
      expect(h.tokens).toEqual([])
    }
  })

  it.each(['abc', '0', '-1', '1.5', '07x', ' 7'])(
    'rejects the pull request number %j with a fixed line',
    async value => {
      const h = harness({PROMOTION_PR: value})
      expect(await h.run()).toBe(1)
      expect(h.err).toEqual(['::error::promotion-self-merge: INVALID_PULL_REQUEST\n'])
    },
  )

  it.each(['abc', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), '', undefined])('rejects the pin %j', async value => {
    const h = harness({PROMOTION_PIN: value})
    expect(await h.run()).toBe(1)
    expect(h.err).toEqual(['::error::promotion-self-merge: INVALID_PIN\n'])
  })

  it.each(['', undefined])('fails closed without a token (%j)', async value => {
    const h = harness({GH_TOKEN: value})
    expect(await h.run()).toBe(1)
    expect(h.err).toEqual(['::error::promotion-self-merge: MISSING_TOKEN\n'])
    expect(h.tokens).toEqual([])
  })

  it('fails with a fixed line when the settings cannot be read or parsed', async () => {
    const unreadable = harness({}, {}, () => {
      throw new Error('ENOENT: /secret/path')
    })
    expect(await unreadable.run()).toBe(1)
    expect(unreadable.err).toEqual(['::error::promotion-self-merge: SETTINGS_UNREADABLE\n'])
    const broken = harness({}, {}, () => 'a: [unclosed')
    expect(await broken.run()).toBe(1)
    expect(broken.err).toEqual(['::error::promotion-self-merge: SETTINGS_UNREADABLE\n'])
  })

  it('fails with a fixed line when the client cannot be created, leaking no message', async () => {
    const err: string[] = []
    const code = await runSelfMerge({
      env: {GH_TOKEN: 'pat-value', PROMOTION_PR: '77', PROMOTION_PIN: PIN, PROMOTION_QUALIFIES: 'true'},
      readSettings: () => SETTINGS,
      createClient: async () => {
        throw new Error('token pat-value rejected')
      },
      now: () => 0,
      sleep: async () => {},
      signal: ms => AbortSignal.timeout(ms),
      stdout: () => {},
      stderr: text => err.push(text),
      append: () => {},
    })
    expect(code).toBe(1)
    expect(err).toEqual(['::error::promotion-self-merge: API_FAILED\n'])
  })

  it('treats a PROMOTION_SELF_MERGE of exactly on as the live start', async () => {
    const live = harness(
      {PROMOTION_SELF_MERGE: 'on'},
      {
        variable: () => {
          throw apiError(403)
        },
      },
    )
    expect(await live.run()).toBe(1)
    const dry = harness(
      {PROMOTION_SELF_MERGE: undefined},
      {
        variable: () => {
          throw apiError(403)
        },
      },
    )
    expect(await dry.run()).toBe(0)
    expect(dry.out).toEqual(['promotion-self-merge: DRY_RUN\n'])
  })

  it('prints no token, no error body and no payload on any stream', async () => {
    const h = harness(
      {},
      {
        approve: () => {
          throw apiError(403, 'Bearer pat-value leaked')
        },
      },
    )
    await h.run()
    expect([...h.out, ...h.err].join('')).not.toContain('pat-value')
    expect(h.writes.map(write => write.content).join('')).not.toContain('pat-value')
    expect(h.writes.map(write => write.content).join('')).not.toContain('leaked')
  })

  it('writes no summary outside Actions', async () => {
    const h = harness({GITHUB_STEP_SUMMARY: undefined})
    expect(await h.run()).toBe(0)
    expect(h.writes).toEqual([])
  })
})

describe('selfMerge: the full text of every summary', () => {
  const facts = (withPullRequest = true) => [
    ...(withPullRequest ? ['- Pull request: #77'] : []),
    `- Pinned commit: \`${PIN}\``,
    '',
  ]
  const summary = (title: string, detail: string, withPullRequest = true) =>
    [`### Promotion self-merge: ${title}`, '', detail, '', ...facts(withPullRequest)].join('\n')
  const AFTER =
    'The approval was already submitted as `fro-bot` on the pinned commit and stays on the pull request until the head moves or someone dismisses it; check the pull request.'
  /** A summary of a run that had already approved: the detail, then the sentence about the approval. */
  const approvedSummary = (title: string, detail: string) => summary(title, `${detail} ${AFTER}`)

  const throwing = (status: number) => () => {
    throw apiError(status)
  }

  const cases: readonly (readonly [string, () => Promise<SelfMergeOutcome>, string])[] = [
    [
      'no pull request',
      async () => selfMerge(world().input({pullRequest: null})),
      summary(
        'no pull request',
        'The PR step opened no promotion pull request, so there is nothing to approve.',
        false,
      ),
    ],
    [
      'not qualifying',
      async () => selfMerge(world().input({qualifies: false})),
      summary(
        'not qualifying',
        'The promotion has a path outside `knowledge/` and `metadata/`, so it waits for the operator. Nothing was approved.',
      ),
    ],
    [
      'closed unmerged',
      async () => selfMerge(world({pulls: () => ({state: 'closed'})}).input()),
      summary('closed unmerged', 'The pull request is closed and not merged. Nothing was approved.'),
    ],
    [
      'already merged',
      async () => selfMerge(world({pulls: () => ({merged: true})}).input()),
      summary('already merged', 'The pull request is already merged. Nothing was approved.'),
    ],
    [
      'stale head',
      async () => selfMerge(world({pulls: () => ({head: MOVED})}).input()),
      summary(
        'stale head',
        'The pull request head is not the pinned commit the promotion gates checked, so nothing was approved. The next daily run handles the new head.',
      ),
    ],
    [
      'not labeled',
      async () => selfMerge(world({pulls: () => ({labels: []})}).input()),
      summary('not labeled automerge', 'The pull request does not carry the `automerge` label. Nothing was approved.'),
    ],
    [
      'hold-merge',
      async () => selfMerge(world({pulls: () => ({labels: ['automerge', 'hold-merge']})}).input()),
      summary(
        'held by hold-merge',
        'The pull request carries the `hold-merge` label, so it waits for the operator. Nothing was approved.',
      ),
    ],
    [
      'dry run',
      async () => selfMerge(world({variable: () => 'off'}).input()),
      summary(
        'dry run',
        'Dry run: the repository variable `PROMOTION_SELF_MERGE` is not `on`, so the run would approve and merge the pull request but did not. Nothing was approved.',
      ),
    ],
    [
      'empty protection',
      async () => selfMerge(world({protection: () => protectionOf([])}).input()),
      summary(
        'required checks missing',
        'The live required-check list for `main` is empty, so the checks this promotion must pass are unknown. Nothing was approved.',
      ),
    ],
    [
      'short protection',
      async () => selfMerge(world({protection: () => protectionOf(checksFor(['Lint']))}).input()),
      summary(
        'required checks missing',
        'The live required-check list for `main` is missing declared contexts: `Test`, `Security: Private Leak Scan`, `CodeQL`. Nothing was approved.',
      ),
    ],
    [
      'unreadable protection',
      async () => selfMerge(world({protection: throwing(404)}).input()),
      summary(
        'protection unreadable',
        'The branch protection of `main` could not be read, so the required checks are unknown. Nothing was approved.',
      ),
    ],
    [
      'nothing declared',
      async () => selfMerge(world().input({declaredContexts: []})),
      summary(
        'no declared checks',
        'No required contexts are declared for `main` in `.github/settings.yml`, so the live list cannot be compared. Nothing was approved.',
      ),
    ],
    [
      'required checks kept changing',
      async () => {
        let reads = 0
        return selfMerge(
          world({
            protection: () => {
              reads += 1
              return protectionOf([...checksFor(DECLARED), {context: `Extra ${String(reads)}`, app_id: 15_368}])
            },
            runs: () => [
              ...GREEN_RUNS,
              ...Array.from({length: 10}, (_, index) => ({name: `Extra ${String(index + 1)}`})),
            ],
          }).input(),
        )
      },
      summary(
        'required checks kept changing',
        'The required checks for `main` kept changing while the run waited, so the run stopped before it settled on a list. The pull request stays open and the next daily run starts again. Nothing was approved.',
      ),
    ],
    [
      'failed checks',
      async () =>
        selfMerge(
          world({
            runs: () => [
              {name: 'Lint', conclusion: 'failure'},
              {name: 'Test', conclusion: 'cancelled'},
              {name: 'CodeQL', app: 57_789},
            ],
          }).input(),
        ),
      summary(
        'a required check failed',
        'These required checks failed on the pinned commit: `Lint`, `Test`. Nothing was approved.',
      ),
    ],
    [
      'timeout',
      async () => selfMerge(world({runs: () => [{name: 'CodeQL', app: 57_789}]}).input()),
      summary(
        'timed out',
        'The required checks did not settle within 60 minutes (still waiting on: `Lint`, `Test`). The pull request stays open and the next daily run catches it up and merges it. Nothing was approved.',
      ),
    ],
    [
      'unreadable switch',
      async () => selfMerge(world({variable: throwing(403)}).input()),
      summary(
        'switch unreadable',
        'The repository variable `PROMOTION_SELF_MERGE` could not be read, so the run cannot tell whether self-merge is on.',
      ),
    ],
    [
      'switched off',
      async () => selfMerge(world({variable: script<string | undefined>('on', 'off')}).input()),
      approvedSummary(
        'switched off after approval',
        'The pull request was approved, then `PROMOTION_SELF_MERGE` was turned off before the merge, so it was not merged.',
      ),
    ],
    [
      'approval failed',
      async () => selfMerge(world({approve: throwing(403)}).input()),
      summary('approval failed', 'GitHub refused the approval, so the pull request was not merged.'),
    ],
    [
      'open waiting',
      async () => selfMerge(world({merge: throwing(409)}).input()),
      approvedSummary(
        'open, waiting',
        'GitHub refused the merge because the head or the base moved. The pull request stays open and the next daily run handles it.',
      ),
    ],
    [
      'merge blocked',
      async () =>
        selfMerge(world({merge: throwing(405), pulls: script<PullState>({}, {}, {}, {mergeable: 'blocked'})}).input()),
      approvedSummary(
        'merge blocked',
        'GitHub refused the merge although the pull request was approved: the approval did not count or a change request is outstanding. The pull request stays open.',
      ),
    ],
    [
      'merge failed',
      async () => selfMerge(world({merge: throwing(500)}).input()),
      approvedSummary('merge failed', 'The merge did not complete and the pull request is not merged.'),
    ],
    [
      'API failure',
      async () => selfMerge(world({pulls: throwing(404)}).input()),
      summary('GitHub API failure', 'A GitHub API call failed, so the run stopped. Nothing further was done.'),
    ],
    [
      'merged',
      async () => selfMerge(world().input()),
      summary(
        'merged',
        'The promotion gates passed on the pinned commit, the required checks passed on it, and the pull request was approved as `fro-bot` and squash-merged pinned to it.',
      ),
    ],
  ]

  it.each(cases)('%s', async (_name, run, expected) => {
    expect((await run()).summary).toBe(expected)
  })
})

describe('selfMerge: odd thrown values and response shapes', () => {
  it.each([null, undefined, 'a string', 42, {status: '503'}, {status: null}, {code: 'EOTHER'}])(
    'does not retry or crash on a thrown %j, and fails the approval cleanly',
    async thrown => {
      const w = world({
        approve: () => {
          throw thrown
        },
      })
      expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'APPROVE_FAILED'})
      expect(w.requests.getPull).toHaveLength(2)
    },
  )

  it.each([null, undefined, 'a string', {status: '503'}])('treats a thrown %j on a read as final', async thrown => {
    const w = world({
      pulls: () => {
        throw thrown
      },
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'API_FAILED'})
    expect(w.requests.getPull).toHaveLength(1)
    expect(w.sleeps).toEqual([])
  })

  it('stops with an empty list when the protection has no required_status_checks', async () => {
    const w = world({protection: () => ({data: {protection: {}}})})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_EMPTY'})
  })

  it('reads a check run with no app as belonging to no app', async () => {
    const anyApp = world({
      protection: () => protectionOf(DECLARED.map(context => ({context, app_id: null}))),
      runs: () => [
        {name: 'Lint', app: null},
        {name: 'Test', app: null},
        {name: 'CodeQL', app: null},
      ],
    })
    expect(await selfMerge(anyApp.input())).toMatchObject(LIVE)
    const named = world({runs: () => [{name: 'Lint', app: null}, {name: 'Test'}, {name: 'CodeQL', app: 57_789}]})
    expect(await selfMerge(named.input())).toMatchObject({code: 'TIMEOUT'})
  })

  it('stops as stale when the head moved between a refused merge and the re-read', async () => {
    const w = world({
      merge: () => {
        throw apiError(405)
      },
      pulls: script<PullState>({}, {}, {}, {head: MOVED}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'STALE_HEAD'})
  })
})

describe('runSelfMerge: values it passes on', () => {
  const SETTINGS = `branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts:\n${DECLARED.map(context => `          - '${context}'`).join('\n')}\n`

  function drive(env: Record<string, string | undefined>, scenario: Scenario = {}) {
    const w = world(scenario)
    const writes: string[] = []
    const out: string[] = []
    const run = async () =>
      runSelfMerge({
        env: {GH_TOKEN: 't', GITHUB_STEP_SUMMARY: '/s', ...env},
        readSettings: () => SETTINGS,
        createClient: async () => w.octokit,
        now: () => w.clock.now,
        sleep: async ms => {
          w.clock.now += ms
        },
        signal: ms => AbortSignal.timeout(ms),
        stdout: text => out.push(text),
        stderr: () => {},
        append: (_path, content) => writes.push(content),
      })
    return {run, w, writes, out}
  }

  const live = {PROMOTION_PR: '7', PROMOTION_PIN: PIN, PROMOTION_QUALIFIES: 'true', PROMOTION_SELF_MERGE: 'on'}

  it('accepts a one-digit and a four-digit pull request number', async () => {
    for (const number of ['7', '1234']) {
      const h = drive({...live, PROMOTION_PR: number})
      expect(await h.run()).toBe(0)
      expect((h.w.requests.getPull?.[0] as {pull_number: number}).pull_number).toBe(Number(number))
    }
  })

  it('addresses fro-bot/.github, branch main, and the repository variable', async () => {
    const h = drive(live)
    await h.run()
    expect(h.w.requests.getBranch?.[0]).toEqual({owner: 'fro-bot', repo: '.github', branch: 'main'})
    expect(h.w.requests.getPull?.[0]).toEqual({owner: 'fro-bot', repo: '.github', pull_number: 7})
  })

  it('writes the full summary of an early stop, with no pull request line when there is none', async () => {
    const none = drive({...live, PROMOTION_PR: undefined, PROMOTION_PIN: undefined})
    await none.run()
    expect(none.writes).toEqual([
      '### Promotion self-merge: no pull request\n\nThe PR step opened no promotion pull request, so there is nothing to approve.\n\n- Pinned commit: not available\n',
    ])
    const unqualified = drive({...live, PROMOTION_QUALIFIES: 'false'})
    await unqualified.run()
    expect(unqualified.writes).toEqual([
      `### Promotion self-merge: not qualifying\n\nThe promotion has a path outside \`knowledge/\` and \`metadata/\`, so it waits for the operator. Nothing was approved.\n\n- Pull request: #7\n- Pinned commit: \`${PIN}\`\n`,
    ])
  })

  it('prints the outcome code on stdout for a stop with exit 0', async () => {
    const unqualified = drive({...live, PROMOTION_QUALIFIES: 'false'})
    await unqualified.run()
    expect(unqualified.out).toEqual(['promotion-self-merge: NOT_QUALIFYING\n'])
  })
})

describe('selfMerge: a run that started as a dry run stays one', () => {
  it('does not approve or merge when the variable is turned on during the wait, and never reads it', async () => {
    const w = world({variable: () => 'on', runs: poll => (poll < 3 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS)})
    const outcome = await selfMerge(w.input({switchAtStart: undefined}))
    expect(outcome).toMatchObject({exitCode: 0, code: 'DRY_RUN'})
    expect(w.log).toEqual([])
    expect(w.requests.approve).toBeUndefined()
    expect(w.requests.merge).toBeUndefined()
    expect(w.requests.getVariable).toBeUndefined()
    expect(w.sleeps).toEqual([MINUTE, MINUTE])
  })

  it.each(['off', '', 'ON', 'true'])('stays a dry run when it started as %j and the variable reads on', async value => {
    const w = world({variable: () => 'on'})
    expect(await selfMerge(w.input({switchAtStart: value}))).toMatchObject({code: 'DRY_RUN'})
    expect(w.log).toEqual([])
  })

  it('does not approve when it started live and the variable is off at the approval', async () => {
    const w = world({variable: script<string | undefined>('off')})
    expect(await selfMerge(w.input({switchAtStart: 'on'}))).toMatchObject({exitCode: 0, code: 'DRY_RUN'})
    expect(w.log).toEqual([])
    expect(w.requests.getVariable).toHaveLength(1)
  })

  it('does not merge when it started live and the variable is off at the merge', async () => {
    const w = world({variable: script<string | undefined>('on', 'off')})
    expect(await selfMerge(w.input({switchAtStart: 'on'}))).toMatchObject({exitCode: 0, code: 'SWITCH_TURNED_OFF'})
    expect(w.log).toEqual(['approve'])
  })
})

describe('selfMerge: required checks that change during the wait', () => {
  const withExtra = [...checksFor(DECLARED), {context: 'Extra', app_id: 15_368}]
  const extraDone = (poll: number): readonly RunState[] => [
    ...GREEN_RUNS,
    poll < 3 ? {name: 'Extra', status: 'in_progress', conclusion: null} : {name: 'Extra'},
  ]

  it('drops a pending context that was removed from the live list, and goes on to merge (the probe)', async () => {
    // `Old` never reports. The first poll still sees it; the second sees a list without it.
    const w = world({
      protection: script(protectionOf(withExtra), protectionOf(withExtra), protectionOf(checksFor(DECLARED))),
      runs: () => GREEN_RUNS,
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject(LIVE)
    expect(w.log).toEqual(['approve', 'merge'])
    expect(w.sleeps).toEqual([MINUTE])
  })

  it('stops holding the wait for a removed context after a few polls of it, not after 61', async () => {
    const readsOf = (reads: number) => {
      let n = 0
      return () => {
        n += 1
        return protectionOf(n <= reads ? withExtra : checksFor(DECLARED))
      }
    }
    const w = world({protection: readsOf(4), runs: () => GREEN_RUNS})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.polls()).toBeLessThan(10)
  })

  it('starts the wait over on a context that is added mid-wait, and waits for it', async () => {
    let reads = 0
    const w = world({
      protection: () => {
        reads += 1
        return protectionOf(reads >= 3 ? withExtra : checksFor(DECLARED))
      },
      runs: poll => (poll < 2 ? GREEN_RUNS.slice(0, 1) : extraDone(poll)),
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    expect(w.log).toEqual(['approve', 'merge'])
  })

  it('fails the run on an added context that fails, and approves nothing', async () => {
    let reads = 0
    const w = world({
      protection: () => {
        reads += 1
        return protectionOf(reads >= 3 ? withExtra : checksFor(DECLARED))
      },
      runs: poll => (poll < 2 ? GREEN_RUNS.slice(0, 1) : [...GREEN_RUNS, {name: 'Extra', conclusion: 'failure'}]),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
    expect(outcome.summary).toContain('`Extra`')
    expect(w.log).toEqual([])
  })

  it('starts over when a required context is bound to another app mid-wait', async () => {
    const rebound = checksFor(DECLARED).map(check => (check.context === 'Lint' ? {...check, app_id: 99} : check))
    let reads = 0
    const w = world({
      protection: () => {
        reads += 1
        return protectionOf(reads >= 3 ? rebound : checksFor(DECLARED))
      },
      runs: poll =>
        poll < 2 ? GREEN_RUNS.slice(0, 1) : [...GREEN_RUNS, {name: 'Lint', app: 99, conclusion: 'failure'}],
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'CHECK_FAILED'})
    expect(outcome.summary).toContain('`Lint`')
    expect(w.log).toEqual([])
  })

  it('reads the live list on every poll, and once more after the last poll', async () => {
    const w = world({runs: poll => (poll < 3 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS)})
    await selfMerge(w.input())
    // before the wait, three polls, and the re-read after them
    expect(w.requests.getBranch).toHaveLength(5)
  })

  it('does not start over when the list is the same', async () => {
    const w = world()
    await selfMerge(w.input())
    expect(w.requests.getBranch).toHaveLength(3)
    expect(w.polls()).toBe(1)
  })

  it('keeps every restart inside the same 60-minute deadline', async () => {
    let reads = 0
    const w = world({
      protection: () => {
        reads += 1
        return protectionOf(reads >= 50 ? withExtra : checksFor(DECLARED))
      },
      runs: () => [...GREEN_RUNS.slice(0, 1), {name: 'Extra', status: 'queued', conclusion: null}],
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.clock.now - 1_000_000).toBe(60 * MINUTE)
    expect(w.log).toEqual([])
  })

  it('stops before approving when the list keeps changing', async () => {
    let reads = 0
    const w = world({
      protection: () => {
        reads += 1
        return protectionOf([...checksFor(DECLARED), {context: `Extra ${String(reads)}`, app_id: 15_368}])
      },
      runs: () => [...GREEN_RUNS, ...Array.from({length: 20}, (_, index) => ({name: `Extra ${String(index + 1)}`}))],
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'PROTECTION_CHANGED'})
    expect(w.requests.getBranch).toHaveLength(5)
    expect(w.log).toEqual([])
    expect(outcome.summary).toContain('kept changing')
  })

  it('stops when the live list weakens mid-wait', async () => {
    const w = world({
      protection: script(protectionOf(checksFor(DECLARED)), protectionOf(checksFor(['Lint']))),
      runs: () => GREEN_RUNS.slice(0, 1),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_SHORT'})
    expect(w.log).toEqual([])
  })

  it('stops with exit 1 when the live list cannot be read mid-wait, after retrying a transient failure', async () => {
    const w = world({
      protection: script<unknown>(protectionOf(checksFor(DECLARED)), apiError(503), protectionOf(checksFor(DECLARED))),
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    const gone = world({protection: script<unknown>(protectionOf(checksFor(DECLARED)), apiError(404))})
    expect(await selfMerge(gone.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_UNREADABLE'})
    expect(gone.log).toEqual([])
  })

  it('stops when the re-read list no longer holds a declared context', async () => {
    const w = world({protection: script(protectionOf(checksFor(DECLARED)), protectionOf(checksFor(['Lint'])))})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_SHORT'})
  })
})

describe('selfMerge: one deadline for every request', () => {
  const HOUR = 60 * MINUTE

  it('ends a wait with TIMEOUT when one request outlasts the deadline, without another request', async () => {
    const w = world({
      runs: () => GREEN_RUNS.slice(0, 1),
      callCost: (name, count) => (name === 'listRuns' && count === 2 ? HOUR + MINUTE : 0),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(outcome.summary).toContain('did not settle within 60 minutes')
    expect(w.requests.listStatuses).toHaveLength(1)
    expect(w.log).toEqual([])
  })

  it('stops paging when the deadline passes in the middle of a poll', async () => {
    const full = Array.from({length: 100}, (_, index) => ({id: 1000 + index, name: `Other ${String(index)}`}))
    const w = world({runs: () => full, callCost: name => (name === 'listRuns' ? MINUTE : 0)})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.requests.listRuns?.length).toBeLessThanOrEqual(62)
  })

  it('ends with TIMEOUT when the first read already used the whole wait', async () => {
    const w = world({callCost: name => (name === 'getBranch' ? HOUR + MINUTE : 0)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.requests.getPull).toBeUndefined()
  })

  it('does not retry a request past the deadline', async () => {
    const w = world({
      runs: script<readonly RunState[] | Error>(apiError(503)),
      callCost: name => (name === 'listRuns' ? HOUR + 1000 : 0),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.requests.listRuns).toHaveLength(1)
  })

  it('leaves time after the wait for the reads, the approval and the merge', async () => {
    const w = world({callCost: (name, count) => (name === 'getBranch' && count === 3 ? 9 * MINUTE : 0)})
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('ends with TIMEOUT when the time after the wait runs out before the approval', async () => {
    const w = world({callCost: (name, count) => (name === 'getBranch' && count === 3 ? 71 * MINUTE : 0)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(outcome.summary).toContain('time reserved for the approval and the merge ran out')
    expect(outcome.summary).not.toContain('did not settle')
    expect(w.log).toEqual([])
  })

  it('ends with TIMEOUT before the merge, and says the approval was submitted', async () => {
    const w = world({callCost: (name, count) => (name === 'getVariable' && count === 2 ? 76 * MINUTE : 0)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.log).toEqual(['approve'])
    expect(outcome.summary).toContain('already submitted')
  })

  it('counts the hard deadline from the start of the run, not from the end of the wait', async () => {
    const w = world({
      runs: poll => (poll < 40 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS),
      callCost: (name, count) => (name === 'getVariable' && count === 1 ? 40 * MINUTE : 0),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({code: 'TIMEOUT'})
    expect(w.log).toEqual([])
  })
})

describe('selfMerge: every outcome after the approval says it was submitted', () => {
  const submitted = 'already submitted as `fro-bot` on the pinned commit'

  const cases: readonly (readonly [string, string, Scenario])[] = [
    ['STALE_HEAD', 'the head moved', {pulls: script<PullState>({}, {}, {head: MOVED})}],
    ['HOLD_MERGE', 'hold-merge was added', {pulls: script<PullState>({}, {}, {labels: ['automerge', 'hold-merge']})}],
    ['CLOSED_UNMERGED', 'the pull request closed', {pulls: script<PullState>({}, {}, {state: 'closed'})}],
    ['ALREADY_MERGED', 'the pull request merged', {pulls: script<PullState>({}, {}, {merged: true})}],
    ['NOT_LABELED', 'the label was removed', {pulls: script<PullState>({}, {}, {labels: []})}],
    ['SWITCH_TURNED_OFF', 'the switch was turned off', {variable: script<string | undefined>('on', 'off')}],
    [
      'SWITCH_UNREADABLE',
      'the switch became unreadable',
      {variable: script<string | undefined | Error>('on', apiError(403))},
    ],
    [
      'OPEN_WAITING',
      'the merge answered 409',
      {
        merge: () => {
          throw apiError(409)
        },
      },
    ],
    [
      'MERGE_BLOCKED',
      'the merge was blocked',
      {
        merge: () => {
          throw apiError(405)
        },
        pulls: script<PullState>({}, {}, {}, {mergeable: 'blocked'}),
      },
    ],
    [
      'MERGE_FAILED',
      'the merge failed',
      {
        merge: () => {
          throw apiError(500)
        },
        pulls: script<PullState | Error>({}, {}, {}, {}, {}, {}, {}, {}),
      },
    ],
    ['MERGE_FAILED', 'the merge did not merge', {merge: () => ({data: {merged: false}})}],
    ['API_FAILED', 'a read failed after the approval', {pulls: script<PullState | Error>({}, {}, apiError(404))}],
  ]

  it.each(cases)('%s (%s)', async (code, _why, scenario) => {
    const w = world(scenario)
    const outcome = await selfMerge(w.input())
    expect(outcome.code).toBe(code)
    expect(w.log[0]).toBe('approve')
    expect(outcome.summary).toContain(submitted)
    expect(outcome.summary).toContain('check the pull request')
    expect(outcome.summary).not.toContain('Nothing was approved')
    expect(outcome.summary).not.toContain('Nothing further was done')
  })

  it('keeps the merged summary as it is', async () => {
    const outcome = await selfMerge(world().input())
    expect(outcome.summary).not.toContain('already submitted')
  })

  it.each([
    ['STALE_HEAD', {pulls: () => ({head: MOVED})}],
    ['HOLD_MERGE', {pulls: () => ({labels: ['automerge', 'hold-merge']})}],
    [
      'APPROVE_FAILED',
      {
        approve: () => {
          throw apiError(403)
        },
      },
    ],
    ['API_FAILED', {pulls: () => apiError(404)}],
    ['DRY_RUN', {variable: () => 'off'}],
  ] as const)('does not say an approval was submitted when %s stops the run before it', async (code, scenario) => {
    const outcome = await selfMerge(world(scenario).input({switchAtStart: code === 'DRY_RUN' ? undefined : 'on'}))
    expect(outcome.code).toBe(code)
    expect(outcome.summary).not.toContain('already submitted')
  })

  it('says a refused approval was not submitted', async () => {
    const w = world({
      approve: () => {
        throw apiError(403)
      },
    })
    const outcome = await selfMerge(w.input())
    expect(outcome.code).toBe('APPROVE_FAILED')
    expect(outcome.summary).not.toContain('already submitted')
  })
})

describe('runSelfMerge: a summary for every early stop', () => {
  const SETTINGS = `branches:\n  - name: main\n    protection:\n      required_status_checks:\n        contexts:\n${DECLARED.map(context => `          - '${context}'`).join('\n')}\n`

  function drive(env: Record<string, string | undefined>, options: {settings?: () => string; client?: boolean} = {}) {
    const w = world()
    const writes: string[] = []
    const out: string[] = []
    const err: string[] = []
    const run = async () =>
      runSelfMerge({
        env: {GH_TOKEN: 'pat-value', GITHUB_STEP_SUMMARY: '/s', ...env},
        readSettings: options.settings ?? (() => SETTINGS),
        createClient: async () => {
          if (options.client === false) throw new Error('token pat-value rejected')
          return w.octokit
        },
        now: () => w.clock.now,
        sleep: async ms => {
          w.clock.now += ms
        },
        signal: ms => AbortSignal.timeout(ms),
        stdout: text => out.push(text),
        stderr: text => err.push(text),
        append: (_path, content) => writes.push(content),
      })
    return {run, writes, out, err}
  }

  const base = {PROMOTION_PR: '7', PROMOTION_PIN: PIN, PROMOTION_QUALIFIES: 'true', PROMOTION_SELF_MERGE: 'on'}
  const facts = `- Pull request: #7\n- Pinned commit: \`${PIN}\`\n`

  it('explains a pull request number that is not a number, without echoing it', async () => {
    const h = drive({...base, PROMOTION_PR: 'abc `<script>`'})
    expect(await h.run()).toBe(1)
    expect(h.writes).toEqual([
      `### Promotion self-merge: invalid pull request number\n\nThe pull request number from the PR step is not a positive integer, so the run stopped before it read anything. Check the "Open data merge PR" step and its outputs.\n\n- Pinned commit: \`${PIN}\`\n`,
    ])
    expect(h.err).toEqual(['::error::promotion-self-merge: INVALID_PULL_REQUEST\n'])
    expect(h.writes.join('')).not.toContain('script')
  })

  it('explains a pin that is not a commit, without echoing it', async () => {
    const h = drive({...base, PROMOTION_PIN: 'not-a-sha `x`'})
    expect(await h.run()).toBe(1)
    expect(h.writes).toEqual([
      '### Promotion self-merge: invalid pinned commit\n\nThe pinned commit from the pin step is not a 40-character commit id, so the run stopped before it read anything. Check the "Pin the data commit" step.\n\n- Pull request: #7\n- Pinned commit: not available\n',
    ])
    expect(h.writes.join('')).not.toContain('not-a-sha')
  })

  it('explains a missing token', async () => {
    const h = drive({...base, GH_TOKEN: ''})
    expect(await h.run()).toBe(1)
    expect(h.writes).toEqual([
      `### Promotion self-merge: no token\n\nThe step has no \`FRO_BOT_PAT\`, so it cannot read the checks or approve. Check the repository secret and the step's env.\n\n${facts}`,
    ])
  })

  it('explains settings that cannot be read, without the error', async () => {
    const h = drive(base, {
      settings: () => {
        throw new Error('ENOENT: /secret/path')
      },
    })
    expect(await h.run()).toBe(1)
    expect(h.writes).toEqual([
      `### Promotion self-merge: settings unreadable\n\n\`.github/settings.yml\` could not be read or parsed, so the declared checks are unknown. Check the file on \`main\`.\n\n${facts}`,
    ])
    expect(h.writes.join('')).not.toContain('secret')
  })

  it('explains a client that cannot be created, without the error', async () => {
    const h = drive(base, {client: false})
    expect(await h.run()).toBe(1)
    expect(h.writes).toEqual([
      `### Promotion self-merge: GitHub API failure\n\nThe GitHub client could not be created, so the run stopped before it read anything. Check the token.\n\n${facts}`,
    ])
    expect(h.writes.join('')).not.toContain('pat-value')
  })

  it('shows no pull request line and no pin when the PR step opened none', async () => {
    const h = drive({...base, PROMOTION_PR: undefined, PROMOTION_PIN: undefined})
    expect(await h.run()).toBe(0)
    expect(h.writes[0]).toContain('- Pinned commit: not available\n')
    expect(h.writes[0]).not.toContain('Pull request:')
  })
})

describe('selfMerge: boundaries of the deadline and of the summaries', () => {
  const HOUR = 60 * MINUTE
  // Checks pending until the poll at minute 58, so the wait ends one or two minutes before its deadline.
  const lateRuns = (poll: number): readonly RunState[] => (poll < 59 ? GREEN_RUNS.slice(0, 1) : GREEN_RUNS)

  it('gives the approval and the merge 10 minutes after the wait: a recheck ending at minute 67 still merges', async () => {
    const w = world({
      runs: lateRuns,
      callCost: (name, count) => (name === 'getBranch' && count === 61 ? 9 * MINUTE : 0),
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
  })

  it('and not a minute more: a recheck ending after minute 70 times out', async () => {
    const w = world({
      runs: lateRuns,
      callCost: (name, count) => (name === 'getBranch' && count === 61 ? 13 * MINUTE : 0),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(outcome.summary).toContain('time reserved for the approval and the merge ran out')
    expect(w.log).toEqual([])
  })

  it('ends with TIMEOUT, not a protection failure, when the deadline passes as the protection is re-read', async () => {
    const w = world({callCost: (name, count) => (name === 'listStatuses' && count === 1 ? 76 * MINUTE : 0)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.requests.getBranch).toHaveLength(2)
  })

  it('ends with TIMEOUT, not an unreadable switch, when the deadline passes as the switch is read', async () => {
    const w = world({callCost: (name, count) => (name === 'getPull' && count === 2 ? 76 * MINUTE : 0)})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.requests.getVariable).toBeUndefined()
    expect(w.log).toEqual([])
  })

  it('does not look the merge up again when the merge answers 200 and says it did not merge', async () => {
    const w = world({
      merge: () => ({data: {merged: false}}),
      pulls: script<PullState>({}, {}, {}, {merged: true, state: 'closed'}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_FAILED'})
    expect(w.requests.getPull).toHaveLength(3)
  })

  it('says only that the wait ran out when no poll finished', async () => {
    const w = world({callCost: name => (name === 'getBranch' ? HOUR + MINUTE : 0)})
    const outcome = await selfMerge(w.input())
    expect(outcome.summary).toBe(
      [
        '### Promotion self-merge: timed out',
        '',
        'The required checks did not settle within 60 minutes. The pull request stays open and the next daily run catches it up and merges it. Nothing was approved.',
        '',
        '- Pull request: #77',
        `- Pinned commit: \`${PIN}\``,
        '',
      ].join('\n'),
    )
  })

  it.each(['a'.repeat(41), `!${'a'.repeat(40)}`, `${'a'.repeat(40)}!`, 'A'.repeat(40), 'g'.repeat(40), ''])(
    'shows a pin that is not a commit id as not available (%j)',
    async pin => {
      const outcome = await selfMerge(world().input({pin, qualifies: false}))
      expect(outcome.summary).toContain('- Pinned commit: not available\n')
      expect(outcome.summary).not.toContain(pin === '' ? '`' + '`' : pin)
    },
  )

  it('makes one poll and two protection reads for a check that failed, not a restart', async () => {
    const w = world({
      runs: () => [{name: 'Lint', conclusion: 'failure'}, {name: 'Test'}, {name: 'CodeQL', app: 57_789}],
    })
    await selfMerge(w.input())
    expect(w.polls()).toBe(1)
    expect(w.requests.getBranch).toHaveLength(2)
  })

  it('makes no restart when the protection re-read fails', async () => {
    const w = world({protection: script(protectionOf(checksFor(DECLARED)), protectionOf(checksFor(['Lint'])))})
    await selfMerge(w.input())
    expect(w.requests.getBranch).toHaveLength(2)
    expect(w.polls()).toBe(0)
  })
})

describe('selfMerge: the text after a submitted approval, exactly', () => {
  const AFTER =
    'The approval was already submitted as `fro-bot` on the pinned commit and stays on the pull request until the head moves or someone dismisses it; check the pull request.'
  const facts = ['- Pull request: #77', `- Pinned commit: \`${PIN}\``, '']

  it('drops "Nothing was approved." and adds the sentence, once', async () => {
    const w = world({pulls: script<PullState>({}, {}, {labels: ['automerge', 'hold-merge']})})
    expect((await selfMerge(w.input())).summary).toBe(
      [
        '### Promotion self-merge: held by hold-merge',
        '',
        `The pull request carries the \`hold-merge\` label, so it waits for the operator. ${AFTER}`,
        '',
        ...facts,
      ].join('\n'),
    )
  })

  it('drops "Nothing further was done." and adds the sentence, once', async () => {
    const w = world({pulls: script<PullState | Error>({}, {}, apiError(404))})
    expect((await selfMerge(w.input())).summary).toBe(
      [
        '### Promotion self-merge: GitHub API failure',
        '',
        `A GitHub API call failed, so the run stopped. ${AFTER}`,
        '',
        ...facts,
      ].join('\n'),
    )
  })

  it('starts the run waiting, so a deadline before the first poll reads as a wait that ran out', async () => {
    const w = world()
    let calls = 0
    const outcome = await selfMerge(w.input({now: () => (calls++ === 0 ? 0 : 61 * MINUTE)}))
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(outcome.summary).toContain('did not settle within 60 minutes')
    expect(w.requests.getBranch).toBeUndefined()
  })
})

describe('selfMerge: an abort signal on every request and sleep', () => {
  const HOUR = 60 * MINUTE

  it('gives every request a signal sized to the time left, then the 10 minutes after the wait', async () => {
    const w = world()
    await selfMerge(w.input())
    const sizes = Object.fromEntries(w.signals.map(entry => [entry.name, entry.ms]))
    // the wait has 60 minutes; the clock does not move, so each request in it has all of them
    expect(w.signals.filter(entry => entry.ms === HOUR).map(entry => entry.name)).toEqual([
      'getBranch',
      'getPull',
      'getBranch',
      'listRuns',
      'listStatuses',
    ])
    // after the wait the hard deadline is 70 minutes from the start
    expect(sizes.getVariable).toBe(70 * MINUTE)
    expect(sizes.approve).toBe(70 * MINUTE)
    expect(sizes.merge).toBe(70 * MINUTE)
    expect(w.signals).toHaveLength(12)
  })

  it('shrinks the signal as the clock moves', async () => {
    const w = world({callCost: name => (name === 'getBranch' ? 5 * MINUTE : 0)})
    await selfMerge(w.input())
    const branch = w.signals.filter(entry => entry.name === 'getBranch').map(entry => entry.ms)
    expect(branch[0]).toBe(HOUR)
    expect(branch[1]).toBe(HOUR - 5 * MINUTE)
  })

  it('creates no signal for a request the deadline has already ruled out', async () => {
    const w = world({callCost: name => (name === 'getBranch' ? HOUR + MINUTE : 0)})
    await selfMerge(w.input())
    expect(w.signals.map(entry => entry.name)).toEqual(['getBranch'])
  })

  it('never lets a sleep run past the deadline', async () => {
    // the first read of the pull request takes 59 minutes and 30 seconds, leaving 30 seconds for the minute's sleep
    const w = world({
      runs: () => GREEN_RUNS.slice(0, 1),
      callCost: (name, count) => (name === 'getPull' && count === 1 ? 59 * MINUTE + 30_000 : 0),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.sleeps).toEqual([30_000])
  })

  it('cuts a retry back-off to the time left, and skips it when none is left', async () => {
    // one second left when the runs are first asked for; each ask costs 600 ms and fails
    const w = world({
      runs: script<readonly RunState[] | Error>(apiError(503), apiError(503), GREEN_RUNS),
      callCost: (name, count) => (name === 'getPull' && count === 1 ? HOUR - 1000 : name === 'listRuns' ? 600 : 0),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.sleeps).toEqual([400])
    const spent = world({
      runs: script<readonly RunState[] | Error>(apiError(503), GREEN_RUNS),
      callCost: (name, count) => (name === 'listRuns' && count === 1 ? HOUR + 1000 : 0),
    })
    expect(await selfMerge(spent.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(spent.sleeps).toEqual([])
  })

  it.each(['getBranch', 'getPull', 'listRuns', 'listStatuses'])(
    'ends a wait with TIMEOUT when the %s request stalls past its signal, without retrying it',
    async name => {
      const w = world({hang: (called, count) => called === name && count === 1})
      const outcome = await selfMerge(w.input())
      expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
      expect(w.requests[name]).toHaveLength(1)
      expect(w.log).toEqual([])
      expect(w.sleeps).toEqual([])
    },
  )

  it('ends with TIMEOUT when the first read of the protection stalls', async () => {
    const w = world({hang: (name, count) => name === 'getBranch' && count === 1})
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.requests.getPull).toBeUndefined()
  })

  it('ends with TIMEOUT when the read of the switch stalls, and approves nothing', async () => {
    const w = world({hang: (name, count) => name === 'getVariable' && count === 1})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(outcome.summary).toContain('time reserved for the approval and the merge ran out')
    expect(w.log).toEqual([])
  })

  it('reports a stalled read after the approval as a timeout that says the approval was submitted', async () => {
    const w = world({hang: (name, count) => name === 'getPull' && count === 3})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'TIMEOUT'})
    expect(w.log).toEqual(['approve'])
    expect(outcome.summary).toContain('already submitted')
  })

  it('does not treat an error without an aborted signal as a timeout', async () => {
    const w = world({
      protection: () => {
        throw Object.assign(new Error('The operation was aborted'), {status: 404})
      },
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_UNREADABLE'})
  })
})

describe('selfMerge: a write that stalls in flight is reconciled with one read', () => {
  const stallApprove = {hang: (name: string, count: number) => name === 'approve' && count === 1}
  const stallMerge = {hang: (name: string, count: number) => name === 'merge' && count === 1}
  // reads: poll, before the approval, [settle], reconcile
  const afterWrite = (...later: readonly (PullState | Error)[]) => script<PullState | Error>({}, {}, ...later)

  it('says the approval is unknown, and that the pull request is still open, when the approval stalls', async () => {
    const w = world({...stallApprove, pulls: afterWrite({})})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'APPROVAL_UNKNOWN'})
    expect(w.requests.approve).toHaveLength(1)
    expect(outcome.summary).toBe(
      [
        '### Promotion self-merge: approval unknown',
        '',
        'The approval request was cut off at the deadline, so it is not known whether GitHub recorded it. Read again afterwards, the pull request is open. Check its reviews and dismiss the approval if the promotion should not merge.',
        '',
        '- Pull request: #77',
        `- Pinned commit: \`${PIN}\``,
        '',
      ].join('\n'),
    )
  })

  it.each([
    [{merged: true, state: 'closed' as const}, 'merged'],
    [{state: 'closed' as const}, 'closed'],
  ])('names the state the pull request is in after a stalled approval: %j', async (pull, word) => {
    const w = world({...stallApprove, pulls: afterWrite(pull)})
    const outcome = await selfMerge(w.input())
    expect(outcome.code).toBe('APPROVAL_UNKNOWN')
    expect(outcome.summary).toContain(`the pull request is ${word}.`)
  })

  it('says the pull request could not be read when the read after a stalled approval fails', async () => {
    const w = world({...stallApprove, pulls: afterWrite(apiError(404))})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'APPROVAL_UNKNOWN'})
    expect(outcome.summary).toContain('The pull request could not be read afterwards.')
    expect(outcome.summary).not.toContain('Read again afterwards')
  })

  it('does not retry the stalled approval, and never merges', async () => {
    const w = world({...stallApprove, pulls: afterWrite({})})
    await selfMerge(w.input())
    expect(w.requests.approve).toHaveLength(1)
    expect(w.requests.merge).toBeUndefined()
  })

  it('reports a merge that stalled but went through as merged, exit 0', async () => {
    const w = world({...stallMerge, pulls: afterWrite({}, {merged: true, state: 'closed'})})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 0, code: 'MERGED_AFTER_CUT_OFF'})
    expect(outcome.summary).toContain('The merge request was cut off at the deadline, but the pull request is merged.')
  })

  it('reports a merge that stalled and did not go through as cut off, exit 1, with the approval stated', async () => {
    const w = world({...stallMerge, pulls: afterWrite({}, {})})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'MERGE_CUT_OFF'})
    expect(outcome.summary).toContain('already submitted')
    expect(outcome.summary).toContain('still open')
  })

  it('reports a merge that stalled and could not be read back as unknown, exit 1', async () => {
    const w = world({...stallMerge, pulls: afterWrite({}, apiError(404))})
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'MERGE_UNKNOWN'})
    expect(outcome.summary).toContain('whether GitHub accepted the merge is not known')
  })

  it('reconciles with a read of its own, sized 2 minutes, outside the spent deadline', async () => {
    const w = world({
      ...stallMerge,
      pulls: afterWrite({}, {merged: true}),
      callCost: name => (name === 'merge' ? 71 * MINUTE : 0),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome.code).toBe('MERGED_AFTER_CUT_OFF')
    expect(w.signals.at(-1)).toEqual({name: 'getPull', ms: 2 * MINUTE})
  })

  it('treats a stall in the reconciling read as unknown, and reads only once', async () => {
    const w = world({
      ...stallMerge,
      hang: (name, count) => (name === 'merge' && count === 1) || (name === 'getPull' && count === 4),
    })
    const outcome = await selfMerge(w.input())
    expect(outcome).toMatchObject({exitCode: 1, code: 'MERGE_UNKNOWN'})
    expect(w.requests.getPull).toHaveLength(4)
  })

  it('also reconciles an ambiguous merge failure with a read of its own, past the deadline', async () => {
    const w = world({
      merge: () => {
        throw apiError(500)
      },
      pulls: afterWrite({}, {merged: true}),
      callCost: name => (name === 'merge' ? 71 * MINUTE : 0),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 0, code: 'MERGED'})
    expect(w.signals.at(-1)).toEqual({name: 'getPull', ms: 2 * MINUTE})
  })

  it('says the merge state is unknown, not that the merge failed, when an ambiguous failure cannot be read back', async () => {
    const w = world({
      merge: () => {
        throw apiError(500)
      },
      pulls: afterWrite({}, apiError(404)),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_UNKNOWN'})
  })

  it('still reports a merge failure that left the pull request open as failed', async () => {
    const w = world({
      merge: () => {
        throw apiError(500)
      },
      pulls: afterWrite({}, {}),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'MERGE_FAILED'})
  })
})

describe('selfMerge: the new outcomes, exactly', () => {
  const facts = ['- Pull request: #77', `- Pinned commit: \`${PIN}\``, '']
  const AFTER =
    'The approval was already submitted as `fro-bot` on the pinned commit and stays on the pull request until the head moves or someone dismisses it; check the pull request.'
  const stallMerge = {hang: (name: string, count: number) => name === 'merge' && count === 1}

  it('titles and words a merge that was cut off and went through, without the approval note', async () => {
    const w = world({...stallMerge, pulls: script<PullState>({}, {}, {}, {merged: true})})
    expect((await selfMerge(w.input())).summary).toBe(
      [
        '### Promotion self-merge: merged after a cut-off request',
        '',
        'The merge request was cut off at the deadline, but the pull request is merged.',
        '',
        ...facts,
      ].join('\n'),
    )
  })

  it('titles and words a merge that was cut off and did not go through, with the approval note', async () => {
    const w = world({...stallMerge, pulls: script<PullState>({}, {}, {}, {})})
    expect((await selfMerge(w.input())).summary).toBe(
      [
        '### Promotion self-merge: merge cut off',
        '',
        `The merge request was cut off at the deadline. Read again afterwards, the pull request is still open, so the merge has not gone through, though GitHub may still accept it. Check the pull request. ${AFTER}`,
        '',
        ...facts,
      ].join('\n'),
    )
  })

  it('titles and words a merge whose state could not be read back, with the approval note', async () => {
    const w = world({...stallMerge, pulls: script<PullState | Error>({}, {}, {}, apiError(404))})
    expect((await selfMerge(w.input())).summary).toBe(
      [
        '### Promotion self-merge: merge state unknown',
        '',
        `The merge request failed or was cut off, and the pull request could not be read afterwards, so whether GitHub accepted the merge is not known. Check the pull request. ${AFTER}`,
        '',
        ...facts,
      ].join('\n'),
    )
  })

  it('does not call a sleep of no time', async () => {
    // a request fails with 100 ms of the wait left and takes them; its 2 s back-off then has no time at all
    const w = world({
      runs: script<readonly RunState[] | Error>(apiError(503), GREEN_RUNS),
      callCost: (name, count) =>
        name === 'getPull' && count === 1 ? 60 * MINUTE - 100 : name === 'listRuns' && count === 1 ? 100 : 0,
    })
    await selfMerge(w.input())
    expect(w.sleeps).toEqual([])
  })

  it('starts the wait over when only the last read of the list, after the polls, differs', async () => {
    const withExtra = [...checksFor(DECLARED), {context: 'Extra', app_id: 15_368}]
    const w = world({
      protection: script(protectionOf(checksFor(DECLARED)), protectionOf(checksFor(DECLARED)), protectionOf(withExtra)),
      runs: () => [...GREEN_RUNS, {name: 'Extra'}],
    })
    expect(await selfMerge(w.input())).toMatchObject(LIVE)
    // before the wait, the poll, the last read (which differs), the poll again, the last read again
    expect(w.requests.getBranch).toHaveLength(5)
  })

  it('stops with the protection failure when the last read of the list, after the polls, is short', async () => {
    const w = world({
      protection: script(
        protectionOf(checksFor(DECLARED)),
        protectionOf(checksFor(DECLARED)),
        protectionOf(checksFor(['Lint'])),
      ),
    })
    expect(await selfMerge(w.input())).toMatchObject({exitCode: 1, code: 'PROTECTION_SHORT'})
    expect(w.requests.getBranch).toHaveLength(3)
    expect(w.log).toEqual([])
  })
})
