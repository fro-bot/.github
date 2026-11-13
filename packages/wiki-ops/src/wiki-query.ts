import {readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import process from 'node:process'

import {formatJsonLine} from '@fro-bot/core/json'
import {writeGithubOutputs} from '@fro-bot/core/output'
import {byteLength, collectWikiPages, truncateToBytes, WIKI_ROOT} from '@fro.bot/wiki-write-core/wiki-utils'

const MAX_CONTEXT_BYTES = 5 * 1024

export interface WikiQueryEvent {
  eventName: string
  owner?: string
  repo?: string
  title?: string
  body?: string
}

export interface AssembleWikiContextParams {
  files: Record<string, string>
  event: WikiQueryEvent
  maxBytes?: number
}

/** Why a page was left out. A closed vocabulary: the reason never carries text from the page or the parser. */
export type SkippedPageReason = 'unclosed-frontmatter' | 'invalid-frontmatter'

export interface SkippedPage {
  readonly path: string
  readonly reason: SkippedPageReason
}

/** The result printed on stdout is `excerpt`, `selectedPaths` and `byteLength`; `skippedPages` is for stderr only. */
export interface AssembleWikiContextResult {
  excerpt: string
  selectedPaths: string[]
  byteLength: number
  skippedPages: readonly SkippedPage[]
}

interface PageSummary {
  path: string
  slug: string
  title: string
  type: 'repo' | 'topic' | 'entity' | 'comparison'
  body: string
  tags: string[]
  score: number
}

export function assembleWikiContext(params: AssembleWikiContextParams): AssembleWikiContextResult {
  const maxBytes = params.maxBytes ?? MAX_CONTEXT_BYTES
  const {pages, skippedPages} = collectPages(params.files)
  const tokens = collectTokens(params.event)
  const repoSlug =
    params.event.owner !== undefined && params.event.repo !== undefined
      ? `${slugify(params.event.owner)}--${slugify(params.event.repo)}`
      : null

  const ranked = pages
    .map(page => ({...page, score: scorePage(page, params.event.eventName, tokens, repoSlug)}))
    .filter(page => page.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))

  let excerpt = '# Wiki Context\n\n'
  const selectedPaths: string[] = []

  for (const page of ranked) {
    const section = renderSection(page)
    const next = `${excerpt}${section}`

    if (byteLength(next) <= maxBytes) {
      excerpt = next
      selectedPaths.push(page.path)
      continue
    }

    const remaining = maxBytes - byteLength(excerpt)
    if (remaining <= 0) {
      break
    }

    const truncated = truncateToBytes(section, remaining)
    if (truncated.trim() !== '') {
      excerpt = `${excerpt}${truncated}`
      selectedPaths.push(page.path)
    }
    break
  }

  if (selectedPaths.length === 0) {
    excerpt = ''
  }

  return {excerpt, selectedPaths, byteLength: byteLength(excerpt), skippedPages}
}

/**
 * A page whose frontmatter cannot be read is left out and reported by path and a fixed reason. When no page is
 * readable the corpus is bad as a whole and this throws, so the caller falls back to an empty context as before.
 */
function collectPages(files: Record<string, string>): {pages: PageSummary[]; skippedPages: SkippedPage[]} {
  const pages: PageSummary[] = []
  const skippedPages: SkippedPage[] = []
  let firstSkippedPath: string | undefined

  for (const page of collectWikiPages(files)) {
    if (page.frontmatterError !== undefined) {
      firstSkippedPath ??= page.path
      skippedPages.push({path: page.path, reason: skippedPageReason(page.frontmatterError)})
      continue
    }

    pages.push({
      path: page.path,
      slug: page.slug,
      title: page.title,
      type: page.type,
      body: page.body,
      tags: [...page.tags],
      score: 0,
    })
  }

  if (pages.length === 0 && firstSkippedPath !== undefined) {
    throw new Error(`Invalid wiki frontmatter in ${firstSkippedPath}`)
  }

  // Path order, so the warnings do not depend on the order the directory listing returned.
  skippedPages.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return {pages, skippedPages}
}

/**
 * The splitter's error message quotes the parser for invalid YAML and so can carry page text; only the kind of
 * failure is kept. Anything but the unclosed-block message reads as invalid frontmatter.
 */
function skippedPageReason(frontmatterError: string): SkippedPageReason {
  return frontmatterError.startsWith('Invalid frontmatter: missing closing')
    ? 'unclosed-frontmatter'
    : 'invalid-frontmatter'
}

function scorePage(page: PageSummary, eventName: string, tokens: Set<string>, repoSlug: string | null): number {
  let relevanceScore = 0

  if (repoSlug !== null && page.slug === repoSlug) {
    relevanceScore += 1000
  }

  for (const token of tokens) {
    if (page.slug.toLowerCase().includes(token)) relevanceScore += 25
    if (page.title.toLowerCase().includes(token)) relevanceScore += 15
    if (page.tags.some(tag => tag.toLowerCase().includes(token))) relevanceScore += 10
    if (page.body.toLowerCase().includes(token)) relevanceScore += 4
  }

  if (relevanceScore === 0) {
    return 0
  }

  return relevanceScore + baseTypeWeight(page.type, eventName)
}

function baseTypeWeight(type: PageSummary['type'], eventName: string): number {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    if (type === 'topic') return 120
    if (type === 'entity') return 90
    if (type === 'repo') return 40
    return 30
  }

  if (type === 'repo') return 200
  if (type === 'topic') return 120
  if (type === 'entity') return 80
  return 50
}

function renderSection(page: PageSummary): string {
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const excerpt = page.body.replace(/\s+/g, ' ').trim()
  return `## ${page.title}\nPath: ${page.path}\nType: ${page.type}\n\n${excerpt}\n\n`
}

function collectTokens(event: WikiQueryEvent): Set<string> {
  const raw = [event.owner, event.repo, event.title, event.body].filter(value => value !== undefined).join(' ')
  const tokens = raw
    .toLowerCase()
    // eslint-disable-next-line unicorn/prefer-string-replace-all
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3)

  return new Set(tokens)
}

export function slugify(value: string): string {
  const lower = value.toLowerCase()
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const dashed = lower.replace(/[^a-z0-9]+/g, '-')
  // Trim leading and trailing dashes with an index scan: `/^-+|-+$/g` rescans a long run of dashes
  // from every start once a non-dash follows it, which is quadratic. After the replacement above a
  // run of dashes is a single dash, so the scan is short either way.
  let start = 0
  let end = dashed.length
  while (start < end && dashed.charCodeAt(start) === 0x2d) start += 1
  while (end > start && dashed.charCodeAt(end - 1) === 0x2d) end -= 1
  return dashed.slice(start, end)
}

async function loadWikiFilesFromDisk(): Promise<Record<string, string>> {
  const files: Record<string, string> = {
    'knowledge/index.md': await readFile('knowledge/index.md', 'utf8'),
  }

  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries
    try {
      entries = await readdir(directoryPath, {withFileTypes: true})
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const path = `${directoryPath}/${entry.name}`
      try {
        files[path] = await readFile(path, 'utf8')
      } catch {
        continue
      }
    }
  }

  return files
}

function writeGithubOutput(result: AssembleWikiContextResult, env: Readonly<Record<string, string | undefined>>): void {
  writeGithubOutputs(
    {
      excerpt: result.excerpt,
      'selected-paths': JSON.stringify(result.selectedPaths),
      'byte-length': String(result.byteLength),
    },
    {onMissing: 'skip', env},
  )
}

/**
 * Write the baseline query's selected wiki paths to a runner-temp handoff file.
 * Contains only `selectedPaths` and coarse metadata — no excerpt bodies,
 * queries, task text, or workflow context.
 *
 * Writes atomically (temp file + rename) with owner-only permissions where the
 * platform supports it. Fails soft: any error is swallowed so baseline wiki
 * context output is never broken by a handoff write failure.
 */
export async function writeSelectedPathsHandoff(handoffPath: string, selectedPaths: string[]): Promise<void> {
  const payload = {selectedPaths}
  const tempPath = `${handoffPath}.tmp-${Math.random().toString(16).slice(2)}`

  try {
    await writeFile(tempPath, `${JSON.stringify(payload)}\n`, {mode: 0o600})
    await rename(tempPath, handoffPath)
  } catch {
    try {
      await unlink(tempPath)
    } catch {
      // ignore — tempPath may not have been created
    }
    process.stderr.write('wiki-query:warn:handoff-write-failed\n')
  }
}

const EMPTY_CONTEXT_RESULT: AssembleWikiContextResult = {
  excerpt: '',
  selectedPaths: [],
  byteLength: 0,
  skippedPages: [],
}

export interface WikiQueryIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

/**
 * One warning per skipped page: the repository-relative path as a JSON string (so a file name cannot start a new
 * log line) and the fixed reason. Wiki page paths are public; nothing from the page or the parser is written.
 */
function skippedPageWarning(page: SkippedPage): string {
  return `wiki-query:warn:page-skipped path=${JSON.stringify(page.path)} reason=${page.reason}\n`
}

/**
 * The baseline wiki query. A page whose frontmatter cannot be read is left out and reported on stderr; the rest
 * of the context is built. Fail-soft: a corpus-level failure (the wiki cannot be read, or no page is readable)
 * never breaks the baseline prompt-injection workflow, so it falls back to an explicit empty context and
 * still writes the outputs. A handoff-write failure is also swallowed (see writeSelectedPathsHandoff).
 */
export async function runWikiQuery(env: Readonly<Record<string, string | undefined>>, io: WikiQueryIo): Promise<void> {
  let result: AssembleWikiContextResult
  try {
    const files = await loadWikiFilesFromDisk()
    result = assembleWikiContext({
      files,
      event: {
        eventName: env.WIKI_QUERY_EVENT_NAME ?? env.GITHUB_EVENT_NAME ?? '',
        owner: env.WIKI_QUERY_OWNER,
        repo: env.WIKI_QUERY_REPO,
        title: env.WIKI_QUERY_TITLE,
        body: env.WIKI_QUERY_BODY,
      },
    })
  } catch {
    // Emit a closed-vocabulary stderr warning, fall back to an explicit empty context, and continue
    // writing outputs so downstream steps still see a valid, empty result.
    io.stderr('wiki-query:warn:baseline-query-failed\n')
    result = EMPTY_CONTEXT_RESULT
  }

  for (const page of result.skippedPages) {
    io.stderr(skippedPageWarning(page))
  }

  writeGithubOutput(result, env)

  const handoffPath = env.WIKI_CONTEXT_HANDOFF_PATH
  if (handoffPath !== undefined && handoffPath !== '') {
    await writeSelectedPathsHandoff(handoffPath, result.selectedPaths)
  }

  io.stdout(
    formatJsonLine({excerpt: result.excerpt, selectedPaths: result.selectedPaths, byteLength: result.byteLength}),
  )
}
