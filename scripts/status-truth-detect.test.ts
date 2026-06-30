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

import {describe, expect, it} from 'vitest'

import {
  buildDetectOctokitOptions,
  buildStatusTruthReport,
  CLAIM_KIND_DEFINITIONS,
  computeClaimFingerprint,
  detectStatusTruthClaims,
  extractStatusTruthClaimsFromText,
  isKnownReportVersion,
  KNOWN_FINGERPRINT_VERSION,
  KNOWN_SCHEMA_VERSION,
  listCurrentRepoIssueComments,
  listCurrentRepoIssues,
  normalizeClaimText,
  resolveAllClaims,
  resolveClaimLiveState,
  scanIssueStatusTruthClaims,
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

  it('ClaimKind union covers all five expected values', () => {
    const kinds: ClaimKind[] = ['pr-state', 'issue-state', 'release-tag-state', 'plan-status', 'rollout-tracker-status']
    expect(kinds).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// Unit 4: validateStatusTruthArtifact tests
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
// Unit 4: Artifact safety contract tests
// ---------------------------------------------------------------------------

describe('Unit 4: artifact safety contract', () => {
  it('detect output artifact contains safe machine fields and counters but no raw claim text or source snippets', () => {
    // The report envelope must not expose raw claim text or source snippets.
    // Findings carry typed fields (kind, path, sourceRef, verdict, fingerprint,
    // claimedState, liveState) but NOT raw document text or API response bodies.
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

// ---------------------------------------------------------------------------
// Unit 4 corrections: extractStatusTruthClaimsFromText tests
// ---------------------------------------------------------------------------

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

  it('extracts a plan-status claim from frontmatter "status: active"', () => {
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/my-plan.md',
      text: '---\nstatus: active\ntitle: My Plan\n---\n\nContent.',
    })
    expect(claims).toHaveLength(1)
    const claim = claims[0]
    expect(claim?.kind).toBe('plan-status')
    expect(claim?.sourceRef).toBe('docs/plans/my-plan.md#status')
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

  // Fix #1: Cross-repo PR/issue references must not resolve as current-repo references.
  // When text contains "fro-bot/agent#1033 PR #1033 is open", the extractor must NOT
  // produce a bare #1033 sourceRef that the resolver would treat as current-repo.
  it('cross-repo PR reference: text with owner/repo prefix near claim does not produce bare #N sourceRef', () => {
    // This text has a cross-repo context: "fro-bot/agent#1033" followed by "PR #1033 is open"
    // The extractor currently produces bare #1033 which the resolver treats as current-repo.
    // After fix: either the sourceRef is prefixed (fro-bot/agent#1033) or the claim is skipped.
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'See fro-bot/agent#1033 PR #1033 is open for context.',
    })
    // Assert directly: no bare #1033 sourceRef must be extracted
    expect(claims.filter(c => c.sourceRef === '#1033')).toHaveLength(0)
    // If a claim is extracted, its sourceRef must NOT be bare #1033
    for (const claim of claims) {
      if (claim.kind === 'pr-state' && claim.claimedState === 'open') {
        expect(claim.sourceRef).not.toBe('#1033')
      }
    }
  })

  it('cross-repo issue reference: text with owner/repo prefix near claim does not produce bare #N sourceRef', () => {
    // "fro-bot/dashboard#48 issue #48 is open" — must not produce bare #48
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'Tracked in fro-bot/dashboard#48 issue #48 is open.',
    })
    // Assert directly: no bare #48 sourceRef must be extracted
    expect(claims.filter(c => c.sourceRef === '#48')).toHaveLength(0)
    for (const claim of claims) {
      if (claim.kind === 'issue-state' && claim.claimedState === 'open') {
        expect(claim.sourceRef).not.toBe('#48')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Unit 4 corrections: scanStatusTruthClaims tests
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Unit 4 corrections: resolveClaimLiveState tests
// ---------------------------------------------------------------------------

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

  // Fix #3: plan-status resolver must not return claimedState as live state
  it('plan-status returns unavailable (not resolved with claimedState as live state)', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'plan-status', sourceRef: 'docs/plans/foo.md#status', claimedState: 'active'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    // plan-status has no real file-parse resolver yet; must be unavailable, not resolved
    expect(result.status).toBe('unavailable')
  })
})

// ---------------------------------------------------------------------------
// Unit 4 corrections: end-to-end extract → resolve → detect pipeline tests
// ---------------------------------------------------------------------------

describe('Unit 4: extract → resolve → detect pipeline', () => {
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

  // Fix #1: cross-repo text that produces a bare #N must not classify as current-repo drifted
  it('cross-repo context text: extracted claim (if any) classifies as unresolved, not drifted', async () => {
    // Text: "fro-bot/agent#1033 PR #1033 is open" — if extractor produces bare #1033,
    // the resolver must return unavailable (not resolved), so detect classifies as unresolved.
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
    // Any pr-state finding for #1033 must be unresolved (not drifted/current)
    for (const finding of findings) {
      if (finding.kind === 'pr-state' && finding.verdict !== 'unsafe') {
        // If a bare #1033 was extracted and resolved as current-repo, it would be drifted.
        // After fix: either no claim extracted, or sourceRef is non-bare and verdict is unresolved.
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

// ---------------------------------------------------------------------------
// Unit 4 fix 1: buildProposedCorrection uses replacement function ($ safety)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// selectDetectFailureClass: issue/comment API failures must map to api-unavailable
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CALIBRATION: plan-status exclusion from production scans
// ---------------------------------------------------------------------------

describe('scanStatusTruthClaims: plan-status exclusion (calibration)', () => {
  it('production scan (default) excludes plan-status claims so dry-run produces zero unresolved plan-status noise', async () => {
    // A plan doc with frontmatter status: active — production scan must NOT emit plan-status claims
    const fileLister: FileLister = async () => ['docs/plans/my-plan.md']
    const fileReader: FileReader = async () => '---\nstatus: active\ntitle: My Plan\n---\n\nContent.'

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    // Default production scan must exclude plan-status
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(0)
  })

  it('pure extractor still extracts plan-status when all kinds are enabled', () => {
    // extractStatusTruthClaimsFromText is a pure function and always extracts all kinds
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/my-plan.md',
      text: '---\nstatus: active\ntitle: My Plan\n---\n\nContent.',
    })
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(1)
  })

  it('production scan with explicit enabledKinds including plan-status does emit plan-status claims', async () => {
    // When caller explicitly opts in, plan-status is included
    const fileLister: FileLister = async () => ['docs/plans/my-plan.md']
    const fileReader: FileReader = async () => '---\nstatus: active\ntitle: My Plan\n---\n\nContent.'

    const {claims} = await scanStatusTruthClaims({
      fileLister,
      fileReader,
      enabledKinds: ['pr-state', 'issue-state', 'release-tag-state', 'plan-status', 'rollout-tracker-status'],
    })
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

// ---------------------------------------------------------------------------
// CALIBRATION: GitHub issue body/comment scanning
// ---------------------------------------------------------------------------

describe('scanIssueStatusTruthClaims: issue body/comment scanning (calibration)', () => {
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

    // Body claims still extracted; comment fetch failure counted
    expect(result.scanErrors).toBeGreaterThan(0)
    // Body claim from issue 300 should still be present (path uses `current`)
    expect(result.claims.filter(c => c.path === 'github-issue://current/issues/300#body')).toHaveLength(1)
  })

  it('synthetic issue paths use current scheme and do not contain owner/repo identity', () => {
    // Structural test: synthetic paths use `current` (not owner/repo) so generic
    // code does not leak identity before explicit publicness proof.
    const syntheticBodyPath = 'github-issue://current/issues/3512#body'
    const syntheticCommentPath = 'github-issue://current/issues/3512#comment-9001'

    // These paths use the `current` scheme
    expect(syntheticBodyPath).toMatch(/^github-issue:\/\/current\/issues\/\d+#body$/)
    expect(syntheticCommentPath).toMatch(/^github-issue:\/\/current\/issues\/\d+#comment-\d+$/)

    // The path scheme must not contain raw body text or private identifiers
    expect(syntheticBodyPath).not.toContain('PR #42 is open')
    expect(syntheticCommentPath).not.toContain('issue #55 is closed')

    // Must not contain owner/repo identity
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

// ---------------------------------------------------------------------------
// Blocker 1: Synthetic issue paths must use `current`, not owner/repo
// ---------------------------------------------------------------------------

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
    // Must use `current`, not owner/repo
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
    // Must use `current`, not owner/repo
    expect(claim?.path).toBe('github-issue://current/issues/100#comment-9001')
    expect(claim?.path).not.toContain('fro-bot')
    expect(claim?.path).not.toContain('.github')
  })

  it('scanner output for issue body uses current path regardless of owner/repo passed in', async () => {
    // Even with a different owner/repo, the path must always use `current`
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

  it('no public finding path or sourceRef test regresses: public finding path is still present', async () => {
    // Regression guard: public findings still have path and sourceRef fields
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
    // Public finding must still have path and sourceRef
    if (finding?.verdict === 'drifted') {
      expect(finding.path).toBe('github-issue://current/issues/3512#body')
      expect(finding.sourceRef).toBe('#42')
      expect(typeof finding.fingerprint).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// Blocker 2: Production issue/comment fetchers must paginate
// ---------------------------------------------------------------------------

describe('listCurrentRepoIssues: pagination helper fetches all pages', () => {
  it('fetches multiple pages until exhausted', async () => {
    // Simulate two pages: page 1 has 2 items, page 2 has 1 item, page 3 is empty
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

// ---------------------------------------------------------------------------
// Cross-repo status-truth signal: grammar, publicness proof, privacy gates
// ---------------------------------------------------------------------------

// Helper: build a mock DetectOctokitClient that supports repos.get for publicness
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

// ---------------------------------------------------------------------------
// Cross-repo claim grammar: extractStatusTruthClaimsFromText
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cross-repo publicness proof and resolver
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Privacy gate: unsafe finding must not expose identity fields
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// #3512-style coordination signal: end-to-end cross-repo fixture
// ---------------------------------------------------------------------------

describe('#3512-style cross-repo coordination signal (synthetic public-safe fixtures)', () => {
  // Inspired by real coordination patterns in issue #3512 (rollout tracker).
  // All fixtures are synthetic and use public repos only.

  it('synthetic #3512-style: cross-repo closed PR claim becomes drifted when live state is merged', async () => {
    // Fixture: a coordination comment says "fro-bot/agent#1033 is closed"
    // but the live PR is actually merged. This is a real drift signal.
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

  it('synthetic #3512-style: cross-repo open issue claim becomes current when live state is open', async () => {
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

  it('synthetic #3512-style: cross-repo merged PR claim is current when live state is merged', async () => {
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

  it('synthetic #3512-style: private cross-repo claim produces unsafe finding (zero identity fields)', async () => {
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

  it('plan-status default exclusion is intact: cross-repo scan does not break plan-status exclusion', async () => {
    // Regression guard: adding cross-repo support must not re-enable plan-status in default scan
    const fileLister: FileLister = async () => ['docs/plans/my-plan.md']
    const fileReader: FileReader = async () =>
      '---\nstatus: active\ntitle: My Plan\n---\n\nfro-bot/agent#1033 is merged'

    const {claims} = await scanStatusTruthClaims({fileLister, fileReader})
    const planStatusClaims = claims.filter(c => c.kind === 'plan-status')
    expect(planStatusClaims).toHaveLength(0)
    // Cross-repo claim should still be extracted (if in DEFAULT_ENABLED_KINDS)
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c)
    // Cross-repo pr-state is in DEFAULT_ENABLED_KINDS, so it should be present
    expect(crossRepoClaims.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Ambiguous cross-repo open/closed: PR-first with issue fallback
// ---------------------------------------------------------------------------

describe('ambiguous cross-repo open/closed: PR-first with issue fallback', () => {
  // Problem: "marcusrbrown/infra#579 is closed" defaults to pr-state.
  // When PR lookup 404s but issue lookup succeeds, the finding must be
  // issue-state (current), not pr-state (unresolved).

  it('RED: ambiguous public owner/repo#N is closed — PR 404, issue closed → issue-state current finding', async () => {
    // Claim extracted as ambiguous (open/closed without explicit issue prefix)
    // PR lookup 404s, issue lookup returns closed → must produce issue-state current finding
    const octokit = makeCrossRepoOctokit({
      repoPublic: true,
      prThrows: true, // PR 404
      issueState: 'closed',
    })
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'marcusrbrown/infra#579',
      claimedState: 'closed',
      normalizedText: 'marcusrbrown/infra#579 is closed',
      targetOwner: 'marcusrbrown',
      targetRepo: 'infra',
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

  it('RED: ambiguous public owner/repo#N is open — PR lookup succeeds → pr-state current finding', async () => {
    // When PR lookup succeeds, kind stays pr-state
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

  it('RED: ambiguous claim — publicness check still happens before PR/issue lookup', async () => {
    // repos.get throws 404 → private, no PR or issue lookup attempted
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

  it('RED: ambiguous claim — private repo (private:true) still produces unsafe/no identity fields', async () => {
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

  it('RED: ambiguous claim — PR 404 and issue 404 → unresolved (both unavailable after publicness proof)', async () => {
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

  it('RED: detectStatusTruthClaims uses resolvedKind to emit issue-state finding for ambiguous claim resolved as issue', () => {
    // When resolver returns resolvedKind: 'issue-state', the finding kind must be issue-state
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'marcusrbrown/infra#579',
      claimedState: 'closed',
      normalizedText: 'marcusrbrown/infra#579 is closed',
      targetOwner: 'marcusrbrown',
      targetRepo: 'infra',
      targetNumberKind: 'ambiguous',
    }

    const resolverResults: Record<string, ResolverResult> = {
      'pr-state:marcusrbrown/infra#579': {
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

  it('RED: extractStatusTruthClaimsFromText marks ambiguous open/closed cross-repo refs with targetNumberKind=ambiguous', () => {
    // "marcusrbrown/infra#579 is closed" — no explicit issue prefix, not merged → ambiguous
    const claims = extractStatusTruthClaimsFromText({
      path: 'docs/plans/example.md',
      text: 'marcusrbrown/infra#579 is closed',
    })
    const crossRepoClaims = claims.filter(c => 'targetOwner' in c)
    expect(crossRepoClaims.length).toBeGreaterThan(0)
    const claim = crossRepoClaims[0]
    expect(claim?.targetNumberKind).toBe('ambiguous')
  })

  it('RED: explicit "issue" prefix sets targetNumberKind=issue (not ambiguous)', () => {
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

  it('RED: "merged" state sets targetNumberKind=pr (not ambiguous)', () => {
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

// ---------------------------------------------------------------------------
// Blocker 1: Fingerprint stability for ambiguous cross-repo claims
// ---------------------------------------------------------------------------

describe('fingerprint stability: ambiguous cross-repo claim resolved as pr-state vs issue-state', () => {
  it('same claim/path/sourceRef/normalizedText produces identical fingerprint regardless of resolvedKind', () => {
    // The fingerprint must be computed from the extracted claim kind (claim.kind),
    // not the effective kind (resolvedKind). This prevents fingerprint churn when
    // the same ambiguous claim resolves differently across runs.
    const claim: StatusTruthClaim = {
      kind: 'pr-state',
      path: 'docs/plans/example.md',
      sourceRef: 'marcusrbrown/infra#579',
      claimedState: 'closed',
      normalizedText: 'marcusrbrown/infra#579 is closed',
      targetOwner: 'marcusrbrown',
      targetRepo: 'infra',
      targetNumberKind: 'ambiguous',
    }

    // Resolver result 1: resolves as pr-state
    const resolverResultsPr: Record<string, ResolverResult> = {
      'pr-state:marcusrbrown/infra#579': {
        status: 'resolved',
        state: 'closed',
        resolvedKind: 'pr-state',
      },
    }

    // Resolver result 2: resolves as issue-state (PR 404, issue fallback)
    const resolverResultsIssue: Record<string, ResolverResult> = {
      'pr-state:marcusrbrown/infra#579': {
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

    // Both must be public findings (current verdict)
    expect(fpPr?.verdict).toBe('current')
    expect(fpIssue?.verdict).toBe('current')

    // Fingerprints must be identical — stable identity regardless of resolution path
    if (fpPr?.verdict !== 'unsafe' && fpIssue?.verdict !== 'unsafe') {
      expect(fpPr?.fingerprint).toBe(fpIssue?.fingerprint)
    }

    // The emitted kind may differ (pr-state vs issue-state) — that's fine
    expect(fpPr?.kind).toBe('pr-state')
    expect(fpIssue?.kind).toBe('issue-state')
  })
})

// ---------------------------------------------------------------------------
// Blocker 2: proveRepoPublic must be explicit (private === false)
// ---------------------------------------------------------------------------

describe('proveRepoPublic: explicit private === false check', () => {
  it('repos.get returning private:undefined is treated as private (not public)', async () => {
    // When the API returns an unknown/unexpected shape (private: undefined),
    // the resolver must treat it as private/unsafe — not public.
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
          // Returns private: undefined — unknown shape
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
    // private: undefined must NOT be treated as public — must be private/unsafe
    expect(result.status).toBe('private')
  })
})

// ---------------------------------------------------------------------------
// Detect Octokit construction: no-op log handlers suppress request URL leaks
// ---------------------------------------------------------------------------

describe('detect Octokit options: log suppression', () => {
  it('RED: buildDetectOctokitOptions returns options with no-op log handlers', () => {
    // The detect Octokit must not log request URLs to stderr.
    // buildDetectOctokitOptions must export options with a log object
    // whose methods are no-ops (do not write to stderr).
    const options = buildDetectOctokitOptions('test-token')
    expect(options).toHaveProperty('log')
    const log = options.log as Record<string, unknown>
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    // No-op: calling them must not throw and must not write to stderr
    ;(log.debug as (msg: string) => void)('GET /repos/marcusrbrown/infra/pulls/579 - 404')
    ;(log.info as (msg: string) => void)('test')
    ;(log.warn as (msg: string) => void)('test')
    ;(log.error as (msg: string) => void)('test')
  })

  it('RED: buildDetectOctokitOptions includes auth token', () => {
    const options = buildDetectOctokitOptions('my-secret-token')
    expect(options.auth).toBe('my-secret-token')
  })
})
