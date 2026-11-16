import {Buffer} from 'node:buffer'
import {Octokit} from '@octokit/rest'
import {parse} from 'yaml'
import {
  checkPrivateLeakWithAdapter,
  type GuardResult,
  type PrivateLeakAdapter,
  type PrivateLeakScanRequest,
} from './private-leak.ts'
import {assertReposFile} from './schemas.ts'
import {buildPrivateNameTokens} from './wiki-slug.ts'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BRANCH = 'data'
const METADATA_PATH = 'metadata/repos.yaml'

const PRIVATE_REPOSITORIES_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Repository {
        nameWithOwner
        isPrivate
        visibility
      }
    }
  }
`

export type GitHubPrivateLeakAdapterErrorCode =
  'MISSING_TOKEN' | 'METADATA_UNAVAILABLE' | 'METADATA_INVALID' | 'RESOLUTION_FAILED' | 'OCTOKIT_INIT_FAILED'

export class PrivateLeakAdapterError extends Error {
  readonly code: GitHubPrivateLeakAdapterErrorCode
  readonly remediation: string

  constructor(params: {code: GitHubPrivateLeakAdapterErrorCode; message: string; remediation: string}) {
    super(params.message)
    this.name = 'PrivateLeakAdapterError'
    this.code = params.code
    this.remediation = params.remediation
  }
}

/**
 * The subset of Octokit used by the request-time privacy adapter. Tests can
 * provide this small surface without constructing the full SDK object.
 */
export interface GitHubPrivateLeakClient {
  readonly rest: {
    readonly repos: {
      readonly getContent: Octokit['rest']['repos']['getContent']
    }
  }
  readonly graphql: Octokit['graphql']
}

export interface GitHubPrivateLeakAdapterParams {
  readonly token?: string
  readonly octokit?: GitHubPrivateLeakClient
  readonly owner?: string
  readonly repo?: string
  readonly branch?: string
}

export interface GitHubPrivateLeakScanRequest extends Omit<PrivateLeakScanRequest, 'privateNames'> {
  readonly content: string
  readonly snapshotSha?: string
  readonly token?: string
  readonly octokit?: GitHubPrivateLeakClient
  readonly adapter?: PrivateLeakAdapter
}

/**
 * Build a request-time adapter backed by the authoritative data-branch
 * metadata. The adapter never reads workflow event state or process env.
 */
export async function createGitHubPrivateLeakAdapter(
  params: GitHubPrivateLeakAdapterParams = {},
): Promise<PrivateLeakAdapter> {
  const octokit = params.octokit ?? createOctokit(params.token)
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const branch = params.branch ?? DEFAULT_BRANCH
  const resolutionCache = new Map<string, Promise<readonly string[]>>()

  return {
    resolvePrivateRepositoryNames: async () => {
      const metadata = await readPrivateMetadata(octokit, owner, repo, branch)
      const cached = resolutionCache.get(metadata.sha)
      if (cached !== undefined) return cached

      const resolution = resolvePrivateRepositoryNames(octokit, metadata.rows)
      resolutionCache.set(metadata.sha, resolution)
      try {
        return await resolution
      } catch (error: unknown) {
        resolutionCache.delete(metadata.sha)
        throw error
      }
    },
  }
}

/**
 * Scan candidate content with the GitHub-backed privacy adapter. Callers may
 * reuse an adapter to cache resolution by the metadata blob SHA, or provide
 * only a token and the request content.
 */
export async function checkPrivateLeakWithGitHub(request: GitHubPrivateLeakScanRequest): Promise<GuardResult> {
  const adapter =
    request.adapter ??
    (await createGitHubPrivateLeakAdapter({
      token: request.token,
      octokit: request.octokit,
    }))

  return checkPrivateLeakWithAdapter(adapter, request)
}

function createOctokit(token: string | undefined): GitHubPrivateLeakClient {
  if (token === undefined || token === '') {
    throw new PrivateLeakAdapterError({
      code: 'MISSING_TOKEN',
      message: 'Request-time privacy scanning requires an explicit GitHub token or Octokit client',
      remediation: 'Pass token or octokit to checkPrivateLeakWithGitHub; workflow environment is not used.',
    })
  }

  try {
    return new Octokit({auth: token})
  } catch (error: unknown) {
    throw new PrivateLeakAdapterError({
      code: 'OCTOKIT_INIT_FAILED',
      message: `Failed to initialize the GitHub client: ${error instanceof Error ? error.message : String(error)}`,
      remediation: 'Verify the GitHub token and @octokit/rest installation before retrying the privacy scan.',
    })
  }
}

async function readPrivateMetadata(
  octokit: GitHubPrivateLeakClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<{readonly sha: string; readonly rows: readonly ScanRow[]}> {
  let response: Awaited<ReturnType<GitHubPrivateLeakClient['rest']['repos']['getContent']>>
  try {
    response = await octokit.rest.repos.getContent({owner, repo, path: METADATA_PATH, ref: branch})
  } catch {
    throw new PrivateLeakAdapterError({
      code: 'METADATA_UNAVAILABLE',
      message: `Unable to read authoritative ${METADATA_PATH}`,
      remediation: `Verify access to ${owner}/${repo}@${branch} and retry the privacy scan.`,
    })
  }

  const payload: unknown = response.data
  if (!isRecord(payload) || payload.type !== 'file' || typeof payload.sha !== 'string' || payload.sha === '') {
    throw new PrivateLeakAdapterError({
      code: 'METADATA_UNAVAILABLE',
      message: `Authoritative ${METADATA_PATH} was not returned as a file with a blob SHA`,
      remediation: `Restore ${METADATA_PATH} on ${owner}/${repo}@${branch} before retrying the privacy scan.`,
    })
  }

  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    throw new PrivateLeakAdapterError({
      code: 'METADATA_UNAVAILABLE',
      message: `Authoritative ${METADATA_PATH} did not contain decodable content`,
      remediation: `Verify the GitHub Contents API response for ${METADATA_PATH} and retry.`,
    })
  }

  let parsed: unknown
  try {
    const yamlText = Buffer.from(payload.content.replaceAll(/\s/g, ''), 'base64').toString('utf8')
    parsed = parse(yamlText)
    assertReposFile(parsed)
  } catch {
    throw new PrivateLeakAdapterError({
      code: 'METADATA_INVALID',
      message: `Authoritative ${METADATA_PATH} is absent or invalid`,
      remediation: `Repair the schema of ${METADATA_PATH} on ${owner}/${repo}@${branch} before retrying.`,
    })
  }

  // The rows to resolve: every row stored private, and every archived row whatever its `private`
  // value. An archived row is stored `private: false` with its real name, and reconcile keeps it
  // unchanged when it cannot see the repository, so the stored value is not trusted. This is a copy
  // of `selectScanRows` in `@fro-bot/privacy`, which a published package cannot import;
  // `private-leak-adapter-agreement.test.ts` there keeps the two equal.
  const rows = parsed.repos
    .filter(entry => entry.private === true || entry.onboarding_status === 'archived')
    .map((entry): ScanRow => ({
      nodeId: typeof entry.node_id === 'string' && entry.node_id !== '' ? entry.node_id : undefined,
      archivedNamed: entry.private !== true,
      storedName: `${entry.owner}/${entry.name}`,
    }))

  // A private row with no node ID cannot be resolved: the scan cannot cover what it cannot identify.
  // An archived named row with none is scanned by its stored name.
  if (rows.some(row => !row.archivedNamed && row.nodeId === undefined)) {
    throw new PrivateLeakAdapterError({
      code: 'RESOLUTION_FAILED',
      message: 'Authoritative metadata contains private entries without resolvable node IDs',
      remediation: 'Repair every private metadata entry with a valid node_id before retrying the privacy scan.',
    })
  }

  return {sha: payload.sha, rows}
}

/**
 * One row to resolve. `archivedNamed` is an archived row not stored private: GitHub's live answer
 * decides it, and a failed lookup does not block (it is scanned by its stored name). A row stored
 * private keeps today's rule: it throws when the lookup fails or GitHub reports it public.
 */
interface ScanRow {
  readonly nodeId: string | undefined
  readonly archivedNamed: boolean
  readonly storedName: string
}

async function resolvePrivateRepositoryNames(
  octokit: GitHubPrivateLeakClient,
  rows: readonly ScanRow[],
): Promise<readonly string[]> {
  const nodeIds = rows.flatMap(row => (row.nodeId === undefined ? [] : [row.nodeId]))
  const lookup = nodeIds.length === 0 ? {nodes: []} : await lookUpNodes(octokit, nodeIds)

  // A failed lookup is an error for a row stored private, and only for such a row.
  if ('error' in lookup && rows.some(row => !row.archivedNamed)) throw lookup.error

  const names: string[] = []
  let position = 0
  for (const row of rows) {
    const node = row.nodeId === undefined || 'error' in lookup ? undefined : lookup.nodes[position]
    if (row.nodeId !== undefined) position += 1
    names.push(...(row.archivedNamed ? archivedRowTokens(row, node) : privateRowTokens(node)))
  }

  return names
}

/** One batched lookup. A failure is returned, not thrown: only a row stored private makes it fatal. */
async function lookUpNodes(
  octokit: GitHubPrivateLeakClient,
  nodeIds: readonly string[],
): Promise<{readonly nodes: readonly unknown[]} | {readonly error: PrivateLeakAdapterError}> {
  let response: unknown
  try {
    response = await octokit.graphql(PRIVATE_REPOSITORIES_QUERY, {ids: nodeIds})
  } catch {
    return {
      error: new PrivateLeakAdapterError({
        code: 'RESOLUTION_FAILED',
        message: 'GitHub could not resolve the authoritative private repository identities',
        remediation: 'Verify token visibility and GitHub API availability, then retry the privacy scan.',
      }),
    }
  }

  const nodes = isRecord(response) ? response.nodes : undefined
  if (!Array.isArray(nodes) || nodes.length !== nodeIds.length) {
    return {
      error: new PrivateLeakAdapterError({
        code: 'RESOLUTION_FAILED',
        message: 'GitHub returned an incomplete private repository resolution response',
        remediation: 'Verify token visibility for every private repository and retry the privacy scan.',
      }),
    }
  }

  return {nodes}
}

/** The tokens for a row stored private; it throws unless GitHub resolves it and does not report it public. */
function privateRowTokens(node: unknown): readonly string[] {
  if (!isRecord(node) || typeof node.nameWithOwner !== 'string' || node.nameWithOwner === '') {
    throw new PrivateLeakAdapterError({
      code: 'RESOLUTION_FAILED',
      message: 'GitHub could not resolve every authoritative private repository identity',
      remediation: 'Verify token visibility for every private repository and retry the privacy scan.',
    })
  }

  if ('isPrivate' in node && node.isPrivate !== true) {
    throw new PrivateLeakAdapterError({
      code: 'RESOLUTION_FAILED',
      message: 'GitHub returned a non-private repository for an authoritative private entry',
      remediation: 'Reconcile metadata visibility before retrying the privacy scan.',
    })
  }

  return buildPrivateNameTokens(node.nameWithOwner)
}

/**
 * The tokens for an archived named row. A node cleared as public contributes none, and it is cleared
 * only when its `visibility` is exactly `PUBLIC` and it carries a live `nameWithOwner` that is a
 * non-blank string: a malformed answer confirms nothing. Anything else (any other visibility, a
 * missing or wrong-typed field, a node that did not resolve, a failed lookup) gives the stored owner
 * and name, and the live owner and name too when the live name is usable: an archived row keeps its
 * stored name through a rename or a transfer on GitHub.
 */
function archivedRowTokens(row: ScanRow, node: unknown): readonly string[] {
  if (!isRecord(node)) return buildPrivateNameTokens(row.storedName)
  const liveName =
    typeof node.nameWithOwner === 'string' && node.nameWithOwner.trim() !== '' ? node.nameWithOwner : undefined
  if (liveName !== undefined && node.visibility === 'PUBLIC') return []
  return [
    ...buildPrivateNameTokens(row.storedName),
    ...(liveName === undefined ? [] : buildPrivateNameTokens(liveName)),
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
