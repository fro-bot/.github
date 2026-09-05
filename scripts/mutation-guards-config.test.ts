import {readdirSync, readFileSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'

import {describe, expect, it} from 'vitest'
import {readStrykerConfig} from './check-mutation-guards.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const packageSrcDir = join(repositoryRoot, 'packages/wiki-write-core/src')
const scriptsDir = join(repositoryRoot, 'scripts')
const strykerConfigPath = join(repositoryRoot, 'stryker.config.json')
const mutationGuardsPath = join(repositoryRoot, 'mutation-guards.json')

const REGEX_REDOS_TEST_PATH = 'packages/wiki-write-core/src/regex-redos-regressions.test.ts'

interface NotMutatedEntry {
  readonly path: string
  readonly reason: string
}

interface MutationGuardsFile {
  readonly 'not-mutated': readonly NotMutatedEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read mutation-guards.json, exported for reuse rather than re-parsed ad hoc per test. */
function readMutationGuardsFile(path: string): MutationGuardsFile {
  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  const notMutated = isRecord(parsed) ? parsed['not-mutated'] : undefined
  if (
    !Array.isArray(notMutated) ||
    !notMutated.every(
      (entry): entry is NotMutatedEntry =>
        isRecord(entry) && typeof entry.path === 'string' && typeof entry.reason === 'string',
    )
  ) {
    throw new Error(`mutation-guards-config: ${path} is missing a {path, reason}[] "not-mutated" field`)
  }
  return {'not-mutated': notMutated}
}

/**
 * Strips a single leading `./` so a config entry and a filesystem-derived path that refer to
 * the same file compare equal regardless of which prefix style was used to write them.
 */
function normalizePath(entry: string): string {
  return entry.startsWith('./') ? entry.slice(2) : entry
}

/** Non-test `.ts` files directly under `dir`, returned as repo-relative paths. */
function listNonTestTsFiles(dir: string, repoRelativePrefix: string): string[] {
  return readdirSync(dir, {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map(entry => `${repoRelativePrefix}/${entry.name}`)
    .sort()
}

const CHECK_SCRIPT_PATTERN = /^check-.+\.ts$/u
const WIKI_GATES_PATTERN = /^wiki-.+-gates\.ts$/u

/**
 * Scripts matched by name convention: `check-*.ts`, `wiki-*-gates.ts`,
 * `wiki-context-safety.ts`, and `build-wiki-write-core.ts`. Test files (`*.test.ts`) are
 * excluded — they belong in `testFiles`, not the `mutate`/`not-mutated` enumeration.
 */
function listScriptsGateFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map(entry => entry.name)
    .filter(
      name =>
        CHECK_SCRIPT_PATTERN.test(name) ||
        WIKI_GATES_PATTERN.test(name) ||
        name === 'wiki-context-safety.ts' ||
        name === 'build-wiki-write-core.ts',
    )
    .map(name => `scripts/${name}`)
    .sort()
}

/** Repo tree a path belongs to, for same-tree pairing checks. `undefined` means neither. */
function treeOf(path: string): 'packages' | 'scripts' | undefined {
  const normalized = normalizePath(path)
  if (normalized.startsWith('packages/')) return 'packages'
  if (normalized.startsWith('scripts/')) return 'scripts'
  return undefined
}

const RELATIVE_IMPORT_PATTERN = /from\s+['"](\.\/[^'"]+)['"]/gu

/** Direct same-directory (`./x.ts`) relative import targets, resolved to repo-relative paths. */
function directRelativeImports(repoRelativeFilePath: string): string[] {
  const absolutePath = join(repositoryRoot, repoRelativeFilePath)
  const content = readFileSync(absolutePath, 'utf8')
  const fileDir = dirname(repoRelativeFilePath)
  const targets: string[] = []
  for (const match of content.matchAll(RELATIVE_IMPORT_PATTERN)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    targets.push(relative(repositoryRoot, resolve(repositoryRoot, fileDir, specifier)).replaceAll('\\', '/'))
  }
  return targets
}

/**
 * The set of repo-relative module paths a test file "reaches": its own direct `./`-relative
 * imports, plus — one level through a barrel — the `./`-relative imports of any `index.ts`
 * it imports directly. This is the same-tree pairing signal Test 3 uses: a test file that
 * imports a mutated module (directly, or via a barrel it imports) is treated as covering it.
 */
function reachedModules(testFilePath: string): Set<string> {
  const reached = new Set<string>()
  for (const target of directRelativeImports(testFilePath)) {
    reached.add(target)
    if (target.endsWith('/index.ts')) {
      for (const barrelTarget of directRelativeImports(target)) reached.add(barrelTarget)
    }
  }
  return reached
}

/**
 * Cross-tree pairing violations: a `testFiles` entry that reaches a `mutate` entry (per
 * `reach`) living in the other top-level tree (`packages/` vs `scripts/`). Takes an
 * injectable `reach` function so discrimination tests can exercise the pairing logic
 * against a fake mutate/testFiles set without needing matching files on disk.
 */
export function findCrossTreePairingViolations(
  mutate: readonly string[],
  testFiles: readonly string[],
  reach: (testFile: string) => Iterable<string>,
): string[] {
  const normalizedMutate = mutate.map(normalizePath)
  const violations: string[] = []

  for (const testFile of testFiles) {
    const testTree = treeOf(testFile)
    if (testTree === undefined) continue
    for (const reached of reach(normalizePath(testFile))) {
      const mutateEntry = normalizedMutate.find(entry => entry === normalizePath(reached))
      if (mutateEntry === undefined) continue
      const mutateTree = treeOf(mutateEntry)
      if (mutateTree !== undefined && mutateTree !== testTree) {
        violations.push(`${mutateEntry} (${mutateTree}/) paired with ${testFile} (${testTree}/)`)
      }
    }
  }

  return violations
}

describe('mutation guard enumeration', () => {
  it('Test 1: every non-test package module is listed in mutate or not-mutated', () => {
    const {mutate} = readStrykerConfig(strykerConfigPath)
    const notMutated = readMutationGuardsFile(mutationGuardsPath)['not-mutated']
    const listed = new Set([...mutate, ...notMutated.map(entry => entry.path)].map(normalizePath))

    const files = listNonTestTsFiles(packageSrcDir, 'packages/wiki-write-core/src')
    const unlisted = files.filter(file => !listed.has(normalizePath(file)))

    expect(
      unlisted,
      unlisted.length === 0
        ? undefined
        : `unlisted package module(s), needs a "mutate" or "not-mutated" entry: ${unlisted.join(', ')}`,
    ).toEqual([])
  })

  it('Test 2: every name-matched scripts gate file is listed in mutate or not-mutated', () => {
    const {mutate} = readStrykerConfig(strykerConfigPath)
    const notMutated = readMutationGuardsFile(mutationGuardsPath)['not-mutated']
    const listed = new Set([...mutate, ...notMutated.map(entry => entry.path)].map(normalizePath))

    const files = listScriptsGateFiles(scriptsDir)
    const unlisted = files.filter(file => !listed.has(normalizePath(file)))

    expect(
      unlisted,
      unlisted.length === 0
        ? undefined
        : `unlisted scripts gate file(s), needs a "mutate" or "not-mutated" entry: ${unlisted.join(', ')}`,
    ).toEqual([])
  })

  it('Test 3: mutate/testFiles pairings never cross the packages/scripts tree boundary', () => {
    const {mutate, testFiles} = readStrykerConfig(strykerConfigPath)
    const violations = findCrossTreePairingViolations(mutate, testFiles, reachedModules)

    expect(violations, violations.length === 0 ? undefined : `cross-tree pairing(s): ${violations.join('; ')}`).toEqual(
      [],
    )
  })

  it('Test 4: the redos-regression test file is not in testFiles', () => {
    const {testFiles} = readStrykerConfig(strykerConfigPath)
    expect(testFiles.map(normalizePath)).not.toContain(REGEX_REDOS_TEST_PATH)
  })

  it('Test 5: every not-mutated reason is non-empty', () => {
    const notMutated = readMutationGuardsFile(mutationGuardsPath)['not-mutated']
    const blank = notMutated.filter(entry => entry.reason.trim() === '')

    expect(
      blank.map(entry => entry.path),
      blank.length === 0 ? undefined : `blank "not-mutated" reason for: ${blank.map(entry => entry.path).join(', ')}`,
    ).toEqual([])
  })
})
