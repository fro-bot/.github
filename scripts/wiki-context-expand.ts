/**
 * Read-only, agent-invoked wiki context expansion CLI.
 *
 * Extends the cheap baseline wiki prompt injection with a bounded, explicitly-invoked
 * follow-up: either first-hop wikilinks from the baseline-selected pages ("linked" mode)
 * or a short grounded corpus query ("query" mode). Both modes share the same corpus,
 * budget, and runtime safety gate, and both return a structurally identical empty result
 * shape for every non-match/invalid/excluded case so query mode cannot become a
 * fine-grained corpus oracle.
 *
 * Output contract: deterministic JSON to stdout containing only safe excerpts, safe
 * selected paths, byte length, mode, status, and closed-vocabulary reason/counts. No raw
 * query text, handoff path, selected-path file contents, excerpt bodies outside the JSON
 * result, private token names, raw error messages, or environment values are ever
 * written to stdout or stderr.
 */

import {readdir, readFile} from 'node:fs/promises'
import process from 'node:process'

import {parse} from 'yaml'

import {filterSafeCandidates} from './wiki-context-safety.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'
import {
  buildWikiTargetIndex,
  byteLength,
  collectWikilinks,
  collectWikiPages,
  truncateToBytes,
  WIKI_ROOT,
} from './wiki-utils.ts'

/** Per-invocation hard cap on returned excerpt bytes. */
export const MAX_EXPANDED_CONTEXT_BYTES = 8 * 1024

/** Per-invocation hard cap on returned pages. */
export const MAX_EXPANDED_CONTEXT_PAGES = 3

const USAGE = 'Usage: wiki-context-expand <linked|query> [query text]\n'

// Overbroad/stopword-only query rejection vocabulary — short, generic terms that would
// return most of the corpus rather than a grounded slice.
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'it',
  'this',
  'that',
  'with',
  'as',
  'at',
  'by',
  'be',
  'are',
  'was',
  'were',
  'i',
  'me',
  'my',
])
const OVERBROAD_QUERIES = new Set(['wiki', 'help', 'context', 'info', 'information', 'docs', 'everything', 'all'])
const MAX_QUERY_LENGTH = 200
const SHELL_METACHARACTERS = /[;&|`$(){}<>\\]/u
const PATH_LIKE = /[/\\]/u
const DELIMITER_SHAPED = /\[\[|\]\]|<!--|--!?>|\{\{|\}\}/u
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/iu,
  /disregard\s+(all\s+)?(previous|prior|above)/iu,
  /system\s*prompt/iu,
  /reveal\s+(secrets?|tokens?|credentials?)/iu,
]

export type ExpandMode = 'linked' | 'query'
export type ExpandStatus = 'ok' | 'empty'

/**
 * Closed-vocabulary empty reason. `safety-excluded` is intentionally NOT a member —
 * every mode's stdout JSON must collapse a safety-filtered candidate set to the same
 * external reason as a true no-match, so query mode can never be used to distinguish
 * "matched but excluded" from "did not match" and become a fine-grained corpus oracle.
 */
export type EmptyReason =
  | 'no-handoff'
  | 'malformed-handoff'
  | 'no-links'
  | 'invalid-query'
  | 'no-match'
  | 'private-token-load-failed'
  | 'no-corpus'
  | 'bad-args'

export interface ExpandResult {
  readonly status: ExpandStatus
  readonly mode: ExpandMode
  readonly selectedPaths: readonly string[]
  readonly excerpt: string
  readonly byteLength: number
  readonly pageCount: number
  readonly reason?: EmptyReason
}

// ---------------------------------------------------------------------------
// Query validation
// ---------------------------------------------------------------------------

export interface QueryValidationResult {
  readonly valid: boolean
  readonly tokens?: readonly string[]
}

/**
 * Validate and tokenize a query BEFORE any corpus access. Rejects empty, stopword-only,
 * path-like, delimiter-shaped, shell-metacharacter, prompt-injection-shaped, too-long, and
 * overbroad queries. This tokenizer is deliberately separate from the baseline event
 * tokenizer used by `wiki-query.ts` — query mode has a stricter, security-relevant input
 * boundary that the baseline event tokenizer does not need.
 */
export function validateQuery(rawQuery: string): QueryValidationResult {
  const trimmed = rawQuery.trim()

  if (trimmed === '') {
    return {valid: false}
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return {valid: false}
  }
  if (PATH_LIKE.test(trimmed)) {
    return {valid: false}
  }
  if (DELIMITER_SHAPED.test(trimmed)) {
    return {valid: false}
  }
  if (SHELL_METACHARACTERS.test(trimmed)) {
    return {valid: false}
  }
  if (PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return {valid: false}
  }

  const tokens = trimmed
    .toLowerCase()
    // eslint-disable-next-line unicorn/prefer-string-replace-all
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3)

  const meaningfulTokens = tokens.filter(token => !STOPWORDS.has(token))
  if (meaningfulTokens.length === 0) {
    return {valid: false}
  }
  if (meaningfulTokens.length === 1 && OVERBROAD_QUERIES.has(meaningfulTokens[0] ?? '')) {
    return {valid: false}
  }

  return {valid: true, tokens: meaningfulTokens}
}

// ---------------------------------------------------------------------------
// Handoff parsing
// ---------------------------------------------------------------------------

export type HandoffStatus = 'ok' | 'missing' | 'malformed'

export interface HandoffParseResult {
  readonly status: HandoffStatus
  readonly selectedPaths: readonly string[]
}

/** Parse baseline handoff file content into a validated selected-paths list. Fails closed on any shape mismatch. */
export function parseHandoffContent(content: string): HandoffParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return {status: 'malformed', selectedPaths: []}
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {status: 'malformed', selectedPaths: []}
  }

  const selectedPaths = (parsed as Record<string, unknown>).selectedPaths
  if (!Array.isArray(selectedPaths) || !selectedPaths.every((value): value is string => typeof value === 'string')) {
    return {status: 'malformed', selectedPaths: []}
  }

  return {status: 'ok', selectedPaths}
}

// ---------------------------------------------------------------------------
// Private token loading
// ---------------------------------------------------------------------------

/**
 * Discriminated union for private-token loading — replaces a boolean+nullable shape so
 * callers narrow on `loaded` without an `as Set<string>` cast.
 */
export type PrivateTokenLoadResult =
  {readonly loaded: true; readonly tokens: ReadonlySet<string>} | {readonly loaded: false; readonly tokens: null}

/** Build the private token set from `metadata/repos.yaml` content. Fails closed (loaded: false) on any read/parse failure. */
export function parsePrivateTokensFromReposYaml(content: string | null): PrivateTokenLoadResult {
  if (content === null) {
    return {loaded: false, tokens: null}
  }

  let parsed: unknown
  try {
    parsed = parse(content)
  } catch {
    return {loaded: false, tokens: null}
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {loaded: false, tokens: null}
  }

  const repos = (parsed as Record<string, unknown>).repos
  if (!Array.isArray(repos)) {
    return {loaded: false, tokens: null}
  }

  const privateNames: string[] = []
  for (const entry of repos) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (!isPrivateFlag(record.private)) continue
    const owner = record.owner
    const name = record.name
    if (typeof owner !== 'string' || typeof name !== 'string') continue
    if (owner === '[REDACTED]' || name === '[REDACTED]') continue
    privateNames.push(`${owner}/${name}`)
  }

  return {loaded: true, tokens: buildPrivateTokenSet(privateNames)}
}

/** Treat both boolean `true` and the quoted string `'true'` as a private-repo flag. */
function isPrivateFlag(value: unknown): boolean {
  return value === true || value === 'true'
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

interface CorpusPage {
  readonly path: string
  readonly slug: string
  readonly title: string
  readonly aliases: readonly string[]
  readonly body: string
}

export interface AssembleLinkedParams {
  readonly mode: 'linked'
  readonly files: Record<string, string>
  readonly handoffStatus: HandoffStatus
  readonly baselineSelectedPaths?: readonly string[]
  readonly privateTokens: ReadonlySet<string> | null
  readonly maxBytes?: number
  readonly maxPages?: number
}

export interface AssembleQueryParams {
  readonly mode: 'query'
  readonly files: Record<string, string>
  readonly query: string
  readonly privateTokens: ReadonlySet<string> | null
  readonly maxBytes?: number
  readonly maxPages?: number
}

export type AssembleExpandedContextParams = AssembleLinkedParams | AssembleQueryParams

const EMPTY_RESULT = (mode: ExpandMode, reason: EmptyReason): ExpandResult => ({
  status: 'empty',
  mode,
  selectedPaths: [],
  excerpt: '',
  byteLength: 0,
  pageCount: 0,
  reason,
})

/**
 * Pure core: given a corpus, mode input, private token set, and budget settings, assemble
 * an expanded wiki context result. Safety filtering runs before formatting so an unsafe
 * candidate never reaches string concatenation.
 */
export function assembleExpandedContext(params: AssembleExpandedContextParams): ExpandResult {
  if (params.privateTokens === null) {
    return EMPTY_RESULT(params.mode, 'private-token-load-failed')
  }

  if (params.mode === 'query') {
    const validation = validateQuery(params.query)
    if (!validation.valid || validation.tokens === undefined) {
      return EMPTY_RESULT('query', 'invalid-query')
    }
  }

  const pages = collectWikiPages(params.files).filter(page => page.frontmatterError === undefined)
  if (pages.length === 0) {
    return EMPTY_RESULT(params.mode, 'no-corpus')
  }

  const candidates: CorpusPage[] =
    params.mode === 'linked' ? collectLinkedCandidates(params, pages) : collectQueryCandidates(params, pages)

  if (candidates.length === 0) {
    const reason: EmptyReason =
      params.mode === 'linked'
        ? params.handoffStatus === 'missing'
          ? 'no-handoff'
          : params.handoffStatus === 'malformed'
            ? 'malformed-handoff'
            : 'no-links'
        : 'no-match'
    return EMPTY_RESULT(params.mode, reason)
  }

  const safeCandidates = filterSafeCandidates(candidates, params.privateTokens)
  if (safeCandidates.length === 0) {
    // Safety-filtered candidates are indistinguishable from a true no-match/no-links
    // result in the external reason — query mode must not be able to fingerprint the
    // private corpus by observing whether candidates existed but were excluded.
    return EMPTY_RESULT(params.mode, params.mode === 'linked' ? 'no-links' : 'no-match')
  }

  const maxBytes = params.maxBytes ?? MAX_EXPANDED_CONTEXT_BYTES
  const maxPages = params.maxPages ?? MAX_EXPANDED_CONTEXT_PAGES

  const {excerpt, selectedPaths} = formatCandidates(safeCandidates.slice(0, maxPages), maxBytes)

  if (selectedPaths.length === 0) {
    return EMPTY_RESULT(params.mode, params.mode === 'linked' ? 'no-links' : 'no-match')
  }

  return {
    status: 'ok',
    mode: params.mode,
    selectedPaths,
    excerpt,
    byteLength: byteLength(excerpt),
    pageCount: selectedPaths.length,
  }
}

function collectLinkedCandidates(params: AssembleLinkedParams, pages: readonly CorpusPage[]): CorpusPage[] {
  if (params.handoffStatus !== 'ok') {
    return []
  }

  const baselinePaths = new Set(params.baselineSelectedPaths ?? [])
  if (baselinePaths.size === 0) {
    return []
  }

  const index = buildWikiTargetIndex(pages)
  const pagesByPath = new Map(pages.map(page => [page.path, page]))

  const candidateOrder: string[] = []
  const seen = new Set<string>()

  for (const baselinePath of baselinePaths) {
    const baselinePage = pagesByPath.get(baselinePath)
    if (baselinePage === undefined) continue

    for (const linkTarget of collectWikilinks(baselinePage.body)) {
      const resolved = index.resolve(linkTarget)
      if (resolved === undefined) continue
      if (baselinePaths.has(resolved.path)) continue
      if (seen.has(resolved.path)) continue
      seen.add(resolved.path)
      candidateOrder.push(resolved.path)
    }
  }

  return candidateOrder.map(path => pagesByPath.get(path)).filter((page): page is CorpusPage => page !== undefined)
}

function collectQueryCandidates(params: AssembleQueryParams, pages: readonly CorpusPage[]): CorpusPage[] {
  const validation = validateQuery(params.query)
  if (!validation.valid || validation.tokens === undefined) {
    return []
  }

  const tokens = validation.tokens
  const scored = pages
    .map(page => ({page, score: scorePage(page, tokens)}))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.page.title.localeCompare(right.page.title))

  return scored.map(entry => entry.page)
}

function scorePage(page: CorpusPage, tokens: readonly string[]): number {
  let score = 0
  for (const token of tokens) {
    if (page.slug.toLowerCase().includes(token)) score += 25
    if (page.title.toLowerCase().includes(token)) score += 15
    if (page.body.toLowerCase().includes(token)) score += 4
  }
  return score
}

function formatCandidates(
  candidates: readonly CorpusPage[],
  maxBytes: number,
): {excerpt: string; selectedPaths: string[]} {
  let excerpt = ''
  const selectedPaths: string[] = []

  for (const page of candidates) {
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

  return {excerpt, selectedPaths}
}

function renderSection(page: CorpusPage): string {
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const body = page.body.replace(/\s+/g, ' ').trim()
  return `## ${page.title}\nPath: ${page.path}\n\n${body}\n\n`
}

// ---------------------------------------------------------------------------
// CLI argv parsing (argv-only inputs — never shell-interpolated)
// ---------------------------------------------------------------------------

export interface ArgvParseResult {
  readonly ok: boolean
  readonly mode?: ExpandMode
  readonly query?: string
  readonly help?: boolean
}

/** Parse fixed argv: `<mode> [query]`. Mode is a fixed value; query mode requires a non-empty query argument. */
export function parseArgv(argv: readonly string[]): ArgvParseResult {
  const [first, query] = argv

  if (first === '--help' || first === '-h') {
    return {ok: true, help: true}
  }

  if (first === 'linked' && argv.length === 1) {
    return {ok: true, mode: 'linked'}
  }

  if (first === 'query') {
    if (query === undefined || query.trim() === '' || argv.length !== 2) {
      return {ok: false}
    }
    return {ok: true, mode: 'query', query}
  }

  return {ok: false}
}

// ---------------------------------------------------------------------------
// Testable CLI runner
// ---------------------------------------------------------------------------

const inferAttemptedMode = (argv: readonly string[]): ExpandMode => (argv[0] === 'linked' ? 'linked' : 'query')

export interface WikiContextExpandCliDeps {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly readDir: (path: string) => Promise<{name: string; isFile: () => boolean}[]>
  readonly readFile: (path: string) => Promise<string>
  readonly writeStdout: (chunk: string) => void
  readonly writeStderr: (chunk: string) => void
}

export interface WikiContextExpandCliOutcome {
  readonly exitCode: number
  readonly result?: ExpandResult
}

/**
 * Testable CLI orchestration seam. Accepts argv/env/fs/output abstractions so the full
 * dispatch path — argv parsing, help, corpus loading, private-token loading, mode
 * dispatch, and top-level error handling — can be exercised without a real subprocess.
 *
 * Exit codes: bad argv is the only failure exit (this tool is an optional retrieval
 * step; every other empty state, including token-load failure and unexpected errors,
 * still exits success so it never breaks the calling workflow).
 */
export async function runWikiContextExpandCli(deps: WikiContextExpandCliDeps): Promise<WikiContextExpandCliOutcome> {
  try {
    const argvResult = parseArgv(deps.argv)

    if (argvResult.help === true) {
      deps.writeStderr(USAGE)
      return {exitCode: 0}
    }

    if (!argvResult.ok || argvResult.mode === undefined) {
      const badArgsResult = EMPTY_RESULT(inferAttemptedMode(deps.argv), 'bad-args')
      deps.writeStderr('wiki-context-expand:error:bad-args\n')
      deps.writeStdout(`${JSON.stringify(badArgsResult)}\n`)
      return {exitCode: 1, result: badArgsResult}
    }

    if (argvResult.mode === 'query') {
      const validation = validateQuery(argvResult.query ?? '')
      if (!validation.valid) {
        const result = EMPTY_RESULT('query', 'invalid-query')
        deps.writeStderr('wiki-context-expand:query:empty:invalid-query\n')
        deps.writeStdout(`${JSON.stringify(result)}\n`)
        return {exitCode: 0, result}
      }
    }

    const [files, tokenLoad] = await Promise.all([
      loadWikiFilesFromDisk(deps.readDir, deps.readFile),
      loadPrivateTokens(deps.readFile),
    ])
    const privateTokens = tokenLoad.loaded ? tokenLoad.tokens : null
    if (!tokenLoad.loaded) {
      deps.writeStderr('wiki-context-expand:warn:private-token-load-failed\n')
    }

    let result: ExpandResult
    if (argvResult.mode === 'linked') {
      const handoff = await loadHandoff(deps.env.WIKI_CONTEXT_HANDOFF_PATH, deps.readFile)
      result = assembleExpandedContext({
        mode: 'linked',
        files,
        handoffStatus: handoff.status,
        baselineSelectedPaths: handoff.selectedPaths,
        privateTokens,
      })
    } else {
      result = assembleExpandedContext({
        mode: 'query',
        files,
        query: argvResult.query ?? '',
        privateTokens,
      })
    }

    deps.writeStderr(
      result.status === 'empty'
        ? `wiki-context-expand:${result.mode}:empty:${result.reason}\n`
        : `wiki-context-expand:${result.mode}:ok\n`,
    )
    deps.writeStdout(`${JSON.stringify(result)}\n`)
    return {exitCode: 0, result}
  } catch {
    const fallback: ExpandResult = {
      status: 'empty',
      mode: inferAttemptedMode(deps.argv),
      selectedPaths: [],
      excerpt: '',
      byteLength: 0,
      pageCount: 0,
      reason: 'no-corpus',
    }
    deps.writeStderr('wiki-context-expand:error:unexpected\n')
    deps.writeStdout(`${JSON.stringify(fallback)}\n`)
    return {exitCode: 0, result: fallback}
  }
}

// ---------------------------------------------------------------------------
// I/O shell
// ---------------------------------------------------------------------------

async function loadWikiFilesFromDisk(
  readDirFn: WikiContextExpandCliDeps['readDir'],
  readFileFn: WikiContextExpandCliDeps['readFile'],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries
    try {
      entries = await readDirFn(directoryPath)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }
      const path = `${directoryPath}/${entry.name}`
      try {
        files[path] = await readFileFn(path)
      } catch {
        // skip unreadable file — corpus loading is best-effort per-file
      }
    }
  }

  return files
}

async function loadPrivateTokens(readFileFn: WikiContextExpandCliDeps['readFile']): Promise<PrivateTokenLoadResult> {
  let content: string | null
  try {
    content = await readFileFn('metadata/repos.yaml')
  } catch {
    content = null
  }
  return parsePrivateTokensFromReposYaml(content)
}

async function loadHandoff(
  handoffPath: string | undefined,
  readFileFn: WikiContextExpandCliDeps['readFile'],
): Promise<HandoffParseResult> {
  if (handoffPath === undefined || handoffPath === '') {
    return {status: 'missing', selectedPaths: []}
  }

  let content: string
  try {
    content = await readFileFn(handoffPath)
  } catch {
    return {status: 'missing', selectedPaths: []}
  }

  return parseHandoffContent(content)
}

async function nodeReadDir(path: string): Promise<{name: string; isFile: () => boolean}[]> {
  return readdir(path, {withFileTypes: true})
}

async function nodeReadFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

async function main(): Promise<void> {
  const outcome = await runWikiContextExpandCli({
    argv: process.argv.slice(2),
    env: process.env,
    readDir: nodeReadDir,
    readFile: nodeReadFile,
    writeStdout: chunk => process.stdout.write(chunk),
    writeStderr: chunk => process.stderr.write(chunk),
  })
  process.exitCode = outcome.exitCode
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
