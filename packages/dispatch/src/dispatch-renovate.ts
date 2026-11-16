/**
 * Renovate dispatch engine for fro-bot repos.
 *
 * Reads metadata/renovate.yaml for the list of fro-bot repos with Renovate configs,
 * checks if their Renovate workflow is already running, and dispatches workflow_dispatch
 * for idle repos. Mirrors the bfra-me/.github central Renovate dispatch pattern.
 *
 * Two modes, so the `actions: write` token reaches only the repos it will dispatch to:
 *   - `plan`: with the read-only discovery token, intersect metadata/renovate.yaml with the
 *     repositories the installation can access, drop every repository whose registry row on `data` is
 *     archived, clean the result, and write it to GITHUB_OUTPUT. A failed discovery fails the step; it
 *     never falls back to an unfiltered list. A registry that cannot be read plans no repositories and fails the
 *     step with one fixed message.
 *   - default: dispatch to the planned list (DISPATCH_REPOSITORIES) with the dispatch token.
 *
 * Architecture: pure buildDispatchPlan()/cleanRepoNames() + async planDispatchRepositories() /
 * dispatchRenovate() + thin main() shell.
 */

import type {Octokit, RestEndpointMethodTypes} from '@octokit/rest'

import {appendFile, readFile} from 'node:fs/promises'
import process from 'node:process'
import {createOctokit} from '@fro-bot/core/github'
import {assertRenovateFile, assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {parse} from 'yaml'

export type OctokitClient = Octokit

// A bare callable, not the SDK's endpoint-method type: that type also carries `defaults` and
// `endpoint`, which a test double has no reason to fake. The real endpoint methods satisfy it.
type EndpointRoute = (...args: never[]) => unknown

// Derived from the real Octokit response so SDK drift becomes a compile error. Projected to the
// fields planning reads, so the narrow client type (and its test doubles) need not fake the rest.
type FullInstallationRepo =
  RestEndpointMethodTypes['apps']['listReposAccessibleToInstallation']['response']['data']['repositories'][number]
type InstallationRepo = Pick<FullInstallationRepo, 'name'> &
  Partial<Pick<FullInstallationRepo, 'node_id' | 'id'>> & {owner: Pick<FullInstallationRepo['owner'], 'login'>}

/**
 * Exactly what planning calls: paginated installation listing. Narrower than `OctokitClient` so
 * the plan step cannot reach (and tests need not fake) anything that dispatches. The real
 * `Octokit` satisfies it structurally.
 */
export interface PlanClient {
  // Method syntax (bivariant parameters) so the SDK's generic `paginate` overloads still match.
  paginate: (route: EndpointRoute, params: {per_page: number}) => Promise<InstallationRepo[]>
  rest: {apps: {listReposAccessibleToInstallation: EndpointRoute}}
}

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_WORKFLOW_ID = 'renovate.yaml'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EligibleRepo {
  owner: string
  name: string
  workflowPath: string
}

type ListWorkflowRunsParams = RestEndpointMethodTypes['actions']['listWorkflowRuns']['parameters']
type CreateWorkflowDispatchParams = RestEndpointMethodTypes['actions']['createWorkflowDispatch']['parameters']

/**
 * Exactly what dispatching calls: the in-flight run probe and the dispatch itself. The real
 * `Octokit` satisfies it structurally; test doubles need not fake the rest of the SDK.
 */
export interface DispatchClient {
  rest: {
    actions: {
      listWorkflowRuns: (params: ListWorkflowRunsParams) => Promise<{data: {total_count: number}}>
      createWorkflowDispatch: (params: CreateWorkflowDispatchParams) => Promise<unknown>
    }
  }
}

export interface DispatchRenovateParams {
  octokit: DispatchClient
  eligible: EligibleRepo[]
}

export interface DispatchRenovateResult {
  dispatched: string[]
  skippedRunning: string[]
  failed: {name: string; error: string}[]
}

/** The fields of an archived registry row that identify a repository. */
export interface ArchivedRow {
  owner: string
  name: string
  node_id?: string
  database_id?: number
}

export interface PlanParams {
  /** Discovery client: read-only, owner-wide. */
  octokit: PlanClient
  /** Raw `with-renovate` entries from metadata/renovate.yaml. */
  requested: readonly string[]
  /** The registry rows on `data` whose status is `archived`. A repository one of them identifies is dropped. */
  archivedRows: readonly ArchivedRow[]
  owner?: string
}

export interface RunPlanParams {
  octokit: PlanClient
  renovatePath: string
  /** `metadata/repos.yaml` as restored from `data`. */
  registryPath: string
  outputPath: string
  owner?: string
}

// ─── Pure engine ────────────────────────────────────────────────────────────

/**
 * Build the dispatch plan from the renovate.yaml repo list.
 * Each entry is a repo name under the fro-bot owner.
 */
export function buildDispatchPlan(repoNames: string[], owner = DEFAULT_OWNER): EligibleRepo[] {
  return repoNames.map(name => ({
    owner,
    name,
    workflowPath: DEFAULT_WORKFLOW_ID,
  }))
}

/**
 * Trim, drop empties and dedupe, keeping first-seen order. The cleaned list is what the dispatch
 * mint receives as `repositories:`, so an empty result must stay empty (an empty `repositories:`
 * would otherwise widen an owner-scoped mint to every repo).
 */
export function cleanRepoNames(names: readonly string[]): string[] {
  const cleaned: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed !== '' && !cleaned.includes(trimmed)) cleaned.push(trimmed)
  }
  return cleaned
}

// ─── Planning (discovery client) ────────────────────────────────────────────

/**
 * Intersect the requested Renovate repos with the repositories the installation can access under
 * `owner`. Stale entries are dropped here so they never reach the mint, which would reject the
 * whole list. Discovery errors propagate.
 */
export async function planDispatchRepositories(params: PlanParams): Promise<string[]> {
  const requested = cleanRepoNames(params.requested)
  if (requested.length === 0) return []

  const owner = params.owner ?? DEFAULT_OWNER
  const accessible = await params.octokit.paginate(params.octokit.rest.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  })
  const names = new Set(
    accessible
      .filter(repo => repo.owner.login === owner && !isArchivedRepo(repo, params.archivedRows))
      .map(repo => repo.name),
  )
  return requested.filter(name => names.has(name))
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

/**
 * The archived rows of the registry at `path`, or `undefined` when it cannot be read or is not a valid registry
 * (a missing file included): the caller then plans nothing.
 */
async function readArchivedRows(path: string): Promise<ArchivedRow[] | undefined> {
  try {
    const raw: unknown = parse(await readFile(path, 'utf8'))
    assertReposFile(raw, 'repos')
    return raw.repos
      .filter(row => row.onboarding_status === 'archived')
      .map(row => ({
        owner: row.owner,
        name: row.name,
        ...(row.node_id === undefined ? {} : {node_id: row.node_id}),
        ...(row.database_id === undefined ? {} : {database_id: row.database_id}),
      }))
  } catch {
    return undefined
  }
}

/**
 * Plan mode: read the registry and renovate.yaml, plan, and append `repositories=<csv>` to the output file.
 * A registry that cannot be read fails closed and loudly: nothing is planned, no discovery call is made, an empty
 * `repositories=` is written (so no later step can read a stale value), and the step then fails with one fixed
 * message that carries no path, name or parser text, so the scheduled run is red.
 */
export async function runPlanMode(params: RunPlanParams): Promise<string[]> {
  const archivedRows = await readArchivedRows(params.registryPath)
  if (archivedRows === undefined) {
    await appendFile(params.outputPath, 'repositories=\n')
    throw new Error('dispatch-renovate: registry unreadable; planning no repositories')
  }

  const requested = await readRequestedRepos(params.renovatePath)
  const plan = await planDispatchRepositories({octokit: params.octokit, requested, archivedRows, owner: params.owner})
  await appendFile(params.outputPath, `repositories=${plan.join(',')}\n`)
  return plan
}

/**
 * Read the `with-renovate` list. A missing file is expected on first run and means nothing to
 * dispatch; parse/validation errors must surface so corrupted state isn't silently ignored.
 */
async function readRequestedRepos(path: string): Promise<string[]> {
  try {
    const raw: unknown = parse(await readFile(path, 'utf8'))
    assertRenovateFile(raw, 'renovate')
    return raw.repositories['with-renovate']
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) return []
    throw error
  }
}

// ─── Async dispatch engine ──────────────────────────────────────────────────

/**
 * For each eligible repo, check if a Renovate workflow run is already in_progress or queued.
 * If idle, dispatch a new run. Returns aggregated results.
 */
export async function dispatchRenovate(params: DispatchRenovateParams): Promise<DispatchRenovateResult> {
  const dispatched: string[] = []
  const skippedRunning: string[] = []
  const failed: DispatchRenovateResult['failed'] = []

  for (const repo of params.eligible) {
    try {
      const isActive = await isRenovateActive(params.octokit, repo)
      if (isActive) {
        skippedRunning.push(repo.name)
        continue
      }

      await params.octokit.rest.actions.createWorkflowDispatch({
        owner: repo.owner,
        repo: repo.name,
        workflow_id: repo.workflowPath,
        ref: 'main',
      })
      dispatched.push(repo.name)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error'
      failed.push({name: repo.name, error: message})
    }
  }

  return {dispatched, skippedRunning, failed}
}

/**
 * Check if a Renovate workflow is currently in_progress or queued in the target repo.
 * Checks both statuses to avoid dispatching when a run is waiting or executing.
 */
async function isRenovateActive(octokit: DispatchClient, repo: EligibleRepo): Promise<boolean> {
  for (const status of ['in_progress', 'queued'] as const) {
    const runs = await octokit.rest.actions.listWorkflowRuns({
      owner: repo.owner,
      repo: repo.name,
      workflow_id: repo.workflowPath,
      status,
      per_page: 1,
    })
    if (runs.data.total_count > 0) return true
  }
  return false
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' && code === 'ENOENT'
}

// ─── CLI bodies ─────────────────────────────────────────────────────────────

/** Both modes run from one client type; the real `Octokit` satisfies it. */
export type CliClient = PlanClient & DispatchClient

/** Seams for the CLI bodies; the defaults are the real Octokit, the process streams and the real file. */
export interface CliDeps {
  createOctokit?: (token: string) => CliClient | Promise<CliClient>
  stdout?: (text: string) => void
  renovatePath?: string
  registryPath?: string
}

async function createRealOctokit(token: string): Promise<CliClient> {
  return createOctokit(token)
}

/** Builds the client for `GITHUB_TOKEN`. A missing or empty token throws before any client exists. */
async function clientFromEnv(env: Record<string, string | undefined>, deps: CliDeps): Promise<CliClient> {
  const token = env.GITHUB_TOKEN
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is required')
  return (deps.createOctokit ?? createRealOctokit)(token)
}

/**
 * Plan mode (`dispatch-renovate plan`). `GITHUB_TOKEN` is the read-only discovery token; the plan lists,
 * never dispatches. Missing inputs throw before any API call.
 */
export async function runRenovatePlanCli(env: Record<string, string | undefined>, deps: CliDeps = {}): Promise<void> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text))
  const octokit = await clientFromEnv(env, deps)

  const outputPath = env.GITHUB_OUTPUT
  if (outputPath === undefined || outputPath === '') throw new Error('GITHUB_OUTPUT is required in plan mode')
  const plan = await runPlanMode({
    octokit,
    renovatePath: deps.renovatePath ?? 'metadata/renovate.yaml',
    registryPath: deps.registryPath ?? 'metadata/repos.yaml',
    outputPath,
  })
  stdout(`dispatch-renovate: planned ${plan.length} repositories\n`)
}

/**
 * Dispatch mode (no argument). `GITHUB_TOKEN` is the dispatch token, minted only for the planned list.
 * Never re-reads renovate.yaml: dispatching beyond the planned list would fall outside the token's reach.
 * Missing inputs throw before any API call.
 */
export async function runRenovateDispatchCli(
  env: Record<string, string | undefined>,
  deps: CliDeps = {},
): Promise<void> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text))
  const octokit = await clientFromEnv(env, deps)

  const repoNames = cleanRepoNames((env.DISPATCH_REPOSITORIES ?? '').split(','))
  if (repoNames.length === 0) throw new Error('DISPATCH_REPOSITORIES is required and must name at least one repository')

  const eligible = buildDispatchPlan(repoNames)
  const result = await dispatchRenovate({octokit, eligible})

  for (const f of result.failed) {
    process.stderr.write(`dispatch-renovate: failed ${f.name}: ${f.error}\n`)
  }

  const summary = {
    eligible: eligible.length,
    dispatched: result.dispatched.length,
    skippedRunning: result.skippedRunning.length,
    failed: result.failed.length,
  }
  stdout(`${JSON.stringify(summary)}\n`)
}
