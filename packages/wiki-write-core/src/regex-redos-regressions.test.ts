import {performance} from 'node:perf_hooks'
import {describe, expect, it} from 'vitest'
import {checkPrivateLeak} from './private-leak.ts'
import {mergeWikiLogs} from './wiki-ingest.ts'
import {computeRepoSlug} from './wiki-slug.ts'
import {collectWikilinks} from './wiki-utils.ts'

function expectCompletesWithin<T>(operation: () => T, milliseconds: number): T {
  const startedAt = performance.now()
  const result = operation()
  expect(performance.now() - startedAt).toBeLessThan(milliseconds)
  return result
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

  it('handles a diff header with many separators within a bounded time', () => {
    const diff = `diff --git a/${'source b/'.repeat(12_000)}private-repo.md b/private-repo.md`

    // This wall-clock bound guards the request-time save path against polynomial ReDoS regressions.
    const result = expectCompletesWithin(
      () => checkPrivateLeak(['private-repo'], diff, {titlePrefixed: false, isOperator: false}),
      2_000,
    )

    expect(result).toEqual({ok: false, matchedFiles: ['private-repo.md']})
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

  it('handles a long unterminated opening-bracket run within a bounded time', () => {
    const content = '[['.repeat(12_000)

    // This wall-clock bound catches the old global-regex retry cascade on uncontrolled page bodies.
    const result = expectCompletesWithin(() => collectWikilinks(content), 2_000)

    expect(result).toEqual([])
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

  it('handles many malformed wiki log headers within a bounded time', () => {
    const log = Array.from({length: 12_000}, () => '\n## [unterminated').join('')

    // This wall-clock bound guards log merging against polynomial header backtracking.
    const result = expectCompletesWithin(() => mergeWikiLogs([log]), 2_000)

    expect(result).toContain('# Wiki Log')
    expect(result).not.toContain('unterminated')
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

  it('trims a long hyphen run within a bounded time', () => {
    const owner = `${'-'.repeat(120_000)}owner`

    // This wall-clock bound prevents the old ambiguous trim expression from returning to the package.
    const result = expectCompletesWithin(() => computeRepoSlug(owner, 'repo'), 2_000)

    expect(result).toBe('owner--repo')
  })
})
