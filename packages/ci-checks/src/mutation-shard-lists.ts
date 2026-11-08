import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {isRecord} from '@fro-bot/core/guards'
import {normalizePath} from './mutation-guards-reach.ts'
import {findRepositoryRoot} from './repository-root.ts'

/**
 * The `shards` key of `mutation-guards.json`: ordered lists of `mutate` entries, shard `n` (one-based) being
 * `shards[n - 1]`. Returns them in file order, or throws on a bad shape (not an array of non-empty string arrays).
 * `findShardPartitionViolations` checks the partition and the count.
 */
export function parseMutationShards(parsed: unknown, source: string): readonly (readonly string[])[] {
  const shards = isRecord(parsed) ? parsed.shards : undefined
  if (!Array.isArray(shards)) {
    throw new TypeError(`mutation-shard-lists: ${source} is missing a "shards" array`)
  }

  const lists: string[][] = []
  for (const [index, shard] of shards.entries()) {
    if (!Array.isArray(shard) || !shard.every((entry): entry is string => typeof entry === 'string')) {
      throw new Error(`mutation-shard-lists: ${source} shard ${String(index + 1)} must be a string[]`)
    }
    if (shard.length === 0) {
      throw new Error(`mutation-shard-lists: ${source} shard ${String(index + 1)} is empty`)
    }
    lists.push(shard)
  }
  return lists
}

/**
 * Reads the `shards` key of `mutation-guards.json` (default: the repository's own file). `Buffer#toString()` replaces an
 * encoding argument whose `""` variant is equivalent and cannot be killed.
 */
export function readMutationShards(
  path: string = join(findRepositoryRoot(), 'mutation-guards.json'),
): readonly (readonly string[])[] {
  const parsed: unknown = JSON.parse(readFileSync(path).toString())
  return parseMutationShards(parsed, path)
}

/** The number of PR shards. */
export function mutationShardCount(): number {
  return 3
}

/**
 * Where `shards` is not an exact partition of `mutate` into `mutationShardCount()` lists: a wrong count, an entry in no
 * shard, in several, or twice in one, or a shard path outside `mutate`. Paths compare without a leading `./`.
 */
export function findShardPartitionViolations(
  mutate: readonly string[],
  shards: readonly (readonly string[])[],
): string[] {
  const expectedShardCount = mutationShardCount()
  const violations: string[] = []
  if (shards.length !== expectedShardCount) {
    violations.push(`expected ${String(expectedShardCount)} shards, found ${String(shards.length)}`)
  }

  const normalizedShards = shards.map(shard => shard.map(normalizePath))
  const mutateEntries = mutate.map(normalizePath)
  for (const entry of mutateEntries) {
    const holding: number[] = []
    for (const [index, shard] of normalizedShards.entries()) {
      const occurrences = shard.filter(candidate => candidate === entry).length
      if (occurrences > 1) violations.push(`${entry}: listed twice in shard ${String(index + 1)}`)
      if (occurrences > 0) holding.push(index + 1)
    }
    if (holding.length === 0) violations.push(`${entry}: in no shard`)
    if (holding.length > 1)
      violations.push(`${entry}: in shards ${holding.slice(0, -1).join(', ')} and ${String(holding.at(-1))}`)
  }

  const mutateSet = new Set(mutateEntries)
  for (const [index, shard] of normalizedShards.entries()) {
    for (const entry of shard) {
      if (!mutateSet.has(entry)) violations.push(`shard ${String(index + 1)}: ${entry} is not a mutate entry`)
    }
  }
  return violations
}
