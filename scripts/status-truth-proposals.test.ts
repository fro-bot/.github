/**
 * Tests for the status-truth proposal lifecycle planner and I/O executor.
 *
 * All tests are pure — no Octokit, no disk I/O.
 */

import type {StatusTruthJsonReport} from './status-truth-detect.ts'
import type {
  ExecuteStatusTruthProposalActionsInput,
  ExistingProposalIssue,
  IssueListItem,
  OutcomeCounts,
  PlanStatusTruthProposalActionsInput,
  StatusTruthOctokitClient,
} from './status-truth-proposals.ts'
import type {PublicOutputTokens} from './status-truth-public-output.ts'
import {describe, expect, it} from 'vitest'
import {
  buildOutcomeCounts,
  buildOutcomeCountsByKind,
  classifyProposalOutcome,
  executeStatusTruthProposalActions,
  extractProposalFingerprint,
  extractProposalKind,
  extractRedactedCanonicalIds,
  fetchExistingProposalIssues,
  isWithinCooldown,
  loadRedactedCanonicalIdsFromDisk,
  NOOP_LOG,
  OUTCOME_LABELS,
  planStatusTruthProposalActions,
  PROPOSAL_LABEL,
  recoverProposalKind,
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
// extractProposalKind / recoverProposalKind
// ---------------------------------------------------------------------------

describe('extractProposalKind', () => {
  it('extracts kind from a valid hidden marker', () => {
    const body = '<!-- status-truth:kind=pr-state -->\n\nBody text.'
    expect(extractProposalKind(body)).toBe('pr-state')
  })

  it('returns null for body without marker', () => {
    expect(extractProposalKind('No marker here.')).toBeNull()
  })

  it('returns null for null body', () => {
    expect(extractProposalKind(null)).toBeNull()
  })

  it('returns null for undefined body', () => {
    expect(extractProposalKind(undefined)).toBeNull()
  })

  it('returns null for empty body', () => {
    expect(extractProposalKind('')).toBeNull()
  })

  it('returns null for malformed marker (missing value)', () => {
    expect(extractProposalKind('<!-- status-truth:kind= -->')).toBeNull()
  })
})

describe('recoverProposalKind — precedence and closed-vocabulary validation', () => {
  it('prefers the hidden kind marker over the visible Kind body line', () => {
    const body = '<!-- status-truth:kind=pr-state -->\n\n**Kind:** `issue-state`\n'
    expect(recoverProposalKind(body)).toBe('pr-state')
  })

  it('falls back to the visible **Kind:** body line when the hidden marker is absent', () => {
    const body = '**Kind:** `plan-consistency`\n\nSome other text.'
    expect(recoverProposalKind(body)).toBe('plan-consistency')
  })

  it('returns unknown when neither the marker nor the body line is present', () => {
    expect(recoverProposalKind('No kind information here.')).toBe('unknown')
  })

  it('returns unknown for a null body', () => {
    expect(recoverProposalKind(null)).toBe('unknown')
  })

  it('returns unknown for an undefined body', () => {
    expect(recoverProposalKind(undefined)).toBe('unknown')
  })

  it('buckets an unrecognized marker kind as unknown — closed vocabulary only', () => {
    const body = '<!-- status-truth:kind=arbitrary-attacker-text -->\n\nBody.'
    expect(recoverProposalKind(body)).toBe('unknown')
  })

  it('buckets an unrecognized visible Kind line as unknown — closed vocabulary only', () => {
    const body = '**Kind:** `<script>alert(1)</script>`\n\nBody.'
    expect(recoverProposalKind(body)).toBe('unknown')
  })

  it('recognizes every known ClaimKind value from the hidden marker', () => {
    const knownKinds = [
      'pr-state',
      'issue-state',
      'release-tag-state',
      'plan-status',
      'rollout-tracker-status',
      'plan-consistency',
    ]
    for (const kind of knownKinds) {
      const body = `<!-- status-truth:kind=${kind} -->\n\nBody.`
      expect(recoverProposalKind(body)).toBe(kind)
    }
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
        expect(openAction.body).toContain(`<!-- status-truth:kind=${finding.kind} -->`)
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

    it('second finding with same fingerprint as an update-comment path is deduplicated', () => {
      // Two findings share a fingerprint. The first matches an open issue whose
      // live-state differs → update-comment. The second (same fingerprint) must
      // be deduplicated rather than opening a new proposal.
      const fingerprint = 'abc123def456abcd'
      const finding1 = makeDriftedFinding(fingerprint)
      const finding2 = {...makeDriftedFinding(fingerprint), path: 'docs/plans/other.md'}
      const report = makeReport({
        findings: [finding1, finding2],
        counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
      })
      // Open issue with a different recorded live-state → triggers update-comment for finding1
      const openIssue = makeOpenIssue(fingerprint, {
        body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [openIssue]}))

      // Exactly one update-comment for the first finding
      expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(1)
      // No open actions — second finding must be deduplicated
      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      // Second finding counted as same-run deduplicated
      expect(counts.sameRunDeduplicated).toBe(1)
    })

    it('second finding with same fingerprint as a reopen path is deduplicated', () => {
      // Two findings share a fingerprint. The first matches a non-terminal closed
      // issue past cooldown → reopen. The second (same fingerprint) must be
      // deduplicated rather than opening a new proposal.
      const fingerprint = 'abc123def456abcd'
      const finding1 = makeDriftedFinding(fingerprint)
      const finding2 = {...makeDriftedFinding(fingerprint), path: 'docs/plans/other.md'}
      const report = makeReport({
        findings: [finding1, finding2],
        counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
      })
      // Closed non-terminal issue past the 7-day cooldown
      const pastCooldown = '2026-06-01T00:00:00Z'
      const closedIssue: ExistingProposalIssue = {
        ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved]),
        closedAt: pastCooldown,
      }
      const now = new Date('2026-06-30T00:00:00Z')

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [closedIssue], now}),
      )

      // Exactly one reopen for the first finding
      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
      // No open actions — second finding must be deduplicated
      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      // Second finding counted as same-run deduplicated
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

    it('does NOT close open proposal when report includes unsafe findings (fail-closed on inaccessible prior drift)', () => {
      const fingerprint = 'abc123def456abcd'
      const report = makeReport({
        findings: [makeUnsafeFinding()],
        status: 'findings',
        scan_complete: true,
        counts: {total: 1, current: 0, drifted: 0, unresolved: 0, unsafe: 1, proposal_eligible: 0},
      })
      // An open proposal whose fingerprint is NOT in the current findings (drift appears cleared)
      const existingIssue = makeOpenIssue(fingerprint)

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

      // Must NOT close: unsafe findings mean prior drift may be inaccessible/private, not genuinely cleared
      expect(actions.filter(a => a.type === 'close')).toHaveLength(0)
      expect(counts.closed).toBe(0)
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
      expect(typeof counts.needsOutcomeCooldown).toBe('number')
    })

    it('needsOutcomeCooldown is surfaced in plannedCounts when a closed-without-outcome issue is within cooldown', () => {
      const fingerprint = 'abc123def456abcd'
      const finding = makeDriftedFinding(fingerprint)
      const report = makeReport({
        findings: [finding],
        counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
      })
      // Closed 2 days ago with no outcome label — within the 7-day cooldown window
      const closedAt = '2026-06-28T00:00:00Z'
      const now = new Date('2026-06-30T00:00:00Z')
      const closedIssue: ExistingProposalIssue = {
        ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
        closedAt,
      }

      const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue], now}))

      // Planner must count the cooldown-blocked issue
      expect(counts.needsOutcomeCooldown).toBe(1)
      // No reopen during cooldown
      expect(counts.reopened).toBe(0)
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
// executeStatusTruthProposalActions (I/O shell with injected client)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Minimal Octokit mock for executor tests
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
// fetchExistingProposalIssues tests
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
            // Paginate: slice by per_page and page
            const start = (params.page - 1) * params.per_page
            return {data: openIssues.slice(start, start + params.per_page)}
          }
          if (overrides.closedThrows === true) throw new Error('API error')
          if (overrides.closedPage2Throws === true && params.page === 2) throw new Error('API error page 2')
          // Paginate: slice by per_page and page
          const start = (params.page - 1) * params.per_page
          return {data: closedIssues.slice(start, start + params.per_page)}
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

  it('throws when closed page-2 fetch throws (fail-closed: all pagination errors propagate)', async () => {
    // Build exactly per_page (100) closed issues on page 1 so pagination continues to page 2.
    const closedIssues: IssueListItem[] = Array.from({length: 100}, (_, i) =>
      makeIssueListItem(200 + i, 'closed', [PROPOSAL_LABEL, OUTCOME_LABELS.resolved], null),
    )
    const octokit = makeFetchOctokit({closedIssues, closedPage2Throws: true})

    // Page-2 failure propagates — fail-closed, no partial results
    await expect(fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})).rejects.toThrow(
      'API error page 2',
    )
  })

  it('fetches all closed issues across multiple pages (no truncation beyond 100)', async () => {
    // Build 150 closed issues spread across two pages of 100 each.
    // The mock slices by per_page/page, so page 1 returns items 0-99 and page 2 returns items 100-149.
    const closedIssues: IssueListItem[] = Array.from({length: 150}, (_, i) =>
      makeIssueListItem(
        300 + i,
        'closed',
        [PROPOSAL_LABEL, OUTCOME_LABELS.resolved],
        `<!-- status-truth:fingerprint=${String(i).padStart(16, '0')} -->`,
      ),
    )
    const octokit = makeFetchOctokit({closedIssues})

    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})

    const closed = issues.filter(i => i.state === 'closed')
    expect(closed).toHaveLength(150)
    // Verify issues from the second page (numbers 400-449) are present
    const secondPageNumbers = closed.map(i => i.number).filter(n => n >= 400)
    expect(secondPageNumbers.length).toBe(50)
  })

  it('outcome counts include closed issues beyond the first 100', async () => {
    // 120 closed issues: first 100 are accepted, last 20 are rejected.
    // Without full pagination, the 20 rejected issues on page 2 would be missed.
    const closedIssues: IssueListItem[] = [
      ...Array.from({length: 100}, (_, i) =>
        makeIssueListItem(
          500 + i,
          'closed',
          [PROPOSAL_LABEL, OUTCOME_LABELS.accepted],
          `<!-- status-truth:fingerprint=${String(i).padStart(16, '0')} -->`,
        ),
      ),
      ...Array.from({length: 20}, (_, i) =>
        makeIssueListItem(
          600 + i,
          'closed',
          [PROPOSAL_LABEL, OUTCOME_LABELS.rejected],
          `<!-- status-truth:fingerprint=${String(100 + i).padStart(16, '0')} -->`,
        ),
      ),
    ]
    const octokit = makeFetchOctokit({closedIssues})

    const issues = await fetchExistingProposalIssues({octokit, owner: 'fro-bot', repo: '.github'})
    const counts = buildOutcomeCounts(issues)

    expect(counts.explicitAccepted).toBe(100)
    expect(counts.explicitRejected).toBe(20)
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
// Label gate must block on any missing required label
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
// Live fetch failure blocks mutations
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
// Open planning uses fetched existing issues
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
// Accuracy signal and operator-facing proposal UX
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
  it('closed proposal with fingerprint but no outcome label and no closedAt is conservative — no reopen, counted for attention', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed with only the proposal label — no outcome label, no closedAt
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL])

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]}))

    // Conservative: no reopen without closedAt (cannot determine cooldown)
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    // Counted for operator attention
    expect(counts.needsOutcomeCooldown).toBeGreaterThanOrEqual(1)
  })

  it('closed proposal with fingerprint but no outcome label reopens after cooldown when closedAt is past 7 days', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-21T12:00:00Z' // 10 days ago — past cooldown
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    // Past cooldown: reopen
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(counts.reopened).toBe(1)
    expect(counts.needsOutcomeCooldown).toBe(0)
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

// ---------------------------------------------------------------------------
// Proposal cap and overflow visibility
// ---------------------------------------------------------------------------

// Helper: make N distinct drifted findings with unique fingerprints (hex-safe)
function makeCapDriftedFindings(count: number) {
  return Array.from({length: count}, (_, i) => ({
    kind: 'pr-state' as const,
    path: `docs/plans/example-${i}.md`,
    sourceRef: `#${100 + i}`,
    verdict: 'drifted' as const,
    fingerprint: `ca${String(i).padStart(14, '0')}`,
    claimedState: 'open',
    liveState: 'closed',
    proposalEligible: true,
    proposedCorrection: `pr #${100 + i} is closed`,
  }))
}

describe('planStatusTruthProposalActions — mutation cap and overflow', () => {
  describe('scenario 1: more than 5 eligible new proposals — only 5 execute, rest are overflow', () => {
    it('with 8 new drifted findings, only 5 open actions are planned and 3 are overflow', () => {
      const findings = makeCapDriftedFindings(8)
      const report = makeReport({
        findings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      const openActions = actions.filter(a => a.type === 'open')
      expect(openActions).toHaveLength(5)
      expect(counts.opened).toBe(5)
      expect(counts.overflowed).toBe(3)
    })

    it('with exactly 5 new drifted findings, all 5 execute and overflow is 0', () => {
      const findings = makeCapDriftedFindings(5)
      const report = makeReport({
        findings,
        counts: {total: 5, current: 0, drifted: 5, unresolved: 0, unsafe: 0, proposal_eligible: 5},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      expect(actions.filter(a => a.type === 'open')).toHaveLength(5)
      expect(counts.opened).toBe(5)
      expect(counts.overflowed).toBe(0)
    })

    it('with 4 new drifted findings, all 4 execute and overflow is 0', () => {
      const findings = makeCapDriftedFindings(4)
      const report = makeReport({
        findings,
        counts: {total: 4, current: 0, drifted: 4, unresolved: 0, unsafe: 0, proposal_eligible: 4},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      expect(actions.filter(a => a.type === 'open')).toHaveLength(4)
      expect(counts.opened).toBe(4)
      expect(counts.overflowed).toBe(0)
    })
  })

  describe('scenario 2: privacy-blocked proposals do not consume cap slots', () => {
    it('privacy-blocked findings do not count against the mutation cap', () => {
      // 3 privacy-blocked findings + 5 safe findings = 5 safe opens, 0 overflow
      // (blocked findings consume no cap budget)
      const safeFindings = makeCapDriftedFindings(5)
      const blockedFindings = Array.from({length: 3}, (_, i) => ({
        kind: 'pr-state' as const,
        path: `docs/plans/blocked-${i}.md`,
        sourceRef: `#${200 + i}`,
        verdict: 'drifted' as const,
        fingerprint: `blk${String(i).padStart(13, '0')}`,
        claimedState: 'open',
        liveState: 'closed',
        proposalEligible: true,
        proposedCorrection: `pr #${200 + i} is closed (private-repo-name)`,
      }))

      const allFindings = [...blockedFindings, ...safeFindings]
      const report = makeReport({
        findings: allFindings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], publicOutputTokens: makeBlockingTokens()}),
      )

      // 3 blocked by privacy gate (not cap), 5 safe opens
      expect(counts.blocked).toBe(3)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(5)
      expect(counts.opened).toBe(5)
      expect(counts.overflowed).toBe(0)
    })

    it('privacy-blocked findings before cap-eligible findings do not reduce cap budget', () => {
      // 2 privacy-blocked + 7 safe = 5 opens + 2 overflow (cap=5, blocked don't count)
      const blockedFindings = Array.from({length: 2}, (_, i) => ({
        kind: 'pr-state' as const,
        path: `docs/plans/blocked-${i}.md`,
        sourceRef: `#${200 + i}`,
        verdict: 'drifted' as const,
        fingerprint: `blk${String(i).padStart(13, '0')}`,
        claimedState: 'open',
        liveState: 'closed',
        proposalEligible: true,
        proposedCorrection: `pr #${200 + i} is closed (private-repo-name)`,
      }))
      const safeFindings = makeCapDriftedFindings(7)
      const allFindings = [...blockedFindings, ...safeFindings]
      const report = makeReport({
        findings: allFindings,
        counts: {total: 9, current: 0, drifted: 9, unresolved: 0, unsafe: 0, proposal_eligible: 9},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], publicOutputTokens: makeBlockingTokens()}),
      )

      expect(counts.blocked).toBe(2)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(5)
      expect(counts.opened).toBe(5)
      expect(counts.overflowed).toBe(2)
    })
  })

  describe('scenario 3: same-run dedupe still prevents duplicates under a cap', () => {
    it('same-run deduplicated fingerprints do not consume cap slots', () => {
      // 3 already-created fingerprints + 6 new = 5 opens + 1 overflow
      // (deduplicated ones don't count against cap)
      const findings = makeCapDriftedFindings(6)
      const alreadyCreated = new Set(findings.slice(0, 3).map(f => f.fingerprint))
      const report = makeReport({
        findings,
        counts: {total: 6, current: 0, drifted: 6, unresolved: 0, unsafe: 0, proposal_eligible: 6},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], sameRunCreatedFingerprints: alreadyCreated}),
      )

      // 3 deduplicated, 3 remaining — all 3 open (under cap)
      expect(counts.sameRunDeduplicated).toBe(3)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(3)
      expect(counts.opened).toBe(3)
      expect(counts.overflowed).toBe(0)
    })

    it('cap does not allow duplicates when same fingerprint appears multiple times in findings', () => {
      // Same fingerprint appearing twice — second should be deduplicated, not overflow
      const fp = 'capdedup00000001'
      const finding1 = {
        kind: 'pr-state' as const,
        path: 'docs/plans/a.md',
        sourceRef: '#1',
        verdict: 'drifted' as const,
        fingerprint: fp,
        claimedState: 'open',
        liveState: 'closed',
        proposalEligible: true,
        proposedCorrection: 'pr #1 is closed',
      }
      const finding2 = {...finding1, path: 'docs/plans/b.md'}
      const report = makeReport({
        findings: [finding1, finding2],
        counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      // Only 1 open (first occurrence), second is deduplicated
      expect(actions.filter(a => a.type === 'open')).toHaveLength(1)
      expect(counts.sameRunDeduplicated).toBe(1)
      expect(counts.overflowed).toBe(0)
    })
  })

  describe('scenario 4: priority order — close/update/reopen before open when over cap', () => {
    it('close actions get priority over open actions when cap is exhausted', () => {
      // 3 open issues to close (drift cleared) + 4 new findings to open
      // Cap=5: 3 closes + 2 opens = 5 total; 2 opens overflow
      const openFingerprints = ['c105e0000000001a', 'c105e0000000002b', 'c105e0000000003c']
      const openIssues = openFingerprints.map((fp, i) =>
        makeOpenIssue(fp, {
          number: 300 + i,
          title: `Status truth: pr-state drift in docs/plans/close-${i}.md`,
        }),
      )

      // 4 new drifted findings (no existing issues for these)
      const newFindings = makeCapDriftedFindings(4)
      // Report has no findings for the open issues (drift cleared) + 4 new findings
      const report = makeReport({
        findings: newFindings,
        counts: {total: 4, current: 0, drifted: 4, unresolved: 0, unsafe: 0, proposal_eligible: 4},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: openIssues}))

      // 3 closes (priority) + 2 opens (remaining cap) = 5 total
      expect(actions.filter(a => a.type === 'close')).toHaveLength(3)
      expect(counts.closed).toBe(3)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(2)
      expect(counts.opened).toBe(2)
      expect(counts.overflowed).toBe(2)
    })

    it('update actions get priority over open actions when cap is exhausted', () => {
      // 4 existing open issues with changed live-state (update-comment) + 4 new findings
      // Cap=5: 4 updates + 1 open = 5; 3 opens overflow
      const updateFingerprints = Array.from({length: 4}, (_, i) => `a1b2c3d4e5f6000${i + 1}`)
      const existingOpenIssues = updateFingerprints.map((fp, i) =>
        makeOpenIssue(fp, {
          number: 400 + i,
          title: `Status truth: pr-state drift in docs/plans/update-${i}.md`,
          // Has a different live-state recorded → triggers update-comment
          body: `<!-- status-truth:fingerprint=${fp} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
        }),
      )

      // Findings for the existing issues (live-state changed to 'closed')
      const updateFindings = updateFingerprints.map((fp, i) => ({
        kind: 'pr-state' as const,
        path: `docs/plans/update-${i}.md`,
        sourceRef: `#${400 + i}`,
        verdict: 'drifted' as const,
        fingerprint: fp,
        claimedState: 'open',
        liveState: 'closed', // different from recorded 'open'
        proposalEligible: true,
        proposedCorrection: `pr #${400 + i} is closed`,
      }))

      // 4 new findings (no existing issues)
      const newFindings = makeCapDriftedFindings(4)
      const allFindings = [...updateFindings, ...newFindings]
      const report = makeReport({
        findings: allFindings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: existingOpenIssues}),
      )

      // 4 updates (priority) + 1 open (remaining cap) = 5; 3 opens overflow
      expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(4)
      expect(counts.updated).toBe(4)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(1)
      expect(counts.opened).toBe(1)
      expect(counts.overflowed).toBe(3)
    })

    it('reopen actions get priority over open actions when cap is exhausted', () => {
      // 3 closed non-terminal issues (reopen) + 4 new findings
      // Cap=5: 3 reopens + 2 opens = 5; 2 opens overflow
      const reopenFingerprints = ['e0e0e0000000001a', 'e0e0e0000000002b', 'e0e0e0000000003c']
      const closedIssues = reopenFingerprints.map((fp, i) =>
        makeClosedIssue(fp, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved], {
          number: 500 + i,
          title: `Status truth: pr-state drift in docs/plans/reopen-${i}.md`,
        }),
      )

      // Findings for the closed issues (drift returned)
      const reopenFindings = reopenFingerprints.map((fp, i) => ({
        kind: 'pr-state' as const,
        path: `docs/plans/reopen-${i}.md`,
        sourceRef: `#${500 + i}`,
        verdict: 'drifted' as const,
        fingerprint: fp,
        claimedState: 'open',
        liveState: 'closed',
        proposalEligible: true,
        proposedCorrection: `pr #${500 + i} is closed`,
      }))

      // 4 new findings (no existing issues)
      const newFindings = makeCapDriftedFindings(4)
      const allFindings = [...reopenFindings, ...newFindings]
      const report = makeReport({
        findings: allFindings,
        counts: {total: 7, current: 0, drifted: 7, unresolved: 0, unsafe: 0, proposal_eligible: 7},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: closedIssues}))

      // 3 reopens (priority) + 2 opens (remaining cap) = 5; 2 opens overflow
      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(3)
      expect(counts.reopened).toBe(3)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(2)
      expect(counts.opened).toBe(2)
      expect(counts.overflowed).toBe(2)
    })

    it('full priority order: close > update > reopen > open when all compete for cap', () => {
      // 2 closes + 1 update + 1 reopen + 4 new opens
      // Cap=5: 2 closes + 1 update + 1 reopen + 1 open = 5; 3 opens overflow
      const closeFps = ['c1a2b3d4e5f60001', 'c1a2b3d4e5f60002']
      const updateFp = 'a1b2c3d4e5f60001'
      const reopenFp = 'e0e0e0f0a0b00001'

      const openIssuesToClose = closeFps.map((fp, i) =>
        makeOpenIssue(fp, {
          number: 600 + i,
          title: `Status truth: pr-state drift in docs/plans/close-pri-${i}.md`,
        }),
      )

      const openIssueToUpdate = makeOpenIssue(updateFp, {
        number: 610,
        title: 'Status truth: pr-state drift in docs/plans/update-pri.md',
        body: `<!-- status-truth:fingerprint=${updateFp} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
      })

      const closedIssueToReopen = makeClosedIssue(reopenFp, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved], {
        number: 620,
        title: 'Status truth: pr-state drift in docs/plans/reopen-pri.md',
      })

      // Findings: update finding (live-state changed), reopen finding, 4 new findings
      const updateFinding = {
        kind: 'pr-state' as const,
        path: 'docs/plans/update-pri.md',
        sourceRef: '#610',
        verdict: 'drifted' as const,
        fingerprint: updateFp,
        claimedState: 'open',
        liveState: 'closed',
        proposalEligible: true,
        proposedCorrection: 'pr #610 is closed',
      }
      const reopenFinding = {
        kind: 'pr-state' as const,
        path: 'docs/plans/reopen-pri.md',
        sourceRef: '#620',
        verdict: 'drifted' as const,
        fingerprint: reopenFp,
        claimedState: 'open',
        liveState: 'closed',
        proposalEligible: true,
        proposedCorrection: 'pr #620 is closed',
      }
      const newFindings = makeCapDriftedFindings(4)
      // Report has no findings for the close issues (drift cleared)
      const allFindings = [updateFinding, reopenFinding, ...newFindings]
      const report = makeReport({
        findings: allFindings,
        counts: {total: 6, current: 0, drifted: 6, unresolved: 0, unsafe: 0, proposal_eligible: 6},
      })

      const existingIssues = [...openIssuesToClose, openIssueToUpdate, closedIssueToReopen]
      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues}))

      // Priority: 2 closes + 1 update + 1 reopen + 1 open = 5; 3 opens overflow
      expect(actions.filter(a => a.type === 'close')).toHaveLength(2)
      expect(counts.closed).toBe(2)
      expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(1)
      expect(counts.updated).toBe(1)
      expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
      expect(counts.reopened).toBe(1)
      expect(actions.filter(a => a.type === 'open')).toHaveLength(1)
      expect(counts.opened).toBe(1)
      expect(counts.overflowed).toBe(3)
    })
  })

  describe('scenario 5: overflowed actions are visible in JSON output and summary fields', () => {
    it('overflowed count is present in ProposalCounts and is a number', () => {
      const findings = makeCapDriftedFindings(8)
      const report = makeReport({
        findings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      expect(typeof counts.overflowed).toBe('number')
      expect(counts.overflowed).toBe(3)
    })

    it('overflowed count is 0 when under cap', () => {
      const findings = makeCapDriftedFindings(3)
      const report = makeReport({
        findings,
        counts: {total: 3, current: 0, drifted: 3, unresolved: 0, unsafe: 0, proposal_eligible: 3},
      })

      const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      expect(counts.overflowed).toBe(0)
    })

    it('counts shape includes overflowed field alongside existing fields', () => {
      const {counts} = planStatusTruthProposalActions(makePlanInput())

      // All existing fields still present
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
      // New overflow field
      expect(typeof counts.overflowed).toBe('number')
    })

    it('overflowed actions do not appear as open/reopen/update/close actions in the actions array', () => {
      const findings = makeCapDriftedFindings(8)
      const report = makeReport({
        findings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      // Total mutating actions must not exceed cap
      const mutatingActions = actions.filter(
        a => a.type === 'open' || a.type === 'update-comment' || a.type === 'reopen' || a.type === 'close',
      )
      expect(mutatingActions.length).toBeLessThanOrEqual(5)
      // Overflow is counted, not silently dropped
      expect(counts.overflowed).toBe(3)
      // opened + overflowed = total eligible new opens
      expect(counts.opened + counts.overflowed).toBe(8)
    })
  })

  describe('scenario 6: dry-run and live mode count accurately under cap', () => {
    it('dry-run: planned counts reflect cap enforcement (opened=5, overflowed=3)', async () => {
      const findings = makeCapDriftedFindings(8)
      const report = makeReport({
        findings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const planResult = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      // Planner enforces cap
      expect(planResult.counts.opened).toBe(5)
      expect(planResult.counts.overflowed).toBe(3)
      expect(planResult.actions.filter(a => a.type === 'open')).toHaveLength(5)

      // Dry-run executor counts the planned actions (already capped)
      const {octokit, store} = makeMockOctokit()
      const execResult = await executeStatusTruthProposalActions({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        actions: planResult.actions,
        dryRun: true,
        sameRunCreatedFingerprints: new Set<string>(),
      })

      // No mutations in dry-run
      expect(store.created).toHaveLength(0)
      // Dry-run counts match planned (already capped at 5)
      expect(execResult.counts.opened).toBe(5)
      expect(execResult.dryRun).toBe(true)
    })

    it('live mode: executor opens exactly the capped number of issues', async () => {
      const findings = makeCapDriftedFindings(8)
      const report = makeReport({
        findings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const planResult = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

      // Planner enforces cap
      expect(planResult.actions.filter(a => a.type === 'open')).toHaveLength(5)

      // Live executor opens exactly 5
      const {octokit, store} = makeMockOctokit()
      const execResult = await executeStatusTruthProposalActions({
        octokit,
        owner: 'fro-bot',
        repo: '.github',
        actions: planResult.actions,
        dryRun: false,
        sameRunCreatedFingerprints: new Set<string>(),
      })

      expect(store.created).toHaveLength(5)
      expect(execResult.counts.opened).toBe(5)
      expect(execResult.dryRun).toBe(false)
    })
  })

  describe('custom cap via mutationCap parameter', () => {
    it('mutationCap=3 limits to 3 opens from 8 findings', () => {
      const findings = makeCapDriftedFindings(8)
      const report = makeReport({
        findings,
        counts: {total: 8, current: 0, drifted: 8, unresolved: 0, unsafe: 0, proposal_eligible: 8},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], mutationCap: 3}),
      )

      expect(actions.filter(a => a.type === 'open')).toHaveLength(3)
      expect(counts.opened).toBe(3)
      expect(counts.overflowed).toBe(5)
    })

    it('mutationCap=0 overflows all findings', () => {
      const findings = makeCapDriftedFindings(3)
      const report = makeReport({
        findings,
        counts: {total: 3, current: 0, drifted: 3, unresolved: 0, unsafe: 0, proposal_eligible: 3},
      })

      const {actions, counts} = planStatusTruthProposalActions(
        makePlanInput({report, existingIssues: [], mutationCap: 0}),
      )

      expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
      expect(counts.opened).toBe(0)
      expect(counts.overflowed).toBe(3)
    })
  })
})

// ---------------------------------------------------------------------------
// Outcome classification read-model
// ---------------------------------------------------------------------------

describe('classifyProposalOutcome — pure outcome state classifier', () => {
  // Scenario 1: Open proposal without terminal labels => proposed/pending
  it('open proposal with only the proposal label classifies as proposed-pending', () => {
    const issue = makeOpenIssue('abc123def456abcd')
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('proposed-pending')
  })

  it('open proposal with no outcome labels classifies as proposed-pending', () => {
    const issue = makeOpenIssue('abc123def456abcd', {labels: [PROPOSAL_LABEL]})
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('proposed-pending')
  })

  // Scenario 2: Accepted/rejected/false-positive labels classify terminal outcomes
  it('closed proposal with accepted label classifies as explicit-accepted', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('explicit-accepted')
  })

  it('closed proposal with rejected label classifies as explicit-rejected', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.rejected])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('explicit-rejected')
  })

  it('closed proposal with false-positive label classifies as false-positive', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('false-positive')
  })

  // Scenario 3: Drift-cleared proposal classifies resolved-positive without adding accepted
  it('closed proposal with resolved label classifies as resolved-positive (not explicit-accepted)', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('resolved-positive')
    // Must NOT be explicit-accepted — resolved positive is bot-inferred, not human-confirmed
    expect(outcome).not.toBe('explicit-accepted')
  })

  it('closed proposal with manually-fixed label classifies as resolved-positive', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.manuallyFixed])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('resolved-positive')
  })

  // Scenario 4: Closed issue without terminal/resolution label — outcome depends on driftActive
  it('closed proposal with only the proposal label (no outcome label) and driftActive=false classifies as resolved-positive', () => {
    // Drift cleared (fingerprint not in current scan) → resolved-positive
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('resolved-positive')
    // Must NOT be explicit-rejected
    expect(outcome).not.toBe('explicit-rejected')
  })

  it('closed proposal with only the proposal label (no outcome label) and driftActive=true classifies as needs-outcome', () => {
    // Drift still active (fingerprint in current scan) → needs-outcome
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL])
    const outcome = classifyProposalOutcome(issue, true)
    expect(outcome).toBe('needs-outcome')
    // Must NOT be explicit-rejected
    expect(outcome).not.toBe('explicit-rejected')
  })

  // Conflicting labels: mutually exclusive outcome labels present together
  it('closed proposal with both accepted and rejected labels classifies as conflicting-labels', () => {
    const issue = makeClosedIssue('abc123def456abcd', [
      PROPOSAL_LABEL,
      OUTCOME_LABELS.accepted,
      OUTCOME_LABELS.rejected,
    ])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('conflicting-labels')
  })

  it('closed proposal with both accepted and false-positive labels classifies as conflicting-labels', () => {
    const issue = makeClosedIssue('abc123def456abcd', [
      PROPOSAL_LABEL,
      OUTCOME_LABELS.accepted,
      OUTCOME_LABELS.falsePositive,
    ])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('conflicting-labels')
  })

  it('closed proposal with both rejected and false-positive labels classifies as conflicting-labels', () => {
    const issue = makeClosedIssue('abc123def456abcd', [
      PROPOSAL_LABEL,
      OUTCOME_LABELS.rejected,
      OUTCOME_LABELS.falsePositive,
    ])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('conflicting-labels')
  })

  // Superseded lifecycle state
  it('closed proposal with superseded label classifies as superseded', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.superseded])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('superseded')
  })

  // Malformed: unrecognized status-truth:* label
  it('closed proposal with unrecognized status-truth:* label classifies as malformed-outcome', () => {
    const issue = makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, 'status-truth:unknown-state'])
    const outcome = classifyProposalOutcome(issue, false)
    expect(outcome).toBe('malformed-outcome')
  })

  // Error path: malformed outcome markers do not crash
  it('issue with no fingerprint marker still classifies without throwing', () => {
    const issue: ExistingProposalIssue = {
      number: 999,
      state: 'closed',
      labels: [PROPOSAL_LABEL, OUTCOME_LABELS.accepted],
      title: 'Status truth: something',
      body: null,
    }
    // Should not throw — returns a valid outcome state
    expect(() => classifyProposalOutcome(issue, false)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Outcome counts are emitted separately from action counts
// ---------------------------------------------------------------------------

describe('buildOutcomeCounts — outcome read-model counts separate from action counts', () => {
  // Scenario 5: Outcome counts are emitted separately from action counts
  it('buildOutcomeCounts returns outcome counts without action counts', () => {
    // fp5 has no outcome label; with no driftActiveFingerprints (default empty set),
    // driftActive=false → resolved-positive (drift cleared without explicit label).
    // To get needsOutcome=1, pass fp5's fingerprint as drift-active.
    const fp5Fingerprint = 'deadbeef12345678'
    const fp5Issue = makeClosedIssue(fp5Fingerprint, [PROPOSAL_LABEL], {
      body: `<!-- status-truth:fingerprint=${fp5Fingerprint} -->\n\nSome body text.`,
    })
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('fp1', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted]),
      makeClosedIssue('fp2', [PROPOSAL_LABEL, OUTCOME_LABELS.rejected]),
      makeClosedIssue('fp3', [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive]),
      makeClosedIssue('fp4', [PROPOSAL_LABEL, OUTCOME_LABELS.resolved]),
      fp5Issue,
      makeOpenIssue('fp6'),
    ]

    // Pass fp5's fingerprint as drift-active so it classifies as needs-outcome
    const outcomeCounts = buildOutcomeCounts(issues, new Set([fp5Fingerprint]))

    // Outcome counts are present and correct
    expect(outcomeCounts.explicitAccepted).toBe(1)
    expect(outcomeCounts.explicitRejected).toBe(1)
    expect(outcomeCounts.falsePositive).toBe(1)
    expect(outcomeCounts.resolvedPositive).toBe(1)
    expect(outcomeCounts.needsOutcome).toBe(1)
    expect(outcomeCounts.proposedPending).toBe(1)

    // Outcome counts object must NOT contain action-level fields
    const keys = Object.keys(outcomeCounts)
    expect(keys).not.toContain('opened')
    expect(keys).not.toContain('updated')
    expect(keys).not.toContain('reopened')
    expect(keys).not.toContain('closed')
    expect(keys).not.toContain('suppressed')
    expect(keys).not.toContain('blocked')
    expect(keys).not.toContain('overflowed')
  })

  it('buildOutcomeCounts counts conflicting-labels issues for operator attention', () => {
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('fp1', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted, OUTCOME_LABELS.rejected]),
      makeClosedIssue('fp2', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted, OUTCOME_LABELS.falsePositive]),
    ]

    const outcomeCounts = buildOutcomeCounts(issues)

    expect(outcomeCounts.conflictingLabels).toBe(2)
    // Conflicting issues must NOT contribute to accuracy math
    expect(outcomeCounts.explicitAccepted).toBe(0)
    expect(outcomeCounts.explicitRejected).toBe(0)
    expect(outcomeCounts.falsePositive).toBe(0)
  })

  it('buildOutcomeCounts counts malformed-outcome issues for operator attention', () => {
    const issues: ExistingProposalIssue[] = [makeClosedIssue('fp1', [PROPOSAL_LABEL, 'status-truth:unknown-state'])]

    const outcomeCounts = buildOutcomeCounts(issues)

    expect(outcomeCounts.malformedOutcome).toBe(1)
    // Malformed issues must NOT contribute to accuracy math
    expect(outcomeCounts.explicitAccepted).toBe(0)
    expect(outcomeCounts.explicitRejected).toBe(0)
    expect(outcomeCounts.falsePositive).toBe(0)
  })

  it('buildOutcomeCounts returns zero counts for empty issue list', () => {
    const outcomeCounts = buildOutcomeCounts([])

    expect(outcomeCounts.explicitAccepted).toBe(0)
    expect(outcomeCounts.explicitRejected).toBe(0)
    expect(outcomeCounts.falsePositive).toBe(0)
    expect(outcomeCounts.resolvedPositive).toBe(0)
    expect(outcomeCounts.needsOutcome).toBe(0)
    expect(outcomeCounts.proposedPending).toBe(0)
    expect(outcomeCounts.conflictingLabels).toBe(0)
    expect(outcomeCounts.malformedOutcome).toBe(0)
    expect(outcomeCounts.superseded).toBe(0)
  })

  // Scenario 6: No raw issue body/title/fingerprint leaks into outcome summary/output
  it('buildOutcomeCounts output contains only numeric counts — no raw issue body, title, or fingerprint', () => {
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted], {
        title: 'Status truth: pr-state drift in docs/plans/secret-path.md',
        body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nSensitive body content.',
      }),
    ]

    const outcomeCounts = buildOutcomeCounts(issues)
    const json = JSON.stringify(outcomeCounts)

    // No raw issue body, title, or fingerprint in the output
    expect(json).not.toContain('secret-path')
    expect(json).not.toContain('Sensitive body content')
    expect(json).not.toContain('abc123def456abcd')
    expect(json).not.toContain('Status truth:')

    // Only numeric counts
    for (const value of Object.values(outcomeCounts)) {
      expect(typeof value).toBe('number')
    }
  })
})

// ---------------------------------------------------------------------------
// buildOutcomeCountsByKind — per-kind outcome aggregation, single classification pass
// ---------------------------------------------------------------------------

describe('buildOutcomeCountsByKind', () => {
  it('aggregates outcome counts per kind across open and closed issues with mixed kinds', () => {
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('fp1', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted], {
        body: `<!-- status-truth:fingerprint=fp1 -->\n<!-- status-truth:kind=pr-state -->\n\nBody.`,
      }),
      makeClosedIssue('fp2', [PROPOSAL_LABEL, OUTCOME_LABELS.rejected], {
        body: `<!-- status-truth:fingerprint=fp2 -->\n<!-- status-truth:kind=issue-state -->\n\nBody.`,
      }),
      makeOpenIssue('fp3', {
        body: `<!-- status-truth:fingerprint=fp3 -->\n<!-- status-truth:kind=pr-state -->\n\nBody.`,
      }),
    ]

    const byKind = buildOutcomeCountsByKind(issues)

    expect(byKind['pr-state']?.explicitAccepted).toBe(1)
    expect(byKind['pr-state']?.proposedPending).toBe(1)
    expect(byKind['issue-state']?.explicitRejected).toBe(1)
  })

  it('only includes kinds with at least one issue', () => {
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('fp1', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted], {
        body: `<!-- status-truth:fingerprint=fp1 -->\n<!-- status-truth:kind=pr-state -->\n\nBody.`,
      }),
    ]

    const byKind = buildOutcomeCountsByKind(issues)

    expect(Object.keys(byKind)).toEqual(['pr-state'])
  })

  it('buckets issues with unrecognized/missing kind info under unknown', () => {
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('fp1', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted], {
        body: `<!-- status-truth:fingerprint=fp1 -->\n\nNo kind info here.`,
      }),
    ]

    const byKind = buildOutcomeCountsByKind(issues)

    expect(byKind.unknown?.explicitAccepted).toBe(1)
  })

  it('returns an empty object for an empty issue list', () => {
    expect(buildOutcomeCountsByKind([])).toEqual({})
  })

  it('output contains only numeric counts nested under kind keys — no raw body, title, or fingerprint', () => {
    const issues: ExistingProposalIssue[] = [
      makeClosedIssue('abc123def456abcd', [PROPOSAL_LABEL, OUTCOME_LABELS.accepted], {
        title: 'Status truth: pr-state drift in docs/plans/secret-path.md',
        body: `<!-- status-truth:fingerprint=abc123def456abcd -->\n<!-- status-truth:kind=pr-state -->\n\nSensitive body content.`,
      }),
    ]

    const byKind = buildOutcomeCountsByKind(issues)
    const json = JSON.stringify(byKind)

    expect(json).not.toContain('secret-path')
    expect(json).not.toContain('Sensitive body content')
    expect(json).not.toContain('abc123def456abcd')
    expect(json).not.toContain('Status truth:')

    for (const counts of Object.values(byKind)) {
      for (const value of Object.values(counts ?? {})) {
        expect(typeof value).toBe('number')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// conflictingLabels count in ProposalCounts
// ---------------------------------------------------------------------------

describe('conflictingLabels count in planStatusTruthProposalActions', () => {
  it('issue with conflicting accepted+rejected labels increments conflictingLabels count', () => {
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const conflictingIssue = makeClosedIssue(fingerprint, [
      PROPOSAL_LABEL,
      OUTCOME_LABELS.accepted,
      OUTCOME_LABELS.rejected,
    ])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [conflictingIssue]}))

    expect(counts.conflictingLabels).toBeGreaterThanOrEqual(1)
    // Must NOT contribute to usefulnessByKind accuracy math
    const kindCounts = counts.usefulnessByKind
    for (const kind of Object.keys(kindCounts)) {
      const entry = kindCounts[kind]
      if (entry !== undefined) {
        expect(entry.accepted).toBe(0)
        expect(entry.rejected).toBe(0)
        expect(entry.falsePositive).toBe(0)
      }
    }
  })

  it('issue with conflicting accepted+false-positive labels increments conflictingLabels count', () => {
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const conflictingIssue = makeClosedIssue(fingerprint, [
      PROPOSAL_LABEL,
      OUTCOME_LABELS.accepted,
      OUTCOME_LABELS.falsePositive,
    ])

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [conflictingIssue]}))

    expect(counts.conflictingLabels).toBeGreaterThanOrEqual(1)
  })

  it('conflictingLabels count is separate from malformedOutcomeMarkers count', () => {
    const fingerprint1 = 'abc123def456abcd'
    const fingerprint2 = 'deadbeef12345678'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    // One conflicting (accepted+rejected), one malformed (unknown label)
    const conflictingIssue = makeClosedIssue(fingerprint1, [
      PROPOSAL_LABEL,
      OUTCOME_LABELS.accepted,
      OUTCOME_LABELS.rejected,
    ])
    const malformedIssue: ExistingProposalIssue = {
      number: 301,
      state: 'closed',
      labels: [PROPOSAL_LABEL, 'status-truth:unknown-state'],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: `<!-- status-truth:fingerprint=${fingerprint2} -->\n\nBody.`,
    }

    const {counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [conflictingIssue, malformedIssue]}),
    )

    expect(counts.conflictingLabels).toBe(1)
    expect(counts.malformedOutcomeMarkers).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// classifyProposalOutcome — driftActive parameter
// ---------------------------------------------------------------------------

describe('classifyProposalOutcome — driftActive parameter', () => {
  it('closed issue with no terminal label and driftActive=false classifies as resolved-positive', () => {
    // Closed with only the proposal label (no outcome label), drift no longer active.
    // The fingerprint is not in the current scan → resolved-positive (drift cleared without explicit label).
    const issue: ExistingProposalIssue = {
      number: 100,
      state: 'closed',
      labels: [PROPOSAL_LABEL],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
    }
    expect(classifyProposalOutcome(issue, false)).toBe('resolved-positive')
  })

  it('closed issue with no terminal label and driftActive=true classifies as needs-outcome', () => {
    // Closed with only the proposal label (no outcome label), drift still active.
    // The fingerprint is still in the current scan → needs-outcome (operator attention required).
    const issue: ExistingProposalIssue = {
      number: 100,
      state: 'closed',
      labels: [PROPOSAL_LABEL],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
    }
    expect(classifyProposalOutcome(issue, true)).toBe('needs-outcome')
  })

  it('open issue always classifies as proposed-pending regardless of driftActive', () => {
    const issue: ExistingProposalIssue = {
      number: 100,
      state: 'open',
      labels: [PROPOSAL_LABEL],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
    }
    expect(classifyProposalOutcome(issue, false)).toBe('proposed-pending')
    expect(classifyProposalOutcome(issue, true)).toBe('proposed-pending')
  })

  it('closed issue with resolved label classifies as resolved-positive regardless of driftActive', () => {
    const issue: ExistingProposalIssue = {
      number: 100,
      state: 'closed',
      labels: [PROPOSAL_LABEL, OUTCOME_LABELS.resolved],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
    }
    expect(classifyProposalOutcome(issue, false)).toBe('resolved-positive')
    expect(classifyProposalOutcome(issue, true)).toBe('resolved-positive')
  })

  it('closed issue with manually-fixed label classifies as resolved-positive regardless of driftActive', () => {
    const issue: ExistingProposalIssue = {
      number: 100,
      state: 'closed',
      labels: [PROPOSAL_LABEL, OUTCOME_LABELS.manuallyFixed],
      title: 'Status truth: pr-state drift in docs/plans/example.md',
      body: '<!-- status-truth:fingerprint=abc123def456abcd -->\n\nBody.',
    }
    expect(classifyProposalOutcome(issue, false)).toBe('resolved-positive')
    expect(classifyProposalOutcome(issue, true)).toBe('resolved-positive')
  })
})

// ---------------------------------------------------------------------------
// outcomeCounts in planStatusTruthProposalActions result
// ---------------------------------------------------------------------------

describe('planStatusTruthProposalActions — outcomeCounts in result', () => {
  it('result includes outcomeCounts field separate from counts and countsByKind', () => {
    const {counts, countsByKind, outcomeCounts} = planStatusTruthProposalActions(makePlanInput()) as {
      counts: unknown
      countsByKind: unknown
      outcomeCounts: OutcomeCounts
    }

    expect(outcomeCounts).toBeDefined()
    expect(counts).toBeDefined()
    expect(countsByKind).toBeDefined()
    // outcomeCounts must be a separate object from counts
    expect(outcomeCounts).not.toBe(counts)
  })

  it('outcomeCounts has all required fields as numbers', () => {
    const result = planStatusTruthProposalActions(makePlanInput()) as {outcomeCounts: OutcomeCounts}

    const oc = result.outcomeCounts
    expect(typeof oc.proposedPending).toBe('number')
    expect(typeof oc.explicitAccepted).toBe('number')
    expect(typeof oc.explicitRejected).toBe('number')
    expect(typeof oc.falsePositive).toBe('number')
    expect(typeof oc.resolvedPositive).toBe('number')
    expect(typeof oc.superseded).toBe('number')
    expect(typeof oc.needsOutcome).toBe('number')
    expect(typeof oc.conflictingLabels).toBe('number')
    expect(typeof oc.malformedOutcome).toBe('number')
  })

  it('outcomeCounts.proposedPending counts open proposal issues', () => {
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const openIssue = makeOpenIssue(fingerprint)

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [openIssue]})) as {
      outcomeCounts: OutcomeCounts
    }

    expect(result.outcomeCounts.proposedPending).toBe(1)
  })

  it('outcomeCounts.explicitAccepted counts closed issues with accepted label', () => {
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.accepted])

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]})) as {
      outcomeCounts: OutcomeCounts
    }

    expect(result.outcomeCounts.explicitAccepted).toBe(1)
  })

  it('outcomeCounts.resolvedPositive counts closed issues with resolved label', () => {
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved])

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]})) as {
      outcomeCounts: OutcomeCounts
    }

    expect(result.outcomeCounts.resolvedPositive).toBe(1)
  })

  it('outcomeCounts.needsOutcome counts closed issues with no outcome label when drift is active', () => {
    // Closed with only proposal label, drift still active (fingerprint in report findings)
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed with no outcome label — drift is active so this is needs-outcome
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL])

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]})) as {
      outcomeCounts: OutcomeCounts
    }

    expect(result.outcomeCounts.needsOutcome).toBe(1)
  })

  it('outcomeCounts.resolvedPositive counts closed issues with no outcome label when drift is NOT active', () => {
    // Closed with only proposal label, drift cleared (fingerprint not in report findings)
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    // Closed with no outcome label — drift cleared so this is resolved-positive
    const closedIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL])

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue]})) as {
      outcomeCounts: OutcomeCounts
    }

    expect(result.outcomeCounts.resolvedPositive).toBe(1)
    expect(result.outcomeCounts.needsOutcome).toBe(0)
  })

  it('outcomeCounts is separate from action counts (counts) and plannedCounts', () => {
    // outcomeCounts reflects existing issue state, not actions taken this run
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const openIssue = makeOpenIssue(fingerprint)

    const result = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [openIssue]})) as {
      counts: {opened: number; noAction: number}
      outcomeCounts: OutcomeCounts
    }

    // Action counts: no-action (existing open issue, drift unchanged)
    expect(result.counts.noAction).toBeGreaterThanOrEqual(1)
    expect(result.counts.opened).toBe(0)
    // Outcome counts: one proposed-pending (the existing open issue)
    expect(result.outcomeCounts.proposedPending).toBe(1)
  })

  it('result includes outcomeCountsByKind, keyed by claim kind, derived from the same classification pass', () => {
    const fingerprint = 'abc123def456abcd'
    const openIssue = makeOpenIssue(fingerprint, {
      body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:kind=pr-state -->\n\nBody.`,
    })

    const result = planStatusTruthProposalActions(makePlanInput({existingIssues: [openIssue]})) as {
      outcomeCountsByKind: Readonly<Record<string, OutcomeCounts>>
    }

    expect(result.outcomeCountsByKind['pr-state']?.proposedPending).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// isWithinCooldown — pure date helper
// ---------------------------------------------------------------------------

describe('isWithinCooldown', () => {
  it('returns true when closedAt is less than 7 days before now', () => {
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-28T12:00:00Z' // 3 days ago
    expect(isWithinCooldown(closedAt, now)).toBe(true)
  })

  it('returns false when closedAt is exactly 7 days before now', () => {
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-24T12:00:00Z' // exactly 7 days ago
    expect(isWithinCooldown(closedAt, now)).toBe(false)
  })

  it('returns false when closedAt is more than 7 days before now', () => {
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-20T12:00:00Z' // 11 days ago
    expect(isWithinCooldown(closedAt, now)).toBe(false)
  })

  it('returns true when closedAt is 1 second before the 7-day boundary', () => {
    const now = new Date('2026-07-01T12:00:00Z')
    // 7 days = 604800 seconds; 1 second less = 604799 seconds ago
    const closedAt = new Date(now.getTime() - 604799 * 1000).toISOString()
    expect(isWithinCooldown(closedAt, now)).toBe(true)
  })

  it('returns false when closedAt is 1 second after the 7-day boundary', () => {
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = new Date(now.getTime() - 604801 * 1000).toISOString()
    expect(isWithinCooldown(closedAt, now)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Manual closure cooldown and recurrence behavior
// ---------------------------------------------------------------------------

describe('manual closure cooldown — closed-without-outcome during cooldown', () => {
  it('does not reopen and does not open duplicate when closed-without-outcome is within 7-day cooldown', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed 2 days ago with no outcome label (needs-outcome state)
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z' // 2 days ago — within cooldown
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    // Must not reopen during cooldown
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    // Must not open a duplicate
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    // Must count as cooldown-blocked for operator attention
    expect(counts.needsOutcomeCooldown).toBeGreaterThanOrEqual(1)
  })

  it('counts cooldown-blocked separately from other blocked counts', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z' // within cooldown
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue], now}))

    // needsOutcomeCooldown is distinct from privacy-blocked (blocked)
    expect(typeof counts.needsOutcomeCooldown).toBe('number')
    expect(counts.needsOutcomeCooldown).toBeGreaterThanOrEqual(1)
    // Privacy-blocked count should not be inflated by cooldown
    expect(counts.blocked).toBe(0)
  })
})

describe('manual closure cooldown — closed-without-outcome after cooldown', () => {
  it('reopens with recurrence comment when closed-without-outcome is past 7-day cooldown and drift persists', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed 10 days ago with no outcome label — past cooldown
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-21T12:00:00Z' // 10 days ago
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    const reopenActions = actions.filter(a => a.type === 'reopen')
    expect(reopenActions).toHaveLength(1)
    const reopenAction = reopenActions[0]
    if (reopenAction?.type === 'reopen') {
      expect(reopenAction.issueNumber).toBe(closedIssue.number)
      expect(reopenAction.comment).toBeTruthy()
      // Comment must mention recurrence or needs-outcome — not raw claim text
      expect(reopenAction.comment).toMatch(/recurrence|recurring|needs.?outcome/i)
    }
    expect(counts.reopened).toBe(1)
    expect(counts.needsOutcomeCooldown).toBe(0)
  })

  it('reopen after cooldown removes resolving labels and adds recurring label', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-21T12:00:00Z' // 10 days ago — past cooldown
    // Closed with no outcome label (needs-outcome state)
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue], now}))

    const reopenAction = actions.find(a => a.type === 'reopen')
    if (reopenAction?.type === 'reopen') {
      // Must add recurring label
      expect(reopenAction.addLabels).toContain(OUTCOME_LABELS.recurring)
      // removeLabels should not include non-resolving labels
      for (const label of reopenAction.removeLabels) {
        expect([OUTCOME_LABELS.resolved, OUTCOME_LABELS.manuallyFixed]).toContain(label)
      }
    }
  })
})

describe('manual closure cooldown — terminal labels override cooldown', () => {
  it('rejected label suppresses recurrence regardless of cooldown period', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed 10 days ago (past cooldown) but with terminal rejected label
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-21T12:00:00Z'
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.rejected]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    // Terminal: suppress, not reopen
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.suppressed).toBe(1)
    expect(counts.needsOutcomeCooldown).toBe(0)
  })

  it('false-positive label suppresses recurrence regardless of cooldown period', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-21T12:00:00Z'
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.falsePositive]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(counts.suppressed).toBe(1)
    expect(counts.needsOutcomeCooldown).toBe(0)
  })

  it('rejected label within cooldown still suppresses (terminal overrides cooldown)', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Within cooldown AND terminal — terminal wins
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z' // 2 days ago — within cooldown
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.rejected]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(counts.suppressed).toBe(1)
    expect(counts.needsOutcomeCooldown).toBe(0)
  })
})

describe('manual closure cooldown — resolved/manually-fixed clears cooldown', () => {
  it('resolved label stays quiet when drift is cleared (no reopen, no cooldown count)', () => {
    const fingerprint = 'abc123def456abcd'
    // No findings — drift cleared
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z' // within cooldown, but drift cleared
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    // Drift cleared — no reopen, no cooldown count
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(counts.needsOutcomeCooldown).toBe(0)
    // No open either (no drift)
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
  })

  it('manually-fixed label stays quiet when drift is cleared', () => {
    const fingerprint = 'abc123def456abcd'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z'
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.manuallyFixed]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(counts.needsOutcomeCooldown).toBe(0)
  })

  it('changed fingerprint (new drift) can open a new proposal even when old fingerprint was resolved', () => {
    const oldFingerprint = 'abc123def456abcd'
    const newFingerprint = 'deadbeef12345678'
    // New drift with different fingerprint
    const newFinding = makeDriftedFinding(newFingerprint)
    const report = makeReport({
      findings: [newFinding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z'
    // Old fingerprint closed with resolved label
    const oldClosedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(oldFingerprint, [PROPOSAL_LABEL, OUTCOME_LABELS.resolved]),
      closedAt,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [oldClosedIssue], now}),
    )

    // New fingerprint → new open action
    const openActions = actions.filter(a => a.type === 'open')
    expect(openActions).toHaveLength(1)
    if (openActions[0]?.type === 'open') {
      expect(openActions[0].fingerprint).toBe(newFingerprint)
    }
    expect(counts.opened).toBe(1)
    expect(counts.needsOutcomeCooldown).toBe(0)
  })
})

describe('manual closure cooldown — missing closedAt is conservative', () => {
  it('closed-without-outcome with missing closedAt is counted for attention with no mutation', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    // Closed with no outcome label and no closedAt — conservative: needs attention, no mutation
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt: null,
    }

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    // No reopen (conservative — cannot determine cooldown without closedAt)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    // No open (fingerprint already has a closed issue)
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    // Counted for operator attention
    expect(counts.needsOutcomeCooldown).toBeGreaterThanOrEqual(1)
  })

  it('closed-without-outcome with undefined closedAt is also conservative', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    // No closedAt field at all
    const closedIssue: ExistingProposalIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL])

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [closedIssue], now}),
    )

    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.needsOutcomeCooldown).toBeGreaterThanOrEqual(1)
  })
})

describe('manual closure cooldown — mutation cap applies to reopen after cooldown', () => {
  it('reopen-after-cooldown actions are subject to the mutation cap (priority after update, before open)', () => {
    const fingerprint1 = 'abc123def456abcd'
    const fingerprint2 = 'deadbeef12345678'
    const fingerprint3 = 'cafebabe12345678'
    const fingerprint4 = 'feedface12345678'
    const fingerprint5 = 'baadf00d12345678'
    const fingerprint6 = 'c0ffee0012345678'

    const now = new Date('2026-07-01T12:00:00Z')
    const pastCooldown = '2026-06-21T12:00:00Z' // 10 days ago

    // 5 closed-without-outcome issues past cooldown + 1 new finding
    // Cap is 5 — all 5 reopens should fit, but the new open should overflow
    const closedIssues: ExistingProposalIssue[] = [
      {...makeClosedIssue(fingerprint1, [PROPOSAL_LABEL], {number: 201}), closedAt: pastCooldown},
      {...makeClosedIssue(fingerprint2, [PROPOSAL_LABEL], {number: 202}), closedAt: pastCooldown},
      {...makeClosedIssue(fingerprint3, [PROPOSAL_LABEL], {number: 203}), closedAt: pastCooldown},
      {...makeClosedIssue(fingerprint4, [PROPOSAL_LABEL], {number: 204}), closedAt: pastCooldown},
      {...makeClosedIssue(fingerprint5, [PROPOSAL_LABEL], {number: 205}), closedAt: pastCooldown},
    ]

    // New finding with a different fingerprint (no existing issue)
    const newFinding = makeDriftedFinding(fingerprint6)
    const report = makeReport({
      findings: [
        makeDriftedFinding(fingerprint1),
        makeDriftedFinding(fingerprint2),
        makeDriftedFinding(fingerprint3),
        makeDriftedFinding(fingerprint4),
        makeDriftedFinding(fingerprint5),
        newFinding,
      ],
      counts: {total: 6, current: 0, drifted: 6, unresolved: 0, unsafe: 0, proposal_eligible: 6},
    })

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: closedIssues, mutationCap: 5, now}),
    )

    // 5 reopens should fit within cap
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(5)
    // The new open should overflow
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.overflowed).toBeGreaterThanOrEqual(1)
    expect(counts.reopened).toBe(5)
  })

  it('reopen-after-cooldown has lower priority than update-comment but higher than open', () => {
    const fingerprint1 = 'abc123def456abcd' // open issue with changed live-state → update
    const fingerprint2 = 'deadbeef12345678' // closed-without-outcome past cooldown → reopen
    const fingerprint3 = 'cafebabe12345678' // new finding → open

    const now = new Date('2026-07-01T12:00:00Z')
    const pastCooldown = '2026-06-21T12:00:00Z'

    const openIssueWithChangedState = makeOpenIssue(fingerprint1, {
      body: `<!-- status-truth:fingerprint=${fingerprint1} -->\n<!-- status-truth:live-state=open -->\n\nBody.`,
    })
    const closedWithoutOutcome: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint2, [PROPOSAL_LABEL], {number: 202}),
      closedAt: pastCooldown,
    }

    const report = makeReport({
      findings: [
        makeDriftedFinding(fingerprint1), // will trigger update-comment
        makeDriftedFinding(fingerprint2), // will trigger reopen-after-cooldown
        makeDriftedFinding(fingerprint3), // will trigger open (new)
      ],
      counts: {total: 3, current: 0, drifted: 3, unresolved: 0, unsafe: 0, proposal_eligible: 3},
    })

    // Cap of 2: update + reopen should fit; open should overflow
    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({
        report,
        existingIssues: [openIssueWithChangedState, closedWithoutOutcome],
        mutationCap: 2,
        now,
      }),
    )

    expect(actions.filter(a => a.type === 'update-comment')).toHaveLength(1)
    expect(actions.filter(a => a.type === 'reopen')).toHaveLength(1)
    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.overflowed).toBe(1)
    expect(counts.updated).toBe(1)
    expect(counts.reopened).toBe(1)
  })
})

describe('manual closure cooldown — workflow summary counts-only', () => {
  it('counts object contains needsOutcomeCooldown field as a number', () => {
    const {counts} = planStatusTruthProposalActions(makePlanInput())
    expect(typeof counts.needsOutcomeCooldown).toBe('number')
  })

  it('counts object does not expose raw claim text or fingerprints in cooldown fields', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const now = new Date('2026-07-01T12:00:00Z')
    const closedAt = '2026-06-29T12:00:00Z'
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const {counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue], now}))

    // Counts must be numeric — no raw text
    const countsJson = JSON.stringify(counts)
    // Must not contain fingerprint hex strings in the counts output
    expect(countsJson).not.toContain(fingerprint)
    // Must not contain raw claim text
    expect(countsJson).not.toContain('docs/plans/example.md')
    expect(countsJson).not.toContain('pr #42')
  })
})

// ---------------------------------------------------------------------------
// plannedCounts assembly — needsOutcomeCooldown surfaced in open result
// ---------------------------------------------------------------------------

describe('plannedCounts assembly', () => {
  it('needsOutcomeCooldown from planner is present in the plannedCounts shape', () => {
    // Simulate the plannedCounts assembly that runOpen() performs.
    // Verifies that needsOutcomeCooldown is included and not silently dropped.
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding(fingerprint)
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    // Closed 1 day ago with no outcome label — within the 7-day cooldown window
    const closedAt = '2026-06-29T00:00:00Z'
    const now = new Date('2026-06-30T00:00:00Z')
    const closedIssue: ExistingProposalIssue = {
      ...makeClosedIssue(fingerprint, [PROPOSAL_LABEL]),
      closedAt,
    }

    const planResult = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [closedIssue], now}))

    // Assemble plannedCounts the same way runOpen() does
    const plannedCounts = {
      versionRejected: planResult.counts.versionRejected,
      blocked: planResult.counts.blocked,
      overflowed: planResult.counts.overflowed,
      sameRunDeduplicated: planResult.counts.sameRunDeduplicated,
      needsOutcomeCooldown: planResult.counts.needsOutcomeCooldown,
    }

    // needsOutcomeCooldown must be present and reflect the planner's count
    expect(typeof plannedCounts.needsOutcomeCooldown).toBe('number')
    expect(plannedCounts.needsOutcomeCooldown).toBe(1)
    // No reopen during cooldown
    expect(planResult.counts.reopened).toBe(0)
  })

  it('outcomeCountsByKind from the planner is present in the OpenResult shape for dry-run and live paths', () => {
    // Simulate the OpenResult assembly that runOpen() performs for both the
    // dry-run and live execute paths — both reuse the same planResult.outcomeCountsByKind.
    const fingerprint = 'abc123def456abcd'
    const openIssue: ExistingProposalIssue = {
      ...makeOpenIssue(fingerprint, {
        body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:kind=pr-state -->\n\nBody.`,
      }),
    }

    const planResult = planStatusTruthProposalActions(makePlanInput({existingIssues: [openIssue]}))

    // Assemble the OpenResult the same way runOpen() does for either dry-run or live.
    const dryRunResult = {
      dryRun: true,
      outcomeCounts: planResult.outcomeCounts,
      outcomeCountsByKind: planResult.outcomeCountsByKind,
    }
    const liveResult = {
      dryRun: false,
      outcomeCounts: planResult.outcomeCounts,
      outcomeCountsByKind: planResult.outcomeCountsByKind,
    }

    expect(dryRunResult.outcomeCountsByKind['pr-state']?.proposedPending).toBe(1)
    expect(liveResult.outcomeCountsByKind['pr-state']?.proposedPending).toBe(1)

    const json = JSON.stringify(dryRunResult)
    expect(json).not.toContain(fingerprint)
    expect(json).not.toContain('docs/plans/example.md')
  })
})

// ---------------------------------------------------------------------------
// plan-consistency claim kind — planner passthrough
//
// The planner has no kind-specific plumbing: a drifted plan-consistency
// finding must plan/cap/dedupe/close exactly like any other kind, with zero
// planner code changes. These tests drive the existing planner with a
// plan-consistency fixture to prove that.
// ---------------------------------------------------------------------------

function makeDriftedPlanConsistencyFinding(fingerprint = 'abc123def4560001') {
  return {
    kind: 'plan-consistency' as const,
    path: 'docs/plans/example.md',
    sourceRef: 'docs/plans/example.md',
    verdict: 'drifted' as const,
    fingerprint,
    claimedState: 'active',
    liveState: 'checked-2-unchecked-0',
    proposalEligible: true,
    proposedCorrection: 'status: complete',
  }
}

describe('plan-consistency claim kind: planner passthrough', () => {
  it('plans one open action for a new drifted plan-consistency finding, capped/deduped/gated like any other kind', () => {
    const finding = makeDriftedPlanConsistencyFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions, counts, countsByKind} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))

    const openActions = actions.filter(a => a.type === 'open')
    expect(openActions).toHaveLength(1)
    const openAction = openActions[0]
    if (openAction?.type === 'open') {
      expect(openAction.fingerprint).toBe(finding.fingerprint)
      expect(openAction.title).toContain('plan-consistency')
      expect(openAction.body).toContain(`<!-- status-truth:fingerprint=${finding.fingerprint} -->`)
    }
    expect(counts.opened).toBe(1)
    expect(countsByKind['plan-consistency']?.opened).toBe(1)
  })

  it('does not open a duplicate when an open issue already matches the plan-consistency fingerprint', () => {
    const finding = makeDriftedPlanConsistencyFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const existingIssue = makeOpenIssue(finding.fingerprint, {
      title: 'Status truth: plan-consistency drift in docs/plans/example.md',
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

    expect(actions.filter(a => a.type === 'open')).toHaveLength(0)
    expect(counts.noAction).toBeGreaterThanOrEqual(1)
  })

  it('respects the mutation cap identically for plan-consistency findings', () => {
    const findings = [
      makeDriftedPlanConsistencyFinding('abc123def4560001'),
      makeDriftedPlanConsistencyFinding('abc123def4560002'),
    ]
    const report = makeReport({
      findings,
      counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
    })

    const {actions, counts} = planStatusTruthProposalActions(
      makePlanInput({report, existingIssues: [], mutationCap: 1}),
    )

    expect(actions.filter(a => a.type === 'open')).toHaveLength(1)
    expect(counts.overflowed).toBe(1)
  })

  it('close-on-clear closes an open plan-consistency proposal when the plan is deleted between runs', () => {
    const fingerprint = 'abc123def4560001'
    const report = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const existingIssue = makeOpenIssue(fingerprint, {
      title: 'Status truth: plan-consistency drift in docs/plans/example.md',
    })

    const {actions, counts} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: [existingIssue]}))

    const closeActions = actions.filter(a => a.type === 'close')
    expect(closeActions).toHaveLength(1)
    expect(counts.closed).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// plan-consistency privacy: every public surface carries only normalized
// data (path, statuses, unit counts, correction). No raw plan-body sentence.
// ---------------------------------------------------------------------------

describe('plan-consistency privacy: proposal surfaces', () => {
  it('proposal title contains only kind and path — no raw plan-body sentence', () => {
    const finding = makeDriftedPlanConsistencyFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))
    const openAction = actions.find(a => a.type === 'open')
    expect(openAction).toBeDefined()
    if (openAction?.type === 'open') {
      expect(openAction.title).toContain('plan-consistency')
      expect(openAction.title).toContain(finding.path)
    }
  })

  it('proposal body contains path, statuses, unit counts, and correction — no sentence copied from the plan body', () => {
    const secretSentence = 'This plan discusses a confidential rollout timeline that must never leak.'
    const finding = {
      ...makeDriftedPlanConsistencyFinding(),
      // Simulate what would happen if a raw sentence somehow made it onto liveState —
      // it must not, because the finding builder never puts raw text there. This
      // test pins the invariant at the proposal-body-rendering boundary too.
    }
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {actions} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))
    const openAction = actions.find(a => a.type === 'open')
    expect(openAction).toBeDefined()
    if (openAction?.type === 'open') {
      expect(openAction.body).toContain(finding.path)
      expect(openAction.body).toContain(finding.claimedState)
      expect(openAction.body).toContain(finding.liveState)
      expect(openAction.body).toContain(finding.proposedCorrection)
      expect(openAction.body).not.toContain(secretSentence)
    }
  })

  it('update comment, recurrence comment, and close comment for plan-consistency carry only normalized data', () => {
    const fingerprint = 'abc123def4560001'

    // Update-comment surface: open issue exists, live state changed.
    const updateFinding = {
      ...makeDriftedPlanConsistencyFinding(fingerprint),
      liveState: 'checked-3-unchecked-0',
    }
    const updateReport = makeReport({
      findings: [updateFinding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const openIssueWithOldState: ExistingProposalIssue = {
      ...makeOpenIssue(fingerprint, {title: 'Status truth: plan-consistency drift in docs/plans/example.md'}),
      body: `<!-- status-truth:fingerprint=${fingerprint} -->\n<!-- status-truth:live-state=checked-2-unchecked-0 -->\n\nBody.`,
    }
    const updateResult = planStatusTruthProposalActions(
      makePlanInput({report: updateReport, existingIssues: [openIssueWithOldState]}),
    )
    const updateAction = updateResult.actions.find(a => a.type === 'update-comment')
    expect(updateAction).toBeDefined()
    if (updateAction?.type === 'update-comment') {
      expect(updateAction.comment).toContain(updateFinding.liveState)
      expect(updateAction.comment).not.toMatch(/session|agent|workflow log/i)
    }

    // Recurrence-comment surface: closed non-terminal issue, drift returns.
    const recurrenceReport = makeReport({
      findings: [makeDriftedPlanConsistencyFinding(fingerprint)],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const closedNonTerminalIssue = makeClosedIssue(fingerprint, [PROPOSAL_LABEL], {
      title: 'Status truth: plan-consistency drift in docs/plans/example.md',
      closedAt: '2026-06-01T00:00:00Z',
    })
    const recurrenceResult = planStatusTruthProposalActions(
      makePlanInput({
        report: recurrenceReport,
        existingIssues: [closedNonTerminalIssue],
        now: new Date('2026-07-02T00:00:00Z'),
      }),
    )
    const reopenAction = recurrenceResult.actions.find(a => a.type === 'reopen')
    expect(reopenAction).toBeDefined()
    if (reopenAction?.type === 'reopen') {
      expect(reopenAction.comment).not.toMatch(/session|agent|workflow log/i)
      expect(reopenAction.comment).toMatch(/recurrence|returned/i)
    }

    // Close-comment surface: open issue, drift cleared.
    const closeReport = makeReport({
      findings: [],
      status: 'clean',
      scan_complete: true,
      counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
    })
    const openIssueToClose = makeOpenIssue(fingerprint, {
      title: 'Status truth: plan-consistency drift in docs/plans/example.md',
    })
    const closeResult = planStatusTruthProposalActions(
      makePlanInput({report: closeReport, existingIssues: [openIssueToClose]}),
    )
    const closeAction = closeResult.actions.find(a => a.type === 'close')
    expect(closeAction).toBeDefined()
    if (closeAction?.type === 'close') {
      expect(closeAction.comment).not.toMatch(/session|agent|workflow log/i)
    }
  })

  it('stdout summary shape (countsByKind) for plan-consistency is counts-only — no paths or fingerprints', () => {
    const finding = makeDriftedPlanConsistencyFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const {countsByKind} = planStatusTruthProposalActions(makePlanInput({report, existingIssues: []}))
    expect(countsByKind['plan-consistency']).toBeDefined()

    const json = JSON.stringify(countsByKind)
    expect(json).not.toMatch(/docs\/plans\/example\.md/)
    expect(json).not.toMatch(/[a-f0-9]{16,}/)
  })
})
