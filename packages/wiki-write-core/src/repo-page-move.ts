/**
 * Pure planning for the operator rename: a wiki snapshot plus a proven repository rename in,
 * the next set of file changes (or a typed block reason) out.
 *
 * Nothing here reads a network, a clock or a branch. The caller proves the rename from GitHub,
 * supplies the snapshot and the timestamp, and decides how to commit the result. A block carries a
 * fixed reason code and nothing else, so it can never echo a private identifier.
 *
 * Decisions (see docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md):
 * - The page moves; it gets no alias (`validateWikilinks` ignores aliases, so an alias would not
 *   keep a link valid, and a later repo reusing the old name would make it ambiguous).
 * - A page without `node_id` is adopted only when its structured `sources` contain the exact old
 *   repository URL. The body is never consulted.
 * - `log.md` history and `knowledge/wiki/README.md` are never rewritten.
 */

import {parseFrontmatterDocument, renderFrontmatterDocument, type FrontmatterDocument} from './frontmatter.ts'
import {appendLogEntry, rebuildWikiIndex, validateWikilinks, WikiIngestError} from './wiki-ingest.ts'
import {buildPrivateNameTokens, computeRepoSlug} from './wiki-slug.ts'
import {findWikilinkSpans} from './wiki-utils.ts'

const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'
const REPOS_DIR = 'knowledge/wiki/repos'
const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/u
const RELATED_BLOCK_KEY = /^related:\s*(?:#.*)?$/u
const RELATED_FLOW = /^related:\s*\[(.*)\]\s*(?:#.*)?$/u

/**
 * One file operation in a planned rename. The op says why the path is touched, so the committing
 * writer can hold each operation to its own rule (e.g. `create-page` must not overwrite anything).
 */
export type PageChange =
  | {
      readonly op: 'create-page' | 'edit-page' | 'repair-links' | 'write-index' | 'append-log'
      readonly path: string
      readonly content: string
    }
  | {readonly op: 'delete-page'; readonly path: string}

/** Why a rename cannot be planned. Fixed codes only: a block never carries a name, ID or path. */
export type RepoPageMoveBlockReason =
  | 'invalid-name'
  | 'slug-collision'
  | 'private-name-collision'
  | 'unparseable-page'
  | 'old-page-not-attributed'
  | 'both-pages-present'
  | 'page-ahead-of-row'
  | 'target-page-occupied'
  | 'invalid-index'
  | 'invalid-wikilinks'

export interface RepoRowRef {
  readonly owner: string
  readonly name: string
}

export interface PlanRepoPageMoveParams {
  /** Path → content for `knowledge/index.md`, `knowledge/log.md` and the pages under `knowledge/wiki/`. */
  readonly files: Readonly<Record<string, string>>
  /** The row's node ID: the identity the page must carry (or be attributable to). */
  readonly nodeId: string
  readonly owner: string
  readonly oldName: string
  readonly newName: string
  /** The name the `metadata/repos.yaml` row holds right now: `oldName` before the rename, `newName` after. */
  readonly rowName: string
  /** Every other row, public or redacted, so the move cannot land on or orphan another repo's slug. */
  readonly otherRows: readonly RepoRowRef[]
  /** Private-name tokens (from `buildPrivateTokenSet`); compared case-insensitively. */
  readonly privateTokens: ReadonlySet<string>
  readonly timestamp: Date
}

export type RepoPageMovePlan =
  | {readonly outcome: 'blocked'; readonly reason: RepoPageMoveBlockReason}
  /** The wiki already reflects the rename for this row. */
  | {readonly outcome: 'already-applied'}
  /** There is no page for the old name, so only the metadata row changes. */
  | {readonly outcome: 'metadata-only'}
  | {readonly outcome: 'moved' | 'edited-in-place'; readonly changes: readonly PageChange[]}

interface PageSnapshot {
  readonly path: string
  readonly content: string
  readonly document: FrontmatterDocument
}

/** Apply a change set to a file map, returning a new map. */
export function applyPageChanges(
  files: Readonly<Record<string, string>>,
  changes: readonly PageChange[],
): Record<string, string> {
  const next = {...files}
  for (const change of changes) {
    if (change.op === 'delete-page') delete next[change.path]
    else next[change.path] = change.content
  }
  return next
}

export function planRepoPageMove(params: PlanRepoPageMoveParams): RepoPageMovePlan {
  const slugs = computeSlugs(params)
  if (slugs === undefined) return blocked('invalid-name')
  const {oldSlug, newSlug} = slugs

  if (collidesWithAnotherRow(params.otherRows, [oldSlug, newSlug])) return blocked('slug-collision')
  if (matchesPrivateToken(params)) return blocked('private-name-collision')

  const pages = parsePages(params.files)
  if (pages === undefined) return blocked('unparseable-page')

  const oldPath = repoPagePath(oldSlug)
  const newPath = repoPagePath(newSlug)
  const oldPage = pages.get(oldPath)
  const newPage = pages.get(newPath)
  const target = describeTarget(params)

  if (oldSlug === newSlug) {
    if (oldPage === undefined) return {outcome: 'metadata-only'}
    if (!isAttributed(oldPage.document, params.nodeId, target.oldUrl)) return blocked('old-page-not-attributed')
    if (isUpdated(oldPage.document, params.nodeId, target)) {
      return params.rowName === params.newName ? {outcome: 'already-applied'} : blocked('page-ahead-of-row')
    }
    return buildChanges({params, pages, oldSlug, newSlug, oldPage, target, moving: false})
  }

  if (oldPage === undefined) {
    if (newPage === undefined) return {outcome: 'metadata-only'}
    if (params.rowName !== params.newName) return blocked('page-ahead-of-row')
    return newPage.document.values.node_id === params.nodeId
      ? {outcome: 'already-applied'}
      : blocked('target-page-occupied')
  }
  if (newPage !== undefined) return blocked('both-pages-present')
  if (!isAttributed(oldPage.document, params.nodeId, target.oldUrl)) return blocked('old-page-not-attributed')
  return buildChanges({params, pages, oldSlug, newSlug, oldPage, target, moving: true})
}

// ─── Decisions ──────────────────────────────────────────────────────────────

interface Target {
  readonly oldUrl: string
  readonly newUrl: string
  readonly newTitle: string
}

function blocked(reason: RepoPageMoveBlockReason): RepoPageMovePlan {
  return {outcome: 'blocked', reason}
}

function describeTarget(params: PlanRepoPageMoveParams): Target {
  return {
    oldUrl: `https://github.com/${params.owner}/${params.oldName}`,
    newUrl: `https://github.com/${params.owner}/${params.newName}`,
    newTitle: `${params.owner}/${params.newName}`,
  }
}

function computeSlugs(params: PlanRepoPageMoveParams): {oldSlug: string; newSlug: string} | undefined {
  try {
    return {
      oldSlug: computeRepoSlug(params.owner, params.oldName),
      newSlug: computeRepoSlug(params.owner, params.newName),
    }
  } catch {
    return undefined
  }
}

function slugOrUndefined(row: RepoRowRef): string | undefined {
  try {
    return computeRepoSlug(row.owner, row.name)
  } catch {
    return undefined
  }
}

function collidesWithAnotherRow(rows: readonly RepoRowRef[], slugs: readonly string[]): boolean {
  return rows.some(row => {
    const slug = slugOrUndefined(row)
    return slug !== undefined && slugs.includes(slug)
  })
}

function matchesPrivateToken(params: PlanRepoPageMoveParams): boolean {
  const privateTokens = new Set([...params.privateTokens].map(token => token.toLowerCase()))
  return buildPrivateNameTokens(`${params.owner}/${params.newName}`).some(token =>
    privateTokens.has(token.toLowerCase()),
  )
}

function repoPagePath(slug: string): string {
  return `${REPOS_DIR}/${slug}.md`
}

/** A page with a node_id belongs to exactly that node; one without belongs to whoever its sources name. */
function isAttributed(document: FrontmatterDocument, nodeId: string, oldUrl: string): boolean {
  const existing = document.values.node_id
  if (existing !== undefined) return existing === nodeId
  return sourceUrls(document).includes(oldUrl)
}

function isUpdated(document: FrontmatterDocument, nodeId: string, target: Target): boolean {
  return (
    document.values.node_id === nodeId &&
    document.values.title === target.newTitle &&
    sourceUrls(document).includes(target.newUrl)
  )
}

function sourceUrls(document: FrontmatterDocument): string[] {
  const sources = document.values.sources
  if (!Array.isArray(sources)) return []
  return sources.flatMap((source: unknown) => (isRecord(source) && typeof source.url === 'string' ? [source.url] : []))
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

function parsePages(files: Readonly<Record<string, string>>): Map<string, PageSnapshot> | undefined {
  const pages = new Map<string, PageSnapshot>()
  for (const path of Object.keys(files).sort()) {
    if (!WIKI_PAGE_PATTERN.test(path)) continue
    const content = files[path] ?? ''
    try {
      pages.set(path, {path, content, document: parseFrontmatterDocument(content)})
    } catch {
      return undefined
    }
  }
  return pages
}

// ─── Change set ─────────────────────────────────────────────────────────────

function buildChanges(input: {
  params: PlanRepoPageMoveParams
  pages: ReadonlyMap<string, PageSnapshot>
  oldSlug: string
  newSlug: string
  oldPage: PageSnapshot
  target: Target
  moving: boolean
}): RepoPageMovePlan {
  const {params, pages, oldSlug, newSlug, oldPage, target, moving} = input
  const newPath = repoPagePath(newSlug)
  const accessed = formatDate(params.timestamp)
  const changes: PageChange[] = []

  const movedValues = updateRepoPageValues(oldPage.document.values, params.nodeId, target, accessed)
  const movedContent = repairReferences(renderFrontmatterDocument(movedValues, oldPage.document.body), oldSlug, newSlug)

  const nextWikiFiles: Record<string, string> = {}
  const repairs: PageChange[] = []
  for (const [path, page] of pages) {
    if (path === oldPage.path) continue
    const repaired = moving ? repairReferences(page.content, oldSlug, newSlug) : page.content
    nextWikiFiles[path] = repaired
    if (repaired !== page.content) repairs.push({op: 'repair-links', path, content: repaired})
  }
  nextWikiFiles[moving ? newPath : oldPage.path] = movedContent

  if (moving) {
    changes.push({op: 'create-page', path: newPath, content: movedContent}, {op: 'delete-page', path: oldPage.path})
  } else {
    changes.push({op: 'edit-page', path: oldPage.path, content: movedContent})
  }
  changes.push(...repairs)

  // An in-place edit changes no slug, so the catalog lines (which are kept by slug) stay as they are.
  if (moving) {
    const index = buildIndex(params.files[INDEX_PATH], nextWikiFiles, oldSlug, newSlug)
    if (typeof index !== 'string') return blocked(index.reason)
    if (index !== params.files[INDEX_PATH]) changes.push({op: 'write-index', path: INDEX_PATH, content: index})
  }

  const wikilinkReason = checkWikilinks(nextWikiFiles)
  if (wikilinkReason !== undefined) return blocked(wikilinkReason)

  changes.push({
    op: 'append-log',
    path: LOG_PATH,
    content: appendLogEntry(params.files[LOG_PATH], {
      operation: 'manual-edit',
      target: `repo:${params.owner}/${params.newName}`,
      summary: describeRename(params, oldSlug, newSlug, moving),
      timestamp: params.timestamp,
      sources: [],
    }),
  })

  return {outcome: moving ? 'moved' : 'edited-in-place', changes}
}

function describeRename(params: PlanRepoPageMoveParams, oldSlug: string, newSlug: string, moving: boolean): string {
  const rename = `Renamed \`${params.owner}/${params.oldName}\` to \`${params.owner}/${params.newName}\`.`
  return moving
    ? `${rename} Moved the repo page from \`${oldSlug}.md\` to \`${newSlug}.md\` and repaired wikilinks and related entries.`
    : `${rename} Updated the repo page \`${oldSlug}.md\` in place; its slug is unchanged.`
}

function updateRepoPageValues(
  values: Record<string, unknown>,
  nodeId: string,
  target: Target,
  accessed: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  const hasNodeId = 'node_id' in values
  for (const [key, value] of Object.entries(values)) {
    next[key] = value
    // New pages put node_id right after `updated`, as the ingest writer does.
    if (!hasNodeId && key === 'updated') next.node_id = nodeId
  }
  next.node_id = nodeId
  next.title = target.newTitle

  const sources: unknown[] = Array.isArray(values.sources) ? [...(values.sources as unknown[])] : []
  const alreadyListed = sources.some(source => isRecord(source) && source.url === target.newUrl)
  if (!alreadyListed) sources.push({url: target.newUrl, accessed})
  next.sources = sources
  return next
}

function buildIndex(
  existingIndex: string | undefined,
  nextWikiFiles: Record<string, string>,
  oldSlug: string,
  newSlug: string,
): string | {reason: RepoPageMoveBlockReason} {
  // Carry the old entry (and any curated description) over to the new slug before rebuilding, so
  // the rebuild keeps it instead of regenerating a bare line.
  const carried = existingIndex === undefined ? undefined : rewriteLinks(existingIndex, oldSlug, newSlug)
  try {
    return rebuildWikiIndex({existingIndex: carried, wikiFiles: nextWikiFiles})
  } catch (error: unknown) {
    if (error instanceof WikiIngestError) return {reason: 'invalid-index'}
    throw error
  }
}

function checkWikilinks(nextWikiFiles: Record<string, string>): RepoPageMoveBlockReason | undefined {
  try {
    validateWikilinks(nextWikiFiles)
    return undefined
  } catch (error: unknown) {
    if (error instanceof WikiIngestError)
      return error.code === 'INVALID_WIKILINK' ? 'invalid-wikilinks' : 'invalid-index'
    throw error
  }
}

// ─── Reference repair ───────────────────────────────────────────────────────

/** Repair `related:` entries and body wikilinks that point at `oldSlug`. Returns the input if none do. */
function repairReferences(content: string, oldSlug: string, newSlug: string): string {
  return rewriteLinks(repairRelated(content, oldSlug, newSlug), oldSlug, newSlug)
}

/** Rewrite every `[[oldSlug]]`-style span, keeping its whitespace and label. Heading links are not spans. */
function rewriteLinks(content: string, oldSlug: string, newSlug: string): string {
  const spans = findWikilinkSpans(content).filter(span => span.target === oldSlug)
  if (spans.length === 0) return content
  let result = ''
  let cursor = 0
  for (const span of spans) {
    const label = span.label === undefined ? '' : `|${span.label}`
    result += `${content.slice(cursor, span.start)}[[${span.leading}${newSlug}${span.trailing}${label}]]`
    cursor = span.end
  }
  return result + content.slice(cursor)
}

function repairRelated(content: string, oldSlug: string, newSlug: string): string {
  const document = parseFrontmatterDocument(content)
  const related = document.values.related
  if (!Array.isArray(related) || !related.includes(oldSlug)) return content

  const expected = dedupe(related.map((entry: unknown) => (entry === oldSlug ? newSlug : entry)))
  const edited = editRelatedText(content, oldSlug, newSlug)
  if (edited !== undefined && sameList(readRelated(edited), expected)) return edited
  return renderFrontmatterDocument({...document.values, related: expected}, document.body)
}

/**
 * Edit only the `related:` lines of the frontmatter text, so the rest of the page keeps its bytes.
 * Returns `undefined` for a layout it does not recognize; the caller then re-renders structurally.
 */
function editRelatedText(content: string, oldSlug: string, newSlug: string): string | undefined {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  const frontmatter = match?.[1]
  if (frontmatter === undefined) return undefined
  const lines = frontmatter.split('\n')

  const flowIndex = lines.findIndex(line => RELATED_FLOW.test(line))
  if (flowIndex !== -1) {
    const inner = RELATED_FLOW.exec(lines[flowIndex] ?? '')?.[1] ?? ''
    const items = inner.split(',').map(item => item.trim())
    const mapped = dedupe(items.map(item => (stripQuotes(item) === oldSlug ? swapQuoted(item, newSlug) : item)))
    lines[flowIndex] = `related: [${mapped.join(', ')}]`
    return replaceFrontmatter(content, frontmatter, lines.join('\n'))
  }

  const keyIndex = lines.findIndex(line => RELATED_BLOCK_KEY.test(line))
  if (keyIndex === -1) return undefined
  const seen = new Set<string>()
  const kept: string[] = []
  let cursor = keyIndex + 1
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? ''
    const item = parseBlockItem(line)
    if (item === undefined) break
    const mapped = item.value === oldSlug ? newSlug : item.value
    if (seen.has(mapped)) continue
    seen.add(mapped)
    kept.push(item.value === oldSlug ? `${item.prefix}${item.quote}${newSlug}${item.quote}${item.suffix}` : line)
  }
  lines.splice(keyIndex + 1, cursor - keyIndex - 1, ...kept)
  return replaceFrontmatter(content, frontmatter, lines.join('\n'))
}

interface BlockItem {
  /** Indent, dash and the whitespace after it. */
  readonly prefix: string
  /** The quote character around the value, or `''`. */
  readonly quote: string
  readonly value: string
  /** Whitespace and trailing comment after the value. */
  readonly suffix: string
}

/** Parse one `  - value` line of a block sequence without a backtracking regex. */
function parseBlockItem(line: string): BlockItem | undefined {
  const trimmed = line.trimStart()
  if (!trimmed.startsWith('-')) return undefined
  const afterDash = trimmed.slice(1)
  if (afterDash === '' || afterDash.trimStart() === afterDash) return undefined
  const valueText = afterDash.trimStart()
  const prefix = line.slice(0, line.length - valueText.length)
  const commentAt = valueText.indexOf(' #')
  const raw = (commentAt === -1 ? valueText : valueText.slice(0, commentAt)).trimEnd()
  const suffix = valueText.slice(raw.length)
  const first = raw[0]
  const quoted = raw.length >= 2 && (first === "'" || first === '"') && raw.endsWith(first)
  return {prefix, quote: quoted ? (first ?? '') : '', value: quoted ? raw.slice(1, -1) : raw, suffix}
}

function replaceFrontmatter(content: string, original: string, next: string): string {
  const start = '---\n'.length
  return `${content.slice(0, start)}${next}${content.slice(start + original.length)}`
}

function readRelated(content: string): unknown[] {
  try {
    const related = parseFrontmatterDocument(content).values.related
    return Array.isArray(related) ? (related as unknown[]) : []
  } catch {
    return []
  }
}

function stripQuotes(item: string): string {
  return item.replace(/^(['"])(.*)\1$/u, '$2')
}

function swapQuoted(item: string, replacement: string): string {
  const quote = /^(['"])/u.exec(item)?.[1] ?? ''
  return `${quote}${replacement}${quote}`
}

function dedupe<T>(values: readonly T[]): T[] {
  const seen = new Set<unknown>()
  const result: T[] = []
  for (const value of values) {
    const key = typeof value === 'string' ? stripQuotes(value) : value
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function sameList(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
