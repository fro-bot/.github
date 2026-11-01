/**
 * Pure reconciliation engine for `metadata/repos.yaml`.
 *
 * Given a snapshot of what fro-bot currently tracks and a snapshot of its actual GitHub
 * collaborator reality, produces the next metadata state plus the side-effect plan
 * (dispatches to queue, pending-review issues to file, summary counters). No I/O happens
 * here; `reconcile-handler.ts` turns the plan into API calls.
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
 */

import {
  NODE_ID_PATTERN,
  type AllowlistFile,
  type DiscoveryChannel,
  type OnboardingStatus,
  type RepoEntry,
  type ReposFile,
} from '@fro.bot/wiki-write-core/schemas'
import {publicAssociationKey} from './metadata-wiki-rename-guard.ts'
import {
  addRepoEntry,
  CHANNEL_INTERVAL_DAYS,
  computeNextEligibleAt,
  JITTER_MAX_DAYS,
  normalizeRepoEntryForStorage,
} from './repos-metadata.ts'

/**
 * Whether a discovery-channel + access-list combination is pre-trusted (skips the
 * `pending-review` issue path that exists for non-allowlisted collab newcomers).
 *
 * Trust derivation:
 * - `owned` — fro-bot's own org repos, trusted by ownership.
 * - `contrib` — surfaced via `metadata/allowlist.yaml` allowlist + content-verified probe.
 * - `collab` — collab access AND owner is in `approved_inviters`. Otherwise pending-review.
 *
 * Load-bearing for the security boundary: the same predicate runs at Pass 2 newcomer
 * insertion AND the regain transition. Extracted to one place so a future change to the
 * trust contract can't drift between the two sites.
 */
function isTrustedChannel(channel: DiscoveryChannel, owner: string, allowlistedOwners: Set<string>): boolean {
  if (channel === 'owned' || channel === 'contrib') return true
  return allowlistedOwners.has(owner)
}

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

interface AccessNodePrivacy {
  count: number
  hasNonPublic: boolean
}

/**
 * Result of probing a single tracked repo's status via `GET /repos/{owner}/{name}`.
 *
 * - `deleted`          — HTTP 404 (repo gone).
 * - `archived`         — Pass‑1 detection from the access-list `archived` field (not a probe result).
 * - `revoked`          - HTTP 451 (DMCA/takedown) or HTTP 403 (blocked/suspended), or the
 *                        repo exists (HTTP 200) but the entry is not in the access list.
 * - `still-accessible` — HTTP 200 with valid body; the entry is in the access list (produced
 *                        by the field‑probe pass, not `fetchPerRepoStatus`).
 * - `transient`        — HTTP 5xx or network error; could not determine status this run.
 *                        Sticky‑preserve the prior state.
 * - `malformed`        — HTTP 200 but the response body is missing `private` (boolean) or
 *                        `node_id` (string). Sticky‑preserve the prior state and log a diagnostic.
 */
export type RepoStatusProbe =
  | {status: 'deleted'}
  | {status: 'archived'}
  | {status: 'revoked'}
  | {status: 'still-accessible'; private: boolean; node_id: string}
  | {status: 'transient'; httpStatus?: number}
  | {status: 'malformed'}

export interface FieldProbe {
  has_fro_bot_workflow: boolean
  has_renovate: boolean
  /**
   * Numeric REST `repository.id` (GitHub's `databaseId`). Captured from the per-repo
   * field probe alongside `isPrivate`/`node_id`. Optional: absent when the probe did not
   * return a positive integer (e.g. the API response omitted the field or returned null).
   *
   * Like node_id, this promotes to main with the entry but must NEVER be embedded in a
   * rendered/logged public surface (issue text, commit message, log line). The metadata
   * writer persists this onto redacted entries so the denylist secondary guard is
   * format-independent.
   */
  database_id?: number
  /** Identity returned by probing the stored owner/name, including rename resolution. */
  identity?: RepoIdentityProbe
}

export interface RepoIdentityProbe {
  returned_node_id: string
  returned_owner?: string
  returned_name?: string
  resolution: 'matched' | 'resolved' | 'unresolvable' | 'transient'
  resolved_owner?: string
  resolved_name?: string
}

export interface ReconcileInput {
  currentRepos: ReposFile
  accessList: AccessListEntry[]
  /** Map key format: `${owner}/${name}` (exact). Populated only for tracked repos not in the access list. */
  perRepoStatus: Map<string, RepoStatusProbe>
  allowlist: AllowlistFile
  /** Map key format: `${owner}/${name}` (exact). Populated only for still-accessible tracked repos. */
  fieldProbes: Map<string, FieldProbe>
  /**
   * Map key format: `${owner}/${name}` (exact). Records which discovery channel surfaced
   * each access-list entry. Missing keys default to `'collab'` so existing single-channel
   * callers (collab-only) and tests work unchanged. The shell builds this map by tagging
   * `/user/repos` results as `'collab'`, fro-bot org repos as `'owned'`, and allowlist-
   * surfaced contrib repos as `'contrib'`.
   */
  accessChannelByKey?: Map<string, DiscoveryChannel>
  /**
   * Normalized (`owner/name`, lowercase) public associations whose old wiki page still exists or
   * could not be checked. A tracked row whose classified result is still public keeps its previous
   * owner/name instead of being renamed or merged away; refreshed fields and ID enrichment still
   * apply. Private/unknown results bypass protection, so a public name is never resurrected.
   */
  protectedPublicAssociations?: ReadonlySet<string>
  now: Date
}

export interface DispatchRequest {
  owner: string
  repo: string
  /**
   * GitHub GraphQL `node_id` of the target repository. Surfaced to `workflow_dispatch`
   * inputs as the sole identifier — the Survey Repo workflow resolves it back to
   * `owner/repo` via GraphQL after verifying `isPrivate === false`. Keeping `owner`
   * and `repo` here for internal telemetry (logger info lines, prioritization) is
   * fine; only the `inputs` payload is a public surface.
   */
  node_id: string
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

/**
 * Visibility-transition integrity alert. Queued when a tracked entry's stored `private`
 * flag flips from `false` to `true` (including via `access-lost`, which fails closed as
 * private per Unit 2 semantics). Title and body use `node_id` only — no `owner/repo` —
 * because this issue stream is public. Operators look up the canonical name locally via
 * the operator tool.
 */
export interface VisibilityTransitionIssue {
  kind: 'visibility-transition'
  node_id: string
}

/**
 * Operator issue for a tracked public repo that was renamed on GitHub. Reconcile only detects
 * renames; the operator applies one by dispatching `rename-tracked-repo.yaml`. Title and body use
 * `node_id` only — no `owner/repo` — and the issue is closed once the node is no longer pending.
 */
export interface RenamePendingIssue {
  kind: 'rename-pending'
  node_id: string
}

export type IssueQueueEntry = PerRepoIssue | PerOwnerRollupIssue | VisibilityTransitionIssue | RenamePendingIssue

/**
 * Per-channel breakdown of reconcile activity for one run. Operators read these to
 * answer "how much did each channel contribute today?" without aggregating manually.
 *
 * - `tracked`: entries on `nextRepos` carrying this channel after the run.
 * - `dispatched`: dispatches actually fired this run (post-cap, post-rotation).
 * - `deferred`: dispatch candidates excluded by the per-run cap. Sums to
 *   `dispatchesDeferred` across all channels.
 * - `lostAccess`: entries that flipped to `lost-access` this run.
 *
 * The shell populates `dispatched` and `deferred` after cap selection. The engine
 * populates `tracked` and `lostAccess`.
 */
export interface ChannelStats {
  tracked: number
  dispatched: number
  deferred: number
  lostAccess: number
}

export interface ReconcileSummary {
  added: number
  pendingReview: number
  regained: number
  lostAccess: number
  /**
   * Number of entries whose probed fields (`has_fro_bot_workflow`, `has_renovate`) drifted
   * from the live signal and were rewritten this run. Steady-state field-probe drift only.
   */
  refreshed: number
  /**
   * Number of legacy entries backfilled this run (missing `discovery_channel` or
   * `next_survey_eligible_at` populated by {@link migrateRepoEntry}). Distinct from
   * `refreshed` so operators can tell one-time migration commits from steady-state
   * field-probe drift. Drops to zero on the next run after migration completes.
   */
  migrated: number
  /**
   * Retained for output compatibility. Reconcile no longer applies renames (it reports them as
   * pending; see {@link ReconcileResult.pendingRenames}), so this is always 0.
   */
  renamed: number
  /** Number of duplicate node_id/database_id rows removed by deterministic merge. */
  merged: number
  /** Number of node-ID-preserving owner transfers rejected by the rename trust gate. */
  transferBlocked: number
  unchanged: number
  /**
   * Number of tracked entries whose probe returned a `transient` classification this run
   * (HTTP 5xx, network error, or rate-limit). The entry's prior privacy state is
   * sticky-preserved; no fields are written. A non-zero value paired with a quiet
   * `refreshed`/`lostAccess` indicates the run took the sticky-preserve path on probe
   * failures rather than completing classification — distinguishes a healthy quiet day
   * from an API-incident silent-degradation day.
   */
  transient: number
  /**
   * Number of tracked entries whose probe returned `malformed` (HTTP 200 with an
   * unusable response body) this run. Sticky-preserved like `transient`. Persistent
   * non-zero values across runs suggest an upstream API contract change worth investigating.
   */
  malformed: number
  /**
   * Number of dispatch-capable entries skipped before survey eligibility because their
   * stored or live privacy state was not definitively public. Operational counter only:
   * it does not imply a metadata change by itself.
   */
  skippedPrivate: number
  /**
   * Number of floor candidates added to the dispatch pool. May exceed the count that
   * actually dispatched if the per-run cap cut some — operators interpreting this
   * alongside `dispatches` should remember the engine produces this count before cap
   * enforcement (which lives in the I/O shell).
   *
   * This is a global counter and does NOT split per-channel. The floor is a global
   * property of the run, not a per-channel property; {@link byChannel} tracks activity
   * by discovery channel but the floor's contribution is not attributed to any single
   * channel. The design decision is captured in the implementation plan's "Deferred to
   * Implementation" section.
   *
   * Zero on quiet days when the threshold met or exceeded {@link FLOOR_MIN}, and on
   * droughts where every tracked repo is inside {@link FLOOR_MIN_GAP_DAYS}.
   */
  flooredDispatches: number
  /**
   * Number of tracked entries whose stored `private` flag flipped from `false` to `true`
   * (including via `access-lost`, which fails closed as private) this run. Each transition
   * queues a `reconcile:visibility-transition` integrity-alert issue for manual operator
   * review. Private-to-public transitions emit no alert; the next mutator write
   * recanonicalizes the entry.
   */
  visibilityTransitions: number
  /**
   * Number of per-owner rollup issues skipped by {@link selfHealRollups} because the owner
   * was already processed earlier in THIS same reconcile run (the eventual-consistency guard).
   * Distinct from owners skipped because a rollup already existed on GitHub from a prior run —
   * those are silent skips with no counter. A non-zero value means the in-process guard fired:
   * the same-run listForRepo lag was present and suppression prevented a duplicate create.
   */
  raceSuppressedRollups: number
  /**
   * Per-channel activity breakdown. See {@link ChannelStats} for field semantics. The
   * engine populates `tracked` and `lostAccess`; the shell populates `dispatched` and
   * `deferred` after cap selection.
   */
  byChannel: Record<DiscoveryChannel, ChannelStats>
  /**
   * Number of `onboarded` entries whose `last_survey_at` has not advanced past the
   * normal cadence threshold ({@link STUCK_STALENESS_DAYS} days). A non-zero value
   * across consecutive runs is the signal to investigate the cancel-before-resolve
   * window where a survey never records a result and the floor keeps re-selecting it.
   *
   * Derived stateless at reconcile time from existing metadata — no new schema field.
   * Counts only `onboarded` entries; `pending`, `pending-review`, and `lost-access`
   * entries are excluded (different dispatch paths or already out of rotation).
   * A `null` `last_survey_at` on an `onboarded` entry counts as stuck (onboarded but
   * never successfully surveyed).
   */
  stuckCandidates: number
}

export interface ReconcileResult {
  nextRepos: ReposFile
  dispatches: DispatchRequest[]
  issues: IssueQueueEntry[]
  summary: ReconcileSummary
  /** Node IDs of tracked public repos renamed on GitHub. Reported only; no row is renamed. */
  pendingRenames: string[]
  /**
   * Node IDs that must never be surveyed: pending renames and blocked transfers. Applied to the
   * planner's own dispatch list and floor, and again to the final dispatch list in `handleReconcile`.
   */
  excludedNodeIds: string[]
}

/** Stored owner of a private repo; its `name` holds the node ID instead. */
const REDACTED_OWNER = '[REDACTED]'

/**
 * Minimum number of dispatches the reconcile engine targets per run. When the threshold
 * gate (per-channel `next_survey_eligible_at`) yields fewer than this many candidates,
 * the floor fires and tops up the dispatch list with the oldest-surveyed tracked repos
 * that pass the same fail-closed privacy gate.
 *
 * The floor exists because the channel-cycle math (collab=30d, owned=14d, contrib=21d)
 * inevitably clusters into multi-day silences when populations bunch. Without a floor,
 * the wiki goes quiet for ~20 days at a time. With it, continuous knowledge growth is
 * decoupled from cluster timing.
 *
 * The floor is additive — threshold remains the ceiling, the per-run cap
 * ({@link DEFAULT_MAX_DISPATCHES_PER_RUN}) still bounds the upper end, and the dispatch
 * stagger still applies. See `docs/plans/2026-05-17-001-feat-survey-cadence-minimum-floor-plan.md`.
 */
const FLOOR_MIN = 2

/**
 * Minimum gap (in days) between any two surveys of the same repo when the floor fires.
 * A tracked repo surveyed within this window is excluded from the floor pool so the
 * floor cannot ping-pong the same repo on consecutive days.
 *
 * Strict-greater-than semantics: a repo surveyed exactly `FLOOR_MIN_GAP_DAYS` days ago
 * (down to the day boundary) is still inside the gap; only repos surveyed more than
 * `FLOOR_MIN_GAP_DAYS` days ago are eligible.
 */
const FLOOR_MIN_GAP_DAYS = 7

/**
 * Format the floor-fired telemetry message.
 *
 * Extracted so the message shape can be unit-tested independently of the I/O shell.
 * Security invariant: the message must contain only aggregate counts — no owner, repo
 * name, or node_id (see docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md).
 */
export function formatFloorTelemetry(flooredDispatches: number, thresholdYield: number): string {
  return `floor fired: dispatched ${flooredDispatches} of FLOOR_MIN=${FLOOR_MIN} (threshold yielded ${thresholdYield})`
}

/**
 * Staleness threshold (in whole UTC days) for the stuck-candidate detector.
 *
 * Derivation: longest channel base interval (collab = 30d) + grace margin.
 * Grace must be strictly greater than JITTER_MAX_DAYS (3d) so a repo on normal
 * collab cadence at maximum jitter (30d + 3d = 33d) never trips the detector.
 * A grace of 7d gives STUCK_STALENESS_DAYS = 37d, providing a comfortable buffer
 * above the 33d worst-case normal cadence while remaining sensitive to genuinely
 * stuck repos (those whose last_survey_at has not advanced across multiple runs).
 */
const STUCK_GRACE_DAYS = JITTER_MAX_DAYS + 4

// 3 + 4 = 7; strictly > JITTER_MAX_DAYS
const STUCK_STALENESS_DAYS = CHANNEL_INTERVAL_DAYS.collab + STUCK_GRACE_DAYS

// 30 + 7 = 37

/**
 * Format the stuck-candidate telemetry message.
 *
 * Extracted so the message shape can be unit-tested independently of the I/O shell.
 * Security invariant: the message must contain only aggregate counts — no owner, repo
 * name, or node_id. Mirrors {@link formatFloorTelemetry}.
 */
export function formatStuckTelemetry(stuckCandidates: number): string {
  return `stuck candidates: ${stuckCandidates} onboarded repo(s) past staleness threshold`
}

/**
 * Compare two dispatch candidates by survey freshness for oldest-first ordering.
 *
 * Rules (identical to the comparator inside {@link prioritizeDispatches}):
 * 1. `null` (never surveyed) sorts before any date string.
 * 2. Earlier date strings sort before later ones (ascending `last_survey_at`).
 * 3. Tiebreak: lexicographic on the pre-computed `repoKey` strings.
 *
 * Accepts primitives so it can be used from both the floor sort (which operates on
 * `{entry: RepoEntry; access: AccessListEntry}[]`) and `prioritizeDispatches` (which
 * operates on `DispatchRequest[]`).
 */
export function compareBySurveyFreshness(
  leftAt: string | null,
  rightAt: string | null,
  leftKey: string,
  rightKey: string,
): number {
  if (leftAt === null && rightAt !== null) return -1
  if (rightAt === null && leftAt !== null) return 1
  if (leftAt !== null && rightAt !== null && leftAt !== rightAt) return leftAt.localeCompare(rightAt)
  return leftKey.localeCompare(rightKey)
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
  const accessChannelByKey = input.accessChannelByKey ?? new Map<string, DiscoveryChannel>()

  validateAccessList(accessList)

  const accessByKey = indexAccessList(accessList)
  const accessByNodeId = indexAccessListByNodeId(accessList)
  const accessNodePrivacy = indexAccessNodePrivacy(accessList)
  const allowlistedOwners = new Set(allowlist.approved_inviters.map(i => i.username))

  // Renames and transfers are detected, never applied. One exclusion set (pending rename or blocked
  // transfer) is computed here and filters every dispatch path below plus the floor.
  const detection = detectRenames({rows: currentRepos.repos, accessList, fieldProbes})
  const transferKeys = new Set(detection.transfers.map(change => change.key))
  const pendingRenames = [...new Set(detection.pending.map(change => change.node_id))]
  const excludedNodeIds = new Set([...pendingRenames, ...detection.transfers.map(change => change.node_id)])

  const summary: ReconcileSummary = {
    added: 0,
    pendingReview: 0,
    regained: 0,
    lostAccess: 0,
    refreshed: 0,
    migrated: 0,
    renamed: 0,
    merged: 0,
    transferBlocked: 0,
    unchanged: 0,
    transient: 0,
    malformed: 0,
    skippedPrivate: 0,
    flooredDispatches: 0,
    visibilityTransitions: 0,
    raceSuppressedRollups: 0,
    stuckCandidates: 0,
    byChannel: {
      collab: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
      owned: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
      contrib: {tracked: 0, dispatched: 0, deferred: 0, lostAccess: 0},
    },
  }
  const dispatches: DispatchRequest[] = []
  const rawIssues: RawIssue[] = []
  const transitionIssues: VisibilityTransitionIssue[] = []

  // Pass 1 — classify every tracked entry against the access list and probes.
  const trackedKeys = new Set<string>()
  const protectedAssociations = input.protectedPublicAssociations
  let nextEntries: RepoEntry[] = currentRepos.repos.map(entry => {
    const key = repoKey(entry.owner, entry.name)
    trackedKeys.add(key)
    const before = {renamed: summary.renamed, refreshed: summary.refreshed}
    const classified = classifyTracked({
      entry,
      key,
      accessByKey,
      accessByNodeId,
      accessNodePrivacy,
      accessChannelByKey,
      perRepoStatus,
      fieldProbes,
      allowlistedOwners,
      transferKeys,
      summary,
      dispatches,
      rawIssues,
      transitionIssues,
      now,
    })
    return keepProtectedName({entry, classified, protectedAssociations, summary, before})
  })

  nextEntries = mergeDuplicateEntries(nextEntries, accessList, summary, protectedAssociations)
  const postMergeDispatches = filterDispatchesAfterMerge({
    dispatches,
    nextEntries,
    accessByNodeId,
    accessNodePrivacy,
    now,
  })
  dispatches.splice(0, dispatches.length, ...postMergeDispatches)

  // A protected repo is never surveyed under a name the guard is keeping out of the plan, and its
  // duplicate rows are skipped too (their survey write-back would hit the duplicate-identity check).
  const protectedKeys = protectedIdentityKeys(nextEntries, protectedAssociations)
  if (protectedKeys.size > 0) {
    const surveyable = dispatches.filter(dispatch => !protectedKeys.has(`node_id:${dispatch.node_id}`))
    dispatches.splice(0, dispatches.length, ...surveyable)
  }

  // Dropped before Pass 2.5 so an excluded candidate can't occupy a slot the floor should fill.
  const dispatchable = dropExcludedDispatches(dispatches, excludedNodeIds)
  dispatches.splice(0, dispatches.length, ...dispatchable)

  let next: ReposFile = {...currentRepos, repos: nextEntries}

  // Build the set of node_ids that any tracked entry already represents. This
  // guards against re-discovery: when a private repo's owner/name has been
  // redacted, the next /user/repos enumeration returns the canonical owner/name
  // again. Without this set, Pass 2 would treat that as a brand-new newcomer
  // and re-add a sibling entry under the canonical identity, undoing the
  // redaction. The set covers two shapes:
  //   1. Modern entries with `node_id` populated (post-Unit-2 reconciles).
  //   2. Legacy redacted entries where `owner === '[REDACTED]'` and the
  //      `node_id` lives in the `name` field (Phase 0 redaction shape, before
  //      a separate `node_id` field was populated on redacted entries).
  const knownNodeIds = new Set<string>()
  for (const entry of nextEntries) {
    if (entry.node_id !== undefined) {
      knownNodeIds.add(entry.node_id)
    }
    if (entry.owner === '[REDACTED]') {
      knownNodeIds.add(entry.name)
    }
  }

  // Pass 2 — add newcomers (accessible repos not yet tracked).
  for (const access of accessList) {
    const key = repoKey(access.owner, access.name)
    if (trackedKeys.has(key)) continue
    if (knownNodeIds.has(access.node_id)) continue // tracked under a different (likely redacted) identity.
    if (access.archived) continue // untracked + archived: no history worth capturing; skip silently.

    // Channel determines the trust path. Owned (we own the repo) and contrib (operator
    // explicitly listed it in metadata/allowlist.yaml's approved_contrib_*) are
    // pre-trusted — they bypass the pending-review issue path that exists for
    // non-allowlisted collab newcomers. See `isTrustedChannel` for the predicate.
    const channel = accessChannelByKey.get(key) ?? 'collab'
    const trusted = isTrustedChannel(channel, access.owner, allowlistedOwners)
    const status: OnboardingStatus = trusted ? 'pending' : 'pending-review'
    const accessPrivate = accessPrivateForStorage(access, accessNodePrivacy)

    next = addRepoEntry(next, {
      owner: access.owner,
      repo: access.name,
      now,
      private: accessPrivate,
      node_id: access.node_id,
      onboarding_status: status,
      discovery_channel: channel,
    })
    knownNodeIds.add(access.node_id)

    if (trusted) {
      summary.added += 1
      if (accessPrivate) {
        summary.skippedPrivate += 1
      } else {
        dispatches.push({owner: access.owner, repo: access.name, node_id: access.node_id})
      }
    } else {
      summary.pendingReview += 1
      rawIssues.push({
        owner: access.owner,
        repo: access.name,
        reason: 'unsolicited-new',
        private: accessPrivate,
        node_id: access.node_id,
      })
    }
  }

  // Pass 2.5 — minimum-dispatch floor.
  //
  // When the threshold gate yielded fewer than FLOOR_MIN dispatches, top up the list
  // with the oldest-surveyed tracked repos that pass the same fail-closed privacy
  // gate as the threshold path. This decouples continuous wiki growth from cluster
  // timing: when channel-cycle math bunches eligibility into one week per cycle, the
  // floor still dispatches FLOOR_MIN repos per run on the off-cycle days.
  //
  // The floor adds to `dispatches` only; cap enforcement, rotation, and per-channel
  // counting happen in the I/O shell as today. Floor dispatches look identical to
  // threshold dispatches downstream — intentional, the floor is transparent.
  if (dispatches.length < FLOOR_MIN) {
    const slotsNeeded = FLOOR_MIN - dispatches.length
    const dispatchedKeys = new Set(dispatches.map(d => repoKey(d.owner, d.repo)))
    const nowMs = now.getTime()

    const floorCandidates: {entry: RepoEntry; access: AccessListEntry}[] = []
    for (const entry of next.repos) {
      // Same eligibility universe as the threshold gate, minus the
      // `next_survey_eligible_at` check — the floor's whole job is to fire when the
      // threshold has held repos back.
      if (entry.onboarding_status !== 'onboarded' && entry.onboarding_status !== 'pending') continue
      if (entry.onboarding_status === 'pending' && entry.last_survey_status === 'success') {
        // Mirrors the threshold gate's `pending` branch: a successful pending repo
        // waits for its eligibility timestamp; the floor doesn't override that.
        continue
      }

      const key = repoKey(entry.owner, entry.name)
      if (dispatchedKeys.has(key)) continue

      // Fail-closed privacy: stored AND live access-list must agree on public, and the
      // node-level fail-closed rule (duplicate node_id, non-public alias) must clear.
      // Mirrors the `wouldDispatchIfPublic && !skippedPrivate` branch in classifyTracked.
      const access = accessForTrackedEntry(entry, key, accessByKey, accessByNodeId)
      if (access === undefined) continue
      const accessPrivate = accessPrivateForStorage(access, accessNodePrivacy)
      if (entry.private !== false || accessPrivate) continue
      if (identityKeys(entry).some(key => protectedKeys.has(key))) continue
      if (excludedNodeIds.has(access.node_id)) continue

      // Gap-days: strict greater-than on whole-day count. A repo surveyed exactly
      // FLOOR_MIN_GAP_DAYS days ago is still inside the gap; only repos surveyed
      // strictly more than FLOOR_MIN_GAP_DAYS days ago are eligible.
      //
      // We compare calendar-day counts (Math.floor of ms / 86_400_000) rather than
      // raw milliseconds so that the boundary is stable regardless of the time-of-day
      // component of `now`. E.g. NOW=2026-04-17T12:00:00Z and last_survey_at=2026-04-10
      // yields daysAgo=7 (not 7.5), which is NOT strictly greater than FLOOR_MIN_GAP_DAYS=7,
      // so the repo is correctly excluded. last_survey_at=2026-04-09 yields daysAgo=8 → IN.
      // `null` last_survey_at counts as never-surveyed = always past the gap.
      if (entry.last_survey_at !== null) {
        const surveyedMs = Date.parse(`${entry.last_survey_at}T00:00:00Z`)
        if (!Number.isFinite(surveyedMs)) continue
        const daysAgo = Math.floor((nowMs - surveyedMs) / 86_400_000)
        if (daysAgo <= FLOOR_MIN_GAP_DAYS) continue
      }

      floorCandidates.push({entry, access})
    }

    // Oldest-first: null `last_survey_at` (never surveyed) before any date, then
    // ascending by date, tiebreak on owner/name for determinism. Matches the existing
    // `prioritizeDispatches` ordering used by the threshold path.
    floorCandidates.sort((left, right) =>
      compareBySurveyFreshness(
        left.entry.last_survey_at,
        right.entry.last_survey_at,
        repoKey(left.entry.owner, left.entry.name),
        repoKey(right.entry.owner, right.entry.name),
      ),
    )

    for (const {entry, access} of floorCandidates.slice(0, slotsNeeded)) {
      // Defensive dedup against duplicate next.repos rows (data corruption). If the same
      // owner/name appears twice in the floor pool, skip the second occurrence rather than
      // dispatching the same repo twice. FLOOR_MIN is not met in that run — acceptable;
      // data corruption is a separate concern the floor should not mask.
      const key = repoKey(entry.owner, entry.name)
      if (dispatchedKeys.has(key)) continue
      dispatchedKeys.add(key)
      dispatches.push({owner: access.owner, repo: access.name, node_id: access.node_id})
      summary.flooredDispatches += 1
    }
  }

  const renameIssues: RenamePendingIssue[] = pendingRenames
    .filter(nodeId => NODE_ID_PATTERN.test(nodeId))
    .map(nodeId => ({kind: 'rename-pending', node_id: nodeId}))
  const issues: IssueQueueEntry[] = [...buildIssueQueue(rawIssues), ...transitionIssues, ...renameIssues]

  // Populate per-channel tracked counts and stuck-candidate count after both passes
  // complete. Counts entries present on `next.repos` post-classification (excludes
  // lost-access entries via the existing flow — `lost-access` entries remain in repos,
  // only their onboarding_status changes, so they still count as tracked). The plan
  // defines `tracked` as entries currently in `metadata/repos.yaml` for that channel,
  // regardless of survey status.
  //
  // Stuck-candidate detection: an `onboarded` entry whose `last_survey_at` has not
  // advanced past STUCK_STALENESS_DAYS is a stuck candidate. Uses the same whole-day
  // UTC age computation as the floor gap check (Math.floor of ms / 86_400_000) so the
  // boundary is stable regardless of the time-of-day component of `now`.
  const nowMs = now.getTime()
  for (const entry of next.repos) {
    summary.byChannel[entry.discovery_channel ?? 'collab'].tracked += 1

    if (entry.onboarding_status === 'onboarded') {
      if (entry.last_survey_at === null) {
        // Onboarded but never successfully surveyed — counts as stuck.
        summary.stuckCandidates += 1
      } else {
        const surveyedMs = Date.parse(`${entry.last_survey_at}T00:00:00Z`)
        if (Number.isFinite(surveyedMs)) {
          const daysAgo = Math.floor((nowMs - surveyedMs) / 86_400_000)
          if (daysAgo > STUCK_STALENESS_DAYS) {
            summary.stuckCandidates += 1
          }
        }
        // Malformed last_survey_at: not counted as stuck (conservative; avoids false
        // positives from data corruption that the field-probe path will surface separately).
      }
    }
  }

  // Zero-change optimization: preserve currentRepos reference identity for cheap `===` probe.
  const excluded = [...excludedNodeIds]
  if (isNoOp(summary, dispatches, issues)) {
    return {nextRepos: currentRepos, dispatches, issues, summary, pendingRenames, excludedNodeIds: excluded}
  }

  return {nextRepos: next, dispatches, issues, summary, pendingRenames, excludedNodeIds: excluded}
}

/** The single dispatch exclusion predicate: drop every candidate whose node is pending rename or transfer-blocked. */
export function dropExcludedDispatches(
  dispatches: readonly DispatchRequest[],
  excludedNodeIds: ReadonlySet<string>,
): DispatchRequest[] {
  return dispatches.filter(dispatch => !excludedNodeIds.has(dispatch.node_id))
}

export interface DetectedIdentityChange {
  /** Stored `owner/name` of the tracked row. */
  key: string
  node_id: string
}

export interface RenameDetection {
  /** Same node, same owner, different name. */
  pending: DetectedIdentityChange[]
  /** Same node, different owner. Never applied and never surveyed. */
  transfers: DetectedIdentityChange[]
}

/**
 * Pure rename/transfer detector. Considers only tracked rows that are public with a real stored
 * owner and a node ID; redacted and private rows are skipped first (they take no part in renames).
 * Evidence is the access-list entry for the row's node (when it is public and unambiguous) and the
 * identity probe of the stored name (when it returned the same node). A missing probe value is no
 * information, never a rename. An archived access entry can evidence a transfer but not a rename.
 * Owners compare case-insensitively (logins are); names compare exactly.
 */
export function detectRenames(input: {
  rows: readonly RepoEntry[]
  accessList: readonly AccessListEntry[]
  fieldProbes: ReadonlyMap<string, FieldProbe>
}): RenameDetection {
  const accessByNodeId = indexAccessListByNodeId([...input.accessList])
  const accessNodePrivacy = indexAccessNodePrivacy([...input.accessList])
  const detection: RenameDetection = {pending: [], transfers: []}

  for (const row of input.rows) {
    if (row.owner === REDACTED_OWNER || row.private !== false || row.node_id === undefined) continue
    const nodeId = row.node_id
    const access = accessByNodeId.get(nodeId)
    if (access === undefined || accessPrivateForStorage(access, accessNodePrivacy)) continue

    const key = repoKey(row.owner, row.name)
    const identity =
      input.fieldProbes.get(key)?.identity ?? input.fieldProbes.get(repoKey(access.owner, access.name))?.identity
    const observed: {owner: string; name: string}[] = [{owner: access.owner, name: access.name}]
    if (identity !== undefined) {
      if (identity.returned_node_id === nodeId && identity.resolution === 'matched') {
        if (identity.returned_owner !== undefined && identity.returned_name !== undefined) {
          observed.push({owner: identity.returned_owner, name: identity.returned_name})
        }
      } else if (
        // Same gate `classifyTracked` applies before it trusts a repaired identity: anything else
        // is a transient/unresolvable/inconsistent probe that routes to lost-access or sticky-keep.
        identity.resolution !== 'resolved' ||
        identity.resolved_owner !== access.owner ||
        identity.resolved_name !== access.name
      ) {
        continue
      }
    }

    if (observed.some(seen => seen.owner.toLowerCase() !== row.owner.toLowerCase())) {
      detection.transfers.push({key, node_id: nodeId})
    } else if (!access.archived && observed.some(seen => seen.name !== row.name)) {
      detection.pending.push({key, node_id: nodeId})
    }
  }

  return detection
}

interface ClassifyTrackedParams {
  entry: RepoEntry
  key: string
  accessByKey: Map<string, AccessListEntry>
  accessByNodeId: Map<string, AccessListEntry>
  accessNodePrivacy: Map<string, AccessNodePrivacy>
  accessChannelByKey: Map<string, DiscoveryChannel>
  perRepoStatus: Map<string, RepoStatusProbe>
  fieldProbes: Map<string, FieldProbe>
  allowlistedOwners: Set<string>
  /** Stored `owner/name` keys of rows whose owner changed on GitHub (see {@link detectRenames}). */
  transferKeys: ReadonlySet<string>
  summary: ReconcileSummary
  dispatches: DispatchRequest[]
  rawIssues: RawIssue[]
  transitionIssues: VisibilityTransitionIssue[]
  now: Date
}

/**
 * Queue a visibility-transition integrity alert when a tracked entry's stored `private`
 * flag flips from `false` to `true`. Newcomers (no stored `private` field) are excluded —
 * that is initial categorization, not a flip. Private-to-public transitions emit no alert;
 * the next mutator write recanonicalizes the entry.
 *
 * Dedup is handled inline in `runIssueQueue` — this function always pushes when the flip
 * is detected, and the async dedup step suppresses duplicates before creating the GitHub issue.
 */
function maybeQueueVisibilityTransition(params: {
  storedPrivate: boolean | undefined
  newPrivate: boolean
  node_id: string | undefined
  summary: ReconcileSummary
  transitionIssues: VisibilityTransitionIssue[]
}): void {
  // Only fire on false → true. Newcomers (undefined) are excluded.
  if (params.storedPrivate !== false) return
  if (!params.newPrivate) return
  if (params.node_id === undefined) return
  params.summary.visibilityTransitions += 1
  params.transitionIssues.push({kind: 'visibility-transition', node_id: params.node_id})
}

function identityKeys(entry: RepoEntry): string[] {
  const keys: string[] = []
  const nodeId = storedRepoNodeId(entry)
  if (nodeId !== undefined) keys.push(`node_id:${nodeId}`)
  if (entry.database_id !== undefined) keys.push(`database_id:${entry.database_id}`)
  return keys
}

function surveyDateRank(value: string | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function mergeRepoEntries(left: RepoEntry, right: RepoEntry): boolean {
  return identityKeys(left).some(key => identityKeys(right).includes(key))
}

/**
 * Duplicate rows of one identity must agree on visibility. When any row is restrictive
 * (private/unknown), every public sibling is downgraded in place so none survives a downgrade.
 */
function restrictGroupVisibility(entries: RepoEntry[], group: number[]): void {
  const rows = group.flatMap(index => entries[index] ?? [])
  if (!rows.some(row => row.private !== false) || !rows.some(row => row.private === false)) return

  const groupNodeId = rows.map(row => storedRepoNodeId(row)).find(nodeId => nodeId !== undefined)
  for (const index of group) {
    const row = entries[index]
    if (row === undefined || row.private !== false) continue
    const nodeId = storedRepoNodeId(row) ?? groupNodeId
    if (nodeId === undefined) {
      // No node ID to redact with: drop the flag so visibility is unknown (never admitted as public).
      entries[index] = Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'private')) as RepoEntry
    } else {
      entries[index] = normalizeRepoEntryForStorage(row, {private: true, node_id: nodeId})
    }
  }
}

/**
 * Stable identity keys of every repo that has a retained protected public association, closed over
 * rows that share any key with it. Dispatch planning skips the whole identity, so a duplicate row
 * of a protected repo is never surveyed regardless of row order.
 */
function protectedIdentityKeys(
  entries: readonly RepoEntry[],
  protectedAssociations: ReadonlySet<string> | undefined,
): Set<string> {
  const keys = new Set<string>()
  if (protectedAssociations === undefined) return keys
  for (const entry of entries) {
    if (entry.private === false && protectedAssociations.has(publicAssociationKey(entry.owner, entry.name))) {
      for (const key of identityKeys(entry)) keys.add(key)
    }
  }
  if (keys.size === 0) return keys

  for (let grew = true; grew;) {
    grew = false
    for (const entry of entries) {
      const entryKeys = identityKeys(entry)
      if (entryKeys.some(key => keys.has(key)) && entryKeys.some(key => !keys.has(key))) {
        for (const key of entryKeys) keys.add(key)
        grew = true
      }
    }
  }
  return keys
}

function isSameEntry(left: RepoEntry, right: RepoEntry): boolean {
  const leftKeys = Object.keys(left) as (keyof RepoEntry)[]
  return leftKeys.length === Object.keys(right).length && leftKeys.every(field => Object.is(left[field], right[field]))
}

/**
 * Undo a rename of a protected public association: when the classified result is still public
 * but moved off a protected owner/name, keep the previous owner/name and every other refreshed
 * field. Counters recorded for the undone rename are rolled back so the plan reflects only
 * what is applied. Private/unknown results are returned as-is. Dispatch suppression for the
 * protected identity happens once all rows are final (see `protectedIdentityKeys`).
 */
function keepProtectedName(params: {
  entry: RepoEntry
  classified: RepoEntry
  protectedAssociations: ReadonlySet<string> | undefined
  summary: ReconcileSummary
  before: {renamed: number; refreshed: number}
}): RepoEntry {
  const {entry, classified, protectedAssociations, summary, before} = params
  if (protectedAssociations === undefined || entry.private !== false || classified.private !== false) return classified

  const previousAssociation = publicAssociationKey(entry.owner, entry.name)
  if (!protectedAssociations.has(previousAssociation)) return classified
  if (publicAssociationKey(classified.owner, classified.name) === previousAssociation) return classified

  if (summary.renamed > before.renamed) summary.renamed -= 1
  const kept: RepoEntry = {...classified, owner: entry.owner, name: entry.name}
  if (!isSameEntry(kept, entry)) return kept

  if (summary.refreshed > before.refreshed) {
    summary.refreshed -= 1
    summary.unchanged += 1
  }
  return entry
}

function mergeDuplicateEntries(
  entries: RepoEntry[],
  accessList: AccessListEntry[],
  summary: ReconcileSummary,
  protectedAssociations?: ReadonlySet<string>,
): RepoEntry[] {
  const currentNameByNodeId = new Map(accessList.map(access => [access.node_id, repoKey(access.owner, access.name)]))
  const groups: number[][] = []

  entries.forEach((entry, index) => {
    const matchingGroups = groups.filter(group =>
      group.some(member => {
        const candidate = entries[member]
        return candidate !== undefined && mergeRepoEntries(entry, candidate)
      }),
    )
    if (matchingGroups.length === 0) {
      groups.push([index])
      return
    }

    const first = matchingGroups[0]
    if (first === undefined) throw new Error('reconcile: duplicate group index missing')
    first.push(index)
    for (const group of matchingGroups.slice(1)) {
      first.push(...group)
      groups.splice(groups.indexOf(group), 1)
    }
  })

  // Duplicates of one identity must agree on visibility: a restrictive row wins over a public sibling.
  const working = [...entries]
  for (const group of groups) {
    if (group.length >= 2) restrictGroupVisibility(working, group)
  }

  const mergedByIndex = new Map<number, RepoEntry>()
  const removed = new Set<number>()
  for (const group of groups) {
    if (group.length < 2) continue

    const currentNameMatch = group
      .map(index => ({index, entry: working[index]}))
      .filter((item): item is {index: number; entry: RepoEntry} => item.entry !== undefined)
      .find(({entry}) => {
        const nodeId = storedRepoNodeId(entry)
        return nodeId !== undefined && currentNameByNodeId.get(nodeId) === repoKey(entry.owner, entry.name)
      })
    const freshestCandidates = group
      .map(index => ({index, entry: working[index]}))
      .filter((item): item is {index: number; entry: RepoEntry} => item.entry !== undefined)
      .sort((left, right) => {
        const freshness = surveyDateRank(right.entry.last_survey_at) - surveyDateRank(left.entry.last_survey_at)
        if (freshness === 0) return left.index - right.index
        return freshness
      })
    const freshest = freshestCandidates[0]
    if (freshest === undefined) throw new Error('reconcile: freshest duplicate entry missing')
    const survivor = currentNameMatch ?? freshest
    const freshestSurvey = freshest.entry
    const firstIndex = group[0]
    if (firstIndex === undefined) throw new Error('reconcile: duplicate group is empty')
    const merged: RepoEntry = {
      ...survivor.entry,
      added:
        group
          .map(index => working[index]?.added)
          .filter((value): value is string => value !== undefined)
          .sort()[0] ?? survivor.entry.added,
      last_survey_at: freshestSurvey.last_survey_at,
      last_survey_status: freshestSurvey.last_survey_status,
      next_survey_eligible_at: freshestSurvey.next_survey_eligible_at,
    }

    // Merging must not remove a protected public association: keep every classified row.
    if (protectedAssociations !== undefined) {
      const mergedAssociation = publicAssociationKey(merged.owner, merged.name)
      const dropsProtected = group.some(index => {
        const row = working[index]
        if (row === undefined || row.private !== false) return false
        const association = publicAssociationKey(row.owner, row.name)
        return association !== mergedAssociation && protectedAssociations.has(association)
      })
      if (dropsProtected) continue
    }

    mergedByIndex.set(firstIndex, merged)
    for (const index of group) {
      if (index !== firstIndex) removed.add(index)
    }
    summary.merged += group.length - 1
  }

  return working.flatMap((entry, index) => {
    if (removed.has(index)) return []
    return [mergedByIndex.get(index) ?? entry]
  })
}

function filterDispatchesAfterMerge(params: {
  dispatches: DispatchRequest[]
  nextEntries: RepoEntry[]
  accessByNodeId: Map<string, AccessListEntry>
  accessNodePrivacy: Map<string, AccessNodePrivacy>
  now: Date
}): DispatchRequest[] {
  const seenNodeIds = new Set<string>()
  return params.dispatches.filter(dispatch => {
    if (seenNodeIds.has(dispatch.node_id)) return false
    const entry = params.nextEntries.find(
      candidate =>
        repoKey(candidate.owner, candidate.name) === repoKey(dispatch.owner, dispatch.repo) ||
        storedRepoNodeId(candidate) === dispatch.node_id,
    )
    const access = params.accessByNodeId.get(dispatch.node_id)
    if (entry === undefined || access === undefined) return false
    if (entry.private !== false || accessPrivateForStorage(access, params.accessNodePrivacy)) return false

    const eligible =
      (entry.onboarding_status === 'onboarded' && isEligibleForSurvey(entry.next_survey_eligible_at, params.now)) ||
      (entry.onboarding_status === 'pending' &&
        (entry.last_survey_status !== 'success' || isEligibleForSurvey(entry.next_survey_eligible_at, params.now)))
    if (!eligible) return false

    seenNodeIds.add(dispatch.node_id)
    return true
  })
}

/**
 * Determine the fate of one tracked repo. Returns a fresh entry when the status or fields
 * need to change; otherwise returns the original entry by reference. Mutates the shared
 * summary/dispatches/rawIssues accumulators — this is the functional loop-and-accumulate
 * pattern (see `processInvitation` in `handle-invitation.ts`).
 */
function classifyTracked(params: ClassifyTrackedParams): RepoEntry {
  const {
    accessByKey,
    accessByNodeId,
    accessNodePrivacy,
    perRepoStatus,
    fieldProbes,
    allowlistedOwners,
    summary,
    dispatches,
    rawIssues,
    transitionIssues,
    now,
  } = params

  // Backfill new schema fields on legacy entries before any other logic. Idempotent on
  // already-populated entries (returns by reference) so steady-state runs don't bump the
  // migrated counter or break the no-op fast path.
  const migrated = migrateRepoEntry(params.entry, now)
  if (migrated !== params.entry) {
    summary.migrated += 1
  }
  const entry = migrated
  const key = params.key
  let access = accessForTrackedEntry(entry, key, accessByKey, accessByNodeId)
  let accessKey = access === undefined ? key : repoKey(access.owner, access.name)
  const identity = fieldProbes.get(key)?.identity ?? fieldProbes.get(accessKey)?.identity
  const storedNodeId = storedRepoNodeId(entry)

  const identityNeedsRepair =
    identity !== undefined && (identity.returned_node_id !== storedNodeId || identity.resolution !== 'matched')

  if (storedNodeId !== undefined && identityNeedsRepair) {
    if (identity.resolution === 'transient') {
      summary.unchanged += 1
      summary.transient += 1
      return entry
    }

    if (
      identity.resolution === 'unresolvable' ||
      identity.resolved_owner === undefined ||
      identity.resolved_name === undefined
    ) {
      if (entry.onboarding_status === 'lost-access') {
        summary.unchanged += 1
        return entry
      }
      summary.lostAccess += 1
      summary.byChannel[entry.discovery_channel ?? 'collab'].lostAccess += 1
      maybeQueueVisibilityTransition({
        storedPrivate: entry.private,
        newPrivate: true,
        node_id: storedNodeId,
        summary,
        transitionIssues,
      })
      return normalizeLostAccessEntry(entry)
    }

    const resolvedAccess = accessByNodeId.get(storedNodeId)
    if (
      resolvedAccess === undefined ||
      resolvedAccess.owner !== identity.resolved_owner ||
      resolvedAccess.name !== identity.resolved_name
    ) {
      if (entry.onboarding_status === 'lost-access') {
        summary.unchanged += 1
        return entry
      }
      summary.lostAccess += 1
      summary.byChannel[entry.discovery_channel ?? 'collab'].lostAccess += 1
      maybeQueueVisibilityTransition({
        storedPrivate: entry.private,
        newPrivate: true,
        node_id: storedNodeId,
        summary,
        transitionIssues,
      })
      return normalizeLostAccessEntry(entry)
    }

    // The node resolves to a current owner/name; whether that is a rename or a transfer is decided
    // by `detectRenames` (reported, never applied). The stored owner/name stay on every return path.
    access = resolvedAccess
    accessKey = repoKey(access.owner, access.name)
  }

  if (access === undefined) {
    if (entry.owner === '[REDACTED]' && storedRepoNodeId(entry) !== undefined) {
      if (entry.onboarding_status === 'lost-access') {
        summary.unchanged += 1
        return entry
      }
      summary.lostAccess += 1
      summary.byChannel[entry.discovery_channel ?? 'collab'].lostAccess += 1
      maybeQueueVisibilityTransition({
        storedPrivate: entry.private,
        newPrivate: true,
        node_id: storedRepoNodeId(entry),
        summary,
        transitionIssues,
      })
      return normalizeLostAccessEntry(entry)
    }

    // Not in the access list — probe decides lost-access vs transient inconsistency.
    const probe = perRepoStatus.get(key)
    if (probe === undefined) {
      // Probe missing (e.g. probe request failed mid-run) — treat as no change.
      summary.unchanged += 1
      return entry
    }
    switch (probe.status) {
      case 'still-accessible': {
        // Transient inconsistency between the access-list enumeration and the per-repo probe.
        // The probe carries fresh `private`/`node_id` from `repos.get`, but we deliberately
        // discard them: the access-list snapshot is the system of record for visibility, and
        // writing privacy fields from a probe that disagrees with it would propagate the
        // inconsistency rather than wait for it to resolve. The next cron's enumeration will
        // either re-include the entry (writing fresh fields via the field-refresh path) or
        // produce a consistent classification. Sticky preservation is the conservative choice.
        summary.unchanged += 1
        return entry
      }
      case 'transient': {
        // Could not classify this run; preserve sticky state. `...entry` keeps prior
        // private/node_id (or absence thereof) intact — no field is introduced or cleared.
        // Bumps both `unchanged` (so the run-summary line still adds up) and `transient`
        // (so a 5xx storm is visible as a non-zero counter rather than indistinguishable
        // from a healthy quiet day).
        summary.unchanged += 1
        summary.transient += 1
        return entry
      }
      case 'malformed': {
        // Same shape as transient; separate counter distinguishes upstream API contract
        // anomalies (200 with unusable body) from infrastructure-level transients.
        summary.unchanged += 1
        summary.malformed += 1
        return entry
      }
      case 'deleted':
      case 'archived':
      case 'revoked': {
        // Flip to lost-access unless already there. Fail-safe: write `private: true`
        // because we cannot reach the repo to confirm visibility. `...entry` preserves
        // prior `node_id` if any (no fresh source available on this branch).
        if (entry.onboarding_status === 'lost-access') {
          summary.unchanged += 1
          return entry
        }
        summary.lostAccess += 1
        summary.byChannel[entry.discovery_channel ?? 'collab'].lostAccess += 1
        maybeQueueVisibilityTransition({
          storedPrivate: entry.private,
          newPrivate: true,
          node_id: storedRepoNodeId(entry),
          summary,
          transitionIssues,
        })
        return normalizeLostAccessEntry(entry)
      }
      default: {
        // Exhaustiveness guard. Adding a new RepoStatusProbe variant must update the
        // switch above instead of silently falling through to lost-access.
        const exhaustive: never = probe
        throw new Error(`reconcile: unhandled RepoStatusProbe variant: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  // Owner change (node-ID-preserving transfer): never applied, never surveyed. Checked before any
  // dispatch push or write, and only for rows with a real stored owner (`detectRenames` skips the rest).
  if (params.transferKeys.has(key)) {
    summary.transferBlocked += 1
    summary.unchanged += 1
    return entry
  }

  // Stored owner/name win on every return path below. The one exception is un-redaction: a row stored
  // as `[REDACTED]` whose same node is public in the access list takes the access entry's real name.
  const unredact = entry.owner === REDACTED_OWNER
  const identityOwner = unredact ? access.owner : entry.owner
  const identityName = unredact ? access.name : entry.name

  if (access.archived) {
    // Pass-1 archived detection: flip to lost-access directly, no Pass-2 probe required.
    if (entry.onboarding_status === 'lost-access') {
      summary.unchanged += 1
      return entry
    }
    summary.lostAccess += 1
    summary.byChannel[entry.discovery_channel ?? 'collab'].lostAccess += 1
    maybeQueueVisibilityTransition({
      storedPrivate: entry.private,
      newPrivate: true,
      node_id: access.node_id,
      summary,
      transitionIssues,
    })
    return {
      ...normalizeRepoEntryForStorage(entry, {
        owner: identityOwner,
        repo: identityName,
        private: true,
        node_id: access.node_id,
      }),
      onboarding_status: 'lost-access',
    }
  }

  if (entry.onboarding_status === 'lost-access') {
    // Regain: entry was lost-access and is now back in the access list. Trust path
    // mirrors Pass 2's newcomer logic via `isTrustedChannel`. Channel resolution
    // prefers the entry's stored channel (sticky); falls back to the live access-list
    // channel for legacy pre-Unit-3 entries that have no recorded channel; ultimately
    // defaults to `collab` if neither source has it.
    const channel = entry.discovery_channel ?? params.accessChannelByKey.get(accessKey) ?? 'collab'
    const trusted = isTrustedChannel(channel, access.owner, allowlistedOwners)
    const nextStatus: OnboardingStatus = trusted ? 'pending' : 'pending-review'
    const accessPrivate = accessPrivateForStorage(access, accessNodePrivacy)
    summary.regained += 1
    if (trusted) {
      if (accessPrivate) {
        summary.skippedPrivate += 1
      } else {
        dispatches.push({owner: access.owner, repo: access.name, node_id: access.node_id})
      }
    } else {
      rawIssues.push({
        owner: access.owner,
        repo: access.name,
        reason: 'unsolicited-regain',
        private: accessPrivate,
        node_id: access.node_id,
      })
    }
    return {
      ...normalizeRepoEntryForStorage(entry, {
        owner: identityOwner,
        repo: identityName,
        private: accessPrivate,
        node_id: access.node_id,
      }),
      onboarding_status: nextStatus,
    }
  }

  // Still-accessible tracked entry.
  //
  // Dispatch eligibility:
  // - `onboarded` entries whose `last_survey_at` has reached the staleness threshold or
  //   is null become candidates for periodic re-survey.
  // - `pending` entries that have never been successfully surveyed are candidates for
  //   initial bootstrapping. A `pending` repo is eligible when it has no recorded success
  //   (`last_survey_status !== 'success'`) OR when its last survey is stale. This retries
  //   failed/never-run initial surveys without waiting 30 days, while avoiding pointless
  //   re-dispatch of a `pending` repo whose successful survey hasn't promoted yet.
  //
  // The actual dispatch may still be deferred by the per-run cap; entries that are
  // genuinely fresh never become candidates so they don't compete for dispatch slots.
  // `pending-review` entries are excluded — they require human approval first.
  const wouldDispatchIfPublic =
    (entry.onboarding_status === 'onboarded' && isEligibleForSurvey(entry.next_survey_eligible_at, params.now)) ||
    (entry.onboarding_status === 'pending' &&
      (entry.last_survey_status !== 'success' || isEligibleForSurvey(entry.next_survey_eligible_at, params.now)))

  const accessPrivate = accessPrivateForStorage(access, accessNodePrivacy)

  // Detect public-to-private visibility flip for still-accessible entries.
  maybeQueueVisibilityTransition({
    storedPrivate: entry.private,
    newPrivate: accessPrivate,
    node_id: access.node_id,
    summary,
    transitionIssues,
  })

  if (wouldDispatchIfPublic && (entry.private !== false || accessPrivate)) {
    summary.skippedPrivate += 1
  } else if (wouldDispatchIfPublic) {
    dispatches.push({owner: access.owner, repo: access.name, node_id: access.node_id})
  }

  // Channel refresh: if the live access-channel has higher precedence than the stored
  // discovery_channel (including legacy entries with no stored channel, which default to
  // 'collab'), update the channel and recompute next_survey_eligible_at for the new
  // channel's interval. This self-heals mis-classified entries (e.g. bfra-me contrib repos
  // stored as collab) and backfills legacy entries that predate the discovery_channel field.
  //
  // Only upgrades (lower → higher precedence) are applied. Downgrades are suppressed so a
  // genuinely `owned` entry that also appears in the collab list stays `owned`. Precedence
  // rank: owned=2 > contrib=1 > collab=0 (matches mergeAccessChannels loop order).
  const CHANNEL_RANK = {owned: 2, contrib: 1, collab: 0} as const satisfies Record<DiscoveryChannel, number>
  const liveChannel = params.accessChannelByKey.get(accessKey) ?? 'collab'
  const storedChannel = entry.discovery_channel ?? 'collab'
  let workingEntry = entry
  if (CHANNEL_RANK[liveChannel] > CHANNEL_RANK[storedChannel]) {
    // Recompute next_survey_eligible_at for the new channel's interval. Use last_survey_at
    // as the base date when available; fall back to now so the entry gets a fresh cadence
    // window rather than becoming immediately eligible. Guard against a corrupted
    // last_survey_at (e.g. 'bogus') that would produce an Invalid Date and cause
    // computeNextEligibleAt's .toISOString() to throw — mirror migrateRepoEntry's guard.
    const baseMs =
      entry.last_survey_at !== null && entry.last_survey_at !== undefined
        ? Date.parse(`${entry.last_survey_at}T00:00:00Z`)
        : Number.NaN
    const baseDate = Number.isFinite(baseMs) ? new Date(baseMs) : now
    const nextEligible = computeNextEligibleAt({
      owner: access.owner,
      repo: access.name,
      channel: liveChannel,
      baseDate,
    })
    workingEntry = {...entry, discovery_channel: liveChannel, next_survey_eligible_at: nextEligible}
  }

  // Field refresh: apply probe results when they disagree with tracked fields,
  // and write live private/node_id from the access list when they differ.
  const probe = fieldProbes.get(key) ?? fieldProbes.get(accessKey)
  const accessNodeId = storedNodeId === undefined ? (identity?.returned_node_id ?? access.node_id) : access.node_id
  const storageInput = {
    owner: identityOwner,
    repo: identityName,
    private: accessPrivate,
    node_id: accessNodeId,
  }

  if (probe === undefined) {
    // No field probe — but access list still has private/node_id. Apply if changed.
    const normalized = normalizeRepoEntryForStorage(workingEntry, storageInput)
    if (normalized === entry) {
      summary.unchanged += 1
      return entry
    }
    summary.refreshed += 1
    return normalized
  }

  // Include database_id from the probe so redacted entries carry the format-independent
  // denylist anchor. Optional: absent when the probe did not return a positive integer.
  const storageInputWithProbe =
    probe.database_id === undefined ? storageInput : {...storageInput, database_id: probe.database_id}

  const fieldsMatch =
    probe.has_fro_bot_workflow === workingEntry.has_fro_bot_workflow && probe.has_renovate === workingEntry.has_renovate
  const privacyMatch = workingEntry.private === accessPrivate && workingEntry.node_id === accessNodeId
  const databaseIdMatch = probe.database_id === undefined || workingEntry.database_id === probe.database_id
  const channelMatch = workingEntry === entry // true only when no channel refresh occurred

  if (fieldsMatch && privacyMatch && databaseIdMatch && channelMatch) {
    summary.unchanged += 1
    return entry
  }
  summary.refreshed += 1
  return normalizeRepoEntryForStorage({
    ...normalizeRepoEntryForStorage(workingEntry, storageInputWithProbe),
    has_fro_bot_workflow: probe.has_fro_bot_workflow,
    has_renovate: probe.has_renovate,
  })
}

/**
 * Backfill the new cadence schema fields (`discovery_channel`, `next_survey_eligible_at`)
 * on legacy entries that predate Unit 1's schema extension. Idempotent: returns the input
 * by reference when both fields are already populated.
 *
 * Default channel is `'collab'` because every entry that existed before Unit 3's
 * cross-channel discovery shipped came from collaborator invitations.
 *
 * Eligibility computation honors the entry's resolved channel — if `discovery_channel`
 * is already set (e.g. by `addRepoEntry`'s default in Unit 1's loose-then-tight rollout
 * window) but `next_survey_eligible_at` is missing, we use that channel's base interval,
 * not collab's. This matters once Unit 3 ships, because owned-channel entries with a
 * surfacing date but no eligibility must use the 14-day interval, not the 30-day one.
 *
 * Pure (no allocation when both fields are populated). Safe to call inside the mutator
 * closure that 409-retries through `commitMetadata`.
 */
export function migrateRepoEntry(entry: RepoEntry, _now: Date): RepoEntry {
  const needsChannel = entry.discovery_channel === undefined
  const needsEligibility = entry.next_survey_eligible_at === undefined
  if (!needsChannel && !needsEligibility) return entry

  const channel: DiscoveryChannel = entry.discovery_channel ?? 'collab'
  let nextSurveyEligibleAt: string | null = entry.next_survey_eligible_at ?? null
  if (needsEligibility) {
    if (entry.last_survey_at === null) {
      nextSurveyEligibleAt = null
    } else {
      const baseMs = Date.parse(`${entry.last_survey_at}T00:00:00Z`)
      if (Number.isFinite(baseMs)) {
        nextSurveyEligibleAt = computeNextEligibleAt({
          owner: entry.owner,
          repo: entry.name,
          channel,
          baseDate: new Date(baseMs),
        })
      } else {
        // Malformed last_survey_at — treat as never-surveyed for cadence purposes.
        nextSurveyEligibleAt = null
      }
    }
  }

  return {
    ...entry,
    discovery_channel: channel,
    next_survey_eligible_at: nextSurveyEligibleAt,
  }
}

/**
 * Return true when the entry should be a candidate for the next survey dispatch under
 * the cadence-engine model.
 *
 * Boundary semantics: an entry whose `next_survey_eligible_at` is exactly today (UTC
 * midnight) is eligible. The daily cron's "now" reaches the eligibility instant exactly
 * once and dispatch fires on that run.
 *
 * A null `next_survey_eligible_at` signals "never computed" and is always eligible
 * (matching the semantics of a never-surveyed entry under the legacy model). A
 * malformed date string is also treated as eligible so recoverable metadata corruption
 * doesn't silently suppress coverage.
 */
export function isEligibleForSurvey(nextSurveyEligibleAt: string | null | undefined, now: Date): boolean {
  if (nextSurveyEligibleAt === null || nextSurveyEligibleAt === undefined) return true
  const eligibleMs = Date.parse(`${nextSurveyEligibleAt}T00:00:00Z`)
  if (!Number.isFinite(eligibleMs)) return true
  return now.getTime() >= eligibleMs
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
    const privateEntries = bucket.filter(item => item.private)
    const publicEntries = bucket.filter(item => !item.private)

    if (publicEntries.length >= 2) {
      const first = publicEntries[0]
      if (first === undefined) continue // unreachable; satisfies noUncheckedIndexedAccess
      issues.push({
        kind: 'per-owner-rollup',
        owner: first.owner,
        reason: first.reason,
        entries: publicEntries.map(item => ({repo: item.repo, private: item.private, node_id: item.node_id})),
      })
    } else {
      for (const item of publicEntries) {
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

    for (const item of privateEntries) {
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
    summary.migrated === 0 &&
    summary.renamed === 0 &&
    summary.merged === 0 &&
    summary.transferBlocked === 0 &&
    dispatches.length === 0 &&
    issues.length === 0
  )
}

export function indexAccessList(accessList: AccessListEntry[]): Map<string, AccessListEntry> {
  const map = new Map<string, AccessListEntry>()
  for (const entry of accessList) {
    map.set(repoKey(entry.owner, entry.name), entry)
  }
  return map
}

export function indexAccessListByNodeId(accessList: AccessListEntry[]): Map<string, AccessListEntry> {
  const map = new Map<string, AccessListEntry>()
  for (const entry of accessList) {
    map.set(entry.node_id, entry)
  }
  return map
}

function indexAccessNodePrivacy(accessList: AccessListEntry[]): Map<string, AccessNodePrivacy> {
  const map = new Map<string, AccessNodePrivacy>()
  for (const entry of accessList) {
    const current = map.get(entry.node_id) ?? {count: 0, hasNonPublic: false}
    map.set(entry.node_id, {
      count: current.count + 1,
      hasNonPublic: current.hasNonPublic || entry.private !== false,
    })
  }
  return map
}

/**
 * Fails closed for privacy and dispatch planning. Duplicate node_id rows are
 * treated as private even when every row reports public visibility because the
 * canonical owner/repo identity is ambiguous.
 */
function accessPrivateForStorage(access: AccessListEntry, accessNodePrivacy: Map<string, AccessNodePrivacy>): boolean {
  const nodePrivacy = accessNodePrivacy.get(access.node_id)
  return access.private !== false || nodePrivacy?.hasNonPublic === true || (nodePrivacy?.count ?? 0) > 1
}

export function storedRepoNodeId(entry: RepoEntry): string | undefined {
  if (entry.node_id !== undefined) return entry.node_id
  if (entry.owner === '[REDACTED]') return entry.name
  return undefined
}

export function accessForTrackedEntry(
  entry: RepoEntry,
  key: string,
  accessByKey: Map<string, AccessListEntry>,
  accessByNodeId: Map<string, AccessListEntry>,
): AccessListEntry | undefined {
  return accessByKey.get(key) ?? accessByNodeId.get(storedRepoNodeId(entry) ?? '')
}

function normalizeLostAccessEntry(entry: RepoEntry): RepoEntry {
  const nodeId = storedRepoNodeId(entry)
  if (nodeId === undefined) {
    return {...entry, onboarding_status: 'lost-access', private: true}
  }
  return {
    ...normalizeRepoEntryForStorage(entry, {private: true, node_id: nodeId}),
    onboarding_status: 'lost-access',
  }
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

export function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`
}
