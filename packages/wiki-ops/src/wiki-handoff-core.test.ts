import type {promises as fs} from 'node:fs'

import {Buffer} from 'node:buffer'
import {rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import process from 'node:process'

import {afterAll, describe, expect, it, vi} from 'vitest'

import {
  assertSafeHandoffPath,
  assertSafeWikiHandoffPath,
  buildHandoffFromGitIndex,
  buildWikiHandoff,
  captureWikiBaseline,
  draftedSolutionsHandoffMaxTotalBytes,
  draftedSolutionsHandoffPolicy,
  isAllowedDraftedSolutionPath,
  isAllowedWikiHandoffPath,
  parseGitStatusPorcelainZ,
  validateAndApplyHandoff,
  validateAndApplyWikiHandoff,
  wikiHandoffMaxTotalBytes,
  wikiHandoffPolicy,
  WikiHandoffValidationError,
  type GitRunner,
  type HandoffPolicy,
} from './wiki-handoff-core.ts'

/**
 * Every path below lives under one test-owned temp directory. All filesystem access in this file goes
 * through injected seams, so nothing is written; if a seam were ever left to its real default (a
 * regression, or a Stryker mutant on the `??` fallback), the call would land inside this directory and
 * never on a path outside it. The directory is removed when the file finishes.
 */
const T = `${tmpdir()}/wiki-handoff-core-test-${process.pid}`

afterAll(() => {
  rmSync(T, {recursive: true, force: true})
})

/** Join porcelain -z records with NUL separators, plus a trailing NUL (git's actual output shape). */
function nulRecords(...records: string[]): string {
  return records.length === 0 ? '' : `${records.join('\0')}\0`
}

function makeBaselineMocks(params: {
  baselineFiles: Record<string, string>
  baselineDeleted?: string[]
  currentContents: Record<string, string>
  existingPaths: Set<string>
}): {
  readFileImpl: typeof fs.readFile
  existsImpl: (target: string) => Promise<boolean>
  hashImpl: (contents: Buffer) => string
} {
  const readFileImplMock = vi.fn(async (target: unknown, encoding?: unknown) => {
    const key = String(target)
    if (key === `${T}/baseline.json`) {
      return JSON.stringify({files: params.baselineFiles, deleted: params.baselineDeleted ?? []})
    }
    const relative = key.replace(`${T}/repo/`, '')
    const content = params.currentContents[relative]
    if (content === undefined) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    return encoding === 'utf8' ? content : Buffer.from(content)
  })
  const existsImpl = vi.fn(async (target: string) => {
    const relative = target.replace(`${T}/repo/`, '')
    return params.existingPaths.has(relative)
  })
  const hashImpl = (contents: Buffer) => contents.toString('utf8')

  return {readFileImpl: readFileImplMock as unknown as typeof fs.readFile, existsImpl, hashImpl}
}

describe('isAllowedWikiHandoffPath', () => {
  it('allows knowledge/index.md and knowledge/log.md exactly', () => {
    expect(isAllowedWikiHandoffPath('knowledge/index.md')).toBe(true)
    expect(isAllowedWikiHandoffPath('knowledge/log.md')).toBe(true)
  })

  it('allows any .md file under knowledge/wiki/', () => {
    expect(isAllowedWikiHandoffPath('knowledge/wiki/repos/marcusrbrown-foo.md')).toBe(true)
  })

  it('rejects non-.md files under knowledge/wiki/', () => {
    expect(isAllowedWikiHandoffPath('knowledge/wiki/repos/foo.yaml')).toBe(false)
  })

  it('rejects paths outside the knowledge scope', () => {
    expect(isAllowedWikiHandoffPath('metadata/repos.yaml')).toBe(false)
    expect(isAllowedWikiHandoffPath('scripts/wiki-ingest.ts')).toBe(false)
    expect(isAllowedWikiHandoffPath('knowledge/schema.md')).toBe(false)
  })
})

describe('parseGitStatusPorcelainZ', () => {
  it('classifies untracked and modified paths as changed', () => {
    const output = nulRecords('?? knowledge/wiki/repos/new.md', ' M knowledge/index.md')
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md', 'knowledge/index.md'],
      deleted: [],
    })
  })

  it('classifies deleted paths', () => {
    const output = nulRecords(' D knowledge/wiki/repos/gone.md')
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: [],
      deleted: ['knowledge/wiki/repos/gone.md'],
    })
  })

  it('splits a rename into a deletion of the old path (the following NUL field) and a change of the new path', () => {
    // -z rename shape: "R  <new-path>\0<old-path>\0" — no "->" separator.
    const output = nulRecords('R  knowledge/wiki/repos/new.md', 'knowledge/wiki/repos/old.md')
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: ['knowledge/wiki/repos/old.md'],
    })
  })

  it('handles a copy record the same way as a rename', () => {
    const output = nulRecords('C  knowledge/wiki/repos/copy.md', 'knowledge/wiki/repos/source.md')
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/copy.md'],
      deleted: ['knowledge/wiki/repos/source.md'],
    })
  })

  it('expands every file inside a new untracked directory (via --untracked-files=all), not a single dir/ entry', () => {
    const output = nulRecords(
      '?? knowledge/wiki/newcat/one.md',
      '?? knowledge/wiki/newcat/two.md',
      '?? knowledge/wiki/newcat/nested/three.md',
    )
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: [
        'knowledge/wiki/newcat/one.md',
        'knowledge/wiki/newcat/two.md',
        'knowledge/wiki/newcat/nested/three.md',
      ],
      deleted: [],
    })
  })

  it('handles a path containing a space without quoting corruption (the -z guarantee)', () => {
    const output = nulRecords('?? knowledge/wiki/repos/my project.md')
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/my project.md'],
      deleted: [],
    })
  })

  it('handles a non-ASCII path without quoting/escaping corruption', () => {
    const output = nulRecords('?? knowledge/wiki/repos/caf\u00E9-notes.md')
    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/caf\u00E9-notes.md'],
      deleted: [],
    })
  })

  it('ignores empty input', () => {
    expect(parseGitStatusPorcelainZ('')).toStrictEqual({changed: [], deleted: []})
  })
})

describe('buildWikiHandoff', () => {
  it('writes only manifest.json and copies changed files — no ingest metadata of any kind', async () => {
    const writes: Record<string, string> = {}
    const copies: [string, string][] = []
    const result = await buildWikiHandoff({
      cwd: `${T}/repo`,
      outDir: `${T}/tmp/handoff`,
      runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/new.md', ' D knowledge/log.md'),
      mkdirImpl: vi.fn(async () => undefined),
      copyFileImpl: vi.fn(async (src: unknown, dest: unknown) => {
        copies.push([String(src), String(dest)])
      }),
      writeFileImpl: vi.fn(async (target: unknown, data: unknown) => {
        writes[String(target)] = String(data)
      }),
    })

    expect(result).toStrictEqual({changed: ['knowledge/wiki/repos/new.md'], deleted: ['knowledge/log.md']})
    expect(copies).toStrictEqual([
      [`${T}/repo/knowledge/wiki/repos/new.md`, `${T}/tmp/handoff/files/knowledge/wiki/repos/new.md`],
    ])
    expect(JSON.parse(writes[`${T}/tmp/handoff/manifest.json`] ?? '')).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: ['knowledge/log.md'],
    })
    // The build side must never write anything else — no metadata.json, no other file.
    expect(Object.keys(writes)).toStrictEqual([`${T}/tmp/handoff/manifest.json`])
  })

  it('throws when git reports a path outside the wiki scope (defense in depth)', async () => {
    await expect(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? metadata/repos.yaml'),
      }),
    ).rejects.toThrow('out-of-scope paths')
  })

  describe('baseline scoping', () => {
    it('excludes a page that differs between data and main but was never touched by the agent', async () => {
      // git status reports it (data/main differ), but its content hash matches the baseline
      // taken right after sync — the agent never wrote to it.
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/untouched.md': 'same-content'},
        currentContents: {'knowledge/wiki/repos/untouched.md': 'same-content'},
        existingPaths: new Set(['knowledge/wiki/repos/untouched.md']),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/untouched.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: [], deleted: []})
    })

    it('includes a page the agent actually edited (content hash differs from baseline)', async () => {
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/edited.md': 'baseline-content'},
        currentContents: {'knowledge/wiki/repos/edited.md': 'agent-edited-content'},
        existingPaths: new Set(['knowledge/wiki/repos/edited.md']),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/edited.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: ['knowledge/wiki/repos/edited.md'], deleted: []})
    })

    it('includes a page the agent created in a brand-new directory (no baseline entry)', async () => {
      const mocks = makeBaselineMocks({
        baselineFiles: {},
        currentContents: {'knowledge/wiki/newcat/created.md': 'new-content'},
        existingPaths: new Set(['knowledge/wiki/newcat/created.md']),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/newcat/created.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: ['knowledge/wiki/newcat/created.md'], deleted: []})
    })

    it('lists an agent-deleted, baseline-only (untracked) page as deleted even though git status has no entry for it', async () => {
      // Untracked removal produces no git-status entry; detected via baseline-vs-disk existence.
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/removed.md': 'baseline-content'},
        currentContents: {},
        existingPaths: new Set(),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords(), // nothing reported — the untracked file just vanished
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: [], deleted: ['knowledge/wiki/repos/removed.md']})
    })

    it('excludes a tracked-in-HEAD deletion already caused by sync-wiki at baseline time (main tracks it, data does not)', async () => {
      // Already deleted at baseline (sync-wiki), so this must not be forwarded as an agent deletion.
      const mocks = makeBaselineMocks({
        baselineFiles: {},
        baselineDeleted: ['knowledge/wiki/repos/sync-caused-gone.md'],
        currentContents: {},
        existingPaths: new Set(),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords(' D knowledge/wiki/repos/sync-caused-gone.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: [], deleted: []})
    })

    it('still reports a real agent-caused deletion of a page that existed (and was present, not deleted) at baseline', async () => {
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/tracked-present.md': 'baseline-content'},
        baselineDeleted: [],
        currentContents: {},
        existingPaths: new Set(),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords(' D knowledge/wiki/repos/tracked-present.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: [], deleted: ['knowledge/wiki/repos/tracked-present.md']})
    })

    it('an empty manifest results when nothing changed since baseline, even with mixed candidates', async () => {
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/untouched.md': 'same'},
        currentContents: {'knowledge/wiki/repos/untouched.md': 'same'},
        existingPaths: new Set(['knowledge/wiki/repos/untouched.md']),
      })

      const result = await buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/untouched.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: [], deleted: []})
    })
  })
})

describe('captureWikiBaseline', () => {
  it('hashes every changed (added/modified/untracked) candidate path, and records deletions separately in `deleted`', async () => {
    const written: Record<string, string> = {}
    const manifest = await captureWikiBaseline({
      cwd: `${T}/repo`,
      baselinePath: `${T}/baseline.json`,
      runGitStatus: async () =>
        nulRecords('?? knowledge/wiki/repos/a.md', ' M knowledge/index.md', ' D knowledge/log.md'),
      readFileImpl: vi.fn(async (target: unknown) => {
        const key = String(target)
        if (key === `${T}/repo/knowledge/wiki/repos/a.md`) return Buffer.from('content-a')
        if (key === `${T}/repo/knowledge/index.md`) return Buffer.from('content-index')
        throw new Error(`unexpected read: ${key}`)
      }) as unknown as typeof fs.readFile,
      writeFileImpl: vi.fn(async (target: unknown, data: unknown) => {
        written[String(target)] = String(data)
      }),
      hashImpl: (contents: Buffer) => `hash:${contents.toString('utf8')}`,
    })

    expect(manifest).toStrictEqual({
      files: {
        'knowledge/wiki/repos/a.md': 'hash:content-a',
        'knowledge/index.md': 'hash:content-index',
      },
      deleted: ['knowledge/log.md'],
    })
    expect(JSON.parse(written[`${T}/baseline.json`] ?? '')).toStrictEqual(manifest)
  })

  it('skips any candidate path outside the wiki allowlist defensively', async () => {
    const manifest = await captureWikiBaseline({
      cwd: `${T}/repo`,
      baselinePath: `${T}/baseline.json`,
      runGitStatus: async () => nulRecords('?? metadata/repos.yaml', '?? knowledge/wiki/repos/a.md'),
      readFileImpl: vi.fn(async () => Buffer.from('content')) as unknown as typeof fs.readFile,
      writeFileImpl: vi.fn(async () => undefined),
      hashImpl: () => 'hash',
    })

    expect(Object.keys(manifest.files)).toStrictEqual(['knowledge/wiki/repos/a.md'])
  })

  it('skips any deleted candidate path outside the wiki allowlist defensively', async () => {
    const manifest = await captureWikiBaseline({
      cwd: `${T}/repo`,
      baselinePath: `${T}/baseline.json`,
      runGitStatus: async () => nulRecords(' D metadata/repos.yaml', ' D knowledge/wiki/repos/gone.md'),
      readFileImpl: vi.fn(async () => Buffer.from('content')) as unknown as typeof fs.readFile,
      writeFileImpl: vi.fn(async () => undefined),
      hashImpl: () => 'hash',
    })

    expect(manifest.deleted).toStrictEqual(['knowledge/wiki/repos/gone.md'])
  })
})

describe('assertSafeWikiHandoffPath', () => {
  it('accepts an allowlisted relative path', () => {
    expect(() => assertSafeWikiHandoffPath('knowledge/wiki/repos/foo.md')).not.toThrow()
  })

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['knowledge/wiki/../../../etc/passwd', 'traversal'],
    ['knowledge/wiki/repos/foo.yaml', 'wrong extension'],
    ['metadata/repos.yaml', 'outside scope'],
    ['knowledge//index.md', 'empty segment'],
  ])('rejects %s (%s)', (path: string) => {
    expect(() => assertSafeWikiHandoffPath(path)).toThrow(WikiHandoffValidationError)
  })
})

function makeFsMocks(
  files: Record<string, {size: number; symlink?: boolean; isDir?: boolean}>,
  topLevelEntries: string[] = ['manifest.json', 'files'],
) {
  const written: Record<string, Buffer> = {}
  const removed: string[] = []
  let manifestJson = '{"changed":[],"deleted":[]}'

  const mkdirImpl = vi.fn(async () => undefined) as unknown as typeof fs.mkdir
  const readdirImpl = vi.fn(async () => topLevelEntries) as unknown as typeof fs.readdir
  const lstatImpl = vi.fn(async (target: unknown) => {
    const entry = files[String(target)]
    if (entry === undefined) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    return {
      isSymbolicLink: () => entry.symlink === true,
      isFile: () => entry.symlink !== true && entry.isDir !== true,
      size: entry.size,
    }
  }) as unknown as typeof fs.lstat
  const readFileImpl = vi.fn(async (_target: unknown, encoding?: unknown) => {
    if (encoding === 'utf8') return manifestJson
    return Buffer.from('content')
  }) as unknown as typeof fs.readFile
  const writeFileImpl = vi.fn(async (target: unknown, data: unknown) => {
    written[String(target)] = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
  }) as unknown as typeof fs.writeFile
  const rmImpl = vi.fn(async (target: unknown) => {
    removed.push(String(target))
  }) as unknown as typeof fs.rm

  return {
    mkdirImpl,
    readdirImpl,
    lstatImpl,
    readFileImpl,
    writeFileImpl,
    rmImpl,
    written,
    removed,
    setManifest: (json: string) => (manifestJson = json),
  }
}

describe('validateAndApplyWikiHandoff', () => {
  it('applies a happy-path manifest: writes changed files and removes deleted files', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 10}})
    mocks.setManifest(
      JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: ['knowledge/wiki/repos/old.md']}),
    )

    const result = await validateAndApplyWikiHandoff({
      handoffDir: `${T}/handoff`,
      workspaceDir: `${T}/workspace`,
      mkdirImpl: mocks.mkdirImpl,
      readdirImpl: mocks.readdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result).toStrictEqual({
      applied: ['knowledge/wiki/repos/foo.md'],
      deleted: ['knowledge/wiki/repos/old.md'],
      skipped: [],
    })
    expect(Object.keys(mocks.written)).toStrictEqual([`${T}/workspace/knowledge/wiki/repos/foo.md`])
    expect(mocks.removed).toStrictEqual([`${T}/workspace/knowledge/wiki/repos/old.md`])
  })

  it('validates but never writes knowledge/log.md or knowledge/index.md, so the workspace copies stay', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 10},
      [`${T}/handoff/files/knowledge/log.md`]: {size: 10},
      [`${T}/handoff/files/knowledge/index.md`]: {size: 10},
    })
    mocks.setManifest(
      JSON.stringify({
        changed: ['knowledge/wiki/repos/foo.md', 'knowledge/log.md', 'knowledge/index.md'],
        deleted: [],
      }),
    )

    const result = await validateAndApplyWikiHandoff({
      handoffDir: `${T}/handoff`,
      workspaceDir: `${T}/workspace`,
      mkdirImpl: mocks.mkdirImpl,
      readdirImpl: mocks.readdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result.applied).toStrictEqual(['knowledge/wiki/repos/foo.md'])
    expect(result.skipped).toStrictEqual(['knowledge/log.md', 'knowledge/index.md'])
    expect(Object.keys(mocks.written)).toStrictEqual([`${T}/workspace/knowledge/wiki/repos/foo.md`])
  })

  it('does not delete knowledge/log.md or knowledge/index.md when the manifest lists them as deleted', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 10}})
    mocks.setManifest(
      JSON.stringify({
        changed: ['knowledge/wiki/repos/foo.md'],
        deleted: ['knowledge/log.md', 'knowledge/index.md', 'knowledge/wiki/repos/old.md'],
      }),
    )

    const result = await validateAndApplyWikiHandoff({
      handoffDir: `${T}/handoff`,
      workspaceDir: `${T}/workspace`,
      mkdirImpl: mocks.mkdirImpl,
      readdirImpl: mocks.readdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(mocks.removed).toStrictEqual([`${T}/workspace/knowledge/wiki/repos/old.md`])
    expect(result.deleted).toStrictEqual(['knowledge/wiki/repos/old.md'])
    expect(result.skipped).toStrictEqual(['knowledge/log.md', 'knowledge/index.md'])
  })

  it('still rejects a symlinked knowledge/log.md before applying anything', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 10},
      [`${T}/handoff/files/knowledge/log.md`]: {size: 10, symlink: true},
    })
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md', 'knowledge/log.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        mkdirImpl: mocks.mkdirImpl,
        readdirImpl: mocks.readdirImpl,
        lstatImpl: mocks.lstatImpl,
        readFileImpl: mocks.readFileImpl,
        writeFileImpl: mocks.writeFileImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
    expect(Object.keys(mocks.written)).toStrictEqual([])
  })

  it('handles an empty/unchanged manifest as a no-op', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest('{"changed":[],"deleted":[]}')

    const result = await validateAndApplyWikiHandoff({
      handoffDir: `${T}/handoff`,
      workspaceDir: `${T}/workspace`,
      mkdirImpl: mocks.mkdirImpl,
      readdirImpl: mocks.readdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result).toStrictEqual({applied: [], deleted: [], skipped: []})
  })

  it('rejects an artifact containing a resurrected metadata.json', async () => {
    const mocks = makeFsMocks({}, ['manifest.json', 'files', 'metadata.json'])

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/unexpected top-level entries/)
  })

  it('rejects an artifact containing any other unexpected top-level entry', async () => {
    const mocks = makeFsMocks({}, ['manifest.json', 'files', '.git'])

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
  })

  it('never reads a metadata.json even if one is present alongside a valid manifest (defense in depth)', async () => {
    // Simulate a compromised build script that both resurrects metadata.json AND keeps a
    // valid manifest — the top-level allowlist check must fire before manifest reading.
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 1}}, [
      'manifest.json',
      'files',
      'metadata.json',
    ])
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/unexpected top-level entries/)
    expect(Object.keys(mocks.written)).toStrictEqual([])
  })

  it('rejects a manifest that is not valid JSON', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest('not json')

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a manifest whose shape is wrong', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest('{"changed":"nope","deleted":[]}')

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/must be a string array/)
  })

  it('rejects path traversal in the manifest', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/../../../etc/passwd'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
  })

  it('rejects an absolute path in the manifest', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(JSON.stringify({changed: ['/etc/passwd'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
  })

  it('rejects a non-.md file under knowledge/wiki', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.yaml'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
  })

  it('rejects a path outside the allowlist entirely', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(JSON.stringify({changed: ['metadata/repos.yaml'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
  })

  it('rejects a symlink entry', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 1, symlink: true}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/symlink/)
  })

  it('rejects a manifest whose total size exceeds the cap', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: wikiHandoffMaxTotalBytes() + 1},
    })
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/size cap/)
  })

  it('writes nothing when validation fails partway through a multi-entry manifest', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/ok.md`]: {size: 1}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/ok.md', 'metadata/repos.yaml'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
    expect(Object.keys(mocks.written)).toStrictEqual([])
  })
})

describe('isAllowedDraftedSolutionPath', () => {
  it.each([
    'docs/solutions/best-practices/new-doc-2026-10-09.md',
    'docs/solutions/documentation-gaps/x.md',
    'docs/solutions/integration-issues/x.md',
    'docs/solutions/runtime-errors/x.md',
    'docs/solutions/security-issues/x.md',
    'docs/solutions/workflow-issues/x.md',
  ])('allows %s', (candidate: string) => {
    expect(isAllowedDraftedSolutionPath(candidate)).toBe(true)
  })

  it.each([
    ['.github/workflows/x.yaml', 'workflow'],
    ['docs/plans/x.md', 'other docs tree'],
    ['docs/solutions/x.md', 'no category'],
    ['docs/solutions/not-a-category/x.md', 'unknown category'],
    ['docs/solutions/best-practices/x.yaml', 'non-.md'],
    ['docs/solutions/best-practices/.md', 'empty stem'],
    ['docs/solutions/best-practices/nested/x.md', 'nested below a category'],
    ['docs/solutions/best-practices', 'category directory itself'],
    ['docs/solutions/best-practices/', 'trailing slash'],
    ['knowledge/wiki/repos/foo.md', 'wiki path'],
  ])('rejects %s (%s)', (candidate: string) => {
    expect(isAllowedDraftedSolutionPath(candidate)).toBe(false)
  })
})

describe('assertSafeHandoffPath', () => {
  it('applies the supplied policy: a wiki path passes the wiki policy and fails the drafted policy', () => {
    expect(() => assertSafeHandoffPath('knowledge/wiki/repos/foo.md', wikiHandoffPolicy())).not.toThrow()
    expect(() => assertSafeHandoffPath('knowledge/wiki/repos/foo.md', draftedSolutionsHandoffPolicy())).toThrow(
      WikiHandoffValidationError,
    )
  })
})

describe('validateAndApplyHandoff with the wiki policy', () => {
  it('still applies deletions and uses the wiki size cap', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/foo.md`]: {size: 10}})
    mocks.setManifest(
      JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: ['knowledge/wiki/repos/old.md']}),
    )

    const result = await validateAndApplyHandoff({
      policy: wikiHandoffPolicy(),
      handoffDir: `${T}/handoff`,
      workspaceDir: `${T}/workspace`,
      mkdirImpl: mocks.mkdirImpl,
      readdirImpl: mocks.readdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result).toStrictEqual({
      applied: ['knowledge/wiki/repos/foo.md'],
      deleted: ['knowledge/wiki/repos/old.md'],
      skipped: [],
    })
    expect(wikiHandoffPolicy().maxTotalBytes).toBe(wikiHandoffMaxTotalBytes())
    expect(wikiHandoffPolicy().allowDeletions).toBe(true)
  })
})

async function applyDrafted(mocks: ReturnType<typeof makeFsMocks>) {
  return validateAndApplyHandoff({
    policy: draftedSolutionsHandoffPolicy(),
    handoffDir: `${T}/handoff`,
    workspaceDir: `${T}/workspace`,
    mkdirImpl: mocks.mkdirImpl,
    readdirImpl: mocks.readdirImpl,
    lstatImpl: mocks.lstatImpl,
    readFileImpl: mocks.readFileImpl,
    writeFileImpl: mocks.writeFileImpl,
    rmImpl: mocks.rmImpl,
  })
}

describe('validateAndApplyHandoff with the drafted-solutions policy', () => {
  it('accepts a new doc and a modified doc under solutions categories', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/docs/solutions/best-practices/new-doc.md`]: {size: 100},
      [`${T}/handoff/files/docs/solutions/workflow-issues/existing-doc.md`]: {size: 200},
    })
    mocks.setManifest(
      JSON.stringify({
        changed: ['docs/solutions/best-practices/new-doc.md', 'docs/solutions/workflow-issues/existing-doc.md'],
        deleted: [],
      }),
    )

    const result = await applyDrafted(mocks)

    expect(result).toStrictEqual({
      applied: ['docs/solutions/best-practices/new-doc.md', 'docs/solutions/workflow-issues/existing-doc.md'],
      deleted: [],
      skipped: [],
    })
    expect(Object.keys(mocks.written)).toStrictEqual([
      `${T}/workspace/docs/solutions/best-practices/new-doc.md`,
      `${T}/workspace/docs/solutions/workflow-issues/existing-doc.md`,
    ])
  })

  it.each([
    ['.github/workflows/x.yaml', 'workflow file'],
    ['docs/plans/x.md', 'plan doc'],
    ['docs/solutions/x.md', 'solution doc without a category'],
    ['docs/solutions/best-practices/x.yaml', 'non-.md file'],
    ['docs/solutions/best-practices/../../../etc/passwd', 'traversal'],
    ['/etc/passwd', 'absolute path'],
  ])('rejects %s (%s) and writes nothing', async (rejected: string) => {
    const mocks = makeFsMocks({[`${T}/handoff/files/docs/solutions/best-practices/ok.md`]: {size: 1}})
    mocks.setManifest(JSON.stringify({changed: ['docs/solutions/best-practices/ok.md', rejected], deleted: []}))

    await expect(applyDrafted(mocks)).rejects.toThrow(WikiHandoffValidationError)
    expect(Object.keys(mocks.written)).toStrictEqual([])
    expect(mocks.removed).toStrictEqual([])
  })

  it('rejects a symlink entry and writes nothing', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/docs/solutions/best-practices/ok.md`]: {size: 1},
      [`${T}/handoff/files/docs/solutions/best-practices/link.md`]: {size: 1, symlink: true},
    })
    mocks.setManifest(
      JSON.stringify({
        changed: ['docs/solutions/best-practices/ok.md', 'docs/solutions/best-practices/link.md'],
        deleted: [],
      }),
    )

    await expect(applyDrafted(mocks)).rejects.toThrow(/symlink/)
    expect(Object.keys(mocks.written)).toStrictEqual([])
    expect(mocks.removed).toStrictEqual([])
  })

  it('rejects a non-empty deleted list, even for an in-scope path, and writes nothing', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/docs/solutions/best-practices/ok.md`]: {size: 1}})
    mocks.setManifest(
      JSON.stringify({
        changed: ['docs/solutions/best-practices/ok.md'],
        deleted: ['docs/solutions/best-practices/old.md'],
      }),
    )

    await expect(applyDrafted(mocks)).rejects.toThrow(/deletions/)
    expect(Object.keys(mocks.written)).toStrictEqual([])
    expect(mocks.removed).toStrictEqual([])
  })

  it('rejects a bundle over the drafted size cap and writes nothing', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/docs/solutions/best-practices/big.md`]: {
        size: draftedSolutionsHandoffMaxTotalBytes() + 1,
      },
    })
    mocks.setManifest(JSON.stringify({changed: ['docs/solutions/best-practices/big.md'], deleted: []}))

    await expect(applyDrafted(mocks)).rejects.toThrow(/size cap/)
    expect(Object.keys(mocks.written)).toStrictEqual([])
  })

  it('accepts a bundle that is exactly at the size cap', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/docs/solutions/best-practices/edge.md`]: {size: draftedSolutionsHandoffMaxTotalBytes()},
    })
    mocks.setManifest(JSON.stringify({changed: ['docs/solutions/best-practices/edge.md'], deleted: []}))

    await expect(applyDrafted(mocks)).resolves.toStrictEqual({
      applied: ['docs/solutions/best-practices/edge.md'],
      deleted: [],
      skipped: [],
    })
  })

  it('rejects unexpected top-level entries just like the wiki policy', async () => {
    const mocks = makeFsMocks({}, ['manifest.json', 'files', '.git'])

    await expect(applyDrafted(mocks)).rejects.toThrow(/unexpected top-level entries/)
  })
})

function sourceMocks(entry: {symlink?: boolean; isDir?: boolean}) {
  return {
    mkdirImpl: vi.fn(async () => undefined),
    copyFileImpl: vi.fn(async () => undefined),
    writeFileImpl: vi.fn(async () => undefined),
    lstatImpl: vi.fn(async () => ({
      isSymbolicLink: () => entry.symlink === true,
      isFile: () => entry.symlink !== true && entry.isDir !== true,
    })) as unknown as typeof fs.lstat,
  }
}

describe('buildWikiHandoff source checks', () => {
  it('refuses a symlinked source at an allowed wiki path before copying or writing anything', async () => {
    const mocks = sourceMocks({symlink: true})

    await expect(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/ok.md', '?? knowledge/wiki/repos/leak.md'),
        ...mocks,
      }),
    ).rejects.toThrow(/refusing symlink source/)
    expect(mocks.copyFileImpl).not.toHaveBeenCalled()
    expect(mocks.writeFileImpl).not.toHaveBeenCalled()
    expect(mocks.mkdirImpl).not.toHaveBeenCalled()
  })

  it('refuses a non-regular source', async () => {
    const mocks = sourceMocks({isDir: true})

    await expect(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/dir.md'),
        ...mocks,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
    expect(mocks.copyFileImpl).not.toHaveBeenCalled()
  })

  it('copies a regular source as before', async () => {
    const mocks = sourceMocks({})

    const result = await buildWikiHandoff({
      cwd: `${T}/repo`,
      outDir: `${T}/tmp/handoff`,
      runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/ok.md'),
      ...mocks,
    })

    expect(result.changed).toStrictEqual(['knowledge/wiki/repos/ok.md'])
    expect(mocks.copyFileImpl).toHaveBeenCalledTimes(1)
  })
})

describe('backslash handoff paths', () => {
  const draftedPaths = [String.raw`docs\solutions\best-practices\x.md`, String.raw`docs/solutions/best-practices\x.md`]
  const wikiPaths = [
    String.raw`knowledge\wiki\repos\x.md`,
    String.raw`knowledge/wiki/repos\x.md`,
    String.raw`knowledge\index.md`,
  ]

  it.each(draftedPaths)('the drafted predicate and path check reject %s', (candidate: string) => {
    expect(isAllowedDraftedSolutionPath(candidate)).toBe(false)
    expect(() => assertSafeHandoffPath(candidate, draftedSolutionsHandoffPolicy())).toThrow(/backslash/)
  })

  it.each(wikiPaths)('the wiki path check rejects %s', (candidate: string) => {
    expect(() => assertSafeHandoffPath(candidate, wikiHandoffPolicy())).toThrow(/backslash/)
    expect(() => assertSafeWikiHandoffPath(candidate)).toThrow(WikiHandoffValidationError)
  })

  it.each(draftedPaths)('apply rejects %s under the drafted policy with nothing written', async (rejected: string) => {
    const mocks = makeFsMocks({[`${T}/handoff/files/docs/solutions/best-practices/ok.md`]: {size: 1}})
    mocks.setManifest(JSON.stringify({changed: ['docs/solutions/best-practices/ok.md', rejected], deleted: []}))

    await expect(applyDrafted(mocks)).rejects.toThrow(/backslash/)
    expect(Object.keys(mocks.written)).toStrictEqual([])
    expect(mocks.removed).toStrictEqual([])
  })

  it.each(wikiPaths)('apply rejects %s under the wiki policy with nothing written', async (rejected: string) => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/ok.md`]: {size: 1}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/ok.md'], deleted: [rejected]}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        mkdirImpl: mocks.mkdirImpl,
        readdirImpl: mocks.readdirImpl,
        lstatImpl: mocks.lstatImpl,
        readFileImpl: mocks.readFileImpl,
        writeFileImpl: mocks.writeFileImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/backslash/)
    expect(Object.keys(mocks.written)).toStrictEqual([])
    expect(mocks.removed).toStrictEqual([])
  })

  it('the status-based wiki build treats a backslash path as out of scope and copies nothing', async () => {
    const copyFileImpl = vi.fn(async () => undefined)

    await expect(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords(String.raw`?? knowledge\wiki\repos\x.md`),
        copyFileImpl,
        mkdirImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow('out-of-scope paths')
    expect(copyFileImpl).not.toHaveBeenCalled()
  })
})

function rawEntry(status: string, newMode: string, sha: string, relativePath: string): string {
  return `:100644 ${newMode} ${'0'.repeat(40)} ${sha} ${status}\0${relativePath}\0`
}

function recordingRunner(diffOutput: string, blobs: Record<string, string> = {}) {
  const calls: string[][] = []
  const runGit: GitRunner = async args => {
    calls.push([...args])
    if (args[0] === 'diff') return Buffer.from(diffOutput)
    if (args[0] === 'cat-file') return Buffer.from(blobs[args[2] ?? ''] ?? '')
    return Buffer.alloc(0)
  }
  return {runGit, calls}
}

function writers() {
  const written: Record<string, string> = {}
  return {
    written,
    mkdirImpl: vi.fn(async () => undefined) as unknown as typeof fs.mkdir,
    writeFileImpl: vi.fn(async (target: unknown, data: unknown) => {
      written[String(target)] = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
    }) as unknown as typeof fs.writeFile,
  }
}

describe('buildHandoffFromGitIndex (policy-taking, git-object based)', () => {
  const SHA_A = 'a'.repeat(40)

  it('stages with an argv array, lists staged changes against HEAD, and reads each blob by SHA', async () => {
    const {runGit, calls} = recordingRunner(rawEntry('A', '100644', SHA_A, 'knowledge/wiki/repos/new.md'), {
      [SHA_A]: 'blob content',
    })
    const io = writers()

    const result = await buildHandoffFromGitIndex({
      cwd: `${T}/repo`,
      outDir: `${T}/out`,
      pathspec: 'knowledge',
      policy: wikiHandoffPolicy(),
      runGit,
      ...io,
    })

    expect(result).toStrictEqual({changed: ['knowledge/wiki/repos/new.md'], deleted: []})
    expect(calls).toStrictEqual([
      ['add', '-A', '--', 'knowledge'],
      ['diff', '--cached', '--raw', '-z', '--no-renames', '--no-abbrev', '--', 'knowledge'],
      ['cat-file', 'blob', SHA_A],
    ])
    expect(io.written[`${T}/out/files/knowledge/wiki/repos/new.md`]).toBe('blob content')
  })

  it('under a policy that allows deletions, reports them in the manifest', async () => {
    const {runGit} = recordingRunner(`:100644 000000 ${SHA_A} ${'0'.repeat(40)} D\0knowledge/log.md\0`)
    const io = writers()

    const result = await buildHandoffFromGitIndex({
      cwd: `${T}/repo`,
      outDir: `${T}/out`,
      pathspec: 'knowledge',
      policy: wikiHandoffPolicy(),
      runGit,
      ...io,
    })

    expect(result).toStrictEqual({changed: [], deleted: ['knowledge/log.md']})
  })

  it.each([
    ['a symlink (120000)', rawEntry('A', '120000', SHA_A, 'docs/solutions/best-practices/x.md'), /120000/],
    ['a gitlink (160000)', rawEntry('A', '160000', SHA_A, 'docs/solutions/best-practices/x.md'), /160000/],
    ['an executable (100755)', rawEntry('A', '100755', SHA_A, 'docs/solutions/best-practices/x.md'), /100755/],
    ['a type change', rawEntry('T', '120000', SHA_A, 'docs/solutions/best-practices/x.md'), /120000/],
    ['a deletion', `:100644 000000 ${SHA_A} ${'0'.repeat(40)} D\0docs/solutions/best-practices/x.md\0`, /deletions/],
    ['an out-of-policy path', rawEntry('A', '100644', SHA_A, 'docs/plans/x.md'), /outside the allowed/],
    ['a backslash path', rawEntry('A', '100644', SHA_A, String.raw`docs/solutions/best-practices\x.md`), /backslash/],
    ['a malformed record', ':100644 100644 nonsense\0docs/solutions/best-practices/x.md\0', /unexpected/],
  ])('rejects %s before writing anything', async (_label: string, diffOutput: string, pattern: RegExp) => {
    const {runGit} = recordingRunner(diffOutput)
    const io = writers()

    await expect(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...io,
      }),
    ).rejects.toThrow(pattern)
    expect(io.mkdirImpl).not.toHaveBeenCalled()
    expect(io.writeFileImpl).not.toHaveBeenCalled()
  })

  it('wraps a failing git command in a validation error that names the command', async () => {
    const runGit: GitRunner = async () => {
      throw new Error('fatal: nope')
    }

    await expect(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...writers(),
      }),
    ).rejects.toThrow(/git add failed/)
  })
})

/** The value a promise rejects with; fails the test when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the promise to reject')
}

/** The value a function throws; fails the test when it returns. */
function thrownBy(fn: () => void): unknown {
  try {
    fn()
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the function to throw')
}

async function expectValidationFailure(promise: Promise<unknown>, message: string): Promise<void> {
  const error = await rejectionOf(promise)
  expect(error).toBeInstanceOf(WikiHandoffValidationError)
  expect((error as Error).message).toBe(message)
}

function expectSyncValidationFailure(fn: () => void, message: string): void {
  const error = thrownBy(fn)
  expect(error).toBeInstanceOf(WikiHandoffValidationError)
  expect((error as Error).message).toBe(message)
}

function callsOf(fn: unknown): unknown[][] {
  return (fn as {mock: {calls: unknown[][]}}).mock.calls
}

const probePolicy: HandoffPolicy = {
  name: 'probe',
  isAllowedPath: () => true,
  allowDeletions: true,
  maxTotalBytes: 1,
}

function buildSeams() {
  return {
    mkdirImpl: vi.fn(async () => undefined),
    copyFileImpl: vi.fn(async () => undefined),
    writeFileImpl: vi.fn(async () => undefined),
    lstatImpl: vi.fn(async () => ({isSymbolicLink: () => false, isFile: () => true})) as unknown as typeof fs.lstat,
  }
}

async function scopeBaseline(params: {
  status: string
  baselineFiles: Record<string, string>
  currentContents: Record<string, string>
  existingPaths: string[]
}) {
  const mocks = makeBaselineMocks({
    baselineFiles: params.baselineFiles,
    currentContents: params.currentContents,
    existingPaths: new Set(params.existingPaths),
  })
  const result = await buildWikiHandoff({
    cwd: `${T}/repo`,
    outDir: `${T}/tmp/handoff`,
    baselinePath: `${T}/baseline.json`,
    runGitStatus: async () => params.status,
    readFileImpl: mocks.readFileImpl,
    existsImpl: mocks.existsImpl,
    hashImpl: mocks.hashImpl,
    mkdirImpl: vi.fn(async () => undefined),
    copyFileImpl: vi.fn(async () => undefined),
    writeFileImpl: vi.fn(async () => undefined),
  })
  return {result, mocks}
}

function sourceIoFor(lstatImpl: typeof fs.lstat) {
  return {
    lstatImpl,
    mkdirImpl: vi.fn(async () => undefined),
    copyFileImpl: vi.fn(async () => undefined),
    writeFileImpl: vi.fn(async () => undefined),
  }
}

describe('WikiHandoffValidationError', () => {
  it('carries its own name so a caller can tell a rejected artifact from an IO failure', () => {
    const error = new WikiHandoffValidationError('nope')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('WikiHandoffValidationError')
    expect(error.message).toBe('nope')
  })
})

describe('handoff policies and caps', () => {
  it('caps a wiki delta at 5 MiB and a drafted-solutions delta at 1 MiB', () => {
    expect(wikiHandoffMaxTotalBytes()).toBe(5_242_880)
    expect(draftedSolutionsHandoffMaxTotalBytes()).toBe(1_048_576)
  })

  it('the wiki policy allows deletions, applies everything but the shared files and uses the wiki allowlist', () => {
    const policy = wikiHandoffPolicy()

    expect(policy.name).toBe('wiki')
    expect(policy.allowDeletions).toBe(true)
    expect(policy.maxTotalBytes).toBe(5_242_880)
    expect(policy.isAllowedPath).toBe(isAllowedWikiHandoffPath)
    expect(policy.isUnappliedPath?.('knowledge/log.md')).toBe(true)
    expect(policy.isUnappliedPath?.('knowledge/index.md')).toBe(true)
    expect(policy.isUnappliedPath?.('knowledge/wiki/repos/a.md')).toBe(false)
  })

  it('the drafted-solutions policy refuses deletions, applies everything and uses the drafted allowlist', () => {
    const policy = draftedSolutionsHandoffPolicy()

    expect(policy.name).toBe('drafted-solutions')
    expect(policy.allowDeletions).toBe(false)
    expect(policy.maxTotalBytes).toBe(1_048_576)
    expect(policy.isAllowedPath).toBe(isAllowedDraftedSolutionPath)
    expect(policy.isUnappliedPath).toBeUndefined()
  })
})

describe('path predicates, edge cases', () => {
  it('isAllowedWikiHandoffPath judges a backslash path as its forward-slash form', () => {
    // Only the status-based wiki build and the baseline use this predicate; assertSafeHandoffPath rejects
    // the backslash itself before any policy predicate runs.
    expect(isAllowedWikiHandoffPath(String.raw`knowledge\wiki\repos\x.md`)).toBe(true)
    expect(isAllowedWikiHandoffPath(String.raw`knowledge\index.md`)).toBe(true)
    expect(isAllowedWikiHandoffPath(String.raw`knowledge\wiki\repos\x.yaml`)).toBe(false)
  })

  it.each([
    ['docs/solutions/best-practices/x.md/extra', 'a segment after the file'],
    ['docs/solutions/best-practices/x.md/', 'a trailing slash after the file'],
    ['other/solutions/best-practices/x.md', 'the wrong root'],
    ['docs/other/best-practices/x.md', 'the wrong second segment'],
    ['docs/solutions/best-practices/xmd', 'a file without the .md extension'],
  ])('isAllowedDraftedSolutionPath rejects %s (%s)', (candidate: string) => {
    expect(isAllowedDraftedSolutionPath(candidate)).toBe(false)
  })

  it('isAllowedDraftedSolutionPath accepts the shortest .md file name', () => {
    expect(isAllowedDraftedSolutionPath('docs/solutions/best-practices/a.md')).toBe(true)
  })
})

describe('parseGitStatusPorcelainZ, edge records', () => {
  it('does not mistake a D, R or C inside a path for a status letter', () => {
    const output = nulRecords('?? knowledge/wiki/repos/CRD-Drafts.md', ' M knowledge/wiki/Rollout.md')

    expect(parseGitStatusPorcelainZ(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/CRD-Drafts.md', 'knowledge/wiki/Rollout.md'],
      deleted: [],
    })
  })

  it('reads a final record that has no trailing NUL', () => {
    expect(parseGitStatusPorcelainZ('?? knowledge/wiki/repos/a.md\0?? knowledge/wiki/repos/b.md')).toStrictEqual({
      changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'],
      deleted: [],
    })
  })

  it('keeps a record that follows an empty field', () => {
    expect(parseGitStatusPorcelainZ('?? knowledge/wiki/repos/a.md\0\0?? knowledge/wiki/repos/b.md')).toStrictEqual({
      changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'],
      deleted: [],
    })
  })

  it('records no deletion for a rename whose original-path field is missing', () => {
    expect(parseGitStatusPorcelainZ('R  knowledge/wiki/repos/new.md\0')).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: [],
    })
    expect(parseGitStatusPorcelainZ('R  knowledge/wiki/repos/new.md')).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: [],
    })
  })

  it('skips a record shorter than a status and a space', () => {
    expect(parseGitStatusPorcelainZ(nulRecords('ab', '?? knowledge/wiki/repos/a.md', 'x'))).toStrictEqual({
      changed: ['knowledge/wiki/repos/a.md'],
      deleted: [],
    })
  })

  it('keeps a three-character record as a change with an empty path, which the build then refuses', async () => {
    expect(parseGitStatusPorcelainZ(' M \0')).toStrictEqual({changed: [''], deleted: []})

    const copyFileImpl = vi.fn(async () => undefined)
    const error = await rejectionOf(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => ' M \0',
        copyFileImpl,
        mkdirImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      }),
    )

    expect((error as Error).message).toBe('wiki-handoff-build: git status reported out-of-scope paths: ')
    expect(copyFileImpl).not.toHaveBeenCalled()
  })
})

describe('captureWikiBaseline, write shape', () => {
  it('writes the baseline as two-space JSON with a trailing newline, as utf8', async () => {
    const writeFileImpl = vi.fn(async () => undefined)

    await captureWikiBaseline({
      cwd: `${T}/repo`,
      baselinePath: `${T}/baseline.json`,
      runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/a.md', ' D knowledge/log.md'),
      readFileImpl: vi.fn(async () => Buffer.from('content-a')) as unknown as typeof fs.readFile,
      writeFileImpl,
      hashImpl: (contents: Buffer) => `hash:${contents.toString('utf8')}`,
    })

    expect(callsOf(writeFileImpl)).toStrictEqual([
      [
        `${T}/baseline.json`,
        '{\n  "files": {\n    "knowledge/wiki/repos/a.md": "hash:content-a"\n  },\n  "deleted": [\n    "knowledge/log.md"\n  ]\n}\n',
        'utf8',
      ],
    ])
  })
})

describe('buildWikiHandoff, artifact writes', () => {
  it('creates files/ and each destination directory recursively, copies each source and writes the exact manifest', async () => {
    const io = buildSeams()

    await buildWikiHandoff({
      cwd: `${T}/repo`,
      outDir: `${T}/tmp/handoff`,
      runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/a.md', ' D knowledge/log.md'),
      ...io,
    })

    expect(callsOf(io.mkdirImpl)).toStrictEqual([
      [`${T}/tmp/handoff/files`, {recursive: true}],
      [`${T}/tmp/handoff/files/knowledge/wiki/repos`, {recursive: true}],
    ])
    expect(callsOf(io.copyFileImpl)).toStrictEqual([
      [`${T}/repo/knowledge/wiki/repos/a.md`, `${T}/tmp/handoff/files/knowledge/wiki/repos/a.md`],
    ])
    expect(callsOf(io.writeFileImpl)).toStrictEqual([
      [
        `${T}/tmp/handoff/manifest.json`,
        '{\n  "changed": [\n    "knowledge/wiki/repos/a.md"\n  ],\n  "deleted": [\n    "knowledge/log.md"\n  ]\n}\n',
        'utf8',
      ],
    ])
  })

  it('names every out-of-scope path, changed ones first, in the refusal', async () => {
    const io = buildSeams()

    const error = await rejectionOf(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords(' D scripts/b.ts', '?? metadata/a.yaml', '?? knowledge/wiki/repos/ok.md'),
        ...io,
      }),
    )

    expect((error as Error).message).toBe(
      'wiki-handoff-build: git status reported out-of-scope paths: metadata/a.yaml, scripts/b.ts',
    )
    expect(callsOf(io.mkdirImpl)).toStrictEqual([])
    expect(callsOf(io.copyFileImpl)).toStrictEqual([])
    expect(callsOf(io.writeFileImpl)).toStrictEqual([])
  })

  it('uses the supplied scope check instead of the wiki allowlist', async () => {
    const io = buildSeams()

    const result = await buildWikiHandoff({
      cwd: `${T}/repo`,
      outDir: `${T}/tmp/handoff`,
      runGitStatus: async () => nulRecords('?? docs/solutions/best-practices/a.md'),
      isAllowedPath: isAllowedDraftedSolutionPath,
      ...io,
    })

    expect(result).toStrictEqual({changed: ['docs/solutions/best-practices/a.md'], deleted: []})
  })
})

describe('buildWikiHandoff, baseline scoping decisions', () => {
  it('reads the baseline file as utf8 text', async () => {
    const {mocks} = await scopeBaseline({status: '', baselineFiles: {}, currentContents: {}, existingPaths: []})

    expect(mocks.readFileImpl).toHaveBeenCalledWith(`${T}/baseline.json`, 'utf8')
  })

  it('keeps a baseline page that is still on disk and unreported out of the deletions', async () => {
    const {result, mocks} = await scopeBaseline({
      status: '',
      baselineFiles: {'knowledge/wiki/repos/kept.md': 'same'},
      currentContents: {},
      existingPaths: ['knowledge/wiki/repos/kept.md'],
    })

    expect(result).toStrictEqual({changed: [], deleted: []})
    expect(callsOf(mocks.existsImpl)).toStrictEqual([[`${T}/repo/knowledge/wiki/repos/kept.md`]])
  })

  it('probes the disk only for baseline pages that git status did not report', async () => {
    const {result, mocks} = await scopeBaseline({
      status: nulRecords('?? knowledge/wiki/repos/edited.md', ' D knowledge/wiki/repos/gone.md'),
      baselineFiles: {
        'knowledge/wiki/repos/edited.md': 'old',
        'knowledge/wiki/repos/gone.md': 'old',
        'knowledge/wiki/repos/quiet.md': 'old',
      },
      currentContents: {'knowledge/wiki/repos/edited.md': 'new'},
      existingPaths: ['knowledge/wiki/repos/quiet.md'],
    })

    expect(result).toStrictEqual({
      changed: ['knowledge/wiki/repos/edited.md'],
      deleted: ['knowledge/wiki/repos/gone.md'],
    })
    expect(callsOf(mocks.existsImpl)).toStrictEqual([[`${T}/repo/knowledge/wiki/repos/quiet.md`]])
  })

  it('reports a baseline page that vanished without a status entry as deleted, once', async () => {
    const {result} = await scopeBaseline({
      status: '',
      baselineFiles: {'knowledge/wiki/repos/vanished.md': 'old'},
      currentContents: {},
      existingPaths: [],
    })

    expect(result).toStrictEqual({changed: [], deleted: ['knowledge/wiki/repos/vanished.md']})
  })
})

describe('buildWikiHandoff, malformed baselines', () => {
  it.each([
    ['null', 'null'],
    ['a number', '5'],
    ['a string', '"files"'],
    ['an object with no files', '{"deleted":[]}'],
    ['files that is a string', '{"files":"x","deleted":[]}'],
    ['files that is null', '{"files":null,"deleted":[]}'],
    ['an object with no deleted', '{"files":{}}'],
    ['deleted that is a string', '{"files":{},"deleted":"x"}'],
    ['deleted holding a non-string', '{"files":{},"deleted":["a.md",1]}'],
  ])('refuses a baseline that is %s before writing anything', async (_label: string, body: string) => {
    const io = {
      mkdirImpl: vi.fn(async () => undefined),
      copyFileImpl: vi.fn(async () => undefined),
      writeFileImpl: vi.fn(async () => undefined),
    }

    const error = await rejectionOf(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        baselinePath: `${T}/baseline.json`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/a.md'),
        readFileImpl: vi.fn(async () => body) as unknown as typeof fs.readFile,
        ...io,
      }),
    )

    expect((error as Error).message).toBe(`wiki-handoff-build: baseline at ${T}/baseline.json has unexpected shape`)
    expect(callsOf(io.mkdirImpl)).toStrictEqual([])
    expect(callsOf(io.copyFileImpl)).toStrictEqual([])
    expect(callsOf(io.writeFileImpl)).toStrictEqual([])
  })
})

describe('buildWikiHandoff, source checks', () => {
  it('names the symlinked source in the refusal', async () => {
    const io = sourceIoFor(
      vi.fn(async () => ({isSymbolicLink: () => true, isFile: () => false})) as unknown as typeof fs.lstat,
    )

    await expectValidationFailure(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/leak.md'),
        ...io,
      }),
      'wiki-handoff-build: refusing symlink source: knowledge/wiki/repos/leak.md',
    )
  })

  it('names the non-regular source in the refusal', async () => {
    const io = sourceIoFor(
      vi.fn(async () => ({isSymbolicLink: () => false, isFile: () => false})) as unknown as typeof fs.lstat,
    )

    await expectValidationFailure(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/dir.md'),
        ...io,
      }),
      'wiki-handoff-build: source is not a regular file: knowledge/wiki/repos/dir.md',
    )
    expect(callsOf(io.copyFileImpl)).toStrictEqual([])
  })

  it('lets a missing source through to the copy, which then fails loudly', async () => {
    const io = sourceIoFor(
      vi.fn(async () => {
        throw Object.assign(new Error('ENOENT: no such file'), {code: 'ENOENT'})
      }),
    )

    const result = await buildWikiHandoff({
      cwd: `${T}/repo`,
      outDir: `${T}/tmp/handoff`,
      runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/ok.md'),
      ...io,
    })

    expect(result.changed).toStrictEqual(['knowledge/wiki/repos/ok.md'])
    expect(callsOf(io.copyFileImpl)).toHaveLength(1)
  })

  it('rethrows an lstat failure that is not ENOENT, unchanged', async () => {
    const failure = Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'})
    const io = sourceIoFor(
      vi.fn(async () => {
        throw failure
      }),
    )

    const error = await rejectionOf(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/ok.md'),
        ...io,
      }),
    )

    expect(error).toBe(failure)
    expect(callsOf(io.copyFileImpl)).toStrictEqual([])
  })

  it('rethrows a null rejection from lstat as null', async () => {
    const io = sourceIoFor(
      vi.fn(async () => {
        // eslint-disable-next-line no-throw-literal
        throw null
      }),
    )

    const error = await rejectionOf(
      buildWikiHandoff({
        cwd: `${T}/repo`,
        outDir: `${T}/tmp/handoff`,
        runGitStatus: async () => nulRecords('?? knowledge/wiki/repos/ok.md'),
        ...io,
      }),
    )

    expect(error).toBeNull()
  })
})

describe('assertSafeHandoffPath, decisions and messages', () => {
  it('names the policy in the empty-path refusal', () => {
    expectSyncValidationFailure(() => assertSafeHandoffPath('', probePolicy), 'probe handoff path is empty')
  })

  it.each([
    [String.raw`a\b`, 'a backslash'],
    [String.raw`a\..\b`, 'a backslash traversal'],
    [String.raw`C:\temp\x`, 'a Windows drive path'],
  ])('refuses %s (%s) even when the policy would allow it', (candidate: string) => {
    expectSyncValidationFailure(
      () => assertSafeHandoffPath(candidate, probePolicy),
      `probe handoff path contains a backslash: ${candidate}`,
    )
  })

  it.each(['/etc/passwd', '/', '/knowledge/wiki/repos/a.md'])('refuses the absolute path %s', (candidate: string) => {
    expectSyncValidationFailure(
      () => assertSafeHandoffPath(candidate, probePolicy),
      `probe handoff path must be relative: ${candidate}`,
    )
  })

  it.each([
    ['a/../b', 'a parent segment'],
    ['../a', 'a leading parent segment'],
    ['a/..', 'a trailing parent segment'],
    ['a/./b', 'a current-directory segment'],
    ['./a', 'a leading current-directory segment'],
    ['a//b', 'an empty segment'],
    ['a/b/', 'a trailing slash'],
  ])('refuses %s (%s) even when the policy would allow it', (candidate: string) => {
    expectSyncValidationFailure(
      () => assertSafeHandoffPath(candidate, probePolicy),
      `probe handoff path contains traversal or empty segments: ${candidate}`,
    )
  })

  it('refuses a wiki-shaped path that climbs out of knowledge/wiki, which the wiki allowlist alone would accept', () => {
    const climbing = 'knowledge/wiki/../../metadata/repos.md'

    expect(isAllowedWikiHandoffPath(climbing)).toBe(true)
    expectSyncValidationFailure(
      () => assertSafeWikiHandoffPath(climbing),
      `wiki handoff path contains traversal or empty segments: ${climbing}`,
    )
  })

  it('accepts dotted names that are not traversal segments', () => {
    expect(() => assertSafeHandoffPath('a/..b/c.d/.hidden/e..f', probePolicy)).not.toThrow()
  })

  it('hands the policy predicate the path exactly as given and names the scope when it says no', () => {
    const isAllowedPath = vi.fn(() => false)
    const policy: HandoffPolicy = {...probePolicy, isAllowedPath}

    expectSyncValidationFailure(
      () => assertSafeHandoffPath('x/y.md', policy),
      'probe handoff path is outside the allowed probe scope: x/y.md',
    )
    expect(callsOf(isAllowedPath)).toStrictEqual([['x/y.md']])
  })

  it('does not consult the policy predicate for a path that already failed a structural check', () => {
    const isAllowedPath = vi.fn(() => true)
    const policy: HandoffPolicy = {...probePolicy, isAllowedPath}

    for (const candidate of ['', String.raw`a\b`, '/a', 'a/../b']) {
      expect(() => assertSafeHandoffPath(candidate, policy)).toThrow(WikiHandoffValidationError)
    }
    expect(callsOf(isAllowedPath)).toStrictEqual([])
  })
})

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const ZEROS = '0'.repeat(40)

function optionRecordingRunner(diffOutput: string, blobs: Record<string, string> = {}) {
  const calls: {args: string[]; options: {maxBuffer: number}}[] = []
  const runGit: GitRunner = async (args, options) => {
    calls.push({args: [...args], options})
    if (args[0] === 'diff') return Buffer.from(diffOutput)
    if (args[0] === 'cat-file') return Buffer.from(blobs[args[2] ?? ''] ?? '')
    return Buffer.alloc(0)
  }
  return {runGit, calls}
}

describe('buildHandoffFromGitIndex, git invocations and writes', () => {
  it('bounds each git call by what the policy still allows, one byte over so an overflow is detectable', async () => {
    const policy: HandoffPolicy = {...draftedSolutionsHandoffPolicy(), maxTotalBytes: 100}
    const {runGit, calls} = optionRecordingRunner(
      rawEntry('A', '100644', SHA_A, 'docs/solutions/best-practices/a.md') +
        rawEntry('M', '100644', SHA_B, 'docs/solutions/best-practices/b.md'),
      {[SHA_A]: 'abc', [SHA_B]: 'defg'},
    )

    await buildHandoffFromGitIndex({
      cwd: `${T}/repo`,
      outDir: `${T}/out`,
      pathspec: 'docs/solutions',
      policy,
      runGit,
      ...writers(),
    })

    expect(calls.map(call => call.options)).toStrictEqual([
      {maxBuffer: 100},
      {maxBuffer: 100},
      {maxBuffer: 101},
      {maxBuffer: 98},
    ])
  })

  it('creates every directory recursively and writes blob bytes without an encoding, then the exact manifest', async () => {
    const {runGit} = optionRecordingRunner(
      `${
        rawEntry('A', '100644', SHA_A, 'knowledge/wiki/repos/new.md') +
        rawEntry('M', '100644', SHA_B, 'knowledge/index.md')
      }:100644 000000 ${SHA_A} ${ZEROS} D\0knowledge/log.md\0`,
      {[SHA_A]: 'new page', [SHA_B]: 'index body'},
    )
    const mkdirImpl = vi.fn(async () => undefined)
    const writeFileImpl = vi.fn(async () => undefined)

    const result = await buildHandoffFromGitIndex({
      cwd: `${T}/repo`,
      outDir: `${T}/out`,
      pathspec: 'knowledge',
      policy: wikiHandoffPolicy(),
      runGit,
      mkdirImpl,
      writeFileImpl,
    })

    expect(result).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md', 'knowledge/index.md'],
      deleted: ['knowledge/log.md'],
    })
    expect(callsOf(mkdirImpl)).toStrictEqual([
      [`${T}/out/files`, {recursive: true}],
      [`${T}/out/files/knowledge/wiki/repos`, {recursive: true}],
      [`${T}/out/files/knowledge`, {recursive: true}],
    ])
    expect(callsOf(writeFileImpl)).toStrictEqual([
      [`${T}/out/files/knowledge/wiki/repos/new.md`, Buffer.from('new page')],
      [`${T}/out/files/knowledge/index.md`, Buffer.from('index body')],
      [
        `${T}/out/manifest.json`,
        '{\n  "changed": [\n    "knowledge/wiki/repos/new.md",\n    "knowledge/index.md"\n  ],\n  "deleted": [\n    "knowledge/log.md"\n  ]\n}\n',
        'utf8',
      ],
    ])
  })

  it.each(['A', 'M', 'T'])('accepts status %s for a regular file', async (status: string) => {
    const {runGit} = optionRecordingRunner(rawEntry(status, '100644', SHA_A, 'docs/solutions/best-practices/x.md'), {
      [SHA_A]: 'body',
    })

    await expect(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...writers(),
      }),
    ).resolves.toStrictEqual({changed: ['docs/solutions/best-practices/x.md'], deleted: []})
  })

  it('accepts a type change whose new mode is a regular file, judging the new mode and not the old one', async () => {
    const {runGit} = optionRecordingRunner(`:120000 100644 ${ZEROS} ${SHA_A} T\0docs/solutions/best-practices/x.md\0`, {
      [SHA_A]: 'body',
    })

    await expect(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...writers(),
      }),
    ).resolves.toStrictEqual({changed: ['docs/solutions/best-practices/x.md'], deleted: []})
  })

  it.each(['R', 'C', 'U', 'X', 'B'])('refuses status %s and names it with the path', async (status: string) => {
    const {runGit} = optionRecordingRunner(rawEntry(status, '100644', SHA_A, 'docs/solutions/best-practices/x.md'))
    const io = writers()

    await expectValidationFailure(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...io,
      }),
      `wiki-handoff-build: unexpected change status ${status} for docs/solutions/best-practices/x.md`,
    )
    expect(io.writeFileImpl).not.toHaveBeenCalled()
  })

  it('names the mode and path when a file is not a regular file', async () => {
    const {runGit} = optionRecordingRunner(rawEntry('A', '100755', SHA_A, 'docs/solutions/best-practices/x.md'))

    await expectValidationFailure(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...writers(),
      }),
      'wiki-handoff-build: docs/solutions/best-practices/x.md has mode 100755; only regular files (100644) are allowed',
    )
  })

  it('names the policy and path when a deletion is not allowed', async () => {
    const {runGit} = optionRecordingRunner(`:100644 000000 ${SHA_A} ${ZEROS} D\0docs/solutions/best-practices/x.md\0`)

    await expectValidationFailure(
      buildHandoffFromGitIndex({
        cwd: `${T}/repo`,
        outDir: `${T}/out`,
        pathspec: 'docs/solutions',
        policy: draftedSolutionsHandoffPolicy(),
        runGit,
        ...writers(),
      }),
      'wiki-handoff-build: drafted-solutions handoff deletions are not allowed: docs/solutions/best-practices/x.md',
    )
  })
})

describe('buildHandoffFromGitIndex, size cap', () => {
  const smallPolicy: HandoffPolicy = {...draftedSolutionsHandoffPolicy(), maxTotalBytes: 10}
  const entries =
    rawEntry('A', '100644', SHA_A, 'docs/solutions/best-practices/a.md') +
    rawEntry('A', '100644', SHA_B, 'docs/solutions/best-practices/b.md')

  async function build(blobs: Record<string, string>, io = writers()) {
    const {runGit} = optionRecordingRunner(entries, blobs)
    return buildHandoffFromGitIndex({
      cwd: `${T}/repo`,
      outDir: `${T}/out`,
      pathspec: 'docs/solutions',
      policy: smallPolicy,
      runGit,
      ...io,
    })
  }

  it('accepts a running total exactly at the cap', async () => {
    await expect(build({[SHA_A]: '12345', [SHA_B]: '12345'})).resolves.toStrictEqual({
      changed: ['docs/solutions/best-practices/a.md', 'docs/solutions/best-practices/b.md'],
      deleted: [],
    })
  })

  it('refuses a running total one byte over the cap and writes nothing', async () => {
    const io = writers()

    await expectValidationFailure(
      build({[SHA_A]: '12345', [SHA_B]: '123456'}, io),
      'drafted-solutions handoff exceeds the 10-byte size cap (running total 11)',
    )
    expect(io.mkdirImpl).not.toHaveBeenCalled()
    expect(io.writeFileImpl).not.toHaveBeenCalled()
  })

  it('adds blob sizes together across files', async () => {
    await expectValidationFailure(
      build({[SHA_A]: '123456', [SHA_B]: '123456'}),
      'drafted-solutions handoff exceeds the 10-byte size cap (running total 12)',
    )
  })
})

async function gitFailsWith(thrown: unknown, onlyFor?: string) {
  const runGit: GitRunner = async args => {
    if (onlyFor !== undefined && args[0] !== onlyFor) {
      if (args[0] === 'diff') return Buffer.from(rawEntry('A', '100644', SHA_A, 'docs/solutions/best-practices/x.md'))
      return Buffer.alloc(0)
    }

    throw thrown
  }
  return buildHandoffFromGitIndex({
    cwd: `${T}/repo`,
    outDir: `${T}/out`,
    pathspec: 'docs/solutions',
    policy: draftedSolutionsHandoffPolicy(),
    runGit,
    ...writers(),
  })
}

describe('buildHandoffFromGitIndex, git failures', () => {
  const overflow = () =>
    Object.assign(new Error('stdout maxBuffer length exceeded'), {code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'})

  it('reports a stdout overflow as a size-cap refusal naming the git subcommand', async () => {
    await expectValidationFailure(
      gitFailsWith(overflow()),
      'drafted-solutions handoff exceeds the 1048576-byte size cap (during git add)',
    )
    await expectValidationFailure(
      gitFailsWith(overflow(), 'cat-file'),
      'drafted-solutions handoff exceeds the 1048576-byte size cap (during git cat-file)',
    )
  })

  it('reports any other failure with the subcommand and the underlying message', async () => {
    await expectValidationFailure(
      gitFailsWith(Object.assign(new Error('fatal: nope'), {code: 'ENOENT'})),
      'wiki-handoff-build: git add failed: fatal: nope',
    )
    await expectValidationFailure(gitFailsWith('plain string'), 'wiki-handoff-build: git add failed: plain string')
    await expectValidationFailure(gitFailsWith(null), 'wiki-handoff-build: git add failed: null')
    await expectValidationFailure(gitFailsWith(undefined), 'wiki-handoff-build: git add failed: undefined')
  })
})

describe('buildHandoffFromGitIndex, raw diff records', () => {
  const unexpected = 'wiki-handoff-build: unexpected `git diff --cached --raw` output'

  async function buildFrom(diffOutput: string) {
    const {runGit} = optionRecordingRunner(diffOutput, {[SHA_A]: 'a', [SHA_B]: 'b'})
    return buildHandoffFromGitIndex({
      cwd: `${T}/repo`,
      outDir: `${T}/out`,
      pathspec: 'docs/solutions',
      policy: draftedSolutionsHandoffPolicy(),
      runGit,
      ...writers(),
    })
  }

  const meta = `:100644 100644 ${ZEROS} ${SHA_A} A`

  it('reads a final record that has no trailing NUL', async () => {
    await expect(buildFrom(`${meta}\0docs/solutions/best-practices/a.md`)).resolves.toStrictEqual({
      changed: ['docs/solutions/best-practices/a.md'],
      deleted: [],
    })
  })

  it('pairs each metadata field with the path field after it', async () => {
    await expect(
      buildFrom(
        `${meta}\0docs/solutions/best-practices/a.md\0:100644 100644 ${ZEROS} ${SHA_B} M\0docs/solutions/best-practices/b.md\0`,
      ),
    ).resolves.toStrictEqual({
      changed: ['docs/solutions/best-practices/a.md', 'docs/solutions/best-practices/b.md'],
      deleted: [],
    })
  })

  it('accepts a 64-character object id', async () => {
    const sha256 = 'c'.repeat(64)
    await expect(
      buildFrom(`:100644 100644 ${'0'.repeat(64)} ${sha256} A\0docs/solutions/best-practices/a.md\0`),
    ).resolves.toStrictEqual({changed: ['docs/solutions/best-practices/a.md'], deleted: []})
  })

  it.each([
    ['text before the colon', `x${meta}\0docs/solutions/best-practices/a.md\0`],
    ['text after the status', `${meta} extra\0docs/solutions/best-practices/a.md\0`],
    ['a metadata field with no path field', meta],
    ['a metadata field with an empty path field', `${meta}\0\0`],
    ['an odd field left over', `${meta}\0docs/solutions/best-practices/a.md\0stray\0`],
    ['an object id one hex digit short', `:100644 100644 ${'0'.repeat(39)} ${'a'.repeat(39)} A\0docs/x.md\0`],
    ['an object id that is not lowercase hex', `:100644 100644 ${ZEROS} ${'A'.repeat(40)} A\0docs/x.md\0`],
    ['a mode that is not six digits', `:10064 100644 ${ZEROS} ${SHA_A} A\0docs/x.md\0`],
    ['a lowercase status', `:100644 100644 ${ZEROS} ${SHA_A} a\0docs/x.md\0`],
    ['a two-letter status', `:100644 100644 ${ZEROS} ${SHA_A} AM\0docs/x.md\0`],
  ])('refuses a record with %s', async (_label: string, diffOutput: string) => {
    await expectValidationFailure(buildFrom(diffOutput), unexpected)
  })
})

async function applyHandoff(mocks: ReturnType<typeof makeFsMocks>, policy: HandoffPolicy = wikiHandoffPolicy()) {
  return validateAndApplyHandoff({
    policy,
    handoffDir: `${T}/handoff`,
    workspaceDir: `${T}/workspace`,
    mkdirImpl: mocks.mkdirImpl,
    readdirImpl: mocks.readdirImpl,
    lstatImpl: mocks.lstatImpl,
    readFileImpl: mocks.readFileImpl,
    writeFileImpl: mocks.writeFileImpl,
    rmImpl: mocks.rmImpl,
  })
}

describe('validateAndApplyHandoff, artifact shape', () => {
  it.each([['manifest.json'], ['files'], ['manifest.json', 'files'], ['files', 'manifest.json']])(
    'accepts a top level of exactly %s',
    async (...entries: string[]) => {
      const mocks = makeFsMocks({}, entries)

      await expect(applyHandoff(mocks)).resolves.toStrictEqual({applied: [], deleted: [], skipped: []})
    },
  )

  it('lists every unexpected top-level entry, in directory order, and reads nothing', async () => {
    const mocks = makeFsMocks({}, ['manifest.json', 'metadata.json', 'files', '.git', 'files.bak'])

    await expectValidationFailure(
      applyHandoff(mocks),
      'wiki handoff artifact contains unexpected top-level entries: metadata.json, .git, files.bak',
    )
    expect(callsOf(mocks.readFileImpl)).toStrictEqual([])
  })

  it('names the policy in the unexpected-entries refusal', async () => {
    const mocks = makeFsMocks({}, ['manifest.json', 'files', 'extra'])

    await expectValidationFailure(
      applyHandoff(mocks, draftedSolutionsHandoffPolicy()),
      'drafted-solutions handoff artifact contains unexpected top-level entries: extra',
    )
  })

  it('reads the manifest from <handoffDir>/manifest.json as utf8', async () => {
    const mocks = makeFsMocks({})

    await applyHandoff(mocks)

    expect(callsOf(mocks.readFileImpl)).toStrictEqual([[`${T}/handoff/manifest.json`, 'utf8']])
    expect(callsOf(mocks.readdirImpl)).toStrictEqual([[`${T}/handoff`]])
  })

  it('reports an unreadable manifest with its path and the underlying message', async () => {
    const mocks = makeFsMocks({})
    const failing = vi.fn(async () => {
      throw new Error('EACCES: permission denied')
    }) as unknown as typeof fs.readFile

    await expectValidationFailure(
      validateAndApplyHandoff({
        policy: wikiHandoffPolicy(),
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: failing,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
      `failed to read ${T}/handoff/manifest.json: EACCES: permission denied`,
    )
  })

  it('reports a non-Error read failure as its string form', async () => {
    const mocks = makeFsMocks({})
    const failing = vi.fn(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'disk on fire'
    }) as unknown as typeof fs.readFile

    await expectValidationFailure(
      validateAndApplyHandoff({
        policy: wikiHandoffPolicy(),
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        readdirImpl: mocks.readdirImpl,
        readFileImpl: failing,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
      `failed to read ${T}/handoff/manifest.json: disk on fire`,
    )
  })

  it.each([
    ['null', 'null', 'manifest.json must be a JSON object'],
    ['a number', '5', 'manifest.json must be a JSON object'],
    ['a string', '"changed"', 'manifest.json must be a JSON object'],
    ['an array', '[]', 'manifest.json "changed" must be a string array'],
    ['no changed list', '{"deleted":[]}', 'manifest.json "changed" must be a string array'],
    ['changed that is a string', '{"changed":"a.md","deleted":[]}', 'manifest.json "changed" must be a string array'],
    [
      'changed holding a non-string',
      '{"changed":["a.md",1],"deleted":[]}',
      'manifest.json "changed" must be a string array',
    ],
    ['no deleted list', '{"changed":[]}', 'manifest.json "deleted" must be a string array'],
    ['deleted that is a string', '{"changed":[],"deleted":"a.md"}', 'manifest.json "deleted" must be a string array'],
    [
      'deleted holding a non-string',
      '{"changed":[],"deleted":[null]}',
      'manifest.json "deleted" must be a string array',
    ],
    ['both lists wrong', '{"changed":1,"deleted":1}', 'manifest.json "changed" must be a string array'],
  ])('refuses a manifest that is %s', async (_label: string, body: string, message: string) => {
    const mocks = makeFsMocks({})
    mocks.setManifest(body)

    await expectValidationFailure(applyHandoff(mocks), message)
    expect(callsOf(mocks.writeFileImpl)).toStrictEqual([])
    expect(callsOf(mocks.rmImpl)).toStrictEqual([])
  })

  it('lists every deletion in the drafted-solutions refusal, before looking at any path', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(JSON.stringify({changed: [], deleted: ['docs/solutions/best-practices/a.md', 'not-even-a-path']}))

    await expectValidationFailure(
      applyHandoff(mocks, draftedSolutionsHandoffPolicy()),
      'drafted-solutions handoff does not allow deletions: docs/solutions/best-practices/a.md, not-even-a-path',
    )
  })
})

describe('validateAndApplyHandoff, validation before writing', () => {
  it('checks traversal in deleted paths as well as changed ones', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(JSON.stringify({changed: [], deleted: ['knowledge/wiki/../../metadata/repos.md']}))

    await expectValidationFailure(
      applyHandoff(mocks),
      'wiki handoff path contains traversal or empty segments: knowledge/wiki/../../metadata/repos.md',
    )
    expect(callsOf(mocks.rmImpl)).toStrictEqual([])
  })

  it('names the symlinked entry', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/link.md`]: {size: 1, symlink: true}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/link.md'], deleted: []}))

    await expectValidationFailure(applyHandoff(mocks), 'refusing symlink in wiki handoff: knowledge/wiki/repos/link.md')
  })

  it('names the entry that is not a regular file and writes nothing', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/ok.md`]: {size: 1},
      [`${T}/handoff/files/knowledge/wiki/repos/dir.md`]: {size: 0, isDir: true},
    })
    mocks.setManifest(
      JSON.stringify({changed: ['knowledge/wiki/repos/ok.md', 'knowledge/wiki/repos/dir.md'], deleted: []}),
    )

    await expectValidationFailure(
      applyHandoff(mocks),
      'wiki handoff entry is not a regular file: knowledge/wiki/repos/dir.md',
    )
    expect(callsOf(mocks.writeFileImpl)).toStrictEqual([])
    expect(callsOf(mocks.mkdirImpl)).toStrictEqual([])
  })

  it('inspects only the changed entries, in manifest order, under <handoffDir>/files', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/a.md`]: {size: 1},
      [`${T}/handoff/files/knowledge/wiki/repos/b.md`]: {size: 1},
    })
    mocks.setManifest(
      JSON.stringify({
        changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'],
        deleted: ['knowledge/wiki/repos/c.md'],
      }),
    )

    await applyHandoff(mocks)

    expect(callsOf(mocks.lstatImpl)).toStrictEqual([
      [`${T}/handoff/files/knowledge/wiki/repos/a.md`],
      [`${T}/handoff/files/knowledge/wiki/repos/b.md`],
    ])
  })

  it('accepts a wiki bundle exactly at the cap and refuses one byte over it, summing across files', async () => {
    const half = wikiHandoffMaxTotalBytes() / 2
    const atCap = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/a.md`]: {size: half},
      [`${T}/handoff/files/knowledge/wiki/repos/b.md`]: {size: half},
    })
    atCap.setManifest(
      JSON.stringify({changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'], deleted: []}),
    )

    await expect(applyHandoff(atCap)).resolves.toMatchObject({
      applied: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'],
    })

    const overCap = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/a.md`]: {size: half},
      [`${T}/handoff/files/knowledge/wiki/repos/b.md`]: {size: half + 1},
    })
    overCap.setManifest(
      JSON.stringify({changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'], deleted: []}),
    )

    await expectValidationFailure(
      applyHandoff(overCap),
      'wiki handoff exceeds the 5242880-byte size cap (running total 5242881)',
    )
    expect(callsOf(overCap.writeFileImpl)).toStrictEqual([])
  })

  it('uses the size cap of the policy it is given', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/docs/solutions/best-practices/a.md`]: {size: 11}})
    mocks.setManifest(JSON.stringify({changed: ['docs/solutions/best-practices/a.md'], deleted: []}))

    await expectValidationFailure(
      applyHandoff(mocks, {...draftedSolutionsHandoffPolicy(), maxTotalBytes: 10}),
      'drafted-solutions handoff exceeds the 10-byte size cap (running total 11)',
    )
  })
})

describe('validateAndApplyHandoff, applying', () => {
  it('reads each source from <handoffDir>/files, makes the destination directory and writes the bytes', async () => {
    const mocks = makeFsMocks({[`${T}/handoff/files/knowledge/wiki/repos/a.md`]: {size: 7}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/a.md'], deleted: []}))

    await applyHandoff(mocks)

    expect(callsOf(mocks.readFileImpl)).toStrictEqual([
      [`${T}/handoff/manifest.json`, 'utf8'],
      [`${T}/handoff/files/knowledge/wiki/repos/a.md`],
    ])
    expect(callsOf(mocks.mkdirImpl)).toStrictEqual([[`${T}/workspace/knowledge/wiki/repos`, {recursive: true}]])
    expect(callsOf(mocks.writeFileImpl)).toStrictEqual([
      [`${T}/workspace/knowledge/wiki/repos/a.md`, Buffer.from('content')],
    ])
  })

  it('removes each deleted path with force so an already-missing file is not an error', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest(
      JSON.stringify({changed: [], deleted: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md']}),
    )

    const result = await applyHandoff(mocks)

    expect(callsOf(mocks.rmImpl)).toStrictEqual([
      [`${T}/workspace/knowledge/wiki/repos/a.md`, {force: true}],
      [`${T}/workspace/knowledge/wiki/repos/b.md`, {force: true}],
    ])
    expect(result.deleted).toStrictEqual(['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'])
  })

  it('applies every path when the policy has no unapplied predicate, and asks the predicate about each path otherwise', async () => {
    const isUnappliedPath = vi.fn((candidate: string) => candidate.endsWith('skip.md'))
    const policy: HandoffPolicy = {...probePolicy, maxTotalBytes: 100, isUnappliedPath}
    const mocks = makeFsMocks({
      [`${T}/handoff/files/keep.md`]: {size: 1},
      [`${T}/handoff/files/skip.md`]: {size: 1},
    })
    mocks.setManifest(JSON.stringify({changed: ['keep.md', 'skip.md'], deleted: ['gone.md', 'also-skip.md']}))

    const result = await applyHandoff(mocks, policy)

    expect(result).toStrictEqual({
      applied: ['keep.md'],
      deleted: ['gone.md'],
      skipped: ['skip.md', 'also-skip.md'],
    })
    expect(callsOf(isUnappliedPath)).toStrictEqual([['keep.md'], ['skip.md'], ['gone.md'], ['also-skip.md']])
    expect(callsOf(mocks.rmImpl)).toStrictEqual([[`${T}/workspace/gone.md`, {force: true}]])

    const unrestricted = makeFsMocks({[`${T}/handoff/files/skip.md`]: {size: 1}})
    unrestricted.setManifest(JSON.stringify({changed: ['skip.md'], deleted: ['also-skip.md']}))
    const withoutPredicate: HandoffPolicy = {
      name: policy.name,
      isAllowedPath: policy.isAllowedPath,
      allowDeletions: policy.allowDeletions,
      maxTotalBytes: policy.maxTotalBytes,
    }

    await expect(applyHandoff(unrestricted, withoutPredicate)).resolves.toStrictEqual({
      applied: ['skip.md'],
      deleted: ['also-skip.md'],
      skipped: [],
    })
  })

  it('stops at the first failing write: later changes and every deletion are left undone', async () => {
    const mocks = makeFsMocks({
      [`${T}/handoff/files/knowledge/wiki/repos/a.md`]: {size: 1},
      [`${T}/handoff/files/knowledge/wiki/repos/b.md`]: {size: 1},
    })
    mocks.setManifest(
      JSON.stringify({
        changed: ['knowledge/wiki/repos/a.md', 'knowledge/wiki/repos/b.md'],
        deleted: ['knowledge/wiki/repos/old.md'],
      }),
    )
    const failure = new Error('ENOSPC: no space left on device')
    const writeFileImpl = vi.fn(async (target: unknown) => {
      if (String(target).endsWith('b.md')) throw failure
    }) as unknown as typeof fs.writeFile

    const error = await rejectionOf(
      validateAndApplyHandoff({
        policy: wikiHandoffPolicy(),
        handoffDir: `${T}/handoff`,
        workspaceDir: `${T}/workspace`,
        mkdirImpl: mocks.mkdirImpl,
        readdirImpl: mocks.readdirImpl,
        lstatImpl: mocks.lstatImpl,
        readFileImpl: mocks.readFileImpl,
        writeFileImpl,
        rmImpl: mocks.rmImpl,
      }),
    )

    expect(error).toBe(failure)
    expect(callsOf(writeFileImpl)).toHaveLength(2)
    expect(callsOf(mocks.rmImpl)).toStrictEqual([])
  })
})
