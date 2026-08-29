import {performance} from 'node:perf_hooks'
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
  const startedAt = performance.now()
  for (let index = 0; index < repetitions; index += 1) {
    operation()
  }
  return performance.now() - startedAt
}

function expectLinearScaling(operation: (size: number) => void, size: number, samples = 1): ScalingMeasurement {
  const smallOperation = (): void => operation(size)
  const largeOperation = (): void => operation(size * 2)
  let repetitions = 1
  let smallMilliseconds = measure(smallOperation, repetitions)

  while (smallMilliseconds < 50 && repetitions < 65_536) {
    repetitions *= 2
    smallMilliseconds = measure(smallOperation, repetitions)
  }

  const smallMeasurements: number[] = []
  const largeMeasurements: number[] = []
  const ratios: number[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    const smallMeasurement = sample === 0 ? smallMilliseconds : measure(smallOperation, repetitions)
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
  const ratio = ratios[Math.floor(ratios.length / 2)] ?? largeMilliseconds / Math.max(smallMilliseconds, 0.01)
  expect(ratio).toBeLessThan(3)
  return {smallMilliseconds, largeMilliseconds, ratio, repetitions}
}

describe('linear-time input parsing', () => {
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

  it('scales diff-header parsing linearly for many separators', () => {
    const smallDiff = `diff --git a/${'source b/'.repeat(250_000)}private-repo.md b/private-repo.md`
    const largeDiff = `diff --git a/${'source b/'.repeat(500_000)}private-repo.md b/private-repo.md`
    const measurement = expectLinearScaling(
      size => {
        const diff = size === 250_000 ? smallDiff : largeDiff
        checkPrivateLeak(['private-repo'], diff, {titlePrefixed: false, isOperator: false})
      },
      250_000,
      3,
    )

    // The old diff regex is also effectively linear at this input shape, so this documents
    // the scaling contract without pretending to distinguish those implementations.
    expect(measurement.ratio).toBeLessThan(3)
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

  it('scales slug trimming linearly for a long hyphen run', () => {
    const smallOwner = `${'-'.repeat(120_000)}owner`
    const largeOwner = `${'-'.repeat(240_000)}owner`
    const measurement = expectLinearScaling(
      size => {
        computeRepoSlug(size === 120_000 ? smallOwner : largeOwner, 'repo')
      },
      120_000,
      3,
    )

    // The old trim regex is also linear for this input, so this guard records the desired property
    // but cannot distinguish it from the former loop implementation.
    expect(measurement.ratio).toBeLessThan(3)
  })
})
