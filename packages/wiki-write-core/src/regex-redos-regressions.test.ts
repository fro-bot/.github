import process from 'node:process'

import {describe, expect, it} from 'vitest'
import {checkPrivateLeak} from './private-leak.ts'
import {mergeWikiLogs, validateWikilinks, WikiIngestError} from './wiki-ingest.ts'
import {computeRepoSlug} from './wiki-slug.ts'
import {collectWikilinks} from './wiki-utils.ts'

interface ScalingMeasurement {
  readonly ratio: number
}

function measure(operation: () => void, repetitions: number): number {
  const startedAt = process.cpuUsage()
  for (let index = 0; index < repetitions; index += 1) {
    operation()
  }
  const elapsed = process.cpuUsage(startedAt)
  return (elapsed.user + elapsed.system) / 1_000
}

// Odd input only. On even input the upper middle reads high, and both consumers fail silently in
// that direction: calibration satisfies its target sooner and under-counts repetitions; the ratio
// estimate inflates, which passes the quadratic floor at the meta-test below without earning it.
function median(values: readonly number[]): number {
  if (values.length % 2 === 0) {
    throw new RangeError(`median needs an odd number of values, received ${values.length}`)
  }
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const CALIBRATION_TARGET_MILLISECONDS = 50
const CALIBRATION_PROBES = 3

// The variance this test used to leak in under CPU contention lived here, not in the downstream
// sample count. A single process.cpuUsage() delta at a given repetitions count is a noisy probe:
// under contention it can spuriously read high enough to satisfy the 50ms target early, locking
// in a repetitions count that is too small once real (unloaded-again) conditions resume, which
// widens the variance of every later sample taken at that fixed count. Taking the median of three
// probes per doubling step, instead of one, smooths that single-probe noise out of the decision
// that matters. The guarantee is structural, not statistical: a median needs two probes to lie in
// the same direction where one used to suffice. The measurements below are consistent with that
// but too sparse to separate the arms on their own. On a 10-core box where the honest count for
// the quadratic control is 8 (two drops in 32 single-probe runs against none in 28 median runs,
// unequal run counts): single-probe dropped to 4 once in 20 runs under 12-process contention and
// once in 12 under 30-process; median-of-3 held 8 in 20 and 8 runs respectively. On a 4-core box
// where the honest count is 4: under 12 busy loops (20 runs) both arms selected identical counts
// every run (reps=2 x5, reps=4 x15). So the median rejects a transient spike on one probe; when
// all three probes inflate together it inherits the bias and the count lands low. The ratio
// absorbs that case because both terms are measured at the same repetitions count adjacent in
// time; 23/23 held at 8x oversubscription on the 4-core box. When reproducing any of these,
// interleave the arms: a blocked design confounds the comparison with frequency drift, in either
// direction depending on which arm runs first.
function calibrateRepetitions(operation: () => void): number {
  const probe = (repetitions: number): number =>
    median(Array.from({length: CALIBRATION_PROBES}, () => measure(operation, repetitions)))

  let repetitions = 1
  let smallMilliseconds = probe(repetitions)

  while (smallMilliseconds < CALIBRATION_TARGET_MILLISECONDS && repetitions < 65_536) {
    repetitions *= 2
    smallMilliseconds = probe(repetitions)
  }

  return repetitions
}

function measureScalingRatio(operation: (size: number) => void, size: number, samples = 1): ScalingMeasurement {
  // Reject a bad count here, where the diagnostic names the parameter and arrives before any
  // measurement work, rather than letting `median` throw about its own input two seconds later.
  // Even counts are rejected for the reason given at `median`; the rest (`0`, `1.5`, `-1`, `NaN`,
  // `Infinity`) would never reach it as an odd length and need their own check.
  if (!Number.isInteger(samples) || samples < 1 || samples % 2 === 0) {
    throw new RangeError(`measureScalingRatio needs a positive odd integer sample count, received ${samples}`)
  }
  const smallOperation = (): void => operation(size)
  const largeOperation = (): void => operation(size * 2)
  smallOperation()
  largeOperation()
  const repetitions = calibrateRepetitions(smallOperation)

  const ratios: number[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    // Measure both terms fresh and adjacent in time. Reusing the calibration timing for sample 0
    // would pair measurements taken far apart, so CPU contention could inflate one term alone.
    const smallMeasurement = measure(smallOperation, repetitions)
    const largeMeasurement = measure(largeOperation, repetitions)
    ratios.push(largeMeasurement / Math.max(smallMeasurement, 0.01))
  }

  // Take the median ratio, never the minimum. Because ratio = large / small, contention on the
  // small term deflates the ratio, so the minimum is structurally the most understated pair --
  // biased toward silence on a guard whose whole job is catching a superlinear regression.
  return {ratio: median(ratios)}
}

// Named so these two bounds stay visually distinct from the unrelated sample count of 3 passed to
// measureScalingRatio at the call sites below.
const LINEAR_RATIO_CEILING = 3
const QUADRATIC_RATIO_FLOOR = 3

function expectLinearScaling(operation: (size: number) => void, size: number, samples = 1): ScalingMeasurement {
  const measurement = measureScalingRatio(operation, size, samples)
  expect(measurement.ratio).toBeLessThan(LINEAR_RATIO_CEILING)
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
// not assertion failures. The whole suite therefore runs under one describe-scoped timeout rather
// than the global default -- the correctness tests here finish in milliseconds and gain nothing
// from it, but the timing guards need it, and one scope beats per-test literals: measured under
// 12-process CPU contention the meta-test ran 4.8s-14.3s across repeated runs, while the costliest
// production guard below -- malformed wiki log header parsing -- ran 1.7s-8.7s (8.5s at 8x
// oversubscription, 85% of the 10s global ceiling) and the two wikilink guards less again. Both
// windows are wide because contention level varies run to run and neither figure is portable
// across machines, but the ordering held in every run measured: the log header guard is the one
// to check first if a timing test ever does time out. Those are worst-case figures from imposed
// busy loops; inside the full suite under Vitest's own file parallelism this file measured ~6s
// total, with the meta-test at ~3.6s and the log header guard at ~1.7s -- about 12% of the budget.
const TIMING_SUITE_TIMEOUT_MILLISECONDS = 30_000

// The separation check below was previously a relative multiplier (quadratic ratio >=
// linear ratio * 1.5), which multiplied together the noise of two independently-measured ratios
// instead of bounding either one. That noise's actual source was measureScalingRatio's
// repetitions calibration (see calibrateRepetitions), not this test's sample count -- with
// calibration now robust to a single noisy probe, independent absolute floors/ceilings anchored
// to each control's own theory (quadratic ~4, linear ~2) no longer need to compound to catch a
// regression: QUADRATIC_RATIO_FLOOR sits comfortably below every contended sample measured
// (worst observed ~3.88 under 12-process contention, ~3.89 under 30-process contention) while
// LINEAR_RATIO_CEILING is the same bound expectLinearScaling already used for the production
// guards below, now shared by name instead of by coincidence of both being the literal 3.
describe('linear-time input parsing', {timeout: TIMING_SUITE_TIMEOUT_MILLISECONDS}, () => {
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

    // Keep both checks independent rather than multiplying one ratio by the other: each control
    // is bounded against its own theoretical value (quadratic ~4, linear ~2) with headroom drawn
    // from measured contended distributions, so noise in one measurement cannot erode the other's
    // margin. Three samples, reverted from seven: the noise that used to erode this test's
    // margin lived in measureScalingRatio's repetitions calibration, not in this sample count --
    // with the calibration fixed, three samples already holds the quadratic ratio comfortably
    // above its floor under contention (see calibrateRepetitions for the measured evidence).
    const quadraticMeasurement = measureScalingRatio(quadratic, 4_000, 3)
    const linearMeasurement = measureScalingRatio(linear, 20_000, 3)
    expect(quadraticMeasurement.ratio).toBeGreaterThanOrEqual(QUADRATIC_RATIO_FLOOR)
    expect(linearMeasurement.ratio).toBeLessThan(LINEAR_RATIO_CEILING)
  })

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
    expect(measurement.ratio).toBeLessThan(LINEAR_RATIO_CEILING)
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
    expect(measurement.ratio).toBeLessThan(LINEAR_RATIO_CEILING)
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
    expect(measurement.ratio).toBeLessThan(LINEAR_RATIO_CEILING)
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
