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
 * (accepted/rejected outcomes from proposal issues).
 *
 * `plan-consistency` graduated first: explicit `status-truth:accepted` on
 * #3656, with #3614-#3616 as supporting resolved-positive outcomes.
 *
 * To graduate another claim kind: add it to this set in a reviewed repo
 * change after equivalent accepted evidence exists.
 */
export const GRADUATED_CLAIM_KINDS: ReadonlySet<string> = new Set<string>(['plan-consistency'])

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
  /**
   * Source fingerprint, threaded through so execution-shell gate calls carry
   * the same `fingerprint` context the planner used (public-output gate
   * symmetry). Never rendered verbatim into any public surface.
   */
  readonly fingerprint: string
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
      fingerprint,
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

/** Shape of a single pull request returned by `pulls.list`. */
export interface PrListItem {
  readonly number: number
  readonly state: string
  readonly head: {readonly ref: string}
  readonly base: {readonly ref: string}
  readonly user: {readonly login?: string | null} | null
}

/**
 * List-capable Octokit client used to fetch existing open correction PRs and
 * terminal-labeled proposal issues before planning. Separate from
 * {@link StatusTruthPrOctokitClient} (the write shell) so each seam only
 * declares the surfaces it actually calls; production Octokit instances
 * satisfy both structurally.
 */
export interface StatusTruthPrFetchClient {
  readonly rest: {
    readonly pulls: {
      readonly list: (params: {
        owner: string
        repo: string
        state: 'open' | 'closed' | 'all'
        base?: string
        per_page: number
        page: number
      }) => Promise<{data: readonly PrListItem[]}>
    }
    readonly issues: {
      readonly listForRepo: (params: {
        owner: string
        repo: string
        labels: string
        state: 'open' | 'closed' | 'all'
        per_page: number
        page: number
      }) => Promise<{
        data: readonly {
          readonly number: number
          readonly labels: readonly (string | {readonly name?: string | null})[]
          readonly body?: string | null
          readonly user?: {readonly login?: string | null} | null
        }[]
      }>
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
  /**
   * Privacy-safe diagnostic sink for action-level failures. Defaults to a
   * no-op when omitted (e.g. in existing tests that don't assert on it).
   * Never receives raw error message text or bodies — only action type,
   * a closed-vocabulary error-class, and a numeric API status when present.
   */
  readonly writeStderr?: (text: string) => void
}

/** Counts-only result of the PR execution shell. */
export interface ExecuteStatusTruthPrActionsCounts {
  readonly opened: number
  readonly closed: number
  readonly downgraded: number
  readonly safetyRefused: number
  readonly failed: number
  readonly branchDeleteFailed: number
  /** Live mode: rediscover-pr actions observed (no mutation — count only, replaces silent drop). */
  readonly rediscovered: number
  /** Dry-run: would-open count (no mutation performed). */
  readonly wouldOpen: number
  /** Dry-run: would-close count (no mutation performed). */
  readonly wouldClose: number
  /** Dry-run: would-rediscover count (no mutation performed). */
  readonly wouldRediscover: number
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

/** Extract a numeric API status code from an error, if present. Never extracts message text. */
function extractApiStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  const status = (error as {status: unknown}).status
  return typeof status === 'number' ? status : undefined
}

/**
 * Emit a privacy-safe diagnostic line for an action-level execution failure:
 * action type + closed-vocabulary error-class + numeric API status (when
 * available). Never includes error message text, response bodies, or any
 * other raw error content.
 */
function emitActionFailureDiagnostic(params: {
  writeStderr: (text: string) => void
  actionType: 'open-pr' | 'close-pr'
  error: unknown
}): void {
  const status = extractApiStatus(params.error)
  const statusSuffix = status === undefined ? '' : ` status=${status}`
  params.writeStderr(
    `status-truth-prs: action failed: action=${params.actionType} error-class=action-failure${statusSuffix}\n`,
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
  const {octokit, owner, repo, actions, dryRun, publicOutputTokens, writeStderr = () => undefined} = input

  if (dryRun) {
    let wouldOpen = 0
    let wouldClose = 0
    let wouldRediscover = 0
    for (const action of actions) {
      if (action.type === 'open-pr') wouldOpen++
      else if (action.type === 'close-pr') wouldClose++
      else if (action.type === 'rediscover-pr') wouldRediscover++
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
        rediscovered: 0,
        wouldOpen,
        wouldClose,
        wouldRediscover,
      },
    }
  }

  let opened = 0
  let closed = 0
  let downgraded = 0
  let safetyRefused = 0
  let failed = 0
  let branchDeleteFailed = 0
  let rediscovered = 0

  for (const action of actions) {
    if (action.type === 'rediscover-pr') {
      // Rediscovery performs no mutation — the existing PR already represents
      // the correction. Live mode surfaces this as an explicit count instead
      // of silently dropping the action.
      rediscovered++
    } else if (action.type === 'open-pr') {
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

        // 2. Live re-read of the target file from the base branch. A 404 means
        // the file no longer exists on the live base branch — this is a
        // legitimate downgrade (the claim is stale), not an execution failure.
        let liveData: {content?: string; encoding?: string; sha: string}
        try {
          const liveResponse = await octokit.rest.repos.getContent({owner, repo, path: action.path})
          liveData = liveResponse.data
        } catch (getContentError: unknown) {
          if (isApiStatus(getContentError, 404)) {
            downgraded++
            continue
          }
          throw getContentError
        }
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
          fingerprint: action.fingerprint,
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
          fingerprint: action.fingerprint,
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
          let existingTipContent: string | null
          try {
            const existingTipContentResponse = await octokit.rest.repos.getContent({
              owner,
              repo,
              path: action.path,
              ref: action.opaqueBranchName,
            })
            existingTipContent = decodeGetContentResponse(existingTipContentResponse.data)
          } catch (existingTipError: unknown) {
            if (isApiStatus(existingTipError, 404)) {
              // The colliding branch exists but no longer carries this file —
              // ambiguous state, not a real API failure. Refuse safely rather
              // than guessing or force-overwriting.
              safetyRefused++
              continue
            }
            throw existingTipError
          }
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
      } catch (error: unknown) {
        failed++
        emitActionFailureDiagnostic({writeStderr, actionType: 'open-pr', error})
      }
    } else if (action.type === 'close-pr') {
      try {
        if (!branchMatchesCorrectionPattern(action.branch, action.opaqueDigest)) {
          safetyRefused++
          continue
        }

        // Closure happens first: if the best-effort comment below fails or
        // is gated, the PR must still be closed rather than left open
        // waiting on a non-essential courtesy comment.
        await octokit.rest.pulls.update({owner, repo, pull_number: action.prNumber, state: 'closed'})
        closed++

        // Best-effort, non-fatal courtesy comment. Gate failure or API
        // failure here must never undo the closure or count as a failed
        // action — the PR is already closed.
        try {
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
          if (commentGate.allowed) {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: action.prNumber,
              body: commentGate.sanitizedContent,
            })
          }
        } catch {
          // Non-fatal: the PR is already closed.
        }

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
      } catch (error: unknown) {
        failed++
        emitActionFailureDiagnostic({writeStderr, actionType: 'close-pr', error})
      }
    }
  }

  return {
    dryRun: false,
    counts: {
      opened,
      closed,
      downgraded,
      safetyRefused,
      failed,
      branchDeleteFailed,
      rediscovered,
      wouldOpen: 0,
      wouldClose: 0,
      wouldRediscover: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Same-run state fetch: existing correction PRs + terminal fingerprints
// ---------------------------------------------------------------------------

/** Bot login identifiers recognized as owning correction PRs/comments. */
const BOT_LOGINS: ReadonlySet<string> = new Set(['fro-bot', 'fro-bot[bot]'])

/** Strict marker pattern for extracting a terminal fingerprint from an issue body. Lowercase hex only. */
const TERMINAL_FINGERPRINT_MARKER_PATTERN = /<!-- status-truth:fingerprint=([a-f0-9]+) -->/u

/** Terminal outcome labels whose presence contributes a fingerprint to the suppression set. */
const TERMINAL_OUTCOME_LABELS: ReadonlySet<string> = new Set(['status-truth:rejected', 'status-truth:false-positive'])

/**
 * Strictly extract a terminal fingerprint from an issue body's hidden marker.
 *
 * Returns null for missing body, missing marker, or a marker whose captured
 * value is empty or contains non-hex characters (the regex itself only
 * captures `[a-f0-9]+`, so any match is already lowercase hex; malformed
 * uppercase/mixed markers simply fail to match and return null).
 *
 * Exported for testability. Fail-closed: any ambiguity returns null rather
 * than guessing or fuzzy-matching a nearby value.
 */
export function extractTerminalFingerprint(body: string | null | undefined): string | null {
  if (body === null || body === undefined || body === '') return null
  const match = TERMINAL_FINGERPRINT_MARKER_PATTERN.exec(body)
  if (match === null) return null
  const value = match[1]
  if (value === undefined || value === '') return null
  return value
}

/** Result of fetching terminal fingerprints: the valid set plus a skipped/invalid count. */
export interface FetchTerminalFingerprintsResult {
  readonly fingerprints: ReadonlySet<string>
  /** Malformed, missing, non-hex, or duplicate terminal fingerprints — excluded and counted. */
  readonly skippedInvalid: number
  /** Count of distinct fingerprints observed on more than one terminal issue (never the raw values). */
  readonly duplicateCount: number
}

/** Maximum pages fetched by pagination loops (10 pages @ 100/page = 1000 items). Fail closed if exceeded. */
const MAX_FETCH_PAGES = 10

/** Thrown when a pagination loop hits {@link MAX_FETCH_PAGES} without exhausting results. */
class PaginationCapExceededError extends Error {
  constructor() {
    super('pagination cap exceeded')
    this.name = 'PaginationCapExceededError'
  }
}

/**
 * Fetch terminal fingerprints from status-truth proposal issues carrying a
 * terminal outcome label (`status-truth:rejected` or `status-truth:false-positive`).
 *
 * Fail-closed per issue: a fingerprint that is malformed, missing, non-hex, or a
 * duplicate of another terminal fingerprint is excluded from the returned set and
 * counted as skipped/invalid. A duplicate is excluded from BOTH occurrences —
 * ambiguity between two terminal issues claiming the same fingerprint must never
 * be resolved by picking one arbitrarily, and must never suppress by fuzzy
 * matching a prefix or substring.
 *
 * Accepted/resolved and other non-terminal labels never contribute to this set;
 * only issues carrying a recognized terminal label are considered at all.
 *
 * Exported for testability.
 */
export async function fetchTerminalFingerprints(params: {
  client: StatusTruthPrFetchClient
  owner: string
  repo: string
}): Promise<FetchTerminalFingerprintsResult> {
  const {client, owner, repo} = params
  const perPage = 100
  const seenOnce = new Set<string>()
  const duplicates = new Set<string>()
  let skippedInvalid = 0

  let page = 1
  for (;;) {
    if (page > MAX_FETCH_PAGES) throw new PaginationCapExceededError()
    const response = await client.rest.issues.listForRepo({
      owner,
      repo,
      labels: 'status-truth',
      state: 'all',
      per_page: perPage,
      page,
    })
    for (const issue of response.data) {
      // Narrow suppression to bot-authored proposal issues only. A
      // human-authored issue carrying copied labels/markers must never be
      // accepted as a terminal-outcome source — that would let anyone
      // suppress a claim by opening a look-alike issue.
      if (!BOT_LOGINS.has(issue.user?.login ?? '')) continue

      const labelNames = issue.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
      const hasTerminalLabel = labelNames.some(l => TERMINAL_OUTCOME_LABELS.has(l))
      if (!hasTerminalLabel) continue

      const fingerprint = extractTerminalFingerprint(issue.body)
      if (fingerprint === null) {
        skippedInvalid++
        continue
      }

      if (seenOnce.has(fingerprint)) {
        duplicates.add(fingerprint)
      } else {
        seenOnce.add(fingerprint)
      }
    }
    if (response.data.length < perPage) break
    page++
  }

  const fingerprints = new Set<string>()
  for (const fp of seenOnce) {
    if (duplicates.has(fp)) {
      skippedInvalid++
      continue
    }
    fingerprints.add(fp)
  }

  return {fingerprints, skippedInvalid, duplicateCount: duplicates.size}
}

/**
 * Fetch existing open correction PRs (any head branch/base/owner) so the planner
 * can independently gate rediscovery on bot ownership, base branch, and the
 * opaque branch-name prefix. This fetch is intentionally unfiltered by those
 * criteria — the shell trusts the planner's own re-checks, mirroring the R11c
 * "every write primitive re-validates" posture applied one layer up.
 *
 * Exported for testability.
 */
export async function fetchExistingCorrectionPrs(params: {
  client: StatusTruthPrFetchClient
  owner: string
  repo: string
}): Promise<ExistingStatusTruthPr[]> {
  const {client, owner, repo} = params
  const perPage = 100
  const prs: ExistingStatusTruthPr[] = []

  let page = 1
  for (;;) {
    if (page > MAX_FETCH_PAGES) throw new PaginationCapExceededError()
    const response = await client.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      base: BASE_BRANCH,
      per_page: perPage,
      page,
    })
    for (const pr of response.data) {
      const headBranch = pr.head.ref
      const opaqueDigest = headBranch.startsWith(PR_BRANCH_PREFIX) ? headBranch.slice(PR_BRANCH_PREFIX.length) : ''
      prs.push({
        number: pr.number,
        state: pr.state === 'closed' ? 'closed' : 'open',
        headBranch,
        baseBranch: pr.base.ref,
        opaqueDigest,
        botOwned: BOT_LOGINS.has(pr.user?.login ?? ''),
      })
    }
    if (response.data.length < perPage) break
    page++
  }

  return prs
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

/** Closed vocabulary of early-failure reasons surfaced on {@link PrsResult}. Never raw error text. */
export type PrsResultError =
  'missing-report' | 'report-failure' | 'token-load-failure' | 'fetch-failure' | 'write-client-failure' | 'unexpected'

/** Counts-only result written to stdout and STATUS_TRUTH_PRS_RESULT_PATH. */
export interface PrsResult {
  readonly armed: boolean
  readonly dryRun: boolean
  readonly plannedCounts: PlanStatusTruthPrActionsCounts
  readonly executedCounts: ExecuteStatusTruthPrActionsCounts
  /** Closed-vocabulary failure reason, present only on a non-success early-exit path. */
  readonly error?: PrsResultError
  /** Malformed/invalid/duplicate terminal fingerprints skipped this run (counts-only). */
  readonly terminalFingerprintsSkipped?: number
  /** Distinct terminal fingerprints observed on more than one terminal issue this run (counts-only). */
  readonly terminalFingerprintDuplicates?: number
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

/**
 * Build an Octokit client authenticated with the given token.
 *
 * Fetch calls use `STATUS_TRUTH_FETCH_TOKEN` (a dedicated read-only app token
 * minted for fetch/list calls). Write calls use `GITHUB_TOKEN` directly (the
 * scoped write token). These channels intentionally do not fall back to each
 * other.
 */
async function createOctokitFromToken(token: string | undefined): Promise<StatusTruthPrOctokitClient> {
  if (token === undefined || token === '') {
    throw new Error('status-truth-prs: required token is missing from the environment')
  }
  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token, request: {timeout: 10_000}, log: NOOP_LOG})
}

async function createOctokitFromEnv(): Promise<StatusTruthPrOctokitClient> {
  return createOctokitFromToken(process.env.GITHUB_TOKEN)
}

/** Report-read result: mirrors the `validateStatusTruthArtifact` discriminated union. */
export type ReadReportResult = {valid: true; report: StatusTruthJsonReport} | {valid: false; reason: string}

/**
 * Explicit dependency seam for {@link runPrsCore}.
 *
 * Every I/O boundary — environment flags, report loading, Octokit/client
 * creation, public-output token loading, existing-PR fetch, terminal-
 * fingerprint fetch, stdout/result writing, and process-exit signaling — is
 * injected here so `runPrsCore` is fully testable without touching the real
 * filesystem, network, or process globals. `runPrs()` is a thin wrapper that
 * supplies the real environment-backed implementations.
 */
export interface RunPrsCoreDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly graduatedClaimKinds: ReadonlySet<string>
  readonly readReport: () => Promise<ReadReportResult>
  readonly loadPublicOutputTokens: () => Promise<PublicOutputTokens>
  readonly createFetchClient: () => Promise<StatusTruthPrFetchClient>
  readonly createWriteClient: () => Promise<StatusTruthPrOctokitClient>
  readonly writeStdout: (text: string) => void
  readonly writeStderr: (text: string) => void
  readonly writeResultFile: (json: string) => Promise<void>
  readonly setExitCode: (code: number) => void
}

const EMPTY_PLANNED_COUNTS: PlanStatusTruthPrActionsCounts = {
  prActionsPlanned: 0,
  downgradedToProposalOnly: 0,
  pathForbidden: 0,
  privacyGateBlocked: 0,
  overflow: 0,
  versionRejected: 0,
}

const EMPTY_EXECUTED_COUNTS: ExecuteStatusTruthPrActionsCounts = {
  opened: 0,
  closed: 0,
  downgraded: 0,
  safetyRefused: 0,
  failed: 0,
  branchDeleteFailed: 0,
  rediscovered: 0,
  wouldOpen: 0,
  wouldClose: 0,
  wouldRediscover: 0,
}

/**
 * Stub write client used only for dry-run. Dry-run performs zero mutating
 * calls (executeStatusTruthPrActions returns before touching `octokit` in
 * its dry-run branch), so this stub's methods must never actually be
 * invoked; each throws defensively if that invariant is ever violated.
 */
const NOOP_WRITE_CLIENT: StatusTruthPrOctokitClient = {
  rest: {
    repos: {
      getContent: () => {
        throw new Error('dry-run write client must not be called')
      },
      createOrUpdateFileContents: () => {
        throw new Error('dry-run write client must not be called')
      },
    },
    git: {
      getRef: () => {
        throw new Error('dry-run write client must not be called')
      },
      createRef: () => {
        throw new Error('dry-run write client must not be called')
      },
      deleteRef: () => {
        throw new Error('dry-run write client must not be called')
      },
    },
    pulls: {
      create: () => {
        throw new Error('dry-run write client must not be called')
      },
      update: () => {
        throw new Error('dry-run write client must not be called')
      },
    },
    issues: {
      createComment: () => {
        throw new Error('dry-run write client must not be called')
      },
    },
  },
}

/**
 * Split a `owner/repo` GITHUB_REPOSITORY value into its parts.
 * Falls back to the fro-bot/.github default when absent or malformed.
 */
function splitGithubRepository(githubRepository: string | undefined): {owner: string; repo: string} {
  const value = githubRepository ?? 'fro-bot/.github'
  const slashIndex = value.indexOf('/')
  if (slashIndex === -1) return {owner: value, repo: '.github'}
  return {owner: value.slice(0, slashIndex), repo: value.slice(slashIndex + 1)}
}

async function writeResultAndStdout(params: {
  result: PrsResult
  resultPath: string | undefined
  deps: Pick<RunPrsCoreDeps, 'writeStdout' | 'writeResultFile' | 'writeStderr'>
}): Promise<void> {
  const {result, resultPath, deps} = params
  const resultJson = `${JSON.stringify(result)}\n`
  deps.writeStdout(resultJson)
  if (resultPath !== undefined && resultPath !== '') {
    try {
      await deps.writeResultFile(resultJson)
    } catch {
      deps.writeStderr('status-truth-prs: could not write result: error-class=write-failure\n')
    }
  }
}

/**
 * Testable core of the PR execution CLI step.
 *
 * Same-run pipeline (armed path only — disarmed exits immediately below):
 * 1. Re-check three-key arming; disarmed → counts-only exit, no report required.
 * 2. Read and validate `STATUS_TRUTH_REPORT_PATH`'s artifact; malformed/missing → exit 1.
 * 3. Load public-output tokens (fail-closed on load failure) → exit 1 on failure.
 * 4. Fetch existing bot-owned open correction PRs and terminal proposal
 *    fingerprints; a live-mode fetch failure exits 1 before any planning
 *    or writes (dry-run degrades to empty state on fetch failure, matching
 *    the existing proposals CLI's dry-run posture).
 * 5. Plan (`planStatusTruthPrActions`) and execute (`executeStatusTruthPrActions`).
 * 6. Write counts-only stdout/result JSON; never source paths, fingerprints,
 *    branch names, PR/proposal numbers, titles, bodies, or tokens.
 */
export async function runPrsCore(deps: RunPrsCoreDeps): Promise<PrsResult> {
  const reportPath = deps.env.STATUS_TRUTH_REPORT_PATH
  const resultPath = deps.env.STATUS_TRUTH_PRS_RESULT_PATH
  const dryRun = deps.env.STATUS_TRUTH_DRY_RUN === 'true'

  const armed = isPrExecutionArmed({
    prsEnabledVar: deps.env[PRS_ENABLED_VAR],
    dispatchInputVar: deps.env[PRS_DISPATCH_INPUT_VAR],
    graduatedClaimKinds: deps.graduatedClaimKinds,
  })

  if (!armed) {
    const result: PrsResult = {
      armed: false,
      dryRun,
      plannedCounts: EMPTY_PLANNED_COUNTS,
      executedCounts: EMPTY_EXECUTED_COUNTS,
    }
    await writeResultAndStdout({result, resultPath, deps})
    return result
  }

  if (reportPath === undefined || reportPath === '') {
    deps.writeStderr('status-truth-prs: STATUS_TRUTH_REPORT_PATH is required: error-class=missing-report\n')
    deps.setExitCode(1)
    const result: PrsResult = {
      armed: true,
      dryRun,
      plannedCounts: EMPTY_PLANNED_COUNTS,
      executedCounts: EMPTY_EXECUTED_COUNTS,
      error: 'missing-report',
    }
    await writeResultAndStdout({result, resultPath, deps})
    return result
  }

  const readResult = await deps.readReport()
  if (!readResult.valid) {
    deps.writeStderr('status-truth-prs: could not read or validate report artifact: error-class=report-failure\n')
    deps.setExitCode(1)
    const result: PrsResult = {
      armed: true,
      dryRun,
      plannedCounts: EMPTY_PLANNED_COUNTS,
      executedCounts: EMPTY_EXECUTED_COUNTS,
      error: 'report-failure',
    }
    await writeResultAndStdout({result, resultPath, deps})
    return result
  }
  const {report} = readResult

  let publicOutputTokens: PublicOutputTokens
  try {
    publicOutputTokens = await deps.loadPublicOutputTokens()
  } catch {
    deps.writeStderr('status-truth-prs: privacy token load failed: error-class=token-load-failure\n')
    deps.setExitCode(1)
    const result: PrsResult = {
      armed: true,
      dryRun,
      plannedCounts: EMPTY_PLANNED_COUNTS,
      executedCounts: EMPTY_EXECUTED_COUNTS,
      error: 'token-load-failure',
    }
    await writeResultAndStdout({result, resultPath, deps})
    return result
  }

  const {owner, repo} = splitGithubRepository(deps.env.GITHUB_REPOSITORY)

  let existingPrs: ExistingStatusTruthPr[] = []
  let terminalFingerprints: ReadonlySet<string> = new Set<string>()
  let terminalFingerprintsSkipped = 0
  let terminalFingerprintDuplicates = 0

  try {
    const fetchClient = await deps.createFetchClient()
    const [prs, terminals] = await Promise.all([
      fetchExistingCorrectionPrs({client: fetchClient, owner, repo}),
      fetchTerminalFingerprints({client: fetchClient, owner, repo}),
    ])
    existingPrs = prs
    terminalFingerprints = terminals.fingerprints
    terminalFingerprintsSkipped = terminals.skippedInvalid
    terminalFingerprintDuplicates = terminals.duplicateCount
  } catch {
    if (!dryRun) {
      deps.writeStderr('status-truth-prs: existing state fetch failed: error-class=fetch-failure\n')
      deps.setExitCode(1)
      const result: PrsResult = {
        armed: true,
        dryRun,
        plannedCounts: EMPTY_PLANNED_COUNTS,
        executedCounts: EMPTY_EXECUTED_COUNTS,
        error: 'fetch-failure',
      }
      await writeResultAndStdout({result, resultPath, deps})
      return result
    }
    // Dry-run: non-fatal — proceed with empty state (would-act counts may
    // over-estimate opens, but zero mutating calls occur either way).
  }

  const planResult = planStatusTruthPrActions({
    report,
    graduatedClaimKinds: deps.graduatedClaimKinds,
    existingPrs,
    publicOutputTokens,
    maxPrsPerRun: 1,
    enabled: true,
    terminalFingerprints,
  })

  // Dry-run performs zero mutating calls (see executeStatusTruthPrActions'
  // dry-run branch, which returns before touching `octokit` at all), so a
  // real write client/token is neither required nor created here — only
  // live mode needs one, and only live mode's failure to create one is
  // fatal.
  let writeClient: StatusTruthPrOctokitClient
  if (dryRun) {
    writeClient = NOOP_WRITE_CLIENT
  } else {
    try {
      writeClient = await deps.createWriteClient()
    } catch {
      deps.writeStderr('status-truth-prs: write client creation failed: error-class=write-client-failure\n')
      deps.setExitCode(1)
      const result: PrsResult = {
        armed: true,
        dryRun,
        plannedCounts: planResult.counts,
        executedCounts: EMPTY_EXECUTED_COUNTS,
        error: 'write-client-failure',
        terminalFingerprintsSkipped,
        terminalFingerprintDuplicates,
      }
      await writeResultAndStdout({result, resultPath, deps})
      return result
    }
  }

  const executeResult = await executeStatusTruthPrActions({
    octokit: writeClient,
    owner,
    repo,
    actions: planResult.actions,
    dryRun,
    publicOutputTokens,
    writeStderr: deps.writeStderr,
  })

  const result: PrsResult = {
    armed: true,
    dryRun,
    plannedCounts: planResult.counts,
    executedCounts: executeResult.counts,
    terminalFingerprintsSkipped,
    terminalFingerprintDuplicates,
  }
  await writeResultAndStdout({result, resultPath, deps})
  return result
}

/**
 * CLI entry point for the status-truth PR execution step.
 *
 * Environment variables:
 * - STATUS_TRUTH_REPORT_PATH: path to the JSON report artifact from the detect step (required when armed)
 * - STATUS_TRUTH_PRS_RESULT_PATH: path to write the counts-only result JSON (optional)
 * - STATUS_TRUTH_DRY_RUN: set to 'true' for dry-run mode (optional)
 * - STATUS_TRUTH_PRS_ENABLED: repository variable arming key (required to be 'true' to arm)
 * - STATUS_TRUTH_PRS_DISPATCH_INPUT: manual dispatch input arming key (required to be 'true' to arm)
 * - STATUS_TRUTH_FETCH_TOKEN: read-scoped app token for existing PR/proposal listing
 * - GITHUB_TOKEN: write-scoped app token for branch/PR mutations
 * - GITHUB_REPOSITORY: `owner/repo` (defaults to fro-bot/.github)
 *
 * Behavior:
 * - Re-checks arming at startup; disarmed → counts-only exit (defense in depth), no report required.
 * - stdout/stderr carry counts only; no raw claim text, source paths, fingerprints, branch names,
 *   PR/proposal numbers, titles, bodies, or tokens.
 *
 * Thin environment wrapper around {@link runPrsCore}; all real I/O boundaries live there as
 * injected dependencies.
 */
export function buildEnvBackedRunPrsCoreDeps(): RunPrsCoreDeps {
  return {
    env: process.env,
    graduatedClaimKinds: GRADUATED_CLAIM_KINDS,
    readReport: async () => {
      const reportPath = process.env.STATUS_TRUTH_REPORT_PATH
      if (reportPath === undefined || reportPath === '') {
        return {valid: false, reason: 'missing report path'}
      }
      const {readFile} = await import('node:fs/promises')
      let rawJson: string
      try {
        rawJson = await readFile(reportPath, 'utf8')
      } catch {
        return {valid: false, reason: 'read-failure'}
      }
      let rawParsed: unknown
      try {
        rawParsed = JSON.parse(rawJson)
      } catch {
        return {valid: false, reason: 'parse-failure'}
      }
      const {validateStatusTruthArtifact} = await import('./status-truth-detect.ts')
      const validation = validateStatusTruthArtifact(rawParsed)
      if (!validation.valid) return {valid: false, reason: validation.reason}
      return {valid: true, report: validation.report}
    },
    loadPublicOutputTokens: async () => {
      const {loadPrivateTokensFromDisk} = await import('./capture-learnings-privacy.ts')
      const {loadRedactedCanonicalIdsFromDisk} = await import('./status-truth-proposals.ts')
      const {makePublicOutputTokens} = await import('./status-truth-public-output.ts')
      const [privateTokens, redactedCanonicalIds] = await Promise.all([
        loadPrivateTokensFromDisk(),
        loadRedactedCanonicalIdsFromDisk(),
      ])
      return makePublicOutputTokens({privateTokens, redactedCanonicalIds})
    },
    createFetchClient: async () =>
      (await createOctokitFromToken(process.env.STATUS_TRUTH_FETCH_TOKEN)) as unknown as StatusTruthPrFetchClient,
    createWriteClient: async () => createOctokitFromEnv(),
    writeStdout: text => process.stdout.write(text),
    writeStderr: text => process.stderr.write(text),
    writeResultFile: async json => {
      const resultPath = process.env.STATUS_TRUTH_PRS_RESULT_PATH
      if (resultPath === undefined || resultPath === '') return
      const {writeFile} = await import('node:fs/promises')
      await writeFile(resultPath, json, {flag: 'w'})
    },
    setExitCode: code => {
      process.exitCode = code
    },
  }
}

/**
 * Top-level catch-all wrapper around {@link runPrsCore}.
 *
 * `runPrsCore` already handles every anticipated failure path (missing
 * report, invalid report, token load failure, fetch failure, write-client
 * failure) with its own counts-only JSON result and `error` code. This
 * wrapper exists for genuinely unexpected exceptions — e.g. a bug in the
 * planner/executor, an unhandled rejection deep in a dependency — so the
 * process never exits with a raw stack trace or uncaught error reaching
 * stdout/stderr. Exported for testability; production use supplies real
 * env-backed deps via {@link buildEnvBackedRunPrsCoreDeps}.
 */
export async function runPrs(deps: RunPrsCoreDeps): Promise<PrsResult> {
  try {
    return await runPrsCore(deps)
  } catch {
    deps.setExitCode(1)
    const result: PrsResult = {
      armed: false,
      dryRun: deps.env.STATUS_TRUTH_DRY_RUN === 'true',
      plannedCounts: EMPTY_PLANNED_COUNTS,
      executedCounts: EMPTY_EXECUTED_COUNTS,
      error: 'unexpected',
    }
    const resultJson = `${JSON.stringify(result)}\n`
    deps.writeStdout(resultJson)
    deps.writeStderr('status-truth-prs: unexpected failure: error-class=unexpected\n')
    const resultPath = deps.env.STATUS_TRUTH_PRS_RESULT_PATH
    if (resultPath !== undefined && resultPath !== '') {
      try {
        await deps.writeResultFile(resultJson)
      } catch {
        deps.writeStderr('status-truth-prs: could not write result: error-class=write-failure\n')
      }
    }
    return result
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runPrs(buildEnvBackedRunPrsCoreDeps())
}
