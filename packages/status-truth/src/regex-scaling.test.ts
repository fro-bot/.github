/**
 * Scaling guards for every regex that GitHub-controlled text reaches through an exported function.
 *
 * Each case builds an input that made a pattern, or a matcher that replaces one, quadratic and asserts
 * that quadrupling it does not multiply the time by sixteen. A quadratic operation costs about 16x per
 * quadrupling and a linear one about 4x, so the ceiling of 8x leaves a factor of two on both sides; a
 * single doubling (2x against 4x) left too little room for allocation and collection noise on CI.
 *
 * The time at each size is the best of three timings, taken adjacent in time. Contention only adds
 * time, so the best run is the one least disturbed, and the ratio of two best runs holds under a loaded
 * CI machine where a ratio of single runs does not. The operation repeats until the smaller size takes
 * long enough to read. A quadratic operation stays near 4x under the same load, which is what these
 * cases fail on.
 *
 * The rule: a case measures the growth ratio up to three times and passes at the first measurement under
 * the ceiling. A linear operation measures about 4x, but a call that takes well under a millisecond at the
 * small size lets one scheduler or collection pause push a single ratio over the ceiling; that noise is
 * independent between measurements, so a retry clears it. A quadratic operation measures about 16x on
 * every attempt and never drops under 8x, so every attempt fails and the case fails. The small size is
 * repeated until it takes 50 ms of CPU time, capped at 4,096 repetitions.
 */

import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {extractStatusTruthClaimsFromText} from './detect-extract.ts'
import {extractPreviousMarker} from './rollout-tracker-snapshot.ts'

const BEST_OF = 3
const READABLE_MILLISECONDS = 50
const MAXIMUM_REPETITIONS = 4096
const ATTEMPTS = 3
const GROWTH = 4
const CEILING = 8
// A quadratic operation on the largest input here takes a few seconds, three times at each size.
const SUITE_TIMEOUT_MILLISECONDS = 120_000

function cpuMilliseconds(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) operation()
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1_000
}

function bestMilliseconds(operation: () => void, repetitions: number): number {
  return Math.min(...Array.from({length: BEST_OF}, () => cpuMilliseconds(operation, repetitions)))
}

function repetitionsToRead(operation: () => void): number {
  let repetitions = 1
  while (cpuMilliseconds(operation, repetitions) < READABLE_MILLISECONDS && repetitions < MAXIMUM_REPETITIONS) {
    repetitions *= 2
  }
  return repetitions
}

/** One measurement: time at four times the size over time at the size, each the best of three. */
function measureGrowth(make: (size: number) => string, size: number, run: (input: string) => void): number {
  const small = make(size)
  const large = make(size * GROWTH)
  const runSmall = () => {
    run(small)
  }
  const runLarge = () => {
    run(large)
  }
  runSmall()
  runLarge()
  const repetitions = repetitionsToRead(runSmall)
  const smallTime = bestMilliseconds(runSmall, repetitions)
  const largeTime = bestMilliseconds(runLarge, repetitions)
  return largeTime / Math.max(smallTime, 0.01)
}

/**
 * The growth ratio, measured up to ATTEMPTS times, stopping at the first measurement under the ceiling.
 * A linear operation sits at 4x, but a sub-millisecond call at the small size lets one scheduler or
 * collection pause swing a single ratio past the ceiling. That noise is independent between
 * measurements, so a linear case passes on a retry. A quadratic operation measures about 16x every
 * time, so every attempt stays over the ceiling and the case still fails. Returns the smallest ratio.
 */
function growthRatio(make: (size: number) => string, size: number, run: (input: string) => void): number {
  let smallest = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    smallest = Math.min(smallest, measureGrowth(make, size, run))
    if (smallest < CEILING) break
  }
  return smallest
}

const repeat = (unit: string) => (size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

const claims = (text: string) => {
  extractStatusTruthClaimsFromText({path: 'docs/x.md', text})
}

interface ScalingCase {
  readonly name: string
  readonly make: (size: number) => string
  readonly size: number
}

const SMALL = 20_000
const MANY_CLAIMS = 100_000

const CLAIM_CASES: readonly ScalingCase[] = [
  {name: 'owner/repo#N: dotted run with no slash', make: repeat('a.'), size: SMALL},
  {name: 'owner/repo#N: dashed run with no slash', make: repeat('a-'), size: SMALL},
  {name: 'owner/repo#N: run then a space then a slash', make: size => `${repeat('a.')(size)} /`, size: SMALL},
  {name: 'owner/repo#N: owner/ then a dotted run with no #', make: size => `a/${repeat('b.')(size)}`, size: SMALL},
  {name: 'issue prefix: issue then a dotted run', make: size => `issue ${repeat('a.')(size)}`, size: SMALL},
  {name: 'release prefix: release then a dotted run', make: size => `release ${repeat('a.')(size)}`, size: SMALL},
  {name: 'plan path: docs/plans/ repeated with no .md', make: repeat('docs/plans/'), size: SMALL},
  {name: 'plan path: plan docs/plans/a/ repeated', make: repeat('plan docs/plans/a/'), size: SMALL},
  {
    name: 'plan path: docs/plans/ repeated before a double slash',
    make: size => `${repeat('docs/plans/')(size)}//a.md is active`,
    size: SMALL,
  },
  {
    name: 'plan path: one long chain then .md and no status',
    make: size => `${repeat('docs/plans/')(size)}x.md is`,
    size: SMALL,
  },
  // Many separate runs, each followed by a tail that lets it through to the searches inside the run.
  {
    name: 'plan path: many separate valid claims with no double slash',
    make: repeat('docs/plans/a.md is active\n'),
    size: MANY_CLAIMS,
  },
  {
    name: 'plan path: many separate valid claims with the plan prefix',
    make: repeat('plan docs/plans/a.md is active\n'),
    size: MANY_CLAIMS,
  },
  {
    name: 'plan path: many qualifying non-path runs and no docs/plans/ prefix after them',
    make: repeat('a.md is active '),
    size: MANY_CLAIMS,
  },
  {
    name: 'plan path: many short runs with valid-looking tails',
    make: repeat('a/b.md is draft '),
    size: MANY_CLAIMS,
  },
  {
    name: 'plan path: many short runs with tails, each holding a double slash',
    make: repeat('a//b.md is complete '),
    size: MANY_CLAIMS,
  },
  {
    name: 'plan path: many claims, a docs/plans/ prefix only in the first',
    make: size => `docs/plans/a.md is active ${repeat('b.md is active ')(size)}`,
    size: MANY_CLAIMS,
  },
]

describe('extractStatusTruthClaimsFromText scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each(CLAIM_CASES)('$name', ({make, size}) => {
    expect(growthRatio(make, size, claims)).toBeLessThan(CEILING)
  })
})

describe('extractPreviousMarker scales linearly', {timeout: SUITE_TIMEOUT_MILLISECONDS}, () => {
  it.each([
    {name: 'unclosed prefixes repeated', make: repeat('<!-- gateway-rollout-tracker:')},
    {
      name: 'unclosed prefixes after a closed marker',
      make: (size: number) => `<!-- gateway-rollout-tracker:{} -->${repeat('<!-- gateway-rollout-tracker:')(size)}`,
    },
    {
      name: 'one prefix and a long body with no close',
      make: (size: number) => `<!-- gateway-rollout-tracker:${'x'.repeat(size)}`,
    },
  ])('$name', ({make}) => {
    expect(growthRatio(make, SMALL, input => extractPreviousMarker(input))).toBeLessThan(CEILING)
  })
})
