import type {Dirent} from 'node:fs'
import type {Octokit} from '@octokit/rest'
import {execFile} from 'node:child_process'
import {appendFile, readdir, readFile} from 'node:fs/promises'
import {basename} from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'

import {parse, stringify} from 'yaml'
import {
  bootstrapDataBranch as defaultBootstrapDataBranch,
  type DataBranchBootstrapParams,
  type DataBranchBootstrapResult,
} from './data-branch-bootstrap.ts'
import {assertReposFile} from './schemas.ts'
import {computeRepoSlug} from './wiki-slug.ts'

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
  /** Trusted metadata identities keyed by canonical repo-page slug. */
  trackedRepoNodeIds?: ReadonlyMap<string, string>
  /** Trusted dispatch identity; usable only for the page matching `target`. */
  targetNodeId?: string
  /** Untrusted payload fallback; never authorizes a page migration or deletion. */
  fallbackNodeId?: string
  /** False means metadata state is unknown; preserve existing page identity. */
  trackedMetadataAvailable?: boolean
}

export interface BuildWikiIngestChangesResult {
  files: Record<string, string>
  deletedPaths: string[]
}

export interface WikiIngestWarning {
  code: 'duplicate-repo-identity' | 'repos-metadata-unavailable'
  node_ids?: string[]
  reason?: 'read-failed' | 'parse-failed'
  slugs?: string[]
}

export interface TrackedRepoNodeIdsResult {
  metadataAvailable: boolean
  nodeIds: Map<string, string>
  warnings: WikiIngestWarning[]
}

export interface CommitWikiChangesParams {
  owner?: string
  repo?: string
  branch?: string
  message: string
  files: Record<string, string>
  deletedPaths?: readonly string[]
  octokit?: OctokitClient
  maxRetries?: number
  /**
   * Idempotent data-branch bootstrap. Called before data-branch writes so wiki
   * ingest recovers when GitHub deletes the `data` source ref after promotion.
   */
  bootstrapDataBranch?: (params: DataBranchBootstrapParams) => Promise<DataBranchBootstrapResult>
}

export interface CommitWikiChangesResult {
  committed: boolean
  commitSha: string
  attempts: number
}

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

export type WikiIngestErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_PAGE_PATH'
  | 'INVALID_FRONTMATTER'
  | 'INVALID_WIKILINK'
  | 'INVALID_RETRIES'
  | 'PROTECTED_BRANCH'
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
  node_id?: string
  sources?: WikiSource[]
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
  node_id?: string
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
  const deletedPaths: string[] = []
  const migrations: {oldSlug: string; newSlug: string}[] = []

  for (const inputPage of params.pages) {
    const page = prepareWikiPage(inputPage, nextFiles, params, deletedPaths, migrations)
    assertWikiPagePath(page.path)
    const normalized = normalizeText(validateWikiPage(page.path, page.content))
    nextFiles[page.path] = normalized
    files[page.path] = normalized
  }

  rewriteInboundWikilinks(nextFiles, migrations)
  for (const [path, content] of Object.entries(nextFiles)) {
    if (params.existingFiles[path] !== content && !deletedPaths.includes(path)) {
      files[path] = content
    }
  }
  validateWikilinks(nextFiles)

  const parsedPages = collectWikiPages(nextFiles)
  const index = buildIndexDocument(nextFiles[INDEX_PATH], parsedPages)
  const log = appendLogEntry(nextFiles[LOG_PATH], params)

  files[INDEX_PATH] = index
  files[LOG_PATH] = log

  return {files, deletedPaths}
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
  rejectProtectedWikiBranchName(branch)

  const shouldBootstrapDataBranch = branch === DEFAULT_BRANCH
  const bootstrap = params.bootstrapDataBranch ?? defaultBootstrapDataBranch
  const bootstrapDataBranch = async (): Promise<void> => {
    await bootstrap({octokit, owner, repo, dataBranch: branch})
  }

  if (shouldBootstrapDataBranch) {
    await bootstrapDataBranch()
  }

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await assertWritableWikiBranch(octokit, owner, repo, branch)

      const head = await octokit.rest.git.getRef({owner, repo, ref: `heads/${branch}`})
      const commit = await octokit.rest.git.getCommit({owner, repo, commit_sha: head.data.object.sha})

      const tree: {
        path: string
        mode: '100644'
        type: 'blob'
        sha: string | null
      }[] = []
      for (const [path, content] of Object.entries(params.files)) {
        const blob = await octokit.rest.git.createBlob({owner, repo, content, encoding: 'utf-8'})
        tree.push({path, mode: '100644' as const, type: 'blob' as const, sha: blob.data.sha})
      }
      const presentPaths =
        params.deletedPaths === undefined || params.deletedPaths.length === 0
          ? new Set<string>()
          : await getPresentPathsInTree(octokit, owner, repo, commit.data.tree.sha)
      for (const path of params.deletedPaths ?? []) {
        if (params.files[path] !== undefined || !presentPaths.has(path)) {
          continue
        }
        tree.push({path, mode: '100644' as const, type: 'blob' as const, sha: null})
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
      if (shouldBootstrapDataBranch && isApiErrorStatus(error, 404) && attempt < maxRetries) {
        await bootstrapDataBranch()
        continue
      }

      if (isConflictError(error) && attempt < maxRetries) {
        await delayConflictRetry(attempt)
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

function rejectProtectedWikiBranchName(branch: string): void {
  if (branch === 'main') {
    throw new WikiIngestError({
      code: 'PROTECTED_BRANCH',
      message: 'wiki ingest refuses to write to main; use the data branch',
      remediation: 'Target the data branch. Promotions to main must go through the data-branch merge PR.',
    })
  }
}

async function assertWritableWikiBranch(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  const response = await octokit.rest.repos.getBranch({owner, repo, branch})

  if (response.data.protected === true || response.data.protection?.enabled === true) {
    throw new WikiIngestError({
      code: 'PROTECTED_BRANCH',
      message: `wiki ingest refuses to write to protected branch "${branch}"`,
      remediation:
        'Autonomous wiki writes must land on an unprotected branch. Review the ruleset or target the data branch.',
    })
  }
}

async function getPresentPathsInTree(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<Set<string>> {
  const response = await octokit.rest.git.getTree({owner, repo, tree_sha: treeSha, recursive: 'true'})
  if (response.data.truncated === true) return new Set()
  const tree: unknown = response.data.tree
  if (!Array.isArray(tree)) return new Set()
  return new Set(tree.flatMap(entry => (isRecord(entry) && typeof entry.path === 'string' ? [entry.path] : [])))
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

function validateWikiPage(path: string, content: string): string {
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

  if (hasDatabaseId(content)) {
    const document = parseFrontmatterDocument(content)
    delete document.values.database_id
    return renderFrontmatterDocument(document.values, document.body)
  }

  return content
}

function hasDatabaseId(content: string): boolean {
  return 'database_id' in parseFrontmatterDocument(content).values
}

export function validateWikilinks(files: Record<string, string>): void {
  const pages = collectWikiPages(files)
  const knownSlugs = new Set(pages.map(page => page.slug))

  for (const page of pages) {
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

/**
 * Regenerate `knowledge/index.md` deterministically from a snapshot of wiki files.
 *
 * Used both by ingest (to update the catalog inline with new pages) and by
 * `scripts/rebuild-wiki-index.ts` (to heal `index.md` after merge conflicts on
 * the shared catalog file — see PR #3114's companion context).
 *
 * Preserves any header/footer prose found in `existingIndex` so operator notes
 * above `## Repos` and below the closing `---` survive regeneration.
 */
export function rebuildWikiIndex(params: {existingIndex?: string; wikiFiles: Record<string, string>}): string {
  return buildIndexDocument(params.existingIndex, collectWikiPages(params.wikiFiles))
}

const LOG_HEADER =
  '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n'
// Matches a log entry header line: "## [YYYY-MM-DD HH:MM] <op> | <target>".
// `[ \t]*` instead of `\s*` keeps the regex anchored to single-line whitespace and
// avoids the super-linear backtracking risk on adjacent variable-length classes.
const LOG_ENTRY_PATTERN = /\n## \[([^\]]+)\] (?:ingest|query|lint|manual-edit) \| ([^\n]+)\n/g

interface WikiLogEntry {
  timestamp: string
  target: string
  /** Raw entry markup including the leading blank-line separator — byte-for-byte fidelity on reinsertion. */
  raw: string
}

/**
 * Merge multiple `knowledge/log.md` contents into a single canonical log.
 *
 * Used to resolve merge conflicts on the append-only log: given log.md from
 * main and log.md from a PR, produce a combined log with every entry present
 * (deduplicated by timestamp+target) in chronological order.
 *
 * The log's documented contract is append-only. This helper keeps that contract
 * intact across concurrent writers by canonicalizing the order rather than
 * forcing operators to hand-merge conflict markers.
 */
export function mergeWikiLogs(logs: (string | undefined)[]): string {
  const entryMap = new Map<string, WikiLogEntry>()
  for (const log of logs) {
    if (log === undefined || log === '') continue
    for (const entry of parseWikiLogEntries(log)) {
      // Dedupe by the natural key (timestamp, target). When the same entry
      // appears in multiple inputs, the last one wins — but since entries are
      // normalized the content matches byte-for-byte.
      entryMap.set(`${entry.timestamp}\0${entry.target}`, entry)
    }
  }
  const entries = [...entryMap.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  return normalizeText(`${LOG_HEADER}${entries.map(entry => entry.raw).join('')}`)
}

function parseWikiLogEntries(log: string): WikiLogEntry[] {
  const entries: WikiLogEntry[] = []
  const matches = [...log.matchAll(LOG_ENTRY_PATTERN)]
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    if (match === undefined || match.index === undefined) continue
    const [, timestamp, target] = match
    if (timestamp === undefined || target === undefined) continue
    const start = match.index
    const nextMatch = matches[i + 1]
    const end = nextMatch?.index ?? log.length
    entries.push({
      timestamp: timestamp.trim(),
      target: target.trim(),
      raw: log.slice(start, end),
    })
  }
  return entries
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

  // Preserve operator-curated or previously-generated entry descriptions when a
  // slug still has a wiki page. Rebuilds only add new entries and drop stale
  // ones — they never degrade richer descriptions back to bare frontmatter
  // titles.
  const existingLines: Map<string, string> =
    existingIndex === undefined ? new Map<string, string>() : parseIndexEntryLines(existingIndex)

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
        .map(page => existingLines.get(page.slug) ?? `- [[${page.slug}]] — ${page.title}`)

      return [`## ${section.heading}`, '', ...(entries.length > 0 ? entries : [section.empty]), ''].join('\n')
    })
    .join('\n')

  return normalizeText(`${header}${body}${footer}`)
}

/**
 * Extract previously-rendered entry lines from an index document keyed by slug.
 * Used to preserve operator-curated or agent-generated rich descriptions across
 * rebuilds — only new slugs get fresh `slug — title` lines.
 */
function parseIndexEntryLines(index: string): Map<string, string> {
  const entries = new Map<string, string>()
  // Match the full line: "- [[slug]] — description"
  // Description may contain anything except a newline (we keep the entire trailing text).
  const pattern = /^- \[\[([^\]|]+)\]\]\s*—\s*(?:\S.*|[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/gmu
  for (const match of index.matchAll(pattern)) {
    const [line, slug] = match
    if (line === undefined || slug === undefined) continue
    entries.set(slug.trim(), line)
  }
  return entries
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

  const logOperation = params.operation === 'manual-edit' ? 'manual-edit' : 'ingest'
  return normalizeText(`${base}\n## [${stamp}] ${logOperation} | ${params.target}\n\n${params.summary}\n\n${sources}\n`)
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
    node_id: typeof parsed.node_id === 'string' ? parsed.node_id : undefined,
    sources: Array.isArray(parsed.sources) ? parsed.sources.filter(isWikiSource) : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter(tag => typeof tag === 'string') : undefined,
    aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter(alias => typeof alias === 'string') : undefined,
    related: Array.isArray(parsed.related) ? parsed.related.filter(related => typeof related === 'string') : undefined,
  }
}

function prepareWikiPage(
  page: WikiPageInput,
  existingFiles: Record<string, string>,
  params: BuildWikiIngestChangesParams,
  deletedPaths: string[],
  migrations: {oldSlug: string; newSlug: string}[],
): WikiPageInput {
  if (!isRepoPagePath(page.path)) return page

  const incomingFrontmatter = parseFrontmatter(page.path, page.content)
  const pageSlug = basename(page.path, '.md')
  const targetSlug = repoTargetSlug(params.target)
  const trackedNodeId = params.trackedRepoNodeIds?.get(pageSlug)
  const isTargetPage = targetSlug === pageSlug
  const identity = resolvePageIdentity({
    trackedNodeId,
    targetNodeId: isTargetPage ? params.targetNodeId : undefined,
    fallbackNodeId: isTargetPage ? params.fallbackNodeId : undefined,
    frontmatterNodeId: incomingFrontmatter.node_id,
  })
  if (identity === undefined || !identity.trusted) {
    const preserveNodeId =
      params.trackedMetadataAvailable === false
        ? (getExistingRepoNodeId(existingFiles[page.path], page.path) ?? incomingFrontmatter.node_id)
        : undefined
    return {
      path: page.path,
      content: updateRepoPageFrontmatter(page.content, preserveNodeId),
    }
  }

  const nodeMatch = identity.trusted ? findRepoPageByNodeId(existingFiles, identity.nodeId) : undefined
  const historicalPages: string[] = []

  if (nodeMatch !== undefined && nodeMatch.path !== page.path) {
    historicalPages.push(nodeMatch.content)
    delete existingFiles[nodeMatch.path]
    if (!deletedPaths.includes(nodeMatch.path)) deletedPaths.push(nodeMatch.path)
    const slugMatch = existingFiles[page.path]
    if (slugMatch !== undefined) historicalPages.push(slugMatch)
    migrations.push({oldSlug: nodeMatch.slug, newSlug: pageSlug})
    return {
      path: page.path,
      content: mergeRepoPageContent(page.content, historicalPages, {
        nodeId: identity.nodeId,
        title: repoTargetTitle(params.target) ?? incomingFrontmatter.title,
        aliases: [nodeMatch.slug],
      }),
    }
  }

  return {
    path: page.path,
    content: updateRepoPageFrontmatter(page.content, identity.nodeId),
  }
}

function resolvePageIdentity(params: {
  trackedNodeId?: string
  targetNodeId?: string
  fallbackNodeId?: string
  frontmatterNodeId?: string
}): {nodeId: string; trusted: boolean} | undefined {
  if (params.trackedNodeId !== undefined) return {nodeId: params.trackedNodeId, trusted: true}
  if (params.targetNodeId !== undefined) return {nodeId: params.targetNodeId, trusted: true}
  if (params.fallbackNodeId !== undefined) return {nodeId: params.fallbackNodeId, trusted: false}
  if (params.frontmatterNodeId !== undefined) return {nodeId: params.frontmatterNodeId, trusted: false}
  return undefined
}

function findRepoPageByNodeId(
  files: Record<string, string>,
  nodeId: string,
): {path: string; slug: string; content: string} | undefined {
  const candidates = Object.entries(files)
    .filter(([path]) => isRepoPagePath(path))
    .sort(([left], [right]) => left.localeCompare(right))
  for (const [path, content] of candidates) {
    const frontmatter = parseFrontmatter(path, content)
    if (frontmatter.node_id === nodeId) {
      return {path, slug: basename(path, '.md'), content}
    }
  }
  return undefined
}

function mergeRepoPageContent(
  incomingContent: string,
  historicalContents: string[],
  changes: {nodeId: string; title?: string; aliases?: string[]},
): string {
  const incoming = parseFrontmatterDocument(incomingContent)
  const historical = historicalContents.map(content => parseFrontmatterDocument(content))
  const values: Record<string, unknown> = {...incoming.values}
  const records = [incoming.values, ...historical.map(page => page.values)]

  for (const key of ['aliases', 'tags', 'related', 'sources']) {
    const merged = mergeFrontmatterArray(records, key)
    if (merged.length > 0) values[key] = merged
  }
  const aliases = mergeFrontmatterArray(records, 'aliases').filter(
    (value): value is string => typeof value === 'string',
  )
  for (const alias of changes.aliases ?? []) {
    if (!aliases.includes(alias)) aliases.push(alias)
  }
  if (aliases.length > 0) values.aliases = aliases
  if (changes.title !== undefined) values.title = changes.title
  values.node_id = changes.nodeId
  delete values.database_id

  const createdDates = records
    .map(record => record.created)
    .filter((value): value is string => typeof value === 'string' && DATE_PATTERN.test(value))
    .sort()
  if (createdDates[0] !== undefined) values.created = createdDates[0]

  let body = incoming.body.trim()
  for (const page of historical) {
    const historicalBody = page.body.trim()
    if (historicalBody !== '' && !body.includes(historicalBody)) {
      body = body === '' ? historicalBody : `${body}\n\n${historicalBody}`
    }
  }

  return renderFrontmatterDocument(values, body)
}

function updateRepoPageFrontmatter(content: string, nodeId?: string): string {
  const document = parseFrontmatterDocument(content)
  if (nodeId === undefined) delete document.values.node_id
  else document.values.node_id = nodeId
  delete document.values.database_id
  return renderFrontmatterDocument(document.values, document.body)
}

function getExistingRepoNodeId(content: string | undefined, path: string): string | undefined {
  if (content === undefined) return undefined
  return parseFrontmatter(path, content).node_id
}

function renderFrontmatterDocument(values: Record<string, unknown>, body: string): string {
  return normalizeText(`---\n${stringify(values).trimEnd()}\n---\n\n${body.trim()}\n`)
}

function rewriteInboundWikilinks(
  files: Record<string, string>,
  migrations: readonly {oldSlug: string; newSlug: string}[],
): void {
  for (const migration of migrations) {
    // eslint-disable-next-line unicorn/prefer-string-raw
    const escapedOldSlug = migration.oldSlug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    // eslint-disable-next-line unicorn/prefer-string-raw
    const pattern = new RegExp(`\\[\\[${escapedOldSlug}(?=\\||\\]\\])`, 'gu')
    for (const [path, content] of Object.entries(files)) {
      files[path] = content.replace(pattern, `[[${migration.newSlug}`)
    }
  }
}

function mergeFrontmatterArray(records: Record<string, unknown>[], key: string): unknown[] {
  const values: unknown[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const candidate = record[key]
    if (!Array.isArray(candidate)) continue
    for (const value of candidate) {
      const fingerprint = JSON.stringify(value)
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      values.push(value)
    }
  }
  return values
}

function parseFrontmatterDocument(content: string): {values: Record<string, unknown>; body: string} {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null || match[1] === undefined) {
    throw new Error('validated wiki page is missing frontmatter')
  }
  const parsed: unknown = parse(match[1])
  if (!isRecord(parsed)) throw new Error('validated wiki page frontmatter is not an object')
  return {values: parsed, body: content.slice(match[0].length)}
}

function isRepoPagePath(path: string): boolean {
  return path.startsWith(`${WIKI_ROOT}/repos/`) && path.endsWith('.md')
}

function repoTargetTitle(target: string): string | undefined {
  if (!target.startsWith('repo:')) return undefined
  const nameWithOwner = target.slice('repo:'.length)
  const slash = nameWithOwner.indexOf('/')
  if (slash < 1 || slash === nameWithOwner.length - 1) return undefined
  return nameWithOwner
}

function repoTargetSlug(target: string): string | undefined {
  const parts = repoTargetParts(target)
  return parts === undefined ? undefined : computeRepoSlug(parts.owner, parts.name)
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
  const pattern = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[a-z0-9.-]+\.md$/
  if (!pattern.test(path)) {
    throw new WikiIngestError({
      code: 'INVALID_PAGE_PATH',
      message: `${path} is outside the allowed wiki directories`,
      remediation:
        'Write wiki pages only under knowledge/wiki/repos, topics, entities, or comparisons using kebab-case filenames.',
    })
  }
}

export function pageTypeFromPath(path: string): WikiPageType {
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
  return isRecord(error) && error.status === 409
}

function isApiErrorStatus(error: unknown, status: number): boolean {
  return isRecord(error) && error.status === status
}

async function delayConflictRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(1000 * 2 ** (attempt - 1) + Math.random() * 500, 10_000)
  await new Promise(resolve => setTimeout(resolve, delayMs))
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
    try {
      files[path] = await readFile(path, 'utf8')
    } catch (error: unknown) {
      if (isEnoentError(error)) {
        files[path] = ''
        continue
      }

      throw error
    }
  }

  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries: Dirent[]

    try {
      entries = await readdir(directoryPath, {withFileTypes: true})
    } catch (error: unknown) {
      if (isEnoentError(error)) {
        continue
      }

      throw error
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const path = `${directoryPath}/${entry.name}`
      try {
        files[path] = await readFile(path, 'utf8')
      } catch (error: unknown) {
        if (isEnoentError(error)) {
          continue
        }

        throw error
      }
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

  return parsePorcelainPaths(stdout).filter(path => path !== INDEX_PATH && path !== LOG_PATH && path.endsWith('.md'))
}

/**
 * Parse paths from `git status --porcelain=v1` output.
 *
 * Porcelain v1 format is `XY<space>PATH\n` where X = index status and Y = worktree
 * status. Either position may be a literal space for "unchanged". Example lines:
 * - ` M path/to/file` — modified in worktree, not staged (X = space)
 * - `M  path/to/file` — staged modification (Y = space)
 * - `A  path/to/file` — newly added (staged)
 * - `?? path/to/file` — untracked
 * - ` D path/to/file` — worktree deletion (file gone from disk)
 * - `D  path/to/file` — staged deletion
 *
 * Rename lines (`XY OLD -> NEW`) and submodules are out of scope — this script
 * only commits additive wiki markdown files, never renames.
 *
 * Deletions are filtered out. The wiki commit path's contract is additive-only,
 * and `loadWorkingTreeWikiFiles` would crash with ENOENT trying to read a deleted
 * path. Production incident (2026-04-19): the survey-repo workflow's
 * `Sync wiki from data branch` step removed files that exist on main but not on
 * data, surfacing those deletions through porcelain and crashing the ingest.
 * Any status where X or Y is `D` signals the file is absent or being removed —
 * skip it.
 *
 * Historical bug: a prior implementation used `line.trim()` before `line.slice(3)`,
 * which stripped the X-position space for unstaged changes and caused
 * `line.slice(3)` to eat the first character of the path (e.g. `knowledge/...`
 * became `nowledge/...` and the subsequent `readFile` failed with ENOENT). The
 * fix: preserve the fixed 3-char prefix and only strip trailing CR for cross-platform safety.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  return (
    stdout
      .split('\n')
      .map(line => line.replace(/\r$/, ''))
      .filter(line => line.length >= 4)
      // Skip any status where X or Y is 'D' (deletion). Working-tree ingestion only
      // reads surviving files; canonical page migrations carry deletions explicitly
      // through `BuildWikiIngestChangesResult.deletedPaths` into the Git Data API tree.
      .filter(line => !line.slice(0, 2).includes('D'))
      .map(line => line.slice(3))
      .filter(path => path !== '')
  )
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
    node_id: typeof parsed.node_id === 'string' ? parsed.node_id : undefined,
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

const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/

/**
 * Count the number of wiki entry pages in a list of paths.
 * Only paths matching `knowledge/wiki/(repos|topics|entities|comparisons)/<filename>.md`
 * are counted. Excludes knowledge/index.md, knowledge/log.md, and any paths outside
 * the four category directories.
 */
export function countWikiPages(paths: string[]): number {
  return paths.filter(p => WIKI_PAGE_PATTERN.test(p)).length
}

async function emitPagesChanged(n: number): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    await appendFile(outputPath, `pages_changed=${n}\n`)
  }
}

export async function runWikiIngestCli(): Promise<void> {
  const payloadPath = process.argv[2] ?? process.env.WIKI_INGEST_INPUT
  const existingFiles = await loadExistingWikiFiles()

  let built: BuildWikiIngestChangesResult
  let owner: string | undefined
  let repo: string | undefined
  let branch: string | undefined
  let message: string
  let identityWarnings: WikiIngestWarning[] = []

  let committedPagePaths: string[]

  if (payloadPath !== undefined && payloadPath !== '') {
    const payload = parsePayload(await readFile(payloadPath, 'utf8'))
    const tracked = await loadTrackedRepoNodeIds()
    identityWarnings = tracked.warnings
    built = buildWikiIngestChanges({
      existingFiles,
      operation: payload.operation,
      target: payload.target,
      summary: payload.summary,
      timestamp: payload.timestamp === undefined ? new Date() : new Date(payload.timestamp),
      sources: payload.sources,
      pages: payload.pages,
      trackedRepoNodeIds: tracked.nodeIds,
      fallbackNodeId: payload.node_id,
      trackedMetadataAvailable: tracked.metadataAvailable,
    })
    owner = payload.owner
    repo = payload.repo
    branch = payload.branch
    message = payload.message ?? defaultCommitMessage(payload)
    committedPagePaths = payload.pages.map(p => p.path)
  } else {
    const changedPaths = await getChangedWikiPaths()
    if (changedPaths.length === 0) {
      await emitPagesChanged(0)
      process.stdout.write(`${JSON.stringify({committed: false, attempts: 1, pagesChanged: 0})}\n`)
      return
    }

    const pages = await loadWorkingTreeWikiFiles(changedPaths)
    const operation = isWikiOperation(process.env.WIKI_OPERATION) ? process.env.WIKI_OPERATION : 'event'
    const target = process.env.WIKI_TARGET ?? 'repo:unknown/unknown'
    const tracked = await loadTrackedRepoNodeIds()
    identityWarnings = tracked.warnings
    built = buildWikiIngestChanges({
      existingFiles,
      operation,
      target,
      summary: process.env.WIKI_SUMMARY ?? 'Updated wiki content from working tree changes.',
      timestamp: process.env.WIKI_TIMESTAMP === undefined ? new Date() : new Date(process.env.WIKI_TIMESTAMP),
      sources: parseSources(process.env.WIKI_SOURCES),
      pages: Object.entries(pages).map(([path, content]) => ({path, content})),
      trackedRepoNodeIds: tracked.nodeIds,
      targetNodeId: process.env.REPO_NODE_ID,
      trackedMetadataAvailable: tracked.metadataAvailable,
    })
    owner = process.env.WIKI_OWNER
    repo = process.env.WIKI_REPO
    branch = process.env.WIKI_BRANCH
    message =
      process.env.WIKI_COMMIT_MESSAGE ??
      `feat(knowledge): ${process.env.WIKI_OPERATION ?? 'event'} ${process.env.WIKI_TARGET ?? 'wiki update'}`
    committedPagePaths = changedPaths
  }

  for (const warning of identityWarnings) {
    process.stderr.write(`wiki-ingest:warning:${JSON.stringify(warning)}\n`)
  }

  const result = await commitWikiChanges({
    owner,
    repo,
    branch,
    message,
    files: built.files,
    deletedPaths: built.deletedPaths,
  })

  const pagesChanged = countWikiPages(committedPagePaths)
  await emitPagesChanged(pagesChanged)
  process.stdout.write(`${JSON.stringify({...result, pagesChanged})}\n`)
}

type ReadUtf8File = (path: string, encoding: 'utf8') => Promise<string>

const readUtf8File: ReadUtf8File = async (path, encoding) => readFile(path, encoding)

export async function loadTrackedRepoNodeIds(
  readFileImpl: ReadUtf8File = readUtf8File,
): Promise<TrackedRepoNodeIdsResult> {
  let raw: string
  try {
    raw = await readFileImpl('metadata/repos.yaml', 'utf8')
  } catch {
    return {
      metadataAvailable: false,
      nodeIds: new Map(),
      warnings: [{code: 'repos-metadata-unavailable', reason: 'read-failed'}],
    }
  }

  let parsed: unknown
  try {
    parsed = parse(raw)
    assertReposFile(parsed)
  } catch {
    return {
      metadataAvailable: false,
      nodeIds: new Map(),
      warnings: [{code: 'repos-metadata-unavailable', reason: 'parse-failed'}],
    }
  }

  const candidates = parsed.repos.flatMap(entry => {
    if (entry.private !== false || typeof entry.node_id !== 'string') return []
    return [
      {
        databaseId: entry.database_id,
        nodeId: entry.node_id,
        slug: computeRepoSlug(entry.owner, entry.name),
      },
    ]
  })
  const nodeSlugs = new Map<string, Set<string>>()
  const databaseSlugs = new Map<number, Set<string>>()
  for (const candidate of candidates) {
    const nodeGroup = nodeSlugs.get(candidate.nodeId) ?? new Set<string>()
    nodeGroup.add(candidate.slug)
    nodeSlugs.set(candidate.nodeId, nodeGroup)
    if (candidate.databaseId !== undefined) {
      const databaseGroup = databaseSlugs.get(candidate.databaseId) ?? new Set<string>()
      databaseGroup.add(candidate.slug)
      databaseSlugs.set(candidate.databaseId, databaseGroup)
    }
  }

  const collidingSlugs = new Set<string>()
  const warningGroups = new Map<string, Set<string>>()
  const registerCollision = (slugs: Set<string>): void => {
    if (slugs.size < 2) return
    const orderedSlugs = [...slugs].sort((left, right) => left.localeCompare(right))
    const key = orderedSlugs.join('\u0000')
    warningGroups.set(key, slugs)
    for (const slug of slugs) collidingSlugs.add(slug)
  }
  for (const slugs of nodeSlugs.values()) registerCollision(slugs)
  for (const slugs of databaseSlugs.values()) registerCollision(slugs)

  const warnings: WikiIngestWarning[] = [...warningGroups.values()]
    .map((slugs): WikiIngestWarning => ({
      code: 'duplicate-repo-identity' as const,
      node_ids: candidates
        .filter(candidate => slugs.has(candidate.slug))
        .map(candidate => candidate.nodeId)
        .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
        .sort((left, right) => left.localeCompare(right)),
      slugs: [...slugs].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) =>
      (left.slugs?.join('\u0000') ?? left.code).localeCompare(right.slugs?.join('\u0000') ?? right.code),
    )

  const nodeIds = new Map<string, string>()
  for (const candidate of candidates) {
    if (collidingSlugs.has(candidate.slug)) continue
    nodeIds.set(candidate.slug, candidate.nodeId)
  }
  return {metadataAvailable: true, nodeIds, warnings}
}

function repoTargetParts(target: string): {owner: string; name: string} | undefined {
  if (!target.startsWith('repo:')) return undefined
  const nameWithOwner = target.slice('repo:'.length)
  const slash = nameWithOwner.indexOf('/')
  if (slash < 1 || slash === nameWithOwner.length - 1) return undefined
  return {owner: nameWithOwner.slice(0, slash), name: nameWithOwner.slice(slash + 1)}
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

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === 'ENOENT'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiIngestCli()
}
