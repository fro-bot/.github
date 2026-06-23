/**
 * Harvest merged PRs from this repo that required multiple rounds of Fro Bot review,
 * dedup against existing learning-proposal issues and docs/solutions/ docs,
 * cap the result, and emit an opaque candidate digest to $GITHUB_OUTPUT.
 *
 * Architecture: pure core (`buildCandidateDigest`) + I/O shell (`harvestCandidates` / `main`).
 * The pure core takes all data as injected inputs and is fully unit-testable.
 * The I/O shell constructs Octokit, fetches data, and calls the pure core.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {Dirent} from 'node:fs'
import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'
import {Octokit} from '@octokit/rest'
import {parse} from 'yaml'

import {
  isRecord,
  learningBodyHasPrivateLeak,
  loadPrivateTokensFromDisk,
  logDiffHasSecret,
  redactLogDiffSecrets,
} from './capture-learnings-privacy.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of days back from now to include merged PRs. */
const LOOKBACK_DAYS = 30

/**
 * Minimum number of Fro Bot substantive reviews (APPROVED | CHANGES_REQUESTED | DISMISSED)
 * for a PR to be a candidate. Requires at least 2 rounds of substantive engagement.
 */
const MIN_SUBSTANTIVE_REVIEW_ROUNDS = 2

/**
 * Minimum number of correction signals (DISMISSED | CHANGES_REQUESTED) from Fro Bot
 * for a PR to be a candidate. At least one correction round must have occurred.
 */
const MIN_CORRECTION_SIGNALS = 1

/** Maximum number of candidates to emit per run. */
const MAX_LEARNINGS_PER_RUN = 5

/**
 * Maximum total characters of review-prose excerpts per candidate.
 * Ranked by correction signal so the correction sentence is never clipped first.
 * Exported so tests can assert budget enforcement without hardcoding the value.
 */
export const MAX_EXCERPT_CHARS_PER_CANDIDATE = 1800

/** Label used to identify learning-proposal issues. */
export const LEARNING_PROPOSAL_LABEL = 'learning-proposal'

/**
 * Fro Bot reviewer logins to key review counting on.
 * A Set so it is easy to extend if the login ever changes.
 */
export const FRO_BOT_REVIEWER_LOGINS = new Set(['fro-bot'])

/**
 * PR label names that identify dependency-automation PRs.
 * PRs carrying any of these labels are excluded before review counting.
 */
export const DEPENDENCY_LABELS = new Set(['dependencies', 'renovate', 'dependencies:github-actions'])

/**
 * Minimum overlap score (inclusive) between a candidate's signals and an existing
 * solutions doc to trigger dedup. Exact problem_type match = 100 (always triggers).
 * Tag/module overlap is additive at 10 per shared token; threshold of 20 requires
 * at least 2 shared tokens before dedup fires — a single common tag (e.g. 'ci',
 * 'security') no longer triggers dedup on its own.
 */
const SOLUTIONS_OVERLAP_THRESHOLD = 20

const SOLUTIONS_ROOT = 'docs/solutions'
const SOLUTIONS_SUBDIRS = [
  'best-practices',
  'documentation-gaps',
  'integration-issues',
  'runtime-errors',
  'security-issues',
  'workflow-issues',
] as const

// ---------------------------------------------------------------------------
// Octokit derived type (never handwrite SDK interfaces)
// ---------------------------------------------------------------------------

export type OctokitClient = Octokit

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * Signals derived from a PR for solutions-dedup.
 * Derived from PR labels and title tokens — simple v1 heuristic.
 * Documented choice: using labels + title tokens avoids a `pulls.listFiles` call
 * per PR. Refine to file-path signals if dedup precision proves poor.
 */
export interface CandidateSignals {
  /** Top-level directory tokens from the PR title (e.g. 'scripts', 'workflows'). */
  titleTokens: string[]
  /** PR label names. */
  labels: string[]
}

/**
 * A candidate PR for a learning proposal — discriminated union on `trigger`.
 *
 * Both variants carry no owner, repo, or PR number. `signals` includes tokens derived
 * from the PR title and labels. The deterministic open step is the privacy chokepoint:
 * it scans the final authored body for private identifiers and blocks before posting.
 *
 * Design: top-level discriminated fields per variant (not a nested `evidence` block).
 * This keeps the diff minimal, preserves the existing ReviewCandidate shape exactly
 * (only adding `trigger`), and avoids over-engineering before Unit 3 adds CiFix evidence.
 */
export type Candidate = ReviewCandidate | CiFixCandidate

/**
 * A candidate sourced from a PR with multiple Fro Bot review rounds.
 *
 * `reviewExcerpts` carries privacy-scanned review prose (review bodies + line-level thread
 * comments), ranked by correction signal (CHANGES_REQUESTED / thread replies first) and
 * bounded to MAX_EXCERPT_CHARS_PER_CANDIDATE. Empty when enrichment was blocked by the
 * upstream privacy scan or when no prose was available. Array form gives the agent clearer
 * structure than a single concatenated string.
 */
export interface ReviewCandidate {
  trigger: 'review-heavy'
  mergeSha: string
  /**
   * Number of Fro Bot substantive review rounds (APPROVED | CHANGES_REQUESTED | DISMISSED).
   * Named `reviewRounds` to preserve the contract with the agent prompt in
   * capture-learnings.yaml, which references this field by name.
   */
  reviewRounds: number
  signals: CandidateSignals
  /**
   * Privacy-scanned review-prose excerpts, ranked by correction signal.
   * CHANGES_REQUESTED bodies and thread-comment bodies appear first (highest correction
   * signal); DISMISSED next; APPROVED boilerplate last. Truncated to
   * MAX_EXCERPT_CHARS_PER_CANDIDATE total. Empty when the upstream privacy scan blocked
   * the enriched content or when no non-empty prose was available.
   */
  reviewExcerpts: string[]
}

/**
 * A candidate sourced from a PR whose CI checks transitioned failed → passed before merge.
 *
 * Evidence fields carry the fixing diff (primary signal, always available) and a
 * best-effort failing-log excerpt. Both are privacy-scanned before reaching the digest.
 */
export interface CiFixCandidate {
  trigger: 'ci-fail-then-pass'
  mergeSha: string
  signals: CandidateSignals
  /** Name of the check that transitioned failed → passed. */
  failingCheckName: string
  /** SHA of the last commit where the check was in a failing conclusion. */
  lastFailingSha: string
  /** SHA of the first commit after lastFailingSha where the check is SUCCESS. */
  firstPassingSha: string
  /**
   * Diff excerpt between lastFailingSha and firstPassingSha, truncated to
   * MAX_EXCERPT_CHARS_PER_CANDIDATE. Empty string when no diff was available
   * (bare re-run candidates are dropped before this point).
   */
  diffExcerpt: string
  /**
   * Best-effort excerpt from the failing job log, ranked toward error lines.
   * '[failure log purged or unavailable]' when the log could not be fetched
   * (404/410 purged, no run found, or any other error).
   */
  logExcerpt?: string
}

/**
 * Harvest-stage counts threaded from `harvestCandidates` into the final telemetry.
 * Kept separate from the pure core so `buildCandidateDigest` remains I/O-free.
 */
export interface HarvestStageCounts {
  closedPrsFetched: number
  mergedPrsInLookback: number
  excludedAutomation: number
  multiRoundCandidates: number
  /** Number of PRs examined for CI fail→pass transition. */
  ciFixPrsExamined: number
  /** Number of CI-fix candidates found (transition detected + real diff). */
  ciFixCandidates: number
}

/** Counts-only telemetry returned by the pure core + harvest stage. */
export interface DigestTelemetry {
  closedPrsFetched: number
  mergedPrsInLookback: number
  excludedAutomation: number
  multiRoundCandidates: number
  /** Number of PRs examined for CI fail→pass transition. Threaded from HarvestStageCounts. */
  ciFixPrsExamined: number
  /** Number of CI-fix candidates found (transition detected + real diff). Threaded from HarvestStageCounts. */
  ciFixCandidates: number
  afterSeenDedup: number
  afterSolutionsDedup: number
  emitted: number
  /**
   * Number of candidates whose enriched content was dropped by the private-name scan.
   * The candidate itself is kept (title-only); only the enriched evidence is cleared.
   * Counts-only — no private names logged.
   */
  enrichmentBlocked: number
  /**
   * Number of candidates whose enriched content was dropped because it contained a
   * hard-secret shape (PAT, private key, credential-bearing connection string, etc.)
   * detected by `logDiffHasSecret` after `redactLogDiffSecrets` was applied.
   * Counts-only — no secret values logged.
   */
  enrichmentBlockedBySecret: number
}

/** Result of `buildCandidateDigest`. */
export interface CandidateDigest {
  candidates: Candidate[]
  telemetry: DigestTelemetry
}

/** Input to the pure core. */
export interface BuildCandidateDigestInput {
  /** Candidates from all sources (review-heavy + ci-fail-then-pass). */
  mergedPrs: Candidate[]
  /** Harvest-stage counts to thread into the final telemetry. */
  stageCounts: HarvestStageCounts
  /** merge_shas already represented by a learning-proposal issue. */
  openedLearningShas: Set<string>
  /** Existing solutions docs for solutions dedup. */
  solutionsDocs: SolutionDoc[]
  /** Maximum candidates to emit. */
  maxLearnings: number
  /**
   * Private identifier token set for the upstream enrichment scan.
   * Loaded from metadata/repos.yaml by main() before calling buildCandidateDigest.
   * If loadPrivateTokensFromDisk threw, main() passes an empty Set and clears all
   * reviewExcerpts before calling — so the pure core always receives a valid Set.
   * An empty Set means no tokens to match (no private repos configured), which is
   * distinct from "scan unavailable" — the latter is handled in main().
   */
  privateTokens: Set<string>
}

/** Minimal solutions doc shape needed for dedup. */
export interface SolutionDoc {
  path: string
  module: string
  tags: string[]
  problemType: string
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

/**
 * Build the immutable body marker that identifies a learning-proposal issue
 * with its source PR's merge commit SHA.
 */
export function buildMergeShaMarker(sha: string): string {
  return `<!-- captured-learning:merge_sha=${sha} -->`
}

/**
 * Parse the merge SHA from a learning-proposal issue body.
 * Returns the SHA string or null if the marker is absent or malformed.
 */
export function parseMergeShaMarker(body: string): string | null {
  const match = /<!-- captured-learning:merge_sha=([a-f0-9]{7,40}) -->/u.exec(body)
  return match?.[1] ?? null
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Build the opaque candidate digest from injected inputs.
 *
 * Steps:
 * 0. Within-run dedup: collapse to one candidate per mergeSha (a PR matching both triggers
 *    appears once per source); review-heavy takes precedence (R4).
 * 1. Drop candidates whose mergeSha is already in openedLearningShas (seen-set dedup).
 * 2. Drop candidates whose signals strongly overlap an existing solutions doc (solutions dedup).
 * 3. Cap to maxLearnings.
 * 4. Upstream privacy scan: for each candidate's reviewExcerpts, scan with the private
 *    token set. On a hit, clear reviewExcerpts (drop enriched content, keep the candidate
 *    title-only) and increment enrichmentBlocked. Never logs private names — counts only.
 * 5. Return candidates + counts-only telemetry (harvest stage counts + dedup stage counts
 *    + enrichmentBlocked).
 *
 * No I/O. Fully unit-testable. The private token set is injected so the scan is pure.
 */
export function buildCandidateDigest(input: BuildCandidateDigestInput): CandidateDigest {
  // Within-run dedup: a PR that matched more than one trigger (e.g. review-heavy AND
  // ci-fail-then-pass) appears once per source in mergedPrs. Collapse to one candidate per
  // mergeSha so a single PR yields a single learning-proposal (R4). Precedence: review-heavy
  // wins — review prose is the richer signal when a PR matched both.
  const byMergeSha = new Map<string, Candidate>()
  for (const pr of input.mergedPrs) {
    const existing = byMergeSha.get(pr.mergeSha)
    if (existing === undefined || (existing.trigger !== 'review-heavy' && pr.trigger === 'review-heavy')) {
      byMergeSha.set(pr.mergeSha, pr)
    }
  }
  const deduped = [...byMergeSha.values()]

  // drop already-proposed merge SHAs
  const afterSeenDedup = deduped.filter(pr => !input.openedLearningShas.has(pr.mergeSha))

  // drop candidates whose signals overlap an existing solutions doc
  const afterSolutionsDedup = afterSeenDedup.filter(pr => !overlapsAnySolutionsDoc(pr.signals, input.solutionsDocs))

  // cap to maxLearnings
  const capped = afterSolutionsDedup.slice(0, input.maxLearnings)

  // upstream privacy scan: scan each candidate's evidence text fail-closed.
  //
  // Privacy-ordering invariant: scan the already-truncated evidence text (truncation
  // happens in the I/O shell before this pure core is called). Never move truncation
  // after the scan — scanning a token and then truncating around it could leave a
  // surviving tail that escapes the gate.
  //
  // For ReviewCandidate:
  //   1. Redact structural secrets (paths, hostnames, Bearer tokens) via redactLogDiffSecrets.
  //   2. If learningBodyHasPrivateLeak (private repo name) OR logDiffHasSecret (hard secret)
  //      still true after redaction → clear reviewExcerpts + increment enrichmentBlockedBySecret.
  //   3. Otherwise use the redacted excerpts.
  //
  // For CiFixCandidate (Unit 3 placeholder):
  //   Evidence fields are not yet populated; no scan needed until Unit 3 adds them.
  let enrichmentBlocked = 0
  let enrichmentBlockedBySecret = 0
  const candidates = capped.map(pr => {
    if (pr.trigger === 'review-heavy') {
      if (pr.reviewExcerpts.length === 0) return pr

      // Step 1: redact structural secrets from the already-truncated excerpts
      const redactedExcerpts = pr.reviewExcerpts.map(e => redactLogDiffSecrets(e))
      const redactedText = redactedExcerpts.join('\n')

      // Step 2: check for private-name leak or residual hard secret after redaction
      const hasPrivateLeak = learningBodyHasPrivateLeak(redactedText, input.privateTokens)
      const hasResidualSecret = logDiffHasSecret(redactedText)

      if (hasPrivateLeak) {
        // Private-name hit: clear enriched content, keep candidate title-only
        enrichmentBlocked++
        return {...pr, reviewExcerpts: []}
      }
      if (hasResidualSecret) {
        // Hard-secret residual after redaction: clear enriched content
        enrichmentBlockedBySecret++
        return {...pr, reviewExcerpts: []}
      }

      // Step 3: use the redacted excerpts (structural secrets replaced with [REDACTED])
      return {...pr, reviewExcerpts: redactedExcerpts}
    }

    // CiFixCandidate: scan and redact diffExcerpt + logExcerpt (R3/R3a).
    //
    // Privacy-ordering invariant: diffExcerpt and logExcerpt are already truncated
    // to budget in the I/O shell before this pure core is called. Never move
    // truncation after the scan.
    //
    // Steps:
    // 1. Redact structural secrets (paths, hostnames, Bearer tokens) from both fields.
    // 2. If private-name leak OR residual hard secret after redaction → clear both
    //    evidence fields (drop enriched content, keep candidate title-only) and
    //    increment the appropriate counter.
    // 3. Otherwise use the redacted values.
    if (pr.trigger === 'ci-fail-then-pass') {
      const rawDiff = pr.diffExcerpt
      const rawLog = pr.logExcerpt ?? ''

      // Step 1: redact structural secrets (including failingCheckName)
      const redactedDiff = redactLogDiffSecrets(rawDiff)
      const redactedLog = rawLog === '' ? rawLog : redactLogDiffSecrets(rawLog)
      const redactedCheckName = redactLogDiffSecrets(pr.failingCheckName)
      const combinedText = `${redactedDiff}\n${redactedLog}\n${redactedCheckName}`

      // Step 2: check for private-name leak or residual hard secret
      const hasPrivateLeak = learningBodyHasPrivateLeak(combinedText, input.privateTokens)
      const hasResidualSecret = logDiffHasSecret(combinedText)

      if (hasPrivateLeak) {
        enrichmentBlocked++
        // Clear failingCheckName too — it may contain the private name that triggered the block
        return {...pr, failingCheckName: '[REDACTED]', diffExcerpt: '', logExcerpt: undefined}
      }
      if (hasResidualSecret) {
        enrichmentBlockedBySecret++
        // Clear failingCheckName too — it may contain the secret that triggered the block
        return {...pr, failingCheckName: '[REDACTED]', diffExcerpt: '', logExcerpt: undefined}
      }

      // Step 3: use the redacted values (including redacted failingCheckName)
      const result: CiFixCandidate = {...pr, diffExcerpt: redactedDiff, failingCheckName: redactedCheckName}
      if (redactedLog !== '') {
        return {...result, logExcerpt: redactedLog}
      }
      return result
    }

    return pr
  })

  return {
    candidates,
    telemetry: {
      ...input.stageCounts,
      afterSeenDedup: afterSeenDedup.length,
      afterSolutionsDedup: afterSolutionsDedup.length,
      emitted: candidates.length,
      enrichmentBlocked,
      enrichmentBlockedBySecret,
    },
  }
}

/**
 * Apply fail-closed enrichment scan availability to a list of candidates.
 *
 * When `scanAvailable` is false (private token load failed), all enriched evidence
 * is cleared so no unscanned content reaches the digest. For ReviewCandidate, this
 * clears `reviewExcerpts`. For CiFixCandidate, this clears `diffExcerpt` and
 * `logExcerpt`. When `scanAvailable` is true, candidates are returned unchanged.
 *
 * Pure function: no I/O, fully unit-testable. Extracted so the fail-closed
 * composition can be tested independently of the I/O shell.
 */
export function applyEnrichmentScanAvailability(candidates: Candidate[], scanAvailable: boolean): Candidate[] {
  if (scanAvailable) return candidates
  return candidates.map(c => {
    if (c.trigger === 'review-heavy') {
      return {...c, reviewExcerpts: [] as string[]}
    }
    if (c.trigger === 'ci-fail-then-pass') {
      return {...c, diffExcerpt: '', logExcerpt: undefined}
    }
    return c
  })
}

/**
 * Returns true if the candidate's signals overlap any existing solutions doc
 * above the SOLUTIONS_OVERLAP_THRESHOLD.
 *
 * Overlap scoring:
 * - Exact problem_type match: 100 points (always triggers dedup)
 * - Each shared tag token: 10 points
 * - Each shared module token: 10 points
 */
function overlapsAnySolutionsDoc(signals: CandidateSignals, docs: SolutionDoc[]): boolean {
  const candidateTokens = new Set([
    ...signals.labels.map(l => l.toLowerCase()),
    ...signals.titleTokens.map(t => t.toLowerCase()),
  ])

  for (const doc of docs) {
    const score = computeOverlapScore(candidateTokens, doc)
    if (score >= SOLUTIONS_OVERLAP_THRESHOLD) {
      return true
    }
  }
  return false
}

function computeOverlapScore(candidateTokens: Set<string>, doc: SolutionDoc): number {
  let score = 0

  // Exact problem_type match — strong signal
  if (doc.problemType !== '' && candidateTokens.has(doc.problemType.toLowerCase())) {
    score += 100
  }

  // Tag overlap
  for (const tag of doc.tags) {
    if (candidateTokens.has(tag.toLowerCase())) {
      score += 10
    }
  }

  // Module token overlap (split on path separators and dots)
  const moduleTokens = doc.module
    .toLowerCase()
    .split(/[/.\-_]/u)
    .filter(t => t.length >= 3)
  for (const token of moduleTokens) {
    if (candidateTokens.has(token)) {
      score += 10
    }
  }

  return score
}

// ---------------------------------------------------------------------------
// Frontmatter parser (replicated from solutions-query.ts — not exported there)
// ---------------------------------------------------------------------------

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

function collectSolutionDocs(files: Record<string, string>): SolutionDoc[] {
  const docs: SolutionDoc[] = []

  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(`${SOLUTIONS_ROOT}/`) || !path.endsWith('.md')) {
      continue
    }

    let frontmatter: Record<string, unknown>

    try {
      const parsed = splitFrontmatter(content)
      frontmatter = parsed.frontmatter
    } catch {
      continue
    }

    docs.push({
      path,
      module: typeof frontmatter.module === 'string' ? frontmatter.module : '',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === 'string') : [],
      problemType: typeof frontmatter.problem_type === 'string' ? frontmatter.problem_type : '',
    })
  }

  return docs
}

// ---------------------------------------------------------------------------
// Disk loader for solutions docs
// ---------------------------------------------------------------------------

async function loadSolutionsFilesFromDisk(): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  for (const subdir of SOLUTIONS_SUBDIRS) {
    const dirPath = `${SOLUTIONS_ROOT}/${subdir}`
    let entries: Dirent[]

    try {
      entries = await readdir(dirPath, {withFileTypes: true})
    } catch {
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
        process.stderr.write(`capture-learnings-harvest: could not read file (path: ${path})\n`)
      }
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Digest file writer + GITHUB_OUTPUT writer
// ---------------------------------------------------------------------------

/**
 * Write the full CandidateDigest ({candidates, telemetry}) as JSON to the path
 * specified by CAPTURE_LEARNINGS_DIGEST_PATH. This eliminates the shell-injection vector
 * that existed when the digest was echoed via GITHUB_OUTPUT multiline syntax.
 */
async function writeDigestFile(digest: CandidateDigest): Promise<void> {
  const digestPath = process.env.CAPTURE_LEARNINGS_DIGEST_PATH
  if (digestPath !== undefined && digestPath !== '') {
    await writeFile(digestPath, `${JSON.stringify(digest)}\n`, {flag: 'w'})
  }
}

// ---------------------------------------------------------------------------
// Octokit constructor helpers
// ---------------------------------------------------------------------------

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  if (typeof Octokit !== 'function') {
    throw new TypeError('Failed to load @octokit/rest Octokit constructor')
  }
  return Octokit as OctokitConstructor
}

export async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    throw new Error('capture-learnings-harvest requires GITHUB_TOKEN in the environment')
  }
  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token})
}

// ---------------------------------------------------------------------------
// I/O shell helpers
// ---------------------------------------------------------------------------

/**
 * Derive candidate signals from a PR's labels and title.
 * Simple v1: tokenize the title (split on non-alphanumeric, keep tokens >= 3 chars)
 * and collect label names. No `pulls.listFiles` call — avoids per-PR API overhead.
 */
function deriveSignals(pr: {title: string; labels: {name: string}[]}): CandidateSignals {
  const titleTokens = pr.title
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(t => t.length >= 3)

  const labels = pr.labels.map(l => l.name)

  return {titleTokens, labels}
}

/** Result of `harvestCandidates` — candidates plus explicit harvest-stage counts. */
export interface HarvestResult {
  candidates: Candidate[]
  stageCounts: HarvestStageCounts
}

/**
 * Rank value for a review state when building excerpts.
 * Lower number = higher priority (appears first in the ranked list).
 * CHANGES_REQUESTED and thread comments (treated as correction-signal-high) rank first.
 * DISMISSED next. APPROVED boilerplate last.
 */
function reviewStateRank(state: string): number {
  if (state === 'CHANGES_REQUESTED') return 0
  if (state === 'DISMISSED') return 1
  if (state === 'APPROVED') return 2
  return 3
}

/**
 * Build ranked, budgeted review-prose excerpts for a candidate.
 *
 * Collects review bodies (tagged with their state for ranking) and thread-comment bodies
 * (treated as correction-signal-high, rank 0). Ranks by correction signal so truncation
 * does not clip the correction sentence. Concatenates items until MAX_EXCERPT_CHARS_PER_CANDIDATE
 * is reached, truncating the last item that would overflow. Skips empty/whitespace bodies.
 *
 * Returns a string[] — array form gives the agent clearer structure than a single string.
 *
 * Privacy ordering invariant: this truncation runs in the harvest I/O shell, BEFORE the
 * upstream privacy scan in `buildCandidateDigest`. The scan must always read the final,
 * already-truncated excerpt array. Never move truncation after the scan — scanning a token
 * and then truncating around it could leave a surviving tail that escapes the gate.
 */
function buildReviewExcerpts(reviewBodies: {state: string; body: string}[], threadCommentBodies: string[]): string[] {
  // Collect all prose items with their rank
  const items: {rank: number; text: string}[] = []

  // Review bodies — ranked by state
  for (const {state, body} of reviewBodies) {
    const trimmed = body.trim()
    if (trimmed === '') continue
    items.push({rank: reviewStateRank(state), text: trimmed})
  }

  // Thread comment bodies — correction-signal-high (rank 0, same as CHANGES_REQUESTED)
  for (const body of threadCommentBodies) {
    const trimmed = body.trim()
    if (trimmed === '') continue
    items.push({rank: 0, text: trimmed})
  }

  // Sort by rank (stable sort preserves chronological order within same rank)
  items.sort((a, b) => a.rank - b.rank)

  // Apply per-candidate char budget
  const excerpts: string[] = []
  let remaining = MAX_EXCERPT_CHARS_PER_CANDIDATE

  for (const {text} of items) {
    if (remaining <= 0) break
    if (text.length <= remaining) {
      excerpts.push(text)
      remaining -= text.length
    } else {
      // Truncate the last item to fit within budget
      excerpts.push(text.slice(0, remaining))
      remaining = 0
    }
  }

  return excerpts
}

// ---------------------------------------------------------------------------
// CI fail→pass transition detection (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Per-commit per-check conclusion entry, as parsed from the GraphQL statusCheckRollup.
 * Supports both CheckRun (name + conclusion) and StatusContext (context + state).
 */
export type CommitCheckEntry =
  | {type: 'CheckRun'; sha: string; name: string; conclusion: string}
  | {type: 'StatusContext'; sha: string; context: string; state: string}

/**
 * Result of a successful fail→pass transition detection.
 */
export interface FailPassTransition {
  failingCheckName: string
  lastFailingSha: string
  firstPassingSha: string
}

/**
 * Failing conclusions for CheckRun (GitHub Actions).
 * These are the states that count as "failed" for transition detection.
 */
const FAILING_CHECK_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE'])

/**
 * Find the first fail→pass transition across a set of commits for required checks.
 *
 * Takes commits ordered OLDEST→NEWEST (chronological ascending). For each required
 * check name, finds:
 *   - lastFailingSha: the LATEST commit where the check has a failing conclusion
 *   - firstPassingSha: the FIRST commit AFTER lastFailingSha where the check is SUCCESS
 *
 * Returns the first such transition found (iterating required checks in insertion order),
 * or null if no transition exists.
 *
 * When requiredCheckNames is empty, treats ALL checks as required (any failed→passed
 * transition counts). This handles repos with no branch protection configured.
 *
 * CheckRun matches by `name`; StatusContext matches by `context`.
 *
 * Pure function: no I/O, fully unit-testable. The ordering invariant (oldest→newest)
 * is the correctness core — reversing the order would pick the wrong SHA.
 */
export function findFailPassTransition(
  commits: CommitCheckEntry[],
  requiredCheckNames: Set<string>,
): FailPassTransition | null {
  // Collect all check names present in the commits
  const allCheckNames = new Set<string>()
  for (const entry of commits) {
    const name = entry.type === 'CheckRun' ? entry.name : entry.context
    allCheckNames.add(name)
  }

  // Determine which check names to evaluate
  const checkNamesToEvaluate = requiredCheckNames.size > 0 ? requiredCheckNames : allCheckNames

  for (const checkName of checkNamesToEvaluate) {
    // Walk commits oldest→newest to find lastFailingSha and firstPassingSha
    let lastFailingSha: string | null = null

    for (const entry of commits) {
      const entryName = entry.type === 'CheckRun' ? entry.name : entry.context
      if (entryName !== checkName) continue

      if (entry.type === 'CheckRun') {
        if (FAILING_CHECK_CONCLUSIONS.has(entry.conclusion)) {
          // Update lastFailingSha — we want the LATEST failing commit
          lastFailingSha = entry.sha
        }
      } else if (entry.state === 'FAILURE' || entry.state === 'ERROR') {
        // StatusContext: FAILURE and ERROR states count as failing
        lastFailingSha = entry.sha
      }
    }

    if (lastFailingSha === null) continue

    // Now find the FIRST commit AFTER lastFailingSha where the check is SUCCESS
    let foundFailing = false
    for (const entry of commits) {
      const entryName = entry.type === 'CheckRun' ? entry.name : entry.context
      if (entryName !== checkName) continue

      if (entry.sha === lastFailingSha) {
        foundFailing = true
        continue
      }

      if (!foundFailing) continue

      // We're past the lastFailingSha — look for first SUCCESS
      const isSuccess = entry.type === 'CheckRun' ? entry.conclusion === 'SUCCESS' : entry.state === 'SUCCESS'

      if (isSuccess) {
        return {
          failingCheckName: checkName,
          lastFailingSha,
          firstPassingSha: entry.sha,
        }
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// GraphQL commit/check rollup fetch (I/O)
// ---------------------------------------------------------------------------

/**
 * GraphQL query to fetch per-commit per-check conclusions for a PR.
 * Returns commits in chronological order (oldest→newest for commits(first:N)).
 * Pagination: cursor walk for PRs with >100 commits.
 */
const PR_COMMITS_ROLLUP_QUERY = `
query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      commits(first:100,after:$after){
        pageInfo{ hasNextPage endCursor }
        nodes{
          commit{
            oid
            statusCheckRollup{
              contexts(first:100){
                nodes{
                  __typename
                  ... on CheckRun{ name conclusion }
                  ... on StatusContext{ context state }
                }
              }
            }
          }
        }
      }
    }
  }
}
`.trim()

/**
 * Injectable type for the gh execFileSync call (for testability).
 * Matches the signature used in private-repo-resolution.ts.
 */
export type GhExecFn = (args: string[], env?: NodeJS.ProcessEnv) => string

/**
 * Default gh exec implementation using execFileSync.
 * Follows the pattern from private-repo-resolution.ts.
 */
export function defaultGhExec(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  })
}

/**
 * Fetch per-commit per-check conclusions for a PR via GraphQL.
 * Walks cursor pages for PRs with >100 commits.
 * Returns commits in chronological order (oldest→newest).
 * Returns null on any error (caller degrades the PR).
 */
export function fetchPrCommitCheckRollup(
  owner: string,
  repo: string,
  prNumber: number,
  token: string | undefined,
  ghExec: GhExecFn = defaultGhExec,
): CommitCheckEntry[] | null {
  const env: NodeJS.ProcessEnv = {...process.env}
  if (token !== undefined && token !== '') {
    env.GH_TOKEN = token
    delete env.GITHUB_TOKEN
  }

  const allEntries: CommitCheckEntry[] = []
  let after: string | null = null
  const MAX_PAGES = 50
  let pageCount = 0

  // Cursor walk — handles PRs with >100 commits
  for (;;) {
    if (pageCount >= MAX_PAGES) break
    pageCount++
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${PR_COMMITS_ROLLUP_QUERY}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `repo=${repo}`,
      '-F',
      `number=${prNumber}`,
    ]
    if (after !== null) {
      args.push('-f', `after=${after}`)
    }

    let stdout: string
    try {
      stdout = ghExec(args, env)
    } catch {
      // If we already have entries from earlier pages, return partial data rather than discarding
      if (allEntries.length > 0) break
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      if (allEntries.length > 0) break
      return null
    }

    if (!isRecord(parsed)) {
      if (allEntries.length > 0) break
      return null
    }
    const data = parsed.data
    if (!isRecord(data)) {
      if (allEntries.length > 0) break
      return null
    }
    const repository = data.repository
    if (!isRecord(repository)) {
      if (allEntries.length > 0) break
      return null
    }
    const pullRequest = repository.pullRequest
    if (!isRecord(pullRequest)) {
      if (allEntries.length > 0) break
      return null
    }
    const commits = pullRequest.commits
    if (!isRecord(commits)) {
      if (allEntries.length > 0) break
      return null
    }
    const nodes = commits.nodes
    if (!Array.isArray(nodes)) {
      if (allEntries.length > 0) break
      return null
    }

    for (const node of nodes) {
      if (!isRecord(node)) continue
      const commit = node.commit
      if (!isRecord(commit)) continue
      const oid = commit.oid
      if (typeof oid !== 'string') continue
      const rollup = commit.statusCheckRollup
      if (!isRecord(rollup)) continue
      const contexts = rollup.contexts
      if (!isRecord(contexts)) continue
      const contextNodes = contexts.nodes
      if (!Array.isArray(contextNodes)) continue

      for (const ctx of contextNodes) {
        if (!isRecord(ctx)) continue
        const typename = ctx.__typename
        if (typename === 'CheckRun') {
          const name = ctx.name
          const conclusion = ctx.conclusion
          if (typeof name === 'string' && typeof conclusion === 'string') {
            allEntries.push({type: 'CheckRun', sha: oid, name, conclusion})
          }
        } else if (typename === 'StatusContext') {
          const context = ctx.context
          const state = ctx.state
          if (typeof context === 'string' && typeof state === 'string') {
            allEntries.push({type: 'StatusContext', sha: oid, context, state})
          }
        }
      }
    }

    // Check pagination
    const pageInfo = commits.pageInfo
    if (!isRecord(pageInfo)) break
    const hasNextPage = pageInfo.hasNextPage
    if (hasNextPage !== true) break
    const endCursor = pageInfo.endCursor
    if (typeof endCursor !== 'string') break
    after = endCursor
  }

  return allEntries
}

// ---------------------------------------------------------------------------
// Diff excerpt builder
// ---------------------------------------------------------------------------

/**
 * Build a diff excerpt from compareCommits file patches, truncated to budget.
 * Ranks toward changed hunks (lines starting with + or -).
 * Returns empty string when no patches are available.
 */
function buildDiffExcerpt(files: {filename?: string; patch?: string}[], budget: number): string {
  const parts: string[] = []
  let remaining = budget

  for (const file of files) {
    if (remaining <= 0) break
    const patch = file.patch
    if (typeof patch !== 'string' || patch === '') continue
    const header = `--- ${file.filename ?? 'unknown'}\n`
    const chunk = header + patch
    if (chunk.length <= remaining) {
      parts.push(chunk)
      remaining -= chunk.length
    } else {
      parts.push(chunk.slice(0, remaining))
      remaining = 0
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Log excerpt builder
// ---------------------------------------------------------------------------

/**
 * Build a log excerpt from raw job log text, ranked toward error lines.
 * Truncates to budget. Returns the excerpt string.
 */
function buildLogExcerpt(logText: string, budget: number): string {
  const lines = logText.split('\n')

  // Rank error lines first (lines containing 'error', 'Error', 'ERROR', 'FAILED', 'failed')
  const errorLines: string[] = []
  const otherLines: string[] = []

  for (const line of lines) {
    if (/error|failed/i.test(line)) {
      errorLines.push(line)
    } else {
      otherLines.push(line)
    }
  }

  const ranked = [...errorLines, ...otherLines]
  const joined = ranked.join('\n')
  return joined.slice(0, budget)
}

// ---------------------------------------------------------------------------
// CI fix harvester (I/O shell)
// ---------------------------------------------------------------------------

/**
 * Fetch merged PRs in the lookback window and detect CI fail→pass transitions.
 *
 * For each merged PR (reusing the same closed-PR list pattern as harvestCandidates):
 * 1. Run the GraphQL commits/rollup query to get per-commit per-check conclusions.
 * 2. Walk commits oldest→newest to find lastFailingSha/firstPassingSha for a required check.
 * 3. compareCommits for the fixing diff (drop if no diff — bare re-run).
 * 4. Best-effort downloadJobLogsForWorkflowRun for the failed job log excerpt.
 * 5. Build CiFixCandidate with deriveSignals for the signals field.
 *
 * Per-PR errors (GraphQL/compare) degrade that PR (skip), never abort.
 * Log fetch errors degrade to '[failure log purged or unavailable]' placeholder.
 *
 * Injectables: ghExec + octokit + now + mergedPrs (for testability).
 * Counts-only telemetry — no owner/repo/name in any log.
 */
export async function harvestCiFixCandidates(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  _now: Date,
  mergedPrs: {
    number: number
    merge_commit_sha: string
    title: string
    labels: {name: string}[]
    user: {login: string} | null
  }[],
  requiredCheckNames: Set<string>,
  ghExec: GhExecFn = defaultGhExec,
): Promise<{candidates: CiFixCandidate[]; ciFixPrsExamined: number; ciFixCandidates: number}> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN

  let ciFixPrsExamined = 0
  let ciFixCandidatesCount = 0
  const candidates: CiFixCandidate[] = []

  for (const pr of mergedPrs) {
    ciFixPrsExamined++

    // Step 1: fetch per-commit per-check conclusions via GraphQL
    const entries = fetchPrCommitCheckRollup(owner, repo, pr.number, token, ghExec)
    if (entries === null) {
      // GraphQL error — degrade this PR, continue
      process.stderr.write(`capture-learnings-harvest: ci-fix GraphQL failed (pr=${ciFixPrsExamined})\n`)
      continue
    }

    // Step 2: find fail→pass transition
    const transition = findFailPassTransition(entries, requiredCheckNames)
    if (transition === null) {
      // No transition — not a CI-fix candidate
      continue
    }

    const {failingCheckName, lastFailingSha, firstPassingSha} = transition

    // Step 3: compareCommits for the fixing diff
    let diffExcerpt: string
    try {
      const compareResult = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base: lastFailingSha,
        head: firstPassingSha,
      })
      const files = compareResult.data.files ?? []
      if (files.length === 0) {
        // Bare re-run with no diff — drop the candidate (scope boundary)
        continue
      }
      diffExcerpt = buildDiffExcerpt(files as {filename?: string; patch?: string}[], MAX_EXCERPT_CHARS_PER_CANDIDATE)
      if (diffExcerpt === '') {
        // No patches in any file — drop
        continue
      }
    } catch {
      // compareCommits error — degrade this PR
      process.stderr.write(`capture-learnings-harvest: ci-fix compareCommits failed (pr=${ciFixPrsExamined})\n`)
      continue
    }

    // Step 4: best-effort log fetch
    let logExcerpt: string | undefined
    try {
      const runsResult = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        head_sha: lastFailingSha,
        status: 'completed',
        per_page: 10,
      })
      const failedRun = runsResult.data.workflow_runs.find(r => r.conclusion === 'failure')
      if (failedRun !== undefined) {
        const jobsResult = await octokit.rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: failedRun.id,
          per_page: 50,
        })
        const failedJob = jobsResult.data.jobs.find(j => j.conclusion === 'failure')
        if (failedJob !== undefined) {
          const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
            owner,
            repo,
            job_id: failedJob.id,
          })
          const raw = logResponse.data
          const logText = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
          if (logText !== '') {
            logExcerpt = buildLogExcerpt(logText, MAX_EXCERPT_CHARS_PER_CANDIDATE)
          }
        }
      }
    } catch {
      // Log fetch failed — degrade to placeholder, never block the candidate
      logExcerpt = '[failure log purged or unavailable]'
    }

    // Step 5: build CiFixCandidate
    const prLabels = pr.labels.map(l => l.name)
    const candidate: CiFixCandidate = {
      trigger: 'ci-fail-then-pass',
      mergeSha: pr.merge_commit_sha,
      signals: deriveSignals({
        title: pr.title,
        labels: prLabels.map(name => ({name})),
      }),
      failingCheckName,
      lastFailingSha,
      firstPassingSha,
      diffExcerpt,
      logExcerpt,
    }

    candidates.push(candidate)
    ciFixCandidatesCount++
  }

  return {candidates, ciFixPrsExamined, ciFixCandidates: ciFixCandidatesCount}
}

/**
 * Fetch all merged PRs in the lookback window and return those where Fro Bot's
 * substantive reviews meet the predicate:
 *   substantiveReviewCount >= MIN_SUBSTANTIVE_REVIEW_ROUNDS
 *   AND correctionSignalCount >= MIN_CORRECTION_SIGNALS
 *
 * Substantive reviews: APPROVED | CHANGES_REQUESTED | DISMISSED (COMMENTED excluded).
 * Correction signals: DISMISSED | CHANGES_REQUESTED.
 *
 * Only reviews by logins in FRO_BOT_REVIEWER_LOGINS are counted.
 * Dependency-automation PRs (by author login or label) are excluded before counting.
 *
 * For each qualifying candidate, retains review bodies from the already-fetched listReviews
 * and fetches line-level thread comments via listReviewComments. Builds ranked, budgeted
 * reviewExcerpts (correction prose first). A transient listReviewComments error for one
 * candidate degrades it to title-only (empty reviewExcerpts) without aborting the run.
 *
 * Transient listReviews errors for a single PR are caught and that PR is skipped.
 * Returns candidates alongside explicit harvest-stage counts for honest telemetry.
 */
export async function harvestCandidates(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  now: Date,
): Promise<HarvestResult> {
  // Use now.getTime() — the injected `now` is already UTC ms (Date.now() in main).
  // Both sides of the comparison are UTC ms, so timezone drift cannot occur.
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const allPrs = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: 'closed',
    per_page: 100,
  } as unknown as Parameters<OctokitClient['rest']['pulls']['list']>[0])

  const closedPrsFetched = allPrs.length

  const candidates: Candidate[] = []
  let mergedPrsInLookback = 0
  let excludedAutomation = 0

  for (const pr of allPrs) {
    // Exclude unmerged PRs
    if (pr.merged_at === null || pr.merged_at === undefined) {
      continue
    }

    // Exclude PRs outside the lookback window
    const mergedAt = new Date(pr.merged_at)
    if (mergedAt < cutoff) {
      continue
    }

    // Exclude PRs without a merge commit SHA
    if (pr.merge_commit_sha === null || pr.merge_commit_sha === undefined) {
      continue
    }

    mergedPrsInLookback++

    // Exclude dependency-automation PRs by author login
    const authorLogin = pr.user?.login ?? ''
    if (authorLogin === 'renovate[bot]' || authorLogin === 'dependabot[bot]') {
      excludedAutomation++
      continue
    }

    // Exclude dependency-automation PRs by label
    const prLabels = pr.labels.map(l => (typeof l === 'string' ? l : l.name))
    if (prLabels.some(name => DEPENDENCY_LABELS.has(name))) {
      excludedAutomation++
      continue
    }

    // Fetch Fro Bot's reviews and apply the predicate.
    // Paginate to avoid undercounting when reviews span >1 page (default page = 30).
    // Retain r.body for enrichment — zero new calls, already fetched for the count.
    let substantiveReviewCount: number
    let correctionSignalCount: number
    let reviewBodies: {state: string; body: string}[]
    try {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      } as unknown as Parameters<OctokitClient['rest']['pulls']['listReviews']>[0])

      // Key all counting on Fro Bot reviewer logins only.
      const froBotReviews = reviews.filter(r => {
        const login = r.user?.login ?? ''
        return FRO_BOT_REVIEWER_LOGINS.has(login)
      })

      // Substantive: APPROVED | CHANGES_REQUESTED | DISMISSED (COMMENTED excluded).
      substantiveReviewCount = froBotReviews.filter(r => {
        return r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED'
      }).length

      // Correction signals: DISMISSED | CHANGES_REQUESTED.
      correctionSignalCount = froBotReviews.filter(r => {
        return r.state === 'DISMISSED' || r.state === 'CHANGES_REQUESTED'
      }).length

      // Retain review bodies for enrichment (all fro-bot reviews, not just substantive)
      reviewBodies = froBotReviews.map(r => ({
        state: r.state,
        body: typeof r.body === 'string' ? r.body : '',
      }))
    } catch (error: unknown) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      process.stderr.write(
        `capture-learnings-harvest: skipping PR #${pr.number} — listReviews failed (status=${status})\n`,
      )
      continue
    }

    if (substantiveReviewCount < MIN_SUBSTANTIVE_REVIEW_ROUNDS || correctionSignalCount < MIN_CORRECTION_SIGNALS) {
      continue
    }

    // Fetch line-level thread comments for enrichment.
    // A transient error here degrades this candidate to review-bodies-only (no thread comments)
    // without aborting the run — mirrors the listReviews skip pattern but continues WITH
    // the candidate rather than skipping it entirely.
    let threadCommentBodies: string[] = []
    try {
      const reviewComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      } as unknown as Parameters<OctokitClient['rest']['pulls']['listReviewComments']>[0])

      threadCommentBodies = reviewComments
        .map(c => (typeof c.body === 'string' ? c.body : ''))
        .filter(b => b.trim() !== '')
    } catch (error: unknown) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      process.stderr.write(
        `capture-learnings-harvest: PR #${pr.number} — listReviewComments failed (status=${status}), proceeding with review bodies only\n`,
      )
      // threadCommentBodies stays [] — candidate proceeds with review bodies only
    }

    const reviewExcerpts = buildReviewExcerpts(reviewBodies, threadCommentBodies)

    candidates.push({
      trigger: 'review-heavy',
      mergeSha: pr.merge_commit_sha,
      reviewRounds: substantiveReviewCount,
      signals: deriveSignals({
        title: pr.title,
        labels: prLabels.map(name => ({name})),
      }),
      reviewExcerpts,
    })
  }

  return {
    candidates,
    stageCounts: {
      closedPrsFetched,
      mergedPrsInLookback,
      excludedAutomation,
      multiRoundCandidates: candidates.length,
      // CI-fix counts are populated by harvestCiFixCandidates separately
      ciFixPrsExamined: 0,
      ciFixCandidates: 0,
    },
  }
}

/**
 * Fetch all learning-proposal issues (state: all) and parse the merge SHA marker
 * from each body. Returns a Set of seen merge SHAs.
 */
export async function fetchOpenedLearningShas(
  octokit: OctokitClient,
  owner: string,
  repo: string,
): Promise<Set<string>> {
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    labels: LEARNING_PROPOSAL_LABEL,
    per_page: 100,
  } as unknown as Parameters<OctokitClient['rest']['issues']['listForRepo']>[0])

  const seen = new Set<string>()

  for (const issue of issues) {
    const body = issue.body
    if (typeof body !== 'string' || body === '') {
      continue
    }
    const sha = parseMergeShaMarker(body)
    if (sha !== null) {
      seen.add(sha)
    }
  }

  return seen
}

// ---------------------------------------------------------------------------
// Shared merged-PR fetch (for harvestCiFixCandidates in main)
// ---------------------------------------------------------------------------

/**
 * Fetch all merged PRs in the lookback window and return the raw list.
 *
 * This is a separate fetch from harvestCandidates's internal fetch. The two-fetch
 * approach was chosen over refactoring harvestCandidates to accept a pre-fetched list
 * because harvestCandidates's fetch is deeply entangled with its filtering logic
 * (merged_at, cutoff, merge_commit_sha, automation exclusion). Extracting it would
 * require changing the function signature and all its tests, increasing blast radius
 * with no behavioral benefit. The extra pulls.list call is bounded by LOOKBACK_DAYS
 * and is not on the hot path.
 *
 * Returns PRs with the fields required by harvestCiFixCandidates.
 * Exported for testability.
 */
export async function fetchMergedPrsInWindow(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  now: Date,
): Promise<
  {
    number: number
    merge_commit_sha: string
    title: string
    labels: {name: string}[]
    user: {login: string} | null
    merged_at: string
  }[]
> {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const allPrs = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: 'closed',
    per_page: 100,
  } as unknown as Parameters<OctokitClient['rest']['pulls']['list']>[0])

  const result: {
    number: number
    merge_commit_sha: string
    title: string
    labels: {name: string}[]
    user: {login: string} | null
    merged_at: string
  }[] = []

  for (const pr of allPrs) {
    // Exclude unmerged PRs
    if (pr.merged_at === null || pr.merged_at === undefined) continue

    // Exclude PRs outside the lookback window
    const mergedAt = new Date(pr.merged_at)
    if (mergedAt < cutoff) continue

    // Exclude PRs without a merge commit SHA
    if (pr.merge_commit_sha === null || pr.merge_commit_sha === undefined) continue

    result.push({
      number: pr.number,
      merge_commit_sha: pr.merge_commit_sha,
      title: pr.title,
      labels: pr.labels.map(l => ({name: typeof l === 'string' ? l : l.name})),
      user: pr.user !== null && pr.user !== undefined ? {login: pr.user.login} : null,
      merged_at: pr.merged_at,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const owner = 'fro-bot'
  const repo = '.github'

  try {
    const octokit = await createOctokitFromEnv()
    // Use Date.now() — UTC ms — as the reference point for the lookback cutoff.
    const now = new Date(Date.now())

    // Fetch merged PRs once for the ci-fix harvester (separate from harvestCandidates's
    // internal fetch — see fetchMergedPrsInWindow for the rationale).
    const [{candidates: reviewCandidates, stageCounts}, openedLearningShas, solutionsFiles, mergedPrsForCiFix] =
      await Promise.all([
        harvestCandidates(octokit, owner, repo, now),
        fetchOpenedLearningShas(octokit, owner, repo),
        loadSolutionsFilesFromDisk(),
        fetchMergedPrsInWindow(octokit, owner, repo, now),
      ])

    // Get the required-checks set from branch protection.
    // Wrap in try/catch — if branch protection is absent (404) or the call fails,
    // use an empty Set (findFailPassTransition treats empty = all checks count).
    // Counts-only logging on failure.
    let requiredCheckNames = new Set<string>()
    try {
      const branchProtection = await octokit.rest.repos.getBranchProtection({
        owner,
        repo,
        branch: 'main',
      })
      const checks = branchProtection.data.required_status_checks?.checks ?? []
      requiredCheckNames = new Set(checks.map((c: {context: string}) => c.context))
    } catch {
      // 404 = no branch protection configured; any other error = degrade gracefully.
      // Empty set means all failed→passed transitions count (documented approximation).
      process.stderr.write(
        `capture-learnings-harvest: getBranchProtection failed or absent, using empty required-checks set (all transitions count)\n`,
      )
    }

    // Harvest CI fail→pass candidates using the shared merged-PR list.
    const {
      candidates: ciFixCandidates,
      ciFixPrsExamined,
      ciFixCandidates: ciFixCandidatesCount,
    } = await harvestCiFixCandidates(octokit, owner, repo, now, mergedPrsForCiFix, requiredCheckNames)

    // Concatenate both candidate sources.
    const allCandidates: Candidate[] = [...reviewCandidates, ...ciFixCandidates]

    // Merge stage counts: add ci-fix counts into the review-harvester's stageCounts.
    const mergedStageCounts: HarvestStageCounts = {
      ...stageCounts,
      ciFixPrsExamined,
      ciFixCandidates: ciFixCandidatesCount,
    }

    const solutionsDocs = collectSolutionDocs(solutionsFiles)

    // Load private tokens BEFORE building the digest — fail-closed.
    // If loadPrivateTokensFromDisk throws (metadata unreadable), we must NOT emit any
    // enriched content. Catch the throw, log counts-only, and proceed with all candidates
    // title-only (reviewExcerpts cleared). Never pass unscanned prose to the digest.
    let privateTokens: Set<string>
    let enrichmentScanAvailable = true
    try {
      privateTokens = await loadPrivateTokensFromDisk()
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'unknown'
      process.stderr.write(
        `capture-learnings-harvest: private token load failed (${errorMessage}), proceeding title-only — no enriched content will be emitted\n`,
      )
      privateTokens = new Set()
      enrichmentScanAvailable = false
    }

    // If the scan is unavailable, clear all enriched evidence before passing to the pure core.
    // This ensures no unscanned prose reaches the digest under any path.
    // applyEnrichmentScanAvailability handles both ReviewCandidate (clears reviewExcerpts)
    // and CiFixCandidate (clears diffExcerpt + logExcerpt) — Unit 3 verified this.
    const safeCandidates = applyEnrichmentScanAvailability(allCandidates, enrichmentScanAvailable)

    const digest = buildCandidateDigest({
      mergedPrs: safeCandidates,
      stageCounts: mergedStageCounts,
      openedLearningShas,
      solutionsDocs,
      maxLearnings: MAX_LEARNINGS_PER_RUN,
      privateTokens,
    })

    await writeDigestFile(digest)
    process.stdout.write(`${JSON.stringify(digest)}\n`)
  } catch (error: unknown) {
    // Best-effort: any error → empty digest, exit 0 — harvest must never fail the workflow step.
    // Log error class only — no message that could leak content.
    const errorName = error instanceof Error ? error.name : 'unknown'
    process.stderr.write(`capture-learnings-harvest: unexpected error (${errorName}), falling back to empty digest\n`)
    const empty: CandidateDigest = {
      candidates: [],
      telemetry: {
        closedPrsFetched: 0,
        mergedPrsInLookback: 0,
        excludedAutomation: 0,
        multiRoundCandidates: 0,
        ciFixPrsExamined: 0,
        ciFixCandidates: 0,
        afterSeenDedup: 0,
        afterSolutionsDedup: 0,
        emitted: 0,
        enrichmentBlocked: 0,
        enrichmentBlockedBySecret: 0,
      },
    }
    try {
      await writeDigestFile(empty)
    } catch {
      // ignore
    }
    process.stdout.write(`${JSON.stringify(empty)}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
