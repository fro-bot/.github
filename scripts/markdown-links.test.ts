import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {resolveMarkdownLinks} from '@fro.bot/wiki-write-core/markdown-links'
import {describe, expect, it} from 'vitest'

describe('resolveMarkdownLinks', () => {
  it('resolves a valid relative link and reports that it exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'markdown-links-'))
    await mkdir(join(rootDir, 'docs'), {recursive: true})
    await writeFile(join(rootDir, 'docs', 'guide.md'), '[Guide](reference.md)\n')
    await writeFile(join(rootDir, 'docs', 'reference.md'), '# Reference\n')

    const links = resolveMarkdownLinks('[Guide](reference.md)', 'docs/guide.md', {rootDir})

    expect(links).toEqual([
      {
        target: 'reference.md',
        line: 1,
        resolvedPath: 'docs/reference.md',
        exists: true,
      },
    ])
  })

  it('reports a dead relative link', () => {
    const links = resolveMarkdownLinks('[Missing](missing.md)', 'docs/guide.md', {rootDir: '/tmp'})

    expect(links).toEqual([
      {
        target: 'missing.md',
        line: 1,
        resolvedPath: 'docs/missing.md',
        exists: false,
      },
    ])
  })

  it.each([
    ['https://example.com', 'external URL'],
    ['mailto:test@example.com', 'mailto URL'],
    ['//example.com/docs', 'protocol-relative URL'],
    ['#section', 'fragment-only target'],
    ['', 'empty target'],
  ])('skips a %s', target => {
    expect(resolveMarkdownLinks(`[Link](${target})`, 'docs/guide.md', {rootDir: '/tmp'})).toEqual([])
  })

  it('strips a trailing anchor before resolving the base file', () => {
    const links = resolveMarkdownLinks('[Reference](reference.md#details)', 'docs/guide.md', {
      rootDir: '/tmp',
      files: {'docs/reference.md': '# Reference\n'},
    })

    expect(links).toEqual([
      {
        target: 'reference.md#details',
        line: 1,
        resolvedPath: 'docs/reference.md',
        exists: true,
      },
    ])
  })

  it('strips a trailing query before resolving the base file', () => {
    const links = resolveMarkdownLinks('[Reference](reference.md?download=1)', 'docs/guide.md', {
      files: {'docs/reference.md': '# Reference\n'},
    })

    expect(links[0]?.resolvedPath).toBe('docs/reference.md')
    expect(links[0]?.exists).toBe(true)
  })

  it('resolves parent-directory traversal', () => {
    const links = resolveMarkdownLinks('[Parent](../README.md)', 'docs/guide.md', {
      files: {'README.md': '# Root\n'},
    })

    expect(links).toEqual([
      {
        target: '../README.md',
        line: 1,
        resolvedPath: 'README.md',
        exists: true,
      },
    ])
  })

  it('resolves a repository-root-relative target from the repository root', () => {
    const links = resolveMarkdownLinks('[Docs](/docs/reference.md)', 'docs/plans/guide.md', {
      files: {'docs/reference.md': '# Reference\n'},
    })

    expect(links).toEqual([
      {
        target: '/docs/reference.md',
        line: 1,
        resolvedPath: 'docs/reference.md',
        exists: true,
      },
    ])
  })

  it('does not treat links inside fenced code blocks as live links', () => {
    const content = ['Before:', '', '```', '[Broken](missing.md)', '```', '', 'After: [Live](existing.md)'].join('\n')

    const links = resolveMarkdownLinks(content, 'docs/guide.md', {
      files: {'docs/existing.md': '# Existing\n'},
    })

    expect(links).toEqual([
      {
        target: 'existing.md',
        line: 7,
        resolvedPath: 'docs/existing.md',
        exists: true,
      },
    ])
  })

  describe('inline code spans', () => {
    const resolveTargets = (content: string): string[] =>
      resolveMarkdownLinks(content, 'docs/guide.md', {files: {}}).map(link => link.target)

    it('ignores a link inside a single-backtick code span', () => {
      expect(resolveTargets('The footer is `[MIT](LICENSE)` today.')).toEqual([])
    })

    it('ignores a link inside a double-backtick code span that contains a backtick', () => {
      expect(resolveTargets('Write ``a ` [Broken](missing.md)`` literally.')).toEqual([])
    })

    it('still ignores a link inside a fenced block', () => {
      expect(resolveTargets(['```', '[Broken](missing.md)', '```'].join('\n'))).toEqual([])
    })

    it('still finds a real link on the same line as a code span', () => {
      expect(resolveTargets('Use `[MIT](LICENSE)` or see [Guide](guide.md) and `code`.')).toEqual(['guide.md'])
    })

    it('finds a link whose text contains a code span', () => {
      expect(resolveTargets('See [the `foo` guide](guide.md).')).toEqual(['guide.md'])
    })

    it('does not let an escaped backtick open a span', () => {
      expect(resolveTargets('Literal \\` then [Real](real.md) then `[Fake](fake.md)`')).toEqual(['real.md'])
      expect(resolveTargets('Literal \\` and [Real](real.md) and \\` end')).toEqual(['real.md'])
    })

    it('does not let a backtick run of a different length close a span', () => {
      expect(resolveTargets('``[Broken](missing.md)` still open')).toEqual(['missing.md'])
    })

    it('does not let an unclosed backtick run swallow the rest of the line', () => {
      expect(resolveTargets('An unclosed ` tick then [Real](real.md) and [Other](other.md)')).toEqual([
        'real.md',
        'other.md',
      ])
    })

    it('drops a link that straddles a code span boundary', () => {
      expect(resolveTargets('[a `b](c.md) d` e](f.md)')).toEqual([])
    })

    it('does not let a rejected bracket in code swallow a live link that follows it', () => {
      expect(resolveTargets('`[literal` then [Real](real.md)')).toEqual(['real.md'])
      expect(resolveTargets('``[a `` then [Real](real.md) and `[b` [Other](other.md)')).toEqual(['real.md', 'other.md'])
    })

    it('treats a line-leading triple-backtick span as an inline span, not a fence', () => {
      const tick = '`'.repeat(3)

      expect(resolveTargets(`${tick}[Broken](missing.md)${tick} and [Live](live.md)`)).toEqual(['live.md'])
      expect(resolveTargets([`${tick}example${tick}`, '[Live](live.md)'].join('\n'))).toEqual(['live.md'])
    })

    it('opens a tilde fence even when its info string contains backticks', () => {
      expect(resolveTargets(['~~~ js `x`', '[Broken](missing.md)', '~~~', '[Live](live.md)'].join('\n'))).toEqual([
        'live.md',
      ])
    })

    it('does not close a fence on a marker followed by trailing text', () => {
      const content = ['```', '```not-a-close', '[Broken](missing.md)', '```', '[Live](live.md)'].join('\n')

      expect(resolveTargets(content)).toEqual(['live.md'])
    })

    it('closes a fence on a longer marker, on trailing spaces or tabs, but not on a shorter one', () => {
      expect(resolveTargets(['```', '[Broken](a.md)', '`````', '[Live](live.md)'].join('\n'))).toEqual(['live.md'])
      expect(resolveTargets(['```', '[Broken](a.md)', '```  \t', '[Live](live.md)'].join('\n'))).toEqual(['live.md'])
      expect(
        resolveTargets(['`````', '[Broken](a.md)', '```', '[Still](b.md)', '`````', '[Live](live.md)'].join('\n')),
      ).toEqual(['live.md'])
    })

    it('does not open a fence from a marker indented four or more spaces', () => {
      expect(resolveTargets(['    ```', '[Live](live.md)'].join('\n'))).toEqual(['live.md'])
      expect(resolveTargets(['   ```', '[Broken](missing.md)', '   ```', '[Live](live.md)'].join('\n'))).toEqual([
        'live.md',
      ])
    })

    // Regression for #3903: wiki-lint flagged the README footer example quoted in a wiki page as a broken link.
    it('does not report the link-shaped code span from the #3903 wiki line', () => {
      const line =
        "- **License:** MIT (declared in `package.json` and README badge; GitHub `license` API reads null — no detectable `LICENSE` file, consistent across all surveys). **2026-09-16 addition:** the README's footer link is `[MIT](LICENSE)` — a relative link to a file that has never existed in the 66-blob tree. It renders as a live link and 404s. Small, but it is the same defect class as the build badge: a reference that looks resolved because nothing tries to resolve it."

      expect(resolveMarkdownLinks(line, 'knowledge/wiki/repos/marcusrbrown--marcusrbrown-com.md', {files: {}})).toEqual(
        [],
      )
    })
  })
})
