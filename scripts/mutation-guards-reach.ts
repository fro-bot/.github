import {existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {directSpecifiers, isLiteralPath, stripComments, type SourceReader} from './check-mutation-guards.ts'

function repositoryRoot(): string {
  return resolve(import.meta.dirname, '..')
}

function defaultReadSource(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
}

export function normalizePath(entry: string): string {
  return entry.startsWith('./') ? entry.slice(2) : entry
}

export function treeOf(path: string): 'packages' | 'scripts' | undefined {
  const normalized = normalizePath(path)
  if (normalized.startsWith('packages/')) return 'packages'
  if (normalized.startsWith('scripts/')) return 'scripts'
  return undefined
}

// Every alternative form a pure re-export statement can take. Deliberately mirrors what
// `directSpecifiers` (./check-mutation-guards.ts) already recognizes as a re-export, so a
// module this pattern fails to strip is exactly a module `directSpecifiers` would also treat
// as carrying no reach-worthy specifier of its own (has none of the forms it looks for).
// A function rather than a module-level const, so its regex mutants are covered by the barrel
// tests alone instead of being static mutants that run every test file.
function barrelExportStatementPattern(): RegExp {
  return /export\s+(?:type\s+)?\*\s+(?:as\s+[$\w]+\s+)?from\s+['"][^'"]+['"]\s*;?|export\s+type\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?|export\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?/gu
}

/**
 * A "pure re-export barrel": a module whose entire body, after stripping comments, consists
 * ONLY of `export * from '...'` / `export * as X from '...'` / `export {...} from '...'` /
 * `export type * from '...'` / `export type {...} from '...'` statements — no own declaration,
 * no bare `import`, no non-export statement of any kind. `packages/wiki-write-core/src/index.ts`
 * (eight `export *` lines, nothing else) is the canonical case.
 *
 * Deliberately conservative: every barrel-export statement is stripped out, and if ANYTHING
 * other than whitespace remains, this returns `false`. A module with a single non-barrel
 * statement alongside re-exports — a helper function, a bare `import` for a side effect — is
 * NOT classified as a pure barrel, so this only ever excludes the narrowest, safest case: a
 * file whose only possible effect on any test is forwarding another module's exports untouched,
 * never a file that could itself run logic a test exercises.
 *
 * Known fail-open shapes, pinned by the truth table in `scripts/mutation-guards-reach.test.ts`.
 * `export *from'./a.ts'`, `export type{a}from'./a.ts'` and `export{a}from'./a.ts'` are missed by
 * `directSpecifiers`, which requires whitespace after `from`, so the forwarded module is
 * unreached from that file and a change to it does not trigger the gate. `export type* from
 * './a.ts'` does yield a specifier, but the pattern requires whitespace between `type` and `*`,
 * so it is not stripped: the module is a non-barrel and its forwarding counts as reach.
 */
export function isPureReexportBarrel(repoRelativeFilePath: string, readSource: SourceReader): boolean {
  const content = stripComments(readSource(join(repositoryRoot(), repoRelativeFilePath)))
  const withoutBarrelStatements = content.replaceAll(barrelExportStatementPattern(), '')
  return withoutBarrelStatements.trim().length === 0
}

/**
 * Stricter sibling of `reachedModulesTransitive` (`./check-mutation-guards.ts`), used ONLY by
 * `findMutateEntriesWithoutSourceReach` below — never by the trigger gate, which needs reach as
 * wide as possible (see `findMutateTestPairingViolations` in `scripts/mutation-guards-config.test.ts`;
 * this function must never be substituted there). Same walk over `directSpecifiers`, except:
 * when a module being followed is a pure re-export barrel (`isPureReexportBarrel`), its own
 * specifiers are never added to the reached set — a test that only imports a barrel is not
 * treated as reaching whatever the barrel forwards. The barrel module itself is still marked
 * reached (it does not vanish from accounting), only its forwarding is not trusted as proof of
 * reach for what it forwards.
 *
 * One guard decides every enqueue, for the entry's own specifiers and for each followed
 * module's: a target is skipped when it does not exist or is already reached. A module is
 * therefore queued at most once, and the queue is a growing array walked with `for...of`, so
 * an import cycle terminates and no separate visited set is needed. `exists` takes an absolute
 * path, like `readSource`, so a test can run the whole walk in memory.
 */
export function sourceReachTransitive(
  repoRelativeFilePath: string,
  readSource: SourceReader = defaultReadSource,
  exists: (absolutePath: string) => boolean = existsSync,
): Set<string> {
  const reached = new Set<string>()
  const followQueue: string[] = []

  const enqueueSpecifiersOf = (file: string): void => {
    for (const target of directSpecifiers(file, readSource)) {
      if (!exists(join(repositoryRoot(), target)) || reached.has(target)) continue
      reached.add(target)
      followQueue.push(target)
    }
  }

  enqueueSpecifiersOf(repoRelativeFilePath)
  for (const current of followQueue) {
    if (isPureReexportBarrel(current, readSource)) continue
    enqueueSpecifiersOf(current)
  }

  return reached
}

/**
 * `findMutateTestPairingViolations` (`scripts/mutation-guards-config.test.ts`) counts reach
 * through a barrel as reach, so a `mutate` entry exercised only via `index.ts`'s `export *`
 * (never through a direct, own-code import chain) passes that check even when no `testFiles`
 * entry actually imports it by a traceable path. This function requires the stricter
 * `sourceReachTransitive` walk instead: every `mutate` entry must be reached by at least one
 * same-tree `testFiles` entry through a chain with no barrel hop. "Same-tree" reuses
 * `treeOf`'s definition above (`packages/` vs `scripts/`); cross-tree pairing is already
 * flagged by `findMutateTestPairingViolations` and is not re-flagged here. Glob `testFiles`
 * entries are skipped (already flagged by the other check's own glob-violation message).
 * Returns the list of `mutate` entries with no qualifying reach — empty means every entry has
 * at least one non-barrel same-tree exerciser.
 */
export function findMutateEntriesWithoutSourceReach(
  mutate: readonly string[],
  testFiles: readonly string[],
  reach: (testFile: string) => Iterable<string>,
): string[] {
  const normalizedMutate = mutate.map(normalizePath)
  const reachedBySameTreeTest = new Set<string>()

  for (const testFile of testFiles) {
    if (!isLiteralPath(testFile)) continue
    const testTree = treeOf(testFile)
    if (testTree === undefined) continue
    for (const reachedRaw of reach(normalizePath(testFile))) {
      const reachedNormalized = normalizePath(reachedRaw)
      const mutateEntry = normalizedMutate.find(entry => entry === reachedNormalized)
      if (mutateEntry === undefined) continue
      if (treeOf(mutateEntry) !== testTree) continue
      reachedBySameTreeTest.add(mutateEntry)
    }
  }

  return normalizedMutate.filter(entry => !reachedBySameTreeTest.has(entry))
}
