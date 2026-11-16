/**
 * Metadata refresh for the fro-bot account.
 *
 * Scans the repositories accessible to the Fro Bot GitHub App installation,
 * filters to those owned by the configured account containing
 * `.github/workflows/renovate.yaml` and not archived in the registry, and writes the sorted list to
 * `metadata/renovate.yaml` on the `data` branch. Mirrors the bfra-me/.github
 * update-metadata pattern.
 *
 * Architecture:
 *   - buildRenovateFile(names): pure shape builder — sole owner of sort + dedupe.
 *   - discoverRenovateRepos(octokit, owner): async I/O — list installation repos
 *     filtered to the target owner, probe each. Returns repos in discovery order;
 *     canonicalization happens in buildRenovateFile.
 *   - runUpdateMetadata({discovery, writer, ...}): discover with the read-only
 *     client, commit with the repo-scoped writer client.
 *   - runFromEnv / runUpdateMetadataCli(): thin shell — validate both tokens, build both clients.
 *
 * Two App installation tokens, two clients (least privilege):
 *   - discovery (owner-wide, metadata:read + contents:read): installation listing
 *     and `getContent` on `.github/workflows/renovate.yaml` only.
 *   - writer (this repo only, contents:write): `commitMetadata` to `data`.
 * Neither client's response bodies are logged or persisted; output is the summary.
 *
 * Registry filter: `metadata/repos.yaml` (restored from `data` by the workflow) is read once, before any
 * discovery call. A repository an archived row identifies is skipped, so a declared archive stops the list
 * even when GitHub does not report the repository archived. An unreadable or invalid registry discovers no
 * repositories and commits nothing (the committed list is left as it was) and fails the run with one fixed
 * message, so a scheduled run is red.
 *
 * Uses `apps.listReposAccessibleToInstallation` so the call works whether the
 * Fro Bot account is a User (current) or an Organization (future migration).
 */

import type {RenovateFile} from '@fro.bot/wiki-write-core/schemas'
import type {Octokit, RestEndpointMethodTypes} from '@octokit/rest'

import type {RegistryIo} from './registry-io.ts'

import {readFile} from 'node:fs/promises'
import {createOctokit} from '@fro-bot/core/github'
import {assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {parse} from 'yaml'

import {commitMetadata, type CommitMetadataParams, type CommitMetadataResult} from './commit-metadata.ts'

export type OctokitClient = Octokit

const DEFAULT_OWNER = 'fro-bot'
const RENOVATE_WORKFLOW_PATH = '.github/workflows/renovate.yaml'
const RENOVATE_METADATA_PATH = 'metadata/renovate.yaml'
const REGISTRY_PATH = 'metadata/repos.yaml'

// Derived from the real Octokit response so SDK drift becomes a compile error. Projected to the
// fields discovery reads, so the narrow client type (and its test doubles) need not fake the rest.
type GetContentParams = RestEndpointMethodTypes['repos']['getContent']['parameters']
type FullInstallationRepo =
  RestEndpointMethodTypes['apps']['listReposAccessibleToInstallation']['response']['data']['repositories'][number]
type InstallationRepo = Pick<FullInstallationRepo, 'name' | 'archived' | 'fork'> &
  Partial<Pick<FullInstallationRepo, 'node_id' | 'id'>> & {owner: Pick<FullInstallationRepo['owner'], 'login'>}

/** The fields of an archived registry row that identify a repository. */
export interface ArchivedRow {
  owner: string
  name: string
  node_id?: string
  database_id?: number
}

/** What reading `metadata/repos.yaml` produced: its archived rows, or that it could not be read. */
export type RegistryRead = {readable: true; archivedRows: readonly ArchivedRow[]} | {readable: false}

// A bare callable, not the SDK's endpoint-method type: that type also carries `defaults` and
// `endpoint`, which a test double has no reason to fake. The real endpoint methods satisfy it.
type EndpointRoute = (...args: never[]) => unknown

/**
 * Exactly what discovery calls: paginated installation listing and `getContent` for the renovate
 * workflow probe. Narrower than `OctokitClient` so the owner-wide read-only client is typed (and
 * tested) without any write surface. The real `Octokit` satisfies it structurally; the SDK's own
 * method types provide the `getContent` argument and result shapes.
 */
export interface DiscoveryClient {
  // Method syntax (bivariant parameters) so the SDK's generic `paginate` overloads still match.
  paginate: (route: EndpointRoute, params: {per_page: number}) => Promise<InstallationRepo[]>
  rest: {
    apps: {listReposAccessibleToInstallation: EndpointRoute}
    repos: {getContent: (params: GetContentParams) => Promise<unknown>}
  }
}

// ─── Pure engine ────────────────────────────────────────────────────────────

/**
 * Wrap a list of repo names in the canonical `metadata/renovate.yaml` schema.
 * Sorts alphabetically and deduplicates so the file shape is stable.
 */
export function buildRenovateFile(repoNames: string[]): RenovateFile {
  const unique = [...new Set(repoNames)]
  unique.sort((a, b) => a.localeCompare(b))
  return {repositories: {'with-renovate': unique}}
}

/**
 * Whether an archived registry row identifies `repo`. An archived row keeps its stored name through a rename
 * on GitHub, so a row with a node ID or a database ID matches by ID alone, and a row with neither matches by
 * owner and name. A row with an ID is never matched by name: a new repository may reuse the name.
 */
function isArchivedRepo(repo: InstallationRepo, archivedRows: readonly ArchivedRow[]): boolean {
  return archivedRows.some(row => {
    if (row.node_id === undefined && row.database_id === undefined) {
      return row.owner === repo.owner.login && row.name === repo.name
    }
    return (
      (row.node_id !== undefined && row.node_id === repo.node_id) ||
      (row.database_id !== undefined && row.database_id === repo.id)
    )
  })
}

/** Reads the archived rows of the registry at `path`. A missing, unparsable or invalid file is `{readable: false}`. */
export async function readRegistry(path: string): Promise<RegistryRead> {
  try {
    const raw: unknown = parse(await readFile(path, 'utf8'))
    assertReposFile(raw, 'repos')
    return {
      readable: true,
      archivedRows: raw.repos
        .filter(row => row.onboarding_status === 'archived')
        .map(row => ({
          owner: row.owner,
          name: row.name,
          ...(row.node_id === undefined ? {} : {node_id: row.node_id}),
          ...(row.database_id === undefined ? {} : {database_id: row.database_id}),
        })),
    }
  } catch {
    return {readable: false}
  }
}

// ─── Async discovery engine ─────────────────────────────────────────────────

/**
 * Discover repos under `owner` that contain a Renovate workflow at the canonical path.
 * Lists repos via the App installation's accessible-repositories endpoint, filters to
 * the target owner, then skips archived repos and forks (neither should be receiving
 * Renovate dispatches) and every repo an archived registry row identifies (`archivedRows`). 404
 * from the probe means "no Renovate workflow"; non-404
 * errors propagate with repo context so failures point at the offending repo.
 */
export async function discoverRenovateRepos(
  octokit: DiscoveryClient,
  owner: string,
  archivedRows: readonly ArchivedRow[],
): Promise<string[]> {
  const allRepos: InstallationRepo[] = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  })

  const repos = allRepos.filter(r => r.owner.login === owner)
  const found: string[] = []

  for (const repo of repos) {
    if (repo.archived || repo.fork || isArchivedRepo(repo, archivedRows)) continue

    try {
      await octokit.rest.repos.getContent({
        owner,
        repo: repo.name,
        path: RENOVATE_WORKFLOW_PATH,
      })
      found.push(repo.name)
    } catch (error: unknown) {
      if (isNotFoundError(error)) continue
      throw new Error(`update-metadata: probe failed for ${owner}/${repo.name} (${formatErrorStatus(error)})`, {
        cause: error,
      })
    }
  }

  return found
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasNumericStatus(error: unknown): error is {status: number} {
  if (typeof error !== 'object' || error === null) return false
  const status = (error as {status?: unknown}).status
  return typeof status === 'number'
}

function isNotFoundError(error: unknown): boolean {
  return hasNumericStatus(error) && error.status === 404
}

function formatErrorStatus(error: unknown): string {
  if (hasNumericStatus(error)) return `status=${error.status}`
  if (error instanceof Error) return error.message
  return 'unknown error'
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export interface UpdateMetadataSummary {
  owner: string
  detected: number
  committed: boolean
  attempts: number
}

export interface RunUpdateMetadataParams {
  /** Owner-wide read-only client: installation listing + renovate workflow probes. */
  discovery: DiscoveryClient
  /**
   * Repo-scoped contents:write client: `commitMetadata` only. Stays the full `OctokitClient`
   * because `CommitMetadataParams.octokit` is typed as the full client; narrowing it belongs to
   * `commit-metadata.ts`, not here.
   */
  writer: OctokitClient
  owner: string
  /** The registry read, made before this run: its archived rows filter discovery. */
  registry: RegistryRead
  commit?: (params: CommitMetadataParams) => Promise<CommitMetadataResult>
}

export async function runUpdateMetadata(params: RunUpdateMetadataParams): Promise<UpdateMetadataSummary> {
  // Fail closed and loudly: with no registry to filter by, nothing is discovered and nothing is committed (the
  // committed list stays as it was), and the run fails with one fixed message so the scheduled run is red.
  if (!params.registry.readable) {
    throw new Error('update-metadata: registry unreadable; discovering no repositories')
  }

  const commit = params.commit ?? commitMetadata
  const detected = await discoverRenovateRepos(params.discovery, params.owner, params.registry.archivedRows)
  const next = buildRenovateFile(detected)

  const result = await commit({
    path: RENOVATE_METADATA_PATH,
    message: `chore(metadata): refresh renovate.yaml from ${params.owner} account scan`,
    octokit: params.writer,
    async mutator() {
      return next
    },
  })

  return {
    owner: params.owner,
    detected: detected.length,
    committed: result.committed,
    attempts: result.attempts,
  }
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

function requireToken(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

/**
 * Validate both tokens up front — before any client exists — so a missing writer
 * token can't leave a half-finished run (discovery done, nothing committed).
 */
export async function runFromEnv(
  env: Record<string, string | undefined>,
  createClient: (token: string) => Promise<OctokitClient>,
  commit?: RunUpdateMetadataParams['commit'],
  options: {registryPath?: string} = {},
): Promise<UpdateMetadataSummary> {
  const discoveryToken = requireToken(env, 'UPDATE_METADATA_DISCOVERY_TOKEN')
  const writerToken = requireToken(env, 'UPDATE_METADATA_WRITER_TOKEN')

  const discovery = await createClient(discoveryToken)
  const writer = await createClient(writerToken)
  const owner = env.UPDATE_METADATA_OWNER ?? DEFAULT_OWNER
  const registry = await readRegistry(options.registryPath ?? REGISTRY_PATH)

  return runUpdateMetadata({discovery, writer, owner, registry, commit})
}

/** The CLI body: discovers the Renovate repos, commits the result and prints the summary as one JSON line. */
export async function runUpdateMetadataCli(
  env: Record<string, string | undefined>,
  io: RegistryIo,
  deps: {
    createClient?: (token: string) => Promise<OctokitClient>
    commit?: RunUpdateMetadataParams['commit']
    registryPath?: string
  } = {},
): Promise<void> {
  const summary = await runFromEnv(env, deps.createClient ?? (async token => createOctokit(token)), deps.commit, {
    registryPath: deps.registryPath,
  })
  io.stdout(`${JSON.stringify(summary)}\n`)
}
