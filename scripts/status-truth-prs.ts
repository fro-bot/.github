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
import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'
import process from 'node:process'
import {Octokit} from '@octokit/rest'
import {
  correctPlanConsistencyStatusLine,
  KNOWN_FINGERPRINT_VERSION,
  KNOWN_SCHEMA_VERSION,
  reverifyPlanConsistencyCorrection,
} from './status-truth-detect.ts'
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
export function isPathAuthorized(filePath: string): boolean {
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
export function deriveOpaqueDigest(fingerprint: string): string {
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
  /**
   * Target file path (not secret — already authorized by the allowed-path
   * gate). Needed by the shell to re-read live content, run the corrector,
   * and re-verify before any write (R6 TOCTOU guard).
   */
  readonly path: string
  /** Claim kind — selects the corrector/re-verifier the shell must run. */
  readonly kind: string
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
  readonly reason:
    'disabled' | 'not-graduated' | 'no-corrector' | 'path-forbidden' | 'privacy-gate-blocked' | 'overflow'
}

/**
 * Close an open correction PR.
 *
 * Two causes:
 * - `drift-cleared`: a complete, non-execution-failure scan no longer shows
 *   this fingerprint while its correction PR remains open.
 * - `terminal-label`: the linked proposal carries a terminal outcome label
 *   (rejected / false-positive); the PR closes regardless of drift state.
 *
 * The planner never merges, approves, force-pushes, or retargets — closing
 * the bot's own PR and (shell-side) deleting its own branch are the only
 * mutations this action authorizes.
 */
export interface ClosePrAction {
  readonly type: 'close-pr'
  readonly reason: 'drift-cleared' | 'terminal-label'
  readonly prNumber: number
  readonly branch: string
  /** Opaque digest used for branch-pattern validation at execution time. */
  readonly opaqueDigest: string
}

/**
 * Discriminated union of all PR planner action types.
 *
 * Forbidden action types (merge, approve, automerge, force-push, retarget)
 * are intentionally absent from this union.
 */
export type StatusTruthPrAction = OpenPrAction | RediscoverPrAction | DowngradeToProposalAction | ClosePrAction

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

/**
 * Per-kind corrector registry the planner consults for existence only.
 *
 * The planner never sees file content and never runs the corrector itself —
 * content-level correction and re-verification are shell-only (Unit 3). This
 * registry exists so the planner can gate on "does a corrector exist for this
 * kind" as a structural fact, distinct from "is this kind graduated".
 */
export const CORRECTOR_REGISTERED_KINDS: ReadonlySet<string> = new Set<string>(['plan-consistency'])

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
  /**
   * Fingerprints whose linked proposal issue carries a terminal outcome label
   * (`status-truth:rejected` or `status-truth:false-positive`).
   *
   * Shell-supplied: derived from live proposal issue labels. The planner
   * never does I/O to obtain this — it is a structural fact passed in.
   *
   * Terminal + open PR → close-pr(terminal-label) regardless of drift.
   * Terminal + no open PR → no action (suppression, not closure).
   */
  readonly terminalFingerprints: ReadonlySet<string>
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
 * 2. If disabled: downgrade all proposal-eligible findings to proposal-only; no closures.
 * 3. Closure pass over existing bot-owned open PRs targeting main with a recognized branch:
 *    a. Digest matches a terminal fingerprint → close-pr(terminal-label), regardless of drift.
 *    b. Otherwise, when the scan is complete and not an execution failure and the digest
 *       has no active finding in this report → close-pr(drift-cleared).
 * 4. For each proposal-eligible drifted finding:
 *    a. Skip entirely (no action) if the fingerprint is terminal (suppression).
 *    b. Skip if claim kind is not graduated → downgrade-to-proposal.
 *    c. Skip if no corrector is registered for the kind → downgrade-to-proposal.
 *    d. Run path authorization → downgrade-to-proposal if forbidden.
 *    e. Check for existing PR rediscovery (all criteria must match).
 *    f. Check overflow (maxPrsPerRun) → downgrade-to-proposal if exceeded. Only
 *       open-pr actions consume the budget; rediscovery is exempt.
 *    g. Run privacy gate on opaque PR metadata → downgrade-to-proposal if blocked.
 *    h. Plan open-pr action with opaque branch/title.
 */
export function planStatusTruthPrActions(input: PlanStatusTruthPrActionsInput): PlanStatusTruthPrActionsResult {
  const {report, graduatedClaimKinds, existingPrs, publicOutputTokens, maxPrsPerRun, enabled, terminalFingerprints} =
    input

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
  // Distinct from prActionsPlanned: newOpenBudget counts only open-pr actions.
  // Rediscovery, close, and downgrades are exempt (R9).
  let openPrsPlanned = 0
  let downgradedToProposalOnly = 0
  let pathForbidden = 0
  let privacyGateBlocked = 0
  let overflow = 0

  // 2. If disabled: downgrade all proposal-eligible findings; no closures either
  // (the PR pathway is fully disarmed — three-key arming governs every mutation).
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

  // 3. Closure pass: terminal-label and drift-cleared close actions.
  // Active digests come from every public finding in the report (any verdict) —
  // a fingerprint is "still present" if it appears at all, not only when drifted.
  const activeDigests = new Set<string>()
  for (const finding of report.findings) {
    if (!isPublicFinding(finding)) continue
    activeDigests.add(deriveOpaqueDigest(finding.fingerprint))
  }

  const terminalDigests = new Set<string>()
  for (const fp of terminalFingerprints) {
    terminalDigests.add(deriveOpaqueDigest(fp))
  }

  const canClose = report.scan_complete && report.failure_class === null

  for (const pr of existingPrs) {
    if (
      pr.state !== 'open' ||
      !pr.botOwned ||
      pr.baseBranch !== BASE_BRANCH ||
      !pr.headBranch.startsWith(PR_BRANCH_PREFIX)
    ) {
      continue
    }

    if (terminalDigests.has(pr.opaqueDigest)) {
      actions.push({
        type: 'close-pr',
        reason: 'terminal-label',
        prNumber: pr.number,
        branch: pr.headBranch,
        opaqueDigest: pr.opaqueDigest,
      })
      continue
    }

    if (canClose && !activeDigests.has(pr.opaqueDigest)) {
      actions.push({
        type: 'close-pr',
        reason: 'drift-cleared',
        prNumber: pr.number,
        branch: pr.headBranch,
        opaqueDigest: pr.opaqueDigest,
      })
    }
  }

  // 4. Process proposal-eligible findings
  for (const finding of report.findings) {
    // Skip unsafe findings
    if (!isPublicFinding(finding)) continue

    // Skip non-proposal-eligible findings
    if (!finding.proposalEligible) continue

    const {fingerprint, kind} = finding

    // a. Terminal suppression: a terminal-labeled fingerprint takes no further
    // action here. If an open PR existed for it, the closure pass above already
    // planned close-pr(terminal-label); if not, this is suppression, not closure.
    if (terminalFingerprints.has(fingerprint)) {
      continue
    }

    // b. Check claim kind graduation
    if (!graduatedClaimKinds.has(kind)) {
      actions.push({type: 'downgrade-to-proposal', reason: 'not-graduated'})
      downgradedToProposalOnly++
      continue
    }

    // c. Corrector seam: a graduated kind without a registered corrector
    // downgrades with a distinct reason. Content-level correction and
    // re-verification are shell-only; the planner only checks existence.
    if (!CORRECTOR_REGISTERED_KINDS.has(kind)) {
      actions.push({type: 'downgrade-to-proposal', reason: 'no-corrector'})
      downgradedToProposalOnly++
      continue
    }

    // e. Path authorization (runs before any diff rendering)
    if (!isPathAuthorized(finding.path)) {
      actions.push({type: 'downgrade-to-proposal', reason: 'path-forbidden'})
      downgradedToProposalOnly++
      pathForbidden++
      continue
    }

    // f. Check for existing PR rediscovery. Rediscovery is exempt from the
    // new-open budget: it never consumes newOpenBudget, only open-pr does.
    const existingPr = findMatchingExistingPr(fingerprint, existingPrs)
    if (existingPr !== null) {
      actions.push({
        type: 'rediscover-pr',
        existingPrNumber: existingPr.number,
        opaqueDigest: existingPr.opaqueDigest,
      })
      prActionsPlanned++
      continue
    }

    // g. Check overflow — newOpenBudget counts only open-pr actions.
    if (openPrsPlanned >= maxPrsPerRun) {
      actions.push({type: 'downgrade-to-proposal', reason: 'overflow'})
      downgradedToProposalOnly++
      overflow++
      continue
    }

    // h. Privacy gate on opaque PR metadata
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

    // i. Plan open-pr action with opaque branch/title
    const opaqueBranchName = buildOpaqueBranchName(fingerprint)
    const opaqueDigest = deriveOpaqueDigest(fingerprint)

    actions.push({
      type: 'open-pr',
      opaqueBranchName,
      opaqueTitle: titleGate.sanitizedContent,
      baseBranch: BASE_BRANCH,
      opaqueDigest,
      path: finding.path,
      kind: finding.kind,
    })
    prActionsPlanned++
    openPrsPlanned++
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

// ---------------------------------------------------------------------------
// Correction PR execution shell
// ---------------------------------------------------------------------------

/**
 * Per-kind pure corrector: current content in, corrected content out (or
 * null when no correction can be produced). Shell-side composition; the
 * planner never runs correctors.
 */
type CorrectorFn = (content: string) => string | null

/** Per-kind re-verifier: path + corrected content in, resolved verdict out. */
type ReVerifierFn = (path: string, correctedContent: string) => {verdict: 'current' | 'drifted' | 'unresolved'}

/**
 * Corrector registry mirroring `CORRECTOR_REGISTERED_KINDS` in the planner.
 * Only kinds present here can ever reach a write in the shell, independent
 * of what the planner decided — the shell never trusts planner output.
 */
const CORRECTORS: Readonly<Record<string, CorrectorFn>> = {
  'plan-consistency': correctPlanConsistencyStatusLine,
}

const RE_VERIFIERS: Readonly<Record<string, ReVerifierFn>> = {
  'plan-consistency': reverifyPlanConsistencyCorrection,
}

/** Base branch all correction PRs target. Exported for shell reuse. */
const CORRECTION_BASE_BRANCH = 'main'

/**
 * Validate that a branch name matches the bot-owned correction-branch
 * pattern for the given opaque digest. All three write primitives
 * (createRef, createOrUpdateFileContents via branch ref, deleteRef)
 * independently call this before touching the branch (R11c).
 */
function branchMatchesCorrectionPattern(branch: string, opaqueDigest: string): boolean {
  return branch === `${PR_BRANCH_PREFIX}${opaqueDigest}`
}

/**
 * Minimal Octokit-like client for the PR execution shell.
 * Injected for testability; production code uses @octokit/rest Octokit.
 * Function-property style (not method shorthand) per lint rules.
 */
export interface StatusTruthPrOctokitClient {
  readonly rest: {
    readonly repos: {
      readonly getContent: (params: {
        owner: string
        repo: string
        path: string
        ref?: string
      }) => Promise<{data: {content?: string; encoding?: string; sha: string}}>
      readonly createOrUpdateFileContents: (params: {
        owner: string
        repo: string
        path: string
        message: string
        content: string
        sha: string
        branch: string
      }) => Promise<{data: {commit: {sha: string}}}>
    }
    readonly git: {
      readonly getRef: (params: {owner: string; repo: string; ref: string}) => Promise<{
        data: {object: {sha: string}}
      }>
      readonly createRef: (params: {owner: string; repo: string; ref: string; sha: string}) => Promise<{
        data: {ref: string}
      }>
      readonly deleteRef: (params: {owner: string; repo: string; ref: string}) => Promise<unknown>
    }
    readonly pulls: {
      readonly create: (params: {
        owner: string
        repo: string
        title: string
        body: string
        head: string
        base: string
      }) => Promise<{data: {number: number}}>
      readonly update: (params: {
        owner: string
        repo: string
        pull_number: number
        state?: 'open' | 'closed'
      }) => Promise<{data: {number: number}}>
    }
    readonly issues: {
      readonly createComment: (params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<{data: {id: number}}>
    }
  }
}

/** Input to the PR execution shell. */
export interface ExecuteStatusTruthPrActionsInput {
  readonly octokit: StatusTruthPrOctokitClient
  readonly owner: string
  readonly repo: string
  readonly actions: readonly StatusTruthPrAction[]
  /** When true: read-only calls permitted, zero mutating calls, would-act counts. */
  readonly dryRun: boolean
  readonly publicOutputTokens: PublicOutputTokens
}

/** Counts-only result of the PR execution shell. */
export interface ExecuteStatusTruthPrActionsCounts {
  readonly opened: number
  readonly closed: number
  readonly downgraded: number
  readonly safetyRefused: number
  readonly failed: number
  readonly branchDeleteFailed: number
  /** Dry-run: would-open count (no mutation performed). */
  readonly wouldOpen: number
  /** Dry-run: would-close count (no mutation performed). */
  readonly wouldClose: number
}

/** Result of the PR execution shell. */
export interface ExecuteStatusTruthPrActionsResult {
  readonly dryRun: boolean
  readonly counts: ExecuteStatusTruthPrActionsCounts
}

function decodeGetContentResponse(data: {content?: string; encoding?: string}): string | null {
  if (data.content === undefined) return null
  if (data.encoding !== undefined && data.encoding !== 'base64') return null
  return Buffer.from(data.content, 'base64').toString('utf8')
}

function isApiStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && (error as {status: unknown}).status === status
  )
}

/**
 * Execute planned status-truth correction PR actions with independent
 * per-action safety validation. The shell never trusts planner output:
 * every safety property (live re-verification, single-file diff, branch
 * pattern) is re-checked here before any write.
 *
 * Validation order for open-pr, all before ANY write call (createRef
 * included):
 * 1. Branch name matches the correction pattern for the action's digest.
 * 2. Live base-branch content re-read via repos.getContent.
 * 3. Corrector + re-verification against that live content (R6 TOCTOU guard).
 * 4. Rendered surfaces (title/body) pass the public-output gate.
 * Any failure aborts the action with a safety-refusal or downgrade count
 * and no branch object exists.
 */
export async function executeStatusTruthPrActions(
  input: ExecuteStatusTruthPrActionsInput,
): Promise<ExecuteStatusTruthPrActionsResult> {
  const {octokit, owner, repo, actions, dryRun, publicOutputTokens} = input

  if (dryRun) {
    let wouldOpen = 0
    let wouldClose = 0
    for (const action of actions) {
      if (action.type === 'open-pr') wouldOpen++
      else if (action.type === 'close-pr') wouldClose++
    }
    return {
      dryRun: true,
      counts: {
        opened: 0,
        closed: 0,
        downgraded: 0,
        safetyRefused: 0,
        failed: 0,
        branchDeleteFailed: 0,
        wouldOpen,
        wouldClose,
      },
    }
  }

  let opened = 0
  let closed = 0
  let downgraded = 0
  let safetyRefused = 0
  let failed = 0
  let branchDeleteFailed = 0

  for (const action of actions) {
    if (action.type === 'open-pr') {
      try {
        // 1. Branch-pattern validation for the current fingerprint (R11c).
        if (!branchMatchesCorrectionPattern(action.opaqueBranchName, action.opaqueDigest)) {
          safetyRefused++
          continue
        }

        const corrector = CORRECTORS[action.kind]
        const reVerifier = RE_VERIFIERS[action.kind]
        if (corrector === undefined || reVerifier === undefined) {
          downgraded++
          continue
        }

        // 2. Live re-read of the target file from the base branch.
        const liveResponse = await octokit.rest.repos.getContent({owner, repo, path: action.path})
        const liveData = liveResponse.data
        const liveContent = decodeGetContentResponse(liveData)
        if (liveContent === null) {
          downgraded++
          continue
        }
        const baseSha = liveData.sha

        // 3. Corrector + re-verification against live content (R6 TOCTOU guard).
        const correctedContent = corrector(liveContent)
        if (correctedContent === null) {
          downgraded++
          continue
        }
        const verdict = reVerifier(action.path, correctedContent)
        if (verdict.verdict !== 'current') {
          downgraded++
          continue
        }

        // 4. Rendered surfaces pass the public-output gate.
        const titleGate = applyPublicOutputGate({
          surface: 'pr-title',
          content: action.opaqueTitle,
          tokens: publicOutputTokens,
          fingerprint: undefined,
        })
        if (!titleGate.allowed) {
          safetyRefused++
          continue
        }
        const bodyContent = `Automated correction. Digest: ${action.opaqueDigest}`
        const bodyGate = applyPublicOutputGate({
          surface: 'pr-body',
          content: bodyContent,
          tokens: publicOutputTokens,
          fingerprint: undefined,
        })
        if (!bodyGate.allowed) {
          safetyRefused++
          continue
        }

        // Resolve the base HEAD sha for branch creation.
        const baseRef = await octokit.rest.git.getRef({owner, repo, ref: `heads/${CORRECTION_BASE_BRANCH}`})
        const baseHeadSha = baseRef.data.object.sha

        let branchReady = false
        let reusedExistingTip = false
        try {
          await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${action.opaqueBranchName}`,
            sha: baseHeadSha,
          })
          branchReady = true
        } catch (createRefError: unknown) {
          if (!isApiStatus(createRefError, 422)) throw createRefError

          // Branch collision policy: fetch existing tip; reuse only if its
          // single-file diff equals the freshly computed correction.
          if (!branchMatchesCorrectionPattern(action.opaqueBranchName, action.opaqueDigest)) {
            safetyRefused++
            continue
          }
          const existingTipContentResponse = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: action.path,
            ref: action.opaqueBranchName,
          })
          const existingTipContent = decodeGetContentResponse(existingTipContentResponse.data)
          if (existingTipContent === null || existingTipContent !== correctedContent) {
            safetyRefused++
            continue
          }
          branchReady = true
          // The existing branch tip already matches the freshly computed
          // correction byte-for-byte — the commit step below would be
          // redundant, and worse, baseSha (the base-branch blob sha) does
          // not match the reused branch's blob, so committing with it would
          // 409. Skip straight to opening the PR.
          reusedExistingTip = true
        }

        if (!branchReady) {
          safetyRefused++
          continue
        }

        // 5. Commit the single-file correction on the correction branch,
        // unless we're reusing an existing branch whose tip already matches.
        if (!reusedExistingTip) {
          if (!branchMatchesCorrectionPattern(action.opaqueBranchName, action.opaqueDigest)) {
            safetyRefused++
            continue
          }
          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: action.path,
            message: `chore(status-truth): correction ${action.opaqueDigest}`,
            content: Buffer.from(correctedContent, 'utf8').toString('base64'),
            sha: baseSha,
            branch: action.opaqueBranchName,
          })
        }

        await octokit.rest.pulls.create({
          owner,
          repo,
          title: titleGate.sanitizedContent,
          body: bodyGate.sanitizedContent,
          head: action.opaqueBranchName,
          base: CORRECTION_BASE_BRANCH,
        })
        opened++
      } catch {
        failed++
      }
    } else if (action.type === 'close-pr') {
      try {
        if (!branchMatchesCorrectionPattern(action.branch, action.opaqueDigest)) {
          safetyRefused++
          continue
        }

        const comment =
          action.reason === 'terminal-label'
            ? 'Closing: linked proposal received a terminal outcome label.'
            : 'Drift cleared. Closing this correction PR.'
        const commentGate = applyPublicOutputGate({
          surface: 'proposal-comment',
          content: comment,
          tokens: publicOutputTokens,
          fingerprint: undefined,
        })
        if (!commentGate.allowed) {
          safetyRefused++
          continue
        }

        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: action.prNumber,
          body: commentGate.sanitizedContent,
        })
        await octokit.rest.pulls.update({owner, repo, pull_number: action.prNumber, state: 'closed'})
        closed++

        if (!branchMatchesCorrectionPattern(action.branch, action.opaqueDigest)) {
          // Unreachable given the guard above, but re-validated per R11c
          // (every write primitive independently validates the pattern).
          continue
        }
        try {
          await octokit.rest.git.deleteRef({owner, repo, ref: `heads/${action.branch}`})
        } catch {
          branchDeleteFailed++
        }
      } catch {
        failed++
      }
    }
  }

  return {
    dryRun: false,
    counts: {opened, closed, downgraded, safetyRefused, failed, branchDeleteFailed, wouldOpen: 0, wouldClose: 0},
  }
}

// ---------------------------------------------------------------------------
// CLI shell for the PR execution step
// ---------------------------------------------------------------------------

/** Arming environment variable names — all three keys must agree. */
const PRS_ENABLED_VAR = 'STATUS_TRUTH_PRS_ENABLED'
const PRS_DISPATCH_INPUT_VAR = 'STATUS_TRUTH_PRS_DISPATCH_INPUT'

/**
 * Determine whether the PR execution pathway is armed for this run.
 *
 * Three independent keys must all agree:
 * 1. `STATUS_TRUTH_PRS_ENABLED === 'true'` (repository variable).
 * 2. `graduatedClaimKinds.size > 0` (reviewed graduated set).
 * 3. `STATUS_TRUTH_PRS_DISPATCH_INPUT === 'true'` (manual dispatch input).
 *
 * Exported for testability. Scheduled runs never set the dispatch input,
 * so they are structurally excluded upstream at the workflow `if:` level;
 * this function re-checks at shell startup as defense in depth.
 */
export function isPrExecutionArmed(params: {
  prsEnabledVar: string | undefined
  dispatchInputVar: string | undefined
  graduatedClaimKinds: ReadonlySet<string>
}): boolean {
  return params.prsEnabledVar === 'true' && params.dispatchInputVar === 'true' && params.graduatedClaimKinds.size > 0
}

/** Counts-only result written to stdout and STATUS_TRUTH_PRS_RESULT_PATH. */
export interface PrsResult {
  readonly armed: boolean
  readonly dryRun: boolean
  readonly plannedCounts: PlanStatusTruthPrActionsCounts
  readonly executedCounts: ExecuteStatusTruthPrActionsCounts
}

type OctokitConstructor = new (params: {
  auth: string
  request: {timeout: number}
  log?: {debug: () => void; info: () => void; warn: () => void; error: () => void}
}) => StatusTruthPrOctokitClient

const NOOP_LOG = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  if (typeof Octokit !== 'function') {
    throw new TypeError('Failed to load @octokit/rest Octokit constructor')
  }
  return Octokit as unknown as OctokitConstructor
}

async function createOctokitFromEnv(): Promise<StatusTruthPrOctokitClient> {
  const token = process.env.GITHUB_TOKEN
  if (token === undefined || token === '') {
    throw new Error('status-truth-prs: GITHUB_TOKEN is required in the environment')
  }
  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token, request: {timeout: 10_000}, log: NOOP_LOG})
}

/**
 * CLI entry point for the status-truth PR execution step.
 *
 * Environment variables:
 * - STATUS_TRUTH_REPORT_PATH: path to the JSON report artifact from the detect step (required)
 * - STATUS_TRUTH_PRS_RESULT_PATH: path to write the counts-only result JSON (optional)
 * - STATUS_TRUTH_DRY_RUN: set to 'true' for dry-run mode (optional)
 * - STATUS_TRUTH_PRS_ENABLED: repository variable arming key (required to be 'true' to arm)
 * - STATUS_TRUTH_PRS_DISPATCH_INPUT: manual dispatch input arming key (required to be 'true' to arm)
 * - GITHUB_TOKEN: write-scoped app token for branch/PR mutations (required unless dry-run/disarmed)
 *
 * Behavior:
 * - Re-checks arming at startup; disarmed → counts-only exit (defense in depth).
 * - stdout/stderr carry counts only; no raw claim text, source paths, fingerprints, or tokens.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */
async function runPrs(): Promise<void> {
  const reportPath = process.env.STATUS_TRUTH_REPORT_PATH
  const resultPath = process.env.STATUS_TRUTH_PRS_RESULT_PATH
  const dryRun = process.env.STATUS_TRUTH_DRY_RUN === 'true'

  const armed = isPrExecutionArmed({
    prsEnabledVar: process.env[PRS_ENABLED_VAR],
    dispatchInputVar: process.env[PRS_DISPATCH_INPUT_VAR],
    graduatedClaimKinds: GRADUATED_CLAIM_KINDS,
  })

  const emptyPlannedCounts: PlanStatusTruthPrActionsCounts = {
    prActionsPlanned: 0,
    downgradedToProposalOnly: 0,
    pathForbidden: 0,
    privacyGateBlocked: 0,
    overflow: 0,
    versionRejected: 0,
  }
  const emptyExecutedCounts: ExecuteStatusTruthPrActionsCounts = {
    opened: 0,
    closed: 0,
    downgraded: 0,
    safetyRefused: 0,
    failed: 0,
    branchDeleteFailed: 0,
    wouldOpen: 0,
    wouldClose: 0,
  }

  if (!armed) {
    const result: PrsResult = {
      armed: false,
      dryRun,
      plannedCounts: emptyPlannedCounts,
      executedCounts: emptyExecutedCounts,
    }
    const resultJson = `${JSON.stringify(result)}\n`
    process.stdout.write(resultJson)
    if (resultPath !== undefined && resultPath !== '') {
      const {writeFile} = await import('node:fs/promises')
      try {
        await writeFile(resultPath, resultJson, {flag: 'w'})
      } catch {
        process.stderr.write('status-truth-prs: could not write result: error-class=write-failure\n')
      }
    }
    return
  }

  if (reportPath === undefined || reportPath === '') {
    process.stderr.write('status-truth-prs: STATUS_TRUTH_REPORT_PATH is required\n')
    process.exitCode = 1
    return
  }

  // Armed path is exercised only against a graduated, reviewed kind set;
  // this slice ships GRADUATED_CLAIM_KINDS empty (R2), so the full
  // report-read/plan/execute pipeline is deliberately out of scope for the
  // CLI entry point beyond wiring — Unit 4 completes workflow integration.
  // The write-scoped client is minted here (never in detect/open) so mint-time
  // scoping is exercised even while GRADUATED_CLAIM_KINDS stays empty.
  if (!dryRun) {
    await createOctokitFromEnv()
  }
  process.stdout.write(`${JSON.stringify({armed: true, dryRun})}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runPrs()
}
