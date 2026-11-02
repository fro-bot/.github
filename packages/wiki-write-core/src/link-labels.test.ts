/**
 * `replaceLinkLabels` replaced a regex that rescanned the rest of the text from every unclosed `[`. This file
 * pins that it finds exactly the links the regex found, with the same capture groups, and runs in linear
 * time. The old regex is kept here as the reference.
 */

import {describe, expect, it} from 'vitest'
import {normalizeFormattingText} from './corrections-survival.ts'
import {replaceLinkLabels, type LinkLabelParts} from './link-labels.ts'

// ─── The reference: the regex as it was ───

const OLD_LINK_PATTERN = /!?(?:\[([^\]]*)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/gu

function describeParts(parts: LinkLabelParts): string {
  return `<${JSON.stringify([parts.markdownText ?? null, parts.wikiTarget ?? null, parts.wikiLabel ?? null])}>`
}

function oldReplace(text: string): string {
  return text.replaceAll(
    OLD_LINK_PATTERN,
    (_match: string, markdownText: string | undefined, wikiTarget: string | undefined, wikiLabel: string | undefined) =>
      describeParts({markdownText, wikiTarget, wikiLabel}),
  )
}

function newReplace(text: string): string {
  return replaceLinkLabels(text, describeParts)
}

function oldNormalizeFormattingText(value: string): string {
  return value
    .normalize('NFKC')
    .replaceAll(
      OLD_LINK_PATTERN,
      (
        _match: string,
        markdownText: string | undefined,
        wikiTarget: string | undefined,
        wikiLabel: string | undefined,
      ) => markdownText ?? wikiLabel ?? wikiTarget ?? '',
    )
    .replaceAll(/[^\p{L}\p{N}]/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase()
}

// ─── Explicit cases: each is also checked against the reference ───

describe('replaceLinkLabels', () => {
  it.each([
    ['no link', 'plain text', 'plain text'],
    ['a markdown link', 'see [label](target) now', 'see <["label",null,null]> now'],
    ['an image', 'see ![alt](pic.png) now', 'see <["alt",null,null]> now'],
    ['an empty markdown label', '[](x)', '<["",null,null]>'],
    ['a markdown target with spaces and newlines', '[a](b c\nd)', '<["a",null,null]>'],
    ['a bracket inside the markdown label', '[a[b](c)', '<["a[b",null,null]>'],
    ['a wiki link', '[[target]]', '<[null,"target",null]>'],
    ['a wiki link with a label', '[[target|label]]', '<[null,"target","label"]>'],
    ['an image wiki link', '![[target]]', '<[null,"target",null]>'],
    ['an empty wiki target', '[[]]', '[[]]'],
    ['an empty wiki label', '[[a|]]', '[[a|]]'],
    ['a wiki link with a second pipe in the label', '[[a|b|c]]', '<[null,"a","b|c"]>'],
    ['a wiki target holding a bracket', '[[a[b]]', '<[null,"a[b",null]>'],
    ['a wiki link that is also a markdown link: the markdown form wins', '[[a](b)]]', '<["[a",null,null]>]]'],
    ['a wiki link followed by a paren', '[[a]](b)', '<[null,"a",null]>(b)'],
    ['two links', '[a](b) [[c]]', '<["a",null,null]> <[null,"c",null]>'],
    ['links back to back', '[a](b)[[c]]![d](e)', '<["a",null,null]><[null,"c",null]><["d",null,null]>'],
    ['a bang that an earlier match took', '[a](b)![c](d)', '<["a",null,null]><["c",null,null]>'],
    ['two bangs: the second belongs to the link', '!![a](b)', '!<["a",null,null]>'],
    ['an unclosed bracket, then a link', '[x [a](b)', '<["x [a",null,null]>'],
    ['an unclosed paren', '[a](b', '[a](b'],
    ['an unclosed wiki link', '[[a', '[[a'],
    ['an astral character in the label', '[😀](x)', '<["😀",null,null]>'],
    ['nothing', '', ''],
  ] as const)('%s', (_name, text, expected) => {
    expect(oldReplace(text)).toBe(expected)
    expect(newReplace(text)).toBe(expected)
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

const TOKENS: Tokens = [
  ['[', 14],
  [']', 12],
  ['(', 10],
  [')', 10],
  ['|', 8],
  ['!', 6],
  ['[[', 8],
  [']]', 8],
  ['](', 8],
  ['[a](b)', 4],
  ['[[a|b]]', 4],
  ['[[a]]', 3],
  ['![', 3],
  ['a', 6],
  ['b c', 2],
  [' ', 4],
  ['\n', 2],
  ['😀', 1],
  ['\uD800', 1],
  ['é', 1],
]

function drawStrings(seed: number, count: number, maxTokens: number): string[] {
  const total = TOKENS.reduce((sum, [, weight]) => sum + weight, 0)
  const random = seeded(seed)
  const strings: string[] = []
  for (let index = 0; index < count; index++) {
    let text = ''
    for (let remaining = 1 + Math.floor(random() * maxTokens); remaining > 0; remaining--) {
      let roll = random() * total
      for (const [token, weight] of TOKENS) {
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

const SEEDS = [20_261_105, 4096, 48] as const
const PER_SEED = 20_000

describe('replaceLinkLabels against the regex it replaced', () => {
  it('replaces identically in 60,000 seeded strings, and normalizeFormattingText agrees', () => {
    let total = 0
    let withMatches = 0
    let withSeveral = 0
    let images = 0
    let wiki = 0
    for (const seed of SEEDS) {
      for (const [index, text] of drawStrings(seed, PER_SEED, 18).entries()) {
        const expected = oldReplace(text)
        if (newReplace(text) !== expected) {
          expect.fail(
            `seed ${seed} string #${index} ${JSON.stringify(text)}: ${JSON.stringify(expected)} vs ${JSON.stringify(newReplace(text))}`,
          )
        }
        if (normalizeFormattingText(text) !== oldNormalizeFormattingText(text)) {
          expect.fail(`seed ${seed} string #${index} ${JSON.stringify(text)}: normalizeFormattingText differs`)
        }
        total += 1
        const matches = text.match(OLD_LINK_PATTERN) ?? []
        if (matches.length > 0) withMatches += 1
        if (matches.length > 1) withSeveral += 1
        images += matches.filter(match => match.startsWith('!')).length
        wiki += matches.filter(match => match.startsWith('[[') || match.startsWith('![[')).length
      }
    }
    expect(total).toBe(60_000)
    expect(withMatches / total).toBeGreaterThan(0.3)
    expect(withMatches / total).toBeLessThan(0.97)
    expect(withSeveral).toBeGreaterThan(3000)
    expect(images).toBeGreaterThan(1000)
    expect(wiki).toBeGreaterThan(3000)
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

describe('linear time on adversarial text', () => {
  const BOUND_MS = 1000
  const TIMEOUT_MS = 120_000

  it.each([
    ['an opening bracket repeated', (n: number) => '['.repeat(n), 100_000],
    ['an opening wiki bracket pair repeated', (n: number) => '[['.repeat(n), 50_000],
    ['an unterminated wiki label repeated', (n: number) => '[[a|'.repeat(n), 50_000],
    ['an unclosed markdown link repeated', (n: number) => '[a]('.repeat(n), 50_000],
  ] as const)(
    'normalizeFormattingText: %s',
    (_name, build, count) => {
      const text = build(count)
      expect(fastestOfThree(() => normalizeFormattingText(text))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )
})
