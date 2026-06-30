/**
 * Proposal lifecycle planner and I/O executor for the status-truth maintenance loop.
 *
 * Planner:
 * Converts drifted, privacy-safe status claims into deterministic GitHub issue
 * lifecycle actions without touching GitHub.
 *
 * Executor:
 * Executes planned proposal actions against GitHub via an injected Octokit-like
 * client. Supports dry-run mode (counts only, no mutations), label gating
 * (fail-closed if required labels cannot be confirmed), and same-run dedup.
 *
 * Design invariants:
 * - Pure planner: no I/O, no Octokit dependency.
 * - One fingerprint → one proposal issue. Multiple drifted claims in the same
 *   file remain separate issues so outcomes can differ per claim.
 * - Terminal labels (false-positive, rejected) suppress future matching findings
 *   unless claim text or source reference materially changes.
 * - Non-terminal closed issues (resolved, manually-fixed) are reopened when
 *   exact drift returns.
 * - Close-on-clear only when scan is complete and not an execution failure.
 * - Same-run created-key set prevents duplicate proposals from GitHub list lag.
 * - All proposal content passes through the public-output privacy gate.
 * - Unknown report schema/fingerprint versions are rejected before any planning.
 * - Executor fails closed on label gate failure; no proposals open without labels.
 * - Dry-run mode reports counts only; zero GitHub mutations.
 * - stdout/stderr carry counts only; no raw claim text, fingerprints, or tokens.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {RepoEntry} from './schemas.ts'
import type {PublicStatusTruthFinding, StatusTruthFinding, StatusTruthJsonReport} from './status-truth-detect.ts'
import {readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'

import {Octokit} from '@octokit/rest'
import {parse} from 'yaml'
import {isRecord, loadPrivateTokensFromDisk} from './capture-learnings-privacy.ts'
import {assertReposFile} from './schemas.ts'
import {KNOWN_FINGERPRINT_VERSION, KNOWN_SCHEMA_VERSION, validateStatusTruthArtifact} from './status-truth-detect.ts'
import {applyPublicOutputGate, makePublicOutputTokens, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Redacted canonical ID helpers
// ---------------------------------------------------------------------------

/**
 * Extract redacted canonical IDs (node_id and database_id as string) from private repo entries.
 *
 * Only entries with `private === true` contribute IDs. Public entries and entries with
 * `private` absent are excluded. This is the secondary denylist guard: node_id and
 * database_id values must never appear in any public output surface.
 *
 * Pure function: no I/O, no side effects.
 */
export function extractRedactedCanonicalIds(repos: readonly RepoEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of repos) {
    if (entry.private !== true) continue
    if (entry.node_id !== undefined && entry.node_id !== '') {
      ids.add(entry.node_id)
    }
    if (entry.database_id !== undefined) {
      ids.add(String(entry.database_id))
    }
  }
  return ids
}

/**
 * Load redacted canonical IDs from `metadata/repos.yaml`.
 *
 * Reads and validates the repos file, then delegates to `extractRedactedCanonicalIds`.
 *
 * Fail-closed contract:
 * - If the file cannot be read, parsed, or validated, this function THROWS.
 * - The caller MUST NOT emit any public output when this throws.
 * - Never use an empty set as a proxy for a failed load.
 *
 * @param readFileFn - Injectable readFile for testing (defaults to node:fs/promises readFile).
 */
export async function loadRedactedCanonicalIdsFromDisk(
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<Set<string>> {
  let reposYaml: string
  try {
    reposYaml = await readFileFn('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    throw new Error(
      'status-truth-proposals: could not read metadata/repos.yaml — redacted canonical ID gate cannot operate',
      {cause: error},
    )
  }

  let parsed: unknown
  try {
    parsed = parse(reposYaml)
  } catch (error: unknown) {
    throw new Error(
      'status-truth-proposals: could not parse metadata/repos.yaml — redacted canonical ID gate cannot operate',
      {cause: error},
    )
  }

  if (!isRecord(parsed)) {
    throw new TypeError(
      'status-truth-proposals: metadata/repos.yaml has unexpected shape — redacted canonical ID gate cannot operate',
    )
  }

  // Validate schema — throws SchemaValidationError on invalid shape
  assertReposFile(parsed, 'repos')

  return extractRedactedCanonicalIds(parsed.repos)
}

// ---------------------------------------------------------------------------
// Label constants
// ---------------------------------------------------------------------------

/** Primary label applied to all status-truth proposal issues. */
export const PROPOSAL_LABEL = 'status-truth'

/**
 * Outcome labels for tracking proposal lifecycle state.
 *
 * Terminal labels (false-positive, rejected): suppress future matching findings.
 * Non-terminal labels (accepted, manually-fixed, resolved, recurring, superseded):
 *   allow reopen or auto-close transitions.
 */
export const OUTCOME_LABELS = {
  accepted: 'status-truth:accepted',
  rejected: 'status-truth:rejected',
  falsePositive: 'status-truth:false-positive',
  superseded: 'status-truth:superseded',
  manuallyFixed: 'status-truth:manually-fixed',
  resolved: 'status-truth:resolved',
  recurring: 'status-truth:recurring',
} as const

/** Labels that permanently suppress future matching findings. */
const TERMINAL_LABELS: readonly string[] = [OUTCOME_LABELS.rejected, OUTCOME_LABELS.falsePositive]

/** Labels that are removed when a non-terminal closed issue is reopened. */
const RESOLVING_LABELS: readonly string[] = [OUTCOME_LABELS.resolved, OUTCOME_LABELS.manuallyFixed]

/**
 * Outcome labels that count as accuracy signals for per-kind usefulness math.
 * Only accepted, rejected, and false-positive are accuracy signals.
 * Other outcome labels (resolved, manually-fixed, recurring, superseded) are lifecycle
 * state labels, not accuracy signals.
 */
const ACCURACY_SIGNAL_LABELS: readonly string[] = [
  OUTCOME_LABELS.accepted,
  OUTCOME_LABELS.rejected,
  OUTCOME_LABELS.falsePositive,
]

/**
 * All recognized outcome labels (accuracy signals + lifecycle state labels).
 * Labels outside this set on a proposal issue are malformed outcome markers.
 */
const ALL_RECOGNIZED_OUTCOME_LABELS: readonly string[] = [
  OUTCOME_LABELS.accepted,
  OUTCOME_LABELS.rejected,
  OUTCOME_LABELS.falsePositive,
  OUTCOME_LABELS.superseded,
  OUTCOME_LABELS.manuallyFixed,
  OUTCOME_LABELS.resolved,
  OUTCOME_LABELS.recurring,
]

// ---------------------------------------------------------------------------
// Hidden marker constants
// ---------------------------------------------------------------------------

/** Marker prefix for fingerprint in issue body. */
const FINGERPRINT_MARKER_PREFIX = 'status-truth:fingerprint='

/** Marker prefix for live-state in issue body. */
const LIVE_STATE_MARKER_PREFIX = 'status-truth:live-state='

/** Pattern to extract fingerprint from hidden marker. Must be lowercase hex. */
const FINGERPRINT_MARKER_PATTERN = /<!-- status-truth:fingerprint=([a-f0-9]+) -->/u

/** Pattern to extract live-state from hidden marker. */
const LIVE_STATE_MARKER_PATTERN = /<!-- status-truth:live-state=([\w-]+) -->/u

// ---------------------------------------------------------------------------
// Outcome classification read-model
// ---------------------------------------------------------------------------

/**
 * Canonical outcome states for a proposal issue.
 *
 * These states are derived from the issue's labels and open/closed state.
 * They are read-only classifications — no mutation behavior here.
 *
 * | State | Derivation |
 * |---|---|
 * | proposed-pending | Open issue with no terminal/resolution label |
 * | explicit-accepted | Closed with `status-truth:accepted` label |
 * | explicit-rejected | Closed with `status-truth:rejected` label (terminal) |
 * | false-positive | Closed with `status-truth:false-positive` label (terminal) |
 * | resolved-positive | Closed with `status-truth:resolved` or `status-truth:manually-fixed` |
 * | superseded | Closed with `status-truth:superseded` label |
 * | needs-outcome | Closed with no recognized outcome label |
 * | conflicting-labels | Closed with mutually exclusive outcome labels (e.g. accepted+rejected) |
 * | malformed-outcome | Closed with unrecognized `status-truth:*` label |
 */
export type ProposalOutcomeState =
  | 'proposed-pending'
  | 'explicit-accepted'
  | 'explicit-rejected'
  | 'false-positive'
  | 'resolved-positive'
  | 'superseded'
  | 'needs-outcome'
  | 'conflicting-labels'
  | 'malformed-outcome'

/**
 * Classify a proposal issue into a canonical outcome state.
 *
 * Pure function: no I/O, no side effects. Deterministic from inputs.
 *
 * Classification rules (in priority order):
 * 1. Open issue → proposed-pending (regardless of labels)
 * 2. Closed issue with multiple mutually exclusive accuracy signal labels → conflicting-labels
 * 3. Closed issue with unrecognized `status-truth:*` label → malformed-outcome
 * 4. Closed issue with `accepted` label → explicit-accepted
 * 5. Closed issue with `rejected` label → explicit-rejected
 * 6. Closed issue with `false-positive` label → false-positive
 * 7. Closed issue with `resolved` or `manually-fixed` label → resolved-positive
 * 8. Closed issue with `superseded` label → superseded
 * 9. Closed issue with no recognized outcome label + drift still active → needs-outcome
 * 10. Closed issue with no recognized outcome label + drift cleared → resolved-positive
 *
 * @param issue - The proposal issue to classify.
 * @param driftActive - Whether the same drift fingerprint is still active in the current scan.
 *   When false, a closed issue with no terminal/resolution label is classified as resolved-positive
 *   (drift cleared without an explicit label). When true, it remains needs-outcome.
 */
export function classifyProposalOutcome(issue: ExistingProposalIssue, driftActive: boolean): ProposalOutcomeState {
  // Rule 1: Open issue → proposed-pending
  if (issue.state === 'open') {
    return 'proposed-pending'
  }

  // Extract status-truth:* outcome labels (excluding the primary proposal label)
  const outcomeLabels = issue.labels.filter(l => l !== PROPOSAL_LABEL && l.startsWith('status-truth:'))

  // Rule 2: Conflicting accuracy signal labels (mutually exclusive)
  const accuracySignals = outcomeLabels.filter(l => ACCURACY_SIGNAL_LABELS.includes(l))
  if (accuracySignals.length > 1) {
    return 'conflicting-labels'
  }

  // Rule 3: Unrecognized status-truth:* label → malformed-outcome
  const unrecognized = outcomeLabels.filter(l => !ALL_RECOGNIZED_OUTCOME_LABELS.includes(l))
  if (unrecognized.length > 0) {
    return 'malformed-outcome'
  }

  // Rules 4-8: Single recognized outcome label
  if (outcomeLabels.includes(OUTCOME_LABELS.accepted)) return 'explicit-accepted'
  if (outcomeLabels.includes(OUTCOME_LABELS.rejected)) return 'explicit-rejected'
  if (outcomeLabels.includes(OUTCOME_LABELS.falsePositive)) return 'false-positive'
  if (outcomeLabels.includes(OUTCOME_LABELS.resolved) || outcomeLabels.includes(OUTCOME_LABELS.manuallyFixed)) {
    return 'resolved-positive'
  }
  if (outcomeLabels.includes(OUTCOME_LABELS.superseded)) return 'superseded'

  // Rules 9-10: No recognized outcome label — use driftActive to distinguish
  // If drift is no longer active (fingerprint not in current scan), the issue was
  // closed without an explicit label but the drift has cleared → resolved-positive.
  // If drift is still active, the issue needs operator attention → needs-outcome.
  if (!driftActive) return 'resolved-positive'
  return 'needs-outcome'
}

/**
 * Aggregate outcome counts from a set of proposal issues.
 *
 * Pure function: no I/O, no side effects.
 * Output is counts-only: no raw issue bodies, titles, paths, or fingerprints.
 *
 * Counts are separated from action counts (opened/updated/reopened/closed/suppressed).
 * This is the read-model for operator outcome signal — used for accuracy math and
 * operator attention, not for lifecycle mutation decisions.
 */
export interface OutcomeCounts {
  /** Open proposals with no terminal/resolution label. */
  readonly proposedPending: number
  /** Closed proposals with explicit `accepted` label (human-confirmed positive). */
  readonly explicitAccepted: number
  /** Closed proposals with explicit `rejected` label (terminal suppression). */
  readonly explicitRejected: number
  /** Closed proposals with `false-positive` label (terminal suppression). */
  readonly falsePositive: number
  /**
   * Closed proposals with `resolved` or `manually-fixed` label.
   * Positive signal without impersonating explicit human acceptance.
   */
  readonly resolvedPositive: number
  /** Closed proposals with `superseded` label. */
  readonly superseded: number
  /**
   * Closed proposals with no recognized outcome label.
   * Excluded from accuracy math; counted for operator attention.
   */
  readonly needsOutcome: number
  /**
   * Closed proposals with mutually exclusive outcome labels (e.g. accepted+rejected).
   * Excluded from accuracy math; counted for operator attention.
   */
  readonly conflictingLabels: number
  /**
   * Closed proposals with unrecognized `status-truth:*` labels.
   * Excluded from accuracy math; counted for operator attention.
   */
  readonly malformedOutcome: number
}

/**
 * Build aggregate outcome counts from a list of existing proposal issues.
 *
 * Pure function: no I/O, no side effects. Deterministic from inputs.
 * Output is counts-only — no raw issue bodies, titles, paths, or fingerprints.
 *
 * @param issues - Existing proposal issues (open and closed).
 * @param driftActiveFingerprints - Set of fingerprints that are still active in the current scan.
 *   Used to distinguish resolved-positive (drift cleared) from needs-outcome (drift still active)
 *   for closed issues with no terminal/resolution label. Defaults to empty set (all drift cleared).
 */
export function buildOutcomeCounts(
  issues: readonly ExistingProposalIssue[],
  driftActiveFingerprints: ReadonlySet<string> = new Set<string>(),
): OutcomeCounts {
  let proposedPending = 0
  let explicitAccepted = 0
  let explicitRejected = 0
  let falsePositive = 0
  let resolvedPositive = 0
  let superseded = 0
  let needsOutcome = 0
  let conflictingLabels = 0
  let malformedOutcome = 0

  for (const issue of issues) {
    // Only classify issues that have the proposal label
    if (!issue.labels.includes(PROPOSAL_LABEL)) continue

    // Determine if this issue's fingerprint is still active in the current scan.
    // Extract fingerprint from body to check against driftActiveFingerprints.
    const fp = extractProposalFingerprint(issue.body)
    const driftActive = fp !== null && driftActiveFingerprints.has(fp)

    const state = classifyProposalOutcome(issue, driftActive)
    switch (state) {
      case 'proposed-pending':
        proposedPending++
        break
      case 'explicit-accepted':
        explicitAccepted++
        break
      case 'explicit-rejected':
        explicitRejected++
        break
      case 'false-positive':
        falsePositive++
        break
      case 'resolved-positive':
        resolvedPositive++
        break
      case 'superseded':
        superseded++
        break
      case 'needs-outcome':
        needsOutcome++
        break
      case 'conflicting-labels':
        conflictingLabels++
        break
      case 'malformed-outcome':
        malformedOutcome++
        break
    }
  }

  return {
    proposedPending,
    explicitAccepted,
    explicitRejected,
    falsePositive,
    resolvedPositive,
    superseded,
    needsOutcome,
    conflictingLabels,
    malformedOutcome,
  }
}

// ---------------------------------------------------------------------------
// Input/output types
// ---------------------------------------------------------------------------

/** Simplified GitHub issue shape — no Octokit dependency. */
export interface ExistingProposalIssue {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly labels: readonly string[]
  readonly title: string
  readonly body: string | null | undefined
  /**
   * ISO 8601 timestamp when the issue was closed, if available from the API.
   * Used to compute cooldown for closed-without-outcome issues.
   * Absent or null when the API does not return this field.
   */
  readonly closedAt?: string | null
}

/** Open a new proposal issue. */
export interface OpenAction {
  readonly type: 'open'
  readonly fingerprint: string
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
}

/** Add an update comment to an existing open proposal. */
export interface UpdateCommentAction {
  readonly type: 'update-comment'
  readonly issueNumber: number
  readonly comment: string
}

/** Reopen a closed non-terminal proposal and add a recurrence comment. */
export interface ReopenAction {
  readonly type: 'reopen'
  readonly issueNumber: number
  readonly comment: string
  /** Labels to remove when reopening (e.g. resolved, manually-fixed). */
  readonly removeLabels: readonly string[]
  /** Labels to add when reopening (e.g. recurring). */
  readonly addLabels: readonly string[]
}

/** Close a proposal whose drift has cleared. */
export interface CloseAction {
  readonly type: 'close'
  readonly issueNumber: number
  readonly labels: readonly string[]
  readonly comment: string
}

/** Suppress a finding due to terminal label (false-positive / rejected). */
export interface SuppressAction {
  readonly type: 'suppress'
  readonly fingerprint: string
  readonly reason: string
}

/** Discriminated union of all proposal lifecycle actions. */
export type ProposalAction = OpenAction | UpdateCommentAction | ReopenAction | CloseAction | SuppressAction

/** Per-kind accuracy signal from accepted/rejected/false-positive outcomes. */
export interface KindUsefulnessCounts {
  readonly accepted: number
  readonly rejected: number
  readonly falsePositive: number
}

/** Per-kind action counts for workflow/open result summary (counts-only, no paths or fingerprints). */
export interface KindActionCounts {
  readonly opened: number
  readonly updated: number
  readonly reopened: number
  readonly closed: number
  readonly suppressed: number
}

/** Aggregate counts returned by the planner. */
export interface ProposalCounts {
  readonly opened: number
  readonly updated: number
  readonly reopened: number
  readonly closed: number
  readonly suppressed: number
  readonly blocked: number
  /**
   * Mutating actions that were planned but blocked by the per-run mutation cap.
   * These are distinct from privacy-blocked actions (counted in `blocked`).
   * Overflow is a blocked outcome, not failed work — it must not hide scan completeness.
   */
  readonly overflowed: number
  readonly noAction: number
  readonly sameRunDeduplicated: number
  readonly malformedMarkers: number
  readonly versionRejected: number
  /**
   * Closed issues with a valid fingerprint but no recognized outcome label.
   * Counted for operator attention; not included in accuracy math.
   */
  readonly closedWithoutOutcome: number
  /**
   * Closed-without-outcome issues that are within the seven-day cooldown window,
   * or that have no closedAt timestamp (conservative: treated as needs-attention).
   * These are not reopened; counted for operator attention.
   * Distinct from privacy-blocked (blocked) and overflow (overflowed).
   */
  readonly needsOutcomeCooldown: number
  /**
   * Closed issues with a valid fingerprint but an unrecognized/malformed outcome label.
   * Counted for operator attention; excluded from usefulnessByKind accuracy math.
   */
  readonly malformedOutcomeMarkers: number
  /**
   * Closed issues with mutually exclusive outcome labels present together
   * (e.g. accepted+rejected, accepted+false-positive, rejected+false-positive).
   * Excluded from accuracy math; counted for operator attention.
   * These are distinct from malformedOutcomeMarkers (which have unrecognized labels).
   */
  readonly conflictingLabels: number
  /**
   * Per-kind accuracy signal from accepted/rejected/false-positive outcomes.
   * Computed from all existing issues with recognized outcome labels.
   * Excludes malformed/unknown labels.
   */
  readonly usefulnessByKind: Readonly<Record<string, KindUsefulnessCounts>>
}

/** Input to the pure lifecycle planner. */
export interface PlanStatusTruthProposalActionsInput {
  /** The status-truth report from the detect step. */
  readonly report: StatusTruthJsonReport
  /** Open and recently-closed proposal issues fetched from GitHub. */
  readonly existingIssues: readonly ExistingProposalIssue[]
  /** Loaded public-output token sets for privacy gating. */
  readonly publicOutputTokens: PublicOutputTokens
  /**
   * Fingerprints already created in this run (same-run dedup guard).
   * Prevents duplicate proposals when GitHub issue listing lags same-run writes.
   */
  readonly sameRunCreatedFingerprints: ReadonlySet<string>
  /**
   * Maximum number of mutating proposal actions (open, update-comment, reopen, close)
   * allowed per run. Evaluated after privacy blocking and same-run dedupe.
   * Actions beyond the cap are counted as overflowed (planned-but-blocked).
   * Defaults to 5.
   */
  readonly mutationCap?: number
  /**
   * Current timestamp for cooldown calculations. Defaults to `new Date()`.
   * Injectable for deterministic tests.
   */
  readonly now?: Date
}

/** Result of the pure lifecycle planner. */
export interface PlanStatusTruthProposalActionsResult {
  readonly actions: readonly ProposalAction[]
  readonly counts: ProposalCounts
  /**
   * Per-kind action counts for workflow/open result summary.
   * Counts-only: no paths, fingerprints, or claim text.
   */
  readonly countsByKind: Readonly<Record<string, KindActionCounts>>
  /**
   * Aggregate outcome counts from all existing proposal issues.
   * Read-model for operator outcome signal — separate from action counts (counts)
   * and planned per-kind counts (countsByKind). Reflects the current state of all
   * proposal issues, not the actions taken in this run.
   */
  readonly outcomeCounts: OutcomeCounts
}

// ---------------------------------------------------------------------------
// Hidden marker helpers
// ---------------------------------------------------------------------------

/**
 * Extract the fingerprint from a proposal issue body hidden marker.
 * Returns null if the body is absent, empty, or the marker is malformed.
 */
export function extractProposalFingerprint(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = FINGERPRINT_MARKER_PATTERN.exec(body)
  if (match === null) return null
  const value = match[1]
  // Require at least one hex character (empty value is malformed)
  if (value === undefined || value === '') return null
  return value
}

/**
 * Extract the recorded live-state from a proposal issue body hidden marker.
 * Returns null if absent or malformed.
 */
function extractRecordedLiveState(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = LIVE_STATE_MARKER_PATTERN.exec(body)
  if (match === null) return null
  const value = match[1]
  if (value === undefined || value === '') return null
  return value
}

/**
 * Build the hidden marker line for a fingerprint.
 */
function buildFingerprintMarker(fingerprint: string): string {
  return `<!-- ${FINGERPRINT_MARKER_PREFIX}${fingerprint} -->`
}

/**
 * Build the hidden marker line for a live-state.
 */
function buildLiveStateMarker(liveState: string): string {
  return `<!-- ${LIVE_STATE_MARKER_PREFIX}${liveState} -->`
}

// ---------------------------------------------------------------------------
// Cooldown helper
// ---------------------------------------------------------------------------

/** Seven-day cooldown duration in milliseconds. */
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Returns true when the given ISO 8601 closedAt timestamp is within the
 * seven-day cooldown window relative to `now`.
 *
 * Pure function: no I/O, no side effects. Accepts `now` for deterministic tests.
 *
 * Boundary: exactly seven days ago is NOT within cooldown (returns false).
 */
export function isWithinCooldown(closedAt: string, now: Date): boolean {
  const closedMs = new Date(closedAt).getTime()
  const elapsedMs = now.getTime() - closedMs
  return elapsedMs < COOLDOWN_MS
}

// ---------------------------------------------------------------------------
// Issue body / title builders
// ---------------------------------------------------------------------------

function buildProposalTitle(finding: PublicStatusTruthFinding): string {
  return `Status truth: ${finding.kind} drift in ${finding.path}`
}

function buildProposalBody(finding: PublicStatusTruthFinding, generatedAt: string): string {
  const liveStateMarker = finding.liveState === undefined ? '' : `\n${buildLiveStateMarker(finding.liveState)}`
  const correctionLine =
    finding.proposedCorrection === undefined ? '' : `\n**Proposed correction:** ${finding.proposedCorrection}`

  return [
    buildFingerprintMarker(finding.fingerprint),
    liveStateMarker,
    '',
    `**Kind:** \`${finding.kind}\``,
    `**Path:** \`${finding.path}\``,
    `**Source reference:** ${finding.sourceRef}`,
    `**Claimed state:** \`${finding.claimedState}\``,
    finding.liveState === undefined ? '' : `**Live state:** \`${finding.liveState}\``,
    correctionLine,
    '',
    `First detected at \`${generatedAt}\`.`,
  ]
    .filter(line => line !== '')
    .join('\n')
}

function buildUpdateComment(finding: PublicStatusTruthFinding, generatedAt: string): string {
  const liveStateLine = finding.liveState === undefined ? '' : `\n**Updated live state:** \`${finding.liveState}\``
  const correctionLine =
    finding.proposedCorrection === undefined ? '' : `\n**Proposed correction:** ${finding.proposedCorrection}`
  return `Live-state details changed at \`${generatedAt}\`.${liveStateLine}${correctionLine}`
}

function buildRecurrenceComment(generatedAt: string): string {
  return `Drift recurrence detected at \`${generatedAt}\`. This finding was previously resolved but has returned.`
}

function buildCloseComment(generatedAt: string): string {
  return `Drift cleared at \`${generatedAt}\`. Closing as resolved.`
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isPublicFinding(finding: StatusTruthFinding): finding is PublicStatusTruthFinding {
  return finding.verdict !== 'unsafe'
}

// ---------------------------------------------------------------------------
// Terminal label check
// ---------------------------------------------------------------------------

function hasTerminalLabel(labels: readonly string[]): boolean {
  return labels.some(l => TERMINAL_LABELS.includes(l))
}

// ---------------------------------------------------------------------------
// Pure lifecycle planner
// ---------------------------------------------------------------------------

/**
 * Plan status-truth proposal lifecycle actions from a detect report and existing issues.
 *
 * Pure function: no I/O, no Octokit dependency. Deterministic from inputs.
 *
 * Processing order:
 * 1. Reject unknown report versions immediately.
 * 2. Build lookup maps from existing issues (open and closed by fingerprint).
 * 3. Count malformed markers for operator attention.
 * 4. For each proposal-eligible drifted finding:
 *    a. Skip if in sameRunCreatedFingerprints (same-run dedup).
 *    b. Check for terminal suppression (false-positive / rejected closed issue).
 *    c. Check for matching open issue → no-action or update-comment.
 *    d. Check for matching non-terminal closed issue → reopen.
 *    e. Otherwise → open new proposal (after privacy gate).
 * 5. Close-on-clear: only when scan is complete and not execution-failure.
 */
export function planStatusTruthProposalActions(
  input: PlanStatusTruthProposalActionsInput,
): PlanStatusTruthProposalActionsResult {
  const {report, existingIssues, publicOutputTokens, sameRunCreatedFingerprints} = input
  const now = input.now ?? new Date()

  // 1. Reject unknown report versions
  if (report.schema_version !== KNOWN_SCHEMA_VERSION || report.fingerprint_version !== KNOWN_FINGERPRINT_VERSION) {
    return {
      actions: [],
      counts: {
        opened: 0,
        updated: 0,
        reopened: 0,
        closed: 0,
        suppressed: 0,
        blocked: 0,
        overflowed: 0,
        noAction: 0,
        sameRunDeduplicated: 0,
        malformedMarkers: 0,
        versionRejected: 1,
        closedWithoutOutcome: 0,
        needsOutcomeCooldown: 0,
        malformedOutcomeMarkers: 0,
        conflictingLabels: 0,
        usefulnessByKind: {},
      },
      countsByKind: {},
      outcomeCounts: buildOutcomeCounts(existingIssues),
    }
  }

  // 1b. Fail-closed on incomplete/failed scans.
  // Detection uncertainty (execution-failure or scan_complete=false) blocks all
  // public proposal actions. Findings from an incomplete scan cannot be trusted
  // as ground truth — opening/reopening/updating proposals on uncertain data
  // would create noise and potentially incorrect lifecycle transitions.
  // Close-on-clear is also blocked (handled separately below via canClose).
  if (!report.scan_complete || report.status === 'execution-failure') {
    // Count proposal-eligible findings as blocked for operator visibility
    const blockedCount = report.findings.filter(f => f.proposalEligible).length
    return {
      actions: [],
      counts: {
        opened: 0,
        updated: 0,
        reopened: 0,
        closed: 0,
        suppressed: 0,
        blocked: blockedCount,
        overflowed: 0,
        noAction: 0,
        sameRunDeduplicated: 0,
        malformedMarkers: 0,
        versionRejected: 0,
        closedWithoutOutcome: 0,
        needsOutcomeCooldown: 0,
        malformedOutcomeMarkers: 0,
        conflictingLabels: 0,
        usefulnessByKind: {},
      },
      countsByKind: {},
      outcomeCounts: buildOutcomeCounts(existingIssues),
    }
  }

  // 2. Build lookup maps from existing issues
  const openByFingerprint = new Map<string, ExistingProposalIssue>()
  const closedByFingerprint = new Map<string, ExistingProposalIssue>()
  let malformedMarkers = 0

  const usefulnessByKind: Record<string, {accepted: number; rejected: number; falsePositive: number}> = {}
  let closedWithoutOutcome = 0
  let malformedOutcomeMarkers = 0
  let conflictingLabels = 0

  for (const issue of existingIssues) {
    const fp = extractProposalFingerprint(issue.body)
    if (fp === null) {
      // Issue has no valid fingerprint marker — count as malformed if it has the proposal label
      if (issue.labels.includes(PROPOSAL_LABEL)) {
        malformedMarkers++
      }
      continue
    }

    if (issue.state === 'open') {
      openByFingerprint.set(fp, issue)
    } else {
      // Closed: keep the most recently seen (map will hold last one; caller should sort by updated desc)
      closedByFingerprint.set(fp, issue)

      // Only accuracy signal labels (accepted, rejected, false-positive) count for usefulness math.
      // Malformed/unknown outcome labels are counted for operator attention but excluded from math.
      const outcomeLabels = issue.labels.filter(l => l !== PROPOSAL_LABEL && l.startsWith('status-truth:'))
      const recognizedOutcomeLabels = outcomeLabels.filter(l => ALL_RECOGNIZED_OUTCOME_LABELS.includes(l))
      const unrecognizedOutcomeLabels = outcomeLabels.filter(l => !ALL_RECOGNIZED_OUTCOME_LABELS.includes(l))

      // Check for conflicting accuracy signal labels (mutually exclusive).
      // This is distinct from malformedOutcomeMarkers (which have unrecognized labels).
      // Conflicting = multiple accuracy signal labels on the same issue (e.g. accepted+rejected).
      const accuracySignalsPresent = recognizedOutcomeLabels.filter(l => ACCURACY_SIGNAL_LABELS.includes(l))
      const hasConflictingAccuracySignals = accuracySignalsPresent.length > 1

      if (unrecognizedOutcomeLabels.length > 0) {
        // Mixed or malformed outcome markers: increment counter and skip accuracy math entirely.
        // Conservative: if ANY unrecognized status-truth:* label is present alongside a recognized
        // accuracy signal label, the issue is treated as malformed for accuracy purposes.
        // The recognized label is NOT included in usefulnessByKind to avoid polluting accuracy math
        // with ambiguous outcome state.
        malformedOutcomeMarkers++
      } else if (hasConflictingAccuracySignals) {
        // Conflicting accuracy signal labels (e.g. accepted+rejected, accepted+false-positive).
        // Excluded from accuracy math; counted for operator attention.
        // These are recognized labels but mutually exclusive — the issue state is ambiguous.
        conflictingLabels++
      } else if (outcomeLabels.length === 0) {
        // Closed with no outcome label at all — count for operator attention
        closedWithoutOutcome++
      } else {
        // Only accumulate accuracy signals when there are NO unrecognized outcome labels
        // and NO conflicting accuracy signal labels.
        // This is intentionally conservative: we only count recognized accuracy signal labels
        // on issues that have no malformed/unknown outcome markers and no conflicts.
        for (const label of recognizedOutcomeLabels) {
          if (!ACCURACY_SIGNAL_LABELS.includes(label)) continue

          // Infer kind from issue title: "Status truth: <kind> drift in <path>"
          const titleMatch = /^Status truth: ([\w-]+) drift/u.exec(issue.title)
          const kind = titleMatch?.[1] ?? 'unknown'

          if (usefulnessByKind[kind] === undefined) {
            usefulnessByKind[kind] = {accepted: 0, rejected: 0, falsePositive: 0}
          }
          const entry = usefulnessByKind[kind]
          if (entry !== undefined) {
            if (label === OUTCOME_LABELS.accepted) {
              usefulnessByKind[kind] = {...entry, accepted: entry.accepted + 1}
            } else if (label === OUTCOME_LABELS.rejected) {
              usefulnessByKind[kind] = {...entry, rejected: entry.rejected + 1}
            } else if (label === OUTCOME_LABELS.falsePositive) {
              usefulnessByKind[kind] = {...entry, falsePositive: entry.falsePositive + 1}
            }
          }
        }
      }
    }
  }

  // Per-run mutation cap (default 5). Evaluated after privacy blocking and same-run dedupe.
  // Suppress actions are not mutating and do not count against the cap.
  const mutationCap = input.mutationCap ?? 5

  // Per-kind action counts for workflow/open result summary (counts-only, no paths or fingerprints).
  const countsByKind: Record<
    string,
    {opened: number; updated: number; reopened: number; closed: number; suppressed: number}
  > = {}

  function incrementKindCount(kind: string, field: 'opened' | 'updated' | 'reopened' | 'closed' | 'suppressed'): void {
    if (countsByKind[kind] === undefined) {
      countsByKind[kind] = {opened: 0, updated: 0, reopened: 0, closed: 0, suppressed: 0}
    }
    const entry = countsByKind[kind]
    if (entry !== undefined) {
      countsByKind[kind] = {...entry, [field]: entry[field] + 1}
    }
  }

  // Track which fingerprints are active in this report (for close-on-clear)
  const activeFingerprintsInReport = new Set<string>()

  // Track fingerprints handled in this planner call (same-run dedup within one report).
  // Prevents duplicate lifecycle actions when the same fingerprint appears in multiple findings
  // (e.g. same claim text in two files) within a single report.
  const plannedActionFingerprints = new Set<string>(sameRunCreatedFingerprints)

  // ---------------------------------------------------------------------------
  // Two-pass cap approach:
  // Pass 1: Collect all candidate mutating actions (privacy-gated, deduplicated)
  //         into priority buckets. Privacy-blocked and deduplicated actions do NOT
  //         consume cap budget.
  // Pass 2: Apply cap across buckets in deterministic priority order:
  //         close > update > reopen > open
  //         Actions beyond the cap become overflow (planned-but-blocked counts).
  // ---------------------------------------------------------------------------

  // Priority buckets for cap enforcement
  const candidateCloses: CloseAction[] = []
  const candidateUpdates: UpdateCommentAction[] = []
  const candidateReopens: ReopenAction[] = []
  const candidateOpens: OpenAction[] = []
  const suppressActions: SuppressAction[] = []

  // Track per-kind for suppressed (not cap-limited)
  const suppressedKinds: string[] = []

  let suppressed = 0
  let blocked = 0
  let noAction = 0
  let sameRunDeduplicated = 0
  let needsOutcomeCooldown = 0

  // 3. Process proposal-eligible findings — collect candidates into priority buckets
  for (const finding of report.findings) {
    // Skip unsafe findings — they have no identity-bearing fields and are never proposal-eligible
    if (!isPublicFinding(finding)) continue

    // Skip non-proposal-eligible findings (unresolved, current)
    if (!finding.proposalEligible) continue

    const {fingerprint, kind} = finding
    activeFingerprintsInReport.add(fingerprint)

    // a. Same-run dedup: skip if already created this run or already planned in this call.
    // plannedActionFingerprints starts with sameRunCreatedFingerprints and grows as actions are planned.
    if (plannedActionFingerprints.has(fingerprint)) {
      sameRunDeduplicated++
      continue
    }

    // b. Check for terminal suppression
    const closedIssue = closedByFingerprint.get(fingerprint)
    if (closedIssue !== undefined && hasTerminalLabel(closedIssue.labels)) {
      // Mark fingerprint as handled so any duplicate finding in this report is skipped.
      plannedActionFingerprints.add(fingerprint)
      suppressActions.push({
        type: 'suppress',
        fingerprint,
        reason: 'terminal outcome label on closed proposal',
      })
      suppressed++
      suppressedKinds.push(kind)
      continue
    }

    // c. Check for matching open issue
    const openIssue = openByFingerprint.get(fingerprint)
    if (openIssue !== undefined) {
      // Mark fingerprint as handled so any duplicate finding in this report is skipped.
      plannedActionFingerprints.add(fingerprint)

      // Compare recorded live-state to current live-state
      const recordedLiveState = extractRecordedLiveState(openIssue.body)
      const currentLiveState = finding.liveState

      if (recordedLiveState !== null && currentLiveState !== undefined && recordedLiveState !== currentLiveState) {
        // Live-state details changed — candidate update comment (privacy-gated)
        const comment = buildUpdateComment(finding, report.generated_at)
        const gateResult = applyPublicOutputGate({
          surface: 'proposal-comment',
          content: comment,
          tokens: publicOutputTokens,
          fingerprint,
        })
        if (!gateResult.allowed) {
          // Privacy-blocked: does NOT consume cap budget
          blocked++
          continue
        }
        candidateUpdates.push({
          type: 'update-comment',
          issueNumber: openIssue.number,
          comment: gateResult.sanitizedContent,
        })
      } else {
        // Drift unchanged — no action to avoid comment spam
        noAction++
      }
      continue
    }

    // d. Check for matching non-terminal closed issue → candidate reopen (with cooldown check)
    if (closedIssue !== undefined && !hasTerminalLabel(closedIssue.labels)) {
      // Mark fingerprint as handled so any duplicate finding in this report is skipped.
      plannedActionFingerprints.add(fingerprint)

      // Determine if this is a closed-without-outcome (needs-outcome) issue.
      // A closed issue with no recognized outcome label is in needs-outcome state.
      const outcomeLabels = closedIssue.labels.filter(l => l !== PROPOSAL_LABEL && l.startsWith('status-truth:'))
      const hasRecognizedOutcomeLabel = outcomeLabels.some(l => ALL_RECOGNIZED_OUTCOME_LABELS.includes(l))
      const isClosedWithoutOutcome = !hasRecognizedOutcomeLabel

      if (isClosedWithoutOutcome) {
        // Apply cooldown: if closedAt is missing or within 7 days, block reopen.
        // Conservative: missing closedAt → treat as needs-attention, no mutation.
        const closedAt = closedIssue.closedAt
        if (closedAt === null || closedAt === undefined) {
          // Cannot determine cooldown — conservative: count for attention, no mutation
          needsOutcomeCooldown++
          continue
        }
        if (isWithinCooldown(closedAt, now)) {
          // Within cooldown — do not reopen, count for operator attention
          needsOutcomeCooldown++
          continue
        }
        // Past cooldown — fall through to reopen with recurrence comment
      }

      const comment = buildRecurrenceComment(report.generated_at)
      const gateResult = applyPublicOutputGate({
        surface: 'recurrence-comment',
        content: comment,
        tokens: publicOutputTokens,
        fingerprint,
      })
      if (!gateResult.allowed) {
        // Privacy-blocked: does NOT consume cap budget
        blocked++
        continue
      }
      const removeLabels = closedIssue.labels.filter(l => RESOLVING_LABELS.includes(l))
      candidateReopens.push({
        type: 'reopen',
        issueNumber: closedIssue.number,
        comment: gateResult.sanitizedContent,
        removeLabels,
        addLabels: [OUTCOME_LABELS.recurring],
      })
      continue
    }

    // e. New finding — candidate open after privacy gating
    // Mark this fingerprint as seen before gating so that if the gate blocks,
    // subsequent same-fingerprint findings in this report are still deduplicated.
    // Without this, a second finding with the same fingerprint but a safe correction
    // would slip through after the first was blocked, opening an unintended proposal.
    plannedActionFingerprints.add(fingerprint)

    const title = buildProposalTitle(finding)
    const body = buildProposalBody(finding, report.generated_at)

    const titleGate = applyPublicOutputGate({
      surface: 'proposal-title',
      content: title,
      tokens: publicOutputTokens,
      fingerprint,
    })
    if (!titleGate.allowed) {
      // Privacy-blocked: does NOT consume cap budget
      blocked++
      continue
    }

    const bodyGate = applyPublicOutputGate({
      surface: 'proposal-body',
      content: body,
      tokens: publicOutputTokens,
      fingerprint,
    })
    if (!bodyGate.allowed) {
      // Privacy-blocked: does NOT consume cap budget
      blocked++
      continue
    }

    candidateOpens.push({
      type: 'open',
      fingerprint,
      title: titleGate.sanitizedContent,
      body: bodyGate.sanitizedContent,
      labels: [PROPOSAL_LABEL],
    })
  }

  // 4. Close-on-clear candidates: only when scan is complete and not execution-failure.
  // At this point we have already returned early for execution-failure and scan_complete=false,
  // so report.scan_complete is always true here. The check is kept for clarity.
  const canClose = report.scan_complete

  if (canClose) {
    for (const [fp, openIssue] of openByFingerprint) {
      if (!activeFingerprintsInReport.has(fp)) {
        const comment = buildCloseComment(report.generated_at)
        const gateResult = applyPublicOutputGate({
          surface: 'proposal-comment',
          content: comment,
          tokens: publicOutputTokens,
          fingerprint: fp,
        })
        if (!gateResult.allowed) {
          // Privacy-blocked: does NOT consume cap budget
          blocked++
          continue
        }
        candidateCloses.push({
          type: 'close',
          issueNumber: openIssue.number,
          labels: [OUTCOME_LABELS.resolved],
          comment: gateResult.sanitizedContent,
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 2: Apply mutation cap in priority order: close > update > reopen > open
  // Actions beyond the cap are counted as overflowed (planned-but-blocked).
  // Suppress actions are not mutating and are always included.
  // ---------------------------------------------------------------------------

  const actions: ProposalAction[] = [...suppressActions]
  let opened = 0
  let updated = 0
  let reopened = 0
  let closed = 0
  let overflowed = 0
  let remainingCap = mutationCap

  // Priority 1: close actions
  for (const action of candidateCloses) {
    if (remainingCap > 0) {
      actions.push(action)
      closed++
      remainingCap--
      // Infer kind from open issue title for countsByKind
      const titleMatch = /^Status truth: ([\w-]+) drift/u.exec(
        openByFingerprint.get(
          // Extract fingerprint from close action — find the open issue by number
          [...openByFingerprint.entries()].find(([, issue]) => issue.number === action.issueNumber)?.[0] ?? '',
        )?.title ?? '',
      )
      const kind = titleMatch?.[1] ?? 'unknown'
      incrementKindCount(kind, 'closed')
    } else {
      overflowed++
    }
  }

  // Priority 2: update-comment actions
  // We need to track which finding corresponds to each update to get the kind.
  // Since candidateUpdates are collected in finding order, we need to look up kind
  // from the openByFingerprint map via issueNumber.
  for (const action of candidateUpdates) {
    if (remainingCap > 0) {
      actions.push(action)
      updated++
      remainingCap--
      // Infer kind from open issue title
      const openIssue = [...openByFingerprint.values()].find(i => i.number === action.issueNumber)
      const titleMatch = /^Status truth: ([\w-]+) drift/u.exec(openIssue?.title ?? '')
      const kind = titleMatch?.[1] ?? 'unknown'
      incrementKindCount(kind, 'updated')
    } else {
      overflowed++
    }
  }

  // Priority 3: reopen actions
  for (const action of candidateReopens) {
    if (remainingCap > 0) {
      actions.push(action)
      reopened++
      remainingCap--
      // Infer kind from closed issue title
      const closedIssue = [...closedByFingerprint.values()].find(i => i.number === action.issueNumber)
      const titleMatch = /^Status truth: ([\w-]+) drift/u.exec(closedIssue?.title ?? '')
      const kind = titleMatch?.[1] ?? 'unknown'
      incrementKindCount(kind, 'reopened')
    } else {
      overflowed++
    }
  }

  // Priority 4: open actions (lowest priority)
  for (const action of candidateOpens) {
    if (remainingCap > 0) {
      actions.push(action)
      opened++
      remainingCap--
      // Infer kind from the action's title
      const titleMatch = /^Status truth: ([\w-]+) drift/u.exec(action.title)
      const kind = titleMatch?.[1] ?? 'unknown'
      incrementKindCount(kind, 'opened')
    } else {
      overflowed++
    }
  }

  // Add suppressed kind counts (not cap-limited)
  for (const kind of suppressedKinds) {
    incrementKindCount(kind, 'suppressed')
  }

  return {
    actions,
    counts: {
      opened,
      updated,
      reopened,
      closed,
      suppressed,
      blocked,
      overflowed,
      noAction,
      sameRunDeduplicated,
      malformedMarkers,
      versionRejected: 0,
      closedWithoutOutcome,
      needsOutcomeCooldown,
      malformedOutcomeMarkers,
      conflictingLabels,
      usefulnessByKind,
    },
    countsByKind,
    outcomeCounts: buildOutcomeCounts(existingIssues, activeFingerprintsInReport),
  }
}

// ---------------------------------------------------------------------------
// I/O executor types
// ---------------------------------------------------------------------------

/**
 * Shape of a single issue returned by listForRepo.
 * Minimal fields needed for proposal lifecycle management.
 */
export interface IssueListItem {
  readonly number: number
  readonly state: string
  readonly title: string
  readonly body: string | null | undefined
  readonly labels: readonly (string | {readonly name?: string | null | undefined})[]
  /** ISO 8601 timestamp when the issue was closed, if available from the API. */
  readonly closed_at?: string | null
}

/**
 * Minimal Octokit-like client interface for proposal issue mutations.
 * Injected for testability; production code uses @octokit/rest Octokit.
 * Uses function property style (not method shorthand) per lint rules.
 */
export interface StatusTruthOctokitClient {
  readonly rest: {
    readonly issues: {
      readonly getLabel: (params: {owner: string; repo: string; name: string}) => Promise<{data: {name: string}}>
      readonly createLabel: (params: {
        owner: string
        repo: string
        name: string
        color: string
        description: string
      }) => Promise<{data: {name: string}}>
      readonly create: (params: {
        owner: string
        repo: string
        title: string
        body: string
        labels: string[]
      }) => Promise<{data: {number: number}}>
      readonly createComment: (params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<{data: {id: number}}>
      readonly update: (params: {
        owner: string
        repo: string
        issue_number: number
        state?: 'open' | 'closed'
        labels?: string[]
      }) => Promise<{data: {number: number}}>
      readonly removeLabel: (params: {
        owner: string
        repo: string
        issue_number: number
        name: string
      }) => Promise<{data: unknown[]}>
      readonly addLabels: (params: {
        owner: string
        repo: string
        issue_number: number
        labels: string[]
      }) => Promise<{data: unknown[]}>
      readonly listForRepo: (params: {
        owner: string
        repo: string
        labels: string
        state: 'open' | 'closed' | 'all'
        per_page: number
        page: number
      }) => Promise<{data: IssueListItem[]}>
    }
  }
}

/**
 * Fetch existing status-truth proposal issues from GitHub.
 *
 * Fetches open issues and recent closed issues (last 2 pages) labeled with
 * PROPOSAL_LABEL. Filters to only issues that have the proposal label.
 * Returns them as ExistingProposalIssue[] for the lifecycle planner.
 *
 * Fail-closed in live mode: any API error is re-thrown so the caller can
 * abort before planning/executing mutations. In dry-run the caller may
 * choose to swallow the error and fall back to an empty list.
 *
 * Exported for testability.
 */
export async function fetchExistingProposalIssues(params: {
  octokit: StatusTruthOctokitClient
  owner: string
  repo: string
}): Promise<ExistingProposalIssue[]> {
  const {octokit, owner, repo} = params
  const issues: ExistingProposalIssue[] = []

  // Fetch open issues with the proposal label.
  // Any error is propagated to the caller (fail-closed in live mode).
  const openResponse = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: PROPOSAL_LABEL,
    state: 'open',
    per_page: 100,
    page: 1,
  })
  for (const issue of openResponse.data) {
    const labelNames = issue.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
    if (!labelNames.includes(PROPOSAL_LABEL)) continue
    issues.push({
      number: issue.number,
      state: 'open',
      labels: labelNames,
      title: issue.title,
      body: issue.body,
    })
  }

  // Fetch recent closed issues with the proposal label (2 pages).
  // Any error on the first page is propagated; subsequent pages are best-effort.
  for (const page of [1, 2]) {
    let closedResponse: {data: IssueListItem[]}
    try {
      closedResponse = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        labels: PROPOSAL_LABEL,
        state: 'closed',
        per_page: 50,
        page,
      })
    } catch (error: unknown) {
      if (page === 1) {
        // First closed page failure is fatal — propagate to caller
        throw error
      }
      // Subsequent pages: best-effort; stop pagination
      break
    }
    if (closedResponse.data.length === 0) break
    for (const issue of closedResponse.data) {
      const labelNames = issue.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
      if (!labelNames.includes(PROPOSAL_LABEL)) continue
      issues.push({
        number: issue.number,
        state: 'closed',
        labels: labelNames,
        title: issue.title,
        body: issue.body,
        closedAt: issue.closed_at ?? null,
      })
    }
  }

  return issues
}

/** Label descriptor for runtime label creation. */
export interface StatusTruthLabelDescriptor {
  readonly name: string
  readonly color: string
  readonly description: string
}

/**
 * All labels required by the status-truth loop.
 * Must be confirmed before any proposal issue is opened.
 * Fail-closed: if any required label cannot be confirmed, no proposals open.
 */
export const REQUIRED_LABELS: readonly StatusTruthLabelDescriptor[] = [
  {
    name: PROPOSAL_LABEL,
    color: '0075ca',
    description: 'Status-truth drift proposal requiring operator review',
  },
  {
    name: OUTCOME_LABELS.accepted,
    color: '0e8a16',
    description: 'Status-truth proposal accepted as valid drift',
  },
  {
    name: OUTCOME_LABELS.rejected,
    color: 'e4e669',
    description: 'Status-truth proposal rejected (claim was correct)',
  },
  {
    name: OUTCOME_LABELS.falsePositive,
    color: 'e4e669',
    description: 'Status-truth proposal marked as false positive',
  },
  {
    name: OUTCOME_LABELS.superseded,
    color: 'cfd3d7',
    description: 'Status-truth proposal superseded by a newer finding',
  },
  {
    name: OUTCOME_LABELS.manuallyFixed,
    color: '0e8a16',
    description: 'Status-truth drift manually corrected',
  },
  {
    name: OUTCOME_LABELS.resolved,
    color: '0e8a16',
    description: 'Status-truth drift resolved (auto-closed on clear)',
  },
  {
    name: OUTCOME_LABELS.recurring,
    color: 'd93f0b',
    description: 'Status-truth drift recurred after previous resolution',
  },
]

/** Input to the I/O executor. */
export interface ExecuteStatusTruthProposalActionsInput {
  /** Injected Octokit-like client for GitHub API calls. */
  readonly octokit: StatusTruthOctokitClient
  readonly owner: string
  readonly repo: string
  /** Planned actions from the pure lifecycle planner. */
  readonly actions: readonly ProposalAction[]
  /**
   * When true: count actions but perform zero GitHub mutations.
   * Summary clearly marks dry-run status.
   */
  readonly dryRun: boolean
  /**
   * Fingerprints already created in this run (same-run dedup guard).
   * Prevents duplicate proposals when GitHub issue listing lags same-run writes.
   */
  readonly sameRunCreatedFingerprints: ReadonlySet<string>
}

/** Counts returned by the executor. */
export interface ExecuteStatusTruthProposalActionsCounts {
  readonly opened: number
  readonly updated: number
  readonly reopened: number
  readonly closed: number
  readonly suppressed: number
  readonly failed: number
  readonly sameRunDeduplicated: number
}

/** Result of the I/O executor. */
export interface ExecuteStatusTruthProposalActionsResult {
  readonly dryRun: boolean
  /** True when required labels could not be confirmed; no proposals were opened. */
  readonly labelGateFailed: boolean
  readonly counts: ExecuteStatusTruthProposalActionsCounts
}

// ---------------------------------------------------------------------------
// Label preflight helper
// ---------------------------------------------------------------------------

function isApiStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    !Array.isArray(error) &&
    typeof (error as Record<string, unknown>).status === 'number' &&
    (error as Record<string, unknown>).status === status
  )
}

/**
 * Ensure all required labels exist in the repo.
 *
 * For each label:
 * - If getLabel succeeds: confirmed.
 * - If 404: attempt createLabel.
 *   - createLabel succeeds or 422 (race): confirmed.
 *   - createLabel other failure: excluded.
 * - getLabel non-404 failure: excluded.
 *
 * Returns a Set<string> of confirmed label names.
 * Caller must check that all required labels are in the set before proceeding.
 */
async function ensureStatusTruthLabels(
  octokit: StatusTruthOctokitClient,
  owner: string,
  repo: string,
  labels: readonly StatusTruthLabelDescriptor[],
): Promise<Set<string>> {
  const confirmed = new Set<string>()

  for (const {name, color, description} of labels) {
    try {
      await octokit.rest.issues.getLabel({owner, repo, name})
      confirmed.add(name)
      continue
    } catch (getError: unknown) {
      if (!isApiStatus(getError, 404)) {
        // Non-404 failure: cannot confirm this label
        continue
      }
    }

    // Label not found (404) — create it
    try {
      await octokit.rest.issues.createLabel({owner, repo, name, color, description})
      confirmed.add(name)
    } catch (createError: unknown) {
      if (isApiStatus(createError, 422)) {
        // Race with another writer — label may now exist. Confirm with getLabel
        // before adding to confirmed set. A 422 alone is not sufficient proof
        // because it could also indicate a validation error on the label name.
        try {
          await octokit.rest.issues.getLabel({owner, repo, name})
          confirmed.add(name)
        } catch {
          // getLabel failed after 422 — cannot confirm label exists
        }
      }
      // Other failure: label not confirmed
    }
  }

  return confirmed
}

// ---------------------------------------------------------------------------
// I/O executor
// ---------------------------------------------------------------------------

/**
 * Execute planned status-truth proposal lifecycle actions against GitHub.
 *
 * Processing order:
 * 1. Label preflight: confirm all REQUIRED_LABELS exist (create if missing).
 *    Fail closed if the primary proposal label cannot be confirmed.
 * 2. For each action:
 *    - dry-run: count only, no mutations.
 *    - open: same-run dedup check, then issues.create.
 *    - update-comment: issues.createComment.
 *    - reopen: issues.update(state=open) + remove resolving labels + add recurring.
 *    - close: issues.createComment + issues.update(state=closed) + add resolved label.
 *    - suppress: count only, no API call.
 * 3. One action failure does not abort remaining actions.
 * 4. stdout/stderr carry counts only; no raw claim text, fingerprints, or tokens.
 */
export async function executeStatusTruthProposalActions(
  input: ExecuteStatusTruthProposalActionsInput,
): Promise<ExecuteStatusTruthProposalActionsResult> {
  const {octokit, owner, repo, actions, dryRun, sameRunCreatedFingerprints} = input

  // In dry-run mode: count actions but perform zero mutations.
  // Label preflight is skipped in dry-run (no API calls at all).
  if (dryRun) {
    let opened = 0
    let updated = 0
    let reopened = 0
    let closed = 0
    let suppressed = 0
    let sameRunDeduplicated = 0

    for (const action of actions) {
      if (action.type === 'open') {
        if (sameRunCreatedFingerprints.has(action.fingerprint)) {
          sameRunDeduplicated++
        } else {
          opened++
        }
      } else if (action.type === 'update-comment') {
        updated++
      } else if (action.type === 'reopen') {
        reopened++
      } else if (action.type === 'close') {
        closed++
      } else if (action.type === 'suppress') {
        suppressed++
      }
    }

    return {
      dryRun: true,
      labelGateFailed: false,
      counts: {opened, updated, reopened, closed, suppressed, failed: 0, sameRunDeduplicated},
    }
  }

  // Label preflight: confirm all required labels exist.
  const confirmedLabels = await ensureStatusTruthLabels(octokit, owner, repo, REQUIRED_LABELS)

  // Fail closed if ANY required label cannot be confirmed.
  // Without all required labels, proposals would be opened without outcome labels,
  // breaking the lifecycle state machine (terminal suppression, reopen, close-on-clear).
  const missingRequired = REQUIRED_LABELS.filter(l => !confirmedLabels.has(l.name))
  if (missingRequired.length > 0) {
    return {
      dryRun: false,
      labelGateFailed: true,
      counts: {opened: 0, updated: 0, reopened: 0, closed: 0, suppressed: 0, failed: 0, sameRunDeduplicated: 0},
    }
  }

  // Same-run in-memory set (guards eventual-consistency race)
  const createdThisRun = new Set<string>(sameRunCreatedFingerprints)

  let opened = 0
  let updated = 0
  let reopened = 0
  let closed = 0
  let suppressed = 0
  let failed = 0
  let sameRunDeduplicated = 0

  for (const action of actions) {
    if (action.type === 'open') {
      // Same-run dedup: skip if already created this run
      if (createdThisRun.has(action.fingerprint)) {
        sameRunDeduplicated++
        continue
      }

      try {
        await octokit.rest.issues.create({
          owner,
          repo,
          title: action.title,
          body: action.body,
          labels: action.labels.filter(l => confirmedLabels.has(l)),
        })
        createdThisRun.add(action.fingerprint)
        opened++
      } catch {
        failed++
      }
    } else if (action.type === 'update-comment') {
      try {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.comment,
        })
        updated++
      } catch {
        failed++
      }
    } else if (action.type === 'reopen') {
      try {
        // Remove resolving labels first
        for (const label of action.removeLabels) {
          try {
            await octokit.rest.issues.removeLabel({owner, repo, issue_number: action.issueNumber, name: label})
          } catch {
            // Label may not exist; continue
          }
        }
        // Add recurring label
        if (action.addLabels.length > 0) {
          try {
            await octokit.rest.issues.addLabels({
              owner,
              repo,
              issue_number: action.issueNumber,
              labels: action.addLabels.filter(l => confirmedLabels.has(l)),
            })
          } catch {
            // Non-fatal: label add failure does not block reopen
          }
        }
        // Reopen the issue
        await octokit.rest.issues.update({owner, repo, issue_number: action.issueNumber, state: 'open'})
        // Add recurrence comment
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.comment,
        })
        reopened++
      } catch {
        failed++
      }
    } else if (action.type === 'close') {
      try {
        // Add resolved label and close
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: action.issueNumber,
          labels: action.labels.filter(l => confirmedLabels.has(l)),
        })
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.issueNumber,
          body: action.comment,
        })
        await octokit.rest.issues.update({owner, repo, issue_number: action.issueNumber, state: 'closed'})
        closed++
      } catch {
        failed++
      }
    } else if (action.type === 'suppress') {
      // Suppress: count only, no API call
      suppressed++
    }
  }

  return {
    dryRun: false,
    labelGateFailed: false,
    counts: {opened, updated, reopened, closed, suppressed, failed, sameRunDeduplicated},
  }
}

// ---------------------------------------------------------------------------
// CLI shell for the open/proposals step
// ---------------------------------------------------------------------------

/** No-op log handler object — suppresses all Octokit default logger output. */
export const NOOP_LOG = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

type OctokitConstructor = new (params: {
  auth: string
  request?: {timeout?: number}
  log?: {debug: () => void; info: () => void; warn: () => void; error: () => void}
}) => StatusTruthOctokitClient

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  if (typeof Octokit !== 'function') {
    throw new TypeError('Failed to load @octokit/rest Octokit constructor')
  }
  return Octokit as unknown as OctokitConstructor
}

async function createOctokitFromEnv(): Promise<StatusTruthOctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    throw new Error('status-truth-proposals: GITHUB_TOKEN is required in the environment')
  }
  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token, request: {timeout: 10_000}, log: NOOP_LOG})
}

/** Counts-only result written to stdout and STATUS_TRUTH_OPEN_RESULT_PATH. */
interface OpenResult {
  dryRun: boolean
  labelGateFailed: boolean
  counts: ExecuteStatusTruthProposalActionsCounts
  /**
   * Planned per-kind action counts from the planner (counts-only, no paths or fingerprints).
   * These are the counts the planner intended to execute, not the executed counts.
   * Allows downstream workflow steps to report per-kind summaries without exposing
   * any identity-bearing fields.
   */
  plannedCountsByKind: Readonly<Record<string, KindActionCounts>>
  /**
   * Aggregate planned counts from the planner (counts-only).
   * Includes versionRejected, blocked, overflowed, and other planner-level counters
   * not present in executor counts.
   */
  plannedCounts: Pick<ProposalCounts, 'versionRejected' | 'blocked' | 'overflowed' | 'sameRunDeduplicated'>
  /**
   * Aggregate outcome counts from all existing proposal issues (read-model).
   * Separate from action counts (counts) and planned counts (plannedCounts).
   * Reflects the current state of all proposal issues, not the actions taken this run.
   * Counts-only: no raw issue bodies, titles, paths, or fingerprints.
   */
  outcomeCounts: OutcomeCounts
}

/**
 * CLI entry point for the status-truth open/proposals step.
 *
 * Environment variables:
 * - STATUS_TRUTH_REPORT_PATH: path to the JSON report artifact from the detect step (required)
 * - STATUS_TRUTH_OPEN_RESULT_PATH: path to write the counts-only result JSON (optional)
 * - STATUS_TRUTH_DRY_RUN: set to 'true' for dry-run mode (optional)
 * - GITHUB_TOKEN: write-scoped app token for issue mutations (required unless dry-run)
 *
 * Behavior:
 * - Reads and validates the report artifact (schema/fingerprint version, required fields,
 *   prohibited fields, count consistency). Fails closed on any validation error.
 * - Loads privacy tokens from metadata/repos.yaml (fail-closed).
 * - Plans proposal lifecycle actions (pure planner).
 * - Executes actions (or counts only in dry-run mode).
 * - Writes counts-only result to stdout and optionally to STATUS_TRUTH_OPEN_RESULT_PATH.
 * - stdout/stderr carry counts only; no raw claim text, source paths, fingerprints, or tokens.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */
async function runOpen(): Promise<void> {
  const reportPath = process.env.STATUS_TRUTH_REPORT_PATH
  const resultPath = process.env.STATUS_TRUTH_OPEN_RESULT_PATH
  const dryRun = process.env.STATUS_TRUTH_DRY_RUN === 'true'

  if (reportPath === undefined || reportPath === '') {
    process.stderr.write('status-truth-proposals: STATUS_TRUTH_REPORT_PATH is required\n')
    process.exit(1)
  }

  // Read and parse the report artifact
  let rawJson: string
  try {
    rawJson = await readFile(reportPath, 'utf8')
  } catch {
    process.stderr.write('status-truth-proposals: could not read report artifact: error-class=read-failure\n')
    process.exit(1)
  }

  let rawParsed: unknown
  try {
    rawParsed = JSON.parse(rawJson)
  } catch {
    process.stderr.write('status-truth-proposals: could not parse report artifact: error-class=parse-failure\n')
    process.exit(1)
  }

  // Validate the artifact before any write planning
  const validation = validateStatusTruthArtifact(rawParsed)
  if (!validation.valid) {
    process.stderr.write('status-truth-proposals: artifact validation failed: error-class=validation-failure\n')
    process.exit(1)
  }

  const report = validation.report

  // Load privacy tokens (fail-closed)
  let publicOutputTokens: ReturnType<typeof makePublicOutputTokens>
  try {
    const [privateTokens, redactedCanonicalIds] = await Promise.all([
      loadPrivateTokensFromDisk(),
      loadRedactedCanonicalIdsFromDisk(),
    ])
    publicOutputTokens = makePublicOutputTokens({
      privateTokens,
      redactedCanonicalIds,
    })
  } catch {
    process.stderr.write('status-truth-proposals: privacy token load failed: error-class=token-load-failure\n')
    process.exit(1)
  }

  // Determine owner/repo from environment
  const githubRepository = process.env.GITHUB_REPOSITORY ?? 'fro-bot/.github'
  const slashIndex = githubRepository.indexOf('/')
  const owner = slashIndex === -1 ? githubRepository : githubRepository.slice(0, slashIndex)
  const repo = slashIndex === -1 ? '' : githubRepository.slice(slashIndex + 1)

  // Fetch existing proposal issues from GitHub before planning.
  // In dry-run mode we attempt a read-only fetch (best-effort) so the planner can
  // no-op/update/reopen correctly rather than always opening duplicates.
  // If the token is absent or the fetch fails in dry-run, fall back to empty list
  // (no mutations happen anyway, so over-counting planned opens is acceptable).
  //
  // In live mode the fetch is fail-closed: if it fails we exit before planning or
  // executing any mutations. Proceeding with an empty list in live mode would cause
  // duplicate proposals to be opened for every existing finding.
  let existingIssues: ExistingProposalIssue[] = []
  // In live mode, a single Octokit instance is created for both the fetch and execute
  // steps to avoid constructing it twice (and re-reading the token twice).
  let liveOctokit: StatusTruthOctokitClient | undefined

  if (dryRun) {
    // Dry-run: attempt read-only fetch if token is available; fall back to empty list
    const dryRunToken = process.env.GITHUB_TOKEN
    if (dryRunToken !== undefined && dryRunToken !== '' && owner !== '' && repo !== '') {
      try {
        const LoadedOctokit = await loadOctokitConstructor()
        const dryRunOctokit = new LoadedOctokit({auth: dryRunToken, request: {timeout: 10_000}, log: NOOP_LOG})
        existingIssues = await fetchExistingProposalIssues({octokit: dryRunOctokit, owner, repo})
      } catch {
        // Non-fatal in dry-run: proceed with empty list (counts may over-estimate opens)
      }
    }
  } else {
    // Live mode: create a single Octokit instance for both the issue fetch and
    // the execute step. Fail closed: if the fetch fails, exit before planning
    // or executing mutations. Proceeding with an empty list would open duplicate
    // proposals for all findings.
    liveOctokit = await createOctokitFromEnv()
    try {
      existingIssues = await fetchExistingProposalIssues({octokit: liveOctokit, owner, repo})
    } catch {
      process.stderr.write('status-truth-proposals: existing issue fetch failed: error-class=fetch-failure\n')
      process.exit(1)
    }
  }

  // Plan proposal lifecycle actions (pure, no I/O)
  const planResult = planStatusTruthProposalActions({
    report,
    existingIssues,
    publicOutputTokens,
    sameRunCreatedFingerprints: new Set<string>(),
  })

  // Execute actions (or count only in dry-run)
  let executeResult: ExecuteStatusTruthProposalActionsResult

  if (dryRun) {
    executeResult = await executeStatusTruthProposalActions({
      octokit: {} as StatusTruthOctokitClient, // not used in dry-run
      owner: owner || 'fro-bot',
      repo: repo || '.github',
      actions: planResult.actions,
      dryRun: true,
      sameRunCreatedFingerprints: new Set<string>(),
    })
  } else {
    // Reuse the single Octokit instance created for the fetch step above.
    // liveOctokit is always defined here because dryRun is false.
    executeResult = await executeStatusTruthProposalActions({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      octokit: liveOctokit!,
      owner: owner || 'fro-bot',
      repo: repo || '.github',
      actions: planResult.actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })
  }

  // Counts-only result — no raw claim text, source paths, fingerprints, or tokens
  const result: OpenResult = {
    dryRun: executeResult.dryRun,
    labelGateFailed: executeResult.labelGateFailed,
    counts: executeResult.counts,
    plannedCountsByKind: planResult.countsByKind,
    plannedCounts: {
      versionRejected: planResult.counts.versionRejected,
      blocked: planResult.counts.blocked,
      overflowed: planResult.counts.overflowed,
      sameRunDeduplicated: planResult.counts.sameRunDeduplicated,
    },
    outcomeCounts: planResult.outcomeCounts,
  }

  const resultJson = `${JSON.stringify(result)}\n`
  process.stdout.write(resultJson)

  if (resultPath !== undefined && resultPath !== '') {
    try {
      await writeFile(resultPath, resultJson, {flag: 'w'})
    } catch {
      process.stderr.write('status-truth-proposals: could not write result: error-class=write-failure\n')
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runOpen()
}
