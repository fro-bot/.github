/* eslint-disable no-template-curly-in-string -- the fixtures are source text that holds a literal `${` */
import {describe, expect, it} from 'vitest'
import {inlineLiteralInterpolations} from './check-mutation-guards.ts'

/** The expression `inlineLiteralInterpolations` replaces. It is exponential on backslash runs, so only short inputs reach it. */
function reference(raw: string): string {
  return raw.replaceAll(/\$\{\s*(['"])((?:\\.|(?!\1).)*)\1\s*\}/gu, (_match, _quote: string, inner: string) => inner)
}

/** mulberry32: a small seeded generator, so a failing case is reproducible from its seed. */
function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const PIECES = [
  '${',
  '${',
  "'",
  '"',
  '\\',
  '\\',
  '\\\\',
  String.raw`\'`,
  String.raw`\"`,
  ' ',
  '\t',
  '\n',
  '\r',
  '\u2028',
  '\u00A0',
  '}',
  '{',
  '$',
  'a',
  '.',
  '/',
  'js',
  // an astral code point as a pair, and each half alone
  '\u{1F600}',
  '\uD83D',
  '\uDE00',
  '`',
]

function randomText(random: () => number): string {
  const length = 1 + Math.floor(random() * 14)
  let text = ''
  for (let index = 0; index < length; index += 1) text += PIECES[Math.floor(random() * PIECES.length)] ?? ''
  return text
}

/** A text that is more likely to hold a real interpolation: random filler around `${ q body q }`. */
function interpolationText(random: () => number): string {
  const quote = random() < 0.5 ? "'" : '"'
  const body = randomText(random)
  const gap = () => ' \t\n\u00A0'.charAt(Math.floor(random() * 4)).repeat(Math.floor(random() * 3))
  const closing = random() < 0.85 ? `${quote}${gap()}}` : `${quote}${gap()}`
  return `${randomText(random)}\${${gap()}${quote}${body}${closing}${randomText(random)}`
}

describe('inlineLiteralInterpolations', () => {
  it.each([
    ["./x${'.js'}", './x.js'],
    ['./x${".js"}', './x.js'],
    ["./x${ '.js' }", './x.js'],
    ["./${'a'}${'b'}", './ab'],
    ['./x${name}', './x${name}'],
    ["./x${'.js'", "./x${'.js'"],
    ["./x${'a\\'b'}", String.raw`./xa\'b`],
    ["./x${'a\\\\'}", './xa\\\\'],
    ['${\'a\' } and ${"b"}', 'a and b'],
    ['', ''],
    ['plain', 'plain'],
    ['$', '$'],
    ['${', '${'],
  ])('%j -> %j, as the expression did', (input, expected) => {
    expect(inlineLiteralInterpolations(input)).toBe(expected)
    expect(reference(input)).toBe(expected)
  })

  it('treats a backslash as an escape first and as itself only when the escape reading finds no match', () => {
    // The first reading takes `\'` as an escaped quote and then finds `'}`; a plain `\` then `'}` would end at the first quote.
    for (const input of ["${'a\\'b'}", "${'a\\'}", "${'a\\\\'}", "${'\\'}'}", "${'\\\\'}'}x"]) {
      expect(inlineLiteralInterpolations(input), input).toBe(reference(input))
    }
  })

  it('agrees with the expression on 150,000 seeded random texts, lone surrogates and line terminators included', () => {
    const random = generator(0x13_13_13)
    const disagreements: string[] = []
    for (let index = 0; index < 150_000; index += 1) {
      const text = index % 2 === 0 ? randomText(random) : interpolationText(random)
      if (inlineLiteralInterpolations(text) !== reference(text)) disagreements.push(JSON.stringify(text))
      if (disagreements.length >= 5) break
    }
    expect(disagreements).toEqual([])
  })

  it('agrees with the expression on every string of up to 6 characters from a small alphabet', () => {
    const alphabet = ['$', '{', "'", '\\', ' ', '}', 'a', '\n', '\uD83D']
    const disagreements: string[] = []
    const visit = (prefix: string, remaining: number): void => {
      if (inlineLiteralInterpolations(prefix) !== reference(prefix)) disagreements.push(JSON.stringify(prefix))
      if (remaining === 0 || disagreements.length > 5) return
      for (const char of alphabet) visit(prefix + char, remaining - 1)
    }
    visit('', 6)
    expect(disagreements).toEqual([])
  })
})
