/**
 * The model every status-truth step shares: the claim kinds and their grammars, the finding and report types, the report envelope with its schema and fingerprint versions, the claim fingerprint, and the artifact validator the proposals and PR steps run before they plan a write.
 *
 * A leaf: it imports only the rollout snapshot types.
 */

import type {RolloutSnapshot as TrackerSnapshot} from './rollout-tracker-snapshot.ts'
import {createHash} from 'node:crypto'

/** Status Truth resolves claims against the tracked items only; the wake signals are not consumed here. */
export type StatusTruthSnapshot = Pick<TrackerSnapshot, 'items'>

export type ClaimKind =
  'pr-state' | 'issue-state' | 'release-tag-state' | 'plan-status' | 'rollout-tracker-status' | 'plan-consistency'

export type ResolverType = 'api' | 'file-parse' | 'compound'

export type ClaimVerdict = 'current' | 'drifted' | 'unresolved' | 'unsafe'

export type FailureClass = 'api-unavailable' | 'file-parse-error' | 'sub-resolver-unavailable' | 'execution-error'

/**
 * Result from a live-state resolver for a single claim.
 *
 * - `resolved`: live state was successfully fetched; `state` holds the value.
 *   Compound resolvers may include `subResolverResults` for required sub-resolvers.
 *   `resolvedKind` is set when the resolver determined a different kind than the
 *   claim's declared kind (e.g., ambiguous open/closed resolved as issue-state).
 * - `unavailable`: the source could not be reached (API down, file missing, etc.).
 * - `private`: the source exists but identity is private/unknown — must not be
 *   exposed in findings.
 */
export type ResolverResult =
  | {
      readonly status: 'resolved'
      readonly state: string
      readonly resolvedKind?: ClaimKind
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
    /**
     * Cross-file plan-status claim grammar.
     *
     * Matches explicit prose references to a plan file with a supported status:
     *   "docs/plans/<name>.md is active"
     *   "plan docs/plans/<name>.md is complete"
     *
     * Groups: [planPath, status]
     *
     * Requires an explicit `docs/plans/...md` path so ambiguous self-references
     * and implicit prose like "the plan is active" are not extracted.
     * Self-referential frontmatter (status: active in the plan's own file) is
     * intentionally NOT matched — only cross-file prose claims are extracted.
     *
     * Path segments are restricted to `[\w-]+` (word chars and hyphens only),
     * which prevents `..` traversal segments from matching.
     */
    pattern:
      /\b(?:plan\s+)?(docs\/plans\/(?:[\w-]+\/)*[\w-]+\.md)\s+is\s+(active|complete|draft|cancelled|superseded)\b/iu,
    confidenceRule: 'Current plan frontmatter wins over prose references to the same plan.',
    suppressionRule:
      'Ambiguous self-references, missing files, malformed frontmatter, or unsupported status values are unresolved, not drifted.',
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
  /** Present only for cross-repo claims. Proven public before any identity is emitted. */
  readonly targetOwner?: string
  /** Present only for cross-repo claims. Proven public before any identity is emitted. */
  readonly targetRepo?: string
  /**
   * Disambiguation hint for cross-repo open/closed claims.
   * - `'pr'`: explicitly a PR (e.g., state is 'merged', or explicit PR grammar)
   * - `'issue'`: explicitly an issue (e.g., 'issue owner/repo#N is ...' prefix)
   * - `'ambiguous'`: open/closed without explicit prefix — try PR first, then issue
   * - `undefined`: not a cross-repo claim, or kind is unambiguous
   */
  readonly targetNumberKind?: 'pr' | 'issue' | 'ambiguous'
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
 * Select the failure class for the detect step, distinguishing file-system scan
 * errors from GitHub API/issue errors.
 *
 * Precedence:
 * - `file-parse-error`: per-file read/parse errors during file-system scanning
 * - `api-unavailable`: issue list/comment fetch failures or resolver API errors
 * - `null`: no errors
 *
 * Issue scan errors (issueScanErrors) are API failures — the GitHub issue list
 * or comment endpoints were unreachable — and must not be reported as
 * `file-parse-error`. Only `fileScanErrors` (local file read failures) map to
 * `file-parse-error`.
 */
export function selectDetectFailureClass(params: {
  fileScanErrors: number
  issueScanErrors: number
  resolveErrors: number
}): FailureClass | null {
  const {fileScanErrors, issueScanErrors, resolveErrors} = params
  if (fileScanErrors > 0) return 'file-parse-error'
  if (issueScanErrors > 0 || resolveErrors > 0) return 'api-unavailable'
  return null
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

/**
 * Prohibited fields that must not appear in a handoff artifact.
 * These fields would expose raw claim text, source snippets, or private identity.
 */
const PROHIBITED_ARTIFACT_FIELDS: readonly string[] = ['normalizedText', 'rawText', 'sourceSnippet', 'apiResponse']

/**
 * Validate a parsed report artifact before the open step can write.
 *
 * Checks (in order):
 * 1. Known schema and fingerprint versions.
 * 2. Required top-level fields are present.
 * 3. Prohibited fields are absent (sanitized artifact contract).
 * 4. Aggregate count consistency: counts.total === findings.length.
 *
 * Returns an object with `valid: boolean` and `reason: string` on failure.
 */
export function validateStatusTruthArtifact(
  raw: unknown,
): {valid: true; report: StatusTruthJsonReport} | {valid: false; reason: string} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {valid: false, reason: 'artifact is not an object'}
  }

  const obj = raw as Record<string, unknown>

  // 1. Version check
  if (typeof obj.schema_version !== 'number' || typeof obj.fingerprint_version !== 'number') {
    return {valid: false, reason: 'artifact missing schema_version or fingerprint_version'}
  }
  if (obj.schema_version !== KNOWN_SCHEMA_VERSION || obj.fingerprint_version !== KNOWN_FINGERPRINT_VERSION) {
    return {
      valid: false,
      reason: `unknown artifact version: schema=${obj.schema_version} fingerprint=${obj.fingerprint_version}`,
    }
  }

  // 2. Required fields
  const requiredFields = [
    'status',
    'scan_complete',
    'generated_at',
    'failure_class',
    'repair_eligible',
    'findings',
    'counts',
  ]
  for (const field of requiredFields) {
    if (!(field in obj)) {
      return {valid: false, reason: `artifact missing required field: ${field}`}
    }
  }

  if (!Array.isArray(obj.findings)) {
    return {valid: false, reason: 'artifact findings is not an array'}
  }

  // 3. Prohibited fields (sanitized artifact contract)
  for (const field of PROHIBITED_ARTIFACT_FIELDS) {
    if (field in obj) {
      return {valid: false, reason: `artifact contains prohibited field: ${field}`}
    }
    // Also check within each finding
    for (const finding of obj.findings as unknown[]) {
      if (typeof finding === 'object' && finding !== null && field in (finding as Record<string, unknown>)) {
        return {valid: false, reason: `artifact finding contains prohibited field: ${field}`}
      }
    }
  }

  // 4. Count consistency
  const counts = obj.counts as Record<string, unknown>
  if (typeof counts !== 'object' || counts === null) {
    return {valid: false, reason: 'artifact counts is not an object'}
  }
  if (typeof counts.total !== 'number') {
    return {valid: false, reason: 'artifact counts.total is not a number'}
  }
  if (counts.total !== (obj.findings as unknown[]).length) {
    return {
      valid: false,
      reason: `artifact count mismatch: counts.total=${counts.total} but findings.length=${(obj.findings as unknown[]).length}`,
    }
  }

  return {valid: true, report: raw as StatusTruthJsonReport}
}
