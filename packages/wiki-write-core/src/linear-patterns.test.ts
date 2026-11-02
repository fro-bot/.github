/**
 * The rendering-policy checks and `truncateToBytes` used to rescan long runs from every position in them, so
 * their cost grew with the square of the input. They now run in linear time. The old patterns are kept here as
 * the reference; seeded random inputs are run through both, and the adversarial inputs are bounded in time.
 */

import {Buffer} from 'node:buffer'
import {describe, expect, it} from 'vitest'
import {maskCodeContent, validateRenderingPolicy} from './rendering-policy.ts'
import {byteLength, truncateToBytes} from './wiki-utils.ts'

// ─── The reference: the patterns as they were ───

const OLD_UNSAFE_TAG_PATTERN =
  /<\/?\s*(?:script|iframe|object|embed|applet|base|form|input|button|textarea|select|option|meta|link|style|template|svg|math)\b[^>]*>/iu
const OLD_EVENT_HANDLER_PATTERN = /\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/iu
const OLD_UNSAFE_URI_PATTERN =
  /\s+(?:href|src|srcset|action|formaction|xlink:href|poster|background|cite)\s*=\s*(?:"\s*|')?(?:javascript|vbscript|data):/iu

function oldIsUnsafe(content: string): boolean {
  const renderable = maskCodeContent(content)
  return (
    OLD_UNSAFE_TAG_PATTERN.test(renderable) ||
    OLD_EVENT_HANDLER_PATTERN.test(renderable) ||
    OLD_UNSAFE_URI_PATTERN.test(renderable)
  )
}

function isUnsafe(content: string): boolean {
  return validateRenderingPolicy({path: 'knowledge/wiki/topics/page.md', content}).length > 0
}

function oldTruncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value
  }

  const ellipsis = '…'
  const contentBudget = maxBytes - byteLength(ellipsis)
  if (contentBudget <= 0) {
    return ''
  }

  const truncated = Buffer.from(value)
    .subarray(0, contentBudget)
    .toString('utf8')
    .replaceAll(/\uFFFD+$/gu, '')

  return truncated === '' ? '' : `${truncated}${ellipsis}`
}

// ─── Explicit cases ───

describe('validateRenderingPolicy', () => {
  it.each([
    ['a script tag', '<script>alert(1)</script>', true],
    ['a closing style tag', 'text </style> text', true],
    ['an opening with no `>` after it', '<script src=x', false],
    ['an opening whose `>` is far after the name', `<iframe${' '.repeat(50)}\n\n>`, true],
    ['a tag name that is a prefix of a longer word', '<basefont>', false],
    ['whitespace between the bracket and the name', '< \n script>', true],
    ['an event handler', '<p onclick="x">', true],
    ['an event handler with an unquoted value', '<p onerror=alert(1)>', true],
    ['an event handler after many spaces', `<p${' '.repeat(40)}onload="x">`, true],
    ['`on` without an attribute name', '<p on="x">', false],
    ['a javascript URI', '<a href="javascript:x">', true],
    ['a data URI with spaces after the quote', '<img src=" data:x">', true],
    ['a quoted https URI', '<a href="https://x">', false],
    ['an unsafe tag in a code span', 'see `<script>` here', false],
    ['an unsafe tag in a fence', '```html\n<script>x</script>\n```', false],
    ['plain prose', 'nothing to see', false],
    ['nothing', '', false],
  ] as const)('%s', (_name, content, expected) => {
    expect(oldIsUnsafe(content)).toBe(expected)
    expect(isUnsafe(content)).toBe(expected)
  })
})

describe('truncateToBytes', () => {
  it.each([
    ['a value that fits', 'hello', 10, 'hello'],
    ['a cut at a character boundary', 'abcdefgh', 6, 'abc…'],
    ['a cut inside a multi-byte character drops the broken tail', 'abc日本語', 8, 'abc…'],
    ['a cut that leaves only a broken character', '日日日', 5, ''],
    ['a replacement character that was in the value, mid-string', 'a\uFFFDb日日日日', 9, 'a\uFFFDb…'],
    ['a run of replacement characters in the value at the cut', 'ab\uFFFD\uFFFD\uFFFD日日日日', 12, 'ab…'],
    ['a budget of nothing', 'abcdef', 3, ''],
  ] as const)('%s', (_name, value, maxBytes, expected) => {
    expect(oldTruncateToBytes(value, maxBytes)).toBe(expected)
    expect(truncateToBytes(value, maxBytes)).toBe(expected)
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

const COMMON: Tokens = [
  [' ', 8],
  ['\n', 3],
  ['\t', 1],
  ['\u00A0', 1],
  ['>', 6],
  ['<', 6],
  ['=', 5],
  ['"', 5],
  ["'", 4],
  ['`', 3],
  ['```\n', 2],
  ['a', 4],
  ['x', 2],
]
const TAG_TOKENS: Tokens = [
  ...COMMON,
  ['</', 6],
  ['script', 6],
  ['SCRIPT', 2],
  ['style', 3],
  ['base', 3],
  ['basefont', 2],
  ['svg', 2],
  ['input', 2],
  ['<script>', 3],
  ['< /', 2],
]
const HANDLER_TOKENS: Tokens = [
  ...COMMON,
  ['on', 8],
  ['onclick', 4],
  ['ONERROR', 2],
  [' onload', 4],
  [' on', 4],
  ['a', 4],
  [':', 2],
  ['-', 2],
  ['_', 2],
  ['=x', 3],
  ['="x"', 3],
]
const URI_TOKENS: Tokens = [
  ...COMMON,
  ['href', 6],
  ['SRC', 2],
  ['srcset', 2],
  ['cite', 2],
  ['xlink:href', 2],
  ['javascript:', 6],
  ['data:', 4],
  ['vbscript:', 2],
  ['javascript', 2],
  [':', 3],
  [' href=', 5],
  [' src="', 4],
]
const SEEDS = [20_261_104, 4095, 47] as const
const PER_SEED = 20_000

describe('validateRenderingPolicy against the patterns it replaced', () => {
  it.each([
    ['tag-shaped', TAG_TOKENS],
    ['event-handler-shaped', HANDLER_TOKENS],
    ['URI-shaped', URI_TOKENS],
    ['mixed', [...TAG_TOKENS, ...HANDLER_TOKENS, ...URI_TOKENS]],
  ] as const)('agrees on 60,000 seeded %s bodies', (_name, tokens) => {
    let unsafe = 0
    let total = 0
    for (const seed of SEEDS) {
      for (const [index, content] of drawStrings(tokens, seed, PER_SEED, 16).entries()) {
        const expected = oldIsUnsafe(content)
        if (isUnsafe(content) !== expected) {
          expect.fail(`seed ${seed} body #${index} ${JSON.stringify(content)}: the reference says ${expected}`)
        }
        if (expected) unsafe += 1
        total += 1
      }
    }
    expect(total).toBe(60_000)
    expect(unsafe / total).toBeGreaterThan(0.05)
    expect(unsafe / total).toBeLessThan(0.95)
  })
})

describe('truncateToBytes against the pattern it replaced', () => {
  const TOKENS: Tokens = [
    ['\uFFFD', 8],
    ['\uFFFD\uFFFD', 3],
    ['a', 6],
    ['é', 4],
    ['日', 5],
    ['😀', 3],
    ['xyz', 2],
  ]

  it('returns the same string for 60,000 seeded values and budgets', () => {
    let cut = 0
    let trimmed = 0
    let total = 0
    for (const seed of SEEDS) {
      const random = seeded(seed ^ 0x3c)
      for (const [index, value] of drawStrings(TOKENS, seed, PER_SEED, 14).entries()) {
        const maxBytes = Math.floor(random() * (byteLength(value) + 6))
        const expected = oldTruncateToBytes(value, maxBytes)
        const actual = truncateToBytes(value, maxBytes)
        if (actual !== expected) {
          expect.fail(
            `seed ${seed} value #${index} ${JSON.stringify(value)} budget ${maxBytes}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
          )
        }
        if (expected !== value) cut += 1
        if (expected.length < value.length && expected.endsWith('…') && value.includes('\uFFFD')) trimmed += 1
        total += 1
      }
    }
    expect(total).toBe(60_000)
    expect(cut / total).toBeGreaterThan(0.3)
    expect(trimmed).toBeGreaterThan(500)
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

  it.each([
    ['an unsafe tag name repeated, with no `>`', (n: number) => '<script '.repeat(n), 30_000],
    ['an unsafe tag name after a bracket and a long run of spaces', (n: number) => `<${' '.repeat(n)}`, 100_000],
    ['a long run of whitespace before an ordinary character', (n: number) => `${' '.repeat(n)}x`, 100_000],
    ['a quoted URI attribute followed by a long run of whitespace', (n: number) => ` src="${' '.repeat(n)}`, 100_000],
    ['an event-handler prefix repeated', (n: number) => ' onaa'.repeat(n), 100_000],
  ] as const)(
    'validateRenderingPolicy: %s',
    (_name, build, count) => {
      const content = build(count)
      expect(fastestOfThree(() => isUnsafe(content))).toBeLessThan(BOUND_MS)
    },
    TIMEOUT_MS,
  )

  it(
    'truncateToBytes: a long run of replacement characters in front of other text',
    () => {
      const run = 60_000
      const value = `${'\uFFFD'.repeat(run)}${'a'.repeat(100)}`
      const budget = run * 3 + 50
      expect(fastestOfThree(() => truncateToBytes(value, budget))).toBeLessThan(BOUND_MS)
      expect(truncateToBytes(value, budget)).toBe(oldTruncateToBytes(value, budget))
    },
    TIMEOUT_MS,
  )
})
