import type {Dirent} from 'node:fs'
import {Buffer} from 'node:buffer'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'

import {parse} from 'yaml'

import {buildPrivateTokenSet} from './wiki-slug.ts'

const MAX_CONTEXT_BYTES = 4 * 1024
const SOLUTIONS_ROOT = 'docs/solutions'
const SOLUTIONS_SUBDIRS = [
  'best-practices',
  'documentation-gaps',
  'integration-issues',
  'runtime-errors',
  'security-issues',
  'workflow-issues',
] as const

const STALENESS_DAYS_DEFAULT = 60

// Security-flavored tokens that boost problem_type: security_issue docs.
// Deliberately excludes 'auth' and 'token' — they fire on ordinary PRs (OAuth token
// refresh, GitHub token scope) that aren't security work, over-weighting security docs.
const SECURITY_EVENT_TOKENS = new Set(['security', 'private', 'leak', 'secret', 'credential'])

export interface SolutionsQueryEvent {
  eventName: string
  owner?: string
  repo?: string
  title?: string
  body?: string
}

export interface AssembleSolutionsContextParams {
  files: Record<string, string>
  event: SolutionsQueryEvent
  /** List of `owner/name` strings for private repos — used for fail-closed body scan. */
  privateNames: string[]
  /** Current date — injectable for deterministic tests. */
  now: Date
  maxBytes?: number
  stalenessDays?: number
}

export interface AssembleSolutionsContextResult {
  excerpt: string
  selectedPaths: string[]
  byteLength: number
}

interface SolutionDoc {
  path: string
  title: string
  module: string
  tags: string[]
  problemType: string
  appliesWhen: string[]
  lastUpdated: string | null
  verified: boolean
  body: string
  score: number
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

export function assembleSolutionsContext(params: AssembleSolutionsContextParams): AssembleSolutionsContextResult {
  const maxBytes = params.maxBytes ?? MAX_CONTEXT_BYTES
  const stalenessDays = params.stalenessDays ?? STALENESS_DAYS_DEFAULT

  const privateTokens = buildPrivateTokenSet(params.privateNames)
  const docs = collectDocs(params.files, privateTokens)
  const tokens = collectTokens(params.event)

  const securityFlavored = isSecurityFlavored(tokens)

  const ranked = docs
    .map(doc => ({...doc, score: scoreDoc(doc, tokens, securityFlavored)}))
    .filter(doc => doc.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))

  let excerpt = '# Prior Learnings\n\n'
  const selectedPaths: string[] = []

  for (const doc of ranked) {
    const section = renderSection(doc, params.now, stalenessDays)
    const next = `${excerpt}${section}`

    if (byteLength(next) <= maxBytes) {
      excerpt = next
      selectedPaths.push(doc.path)
      continue
    }

    const remaining = maxBytes - byteLength(excerpt)
    if (remaining <= 0) {
      break
    }

    const truncated = truncateToBytes(section, remaining)
    if (truncated.trim() !== '') {
      excerpt = `${excerpt}${truncated}`
      selectedPaths.push(doc.path)
    }
    break
  }

  if (selectedPaths.length === 0) {
    excerpt = ''
  }

  return {excerpt, selectedPaths, byteLength: byteLength(excerpt)}
}

// ---------------------------------------------------------------------------
// Doc collection and parsing
// ---------------------------------------------------------------------------

function collectDocs(files: Record<string, string>, privateTokens: Set<string>): SolutionDoc[] {
  const docs: SolutionDoc[] = []

  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(`${SOLUTIONS_ROOT}/`) || !path.endsWith('.md')) {
      continue
    }

    let frontmatter: Record<string, unknown>
    let body: string

    try {
      const parsed = splitFrontmatter(content)
      frontmatter = parsed.frontmatter
      body = parsed.body
    } catch {
      // Malformed frontmatter — skip this doc, do not crash
      continue
    }

    // Privacy body-scan: fail-closed — exclude if body or frontmatter contains a private token
    const fullText = content.toLowerCase()
    if (containsPrivateToken(fullText, privateTokens)) {
      // Reference by path only — never emit a resolved private name
      process.stderr.write(`solutions-query: excluded 1 doc on privacy scan (path: ${path})\n`)
      continue
    }

    docs.push({
      path,
      title: typeof frontmatter.title === 'string' ? frontmatter.title : path,
      module: typeof frontmatter.module === 'string' ? frontmatter.module : '',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === 'string') : [],
      problemType: typeof frontmatter.problem_type === 'string' ? frontmatter.problem_type : '',
      appliesWhen: Array.isArray(frontmatter.applies_when)
        ? frontmatter.applies_when.filter((t): t is string => typeof t === 'string')
        : [],
      lastUpdated: typeof frontmatter.last_updated === 'string' ? frontmatter.last_updated : null,
      verified:
        frontmatter.verified === true ||
        (typeof frontmatter.verified === 'string' && frontmatter.verified.trim() !== ''),
      body,
      score: 0,
    })
  }

  return docs
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

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

function scoreDoc(doc: SolutionDoc, tokens: Set<string>, securityFlavored: boolean): number {
  let score = 0

  for (const token of tokens) {
    // Title match — weight 15
    if (doc.title.toLowerCase().includes(token)) score += 15

    // Tags match — weight 10
    if (doc.tags.some(tag => tag.toLowerCase().includes(token))) score += 10

    // Module match via substring/token overlap — weight 12
    if (doc.module.toLowerCase().includes(token)) score += 12

    // Body match — weight 4
    if (doc.body.toLowerCase().includes(token)) score += 4

    // applies_when match — weight 8
    if (doc.appliesWhen.some(clause => clause.toLowerCase().includes(token))) score += 8
  }

  // Event-aware problem_type bonus: security-flavored events boost security_issue docs
  if (securityFlavored && doc.problemType === 'security_issue') {
    score += 20
  }

  return score
}

function isSecurityFlavored(tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (SECURITY_EVENT_TOKENS.has(token)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Privacy gate
// ---------------------------------------------------------------------------

function containsPrivateToken(lowerText: string, privateTokens: Set<string>): boolean {
  for (const token of privateTokens) {
    if (lowerText.includes(token)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

function isStale(lastUpdated: string | null, verified: boolean, now: Date, stalenessDays: number): boolean {
  if (verified) return false
  if (lastUpdated === null) return false

  const updated = new Date(lastUpdated)
  if (Number.isNaN(updated.getTime())) return false

  const diffMs = now.getTime() - updated.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays > stalenessDays
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderSection(doc: SolutionDoc, now: Date, stalenessDays: number): string {
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const bodyExcerpt = doc.body.replace(/\s+/g, ' ').trim()
  const stale = isStale(doc.lastUpdated, doc.verified, now, stalenessDays)
  const staleNote = stale ? `(candidate — last updated ${doc.lastUpdated ?? 'unknown'}, may be stale)\n` : ''
  const lastUpdatedLine = doc.lastUpdated === null ? 'Last updated: unknown' : `Last updated: ${doc.lastUpdated}`
  return `## ${doc.title}\nPath: ${doc.path}\nproblem_type: ${doc.problemType}\n${lastUpdatedLine}\n${staleNote}\n${bodyExcerpt}\n\n`
}

// ---------------------------------------------------------------------------
// Token collection
// ---------------------------------------------------------------------------

function collectTokens(event: SolutionsQueryEvent): Set<string> {
  const raw = [event.owner, event.repo, event.title, event.body]
    .filter((value): value is string => value !== undefined)
    .join(' ')
  const tokens = raw
    .toLowerCase()
    // eslint-disable-next-line unicorn/prefer-string-replace-all
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3)

  return new Set(tokens)
}

// ---------------------------------------------------------------------------
// Byte-budget helpers (multi-byte-safe)
// ---------------------------------------------------------------------------

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value
  }

  const ellipsis = '…'
  const contentBudget = maxBytes - byteLength(ellipsis)
  if (contentBudget <= 0) {
    return ''
  }

  // Slice at the byte boundary then strip any trailing replacement chars that
  // result from splitting a multi-byte codepoint mid-sequence.
  const truncated = Buffer.from(value)
    .subarray(0, contentBudget)
    .toString('utf8')
    .replaceAll(/\uFFFD+$/gu, '')

  return truncated === '' ? '' : `${truncated}${ellipsis}`
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Disk loader
// ---------------------------------------------------------------------------

async function loadSolutionsFilesFromDisk(): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  for (const subdir of SOLUTIONS_SUBDIRS) {
    const dirPath = `${SOLUTIONS_ROOT}/${subdir}`
    let entries: Dirent[]

    try {
      entries = await readdir(dirPath, {withFileTypes: true})
    } catch {
      // Directory may not exist in some environments — skip
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const path = `${dirPath}/${entry.name}`
      try {
        files[path] = await readFile(path, 'utf8')
      } catch {
        process.stderr.write(`solutions-query: could not read file (path: ${path})\n`)
      }
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Private names loader
// ---------------------------------------------------------------------------

// This scan is defense-in-depth, not the primary privacy control. The docs/solutions/
// corpus lives on main and has already cleared the promotion leak gate, so by construction
// it carries no private identifier. Canonical private names live on the data branch and are
// overlaid only for schedule/workflow_dispatch runs; on other events this returns 0 names
// and the scan is inert over already-gated content. The trust chokepoint remains promotion.
async function loadPrivateNamesFromDisk(): Promise<string[]> {
  let reposYaml: string

  try {
    reposYaml = await readFile('metadata/repos.yaml', 'utf8')
  } catch {
    process.stderr.write('solutions-query: could not read metadata/repos.yaml; privacy scan uses 0 private names\n')
    return []
  }

  try {
    const parsed: unknown = parse(reposYaml)
    if (!isRecord(parsed)) return []

    const repos = parsed.repos
    if (!Array.isArray(repos)) return []

    const privateNames: string[] = []

    for (const entry of repos) {
      if (!isRecord(entry)) continue
      if (entry.private !== true) continue

      const owner = entry.owner
      const name = entry.name

      // Skip redacted entries — they have no canonical name to scan for
      if (typeof owner !== 'string' || typeof name !== 'string' || owner === '[REDACTED]' || name === '[REDACTED]') {
        continue
      }

      privateNames.push(`${owner}/${name}`)
    }

    return privateNames
  } catch {
    process.stderr.write('solutions-query: could not parse metadata/repos.yaml; privacy scan uses 0 private names\n')
    return []
  }
}

// ---------------------------------------------------------------------------
// GITHUB_OUTPUT writer
// ---------------------------------------------------------------------------

async function writeGithubOutput(result: AssembleSolutionsContextResult): Promise<void> {
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    const [files, privateNames] = await Promise.all([loadSolutionsFilesFromDisk(), loadPrivateNamesFromDisk()])

    const result = assembleSolutionsContext({
      files,
      event: {
        eventName: process.env.SOLUTIONS_QUERY_EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? '',
        owner: process.env.SOLUTIONS_QUERY_OWNER,
        repo: process.env.SOLUTIONS_QUERY_REPO,
        title: process.env.SOLUTIONS_QUERY_TITLE,
        body: process.env.SOLUTIONS_QUERY_BODY,
      },
      privateNames,
      now: new Date(),
      maxBytes:
        process.env.SOLUTIONS_QUERY_MAX_BYTES === undefined ? undefined : Number(process.env.SOLUTIONS_QUERY_MAX_BYTES),
      stalenessDays:
        process.env.SOLUTIONS_QUERY_STALENESS_DAYS === undefined
          ? undefined
          : Number(process.env.SOLUTIONS_QUERY_STALENESS_DAYS),
    })

    await writeGithubOutput(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch {
    // Best-effort: any error → empty output, exit 0 — retrieval must never fail the workflow step
    process.stderr.write('solutions-query: unexpected error, falling back to empty context\n')
    const empty: AssembleSolutionsContextResult = {excerpt: '', selectedPaths: [], byteLength: 0}
    try {
      await writeGithubOutput(empty)
    } catch {
      // ignore
    }
    process.stdout.write(`${JSON.stringify(empty)}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
