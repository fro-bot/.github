/**
 * Scaling guards for every regex that GitHub-controlled text reaches through an exported function.
 *
 * Each case builds the input that made the original pattern quadratic and asserts that doubling it
 * does not quadruple the time. A quadratic pattern costs about 4x per doubling and a linear one about
 * 2x, so the ceiling sits between them. The operation repeats until the smaller size takes long
 * enough to read, and the ratio is the median of several samples.
 */

import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {extractStatusTruthClaimsFromText} from './detect-extract.ts'
import {extractPreviousMarker} from './rollout-tracker-snapshot.ts'

const SMALL = 20_000
const LARGE = 40_000
const SAMPLES = 5
const READABLE_MILLISECONDS = 25
const CEILING = 3.2

function cpuMilliseconds(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) operation()
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1_000
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function repetitionsToRead(operation: () => void): number {
  let repetitions = 1
  while (cpuMilliseconds(operation, repetitions) < READABLE_MILLISECONDS && repetitions < 1024) repetitions *= 2
  return repetitions
}

function scalingRatio(make: (size: number) => string, run: (input: string) => void): number {
  const small = make(SMALL)
  const large = make(LARGE)
  const repetitions = repetitionsToRead(() => {
    run(small)
  })
  const ratios = Array.from({length: SAMPLES}, () => {
    const smallTime = cpuMilliseconds(() => {
      run(small)
    }, repetitions)
    const largeTime = cpuMilliseconds(() => {
      run(large)
    }, repetitions)
    return largeTime / Math.max(smallTime, 0.01)
  })
  return median(ratios)
}

const repeat = (unit: string) => (size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

const claims = (text: string) => {
  extractStatusTruthClaimsFromText({path: 'docs/x.md', text})
}

describe('extractStatusTruthClaimsFromText scales linearly', () => {
  it.each([
    ['owner/repo#N: dotted run with no slash', repeat('a.')],
    ['owner/repo#N: dashed run with no slash', repeat('a-')],
    ['owner/repo#N: run then a space then a slash', (size: number) => `${repeat('a.')(size)} /`],
    ['owner/repo#N: owner/ then a dotted run with no #', (size: number) => `a/${repeat('b.')(size)}`],
    ['issue prefix: issue then a dotted run', (size: number) => `issue ${repeat('a.')(size)}`],
    ['release prefix: release then a dotted run', (size: number) => `release ${repeat('a.')(size)}`],
    ['plan path: docs/plans/ repeated with no .md', repeat('docs/plans/')],
    ['plan path: plan docs/plans/a/ repeated', repeat('plan docs/plans/a/')],
    [
      'plan path: docs/plans/ repeated before a double slash',
      (size: number) => `${repeat('docs/plans/')(size)}//a.md is active`,
    ],
    ['plan path: one long chain then .md and no status', (size: number) => `${repeat('docs/plans/')(size)}x.md is`],
  ])('%s', (_name, make) => {
    expect(scalingRatio(make, claims)).toBeLessThan(CEILING)
  })
})

describe('extractPreviousMarker scales linearly', () => {
  it.each([
    ['unclosed prefixes repeated', repeat('<!-- gateway-rollout-tracker:')],
    [
      'unclosed prefixes after a closed marker',
      (size: number) => `<!-- gateway-rollout-tracker:{} -->${repeat('<!-- gateway-rollout-tracker:')(size)}`,
    ],
    ['one prefix and a long body with no close', (size: number) => `<!-- gateway-rollout-tracker:${'x'.repeat(size)}`],
  ])('%s', (_name, make) => {
    expect(scalingRatio(make, input => extractPreviousMarker(input))).toBeLessThan(CEILING)
  })
})
