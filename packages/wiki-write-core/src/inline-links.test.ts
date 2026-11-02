/**
 * The inline-link scanner runs on wiki pages and repository docs of any size, so it must cost time linear in
 * the length of a line, and it must find exactly the links the regex it replaced found. The old regex and the
 * old `resolveMarkdownLinks` loop are kept here as the reference; seeded random lines and bodies are run
 * through both, and so is every UTF-16 code unit in each position where whitespace matters.
 */

import {existsSync} from 'node:fs'
import {dirname, join, normalize} from 'node:path'
import process from 'node:process'

import {describe, expect, it} from 'vitest'
import {findCodeRegions, findRegionAt} from './code-regions.ts'
import {createInlineLinkFinder, type InlineLink} from './inline-links.ts'
import {resolveMarkdownLinks, type MarkdownLink} from './markdown-links.ts'

// ─── The reference: the regex and the loop as they were before the scanner ───

const OLD_MARKDOWN_LINK_PATTERN =
  /\[[^\]\n]+\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gu

function oldFind(line: string, from: number): InlineLink | undefined {
  OLD_MARKDOWN_LINK_PATTERN.lastIndex = from
  const match = OLD_MARKDOWN_LINK_PATTERN.exec(line)
  const target = match?.[1]
  if (match === null || target === undefined) return undefined
  return {index: match.index, length: match[0].length, target}
}

function oldAllLinks(line: string): InlineLink[] {
  const links: InlineLink[] = []
  for (let link = oldFind(line, 0); link !== undefined; link = oldFind(line, link.index + link.length)) {
    links.push(link)
  }
  return links
}

function newAllLinks(line: string): InlineLink[] {
  const find = createInlineLinkFinder(line)
  const links: InlineLink[] = []
  for (let link = find(0); link !== undefined; link = find(link.index + link.length)) links.push(link)
  return links
}

function oldIsSkippedTarget(target: string): boolean {
  return target === '' || target.startsWith('#') || target.startsWith('//') || /^(?:https?:|mailto:)/iu.test(target)
}

function oldStripSuffix(target: string): string {
  const fragmentIndex = target.indexOf('#')
  const queryIndex = target.indexOf('?')
  const suffixIndex = [fragmentIndex, queryIndex].filter(index => index >= 0).sort((a, b) => a - b)[0]
  return suffixIndex === undefined ? target : target.slice(0, suffixIndex)
}

/** `resolveMarkdownLinks` as it was: the global regex, with its `lastIndex` resumption after a rejected match. */
function oldResolveMarkdownLinks(
  content: string,
  containingFile: string,
  files: Readonly<Record<string, string>>,
): MarkdownLink[] {
  const links: MarkdownLink[] = []
  const regions = findCodeRegions(content)
  let lineOffset = 0

  for (const [lineIndex, line] of content.split('\n').entries()) {
    const currentLineOffset = lineOffset
    lineOffset += line.length + 1

    OLD_MARKDOWN_LINK_PATTERN.lastIndex = 0
    for (
      let match = OLD_MARKDOWN_LINK_PATTERN.exec(line);
      match !== null;
      match = OLD_MARKDOWN_LINK_PATTERN.exec(line)
    ) {
      const target = match[1]
      const matchIndex = match.index
      if (target === undefined || (matchIndex > 0 && line[matchIndex - 1] === '!')) {
        continue
      }

      const matchStart = currentLineOffset + matchIndex
      const matchLast = matchStart + match[0].length - 1
      const openingRegion = findRegionAt(regions, matchStart)
      if (openingRegion !== undefined) {
        OLD_MARKDOWN_LINK_PATTERN.lastIndex = Math.max(openingRegion.end - currentLineOffset, matchIndex + 1)
        continue
      }
      if (findRegionAt(regions, matchLast) !== undefined) {
        OLD_MARKDOWN_LINK_PATTERN.lastIndex = matchIndex + 1
        continue
      }

      const normalizedTarget = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
      if (oldIsSkippedTarget(normalizedTarget)) {
        continue
      }

      const pathTarget = oldStripSuffix(normalizedTarget)
      if (pathTarget === '') {
        continue
      }

      const resolvedPath = normalize(
        pathTarget.startsWith('/') ? pathTarget.slice(1) : join(dirname(containingFile), pathTarget),
      ).replaceAll('\\', '/')
      const exists = files[resolvedPath] !== undefined
      links.push({target: normalizedTarget, line: lineIndex + 1, resolvedPath, exists})
    }
  }

  return links
}

// ─── Explicit cases: each is also checked against the reference, so the table states what the regex did ───

interface ExpectedLink {
  readonly at: number
  readonly text: string
  readonly target: string
}

function expectLinks(line: string, expected: readonly ExpectedLink[]): void {
  const shape = (links: readonly InlineLink[]) =>
    links.map(link => ({at: link.index, text: line.slice(link.index, link.index + link.length), target: link.target}))
  expect(shape(oldAllLinks(line))).toStrictEqual(expected)
  expect(shape(newAllLinks(line))).toStrictEqual(expected)
}

describe('createInlineLinkFinder: what a link is', () => {
  it.each([
    ['a plain link', '[a](b.md)', [{at: 0, text: '[a](b.md)', target: 'b.md'}]],
    ['text around it', 'see [a](b.md) now', [{at: 4, text: '[a](b.md)', target: 'b.md'}]],
    [
      'two links',
      '[a](b) [c](d)',
      [
        {at: 0, text: '[a](b)', target: 'b'},
        {at: 7, text: '[c](d)', target: 'd'},
      ],
    ],
    ['whitespace inside the parentheses', '[a](  b  )', [{at: 0, text: '[a](  b  )', target: 'b'}]],
    ['tabs and carriage returns count as whitespace', '[a](\t\rb\r\t)', [{at: 0, text: '[a](\t\rb\r\t)', target: 'b'}]],
    ['a double-quoted title', '[a](b "t")', [{at: 0, text: '[a](b "t")', target: 'b'}]],
    ['a single-quoted title', "[a](b 't')", [{at: 0, text: "[a](b 't')", target: 'b'}]],
    ['a parenthesised title', '[a](b (t))', [{at: 0, text: '[a](b (t))', target: 'b'}]],
    ['an empty title', '[a](b "")', [{at: 0, text: '[a](b "")', target: 'b'}]],
    ['a title with a paren and spaces inside', '[a](b "x (y) z")', [{at: 0, text: '[a](b "x (y) z")', target: 'b'}]],
    ['whitespace around a title', '[a](b   "t"   )', [{at: 0, text: '[a](b   "t"   )', target: 'b'}]],
    ['an angle destination', '[a](<b c>)', [{at: 0, text: '[a](<b c>)', target: '<b c>'}]],
    ['an angle destination with a title', '[a](<b c> "t")', [{at: 0, text: '[a](<b c> "t")', target: '<b c>'}]],
    ['an angle destination with a paren inside', '[a](<b)c>)', [{at: 0, text: '[a](<b)c>)', target: '<b)c>'}]],
    ['text that holds a bracket: the leftmost start wins', '[[a](b)', [{at: 0, text: '[[a](b)', target: 'b'}]],
    ['text that holds a bracket after the first', '[a[b](c)', [{at: 0, text: '[a[b](c)', target: 'c'}]],
    [
      'a destination with a paren inside it is cut at the first one',
      '[a](b(c))',
      [{at: 0, text: '[a](b(c)', target: 'b(c'}],
    ],
    ['an unterminated title falls back to the destination alone', '[a](b "t)', []],
    ['an unterminated title, then a good link', '[a](b "t) [c](d)', [{at: 10, text: '[c](d)', target: 'd'}]],
    [
      'an angle form that is not closed falls back to the bare run',
      '[a](<b)',
      [{at: 0, text: '[a](<b)', target: '<b'}],
    ],
    [
      'an angle form followed by junk falls back to the bare run',
      '[a](<b>x)',
      [{at: 0, text: '[a](<b>x)', target: '<b>x'}],
    ],
    ['an angle form with a space and no close falls back and fails', '[a](<b c)', []],
    ['an empty angle form falls back to the bare run', '[a](<>)', [{at: 0, text: '[a](<>)', target: '<>'}]],
    ['an empty text is not a link', '[](b)', []],
    ['an empty destination is not a link', '[a]()', []],
    ['a destination of spaces is not a link', '[a](   )', []],
    ['no parenthesis after the bracket', '[a] (b)', []],
    ['a bracket and a newline in the text', '[a\nb](c)', []],
    ['text closed by a bracket that is not followed by a paren', '[a]b](c)', []],
    ['an unclosed link', '[a](b', []],
    ['a title with a newline inside', '[a](b "t\nu")', []],
    ['a no-break space is whitespace', '[a](\u00A0b\u3000)', [{at: 0, text: '[a](\u00A0b\u3000)', target: 'b'}]],
    ['a line separator is whitespace', '[a](b\u2028"t")', [{at: 0, text: '[a](b\u2028"t")', target: 'b'}]],
    [
      'an astral character in the text and the destination',
      '[😀](😀.md)',
      [{at: 0, text: '[😀](😀.md)', target: '😀.md'}],
    ],
    ['a lone surrogate in the destination', '[a](\uD800.md)', [{at: 0, text: '[a](\uD800.md)', target: '\uD800.md'}]],
    ['an image prefix is part of the line, not of the match', '![a](b)', [{at: 1, text: '[a](b)', target: 'b'}]],
    ['nothing', '', []],
    ['no bracket-paren pair', 'plain text [x] (y)', []],
  ] as const)('%s', (_name, line, expected) => {
    expectLinks(line, expected)
  })

  it('finds from an offset exactly as the regex does from its lastIndex', () => {
    const line = '[a](b) [c](d) [e](f)'
    const find = createInlineLinkFinder(line)
    for (let from = 0; from <= line.length + 2; from += 1) {
      expect(find(from), `from ${from}`).toStrictEqual(oldFind(line, from))
    }
  })

  it('answers the same from any offset in any order', () => {
    const line = '[a](b "t") [c](<d e>) [[f](g) [h](i (j)'
    const find = createInlineLinkFinder(line)
    for (const from of [30, 0, 11, 5, 22, 3, 38, 0, 40, 100]) {
      expect(find(from), `from ${from}`).toStrictEqual(oldFind(line, from))
    }
  })
})

// ─── Every code unit, in every position where whitespace is read ───

describe('createInlineLinkFinder: every UTF-16 code unit', () => {
  const templates: readonly ((unit: string) => string)[] = [
    unit => `[a](${unit}b)`,
    unit => `[a](b${unit})`,
    unit => `[a](b${unit}"t")`,
    unit => `[a](b "t"${unit})`,
    unit => `[a](b "t${unit}u")`,
    unit => `[a](b 't${unit}u')`,
    unit => `[a](b (t${unit}u))`,
    unit => `[a](<b${unit}c>)`,
    unit => `[a](<b>${unit})`,
    unit => `[a](${unit}<b>${unit}"t"${unit})`,
    unit => `[a${unit}b](c)`,
    unit => `[a]${unit}(b)`,
    unit => `[a](b${unit}${unit}"t")`,
    unit => `[a](${unit})`,
    unit => `[a](<${unit}>)`,
    unit => `[${unit}](b)`,
  ]

  it('agrees with the regex for all 65,536 code units in 16 templates', () => {
    let linkCount = 0
    for (let code = 0; code <= 0xff_ff; code += 1) {
      const unit = String.fromCharCode(code)
      for (const [index, template] of templates.entries()) {
        const line = template(unit)
        const expected = oldAllLinks(line)
        const actual = newAllLinks(line)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          expect.fail(`code ${code.toString(16)} template ${index} ${JSON.stringify(line)}`)
        }
        linkCount += expected.length
      }
    }
    // The comparison is not vacuous: whitespace makes some of the 1,048,576 lines links and others not.
    expect(linkCount).toBeGreaterThan(200_000)
    expect(linkCount).toBeLessThan(1_000_000)
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

const LINK_TOKENS: Tokens = [
  ['[', 14],
  [']', 12],
  ['(', 10],
  [')', 12],
  ['<', 7],
  ['>', 7],
  ['!', 5],
  ['\\', 4],
  ['"', 8],
  ["'", 6],
  [' ', 10],
  ['\n', 2],
  ['\t', 2],
  ['\r', 1],
  ['\u00A0', 1],
  ['\u2028', 1],
  ['\u3000', 1],
  ['](', 14],
  ['[a](', 8],
  ['[a](b)', 5],
  ['[a](<b>)', 3],
  ['[a](b "t")', 3],
  ['](<', 3],
  ['a', 8],
  ['b', 6],
  ['x.md', 4],
  ['/', 4],
  [':', 2],
  ['.', 3],
  ['#', 3],
  ['?', 2],
  ['-', 2],
  ['_', 2],
  ['=', 2],
  ['&', 1],
  ['😀', 1],
  ['\uD800', 1],
  ['`', 2],
]

const BODY_TOKENS: Tokens = [
  ...LINK_TOKENS,
  ['`', 20],
  ['``', 6],
  ['```', 5],
  ['```\n', 6],
  ['~~~\n', 3],
  ['\n', 10],
  ['\\`', 1],
  ['[a](b.md)', 6],
  ['[a](#top)', 2],
  ['[a](https://x.example)', 2],
  ['[a](/root.md)', 2],
  ['[a](../up.md)', 2],
  ['![a](img.png)', 2],
]

function drawStrings(tokens: Tokens, seed: number, count: number, maxTokens: number): string[] {
  const total = tokens.reduce((sum, [, weight]) => sum + weight, 0)
  const random = seeded(seed)
  const strings: string[] = []
  for (let index = 0; index < count; index++) {
    let text = ''
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

const SEEDS = [20_261_103, 4094, 46] as const
const PER_SEED = 20_000

describe('createInlineLinkFinder: against the regex on seeded lines', () => {
  it('finds the same links in 60,000 seeded lines, and from the same offsets', () => {
    let total = 0
    let withLinks = 0
    let withSeveral = 0
    let angle = 0
    let angleFallback = 0
    let titled = 0
    let fromChecks = 0

    for (const seed of SEEDS) {
      const random = seeded(seed ^ 0x5a_5a)
      for (const [index, line] of drawStrings(LINK_TOKENS, seed, PER_SEED, 22).entries()) {
        const expected = oldAllLinks(line)
        const actual = newAllLinks(line)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          expect.fail(
            `seed ${seed} line #${index} ${JSON.stringify(line)}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
          )
        }

        // One finder, many queries: any offset, any order, as the resumption after a rejected link does.
        const find = createInlineLinkFinder(line)
        for (let query = 0; query < 4; query++) {
          const from = Math.floor(random() * (line.length + 2))
          const old = oldFind(line, from)
          const now = find(from)
          if (JSON.stringify(now) !== JSON.stringify(old)) {
            expect.fail(
              `seed ${seed} line #${index} ${JSON.stringify(line)} from ${from}: ${JSON.stringify(old)} vs ${JSON.stringify(now)}`,
            )
          }
          fromChecks += 1
        }

        total += 1
        if (expected.length > 0) withLinks += 1
        if (expected.length > 1) withSeveral += 1
        for (const link of expected) {
          const text = line.slice(link.index, link.index + link.length)
          if (link.target.startsWith('<') && link.target.endsWith('>') && link.target.length > 2) angle += 1
          else if (link.target.startsWith('<')) angleFallback += 1
          if (/\s["'(]/u.test(text.slice(link.target.length))) titled += 1
        }
      }
    }

    expect(total).toBe(60_000)
    expect(fromChecks).toBe(240_000)
    // The draw reaches each branch of the grammar, so a generator that stopped exercising one would fail here.
    expect(withLinks / total).toBeGreaterThan(0.2)
    expect(withLinks / total).toBeLessThan(0.8)
    expect(withSeveral).toBeGreaterThan(1500)
    expect(angle).toBeGreaterThan(500)
    expect(angleFallback).toBeGreaterThan(100)
    expect(titled).toBeGreaterThan(500)
  })
})

describe('resolveMarkdownLinks: against the loop it replaced on seeded bodies', () => {
  const FILES: readonly Readonly<Record<string, string>>[] = [
    {},
    {'a/b.md': '', 'x.md': '', 'root.md': '', 'up.md': ''},
  ]

  it('returns the same links, in the same order, for 60,000 seeded bodies', () => {
    let total = 0
    let withLinks = 0
    let withRegions = 0
    let rejected = 0
    let existing = 0

    for (const seed of SEEDS) {
      for (const [index, body] of drawStrings(BODY_TOKENS, seed + 1, PER_SEED, 26).entries()) {
        const files = FILES[index % FILES.length] ?? {}
        const expected = oldResolveMarkdownLinks(body, 'a/page.md', files)
        const actual = resolveMarkdownLinks(body, 'a/page.md', {files})
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          expect.fail(
            `seed ${seed} body #${index} ${JSON.stringify(body)}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
          )
        }

        total += 1
        if (expected.length > 0) withLinks += 1
        if (findCodeRegions(body).length > 0) withRegions += 1
        // A link the pattern finds that code swallows: the old loop resumed inside the region.
        if (oldAllLinks(body.replaceAll('\n', ' ')).length > expected.length) rejected += 1
        existing += expected.filter(link => link.exists).length
      }
    }

    expect(total).toBe(60_000)
    expect(withLinks / total).toBeGreaterThan(0.15)
    expect(withRegions / total).toBeGreaterThan(0.3)
    expect(rejected).toBeGreaterThan(1000)
    expect(existing).toBeGreaterThan(500)
  })

  it('reads the real file system the way it did', () => {
    const content = '[a](package.json) [b](missing-file-for-test.md) [c](<package.json> "t")'
    const rootDir = process.cwd()
    const actual = resolveMarkdownLinks(content, 'README.md', {rootDir})
    expect(actual.map(link => [link.target, link.exists])).toStrictEqual([
      ['package.json', existsSync(join(rootDir, 'package.json'))],
      ['missing-file-for-test.md', false],
      ['package.json', existsSync(join(rootDir, 'package.json'))],
    ])
  })
})

// ─── Time: the strings CodeQL reported for alerts 46 and 47 ───

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

describe('createInlineLinkFinder: linear time on adversarial lines', () => {
  const BOUND_MS = 1000
  const TIMEOUT_MS = 120_000

  it.each([
    ['an opening bracket repeated', 100_000, (n: number) => `[${'['.repeat(n)}`],
    ['`[](<` then `[=](<` repeated', 20_000, (n: number) => `[](<${'[=](<'.repeat(n)}`],
    ['`[\\](<` then `[=](<` repeated', 20_000, (n: number) => String.raw`[\](<${'[=](<'.repeat(n)}`],
    ['`[](` then `[!](!` repeated', 20_000, (n: number) => `[](${'[!](!'.repeat(n)}`],
    ['`[](! (` then `[(](! (` repeated', 20_000, (n: number) => `[](! (${'[(](! ('.repeat(n)}`],
    ['`[](! (` then `[(](! (` repeated and closed', 20_000, (n: number) => `[](! (${'[(](! ('.repeat(n)})`],
    ['a double-quote title opener repeated', 20_000, (n: number) => `[a](x "${'[b](y "'.repeat(n)}`],
    ['a single-quote title opener repeated', 20_000, (n: number) => `[a](x '${"[b](y '".repeat(n)}`],
    ['an angle opener with no close', 100_000, (n: number) => `[a](<${'x'.repeat(n)}`],
    ['a run of spaces after the paren', 100_000, (n: number) => `[a](${' '.repeat(n)}`],
    ['a long destination with no close', 100_000, (n: number) => `[a](${'x'.repeat(n)}`],
  ] as const)(
    '%s (%d times): resolveMarkdownLinks and the finder stay under a second',
    (_name, count, build) => {
      const line = build(count)
      expect(fastestOfThree(() => resolveMarkdownLinks(line, 'a/page.md', {files: {}}))).toBeLessThan(BOUND_MS)
      expect(fastestOfThree(() => newAllLinks(line))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'a body of 20,000 lines, each holding an unclosed link, stays under a second',
    () => {
      const body = '[a](<b c "d\n'.repeat(20_000)
      expect(fastestOfThree(() => resolveMarkdownLinks(body, 'a/page.md', {files: {}}))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )
})
