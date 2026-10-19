import {readFileSync} from 'node:fs'
import {relative, resolve} from 'node:path'

import {describe, expect, it} from 'vitest'
import {directSpecifiers, readStrykerConfig, strykerConfigPath, type SourceReader} from './check-mutation-guards.ts'
import {
  findMutateEntriesWithoutSourceReach,
  isPureReexportBarrel,
  normalizePath,
  sourceReachTransitive,
  treeOf,
} from './mutation-guards-reach.ts'

// Every fixture below lives in memory. Source text names modules like `./fixture-a.ts`, which
// resolve to `scripts/fixture-a.ts` — a path that never exists on disk — and the traversal is
// handed an injected `exists`, so nothing here touches the filesystem under `scripts/`.

const repositoryRoot = resolve(import.meta.dirname, '..')

function toRepoRelative(absolutePath: string): string {
  return relative(repositoryRoot, absolutePath).replaceAll('\\', '/')
}

/**
 * Correct traversal reads a file at most three times: the entry's own specifier scan, then one
 * barrel probe and one specifier scan if a cycle or self-import reaches the entry again. A
 * traversal that follows a node twice reads it four times, so this reader turns lost dedup into
 * an immediate failure instead of a hang. It also throws on any path outside the fixture, which
 * proves a missing target is never read.
 */
const MAX_READS_PER_FILE = 3

function memoryTree(files: Readonly<Record<string, string>>): {
  readonly readSource: SourceReader
  readonly exists: (absolutePath: string) => boolean
} {
  const sources = new Map(Object.entries(files))
  const reads = new Map<string, number>()
  return {
    readSource: absolutePath => {
      const path = toRepoRelative(absolutePath)
      const count = (reads.get(path) ?? 0) + 1
      reads.set(path, count)
      if (count > MAX_READS_PER_FILE) throw new Error(`${path} was read ${String(count)} times`)
      const source = sources.get(path)
      if (source === undefined) throw new Error(`${path} is not part of the fixture`)
      return source
    },
    exists: absolutePath => sources.has(toRepoRelative(absolutePath)),
  }
}

function fixturePath(name: string): string {
  return `scripts/fixture-${name}.ts`
}

/** A regular module: imports each named fixture and declares something of its own. */
function importing(...names: readonly string[]): string {
  const imports = names.map(name => `import {value} from './fixture-${name}.ts'`)
  return `${imports.join('\n')}\nexport const own = 1\n`
}

/** A pure re-export barrel forwarding each named fixture. */
function reexporting(...names: readonly string[]): string {
  return `${names.map(name => `export * from './fixture-${name}.ts'`).join('\n')}\n`
}

const LEAF = 'export const leaf = 1\n'
const ENTRY = 'scripts/fixture-entry.test.ts'

function reachedFrom(files: Readonly<Record<string, string>>): string[] {
  const {readSource, exists} = memoryTree(files)
  return [...sourceReachTransitive(ENTRY, readSource, exists)].sort()
}

describe('normalizePath', () => {
  it.each([
    ['./scripts/x', 'scripts/x'],
    ['./packages/x', 'packages/x'],
    ['scripts/x', 'scripts/x'],
    ['docs/x', 'docs/x'],
    ['', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected)
  })
})

describe('treeOf', () => {
  it.each([
    ['packages/x', 'packages'],
    ['scripts/x', 'scripts'],
    ['./scripts/x', 'scripts'],
    ['./packages/x', 'packages'],
    ['docs/x', undefined],
    ['', undefined],
  ])('classifies %j as %j', (input, expected) => {
    expect(treeOf(input)).toBe(expected)
  })
})

describe('isPureReexportBarrel', () => {
  // Every form the docstring and the pattern accept, plus the neighbors that must not be.
  // Each expected value is what the pattern yields, driven through the real classifier.
  it.each([
    ["export type * as T from './fixture-a.ts'\n", true],
    ["export type * from './fixture-a.ts'\n", true],
    ["export * from './fixture-a.ts'\n", true],
    ["export * as N from './fixture-a.ts'\n", true],
    ["export {value} from './fixture-a.ts'\n", true],
    ["export type {value} from './fixture-a.ts'\n", true],
    ["export  type  *  as  NS  from  './fixture-a.ts'  ;", true],
    ["export  type  {a}  from  './fixture-a.ts'  ;", true],
    ["export  {a,\n b}  from  './fixture-a.ts'  ;", true],
    ["export  *  from  './fixture-a.ts'", true],
    ["export * from './fixture-a.ts';", true],
    ["export * from './fixture-a.ts' ;", true],
    ["export {} from './fixture-a.ts'", true],
    ['export * from "./fixture-a.ts"\n', true],
    ["export * as $ns_1 from './fixture-a.ts'\n", true],
    ["// header\nexport * from './fixture-a.ts'\n", true],
    ["export * from './fixture-a.ts'\nexport {b} from './fixture-b.ts'\n", true],
    // Compact forms are valid TypeScript, but the pattern requires whitespace around `from`, so
    // a barrel written this way is not stripped and counts as direct reach. A known fail-open,
    // pinned and not endorsed; Prettier formatting makes these shapes unlikely in this repo.
    ["export *from'./fixture-a.ts'", false],
    ["export type{a}from'./fixture-a.ts';", false],
    ["export{a}from'./fixture-a.ts';", false],
    ["export type* from './fixture-a.ts'", false],
    // A module's own code, a bare side-effect import, or trailing text next to a re-export.
    ["export function own(): number {\n  return 1\n}\nexport * from './fixture-a.ts'\n", false],
    ["import './fixture-side-effect.ts'\nexport * from './fixture-a.ts'\n", false],
    ["export * from './fixture-a.ts' trailing\n", false],
    ['export const value = 1\n', false],
  ])('classifies %j as barrel=%s', (source, expected) => {
    expect(isPureReexportBarrel('scripts/fixture-barrel.ts', () => source)).toBe(expected)
  })
})

describe('sourceReachTransitive (in memory)', () => {
  it('follows a regular two-hop chain to every module along it', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('mid'),
        [fixturePath('mid')]: importing('target'),
        [fixturePath('target')]: LEAF,
      }),
    ).toEqual([fixturePath('mid'), fixturePath('target')])
  })

  it('terminates on an import cycle that does not include the entry', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('a'),
        [fixturePath('a')]: importing('b'),
        [fixturePath('b')]: importing('a'),
      }),
    ).toEqual([fixturePath('a'), fixturePath('b')])
  })

  it('terminates on an import cycle that returns to the entry', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('a'),
        [fixturePath('a')]: `import {value} from './fixture-entry.test.ts'\nexport const own = 1\n`,
      }),
    ).toEqual([fixturePath('a'), ENTRY])
  })

  it('terminates on a module importing itself', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('a'),
        [fixturePath('a')]: importing('a'),
      }),
    ).toEqual([fixturePath('a')])
  })

  it('terminates on the entry importing itself', () => {
    expect(
      reachedFrom({
        [ENTRY]: `import {value} from './fixture-entry.test.ts'\nimport {other} from './fixture-a.ts'\nexport {}\n`,
        [fixturePath('a')]: LEAF,
      }),
    ).toEqual([fixturePath('a'), ENTRY])
  })

  it('reaches a diamond’s shared target once', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('a', 'b'),
        [fixturePath('a')]: importing('c'),
        [fixturePath('b')]: importing('c'),
        [fixturePath('c')]: LEAF,
      }),
    ).toEqual([fixturePath('a'), fixturePath('b'), fixturePath('c')])
  })

  it('reaches a target the entry names twice once', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('a', 'a'),
        [fixturePath('a')]: LEAF,
      }),
    ).toEqual([fixturePath('a')])
  })

  it('ignores a target that does not exist at depth 1', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('ghost', 'a'),
        [fixturePath('a')]: LEAF,
      }),
    ).toEqual([fixturePath('a')])
  })

  it('ignores a target that does not exist at depth 2', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('a'),
        [fixturePath('a')]: importing('ghost'),
      }),
    ).toEqual([fixturePath('a')])
  })

  it('marks a barrel reached without trusting what it forwards', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('barrel'),
        [fixturePath('barrel')]: reexporting('target'),
        [fixturePath('target')]: LEAF,
      }),
    ).toEqual([fixturePath('barrel')])
  })

  it('stops at the first barrel when a barrel forwards to another barrel', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('regular'),
        [fixturePath('regular')]: importing('outer'),
        [fixturePath('outer')]: reexporting('inner'),
        [fixturePath('inner')]: reexporting('target'),
        [fixturePath('target')]: LEAF,
      }),
    ).toEqual([fixturePath('outer'), fixturePath('regular')])
  })

  it('follows a module that has own code next to a re-export', () => {
    expect(
      reachedFrom({
        [ENTRY]: importing('mixed'),
        [fixturePath('mixed')]: `${reexporting('target')}export const own = 1\n`,
        [fixturePath('target')]: LEAF,
      }),
    ).toEqual([fixturePath('mixed'), fixturePath('target')])
  })
})

describe('findMutateEntriesWithoutSourceReach (in memory)', () => {
  it('flags a mutate entry reachable only through a barrel', () => {
    const {readSource, exists} = memoryTree({
      'scripts/fixture-barrel-test.test.ts': importing('barrel'),
      [fixturePath('barrel')]: reexporting('target'),
      [fixturePath('target')]: LEAF,
    })

    const violations = findMutateEntriesWithoutSourceReach(
      [fixturePath('target')],
      ['scripts/fixture-barrel-test.test.ts'],
      testFile => sourceReachTransitive(testFile, readSource, exists),
    )
    expect(violations).toEqual([fixturePath('target')])
  })

  it('accepts a mutate entry reached through a regular chain', () => {
    const {readSource, exists} = memoryTree({
      'scripts/fixture-chain-test.test.ts': importing('wrapper'),
      [fixturePath('wrapper')]: importing('target'),
      [fixturePath('target')]: LEAF,
    })

    const violations = findMutateEntriesWithoutSourceReach(
      [fixturePath('target')],
      ['scripts/fixture-chain-test.test.ts'],
      testFile => sourceReachTransitive(testFile, readSource, exists),
    )
    expect(violations).toEqual([])
  })
})

describe('findMutateEntriesWithoutSourceReach (fake reach)', () => {
  it('reports nothing for a same-tree scripts pair', () => {
    const reach = (testFile: string): Iterable<string> => (testFile === 'scripts/a.test.ts' ? ['scripts/a.ts'] : [])
    expect(findMutateEntriesWithoutSourceReach(['scripts/a.ts'], ['scripts/a.test.ts'], reach)).toEqual([])
  })

  it('reports nothing for a same-tree packages pair', () => {
    const reach = (testFile: string): Iterable<string> =>
      testFile === 'packages/p/src/a.test.ts' ? ['packages/p/src/a.ts'] : []
    expect(findMutateEntriesWithoutSourceReach(['packages/p/src/a.ts'], ['packages/p/src/a.test.ts'], reach)).toEqual(
      [],
    )
  })

  it('still reports an entry whose only reach comes from a glob testFiles entry', () => {
    const reach = (): Iterable<string> => ['scripts/a.ts']
    expect(findMutateEntriesWithoutSourceReach(['scripts/a.ts'], ['scripts/*.test.ts'], reach)).toEqual([
      'scripts/a.ts',
    ])
  })

  it('reports an entry outside both trees even when its test sits beside it', () => {
    const reach = (testFile: string): Iterable<string> => (testFile === 'docs/a.test.ts' ? ['docs/a.ts'] : [])
    expect(findMutateEntriesWithoutSourceReach(['docs/a.ts'], ['docs/a.test.ts'], reach)).toEqual(['docs/a.ts'])
  })

  it('reports an entry reached only across the tree boundary', () => {
    const reach = (testFile: string): Iterable<string> =>
      testFile === 'scripts/a.test.ts' ? ['packages/p/src/a.ts'] : []
    expect(findMutateEntriesWithoutSourceReach(['packages/p/src/a.ts'], ['scripts/a.test.ts'], reach)).toEqual([
      'packages/p/src/a.ts',
    ])
  })

  it('normalizes a ./ prefix on the mutate entry, the testFiles entry and the reached path', () => {
    // Reach is keyed on the normalized test name, so a testFiles entry whose prefix is not
    // stripped before the call reaches nothing.
    const reach = (testFile: string): Iterable<string> => (testFile === 'scripts/a.test.ts' ? ['./scripts/a.ts'] : [])
    expect(
      findMutateEntriesWithoutSourceReach(['./scripts/a.ts', './scripts/b.ts'], ['./scripts/a.test.ts'], reach),
    ).toEqual(['scripts/b.ts'])
  })

  it('ignores reached paths that are not mutate entries', () => {
    const reach = (): Iterable<string> => ['scripts/unrelated.ts', 'scripts/a.ts']
    expect(findMutateEntriesWithoutSourceReach(['scripts/a.ts', 'scripts/b.ts'], ['scripts/a.test.ts'], reach)).toEqual(
      ['scripts/b.ts'],
    )
  })
})

describe('findMutateEntriesWithoutSourceReach (real config)', () => {
  it('reports zero violations against the REAL stryker.config.json', () => {
    const {mutate, testFiles} = readStrykerConfig(strykerConfigPath)
    const violations = findMutateEntriesWithoutSourceReach(mutate, testFiles, sourceReachTransitive)

    expect(violations, violations.length === 0 ? undefined : `barrel-only reach for: ${violations.join(', ')}`).toEqual(
      [],
    )
  })

  it('flags private-leak.ts once its direct same-tree exercisers are removed from testFiles', () => {
    const {mutate, testFiles: realTestFiles} = readStrykerConfig(strykerConfigPath)
    // Both direct, non-barrel exercisers of private-leak.ts must be removed for this fixture:
    // private-leak-adapter.test.ts (imports it via the adapter) and private-leak.test.ts
    // (imports it directly). With either one still present, private-leak.ts is genuinely
    // reached without a barrel and this fixture no longer proves anything about the hole.
    const directExercisers = new Set([
      'packages/wiki-write-core/src/private-leak-adapter.test.ts',
      'packages/wiki-write-core/src/private-leak.test.ts',
    ])
    const testFiles = realTestFiles.filter(entry => !directExercisers.has(normalizePath(entry)))
    // Sanity: the fixture actually removed both entries, otherwise this test would prove nothing.
    expect(testFiles.length).toBe(realTestFiles.length - directExercisers.size)

    // Pin the premise this test depends on: wiki-write-core.test.ts must NOT have its own
    // direct specifier resolving to private-leak.ts — if it ever gains one (rather than reaching
    // it only through index.ts's barrel), this fixture stops proving anything about the barrel
    // hole and the assertion below would pass for the wrong reason.
    const wikiWriteCoreTestSpecifiers = directSpecifiers('packages/wiki-write-core/src/wiki-write-core.test.ts', path =>
      readFileSync(path, 'utf8'),
    )
    expect(
      wikiWriteCoreTestSpecifiers,
      'fixture assumes wiki-write-core.test.ts reaches private-leak.ts only via index.ts',
    ).not.toContain('packages/wiki-write-core/src/private-leak.ts')

    const violations = findMutateEntriesWithoutSourceReach(mutate, testFiles, sourceReachTransitive)
    expect(violations).toContain('packages/wiki-write-core/src/private-leak.ts')
  })
})
