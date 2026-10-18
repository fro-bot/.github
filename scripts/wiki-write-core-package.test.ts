/**
 * Contract tests for the publishable shape of packages/wiki-write-core: manifest fields, the
 * LICENSE copy npm bundles, the exact tarball file list, and the Renovate automerge rule that
 * lets consumers take its minor and patch releases.
 */

import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

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

const EXPECTED_EXPORTS: Record<string, unknown> = {
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

  it('keeps the export map and the files allowlist unchanged', () => {
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

function packedFiles(): string[] {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDirectory,
    encoding: 'utf8',
  })
  const parsed: unknown = JSON.parse(output)
  // npm <=11 prints an array of pack results; npm 12 prints an object keyed by package name.
  const result: unknown = Array.isArray(parsed) ? parsed[0] : isRecord(parsed) ? Object.values(parsed)[0] : undefined
  if (!isRecord(result) || !Array.isArray(result.files)) {
    throw new Error('unexpected npm pack --json output')
  }
  return result.files.map((file: unknown) => {
    if (!isRecord(file) || typeof file.path !== 'string') throw new Error('unexpected npm pack file entry')
    return file.path
  })
}

describe('@fro.bot/wiki-write-core tarball', () => {
  it('lists the license, readme, manifest and every dist file reachable from exports, and nothing from src', () => {
    const files = packedFiles()

    expect(files).toContain('LICENSE.md')
    expect(files).toContain('README.md')
    expect(files).toContain('package.json')

    const exportTargets = Object.values(EXPECTED_EXPORTS).flatMap(value =>
      isRecord(value) ? Object.values(value) : [],
    )
    expect(exportTargets.length).toBeGreaterThan(0)
    for (const target of exportTargets) {
      expect(files, String(target)).toContain(String(target).replace(/^\.\//u, ''))
    }

    expect(files.filter(file => file.startsWith('src/'))).toEqual([])
    expect(
      files.every(file => ['LICENSE.md', 'README.md', 'package.json'].includes(file) || file.startsWith('dist/')),
    ).toBe(true)
  })
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
