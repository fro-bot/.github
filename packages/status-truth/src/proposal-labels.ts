/**
 * The labels of the proposal lifecycle: the primary label, the outcome labels with the terminal, resolving and accuracy-signal sets derived from them, and the full list of labels the executor confirms before it opens anything.
 *
 * A leaf: it imports nothing. `settings-labels-effective-set.test.ts` loads `REQUIRED_LABELS` from here.
 */

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
export const TERMINAL_LABELS: readonly string[] = [OUTCOME_LABELS.rejected, OUTCOME_LABELS.falsePositive]

/** Labels that are removed when a non-terminal closed issue is reopened. */
export const RESOLVING_LABELS: readonly string[] = [OUTCOME_LABELS.resolved, OUTCOME_LABELS.manuallyFixed]

/**
 * Outcome labels that count as accuracy signals for per-kind usefulness math.
 * Only accepted, rejected, and false-positive are accuracy signals.
 * Other outcome labels (resolved, manually-fixed, recurring, superseded) are lifecycle
 * state labels, not accuracy signals.
 */
export const ACCURACY_SIGNAL_LABELS: readonly string[] = [
  OUTCOME_LABELS.accepted,
  OUTCOME_LABELS.rejected,
  OUTCOME_LABELS.falsePositive,
]

/**
 * All recognized outcome labels (accuracy signals + lifecycle state labels).
 * Labels outside this set on a proposal issue are malformed outcome markers.
 */
export const ALL_RECOGNIZED_OUTCOME_LABELS: readonly string[] = [
  OUTCOME_LABELS.accepted,
  OUTCOME_LABELS.rejected,
  OUTCOME_LABELS.falsePositive,
  OUTCOME_LABELS.superseded,
  OUTCOME_LABELS.manuallyFixed,
  OUTCOME_LABELS.resolved,
  OUTCOME_LABELS.recurring,
]

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
// Colors match .github/settings.yml (hex without '#', as GitHub createLabel requires)
export const REQUIRED_LABELS: readonly StatusTruthLabelDescriptor[] = [
  {
    name: PROPOSAL_LABEL,
    color: '5146a5',
    description: 'Status-truth drift proposal requiring operator review',
  },
  {
    name: OUTCOME_LABELS.accepted,
    color: '2e8b8b',
    description: 'Status-truth proposal accepted as valid drift',
  },
  {
    name: OUTCOME_LABELS.rejected,
    color: '8b3a62',
    description: 'Status-truth proposal rejected (claim was correct)',
  },
  {
    name: OUTCOME_LABELS.falsePositive,
    color: '702f1e',
    description: 'Status-truth proposal marked as false positive',
  },
  {
    name: OUTCOME_LABELS.superseded,
    color: 'c5c9cf',
    description: 'Status-truth proposal superseded by a newer finding',
  },
  {
    name: OUTCOME_LABELS.manuallyFixed,
    color: '3f8f72',
    description: 'Status-truth drift manually corrected',
  },
  {
    name: OUTCOME_LABELS.resolved,
    color: '3678a8',
    description: 'Status-truth drift resolved (auto-closed on clear)',
  },
  {
    name: OUTCOME_LABELS.recurring,
    color: '9a7b22',
    description: 'Status-truth drift recurred after previous resolution',
  },
]
