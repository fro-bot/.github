import type {
  ClaimKind,
  ClaimVerdict,
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
  isKnownReportVersion,
  KNOWN_FINGERPRINT_VERSION,
  KNOWN_SCHEMA_VERSION,
  normalizeClaimText,
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
