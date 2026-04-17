import {Buffer} from 'node:buffer'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import {basename} from 'node:path'
import process from 'node:process'

import {parse} from 'yaml'

const MAX_CONTEXT_BYTES = 5 * 1024
const WIKI_ROOT = 'knowledge/wiki'

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
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
    .map(([path, content]) => {
      const {frontmatter, body} = splitFrontmatter(content)
      return {
        path,
        slug: basename(path, '.md'),
        title: typeof frontmatter.title === 'string' ? frontmatter.title : basename(path, '.md'),
        type: isPageType(frontmatter.type) ? frontmatter.type : inferTypeFromPath(path),
        body,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter(tag => typeof tag === 'string') : [],
        score: 0,
      }
    })
}

function splitFrontmatter(content: string): {frontmatter: Record<string, unknown>; body: string} {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null) {
    return {frontmatter: {}, body: content.trim()}
  }

  const frontmatterText = match[1]
  if (frontmatterText === undefined) {
    return {frontmatter: {}, body: content.trim()}
  }

  const parsed: unknown = parse(frontmatterText)
  return {
    frontmatter: isRecord(parsed) ? parsed : {},
    body: content.slice(match[0].length).trim(),
  }
}

function scorePage(page: PageSummary, eventName: string, tokens: Set<string>, repoSlug: string | null): number {
  let score = baseTypeWeight(page.type, eventName)

  if (repoSlug !== null && page.slug === repoSlug) {
    score += 1000
  }

  for (const token of tokens) {
    if (page.slug.includes(token)) score += 25
    if (page.title.toLowerCase().includes(token)) score += 15
    if (page.tags.some(tag => tag.toLowerCase().includes(token))) score += 10
    if (page.body.toLowerCase().includes(token)) score += 4
  }

  return score
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

function inferTypeFromPath(path: string): PageSummary['type'] {
  if (path.includes('/repos/')) return 'repo'
  if (path.includes('/topics/')) return 'topic'
  if (path.includes('/entities/')) return 'entity'
  return 'comparison'
}

function isPageType(value: unknown): value is PageSummary['type'] {
  return value === 'repo' || value === 'topic' || value === 'entity' || value === 'comparison'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function slugify(value: string): string {
  const lower = value.toLowerCase()
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const dashed = lower.replace(/[^a-z0-9]+/g, '-')
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  return dashed.replace(/^-+|-+$/g, '')
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value
  }

  let truncated = value
  while (truncated !== '' && byteLength(`${truncated}…`) > maxBytes) {
    truncated = truncated.slice(0, -1)
  }

  return truncated === '' ? '' : `${truncated}…`
}

async function loadWikiFilesFromDisk(): Promise<Record<string, string>> {
  const files: Record<string, string> = {
    'knowledge/index.md': await readFile('knowledge/index.md', 'utf8'),
  }

  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    for (const entry of await readdir(directoryPath, {withFileTypes: true})) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const path = `${directoryPath}/${entry.name}`
      files[path] = await readFile(path, 'utf8')
    }
  }

  return files
}

async function writeGithubOutput(result: AssembleWikiContextResult): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath === undefined || outputPath === '') {
    return
  }

  const delimiter = `EOF_${Math.random().toString(16).slice(2)}`
  const lines = [
    `excerpt<<${delimiter}`,
    result.excerpt,
    delimiter,
    `selected-paths=${JSON.stringify(result.selectedPaths)}`,
    `byte-length=${result.byteLength}`,
  ]
  await writeFile(outputPath, `${lines.join('\n')}\n`, {flag: 'a'})
}

async function main(): Promise<void> {
  const files = await loadWikiFilesFromDisk()
  const result = assembleWikiContext({
    files,
    event: {
      eventName: process.env.WIKI_QUERY_EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? '',
      owner: process.env.WIKI_QUERY_OWNER,
      repo: process.env.WIKI_QUERY_REPO,
      title: process.env.WIKI_QUERY_TITLE,
      body: process.env.WIKI_QUERY_BODY,
    },
  })

  await writeGithubOutput(result)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
