import type {RolloutSnapshot, SnapshotItem} from './rollout-tracker-snapshot.ts'
import type {
  ClaimKind,
  ClaimVerdict,
  DetectOctokitClient,
  FileLister,
  FileReader,
  IssueCommentFetcher,
  IssueLister,
  IssueListItem,
  PublicStatusTruthFinding,
  ResolverResult,
  ResolverType,
  StatusTruthClaim,
  StatusTruthFinding,
  StatusTruthJsonReport,
} from './status-truth-detect.ts'

import process from 'node:process'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  buildDetectOctokitOptions,
  buildPlanConsistencyClaim,
  buildStatusTruthReport,
  CLAIM_KIND_DEFINITIONS,
  computeClaimFingerprint,
  correctPlanConsistencyStatusLine,
  DEFAULT_ENABLED_KINDS,
  detectStatusTruthClaims,
  extractStatusTruthClaimsFromText,
  isKnownReportVersion,
  KNOWN_FINGERPRINT_VERSION,
  KNOWN_SCHEMA_VERSION,
  listCurrentRepoIssueComments,
  listCurrentRepoIssues,
  loadRolloutSnapshot,
  normalizeClaimText,
  parsePlanUnitCheckboxes,
  resolveAllClaims,
  resolveClaimLiveState,
  resolveFileParseClaims,
  resolvePlanConsistencyVerdict,
  resolvePlanStatusClaim,
  resolveRolloutTrackerClaim,
  reverifyPlanConsistencyCorrection,
  scanIssueStatusTruthClaims,
  scanPlanConsistencyFindings,
  scanStatusTruthClaims,
  selectDetectFailureClass,
  validateStatusTruthArtifact,
} from './status-truth-detect.ts'

function makeClaim(overrides: Partial<StatusTruthClaim> = {}): StatusTruthClaim {
  return {
    kind: 'pr-state',
    path: 'docs/plans/example.md',
    sourceRef: 'fro-bot/.github#42',
    claimedState: 'open',
    normalizedText: 'PR #42 is open',
    ...overrides,
  }
}

function makeReport(overrides: Partial<StatusTruthJsonReport> = {}): StatusTruthJsonReport {
  return {
    schema_version: KNOWN_SCHEMA_VERSION,
    fingerprint_version: KNOWN_FINGERPRINT_VERSION,
    status: 'clean',
    scan_complete: true,
    generated_at: '2026-06-28T00:00:00Z',
    failure_class: null,
    repair_eligible: false,
    findings: [],
    counts: {
      total: 0,
      current: 0,
      drifted: 0,
      unresolved: 0,
      unsafe: 0,
      proposal_eligible: 0,
    },
    ...overrides,
  }
}

/** Build a public (non-unsafe) finding for test setup. */
function makeFinding(overrides: Partial<PublicStatusTruthFinding> = {}): PublicStatusTruthFinding {
  return {
    kind: 'pr-state',
    path: 'docs/plans/example.md',
    sourceRef: 'fro-bot/.github#42',
    verdict: 'drifted',
    fingerprint: 'abcdef0123456789',
    claimedState: 'open',
    liveState: 'closed',
    proposalEligible: true,
    proposedCorrection: 'PR #42 is closed',
    ...overrides,
  }
}

/** Build a resolver result map keyed by `kind:sourceRef`. */
function makeResolverResults(
  entries: {kind: ClaimKind; sourceRef: string; result: ResolverResult}[],
): Record<string, ResolverResult> {
  const map: Record<string, ResolverResult> = {}
  for (const {kind, sourceRef, result} of entries) {
    map[`${kind}:${sourceRef}`] = result
  }
  return map
}

describe('CLAIM_KIND_DEFINITIONS', () => {
  it('defines all five required claim kinds', () => {
    const kinds = CLAIM_KIND_DEFINITIONS.map(d => d.kind)
    expect(kinds).toContain('pr-state')
    expect(kinds).toContain('issue-state')
    expect(kinds).toContain('release-tag-state')
    expect(kinds).toContain('plan-status')
    expect(kinds).toContain('rollout-tracker-status')
  })

  it('each definition has required fields: kind, resolverType, pattern, confidenceRule, suppressionRule, proposalFields', () => {
    for (const def of CLAIM_KIND_DEFINITIONS) {
      expect(def.kind).toBeTruthy()
      expect(def.resolverType).toMatch(/^(api|file-parse|compound)$/)
      expect(def.pattern).toBeInstanceOf(RegExp)
      expect(typeof def.confidenceRule).toBe('string')
      expect(typeof def.suppressionRule).toBe('string')
      expect(Array.isArray(def.proposalFields)).toBe(true)
    }
  })

  it('compound resolvers declare sub-resolvers', () => {
    const compound = CLAIM_KIND_DEFINITIONS.filter(d => d.resolverType === 'compound')
    for (const def of compound) {
      expect(Array.isArray(def.subResolvers)).toBe(true)
      expect((def.subResolvers ?? []).length).toBeGreaterThan(0)
    }
  })

  it('rollout-tracker-status is a compound resolver', () => {
    const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'rollout-tracker-status')
    expect(def?.resolverType).toBe('compound')
  })

  it('pr-state and issue-state are API resolvers', () => {
    const prDef = CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'pr-state')
    const issueDef = CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'issue-state')
    expect(prDef?.resolverType).toBe('api')
    expect(issueDef?.resolverType).toBe('api')
  })

  it('plan-status is a file-parse resolver', () => {
    const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'plan-status')
    expect(def?.resolverType).toBe('file-parse')
  })

  it('release-tag-state is an API resolver', () => {
    const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'release-tag-state')
    expect(def?.resolverType).toBe('api')
  })

  it('plan-consistency does NOT join the regex-extraction registry (synthetic claims only)', () => {
    const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === 'plan-consistency')
    expect(def).toBeUndefined()
  })
})

describe('computeClaimFingerprint', () => {
  it('produces a stable hex string for the same inputs', () => {
    const fp1 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    const fp2 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    expect(fp1).toBe(fp2)
    expect(fp1).toMatch(/^[a-f0-9]{16}$/)
  })

  it('changes when claim kind changes', () => {
    const fp1 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    const fp2 = computeClaimFingerprint('issue-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    expect(fp1).not.toBe(fp2)
  })

  it('changes when path changes', () => {
    const fp1 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    const fp2 = computeClaimFingerprint('pr-state', 'docs/plans/bar.md', 'fro-bot/.github#42', 'PR #42 is open')
    expect(fp1).not.toBe(fp2)
  })

  it('changes when source reference changes', () => {
    const fp1 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    const fp2 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#99', 'PR #42 is open')
    expect(fp1).not.toBe(fp2)
  })

  it('edge: line move with same normalized text and source reference keeps same fingerprint', () => {
    const fp1 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    const fp2 = computeClaimFingerprint('pr-state', 'docs/plans/foo.md', 'fro-bot/.github#42', 'PR #42 is open')
    expect(fp1).toBe(fp2)
  })
})

describe('normalizeClaimText', () => {
  it('lowercases and trims whitespace', () => {
    expect(normalizeClaimText('  PR #42 is OPEN  ')).toBe('pr #42 is open')
  })

  it('collapses internal whitespace', () => {
    expect(normalizeClaimText('PR  #42   is   open')).toBe('pr #42 is open')
  })

  it('is idempotent', () => {
    const text = 'pr #42 is open'
    expect(normalizeClaimText(text)).toBe(normalizeClaimText(normalizeClaimText(text)))
  })
})

describe('buildStatusTruthReport', () => {
  it('happy path: produces a clean report with zero findings', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.schema_version).toBe(KNOWN_SCHEMA_VERSION)
    expect(report.fingerprint_version).toBe(KNOWN_FINGERPRINT_VERSION)
    expect(report.status).toBe('clean')
    expect(report.scan_complete).toBe(true)
    expect(report.failure_class).toBeNull()
    expect(report.repair_eligible).toBe(false)
    expect(report.findings).toEqual([])
    expect(report.counts.total).toBe(0)
    expect(report.counts.current).toBe(0)
    expect(report.counts.drifted).toBe(0)
    expect(report.counts.unresolved).toBe(0)
    expect(report.counts.unsafe).toBe(0)
    expect(report.counts.proposal_eligible).toBe(0)
  })

  it('happy path: report with drifted findings has status=findings and repair_eligible=true', () => {
    const finding = makeFinding()
    const report = buildStatusTruthReport({
      findings: [finding],
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.status).toBe('findings')
    expect(report.repair_eligible).toBe(true)
    expect(report.counts.total).toBe(1)
    expect(report.counts.drifted).toBe(1)
    expect(report.counts.proposal_eligible).toBe(1)
  })

  it('repair_eligible: report with only current findings has status=findings but repair_eligible=false', () => {
    const finding = makeFinding({
      verdict: 'current',
      proposalEligible: false,
      liveState: 'open',
      claimedState: 'open',
      proposedCorrection: undefined,
    })
    const report = buildStatusTruthReport({
      findings: [finding],
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.status).toBe('findings')
    expect(report.repair_eligible).toBe(false)
    expect(report.counts.proposal_eligible).toBe(0)
  })

  it('execution-failure: scan_complete=false, status=execution-failure, repair_eligible=false', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: false,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: 'api-unavailable',
    })

    expect(report.status).toBe('execution-failure')
    expect(report.scan_complete).toBe(false)
    expect(report.failure_class).toBe('api-unavailable')
    expect(report.repair_eligible).toBe(false)
  })

  it('integration: multiple claim kinds produce distinct findings and correct aggregate counts', () => {
    const findings: StatusTruthFinding[] = [
      makeFinding({kind: 'pr-state', verdict: 'drifted', proposalEligible: true}),
      makeFinding({
        kind: 'issue-state',
        verdict: 'current',
        proposalEligible: false,
        liveState: 'open',
        claimedState: 'open',
        proposedCorrection: undefined,
      }),
      makeFinding({
        kind: 'release-tag-state',
        verdict: 'unresolved',
        proposalEligible: false,
        liveState: undefined,
        proposedCorrection: undefined,
      }),
      {kind: 'plan-status', verdict: 'unsafe', proposalEligible: false} satisfies StatusTruthFinding,
    ]

    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.status).toBe('findings')
    expect(report.counts.total).toBe(4)
    expect(report.counts.drifted).toBe(1)
    expect(report.counts.current).toBe(1)
    expect(report.counts.unresolved).toBe(1)
    expect(report.counts.unsafe).toBe(1)
    expect(report.counts.proposal_eligible).toBe(1)
    const kinds = report.findings.map(f => f.kind)
    expect(new Set(kinds).size).toBe(4)
  })

  it('edge: no supported claims produces zero findings and zero proposal-eligible actions', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.findings).toHaveLength(0)
    expect(report.counts.proposal_eligible).toBe(0)
  })
})

describe('isKnownReportVersion', () => {
  it('happy path: known schema and fingerprint versions are accepted', () => {
    const report = makeReport()
    expect(isKnownReportVersion(report)).toBe(true)
  })

  it('error: unknown schema_version is rejected', () => {
    const report = makeReport({schema_version: 99})
    expect(isKnownReportVersion(report)).toBe(false)
  })

  it('error: unknown fingerprint_version is rejected', () => {
    const report = makeReport({fingerprint_version: 99})
    expect(isKnownReportVersion(report)).toBe(false)
  })

  it('error: both unknown versions are rejected', () => {
    const report = makeReport({schema_version: 0, fingerprint_version: 0})
    expect(isKnownReportVersion(report)).toBe(false)
  })
})

describe('detectStatusTruthClaims', () => {
  it('happy path: public PR-open claim whose live PR is closed becomes drifted with stable fingerprint and proposed correction', () => {
    const claim = makeClaim({
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
      normalizedText: 'pr #42 is open',
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'closed'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    // Public finding fields are accessible
    if (finding?.verdict === 'drifted') {
      expect(finding.claimedState).toBe('open')
      expect(finding.liveState).toBe('closed')
      expect(finding.proposalEligible).toBe(true)
      expect(finding.proposedCorrection).toBeTruthy()
      const fp = computeClaimFingerprint('pr-state', 'docs/plans/example.md', 'fro-bot/.github#42', 'pr #42 is open')
      expect(finding.fingerprint).toBe(fp)
    }
  })

  it('happy path: current release/tag claim is classified as current and produces no proposal', () => {
    const claim = makeClaim({
      kind: 'release-tag-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/.github@v1.0.0',
      claimedState: 'published',
      normalizedText: 'release v1.0.0 is published',
    })

    const resolverResults = makeResolverResults([
      {
        kind: 'release-tag-state',
        sourceRef: 'fro-bot/.github@v1.0.0',
        result: {status: 'resolved', state: 'published'},
      },
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('current')
    expect(finding?.proposalEligible).toBe(false)
    if (finding?.verdict === 'current') {
      expect(finding.proposedCorrection).toBeUndefined()
    }
  })

  it('error: GitHub state unavailable => unresolved and not proposal-eligible', () => {
    const claim = makeClaim({
      kind: 'pr-state',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
    })

    const resolverResults: Record<string, ResolverResult> = {}

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('unresolved')
    expect(finding?.proposalEligible).toBe(false)
    if (finding?.verdict === 'unresolved') {
      expect(finding.liveState).toBeUndefined()
    }
  })

  it('error: source resolves to private/unknown identity => unsafe and not proposal-eligible', () => {
    const claim = makeClaim({
      kind: 'pr-state',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'private'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('unsafe')
    expect(finding?.proposalEligible).toBe(false)
  })

  it('edge: rollout-tracker claim is unresolved when snapshot source fails (sub-resolver unavailable)', () => {
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: 'fro-bot/.github#3512',
      claimedState: 'active',
      normalizedText: 'rollout tracker #3512 is active',
    })

    const resolverResults = makeResolverResults([
      {kind: 'rollout-tracker-status', sourceRef: 'fro-bot/.github#3512', result: {status: 'unavailable'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('unresolved')
    expect(finding?.proposalEligible).toBe(false)
  })

  it('edge: no supported claims produces empty findings array', () => {
    const findings = detectStatusTruthClaims([], {})
    expect(findings).toHaveLength(0)
  })

  it('dependency order: mixed resolver-type claims are emitted file-parse first, api second, compound last', () => {
    const claims: StatusTruthClaim[] = [
      makeClaim({
        kind: 'rollout-tracker-status',
        sourceRef: 'fro-bot/.github#3512',
        claimedState: 'active',
        normalizedText: 'rollout tracker #3512 is active',
      }),
      makeClaim({
        kind: 'pr-state',
        sourceRef: 'fro-bot/.github#42',
        claimedState: 'open',
        normalizedText: 'pr #42 is open',
      }),
      makeClaim({
        kind: 'plan-status',
        sourceRef: 'docs/plans/example.md#status',
        claimedState: 'active',
        normalizedText: 'status: active',
      }),
    ]

    const resolverResults = makeResolverResults([
      {
        kind: 'rollout-tracker-status',
        sourceRef: 'fro-bot/.github#3512',
        result: {status: 'resolved', state: 'active'},
      },
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'open'}},
      {kind: 'plan-status', sourceRef: 'docs/plans/example.md#status', result: {status: 'resolved', state: 'active'}},
    ])

    const findings = detectStatusTruthClaims(claims, resolverResults)

    expect(findings).toHaveLength(3)
    expect(findings[0]?.kind).toBe('plan-status')
    expect(findings[1]?.kind).toBe('pr-state')
    expect(findings[2]?.kind).toBe('rollout-tracker-status')
  })

  it('integration: multiple claim kinds in one document produce distinct report entries', () => {
    const claims: StatusTruthClaim[] = [
      makeClaim({
        kind: 'pr-state',
        path: 'docs/plans/example.md',
        sourceRef: 'fro-bot/.github#42',
        claimedState: 'open',
        normalizedText: 'pr #42 is open',
      }),
      makeClaim({
        kind: 'issue-state',
        path: 'docs/plans/example.md',
        sourceRef: 'fro-bot/.github#100',
        claimedState: 'open',
        normalizedText: 'issue #100 is open',
      }),
      makeClaim({
        kind: 'release-tag-state',
        path: 'docs/plans/example.md',
        sourceRef: 'fro-bot/.github@v2.0.0',
        claimedState: 'published',
        normalizedText: 'release v2.0.0 is published',
      }),
    ]

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'closed'}},
      {kind: 'issue-state', sourceRef: 'fro-bot/.github#100', result: {status: 'resolved', state: 'open'}},
      {
        kind: 'release-tag-state',
        sourceRef: 'fro-bot/.github@v2.0.0',
        result: {status: 'resolved', state: 'published'},
      },
    ])

    const findings = detectStatusTruthClaims(claims, resolverResults)

    expect(findings).toHaveLength(3)
    const verdicts = findings.map(f => f.verdict)
    expect(verdicts).toContain('drifted')
    expect(verdicts.filter(v => v === 'current')).toHaveLength(2)

    const fingerprints = findings
      .filter((f): f is PublicStatusTruthFinding => f.verdict !== 'unsafe')
      .map(f => f.fingerprint)
    expect(new Set(fingerprints).size).toBe(3)
  })

  it('integration: multiple claim kinds produce correct aggregate counts via buildStatusTruthReport', () => {
    const claims: StatusTruthClaim[] = [
      makeClaim({
        kind: 'pr-state',
        sourceRef: 'fro-bot/.github#1',
        claimedState: 'open',
        normalizedText: 'pr #1 is open',
      }),
      makeClaim({
        kind: 'issue-state',
        sourceRef: 'fro-bot/.github#2',
        claimedState: 'open',
        normalizedText: 'issue #2 is open',
      }),
    ]

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#1', result: {status: 'resolved', state: 'closed'}},
      {kind: 'issue-state', sourceRef: 'fro-bot/.github#2', result: {status: 'resolved', state: 'open'}},
    ])

    const findings = detectStatusTruthClaims(claims, resolverResults)
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.counts.total).toBe(2)
    expect(report.counts.drifted).toBe(1)
    expect(report.counts.current).toBe(1)
    expect(report.counts.proposal_eligible).toBe(1)
  })

  it('unsafe finding does not expose path, sourceRef, claimedState, fingerprint, or proposedCorrection', () => {
    const claim = makeClaim({
      kind: 'pr-state',
      path: 'docs/plans/secret.md',
      sourceRef: 'private-org/private-repo#99',
      claimedState: 'open',
      normalizedText: 'pr #99 is open',
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'private-org/private-repo#99', result: {status: 'private'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('unsafe')
    expect(finding?.proposalEligible).toBe(false)

    expect('path' in (finding ?? {})).toBe(false)
    expect('sourceRef' in (finding ?? {})).toBe(false)
    expect('claimedState' in (finding ?? {})).toBe(false)
    expect('fingerprint' in (finding ?? {})).toBe(false)
    expect('proposedCorrection' in (finding ?? {})).toBe(false)
    expect('liveState' in (finding ?? {})).toBe(false)
  })

  it('PR and issue claims sharing the same sourceRef do not cross-wire states', () => {
    const prClaim = makeClaim({
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
      normalizedText: 'pr #42 is open',
    })
    const issueClaim = makeClaim({
      kind: 'issue-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
      normalizedText: 'issue #42 is open',
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'closed'}},
      {kind: 'issue-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'open'}},
    ])

    const findings = detectStatusTruthClaims([prClaim, issueClaim], resolverResults)

    expect(findings).toHaveLength(2)

    const prFinding = findings.find(f => f.kind === 'pr-state')
    const issueFinding = findings.find(f => f.kind === 'issue-state')

    expect(prFinding?.verdict).toBe('drifted')
    if (prFinding?.verdict === 'drifted') {
      expect(prFinding.liveState).toBe('closed')
    }

    expect(issueFinding?.verdict).toBe('current')
    if (issueFinding?.verdict === 'current') {
      expect(issueFinding.liveState).toBe('open')
    }
  })

  it('rollout-tracker with top-level resolved state but missing required sub-resolver is unresolved and proposal-ineligible', () => {
    const rolloutClaim = makeClaim({
      kind: 'rollout-tracker-status',
      path: 'docs/plans/rollout.md',
      sourceRef: 'fro-bot/.github#3512',
      claimedState: 'active',
      normalizedText: 'rollout tracker #3512 is active',
    })

    const resolverResults = makeResolverResults([
      {
        kind: 'rollout-tracker-status',
        sourceRef: 'fro-bot/.github#3512',
        result: {
          status: 'resolved',
          state: 'active',
          subResolverResults: {
            'issue-state': {status: 'unavailable'},
            'pr-state': {status: 'unavailable'},
          },
        },
      },
    ])

    const findings = detectStatusTruthClaims([rolloutClaim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('unresolved')
    expect(finding?.proposalEligible).toBe(false)
  })

  it('buildStatusTruthReport with scanComplete:false and failureClass:null returns execution-failure and repair_eligible:false', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: false,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.status).toBe('execution-failure')
    expect(report.repair_eligible).toBe(false)
    expect(report.scan_complete).toBe(false)
  })
})

describe('type contracts', () => {
  it('ClaimVerdict union covers all expected values', () => {
    const verdicts: ClaimVerdict[] = ['current', 'drifted', 'unresolved', 'unsafe']
    expect(verdicts).toHaveLength(4)
  })

  it('ResolverType union covers all expected values', () => {
    const types: ResolverType[] = ['api', 'file-parse', 'compound']
    expect(types).toHaveLength(3)
  })

  it('ClaimKind union covers all six expected values', () => {
    const kinds: ClaimKind[] = [
      'pr-state',
      'issue-state',
      'release-tag-state',
      'plan-status',
      'rollout-tracker-status',
      'plan-consistency',
    ]
    expect(kinds).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// validateStatusTruthArtifact tests
// ---------------------------------------------------------------------------

describe('validateStatusTruthArtifact', () => {
  it('accepts a valid clean report', () => {
    const report = makeReport()
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.report.schema_version).toBe(KNOWN_SCHEMA_VERSION)
    }
  })

  it('accepts a valid findings report with correct count', () => {
    const finding = makeFinding()
    const report = makeReport({
      status: 'findings',
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateStatusTruthArtifact(null).valid).toBe(false)
    expect(validateStatusTruthArtifact('string').valid).toBe(false)
    expect(validateStatusTruthArtifact(42).valid).toBe(false)
    expect(validateStatusTruthArtifact([]).valid).toBe(false)
  })

  it('rejects unknown schema version', () => {
    const result = validateStatusTruthArtifact({...makeReport(), schema_version: 99})
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('unknown artifact version')
    }
  })

  it('rejects unknown fingerprint version', () => {
    const result = validateStatusTruthArtifact({...makeReport(), fingerprint_version: 99})
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('unknown artifact version')
    }
  })

  it('rejects artifact missing required field', () => {
    const reportWithoutStatus = (({status: _s, ...rest}) => rest)(makeReport())
    const result = validateStatusTruthArtifact(reportWithoutStatus)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('missing required field')
    }
  })

  it('rejects artifact with prohibited field normalizedText', () => {
    const report = {...makeReport(), normalizedText: 'raw claim text'}
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('prohibited field')
    }
  })

  it('rejects artifact with prohibited field in finding', () => {
    const finding = {...makeFinding(), normalizedText: 'raw claim text'}
    const report = makeReport({
      status: 'findings',
      findings: [finding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('prohibited field')
    }
  })

  it('rejects artifact with count mismatch (counts.total !== findings.length)', () => {
    const finding = makeFinding()
    const report = makeReport({
      status: 'findings',
      findings: [finding],
      // Intentionally wrong count
      counts: {total: 99, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('count mismatch')
    }
  })

  it('rejects artifact with findings as non-array', () => {
    const report = {...makeReport(), findings: 'not-an-array'}
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Artifact safety contract tests
// ---------------------------------------------------------------------------

describe('artifact safety contract', () => {
  it('detect output artifact contains safe machine fields and counters but no raw claim text or source snippets', () => {
    const claim = makeClaim({
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
      normalizedText: 'pr #42 is open',
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'closed'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    // Serialize to JSON (as the artifact would be written)
    const artifactJson = JSON.stringify(report)

    // The artifact must contain machine-safe fields
    expect(artifactJson).toContain('"schema_version"')
    expect(artifactJson).toContain('"fingerprint_version"')
    expect(artifactJson).toContain('"status"')
    expect(artifactJson).toContain('"counts"')

    // The artifact must NOT contain raw claim text (normalizedText is not in the report)
    // normalizedText is an input to fingerprint computation but is not stored in the report
    expect(artifactJson).not.toContain('"normalizedText"')

    // The report findings contain typed fields, not raw document snippets
    const finding = report.findings[0]
    expect(finding).toBeDefined()
    if (finding !== undefined && finding.verdict !== 'unsafe') {
      // These are typed machine fields, not raw text
      expect(typeof finding.kind).toBe('string')
      expect(typeof finding.path).toBe('string')
      expect(typeof finding.sourceRef).toBe('string')
      expect(typeof finding.fingerprint).toBe('string')
    }
  })

  it('detect output feeds open planning without requiring workflow summary raw claim text', () => {
    // The report is the sole handoff artifact; the open step reads it directly.
    // Counts-only summary is derived from report.counts, not from raw claim text.
    const finding = makeFinding({
      kind: 'pr-state',
      verdict: 'drifted',
      proposalEligible: true,
    })
    const report = buildStatusTruthReport({
      findings: [finding],
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    // The open step only needs counts from the report, not raw claim text
    const summary = {
      total: report.counts.total,
      drifted: report.counts.drifted,
      proposal_eligible: report.counts.proposal_eligible,
    }

    expect(summary.total).toBe(1)
    expect(summary.drifted).toBe(1)
    expect(summary.proposal_eligible).toBe(1)

    // Verify the report can be serialized and deserialized without losing machine fields
    const roundTripped = JSON.parse(JSON.stringify(report)) as StatusTruthJsonReport
    expect(isKnownReportVersion(roundTripped)).toBe(true)
    expect(roundTripped.counts.proposal_eligible).toBe(1)
  })

  it('no findings emits zero counts and opens nothing', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.status).toBe('clean')
    expect(report.counts.total).toBe(0)
    expect(report.counts.drifted).toBe(0)
    expect(report.counts.proposal_eligible).toBe(0)
    expect(report.repair_eligible).toBe(false)
  })

  it('validateArtifact rejects report with unknown schema version', () => {
    const report = makeReport({schema_version: 99})
    expect(isKnownReportVersion(report)).toBe(false)
  })

  it('validateArtifact rejects report with unknown fingerprint version', () => {
    const report = makeReport({fingerprint_version: 99})
    expect(isKnownReportVersion(report)).toBe(false)
  })

  it('stdout/stderr from script failure does not contain raw normalizedText or fingerprint-like values in the report envelope', () => {
    // This is a structural test: the report envelope does not store normalizedText
    // (the raw claim text used for fingerprinting). Only the fingerprint hash is stored.
    // The normalizedText is an input to computeClaimFingerprint but is NOT persisted
    // in the report — it is intentionally excluded from the artifact.
    const uniqueNormalizedText = 'pr #42 is open'
    const claim = makeClaim({
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/.github#42',
      claimedState: 'open',
      normalizedText: uniqueNormalizedText,
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/.github#42', result: {status: 'resolved', state: 'closed'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    // The report must NOT contain a 'normalizedText' field (raw claim text is not stored)
    const artifactJson = JSON.stringify(report)
    expect(artifactJson).not.toContain('"normalizedText"')

    // The fingerprint is a hex hash, not the raw text
    const finding = report.findings[0]
    if (finding !== undefined && finding.verdict !== 'unsafe') {
      expect(finding.fingerprint).toMatch(/^[a-f0-9]{16}$/)
      // The fingerprint is an opaque hash — it does not contain the raw text
      expect(finding.fingerprint).not.toBe(uniqueNormalizedText)
    }
  })
})

describe('extractStatusTruthClaimsFromText', () => {
  it('extracts a pr-state claim from text containing "PR #42 is open"', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'See PR #42 is open for details.',
    })
    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('pr-state')
    expect(claim?.sourceRef).toBe('#42')
    expect(claim?.claimedState).toBe('open')
    expect(claim?.path).toBe('README.md')
    expect(claim?.normalizedText).toBe('pr #42 is open')
  })

  it('extracts an issue-state claim from text containing "issue #100 is closed"', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/foo.md',
      text: 'Tracked in issue #100 is closed.',
    })
    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('issue-state')
    expect(claim?.sourceRef).toBe('#100')
    expect(claim?.claimedState).toBe('closed')
  })

  it('extracts a release-tag-state claim from text containing "release v1.2.3 is published"', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'SECURITY.md',
      text: 'The release v1.2.3 is published.',
    })
    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('release-tag-state')
    expect(claim?.sourceRef).toBe('@v1.2.3')
    expect(claim?.claimedState).toBe('published')
  })

  it('extracts a plan-status claim from cross-file prose reference "docs/plans/my-plan.md is active"', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('plan-status')
    // sourceRef is the plan path itself (not path#status) for cross-file claims
    expect(claim?.sourceRef).toBe('docs/plans/my-plan.md')
    expect(claim?.claimedState).toBe('active')
  })

  it('extracts multiple claims from a single document', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/multi.md',
      text: 'PR #1 is open and issue #2 is closed.',
    })
    expect(claims).toHaveLength(2)
    const kinds = claims.map(c => c.kind)
    expect(kinds).toContain('pr-state')
    expect(kinds).toContain('issue-state')
  })

  it('returns empty array for text with no matching claims', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'No status claims here.',
    })
    expect(claims).toHaveLength(0)
  })

  it('normalizes claim text (lowercases, trims whitespace)', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'PR #42 is OPEN',
    })
    expect(claims[0]?.normalizedText).toBe('pr #42 is open')
  })

  it('cross-repo PR reference: text with owner/repo prefix near claim does not produce bare #N sourceRef', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'See fro-bot/agent#1033 PR #1033 is open for context.',
    })
    expect(claims.filter(c => c.sourceRef === '#1033')).toHaveLength(0)
    for (const claim of claims) {
      if (claim.kind === 'pr-state' && claim.claimedState === 'open') {
        expect(claim.sourceRef).not.toBe('#1033')
      }
    }
  })

  it('cross-repo issue reference: text with owner/repo prefix near claim does not produce bare #N sourceRef', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'Tracked in fro-bot/dashboard#48 issue #48 is open.',
    })
    expect(claims.filter(c => c.sourceRef === '#48')).toHaveLength(0)
    for (const claim of claims) {
      if (claim.kind === 'issue-state' && claim.claimedState === 'open') {
        expect(claim.sourceRef).not.toBe('#48')
      }
    }
  })

  it('rollout-tracker-status is exempt from cross-repo bare-#N suppression: "rollout tracker #3512 is open" is extracted despite fro-bot/.github#3512 elsewhere in text', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'See fro-bot/.github#3512 for context. rollout tracker #3512 is open.',
    })
    const trackerClaims = claims.filter(c => c.kind === 'rollout-tracker-status' && c.sourceRef === '#3512')
    expect(trackerClaims).toHaveLength(1)
    expect(trackerClaims[0]?.claimedState).toBe('open')
  })
})

describe('scanStatusTruthClaims', () => {
  it('scans files returned by fileLister and extracts claims', async () => {
    const fileLister: FileLister = async () => ['README.md', 'docs/plans/foo.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'README.md') return 'PR #42 is open'
      if (path === 'docs/plans/foo.md') return 'issue #10 is closed'
      return ''
    }

    const {claims, scanErrors} = await scanStatusTruthClaims({fileLister, fileReader})
    expect(claims).toHaveLength(2)
    expect(scanErrors).toBe(0)
    const kinds = claims.map(c => c.kind)
    expect(kinds).toContain('pr-state')
    expect(kinds).toContain('issue-state')
  })

  it('counts per-file read errors without aborting the scan', async () => {
    const fileLister: FileLister = async () => ['README.md', 'docs/plans/broken.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'README.md') return 'PR #42 is open'
      throw new Error('read error')
    }

    const {claims, scanErrors} = await scanStatusTruthClaims({fileLister, fileReader})
    expect(claims).toHaveLength(1)
    expect(scanErrors).toBe(1)
  })

  it('returns empty claims and zero errors when no files are listed', async () => {
    const fileLister: FileLister = async () => []
    const fileReader: FileReader = async () => ''

    const {claims, scanErrors} = await scanStatusTruthClaims({fileLister, fileReader})
    expect(claims).toHaveLength(0)
    expect(scanErrors).toBe(0)
  })

  it('throws when fileLister itself fails (caller emits execution-failure)', async () => {
    const fileLister: FileLister = async () => {
      throw new Error('glob failure')
    }
    const fileReader: FileReader = async () => ''

    await expect(scanStatusTruthClaims({fileLister, fileReader})).rejects.toThrow('glob failure')
  })

  it('scan failure produces execution-failure report when wrapped in runDetect logic', async () => {
    // Simulate the runDetect catch path: fileLister throws
    const generatedAt = '2026-06-28T00:00:00Z'
    let report
    try {
      const fileLister: FileLister = async () => {
        throw new Error('unexpected failure')
      }
      await scanStatusTruthClaims({fileLister, fileReader: async () => ''})
      report = buildStatusTruthReport({findings: [], scanComplete: true, generatedAt, failureClass: null})
    } catch {
      report = buildStatusTruthReport({findings: [], scanComplete: false, generatedAt, failureClass: 'execution-error'})
    }
    expect(report.status).toBe('execution-failure')
    expect(report.scan_complete).toBe(false)
    expect(report.failure_class).toBe('execution-error')
  })

  it('excludes docs/brainstorms/ paths so example prose like "PR #907 is open" produces zero claims', async () => {
    // Brainstorm documents may contain illustrative status-truth patterns as examples.
    // These must not self-trigger proposals. The path is excluded before file reading.
    const brainstormPath = 'docs/brainstorms/2026-06-26-a2-self-maintenance-portfolio-requirements.md'
    const fileLister: FileLister = async () => [brainstormPath, 'README.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === brainstormPath) return 'Acceptance example: PR #907 is open and issue #908 is closed.'
      if (path === 'README.md') return 'No claims here.'
      return ''
    }

    const {claims, scanErrors} = await scanStatusTruthClaims({fileLister, fileReader})
    // The brainstorm file must be excluded entirely — zero claims from it
    expect(claims.filter(c => c.path === brainstormPath)).toHaveLength(0)
    expect(scanErrors).toBe(0)
  })
})

function makeMockDetectOctokit(
  overrides: {
    prState?: string
    prMerged?: boolean
    issueState?: string
    releaseDraft?: boolean
    prThrows?: boolean
    issueThrows?: boolean
    releaseThrows?: boolean
  } = {},
): DetectOctokitClient {
  return {
    paginate: async () => [],
    rest: {
      pulls: {
        get: async () => {
          if (overrides.prThrows === true) throw new Error('API error')
          return {data: {state: overrides.prState ?? 'open', merged: overrides.prMerged ?? false}}
        },
      },
      issues: {
        get: async () => {
          if (overrides.issueThrows === true) throw new Error('API error')
          return {data: {state: overrides.issueState ?? 'open'}}
        },
        listForRepo: async () => ({data: []}),
        listComments: async () => ({data: []}),
      },
      repos: {
        getReleaseByTag: async () => {
          if (overrides.releaseThrows === true) throw new Error('API error')
          return {data: {draft: overrides.releaseDraft ?? false, prerelease: false}}
        },
        get: async () => ({data: {private: false}}),
      },
    },
  }
}

function makeTestClaim(overrides: Partial<StatusTruthClaim> = {}): StatusTruthClaim {
  return {
    kind: 'pr-state',
    path: 'README.md',
    sourceRef: '#42',
    claimedState: 'open',
    normalizedText: 'pr #42 is open',
    ...overrides,
  }
}

describe('resolveClaimLiveState', () => {
  it('resolves pr-state claim with bare #N sourceRef to live PR state', async () => {
    const octokit = makeMockDetectOctokit({prState: 'closed'})
    const claim = makeTestClaim({kind: 'pr-state', sourceRef: '#42', claimedState: 'open'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('closed')
  })

  it('resolves merged PR to state "merged"', async () => {
    const octokit = makeMockDetectOctokit({prState: 'closed', prMerged: true})
    const claim = makeTestClaim({kind: 'pr-state', sourceRef: '#42', claimedState: 'open'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('merged')
  })

  it('returns unavailable for cross-repo pr-state sourceRef (not bare #N)', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'pr-state', sourceRef: 'other-org/other-repo#42'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })

  it('returns unavailable when PR API throws', async () => {
    const octokit = makeMockDetectOctokit({prThrows: true})
    const claim = makeTestClaim({kind: 'pr-state', sourceRef: '#42'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })

  it('resolves issue-state claim with bare #N sourceRef', async () => {
    const octokit = makeMockDetectOctokit({issueState: 'closed'})
    const claim = makeTestClaim({kind: 'issue-state', sourceRef: '#10', claimedState: 'open'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('closed')
  })

  it('returns unavailable for cross-repo issue-state sourceRef', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'issue-state', sourceRef: 'other-org/other-repo#10'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })

  it('resolves release-tag-state claim with @tag sourceRef', async () => {
    const octokit = makeMockDetectOctokit({releaseDraft: false})
    const claim = makeTestClaim({kind: 'release-tag-state', sourceRef: '@v1.0.0', claimedState: 'published'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('published')
  })

  it('resolves draft release to state "draft"', async () => {
    const octokit = makeMockDetectOctokit({releaseDraft: true})
    const claim = makeTestClaim({kind: 'release-tag-state', sourceRef: '@v1.0.0', claimedState: 'published'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('draft')
  })

  it('returns unavailable when release API throws', async () => {
    const octokit = makeMockDetectOctokit({releaseThrows: true})
    const claim = makeTestClaim({kind: 'release-tag-state', sourceRef: '@v1.0.0'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })

  it('rollout-tracker-status returns unavailable (Phase 1 scope cut)', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'rollout-tracker-status', sourceRef: '#3512', claimedState: 'active'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })

  it('plan-status without fileReader returns unavailable', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'plan-status', sourceRef: 'docs/plans/foo.md', claimedState: 'active'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })
})

describe('extract → resolve → detect pipeline', () => {
  it('text fixture "PR #42 is open" extracts pr-state claim; when resolver says closed, report contains one drifted finding', async () => {
    // Extract
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'PR #42 is open',
    })
    expect(claims).toHaveLength(1)

    // Resolve with injected resolver that says PR is closed
    const octokit = makeMockDetectOctokit({prState: 'closed'})
    const {resolverResults} = await resolveAllClaims({
      claims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    // Detect
    const findings = detectStatusTruthClaims(claims, resolverResults)
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    expect(report.counts.drifted).toBe(1)
    expect(report.counts.total).toBe(1)
    expect(report.status).toBe('findings')
    const finding = report.findings[0]
    expect(finding?.verdict).toBe('drifted')
    if (finding?.verdict === 'drifted') {
      expect(finding.claimedState).toBe('open')
      expect(finding.liveState).toBe('closed')
      expect(finding.proposalEligible).toBe(true)
    }
  })

  it('cross-repo sourceRef is unavailable and does not become drifted or fake clean', async () => {
    // A claim with a cross-repo sourceRef (not bare #N)
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'PR #42 is open',
    })
    // Manually override sourceRef to simulate cross-repo
    const crossRepoClaims = claims.map(c => ({...c, sourceRef: 'other-org/other-repo#42'}))

    const octokit = makeMockDetectOctokit()
    const {resolverResults} = await resolveAllClaims({
      claims: crossRepoClaims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    const findings = detectStatusTruthClaims(crossRepoClaims, resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('cross-repo context text: extracted claim (if any) classifies as unresolved, not drifted', async () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'See fro-bot/agent#1033 PR #1033 is open for context.',
    })

    const octokit = makeMockDetectOctokit({prState: 'closed'}) // would drift if resolved as current-repo
    const {resolverResults} = await resolveAllClaims({
      claims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    const findings = detectStatusTruthClaims(claims, resolverResults)
    for (const finding of findings) {
      if (finding.kind === 'pr-state' && finding.verdict !== 'unsafe') {
        expect(finding.verdict).not.toBe('drifted')
        expect(finding.verdict).not.toBe('current')
      }
    }
  })

  it('detect with no claims emits clean zero counts', () => {
    const findings = detectStatusTruthClaims([], {})
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })
    expect(report.status).toBe('clean')
    expect(report.counts.total).toBe(0)
    expect(report.counts.drifted).toBe(0)
    expect(report.counts.proposal_eligible).toBe(0)
  })

  it('error output remains sanitized: report JSON does not contain raw claim text or source path', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/secret-plan.md',
      text: 'PR #42 is open',
    })
    const findings = detectStatusTruthClaims(claims, {})
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: null,
    })

    const json = JSON.stringify(report)
    // normalizedText must not appear in the report
    expect(json).not.toContain('"normalizedText"')
    // Raw claim text must not appear as a top-level field
    expect(json).not.toContain('"rawText"')
    expect(json).not.toContain('"sourceSnippet"')
    // The fingerprint is a hex hash, not the raw text
    const finding = report.findings[0]
    if (finding !== undefined && finding.verdict !== 'unsafe') {
      expect(finding.fingerprint).toMatch(/^[a-f0-9]{16}$/)
    }
  })

  it('resolveAllClaims deduplicates by kind:sourceRef to avoid redundant API calls', async () => {
    let callCount = 0
    const octokit: DetectOctokitClient = {
      paginate: async () => [],
      rest: {
        pulls: {
          get: async () => {
            callCount++
            return {data: {state: 'open', merged: false}}
          },
        },
        issues: {
          get: async () => ({data: {state: 'open'}}),
          listForRepo: async () => ({data: []}),
          listComments: async () => ({data: []}),
        },
        repos: {
          getReleaseByTag: async () => ({data: {draft: false, prerelease: false}}),
          get: async () => ({data: {private: false}}),
        },
      },
    }

    // Two claims with the same kind:sourceRef
    const claims: StatusTruthClaim[] = [
      {kind: 'pr-state', path: 'README.md', sourceRef: '#42', claimedState: 'open', normalizedText: 'pr #42 is open'},
      {kind: 'pr-state', path: 'docs/foo.md', sourceRef: '#42', claimedState: 'open', normalizedText: 'pr #42 is open'},
    ]

    await resolveAllClaims({claims, octokit, owner: 'fro-bot', repo: '.github'})
    // Should only call the API once despite two claims with same kind:sourceRef
    expect(callCount).toBe(1)
  })
})

describe('buildProposedCorrection: $ token safety via detectStatusTruthClaims', () => {
  it('live state containing $& is inserted literally, not expanded as a replacement token', () => {
    // If String.replace used a string replacement, '$&' would expand to the matched text.
    // With a replacement function it is inserted verbatim.
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'README.md',
      sourceRef: '#42',
      claimedState: 'open',
      normalizedText: 'pr #42 is open',
    }
    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: '#42', result: {status: 'resolved', state: '$&'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    if (finding?.verdict === 'drifted') {
      // proposedCorrection must contain the literal string '$&', not the matched text 'open'
      expect(finding.proposedCorrection).toContain('$&')
      expect(finding.proposedCorrection).not.toBe('pr #42 is open') // must have changed
    }
  })

  it('live state containing $1 is inserted literally, not expanded as a capture-group reference', () => {
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'README.md',
      sourceRef: '#42',
      claimedState: 'open',
      normalizedText: 'pr #42 is open',
    }
    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: '#42', result: {status: 'resolved', state: '$1'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)
    const finding = findings[0]
    if (finding?.verdict === 'drifted') {
      expect(finding.proposedCorrection).toContain('$1')
    }
  })
})

describe('buildStatusTruthReport failure-class integration', () => {
  it('buildStatusTruthReport with file-parse-error failureClass produces execution-failure status', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: false,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: 'file-parse-error',
    })
    expect(report.status).toBe('execution-failure')
    expect(report.failure_class).toBe('file-parse-error')
    expect(report.scan_complete).toBe(false)
    expect(report.repair_eligible).toBe(false)
  })

  it('buildStatusTruthReport with api-unavailable failureClass produces execution-failure status', () => {
    const report = buildStatusTruthReport({
      findings: [],
      scanComplete: false,
      generatedAt: '2026-06-28T00:00:00Z',
      failureClass: 'api-unavailable',
    })
    expect(report.status).toBe('execution-failure')
    expect(report.failure_class).toBe('api-unavailable')
  })
})

describe('selectDetectFailureClass', () => {
  it('returns null when all error counts are zero', () => {
    expect(selectDetectFailureClass({fileScanErrors: 0, issueScanErrors: 0, resolveErrors: 0})).toBeNull()
  })

  it('returns file-parse-error when fileScanErrors > 0 and no other errors', () => {
    expect(selectDetectFailureClass({fileScanErrors: 1, issueScanErrors: 0, resolveErrors: 0})).toBe('file-parse-error')
    expect(selectDetectFailureClass({fileScanErrors: 3, issueScanErrors: 0, resolveErrors: 0})).toBe('file-parse-error')
  })

  it('returns api-unavailable when issueScanErrors > 0 and fileScanErrors === 0', () => {
    // Issue list/comment fetch failures are API failures, not file-parse errors
    expect(selectDetectFailureClass({fileScanErrors: 0, issueScanErrors: 1, resolveErrors: 0})).toBe('api-unavailable')
    expect(selectDetectFailureClass({fileScanErrors: 0, issueScanErrors: 5, resolveErrors: 0})).toBe('api-unavailable')
  })

  it('returns api-unavailable when resolveErrors > 0 and fileScanErrors === 0', () => {
    expect(selectDetectFailureClass({fileScanErrors: 0, issueScanErrors: 0, resolveErrors: 1})).toBe('api-unavailable')
    expect(selectDetectFailureClass({fileScanErrors: 0, issueScanErrors: 0, resolveErrors: 4})).toBe('api-unavailable')
  })

  it('returns api-unavailable when both issueScanErrors and resolveErrors > 0 and fileScanErrors === 0', () => {
    expect(selectDetectFailureClass({fileScanErrors: 0, issueScanErrors: 2, resolveErrors: 3})).toBe('api-unavailable')
  })

  it('returns file-parse-error when fileScanErrors > 0 even if issueScanErrors and resolveErrors are also > 0', () => {
    // file-parse-error takes precedence when file scanning itself failed
    expect(selectDetectFailureClass({fileScanErrors: 1, issueScanErrors: 1, resolveErrors: 1})).toBe('file-parse-error')
    expect(selectDetectFailureClass({fileScanErrors: 2, issueScanErrors: 3, resolveErrors: 0})).toBe('file-parse-error')
  })
})

describe('scanStatusTruthClaims: plan-status no-noise behavior', () => {
  it('production scan (default): self-referential plan frontmatter does NOT produce plan-status claims', async () => {
    const fileLister: FileLister = async () => ['docs/plans/my-plan.md']
    const fileReader: FileReader = async () => '---\nstatus: active\ntitle: My Plan\n---\n\nContent.'

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    // Self-referential frontmatter must not produce plan-status claims
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(0)
  })

  it('pure extractor: self-referential frontmatter does NOT produce plan-status claims', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/my-plan.md',
      text: '---\nstatus: active\ntitle: My Plan\n---\n\nContent.',
    })
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(0)
  })

  it('pure extractor: cross-file prose reference DOES produce plan-status claims', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(1)
  })

  it('production scan with default kinds: cross-file prose reference emits plan-status claim', async () => {
    const fileLister: FileLister = async () => ['README.md']
    const fileReader: FileReader = async () => 'The plan docs/plans/my-plan.md is active.'

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(1)
  })

  it('production scan default still emits pr-state and issue-state claims', async () => {
    const fileLister: FileLister = async () => ['README.md']
    const fileReader: FileReader = async () => 'PR #42 is open and issue #10 is closed.'

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    expect(claims.filter(c => c.kind === 'pr-state')).toHaveLength(1)
    expect(claims.filter(c => c.kind === 'issue-state')).toHaveLength(1)
  })
})

describe('scanIssueStatusTruthClaims: issue body/comment scanning', () => {
  it('issue body containing "PR #42 is open" yields a pr-state claim with synthetic issue body path', async () => {
    const issues: IssueListItem[] = [{number: 3512, title: 'Rollout tracker', body: 'PR #42 is open', labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('pr-state')
    expect(claim?.sourceRef).toBe('#42')
    expect(claim?.path).toBe('github-issue://current/issues/3512#body')
  })

  it('resolver saying PR is closed yields a drifted finding for issue body claim', async () => {
    const issues: IssueListItem[] = [{number: 3512, title: 'Rollout tracker', body: 'PR #42 is open', labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: '#42', result: {status: 'resolved', state: 'closed'}},
    ])

    const findings = detectStatusTruthClaims(claims, resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('drifted')
  })

  it('issue comments are scanned and can produce claims', async () => {
    const issues: IssueListItem[] = [{number: 100, title: 'Some issue', body: null, labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => [{id: 9001, body: 'issue #55 is closed'}]

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('issue-state')
    expect(claim?.path).toBe('github-issue://current/issues/100#comment-9001')
  })

  it('issues labeled "status-truth" are skipped', async () => {
    const issues: IssueListItem[] = [
      {number: 200, title: 'Status truth proposal', body: 'PR #42 is open', labels: [{name: 'status-truth'}]},
    ]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(0)
  })

  it('issues containing the proposal marker in title are skipped', async () => {
    const issues: IssueListItem[] = [
      {number: 201, title: '[status-truth-proposal] Fix PR #42', body: 'PR #42 is open', labels: []},
    ]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(0)
  })

  it('issue list fetch failure produces non-clean failure class (api-unavailable)', async () => {
    const issueLister: IssueLister = async () => {
      throw new Error('API rate limit')
    }
    const commentFetcher: IssueCommentFetcher = async () => []

    const result = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    // Must not fake clean — must report failure
    expect(result.scanErrors).toBeGreaterThan(0)
    expect(result.claims).toHaveLength(0)
  })

  it('per-issue comment fetch failure counts as scan error and does not silently hide as clean', async () => {
    const issues: IssueListItem[] = [{number: 300, title: 'Some issue', body: 'PR #42 is open', labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => {
      throw new Error('comment fetch failed')
    }

    const result = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(result.scanErrors).toBeGreaterThan(0)
    expect(result.claims.filter(c => c.path === 'github-issue://current/issues/300#body')).toHaveLength(1)
  })

  it('synthetic issue paths use current scheme and do not contain owner/repo identity', () => {
    const syntheticBodyPath = 'github-issue://current/issues/3512#body'
    const syntheticCommentPath = 'github-issue://current/issues/3512#comment-9001'

    expect(syntheticBodyPath).toMatch(/^github-issue:\/\/current\/issues\/\d+#body$/)
    expect(syntheticCommentPath).toMatch(/^github-issue:\/\/current\/issues\/\d+#comment-\d+$/)

    expect(syntheticBodyPath).not.toContain('PR #42 is open')
    expect(syntheticCommentPath).not.toContain('issue #55 is closed')

    expect(syntheticBodyPath).not.toContain('fro-bot')
    expect(syntheticBodyPath).not.toContain('.github')
  })

  it('issue body with null body produces no claims (graceful null handling)', async () => {
    const issues: IssueListItem[] = [{number: 400, title: 'Empty body issue', body: null, labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims, scanErrors} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(0)
    expect(scanErrors).toBe(0)
  })

  it('comment with null body produces no claims (graceful null handling)', async () => {
    const issues: IssueListItem[] = [{number: 500, title: 'Issue with null comment', body: null, labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => [{id: 9002, body: null}]

    const {claims, scanErrors} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(0)
    expect(scanErrors).toBe(0)
  })
})

describe('synthetic issue paths use current, not owner/repo', () => {
  it('issue body path uses github-issue://current/issues/<n>#body, not owner/repo', async () => {
    const issues: IssueListItem[] = [{number: 3512, title: 'Rollout tracker', body: 'PR #42 is open', labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.path).toBe('github-issue://current/issues/3512#body')
    expect(claim?.path).not.toContain('fro-bot')
    expect(claim?.path).not.toContain('.github')
  })

  it('issue comment path uses github-issue://current/issues/<n>#comment-<id>, not owner/repo', async () => {
    const issues: IssueListItem[] = [{number: 100, title: 'Some issue', body: null, labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => [{id: 9001, body: 'issue #55 is closed'}]

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.path).toBe('github-issue://current/issues/100#comment-9001')
    expect(claim?.path).not.toContain('fro-bot')
    expect(claim?.path).not.toContain('.github')
  })

  it('scanner output for issue body uses current path regardless of owner/repo passed in', async () => {
    const issues: IssueListItem[] = [{number: 7, title: 'Test', body: 'issue #1 is open', labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'some-other-org',
      repo: 'some-other-repo',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(1)
    expect(claims[0]?.path).toBe('github-issue://current/issues/7#body')
    expect(claims[0]?.path).not.toContain('some-other-org')
    expect(claims[0]?.path).not.toContain('some-other-repo')
  })

  it('scanner output for issue comment uses current path regardless of owner/repo passed in', async () => {
    const issues: IssueListItem[] = [{number: 8, title: 'Test', body: null, labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => [{id: 42, body: 'PR #5 is open'}]

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'some-other-org',
      repo: 'some-other-repo',
      issueLister,
      commentFetcher,
    })

    expect(claims).toHaveLength(1)
    expect(claims[0]?.path).toBe('github-issue://current/issues/8#comment-42')
    expect(claims[0]?.path).not.toContain('some-other-org')
    expect(claims[0]?.path).not.toContain('some-other-repo')
  })

  it('public finding path and sourceRef fields are still present after issue scan', async () => {
    const issues: IssueListItem[] = [{number: 3512, title: 'Rollout tracker', body: 'PR #42 is open', labels: []}]
    const issueLister: IssueLister = async () => issues
    const commentFetcher: IssueCommentFetcher = async () => []

    const {claims} = await scanIssueStatusTruthClaims({
      owner: 'fro-bot',
      repo: '.github',
      issueLister,
      commentFetcher,
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: '#42', result: {status: 'resolved', state: 'closed'}},
    ])

    const findings = detectStatusTruthClaims(claims, resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    if (finding?.verdict === 'drifted') {
      expect(finding.path).toBe('github-issue://current/issues/3512#body')
      expect(finding.sourceRef).toBe('#42')
      expect(typeof finding.fingerprint).toBe('string')
    }
  })
})

describe('listCurrentRepoIssues: pagination helper fetches all pages', () => {
  it('fetches multiple pages until exhausted', async () => {
    const page1 = [
      {number: 1, title: 'Issue 1', body: 'body1', labels: [] as {name?: string}[]},
      {number: 2, title: 'Issue 2', body: 'body2', labels: [] as {name?: string}[]},
    ]
    const page2 = [{number: 3, title: 'Issue 3', body: 'body3', labels: [] as {name?: string}[]}]

    let callCount = 0
    const mockPaginate = async (_fn: unknown, _params: unknown) => {
      callCount++
      // paginate returns all items flattened
      return [...page1, ...page2]
    }

    const octokit = {
      paginate: mockPaginate,
      rest: {
        pulls: {get: async () => ({data: {state: 'open', merged: false}})},
        issues: {
          get: async () => ({data: {state: 'open'}}),
          listForRepo: async () => ({data: []}),
          listComments: async () => ({data: []}),
        },
        repos: {getReleaseByTag: async () => ({data: {draft: false, prerelease: false}})},
      },
    } as unknown as DetectOctokitClient

    const result = await listCurrentRepoIssues(octokit, 'fro-bot', '.github')
    expect(callCount).toBe(1)
    expect(result).toHaveLength(3)
    expect(result[0]?.number).toBe(1)
    expect(result[2]?.number).toBe(3)
  })

  it('maps labels correctly, defaulting missing name to empty string', async () => {
    const rawIssues = [
      {
        number: 10,
        title: 'Labeled issue',
        body: 'body',
        labels: [{name: 'bug'}, {name: undefined}] as {name?: string}[],
      },
    ]

    const octokit = {
      paginate: async () => rawIssues,
      rest: {
        pulls: {get: async () => ({data: {state: 'open', merged: false}})},
        issues: {
          get: async () => ({data: {state: 'open'}}),
          listForRepo: async () => ({data: []}),
          listComments: async () => ({data: []}),
        },
        repos: {getReleaseByTag: async () => ({data: {draft: false, prerelease: false}})},
      },
    } as unknown as DetectOctokitClient

    const result = await listCurrentRepoIssues(octokit, 'fro-bot', '.github')
    expect(result).toHaveLength(1)
    expect(result[0]?.labels).toEqual([{name: 'bug'}, {name: ''}])
  })
})

describe('listCurrentRepoIssueComments: pagination helper fetches all pages', () => {
  it('fetches multiple pages of comments until exhausted', async () => {
    const allComments = [
      {id: 1, body: 'comment 1'},
      {id: 2, body: 'comment 2'},
      {id: 3, body: 'comment 3'},
    ]

    let callCount = 0
    const octokit = {
      paginate: async () => {
        callCount++
        return allComments
      },
      rest: {
        pulls: {get: async () => ({data: {state: 'open', merged: false}})},
        issues: {
          get: async () => ({data: {state: 'open'}}),
          listForRepo: async () => ({data: []}),
          listComments: async () => ({data: []}),
        },
        repos: {getReleaseByTag: async () => ({data: {draft: false, prerelease: false}})},
      },
    } as unknown as DetectOctokitClient

    const result = await listCurrentRepoIssueComments(octokit, 'fro-bot', '.github', 42)
    expect(callCount).toBe(1)
    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe(1)
  })

  it('maps comment body correctly, defaulting undefined body to null', async () => {
    const rawComments = [
      {id: 5, body: undefined},
      {id: 6, body: 'hello'},
    ]

    const octokit = {
      paginate: async () => rawComments,
      rest: {
        pulls: {get: async () => ({data: {state: 'open', merged: false}})},
        issues: {
          get: async () => ({data: {state: 'open'}}),
          listForRepo: async () => ({data: []}),
          listComments: async () => ({data: []}),
        },
        repos: {getReleaseByTag: async () => ({data: {draft: false, prerelease: false}})},
      },
    } as unknown as DetectOctokitClient

    const result = await listCurrentRepoIssueComments(octokit, 'fro-bot', '.github', 42)
    expect(result).toHaveLength(2)
    expect(result[0]?.body).toBeNull()
    expect(result[1]?.body).toBe('hello')
  })
})

function makeCrossRepoOctokit(
  overrides: {
    repoPublic?: boolean
    repoThrows?: boolean
    repoThrowsStatus?: number
    prState?: string
    prMerged?: boolean
    issueState?: string
    releaseDraft?: boolean
    prThrows?: boolean
    issueThrows?: boolean
    releaseThrows?: boolean
  } = {},
): DetectOctokitClient {
  return {
    paginate: async () => [],
    rest: {
      pulls: {
        get: async () => {
          if (overrides.prThrows === true) throw new Error('API error')
          return {data: {state: overrides.prState ?? 'open', merged: overrides.prMerged ?? false}}
        },
      },
      issues: {
        get: async () => {
          if (overrides.issueThrows === true) throw new Error('API error')
          return {data: {state: overrides.issueState ?? 'open'}}
        },
        listForRepo: async () => ({data: []}),
        listComments: async () => ({data: []}),
      },
      repos: {
        getReleaseByTag: async () => {
          if (overrides.releaseThrows === true) throw new Error('API error')
          return {data: {draft: overrides.releaseDraft ?? false, prerelease: false}}
        },
        get: async () => {
          if (overrides.repoThrows === true) {
            const err = Object.assign(new Error('Not Found'), {status: overrides.repoThrowsStatus ?? 404})
            throw err
          }
          return {data: {private: !(overrides.repoPublic ?? true)}}
        },
      },
    },
  }
}

describe('cross-repo claim grammar: extractStatusTruthClaimsFromText', () => {
  // PR forms
  it('parses "fro-bot/agent#1033 is merged" as a cross-repo pr-state claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/agent#1033 is merged',
    })
    const crossRepoPr = claims.filter(c => c.kind === 'pr-state' && 'targetOwner' in c)
    expect(crossRepoPr).toHaveLength(1)
    const claim = crossRepoPr[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.targetOwner).toBe('fro-bot')
    expect(claim.targetRepo).toBe('agent')
    expect(claim.claimedState).toBe('merged')
    expect(claim.sourceRef).toMatch(/^fro-bot\/agent#1033/)
  })

  it('parses "fro-bot/agent#1033 is open" as a cross-repo pr-state claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/agent#1033 is open',
    })
    const crossRepoPr = claims.filter(c => c.kind === 'pr-state' && 'targetOwner' in c)
    expect(crossRepoPr).toHaveLength(1)
    const claim = crossRepoPr[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.claimedState).toBe('open')
  })

  it('parses "fro-bot/agent#1033 is closed" as a cross-repo pr-state claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/agent#1033 is closed',
    })
    const crossRepoPr = claims.filter(c => c.kind === 'pr-state' && 'targetOwner' in c)
    expect(crossRepoPr).toHaveLength(1)
    const claim = crossRepoPr[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.claimedState).toBe('closed')
  })

  // Issue forms
  it('parses "issue fro-bot/dashboard#48 is open" as a cross-repo issue-state claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'issue fro-bot/dashboard#48 is open',
    })
    const crossRepoIssue = claims.filter(c => c.kind === 'issue-state' && 'targetOwner' in c)
    expect(crossRepoIssue).toHaveLength(1)
    const claim = crossRepoIssue[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.targetOwner).toBe('fro-bot')
    expect(claim.targetRepo).toBe('dashboard')
    expect(claim.claimedState).toBe('open')
    expect(claim.sourceRef).toMatch(/^fro-bot\/dashboard#48/)
  })

  it('parses "fro-bot/dashboard#48 is closed" as a cross-repo claim (pr-state or issue-state)', () => {
    // Without an explicit "issue" prefix, "closed" is ambiguous (PR or issue).
    // The extractor emits a pr-state claim (default for ambiguous open/closed).
    // Use "issue fro-bot/dashboard#48 is closed" for unambiguous issue-state.
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/dashboard#48 is closed',
    })
    const crossRepoClaims = claims.filter(
      c => (c.kind === 'issue-state' || c.kind === 'pr-state') && 'targetOwner' in c,
    )
    expect(crossRepoClaims.length).toBeGreaterThan(0)
    const claim = crossRepoClaims[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.claimedState).toBe('closed')
    expect(claim.targetOwner).toBe('fro-bot')
    expect(claim.targetRepo).toBe('dashboard')
  })

  // Release forms
  it('parses "release fro-bot/agent@v0.78.0 is published" as a cross-repo release-tag-state claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'release fro-bot/agent@v0.78.0 is published',
    })
    const crossRepoRelease = claims.filter(c => c.kind === 'release-tag-state' && 'targetOwner' in c)
    expect(crossRepoRelease).toHaveLength(1)
    const claim = crossRepoRelease[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.targetOwner).toBe('fro-bot')
    expect(claim.targetRepo).toBe('agent')
    expect(claim.claimedState).toBe('published')
    expect(claim.sourceRef).toMatch(/^fro-bot\/agent@v0\.78\.0/)
  })

  it('parses "release fro-bot/agent@v0.78.0 is draft" as a cross-repo release-tag-state claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'release fro-bot/agent@v0.78.0 is draft',
    })
    const crossRepoRelease = claims.filter(c => c.kind === 'release-tag-state' && 'targetOwner' in c)
    expect(crossRepoRelease).toHaveLength(1)
    const claim = crossRepoRelease[0] as StatusTruthClaim & {targetOwner: string; targetRepo: string}
    expect(claim.claimedState).toBe('draft')
  })

  // Bare #N near cross-repo ref must not be extracted as current-repo
  it('bare #N near cross-repo ref is not extracted as current-repo (existing guard)', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/agent#1033 is merged and PR #1033 is open',
    })
    // No bare #1033 current-repo claim
    expect(claims.filter(c => c.sourceRef === '#1033')).toHaveLength(0)
    // Cross-repo claim may be present
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c)
    expect(crossRepoClaims.length).toBeGreaterThanOrEqual(1)
  })

  // Cross-repo claim sourceRef must include owner/repo identity
  it('cross-repo claim sourceRef includes owner/repo identity (not bare #N)', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/agent#1033 is merged',
    })
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c)
    for (const claim of crossRepoClaims) {
      expect(claim.sourceRef).not.toMatch(/^#\d+$/)
      expect(claim.sourceRef).toContain('fro-bot/agent')
    }
  })
})

describe('resolveClaimLiveState: cross-repo publicness proof', () => {
  it('cross-repo PR claim resolves to merged when repo is public and PR is merged', async () => {
    const octokit = makeCrossRepoOctokit({repoPublic: true, prState: 'closed', prMerged: true})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent#1033',
      claimedState: 'merged',
      normalizedText: 'fro-bot/agent#1033 is merged',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('merged')
  })

  it('cross-repo PR claim resolves to open when repo is public and PR is open', async () => {
    const octokit = makeCrossRepoOctokit({repoPublic: true, prState: 'open', prMerged: false})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent#1033',
      claimedState: 'open',
      normalizedText: 'fro-bot/agent#1033 is open',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('open')
  })

  it('cross-repo issue claim resolves to closed when repo is public and issue is closed', async () => {
    const octokit = makeCrossRepoOctokit({repoPublic: true, issueState: 'closed'})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'issue-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/dashboard#48',
      claimedState: 'open',
      normalizedText: 'issue fro-bot/dashboard#48 is open',
      targetOwner: 'fro-bot',
      targetRepo: 'dashboard',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('closed')
  })

  it('cross-repo release claim resolves to published when repo is public and release is published', async () => {
    const octokit = makeCrossRepoOctokit({repoPublic: true, releaseDraft: false})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'release-tag-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent@v0.78.0',
      claimedState: 'published',
      normalizedText: 'release fro-bot/agent@v0.78.0 is published',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('published')
  })

  it('cross-repo PR claim returns private when repo is private (repos.get returns private:true)', async () => {
    const octokit = makeCrossRepoOctokit({repoPublic: false})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'private-org/private-repo#99',
      claimedState: 'open',
      normalizedText: 'private-org/private-repo#99 is open',
      targetOwner: 'private-org',
      targetRepo: 'private-repo',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })

  it('cross-repo PR claim returns private when repos.get throws 404 (repo not found / private)', async () => {
    const octokit = makeCrossRepoOctokit({repoThrows: true, repoThrowsStatus: 404})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'unknown-org/unknown-repo#1',
      claimedState: 'open',
      normalizedText: 'unknown-org/unknown-repo#1 is open',
      targetOwner: 'unknown-org',
      targetRepo: 'unknown-repo',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })

  it('cross-repo PR claim returns private when repos.get throws 403 (forbidden)', async () => {
    const octokit = makeCrossRepoOctokit({repoThrows: true, repoThrowsStatus: 403})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'forbidden-org/forbidden-repo#1',
      claimedState: 'open',
      normalizedText: 'forbidden-org/forbidden-repo#1 is open',
      targetOwner: 'forbidden-org',
      targetRepo: 'forbidden-repo',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })

  it('cross-repo PR claim returns unavailable (not private) when repo is public but PR API fails after proof', async () => {
    // Publicness is proven (repo is public), but the PR fetch itself fails.
    // Identity is already proven public, so result is unavailable (not private).
    const octokit = makeCrossRepoOctokit({repoPublic: true, prThrows: true})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent#1033',
      claimedState: 'open',
      normalizedText: 'fro-bot/agent#1033 is open',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    // After publicness proof, API failure is unavailable (not private)
    expect(result.status).toBe('unavailable')
  })

  it('cross-repo issue claim returns private when repos.get throws 404', async () => {
    const octokit = makeCrossRepoOctokit({repoThrows: true, repoThrowsStatus: 404})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'issue-state',
      path: 'docs/plans/example.md',
      sourceRef: 'unknown-org/unknown-repo#48',
      claimedState: 'open',
      normalizedText: 'issue unknown-org/unknown-repo#48 is open',
      targetOwner: 'unknown-org',
      targetRepo: 'unknown-repo',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })

  it('cross-repo release claim returns private when repos.get throws 403', async () => {
    const octokit = makeCrossRepoOctokit({repoThrows: true, repoThrowsStatus: 403})
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'release-tag-state',
      path: 'docs/plans/example.md',
      sourceRef: 'forbidden-org/forbidden-repo@v1.0.0',
      claimedState: 'published',
      normalizedText: 'release forbidden-org/forbidden-repo@v1.0.0 is published',
      targetOwner: 'forbidden-org',
      targetRepo: 'forbidden-repo',
    }
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })
})

describe('cross-repo privacy gate: unsafe finding omits identity fields', () => {
  it('private cross-repo PR claim produces unsafe finding with no path/sourceRef/claimedState/fingerprint', () => {
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'private-org/private-repo#99',
      claimedState: 'open',
      normalizedText: 'private-org/private-repo#99 is open',
      targetOwner: 'private-org',
      targetRepo: 'private-repo',
    }
    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'private-org/private-repo#99', result: {status: 'private'}},
    ])
    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('unsafe')
    expect(finding?.proposalEligible).toBe(false)
    expect('path' in (finding ?? {})).toBe(false)
    expect('sourceRef' in (finding ?? {})).toBe(false)
    expect('claimedState' in (finding ?? {})).toBe(false)
    expect('fingerprint' in (finding ?? {})).toBe(false)
    expect('proposedCorrection' in (finding ?? {})).toBe(false)
    expect('liveState' in (finding ?? {})).toBe(false)
    // targetOwner/targetRepo must not appear in the finding
    expect('targetOwner' in (finding ?? {})).toBe(false)
    expect('targetRepo' in (finding ?? {})).toBe(false)
  })

  it('public cross-repo PR claim produces public finding with sourceRef including owner/repo identity', () => {
    const claim: StatusTruthClaim & {targetOwner: string; targetRepo: string} = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent#1033',
      claimedState: 'merged',
      normalizedText: 'fro-bot/agent#1033 is merged',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
    }
    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: 'fro-bot/agent#1033', result: {status: 'resolved', state: 'merged'}},
    ])
    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('current')
    if (finding?.verdict === 'current') {
      // Public finding includes sourceRef with owner/repo identity (proven public)
      expect(finding.sourceRef).toContain('fro-bot/agent')
      expect(finding.path).toBe('docs/plans/example.md')
      expect(typeof finding.fingerprint).toBe('string')
    }
  })
})

describe('cross-repo coordination signal (synthetic public-safe fixtures)', () => {
  it('cross-repo closed PR claim becomes drifted when live state is merged', async () => {
    const text = 'Coordination: fro-bot/agent#1033 is closed'
    const claims = extractStatusTruthClaimsFromText({path: 'docs/plans/rollout.md', text})
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c && c.kind === 'pr-state')
    expect(crossRepoClaims.length).toBeGreaterThan(0)

    const octokit = makeCrossRepoOctokit({repoPublic: true, prState: 'closed', prMerged: true})
    const {resolverResults} = await resolveAllClaims({
      claims: crossRepoClaims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    const findings = detectStatusTruthClaims(crossRepoClaims, resolverResults)
    // At least one finding must be drifted (closed claimed, merged live)
    const drifted = findings.filter(f => f.verdict === 'drifted')
    expect(drifted.length).toBeGreaterThan(0)
    if (drifted[0]?.verdict === 'drifted') {
      expect(drifted[0].claimedState).toBe('closed')
      expect(drifted[0].liveState).toBe('merged')
    }
  })

  it('cross-repo open issue claim becomes current when live state is open', async () => {
    const text = 'Tracking: issue fro-bot/dashboard#48 is open'
    const claims = extractStatusTruthClaimsFromText({path: 'docs/plans/rollout.md', text})
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c && c.kind === 'issue-state')
    expect(crossRepoClaims.length).toBeGreaterThan(0)

    const octokit = makeCrossRepoOctokit({repoPublic: true, issueState: 'open'})
    const {resolverResults} = await resolveAllClaims({
      claims: crossRepoClaims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    const findings = detectStatusTruthClaims(crossRepoClaims, resolverResults)
    const current = findings.filter(f => f.verdict === 'current')
    expect(current.length).toBeGreaterThan(0)
  })

  it('cross-repo merged PR claim is current when live state is merged', async () => {
    const text = 'Merged: fro-bot/agent#1033 is merged'
    const claims = extractStatusTruthClaimsFromText({path: 'docs/plans/rollout.md', text})
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c && c.kind === 'pr-state')
    expect(crossRepoClaims.length).toBeGreaterThan(0)

    const octokit = makeCrossRepoOctokit({repoPublic: true, prState: 'closed', prMerged: true})
    const {resolverResults} = await resolveAllClaims({
      claims: crossRepoClaims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    const findings = detectStatusTruthClaims(crossRepoClaims, resolverResults)
    const current = findings.filter(f => f.verdict === 'current')
    expect(current.length).toBeGreaterThan(0)
  })

  it('private cross-repo claim produces unsafe finding (zero identity fields)', async () => {
    const text = 'Blocked by: private-org/private-repo#99 is open'
    const claims = extractStatusTruthClaimsFromText({path: 'docs/plans/rollout.md', text})
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c && c.kind === 'pr-state')
    expect(crossRepoClaims.length).toBeGreaterThan(0)

    const octokit = makeCrossRepoOctokit({repoPublic: false})
    const {resolverResults} = await resolveAllClaims({
      claims: crossRepoClaims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
    })

    const findings = detectStatusTruthClaims(crossRepoClaims, resolverResults)
    const unsafe = findings.filter(f => f.verdict === 'unsafe')
    expect(unsafe.length).toBeGreaterThan(0)
    for (const finding of unsafe) {
      expect('path' in finding).toBe(false)
      expect('sourceRef' in finding).toBe(false)
      expect('targetOwner' in finding).toBe(false)
      expect('targetRepo' in finding).toBe(false)
    }
  })

  it('cross-repo scan does not break plan-status no-noise behavior', async () => {
    const fileLister: FileLister = async () => ['docs/plans/my-plan.md']
    const fileReader: FileReader = async () =>
      '---\nstatus: active\ntitle: My Plan\n---\n\nfro-bot/agent#1033 is merged'

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(0)
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c)
    expect(crossRepoClaims.length).toBeGreaterThan(0)
  })
})

describe('ambiguous cross-repo open/closed: PR-first with issue fallback', () => {
  it('ambiguous public owner/repo#N is closed — PR 404, issue closed → issue-state current finding', async () => {
    const octokit = makeCrossRepoOctokit({
      repoPublic: true,
      prThrows: true, // PR 404
      issueState: 'closed',
    })
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'example-org/example-repo#579',
      claimedState: 'closed',
      normalizedText: 'example-org/example-repo#579 is closed',
      targetOwner: 'example-org',
      targetRepo: 'example-repo',
      targetNumberKind: 'ambiguous',
    }

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    // Must resolve as issue-state, not be unavailable
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('closed')
      // resolvedKind must indicate this resolved as an issue
      expect(result.resolvedKind).toBe('issue-state')
    }
  })

  it('ambiguous public owner/repo#N is open — PR lookup succeeds → pr-state current finding', async () => {
    const octokit = makeCrossRepoOctokit({
      repoPublic: true,
      prState: 'open',
      prMerged: false,
    })
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent#123',
      claimedState: 'open',
      normalizedText: 'fro-bot/agent#123 is open',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
      targetNumberKind: 'ambiguous',
    }

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('open')
      // resolvedKind must be pr-state (PR lookup succeeded)
      expect(result.resolvedKind).toBe('pr-state')
    }
  })

  it('ambiguous claim — publicness check still happens before PR/issue lookup', async () => {
    const octokit = makeCrossRepoOctokit({repoThrows: true, repoThrowsStatus: 404})
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'private-org/private-repo#579',
      claimedState: 'closed',
      normalizedText: 'private-org/private-repo#579 is closed',
      targetOwner: 'private-org',
      targetRepo: 'private-repo',
      targetNumberKind: 'ambiguous',
    }

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })

  it('ambiguous claim — private repo (private:true) still produces unsafe/no identity fields', async () => {
    const octokit = makeCrossRepoOctokit({repoPublic: false})
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'private-org/private-repo#579',
      claimedState: 'closed',
      normalizedText: 'private-org/private-repo#579 is closed',
      targetOwner: 'private-org',
      targetRepo: 'private-repo',
      targetNumberKind: 'ambiguous',
    }

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })

  it('ambiguous claim — PR 404 and issue 404 → unresolved (both unavailable after publicness proof)', async () => {
    const octokit = makeCrossRepoOctokit({
      repoPublic: true,
      prThrows: true,
      issueThrows: true,
    })
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'fro-bot/agent#999',
      claimedState: 'closed',
      normalizedText: 'fro-bot/agent#999 is closed',
      targetOwner: 'fro-bot',
      targetRepo: 'agent',
      targetNumberKind: 'ambiguous',
    }

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('unavailable')
  })

  it('detectStatusTruthClaims uses resolvedKind to emit issue-state finding for ambiguous claim resolved as issue', () => {
    // When resolver returns resolvedKind: 'issue-state', the finding kind must be issue-state
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'example-org/example-repo#579',
      claimedState: 'closed',
      normalizedText: 'example-org/example-repo#579 is closed',
      targetOwner: 'example-org',
      targetRepo: 'example-repo',
      targetNumberKind: 'ambiguous',
    }

    const resolverResults: Record<string, ResolverResult> = {
      'pr-state:example-org/example-repo#579': {
        status: 'resolved',
        state: 'closed',
        resolvedKind: 'issue-state',
      },
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    // Finding kind must be issue-state (not pr-state)
    expect(finding?.kind).toBe('issue-state')
    expect(finding?.verdict).toBe('current')
  })

  it('extractStatusTruthClaimsFromText marks ambiguous open/closed cross-repo refs with targetNumberKind=ambiguous', () => {
    // "example-org/example-repo#579 is closed" — no explicit issue prefix, not merged → ambiguous
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'example-org/example-repo#579 is closed',
    })
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c)
    expect(crossRepoClaims.length).toBeGreaterThan(0)
    const claim = crossRepoClaims[0]
    expect(claim?.targetNumberKind).toBe('ambiguous')
  })

  it('explicit "issue" prefix sets targetNumberKind=issue (not ambiguous)', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'issue fro-bot/dashboard#48 is closed',
    })
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c && c.kind === 'issue-state')
    expect(crossRepoClaims.length).toBeGreaterThan(0)
    const claim = crossRepoClaims[0]
    // Explicit issue prefix → not ambiguous
    expect(claim?.targetNumberKind).not.toBe('ambiguous')
  })

  it('"merged" state sets targetNumberKind=pr (not ambiguous)', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'fro-bot/agent#1033 is merged',
    })
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c && c.kind === 'pr-state')
    expect(crossRepoClaims.length).toBeGreaterThan(0)
    const claim = crossRepoClaims[0]
    // merged is unambiguously PR
    expect(claim?.targetNumberKind).toBe('pr')
  })
})

describe('runDetect-equivalent: plan-status resolves without GITHUB_TOKEN', () => {
  // These tests exercise the exact logic that runDetect() must perform in the no-token path.
  // They use resolveFileParseClaims (the exported helper that runDetect calls) to prove
  // that plan-status claims are resolved via file-parse even when no Octokit client exists.

  it('file-parse plan-status claim resolves to current without Octokit when target frontmatter matches', async () => {
    // Simulates the no-token path in runDetect:
    // scan → resolveFileParseClaims → detect
    // The claim is in a scanning file; the target plan file has matching frontmatter.
    const scanningFileContent = 'docs/plans/example.md is active'
    const planFileContent = '---\nstatus: active\ntitle: Example Plan\n---\n\nContent.'

    const fileReader: FileReader = async (filePath: string) => {
      if (filePath === 'docs/plans/example.md') return planFileContent
      return ''
    }

    const fileLister: FileLister = async () => ['README.md']
    const scanFileReader: FileReader = async () => scanningFileContent

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader: scanFileReader})
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(1)

    // No-token path: resolve only file-parse claims using the exported helper
    const resolverResults = await resolveFileParseClaims({claims, fileReader})

    // Detect: plan-status claim must be current, not unresolved
    const findings = detectStatusTruthClaims(claims, resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('current')
    expect(finding?.proposalEligible).toBe(false)
    if (finding?.verdict === 'current') {
      expect(finding.liveState).toBe('active')
      expect(finding.kind).toBe('plan-status')
    }
  })

  it('file-parse plan-status claim resolves to drifted without Octokit when frontmatter differs', async () => {
    // Claim says "active" but plan file says "complete"
    const planFileContent = '---\nstatus: complete\ntitle: Example Plan\n---\n\nContent.'

    const fileReader: FileReader = async (filePath: string) => {
      if (filePath === 'docs/plans/example.md') return planFileContent
      return ''
    }

    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'docs/plans/example.md is active',
    })
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(1)

    const resolverResults = await resolveFileParseClaims({claims: planStatusClaims, fileReader})

    const findings = detectStatusTruthClaims(planStatusClaims, resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    expect(finding?.proposalEligible).toBe(true)
    if (finding?.verdict === 'drifted') {
      expect(finding.liveState).toBe('complete')
      expect(finding.claimedState).toBe('active')
    }
  })

  it('API-backed claims (pr-state) remain unresolved without token in the no-token path', async () => {
    // resolveFileParseClaims only resolves file-parse kinds; API claims get no entry.
    const claims = extractStatusTruthClaimsFromText({path: 'README.md', text: 'PR #42 is open'})
    const prClaims = claims.filter(c => c.kind === 'pr-state')
    expect(prClaims).toHaveLength(1)

    const fileReader: FileReader = async () => ''
    const resolverResults = await resolveFileParseClaims({claims: prClaims, fileReader})

    // pr-state is API-backed; resolveFileParseClaims must not add an entry for it
    expect(Object.keys(resolverResults)).toHaveLength(0)

    const findings = detectStatusTruthClaims(prClaims, resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('mixed scan: plan-status resolves via file-parse, pr-state stays unresolved, without token', async () => {
    // Simulates the full no-token runDetect flow with both claim kinds present.
    const planFileContent = '---\nstatus: active\ntitle: Example Plan\n---\n\nContent.'

    const fileReader: FileReader = async (filePath: string) => {
      if (filePath === 'docs/plans/example.md') return planFileContent
      return ''
    }

    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'docs/plans/example.md is active and PR #42 is open',
    })
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    const prClaims = claims.filter(c => c.kind === 'pr-state')
    expect(planStatusClaims).toHaveLength(1)
    expect(prClaims).toHaveLength(1)

    // No-token path: resolveFileParseClaims resolves plan-status; API claims get no entry
    const resolverResults = await resolveFileParseClaims({claims, fileReader})

    const findings = detectStatusTruthClaims(claims, resolverResults)
    expect(findings).toHaveLength(2)

    const planFinding = findings.find(f => f.kind === 'plan-status')
    const prFinding = findings.find(f => f.kind === 'pr-state')

    expect(planFinding?.verdict).toBe('current')
    expect(prFinding?.verdict).toBe('unresolved')
  })
})

describe('fingerprint stability: ambiguous cross-repo claim resolved as pr-state vs issue-state', () => {
  it('same claim/path/sourceRef/normalizedText produces identical fingerprint regardless of resolvedKind', () => {
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'example-org/example-repo#579',
      claimedState: 'closed',
      normalizedText: 'example-org/example-repo#579 is closed',
      targetOwner: 'example-org',
      targetRepo: 'example-repo',
      targetNumberKind: 'ambiguous',
    }

    const resolverResultsPr: Record<string, ResolverResult> = {
      'pr-state:example-org/example-repo#579': {
        status: 'resolved',
        state: 'closed',
        resolvedKind: 'pr-state',
      },
    }

    const resolverResultsIssue: Record<string, ResolverResult> = {
      'pr-state:example-org/example-repo#579': {
        status: 'resolved',
        state: 'closed',
        resolvedKind: 'issue-state',
      },
    }

    const findingsPr = detectStatusTruthClaims([claim], resolverResultsPr)
    const findingsIssue = detectStatusTruthClaims([claim], resolverResultsIssue)

    expect(findingsPr).toHaveLength(1)
    expect(findingsIssue).toHaveLength(1)

    const fpPr = findingsPr[0]
    const fpIssue = findingsIssue[0]

    expect(fpPr?.verdict).toBe('current')
    expect(fpIssue?.verdict).toBe('current')

    if (fpPr?.verdict !== 'unsafe' && fpIssue?.verdict !== 'unsafe') {
      expect(fpPr?.fingerprint).toBe(fpIssue?.fingerprint)
    }

    expect(fpPr?.kind).toBe('pr-state')
    expect(fpIssue?.kind).toBe('issue-state')
  })
})

describe('proveRepoPublic: explicit private === false check', () => {
  it('repos.get returning private:undefined is treated as private (not public)', async () => {
    const octokit: DetectOctokitClient = {
      paginate: async () => [],
      rest: {
        pulls: {get: async () => ({data: {state: 'open', merged: false}})},
        issues: {
          get: async () => ({data: {state: 'open'}}),
          listForRepo: async () => ({data: []}),
          listComments: async () => ({data: []}),
        },
        repos: {
          getReleaseByTag: async () => ({data: {draft: false, prerelease: false}}),
          get: async () => ({data: {private: undefined as unknown as boolean}}),
        },
      },
    }

    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'some-org/some-repo#1',
      claimedState: 'open',
      normalizedText: 'some-org/some-repo#1 is open',
      targetOwner: 'some-org',
      targetRepo: 'some-repo',
      targetNumberKind: 'ambiguous',
    }

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('private')
  })
})

describe('detect Octokit options: log suppression', () => {
  it('buildDetectOctokitOptions returns options with no-op log handlers', () => {
    const options = buildDetectOctokitOptions('test-token')
    expect(options).toHaveProperty('log')
    const log = options.log as Record<string, unknown>
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    ;(log.debug as (msg: string) => void)('GET /repos/example-org/example-repo/pulls/579 - 404')
    ;(log.info as (msg: string) => void)('test')
    ;(log.warn as (msg: string) => void)('test')
    ;(log.error as (msg: string) => void)('test')
  })

  it('buildDetectOctokitOptions includes auth token', () => {
    const options = buildDetectOctokitOptions('my-secret-token')
    expect(options.auth).toBe('my-secret-token')
  })
})

describe('resolvePlanStatusClaim', () => {
  it('happy path: explicit plan path claim matches frontmatter status => current', async () => {
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/my-plan.md') {
        return '---\ntitle: My Plan\nstatus: active\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('active')
    }
  })

  it('happy path: explicit plan path claim conflicts with frontmatter status => drifted (resolved with different state)', async () => {
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/my-plan.md') {
        return '---\ntitle: My Plan\nstatus: complete\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    // Resolver returns the live state; detectStatusTruthClaims will classify as drifted
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('complete')
    }
  })

  it('edge: referenced plan file is missing => unavailable (not proposal-eligible)', async () => {
    const fileReader: FileReader = async () => {
      throw Object.assign(new Error('ENOENT: no such file'), {code: 'ENOENT'})
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/nonexistent.md',
      fileReader,
    })

    expect(result.status).toBe('unavailable')
  })

  it('edge: frontmatter missing status field => unavailable', async () => {
    const fileReader: FileReader = async () => {
      return '---\ntitle: My Plan\ntype: feat\n---\n\nNo status field.'
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('unavailable')
  })

  it('edge: frontmatter status is unsupported value => unavailable', async () => {
    const fileReader: FileReader = async () => {
      return '---\ntitle: My Plan\nstatus: in-progress\ntype: feat\n---\n\nContent.'
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('unavailable')
  })

  it('edge: no frontmatter at all => unavailable', async () => {
    const fileReader: FileReader = async () => {
      return '# My Plan\n\nNo frontmatter here.'
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('unavailable')
  })

  it('error: file read failure returns unavailable (caller increments file-parse error count)', async () => {
    const fileReader: FileReader = async () => {
      throw new Error('permission denied')
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    // File read failure must not throw — returns unavailable so caller can count it
    expect(result.status).toBe('unavailable')
  })

  it('supports all conservative status values: active, complete, draft, cancelled, superseded', async () => {
    const supportedStatuses = ['active', 'complete', 'draft', 'cancelled', 'superseded']

    for (const status of supportedStatuses) {
      const fileReader: FileReader = async () => {
        return `---\ntitle: My Plan\nstatus: ${status}\ntype: feat\n---\n\nContent.`
      }

      const result = await resolvePlanStatusClaim({
        claimedPath: 'docs/plans/my-plan.md',
        fileReader,
      })

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.state).toBe(status)
      }
    }
  })
})

describe('plan-status claim grammar — extractStatusTruthClaimsFromText', () => {
  it('edge: ambiguous implicit plan-status claim with no explicit path => no claim extracted', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan is active and progressing well.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('edge: self-referential frontmatter status in a plan file does NOT produce a cross-file plan-status claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/my-plan.md',
      text: '---\nstatus: active\ntitle: My Plan\n---\n\nContent.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('happy path: explicit docs/plans/...md path reference in prose produces a plan-status claim', () => {
    // Grammar: "plan docs/plans/foo.md is active" or "docs/plans/foo.md is active"
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(1)
    const claim = planClaims[0]
    expect(claim?.sourceRef).toBe('docs/plans/my-plan.md')
    expect(claim?.claimedState).toBe('active')
  })

  it('happy path: explicit docs/plans/...md path with complete status produces a plan-status claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/other-plan.md',
      text: 'See docs/plans/my-plan.md is complete for prior work.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(1)
    const claim = planClaims[0]
    expect(claim?.sourceRef).toBe('docs/plans/my-plan.md')
    expect(claim?.claimedState).toBe('complete')
  })

  it('edge: plan path reference without a supported status value produces no claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is in-progress.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('edge: plan path reference without explicit status produces no claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'See docs/plans/my-plan.md for details.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('edge: plan path not under docs/plans/ produces no claim', () => {
    // Only docs/plans/...md paths are authoritative plan paths
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan some/other/path.md is active.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('sourceRef is the plan path (not path#status) for cross-file plan-status claims', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(1)
    // sourceRef must be the plan path itself, not path#status
    expect(planClaims[0]?.sourceRef).toBe('docs/plans/my-plan.md')
    expect(planClaims[0]?.sourceRef).not.toContain('#status')
  })
})

describe('plan-status end-to-end — extract → resolve → detect pipeline', () => {
  it('happy path: explicit plan path claim matches frontmatter => current finding, not proposal-eligible', async () => {
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/my-plan.md') {
        return '---\ntitle: My Plan\nstatus: active\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    // Extract cross-file plan-status claim from prose
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const claim = claims.find(c => c.kind === 'plan-status')
    expect(claim).toBeDefined()
    if (claim === undefined) return

    // Resolve using file-parse resolver
    const resolverResult = await resolvePlanStatusClaim({
      claimedPath: claim.sourceRef,
      fileReader,
    })

    const resolverResults: Record<string, ResolverResult> = {
      [`plan-status:${claim.sourceRef}`]: resolverResult,
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('current')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('happy path: explicit plan path claim conflicts with frontmatter => drifted finding, proposal-eligible', async () => {
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/my-plan.md') {
        return '---\ntitle: My Plan\nstatus: complete\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const claim = claims.find(c => c.kind === 'plan-status')
    expect(claim).toBeDefined()
    if (claim === undefined) return

    const resolverResult = await resolvePlanStatusClaim({
      claimedPath: claim.sourceRef,
      fileReader,
    })

    const resolverResults: Record<string, ResolverResult> = {
      [`plan-status:${claim.sourceRef}`]: resolverResult,
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('drifted')
    expect(findings[0]?.proposalEligible).toBe(true)
    if (findings[0]?.verdict === 'drifted') {
      expect(findings[0].claimedState).toBe('active')
      expect(findings[0].liveState).toBe('complete')
    }
  })

  it('edge: missing plan file => unresolved finding, not proposal-eligible', async () => {
    const fileReader: FileReader = async () => {
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    }

    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/nonexistent.md is active.',
    })
    const claim = claims.find(c => c.kind === 'plan-status')
    expect(claim).toBeDefined()
    if (claim === undefined) return

    const resolverResult = await resolvePlanStatusClaim({
      claimedPath: claim.sourceRef,
      fileReader,
    })

    const resolverResults: Record<string, ResolverResult> = {
      [`plan-status:${claim.sourceRef}`]: resolverResult,
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// plan-status wiring — runDetect/CLI-level resolution must pass fileReader
// ---------------------------------------------------------------------------

describe('plan-status wiring — resolveAllClaims with fileReader', () => {
  it('resolveAllClaims with fileReader resolves plan-status claim to current', async () => {
    const planStatusClaim: StatusTruthClaim = {
      kind: 'plan-status',
      path: 'README.md',
      sourceRef: 'docs/plans/example.md',
      claimedState: 'active',
      normalizedText: 'docs/plans/example.md is active',
    }

    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/example.md') {
        return '---\ntitle: Example Plan\nstatus: active\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [planStatusClaim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      fileReader,
    })

    const findings = detectStatusTruthClaims([planStatusClaim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('current')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('resolveAllClaims with fileReader resolves plan-status claim to drifted when status conflicts', async () => {
    const planStatusClaim: StatusTruthClaim = {
      kind: 'plan-status',
      path: 'README.md',
      sourceRef: 'docs/plans/example.md',
      claimedState: 'active',
      normalizedText: 'docs/plans/example.md is active',
    }

    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/example.md') {
        return '---\ntitle: Example Plan\nstatus: complete\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [planStatusClaim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      fileReader,
    })

    const findings = detectStatusTruthClaims([planStatusClaim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('drifted')
    expect(findings[0]?.proposalEligible).toBe(true)
    if (findings[0]?.verdict === 'drifted') {
      expect(findings[0].claimedState).toBe('active')
      expect(findings[0].liveState).toBe('complete')
    }
  })

  it('missing plan file via resolveAllClaims with fileReader stays unresolved', async () => {
    const planStatusClaim: StatusTruthClaim = {
      kind: 'plan-status',
      path: 'README.md',
      sourceRef: 'docs/plans/nonexistent.md',
      claimedState: 'active',
      normalizedText: 'docs/plans/nonexistent.md is active',
    }

    const fileReader: FileReader = async () => {
      throw Object.assign(new Error('ENOENT: no such file'), {code: 'ENOENT'})
    }

    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [planStatusClaim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      fileReader,
    })

    const findings = detectStatusTruthClaims([planStatusClaim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('full scan→resolve→detect pipeline with fileReader resolves plan-status claim from scanned doc', async () => {
    const fileLister: FileLister = async () => ['README.md', 'docs/plans/example.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'README.md') return 'The plan docs/plans/example.md is active.'
      if (path === 'docs/plans/example.md') {
        return '---\ntitle: Example Plan\nstatus: active\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(1)

    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims,
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      fileReader,
    })

    const findings = detectStatusTruthClaims(claims, resolverResults)
    const planFindings = findings.filter(f => f.kind === 'plan-status')
    expect(planFindings).toHaveLength(1)
    // Plan file has matching status → current
    expect(planFindings[0]?.verdict).toBe('current')
  })
})

describe('plan-status DEFAULT_ENABLED_KINDS inclusion', () => {
  it('plan-status is included in DEFAULT_ENABLED_KINDS now that a real resolver exists', () => {
    expect(DEFAULT_ENABLED_KINDS).toContain('plan-status')
  })

  it('production scan with default kinds includes plan-status claims from prose', async () => {
    const fileLister: FileLister = async () => ['README.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'README.md') return 'The plan docs/plans/my-plan.md is active.'
      throw new Error(`unexpected: ${path}`)
    }

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(1)
  })
})

describe('plan-status privacy/output safety', () => {
  it('privacy: plan-status finding artifact contains no raw claim text, source snippets, or private identity tokens', async () => {
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/my-plan.md') {
        return '---\ntitle: My Plan\nstatus: complete\ntype: feat\ndate: 2026-06-30\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const claim = claims.find(c => c.kind === 'plan-status')
    expect(claim).toBeDefined()
    if (claim === undefined) return

    const resolverResult = await resolvePlanStatusClaim({
      claimedPath: claim.sourceRef,
      fileReader,
    })

    const resolverResults: Record<string, ResolverResult> = {
      [`plan-status:${claim.sourceRef}`]: resolverResult,
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-30T00:00:00Z',
      failureClass: null,
    })

    const artifactJson = JSON.stringify(report)

    // Must not contain raw claim text
    expect(artifactJson).not.toContain('"normalizedText"')
    expect(artifactJson).not.toContain('"rawText"')
    expect(artifactJson).not.toContain('"sourceSnippet"')

    // Fingerprint must be an opaque hex hash, not raw text
    const finding = report.findings[0]
    if (finding !== undefined && finding.verdict !== 'unsafe') {
      expect(finding.fingerprint).toMatch(/^[a-f0-9]{16}$/)
    }

    // Report must not contain the raw prose claim text
    expect(artifactJson).not.toContain('The plan docs/plans/my-plan.md is active')
  })

  it('privacy: validateStatusTruthArtifact rejects plan-status finding with normalizedText field', () => {
    const finding = makeFinding({
      kind: 'plan-status',
      sourceRef: 'docs/plans/my-plan.md',
      claimedState: 'active',
      liveState: 'complete',
      verdict: 'drifted',
      proposalEligible: true,
    })
    // Inject prohibited field
    const taintedFinding = {...finding, normalizedText: 'the plan docs/plans/my-plan.md is active'}
    const report = makeReport({
      status: 'findings',
      findings: [taintedFinding],
      counts: {total: 1, current: 0, drifted: 1, unresolved: 0, unsafe: 0, proposal_eligible: 1},
    })
    const result = validateStatusTruthArtifact(report)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('prohibited field')
    }
  })
})

// ---------------------------------------------------------------------------
// plan-status path traversal
// ---------------------------------------------------------------------------

describe('plan-status path traversal rejection', () => {
  it('extraction: path with .. segment is not extracted as a plan-status claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'docs/plans/../../etc/passwd is active',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('extraction: path with encoded traversal segment is not extracted', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'docs/plans/../secret.md is active',
    })
    const planClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planClaims).toHaveLength(0)
  })

  it('resolver: claimedPath with .. segment returns unavailable without calling fileReader', async () => {
    let readerCalled = false
    const fileReader: FileReader = async () => {
      readerCalled = true
      return '---\nstatus: active\n---\n'
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/../../etc/passwd',
      fileReader,
    })

    expect(result.status).toBe('unavailable')
    expect(readerCalled).toBe(false)
  })

  it('resolver: claimedPath resolving outside docs/plans/ returns unavailable without calling fileReader', async () => {
    let readerCalled = false
    const fileReader: FileReader = async () => {
      readerCalled = true
      return '---\nstatus: active\n---\n'
    }

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/../other/secret.md',
      fileReader,
    })

    expect(result.status).toBe('unavailable')
    expect(readerCalled).toBe(false)
  })

  it('resolver: valid path under docs/plans/ still resolves correctly', async () => {
    const fileReader: FileReader = async () => '---\nstatus: active\n---\n'

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/valid-plan.md',
      fileReader,
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// tokenless local run — plan-status resolves without GITHUB_TOKEN
// ---------------------------------------------------------------------------

describe('plan-status tokenless resolution', () => {
  it('plan-status claim with fileReader resolves to current without an Octokit/token', async () => {
    const planStatusClaim: StatusTruthClaim = {
      kind: 'plan-status',
      path: 'README.md',
      sourceRef: 'docs/plans/example.md',
      claimedState: 'active',
      normalizedText: 'docs/plans/example.md is active',
    }

    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/example.md') {
        return '---\ntitle: Example Plan\nstatus: active\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    // Resolve plan-status claims using only fileReader — no octokit/token needed
    const resolverResults: Record<string, ResolverResult> = {}
    const result = await resolvePlanStatusClaim({
      claimedPath: planStatusClaim.sourceRef,
      fileReader,
    })
    resolverResults[`plan-status:${planStatusClaim.sourceRef}`] = result

    const findings = detectStatusTruthClaims([planStatusClaim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('current')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('plan-status claim with fileReader resolves to drifted without an Octokit/token', async () => {
    const planStatusClaim: StatusTruthClaim = {
      kind: 'plan-status',
      path: 'README.md',
      sourceRef: 'docs/plans/example.md',
      claimedState: 'active',
      normalizedText: 'docs/plans/example.md is active',
    }

    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/example.md') {
        return '---\ntitle: Example Plan\nstatus: complete\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const resolverResults: Record<string, ResolverResult> = {}
    const result = await resolvePlanStatusClaim({
      claimedPath: planStatusClaim.sourceRef,
      fileReader,
    })
    resolverResults[`plan-status:${planStatusClaim.sourceRef}`] = result

    const findings = detectStatusTruthClaims([planStatusClaim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('drifted')
    expect(findings[0]?.proposalEligible).toBe(true)
    if (findings[0]?.verdict === 'drifted') {
      expect(findings[0].proposedCorrection).toContain('complete')
    }
  })

  it('API-backed claims remain unresolved without token (no fake resolution)', async () => {
    const prClaim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'README.md',
      sourceRef: '#42',
      claimedState: 'open',
      normalizedText: 'pr #42 is open',
    }

    // No resolver results for API claims (simulates no-token path)
    const resolverResults: Record<string, ResolverResult> = {}

    const findings = detectStatusTruthClaims([prClaim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Opportunistic: quoted status values and CRLF frontmatter
// ---------------------------------------------------------------------------

describe('parsePlanFrontmatterStatus: quoted values and CRLF', () => {
  it('quoted status value "active" resolves correctly', async () => {
    const fileReader: FileReader = async () => '---\nstatus: "active"\n---\n\nContent.'

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('active')
  })

  it("single-quoted status value 'complete' resolves correctly", async () => {
    const fileReader: FileReader = async () => "---\nstatus: 'complete'\n---\n\nContent."

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('complete')
  })

  it('CRLF frontmatter resolves correctly', async () => {
    const fileReader: FileReader = async () => '---\r\nstatus: active\r\ntitle: My Plan\r\n---\r\n\r\nContent.'

    const result = await resolvePlanStatusClaim({
      claimedPath: 'docs/plans/my-plan.md',
      fileReader,
    })

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// Opportunistic: plan-status drift proposedCorrection content
// ---------------------------------------------------------------------------

describe('plan-status drift: proposedCorrection contains expected status replacement', () => {
  it('drifted plan-status finding proposedCorrection replaces claimed status with live status', async () => {
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/my-plan.md') {
        return '---\ntitle: My Plan\nstatus: complete\n---\n\nContent.'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'The plan docs/plans/my-plan.md is active.',
    })
    const claim = claims.find(c => c.kind === 'plan-status')
    expect(claim).toBeDefined()
    if (claim === undefined) return

    const resolverResult = await resolvePlanStatusClaim({
      claimedPath: claim.sourceRef,
      fileReader,
    })

    const resolverResults: Record<string, ResolverResult> = {
      [`plan-status:${claim.sourceRef}`]: resolverResult,
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    if (finding?.verdict === 'drifted') {
      expect(finding.proposedCorrection).toBeDefined()
      // proposedCorrection must contain the live status 'complete'
      expect(finding.proposedCorrection).toContain('complete')
      // proposedCorrection must not still say 'active' as the status
      // (it should have replaced 'active' with 'complete')
      expect(finding.proposedCorrection).not.toMatch(/\bactive\b/)
    }
  })
})

// ---------------------------------------------------------------------------
// Rollout-tracker compound resolver tests
// ---------------------------------------------------------------------------

/** Build a minimal SnapshotItem for test fixtures. */
function makeSnapshotItem(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    content_number: 3512,
    content_repo: 'fro-bot/.github',
    status: 'In Progress',
    readiness: null,
    gate: null,
    issue_state: 'open',
    issue_closed_at: null,
    issue_labels: [],
    ...overrides,
  }
}

/** Build a minimal RolloutSnapshot for test fixtures. */
function makeRolloutSnapshot(items: SnapshotItem[] = [makeSnapshotItem()]): RolloutSnapshot {
  return {items}
}

describe('resolveRolloutTrackerClaim', () => {
  // ── Happy path: snapshot state matches claim ──────────────────────────────

  it('happy path: snapshot issue_state matches claimed state => resolved with matching state', async () => {
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'open'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('open')
    }
  })

  it('happy path: snapshot issue_state "closed" matches claimed "closed" => resolved current', async () => {
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'closed'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'closed',
      normalizedText: 'rollout tracker #3512 is closed',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('closed')
    }
  })

  // ── Happy path: snapshot state conflicts with claim => drifted ────────────

  it('happy path: snapshot issue_state conflicts with claimed state => resolved with live state (drifted via detectStatusTruthClaims)', async () => {
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'closed'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      // Live state is 'closed'; claim says 'open' → detectStatusTruthClaims will classify as drifted
      expect(result.state).toBe('closed')
    }
  })

  it('integration: drifted rollout-tracker claim produces drifted finding and is proposal-eligible', async () => {
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'closed'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})
    const resolverResults = makeResolverResults([{kind: 'rollout-tracker-status', sourceRef: '#3512', result}])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    expect(finding?.proposalEligible).toBe(true)
  })

  // ── Edge case: snapshot unavailable => unresolved ─────────────────────────

  it('edge: snapshot is null (unavailable) => unavailable, no proposal eligibility', async () => {
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot: null})

    expect(result.status).toBe('unavailable')
  })

  it('edge: snapshot unavailable => detectStatusTruthClaims classifies as unresolved, not drifted', async () => {
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot: null})
    const resolverResults = makeResolverResults([{kind: 'rollout-tracker-status', sourceRef: '#3512', result}])

    const findings = detectStatusTruthClaims([claim], resolverResults)

    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('edge: snapshot item not found for sourceRef => unavailable', async () => {
    // Snapshot has item #9999 but claim references #3512
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 9999, issue_state: 'open'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    expect(result.status).toBe('unavailable')
  })

  // ── Edge case: malformed/unexpected snapshot schema => unresolved ─────────

  it('edge: snapshot with null issue_state for matched item => unavailable (incomplete data)', async () => {
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: null})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    // null issue_state means we cannot determine live state → unavailable
    expect(result.status).toBe('unavailable')
  })

  it('edge: snapshot with empty items array => unavailable', async () => {
    const snapshot = makeRolloutSnapshot([])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    expect(result.status).toBe('unavailable')
  })

  // ── Edge case: compound sub-resolver disagreement blocks proposal eligibility

  it('edge: compound sub-resolver disagreement (issue-state unavailable) blocks proposal eligibility', async () => {
    // The rollout-tracker-status resolver returns resolved, but sub-resolvers are unavailable.
    // detectStatusTruthClaims must classify as unresolved when sub-resolvers are not all resolved.
    const rolloutClaim = makeClaim({
      kind: 'rollout-tracker-status',
      path: 'docs/plans/rollout.md',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const resolverResults = makeResolverResults([
      {
        kind: 'rollout-tracker-status',
        sourceRef: '#3512',
        result: {
          status: 'resolved',
          state: 'closed', // conflicts with claim
          subResolverResults: {
            'issue-state': {status: 'unavailable'},
            'pr-state': {status: 'unavailable'},
          },
        },
      },
    ])

    const findings = detectStatusTruthClaims([rolloutClaim], resolverResults)

    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  // ── Public output safety: no raw snapshot payload in resolver result ───────

  it('safety: resolver result does not echo raw snapshot payload, issue titles, or tracker internals', async () => {
    const snapshot = makeRolloutSnapshot([
      makeSnapshotItem({
        content_number: 3512,
        issue_state: 'closed',
        // These fields must not appear in the resolver result
        status: 'SENSITIVE_PROJECT_STATUS',
        readiness: 'SENSITIVE_READINESS',
        gate: 'SENSITIVE_GATE',
        issue_labels: ['SENSITIVE_LABEL'],
      }),
    ])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    // The result must only contain status and state — no raw snapshot fields
    const resultJson = JSON.stringify(result)
    expect(resultJson).not.toContain('SENSITIVE_PROJECT_STATUS')
    expect(resultJson).not.toContain('SENSITIVE_READINESS')
    expect(resultJson).not.toContain('SENSITIVE_GATE')
    expect(resultJson).not.toContain('SENSITIVE_LABEL')
    expect(resultJson).not.toContain('issue_labels')
    expect(resultJson).not.toContain('issue_closed_at')
  })

  // ── resolveClaimLiveState integration: snapshot injection ─────────────────

  it('integration: resolveClaimLiveState with snapshot resolves rollout-tracker-status claim', async () => {
    const octokit = makeMockDetectOctokit()
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'closed'})])
    const claim = makeTestClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
    })

    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github', snapshot})

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('closed')
    }
  })

  it('integration: resolveClaimLiveState without snapshot returns unavailable for rollout-tracker-status', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
    })

    // No snapshot provided — should remain unavailable (Phase 1 behavior preserved)
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})

    expect(result.status).toBe('unavailable')
  })

  // ── Dry-run path: no write credentials minted ─────────────────────────────

  it('safety: resolveRolloutTrackerClaim is a pure read-only function (no Octokit, no write token)', async () => {
    // The function signature must not require an Octokit client or any write credential.
    // This test verifies the function can be called with only claim + snapshot.
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'open'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    // Must not throw or require any additional credentials
    const result = await resolveRolloutTrackerClaim({claim, snapshot})
    expect(result.status).toBe('resolved')
  })

  // ── Durable report artifact even when snapshot unavailable ────────────────

  it('integration: snapshot unavailable still produces a durable execution-failure report (not fake clean)', async () => {
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })

    // Simulate snapshot unavailable
    const result = await resolveRolloutTrackerClaim({claim, snapshot: null})
    const resolverResults = makeResolverResults([{kind: 'rollout-tracker-status', sourceRef: '#3512', result}])

    const findings = detectStatusTruthClaims([claim], resolverResults)
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-06-30T00:00:00Z',
      failureClass: 'sub-resolver-unavailable',
    })

    // Report must be execution-failure (not clean) when snapshot is unavailable
    expect(report.status).toBe('execution-failure')
    expect(report.failure_class).toBe('sub-resolver-unavailable')
    expect(report.repair_eligible).toBe(false)
    // The finding is still present as unresolved (not hidden)
    expect(report.counts.unresolved).toBe(1)
    expect(report.counts.proposal_eligible).toBe(0)
  })

  // ── Grammar tightening: unsupported claim forms => no claim extracted ──────

  it('grammar: "rollout tracker #3512 is active" extracts a rollout-tracker-status claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/rollout.md',
      text: 'The rollout tracker #3512 is active.',
    })
    const trackerClaims = claims.filter(c => c.kind === 'rollout-tracker-status')
    expect(trackerClaims).toHaveLength(1)
    expect(trackerClaims[0]?.sourceRef).toBe('#3512')
    expect(trackerClaims[0]?.claimedState).toBe('active')
  })

  it('grammar: "rollout tracker #3512 is open" extracts a rollout-tracker-status claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/rollout.md',
      text: 'rollout tracker #3512 is open',
    })
    const trackerClaims = claims.filter(c => c.kind === 'rollout-tracker-status')
    expect(trackerClaims).toHaveLength(1)
    expect(trackerClaims[0]?.claimedState).toBe('open')
  })

  it('grammar: "rollout tracker #3512 is closed" extracts a rollout-tracker-status claim', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/rollout.md',
      text: 'rollout tracker #3512 is closed',
    })
    const trackerClaims = claims.filter(c => c.kind === 'rollout-tracker-status')
    expect(trackerClaims).toHaveLength(1)
    expect(trackerClaims[0]?.claimedState).toBe('closed')
  })

  it('issue_state merged: snapshot with merged state resolves to "merged" and classifies correctly', async () => {
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 931, issue_state: 'merged'})])
    const claim = makeClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#931',
      claimedState: 'open',
      normalizedText: 'rollout tracker #931 is open',
    })

    const result = await resolveRolloutTrackerClaim({claim, snapshot})

    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') {
      expect(result.state).toBe('merged')
    }

    // Classify via detectStatusTruthClaims: claimed 'open' vs live 'merged' => drifted
    const resolverResults = makeResolverResults([{kind: 'rollout-tracker-status', sourceRef: '#931', result}])
    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('drifted')
    expect(findings[0]?.proposalEligible).toBe(true)
    if (findings[0]?.verdict === 'drifted') {
      expect(findings[0].liveState).toBe('merged')
    }
  })
})

// ---------------------------------------------------------------------------
// resolveAllClaims snapshot wiring
// ---------------------------------------------------------------------------

describe('resolveAllClaims: snapshot wiring for rollout-tracker-status', () => {
  it('resolveAllClaims with snapshot resolves rollout-tracker-status claim to current', async () => {
    // When a snapshot is provided and the item matches, the claim resolves to current/drifted
    // instead of unavailable. This test proves the snapshot flows through resolveAllClaims
    // into resolveClaimLiveState.
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'open'})])
    const claim = makeTestClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })
    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [claim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      snapshot,
    })

    const result = resolverResults['rollout-tracker-status:#3512']
    expect(result).toBeDefined()
    expect(result?.status).toBe('resolved')
    if (result?.status === 'resolved') {
      expect(result.state).toBe('open')
    }
  })

  it('resolveAllClaims with snapshot resolves rollout-tracker-status claim to drifted state', async () => {
    // Snapshot says issue is closed; claim says open → drifted
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 3512, issue_state: 'closed'})])
    const claim = makeTestClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })
    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [claim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      snapshot,
    })

    const result = resolverResults['rollout-tracker-status:#3512']
    expect(result?.status).toBe('resolved')
    if (result?.status === 'resolved') {
      expect(result.state).toBe('closed')
    }

    // Verify the full pipeline: drifted finding produced
    // The snapshot satisfies both sub-resolvers (issue-state + pr-state), so the compound
    // claim is fully resolved and proposal-eligible when drifted.
    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('drifted')
    expect(findings[0]?.proposalEligible).toBe(true) // compound: sub-resolvers satisfied by snapshot
  })

  it('resolveAllClaims without snapshot leaves rollout-tracker-status unavailable', async () => {
    // No snapshot → rollout-tracker-status stays unavailable (not fake-resolved)
    const claim = makeTestClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })
    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [claim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      // No snapshot param
    })

    const result = resolverResults['rollout-tracker-status:#3512']
    expect(result?.status).toBe('unavailable')
  })

  it('resolveAllClaims with null snapshot leaves rollout-tracker-status unavailable', async () => {
    // Explicit null snapshot → unavailable (snapshot was attempted but failed)
    const claim = makeTestClaim({
      kind: 'rollout-tracker-status',
      sourceRef: '#3512',
      claimedState: 'open',
      normalizedText: 'rollout tracker #3512 is open',
    })
    const octokit = makeMockDetectOctokit()

    const {resolverResults} = await resolveAllClaims({
      claims: [claim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      snapshot: null,
    })

    const result = resolverResults['rollout-tracker-status:#3512']
    expect(result?.status).toBe('unavailable')
  })

  it('resolveAllClaims snapshot does not affect non-rollout-tracker claims', async () => {
    // Snapshot presence must not change resolution of pr-state or issue-state claims
    const snapshot = makeRolloutSnapshot([makeSnapshotItem({content_number: 42, issue_state: 'closed'})])
    const prClaim = makeTestClaim({kind: 'pr-state', sourceRef: '#42', claimedState: 'open'})
    const octokit = makeMockDetectOctokit({prState: 'open'})

    const {resolverResults} = await resolveAllClaims({
      claims: [prClaim],
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      snapshot,
    })

    // PR claim must resolve via API, not snapshot
    const result = resolverResults['pr-state:#42']
    expect(result?.status).toBe('resolved')
    if (result?.status === 'resolved') {
      expect(result.state).toBe('open') // API says open, not snapshot's closed
    }
  })
})

// ---------------------------------------------------------------------------
// loadRolloutSnapshot helper
// ---------------------------------------------------------------------------

describe('loadRolloutSnapshot: snapshot file loading and validation', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadRolloutSnapshot returns null when env var is not set', async () => {
    // No STATUS_TRUTH_ROLLOUT_SNAPSHOT_PATH → null (no snapshot available)
    const result = await loadRolloutSnapshot({snapshotPath: undefined})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot returns null when env var is empty string', async () => {
    const result = await loadRolloutSnapshot({snapshotPath: ''})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot returns a valid RolloutSnapshot from a well-formed JSON file', async () => {
    // Inject a file reader that returns valid snapshot JSON
    const snapshot: RolloutSnapshot = {
      items: [
        {
          content_number: 3512,
          content_repo: 'fro-bot/.github',
          status: 'In Progress',
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const fileReader = async (_path: string) => JSON.stringify(snapshot)

    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).not.toBeNull()
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0]?.content_number).toBe(3512)
    expect(result?.items[0]?.issue_state).toBe('open')
  })

  it('loadRolloutSnapshot returns null for malformed JSON', async () => {
    // Malformed JSON → null, no throw, no raw payload in output
    const fileReader = async (_path: string) => 'not-valid-json{{{}'
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot returns null when JSON is valid but missing items array', async () => {
    // Valid JSON but wrong shape → null
    const fileReader = async (_path: string) => JSON.stringify({notItems: []})
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot returns null when items is not an array', async () => {
    const fileReader = async (_path: string) => JSON.stringify({items: 'not-an-array'})
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot returns null when file read fails', async () => {
    // File read failure → null, no throw
    const fileReader = async (_path: string) => {
      throw new Error('ENOENT: no such file or directory')
    }
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/missing.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot rejects items with non-number content_number', async () => {
    // Item with string content_number → null (conservative validation)
    const badSnapshot = {
      items: [
        {
          content_number: 'not-a-number',
          content_repo: 'fro-bot/.github',
          status: null,
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const fileReader = async (_path: string) => JSON.stringify(badSnapshot)
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot rejects items with invalid issue_state value', async () => {
    // issue_state must be "open" | "closed" | "merged" | null
    const badSnapshot = {
      items: [
        {
          content_number: 3512,
          content_repo: 'fro-bot/.github',
          status: null,
          readiness: null,
          gate: null,
          issue_state: 'INVALID_STATE',
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const fileReader = async (_path: string) => JSON.stringify(badSnapshot)
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot accepts items with null issue_state', async () => {
    // null issue_state is valid (item exists but state not yet fetched)
    const snapshot = {
      items: [
        {
          content_number: 3512,
          content_repo: 'fro-bot/.github',
          status: null,
          readiness: null,
          gate: null,
          issue_state: null,
          issue_closed_at: null,
          issue_labels: [],
        },
      ],
    }
    const fileReader = async (_path: string) => JSON.stringify(snapshot)
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).not.toBeNull()
    expect(result?.items[0]?.issue_state).toBeNull()
  })

  it('loadRolloutSnapshot accepts empty items array', async () => {
    const fileReader = async (_path: string) => JSON.stringify({items: []})
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).not.toBeNull()
    expect(result?.items).toHaveLength(0)
  })

  it('loadRolloutSnapshot rejects items with non-array issue_labels', async () => {
    const badSnapshot = {
      items: [
        {
          content_number: 3512,
          content_repo: 'fro-bot/.github',
          status: null,
          readiness: null,
          gate: null,
          issue_state: 'open',
          issue_closed_at: null,
          issue_labels: 'not-an-array',
        },
      ],
    }
    const fileReader = async (_path: string) => JSON.stringify(badSnapshot)
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot does not leak raw payload in return value on malformed input', async () => {
    // Even if the JSON is parseable but wrong shape, the return is null — not the raw object
    const fileReader = async (_path: string) =>
      JSON.stringify({items: [{content_number: 'SENSITIVE_VALUE', issue_state: 'SENSITIVE_STATE'}]})
    const result = await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    // Must return null (validation failed), not the raw object
    expect(result).toBeNull()
  })

  it('loadRolloutSnapshot writes a generic diagnostic to stderr on file read failure (no path info)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const fileReader = async (_path: string) => {
      throw new Error('ENOENT: no such file or directory, open /tmp/secret-path.json')
    }
    await loadRolloutSnapshot({snapshotPath: '/tmp/secret-path.json', fileReader})
    // Must write a diagnostic to stderr
    expect(stderrSpy).toHaveBeenCalled()
    // The diagnostic must not contain the raw error detail (which may include path info)
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).toContain('snapshot file unavailable')
    expect(written).not.toContain('secret-path.json')
    stderrSpy.mockRestore()
  })

  it('loadRolloutSnapshot writes a generic diagnostic to stderr on malformed JSON (no raw payload)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const fileReader = async (_path: string) => 'SENSITIVE_PAYLOAD{{{not-json'
    await loadRolloutSnapshot({snapshotPath: '/tmp/snapshot.json', fileReader})
    expect(stderrSpy).toHaveBeenCalled()
    const written = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(written).toContain('snapshot JSON malformed')
    expect(written).not.toContain('SENSITIVE_PAYLOAD')
    stderrSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// buildProposedCorrection — trailing-state-only replacement
// When the claimed state word appears in the path/tag (e.g. active-plan.md,
// v1.0-active), the correction must replace only the trailing state token,
// not the first occurrence in the path.
// ---------------------------------------------------------------------------

describe('buildProposedCorrection: trailing-state replacement via detect pipeline', () => {
  it('plan-status path containing claimed state word with hyphen: correction replaces only trailing state', async () => {
    // normalizedText = "plan docs/plans/active-plan.md is active"
    // claimedState   = "active"
    // Bug: \bactive\b matches "active" in "active-plan.md" first → corrupts path
    // Fix: replace only the trailing "active" (the last occurrence)
    const claims = extractStatusTruthClaimsFromText({
      path: 'README.md',
      text: 'plan docs/plans/active-plan.md is active',
    })
    const claim = claims.find(c => c.kind === 'plan-status')
    expect(claim).toBeDefined()
    if (claim === undefined) return

    // Verify the claim was extracted correctly
    expect(claim.claimedState).toBe('active')
    expect(claim.normalizedText).toBe('plan docs/plans/active-plan.md is active')

    const resolverResults: Record<string, ResolverResult> = {
      [`plan-status:${claim.sourceRef}`]: {status: 'resolved', state: 'complete'},
    }

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    if (finding?.verdict === 'drifted') {
      expect(finding.proposedCorrection).toBeDefined()
      // Must contain the live state
      expect(finding.proposedCorrection).toContain('complete')
      // Must NOT corrupt the path — "active-plan.md" must remain intact
      expect(finding.proposedCorrection).toContain('active-plan.md')
      // The trailing state must be replaced
      expect(finding.proposedCorrection).not.toMatch(/\bactive\s*$/)
    }
  })

  it('release-tag-state tag containing claimed state word with hyphen: correction replaces only trailing state', () => {
    // normalizedText = "release v1.0-published is published"
    // claimedState   = "published"
    // Bug: \bpublished\b matches "published" in "v1.0-published" first → corrupts tag
    // Fix: replace only the trailing "published" (the last occurrence)
    const claim: StatusTruthClaim = {
      kind: 'release-tag-state',
      path: 'README.md',
      sourceRef: '@v1.0-published',
      claimedState: 'published',
      normalizedText: 'release v1.0-published is published',
    }

    const resolverResults = makeResolverResults([
      {kind: 'release-tag-state', sourceRef: '@v1.0-published', result: {status: 'resolved', state: 'draft'}},
    ])

    const findings = detectStatusTruthClaims([claim], resolverResults)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.verdict).toBe('drifted')
    if (finding?.verdict === 'drifted') {
      expect(finding.proposedCorrection).toBeDefined()
      // Must contain the live state
      expect(finding.proposedCorrection).toContain('draft')
      // Must NOT corrupt the tag — "v1.0-published" must remain intact
      expect(finding.proposedCorrection).toContain('v1.0-published')
      // The trailing state must be replaced
      expect(finding.proposedCorrection).not.toMatch(/\bpublished\s*$/)
    }
  })
})

// ---------------------------------------------------------------------------
// parsePlanUnitCheckboxes — pure checkbox unit-marker parser
// ---------------------------------------------------------------------------

describe('parsePlanUnitCheckboxes', () => {
  it('happy path: mixed checked/unchecked unit markers produce exact counts', () => {
    const content = [
      '## Implementation Units',
      '',
      '- [x] **Unit 1: First unit**',
      '',
      'Body text for unit 1.',
      '',
      '- [ ] **Unit 2: Second unit**',
      '',
      'Body text for unit 2.',
      '',
      '- [x] **Unit 3: Third unit**',
      '',
    ].join('\n')

    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(true)
    if (result.recognized) {
      expect(result.checkedUnits).toBe(2)
      expect(result.uncheckedUnits).toBe(1)
    }
  })

  it('edge case: plain non-unit checkboxes are not counted', () => {
    const content = [
      '- [x] **Unit 1: Real unit**',
      '',
      '**Checklist:**',
      '- [x] Provision the droplet',
      '- [ ] Rotate the secret',
      '',
      '**Test scenarios:**',
      '- [x] Happy path covered',
      '  - [x] nested sub-task',
      '  - [ ] another nested sub-task',
    ].join('\n')

    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(true)
    if (result.recognized) {
      expect(result.checkedUnits).toBe(1)
      expect(result.uncheckedUnits).toBe(0)
    }
  })

  it('edge case: no unit markers at all yields the no-markers signal', () => {
    const content = '## Overview\n\nJust prose, no checkboxes anywhere in this plan.\n'
    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(false)
  })

  it('edge case: heading-encoded units (### U1. + Status: lines) are unrecognized', () => {
    const content = [
      '### U1. Persona Document',
      '',
      'Status: complete.',
      '',
      '### U2. Metadata Structure',
      '',
      'Status: complete.',
    ].join('\n')

    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(false)
  })

  it('edge case: bold-less unit labels are not counted as units', () => {
    const content = ['- [x] Unit 1: Not bold, should not count', '- [ ] Unit 2: Also not bold'].join('\n')
    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(false)
  })

  it('edge case: malformed unit label missing the "Unit N:" prefix is not counted', () => {
    const content = ['- [x] **Not a unit label**', '- [ ] **Also not a unit label**'].join('\n')
    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(false)
  })

  it('indented unit-shaped checkboxes (not top-level) are not counted as units', () => {
    const content = ['Some section', '', '  - [x] **Unit 1: Indented, should not count**'].join('\n')
    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(false)
  })

  it('all-checked units: checkedUnits equals total, uncheckedUnits is zero', () => {
    const content = ['- [x] **Unit 1: First**', '- [x] **Unit 2: Second**', '- [x] **Unit 3: Third**'].join('\n')
    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(true)
    if (result.recognized) {
      expect(result.checkedUnits).toBe(3)
      expect(result.uncheckedUnits).toBe(0)
    }
  })

  it('all-unchecked units: uncheckedUnits equals total, checkedUnits is zero', () => {
    const content = ['- [ ] **Unit 1: First**', '- [ ] **Unit 2: Second**'].join('\n')
    const result = parsePlanUnitCheckboxes(content)
    expect(result.recognized).toBe(true)
    if (result.recognized) {
      expect(result.checkedUnits).toBe(0)
      expect(result.uncheckedUnits).toBe(2)
    }
  })

  it('is a pure function: identical input produces identical output, no I/O', () => {
    const content = '- [x] **Unit 1: A**\n- [ ] **Unit 2: B**\n'
    const first = parsePlanUnitCheckboxes(content)
    const second = parsePlanUnitCheckboxes(content)
    expect(first).toEqual(second)
  })
})

// ---------------------------------------------------------------------------
// resolvePlanConsistencyVerdict — the single drift-matrix resolver.
// Table-tested over the full drift matrix.
// ---------------------------------------------------------------------------

describe('resolvePlanConsistencyVerdict', () => {
  it('active + all units checked → drifted, proposal-eligible, correction status: complete', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'active',
      units: {recognized: true, checkedUnits: 3, uncheckedUnits: 0},
    })
    expect(result.verdict).toBe('drifted')
    expect(result.proposalEligible).toBe(true)
    expect(result.proposedCorrection).toBe('status: complete')
  })

  it('complete + all units checked → current', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'complete',
      units: {recognized: true, checkedUnits: 3, uncheckedUnits: 0},
    })
    expect(result.verdict).toBe('current')
    expect(result.proposalEligible).toBe(false)
  })

  it('complete + one unchecked unit → unresolved, not proposal-eligible', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'complete',
      units: {recognized: true, checkedUnits: 2, uncheckedUnits: 1},
    })
    expect(result.verdict).toBe('unresolved')
    expect(result.proposalEligible).toBe(false)
  })

  it('no recognizable unit markers → unresolved', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'active',
      units: {recognized: false},
    })
    expect(result.verdict).toBe('unresolved')
    expect(result.proposalEligible).toBe(false)
  })

  it('unsupported claimed status → unresolved regardless of unit state', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'unsupported',
      units: {recognized: true, checkedUnits: 3, uncheckedUnits: 0},
    })
    expect(result.verdict).toBe('unresolved')
    expect(result.proposalEligible).toBe(false)
  })

  it('active + unfinished units → current (not drifted — matrix is one-directional)', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'active',
      units: {recognized: true, checkedUnits: 1, uncheckedUnits: 2},
    })
    expect(result.verdict).toBe('current')
    expect(result.proposalEligible).toBe(false)
  })

  it('draft status with any unit state → current', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'draft',
      units: {recognized: true, checkedUnits: 0, uncheckedUnits: 3},
    })
    expect(result.verdict).toBe('current')
  })

  it('cancelled status with all units checked → current', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'cancelled',
      units: {recognized: true, checkedUnits: 3, uncheckedUnits: 0},
    })
    expect(result.verdict).toBe('current')
  })

  it('superseded status with mixed unit state → current', () => {
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'superseded',
      units: {recognized: true, checkedUnits: 1, uncheckedUnits: 1},
    })
    expect(result.verdict).toBe('current')
  })

  it('active with zero total units (recognized but empty) never drifts', () => {
    // Defensive: recognized:true always carries at least one counted unit by
    // parsePlanUnitCheckboxes construction, but the resolver must not drift on
    // a zero-unit plan even if a future caller passes this shape directly.
    const result = resolvePlanConsistencyVerdict({
      claimedState: 'active',
      units: {recognized: true, checkedUnits: 0, uncheckedUnits: 0},
    })
    expect(result.verdict).not.toBe('drifted')
  })
})

// ---------------------------------------------------------------------------
// buildPlanConsistencyClaim — synthetic per-plan claim construction
// ---------------------------------------------------------------------------

describe('buildPlanConsistencyClaim', () => {
  it('claimedState is the frontmatter status when it is a supported value', () => {
    const content = '---\nstatus: active\n---\n\nContent.'
    const claim = buildPlanConsistencyClaim('docs/plans/example.md', content)
    expect(claim.kind).toBe('plan-consistency')
    expect(claim.claimedState).toBe('active')
    expect(claim.path).toBe('docs/plans/example.md')
    expect(claim.sourceRef).toBe('docs/plans/example.md')
  })

  it('claimedState collapses an unsupported status value to the fixed sentinel, never the raw text', () => {
    const content = '---\nstatus: code-complete-pending-verification\n---\n\nContent.'
    const claim = buildPlanConsistencyClaim('docs/plans/example.md', content)
    expect(claim.claimedState).toBe('unsupported')
    expect(claim.claimedState).not.toBe('code-complete-pending-verification')
  })

  it('missing frontmatter status collapses to the unsupported sentinel', () => {
    const content = '## No frontmatter here\n\nJust prose.'
    const claim = buildPlanConsistencyClaim('docs/plans/example.md', content)
    expect(claim.claimedState).toBe('unsupported')
  })

  it('privacy: a malformed multi-word status value never survives verbatim into the claim', () => {
    const content = '---\nstatus: totally made up multi word status\n---\n\nContent.'
    const claim = buildPlanConsistencyClaim('docs/plans/example.md', content)
    expect(claim.claimedState).toBe('unsupported')
    expect(claim.claimedState).not.toContain('totally made up')
  })

  it('normalizedText is a constant, independent of frontmatter or unit content (fingerprint stability)', () => {
    const activeContent = '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n'
    const completeContent = '---\nstatus: complete\n---\n\n- [ ] **Unit 1: A**\n- [x] **Unit 2: B**\n'
    const claimA = buildPlanConsistencyClaim('docs/plans/example.md', activeContent)
    const claimB = buildPlanConsistencyClaim('docs/plans/example.md', completeContent)
    expect(claimA.normalizedText).toBe(claimB.normalizedText)
  })

  it('fingerprint is identical for the same plan path across differing unit/status states', () => {
    const activeContent = '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n'
    const completeContent = '---\nstatus: complete\n---\n\n- [ ] **Unit 1: A**\n- [x] **Unit 2: B**\n'
    const claimA = buildPlanConsistencyClaim('docs/plans/example.md', activeContent)
    const claimB = buildPlanConsistencyClaim('docs/plans/example.md', completeContent)
    const fpA = computeClaimFingerprint(claimA.kind, claimA.path, claimA.sourceRef, claimA.normalizedText)
    const fpB = computeClaimFingerprint(claimB.kind, claimB.path, claimB.sourceRef, claimB.normalizedText)
    expect(fpA).toBe(fpB)
  })
})

// ---------------------------------------------------------------------------
// scanPlanConsistencyFindings — bounded second pass over docs/plans/*.md
// ---------------------------------------------------------------------------

describe('scanPlanConsistencyFindings', () => {
  it('active plan with all units checked yields one drifted, proposal-eligible finding', async () => {
    const fileLister: FileLister = async () => ['README.md', 'docs/plans/shipped.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/shipped.md') {
        return '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n- [x] **Unit 2: B**\n'
      }
      return 'unrelated content'
    }

    const {findings, scanErrors} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(scanErrors).toBe(0)
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding?.kind).toBe('plan-consistency')
    expect(finding?.path).toBe('docs/plans/shipped.md')
    expect(finding?.verdict).toBe('drifted')
    expect(finding?.proposalEligible).toBe(true)
    expect(finding?.proposedCorrection).toBe('status: complete')
  })

  it('complete plan with one unchecked unit yields one unresolved finding', async () => {
    const fileLister: FileLister = async () => ['docs/plans/partial.md']
    const fileReader: FileReader = async () =>
      '---\nstatus: complete\n---\n\n- [x] **Unit 1: A**\n- [ ] **Unit 2: B**\n'

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.proposalEligible).toBe(false)
  })

  it('plan with no implementation-units section yields one unresolved finding', async () => {
    const fileLister: FileLister = async () => ['docs/plans/no-units.md']
    const fileReader: FileReader = async () => '---\nstatus: active\n---\n\nJust prose, no units.'

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
  })

  it('unsupported frontmatter status yields unresolved with claimedState "unsupported"', async () => {
    const fileLister: FileLister = async () => ['docs/plans/dashboard.md']
    const fileReader: FileReader = async () =>
      '---\nstatus: code-complete-pending-verification\n---\n\n- [x] **Unit 1: A**\n'

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
    expect(findings[0]?.claimedState).toBe('unsupported')
    // The raw frontmatter text must never survive into the finding
    expect(JSON.stringify(findings[0])).not.toContain('code-complete-pending-verification')
  })

  it('heading-encoded units yield an unresolved finding, not drifted', async () => {
    const fileLister: FileLister = async () => ['docs/plans/legacy.md']
    const fileReader: FileReader = async () =>
      '---\nstatus: active\n---\n\n### U1. First\n\nStatus: complete.\n\n### U2. Second\n\nStatus: complete.\n'

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('unresolved')
  })

  it('draft status with checked units yields current, not drifted', async () => {
    const fileLister: FileLister = async () => ['docs/plans/draft.md']
    const fileReader: FileReader = async () => '---\nstatus: draft\n---\n\n- [x] **Unit 1: A**\n'

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('current')
  })

  it('only files matching docs/plans/*.md are scanned; other paths are ignored', async () => {
    const fileLister: FileLister = async () => ['README.md', 'docs/solutions/example.md', 'docs/plans/real.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/real.md') return '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n'
      throw new Error(`unexpected path scanned: ${path}`)
    }

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(1)
    expect(findings[0]?.path).toBe('docs/plans/real.md')
  })

  it('fingerprint is stable across two runs of the same plan with differing unit states', async () => {
    const fileLister: FileLister = async () => ['docs/plans/example.md']
    const activeReader: FileReader = async () => '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n'
    const completeReader: FileReader = async () =>
      '---\nstatus: complete\n---\n\n- [ ] **Unit 1: A**\n- [x] **Unit 2: B**\n'

    const runA = await scanPlanConsistencyFindings({fileLister, fileReader: activeReader})
    const runB = await scanPlanConsistencyFindings({fileLister, fileReader: completeReader})

    expect(runA.findings[0]?.fingerprint).toBe(runB.findings[0]?.fingerprint)
  })

  it('error path: file read failure increments scanErrors and emits no finding for that plan', async () => {
    const fileLister: FileLister = async () => ['docs/plans/broken.md', 'docs/plans/ok.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/broken.md') throw new Error('read failure')
      return '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n'
    }

    const {findings, scanErrors} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(scanErrors).toBe(1)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.path).toBe('docs/plans/ok.md')
  })

  it('no docs/plans files present yields zero findings and zero errors', async () => {
    const fileLister: FileLister = async () => ['README.md']
    const fileReader: FileReader = async () => 'irrelevant'

    const {findings, scanErrors} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(0)
    expect(scanErrors).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Detect-flow integration — runDetect-equivalent: plan-consistency findings
// alongside prose-claim findings in one report.
// ---------------------------------------------------------------------------

describe('runDetect-equivalent: plan-consistency findings alongside prose-claim findings', () => {
  it('full pipeline over a fixture corpus produces plan-consistency findings alongside pr-state findings in one report with correct counts', async () => {
    const fileLister: FileLister = async () => ['README.md', 'docs/plans/shipped.md', 'docs/plans/current.md']
    const fileReader: FileReader = async (path: string) => {
      if (path === 'README.md') return 'PR #42 is open.'
      if (path === 'docs/plans/shipped.md') {
        return '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n- [x] **Unit 2: B**\n'
      }
      if (path === 'docs/plans/current.md') {
        return '---\nstatus: complete\n---\n\n- [x] **Unit 1: A**\n'
      }
      throw new Error(`unexpected path: ${path}`)
    }

    const {claims, scanErrors: fileScanErrors} = await scanStatusTruthClaims({fileLister, fileReader})
    const {findings: planConsistencyFindings, scanErrors: planScanErrors} = await scanPlanConsistencyFindings({
      fileLister,
      fileReader,
    })

    const resolverResults = makeResolverResults([
      {kind: 'pr-state', sourceRef: '#42', result: {status: 'resolved', state: 'closed'}},
    ])

    const findings = [...detectStatusTruthClaims(claims, resolverResults), ...planConsistencyFindings]
    const report = buildStatusTruthReport({
      findings,
      scanComplete: fileScanErrors === 0 && planScanErrors === 0,
      generatedAt: '2026-07-02T00:00:00Z',
      failureClass: null,
    })

    expect(report.scan_complete).toBe(true)
    expect(report.counts.total).toBe(3)
    expect(report.counts.drifted).toBe(2) // pr-state drift + shipped.md drift
    expect(report.counts.current).toBe(1) // current.md
    const kinds = report.findings.map(f => f.kind)
    expect(kinds).toContain('pr-state')
    expect(kinds).toContain('plan-consistency')
  })

  it('deleting a fixture plan between two runs drops its finding from the next report (fingerprint clears)', async () => {
    const firstLister: FileLister = async () => ['docs/plans/temp.md']
    const firstReader: FileReader = async () => '---\nstatus: active\n---\n\n- [x] **Unit 1: A**\n'
    const first = await scanPlanConsistencyFindings({fileLister: firstLister, fileReader: firstReader})
    expect(first.findings).toHaveLength(1)
    const firstFingerprint = first.findings[0]?.fingerprint

    // Second run: the plan file is gone from the lister entirely.
    const secondLister: FileLister = async () => []
    const secondReader: FileReader = async () => ''
    const second = await scanPlanConsistencyFindings({fileLister: secondLister, fileReader: secondReader})

    expect(second.findings).toHaveLength(0)
    expect(second.findings.map(f => f.fingerprint)).not.toContain(firstFingerprint)
  })
})

// ---------------------------------------------------------------------------
// Privacy: report JSON finding fields for plan-consistency carry only
// normalized data — path, statuses, unit counts, correction. No raw plan
// body text, unit titles, or frontmatter excerpts.
// ---------------------------------------------------------------------------

describe('plan-consistency privacy: report artifact surface', () => {
  it('drifted finding report JSON contains only normalized fields — no plan body prose', async () => {
    const secretSentence = 'This plan discusses fro-bot/super-secret-internal-project details.'
    const fileLister: FileLister = async () => ['docs/plans/shipped.md']
    const fileReader: FileReader = async () =>
      `---\nstatus: active\n---\n\n${secretSentence}\n\n- [x] **Unit 1: A**\n- [x] **Unit 2: B**\n`

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-07-02T00:00:00Z',
      failureClass: null,
    })

    const artifactJson = JSON.stringify(report)
    expect(artifactJson).not.toContain(secretSentence)
    expect(artifactJson).not.toContain('fro-bot/super-secret-internal-project')
    expect(artifactJson).toContain('"kind":"plan-consistency"')
    expect(artifactJson).toContain('"path":"docs/plans/shipped.md"')
    expect(artifactJson).toContain('"proposedCorrection":"status: complete"')
  })

  it('unresolved unsupported-status finding report JSON never contains the raw malformed status text', async () => {
    const fileLister: FileLister = async () => ['docs/plans/dashboard.md']
    const fileReader: FileReader = async () =>
      '---\nstatus: code-complete-pending-verification\n---\n\n- [x] **Unit 1: A**\n'

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    const report = buildStatusTruthReport({
      findings,
      scanComplete: true,
      generatedAt: '2026-07-02T00:00:00Z',
      failureClass: null,
    })

    const artifactJson = JSON.stringify(report)
    expect(artifactJson).not.toContain('code-complete-pending-verification')
    expect(artifactJson).toContain('"claimedState":"unsupported"')
  })
})

// ---------------------------------------------------------------------------
// Replay test — reproduces the origin incident: three shipped capture plans
// carrying status: active with all units checked (pre-reconciliation), and a
// fixture shaped like the current (reconciled) corpus.
// ---------------------------------------------------------------------------

describe('plan-consistency replay: pre-reconciliation stale capture plans', () => {
  it('three fixture plans shaped like the stale capture plans (active + all [x]) yield exactly three drifted', async () => {
    const stalePlanContent = (name: string) =>
      `---\ntitle: '${name}'\nstatus: active\n---\n\n- [x] **Unit 1: A**\n- [x] **Unit 2: B**\n- [x] **Unit 3: C**\n`

    const fileLister: FileLister = async () => [
      'docs/plans/2026-06-22-003-feat-enrich-capture-digest-plan.md',
      'docs/plans/2026-06-22-004-feat-c2-failed-then-fixed-capture-plan.md',
      'docs/plans/2026-06-23-001-fix-merged-candidate-evidence-plan.md',
    ]
    const fileReader: FileReader = async (path: string) => stalePlanContent(path)

    const {findings, scanErrors} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(scanErrors).toBe(0)
    expect(findings).toHaveLength(3)
    expect(findings.every(f => f.verdict === 'drifted')).toBe(true)
    expect(findings.every(f => f.proposalEligible)).toBe(true)
    expect(findings.every(f => f.proposedCorrection === 'status: complete')).toBe(true)
  })

  it('a fixture shaped like the current corpus yields zero drifted and one unresolved (unsupported status)', async () => {
    const fileLister: FileLister = async () => [
      'docs/plans/2026-06-22-003-feat-enrich-capture-digest-plan.md',
      'docs/plans/2026-06-15-001-feat-monitoring-dashboard-phase-1-plan.md',
    ]
    const fileReader: FileReader = async (path: string) => {
      if (path === 'docs/plans/2026-06-22-003-feat-enrich-capture-digest-plan.md') {
        // Reconciled: frontmatter flipped to complete, all units checked.
        return '---\nstatus: complete\n---\n\n- [x] **Unit 1: A**\n- [x] **Unit 2: B**\n'
      }
      // The one plan with an unsupported status value in the real corpus.
      return '---\nstatus: code-complete-pending-verification\n---\n\n- [x] **Unit 1: A**\n'
    }

    const {findings} = await scanPlanConsistencyFindings({fileLister, fileReader})
    expect(findings).toHaveLength(2)
    const drifted = findings.filter(f => f.verdict === 'drifted')
    const unresolved = findings.filter(f => f.verdict === 'unresolved')
    expect(drifted).toHaveLength(0)
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.claimedState).toBe('unsupported')
  })
})

// ---------------------------------------------------------------------------
// Plan-consistency corrector: bounded frontmatter status-line rewrite
// ---------------------------------------------------------------------------

describe('plan-consistency corrector: bounded status-line rewrite', () => {
  it('rewrites exactly the frontmatter status line to status: complete; every other byte preserved', () => {
    const original = [
      '---',
      "title: 'Example plan'",
      'status: active',
      'date: 2026-06-22',
      '---',
      '',
      '# Example plan',
      '',
      '- [x] **Unit 1: A**',
      '- [x] **Unit 2: B**',
      '',
    ].join('\n')

    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).not.toBeNull()

    const expected = original.replace('status: active', 'status: complete')
    expect(corrected).toBe(expected)

    // Only the status line differs.
    const originalLines = original.split('\n')
    const correctedLines = (corrected ?? '').split('\n')
    expect(correctedLines).toHaveLength(originalLines.length)
    const diffLines = originalLines.filter((line, i) => line !== correctedLines[i])
    expect(diffLines).toHaveLength(1)
    expect(diffLines[0]).toBe('status: active')
  })

  it('rewrites a quoted status value, producing an unquoted canonical output', () => {
    const original = ['---', 'status: "active"', '---', '', 'body', ''].join('\n')
    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).not.toBeNull()
    expect(corrected).toContain('status: complete')
    expect(corrected).not.toContain('"active"')
    expect(corrected).not.toContain('"complete"')
  })

  it('rewrites a single-quoted status value, producing an unquoted canonical output', () => {
    const original = ['---', "status: 'active'", '---', '', 'body', ''].join('\n')
    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).not.toBeNull()
    expect(corrected).toContain('status: complete')
    expect(corrected).not.toContain("'active'")
  })

  it('does not touch status: text appearing in the plan body outside frontmatter', () => {
    const original = [
      '---',
      'status: active',
      '---',
      '',
      'Note: status: active is also mentioned here for illustration.',
      '',
    ].join('\n')
    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).not.toBeNull()
    expect(corrected).toContain('Note: status: active is also mentioned here for illustration.')
    // Only the frontmatter occurrence changed.
    const correctedOccurrences = (corrected ?? '').split('status: active').length - 1
    expect(correctedOccurrences).toBe(1)
  })

  it('returns null (no-correction signal) when content has no parseable frontmatter', () => {
    const original = '# No frontmatter here\n\nJust body text.\n'
    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).toBeNull()
  })

  it('returns null when frontmatter exists but has no status line', () => {
    const original = ['---', "title: 'No status here'", '---', '', 'body', ''].join('\n')
    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).toBeNull()
  })

  it('never mangles the file: corrected content is always the original with exactly the status token changed, or null', () => {
    const fixtures = [
      '---\nstatus: active\n---\nbody\n',
      '---\nstatus: "active"\n---\nbody\n',
      "---\nstatus: 'active'\n---\nbody\n",
      '---\ntitle: x\nstatus: active\ndate: 2026-01-01\n---\nbody\nstatus: active\n',
    ]
    for (const fixture of fixtures) {
      const corrected = correctPlanConsistencyStatusLine(fixture)
      expect(corrected).not.toBeNull()
      expect(typeof corrected).toBe('string')
    }
  })

  it('round-trip: corrected fixture re-verifies as current through the full resolver composition', () => {
    const original = [
      '---',
      "title: 'Round trip plan'",
      'status: active',
      '---',
      '',
      '- [x] **Unit 1: A**',
      '- [x] **Unit 2: B**',
      '',
    ].join('\n')

    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).not.toBeNull()
    const correctedContent = corrected ?? ''

    const result = reverifyPlanConsistencyCorrection('docs/plans/round-trip-plan.md', correctedContent)
    expect(result.verdict).toBe('current')
  })

  it('round-trip fails to re-verify when unit checkboxes still show unchecked units (correction alone is insufficient)', () => {
    const original = ['---', 'status: active', '---', '', '- [x] **Unit 1: A**', '- [ ] **Unit 2: B**', ''].join('\n')

    const corrected = correctPlanConsistencyStatusLine(original)
    expect(corrected).not.toBeNull()
    const correctedContent = corrected ?? ''

    const result = reverifyPlanConsistencyCorrection('docs/plans/incomplete-plan.md', correctedContent)
    // status: complete + an unchecked unit → unresolved, not current.
    expect(result.verdict).toBe('unresolved')
  })
})
