/**
 * PR graduation gate planner for the status-truth maintenance loop.
 *
 * Pure PR planner: plans bounded correction PR actions for claim kinds that have
 * graduated (demonstrated accuracy signal via accepted/rejected proposal outcomes).
 *
 * Design invariants:
 * - Pure planner: no I/O, no Octokit dependency.
 * - Disabled by default: `enabled=false` → all candidates downgrade to proposal-only.
 * - One PR per run maximum (configurable via maxPrsPerRun; overflow → proposal-only).
 * - Path authorization runs before diff rendering; forbidden paths → proposal-only
 *   without extracting correction text or rendering PR metadata.
 * - Opaque branch names and titles: no source text, path, or fingerprint in names.
 *   Uses a short one-way digest (sha256 of a namespaced fingerprint) that cannot
 *   reconstruct the source or the fingerprint.
 * - Existing PR rediscovery requires: opaque digest match + bot ownership + main target.
 * - No action type can merge, approve, automerge, force-push, or retarget non-main.
 * - Non-eligible/ambiguous candidates downgrade to proposal-only; no throws.
 * - All public output passes through the public-output privacy gate.
 * - Unknown report schema/fingerprint versions are rejected before any planning.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {PublicStatusTruthFinding, StatusTruthFinding, StatusTruthJsonReport} from './status-truth-detect.ts'
import type {PublicOutputTokens} from './status-truth-public-output.ts'
import {createHash} from 'node:crypto'
import {KNOWN_FINGERPRINT_VERSION, KNOWN_SCHEMA_VERSION} from './status-truth-detect.ts'
import {applyPublicOutputGate} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Opaque prefix for all status-truth correction PR branch names.
 * Branch names must not contain source text, paths, or fingerprints.
 */
export const PR_BRANCH_PREFIX = 'status-truth/correction-'

/**
 * Opaque prefix for all status-truth correction PR titles.
 * Titles must not contain source text, paths, or fingerprints.
 */
export const PR_TITLE_PREFIX = 'chore(status-truth): correction '

/**
 * The base branch all correction PRs must target.
 * Retargeting to any other branch is forbidden.
 */
const BASE_BRANCH = 'main'

/**
 * Length of the opaque digest (hex chars) used in branch names and PR titles.
 * Short enough to be opaque; long enough to be collision-resistant for this use.
 */
const OPAQUE_DIGEST_LENGTH = 16

/**
 * Namespace prefix for the one-way digest input.
 * Prevents cross-context digest collisions.
 */
const OPAQUE_DIGEST_NAMESPACE = 'status-truth-pr'

/**
 * Claim kinds that have graduated to PR-eligible status.
 *
 * A claim kind graduates when it has demonstrated sufficient accuracy signal
 * (accepted/rejected outcomes from proposal issues). This set is intentionally
 * empty in Phase 1 — no claim kinds are graduated until Phase 1 produces signal.
 *
 * To graduate a claim kind: add it to this set in a reviewed repo change after
 * Phase 1 accuracy data supports it.
 */
export const GRADUATED_CLAIM_KINDS: ReadonlySet<string> = new Set<string>()

// ---------------------------------------------------------------------------
// Path authorization
// ---------------------------------------------------------------------------

/**
 * Authority-sensitive path prefixes that are always forbidden for correction PRs.
 *
 * These paths touch security-sensitive, configuration-sensitive, or authority-sensitive
 * surfaces that must never be autonomously modified by the status-truth loop.
 */
const FORBIDDEN_PATH_PREFIXES: readonly string[] = [
  '.github/workflows/',
  '.github/hooks/',
  '.github/settings',
  '.github/actions/',
  'metadata/',
  'knowledge/',
  'persona/',
  'assets/',
  'branding/',
  'node_modules/',
]

/**
 * Allowed path prefixes for correction PRs.
 * Only paths under these prefixes may be targeted by a correction PR.
 * All other paths are forbidden by default (allowlist, not denylist).
 */
const ALLOWED_PATH_PREFIXES: readonly string[] = ['docs/', 'README.md', 'SECURITY.md']

/**
 * Check whether a path contains traversal segments (e.g. `..`).
 * Traversal segments are always forbidden regardless of the resolved path.
 */
function hasPathTraversal(filePath: string): boolean {
  // Detect `..` segments in any position
  return /(?:^|[/\\])\.\.(?:[/\\]|$)/u.test(filePath)
}

/**
 * Authorize a file path for correction PR eligibility.
 *
 * Returns `true` when the path is allowed; `false` when forbidden.
 *
 * Authorization rules (in order):
 * 1. Path traversal segments → forbidden.
 * 2. Authority-sensitive prefix match → forbidden.
 * 3. Allowed prefix match → allowed.
 * 4. Default → forbidden (allowlist semantics).
 */
function isPathAuthorized(filePath: string): boolean {
  // 1. Traversal check
  if (hasPathTraversal(filePath)) return false

  // 2. Forbidden prefix check
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (filePath.startsWith(prefix)) return false
  }

  // 3. Allowed prefix check
  for (const prefix of ALLOWED_PATH_PREFIXES) {
    if (filePath === prefix || filePath.startsWith(prefix)) return true
  }

  // 4. Default: forbidden
  return false
}

// ---------------------------------------------------------------------------
// Opaque metadata generation
// ---------------------------------------------------------------------------

/**
 * Derive an opaque digest from a fingerprint.
 *
 * Computes sha256(`${OPAQUE_DIGEST_NAMESPACE}:${fingerprint}`) and takes the
 * first OPAQUE_DIGEST_LENGTH hex characters. This is a separate one-way hash,
 * so the digest cannot be used to reconstruct or prefix-match the fingerprint.
 *
 * Safety: branch names and PR titles contain only this derived digest, never
 * the fingerprint itself or any prefix of it.
 */
function deriveOpaqueDigest(fingerprint: string): string {
  return createHash('sha256')
    .update(`${OPAQUE_DIGEST_NAMESPACE}:${fingerprint}`)
    .digest('hex')
    .slice(0, OPAQUE_DIGEST_LENGTH)
}

/**
 * Build an opaque branch name for a correction PR.
 * Format: `{PR_BRANCH_PREFIX}{opaqueDigest}`
 * Must not contain source text, path, sourceRef, or fingerprint verbatim.
 */
function buildOpaqueBranchName(fingerprint: string): string {
  return `${PR_BRANCH_PREFIX}${deriveOpaqueDigest(fingerprint)}`
}

/**
 * Build an opaque PR title for a correction PR.
 * Format: `{PR_TITLE_PREFIX}{opaqueDigest}`
 * Must not contain source text, path, sourceRef, or claim text.
 */
function buildOpaqueTitle(fingerprint: string): string {
  return `${PR_TITLE_PREFIX}${deriveOpaqueDigest(fingerprint)}`
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

/**
 * Plan to open a new correction PR for a graduated finding.
 *
 * All metadata is opaque: branch name and title use a short digest,
 * never source text, path, or fingerprint verbatim.
 */
export interface OpenPrAction {
  readonly type: 'open-pr'
  /** Opaque branch name derived from fingerprint digest. */
  readonly opaqueBranchName: string
  /** Opaque PR title derived from fingerprint digest. */
  readonly opaqueTitle: string
  /** Base branch — always 'main'. */
  readonly baseBranch: 'main'
  /** Opaque digest used for rediscovery matching. */
  readonly opaqueDigest: string
}

/**
 * Rediscover an existing open correction PR instead of creating a duplicate.
 *
 * Only produced when all matching criteria are met:
 * - Opaque digest matches the finding's fingerprint digest.
 * - PR is bot-owned.
 * - PR targets main.
 */
export interface RediscoverPrAction {
  readonly type: 'rediscover-pr'
  /** The existing PR number to rediscover. */
  readonly existingPrNumber: number
  /** Opaque digest used for matching. */
  readonly opaqueDigest: string
}

/**
 * Downgrade a finding to proposal-only (no PR action).
 *
 * Used when:
 * - Planner is disabled.
 * - Claim kind is not graduated.
 * - Path is forbidden.
 * - Privacy gate blocks the PR metadata.
 * - Overflow (maxPrsPerRun exceeded).
 *
 * The action carries only a downgrade reason code — no source text, path,
 * fingerprint, or correction text.
 */
export interface DowngradeToProposalAction {
  readonly type: 'downgrade-to-proposal'
  /** Reason code for the downgrade (no source text or paths). */
  readonly reason: 'disabled' | 'not-graduated' | 'path-forbidden' | 'privacy-gate-blocked' | 'overflow'
}

/**
 * Discriminated union of all PR planner action types.
 *
 * Forbidden action types (merge, approve, automerge, force-push, retarget)
 * are intentionally absent from this union.
 */
export type StatusTruthPrAction = OpenPrAction | RediscoverPrAction | DowngradeToProposalAction

// ---------------------------------------------------------------------------
// Input/output types
// ---------------------------------------------------------------------------

/**
 * Simplified shape of an existing status-truth correction PR.
 * Caller fetches from GitHub and passes in; planner is pure.
 */
export interface ExistingStatusTruthPr {
  readonly number: number
  readonly state: 'open' | 'closed'
  /** Head branch name (must start with PR_BRANCH_PREFIX for rediscovery). */
  readonly headBranch: string
  /** Base branch name (must be 'main' for rediscovery). */
  readonly baseBranch: string
  /** Opaque digest extracted from the head branch name. */
  readonly opaqueDigest: string
  /** Whether the PR was created by the bot (required for rediscovery). */
  readonly botOwned: boolean
}

/** Input to the pure PR planner. */
export interface PlanStatusTruthPrActionsInput {
  /** The status-truth report from the detect step. */
  readonly report: StatusTruthJsonReport
  /**
   * Claim kinds that have graduated to PR-eligible status.
   * Empty set → all candidates downgrade to proposal-only.
   */
  readonly graduatedClaimKinds: ReadonlySet<string>
  /** Existing open status-truth correction PRs fetched from GitHub. */
  readonly existingPrs: readonly ExistingStatusTruthPr[]
  /** Loaded public-output token sets for privacy gating. */
  readonly publicOutputTokens: PublicOutputTokens
  /**
   * Maximum number of PR actions to plan per run.
   * Overflow candidates downgrade to proposal-only.
   * Default: 1.
   */
  readonly maxPrsPerRun: number
  /**
   * Whether the PR pathway is enabled.
   * When false: all candidates downgrade to proposal-only (no PR actions).
   * Default: false (disabled until graduation criteria are met).
   */
  readonly enabled: boolean
}

/** Aggregate counts returned by the PR planner. */
export interface PlanStatusTruthPrActionsCounts {
  /** Number of PR actions planned (open-pr + rediscover-pr). */
  readonly prActionsPlanned: number
  /** Number of findings downgraded to proposal-only. */
  readonly downgradedToProposalOnly: number
  /** Number of findings blocked by path authorization. */
  readonly pathForbidden: number
  /** Number of findings blocked by the privacy gate. */
  readonly privacyGateBlocked: number
  /** Number of findings that overflowed the maxPrsPerRun limit. */
  readonly overflow: number
  /** 1 when the report version was rejected; 0 otherwise. */
  readonly versionRejected: number
}

/** Result of the pure PR planner. */
export interface PlanStatusTruthPrActionsResult {
  readonly actions: readonly StatusTruthPrAction[]
  readonly counts: PlanStatusTruthPrActionsCounts
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isPublicFinding(finding: StatusTruthFinding): finding is PublicStatusTruthFinding {
  return finding.verdict !== 'unsafe'
}

// ---------------------------------------------------------------------------
// Existing PR rediscovery
// ---------------------------------------------------------------------------

/**
 * Attempt to rediscover an existing open correction PR for a finding.
 *
 * Rediscovery criteria (all must match):
 * 1. PR is open.
 * 2. PR is bot-owned.
 * 3. PR targets main.
 * 4. PR's opaque digest matches the finding's fingerprint digest.
 *
 * Returns the matching PR or null if no match.
 */
function findMatchingExistingPr(
  fingerprint: string,
  existingPrs: readonly ExistingStatusTruthPr[],
): ExistingStatusTruthPr | null {
  const digest = deriveOpaqueDigest(fingerprint)

  for (const pr of existingPrs) {
    if (
      pr.state === 'open' &&
      pr.botOwned &&
      pr.baseBranch === BASE_BRANCH &&
      pr.opaqueDigest === digest &&
      pr.headBranch.startsWith(PR_BRANCH_PREFIX)
    ) {
      return pr
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Pure PR planner
// ---------------------------------------------------------------------------

/**
 * Plan status-truth correction PR actions from a detect report.
 *
 * Pure function: no I/O, no Octokit dependency. Deterministic from inputs.
 *
 * Processing order:
 * 1. Reject unknown report versions immediately.
 * 2. If disabled: downgrade all proposal-eligible findings to proposal-only.
 * 3. For each proposal-eligible drifted finding:
 *    a. Skip if claim kind is not graduated → downgrade-to-proposal.
 *    b. Run path authorization → downgrade-to-proposal if forbidden.
 *    c. Check for existing PR rediscovery (all criteria must match).
 *    d. Check overflow (maxPrsPerRun) → downgrade-to-proposal if exceeded.
 *    e. Run privacy gate on opaque PR metadata → downgrade-to-proposal if blocked.
 *    f. Plan open-pr action with opaque branch/title.
 */
export function planStatusTruthPrActions(input: PlanStatusTruthPrActionsInput): PlanStatusTruthPrActionsResult {
  const {report, graduatedClaimKinds, existingPrs, publicOutputTokens, maxPrsPerRun, enabled} = input

  // 1. Reject unknown report versions
  if (report.schema_version !== KNOWN_SCHEMA_VERSION || report.fingerprint_version !== KNOWN_FINGERPRINT_VERSION) {
    return {
      actions: [],
      counts: {
        prActionsPlanned: 0,
        downgradedToProposalOnly: 0,
        pathForbidden: 0,
        privacyGateBlocked: 0,
        overflow: 0,
        versionRejected: 1,
      },
    }
  }

  const actions: StatusTruthPrAction[] = []
  let prActionsPlanned = 0
  let downgradedToProposalOnly = 0
  let pathForbidden = 0
  let privacyGateBlocked = 0
  let overflow = 0

  // 2. If disabled: downgrade all proposal-eligible findings
  if (!enabled) {
    for (const finding of report.findings) {
      if (!isPublicFinding(finding)) continue
      if (!finding.proposalEligible) continue

      actions.push({type: 'downgrade-to-proposal', reason: 'disabled'})
      downgradedToProposalOnly++
    }

    return {
      actions,
      counts: {
        prActionsPlanned,
        downgradedToProposalOnly,
        pathForbidden,
        privacyGateBlocked,
        overflow,
        versionRejected: 0,
      },
    }
  }

  // 3. Process proposal-eligible findings
  for (const finding of report.findings) {
    // Skip unsafe findings
    if (!isPublicFinding(finding)) continue

    // Skip non-proposal-eligible findings
    if (!finding.proposalEligible) continue

    const {fingerprint, kind} = finding

    // a. Check claim kind graduation
    if (!graduatedClaimKinds.has(kind)) {
      actions.push({type: 'downgrade-to-proposal', reason: 'not-graduated'})
      downgradedToProposalOnly++
      continue
    }

    // b. Path authorization (runs before any diff rendering)
    if (!isPathAuthorized(finding.path)) {
      actions.push({type: 'downgrade-to-proposal', reason: 'path-forbidden'})
      downgradedToProposalOnly++
      pathForbidden++
      continue
    }

    // c. Check for existing PR rediscovery
    const existingPr = findMatchingExistingPr(fingerprint, existingPrs)
    if (existingPr !== null) {
      // Rediscovery counts as a PR action (uses the slot)
      if (prActionsPlanned >= maxPrsPerRun) {
        actions.push({type: 'downgrade-to-proposal', reason: 'overflow'})
        downgradedToProposalOnly++
        overflow++
        continue
      }

      actions.push({
        type: 'rediscover-pr',
        existingPrNumber: existingPr.number,
        opaqueDigest: existingPr.opaqueDigest,
      })
      prActionsPlanned++
      continue
    }

    // d. Check overflow
    if (prActionsPlanned >= maxPrsPerRun) {
      actions.push({type: 'downgrade-to-proposal', reason: 'overflow'})
      downgradedToProposalOnly++
      overflow++
      continue
    }

    // e. Privacy gate on opaque PR metadata
    // Gate the opaque title (does not contain source text, but must pass the gate)
    const opaqueTitle = buildOpaqueTitle(fingerprint)
    const titleGate = applyPublicOutputGate({
      surface: 'pr-title',
      content: opaqueTitle,
      tokens: publicOutputTokens,
      fingerprint,
    })
    if (!titleGate.allowed) {
      actions.push({type: 'downgrade-to-proposal', reason: 'privacy-gate-blocked'})
      downgradedToProposalOnly++
      privacyGateBlocked++
      continue
    }

    // Also gate the proposed correction content if present (for body/diff safety)
    if (finding.proposedCorrection !== undefined) {
      const correctionGate = applyPublicOutputGate({
        surface: 'pr-body',
        content: finding.proposedCorrection,
        tokens: publicOutputTokens,
        fingerprint,
      })
      if (!correctionGate.allowed) {
        actions.push({type: 'downgrade-to-proposal', reason: 'privacy-gate-blocked'})
        downgradedToProposalOnly++
        privacyGateBlocked++
        continue
      }
    }

    // f. Plan open-pr action with opaque branch/title
    const opaqueBranchName = buildOpaqueBranchName(fingerprint)
    const opaqueDigest = deriveOpaqueDigest(fingerprint)

    actions.push({
      type: 'open-pr',
      opaqueBranchName,
      opaqueTitle: titleGate.sanitizedContent,
      baseBranch: BASE_BRANCH,
      opaqueDigest,
    })
    prActionsPlanned++
  }

  return {
    actions,
    counts: {
      prActionsPlanned,
      downgradedToProposalOnly,
      pathForbidden,
      privacyGateBlocked,
      overflow,
      versionRejected: 0,
    },
  }
}
