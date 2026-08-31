import {mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {
  collectFiles,
  compareTrees,
  computeSourceTreeHash,
  embedSourceTreeHash,
  parsePackageManifest,
  replaceDirectoryAtomically,
  resolveBuildConfig,
  rewriteDeclarationExtensions,
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

      await writeFile(join(sourceRoot, 'index.test.ts'), 'export const testOnly = 2\n')
      const unrelatedChanged = await computeSourceTreeHash({
        manifestPath,
        sourceRoot,
        buildConfigPath: configPath,
        resolvedBuildConfig: originalResolvedConfig,
      })
      expect(unrelatedChanged).toBe(exportsChanged)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
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

      await expect(compareTrees(left, right)).resolves.toEqual(expect.arrayContaining([expect.any(String)]))
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

      await rewriteDeclarationExtensions(root)

      await expect(readFile(join(root, 'entry.d.ts'), 'utf8')).resolves.toBe(
        [
          "export type {Thing} from './thing.js'",
          "type Imported = import('./imported.js').Thing",
          "declare const path: './literal.ts'",
          '',
        ].join('\n'),
      )
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
