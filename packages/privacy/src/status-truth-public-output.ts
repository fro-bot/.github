/**
 * Public-output privacy gate adapter for the status-truth maintenance loop.
 *
 * One exported function — `applyPublicOutputGate` — covers all surface kinds so
 * no public-render helper can bypass the shared gate.
 *
 * Design invariants:
 * - Wraps `capture-learnings-privacy.ts` helpers; does not fork privacy logic.
 * - Token-load failure blocks ALL output (fail-closed).
 * - Private-token or secret-like content blocks output; only counters are returned.
 * - Fingerprints are excluded from counts-only surfaces (workflow-summary-row,
 *   workflow-run-display-name, workflow-step-summary): providing a fingerprint
 *   parameter for those surfaces causes the gate to block.
 * - Phase 2 PR surfaces are reserved in the Phase 1 schema so they cannot bypass
 *   the gate when PR support is enabled later.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {learningBodyHasPrivateLeak, logDiffHasSecret} from './capture-learnings-privacy.ts'

// ---------------------------------------------------------------------------
// Surface kinds
// ---------------------------------------------------------------------------

/**
 * All public output surface kinds covered by the gate.
 *
 * Phase 1: proposal-title, proposal-body, proposal-comment, recurrence-comment,
 *   workflow-summary-row, workflow-step-summary, workflow-run-display-name.
 *
 * Phase 2 reserved: pr-title, pr-body, pr-commit-message, pr-branch-name, pr-label.
 *   Reserved in the Phase 1 schema so future PR metadata cannot bypass the gate.
 */
export type PublicOutputSurface =
  | 'proposal-title'
  | 'proposal-body'
  | 'proposal-comment'
  | 'recurrence-comment'
  | 'workflow-summary-row'
  | 'workflow-step-summary'
  | 'workflow-run-display-name'
  | 'pr-title'
  | 'pr-body'
  | 'pr-commit-message'
  | 'pr-branch-name'
  | 'pr-label'

/**
 * Surfaces that carry aggregate counters only — fingerprints must never appear.
 * Providing a fingerprint parameter for these surfaces causes the gate to block.
 */
export const COUNTS_ONLY_SURFACES: readonly PublicOutputSurface[] = [
  'workflow-summary-row',
  'workflow-step-summary',
  'workflow-run-display-name',
]

/** Returns true when `surface` is a counts-only surface (fingerprint parameter must be undefined). */
export function isCountsOnlySurface(surface: PublicOutputSurface): boolean {
  return COUNTS_ONLY_SURFACES.includes(surface)
}

/**
 * Phase 2 reserved surfaces. Gated in Phase 1 so future PR metadata cannot bypass the gate.
 */
export const PHASE2_RESERVED_SURFACES: readonly PublicOutputSurface[] = [
  'pr-title',
  'pr-body',
  'pr-commit-message',
  'pr-branch-name',
  'pr-label',
]

// ---------------------------------------------------------------------------
// Token loading model
// ---------------------------------------------------------------------------

/**
 * Loaded public-output token set.
 *
 * Both sets must be loaded before the gate can operate. An empty set is valid
 * (no private repos configured); a failed load must use the `loaded:false` variant.
 */
export interface PublicOutputTokensLoaded {
  readonly loaded: true
  readonly privateTokens: Set<string>
  readonly redactedCanonicalIds: Set<string>
}

/**
 * Failed public-output token load.
 *
 * The gate treats this as a hard block: no output is emitted when tokens
 * could not be loaded. Never use an empty set as a proxy for a failed load.
 */
export interface PublicOutputTokensFailed {
  readonly loaded: false
  readonly error: string
}

/** Discriminated union for the token loading result. */
export type PublicOutputTokens = PublicOutputTokensLoaded | PublicOutputTokensFailed

/** Type guard: narrows `PublicOutputTokens` to the loaded variant. */
export function isPublicOutputTokensLoaded(tokens: PublicOutputTokens): tokens is PublicOutputTokensLoaded {
  return tokens.loaded === true
}

/**
 * Construct a loaded `PublicOutputTokens` from pre-built token sets.
 * Both sets may be empty (no private repos / no redacted IDs configured).
 */
export function makePublicOutputTokens(params: {
  privateTokens: Set<string>
  redactedCanonicalIds: Set<string>
}): PublicOutputTokensLoaded {
  return {
    loaded: true,
    privateTokens: params.privateTokens,
    redactedCanonicalIds: params.redactedCanonicalIds,
  }
}

// ---------------------------------------------------------------------------
// Gate output types
// ---------------------------------------------------------------------------

/** Allowed output: content passed all gate checks. */
export interface SafePublicOutputAllowed {
  readonly allowed: true
  readonly sanitizedContent: string
}

/**
 * Blocked output: content failed at least one gate check.
 * Blocked text is intentionally absent — never returned.
 */
export interface SafePublicOutputBlocked {
  readonly allowed: false
  readonly blockedCount: 1
  readonly blockReason: string
}

/** Discriminated union for the gate result. */
export type SafePublicOutput = SafePublicOutputAllowed | SafePublicOutputBlocked

// ---------------------------------------------------------------------------
// Gate input
// ---------------------------------------------------------------------------

export interface PublicOutputGateInput {
  /** The surface kind being gated. */
  readonly surface: PublicOutputSurface
  /** The rendered content to gate. Must be the final rendered string, not raw claim data. */
  readonly content: string
  /** Token sets for privacy scanning. Must be loaded; failed load blocks immediately. */
  readonly tokens: PublicOutputTokens
  /**
   * The claim fingerprint, if applicable.
   * Must be `undefined` for counts-only surfaces (workflow-summary-row, etc.).
   * Providing a fingerprint for a counts-only surface causes the gate to block.
   */
  readonly fingerprint: string | undefined
}

// ---------------------------------------------------------------------------
// Gate implementation
// ---------------------------------------------------------------------------

/**
 * Apply the public-output privacy gate to a single rendered surface.
 *
 * Gate checks (in order):
 * 1. Token load failure → block immediately (fail-closed).
 * 2. Counts-only surface with fingerprint present → block.
 * 3. Secret-like content (GitHub PAT, AWS key, private key, etc.) → block.
 * 4. Private-token match (private repo name in any form) → block.
 * 5. Redacted canonical ID match → block.
 *
 * On block: returns `{ allowed: false, blockedCount: 1, blockReason }`.
 * On pass: returns `{ allowed: true, sanitizedContent: content }`.
 * Blocked text is never returned.
 */
export function applyPublicOutputGate(input: PublicOutputGateInput): SafePublicOutput {
  const {surface, content, tokens, fingerprint} = input

  // 1. Token load failure → fail closed immediately
  if (!tokens.loaded) {
    return {
      allowed: false,
      blockedCount: 1,
      blockReason: 'token load failure: privacy gate cannot operate without loaded token sets',
    }
  }

  // 2. Counts-only surface: fingerprint parameter must not be provided
  if (isCountsOnlySurface(surface) && fingerprint !== undefined) {
    return {
      allowed: false,
      blockedCount: 1,
      blockReason: `fingerprint excluded from counts-only surface: ${surface}`,
    }
  }

  // 3. Secret-like content → block
  if (logDiffHasSecret(content)) {
    return {
      allowed: false,
      blockedCount: 1,
      blockReason: 'secret-like content detected in rendered output',
    }
  }

  // 4. Private-token match → block
  if (learningBodyHasPrivateLeak(content, tokens.privateTokens)) {
    return {
      allowed: false,
      blockedCount: 1,
      blockReason: 'private identifier token detected in rendered output',
    }
  }

  // 5. Redacted canonical ID match → block (case-sensitive substring match)
  // node_id and database_id values are opaque identifiers with fixed casing;
  // case-folding would allow a different-case variant to bypass the gate.
  if (tokens.redactedCanonicalIds.size > 0) {
    for (const id of tokens.redactedCanonicalIds) {
      if (content.includes(id)) {
        return {
          allowed: false,
          blockedCount: 1,
          blockReason: 'redacted canonical identifier detected in rendered output',
        }
      }
    }
  }

  return {
    allowed: true,
    sanitizedContent: content,
  }
}
