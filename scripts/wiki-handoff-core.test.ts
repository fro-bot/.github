import type {promises as fs} from 'node:fs'

import {Buffer} from 'node:buffer'

import {describe, expect, it, vi} from 'vitest'

import {
  assertSafeWikiHandoffPath,
  buildWikiHandoff,
  captureWikiBaseline,
  isAllowedWikiHandoffPath,
  parseGitStatusPorcelainZ,
  validateAndApplyWikiHandoff,
  WIKI_HANDOFF_MAX_TOTAL_BYTES,
  WikiHandoffValidationError,
} from './wiki-handoff-core.ts'

/** Join porcelain -z records with NUL separators, plus a trailing NUL (git's actual output shape). */
function nulRecords(...records: string[]): string {
  return records.length === 0 ? '' : `${records.join('\0')}\0`
}

function makeBaselineMocks(params: {
  baselineFiles: Record<string, string>
  currentContents: Record<string, string>
  existingPaths: Set<string>
}): {
  readFileImpl: typeof fs.readFile
  existsImpl: (target: string) => Promise<boolean>
  hashImpl: (contents: Buffer) => string
} {
  const readFileImplMock = vi.fn(async (target: unknown, encoding?: unknown) => {
    const key = String(target)
    if (key === '/baseline.json') {
      return JSON.stringify({files: params.baselineFiles})
    }
    const relative = key.replace('/repo/', '')
    const content = params.currentContents[relative]
    if (content === undefined) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    return encoding === 'utf8' ? content : Buffer.from(content)
  })
  const existsImpl = vi.fn(async (target: string) => {
    const relative = target.replace('/repo/', '')
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
      cwd: '/repo',
      outDir: '/tmp/handoff',
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
      ['/repo/knowledge/wiki/repos/new.md', '/tmp/handoff/files/knowledge/wiki/repos/new.md'],
    ])
    expect(JSON.parse(writes['/tmp/handoff/manifest.json'] ?? '')).toStrictEqual({
      changed: ['knowledge/wiki/repos/new.md'],
      deleted: ['knowledge/log.md'],
    })
    // The build side must never write anything else — no metadata.json, no other file.
    expect(Object.keys(writes)).toStrictEqual(['/tmp/handoff/manifest.json'])
  })

  it('throws when git reports a path outside the wiki scope (defense in depth)', async () => {
    await expect(
      buildWikiHandoff({
        cwd: '/repo',
        outDir: '/tmp/handoff',
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
        cwd: '/repo',
        outDir: '/tmp/handoff',
        baselinePath: '/baseline.json',
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
        cwd: '/repo',
        outDir: '/tmp/handoff',
        baselinePath: '/baseline.json',
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
        cwd: '/repo',
        outDir: '/tmp/handoff',
        baselinePath: '/baseline.json',
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
      // The page existed at baseline (untracked, data-only) and the agent removed it. Since it
      // was never tracked in HEAD, its removal produces NO git-status entry at all — this must
      // be detected by checking baseline paths against current disk existence, not git status.
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/removed.md': 'baseline-content'},
        currentContents: {},
        existingPaths: new Set(),
      })

      const result = await buildWikiHandoff({
        cwd: '/repo',
        outDir: '/tmp/handoff',
        baselinePath: '/baseline.json',
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

    it('still reports a tracked-in-HEAD deletion (git status D entry) as deleted regardless of baseline', async () => {
      const mocks = makeBaselineMocks({
        baselineFiles: {},
        currentContents: {},
        existingPaths: new Set(),
      })

      const result = await buildWikiHandoff({
        cwd: '/repo',
        outDir: '/tmp/handoff',
        baselinePath: '/baseline.json',
        runGitStatus: async () => nulRecords(' D knowledge/wiki/repos/tracked-gone.md'),
        readFileImpl: mocks.readFileImpl,
        existsImpl: mocks.existsImpl,
        hashImpl: mocks.hashImpl,
        mkdirImpl: vi.fn(async () => undefined),
        copyFileImpl: vi.fn(async () => undefined),
        writeFileImpl: vi.fn(async () => undefined),
      })

      expect(result).toStrictEqual({changed: [], deleted: ['knowledge/wiki/repos/tracked-gone.md']})
    })

    it('an empty manifest results when nothing changed since baseline, even with mixed candidates', async () => {
      const mocks = makeBaselineMocks({
        baselineFiles: {'knowledge/wiki/repos/untouched.md': 'same'},
        currentContents: {'knowledge/wiki/repos/untouched.md': 'same'},
        existingPaths: new Set(['knowledge/wiki/repos/untouched.md']),
      })

      const result = await buildWikiHandoff({
        cwd: '/repo',
        outDir: '/tmp/handoff',
        baselinePath: '/baseline.json',
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
  it('hashes every changed (added/modified/untracked) candidate path, ignoring deletions', async () => {
    const written: Record<string, string> = {}
    const manifest = await captureWikiBaseline({
      cwd: '/repo',
      baselinePath: '/baseline.json',
      runGitStatus: async () =>
        nulRecords('?? knowledge/wiki/repos/a.md', ' M knowledge/index.md', ' D knowledge/log.md'),
      readFileImpl: vi.fn(async (target: unknown) => {
        const key = String(target)
        if (key === '/repo/knowledge/wiki/repos/a.md') return Buffer.from('content-a')
        if (key === '/repo/knowledge/index.md') return Buffer.from('content-index')
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
    })
    expect(JSON.parse(written['/baseline.json'] ?? '')).toStrictEqual(manifest)
  })

  it('skips any candidate path outside the wiki allowlist defensively', async () => {
    const manifest = await captureWikiBaseline({
      cwd: '/repo',
      baselinePath: '/baseline.json',
      runGitStatus: async () => nulRecords('?? metadata/repos.yaml', '?? knowledge/wiki/repos/a.md'),
      readFileImpl: vi.fn(async () => Buffer.from('content')) as unknown as typeof fs.readFile,
      writeFileImpl: vi.fn(async () => undefined),
      hashImpl: () => 'hash',
    })

    expect(Object.keys(manifest.files)).toStrictEqual(['knowledge/wiki/repos/a.md'])
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
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/foo.md': {size: 10}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: ['knowledge/log.md']}))

    const result = await validateAndApplyWikiHandoff({
      handoffDir: '/handoff',
      workspaceDir: '/workspace',
      mkdirImpl: mocks.mkdirImpl,
      readdirImpl: mocks.readdirImpl,
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
      readdirImpl: mocks.readdirImpl,
      lstatImpl: mocks.lstatImpl,
      readFileImpl: mocks.readFileImpl,
      writeFileImpl: mocks.writeFileImpl,
      rmImpl: mocks.rmImpl,
    })

    expect(result).toStrictEqual({applied: [], deleted: []})
  })

  it('rejects an artifact containing a resurrected metadata.json', async () => {
    const mocks = makeFsMocks({}, ['manifest.json', 'files', 'metadata.json'])

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/foo.md': {size: 1}}, [
      'manifest.json',
      'files',
      'metadata.json',
    ])
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/foo.md': {size: 1, symlink: true}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
      '/handoff/files/knowledge/wiki/repos/foo.md': {size: WIKI_HANDOFF_MAX_TOTAL_BYTES + 1},
    })
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/foo.md'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
    const mocks = makeFsMocks({'/handoff/files/knowledge/wiki/repos/ok.md': {size: 1}})
    mocks.setManifest(JSON.stringify({changed: ['knowledge/wiki/repos/ok.md', 'metadata/repos.yaml'], deleted: []}))

    await expect(
      validateAndApplyWikiHandoff({
        handoffDir: '/handoff',
        workspaceDir: '/workspace',
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
