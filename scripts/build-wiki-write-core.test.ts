import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {collectFiles, computeSourceTreeHash} from './build-wiki-write-core.ts'

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
    const configPath = join(root, 'tsconfig.build.json')
    const manifestPath = join(root, 'package.json')

    try {
      await mkdir(sourceRoot)
      await writeFile(join(sourceRoot, 'index.ts'), 'export const value = 1\n')
      await writeFile(join(sourceRoot, 'index.test.ts'), 'export const testOnly = 1\n')
      await writeFile(configPath, '{"compilerOptions":{"declaration":true}}\n')
      await writeFile(
        manifestPath,
        `${JSON.stringify({
          exports: {'.': {import: './dist/index.js'}, './extra': './dist/extra.js'},
          files: ['dist', 'README.md'],
        })}\n`,
      )

      const baseline = await computeSourceTreeHash({manifestPath, sourceRoot, buildConfigPath: configPath})

      await writeFile(
        manifestPath,
        `${JSON.stringify({
          files: ['README.md', 'dist'],
          exports: {'./extra': './dist/extra.js', '.': {import: './dist/index.js'}},
        })}\n`,
      )
      const reordered = await computeSourceTreeHash({manifestPath, sourceRoot, buildConfigPath: configPath})
      expect(reordered).toBe(baseline)

      await writeFile(configPath, '{"compilerOptions":{"declaration":false}}\n')
      const configChanged = await computeSourceTreeHash({manifestPath, sourceRoot, buildConfigPath: configPath})
      expect(configChanged).not.toBe(baseline)

      await writeFile(configPath, '{"compilerOptions":{"declaration":true}}\n')
      await writeFile(
        manifestPath,
        `${JSON.stringify({
          exports: {'.': {import: './dist/changed.js'}, './extra': './dist/extra.js'},
          files: ['dist', 'README.md'],
        })}\n`,
      )
      const exportsChanged = await computeSourceTreeHash({manifestPath, sourceRoot, buildConfigPath: configPath})
      expect(exportsChanged).not.toBe(baseline)

      await writeFile(join(sourceRoot, 'index.test.ts'), 'export const testOnly = 2\n')
      const unrelatedChanged = await computeSourceTreeHash({manifestPath, sourceRoot, buildConfigPath: configPath})
      expect(unrelatedChanged).toBe(exportsChanged)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
