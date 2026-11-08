import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {isRecord} from '@fro-bot/core/guards'
import {normalizePath} from './mutation-guards-reach.ts'
import {findRepositoryRoot} from './repository-root.ts'

/**
 * The shard lists of the PR mutation gate: the `shards` key of `mutation-guards.json`, an ordered list of
 * `mutate` entries per Stryker shard. Shard `n` (one-based) is `shards[n - 1]`. The shard CLI, the merge CLI and
 * the coverage test all read them through here, so a malformed file fails the same way in each.
 *
 * Returns the lists in file order or throws. It checks the shape only: that the lists partition `mutate` is
 * `findShardPartitionViolations`'s job, so a reader that is called on a half-edited file still names the
 * shape error instead of a partition one.
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
 * Reads and parses the `shards` key of `mutation-guards.json` (default: the repository's own file). The text comes
 * from `Buffer#toString()`, which is UTF-8: an encoding argument to `readFileSync` has a variant (`""`) that
 * returns the same bytes as a Buffer, which `JSON.parse` stringifies identically, so no test could kill it.
 */
export function readMutationShards(
  path: string = join(findRepositoryRoot(), 'mutation-guards.json'),
): readonly (readonly string[])[] {
  const parsed: unknown = JSON.parse(readFileSync(path).toString())
  return parseMutationShards(parsed, path)
}

/**
 * Where `shards` fails to be an exact partition of `mutate` into three lists: a shard count other than three,
 * a `mutate` entry in no shard or in more than one, an entry listed twice in one shard, and a shard path that
 * is not a `mutate` entry. Paths compare with a single leading `./` stripped, as everywhere else in the gate.
 * Empty when the lists are an exact partition.
 */
export function findShardPartitionViolations(
  mutate: readonly string[],
  shards: readonly (readonly string[])[],
): string[] {
  const expectedShardCount = 3
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
