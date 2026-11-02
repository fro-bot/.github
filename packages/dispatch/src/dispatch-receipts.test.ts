import {describe, expect, it} from 'vitest'
import {extractResultMarkerJson, parseResult} from './dispatch-receipts.ts'

const PREFIX = '<!-- fro-bot:cross-repo-result '

// ─── The reference: the forward walk from each prefix, as extractResultMarkerJson was before the lookup ───

const REFERENCE_PREFIX_REGEX = /<!--\s*fro-bot:cross-repo-result\s/g

interface WalkStats {
  fallbackUsed: number
  hiddenArrow: number
}

function referenceTerminator(scope: string, payloadStart: number, stats?: WalkStats): number | null {
  let inString = false
  let naiveFallback: number | null = null

  for (let i = payloadStart; i < scope.length; i++) {
    const ch = scope[i]
    const atArrow = ch === '-' && scope.startsWith('-->', i)

    if (atArrow && naiveFallback === null) naiveFallback = i

    if (inString) {
      if (ch === '\\') {
        if (stats !== undefined && scope.startsWith('-->', i + 1)) stats.hiddenArrow += 1
        i += 1
        continue
      }
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (atArrow) return i
  }
  if (stats !== undefined && naiveFallback !== null) stats.fallbackUsed += 1
  return naiveFallback
}

function referenceExtract(scope: string, stats?: WalkStats): string | null {
  let lastPayload: string | null = null
  REFERENCE_PREFIX_REGEX.lastIndex = 0
  for (;;) {
    const match = REFERENCE_PREFIX_REGEX.exec(scope)
    if (match === null) break

    const payloadStart = match.index + match[0].length
    const terminatorIndex = referenceTerminator(scope, payloadStart, stats)
    if (terminatorIndex === null) continue

    lastPayload = scope.slice(payloadStart, terminatorIndex)
  }
  return lastPayload
}

// ─── Explicit cases ───

describe('extractResultMarkerJson', () => {
  const complete = (json: string) => `${PREFIX}${json}-->`

  it.each([
    ['no marker', 'just prose', null],
    ['a complete marker', complete('{"a":1}'), '{"a":1}'],
    ['an unterminated marker', `${PREFIX}{"a":1}`, null],
    ['a marker whose prefix has no whitespace after it', '<!-- fro-bot:cross-repo-result{"a":1} -->', null],
    ['a prefix at the very end of the body', PREFIX, null],
    ['a prefix whose `-->` follows at once', `${PREFIX}-->`, ''],
    [
      'whitespace of any kind between the opening and the name',
      '<!--\n\t fro-bot:cross-repo-result\n{"a":1} -->',
      '{"a":1} ',
    ],
    ['a `-->` inside a string, then the real one', complete('{"s":"a --> b"}'), '{"s":"a --> b"}'],
    [
      'an escaped quote that keeps the string open across a `-->`',
      complete(String.raw`{"s":"x\" --> y"}`),
      String.raw`{"s":"x\" --> y"}`,
    ],
    [
      'an escaped backslash that lets the next quote close the string',
      complete(String.raw`{"s":"x\\"}`),
      String.raw`{"s":"x\\"}`,
    ],
    [
      'a backslash that hides the first dash of an arrow inside a string',
      complete(String.raw`{"s":"x\--> y"}`),
      String.raw`{"s":"x\--> y"}`,
    ],
    [
      'an unterminated string, so the first arrow is the fallback',
      `${PREFIX}{"s":"never closes --> x`,
      '{"s":"never closes ',
    ],
    [
      'an unterminated string with a hidden first arrow, then a second',
      String.raw`${PREFIX}{"s":"a\--> b --> c`,
      String.raw`{"s":"a\--> b `,
    ],
    [
      'a backslash outside a string, which is an ordinary character',
      complete(String.raw`{"a":\ 1}`),
      String.raw`{"a":\ 1}`,
    ],
    [
      'nested openings: the inner prefix is its own marker, the later one wins',
      `${PREFIX}{"a":1 ${PREFIX}{"b":2} -->`,
      '{"b":2} ',
    ],
    [
      'several complete markers: the last one wins',
      `${complete('{"n":1}')}\n${complete('{"n":2}')}\n${complete('{"n":3}')}`,
      '{"n":3}',
    ],
    [
      'a malformed last marker still wins over a good earlier one',
      `${complete('{"n":1}')}\n${complete('{not json')}`,
      '{not json',
    ],
    ['a complete marker, then an unterminated one', `${complete('{"n":1}')}\n${PREFIX}{"n":2}`, '{"n":1}'],
    ['a stray arrow before any prefix', `--> ${complete('{"n":1}')}`, '{"n":1}'],
  ] as const)('%s', (_name, body, expected) => {
    expect(extractResultMarkerJson(body)).toBe(expected)
    expect(referenceExtract(body)).toBe(expected)
  })

  it('returns null for many unterminated prefixes', () => {
    const body = PREFIX.repeat(50)
    expect(extractResultMarkerJson(body)).toBeNull()
    expect(referenceExtract(body)).toBeNull()
  })

  it('ends every one of many prefixes at a single trailing arrow, and the last prefix wins', () => {
    const body = `${PREFIX.repeat(50)}-->`
    expect(extractResultMarkerJson(body)).toBe('')
    expect(referenceExtract(body)).toBe('')
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

// Weighted toward the prefix and the characters the walk branches on.
const TOKENS: readonly (readonly [string, number])[] = [
  [PREFIX, 10],
  ['<!--', 4],
  ['<!--\n', 2],
  ['fro-bot:cross-repo-result', 2],
  ['-->', 8],
  ['-', 6],
  ['>', 4],
  ['--', 3],
  ['"', 10],
  ['\\', 8],
  [String.raw`\"`, 4],
  ['\\\\', 2],
  [' ', 6],
  ['\n', 2],
  ['{', 2],
  ['}', 2],
  [':', 2],
  ['a', 3],
  ['{"summary":"', 3],
  ['{"summary":"x --> y"} -->', 3],
  [`${PREFIX}{"correlation_id":"c","nonce":"n","status":"success","summary":"s"} -->`, 3],
  [String.raw`${PREFIX}{"s":"a\"--> b"} -->`, 2],
]
const TOTAL_WEIGHT = TOKENS.reduce((sum, [, weight]) => sum + weight, 0)

function pickToken(random: () => number): string {
  let roll = random() * TOTAL_WEIGHT
  for (const [token, weight] of TOKENS) {
    roll -= weight
    if (roll < 0) return token
  }
  return ''
}

function randomBody(random: () => number): string {
  const length = Math.floor(random() * 40)
  let body = ''
  for (let index = 0; index < length; index++) body += pickToken(random)
  return body
}

describe('extractResultMarkerJson against the forward walk it replaced', () => {
  const BODIES = 60_000
  const SEEDS = [20_261_101, 4087, 1] as const

  it(`returns the same payload for ${BODIES} seeded bodies`, () => {
    const stats: WalkStats = {fallbackUsed: 0, hiddenArrow: 0}
    let matched = 0
    let empty = 0
    let multipleMarkers = 0
    const per = BODIES / SEEDS.length

    for (const seed of SEEDS) {
      const random = seeded(seed)
      for (let index = 0; index < per; index++) {
        const body = randomBody(random)
        const expected = referenceExtract(body, stats)
        const actual = extractResultMarkerJson(body)
        if (actual !== expected) {
          expect.fail(
            `seed ${seed} body #${index} ${JSON.stringify(body)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          )
        }
        if (expected === null) empty += 1
        else matched += 1
        if (body.split(PREFIX).length > 2) multipleMarkers += 1
      }
    }

    // The draw reaches each branch, so a generator that stopped exercising one would fail here.
    expect(matched).toBeGreaterThan(BODIES * 0.2)
    expect(empty).toBeGreaterThan(BODIES * 0.05)
    expect(multipleMarkers).toBeGreaterThan(BODIES * 0.1)
    expect(stats.fallbackUsed).toBeGreaterThan(500)
    expect(stats.hiddenArrow).toBeGreaterThan(500)
  })
})

// ─── Time ───

describe('extractResultMarkerJson on many prefixes', () => {
  const COUNT = 20_000
  const BOUND_MS = 1000

  it('is linear on many unterminated prefixes', () => {
    const body = PREFIX.repeat(COUNT)
    const startedAt = performance.now()
    expect(extractResultMarkerJson(body)).toBeNull()
    expect(performance.now() - startedAt).toBeLessThan(BOUND_MS)
  })

  it('is linear on many prefixes followed by one trailing arrow', () => {
    const body = `${PREFIX.repeat(COUNT)}-->`
    const startedAt = performance.now()
    expect(extractResultMarkerJson(body)).toBe('')
    expect(performance.now() - startedAt).toBeLessThan(BOUND_MS)
  })

  it('is linear through parseResult as well', () => {
    const body = PREFIX.repeat(COUNT)
    const startedAt = performance.now()
    expect(parseResult(body)).toStrictEqual({ok: false, reason: 'absent'})
    expect(performance.now() - startedAt).toBeLessThan(BOUND_MS)
  })
})
