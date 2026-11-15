import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
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

describe('checkMarkdownLinks file discovery', () => {
  const broken = '[x](nowhere.md)\n'

  it('visits root *.md files and every *.md below docs/ at any depth, in sorted order, and nothing else', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-walk-'))
    await mkdir(join(rootDir, 'docs', 'a', 'b'), {recursive: true})
    await mkdir(join(rootDir, 'other'), {recursive: true})
    for (const path of ['Z.md', 'A.md', 'docs/z.md', 'docs/a/m.md', 'docs/a/b/deep.md', 'other/skip.md']) {
      await writeFile(join(rootDir, path), broken)
    }
    for (const path of ['notes.txt', 'docs/notes.txt', 'docs/a/readme.md.bak', 'docs/md']) {
      await writeFile(join(rootDir, path), broken)
    }
    await mkdir(join(rootDir, 'dir.md'))

    const findings = await checkMarkdownLinks(rootDir)

    expect(findings.map(finding => finding.path)).toEqual([
      'A.md',
      'Z.md',
      'docs/a/b/deep.md',
      'docs/a/m.md',
      'docs/z.md',
    ])
  })

  it('sorts the paths as strings, so a docs path comes before a root file that sorts after it', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-sort-'))
    await mkdir(join(rootDir, 'docs'), {recursive: true})
    await writeFile(join(rootDir, 'zeta.md'), broken)
    await writeFile(join(rootDir, 'docs', 'alpha.md'), broken)

    const findings = await checkMarkdownLinks(rootDir)

    expect(findings.map(finding => finding.path)).toEqual(['docs/alpha.md', 'zeta.md'])
  })

  it('treats a missing docs directory as empty but reports any other failure to read it', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-docs-'))
    await writeFile(join(rootDir, 'README.md'), broken)
    await expect(checkMarkdownLinks(rootDir)).resolves.toHaveLength(1)

    await writeFile(join(rootDir, 'docs'), 'a file, not a directory')
    await expect(checkMarkdownLinks(rootDir)).rejects.toThrow(/ENOTDIR|not a directory/iu)
  })

  it('reports a root that cannot be read', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-missing-'))
    await expect(checkMarkdownLinks(join(rootDir, 'gone'))).rejects.toThrow(/ENOENT/u)
  })
})

describe('checkMarkdownLinks llms.txt', () => {
  it('reports a broken link in the root llms.txt with the file name, line and target', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-llms-'))
    await writeFile(join(rootDir, 'llms.txt'), '# Title\n\n- [Gone](packages/wiki-ops/src/gone.ts): a deleted module\n')

    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([
      {path: 'llms.txt', line: 3, target: 'packages/wiki-ops/src/gone.ts'},
    ])
  })

  it('passes a root llms.txt whose relative, root-absolute, directory and anchored links all resolve', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-llms-'))
    await mkdir(join(rootDir, 'scripts'), {recursive: true})
    await mkdir(join(rootDir, '.github', 'workflows'), {recursive: true})
    await writeFile(join(rootDir, 'README.md'), '# Readme\n')
    await writeFile(join(rootDir, 'scripts', 'a.ts'), '')
    await writeFile(join(rootDir, '.github', 'workflows', 'main.yaml'), '')
    await writeFile(
      join(rootDir, 'llms.txt'),
      [
        '- [Readme](README.md)',
        '- [Anchored](README.md#section)',
        '- [Directory](scripts/)',
        '- [Module](scripts/a.ts)',
        '- [Absolute](/.github/workflows/main.yaml)',
        '',
      ].join('\n'),
    )

    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([])
  })

  it('keeps skipping external, anchor-only and protocol-relative targets in llms.txt', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-llms-'))
    await writeFile(
      join(rootDir, 'llms.txt'),
      [
        '- [Web](https://example.com/nowhere)',
        '- [Mail](mailto:someone@example.com)',
        '- [Anchor](#nowhere)',
        '- [Protocol-relative](//example.com/nowhere)',
        '- ![Image](missing.png)',
        '',
      ].join('\n'),
    )

    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([])
  })

  it('treats a repository without llms.txt as clean', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-llms-'))
    await writeFile(join(rootDir, 'README.md'), '# Readme\n')

    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([])
  })

  it('scans only the llms.txt at the root: not a nested one, not another .txt, not a directory of that name', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-llms-'))
    await mkdir(join(rootDir, 'docs'), {recursive: true})
    await mkdir(join(rootDir, 'other'), {recursive: true})
    const broken = '[x](nowhere.md)\n'
    for (const path of ['docs/llms.txt', 'other/llms.txt', 'llms-full.txt', 'notes.txt', 'LLMS.TXT.bak']) {
      await writeFile(join(rootDir, path), broken)
    }
    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([])

    await rm(join(rootDir, 'LLMS.TXT.bak'))
    await mkdir(join(rootDir, 'dir'), {recursive: true})
    await mkdir(join(rootDir, 'llms.txt'))
    await expect(checkMarkdownLinks(rootDir)).resolves.toEqual([])
  })

  it('reports llms.txt in sorted position among the markdown files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'check-md-links-llms-'))
    await mkdir(join(rootDir, 'docs'), {recursive: true})
    await writeFile(join(rootDir, 'zeta.md'), '[x](nowhere.md)\n')
    await writeFile(join(rootDir, 'llms.txt'), '[x](nowhere.md)\n')
    await writeFile(join(rootDir, 'README.md'), '[x](nowhere.md)\n')
    await writeFile(join(rootDir, 'docs', 'alpha.md'), '[x](nowhere.md)\n')

    const findings = await checkMarkdownLinks(rootDir)

    expect(findings.map(finding => finding.path)).toEqual(['README.md', 'docs/alpha.md', 'llms.txt', 'zeta.md'])
  })
})
