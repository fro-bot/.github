import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, relative, resolve} from 'node:path'

import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {isLiteralPath, reachedModulesTransitive, readStrykerConfig} from './check-mutation-guards.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
const packagesRoot = join(repositoryRoot, 'packages')
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

function normalizePath(entry: string): string {
  return entry.startsWith('./') ? entry.slice(2) : entry
}

/**
 * Non-test `.ts` files under `dir` (recursively, `{recursive: true}`), returned as repo-relative
 * paths. Recursive rather than a single-level `readdirSync` so a future nested source directory
 * under `packages/*\/src/` or `scripts/` is not silently invisible to Tests 1/2 — both trees are
 * flat today, so this only changes behavior once either tree grows a subdirectory.
 */
function walkNonTestTsFiles(dir: string, repoRelativePrefix: string): string[] {
  return readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map(entry => {
      const relativeDir = relative(dir, entry.parentPath).replaceAll('\\', '/')
      return relativeDir === ''
        ? `${repoRelativePrefix}/${entry.name}`
        : `${repoRelativePrefix}/${relativeDir}/${entry.name}`
    })
    .sort()
}

/**
 * Every package's `src/` directory under `packages/*`, paired with its repo-relative prefix.
 * Only one package (`wiki-write-core`) exists today; enumerated by directory rather than
 * hardcoded so Test 1 automatically covers a future second package without a code change.
 */
function listPackageSrcDirs(): {readonly dir: string; readonly prefix: string}[] {
  return readdirSync(packagesRoot, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => ({dir: join(packagesRoot, entry.name, 'src'), prefix: `packages/${entry.name}/src`}))
    .filter(({dir}) => existsSync(dir))
}

const CHECK_SCRIPT_PATTERN = /^check-.+\.ts$/u
const WIKI_GATES_PATTERN = /^wiki-.+-gates\.ts$/u

/**
 * Scripts matched by name convention: `check-*.ts`, `wiki-*-gates.ts`,
 * `wiki-context-safety.ts`, and `build-wiki-write-core.ts`. Test files (`*.test.ts`) are
 * excluded — they belong in `testFiles`, not the `mutate`/`not-mutated` enumeration. Matches
 * against the file's basename, not its full repo-relative path, so this still works once
 * `walkNonTestTsFiles` starts returning nested paths.
 */
function listScriptsGateFiles(dir: string): string[] {
  return walkNonTestTsFiles(dir, 'scripts').filter(path => {
    const name = path.split('/').pop() ?? ''
    return (
      CHECK_SCRIPT_PATTERN.test(name) ||
      WIKI_GATES_PATTERN.test(name) ||
      name === 'wiki-context-safety.ts' ||
      name === 'build-wiki-write-core.ts'
    )
  })
}

function treeOf(path: string): 'packages' | 'scripts' | undefined {
  const normalized = normalizePath(path)
  if (normalized.startsWith('packages/')) return 'packages'
  if (normalized.startsWith('scripts/')) return 'scripts'
  return undefined
}

// `reachedModulesTransitive` and `stripComments` moved to `./check-mutation-guards.ts` (and
// are re-exported from there, imported below) so this enumeration guard's same-tree pairing
// check and the wrapper's changed-file trigger gate share one import-closure implementation
// instead of two textual scanners drifting apart over time.

/**
 * Two same-tree pairing violation classes, both from the `mutate`/`testFiles` config plus a
 * `reach` function (injectable so discrimination tests can exercise fake sets without matching
 * files on disk):
 *
 * 1. **Cross-tree pairing.** A `testFiles` entry reaches a `mutate` entry living in the other
 *    top-level tree (`packages/` vs `scripts/`) — the original Test 3 check, unchanged.
 * 2. **Unreached entry.** A `mutate` entry reached by zero same-tree `testFiles` entries.
 *    Closes Test 3's blind spot: the original cross-tree-only check silently passed a `mutate`
 *    entry with no same-tree test reaching it at all (nothing to flag as "crossing" when
 *    nothing reaches it), which is exactly the shape a `dist/`-shell test produces — e.g. the
 *    scripts-side `export * from '@fro-bot/wiki-write-core/wiki-slug'` shell reaches a package
 *    specifier `reach` cannot resolve, so re-adding the package module to `mutate` on the
 *    strength of that scripts-side test alone would have been invisible before this rule.
 *    A cross-tree reach does not count toward satisfying this rule for the reached entry
 *    (it is already flagged on its own, and same-tree coverage still needs its own test).
 *
 * **Reach is not coverage.** This function (and `reachedModulesTransitive`) proves a `mutate`
 * entry is *touched* — imported, statically or dynamically, directly or via a barrel, or via
 * any chain of regular imports at arbitrary depth (test imports A, A imports B, B imports
 * mutated C — C counts as paired) — by some same-tree test, nothing more. A barrel with many
 * re-exports (`packages/wiki-write-core/src/index.ts`, eight `export *` targets) makes any
 * test that imports it "reach" every module the barrel forwards to, whether or not that test
 * exercises any of that module's actual logic; the only evidence a promotion to `mutate` is
 * safe* is a live `pnpm check:mutation-guards` run's per-module kill count, not this
 * structural floor.
 *
 * **Shared walk, opposing preferences.** `reachedModulesTransitive` is also the changed-file
 * trigger gate's closure walk (`scripts/check-mutation-guards.ts`'s `buildImportClosure`),
 * which wants reach as WIDE as possible — every additional reached file is one more file that
 * correctly triggers a run, strictly safer. This consumer wants the opposite: reach as NARROW
 * as possible, since a wider walk only ever LOWERS how often the "unreached entry" violation
 * above can fire (more paths count as reached, so fewer `mutate` entries look unreached) —
 * widening this walk never adds a violation, only removes one. One shared implementation is
 * tuned wide for the gate's sake; this consumer's floor is correspondingly weaker than a
 * narrow, direct-import-only walk would give it. No behavior change today: every
 * `packages/`-tree `mutate` entry already had barrel reach from `index.ts` under the old
 * re-export-only walk, and every `scripts/`-tree entry has a direct same-tree test, so nothing
 * that used to be flagged as unreached stops being flagged. Revisit if that stops holding.
 *
 * A glob `testFiles` entry (per `isLiteralPath`) cannot be read from disk to compute its reach
 * — rather than let that throw ENOENT, it is skipped from reach computation and reported as its
 * own violation ("glob testFiles entries are not supported for pairing") so a `testFiles` glob
 * is a visible, named gap in this check rather than a crash or a silent no-op.
 */
export function findMutateTestPairingViolations(
  mutate: readonly string[],
  testFiles: readonly string[],
  reach: (testFile: string) => Iterable<string>,
): string[] {
  const normalizedMutate = mutate.map(normalizePath)
  const violations: string[] = []
  const reachedBySameTreeTest = new Set<string>()

  for (const testFile of testFiles) {
    if (!isLiteralPath(testFile)) {
      violations.push(`${testFile}: glob testFiles entries are not supported for pairing`)
      continue
    }
    const testTree = treeOf(testFile)
    if (testTree === undefined) continue
    for (const reachedRaw of reach(normalizePath(testFile))) {
      const reachedNormalized = normalizePath(reachedRaw)
      const mutateEntry = normalizedMutate.find(entry => entry === reachedNormalized)
      if (mutateEntry === undefined) continue
      const mutateTree = treeOf(mutateEntry)
      if (mutateTree !== undefined && mutateTree !== testTree) {
        violations.push(`${mutateEntry} (${mutateTree}/) paired with ${testFile} (${testTree}/)`)
        continue
      }
      reachedBySameTreeTest.add(mutateEntry)
    }
  }

  for (const entry of normalizedMutate) {
    if (!reachedBySameTreeTest.has(entry)) {
      violations.push(`${entry}: not reached by any same-tree testFiles entry`)
    }
  }

  return violations
}

describe('mutation guard enumeration', () => {
  it('Test 1: every non-test package module (across all packages) is listed in mutate or not-mutated', () => {
    const {mutate} = readStrykerConfig(strykerConfigPath)
    const notMutated = readMutationGuardsFile(mutationGuardsPath)['not-mutated']
    const listed = new Set([...mutate, ...notMutated.map(entry => entry.path)].map(normalizePath))

    const files = listPackageSrcDirs().flatMap(({dir, prefix}) => walkNonTestTsFiles(dir, prefix))
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

  it('Test 3: every mutate entry is reached by a same-tree test, and no pairing crosses the packages/scripts tree boundary', () => {
    const {mutate, testFiles} = readStrykerConfig(strykerConfigPath)
    const violations = findMutateTestPairingViolations(mutate, testFiles, reachedModulesTransitive)

    expect(violations, violations.length === 0 ? undefined : `pairing violation(s): ${violations.join('; ')}`).toEqual(
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

  it('Test 6: every not-mutated entry exists on disk', () => {
    const notMutated = readMutationGuardsFile(mutationGuardsPath)['not-mutated']
    const missing = notMutated.filter(entry => !existsSync(join(repositoryRoot, normalizePath(entry.path))))

    expect(
      missing.map(entry => entry.path),
      missing.length === 0
        ? undefined
        : `not-mutated entry(ies) missing on disk: ${missing.map(entry => entry.path).join(', ')}`,
    ).toEqual([])
  })

  it('Test 7: no path is listed in both mutate and not-mutated', () => {
    const {mutate} = readStrykerConfig(strykerConfigPath)
    const notMutated = readMutationGuardsFile(mutationGuardsPath)['not-mutated']
    const mutateSet = new Set(mutate.map(normalizePath))
    const overlap = notMutated.filter(entry => mutateSet.has(normalizePath(entry.path)))

    expect(
      overlap.map(entry => entry.path),
      overlap.length === 0
        ? undefined
        : `path(s) listed in both mutate and not-mutated: ${overlap.map(entry => entry.path).join(', ')}`,
    ).toEqual([])
  })
})

describe('findMutateTestPairingViolations (pure)', () => {
  it("flags a mutate entry when reach resolves only to the other tree's shell", () => {
    const mutate = ['packages/wiki-write-core/src/wiki-slug.ts']
    const testFiles = ['scripts/wiki-slug.test.ts']
    const fakeReach = (testFile: string): Iterable<string> =>
      testFile === 'scripts/wiki-slug.test.ts' ? ['scripts/wiki-slug.ts'] : []

    const violations = findMutateTestPairingViolations(mutate, testFiles, fakeReach)
    expect(violations.some(v => v.includes('packages/wiki-write-core/src/wiki-slug.ts'))).toBe(true)
  })

  it('does not flag scripts/wiki-context-safety.ts, reached only via a dynamic template-literal import', () => {
    const mutate = ['scripts/wiki-context-safety.ts']
    const testFiles = ['scripts/wiki-context-safety.test.ts']

    const reached = reachedModulesTransitive('scripts/wiki-context-safety.test.ts')
    expect(reached.has('scripts/wiki-context-safety.ts')).toBe(true)

    const violations = findMutateTestPairingViolations(mutate, testFiles, reachedModulesTransitive)
    expect(violations).toEqual([])
  })

  it('flags a mutate entry with zero reaching tests', () => {
    const mutate = ['scripts/orphan.ts']
    const testFiles = ['scripts/unrelated.test.ts']
    const fakeReach = (): Iterable<string> => []

    const violations = findMutateTestPairingViolations(mutate, testFiles, fakeReach)
    expect(violations).toEqual(['scripts/orphan.ts: not reached by any same-tree testFiles entry'])
  })

  it('flags a cross-tree pairing', () => {
    const mutate = ['packages/wiki-write-core/src/a.ts']
    const testFiles = ['scripts/a.test.ts']
    const fakeReach = (testFile: string): Iterable<string> =>
      testFile === 'scripts/a.test.ts' ? ['packages/wiki-write-core/src/a.ts'] : []

    // Both violations are legitimately true here: the reach is cross-tree (flagged on its
    // own), and since a cross-tree reach never counts toward same-tree coverage, the entry
    // also has zero same-tree testFiles reaching it.
    const violations = findMutateTestPairingViolations(mutate, testFiles, fakeReach)
    expect(violations).toEqual([
      'packages/wiki-write-core/src/a.ts (packages/) paired with scripts/a.test.ts (scripts/)',
      'packages/wiki-write-core/src/a.ts: not reached by any same-tree testFiles entry',
    ])
  })

  it('reports nothing for a same-tree entry reached by exactly one testFiles entry', () => {
    const mutate = ['scripts/a.ts']
    const testFiles = ['scripts/a.test.ts']
    const fakeReach = (testFile: string): Iterable<string> => (testFile === 'scripts/a.test.ts' ? ['scripts/a.ts'] : [])

    expect(findMutateTestPairingViolations(mutate, testFiles, fakeReach)).toEqual([])
  })

  // Item 5: a glob testFiles entry cannot be readFileSync'd for reach — it must be reported as
  // its own violation, not thrown as ENOENT.
  it('reports a dedicated violation for a glob testFiles entry instead of throwing', () => {
    const mutate: string[] = []
    const testFiles = ['scripts/*.test.ts']

    const violations = findMutateTestPairingViolations(mutate, testFiles, reachedModulesTransitive)
    expect(violations).toEqual(['scripts/*.test.ts: glob testFiles entries are not supported for pairing'])
  })
})

describe('reachedModulesTransitive comment handling (item 3)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mutation-guards-comment-test-'))
  const testFileAbsolutePath = join(tmpDir, 'commented-import.test.ts')
  const repoRelativeTestFilePath = relative(repositoryRoot, testFileAbsolutePath).replaceAll('\\', '/')
  const expectedReachIfUncommented = relative(repositoryRoot, join(tmpDir, 'x.ts')).replaceAll('\\', '/')

  beforeAll(() => {
    writeFileSync(
      testFileAbsolutePath,
      [
        "// import {value} from './x.ts'",
        "/* import {other} from './x.ts' */",
        "import {real} from './real.ts'",
        'export {}',
        '',
      ].join('\n'),
    )
    writeFileSync(join(tmpDir, 'x.ts'), 'export const value = 1\n')
    writeFileSync(join(tmpDir, 'real.ts'), 'export const real = 1\n')
  })
  afterAll(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('does not reach a commented-out import (neither // nor block comment form)', () => {
    const reached = reachedModulesTransitive(repoRelativeTestFilePath)
    expect(reached.has(expectedReachIfUncommented)).toBe(false)
  })

  it('still reaches a real, non-commented import on an adjacent line', () => {
    const reached = reachedModulesTransitive(repoRelativeTestFilePath)
    expect(reached.has(relative(repositoryRoot, join(tmpDir, 'real.ts')).replaceAll('\\', '/'))).toBe(true)
  })
})

// Item 4: export type {...} from / export type * from must be followed as barrel reach the
// same as their non-type-only forms.
describe('reachedModulesTransitive type-only re-export handling (item 4)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mutation-guards-type-reexport-test-'))
  const barrelAbsolutePath = join(tmpDir, 'barrel.ts')
  const testFileAbsolutePath = join(tmpDir, 'uses-barrel.test.ts')
  const repoRelativeTestFilePath = relative(repositoryRoot, testFileAbsolutePath).replaceAll('\\', '/')
  const expectedTarget = relative(repositoryRoot, join(tmpDir, 'target.ts')).replaceAll('\\', '/')

  beforeAll(() => {
    writeFileSync(
      barrelAbsolutePath,
      ["export type {Target} from './target.ts'", "export type * from './target.ts'", ''].join('\n'),
    )
    writeFileSync(join(tmpDir, 'target.ts'), 'export interface Target { readonly id: string }\n')
    writeFileSync(testFileAbsolutePath, ["import type {Target} from './barrel.ts'", 'export {}', ''].join('\n'))
  })
  afterAll(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('follows a type-only re-export barrel chain', () => {
    const reached = reachedModulesTransitive(repoRelativeTestFilePath)
    expect(reached.has(expectedTarget)).toBe(true)
  })
})

// Item 1: a phantom reach target from fixture text that names a module that does not exist on
// disk (the real shape found in scripts/build-wiki-write-core.test.ts:230-231, where declared
// declaration-file fixtures happen to contain import-shaped string literals) must not be
// counted as reach.
describe('reachedModulesTransitive phantom-reach filtering (item 1)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mutation-guards-phantom-reach-test-'))
  const testFileAbsolutePath = join(tmpDir, 'fixture-text.test.ts')
  const repoRelativeTestFilePath = relative(repositoryRoot, testFileAbsolutePath).replaceAll('\\', '/')
  const phantomTarget = relative(repositoryRoot, join(tmpDir, 'thing.ts')).replaceAll('\\', '/')

  beforeAll(() => {
    writeFileSync(
      testFileAbsolutePath,
      [
        'const fixture = "export type {Thing} from \'./thing.ts\'"',
        'const other = "type Imported = import(\'./imported.ts\').Thing"',
        'export {}',
        '',
      ].join('\n'),
    )
    // Deliberately never create thing.ts/imported.ts — the whole point is that neither name
    // resolves to a real file.
  })
  afterAll(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('does not reach a module named only by import-shaped fixture text that does not exist on disk', () => {
    const reached = reachedModulesTransitive(repoRelativeTestFilePath)
    expect(reached.has(phantomTarget)).toBe(false)
    expect(reached.has(relative(repositoryRoot, join(tmpDir, 'imported.ts')).replaceAll('\\', '/'))).toBe(false)
    expect(reached.size).toBe(0)
  })
})

// Item 2: pins the CURRENT, documented (not desired) fail-open behavior described in
// stripComments's docstring — a quote character inside a regex literal opens a phantom string
// with no regex-literal state to prevent it, and because stripComments tracks quote state
// across the whole file (not per line), that phantom string can run past a real comment
// boundary anywhere later in the file and un-hide a commented-out import. This test exists so
// a future change to this behavior (e.g. adding regex-literal awareness) is a deliberate,
// visible diff to this test, not an accidental behavior change nobody notices.
describe('reachedModulesTransitive regex-literal quote gap (item 2, pins documented fail-open)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mutation-guards-regex-quote-test-'))
  const testFileAbsolutePath = join(tmpDir, 'regex-quote.test.ts')
  const repoRelativeTestFilePath = relative(repositoryRoot, testFileAbsolutePath).replaceAll('\\', '/')

  beforeAll(() => {
    writeFileSync(
      testFileAbsolutePath,
      [
        // The regex literal's character class contains a bare `'`, opening a phantom string
        // stripComments has no way to know is not a real string.
        'const re = /[\'"]/ // has a quote in a regex',
        "// import {x} from './x.ts'",
        "import {real} from './real.ts'",
        'export {}',
        '',
      ].join('\n'),
    )
    writeFileSync(join(tmpDir, 'x.ts'), 'export const x = 1\n')
    writeFileSync(join(tmpDir, 'real.ts'), 'export const real = 1\n')
  })
  afterAll(() => {
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('currently un-hides a commented-out import when a preceding regex literal opens a phantom string (documented, accepted)', () => {
    const reached = reachedModulesTransitive(repoRelativeTestFilePath)
    // This is the fail-open, pinned as-is: the commented-out import DOES currently count as
    // reach because the phantom string opened by the regex literal's quote swallows the `//`
    // comment marker ahead of it.
    expect(reached.has(relative(repositoryRoot, join(tmpDir, 'x.ts')).replaceAll('\\', '/'))).toBe(true)
    expect(reached.has(relative(repositoryRoot, join(tmpDir, 'real.ts')).replaceAll('\\', '/'))).toBe(true)
  })
})
