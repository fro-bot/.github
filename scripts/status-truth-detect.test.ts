import type {
  ClaimKind,
  ClaimVerdict,
  DetectOctokitClient,
  FileLister,
  FileReader,
  PublicStatusTruthFinding,
  ResolverResult,
  ResolverType,
  StatusTruthClaim,
  StatusTruthFinding,
  StatusTruthJsonReport,
} from './status-truth-detect.ts'

import {describe, expect, it} from 'vitest'

import {
  buildStatusTruthReport,
  CLAIM_KIND_DEFINITIONS,
  computeClaimFingerprint,
  detectStatusTruthClaims,
  extractStatusTruthClaimsFromText,
  isKnownReportVersion,
  KNOWN_FINGERPRINT_VERSION,
  KNOWN_SCHEMA_VERSION,
  normalizeClaimText,
  resolveAllClaims,
  resolveClaimLiveState,
  scanStatusTruthClaims,
  selectFailureClass,
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
      },
      repos: {
        getReleaseByTag: async () => {
          if (overrides.releaseThrows === true) throw new Error('API error')
          return {data: {draft: overrides.releaseDraft ?? false, prerelease: false}}
        },
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

  it('plan-status resolves to current (file-parse: claimedState is live state)', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'plan-status', sourceRef: 'docs/plans/foo.md#status', claimedState: 'active'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.state).toBe('active')
  })

  it('rollout-tracker-status returns unavailable (Phase 1 scope cut)', async () => {
    const octokit = makeMockDetectOctokit()
    const claim = makeTestClaim({kind: 'rollout-tracker-status', sourceRef: '#3512', claimedState: 'active'})
    const result = await resolveClaimLiveState({claim, octokit, owner: 'fro-bot', repo: '.github'})
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
      rest: {
        pulls: {
          get: async () => {
            callCount++
            return {data: {state: 'open', merged: false}}
          },
        },
        issues: {get: async () => ({data: {state: 'open'}})},
        repos: {getReleaseByTag: async () => ({data: {draft: false, prerelease: false}})},
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

describe('runDetect failure-class selection logic', () => {
  it('returns file-parse-error when scanErrors > 0 regardless of resolveErrors', () => {
    expect(selectFailureClass(1, 0)).toBe('file-parse-error')
    expect(selectFailureClass(3, 2)).toBe('file-parse-error')
  })

  it('returns api-unavailable when scanErrors === 0 and resolveErrors > 0', () => {
    expect(selectFailureClass(0, 1)).toBe('api-unavailable')
    expect(selectFailureClass(0, 5)).toBe('api-unavailable')
  })

  it('returns null when both scanErrors and resolveErrors are 0', () => {
    expect(selectFailureClass(0, 0)).toBeNull()
  })

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
