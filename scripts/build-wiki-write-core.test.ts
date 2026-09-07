import type {execFileSync} from 'node:child_process'
import {execFileSync as execFileSyncReal} from 'node:child_process'
import {createHash, type Hash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, dirname, join, relative, resolve, sep} from 'node:path'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'

import {GATE_CONTRACT_VERSION} from '../packages/wiki-write-core/src/gate-contract.ts'
import {
  buildConfig,
  collectFiles,
  compareTrees,
  computeSourceTreeHash,
  distRoot,
  embedSourceTreeHash,
  isFileNotFoundError,
  isRecord,
  packageManifest,
  parsePackageManifest,
  pathExists,
  replaceDirectoryAtomically,
  reportFatalError,
  repositoryRoot,
  resolveBuildConfig,
  resolveCheckOnly,
  rewriteDeclarationExtensions,
  runBuild,
  runTypeScriptBuild,
  sourceHashPlaceholder,
  sourceRoot,
  stableJson,
  updateHash,
  writeGateContractMarker,
} from './build-wiki-write-core.ts'

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

  it.each([
    ['modified', async (root: string) => writeFile(join(root, 'entry.js'), 'export const value = 2\n')],
    ['added', async (root: string) => writeFile(join(root, 'added.js'), 'export const added = true\n')],
    ['deleted', async (root: string) => rm(join(root, 'entry.js'))],
  ])('names a %s file when comparing distribution trees', async (_change, mutate) => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-left-'))
    const right = await mkdtemp(join(tmpdir(), 'wiki-write-core-right-'))

    try {
      await writeFile(join(left, 'entry.js'), 'export const value = 1\n')
      await writeFile(join(right, 'entry.js'), 'export const value = 1\n')
      await mutate(right)

      await expect(compareTrees(left, right)).resolves.toContain(_change === 'added' ? 'added.js' : 'entry.js')
    } finally {
      await rm(left, {force: true, recursive: true})
      await rm(right, {force: true, recursive: true})
    }
  })

  it('treats a missing comparison root as empty', async () => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-left-'))
    const missing = join(left, 'missing')

    try {
      await writeFile(join(left, 'entry.js'), 'export const value = 1\n')

      await expect(compareTrees(left, missing)).resolves.toEqual(['entry.js'])
    } finally {
      await rm(left, {force: true, recursive: true})
    }
  })

  it('returns differences sorted by path, not by discovery order', async () => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-sort-left-'))
    const right = await mkdtemp(join(tmpdir(), 'wiki-write-core-sort-right-'))

    try {
      await writeFile(join(left, 'z-only-left.js'), 'left\n')
      await writeFile(join(right, 'a-only-right.js'), 'right\n')

      await expect(compareTrees(left, right)).resolves.toEqual(['a-only-right.js', 'z-only-left.js'])
    } finally {
      await rm(left, {force: true, recursive: true})
      await rm(right, {force: true, recursive: true})
    }
  })

  it('rethrows a non-ENOENT read failure instead of treating it as a difference', async () => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-eisdir-left-'))
    const right = await mkdtemp(join(tmpdir(), 'wiki-write-core-eisdir-right-'))

    try {
      // A directory where a file is expected fails with EISDIR, not ENOENT — compareTrees must
      // propagate this, not silently record "entry" as a content difference.
      await mkdir(join(left, 'entry'))
      await writeFile(join(right, 'entry'), 'content\n')

      await expect(compareTrees(left, right)).rejects.toMatchObject({code: 'EISDIR'})
    } finally {
      await rm(left, {force: true, recursive: true})
      await rm(right, {force: true, recursive: true})
    }
  })

  it('rethrows a non-ENOENT read failure on the right tree too', async () => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-eisdir-right-left-'))
    const right = await mkdtemp(join(tmpdir(), 'wiki-write-core-eisdir-right-right-'))

    try {
      await writeFile(join(left, 'entry'), 'content\n')
      await mkdir(join(right, 'entry'))

      await expect(compareTrees(left, right)).rejects.toMatchObject({code: 'EISDIR'})
    } finally {
      await rm(left, {force: true, recursive: true})
      await rm(right, {force: true, recursive: true})
    }
  })

  it('names every differing file, joined one per line, when there are several', async () => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-multi-diff-left-'))
    const right = await mkdtemp(join(tmpdir(), 'wiki-write-core-multi-diff-right-'))

    try {
      await writeFile(join(left, 'a.js'), 'left-a\n')
      await writeFile(join(left, 'b.js'), 'left-b\n')

      const differences = await compareTrees(left, right)
      expect(differences).toEqual(['a.js', 'b.js'])
    } finally {
      await rm(left, {force: true, recursive: true})
      await rm(right, {force: true, recursive: true})
    }
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

  it('rethrows a non-ENOENT failure from a missing-tolerant right-tree scan (compareTrees)', async () => {
    const left = await mkdtemp(join(tmpdir(), 'wiki-write-core-if-present-enotdir-left-'))
    const parent = await mkdtemp(join(tmpdir(), 'wiki-write-core-if-present-enotdir-right-'))
    const blocker = join(parent, 'blocker-file')
    const right = join(blocker, 'dist')

    try {
      // Deliberately empty: if left has no files, `allPaths` is empty whenever
      // collectFilesIfPresent wrongly swallows the error and resolves to `[]`, so the loop never
      // runs and no per-file readFile call gets a chance to independently rethrow the same
      // ENOTDIR — the only way this test can observe a rejection is via collectFilesIfPresent's
      // own rethrow.
      await writeFile(blocker, 'not a directory\n')

      // `right` is missing, but for a reason other than ENOENT (a path component is a file, not
      // a directory) — collectFilesIfPresent must propagate ENOTDIR, not silently treat this the
      // same as a genuinely absent comparison root.
      await expect(compareTrees(left, right)).rejects.toMatchObject({code: 'ENOTDIR'})
    } finally {
      await rm(left, {force: true, recursive: true})
      await rm(parent, {force: true, recursive: true})
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

  it('propagates the restore failure and still cleans up the backup when the restore rename itself fails', async () => {
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
      // Call 3: backup -> target, the catch block's own restore attempt (fails too) -- this is
      // the path where targetMoved's `= false` reset is never reached before finally runs.
      const failingRename: typeof rename = async (from, to) => {
        renameCalls++
        if (renameCalls === 1) {
          await rename(from, to)
          return
        }
        throw new Error(`simulated failure on call ${renameCalls}`)
      }

      await expect(replaceDirectoryAtomically(source, target, failingRename)).rejects.toThrow(
        'simulated failure on call 3',
      )

      // The finally block's `if (targetMoved)` cleanup must still run without throwing its own
      // ENOENT (proving targetMoved and backup's existence stayed in agreement even though the
      // `targetMoved = false` reset was skipped): no leftover backup directory remains.
      const remainingEntries = await readdir(root)
      const leftoverBackups = remainingEntries.filter(name => name.startsWith('.wiki-write-core-dist-backup-'))
      expect(leftoverBackups).toEqual([])
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
        'pnpm',
        ['exec', 'tsc', '--showConfig', '--project', '/repo/tsconfig.build.json', '--pretty', 'false'],
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

  it('resolves the module build paths against the repository root', () => {
    expect(repositoryRoot()).toBe(resolve(import.meta.dirname, '..'))
    expect(relative(repositoryRoot(), sourceRoot())).toBe(join('packages', 'wiki-write-core', 'src'))
    expect(relative(repositoryRoot(), distRoot())).toBe(join('packages', 'wiki-write-core', 'dist'))
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
        'pnpm',
        ['exec', 'tsc', '--project', '/repo/tsconfig.build.json', '--outDir', '/tmp/out-dir', '--pretty', 'false'],
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
        'pnpm',
        ['exec', 'tsc', '--project', buildConfig(), '--outDir', '/tmp/out-dir', '--pretty', 'false'],
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
  sourceOpts: {buildConfigPath: string; distRoot: string; manifestPath: string; sourceRoot: string}
}> {
  const root = await mkdtemp(join(tmpdir(), 'wiki-write-core-runbuild-'))
  const sourceDir = join(root, 'src')
  const buildConfigPath = join(root, 'tsconfig.build.json')
  const manifestPath = join(root, 'package.json')
  const distDir = join(root, 'dist')

  await mkdir(sourceDir)
  await writeFile(join(sourceDir, 'index.ts'), 'export const value = 1\n')
  await writeFile(buildConfigPath, '{}\n')
  await writeFile(manifestPath, '{"files":["dist"],"exports":"./index.js"}\n')

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
    sourceOpts: {sourceRoot: sourceDir, buildConfigPath, manifestPath, distRoot: distDir},
    fakeBuild,
    cleanup: async () => rm(root, {force: true, recursive: true}),
  }
}

describe('runBuild', () => {
  it('builds a fresh dist directory (no prior dist) and a subsequent --check run finds it up to date', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})
      await expect(readFile(join(fixture.sourceOpts.distRoot, 'index.js'), 'utf8')).resolves.toContain("variant = 'a'")

      const messages: string[] = []
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: true,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        write: message => messages.push(message),
      })
      expect(messages).toEqual(['wiki-write-core dist is up to date\n'])
    } finally {
      await fixture.cleanup()
    }
  })

  it('rebuilds over an already-existing dist directory', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await mkdir(fixture.sourceOpts.distRoot)
      await writeFile(join(fixture.sourceOpts.distRoot, 'stale.js'), 'export const stale = true\n')

      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})

      await expect(readFile(join(fixture.sourceOpts.distRoot, 'index.js'), 'utf8')).resolves.toContain("variant = 'a'")
      await expect(
        readFile(join(fixture.sourceOpts.distRoot, 'stale.js'), 'utf8').catch(() => undefined),
      ).resolves.toBeUndefined()
    } finally {
      await fixture.cleanup()
    }
  })

  it('--check throws naming the stale file when the built output differs from committed dist', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})

      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: true, runTypeScriptBuild: fixture.fakeBuild('b')}),
      ).rejects.toThrow(/wiki-write-core dist is stale:\n- index\.js/)
    } finally {
      await fixture.cleanup()
    }
  })

  it('--check joins every stale file on its own line, one "- path" entry per line', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')})

      const buildWithExtraFile = (outputDirectory: string) => {
        fixture.fakeBuild('b')(outputDirectory)
        writeFileSync(join(outputDirectory, 'extra.js'), 'export const extra = true\n', 'utf8')
      }

      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: true, runTypeScriptBuild: buildWithExtraFile}),
      ).rejects.toThrow('wiki-write-core dist is stale:\n- extra.js\n- index.js')
    } finally {
      await fixture.cleanup()
    }
  })

  it('propagates a build failure and still removes the temporary build directory', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      const parentBefore = await readdir(dirname(fixture.sourceOpts.distRoot))

      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          runTypeScriptBuild: () => {
            throw new Error('simulated tsc failure')
          },
        }),
      ).rejects.toThrow('simulated tsc failure')

      const parentAfter = await readdir(dirname(fixture.sourceOpts.distRoot))
      const leftoverTempDirs = parentAfter.filter(
        name => name.startsWith('.wiki-write-core-dist-') && !parentBefore.includes(name),
      )
      expect(leftoverTempDirs).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it('defaults checkOnly from resolveCheckOnly() (no --check in argv) when omitted', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await runBuild({...fixture.sourceOpts, runTypeScriptBuild: fixture.fakeBuild('a')})
      await expect(readFile(join(fixture.sourceOpts.distRoot, 'index.js'), 'utf8')).resolves.toContain("variant = 'a'")
    } finally {
      await fixture.cleanup()
    }
  })

  it('does not attempt to remove the temporary build directory once replaceDirectory has consumed it', async () => {
    const fixture = await makeRunBuildFixture()
    const removeDirectory = vi.fn(rm)
    try {
      await runBuild({
        ...fixture.sourceOpts,
        checkOnly: false,
        runTypeScriptBuild: fixture.fakeBuild('a'),
        removeDirectory,
      })
      expect(removeDirectory).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('removes the temporary build directory with force and recursive when it still owns it', async () => {
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

  it('propagates a replaceDirectory failure verbatim even when it already consumed the temporary build directory', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      const consumeThenFail = async (source: string) => {
        await rm(source, {recursive: true})
        throw new Error('simulated replaceDirectory failure')
      }

      await expect(
        runBuild({
          ...fixture.sourceOpts,
          checkOnly: false,
          runTypeScriptBuild: fixture.fakeBuild('a'),
          replaceDirectory: consumeThenFail,
        }),
      ).rejects.toThrow('simulated replaceDirectory failure')
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
      expect(writeSpy).toHaveBeenCalledWith('wiki-write-core dist is up to date\n')
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
      })
      const marker = JSON.parse(await readFile(join(fixture.sourceOpts.distRoot, 'gate-contract.json'), 'utf8')) as {
        sourceTreeHash: string
      }
      expect(marker.sourceTreeHash).toBe(expectedHash)
    } finally {
      await fixture.cleanup()
    }
  })

  it('refuses to build over a pre-existing dist directory that contains a symlink', async () => {
    const fixture = await makeRunBuildFixture()
    try {
      await mkdir(fixture.sourceOpts.distRoot)
      await writeFile(join(fixture.sourceOpts.distRoot, 'entry.js'), 'export {}\n')
      await symlink('entry.js', join(fixture.sourceOpts.distRoot, 'link.js'))

      await expect(
        runBuild({...fixture.sourceOpts, checkOnly: false, runTypeScriptBuild: fixture.fakeBuild('a')}),
      ).rejects.toThrow(/symlink is not allowed in wiki-write-core dist/)
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
