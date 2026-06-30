import {createHash} from 'node:crypto'
import {readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'

export type ClaimKind = 'pr-state' | 'issue-state' | 'release-tag-state' | 'plan-status' | 'rollout-tracker-status'

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
 * Build a proposed correction string for a drifted claim.
 * Replaces the claimed state with the live state in the normalized text.
 */
function buildProposedCorrection(claim: StatusTruthClaim, liveState: string): string {
  // Replace the claimed state token in the normalized text with the live state.
  // Use a replacement function (not a string) so that live-state values containing
  // special replacement tokens like `$&`, `$1`, `$$` are inserted literally.
  const escaped = claim.claimedState.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const pattern = new RegExp(String.raw`\b${escaped}\b`, 'iu')
  const corrected = claim.normalizedText.replace(pattern, () => liveState)
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
 *
 * When the resolver returns `resolvedKind`, the effective kind for the finding
 * is `resolvedKind` (e.g., ambiguous open/closed resolved as issue-state).
 */
function classifyClaim(
  claim: StatusTruthClaim,
  result: ResolverResult | undefined,
): {
  verdict: ClaimVerdict
  proposalEligible: boolean
  proposedCorrection?: string
  liveState?: string
  effectiveKind?: ClaimKind
} {
  if (!result) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  if (result.status === 'private') {
    return {verdict: 'unsafe', proposalEligible: false}
  }

  if (result.status === 'unavailable') {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  const {state: liveState, subResolverResults, resolvedKind} = result
  const effectiveKind = resolvedKind ?? claim.kind

  const def = CLAIM_KIND_DEFINITIONS.find(d => d.kind === effectiveKind)
  if (def?.resolverType === 'compound' && !compoundSubResolversAllResolved(effectiveKind, subResolverResults)) {
    return {verdict: 'unresolved', proposalEligible: false}
  }

  if (liveState === claim.claimedState) {
    return {verdict: 'current', proposalEligible: false, liveState, effectiveKind}
  }

  const proposedCorrection = buildProposedCorrection(claim, liveState)
  return {verdict: 'drifted', proposalEligible: true, proposedCorrection, liveState, effectiveKind}
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
    const {verdict, proposalEligible, proposedCorrection, liveState, effectiveKind} = classifyClaim(claim, result)
    // Use effectiveKind when the resolver determined a different kind (e.g., ambiguous → issue-state)
    const findingKind = effectiveKind ?? claim.kind

    if (verdict === 'unsafe') {
      const finding: UnsafeStatusTruthFinding = {
        kind: findingKind,
        verdict: 'unsafe',
        proposalEligible: false,
      }
      findings.push(finding)
    } else {
      // Fingerprint uses the extracted claim kind (claim.kind), not the effective kind.
      // This keeps proposal identity stable even when ambiguous claims resolve differently
      // across runs (e.g., pr-state vs issue-state fallback for open/closed cross-repo refs).
      const fingerprint = computeClaimFingerprint(claim.kind, claim.path, claim.sourceRef, claim.normalizedText)
      const finding: PublicStatusTruthFinding = {
        kind: findingKind,
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

// ---------------------------------------------------------------------------
// Unit 4: Text extraction and file scanning
// ---------------------------------------------------------------------------

/**
 * Bounded allowlist of glob patterns for public docs paths to scan.
 * Excludes generated/proposal state (metadata/, data branch paths).
 */
export const SCAN_GLOB_PATTERNS: readonly string[] = [
  'README.md',
  'SECURITY.md',
  'docs/**/*.md',
  'knowledge/**/*.md',
  '.github/**/*.md',
]

/**
 * Paths to exclude from scanning (generated/proposal state, and example/brainstorm
 * prose that may contain illustrative status-truth patterns that must not trigger
 * real proposals).
 */
const SCAN_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /^metadata\//u,
  /^\.github\/workflows\//u,
  /^node_modules\//u,
  /^docs\/brainstorms\//u,
]

function isExcludedPath(filePath: string): boolean {
  return SCAN_EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath))
}

/**
 * Pattern to detect cross-repo references in text (owner/repo#N format).
 * Used to suppress bare #N extraction when the same number appears in a
 * cross-repo context nearby, preventing misresolution as current-repo.
 */
const CROSS_REPO_REF_PATTERN = /\b[\w.-]+\/[\w.-]+#(\d+)\b/gu

/**
 * Cross-repo PR/issue claim grammar patterns.
 *
 * Matches:
 *   - `owner/repo#N is merged|open|closed`  (PR or issue — disambiguated by state)
 *   - `issue owner/repo#N is open|closed`   (explicit issue prefix)
 *   - `release owner/repo@tag is published|draft|unpublished`
 *
 * Groups: [owner, repo, number, state]
 */
const CROSS_REPO_PR_ISSUE_PATTERN = /\b(?:(issue)\s+)?([\w.-]+)\/([\w.-]+)#(\d+)\s+is\s+(merged|open|closed)\b/giu

/**
 * Cross-repo release/tag claim grammar pattern.
 *
 * Matches: `release owner/repo@tag is published|draft|unpublished`
 * Groups: [owner, repo, tag, state]
 */
const CROSS_REPO_RELEASE_PATTERN =
  /\brelease\s+([\w.-]+)\/([\w.-]+)@([\w.-]+)\s+is\s+(published|draft|unpublished)\b/giu

/**
 * Build a set of issue/PR numbers that appear in cross-repo references
 * within the given text. These numbers must not be extracted as bare #N
 * current-repo references.
 *
 * Example: "fro-bot/agent#1033 PR #1033 is open" → Set{'1033'}
 */
function extractCrossRepoNumbers(text: string): Set<string> {
  const crossRepoNumbers = new Set<string>()
  for (const match of text.matchAll(CROSS_REPO_REF_PATTERN)) {
    const num = match[1]
    if (num !== undefined) crossRepoNumbers.add(num)
  }
  return crossRepoNumbers
}

/**
 * Extract status-truth claims from a single document's text.
 *
 * Pure function: no I/O. Exported for testing.
 *
 * For each CLAIM_KIND_DEFINITIONS pattern, scans the text for all matches.
 * Returns one StatusTruthClaim per match with:
 * - kind: the claim kind
 * - path: the file path (caller-provided)
 * - sourceRef: derived from the match groups (number or tag)
 * - claimedState: the state captured in the match
 * - normalizedText: the normalized match text
 *
 * Cross-repo references: if a number appears in an owner/repo#N context
 * anywhere in the text, bare #N claims for that number are skipped to
 * prevent misresolution as current-repo references.
 */
export function extractStatusTruthClaimsFromText(params: {path: string; text: string}): StatusTruthClaim[] {
  const {path, text} = params
  const claims: StatusTruthClaim[] = []

  // Pre-compute numbers that appear in cross-repo references (owner/repo#N).
  // These must not be extracted as bare current-repo #N references.
  const crossRepoNumbers = extractCrossRepoNumbers(text)

  for (const def of CLAIM_KIND_DEFINITIONS) {
    // Use global flag for multi-match scanning
    const globalPattern = new RegExp(
      def.pattern.source,
      def.pattern.flags.includes('g') ? def.pattern.flags : `${def.pattern.flags}g`,
    )

    for (const match of text.matchAll(globalPattern)) {
      const fullMatch = match[0]
      if (fullMatch === undefined) continue

      let sourceRef: string
      let claimedState: string

      if (def.kind === 'pr-state' || def.kind === 'issue-state' || def.kind === 'rollout-tracker-status') {
        // Groups: [number, state]
        const number = match[1]
        const state = match[2]
        if (number === undefined || state === undefined) continue
        // Skip if this number appears in a cross-repo reference in the same text.
        // This prevents "fro-bot/agent#1033 PR #1033 is open" from producing
        // a bare #1033 that the resolver would treat as a current-repo reference.
        if (crossRepoNumbers.has(number)) continue
        sourceRef = `#${number}`
        claimedState = state.toLowerCase()
      } else if (def.kind === 'release-tag-state') {
        // Groups: [tag, state]
        const tag = match[1]
        const state = match[2]
        if (tag === undefined || state === undefined) continue
        sourceRef = `@${tag}`
        claimedState = state.toLowerCase()
      } else if (def.kind === 'plan-status') {
        // Groups: [state] — frontmatter status field
        const state = match[1]
        if (state === undefined) continue
        sourceRef = `${path}#status`
        claimedState = state.toLowerCase()
      } else {
        continue
      }

      const normalizedText = normalizeClaimText(fullMatch)
      claims.push({kind: def.kind, path, sourceRef, claimedState, normalizedText})
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-repo claim extraction
  // ---------------------------------------------------------------------------

  // Extract cross-repo PR/issue claims: `[issue] owner/repo#N is merged|open|closed`
  for (const match of text.matchAll(CROSS_REPO_PR_ISSUE_PATTERN)) {
    const issuePrefix = match[1] // 'issue' or undefined
    const owner = match[2]
    const repo = match[3]
    const number = match[4]
    const state = match[5]
    if (owner === undefined || repo === undefined || number === undefined || state === undefined) continue

    const fullMatch = match[0]
    const normalizedText = normalizeClaimText(fullMatch)
    const claimedState = state.toLowerCase()

    // Disambiguate: if state is 'merged', it's a PR. If 'issue' prefix, it's an issue.
    // Otherwise 'open'/'closed' could be either — mark as ambiguous for PR-first resolution.
    let kind: ClaimKind
    let targetNumberKind: 'pr' | 'issue' | 'ambiguous'
    if (issuePrefix !== undefined) {
      kind = 'issue-state'
      targetNumberKind = 'issue'
    } else if (claimedState === 'merged') {
      kind = 'pr-state'
      targetNumberKind = 'pr'
    } else {
      // 'open' or 'closed' without 'issue' prefix — ambiguous (PR or issue)
      kind = 'pr-state'
      targetNumberKind = 'ambiguous'
    }

    const sourceRef = `${owner}/${repo}#${number}`
    claims.push({
      kind,
      path,
      sourceRef,
      claimedState,
      normalizedText,
      targetOwner: owner,
      targetRepo: repo,
      targetNumberKind,
    })
  }

  // Extract cross-repo release claims: `release owner/repo@tag is published|draft|unpublished`
  for (const match of text.matchAll(CROSS_REPO_RELEASE_PATTERN)) {
    const owner = match[1]
    const repo = match[2]
    const tag = match[3]
    const state = match[4]
    if (owner === undefined || repo === undefined || tag === undefined || state === undefined) continue

    const fullMatch = match[0]
    const normalizedText = normalizeClaimText(fullMatch)
    const claimedState = state.toLowerCase()
    const sourceRef = `${owner}/${repo}@${tag}`

    claims.push({
      kind: 'release-tag-state',
      path,
      sourceRef,
      claimedState,
      normalizedText,
      targetOwner: owner,
      targetRepo: repo,
    })
  }

  return claims
}

/**
 * Injected file reader type for testability.
 * Production: reads from disk. Tests: returns fixture content.
 */
export type FileReader = (filePath: string) => Promise<string>

/**
 * Injected file lister type for testability.
 * Production: globs the filesystem. Tests: returns fixture paths.
 */
export type FileLister = () => Promise<string[]>

/**
 * Claim kinds enabled by default in production scans.
 *
 * `plan-status` is intentionally excluded from the default set because
 * `resolveClaimLiveState` returns `unavailable` for it (no file-parse resolver
 * exists yet). Including it would produce 100% unresolved findings with zero
 * signal — pure noise in dry-run output.
 *
 * Callers may opt in by passing `enabledKinds` explicitly.
 */
export const DEFAULT_ENABLED_KINDS: readonly ClaimKind[] = [
  'pr-state',
  'issue-state',
  'release-tag-state',
  'rollout-tracker-status',
]

/**
 * Scan a bounded set of public docs paths for status-truth claims.
 *
 * @param params - Scan parameters.
 * @param params.fileLister - Injected function that returns the list of paths to scan.
 * @param params.fileReader - Injected function that reads a file's text content.
 * @param params.enabledKinds - Claim kinds to include. Defaults to DEFAULT_ENABLED_KINDS
 *   (excludes plan-status until a real file-parse resolver exists).
 * @returns All extracted claims from all scanned files.
 *
 * Scan failures for individual files are counted but do not abort the scan.
 * If the file lister itself fails, throws so the caller can emit execution-failure.
 */
export async function scanStatusTruthClaims(params: {
  fileLister: FileLister
  fileReader: FileReader
  enabledKinds?: readonly ClaimKind[]
}): Promise<{claims: StatusTruthClaim[]; scanErrors: number}> {
  const {fileLister, fileReader, enabledKinds = DEFAULT_ENABLED_KINDS} = params
  const paths = await fileLister()
  const claims: StatusTruthClaim[] = []
  let scanErrors = 0

  for (const filePath of paths) {
    if (isExcludedPath(filePath)) continue
    try {
      const text = await fileReader(filePath)
      const fileClaims = extractStatusTruthClaimsFromText({path: filePath, text}).filter(c =>
        enabledKinds.includes(c.kind),
      )
      claims.push(...fileClaims)
    } catch {
      // Count per-file read errors; do not abort the scan
      scanErrors++
    }
  }

  return {claims, scanErrors}
}

// ---------------------------------------------------------------------------
// Unit 4: GitHub issue body/comment scanning
// ---------------------------------------------------------------------------

/**
 * A minimal issue list item returned by the issue lister.
 * Injected for testability; production uses Octokit list response.
 */
export interface IssueListItem {
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly labels: readonly {readonly name: string}[]
}

/**
 * A minimal issue comment returned by the comment fetcher.
 * Injected for testability; production uses Octokit list response.
 */
export interface IssueComment {
  readonly id: number
  readonly body: string | null
}

/**
 * Injected issue lister type for testability.
 * Production: calls Octokit issues.listForRepo. Tests: returns fixture data.
 */
export type IssueLister = (params: {owner: string; repo: string}) => Promise<IssueListItem[]>

/**
 * Injected issue comment fetcher type for testability.
 * Production: calls Octokit issues.listComments. Tests: returns fixture data.
 */
export type IssueCommentFetcher = (params: {
  owner: string
  repo: string
  issueNumber: number
}) => Promise<IssueComment[]>

/**
 * Labels and title markers that identify status-truth proposal issues.
 * Issues matching any of these are excluded from scanning to prevent
 * the loop from scanning its own proposal state.
 */
const STATUS_TRUTH_PROPOSAL_LABELS: readonly string[] = ['status-truth']
const STATUS_TRUTH_PROPOSAL_TITLE_MARKER = '[status-truth-proposal]'

/**
 * Check whether an issue is a status-truth proposal issue that should be excluded.
 * Matches by label name or title prefix/marker.
 */
function isStatusTruthProposalIssue(issue: IssueListItem): boolean {
  for (const label of issue.labels) {
    if (STATUS_TRUTH_PROPOSAL_LABELS.includes(label.name)) return true
  }
  return issue.title.toLowerCase().includes(STATUS_TRUTH_PROPOSAL_TITLE_MARKER)
}

/**
 * Build a synthetic public-safe path for an issue body source.
 * Format: `github-issue://current/issues/<number>#body`
 *
 * Uses `current` instead of `owner/repo` so that generic code does not
 * embed identity before explicit publicness proof. The resolver already
 * knows the owner/repo from its own context.
 */
function issueBodyPath(issueNumber: number): string {
  return `github-issue://current/issues/${issueNumber}#body`
}

/**
 * Build a synthetic public-safe path for an issue comment source.
 * Format: `github-issue://current/issues/<number>#comment-<id>`
 *
 * Uses `current` instead of `owner/repo` for the same reason as issueBodyPath.
 */
function issueCommentPath(issueNumber: number, commentId: number): string {
  return `github-issue://current/issues/${issueNumber}#comment-${commentId}`
}

/**
 * Scan current-repo GitHub issue bodies and comments for status-truth claims.
 *
 * @param params - Scan parameters.
 * @param params.owner - Repository owner.
 * @param params.repo - Repository name.
 * @param params.issueLister - Injected function that returns open issues.
 * @param params.commentFetcher - Injected function that returns comments for an issue.
 * @param params.enabledKinds - Claim kinds to include. Defaults to DEFAULT_ENABLED_KINDS.
 * @returns Extracted claims and scan error count.
 *
 * Failure behavior:
 * - If the issue list fetch fails, returns scanErrors > 0 and empty claims (non-clean).
 * - Per-issue comment fetch failures count as scan errors but do not abort body scanning.
 * - Issues labeled `status-truth` or containing the proposal marker are skipped.
 * - Null bodies/comments are silently skipped (no error).
 */
export async function scanIssueStatusTruthClaims(params: {
  owner: string
  repo: string
  issueLister: IssueLister
  commentFetcher: IssueCommentFetcher
  enabledKinds?: readonly ClaimKind[]
}): Promise<{claims: StatusTruthClaim[]; scanErrors: number}> {
  const {owner, repo, issueLister, commentFetcher, enabledKinds = DEFAULT_ENABLED_KINDS} = params
  const claims: StatusTruthClaim[] = []
  let scanErrors = 0

  let issues: IssueListItem[]
  try {
    issues = await issueLister({owner, repo})
  } catch {
    // Issue list fetch failure — non-clean, report as scan error
    scanErrors++
    return {claims, scanErrors}
  }

  for (const issue of issues) {
    // Skip status-truth proposal issues to prevent self-scanning
    if (isStatusTruthProposalIssue(issue)) continue

    // Scan issue body
    if (issue.body !== null && issue.body !== '') {
      const bodyPath = issueBodyPath(issue.number)
      const bodyClaims = extractStatusTruthClaimsFromText({path: bodyPath, text: issue.body}).filter(c =>
        enabledKinds.includes(c.kind),
      )
      claims.push(...bodyClaims)
    }

    // Scan issue comments
    try {
      const comments = await commentFetcher({owner, repo, issueNumber: issue.number})
      for (const comment of comments) {
        if (comment.body === null || comment.body === '') continue
        const commentPath = issueCommentPath(issue.number, comment.id)
        const commentClaims = extractStatusTruthClaimsFromText({path: commentPath, text: comment.body}).filter(c =>
          enabledKinds.includes(c.kind),
        )
        claims.push(...commentClaims)
      }
    } catch {
      // Per-issue comment fetch failure — count as scan error, continue with other issues
      scanErrors++
    }
  }

  return {claims, scanErrors}
}

// ---------------------------------------------------------------------------
// Unit 4: Current-repo resolver helpers
// ---------------------------------------------------------------------------

/**
 * Minimal Octokit-like client for the detect step (read-only).
 * Injected for testability; production code uses @octokit/rest Octokit.
 *
 * `paginate` mirrors the Octokit paginate API: given a REST endpoint function
 * and its params, it fetches all pages and returns the flattened data array.
 * This is the only supported pagination mechanism for issue/comment listing.
 */
export interface DetectOctokitClient {
  readonly paginate: <T>(fn: unknown, params: unknown) => Promise<T[]>
  readonly rest: {
    readonly pulls: {
      readonly get: (params: {owner: string; repo: string; pull_number: number}) => Promise<{
        data: {state: string; merged: boolean}
      }>
    }
    readonly issues: {
      readonly get: (params: {owner: string; repo: string; issue_number: number}) => Promise<{
        data: {state: string}
      }>
      readonly listForRepo: (params: {
        owner: string
        repo: string
        state: 'open' | 'closed' | 'all'
        per_page: number
      }) => Promise<{
        data: {
          number: number
          title: string
          body: string | null
          labels: {name?: string | undefined}[]
        }[]
      }>
      readonly listComments: (params: {
        owner: string
        repo: string
        issue_number: number
        per_page: number
      }) => Promise<{
        data: {id: number; body?: string | null | undefined}[]
      }>
    }
    readonly repos: {
      readonly getReleaseByTag: (params: {owner: string; repo: string; tag: string}) => Promise<{
        data: {draft: boolean; prerelease: boolean}
      }>
      /**
       * Used for cross-repo publicness proof.
       * Returns `{data: {private: boolean}}`.
       * Throws with `.status` 403 or 404 when the repo is inaccessible/private.
       */
      readonly get: (params: {owner: string; repo: string}) => Promise<{
        data: {private: boolean}
      }>
    }
  }
}

/**
 * Fetch all open issues for the current repo using Octokit pagination.
 *
 * Uses `octokit.paginate` to fetch every page, so "clean" cannot mean
 * "nothing in the first 100 results". Exported for unit-testability.
 */
export async function listCurrentRepoIssues(
  octokit: DetectOctokitClient,
  owner: string,
  repo: string,
): Promise<IssueListItem[]> {
  const raw = await octokit.paginate<{
    number: number
    title: string
    body: string | null
    labels: {name?: string | undefined}[]
  }>(octokit.rest.issues.listForRepo, {owner, repo, state: 'open', per_page: 100})
  return raw.map(issue => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map(l => ({name: l.name ?? ''})),
  }))
}

/**
 * Fetch all comments for a single issue using Octokit pagination.
 *
 * Uses `octokit.paginate` to fetch every page. Exported for unit-testability.
 */
export async function listCurrentRepoIssueComments(
  octokit: DetectOctokitClient,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueComment[]> {
  const raw = await octokit.paginate<{id: number; body?: string | null | undefined}>(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  })
  return raw.map(c => ({id: c.id, body: c.body ?? null}))
}

/**
 * Resolve a single claim's live state using the injected Octokit client.
 *
 * Current-repo scoped: only resolves claims whose sourceRef is a bare `#N` or `@tag`
 * (no `owner/repo` prefix). Cross-repo or unsupported refs return `unavailable`.
 *
 * PR state: 'open' | 'closed' | 'merged'
 * Issue state: 'open' | 'closed'
 * Release state: 'published' | 'draft'
 * Plan-status: resolved via file-parse (not this function)
 * Rollout-tracker: compound — returns unavailable (Phase 1 scope cut)
 */
/**
 * Prove that a target repo is public using `repos.get`.
 *
 * Returns `true` if the repo is confirmed public.
 * Returns `false` if the repo is private (`data.private === true`).
 * Throws with `{status: 'private'}` sentinel if the API throws 403/404 or any
 * other error before publicness is confirmed — callers must treat this as private.
 *
 * This is the ONLY gate before cross-repo identity is exposed in findings.
 */
async function proveRepoPublic(
  octokit: DetectOctokitClient,
  targetOwner: string,
  targetRepo: string,
): Promise<boolean> {
  const {data} = await octokit.rest.repos.get({owner: targetOwner, repo: targetRepo})
  return data.private === false
}

export async function resolveClaimLiveState(params: {
  claim: StatusTruthClaim
  octokit: DetectOctokitClient
  owner: string
  repo: string
}): Promise<ResolverResult> {
  const {claim, octokit, owner, repo} = params

  // ---------------------------------------------------------------------------
  // Cross-repo resolution: publicness proof required before any identity exposure
  // ---------------------------------------------------------------------------
  if (claim.targetOwner !== undefined && claim.targetRepo !== undefined) {
    const targetOwner = claim.targetOwner
    const targetRepo = claim.targetRepo

    // Step 1: Prove publicness. Any failure before proof → private.
    let isPublic: boolean
    try {
      isPublic = await proveRepoPublic(octokit, targetOwner, targetRepo)
    } catch {
      // 403, 404, or any other error before proof → treat as private
      return {status: 'private'}
    }

    if (!isPublic) {
      return {status: 'private'}
    }

    // Step 2: Publicness proven. Resolve against target repo.
    // API failure AFTER proof → unavailable (identity already proven public).
    if (claim.kind === 'pr-state') {
      const match = /^[\w.-]+\/[\w.-]+#(\d+)$/u.exec(claim.sourceRef)
      if (match === null || match[1] === undefined) return {status: 'unavailable'}
      const prNumber = Number.parseInt(match[1], 10)

      // Ambiguous open/closed: try PR first, fall back to issue if PR lookup fails
      if (claim.targetNumberKind === 'ambiguous') {
        try {
          const {data} = await octokit.rest.pulls.get({owner: targetOwner, repo: targetRepo, pull_number: prNumber})
          if (data.merged) return {status: 'resolved', state: 'merged', resolvedKind: 'pr-state'}
          return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed', resolvedKind: 'pr-state'}
        } catch {
          // PR lookup failed — try issue fallback
        }
        try {
          const {data} = await octokit.rest.issues.get({
            owner: targetOwner,
            repo: targetRepo,
            issue_number: prNumber,
          })
          return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed', resolvedKind: 'issue-state'}
        } catch {
          return {status: 'unavailable'}
        }
      }

      // Explicit PR (merged, or targetNumberKind === 'pr')
      try {
        const {data} = await octokit.rest.pulls.get({owner: targetOwner, repo: targetRepo, pull_number: prNumber})
        if (data.merged) return {status: 'resolved', state: 'merged'}
        return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
      } catch {
        return {status: 'unavailable'}
      }
    }

    if (claim.kind === 'issue-state') {
      const match = /^[\w.-]+\/[\w.-]+#(\d+)$/u.exec(claim.sourceRef)
      if (match === null || match[1] === undefined) return {status: 'unavailable'}
      const issueNumber = Number.parseInt(match[1], 10)
      try {
        const {data} = await octokit.rest.issues.get({owner: targetOwner, repo: targetRepo, issue_number: issueNumber})
        return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
      } catch {
        return {status: 'unavailable'}
      }
    }

    if (claim.kind === 'release-tag-state') {
      const match = /^[\w.-]+\/[\w.-]+@(.+)$/u.exec(claim.sourceRef)
      if (match === null || match[1] === undefined) return {status: 'unavailable'}
      const tag = match[1]
      try {
        const {data} = await octokit.rest.repos.getReleaseByTag({owner: targetOwner, repo: targetRepo, tag})
        return {status: 'resolved', state: data.draft ? 'draft' : 'published'}
      } catch {
        return {status: 'unavailable'}
      }
    }

    // Unsupported cross-repo claim kind
    return {status: 'unavailable'}
  }

  if (claim.kind === 'plan-status') {
    // plan-status requires cross-file comparison to detect drift, which is out of
    // Phase 1 scope. Returning the claimedState as live state would always show
    // 'current' and mask real drift. Mark as unavailable so the finding is
    // classified as unresolved (honest scope-cut, same as rollout-tracker).
    return {status: 'unavailable'}
  }

  if (claim.kind === 'rollout-tracker-status') {
    // Compound resolver: Phase 1 scope cut — mark unavailable
    return {status: 'unavailable'}
  }

  if (claim.kind === 'pr-state') {
    // sourceRef must be bare `#N` for current-repo
    const match = /^#(\d+)$/u.exec(claim.sourceRef)
    if (match === null || match[1] === undefined) {
      // Cross-repo or malformed ref — unavailable
      return {status: 'unavailable'}
    }
    const prNumber = Number.parseInt(match[1], 10)
    try {
      const {data} = await octokit.rest.pulls.get({owner, repo, pull_number: prNumber})
      if (data.merged) return {status: 'resolved', state: 'merged'}
      return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
    } catch {
      return {status: 'unavailable'}
    }
  }

  if (claim.kind === 'issue-state') {
    const match = /^#(\d+)$/u.exec(claim.sourceRef)
    if (match === null || match[1] === undefined) {
      return {status: 'unavailable'}
    }
    const issueNumber = Number.parseInt(match[1], 10)
    try {
      const {data} = await octokit.rest.issues.get({owner, repo, issue_number: issueNumber})
      return {status: 'resolved', state: data.state === 'open' ? 'open' : 'closed'}
    } catch {
      return {status: 'unavailable'}
    }
  }

  if (claim.kind === 'release-tag-state') {
    const match = /^@(.+)$/u.exec(claim.sourceRef)
    if (match === null || match[1] === undefined) {
      return {status: 'unavailable'}
    }
    const tag = match[1]
    try {
      const {data} = await octokit.rest.repos.getReleaseByTag({owner, repo, tag})
      return {status: 'resolved', state: data.draft ? 'draft' : 'published'}
    } catch {
      return {status: 'unavailable'}
    }
  }

  return {status: 'unavailable'}
}

/**
 * Resolve all claims against live state using the injected Octokit client.
 *
 * Returns a resolver results map keyed by `kind:sourceRef`.
 * Resolution failures for individual claims are counted but do not abort.
 */
export async function resolveAllClaims(params: {
  claims: readonly StatusTruthClaim[]
  octokit: DetectOctokitClient
  owner: string
  repo: string
}): Promise<{resolverResults: Record<string, ResolverResult>; resolveErrors: number}> {
  const {claims, octokit, owner, repo} = params
  const resolverResults: Record<string, ResolverResult> = {}
  let resolveErrors = 0

  // Deduplicate by kind:sourceRef to avoid redundant API calls
  const seen = new Set<string>()

  for (const claim of claims) {
    const key = `${claim.kind}:${claim.sourceRef}`
    if (seen.has(key)) continue
    seen.add(key)

    try {
      resolverResults[key] = await resolveClaimLiveState({claim, octokit, owner, repo})
    } catch {
      resolveErrors++
      resolverResults[key] = {status: 'unavailable'}
    }
  }

  return {resolverResults, resolveErrors}
}

// ---------------------------------------------------------------------------
// Unit 4: Artifact validation helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Unit 4: Octokit construction helpers
// ---------------------------------------------------------------------------

/**
 * No-op logger that satisfies the Octokit log interface without writing to stderr.
 *
 * The default Octokit logger writes request URLs and error details to stderr,
 * which leaks raw source refs (e.g., `GET /repos/owner/repo/pulls/579 - 404`)
 * from caught errors. This no-op logger suppresses all output while still
 * satisfying the interface contract.
 */
const NOOP_LOGGER = {
  debug: (_msg: string) => undefined,
  info: (_msg: string) => undefined,
  warn: (_msg: string) => undefined,
  error: (_msg: string) => undefined,
}

/**
 * Build Octokit constructor options for the detect step.
 *
 * Includes:
 * - `auth`: the GitHub token
 * - `request.timeout`: 10 second timeout
 * - `log`: no-op logger to suppress request URL leaks to stderr
 *
 * Exported for testability — callers can verify the log handlers are no-ops.
 */
export function buildDetectOctokitOptions(token: string): {
  auth: string
  request: {timeout: number}
  log: typeof NOOP_LOGGER
} {
  return {
    auth: token,
    request: {timeout: 10_000},
    log: NOOP_LOGGER,
  }
}

// ---------------------------------------------------------------------------
// Unit 4: CLI shell
// ---------------------------------------------------------------------------

/**
 * CLI entry point for the status-truth detect step.
 *
 * Environment variables:
 * - STATUS_TRUTH_REPORT_PATH: path to write the JSON report artifact (required)
 * - STATUS_TRUTH_DRY_RUN: set to 'true' for dry-run mode (optional)
 * - GITHUB_TOKEN: read-only token for current-repo API resolution (optional;
 *   without it, all API claims are classified as unavailable/unresolved)
 * - GITHUB_REPOSITORY: owner/repo for current-repo resolution (optional;
 *   defaults to 'fro-bot/.github')
 *
 * Behavior:
 * - Scans public docs paths (README.md, SECURITY.md, docs/**, knowledge/**,
 *   .github/**\/*.md) for status-truth claims using CLAIM_KIND_DEFINITIONS patterns.
 * - Resolves live state for current-repo PR/issues/releases/tags using the
 *   read-only GITHUB_TOKEN. Cross-repo references are classified as unavailable.
 * - Emits a structured report artifact plus counts-only summary to stdout.
 * - stdout/stderr carry counts only; no raw claim text, source paths, or fingerprints.
 * - If scanning/resolution fails unexpectedly, emits an execution-failure report.
 *   Never emits a fake clean report when scanning has not run.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */
async function runDetect(): Promise<void> {
  const reportPath = process.env.STATUS_TRUTH_REPORT_PATH

  if (reportPath === undefined || reportPath === '') {
    process.stderr.write('status-truth-detect: STATUS_TRUTH_REPORT_PATH is required\n')
    process.exit(1)
  }

  const generatedAt = new Date().toISOString()

  // Determine owner/repo from environment
  const githubRepository = process.env.GITHUB_REPOSITORY ?? 'fro-bot/.github'
  const slashIndex = githubRepository.indexOf('/')
  const owner = slashIndex === -1 ? githubRepository : githubRepository.slice(0, slashIndex)
  const repo = slashIndex === -1 ? '' : githubRepository.slice(slashIndex + 1)

  if (owner === '' || repo === '') {
    process.stderr.write('status-truth-detect: GITHUB_REPOSITORY must be in owner/repo format\n')
    process.exit(1)
  }

  // Build file lister using Node 24 native glob
  const fileLister: FileLister = async () => {
    const {glob: fsGlob} = await import('node:fs/promises')
    const paths: string[] = []
    for (const pattern of SCAN_GLOB_PATTERNS) {
      for await (const entry of fsGlob(pattern, {cwd: process.cwd()})) {
        paths.push(entry)
      }
    }
    return paths
  }

  // Build file reader
  const fileReader: FileReader = async (filePath: string) => readFile(filePath, 'utf8')

  let report: StatusTruthJsonReport

  try {
    // Step 1: Scan file-system docs for claims (plan-status excluded by default)
    const {claims: fileClaims, scanErrors: fileScanErrors} = await scanStatusTruthClaims({fileLister, fileReader})

    // Step 2: Resolve live state and scan GitHub issues (if token available)
    const token = process.env.GITHUB_TOKEN
    let resolverResults: Record<string, ResolverResult> = {}
    let resolveErrors = 0
    let issueScanErrors = 0
    let issueClaims: StatusTruthClaim[] = []

    if (token !== undefined && token !== '') {
      const {Octokit} = await import('@octokit/rest')
      const octokit = new Octokit(buildDetectOctokitOptions(token)) as unknown as DetectOctokitClient

      // Build injected issue lister/comment fetcher using paginated helpers
      // (avoids the per_page:100 truncation bug — fetches all pages)
      const issueLister: IssueLister = async ({owner: o, repo: r}) => listCurrentRepoIssues(octokit, o, r)

      const commentFetcher: IssueCommentFetcher = async ({owner: o, repo: r, issueNumber}) =>
        listCurrentRepoIssueComments(octokit, o, r, issueNumber)

      // Scan GitHub issue bodies and comments
      const issueResult = await scanIssueStatusTruthClaims({owner, repo, issueLister, commentFetcher})
      issueClaims = issueResult.claims
      issueScanErrors = issueResult.scanErrors

      // Resolve all claims (file + issue) against live state
      const allClaims = [...fileClaims, ...issueClaims]
      const resolved = await resolveAllClaims({claims: allClaims, octokit, owner, repo})
      resolverResults = resolved.resolverResults
      resolveErrors = resolved.resolveErrors
    }
    // If no token: all API claims remain unresolved (resolverResults stays empty)

    // Step 3: Classify all claims into findings
    const allClaims = [...fileClaims, ...issueClaims]
    const findings = detectStatusTruthClaims(allClaims, resolverResults)

    // Scan is complete if no per-file, issue-scan, or resolve errors occurred.
    // Failure class distinguishes the error source:
    // - file-parse-error: per-file read/parse errors during file-system scanning
    // - api-unavailable: issue list/comment fetch failures or resolver API errors
    const scanComplete = fileScanErrors === 0 && issueScanErrors === 0 && resolveErrors === 0

    const failureClass = selectDetectFailureClass({fileScanErrors, issueScanErrors, resolveErrors})

    report = buildStatusTruthReport({
      findings,
      scanComplete,
      generatedAt,
      failureClass,
    })
  } catch {
    // Unexpected failure — emit execution-failure report, not fake clean
    process.stderr.write('status-truth-detect: unexpected scan failure: error-class=execution-error\n')
    report = buildStatusTruthReport({
      findings: [],
      scanComplete: false,
      generatedAt,
      failureClass: 'execution-error',
    })
  }

  const reportJson = `${JSON.stringify(report, null, 2)}\n`

  try {
    await writeFile(reportPath, reportJson, {flag: 'w'})
  } catch {
    process.stderr.write('status-truth-detect: could not write report: error-class=write-failure\n')
    process.exit(1)
  }

  // Counts-only summary to stdout — no raw claim text, source paths, or fingerprints
  const summary = {
    status: report.status,
    scan_complete: report.scan_complete,
    counts: report.counts,
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runDetect()
}
