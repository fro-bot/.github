/**
 * Rename guard for `metadata/repos.yaml` writes.
 *
 * The `data → main` promotion gate (`check-wiki-private-presence.ts`) admits a wiki repo page
 * only when its slug maps to a repo entry with an explicit `private: false`. A metadata write that
 * drops a public name (a rename, or a duplicate-row merge that keeps only the new name) while the
 * old-name page still exists on `data` strands that page: the gate then refuses to promote it and
 * the weekly `data → main` merge stays red until an operator repairs the wiki by hand.
 *
 * This module is the shared policy `commitMetadata` applies to every writer of that file
 * (reconcile, invitation acceptance, survey results, survey resets). It is deliberately small:
 * no alias registry, no tombstones, no cross-writer coordination. The promotion gate remains the
 * backstop for the residual race between a metadata write and a concurrent wiki write.
 *
 * Policy:
 * - A previously public name (`private === false`) that is absent from the proposed public set is
 *   "removed". Removal is allowed only when no page exists at that name's slug on the branch.
 * - Restrictive updates are never blocked: when every successor row for the removed name is
 *   private or of unknown visibility, the write is a visibility downgrade, not a rename. Blocking
 *   it would force stale public status to be kept.
 * - Fail closed: an unreadable or ambiguous page lookup blocks the write.
 *
 * Outputs carry counts only. Names, slugs, and paths never leave this module, because the failure
 * surfaces in public workflow logs.
 */
import type {OctokitClient} from './commit-metadata.ts'

import {computeRepoSlug} from './wiki-slug.ts'
import {WIKI_ROOT} from './wiki-utils.ts'

/** The only metadata file this guard applies to. Matched exactly, never by pattern. */
export const REPOS_METADATA_PATH = 'metadata/repos.yaml'

const REDACTED_OWNER = '[REDACTED]'

/** Outcome of looking up one repo page on the target branch. */
export type WikiPageState = 'present' | 'absent' | 'unverifiable'

export type RenameGuardVerdict =
  | {readonly kind: 'allow'}
  | {readonly kind: 'page-present'; readonly count: number}
  | {readonly kind: 'unverifiable'; readonly count: number}

interface RepoRow {
  readonly raw: Record<string, unknown>
  readonly slug: string | undefined
  readonly isPublic: boolean
  readonly identityKeys: readonly string[]
}

/** Blocked removals, split by why they are blocked. Slugs stay internal; callers publish counts. */
export interface BlockedSlugs {
  readonly present: readonly string[]
  readonly unverifiable: readonly string[]
}

/**
 * Names that the proposed file would remove from the public set, excluding restrictive
 * (private/unknown) downgrades of the same repo. Returns slugs, sorted for determinism.
 *
 * Reads both files leniently: malformed rows are skipped rather than thrown on. A malformed
 * proposed* row therefore cannot keep a name public, so garbage output fails closed.
 */
export function findRemovedPublicSlugs(previous: unknown, next: unknown): string[] {
  const nextRows = readRows(next)
  const nextPublicSlugs = new Set<string>()
  for (const row of nextRows) {
    if (row.isPublic && row.slug !== undefined) nextPublicSlugs.add(row.slug)
  }

  const removed = new Map<string, Set<string>>()
  for (const row of readRows(previous)) {
    if (!row.isPublic || row.slug === undefined || nextPublicSlugs.has(row.slug)) continue
    const keys = removed.get(row.slug) ?? new Set<string>()
    for (const key of row.identityKeys) keys.add(key)
    removed.set(row.slug, keys)
  }

  const stranding: string[] = []
  for (const [slug, keys] of removed) {
    // Successors: rows that continue the same repo, by stable identity or by the same name.
    const successors = nextRows.filter(row => row.slug === slug || row.identityKeys.some(key => keys.has(key)))
    const isDowngradeOnly = successors.length > 0 && successors.every(row => !row.isPublic)
    if (!isDowngradeOnly) stranding.push(slug)
  }

  return stranding.sort((left, right) => left.localeCompare(right))
}

/**
 * Look up `knowledge/wiki/repos/{slug}.md` on the target branch. Only a definite 404 counts as
 * absence; any other failure (rate limit, 5xx, network, permissions) is unverifiable.
 */
export async function lookupRepoWikiPage(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  branch: string
  slug: string
}): Promise<WikiPageState> {
  try {
    await params.octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      ref: params.branch,
      path: `${WIKI_ROOT}/repos/${params.slug}.md`,
    })
    // Any successful response (file, directory, symlink, submodule) means something occupies the path.
    return 'present'
  } catch (error: unknown) {
    return isRecord(error) && error.status === 404 ? 'absent' : 'unverifiable'
  }
}

/** Removed public names whose wiki page is not verified absent. */
export async function findBlockedPublicSlugs(params: {
  previous: unknown
  next: unknown
  lookup: (slug: string) => Promise<WikiPageState>
}): Promise<BlockedSlugs> {
  const removed = findRemovedPublicSlugs(params.previous, params.next)
  const states = await Promise.all(removed.map(async slug => params.lookup(slug)))
  return {
    present: removed.filter((_slug, index) => states[index] === 'present'),
    unverifiable: removed.filter((_slug, index) => states[index] === 'unverifiable'),
  }
}

export async function evaluateRenameGuard(params: {
  previous: unknown
  next: unknown
  lookup: (slug: string) => Promise<WikiPageState>
}): Promise<RenameGuardVerdict> {
  const blocked = await findBlockedPublicSlugs(params)
  if (blocked.present.length > 0) return {kind: 'page-present', count: blocked.present.length}
  if (blocked.unverifiable.length > 0) return {kind: 'unverifiable', count: blocked.unverifiable.length}
  return {kind: 'allow'}
}

export interface KeptRows {
  /** The proposed file with every blocked repo's old rows restored in place. */
  readonly next: unknown
  /** Repos kept unchanged because their old page exists. */
  readonly blockedRepos: number
  /** Repos kept unchanged because wiki state could not be verified. */
  readonly unverifiableRepos: number
  /** Stable node IDs of kept repos, so callers can skip work that would fail on the new name. */
  readonly keptNodeIds: ReadonlySet<string>
  /** Renames and merged-away rows that were reverted, for callers that report such counts. */
  readonly keptRenamed: number
  readonly keptMerged: number
}

/**
 * Per-repo variant of the guard for writers that can tolerate a skip: restores the old rows of
 * each repo whose rename or merge would strand a page, leaving every other change in `next`.
 * Repos are evaluated independently, so one stuck rename never blocks another. Restrictive
 * downgrades are never flagged, so a stale public row is never restored over them.
 * `commitMetadata` still enforces the same policy as the fail-closed backstop.
 */
export async function keepStrandedRows(params: {
  previous: unknown
  next: unknown
  lookup: (slug: string) => Promise<WikiPageState>
}): Promise<KeptRows> {
  const blocked = await findBlockedPublicSlugs(params)
  const blockedSlugs = new Set([...blocked.present, ...blocked.unverifiable])
  const keptNodeIds = new Set<string>()
  if (blockedSlugs.size === 0 || !isRecord(params.next) || !Array.isArray(params.next.repos)) {
    return {next: params.next, blockedRepos: 0, unverifiableRepos: 0, keptNodeIds, keptRenamed: 0, keptMerged: 0}
  }

  // One group per repo: the old public rows of each blocked name plus any old row sharing their identity.
  const previousRows = readRows(params.previous)
  const groups: Set<RepoRow>[] = []
  for (const slug of blockedSlugs) {
    const members = new Set(previousRows.filter(row => row.isPublic && row.slug === slug))
    const keys = new Set([...members].flatMap(row => row.identityKeys))
    for (const row of previousRows) {
      if (row.identityKeys.some(key => keys.has(key))) members.add(row)
    }
    for (const group of groups.filter(existing => [...existing].some(row => members.has(row)))) {
      for (const row of group) members.add(row)
      groups.splice(groups.indexOf(group), 1)
    }
    groups.push(members)
  }

  let repos = params.next.repos as unknown[]
  let keptRenamed = 0
  let keptMerged = 0
  for (const group of groups) {
    const members = [...group].sort((left, right) => previousRows.indexOf(left) - previousRows.indexOf(right))
    const keys = new Set(members.flatMap(row => row.identityKeys))
    const slugs = new Set(members.flatMap(row => (row.slug === undefined ? [] : [row.slug])))
    for (const key of keys) {
      if (key.startsWith('node_id:')) keptNodeIds.add(key.slice('node_id:'.length))
    }

    // The first proposed row of this repo is replaced by the old rows; its other proposed rows are dropped.
    const restored: unknown[] = []
    const proposed: RepoRow[] = []
    let inserted = false
    for (const entry of repos) {
      const row = rowOf(entry)
      const matches =
        row !== undefined &&
        (row.identityKeys.some(key => keys.has(key)) || (row.slug !== undefined && slugs.has(row.slug)))
      if (!matches) {
        restored.push(entry)
        continue
      }
      proposed.push(row)
      if (!inserted) {
        restored.push(...members.map(member => member.raw))
        inserted = true
      }
    }
    if (!inserted) restored.push(...members.map(member => member.raw))
    repos = restored

    // Counts the engine reported for this repo and that no longer apply: new names, and rows merged away.
    if (proposed.length > 0) {
      keptMerged += Math.max(0, members.length - proposed.length)
      keptRenamed += new Set(proposed.flatMap(row => (row.slug === undefined || slugs.has(row.slug) ? [] : [row.slug])))
        .size
    }
  }

  const presentSlugs = new Set(blocked.present)
  const blockedRepos = groups.filter(group =>
    [...group].some(row => row.slug !== undefined && presentSlugs.has(row.slug)),
  ).length
  return {
    next: {...params.next, repos},
    blockedRepos,
    unverifiableRepos: groups.length - blockedRepos,
    keptNodeIds,
    keptRenamed,
    keptMerged,
  }
}

function readRows(file: unknown): RepoRow[] {
  if (!isRecord(file) || !Array.isArray(file.repos)) return []
  return (file.repos as unknown[]).flatMap(entry => rowOf(entry) ?? [])
}

function rowOf(entry: unknown): RepoRow | undefined {
  if (!isRecord(entry) || typeof entry.owner !== 'string' || typeof entry.name !== 'string') return undefined
  return {
    raw: entry,
    slug: slugOrUndefined(entry.owner, entry.name),
    // Strict `=== false`, mirroring `buildPublicSlugMap`: absent/non-boolean is treated as not public.
    isPublic: entry.private === false,
    identityKeys: identityKeysOf(entry),
  }
}

function identityKeysOf(entry: Record<string, unknown>): string[] {
  const keys: string[] = []
  if (typeof entry.node_id === 'string' && entry.node_id !== '') {
    keys.push(`node_id:${entry.node_id}`)
  } else if (entry.owner === REDACTED_OWNER && typeof entry.name === 'string' && entry.name !== '') {
    // Legacy redacted rows carry the node ID in `name`.
    keys.push(`node_id:${entry.name}`)
  }
  if (typeof entry.database_id === 'number' && Number.isInteger(entry.database_id) && entry.database_id > 0) {
    keys.push(`database_id:${entry.database_id}`)
  }
  return keys
}

function slugOrUndefined(owner: string, name: string): string | undefined {
  try {
    return computeRepoSlug(owner, name)
  } catch {
    // A name that cannot be slugged cannot name a wiki page file.
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
