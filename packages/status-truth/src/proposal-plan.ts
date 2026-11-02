/**
 * The proposal lifecycle planner. Given a validated report and the existing proposal issues, decide which issues to open, update, reopen, close or suppress, and build the issue titles, bodies and comments. Pure: no I/O. Every rendered surface passes the public-output gate, and an unknown report version is rejected before any planning.
 */

import {applyPublicOutputGate, type PublicOutputTokens} from '@fro-bot/privacy/status-truth-public-output'
import {
  ACCURACY_SIGNAL_LABELS,
  ALL_RECOGNIZED_OUTCOME_LABELS,
  OUTCOME_LABELS,
  PROPOSAL_LABEL,
  RESOLVING_LABELS,
  TERMINAL_LABELS,
} from './proposal-labels.ts'
import {
  buildFingerprintMarker,
  buildKindMarker,
  buildLiveStateMarker,
  extractProposalFingerprint,
  extractRecordedLiveState,
  isWithinCooldown,
} from './proposal-markers.ts'
import {
  buildOutcomeCounts,
  buildOutcomeCountsByKind,
  type ExistingProposalIssue,
  type OutcomeCounts,
} from './proposal-outcomes.ts'
import {
  KNOWN_FINGERPRINT_VERSION,
  KNOWN_SCHEMA_VERSION,
  type PublicStatusTruthFinding,
  type StatusTruthFinding,
  type StatusTruthJsonReport,
} from './report-model.ts'

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
  /**
   * Per-claim-kind aggregate outcome counts from all existing proposal issues.
   * Same read-model as `outcomeCounts`, bucketed by kind (closed vocabulary;
   * unrecognized/missing kind info buckets as 'unknown'). Only kinds with at
   * least one issue are present. Counts-only: no paths, titles, or fingerprints.
   */
  readonly outcomeCountsByKind: Readonly<Record<string, OutcomeCounts>>
}

function buildProposalTitle(finding: PublicStatusTruthFinding): string {
  return `Status truth: ${finding.kind} drift in ${finding.path}`
}

function buildProposalBody(finding: PublicStatusTruthFinding, generatedAt: string): string {
  const liveStateMarker = finding.liveState === undefined ? '' : `\n${buildLiveStateMarker(finding.liveState)}`
  const correctionLine =
    finding.proposedCorrection === undefined ? '' : `\n**Proposed correction:** ${finding.proposedCorrection}`

  return [
    buildFingerprintMarker(finding.fingerprint),
    buildKindMarker(finding.kind),
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

function isPublicFinding(finding: StatusTruthFinding): finding is PublicStatusTruthFinding {
  return finding.verdict !== 'unsafe'
}

function hasTerminalLabel(labels: readonly string[]): boolean {
  return labels.some(l => TERMINAL_LABELS.includes(l))
}

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
      outcomeCountsByKind: buildOutcomeCountsByKind(existingIssues),
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
      outcomeCountsByKind: buildOutcomeCountsByKind(existingIssues),
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

  // 4. Close-on-clear candidates: only when scan is complete, not execution-failure,
  // and no unsafe findings are present. Unsafe findings indicate that some claims
  // could not be proven public — prior drift may simply be inaccessible/private now,
  // not genuinely cleared. Closing proposals under that uncertainty would be incorrect.
  const canClose = report.scan_complete && report.counts.unsafe === 0

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
    outcomeCountsByKind: buildOutcomeCountsByKind(existingIssues, activeFingerprintsInReport),
  }
}
