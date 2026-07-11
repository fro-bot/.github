/**
 * Detect entrypoint for the improvement-metric loop.
 *
 * Pure core `computeMetrics` classifies solution docs (codified-class anchors) and
 * proposal issues (candidate recurrence events) once, then derives discovery,
 * confirmed-recidivism, backlog, the prior-window delta, and the deterministic
 * report state. The I/O shell (`main`) fetches the structured sources, reads the
 * prior report's tick-state, and writes a counts-only digest + edge list.
 *
 * O8-native candidate scorer: `scoreCandidateLink` is asymmetric by design — a
 * proposal issue carries only title + labels (no module/problem_type/tags
 * frontmatter), while a codified class carries title + tags + module. It matches
 * proposal title/label tokens against the class's title/tag/module tokens. It does
 * NOT import the private, symmetric `computeSourceOverlapScore` from
 * capture-patterns-cluster.ts, which assumes both sides carry the same structured
 * frontmatter.
 *
 * Strip-only safe: no enums, namespaces, parameter properties, or `any`.
 */

import type {Dirent} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import process from 'node:process'

import {parse} from 'yaml'
import {
  buildClassKey,
  buildEdgeFingerprint,
  IMPROVEMENT_METRICS_REPORT_LABEL,
  recoverPriorTickState,
  type ClassKeyFrontmatter,
  type ReportState,
} from './improvement-metrics-core.ts'

// Re-exported for callers (and tests) that import tick-state recovery from
// the detect module; the implementation now lives in improvement-metrics-core.ts
// so detect and report cannot drift.
export {recoverPriorTickState} from './improvement-metrics-core.ts'

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Rolling window (days) discovery/candidate detection is evaluated over. */
export const WINDOW_DAYS = 90

/** Minimum codified-class corpus size required before rendering an interpreted state. */
export const MIN_ANCHORS = 3

/** Minimum in-window discovery count required before rendering an interpreted state. */
export const MIN_DISCOVERY = 2

/** Oldest-unticked-candidate age (days) above which the backlog is considered stale. */
export const STALE_AGE_DAYS = 14

/**
 * Minimum `scoreCandidateLink` score (inclusive) for an (event -> class) edge to
 * surface. Tokenizer awards 10 points per shared title token, 15 per shared tag
 * match, and 20 per shared module-token match (see `scoreCandidateLink`). A single
 * shared title token (10) never clears this bar alone — it must combine with a
 * second shared token or a stronger tag/module match, matching the "strong-field
 * token match" requirement below.
 */
export const SCORE_THRESHOLD = 20

// ---------------------------------------------------------------------------
// Tokenizer (mirrors capture-patterns-synthesis.ts tokenizeTitle)
// ---------------------------------------------------------------------------

const TITLE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'do',
  'does',
  'fix',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
])

/** Tokenize a title/label into lowercase, stopword-filtered word tokens (>= 3 chars). */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(token => token.length >= 3 && !TITLE_STOPWORDS.has(token))
}

function moduleTokens(module: string): string[] {
  return module
    .toLowerCase()
    .split(/[/.\-_]/u)
    .filter(t => t.length >= 3)
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A codified-class anchor: solution-doc identity frontmatter + immutable git add-date. */
export interface SolutionDocRecord {
  frontmatter: ClassKeyFrontmatter
  /** Title used for candidate-scoring token overlap; solution-doc frontmatter `title` or filename stem. */
  title: string
  /** Tags used for candidate-scoring token/exact overlap; solution-doc frontmatter `tags`. */
  tags: string[]
  /** Immutable git first-commit (add) date of the doc, ISO 8601. NEVER frontmatter `date`. */
  gitAddDate: string
}

/** A proposal issue eligible as a candidate recurrence event. */
export interface ProposalEvent {
  id: string
  title: string
  labels: string[]
  createdAt: string
  /** Public, dereferenceable issue URL. */
  url: string
}

/** A recovered edge fingerprint + its tick-state from the prior report body. */
export type PriorTickState = ReadonlySet<string>

export interface DetectEdge {
  fingerprint: string
  classKey: string
  eventId: string
  eventUrl: string
  eventCreatedAt: string
  ticked: boolean
}

export interface ComputeMetricsInput {
  solutionDocs: readonly SolutionDocRecord[]
  proposalEvents: readonly ProposalEvent[]
  priorTickState: PriorTickState
  now: Date
  windowDays?: number
  minAnchors?: number
  minDiscovery?: number
  staleAgeDays?: number
  scoreThreshold?: number
}

export interface MetricsDigest {
  windowDays: number
  anchors: number
  discovery: number
  priorDiscovery: number
  confirmedRecidivism: number
  backlogCount: number
  oldestPendingAgeDays: number | null
  state: ReportState
}

export interface ComputeMetricsResult {
  digest: MetricsDigest
  edges: DetectEdge[]
}

// ---------------------------------------------------------------------------
// O8-native asymmetric candidate scorer
// ---------------------------------------------------------------------------

export interface CandidateScoreResult {
  score: number
  strongMatch: boolean
}

/**
 * Score a proposal event against a codified class over honestly-asymmetric signals:
 * the event has only title + labels; the class has title + tags + module.
 *
 * Scoring (deterministic, additive):
 * - Each shared title token (event title tokens vs class title tokens): 10 points.
 * - Each event label matching a class tag (case-insensitive exact match): 15 points.
 * - Each event title token matching a class module token: 20 points.
 *
 * "Strong-field token match" requires cross-signal correlation, not merely
 * generic-vocabulary overlap in a single field:
 * - a label/tag exact match, OR
 * - at least 3 distinct shared title tokens (enough specific vocabulary overlap
 *   to be self-evidently the same topic, not just 1-2 generic words), OR
 * - at least 1 shared title token AND at least 1 shared module token (the
 *   title hit is corroborated by an independent module-identity signal).
 *
 * One or two shared title tokens alone are never strong — generic domain
 * vocabulary ("status", "drift", "detection") clears the numeric score
 * threshold far too easily without indicating a real relationship (this is how
 * four unrelated "plan-consistency drift" proposals matched a wiki-ingest
 * silent-failures doc on nothing but "status"/"drift"). Module-token overlap
 * alone is likewise never strong (unchanged from before).
 *
 * Pure function: no I/O.
 */
export function scoreCandidateLink(event: ProposalEvent, classDoc: SolutionDocRecord): CandidateScoreResult {
  const eventTitleTokens = new Set(tokenizeText(event.title))
  const classTitleTokens = new Set(tokenizeText(classDoc.title))
  const classTags = new Set(classDoc.tags.map(t => t.toLowerCase()))
  const classModuleTokens = new Set(moduleTokens(classDoc.frontmatter.module ?? ''))
  const eventLabels = new Set(event.labels.map(l => l.toLowerCase()))

  let score = 0
  let titleTokenMatches = 0
  let tagMatch = false
  let moduleTokenMatch = false

  for (const token of eventTitleTokens) {
    if (classTitleTokens.has(token)) {
      score += 10
      titleTokenMatches += 1
    }
  }

  for (const label of eventLabels) {
    if (classTags.has(label)) {
      score += 15
      tagMatch = true
    }
  }

  for (const token of eventTitleTokens) {
    if (classModuleTokens.has(token)) {
      score += 20
      moduleTokenMatch = true
    }
  }

  const strongMatch = tagMatch || titleTokenMatches >= 3 || (titleTokenMatches >= 1 && moduleTokenMatch)

  return {score, strongMatch}
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

function inWindow(dateIso: string, start: Date, end: Date): boolean {
  const ms = new Date(dateIso).getTime()
  if (Number.isNaN(ms)) return false
  return ms >= start.getTime() && ms <= end.getTime()
}

function distinctClassKeysInWindow(solutionDocs: readonly SolutionDocRecord[], start: Date, end: Date): Set<string> {
  const keys = new Set<string>()
  for (const doc of solutionDocs) {
    if (inWindow(doc.gitAddDate, start, end)) {
      keys.add(buildClassKey(doc.frontmatter))
    }
  }
  return keys
}

/**
 * Compute the improvement-metric digest + edge list from injected, already-loaded
 * sources and the prior report's tick-state. Pure function: no I/O.
 */
export function computeMetrics(input: ComputeMetricsInput): ComputeMetricsResult {
  const windowDays = input.windowDays ?? WINDOW_DAYS
  const minAnchors = input.minAnchors ?? MIN_ANCHORS
  const minDiscovery = input.minDiscovery ?? MIN_DISCOVERY
  const staleAgeDays = input.staleAgeDays ?? STALE_AGE_DAYS
  const scoreThreshold = input.scoreThreshold ?? SCORE_THRESHOLD

  const now = input.now
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  const windowStart = new Date(now.getTime() - windowMs)
  const priorWindowStart = new Date(now.getTime() - 2 * windowMs)
  const priorWindowEnd = windowStart

  const anchors = input.solutionDocs.length
  const discovery = distinctClassKeysInWindow(input.solutionDocs, windowStart, now).size
  const priorDiscovery = distinctClassKeysInWindow(input.solutionDocs, priorWindowStart, priorWindowEnd).size

  const belowFloor = anchors < minAnchors || discovery < minDiscovery

  const edges: DetectEdge[] = []
  let confirmedRecidivism = 0

  if (!belowFloor) {
    for (const event of input.proposalEvents) {
      if (!inWindow(event.createdAt, windowStart, now)) continue
      for (const classDoc of input.solutionDocs) {
        // Temporal founding-evidence rule: a recurrence means the class recurred AFTER it
        // was codified. An event at or before the class doc's git add-date is founding
        // evidence (often the very proposal the doc was authored from) — never a candidate.
        const eventMs = new Date(event.createdAt).getTime()
        const classAddMs = new Date(classDoc.gitAddDate).getTime()
        if (Number.isNaN(eventMs) || Number.isNaN(classAddMs) || eventMs <= classAddMs) continue

        const {score, strongMatch} = scoreCandidateLink(event, classDoc)
        if (score < scoreThreshold || !strongMatch) continue

        const classKey = buildClassKey(classDoc.frontmatter)
        const fingerprint = buildEdgeFingerprint(classKey, event.id)
        const ticked = input.priorTickState.has(fingerprint)
        if (ticked) confirmedRecidivism += 1

        edges.push({
          fingerprint,
          classKey,
          eventId: event.id,
          eventUrl: event.url,
          eventCreatedAt: event.createdAt,
          ticked,
        })
      }
    }
  }

  const backlogEdges = edges.filter(edge => !edge.ticked)
  const backlogCount = backlogEdges.length
  let oldestPendingAgeDays: number | null = null
  if (backlogEdges.length > 0) {
    let oldestMs = Number.POSITIVE_INFINITY
    for (const edge of backlogEdges) {
      const ms = new Date(edge.eventCreatedAt).getTime()
      if (!Number.isNaN(ms) && ms < oldestMs) oldestMs = ms
    }
    oldestPendingAgeDays =
      oldestMs === Number.POSITIVE_INFINITY ? null : (now.getTime() - oldestMs) / (24 * 60 * 60 * 1000)
  }

  let state: ReportState
  if (belowFloor) {
    state = 'insufficient-signal'
  } else if (confirmedRecidivism > 0 && confirmedRecidivism >= discovery) {
    state = 'failing'
  } else if (discovery < priorDiscovery || (oldestPendingAgeDays !== null && oldestPendingAgeDays > staleAgeDays)) {
    state = 'ambiguous'
  } else {
    state = 'healthy'
  }

  const digest: MetricsDigest = {
    windowDays,
    anchors,
    discovery,
    priorDiscovery,
    confirmedRecidivism,
    backlogCount,
    oldestPendingAgeDays,
    state,
  }

  return {digest, edges}
}

// ---------------------------------------------------------------------------
// I/O shell
// ---------------------------------------------------------------------------

/** Canonical solution-doc subdirectories scanned for codified-class anchors. */
const SOLUTIONS_SUBDIRS = ['best-practices', 'security-issues', 'runtime-errors', 'workflow-issues'] as const

/** Source labels eligible for proposal-event collection. */
const PROPOSAL_SOURCE_LABELS = ['learning-proposal', 'pattern-proposal', 'status-truth'] as const

/** Minimal shape of an issue returned by `paginate(listForRepo)`. */
interface RawProposalIssue {
  readonly number: number
  readonly title?: string | null
  readonly created_at?: string
  readonly html_url?: string
  readonly labels?: readonly (string | {readonly name?: string | null})[]
}

/** Minimal shape of an issue returned by `listForRepo` for the prior report lookup. */
interface RawReportIssue {
  readonly number: number
  readonly body?: string | null
}

/** Narrow injected Octokit-like client interface for testability. */
export interface ImprovementMetricsOctokitClient {
  readonly paginate: (fn: unknown, params: Record<string, unknown>) => Promise<RawProposalIssue[]>
  readonly rest: {
    readonly issues: {
      readonly listForRepo: (params: {
        owner: string
        repo: string
        labels?: string
        state: 'open' | 'closed' | 'all'
        per_page?: number
      }) => Promise<{data: RawReportIssue[]}>
    }
  }
}

/** Counts-only result JSON written to stdout. */
export interface DetectResult {
  windowDays: number
  anchors: number
  discovery: number
  priorDiscovery: number
  confirmedRecidivism: number
  backlogCount: number
  oldestPendingAgeDays: number | null
  state: ReportState | null
  edgeCount: number
  tokenLoadFailure: boolean
  scanFailure: boolean
  gitHistoryUnavailable: boolean
}

const EMPTY_DIGEST: MetricsDigest = {
  windowDays: WINDOW_DAYS,
  anchors: 0,
  discovery: 0,
  priorDiscovery: 0,
  confirmedRecidivism: 0,
  backlogCount: 0,
  oldestPendingAgeDays: null,
  state: 'insufficient-signal',
}

function emptyDetectResult(): DetectResult {
  return {
    windowDays: WINDOW_DAYS,
    anchors: 0,
    discovery: 0,
    priorDiscovery: 0,
    confirmedRecidivism: 0,
    backlogCount: 0,
    oldestPendingAgeDays: null,
    state: null,
    edgeCount: 0,
    tokenLoadFailure: false,
    scanFailure: false,
    gitHistoryUnavailable: false,
  }
}

/**
 * Fetch proposal issues across the closed set of eligible source labels via
 * `octokit.paginate(listForRepo, {labels, state:'all'})`, one paginated call per
 * label.
 */
export async function fetchProposalEventsFromRepo(
  octokit: ImprovementMetricsOctokitClient,
  owner: string,
  repo: string,
): Promise<ProposalEvent[]> {
  const events: ProposalEvent[] = []
  for (const label of PROPOSAL_SOURCE_LABELS) {
    const raw = await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'all',
      labels: label,
      per_page: 100,
    })
    for (const issue of raw) {
      events.push({
        id: String(issue.number),
        title: issue.title ?? '',
        labels: (issue.labels ?? []).map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
        createdAt: issue.created_at ?? '',
        url: issue.html_url ?? `https://github.com/${owner}/${repo}/issues/${issue.number}`,
      })
    }
  }
  return events
}

/** Result of loading solution-doc file contents from disk. */
export interface LoadSolutionDocFilesResult {
  files: Record<string, string>
  readFailures: number
}

/** Load solution-doc file contents from disk, under the canonical subdirectories. */
export async function loadSolutionDocFilesFromDisk(
  writeStderr: (message: string) => void = message => process.stderr.write(message),
): Promise<LoadSolutionDocFilesResult> {
  const files: Record<string, string> = {}
  let readFailures = 0

  for (const subdir of SOLUTIONS_SUBDIRS) {
    const dirPath = `docs/solutions/${subdir}`
    let entries: Dirent[]
    try {
      entries = await readdir(dirPath, {withFileTypes: true})
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = `${dirPath}/${entry.name}`
      try {
        files[path] = await readFile(path, 'utf8')
      } catch {
        readFailures += 1
        writeStderr(`improvement-metrics-detect: could not read file (path: ${path})\n`)
      }
    }
  }

  return {files, readFailures}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null) return {}
  const frontmatterText = match[1]
  if (frontmatterText === undefined) return {}
  let parsed: unknown
  try {
    parsed = parse(frontmatterText)
  } catch {
    return {}
  }
  return isRecord(parsed) ? parsed : {}
}

/**
 * Obtain the git first-commit (add) date for every solution-doc path, via one
 * `git log --diff-filter=A --follow --format=%aI` pass over `docs/solutions/`.
 *
 * Fail-closed: if git history is unavailable/shallow such that a path's add-date
 * cannot be resolved for any path that exists on disk, throws so the caller can
 * set `gitHistoryUnavailable` and fail closed rather than falling back to
 * frontmatter `date`.
 */
export function loadGitAddDates(
  paths: readonly string[],
  execFileSyncFn: typeof execFileSync = execFileSync,
): Map<string, string> {
  const addDates = new Map<string, string>()
  for (const path of paths) {
    const stdout = execFileSyncFn('git', ['log', '--diff-filter=A', '--follow', '--format=%aI', '--', path], {
      encoding: 'utf8',
    })
    const lines = stdout
      .toString()
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    const earliest = lines.at(-1)
    if (earliest === undefined) {
      throw new Error(`improvement-metrics-detect: no git add-date resolvable for ${path}`)
    }
    addDates.set(path, earliest)
  }
  return addDates
}

function buildSolutionDocRecords(files: Record<string, string>, addDates: Map<string, string>): SolutionDocRecord[] {
  const records: SolutionDocRecord[] = []
  for (const [path, content] of Object.entries(files)) {
    const frontmatter = splitFrontmatter(content)
    const addDate = addDates.get(path)
    if (addDate === undefined) continue
    const title = typeof frontmatter.title === 'string' ? frontmatter.title : path
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((t): t is string => typeof t === 'string')
      : []
    records.push({
      frontmatter: {
        module: typeof frontmatter.module === 'string' ? frontmatter.module : undefined,
        component: typeof frontmatter.component === 'string' ? frontmatter.component : undefined,
        problem_type: typeof frontmatter.problem_type === 'string' ? frontmatter.problem_type : undefined,
      },
      title,
      tags,
      gitAddDate: addDate,
    })
  }
  return records
}

async function fetchPriorTickState(
  octokit: ImprovementMetricsOctokitClient,
  owner: string,
  repo: string,
): Promise<Set<string>> {
  const response = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    labels: IMPROVEMENT_METRICS_REPORT_LABEL,
    per_page: 10,
  })
  const issue = response.data[0]
  if (issue === undefined || issue.body === null || issue.body === undefined) return new Set()
  return recoverPriorTickState(issue.body)
}

/**
 * Write the counts-only digest + fingerprint edge list to
 * `IMPROVEMENT_METRICS_DIGEST_PATH`. Fail-closed: missing/empty env var is a
 * configuration error, not a silent no-op.
 */
export async function writeImprovementMetricsDigestFile(
  digest: MetricsDigest,
  edges: readonly DetectEdge[],
): Promise<void> {
  const {writeFile} = await import('node:fs/promises')
  const digestPath = process.env.IMPROVEMENT_METRICS_DIGEST_PATH
  if (digestPath === undefined || digestPath === '') {
    throw new Error('improvement-metrics-detect: IMPROVEMENT_METRICS_DIGEST_PATH is required to persist the digest')
  }
  await writeFile(digestPath, `${JSON.stringify({digest, edges})}\n`, {flag: 'w'})
}

/**
 * CLI entry point for the detect step: token-load-before-API fail-closed ordering,
 * fetch structured sources + prior tick-state, compute the digest via the pure
 * core, and write the counts-only digest to `IMPROVEMENT_METRICS_DIGEST_PATH`.
 *
 * Best-effort: any unexpected error falls back to an empty digest and exit 0.
 */
async function main(): Promise<void> {
  const owner = 'fro-bot'
  const repo = '.github'

  const result = emptyDetectResult()

  try {
    const {loadPrivateTokensFromDisk} = await import('./capture-learnings-privacy.ts')
    const {loadRedactedCanonicalIdsFromDisk} = await import('./status-truth-proposals.ts')

    try {
      await Promise.all([loadPrivateTokensFromDisk(), loadRedactedCanonicalIdsFromDisk()])
    } catch {
      result.tokenLoadFailure = true
      await writeImprovementMetricsDigestFile(EMPTY_DIGEST, []).catch(() => undefined)
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }

    const {createOctokitFromEnv} = await import('./capture-learnings-harvest.ts')
    const octokit = (await createOctokitFromEnv()) as unknown as ImprovementMetricsOctokitClient

    const [solutionDocFiles, proposalEvents, priorTickState] = await Promise.all([
      loadSolutionDocFilesFromDisk(),
      fetchProposalEventsFromRepo(octokit, owner, repo),
      fetchPriorTickState(octokit, owner, repo),
    ])

    let gitAddDates: Map<string, string>
    try {
      gitAddDates = loadGitAddDates(Object.keys(solutionDocFiles.files))
    } catch {
      result.gitHistoryUnavailable = true
      await writeImprovementMetricsDigestFile(EMPTY_DIGEST, []).catch(() => undefined)
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }

    const solutionDocs = buildSolutionDocRecords(solutionDocFiles.files, gitAddDates)

    const {digest, edges} = computeMetrics({
      solutionDocs,
      proposalEvents,
      priorTickState,
      now: new Date(),
    })

    result.windowDays = digest.windowDays
    result.anchors = digest.anchors
    result.discovery = digest.discovery
    result.priorDiscovery = digest.priorDiscovery
    result.confirmedRecidivism = digest.confirmedRecidivism
    result.backlogCount = digest.backlogCount
    result.oldestPendingAgeDays = digest.oldestPendingAgeDays
    result.state = digest.state
    result.edgeCount = edges.length

    await writeImprovementMetricsDigestFile(digest, edges)
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'unknown'
    process.stderr.write(`improvement-metrics-detect: unexpected error (${errorName}), falling back to empty digest\n`)
    result.scanFailure = true
    try {
      await writeImprovementMetricsDigestFile(EMPTY_DIGEST, [])
    } catch {
      // ignore
    }
  }

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
