/**
 * The wiki index for the daily passes: one line per wiki page, `path | title | type | opening sentence`, built
 * from the checkout when a daily job starts. It reads the four wiki directories through the shared page
 * parser and never reads `knowledge/index.md`.
 *
 * Every field is one line of plain text, so a page cannot add a line or a closing tag to the index. The
 * opening sentence comes from one linear scan of the first paragraph under the page's top heading. The whole
 * value stays within 12 KiB: sentences are dropped first, then lines from the end.
 *
 * This file stays loadable under Node's strip-only mode: no enums, no parameter properties, no namespaces.
 */

import {readdir, readFile} from 'node:fs/promises'

import {writeGithubOutputs} from '@fro-bot/core/output'
import {
  byteLength,
  collectWikiPages,
  WIKI_ROOT,
  type WikiFrontmatterErrorKind,
} from '@fro.bot/wiki-write-core/wiki-utils'

/** The limit on the `index` value, in UTF-8 bytes. */
export const MAX_INDEX_BYTES = 12 * 1024

/** The longest opening sentence kept, in characters. A longer one is omitted, not cut. */
const MAX_SENTENCE_LENGTH = 200

const INCOMPLETE_LINE = 'Index incomplete: pages that did not fit the size limit are not listed.'

const WIKI_DIRECTORIES = ['repos', 'topics', 'entities', 'comparisons'] as const

/** Words whose period does not end a sentence, compared without case. */
const ABBREVIATIONS: ReadonlySet<string> = new Set(['vs', 'etc', 'dr', 'mr', 'mrs', 'ms', 'inc', 'ltd', 'co', 'st'])

// ─── Opening sentence ────────────────────────────────────────────────────────────────────────────

interface LineRead {
  readonly line: string
  /** The offset of the next line, one past the end of the text when this was the last. */
  readonly next: number
}

function lineAt(text: string, start: number): LineRead {
  const end = text.indexOf('\n', start)
  const stop = end === -1 ? text.length : end
  const raw = text.slice(start, stop)
  return {line: raw.endsWith('\r') ? raw.slice(0, -1) : raw, next: end === -1 ? text.length + 1 : end + 1}
}

/** The first line at or after `from` that holds something other than whitespace. */
function nextNonBlankLine(text: string, from: number): LineRead | undefined {
  let cursor = from
  while (cursor <= text.length) {
    const read = lineAt(text, cursor)
    if (read.line.trim() !== '') return read
    cursor = read.next
  }
  return undefined
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isUpperLetter(char: string): boolean {
  return char.toLowerCase() !== char && char.toUpperCase() === char
}

function isLetter(char: string): boolean {
  return char.toLowerCase() !== char.toUpperCase()
}

/** A list marker: `-`, `*` or `+` before a space, or digits and `.` or `)` before a space. */
function isListMarker(text: string): boolean {
  const first = text.charAt(0)
  if (first === '-' || first === '*' || first === '+') {
    const second = text.charAt(1)
    return second === '' || second === ' ' || second === '\t'
  }
  let end = 0
  while (end < text.length && isDigit(text.charAt(end))) end += 1
  if (end === 0 || end > 9) return false
  const mark = text.charAt(end)
  const after = text.charAt(end + 1)
  return (mark === '.' || mark === ')') && (after === '' || after === ' ' || after === '\t')
}

/** Three or more of one of `-`, `*`, `_` or `=`, with spaces between: a thematic break or a setext underline. */
function isThematicBreak(text: string): boolean {
  const first = text.charAt(0)
  if (first !== '-' && first !== '*' && first !== '_' && first !== '=') return false
  let count = 0
  for (const char of text) {
    if (char === first) count += 1
    else if (char !== ' ') return false
  }
  return count >= 3
}

/** Whether a paragraph that starts with this line is prose: not a heading, list, table, quote, fence, HTML or code. */
function startsProse(line: string): boolean {
  if (line.startsWith('\t') || line.startsWith('    ')) return false
  const text = line.trimStart()
  const first = text.charAt(0)
  if (first === '#' || first === '|' || first === '>' || first === '<') return false
  if (text.startsWith('```') || text.startsWith('~~~')) return false
  return !isListMarker(text) && !isThematicBreak(text)
}

/** The line after `read` when it is in the paragraph, so not blank and not past the end. */
function paragraphLineAfter(body: string, read: LineRead): LineRead | undefined {
  if (read.next > body.length) return undefined
  const following = lineAt(body, read.next)
  return following.line.trim() === '' ? undefined : following
}

/** The paragraph beginning at `first` to its last line, lines joined by single spaces and runs of whitespace collapsed. */
function readParagraph(body: string, first: LineRead): string {
  let text = ''
  let pendingSpace = false
  let read: LineRead | undefined = first
  while (read !== undefined) {
    for (const char of read.line) {
      if (char.trim() === '') {
        pendingSpace = text !== ''
        continue
      }
      if (pendingSpace) text += ' '
      pendingSpace = false
      text += char
    }
    pendingSpace = text !== ''
    read = paragraphLineAfter(body, read)
  }
  return text
}

/** The end of a backtick code span that opens at `at`, or the end of the opening run when nothing closes it. */
function codeSpanEnd(text: string, at: number): number {
  let runEnd = at
  while (text.charAt(runEnd) === '`') runEnd += 1
  const length = runEnd - at
  let search = runEnd
  while (search < text.length) {
    const open = text.indexOf('`', search)
    if (open === -1) break
    let close = open
    while (text.charAt(close) === '`') close += 1
    if (close - open === length) return close
    search = close
  }
  return runEnd
}

/** The end of a `[[wikilink]]` or `](link target)` that opens at `at`, or `at` when it does not close. */
function bracketEnd(text: string, at: number): number {
  if (text.startsWith('[[', at)) {
    const close = text.indexOf(']]', at + 2)
    return close === -1 ? at : close + 2
  }
  if (text.startsWith('](', at)) {
    let depth = 1
    for (let index = at + 2; index < text.length; index += 1) {
      const char = text.charAt(index)
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return at
}

/** The offset after the span that opens at `at` and hides its punctuation, or `at` when none opens there. */
function maskedEnd(text: string, at: number): number {
  const char = text.charAt(at)
  if (char === '`') return codeSpanEnd(text, at)
  if (char === '[' || char === ']') return bracketEnd(text, at)
  return at
}

function isCloser(char: string): boolean {
  return '"\')]*_\u201D\u2019'.includes(char)
}

function isOpeningMark(char: string): boolean {
  return '"\'([*_`\u201C\u2018'.includes(char)
}

/** Whether the period at `dot` closes an abbreviation: a single capital, a dotted initialism or a listed word. */
function endsAbbreviation(text: string, dot: number): boolean {
  let start = dot
  while (start > 0 && (isLetter(text.charAt(start - 1)) || text.charAt(start - 1) === '.')) start -= 1
  const token = text.slice(start, dot)
  // A word that continues a URL, a path or a number is not an abbreviation.
  if (start > 0 && !' ("\'[*_`'.includes(text.charAt(start - 1))) return false
  if (token.length === 1 && isUpperLetter(token)) return true
  if (ABBREVIATIONS.has(token.toLowerCase())) return true
  if (token.length < 3) return false
  for (let index = 0; index < token.length; index += 1) {
    const char = token.charAt(index)
    if (index % 2 === 0 ? !isLetter(char) : char !== '.') return false
  }
  return true
}

/** Whether the terminator at `at`, with the closers up to `end`, ends the sentence. */
function endsSentence(text: string, at: number, end: number): boolean {
  if (end >= text.length) return true
  if (text.charAt(end) !== ' ') return false
  const next = text.charAt(end + 1)
  if (next === '' || !(isUpperLetter(next) || isDigit(next) || isOpeningMark(next))) return false
  return text.charAt(at) !== '.' || !endsAbbreviation(text, at)
}

function hasLetterOrDigit(text: string): boolean {
  for (const char of text) {
    if (isLetter(char) || isDigit(char)) return true
  }
  return false
}

/**
 * The first sentence of `text`, the whole paragraph, or `undefined` when it does not end within the limit. A span
 * that opens inside the sentence is closed by looking to the end of the paragraph, so a span that closes beyond
 * the limit ends the scan with no sentence.
 */
function firstSentence(text: string): string | undefined {
  let index = 0
  while (index < text.length && index < MAX_SENTENCE_LENGTH) {
    const skipped = maskedEnd(text, index)
    if (skipped > index) {
      index = skipped
      continue
    }
    const char = text.charAt(index)
    if (char === '.' || char === '!' || char === '?') {
      let end = index + 1
      while (end < text.length && isCloser(text.charAt(end))) end += 1
      if (endsSentence(text, index, end)) {
        const sentence = text.slice(0, end)
        return end <= MAX_SENTENCE_LENGTH && hasLetterOrDigit(sentence) ? sentence : undefined
      }
      index = end
      continue
    }
    index += 1
  }
  return undefined
}

/**
 * The one complete prose sentence directly after a page's top heading, or `undefined`. The first non-blank line
 * of the body must be a `# ` heading, and the paragraph after it must be prose. A sentence over 200 characters
 * is omitted, not cut. The paragraph is read to its last line, and the scan stops after the first 200 characters
 * of it, each opener looking for its closer at most once.
 */
export function openingSentence(body: string): string | undefined {
  const heading = nextNonBlankLine(body, 0)
  if (heading === undefined || !heading.line.startsWith('# ')) return undefined
  const paragraph = nextNonBlankLine(body, heading.next)
  if (paragraph === undefined || !startsProse(paragraph.line)) return undefined
  return firstSentence(readParagraph(body, paragraph))
}

// ─── One line per field ──────────────────────────────────────────────────────────────────────────

/**
 * The text on one line: each control character and line break becomes a space, runs of spaces collapse, both
 * ends are trimmed, and `<`, `>` and the field separator `|` are replaced so a page cannot close a tag or add
 * a field.
 */
export function oneLine(text: string): string {
  let result = ''
  let pendingSpace = false
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x20_28 || code === 0x20_29) {
      pendingSpace = result !== ''
      continue
    }
    if (pendingSpace) result += ' '
    pendingSpace = false
    result += char === '<' ? '(' : char === '>' ? ')' : char === '|' ? '/' : char
  }
  return result
}

/**
 * The path with every byte outside `A-Z a-z 0-9 . _ - /` written as `%XX`. A file name can hold Markdown, HTML,
 * a quote or a control character, and a warning is lifted into the job summary: after this the path is plain
 * characters on one line, and `decodeURIComponent` gives the name back.
 */
function encodePath(path: string): string {
  let encoded = ''
  for (const char of path) {
    if (/[\w./-]/u.test(char)) encoded += char
    else
      for (const byte of new TextEncoder().encode(char))
        encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return encoded
}

// ─── The index ───────────────────────────────────────────────────────────────────────────────────

/** Why a page was left out. A closed vocabulary: the reason never carries text from the page or the parser. */
export type SkippedPageReason = 'unclosed-frontmatter' | 'invalid-frontmatter' | 'unreadable-file'

export interface SkippedPage {
  readonly path: string
  readonly reason: SkippedPageReason
}

export interface WikiIndexResult {
  /** The whole `index` value: the count line, one line per listed page and, when pages were cut, the incomplete line. */
  readonly index: string
  readonly listed: number
  /** The number of `.md` files found in the wiki directories, readable or not. */
  readonly held: number
  readonly sentences: 'kept' | 'dropped'
  readonly incomplete: boolean
  readonly bytes: number
  /** The number of pages left out because they could not be read: `held` is `listed` plus `skipped` plus the pages cut off. */
  readonly skipped: number
  readonly skippedPages: readonly SkippedPage[]
}

export interface WikiTree {
  /** Path to content for every page that could be read. */
  readonly files: Readonly<Record<string, string>>
  readonly held: number
  /** Paths of files that were found and could not be read. */
  readonly unreadable: readonly string[]
}

/**
 * The reader's error message quotes the parser for invalid YAML and so can carry page text; only the kind of
 * failure the reader sets next to it is kept. Anything but an unclosed block reads as invalid frontmatter.
 */
function skippedPageReason(kind: WikiFrontmatterErrorKind): SkippedPageReason {
  return kind === 'unclosed' ? 'unclosed-frontmatter' : 'invalid-frontmatter'
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

interface Entry {
  readonly path: string
  readonly type: string
  readonly bare: string
  readonly sentence: string | undefined
}

interface ReadTree {
  readonly entries: readonly Entry[]
  readonly skippedPages: readonly SkippedPage[]
}

/** One leading U+FEFF removed, so the parser sees the frontmatter fence at the start of the file. */
function withoutByteOrderMark(content: string): string {
  return content.startsWith('\uFEFF') ? content.slice(1) : content
}

function readTree(tree: WikiTree): ReadTree {
  const entries: Entry[] = []
  const skipped: SkippedPage[] = tree.unreadable.map(path => ({path, reason: 'unreadable-file'}))

  const files = Object.fromEntries(
    Object.entries(tree.files).map(([path, content]) => [path, withoutByteOrderMark(content)]),
  )
  for (const page of collectWikiPages(files)) {
    if (page.frontmatterError !== undefined) {
      skipped.push({path: page.path, reason: skippedPageReason(page.frontmatterErrorKind)})
      continue
    }
    const title = oneLine(page.title) || oneLine(page.slug)
    const sentence = openingSentence(page.body)
    entries.push({
      path: page.path,
      type: page.type,
      bare: `${encodePath(page.path)} | ${title} | ${page.type}`,
      sentence: sentence === undefined ? undefined : oneLine(sentence),
    })
  }

  entries.sort((left, right) => compareCodeUnits(left.type, right.type) || compareCodeUnits(left.path, right.path))
  skipped.sort((left, right) => compareCodeUnits(left.path, right.path))
  return {entries, skippedPages: skipped}
}

/** The pages left out of the index of `tree`, by path. */
export function skippedPagesOf(tree: WikiTree): readonly SkippedPage[] {
  return readTree(tree).skippedPages
}

/** The first line: the counts, and how many pages could not be read when there are any. */
function countLine(listed: number, held: number, skipped: number): string {
  return `Wiki index: ${listed} of ${held} pages listed.${skipped === 0 ? '' : ` ${skipped} could not be read.`}`
}

/** The index of `tree`, or `undefined` when no page could be listed. */
export function assembleWikiIndex(tree: WikiTree): WikiIndexResult | undefined {
  const {entries, skippedPages} = readTree(tree)
  if (entries.length === 0) return undefined

  const finish = (
    index: string,
    listed: number,
    sentences: 'kept' | 'dropped',
    incomplete: boolean,
  ): WikiIndexResult => ({
    index,
    listed,
    held: tree.held,
    sentences,
    incomplete,
    bytes: byteLength(index),
    skipped: skippedPages.length,
    skippedPages,
  })
  const render = (lines: readonly string[], marker: boolean): string =>
    [countLine(lines.length, tree.held, skippedPages.length), ...lines, ...(marker ? [INCOMPLETE_LINE] : [])].join('\n')

  const withSentences = render(
    entries.map(entry => (entry.sentence === undefined ? entry.bare : `${entry.bare} | ${entry.sentence}`)),
    false,
  )
  if (byteLength(withSentences) <= MAX_INDEX_BYTES) return finish(withSentences, entries.length, 'kept', false)

  const lines = entries.map(entry => entry.bare)
  const bare = render(lines, false)
  if (byteLength(bare) <= MAX_INDEX_BYTES) return finish(bare, entries.length, 'dropped', false)

  // Admit lines in order while the count line, the admitted lines and the incomplete line fit together. The
  // count line is measured again for each candidate, because a count one digit wider costs a byte.
  const fixed = byteLength(`\n${INCOMPLETE_LINE}`)
  let admitted = 0
  let used = 0
  while (admitted < lines.length) {
    const next = used + 1 + byteLength(lines[admitted] ?? '')
    if (byteLength(countLine(admitted + 1, tree.held, skippedPages.length)) + next + fixed > MAX_INDEX_BYTES) break
    used = next
    admitted += 1
  }
  return finish(render(lines.slice(0, admitted), true), admitted, 'dropped', true)
}

/** The one line the step prints: integers and fixed words only. */
export function statusLine(result: WikiIndexResult | undefined): string {
  if (result === undefined) return 'wiki-index: unavailable'
  const incomplete = result.incomplete ? ' incomplete' : ''
  return `wiki-index: listed=${result.listed} held=${result.held} skipped=${result.skipped} sentences=${result.sentences}${incomplete} bytes=${result.bytes}`
}

// ─── Reading the checkout ────────────────────────────────────────────────────────────────────────

export interface WikiIndexFs {
  readonly readDir: (path: string) => Promise<{name: string; isFile: () => boolean}[]>
  readonly readFile: (path: string) => Promise<string>
}

export interface WikiIndexIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

function defaultFs(): WikiIndexFs {
  return {
    readDir: async path => readdir(path, {withFileTypes: true}),
    readFile: async path => readFile(path, 'utf8'),
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * The pages of the checkout. `undefined` when the wiki root is missing, a directory that exists cannot be
 * listed, or no `.md` file is found. A directory that does not exist is skipped, a file that cannot be read is
 * counted in `held` and named in `unreadable`.
 */
async function loadWikiTree(fs: WikiIndexFs): Promise<WikiTree | undefined> {
  try {
    await fs.readDir(WIKI_ROOT)
  } catch {
    return undefined
  }

  const files: Record<string, string> = {}
  const unreadable: string[] = []
  let held = 0

  for (const directory of WIKI_DIRECTORIES) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries
    try {
      entries = await fs.readDir(directoryPath)
    } catch (error) {
      if (isMissing(error)) continue
      return undefined
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      held += 1
      const path = `${directoryPath}/${entry.name}`
      try {
        files[path] = await fs.readFile(path)
      } catch {
        unreadable.push(path)
      }
    }
  }

  return held === 0 ? undefined : {files, held, unreadable}
}

/** A warning is a courtesy: a stderr that cannot be written (a closed pipe) must not cost the output. */
function warn(io: WikiIndexIo, line: string): void {
  try {
    io.stderr(line)
  } catch {
    // Swallowed on purpose: the output and the status line are written regardless.
  }
}

/**
 * Builds the index from the checkout, writes it to the `index` step output and prints the status line. A page
 * whose frontmatter or file cannot be read is left out and reported on stderr. Fail-soft: when no index can be
 * built the output is empty, the status line says so and the job goes on. A `$GITHUB_OUTPUT` that cannot be
 * written fails the step, as it does for any other step.
 */
export async function runWikiIndex(
  env: Readonly<Record<string, string | undefined>>,
  io: WikiIndexIo,
  fs: WikiIndexFs = defaultFs(),
): Promise<void> {
  let result: WikiIndexResult | undefined
  let skipped: readonly SkippedPage[] = []
  try {
    const tree = await loadWikiTree(fs)
    result = tree === undefined ? undefined : assembleWikiIndex(tree)
    skipped = result?.skippedPages ?? (tree === undefined ? [] : skippedPagesOf(tree))
  } catch {
    result = undefined
  }

  for (const page of skipped) warn(io, skippedPageWarning(page))
  if (result === undefined) warn(io, 'wiki-index:warn:index-unavailable\n')

  writeGithubOutputs({index: result?.index ?? ''}, {onMissing: 'skip', env})
  io.stdout(`${statusLine(result)}\n`)
}

/** One warning per skipped page: the encoded repository-relative path and the fixed reason. */
function skippedPageWarning(page: SkippedPage): string {
  return `wiki-index:warn:page-skipped path="${encodePath(page.path)}" reason=${page.reason}\n`
}
