/**
 * Candidate clustering, scoring, and suppression planner for recurring pattern synthesis.
 *
 * Pure core: `planPatternCandidates` builds deterministic cluster candidates from source
 * artifacts and existing pattern-proposal state, then decides which candidates may be
 * sent to the agent for proposal drafting. No I/O — all data is injected.
 *
 * Filter order (fixed): weak cluster -> quality suppression (overbroad / hash-title-only) ->
 * open-proposal overlap -> hard suppression -> soft suppression (without upgrade threshold) ->
 * unsafe evidence placeholder -> rank -> cap.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {Dirent} from 'node:fs'
import {createHash} from 'node:crypto'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'

import {
  classifyPatternProposalOutcome,
  collectLearningProposalSources,
  collectSolutionDocSources,
  fetchExistingPatternProposals,
  parsePatternProposalSourceIds,
  SOLUTION_SUBDIRS,
  type ExistingPatternProposalIssue,
  type ExistingPatternProposals,
  type LearningProposalIssueInput,
  type PatternProposalOctokitClient,
  type PatternSourceSignals,
} from './capture-patterns-synthesis.ts'
import {applyPublicOutputGate, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum candidates emitted per run (before opener applies its own cap). */
const DEFAULT_CAP = 3

/**
 * Minimum shared correction-substance score (inclusive) for two sources to cluster
 * together. Modeled on `computeOverlapScore` in capture-learnings-harvest.ts, but tuned
 * so that a single generic signal (a shared tag, or a bare problem_type match with no
 * title-token or module overlap) can never clear the bar on its own — real repeated
 * correction substance requires multiple shared signals or overlapping title tokens.
 */
const CLUSTER_OVERLAP_THRESHOLD = 30

/** Minimum candidate cluster size (in unique sources) to avoid single-source noise. */
const MIN_CLUSTER_SOURCES = 2

/** Number of new independent public-safe sources required to upgrade past hard suppression. */
const HARD_SUPPRESSION_UPGRADE_THRESHOLD = 2

/** Number of new independent public-safe sources required to lift soft (deferred) suppression. */
const SOFT_SUPPRESSION_UPGRADE_THRESHOLD = 1

/**
 * Cluster size (in unique sources) above which a candidate is decision-ready only if
 * every member shares one specific non-empty `problem_type`. A cluster this large that
 * lacks a single shared problem type is a broad cross-cutting grouping (e.g. generic
 * best-practice/workflow docs sharing only module/tag tokens), not a reusable pattern.
 */
const OVERBROAD_CLUSTER_SIZE_THRESHOLD = 8

/**
 * Matches the neutral hash-title format `deriveLearningTitle` assigns to opened
 * learning proposals (`Learning proposal: (<shortSha>)`). A title in this shape carries
 * no human-readable correction substance until the proposal is codified into a solution
 * doc or given a stronger semantic title.
 */
const HASH_ONLY_LEARNING_TITLE_PATTERN = /^learning proposal:\s*\([0-9a-f]{6,40}\)$/u

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Minimal source shape the planner clusters over. */
export interface PatternCandidateSource {
  id: string
  kind: 'solution-doc' | 'learning-proposal'
  link: string
  title: string
  date: string
  signals: PatternSourceSignals
}

/** Evidence/score bucket, coarse and deterministic. */
export type PatternCandidateScoreBucket = 'strong' | 'moderate' | 'weak'

/** A built cluster candidate ready for suppression filtering and ranking. */
export interface PatternCandidate {
  fingerprint: string
  sourceIds: string[]
  sources: PatternCandidateSource[]
  scoreBucket: PatternCandidateScoreBucket
  /** Fingerprint of a deferred proposal this candidate is a new version of, if any. */
  supersedes?: string
}

/** Counts-only telemetry for the planner. No prose, fingerprints, or titles. */
export interface PatternPlannerCounts {
  proposed: number
  capped: number
  lowSignal: number
  duplicateOpenOverlap: number
  hardSuppressed: number
  softSuppressed: number
  unsafe: number
  invalidSource: number
  noOp: number
  failed: number
  /** Overbroad or weak-signal clusters suppressed before ranking (never suppression state). */
  qualitySuppressed: number
}

/** Result of `planPatternCandidates`. */
export interface PatternPlannerResult {
  candidates: PatternCandidate[]
  counts: PatternPlannerCounts
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Cluster fingerprint: lowercase hex SHA-256 of newline-joined, sorted source IDs.
 * Identity is source-ID-based only — generated pattern wording is never hashed.
 */
export function buildSourceFingerprint(sourceIds: readonly string[]): string {
  const sorted = [...sourceIds].sort((a, b) => a.localeCompare(b))
  return createHash('sha256').update(sorted.join('\n')).digest('hex')
}

// ---------------------------------------------------------------------------
// Correction-substance overlap scoring (models computeOverlapScore)
// ---------------------------------------------------------------------------

/**
 * Score shared correction substance between two sources' structured signals.
 *
 * - Exact non-empty problem_type match: 100 points (strong signal).
 * - Each shared tag token: 10 points.
 * - Each shared module token (path split on separators, len >= 3): 10 points.
 * - Each shared title token: 10 points.
 *
 * A single shared generic tag alone (10 points) never clears CLUSTER_OVERLAP_THRESHOLD.
 * Pure function: no I/O.
 */
function computeSourceOverlapScore(a: PatternSourceSignals, b: PatternSourceSignals): number {
  let score = 0

  if (a.problemType !== '' && a.problemType === b.problemType) {
    score += 100
  }

  const aTags = new Set(a.tags.map(t => t.toLowerCase()))
  for (const tag of b.tags) {
    if (aTags.has(tag.toLowerCase())) score += 10
  }

  const moduleTokens = (signals: PatternSourceSignals) =>
    signals.module
      .toLowerCase()
      .split(/[/.\-_]/u)
      .filter(t => t.length >= 3)
  const aModuleTokens = new Set(moduleTokens(a))
  for (const token of moduleTokens(b)) {
    if (aModuleTokens.has(token)) score += 10
  }

  const aTitleTokens = new Set(a.titleTokens.map(t => t.toLowerCase()))
  for (const token of b.titleTokens) {
    if (aTitleTokens.has(token.toLowerCase())) score += 10
  }

  return score
}

// ---------------------------------------------------------------------------
// Cluster building (union-find over pairwise overlap)
// ---------------------------------------------------------------------------

function findRoot(parent: Map<string, string>, id: string): string {
  let current = id
  while (parent.get(current) !== current) {
    const next = parent.get(current)
    if (next === undefined) break
    current = next
  }
  return current
}

function unionIds(parent: Map<string, string>, a: string, b: string): void {
  const rootA = findRoot(parent, a)
  const rootB = findRoot(parent, b)
  if (rootA !== rootB) {
    parent.set(rootA, rootB)
  }
}

/**
 * Group sources into clusters by pairwise correction-substance overlap
 * (union-find), then reject clusters that are too small or whose *combined*
 * pairwise overlap never exceeds a single shared generic tag.
 */
function buildRawClusters(sources: PatternCandidateSource[]): PatternCandidateSource[][] {
  const parent = new Map<string, string>()
  for (const source of sources) parent.set(source.id, source.id)

  // Track whether any pair within an eventual cluster crossed the overlap threshold.
  const strongPairs = new Set<string>()

  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const sourceI = sources[i]
      const sourceJ = sources[j]
      if (sourceI === undefined || sourceJ === undefined) continue
      const score = computeSourceOverlapScore(sourceI.signals, sourceJ.signals)
      if (score >= CLUSTER_OVERLAP_THRESHOLD) {
        unionIds(parent, sourceI.id, sourceJ.id)
        strongPairs.add(sourceI.id)
        strongPairs.add(sourceJ.id)
      }
    }
  }

  const groups = new Map<string, PatternCandidateSource[]>()
  for (const source of sources) {
    const root = findRoot(parent, source.id)
    const existing = groups.get(root) ?? []
    existing.push(source)
    groups.set(root, existing)
  }

  const clusters: PatternCandidateSource[][] = []
  for (const group of groups.values()) {
    if (group.length < MIN_CLUSTER_SOURCES) continue
    // Reject clusters where no member ever crossed the strong-overlap threshold with
    // another member (defensive; union-find only merges on threshold crossing, but this
    // guards against isolated members riding along via transitive same-root merges).
    const hasStrongMember = group.some(s => strongPairs.has(s.id))
    if (!hasStrongMember) continue
    clusters.push([...group].sort((a, b) => a.id.localeCompare(b.id)))
  }

  return clusters
}

// ---------------------------------------------------------------------------
// Score bucket + evidence strength ranking
// ---------------------------------------------------------------------------

/**
 * Reject candidates whose evidence is broad/generic or whose sources carry no
 * human-readable correction substance yet, even though clustering merged them.
 *
 * Two deterministic rules, either of which disqualifies a candidate:
 * 1. Overbroad: cluster size exceeds `OVERBROAD_CLUSTER_SIZE_THRESHOLD` and the sources
 *    do not all share one specific non-empty `problem_type` — a large cluster held
 *    together only by scattered module/tag/title-token overlap is a generic grouping,
 *    not a decision-ready recurring pattern.
 * 2. Hash-title learning proposals: more than half the cluster's sources are
 *    learning-proposal issues whose title is still the neutral `Learning proposal:
 *    (<shortSha>)` placeholder — these carry no human-readable signal until codified
 *    into a solution doc or retitled.
 */
function isLowQualityCandidate(sources: PatternCandidateSource[]): boolean {
  if (sources.length > OVERBROAD_CLUSTER_SIZE_THRESHOLD) {
    const problemTypes = new Set(sources.map(s => s.signals.problemType).filter(t => t !== ''))
    if (problemTypes.size !== 1) return true
  }

  const hashTitleCount = sources.filter(
    s => s.kind === 'learning-proposal' && HASH_ONLY_LEARNING_TITLE_PATTERN.test(s.title.trim().toLowerCase()),
  ).length
  if (hashTitleCount > sources.length / 2) return true

  return false
}

function scoreBucketFor(sources: PatternCandidateSource[]): PatternCandidateScoreBucket {
  const uniqueSourceCount = new Set(sources.map(s => s.id)).size
  const hasAcceptedGradeEvidence = sources.some(s => s.kind === 'solution-doc')
  if (uniqueSourceCount >= 3 && hasAcceptedGradeEvidence) return 'strong'
  if (uniqueSourceCount >= 2) return 'moderate'
  return 'weak'
}

function mostRecentDate(sources: PatternCandidateSource[]): string {
  let latest = ''
  for (const source of sources) {
    if (source.date > latest) latest = source.date
  }
  return latest
}

function stableSourceIdOrder(sourceIds: string[]): string {
  return [...sourceIds].sort((a, b) => a.localeCompare(b)).join(',')
}

/**
 * Rank candidates by evidence strength: unique independent sources, then accepted
 * solution-doc presence, then recency, then a topic-bucket (module/problem_type)
 * tiebreaker, then deterministic lexical source-ID order. Topic-bucket fairness is a
 * tiebreaker only — it must never override stronger evidence signals.
 */
function rankCandidates(candidates: PatternCandidate[]): PatternCandidate[] {
  const bucketRank: Record<PatternCandidateScoreBucket, number> = {strong: 2, moderate: 1, weak: 0}

  return [...candidates].sort((a, b) => {
    const uniqueA = new Set(a.sourceIds).size
    const uniqueB = new Set(b.sourceIds).size
    if (uniqueA !== uniqueB) return uniqueB - uniqueA

    const hasSolutionDocA = a.sources.some(s => s.kind === 'solution-doc') ? 1 : 0
    const hasSolutionDocB = b.sources.some(s => s.kind === 'solution-doc') ? 1 : 0
    if (hasSolutionDocA !== hasSolutionDocB) return hasSolutionDocB - hasSolutionDocA

    const dateA = mostRecentDate(a.sources)
    const dateB = mostRecentDate(b.sources)
    if (dateA !== dateB) return dateA > dateB ? -1 : 1

    const bucketA = bucketRank[a.scoreBucket]
    const bucketB = bucketRank[b.scoreBucket]
    if (bucketA !== bucketB) return bucketB - bucketA

    // Topic-bucket tiebreaker only, derived from module/problem_type — used solely to
    // break ties that survive every stronger signal above.
    const topicA = `${a.sources[0]?.signals.problemType ?? ''}:${a.sources[0]?.signals.module ?? ''}`
    const topicB = `${b.sources[0]?.signals.problemType ?? ''}:${b.sources[0]?.signals.module ?? ''}`
    if (topicA !== topicB) return topicA.localeCompare(topicB)

    return stableSourceIdOrder(a.sourceIds).localeCompare(stableSourceIdOrder(b.sourceIds))
  })
}

// ---------------------------------------------------------------------------
// Suppression state resolution
// ---------------------------------------------------------------------------

interface ClosedSuppressionRecord {
  fingerprint: string
  sourceIds: Set<string>
  outcome: 'rejected' | 'needs-outcome' | 'superseded' | 'deferred' | 'malformed-outcome' | 'conflicting-labels'
  issueNumber: number
}

/**
 * Outcomes treated as conservatively suppressed (same bucket as `needs-outcome`):
 * an ambiguous or malformed closed outcome must never be read as "safe to re-propose"
 * without new independent evidence.
 */
const CONSERVATIVE_SUPPRESSION_OUTCOMES = new Set([
  'rejected',
  'needs-outcome',
  'malformed-outcome',
  'conflicting-labels',
])

function resolveClosedSuppressionRecords(existing: ExistingPatternProposals): ClosedSuppressionRecord[] {
  const records: ClosedSuppressionRecord[] = []
  for (const [fingerprint, issues] of existing.closedByFingerprint) {
    for (const issue of issues) {
      const outcome = classifyPatternProposalOutcome(issue)
      if (
        outcome !== 'rejected' &&
        outcome !== 'needs-outcome' &&
        outcome !== 'superseded' &&
        outcome !== 'deferred' &&
        outcome !== 'malformed-outcome' &&
        outcome !== 'conflicting-labels'
      ) {
        continue
      }
      const sourceIds = parsePatternProposalSourceIds(issue.body ?? '') ?? []
      records.push({fingerprint, sourceIds: new Set(sourceIds), outcome, issueNumber: issue.number})
    }
  }
  return records
}

/** Retired source IDs: sources already represented by an accepted proposal, open or closed. */
function resolveRetiredSourceIds(existing: ExistingPatternProposals): Set<string> {
  const retired = new Set<string>()
  const scan = (issues: ExistingPatternProposalIssue[]) => {
    for (const issue of issues) {
      if (!issue.labels.includes('pattern-proposal:accepted')) continue
      const sourceIds = parsePatternProposalSourceIds(issue.body ?? '') ?? []
      for (const id of sourceIds) retired.add(id)
    }
  }
  for (const issues of existing.openByFingerprint.values()) scan(issues)
  for (const issues of existing.closedByFingerprint.values()) scan(issues)
  return retired
}

function isSubsetOrWeakSuperset(candidateIds: Set<string>, referenceIds: Set<string>): boolean {
  if (referenceIds.size === 0) return false
  // Exact match or candidate is a subset of the reference.
  const isSubset = [...candidateIds].every(id => referenceIds.has(id))
  if (isSubset) return true
  // Weak superset: candidate contains all reference IDs plus fewer than the upgrade
  // threshold of new IDs.
  const containsAllReference = [...referenceIds].every(id => candidateIds.has(id))
  if (!containsAllReference) return false
  const newIds = [...candidateIds].filter(id => !referenceIds.has(id))
  return newIds.length < HARD_SUPPRESSION_UPGRADE_THRESHOLD
}

// ---------------------------------------------------------------------------
// Unsafe evidence check (title validated via public-output gate)
// ---------------------------------------------------------------------------

function candidateHasUnsafeEvidence(candidate: PatternCandidate, tokens: PublicOutputTokens): boolean {
  for (const source of candidate.sources) {
    const gate = applyPublicOutputGate({
      surface: 'proposal-body',
      content: source.title,
      tokens,
      fingerprint: candidate.fingerprint,
    })
    if (!gate.allowed) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export interface PlanPatternCandidatesInput {
  sources: PatternCandidateSource[]
  existing: ExistingPatternProposals
  cap?: number
  publicOutputTokens: PublicOutputTokens
}

/**
 * Build deterministic cluster candidates from source artifacts and decide which
 * candidates may proceed to the agent drafting step.
 *
 * Filter order (fixed): weak cluster -> quality suppression (overbroad / hash-title-only) ->
 * open-proposal overlap -> hard suppression -> soft suppression (without upgrade threshold) ->
 * unsafe evidence placeholder -> rank -> cap.
 *
 * Pure function: no I/O, no side effects.
 */
export function planPatternCandidates(input: PlanPatternCandidatesInput): PatternPlannerResult {
  const cap = input.cap ?? DEFAULT_CAP
  const tokens = input.publicOutputTokens

  const counts: PatternPlannerCounts = {
    proposed: 0,
    capped: 0,
    lowSignal: 0,
    duplicateOpenOverlap: 0,
    hardSuppressed: 0,
    softSuppressed: 0,
    unsafe: 0,
    invalidSource: 0,
    noOp: 0,
    failed: 0,
    qualitySuppressed: 0,
  }

  // Accepted proposals immediately retire their source IDs from active clustering.
  const retiredSourceIds = resolveRetiredSourceIds(input.existing)
  const activeSources = input.sources.filter(s => !retiredSourceIds.has(s.id))

  const rawClusters = buildRawClusters(activeSources)
  // Low-signal accounting: at least two sources were available to compare but none
  // survived clustering (weak overlap only) — counted once per run, not per source.
  if (activeSources.length >= MIN_CLUSTER_SOURCES && rawClusters.length === 0) {
    counts.lowSignal = 1
  }

  const builtCandidates: PatternCandidate[] = rawClusters.map(clusterSources => {
    const sourceIds = clusterSources.map(s => s.id)
    return {
      fingerprint: buildSourceFingerprint(sourceIds),
      sourceIds: [...sourceIds].sort((a, b) => a.localeCompare(b)),
      sources: clusterSources,
      scoreBucket: scoreBucketFor(clusterSources),
    }
  })

  const afterQualityFilter: PatternCandidate[] = []
  for (const candidate of builtCandidates) {
    if (isLowQualityCandidate(candidate.sources)) {
      counts.qualitySuppressed += 1
      continue
    }
    afterQualityFilter.push(candidate)
  }

  const closedRecords = resolveClosedSuppressionRecords(input.existing)

  const afterOpenOverlap: PatternCandidate[] = []
  for (const candidate of afterQualityFilter) {
    const openMatches = input.existing.openByFingerprint.get(candidate.fingerprint)
    const candidateIds = new Set(candidate.sourceIds)
    let overlapsOpen = openMatches !== undefined && openMatches.length > 0
    if (!overlapsOpen) {
      for (const issues of input.existing.openByFingerprint.values()) {
        for (const issue of issues) {
          const openIds = new Set(parsePatternProposalSourceIds(issue.body ?? '') ?? [])
          // Any exact, subset, or superset overlap with a still-open proposal suppresses
          // the candidate unconditionally — an open proposal is not yet resolved, so
          // adding new sources must never bypass it while it remains open.
          if (hasAnyIdOverlap(candidateIds, openIds)) {
            overlapsOpen = true
            break
          }
        }
        if (overlapsOpen) break
      }
    }
    if (overlapsOpen) {
      counts.duplicateOpenOverlap += 1
      continue
    }
    afterOpenOverlap.push(candidate)
  }

  const afterHardSuppression: PatternCandidate[] = []
  for (const candidate of afterOpenOverlap) {
    const candidateIds = new Set(candidate.sourceIds)
    let hardSuppressed = false
    for (const record of closedRecords) {
      if (record.outcome === 'deferred') continue
      if (record.outcome === 'superseded') {
        // Superseded: permanently hard-suppressed for exact/subset/superset matches.
        if (
          isSubsetOrWeakSuperset(candidateIds, record.sourceIds) ||
          isExactOrSuperset(candidateIds, record.sourceIds)
        ) {
          hardSuppressed = true
          break
        }
        continue
      }
      if (!CONSERVATIVE_SUPPRESSION_OUTCOMES.has(record.outcome)) continue
      // rejected / needs-outcome / malformed-outcome / conflicting-labels: conservatively
      // treated as suppressed — subset or weak superset unless >= 2 new sources.
      if (isSubsetOrWeakSuperset(candidateIds, record.sourceIds)) {
        hardSuppressed = true
        break
      }
    }
    if (hardSuppressed) {
      counts.hardSuppressed += 1
      continue
    }
    afterHardSuppression.push(candidate)
  }

  const afterSoftSuppression: PatternCandidate[] = []
  for (const candidate of afterHardSuppression) {
    const candidateIds = new Set(candidate.sourceIds)
    let softSuppressed = false
    let supersedesFingerprint: string | undefined
    for (const record of closedRecords) {
      if (record.outcome !== 'deferred') continue
      const containsAllReference = [...record.sourceIds].every(id => candidateIds.has(id))
      if (!containsAllReference) continue
      const newIds = [...candidateIds].filter(id => !record.sourceIds.has(id))
      if (newIds.length >= SOFT_SUPPRESSION_UPGRADE_THRESHOLD) {
        supersedesFingerprint = record.fingerprint
      } else {
        softSuppressed = true
      }
      break
    }
    if (softSuppressed) {
      counts.softSuppressed += 1
      continue
    }
    afterSoftSuppression.push(
      supersedesFingerprint === undefined ? candidate : {...candidate, supersedes: supersedesFingerprint},
    )
  }

  const afterUnsafe: PatternCandidate[] = []
  for (const candidate of afterSoftSuppression) {
    if (candidateHasUnsafeEvidence(candidate, tokens)) {
      counts.unsafe += 1
      continue
    }
    afterUnsafe.push(candidate)
  }

  const ranked = rankCandidates(afterUnsafe)
  const capped = ranked.slice(0, cap)
  counts.capped = Math.max(0, ranked.length - capped.length)
  counts.proposed = capped.length

  if (
    counts.proposed === 0 &&
    counts.duplicateOpenOverlap === 0 &&
    counts.hardSuppressed === 0 &&
    counts.softSuppressed === 0 &&
    counts.unsafe === 0 &&
    counts.lowSignal === 0 &&
    counts.qualitySuppressed === 0
  ) {
    counts.noOp = 1
  }

  return {candidates: capped, counts}
}

function isExactOrSuperset(candidateIds: Set<string>, referenceIds: Set<string>): boolean {
  if (referenceIds.size === 0) return false
  return [...referenceIds].every(id => candidateIds.has(id))
}

/**
 * True when candidateIds and referenceIds are an exact match, or either is a subset of
 * the other. Used for open-proposal overlap suppression, where any such relation must
 * suppress the candidate unconditionally — no upgrade-threshold bypass while the
 * referenced proposal remains open.
 */
function hasAnyIdOverlap(candidateIds: Set<string>, referenceIds: Set<string>): boolean {
  if (referenceIds.size === 0 || candidateIds.size === 0) return false
  const candidateSubsetOfReference = [...candidateIds].every(id => referenceIds.has(id))
  const referenceSubsetOfCandidate = [...referenceIds].every(id => candidateIds.has(id))
  return candidateSubsetOfReference || referenceSubsetOfCandidate
}

// ---------------------------------------------------------------------------
// Digest schema
// ---------------------------------------------------------------------------

/**
 * Versioned candidate digest. Allowed fields only: fingerprint, source IDs, SHA-pinned
 * source links, public-safe source titles, evidence counts, score bucket, suggested
 * next actions, and run counts. Source titles are gated through
 * `applyPublicOutputGate` before entering the digest.
 */
export interface PatternCandidateDigest {
  fingerprint: string
  sourceIds: string[]
  sourceLinks: string[]
  sourceTitles: string[]
  evidenceCount: number
  scoreBucket: PatternCandidateScoreBucket
  suggestedNextAction: string
  runCount: number
  supersedes?: string
}

export interface BuildCandidateDigestInput {
  candidate: PatternCandidate
  runCount: number
  publicOutputTokens: PublicOutputTokens
}

/**
 * Build a versioned candidate digest from a planner candidate. Source titles are
 * validated through `applyPublicOutputGate` before entering the digest; any title that
 * fails the gate is replaced with an opaque placeholder rather than leaking blocked text.
 */
export function buildCandidateDigest(input: BuildCandidateDigestInput): PatternCandidateDigest {
  const tokens = input.publicOutputTokens

  const sortedSources = [...input.candidate.sources].sort((a, b) => a.id.localeCompare(b.id))

  const sourceTitles = sortedSources.map(source => {
    const gate = applyPublicOutputGate({
      surface: 'proposal-body',
      content: source.title,
      tokens,
      fingerprint: input.candidate.fingerprint,
    })
    return gate.allowed ? gate.sanitizedContent : '[source title withheld: failed public-output gate]'
  })

  const digest: PatternCandidateDigest = {
    fingerprint: input.candidate.fingerprint,
    sourceIds: input.candidate.sourceIds,
    sourceLinks: sortedSources.map(s => s.link),
    sourceTitles,
    evidenceCount: input.candidate.sourceIds.length,
    scoreBucket: input.candidate.scoreBucket,
    suggestedNextAction: 'draft-proposal',
    runCount: input.runCount,
  }

  if (input.candidate.supersedes !== undefined) {
    digest.supersedes = input.candidate.supersedes
  }

  return digest
}

// ---------------------------------------------------------------------------
// Entry point (detect/digest step: collect sources, plan candidates, write digest)
// ---------------------------------------------------------------------------

/** Counts-only run summary written to stdout and CAPTURE_PATTERNS_RESULT_PATH. */
export interface PatternDetectResult {
  sourcesLoaded: number
  invalidSources: number
  candidatesScanned: number
  lowSignalSkipped: number
  duplicateOpenOverlap: number
  hardSuppressed: number
  softSuppressed: number
  unsafe: number
  capped: number
  candidatesEmitted: number
  tokenLoadFailure: boolean
  scanFailure: boolean
  qualitySuppressed: number
}

/** Result of loading solution-doc files from disk: contents plus unreadable-file count. */
export interface LoadSolutionDocFilesResult {
  files: Record<string, string>
  /** Count of files that were listed but could not be read (e.g. permission/IO error). */
  readFailures: number
}

/**
 * Load solution-doc file contents from disk. A directory-listing failure is treated as
 * "no files in that subdir" (best-effort), but a file that is listed and then fails to
 * read is a real corpus gap: it is reported via `readFailures` so callers fold it into
 * `invalidSources` rather than silently dropping evidence.
 */
export async function loadSolutionDocFilesFromDisk(
  writeStderr: (message: string) => void = message => process.stderr.write(message),
): Promise<LoadSolutionDocFilesResult> {
  const files: Record<string, string> = {}
  let readFailures = 0

  for (const subdir of SOLUTION_SUBDIRS) {
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
        writeStderr(`capture-patterns-cluster: could not read file (path: ${path})\n`)
      }
    }
  }

  return {files, readFailures}
}

/** Minimal shape of an issue returned by `paginate(listForRepo)` for learning-proposal collection. */
interface RawLearningProposalIssue {
  readonly number: number
  readonly body?: string | null
  readonly title?: string | null
  readonly created_at?: string
  readonly labels?: readonly (string | {readonly name?: string | null})[]
}

/** Octokit surface needed for detect: paginated issue listing plus pattern-proposal reads. */
interface PatternDetectOctokitClient extends PatternProposalOctokitClient {
  readonly paginate: (fn: unknown, params: Record<string, unknown>) => Promise<RawLearningProposalIssue[]>
}

async function fetchLearningProposalIssuesFromRepo(
  octokit: PatternDetectOctokitClient,
  owner: string,
  repo: string,
): Promise<LearningProposalIssueInput[]> {
  const raw = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    labels: 'learning-proposal',
    per_page: 100,
  })

  return raw.map(issue => ({
    number: issue.number,
    body: issue.body,
    title: issue.title ?? '',
    createdAt: issue.created_at ?? '',
    labels: (issue.labels ?? []).map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
  }))
}

/**
 * Write the candidate digest to CAPTURE_PATTERNS_DIGEST_PATH.
 *
 * Fail-closed contract: a missing/empty digest path is a configuration error, not a
 * silent no-op — the caller must know the digest was never persisted so the run result
 * reflects a scan failure rather than reporting emitted candidates that were never
 * written anywhere.
 */
async function writePatternDigestFile(digestCandidates: PatternCandidateDigest[]): Promise<void> {
  const digestPath = process.env.CAPTURE_PATTERNS_DIGEST_PATH
  if (digestPath === undefined || digestPath === '') {
    throw new Error('capture-patterns-cluster: CAPTURE_PATTERNS_DIGEST_PATH is required to persist the digest')
  }
  await writeFile(digestPath, `${JSON.stringify(digestCandidates)}\n`, {flag: 'w'})
}

/**
 * CLI entry point for the detect/digest step: collects the allowed source corpus
 * (solution docs + learning-proposal issues), plans deterministic cluster candidates,
 * and writes a versioned candidate digest to CAPTURE_PATTERNS_DIGEST_PATH.
 *
 * Best-effort: any error falls back to an empty digest and exit 0 — this step must
 * never fail the workflow. Errors are logged as counts-only, never with message text
 * that could leak content.
 *
 * Token-load ordering: the privacy token load is attempted BEFORE any GitHub API call.
 * If it fails, no API calls are made at all (a failed load must never gate access to
 * data it was supposed to redact) and the run writes an empty digest/counts with
 * `tokenLoadFailure: true`.
 */
async function main(): Promise<void> {
  const owner = 'fro-bot'
  const repo = '.github'

  const result: PatternDetectResult = {
    sourcesLoaded: 0,
    invalidSources: 0,
    candidatesScanned: 0,
    lowSignalSkipped: 0,
    duplicateOpenOverlap: 0,
    hardSuppressed: 0,
    softSuppressed: 0,
    unsafe: 0,
    capped: 0,
    candidatesEmitted: 0,
    tokenLoadFailure: false,
    scanFailure: false,
    qualitySuppressed: 0,
  }

  let digestCandidates: PatternCandidateDigest[] = []

  try {
    const {loadPrivateTokensFromDisk} = await import('./capture-learnings-privacy.ts')
    const {loadRedactedCanonicalIdsFromDisk} = await import('./status-truth-proposals.ts')
    const {makePublicOutputTokens} = await import('./status-truth-public-output.ts')

    let publicOutputTokens: PublicOutputTokens
    try {
      const [privateTokens, redactedCanonicalIds] = await Promise.all([
        loadPrivateTokensFromDisk(),
        loadRedactedCanonicalIdsFromDisk(),
      ])
      publicOutputTokens = makePublicOutputTokens({privateTokens, redactedCanonicalIds})
    } catch {
      // Token load failed before any GitHub API call was made: skip all API calls and
      // write an empty digest/counts. Logs stay counts-only.
      result.tokenLoadFailure = true
      await writePatternDigestFile([])
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return
    }

    const {createOctokitFromEnv} = await import('./capture-learnings-harvest.ts')
    const octokit = (await createOctokitFromEnv()) as unknown as PatternDetectOctokitClient
    const headSha = process.env.GITHUB_SHA ?? ''

    const [solutionDocs, learningProposalIssues, existing] = await Promise.all([
      loadSolutionDocFilesFromDisk(),
      fetchLearningProposalIssuesFromRepo(octokit, owner, repo),
      fetchExistingPatternProposals({octokit, owner, repo}),
    ])

    const solutionSources = collectSolutionDocSources(solutionDocs.files, headSha)
    const learningSources = collectLearningProposalSources(learningProposalIssues)

    result.sourcesLoaded = solutionSources.sources.length + learningSources.sources.length
    // Files that were listed but failed to read are a real corpus gap, not a silent
    // drop — fold them into invalidSources alongside malformed/duplicate sources.
    result.invalidSources = solutionSources.invalidCount + learningSources.invalidCount + solutionDocs.readFailures

    const sources: PatternCandidateSource[] = [...solutionSources.sources, ...learningSources.sources]

    const plan = planPatternCandidates({sources, existing, publicOutputTokens})

    result.candidatesScanned =
      plan.counts.proposed +
      plan.counts.capped +
      plan.counts.lowSignal +
      plan.counts.duplicateOpenOverlap +
      plan.counts.hardSuppressed +
      plan.counts.softSuppressed +
      plan.counts.unsafe +
      plan.counts.qualitySuppressed
    result.lowSignalSkipped = plan.counts.lowSignal
    result.duplicateOpenOverlap = plan.counts.duplicateOpenOverlap
    result.hardSuppressed = plan.counts.hardSuppressed
    result.softSuppressed = plan.counts.softSuppressed
    result.unsafe = plan.counts.unsafe
    result.capped = plan.counts.capped
    result.qualitySuppressed = plan.counts.qualitySuppressed
    result.candidatesEmitted = plan.candidates.length

    digestCandidates = plan.candidates.map(candidate =>
      buildCandidateDigest({candidate, runCount: 1, publicOutputTokens}),
    )

    await writePatternDigestFile(digestCandidates)
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'unknown'
    process.stderr.write(`capture-patterns-cluster: unexpected error (${errorName}), falling back to empty digest\n`)
    result.scanFailure = true
    digestCandidates = []
    try {
      await writePatternDigestFile(digestCandidates)
    } catch {
      // ignore
    }
  }

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
