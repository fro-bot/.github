/**
 * Operator-dispatched rename of a tracked repository: prove the rename from GitHub, then land ONE
 * non-force Git Data commit on `fro-bot/.github@data` that renames the `metadata/repos.yaml` row,
 * moves the repo's wiki page, repairs `[[old]]` links and `related:` entries, rebuilds the index and
 * appends a single `manual-edit` log entry. Metadata and wiki never disagree in the resulting commit.
 *
 * Architecture: a pure decision core (`@fro-bot/wiki-write-core`'s `planRepoPageMove`) plus this
 * module's evidence checks and atomic writer, with every client injected. Nothing here calls
 * `commitWikiChanges` or `commitMetadata`: the former replays on conflict and skips deletions on a
 * truncated tree, the latter cannot express a multi-file commit.
 *
 * Safety properties:
 * - The target is the literal `fro-bot/.github@data`. There is no override.
 * - Each attempt rebuilds from the current head; only an `updateRef` 409/422 is retried (3 attempts).
 * - A truncated tree throws. The no-overwrite and path rules run before `createTree`.
 * - Errors carry a fixed code, a phase and an HTTP status. No message, name, path or ID from an
 *   upstream error ever reaches output, and no private repository is named anywhere.
 */

import {Buffer} from 'node:buffer'
import process from 'node:process'

import {
  parseFrontmatterDocument,
  planRepoPageMove,
  type PageChange,
  type PlanRepoPageMoveParams,
  type RepoPageMoveBlockReason,
  type RepoPageMovePlan,
} from '@fro-bot/wiki-write-core'
import {parse, stringify} from 'yaml'

import {assertReposFile, type RepoEntry} from './schemas.ts'
import {buildPrivateTokenSet, computeRepoSlug} from './wiki-slug.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

/** The only write target. Deliberately not configurable. */
const TARGET_OWNER = 'fro-bot'
const TARGET_REPO = '.github'
const TARGET_BRANCH = 'data'
const MAX_ATTEMPTS = 3

const REPOS_PATH = 'metadata/repos.yaml'
const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'
const REPO_PAGE_PATTERN = /^knowledge\/wiki\/repos\/[^/]+\.md$/u
const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/u
const EXPECTED_AUTHORS = new Set<string>(['fro-bot', 'fro-bot[bot]'])

const NODE_ID_PATTERN = /^[\w=-]{1,100}$/u
const OLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[\w.-]{1,100}$/u
const REPO_NAME_PATTERN = /^[\w.-]{1,100}$/u

// ─── Types ──────────────────────────────────────────────────────────────────

/** GitHub facts about one repository, parsed from an untrusted response body. */
interface RepositoryFacts {
  readonly nodeId: string
  readonly owner: string
  readonly name: string
  readonly isPrivate: boolean
}

/** Raw GitHub reads of the renamed repository. Implementations throw errors carrying `status`. */
export interface RenameTransport {
  getRepositoryById: (databaseId: number) => Promise<unknown>
  /** Follows redirects; the old name of a renamed repository resolves to the repository. */
  getRepositoryByName: (owner: string, name: string) => Promise<unknown>
}

/** The Git Data calls the atomic writer needs, structurally satisfied by Octokit. */
export interface GitDataClient {
  rest: {
    repos: {
      getBranch: (params: {owner: string; repo: string; branch: string}) => Promise<{
        data: {
          protected?: boolean
          protection?: {enabled?: boolean}
          commit: {sha: string; author?: {login?: string} | null}
        }
      }>
    }
    git: {
      getRef: (params: {owner: string; repo: string; ref: string}) => Promise<{data: {object: {sha: string}}}>
      getCommit: (params: {owner: string; repo: string; commit_sha: string}) => Promise<{
        data: {sha: string; tree: {sha: string}}
      }>
      getTree: (params: {owner: string; repo: string; tree_sha: string; recursive?: string}) => Promise<{
        data: {truncated: boolean; tree: {path?: string; type?: string; sha?: string}[]}
      }>
      getBlob: (params: {owner: string; repo: string; file_sha: string}) => Promise<{
        data: {content: string; encoding: string}
      }>
      createBlob: (params: {
        owner: string
        repo: string
        content: string
        encoding?: string
      }) => Promise<{data: {sha: string}}>
      createTree: (params: {
        owner: string
        repo: string
        base_tree?: string
        tree: {path?: string; mode?: '100644'; type?: 'blob'; sha?: string | null}[]
      }) => Promise<{data: {sha: string}}>
      createCommit: (params: {
        owner: string
        repo: string
        message: string
        tree: string
        parents?: string[]
      }) => Promise<{data: {sha: string}}>
      updateRef: (params: {
        owner: string
        repo: string
        ref: string
        sha: string
        /** Non-force only: a forced update would overwrite a concurrent `data` commit. */
        force?: false
      }) => Promise<{data: unknown}>
    }
  }
}

type BranchClient = Pick<GitDataClient['rest'], 'repos'>
interface BranchClientLike {
  rest: BranchClient
}

/** A row rewrite, alongside the page operations from the pure planner. */
export type RenameChange = PageChange | {readonly op: 'write-row'; readonly path: string; readonly content: string}

export type RenameBlockReason =
  | RepoPageMoveBlockReason
  | 'row-not-found'
  | 'row-not-public'
  | 'row-missing-database-id'
  | 'row-name-unexpected'
  | 'evidence-malformed'
  | 'node-mismatch'
  | 'owner-mismatch'
  | 'repository-private'
  | 'old-name-required'
  | 'old-name-mismatch'
  | 'old-name-unverifiable'
  | 'old-name-reused'
  | 'residue-unproven'

export type RenameOutcome =
  | {
      readonly result: 'renamed'
      readonly commit: string
      readonly attempts: number
      readonly page: 'moved' | 'edited-in-place' | 'metadata-only'
    }
  | {readonly result: 'noop'}
  | {readonly result: 'blocked'; readonly reason: RenameBlockReason}

export interface RenameDeps {
  /** Evidence reads about the target repository (the unprivileged `GITHUB_TOKEN`). */
  readonly transport: RenameTransport
  /** Contents-write client for `fro-bot/.github` only. */
  readonly writer: GitDataClient
  readonly nodeId: string
  /** `owner/name` of the previous name; required only when the row already holds the new name. */
  readonly oldName?: string
  readonly now?: () => Date
  /** Test seam: the pure planner. */
  readonly planMove?: (params: PlanRepoPageMoveParams) => RepoPageMovePlan
}

export type RenamePhase =
  | 'input'
  | 'evidence'
  | 'integrity'
  | 'readHead'
  | 'readTree'
  | 'readBlob'
  | 'parse'
  | 'policy'
  | 'createBlob'
  | 'createTree'
  | 'createCommit'
  | 'updateRef'

export type RenameErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_TOKEN'
  | 'EVIDENCE_FAILED'
  | 'INTEGRITY_FAILED'
  | 'PROTECTED_BRANCH'
  | 'READ_FAILED'
  | 'TREE_TRUNCATED'
  | 'METADATA_INVALID'
  | 'PATH_POLICY'
  | 'OVERWRITE'
  | 'BLOB_FAILED'
  | 'TREE_INVALID'
  | 'TREE_FAILED'
  | 'COMMIT_FAILED'
  | 'REF_UPDATE_FAILED'
  | 'RETRIES_EXHAUSTED'

/** A failure reduced to a code, a phase and an HTTP status. It never carries upstream text. */
export class RenameError extends Error {
  readonly code: RenameErrorCode
  readonly phase: RenamePhase
  readonly status: number | undefined

  constructor(params: {code: RenameErrorCode; phase: RenamePhase; status?: number}) {
    super(
      `rename-tracked-repo: ${params.code} (phase=${params.phase}${params.status === undefined ? '' : `, status=${params.status}`})`,
    )
    this.name = 'RenameError'
    this.code = params.code
    this.phase = params.phase
    this.status = params.status
  }
}

/** An `updateRef` that lost a race: rebuild from the fresh head. Internal to the retry loop. */
class RefRaceError extends Error {
  readonly status: number
  constructor(status: number) {
    super('ref race')
    this.status = status
  }
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

/** Run one API call; any failure becomes a status-only `RenameError` for `phase`. */
async function guarded<T>(
  phase: RenamePhase,
  code: RenameErrorCode | ((status: number | undefined) => RenameErrorCode),
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call()
  } catch (error: unknown) {
    if (error instanceof RenameError || error instanceof RefRaceError) throw error
    const status = statusOf(error)
    throw new RenameError({code: typeof code === 'function' ? code(status) : code, phase, status})
  }
}

function blockedOutcome(reason: RenameBlockReason): RenameOutcome {
  return {result: 'blocked', reason}
}

function serializeYaml(value: unknown): string {
  const serialized = stringify(value, {indent: 2, lineWidth: 0, singleQuote: true})
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}

// ─── Branch safety ──────────────────────────────────────────────────────────

/**
 * Same semantics as the private `assertWritableBranch` in `commit-metadata.ts` and `wiki-ingest.ts`:
 * never `main`; never a protected branch except the canonical `fro-bot/.github@data`, whose ruleset
 * reports it as protected while bypassing the App by actor.
 */
export async function assertWritableBranch(
  client: BranchClientLike,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  if (branch === 'main') throw new RenameError({code: 'PROTECTED_BRANCH', phase: 'integrity'})

  const response = await guarded('integrity', 'READ_FAILED', async () =>
    client.rest.repos.getBranch({owner, repo, branch}),
  )
  const protectedBranch = response.data.protected === true || response.data.protection?.enabled === true
  const canonical = owner === TARGET_OWNER && repo === TARGET_REPO && branch === TARGET_BRANCH
  if (protectedBranch && !canonical) throw new RenameError({code: 'PROTECTED_BRANCH', phase: 'integrity'})
}

/** The tip commit must be authored by Fro Bot, and must be the head this attempt builds on. */
async function assertTipIntegrity(client: GitDataClient, headSha: string): Promise<void> {
  const response = await guarded('integrity', 'READ_FAILED', async () =>
    client.rest.repos.getBranch({owner: TARGET_OWNER, repo: TARGET_REPO, branch: TARGET_BRANCH}),
  )
  const login = response.data.commit.author?.login
  if (typeof login !== 'string' || !EXPECTED_AUTHORS.has(login)) {
    throw new RenameError({code: 'INTEGRITY_FAILED', phase: 'integrity'})
  }
  if (response.data.commit.sha !== headSha) throw new RefRaceError(409)
}

// ─── Evidence ───────────────────────────────────────────────────────────────

function parseRepositoryFacts(raw: unknown): RepositoryFacts | undefined {
  if (!isRecord(raw) || !isRecord(raw.owner)) return undefined
  const {node_id: nodeId, name} = raw
  const login = raw.owner.login
  if (typeof nodeId !== 'string' || nodeId === '') return undefined
  if (typeof login !== 'string' || login === '') return undefined
  if (typeof name !== 'string' || !REPO_NAME_PATTERN.test(name) || name === '.' || name === '..') return undefined
  if (typeof raw.private !== 'boolean') return undefined
  return {nodeId, owner: login, name, isPrivate: raw.private}
}

interface Identity {
  readonly newName: string
}

/** Prove, from GitHub's own record, that this row's repository is now called `newName`. */
async function proveIdentity(
  transport: RenameTransport,
  row: RepoEntry & {database_id: number},
): Promise<Identity | RenameOutcome> {
  const raw = await guarded('evidence', 'EVIDENCE_FAILED', async () => transport.getRepositoryById(row.database_id))
  const facts = parseRepositoryFacts(raw)
  if (facts === undefined) return blockedOutcome('evidence-malformed')
  if (facts.nodeId !== row.node_id) return blockedOutcome('node-mismatch')
  if (facts.owner !== row.owner) return blockedOutcome('owner-mismatch')
  if (facts.isPrivate) return blockedOutcome('repository-private')
  return {newName: facts.name}
}

interface ParsedOldName {
  readonly owner: string
  readonly name: string
}

function parseOldName(input: string): ParsedOldName | undefined {
  if (!OLD_NAME_PATTERN.test(input)) return undefined
  const slash = input.indexOf('/')
  const name = input.slice(slash + 1)
  if (name === '.' || name === '..') return undefined
  return {owner: input.slice(0, slash), name}
}

/** The residue case: the row already holds the new name, so the old name must be proven separately. */
async function proveResidueOldName(
  transport: RenameTransport,
  row: RepoEntry,
  newName: string,
  input: string | undefined,
): Promise<string | RenameOutcome> {
  if (input === undefined) return blockedOutcome('old-name-required')
  const parsed = parseOldName(input)
  if (parsed === undefined || parsed.owner !== row.owner || parsed.name === newName) {
    return blockedOutcome('old-name-mismatch')
  }

  let raw: unknown
  try {
    raw = await transport.getRepositoryByName(parsed.owner, parsed.name)
  } catch (error: unknown) {
    if (statusOf(error) === 404) return blockedOutcome('old-name-unverifiable')
    throw new RenameError({code: 'EVIDENCE_FAILED', phase: 'evidence', status: statusOf(error)})
  }
  const facts = parseRepositoryFacts(raw)
  if (facts === undefined) return blockedOutcome('evidence-malformed')
  if (facts.nodeId !== row.node_id) return blockedOutcome('old-name-reused')
  if (facts.name !== newName) return blockedOutcome('old-name-unverifiable')
  return parsed.name
}

function isOutcome(value: Identity | string | RenameOutcome): value is RenameOutcome {
  return typeof value !== 'string' && 'result' in value
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

interface Snapshot {
  readonly headSha: string
  readonly treeSha: string
  /** Path → content for the metadata file, index, log and wiki pages. */
  readonly files: Record<string, string>
  /** Every blob path in the head tree. */
  readonly paths: ReadonlySet<string>
}

async function readSnapshot(client: GitDataClient): Promise<Snapshot> {
  const target = {owner: TARGET_OWNER, repo: TARGET_REPO}
  await assertWritableBranch(client, TARGET_OWNER, TARGET_REPO, TARGET_BRANCH)

  const ref = await guarded('readHead', 'READ_FAILED', async () =>
    client.rest.git.getRef({...target, ref: `heads/${TARGET_BRANCH}`}),
  )
  const headSha = ref.data.object.sha
  await assertTipIntegrity(client, headSha)

  const commit = await guarded('readHead', 'READ_FAILED', async () =>
    client.rest.git.getCommit({...target, commit_sha: headSha}),
  )
  const treeSha = commit.data.tree.sha
  const tree = await guarded('readTree', 'READ_FAILED', async () =>
    client.rest.git.getTree({...target, tree_sha: treeSha, recursive: 'true'}),
  )
  // A truncated tree would hide pages from the collision and overwrite checks: fail closed.
  if (tree.data.truncated) throw new RenameError({code: 'TREE_TRUNCATED', phase: 'readTree'})

  const paths = new Set<string>()
  const wanted: {path: string; sha: string}[] = []
  for (const entry of tree.data.tree) {
    if (entry.type !== 'blob' || entry.path === undefined || entry.sha === undefined) continue
    paths.add(entry.path)
    if (isReadablePath(entry.path)) wanted.push({path: entry.path, sha: entry.sha})
  }

  const files: Record<string, string> = {}
  for (const {path, sha} of wanted) {
    const blob = await guarded('readBlob', 'READ_FAILED', async () =>
      client.rest.git.getBlob({...target, file_sha: sha}),
    )
    files[path] = Buffer.from(blob.data.content, 'base64').toString('utf8')
  }
  return {headSha, treeSha, files, paths}
}

function isReadablePath(path: string): boolean {
  return path === REPOS_PATH || path === INDEX_PATH || path === LOG_PATH || WIKI_PAGE_PATTERN.test(path)
}

interface RowView {
  readonly document: Record<string, unknown>
  readonly rows: readonly RepoEntry[]
  readonly row: RepoEntry | undefined
}

function readRows(files: Record<string, string>, nodeId: string): RowView {
  try {
    const document: unknown = parse(files[REPOS_PATH] ?? '')
    assertReposFile(document)
    if (!isRecord(document)) throw new TypeError('not a record')
    return {document, rows: document.repos, row: document.repos.find(candidate => candidate.node_id === nodeId)}
  } catch {
    throw new RenameError({code: 'METADATA_INVALID', phase: 'parse'})
  }
}

// ─── Policy ─────────────────────────────────────────────────────────────────

interface PolicyContext {
  readonly files: Readonly<Record<string, string>>
  readonly paths: ReadonlySet<string>
  readonly nodeId: string
  readonly oldSlug: string
  readonly oldUrl: string
}

function policyViolation(code: 'PATH_POLICY' | 'OVERWRITE'): never {
  throw new RenameError({code, phase: 'policy'})
}

/**
 * The no-overwrite invariant and per-operation path rules, checked before `createTree`:
 * - a created page must be absent at head;
 * - an in-place edit may touch only a page of this node (or a legacy page naming the old URL);
 * - deletions are allowed only under `knowledge/wiki/repos/`, and only for a present file;
 * - link repairs touch only wiki pages that actually contain the old slug;
 * - the log is only appended to, the index and `metadata/repos.yaml` only edited;
 * - anything else, `knowledge/wiki/README.md` included, is rejected.
 */
export function assertChangePolicy(changes: readonly RenameChange[], context: PolicyContext): void {
  for (const change of changes) {
    switch (change.op) {
      case 'create-page':
        if (!REPO_PAGE_PATTERN.test(change.path)) policyViolation('PATH_POLICY')
        if (context.paths.has(change.path)) policyViolation('OVERWRITE')
        break
      case 'edit-page':
        if (!REPO_PAGE_PATTERN.test(change.path) || !context.paths.has(change.path)) policyViolation('PATH_POLICY')
        if (!isAttributedPage(context.files[change.path], context)) policyViolation('PATH_POLICY')
        break
      case 'delete-page':
        if (!REPO_PAGE_PATTERN.test(change.path) || !context.paths.has(change.path)) policyViolation('PATH_POLICY')
        break
      case 'repair-links':
        if (!WIKI_PAGE_PATTERN.test(change.path) || !context.paths.has(change.path)) policyViolation('PATH_POLICY')
        if (!(context.files[change.path] ?? '').includes(context.oldSlug)) policyViolation('PATH_POLICY')
        break
      case 'write-index':
        if (change.path !== INDEX_PATH) policyViolation('PATH_POLICY')
        break
      case 'append-log':
        if (change.path !== LOG_PATH || !change.content.startsWith(context.files[LOG_PATH] ?? '')) {
          policyViolation('PATH_POLICY')
        }
        break
      case 'write-row':
        if (change.path !== REPOS_PATH || !context.paths.has(REPOS_PATH)) policyViolation('PATH_POLICY')
        break
      default:
        // Exhaustiveness guard: a new op must get a rule above. At compile time this fails to
        // type-check; at runtime it rejects rather than letting an unreviewed op through.
        rejectUnhandledOp(change)
    }
  }
}

function rejectUnhandledOp(_change: never): never {
  return policyViolation('PATH_POLICY')
}

function isAttributedPage(content: string | undefined, context: PolicyContext): boolean {
  if (content === undefined) return false
  try {
    const {values} = parseFrontmatterDocument(content)
    if (values.node_id !== undefined) return values.node_id === context.nodeId
    const sources = values.sources
    return (
      Array.isArray(sources) && sources.some((source: unknown) => isRecord(source) && source.url === context.oldUrl)
    )
  } catch {
    return false
  }
}

// ─── The atomic writer ──────────────────────────────────────────────────────

export async function renameTrackedRepo(deps: RenameDeps): Promise<RenameOutcome> {
  const planMove = deps.planMove ?? planRepoPageMove
  const now = deps.now ?? (() => new Date())
  // Identity (what GitHub says the repository is now called) is proven once and reused when a
  // retry rebuilds; everything about the data branch is re-read on every attempt.
  let identity: Identity | undefined
  let knownOldName: string | undefined

  const attemptOnce = async (attempt: number): Promise<RenameOutcome> => {
    const snapshot = await readSnapshot(deps.writer)
    const view = readRows(snapshot.files, deps.nodeId)
    const {row} = view
    if (row === undefined) return blockedOutcome('row-not-found')
    if (row.private !== false || row.owner === '[REDACTED]') return blockedOutcome('row-not-public')
    if (typeof row.database_id !== 'number') return blockedOutcome('row-missing-database-id')

    if (identity === undefined) {
      const proven = await proveIdentity(deps.transport, {...row, database_id: row.database_id})
      if (isOutcome(proven)) return proven
      identity = proven
    }
    const {newName} = identity

    // Already applied? Decided from the data alone, so it needs no old name.
    if (row.name === newName && newPageIsThisNodes(snapshot.files, row.owner, newName, deps.nodeId)) {
      return {result: 'noop'}
    }

    // The old name is fixed on the first attempt: from the row if it still holds it, otherwise from
    // the proven operator input. A rebuild that finds the row holding anything else must stop.
    if (knownOldName === undefined) {
      if (row.name === newName) {
        const proven = await proveResidueOldName(deps.transport, row, newName, deps.oldName)
        if (isOutcome(proven)) return proven
        knownOldName = proven
      } else {
        if (deps.oldName !== undefined && deps.oldName !== `${row.owner}/${row.name}`) {
          return blockedOutcome('old-name-mismatch')
        }
        knownOldName = row.name
      }
    }
    const oldName = knownOldName
    if (row.name !== oldName && row.name !== newName) return blockedOutcome('row-name-unexpected')

    const oldSlug = safeSlug(row.owner, oldName)
    const oldUrl = `https://github.com/${row.owner}/${oldName}`
    // Residue: a page still at the old slug must carry the exact old URL in its structured sources.
    if (row.name === newName && oldSlug !== undefined && !oldPageNamesUrl(snapshot.files, oldSlug, oldUrl)) {
      return blockedOutcome('residue-unproven')
    }

    const others = view.rows.filter(candidate => candidate !== row)
    const plan = planMove({
      files: snapshot.files,
      nodeId: deps.nodeId,
      owner: row.owner,
      oldName,
      newName,
      rowName: row.name,
      otherRows: others.map(other => ({owner: other.owner, name: other.name})),
      privateTokens: privateTokensOf(others),
      timestamp: now(),
    })

    if (plan.outcome === 'blocked') return blockedOutcome(plan.reason)
    if (plan.outcome === 'already-applied') return {result: 'noop'}

    const changes: RenameChange[] = []
    if (row.name !== newName) {
      changes.push({op: 'write-row', path: REPOS_PATH, content: renameRow(view, deps.nodeId, newName)})
    }
    if (plan.outcome !== 'metadata-only') changes.push(...plan.changes)
    if (changes.length === 0) return {result: 'noop'}

    assertChangePolicy(changes, {
      files: snapshot.files,
      paths: snapshot.paths,
      nodeId: deps.nodeId,
      oldSlug: oldSlug ?? '',
      oldUrl,
    })

    const message = `chore(rename): ${row.owner}/${oldName} -> ${row.owner}/${newName}`
    const commit = await writeCommit(deps.writer, snapshot, changes, message)
    return {result: 'renamed', commit, attempts: attempt, page: plan.outcome}
  }

  let lastRace = 409
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await attemptOnce(attempt)
    } catch (error: unknown) {
      if (!(error instanceof RefRaceError)) throw error
      lastRace = error.status
    }
  }
  throw new RenameError({code: 'RETRIES_EXHAUSTED', phase: 'updateRef', status: lastRace})
}

function safeSlug(owner: string, name: string): string | undefined {
  try {
    return computeRepoSlug(owner, name)
  } catch {
    return undefined
  }
}

function oldPageNamesUrl(files: Readonly<Record<string, string>>, oldSlug: string, oldUrl: string): boolean {
  const content = files[`knowledge/wiki/repos/${oldSlug}.md`]
  if (content === undefined) return true
  try {
    const sources = parseFrontmatterDocument(content).values.sources
    return Array.isArray(sources) && sources.some((source: unknown) => isRecord(source) && source.url === oldUrl)
  } catch {
    return false
  }
}

/** A page at the new slug that already carries this node's ID means the move has been applied. */
function newPageIsThisNodes(
  files: Readonly<Record<string, string>>,
  owner: string,
  newName: string,
  nodeId: string,
): boolean {
  const slug = safeSlug(owner, newName)
  const content = slug === undefined ? undefined : files[`knowledge/wiki/repos/${slug}.md`]
  if (content === undefined) return false
  try {
    return parseFrontmatterDocument(content).values.node_id === nodeId
  } catch {
    return false
  }
}

/** Private-name tokens from private rows that still carry a real name (redacted rows have none to give). */
function privateTokensOf(rows: readonly RepoEntry[]): ReadonlySet<string> {
  const names = rows.flatMap(row =>
    row.private === true && row.owner !== '[REDACTED]' && row.name !== '[REDACTED]' ? [`${row.owner}/${row.name}`] : [],
  )
  return buildPrivateTokenSet(names)
}

/** Rename one row and nothing else, serialized with the same options `commitMetadata` uses. */
function renameRow(view: RowView, nodeId: string, newName: string): string {
  const rows = view.rows.map(row => (row.node_id === nodeId ? {...row, name: newName} : row))
  return serializeYaml({...view.document, repos: rows})
}

async function writeCommit(
  client: GitDataClient,
  snapshot: Snapshot,
  changes: readonly RenameChange[],
  message: string,
): Promise<string> {
  const target = {owner: TARGET_OWNER, repo: TARGET_REPO}
  const tree: {path: string; mode: '100644'; type: 'blob'; sha: string | null}[] = []
  for (const change of changes) {
    if (change.op === 'delete-page') {
      tree.push({path: change.path, mode: '100644', type: 'blob', sha: null})
      continue
    }
    const blob = await guarded('createBlob', 'BLOB_FAILED', async () =>
      client.rest.git.createBlob({...target, content: change.content, encoding: 'utf-8'}),
    )
    tree.push({path: change.path, mode: '100644', type: 'blob', sha: blob.data.sha})
  }

  const created = await guarded(
    'createTree',
    status => (status === 422 ? 'TREE_INVALID' : 'TREE_FAILED'),
    async () => client.rest.git.createTree({...target, base_tree: snapshot.treeSha, tree}),
  )
  const commit = await guarded('createCommit', 'COMMIT_FAILED', async () =>
    client.rest.git.createCommit({...target, message, tree: created.data.sha, parents: [snapshot.headSha]}),
  )

  try {
    await client.rest.git.updateRef({
      ...target,
      ref: `heads/${TARGET_BRANCH}`,
      sha: commit.data.sha,
      force: false,
    })
  } catch (error: unknown) {
    const status = statusOf(error)
    // 409/422: the branch moved (or this is not a fast-forward). Rebuild from the new head.
    if (status === 409 || status === 422) throw new RefRaceError(status)
    throw new RenameError({code: 'REF_UPDATE_FAILED', phase: 'updateRef', status})
  }
  return commit.data.sha
}

// ─── CLI ────────────────────────────────────────────────────────────────────

/** Seams for {@link runCli}; the defaults are the real Octokit clients and the process streams. */
export interface CliDeps {
  createTransport?: (token: string) => RenameTransport | Promise<RenameTransport>
  createWriter?: (token: string) => GitDataClient | Promise<GitDataClient>
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  now?: () => Date
}

async function createRealTransport(token: string): Promise<RenameTransport> {
  const {Octokit} = await import('@octokit/rest')
  const octokit = new Octokit({auth: token})
  return {
    getRepositoryById: async databaseId => {
      const response: {data: unknown} = await octokit.request('GET /repositories/{repository_id}', {
        repository_id: databaseId,
      })
      return response.data
    },
    getRepositoryByName: async (owner, name) => {
      const response: {data: unknown} = await octokit.rest.repos.get({owner, repo: name})
      return response.data
    },
  }
}

async function createRealWriter(token: string): Promise<GitDataClient> {
  const {Octokit} = await import('@octokit/rest')
  return new Octokit({auth: token})
}

const BLOCK_HINTS: Partial<Record<RenameBlockReason, string>> = {
  'both-pages-present':
    'Pages exist at both the old and the new slug: remove one of the two pages by hand on the data branch, then dispatch again.',
  'page-ahead-of-row':
    'A page already sits at the new slug while the row holds the old name: rename the row by hand on the data branch, then dispatch again.',
}

/**
 * The CLI entry, with its environment and I/O injected. Returns the exit code.
 * `NODE_ID` is required; `OLD_NAME` (`owner/name`) only for the residue state. `GITHUB_TOKEN`
 * (unprivileged) feeds the evidence reads and `RENAME_WRITER_TOKEN` (contents write, this repo only)
 * feeds the write.
 */
export async function runCli(env: Record<string, string | undefined>, deps: CliDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text))
  const fail = (line: string): number => {
    stderr(`::error::rename-tracked-repo: ${line}\n`)
    return 1
  }

  const nodeId = env.NODE_ID
  if (nodeId === undefined || !NODE_ID_PATTERN.test(nodeId)) return fail('INVALID_INPUT (field=node_id)')
  const oldNameInput = env.OLD_NAME === undefined || env.OLD_NAME === '' ? undefined : env.OLD_NAME
  if (oldNameInput !== undefined && parseOldName(oldNameInput) === undefined) {
    return fail('INVALID_INPUT (field=old_name)')
  }
  for (const name of ['GITHUB_TOKEN', 'RENAME_WRITER_TOKEN'] as const) {
    const value = env[name]
    if (value === undefined || value === '') return fail(`MISSING_TOKEN (name=${name})`)
  }

  try {
    const transport = await (deps.createTransport ?? createRealTransport)(env.GITHUB_TOKEN ?? '')
    const writer = await (deps.createWriter ?? createRealWriter)(env.RENAME_WRITER_TOKEN ?? '')
    const outcome = await renameTrackedRepo({transport, writer, nodeId, oldName: oldNameInput, now: deps.now})

    if (outcome.result === 'blocked') {
      return fail(
        `blocked (reason=${outcome.reason}). ${BLOCK_HINTS[outcome.reason] ?? 'Nothing was written.'} See metadata/README.md, "Applying a rename".`,
      )
    }
    stdout(
      outcome.result === 'noop'
        ? '{"result":"noop"}\n'
        : `${JSON.stringify({result: 'renamed', page: outcome.page, attempts: outcome.attempts, commit: outcome.commit})}\n`,
    )
    return 0
  } catch (error: unknown) {
    // A RenameError message is already status-only. Anything else is reduced to a fixed line.
    return fail(
      error instanceof RenameError ? error.message.replace('rename-tracked-repo: ', '') : 'UNEXPECTED_FAILURE',
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await runCli(process.env))
}
