/**
 * Harvest merged PRs from this repo that required multiple rounds of changes-requested
 * reviews, dedup against existing learning-proposal issues and docs/solutions/ docs,
 * cap the result, and emit an opaque candidate digest to $GITHUB_OUTPUT.
 *
 * Architecture: pure core (`buildCandidateDigest`) + I/O shell (`main`).
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

/** Minimum number of CHANGES_REQUESTED reviews for a PR to be a candidate. */
const MULTI_ROUND_THRESHOLD = 2

/** Maximum number of candidates to emit per run. */
const MAX_PROPOSALS_PER_RUN = 5

/** Label used to identify learning-proposal issues. */
export const LEARNING_PROPOSAL_LABEL = 'learning-proposal'

/**
 * Minimum overlap score (inclusive) between a candidate's signals and an existing
 * solutions doc to trigger dedup. Exact problem_type match = 100; tag/module overlap
 * is additive at 10 per shared token. Threshold of 10 means any single shared tag
 * or module token triggers dedup.
 */
const SOLUTIONS_OVERLAP_THRESHOLD = 10

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
 * OPAQUE: carries only merge_sha, reviewRounds, and signals — NO owner/repo/number/title prose.
 */
export interface Candidate {
  mergeSha: string
  reviewRounds: number
  signals: CandidateSignals
}

/** Counts-only telemetry returned by the pure core. */
export interface DigestTelemetry {
  examined: number
  afterProposalDedup: number
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
  /** Merged PRs that already passed the MULTI_ROUND_THRESHOLD filter. */
  mergedPrs: Candidate[]
  /** merge_shas already represented by a learning-proposal issue. */
  proposedMergeShas: Set<string>
  /** Existing solutions docs for R5 dedup. */
  solutionsDocs: SolutionDoc[]
  /** Maximum candidates to emit. */
  maxProposals: number
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
  return `<!-- capture-c1:merge_sha=${sha} -->`
}

/**
 * Parse the merge SHA from a learning-proposal issue body.
 * Returns the SHA string or null if the marker is absent or malformed.
 */
export function parseMergeShaMarker(body: string): string | null {
  const match = /<!-- capture-c1:merge_sha=([a-f0-9]{7,40}) -->/u.exec(body)
  return match?.[1] ?? null
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Build the opaque candidate digest from injected inputs.
 *
 * Steps:
 * 1. Drop candidates whose mergeSha is already in proposedMergeShas (R3 dedup).
 * 2. Drop candidates whose signals strongly overlap an existing solutions doc (R5 dedup).
 * 3. Cap to maxProposals (R6).
 * 4. Return candidates + counts-only telemetry.
 *
 * No I/O. Fully unit-testable.
 */
export function buildCandidateDigest(input: BuildCandidateDigestInput): CandidateDigest {
  const examined = input.mergedPrs.length

  // R3: drop already-proposed merge SHAs
  const afterProposalDedup = input.mergedPrs.filter(pr => !input.proposedMergeShas.has(pr.mergeSha))

  // R5: drop candidates whose signals overlap an existing solutions doc
  const afterSolutionsDedup = afterProposalDedup.filter(pr => !overlapsAnySolutionsDoc(pr.signals, input.solutionsDocs))

  // R6: cap to maxProposals
  const candidates = afterSolutionsDedup.slice(0, input.maxProposals)

  return {
    candidates,
    telemetry: {
      examined,
      afterProposalDedup: afterProposalDedup.length,
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
        process.stderr.write(`capture-c1-harvest: could not read file (path: ${path})\n`)
      }
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// GITHUB_OUTPUT writer
// ---------------------------------------------------------------------------

async function writeGithubOutput(digest: CandidateDigest): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath === undefined || outputPath === '') {
    return
  }

  const delimiter = `EOF_${Math.random().toString(16).slice(2)}`
  const lines = [
    `digest<<${delimiter}`,
    JSON.stringify(digest.candidates),
    delimiter,
    `candidate-count=${digest.telemetry.emitted}`,
    `examined=${digest.telemetry.examined}`,
    `after-proposal-dedup=${digest.telemetry.afterProposalDedup}`,
    `after-solutions-dedup=${digest.telemetry.afterSolutionsDedup}`,
  ]
  await writeFile(outputPath, `${lines.join('\n')}\n`, {flag: 'a'})
}

// ---------------------------------------------------------------------------
// Octokit constructor helpers
// ---------------------------------------------------------------------------

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  if (typeof Octokit !== 'function') {
    throw new TypeError('Failed to load @octokit/rest Octokit constructor')
  }
  return Octokit as unknown as OctokitConstructor
}

export async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    throw new Error('capture-c1-harvest requires GITHUB_TOKEN in the environment')
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

/**
 * Fetch all merged PRs in the lookback window and return those with
 * reviewRounds >= MULTI_ROUND_THRESHOLD as Candidate objects.
 *
 * Transient listReviews errors for a single PR are caught and that PR is skipped.
 */
export async function harvestCandidates(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  now: Date,
): Promise<Candidate[]> {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const allPrs = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: 'closed',
    per_page: 100,
  } as unknown as Parameters<OctokitClient['rest']['pulls']['list']>[0])

  const candidates: Candidate[] = []

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

    // Count CHANGES_REQUESTED reviews — transient errors skip this PR
    let reviewRounds: number
    try {
      const reviews = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pr.number,
      })
      reviewRounds = reviews.data.filter(r => r.state === 'CHANGES_REQUESTED').length
    } catch (error: unknown) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      process.stderr.write(`capture-c1-harvest: skipping PR #${pr.number} — listReviews failed (status=${status})\n`)
      continue
    }

    if (reviewRounds < MULTI_ROUND_THRESHOLD) {
      continue
    }

    candidates.push({
      mergeSha: pr.merge_commit_sha,
      reviewRounds,
      signals: deriveSignals({
        title: pr.title,
        labels: pr.labels.map(l => ({name: typeof l === 'string' ? l : (l as {name: string}).name})),
      }),
    })
  }

  return candidates
}

/**
 * Fetch all learning-proposal issues (state: all) and parse the merge SHA marker
 * from each body. Returns a Set of seen merge SHAs.
 */
export async function fetchProposedMergeShas(
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
    const now = new Date()

    const [mergedPrs, proposedMergeShas, solutionsFiles] = await Promise.all([
      harvestCandidates(octokit, owner, repo, now),
      fetchProposedMergeShas(octokit, owner, repo),
      loadSolutionsFilesFromDisk(),
    ])

    const solutionsDocs = collectSolutionDocs(solutionsFiles)

    const digest = buildCandidateDigest({
      mergedPrs,
      proposedMergeShas,
      solutionsDocs,
      maxProposals: MAX_PROPOSALS_PER_RUN,
    })

    await writeGithubOutput(digest)
    process.stdout.write(`${JSON.stringify(digest)}\n`)
  } catch {
    // Best-effort: any error → empty digest, exit 0 — harvest must never fail the workflow step
    process.stderr.write('capture-c1-harvest: unexpected error, falling back to empty digest\n')
    const empty: CandidateDigest = {
      candidates: [],
      telemetry: {examined: 0, afterProposalDedup: 0, afterSolutionsDedup: 0, emitted: 0},
    }
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
