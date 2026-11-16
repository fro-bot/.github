/**
 * Operator-dispatched lifecycle of a tracked repository: prove the change from GitHub, then land ONE
 * non-force Git Data commit on `fro-bot/.github@data`. The default action, `apply`, renames the
 * `metadata/repos.yaml` row, moves the repo's wiki page, repairs `[[old]]` links and `related:`
 * entries, rebuilds the index and appends a single `manual-edit` log entry. `archive` and `unarchive`
 * (see `lifecycleTrackedRepo`) set or clear the row's `archived` state together with the page's
 * archive date and notice. Metadata and wiki never disagree in the resulting commit.
 *
 * Architecture: a pure decision core (`@fro.bot/wiki-write-core`'s `planRepoPageMove`) plus this
 * module's evidence checks and atomic writer, with every client injected. Nothing here calls
 * `commitWikiChanges` or `commitMetadata`: the former replays on conflict and skips deletions on a
 * truncated tree, the latter cannot express a multi-file commit. This is the one metadata writer
 * outside `commitMetadata`, by design: the row and the page move must land in a single commit.
 *
 * No private-name collision check runs, here or at promotion: private rows are stored redacted and
 * this workflow never reads the access list. That is accepted, because a renamed repository is public,
 * so its new name is already public information.
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
import {isDeepStrictEqual} from 'node:util'

import {createOctokit} from '@fro-bot/core/github'
import {retry} from '@fro-bot/core/retry'
import {
  appendLogEntry,
  assertBranchWritable,
  attributesPageTo,
  pageReflectsRename,
  pageSourceUrls,
  parseFrontmatterDocument,
  planRepoPageMove,
  rebuildWikiIndex,
  renderFrontmatterDocument,
  WikiIngestError,
  type BranchProtectionClient,
  type PageChange,
  type PlanRepoPageMoveParams,
  type RepoPageMoveBlockReason,
  type RepoPageMovePlan,
} from '@fro.bot/wiki-write-core'
import {assertReposFile, NODE_ID_PATTERN, type RepoEntry} from '@fro.bot/wiki-write-core/schemas'
import {computeRepoSlug} from '@fro.bot/wiki-write-core/wiki-slug'
import {hasArchiveNotice, withArchiveNotice, withoutArchiveNotice} from '@fro.bot/wiki-write-core/wiki-utils'
import {parse, stringify} from 'yaml'

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

const NODE_ID_MAX_LENGTH = 100
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
  /**
   * The GraphQL `node(id:)` result for a repository node: `id`, `databaseId`, `name`, `owner.login`,
   * `visibility` and `isArchived`, or `null`. Used by `archive` and `unarchive`.
   */
  getRepositoryByNodeId: (nodeId: string) => Promise<unknown>
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
  | 'identity-not-confirmed'
  | 'duplicate-identity'
  | 'ambiguous-legacy-match'
  | 'repository-archived'

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

interface Blocked {
  readonly result: 'blocked'
  readonly reason: RenameBlockReason
}

function blockedOutcome(reason: RenameBlockReason): Blocked {
  return {result: 'blocked', reason}
}

function serializeYaml(value: unknown): string {
  const serialized = stringify(value, {indent: 2, lineWidth: 0, singleQuote: true})
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}

// ─── Branch safety ──────────────────────────────────────────────────────────

/**
 * The shared branch-safety rule (`assertBranchWritable` in wiki-write-core, also used by
 * `commit-metadata.ts` and `wiki-ingest.ts`), reported as this module's status-only error.
 */
export async function assertWritableBranch(
  client: BranchProtectionClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  await guarded('integrity', 'READ_FAILED', async () =>
    assertBranchWritable(client, owner, repo, branch, () => {
      throw new RenameError({code: 'PROTECTED_BRANCH', phase: 'integrity'})
    }),
  )
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
    return attributesPageTo(parseFrontmatterDocument(content), context.nodeId, context.oldUrl)
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

    // Already applied? Decided from the data alone, so it needs no old name. It is only applied if
    // no page for this node is left at the old slug: two pages for one node is a named block.
    if (row.name === newName && newPageIsThisNodes(snapshot.files, row.owner, newName, deps.nodeId)) {
      return hasStrayNodePage(snapshot.files, row.owner, newName, deps.nodeId, deps.oldName)
        ? blockedOutcome('both-pages-present')
        : {result: 'noop'}
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

  try {
    return await retry(attemptOnce, {attempts: MAX_ATTEMPTS, shouldRetry: error => error instanceof RefRaceError})
  } catch (error: unknown) {
    if (!(error instanceof RefRaceError)) throw error
    throw new RenameError({code: 'RETRIES_EXHAUSTED', phase: 'updateRef', status: error.status})
  }
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
    return pageSourceUrls(parseFrontmatterDocument(content)).includes(oldUrl)
  } catch {
    return false
  }
}

/**
 * Whether a repo page for this node still sits somewhere other than the new slug. A page counts
 * when it carries this node's ID, or, if `oldName` is given, when the shared attribution rule ties it
 * to the old URL. With `oldName`, a page at the old slug that cannot be parsed also counts: it may be
 * this node's page, and the move must not be reported as applied over it. Without `oldName` the old
 * slug is unknown, so an unparseable page, or one with no ID, cannot be told from an unrelated one
 * and is not detected here.
 */
function hasStrayNodePage(
  files: Readonly<Record<string, string>>,
  owner: string,
  newName: string,
  nodeId: string,
  oldName: string | undefined,
): boolean {
  const pagePath = (name: string): string | undefined => {
    const slug = safeSlug(owner, name)
    return slug === undefined ? undefined : `knowledge/wiki/repos/${slug}.md`
  }
  const newPath = pagePath(newName)
  const parsedOld = oldName === undefined ? undefined : parseOldName(oldName)
  const named = parsedOld === undefined || parsedOld.owner !== owner ? undefined : parsedOld
  const oldUrl = named === undefined ? undefined : `https://github.com/${owner}/${named.name}`
  const oldPath = named === undefined ? undefined : pagePath(named.name)
  return Object.entries(files).some(([path, content]) => {
    if (!REPO_PAGE_PATTERN.test(path) || path === newPath) return false
    try {
      const document = parseFrontmatterDocument(content)
      return oldUrl === undefined ? document.values.node_id === nodeId : attributesPageTo(document, nodeId, oldUrl)
    } catch {
      return path === oldPath
    }
  })
}

/**
 * A page at the new slug that already carries this node's ID, the new title and the new URL means the
 * move has been applied. A page with the node's ID but the old frontmatter (a same-slug residue) does
 * not: it falls through to the planner, which repairs it in place.
 */
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
    return pageReflectsRename(parseFrontmatterDocument(content), nodeId, owner, newName)
  } catch {
    return false
  }
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

// ─── Archive and unarchive ──────────────────────────────────────────────────

export type LifecycleAction = 'archive' | 'unarchive'

const ARCHIVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const REDACTED_OWNER = '[REDACTED]'

/** GitHub's record of one repository node, parsed from the untrusted `node(id:)` result. */
interface NodeFacts {
  readonly nodeId: string
  readonly databaseId: number
  readonly owner: string
  readonly name: string
  readonly isPublic: boolean
  readonly isArchived: boolean
}

export type LifecycleOutcome =
  | {
      readonly result: 'archived' | 'unarchived'
      readonly commit: string
      readonly attempts: number
      readonly page: 'edited' | 'missing'
    }
  | {readonly result: 'noop'; readonly state: 'archived' | 'not-archived'}
  | {readonly result: 'blocked'; readonly reason: RenameBlockReason}

export interface LifecycleDeps {
  /** Evidence reads (the unprivileged `GITHUB_TOKEN`); only `getRepositoryByNodeId` is used. */
  readonly transport: RenameTransport
  /** Contents-write client for `fro-bot/.github` only. */
  readonly writer: GitDataClient
  readonly action: LifecycleAction
  readonly nodeId: string
  readonly now?: () => Date
}

function parseNodeFacts(raw: unknown): NodeFacts | undefined {
  if (!isRecord(raw) || !isRecord(raw.owner)) return undefined
  const {id, databaseId, name, visibility, isArchived} = raw
  const login = raw.owner.login
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof databaseId !== 'number' || !Number.isSafeInteger(databaseId) || databaseId <= 0) return undefined
  if (typeof login !== 'string' || login === '') return undefined
  if (typeof name !== 'string' || !REPO_NAME_PATTERN.test(name) || name === '.' || name === '..') return undefined
  if (typeof visibility !== 'string' || typeof isArchived !== 'boolean') return undefined
  return {nodeId: id, databaseId, owner: login, name, isPublic: visibility === 'PUBLIC', isArchived}
}

/** A row stored redacted: its name is the node ID, so it cannot name a page. */
function isRedactedRow(row: RepoEntry): boolean {
  return row.owner === REDACTED_OWNER || row.private === true
}

function pagePathFor(owner: string, name: string): string | undefined {
  const slug = safeSlug(owner, name)
  return slug === undefined ? undefined : `knowledge/wiki/repos/${slug}.md`
}

/** The state the action would reach is already the row's: nothing to write. */
function alreadyInState(action: LifecycleAction, row: RepoEntry): LifecycleOutcome | undefined {
  if (action === 'archive' && row.onboarding_status === 'archived' && !isRedactedRow(row)) {
    return {result: 'noop', state: 'archived'}
  }
  if (action === 'unarchive' && row.onboarding_status !== 'archived') return {result: 'noop', state: 'not-archived'}
  return undefined
}

/**
 * A row with no stored node ID is accepted for `node` only when GitHub's owner and name equal exactly one
 * such row, and exactly one repo page lists the repository's URL in its `sources` (and sits at its slug).
 */
function findLegacyRow(
  files: Readonly<Record<string, string>>,
  rows: readonly RepoEntry[],
  facts: NodeFacts,
): RepoEntry | Blocked {
  const candidates = rows.filter(
    row => row.node_id === undefined && row.owner === facts.owner && row.name === facts.name,
  )
  if (candidates.length === 0) return blockedOutcome('row-not-found')
  const [candidate] = candidates
  if (candidates.length > 1 || candidate === undefined) return blockedOutcome('ambiguous-legacy-match')

  const url = `https://github.com/${facts.owner}/${facts.name}`
  const listing = Object.entries(files).filter(([path, content]) => {
    if (!REPO_PAGE_PATTERN.test(path)) return false
    try {
      return pageSourceUrls(parseFrontmatterDocument(content)).includes(url)
    } catch {
      return false
    }
  })
  if (listing.length !== 1 || listing[0]?.[0] !== pagePathFor(facts.owner, facts.name)) {
    return blockedOutcome('ambiguous-legacy-match')
  }
  return candidate
}

function isLegacyBlock(value: RepoEntry | Blocked): value is Blocked {
  return 'result' in value
}

function lifecycleRow(action: LifecycleAction, row: RepoEntry, facts: NodeFacts): RepoEntry {
  if (action === 'unarchive') return {...row, onboarding_status: 'pending'}
  const named = isRedactedRow(row) ? {owner: facts.owner, name: facts.name} : {}
  return {
    ...row,
    ...named,
    onboarding_status: 'archived',
    private: false,
    node_id: row.node_id ?? facts.nodeId,
    database_id: row.database_id ?? facts.databaseId,
  }
}

/** The page after the action: archive writes the date and the notice, unarchive removes both. */
function lifecyclePage(action: LifecycleAction, content: string, today: string): string {
  try {
    const document = parseFrontmatterDocument(content)
    const values = {...document.values}
    if (action === 'archive') {
      const kept = values.archived
      values.archived = typeof kept === 'string' && kept !== '' ? kept : today
      return renderFrontmatterDocument(values, withArchiveNotice(document.body))
    }
    delete values.archived
    return renderFrontmatterDocument(values, withoutArchiveNotice(document.body))
  } catch {
    throw new RenameError({code: 'PATH_POLICY', phase: 'policy'})
  }
}

function valuesWithout(values: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => name !== key))
}

/** Fields an `archive` may change on the row, and when. */
function rowChangeAllowed(action: LifecycleAction, key: string, before: RepoEntry, after: RepoEntry): boolean {
  const field = key as keyof RepoEntry
  if (key === 'onboarding_status') return after.onboarding_status === (action === 'archive' ? 'archived' : 'pending')
  if (action === 'unarchive') return false
  if (key === 'private') return after.private === false
  if (key === 'owner' || key === 'name') return isRedactedRow(before)
  if (key === 'node_id' || key === 'database_id') return before[field] === undefined
  return false
}

/**
 * The field-by-field check of an archive or unarchive, run before anything is written. Every other row must be
 * identical. On the target row, `archive` may change the state, the ID fields when they were missing and the
 * redaction (private, owner, name), and nothing else; `unarchive` may change the state only. On the page,
 * `archive` may add or set the `archived` key and the notice paragraph, `unarchive` may remove them, and any
 * other difference in the frontmatter or the body fails the action.
 */
export function assertLifecyclePolicy(params: {
  readonly action: LifecycleAction
  readonly rowsBefore: readonly RepoEntry[]
  readonly rowsAfter: readonly RepoEntry[]
  readonly targetIndex: number
  readonly pageBefore: string | undefined
  readonly pageAfter: string | undefined
}): void {
  const {action, rowsBefore, rowsAfter, targetIndex, pageBefore, pageAfter} = params
  const violation = (): never => policyViolation('PATH_POLICY')

  if (rowsBefore.length !== rowsAfter.length) violation()
  rowsBefore.forEach((before, index) => {
    const after = rowsAfter[index]
    if (after === undefined) return violation()
    if (index !== targetIndex) {
      if (!isDeepStrictEqual(before, after)) violation()
      return undefined
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) {
      const was: unknown = (before as unknown as Record<string, unknown>)[key]
      const now: unknown = (after as unknown as Record<string, unknown>)[key]
      if (!isDeepStrictEqual(was, now) && !rowChangeAllowed(action, key, before, after)) violation()
    }
    return undefined
  })

  if (pageBefore === undefined || pageAfter === undefined) {
    if (pageBefore !== pageAfter) violation()
    return
  }
  let before: ReturnType<typeof parseFrontmatterDocument>
  let after: ReturnType<typeof parseFrontmatterDocument>
  try {
    before = parseFrontmatterDocument(pageBefore)
    after = parseFrontmatterDocument(pageAfter)
  } catch {
    return violation()
  }
  if (!isDeepStrictEqual(valuesWithout(before.values, 'archived'), valuesWithout(after.values, 'archived'))) violation()
  if (withoutArchiveNotice(before.body).trim() !== withoutArchiveNotice(after.body).trim()) violation()
  if (action === 'archive') {
    const date = after.values.archived
    if (typeof date !== 'string' || !ARCHIVE_DATE_PATTERN.test(date) || !hasArchiveNotice(after.body)) violation()
  } else if ('archived' in after.values || hasArchiveNotice(after.body)) {
    violation()
  }
}

/** The repo pages of the snapshot, with `override` standing in for the page the action rewrites. */
function wikiPagesWith(files: Readonly<Record<string, string>>, override: Record<string, string>) {
  const pages: Record<string, string> = {}
  for (const [path, content] of Object.entries({...files, ...override})) {
    if (WIKI_PAGE_PATTERN.test(path)) pages[path] = content
  }
  return pages
}

/**
 * `archive` or `unarchive` one tracked public repository, in one commit through the shared writer.
 *
 * The row is located by node ID. GitHub's `node(id:)` record (read with the unprivileged token) must show the
 * node public and the same repository (the node ID, and the `database_id` the row stores); `unarchive` also
 * needs it not archived on GitHub. A row with no node ID is matched by name, see `findLegacyRow`. Archiving a
 * redacted row restores its name from GitHub, and a redacted row that is already archived is re-archived only
 * when the page at the restored name is attributed to the node. Every refusal is a fixed reason and writes
 * nothing.
 */
export async function lifecycleTrackedRepo(deps: LifecycleDeps): Promise<LifecycleOutcome> {
  const now = deps.now ?? (() => new Date())
  let facts: NodeFacts | undefined

  const attemptOnce = async (attempt: number): Promise<LifecycleOutcome> => {
    const snapshot = await readSnapshot(deps.writer)
    const view = readRows(snapshot.files, deps.nodeId)
    const matches = view.rows.filter(candidate => candidate.node_id === deps.nodeId)
    if (matches.length > 1) return blockedOutcome('duplicate-identity')
    let target = matches[0]
    if (target !== undefined) {
      const settled = alreadyInState(deps.action, target)
      if (settled !== undefined) return settled
    }

    if (facts === undefined) {
      const raw = await guarded('evidence', 'EVIDENCE_FAILED', async () =>
        deps.transport.getRepositoryByNodeId(deps.nodeId),
      )
      facts = parseNodeFacts(raw)
    }
    // GitHub must answer with this very node; anything else (null, malformed, another ID) proves nothing.
    if (facts === undefined || facts.nodeId !== deps.nodeId) return blockedOutcome('identity-not-confirmed')

    if (target === undefined) {
      if (deps.action === 'unarchive') return blockedOutcome('row-not-found')
      const legacy = findLegacyRow(snapshot.files, view.rows, facts)
      if (isLegacyBlock(legacy)) return legacy
      target = legacy
      const settled = alreadyInState(deps.action, target)
      if (settled !== undefined) return settled
    }
    if (target.database_id !== undefined && target.database_id !== facts.databaseId) {
      return blockedOutcome('identity-not-confirmed')
    }

    const redacted = isRedactedRow(target)
    if (deps.action === 'unarchive') {
      if (redacted) return blockedOutcome('row-not-public')
      if (!facts.isPublic) return blockedOutcome('repository-private')
      if (facts.isArchived) return blockedOutcome('repository-archived')
    } else {
      if (!facts.isPublic) return blockedOutcome(redacted ? 'row-not-public' : 'repository-private')
      const sharesIdentity = view.rows.some(
        other => other !== target && (other.node_id === deps.nodeId || other.database_id === (facts?.databaseId ?? -1)),
      )
      if (sharesIdentity) return blockedOutcome('duplicate-identity')
    }

    const after = lifecycleRow(deps.action, target, facts)
    const pagePath = pagePathFor(after.owner, after.name)
    if (pagePath === undefined) return blockedOutcome('identity-not-confirmed')
    const url = `https://github.com/${after.owner}/${after.name}`
    const pageBefore = snapshot.files[pagePath]
    if (deps.action === 'archive' && target.onboarding_status === 'archived') {
      // A redacted archived row: only the page at the restored name, attributed to this node, proves the name.
      let attributed = false
      try {
        attributed =
          pageBefore !== undefined && attributesPageTo(parseFrontmatterDocument(pageBefore), deps.nodeId, url)
      } catch {
        attributed = false
      }
      if (!attributed) return blockedOutcome('identity-not-confirmed')
    }

    const pageAfter =
      pageBefore === undefined ? undefined : lifecyclePage(deps.action, pageBefore, now().toISOString().slice(0, 10))
    const rowsAfter = view.rows.map(row => (row === target ? after : row))
    const targetIndex = view.rows.indexOf(target)
    assertLifecyclePolicy({
      action: deps.action,
      rowsBefore: view.rows,
      rowsAfter,
      targetIndex,
      pageBefore,
      pageAfter,
    })

    const changes: RenameChange[] = [
      {op: 'write-row', path: REPOS_PATH, content: serializeYaml({...view.document, repos: rowsAfter})},
    ]
    if (pageAfter !== undefined && pageAfter !== pageBefore) {
      changes.push({op: 'edit-page', path: pagePath, content: pageAfter})
    }

    let index: string
    try {
      index = rebuildWikiIndex({
        existingIndex: snapshot.files[INDEX_PATH],
        wikiFiles: wikiPagesWith(snapshot.files, pageAfter === undefined ? {} : {[pagePath]: pageAfter}),
      })
    } catch (error: unknown) {
      if (error instanceof WikiIngestError) return blockedOutcome('invalid-index')
      throw error
    }
    if (index !== snapshot.files[INDEX_PATH]) changes.push({op: 'write-index', path: INDEX_PATH, content: index})

    const verb = deps.action === 'archive' ? 'Archived' : 'Unarchived'
    changes.push({
      op: 'append-log',
      path: LOG_PATH,
      content: appendLogEntry(snapshot.files[LOG_PATH], {
        operation: 'manual-edit',
        target: `repo:${after.owner}/${after.name}`,
        summary:
          deps.action === 'archive'
            ? `${verb} \`${after.owner}/${after.name}\`. Its page carries the archive date and notice; surveys skip it.`
            : `${verb} \`${after.owner}/${after.name}\`. Its page lost the archive date and notice; the row is pending again.`,
        timestamp: now(),
        sources: [],
      }),
    })

    assertChangePolicy(changes, {
      files: snapshot.files,
      paths: snapshot.paths,
      nodeId: deps.nodeId,
      oldSlug: '',
      oldUrl: url,
    })

    const message = `chore(archive): ${deps.action} ${after.owner}/${after.name}`
    const commit = await writeCommit(deps.writer, snapshot, changes, message)
    return {
      result: deps.action === 'archive' ? 'archived' : 'unarchived',
      commit,
      attempts: attempt,
      page: pageAfter === undefined ? 'missing' : 'edited',
    }
  }

  try {
    return await retry(attemptOnce, {attempts: MAX_ATTEMPTS, shouldRetry: error => error instanceof RefRaceError})
  } catch (error: unknown) {
    if (!(error instanceof RefRaceError)) throw error
    throw new RenameError({code: 'RETRIES_EXHAUSTED', phase: 'updateRef', status: error.status})
  }
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

const NODE_QUERY =
  'query($id: ID!) { node(id: $id) { ... on Repository { id databaseId name owner { login } visibility isArchived } } }'

async function createRealTransport(token: string): Promise<RenameTransport> {
  const octokit = await createOctokit(token)
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
    getRepositoryByNodeId: async nodeId => {
      const response = await octokit.graphql<{node: unknown}>(NODE_QUERY, {id: nodeId})
      return response.node
    },
  }
}

async function createRealWriter(token: string): Promise<GitDataClient> {
  return createOctokit(token)
}

const BLOCK_HINTS: Partial<Record<RenameBlockReason, string>> = {
  'both-pages-present':
    'Pages exist at both the old and the new slug: remove one of the two pages by hand on the data branch, then dispatch again.',
  'page-ahead-of-row':
    'A page already sits at the new slug while the row holds the old name: rename the row by hand on the data branch, then dispatch again.',
}

/**
 * The CLI entry, with its environment and I/O injected. Returns the exit code.
 * `NODE_ID` is required. `ACTION` is `apply` (the default, the rename), `archive` or `unarchive`; `OLD_NAME`
 * (`owner/name`) applies only to `apply`, for the residue state. `GITHUB_TOKEN`
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
  if (nodeId === undefined || nodeId.length > NODE_ID_MAX_LENGTH || !NODE_ID_PATTERN.test(nodeId)) {
    return fail('INVALID_INPUT (field=node_id)')
  }
  const action = env.ACTION === undefined || env.ACTION === '' ? 'apply' : env.ACTION
  if (action !== 'apply' && action !== 'archive' && action !== 'unarchive') return fail('INVALID_INPUT (field=action)')
  const oldNameInput = env.OLD_NAME === undefined || env.OLD_NAME === '' ? undefined : env.OLD_NAME
  if (action === 'apply' && oldNameInput !== undefined && parseOldName(oldNameInput) === undefined) {
    return fail('INVALID_INPUT (field=old_name)')
  }
  for (const name of ['GITHUB_TOKEN', 'RENAME_WRITER_TOKEN'] as const) {
    const value = env[name]
    if (value === undefined || value === '') return fail(`MISSING_TOKEN (name=${name})`)
  }

  try {
    const transport = await (deps.createTransport ?? createRealTransport)(env.GITHUB_TOKEN ?? '')
    const writer = await (deps.createWriter ?? createRealWriter)(env.RENAME_WRITER_TOKEN ?? '')

    if (action !== 'apply') {
      const outcome = await lifecycleTrackedRepo({transport, writer, action, nodeId, now: deps.now})
      if (outcome.result === 'blocked') {
        return fail(
          `blocked (reason=${outcome.reason}). Nothing was written. See metadata/README.md, "Archiving a repository".`,
        )
      }
      // One summary line: the action, the outcome and the node ID. No name, no commit, no path.
      const result =
        outcome.result === 'noop'
          ? outcome.state === 'archived'
            ? 'already-archived'
            : 'not-archived'
          : outcome.result
      stdout(`${JSON.stringify({action, result, node_id: nodeId})}\n`)
      return 0
    }

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
