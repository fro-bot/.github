/**
 * `truncateToBytes` strips the replacement characters that cutting a multi-byte character leaves at the
 * end of a slice. It used to do that with `/\uFFFD+$/gu`, which is quadratic on a long run of replacement
 * characters that is followed by another character. This file keeps that pattern as the reference and
 * compares the backward scan with it on seeded documents, then pins the edges.
 */

import {Buffer} from 'node:buffer'
import {describe, expect, it} from 'vitest'
import {truncateToBytes} from './solutions-query.ts'

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** The implementation before the backward scan: same slice, then the pattern. */
function referenceTruncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value
  const ellipsis = '…'
  const contentBudget = maxBytes - byteLength(ellipsis)
  if (contentBudget <= 0) return ''
  const truncated = Buffer.from(value)
    .subarray(0, contentBudget)
    .toString('utf8')
    .replaceAll(/\uFFFD+$/gu, '')
  return truncated === '' ? '' : `${truncated}${ellipsis}`
}

/** A small seeded generator, so a failure names the seed and replays. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const ALPHABET = ['a', 'b', ' ', '\n', '\uFFFD', '\uFFFD', 'é', '…', '日', '😀', '\u0000', '\uD800', '\uDC00']

function document(next: () => number): string {
  const length = Math.floor(next() * 40)
  let value = ''
  for (let index = 0; index < length; index += 1) {
    const pick = ALPHABET[Math.floor(next() * ALPHABET.length)] ?? 'a'
    // Sometimes a run, since runs are what the pattern strips.
    value += next() < 0.2 ? pick.repeat(1 + Math.floor(next() * 6)) : pick
  }
  return value
}

describe('truncateToBytes keeps the output of the pattern it replaced', () => {
  it('matches the reference on 12 seeds x 1,500 documents at every budget that cuts', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const next = random(seed)
      for (let count = 0; count < 1500; count += 1) {
        const value = document(next)
        const budget = Math.floor(next() * (byteLength(value) + 6)) - 1
        expect(
          truncateToBytes(value, budget),
          `seed ${seed} document ${count}: ${JSON.stringify(value)} @ ${budget}`,
        ).toBe(referenceTruncateToBytes(value, budget))
      }
    }
  })

  it('matches the reference at every budget of fixed edge documents', () => {
    const documents = [
      '',
      'a',
      '\uFFFD',
      '\uFFFD\uFFFD\uFFFD',
      '\uFFFDa\uFFFD',
      'a\uFFFD\uFFFDb\uFFFD\uFFFD',
      '日日日',
      '😀😀',
      'é'.repeat(10),
      `${'\uFFFD'.repeat(20)}a`,
      `a${'\uFFFD'.repeat(20)}`,
      '日本語のテキスト',
      // A lone surrogate encodes as U+FFFD, so it behaves as a replacement character.
      '\uD800',
      'a\uD800',
      'a\uD800\uD800b',
      '\uDC00\uD800',
      'ab\uDC00cd\uDC00',
      '😀\uD800',
    ]
    for (const value of documents) {
      for (let budget = -2; budget <= byteLength(value) + 4; budget += 1) {
        expect(truncateToBytes(value, budget), `${JSON.stringify(value)} @ ${budget}`).toBe(
          referenceTruncateToBytes(value, budget),
        )
      }
    }
  })
})

describe('truncateToBytes at lone surrogates and multibyte cuts', () => {
  it('treats a lone surrogate like a replacement character it can strip', () => {
    // 'abc' + a lone surrogate (3 bytes as U+FFFD) + 'defg': 6 content bytes end on the surrogate.
    expect(truncateToBytes('abc\uD800defg', 9)).toBe('abc…')
    expect(truncateToBytes('abc\uD800defg', 9)).toBe(referenceTruncateToBytes('abc\uD800defg', 9))
  })

  it('cuts a four-byte character mid-sequence and drops what the cut leaves', () => {
    // '😀' is 4 bytes: 2 content bytes keep 'a' and one byte of the emoji, which decodes to U+FFFD.
    expect(truncateToBytes('a😀b', 5)).toBe('a…')
    for (let budget = 0; budget <= 12; budget += 1) {
      expect(truncateToBytes('a😀b😀', budget), `@ ${budget}`).toBe(referenceTruncateToBytes('a😀b😀', budget))
    }
  })
})

describe('truncateToBytes', () => {
  it('returns a value that fits unchanged', () => {
    expect(truncateToBytes('abc', 3)).toBe('abc')
    expect(truncateToBytes('', 0)).toBe('')
  })

  it('cuts at a byte boundary, drops the half character left behind and appends the ellipsis', () => {
    // '日' is 3 bytes: a budget of 7 leaves 4 content bytes, one whole character and one split byte.
    expect(truncateToBytes('日日日', 7)).toBe('日…')
  })

  it('keeps a replacement character that is not trailing, and strips the one left by the cut', () => {
    // 3 + 2 bytes, then a whole replacement character (3 bytes) cut after its first byte.
    expect(truncateToBytes('\uFFFDab\uFFFDcdef', 9)).toBe('\uFFFDab…')
  })

  it('strips a whole trailing run of replacement characters that the text itself held', () => {
    // 'abc' + three replacement characters (9 bytes) fill the 12 content bytes; 'defg' is cut.
    expect(truncateToBytes('abc\uFFFD\uFFFD\uFFFDdefg', 15)).toBe('abc…')
  })

  it('returns an empty string when the budget leaves no room, or only replacement characters would remain', () => {
    expect(truncateToBytes('abc', 2)).toBe('')
    expect(truncateToBytes('abc', 0)).toBe('')
    expect(truncateToBytes('\uFFFD'.repeat(10), 15)).toBe('')
  })
})
