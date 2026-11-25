/**
 * The wiki page reader reports why a frontmatter block could not be read as a closed vocabulary next to the error
 * text, so a caller can tell an unclosed block from invalid YAML without matching the wording of the text.
 *
 * The texts are pinned here byte for byte: they are what wiki lint prints and what the dashboard shows. The kind is
 * present exactly when the error is.
 */
import {describe, expect, expectTypeOf, it} from 'vitest'
import {parse} from 'yaml'

import {
  collectWikiPages,
  parseWikiPage,
  splitFrontmatter,
  type SplitFrontmatterResult,
  type WikiFrontmatterErrorKind,
  type WikiPage,
} from './wiki-utils.ts'

const UNCLOSED_TEXT = 'Invalid frontmatter: missing closing --- delimiter'
const PATH = 'knowledge/wiki/topics/a.md'

/** The exact text the parser gives for a block, so the test pins the template and not the parser's wording. */
function yamlMessage(text: string): string {
  try {
    parse(text)
  } catch (error: unknown) {
    if (error instanceof Error) return error.message
  }
  throw new Error('the fixture block must not parse')
}

const BROKEN_YAML = 'a: ['

describe('splitFrontmatter: the kind of a frontmatter error', () => {
  it.each([
    ['an unclosed block', '---\ntype: topic\ntitle: A\n'],
    ['a file that is only the opening line', '---\n'],
    ['a file that is only the opening line, with no line ending', '---'],
    ['a rule with text, which is not a close', '---\na: 1\n--- x\n'],
  ])('sets "unclosed" and keeps its text for %s', (_name, content) => {
    expect(splitFrontmatter(content)).toStrictEqual({
      frontmatter: {},
      body: content.trim(),
      error: UNCLOSED_TEXT,
      errorKind: 'unclosed',
    })
  })

  it('sets "invalid" and keeps its text for a block the YAML parser rejects', () => {
    expect(splitFrontmatter(`---\n${BROKEN_YAML}\n---\nBody.\n`)).toStrictEqual({
      frontmatter: {},
      body: 'Body.',
      error: `Invalid YAML frontmatter: ${yamlMessage(BROKEN_YAML)}`,
      errorKind: 'invalid',
    })
  })

  it('sets "invalid" for a document end marker between two keys', () => {
    const result = splitFrontmatter('---\na: 1\n...\nb: 2\n---\nBody.\n')
    expect(result.errorKind).toBe('invalid')
    expect(result.error).toMatch(/^Invalid YAML frontmatter: /u)
  })

  it.each([
    ['no block', 'Just a body.\n'],
    ['a valid block', '---\ntitle: A\n---\nBody.\n'],
    ['an empty block', '---\n---\nBody.\n'],
    ['a block that parses to null', '---\nnull\n---\nBody.\n'],
    ['a block that is a list', '---\n- a\n---\nBody.\n'],
    ['a block that is a scalar', '---\njust text\n---\nBody.\n'],
  ])('has no error and no kind for %s', (_name, content) => {
    const result = splitFrontmatter(content)
    expect(Object.keys(result)).toStrictEqual(['frontmatter', 'body'])
    expect(Object.hasOwn(result, 'error')).toBe(false)
    expect(Object.hasOwn(result, 'errorKind')).toBe(false)
    expect(result.errorKind).toBeUndefined()
  })
})

describe('parseWikiPage and collectWikiPages: the kind of a frontmatter error', () => {
  it('sets "unclosed" next to the unchanged text for an unclosed block', () => {
    const page = parseWikiPage(PATH, '---\ntype: topic\ntitle: A\n')
    expect(page.frontmatterError).toBe(UNCLOSED_TEXT)
    expect(page.frontmatterErrorKind).toBe('unclosed')
  })

  it('sets "invalid" next to the unchanged text for invalid YAML', () => {
    const page = parseWikiPage(PATH, `---\n${BROKEN_YAML}\n---\nBody.\n`)
    expect(page.frontmatterError).toBe(`Invalid YAML frontmatter: ${yamlMessage(BROKEN_YAML)}`)
    expect(page.frontmatterErrorKind).toBe('invalid')
  })

  it.each([
    ['no block', 'Just a body.\n'],
    ['a valid block', '---\ntype: topic\ntitle: A\n---\nBody.\n'],
    ['a block that is not a mapping', '---\n- a\n---\nBody.\n'],
  ])('has neither an error nor a kind for %s', (_name, content) => {
    const page = parseWikiPage(PATH, content)
    expect(page.frontmatterError).toBeUndefined()
    expect(page.frontmatterErrorKind).toBeUndefined()
    // Both keys are own properties holding `undefined`, as before the union.
    expect(Object.hasOwn(page, 'frontmatterError')).toBe(true)
    expect(Object.hasOwn(page, 'frontmatterErrorKind')).toBe(true)
  })

  it('carries each page its own kind through collectWikiPages', () => {
    const pages = collectWikiPages({
      'knowledge/wiki/topics/unclosed.md': '---\ntype: topic\n',
      'knowledge/wiki/topics/invalid.md': `---\n${BROKEN_YAML}\n---\nBody.\n`,
      'knowledge/wiki/topics/fine.md': '---\ntype: topic\ntitle: Fine\n---\nBody.\n',
    })
    expect(pages.map(page => [page.slug, page.frontmatterErrorKind])).toStrictEqual([
      ['unclosed', 'unclosed'],
      ['invalid', 'invalid'],
      ['fine', undefined],
    ])
  })

  it('has a kind exactly when it has an error', () => {
    const contents = [
      '',
      '---',
      '---\n',
      '---\n---\n',
      '---\na: 1\n',
      `---\n${BROKEN_YAML}\n---\n`,
      '---\nnull\n---\n',
      '---\na: 1\n---\nBody.\n',
      'Body only.\n',
    ]
    for (const content of contents) {
      const page = parseWikiPage(PATH, content)
      expect(page.frontmatterErrorKind !== undefined, JSON.stringify(content)).toBe(page.frontmatterError !== undefined)
    }
  })
})

/**
 * The error text and its kind are one fact, so the types forbid one without the other. These are compile-time
 * proofs checked by `bun run check-types`: each `.not.toExtend` names the exact shape that must stay unassignable,
 * so an unrelated error on the line cannot satisfy it the way a `@ts-expect-error` directive would. The narrowing
 * helpers fail the type check when `errorKind` stops being a `WikiFrontmatterErrorKind` after an error check.
 */
describe('the error text and its kind cannot be set apart', () => {
  interface SplitBase {
    frontmatter: Record<string, unknown>
    body: string
  }
  type PageBase = Omit<WikiPage, 'frontmatterError' | 'frontmatterErrorKind'>

  const page: PageBase = {
    path: PATH,
    slug: 'a',
    title: 'A',
    type: 'topic',
    aliases: [],
    tags: [],
    body: '',
    frontmatter: {},
  }

  it('accepts a split result with both fields or neither', () => {
    expectTypeOf<SplitBase>().toExtend<SplitFrontmatterResult>()
    expectTypeOf<SplitBase & {error: string; errorKind: WikiFrontmatterErrorKind}>().toExtend<SplitFrontmatterResult>()
    const clean: SplitFrontmatterResult = {frontmatter: {}, body: ''}
    const broken: SplitFrontmatterResult = {frontmatter: {}, body: '', error: 'x', errorKind: 'unclosed'}
    expect([clean, broken]).toHaveLength(2)
  })

  it('rejects a split result with an error and no kind, or a kind and no error', () => {
    expectTypeOf<SplitBase & {error: string}>().not.toExtend<SplitFrontmatterResult>()
    expectTypeOf<SplitBase & {errorKind: WikiFrontmatterErrorKind}>().not.toExtend<SplitFrontmatterResult>()
  })

  it('accepts a page with both fields or neither', () => {
    expectTypeOf<PageBase>().toExtend<WikiPage>()
    expectTypeOf<
      PageBase & {frontmatterError: string; frontmatterErrorKind: WikiFrontmatterErrorKind}
    >().toExtend<WikiPage>()
    const clean: WikiPage = {...page}
    const broken: WikiPage = {...page, frontmatterError: 'x', frontmatterErrorKind: 'invalid'}
    expect([clean, broken]).toHaveLength(2)
  })

  it('rejects a page with an error and no kind, or a kind and no error', () => {
    expectTypeOf<PageBase & {frontmatterError: string}>().not.toExtend<WikiPage>()
    expectTypeOf<PageBase & {frontmatterErrorKind: WikiFrontmatterErrorKind}>().not.toExtend<WikiPage>()
  })

  it('gives the kind after an error check on a split result', () => {
    const result = splitFrontmatter('---\ntype: topic\n')
    if (result.error === undefined) throw new Error('the fixture block must be unclosed')
    const kind: WikiFrontmatterErrorKind = result.errorKind
    expect(kind).toBe('unclosed')
  })

  it('gives the kind after an error check on a page', () => {
    const parsed = parseWikiPage(PATH, `---\n${BROKEN_YAML}\n---\n`)
    if (parsed.frontmatterError === undefined) throw new Error('the fixture block must be invalid')
    const kind: WikiFrontmatterErrorKind = parsed.frontmatterErrorKind
    expect(kind).toBe('invalid')
  })

  it('keeps destructuring the pair in either order', () => {
    const {error, errorKind} = splitFrontmatter('---\ntype: topic\n')
    if (error === undefined) {
      expect(errorKind).toBeUndefined()
    } else {
      const kind: WikiFrontmatterErrorKind = errorKind
      expect(kind).toBe('unclosed')
    }
  })
})
