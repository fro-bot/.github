import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  findShardPartitionViolations,
  mutationShardCount,
  parseMutationShards,
  readMutationShards,
} from './mutation-shard-lists.ts'

const threeShards = [['a.ts', 'b.ts'], ['c.ts'], ['d.ts']]

describe('parseMutationShards', () => {
  it('returns the lists in the order they are written', () => {
    expect(parseMutationShards({shards: threeShards}, 'x.json')).toEqual(threeShards)
  })

  it('rejects a document with no shards key, naming the source', () => {
    expect(() => parseMutationShards({}, 'x.json')).toThrow('mutation-shard-lists: x.json is missing a "shards" array')
  })

  it('rejects a document that is not an object', () => {
    expect(() => parseMutationShards(null, 'x.json')).toThrow('x.json is missing a "shards" array')
    expect(() => parseMutationShards([threeShards], 'x.json')).toThrow('x.json is missing a "shards" array')
    expect(() => parseMutationShards('shards', 'x.json')).toThrow('x.json is missing a "shards" array')
  })

  it('rejects a shards value that is not an array', () => {
    expect(() => parseMutationShards({shards: {a: ['a.ts']}}, 'x.json')).toThrow('is missing a "shards" array')
    expect(() => parseMutationShards({shards: 'a.ts'}, 'x.json')).toThrow('is missing a "shards" array')
  })

  it('rejects a shard that is not an array, naming it by its one-based number', () => {
    expect(() => parseMutationShards({shards: [['a.ts'], 'b.ts']}, 'x.json')).toThrow(
      'mutation-shard-lists: x.json shard 2 must be a string[]',
    )
    expect(() => parseMutationShards({shards: [{0: 'a.ts'}]}, 'x.json')).toThrow('shard 1 must be a string[]')
    expect(() => parseMutationShards({shards: [null]}, 'x.json')).toThrow('shard 1 must be a string[]')
  })

  it('rejects a shard holding a non-string entry', () => {
    expect(() => parseMutationShards({shards: [['a.ts'], ['b.ts', 7]]}, 'x.json')).toThrow('shard 2 must be a string[]')
    expect(() => parseMutationShards({shards: [['a.ts', null]]}, 'x.json')).toThrow('shard 1 must be a string[]')
  })

  it('rejects an empty shard, naming it by its one-based number', () => {
    expect(() => parseMutationShards({shards: [['a.ts'], [], ['c.ts']]}, 'x.json')).toThrow(
      'mutation-shard-lists: x.json shard 2 is empty',
    )
    expect(() => parseMutationShards({shards: [[]]}, 'x.json')).toThrow('shard 1 is empty')
  })

  it('checks every shard, so a late bad shard is not skipped', () => {
    expect(() => parseMutationShards({shards: [['a.ts'], ['b.ts'], ['c.ts'], 4]}, 'x.json')).toThrow(
      'shard 4 must be a string[]',
    )
  })
})

describe('readMutationShards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-shard-lists-'))
  const goodPath = join(dir, 'good.json')
  const badPath = join(dir, 'bad.json')
  const notJsonPath = join(dir, 'not-json.json')

  beforeAll(() => {
    writeFileSync(goodPath, JSON.stringify({'not-mutated': [], shards: threeShards}), 'utf8')
    writeFileSync(badPath, JSON.stringify({shards: [[]]}), 'utf8')
    writeFileSync(notJsonPath, '{ nope', 'utf8')
  })
  afterAll(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  it('reads the shards key of the file and ignores its other keys', () => {
    expect(readMutationShards(goodPath)).toEqual(threeShards)
  })

  it('names the file in a shape error', () => {
    expect(() => readMutationShards(badPath)).toThrow(`${badPath} shard 1 is empty`)
  })

  it('throws on a missing file and on a file that is not JSON', () => {
    expect(() => readMutationShards(join(dir, 'missing.json'))).toThrow(/ENOENT/u)
    expect(() => readMutationShards(notJsonPath)).toThrow(/JSON/iu)
  })

  it('reads the repository mutation-guards.json by default', () => {
    const shards = readMutationShards()
    expect(shards).toHaveLength(3)
    expect(shards.every(shard => shard.length > 0)).toBe(true)
  })
})

describe('mutationShardCount', () => {
  it('is three', () => {
    expect(mutationShardCount()).toBe(3)
  })
})

describe('findShardPartitionViolations', () => {
  const mutate = ['a.ts', 'b.ts', 'c.ts', 'd.ts']

  it('reports nothing for an exact three-way partition', () => {
    expect(findShardPartitionViolations(mutate, threeShards)).toEqual([])
  })

  it('names an entry that is in no shard (AE5)', () => {
    expect(findShardPartitionViolations(mutate, [['a.ts', 'b.ts'], ['c.ts'], []])).toEqual(['d.ts: in no shard'])
  })

  it('names an entry in two shards, with both shard numbers', () => {
    expect(findShardPartitionViolations(mutate, [['a.ts', 'b.ts'], ['c.ts', 'b.ts'], ['d.ts']])).toEqual([
      'b.ts: in shards 1 and 2',
    ])
  })

  it('names an entry in all three shards', () => {
    expect(findShardPartitionViolations(mutate, [['a.ts', 'b.ts', 'c.ts', 'd.ts'], ['a.ts'], ['a.ts']])).toEqual([
      'a.ts: in shards 1, 2 and 3',
    ])
  })

  it('names an entry listed twice in one shard', () => {
    expect(findShardPartitionViolations(mutate, [['a.ts', 'a.ts', 'b.ts'], ['c.ts'], ['d.ts']])).toEqual([
      'a.ts: listed twice in shard 1',
    ])
  })

  it('names a shard path that is not in mutate', () => {
    expect(findShardPartitionViolations(mutate, [['a.ts', 'b.ts'], ['c.ts', 'x.ts'], ['d.ts']])).toEqual([
      'shard 2: x.ts is not a mutate entry',
    ])
  })

  it('rejects fewer than three shards', () => {
    expect(
      findShardPartitionViolations(mutate, [
        ['a.ts', 'b.ts'],
        ['c.ts', 'd.ts'],
      ]),
    ).toEqual(['expected 3 shards, found 2'])
  })

  it('rejects more than three shards', () => {
    expect(findShardPartitionViolations(mutate, [['a.ts'], ['b.ts'], ['c.ts'], ['d.ts']])).toEqual([
      'expected 3 shards, found 4',
    ])
  })

  it('compares paths with a single leading ./ stripped, on both sides', () => {
    expect(findShardPartitionViolations(['./a.ts', 'b.ts'], [['a.ts'], ['./b.ts'], ['b.ts']])).toEqual([
      'b.ts: in shards 2 and 3',
    ])
    expect(findShardPartitionViolations(['./a.ts', 'b.ts', 'c.ts'], [['a.ts'], ['./b.ts'], ['c.ts']])).toEqual([])
  })

  it('reports violations in the order: count, then mutate entries, then stray shard paths', () => {
    expect(findShardPartitionViolations(['a.ts', 'b.ts'], [['z.ts'], ['a.ts', 'a.ts']])).toEqual([
      'expected 3 shards, found 2',
      'a.ts: listed twice in shard 2',
      'b.ts: in no shard',
      'shard 1: z.ts is not a mutate entry',
    ])
  })
})
