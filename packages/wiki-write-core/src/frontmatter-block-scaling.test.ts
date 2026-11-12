/**
 * `splitFrontmatterBlock` reads untrusted wiki and plan files, so its time must grow linearly with the content, an
 * opened block with no close included. This file measures CPU time at a size and at four times that size. A linear
 * operation costs about four times as much; a quadratic one about sixteen.
 *
 * It is outside Stryker's `testFiles`: a mutant that makes the scan slow would only time out, and timing assertions
 * under the mutation runner are noise. It runs in the normal test suite.
 */

import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {splitFrontmatterBlock} from './frontmatter-block.ts'

const SIZE_STEP = 4
const LINEAR_RATIO_CEILING = 8
const QUADRATIC_RATIO_FLOOR = 8

function cpuMilliseconds(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) operation()
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1000
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Doubles the repetition count until one batch of the small operation costs the target. */
function calibrate(operation: () => void, targetMilliseconds: number): number {
  let repetitions = 1
  while (repetitions < 65_536) {
    const cost = median([1, 2, 3].map(() => cpuMilliseconds(operation, repetitions)))
    if (cost >= targetMilliseconds) break
    repetitions *= 2
  }
  return repetitions
}

/** The median over three samples of (cost at four times the size) / (cost at the size), each pair taken together. */
function scalingRatio(operation: (size: number) => void, size: number, targetMilliseconds = 50): number {
  const small = (): void => operation(size)
  const large = (): void => operation(size * SIZE_STEP)
  // Warm both sizes so compilation cannot deflate the first ratio.
  small()
  large()
  const repetitions = calibrate(small, targetMilliseconds)
  const ratios = [1, 2, 3].map(() => {
    const smallCost = cpuMilliseconds(small, repetitions)
    const largeCost = cpuMilliseconds(large, repetitions)
    return largeCost / Math.max(smallCost, 0.01)
  })
  return median(ratios)
}

// Each case builds its input once per size, outside the measured operation.
function cached(build: (size: number) => string): (size: number) => string {
  const inputs = new Map<number, string>()
  return size => {
    const known = inputs.get(size)
    if (known !== undefined) return known
    const built = build(size)
    inputs.set(size, built)
    return built
  }
}

const BASE_SIZE = 8000

describe('splitFrontmatterBlock grows linearly', {timeout: 30_000}, () => {
  it('proves the estimator tells quadratic work from linear work', () => {
    const quadratic = (size: number): void => {
      let total = 0
      for (let outer = 0; outer < size; outer += 1) {
        for (let inner = 0; inner < size; inner += 1) total += (outer + inner) & 1
      }
      if (total < 0) throw new Error('unreachable')
    }
    quadratic(2000)
    quadratic(2000 * SIZE_STEP)
    expect(scalingRatio(quadratic, 2000, 20)).toBeGreaterThan(QUADRATIC_RATIO_FLOOR)
  })

  it.each([
    ['an opened block with no close', cached(size => `---\n${'a: 1\n'.repeat(size / 4)}`)],
    ['many lines that nearly close the block', cached(size => `---\n${'---x\n'.repeat(size / 4)}`)],
    ['many lines of three dashes and spaces that are not closes', cached(size => `---\n${'--- x\n'.repeat(size / 4)}`)],
    ['one very long line', cached(size => `---\n${'a'.repeat(size)}`)],
    ['one very long near-close line of trailing spaces', cached(size => `---\n---${' '.repeat(size)}x\n---\n`)],
    ['many carriage returns that are not line endings', cached(size => `---\n${'a\r'.repeat(size / 2)}`)],
    ['many empty lines before the close', cached(size => `---\n${'\n'.repeat(size)}---\nbody`)],
    ['many CRLF lines before the close', cached(size => `---\r\n${'a: 1\r\n'.repeat(size / 4)}---\r\nbody`)],
    ['a very long body after the close', cached(size => `---\na: 1\n---\n${'---\n'.repeat(size / 4)}`)],
  ] as const)('on %s', (_name, input) => {
    const ratio = scalingRatio(size => {
      const result = splitFrontmatterBlock(input(size))
      if (result.kind === 'none') throw new Error('unreachable')
    }, BASE_SIZE)
    expect(ratio).toBeLessThan(LINEAR_RATIO_CEILING)
  })
})
