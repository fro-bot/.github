import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {builtinModules} from 'node:module'
import {join, posix, resolve} from 'node:path'

import {describe, expect, it} from 'vitest'
import {parse as parseYaml} from 'yaml'
import {stripComments} from './check-mutation-guards.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const packagesRoot = join(repositoryRoot, 'packages')

/** Packages published to npm. They keep their own layout and are exempt from the private-package rules. */
const PUBLISHED_PACKAGE_DIRS: ReadonlySet<string> = new Set(['wiki-write-core'])
const PRIVATE_SCOPE = '@fro-bot/'
const TEST_KIT_NAME = '@fro-bot/test-kit'
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

interface SourceFileFacts {
  /** Repo-relative path, for example `packages/core/src/guards.ts`. */
  readonly path: string
  readonly isTest: boolean
  /** Every module specifier the file imports, re-exports or mocks, as written. */
  readonly specifiers: readonly string[]
}

interface PackageFacts {
  /** Directory name under `packages/`. */
  readonly dir: string
  readonly manifest: unknown
  readonly hasReadme: boolean
  /** Every file in the package directory, repo-relative, so an `exports` target can be checked. */
  readonly filePaths: ReadonlySet<string>
  readonly files: readonly SourceFileFacts[]
}

interface LayoutInput {
  readonly packages: readonly PackageFacts[]
  /** The root manifest's `dependencies` and `devDependencies`, merged. */
  readonly rootDependencies: Readonly<Record<string, string>>
  /** The `workspaces` object of `bun.lock`, keyed by workspace path (`''`, `packages/core`, ...). */
  readonly lockWorkspaces: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function sortedEntries(map: Readonly<Record<string, string>>): [string, string][] {
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
}

function manifestName(facts: PackageFacts): string | undefined {
  return isRecord(facts.manifest) && typeof facts.manifest.name === 'string' ? facts.manifest.name : undefined
}

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(packageNameOf(specifier))
}

/**
 * The module specifiers a source file names: static `from`, re-exports, side-effect imports, dynamic
 * `import()` and the `vi.mock` family. This is a textual scan of comment-stripped content, so an
 * import-shaped string literal counts too, which can only add a declaration check, never skip one.
 */
const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock|importActual|importMock)\(\s*)['"]([^'"\n]+)['"]/gu

function importSpecifiers(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_SPECIFIER_PATTERN)].map(match => match[1] ?? '')
}

function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts')
}

/** Finds a dependency cycle among the workspace packages, or `undefined`. */
function findCycle(edges: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const finished = new Set<string>()
  const stack: string[] = []

  const visit = (node: string): string[] | undefined => {
    const onStack = stack.indexOf(node)
    if (onStack !== -1) return [...stack.slice(onStack), node]
    if (finished.has(node)) return undefined
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next)
      if (cycle !== undefined) return cycle
    }
    stack.pop()
    finished.add(node)
    return undefined
  }

  for (const node of edges.keys()) {
    const cycle = visit(node)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/**
 * Every layout rule for the `packages/` tree. Pure over an explicit input so each rule is
 * exercised with a fixture; the repo-wide test below assembles the input from disk.
 *
 * Frozen install passes when a manifest adds a dependency the lock already holds, or swaps
 * `workspace:*` for a range that matches the workspace version, so the lock comparison here is the
 * only gate on that drift. ESLint `node-dependencies/compat-engines` skips `workspace:*`, so this
 * is the only check on internal edges too.
 */
export function findPackageLayoutViolations(input: LayoutInput): string[] {
  const violations: string[] = []
  const workspaceNames = new Set(input.packages.map(manifestName).filter((name): name is string => name !== undefined))
  const lockWorkspaces = isRecord(input.lockWorkspaces) ? input.lockWorkspaces : {}
  const graph = new Map<string, string[]>()

  for (const facts of input.packages) {
    const root = `packages/${facts.dir}`
    const manifest = isRecord(facts.manifest) ? facts.manifest : {}
    const name = manifestName(facts)
    const declared = Object.fromEntries(DEPENDENCY_FIELDS.map(field => [field, stringMap(manifest[field])]))
    const dependencies = declared.dependencies ?? {}
    const devDependencies = declared.devDependencies ?? {}
    const allDeclared = Object.assign({}, ...Object.values(declared)) as Record<string, string>

    if (name !== undefined) {
      graph.set(
        name,
        Object.keys(allDeclared).filter(dependency => workspaceNames.has(dependency)),
      )
    }

    if (PUBLISHED_PACKAGE_DIRS.has(facts.dir)) {
      for (const dependency of Object.keys(allDeclared)) {
        if (dependency.startsWith(PRIVATE_SCOPE)) {
          violations.push(`${root}: the published package depends on the private package ${dependency}`)
        }
      }
      continue
    }

    if (name !== `${PRIVATE_SCOPE}${facts.dir}`) {
      violations.push(`${root}: name must be ${PRIVATE_SCOPE}${facts.dir}, got ${String(name)}`)
    }
    if (manifest.private !== true) violations.push(`${root}: package.json must set "private": true`)
    if (manifest.type !== 'module') violations.push(`${root}: package.json must set "type": "module"`)
    if (!facts.hasReadme) violations.push(`${root}: README.md is missing`)

    const exportsMap = isRecord(manifest.exports) ? manifest.exports : undefined
    if (exportsMap === undefined) {
      violations.push(`${root}: package.json needs a subpath "exports" map`)
    } else {
      for (const [key, target] of Object.entries(exportsMap)) {
        if (typeof target !== 'string' || !/^\.\/src\/[\w./-]+\.ts$/u.test(target)) {
          violations.push(`${root}: exports "${key}" must be a plain string path to ./src/*.ts`)
        } else if (!facts.filePaths.has(posix.join(root, target))) {
          violations.push(`${root}: exports "${key}" points at ${target}, which does not exist`)
        }
      }
    }

    for (const [dependency, range] of Object.entries(allDeclared)) {
      if (workspaceNames.has(dependency) && range !== 'workspace:*') {
        violations.push(`${root}: internal dependency ${dependency} must be "workspace:*", got "${range}"`)
      }
    }
    if (TEST_KIT_NAME in dependencies) {
      violations.push(`${root}: ${TEST_KIT_NAME} belongs in devDependencies, not dependencies`)
    }

    for (const file of facts.files) {
      const fileDir = posix.dirname(file.path)
      for (const specifier of file.specifiers) {
        if (isRelative(specifier)) {
          const target = posix.normalize(posix.join(fileDir, specifier))
          if (target !== root && !target.startsWith(`${root}/`)) {
            violations.push(`${file.path}: relative import "${specifier}" leaves ${root}`)
          }
          continue
        }
        if (isNodeBuiltin(specifier)) continue

        const dependency = packageNameOf(specifier)
        const isWorkspace = dependency.startsWith(PRIVATE_SCOPE) || workspaceNames.has(dependency)

        if (dependency === TEST_KIT_NAME && !file.isTest) {
          violations.push(`${file.path}: a non-test module must not import ${TEST_KIT_NAME}`)
          continue
        }
        if (isWorkspace) {
          const declaredHere = file.isTest ? dependency in allDeclared : dependency in dependencies
          if (!declaredHere) {
            const where = file.isTest ? 'dependencies or devDependencies' : 'dependencies'
            violations.push(`${file.path}: imports ${dependency}, which is not declared in ${where}`)
          }
          if (dependency === TEST_KIT_NAME && !(dependency in devDependencies)) {
            violations.push(`${file.path}: ${TEST_KIT_NAME} must be declared in devDependencies`)
          }
          continue
        }
        if (file.isTest) continue

        const range = dependencies[dependency]
        if (range === undefined) {
          violations.push(`${file.path}: imports ${dependency}, which is not declared in dependencies`)
          continue
        }
        const rootRange = input.rootDependencies[dependency]
        if (rootRange !== undefined && range !== rootRange) {
          violations.push(
            `${root}: ${dependency} is declared as "${range}" but the root declares "${rootRange}"; use the root range`,
          )
        }
      }
    }

    const lockEntry = lockWorkspaces[root]
    if (!isRecord(lockEntry)) {
      violations.push(`bun.lock: no workspace entry for ${root}; run bun install`)
      continue
    }
    if (lockEntry.name !== name) {
      violations.push(`bun.lock: ${root} is named ${String(lockEntry.name)} but package.json says ${String(name)}`)
    }
    if (lockEntry.version !== manifest.version) {
      violations.push(
        `bun.lock: ${root} is version ${String(lockEntry.version)} but package.json says ${String(manifest.version)}`,
      )
    }
    for (const field of DEPENDENCY_FIELDS) {
      const fromManifest = declared[field] ?? {}
      const fromLock = stringMap(lockEntry[field])
      if (JSON.stringify(sortedEntries(fromManifest)) !== JSON.stringify(sortedEntries(fromLock))) {
        violations.push(
          `bun.lock: ${root} ${field} differ from package.json (manifest ${JSON.stringify(fromManifest)}, lock ${JSON.stringify(fromLock)}); run bun install`,
        )
      }
    }
  }

  const packagePaths = new Set(input.packages.map(facts => `packages/${facts.dir}`))
  for (const key of Object.keys(lockWorkspaces)) {
    if (key.startsWith('packages/') && !packagePaths.has(key)) {
      violations.push(`bun.lock: workspace entry ${key} has no package directory; run bun install`)
    }
  }

  const cycle = findCycle(graph)
  if (cycle !== undefined) violations.push(`package dependency cycle: ${cycle.join(' -> ')}`)

  return violations
}

// ---------------------------------------------------------------------------
// Fixtures for the pure rules
// ---------------------------------------------------------------------------

function sourceFile(path: string, content: string): SourceFileFacts {
  return {path, isTest: isTestFile(path), specifiers: importSpecifiers(content)}
}

interface FixturePackageOptions {
  readonly manifest?: Record<string, unknown>
  readonly hasReadme?: boolean
  readonly files?: readonly SourceFileFacts[]
  readonly extraPaths?: readonly string[]
}

function fixturePackage(dir: string, options: FixturePackageOptions = {}): PackageFacts {
  const manifest = {
    name: `${PRIVATE_SCOPE}${dir}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: {'./guards': './src/guards.ts'},
    ...options.manifest,
  }
  const files = options.files ?? [sourceFile(`packages/${dir}/src/guards.ts`, 'export const a = 1')]
  return {
    dir,
    manifest,
    hasReadme: options.hasReadme ?? true,
    filePaths: new Set([...files.map(file => file.path), ...(options.extraPaths ?? [])]),
    files,
  }
}

function lockFor(...entries: [string, Record<string, unknown>][]): Record<string, unknown> {
  return {'': {name: '@fro-bot/.github'}, ...Object.fromEntries(entries)}
}

const CLEAN_LOCK_ENTRY = {name: '@fro-bot/core', version: '0.0.0'}

function layout(packages: PackageFacts[], lock: Record<string, unknown>, rootDependencies = {}): LayoutInput {
  return {packages, rootDependencies, lockWorkspaces: lock}
}

describe('findPackageLayoutViolations', () => {
  it('accepts a private, module, source-exporting package that matches its lock entry', () => {
    const input = layout([fixturePackage('core')], lockFor(['packages/core', CLEAN_LOCK_ENTRY]))
    expect(findPackageLayoutViolations(input)).toEqual([])
  })

  it('rejects a package that is not private, not a module, has no README or has a mismatched name', () => {
    const input = layout(
      [
        fixturePackage('core', {
          manifest: {private: false, type: 'commonjs', name: '@fro-bot/other'},
          hasReadme: false,
        }),
      ],
      lockFor(['packages/core', {...CLEAN_LOCK_ENTRY, name: '@fro-bot/other'}]),
    )
    const violations = findPackageLayoutViolations(input)
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"private": true'),
        expect.stringContaining('"type": "module"'),
        expect.stringContaining('README.md is missing'),
        expect.stringContaining('name must be @fro-bot/core'),
      ]),
    )
  })

  it('rejects an exports entry that is not a string path to existing ./src source', () => {
    const exportsMap = {'./a': {import: './src/guards.ts'}, './b': './dist/b.js', './c': './src/missing.ts'}
    const violations = findPackageLayoutViolations(
      layout([fixturePackage('core', {manifest: {exports: exportsMap}})], lockFor(['packages/core', CLEAN_LOCK_ENTRY])),
    )
    expect(violations).toEqual([
      'packages/core: exports "./a" must be a plain string path to ./src/*.ts',
      'packages/core: exports "./b" must be a plain string path to ./src/*.ts',
      'packages/core: exports "./c" points at ./src/missing.ts, which does not exist',
    ])
  })

  it('rejects a package with no exports map', () => {
    const violations = findPackageLayoutViolations(
      layout([fixturePackage('core', {manifest: {exports: undefined}})], lockFor(['packages/core', CLEAN_LOCK_ENTRY])),
    )
    expect(violations).toEqual(['packages/core: package.json needs a subpath "exports" map'])
  })

  describe('internal dependencies', () => {
    const consumer = (manifest: Record<string, unknown>, content: string): PackageFacts =>
      fixturePackage('registry', {
        manifest,
        files: [sourceFile('packages/registry/src/run.ts', content)],
        extraPaths: ['packages/registry/src/guards.ts'],
      })
    const registryExports = {exports: {'./run': './src/run.ts'}}
    const lock = (dependencies: Record<string, string>): Record<string, unknown> =>
      lockFor(
        ['packages/core', CLEAN_LOCK_ENTRY],
        ['packages/registry', {name: '@fro-bot/registry', version: '0.0.0', dependencies}],
      )

    it('accepts a declared workspace:* dependency', () => {
      const dependencies = {'@fro-bot/core': 'workspace:*'}
      const input = layout(
        [
          fixturePackage('core'),
          consumer({...registryExports, dependencies}, `import {a} from '@fro-bot/core/guards'`),
        ],
        lock(dependencies),
      )
      expect(findPackageLayoutViolations(input)).toEqual([])
    })

    it('rejects an import of a @fro-bot/ package that is not declared', () => {
      const input = layout(
        [fixturePackage('core'), consumer(registryExports, `import {a} from '@fro-bot/core/guards'`)],
        lock({}),
      )
      expect(findPackageLayoutViolations(input)).toEqual([
        'packages/registry/src/run.ts: imports @fro-bot/core, which is not declared in dependencies',
      ])
    })

    it('rejects an import of the published package that is not declared', () => {
      const published = fixturePackage('wiki-write-core', {manifest: {name: '@fro.bot/wiki-write-core'}})
      const input = layout(
        [
          fixturePackage('core'),
          published,
          consumer(registryExports, `import {a} from '@fro.bot/wiki-write-core/schemas'`),
        ],
        lock({}),
      )
      expect(findPackageLayoutViolations(input)).toEqual([
        'packages/registry/src/run.ts: imports @fro.bot/wiki-write-core, which is not declared in dependencies',
      ])
    })

    it.each(['^0.0.0', '0.0.0', 'file:../core', '*'])('rejects an internal dependency declared as "%s"', range => {
      const dependencies = {'@fro-bot/core': range}
      const input = layout(
        [
          fixturePackage('core'),
          consumer({...registryExports, dependencies}, `import {a} from '@fro-bot/core/guards'`),
        ],
        lock(dependencies),
      )
      expect(findPackageLayoutViolations(input)).toEqual([
        `packages/registry: internal dependency @fro-bot/core must be "workspace:*", got "${range}"`,
      ])
    })

    it('rejects a package that depends on the published package by a range', () => {
      const published = fixturePackage('wiki-write-core', {manifest: {name: '@fro.bot/wiki-write-core'}})
      const dependencies = {'@fro.bot/wiki-write-core': '^1.0.0'}
      const input = layout(
        [published, consumer({...registryExports, dependencies}, `import {a} from '@fro.bot/wiki-write-core'`)],
        lockFor(['packages/registry', {name: '@fro-bot/registry', version: '0.0.0', dependencies}]),
      )
      expect(findPackageLayoutViolations(input)).toEqual([
        'packages/registry: internal dependency @fro.bot/wiki-write-core must be "workspace:*", got "^1.0.0"',
      ])
    })

    it('rejects a published package that depends on a private package', () => {
      const published = fixturePackage('wiki-write-core', {
        manifest: {name: '@fro.bot/wiki-write-core', dependencies: {'@fro-bot/core': 'workspace:*'}},
      })
      const violations = findPackageLayoutViolations(
        layout([fixturePackage('core'), published], lockFor(['packages/core', CLEAN_LOCK_ENTRY])),
      )
      expect(violations).toEqual([
        'packages/wiki-write-core: the published package depends on the private package @fro-bot/core',
      ])
    })

    it('requires a workspace dependency used only by tests to be declared, as a devDependency or a dependency', () => {
      const testFile = sourceFile('packages/registry/src/run.test.ts', `import {a} from '@fro-bot/core/guards'`)
      const base = fixturePackage('registry', {
        manifest: registryExports,
        files: [testFile],
        extraPaths: ['packages/registry/src/run.ts'],
      })
      expect(findPackageLayoutViolations(layout([fixturePackage('core'), base], lock({})))).toEqual([
        'packages/registry/src/run.test.ts: imports @fro-bot/core, which is not declared in dependencies or devDependencies',
      ])

      const devDependencies = {'@fro-bot/core': 'workspace:*'}
      const declared = fixturePackage('registry', {
        manifest: {...registryExports, devDependencies},
        files: [testFile],
        extraPaths: ['packages/registry/src/run.ts'],
      })
      const declaredLock = lockFor(
        ['packages/core', CLEAN_LOCK_ENTRY],
        ['packages/registry', {name: '@fro-bot/registry', version: '0.0.0', devDependencies}],
      )
      expect(findPackageLayoutViolations(layout([fixturePackage('core'), declared], declaredLock))).toEqual([])
    })
  })

  describe('test-kit', () => {
    const kitLock = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
      lockFor(
        ['packages/test-kit', {name: '@fro-bot/test-kit', version: '0.0.0'}],
        ['packages/core', {...CLEAN_LOCK_ENTRY, ...extra}],
      )
    const kit = fixturePackage('test-kit')
    const core = (files: SourceFileFacts[], manifest: Record<string, unknown>): PackageFacts =>
      fixturePackage('core', {manifest, files, extraPaths: ['packages/core/src/guards.ts']})

    it('accepts a test importing test-kit when it is a devDependency', () => {
      const devDependencies = {'@fro-bot/test-kit': 'workspace:*'}
      const test = sourceFile(
        'packages/core/src/guards.test.ts',
        `import {fake} from '@fro-bot/test-kit/git-data-fake'`,
      )
      expect(
        findPackageLayoutViolations(layout([kit, core([test], {devDependencies})], kitLock({devDependencies}))),
      ).toEqual([])
    })

    it('rejects a non-test module that imports test-kit', () => {
      const devDependencies = {'@fro-bot/test-kit': 'workspace:*'}
      const source = sourceFile('packages/core/src/guards.ts', `import {fake} from '@fro-bot/test-kit/git-data-fake'`)
      expect(
        findPackageLayoutViolations(layout([kit, core([source], {devDependencies})], kitLock({devDependencies}))),
      ).toEqual(['packages/core/src/guards.ts: a non-test module must not import @fro-bot/test-kit'])
    })

    it('rejects test-kit declared in dependencies', () => {
      const dependencies = {'@fro-bot/test-kit': 'workspace:*'}
      const test = sourceFile(
        'packages/core/src/guards.test.ts',
        `import {fake} from '@fro-bot/test-kit/git-data-fake'`,
      )
      const violations = findPackageLayoutViolations(
        layout([kit, core([test], {dependencies})], kitLock({dependencies})),
      )
      expect(violations).toEqual(expect.arrayContaining([expect.stringContaining('belongs in devDependencies')]))
    })
  })

  describe('external npm packages', () => {
    const lockWith = (dependencies: Record<string, string>): Record<string, unknown> =>
      lockFor(['packages/core', {...CLEAN_LOCK_ENTRY, dependencies}])
    const withYaml = (manifest: Record<string, unknown>): PackageFacts =>
      fixturePackage('core', {
        manifest,
        files: [sourceFile('packages/core/src/guards.ts', `import {parse} from 'yaml'`)],
      })

    it('accepts a declared package at the range the root declares', () => {
      const dependencies = {yaml: '^2.6.0'}
      const input = layout([withYaml({dependencies})], lockWith(dependencies), {yaml: '^2.6.0'})
      expect(findPackageLayoutViolations(input)).toEqual([])
    })

    it('rejects an undeclared external import', () => {
      expect(findPackageLayoutViolations(layout([withYaml({})], lockWith({}), {yaml: '^2.6.0'}))).toEqual([
        'packages/core/src/guards.ts: imports yaml, which is not declared in dependencies',
      ])
    })

    it('rejects a range that differs from the root range', () => {
      const dependencies = {yaml: '^2.8.3'}
      expect(
        findPackageLayoutViolations(layout([withYaml({dependencies})], lockWith(dependencies), {yaml: '^2.6.0'})),
      ).toEqual(['packages/core: yaml is declared as "^2.8.3" but the root declares "^2.6.0"; use the root range'])
    })

    it('treats a bare Node builtin and a node: specifier as declared by the runtime', () => {
      const files = [
        sourceFile('packages/core/src/guards.ts', `import {readFileSync} from 'fs'\nimport {join} from 'node:path'`),
      ]
      const input = layout([fixturePackage('core', {files})], lockFor(['packages/core', CLEAN_LOCK_ENTRY]))
      expect(findPackageLayoutViolations(input)).toEqual([])
    })

    it('does not require a test to declare vitest or another root-provided tool', () => {
      const files = [
        sourceFile('packages/core/src/guards.ts', 'export const a = 1'),
        sourceFile('packages/core/src/guards.test.ts', `import {it} from 'vitest'`),
      ]
      const input = layout([fixturePackage('core', {files})], lockFor(['packages/core', CLEAN_LOCK_ENTRY]))
      expect(findPackageLayoutViolations(input)).toEqual([])
    })

    it('counts a dynamic import and a re-export as imports', () => {
      const content = `export * from 'yaml'\nconst m = await import('zod')`
      const files = [sourceFile('packages/core/src/guards.ts', content)]
      const violations = findPackageLayoutViolations(
        layout([fixturePackage('core', {files})], lockFor(['packages/core', CLEAN_LOCK_ENTRY])),
      )
      expect(violations).toEqual([
        'packages/core/src/guards.ts: imports yaml, which is not declared in dependencies',
        'packages/core/src/guards.ts: imports zod, which is not declared in dependencies',
      ])
    })
  })

  describe('relative imports', () => {
    const withImport = (specifier: string): LayoutInput => {
      const files = [sourceFile('packages/core/src/guards.ts', `import {x} from '${specifier}'`)]
      return layout([fixturePackage('core', {files})], lockFor(['packages/core', CLEAN_LOCK_ENTRY]))
    }

    it('accepts a sibling and a nested import', () => {
      expect(findPackageLayoutViolations(withImport('./other.ts'))).toEqual([])
      expect(findPackageLayoutViolations(withImport('./nested/other.ts'))).toEqual([])
    })

    it.each(['../../../scripts/x.ts', '../../test-kit/src/git-data-fake.ts', '../../../packages/core-evil/src/x.ts'])(
      'rejects %s, which leaves the package directory',
      specifier => {
        expect(findPackageLayoutViolations(withImport(specifier))).toEqual([
          `packages/core/src/guards.ts: relative import "${specifier}" leaves packages/core`,
        ])
      },
    )
  })

  describe('bun.lock', () => {
    const base = (lockEntry: Record<string, unknown>, manifest: Record<string, unknown> = {}): string[] =>
      findPackageLayoutViolations(layout([fixturePackage('core', {manifest})], lockFor(['packages/core', lockEntry])))

    it('rejects a missing workspace entry', () => {
      expect(findPackageLayoutViolations(layout([fixturePackage('core')], lockFor()))).toEqual([
        'bun.lock: no workspace entry for packages/core; run bun install',
      ])
    })

    it('rejects an already-locked dependency added to the manifest only, which frozen install accepts', () => {
      const violations = base(CLEAN_LOCK_ENTRY, {dependencies: {yaml: '^2.6.0'}})
      expect(violations).toEqual(
        expect.arrayContaining([expect.stringContaining('bun.lock: packages/core dependencies differ')]),
      )
    })

    it('rejects workspace:* swapped for a matching range in the manifest, which frozen install accepts', () => {
      const lockEntry = {...CLEAN_LOCK_ENTRY, dependencies: {'@fro-bot/test-kit': 'workspace:*'}}
      const violations = base(lockEntry, {dependencies: {'@fro-bot/test-kit': '0.0.0'}})
      expect(violations).toEqual(
        expect.arrayContaining([expect.stringContaining('bun.lock: packages/core dependencies differ')]),
      )
    })

    it('rejects a dependency the lock holds that the manifest dropped', () => {
      const violations = base({...CLEAN_LOCK_ENTRY, devDependencies: {vitest: '4.1.11'}})
      expect(violations).toEqual([expect.stringContaining('bun.lock: packages/core devDependencies differ')])
    })

    it('rejects a name or version drift', () => {
      expect(base({name: '@fro-bot/renamed', version: '0.0.0'})).toEqual([
        'bun.lock: packages/core is named @fro-bot/renamed but package.json says @fro-bot/core',
      ])
      expect(base({name: '@fro-bot/core', version: '1.0.0'})).toEqual([
        'bun.lock: packages/core is version 1.0.0 but package.json says 0.0.0',
      ])
    })

    it('rejects a lock workspace entry whose package directory is gone', () => {
      const input = layout(
        [fixturePackage('core')],
        lockFor(['packages/core', CLEAN_LOCK_ENTRY], ['packages/gone', {name: '@fro-bot/gone'}]),
      )
      expect(findPackageLayoutViolations(input)).toEqual([
        'bun.lock: workspace entry packages/gone has no package directory; run bun install',
      ])
    })
  })

  describe('package cycles', () => {
    it('rejects a two-package cycle', () => {
      const a = fixturePackage('a', {manifest: {dependencies: {'@fro-bot/b': 'workspace:*'}}})
      const b = fixturePackage('b', {manifest: {dependencies: {'@fro-bot/a': 'workspace:*'}}})
      const lock = lockFor(
        ['packages/a', {name: '@fro-bot/a', version: '0.0.0', dependencies: {'@fro-bot/b': 'workspace:*'}}],
        ['packages/b', {name: '@fro-bot/b', version: '0.0.0', dependencies: {'@fro-bot/a': 'workspace:*'}}],
      )
      expect(findPackageLayoutViolations(layout([a, b], lock))).toEqual([
        'package dependency cycle: @fro-bot/a -> @fro-bot/b -> @fro-bot/a',
      ])
    })

    it('counts a devDependency edge', () => {
      const a = fixturePackage('a', {manifest: {devDependencies: {'@fro-bot/b': 'workspace:*'}}})
      const b = fixturePackage('b', {manifest: {dependencies: {'@fro-bot/a': 'workspace:*'}}})
      const lock = lockFor(
        ['packages/a', {name: '@fro-bot/a', version: '0.0.0', devDependencies: {'@fro-bot/b': 'workspace:*'}}],
        ['packages/b', {name: '@fro-bot/b', version: '0.0.0', dependencies: {'@fro-bot/a': 'workspace:*'}}],
      )
      expect(findPackageLayoutViolations(layout([a, b], lock))).toEqual([
        'package dependency cycle: @fro-bot/a -> @fro-bot/b -> @fro-bot/a',
      ])
    })

    it('accepts a diamond', () => {
      const dep = (name: string): Record<string, unknown> => ({dependencies: {[name]: 'workspace:*'}})
      const both = {dependencies: {'@fro-bot/b': 'workspace:*', '@fro-bot/c': 'workspace:*'}}
      const packages = [
        fixturePackage('a', {manifest: both}),
        fixturePackage('b', {manifest: dep('@fro-bot/d')}),
        fixturePackage('c', {manifest: dep('@fro-bot/d')}),
        fixturePackage('d'),
      ]
      const lock = lockFor(
        ['packages/a', {name: '@fro-bot/a', version: '0.0.0', ...both}],
        ['packages/b', {name: '@fro-bot/b', version: '0.0.0', ...dep('@fro-bot/d')}],
        ['packages/c', {name: '@fro-bot/c', version: '0.0.0', ...dep('@fro-bot/d')}],
        ['packages/d', {name: '@fro-bot/d', version: '0.0.0'}],
      )
      expect(findPackageLayoutViolations(layout(packages, lock))).toEqual([])
    })
  })
})

describe('importSpecifiers', () => {
  it('finds every import shape and ignores comments', () => {
    const source = [
      `// import {x} from 'commented-line'`,
      `/* import {y} from 'commented-block' */`,
      `import {a} from 'static-from'`,
      `import type {T} from 'type-only'`,
      `import 'side-effect'`,
      `export * from 're-export'`,
      `const m = await import('dynamic')`,
      `type X = typeof import('typeof-import')`,
      `vi.mock('mocked')`,
    ].join('\n')
    expect(importSpecifiers(source)).toEqual([
      'static-from',
      'type-only',
      'side-effect',
      're-export',
      'dynamic',
      'typeof-import',
      'mocked',
    ])
  })

  it('reduces a scoped or deep specifier to its package name', () => {
    expect(packageNameOf('@fro-bot/core/guards')).toBe('@fro-bot/core')
    expect(packageNameOf('@fro.bot/wiki-write-core')).toBe('@fro.bot/wiki-write-core')
    expect(packageNameOf('yaml/util')).toBe('yaml')
  })
})

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

function walkTypeScript(dir: string): string[] {
  return readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !/(?:^|[/\\])(?:node_modules|dist)(?:[/\\]|$)/u.test(entry.parentPath),
    )
    .map(entry => join(entry.parentPath, entry.name))
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile() && !/(?:^|[/\\])(?:node_modules|dist)(?:[/\\]|$)/u.test(entry.parentPath))
    .map(entry => join(entry.parentPath, entry.name))
}

function toRepoPath(absolute: string): string {
  return absolute.slice(repositoryRoot.length + 1).replaceAll('\\', '/')
}

function readRealLayout(): LayoutInput {
  const packages = readdirSync(packagesRoot, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map((entry): PackageFacts => {
      const directory = join(packagesRoot, entry.name)
      const typeScriptFiles = PUBLISHED_PACKAGE_DIRS.has(entry.name) ? [] : walkTypeScript(directory)
      return {
        dir: entry.name,
        manifest: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as unknown,
        hasReadme: existsSync(join(directory, 'README.md')),
        filePaths: new Set(walkFiles(directory).map(toRepoPath)),
        files: typeScriptFiles.map(file => ({
          path: toRepoPath(file),
          isTest: isTestFile(file),
          specifiers: importSpecifiers(readFileSync(file, 'utf8')),
        })),
      }
    })

  const rootManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as unknown
  const rootRecord = isRecord(rootManifest) ? rootManifest : {}
  // bun.lock is JSONC: trailing commas are valid YAML flow syntax, so the yaml parser reads it.
  const lock = parseYaml(readFileSync(join(repositoryRoot, 'bun.lock'), 'utf8')) as unknown

  return {
    packages,
    rootDependencies: {...stringMap(rootRecord.dependencies), ...stringMap(rootRecord.devDependencies)},
    lockWorkspaces: isRecord(lock) ? lock.workspaces : undefined,
  }
}

describe('package layout (real tree)', () => {
  const input = readRealLayout()
  const privatePackages = input.packages.filter(facts => !PUBLISHED_PACKAGE_DIRS.has(facts.dir))

  it('follows every layout rule', () => {
    const violations = findPackageLayoutViolations(input)
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('finds the workspace packages and their sources, so a scan that matches nothing cannot pass', () => {
    expect(privatePackages.map(facts => facts.dir)).toEqual(expect.arrayContaining(['test-kit']))
    for (const facts of privatePackages) {
      expect(facts.files.length, facts.dir).toBeGreaterThan(0)
    }
    expect(input.packages.some(facts => facts.dir === 'wiki-write-core')).toBe(true)
  })

  it('reads the lock workspaces for every private package', () => {
    const workspaces = isRecord(input.lockWorkspaces) ? input.lockWorkspaces : {}
    for (const facts of privatePackages) {
      expect(workspaces, facts.dir).toHaveProperty([`packages/${facts.dir}`])
    }
  })

  it('has a README beside every package manifest', () => {
    for (const facts of input.packages) {
      expect(facts.hasReadme, `packages/${facts.dir}/README.md`).toBe(true)
    }
  })
})
