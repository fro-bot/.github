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
  readonly slug: string | undefined
  readonly isPublic: boolean
  readonly identityKeys: readonly string[]
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

export async function evaluateRenameGuard(params: {
  previous: unknown
  next: unknown
  lookup: (slug: string) => Promise<WikiPageState>
}): Promise<RenameGuardVerdict> {
  const removed = findRemovedPublicSlugs(params.previous, params.next)
  if (removed.length === 0) return {kind: 'allow'}

  const states = await Promise.all(removed.map(async slug => params.lookup(slug)))
  const present = states.filter(state => state === 'present').length
  if (present > 0) return {kind: 'page-present', count: present}

  const unverifiable = states.filter(state => state !== 'absent').length
  if (unverifiable > 0) return {kind: 'unverifiable', count: unverifiable}

  return {kind: 'allow'}
}

function readRows(file: unknown): RepoRow[] {
  if (!isRecord(file) || !Array.isArray(file.repos)) return []

  const rows: RepoRow[] = []
  for (const entry of file.repos as unknown[]) {
    if (!isRecord(entry) || typeof entry.owner !== 'string' || typeof entry.name !== 'string') continue
    rows.push({
      slug: slugOrUndefined(entry.owner, entry.name),
      // Strict `=== false`, mirroring `buildPublicSlugMap`: absent/non-boolean is treated as not public.
      isPublic: entry.private === false,
      identityKeys: identityKeysOf(entry),
    })
  }
  return rows
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
