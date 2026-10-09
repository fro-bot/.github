import type {promises as fs} from 'node:fs'

import {access, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {buildDraftedHandoff} from './drafted-solutions-handoff-build.ts'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async dir => rm(dir, {recursive: true, force: true})))
})

/** Join porcelain -z records with NUL separators, plus a trailing NUL (git's actual output shape). */
function nulRecords(...records: string[]): string {
  return records.length === 0 ? '' : `${records.join('\0')}\0`
}

function makeIo() {
  const copied: string[] = []
  const written: Record<string, string> = {}
  return {
    copied,
    written,
    mkdirImpl: vi.fn(async () => undefined) as unknown as typeof fs.mkdir,
    copyFileImpl: vi.fn(async (_from: unknown, to: unknown) => {
      copied.push(String(to))
    }) as unknown as typeof fs.copyFile,
    writeFileImpl: vi.fn(async (target: unknown, data: unknown) => {
      written[String(target)] = String(data)
    }) as unknown as typeof fs.writeFile,
  }
}

describe('buildDraftedHandoff', () => {
  it('copies new and modified solution docs and writes a manifest with no deletions', async () => {
    const io = makeIo()

    const result = await buildDraftedHandoff({
      cwd: '/repo',
      outDir: '/out',
      runGitStatus: async () =>
        nulRecords(
          '?? docs/solutions/best-practices/new-doc-2026-10-09.md',
          ' M docs/solutions/workflow-issues/existing.md',
        ),
      ...io,
    })

    expect(result).toStrictEqual({
      changed: ['docs/solutions/best-practices/new-doc-2026-10-09.md', 'docs/solutions/workflow-issues/existing.md'],
      deleted: [],
    })
    expect(io.copied).toStrictEqual([
      '/out/files/docs/solutions/best-practices/new-doc-2026-10-09.md',
      '/out/files/docs/solutions/workflow-issues/existing.md',
    ])
    expect(JSON.parse(io.written['/out/manifest.json'] ?? '')).toStrictEqual(result)
  })

  it('writes an empty manifest when the agent changed nothing', async () => {
    const io = makeIo()

    const result = await buildDraftedHandoff({cwd: '/repo', outDir: '/out', runGitStatus: async () => '', ...io})

    expect(result).toStrictEqual({changed: [], deleted: []})
    expect(JSON.parse(io.written['/out/manifest.json'] ?? '')).toStrictEqual({changed: [], deleted: []})
  })

  it.each([
    ['an uncategorised doc', '?? docs/solutions/x.md'],
    ['an unknown category', '?? docs/solutions/new-category/x.md'],
    ['a non-markdown file', '?? docs/solutions/best-practices/x.yaml'],
    ['a nested file', '?? docs/solutions/best-practices/nested/x.md'],
    ['a path outside solutions', '?? docs/plans/x.md'],
  ])('fails closed on %s and copies nothing', async (_label: string, record: string) => {
    const io = makeIo()

    await expect(
      buildDraftedHandoff({
        cwd: '/repo',
        outDir: '/out',
        runGitStatus: async () => nulRecords('?? docs/solutions/best-practices/ok.md', record),
        ...io,
      }),
    ).rejects.toThrow(/out-of-scope/)
    expect(io.copied).toStrictEqual([])
  })

  it('fails when the agent deleted a solution doc', async () => {
    const io = makeIo()

    await expect(
      buildDraftedHandoff({
        cwd: '/repo',
        outDir: '/out',
        runGitStatus: async () => nulRecords(' D docs/solutions/best-practices/old.md'),
        ...io,
      }),
    ).rejects.toThrow(/deletions are not allowed/)
  })

  it('fails when the agent renamed a solution doc (rename = delete + add)', async () => {
    const io = makeIo()

    await expect(
      buildDraftedHandoff({
        cwd: '/repo',
        outDir: '/out',
        runGitStatus: async () =>
          nulRecords('R  docs/solutions/best-practices/new.md', 'docs/solutions/best-practices/old.md'),
        ...io,
      }),
    ).rejects.toThrow(/deletions are not allowed/)
  })
})

async function arrange() {
  const root = await mkdtemp(path.join(tmpdir(), 'drafted-handoff-build-test-'))
  tempDirs.push(root)
  const cwd = path.join(root, 'checkout')
  await mkdir(path.join(cwd, 'docs/solutions/best-practices'), {recursive: true})
  await writeFile(path.join(root, 'outside-secret.txt'), 'runner-readable secret')
  return {root, cwd, outDir: path.join(root, 'handoff')}
}

describe('buildDraftedHandoff against the real filesystem', () => {
  it('fails before producing any artifact when a solution doc is a symlink to an out-of-scope file', async () => {
    const {root, cwd, outDir} = await arrange()
    await writeFile(path.join(cwd, 'docs/solutions/best-practices/ok.md'), '# ok\n')
    await symlink(path.join(root, 'outside-secret.txt'), path.join(cwd, 'docs/solutions/best-practices/leak.md'))

    await expect(
      buildDraftedHandoff({
        cwd,
        outDir,
        runGitStatus: async () =>
          nulRecords('?? docs/solutions/best-practices/ok.md', '?? docs/solutions/best-practices/leak.md'),
      }),
    ).rejects.toThrow(/refusing symlink source/)
    await expect(access(outDir)).rejects.toThrow()
  })

  it('builds from regular files on the real filesystem', async () => {
    const {cwd, outDir} = await arrange()
    await writeFile(path.join(cwd, 'docs/solutions/best-practices/ok.md'), '# ok\n')

    const result = await buildDraftedHandoff({
      cwd,
      outDir,
      runGitStatus: async () => nulRecords('?? docs/solutions/best-practices/ok.md'),
    })

    expect(result.changed).toStrictEqual(['docs/solutions/best-practices/ok.md'])
    expect(await readFile(path.join(outDir, 'files/docs/solutions/best-practices/ok.md'), 'utf8')).toBe('# ok\n')
  })
})
