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
import {readdir, readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'
import {Octokit} from '@octokit/rest'
import {parse} from 'yaml'

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
 * A candidate PR for a learning proposal.
 *
 * Carries no owner, repo, or PR number. `signals` includes tokens derived from the PR
 * title and labels, so title-derived tokens do reach the consuming agent — they are not
 * fully sanitized here. The deterministic open step is the privacy chokepoint: it scans
 * the final authored body for private identifiers and blocks before posting, so a private
 * token surfacing in a title token is gated downstream rather than leaked.
 */
export interface Candidate {
  mergeSha: string
  /**
   * Number of Fro Bot substantive review rounds (APPROVED | CHANGES_REQUESTED | DISMISSED).
   * Named `reviewRounds` to preserve the contract with the agent prompt in
   * capture-learnings.yaml, which references this field by name.
   */
  reviewRounds: number
  signals: CandidateSignals
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
}

/** Counts-only telemetry returned by the pure core + harvest stage. */
export interface DigestTelemetry {
  closedPrsFetched: number
  mergedPrsInLookback: number
  excludedAutomation: number
  multiRoundCandidates: number
  afterSeenDedup: number
  afterSolutionsDedup: number
  emitted: number
}

/** Result of `buildCandidateDigest`. */
export interface CandidateDigest {
  candidates: Candidate[]
  telemetry: DigestTelemetry
}

/** Input to the pure core. */
export interface BuildCandidateDigestInput {
  /** Merged PRs that already passed the review-predicate filter. */
  mergedPrs: Candidate[]
  /** Harvest-stage counts to thread into the final telemetry. */
  stageCounts: HarvestStageCounts
  /** merge_shas already represented by a learning-proposal issue. */
  openedLearningShas: Set<string>
  /** Existing solutions docs for solutions dedup. */
  solutionsDocs: SolutionDoc[]
  /** Maximum candidates to emit. */
  maxLearnings: number
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
 * 1. Drop candidates whose mergeSha is already in openedLearningShas (seen-set dedup).
 * 2. Drop candidates whose signals strongly overlap an existing solutions doc (solutions dedup).
 * 3. Cap to maxLearnings.
 * 4. Return candidates + counts-only telemetry (harvest stage counts + dedup stage counts).
 *
 * No I/O. Fully unit-testable.
 */
export function buildCandidateDigest(input: BuildCandidateDigestInput): CandidateDigest {
  // drop already-proposed merge SHAs
  const afterSeenDedup = input.mergedPrs.filter(pr => !input.openedLearningShas.has(pr.mergeSha))

  // drop candidates whose signals overlap an existing solutions doc
  const afterSolutionsDedup = afterSeenDedup.filter(pr => !overlapsAnySolutionsDoc(pr.signals, input.solutionsDocs))

  // cap to maxLearnings
  const candidates = afterSolutionsDedup.slice(0, input.maxLearnings)

  return {
    candidates,
    telemetry: {
      ...input.stageCounts,
      afterSeenDedup: afterSeenDedup.length,
      afterSolutionsDedup: afterSolutionsDedup.length,
      emitted: candidates.length,
    },
  }
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
// Type guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    let substantiveReviewCount: number
    let correctionSignalCount: number
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

    candidates.push({
      mergeSha: pr.merge_commit_sha,
      reviewRounds: substantiveReviewCount,
      signals: deriveSignals({
        title: pr.title,
        labels: prLabels.map(name => ({name})),
      }),
    })
  }

  return {
    candidates,
    stageCounts: {
      closedPrsFetched,
      mergedPrsInLookback,
      excludedAutomation,
      multiRoundCandidates: candidates.length,
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
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const owner = 'fro-bot'
  const repo = '.github'

  try {
    const octokit = await createOctokitFromEnv()
    // Use Date.now() — UTC ms — as the reference point for the lookback cutoff.
    const now = new Date(Date.now())

    const [{candidates: mergedPrs, stageCounts}, openedLearningShas, solutionsFiles] = await Promise.all([
      harvestCandidates(octokit, owner, repo, now),
      fetchOpenedLearningShas(octokit, owner, repo),
      loadSolutionsFilesFromDisk(),
    ])

    const solutionsDocs = collectSolutionDocs(solutionsFiles)

    const digest = buildCandidateDigest({
      mergedPrs,
      stageCounts,
      openedLearningShas,
      solutionsDocs,
      maxLearnings: MAX_LEARNINGS_PER_RUN,
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
        afterSeenDedup: 0,
        afterSolutionsDedup: 0,
        emitted: 0,
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
