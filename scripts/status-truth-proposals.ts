/**
 * Proposal lifecycle planner for the status-truth maintenance loop (Unit 3).
 *
 * Converts drifted, privacy-safe status claims into deterministic GitHub issue
 * lifecycle actions without touching GitHub.
 *
 * Design invariants:
 * - Pure function: no I/O, no Octokit dependency.
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
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {PublicStatusTruthFinding, StatusTruthFinding, StatusTruthJsonReport} from './status-truth-detect.ts'
import {KNOWN_FINGERPRINT_VERSION, KNOWN_SCHEMA_VERSION} from './status-truth-detect.ts'
import {applyPublicOutputGate, type PublicOutputTokens} from './status-truth-public-output.ts'

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
// Input/output types
// ---------------------------------------------------------------------------

/** Simplified GitHub issue shape — no Octokit dependency. */
export interface ExistingProposalIssue {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly labels: readonly string[]
  readonly title: string
  readonly body: string | null | undefined
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

/** Aggregate counts returned by the planner. */
export interface ProposalCounts {
  readonly opened: number
  readonly updated: number
  readonly reopened: number
  readonly closed: number
  readonly suppressed: number
  readonly blocked: number
  readonly noAction: number
  readonly sameRunDeduplicated: number
  readonly malformedMarkers: number
  readonly versionRejected: number
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
}

/** Result of the pure lifecycle planner. */
export interface PlanStatusTruthProposalActionsResult {
  readonly actions: readonly ProposalAction[]
  readonly counts: ProposalCounts
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
        noAction: 0,
        sameRunDeduplicated: 0,
        malformedMarkers: 0,
        versionRejected: 1,
      },
    }
  }

  // 2. Build lookup maps from existing issues
  const openByFingerprint = new Map<string, ExistingProposalIssue>()
  const closedByFingerprint = new Map<string, ExistingProposalIssue>()
  let malformedMarkers = 0

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
    }
  }

  const actions: ProposalAction[] = []
  let opened = 0
  let updated = 0
  let reopened = 0
  let suppressed = 0
  let blocked = 0
  let noAction = 0
  let sameRunDeduplicated = 0

  // Track which fingerprints are active in this report (for close-on-clear)
  const activeFingerprintsInReport = new Set<string>()

  // 3. Process proposal-eligible findings
  for (const finding of report.findings) {
    // Skip unsafe findings — they have no identity-bearing fields and are never proposal-eligible
    if (!isPublicFinding(finding)) continue

    // Skip non-proposal-eligible findings (unresolved, current)
    if (!finding.proposalEligible) continue

    const {fingerprint} = finding
    activeFingerprintsInReport.add(fingerprint)

    // a. Same-run dedup: skip if already created this run
    if (sameRunCreatedFingerprints.has(fingerprint)) {
      sameRunDeduplicated++
      continue
    }

    // b. Check for terminal suppression
    const closedIssue = closedByFingerprint.get(fingerprint)
    if (closedIssue !== undefined && hasTerminalLabel(closedIssue.labels)) {
      actions.push({
        type: 'suppress',
        fingerprint,
        reason: 'terminal outcome label on closed proposal',
      })
      suppressed++
      continue
    }

    // c. Check for matching open issue
    const openIssue = openByFingerprint.get(fingerprint)
    if (openIssue !== undefined) {
      // Compare recorded live-state to current live-state
      const recordedLiveState = extractRecordedLiveState(openIssue.body)
      const currentLiveState = finding.liveState

      if (recordedLiveState !== null && currentLiveState !== undefined && recordedLiveState !== currentLiveState) {
        // Live-state details changed — plan one update comment
        const comment = buildUpdateComment(finding, report.generated_at)
        const gateResult = applyPublicOutputGate({
          surface: 'proposal-comment',
          content: comment,
          tokens: publicOutputTokens,
          fingerprint,
        })
        if (!gateResult.allowed) {
          blocked++
          continue
        }
        actions.push({
          type: 'update-comment',
          issueNumber: openIssue.number,
          comment: gateResult.sanitizedContent,
        })
        updated++
      } else {
        // Drift unchanged — no action to avoid comment spam
        noAction++
      }
      continue
    }

    // d. Check for matching non-terminal closed issue → reopen
    if (closedIssue !== undefined && !hasTerminalLabel(closedIssue.labels)) {
      const comment = buildRecurrenceComment(report.generated_at)
      const gateResult = applyPublicOutputGate({
        surface: 'recurrence-comment',
        content: comment,
        tokens: publicOutputTokens,
        fingerprint,
      })
      if (!gateResult.allowed) {
        blocked++
        continue
      }
      const removeLabels = closedIssue.labels.filter(l => RESOLVING_LABELS.includes(l))
      actions.push({
        type: 'reopen',
        issueNumber: closedIssue.number,
        comment: gateResult.sanitizedContent,
        removeLabels,
        addLabels: [OUTCOME_LABELS.recurring],
      })
      reopened++
      continue
    }

    // e. New finding — open a proposal after privacy gating
    const title = buildProposalTitle(finding)
    const body = buildProposalBody(finding, report.generated_at)

    const titleGate = applyPublicOutputGate({
      surface: 'proposal-title',
      content: title,
      tokens: publicOutputTokens,
      fingerprint,
    })
    if (!titleGate.allowed) {
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
      blocked++
      continue
    }

    actions.push({
      type: 'open',
      fingerprint,
      title: titleGate.sanitizedContent,
      body: bodyGate.sanitizedContent,
      labels: [PROPOSAL_LABEL],
    })
    opened++
  }

  // 4. Close-on-clear: only when scan is complete and not execution-failure
  const canClose = report.status !== 'execution-failure' && report.scan_complete
  let closed = 0

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
          blocked++
          continue
        }
        actions.push({
          type: 'close',
          issueNumber: openIssue.number,
          labels: [OUTCOME_LABELS.resolved],
          comment: gateResult.sanitizedContent,
        })
        closed++
      }
    }
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
      noAction,
      sameRunDeduplicated,
      malformedMarkers,
      versionRejected: 0,
    },
  }
}
