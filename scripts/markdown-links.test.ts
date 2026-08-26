import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, it} from 'vitest'
import {resolveMarkdownLinks} from './markdown-links.ts'

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
})
