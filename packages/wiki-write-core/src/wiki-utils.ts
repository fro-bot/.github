import {Buffer} from 'node:buffer'
import {basename} from 'node:path'

import {parse} from 'yaml'
import {findCodeRegions, findRegionAt} from './code-regions.ts'
import {splitFrontmatterBlock} from './frontmatter-block.ts'

/** Canonical root directory for wiki page content. Shared by every wiki script. */
export const WIKI_ROOT = 'knowledge/wiki'

export type WikiPageType = 'repo' | 'topic' | 'entity' | 'comparison'

/**
 * Why a page's frontmatter could not be read, as a closed vocabulary a caller can switch on without matching the
 * wording of the error text. `unclosed` is a block that opens with `---` and never closes; `invalid` is a block the
 * YAML parser rejects. A block that parses to something other than a mapping is read as empty frontmatter and is
 * not an error, so it has no kind.
 */
export type WikiFrontmatterErrorKind = 'unclosed' | 'invalid'

/**
 * A page without a frontmatter error. Both fields are `undefined`, so a caller can destructure the pair or check
 * either one.
 */
export interface WikiPageFrontmatterOk {
  readonly frontmatterError?: undefined
  readonly frontmatterErrorKind?: undefined
}

/** A page whose frontmatter could not be read: the error text always comes with its kind. */
export interface WikiPageFrontmatterFailed {
  readonly frontmatterError: string
  readonly frontmatterErrorKind: WikiFrontmatterErrorKind
}

export type WikiPage = {
  readonly path: string
  readonly slug: string
  readonly title: string
  readonly type: WikiPageType
  readonly aliases: readonly string[]
  readonly tags: readonly string[]
  readonly body: string
  readonly frontmatter: Record<string, unknown>
} & (WikiPageFrontmatterOk | WikiPageFrontmatterFailed)

/** A split without an error. Both fields are `undefined`, so a caller can destructure the pair. */
export interface SplitFrontmatterOk {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
  readonly error?: undefined
  readonly errorKind?: undefined
}

/** A split of a block that could not be read: the error text always comes with its kind. */
export interface SplitFrontmatterFailed {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
  readonly error: string
  readonly errorKind: WikiFrontmatterErrorKind
}

export type SplitFrontmatterResult = SplitFrontmatterOk | SplitFrontmatterFailed

/**
 * Split raw wiki page content into frontmatter and body.
 *
 * Stricter than a naive split: malformed YAML frontmatter, and a block that is opened and never closed, are
 * surfaced via `error` rather than silently discarded, so downstream safety/lint logic can observe them.
 */
export function splitFrontmatter(content: string): SplitFrontmatterResult {
  const split = splitFrontmatterBlock(content)
  if (split.kind === 'none') {
    return {frontmatter: {}, body: content.trim()}
  }
  if (split.kind === 'malformed') {
    return {
      frontmatter: {},
      body: content.trim(),
      error: 'Invalid frontmatter: missing closing --- delimiter',
      errorKind: 'unclosed',
    }
  }

  let parsed: unknown
  try {
    parsed = parse(split.text)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown YAML parse error'
    return {
      frontmatter: {},
      body: split.body.trim(),
      error: `Invalid YAML frontmatter: ${message}`,
      errorKind: 'invalid',
    }
  }

  return {
    frontmatter: isRecord(parsed) ? parsed : {},
    body: split.body.trim(),
  }
}

interface RawWikilink {
  /** Offset of the opening `[[`. */
  readonly start: number
  /** Offset just past the closing `]]`. */
  readonly end: number
  /** Everything before the first `|`, untrimmed. */
  readonly target: string
  /** Everything after the first `|`, or `undefined` for a link without a label. */
  readonly label: string | undefined
}

/**
 * The one wikilink grammar: `[[target]]` and `[[target|label]]`, closed by the first `]]`.
 * A link with an empty target, or with a `|` and an empty label, is not a link.
 *
 * Fenced code blocks and inline code spans are literal text: a `[[` that opens inside one, or a
 * link whose closing `]]` lands inside one, is not a link.
 */
function scanWikilinks(content: string): RawWikilink[] {
  const links: RawWikilink[] = []
  const regions = findCodeRegions(content)
  const pattern = /\[\[/gu
  let match = pattern.exec(content)

  while (match !== null) {
    const start = match.index
    const openingRegion = findRegionAt(regions, start)
    if (openingRegion !== undefined) {
      pattern.lastIndex = openingRegion.end
      match = pattern.exec(content)
      continue
    }

    const close = content.indexOf(']]', start + 2)
    if (close === -1) {
      break
    }

    if (findRegionAt(regions, close + 1) !== undefined) {
      pattern.lastIndex = start + 2
      match = pattern.exec(content)
      continue
    }

    const inner = content.slice(start + 2, close)
    const separator = inner.indexOf('|')
    const target = separator === -1 ? inner : inner.slice(0, separator)
    const label = separator === -1 ? undefined : inner.slice(separator + 1)
    if (target !== '' && (label === undefined || label !== '')) {
      links.push({start, end: close + 2, target, label})
    }

    pattern.lastIndex = close + 2
    match = pattern.exec(content)
  }

  return links
}

/** Collect `[[target]]` and `[[target|label]]` wikilink targets from page body content. */
export function collectWikilinks(content: string): string[] {
  return scanWikilinks(content).map(link => link.target)
}

/** One wikilink located in a string, with enough detail to rewrite its target in place. */
export interface WikilinkSpan {
  /** Offset of the opening `[[`. */
  readonly start: number
  /** Offset just past the closing `]]`. */
  readonly end: number
  /** The target with surrounding whitespace removed. */
  readonly target: string
  /** Whitespace between `[[` and the target. */
  readonly leading: string
  /** Whitespace between the target and the `|` or `]]`. */
  readonly trailing: string
  /** The label exactly as written (including its own whitespace), or `undefined`. */
  readonly label: string | undefined
}

/**
 * Locate wikilinks with the same grammar as {@link collectWikilinks}, keeping the original
 * whitespace and label so a caller can rewrite the target without disturbing the rest.
 *
 * Heading links (`[[target#heading]]`) are excluded: no wiki page slug contains `#`, so they
 * never resolve and are not rewritable as page references.
 */
export function findWikilinkSpans(content: string): WikilinkSpan[] {
  return scanWikilinks(content).flatMap(link => {
    const target = link.target.trim()
    if (target === '' || target.includes('#')) return []
    const leading = link.target.slice(0, link.target.length - link.target.trimStart().length)
    const trailing = link.target.slice(link.target.trimEnd().length)
    return [{start: link.start, end: link.end, target, leading, trailing, label: link.label}]
  })
}

/** Parse a single wiki page's content (relative path + raw content) into a page record. */
export function parseWikiPage(path: string, content: string): WikiPage {
  const split = splitFrontmatter(content)
  const {frontmatter, body} = split
  const slug = basename(path, '.md')

  return {
    path,
    slug,
    title: typeof frontmatter.title === 'string' ? frontmatter.title : slug,
    type: isPageType(frontmatter.type) ? frontmatter.type : inferTypeFromPath(path),
    aliases: collectAliases(frontmatter),
    tags: Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    body,
    frontmatter,
    // The keys are present with `undefined` when there is no error, as they always were.
    ...(split.error === undefined
      ? {frontmatterError: undefined, frontmatterErrorKind: undefined}
      : {frontmatterError: split.error, frontmatterErrorKind: split.errorKind}),
  }
}

/** Collect all `knowledge/wiki/**.md` pages from a path→content file map. */
export function collectWikiPages(files: Record<string, string>): WikiPage[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
    .map(([path, content]) => parseWikiPage(path, content))
}

function collectAliases(frontmatter: Record<string, unknown>): string[] {
  const aliases = frontmatter.aliases
  if (!Array.isArray(aliases)) {
    return []
  }
  return aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim() !== '')
}

/**
 * Build the set of all resolvable link targets (slug + aliases) across a page collection.
 * Used by wiki-lint to validate wikilinks and index entries against pages on disk.
 */
export function collectPageTargets(
  pages: readonly {readonly slug: string; readonly aliases: readonly string[]}[],
): Set<string> {
  const targets = new Set<string>()
  for (const page of pages) {
    targets.add(page.slug)
    for (const alias of page.aliases) {
      targets.add(alias)
    }
  }
  return targets
}

/**
 * Indexed path/slug/alias -> page resolver for wikilink target resolution.
 *
 * Ambiguous targets — where more than one page maps to the same slug/alias string —
 * resolve to `undefined` rather than picking arbitrarily. Missing targets also
 * resolve to `undefined`. Callers must skip both cases rather than fuzzy-matching.
 */
export interface WikiTargetPage {
  readonly path: string
  readonly slug: string
  readonly aliases: readonly string[]
}

export interface WikiTargetIndex {
  resolve: (target: string) => WikiTargetPage | undefined
}

const AMBIGUOUS = Symbol('ambiguous')

export function buildWikiTargetIndex(pages: readonly WikiTargetPage[]): WikiTargetIndex {
  const map = new Map<string, WikiTargetPage | typeof AMBIGUOUS>()

  const register = (key: string, page: WikiTargetPage): void => {
    const existing = map.get(key)
    if (existing === undefined) {
      map.set(key, page)
      return
    }
    if (existing === AMBIGUOUS || existing.path !== page.path) {
      map.set(key, AMBIGUOUS)
    }
  }

  for (const page of pages) {
    register(page.path, page)
    register(page.slug, page)
    for (const alias of page.aliases) {
      register(alias, page)
    }
  }

  return {
    resolve(target: string): WikiTargetPage | undefined {
      const entry = map.get(target)
      return entry === undefined || entry === AMBIGUOUS ? undefined : entry
    },
  }
}

function isPageType(value: unknown): value is WikiPageType {
  return value === 'repo' || value === 'topic' || value === 'entity' || value === 'comparison'
}

function inferTypeFromPath(path: string): WikiPageType {
  if (path.includes('/repos/')) return 'repo'
  if (path.includes('/topics/')) return 'topic'
  if (path.includes('/entities/')) return 'entity'
  return 'comparison'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Byte-safe truncation (multi-byte-safe; shared shape with solutions-query.ts)
// ---------------------------------------------------------------------------

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function truncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value
  }

  const ellipsis = '…'
  const contentBudget = maxBytes - byteLength(ellipsis)
  if (contentBudget <= 0) {
    return ''
  }

  const decoded = Buffer.from(value).subarray(0, contentBudget).toString('utf8')
  // Drop the replacement characters a cut multi-byte sequence decodes to. A trailing-run regex rescans a long run
  // from every position in it.
  let keep = decoded.length
  while (keep > 0 && decoded.charCodeAt(keep - 1) === 0xff_fd) keep -= 1
  const truncated = decoded.slice(0, keep)

  return truncated === '' ? '' : `${truncated}${ellipsis}`
}

// ─── Archive notice ────────────────────────────────────────────────────────────────────────────────────

/**
 * The notice an archived repo page carries as the first paragraph under its top heading: one plain sentence under
 * 200 characters, so it is also the page's opening sentence in the agents' index. The page's `archived` frontmatter
 * key holds the date; this text is the same everywhere, so a writer can find it, restore it and remove it exactly.
 */
export const ARCHIVE_NOTICE = 'This repository is archived and no longer surveyed; its page is kept for reference.'

/** The line index of the page's first top-level heading, or -1 when the body has none. */
function topHeadingIndex(lines: readonly string[]): number {
  return lines.findIndex(line => line.startsWith('# '))
}

/** The index of the first non-blank line after the heading at `heading` (or from the start for -1). */
function firstParagraphIndex(lines: readonly string[], heading: number): number {
  let index = heading + 1
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1
  return index
}

/** Whether the first paragraph under the page's top heading is exactly the archive notice. */
export function hasArchiveNotice(body: string): boolean {
  const lines = body.split('\n')
  const line = lines[firstParagraphIndex(lines, topHeadingIndex(lines))]
  return line !== undefined && (line.endsWith('\r') ? line.slice(0, -1) : line) === ARCHIVE_NOTICE
}

/** Where the first top-level heading's text ends, and where its line, line ending included, ends. */
interface HeadingSpan {
  readonly textEnd: number
  readonly lineEnd: number
}

function findHeading(body: string): HeadingSpan | undefined {
  let position = 0
  while (position <= body.length) {
    const newline = body.indexOf('\n', position)
    const end = newline === -1 ? body.length : newline
    if (body.startsWith('# ', position)) {
      return {
        textEnd: newline !== -1 && body[end - 1] === '\r' ? end - 1 : end,
        lineEnd: newline === -1 ? end : end + 1,
      }
    }
    if (newline === -1) return undefined
    position = newline + 1
  }
  return undefined
}

/** The body's own line ending: CRLF when it has one anywhere, else LF. Inserting the notice cannot change it. */
function bodyEol(body: string): string {
  return body.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * The body with the archive notice, by one fixed rule, so that `withoutArchiveNotice` is its exact inverse for
 * every body and no other byte moves. With `<eol>` the body's own line ending:
 * - a heading with a line ending: `<eol><NOTICE><eol>` goes in immediately after that ending, so
 *   `# Repo\n\nNotes.` becomes `# Repo\n\n<NOTICE>\n\nNotes.` and `# Repo\nNotes.` becomes
 *   `# Repo\n\n<NOTICE>\nNotes.` (there the notice shares a paragraph with the text that follows);
 * - a heading that is the last line, with no line ending: the ending it lacks, then `<eol><NOTICE>`, and
 *   nothing after, so `# Repo` becomes `# Repo\n\n<NOTICE>`;
 * - no heading: `<NOTICE><eol>` goes in at the start.
 * A body that already has the notice is returned as it is.
 */
export function withArchiveNotice(body: string): string {
  if (hasArchiveNotice(body)) return body
  const eol = bodyEol(body)
  const heading = findHeading(body)
  if (heading === undefined) return `${ARCHIVE_NOTICE}${eol}${body}`
  if (heading.lineEnd === heading.textEnd) return `${body}${eol}${eol}${ARCHIVE_NOTICE}`
  return `${body.slice(0, heading.lineEnd)}${eol}${ARCHIVE_NOTICE}${eol}${body.slice(heading.lineEnd)}`
}

/**
 * The body without the notice: exactly the span `withArchiveNotice` inserted, in each of its three forms. A notice
 * written by hand with other spacing is removed as its own line plus one blank line before it.
 */
export function withoutArchiveNotice(body: string): string {
  if (!hasArchiveNotice(body)) return body
  const eol = bodyEol(body)
  const heading = findHeading(body)
  if (heading === undefined) {
    if (body.startsWith(`${ARCHIVE_NOTICE}${eol}`)) return body.slice(ARCHIVE_NOTICE.length + eol.length)
  } else if (body.startsWith(`${eol}${ARCHIVE_NOTICE}`, heading.lineEnd)) {
    const after = heading.lineEnd + eol.length + ARCHIVE_NOTICE.length
    if (body.startsWith(eol, after)) return body.slice(0, heading.lineEnd) + body.slice(after + eol.length)
    // The heading was the last line: the inserted span runs from its text to the end of the body.
    if (after === body.length) return body.slice(0, heading.textEnd)
  }
  return withoutHandWrittenNotice(body)
}

function withoutHandWrittenNotice(body: string): string {
  const lines = body.split('\n')
  const heading = topHeadingIndex(lines)
  const notice = firstParagraphIndex(lines, heading)
  const blankBefore = notice - 1 > heading && (lines[notice - 1] ?? '').trim() === ''
  lines.splice(blankBefore ? notice - 1 : notice, blankBefore ? 2 : 1)
  return lines.join('\n')
}
