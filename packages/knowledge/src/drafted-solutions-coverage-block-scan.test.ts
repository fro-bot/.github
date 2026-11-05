/**
 * `findCoverageBlock` replaces `/<!-- fro-bot:drafted-solutions-coverage v1\r?\n([\s\S]*?)\r?\n-->/`. The
 * old pattern is kept here as the oracle: for every input the scan must return exactly what
 * `ORACLE.exec(text)?.[1]` returns. The lazy payload makes the pattern quadratic across many heads (CodeQL
 * `js/polynomial-redos`), which is why it was replaced; its behaviour is still the specification.
 */

import {describe, expect, it} from 'vitest'
import {findCoverageBlock} from './drafted-solutions-pr-body.ts'

const ORACLE = /<!-- fro-bot:drafted-solutions-coverage v1\r?\n([\s\S]*?)\r?\n-->/
const oracle = (text: string): string | undefined => ORACLE.exec(text)?.[1]

const START = '<!-- fro-bot:drafted-solutions-coverage v1'

describe('findCoverageBlock: the cases the pattern was written for', () => {
  it.each([
    {name: 'LF head and LF terminator', text: `${START}\n{"a":1}\n-->`, expected: '{"a":1}'},
    {name: 'CRLF head and CRLF terminator', text: `${START}\r\n{"a":1}\r\n-->`, expected: '{"a":1}'},
    {name: 'CRLF head and LF terminator', text: `${START}\r\n{"a":1}\n-->`, expected: '{"a":1}'},
    {name: 'LF head and CRLF terminator', text: `${START}\n{"a":1}\r\n-->`, expected: '{"a":1}'},
    {name: 'an empty payload, LF', text: `${START}\n\n-->`, expected: ''},
    {name: 'an empty payload, CRLF', text: `${START}\r\n\r\n-->`, expected: ''},
    {name: 'an empty payload, mixed', text: `${START}\n\r\n-->`, expected: ''},
    {name: 'text before and after the block', text: `intro\n\n${START}\n{}\n-->\n\ntrailer\n-->`, expected: '{}'},
    {name: 'the first terminator, not the last (lazy)', text: `${START}\na\n-->\nb\n-->`, expected: 'a'},
    {name: 'a payload holding a lone CR', text: `${START}\na\rb\n-->`, expected: 'a\rb'},
    {name: 'a payload holding a bare -->', text: `${START}\na-->b\n-->`, expected: 'a-->b'},
    {name: 'a multi-line payload', text: `${START}\n{\n  "x": 1\n}\n-->`, expected: '{\n  "x": 1\n}'},
  ])('$name', ({text, expected}) => {
    expect(findCoverageBlock(text)).toBe(expected)
    expect(oracle(text)).toBe(expected)
  })

  it.each([
    {name: 'a missing terminator', text: `${START}\n{"a":1}`},
    {name: 'a terminator without a newline before it', text: `${START}\n{"a":1}-->`},
    {name: 'a terminator one dash short', text: `${START}\n{"a":1}\n->`},
    {name: 'a head with no newline', text: `${START}{"a":1}\n-->`},
    {name: 'a head with a CR not followed by LF', text: `${START}\r{"a":1}\n-->`},
    {name: 'a head with trailing text after v1', text: `${START}x\n{}\n-->`},
    {name: 'the head newline doubling as the terminator newline', text: `${START}\n-->`},
    {name: 'the head CRLF doubling as the terminator newline', text: `${START}\r\n-->`},
    {name: 'a different version', text: '<!-- fro-bot:drafted-solutions-coverage v2\n{}\n-->'},
    {name: 'no marker at all', text: 'just a PR body\n-->'},
    {name: 'an empty string', text: ''},
  ])('$name: no block', ({text}) => {
    expect(findCoverageBlock(text)).toBeUndefined()
    expect(oracle(text)).toBeUndefined()
  })

  it('skips an invalid head and takes a later valid one', () => {
    const text = `${START}x\n${START}\n{"later":true}\n-->`
    expect(findCoverageBlock(text)).toBe('{"later":true}')
    expect(oracle(text)).toBe('{"later":true}')
  })

  it('finds no block when an earlier head has no terminator, as no later head can have one either', () => {
    const text = `${START}\na\n${START}\nb`
    expect(findCoverageBlock(text)).toBeUndefined()
    expect(oracle(text)).toBeUndefined()
  })

  it('lets the first head take the terminator of a later head', () => {
    const text = `${START}\na\n${START}\nb\n-->`
    expect(findCoverageBlock(text)).toBe(`a\n${START}\nb`)
    expect(oracle(text)).toBe(`a\n${START}\nb`)
  })
})

/** mulberry32: a small seeded generator, so a failure reproduces from the seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

const TOKENS = [
  START,
  START,
  '<!-- fro-bot:drafted-solutions-coverage',
  '<!-- fro-bot:drafted-solutions-coverage v2',
  'v1',
  '\r',
  '\n',
  '\r\n',
  '\n',
  '-->',
  '-->',
  '-',
  '>',
  '--',
  'a',
  ' ',
  '{}',
] as const

type Next = () => number

const pick = <T>(next: Next, items: readonly T[]): T => items[Math.floor(next() * items.length)] as T

function randomTokens(next: Next, maximum: number): string {
  const length = Math.floor(next() * maximum)
  let text = ''
  for (let token = 0; token < length; token += 1) text += pick(next, TOKENS)
  return text
}

/** Pure noise from the token alphabet: blocks are rare, near-misses are common. */
const noiseBody = (next: Next): string => randomTokens(next, 14)

/** Noise around a head, a payload and a terminator, each drawn from the variants that matter. */
function framedBody(next: Next): string {
  const head = `${START}${pick(next, ['\n', '\r\n', '\n', '\r', '', 'x\n', '\r\r\n'])}`
  const terminator = pick(next, ['\n-->', '\r\n-->', '\n->', '-->', '\n--', '\n\n-->', ''])
  return `${randomTokens(next, 5)}${head}${randomTokens(next, 6)}${terminator}${randomTokens(next, 6)}`
}

describe('findCoverageBlock matches the old pattern on random bodies', () => {
  it('agrees on 80,000 seeded bodies', () => {
    const next = seededRandom(0x0c_0f_fe_e1)
    const cases = 80_000
    let blocks = 0
    for (let index = 0; index < cases; index += 1) {
      const text = index % 2 === 0 ? noiseBody(next) : framedBody(next)
      const expected = oracle(text)
      if (expected !== undefined) blocks += 1
      if (findCoverageBlock(text) !== expected) {
        // The failing body, as JSON, is the reproduction.
        expect(findCoverageBlock(text), JSON.stringify(text)).toBe(expected)
      }
    }
    // The generator must produce both outcomes in volume, or the comparison proves little.
    expect(blocks).toBeGreaterThan(cases / 10)
    expect(blocks).toBeLessThan(cases * 0.9)
  })

  it('agrees on a body that forms a block around every prefix of a fixed document', () => {
    const document = `x\r\n${START}\r\n{"a":"b"}\r\n-->\r\n${START}\n\n-->\ny`
    for (let end = 0; end <= document.length; end += 1) {
      for (let start = 0; start <= end; start += 1) {
        const slice = document.slice(start, end)
        expect(findCoverageBlock(slice), JSON.stringify(slice)).toBe(oracle(slice))
      }
    }
  })
})
