/**
 * `findCodeRegions` is called on every wiki page and repository doc by `resolveMarkdownLinks`. Its inline-span
 * scan used to give each unmatched backtick run a rescan of every later run on the line, which costs time that
 * grows with the line length times its square root. These tests pin that the spans it finds are the ones the
 * rescanning version found, and that the scan is linear. The rescanning version is kept here as the reference.
 */

import {describe, expect, it} from 'vitest'
import {findCodeRegions, type CodeRegion} from './code-regions.ts'

// ─── The reference: findCodeRegions as it was, with the rescanning inline-span scan ───

const OLD_FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/u
const OLD_FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u

interface OldOpenFence {
  readonly character: string
  readonly length: number
  readonly start: number
}

function oldFindCodeRegions(content: string): CodeRegion[] {
  const regions: CodeRegion[] = []
  let fence: OldOpenFence | undefined
  let lineStart = 0

  while (lineStart <= content.length) {
    const newline = content.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(lineStart, lineEnd)
    const text = line.endsWith('\r') ? line.slice(0, -1) : line

    if (fence === undefined) {
      const opener = oldParseFenceOpener(text)
      if (opener === undefined) {
        for (const span of oldFindInlineSpans(line)) {
          regions.push({start: lineStart + span.start, end: lineStart + span.end})
        }
      } else {
        fence = {...opener, start: lineStart}
      }
    } else if (oldClosesFence(text, fence)) {
      regions.push({start: fence.start, end: lineEnd})
      fence = undefined
    }

    lineStart = lineEnd + 1
  }

  if (fence !== undefined) {
    regions.push({start: fence.start, end: content.length})
  }

  return regions
}

function oldParseFenceOpener(text: string): {readonly character: string; readonly length: number} | undefined {
  const match = OLD_FENCE_OPENER.exec(text)
  const marker = match?.[1]
  if (match === null || marker === undefined) {
    return undefined
  }

  const character = marker.charAt(0)
  const info = text.slice(match[0].length)
  return character === '`' && info.includes('`') ? undefined : {character, length: marker.length}
}

function oldClosesFence(text: string, fence: OldOpenFence): boolean {
  const marker = OLD_FENCE_CLOSER.exec(text)?.[1]
  return marker !== undefined && marker.startsWith(fence.character) && marker.length >= fence.length
}

function oldFindInlineSpans(line: string): CodeRegion[] {
  const spans: CodeRegion[] = []
  let index = 0

  while (index < line.length) {
    const character = line[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character !== '`') {
      index += 1
      continue
    }

    const openEnd = oldSkipBackticks(line, index)
    const runLength = openEnd - index
    let searchFrom = openEnd
    let closeEnd = -1
    while (searchFrom < line.length) {
      const closeStart = line.indexOf('`', searchFrom)
      if (closeStart === -1) {
        break
      }
      const candidateEnd = oldSkipBackticks(line, closeStart)
      if (candidateEnd - closeStart === runLength) {
        closeEnd = candidateEnd
        break
      }
      searchFrom = candidateEnd
    }

    if (closeEnd === -1) {
      index = openEnd
    } else {
      spans.push({start: index, end: closeEnd})
      index = closeEnd
    }
  }

  return spans
}

function oldSkipBackticks(line: string, from: number): number {
  let index = from
  while (line[index] === '`') {
    index += 1
  }
  return index
}

// ─── Explicit cases: each is checked against the reference as well as against the stated regions ───

describe('findCodeRegions', () => {
  it.each([
    ['nothing', '', []],
    ['text with no backtick', 'plain text', []],
    ['a single-backtick span', 'a `b` c', [{start: 2, end: 5}]],
    ['a double-backtick span holding a backtick', '``a`b``', [{start: 0, end: 7}]],
    [
      'two spans on a line',
      '`a` `b`',
      [
        {start: 0, end: 3},
        {start: 4, end: 7},
      ],
    ],
    ['an opener with no closer is literal', '`a', []],
    ['a closer of a different length does not close', '``a`', []],
    ['a longer later run does not close', '`a``', []],
    ['an opener passed over, then a span', '`` a ` b `', [{start: 5, end: 10}]],
    ['runs of distinct lengths, none matching', '` `` ``` ````', []],
    ['an unmatched opener, then two runs of its length', '``a` ` ``', [{start: 0, end: 9}]],
    ['an unmatched run does not stop the scan after it', '```a `b`', [{start: 5, end: 8}]],
    ['an escaped backtick does not open a span', '\\`a`', []],
    ['an escaped backtick, then a span', '\\`a` `b`', [{start: 3, end: 6}]],
    ['a backslash inside a span is literal', '`a\\`', [{start: 0, end: 4}]],
    ['an escape in front of a run leaves a shorter opener', '\\``a``', []],
    ['an escape in front of a run, closed by a run of the shorter length', '\\``a`', [{start: 2, end: 5}]],
    ['an escape in front of a three-backtick run', '\\```a``', [{start: 2, end: 7}]],
    ['a backslash at the end of the line', 'a\\', []],
    ['two backslashes', '\\\\`a`', [{start: 2, end: 5}]],
    ['spans do not cross a line break', '`a\nb`', []],
    [
      'one span on each of two lines',
      '`a`\n`b`',
      [
        {start: 0, end: 3},
        {start: 4, end: 7},
      ],
    ],
    ['a carriage return stays in the line', '`a\r`', [{start: 0, end: 4}]],
    ['a backtick fence', '```\ncode\n```', [{start: 0, end: 12}]],
    ['a tilde fence', '~~~\n`a`\n~~~', [{start: 0, end: 11}]],
    ['a fence closed by a longer marker', '```\ncode\n`````', [{start: 0, end: 14}]],
    ['a fence not closed by a shorter marker, so it runs to the end', '````\ncode\n```', [{start: 0, end: 13}]],
    ['an unclosed fence runs to the end', '```\ncode', [{start: 0, end: 8}]],
    ['a backtick fence whose info string has a backtick is not a fence', '```a`b```', [{start: 0, end: 9}]],
    ['a tilde fence whose info string has a backtick is a fence', '~~~a`b\nx\n~~~', [{start: 0, end: 12}]],
    ['an indented fence opener', '   ```\nx\n   ```', [{start: 0, end: 15}]],
    ['a fence opener indented four spaces is not a fence', '    ```\nx\n    ```', []],
    ['a fence line closed with trailing spaces', '```\nx\n``` \t', [{start: 0, end: 11}]],
    ['a fence line closed with trailing text is not closed', '```\nx\n``` y', [{start: 0, end: 11}]],
    [
      'a span after a closed fence',
      '```\nx\n```\n`a`',
      [
        {start: 0, end: 9},
        {start: 10, end: 13},
      ],
    ],
    ['spans inside a fence are not found', '```\n`a`\n```', [{start: 0, end: 11}]],
    [
      'an astral character between spans',
      '`😀` `😀`',
      [
        {start: 0, end: 4},
        {start: 5, end: 9},
      ],
    ],
  ] as const)('%s', (_name, content, expected) => {
    expect(oldFindCodeRegions(content)).toStrictEqual(expected)
    expect(findCodeRegions(content)).toStrictEqual(expected)
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

const TOKENS: readonly (readonly [string, number])[] = [
  ['`', 16],
  ['``', 14],
  ['```', 9],
  ['````', 5],
  ['`````', 3],
  ['\\', 5],
  [' ', 9],
  ['\n', 7],
  ['\r\n', 1],
  ['\t', 1],
  ['a', 9],
  ['b c', 3],
  ['```\n', 3],
  ['```js\n', 1],
  ['~~~\n', 2],
  ['````\n', 1],
  ['   ```\n', 1],
  ['    ```\n', 1],
  ['😀', 1],
  ['\uD800', 1],
]
// Half the bodies leave out the lines that open a fence, so that most of the body is scanned for inline spans
// instead of being swallowed by a fence.
const INLINE_TOKENS = TOKENS.filter(([token]) => !/^ *(?:`{3,}|~{3,})[a-z]*\n$/u.test(token))

function totalWeight(tokens: readonly (readonly [string, number])[]): number {
  return tokens.reduce((sum, [, weight]) => sum + weight, 0)
}

function weightedBody(next: () => number, maxTokens: number): string {
  const tokens = next() < 0.5 ? INLINE_TOKENS : TOKENS
  const total = totalWeight(tokens)
  let body = ''
  for (let remaining = 1 + Math.floor(next() * maxTokens); remaining > 0; remaining -= 1) {
    let roll = next() * total
    for (const [token, weight] of tokens) {
      roll -= weight
      if (roll < 0) {
        body += token
        break
      }
    }
  }
  return body
}

/** The number of backticks a region opens with. */
function openingRun(content: string, region: CodeRegion): number {
  let length = 0
  while (content[region.start + length] === '`') length += 1
  return length
}

describe('findCodeRegions against the rescanning reference on weighted bodies', () => {
  it('finds the same regions in 60,000 bodies, and the bodies reach each shape', () => {
    let total = 0
    let withRegions = 0
    let withSpans = 0
    let severalLengths = 0
    let unmatchedRun = 0
    let multiLine = 0
    let escapedBeforeRun = 0
    let spanAfterUnmatchedOpener = 0
    for (const seed of [0x5eed1, 0x5eed2, 0x5eed3]) {
      const next = seeded(seed)
      for (let sample = 0; sample < 20_000; sample += 1) {
        const body = weightedBody(next, 30)
        const expected = oldFindCodeRegions(body)
        const actual = findCodeRegions(body)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          expect.fail(
            `seed ${seed} body #${sample} ${JSON.stringify(body)}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
          )
        }

        total += 1
        if (expected.length > 0) withRegions += 1
        const spans = expected.filter(region => !body.slice(region.start, region.end).includes('\n'))
        if (spans.length > 0) withSpans += 1
        if (new Set(spans.map(span => openingRun(body, span))).size > 1) severalLengths += 1
        if (expected.some(region => body.slice(region.start, region.end).includes('\n'))) multiLine += 1
        if (body.includes('\\`')) escapedBeforeRun += 1

        // A backtick that no region covers, outside a line that opens a fence: an opener left literal.
        const covered = (offset: number) => expected.some(region => offset >= region.start && offset < region.end)
        const firstBare = [...body].findIndex((character, offset) => character === '`' && !covered(offset))
        if (firstBare !== -1) unmatchedRun += 1
        // A span that starts after a run that was left literal: the scan resumed after the unmatched opener.
        if (firstBare !== -1 && spans.some(span => span.start > firstBare)) spanAfterUnmatchedOpener += 1
      }
    }

    expect(total).toBe(60_000)
    // Not vacuous: these shares come from the generator, so a change to its weights that stopped reaching one
    // of the shapes fails here instead of quietly weakening the differential.
    expect(withRegions / total).toBeGreaterThan(0.55)
    expect(withSpans / total).toBeGreaterThan(0.25)
    expect(severalLengths).toBeGreaterThan(1500)
    expect(unmatchedRun / total).toBeGreaterThan(0.55)
    expect(spanAfterUnmatchedOpener).toBeGreaterThan(8000)
    expect(multiLine).toBeGreaterThan(15_000)
    expect(escapedBeforeRun).toBeGreaterThan(15_000)
  })
})

// ─── Time: the shape that cost the rescanning scan the most ───

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

/**
 * One line of `openers` unmatched runs of the distinct lengths 2, 4, ... and then single backticks. Every
 * opener has no partner, so the rescanning scan read every single backtick after it again for each of them.
 */
function distinctOpenersThenSingles(length: number): string {
  const openers = Math.floor(Math.sqrt(length / 2))
  let line = ''
  for (let opener = 1; opener <= openers; opener += 1) line += `${'`'.repeat(2 * opener)}a`
  return line + '` '.repeat(Math.max(0, Math.floor((length - line.length) / 2)))
}

describe('findCodeRegions runs in linear time', () => {
  const BOUND_MS = 1000
  const TIMEOUT_MS = 120_000

  it(
    'a line of 1.2 MB of unmatched openers of distinct lengths followed by single backticks',
    () => {
      const line = distinctOpenersThenSingles(1_200_000)
      expect(line.length).toBeGreaterThan(1_100_000)
      expect(fastestOfThree(() => findCodeRegions(line))).toBeLessThan(BOUND_MS)
      // The single backticks after the openers pair up with each other, two at a time.
      const regions = findCodeRegions(line)
      expect(regions.length).toBeGreaterThan(100_000)
      expect(regions.every(region => region.end - region.start === 3)).toBe(true)
    },
    TIMEOUT_MS,
  )

  it(
    'a line of 600,000 characters of backtick runs of increasing length, none of which has a partner',
    () => {
      // Every run is longer than the one before it, so no two runs have the same length.
      let line = ''
      for (let run = 1; line.length < 600_000; run += 1) line += `${'`'.repeat(run)}a`
      expect(fastestOfThree(() => findCodeRegions(line))).toBeLessThan(BOUND_MS)
      expect(findCodeRegions(line)).toStrictEqual([])
    },
    TIMEOUT_MS,
  )

  it(
    'a line of 1 MB of single backtick pairs',
    () => {
      const line = '`a` '.repeat(250_000)
      expect(fastestOfThree(() => findCodeRegions(line))).toBeLessThan(BOUND_MS)
      expect(findCodeRegions(line)).toHaveLength(250_000)
    },
    TIMEOUT_MS,
  )

  it(
    '60,000 short lines, each with an unmatched opener',
    () => {
      const content = '``a` b\n'.repeat(60_000)
      expect(fastestOfThree(() => findCodeRegions(content))).toBeLessThan(BOUND_MS)
      expect(findCodeRegions(content)).toStrictEqual([])
    },
    TIMEOUT_MS,
  )
})
