import {execFile} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import {basename} from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'

import {parse} from 'yaml'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BRANCH = 'data'
const DEFAULT_MAX_RETRIES = 3
const WIKI_ROOT = 'knowledge/wiki'
const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
const execFileAsync = promisify(execFile)

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

export type WikiOperation = 'survey' | 'event' | 'lint' | 'manual-edit'
export type WikiPageType = 'repo' | 'topic' | 'entity' | 'comparison'

export interface WikiSource {
  url: string
  sha?: string
  accessed: string
}

export interface WikiPageInput {
  path: string
  content: string
}

export interface BuildWikiIngestChangesParams {
  existingFiles: Record<string, string>
  operation: WikiOperation
  target: string
  summary: string
  timestamp: Date
  sources: WikiSource[]
  pages: WikiPageInput[]
}

export interface BuildWikiIngestChangesResult {
  files: Record<string, string>
}

export interface CommitWikiChangesParams {
  owner?: string
  repo?: string
  branch?: string
  message: string
  files: Record<string, string>
  octokit?: OctokitClient
  maxRetries?: number
}

export interface CommitWikiChangesResult {
  committed: boolean
  commitSha: string
  attempts: number
}

export interface OctokitClient {
  rest: {
    git: {
      getRef: (params: {owner: string; repo: string; ref: string}) => Promise<{
        data: {
          object: {
            sha: string
          }
        }
      }>
      getCommit: (params: {owner: string; repo: string; commit_sha: string}) => Promise<{
        data: {
          sha: string
          tree: {
            sha: string
          }
        }
      }>
      createBlob: (params: {owner: string; repo: string; content: string; encoding: 'utf-8'}) => Promise<{
        data: {
          sha: string
        }
      }>
      createTree: (params: {
        owner: string
        repo: string
        base_tree: string
        tree: {
          path: string
          mode: '100644'
          type: 'blob'
          sha: string
        }[]
      }) => Promise<{
        data: {
          sha: string
        }
      }>
      createCommit: (params: {
        owner: string
        repo: string
        message: string
        tree: string
        parents: string[]
      }) => Promise<{
        data: {
          sha: string
        }
      }>
      updateRef: (params: {owner: string; repo: string; ref: string; sha: string; force: false}) => Promise<{
        data: {
          ref: string
        }
      }>
    }
  }
}

export type WikiIngestErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_PAGE_PATH'
  | 'INVALID_FRONTMATTER'
  | 'INVALID_WIKILINK'
  | 'INVALID_RETRIES'
  | 'MISSING_TOKEN'
  | 'OCTOKIT_LOAD_FAILED'
  | 'CONFLICT_EXHAUSTED'

export class WikiIngestError extends Error {
  readonly code: WikiIngestErrorCode
  readonly remediation: string

  constructor(params: {code: WikiIngestErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'WikiIngestError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

interface ParsedWikiPage {
  path: string
  slug: string
  type: WikiPageType
  title: string
  content: string
}

interface WikiFrontmatter {
  type: WikiPageType
  title: string
  created: string
  updated: string
  tags?: string[]
  aliases?: string[]
  related?: string[]
}

interface WikiIngestPayload {
  operation: WikiOperation
  target: string
  summary: string
  timestamp?: string
  sources: WikiSource[]
  pages: WikiPageInput[]
  message?: string
  owner?: string
  repo?: string
  branch?: string
}

export function buildWikiIngestChanges(params: BuildWikiIngestChangesParams): BuildWikiIngestChangesResult {
  if (params.pages.length === 0) {
    throw new WikiIngestError({
      code: 'INVALID_PAYLOAD',
      message: 'wiki ingest requires at least one page update',
      remediation: 'Populate payload.pages with one or more wiki pages before invoking wiki-ingest.',
    })
  }

  const files: Record<string, string> = {}
  const nextFiles = {...params.existingFiles}

  for (const page of params.pages) {
    assertWikiPagePath(page.path)
    validateWikiPage(page.path, page.content)
    const normalized = normalizeText(page.content)
    nextFiles[page.path] = normalized
    files[page.path] = normalized
  }

  validateWikilinks(nextFiles)

  const parsedPages = collectWikiPages(nextFiles)
  const index = buildIndexDocument(params.existingFiles[INDEX_PATH], parsedPages)
  const log = appendLogEntry(params.existingFiles[LOG_PATH], params)

  files[INDEX_PATH] = index
  files[LOG_PATH] = log

  return {files}
}

export async function commitWikiChanges(params: CommitWikiChangesParams): Promise<CommitWikiChangesResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const branch = params.branch ?? DEFAULT_BRANCH
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES

  if (maxRetries < 1) {
    throw new WikiIngestError({
      code: 'INVALID_RETRIES',
      message: `wiki ingest requires maxRetries >= 1, got ${maxRetries}`,
      remediation: 'Pass maxRetries as a positive integer (default: 3).',
    })
  }

  const octokit = params.octokit ?? (await createOctokitFromEnv())

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const head = await octokit.rest.git.getRef({owner, repo, ref: `heads/${branch}`})
      const commit = await octokit.rest.git.getCommit({owner, repo, commit_sha: head.data.object.sha})

      const tree: {
        path: string
        mode: '100644'
        type: 'blob'
        sha: string
      }[] = []
      for (const [path, content] of Object.entries(params.files)) {
        const blob = await octokit.rest.git.createBlob({owner, repo, content, encoding: 'utf-8'})
        tree.push({path, mode: '100644' as const, type: 'blob' as const, sha: blob.data.sha})
      }

      const createdTree = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: commit.data.tree.sha,
        tree,
      })

      const createdCommit = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: params.message,
        tree: createdTree.data.sha,
        parents: [commit.data.sha],
      })

      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: createdCommit.data.sha,
        force: false,
      })

      return {committed: true, commitSha: createdCommit.data.sha, attempts: attempt}
    } catch (error: unknown) {
      if (isConflictError(error) && attempt < maxRetries) {
        continue
      }

      if (isConflictError(error)) {
        throw new WikiIngestError({
          code: 'CONFLICT_EXHAUSTED',
          message: `wiki ingest exhausted ${maxRetries} attempt(s) updating ${owner}/${repo}@${branch}`,
          remediation:
            'Another writer updated the data branch concurrently. Retry the workflow or increase maxRetries.',
        })
      }

      throw error
    }
  }

  throw new Error('wiki ingest reached an unreachable retry state')
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new WikiIngestError({
      code: 'MISSING_TOKEN',
      message: 'wiki-ingest requires params.octokit or GITHUB_TOKEN in the environment',
      remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
    })
  }

  const Octokit = await loadOctokitConstructor()
  return new Octokit({auth: token})
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')

  if (!isRecord(loaded) || !('Octokit' in loaded) || typeof loaded.Octokit !== 'function') {
    throw new WikiIngestError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }

  return loaded.Octokit as OctokitConstructor
}

function validateWikiPage(path: string, content: string): void {
  const frontmatter = parseFrontmatter(path, content)
  const expectedType = pageTypeFromPath(path)

  if (frontmatter.type !== expectedType) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} declares type ${frontmatter.type} but lives under ${expectedType}`,
      remediation: 'Align the page type with its directory, or move the file to the correct wiki section.',
    })
  }

  if (!DATE_PATTERN.test(frontmatter.created) || !DATE_PATTERN.test(frontmatter.updated)) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} must use YYYY-MM-DD for created/updated`,
      remediation: 'Use ISO calendar dates for created and updated in wiki frontmatter.',
    })
  }

  const filename = basename(path)
  if (!isValidFilename(frontmatter.type, filename)) {
    throw new WikiIngestError({
      code: 'INVALID_PAGE_PATH',
      message: `${path} does not match wiki filename conventions for ${frontmatter.type}`,
      remediation:
        'Use lowercase kebab-case filenames. Repo pages must be {owner}--{repo}.md and comparisons must be {a}-vs-{b}.md.',
    })
  }
}

function validateWikilinks(files: Record<string, string>): void {
  const knownSlugs = new Set(collectWikiPages(files).map(page => page.slug))

  for (const page of collectWikiPages(files)) {
    for (const wikilink of extractWikilinks(page.content)) {
      if (!knownSlugs.has(wikilink)) {
        throw new WikiIngestError({
          code: 'INVALID_WIKILINK',
          message: `${page.path} links to missing wiki page [[${wikilink}]]`,
          remediation:
            'Create the referenced page in the same ingest batch or update the wikilink to an existing page.',
        })
      }
    }
  }
}

function buildIndexDocument(existingIndex: string | undefined, pages: ParsedWikiPage[]): string {
  const header =
    existingIndex === undefined || existingIndex === ''
      ? '# Wiki Index\n\nMaster catalog of all wiki pages, organized by type.\n\n'
      : extractIndexHeader(existingIndex)
  const footer =
    existingIndex === undefined || existingIndex === ''
      ? '\n---\n\n_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._\n'
      : extractIndexFooter(existingIndex)

  const sections: {heading: string; type: WikiPageType; empty: string}[] = [
    {
      heading: 'Repos',
      type: 'repo',
      empty: '_No repo pages yet. Pages will appear here as repositories are surveyed._',
    },
    {
      heading: 'Topics',
      type: 'topic',
      empty: '_No topic pages yet. Pages will appear here as cross-cutting themes emerge._',
    },
    {
      heading: 'Entities',
      type: 'entity',
      empty: '_No entity pages yet. Pages will appear here as tools and services are documented._',
    },
    {
      heading: 'Comparisons',
      type: 'comparison',
      empty: '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
    },
  ]

  const body = sections
    .map(section => {
      const entries = pages
        .filter(page => page.type === section.type)
        .sort((left, right) => left.title.localeCompare(right.title))
        .map(page => `- [[${page.slug}]] — ${page.title}`)

      return [`## ${section.heading}`, '', ...(entries.length > 0 ? entries : [section.empty]), ''].join('\n')
    })
    .join('\n')

  return normalizeText(`${header}${body}${footer}`)
}

function appendLogEntry(existingLog: string | undefined, params: BuildWikiIngestChangesParams): string {
  const base =
    existingLog === undefined || existingLog === ''
      ? '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n'
      : normalizeText(existingLog)
  const stamp = formatTimestamp(params.timestamp)
  const sources =
    params.sources.length === 0
      ? 'Sources: none'
      : `Sources: ${params.sources
          .map(source => `${source.url}${source.sha === undefined ? '' : `@${source.sha}`}`)
          .join(', ')}`

  return normalizeText(`${base}\n## [${stamp}] ingest | ${params.target}\n\n${params.summary}\n\n${sources}\n`)
}

function parseFrontmatter(path: string, content: string): WikiFrontmatter {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)

  if (match === null) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} is missing YAML frontmatter`,
      remediation: 'Add frontmatter with type, title, created, and updated fields before ingesting the page.',
    })
  }

  const frontmatterText = match[1]
  if (frontmatterText === undefined) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} frontmatter could not be extracted`,
      remediation: 'Ensure the page begins with a valid YAML frontmatter block.',
    })
  }

  const parsed: unknown = parse(frontmatterText)
  if (!isRecord(parsed)) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} frontmatter must parse to an object`,
      remediation: 'Ensure the frontmatter is valid YAML mapping syntax.',
    })
  }

  if (
    !isWikiPageType(parsed.type) ||
    typeof parsed.title !== 'string' ||
    typeof parsed.created !== 'string' ||
    typeof parsed.updated !== 'string'
  ) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} frontmatter must include type, title, created, and updated`,
      remediation: 'Supply required fields in the page frontmatter and keep optional arrays as strings only.',
    })
  }

  return {
    type: parsed.type,
    title: parsed.title,
    created: parsed.created,
    updated: parsed.updated,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter(tag => typeof tag === 'string') : undefined,
    aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter(alias => typeof alias === 'string') : undefined,
    related: Array.isArray(parsed.related) ? parsed.related.filter(related => typeof related === 'string') : undefined,
  }
}

function collectWikiPages(files: Record<string, string>): ParsedWikiPage[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
    .map(([path, content]) => {
      const frontmatter = parseFrontmatter(path, content)
      return {
        path,
        slug: basename(path, '.md'),
        type: frontmatter.type,
        title: frontmatter.title,
        content,
      }
    })
}

function extractWikilinks(content: string): string[] {
  const links = new Set<string>()
  for (const match of content.matchAll(WIKILINK_PATTERN)) {
    const slug = match[1]
    if (slug !== undefined) {
      links.add(slug.trim())
    }
  }
  return [...links]
}

function extractIndexHeader(index: string): string {
  const marker = index.indexOf('## Repos')
  return marker === -1
    ? '# Wiki Index\n\nMaster catalog of all wiki pages, organized by type.\n\n'
    : index.slice(0, marker)
}

function extractIndexFooter(index: string): string {
  const marker = index.lastIndexOf('\n---')
  return marker === -1
    ? '\n---\n\n_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._\n'
    : index.slice(marker)
}

function assertWikiPagePath(path: string): void {
  const pattern = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[a-z0-9-]+\.md$/
  if (!pattern.test(path)) {
    throw new WikiIngestError({
      code: 'INVALID_PAGE_PATH',
      message: `${path} is outside the allowed wiki directories`,
      remediation:
        'Write wiki pages only under knowledge/wiki/repos, topics, entities, or comparisons using kebab-case filenames.',
    })
  }
}

function pageTypeFromPath(path: string): WikiPageType {
  if (path.includes('/repos/')) return 'repo'
  if (path.includes('/topics/')) return 'topic'
  if (path.includes('/entities/')) return 'entity'
  return 'comparison'
}

function isValidFilename(type: WikiPageType, filename: string): boolean {
  if (!/^[a-z0-9.-]+$/.test(filename) || !filename.endsWith('.md')) {
    return false
  }

  const stem = filename.slice(0, -3)

  if (type === 'repo') {
    const parts = stem.split('--')
    return parts.length === 2 && parts.every(part => part !== '' && !part.startsWith('-') && !part.endsWith('-'))
  }

  if (type === 'comparison') {
    const parts = stem.split('-vs-')
    return parts.length === 2 && parts.every(part => part !== '' && !part.startsWith('-') && !part.endsWith('-'))
  }

  return stem !== '' && !stem.startsWith('-') && !stem.endsWith('-')
}

function isWikiPageType(value: unknown): value is WikiPageType {
  return value === 'repo' || value === 'topic' || value === 'entity' || value === 'comparison'
}

function isConflictError(error: unknown): boolean {
  return isRecord(error) && typeof error.status === 'number' && (error.status === 409 || error.status === 422)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function formatTimestamp(value: Date): string {
  const year = value.getUTCFullYear()
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${value.getUTCDate()}`.padStart(2, '0')
  const hour = `${value.getUTCHours()}`.padStart(2, '0')
  const minute = `${value.getUTCMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

async function loadExistingWikiFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  for (const path of [INDEX_PATH, LOG_PATH]) {
    files[path] = await readFile(path, 'utf8')
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

async function loadWorkingTreeWikiFiles(paths: string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  for (const path of paths) {
    files[path] = await readFile(path, 'utf8')
  }

  return files
}

async function getChangedWikiPaths(): Promise<string[]> {
  const {stdout} = await execFileAsync('git', [
    'status',
    '--porcelain',
    '--',
    INDEX_PATH,
    LOG_PATH,
    `${WIKI_ROOT}/repos`,
    `${WIKI_ROOT}/topics`,
    `${WIKI_ROOT}/entities`,
    `${WIKI_ROOT}/comparisons`,
  ])

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => line.slice(3))
    .filter(path => path !== INDEX_PATH && path !== LOG_PATH)
    .filter(path => path.endsWith('.md'))
}

function parsePayload(raw: string): WikiIngestPayload {
  const parsed: unknown = JSON.parse(raw)
  if (
    !isRecord(parsed) ||
    !isWikiOperation(parsed.operation) ||
    typeof parsed.target !== 'string' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.sources) ||
    !Array.isArray(parsed.pages)
  ) {
    throw new WikiIngestError({
      code: 'INVALID_PAYLOAD',
      message: 'wiki ingest payload is missing required fields',
      remediation: 'Provide operation, target, summary, sources, and pages in the JSON payload.',
    })
  }

  return {
    operation: parsed.operation,
    target: parsed.target,
    summary: parsed.summary,
    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
    sources: parsed.sources.filter(isWikiSource),
    pages: parsed.pages.filter(isWikiPageInput),
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
    owner: typeof parsed.owner === 'string' ? parsed.owner : undefined,
    repo: typeof parsed.repo === 'string' ? parsed.repo : undefined,
    branch: typeof parsed.branch === 'string' ? parsed.branch : undefined,
  }
}

function isWikiOperation(value: unknown): value is WikiOperation {
  return value === 'survey' || value === 'event' || value === 'lint' || value === 'manual-edit'
}

function isWikiPageInput(value: unknown): value is WikiPageInput {
  return isRecord(value) && typeof value.path === 'string' && typeof value.content === 'string'
}

function defaultCommitMessage(payload: WikiIngestPayload): string {
  return `feat(knowledge): ${payload.operation} ${payload.target}`
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2] ?? process.env.WIKI_INGEST_INPUT
  const existingFiles = await loadExistingWikiFiles()

  let built: BuildWikiIngestChangesResult
  let owner: string | undefined
  let repo: string | undefined
  let branch: string | undefined
  let message: string

  if (payloadPath !== undefined && payloadPath !== '') {
    const payload = parsePayload(await readFile(payloadPath, 'utf8'))
    built = buildWikiIngestChanges({
      existingFiles,
      operation: payload.operation,
      target: payload.target,
      summary: payload.summary,
      timestamp: payload.timestamp === undefined ? new Date() : new Date(payload.timestamp),
      sources: payload.sources,
      pages: payload.pages,
    })
    owner = payload.owner
    repo = payload.repo
    branch = payload.branch
    message = payload.message ?? defaultCommitMessage(payload)
  } else {
    const changedPaths = await getChangedWikiPaths()
    if (changedPaths.length === 0) {
      process.stdout.write(`${JSON.stringify({committed: false, attempts: 1})}\n`)
      return
    }

    const pages = await loadWorkingTreeWikiFiles(changedPaths)
    built = buildWikiIngestChanges({
      existingFiles,
      operation: isWikiOperation(process.env.WIKI_OPERATION) ? process.env.WIKI_OPERATION : 'event',
      target: process.env.WIKI_TARGET ?? 'repo:unknown/unknown',
      summary: process.env.WIKI_SUMMARY ?? 'Updated wiki content from working tree changes.',
      timestamp: process.env.WIKI_TIMESTAMP === undefined ? new Date() : new Date(process.env.WIKI_TIMESTAMP),
      sources: parseSources(process.env.WIKI_SOURCES),
      pages: Object.entries(pages).map(([path, content]) => ({path, content})),
    })
    owner = process.env.WIKI_OWNER
    repo = process.env.WIKI_REPO
    branch = process.env.WIKI_BRANCH
    message =
      process.env.WIKI_COMMIT_MESSAGE ??
      `feat(knowledge): ${process.env.WIKI_OPERATION ?? 'event'} ${process.env.WIKI_TARGET ?? 'wiki update'}`
  }

  const result = await commitWikiChanges({
    owner,
    repo,
    branch,
    message,
    files: built.files,
  })

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function parseSources(raw: string | undefined): WikiSource[] {
  if (raw === undefined || raw === '') {
    return []
  }

  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed.filter(isWikiSource) : []
}

function isWikiSource(value: unknown): value is WikiSource {
  return isRecord(value) && typeof value.url === 'string' && typeof value.accessed === 'string'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
