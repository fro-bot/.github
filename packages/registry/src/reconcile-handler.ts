/**
 * The I/O shell of a reconcile run: `handleReconcile` reads the access list, runs the pure engine
 * (`reconcile-plan.ts`), verifies the `data` branch, commits `metadata/repos.yaml`, and then dispatches
 * surveys, files issues and syncs stars (`reconcile-effects.ts`).
 *
 * ## I/O shell contract
 *
 * `handleReconcile` accepts injectable dependencies (Octokit clients, readMetadata,
 * commitMetadata, bootstrapDataBranch, logger) so the entire outer layer is testable
 * with handcrafted mocks. Production uses `main()` in `reconcile-cli.ts`, which reads `FRO_BOT_POLL_PAT`,
 * `RECONCILE_DISCOVERY_TOKEN` and `RECONCILE_WRITER_TOKEN` from env, constructs the three
 * Octokit clients, and delegates. Token values never appear in logs or error messages —
 * error paths reference env-var names only.
 *
 * ## Client routing (least-privilege App tokens)
 *
 * - `userOctokit` (`FRO_BOT_POLL_PAT`): collaborator access, collab status, field,
 *   identity and rename probes, star sync. Unchanged.
 * - `discoveryOctokit` (App, owner-wide, metadata:read + contents:read): installation
 *   enumeration and the owned/contrib probes (`repos.get`, `.github/workflows/fro-bot.yaml`
 *   content). Never writes. Response bodies are parsed, never logged or persisted.
 * - `writerOctokit` (App, this repo only, contents/issues/actions:write): `bootstrapDataBranch`,
 *   `commitMetadata`, data-branch integrity reads, issues/labels/integrity alerts, the
 *   `survey-repo.yaml` dispatch, and same-repo reads inside those flows (issue dedup lists,
 *   wiki page lookup on `data`). Never enumerates the installation or reads other repos.
 * A misrouted probe returns 403/404 and would wrongly mark a tracked repo `lost-access`.
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
import {createOctokit, OctokitLoadError} from '@fro-bot/core/github'
import {
  bootstrapDataBranch as defaultBootstrapDataBranch,
  type DataBranchBootstrapParams,
  type DataBranchBootstrapResult,
} from '@fro.bot/wiki-write-core/data-branch-bootstrap'
import {
  assertAllowlistFile,
  assertReposFile,
  type AllowlistFile,
  type ReposFile,
} from '@fro.bot/wiki-write-core/schemas'
import {parse} from 'yaml'
import {
  commitMetadata as defaultCommitMetadata,
  type CommitMetadataParams,
  type CommitMetadataResult,
} from './commit-metadata.ts'
import {
  findBlockedPublicAssociations,
  lookupRepoWikiPage,
  publicAssociationKey,
  type WikiPageState,
} from './metadata-wiki-rename-guard.ts'
import {
  fetchAccessList,
  fetchContribRepos,
  fetchFieldProbes,
  fetchOwnedRepos,
  fetchPerRepoStatus,
  mergeAccessChannels,
} from './reconcile-discovery.ts'
import {
  autoCloseResolvedRenameIssues,
  autoCloseStaleIssues,
  DEFAULT_DISPATCH_TIMEOUT_MS,
  DEFAULT_WORKFLOW_FILE,
  DEFAULT_WORKFLOW_REF,
  loadDispatchStaggerFromEnv,
  loadMaxDispatchesPerRunFromEnv,
  runDispatches,
  runIssueQueue,
  selfHealRollups,
  syncStars,
} from './reconcile-effects.ts'
import {
  describeIntegrityFailure,
  fileIntegrityAlert,
  INTEGRITY_REMEDIATION,
  verifyDataBranchIntegrity,
} from './reconcile-integrity.ts'
import {
  DEFAULT_ALLOWLIST_PATH,
  DEFAULT_OWNER,
  DEFAULT_REPO,
  DEFAULT_REPOS_PATH,
  ReconcileError,
  type OctokitClient,
  type ReconcileLogger,
} from './reconcile-model.ts'
import {
  compareBySurveyFreshness,
  dropExcludedDispatches,
  formatFloorTelemetry,
  formatStuckTelemetry,
  reconcileRepos,
  type DispatchRequest,
  type ReconcileInput,
  type ReconcileResult,
  type ReconcileSummary,
} from './reconcile-plan.ts'

export interface HandleReconcileParams {
  userOctokit?: OctokitClient
  /** App token, owner-wide, read-only: installation enumeration + owned/contrib probes. */
  discoveryOctokit?: OctokitClient
  /** App token, this repo only, write: data-branch commits, issues, labels, survey dispatch. */
  writerOctokit?: OctokitClient
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
   * against the shared upstream seat. Default {@link DEFAULT_DISPATCH_STAGGER_MS}.
   * Tests should pass 0 for speed; workflow env can override via `RECONCILE_DISPATCH_STAGGER_MS`.
   */
  dispatchStaggerMs?: number
  /**
   * Maximum number of dispatches fired in this run. Skipped candidates are eligible again
   * on the next run. Default {@link DEFAULT_MAX_DISPATCHES_PER_RUN}. A value of 0 or
   * negative disables the cap.
   */
  maxDispatchesPerRun?: number
  /**
   * Sleep implementation used by the dispatch loop. Test-only injection point — production
   * uses `setTimeout`-backed Promise. Tests replace with a mock to verify stagger without
   * real-time waits.
   */
  dispatchSleep?: (ms: number) => Promise<void>
  logger?: ReconcileLogger
}

export interface HandleReconcileResult {
  accessListSize: number
  summary: ReconcileSummary
  /** Count of successful dispatches. */
  dispatches: number
  /** Count of dispatch failures (timed out, HTTP error, etc.). */
  dispatchesFailed: number
  /**
   * Count of dispatch candidates deferred to a future run because this run hit the
   * `maxDispatchesPerRun` cap. Zero when every eligible candidate was dispatched.
   */
  dispatchesDeferred: number
  /** Count of successfully-created per-repo issues from reconcile's classification plan. */
  perRepoIssues: number
  /** Count of successfully-created rollup issues (from plan + self-healing). */
  rollupIssues: number
  /** Count of successfully-created visibility-transition integrity-alert issues. */
  visibilityTransitionIssues: number
  /**
   * Count of visibility-transition creates suppressed as duplicates (listForRepo-existing-title match
   * or same-run Set dedup). Surfaces in the JSON result so operators can observe dedup activity.
   */
  visibilityTransitionDuplicatesSkipped: number
  /** Count of successfully-created rename-pending operator issues (node ID only). */
  renamePendingIssues: number
  /** Count of rename-pending creates suppressed because an open issue already carries the node marker. */
  renamePendingDuplicatesSkipped: number
  /** Tracked public repos renamed on GitHub and awaiting `rename-tracked-repo.yaml`. Never dispatched. */
  renamesPending: number
  /** Node-ID-preserving owner changes rejected this run. Never applied, never dispatched. */
  transferBlocked: number
  /** Count of rename-pending issues auto-closed because their node is no longer pending. */
  closedRenamePendingIssues: number
  /** Count of issue-creation failures across per-repo + rollup + visibility-transition + rename-pending. */
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
  /** Count of collab/contrib repos starred this run (check returned 404 → star call succeeded). */
  starsAdded: number
  /** Count of collab/contrib repos already starred (check returned 204 → no star call needed). */
  starsAlreadyPresent: number
  /** Count of star check or star call failures this run (non-blocking; loop continues). */
  starFailures: number
  /** Public names kept unchanged because renaming or merging them away would strand a wiki page. */
  wikiGuardKept: number
  /** Subset of `wikiGuardKept` kept because wiki state could not be verified. */
  wikiGuardUnverifiable: number
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
  const maxDispatchesPerRun = params.maxDispatchesPerRun ?? loadMaxDispatchesPerRunFromEnv()
  const logger: ReconcileLogger = params.logger ?? {
    warn: message => process.stderr.write(`${message}\n`),
    info: message => process.stderr.write(`${message}\n`),
  }
  const readMetadata = params.readMetadata ?? readMetadataFromDisk
  const commitMetadataImpl = params.commitMetadata ?? defaultCommitMetadata
  const bootstrap = params.bootstrapDataBranch ?? defaultBootstrapDataBranch
  const userOctokit = params.userOctokit ?? (await createOctokitFromEnv('FRO_BOT_POLL_PAT'))
  const discoveryOctokit = params.discoveryOctokit ?? (await createOctokitFromEnv('RECONCILE_DISCOVERY_TOKEN'))
  const writerOctokit = params.writerOctokit ?? (await createOctokitFromEnv('RECONCILE_WRITER_TOKEN'))

  // 1. Bootstrap data branch (idempotent). On first run, this creates `data` from `main`'s
  //    HEAD. The new branch inherits `main`'s history, so its tip commit is authored by
  //    whoever merged the most recent PR — not `fro-bot[bot]`. Track the `created` flag so
  //    we can skip the author-integrity check on bootstrap runs; once fro-bot makes its
  //    first commit on `data`, subsequent runs enforce the check normally.
  const bootstrapResult = await bootstrap({octokit: writerOctokit, owner, repo})
  const justBootstrapped = bootstrapResult.created === true

  // 2. Read metadata from disk (main branch checkout).
  const allowlist = await loadAllowlist(readMetadata, allowlistPath)
  const currentRepos = await loadRepos(readMetadata, reposPath)

  // 3. Enumerate the access list across three discovery channels:
  //    - collab:  `/user/repos?affiliation=collaborator` via the user PAT (`fetchAccessList`)
  //    - owned:   fro-bot org repos via the App installation (`fetchOwnedRepos`)
  //    - contrib: operator-allowlisted cross-org repos via the App, gated on a structural
  //               `uses: fro-bot/agent@<ref>` check in `.github/workflows/fro-bot.yaml`
  //               (`fetchContribRepos`). v1 supports `approved_contrib_repos` only;
  //               `approved_contrib_orgs` is not yet enumerated (per-installation token
  //               infrastructure required, deferred to a future plan).
  //    Merge with collab > owned > contrib precedence so a collab entry wins on overlap and
  //    `validateAccessList` (which rejects duplicates) doesn't throw.
  const collabAccess = await fetchAccessList(userOctokit)
  const owned = await fetchOwnedRepos(discoveryOctokit, owner, logger)
  const contrib = await fetchContribRepos(discoveryOctokit, allowlist, logger)
  // A partial access list cannot prove that anything is no longer pending, so the rename close pass
  // (below) needs both channels to have enumerated completely.
  const enumerationComplete = owned.complete && contrib.complete
  const {accessList, accessChannelByKey} = mergeAccessChannels({
    collab: collabAccess,
    owned: owned.entries,
    contrib: contrib.entries,
  })

  // 4. For each tracked entry missing from the access list, probe `GET /repos/{o}/{r}`.
  const perRepoStatus = await fetchPerRepoStatus(userOctokit, currentRepos, accessList, logger)

  // 5. Field probes for still-accessible tracked entries.
  const fieldProbeOutcome = await fetchFieldProbes(userOctokit, currentRepos, accessList, logger)
  const fieldProbes = fieldProbeOutcome.probes
  const probesFailed = fieldProbeOutcome.failed

  // 6. Run the pure engine to produce the change plan, guarded against stranding wiki pages.
  const lookupWikiPage = async (slug: string): Promise<WikiPageState> =>
    lookupRepoWikiPage({octokit: writerOctokit, owner, repo, branch: 'data', slug})
  // Replaced by each commit attempt's re-plan, so everything after the commit uses the plan
  // that was actually written (or, for a no-op or never-run commit, the last one computed).
  let guarded = await planWithWikiGuard(
    {currentRepos, accessList, perRepoStatus, allowlist, fieldProbes, accessChannelByKey, now},
    lookupWikiPage,
  )
  let plan = guarded.plan

  // Floor telemetry — counts-only, no per-repo identifiers (security invariant: see
  // docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md).
  // Telemetry is best-effort: a logger failure must never abort the scheduled reconcile
  // run, since the substantive engine work (classification, dispatch planning) has
  // already completed by this point.
  if (plan.summary.flooredDispatches > 0) {
    const thresholdYield = plan.dispatches.length - plan.summary.flooredDispatches
    try {
      logger.warn(formatFloorTelemetry(plan.summary.flooredDispatches, thresholdYield))
    } catch (error) {
      // Telemetry is best-effort; substantive engine work has already completed by this
      // point. A breadcrumb to stderr preserves visibility of programmer errors (e.g. a
      // future refactor that makes `logger` undefined) without aborting the scheduled run.
      console.error('reconcile: floor telemetry emission failed', error)
    }
  }

  // Stuck-candidate telemetry — counts-only, no per-repo identifiers (security invariant:
  // see docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md).
  // Emitted only when stuckCandidates > 0 to keep quiet runs noise-free.
  // Telemetry is best-effort: a logger failure must never abort the scheduled reconcile run.
  if (plan.summary.stuckCandidates > 0) {
    try {
      logger.warn(formatStuckTelemetry(plan.summary.stuckCandidates))
    } catch (error) {
      console.error('reconcile: stuck-candidate telemetry emission failed', error)
    }
  }

  const hasChanges = planHasChanges(plan)
  let integrityCheck: 'ok' | 'skipped-no-data-branch' | 'skipped-just-bootstrapped' = 'ok'
  let committed = false

  // 7. Integrity check on every run, before any commit: the tip author and the `data` rules
  //    fail closed. Skipped entirely when `data` was just bootstrapped this run: its tip commit
  //    is inherited from `main` and is by definition authored by whoever merged the most recent
  //    PR, not `fro-bot[bot]`. The check activates on the next run after fro-bot commits.
  if (justBootstrapped) {
    integrityCheck = 'skipped-just-bootstrapped'
  } else {
    const integrity = await verifyDataBranchIntegrity({writerOctokit, owner, repo})
    if (!integrity.ok) {
      await fileIntegrityAlert({writerOctokit, owner, repo, failure: integrity, logger})
      throw new ReconcileError({
        code: 'DATA_BRANCH_TAMPER',
        message: describeIntegrityFailure(integrity),
        remediation: INTEGRITY_REMEDIATION,
      })
    }
    integrityCheck = integrity.status
  }

  if (hasChanges) {
    // 8. Commit via mutator closure. Mutator re-runs reconcileRepos on each invocation,
    //    so 409-retry in commitMetadata absorbs concurrent writes correctly.
    const commitResult = await commitMetadataImpl({
      octokit: writerOctokit,
      path: reposPath,
      // Read by `commitMetadata` when it writes, after the mutator has re-planned, so the message
      // describes the plan that is persisted rather than the pre-commit one.
      get message() {
        return formatCommitMessage(guarded.plan.summary)
      },
      mutator: async currentParsed => {
        assertReposFile(currentParsed, 'repos')
        // Re-verify data-branch integrity inside the mutator to close the TOCTOU window
        // between the initial check (step 7) and the first commit attempt. Each 409 retry
        // also re-verifies, catching any tamper that lands during the retry loop. Skipped
        // on bootstrap runs for the same reason as the initial check.
        if (!justBootstrapped) {
          const retryIntegrity = await verifyDataBranchIntegrity({writerOctokit, owner, repo})
          if (!retryIntegrity.ok) {
            await fileIntegrityAlert({writerOctokit, owner, repo, failure: retryIntegrity, logger})
            throw new ReconcileError({
              code: 'DATA_BRANCH_TAMPER',
              message: `${describeIntegrityFailure(retryIntegrity)} (during commit retry)`,
              remediation: INTEGRITY_REMEDIATION,
            })
          }
        }
        // Recomputed against the fresh snapshot and data tree on every attempt.
        guarded = await planWithWikiGuard(
          {currentRepos: currentParsed, accessList, perRepoStatus, allowlist, fieldProbes, accessChannelByKey, now},
          lookupWikiPage,
        )
        return guarded.plan.nextRepos
      },
    })
    committed = commitResult.committed
  }

  // From here on, only the final guarded plan is used: dispatches, issues, reporting.
  plan = guarded.plan
  const wikiGuard = guarded.wikiGuard
  // Counts-only (no names, slugs, or paths): this line lands in public workflow logs.
  if (wikiGuard.kept > 0) {
    logger.warn(
      `reconcile: kept ${wikiGuard.kept} public repo name(s) unchanged because a rename or merge would strand a wiki page (${wikiGuard.unverifiable} unverifiable); repair the old wiki pages, then rerun`,
    )
  }

  // Counts-only: pending renames are named by node-ID issues, never by this public log.
  if (plan.pendingRenames.length > 0) {
    logger.info(
      `reconcile: ${plan.pendingRenames.length} rename(s) pending operator action; excluded from survey dispatch`,
    )
  }

  // 9. Dispatch loop. Prioritize candidates with null `last_survey_at` first
  //    (never surveyed), then oldest `last_survey_at` first. Cap at
  //    `maxDispatchesPerRun` so a single run stays inside the workflow job budget and
  //    bounds peak concurrent surveys against the shared upstream seat. Deferred
  //    candidates become eligible again on the next run via the staleness gate.
  //    The exclusion predicate (pending rename or blocked transfer) is applied to the final list here, after
  //    the planner, regain and pending branches have all pushed, so no path can survey an excluded node.
  const dispatchCandidates = dropExcludedDispatches(plan.dispatches, new Set(plan.excludedNodeIds))
  const prioritizedDispatches = prioritizeDispatches(dispatchCandidates, plan.nextRepos.repos)
  const dispatchCap = maxDispatchesPerRun > 0 ? maxDispatchesPerRun : prioritizedDispatches.length

  // Rotate within the never-surveyed (null last_survey_at) leading group so that all
  // pending repos cycle through dispatch slots across successive runs. Without rotation,
  // repos that sort alphabetically earlier always fill the cap first, leaving later-
  // sorting repos perpetually deferred when the cap is smaller than the null group.
  const repoSurveyMap = new Map(plan.nextRepos.repos.map(r => [`${r.owner}/${r.name}`, r.last_survey_at]))
  const nullGroupSize = prioritizedDispatches.filter(
    d => (repoSurveyMap.get(`${d.owner}/${d.repo}`) ?? null) === null,
  ).length
  const dayOrdinal = Math.floor(now.getTime() / 86_400_000)
  const nullOffset = nullGroupSize > 1 ? dayOrdinal % nullGroupSize : 0
  const rotatedDispatches =
    nullOffset > 0
      ? [
          ...prioritizedDispatches.slice(nullOffset, nullGroupSize),
          ...prioritizedDispatches.slice(0, nullOffset),
          ...prioritizedDispatches.slice(nullGroupSize),
        ]
      : prioritizedDispatches

  const selectedDispatches = rotatedDispatches.slice(0, dispatchCap)
  const dispatchesDeferred = prioritizedDispatches.length - selectedDispatches.length

  // Index entries by key so the dispatch loop and the byChannel breakdown can resolve
  // per-dispatch channel + last_survey_at without scanning nextRepos repeatedly.
  const entryByKey = new Map(plan.nextRepos.repos.map(r => [`${r.owner}/${r.name}`, r]))

  // Populate per-channel dispatch + deferred counts. The selected slice fires this run;
  // the deferred slice (rotatedDispatches[dispatchCap..]) waits for next run.
  for (const d of selectedDispatches) {
    const entry = entryByKey.get(`${d.owner}/${d.repo}`)
    plan.summary.byChannel[entry?.discovery_channel ?? 'collab'].dispatched += 1
  }
  for (const d of rotatedDispatches.slice(dispatchCap)) {
    const entry = entryByKey.get(`${d.owner}/${d.repo}`)
    plan.summary.byChannel[entry?.discovery_channel ?? 'collab'].deferred += 1
  }

  const dispatchOutcome = await runDispatches({
    staggerMs: dispatchStaggerMs,
    sleep: params.dispatchSleep,
    writerOctokit,
    owner,
    repo,
    workflowFile,
    workflowRef,
    dispatches: selectedDispatches,
    timeoutMs: dispatchTimeoutMs,
    logger,
    entryByKey,
  })

  // 10. Issue-creation loop (serial, non-blocking on failure).
  const issueOutcome = await runIssueQueue({
    writerOctokit,
    owner,
    repo,
    issues: plan.issues,
    logger,
  })

  // 11. Auto-close stale `reconcile:pending-review` issues.
  const closedRenamePendingIssues =
    probesFailed > 0 || !enumerationComplete
      ? 0
      : await autoCloseResolvedRenameIssues({
          writerOctokit,
          owner,
          repo,
          pendingNodeIds: new Set(plan.pendingRenames),
          logger,
        })
  const closedStaleIssues = await autoCloseStaleIssues({
    writerOctokit,
    owner,
    repo,
    nextRepos: plan.nextRepos,
    accessList,
    logger,
  })

  // 12. Self-healing rollup re-file.
  // Build the set of rollup owners attempted by runIssueQueue this run. We use "attempted"
  // (not "succeeded") so that even a transient create failure suppresses self-heal for this
  // run — a failed create is safer to retry on the next cron than to risk a duplicate now.
  // The GitHub Issues listing API has eventual-consistency lag: a rollup POSTed in step 10
  // may not appear in a subsequent listForRepo call, causing selfHealRollups to re-create it.
  const currentRunRollupOwners = new Set(
    plan.issues.filter(issue => issue.kind === 'per-owner-rollup').map(issue => issue.owner),
  )
  const {created: healedRollups, raceSuppressed} = await selfHealRollups({
    writerOctokit,
    owner,
    repo,
    nextRepos: plan.nextRepos,
    accessList,
    allowlist,
    logger,
    currentRunRollupOwners,
  })
  plan.summary.raceSuppressedRollups = raceSuppressed

  // 13. Star sync — star collab/contrib repos not yet starred by @fro-bot. Non-blocking:
  //     failures increment starFailures and the run still returns. Owned repos are excluded
  //     (fro-bot owns them; self-starring is pointless). A star is a user action — uses
  //     userOctokit (FRO_BOT_POLL_PAT), never an App client. Counts-only telemetry.
  const starCandidates = accessList.filter(entry => {
    const channel = accessChannelByKey.get(`${entry.owner}/${entry.name}`)
    return channel === 'collab' || channel === 'contrib'
  })
  const starOutcome = await syncStars({
    userOctokit,
    candidates: starCandidates.map(e => ({owner: e.owner, name: e.name})),
    logger,
  })

  // Star telemetry — counts-only, no per-repo identifiers. Best-effort: a logger failure
  // must never abort the reconcile run.
  if (starOutcome.starsAdded > 0 || starOutcome.starFailures > 0) {
    try {
      if (starOutcome.starFailures > 0) {
        logger.warn(
          `reconcile: star sync complete (starsAdded=${starOutcome.starsAdded}, starFailures=${starOutcome.starFailures})`,
        )
      } else {
        logger.info(`reconcile: star sync complete (starsAdded=${starOutcome.starsAdded})`)
      }
    } catch (error) {
      console.error('reconcile: star sync telemetry emission failed', error)
    }
  }

  return {
    accessListSize: accessList.length,
    summary: plan.summary,
    dispatches: dispatchOutcome.succeeded,
    dispatchesFailed: dispatchOutcome.failed,
    dispatchesDeferred,
    perRepoIssues: issueOutcome.perRepoSucceeded,
    rollupIssues: issueOutcome.rollupSucceeded + healedRollups,
    visibilityTransitionIssues: issueOutcome.visibilityTransitionSucceeded,
    visibilityTransitionDuplicatesSkipped: issueOutcome.visibilityTransitionDuplicatesSkipped,
    renamePendingIssues: issueOutcome.renamePendingSucceeded,
    renamePendingDuplicatesSkipped: issueOutcome.renamePendingDuplicatesSkipped,
    renamesPending: plan.pendingRenames.length,
    transferBlocked: plan.summary.transferBlocked,
    closedRenamePendingIssues,
    issuesFailed: issueOutcome.failed,
    closedStaleIssues,
    probesFailed,
    integrityCheck,
    committed,
    starsAdded: starOutcome.starsAdded,
    starsAlreadyPresent: starOutcome.starsAlreadyPresent,
    starFailures: starOutcome.starFailures,
    wikiGuardKept: wikiGuard.kept,
    wikiGuardUnverifiable: wikiGuard.unverifiable,
  }
}

/**
 * Plan a reconcile run without stranding wiki pages. Plans a candidate, finds public names it
 * would remove whose old page exists (or cannot be checked), and re-plans with those names
 * protected. Re-checks the guarded plan until no unprotected removal remains. Page lookups are
 * cached by slug for the whole call, and a lookup failure counts as unverifiable (kept).
 */
async function planWithWikiGuard(
  input: ReconcileInput,
  lookup: (slug: string) => Promise<WikiPageState>,
): Promise<{plan: ReconcileResult; wikiGuard: {kept: number; unverifiable: number}}> {
  const lookups = new Map<string, Promise<WikiPageState>>()
  const cachedLookup = async (slug: string): Promise<WikiPageState> => {
    const cached = lookups.get(slug)
    if (cached !== undefined) return cached
    const pending = lookup(slug)
    lookups.set(slug, pending)
    return pending
  }

  let plan = reconcileRepos(input)
  const protectedAssociations = new Set<string>()
  const unverifiable = new Set<string>()
  for (;;) {
    const blocked = await findBlockedPublicAssociations({
      previous: input.currentRepos,
      next: plan.nextRepos,
      lookup: cachedLookup,
    })
    const added = [...blocked.present, ...blocked.unverifiable].filter(
      association => !protectedAssociations.has(association),
    )
    if (added.length === 0) break
    for (const association of added) protectedAssociations.add(association)
    for (const association of blocked.unverifiable) unverifiable.add(association)
    plan = reconcileRepos({...input, protectedPublicAssociations: protectedAssociations})
  }

  // Counted from the final plan: a protected name only counts when it actually survived.
  const kept = new Set(
    plan.nextRepos.repos
      .filter(entry => entry.private === false)
      .map(entry => publicAssociationKey(entry.owner, entry.name))
      .filter(association => protectedAssociations.has(association)),
  )
  return {
    plan,
    wikiGuard: {kept: kept.size, unverifiable: [...kept].filter(association => unverifiable.has(association)).length},
  }
}

/**
 * Order dispatch candidates by survey freshness: repos that have never been surveyed go
 * first, then oldest `last_survey_at` first. Ties break on `owner/name` for determinism
 * so the cap selects the same slice across reruns.
 */
function prioritizeDispatches(dispatches: DispatchRequest[], nextRepos: ReposFile['repos']): DispatchRequest[] {
  const lookup = new Map<string, string | null>()
  for (const entry of nextRepos) {
    lookup.set(`${entry.owner}/${entry.name}`, entry.last_survey_at)
  }

  return [...dispatches].sort((left, right) => {
    const leftKey = `${left.owner}/${left.repo}`
    const rightKey = `${right.owner}/${right.repo}`
    const leftAt = lookup.get(leftKey) ?? null
    const rightAt = lookup.get(rightKey) ?? null
    return compareBySurveyFreshness(leftAt, rightAt, leftKey, rightKey)
  })
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
    summary.migrated > 0 ||
    summary.renamed > 0 ||
    summary.merged > 0 ||
    plan.dispatches.length > 0 ||
    // Rename reports are issue-only: they never change metadata, so they don't warrant a data-branch write.
    plan.issues.some(issue => issue.kind !== 'rename-pending')
  )
}

/**
 * Format the reconcile commit message. The `+N migrated` suffix appears only when
 * `summary.migrated > 0` so steady-state runs keep the existing format and operators
 * can spot the one-time migration commit easily.
 */
export function formatCommitMessage(summary: ReconcileSummary): string {
  const base = `chore(reconcile): +${summary.added} new, ${summary.pendingReview} pending-review, ${summary.lostAccess} lost-access, ${summary.refreshed} refreshes`
  const suffixes = [
    summary.migrated > 0 ? `+${summary.migrated} migrated` : undefined,
    summary.renamed > 0 ? `+${summary.renamed} renamed` : undefined,
    summary.merged > 0 ? `+${summary.merged} merged` : undefined,
  ].filter((suffix): suffix is string => suffix !== undefined)
  return suffixes.length > 0 ? `${base}, ${suffixes.join(', ')}` : base
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

async function createOctokitFromEnv(
  envVar: 'FRO_BOT_POLL_PAT' | 'RECONCILE_DISCOVERY_TOKEN' | 'RECONCILE_WRITER_TOKEN',
): Promise<OctokitClient> {
  try {
    return await createOctokit(process.env[envVar], {
      missingToken: () =>
        new ReconcileError({
          code: 'MISSING_TOKEN',
          message: `reconcileRepos requires ${envVar} in the environment`,
          remediation: `Export ${envVar} before invocation. See .github/workflows/reconcile-repos.yaml for how this is mounted.`,
        }),
    })
  } catch (error: unknown) {
    if (!(error instanceof OctokitLoadError)) throw error
    throw new ReconcileError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }
}
