/**
 * `findIndexEntryLines` and `parseRelatedFlow` replaced regexes that rescanned the rest of their input from
 * many starts. This file pins that they find exactly what the regexes found, and that they run in linear time.
 * The old regexes are kept here as the reference.
 */

import {describe, expect, it} from 'vitest'
import {findIndexEntryLines, parseRelatedFlow} from './line-scanners.ts'

// ─── The reference: the regexes as they were ───

const OLD_INDEX_ENTRY =
  /^- \[\[([^\]|]+)\]\]\s*—\s*(?:\S.*|[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/gmu
const OLD_RELATED_FLOW = /^related:\s*\[(.*)\]\s*(?:#.*)?$/u

function oldIndexEntries(index: string): {slug: string; line: string}[] {
  const entries: {slug: string; line: string}[] = []
  for (const match of index.matchAll(OLD_INDEX_ENTRY)) {
    const [line, slug] = match
    if (line !== undefined && slug !== undefined) entries.push({slug, line})
  }
  return entries
}

function oldRelatedFlow(line: string): string | undefined {
  return OLD_RELATED_FLOW.exec(line)?.[1]
}

// ─── Explicit cases: each is also checked against the reference ───

describe('findIndexEntryLines', () => {
  it.each([
    ['an entry', '- [[a]] — text', [{slug: 'a', line: '- [[a]] — text'}]],
    [
      'two entries',
      '- [[a]] — x\n- [[b]] — y',
      [
        {slug: 'a', line: '- [[a]] — x'},
        {slug: 'b', line: '- [[b]] — y'},
      ],
    ],
    ['an entry after a heading', '# Index\n\n- [[a]] — x\n', [{slug: 'a', line: '- [[a]] — x'}]],
    ['no space around the dash', '- [[a]]—x', [{slug: 'a', line: '- [[a]]—x'}]],
    ['several spaces around the dash', '- [[a]]   —   x y', [{slug: 'a', line: '- [[a]]   —   x y'}]],
    ['a newline before the dash', '- [[a]]\n— x', [{slug: 'a', line: '- [[a]]\n— x'}]],
    ['a newline after the dash', '- [[a]] —\nx', [{slug: 'a', line: '- [[a]] —\nx'}]],
    [
      'a carriage-return line ending',
      '- [[a]] — x\r\n- [[b]] — y\r\n',
      [
        {slug: 'a', line: '- [[a]] — x'},
        {slug: 'b', line: '- [[b]] — y'},
      ],
    ],
    ['a line separator ends the text', '- [[a]] — x\u2028y', [{slug: 'a', line: '- [[a]] — x'}]],
    ['a slug that crosses a line', '- [[a\nb]] — x', [{slug: 'a\nb', line: '- [[a\nb]] — x'}]],
    ['a slug with spaces', '- [[ a b ]] — x', [{slug: ' a b ', line: '- [[ a b ]] — x'}]],
    ['an empty slug', '- [[]] — x', []],
    ['a pipe in the slug', '- [[a|b]] — x', []],
    ['one bracket closing the slug', '- [[a] — x', []],
    ['no dash', '- [[a]] x', []],
    ['an en dash', '- [[a]] – x', []],
    ['an empty description at the end of the text', '- [[a]] —', []],
    ['an empty description followed by a newline', '- [[a]] —\n', []],
    ['one trailing space after the dash, at the end of the text', '- [[a]] — ', [{slug: 'a', line: '- [[a]] — '}]],
    ['one trailing space, then a newline', '- [[a]] — \n', [{slug: 'a', line: '- [[a]] — '}]],
    ['two trailing spaces, then a newline', '- [[a]] —  \n', [{slug: 'a', line: '- [[a]] —  '}]],
    ['a tab then a newline then more text', '- [[a]] —\t\nx', [{slug: 'a', line: '- [[a]] —\t\nx'}]],
    ['a no-break space at the end of the text', '- [[a]] —\u00A0', [{slug: 'a', line: '- [[a]] —\u00A0'}]],
    ['an entry not at the start of a line', 'x - [[a]] — y', []],
    ['an entry after a carriage return', 'x\r- [[a]] — y', [{slug: 'a', line: '- [[a]] — y'}]],
    ['an astral character in the description', '- [[a]] — 😀', [{slug: 'a', line: '- [[a]] — 😀'}]],
    ['a first entry that fails, then a good one', '- [[a]] x\n- [[b]] — y', [{slug: 'b', line: '- [[b]] — y'}]],
    ['an unclosed slug, then a good entry', '- [[a\n- [[b]] — y', [{slug: 'a\n- [[b', line: '- [[a\n- [[b]] — y'}]],
    ['nothing', '', []],
  ] as const)('%s', (_name, index, expected) => {
    expect(oldIndexEntries(index)).toStrictEqual(expected)
    expect(findIndexEntryLines(index)).toStrictEqual(expected)
  })
})

describe('parseRelatedFlow', () => {
  it.each([
    ['a flow list', 'related: [a, b]', 'a, b'],
    ['an empty list', 'related: []', ''],
    ['no space after the colon', 'related:[a]', 'a'],
    ['several spaces', 'related:   [a]', 'a'],
    ['a trailing space', 'related: [a] ', 'a'],
    ['a trailing comment', 'related: [a] # note', 'a'],
    ['a comment with no space', 'related: [a]#note', 'a'],
    ['a bracket inside the list', 'related: [a, [b]]', 'a, [b]'],
    ['the last bracket wins', 'related: [a] [b]', 'a] [b'],
    ['a bracket in the comment: the last bracket still wins', 'related: [a] # [b]', 'a] # [b'],
    ['a carriage return at the end', 'related: [a]\r', 'a'],
    ['a carriage return inside a comment', 'related: [a] # x\ry', undefined],
    ['a carriage return before the closing bracket', 'related: [a\r]', undefined],
    ['text after the bracket', 'related: [a] b', undefined],
    ['no closing bracket', 'related: [a', undefined],
    ['a block key', 'related:', undefined],
    ['another key', 'tags: [a]', undefined],
    ['a leading space', ' related: [a]', undefined],
    ['a line separator before the closing bracket', 'related: [a\u2028]', undefined],
    ['a line separator after the bracket', 'related: [a]\u2028', 'a'],
    ['a line separator is whitespace before a comment', 'related: [a]\u2028# x', 'a'],
    ['nothing', '', undefined],
  ] as const)('%s', (_name, line, expected) => {
    expect(oldRelatedFlow(line)).toBe(expected)
    expect(parseRelatedFlow(line)).toBe(expected)
  })
})

// ─── A deterministic differential against the reference ───

/** mulberry32: a small seeded generator, so a failure names a reproducible seed and index. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

type Tokens = readonly (readonly [string, number])[]

function drawStrings(tokens: Tokens, seed: number, count: number, maxTokens: number, prefix = ''): string[] {
  const total = tokens.reduce((sum, [, weight]) => sum + weight, 0)
  const random = seeded(seed)
  const strings: string[] = []
  for (let index = 0; index < count; index++) {
    let text = random() < 0.6 ? prefix : ''
    for (let remaining = 1 + Math.floor(random() * maxTokens); remaining > 0; remaining--) {
      let roll = random() * total
      for (const [token, weight] of tokens) {
        roll -= weight
        if (roll < 0) {
          text += token
          break
        }
      }
    }
    strings.push(text)
  }
  return strings
}

const INDEX_TOKENS: Tokens = [
  ['- [[', 14],
  [']]', 10],
  ['[[', 3],
  [']', 5],
  ['|', 6],
  ['—', 12],
  ['–', 1],
  [' ', 8],
  ['\n', 8],
  ['\r', 3],
  ['\r\n', 2],
  ['\u2028', 2],
  ['\u2029', 1],
  ['\t', 2],
  ['\u000B', 1],
  ['\f', 1],
  ['\u00A0', 2],
  ['\u3000', 1],
  ['\uFEFF', 1],
  ['a', 8],
  ['b c', 2],
  ['😀', 1],
  ['\uD800', 1],
  ['- [[a]] — ', 6],
  ['- [[a]] — x', 4],
  ['- ', 3],
  ['-', 2],
]

const RELATED_TOKENS: Tokens = [
  ['[', 10],
  [']', 12],
  [' ', 8],
  ['#', 8],
  ['a', 6],
  [',', 3],
  ['\r', 3],
  ['\u2028', 2],
  ['\u2029', 1],
  ['\t', 2],
  ['\u00A0', 1],
  ['"', 2],
  ["'", 2],
  ['] #', 3],
  [']#', 3],
  ['related:', 2],
]

const SEEDS = [20_261_106, 4097, 49] as const
const PER_SEED = 20_000

describe('findIndexEntryLines against the regex it replaced', () => {
  it('finds the same entries in 60,000 seeded documents', () => {
    let total = 0
    let withEntries = 0
    let withSeveral = 0
    let trailingWhitespaceEntries = 0
    for (const seed of SEEDS) {
      for (const [index, text] of drawStrings(INDEX_TOKENS, seed, PER_SEED, 20).entries()) {
        const expected = oldIndexEntries(text)
        const actual = findIndexEntryLines(text)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          expect.fail(
            `seed ${seed} document #${index} ${JSON.stringify(text)}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
          )
        }
        total += 1
        if (expected.length > 0) withEntries += 1
        if (expected.length > 1) withSeveral += 1
        trailingWhitespaceEntries += expected.filter(entry => /—\s*$/u.test(entry.line)).length
      }
    }
    expect(total).toBe(60_000)
    expect(withEntries / total).toBeGreaterThan(0.25)
    expect(withEntries / total).toBeLessThan(0.95)
    expect(withSeveral).toBeGreaterThan(1000)
    expect(trailingWhitespaceEntries).toBeGreaterThan(200)
  })
})

describe('parseRelatedFlow against the regex it replaced', () => {
  it('returns the same inside for 60,000 seeded lines', () => {
    let total = 0
    let matched = 0
    let unmatchedAfterOpening = 0
    for (const seed of SEEDS) {
      for (const [index, line] of drawStrings(RELATED_TOKENS, seed, PER_SEED, 14, 'related: [').entries()) {
        const expected = oldRelatedFlow(line)
        const actual = parseRelatedFlow(line)
        if (actual !== expected) {
          expect.fail(
            `seed ${seed} line #${index} ${JSON.stringify(line)}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
          )
        }
        total += 1
        if (expected !== undefined) matched += 1
        else if (line.startsWith('related: [')) unmatchedAfterOpening += 1
      }
    }
    expect(total).toBe(60_000)
    expect(matched / total).toBeGreaterThan(0.1)
    expect(matched / total).toBeLessThan(0.8)
    expect(unmatchedAfterOpening).toBeGreaterThan(5000)
  })
})

// ─── Time ───

/** The fastest of three runs, so one scheduler stall cannot fail a linear scan. */
function fastestOfThree(run: () => void): number {
  let fastest = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = performance.now()
    run()
    fastest = Math.min(fastest, performance.now() - startedAt)
  }
  return fastest
}

describe('linear time on adversarial input', () => {
  const BOUND_MS = 1000
  const TIMEOUT_MS = 120_000

  it(
    'findIndexEntryLines: an unclosed entry repeated on 100,000 lines',
    () => {
      const index = '- [[a\n'.repeat(100_000)
      expect(fastestOfThree(() => findIndexEntryLines(index))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'findIndexEntryLines: closed entries with no dash on 100,000 lines',
    () => {
      const index = '- [[a]] x\n'.repeat(100_000)
      expect(fastestOfThree(() => findIndexEntryLines(index))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'findIndexEntryLines: 100,000 blank lines after a dash',
    () => {
      const index = `- [[a]] —${'\n'.repeat(100_000)}`
      expect(fastestOfThree(() => findIndexEntryLines(index))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it.each([
    [
      'closing brackets each followed by a comment, then a carriage return',
      (n: number) => `related: [${']#'.repeat(n)}\rx`,
    ],
    [
      'closing brackets each followed by a space, then a carriage return',
      (n: number) => `related: [${'] '.repeat(n)}#\rx`,
    ],
    ['closing brackets and a long run of spaces', (n: number) => `related: [${']'.repeat(n)}${' '.repeat(n)}x`],
  ] as const)(
    'parseRelatedFlow: %s',
    (_name, build) => {
      const line = build(100_000)
      expect(fastestOfThree(() => parseRelatedFlow(line))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )
})
