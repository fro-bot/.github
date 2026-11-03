/**
 * `parsePatternProposalSourceIds` must return exactly what the pattern it replaced returned. The
 * reference below is that pattern, unchanged. Inputs come from a seeded generator of fragments chosen to
 * hit the edges of the grammar: the prefix whole and cut short, closes whole and cut short, line breaks
 * in every position, multibyte text, and lone surrogates (the pattern's `u` flag reads a lone surrogate
 * as one character, where a code-unit search sees a half of a pair).
 */

import {describe, expect, it} from 'vitest'
import {parsePatternProposalSourceIds} from './capture-patterns-synthesis.ts'

/** The original pattern and parse, kept as the reference. */
function referenceSourceIds(body: string): string[] | null {
  const match = /<!-- pattern-proposal:source-ids=([^\n]+?) -->/u.exec(body)
  const raw = match?.[1]
  if (raw === undefined || raw.trim() === '') return null
  return raw.split(',').map(id => id.trim())
}

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = Math.trunc(state + 0x6d2b79f5)
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PREFIX = '<!-- pattern-proposal:source-ids='
const FRAGMENTS = [
  PREFIX,
  PREFIX,
  PREFIX,
  '<!-- pattern-proposal:source-ids',
  '<!-- pattern-proposal:fingerprint=',
  '<!-- ',
  ' -->',
  ' -->',
  '-->',
  ' --',
  ' -',
  '>',
  ' ',
  '  ',
  '\n',
  '\n\n',
  '\r\n',
  '\r',
  'a',
  'b',
  'a,b',
  ',',
  ' , ',
  'src-1,src-2',
  'é',
  'ñandú',
  '日本語',
  '🙂',
  '\uD800',
  '\uDC00',
  '\uD83D',
  '\uDE42',
  '\u2028',
  '\u0000',
  '\t',
]

function generate(random: () => number): string {
  const count = Math.floor(random() * 14)
  let text = ''
  for (let index = 0; index < count; index += 1) {
    text += FRAGMENTS[Math.floor(random() * FRAGMENTS.length)] ?? ''
  }
  return text
}

describe('parsePatternProposalSourceIds against the original pattern', () => {
  it('agrees on 60,000 seeded documents', () => {
    const random = mulberry32(0x5eed)
    let matched = 0
    let nullResults = 0
    for (let index = 0; index < 60_000; index += 1) {
      const body = generate(random)
      const expected = referenceSourceIds(body)
      expect(parsePatternProposalSourceIds(body), JSON.stringify(body)).toEqual(expected)
      if (expected === null) nullResults += 1
      else matched += 1
    }
    // The generator reaches both outcomes, so the comparison is not a run of nulls.
    expect(matched).toBeGreaterThan(2_000)
    expect(nullResults).toBeGreaterThan(5_000)
  })

  it.each([
    ['no marker', 'plain body'],
    ['an empty marker', `${PREFIX} -->`],
    ['a one-character marker', `${PREFIX}a -->`],
    ['a marker whose id list is blank', `${PREFIX}   -->`],
    ['the close right after the prefix, then another close', `${PREFIX} --> and ${PREFIX}a -->`],
    ['an unclosed prefix then a closed one on the next line', `${PREFIX}x\n${PREFIX}a,b -->`],
    ['a close on the next line only', `${PREFIX}a\nb -->`],
    ['a closed prefix after an unclosed one on the same line', `${PREFIX}${PREFIX}a,b -->`],
    ['a prefix inside the captured text', `${PREFIX}a ${PREFIX}b -->`],
    ['the close at the very end', `x ${PREFIX}a,b -->`],
    ['the close one character short', `${PREFIX}a ->`],
    ['CRLF before the close', `${PREFIX}a\r\n -->`],
    ['a lone high surrogate in the ids', `${PREFIX}\uD800,a -->`],
    ['a lone low surrogate before the prefix', `\uDC00${PREFIX}a -->`],
    ['a pair split by the close', `${PREFIX}\uD83D -->\uDE42`],
    ['a line separator in the ids', `${PREFIX}a\u2028b -->`],
  ])('agrees on %s', (_name, body) => {
    expect(parsePatternProposalSourceIds(body)).toEqual(referenceSourceIds(body))
  })

  it('reads the ids a well-formed marker carries', () => {
    expect(parsePatternProposalSourceIds(`intro\n\n${PREFIX}b, a ,c -->\n`)).toEqual(['b', 'a', 'c'])
  })
})
