import type {execFileSync} from 'node:child_process'
import {execFileSync as execFileSyncReal} from 'node:child_process'
import {createHash, type Hash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, dirname, join, parse, relative, resolve, sep} from 'node:path'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'

import {GATE_CONTRACT_VERSION} from '../packages/wiki-write-core/src/gate-contract.ts'
import {
  buildConfig,
  cliOptions,
  collectFiles,
  computeSourceTreeHash,
  embedSourceTreeHash,
  isFileNotFoundError,
  isNotDirectoryError,
  isRecord,
  markerDirectory,
  packageDirectory,
  packageManifest,
  parsePackageManifest,
  pathExists,
  publishedExports,
  publishedManifest,
  replaceDirectoryAtomically,
  reportFatalError,
  repositoryRoot,
  resolveBuildConfig,
  resolveCheckOnly,
  resolveStageRoot,
  resolveVerify,
  rewriteDeclarationExtensions,
  runBuild,
  runTypeScriptBuild,
  sourceHashPlaceholder,
  sourceRoot,
  stableJson,
  stagePackage,
  stageRootAllowlist,
  updateHash,
  writeGateContractMarker,
} from './build-wiki-write-core.ts'

// Pure and cheap, so first: the mutants of `publishedExports` and its helpers die here, not after the real `tsc` tests.
describe('published manifest', () => {
  it('maps a src entry to the dist import and its declaration file, and passes other values through', () => {
    expect(
      publishedExports({
        '.': './src/index.ts',
        './wiki-lint': './src/wiki-lint.ts',
        './package.json': './package.json',
        './conditional': {import: './dist/conditional.js'},
        './nested': './src/nested/deep.ts',
        './other-extension': './src/data.json',
        './outside': './lib/other.ts',
        './number': 1,
        './array': ['./src/array.ts'],
        './embedded': './other/./src/embedded.ts',
        './trailing': './src/trailing.tsx',
        './declaration-map': './src/map.ts.map',
      }),
    ).toEqual({
      '.': {types: './dist/index.d.ts', import: './dist/index.js'},
      './wiki-lint': {types: './dist/wiki-lint.d.ts', import: './dist/wiki-lint.js'},
      './package.json': './package.json',
      './conditional': {import: './dist/conditional.js'},
      './nested': './src/nested/deep.ts',
      './other-extension': './src/data.json',
      './outside': './lib/other.ts',
      './number': 1,
      './array': ['./src/array.ts'],
      './embedded': './other/./src/embedded.ts',
      './trailing': './src/trailing.tsx',
      './declaration-map': './src/map.ts.map',
    })
  })

  it('keeps the subpath key order and passes a non-record exports value through', () => {
    expect(Object.keys(publishedExports({'./b': './src/b.ts', './a': './src/a.ts'}) as object)).toEqual(['./b', './a'])
    expect(publishedExports('./src/index.ts')).toBe('./src/index.ts')
    expect(publishedExports(null)).toBeNull()
    expect(publishedExports(['./src/index.ts'])).toEqual(['./src/index.ts'])
  })

  it('rewrites only exports in the manifest text and keeps every other field and its order', () => {
    const text = JSON.stringify({name: 'x', exports: {'.': './src/index.ts'}, files: ['dist'], engines: {node: '>=24'}})
    const published = publishedManifest(text, 'package.json')
    expect(published.endsWith('}\n')).toBe(true)
    expect(JSON.parse(published)).toEqual({
      name: 'x',
      exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
      files: ['dist'],
      engines: {node: '>=24'},
    })
    expect(Object.keys(JSON.parse(published) as object)).toEqual(['name', 'exports', 'files', 'engines'])
    expect(published).toContain('\n  "name": "x"')
  })

  it.each(['{"name":"x"}', '[]', 'null', '"text"'])('rejects a manifest without an exports object: %s', content => {
    expect(() => publishedManifest(content, 'packages/wiki-write-core/package.json')).toThrow(
      'package manifest must define exports: packages/wiki-write-core/package.json',
    )
  })

  it('produces the same digest input for the committed manifest as for its dist-form equivalent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-published-hash-'))
    const sourceDir = join(root, 'src')
    const configPath = join(root, 'tsconfig.build.json')
    try {
      await mkdir(sourceDir)
      await writeFile(join(sourceDir, 'index.ts'), 'export const value = 1\n')
      await writeFile(configPath, '{}\n')
      const hashFor = async (exportsField: unknown) => {
        const manifestPath = join(root, 'package.json')
        await writeFile(manifestPath, `${JSON.stringify({files: ['dist'], exports: exportsField})}\n`)
        return computeSourceTreeHash({
          sourceRoot: sourceDir,
          buildConfigPath: configPath,
          manifestPath,
          resolvedBuildConfig: {},
        })
      }
      const fromSource = await hashFor({'.': './src/index.ts'})
      const fromDist = await hashFor({'.': {types: './dist/index.d.ts', import: './dist/index.js'}})
      expect(fromSource).toBe(fromDist)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

describe('wiki-write-core build inputs', () => {
  it('rejects symlinks while collecting distribution files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-symlink-'))

    try {
      await writeFile(join(root, 'entry.js'), 'export {}\n')
      await symlink('entry.js', join(root, 'link.js'))

      await expect(collectFiles(root)).rejects.toThrow(/symlink is not allowed in wiki-write-core dist/)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects a root directory argument that is itself a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-symlink-root-'))
    const real = join(root, 'real')
    const link = join(root, 'link')

    try {
      await mkdir(real)
      await writeFile(join(real, 'entry.js'), 'export {}\n')
      await symlink('real', link)

      await expect(collectFiles(link)).rejects.toThrow(/symlink is not allowed in wiki-write-core dist/)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('recurses into subdirectories when collecting distribution files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-nested-'))

    try {
      await mkdir(join(root, 'nested', 'deeper'), {recursive: true})
      await writeFile(join(root, 'top.js'), 'export const top = true\n')
      await writeFile(join(root, 'nested', 'mid.js'), 'export const mid = true\n')
      await writeFile(join(root, 'nested', 'deeper', 'bottom.js'), 'export const bottom = true\n')

      const files = await collectFiles(root)
      expect(files.map(path => relative(root, path)).sort()).toEqual([
        join('nested', 'deeper', 'bottom.js'),
        join('nested', 'mid.js'),
        'top.js',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('includes build configuration and package export inputs in the digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-hash-'))
    const sourceRoot = join(root, 'src')
    const baseConfigPath = join(root, 'base.json')
    const configPath = join(root, 'tsconfig.build.json')
    const manifestPath = join(root, 'package.json')

    try {
      await mkdir(sourceRoot)
      await writeFile(join(sourceRoot, 'index.ts'), 'export const value = 1\n')
      await writeFile(join(sourceRoot, 'index.test.ts'), 'export const testOnly = 1\n')
      await writeFile(baseConfigPath, '{"compilerOptions":{"strict":true}}\n')
      await writeFile(
        configPath,
        `${JSON.stringify({extends: './base.json', compilerOptions: {declaration: true}, files: ['src/index.ts']})}\n`,
      )
      await writeFile(
        manifestPath,
        `${JSON.stringify({
          exports: {'.': {import: './dist/index.js'}, './extra': './dist/extra.js'},
          files: ['dist', 'README.md'],
        })}\n`,
      )

      const originalResolvedConfig = {compilerOptions: {declaration: true, strict: true}}
      const baseline = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: originalResolvedConfig,
      })

      await writeFile(
        manifestPath,
        `${JSON.stringify({
          files: ['README.md', 'dist'],
          exports: {'./extra': './dist/extra.js', '.': {import: './dist/index.js'}},
        })}\n`,
      )
      const reordered = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: originalResolvedConfig,
      })
      expect(reordered).toBe(baseline)

      await writeFile(baseConfigPath, '{"compilerOptions":{"strict":false}}\n')
      const inheritedResolvedConfig = resolveBuildConfig(configPath)
      expect(inheritedResolvedConfig).not.toEqual(originalResolvedConfig)
      const inheritedConfigChanged = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: inheritedResolvedConfig,
      })
      expect(inheritedConfigChanged).not.toBe(baseline)

      const changedResolvedConfig = {compilerOptions: {declaration: false, strict: false}}
      const configChanged = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: changedResolvedConfig,
      })
      expect(configChanged).not.toBe(baseline)

      await writeFile(
        manifestPath,
        `${JSON.stringify({
          exports: {'.': {import: './dist/changed.js'}, './extra': './dist/extra.js'},
          files: ['dist', 'README.md'],
        })}\n`,
      )
      const exportsChanged = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: originalResolvedConfig,
      })
      expect(exportsChanged).not.toBe(baseline)

      // A real (non-test) source file's content must actually reach the digest — proves the
      // `.test.ts` filter keeps ordinary source files rather than silently excluding everything.
      await writeFile(join(sourceRoot, 'index.ts'), 'export const value = 2\n')
      const realSourceChanged = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: originalResolvedConfig,
      })
      expect(realSourceChanged).not.toBe(exportsChanged)

      await writeFile(join(sourceRoot, 'index.test.ts'), 'export const testOnly = 2\n')
      const unrelatedChanged = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: originalResolvedConfig,
      })
      expect(unrelatedChanged).toBe(realSourceChanged)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('sorts source files before hashing regardless of the raw readdir order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-sort-order-'))
    const sourceDir = join(root, 'src')
    const configPath = join(root, 'tsconfig.build.json')
    const manifestPath = join(root, 'package.json')

    try {
      await mkdir(sourceDir)
      await writeFile(join(sourceDir, 'a.ts'), 'export const a = 1\n')
      await writeFile(join(sourceDir, 'b.ts'), 'export const b = 1\n')
      await writeFile(configPath, '{}\n')
      await writeFile(manifestPath, '{"files":[],"exports":{}}\n')

      // Deliberately returns entries in reverse order regardless of what the real filesystem
      // gives back — some filesystems (observed: APFS) already return readdir output in sorted
      // order for small directories, which would make a broken sort silently pass.
      let readEntriesCalls = 0
      const reversedReadEntries: typeof readdir = (async (...args: Parameters<typeof readdir>) => {
        readEntriesCalls++
        const entries = await readdir(...args)
        return [...entries].reverse()
      }) as typeof readdir

      const forward = await computeSourceTreeHash({sourceRoot: sourceDir, buildConfigPath: configPath, manifestPath})
      const reversed = await computeSourceTreeHash({
        sourceRoot: sourceDir,
        buildConfigPath: configPath,
        manifestPath,
        readEntries: reversedReadEntries,
      })
      expect(reversed).toBe(forward)
      // Proves the injected readEntries was actually used, not silently replaced by the real
      // default — both hashes would still match even if the default were used instead.
      expect(readEntriesCalls).toBeGreaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('labels a symlink error from the source tree scan with the wiki-write-core dist label', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-hash-symlink-'))
    const sourceDir = join(root, 'src')
    const configPath = join(root, 'tsconfig.build.json')
    const manifestPath = join(root, 'package.json')

    try {
      await mkdir(sourceDir)
      await writeFile(join(sourceDir, 'entry.ts'), 'export {}\n')
      await symlink('entry.ts', join(sourceDir, 'link.ts'))
      await writeFile(configPath, '{}\n')
      await writeFile(manifestPath, '{"files":[],"exports":{}}\n')

      await expect(
        computeSourceTreeHash({sourceRoot: sourceDir, buildConfigPath: configPath, manifestPath}),
      ).rejects.toThrow(/symlink is not allowed in wiki-write-core dist/)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('produces the exact digest the algorithm specifies for a small fixture tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-digest-reference-'))
    const sourceDir = join(root, 'src')
    const configPath = join(root, 'tsconfig.build.json')
    const manifestPath = join(root, 'package.json')

    try {
      await mkdir(join(sourceDir, 'sub'), {recursive: true})
      // Deliberately created in non-alphabetical order, spread across many names, so that
      // whatever raw order the filesystem's readdir happens to return, at least one adjacent
      // pair is out of order unless computeSourceTreeHash's own sort corrects it.
      const names = ['z', 'm', 'q', 'b', 'y', 'a', 'n', 'k', 'w', 'c']
      for (const name of names) {
        await writeFile(join(sourceDir, `${name}.ts`), `export const ${name} = 1\n`)
      }
      // A .test.ts file must be excluded from the digest entirely.
      await writeFile(join(sourceDir, 'excluded.test.ts'), 'export const excluded = 999\n')
      // A nested file exercises the '/' join of a multi-segment relative path.
      await writeFile(join(sourceDir, 'sub', 'nested.ts'), 'export const nested = 1\n')
      await writeFile(configPath, '{}\n')
      await writeFile(manifestPath, '{"files":["z-file","a-file"],"exports":{"b":1,"a":2}}\n')

      const resolvedBuildConfig = {b: 2, a: 1}
      const actual = await computeSourceTreeHash({
        sourceRoot: sourceDir,
        buildConfigPath: configPath,
        manifestPath,
        resolvedBuildConfig,
      })

      const expected = createHash('sha256')
      const relativeEntries = [...names.map(name => `${name}.ts`), join('sub', 'nested.ts')].sort((left, right) =>
        left.localeCompare(right),
      )
      for (const relativeEntry of relativeEntries) {
        updateHash(
          expected,
          `source/${relativeEntry.split(sep).join('/')}`,
          await readFile(join(sourceDir, relativeEntry)),
        )
      }
      updateHash(expected, 'build-config/tsconfig.build.json', '{"a":1,"b":2}')
      updateHash(expected, 'package/exports', '{"a":2,"b":1}')
      updateHash(expected, 'package/files', '["a-file","z-file"]')
      expect(actual).toBe(expected.digest('hex'))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('computes a real hash for the actual repository source, build config, and manifest', async () => {
    const hash = await computeSourceTreeHash()
    expect(hash).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('does not collect an entry that is neither a file, directory, nor symlink (e.g. a FIFO)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-fifo-'))
    const fifoPath = join(root, 'a-fifo')

    try {
      execFileSyncReal('mkfifo', [fifoPath])

      const files = await collectFiles(root)
      expect(files).toEqual([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes the marker from the source constant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-marker-'))
    const sourceTreeHash = 'a'.repeat(64)

    try {
      await writeGateContractMarker(root, sourceTreeHash)

      await expect(readFile(join(root, 'gate-contract.json'), 'utf8')).resolves.toBe(
        `{"version":${GATE_CONTRACT_VERSION},"sourceTreeHash":"${sourceTreeHash}"}\n`,
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects embedding when the placeholder is entirely missing, with the exact diagnostic message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-placeholder-exact-'))
    const contractPath = join(root, 'gate-contract.js')

    try {
      await writeFile(contractPath, 'export const HASH = "already-substituted"\n')

      await expect(embedSourceTreeHash(root, 'a'.repeat(64))).rejects.toThrow(
        `expected one source-tree hash placeholder in ${contractPath}, found 0`,
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects embedding when the placeholder appears twice, with the exact diagnostic message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-placeholder-exact-2-'))
    const contractPath = join(root, 'gate-contract.js')

    try {
      await writeFile(contractPath, '__SOURCE_TREE_HASH____SOURCE_TREE_HASH__')

      await expect(embedSourceTreeHash(root, 'a'.repeat(64))).rejects.toThrow(
        `expected one source-tree hash placeholder in ${contractPath}, found 2`,
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('restores the target when the replacement rename fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')
    let renameCalls = 0

    try {
      await mkdir(target)
      await writeFile(join(target, 'entry.js'), 'original\n')
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'replacement\n')

      const failingRename: typeof rename = async (from, to) => {
        renameCalls++
        if (renameCalls === 2) throw new Error('simulated replacement failure')
        await rename(from, to)
      }

      await expect(replaceDirectoryAtomically(source, target, failingRename)).rejects.toThrow(
        'simulated replacement failure',
      )
      await expect(readFile(join(target, 'entry.js'), 'utf8')).resolves.toBe('original\n')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('pathExists resolves false for an injected ENOENT lstat failure', async () => {
    const stub: typeof lstat = async () => {
      throw Object.assign(new Error('missing'), {code: 'ENOENT'})
    }
    await expect(pathExists('/whatever', stub)).resolves.toBe(false)
  })

  it('pathExists rejects for an injected non-ENOENT lstat failure', async () => {
    const stub: typeof lstat = async () => {
      throw Object.assign(new Error('denied'), {code: 'EACCES'})
    }
    await expect(pathExists('/whatever', stub)).rejects.toMatchObject({code: 'EACCES'})
  })

  it('pathExists resolves true when lstat resolves', async () => {
    const stub = (async (path: string) => lstat(path)) as typeof lstat
    await expect(pathExists(repositoryRoot(), stub)).resolves.toBe(true)
  })

  it('isRecord classifies primitives, null, arrays, and plain objects', () => {
    expect(isRecord(5)).toBe(false)
    expect(isRecord('a')).toBe(false)
    expect(isRecord(true)).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord({})).toBe(true)
  })

  it("stableJson throws the exact message for a value outside JSON's value space", () => {
    expect(() => stableJson(undefined)).toThrow('package manifest contains an unsupported value')
    expect(() => stableJson(() => {})).toThrow('package manifest contains an unsupported value')
  })

  it('keeps the backup, names it, and carries both causes when the restore rename fails too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-restore-fails-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')
    let renameCalls = 0

    try {
      await mkdir(target)
      await writeFile(join(target, 'entry.js'), 'original\n')
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'replacement\n')

      // Call 1: target -> backup (succeeds). Call 2: source -> target (fails, enters catch).
      // Call 3: backup -> target, the catch block's own restore attempt (fails too).
      const failingRename: typeof rename = async (from, to) => {
        renameCalls++
        if (renameCalls === 1) {
          await rename(from, to)
          return
        }
        throw new Error(renameCalls === 2 ? 'simulated replacement failure' : 'simulated restore failure')
      }

      const failure = await replaceDirectoryAtomically(source, target, failingRename).then(
        () => undefined,
        (error: unknown) => error,
      )

      // The original data survives, in the backup directory, and nothing was deleted.
      const backups = (await readdir(root)).filter(name => name.startsWith('.wiki-write-core-dist-backup-'))
      expect(backups).toHaveLength(1)
      const backup = join(root, backups[0] ?? '')
      await expect(readFile(join(backup, 'entry.js'), 'utf8')).resolves.toBe('original\n')
      await expect(readFile(join(source, 'entry.js'), 'utf8')).resolves.toBe('replacement\n')
      await expect(pathExists(target)).resolves.toBe(false)

      expect(failure).toBeInstanceOf(AggregateError)
      const aggregate = failure as AggregateError
      expect(aggregate.message).toBe(
        `could not install the replacement (simulated replacement failure) and could not restore the original (simulated restore failure); the original is kept at ${backup}`,
      )
      expect(aggregate.errors.map(error => (error as Error).message)).toEqual([
        'simulated replacement failure',
        'simulated restore failure',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('does not delete the backup when removing it after a successful replacement is the step that fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-keep-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')

    try {
      await mkdir(target)
      await writeFile(join(target, 'entry.js'), 'original\n')
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'replacement\n')

      await replaceDirectoryAtomically(source, target)

      await expect(readFile(join(target, 'entry.js'), 'utf8')).resolves.toBe('replacement\n')
      expect((await readdir(root)).filter(name => name.startsWith('.wiki-write-core-dist-backup-'))).toEqual([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rethrows a non-ENOENT pathExists failure (ENAMETOOLONG) instead of treating it as "target missing"', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-enametoolong-'))
    // The overly long basename fails lstat with ENAMETOOLONG regardless of its parent directory
    // (which is a perfectly ordinary, writable temp dir) — unlike ENOENT, this is not "missing".
    const target = join(root, 'x'.repeat(300))
    const source = join(root, 'new-dist')

    try {
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'fresh\n')

      await expect(replaceDirectoryAtomically(source, target)).rejects.toMatchObject({code: 'ENAMETOOLONG'})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('removes the backup directory after a successful replace of a pre-existing target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-cleanup-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')

    try {
      await mkdir(target)
      await writeFile(join(target, 'entry.js'), 'original\n')
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'replacement\n')

      await replaceDirectoryAtomically(source, target)

      const siblingEntries = await readdir(root)
      const leftoverBackups = siblingEntries.filter(name => name.startsWith('.wiki-write-core-dist-backup-'))
      expect(leftoverBackups).toEqual([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('resolveBuildConfig spawns tsc --showConfig with the exact command and options', () => {
    const calls: unknown[] = []
    const fakeSpawn = ((...args: unknown[]) => {
      calls.push(args)
      return '{}'
    }) as unknown as typeof execFileSync

    resolveBuildConfig('/repo/tsconfig.build.json', {spawn: fakeSpawn})

    expect(calls).toEqual([
      [
        'bunx',
        ['--no-install', 'tsc', '--showConfig', '--project', '/repo/tsconfig.build.json', '--pretty', 'false'],
        {cwd: repositoryRoot(), encoding: 'utf8'},
      ],
    ])
  })

  it('captures the target into a uniquely-prefixed backup directory during an atomic replace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-backup-prefix-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')
    const backupNames: string[] = []

    try {
      await mkdir(target)
      await writeFile(join(target, 'entry.js'), 'original\n')
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'replacement\n')

      const capturingRename: typeof rename = async (from, to) => {
        backupNames.push(basename(String(to)))
        await rename(from, to)
      }

      await replaceDirectoryAtomically(source, target, capturingRename)

      expect(backupNames[0]).toMatch(/^\.wiki-write-core-dist-backup-/u)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('propagates the original failure without attempting a backup restore when no prior target existed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-fresh-failure-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')
    let renameCalls = 0

    try {
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'fresh\n')

      const failingRename: typeof rename = async () => {
        renameCalls++
        throw new Error('simulated fresh-install failure')
      }

      await expect(replaceDirectoryAtomically(source, target, failingRename)).rejects.toThrow(
        'simulated fresh-install failure',
      )
      // Exactly one attempt: the source->target rename. A second call would mean the catch
      // block wrongly tried to restore a backup that was never created (target never existed).
      expect(renameCalls).toBe(1)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('moves the source into place directly when no prior target exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-atomic-fresh-'))
    const target = join(root, 'dist')
    const source = join(root, 'new-dist')

    try {
      await mkdir(source)
      await writeFile(join(source, 'entry.js'), 'fresh\n')

      await replaceDirectoryAtomically(source, target)

      await expect(readFile(join(target, 'entry.js'), 'utf8')).resolves.toBe('fresh\n')
      const siblingEntries = await readdir(root)
      expect(siblingEntries).toEqual(['dist'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it.each([0, 2])('rejects a hash placeholder count of %s', async occurrences => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-placeholder-'))

    try {
      await writeFile(join(root, 'gate-contract.js'), '__SOURCE_TREE_HASH__'.repeat(occurrences))

      await expect(embedSourceTreeHash(root, 'a'.repeat(64))).rejects.toThrow(
        /expected one source-tree hash placeholder/,
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects a package manifest without exports', () => {
    expect(() => parsePackageManifest('{"files": []}\n', 'package.json')).toThrow(
      'package manifest must define exports: package.json',
    )
  })

  it('rejects a package manifest whose top level is not a record', () => {
    expect(() => parsePackageManifest('[]\n', 'package.json')).toThrow(
      'package manifest must define a string files array: package.json',
    )
  })

  it('rejects a null package manifest with the same clean error, not a raw TypeError', () => {
    // Discriminates isRecord's `value !== null` clause specifically: typeof null === 'object' in
    // JS, so only the null check rules it out. If that check were forced to always pass, parsing
    // would instead crash reading `.files` off `null` with a TypeError.
    expect(() => parsePackageManifest('null\n', 'package.json')).toThrow(
      'package manifest must define a string files array: package.json',
    )
  })

  it.each(['42', 'true', '"just a string"'])(
    'rejects a primitive %s package manifest with the same clean error',
    primitive => {
      expect(() => parsePackageManifest(`${primitive}\n`, 'package.json')).toThrow(
        'package manifest must define a string files array: package.json',
      )
    },
  )

  it('rejects a package manifest whose files field is not an array', () => {
    expect(() => parsePackageManifest('{"files": "dist", "exports": "./index.js"}\n', 'package.json')).toThrow(
      'package manifest must define a string files array: package.json',
    )
  })

  it('rejects a package manifest whose files array has a non-string entry', () => {
    expect(() => parsePackageManifest('{"files": ["dist", 1], "exports": "./index.js"}\n', 'package.json')).toThrow(
      'package manifest must define a string files array: package.json',
    )
  })

  it('accepts an exports key present with a null value (key presence, not truthiness, is the check)', () => {
    expect(parsePackageManifest('{"files": ["dist"], "exports": null}\n', 'package.json')).toEqual({
      exports: null,
      files: ['dist'],
    })
  })

  it('returns the exact exports and files parsed from a valid manifest', () => {
    expect(parsePackageManifest('{"files": ["dist", "README.md"], "exports": "./index.js"}\n', 'package.json')).toEqual(
      {exports: './index.js', files: ['dist', 'README.md']},
    )
  })

  it('formats a manifest error path with forward slashes across multiple segments', () => {
    const nestedPath = join(repositoryRoot(), 'packages', 'wiki-write-core', 'package.json')
    expect(() => parsePackageManifest('{"files": []}\n', nestedPath)).toThrow(
      'package manifest must define exports: packages/wiki-write-core/package.json',
    )
  })

  it('falls back to the raw path when it resolves to the repository root itself', () => {
    expect(() => parsePackageManifest('{"files": []}\n', repositoryRoot())).toThrow(
      `package manifest must define exports: ${repositoryRoot()}`,
    )
  })

  it('serializes primitive, array, and nested-object values identically under key reordering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-stablejson-'))
    const sourceRoot = join(root, 'src')
    const configPath = join(root, 'tsconfig.build.json')
    const manifestPath = join(root, 'package.json')

    try {
      await mkdir(sourceRoot)
      await writeFile(configPath, '{}\n')
      await writeFile(manifestPath, '{"files":[],"exports":{}}\n')

      const hashFor = async (resolvedBuildConfig: unknown) =>
        computeSourceTreeHash({sourceRoot, buildConfigPath: configPath, manifestPath, resolvedBuildConfig})

      // Primitive type coverage: null, boolean, number, string all reach stableJson's first branch.
      const primitives = await hashFor({a: null, b: true, c: 1, d: 'x'})
      const primitivesReordered = await hashFor({d: 'x', c: 1, b: true, a: null})
      expect(primitives).toBe(primitivesReordered)

      const primitivesChanged = await hashFor({a: null, b: false, c: 1, d: 'x'})
      expect(primitivesChanged).not.toBe(primitives)

      // Array separator collision: without the ',' join, [1, 23] and [123] serialize identically.
      const commaA = await hashFor({n: [1, 23]})
      const commaB = await hashFor({n: [123]})
      expect(commaA).not.toBe(commaB)

      // Array bracket coverage: an array differs from an equivalent-looking non-array record.
      const arrayForm = await hashFor({n: [1, 2]})
      const nestedForm = await hashFor({n: {0: 1, 1: 2}})
      expect(arrayForm).not.toBe(nestedForm)

      // Object key/value separator and brace coverage, plus nested record recursion.
      const nestedA = await hashFor({outer: {inner: 1, other: 2}})
      const nestedB = await hashFor({outer: {inner: 2, other: 1}})
      expect(nestedA).not.toBe(nestedB)

      // Empty array and empty object both serialize and must not collide with each other.
      const emptyArray = await hashFor({v: []})
      const emptyObject = await hashFor({v: {}})
      expect(emptyArray).not.toBe(emptyObject)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rewrites declaration import specifiers without changing string literal types', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-declarations-'))

    try {
      await writeFile(
        join(root, 'entry.d.ts'),
        [
          "export type {Thing} from './thing.ts'",
          "type Imported = import('./imported.ts').Thing",
          "declare const path: './literal.ts'",
          '',
        ].join('\n'),
      )
      await writeFile(join(root, 'gate-contract.json'), '{"note":"from \'./literal.ts\'"}\n')

      await rewriteDeclarationExtensions(root)

      await expect(readFile(join(root, 'entry.d.ts'), 'utf8')).resolves.toBe(
        [
          "export type {Thing} from './thing.js'",
          "type Imported = import('./imported.js').Thing",
          "declare const path: './literal.ts'",
          '',
        ].join('\n'),
      )
      await expect(readFile(join(root, 'gate-contract.json'), 'utf8')).resolves.toBe(
        '{"note":"from \'./literal.ts\'"}\n',
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rewrites a "from" import with extra whitespace before the quote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-declarations-ws-from-'))

    try {
      await writeFile(join(root, 'entry.d.ts'), "export type {Thing} from  './thing.ts'\n")
      await rewriteDeclarationExtensions(root)
      await expect(readFile(join(root, 'entry.d.ts'), 'utf8')).resolves.toBe("export type {Thing} from  './thing.js'\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rewrites a dynamic import() with whitespace between "import" and the parenthesis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-declarations-ws-import-'))

    try {
      await writeFile(join(root, 'entry.d.ts'), "type T = import ('./thing.ts').Thing\n")
      await rewriteDeclarationExtensions(root)
      await expect(readFile(join(root, 'entry.d.ts'), 'utf8')).resolves.toBe("type T = import ('./thing.js').Thing\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rewrites a dynamic import() with whitespace right after the parenthesis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-declarations-ws-paren-'))

    try {
      await writeFile(join(root, 'entry.d.ts'), "type T = import(  './thing.ts').Thing\n")
      await rewriteDeclarationExtensions(root)
      await expect(readFile(join(root, 'entry.d.ts'), 'utf8')).resolves.toBe("type T = import(  './thing.js').Thing\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('does not write a .d.ts file whose content has no matching import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-declarations-unchanged-'))
    const entryPath = join(root, 'entry.d.ts')

    try {
      await writeFile(entryPath, 'export declare const value: number\n')
      const old = new Date(Date.now() - 60_000)
      await utimes(entryPath, old, old)
      const before = await stat(entryPath)

      await rewriteDeclarationExtensions(root)

      const after = await stat(entryPath)
      expect(after.mtimeMs).toBe(before.mtimeMs)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('updateHash writes label, separator, byte length, separator, content, separator in order', () => {
    const calls: unknown[] = []
    const fakeHash = {
      update: (chunk: unknown) => {
        calls.push(chunk)
        return fakeHash
      },
    } as unknown as Parameters<typeof updateHash>[0]

    updateHash(fakeHash, 'my-label', 'abc')

    expect(calls).toEqual(['my-label', '\0', '3', '\0', 'abc', '\0'])
  })

  it('produces different digests when the ordering of same-length labeled segments changes', () => {
    // Without the '\0' separator, hash('a','bc') and hash('ab','c') would collapse to the same
    // byte stream (both concatenate to "abc"). The separator makes label/content boundaries load-bearing.
    const hashOne = createHashDigest(hash => {
      updateHash(hash, 'a', 'bc')
    })
    const hashTwo = createHashDigest(hash => {
      updateHash(hash, 'ab', 'c')
    })
    expect(hashOne).not.toBe(hashTwo)
  })

  it('classifies file-not-found errors precisely', () => {
    expect(isFileNotFoundError(Object.assign(new Error('missing'), {code: 'ENOENT'}))).toBe(true)
    expect(isFileNotFoundError(new Error('no code'))).toBe(false)
    expect(isFileNotFoundError(Object.assign(new Error('other'), {code: 'EACCES'}))).toBe(false)
    expect(isFileNotFoundError({code: 'ENOENT'})).toBe(false)
    expect(isFileNotFoundError('ENOENT')).toBe(false)
    expect(isFileNotFoundError(undefined)).toBe(false)
  })

  it('classifies not-a-directory errors precisely', () => {
    expect(isNotDirectoryError(Object.assign(new Error('not a directory'), {code: 'ENOTDIR'}))).toBe(true)
    expect(isNotDirectoryError(new Error('no code'))).toBe(false)
    expect(isNotDirectoryError(Object.assign(new Error('other'), {code: 'ENOENT'}))).toBe(false)
    expect(isNotDirectoryError({code: 'ENOTDIR'})).toBe(false)
    expect(isNotDirectoryError('ENOTDIR')).toBe(false)
    expect(isNotDirectoryError(undefined)).toBe(false)
  })

  it('resolves the module build paths against the repository root', () => {
    expect(repositoryRoot()).toBe(resolve(import.meta.dirname, '..'))
    expect(relative(repositoryRoot(), sourceRoot())).toBe(join('packages', 'wiki-write-core', 'src'))
    expect(relative(repositoryRoot(), packageDirectory())).toBe(join('packages', 'wiki-write-core'))
    expect(relative(repositoryRoot(), markerDirectory())).toBe(join('packages', 'wiki-write-core', 'dist'))
    expect(relative(repositoryRoot(), buildConfig())).toBe(join('packages', 'wiki-write-core', 'tsconfig.build.json'))
    expect(relative(repositoryRoot(), packageManifest())).toBe(join('packages', 'wiki-write-core', 'package.json'))
    expect(sourceHashPlaceholder()).toBe('__SOURCE_TREE_HASH__')
  })

  it('resolveCheckOnly recognizes only an explicit --check argument', () => {
    expect(resolveCheckOnly(['node', 'script.ts'])).toBe(false)
    expect(resolveCheckOnly(['node', 'script.ts', '--check'])).toBe(true)
    expect(resolveCheckOnly(['node', 'script.ts', '--other'])).toBe(false)
  })

  it('runTypeScriptBuild spawns the exact tsc build command', () => {
    const calls: unknown[] = []
    const fakeSpawn = ((...args: unknown[]) => {
      calls.push(args)
      return ''
    }) as unknown as typeof execFileSync
    runTypeScriptBuild('/tmp/out-dir', {buildConfigPath: '/repo/tsconfig.build.json', cwd: '/repo', spawn: fakeSpawn})
    expect(calls).toEqual([
      [
        'bunx',
        [
          '--no-install',
          'tsc',
          '--project',
          '/repo/tsconfig.build.json',
          '--outDir',
          '/tmp/out-dir',
          '--pretty',
          'false',
        ],
        {cwd: '/repo', stdio: 'inherit'},
      ],
    ])
  })

  it('runTypeScriptBuild defaults buildConfigPath and cwd to the real repository values', () => {
    const calls: unknown[] = []
    const fakeSpawn = ((...args: unknown[]) => {
      calls.push(args)
      return ''
    }) as unknown as typeof execFileSync
    runTypeScriptBuild('/tmp/out-dir', {spawn: fakeSpawn})
    expect(calls).toEqual([
      [
        'bunx',
        ['--no-install', 'tsc', '--project', buildConfig(), '--outDir', '/tmp/out-dir', '--pretty', 'false'],
        {cwd: repositoryRoot(), stdio: 'inherit'},
      ],
    ])
  })

  it('reportFatalError writes an Error message to stderr and sets a failing exit code', () => {
    const originalExitCode = process.exitCode
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      process.exitCode = undefined
      reportFatalError(new Error('boom'))
      expect(writeSpy).toHaveBeenCalledWith('boom\n')
      expect(process.exitCode).toBe(1)
    } finally {
      writeSpy.mockRestore()
      process.exitCode = originalExitCode
    }
  })

  it('reportFatalError stringifies a non-Error thrown value', () => {
    const originalExitCode = process.exitCode
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      process.exitCode = undefined
      reportFatalError('a plain string failure')
      expect(writeSpy).toHaveBeenCalledWith('a plain string failure\n')
      expect(process.exitCode).toBe(1)
    } finally {
      writeSpy.mockRestore()
      process.exitCode = originalExitCode
    }
  })
})

async function makeRunBuildFixture(): Promise<{
  cleanup: () => Promise<void>
  fakeBuild: (variant?: string) => (outputDirectory: string) => void
  root: string
  sourceOpts: {
    buildConfigPath: string
    manifestPath: string
    markerDirectory: string
    resolvedBuildConfig: unknown
    sourceRoot: string
  }
}> {
  const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-runbuild-'))
  const sourceDir = join(root, 'src')
  const buildConfigPath = join(root, 'tsconfig.build.json')
  const manifestPath = join(root, 'package.json')
  const markerDir = join(root, 'dist')

  await mkdir(sourceDir)
  await writeFile(join(sourceDir, 'index.ts'), 'export const value = 1\n')
  await writeFile(buildConfigPath, '{}\n')
  await writeFile(
    manifestPath,
    '{"files":["dist"],"exports":{".":"./src/index.ts","./package.json":"./package.json"}}\n',
  )
  await writeFile(join(root, 'README.md'), 'readme\n')
  await writeFile(join(root, 'LICENSE.md'), 'license\n')

  const fakeBuild =
    (variant = 'a') =>
    (outputDirectory: string) => {
      // Proves runBuild's temp build directory actually uses the documented prefix, not an
      // arbitrary mkdtemp-generated name.
      expect(basename(outputDirectory)).toMatch(/^\.wiki-write-core-dist-/u)
      writeFileSync(join(outputDirectory, 'gate-contract.js'), `export const HASH = '__SOURCE_TREE_HASH__'\n`, 'utf8')
      writeFileSync(join(outputDirectory, 'index.js'), `export const variant = '${variant}'\n`, 'utf8')
    }

  return {
    root,
    // The resolved config is injected: resolving it for real runs `bunx tsc --showConfig` in every test.
    sourceOpts: {
      sourceRoot: sourceDir,
      buildConfigPath,
      manifestPath,
      markerDirectory: markerDir,
      resolvedBuildConfig: {},
    },
    fakeBuild,
    cleanup: async () => rm(root, {force: true, recursive: true}),
  }
}

// Seam tests first. Each pins that a `runBuild` option is used instead of its default, so a mutant that swaps a
// default in runs at most one real tool (a `tsc` build, `npm pack`, a `tsc --showConfig`) before the first of
// these fails. The slower tests below then never wait on a real tool.
describe('runBuild seams', () => {
  it('runs the injected runTypeScriptBuild into the temporary build directory instead of tsc', async () => {
    const fixture = await makeRunBuildFixture()
    const buildTypeScript = vi.fn(fixture.fakeBuild('a'))
    try {
      await runBuild({...fixture.sourceOpts, runTypeScriptBuild: buildTypeScript})
      expect(buildTypeScript).toHaveBeenCalledTimes(1)
      expect(basename(buildTypeScript.mock.calls[0]?.[0] ?? '')).toMatch(/^\.wiki-write-core-dist-/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('forwards resolvedBuildConfig to the source-tree hash, so a different config gives a different hash', async () => {
    const fixture = await makeRunBuildFixture()
    const markerPath = join(fixture.sourceOpts.markerDirectory, 'gate-contract.json')
    const hashFor = async (resolvedBuildConfig: unknown): Promise<string> => {
      await runBuild({...fixture.sourceOpts, resolvedBuildConfig, runTypeScriptBuild: fixture.fakeBuild('a')})
      return (JSON.parse(await readFile(markerPath, 'utf8')) as {sourceTreeHash: string}).sourceTreeHash
    }
    try {
      const first = await hashFor({compilerOptions: {target: 'es2022'}})
      const second = await hashFor({compilerOptions: {target: 'es2023'}})
      expect(first).not.toBe(second)
      for (const [actual, target] of [
        [first, 'es2022'],
        [second, 'es2023'],
      ] as const) {
        const expected = await computeSourceTreeHash({
          sourceRoot: fixture.sourceOpts.sourceRoot,
          buildConfigPath: fixture.sourceOpts.buildConfigPath,
          manifestPath: fixture.sourceOpts.manifestPath,
          resolvedBuildConfig: {compilerOptions: {target}},
        })
        expect(actual).toBe(expected)
      }
    } finally {
      await fixture.cleanup()
    }
  })

  it('stages through the injected replaceDirectory', async () => {
    const fixture = await makeRunBuildFixture()
    const stageRoot = join(fixture.root, 'stage', 'package')
    const replaceDirectory = vi.fn(replaceDirectoryAtomically)
    try {
      await runBuild({
        ...fixture.sourceOpts,
        stageRoot,
        replaceDirectory,
        runTypeScriptBuild: fixture.fakeBuild('a'),
      })
      expect(replaceDirectory).toHaveBeenCalledTimes(1)
      expect(await realpath(replaceDirectory.mock.calls[0]?.[1] ?? '')).toBe(await realpath(stageRoot))
      expect(await readdir(stageRoot)).toContain('wiki-write-core-stage.marker')
    } finally {
      await fixture.cleanup()
    }
  })

  it('removes the temporary build directory with force and recursive after a successful build', async () => {
    const fixture = await makeRunBuildFixture()
    const removeDirectory = vi.fn(rm)
    try {
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: false,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        removeDirectory,
      })
      expect(removeDirectory).toHaveBeenCalledTimes(1)
      expect(removeDirectory).toHaveBeenCalledWith(expect.stringContaining('.wiki-write-core-dist-'), {
        force: true,
        recursive: true,
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('verifies the staged package it built and reports the counts', async () => {
    const fixture = await makeRunBuildFixture()
    const stageRoot = join(fixture.root, 'stage')
    const verifyPackage = vi.fn(async (_root: string) => ({
      files: ['dist/index.js', 'package.json'],
      sourceTreeHash: 'a'.repeat(64),
      subpaths: ['@fro.bot/wiki-write-core'],
    }))
    const messages: string[] = []
    try {
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: false,
        stageRoot,
        verify: true,
        verifyPackage,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        write: message => messages.push(message),
      })
      expect(verifyPackage).toHaveBeenCalledWith(stageRoot)
      expect(messages).toEqual(['wiki-write-core package verified: 1 export subpaths, 2 tarball files\n'])
    } finally {
      await fixture.cleanup()
    }
  })

  it('propagates a replaceDirectory failure from staging and leaves no staging directory behind', async () => {
    const fixture = await makeRunBuildFixture()
    const stageParent = join(fixture.root, 'stage')
    const stagingNames: string[] = []
    try {
      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          stageRoot: join(stageParent, 'package'),
          runTypeScriptBuild: fixture.fakeBuild('a'),
          replaceDirectory: async source => {
            stagingNames.push(basename(source))
            throw new Error('simulated replaceDirectory failure')
          },
        }),
      ).rejects.toThrow('simulated replaceDirectory failure')
      expect(stagingNames).toHaveLength(1)
      expect(stagingNames[0]).toMatch(/^\.wiki-write-core-stage-/u)
      expect(await readdir(stageParent)).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it('resolves the build config path it was given when no resolved config is injected', async () => {
    // The one runBuild test that runs the real `tsc --showConfig`: the default resolution, against the fixture's
    // own config. The repository's `tsconfig.build.json` would resolve to something else.
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({
        ...fixture.sourceOpts,
        resolvedBuildConfig: undefined,
        runTypeScriptBuild: fixture.fakeBuild('a'),
      })
      const marker = JSON.parse(
        await readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), 'utf8'),
      ) as {sourceTreeHash: string}
      const expected = await computeSourceTreeHash({
        sourceRoot: fixture.sourceOpts.sourceRoot,
        buildConfigPath: fixture.sourceOpts.buildConfigPath,
        manifestPath: fixture.sourceOpts.manifestPath,
        resolvedBuildConfig: resolveBuildConfig(fixture.sourceOpts.buildConfigPath),
      })
      expect(marker.sourceTreeHash).toBe(expected)
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('runBuild', () => {
  it('writes only the marker into the marker directory, and a subsequent --check run finds it up to date', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})
      expect(await readdir(fixture.sourceOpts.markerDirectory)).toEqual(['gate-contract.json'])

      const messages: string[] = []
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: true,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        write: message => messages.push(message),
      })
      expect(messages).toEqual(['wiki-write-core gate-contract marker is up to date\n'])
    } finally {
      await fixture.cleanup()
    }
  })

  it('rewrites a stale marker and leaves other files in the marker directory alone', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await mkdir(fixture.sourceOpts.markerDirectory)
      await writeFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), '{"stale":true}\n')
      await writeFile(join(fixture.sourceOpts.markerDirectory, 'untouched.js'), 'export const kept = true\n')

      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})

      const marker = JSON.parse(
        await readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), 'utf8'),
      ) as {version: number}
      expect(marker.version).toBe(GATE_CONTRACT_VERSION)
      await expect(readFile(join(fixture.sourceOpts.markerDirectory, 'untouched.js'), 'utf8')).resolves.toBe(
        'export const kept = true\n',
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('--check throws naming the marker when it differs from a fresh build, and leaves it unchanged', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await mkdir(fixture.sourceOpts.markerDirectory)
      const markerPath = join(fixture.sourceOpts.markerDirectory, 'gate-contract.json')
      await writeFile(markerPath, '{"version":1,"sourceTreeHash":"stale"}\n')

      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: true, runTypeScriptBuild: fixture.fakeBuild('a')}),
      ).rejects.toThrow(
        /wiki-write-core gate-contract marker is stale: .*gate-contract\.json differs from a fresh build; run `bun run build` and commit it/u,
      )
      await expect(readFile(markerPath, 'utf8')).resolves.toBe('{"version":1,"sourceTreeHash":"stale"}\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it('--check throws when no marker is committed, and does not create one', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: true, runTypeScriptBuild: fixture.fakeBuild('a')}),
      ).rejects.toThrow('wiki-write-core gate-contract marker is stale')
      await expect(pathExists(fixture.sourceOpts.markerDirectory)).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('--check rethrows a non-ENOENT failure reading the marker', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await mkdir(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), {recursive: true})

      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: true, runTypeScriptBuild: fixture.fakeBuild('a')}),
      ).rejects.toThrow(/EISDIR/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('propagates a build failure and still removes the temporary build directory', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      const parentBefore = await readdir(dirname(fixture.sourceOpts.markerDirectory))

      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          runTypeScriptBuild: () => {
            throw new Error('simulated tsc failure')
          },
        }),
      ).rejects.toThrow('simulated tsc failure')

      const parentAfter = await readdir(dirname(fixture.sourceOpts.markerDirectory))
      const leftoverTempDirs = parentAfter.filter(
        name => name.startsWith('.wiki-write-core-dist-') && !parentBefore.includes(name),
      )
      expect(leftoverTempDirs).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it('writes the marker when checkOnly is omitted', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, runTypeScriptBuild: fixture.fakeBuild('a')})
      await expect(readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), 'utf8')).resolves.toContain(
        '"sourceTreeHash"',
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('takes nothing from process.argv: the caller alone decides whether to check, stage or verify', async () => {
    const fixture = await makeRunBuildFixture()
    const originalArgv = process.argv
    const stageParent = join(fixture.root, 'argv-stage')
    const verifyPackage = vi.fn()
    try {
      process.argv = [...originalArgv, '--check', '--verify', '--stage', join(stageParent, 'package')]
      await runBuild({...fixture.sourceOpts, runTypeScriptBuild: fixture.fakeBuild('a'), verifyPackage})

      await expect(readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), 'utf8')).resolves.toContain(
        '"sourceTreeHash"',
      )
      await expect(pathExists(stageParent)).resolves.toBe(false)
      expect(verifyPackage).not.toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
      await fixture.cleanup()
    }
  })

  it('removes the temporary build directory with force and recursive after a failed build', async () => {
    const fixture = await makeRunBuildFixture()
    const removeDirectory = vi.fn(rm)
    try {
      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          runTypeScriptBuild: () => {
            throw new Error('simulated tsc failure')
          },
          removeDirectory,
        }),
      ).rejects.toThrow('simulated tsc failure')
      expect(removeDirectory).toHaveBeenCalledTimes(1)
      expect(removeDirectory).toHaveBeenCalledWith(expect.stringContaining('.wiki-write-core-dist-'), {
        force: true,
        recursive: true,
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('defaults write to process.stdout.write when omitted', async () => {
    const fixture = await makeRunBuildFixture()
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})
      await runBuild({...fixture.sourceOpts, checkOnly: true, runTypeScriptBuild: fixture.fakeBuild('a')})
      expect(writeSpy).toHaveBeenCalledWith('wiki-write-core gate-contract marker is up to date\n')
    } finally {
      writeSpy.mockRestore()
      await fixture.cleanup()
    }
  })

  it('embeds a source-tree hash computed from the injected paths, not the real repository defaults', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})

      const expectedHash = await computeSourceTreeHash({
        sourceRoot: fixture.sourceOpts.sourceRoot,
        buildConfigPath: fixture.sourceOpts.buildConfigPath,
        manifestPath: fixture.sourceOpts.manifestPath,
        resolvedBuildConfig: fixture.sourceOpts.resolvedBuildConfig,
      })
      const marker = JSON.parse(
        await readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), 'utf8'),
      ) as {sourceTreeHash: string}
      expect(marker.sourceTreeHash).toBe(expectedHash)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses to build over a marker directory that contains a symlink', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await mkdir(fixture.sourceOpts.markerDirectory)
      await writeFile(join(fixture.sourceOpts.markerDirectory, 'entry.js'), 'export {}\n')
      await symlink('entry.js', join(fixture.sourceOpts.markerDirectory, 'link.js'))

      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')}),
      ).rejects.toThrow(/symlink is not allowed in wiki-write-core dist/)
    } finally {
      await fixture.cleanup()
    }
  })

  it('stages the built dist, the rewritten manifest, the README and the LICENSE into the stage root', async () => {
    const fixture = await makeRunBuildFixture()
    const stageRoot = join(fixture.root, 'stage', 'package')
    try {
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: false,
        stageRoot,
        runTypeScriptBuild: fixture.fakeBuild('a'),
      })

      expect((await readdir(stageRoot)).sort()).toEqual([
        'LICENSE.md',
        'README.md',
        'dist',
        'package.json',
        'wiki-write-core-stage.marker',
      ])
      await expect(readFile(join(stageRoot, 'wiki-write-core-stage.marker'), 'utf8')).resolves.toBe(
        '@fro.bot/wiki-write-core staged package\n',
      )
      await expect(readFile(join(stageRoot, 'dist', 'index.js'), 'utf8')).resolves.toContain("variant = 'a'")
      const stagedMarker = await readFile(join(stageRoot, 'dist', 'gate-contract.json'))
      const committedMarker = await readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'))
      expect(stagedMarker.equals(committedMarker)).toBe(true)
      await expect(readFile(join(stageRoot, 'README.md'), 'utf8')).resolves.toBe('readme\n')
      await expect(readFile(join(stageRoot, 'LICENSE.md'), 'utf8')).resolves.toBe('license\n')
      await expect(readFile(join(stageRoot, 'package.json'), 'utf8')).resolves.toBe(
        `${JSON.stringify(
          {
            files: ['dist'],
            exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}, './package.json': './package.json'},
          },
          null,
          2,
        )}\n`,
      )
      // The committed manifest is untouched.
      await expect(readFile(fixture.sourceOpts.manifestPath, 'utf8')).resolves.toContain('"./src/index.ts"')
      expect(await readdir(join(fixture.root, 'stage'))).toEqual(['package'])
    } finally {
      await fixture.cleanup()
    }
  })

  it('does not write a stage when only --check is requested', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: true,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        write: () => {},
      })
      expect((await readdir(fixture.root)).filter(name => name.startsWith('.wiki-write-core-stage-'))).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it('stages into a scratch directory when verifying without a stage root, then removes it', async () => {
    const fixture = await makeRunBuildFixture()
    const seen: {root: string; files: string[]}[] = []
    const verifyPackage = vi.fn(async (root: string) => {
      seen.push({root, files: (await readdir(root)).sort()})
      return {files: [], sourceTreeHash: 'a'.repeat(64), subpaths: []}
    })
    try {
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: false,
        verify: true,
        verifyPackage,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        write: () => {},
      })
      expect(seen).toHaveLength(1)
      expect(seen[0]?.files).toEqual([
        'LICENSE.md',
        'README.md',
        'dist',
        'package.json',
        'wiki-write-core-stage.marker',
      ])
      expect(basename(dirname(seen[0]?.root ?? ''))).toMatch(/^wiki-write-core-stage-/u)
      await expect(pathExists(dirname(seen[0]?.root ?? ''))).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('removes the scratch stage when verification fails', async () => {
    const fixture = await makeRunBuildFixture()
    let scratch = ''
    try {
      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          verify: true,
          verifyPackage: async root => {
            scratch = dirname(root)
            throw new Error('simulated verification failure')
          },
          runTypeScriptBuild: fixture.fakeBuild('a'),
        }),
      ).rejects.toThrow('simulated verification failure')
      await expect(pathExists(scratch)).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('resolveStageRoot and resolveVerify', () => {
  it('resolveStageRoot is undefined without --stage', () => {
    expect(resolveStageRoot(['bun', 'build.ts', '--check'])).toBeUndefined()
  })

  it('resolveStageRoot returns the absolute directory after --stage', () => {
    expect(resolveStageRoot(['bun', 'build.ts', '--stage', 'out/package'])).toBe(resolve('out/package'))
    expect(resolveStageRoot(['bun', 'build.ts', '--check', '--stage', '/abs/dir', '--verify'])).toBe('/abs/dir')
  })

  it('resolveStageRoot rejects a missing or flag-shaped directory argument', () => {
    expect(() => resolveStageRoot(['bun', 'build.ts', '--stage'])).toThrow('--stage requires a directory argument')
    expect(() => resolveStageRoot(['bun', 'build.ts', '--stage', '--verify'])).toThrow(
      '--stage requires a directory argument',
    )
  })

  it('resolveVerify recognizes only an explicit --verify argument', () => {
    expect(resolveVerify(['bun', 'build.ts'])).toBe(false)
    expect(resolveVerify(['bun', 'build.ts', '--verify-all'])).toBe(false)
    expect(resolveVerify(['bun', 'build.ts', '--check', '--verify'])).toBe(true)
  })
})

describe('cliOptions', () => {
  it('requests nothing for a bare invocation, and allows staging only under the OS temp directory', () => {
    expect(cliOptions(['bun', 'build.ts'], {})).toEqual({
      allowedStageRoots: [tmpdir()],
      checkOnly: false,
      stageRoot: undefined,
      verify: false,
    })
  })

  it('maps each flag to its option', () => {
    expect(cliOptions(['bun', 'build.ts', '--check'], {})).toMatchObject({checkOnly: true, verify: false})
    expect(cliOptions(['bun', 'build.ts', '--verify'], {})).toMatchObject({checkOnly: false, verify: true})
    expect(cliOptions(['bun', 'build.ts', '--stage', '/abs/dir'], {})).toMatchObject({
      checkOnly: false,
      stageRoot: '/abs/dir',
      verify: false,
    })
    expect(cliOptions(['bun', 'build.ts', '--check', '--verify', '--stage', '/abs/dir'], {})).toEqual({
      allowedStageRoots: [tmpdir()],
      checkOnly: true,
      stageRoot: '/abs/dir',
      verify: true,
    })
  })

  it('also allows staging under RUNNER_TEMP', () => {
    expect(cliOptions(['bun', 'build.ts'], {RUNNER_TEMP: '/runner/temp'}).allowedStageRoots).toEqual([
      tmpdir(),
      '/runner/temp',
    ])
  })

  it('reads process.argv and process.env when none are given', () => {
    const originalArgv = process.argv
    const originalRunnerTemp = process.env.RUNNER_TEMP
    try {
      process.argv = ['bun', 'build.ts', '--check']
      process.env.RUNNER_TEMP = '/runner/temp'
      expect(cliOptions()).toEqual({
        allowedStageRoots: [tmpdir(), '/runner/temp'],
        checkOnly: true,
        stageRoot: undefined,
        verify: false,
      })
    } finally {
      process.argv = originalArgv
      if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP
      else process.env.RUNNER_TEMP = originalRunnerTemp
    }
  })
})

describe('stageRootAllowlist', () => {
  it('is the OS temp directory alone without RUNNER_TEMP', () => {
    expect(stageRootAllowlist({}, '/os/tmp')).toEqual(['/os/tmp'])
  })

  it('adds an absolute RUNNER_TEMP', () => {
    expect(stageRootAllowlist({RUNNER_TEMP: '/home/runner/work/_temp'}, '/os/tmp')).toEqual([
      '/os/tmp',
      '/home/runner/work/_temp',
    ])
  })

  it.each(['', 'relative/temp', '.'])('ignores a RUNNER_TEMP that is not an absolute path: %j', runnerTemp => {
    expect(stageRootAllowlist({RUNNER_TEMP: runnerTemp}, '/os/tmp')).toEqual(['/os/tmp'])
  })

  it('defaults to the real OS temp directory', () => {
    expect(stageRootAllowlist({})).toEqual([tmpdir()])
  })
})

interface StageTargetFixture {
  allowed: string
  built: string
  cleanup: () => Promise<void>
  manifestPath: string
  outside: string
  root: string
  stage: (stageRoot: string, overrides?: Partial<Parameters<typeof stagePackage>[0]>) => Promise<void>
}

/** Everything under `directory` as `path -> content` (`null` for a directory), so a test can prove nothing moved. */
async function snapshot(directory: string): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const path = join(current, entry.name)
      const key = relative(directory, path)
      if (entry.isDirectory()) {
        result[key] = null
        await walk(path)
      } else {
        result[key] = entry.isSymbolicLink() ? `-> ${await readlink(path)}` : await readFile(path, 'utf8')
      }
    }
  }
  await walk(directory)
  return result
}

// Every path in these tests is inside a directory the test owns, so a mutant that loosens a check
// can only ever touch that directory.
async function makeStageTargetFixture(): Promise<StageTargetFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wiki-write-core-stage-target-')))
  const allowed = join(root, 'allowed')
  const outside = join(root, 'outside')
  const built = join(root, 'built')
  const manifestPath = join(root, 'package', 'package.json')
  await mkdir(allowed)
  await mkdir(outside)
  await mkdir(built)
  await mkdir(join(root, 'package'))
  await writeFile(join(built, 'index.js'), 'export {}\n')
  await writeFile(manifestPath, '{"exports":{}}\n')
  await writeFile(join(root, 'package', 'README.md'), 'readme\n')
  await writeFile(join(root, 'package', 'LICENSE.md'), 'license\n')
  return {
    allowed,
    built,
    manifestPath,
    outside,
    root,
    cleanup: async () => rm(root, {force: true, recursive: true}),
    stage: async (stageRoot, overrides = {}) =>
      stagePackage({builtRoot: built, manifestPath, stageRoot, allowedStageRoots: [allowed], ...overrides}),
  }
}

const STAGE_MARKER = 'wiki-write-core-stage.marker'
const STAGE_MARKER_CONTENT = '@fro.bot/wiki-write-core staged package\n'

describe('stagePackage', () => {
  it('cleans up its staging directory and rethrows when a source file is missing', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await rm(join(fixture.root, 'package', 'LICENSE.md'))
      const target = join(fixture.allowed, 'out', 'pkg')

      await expect(fixture.stage(target)).rejects.toThrow(/ENOENT/u)
      expect(await readdir(join(fixture.allowed, 'out'))).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it('replaces a previous stage that carries the stage marker', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const target = join(fixture.allowed, 'stage')
      await mkdir(target)
      await writeFile(join(target, STAGE_MARKER), STAGE_MARKER_CONTENT)
      await writeFile(join(target, 'previous.txt'), 'old\n')

      await fixture.stage(target)

      expect((await readdir(target)).sort()).toEqual(['LICENSE.md', 'README.md', 'dist', 'package.json', STAGE_MARKER])
      expect(await readdir(fixture.allowed)).toEqual(['stage'])
    } finally {
      await fixture.cleanup()
    }
  })

  it('creates a missing parent inside an allowed root', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await fixture.stage(join(fixture.allowed, 'a', 'b', 'stage'))

      await expect(readFile(join(fixture.allowed, 'a', 'b', 'stage', STAGE_MARKER), 'utf8')).resolves.toBe(
        STAGE_MARKER_CONTENT,
      )
    } finally {
      await fixture.cleanup()
    }
  })
})

async function expectRefusal(
  fixture: StageTargetFixture,
  target: string,
  message: RegExp,
  overrides: Partial<Parameters<typeof stagePackage>[0]> = {},
): Promise<void> {
  const before = await snapshot(fixture.root)
  const replaceDirectory = vi.fn()

  await expect(fixture.stage(target, {replaceDirectory, ...overrides})).rejects.toThrow(message)

  expect(replaceDirectory).not.toHaveBeenCalled()
  expect(await snapshot(fixture.root)).toEqual(before)
}

describe('stagePackage refuses a destructive stage target before touching anything', () => {
  it('refuses a target outside every allowed root, even one that carries the stage marker', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.outside, 'victim')
      await mkdir(victim)
      await writeFile(join(victim, 'sentinel.txt'), 'keep me\n')
      await writeFile(join(victim, STAGE_MARKER), STAGE_MARKER_CONTENT)

      await expectRefusal(fixture, victim, /outside the allowed staging roots/u)
      await expect(readFile(join(victim, 'sentinel.txt'), 'utf8')).resolves.toBe('keep me\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a missing target outside every allowed root without creating its parent', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await expectRefusal(fixture, join(fixture.outside, 'new', 'deep', 'stage'), /outside the allowed staging roots/u)
      await expect(pathExists(join(fixture.outside, 'new'))).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses the allowed root itself', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await writeFile(join(fixture.allowed, 'sentinel.txt'), 'keep me\n')
      await writeFile(join(fixture.allowed, STAGE_MARKER), STAGE_MARKER_CONTENT)

      await expectRefusal(fixture, fixture.allowed, /outside the allowed staging roots/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses the parent of an allowed root', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await expectRefusal(fixture, fixture.root, /outside the allowed staging roots/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a sibling whose name merely starts with the allowed root name', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const sibling = `${fixture.allowed}-sibling`
      await mkdir(sibling)
      await writeFile(join(sibling, 'sentinel.txt'), 'keep me\n')

      await expectRefusal(fixture, join(sibling, 'stage'), /outside the allowed staging roots/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a dot-dot path that climbs out of the allowed root', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.outside, 'victim')
      await mkdir(victim)
      await writeFile(join(victim, 'sentinel.txt'), 'keep me\n')
      await writeFile(join(victim, STAGE_MARKER), STAGE_MARKER_CONTENT)

      await expectRefusal(
        fixture,
        `${fixture.allowed}/inside/../../outside/victim`,
        /outside the allowed staging roots/u,
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a target under a symlinked ancestor that leads out of the allowed root', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await symlink(fixture.outside, join(fixture.allowed, 'link'))
      await writeFile(join(fixture.outside, 'sentinel.txt'), 'keep me\n')

      await expectRefusal(fixture, join(fixture.allowed, 'link', 'stage'), /outside the allowed staging roots/u)
      await expect(pathExists(join(fixture.outside, 'stage'))).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a target that is itself a symlink leading out of the allowed root', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await writeFile(join(fixture.outside, 'sentinel.txt'), 'keep me\n')
      await writeFile(join(fixture.outside, STAGE_MARKER), STAGE_MARKER_CONTENT)
      await symlink(fixture.outside, join(fixture.allowed, 'stage'))

      await expectRefusal(fixture, join(fixture.allowed, 'stage'), /outside the allowed staging roots/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a target under a dangling symlink instead of creating the directory it points at', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await symlink(join(fixture.outside, 'not-yet'), join(fixture.allowed, 'dangling'))

      await expectRefusal(fixture, join(fixture.allowed, 'dangling', 'stage'), /dangling symlink/u)
      await expect(pathExists(join(fixture.outside, 'not-yet'))).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('accepts a target under an allowed root reached through a symlink to it', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await symlink(fixture.allowed, join(fixture.root, 'alias'))

      await fixture.stage(join(fixture.root, 'alias', 'stage'))

      await expect(readFile(join(fixture.allowed, 'stage', STAGE_MARKER), 'utf8')).resolves.toBe(STAGE_MARKER_CONTENT)
    } finally {
      await fixture.cleanup()
    }
  })

  it('accepts a target under any one of several allowed roots', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await fixture.stage(join(fixture.outside, 'stage'), {allowedStageRoots: [fixture.allowed, fixture.outside]})

      await expect(pathExists(join(fixture.outside, 'stage', STAGE_MARKER))).resolves.toBe(true)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a filesystem root as a staging root, so RUNNER_TEMP=/ cannot admit every path', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await expectRefusal(
        fixture,
        join(fixture.outside, 'stage'),
        /refusing to use .* as a staging root: it is a filesystem root/u,
        {allowedStageRoots: [fixture.allowed, parse(fixture.root).root]},
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('canonicalizes a root before judging it: a symlink to the filesystem root is refused too', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const alias = join(fixture.root, 'rootlink')
      await symlink(parse(fixture.root).root, alias)

      await expectRefusal(fixture, join(fixture.outside, 'stage'), /it is a filesystem root/u, {
        allowedStageRoots: [alias],
      })
      await expectRefusal(
        fixture,
        join(alias, relative(parse(fixture.root).root, fixture.outside), 'stage'),
        /it is a filesystem root/u,
        {
          allowedStageRoots: [fixture.allowed, alias],
        },
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a relative staging root rather than resolving it against the working directory', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await expectRefusal(
        fixture,
        join(fixture.outside, 'stage'),
        /staging root "relative\/root" must be an absolute path/u,
        {allowedStageRoots: [fixture.allowed, 'relative/root']},
      )
      await expectRefusal(fixture, join(fixture.outside, 'stage'), /staging root "" must be an absolute path/u, {
        allowedStageRoots: [''],
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses a stage that contains a hidden file or directory, which the artifact upload would drop', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await mkdir(join(fixture.built, 'nested', '.cache'), {recursive: true})
      await mkdir(join(fixture.built, '.hidden-dir'))
      await writeFile(join(fixture.built, '.env'), 'secret\n')
      await writeFile(join(fixture.built, '.hidden-dir', 'inside.js'), 'export {}\n')
      await writeFile(join(fixture.built, 'nested', '.cache', 'deep.js'), 'export {}\n')
      await writeFile(join(fixture.built, 'nested', '.npmignore'), '\n')
      await writeFile(join(fixture.built, 'nested', 'visible.js'), 'export {}\n')
      const target = join(fixture.allowed, 'stage')

      const before = await snapshot(fixture.root)

      const failure = await fixture.stage(target).then(
        () => undefined,
        (error: unknown) => error as Error,
      )

      const prefix = 'refusing to stage hidden files, which the artifact upload drops: '
      expect(failure?.message.startsWith(prefix)).toBe(true)
      expect(failure?.message.slice(prefix.length).split(', ').sort()).toEqual([
        'dist/.env',
        'dist/.hidden-dir',
        'dist/nested/.cache',
        'dist/nested/.npmignore',
      ])
      expect(await snapshot(fixture.root)).toEqual(before)
      await expect(pathExists(target)).resolves.toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('leaves the previous stage in place when the new one is refused for a hidden file', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const target = join(fixture.allowed, 'stage')
      await mkdir(target)
      await writeFile(join(target, STAGE_MARKER), STAGE_MARKER_CONTENT)
      await writeFile(join(target, 'previous.txt'), 'keep me\n')
      await writeFile(join(fixture.built, '.env'), 'secret\n')

      await expectRefusal(fixture, target, /hidden files/u)
      await expect(readFile(join(target, 'previous.txt'), 'utf8')).resolves.toBe('keep me\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses everything when no root is allowed', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await expectRefusal(fixture, join(fixture.allowed, 'stage'), /outside the allowed staging roots/u, {
        allowedStageRoots: [],
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses to replace an in-bounds directory that has no stage marker, leaving its files in place', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.allowed, 'stage')
      await mkdir(join(victim, 'nested'), {recursive: true})
      await writeFile(join(victim, 'sentinel.txt'), 'keep me\n')
      await writeFile(join(victim, 'nested', 'deep.txt'), 'keep me too\n')

      await expectRefusal(fixture, victim, /no stage marker/u)
      await expect(readFile(join(victim, 'sentinel.txt'), 'utf8')).resolves.toBe('keep me\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses to replace an in-bounds directory whose marker file has other content', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.allowed, 'stage')
      await mkdir(victim)
      await writeFile(join(victim, STAGE_MARKER), 'something else\n')
      await writeFile(join(victim, 'sentinel.txt'), 'keep me\n')

      await expectRefusal(fixture, victim, /no stage marker/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses to replace an in-bounds directory whose marker is a symlink', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.allowed, 'stage')
      await mkdir(victim)
      await writeFile(join(fixture.outside, 'real-marker'), STAGE_MARKER_CONTENT)
      await symlink(join(fixture.outside, 'real-marker'), join(victim, STAGE_MARKER))
      await writeFile(join(victim, 'sentinel.txt'), 'keep me\n')

      await expectRefusal(fixture, victim, /no stage marker/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('rethrows a failure that is not a missing path while resolving the target, rather than guessing', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      await symlink('loop', join(fixture.allowed, 'loop'))

      await expect(fixture.stage(join(fixture.allowed, 'loop'))).rejects.toMatchObject({code: 'ELOOP'})
      await expect(fixture.stage(join(fixture.allowed, 'loop', 'stage'))).rejects.toMatchObject({code: 'ELOOP'})
    } finally {
      await fixture.cleanup()
    }
  })

  it.skipIf(process.getuid?.() === 0)(
    'rethrows a failure reading the stage marker that is neither missing nor not-a-directory',
    async () => {
      const fixture = await makeStageTargetFixture()
      const victim = join(fixture.allowed, 'stage')
      try {
        await mkdir(victim)
        await writeFile(join(victim, STAGE_MARKER), STAGE_MARKER_CONTENT)
        await chmod(victim, 0o000)

        await expect(fixture.stage(victim)).rejects.toMatchObject({code: 'EACCES'})
      } finally {
        await chmod(victim, 0o755)
        await fixture.cleanup()
      }
    },
  )

  it('refuses to replace an in-bounds file', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.allowed, 'stage')
      await writeFile(victim, 'keep me\n')

      await expectRefusal(fixture, victim, /no stage marker/u)
      await expect(readFile(victim, 'utf8')).resolves.toBe('keep me\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it('names the refused target in the error', async () => {
    const fixture = await makeStageTargetFixture()
    try {
      const victim = join(fixture.outside, 'victim')

      await expect(fixture.stage(victim)).rejects.toThrow(
        `refusing to stage into ${victim}: it is outside the allowed staging roots`,
      )
      const unmarked = join(fixture.allowed, 'unmarked')
      await mkdir(unmarked)
      await expect(fixture.stage(unmarked)).rejects.toThrow(
        `refusing to replace ${unmarked}: it has no stage marker from a previous stage`,
      )
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('runBuild stage targets', () => {
  it('refuses a stage target outside the allowed roots and leaves it untouched', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      const allowed = join(fixture.root, 'allowed')
      const victim = join(fixture.root, 'victim')
      await mkdir(allowed)
      await mkdir(victim)
      await writeFile(join(victim, 'sentinel.txt'), 'keep me\n')
      await writeFile(join(victim, STAGE_MARKER), STAGE_MARKER_CONTENT)

      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          stageRoot: victim,
          allowedStageRoots: [allowed],
          runTypeScriptBuild: fixture.fakeBuild('a'),
        }),
      ).rejects.toThrow(/outside the allowed staging roots/u)

      expect((await readdir(victim)).sort()).toEqual(['sentinel.txt', STAGE_MARKER])
      await expect(readFile(join(victim, 'sentinel.txt'), 'utf8')).resolves.toBe('keep me\n')
    } finally {
      await fixture.cleanup()
    }
  })

  it.each([
    [
      'outside the allowed roots',
      async (root: string) => ({stageRoot: join(root, 'victim'), allowedStageRoots: [join(root, 'allowed')]}),
      /outside the allowed staging roots/u,
    ],
    [
      'an in-bounds directory without a stage marker',
      async (root: string) => ({stageRoot: join(root, 'victim'), allowedStageRoots: [root]}),
      /no stage marker/u,
    ],
    [
      'under a filesystem root that was allowed',
      async (root: string) => ({stageRoot: join(root, 'victim'), allowedStageRoots: [parse(root).root]}),
      /it is a filesystem root/u,
    ],
  ])(
    'validates an explicit stage target %s before building, so a refused run touches nothing',
    async (_label, options, message) => {
      const fixture = await makeRunBuildFixture()
      try {
        await mkdir(join(fixture.root, 'allowed'))
        await mkdir(join(fixture.root, 'victim'))
        await writeFile(join(fixture.root, 'victim', 'sentinel.txt'), 'keep me\n')
        await mkdir(fixture.sourceOpts.markerDirectory)
        await writeFile(
          join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'),
          '{"version":1,"sourceTreeHash":"committed"}\n',
        )
        const before = await snapshot(fixture.root)
        const build = vi.fn(fixture.fakeBuild('a'))

        await expect(
          runBuild({
            ...fixture.sourceOpts,
            ...(await options(fixture.root)),
            checkOnly: false,
            runTypeScriptBuild: build,
          }),
        ).rejects.toThrow(message)

        expect(build).not.toHaveBeenCalled()
        expect(await snapshot(fixture.root)).toEqual(before)
        await expect(readFile(join(fixture.sourceOpts.markerDirectory, 'gate-contract.json'), 'utf8')).resolves.toBe(
          '{"version":1,"sourceTreeHash":"committed"}\n',
        )
      } finally {
        await fixture.cleanup()
      }
    },
  )

  it('refuses RUNNER_TEMP=/ from the CLI options before building, with a test-owned target', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      const target = join(fixture.root, 'stage')
      const before = await snapshot(fixture.root)
      const build = vi.fn(fixture.fakeBuild('a'))

      await expect(
        runBuild({
          ...fixture.sourceOpts,
          ...cliOptions(['bun', 'build.ts', '--stage', target], {RUNNER_TEMP: '/'}),
          runTypeScriptBuild: build,
        }),
      ).rejects.toThrow(/it is a filesystem root/u)

      expect(build).not.toHaveBeenCalled()
      expect(await snapshot(fixture.root)).toEqual(before)
    } finally {
      await fixture.cleanup()
    }
  })

  it('still builds and stages when the explicit target is valid, and checks it again before replacing', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      const target = join(fixture.root, 'stage')
      const build = vi.fn(fixture.fakeBuild('a'))
      await runBuild({...fixture.sourceOpts, checkOnly: false, stageRoot: target, runTypeScriptBuild: build})
      expect(build).toHaveBeenCalledTimes(1)
      await expect(pathExists(join(target, STAGE_MARKER))).resolves.toBe(true)

      // A target that stopped carrying its marker between the early check and the replacement is refused
      // by the check inside stagePackage.
      await rm(join(target, STAGE_MARKER))
      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: false, stageRoot: target, runTypeScriptBuild: build}),
      ).rejects.toThrow(/no stage marker/u)
    } finally {
      await fixture.cleanup()
    }
  })

  it('stages into its own scratch directory when verifying, whatever roots the caller allows', async () => {
    const fixture = await makeRunBuildFixture()
    const seen: string[] = []
    try {
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: false,
        verify: true,
        allowedStageRoots: [join(fixture.root, 'elsewhere')],
        verifyPackage: async root => {
          seen.push(...(await readdir(root)))
          return {files: [], sourceTreeHash: 'a'.repeat(64), subpaths: []}
        },
        runTypeScriptBuild: fixture.fakeBuild('a'),
        write: () => {},
      })

      expect(seen).toContain(STAGE_MARKER)
    } finally {
      await fixture.cleanup()
    }
  })
})

function createHashDigest(update: (hash: Hash) => void): string {
  const hash = createHash('sha256')
  update(hash)
  return hash.digest('hex')
}
