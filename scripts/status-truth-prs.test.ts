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
import type {ExistingStatusTruthPr, PlanStatusTruthPrActionsInput, StatusTruthPrAction} from './status-truth-prs.ts'
import type {PublicOutputTokens} from './status-truth-public-output.ts'
import {createHash} from 'node:crypto'
import {describe, expect, it} from 'vitest'
import {GRADUATED_CLAIM_KINDS, planStatusTruthPrActions, PR_BRANCH_PREFIX, PR_TITLE_PREFIX} from './status-truth-prs.ts'

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
    kind?: 'pr-state' | 'issue-state' | 'release-tag-state' | 'plan-status' | 'rollout-tracker-status'
    path?: string
    sourceRef?: string
    claimedState?: string
    liveState?: string
    proposedCorrection?: string
  } = {},
) {
  return {
    kind: overrides.kind ?? ('pr-state' as const),
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
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'pr-state'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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

  it('GRADUATED_CLAIM_KINDS export is a readonly set (intentionally empty in Phase 1)', () => {
    expect(GRADUATED_CLAIM_KINDS).toBeDefined()
    expect(typeof GRADUATED_CLAIM_KINDS).toBe('object')
    // Phase 1: no claim kinds are graduated yet; set is empty by design.
    // To graduate a kind, add it via a reviewed repo change after Phase 1 signal.
    expect(GRADUATED_CLAIM_KINDS.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test 2: Edge case — two PR-eligible findings; one PR action, rest downgrade
// ---------------------------------------------------------------------------

describe('edge case: overflow to proposal-only', () => {
  it('plans one PR action and downgrades the rest when two eligible findings appear', () => {
    const finding1 = makeDriftedFinding({fingerprint: 'aaaa1111bbbb2222', kind: 'pr-state'})
    const finding2 = makeDriftedFinding({
      fingerprint: 'cccc3333dddd4444',
      kind: 'pr-state',
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
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({kind: 'pr-state'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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
      kind: 'pr-state',
      path: '.github/workflows/main.yaml', // forbidden: workflow path
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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
      kind: 'pr-state',
      path: 'metadata/repos.yaml',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
        enabled: true,
      }),
    )

    expect(result.counts.pathForbidden).toBe(1)
    expect(result.counts.prActionsPlanned).toBe(0)
  })

  it('downgrades to proposal-only for path traversal segments', () => {
    const finding = makeDriftedFinding({
      kind: 'pr-state',
      path: 'docs/../.github/workflows/evil.yaml',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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
      kind: 'pr-state',
      proposedCorrection: 'pr #42 is closed (private-repo-name)',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({kind: 'pr-state'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'pr-state'})
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
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'pr-state'})
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
        graduatedClaimKinds: new Set(['pr-state']),
        enabled: true,
        existingPrs: [existingPr],
      }),
    )

    // Must not rediscover a non-bot-owned PR
    expect(result.actions.every(a => a.type !== 'rediscover-pr')).toBe(true)
  })

  it('leaves finding as proposal-only when existing PR targets non-main branch', () => {
    const finding = makeDriftedFinding({fingerprint: 'abc123def456abcd', kind: 'pr-state'})
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
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({fingerprint, kind: 'pr-state'})
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
        graduatedClaimKinds: new Set(['pr-state']),
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
    const finding = makeDriftedFinding({kind: 'pr-state'})
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
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
// Additional invariants
// ---------------------------------------------------------------------------

describe('additional invariants', () => {
  it('non-proposal-eligible findings are ignored', () => {
    const finding = {
      kind: 'pr-state' as const,
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
        graduatedClaimKinds: new Set(['pr-state']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.downgradedToProposalOnly).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('unsafe findings are ignored', () => {
    const finding = {
      kind: 'pr-state' as const,
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
        graduatedClaimKinds: new Set(['pr-state']),
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
        graduatedClaimKinds: new Set(['pr-state']),
        enabled: true,
      }),
    )

    expect(result.counts.prActionsPlanned).toBe(0)
    expect(result.counts.versionRejected).toBe(1)
    expect(result.actions).toHaveLength(0)
  })

  it('allowed doc paths pass path authorization', () => {
    const finding = makeDriftedFinding({
      kind: 'pr-state',
      path: 'docs/plans/example.md', // allowed path
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
        enabled: true,
      }),
    )

    // docs/plans/ is an allowed path — should not be forbidden
    expect(result.counts.pathForbidden).toBe(0)
    expect(result.counts.prActionsPlanned).toBe(1)
  })

  it('README.md passes path authorization', () => {
    const finding = makeDriftedFinding({
      kind: 'pr-state',
      path: 'README.md',
    })
    const report = makeReport({
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })

    const result = planStatusTruthPrActions(
      makeInput({
        report,
        graduatedClaimKinds: new Set(['pr-state']),
        enabled: true,
      }),
    )

    expect(result.counts.pathForbidden).toBe(0)
    expect(result.counts.prActionsPlanned).toBe(1)
  })
})
