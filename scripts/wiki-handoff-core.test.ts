import type {promises as fs} from 'node:fs'

import {Buffer} from 'node:buffer'

import {describe, expect, it, vi} from 'vitest'

import {
  assertSafeWikiHandoffPath,
  buildWikiHandoff,
  isAllowedWikiHandoffPath,
  parseGitStatusPorcelain,
  validateAndApplyWikiHandoff,
  WIKI_HANDOFF_MAX_TOTAL_BYTES,
  WikiHandoffValidationError,
} from './wiki-handoff-core.ts'

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

describe('parseGitStatusPorcelain', () => {
  it('classifies untracked and modified paths as changed', () => {
    const output = '?? knowledge/wiki/repos/new.md\n M knowledge/index.md\n'
    expect(parseGitStatusPorcelain(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md', 'knowledge/index.md'],
      deleted: [],
    })
  })

  it('classifies deleted paths', () => {
    const output = ' D knowledge/wiki/repos/gone.md\n'
    expect(parseGitStatusPorcelain(output)).toStrictEqual({
      changed: [],
      deleted: ['knowledge/wiki/repos/gone.md'],
    })
  })

  it('splits a rename into a deletion of the old path and a change of the new path', () => {
    const output = 'R  knowledge/wiki/repos/old.md -> knowledge/wiki/repos/new.md\n'
    expect(parseGitStatusPorcelain(output)).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: ['knowledge/wiki/repos/old.md'],
    })
  })

  it('ignores blank lines', () => {
    expect(parseGitStatusPorcelain('\n\n')).toStrictEqual({changed: [], deleted: []})
  })
})

describe('buildWikiHandoff', () => {
  it('writes manifest.json and metadata.json and copies changed files', async () => {
    const writes: Record<string, string> = {}
    const copies: [string, string][] = []
    const result = await buildWikiHandoff({
      cwd: '/repo',
      outDir: '/tmp/handoff',
      metadata: {WIKI_OPERATION: 'event', WIKI_TARGET: 'repo:fro-bot/.github'},
      runGitStatus: async () => '?? knowledge/wiki/repos/new.md\n D knowledge/log.md\n',
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
      ['/repo/knowledge/wiki/repos/new.md', '/tmp/handoff/files/knowledge/wiki/repos/new.md'],
    ])
    expect(JSON.parse(writes['/tmp/handoff/manifest.json'] ?? '')).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: ['knowledge/log.md'],
    })
    expect(JSON.parse(writes['/tmp/handoff/metadata.json'] ?? '')).toStrictEqual({
      WIKI_OPERATION: 'event',
      WIKI_TARGET: 'repo:fro-bot/.github',
    })
  })

  it('throws when git reports a path outside the wiki scope (defense in depth)', async () => {
    await expect(
      buildWikiHandoff({
        cwd: '/repo',
        outDir: '/tmp/handoff',
        metadata: {},
        runGitStatus: async () => '?? metadata/repos.yaml\n',
      }),
    ).rejects.toThrow('out-of-scope paths')
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

function makeFsMocks(files: Record<string, {size: number; symlink?: boolean; isDir?: boolean}>) {
  const written: Record<string, Buffer> = {}
  const removed: string[] = []
  let manifestJson = '{"changed":[],"deleted":[]}'

  const mkdirImpl = vi.fn(async () => undefined) as unknown as typeof fs.mkdir
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
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/foo.md': {size: 10}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: ['knowledge/log.md']}))

    const result = await validateAndApplyWikiHandoff({
      handoffDir: '/handoff',
      workspaceDir: '/workspace',
      mkdirImpl: mocks.mkdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result).toStrictEqual({applied: ['knowledge/wiki/repos/foo.md'], deleted: ['knowledge/log.md']})
    expect(Object.keys(mocks.written)).toStrictEqual(['/workspace/knowledge/wiki/repos/foo.md'])
    expect(mocks.removed).toStrictEqual(['/workspace/knowledge/log.md'])
  })

  it('handles an empty/unchanged manifest as a no-op', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest('{"changed":[],"deleted":[]}')

    const result = await validateAndApplyWikiHandoff({
      handoffDir: '/handoff',
      workspaceDir: '/workspace',
      mkdirImpl: mocks.mkdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result).toStrictEqual({applied: [], deleted: []})
  })

  it('rejects a manifest that is not valid JSON', async () => {
    const mocks = makeFsMocks({})
    mocks.setManifest('not json')

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(WikiHandoffValidationError)
  })

  it('rejects a symlink entry', async () => {
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/foo.md': {size: 1, symlink: true}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
      '/handoff/files/knowledge/wiki/repos/foo.md': {size: WIKI_HANDOFF_MAX_TOTAL_BYTES + 1},
    })
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
        readFileImpl: mocks.readFileImpl,
        lstatImpl: mocks.lstatImpl,
        writeFileImpl: mocks.writeFileImpl,
        mkdirImpl: mocks.mkdirImpl,
        rmImpl: mocks.rmImpl,
      }),
    ).rejects.toThrow(/size cap/)
  })

  it('writes nothing when validation fails partway through a multi-entry manifest', async () => {
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/ok.md': {size: 1}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/ok.md', 'metadata/repos.yaml'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
