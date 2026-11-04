/**
 * Seeded differentials for the scans that were rewritten to run in linear time: each new implementation is held to the
 * output of the code it replaced, copied here verbatim as the reference, on random texts built from the pieces that make
 * the old patterns backtrack (unclosed heads, nested heads, newlines, lone surrogates, astral pairs). The seed is fixed, so a
 * failure reproduces.
 */

import {describe, expect, it} from 'vitest'
import {markVitestTypeArguments, wikiWriteCoreSubpathSourceFiles} from './check-mutation-guards.ts'
import {findCommentSpans} from './check-solutions-examples.ts'

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

function build(random: () => number, pieces: readonly string[], maximum: number): string {
  const length = 1 + Math.floor(random() * maximum)
  let text = ''
  for (let index = 0; index < length; index += 1) text += pieces[Math.floor(random() * pieces.length)] ?? ''
  return text
}

const SURROGATES = ['\u{1F600}', '\uD83D', '\uDE00', '\u00E9', '\u2028', '\uE000', '\uE001']

// ---------------------------------------------------------------------------------------------------------------------
// vitest type arguments: the introducer of the `@fro.bot/wiki-write-core` and `@fro-bot/<pkg>` scans
// ---------------------------------------------------------------------------------------------------------------------

const OLD_INTRODUCER = String.raw`(?:from\s+['"]|import\s+['"]|(?:import|vi\.(?:mock|doMock|importActual|importMock)\s*(?:<[^>\n]*>)?)\(\s*['"\x60])`

/** The `@fro.bot/wiki-write-core` scan exactly as it was: the captured subpath of every match, in order. */
function oldWikiWriteCoreSubpaths(content: string): string[] {
  const pattern = new RegExp(String.raw`${OLD_INTRODUCER}@fro\.bot\/wiki-write-core(?:\/([\w-]+))?['"\x60]`, 'gu')
  return [...content.matchAll(pattern)].map(match => match[1] ?? 'index')
}

/** The `@fro-bot/<pkg>` scan exactly as it was: the captured package and subpath of every match, in order. */
function oldPackageSpecifiers(content: string): string[] {
  const pattern = new RegExp(String.raw`${OLD_INTRODUCER}@fro-bot\/([\w-]+)(?:\/([\w./-]+))?['"\x60]`, 'gu')
  return [...content.matchAll(pattern)].map(match => `${match[1] ?? ''}|${match[2] ?? ''}`)
}

function newPackageSpecifiers(content: string): string[] {
  // eslint-disable-next-line prefer-regex-literals -- the marker characters are written as escapes inside one raw template
  const pattern = new RegExp(
    String.raw`(?:from\s+['"]|import\s+['"]|(?:import|vi\.(?:mock|doMock|importActual|importMock)\s*(?:\uE000[^\uE001]*\uE001)?)\(\s*['"\x60])@fro-bot\/([\w-]+)(?:\/([\w./-]+))?['"\x60]`,
    'gu',
  )
  return [...markVitestTypeArguments(content).matchAll(pattern)].map(match => `${match[1] ?? ''}|${match[2] ?? ''}`)
}

const TYPE_ARGUMENT_PIECES = [
  'vi.mock<',
  'vi.mock<',
  'vi.importActual<',
  'vi.doMock <',
  'vi.importMock\n<',
  '>',
  '>',
  '>(',
  '(',
  "'@fro.bot/wiki-write-core/a'",
  "'@fro.bot/wiki-write-core'",
  "'@fro-bot/core/guards'",
  "'@fro-bot/core'",
  '`@fro-bot/core/x`',
  "from '@fro-bot/core'",
  "import('@fro-bot/core/guards')",
  "import '@fro-bot/core'",
  'typeof ',
  'x',
  ' ',
  '\n',
  '<',
  ')',
  ...SURROGATES,
]

describe('markVitestTypeArguments agrees with the vitest type-argument introducer it replaced', () => {
  it('on 120,000 seeded random sources, for both scans', () => {
    const random = generator(0x13_01)
    const disagreements: string[] = []
    for (let index = 0; index < 120_000; index += 1) {
      const text = build(random, TYPE_ARGUMENT_PIECES, 16)
      const wikiOld = oldWikiWriteCoreSubpaths(text)
      const wikiNew = wikiWriteCoreSubpathSourceFiles('x.ts', () => text).map(path =>
        path.replace(/^packages\/wiki-write-core\/src\//u, '').replace(/\.ts$/u, ''),
      )
      if (JSON.stringify(wikiOld) !== JSON.stringify(wikiNew)) disagreements.push(`wiki ${JSON.stringify(text)}`)
      if (JSON.stringify(oldPackageSpecifiers(text)) !== JSON.stringify(newPackageSpecifiers(text))) {
        disagreements.push(`package ${JSON.stringify(text)}`)
      }
      if (disagreements.length >= 5) break
    }
    expect(disagreements).toEqual([])
  })

  it('keeps an inner import when the type-argument list is not followed by a literal specifier', () => {
    const text = "vi.importActual<typeof import('@fro-bot/core/guards')>(name)"
    expect(newPackageSpecifiers(text)).toEqual(oldPackageSpecifiers(text))
    expect(newPackageSpecifiers(text)).toEqual(['core|guards'])
  })

  it('treats a nested head as consumed by the first when the call completes, and as its own match when the first does not', () => {
    for (const text of [
      "vi.mock<vi.mock<x>('@fro-bot/core')",
      "vi.mock<a vi.importActual<b>('@fro-bot/core/guards')",
      'vi.mock<vi.mock<x>(name)',
      "vi.mock<\nvi.mock<x>('@fro-bot/core')",
      "vi.mock<x>\n('@fro-bot/core')",
      "vi.mock <x>('@fro-bot/core')",
    ]) {
      expect(newPackageSpecifiers(text), text).toEqual(oldPackageSpecifiers(text))
    }
  })

  it('replaces a private-use character already in the source, so a source cannot forge a marker', () => {
    const forged = "vi.mock\uE000x\uE001('@fro-bot/core')"
    expect(markVitestTypeArguments(forged)).not.toContain('\uE000')
    expect(newPackageSpecifiers(forged)).toEqual(oldPackageSpecifiers(forged))
    expect(newPackageSpecifiers(forged)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// HTML comment spans in a solution document
// ---------------------------------------------------------------------------------------------------------------------

function oldLineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line += 1
  }
  return line
}

function oldFindCommentSpans(content: string) {
  const spans: {startLine: number; endLine: number; inner: string}[] = []
  const consumedRanges: {start: number; end: number}[] = []
  for (const match of content.matchAll(/<!--([\s\S]*?)-->/gu)) {
    const start = match.index
    const end = start + match[0].length
    consumedRanges.push({start, end})
    spans.push({
      startLine: oldLineNumberAt(content, start),
      endLine: oldLineNumberAt(content, end - 1),
      inner: match[1] ?? '',
    })
  }
  const unterminated: {line: number; index: number}[] = []
  for (const openMatch of content.matchAll(/<!--/gu)) {
    const index = openMatch.index
    const covered = consumedRanges.some(range => index >= range.start && index < range.end)
    if (!covered) unterminated.push({line: oldLineNumberAt(content, index), index})
  }
  return {spans, unterminated}
}

const COMMENT_PIECES = [
  '<!--',
  '<!--',
  '-->',
  '-->',
  '--',
  '-',
  '>',
  '<',
  '!',
  '\n',
  '\n',
  ' ',
  'a',
  'verify: a from b.ts',
  '\r\n',
  '<!-->',
  '<!--->',
  ...SURROGATES,
]

describe('findCommentSpans agrees with the scan it replaced', () => {
  it('on 150,000 seeded random documents', () => {
    const random = generator(0x13_03)
    const disagreements: string[] = []
    for (let index = 0; index < 150_000; index += 1) {
      const text = build(random, COMMENT_PIECES, 20)
      if (JSON.stringify(findCommentSpans(text)) !== JSON.stringify(oldFindCommentSpans(text))) {
        disagreements.push(JSON.stringify(text))
      }
      if (disagreements.length >= 5) break
    }
    expect(disagreements).toEqual([])
  })

  it.each([
    '',
    '<!--',
    '-->',
    '<!---->',
    '<!-->',
    '<!--->',
    '<!-- a -->\n<!-- b',
    'x\n<!--\n-->\n<!--',
    '<!-- a --> <!-- b --> <!--',
    '\n\n<!--\n\n-->',
  ])('on %j', text => {
    expect(findCommentSpans(text)).toEqual(oldFindCommentSpans(text))
  })
})
