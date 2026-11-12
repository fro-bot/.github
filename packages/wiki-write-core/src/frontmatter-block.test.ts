/**
 * `splitFrontmatterBlock` finds the YAML frontmatter block of a document. This file pins its block rule with
 * explicit cases, proves the pieces it returns put the document back byte for byte, and compares it with the four
 * regex shapes the repository used before. The old regexes are kept here as frozen references.
 *
 * The seeded corpus builds each document from parts, so the expected result of every input is known from how it
 * was built and not from looking at the input afterwards. Later tests that compare a reader with its old regex copy
 * the generator, because this package cannot depend on the test kit.
 */

import {describe, expect, it} from 'vitest'
import {splitFrontmatterBlock, type FrontmatterBlockSplit} from './frontmatter-block.ts'

type BlockResult = Extract<FrontmatterBlockSplit, {readonly kind: 'block'}>

function block(opening: string, text: string, textEnding: string, closing: string, body: string): BlockResult {
  return {kind: 'block', opening, text, textEnding, closing, body}
}

function reassemble(result: BlockResult): string {
  return result.opening + result.text + result.textEnding + result.closing + result.body
}

// ─── Explicit cases ───

describe('splitFrontmatterBlock: a block', () => {
  it.each([
    ['LF', '---\ntitle: a\n---\nbody\n', block('---\n', 'title: a', '\n', '---\n', 'body\n')],
    ['CRLF', '---\r\ntitle: a\r\n---\r\nbody\r\n', block('---\r\n', 'title: a', '\r\n', '---\r\n', 'body\r\n')],
    ['mixed endings', '---\r\na: 1\nb: 2\r\n---\nbody', block('---\r\n', 'a: 1\nb: 2', '\r\n', '---\n', 'body')],
    ['several lines, LF', '---\na: 1\nb: 2\nc: 3\n---\n', block('---\n', 'a: 1\nb: 2\nc: 3', '\n', '---\n', '')],
    [
      'several lines, CRLF keep their carriage returns inside the text',
      '---\r\na: 1\r\nb: 2\r\n---\r\n',
      block('---\r\n', 'a: 1\r\nb: 2', '\r\n', '---\r\n', ''),
    ],
    ['a close followed by spaces', '---\na: 1\n---  \nbody', block('---\n', 'a: 1', '\n', '---  \n', 'body')],
    ['a close followed by a tab', '---\na: 1\n---\t\nbody', block('---\n', 'a: 1', '\n', '---\t\n', 'body')],
    [
      'a close followed by spaces and tabs',
      '---\na: 1\n--- \t \nbody',
      block('---\n', 'a: 1', '\n', '--- \t \n', 'body'),
    ],
    [
      'a close with trailing spaces and a CRLF ending',
      '---\r\na: 1\r\n---  \r\nbody',
      block('---\r\n', 'a: 1', '\r\n', '---  \r\n', 'body'),
    ],
    [
      'a close with trailing spaces at the end of the content',
      '---\na: 1\n--- ',
      block('---\n', 'a: 1', '\n', '--- ', ''),
    ],
    ['a close that is the last line, with no line ending', '---\na: 1\n---', block('---\n', 'a: 1', '\n', '---', '')],
    [
      'a close with a CRLF inside LF content',
      '---\na: 1\n---\r\nbody',
      block('---\n', 'a: 1', '\n', '---\r\n', 'body'),
    ],
    ['an empty block', '---\n---', block('---\n', '', '', '---', '')],
    ['an empty block with a body', '---\n---\nbody\n', block('---\n', '', '', '---\n', 'body\n')],
    ['an empty block, CRLF', '---\r\n---\r\nbody', block('---\r\n', '', '', '---\r\n', 'body')],
    ['one blank line has empty text and a line ending', '---\n\n---\n', block('---\n', '', '\n', '---\n', '')],
    ['two blank lines', '---\n\n\n---\n', block('---\n', '\n', '\n', '---\n', '')],
    ['a blank first line of the block', '---\n\na: 1\n---\n', block('---\n', '\na: 1', '\n', '---\n', '')],
    [
      'a body that starts with a rule is not split again',
      '---\na: 1\n---\n---\nb: 2\n---\n',
      block('---\n', 'a: 1', '\n', '---\n', '---\nb: 2\n---\n'),
    ],
    ['a body that is empty after a close at the end', '---\na: 1\n---\n', block('---\n', 'a: 1', '\n', '---\n', '')],
    ['a body with astral characters', '---\na: 1\n---\né😀\n', block('---\n', 'a: 1', '\n', '---\n', 'é😀\n')],
    ['a lone carriage return inside a line', '---\na\rb\n---\n', block('---\n', 'a\rb', '\n', '---\n', '')],
    [
      'a line that ends in a carriage return before a CRLF',
      '---\na\r\r\n---\n',
      block('---\n', 'a\r', '\r\n', '---\n', ''),
    ],
  ] as const)('%s', (_name, content, expected) => {
    expect(splitFrontmatterBlock(content)).toStrictEqual(expected)
  })

  it.each([
    ['---x', '---\na: 1\n---x: y\nb: 2\n---\nbody'],
    ['----', '---\na: 1\n----\nb: 2\n---\nbody'],
    ['--- text', '---\na: 1\n--- text\nb: 2\n---\nbody'],
    ['---#comment', '---\na: 1\n---#c\nb: 2\n---\nbody'],
    ['a rule after a tab and text', '---\na: 1\n---\t x\nb: 2\n---\nbody'],
  ] as const)('a %s line inside the block is content and the block ends at the later exact close', (_name, content) => {
    const result = splitFrontmatterBlock(content)
    expect(result.kind).toBe('block')
    if (result.kind !== 'block') return
    expect(result.text.split('\n')).toHaveLength(3)
    expect(result.text).toContain('b: 2')
    expect(result.closing).toBe('---\n')
    expect(result.body).toBe('body')
  })

  it('keeps the first exact close and leaves later rules in the body', () => {
    const result = splitFrontmatterBlock('---\na: 1\n---\nx\n---\ny\n---\n')
    expect(result).toStrictEqual(block('---\n', 'a: 1', '\n', '---\n', 'x\n---\ny\n---\n'))
  })
})

describe('splitFrontmatterBlock: no block', () => {
  it.each([
    ['an empty string', ''],
    ['text', 'just text\n'],
    ['a first line of three dashes and a trailing space', '--- \na: 1\n---\n'],
    ['a first line of three dashes and a tab', '---\t\na: 1\n---\n'],
    ['a byte-order mark before the dashes', '\uFEFF---\na: 1\n---\n'],
    ['a blank first line', '\n---\na: 1\n---\n'],
    ['a space before the dashes', ' ---\na: 1\n---\n'],
    ['four dashes', '----\na: 1\n---\n'],
    ['text after the dashes', '---x\na: 1\n---\n'],
    ['two dashes', '--\na: 1\n---\n'],
    ['three other characters', 'abc\na: 1\n---\n'],
    ['three other characters and a CRLF', '***\r\na: 1\r\n---\r\n'],
    ['three characters and no line ending', 'abc'],
    ['a lone carriage return after the dashes', '---\ra: 1\n---\n'],
    ['a carriage return after the dashes at the end of the content', '---\r'],
    ['a doubled carriage return before the line feed', '---\r\r\na: 1\n---\n'],
  ] as const)('%s', (_name, content) => {
    expect(splitFrontmatterBlock(content)).toStrictEqual({kind: 'none'})
  })
})

describe('splitFrontmatterBlock: a malformed block', () => {
  it.each([
    ['a file that is only the opening line, no line ending', '---'],
    ['a file that is only the opening line, LF', '---\n'],
    ['a file that is only the opening line, CRLF', '---\r\n'],
    ['an opened block with no close', '---\na: 1\n'],
    ['an opened block whose last line has no line ending', '---\na: 1'],
    ['a rule with text is not a close', '---\na: 1\n--- x\n'],
    ['four dashes are not a close', '---\na: 1\n----\n'],
    ['a rule with a suffix is not a close, even at the end', '---\n---x'],
    ['a close of three dashes and a lone carriage return at the end of the content', '---\na: 1\n---\r'],
    ['a close of three dashes and a doubled carriage return', '---\na: 1\n---\r\r\n'],
    ['a close with a carriage return and spaces', '---\na: 1\n---\r \n'],
    ['an indented rule is not a close', '---\na: 1\n ---\n'],
    ['a decoy URL after an unclosed block', '---\nsources: []\nSee https://github.com/o/r\n'],
  ] as const)('%s', (_name, content) => {
    expect(splitFrontmatterBlock(content)).toStrictEqual({kind: 'malformed'})
  })

  it('carries no content for a malformed or absent block', () => {
    expect(Object.keys(splitFrontmatterBlock('---\na: 1\n'))).toStrictEqual(['kind'])
    expect(Object.keys(splitFrontmatterBlock('plain'))).toStrictEqual(['kind'])
  })
})

// ─── The pieces put the document back ───

describe('splitFrontmatterBlock: reassembly', () => {
  // The in-place editors (the repo-page move and the plan-status corrector) change a line of the text and rebuild
  // the file from the pieces alone. Every byte they do not change must come back, whatever the line endings.
  const editedLine = 'related: [old]'
  const replacement = 'related: [new]'
  const documents = [
    ['LF', '---\ntitle: a\nrelated: [old]\ntags: [x]\n---\nbody\n'],
    ['CRLF', '---\r\ntitle: a\r\nrelated: [old]\r\ntags: [x]\r\n---\r\nbody\r\n'],
    ['a close with trailing spaces', '---\ntitle: a\nrelated: [old]\ntags: [x]\n---  \nbody\n'],
    ['a close with trailing spaces, CRLF', '---\r\ntitle: a\r\nrelated: [old]\r\ntags: [x]\r\n--- \t\r\nbody\r\n'],
    ['the edited line last in the block, LF', '---\ntitle: a\nrelated: [old]\n---\nbody\n'],
    ['the edited line last in the block, CRLF', '---\r\ntitle: a\r\nrelated: [old]\r\n---\r\nbody\r\n'],
    ['the edited line last in the block, a close at the end', '---\ntitle: a\nrelated: [old]\n---'],
    ['mixed line endings', '---\r\ntitle: a\nrelated: [old]\r\n---\nbody'],
  ] as const

  it.each(documents)('a spliced line comes back with every other byte kept: %s', (_name, content) => {
    const result = splitFrontmatterBlock(content)
    expect(result.kind).toBe('block')
    if (result.kind !== 'block') return

    // An editor splits the text at line feeds. A carriage return stays at the end of its line, except for the last
    // line, whose ending is in `textEnding`.
    const lines = result.text.split('\n')
    const at = lines.findIndex(line => line.startsWith(editedLine))
    expect(at).toBeGreaterThanOrEqual(0)
    lines[at] = (lines[at] ?? '').replace(editedLine, replacement)

    const rebuilt = result.opening + lines.join('\n') + result.textEnding + result.closing + result.body
    // The expected file comes from a plain string replacement on the original, not from the pieces.
    expect(rebuilt).toBe(content.replace(editedLine, replacement))
  })

  it.each(documents)('the unedited pieces concatenate to the original: %s', (_name, content) => {
    const result = splitFrontmatterBlock(content)
    expect(result.kind).toBe('block')
    if (result.kind !== 'block') return
    expect(reassemble(result)).toBe(content)
  })
})

// ─── The seeded corpus ───

type Trait =
  | 'bad-opening'
  | 'unclosed'
  | 'noise'
  | 'trailing-ws'
  | 'empty'
  | 'no-lines'
  | 'crlf-open'
  | 'crlf-textend'
  | 'crlf-close'

interface CorpusCase {
  readonly content: string
  readonly expected: FrontmatterBlockSplit
  readonly traits: ReadonlySet<Trait>
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

/**
 * Builds one document from parts and states what it must split into. The lines never contain a close, and the noise
 * lines start with three dashes without being a close, so how each document splits is known from how it was built.
 */
function buildCase(random: () => number): CorpusCase {
  const safeLines = [
    'title: a',
    'tags: [x, y]',
    '',
    '  - item',
    '# comment',
    ' ---',
    'key: "---"',
    'a\rb',
    'sources:',
    '- url: x',
    '-- ',
    '--',
  ]
  const noiseLines = ['---x: y', '----', '--- text', '---#c', '---\t x']
  const eolMode = pick(random, ['lf', 'lf', 'lf', 'crlf', 'mixed'] as const)
  const ending = (): string => (eolMode === 'lf' ? '\n' : eolMode === 'crlf' ? '\r\n' : pick(random, ['\n', '\r\n']))
  const bodies = ['', 'body\n', 'text\r\nmore', '---\nx: 1\n---\n', '\n', '---', '--- \n', 'é😀\n', 'a\n---\n']
  const traits = new Set<Trait>()

  const lineCount = Math.floor(random() * 5)
  const lines: {text: string; ending: string}[] = []
  for (let index = 0; index < lineCount; index += 1) {
    const noisy = random() < 0.25
    if (noisy) traits.add('noise')
    lines.push({text: pick(random, noisy ? noiseLines : safeLines), ending: ending()})
  }

  const kindRoll = random()
  if (kindRoll < 0.12) {
    // An opening line that is not exactly three dashes: no block, whatever follows.
    traits.add('bad-opening')
    const opening = pick(random, ['--- ', '\uFEFF---', ' ---', '----', '---x', '---\t', '---\r\r', '', '--'])
    const rest = `${lines.map(line => line.text + line.ending).join('')}---\n${pick(random, bodies)}`
    const content = opening === '' ? `\n---${ending()}${rest}` : opening + ending() + rest
    return {content, expected: {kind: 'none'}, traits}
  }

  const openingEnding = ending()
  const opening = `---${openingEnding}`
  if (kindRoll < 0.24) {
    traits.add('unclosed')
    if (lines.length === 0 && random() < 0.3) return {content: '---', expected: {kind: 'malformed'}, traits}
    const tail = random() < 0.4 ? pick(random, ['a: 1', '--- x', '---\r', '----', 'See https://github.com/o/r']) : ''
    const content = opening + lines.map(line => line.text + line.ending).join('') + tail
    return {content, expected: {kind: 'malformed'}, traits}
  }

  const closeSpace = pick(random, ['', '', '', ' ', '  ', '\t', ' \t '])
  const closeEnding = pick(random, ['\n', '\n', '\r\n', ''])
  const body = closeEnding === '' ? '' : pick(random, bodies)
  const text = lines.map((line, index) => line.text + (index < lines.length - 1 ? line.ending : '')).join('')
  const textEnding = lines.at(-1)?.ending ?? ''
  const closing = `---${closeSpace}${closeEnding}`
  const content = opening + lines.map(line => line.text + line.ending).join('') + closing + body

  if (closeSpace !== '') traits.add('trailing-ws')
  if (text === '') traits.add('empty')
  if (lines.length === 0) traits.add('no-lines')
  if (openingEnding === '\r\n') traits.add('crlf-open')
  if (textEnding === '\r\n') traits.add('crlf-textend')
  if (closeEnding === '\r\n') traits.add('crlf-close')
  return {content, expected: {kind: 'block', opening, text, textEnding, closing, body}, traits}
}

function buildCorpus(seed: number, size: number): CorpusCase[] {
  const random = seededRandom(seed)
  return Array.from({length: size}, () => buildCase(random))
}

const corpus = buildCorpus(20_261_112, 6000)

describe('the seeded corpus', () => {
  it('reaches every outcome and every trait in volume', () => {
    const kinds = {none: 0, block: 0, malformed: 0}
    const traits = new Map<Trait, number>()
    for (const entry of corpus) {
      kinds[entry.expected.kind] += 1
      for (const trait of entry.traits) traits.set(trait, (traits.get(trait) ?? 0) + 1)
    }
    expect(kinds.none).toBeGreaterThan(300)
    expect(kinds.block).toBeGreaterThan(3000)
    expect(kinds.malformed).toBeGreaterThan(300)
    for (const trait of [
      'bad-opening',
      'unclosed',
      'noise',
      'trailing-ws',
      'empty',
      'no-lines',
      'crlf-open',
      'crlf-textend',
      'crlf-close',
    ] as const) {
      expect(traits.get(trait) ?? 0, trait).toBeGreaterThan(100)
    }
  })

  it('splits every input into the pieces it was built from', () => {
    for (const entry of corpus) {
      expect(splitFrontmatterBlock(entry.content), JSON.stringify(entry.content)).toStrictEqual(entry.expected)
    }
  })

  it('puts every block back byte for byte', () => {
    for (const entry of corpus) {
      const result = splitFrontmatterBlock(entry.content)
      if (result.kind === 'block') expect(reassemble(result), JSON.stringify(entry.content)).toBe(entry.content)
    }
  })

  it('splits a document the same way after its body changes', () => {
    for (const entry of corpus.slice(0, 600)) {
      const result = splitFrontmatterBlock(entry.content)
      if (result.kind !== 'block' || !result.closing.endsWith('\n')) continue
      const changed = splitFrontmatterBlock(
        `${result.opening}${result.text}${result.textEnding}${result.closing}---\nnot a block\n`,
      )
      expect(changed).toStrictEqual({...result, body: '---\nnot a block\n'})
    }
  })
})

// ─── The old regex shapes, frozen as references ───

// Four shapes were copied across twelve sites. Each is run through its `exec` here exactly as the sites did.
const OLD_LF_PREFIX = /^---\n([\s\S]+?)\n---\n?/u // frontmatter.ts, wiki-utils.ts, wiki-ingest.ts (2), repo-page-move.ts, solutions-query.ts, capture-patterns-synthesis.ts, capture-learnings-harvest.ts, improvement-metrics-detect.ts
const OLD_CRLF_EMPTY_OK = /^---\r?\n([\s\S]*?)\r?\n---/ // check-wiki-private-presence.ts
const OLD_CRLF_RESOLVER = /^---\r?\n([\s\S]+?)\r?\n---/u // detect-plan-consistency.ts, status resolver
const OLD_CRLF_CORRECTOR = /^(---\r?\n)([\s\S]+?)(\r?\n---)/u // detect-plan-consistency.ts, status corrector

interface View {
  readonly matched: boolean
  /** True for an opened block with no close. The old shapes could not say so. */
  readonly malformed?: boolean
  readonly opening?: string
  readonly text?: string
  readonly closer?: string
  readonly body?: string
}

interface Shape {
  readonly name: string
  /** The conditions under which the new splitter is meant to differ from this shape. */
  readonly changedBy: ReadonlySet<Trait>
  readonly old: (content: string) => View
}

const shapes: readonly Shape[] = [
  {
    name: 'LF only, prefix close, no empty block (nine sites)',
    changedBy: new Set<Trait>(['crlf-open', 'crlf-textend', 'crlf-close', 'noise', 'trailing-ws', 'empty', 'unclosed']),
    old(content) {
      const match = OLD_LF_PREFIX.exec(content)
      if (match === null) return {matched: false}
      return {matched: true, text: match[1], body: content.slice(match[0].length)}
    },
  },
  {
    name: 'CRLF tolerant, empty text allowed (the privacy gate)',
    changedBy: new Set<Trait>(['noise', 'no-lines', 'unclosed']),
    old(content) {
      const match = OLD_CRLF_EMPTY_OK.exec(content)
      return match === null ? {matched: false} : {matched: true, text: match[1]}
    },
  },
  {
    name: 'CRLF tolerant, non-empty text (the plan-status resolver)',
    changedBy: new Set<Trait>(['noise', 'empty', 'unclosed']),
    old(content) {
      const match = OLD_CRLF_RESOLVER.exec(content)
      return match === null ? {matched: false} : {matched: true, text: match[1]}
    },
  },
  {
    name: 'CRLF tolerant with captured delimiters (the plan-status corrector)',
    changedBy: new Set<Trait>(['noise', 'empty', 'unclosed']),
    old(content) {
      const match = OLD_CRLF_CORRECTOR.exec(content)
      if (match === null) return {matched: false}
      return {matched: true, opening: match[1], text: match[2], closer: match[3]}
    },
  },
]

function newView(result: FrontmatterBlockSplit): View {
  if (result.kind !== 'block') return {matched: false, malformed: result.kind === 'malformed'}
  return {
    matched: true,
    opening: result.opening,
    text: result.text,
    closer: `${result.textEnding}---`,
    body: result.body,
  }
}

/** Only the fields the old shape exposes are compared. */
function sameView(old: View, next: View): boolean {
  return (
    old.matched === next.matched &&
    (old.malformed ?? false) === (next.malformed ?? false) &&
    (old.opening === undefined || old.opening === next.opening) &&
    (old.text === undefined || old.text === next.text) &&
    (old.closer === undefined || old.closer === next.closer) &&
    (old.body === undefined || old.body === next.body)
  )
}

/**
 * Outside the shape's changed conditions the old and new reads must be equal. Inside them the new split must equal
 * the result the input was built to give. Returns one message per violation, plus the conditions for which the old
 * shape was seen to differ on an input where only that condition applied, so a vacuous comparison is visible.
 */
function compareWithShape(
  shape: Shape,
  cases: readonly CorpusCase[],
  split: (content: string) => FrontmatterBlockSplit,
): {problems: string[]; isolated: Set<Trait>} {
  const problems: string[] = []
  const isolated = new Set<Trait>()
  for (const entry of cases) {
    const result = split(entry.content)
    const changed = [...entry.traits].filter(trait => shape.changedBy.has(trait))
    if (changed.length === 0) {
      if (!sameView(shape.old(entry.content), newView(result)))
        problems.push(`differs outside a changed condition: ${JSON.stringify(entry.content)}`)
      continue
    }
    if (JSON.stringify(result) !== JSON.stringify(entry.expected))
      problems.push(`not the stated result: ${JSON.stringify(entry.content)}`)
    const [only] = changed
    if (changed.length === 1 && only !== undefined && !sameView(shape.old(entry.content), newView(entry.expected)))
      isolated.add(only)
  }
  return {problems, isolated}
}

describe.each(shapes)('against the old regex: $name', shape => {
  it('is equal outside the changed conditions and equal to the stated result inside them', () => {
    expect(compareWithShape(shape, corpus, splitFrontmatterBlock).problems).toStrictEqual([])
  })

  it('differs from the old regex under every changed condition on its own', () => {
    const {isolated} = compareWithShape(shape, corpus, splitFrontmatterBlock)
    expect([...isolated].toSorted()).toStrictEqual([...shape.changedBy].toSorted())
  })

  it('fails when an offset is wrong', () => {
    const wrongOffset = (content: string): FrontmatterBlockSplit => {
      const result = splitFrontmatterBlock(content)
      return result.kind === 'block' ? {...result, text: result.text.slice(1), body: result.body.slice(1)} : result
    }
    expect(compareWithShape(shape, corpus, wrongOffset).problems.length).toBeGreaterThan(0)
  })

  it('fails when the decision is wrong for a changed condition', () => {
    const wrongDecision = (content: string): FrontmatterBlockSplit => {
      const result = splitFrontmatterBlock(content)
      return result.kind === 'malformed' ? {kind: 'none'} : result
    }
    const noiseAsClose = (content: string): FrontmatterBlockSplit => {
      const result = splitFrontmatterBlock(content)
      if (result.kind !== 'block') return result
      const lines = result.text.split('\n')
      const cut = lines.findIndex(line => line.startsWith('---'))
      return cut === -1 ? result : {...result, text: lines.slice(0, cut).join('\n')}
    }
    expect(compareWithShape(shape, corpus, wrongDecision).problems.length).toBeGreaterThan(0)
    expect(compareWithShape(shape, corpus, noiseAsClose).problems.length).toBeGreaterThan(0)
  })
})
