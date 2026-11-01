/**
 * The read probes of a reconcile run: the collaborator access list, the per-repo status and field probes, the
 * repository-identity and workflow probes, and the owned and contrib channel enumerations with their merge.
 * Every probe is a read; none writes. Response bodies are parsed, never logged or persisted.
 */

import type {AllowlistFile, DiscoveryChannel, ReposFile} from '@fro.bot/wiki-write-core/schemas'
import type {RestEndpointMethodTypes} from '@octokit/rest'
import {Buffer} from 'node:buffer'
import {isApiStatus, isRecord} from '@fro-bot/core/guards'
import {parse} from 'yaml'
import {toApiError, type OctokitClient, type ReconcileLogger} from './reconcile-model.ts'
import {
  accessForTrackedEntry,
  indexAccessList,
  indexAccessListByNodeId,
  repoKey,
  storedRepoNodeId,
  type AccessListEntry,
  type FieldProbe,
  type RepoIdentityProbe,
  type RepoStatusProbe,
} from './reconcile-plan.ts'

interface AccessListApiEntry {
  owner: {login: string} | null
  name: string
  archived: boolean | null | undefined
  private: boolean | null | undefined
  node_id: string
}

export async function fetchAccessList(userOctokit: OctokitClient): Promise<AccessListEntry[]> {
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
        private: r.private !== false,
        node_id: r.node_id,
      })
    }
    return entries
  } catch (error: unknown) {
    throw toApiError(error, 'enumerating /user/repos')
  }
}

/**
 * Probes each tracked entry that no longer appears in the access list and classifies
 * the result into one of the {@link RepoStatusProbe} states. Never throws on
 * classifiable errors (404/451/403/5xx/network/malformed); only unclassified 4xx
 * responses propagate as `ReconcileError` to surface unexpected GitHub-side changes.
 *
 * Exported only for unit tests. The sole production caller is `handleReconcile` in
 * this same file.
 *
 * @internal
 */
export async function fetchPerRepoStatus(
  userOctokit: OctokitClient,
  currentRepos: ReposFile,
  accessList: AccessListEntry[],
  logger: {warn: (message: string) => void},
): Promise<Map<string, RepoStatusProbe>> {
  const accessKeys = new Set(accessList.map(a => `${a.owner}/${a.name}`))
  const accessNodeIds = new Set(accessList.map(a => a.node_id))
  const map = new Map<string, RepoStatusProbe>()
  for (const entry of currentRepos.repos) {
    const key = `${entry.owner}/${entry.name}`
    if (accessKeys.has(key)) continue
    const nodeId = storedRepoNodeId(entry)
    if (nodeId !== undefined && accessNodeIds.has(nodeId)) continue
    if (entry.owner === '[REDACTED]') continue
    try {
      const response = await userOctokit.rest.repos.get({owner: entry.owner, repo: entry.name})
      // Reachable (200) but we weren't in /user/repos → access was revoked.
      // Empty `node_id` on a 200 also classifies as malformed: the schema's own constraint
      // is `node_id.length > 0`, so accepting an empty string here would only defer the
      // failure to `assertReposFile` with a less-actionable error message.
      if (
        typeof response.data?.private !== 'boolean' ||
        typeof response.data?.node_id !== 'string' ||
        response.data.node_id.length === 0
      ) {
        logger.warn(
          `reconcile: malformed repos.get response (node_id=${entry.node_id ?? 'unknown'}); sticky-preserving prior state`,
        )
        map.set(key, {status: 'malformed'})
        continue
      }
      map.set(key, {status: 'revoked'})
    } catch (error: unknown) {
      if (isApiStatus(error, 404)) {
        map.set(key, {status: 'deleted'})
        continue
      }
      // Rate-limit detection runs before the bare 403/451 → revoked branch. GitHub's
      // primary rate-limit returns 429; secondary returns 403 with rate-limit headers
      // or message. Misclassifying these as revoked cascades false lost-access flips.
      if (isGitHubRateLimit(error)) {
        const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined
        logger.warn(
          `reconcile: GitHub rate-limit (status=${status ?? 'unknown'}) probing tracked entry (node_id=${entry.node_id ?? 'unknown'}); sticky-preserving prior state`,
        )
        map.set(key, status === undefined ? {status: 'transient'} : {status: 'transient', httpStatus: status})
        continue
      }
      if (isApiStatus(error, 451) || isApiStatus(error, 403)) {
        map.set(key, {status: 'revoked'})
        continue
      }
      if (isRecord(error) && typeof error.status === 'number' && error.status >= 500 && error.status < 600) {
        logger.warn(
          `reconcile: transient API error (${error.status}) probing tracked entry (node_id=${entry.node_id ?? 'unknown'}); sticky-preserving prior state`,
        )
        map.set(key, {status: 'transient', httpStatus: error.status})
        continue
      }
      // Network errors and unclassified errors — also transient.
      if (isRecord(error) && typeof error.status !== 'number') {
        logger.warn(
          `reconcile: network error probing tracked entry (node_id=${entry.node_id ?? 'unknown'}); sticky-preserving prior state`,
        )
        map.set(key, {status: 'transient'})
        continue
      }
      throw toApiError(error, `probing repo status for tracked entry`)
    }
  }
  return map
}

/**
 * Probe still-accessible tracked repos for field values (`has_fro_bot_workflow`,
 * `has_renovate`, `database_id`). Exported for unit tests; the sole production caller
 * is `handleReconcile` in this same file.
 *
 * @internal
 */
export async function fetchFieldProbes(
  userOctokit: OctokitClient,
  currentRepos: ReposFile,
  accessList: AccessListEntry[],
  logger: ReconcileLogger,
): Promise<{probes: Map<string, FieldProbe>; failed: number}> {
  const accessByKey = indexAccessList(accessList.filter(a => a.archived === false))
  const accessByNodeId = indexAccessListByNodeId(accessList.filter(a => a.archived === false))
  const map = new Map<string, FieldProbe>()
  let failed = 0
  for (const entry of currentRepos.repos) {
    const key = `${entry.owner}/${entry.name}`
    const access = accessForTrackedEntry(entry, key, accessByKey, accessByNodeId)
    if (access === undefined) continue // only probe still-accessible tracked entries
    try {
      const probeOwner = entry.owner === '[REDACTED]' ? access.owner : entry.owner
      const probeName = entry.owner === '[REDACTED]' ? access.name : entry.name
      const probe = await probeSingleRepo(userOctokit, probeOwner, probeName, storedRepoNodeId(entry))
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

async function probeSingleRepo(
  userOctokit: OctokitClient,
  owner: string,
  name: string,
  storedNodeId?: string,
): Promise<FieldProbe> {
  const [hasWorkflow, hasRenovate, databaseId, identity] = await Promise.all([
    probeFroBotWorkflow(userOctokit, owner, name),
    probeRenovateConfig(userOctokit, owner, name),
    probeRepoDatabaseId(userOctokit, owner, name),
    probeRepoIdentity(userOctokit, owner, name, storedNodeId),
  ])
  const probe: FieldProbe = {has_fro_bot_workflow: hasWorkflow, has_renovate: hasRenovate}
  if (databaseId !== undefined) {
    probe.database_id = databaseId
  }
  if (identity !== undefined) {
    probe.identity = identity
  }
  return probe
}

interface RepositoryIdentityApiResponse {
  node_id?: unknown
  name?: unknown
  owner?: {login?: unknown} | null
}

interface ResolvedRepositoryNode {
  owner: string
  name: string
}

async function probeRepoIdentity(
  userOctokit: OctokitClient,
  owner: string,
  name: string,
  storedNodeId?: string,
): Promise<RepoIdentityProbe | undefined> {
  let response: RepositoryIdentityApiResponse
  try {
    const result = await userOctokit.rest.repos.get({owner, repo: name})
    response = result.data
  } catch {
    if (storedNodeId === undefined) return undefined
    const resolved = await resolveRepoNodeId(userOctokit, storedNodeId)
    if (resolved.status === 'resolved') {
      return {
        returned_node_id: storedNodeId,
        resolution: 'resolved',
        resolved_owner: resolved.repository.owner,
        resolved_name: resolved.repository.name,
      }
    }
    return {returned_node_id: storedNodeId, resolution: resolved.status}
  }

  if (
    typeof response.node_id !== 'string' ||
    response.node_id.length === 0 ||
    typeof response.name !== 'string' ||
    response.name.length === 0 ||
    response.owner === null ||
    typeof response.owner?.login !== 'string' ||
    response.owner.login.length === 0
  ) {
    return undefined
  }

  const identity: RepoIdentityProbe = {
    returned_node_id: response.node_id,
    returned_owner: response.owner.login,
    returned_name: response.name,
    resolution: storedNodeId === undefined || storedNodeId === response.node_id ? 'matched' : 'transient',
  }

  if (storedNodeId === undefined || storedNodeId === response.node_id) return identity

  const resolved = await resolveRepoNodeId(userOctokit, storedNodeId)
  if (resolved.status === 'resolved') {
    return {
      ...identity,
      resolution: 'resolved',
      resolved_owner: resolved.repository.owner,
      resolved_name: resolved.repository.name,
    }
  }
  return {...identity, resolution: resolved.status}
}

type ResolveRepoNodeResult =
  {status: 'resolved'; repository: ResolvedRepositoryNode} | {status: 'unresolvable'} | {status: 'transient'}

async function resolveRepoNodeId(userOctokit: OctokitClient, nodeId: string): Promise<ResolveRepoNodeResult> {
  try {
    const response = await userOctokit.graphql<{
      node:
        | {
            __typename?: unknown
            name?: unknown
            owner?: {login?: unknown} | null
          }
        | null
        | undefined
    }>(
      `query ResolveRepository($id: ID!) {
        node(id: $id) {
          __typename
          ... on Repository {
            name
            owner { login }
          }
        }
      }`,
      {id: nodeId},
    )
    const node = response.node
    if (
      node === null ||
      node === undefined ||
      node.__typename !== 'Repository' ||
      typeof node.name !== 'string' ||
      node.name.length === 0 ||
      node.owner === null ||
      typeof node.owner?.login !== 'string' ||
      node.owner.login.length === 0
    ) {
      return {status: 'transient'}
    }
    return {status: 'resolved', repository: {owner: node.owner.login, name: node.name}}
  } catch (error: unknown) {
    // Only an explicit HTTP 404 is definitive unresolvable identity evidence.
    // GraphQL-layer NOT_FOUND in a 200 response, and every other failure, remain transient:
    // sticky preservation defers repair rather than risking an incorrect lost-access demotion.
    if (isApiStatus(error, 404)) return {status: 'unresolvable'}
    return {status: 'transient'}
  }
}

/**
 * Fetch the numeric `repository.id` (GitHub's `databaseId`) for a repo via `repos.get`.
 * Returns `undefined` when the response omits or nulls the field — a missing `databaseId`
 * is not an error; the entry remains protected by the primary `node_id` guard.
 *
 * Only positive integers are accepted. Zero, negatives, and non-integers are treated as
 * absent (same validation as `RepoEntry.database_id` in the schema).
 */
async function probeRepoDatabaseId(
  userOctokit: OctokitClient,
  owner: string,
  name: string,
): Promise<number | undefined> {
  try {
    const response = await userOctokit.rest.repos.get({owner, repo: name})
    const id = (response.data as {id?: unknown}).id
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
      return id
    }
    return undefined
  } catch {
    // Non-blocking: a failed databaseId probe does not fail the field probe.
    // The entry remains protected by the primary node_id guard.
    return undefined
  }
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

const RENOVATE_CONFIG_PATHS = [
  'renovate.json',
  'renovate.json5',
  '.github/renovate.json',
  '.github/renovate.json5',
  '.renovaterc.json',
  '.renovaterc.json5',
  '.renovaterc',
]

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

//
// ─── Discovery channels (owned + contrib) ───────────────────────────────────
//

/**
 * fro-bot/.github is excluded from the owned-channel discovery pass. The control-plane
 * repo is the agent's own home and writing wiki content about itself produces a circular
 * journal that pollutes the wiki.
 */
const OWNED_SELF_EXCLUDE = 'fro-bot/.github'

const FRO_BOT_WORKFLOW_PATH = '.github/workflows/fro-bot.yaml'

// Derived from the real Octokit response so SDK drift becomes a compile error.
/**
 * One discovery channel's access entries, and whether the channel enumerated completely. A transient
 * failure (not a 403/404, which are stable facts about the repo) leaves `complete` false: the list
 * is then missing repos it should have, so nothing may be concluded from a repo's absence.
 */
interface ChannelEnumeration {
  entries: AccessListEntry[]
  complete: boolean
}

type InstallationRepo =
  RestEndpointMethodTypes['apps']['listReposAccessibleToInstallation']['response']['data']['repositories'][number]

/**
 * Verify that a `.github/workflows/fro-bot.yaml` file actually invokes the `fro-bot/agent`
 * action via a `uses:` directive. Forge resistance: parses the workflow as YAML and walks
 * its job/step structure, checking only `uses:` values. Comments, `name:` strings, `run:`
 * shell, and `with:` inputs are ignored — they're not action sources.
 *
 * Accepted patterns (any `uses:` value matching one of these):
 * - `fro-bot/agent@<ref>`                                        (direct action)
 * - `fro-bot/agent/<sub/path>/...@<ref>`                         (action's reusable workflow)
 *
 * The `<ref>` may be a SHA, semver tag (`v0.42.1`), or branch (`main`). Variants like
 * `fro-bot/agent-fork@main` or `not-fro-bot/agent@main` are rejected — the path must be
 * exactly `fro-bot/agent` (or a sub-path under it).
 *
 * Returns false for empty files, non-YAML content, and YAML that has no qualifying
 * `uses:` value. Errors during parsing fail closed.
 */
export function containsFroBotAgentReference(yamlText: string): boolean {
  if (yamlText.length === 0) return false
  let parsed: unknown
  try {
    parsed = parse(yamlText)
  } catch {
    return false
  }
  if (!isRecord(parsed)) return false
  const jobs = parsed.jobs
  if (!isRecord(jobs)) return false
  for (const job of Object.values(jobs)) {
    if (!isRecord(job)) continue
    // Reusable workflow call: `jobs.<id>.uses: fro-bot/agent/.github/workflows/...@ref`
    if (typeof job.uses === 'string' && isFroBotAgentUses(job.uses)) return true
    // Step-level uses: `jobs.<id>.steps[*].uses: fro-bot/agent@ref`
    if (Array.isArray(job.steps)) {
      for (const step of job.steps) {
        if (isRecord(step) && typeof step.uses === 'string' && isFroBotAgentUses(step.uses)) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * A `uses:` value points at the fro-bot agent when its path component is exactly
 * `fro-bot/agent` or `fro-bot/agent/<anything>`, followed by an `@<ref>`. Rejects
 * `fro-bot/agent-fork`, `not-fro-bot/agent`, and any other typo-squat or substring spoof.
 */
function isFroBotAgentUses(value: string): boolean {
  // Split on the first `@` so the path and ref can be checked independently — keeps
  // the regex simple and avoids backtracking concerns from chained quantifiers.
  const atIndex = value.indexOf('@')
  if (atIndex < 1) return false // no `@`, or value starts with `@`
  const path = value.slice(0, atIndex)
  const ref = value.slice(atIndex + 1)
  if (ref.length === 0) return false
  if (/\s/.test(ref)) return false
  if (path === 'fro-bot/agent') return true
  if (!path.startsWith('fro-bot/agent/')) return false
  // sub-path must be non-empty and contain no whitespace
  const subPath = path.slice('fro-bot/agent/'.length)
  return subPath.length > 0 && !/\s/.test(subPath)
}

/**
 * Discover repos owned by `owner` that the App installation can reach. Skips archived,
 * forks, and the self-exclude constant. Owned repos are pre-trusted (we own them), so the
 * caller does NOT probe `fro-bot.yaml` content for these — owned trust comes from
 * ownership, not from a workflow signal.
 *
 * Errors during enumeration log a structured warn and return an empty list rather than
 * blocking the reconcile run. Cross-channel discovery is best-effort; collab access is
 * the authoritative signal for repo presence.
 */
export async function fetchOwnedRepos(
  discoveryOctokit: OctokitClient,
  owner: string,
  logger: ReconcileLogger,
): Promise<ChannelEnumeration> {
  let allRepos: InstallationRepo[]
  try {
    allRepos = await discoveryOctokit.paginate(discoveryOctokit.rest.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    })
  } catch (error: unknown) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    logger.warn(`reconcile: owned-channel enumeration failed (status=${status}); continuing without owned repos.`)
    return {entries: [], complete: false}
  }

  const entries: AccessListEntry[] = []
  for (const repo of allRepos) {
    if (repo.owner.login !== owner) continue
    if (repo.archived) continue
    if (repo.fork) continue
    const key = `${owner}/${repo.name}`
    if (key === OWNED_SELF_EXCLUDE) continue
    entries.push({
      owner,
      name: repo.name,
      archived: false,
      private: repo.private,
      node_id: repo.node_id,
    })
  }
  return {entries, complete: true}
}

/**
 * Discover contrib-channel repos surfaced via `metadata/allowlist.yaml`'s
 * `approved_contrib_repos`. For each `owner/name`, fetch repo metadata, skip
 * archived/forks, then verify the trust signal by parsing
 * `.github/workflows/fro-bot.yaml` and checking that a `uses:` directive points at
 * `fro-bot/agent` (see `containsFroBotAgentReference` for the structural check).
 *
 * 403 (App not installed in the target repo's org) and 404 (no signal file or repo
 * unreachable) result in silent omission with a structured warn that distinguishes the
 * two — collapsing them masks installation drift. 5xx and other transient errors also
 * log + omit.
 *
 * `approved_contrib_orgs` is intentionally NOT enumerated in v1: the
 * `apps.listReposAccessibleToInstallation` endpoint is per-installation, not per-org, so
 * cross-org enumeration would require minting a separate App installation token per org.
 * Until that infrastructure lands, operators surface contrib repos one-at-a-time via
 * `approved_contrib_repos`. A non-empty `approved_contrib_orgs` triggers a structured
 * warn so the operator knows the field is being ignored.
 */
export async function fetchContribRepos(
  discoveryOctokit: OctokitClient,
  allowlist: AllowlistFile,
  logger: ReconcileLogger,
): Promise<ChannelEnumeration> {
  if (allowlist.approved_contrib_orgs !== undefined && allowlist.approved_contrib_orgs.length > 0) {
    logger.warn(
      `reconcile: approved_contrib_orgs is not yet supported (requires per-org App installation tokens); ` +
        `${allowlist.approved_contrib_orgs.length} org(s) ignored. Use approved_contrib_repos to surface specific repos.`,
    )
  }

  const directRepos = allowlist.approved_contrib_repos ?? []
  const seen = new Set<string>()
  const entries: AccessListEntry[] = []
  let complete = true

  for (const ownerRepo of directRepos) {
    const slashIndex = ownerRepo.indexOf('/')
    if (slashIndex === -1) continue
    const directOwner = ownerRepo.slice(0, slashIndex)
    const directName = ownerRepo.slice(slashIndex + 1)
    const key = `${directOwner}/${directName}`
    if (seen.has(key)) continue
    const meta = await probeContribRepoMetadata(discoveryOctokit, directOwner, directName, logger)
    if (meta === 'failed') {
      complete = false
      continue
    }
    if (meta === null) continue
    if (meta.archived || meta.fork) continue
    const probe = await probeContribWorkflow(discoveryOctokit, directOwner, directName, logger)
    if (probe === 'failed') {
      complete = false
      continue
    }
    if (probe === null) continue
    if (!containsFroBotAgentReference(probe)) continue
    entries.push({
      owner: directOwner,
      name: directName,
      archived: false,
      private: meta.private,
      node_id: meta.node_id,
    })
    seen.add(key)
  }

  return {entries, complete}
}

/**
 * Fetch repo metadata (private flag, node_id, archived, fork) for a contrib direct-probe
 * entry. Returns null when the repo is unreachable (404 = doesn't exist, 403 = App not
 * installed). Distinguishes the two for operator-grade logging — silently collapsing 403
 * to 404 would mask installation drift, the silent-failure mode that
 * `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` warns
 * about. Any other error returns `'failed'`, which marks the channel's enumeration incomplete.
 */
async function probeContribRepoMetadata(
  discoveryOctokit: OctokitClient,
  owner: string,
  name: string,
  logger: ReconcileLogger,
): Promise<{private: boolean; node_id: string; archived: boolean; fork: boolean} | null | 'failed'> {
  try {
    const response = await discoveryOctokit.rest.repos.get({owner, repo: name})
    return {
      private: response.data.private === true,
      node_id: response.data.node_id,
      archived: response.data.archived === true,
      fork: response.data.fork === true,
    }
  } catch (error: unknown) {
    if (isApiStatus(error, 404)) return null
    if (isApiStatus(error, 403)) {
      logger.warn(`reconcile: contrib-repo ${owner}/${name} returned 403 (App not installed in org); omitting.`)
      return null
    }
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    logger.warn(`reconcile: contrib-repo ${owner}/${name} probe failed (status=${status}); omitting.`)
    return 'failed'
  }
}

/**
 * Fetch the raw `.github/workflows/fro-bot.yaml` content for a candidate contrib repo.
 * Returns null when the file is missing (404), the App lacks access (403), or the response
 * is malformed, and `'failed'` for any other (transient) error. 403 is logged distinctly from 404 — the same forge-resistance + drift-
 * visibility contract as `probeContribRepoMetadata`.
 */
async function probeContribWorkflow(
  discoveryOctokit: OctokitClient,
  owner: string,
  name: string,
  logger: ReconcileLogger,
): Promise<string | null | 'failed'> {
  try {
    const response = await discoveryOctokit.rest.repos.getContent({
      owner,
      repo: name,
      path: FRO_BOT_WORKFLOW_PATH,
    })
    // getContent returns a discriminated union — the file variant is the only one with
    // a base64-encoded `content` field. Narrow on `type === 'file'` to let TypeScript
    // pick the right branch without `as` casts.
    const {data} = response
    if (Array.isArray(data) || data.type !== 'file') return null
    if (data.encoding !== 'base64') return null
    return Buffer.from(data.content, 'base64').toString('utf8')
  } catch (error: unknown) {
    if (isApiStatus(error, 404)) return null
    if (isApiStatus(error, 403)) {
      logger.warn(`reconcile: contrib-repo ${owner}/${name} workflow probe returned 403 (App not installed); omitting.`)
      return null
    }
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 'unknown'
    logger.warn(`reconcile: contrib-repo ${owner}/${name} workflow probe failed (status=${status}); omitting.`)
    return 'failed'
  }
}

/**
 * Merge per-channel access lists into the canonical access list + channel map. Precedence
 * is `owned > contrib > collab`: when the same `owner/name` appears in multiple channels,
 * the highest-precedence channel wins so `validateAccessList` (which rejects duplicate
 * keys) sees a single entry.
 *
 * Rationale: explicitly-approved channels (owned/contrib) must win over generic collaborator
 * access. A bfra-me repo that is both collab-accessible AND contrib-approved must be
 * classified as `contrib` so it gets the correct 21-day cadence and counts under
 * `byChannel.contrib.tracked`.
 */
export function mergeAccessChannels(input: {
  collab: AccessListEntry[]
  owned: AccessListEntry[]
  contrib: AccessListEntry[]
}): {accessList: AccessListEntry[]; accessChannelByKey: Map<string, DiscoveryChannel>} {
  const accessByKey = new Map<string, AccessListEntry>()
  const channelByKey = new Map<string, DiscoveryChannel>()

  // Order matters: owned first wins overlap with contrib/collab; contrib wins over collab.
  for (const entry of input.owned) {
    const key = repoKey(entry.owner, entry.name)
    accessByKey.set(key, entry)
    channelByKey.set(key, 'owned')
  }
  for (const entry of input.contrib) {
    const key = repoKey(entry.owner, entry.name)
    if (accessByKey.has(key)) continue
    accessByKey.set(key, entry)
    channelByKey.set(key, 'contrib')
  }
  for (const entry of input.collab) {
    const key = repoKey(entry.owner, entry.name)
    if (accessByKey.has(key)) continue
    accessByKey.set(key, entry)
    channelByKey.set(key, 'collab')
  }

  return {accessList: Array.from(accessByKey.values()), accessChannelByKey: channelByKey}
}

/**
 * Distinguish a rate-limited 403/429 from a genuinely access-revoked 403. GitHub's
 * primary rate-limit returns 429; secondary rate-limits and abuse detection return 403
 * with one of: a `Retry-After` header, `x-ratelimit-remaining: 0`, or a body message
 * containing "rate limit" / "abuse detection". Treating these as `revoked` would cascade
 * false lost-access flips and amplify the rate-limit problem on the next cron's regain
 * dispatches; classifying as `transient` lets sticky preservation hold while the next
 * run retries naturally.
 */
export function isGitHubRateLimit(error: unknown): boolean {
  if (!isRecord(error)) return false
  if (error.status === 429) return true
  if (error.status !== 403) return false
  // Octokit RequestError exposes the response payload via `error.response`.
  const response = isRecord(error.response) ? error.response : undefined
  const headers = response !== undefined && isRecord(response.headers) ? response.headers : undefined
  if (headers !== undefined) {
    // `Retry-After`: presence alone signals rate-limit. GitHub only sets this header on
    // rate-limit and unavailable-for-legal-reasons responses; any value (seconds or HTTP
    // date) means "back off."
    if (headers['retry-after'] !== undefined) return true
    // `x-ratelimit-remaining`: present on every response with a number-as-string value
    // (e.g. "4998"). Only the literal "0" signals exhausted budget; non-zero values are
    // not rate-limit signals. Octokit normalizes header values to strings.
    if (headers['x-ratelimit-remaining'] === '0') return true
  }
  // Body messages — Octokit surfaces these via `error.message` or the response data.
  const messageSource =
    typeof error.message === 'string'
      ? error.message
      : response !== undefined && isRecord(response.data) && typeof response.data.message === 'string'
        ? response.data.message
        : ''
  const message = messageSource.toLowerCase()
  return message.includes('rate limit') || message.includes('abuse detection') || message.includes('secondary rate')
}
