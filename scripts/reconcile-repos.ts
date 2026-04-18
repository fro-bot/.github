/**
 * Pure reconciliation engine for `metadata/repos.yaml`.
 *
 * Given a snapshot of what fro-bot currently tracks and a snapshot of its actual GitHub
 * collaborator reality, produces the next metadata state plus the side-effect plan
 * (dispatches to queue, pending-review issues to file, summary counters). No I/O happens
 * here; Unit 3's shell turns the plan into API calls.
 *
 * Mutator purity contract: `reconcileRepos` does NOT mutate its inputs. Every updated
 * repo entry is a fresh object. `currentRepos` reference identity is preserved when the
 * result is a true no-op, so callers can use `===` as a cheap zero-change probe — but
 * test suites should compare by value (deep equality) rather than identity.
 *
 * New entries are produced exclusively through the shared `addRepoEntry` helper so every
 * writer to `metadata/repos.yaml` (`handle-invitation.ts` and this module) produces
 * byte-compatible entry shapes. Status transitions on existing entries (lost-access,
 * regain, field drift) use fresh inline objects because `addRepoEntry` is idempotent on
 * duplicate `owner+name` and would silently drop a status flip.
 *
 * ## I/O shell contract (Unit 3)
 *
 * `handleReconcile` accepts injectable dependencies (Octokit clients, readMetadata,
 * commitMetadata, bootstrapDataBranch, logger) so the entire outer layer is testable
 * with handcrafted mocks. Production uses `main()` which reads `FRO_BOT_POLL_PAT` and
 * `GITHUB_TOKEN` from env, constructs both Octokit clients, and delegates. Token values
 * never appear in logs or error messages — error paths reference env-var names only.
 *
 * Commit-before-dispatch: `commitMetadata` runs before the dispatch/issue loops. A
 * commit failure is fatal (bubbled up). Dispatch/issue failures are non-blocking: they
 * log and continue so one misbehaving API call doesn't stall the rest of the run.
 *
 * Mutator re-run for concurrent-writer safety: the mutator closure re-invokes
 * `reconcileRepos` on every call with fresh `current`. If a competing writer appends an
 * entry between our read and our commit, the 409-retry path in `commitMetadata` re-runs
 * the mutator with the post-retry snapshot and the merge is correct. Without this
 * contract, whole-state replacement would silently drop concurrently-added entries.
 */

import {readFile} from 'node:fs/promises'
import process from 'node:process'
import {Octokit} from '@octokit/rest'
import {parse} from 'yaml'

import {
  commitMetadata as defaultCommitMetadata,
  type CommitMetadataParams,
  type CommitMetadataResult,
} from './commit-metadata.ts'
import {
  bootstrapDataBranch as defaultBootstrapDataBranch,
  type DataBranchBootstrapParams,
  type DataBranchBootstrapResult,
} from './data-branch-bootstrap.ts'
import {addRepoEntry} from './repos-metadata.ts'
import {
  assertAllowlistFile,
  assertReposFile,
  type AllowlistFile,
  type OnboardingStatus,
  type RepoEntry,
  type ReposFile,
} from './schemas.ts'

export interface AccessListEntry {
  owner: string
  name: string
  archived: boolean
  private: boolean
  /**
   * GitHub-assigned opaque repo identifier (e.g. `R_kgDOA...`). Carried through to the
   * issue queue so the Unit 3 shell can reference private repos without leaking the name.
   */
  node_id: string
}

export type RepoStatusProbe =
  | {status: 'deleted'}
  | {status: 'archived'}
  | {status: 'revoked'}
  | {status: 'still-accessible'; private: boolean; node_id: string}

export interface FieldProbe {
  has_fro_bot_workflow: boolean
  has_renovate: boolean
}

export interface ReconcileInput {
  currentRepos: ReposFile
  accessList: AccessListEntry[]
  /** Map key format: `${owner}/${name}` (exact). Populated only for tracked repos not in the access list. */
  perRepoStatus: Map<string, RepoStatusProbe>
  allowlist: AllowlistFile
  /** Map key format: `${owner}/${name}` (exact). Populated only for still-accessible tracked repos. */
  fieldProbes: Map<string, FieldProbe>
  now: Date
}

export interface DispatchRequest {
  owner: string
  repo: string
}

export interface PerRepoIssue {
  kind: 'per-repo'
  owner: string
  repo: string
  reason: 'unsolicited-new' | 'unsolicited-regain'
  private: boolean
  node_id: string
}

export interface PerOwnerRollupIssue {
  kind: 'per-owner-rollup'
  owner: string
  entries: {repo: string; private: boolean; node_id: string}[]
  reason: 'unsolicited-new' | 'unsolicited-regain'
}

export type IssueQueueEntry = PerRepoIssue | PerOwnerRollupIssue

export interface ReconcileSummary {
  added: number
  pendingReview: number
  regained: number
  lostAccess: number
  refreshed: number
  unchanged: number
}

export interface ReconcileResult {
  nextRepos: ReposFile
  dispatches: DispatchRequest[]
  issues: IssueQueueEntry[]
  summary: ReconcileSummary
}

/**
 * Classify every repo in either the currently-tracked set or the live access list and
 * produce the next metadata state plus a side-effect plan.
 *
 * See the per-repo classification decision table in
 * `docs/plans/2026-04-17-001-feat-repo-reconciliation-plan.md` for the full matrix.
 */
export function reconcileRepos(input: ReconcileInput): ReconcileResult {
  const {currentRepos, accessList, perRepoStatus, allowlist, fieldProbes, now} = input

  validateAccessList(accessList)

  const accessByKey = indexAccessList(accessList)
  const allowlistedOwners = new Set(allowlist.approved_inviters.map(i => i.username))

  const summary: ReconcileSummary = {
    added: 0,
    pendingReview: 0,
    regained: 0,
    lostAccess: 0,
    refreshed: 0,
    unchanged: 0,
  }
  const dispatches: DispatchRequest[] = []
  const rawIssues: RawIssue[] = []

  // Pass 1 — classify every tracked entry against the access list and probes.
  const trackedKeys = new Set<string>()
  const nextEntries: RepoEntry[] = currentRepos.repos.map(entry => {
    const key = repoKey(entry.owner, entry.name)
    trackedKeys.add(key)
    return classifyTracked({
      entry,
      key,
      accessByKey,
      perRepoStatus,
      fieldProbes,
      allowlistedOwners,
      summary,
      dispatches,
      rawIssues,
    })
  })

  let next: ReposFile = {...currentRepos, repos: nextEntries}

  // Pass 2 — add newcomers (accessible repos not yet tracked).
  for (const access of accessList) {
    const key = repoKey(access.owner, access.name)
    if (trackedKeys.has(key)) continue
    if (access.archived) continue // untracked + archived: no history worth capturing; skip silently.

    const allowlisted = allowlistedOwners.has(access.owner)
    const status: OnboardingStatus = allowlisted ? 'pending' : 'pending-review'

    next = addRepoEntry(next, {
      owner: access.owner,
      repo: access.name,
      now,
      onboarding_status: status,
    })

    if (allowlisted) {
      summary.added += 1
      dispatches.push({owner: access.owner, repo: access.name})
    } else {
      summary.pendingReview += 1
      rawIssues.push({
        owner: access.owner,
        repo: access.name,
        reason: 'unsolicited-new',
        private: access.private,
        node_id: access.node_id,
      })
    }
  }

  const issues = buildIssueQueue(rawIssues)

  // Zero-change optimization: preserve currentRepos reference identity for cheap `===` probe.
  if (isNoOp(summary, dispatches, issues)) {
    return {nextRepos: currentRepos, dispatches, issues, summary}
  }

  return {nextRepos: next, dispatches, issues, summary}
}

interface ClassifyTrackedParams {
  entry: RepoEntry
  key: string
  accessByKey: Map<string, AccessListEntry>
  perRepoStatus: Map<string, RepoStatusProbe>
  fieldProbes: Map<string, FieldProbe>
  allowlistedOwners: Set<string>
  summary: ReconcileSummary
  dispatches: DispatchRequest[]
  rawIssues: RawIssue[]
}

/**
 * Determine the fate of one tracked repo. Returns a fresh entry when the status or fields
 * need to change; otherwise returns the original entry by reference. Mutates the shared
 * summary/dispatches/rawIssues accumulators — this is the functional loop-and-accumulate
 * pattern (see `processInvitation` in `handle-invitation.ts`).
 */
function classifyTracked(params: ClassifyTrackedParams): RepoEntry {
  const {entry, key, accessByKey, perRepoStatus, fieldProbes, allowlistedOwners, summary, dispatches, rawIssues} =
    params
  const access = accessByKey.get(key)

  if (access === undefined) {
    // Not in the access list — probe decides lost-access vs transient inconsistency.
    const probe = perRepoStatus.get(key)
    if (probe === undefined) {
      // Probe missing (e.g. probe request failed mid-run) — treat as no change.
      summary.unchanged += 1
      return entry
    }
    if (probe.status === 'still-accessible') {
      // Transient inconsistency between the access-list enumeration and the per-repo probe.
      summary.unchanged += 1
      return entry
    }
    // deleted / archived / revoked — flip to lost-access unless already there.
    if (entry.onboarding_status === 'lost-access') {
      summary.unchanged += 1
      return entry
    }
    summary.lostAccess += 1
    return {...entry, onboarding_status: 'lost-access'}
  }

  if (access.archived) {
    // Pass-1 archived detection: flip to lost-access directly, no Pass-2 probe required.
    if (entry.onboarding_status === 'lost-access') {
      summary.unchanged += 1
      return entry
    }
    summary.lostAccess += 1
    return {...entry, onboarding_status: 'lost-access'}
  }

  if (entry.onboarding_status === 'lost-access') {
    // Regain: entry was lost-access and is now back in the access list.
    const allowlisted = allowlistedOwners.has(entry.owner)
    const nextStatus: OnboardingStatus = allowlisted ? 'pending' : 'pending-review'
    summary.regained += 1
    if (allowlisted) {
      dispatches.push({owner: entry.owner, repo: entry.name})
    } else {
      rawIssues.push({
        owner: entry.owner,
        repo: entry.name,
        reason: 'unsolicited-regain',
        private: access.private,
        node_id: access.node_id,
      })
    }
    return {...entry, onboarding_status: nextStatus}
  }

  // Still-accessible tracked entry — apply field refresh if the probe disagrees.
  const probe = fieldProbes.get(key)
  if (probe === undefined) {
    // No probe data — preserve existing field values (do not overwrite with undefined).
    summary.unchanged += 1
    return entry
  }
  if (probe.has_fro_bot_workflow === entry.has_fro_bot_workflow && probe.has_renovate === entry.has_renovate) {
    summary.unchanged += 1
    return entry
  }
  summary.refreshed += 1
  return {
    ...entry,
    has_fro_bot_workflow: probe.has_fro_bot_workflow,
    has_renovate: probe.has_renovate,
  }
}

interface RawIssue {
  owner: string
  repo: string
  reason: 'unsolicited-new' | 'unsolicited-regain'
  private: boolean
  node_id: string
}

/**
 * Collapse ≥2 issues from the same non-allowlisted owner (same reason) into a single
 * `per-owner-rollup` issue. Single-repo owners still produce one `per-repo` issue each.
 * Allowlisted newcomers never reach this function — they get dispatches, not issues.
 */
function buildIssueQueue(raw: RawIssue[]): IssueQueueEntry[] {
  const groups = new Map<string, RawIssue[]>()
  for (const item of raw) {
    const groupKey = `${item.reason}:${item.owner}`
    const bucket = groups.get(groupKey) ?? []
    bucket.push(item)
    groups.set(groupKey, bucket)
  }

  const issues: IssueQueueEntry[] = []
  for (const bucket of groups.values()) {
    if (bucket.length >= 2) {
      const first = bucket[0]
      if (first === undefined) continue // unreachable; satisfies noUncheckedIndexedAccess
      issues.push({
        kind: 'per-owner-rollup',
        owner: first.owner,
        reason: first.reason,
        entries: bucket.map(item => ({repo: item.repo, private: item.private, node_id: item.node_id})),
      })
      continue
    }
    for (const item of bucket) {
      issues.push({
        kind: 'per-repo',
        owner: item.owner,
        repo: item.repo,
        reason: item.reason,
        private: item.private,
        node_id: item.node_id,
      })
    }
  }
  return issues
}

function isNoOp(summary: ReconcileSummary, dispatches: DispatchRequest[], issues: IssueQueueEntry[]): boolean {
  return (
    summary.added === 0 &&
    summary.pendingReview === 0 &&
    summary.regained === 0 &&
    summary.lostAccess === 0 &&
    summary.refreshed === 0 &&
    dispatches.length === 0 &&
    issues.length === 0
  )
}

function indexAccessList(accessList: AccessListEntry[]): Map<string, AccessListEntry> {
  const map = new Map<string, AccessListEntry>()
  for (const entry of accessList) {
    map.set(repoKey(entry.owner, entry.name), entry)
  }
  return map
}

function validateAccessList(accessList: AccessListEntry[]): void {
  const seen = new Set<string>()
  for (const entry of accessList) {
    const key = repoKey(entry.owner, entry.name)
    if (seen.has(key)) {
      throw new Error(`reconcileRepos: duplicate accessList entry for ${key}`)
    }
    seen.add(key)
  }
}

function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`
}

//
// ─────────────────────────────────────────────────────────────────────────────
// Unit 3 — I/O shell: `handleReconcile` plus dispatch/issue/integrity helpers
// ─────────────────────────────────────────────────────────────────────────────
//

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_ALLOWLIST_PATH = 'metadata/allowlist.yaml'
const DEFAULT_REPOS_PATH = 'metadata/repos.yaml'
const DEFAULT_WORKFLOW_FILE = 'survey-repo.yaml'
const DEFAULT_WORKFLOW_REF = 'main'
const DEFAULT_DISPATCH_TIMEOUT_MS = 15_000
/**
 * Delay (ms) inserted between consecutive Survey Repo dispatches. Surveys share a single
 * Claude max20 OAuth seat via cliproxy.fro.bot and saturate upstream Anthropic rate limits
 * when dispatched concurrently (see marcusrbrown/infra#144 diagnosis). Staggering spreads
 * LLM context-window kickoff over time without exceeding the 10-minute workflow job
 * timeout for any realistic access-list size.
 *
 * Default: 8s between dispatches → ~2 minutes to fan out 16 surveys, well under the
 * 10-minute cap even if the access list grows to 50+ entries. Override via
 * `RECONCILE_DISPATCH_STAGGER_MS` env var or `dispatchStaggerMs` param. Tests pass 0.
 */
const DEFAULT_DISPATCH_STAGGER_MS = 8_000

const PENDING_REVIEW_LABEL = 'reconcile:pending-review'
const ROLLUP_LABEL = 'reconcile:rollup-pending-review'
const INTEGRITY_ALERT_LABEL = 'reconcile:integrity-alert'
const EXPECTED_APP_AUTHOR = 'fro-bot[bot]'

const NODE_ID_MARKER_PATTERN = /<!-- reconcile:subject:node_id=([\w-]+) -->/
const ROLLUP_OWNER_MARKER_PATTERN = /<!-- reconcile:subject:rollup-owner=([\w-]+) -->/

export type ReconcileErrorCode =
  | 'MISSING_TOKEN'
  | 'OCTOKIT_LOAD_FAILED'
  | 'METADATA_READ_ERROR'
  | 'COMMIT_ERROR'
  | 'DATA_BRANCH_TAMPER'
  | 'API_ERROR'

/**
 * Structured error with a remediation hint. Thrown for every expected failure mode on
 * the top-level path. Matches the shape of `CommitMetadataError` /
 * `InvitationHandlingError` / `DataBranchBootstrapError`.
 */
export class ReconcileError extends Error {
  readonly code: ReconcileErrorCode
  readonly remediation: string

  constructor(params: {code: ReconcileErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'ReconcileError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

export interface ReconcileLogger {
  warn: (message: string) => void
}

export interface HandleReconcileParams {
  userOctokit?: OctokitClient
  appOctokit?: OctokitClient
  owner?: string
  repo?: string
  allowlistPath?: string
  reposPath?: string
  workflowFile?: string
  workflowRef?: string
  now?: Date
  readMetadata?: (path: string) => Promise<unknown>
  commitMetadata?: (params: CommitMetadataParams) => Promise<CommitMetadataResult>
  bootstrapDataBranch?: (params: DataBranchBootstrapParams) => Promise<DataBranchBootstrapResult>
  /** Timeout (ms) applied to each `createWorkflowDispatch` call. Defaults to 15_000. */
  dispatchTimeoutMs?: number
  /**
   * Delay (ms) inserted between consecutive dispatches to avoid concurrent LLM requests
   * against the shared Claude OAuth seat. Default 8_000 (see `DEFAULT_DISPATCH_STAGGER_MS`).
   * Tests should pass 0 for speed; workflow env can override via `RECONCILE_DISPATCH_STAGGER_MS`.
   */
  dispatchStaggerMs?: number
  /**
   * Sleep implementation used by the dispatch loop. Test-only injection point — production
   * uses `setTimeout`-backed Promise. Tests replace with a mock to verify stagger without
   * real-time waits.
   */
  dispatchSleep?: (ms: number) => Promise<void>
  /** Extra authors allowed on the data branch tip commit (beyond `fro-bot[bot]`). */
  operatorLogins?: string[]
  logger?: ReconcileLogger
}

export interface HandleReconcileResult {
  accessListSize: number
  summary: ReconcileSummary
  /** Count of successful dispatches. */
  dispatches: number
  /** Count of dispatch failures (timed out, HTTP error, etc.). */
  dispatchesFailed: number
  /** Count of successfully-created per-repo issues from reconcile's classification plan. */
  perRepoIssues: number
  /** Count of successfully-created rollup issues (from plan + self-healing). */
  rollupIssues: number
  /** Count of issue-creation failures across per-repo + rollup. */
  issuesFailed: number
  /** Count of stale `reconcile:pending-review` issues auto-closed this run. */
  closedStaleIssues: number
  /** Count of field probes that failed and were treated as no-change. */
  probesFailed: number
  /**
   * Status of the pre-commit data-branch integrity check.
   * - `'ok'` — check ran and passed.
   * - `'skipped-no-data-branch'` — `data` branch does not exist (fresh first run before bootstrap); check is not applicable.
   * - `'skipped-just-bootstrapped'` — `data` was created this run from `main`'s HEAD, so the author check would falsely flag the inherited commit.
   */
  integrityCheck: 'ok' | 'skipped-no-data-branch' | 'skipped-just-bootstrapped'
  committed: boolean
}

/**
 * End-to-end reconciliation flow. Orchestrates the 13 ordered I/O steps documented at
 * the top of this file.
 */
export async function handleReconcile(params: HandleReconcileParams = {}): Promise<HandleReconcileResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const allowlistPath = params.allowlistPath ?? DEFAULT_ALLOWLIST_PATH
  const reposPath = params.reposPath ?? DEFAULT_REPOS_PATH
  const workflowFile = params.workflowFile ?? DEFAULT_WORKFLOW_FILE
  const workflowRef = params.workflowRef ?? DEFAULT_WORKFLOW_REF
  const now = params.now ?? new Date()
  const dispatchTimeoutMs = params.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS
  const dispatchStaggerMs = params.dispatchStaggerMs ?? loadDispatchStaggerFromEnv()
  const logger: ReconcileLogger = params.logger ?? {warn: message => process.stderr.write(`${message}\n`)}
  const operatorLogins = params.operatorLogins ?? loadOperatorLoginsFromEnv()
  const readMetadata = params.readMetadata ?? readMetadataFromDisk
  const commitMetadataImpl = params.commitMetadata ?? defaultCommitMetadata
  const bootstrap = params.bootstrapDataBranch ?? defaultBootstrapDataBranch
  const userOctokit = params.userOctokit ?? (await createOctokitFromEnv('FRO_BOT_POLL_PAT'))
  const appOctokit = params.appOctokit ?? (await createOctokitFromEnv('GITHUB_TOKEN'))

  // 1. Bootstrap data branch (idempotent). On first run, this creates `data` from `main`'s
  //    HEAD. The new branch inherits `main`'s history, so its tip commit is authored by
  //    whoever merged the most recent PR — not `fro-bot[bot]`. Track the `created` flag so
  //    we can skip the author-integrity check on bootstrap runs; once fro-bot makes its
  //    first commit on `data`, subsequent runs enforce the check normally.
  const bootstrapResult = await bootstrap({octokit: appOctokit, owner, repo})
  const justBootstrapped = bootstrapResult.created === true

  // 2. Read metadata from disk (main branch checkout).
  const allowlist = await loadAllowlist(readMetadata, allowlistPath)
  const currentRepos = await loadRepos(readMetadata, reposPath)

  // 3. Enumerate /user/repos (access list).
  const accessList = await fetchAccessList(userOctokit)

  // 4. For each tracked entry missing from the access list, probe `GET /repos/{o}/{r}`.
  const perRepoStatus = await fetchPerRepoStatus(userOctokit, currentRepos, accessList)

  // 5. Field probes for still-accessible tracked entries.
  const fieldProbeOutcome = await fetchFieldProbes(userOctokit, currentRepos, accessList, logger)
  const fieldProbes = fieldProbeOutcome.probes
  const probesFailed = fieldProbeOutcome.failed

  // 6. Run the pure engine to produce the change plan.
  const plan = reconcileRepos({currentRepos, accessList, perRepoStatus, allowlist, fieldProbes, now})

  const hasChanges = planHasChanges(plan)
  let integrityCheck: 'ok' | 'skipped-no-data-branch' | 'skipped-just-bootstrapped' = 'ok'
  let committed = false

  if (hasChanges) {
    // 7. Pre-commit integrity check — fail closed on unexpected authors. Skipped entirely
    //    when `data` was just bootstrapped this run: its tip commit is inherited from
    //    `main` and is by definition authored by whoever merged the most recent PR, not
    //    `fro-bot[bot]`. The check activates on the next run after fro-bot commits.
    if (justBootstrapped) {
      integrityCheck = 'skipped-just-bootstrapped'
    } else {
      const integrity = await verifyDataBranchIntegrity({appOctokit, owner, repo, operatorLogins})
      if (!integrity.ok) {
        await fileIntegrityAlert({
          appOctokit,
          owner,
          repo,
          authorLogin: integrity.authorLogin,
          sha: integrity.sha,
          logger,
        })
        throw new ReconcileError({
          code: 'DATA_BRANCH_TAMPER',
          message: `Unexpected author on data branch tip commit: ${integrity.authorLogin ?? 'unknown'} (sha: ${integrity.sha})`,
          remediation:
            'Investigate who has contents:write on this repo. If legitimate, add the login to RECONCILE_OPERATOR_LOGINS and rerun.',
        })
      }
      integrityCheck = integrity.status
    }

    // 8. Commit via mutator closure. Mutator re-runs reconcileRepos on each invocation,
    //    so 409-retry in commitMetadata absorbs concurrent writes correctly.
    const commitResult = await commitMetadataImpl({
      octokit: appOctokit,
      path: reposPath,
      message: formatCommitMessage(plan.summary),
      mutator: async currentParsed => {
        assertReposFile(currentParsed, 'repos')
        // Re-verify data-branch integrity inside the mutator to close the TOCTOU window
        // between the initial check (step 7) and the first commit attempt. Each 409 retry
        // also re-verifies, catching any tamper that lands during the retry loop. Skipped
        // on bootstrap runs for the same reason as the initial check.
        if (!justBootstrapped) {
          const retryIntegrity = await verifyDataBranchIntegrity({appOctokit, owner, repo, operatorLogins})
          if (!retryIntegrity.ok) {
            await fileIntegrityAlert({
              appOctokit,
              owner,
              repo,
              authorLogin: retryIntegrity.authorLogin,
              sha: retryIntegrity.sha,
              logger,
            })
            throw new ReconcileError({
              code: 'DATA_BRANCH_TAMPER',
              message: `Unexpected author on data branch tip commit during commit retry: ${retryIntegrity.authorLogin ?? 'unknown'} (sha: ${retryIntegrity.sha})`,
              remediation:
                'Investigate who has contents:write on this repo. If legitimate, add the login to RECONCILE_OPERATOR_LOGINS and rerun.',
            })
          }
        }
        const rerun = reconcileRepos({
          currentRepos: currentParsed,
          accessList,
          perRepoStatus,
          allowlist,
          fieldProbes,
          now,
        })
        return rerun.nextRepos
      },
    })
    committed = commitResult.committed
  }

  // 9. Dispatch loop (serial, non-blocking on failure, wrapped in a per-call timeout).
  const dispatchOutcome = await runDispatches({
    staggerMs: dispatchStaggerMs,
    sleep: params.dispatchSleep,
    appOctokit,
    owner,
    repo,
    workflowFile,
    workflowRef,
    dispatches: plan.dispatches,
    timeoutMs: dispatchTimeoutMs,
    logger,
  })

  // 10. Issue-creation loop (serial, non-blocking on failure).
  const issueOutcome = await runIssueQueue({
    appOctokit,
    owner,
    repo,
    issues: plan.issues,
    logger,
  })

  // 11. Auto-close stale `reconcile:pending-review` issues.
  const closedStaleIssues = await autoCloseStaleIssues({
    appOctokit,
    owner,
    repo,
    nextRepos: plan.nextRepos,
    accessList,
    logger,
  })

  // 12. Self-healing rollup re-file.
  const healedRollups = await selfHealRollups({
    appOctokit,
    owner,
    repo,
    nextRepos: plan.nextRepos,
    accessList,
    allowlist,
    logger,
  })

  return {
    accessListSize: accessList.length,
    summary: plan.summary,
    dispatches: dispatchOutcome.succeeded,
    dispatchesFailed: dispatchOutcome.failed,
    perRepoIssues: issueOutcome.perRepoSucceeded,
    rollupIssues: issueOutcome.rollupSucceeded + healedRollups,
    issuesFailed: issueOutcome.failed,
    closedStaleIssues,
    probesFailed,
    integrityCheck,
    committed,
  }
}

/**
 * CLI entrypoint. Reads tokens from env and constructs both Octokit clients.
 * Writes the final JSON result to stdout. Exits non-zero on top-level error.
 */
async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY ?? `${DEFAULT_OWNER}/${DEFAULT_REPO}`
  const [owner, repo] = repository.split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
    throw new ReconcileError({
      code: 'API_ERROR',
      message: `Invalid GITHUB_REPOSITORY value: "${repository}"`,
      remediation: 'Expected "owner/repo" format. Set GITHUB_REPOSITORY in the workflow.',
    })
  }

  const result = await handleReconcile({owner, repo})
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

//
// ─── helpers ────────────────────────────────────────────────────────────────
//

function planHasChanges(plan: ReconcileResult): boolean {
  const {summary} = plan
  return (
    summary.added > 0 ||
    summary.pendingReview > 0 ||
    summary.regained > 0 ||
    summary.lostAccess > 0 ||
    summary.refreshed > 0 ||
    plan.dispatches.length > 0 ||
    plan.issues.length > 0
  )
}

function formatCommitMessage(summary: ReconcileSummary): string {
  return `chore(reconcile): +${summary.added} new, ${summary.pendingReview} pending-review, ${summary.lostAccess} lost-access, ${summary.refreshed} refreshes`
}

async function loadAllowlist(readMetadata: (path: string) => Promise<unknown>, path: string): Promise<AllowlistFile> {
  try {
    const parsed = await readMetadata(path)
    assertAllowlistFile(parsed, 'allowlist')
    return parsed
  } catch (error: unknown) {
    throw toMetadataError(error, 'allowlist', path)
  }
}

async function loadRepos(readMetadata: (path: string) => Promise<unknown>, path: string): Promise<ReposFile> {
  try {
    const parsed = await readMetadata(path)
    assertReposFile(parsed, 'repos')
    return parsed
  } catch (error: unknown) {
    throw toMetadataError(error, 'repos', path)
  }
}

function toMetadataError(error: unknown, target: 'allowlist' | 'repos', path: string): ReconcileError {
  if (error instanceof ReconcileError) return error
  const message = error instanceof Error ? error.message : `Unknown ${target} metadata error`
  return new ReconcileError({
    code: 'METADATA_READ_ERROR',
    message: `Failed to load ${target} metadata (${path}): ${message}`,
    remediation: `Ensure ${path} exists, is readable, and matches the expected schema.`,
  })
}

async function readMetadataFromDisk(path: string): Promise<unknown> {
  const contents = await readFile(path, 'utf8')
  return parse(contents)
}

interface AccessListApiEntry {
  owner: {login: string} | null
  name: string
  archived: boolean | null | undefined
  private: boolean | null | undefined
  node_id: string
}

async function fetchAccessList(userOctokit: OctokitClient): Promise<AccessListEntry[]> {
  try {
    const repos = (await userOctokit.paginate(userOctokit.rest.repos.listForAuthenticatedUser, {
      affiliation: 'collaborator',
      per_page: 100,
    })) as unknown as AccessListApiEntry[]
    const entries: AccessListEntry[] = []
    for (const r of repos) {
      if (r.owner == null) continue // GitHub nulls owner for deleted-user repos; skip.
      entries.push({
        owner: r.owner.login,
        name: r.name,
        archived: r.archived === true,
        private: r.private === true,
        node_id: r.node_id,
      })
    }
    return entries
  } catch (error: unknown) {
    throw toApiError(error, 'enumerating /user/repos')
  }
}

async function fetchPerRepoStatus(
  userOctokit: OctokitClient,
  currentRepos: ReposFile,
  accessList: AccessListEntry[],
): Promise<Map<string, RepoStatusProbe>> {
  const accessKeys = new Set(accessList.map(a => `${a.owner}/${a.name}`))
  const map = new Map<string, RepoStatusProbe>()
  for (const entry of currentRepos.repos) {
    const key = `${entry.owner}/${entry.name}`
    if (accessKeys.has(key)) continue
    try {
      await userOctokit.rest.repos.get({owner: entry.owner, repo: entry.name})
      // Reachable (200) but we weren't in /user/repos → access was revoked.
      map.set(key, {status: 'revoked'})
    } catch (error: unknown) {
      if (isApiStatus(error, 404)) {
        map.set(key, {status: 'deleted'})
        continue
      }
      throw toApiError(error, `probing repo status for tracked entry`)
    }
  }
  return map
}

async function fetchFieldProbes(
  userOctokit: OctokitClient,
  currentRepos: ReposFile,
  accessList: AccessListEntry[],
  logger: ReconcileLogger,
): Promise<{probes: Map<string, FieldProbe>; failed: number}> {
  const accessKeys = new Set(accessList.filter(a => a.archived === false).map(a => `${a.owner}/${a.name}`))
  const map = new Map<string, FieldProbe>()
  let failed = 0
  for (const entry of currentRepos.repos) {
    const key = `${entry.owner}/${entry.name}`
    if (!accessKeys.has(key)) continue // only probe still-accessible tracked entries
    try {
      const probe = await probeSingleRepo(userOctokit, entry.owner, entry.name)
      map.set(key, probe)
    } catch (error: unknown) {
      // Non-blocking: omit from map so reconcileRepos treats as no-field-change.
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      logger.warn(`reconcile: field probe failed (status=${status}); treating as no-change.`)
    }
  }
  return {probes: map, failed}
}

async function probeSingleRepo(userOctokit: OctokitClient, owner: string, name: string): Promise<FieldProbe> {
  const [hasWorkflow, hasRenovate] = await Promise.all([
    probeFroBotWorkflow(userOctokit, owner, name),
    probeRenovateConfig(userOctokit, owner, name),
  ])
  return {has_fro_bot_workflow: hasWorkflow, has_renovate: hasRenovate}
}

async function probeFroBotWorkflow(userOctokit: OctokitClient, owner: string, name: string): Promise<boolean> {
  try {
    const response = await userOctokit.rest.repos.getContent({
      owner,
      repo: name,
      path: '.github/workflows',
    })
    const data = response.data as unknown
    if (!Array.isArray(data)) return false
    for (const item of data as {type?: string; name?: string}[]) {
      if (item.type === 'file' && typeof item.name === 'string' && /^fro-bot.*\.yaml$/.test(item.name)) {
        return true
      }
    }
    return false
  } catch (error: unknown) {
    if (isApiStatus(error, 404)) return false
    throw error
  }
}

const RENOVATE_CONFIG_PATHS = ['renovate.json', '.github/renovate.json', '.renovaterc.json', '.renovaterc']

async function probeRenovateConfig(userOctokit: OctokitClient, owner: string, name: string): Promise<boolean> {
  for (const path of RENOVATE_CONFIG_PATHS) {
    try {
      await userOctokit.rest.repos.getContent({owner, repo: name, path})
      return true
    } catch (error: unknown) {
      if (isApiStatus(error, 404)) continue
      throw error
    }
  }
  return false
}

interface IntegrityCheckOkResult {
  ok: true
  status: 'ok' | 'skipped-no-data-branch'
}
interface IntegrityCheckFailResult {
  ok: false
  authorLogin: string | null
  sha: string
}

async function verifyDataBranchIntegrity(params: {
  appOctokit: OctokitClient
  owner: string
  repo: string
  operatorLogins: string[]
}): Promise<IntegrityCheckOkResult | IntegrityCheckFailResult> {
  try {
    const response = await params.appOctokit.rest.repos.getBranch({
      owner: params.owner,
      repo: params.repo,
      branch: 'data',
    })
    const commit = response.data.commit as {sha: string; author?: {login?: string} | null}
    const authorLogin = typeof commit.author?.login === 'string' ? commit.author.login : null
    const allowed = new Set<string>([EXPECTED_APP_AUTHOR, ...params.operatorLogins])
    if (authorLogin !== null && allowed.has(authorLogin)) {
      return {ok: true, status: 'ok'}
    }
    return {ok: false, authorLogin, sha: commit.sha}
  } catch (error: unknown) {
    if (isApiStatus(error, 404)) {
      return {ok: true, status: 'skipped-no-data-branch'}
    }
    throw toApiError(error, 'verifying data branch integrity')
  }
}

async function fileIntegrityAlert(params: {
  appOctokit: OctokitClient
  owner: string
  repo: string
  authorLogin: string | null
  sha: string
  logger: ReconcileLogger
}): Promise<void> {
  try {
    await callIssuesCreate(params.appOctokit, {
      owner: params.owner,
      repo: params.repo,
      title: `Reconcile integrity alert: unexpected author on data branch`,
      body: [
        'Unexpected author on `data` branch tip commit. Reconcile refuses to commit on top of tampered-looking state.',
        '',
        `- Tip SHA: \`${params.sha}\``,
        `- Author login: \`${params.authorLogin ?? 'unknown'}\``,
        `- Expected: \`${EXPECTED_APP_AUTHOR}\` or an operator login in \`RECONCILE_OPERATOR_LOGINS\``,
        '',
        'Next steps:',
        '- If this is a legitimate operator commit, add the login to `RECONCILE_OPERATOR_LOGINS` and rerun.',
        '- If unauthorized, investigate who has `contents:write` on this repository.',
      ].join('\n'),
      labels: [INTEGRITY_ALERT_LABEL],
    })
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: failed to file integrity alert issue (status=${status}).`)
  }
}

async function runDispatches(params: {
  appOctokit: OctokitClient
  owner: string
  repo: string
  workflowFile: string
  workflowRef: string
  dispatches: DispatchRequest[]
  timeoutMs: number
  /**
   * Delay (ms) inserted BETWEEN consecutive dispatches (not before the first, not after
   * the last). Zero disables staggering entirely — test suites pass 0 for speed.
   */
  staggerMs: number
  logger: ReconcileLogger
  /**
   * Sleep implementation. Injected for test speed — production uses `setTimeout`-backed
   * Promise; tests pass a no-op or a deterministic fake clock.
   */
  sleep?: (ms: number) => Promise<void>
}): Promise<{succeeded: number; failed: number}> {
  const sleep = params.sleep ?? defaultSleep
  let succeeded = 0
  let failed = 0
  for (let i = 0; i < params.dispatches.length; i += 1) {
    const dispatch = params.dispatches[i]
    if (dispatch === undefined) continue
    // Stagger BETWEEN dispatches only — never before the first, never after the last.
    // This keeps the first survey's kickoff latency unchanged and avoids trailing idle time.
    if (i > 0 && params.staggerMs > 0) {
      await sleep(params.staggerMs)
    }
    try {
      await dispatchWithTimeout(
        async () =>
          params.appOctokit.rest.actions.createWorkflowDispatch({
            owner: params.owner,
            repo: params.repo,
            workflow_id: params.workflowFile,
            ref: params.workflowRef,
            inputs: {owner: dispatch.owner, repo: dispatch.repo},
          }),
        params.timeoutMs,
      )
      succeeded += 1
    } catch (error: unknown) {
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      const kind = error instanceof Error ? error.name : 'unknown'
      params.logger.warn(`reconcile: dispatch failed (status=${status}, kind=${kind}); continuing.`)
    }
  }
  return {succeeded, failed}
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Parse `RECONCILE_DISPATCH_STAGGER_MS` from env. Returns the default when unset, empty,
 * or non-numeric. Negative values clamp to 0 (no stagger). Upper-bounded at 60s to prevent
 * accidental workflow-timeout triggers from bad operator config.
 */
function loadDispatchStaggerFromEnv(): number {
  const raw = process.env.RECONCILE_DISPATCH_STAGGER_MS
  if (raw === undefined || raw === '') return DEFAULT_DISPATCH_STAGGER_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_DISPATCH_STAGGER_MS
  if (parsed < 0) return 0
  if (parsed > 60_000) return 60_000
  return parsed
}

async function dispatchWithTimeout<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('dispatch timed out'), {name: 'DispatchTimeoutError'}))
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(), timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function runIssueQueue(params: {
  appOctokit: OctokitClient
  owner: string
  repo: string
  issues: IssueQueueEntry[]
  logger: ReconcileLogger
}): Promise<{perRepoSucceeded: number; rollupSucceeded: number; failed: number}> {
  let perRepoSucceeded = 0
  let rollupSucceeded = 0
  let failed = 0
  for (const issue of params.issues) {
    try {
      const payload = renderIssuePayload(issue, params.owner, params.repo)
      await callIssuesCreate(params.appOctokit, payload)
      if (issue.kind === 'per-repo') perRepoSucceeded += 1
      else rollupSucceeded += 1
    } catch (error: unknown) {
      failed += 1
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      params.logger.warn(`reconcile: issue creation failed (status=${status}); continuing.`)
    }
  }
  return {perRepoSucceeded, rollupSucceeded, failed}
}

interface IssuePayload {
  owner: string
  repo: string
  title: string
  body: string
  labels: string[]
}

function renderIssuePayload(issue: IssueQueueEntry, owner: string, repo: string): IssuePayload {
  if (issue.kind === 'per-repo') {
    return renderPerRepoIssue(issue, owner, repo)
  }
  return renderRollupIssue(issue, owner, repo)
}

function renderPerRepoIssue(issue: PerRepoIssue, owner: string, repo: string): IssuePayload {
  const isRegain = issue.reason === 'unsolicited-regain'
  const titleVerb = isRegain ? 'regrant' : 'grant'

  if (issue.private) {
    // Private repo: omit name from title and body; reference only by node_id.
    const title = `Unsolicited collaborator ${titleVerb}: private repo`
    const body = [
      `<!-- reconcile:subject:node_id=${issue.node_id} -->`,
      '',
      `A new collaborator ${isRegain ? 'regrant' : 'grant'} was detected for a **private** repository from an owner not in \`metadata/allowlist.yaml\`.`,
      '',
      `- Reason: \`${issue.reason}\``,
      `- Node ID: \`${issue.node_id}\``,
      '',
      'The repository name is omitted because this issue stream is public. Cross-reference via your direct access to `metadata/repos.yaml` on the `data` branch.',
      '',
      'Next steps:',
      '- **Approve**: edit `metadata/repos.yaml` on the `data` branch, change `onboarding_status` to `pending`, and push.',
      '- **Reject**: remove the entry from `metadata/repos.yaml`.',
      '- **Allowlist the owner**: add the owner login to `approved_inviters` in `metadata/allowlist.yaml`.',
    ].join('\n')
    return {owner, repo, title, body, labels: [PENDING_REVIEW_LABEL]}
  }

  // Public repo: include owner/repo in title and body.
  const title = `Unsolicited collaborator ${titleVerb}: ${issue.owner}/${issue.repo}`
  const body = [
    `<!-- reconcile:subject:node_id=${issue.node_id} -->`,
    '',
    `A collaborator ${isRegain ? 'regrant' : 'grant'} was detected for [${issue.owner}/${issue.repo}](https://github.com/${issue.owner}/${issue.repo}) from an owner not in \`metadata/allowlist.yaml\`.`,
    '',
    `- Reason: \`${issue.reason}\``,
    `- Node ID: \`${issue.node_id}\``,
    '',
    'Next steps:',
    '- **Approve**: edit `metadata/repos.yaml` on the `data` branch, change `onboarding_status` to `pending`, and push.',
    '- **Reject**: remove the entry from `metadata/repos.yaml`.',
    `- **Allowlist the owner**: add \`${issue.owner}\` to \`approved_inviters\` in \`metadata/allowlist.yaml\`.`,
  ].join('\n')
  return {owner, repo, title, body, labels: [PENDING_REVIEW_LABEL]}
}

function renderRollupIssue(issue: PerOwnerRollupIssue, owner: string, repo: string): IssuePayload {
  const n = issue.entries.length
  const title = `Unsolicited collaborator grants from ${issue.owner}: ${n} new repos require review`
  const entryLines = issue.entries.map(e =>
    e.private
      ? `- **private repo** (\`${e.node_id}\`)`
      : `- [${issue.owner}/${e.repo}](https://github.com/${issue.owner}/${e.repo}) (\`${e.node_id}\`)`,
  )
  const body = [
    `<!-- reconcile:subject:rollup-owner=${issue.owner} -->`,
    '',
    `Multiple unsolicited collaborator ${issue.reason === 'unsolicited-regain' ? 'regrants' : 'grants'} detected from [${issue.owner}](https://github.com/${issue.owner}):`,
    '',
    ...entryLines,
    '',
    `Reason: \`${issue.reason}\``,
    '',
    'Next steps:',
    `- **Allowlist the owner**: add \`${issue.owner}\` to \`approved_inviters\` in \`metadata/allowlist.yaml\`.`,
    '- **Approve individual repos**: edit `metadata/repos.yaml` on the `data` branch.',
    '- **Reject**: remove entries from `metadata/repos.yaml`.',
  ].join('\n')
  return {owner, repo, title, body, labels: [PENDING_REVIEW_LABEL, ROLLUP_LABEL]}
}

interface OpenIssueEntry {
  number: number
  title: string
  body: string | null
  labels: {name?: string}[]
}

async function autoCloseStaleIssues(params: {
  appOctokit: OctokitClient
  owner: string
  repo: string
  nextRepos: ReposFile
  accessList: AccessListEntry[]
  logger: ReconcileLogger
}): Promise<number> {
  const pendingReviewNodeIds = new Set<string>()
  const pendingReviewOwners = new Map<string, number>()
  const accessByKey = new Map(params.accessList.map(a => [`${a.owner}/${a.name}`, a]))
  for (const entry of params.nextRepos.repos) {
    if (entry.onboarding_status !== 'pending-review') continue
    const access = accessByKey.get(`${entry.owner}/${entry.name}`)
    if (access !== undefined) pendingReviewNodeIds.add(access.node_id)
    pendingReviewOwners.set(entry.owner, (pendingReviewOwners.get(entry.owner) ?? 0) + 1)
  }

  let closed = 0
  try {
    const issues = (await params.appOctokit.paginate(params.appOctokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      labels: PENDING_REVIEW_LABEL,
      per_page: 100,
    })) as unknown as OpenIssueEntry[]

    for (const issue of issues) {
      const labelNames = issue.labels.map(l => l.name).filter((n): n is string => typeof n === 'string')
      const isRollup = labelNames.includes(ROLLUP_LABEL)
      const body = issue.body ?? ''
      let stale = false
      if (isRollup) {
        const ownerMatch = ROLLUP_OWNER_MARKER_PATTERN.exec(body)
        const rollupOwner = ownerMatch?.[1]
        if (rollupOwner === undefined) continue
        const count = pendingReviewOwners.get(rollupOwner) ?? 0
        stale = count < 2
      } else {
        const nodeMatch = NODE_ID_MARKER_PATTERN.exec(body)
        const nodeId = nodeMatch?.[1]
        if (nodeId === undefined) continue
        stale = !pendingReviewNodeIds.has(nodeId)
      }
      if (!stale) continue

      try {
        await params.appOctokit.rest.issues.update({
          owner: params.owner,
          repo: params.repo,
          issue_number: issue.number,
          state: 'closed',
        })
        closed += 1
      } catch (error: unknown) {
        const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
        params.logger.warn(`reconcile: failed to close stale issue #${issue.number} (status=${status}).`)
      }
    }
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: failed to list pending-review issues (status=${status}).`)
  }
  return closed
}

async function selfHealRollups(params: {
  appOctokit: OctokitClient
  owner: string
  repo: string
  nextRepos: ReposFile
  accessList: AccessListEntry[]
  allowlist: AllowlistFile
  logger: ReconcileLogger
}): Promise<number> {
  const allowlistedOwners = new Set(params.allowlist.approved_inviters.map(i => i.username))
  const pendingReviewByOwner = new Map<string, RepoEntry[]>()
  for (const entry of params.nextRepos.repos) {
    if (entry.onboarding_status !== 'pending-review') continue
    if (allowlistedOwners.has(entry.owner)) continue // allowlisted owners are never rolled up
    const bucket = pendingReviewByOwner.get(entry.owner) ?? []
    bucket.push(entry)
    pendingReviewByOwner.set(entry.owner, bucket)
  }

  // Only owners with ≥2 pending-review entries qualify for a rollup.
  const qualifyingOwners = [...pendingReviewByOwner.entries()].filter(([, entries]) => entries.length >= 2)
  if (qualifyingOwners.length === 0) return 0

  let existingRollupOwners: Set<string>
  try {
    const openRollups = (await params.appOctokit.paginate(params.appOctokit.rest.issues.listForRepo, {
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      labels: ROLLUP_LABEL,
      per_page: 100,
    })) as unknown as OpenIssueEntry[]
    existingRollupOwners = new Set()
    for (const issue of openRollups) {
      const body = issue.body ?? ''
      const match = ROLLUP_OWNER_MARKER_PATTERN.exec(body)
      if (match?.[1] !== undefined) existingRollupOwners.add(match[1])
    }
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    params.logger.warn(`reconcile: self-heal rollup listing failed (status=${status}); skipping.`)
    return 0
  }

  const accessByKey = new Map(params.accessList.map(a => [`${a.owner}/${a.name}`, a]))
  let created = 0
  for (const [owner, entries] of qualifyingOwners) {
    if (existingRollupOwners.has(owner)) continue
    const rollupEntries: PerOwnerRollupIssue['entries'] = []
    for (const entry of entries) {
      const access = accessByKey.get(`${entry.owner}/${entry.name}`)
      if (access === undefined) continue // missing node_id — skip to avoid leaking name
      rollupEntries.push({repo: entry.name, private: access.private, node_id: access.node_id})
    }
    if (rollupEntries.length < 2) continue // missing access data leaves us without ≥2 identifiable entries

    // Self-healed rollups always use 'unsolicited-new' as the reason. The original reason
    // ('unsolicited-new' or 'unsolicited-regain') is not tracked on the RepoEntry itself
    // (it's only known at the moment the pending-review state is established), so once the
    // original rollup issue is closed we lose that signal. Operator triages by visiting the
    // listed entries in `repos.yaml`; the title wording is a minor simplification.
    const rollupIssue: PerOwnerRollupIssue = {
      kind: 'per-owner-rollup',
      owner,
      entries: rollupEntries,
      reason: 'unsolicited-new',
    }
    try {
      await callIssuesCreate(params.appOctokit, renderIssuePayload(rollupIssue, params.owner, params.repo))
      created += 1
    } catch (error: unknown) {
      const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
      params.logger.warn(`reconcile: self-heal rollup creation failed (status=${status}); continuing.`)
    }
  }
  return created
}

/**
 * Thin wrapper around `issues.create` that widens our `IssuePayload` shape to match the
 * full Octokit request parameter type (which includes optional request-level fields like
 * `headers` that we never set). The cast-through-unknown is safe because every property
 * we do set is structurally compatible with Octokit's signature.
 */
async function callIssuesCreate(octokit: OctokitClient, payload: IssuePayload): Promise<void> {
  await octokit.rest.issues.create(payload as unknown as Parameters<OctokitClient['rest']['issues']['create']>[0])
}

function loadOperatorLoginsFromEnv(): string[] {
  const raw = process.env.RECONCILE_OPERATOR_LOGINS
  if (raw === undefined || raw === '') return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

async function createOctokitFromEnv(envVar: 'FRO_BOT_POLL_PAT' | 'GITHUB_TOKEN'): Promise<OctokitClient> {
  const token = process.env[envVar]
  if (token === undefined || token === '') {
    throw new ReconcileError({
      code: 'MISSING_TOKEN',
      message: `reconcileRepos requires ${envVar} in the environment`,
      remediation: `Export ${envVar} before invocation. See .github/workflows/reconcile-repos.yaml for how this is mounted.`,
    })
  }
  const LoadedOctokit = await loadOctokitConstructor()
  return new LoadedOctokit({auth: token})
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  if (typeof Octokit !== 'function') {
    throw new ReconcileError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }
  return Octokit as unknown as OctokitConstructor
}

function toApiError(error: unknown, action: string): ReconcileError {
  if (error instanceof ReconcileError) return error
  const message = error instanceof Error ? error.message : `Unknown error while ${action}`
  return new ReconcileError({
    code: 'API_ERROR',
    message: `GitHub API error while ${action}: ${message}`,
    remediation: 'Retry once. If the failure persists, inspect GitHub API status and repository permissions.',
  })
}

function isApiStatus(error: unknown, status: number): boolean {
  return isRecord(error) && typeof error.status === 'number' && error.status === status
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
