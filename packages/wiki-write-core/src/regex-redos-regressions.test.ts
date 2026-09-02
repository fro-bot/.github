import process from 'node:process'

import {describe, expect, it} from 'vitest'
import {checkPrivateLeak} from './private-leak.ts'
import {mergeWikiLogs, validateWikilinks, WikiIngestError} from './wiki-ingest.ts'
import {computeRepoSlug} from './wiki-slug.ts'
import {collectWikilinks} from './wiki-utils.ts'

interface ScalingMeasurement {
  readonly smallMilliseconds: number
  readonly largeMilliseconds: number
  readonly ratio: number
  readonly repetitions: number
}

function measure(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) {
    operation()
  }
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1_000
}

function measureScalingRatio(operation: (size: number) => void, size: number, samples = 1): ScalingMeasurement {
  const smallOperation = (): void => operation(size)
  const largeOperation = (): void => operation(size * 2)
  let repetitions = 1
  smallOperation()
  largeOperation()
  let smallMilliseconds = measure(smallOperation, repetitions)

  while (smallMilliseconds < 50 && repetitions < 65_536) {
    repetitions *= 2
    smallMilliseconds = measure(smallOperation, repetitions)
  }

  const smallMeasurements: number[] = []
  const largeMeasurements: number[] = []
  const ratios: number[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    // Measure both terms fresh and adjacent in time. Reusing the calibration timing for sample 0
    // would pair measurements taken far apart, so CPU contention could inflate one term alone.
    const smallMeasurement = measure(smallOperation, repetitions)
    const largeMeasurement = measure(largeOperation, repetitions)
    smallMeasurements.push(smallMeasurement)
    largeMeasurements.push(largeMeasurement)
    ratios.push(largeMeasurement / Math.max(smallMeasurement, 0.01))
  }

  smallMeasurements.sort((left, right) => left - right)
  largeMeasurements.sort((left, right) => left - right)
  ratios.sort((left, right) => left - right)
  smallMilliseconds = smallMeasurements[Math.floor(smallMeasurements.length / 2)] ?? smallMilliseconds
  const largeMilliseconds = largeMeasurements[Math.floor(largeMeasurements.length / 2)] ?? 0
  // Take the median ratio, never the minimum. Because ratio = large / small, contention on the
  // small term deflates the ratio, so the minimum is structurally the most understated pair --
  // biased toward silence on a guard whose whole job is catching a superlinear regression.
  const ratio = ratios[Math.floor(ratios.length / 2)] ?? largeMilliseconds / Math.max(smallMilliseconds, 0.01)
  return {smallMilliseconds, largeMilliseconds, ratio, repetitions}
}

function expectLinearScaling(operation: (size: number) => void, size: number, samples = 1): ScalingMeasurement {
  const measurement = measureScalingRatio(operation, size, samples)
  expect(measurement.ratio).toBeLessThan(3)
  return measurement
}

// Only guards that provably fail against the pre-fix implementation belong in this suite. Two
// earlier guards (diff-header parsing, slug trimming) were removed: both operations are linear in
// the old code too, so neither could fail against the regression it named, while both were fast
// enough that fixed overhead dominated the ratio and flaked CI. A guard that cannot catch its own
// regression but can fail a healthy build is worse than no guard. Those parsers stay pinned by the
// correctness cases below, and their call sites carry a comment against reintroducing a regex.
// This meta-test stays because its discrimination check is the only assertion proving that the
// estimator works at all. It is deliberately expensive so the measurements are meaningful, and
// CPU contention can push it past the global 10-second test ceiling; failures present as timeouts,
// not assertion failures. Only it carries a raised timeout, because it is by far the most
// expensive test here: under CPU contention it consumes over half the 10-second budget, while the
// costliest production guard below -- malformed wiki log header parsing -- uses well under a
// quarter, and the two wikilink guards less again. Absolute timings are not portable across
// machines, but that ordering is: the log header guard is the one to check first if a production
// guard ever does time out, and the answer then is to isolate the timing suite rather than scatter
// more per-test literals.
describe('linear-time input parsing', () => {
  it('proves the scaling helper discriminates quadratic work', () => {
    const quadratic = (size: number): void => {
      let total = 0
      for (let outer = 0; outer < size; outer += 1) {
        for (let inner = 0; inner < size; inner += 1) total += (outer + inner) & 1
      }
      if (total < 0) throw new Error('unreachable')
    }
    const linear = (size: number): void => {
      let total = 0
      for (let index = 0; index < size; index += 1) {
        for (let repeat = 0; repeat < 256; repeat += 1) total += (index + repeat) & 1
      }
      if (total < 0) throw new Error('unreachable')
    }

    // Warm both sizes before measuring so JIT compilation cannot deflate the first ratio.
    quadratic(4_000)
    quadratic(8_000)
    linear(20_000)
    linear(40_000)

    // Keep both checks: the separation proves that the estimator discriminates quadratic work,
    // while the absolute bound anchors the synthetic linear control against a uniformly inflated
    // estimator, which a ratio of ratios cannot see because both terms scale together.
    const quadraticMeasurement = measureScalingRatio(quadratic, 4_000, 3)
    const linearMeasurement = measureScalingRatio(linear, 20_000, 3)

    expect(quadraticMeasurement.ratio).toBeGreaterThanOrEqual(linearMeasurement.ratio * 1.5)
    expect(linearMeasurement.ratio).toBeLessThan(3)
  }, 30_000)

  it.each([
    {
      name: 'extracts a standard destination path',
      diff: 'diff --git a/docs/readme.md b/docs/readme.md',
      expected: {ok: true},
    },
    {
      name: 'detects a private destination path',
      diff: 'diff --git a/docs/public.md b/docs/private-repo.md',
      expected: {ok: false, matchedFiles: ['docs/private-repo.md']},
    },
    {
      name: 'uses the final literal separator when paths contain b slash',
      diff: 'diff --git a/source b/archive b/private-repo.md b/private-repo.md',
      expected: {ok: false, matchedFiles: ['private-repo.md']},
    },
    {
      name: 'falls back when the final separator has no destination characters',
      diff: 'diff --git a/public.md b/private-repo b/',
      expected: {ok: false, matchedFiles: ['private-repo b/']},
    },
    {
      name: 'ignores an incomplete destination path',
      diff: 'diff --git a/docs/readme.md b/',
      expected: {ok: true},
    },
  ])('preserves diff-path extraction: $name', ({diff, expected}) => {
    expect(checkPrivateLeak(['private-repo'], diff, {titlePrefixed: false, isOperator: false})).toEqual(expected)
  })

  it.each([
    {content: '[[target]]', expected: ['target']},
    {content: '[[target|label]]', expected: ['target']},
    {content: '[[first]][[second|label]]', expected: ['first', 'second']},
    {content: '[[target|]]', expected: []},
    {content: '[[|label]]', expected: []},
    {content: '[[target|label with [brackets]]]', expected: ['target']},
  ])('preserves wikilink collection for $content', ({content, expected}) => {
    expect(collectWikilinks(content)).toEqual(expected)
  })

  it.each([
    {content: '[[a]b]]', expected: ['a]b']},
    {content: '[[a|b]c]]', expected: ['a']},
  ])('pins deliberate tolerant parsing for $content', ({content, expected}) => {
    // This divergence from the old regex is deliberate: the consumers safely surface or
    // ignore the resulting target, while accepting more editor-authored link text.
    expect(collectWikilinks(content)).toEqual(expected)
  })

  it('scales wikilink parsing linearly for an unterminated opening-bracket run', () => {
    const smallContent = '[['.repeat(8_000)
    const largeContent = '[['.repeat(16_000)
    const measurement = expectLinearScaling(
      size => {
        collectWikilinks(size === 8_000 ? smallContent : largeContent)
      },
      8_000,
      3,
    )

    // The old global regex retries the remaining body from each opening marker and fails this ratio guard.
    expect(measurement.ratio).toBeLessThan(3)
  })

  it('scales exported wikilink validation linearly for an unterminated opening-bracket run', () => {
    const pagePrefix = [
      '---',
      'type: topic',
      'title: Source',
      'created: 2026-08-29',
      'updated: 2026-08-29',
      '---',
      '',
    ].join('\n')
    const smallFiles = {'knowledge/wiki/topics/source.md': `${pagePrefix}${'[['.repeat(8_000)}`}
    const largeFiles = {'knowledge/wiki/topics/source.md': `${pagePrefix}${'[['.repeat(16_000)}`}
    const measurement = expectLinearScaling(
      size => {
        validateWikilinks(size === 8_000 ? smallFiles : largeFiles)
      },
      8_000,
      3,
    )

    // The exported save-path gate must retain the same linearity contract as its parser.
    expect(measurement.ratio).toBeLessThan(3)
  })

  it('preserves valid and malformed wiki log parsing', () => {
    const valid = '\n## [2026-08-29 12:00] manual-edit | repo:alice/project\nCorrection.\n'
    const malformed = [
      '\n## [] ingest | empty-timestamp\n',
      '\n## [2026-08-29] unknown | wrong-operation\n',
      '\n## [2026-08-29] ingest | \n',
    ].join('')

    expect(mergeWikiLogs([malformed, valid])).toBe(
      [
        '# Wiki Log',
        '',
        'Chronological record of all wiki operations.',
        '',
        '---',
        '',
        '_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._',
        valid,
      ].join('\n'),
    )
  })

  it('scales malformed wiki log header parsing linearly', () => {
    const smallLog = Array.from({length: 8_000}, () => '\n## [unterminated').join('')
    const largeLog = Array.from({length: 16_000}, () => '\n## [unterminated').join('')
    const measurement = expectLinearScaling(
      size => {
        mergeWikiLogs([size === 8_000 ? smallLog : largeLog])
      },
      8_000,
      3,
    )

    // The old capture regex rescans the remaining malformed log from each marker and fails this ratio guard.
    expect(measurement.ratio).toBeLessThan(3)
  })

  it('fails validation on malformed wikilinks under the unified grammar', () => {
    const files = {
      'knowledge/wiki/topics/source.md': [
        '---',
        'type: topic',
        'title: Source',
        'created: 2026-08-29',
        'updated: 2026-08-29',
        '---',
        '',
        'See [[a]b]].',
        '',
      ].join('\n'),
    }

    // Deliberately adopts collectWikilinks' tolerant grammar so malformed text fails loudly
    // instead of remaining invisible to the exported validation gate.
    expect(() => validateWikilinks(files)).toThrow(WikiIngestError)
    expect(() => validateWikilinks(files)).toThrow('[[a]b]]')
  })

  it.each([
    {owner: '---owner---', repo: '--repo--', expected: 'owner--repo'},
    {owner: 'naïve', repo: 'café', expected: 'na-ve--caf'},
    {owner: 'owner', repo: 'repo_name', expected: 'owner--repo-name'},
  ])('preserves slug sanitization for $owner/$repo', ({owner, repo, expected}) => {
    expect(computeRepoSlug(owner, repo)).toBe(expected)
  })

  it('still rejects empty slug segments', () => {
    expect(() => computeRepoSlug('___', 'repo')).toThrow(/empty/iu)
    expect(() => computeRepoSlug('owner', '___')).toThrow(/empty/iu)
  })
})
