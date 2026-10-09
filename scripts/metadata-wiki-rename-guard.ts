/**
 * Detects `metadata/repos.yaml` changes that would strand a wiki page, for reconcile.
 *
 * The `data → main` promotion gate (`check-wiki-private-presence.ts`) admits a wiki repo page
 * only when its slug maps to a repo entry with an explicit `private: false` and its sources
 * attribute the page to that entry's exact owner/name. Dropping a public owner/name while the
 * old-name page still exists on `data` leaves a page the gate refuses to promote.
 *
 * Associations are compared by case-insensitive `owner/name`. Slugs are used only to find the
 * page file, so repos that share a slug (`alpha.beta` / `alpha-beta`) are still decided
 * independently. The module is deliberately small: no alias registry, no tombstones. The
 * promotion gate stays the backstop for the race between a metadata write and a wiki write.
 *
 * Results carry normalized association keys for the caller to act on; callers must publish
 * counts only.
 */
import type {OctokitClient} from './commit-metadata.ts'

import {computeRepoSlug} from './wiki-slug.ts'
import {WIKI_ROOT} from './wiki-utils.ts'

const REDACTED_OWNER = '[REDACTED]'

/** Outcome of looking up one repo page on the target branch. */
export type WikiPageState = 'present' | 'absent' | 'unverifiable'

/** Removed public associations whose old page is not verified absent. */
export interface BlockedAssociations {
  readonly present: readonly string[]
  readonly unverifiable: readonly string[]
}

interface RepoRow {
  readonly association: string
  readonly slug: string | undefined
  readonly isPublic: boolean
  readonly identityKeys: readonly string[]
}

/** Normalized public association key: case-insensitive `owner/name`. */
export function publicAssociationKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase()
}

/**
 * Public associations the proposed file removes, excluding restrictive (private/unknown)
 * downgrades of the same repo. A successor continues a removed association only by the exact
 * normalized association or a shared stable identity (`node_id` / `database_id`), never by slug.
 *
 * Reads both files leniently: malformed rows are skipped rather than thrown on, so a malformed
 * proposed row cannot keep an association public and garbage output fails closed. Associations
 * that cannot form a slug cannot name a page file and are not reported.
 */
export function findRemovedPublicAssociations(
  previous: unknown,
  next: unknown,
): {readonly association: string; readonly slug: string}[] {
  const nextRows = readRows(next)
  const nextPublic = new Set(nextRows.filter(row => row.isPublic).map(row => row.association))

  const removed = new Map<string, {slug: string; keys: Set<string>}>()
  for (const row of readRows(previous)) {
    if (!row.isPublic || row.slug === undefined || nextPublic.has(row.association)) continue
    const entry = removed.get(row.association) ?? {slug: row.slug, keys: new Set<string>()}
    for (const key of row.identityKeys) entry.keys.add(key)
    removed.set(row.association, entry)
  }

  const result: {association: string; slug: string}[] = []
  for (const [association, {slug, keys}] of removed) {
    const successors = nextRows.filter(
      row => row.association === association || row.identityKeys.some(key => keys.has(key)),
    )
    const isDowngradeOnly = successors.length > 0 && successors.every(row => !row.isPublic)
    if (!isDowngradeOnly) result.push({association, slug})
  }

  return result.sort((left, right) => left.association.localeCompare(right.association))
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

/**
 * Removed public associations whose page is present or unverifiable. Lookups are deduplicated by
 * slug; decisions are made per association, so a slug shared by two repos never merges their fates.
 */
export async function findBlockedPublicAssociations(params: {
  previous: unknown
  next: unknown
  lookup: (slug: string) => Promise<WikiPageState>
}): Promise<BlockedAssociations> {
  const removed = findRemovedPublicAssociations(params.previous, params.next)
  const lookups = new Map<string, Promise<WikiPageState>>()
  for (const {slug} of removed) {
    if (!lookups.has(slug)) lookups.set(slug, params.lookup(slug))
  }

  const present: string[] = []
  const unverifiable: string[] = []
  for (const {association, slug} of removed) {
    const state = await lookups.get(slug)
    if (state === 'present') present.push(association)
    else if (state !== 'absent') unverifiable.push(association)
  }
  return {present, unverifiable}
}

function readRows(file: unknown): RepoRow[] {
  if (!isRecord(file) || !Array.isArray(file.repos)) return []
  return (file.repos as unknown[]).flatMap(entry => rowOf(entry) ?? [])
}

function rowOf(entry: unknown): RepoRow | undefined {
  if (!isRecord(entry) || typeof entry.owner !== 'string' || typeof entry.name !== 'string') return undefined
  return {
    association: publicAssociationKey(entry.owner, entry.name),
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
