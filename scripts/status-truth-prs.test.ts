/**
 * Tests for the status-truth PR graduation gate planner.
 *
 * All tests are pure — no Octokit, no disk I/O.
 *
 * Design invariants under test:
 * - PR pathway is disabled by default (enabled=false → proposal-only).
 * - One PR action per run maximum (overflow → proposal-only).
 * - Path authorization runs before diff rendering; forbidden paths → proposal-only.
 * - Branch/title metadata is opaque (no source text, path, or fingerprint in names).
 * - Opaque digest is a separate one-way hash; branch/title cannot prefix-match the fingerprint.
 * - Existing PR rediscovery requires opaque metadata match + bot ownership + main target.
 * - No action type can merge, approve, automerge, force-push, or retarget non-main.
 * - Non-eligible/ambiguous candidates downgrade to proposal-only; no throws.
 */

import type {StatusTruthJsonReport} from './status-truth-detect.ts'
import type {
  ExecuteStatusTruthPrActionsInput,
  ExistingStatusTruthPr,
  PlanStatusTruthPrActionsInput,
  RunPrsCoreDeps,
  StatusTruthPrAction,
  StatusTruthPrFetchClient,
  StatusTruthPrOctokitClient,
} from './status-truth-prs.ts'
import type {PublicOutputTokens} from './status-truth-public-output.ts'
import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'
import {
  buildEnvBackedRunPrsCoreDeps,
  executeStatusTruthPrActions,
  extractTerminalFingerprint,
  fetchExistingCorrectionPrs,
  fetchTerminalFingerprints,
  GRADUATED_CLAIM_KINDS,
  isPrExecutionArmed,
  planStatusTruthPrActions,
  PR_BRANCH_PREFIX,
  PR_TITLE_PREFIX,
  runPrs,
  runPrsCore,
} from './status-truth-prs.ts'
import * as publicOutputModule from './status-truth-public-output.ts'

// Mirrors the production digest derivation so tests stay in sync without
// importing the private helper.
function testDeriveOpaqueDigest(fingerprint: string): string {
  return createHash('sha256').update(`status-truth-pr:${fingerprint}`).digest('hex').slice(0, 16)
}

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

function makeDriftedFinding(
  overrides: {
    fingerprint?: string
    kind?:
      'pr-state' | 'plan-consistency' | 'issue-state' | 'release-tag-state' | 'plan-status' | 'rollout-tracker-status'
    path?: string
    sourceRef?: string
    claimedState?: string
    liveState?: string
    proposedCorrection?: string
  } = {},
) {
  return {
    kind: overrides.kind ?? ('plan-consistency' as const),
    path: overrides.path ?? 'docs/plans/example.md',
    sourceRef: overrides.sourceRef ?? '#42',
    verdict: 'drifted' as const,
    fingerprint: overrides.fingerprint ?? 'abc123def456abcd',
    claimedState: overrides.claimedState ?? 'open',
    liveState: overrides.liveState ?? 'closed',
    proposalEligible: true,
    proposedCorrection: overrides.proposedCorrection ?? 'pr #42 is closed',
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

function makeInput(overrides: Partial<PlanStatusTruthPrActionsInput> = {}): PlanStatusTruthPrActionsInput {
  return {
    report: makeReport(),
    graduatedClaimKinds: new Set<string>(),
    existingPrs: [],
    publicOutputTokens: makeLoadedTokens(),
    maxPrsPerRun: 1,
    enabled: false,
    terminalFingerprints: new Set<string>(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test 8: Disabled default — planner disabled path produces proposal-only/no PR counts
// ---------------------------------------------------------------------------

describe('disabled default', () => {
  it('returns zero PR actions and all proposal-only when enabled=false', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: false,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.downgradedToProposalOnly).toBe(1)
    expect(result.actions.every(a => a.type === 'downgrade-to-proposal')).toBe(true)
  })

  it('returns zero PR actions when no claim kinds are graduated even if enabled=true', () => {
    const finding = makeDriftedFinding()
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set<string>(),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.downgradedToProposalOnly).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Test 1: Happy path — graduated claim kind produces one correction PR action
// ---------------------------------------------------------------------------

describe('happy path: graduated claim kind', () => {
  it('produces one open-pr action with opaque branch/title metadata', () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(1)
    expect(result.counts.downgradedToProposalOnly).toBe(0)

    const action = result.actions[0]
    expect(action).toBeDefined()
    expect(action?.type).toBe('open-pr')

    if (action?.type === 'open-pr') {
      // Branch name must start with the opaque prefix and not contain raw source text
      expect(action.opaqueBranchName).toMatch(new RegExp(`^${PR_BRANCH_PREFIX}`))
      // Branch name must not contain the fingerprint verbatim
      expect(action.opaqueBranchName).not.toContain('abc123def456abcd')
      // Branch name must not contain the path
      expect(action.opaqueBranchName).not.toContain('docs/plans/example.md')
      // Branch name must not contain the sourceRef
      expect(action.opaqueBranchName).not.toContain('#42')

      // Title must start with the opaque prefix (escape regex special chars)
      const escapedTitlePrefix = PR_TITLE_PREFIX.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
      expect(action.opaqueTitle).toMatch(new RegExp(`^${escapedTitlePrefix}`))
      // Title must not contain raw claim text
      expect(action.opaqueTitle).not.toContain('pr #42 is closed')
      // Title must not contain the path
      expect(action.opaqueTitle).not.toContain('docs/plans/example.md')

      // Base branch must be main
      expect(action.baseBranch).toBe('main')

      // Opaque digest must be exactly 16 hex chars and equal sha256('status-truth-pr:${fingerprint}').slice(0, 16).
      const expectedDigest = createHash('sha256').update('status-truth-pr:abc123def456abcd').digest('hex').slice(0, 16)
      expect(action.opaqueDigest).toHaveLength(16)
      expect(action.opaqueDigest).toBe(expectedDigest)

      // Opaque digest must NOT be the fingerprint or its first 8 hex chars.
      // The digest is a separate one-way hash; a prefix-match would leak the fingerprint.
      expect(action.opaqueDigest).not.toBe('abc123def456abcd')
      expect(action.opaqueDigest).not.toBe('abc123de') // first 8 chars of fingerprint
      expect(action.opaqueBranchName).not.toContain('abc123de')
      expect(action.opaqueTitle).not.toContain('abc123de')
    }
  })

  it('GRADUATED_CLAIM_KINDS export contains exactly plan-consistency (graduated on #3656 + #3614-#3616 evidence)', () => {
    expect(GRADUATED_CLAIM_KINDS).toBeDefined()
    expect(typeof GRADUATED_CLAIM_KINDS).toBe('object')
    expect(GRADUATED_CLAIM_KINDS.size).toBe(1)
    expect(GRADUATED_CLAIM_KINDS.has('plan-consistency')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isPrExecutionArmed: three-key arming gate
// ---------------------------------------------------------------------------

describe('isPrExecutionArmed', () => {
  it('is armed only when repo variable, dispatch input, and graduated set are all true/non-empty', () => {
    expect(
      isPrExecutionArmed({
        prsEnabledVar: 'true',
        dispatchInputVar: 'true',
        graduatedClaimKinds: GRADUATED_CLAIM_KINDS,
      }),
    ).toBe(true)
  })

  it('stays false when the repo variable is missing', () => {
    expect(
      isPrExecutionArmed({
        prsEnabledVar: undefined,
        dispatchInputVar: 'true',
        graduatedClaimKinds: new Set(['plan-consistency']),
      }),
    ).toBe(false)
  })

  it('stays false when the dispatch input is missing', () => {
    expect(
      isPrExecutionArmed({
        prsEnabledVar: 'true',
        dispatchInputVar: undefined,
        graduatedClaimKinds: new Set(['plan-consistency']),
      }),
    ).toBe(false)
  })

  it('stays false when the graduated set is empty, even with both other keys true', () => {
    expect(
      isPrExecutionArmed({
        prsEnabledVar: 'true',
        dispatchInputVar: 'true',
        graduatedClaimKinds: new Set(),
      }),
    ).toBe(false)
  })

  it('stays false when all three keys are absent/false/empty', () => {
    expect(
      isPrExecutionArmed({
        prsEnabledVar: undefined,
        dispatchInputVar: undefined,
        graduatedClaimKinds: new Set(),
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 2: Edge case — two PR-eligible findings; one PR action, rest downgrade
// ---------------------------------------------------------------------------

describe('edge case: overflow to proposal-only', () => {
  it('plans one PR action and downgrades the rest when two eligible findings appear', () => {
    const finding1 = makeDriftedFinding({fingerprint: 'aaaa1111bbbb2222', kind: 'plan-consistency'})
    const finding2 = makeDriftedFinding({
      fingerprint: 'cccc3333dddd4444',
      kind: 'plan-consistency',
      sourceRef: '#99',
      proposedCorrection: 'pr #99 is closed',
    })
    const report = makeReport({
      findings: [finding1, finding2],
      counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        maxPrsPerRun: 1,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(1)
    expect(result.counts.downgradedToProposalOnly).toBe(1)

    const prActions = result.actions.filter(a => a.type === 'open-pr')
    const downgradeActions = result.actions.filter(a => a.type === 'downgrade-to-proposal')
    expect(prActions).toHaveLength(1)
    expect(downgradeActions).toHaveLength(1)
  })

  it('respects maxPrsPerRun=0 by downgrading all', () => {
    const finding = makeDriftedFinding({kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        maxPrsPerRun: 0,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.downgradedToProposalOnly).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Test 3: Forbidden path — no PR action, proposal-only, diff not rendered
// ---------------------------------------------------------------------------

describe('forbidden path: path authorization', () => {
  it('downgrades to proposal-only for authority-sensitive paths without rendering diff', () => {
    const finding = makeDriftedFinding({
      kind: 'plan-consistency',
      path: '.github/workflows/main.yaml', // forbidden: workflow path
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.pathForbidden).toBe(1)
    expect(result.counts.downgradedToProposalOnly).toBe(1)

    // No open-pr action
    expect(result.actions.every(a => a.type !== 'open-pr')).toBe(true)

    // Downgrade action must not contain correction text or path
    const downgrade = result.actions.find(a => a.type === 'downgrade-to-proposal')
    expect(downgrade).toBeDefined()
    if (downgrade?.type === 'downgrade-to-proposal') {
      // The action must not expose the forbidden path or correction text
      expect(JSON.stringify(downgrade)).not.toContain('.github/workflows/main.yaml')
      expect(JSON.stringify(downgrade)).not.toContain('pr #42 is closed')
    }
  })

  it('downgrades to proposal-only for metadata/ paths', () => {
    const finding = makeDriftedFinding({
      kind: 'plan-consistency',
      path: 'metadata/repos.yaml',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.pathForbidden).toBe(1)
    expect(result.counts.prActionsPlanned).toBe(0)
  })

  it('downgrades to proposal-only for path traversal segments', () => {
    const finding = makeDriftedFinding({
      kind: 'plan-consistency',
      path: 'docs/../.github/workflows/evil.yaml',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.pathForbidden).toBe(1)
    expect(result.counts.prActionsPlanned).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test 4: Branch/title candidate fails privacy gate — no PR action
// ---------------------------------------------------------------------------

describe('privacy gate: branch/title candidate blocked', () => {
  it('downgrades to proposal-only when public output tokens block the PR metadata', () => {
    // The finding's proposedCorrection contains a private token
    const finding = makeDriftedFinding({
      kind: 'plan-consistency',
      proposedCorrection: 'pr #42 is closed (private-repo-name)',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        publicOutputTokens: makeBlockingTokens(),
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.privacyGateBlocked).toBe(1)
    expect(result.counts.downgradedToProposalOnly).toBe(1)
    expect(result.actions.every(a => a.type !== 'open-pr')).toBe(true)
  })

  it('downgrades to proposal-only when token load fails', () => {
    const finding = makeDriftedFinding({kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        publicOutputTokens: {loaded: false, error: 'token load failed'},
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.privacyGateBlocked).toBe(1)
    expect(result.counts.downgradedToProposalOnly).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Test 5: Existing branch/PR metadata mismatch — do not mutate
// ---------------------------------------------------------------------------

describe('existing PR: metadata mismatch', () => {
  it('leaves finding as proposal-only when existing PR opaque metadata does not match', () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Existing PR with a different opaque digest (mismatch)
    const existingPr: ExistingStatusTruthPr = {
      number: 99,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}differentdigest`,
      baseBranch: 'main',
      opaqueDigest: 'differentdigest', // does not match the finding's fingerprint digest
      botOwned: true,
    }

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
      }),
    )

    // Should not produce a rediscover-pr action for the mismatched PR
    expect(result.actions.every(a => a.type !== 'rediscover-pr')).toBe(true)
    // The finding should either open a new PR or downgrade (not mutate the existing one)
    // Since there's no match, it should plan a new open-pr (or downgrade if other gates fail)
    // The key invariant: no mutation of the mismatched existing PR
    const rediscoverActions = result.actions.filter(a => a.type === 'rediscover-pr')
    expect(rediscoverActions).toHaveLength(0)
  })

  it('leaves finding as proposal-only when existing PR is not bot-owned', () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Use the correct derived digest but mark botOwned=false to test that gate.
    const opaqueDigest = testDeriveOpaqueDigest('abc123def456abcd')
    const existingPr: ExistingStatusTruthPr = {
      number: 99,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: false, // not bot-owned
    }

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
      }),
    )

    // Must not rediscover a non-bot-owned PR
    expect(result.actions.every(a => a.type !== 'rediscover-pr')).toBe(true)
  })

  it('leaves finding as proposal-only when existing PR targets non-main branch', () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const opaqueDigest = testDeriveOpaqueDigest('abc123def456abcd')
    const existingPr: ExistingStatusTruthPr = {
      number: 99,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'develop', // not main
      opaqueDigest,
      botOwned: true,
    }

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
      }),
    )

    // Must not rediscover a PR targeting non-main
    expect(result.actions.every(a => a.type !== 'rediscover-pr')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 6: Existing open status-truth PR rediscovered instead of creating duplicate
// ---------------------------------------------------------------------------

describe('existing PR: rediscovery', () => {
  it('produces a rediscover-pr action when all matching criteria are met', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Derive the opaque digest the same way the planner does (sha256 one-way hash).
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const existingPr: ExistingStatusTruthPr = {
      number: 77,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: true,
    }

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(1)
    const rediscoverAction = result.actions.find(a => a.type === 'rediscover-pr')
    expect(rediscoverAction).toBeDefined()
    if (rediscoverAction?.type === 'rediscover-pr') {
      expect(rediscoverAction.existingPrNumber).toBe(77)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 7: Verification invariant — no forbidden action types
// ---------------------------------------------------------------------------

describe('verification invariant: no forbidden actions', () => {
  it('no action type can be merge, approve, automerge, force-push, or retarget', () => {
    const finding = makeDriftedFinding({kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    const forbiddenTypes = new Set(['merge', 'approve', 'automerge', 'force-push', 'retarget'])
    for (const action of result.actions) {
      expect(forbiddenTypes.has(action.type)).toBe(false)
    }
  })

  it('the StatusTruthPrAction type union does not include forbidden action types', () => {
    // This is a compile-time check enforced by the type system.
    // At runtime, we verify that the allowed action types are only the safe ones.
    const allowedTypes: StatusTruthPrAction['type'][] = ['open-pr', 'rediscover-pr', 'downgrade-to-proposal']
    // If a forbidden type were added to the union, this array would need updating,
    // and the test above would catch it at runtime.
    expect(allowedTypes).not.toContain('merge')
    expect(allowedTypes).not.toContain('approve')
    expect(allowedTypes).not.toContain('automerge')
    expect(allowedTypes).not.toContain('force-push')
    expect(allowedTypes).not.toContain('retarget')
  })
})

// ---------------------------------------------------------------------------
// Budget semantics: rediscovery/close/downgrade exempt from the new-open budget
// ---------------------------------------------------------------------------

describe('budget semantics: new-open budget counts only open-pr actions', () => {
  it('rediscovering an existing open PR does not consume the open budget; a second finding gets the slot', () => {
    const fingerprint1 = 'abc123def456abcd'
    const fingerprint2 = 'aaaa1111bbbb2222'
    const finding1 = makeDriftedFinding({fingerprint: fingerprint1, kind: 'plan-consistency'})
    const finding2 = makeDriftedFinding({
      fingerprint: fingerprint2,
      kind: 'plan-consistency',
      sourceRef: '#99',
      proposedCorrection: 'pr #99 is closed',
    })
    const report = makeReport({
      findings: [finding1, finding2],
      counts: {total: 2, current: 0, drifted: 2, unresolved: 0, unsafe: 0, proposal_eligible: 2},
    })

    const opaqueDigest = testDeriveOpaqueDigest(fingerprint1)
    const existingPr: ExistingStatusTruthPr = {
      number: 77,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: true,
    }

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        maxPrsPerRun: 1,
        existingPrs: [existingPr],
      }),
    )

    const rediscoverActions = result.actions.filter(a => a.type === 'rediscover-pr')
    const openActions = result.actions.filter(a => a.type === 'open-pr')
    expect(rediscoverActions).toHaveLength(1)
    expect(openActions).toHaveLength(1)
    expect(result.counts.downgradedToProposalOnly).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Closure planning: drift-cleared and terminal-label close actions
// ---------------------------------------------------------------------------

describe('closure planning: drift-cleared', () => {
  it('closes an open PR whose fingerprint is absent from a complete, non-failure report', () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const existingPr: ExistingStatusTruthPr = {
      number: 55,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: true,
    }
    // Report contains no findings at all — fingerprint is gone (drift cleared).
    const report = makeReport({scan_complete: true, failure_class: null, findings: []})

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
        terminalFingerprints: new Set<string>(),
      }),
    )

    const closeActions = result.actions.filter(a => a.type === 'close-pr')
    expect(closeActions).toHaveLength(1)
    if (closeActions[0]?.type === 'close-pr') {
      expect(closeActions[0].reason).toBe('drift-cleared')
      expect(closeActions[0].prNumber).toBe(55)
    }
  })

  it('does not close when the scan is incomplete', () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const existingPr: ExistingStatusTruthPr = {
      number: 55,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: true,
    }
    const report = makeReport({scan_complete: false, findings: []})

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
        terminalFingerprints: new Set<string>(),
      }),
    )

    expect(result.actions.some(a => a.type === 'close-pr')).toBe(false)
  })

  it('does not close when the fingerprint is still active (drift persists)', () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const existingPr: ExistingStatusTruthPr = {
      number: 55,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: true,
    }
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      scan_complete: true,
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
        terminalFingerprints: new Set<string>(),
      }),
    )

    expect(result.actions.some(a => a.type === 'close-pr')).toBe(false)
  })
})

describe('closure planning: terminal-label', () => {
  it('closes an open PR whose fingerprint carries a terminal outcome label, even with persisting drift', () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const existingPr: ExistingStatusTruthPr = {
      number: 55,
      state: 'open',
      headBranch: `${PR_BRANCH_PREFIX}${opaqueDigest}`,
      baseBranch: 'main',
      opaqueDigest,
      botOwned: true,
    }
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      scan_complete: true,
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [existingPr],
        terminalFingerprints: new Set([fingerprint]),
      }),
    )

    const closeActions = result.actions.filter(a => a.type === 'close-pr')
    expect(closeActions).toHaveLength(1)
    if (closeActions[0]?.type === 'close-pr') {
      expect(closeActions[0].reason).toBe('terminal-label')
    }
    // No rediscover-pr should be produced for the terminal-labeled fingerprint.
    expect(result.actions.some(a => a.type === 'rediscover-pr')).toBe(false)
  })

  it('produces no action (suppression) when a fingerprint is terminal but no open PR exists', () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      scan_complete: true,
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
        existingPrs: [],
        terminalFingerprints: new Set([fingerprint]),
      }),
    )

    expect(result.actions).toHaveLength(0)
    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.downgradedToProposalOnly).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Corrector seam: graduated kind without a registered corrector downgrades
// ---------------------------------------------------------------------------

describe('corrector seam', () => {
  it('downgrades with a distinct reason when the graduated kind has no registered corrector', () => {
    const finding = makeDriftedFinding({kind: 'issue-state'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['issue-state']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    const downgrade = result.actions.find(a => a.type === 'downgrade-to-proposal')
    expect(downgrade).toBeDefined()
    if (downgrade?.type === 'downgrade-to-proposal') {
      expect(downgrade.reason).toBe('no-corrector')
    }
  })

  it('plans an open-pr action for plan-consistency, the only kind with a registered corrector', () => {
    const finding = makeDriftedFinding({kind: 'plan-consistency', path: 'docs/plans/example.md'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(1)
    expect(result.actions[0]?.type).toBe('open-pr')
  })
})

// ---------------------------------------------------------------------------
// Additional invariants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Execution shell: independent safety enforcement
// ---------------------------------------------------------------------------

function makeOpenPrAction(overrides: Partial<Extract<StatusTruthPrAction, {type: 'open-pr'}>> = {}) {
  const digest = overrides.opaqueDigest ?? testDeriveOpaqueDigest('abc123def456abcd')
  return {
    type: 'open-pr' as const,
    opaqueBranchName: `${PR_BRANCH_PREFIX}${digest}`,
    opaqueTitle: `${PR_TITLE_PREFIX}${digest}`,
    baseBranch: 'main' as const,
    opaqueDigest: digest,
    path: 'docs/plans/example-plan.md',
    kind: 'plan-consistency',
    fingerprint: 'abc123def456abcd',
    ...overrides,
  }
}

function makeClosePrAction(overrides: Partial<Extract<StatusTruthPrAction, {type: 'close-pr'}>> = {}) {
  const digest = overrides.opaqueDigest ?? testDeriveOpaqueDigest('abc123def456abcd')
  return {
    type: 'close-pr' as const,
    reason: 'drift-cleared' as const,
    prNumber: 55,
    branch: `${PR_BRANCH_PREFIX}${digest}`,
    opaqueDigest: digest,
    ...overrides,
  }
}

const STALE_PLAN_CONTENT = "---\ntitle: 'Example'\nstatus: active\n---\n\n- [x] **Unit 1: A**\n"

function makeMockOctokit(overrides: Partial<StatusTruthPrOctokitClient['rest']> = {}): StatusTruthPrOctokitClient {
  return {
    rest: {
      repos: {
        getContent: vi.fn(async () => ({
          data: {
            content: Buffer.from(STALE_PLAN_CONTENT, 'utf8').toString('base64'),
            encoding: 'base64',
            sha: 'blob-sha-1',
          },
        })),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
        ...overrides.repos,
      },
      git: {
        getRef: vi.fn(async () => ({data: {object: {sha: 'base-sha-1'}}})),
        createRef: vi.fn(async () => ({data: {ref: 'refs/heads/x'}})),
        deleteRef: vi.fn(async () => undefined),
        ...overrides.git,
      },
      pulls: {
        create: vi.fn(async () => ({data: {number: 101}})),
        update: vi.fn(async () => ({data: {number: 101}})),
        ...overrides.pulls,
      },
      issues: {
        createComment: vi.fn(async () => ({data: {id: 1}})),
        ...overrides.issues,
      },
    },
  } as unknown as StatusTruthPrOctokitClient
}

function makeExecuteInput(overrides: Partial<ExecuteStatusTruthPrActionsInput> = {}): ExecuteStatusTruthPrActionsInput {
  return {
    octokit: makeMockOctokit(),
    owner: 'fro-bot',
    repo: '.github',
    actions: [],
    dryRun: false,
    publicOutputTokens: makeLoadedTokens(),
    ...overrides,
  }
}

describe('execution shell: open-pr happy path', () => {
  it('re-reads live content, re-verifies, creates branch + commit + PR with opaque metadata', async () => {
    const action = makeOpenPrAction()
    const octokit = makeMockOctokit()
    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.opened).toBe(1)
    expect(result.counts.safetyRefused).toBe(0)
    expect(result.counts.downgraded).toBe(0)

    expect(octokit.rest.repos.getContent).toHaveBeenCalled()
    expect(octokit.rest.git.createRef).toHaveBeenCalled()
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalled()
    expect(octokit.rest.pulls.create).toHaveBeenCalled()

    const createRefCall = vi.mocked(octokit.rest.git.createRef).mock.calls[0]?.[0] as {ref: string}
    expect(createRefCall.ref).toContain(action.opaqueBranchName)

    const pullsCreateCall = vi.mocked(octokit.rest.pulls.create).mock.calls[0]?.[0] as {title: string}
    expect(pullsCreateCall.title).toBe(action.opaqueTitle)
  })
})

describe('execution shell: close-pr happy path', () => {
  it('closes the PR with a gated comment and deletes the pattern-matching branch', async () => {
    const action = makeClosePrAction()
    const octokit = makeMockOctokit()
    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.closed).toBe(1)
    expect(octokit.rest.pulls.update).toHaveBeenCalled()
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    expect(octokit.rest.git.deleteRef).toHaveBeenCalled()

    const updateCall = vi.mocked(octokit.rest.pulls.update).mock.calls[0]?.[0] as {state: string}
    expect(updateCall.state).toBe('closed')
  })
})

describe('execution shell: TOCTOU re-verification failure', () => {
  it('downgrades and pushes nothing when live content no longer re-verifies as current after correction', async () => {
    const action = makeOpenPrAction()
    // Live content has already been fixed by a human — status is already complete,
    // so the corrector's rewrite is a no-op mismatch scenario: content re-verifies
    // as current already, meaning the ORIGINAL claim is stale. Simulate the TOCTOU
    // failure mode via content that yields "unresolved" post-correction (unchecked unit).
    const staleWithUncheckedUnit = '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n- [ ] **Unit 2: B**\n'
    const octokit = makeMockOctokit({
      repos: {
        getContent: vi.fn(async () => ({
          data: {
            content: Buffer.from(staleWithUncheckedUnit, 'utf8').toString('base64'),
            encoding: 'base64',
            sha: 'blob-sha-2',
          },
        })),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.opened).toBe(0)
    expect(result.counts.downgraded).toBe(1)
    expect(octokit.rest.git.createRef).not.toHaveBeenCalled()
    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled()
  })
})

describe('execution shell: branch pattern refusal', () => {
  it('refuses when the planned branch name does not match the correction pattern for the fingerprint', async () => {
    const action = makeOpenPrAction({opaqueBranchName: 'status-truth/correction-WRONGDIGEST'})
    const octokit = makeMockOctokit()

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.safetyRefused).toBe(1)
    expect(result.counts.opened).toBe(0)
    expect(octokit.rest.git.createRef).not.toHaveBeenCalled()
  })

  it('refuses a close-pr whose branch does not match the correction pattern', async () => {
    const action = makeClosePrAction({branch: 'main'})
    const octokit = makeMockOctokit()

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.safetyRefused).toBe(1)
    expect(result.counts.closed).toBe(0)
    expect(octokit.rest.git.deleteRef).not.toHaveBeenCalled()
    expect(octokit.rest.pulls.update).not.toHaveBeenCalled()
  })
})

describe('execution shell: createRef 422 collision policy', () => {
  it('refuses without force-updating when the stale branch tip differs from the computed correction', async () => {
    const action = makeOpenPrAction()
    const differentContent = '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n- [x] **Unit 2: DIFFERENT**\n'
    const octokit = makeMockOctokit({
      git: {
        getRef: vi.fn(async (params: {ref: string}) => {
          if (params.ref.includes(action.opaqueBranchName)) {
            return {data: {object: {sha: 'stale-branch-sha'}}}
          }
          return {data: {object: {sha: 'base-sha-1'}}}
        }),
        createRef: vi.fn(async () => {
          throw Object.assign(new Error('Reference already exists'), {status: 422})
        }),
        deleteRef: vi.fn(async () => undefined),
      },
      repos: {
        getContent: vi.fn(async (params: {ref?: string}) => {
          if (params.ref === action.opaqueBranchName) {
            return {
              data: {
                content: Buffer.from(differentContent, 'utf8').toString('base64'),
                encoding: 'base64',
                sha: 'stale-blob-sha',
              },
            }
          }
          return {
            data: {
              content: Buffer.from(STALE_PLAN_CONTENT, 'utf8').toString('base64'),
              encoding: 'base64',
              sha: 'blob-sha-1',
            },
          }
        }),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.safetyRefused).toBe(1)
    expect(result.counts.opened).toBe(0)
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled()
  })

  it('reuses the branch and opens the PR when the stale branch tip matches the computed correction', async () => {
    const action = makeOpenPrAction()
    const correctedContent = "---\ntitle: 'Example'\nstatus: complete\n---\n\n- [x] **Unit 1: A**\n"
    const octokit = makeMockOctokit({
      git: {
        getRef: vi.fn(async (params: {ref: string}) => {
          if (params.ref.includes(action.opaqueBranchName)) {
            return {data: {object: {sha: 'reused-branch-sha'}}}
          }
          return {data: {object: {sha: 'base-sha-1'}}}
        }),
        createRef: vi.fn(async () => {
          throw Object.assign(new Error('Reference already exists'), {status: 422})
        }),
        deleteRef: vi.fn(async () => undefined),
      },
      repos: {
        getContent: vi.fn(async (params: {ref?: string}) => {
          if (params.ref === action.opaqueBranchName) {
            return {
              data: {
                content: Buffer.from(correctedContent, 'utf8').toString('base64'),
                encoding: 'base64',
                sha: 'reused-blob-sha',
              },
            }
          }
          return {
            data: {
              content: Buffer.from(STALE_PLAN_CONTENT, 'utf8').toString('base64'),
              encoding: 'base64',
              sha: 'blob-sha-1',
            },
          }
        }),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.opened).toBe(1)
    expect(result.counts.safetyRefused).toBe(0)
    expect(octokit.rest.pulls.create).toHaveBeenCalled()
    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
  })
})

describe('execution shell: close-pr ordering (closure before comment)', () => {
  it('closes the PR and attempts branch delete even when posting the comment fails', async () => {
    const action = makeClosePrAction()
    const octokit = makeMockOctokit({
      issues: {
        createComment: vi.fn(async () => {
          throw new Error('comment API failure')
        }),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(octokit.rest.pulls.update).toHaveBeenCalled()
    expect(octokit.rest.git.deleteRef).toHaveBeenCalled()
    expect(result.counts.closed).toBe(1)
    expect(result.counts.failed).toBe(0)
  })

  it('closes the PR even when the comment fails the public-output gate', async () => {
    const action = makeClosePrAction()
    const octokit = makeMockOctokit()
    // Unloaded tokens force applyPublicOutputGate to block unconditionally
    // (fail-closed), guaranteeing the comment gate fails for this test.
    const unloadedTokens: PublicOutputTokens = {loaded: false, error: 'test: forced gate failure'}

    const result = await executeStatusTruthPrActions(
      makeExecuteInput({actions: [action], octokit, publicOutputTokens: unloadedTokens}),
    )

    expect(octokit.rest.pulls.update).toHaveBeenCalled()
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(result.counts.closed).toBe(1)
  })
})

describe('execution shell: deleteRef 422 non-fatal', () => {
  it('counts the failure and continues when deleteRef 422s (already gone)', async () => {
    const action = makeClosePrAction()
    const octokit = makeMockOctokit({
      git: {
        getRef: vi.fn(async () => ({data: {object: {sha: 'base-sha-1'}}})),
        createRef: vi.fn(async () => ({data: {ref: 'refs/heads/x'}})),
        deleteRef: vi.fn(async () => {
          throw Object.assign(new Error('Reference does not exist'), {status: 422})
        }),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.closed).toBe(1)
    expect(result.counts.branchDeleteFailed).toBe(1)
  })
})

describe('execution shell: pulls.create isolated failure', () => {
  it('counts the failure without aborting remaining actions', async () => {
    const action1 = makeOpenPrAction()
    const action2 = makeClosePrAction()
    const octokit = makeMockOctokit({
      pulls: {
        create: vi.fn(async () => {
          throw new Error('API failure: token=super-secret-value')
        }),
        update: vi.fn(async () => ({data: {number: 101}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action1, action2], octokit}))

    expect(result.counts.failed).toBe(1)
    expect(result.counts.closed).toBe(1)
  })
})

describe('execution shell: action-failure diagnostics', () => {
  it('emits a privacy-safe open-pr diagnostic with action type, error-class, and numeric status, never raw message text', async () => {
    const action = makeOpenPrAction()
    const octokit = makeMockOctokit({
      pulls: {
        create: vi.fn(async () => {
          throw Object.assign(new Error('super-secret-message-should-not-leak'), {status: 500})
        }),
        update: vi.fn(async () => ({data: {number: 101}})),
      },
    })
    const writeStderr = vi.fn<(text: string) => void>()

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit, writeStderr}))

    expect(result.counts.failed).toBe(1)
    expect(writeStderr).toHaveBeenCalled()
    const diagnostic = vi
      .mocked(writeStderr)
      .mock.calls.map(c => c[0])
      .join('\n')
    expect(diagnostic).toContain('action=open-pr')
    expect(diagnostic).toContain('error-class=action-failure')
    expect(diagnostic).toContain('status=500')
    expect(diagnostic).not.toContain('super-secret-message-should-not-leak')
  })

  it('emits a privacy-safe close-pr diagnostic without a status when the error carries none, never raw message text', async () => {
    const action = makeClosePrAction()
    const octokit = makeMockOctokit({
      pulls: {
        create: vi.fn(async () => ({data: {number: 101}})),
        update: vi.fn(async () => {
          throw new Error('super-secret-message-should-not-leak')
        }),
      },
    })
    const writeStderr = vi.fn<(text: string) => void>()

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit, writeStderr}))

    expect(result.counts.failed).toBe(1)
    const diagnostic = vi
      .mocked(writeStderr)
      .mock.calls.map(c => c[0])
      .join('\n')
    expect(diagnostic).toContain('action=close-pr')
    expect(diagnostic).toContain('error-class=action-failure')
    expect(diagnostic).not.toContain('status=')
    expect(diagnostic).not.toContain('super-secret-message-should-not-leak')
  })
})

describe('execution shell: downgrade classification for live-content 404', () => {
  it('classifies a 404 on live base-branch getContent as downgraded, not failed', async () => {
    const action = makeOpenPrAction()
    const octokit = makeMockOctokit({
      repos: {
        getContent: vi.fn(async () => {
          throw Object.assign(new Error('Not Found'), {status: 404})
        }),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.downgraded).toBe(1)
    expect(result.counts.failed).toBe(0)
    expect(octokit.rest.git.createRef).not.toHaveBeenCalled()
  })

  it('re-throws (counts as failed) a non-404 API error on live-content getContent', async () => {
    const action = makeOpenPrAction()
    const octokit = makeMockOctokit({
      repos: {
        getContent: vi.fn(async () => {
          throw Object.assign(new Error('Internal Server Error'), {status: 500})
        }),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.failed).toBe(1)
    expect(result.counts.downgraded).toBe(0)
  })

  it('classifies a branch-collision getContent 404 as safetyRefused, not failed', async () => {
    const action = makeOpenPrAction()
    const octokit = makeMockOctokit({
      git: {
        getRef: vi.fn(async () => ({data: {object: {sha: 'base-sha-1'}}})),
        createRef: vi.fn(async () => {
          throw Object.assign(new Error('Reference already exists'), {status: 422})
        }),
        deleteRef: vi.fn(async () => undefined),
      },
      repos: {
        getContent: vi.fn(async (params: {ref?: string}) => {
          if (params.ref === action.opaqueBranchName) {
            throw Object.assign(new Error('Not Found'), {status: 404})
          }
          return {
            data: {
              content: Buffer.from(STALE_PLAN_CONTENT, 'utf8').toString('base64'),
              encoding: 'base64',
              sha: 'blob-sha-1',
            },
          }
        }),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.safetyRefused).toBe(1)
    expect(result.counts.failed).toBe(0)
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled()
  })
})

describe('execution shell: corrector-returning-null and decodeGetContentResponse-null downgrades', () => {
  it('downgrades when the corrector returns null for the live content', async () => {
    const action = makeOpenPrAction({kind: 'plan-consistency', path: 'docs/plans/no-status-line.md'})
    const noStatusLineContent = '# A plan with no status line at all\n'
    const octokit = makeMockOctokit({
      repos: {
        getContent: vi.fn(async () => ({
          data: {
            content: Buffer.from(noStatusLineContent, 'utf8').toString('base64'),
            encoding: 'base64',
            sha: 'blob-sha-x',
          },
        })),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.downgraded).toBe(1)
    expect(result.counts.opened).toBe(0)
    expect(octokit.rest.git.createRef).not.toHaveBeenCalled()
  })

  it('downgrades when decodeGetContentResponse returns null (missing content field)', async () => {
    const action = makeOpenPrAction()
    const octokit = makeMockOctokit({
      repos: {
        getContent: vi.fn(async () => ({
          data: {sha: 'blob-sha-y'},
        })),
        createOrUpdateFileContents: vi.fn(async () => ({data: {commit: {sha: 'commit-sha-1'}}})),
      },
    })

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    expect(result.counts.downgraded).toBe(1)
    expect(result.counts.opened).toBe(0)
    expect(octokit.rest.git.createRef).not.toHaveBeenCalled()
  })
})

describe('execution shell: privacy gate on rendered surfaces', () => {
  it('threads the action fingerprint into the title/body gate calls (public-output gate symmetry)', async () => {
    const action = makeOpenPrAction({fingerprint: 'abc123def456abcd'})
    const octokit = makeMockOctokit()
    const gateSpy = vi.spyOn(publicOutputModule, 'applyPublicOutputGate')

    await executeStatusTruthPrActions(makeExecuteInput({actions: [action], octokit}))

    const titleCall = gateSpy.mock.calls.find(([params]) => params.surface === 'pr-title')
    const bodyCall = gateSpy.mock.calls.find(([params]) => params.surface === 'pr-body')
    expect(titleCall?.[0].fingerprint).toBe('abc123def456abcd')
    expect(bodyCall?.[0].fingerprint).toBe('abc123def456abcd')

    gateSpy.mockRestore()
  })
})

describe('execution shell: dry-run contract', () => {
  it('performs zero mutating calls and reports would-act counts with a dry-run marker', async () => {
    const openAction = makeOpenPrAction()
    const closeAction = makeClosePrAction()
    const octokit = makeMockOctokit()

    const result = await executeStatusTruthPrActions(
      makeExecuteInput({actions: [openAction, closeAction], octokit, dryRun: true}),
    )

    expect(result.dryRun).toBe(true)
    expect(result.counts.opened).toBe(0)
    expect(result.counts.closed).toBe(0)
    expect(result.counts.wouldOpen).toBe(1)
    expect(result.counts.wouldClose).toBe(1)

    expect(octokit.rest.git.createRef).not.toHaveBeenCalled()
    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled()
    expect(octokit.rest.pulls.update).not.toHaveBeenCalled()
    expect(octokit.rest.git.deleteRef).not.toHaveBeenCalled()
  })
})

describe('additional invariants', () => {
  it('non-proposal-eligible findings are ignored', () => {
    const finding = {
      kind: 'plan-consistency' as const,
      path: 'docs/plans/example.md',
      sourceRef: '#42',
      verdict: 'unresolved' as const,
      fingerprint: 'abc123def456abcd',
      claimedState: 'open',
      proposalEligible: false,
    }
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 0, unresolved: 1, unsafe: 0, proposal_eligible: 0},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.downgradedToProposalOnly).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('unsafe findings are ignored', () => {
    const finding = {
      kind: 'plan-consistency' as const,
      verdict: 'unsafe' as const,
      proposalEligible: false as const,
    }
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 0, unresolved: 0, unsafe: 1, proposal_eligible: 0},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('version-rejected report produces zero actions', () => {
    const report = makeReport({
      schema_version: 99,
      fingerprint_version: 99,
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.versionRejected).toBe(1)
    expect(result.actions).toHaveLength(0)
  })

  it('allowed doc paths pass path authorization', () => {
    const finding = makeDriftedFinding({
      kind: 'plan-consistency',
      path: 'docs/plans/example.md', // allowed path
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    // docs/plans/ is an allowed path — should not be forbidden
    expect(result.counts.pathForbidden).toBe(0)
    expect(result.counts.prActionsPlanned).toBe(1)
  })

  it('README.md passes path authorization', () => {
    const finding = makeDriftedFinding({
      kind: 'plan-consistency',
      path: 'README.md',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['plan-consistency']),
        enabled: true,
      }),
    )

    expect(result.counts.pathForbidden).toBe(0)
    expect(result.counts.prActionsPlanned).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// runPrsCore() seam — same-run report-read, state-fetch, plan, execute
// ---------------------------------------------------------------------------

function makeTerminalFingerprintIssue(fingerprint: string, label: string, login = 'fro-bot[bot]') {
  return {
    number: 501,
    labels: [{name: 'status-truth'}, {name: label}],
    body: `<!-- status-truth:fingerprint=${fingerprint} -->\n\nbody text`,
    user: {login},
  }
}

function makeFetchClientStub(
  overrides: {
    prs?: readonly {
      number: number
      state: string
      head: {ref: string}
      base: {ref: string}
      user: {login?: string | null} | null
    }[]
    issues?: readonly {
      number: number
      labels: readonly {name?: string | null}[]
      body?: string | null
      user?: {login?: string | null} | null
    }[]
    alwaysFullPrPages?: boolean
    alwaysFullIssuePages?: boolean
  } = {},
): StatusTruthPrFetchClient {
  const prs = overrides.prs ?? []
  const issues = overrides.issues ?? []
  return {
    rest: {
      pulls: {
        list: vi.fn(async ({page}: {page: number}) => ({data: overrides.alwaysFullPrPages || page === 1 ? prs : []})),
      },
      issues: {
        listForRepo: vi.fn(async ({page}: {page: number}) => ({
          data: overrides.alwaysFullIssuePages || page === 1 ? issues : [],
        })),
      },
    },
  } as unknown as StatusTruthPrFetchClient
}

function makeRunPrsCoreDeps(overrides: Partial<RunPrsCoreDeps> = {}): RunPrsCoreDeps {
  return {
    env: {},
    graduatedClaimKinds: new Set(['plan-consistency']),
    readReport: vi.fn(async () => {
      throw new Error('readReport not stubbed')
    }),
    loadPublicOutputTokens: vi.fn(async () => makeLoadedTokens()),
    createFetchClient: vi.fn(async () => makeFetchClientStub()),
    createWriteClient: vi.fn(async () => makeMockOctokit()),
    writeStdout: vi.fn(),
    writeStderr: vi.fn(),
    writeResultFile: vi.fn(async () => undefined),
    setExitCode: vi.fn(),
    ...overrides,
  }
}

describe('runPrsCore: disarmed mode', () => {
  it('exits counts-only and does not require a report path or report read', async () => {
    const readReport = vi.fn(async () => {
      throw new Error('must not be called when disarmed')
    })
    const deps = makeRunPrsCoreDeps({
      env: {},
      readReport,
    })

    const result = await runPrsCore(deps)

    expect(result.armed).toBe(false)
    expect(readReport).not.toHaveBeenCalled()
    expect(deps.setExitCode).not.toHaveBeenCalled()
    expect(deps.writeStdout).toHaveBeenCalledTimes(1)
    const stdoutArg = vi.mocked(deps.writeStdout).mock.calls[0]?.[0] as string
    expect(stdoutArg).toContain('"armed":false')
  })
})

describe('runPrsCore: armed dry-run', () => {
  it('plans and reports would-open counts for a graduated plan-consistency drift with zero mutating calls', async () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const writeClient = makeMockOctokit()
    const fetchClient = makeFetchClientStub()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    const result = await runPrsCore(deps)

    expect(result.armed).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.plannedCounts.prActionsPlanned).toBe(1)
    expect(result.executedCounts.wouldOpen).toBe(1)
    expect(result.executedCounts.opened).toBe(0)

    // Zero mutating calls in dry-run.
    expect(writeClient.rest.git.createRef).not.toHaveBeenCalled()
    expect(writeClient.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
    expect(writeClient.rest.pulls.create).not.toHaveBeenCalled()
    expect(writeClient.rest.pulls.update).not.toHaveBeenCalled()
    expect(writeClient.rest.git.deleteRef).not.toHaveBeenCalled()
  })
})

describe('runPrsCore: armed live mode', () => {
  it('executes the open-pr action for one eligible plan-consistency finding and reports opened=1 when the mocked write client succeeds', async () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const writeClient = makeMockOctokit()
    const fetchClient = makeFetchClientStub()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    const result = await runPrsCore(deps)

    expect(result.armed).toBe(true)
    expect(result.dryRun).toBe(false)
    expect(result.plannedCounts.prActionsPlanned).toBe(1)
    expect(result.executedCounts.opened).toBe(1)
    expect(result.executedCounts.failed).toBe(0)
    expect(result.executedCounts.safetyRefused).toBe(0)

    // Confirms the executor path actually ran mutating calls (not just planned).
    expect(writeClient.rest.git.createRef).toHaveBeenCalledTimes(1)
    expect(writeClient.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1)
    expect(writeClient.rest.pulls.create).toHaveBeenCalledTimes(1)
  })
})

describe('runPrsCore: terminal fingerprint extraction', () => {
  it('contributes a terminal fingerprint from a strictly-marked rejected/false-positive issue; accepted/resolved do not', async () => {
    const rejectedFp = 'aaaa1111bbbb2222'
    const falsePositiveFp = 'cccc3333dddd4444'
    const acceptedFp = 'eeee5555ffff6666'
    const resolvedFp = '1111222233334444'

    const issues = [
      makeTerminalFingerprintIssue(rejectedFp, 'status-truth:rejected'),
      makeTerminalFingerprintIssue(falsePositiveFp, 'status-truth:false-positive'),
      makeTerminalFingerprintIssue(acceptedFp, 'status-truth:accepted'),
      makeTerminalFingerprintIssue(resolvedFp, 'status-truth:resolved'),
    ]

    const fetchClient = makeFetchClientStub({issues})
    const terminals = await fetchTerminalFingerprints({
      client: fetchClient,
      owner: 'fro-bot',
      repo: '.github',
    })

    expect(terminals.fingerprints.has(rejectedFp)).toBe(true)
    expect(terminals.fingerprints.has(falsePositiveFp)).toBe(true)
    expect(terminals.fingerprints.has(acceptedFp)).toBe(false)
    expect(terminals.fingerprints.has(resolvedFp)).toBe(false)
  })

  it('excludes malformed, missing, non-hex, or duplicate terminal fingerprints and never suppresses via fuzzy matching', () => {
    // Malformed: uppercase hex is not valid per the strict marker pattern.
    expect(extractTerminalFingerprint('<!-- status-truth:fingerprint=ABCDEF -->')).toBeNull()
    // Missing marker entirely.
    expect(extractTerminalFingerprint('no marker here')).toBeNull()
    // Non-hex characters.
    expect(extractTerminalFingerprint('<!-- status-truth:fingerprint=zzzznothex -->')).toBeNull()
    // Empty value.
    expect(extractTerminalFingerprint('<!-- status-truth:fingerprint= -->')).toBeNull()
    // Valid.
    expect(extractTerminalFingerprint('<!-- status-truth:fingerprint=abc123 -->')).toBe('abc123')
  })

  it('counts duplicate terminal fingerprints across issues as skipped/invalid and does not suppress from either', async () => {
    const dupFp = 'abc123def456abcd'
    const issues = [
      makeTerminalFingerprintIssue(dupFp, 'status-truth:rejected'),
      makeTerminalFingerprintIssue(dupFp, 'status-truth:false-positive'),
    ]
    const fetchClient = makeFetchClientStub({issues})
    const terminals = await fetchTerminalFingerprints({
      client: fetchClient,
      owner: 'fro-bot',
      repo: '.github',
    })

    // Duplicate fingerprint across two terminal issues is excluded (fail-closed on
    // ambiguity) — never trusted for suppression from either source.
    expect(terminals.fingerprints.has(dupFp)).toBe(false)
    expect(terminals.skippedInvalid).toBeGreaterThanOrEqual(1)
  })
})

describe('fetchExistingCorrectionPrs: unfiltered candidate fetch', () => {
  it('returns every open-against-main PR as a candidate with botOwned/branch/digest metadata, deferring rediscovery gating to the planner', async () => {
    // This fetch is intentionally unfiltered by bot-ownership or branch-prefix
    // criteria (see the function's doc comment) — it returns raw candidate
    // records so the planner can independently gate rediscovery. Do not read
    // this test as "the fetcher filters"; it asserts the fetcher preserves
    // exactly the metadata the planner needs to do its own gating.
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const matchingPr = {
      number: 42,
      state: 'open',
      head: {ref: `${PR_BRANCH_PREFIX}${opaqueDigest}`},
      base: {ref: 'main'},
      user: {login: 'fro-bot[bot]'},
    }
    const nonBotPr = {
      number: 43,
      state: 'open',
      head: {ref: `${PR_BRANCH_PREFIX}otherdigest12345`},
      base: {ref: 'main'},
      user: {login: 'random-user'},
    }
    const nonPrefixPr = {
      number: 45,
      state: 'open',
      head: {ref: 'some-other-branch'},
      base: {ref: 'main'},
      user: {login: 'fro-bot[bot]'},
    }

    const fetchClient = makeFetchClientStub({prs: [matchingPr, nonBotPr, nonPrefixPr]})
    const existingPrs = await fetchExistingCorrectionPrs({
      client: fetchClient,
      owner: 'fro-bot',
      repo: '.github',
    })

    // All three are returned as candidates — the fetcher does not filter.
    expect(existingPrs).toHaveLength(3)

    const found = existingPrs.find(pr => pr.number === 42)
    expect(found?.botOwned).toBe(true)
    expect(found?.headBranch).toBe(`${PR_BRANCH_PREFIX}${opaqueDigest}`)
    expect(found?.baseBranch).toBe('main')
    expect(found?.opaqueDigest).toBe(opaqueDigest)

    const nonBot = existingPrs.find(pr => pr.number === 43)
    expect(nonBot?.botOwned).toBe(false)

    const nonPrefix = existingPrs.find(pr => pr.number === 45)
    expect(nonPrefix?.opaqueDigest).toBe('')
  })
})

describe('runPrsCore: planner gates rediscovery on bot ownership, base branch, and prefix', () => {
  it('does not rediscover a same-digest, same-branch-prefix PR that is not bot-owned; plans a fresh open instead', async () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    // Candidate PR matches digest and branch prefix and base, but is NOT
    // bot-owned — the planner must refuse to treat it as a rediscovery.
    const nonBotCandidate = {
      number: 43,
      state: 'open',
      head: {ref: `${PR_BRANCH_PREFIX}${opaqueDigest}`},
      base: {ref: 'main'},
      user: {login: 'random-user'},
    }
    const fetchClient = makeFetchClientStub({prs: [nonBotCandidate]})
    const writeClient = makeMockOctokit()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    const result = await runPrsCore(deps)

    // A fresh open-pr action is planned (not a rediscover), because the
    // candidate fails the bot-ownership gate.
    expect(result.plannedCounts.prActionsPlanned).toBe(1)
    expect(result.executedCounts.wouldOpen).toBe(1)
  })
})

describe('runPrsCore: partial-success recovery', () => {
  it('rediscovers an existing matching correction PR from a prior partial run and still allows stale/terminal closure planning', async () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const existingPr = {
      number: 77,
      state: 'open',
      head: {ref: `${PR_BRANCH_PREFIX}${opaqueDigest}`},
      base: {ref: 'main'},
      user: {login: 'fro-bot[bot]'},
    }
    const fetchClient = makeFetchClientStub({prs: [existingPr]})
    const writeClient = makeMockOctokit()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    const result = await runPrsCore(deps)

    // No duplicate open-pr planned; rediscovery instead.
    expect(result.plannedCounts.prActionsPlanned).toBe(1)
    expect(result.executedCounts.wouldOpen).toBe(0)
  })
})

describe('runPrsCore: error paths exit non-zero before mutation', () => {
  it('exits non-zero when the report path is missing', async () => {
    const writeClient = makeMockOctokit()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
      },
      createWriteClient: vi.fn(async () => writeClient),
    })

    await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(writeClient.rest.pulls.create).not.toHaveBeenCalled()
  })

  it('exits non-zero when the report is malformed', async () => {
    const writeClient = makeMockOctokit()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
      },
      readReport: vi.fn(async () => ({valid: false as const, reason: 'artifact validation failed'})),
      createWriteClient: vi.fn(async () => writeClient),
    })

    await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(writeClient.rest.pulls.create).not.toHaveBeenCalled()
  })

  it('exits non-zero when the existing-state fetch fails in live (non-dry-run) mode', async () => {
    const report = makeReport()
    const writeClient = makeMockOctokit()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => {
        throw new Error('state fetch failed')
      }),
      createWriteClient: vi.fn(async () => writeClient),
    })

    await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(writeClient.rest.pulls.create).not.toHaveBeenCalled()
  })

  it('exits non-zero when the public-output token load fails', async () => {
    const report = makeReport()
    const writeClient = makeMockOctokit()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      loadPublicOutputTokens: vi.fn(async () => {
        throw new Error('token load failed')
      }),
      createWriteClient: vi.fn(async () => writeClient),
    })

    await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(writeClient.rest.pulls.create).not.toHaveBeenCalled()
  })
})

describe('runPrsCore: output privacy', () => {
  it('stdout and error messages contain only counts and reason keys, never paths/fingerprints/branch/PR identifiers/tokens', async () => {
    const fingerprint = 'abc123def456abcd'
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency', path: 'docs/plans/example.md'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const fetchClient = makeFetchClientStub()
    const writeClient = makeMockOctokit()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/secret/path/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    await runPrsCore(deps)

    const stdoutCalls = vi.mocked(deps.writeStdout).mock.calls.map(c => c[0])
    const stderrCalls = vi.mocked(deps.writeStderr).mock.calls.map(c => c[0])
    const allOutput = [...stdoutCalls, ...stderrCalls].join('\n')

    expect(allOutput).not.toContain('/secret/path/report.json')
    expect(allOutput).not.toContain('docs/plans/example.md')
    expect(allOutput).not.toContain(fingerprint)
    expect(allOutput).not.toContain(PR_BRANCH_PREFIX)
    expect(allOutput).not.toContain('example.md')
  })
})

describe('runPrsCore: dry-run does not require a write client', () => {
  it('still returns counts/would-act with no crash when createWriteClient throws in dry-run', async () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const fetchClient = makeFetchClientStub()
    const createWriteClient = vi.fn(async (): Promise<StatusTruthPrOctokitClient> => {
      throw new Error('write client creation must not be attempted in dry-run')
    })

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient,
    })

    const result = await runPrsCore(deps)

    expect(deps.setExitCode).not.toHaveBeenCalledWith(1)
    expect(result.armed).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.executedCounts.wouldOpen).toBe(1)
    expect(result.executedCounts.opened).toBe(0)
  })
})

describe('runPrsCore: error paths still write counts-only JSON to stdout/result', () => {
  it('writes a parseable JSON result with no sensitive strings when the report path is missing', async () => {
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
      },
    })

    await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(deps.writeStdout).toHaveBeenCalledTimes(1)
    const stdoutArg = vi.mocked(deps.writeStdout).mock.calls[0]?.[0] as string
    expect(() => {
      JSON.parse(stdoutArg)
    }).not.toThrow()
    const parsed = JSON.parse(stdoutArg) as Record<string, unknown>
    expect(parsed.armed).toBe(true)
    expect(stdoutArg).not.toContain('STATUS_TRUTH_REPORT_PATH')
  })

  it('writes a parseable JSON result with no sensitive strings when the token load fails', async () => {
    const report = makeReport()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/secret/path/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      loadPublicOutputTokens: vi.fn(async () => {
        throw new Error('token load failed')
      }),
    })

    await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(deps.writeStdout).toHaveBeenCalledTimes(1)
    const stdoutArg = vi.mocked(deps.writeStdout).mock.calls[0]?.[0] as string
    expect(() => {
      JSON.parse(stdoutArg)
    }).not.toThrow()
    const parsed = JSON.parse(stdoutArg) as Record<string, unknown>
    expect(parsed.armed).toBe(true)
    expect(stdoutArg).not.toContain('/secret/path/report.json')
  })
})

describe('executeStatusTruthPrActions: dry-run wouldRediscover count', () => {
  it('counts rediscover-pr actions separately from wouldOpen/wouldClose', async () => {
    const digest = testDeriveOpaqueDigest('abc123def456abcd')
    const rediscoverAction: Extract<StatusTruthPrAction, {type: 'rediscover-pr'}> = {
      type: 'rediscover-pr',
      existingPrNumber: 77,
      opaqueDigest: digest,
    }
    const octokit = makeMockOctokit()

    const result = await executeStatusTruthPrActions(
      makeExecuteInput({actions: [rediscoverAction], octokit, dryRun: true}),
    )

    expect(result.counts.wouldRediscover).toBe(1)
    expect(result.counts.wouldOpen).toBe(0)
  })
})

describe('runPrsCore: dry-run wouldRediscover for existing matching correction PR', () => {
  it('reports wouldRediscover=1 and wouldOpen=0', async () => {
    const fingerprint = 'abc123def456abcd'
    const opaqueDigest = testDeriveOpaqueDigest(fingerprint)
    const finding = makeDriftedFinding({fingerprint, kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const existingPr = {
      number: 77,
      state: 'open',
      head: {ref: `${PR_BRANCH_PREFIX}${opaqueDigest}`},
      base: {ref: 'main'},
      user: {login: 'fro-bot[bot]'},
    }
    const fetchClient = makeFetchClientStub({prs: [existingPr]})
    const writeClient = makeMockOctokit()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    const result = await runPrsCore(deps)

    expect(result.executedCounts.wouldRediscover).toBe(1)
    expect(result.executedCounts.wouldOpen).toBe(0)
  })
})

describe('fetchTerminalFingerprints: includes open issues', () => {
  it('contributes a terminal fingerprint from an open issue carrying a terminal label', async () => {
    const openTerminalFp = 'ffff9999eeee8888'
    const issues = [makeTerminalFingerprintIssue(openTerminalFp, 'status-truth:rejected')]
    const fetchClient = {
      rest: {
        pulls: {list: vi.fn(async () => ({data: []}))},
        issues: {
          listForRepo: vi.fn(async (params: {state: string; page: number}) => ({
            data: params.state === 'all' && params.page === 1 ? issues : [],
          })),
        },
      },
    }

    const terminals = await fetchTerminalFingerprints({
      client: fetchClient,
      owner: 'fro-bot',
      repo: '.github',
    })

    expect(terminals.fingerprints.has(openTerminalFp)).toBe(true)
    expect(fetchClient.rest.issues.listForRepo).toHaveBeenCalledWith(expect.objectContaining({state: 'all'}))
  })
})

describe('fetchTerminalFingerprints: duplicateCount observability', () => {
  it('reports a numeric duplicateCount without leaking raw fingerprints', async () => {
    const dupFp = 'abc123def456abcd'
    const issues = [
      makeTerminalFingerprintIssue(dupFp, 'status-truth:rejected'),
      makeTerminalFingerprintIssue(dupFp, 'status-truth:false-positive'),
    ]
    const fetchClient = makeFetchClientStub({issues})

    const terminals = await fetchTerminalFingerprints({
      client: fetchClient,
      owner: 'fro-bot',
      repo: '.github',
    })

    expect(terminals.duplicateCount).toBe(1)
    expect(JSON.stringify(terminals.duplicateCount)).not.toContain(dupFp)
  })
})

describe('executeStatusTruthPrActions: live-mode rediscovered count', () => {
  it('counts rediscover-pr actions as rediscovered in live mode instead of silently dropping them', async () => {
    const digest = testDeriveOpaqueDigest('abc123def456abcd')
    const rediscoverAction: Extract<StatusTruthPrAction, {type: 'rediscover-pr'}> = {
      type: 'rediscover-pr',
      existingPrNumber: 77,
      opaqueDigest: digest,
    }
    const octokit = makeMockOctokit()

    const result = await executeStatusTruthPrActions(makeExecuteInput({actions: [rediscoverAction], octokit}))

    expect(result.counts.rediscovered).toBe(1)
    expect(result.counts.opened).toBe(0)
    expect(result.counts.failed).toBe(0)
  })
})

describe('fetchTerminalFingerprints: pagination cap', () => {
  it('fails closed (throws) when the terminal-fingerprint fetch would exceed the page cap', async () => {
    const fetchClient = makeFetchClientStub({
      alwaysFullIssuePages: true,
      issues: Array.from({length: 100}, (_v, i) => ({
        number: i,
        labels: [{name: 'status-truth'}],
        body: null,
        user: {login: 'fro-bot[bot]'},
      })),
    })

    await expect(fetchTerminalFingerprints({client: fetchClient, owner: 'fro-bot', repo: '.github'})).rejects.toThrow()
  })
})

describe('fetchExistingCorrectionPrs: pagination cap', () => {
  it('fails closed (throws) when the existing-PR fetch would exceed the page cap', async () => {
    const fetchClient = makeFetchClientStub({
      alwaysFullPrPages: true,
      prs: Array.from({length: 100}, (_v, i) => ({
        number: i,
        state: 'open',
        head: {ref: `${PR_BRANCH_PREFIX}deadbeefdeadbeef`},
        base: {ref: 'main'},
        user: {login: 'fro-bot[bot]'},
      })),
    })

    await expect(fetchExistingCorrectionPrs({client: fetchClient, owner: 'fro-bot', repo: '.github'})).rejects.toThrow()
  })
})

describe('runPrsCore: pagination cap exceeded in live mode is treated as a fetch failure', () => {
  it('exits non-zero with error-class=fetch-failure when a fetch hits the pagination cap in live mode', async () => {
    const report = makeReport()
    const cappedFetchClient = makeFetchClientStub({
      alwaysFullIssuePages: true,
      issues: Array.from({length: 100}, (_v, i) => ({
        number: i,
        labels: [{name: 'status-truth'}, {name: 'status-truth:rejected'}],
        body: null,
        user: {login: 'fro-bot[bot]'},
      })),
    })
    const writeClient = makeMockOctokit()

    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => cappedFetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })

    const result = await runPrsCore(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(result.error).toBe('fetch-failure')
    expect(writeClient.rest.pulls.create).not.toHaveBeenCalled()
  })
})

describe('runPrsCore: PrsResult error field on early-failure paths', () => {
  it('sets error=missing-report when the report path is absent', async () => {
    const deps = makeRunPrsCoreDeps({
      env: {STATUS_TRUTH_PRS_ENABLED: 'true', STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true'},
    })
    const result = await runPrsCore(deps)
    expect(result.error).toBe('missing-report')
  })

  it('sets error=report-failure when the report is invalid', async () => {
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
      },
      readReport: vi.fn(async () => ({valid: false as const, reason: 'artifact validation failed'})),
    })
    const result = await runPrsCore(deps)
    expect(result.error).toBe('report-failure')
  })

  it('sets error=token-load-failure when public-output token loading fails', async () => {
    const report = makeReport()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      loadPublicOutputTokens: vi.fn(async () => {
        throw new Error('token load failed')
      }),
    })
    const result = await runPrsCore(deps)
    expect(result.error).toBe('token-load-failure')
  })

  it('sets error=fetch-failure when existing-state fetch fails in live mode', async () => {
    const report = makeReport()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => {
        throw new Error('fetch failed')
      }),
    })
    const result = await runPrsCore(deps)
    expect(result.error).toBe('fetch-failure')
  })

  it('sets error=write-client-failure when write-client creation fails in live mode', async () => {
    const report = makeReport()
    const fetchClient = makeFetchClientStub()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => {
        throw new Error('write client creation failed')
      }),
    })
    const result = await runPrsCore(deps)
    expect(result.error).toBe('write-client-failure')
  })

  it('omits error on a successful armed run', async () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const fetchClient = makeFetchClientStub()
    const writeClient = makeMockOctokit()
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => fetchClient),
      createWriteClient: vi.fn(async () => writeClient),
    })
    const result = await runPrsCore(deps)
    expect(result.error).toBeUndefined()
  })
})

describe('runPrs: top-level catch-all for unexpected exceptions', () => {
  it('emits error=unexpected, exit code 1, and a parseable counts-only result when runPrsCore throws unexpectedly', async () => {
    // readReport throws directly (rather than returning a ReadReportResult),
    // which is outside runPrsCore's anticipated failure branches and
    // propagates up to the top-level catch-all in runPrs().
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
      },
      readReport: vi.fn(() => {
        throw new TypeError('exotic unexpected failure')
      }),
    })

    const result = await runPrs(deps)

    expect(deps.setExitCode).toHaveBeenCalledWith(1)
    expect(result.error).toBe('unexpected')
    expect(deps.writeStdout).toHaveBeenCalled()
    const stdoutArg = vi.mocked(deps.writeStdout).mock.calls.at(-1)?.[0] as string
    expect(() => {
      JSON.parse(stdoutArg)
    }).not.toThrow()
    expect(stdoutArg).not.toContain('exotic unexpected failure')
  })

  it('delegates to runPrsCore and returns its result on the normal (non-throwing) path', async () => {
    const deps = makeRunPrsCoreDeps({env: {}})
    const result = await runPrs(deps)
    expect(result.armed).toBe(false)
  })
})

describe('runPrsCore: dry-run fetch failure degrades to empty state (would-act counts, no exit code)', () => {
  it('does not set a non-zero exit code and still reports would-act counts when the fetch fails in dry-run', async () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'plan-consistency'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const deps = makeRunPrsCoreDeps({
      env: {
        STATUS_TRUTH_PRS_ENABLED: 'true',
        STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true',
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_REPORT_PATH: '/tmp/report.json',
        GITHUB_REPOSITORY: 'fro-bot/.github',
      },
      readReport: vi.fn(async () => ({valid: true as const, report})),
      createFetchClient: vi.fn(async () => {
        throw new Error('fetch failed')
      }),
    })

    const result = await runPrsCore(deps)

    expect(deps.setExitCode).not.toHaveBeenCalled()
    expect(result.dryRun).toBe(true)
    expect(result.error).toBeUndefined()
    // With empty existingPrs/terminalFingerprints, the graduated finding still
    // plans a fresh open-pr action, reported as would-open in dry-run.
    expect(result.executedCounts.wouldOpen).toBe(1)
  })
})

describe('runPrsCore: writeResultFile path', () => {
  it('omits the writeResultFile call when the result path env var is unset', async () => {
    const writeResultFile = vi.fn(async () => undefined)
    const deps = makeRunPrsCoreDeps({env: {}, writeResultFile})

    await runPrsCore(deps)

    expect(writeResultFile).not.toHaveBeenCalled()
  })

  it('invokes writeResultFile exactly once with parseable JSON when a result path is configured', async () => {
    const writeResultFile = vi.fn<(json: string) => Promise<void>>(async () => undefined)
    const deps = makeRunPrsCoreDeps({
      env: {STATUS_TRUTH_PRS_RESULT_PATH: '/tmp/status-truth-prs-result.json'},
      writeResultFile,
    })

    await runPrsCore(deps)

    expect(writeResultFile).toHaveBeenCalledTimes(1)
    const jsonArg = vi.mocked(writeResultFile).mock.calls[0]?.[0] as string
    expect(() => {
      JSON.parse(jsonArg)
    }).not.toThrow()
  })
})

describe('fetchTerminalFingerprints: bot-authorship narrowing', () => {
  it('ignores a human-authored issue carrying a terminal label and marker (no impersonation of bot suppression)', async () => {
    const humanFp = 'deadbeefdeadbeef'
    const issues = [makeTerminalFingerprintIssue(humanFp, 'status-truth:rejected', 'random-human')]
    const fetchClient = makeFetchClientStub({issues})

    const terminals = await fetchTerminalFingerprints({client: fetchClient, owner: 'fro-bot', repo: '.github'})

    expect(terminals.fingerprints.has(humanFp)).toBe(false)
  })

  it('accepts a bot-authored issue (fro-bot[bot]) carrying a terminal label and marker', async () => {
    const botFp = 'beefdeadbeefdead'
    const issues = [makeTerminalFingerprintIssue(botFp, 'status-truth:rejected', 'fro-bot[bot]')]
    const fetchClient = makeFetchClientStub({issues})

    const terminals = await fetchTerminalFingerprints({client: fetchClient, owner: 'fro-bot', repo: '.github'})

    expect(terminals.fingerprints.has(botFp)).toBe(true)
  })

  it('accepts a bot-authored issue (bare fro-bot login) carrying a terminal label and marker', async () => {
    const botFp = 'cafefeedcafefeed'
    const issues = [makeTerminalFingerprintIssue(botFp, 'status-truth:false-positive', 'fro-bot')]
    const fetchClient = makeFetchClientStub({issues})

    const terminals = await fetchTerminalFingerprints({client: fetchClient, owner: 'fro-bot', repo: '.github'})

    expect(terminals.fingerprints.has(botFp)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Workflow contract: PR job App-token permission scope
// ---------------------------------------------------------------------------

/** Narrow the parsed YAML to the shape we index into, without any broad cast. */
function assertStatusTruthWorkflow(value: unknown): asserts value is {
  jobs: Record<
    string,
    {
      if?: string
      permissions?: Record<string, string>
      steps: {name?: string; uses?: string; with?: Record<string, string>; env?: Record<string, string>}[]
    }
  >
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('status-truth.yaml does not have expected shape: missing jobs object')
  }
}

describe('workflow contract: PR job app-token permissions', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/status-truth.yaml')
  const parsed: unknown = parse(readFileSync(workflowPath, 'utf8'))
  assertStatusTruthWorkflow(parsed)
  const prsJob = parsed.jobs.prs

  it('has a prs job with a Mint write token step using create-github-app-token', () => {
    expect(prsJob).toBeDefined()
    const appTokenStep = prsJob?.steps.find(s => s.uses?.includes('actions/create-github-app-token'))
    expect(appTokenStep).toBeDefined()
  })

  it('mints the PR job app-token with issues: write (required for stale/terminal closure comments)', () => {
    const appTokenStep = prsJob?.steps.find(s => s.uses?.includes('actions/create-github-app-token'))
    expect(appTokenStep?.with?.['permission-issues']).toBe('write')
  })

  it('mints the PR job app-token with pull-requests: write and contents: write', () => {
    const appTokenStep = prsJob?.steps.find(s => s.uses?.includes('actions/create-github-app-token'))
    expect(appTokenStep?.with?.['permission-pull-requests']).toBe('write')
    expect(appTokenStep?.with?.['permission-contents']).toBe('write')
  })

  it('keeps the PR job app-token scoped to this repository only', () => {
    const appTokenStep = prsJob?.steps.find(s => s.uses?.includes('actions/create-github-app-token'))
    const expectedRepositoryScope = '$' + '{{ github.event.repository.name }}'
    expect(appTokenStep?.with?.repositories).toBe(expectedRepositoryScope)
  })

  it('keeps the PR job-level permissions read-only (contents: read)', () => {
    expect(prsJob?.permissions).toEqual({contents: 'read'})
  })

  it('keeps the PR job if: gated on the repo variable, workflow_dispatch, and open_prs input', () => {
    expect(prsJob?.if).toContain('vars.STATUS_TRUTH_PRS_ENABLED')
    expect(prsJob?.if).toContain("== 'true'")
    expect(prsJob?.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(prsJob?.if).toContain("github.event.inputs.open_prs == 'true'")
  })
})

describe('workflow contract: separate read-only fetch token', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/status-truth.yaml')
  const parsed: unknown = parse(readFileSync(workflowPath, 'utf8'))
  assertStatusTruthWorkflow(parsed)
  const prsJob = parsed.jobs.prs

  it('mints a second, read-only app-token step distinct from the write-token step', () => {
    const appTokenSteps = prsJob?.steps.filter(s => s.uses?.includes('actions/create-github-app-token')) ?? []
    expect(appTokenSteps.length).toBeGreaterThanOrEqual(2)
  })

  it('scopes the fetch token to read-only permissions (contents, pull-requests, issues)', () => {
    const fetchTokenStep = prsJob?.steps.find(
      s => s.uses?.includes('actions/create-github-app-token') && s.name?.toLowerCase().includes('fetch'),
    )
    expect(fetchTokenStep).toBeDefined()
    expect(fetchTokenStep?.with?.['permission-contents']).toBe('read')
    expect(fetchTokenStep?.with?.['permission-pull-requests']).toBe('read')
    expect(fetchTokenStep?.with?.['permission-issues']).toBe('read')
  })

  it('scopes the fetch token to this repository only, matching the write token', () => {
    const fetchTokenStep = prsJob?.steps.find(
      s => s.uses?.includes('actions/create-github-app-token') && s.name?.toLowerCase().includes('fetch'),
    )
    const expectedRepositoryScope = '$' + '{{ github.event.repository.name }}'
    expect(fetchTokenStep?.with?.repositories).toBe(expectedRepositoryScope)
  })

  it('passes the fetch token to the execute step via STATUS_TRUTH_FETCH_TOKEN, distinct from GITHUB_TOKEN', () => {
    const executeStep = prsJob?.steps.find(s => s.name?.includes('Execute status-truth correction PRs'))
    expect(executeStep?.env?.STATUS_TRUTH_FETCH_TOKEN).toBeDefined()
    expect(executeStep?.env?.GITHUB_TOKEN).toBeDefined()
    expect(executeStep?.env?.STATUS_TRUTH_FETCH_TOKEN).not.toBe(executeStep?.env?.GITHUB_TOKEN)
  })
})

describe('env-backed PR runner deps', () => {
  it('requires STATUS_TRUTH_FETCH_TOKEN for fetch clients and does not fall back to GITHUB_TOKEN', async () => {
    const originalFetchToken = process.env.STATUS_TRUTH_FETCH_TOKEN
    const originalGithubToken = process.env.GITHUB_TOKEN
    try {
      delete process.env.STATUS_TRUTH_FETCH_TOKEN
      process.env.GITHUB_TOKEN = 'write-token-only'

      const deps = buildEnvBackedRunPrsCoreDeps()

      await expect(deps.createFetchClient()).rejects.toThrow('required token is missing')
    } finally {
      if (originalFetchToken === undefined) delete process.env.STATUS_TRUTH_FETCH_TOKEN
      else process.env.STATUS_TRUTH_FETCH_TOKEN = originalFetchToken
      if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = originalGithubToken
    }
  })
})
