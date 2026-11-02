/**
 * Pure verdicts. Given extracted claims and the resolver results for them, decide for each claim whether it is current, drifted, unresolved or unsafe, and build the proposed correction text for a drifted one.
 *
 * Imports only `report-model`.
 */

import {
  CLAIM_KIND_DEFINITIONS,
  computeClaimFingerprint,
  type ClaimKind,
  type ClaimVerdict,
  type PublicStatusTruthFinding,
  type ResolverResult,
  type ResolverType,
  type StatusTruthClaim,
  type StatusTruthFinding,
  type UnsafeStatusTruthFinding,
} from './report-model.ts'

/**
 * Build a proposed correction string for a drifted claim.
 * Replaces the claimed state with the live state in the normalized text.
 *
 * All claim grammars place the state token at the end of normalizedText
 * (e.g. "plan docs/plans/active-plan.md is active", "release v1.0-draft is draft").
 * A first-match \b replacement would corrupt path/tag segments that happen to
 * contain the same word (e.g. "active" in "active-plan.md"). Instead, we anchor
 * the match to the trailing position — the last word-boundary occurrence of the
 * claimed state followed only by non-word characters until end-of-string.
 */
function buildProposedCorrection(claim: StatusTruthClaim, liveState: string): string {
  // Replace the claimed state token in the normalized text with the live state.
  // Use a replacement function (not a string) so that live-state values containing
  // special replacement tokens like `$&`, `$1`, `$$` are inserted literally.
  const escaped = claim.claimedState.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  // Anchor to the last occurrence: match the claimed state only when followed by
  // zero or more non-word characters until end-of-string. This prevents replacing
  // the state word when it appears earlier in the text (e.g. inside a path segment).
  const pattern = new RegExp(String.raw`\b${escaped}\b(?=\W*$)`, 'iu')
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
