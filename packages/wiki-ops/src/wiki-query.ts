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

export interface AssembleWikiContextResult {
  excerpt: string
  selectedPaths: string[]
  byteLength: number
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
  const pages = collectPages(params.files)
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

  return {excerpt, selectedPaths, byteLength: byteLength(excerpt)}
}

function collectPages(files: Record<string, string>): PageSummary[] {
  return collectWikiPages(files).map(page => {
    if (page.frontmatterError !== undefined) {
      throw new Error(`Invalid wiki frontmatter in ${page.path}`)
    }

    return {
      path: page.path,
      slug: page.slug,
      title: page.title,
      type: page.type,
      body: page.body,
      tags: [...page.tags],
      score: 0,
    }
  })
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

function slugify(value: string): string {
  const lower = value.toLowerCase()
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const dashed = lower.replace(/[^a-z0-9]+/g, '-')
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  return dashed.replace(/^-+|-+$/g, '')
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

const EMPTY_CONTEXT_RESULT: AssembleWikiContextResult = {excerpt: '', selectedPaths: [], byteLength: 0}

export interface WikiQueryIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

/**
 * The baseline wiki query. Fail-soft: a corpus-level failure (e.g. malformed wiki frontmatter) never
 * breaks the baseline prompt-injection workflow, so it falls back to an explicit empty context and
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

  writeGithubOutput(result, env)

  const handoffPath = env.WIKI_CONTEXT_HANDOFF_PATH
  if (handoffPath !== undefined && handoffPath !== '') {
    await writeSelectedPathsHandoff(handoffPath, result.selectedPaths)
  }

  io.stdout(formatJsonLine(result))
}
