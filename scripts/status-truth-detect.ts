import {createHash} from 'node:crypto'

export type ClaimKind = 'pr-state' | 'issue-state' | 'release-tag-state' | 'plan-status' | 'rollout-tracker-status'

export type ResolverType = 'api' | 'file-parse' | 'compound'

export type ClaimVerdict = 'current' | 'drifted' | 'unresolved' | 'unsafe'

export type FailureClass = 'api-unavailable' | 'file-parse-error' | 'sub-resolver-unavailable' | 'execution-error'

/**
 * Result from a live-state resolver for a single claim.
 *
 * - `resolved`: live state was successfully fetched; `state` holds the value.
 *   Compound resolvers may include `subResolverResults` for required sub-resolvers.
 * - `unavailable`: the source could not be reached (API down, file missing, etc.).
 * - `private`: the source exists but identity is private/unknown — must not be
 *   exposed in findings.
 */
export type ResolverResult =
  | {
      readonly status: 'resolved'
      readonly state: string
      readonly subResolverResults?: Readonly<Record<string, ResolverResult>>
    }
  | {readonly status: 'unavailable'}
  | {readonly status: 'private'}

export interface ClaimKindDefinition {
  readonly kind: ClaimKind
  readonly resolverType: ResolverType
  /** Pattern used to extract claims of this kind from document text. */
  readonly pattern: RegExp
  /** Human-readable rule describing when a claim is considered confident. */
  readonly confidenceRule: string
  /** Human-readable rule describing when a claim is suppressed. */
  readonly suppressionRule: string
  /** Fields included in a proposal for this claim kind. */
  readonly proposalFields: readonly string[]
  /** Sub-resolvers required by compound resolvers. */
  readonly subResolvers?: readonly ClaimKind[]
}

export const CLAIM_KIND_DEFINITIONS: readonly ClaimKindDefinition[] = [
  {
    kind: 'pr-state',
    resolverType: 'api',
    pattern: /\bPR\s+#(\d+)\s+is\s+(open|closed|merged)\b/iu,
    confidenceRule: 'GitHub PR API state wins over narrative status text.',
    suppressionRule: 'Unavailable or inaccessible PRs are unresolved, not drifted.',
    proposalFields: ['kind', 'path', 'sourceRef', 'claimedState', 'liveState', 'proposedCorrection'],
  },
  {
    kind: 'issue-state',
    resolverType: 'api',
    pattern: /\bissue\s+#(\d+)\s+is\s+(open|closed)\b/iu,
    confidenceRule: 'GitHub issue API state wins over narrative status text.',
    suppressionRule: 'Unavailable or inaccessible issues are unresolved, not drifted.',
    proposalFields: ['kind', 'path', 'sourceRef', 'claimedState', 'liveState', 'proposedCorrection'],
  },
  {
    kind: 'release-tag-state',
    resolverType: 'api',
    pattern: /\brelease\s+(v[\w.-]+)\s+is\s+(published|draft|unpublished)\b/iu,
    confidenceRule:
      'GitHub release/tag API state wins over plan or issue status text. Published release does not imply deployed runtime state.',
    suppressionRule: 'Unavailable release/tag state is unresolved, not drifted.',
    proposalFields: ['kind', 'path', 'sourceRef', 'claimedState', 'liveState', 'proposedCorrection'],
  },
  {
    kind: 'plan-status',
    resolverType: 'file-parse',
    pattern: /^status:\s*(active|complete|draft|cancelled|superseded)\s*$/imu,
    confidenceRule: 'Current plan frontmatter wins over prose references to the same plan.',
    suppressionRule: 'Conflicting frontmatter/prose is unresolved, not drifted.',
    proposalFields: ['kind', 'path', 'sourceRef', 'claimedState', 'liveState', 'proposedCorrection'],
  },
  {
    kind: 'rollout-tracker-status',
    resolverType: 'compound',
    pattern: /\brollout\s+tracker\s+#(\d+)\s+is\s+(\w+)\b/iu,
    confidenceRule:
      'Use the existing rollout-tracker snapshot shape instead of re-deriving tracker truth. Snapshot/source/reference disagreement is unresolved.',
    suppressionRule:
      'Project access failure, snapshot failure, or referenced-state disagreement is unresolved rather than drifted.',
    proposalFields: ['kind', 'path', 'sourceRef', 'claimedState', 'liveState'],
    subResolvers: ['issue-state', 'pr-state'],
  },
]

export interface StatusTruthClaim {
  readonly kind: ClaimKind
  readonly path: string
  readonly sourceRef: string
  readonly claimedState: string
  readonly normalizedText: string
}

/**
 * A public finding (current/drifted/unresolved) — includes identity-bearing fields
 * because the source is known and accessible.
 */
export interface PublicStatusTruthFinding {
  readonly kind: ClaimKind
  readonly path: string
  readonly sourceRef: string
  readonly verdict: 'current' | 'drifted' | 'unresolved'
  readonly fingerprint: string
  readonly claimedState: string
  readonly liveState?: string
  readonly proposalEligible: boolean
  readonly proposedCorrection?: string
}

/**
 * An unsafe finding (private/unknown identity) — identity-bearing fields are
 * intentionally omitted to prevent leaking private repo/user/issue references.
 * Fingerprint and proposal metadata are only generated after public identity is proven.
 */
export interface UnsafeStatusTruthFinding {
  readonly kind: ClaimKind
  readonly verdict: 'unsafe'
  readonly proposalEligible: false
}

/** Discriminated union of all finding shapes. */
export type StatusTruthFinding = PublicStatusTruthFinding | UnsafeStatusTruthFinding

export interface StatusTruthCounts {
  readonly total: number
  readonly current: number
  readonly drifted: number
  readonly unresolved: number
  readonly unsafe: number
  readonly proposal_eligible: number
}

export interface StatusTruthJsonReport {
  readonly schema_version: number
  readonly fingerprint_version: number
  readonly status: 'clean' | 'findings' | 'execution-failure'
  readonly scan_complete: boolean
  readonly generated_at: string
  readonly failure_class: FailureClass | null
  readonly repair_eligible: boolean
  readonly findings: readonly StatusTruthFinding[]
  readonly counts: StatusTruthCounts
}

export interface BuildStatusTruthReportParams {
  readonly findings: readonly StatusTruthFinding[]
  readonly scanComplete: boolean
  readonly generatedAt: string
  readonly failureClass: FailureClass | null
}

export const KNOWN_SCHEMA_VERSION = 1
export const KNOWN_FINGERPRINT_VERSION = 1

/**
 * Normalize claim text for stable fingerprinting.
 * Lowercases, trims, and collapses internal whitespace.
 */
export function normalizeClaimText(text: string): string {
  return text.trim().toLowerCase().replaceAll(/\s+/gu, ' ')
}

/**
 * Compute a stable 16-hex-char fingerprint for a claim.
 *
 * Inputs: claim kind, file path, source reference, normalized claim text.
 * Line numbers are intentionally excluded so unrelated line shifts do not
 * create duplicate proposals.
 */
export function computeClaimFingerprint(
  kind: ClaimKind,
  path: string,
  sourceRef: string,
  normalizedText: string,
): string {
  const input = `${kind}\u0000${path}\u0000${sourceRef}\u0000${normalizedText}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/**
 * Build a proposed correction string for a drifted claim.
 * Replaces the claimed state with the live state in the normalized text.
 */
function buildProposedCorrection(claim: StatusTruthClaim, liveState: string): string {
  // Replace the claimed state token in the normalized text with the live state
  const escaped = claim.claimedState.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const pattern = new RegExp(String.raw`\b${escaped}\b`, 'iu')
  const corrected = claim.normalizedText.replace(pattern, liveState)
  // If replacement didn't change anything, append the correction explicitly
  if (corrected === claim.normalizedText) {
    return `${claim.normalizedText} [live: ${liveState}]`
  }
  return corrected
}

/**
 * Check whether all required sub-resolvers for a compound claim are resolved.
 *
 * Returns true only when every required sub-resolver kind has a `resolved` result
 * in the provided subResolverResults map. Missing or non-resolved sub-resolvers
 * cause the compound claim to be treated as unresolved.
 */
function compoundSubResolversAllResolved(
  kind: ClaimKind,
  subResolverResults: Readonly<Record<string, ResolverResult>> | undefined,
): boolean {
  const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === kind)
  if (!def?.subResolvers || def.subResolvers.length === 0) return true
  if (!subResolverResults) return false

  for (const subKind of def.subResolvers) {
    const subResult = subResolverResults[subKind]
    if (!subResult || subResult.status !== 'resolved') return false
  }
  return true
}

/**
 * Classify a single claim against its resolver result.
 *
 * Source precedence rules:
 * - Private/unknown identity → unsafe (identity-bearing fields not emitted)
 * - Resolver unavailable → unresolved
 * - Compound: any required sub-resolver not resolved → unresolved
 * - Live state matches claimed state → current
 * - Live state differs from claimed state → drifted
 */
function classifyClaim(
  claim: StatusTruthClaim,
  result: ResolverResult | undefined,
): {verdict: ClaimVerdict; proposalEligible: boolean; proposedCorrection?: string; liveState?: string} {
  if (!result) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  if (result.status === 'private') {
    return {verdict: 'unsafe', proposalEligible: false}
  }

  if (result.status === 'unavailable') {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  const {state: liveState, subResolverResults} = result

  const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === claim.kind)
  if (def?.resolverType === 'compound' && !compoundSubResolversAllResolved(claim.kind, subResolverResults)) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  if (liveState === claim.claimedState) {
    return {verdict: 'current', proposalEligible: false, liveState}
  }

  const proposedCorrection = buildProposedCorrection(claim, liveState)
  return {verdict: 'drifted', proposalEligible: true, proposedCorrection, liveState}
}

/** Resolver type processing order: file-parse → api → compound. */
const RESOLVER_ORDER: Record<ResolverType, number> = {'file-parse': 0, api: 1, compound: 2}

function resolverTypeForKind(kind: ClaimKind): ResolverType {
  return CLAIM_KIND_DEFINITIONS.find(d => d.kind === kind)?.resolverType ?? 'api'
}

/**
 * Detect status-truth claims and classify each against live state.
 *
 * @param claims - Extracted claims from document scanning.
 * @param resolverResults - Map from `kind:sourceRef` to ResolverResult.
 *   Keys must be formatted as `${kind}:${sourceRef}` to prevent cross-wiring
 *   between different claim kinds sharing the same source reference.
 */
export function detectStatusTruthClaims(
  claims: readonly StatusTruthClaim[],
  resolverResults: Readonly<Record<string, ResolverResult>>,
): StatusTruthFinding[] {
  const findings: StatusTruthFinding[] = []

  const sorted = [...claims].sort(
    (a, b) => RESOLVER_ORDER[resolverTypeForKind(a.kind)] - RESOLVER_ORDER[resolverTypeForKind(b.kind)],
  )

  for (const claim of sorted) {
    const resultKey = `${claim.kind}:${claim.sourceRef}`
    const result = resolverResults[resultKey]
    const {verdict, proposalEligible, proposedCorrection, liveState} = classifyClaim(claim, result)

    if (verdict === 'unsafe') {
      const finding: UnsafeStatusTruthFinding = {
        kind: claim.kind,
        verdict: 'unsafe',
        proposalEligible: false,
      }
      findings.push(finding)
    } else {
      const fingerprint = computeClaimFingerprint(claim.kind, claim.path, claim.sourceRef, claim.normalizedText)
      const finding: PublicStatusTruthFinding = {
        kind: claim.kind,
        path: claim.path,
        sourceRef: claim.sourceRef,
        verdict,
        fingerprint,
        claimedState: claim.claimedState,
        ...(liveState !== undefined && {liveState}),
        proposalEligible,
        ...(proposedCorrection !== undefined && {proposedCorrection}),
      }
      findings.push(finding)
    }
  }

  return findings
}

/**
 * Build the versioned status-truth report envelope.
 *
 * Status rules:
 * - `execution-failure` when scan is incomplete (scanComplete:false) OR failureClass is non-null
 * - `findings` when any finding is present and scan completed
 * - `clean` otherwise
 *
 * repair_eligible: true only when scan is complete, status is `findings`, and at least one finding is proposal-eligible.
 */
export function buildStatusTruthReport(params: BuildStatusTruthReportParams): StatusTruthJsonReport {
  const {findings, scanComplete, generatedAt, failureClass} = params

  const isFailure = !scanComplete || failureClass !== null
  const status: 'clean' | 'findings' | 'execution-failure' = isFailure
    ? 'execution-failure'
    : findings.length > 0
      ? 'findings'
      : 'clean'

  const proposalEligibleCount = findings.filter(f => f.proposalEligible).length
  const repairEligible = scanComplete && status === 'findings' && proposalEligibleCount > 0

  const counts: StatusTruthCounts = {
    total: findings.length,
    current: findings.filter(f => f.verdict === 'current').length,
    drifted: findings.filter(f => f.verdict === 'drifted').length,
    unresolved: findings.filter(f => f.verdict === 'unresolved').length,
    unsafe: findings.filter(f => f.verdict === 'unsafe').length,
    proposal_eligible: proposalEligibleCount,
  }

  return {
    schema_version: KNOWN_SCHEMA_VERSION,
    fingerprint_version: KNOWN_FINGERPRINT_VERSION,
    status,
    scan_complete: scanComplete,
    generated_at: generatedAt,
    failure_class: failureClass,
    repair_eligible: repairEligible,
    findings,
    counts,
  }
}

/**
 * Validate that a report's schema and fingerprint versions are known.
 * Returns false for unknown versions; the lifecycle planner must reject
 * unknown versions before any write planning.
 */
export function isKnownReportVersion(report: StatusTruthJsonReport): boolean {
  return report.schema_version === KNOWN_SCHEMA_VERSION && report.fingerprint_version === KNOWN_FINGERPRINT_VERSION
}
