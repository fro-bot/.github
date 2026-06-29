/**
 * Tests for the status-truth proposal lifecycle planner (Unit 3).
 *
 * TDD: tests written before implementation.
 * All tests are pure — no Octokit, no disk I/O.
 */

import type {StatusTruthJsonReport} from './status-truth-detect.ts'
import type {ExistingProposalIssue, PlanStatusTruthProposalActionsInput} from './status-truth-proposals.ts'
import type {PublicOutputTokens} from './status-truth-public-output.ts'
import {describe, expect, it} from 'vitest'
import {
  extractProposalFingerprint,
  OUTCOME_LABELS,
  planStatusTruthProposalActions,
  PROPOSAL_LABEL,
} from './status-truth-proposals.ts'

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
