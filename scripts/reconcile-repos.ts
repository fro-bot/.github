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
 */

import type {AllowlistFile, OnboardingStatus, RepoEntry, ReposFile} from './schemas.ts'
import {addRepoEntry} from './repos-metadata.ts'

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
