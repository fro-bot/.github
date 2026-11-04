import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, it} from 'vitest'
import {checkMarkdownLinks} from './check-md-links.ts'

describe('checkMarkdownLinks', () => {
  it('checks docs and root markdown files while excluding knowledge', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-'))
    await mkdir(join(rootDir, 'docs'), {recursive: true})
    await mkdir(join(rootDir, 'knowledge'), {recursive: true})
    await writeFile(join(rootDir, 'README.md'), '[Docs](docs/guide.md)\n')
    await writeFile(join(rootDir, 'docs', 'guide.md'), '[Root](../README.md)\n')
    await writeFile(join(rootDir, 'knowledge', 'index.md'), '[Dead](missing.md)\n')

    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([])
  })

  it('returns every broken link with its repository-relative path, line, and target', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-'))
    await mkdir(join(rootDir, 'docs'), {recursive: true})
    await writeFile(join(rootDir, 'docs', 'guide.md'), '[One](missing-one.md)\n\n[Two](missing-two.md)\n')

    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([
      {path: 'docs/guide.md', line: 1, target: 'missing-one.md'},
      {path: 'docs/guide.md', line: 3, target: 'missing-two.md'},
    ])
  })
})
