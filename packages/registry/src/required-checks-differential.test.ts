/**
 * Differential proof for the move of the required-check evaluation: a frozen copy of `evaluateChecks` and
 * `sameChecks` as they were in `promotion-self-merge.ts` (verbatim, with their two helpers) runs against the
 * live functions on seeded inputs, and the answers must be equal. The frozen copy is never edited. If a
 * change to the live functions is meant, this test fails first and names the input.
 */

import {describe, expect, it} from 'vitest'
import {evaluateChecks, sameChecks} from './promotion-self-merge.ts'

interface RequiredCheck {
  readonly context: string
  readonly appId: number | null
}

interface CheckRunView {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly appId: number | null
}

interface StatusView {
  readonly context: string
  readonly state: string
}

// ---- frozen copy: do not edit ----------------------------------------------------------------------------

function frozenRunOutcome(run: CheckRunView): {readonly done: boolean; readonly ok: boolean} {
  return {
    done: run.status === 'completed',
    ok: run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral',
  }
}

function frozenStatusOutcome(status: StatusView): {readonly done: boolean; readonly ok: boolean} {
  return {
    done: status.state === 'success' || status.state === 'failure' || status.state === 'error',
    ok: status.state === 'success',
  }
}

function frozenEvaluateChecks(
  required: readonly RequiredCheck[],
  runs: readonly CheckRunView[],
  statuses: readonly StatusView[],
): {readonly failed: readonly string[]; readonly pending: readonly string[]} {
  const failed: string[] = []
  const pending: string[] = []
  for (const check of required) {
    const matching = runs.filter(
      run => run.name === check.context && (check.appId === null || run.appId === check.appId),
    )
    const newest = matching.toSorted((left, right) => right.id - left.id)[0]
    const status = statuses.find(candidate => candidate.context === check.context)
    const reported = [
      ...(newest === undefined ? [] : [frozenRunOutcome(newest)]),
      ...(status === undefined ? [] : [frozenStatusOutcome(status)]),
    ]
    // Nothing reported yet counts as not done.
    if (reported.some(outcome => outcome.done && !outcome.ok)) failed.push(check.context)
    else if (reported.length === 0 || reported.some(outcome => !outcome.done)) pending.push(check.context)
  }
  return {failed, pending}
}

function frozenSameChecks(left: readonly RequiredCheck[], right: readonly RequiredCheck[]): boolean {
  const keys = (checks: readonly RequiredCheck[]): readonly string[] =>
    checks.map(check => `${check.context}\0${String(check.appId)}`).toSorted()
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right))
}

// ---- seeded inputs ---------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so a failure names a seed that reproduces it. */
function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const CONTEXTS = ['Lint', 'Test', 'CodeQL', 'Security: Private Leak Scan', 'Fro Bot'] as const
const APPS = [null, 15_368, 57_789, 999] as const
const RUN_STATUSES = ['completed', 'completed', 'completed', 'queued', 'in_progress', 'waiting', 'pending'] as const
const CONCLUSIONS = [
  'success',
  'success',
  'skipped',
  'neutral',
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'stale',
  null,
] as const
const STATES = ['success', 'success', 'failure', 'error', 'pending'] as const

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

function seededCase(seed: number) {
  const random = generator(seed)
  const required: RequiredCheck[] = Array.from({length: between(random, 0, 5)}, () => ({
    context: pick(random, CONTEXTS),
    appId: pick(random, APPS),
  }))
  const runs: CheckRunView[] = Array.from({length: between(random, 0, 9)}, () => ({
    id: between(random, 1, 12),
    name: random() < 0.15 ? 'Unrelated' : pick(random, CONTEXTS),
    status: pick(random, RUN_STATUSES),
    conclusion: pick(random, CONCLUSIONS),
    appId: pick(random, APPS),
  }))
  const statuses: StatusView[] = Array.from({length: between(random, 0, 6)}, () => ({
    context: random() < 0.15 ? 'Unrelated' : pick(random, CONTEXTS),
    state: pick(random, STATES),
  }))
  return {required, runs, statuses, random}
}

describe('evaluateChecks against a frozen copy of the promotion step’s original', () => {
  it('agrees on 3000 seeded mixes of required checks, check runs and statuses', () => {
    const seen = {failed: 0, pending: 0, clean: 0}
    for (let seed = 1; seed <= 3000; seed += 1) {
      const {required, runs, statuses} = seededCase(seed)
      const expected = frozenEvaluateChecks(required, runs, statuses)
      expect({seed, verdict: evaluateChecks(required, runs, statuses)}).toEqual({seed, verdict: expected})
      if (expected.failed.length > 0) seen.failed += 1
      else if (expected.pending.length > 0) seen.pending += 1
      else seen.clean += 1
    }
    // The seeds reach every kind of verdict, so agreement is not agreement on one trivial answer.
    expect(seen.failed).toBeGreaterThan(200)
    expect(seen.pending).toBeGreaterThan(200)
    expect(seen.clean).toBeGreaterThan(50)
  })

  it('agrees on the named edge cases', () => {
    const lint = (appId: number | null): RequiredCheck => ({context: 'Lint', appId})
    const run = (overrides: Partial<CheckRunView>): CheckRunView => ({
      id: 1,
      name: 'Lint',
      status: 'completed',
      conclusion: 'success',
      appId: 15_368,
      ...overrides,
    })
    const cases: readonly (readonly [readonly RequiredCheck[], readonly CheckRunView[], readonly StatusView[]])[] = [
      [[], [], []],
      [[lint(null)], [], []],
      [[lint(15_368)], [run({appId: 999})], []],
      [[lint(null)], [run({appId: 999, conclusion: 'failure'})], []],
      [[lint(15_368)], [run({id: 5, conclusion: 'failure'}), run({id: 9})], []],
      [[lint(15_368)], [run({id: 9, conclusion: 'failure'}), run({id: 5})], []],
      [[lint(null)], [run({})], [{context: 'Lint', state: 'pending'}]],
      [[lint(null)], [run({})], [{context: 'Lint', state: 'failure'}]],
      [[lint(null)], [run({status: 'in_progress', conclusion: null})], [{context: 'Lint', state: 'failure'}]],
      [[lint(null)], [], [{context: 'Lint', state: 'success'}]],
      [
        [lint(null)],
        [],
        [
          {context: 'Lint', state: 'error'},
          {context: 'Lint', state: 'success'},
        ],
      ],
      [[lint(null), lint(null)], [run({})], []],
    ]
    for (const [required, runs, statuses] of cases) {
      expect(evaluateChecks(required, runs, statuses)).toEqual(frozenEvaluateChecks(required, runs, statuses))
    }
  })
})

describe('sameChecks against a frozen copy of the promotion step’s original', () => {
  it('agrees on 3000 seeded pairs: permutations, rebindings, additions, removals and unrelated lists', () => {
    const seen = {same: 0, different: 0}
    for (let seed = 1; seed <= 3000; seed += 1) {
      const {required, random} = seededCase(seed)
      const shuffled = required.toSorted(() => random() - 0.5)
      const variants: readonly (readonly RequiredCheck[])[] = [
        required,
        shuffled,
        required.map((check, index) => (index === 0 ? {...check, appId: pick(random, APPS)} : check)),
        [...required, {context: pick(random, CONTEXTS), appId: pick(random, APPS)}],
        required.slice(1),
        seededCase(seed + 10_000).required,
      ]
      for (const variant of variants) {
        const expected = frozenSameChecks(required, variant)
        expect({seed, same: sameChecks(required, variant)}).toEqual({seed, same: expected})
        expect({seed, same: sameChecks(variant, required)}).toEqual({seed, same: frozenSameChecks(variant, required)})
        if (expected) seen.same += 1
        else seen.different += 1
      }
    }
    expect(seen.same).toBeGreaterThan(1000)
    expect(seen.different).toBeGreaterThan(1000)
  })

  it('agrees on the named edge cases, including a context that holds the key separator', () => {
    const a: RequiredCheck = {context: 'A', appId: null}
    const cases: readonly (readonly [readonly RequiredCheck[], readonly RequiredCheck[]])[] = [
      [[], []],
      [[a], [a]],
      [[a], []],
      [[a, a], [a]],
      [[{context: 'A', appId: 1}], [{context: 'A', appId: null}]],
      [[{context: 'A\0null', appId: null}], [{context: 'A', appId: null}]],
      [
        [
          {context: 'B', appId: 2},
          {context: 'A', appId: 1},
        ],
        [
          {context: 'A', appId: 1},
          {context: 'B', appId: 2},
        ],
      ],
    ]
    for (const [left, right] of cases) {
      expect(sameChecks(left, right)).toBe(frozenSameChecks(left, right))
    }
  })
})
