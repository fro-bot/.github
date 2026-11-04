import {existsSync, readFileSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {findRepositoryRoot} from './repository-root.ts'

// The directory of this file is `<root>/packages/ci-checks/src`; three `dirname` steps up from it, taken from the
// file URL rather than from the module under test.
const here = dirname(fileURLToPath(import.meta.url))
const expectedRoot = dirname(dirname(dirname(here)))

describe('findRepositoryRoot', () => {
  it('is the directory three levels above the package source directory', () => {
    expect(findRepositoryRoot()).toBe(expectedRoot)
  })

  it('is an absolute path with no trailing separator', () => {
    const root = findRepositoryRoot()
    expect(isAbsolute(root)).toBe(true)
    expect(root.endsWith(sep)).toBe(false)
  })

  it('holds the files the gate reads, and not the package directory the move could have resolved to by accident', () => {
    const root = findRepositoryRoot()
    expect(existsSync(join(root, 'stryker.config.json'))).toBe(true)
    expect(existsSync(join(root, 'mutation-guards.json'))).toBe(true)
    expect(existsSync(join(root, 'packages', 'ci-checks', 'src', 'repository-root.ts'))).toBe(true)
    // `packages/ci-checks` and `packages/ci-checks/src` are the two wrong answers a one- or two-level miscount gives.
    for (const wrong of [
      join(root, 'packages', 'ci-checks'),
      join(root, 'packages', 'ci-checks', 'src'),
      join(root, 'packages'),
    ]) {
      expect(existsSync(join(wrong, 'stryker.config.json')), wrong).toBe(false)
      expect(existsSync(join(wrong, 'mutation-guards.json')), wrong).toBe(false)
    }
  })

  it('is the root manifest of the repository, not a package manifest', () => {
    const manifest = JSON.parse(readFileSync(join(findRepositoryRoot(), 'package.json'), 'utf8')) as {
      readonly name: string
      readonly workspaces: readonly string[]
    }
    expect(manifest.name).toBe('@fro-bot/.github')
    expect(manifest.workspaces).toEqual(['packages/*'])
    expect(basename(findRepositoryRoot())).not.toBe('ci-checks')
  })
})
