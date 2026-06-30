/**
 * Tests for the status-truth proposal lifecycle planner (Unit 3) and
 * I/O executor (Unit 4).
 *
 * TDD: tests written before implementation.
 * All tests are pure — no Octokit, no disk I/O.
 */

import type {StatusTruthJsonReport} from './status-truth-detect.ts'
import type {
  ExecuteStatusTruthProposalActionsInput,
  ExistingProposalIssue,
  IssueListItem,
  PlanStatusTruthProposalActionsInput,
  StatusTruthOctokitClient,
} from './status-truth-proposals.ts'
import type {PublicOutputTokens} from './status-truth-public-output.ts'
import {describe, expect, it} from 'vitest'
import {
  executeStatusTruthProposalActions,
  extractProposalFingerprint,
  extractRedactedCanonicalIds,
  fetchExistingProposalIssues,
  loadRedactedCanonicalIdsFromDisk,
  NOOP_LOG,
  OUTCOME_LABELS,
  planStatusTruthProposalActions,
  PROPOSAL_LABEL,
  REQUIRED_LABELS,
} from './status-truth-proposals.ts'
import {applyPublicOutputGate, makePublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<StatusTruthJsonReport> = {}): StatusTruthJsonReport {
  return {
    schema_version: 1,
    fingerprint_version: 1,
    status: 'findings',
    scan_complete: true,
    generated_at: '2026-06-28T00:00:00Z',
    failure_class: null,
    repair_eligible: true,
    findings: [],
    counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    ...overrides,
  }
}

function makeDriftedFinding(fingerprint = 'abc123def456abcd') {
  return {
    kind: 'pr-state' as const,
    path: 'docs/plans/example.md',
    sourceRef: '#42',
    verdict: 'drifted' as const,
    fingerprint,
    claimedState: 'open',
    liveState: 'closed',
    proposalEligible: true,
    proposedCorrection: 'pr #42 is closed',
  }
}

function makeUnsafeFinding() {
  return {
    kind: 'pr-state' as const,
    verdict: 'unsafe' as const,
    proposalEligible: false as const,
  }
}

function makeUnresolvedFinding(fingerprint = 'unresolved1234567') {
  return {
    kind: 'issue-state' as const,
    path: 'docs/plans/example.md',
    sourceRef: '#99',
    verdict: 'unresolved' as const,
    fingerprint,
    claimedState: 'open',
    proposalEligible: false,
  }
}

function makeLoadedTokens(): PublicOutputTokens {
  return {
    loaded: true,
    privateTokens: new Set<string>(),
    redactedCanonicalIds: new Set<string>(),
  }
}

function makeBlockingTokens(): PublicOutputTokens {
  return {
    loaded: true,
    privateTokens: new Set(['private-repo-name']),
    redactedCanonicalIds: new Set<string>(),
  }
}

function makeFailedTokens(): PublicOutputTokens {
  return {
    loaded: false,
    error: 'failed to load tokens',
  }
}

function makeOpenIssue(fingerprint: string, overrides: Partial<ExistingProposalIssue> = {}): ExistingProposalIssue {
  return {
    number: 100,
    state: 'open',
    labels: [PROPOSAL_LABEL],
    title: 'Status truth: pr-state drift in docs/plans/example.md',
    body: `<!-- status-truth:fingerprint=${fingerprint} -->\n\nSome body text.`,
    ...overrides,
  }
}

function makeClosedIssue(
  fingerprint: string,
  labels: string[] = [PROPOSAL_LABEL],
  overrides: Partial<ExistingProposalIssue> = {},
): ExistingProposalIssue {
  return {
    number: 200,
    state: 'closed',
    labels,
    title: 'Status truth: pr-state drift in docs/plans/example.md',
    body: `<!-- status-truth:fingerprint=${fingerprint} -->\n\nSome body text.`,
    ...overrides,
  }
}

function makePlanInput(
  overrides: Partial<PlanStatusTruthProposalActionsInput> = {},
): PlanStatusTruthProposalActionsInput {
  return {
    report: makeReport(),
    existingIssues: [],
    publicOutputTokens: makeLoadedTokens(),
    sameRunCreatedFingerprints: new Set<string>(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// extractProposalFingerprint
// ---------------------------------------------------------------------------

describe('extractProposalFingerprint', () => {
  it('extracts fingerprint from a valid hidden marker', () => {
    const body = '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody text.'
    expect(extractProposalFingerprint(body)).toBe('abc123def456abcd')
  })

  it('returns null for body without marker', () => {
    expect(extractProposalFingerprint('No marker here.')).toBeNull()
  })

  it('returns null for null body', () => {
    expect(extractProposalFingerprint(null)).toBeNull()
  })

  it('returns null for undefined body', () => {
    expect(extractProposalFingerprint(undefined)).toBeNull()
  })

  it('returns null for empty body', () => {
    expect(extractProposalFingerprint('')).toBeNull()
  })

  it('returns null for malformed marker (missing value)', () => {
    expect(extractProposalFingerprint('<!-- status-truth:fingerprint= -->')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// planStatusTruthProposalActions — happy paths
// ---------------------------------------------------------------------------

describe('planStatusTruthProposalActions', () => {
  describe('new drifted finding', () => {
    it('plans one open action for a new drifted, proposal-eligible, gate-safe finding', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      const openActions = actions.filter(a => a.type === 'open')
      expect(openActions).toHaveLength(1)
      const openAction = openActions[0]
      expect(openAction?.type).toBe('open')
      if (openAction?.type === 'open') {
        expect(openAction.fingerprint).toBe(finding.fingerprint)
        expect(openAction.title).toContain('pr-state')
        expect(openAction.body).toContain(`<!-- status-truth:fingerprint=${finding.fingerprint} -->`)
        expect(openAction.labels).toContain(PROPOSAL_LABEL)
      }
      expect(counts.opened).toBe(1)
      expect(counts.suppressed).toBe(0)
      expect(counts.blocked).toBe(0)
    })

    it('includes proposed correction in the open action body', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })

      const {actions} = planStatusTruthProposalActions(makePlanInput({report}))
      const openAction = actions.find(a => a.type === 'open')
      if (openAction?.type === 'open') {
        expect(openAction.body).toContain(finding.proposedCorrection)
      }
    })
  })

  describe('matching open issue with unchanged drift', () => {
    it('plans no action when open issue exists and drift is unchanged', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const existingIssue = makeOpenIssue(finding.fingerprint)

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      // No open, no update-comment, no reopen, no close for this fingerprint
      const relevantActions = actions.filter(
        a => a.type !== 'close' || ('issueNumber' in a && a.issueNumber === existingIssue.number),
      )
      expect(relevantActions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(relevantActions.filter(a => a.type === 'update-comment')).toHaveLength(0)
      expect(counts.noAction).toBeGreaterThanOrEqual(1)
    })
  })

  describe('matching open issue with changed drift details', () => {
    it('plans one update-comment when live-state details changed', () => {
      const fingerprint = 'abc123def456abcd'
      const finding = makeDriftedFinding(fingerprint)
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })

      // Existing issue has different live state recorded in body
      const existingIssue = makeOpenIssue(fingerprint, {
        body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      const updateActions = actions.filter(a => a.type === 'update-comment')
      expect(updateActions).toHaveLength(1)
      const updateAction = updateActions[0]
      if (updateAction?.type === 'update-comment') {
        expect(updateAction.issueNumber).toBe(existingIssue.number)
        expect(updateAction.comment).toBeTruthy()
      }
      expect(counts.updated).toBe(1)
    })

    it('increments blocked and emits no update-comment when gate blocks due to token-load failure', () => {
      const fingerprint = 'abc123def456abcd'
      const finding = makeDriftedFinding(fingerprint)
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const existingIssue = makeOpenIssue(fingerprint, {
        body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [existingIssue], publicOutputTokens: makeFailedTokens()}),
      )

      expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
      expect(counts.updated).toBe(0)
    })

    it('increments blocked and emits no update-comment when gate blocks due to blocking tokens', () => {
      const fingerprint = 'abc123def456abcd'
      const finding = {
        ...makeDriftedFinding(fingerprint),
        proposedCorrection: 'pr #42 is closed (private-repo-name)',
      }
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const existingIssue = makeOpenIssue(fingerprint, {
        body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [existingIssue], publicOutputTokens: makeBlockingTokens()}),
      )

      expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
      expect(counts.updated).toBe(0)
    })
  })

  describe('same-run created key deduplication', () => {
    it('suppresses duplicate proposal when fingerprint is in sameRunCreatedFingerprints', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const sameRunCreatedFingerprints = new Set([finding.fingerprint])

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], sameRunCreatedFingerprints}),
      )

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(counts.sameRunDeduplicated).toBe(1)
    })

    it('same-fingerprint second finding is deduplicated when first was blocked by privacy gate', () => {
      // Two drifted findings with the same fingerprint.
      // First has a private token in proposedCorrection → privacy gate blocks it.
      // Second has a safe correction.
      // Expected: zero open actions, blocked=1, sameRunDeduplicated=1.
      // The fingerprint must be tracked as "seen" even when the first attempt is blocked,
      // so the second attempt does not slip through as a new open.
      const fingerprint = 'abc123def456abcd'
      const blockedFinding = {
        ...makeDriftedFinding(fingerprint),
        proposedCorrection: 'pr #42 is closed (private-repo-name)',
      }
      const safeFinding = {
        ...makeDriftedFinding(fingerprint),
        path: 'docs/plans/other.md', // different path, same fingerprint
        proposedCorrection: 'pr #42 is closed',
      }
      const report = makeReport({
        findings: [blockedFinding, safeFinding],
        counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], publicOutputTokens: makeBlockingTokens()}),
      )

      // Zero open actions: first was blocked, second was deduplicated
      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      // First finding was blocked by privacy gate
      expect(counts.blocked).toBe(1)
      // Second finding was deduplicated (fingerprint already seen)
      expect(counts.sameRunDeduplicated).toBe(1)
    })
  })

  describe('close-on-clear', () => {
    it('plans close action for open proposal missing from a complete non-failure scan', () => {
      const fingerprint = 'abc123def456abcd'
      const report = makeReport({
        findings: [],
        status: 'clean',
        scan_complete: true,
        counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
      })
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      const closeActions = actions.filter(a => a.type === 'close')
      expect(closeActions).toHaveLength(1)
      const closeAction = closeActions[0]
      if (closeAction?.type === 'close') {
        expect(closeAction.issueNumber).toBe(existingIssue.number)
        expect(closeAction.labels).toContain(OUTCOME_LABELS.resolved)
      }
      expect(counts.closed).toBe(1)
    })

    it('does NOT plan close when status is execution-failure and scan_complete is false', () => {
      const fingerprint = 'abc123def456abcd'
      const report = makeReport({
        findings: [],
        status: 'execution-failure',
        scan_complete: false,
        failure_class: 'api-unavailable',
        counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
      })
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
    })

    it('does NOT plan close when status is clean but scan_complete is false', () => {
      const fingerprint = 'abc123def456abcd'
      const report = makeReport({
        findings: [],
        status: 'clean',
        scan_complete: false,
        counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
      })
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
      expect(counts.closed).toBe(0)
    })

    it('does NOT plan close when scan_complete is false (execution-error)', () => {
      const fingerprint = 'abc123def456abcd'
      const report = makeReport({
        findings: [],
        status: 'execution-failure',
        scan_complete: false,
        failure_class: 'execution-error',
        counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
      })
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
    })

    it('does NOT close when close-comment is blocked by token-load failure', () => {
      const fingerprint = 'abc123def456abcd'
      const report = makeReport({
        findings: [],
        status: 'clean',
        scan_complete: true,
        counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
      })
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [existingIssue], publicOutputTokens: makeFailedTokens()}),
      )

      expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
      expect(counts.closed).toBe(0)
    })

    it('does NOT close when close-comment is blocked by blocking tokens', () => {
      const fingerprint = 'abc123def456abcd'
      // The close comment contains the generated_at timestamp, not private tokens by default.
      // We use a generated_at that contains the private token to trigger blocking.
      const report = makeReport({
        findings: [],
        status: 'clean',
        scan_complete: true,
        generated_at: 'private-repo-name',
        counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
      })
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [existingIssue], publicOutputTokens: makeBlockingTokens()}),
      )

      expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
      expect(counts.closed).toBe(0)
    })
  })

  describe('reopen non-terminal closed proposal', () => {
    it('plans reopen and clears resolving labels when drift returns for a non-terminal closed issue', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      // Closed without terminal labels (resolved is non-terminal)
      const closedIssue = makeClosedIssue(finding.fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

      const reopenActions = actions.filter(a => a.type === 'reopen')
      expect(reopenActions).toHaveLength(1)
      const reopenAction = reopenActions[0]
      if (reopenAction?.type === 'reopen') {
        expect(reopenAction.issueNumber).toBe(closedIssue.number)
        expect(reopenAction.comment).toContain('recurrence')
        expect(reopenAction.removeLabels).toContain(OUTCOME_LABELS.resolved)
      }
      expect(counts.reopened).toBe(1)
    })

    it('plans reopen for closed issue with manually-fixed label (non-terminal)', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const closedIssue = makeClosedIssue(finding.fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.manuallyFixed])

      const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    })

    it('increments blocked and emits no reopen when gate blocks due to token-load failure', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const closedIssue = makeClosedIssue(finding.fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [closedIssue], publicOutputTokens: makeFailedTokens()}),
      )

      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
      expect(counts.reopened).toBe(0)
    })

    it('increments blocked and emits no reopen when gate blocks due to blocking tokens', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        generated_at: 'private-repo-name',
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const closedIssue = makeClosedIssue(finding.fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [closedIssue], publicOutputTokens: makeBlockingTokens()}),
      )

      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
      expect(counts.reopened).toBe(0)
    })
  })

  describe('terminal suppression (false-positive / rejected)', () => {
    it('suppresses finding and counts it when matching false-positive closed issue exists', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const closedIssue = makeClosedIssue(finding.fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive])

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
      const suppressActions = actions.filter(a => a.type === 'suppress')
      expect(suppressActions).toHaveLength(1)
      expect(counts.suppressed).toBe(1)
    })

    it('suppresses finding when matching rejected closed issue exists', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      const closedIssue = makeClosedIssue(finding.fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.rejected])

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
      expect(counts.suppressed).toBe(1)
    })
  })

  describe('malformed outcome markers', () => {
    it('ignores malformed markers and counts them for operator attention', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      // Issue with malformed fingerprint marker (non-hex chars)
      const malformedIssue: ExistingProposalIssue = {
        number: 300,
        state: 'open',
        labels: [PROPOSAL_LABEL],
        title: 'Status truth: something',
        body: '<!-- status-truth:fingerprint=INVALID!!! -->\n\nBody.',
      }

      const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [malformedIssue]}))

      expect(counts.malformedMarkers).toBeGreaterThanOrEqual(1)
    })
  })

  describe('integration: resolved drift closes only matching proposal', () => {
    it('closes only the matching open proposal, not unrelated proposals', () => {
      const fingerprint1 = 'abc123def456abcd'
      const fingerprint2 = 'deadbeef12345678'

      // Only fingerprint1 drift cleared; fingerprint2 still drifted
      const finding2 = makeDriftedFinding(fingerprint2)
      const report = makeReport({
        findings: [finding2],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })

      const openIssue1 = makeOpenIssue(fingerprint1, {number: 101})
      const openIssue2 = makeOpenIssue(fingerprint2, {number: 102})

      const {actions} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [openIssue1, openIssue2]}),
      )

      const closeActions = actions.filter(a => a.type === 'close')
      expect(closeActions).toHaveLength(1)
      const closeAction = closeActions[0]
      if (closeAction?.type === 'close') {
        expect(closeAction.issueNumber).toBe(101) // Only issue1 closed
      }

      // Issue2 should have no-action (already open, drift unchanged)
      const openActions = actions.filter(a => a.type === 'open')
      expect(openActions).toHaveLength(0)
    })
  })

  describe('gate-blocked proposals', () => {
    it('produces blocked counter only, no action containing blocked text', () => {
      const finding = makeDriftedFinding()

      // Tokens that will block any content containing 'private-repo-name'
      // We need the finding's proposedCorrection to contain the private token
      const blockingFinding = {
        ...finding,
        proposedCorrection: 'pr #42 is closed (private-repo-name)',
      }
      const blockingReport = makeReport({
        findings: [blockingFinding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report: blockingReport, publicOutputTokens: makeBlockingTokens()}),
      )

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)

      // Verify no action contains the blocked text
      for (const action of actions) {
        if (action.type === 'open') {
          expect(action.body).not.toContain('private-repo-name')
          expect(action.title).not.toContain('private-repo-name')
        }
        if (action.type === 'update-comment') {
          expect(action.comment).not.toContain('private-repo-name')
        }
      }
    })

    it('blocks all output when token load fails', () => {
      const finding = makeDriftedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, publicOutputTokens: makeFailedTokens()}),
      )

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(counts.blocked).toBeGreaterThanOrEqual(1)
    })
  })

  describe('unsafe findings', () => {
    it('never produces proposal actions for unsafe findings', () => {
      const unsafeFinding = makeUnsafeFinding()
      const report = makeReport({
        findings: [unsafeFinding],
        counts: {total: 1, current: 0, drifted: 0, unresolved: 0, unsafe: 1, proposal_eligible: 0},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report}))

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
      expect(counts.opened).toBe(0)
    })
  })

  describe('non-proposal-eligible findings', () => {
    it('does not plan actions for unresolved findings (not proposal-eligible)', () => {
      const finding = makeUnresolvedFinding()
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 0, unresolved: 1, unsafe: 0, proposal_eligible: 0},
      })

      const {actions} = planStatusTruthProposalActions(makePlanInput({report}))

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    })
  })

  describe('unknown report version', () => {
    it('returns empty actions and an error count for unknown schema version', () => {
      const report = makeReport({schema_version: 99})

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report}))

      expect(actions).toHaveLength(0)
      expect(counts.versionRejected).toBe(1)
    })

    it('returns empty actions and an error count for unknown fingerprint version', () => {
      const report = makeReport({fingerprint_version: 99})

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report}))

      expect(actions).toHaveLength(0)
      expect(counts.versionRejected).toBe(1)
    })
  })

  describe('counts shape', () => {
    it('returns a complete counts object with all expected fields', () => {
      const {counts} = planStatusTruthProposalActions(makePlanInput())

      expect(typeof counts.opened).toBe('number')
      expect(typeof counts.updated).toBe('number')
      expect(typeof counts.reopened).toBe('number')
      expect(typeof counts.closed).toBe('number')
      expect(typeof counts.suppressed).toBe('number')
      expect(typeof counts.blocked).toBe('number')
      expect(typeof counts.noAction).toBe('number')
      expect(typeof counts.sameRunDeduplicated).toBe('number')
      expect(typeof counts.malformedMarkers).toBe('number')
      expect(typeof counts.versionRejected).toBe('number')
    })
  })

  describe('OUTCOME_LABELS', () => {
    it('exports all required outcome label keys', () => {
      expect(OUTCOME_LABELS.accepted).toBeTruthy()
      expect(OUTCOME_LABELS.rejected).toBeTruthy()
      expect(OUTCOME_LABELS.falsePositive).toBeTruthy()
      expect(OUTCOME_LABELS.superseded).toBeTruthy()
      expect(OUTCOME_LABELS.manuallyFixed).toBeTruthy()
      expect(OUTCOME_LABELS.resolved).toBeTruthy()
      expect(OUTCOME_LABELS.recurring).toBeTruthy()
    })
  })
})

// ---------------------------------------------------------------------------
// Unit 4: executeStatusTruthProposalActions (I/O shell with injected client)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Minimal Octokit mock for Unit 4 tests
// ---------------------------------------------------------------------------

interface MockIssueStore {
  created: {title: string; body: string; labels: string[]}[]
  comments: {issueNumber: number; body: string}[]
  reopened: {issueNumber: number}[]
  closed: {issueNumber: number; labels: string[]}[]
  labelChecks: string[]
  labelCreations: string[]
}

function makeMockOctokit(
  overrides: {
    labelExists?: boolean
    labelCreateFails?: boolean
    issueCreateFails?: boolean
    commentFails?: boolean
  } = {},
): {octokit: StatusTruthOctokitClient; store: MockIssueStore} {
  const store: MockIssueStore = {
    created: [],
    comments: [],
    reopened: [],
    closed: [],
    labelChecks: [],
    labelCreations: [],
  }

  const octokit = {
    rest: {
      issues: {
        getLabel: async ({name}: {owner: string; repo: string; name: string}) => {
          store.labelChecks.push(name)
          if (overrides.labelExists === false) {
            const err = Object.assign(new Error('Not Found'), {status: 404})
            throw err
          }
          return {data: {name}}
        },
        createLabel: async ({
          name,
        }: {
          owner: string
          repo: string
          name: string
          color: string
          description: string
        }) => {
          store.labelCreations.push(name)
          if (overrides.labelCreateFails === true) {
            const err = Object.assign(new Error('Unprocessable'), {status: 422})
            throw err
          }
          return {data: {name}}
        },
        create: async (params: {owner: string; repo: string; title: string; body: string; labels: string[]}) => {
          if (overrides.issueCreateFails === true) {
            const err = Object.assign(new Error('Internal Server Error'), {status: 500})
            throw err
          }
          store.created.push({title: params.title, body: params.body, labels: params.labels})
          return {data: {number: 1000 + store.created.length}}
        },
        createComment: async (params: {owner: string; repo: string; issue_number: number; body: string}) => {
          if (overrides.commentFails === true) {
            const err = Object.assign(new Error('Internal Server Error'), {status: 500})
            throw err
          }
          store.comments.push({issueNumber: params.issue_number, body: params.body})
          return {data: {id: 1}}
        },
        update: async (params: {
          owner: string
          repo: string
          issue_number: number
          state?: string
          labels?: string[]
        }) => {
          if (params.state === 'open') {
            store.reopened.push({issueNumber: params.issue_number})
          } else if (params.state === 'closed') {
            store.closed.push({issueNumber: params.issue_number, labels: params.labels ?? []})
          }
          return {data: {number: params.issue_number}}
        },
        removeLabel: async (_params: {owner: string; repo: string; issue_number: number; name: string}) => {
          return {data: []}
        },
        addLabels: async (_params: {owner: string; repo: string; issue_number: number; labels: string[]}) => {
          return {data: []}
        },
      },
    },
  } as unknown as StatusTruthOctokitClient

  return {octokit, store}
}

function makeExecuteInput(
  overrides: Partial<ExecuteStatusTruthProposalActionsInput> = {},
): ExecuteStatusTruthProposalActionsInput {
  const {octokit} = makeMockOctokit()
  return {
    octokit,
    owner: 'fro-bot',
    repo: '.github',
    actions: [],
    dryRun: false,
    sameRunCreatedFingerprints: new Set<string>(),
    ...overrides,
  }
}

describe('executeStatusTruthProposalActions', () => {
  describe('REQUIRED_LABELS export', () => {
    it('exports REQUIRED_LABELS array containing the proposal label and outcome labels', () => {
      expect(Array.isArray(REQUIRED_LABELS)).toBe(true)
      expect(REQUIRED_LABELS.length).toBeGreaterThan(0)
      // Must include the primary proposal label
      const names = REQUIRED_LABELS.map(l => l.name)
      expect(names).toContain(PROPOSAL_LABEL)
    })
  })

  describe('dry-run mode', () => {
    it('dry-run: emits planned action counts and performs no issue mutations', async () => {
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'open' as const,
          fingerprint: 'abc123def456abcd',
          title: 'Status truth: pr-state drift in docs/plans/example.md',
          body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        actions,
        dryRun: true,
        sameRunCreatedFingerprints: new Set<string>(),
      })

      // No mutations in dry-run
      expect(store.created).toHaveLength(0)
      expect(store.comments).toHaveLength(0)
      expect(store.reopened).toHaveLength(0)
      expect(store.closed).toHaveLength(0)

      // But counts are reported
      expect(result.dryRun).toBe(true)
      expect(result.counts.opened).toBe(1)
      expect(result.counts.failed).toBe(0)
    })

    it('dry-run: reports zero mutations even with multiple action types', async () => {
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'open' as const,
          fingerprint: 'fp1',
          title: 'Title 1',
          body: '<!-- status-truth:fingerprint=fp1 -->\n\nBody.',
          labels: [PROPOSAL_LABEL],
        },
        {
          type: 'update-comment' as const,
          issueNumber: 100,
          comment: 'Updated live state.',
        },
        {
          type: 'close' as const,
          issueNumber: 200,
          labels: [OUTCOME_LABELS.resolved],
          comment: 'Drift cleared.',
        },
      ]

      const result = await executeStatusTruthProposalActions({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        actions,
        dryRun: true,
        sameRunCreatedFingerprints: new Set<string>(),
      })

      expect(store.created).toHaveLength(0)
      expect(store.comments).toHaveLength(0)
      expect(store.closed).toHaveLength(0)
      expect(result.dryRun).toBe(true)
      expect(result.counts.opened).toBe(1)
      expect(result.counts.updated).toBe(1)
      expect(result.counts.closed).toBe(1)
    })
  })

  describe('label gating', () => {
    it('fails closed when required label cannot be confirmed (label check fails non-404)', async () => {
      const octokit = {
        rest: {
          issues: {
            getLabel: async () => {
              const err = Object.assign(new Error('Server Error'), {status: 500})
              throw err
            },
            createLabel: async () => {
              return {data: {name: 'status-truth'}}
            },
            create: async () => {
              return {data: {number: 1}}
            },
            createComment: async () => {
              return {data: {id: 1}}
            },
            update: async () => {
              return {data: {number: 1}}
            },
            removeLabel: async () => {
              return {data: []}
            },
            addLabels: async () => {
              return {data: []}
            },
          },
        },
      } as unknown as StatusTruthOctokitClient

      const actions = [
        {
          type: 'open' as const,
          fingerprint: 'abc123def456abcd',
          title: 'Status truth: pr-state drift',
          body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        actions,
        dryRun: false,
        sameRunCreatedFingerprints: new Set<string>(),
      })

      // No proposals opened when required label cannot be confirmed
      expect(result.counts.opened).toBe(0)
      expect(result.labelGateFailed).toBe(true)
    })

    it('creates label when it does not exist (404) and proceeds', async () => {
      const {octokit, store} = makeMockOctokit({labelExists: false})
      const actions = [
        {
          type: 'open' as const,
          fingerprint: 'abc123def456abcd',
          title: 'Status truth: pr-state drift',
          body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        actions,
        dryRun: false,
        sameRunCreatedFingerprints: new Set<string>(),
      })

      // Label was created
      expect(store.labelCreations.length).toBeGreaterThan(0)
      // Issue was opened after label creation
      expect(result.counts.opened).toBe(1)
      expect(result.labelGateFailed).toBe(false)
    })
  })

  describe('issue mutations', () => {
    it('opens a new proposal issue for an open action', async () => {
      const {octokit, store} = makeMockOctokit()
      const fingerprint = 'abc123def456abcd'
      const actions = [
        {
          type: 'open' as const,
          fingerprint,
          title: 'Status truth: pr-state drift in docs/plans/example.md',
          body: `<!-- status-truth:fingerprint=${fingerprint} -->\n\nBody.`,
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      expect(store.created).toHaveLength(1)
      expect(store.created[0]?.title).toContain('pr-state')
      expect(result.counts.opened).toBe(1)
      expect(result.counts.failed).toBe(0)
    })

    it('adds a comment for an update-comment action', async () => {
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'update-comment' as const,
          issueNumber: 100,
          comment: 'Live-state details changed.',
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      expect(store.comments).toHaveLength(1)
      expect(store.comments[0]?.issueNumber).toBe(100)
      expect(result.counts.updated).toBe(1)
    })

    it('reopens a closed issue for a reopen action', async () => {
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'reopen' as const,
          issueNumber: 200,
          comment: 'Drift recurrence detected.',
          removeLabels: [OUTCOME_LABELS.resolved],
          addLabels: [OUTCOME_LABELS.recurring],
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      expect(store.reopened).toHaveLength(1)
      expect(store.reopened[0]?.issueNumber).toBe(200)
      expect(result.counts.reopened).toBe(1)
    })

    it('closes an issue for a close action', async () => {
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'close' as const,
          issueNumber: 300,
          labels: [OUTCOME_LABELS.resolved],
          comment: 'Drift cleared.',
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      expect(store.closed).toHaveLength(1)
      expect(store.closed[0]?.issueNumber).toBe(300)
      expect(result.counts.closed).toBe(1)
    })

    it('suppress action increments suppressed count without API calls', async () => {
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'suppress' as const,
          fingerprint: 'abc123def456abcd',
          reason: 'terminal outcome label on closed proposal',
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      expect(store.created).toHaveLength(0)
      expect(result.counts.suppressed).toBe(1)
    })
  })

  describe('error resilience', () => {
    it('write API failure leaves report artifact intact and counts failure without leaking raw claim text', async () => {
      const {octokit} = makeMockOctokit({issueCreateFails: true})
      const actions = [
        {
          type: 'open' as const,
          fingerprint: 'abc123def456abcd',
          title: 'Status truth: pr-state drift',
          body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      // Failure is counted, not thrown
      expect(result.counts.failed).toBe(1)
      expect(result.counts.opened).toBe(0)
      // Result is a structured counts object, not raw error text
      expect(typeof result.counts.failed).toBe('number')
    })

    it('one failure does not block unrelated safe proposals', async () => {
      let callCount = 0
      const octokit = {
        rest: {
          issues: {
            getLabel: async () => ({data: {name: PROPOSAL_LABEL}}),
            createLabel: async () => ({data: {name: PROPOSAL_LABEL}}),
            create: async (_params: {title: string; body: string; labels: string[]}) => {
              callCount++
              if (callCount === 1) {
                const err = Object.assign(new Error('Server Error'), {status: 500})
                throw err
              }
              return {data: {number: 1000 + callCount}}
            },
            createComment: async () => ({data: {id: 1}}),
            update: async () => ({data: {number: 1}}),
            removeLabel: async () => ({data: []}),
            addLabels: async () => ({data: []}),
          },
        },
      } as unknown as StatusTruthOctokitClient

      const actions = [
        {
          type: 'open' as const,
          fingerprint: 'fp1',
          title: 'Title 1',
          body: '<!-- status-truth:fingerprint=fp1 -->\n\nBody 1.',
          labels: [PROPOSAL_LABEL],
        },
        {
          type: 'open' as const,
          fingerprint: 'fp2',
          title: 'Title 2',
          body: '<!-- status-truth:fingerprint=fp2 -->\n\nBody 2.',
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      // First failed, second succeeded
      expect(result.counts.failed).toBe(1)
      expect(result.counts.opened).toBe(1)
    })

    it('privacy gate blocks one proposal but does not block unrelated safe proposal', async () => {
      // This is tested at the planning layer (planStatusTruthProposalActions).
      // At the execute layer, actions are already planned and gated.
      // A suppress action for one fingerprint does not affect other open actions.
      const {octokit, store} = makeMockOctokit()
      const actions = [
        {
          type: 'suppress' as const,
          fingerprint: 'blocked-fp',
          reason: 'terminal outcome label on closed proposal',
        },
        {
          type: 'open' as const,
          fingerprint: 'safe-fp',
          title: 'Status truth: safe proposal',
          body: '<!-- status-truth:fingerprint=safe-fp -->\n\nSafe body.',
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions(makeExecuteInput({octokit, actions}))

      expect(result.counts.suppressed).toBe(1)
      expect(result.counts.opened).toBe(1)
      expect(store.created).toHaveLength(1)
    })
  })

  describe('same-run dedup in execute layer', () => {
    it('does not open a proposal if fingerprint is already in sameRunCreatedFingerprints', async () => {
      const {octokit, store} = makeMockOctokit()
      const fingerprint = 'abc123def456abcd'
      const actions = [
        {
          type: 'open' as const,
          fingerprint,
          title: 'Status truth: pr-state drift',
          body: `<!-- status-truth:fingerprint=${fingerprint} -->\n\nBody.`,
          labels: [PROPOSAL_LABEL],
        },
      ]

      const result = await executeStatusTruthProposalActions(
        makeExecuteInput({octokit, actions, sameRunCreatedFingerprints: new Set([fingerprint])}),
      )

      expect(store.created).toHaveLength(0)
      expect(result.counts.sameRunDeduplicated).toBe(1)
      expect(result.counts.opened).toBe(0)
    })
  })

  describe('result shape', () => {
    it('returns a complete ExecuteStatusTruthProposalActionsResult with all expected fields', async () => {
      const result = await executeStatusTruthProposalActions(makeExecuteInput())

      expect(typeof result.dryRun).toBe('boolean')
      expect(typeof result.labelGateFailed).toBe('boolean')
      expect(typeof result.counts.opened).toBe('number')
      expect(typeof result.counts.updated).toBe('number')
      expect(typeof result.counts.reopened).toBe('number')
      expect(typeof result.counts.closed).toBe('number')
      expect(typeof result.counts.suppressed).toBe('number')
      expect(typeof result.counts.failed).toBe('number')
      expect(typeof result.counts.sameRunDeduplicated).toBe('number')
    })
  })
})

// ---------------------------------------------------------------------------
// Unit 4 corrections: fetchExistingProposalIssues tests
// ---------------------------------------------------------------------------

function makeIssueListItem(
  number: number,
  state: 'open' | 'closed',
  labels: string[],
  body: string | null = null,
): IssueListItem {
  return {
    number,
    state,
    title: `Status truth: pr-state drift in docs/plans/example.md`,
    body,
    labels: labels.map(name => ({name})),
  }
}

function makeFetchOctokit(
  overrides: {
    openIssues?: IssueListItem[]
    closedIssues?: IssueListItem[]
    openThrows?: boolean
    closedThrows?: boolean
    closedPage2Throws?: boolean
  } = {},
): StatusTruthOctokitClient {
  const openIssues = overrides.openIssues ?? []
  const closedIssues = overrides.closedIssues ?? []

  return {
    rest: {
      issues: {
        getLabel: async ({name}: {owner: string; repo: string; name: string}) => ({data: {name}}),
        createLabel: async ({
          name,
        }: {
          owner: string
          repo: string
          name: string
          color: string
          description: string
        }) => ({
          data: {name},
        }),
        create: async () => ({data: {number: 1}}),
        createComment: async () => ({data: {id: 1}}),
        update: async (params: {owner: string; repo: string; issue_number: number}) => ({
          data: {number: params.issue_number},
        }),
        removeLabel: async () => ({data: []}),
        addLabels: async () => ({data: []}),
        listForRepo: async (params: {
          owner: string
          repo: string
          labels: string
          state: 'open' | 'closed' | 'all'
          per_page: number
          page: number
        }) => {
          if (params.state === 'open') {
            if (overrides.openThrows === true) throw new Error('API error')
            return {data: openIssues}
          }
          if (overrides.closedThrows === true) throw new Error('API error')
          if (overrides.closedPage2Throws === true && params.page === 2) throw new Error('API error page 2')
          // Return closed issues only on page 1; empty on page 2
          return {data: params.page === 1 ? closedIssues : []}
        },
      },
    },
  } as unknown as StatusTruthOctokitClient
}

describe('fetchExistingProposalIssues', () => {
  it('fetches open proposal issues filtered by PROPOSAL_LABEL', async () => {
    const fp = 'abc123def456abcd'
    const openIssues = [makeIssueListItem(101, 'open', [PROPOSAL_LABEL], `<!-- status-truth:fingerprint=${fp} -->`)]
    const octokit = makeFetchOctokit({openIssues})

    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})

    expect(issues.filter(i => i.state === 'open')).toHaveLength(1)
    expect(issues[0]?.number).toBe(101)
    expect(issues[0]?.labels).toContain(PROPOSAL_LABEL)
  })

  it('fetches recent closed proposal issues filtered by PROPOSAL_LABEL', async () => {
    const fp = 'deadbeef12345678'
    const closedIssues = [
      makeIssueListItem(
        200,
        'closed',
        [PROPOSAL_LABEL, OUTCOME_LABELS.resolved],
        `<!-- status-truth:fingerprint=${fp} -->`,
      ),
    ]
    const octokit = makeFetchOctokit({closedIssues})

    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})

    expect(issues.filter(i => i.state === 'closed')).toHaveLength(1)
    expect(issues.find(i => i.number === 200)?.labels).toContain(OUTCOME_LABELS.resolved)
  })

  it('filters out issues that do not have PROPOSAL_LABEL', async () => {
    const openIssues = [
      makeIssueListItem(101, 'open', ['some-other-label']),
      makeIssueListItem(102, 'open', [PROPOSAL_LABEL]),
    ]
    const octokit = makeFetchOctokit({openIssues})

    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})

    // Only the issue with PROPOSAL_LABEL should be included
    expect(issues.filter(i => i.state === 'open')).toHaveLength(1)
    expect(issues[0]?.number).toBe(102)
  })

  it('throws when open fetch throws (fail-closed for live mode)', async () => {
    const octokit = makeFetchOctokit({openThrows: true})

    // fetchExistingProposalIssues now propagates errors so live runOpen can exit(1)
    await expect(fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow()
  })

  it('throws when closed page-1 fetch throws (fail-closed for live mode)', async () => {
    const fp = 'abc123def456abcd'
    const openIssues = [makeIssueListItem(101, 'open', [PROPOSAL_LABEL], `<!-- status-truth:fingerprint=${fp} -->`)]
    const octokit = makeFetchOctokit({openIssues, closedThrows: true})

    // First closed page failure is fatal — propagated to caller
    await expect(fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow()
  })

  it('returns empty list when no issues exist', async () => {
    const octokit = makeFetchOctokit()

    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})

    expect(issues).toHaveLength(0)
  })

  it('returns page-1 closed issues when page-2 closed fetch throws (best-effort pagination)', async () => {
    const fp = 'abc123def456abcd'
    const closedIssues = [
      makeIssueListItem(
        200,
        'closed',
        [PROPOSAL_LABEL, OUTCOME_LABELS.resolved],
        `<!-- status-truth:fingerprint=${fp} -->`,
      ),
    ]
    const octokit = makeFetchOctokit({closedIssues, closedPage2Throws: true})

    // Page-2 failure is best-effort; page-1 results should still be returned
    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})

    expect(issues.filter(i => i.state === 'closed')).toHaveLength(1)
    expect(issues[0]?.number).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// extractRedactedCanonicalIds — pure helper
// ---------------------------------------------------------------------------

describe('extractRedactedCanonicalIds', () => {
  it('extracts node_id from private entries', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE001',
        private: true,
        node_id: 'R_kgDOFIXTURE001',
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('R_kgDOFIXTURE001')).toBe(true)
  })

  it('extracts database_id as string from private entries', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE002',
        private: true,
        node_id: 'R_kgDOFIXTURE002',
        database_id: 987654321,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('987654321')).toBe(true)
  })

  it('does NOT include node_id or database_id from public (non-private) entries', () => {
    const repos = [
      {
        owner: 'fro-bot',
        name: 'public-repo',
        private: false,
        node_id: 'R_kgDOPUBLIC001',
        database_id: 111111111,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('R_kgDOPUBLIC001')).toBe(false)
    expect(ids.has('111111111')).toBe(false)
  })

  it('does NOT include IDs from entries where private is undefined (treat-as-private fail-safe: excluded from redactedCanonicalIds)', () => {
    // Entries with private===undefined have no confirmed canonical IDs to redact
    // (they have no node_id in practice). They are excluded from redactedCanonicalIds.
    const repos = [
      {
        owner: 'fro-bot',
        name: 'legacy-repo',
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.size).toBe(0)
  })

  it('returns empty set for empty repos array', () => {
    const ids = extractRedactedCanonicalIds([])
    expect(ids.size).toBe(0)
  })

  it('includes both node_id and database_id when both are present on a private entry', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE003',
        private: true,
        node_id: 'R_kgDOFIXTURE003',
        database_id: 123456789,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.has('R_kgDOFIXTURE003')).toBe(true)
    expect(ids.has('123456789')).toBe(true)
    expect(ids.size).toBe(2)
  })

  it('handles private entry with no node_id or database_id gracefully (empty contribution)', () => {
    const repos = [
      {
        owner: '[REDACTED]',
        name: '[REDACTED]',
        private: true,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const ids = extractRedactedCanonicalIds(repos)
    expect(ids.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// loadRedactedCanonicalIdsFromDisk — disk loader
// ---------------------------------------------------------------------------

describe('loadRedactedCanonicalIdsFromDisk', () => {
  it('loads node_id and database_id from private entries in a fixture YAML', async () => {
    const fixtureYaml = `
version: 1
repos:
  - owner: "[REDACTED]"
    name: "R_kgDOFIXTURE001"
    private: true
    node_id: "R_kgDOFIXTURE001"
    database_id: 987654321
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const ids = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    expect(ids.has('R_kgDOFIXTURE001')).toBe(true)
    expect(ids.has('987654321')).toBe(true)
  })

  it('returns empty set when no private entries exist', async () => {
    const fixtureYaml = `
version: 1
repos:
  - owner: "fro-bot"
    name: "public-repo"
    private: false
    node_id: "R_kgDOPUBLIC001"
    database_id: 111111111
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const ids = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    expect(ids.size).toBe(0)
  })

  it('throws when the file cannot be read (fail-closed)', async () => {
    const readFileFn = async (_path: string, _enc: BufferEncoding): Promise<string> => {
      throw new Error('ENOENT: no such file or directory')
    }
    await expect(loadRedactedCanonicalIdsFromDisk(readFileFn)).rejects.toThrow()
  })

  it('throws when the YAML is malformed (fail-closed)', async () => {
    const readFileFn = async (_path: string, _enc: BufferEncoding) => '{ invalid yaml: ['
    await expect(loadRedactedCanonicalIdsFromDisk(readFileFn)).rejects.toThrow()
  })

  it('throws when the YAML has wrong schema (fail-closed)', async () => {
    const readFileFn = async (_path: string, _enc: BufferEncoding) => 'version: 2\nrepos: []'
    await expect(loadRedactedCanonicalIdsFromDisk(readFileFn)).rejects.toThrow()
  })

  it('does not include public repo IDs even when node_id is present', async () => {
    const fixtureYaml = `
version: 1
repos:
  - owner: "fro-bot"
    name: "public-repo"
    private: false
    node_id: "R_kgDOPUBLIC999"
    database_id: 999999999
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
  - owner: "[REDACTED]"
    name: "R_kgDOFIXTURE004"
    private: true
    node_id: "R_kgDOFIXTURE004"
    database_id: 444444444
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const ids = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    // Private entry IDs present
    expect(ids.has('R_kgDOFIXTURE004')).toBe(true)
    expect(ids.has('444444444')).toBe(true)
    // Public entry IDs absent
    expect(ids.has('R_kgDOPUBLIC999')).toBe(false)
    expect(ids.has('999999999')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mutation test: redactedCanonicalIds blocks private node_id in proposal body
// ---------------------------------------------------------------------------

describe('redactedCanonicalIds mutation test — private node_id blocks proposal body', () => {
  it('proposal body containing a fixture private node_id is blocked when loaded via extractRedactedCanonicalIds', () => {
    const privateNodeId = 'R_kgDOFIXTURE001'
    const privateDatabaseId = 987654321

    const repos = [
      {
        owner: '[REDACTED]',
        name: privateNodeId,
        private: true,
        node_id: privateNodeId,
        database_id: privateDatabaseId,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]

    const redactedCanonicalIds = extractRedactedCanonicalIds(repos)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Body containing the private node_id must be blocked
    const bodyWithNodeId = `<!-- status-truth:fingerprint=abc123 -->\n\nRepo node_id: ${privateNodeId}`
    const nodeIdResult = applyPublicOutputGate({
      surface: 'proposal-body',
      content: bodyWithNodeId,
      tokens,
      fingerprint: 'abc123',
    })
    expect(nodeIdResult.allowed).toBe(false)
    if (!nodeIdResult.allowed) {
      expect(nodeIdResult.blockedCount).toBe(1)
      expect('sanitizedContent' in nodeIdResult).toBe(false)
    }

    // Body containing the private database_id (as string) must be blocked
    const bodyWithDatabaseId = `<!-- status-truth:fingerprint=abc123 -->\n\nRepo database_id: ${privateDatabaseId}`
    const databaseIdResult = applyPublicOutputGate({
      surface: 'proposal-body',
      content: bodyWithDatabaseId,
      tokens,
      fingerprint: 'abc123',
    })
    expect(databaseIdResult.allowed).toBe(false)

    // Body with no private IDs must pass
    const safeBody = `<!-- status-truth:fingerprint=abc123 -->\n\nSafe public content.`
    const safeResult = applyPublicOutputGate({
      surface: 'proposal-body',
      content: safeBody,
      tokens,
      fingerprint: 'abc123',
    })
    expect(safeResult.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Unit 4 hardening: label gate must block on ANY missing required label
// ---------------------------------------------------------------------------

describe('executeStatusTruthProposalActions label gate — all required labels', () => {
  it('fails closed when a non-primary outcome label cannot be confirmed (non-404 error)', async () => {
    // Primary label (status-truth) succeeds; one outcome label fails with 500
    const failingLabel = REQUIRED_LABELS.find(l => l.name !== PROPOSAL_LABEL)
    if (failingLabel === undefined) throw new Error('No non-primary required label found')

    const octokit = {
      rest: {
        issues: {
          getLabel: async ({name}: {owner: string; repo: string; name: string}) => {
            if (name === failingLabel.name) {
              const err = Object.assign(new Error('Server Error'), {status: 500})
              throw err
            }
            return {data: {name}}
          },
          createLabel: async ({
            name,
          }: {
            owner: string
            repo: string
            name: string
            color: string
            description: string
          }) => ({
            data: {name},
          }),
          create: async () => ({data: {number: 1}}),
          createComment: async () => ({data: {id: 1}}),
          update: async () => ({data: {number: 1}}),
          removeLabel: async () => ({data: []}),
          addLabels: async () => ({data: []}),
        },
      },
    } as unknown as StatusTruthOctokitClient

    const actions = [
      {
        type: 'open' as const,
        fingerprint: 'abc123def456abcd',
        title: 'Status truth: pr-state drift',
        body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
        labels: [PROPOSAL_LABEL],
      },
    ]

    const result = await executeStatusTruthProposalActions({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })

    // No proposals opened when any required label cannot be confirmed
    expect(result.labelGateFailed).toBe(true)
    expect(result.counts.opened).toBe(0)
  })

  it('fails closed when a non-primary outcome label cannot be created (non-422 error)', async () => {
    const failingLabel = REQUIRED_LABELS.find(l => l.name !== PROPOSAL_LABEL)
    if (failingLabel === undefined) throw new Error('No non-primary required label found')

    const octokit = {
      rest: {
        issues: {
          getLabel: async (_params: {owner: string; repo: string; name: string}) => {
            // All labels return 404 (not found)
            const err = Object.assign(new Error('Not Found'), {status: 404})
            throw err
          },
          createLabel: async ({
            name,
          }: {
            owner: string
            repo: string
            name: string
            color: string
            description: string
          }) => {
            if (name === failingLabel.name) {
              // Non-422 create failure — cannot confirm this label
              const err = Object.assign(new Error('Forbidden'), {status: 403})
              throw err
            }
            return {data: {name}}
          },
          create: async () => ({data: {number: 1}}),
          createComment: async () => ({data: {id: 1}}),
          update: async () => ({data: {number: 1}}),
          removeLabel: async () => ({data: []}),
          addLabels: async () => ({data: []}),
        },
      },
    } as unknown as StatusTruthOctokitClient

    const actions = [
      {
        type: 'open' as const,
        fingerprint: 'abc123def456abcd',
        title: 'Status truth: pr-state drift',
        body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
        labels: [PROPOSAL_LABEL],
      },
    ]

    const result = await executeStatusTruthProposalActions({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })

    expect(result.labelGateFailed).toBe(true)
    expect(result.counts.opened).toBe(0)
  })

  it('proceeds when all required labels are confirmed (primary + all outcome labels)', async () => {
    // All labels exist — gate should pass and proposal should open
    const {octokit, store} = makeMockOctokit()
    const actions = [
      {
        type: 'open' as const,
        fingerprint: 'abc123def456abcd',
        title: 'Status truth: pr-state drift',
        body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
        labels: [PROPOSAL_LABEL],
      },
    ]

    const result = await executeStatusTruthProposalActions({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })

    expect(result.labelGateFailed).toBe(false)
    expect(result.counts.opened).toBe(1)
    expect(store.created).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Unit 4 hardening: live fetch failure blocks mutations
// ---------------------------------------------------------------------------

describe('fetchExistingProposalIssues fail-closed behavior', () => {
  it('propagates open-fetch error so live runOpen can exit before planning mutations', async () => {
    const octokit = makeFetchOctokit({openThrows: true})

    // Must throw — caller (live runOpen) catches and calls process.exit(1)
    await expect(fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow('API error')
  })

  it('propagates closed page-1 error so live runOpen can exit before planning mutations', async () => {
    const fp = 'abc123def456abcd'
    const openIssues = [makeIssueListItem(101, 'open', [PROPOSAL_LABEL], `<!-- status-truth:fingerprint=${fp} -->`)]
    const octokit = makeFetchOctokit({openIssues, closedThrows: true})

    await expect(fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow('API error')
  })
})

// ---------------------------------------------------------------------------
// Unit 4 corrections: open planning uses fetched existing issues
// ---------------------------------------------------------------------------

describe('planStatusTruthProposalActions with fetched existing issues', () => {
  it('no-ops when fetched existing open issue matches the drifted finding fingerprint', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Simulate fetched existing issue with matching fingerprint
    const existingIssue = makeOpenIssue(fingerprint)

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

    // Should not open a duplicate
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.noAction).toBeGreaterThanOrEqual(1)
  })

  it('reopens when fetched existing closed non-terminal issue matches the drifted finding fingerprint', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Simulate fetched closed issue with matching fingerprint (non-terminal)
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.reopened).toBe(1)
  })

  it('suppresses when fetched existing closed terminal issue matches the drifted finding fingerprint', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Simulate fetched closed issue with terminal label
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.suppressed).toBe(1)
  })

  it('dry-run with planned actions performs no mutations but reports counts', async () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))
    expect(actions.filter(a => a.type === 'open')).toHaveLength(1)

    // Execute in dry-run mode
    const {octokit, store} = makeMockOctokit()
    const result = await executeStatusTruthProposalActions({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      actions,
      dryRun: true,
      sameRunCreatedFingerprints: new Set<string>(),
    })

    // No mutations
    expect(store.created).toHaveLength(0)
    expect(store.comments).toHaveLength(0)
    // But counts are reported
    expect(result.dryRun).toBe(true)
    expect(result.counts.opened).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Unit 5: Accuracy signal and operator-facing proposal UX
// ---------------------------------------------------------------------------

describe('per-kind usefulness counters', () => {
  it('accepted outcome label on a closed issue increments usefulnessByKind.accepted for that kind', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed issue with accepted label — non-terminal, so drift returns → reopen
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.accepted])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // accepted is non-terminal so it reopens, but usefulness counter should be incremented
    expect(counts.usefulnessByKind).toBeDefined()
    expect(counts.usefulnessByKind?.['pr-state']?.accepted).toBeGreaterThanOrEqual(1)
  })

  it('rejected outcome label on a closed issue increments usefulnessByKind.rejected for that kind', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.rejected])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(counts.usefulnessByKind).toBeDefined()
    expect(counts.usefulnessByKind?.['pr-state']?.rejected).toBeGreaterThanOrEqual(1)
  })

  it('false-positive outcome label on a closed issue increments usefulnessByKind.falsePositive for that kind', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(counts.usefulnessByKind).toBeDefined()
    expect(counts.usefulnessByKind?.['pr-state']?.falsePositive).toBeGreaterThanOrEqual(1)
  })

  it('malformed outcome markers are excluded from usefulnessByKind accuracy math', () => {
    const malformedIssue: ExistingProposalIssue = {
      number: 300,
      state: 'closed',
      labels: [PROPOSAL_LABEL, 'status-truth:unknown-outcome'],
      title: 'Status truth: something',
      body: '<!-- status-truth:fingerprint=deadbeef12345678 -->\n\nBody.',
    }
    const report = makeReport({
      findings: [],
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [malformedIssue]}))

    // Unknown/malformed outcome labels must not appear in usefulnessByKind
    const kindCounts = counts.usefulnessByKind
    if (kindCounts !== undefined) {
      for (const kind of Object.keys(kindCounts)) {
        const entry = kindCounts[kind]
        if (entry !== undefined) {
          // Only accepted/rejected/falsePositive are valid accuracy signals
          expect(typeof entry.accepted).toBe('number')
          expect(typeof entry.rejected).toBe('number')
          expect(typeof entry.falsePositive).toBe('number')
        }
      }
    }
    // malformedOutcomeMarkers should be counted for operator attention
    expect(counts.malformedOutcomeMarkers).toBeGreaterThanOrEqual(1)
  })

  it('closed proposal with BOTH a recognized accuracy signal label and an unrecognized status-truth:* label is treated as malformed — recognized label excluded from usefulnessByKind', () => {
    // Conservative guard: mixed outcome markers make the issue ambiguous.
    // The recognized label (accepted) must NOT be counted in usefulnessByKind.
    const fingerprint = 'deadbeef12345678'
    const mixedIssue: ExistingProposalIssue = {
      number: 301,
      state: 'closed',
      labels: [PROPOSAL_LABEL, OUTCOME_LABELS.accepted, 'status-truth:unknown-extra'],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: `<!-- status-truth:fingerprint=${fingerprint} -->\n\nBody.`,
    }
    const report = makeReport({
      findings: [],
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [mixedIssue]}))

    // Must be counted as malformed, not as an accuracy signal
    expect(counts.malformedOutcomeMarkers).toBeGreaterThanOrEqual(1)
    // The recognized accepted label must NOT appear in usefulnessByKind accuracy math
    const kindCounts = counts.usefulnessByKind
    if (kindCounts !== undefined) {
      for (const kind of Object.keys(kindCounts)) {
        const entry = kindCounts[kind]
        if (entry !== undefined) {
          // No accuracy signals should be counted from this malformed issue
          expect(entry.accepted).toBe(0)
          expect(entry.rejected).toBe(0)
          expect(entry.falsePositive).toBe(0)
        }
      }
    }
  })

  it('non-outcome labels (resolved, manually-fixed, recurring, superseded) are excluded from accuracy math', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // resolved is non-terminal but not an accuracy signal
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // resolved should not appear in usefulnessByKind accuracy counters
    const kindCounts = counts.usefulnessByKind
    if (kindCounts !== undefined) {
      for (const kind of Object.keys(kindCounts)) {
        const entry = kindCounts[kind]
        if (entry !== undefined) {
          // Accuracy counters should only reflect accepted/rejected/falsePositive
          // resolved does not increment any of these
          expect(entry.accepted + entry.rejected + entry.falsePositive).toBe(0)
        }
      }
    }
  })
})

describe('countsByKind in planner result', () => {
  it('countsByKind aggregates opened proposals by claim kind', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {countsByKind} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    expect(countsByKind).toBeDefined()
    expect(countsByKind?.['pr-state']?.opened).toBeGreaterThanOrEqual(1)
  })

  it('countsByKind is counts-only and does not contain paths or fingerprints', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {countsByKind} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    // countsByKind values must be numeric counts only
    if (countsByKind !== undefined) {
      for (const kind of Object.keys(countsByKind)) {
        const entry = countsByKind[kind]
        if (entry !== undefined) {
          expect(typeof entry.opened).toBe('number')
          expect(typeof entry.updated).toBe('number')
          expect(typeof entry.reopened).toBe('number')
          expect(typeof entry.closed).toBe('number')
          expect(typeof entry.suppressed).toBe('number')
          // No path or fingerprint fields — KindActionCounts only has numeric count fields
          const entryKeys = Object.keys(entry as object)
          expect(entryKeys).not.toContain('path')
          expect(entryKeys).not.toContain('fingerprint')
        }
      }
    }
  })
})

describe('terminal vs non-terminal label semantics', () => {
  it('rejected label suppresses future matching findings (terminal)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.rejected])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // Terminal: no reopen, no open — only suppress
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(counts.suppressed).toBe(1)
  })

  it('false-positive label suppresses future matching findings (terminal)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(counts.suppressed).toBe(1)
  })

  it('accepted label does NOT suppress — allows reopen when drift returns (non-terminal)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.accepted])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // Non-terminal: drift returned → reopen
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.suppressed).toBe(0)
  })

  it('manually-fixed label does NOT suppress — allows reopen when drift returns (non-terminal)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.manuallyFixed])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.suppressed).toBe(0)
  })

  it('recurring label does NOT suppress — allows reopen when drift returns (non-terminal)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.recurring])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.suppressed).toBe(0)
  })

  it('superseded label does NOT suppress — allows reopen when drift returns (non-terminal)', () => {
    // superseded is a lifecycle state label, not a terminal suppressor.
    // If the same drift returns after a proposal was superseded, the loop reopens it.
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.superseded])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.suppressed).toBe(0)
  })
})

describe('manually-fixed auto-close when drift clears', () => {
  it('closes a manually-fixed open proposal with resolved label when drift clears (scan complete)', () => {
    const fingerprint = 'abc123def456abcd'
    // No findings in report — drift cleared
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    // Open proposal with manually-fixed label (drift was manually fixed but issue still open)
    const openIssue = makeOpenIssue(fingerprint, {
      labels: [PROPOSAL_LABEL, OUTCOME_LABELS.manuallyFixed],
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [openIssue]}))

    const closeActions = actions.filter(a => a.type === 'close')
    expect(closeActions).toHaveLength(1)
    const closeAction = closeActions[0]
    if (closeAction?.type === 'close') {
      expect(closeAction.issueNumber).toBe(openIssue.number)
      expect(closeAction.labels).toContain(OUTCOME_LABELS.resolved)
    }
    expect(counts.closed).toBe(1)
  })
})

describe('closed proposal without outcome marker — conservative treatment', () => {
  it('closed proposal with fingerprint but no outcome label is treated as non-terminal (reopen when drift returns)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed with only the proposal label — no outcome label
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // Conservative: no brand-new open; reopen instead
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.reopened).toBe(1)
  })

  it('closed proposal without outcome marker is NOT silently treated as clean (counted for operator attention)', () => {
    const fingerprint = 'abc123def456abcd'
    // No findings — drift cleared
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    // Closed with only the proposal label — no outcome label
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // The closed issue without outcome marker should be counted for operator attention
    expect(counts.closedWithoutOutcome).toBeGreaterThanOrEqual(1)
  })
})

describe('proposal body conciseness', () => {
  it('proposal body contains evidence fields but no raw claim text or session narration', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    const openAction = actions.find(a => a.type === 'open')
    if (openAction?.type === 'open') {
      // Must contain structured evidence fields
      expect(openAction.body).toContain('Kind')
      expect(openAction.body).toContain('Claimed state')
      // Must NOT contain session narration phrases
      expect(openAction.body).not.toMatch(/I (found|detected|noticed|analyzed|checked)/i)
      expect(openAction.body).not.toMatch(/session|agent|workflow log/i)
      // Must contain the fingerprint marker (machine-readable, not raw claim text)
      expect(openAction.body).toContain(`<!-- status-truth:fingerprint=${finding.fingerprint} -->`)
    }
  })

  it('workflow/open result summary is counts-only by claim kind — no paths or fingerprints', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    // countsByKind must be present and counts-only
    expect(result.countsByKind).toBeDefined()
    const json = JSON.stringify(result.countsByKind)
    // Must not contain file paths or fingerprint-like hex strings
    expect(json).not.toMatch(/docs\/plans|scripts\/|\.github\//)
    expect(json).not.toMatch(/[a-f0-9]{16,}/)
  })
})

// ---------------------------------------------------------------------------
// Fix #2: Incomplete/failed scans must not create public proposals
// ---------------------------------------------------------------------------

describe('Fix #2: execution-failure or scan_complete=false blocks all proposal actions', () => {
  it('execution-failure report with drifted proposal-eligible findings yields zero open/reopen/update/close actions', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      status: 'execution-failure',
      scan_complete: false,
      failure_class: 'api-unavailable',
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    // No open/reopen/update/close actions when scan is incomplete
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
    // Findings should be counted as blocked
    expect(counts.blocked).toBeGreaterThanOrEqual(1)
    expect(counts.opened).toBe(0)
  })

  it('scan_complete=false with drifted findings yields zero proposal actions regardless of status field', () => {
    const finding = makeDriftedFinding()
    // Even if status is somehow 'findings' but scan_complete is false
    const report = makeReport({
      status: 'findings',
      scan_complete: false,
      failure_class: null,
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.blocked).toBeGreaterThanOrEqual(1)
    expect(counts.opened).toBe(0)
  })

  it('versionRejected behavior is preserved when scan is also incomplete', () => {
    const report = makeReport({
      schema_version: 99,
      status: 'execution-failure',
      scan_complete: false,
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report}))

    expect(actions).toHaveLength(0)
    expect(counts.versionRejected).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Fix #4: Label preflight 422 must not silently pass unless label truly exists
// ---------------------------------------------------------------------------

describe('Fix #4: createLabel 422 requires getLabel confirmation', () => {
  it('createLabel returns 422 and follow-up getLabel fails (non-404) => label gate fails', async () => {
    // Scenario: label does not exist (404 on first getLabel), createLabel returns 422 (race),
    // but follow-up getLabel also fails (non-404 error) => cannot confirm => gate fails
    const octokit = {
      rest: {
        issues: {
          getLabel: async ({name}: {owner: string; repo: string; name: string}) => {
            // First call: 404 (not found). Second call (confirmation after 422): 500 error
            // We track call count per label name
            const callKey = `getLabel:${name}`
            const count = ((octokit as unknown as Record<string, number>)[callKey] ?? 0) + 1
            ;(octokit as unknown as Record<string, number>)[callKey] = count
            if (count === 1) {
              // First call: label not found
              const err = Object.assign(new Error('Not Found'), {status: 404})
              throw err
            }
            // Second call (confirmation): non-404 error
            const err = Object.assign(new Error('Server Error'), {status: 500})
            throw err
          },
          createLabel: async (_params: {
            owner: string
            repo: string
            name: string
            color: string
            description: string
          }) => {
            // Returns 422 (race condition — label already exists)
            const err = Object.assign(new Error('Unprocessable'), {status: 422})
            throw err
          },
          create: async () => ({data: {number: 1}}),
          createComment: async () => ({data: {id: 1}}),
          update: async () => ({data: {number: 1}}),
          removeLabel: async () => ({data: []}),
          addLabels: async () => ({data: []}),
        },
      },
    } as unknown as StatusTruthOctokitClient

    const actions = [
      {
        type: 'open' as const,
        fingerprint: 'abc123def456abcd',
        title: 'Status truth: pr-state drift',
        body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
        labels: [PROPOSAL_LABEL],
      },
    ]

    const result = await executeStatusTruthProposalActions({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })

    // Cannot confirm label => gate fails
    expect(result.labelGateFailed).toBe(true)
    expect(result.counts.opened).toBe(0)
  })

  it('createLabel returns 422 and follow-up getLabel succeeds => label confirmed', async () => {
    // Scenario: label does not exist (404 on first getLabel), createLabel returns 422 (race),
    // follow-up getLabel succeeds => label confirmed => gate passes
    const callCounts: Record<string, number> = {}
    const octokit = {
      rest: {
        issues: {
          getLabel: async ({name}: {owner: string; repo: string; name: string}) => {
            callCounts[name] = (callCounts[name] ?? 0) + 1
            if (callCounts[name] === 1) {
              // First call: label not found
              const err = Object.assign(new Error('Not Found'), {status: 404})
              throw err
            }
            // Second call (confirmation after 422): label exists
            return {data: {name}}
          },
          createLabel: async (_params: {
            owner: string
            repo: string
            name: string
            color: string
            description: string
          }) => {
            // Returns 422 (race condition — label already exists)
            const err = Object.assign(new Error('Unprocessable'), {status: 422})
            throw err
          },
          create: async (params: {owner: string; repo: string; title: string; body: string; labels: string[]}) => ({
            data: {number: 1001, title: params.title},
          }),
          createComment: async () => ({data: {id: 1}}),
          update: async () => ({data: {number: 1}}),
          removeLabel: async () => ({data: []}),
          addLabels: async () => ({data: []}),
        },
      },
    } as unknown as StatusTruthOctokitClient

    const actions = [
      {
        type: 'open' as const,
        fingerprint: 'abc123def456abcd',
        title: 'Status truth: pr-state drift',
        body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
        labels: [PROPOSAL_LABEL],
      },
    ]

    const result = await executeStatusTruthProposalActions({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      actions,
      dryRun: false,
      sameRunCreatedFingerprints: new Set<string>(),
    })

    // Label confirmed via getLabel after 422 => gate passes
    expect(result.labelGateFailed).toBe(false)
    expect(result.counts.opened).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Fix #9: Same-run duplicate proposal test
// ---------------------------------------------------------------------------

describe('Fix #9: same-run duplicate proposal deduplication', () => {
  it('two drifted findings with same fingerprint in one report result in only one open proposal and sameRunDeduplicated=1', () => {
    const fingerprint = 'abc123def456abcd'
    // Two findings with the same fingerprint (e.g. same claim in two places)
    const finding1 = makeDriftedFinding(fingerprint)
    const finding2 = {...makeDriftedFinding(fingerprint), path: 'docs/plans/other.md'}
    const report = makeReport({
      findings: [finding1, finding2],
      counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    // Only one open action (first occurrence)
    const openActions = actions.filter(a => a.type === 'open')
    expect(openActions).toHaveLength(1)
    // Second occurrence is deduplicated
    expect(counts.sameRunDeduplicated).toBe(1)
    expect(counts.opened).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Security fix #1: Octokit no-op log handlers
// ---------------------------------------------------------------------------

describe('NOOP_LOG — Octokit default logger suppression', () => {
  it('NOOP_LOG is exported and has all four required log handler methods', () => {
    expect(typeof NOOP_LOG).toBe('object')
    expect(typeof NOOP_LOG.debug).toBe('function')
    expect(typeof NOOP_LOG.info).toBe('function')
    expect(typeof NOOP_LOG.warn).toBe('function')
    expect(typeof NOOP_LOG.error).toBe('function')
  })

  it('NOOP_LOG handlers are callable and return undefined (no-op)', () => {
    // Calling them must not throw and must not produce output
    expect(NOOP_LOG.debug()).toBeUndefined()
    expect(NOOP_LOG.info()).toBeUndefined()
    expect(NOOP_LOG.warn()).toBeUndefined()
    expect(NOOP_LOG.error()).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Security fix #2: case-sensitive canonical ID matching
// ---------------------------------------------------------------------------

describe('redactedCanonicalIds — case-sensitive substring matching', () => {
  it('proposal body containing the exact fixture node_id as a substring is blocked', () => {
    // Use fixture IDs only — no real private values
    const fixtureNodeId = 'R_kgDOFIXTURE001'
    const repos = [
      {
        owner: '[REDACTED]',
        name: fixtureNodeId,
        private: true as const,
        node_id: fixtureNodeId,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const redactedCanonicalIds = extractRedactedCanonicalIds(repos)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Body containing the exact node_id as a substring must be blocked
    const bodyWithId = `<!-- status-truth:fingerprint=abc123 -->\n\nRepo: ${fixtureNodeId} is referenced here.`
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: bodyWithId,
      tokens,
      fingerprint: 'abc123',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      expect('sanitizedContent' in result).toBe(false)
    }
  })

  it('proposal body containing a different-case variant of the fixture node_id is NOT blocked (case-sensitive)', () => {
    // The canonical ID has a specific casing; a different-case variant is a different string
    const fixtureNodeId = 'R_kgDOFIXTURE001'
    const repos = [
      {
        owner: '[REDACTED]',
        name: fixtureNodeId,
        private: true as const,
        node_id: fixtureNodeId,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const redactedCanonicalIds = extractRedactedCanonicalIds(repos)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Different-case variant — must NOT be treated as the same canonical ID
    const differentCaseId = fixtureNodeId.toLowerCase() // 'r_kgdofixture001'
    const bodyWithDifferentCase = `<!-- status-truth:fingerprint=abc123 -->\n\nRef: ${differentCaseId}`
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: bodyWithDifferentCase,
      tokens,
      fingerprint: 'abc123',
    })
    // Case-sensitive: different-case variant must pass (it's a different string)
    expect(result.allowed).toBe(true)
  })

  it('proposal body containing the exact fixture database_id as a substring is blocked', () => {
    const fixtureDatabaseId = 987654321
    const repos = [
      {
        owner: '[REDACTED]',
        name: 'R_kgDOFIXTURE002',
        private: true as const,
        node_id: 'R_kgDOFIXTURE002',
        database_id: fixtureDatabaseId,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const redactedCanonicalIds = extractRedactedCanonicalIds(repos)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Body containing the database_id as a substring must be blocked
    const bodyWithDbId = `<!-- status-truth:fingerprint=abc123 -->\n\nDatabase ID: ${fixtureDatabaseId}`
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: bodyWithDbId,
      tokens,
      fingerprint: 'abc123',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
    }
  })

  it('safe body with no canonical IDs passes when redactedCanonicalIds are loaded', () => {
    const fixtureNodeId = 'R_kgDOFIXTURE001'
    const repos = [
      {
        owner: '[REDACTED]',
        name: fixtureNodeId,
        private: true as const,
        node_id: fixtureNodeId,
        added: '2026-01-01',
        onboarding_status: 'onboarded' as const,
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ]
    const redactedCanonicalIds = extractRedactedCanonicalIds(repos)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    const safeBody = `<!-- status-truth:fingerprint=abc123 -->\n\nSafe public content with no private IDs.`
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: safeBody,
      tokens,
      fingerprint: 'abc123',
    })
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Security fix #3: production-loaded redactedCanonicalIds block rendered content
// ---------------------------------------------------------------------------

describe('production-loaded redactedCanonicalIds — block rendered proposal body/comment without leaking IDs', () => {
  it('loadRedactedCanonicalIdsFromDisk + applyPublicOutputGate blocks proposal body containing fixture node_id', async () => {
    // Simulate production load path: loadRedactedCanonicalIdsFromDisk → makePublicOutputTokens → applyPublicOutputGate
    const fixtureNodeId = 'R_kgDOFIXTURE001'
    const fixtureYaml = `
version: 1
repos:
  - owner: "[REDACTED]"
    name: "${fixtureNodeId}"
    private: true
    node_id: "${fixtureNodeId}"
    database_id: 987654321
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const redactedCanonicalIds = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Proposal body containing the fixture node_id must be blocked
    const bodyWithId = `<!-- status-truth:fingerprint=abc123 -->\n\nRepo node_id: ${fixtureNodeId} is referenced.`
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: bodyWithId,
      tokens,
      fingerprint: 'abc123',
    })

    // Must be blocked — no ID leaks to sanitizedContent
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      // Blocked text must not appear in any output field
      expect('sanitizedContent' in result).toBe(false)
      expect('blockedContent' in result).toBe(false)
    }
  })

  it('loadRedactedCanonicalIdsFromDisk + applyPublicOutputGate blocks comment containing fixture database_id', async () => {
    const fixtureDatabaseId = 987654321
    const fixtureYaml = `
version: 1
repos:
  - owner: "[REDACTED]"
    name: "R_kgDOFIXTURE002"
    private: true
    node_id: "R_kgDOFIXTURE002"
    database_id: ${fixtureDatabaseId}
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const redactedCanonicalIds = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Comment containing the fixture database_id must be blocked
    const commentWithDbId = `Drift recurrence detected. Database ID: ${fixtureDatabaseId} is referenced.`
    const result = applyPublicOutputGate({
      surface: 'recurrence-comment',
      content: commentWithDbId,
      tokens,
      fingerprint: 'abc123',
    })

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      expect('sanitizedContent' in result).toBe(false)
    }
  })

  it('production-loaded tokens do not block safe content (no false positives)', async () => {
    const fixtureNodeId = 'R_kgDOFIXTURE001'
    const fixtureYaml = `
version: 1
repos:
  - owner: "[REDACTED]"
    name: "${fixtureNodeId}"
    private: true
    node_id: "${fixtureNodeId}"
    database_id: 987654321
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const redactedCanonicalIds = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Safe content with no private IDs must pass
    const safeBody = `<!-- status-truth:fingerprint=abc123 -->\n\nDrift detected in docs/plans/example.md. PR #42 is closed.`
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: safeBody,
      tokens,
      fingerprint: 'abc123',
    })

    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.sanitizedContent).toBe(safeBody)
    }
  })

  it('planStatusTruthProposalActions with production-loaded tokens blocks proposal body containing fixture node_id', async () => {
    // End-to-end: load tokens from fixture YAML, run planner, verify blocked count and no open actions
    const fixtureNodeId = 'R_kgDOFIXTURE001'
    const fixtureYaml = `
version: 1
repos:
  - owner: "[REDACTED]"
    name: "${fixtureNodeId}"
    private: true
    node_id: "${fixtureNodeId}"
    database_id: 987654321
    added: "2026-01-01"
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
`
    const readFileFn = async (_path: string, _enc: BufferEncoding) => fixtureYaml
    const redactedCanonicalIds = await loadRedactedCanonicalIdsFromDisk(readFileFn)
    const tokens = makePublicOutputTokens({
      privateTokens: new Set<string>(),
      redactedCanonicalIds,
    })

    // Finding whose proposedCorrection contains the fixture node_id
    const finding = {
      ...makeDriftedFinding('abc123def456abcd'),
      proposedCorrection: `Repo node_id is ${fixtureNodeId}`,
    }
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [], publicOutputTokens: tokens}),
    )

    // No open actions — body was blocked by the canonical ID gate
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.blocked).toBeGreaterThanOrEqual(1)

    // Verify no action contains the fixture node_id (no leakage)
    for (const action of actions) {
      if (action.type === 'open') {
        expect(action.body).not.toContain(fixtureNodeId)
        expect(action.title).not.toContain(fixtureNodeId)
      }
      if (action.type === 'update-comment' || action.type === 'reopen' || action.type === 'close') {
        expect(action.comment).not.toContain(fixtureNodeId)
      }
    }
  })
})
