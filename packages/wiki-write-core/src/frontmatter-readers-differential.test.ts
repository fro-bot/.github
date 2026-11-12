/**
 * The five readers in this package that used to find the frontmatter block with their own regex now use
 * `splitFrontmatterBlock`. This file compares each reader with the regex it replaced.
 *
 * - `characterization`: pins behaviour that must not change, with explicit inputs. These tests passed on the code
 *   before the readers moved and must pass after.
 * - The differential: documents are built from parts (see `buildCase`), so what each reader must return is known
 *   from how the document was built. Outside the conditions the split is meant to change, the frozen old reader and
 *   the new reader must agree. Inside them, the new reader must return the stated result. A deliberately wrong
 *   offset and a deliberately wrong decision must each fail the comparison.
 *
 * The generator is a copy of the one in `frontmatter-block.test.ts`, extended with other line vocabularies. This
 * package cannot depend on the test kit, so later packages copy it again.
 */

import {describe, expect, it} from 'vitest'
import {parse, stringify} from 'yaml'
import {parseFrontmatterDocument} from './frontmatter.ts'
import {applyPageChanges, planRepoPageMove} from './repo-page-move.ts'
import {buildWikiIngestChanges} from './wiki-ingest.ts'
import {lintWikiSnapshot} from './wiki-lint.ts'
import {parseWikiPage, splitFrontmatter} from './wiki-utils.ts'

// ─── The reference: the regex as it was, in all five readers ───

const OLD_LF_PREFIX = /^---\n([\s\S]+?)\n---\n?/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── The corpus ───

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
  | 'crlf-inner'

type Split =
  | {readonly kind: 'none'}
  | {readonly kind: 'malformed'}
  | {
      readonly kind: 'block'
      readonly opening: string
      readonly text: string
      readonly textEnding: string
      readonly closing: string
      readonly body: string
    }

interface CorpusCase {
  readonly content: string
  readonly expected: Split
  readonly traits: ReadonlySet<Trait>
}

interface BuiltLine {
  readonly text: string
  readonly noisy: boolean
}

type LineSource = (random: () => number) => BuiltLine[]

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

const NOISE_LINES = ['---x: y', '----', '--- text', '---#c', '---\t x'] as const

function withNoise(random: () => number, lines: string[], rate: number): BuiltLine[] {
  const built = lines.map(text => ({text, noisy: false}))
  if (random() < rate)
    built.splice(Math.floor(random() * (built.length + 1)), 0, {text: pick(random, NOISE_LINES), noisy: true})
  return built
}

/** Mapping-shaped lines for the readers that parse the block and return its values. */
const yamlLines: LineSource = random => {
  const lines = Array.from({length: Math.floor(random() * 4)}, () =>
    pick(random, ['title: a', 'tags: [x, y]', '', '# comment', 'key: "---"', 'sources: []', 'n: 1', 'related: [a, b]']),
  )
  return withNoise(random, lines, 0.25)
}

/** The four fields the ingest requires, with the optional ones it knows, sometimes one missing or one invalid. */
const ingestLines: LineSource = random => {
  const lines = ['type: topic', 'title: A', 'created: 2026-01-01', 'updated: 2026-01-02']
  if (random() < 0.15) lines.splice(Math.floor(random() * lines.length), 1)
  if (random() < 0.3) lines.push('database_id: 5')
  if (random() < 0.3) lines.push('tags: [x, y]')
  if (random() < 0.05) lines.push('bad: [')
  return withNoise(random, lines, 0.2)
}

/** A topic page with one flow `related:` line that names the repo page being renamed. */
const moveLines: LineSource = random => {
  const lines = ['type: topic', 'title: A', 'created: 2026-01-01', 'updated: 2026-01-02']
  if (random() < 0.3) lines.push('tags: [x]')
  lines.push(random() < 0.3 ? 'related: [acme--old-page, other]' : 'related: [acme--old-page]')
  return withNoise(random, lines, 0.2)
}

const BODIES = [
  '',
  'body\n',
  'text\r\nmore',
  '---\nx: 1\n---\n',
  '\n',
  '---',
  '--- \n',
  'é😀\n',
  'a\n---\n',
  '  lead\n',
] as const

function buildCase(random: () => number, source: LineSource): CorpusCase {
  const eolMode = pick(random, ['lf', 'lf', 'lf', 'crlf', 'mixed'] as const)
  const ending = (): string => (eolMode === 'lf' ? '\n' : eolMode === 'crlf' ? '\r\n' : pick(random, ['\n', '\r\n']))
  const traits = new Set<Trait>()
  const lines = source(random).map(line => ({...line, ending: ending()}))
  if (lines.some(line => line.noisy)) traits.add('noise')

  const kindRoll = random()
  if (kindRoll < 0.1) {
    traits.add('bad-opening')
    const opening = pick(random, ['--- ', '\uFEFF---', ' ---', '----', '---x', '---\t', '---\r\r', '', '--'])
    const rest = `${lines.map(line => line.text + line.ending).join('')}---\n${pick(random, BODIES)}`
    const content = opening === '' ? `\n---${ending()}${rest}` : opening + ending() + rest
    return {content, expected: {kind: 'none'}, traits}
  }

  const openingEnding = ending()
  const opening = `---${openingEnding}`
  if (kindRoll < 0.2) {
    traits.add('unclosed')
    const tail = random() < 0.4 ? pick(random, ['a: 1', '--- x', '----', 'See https://github.com/o/r']) : ''
    return {
      content: opening + lines.map(line => line.text + line.ending).join('') + tail,
      expected: {kind: 'malformed'},
      traits,
    }
  }

  const closeSpace = pick(random, ['', '', '', ' ', '  ', '\t', ' \t '])
  const closeEnding = pick(random, ['\n', '\n', '\r\n', ''])
  const body = closeEnding === '' ? '' : pick(random, BODIES)
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
  if (lines.slice(0, -1).some(line => line.ending === '\r\n')) traits.add('crlf-inner')
  return {content, expected: {kind: 'block', opening, text, textEnding, closing, body}, traits}
}

function buildCorpus(seed: number, size: number, source: LineSource): CorpusCase[] {
  const random = seededRandom(seed)
  return Array.from({length: size}, () => buildCase(random, source))
}

// ─── The sites ───

interface Site<Outcome> {
  readonly name: string
  readonly source: LineSource
  /** The conditions under which the site is meant to differ from its old regex. */
  readonly changedBy: ReadonlySet<Trait>
  /** The reader as it was, with the old regex. */
  readonly old: (content: string) => Outcome
  /** The reader as it is now, through the package's public surface. */
  readonly actual: (content: string) => Outcome
  /** What the reader must return, from how the document was built. */
  readonly expected: (entry: CorpusCase) => Outcome
}

/** The conditions that change a reader whose old regex was the LF-only, prefix-close, non-empty one. */
const LF_ONLY_CHANGES: ReadonlySet<Trait> = new Set<Trait>([
  'crlf-open',
  'crlf-textend',
  'crlf-close',
  'noise',
  'trailing-ws',
  'empty',
  'unclosed',
])

/** A reader that trims the body, or never returns it, cannot show what the close line leaves at its start. */
const WITHOUT_CLOSE_LAYOUT: ReadonlySet<Trait> = new Set(
  [...LF_ONLY_CHANGES].filter(trait => trait !== 'crlf-close' && trait !== 'trailing-ws'),
)

/** The sources whose vocabulary has no empty block; `buildCase` never builds one for them. */
const WITHOUT_EMPTY_BLOCK: ReadonlySet<Trait> = new Set([...WITHOUT_CLOSE_LAYOUT].filter(trait => trait !== 'empty'))

interface DocumentOutcome {
  readonly values?: Record<string, unknown>
  readonly body?: string
  readonly error?: string
}

function documentReaderSite(): Site<DocumentOutcome> {
  return {
    name: 'frontmatter.ts parseFrontmatterDocument',
    source: yamlLines,
    changedBy: LF_ONLY_CHANGES,
    old(content) {
      try {
        const match = OLD_LF_PREFIX.exec(content)
        if (match === null || match[1] === undefined) throw new Error('validated wiki page is missing frontmatter')
        const parsed: unknown = parse(match[1])
        if (!isRecord(parsed)) throw new Error('validated wiki page frontmatter is not an object')
        return {values: parsed, body: content.slice(match[0].length)}
      } catch (error: unknown) {
        return {error: errorMessage(error)}
      }
    },
    actual(content) {
      try {
        return {...parseFrontmatterDocument(content)}
      } catch (error: unknown) {
        return {error: errorMessage(error)}
      }
    },
    expected(entry) {
      if (entry.expected.kind !== 'block') return {error: 'validated wiki page is missing frontmatter'}
      try {
        const parsed: unknown = entry.expected.text === '' ? {} : parse(entry.expected.text)
        if (!isRecord(parsed)) return {error: 'validated wiki page frontmatter is not an object'}
        return {values: parsed, body: entry.expected.body}
      } catch (error: unknown) {
        return {error: errorMessage(error)}
      }
    },
  }
}

interface PageReaderOutcome {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
  readonly error?: string
}

function pageReaderSite(): Site<PageReaderOutcome> {
  return {
    name: 'wiki-utils.ts splitFrontmatter',
    source: yamlLines,
    changedBy: WITHOUT_CLOSE_LAYOUT,
    old(content) {
      const match = OLD_LF_PREFIX.exec(content)
      if (match === null || match[1] === undefined) return {frontmatter: {}, body: content.trim()}
      try {
        const parsed: unknown = parse(match[1])
        return {frontmatter: isRecord(parsed) ? parsed : {}, body: content.slice(match[0].length).trim()}
      } catch (error: unknown) {
        return {
          frontmatter: {},
          body: content.slice(match[0].length).trim(),
          error: `Invalid YAML frontmatter: ${errorMessage(error)}`,
        }
      }
    },
    actual(content) {
      return {...splitFrontmatter(content)}
    },
    expected(entry) {
      if (entry.expected.kind === 'none') return {frontmatter: {}, body: entry.content.trim()}
      if (entry.expected.kind === 'malformed') {
        return {
          frontmatter: {},
          body: entry.content.trim(),
          error: 'Invalid frontmatter: missing closing --- delimiter',
        }
      }
      try {
        const parsed: unknown = parse(entry.expected.text)
        return {frontmatter: isRecord(parsed) ? parsed : {}, body: entry.expected.body.trim()}
      } catch (error: unknown) {
        return {
          frontmatter: {},
          body: entry.expected.body.trim(),
          error: `Invalid YAML frontmatter: ${errorMessage(error)}`,
        }
      }
    },
  }
}

const INGEST_PATH = 'knowledge/wiki/topics/subject.md'

interface IngestOutcome {
  readonly error?: string
  readonly written?: string
}

function ingestActual(content: string): IngestOutcome {
  try {
    const result = buildWikiIngestChanges({
      existingFiles: {'knowledge/index.md': '# Wiki Index\n', 'knowledge/log.md': '# Wiki Log\n'},
      operation: 'manual-edit',
      target: 'topic:subject',
      summary: 'check',
      timestamp: new Date('2026-11-12T00:00:00Z'),
      sources: [],
      pages: [{path: INGEST_PATH, content}],
    })
    return {written: result.files[INGEST_PATH]}
  } catch (error: unknown) {
    return {error: errorMessage(error)}
  }
}

/** The ingest page parser's checks, then the `database_id` rewrite, for a topic page. Shared by old and expected. */
function ingestFromBlock(content: string, text: string | undefined, body: string): IngestOutcome {
  if (text === undefined) return {error: `${INGEST_PATH} is missing YAML frontmatter`}
  let parsed: unknown
  try {
    parsed = text === '' ? {} : parse(text)
  } catch (error: unknown) {
    return {error: errorMessage(error)}
  }
  if (!isRecord(parsed)) return {error: `${INGEST_PATH} frontmatter must parse to an object`}
  if (
    parsed.type !== 'topic' ||
    typeof parsed.title !== 'string' ||
    typeof parsed.created !== 'string' ||
    typeof parsed.updated !== 'string'
  ) {
    return {error: `${INGEST_PATH} frontmatter must include type, title, created, and updated`}
  }
  if ('database_id' in parsed) {
    const rest = {...parsed}
    delete rest.database_id
    return {written: `---\n${stringify(rest).trimEnd()}\n---\n\n${body.trim()}\n`}
  }
  return {written: content.endsWith('\n') ? content : `${content}\n`}
}

function ingestParserSite(): Site<IngestOutcome> {
  return {
    name: 'wiki-ingest.ts parseFrontmatter (the page parser)',
    source: ingestLines,
    changedBy: WITHOUT_EMPTY_BLOCK,
    old(content) {
      const match = OLD_LF_PREFIX.exec(content)
      // Only the parser's own errors and whether it accepted the page are compared here.
      const outcome = ingestFromBlock(content, match?.[1], match === null ? '' : content.slice(match[0].length))
      return outcome.error === undefined ? {} : {error: outcome.error}
    },
    actual(content) {
      const outcome = ingestActual(content)
      return outcome.error === undefined ? {} : {error: outcome.error}
    },
    expected(entry) {
      const split = entry.expected
      const outcome = ingestFromBlock(
        entry.content,
        split.kind === 'block' ? split.text : undefined,
        split.kind === 'block' ? split.body : '',
      )
      return outcome.error === undefined ? {} : {error: outcome.error}
    },
  }
}

function ingestDocumentReaderSite(): Site<IngestOutcome> {
  return {
    name: 'wiki-ingest.ts parseFrontmatterDocument (the former private reader)',
    source: ingestLines,
    changedBy: WITHOUT_EMPTY_BLOCK,
    old(content) {
      const match = OLD_LF_PREFIX.exec(content)
      return ingestFromBlock(content, match?.[1], match === null ? '' : content.slice(match[0].length))
    },
    actual: ingestActual,
    expected(entry) {
      const split = entry.expected
      return ingestFromBlock(
        entry.content,
        split.kind === 'block' ? split.text : undefined,
        split.kind === 'block' ? split.body : '',
      )
    },
  }
}

const OLD_SLUG = 'acme--old-page'
const NEW_SLUG = 'acme--new-page'
const OLD_PAGE_PATH = `knowledge/wiki/repos/${OLD_SLUG}.md`
const TOPIC_PATH = 'knowledge/wiki/topics/subject.md'

interface MoveOutcome {
  readonly blocked?: string
  readonly topic?: string
}

function moveFiles(topic: string): Record<string, string> {
  return {
    [OLD_PAGE_PATH]: [
      '---',
      'type: repo',
      'title: acme/old-page',
      'created: 2026-01-01',
      'updated: 2026-01-02',
      'node_id: R_1',
      '---',
      '',
      '# acme/old-page',
      '',
    ].join('\n'),
    [TOPIC_PATH]: topic,
  }
}

function moveActual(content: string): MoveOutcome {
  const files = moveFiles(content)
  const plan = planRepoPageMove({
    files,
    nodeId: 'R_1',
    owner: 'acme',
    oldName: 'old-page',
    newName: 'new-page',
    rowName: 'old-page',
    otherRows: [],
    timestamp: new Date('2026-11-12T00:00:00Z'),
  })
  if (plan.outcome === 'blocked') return {blocked: plan.reason}
  if (plan.outcome !== 'moved') return {blocked: plan.outcome}
  return {topic: applyPageChanges(files, plan.changes)[TOPIC_PATH]}
}

function moveSite(): Site<MoveOutcome> {
  return {
    name: 'repo-page-move.ts editRelatedText (the text edit)',
    source: moveLines,
    changedBy: new Set<Trait>([...WITHOUT_EMPTY_BLOCK, 'crlf-inner']),
    old(content) {
      const match = OLD_LF_PREFIX.exec(content)
      if (match === null || match[1] === undefined) return {blocked: 'unparseable-page'}
      let parsed: unknown
      try {
        parsed = parse(match[1])
      } catch {
        return {blocked: 'unparseable-page'}
      }
      if (!isRecord(parsed)) return {blocked: 'unparseable-page'}
      // The old text edit: replace the flow `related:` line inside the matched block, keep every other byte.
      const lines = match[1].split('\n')
      const at = lines.findIndex(line => line.startsWith('related: ['))
      lines[at] = (lines[at] ?? '').replace(OLD_SLUG, NEW_SLUG)
      return {topic: content.slice(0, 4) + lines.join('\n') + content.slice(4 + match[1].length)}
    },
    actual: moveActual,
    expected(entry) {
      const split = entry.expected
      if (split.kind !== 'block') return {blocked: 'unparseable-page'}
      let parsed: unknown
      try {
        parsed = parse(split.text)
      } catch {
        return {blocked: 'unparseable-page'}
      }
      if (!isRecord(parsed)) return {blocked: 'unparseable-page'}

      // The text edit declines for a CRLF layout; the page is then re-rendered from its parsed values.
      const lineFeedLayout =
        !split.opening.includes('\r') && !split.textEnding.includes('\r') && !split.text.includes('\r\n')
      if (lineFeedLayout) return {topic: entry.content.replace(OLD_SLUG, NEW_SLUG)}

      const related = (parsed.related as string[]).map(entry => (entry === OLD_SLUG ? NEW_SLUG : entry))
      const unique = related.filter((entry, index) => related.indexOf(entry) === index)
      const body = split.body.endsWith('\n') ? split.body : `${split.body}\n`
      return {topic: `---\n${stringify({...parsed, related: unique}).trimEnd()}\n---\n\n${body.trim()}\n`}
    },
  }
}

// ─── The comparison ───

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Outside the site's changed conditions the old and the new reader must agree. Inside them the new reader must
 * return the stated result. Returns the violations, and the changed conditions for which the old reader was seen to
 * differ from the stated result on an input where only that condition applied, so a vacuous comparison shows.
 */
function compareSite<Outcome>(
  site: Site<Outcome>,
  corpus: readonly CorpusCase[],
  actual: (content: string) => Outcome,
): {outside: string[]; inside: string[]; isolated: Set<Trait>} {
  const outside: string[] = []
  const inside: string[] = []
  const isolated = new Set<Trait>()
  for (const entry of corpus) {
    const changed = [...entry.traits].filter(trait => site.changedBy.has(trait))
    const got = actual(entry.content)
    if (changed.length === 0) {
      if (!same(site.old(entry.content), got)) outside.push(JSON.stringify(entry.content))
      continue
    }
    const stated = site.expected(entry)
    if (!same(stated, got)) inside.push(JSON.stringify(entry.content))
    const [only] = changed
    if (changed.length === 1 && only !== undefined && !same(site.old(entry.content), stated)) isolated.add(only)
  }
  return {outside, inside, isolated}
}

/** An offset that is wrong: the reader sees the content without its last character. */
function withWrongOffset<Outcome>(actual: (content: string) => Outcome): (content: string) => Outcome {
  return content => actual(content.slice(0, -1))
}

/** A decision that is wrong for the changed conditions: any line that starts with three dashes closes the block. */
function withPrefixClose<Outcome>(actual: (content: string) => Outcome): (content: string) => Outcome {
  return content =>
    actual(
      content
        .split('\n')
        .map((line, index) => (index > 0 && line.startsWith('---') ? '---' : line))
        .join('\n'),
    )
}

const SIZE = 2500
const sites = [
  documentReaderSite(),
  pageReaderSite(),
  ingestParserSite(),
  ingestDocumentReaderSite(),
  moveSite(),
] as const

describe.each(sites)('against the old regex: $name', site => {
  const corpus = buildCorpus(20_261_113, SIZE, site.source)
  const compare = site as unknown as Site<unknown>

  it('reaches every outcome and every changed condition in volume', () => {
    const kinds = {none: 0, block: 0, malformed: 0}
    const traits = new Map<Trait, number>()
    for (const entry of corpus) {
      kinds[entry.expected.kind] += 1
      for (const trait of entry.traits) traits.set(trait, (traits.get(trait) ?? 0) + 1)
    }
    expect(kinds.none).toBeGreaterThan(100)
    expect(kinds.block).toBeGreaterThan(1000)
    expect(kinds.malformed).toBeGreaterThan(100)
    for (const trait of site.changedBy) expect(traits.get(trait) ?? 0, trait).toBeGreaterThan(30)
  })

  it('agrees with the old regex outside the changed conditions', () => {
    expect(compareSite(compare, corpus, compare.actual).outside).toStrictEqual([])
  })

  it('returns the stated result inside the changed conditions', () => {
    expect(compareSite(compare, corpus, compare.actual).inside).toStrictEqual([])
  })

  it('differs from the old regex under every changed condition on its own', () => {
    const {isolated} = compareSite(compare, corpus, compare.actual)
    expect([...isolated].toSorted()).toStrictEqual([...compare.changedBy].toSorted())
  })

  it('fails when an offset is wrong', () => {
    const {outside, inside} = compareSite(compare, corpus, withWrongOffset(compare.actual))
    expect(outside.length + inside.length).toBeGreaterThan(0)
  })

  it('fails when the decision is wrong for a changed condition', () => {
    const {outside, inside} = compareSite(compare, corpus, withPrefixClose(compare.actual))
    expect(outside.length + inside.length).toBeGreaterThan(0)
  })
})

// ─── Characterization: behaviour the move must not change ───

describe('characterization of the ingest document reader and the move text edit', () => {
  const topic = (extra: readonly string[], body = '\nBody text.\n'): string =>
    ['---', 'type: topic', 'title: A', 'created: 2026-01-01', 'updated: 2026-01-02', ...extra, '---'].join('\n') + body

  it('removes database_id from an LF page, keeps the other keys in order and trims the body to one newline', () => {
    const written = ingestActual(topic(['database_id: 5', 'tags: [x, y]'], '\n\n  Body text.  \n\n\n')).written
    expect(written).toBe(
      [
        '---',
        'type: topic',
        'title: A',
        'created: 2026-01-01',
        'updated: 2026-01-02',
        'tags:',
        '  - x',
        '  - y',
        '---',
        '',
        'Body text.',
        '',
      ].join('\n'),
    )
  })

  it('writes a page without database_id byte for byte, adding a final newline', () => {
    const content = topic(['tags: [x]'], '\nBody text.')
    expect(ingestActual(content).written).toBe(`${content}\n`)
    expect(ingestActual(`${content}\n`).written).toBe(`${content}\n`)
  })

  it('names the page in the error for a page without a block', () => {
    expect(ingestActual('Just text.\n').error).toBe(`${INGEST_PATH} is missing YAML frontmatter`)
  })

  it('reports a block that is not a mapping and a block with a missing field', () => {
    expect(ingestActual('---\n- a\n- b\n---\nbody\n').error).toBe(`${INGEST_PATH} frontmatter must parse to an object`)
    expect(ingestActual('---\ntype: topic\ntitle: A\n---\nbody\n').error).toBe(
      `${INGEST_PATH} frontmatter must include type, title, created, and updated`,
    )
  })

  it.each([
    ['block sequence', ['related:', `  - ${OLD_SLUG}`, '  - other'], ['related:', `  - ${NEW_SLUG}`, '  - other']],
    ['flow sequence', [`related: [${OLD_SLUG}, other]`], [`related: [${NEW_SLUG}, other]`]],
    [
      'flow sequence with both slugs',
      [`related: [${OLD_SLUG}, ${NEW_SLUG}, other]`],
      [`related: [${NEW_SLUG}, other]`],
    ],
  ] as const)(
    'edits only the related lines of an LF page for a %s, keeping the other bytes',
    (_layout, before, after) => {
      const page = (related: readonly string[]): string =>
        [
          '---',
          'type: topic',
          'title: A',
          'created: 2026-01-01',
          'updated: 2026-01-02',
          'tags: [x]  # keep',
          ...related,
          '---',
          '',
          'Body.',
          '',
        ].join('\n')
      expect(moveActual(page(before)).topic).toBe(page(after))
    },
  )

  it('blocks a move when a page has no block, as it does for a page it cannot parse', () => {
    expect(moveActual('Just text.\n').blocked).toBe('unparseable-page')
  })
})

// ─── Scenarios: what each reader does with the shapes the old regex could not read ───

const MISSING = 'validated wiki page is missing frontmatter'
const NOT_OBJECT = 'validated wiki page frontmatter is not an object'
const UNCLOSED = 'Invalid frontmatter: missing closing --- delimiter'

describe('the frontmatter document reader', () => {
  it('reads a CRLF page with its values and body', () => {
    expect(parseFrontmatterDocument('---\r\ntitle: A\r\ntags: [x]\r\n---\r\nBody.\r\n')).toStrictEqual({
      values: {title: 'A', tags: ['x']},
      body: 'Body.\r\n',
    })
  })

  it('reads a block whose keys follow a ---x line', () => {
    expect(parseFrontmatterDocument('---\na: 1\n---x: y\nb: 2\n---\nBody.\n').values).toStrictEqual({
      a: 1,
      '---x': 'y',
      b: 2,
    })
  })

  it('does not leave the spaces of a close at the start of the body', () => {
    expect(parseFrontmatterDocument('---\na: 1\n---  \nBody.\n').body).toBe('Body.\n')
  })

  it('reads an empty block as an empty mapping, and the body after it', () => {
    expect(parseFrontmatterDocument('---\n---\nBody.\n')).toStrictEqual({values: {}, body: 'Body.\n'})
    expect(parseFrontmatterDocument('---\n---')).toStrictEqual({values: {}, body: ''})
  })

  it.each([
    ['whitespace only', '---\n \n---\n'],
    ['comments only', '---\n# a note\n---\n'],
    ['null', '---\nnull\n---\n'],
    ['a document end marker', '---\n...\n---\n'],
    ['a list', '---\n- a\n---\n'],
    ['a scalar', '---\njust text\n---\n'],
  ])('is not an empty mapping for a block of %s', (_name, content) => {
    expect(() => parseFrontmatterDocument(content)).toThrow(NOT_OBJECT)
  })

  it('reads a mapping that ends with a document end marker', () => {
    expect(parseFrontmatterDocument('---\na: 1\n...\n---\nBody.\n').values).toStrictEqual({a: 1})
  })

  it('gives invalid YAML its own error when a document end marker sits between two keys', () => {
    expect(() => parseFrontmatterDocument('---\na: 1\n...\nb: 2\n---\n')).toThrow(/YAML|Nested|Unexpected|document/iu)
    expect(() => parseFrontmatterDocument('---\na: 1\n...\nb: 2\n---\n')).not.toThrow(MISSING)
  })

  it.each([
    ['an unclosed block', '---\na: 1\n'],
    ['a file that is only the opening line', '---'],
    ['a rule with text is not a close', '---\na: 1\n--- x\n'],
  ])('throws its missing-frontmatter error for %s', (_name, content) => {
    expect(() => parseFrontmatterDocument(content)).toThrow(MISSING)
  })
})

describe('the wiki page reader', () => {
  it('reads a CRLF page with its metadata and trims the body', () => {
    const page = parseWikiPage(
      'knowledge/wiki/topics/a.md',
      '---\r\ntype: topic\r\ntitle: A\r\ntags: [x]\r\n---\r\n\r\nBody.\r\n',
    )
    expect(page.frontmatter).toStrictEqual({type: 'topic', title: 'A', tags: ['x']})
    expect(page.tags).toStrictEqual(['x'])
    expect(page.body).toBe('Body.')
    expect(page.frontmatterError).toBeUndefined()
  })

  it('reads an empty block as empty frontmatter with no error, keeping the body', () => {
    expect(splitFrontmatter('---\n---\nBody.\n')).toStrictEqual({frontmatter: {}, body: 'Body.'})
  })

  it.each([
    ['an unclosed block', '---\ntype: topic\ntitle: A\n'],
    ['a file that is only the opening line', '---\n'],
    ['an unclosed block behind a decoy', '---\nsources: []\nSee https://github.com/o/r\n'],
  ])('returns its frontmatter error for %s', (_name, content) => {
    const result = splitFrontmatter(content)
    expect(result.error).toBe(UNCLOSED)
    expect(result.frontmatter).toStrictEqual({})
    expect(result.body).toBe(content.trim())
  })

  it.each([
    ['whitespace only', '---\n \n---\nBody.\n'],
    ['comments only', '---\n# note\n---\nBody.\n'],
    ['null', '---\nnull\n---\nBody.\n'],
    ['a document end marker', '---\n...\n---\nBody.\n'],
  ])('returns empty frontmatter with no error for a block of %s', (_name, content) => {
    expect(splitFrontmatter(content)).toStrictEqual({frontmatter: {}, body: 'Body.'})
  })

  it('gives invalid YAML between two keys the error it has today', () => {
    const result = splitFrontmatter('---\na: 1\n...\nb: 2\n---\nBody.\n')
    expect(result.error).toMatch(/^Invalid YAML frontmatter: /u)
  })

  it('makes wiki lint report invalid-frontmatter, not missing-frontmatter, for an unclosed page', () => {
    const files = {
      'knowledge/wiki/topics/a.md': '---\ntype: topic\ntitle: A\ncreated: 2026-01-01\nupdated: 2026-01-01\n\nBody.\n',
    }
    const kinds = lintWikiSnapshot({files})
      .deterministicFindings.filter(finding => finding.path === 'knowledge/wiki/topics/a.md')
      .map(finding => finding.kind)
    expect(kinds).toContain('invalid-frontmatter')
    expect(kinds).not.toContain('missing-frontmatter')
  })
})

describe('the ingest page parser', () => {
  const topicWith = (block: string): string => `---\n${block}---\nBody.\n`
  const REQUIRED = 'type: topic\ntitle: A\ncreated: 2026-01-01\nupdated: 2026-01-02\n'

  it('reads a CRLF page and writes it back as it was', () => {
    const content = `---\r\n${REQUIRED.replaceAll('\n', '\r\n')}---\r\nBody.\r\n`
    expect(ingestActual(content)).toStrictEqual({written: content})
  })

  it('rejects an empty block for its missing required fields', () => {
    expect(ingestActual('---\n---\nBody.\n').error).toBe(
      `${INGEST_PATH} frontmatter must include type, title, created, and updated`,
    )
  })

  it.each([
    ['whitespace only', ' \n'],
    ['comments only', '# note\n'],
    ['null', 'null\n'],
    ['a document end marker', '...\n'],
  ])('rejects a block of %s as not an object', (_name, block) => {
    expect(ingestActual(topicWith(block)).error).toBe(`${INGEST_PATH} frontmatter must parse to an object`)
  })

  it('reads a mapping that ends with a document end marker', () => {
    expect(ingestActual(topicWith(`${REQUIRED}...\n`)).error).toBeUndefined()
  })

  it.each([
    ['an unclosed block', `---\n${REQUIRED}`],
    ['a file that is only the opening line', '---'],
  ])('throws its missing-frontmatter error for %s', (_name, content) => {
    expect(ingestActual(content).error).toBe(`${INGEST_PATH} is missing YAML frontmatter`)
  })
})

describe('the repo-page move text edit on a CRLF page', () => {
  const topic = (eol: string): string =>
    [
      '---',
      'type: topic',
      'title: A',
      'created: 2026-01-01',
      'updated: 2026-01-02',
      `related: [${OLD_SLUG}, other]`,
      '---',
      '',
      'Body.',
      '',
    ].join(eol)

  it('reads the CRLF page and re-renders its block structurally, with LF endings and a trimmed body', () => {
    expect(moveActual(topic('\r\n')).topic).toBe(
      [
        '---',
        'type: topic',
        'title: A',
        'created: 2026-01-01',
        'updated: 2026-01-02',
        'related:',
        `  - ${NEW_SLUG}`,
        '  - other',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    )
  })

  it('keeps every byte outside the related line of an LF page', () => {
    expect(moveActual(topic('\n')).topic).toBe(topic('\n').replace(OLD_SLUG, NEW_SLUG))
  })

  it('keeps every byte of an LF block whose close has trailing spaces', () => {
    const content = topic('\n').replace('\n---\n', '\n---  \n')
    expect(moveActual(content).topic).toBe(content.replace(OLD_SLUG, NEW_SLUG))
  })

  it('blocks the move for an unclosed page, as it blocked a page it could not parse', () => {
    expect(moveActual('---\ntype: topic\ntitle: A\n').blocked).toBe('unparseable-page')
  })
})
