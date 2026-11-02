/**
 * Contract tests for the publishable shape of packages/wiki-write-core: manifest fields, the
 * LICENSE copy npm bundles, the tarball a real build and `npm pack` produce, and the Renovate
 * automerge rule that lets consumers take its minor and patch releases.
 */

import {readFileSync} from 'node:fs'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {runBuild} from './build-wiki-write-core.ts'
import {verifyStagedPackage} from './verify-wiki-write-core-package.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const packageDirectory = resolve(repositoryRoot, 'packages/wiki-write-core')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`)
  return parsed
}

const manifest = readJson(resolve(packageDirectory, 'package.json'))

// Captured from the manifest before it became publishable. The export surface is a consumer
// contract: a rename or publish-metadata change must not move it.
const EXPECTED_SUBPATHS = [
  'wiki-lint',
  'wiki-ingest',
  'private-leak',
  'private-leak-adapter',
  'schemas',
  'wiki-slug',
  'markdown-links',
  'wiki-utils',
  'data-branch-bootstrap',
  'rendering-policy',
  'frontmatter',
  'corrections',
  'corrections-survival',
]

// The repository resolves every subpath to its TypeScript source.
const EXPECTED_EXPORTS: Record<string, unknown> = {
  '.': './src/index.ts',
  ...Object.fromEntries(EXPECTED_SUBPATHS.map(subpath => [`./${subpath}`, `./src/${subpath}.ts`])),
  './package.json': './package.json',
}

// The published tarball resolves every subpath to compiled JavaScript with its declaration file.
const EXPECTED_PUBLISHED_EXPORTS: Record<string, unknown> = {
  '.': {types: './dist/index.d.ts', import: './dist/index.js'},
  ...Object.fromEntries(
    EXPECTED_SUBPATHS.map(subpath => [
      `./${subpath}`,
      {types: `./dist/${subpath}.d.ts`, import: `./dist/${subpath}.js`},
    ]),
  ),
  './package.json': './package.json',
}

describe('@fro.bot/wiki-write-core manifest', () => {
  it('publishes under the @fro.bot scope', () => {
    expect(manifest.name).toBe('@fro.bot/wiki-write-core')
  })

  it('is not private, so npm does not silently skip the publish', () => {
    expect('private' in manifest).toBe(false)
  })

  it('carries the placeholder version semantic-release replaces at publish time', () => {
    expect(manifest.version).toBe('0.0.0-semantic-release')
  })

  it('publishes publicly', () => {
    expect(manifest.publishConfig).toEqual({access: 'public'})
  })

  it('points provenance at the source repository and package directory', () => {
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/fro-bot/.github.git',
      directory: 'packages/wiki-write-core',
    })
  })

  it('declares a license, a homepage, a bug tracker and the Node floor', () => {
    expect(manifest.license).toBe('MIT')
    expect(manifest.homepage).toBe('https://github.com/fro-bot/.github/tree/main/packages/wiki-write-core#readme')
    expect(manifest.bugs).toEqual({url: 'https://github.com/fro-bot/.github/issues'})
    expect(manifest.engines).toEqual({node: '>=24'})
  })

  it('keeps the yaml range at or above the 2.8.3 floor this repository enforces', () => {
    const dependencies = manifest.dependencies
    if (!isRecord(dependencies)) throw new Error('dependencies missing')
    expect(dependencies.yaml).toBe('^2.8.3')
  })

  it('resolves every subpath to source in the repository and keeps the published files allowlist', () => {
    expect(manifest.exports).toEqual(EXPECTED_EXPORTS)
    expect(manifest.files).toEqual(['README.md', 'dist', 'package.json'])
  })
})

describe('@fro.bot/wiki-write-core LICENSE', () => {
  it('is byte-equal to the repository LICENSE.md', () => {
    const packageLicense = readFileSync(resolve(packageDirectory, 'LICENSE.md'))
    const rootLicense = readFileSync(resolve(repositoryRoot, 'LICENSE.md'))
    expect(packageLicense.equals(rootLicense)).toBe(true)
  })
})

describe('@fro.bot/wiki-write-core tarball', () => {
  let workRoot = ''
  let stageRoot = ''

  // One real build, pack and unpack: the build writes nothing into the repository tree because
  // `checkOnly` verifies the committed marker instead of rewriting it.
  beforeAll(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'wiki-write-core-package-test-'))
    stageRoot = join(workRoot, 'package')
    await runBuild({checkOnly: true, stageRoot, verify: false, write: () => {}})
  }, 120_000)

  afterAll(async () => {
    await rm(workRoot, {force: true, recursive: true})
  })

  it('carries the manifest with exports rewritten to dist, and every other manifest field unchanged', async () => {
    const staged = readJson(join(stageRoot, 'package.json'))
    expect(staged.exports).toEqual(EXPECTED_PUBLISHED_EXPORTS)
    expect(staged.files).toEqual(['README.md', 'dist', 'package.json'])
    const withoutExports = (value: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'exports'))
    expect(withoutExports(staged)).toEqual(withoutExports(manifest))
    expect(Object.keys(staged)).toEqual(Object.keys(manifest))
  })

  it('packs, unpacks and resolves, imports and type-checks every exports subpath under Node', async () => {
    const verification = await verifyStagedPackage(stageRoot)

    expect(verification.subpaths).toEqual([
      '@fro.bot/wiki-write-core',
      ...EXPECTED_SUBPATHS.map(subpath => `@fro.bot/wiki-write-core/${subpath}`),
      '@fro.bot/wiki-write-core/package.json',
    ])
    expect(verification.files).toContain('LICENSE.md')
    expect(verification.files).toContain('README.md')
    expect(verification.files).toContain('package.json')
    expect(verification.files.filter(file => file.startsWith('src/'))).toEqual([])
    for (const target of Object.values(EXPECTED_PUBLISHED_EXPORTS).flatMap(value =>
      isRecord(value) ? Object.values(value) : [],
    )) {
      expect(verification.files, String(target)).toContain(String(target).replace(/^\.\//u, ''))
    }
    expect(verification.files).toContain('dist/gate-contract.json')
    expect(verification.sourceTreeHash).toMatch(/^[0-9a-f]{64}$/u)
  }, 120_000)

  it('embeds the same source-tree hash in the exported constant and the committed marker', async () => {
    const committed = readJson(resolve(packageDirectory, 'dist', 'gate-contract.json'))
    const verification = await verifyStagedPackage(stageRoot)
    expect(committed.sourceTreeHash).toBe(verification.sourceTreeHash)
  }, 120_000)

  it('refuses a tarball that ships a file outside dist/', async () => {
    const broken = join(workRoot, 'broken-extra-file')
    await cp(stageRoot, broken, {recursive: true})
    await cp(join(packageDirectory, 'src', 'index.ts'), join(broken, 'src', 'index.ts'))
    const stagedManifest = readJson(join(broken, 'package.json'))
    await writeFile(
      join(broken, 'package.json'),
      JSON.stringify({...stagedManifest, files: ['README.md', 'dist', 'package.json', 'src']}),
    )

    await expect(verifyStagedPackage(broken)).rejects.toThrow('tarball contains files outside dist/: src/index.ts')
  }, 120_000)

  it('refuses a tarball whose export targets a file that was not packed', async () => {
    const broken = join(workRoot, 'broken-missing-target')
    await cp(stageRoot, broken, {recursive: true})
    await rm(join(broken, 'dist', 'wiki-slug.d.ts'))

    await expect(verifyStagedPackage(broken)).rejects.toThrow(
      'tarball export ./wiki-slug targets ./dist/wiki-slug.d.ts, which is not a packed dist file',
    )
  }, 120_000)

  it('refuses a tarball whose declaration file imports something that does not exist', async () => {
    const broken = join(workRoot, 'broken-declaration')
    await cp(stageRoot, broken, {recursive: true})
    const declaration = join(broken, 'dist', 'wiki-slug.d.ts')
    await writeFile(declaration, `import type {Missing} from './not-packed.js'\n${await readFile(declaration, 'utf8')}`)

    await expect(verifyStagedPackage(broken)).rejects.toThrow(
      /tarball declarations do not type-check:[\s\S]*not-packed\.js/u,
    )
  }, 120_000)
})

// Renovate's glob semantics for the two shapes this preset uses: an exact name, or `scope/**`.
function matchesPackageName(pattern: string, packageName: string): boolean {
  return pattern.endsWith('/**') ? packageName.startsWith(pattern.slice(0, -2)) : pattern === packageName
}

describe('default.json minor/patch automerge rule', () => {
  interface PackageRule {
    matchPackageNames?: string[]
    matchUpdateTypes?: string[]
    automerge?: boolean
  }

  const preset = readJson(resolve(repositoryRoot, 'default.json'))
  const rules = (Array.isArray(preset.packageRules) ? preset.packageRules : []) as PackageRule[]
  const automergeRules = rules.filter(rule => rule.automerge === true)

  function automergedUpdateTypes(packageName: string): Set<string> {
    const types = new Set<string>()
    for (const rule of automergeRules) {
      if ((rule.matchPackageNames ?? []).some(pattern => matchesPackageName(pattern, packageName))) {
        for (const updateType of rule.matchUpdateTypes ?? []) types.add(updateType)
      }
    }
    return types
  }

  it('automerges minor and patch updates of @fro.bot/wiki-write-core', () => {
    expect(automergeRules.length).toBeGreaterThan(0)
    const types = automergedUpdateTypes('@fro.bot/wiki-write-core')
    expect(types.has('minor')).toBe(true)
    expect(types.has('patch')).toBe(true)
  })

  it('does not automerge a major update of @fro.bot/wiki-write-core', () => {
    expect(automergedUpdateTypes('@fro.bot/wiki-write-core').has('major')).toBe(false)
  })

  it('does not extend the @fro-bot/** glob to the @fro.bot scope by accident', () => {
    expect(matchesPackageName('@fro-bot/**', '@fro.bot/wiki-write-core')).toBe(false)
    expect(automergedUpdateTypes('@fro.bot/some-other-package').size).toBe(0)
  })
})
