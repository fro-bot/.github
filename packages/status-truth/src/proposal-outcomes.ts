/**
 * The outcome read-model of the existing proposal issues: the shape of an existing issue, the classification of one issue into an outcome state, and the aggregate counts, overall and per claim kind. Counts only: no body, title, path or fingerprint reaches a count.
 *
 * Imports `proposal-labels` and `proposal-markers`.
 */

import {
  ACCURACY_SIGNAL_LABELS,
  ALL_RECOGNIZED_OUTCOME_LABELS,
  OUTCOME_LABELS,
  PROPOSAL_LABEL,
} from './proposal-labels.ts'
import {extractProposalFingerprint, recoverProposalKind} from './proposal-markers.ts'

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
/** Mutable accumulator shape backing an {@link OutcomeCounts} bucket. */
interface OutcomeCountsAccumulator {
  proposedPending: number
  explicitAccepted: number
  explicitRejected: number
  falsePositive: number
  resolvedPositive: number
  superseded: number
  needsOutcome: number
  conflictingLabels: number
  malformedOutcome: number
}

function makeOutcomeCountsAccumulator(): OutcomeCountsAccumulator {
  return {
    proposedPending: 0,
    explicitAccepted: 0,
    explicitRejected: 0,
    falsePositive: 0,
    resolvedPositive: 0,
    superseded: 0,
    needsOutcome: 0,
    conflictingLabels: 0,
    malformedOutcome: 0,
  }
}

function applyOutcomeState(acc: OutcomeCountsAccumulator, state: ProposalOutcomeState): void {
  switch (state) {
    case 'proposed-pending':
      acc.proposedPending++
      break
    case 'explicit-accepted':
      acc.explicitAccepted++
      break
    case 'explicit-rejected':
      acc.explicitRejected++
      break
    case 'false-positive':
      acc.falsePositive++
      break
    case 'resolved-positive':
      acc.resolvedPositive++
      break
    case 'superseded':
      acc.superseded++
      break
    case 'needs-outcome':
      acc.needsOutcome++
      break
    case 'conflicting-labels':
      acc.conflictingLabels++
      break
    case 'malformed-outcome':
      acc.malformedOutcome++
      break
  }
}

export function buildOutcomeCounts(
  issues: readonly ExistingProposalIssue[],
  driftActiveFingerprints: ReadonlySet<string> = new Set<string>(),
): OutcomeCounts {
  const acc = makeOutcomeCountsAccumulator()

  for (const issue of issues) {
    // Only classify issues that have the proposal label
    if (!issue.labels.includes(PROPOSAL_LABEL)) continue

    // Determine if this issue's fingerprint is still active in the current scan.
    // Extract fingerprint from body to check against driftActiveFingerprints.
    const fp = extractProposalFingerprint(issue.body)
    const driftActive = fp !== null && driftActiveFingerprints.has(fp)

    applyOutcomeState(acc, classifyProposalOutcome(issue, driftActive))
  }

  return {...acc}
}

/**
 * Build per-claim-kind outcome counts from a list of existing proposal issues.
 *
 * Pure function: no I/O, no side effects. Shares the same classification pass
 * as {@link buildOutcomeCounts} (one `classifyProposalOutcome` call per issue) —
 * it does not classify each issue twice.
 *
 * Kind is recovered via {@link recoverProposalKind}, which validates against the
 * closed vocabulary of known claim kinds; unrecognized or missing kind info is
 * bucketed under 'unknown'. Only kinds with at least one issue are included in
 * the result — no zero-filled kind keys.
 *
 * Output is counts-only — no raw issue bodies, titles, or fingerprints.
 */
export function buildOutcomeCountsByKind(
  issues: readonly ExistingProposalIssue[],
  driftActiveFingerprints: ReadonlySet<string> = new Set<string>(),
): Readonly<Record<string, OutcomeCounts>> {
  const accByKind: Record<string, OutcomeCountsAccumulator> = {}

  for (const issue of issues) {
    if (!issue.labels.includes(PROPOSAL_LABEL)) continue

    const fp = extractProposalFingerprint(issue.body)
    const driftActive = fp !== null && driftActiveFingerprints.has(fp)
    const state = classifyProposalOutcome(issue, driftActive)

    const kind = recoverProposalKind(issue.body)
    const existing = accByKind[kind]
    const acc = existing ?? makeOutcomeCountsAccumulator()
    if (existing === undefined) accByKind[kind] = acc
    applyOutcomeState(acc, state)
  }

  const result: Record<string, OutcomeCounts> = {}
  for (const [kind, acc] of Object.entries(accByKind)) {
    result[kind] = {...acc}
  }
  return result
}

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
