import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve} from 'node:path'

import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {isLiteralPath, readStrykerConfig} from './check-mutation-guards.ts'

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

// Static `import ... from '...'` / `export ... from '...'` (type-only or not), one or two
// leading dots so both `./x.ts` and a deeper `../../scripts/x.ts` resolve.
const STATIC_RELATIVE_IMPORT_PATTERN = /from\s+['"](\.\.?\/[^'"]+)['"]/gu
// Dynamic `import('./x.ts')` — also matches inside `typeof import('./x.ts')`, since this is a
// plain textual scan with no regard for what precedes `import(`.
const DYNAMIC_IMPORT_STRING_PATTERN = /import\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/gu
// Dynamic `import(`./x${'.js'}`)` — the template literal's raw content is resolved separately
// (see resolveTemplateLiteralSpecifier) since it may carry a literal-only `${...}` interpolation.
const DYNAMIC_IMPORT_TEMPLATE_PATTERN = /import\(\s*`([^`]*)`\s*\)/gu
// Only `export * from '...'` / `export {...} from '...'` — the subset of exports that forward
// to another module and are therefore worth following transitively for barrel-chain reach.
// `(?:type\s+)?` accepts the type-only forms too: `export type {...} from '...'` and
// `export type * from '...'` re-export types only, but the file relationship they describe
// (this file forwards to that one) is the same signal `findMutateTestPairingViolations`
// treats as reach — a barrel that only re-exports types from a module still names it as part
// of the same logical unit for pairing purposes.
const REEXPORT_PATTERN = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+[$\w]+)?|\{[^}]*\})\s*from\s+['"](\.\.?\/[^'"]+)['"]/gu
// A literal-only `${'...'}`/`${"..."}` interpolation inside a template literal specifier.
const TEMPLATE_LITERAL_LOOKUP_PATTERN = /\$\{\s*(['"])((?:\\.|(?!\1).)*)\1\s*\}/gu

/**
 * Resolves a dynamic-import template literal's raw content (e.g. `./x${'.js'}`) by inlining
 * every literal-only `${'...'}`/`${"..."}` interpolation. Returns `undefined` if the result
 * still contains an unresolved `${` (a non-literal interpolation this scanner cannot follow)
 * or does not start with a relative-path dot, so a specifier this cannot safely resolve is
 * dropped rather than mis-resolved.
 */
function resolveTemplateLiteralSpecifier(raw: string): string | undefined {
  const resolved = raw.replaceAll(TEMPLATE_LITERAL_LOOKUP_PATTERN, (_match, _quote: string, inner: string) => inner)
  if (resolved.includes('${') || !resolved.startsWith('.')) return undefined
  return resolved
}

/**
 * A specifier ending `.js`/`.mjs`/`.cjs` is rewritten to `.ts` — this codebase's dynamic
 * imports and `typeof import(...)` type positions use the compiled-output extension by
 * convention (Node's type-stripping resolution accepts it), but the actual source file on
 * disk, and every `mutate`/`testFiles` config entry, uses `.ts`.
 */
function normalizeSpecifierExtension(specifier: string): string {
  return specifier.replace(/\.(?:js|mjs|cjs)$/u, '.ts')
}

function resolveSpecifier(repoRelativeFilePath: string, specifier: string): string {
  const fileDir = dirname(repoRelativeFilePath)
  return relative(repositoryRoot, resolve(repositoryRoot, fileDir, normalizeSpecifierExtension(specifier))).replaceAll(
    '\\',
    '/',
  )
}

/**
 * Strips `//` line comments and `/* ... *\/` block comments from file content before the
 * import/export patterns run against it, tracking quote state across the whole file (not
 * reset per line, unlike `check-mutation-guards.ts`'s `stripStringLiterals`) so a multi-line
 * template literal's contents are never mistaken for a comment. Deliberately does **not**
 * reuse `stripStringLiterals`: that function blanks string/template contents to spaces, which
 * would erase the very import specifiers this extractor needs to keep — comment stripping and
 * string blanking cannot share one pass when the specifier lives inside a string, so this is a
 * separate, narrower tool for a separate purpose (proving *reach*, not scanning directives).
 *
 * Only a line-comment's or block-comment's byte span is removed (dropped, not blanked to
 * spaces) — no column-offset preservation is needed here, unlike the directive scanner, since
 * nothing downstream reports a match's position within the original file.
 *
 * Two known gaps, one of them NOT narrow:
 *
 * 1. **Regex-literal quote, file-scoped — fail-open, not a narrow edge case.** Unlike
 *    `stripStringLiterals` (which resets its quote state every line, since it is called
 *    per-line by the directive scanner), this function tracks quote state across the *entire
 *    file* to correctly handle a multi-line template literal. That same file-wide tracking
 *    means an unbalanced quote inside a regex literal (no regex-literal state exists here
 *    either) does not just swallow the rest of one line — it opens a phantom string that can
 *    run to the next matching quote character *anywhere later in the file*, silently
 *    swallowing every comment boundary in between. Concretely, this un-hides a commented-out
 *    import: `// Stryker disable next-line, see /foo['"]bar/` followed on a later line by
 *    `// import {x} from './x.ts'` would have its `//` treated as ordinary code (inside the
 *    still-open phantom string) rather than a comment, so the commented-out import would be
 *    extracted as real reach. This is a fail-open for the *positive* pairing rule (a `mutate`
 *    entry could read as reached when it should not), not a merely cosmetic gap, and is
 *    accepted only because no such regex literal currently appears in any file this extractor
 *    scans (pinned by a test below so a future change to this behavior is deliberate, not
 *    accidental).
 * 2. **Import-shaped text inside a string literal.** An import-shaped specifier appearing
 *    inside* a string literal (e.g. `scripts/build-wiki-write-core.test.ts`'s fixture text
 *    `"export type {Thing} from './thing.ts'"`, asserting on rewritten declaration output, not
 *    an actual import) still matches the import patterns below, since this stripper never
 *    blanks string content — only comments are removed. `reachedModulesTransitive` filters its
 *    direct specifiers through `existsSync`, which closes this for a phantom target naming a
 *    module that does not exist; the residual gap is narrower than "any import-shaped string"
 *    — it is now only an import-shaped string that happens to name a module that *does* exist
 *    on disk. Accepted as a narrow, documented limitation: the alternative (blanking strings)
 *    would break every real specifier this extractor exists to find.
 */
function stripComments(content: string): string {
  let result = ''
  let quote: string | undefined
  let i = 0
  while (i < content.length) {
    const char = content[i] ?? ''
    if (quote !== undefined) {
      if (char === '\\') {
        result += content.slice(i, i + 2)
        i += 2
        continue
      }
      if (char === quote) quote = undefined
      result += char
      i += 1
      continue
    }
    if (char === '/' && content[i + 1] === '/') {
      const newlineIndex = content.indexOf('\n', i)
      i = newlineIndex === -1 ? content.length : newlineIndex
      continue
    }
    if (char === '/' && content[i + 1] === '*') {
      const closeIndex = content.indexOf('*/', i + 2)
      i = closeIndex === -1 ? content.length : closeIndex + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      result += char
      i += 1
      continue
    }
    result += char
    i += 1
  }
  return result
}

/**
 * Every relative-path module specifier a file references directly: static import/export
 * `from` clauses, dynamic `import('...')` (including inside `typeof import('...')`), and
 * dynamic `import(\`...\`)` template literals with a literal-only interpolation. Resolved to
 * repo-relative paths. Package specifiers (`@fro-bot/...`, bare module names) never match —
 * every pattern requires a leading `./` or `../`.
 */
function directSpecifiers(repoRelativeFilePath: string): string[] {
  const content = stripComments(readFileSync(join(repositoryRoot, repoRelativeFilePath), 'utf8'))
  const raw: string[] = []

  for (const match of content.matchAll(STATIC_RELATIVE_IMPORT_PATTERN)) {
    if (match[1] !== undefined) raw.push(match[1])
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_STRING_PATTERN)) {
    if (match[1] !== undefined) raw.push(match[1])
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_TEMPLATE_PATTERN)) {
    if (match[1] === undefined) continue
    const resolved = resolveTemplateLiteralSpecifier(match[1])
    if (resolved !== undefined) raw.push(resolved)
  }

  return raw.map(specifier => resolveSpecifier(repoRelativeFilePath, specifier))
}

/** Only the `export ... from '...'` (re-export/barrel) specifiers a file forwards to. */
function directReexportSpecifiers(repoRelativeFilePath: string): string[] {
  const content = stripComments(readFileSync(join(repositoryRoot, repoRelativeFilePath), 'utf8'))
  const raw: string[] = []
  for (const match of content.matchAll(REEXPORT_PATTERN)) {
    if (match[1] !== undefined) raw.push(match[1])
  }
  return raw.map(specifier => resolveSpecifier(repoRelativeFilePath, specifier))
}

/**
 * The set of repo-relative module paths a test file "reaches": every direct relative-path
 * specifier it references (see `directSpecifiers`), plus — followed transitively through any
 * number of re-export barrel hops (see `directReexportSpecifiers`), bounded by a visited set
 * so a barrel cycle cannot loop forever — every module a reached barrel forwards to. This is
 * the same-tree pairing signal Test 3 uses: a test file that imports a mutated module
 * (directly, dynamically, or via a chain of barrels it imports) is treated as covering it.
 * Exported so a test can exercise it directly against a real file (Fro Bot's live
 * `wiki-context-safety.ts`/`wiki-context-safety.test.ts` counterexample, which reaches only
 * through a dynamic `import(\`./wiki-context-safety${'.js'}\`)`, no static import at all).
 *
 * Every direct specifier is filtered through `existsSync` before being added to `reached` —
 * `directSpecifiers` runs its patterns against comment-stripped-but-not-string-blanked content
 * (see `stripComments`), so ordinary fixture text in a `*.test.ts` file that merely *looks*
 * like an import (e.g. `scripts/build-wiki-write-core.test.ts`'s
 * `"export type {Thing} from './thing.ts'"` string literal, asserting on rewritten declaration
 * output, not an actual import) still matches the import patterns and would otherwise produce
 * a phantom reach target that names a file that was never written and does not exist. This
 * closes that case for files that name a genuinely nonexistent module; the residual gap (see
 * `stripComments`'s docstring) is narrower than "any import-shaped string" — it is now only an
 * import-shaped string that happens to name a module that *does* exist on disk.
 */
export function reachedModulesTransitive(testFilePath: string): Set<string> {
  const reached = new Set<string>()
  const visited = new Set<string>()
  const followQueue: string[] = []

  for (const target of directSpecifiers(testFilePath)) {
    if (!existsSync(join(repositoryRoot, target))) continue
    reached.add(target)
    followQueue.push(target)
  }

  while (followQueue.length > 0) {
    const current = followQueue.shift()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    if (!existsSync(join(repositoryRoot, current))) continue
    for (const target of directReexportSpecifiers(current)) {
      if (reached.has(target)) continue
      reached.add(target)
      followQueue.push(target)
    }
  }

  return reached
}

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
 * entry is *touched* — imported, statically or dynamically, directly or via a barrel — by some
 * same-tree test, nothing more. A barrel with many re-exports (`packages/wiki-write-core/src/
 * index.ts`, eight `export *` targets) makes any test that imports it "reach" every module the
 * barrel forwards to, whether or not that test exercises any of that module's actual logic; the
 * only evidence a promotion to `mutate` is *safe* is a live `pnpm check:mutation-guards` run's
 * per-module kill count, not this structural floor.
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
