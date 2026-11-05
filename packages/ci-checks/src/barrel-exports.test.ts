import {describe, expect, it} from 'vitest'
import {firstAtOrAfter, stripBarrelExports} from './barrel-exports.ts'

/** The expression `stripBarrelExports` replaces: the three forms in one `replaceAll`. Quadratic, so only short inputs reach it. */
function oldStripBarrel(content: string): string {
  const pattern =
    /export\s+(?:type\s+)?\*\s+(?:as\s+[$\w]+\s+)?from\s+['"][^'"]+['"]\s*;?|export\s+type\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?|export\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\s*;?/gu
  return content.replaceAll(pattern, '')
}

/** mulberry32: a small seeded generator. */
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
  'export ',
  'export',
  'export type ',
  'export type',
  'export * ',
  'export type * ',
  'export * as a ',
  '* ',
  '{',
  '{',
  '}',
  '}',
  ' {',
  'a',
  ', b',
  ' from ',
  'from',
  "'./a.ts'",
  '"./b.ts"',
  "'",
  '"',
  ';',
  ' ',
  '  ',
  '\n',
  'type ',
  'as x ',
  '\u{1F600}',
  '\uD83D',
  '\uDE00',
  '\u2028',
  '\u00A0',
]

function build(random: () => number, maximum: number): string {
  const length = 1 + Math.floor(random() * maximum)
  let text = ''
  for (let index = 0; index < length; index += 1) text += PIECES[Math.floor(random() * PIECES.length)] ?? ''
  return text
}

describe('firstAtOrAfter', () => {
  it.each([
    [[], 5, 0],
    [[3], 3, 0],
    [[3], 4, 1],
    [[3], 2, 0],
    [[1, 3, 5, 7], 0, 0],
    [[1, 3, 5, 7], 1, 0],
    [[1, 3, 5, 7], 2, 1],
    [[1, 3, 5, 7], 5, 2],
    [[1, 3, 5, 7], 6, 3],
    [[1, 3, 5, 7], 7, 3],
    [[1, 3, 5, 7], 8, 4],
    [[1, 3, 5, 7, 9], 4, 2],
    [[1, 3, 5, 7, 9], 9, 4],
    [[1, 3, 5, 7, 9], 10, 5],
    [[0, 0, 0], 0, 0],
  ])('%j with target %i is at index %i', (sorted, target, expected) => {
    expect(firstAtOrAfter(sorted, target)).toBe(expected)
  })

  it('agrees with a linear search on every sorted list of up to 7 distinct values and every target', () => {
    const values = [0, 2, 4, 6, 8, 10, 12]
    for (let mask = 0; mask < 1 << values.length; mask += 1) {
      const sorted = values.filter((_, index) => (mask & (1 << index)) !== 0)
      for (let target = -1; target <= 13; target += 1) {
        const expected = sorted.findIndex(value => value >= target)
        expect(firstAtOrAfter(sorted, target), `${sorted.join(',')} @ ${String(target)}`).toBe(
          expected === -1 ? sorted.length : expected,
        )
      }
    }
  })

  it('searches within the bounds it is given', () => {
    expect(firstAtOrAfter([1, 3, 5, 7], 0, 2, 4)).toBe(2)
    expect(firstAtOrAfter([1, 3, 5, 7], 9, 0, 2)).toBe(2)
  })
})

describe('stripBarrelExports', () => {
  it.each([
    ["export * from './a.ts'", ''],
    ["export * as ns from './a.ts';", ''],
    ["export type * from './a.ts'", ''],
    ["export {a} from './a.ts'", ''],
    ["export type {A} from './a.ts'", ''],
    ["export {a} from './a.ts'\nexport {b} from './b.ts'\n", ''],
    ["export {a}from './a.ts'", ''],
    ["export {a} from'./a.ts'", "export {a} from'./a.ts'"],
    ["export {a} from './a.ts' ;", ''],
    ['export {a}\n  from "./a.ts"  ;x', 'x'],
    ["export {a} from './a.ts'export {b} from './b.ts'", ''],
    ["export {a} from './a.ts'x export {b} from './b.ts'", 'x '],
    ['export {} from "x"', ''],
    ['export{}from"x"', 'export{}from"x"'],
    ['export {a}', 'export {a}'],
    ['export {a} from ', 'export {a} from '],
    ["export {a} from './a.ts", "export {a} from './a.ts"],
    ['export {', 'export {'],
    ["export { export {a} from 'a'", ''],
    ["export {a export {b} from 'b'", ''],
    ["export type { a } from 'x'; export type {", ' export type {'],
    ["const x = 1\nexport {a} from './a.ts'\nconst y = 2", 'const x = 1\nconst y = 2'],
    ["export * from 'a'export * from 'b'", ''],
    ['export type {a, b', 'export type {a, b'],
    ['export * from ', 'export * from '],
    ["notexport {a} from 'x'", 'not'],
    ["exports {a} from 'x'", "exports {a} from 'x'"],
    ['', ''],
  ])('%j -> %j', (content, expected) => {
    expect(stripBarrelExports(content)).toBe(expected)
    expect(oldStripBarrel(content)).toBe(expected)
  })

  it('removes a head that sits at the end of the previous statement, and keeps one that starts inside it', () => {
    expect(stripBarrelExports("export {a} from 'a'export {b} from 'b'x")).toBe('x')
    expect(stripBarrelExports("export { export * from 'a} from 'b'x")).toBe('x')
  })

  it('agrees with the three-form replaceAll on 60,000 seeded random sources', () => {
    const random = generator(0x13_02)
    const disagreements: string[] = []
    for (let index = 0; index < 60_000; index += 1) {
      const text = build(random, 18)
      if (stripBarrelExports(text) !== oldStripBarrel(text)) disagreements.push(JSON.stringify(text))
      if (disagreements.length >= 5) break
    }
    expect(disagreements).toEqual([])
  })

  it('agrees on the shape that made it quadratic: many heads sharing one close, then whitespace', () => {
    for (const heads of [1, 2, 3, 10]) {
      for (const tail of ['', ' ', '   x', " from 'a'", " from 'a';", "  from\n'a'  x"]) {
        const text = `${'export{'.repeat(heads)}}${tail}`
        expect(stripBarrelExports(text), JSON.stringify(text)).toBe(oldStripBarrel(text))
      }
    }
  })

  it('answers each close once: a hundred heads before one close still strip as one statement', () => {
    const text = `${'export{'.repeat(100)}} from 'a'`
    expect(stripBarrelExports(text)).toBe('')
    expect(stripBarrelExports(`${text}x`)).toBe('x')
  })
})
