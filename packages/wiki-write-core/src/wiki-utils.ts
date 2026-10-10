import {Buffer} from 'node:buffer'
import {basename} from 'node:path'

import {parse} from 'yaml'

/** Canonical root directory for wiki page content. Shared by every wiki script. */
export const WIKI_ROOT = 'knowledge/wiki'

export type WikiPageType = 'repo' | 'topic' | 'entity' | 'comparison'

export interface WikiPage {
  readonly path: string
  readonly slug: string
  readonly title: string
  readonly type: WikiPageType
  readonly aliases: readonly string[]
  readonly tags: readonly string[]
  readonly body: string
  readonly frontmatter: Record<string, unknown>
  readonly frontmatterError?: string
}

export interface SplitFrontmatterResult {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
  readonly error?: string
}

/**
 * Split raw wiki page content into frontmatter and body.
 *
 * Stricter than a naive split: malformed YAML frontmatter is surfaced via `error`
 * rather than silently discarded, so downstream safety/lint logic can observe it.
 */
export function splitFrontmatter(content: string): SplitFrontmatterResult {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null) {
    return {frontmatter: {}, body: content.trim()}
  }

  const frontmatterText = match[1]
  if (frontmatterText === undefined) {
    return {frontmatter: {}, body: content.trim()}
  }

  let parsed: unknown
  try {
    parsed = parse(frontmatterText)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown YAML parse error'
    return {
      frontmatter: {},
      body: content.slice(match[0].length).trim(),
      error: `Invalid YAML frontmatter: ${message}`,
    }
  }

  return {
    frontmatter: isRecord(parsed) ? parsed : {},
    body: content.slice(match[0].length).trim(),
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
 */
function scanWikilinks(content: string): RawWikilink[] {
  const links: RawWikilink[] = []
  const pattern = /\[\[/gu
  let match = pattern.exec(content)

  while (match !== null) {
    const start = match.index
    const close = content.indexOf(']]', start + 2)
    if (close === -1) {
      break
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
  const {frontmatter, body, error} = splitFrontmatter(content)
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
    frontmatterError: error,
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

  const truncated = Buffer.from(value)
    .subarray(0, contentBudget)
    .toString('utf8')
    .replaceAll(/\uFFFD+$/gu, '')

  return truncated === '' ? '' : `${truncated}${ellipsis}`
}
