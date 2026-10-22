import type {Dirent} from 'node:fs'
import type {Octokit} from '@octokit/rest'
import type {WikiLintFinding} from './wiki-lint.ts'
import {Buffer} from 'node:buffer'
import {execFile} from 'node:child_process'
import {appendFile, readdir, readFile} from 'node:fs/promises'
import {basename, join} from 'node:path'
import process from 'node:process'
import {promisify} from 'node:util'

import {parse, stringify} from 'yaml'
import {assertBranchWritable} from './branch-safety.ts'
import {verifyCorrectionSurvival} from './corrections-survival.ts'
import {CorrectionStoreError, readCorrections, type CorrectionsFile, type CorrectionsReadResult} from './corrections.ts'
import {
  bootstrapDataBranch as defaultBootstrapDataBranch,
  type DataBranchBootstrapParams,
  type DataBranchBootstrapResult,
} from './data-branch-bootstrap.ts'
import {assertReposFile} from './schemas.ts'
import {computeRepoSlug} from './wiki-slug.ts'
import {collectWikilinks} from './wiki-utils.ts'

const DEFAULT_OWNER = 'fro-bot'
const DEFAULT_REPO = '.github'
const DEFAULT_BRANCH = 'data'
const DEFAULT_MAX_RETRIES = 3
const WIKI_ROOT = 'knowledge/wiki'
const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u
const HANDOFF_BASE_REMEDIATION =
  'The writer could not tie the handoff to the data commit the agent job synced. Re-run the workflow so the agent job runs again.'
const execFileAsync = promisify(execFile)

type OctokitConstructor = new (params: {auth: string}) => OctokitClient

export type WikiOperation = 'survey' | 'event' | 'lint' | 'manual-edit'
export type WikiPageType = 'repo' | 'topic' | 'entity' | 'comparison'

export interface WikiSource {
  url: string
  sha?: string
  accessed: string
}

export interface WikiPageInput {
  path: string
  content: string
}

export interface BuildWikiIngestChangesParams {
  existingFiles: Record<string, string>
  operation: WikiOperation
  target: string
  summary: string
  timestamp: Date
  sources: WikiSource[]
  pages: WikiPageInput[]
  /** Trusted metadata identities keyed by canonical repo-page slug. */
  trackedRepoNodeIds?: ReadonlyMap<string, string>
  /** Trusted dispatch identity; usable only for the page matching `target`. */
  targetNodeId?: string
  /** Untrusted payload fallback; never authorizes a page migration or deletion. */
  fallbackNodeId?: string
  /** False means metadata state is unknown; preserve existing page identity. */
  trackedMetadataAvailable?: boolean
  /** System-owned correction state used for post-regeneration survival verification. */
  corrections?: CorrectionsFile
  /**
   * Log entries an agent appended to its own `knowledge/log.md`, derived by the caller. Appended to
   * the existing log, before this ingest's own summary entry.
   */
  agentLogEntries?: string
  /**
   * Pages an agent deleted in a handoff, already removed from `existingFiles`. They join the result's
   * `deletedPaths`, and a call with only deletions needs no page updates.
   */
  handoffDeletedPaths?: readonly string[]
}

export interface BuildWikiIngestChangesResult {
  files: Record<string, string>
  deletedPaths: string[]
  findings: readonly WikiLintFinding[]
}

export interface WikiIngestWarning {
  code: 'duplicate-repo-identity' | 'repos-metadata-unavailable' | 'agent-log-entries-dropped'
  node_ids?: string[]
  reason?: 'read-failed' | 'parse-failed' | 'not-append-only' | 'base-log-missing'
  slugs?: string[]
}

export interface TrackedRepoNodeIdsResult {
  metadataAvailable: boolean
  nodeIds: Map<string, string>
  warnings: WikiIngestWarning[]
}

export interface CommitWikiChangesParams {
  owner?: string
  repo?: string
  branch?: string
  message: string
  files: Record<string, string>
  deletedPaths?: readonly string[]
  /**
   * The data-branch commit `files` and `deletedPaths` were derived from: the base of the write guard.
   * Every attempt, the first included, compares each write-set path on the head it reads with the same
   * path in this commit's tree and fails closed if any differs.
   * - A commit SHA: that commit's tree is the base. It is resolved once and never re-read, so the base
   *   stays fixed across retries.
   * - Omitted: the head tree of the first successful read in this call is the base, so only changes
   *   after that read are caught.
   */
  baseCommitSha?: string
  /**
   * A second, per-path base for a write whose pages were edited by an agent job in an earlier job.
   * `agentCommitSha` is the data commit that job synced; `paths` are the pages it changed or deleted
   * (`knowledge/log.md` and `knowledge/index.md` are ignored here: the writer rebuilds both itself).
   *
   * Before any write, the commit must resolve and be an ancestor of the branch head, or the call fails
   * with `HANDOFF_BASE_INVALID`. Every attempt then compares each path on the head it reads with the
   * same path in that commit's tree, ahead of the `baseCommitSha` check, and fails with
   * `HANDOFF_PAGE_CHANGED` if any differs: another writer edited or deleted the page since the agent
   * read it.
   */
  handoff?: {agentCommitSha: string; paths: readonly string[]}
  octokit?: OctokitClient
  maxRetries?: number
  /**
   * Idempotent data-branch bootstrap. Called before data-branch writes so wiki
   * ingest recovers when the `data` branch is missing: it recreates the branch from `main`.
   */
  bootstrapDataBranch?: (params: DataBranchBootstrapParams) => Promise<DataBranchBootstrapResult>
}

export interface CommitWikiChangesResult {
  committed: boolean
  commitSha: string
  attempts: number
}

export interface RunWikiIngestCliDependencies {
  readonly readCorrections?: typeof readCorrections
  readonly commitWikiChanges?: typeof commitWikiChanges
  readonly getChangedWikiPaths?: typeof getChangedWikiPaths
  /** Client for reading the agent's base commit; defaults to one built from `GITHUB_TOKEN`. */
  readonly octokit?: OctokitClient
}

/**
 * Narrow Octokit client type derived from the real `@octokit/rest` SDK.
 * See commit-metadata.ts for the rationale behind deriving rather than handwriting.
 */
export type OctokitClient = Octokit

export type WikiIngestErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_PAGE_PATH'
  | 'INVALID_FRONTMATTER'
  | 'INVALID_WIKILINK'
  | 'CORRECTION_ERODED'
  | 'INVALID_RETRIES'
  | 'PROTECTED_BRANCH'
  | 'MISSING_TOKEN'
  | 'OCTOKIT_LOAD_FAILED'
  | 'CONFLICT_EXHAUSTED'
  | 'HANDOFF_BASE_INVALID'
  | 'HANDOFF_PAGE_CHANGED'

export class WikiIngestError extends Error {
  readonly code: WikiIngestErrorCode
  readonly remediation: string
  readonly findings: readonly WikiLintFinding[]

  constructor(params: {
    code: WikiIngestErrorCode
    message: string
    remediation: string
    findings?: readonly WikiLintFinding[]
  }) {
    super(params.message)
    this.name = 'WikiIngestError'
    this.code = params.code
    this.remediation = params.remediation
    this.findings = params.findings ?? []
  }
}

interface ParsedWikiPage {
  path: string
  slug: string
  type: WikiPageType
  title: string
  content: string
}

interface WikiFrontmatter {
  type: WikiPageType
  title: string
  created: string
  updated: string
  node_id?: string
  sources?: WikiSource[]
  tags?: string[]
  aliases?: string[]
  related?: string[]
}

interface WikiIngestPayload {
  operation: WikiOperation
  target: string
  summary: string
  timestamp?: string
  sources: WikiSource[]
  pages: WikiPageInput[]
  node_id?: string
  message?: string
  owner?: string
  repo?: string
  branch?: string
}

export function buildWikiIngestChanges(params: BuildWikiIngestChangesParams): BuildWikiIngestChangesResult {
  if (params.pages.length === 0 && (params.handoffDeletedPaths ?? []).length === 0) {
    throw new WikiIngestError({
      code: 'INVALID_PAYLOAD',
      message: 'wiki ingest requires at least one page update',
      remediation: 'Populate payload.pages with one or more wiki pages before invoking wiki-ingest.',
    })
  }

  const files: Record<string, string> = {}
  const nextFiles = {...params.existingFiles}
  let deletedPaths: string[] = []
  const migrations: {oldSlug: string; newSlug: string}[] = []

  for (const inputPage of params.pages) {
    const page = prepareWikiPage(inputPage, nextFiles, params, deletedPaths, migrations)
    assertWikiPagePath(page.path)
    const normalized = normalizeText(validateWikiPage(page.path, page.content))
    nextFiles[page.path] = normalized
    files[page.path] = normalized
  }

  for (const path of params.handoffDeletedPaths ?? []) {
    if (nextFiles[path] === undefined && !deletedPaths.includes(path)) deletedPaths.push(path)
  }

  rewriteInboundWikilinks(nextFiles, migrations)
  for (const [path, content] of Object.entries(nextFiles)) {
    if (params.existingFiles[path] !== content && !deletedPaths.includes(path)) {
      files[path] = content
    }
  }
  validateWikilinks(nextFiles)

  const correctionSurvival = verifyCorrectionSurvival(nextFiles, params.corrections, params.existingFiles)
  const correctionFindings = [...correctionSurvival.deterministicFindings, ...correctionSurvival.advisoryFindings]
  if (!correctionSurvival.ok) {
    const blockedCorrectionIds = new Set(
      correctionSurvival.deterministicFindings
        .map(finding => finding.target)
        .filter((target): target is string => target !== undefined),
    )
    const blockedNodeIds = new Set(
      (params.corrections?.corrections ?? [])
        .filter(correction => blockedCorrectionIds.has(correction.id))
        .map(correction => correction.page_node_id),
    )
    const blockedPagePaths = new Set(
      correctionSurvival.deterministicFindings
        .map(finding => finding.path)
        .filter(path => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md')),
    )
    const parsedNextFrontmatter = collectWikiFrontmatter(nextFiles)
    const parsedExistingFrontmatter = collectWikiFrontmatter(params.existingFiles)
    for (const [path, frontmatter] of parsedNextFrontmatter) {
      const nodeId = frontmatter.node_id
      if (typeof nodeId === 'string' && blockedNodeIds.has(nodeId)) blockedPagePaths.add(path)
    }
    const restoredPaths = restoreBlockedCorrectionPages(
      nextFiles,
      params.existingFiles,
      parsedNextFrontmatter,
      parsedExistingFrontmatter,
      blockedNodeIds,
      blockedPagePaths,
    )
    for (const path of restoredPaths) delete files[path]
    deletedPaths = deletedPaths.filter(path => nextFiles[path] === undefined)

    const hasUnblockedPage = params.pages.some(page => !blockedPagePaths.has(page.path))
    if (!hasUnblockedPage || blockedPagePaths.size === 0) {
      throw new WikiIngestError({
        code: 'CORRECTION_ERODED',
        message: `wiki ingest refused: all regenerated pages were blocked by ${correctionSurvival.deterministicFindings.length} eroded correction(s)`,
        remediation:
          'Restore each marked correction in the regenerated page or retire/supersede it explicitly before ingesting.',
        findings: correctionFindings,
      })
    }
  }

  const parsedPages = collectWikiPages(nextFiles)
  const index = buildIndexDocument(nextFiles[INDEX_PATH], parsedPages)
  const log = appendLogEntry(appendAgentLogEntries(nextFiles[LOG_PATH], params.agentLogEntries), params)

  files[INDEX_PATH] = index
  files[LOG_PATH] = log

  return {files, deletedPaths, findings: correctionFindings}
}

function restoreBlockedCorrectionPages(
  nextFiles: Record<string, string>,
  existingFiles: Record<string, string>,
  nextFrontmatter: ReadonlyMap<string, WikiFrontmatter>,
  existingFrontmatter: ReadonlyMap<string, WikiFrontmatter>,
  blockedNodeIds: ReadonlySet<string>,
  blockedPagePaths: ReadonlySet<string>,
): Set<string> {
  const blockedPaths = new Set(blockedPagePaths)
  for (const [path, frontmatter] of [...nextFrontmatter, ...existingFrontmatter]) {
    const nodeId = frontmatter.node_id
    if (typeof nodeId === 'string' && blockedNodeIds.has(nodeId)) blockedPaths.add(path)
  }

  for (const path of blockedPaths) {
    if (existingFiles[path] === undefined) delete nextFiles[path]
    else nextFiles[path] = existingFiles[path]
  }
  return blockedPaths
}

function collectWikiFrontmatter(files: Record<string, string>): Map<string, WikiFrontmatter> {
  const frontmatter = new Map<string, WikiFrontmatter>()
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md')) frontmatter.set(path, parseFrontmatter(path, content))
  }
  return frontmatter
}

/**
 * Commits `params.files` (and removes `params.deletedPaths`) as one commit on the data branch.
 *
 * Every attempt is guarded: if any path in the write set (files and deletions) differs on the head read
 * in that attempt from the tree the files were derived from (`baseCommitSha`, or the first head read
 * when it is omitted), another writer changed it, so the write fails with `CONFLICT_EXHAUSTED` and
 * nothing is written. A ref race (`updateRef` 409, or 422 not-a-fast-forward) re-reads the head and
 * replays the same files on it, up to `maxRetries` attempts, under the same guard.
 *
 * With `handoff`, the handed-off paths are checked first on every attempt against the agent's data
 * commit (`HANDOFF_PAGE_CHANGED`), so a page conflict is never reported as a ref race.
 */
export async function commitWikiChanges(params: CommitWikiChangesParams): Promise<CommitWikiChangesResult> {
  const owner = params.owner ?? DEFAULT_OWNER
  const repo = params.repo ?? DEFAULT_REPO
  const branch = params.branch ?? DEFAULT_BRANCH
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES

  if (maxRetries < 1) {
    throw new WikiIngestError({
      code: 'INVALID_RETRIES',
      message: `wiki ingest requires maxRetries >= 1, got ${maxRetries}`,
      remediation: 'Pass maxRetries as a positive integer (default: 3).',
    })
  }

  const octokit = params.octokit ?? (await createOctokitFromEnv())
  rejectProtectedWikiBranchName(branch)

  // Resolved outside the retry loop's try, ahead of any bootstrap or write: an unusable agent commit is
  // terminal, and the loop's 404 handler must not mistake it for a missing data branch.
  const handoffBaseTreeSha =
    params.handoff === undefined
      ? undefined
      : await resolveHandoffBaseTree(octokit, owner, repo, branch, params.handoff.agentCommitSha)
  const handoffPaths = (params.handoff?.paths ?? []).filter(path => path !== INDEX_PATH && path !== LOG_PATH)

  const shouldBootstrapDataBranch = branch === DEFAULT_BRANCH
  const bootstrap = params.bootstrapDataBranch ?? defaultBootstrapDataBranch
  const bootstrapDataBranch = async (): Promise<void> => {
    await bootstrap({octokit, owner, repo, dataBranch: branch})
  }

  if (shouldBootstrapDataBranch) {
    await bootstrapDataBranch()
  }

  // The tree the write set was derived from, once resolved (see `CommitWikiChangesParams.baseCommitSha`).
  let baseTreeSha: string | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    // Only an `updateRef` 422 is a ref race ("not a fast forward": the branch moved after this attempt
    // read its tip). A 422 from createBlob, createTree or createCommit is a bad request and stays terminal.
    let updatingRef = false
    try {
      await assertWritableWikiBranch(octokit, owner, repo, branch)

      const head = await octokit.rest.git.getRef({owner, repo, ref: `heads/${branch}`})
      const commit = await octokit.rest.git.getCommit({owner, repo, commit_sha: head.data.object.sha})
      // Resolved on the first attempt and reused: the base must not move while the write retries.
      baseTreeSha ??=
        params.baseCommitSha === undefined
          ? commit.data.tree.sha
          : await readCommitTreeSha(octokit, owner, repo, params.baseCommitSha)
      const location = `${owner}/${repo}@${branch}`
      // Handed-off pages first, against the commit the agent read, so a page conflict surfaces as such
      // even when the head also moved under the shared files.
      if (handoffBaseTreeSha !== undefined && handoffPaths.length > 0 && commit.data.tree.sha !== handoffBaseTreeSha) {
        await assertWriteSetUnchanged(octokit, owner, repo, {
          baseTreeSha: handoffBaseTreeSha,
          headTreeSha: commit.data.tree.sha,
          paths: handoffPaths,
          location,
          code: 'HANDOFF_PAGE_CHANGED',
        })
      }
      const guardBaseTreeSha = baseTreeSha
      if (commit.data.tree.sha !== guardBaseTreeSha) {
        await assertWriteSetUnchanged(octokit, owner, repo, {
          baseTreeSha: guardBaseTreeSha,
          headTreeSha: commit.data.tree.sha,
          paths: [...Object.keys(params.files), ...(params.deletedPaths ?? [])],
          location,
          code: 'CONFLICT_EXHAUSTED',
        })
      }

      const tree: {
        path: string
        mode: '100644'
        type: 'blob'
        sha: string | null
      }[] = []
      for (const [path, content] of Object.entries(params.files)) {
        const blob = await octokit.rest.git.createBlob({owner, repo, content, encoding: 'utf-8'})
        tree.push({path, mode: '100644' as const, type: 'blob' as const, sha: blob.data.sha})
      }
      const presentPaths =
        params.deletedPaths === undefined || params.deletedPaths.length === 0
          ? new Set<string>()
          : await getPresentPathsInTree(octokit, owner, repo, commit.data.tree.sha)
      for (const path of params.deletedPaths ?? []) {
        if (params.files[path] !== undefined || !presentPaths.has(path)) {
          continue
        }
        tree.push({path, mode: '100644' as const, type: 'blob' as const, sha: null})
      }

      const createdTree = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: commit.data.tree.sha,
        tree,
      })

      const createdCommit = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: params.message,
        tree: createdTree.data.sha,
        parents: [commit.data.sha],
      })

      updatingRef = true
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: createdCommit.data.sha,
        force: false,
      })

      return {committed: true, commitSha: createdCommit.data.sha, attempts: attempt}
    } catch (error: unknown) {
      if (shouldBootstrapDataBranch && isApiErrorStatus(error, 404) && attempt < maxRetries) {
        await bootstrapDataBranch()
        continue
      }

      const refRace = isConflictError(error) || (updatingRef && isApiErrorStatus(error, 422))

      if (refRace && attempt < maxRetries) {
        await delayConflictRetry(attempt)
        continue
      }

      if (refRace) {
        throw new WikiIngestError({
          code: 'CONFLICT_EXHAUSTED',
          message: `wiki ingest exhausted ${maxRetries} attempt(s) updating ${owner}/${repo}@${branch}`,
          remediation:
            'Another writer updated the data branch concurrently. Retry the workflow or increase maxRetries.',
        })
      }

      throw error
    }
  }

  throw new Error('wiki ingest reached an unreachable retry state')
}

function rejectProtectedWikiBranchName(branch: string): void {
  if (branch === 'main') {
    throw new WikiIngestError({
      code: 'PROTECTED_BRANCH',
      message: 'wiki ingest refuses to write to main; use the data branch',
      remediation: 'Target the data branch. Promotions to main must go through the data-branch merge PR.',
    })
  }
}

async function assertWritableWikiBranch(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  await assertBranchWritable(octokit, owner, repo, branch, reason => {
    if (reason === 'main') rejectProtectedWikiBranchName(branch)
    throw new WikiIngestError({
      code: 'PROTECTED_BRANCH',
      message: `wiki ingest refuses to write to protected branch "${branch}"`,
      remediation:
        'Target the canonical fro-bot/.github data branch or another unprotected branch. Review the ruleset and branch protection if this target should be writable.',
    })
  })
}

async function getPresentPathsInTree(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<Set<string>> {
  const response = await octokit.rest.git.getTree({owner, repo, tree_sha: treeSha, recursive: 'true'})
  if (response.data.truncated === true) return new Set()
  const tree: unknown = response.data.tree
  if (!Array.isArray(tree)) return new Set()
  return new Set(tree.flatMap(entry => (isRecord(entry) && typeof entry.path === 'string' ? [entry.path] : [])))
}

async function readCommitTreeSha(octokit: OctokitClient, owner: string, repo: string, sha: string): Promise<string> {
  const commit = await octokit.rest.git.getCommit({owner, repo, commit_sha: sha})
  return commit.data.tree.sha
}

/**
 * Resolves the agent job's data commit to its tree, after checking it is a full commit SHA and an
 * ancestor of (or equal to) the branch head. Compare's `behind_by` is 0 and its merge base is the
 * commit itself exactly when that holds.
 */
async function resolveHandoffBaseTree(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  branch: string,
  agentCommitSha: string,
): Promise<string> {
  const invalid = (reason: string): WikiIngestError =>
    new WikiIngestError({
      code: 'HANDOFF_BASE_INVALID',
      message: `wiki ingest refused: ${reason}`,
      remediation: HANDOFF_BASE_REMEDIATION,
    })
  if (!COMMIT_SHA_PATTERN.test(agentCommitSha)) {
    throw invalid('the agent job data commit is missing or is not a commit SHA')
  }

  try {
    const head = await octokit.rest.git.getRef({owner, repo, ref: `heads/${branch}`})
    const comparison = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${agentCommitSha}...${head.data.object.sha}`,
    })
    if (comparison.data.behind_by !== 0 || comparison.data.merge_base_commit.sha !== agentCommitSha) {
      throw invalid(`the agent job data commit is not an ancestor of ${owner}/${repo}@${branch}`)
    }
    return await readCommitTreeSha(octokit, owner, repo, agentCommitSha)
  } catch (error: unknown) {
    if (error instanceof WikiIngestError) throw error
    if (isApiErrorStatus(error, 404) || isApiErrorStatus(error, 422)) {
      throw invalid(`the agent job data commit does not resolve on ${owner}/${repo}@${branch}`)
    }
    throw error
  }
}

/**
 * Fail closed unless every path has the same tree entry (sha, mode, type; absence counts) on the new
 * head as in the tree the files were derived from. A replay onto a head where another writer touched
 * one of them would silently overwrite that writer's change. `code` names the refusal; a truncated
 * tree read always refuses with `CONFLICT_EXHAUSTED`, because it says nothing about the pages.
 */
async function assertWriteSetUnchanged(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  params: {
    baseTreeSha: string
    headTreeSha: string
    paths: readonly string[]
    location: string
    code: 'CONFLICT_EXHAUSTED' | 'HANDOFF_PAGE_CHANGED'
  },
): Promise<void> {
  const refuse = (code: WikiIngestErrorCode, reason: string): never => {
    throw new WikiIngestError({
      code,
      message:
        code === 'HANDOFF_PAGE_CHANGED'
          ? `wiki ingest refused to write to ${params.location}: ${reason}`
          : `wiki ingest did not replay onto ${params.location}: ${reason}`,
      remediation:
        code === 'HANDOFF_PAGE_CHANGED'
          ? 'Another writer changed a page after the agent job synced. Re-run the agent job so it starts from the current data branch.'
          : 'Another writer updated the data branch concurrently. Retry the workflow so it rebuilds on the new head.',
    })
  }
  const base = await readTreeEntries(octokit, owner, repo, params.baseTreeSha)
  const head = await readTreeEntries(octokit, owner, repo, params.headTreeSha)
  if (base === undefined || head === undefined)
    return refuse('CONFLICT_EXHAUSTED', 'a tree read was truncated, so the write set cannot be verified')
  if (params.paths.some(path => base.get(path) !== head.get(path))) {
    return refuse(
      params.code,
      params.code === 'HANDOFF_PAGE_CHANGED'
        ? 'a handed-off page changed after the agent job synced'
        : 'another writer changed a path in the write set',
    )
  }
}

/** Path to `mode type sha`, for every non-directory entry. `undefined` when the read is truncated. */
async function readTreeEntries(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<Map<string, string> | undefined> {
  const response = await octokit.rest.git.getTree({owner, repo, tree_sha: treeSha, recursive: 'true'})
  if (response.data.truncated === true) return undefined
  const tree: unknown = response.data.tree
  const entries = new Map<string, string>()
  if (!Array.isArray(tree)) return entries
  for (const entry of tree) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.type === 'tree') continue
    entries.set(entry.path, `${String(entry.mode)} ${String(entry.type)} ${String(entry.sha)}`)
  }
  return entries
}

async function createOctokitFromEnv(): Promise<OctokitClient> {
  const token = process.env.GITHUB_TOKEN

  if (token === undefined || token === '') {
    throw new WikiIngestError({
      code: 'MISSING_TOKEN',
      message: 'wiki-ingest requires params.octokit or GITHUB_TOKEN in the environment',
      remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
    })
  }

  const Octokit = await loadOctokitConstructor()
  return new Octokit({auth: token})
}

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  const loaded: unknown = await import('@octokit/rest')

  if (!isRecord(loaded) || !('Octokit' in loaded) || typeof loaded.Octokit !== 'function') {
    throw new WikiIngestError({
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  }

  return loaded.Octokit as OctokitConstructor
}

function validateWikiPage(path: string, content: string): string {
  const frontmatter = parseFrontmatter(path, content)
  const expectedType = pageTypeFromPath(path)

  if (frontmatter.type !== expectedType) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} declares type ${frontmatter.type} but lives under ${expectedType}`,
      remediation: 'Align the page type with its directory, or move the file to the correct wiki section.',
    })
  }

  if (!DATE_PATTERN.test(frontmatter.created) || !DATE_PATTERN.test(frontmatter.updated)) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} must use YYYY-MM-DD for created/updated`,
      remediation: 'Use ISO calendar dates for created and updated in wiki frontmatter.',
    })
  }

  const filename = basename(path)
  if (!isValidFilename(frontmatter.type, filename)) {
    throw new WikiIngestError({
      code: 'INVALID_PAGE_PATH',
      message: `${path} does not match wiki filename conventions for ${frontmatter.type}`,
      remediation:
        'Use lowercase kebab-case filenames. Repo pages must be {owner}--{repo}.md and comparisons must be {a}-vs-{b}.md.',
    })
  }

  if (hasDatabaseId(content)) {
    const document = parseFrontmatterDocument(content)
    delete document.values.database_id
    return renderFrontmatterDocument(document.values, document.body)
  }

  return content
}

function hasDatabaseId(content: string): boolean {
  return 'database_id' in parseFrontmatterDocument(content).values
}

export function validateWikilinks(files: Record<string, string>): void {
  const pages = collectWikiPages(files)
  const knownSlugs = new Set(pages.map(page => page.slug))

  for (const page of pages) {
    for (const wikilink of extractWikilinks(page.content)) {
      if (!knownSlugs.has(wikilink)) {
        throw new WikiIngestError({
          code: 'INVALID_WIKILINK',
          message: `${page.path} links to missing wiki page [[${wikilink}]]`,
          remediation:
            'Create the referenced page in the same ingest batch or update the wikilink to an existing page.',
        })
      }
    }
  }
}

/**
 * Regenerate `knowledge/index.md` deterministically from a snapshot of wiki files.
 *
 * Used both by ingest (to update the catalog inline with new pages) and by
 * `scripts/rebuild-wiki-index.ts` (to heal `index.md` after merge conflicts on
 * the shared catalog file — see PR #3114's companion context).
 *
 * Preserves any header/footer prose found in `existingIndex` so operator notes
 * above `## Repos` and below the closing `---` survive regeneration.
 */
export function rebuildWikiIndex(params: {existingIndex?: string; wikiFiles: Record<string, string>}): string {
  return buildIndexDocument(params.existingIndex, collectWikiPages(params.wikiFiles))
}

const LOG_HEADER =
  '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n'
// Finds only the fixed header marker. The rest of the line is parsed with string
// operations so malformed uncontrolled input cannot trigger regex backtracking.
const LOG_ENTRY_PATTERN = /\n## \[/gu

interface WikiLogEntry {
  timestamp: string
  target: string
  /** Raw entry markup including the leading blank-line separator — byte-for-byte fidelity on reinsertion. */
  raw: string
}

/**
 * Merge multiple `knowledge/log.md` contents into a single canonical log.
 *
 * Used to resolve merge conflicts on the append-only log: given log.md from
 * main and log.md from a PR, produce a combined log with every entry present
 * (deduplicated by timestamp+target) in chronological order.
 *
 * The log's documented contract is append-only. This helper keeps that contract
 * intact across concurrent writers by canonicalizing the order rather than
 * forcing operators to hand-merge conflict markers.
 */
export function mergeWikiLogs(logs: (string | undefined)[]): string {
  const entryMap = new Map<string, WikiLogEntry>()
  for (const log of logs) {
    if (log === undefined || log === '') continue
    for (const entry of parseWikiLogEntries(log)) {
      // Dedupe by the natural key (timestamp, target). When the same entry
      // appears in multiple inputs, the last one wins — but since entries are
      // normalized the content matches byte-for-byte.
      entryMap.set(`${entry.timestamp}\0${entry.target}`, entry)
    }
  }
  const entries = [...entryMap.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  return normalizeText(`${LOG_HEADER}${entries.map(entry => entry.raw).join('')}`)
}

function parseWikiLogEntries(log: string): WikiLogEntry[] {
  const entries: WikiLogEntry[] = []
  const matches = [...log.matchAll(LOG_ENTRY_PATTERN)]

  const validEntries: {readonly start: number; readonly timestamp: string; readonly target: string}[] = []
  for (const match of matches) {
    if (match.index === undefined) continue
    const start = match.index
    const headerEnd = log.indexOf('\n', start + 1)
    if (headerEnd === -1) continue

    const header = log.slice(start, headerEnd + 1)
    const parsed = parseWikiLogHeader(header)
    if (parsed === undefined) continue
    validEntries.push({start, timestamp: parsed.timestamp, target: parsed.target})
  }

  for (let i = 0; i < validEntries.length; i += 1) {
    const entry = validEntries[i]
    if (entry === undefined) continue
    const nextEntry = validEntries[i + 1]
    const end = nextEntry?.start ?? log.length
    entries.push({
      timestamp: entry.timestamp,
      target: entry.target,
      raw: log.slice(entry.start, end),
    })
  }
  return entries
}

function parseWikiLogHeader(header: string): {readonly timestamp: string; readonly target: string} | undefined {
  const prefix = '\n## ['
  const timestampEnd = header.indexOf('] ')
  if (!header.startsWith(prefix) || timestampEnd <= prefix.length) return undefined

  const timestamp = header.slice(prefix.length, timestampEnd)
  if (timestamp.includes(']')) return undefined

  const operationAndTarget = header.slice(timestampEnd + 2, -1)
  const separator = operationAndTarget.indexOf(' | ')
  if (separator <= 0) return undefined

  const operation = operationAndTarget.slice(0, separator)
  if (!['ingest', 'query', 'lint', 'manual-edit'].includes(operation)) return undefined

  const rawTarget = operationAndTarget.slice(separator + 3)
  return rawTarget === '' ? undefined : {timestamp: timestamp.trim(), target: rawTarget.trim()}
}

function buildIndexDocument(existingIndex: string | undefined, pages: ParsedWikiPage[]): string {
  const header =
    existingIndex === undefined || existingIndex === ''
      ? '# Wiki Index\n\nMaster catalog of all wiki pages, organized by type.\n\n'
      : extractIndexHeader(existingIndex)
  const footer =
    existingIndex === undefined || existingIndex === ''
      ? '\n---\n\n_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._\n'
      : extractIndexFooter(existingIndex)

  // Preserve operator-curated or previously-generated entry descriptions when a
  // slug still has a wiki page. Rebuilds only add new entries and drop stale
  // ones — they never degrade richer descriptions back to bare frontmatter
  // titles.
  const existingLines: Map<string, string> =
    existingIndex === undefined ? new Map<string, string>() : parseIndexEntryLines(existingIndex)

  const sections: {heading: string; type: WikiPageType; empty: string}[] = [
    {
      heading: 'Repos',
      type: 'repo',
      empty: '_No repo pages yet. Pages will appear here as repositories are surveyed._',
    },
    {
      heading: 'Topics',
      type: 'topic',
      empty: '_No topic pages yet. Pages will appear here as cross-cutting themes emerge._',
    },
    {
      heading: 'Entities',
      type: 'entity',
      empty: '_No entity pages yet. Pages will appear here as tools and services are documented._',
    },
    {
      heading: 'Comparisons',
      type: 'comparison',
      empty: '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
    },
  ]

  const body = sections
    .map(section => {
      const entries = pages
        .filter(page => page.type === section.type)
        .sort((left, right) => left.title.localeCompare(right.title))
        .map(page => existingLines.get(page.slug) ?? `- [[${page.slug}]] — ${page.title}`)

      return [`## ${section.heading}`, '', ...(entries.length > 0 ? entries : [section.empty]), ''].join('\n')
    })
    .join('\n')

  return normalizeText(`${header}${body}${footer}`)
}

/**
 * Extract previously-rendered entry lines from an index document keyed by slug.
 * Used to preserve operator-curated or agent-generated rich descriptions across
 * rebuilds — only new slugs get fresh `slug — title` lines.
 */
function parseIndexEntryLines(index: string): Map<string, string> {
  const entries = new Map<string, string>()
  // Match the full line: "- [[slug]] — description"
  // Description may contain anything except a newline (we keep the entire trailing text).
  const pattern = /^- \[\[([^\]|]+)\]\]\s*—\s*(?:\S.*|[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/gmu
  for (const match of index.matchAll(pattern)) {
    const [line, slug] = match
    if (line === undefined || slug === undefined) continue
    entries.set(slug.trim(), line)
  }
  return entries
}

/** Appends raw log entries (already in log format) to `existingLog`, keeping its text byte-for-byte. */
function appendAgentLogEntries(existingLog: string | undefined, entries: string | undefined): string | undefined {
  if (entries === undefined || entries.trim() === '') return existingLog
  const base = existingLog === undefined || existingLog === '' ? LOG_HEADER : normalizeText(existingLog)
  return normalizeText(`${base}${entries.startsWith('\n') ? entries : `\n${entries}`}`)
}

/**
 * Append one entry to `knowledge/log.md`, keeping the existing text byte-for-byte. The log is
 * append-only; callers must never rewrite history. Exported for the operator rename path.
 */
export function appendLogEntry(
  existingLog: string | undefined,
  params: Pick<BuildWikiIngestChangesParams, 'operation' | 'target' | 'summary' | 'timestamp' | 'sources'>,
): string {
  const base =
    existingLog === undefined || existingLog === ''
      ? '# Wiki Log\n\nChronological record of all wiki operations.\n\n---\n\n_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._\n'
      : normalizeText(existingLog)
  const stamp = formatTimestamp(params.timestamp)
  const sources =
    params.sources.length === 0
      ? 'Sources: none'
      : `Sources: ${params.sources
          .map(source => `${source.url}${source.sha === undefined ? '' : `@${source.sha}`}`)
          .join(', ')}`

  const logOperation = params.operation === 'manual-edit' ? 'manual-edit' : 'ingest'
  return normalizeText(`${base}\n## [${stamp}] ${logOperation} | ${params.target}\n\n${params.summary}\n\n${sources}\n`)
}

function parseFrontmatter(path: string, content: string): WikiFrontmatter {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)

  if (match === null) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} is missing YAML frontmatter`,
      remediation: 'Add frontmatter with type, title, created, and updated fields before ingesting the page.',
    })
  }

  const frontmatterText = match[1]
  if (frontmatterText === undefined) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} frontmatter could not be extracted`,
      remediation: 'Ensure the page begins with a valid YAML frontmatter block.',
    })
  }

  const parsed: unknown = parse(frontmatterText)
  if (!isRecord(parsed)) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} frontmatter must parse to an object`,
      remediation: 'Ensure the frontmatter is valid YAML mapping syntax.',
    })
  }

  if (
    !isWikiPageType(parsed.type) ||
    typeof parsed.title !== 'string' ||
    typeof parsed.created !== 'string' ||
    typeof parsed.updated !== 'string'
  ) {
    throw new WikiIngestError({
      code: 'INVALID_FRONTMATTER',
      message: `${path} frontmatter must include type, title, created, and updated`,
      remediation: 'Supply required fields in the page frontmatter and keep optional arrays as strings only.',
    })
  }

  return {
    type: parsed.type,
    title: parsed.title,
    created: parsed.created,
    updated: parsed.updated,
    node_id: typeof parsed.node_id === 'string' ? parsed.node_id : undefined,
    sources: Array.isArray(parsed.sources) ? parsed.sources.filter(isWikiSource) : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter(tag => typeof tag === 'string') : undefined,
    aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter(alias => typeof alias === 'string') : undefined,
    related: Array.isArray(parsed.related) ? parsed.related.filter(related => typeof related === 'string') : undefined,
  }
}

function prepareWikiPage(
  page: WikiPageInput,
  existingFiles: Record<string, string>,
  params: BuildWikiIngestChangesParams,
  deletedPaths: string[],
  migrations: {oldSlug: string; newSlug: string}[],
): WikiPageInput {
  if (!isRepoPagePath(page.path)) return page

  const incomingFrontmatter = parseFrontmatter(page.path, page.content)
  const pageSlug = basename(page.path, '.md')
  const targetSlug = repoTargetSlug(params.target)
  const trackedNodeId = params.trackedRepoNodeIds?.get(pageSlug)
  const isTargetPage = targetSlug === pageSlug
  const identity = resolvePageIdentity({
    trackedNodeId,
    targetNodeId: isTargetPage ? params.targetNodeId : undefined,
    fallbackNodeId: isTargetPage ? params.fallbackNodeId : undefined,
    frontmatterNodeId: incomingFrontmatter.node_id,
  })
  if (identity === undefined || !identity.trusted) {
    const preserveNodeId =
      params.trackedMetadataAvailable === false
        ? (getExistingRepoNodeId(existingFiles[page.path], page.path) ?? incomingFrontmatter.node_id)
        : undefined
    return {
      path: page.path,
      content: updateRepoPageFrontmatter(page.content, preserveNodeId),
    }
  }

  const nodeMatch = identity.trusted ? findRepoPageByNodeId(existingFiles, identity.nodeId) : undefined
  const historicalPages: string[] = []

  if (nodeMatch !== undefined && nodeMatch.path !== page.path) {
    historicalPages.push(nodeMatch.content)
    delete existingFiles[nodeMatch.path]
    if (!deletedPaths.includes(nodeMatch.path)) deletedPaths.push(nodeMatch.path)
    const slugMatch = existingFiles[page.path]
    if (slugMatch !== undefined) historicalPages.push(slugMatch)
    migrations.push({oldSlug: nodeMatch.slug, newSlug: pageSlug})
    return {
      path: page.path,
      content: mergeRepoPageContent(page.content, historicalPages, {
        nodeId: identity.nodeId,
        title: repoTargetTitle(params.target) ?? incomingFrontmatter.title,
        aliases: [nodeMatch.slug],
      }),
    }
  }

  return {
    path: page.path,
    content: updateRepoPageFrontmatter(page.content, identity.nodeId),
  }
}

function resolvePageIdentity(params: {
  trackedNodeId?: string
  targetNodeId?: string
  fallbackNodeId?: string
  frontmatterNodeId?: string
}): {nodeId: string; trusted: boolean} | undefined {
  if (params.trackedNodeId !== undefined) return {nodeId: params.trackedNodeId, trusted: true}
  if (params.targetNodeId !== undefined) return {nodeId: params.targetNodeId, trusted: true}
  if (params.fallbackNodeId !== undefined) return {nodeId: params.fallbackNodeId, trusted: false}
  if (params.frontmatterNodeId !== undefined) return {nodeId: params.frontmatterNodeId, trusted: false}
  return undefined
}

function findRepoPageByNodeId(
  files: Record<string, string>,
  nodeId: string,
): {path: string; slug: string; content: string} | undefined {
  const candidates = Object.entries(files)
    .filter(([path]) => isRepoPagePath(path))
    .sort(([left], [right]) => left.localeCompare(right))
  for (const [path, content] of candidates) {
    const frontmatter = parseFrontmatter(path, content)
    if (frontmatter.node_id === nodeId) {
      return {path, slug: basename(path, '.md'), content}
    }
  }
  return undefined
}

function mergeRepoPageContent(
  incomingContent: string,
  historicalContents: string[],
  changes: {nodeId: string; title?: string; aliases?: string[]},
): string {
  const incoming = parseFrontmatterDocument(incomingContent)
  const historical = historicalContents.map(content => parseFrontmatterDocument(content))
  const values: Record<string, unknown> = {...incoming.values}
  const records = [incoming.values, ...historical.map(page => page.values)]

  for (const key of ['aliases', 'tags', 'related', 'sources']) {
    const merged = mergeFrontmatterArray(records, key)
    if (merged.length > 0) values[key] = merged
  }
  const aliases = mergeFrontmatterArray(records, 'aliases').filter(
    (value): value is string => typeof value === 'string',
  )
  for (const alias of changes.aliases ?? []) {
    if (!aliases.includes(alias)) aliases.push(alias)
  }
  if (aliases.length > 0) values.aliases = aliases
  if (changes.title !== undefined) values.title = changes.title
  values.node_id = changes.nodeId
  delete values.database_id

  const createdDates = records
    .map(record => record.created)
    .filter((value): value is string => typeof value === 'string' && DATE_PATTERN.test(value))
    .sort()
  if (createdDates[0] !== undefined) values.created = createdDates[0]

  let body = incoming.body.trim()
  for (const page of historical) {
    const historicalBody = page.body.trim()
    if (historicalBody !== '' && !body.includes(historicalBody)) {
      body = body === '' ? historicalBody : `${body}\n\n${historicalBody}`
    }
  }

  return renderFrontmatterDocument(values, body)
}

function updateRepoPageFrontmatter(content: string, nodeId?: string): string {
  const document = parseFrontmatterDocument(content)
  if (nodeId === undefined) delete document.values.node_id
  else document.values.node_id = nodeId
  delete document.values.database_id
  return renderFrontmatterDocument(document.values, document.body)
}

function getExistingRepoNodeId(content: string | undefined, path: string): string | undefined {
  if (content === undefined) return undefined
  return parseFrontmatter(path, content).node_id
}

function renderFrontmatterDocument(values: Record<string, unknown>, body: string): string {
  return normalizeText(`---\n${stringify(values).trimEnd()}\n---\n\n${body.trim()}\n`)
}

function rewriteInboundWikilinks(
  files: Record<string, string>,
  migrations: readonly {oldSlug: string; newSlug: string}[],
): void {
  for (const migration of migrations) {
    // eslint-disable-next-line unicorn/prefer-string-raw
    const escapedOldSlug = migration.oldSlug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    // eslint-disable-next-line unicorn/prefer-string-raw
    const pattern = new RegExp(`\\[\\[${escapedOldSlug}(?=\\||\\]\\])`, 'gu')
    for (const [path, content] of Object.entries(files)) {
      files[path] = content.replace(pattern, `[[${migration.newSlug}`)
    }
  }
}

function mergeFrontmatterArray(records: Record<string, unknown>[], key: string): unknown[] {
  const values: unknown[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const candidate = record[key]
    if (!Array.isArray(candidate)) continue
    for (const value of candidate) {
      const fingerprint = JSON.stringify(value)
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      values.push(value)
    }
  }
  return values
}

function parseFrontmatterDocument(content: string): {values: Record<string, unknown>; body: string} {
  const match = /^---\n([\s\S]+?)\n---\n?/u.exec(content)
  if (match === null || match[1] === undefined) {
    throw new Error('validated wiki page is missing frontmatter')
  }
  const parsed: unknown = parse(match[1])
  if (!isRecord(parsed)) throw new Error('validated wiki page frontmatter is not an object')
  return {values: parsed, body: content.slice(match[0].length)}
}

function isRepoPagePath(path: string): boolean {
  return path.startsWith(`${WIKI_ROOT}/repos/`) && path.endsWith('.md')
}

function repoTargetTitle(target: string): string | undefined {
  if (!target.startsWith('repo:')) return undefined
  const nameWithOwner = target.slice('repo:'.length)
  const slash = nameWithOwner.indexOf('/')
  if (slash < 1 || slash === nameWithOwner.length - 1) return undefined
  return nameWithOwner
}

function repoTargetSlug(target: string): string | undefined {
  const parts = repoTargetParts(target)
  return parts === undefined ? undefined : computeRepoSlug(parts.owner, parts.name)
}

function collectWikiPages(files: Record<string, string>): ParsedWikiPage[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`${WIKI_ROOT}/`) && path.endsWith('.md'))
    .map(([path, content]) => {
      const frontmatter = parseFrontmatter(path, content)
      return {
        path,
        slug: basename(path, '.md'),
        type: frontmatter.type,
        title: frontmatter.title,
        content,
      }
    })
}

function extractWikilinks(content: string): string[] {
  return [...new Set(collectWikilinks(content).map(link => link.trim()))]
}

function extractIndexHeader(index: string): string {
  const marker = index.indexOf('## Repos')
  return marker === -1
    ? '# Wiki Index\n\nMaster catalog of all wiki pages, organized by type.\n\n'
    : index.slice(0, marker)
}

function extractIndexFooter(index: string): string {
  const marker = index.lastIndexOf('\n---')
  return marker === -1
    ? '\n---\n\n_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._\n'
    : index.slice(marker)
}

function assertWikiPagePath(path: string): void {
  const pattern = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[a-z0-9.-]+\.md$/
  if (!pattern.test(path)) {
    throw new WikiIngestError({
      code: 'INVALID_PAGE_PATH',
      message: `${path} is outside the allowed wiki directories`,
      remediation:
        'Write wiki pages only under knowledge/wiki/repos, topics, entities, or comparisons using kebab-case filenames.',
    })
  }
}

export function pageTypeFromPath(path: string): WikiPageType {
  if (path.includes('/repos/')) return 'repo'
  if (path.includes('/topics/')) return 'topic'
  if (path.includes('/entities/')) return 'entity'
  return 'comparison'
}

function isValidFilename(type: WikiPageType, filename: string): boolean {
  if (!/^[a-z0-9.-]+$/.test(filename) || !filename.endsWith('.md')) {
    return false
  }

  const stem = filename.slice(0, -3)

  if (type === 'repo') {
    const parts = stem.split('--')
    return parts.length === 2 && parts.every(part => part !== '' && !part.startsWith('-') && !part.endsWith('-'))
  }

  if (type === 'comparison') {
    const parts = stem.split('-vs-')
    return parts.length === 2 && parts.every(part => part !== '' && !part.startsWith('-') && !part.endsWith('-'))
  }

  return stem !== '' && !stem.startsWith('-') && !stem.endsWith('-')
}

function isWikiPageType(value: unknown): value is WikiPageType {
  return value === 'repo' || value === 'topic' || value === 'entity' || value === 'comparison'
}

function isConflictError(error: unknown): boolean {
  return isRecord(error) && error.status === 409
}

function isApiErrorStatus(error: unknown, status: number): boolean {
  return isRecord(error) && error.status === status
}

async function delayConflictRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(1000 * 2 ** (attempt - 1) + Math.random() * 500, 10_000)
  await new Promise(resolve => setTimeout(resolve, delayMs))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function formatTimestamp(value: Date): string {
  const year = value.getUTCFullYear()
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${value.getUTCDate()}`.padStart(2, '0')
  const hour = `${value.getUTCHours()}`.padStart(2, '0')
  const minute = `${value.getUTCMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

/**
 * Read the existing wiki files from the working tree, and report the data-branch commit they were
 * synced from: `WIKI_INGEST_DATA_TIP_SHA`, when the workflow exports the tip it synced `knowledge/` from.
 * Without it there is no recorded base and the commit guards from its own first read.
 */
async function loadExistingWikiFiles(): Promise<{files: Record<string, string>; baseCommitSha: string | undefined}> {
  const files: Record<string, string> = {}
  const recordedTip = process.env.WIKI_INGEST_DATA_TIP_SHA
  const baseCommitSha = recordedTip === undefined || recordedTip === '' ? undefined : recordedTip

  for (const path of [INDEX_PATH, LOG_PATH]) {
    try {
      files[path] = await readFile(path, 'utf8')
    } catch (error: unknown) {
      if (isEnoentError(error)) {
        files[path] = ''
        continue
      }

      throw error
    }
  }

  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries: Dirent[]

    try {
      entries = await readdir(directoryPath, {withFileTypes: true})
    } catch (error: unknown) {
      if (isEnoentError(error)) {
        continue
      }

      throw error
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const path = `${directoryPath}/${entry.name}`
      try {
        files[path] = await readFile(path, 'utf8')
      } catch (error: unknown) {
        if (isEnoentError(error)) {
          continue
        }

        throw error
      }
    }
  }

  return {files, baseCommitSha}
}

async function loadWorkingTreeWikiFiles(paths: string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {}

  for (const path of paths) {
    files[path] = await readFile(path, 'utf8')
  }

  return files
}

async function getChangedWikiPaths(): Promise<string[]> {
  const {stdout} = await execFileAsync('git', [
    'status',
    '--porcelain',
    '--',
    INDEX_PATH,
    LOG_PATH,
    `${WIKI_ROOT}/repos`,
    `${WIKI_ROOT}/topics`,
    `${WIKI_ROOT}/entities`,
    `${WIKI_ROOT}/comparisons`,
  ])

  return parsePorcelainPaths(stdout).filter(path => path !== INDEX_PATH && path !== LOG_PATH && path.endsWith('.md'))
}

/**
 * Parse paths from `git status --porcelain=v1` output.
 *
 * Porcelain v1 format is `XY<space>PATH\n` where X = index status and Y = worktree
 * status. Either position may be a literal space for "unchanged". Example lines:
 * - ` M path/to/file` — modified in worktree, not staged (X = space)
 * - `M  path/to/file` — staged modification (Y = space)
 * - `A  path/to/file` — newly added (staged)
 * - `?? path/to/file` — untracked
 * - ` D path/to/file` — worktree deletion (file gone from disk)
 * - `D  path/to/file` — staged deletion
 *
 * Rename lines (`XY OLD -> NEW`) and submodules are out of scope — this script
 * only commits additive wiki markdown files, never renames.
 *
 * Deletions are filtered out. The wiki commit path's contract is additive-only,
 * and `loadWorkingTreeWikiFiles` would crash with ENOENT trying to read a deleted
 * path. Production incident (2026-04-19): the survey-repo workflow's
 * `Sync wiki from data branch` step removed files that exist on main but not on
 * data, surfacing those deletions through porcelain and crashing the ingest.
 * Any status where X or Y is `D` signals the file is absent or being removed —
 * skip it.
 *
 * Historical bug: a prior implementation used `line.trim()` before `line.slice(3)`,
 * which stripped the X-position space for unstaged changes and caused
 * `line.slice(3)` to eat the first character of the path (e.g. `knowledge/...`
 * became `nowledge/...` and the subsequent `readFile` failed with ENOENT). The
 * fix: preserve the fixed 3-char prefix and only strip trailing CR for cross-platform safety.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  return (
    stdout
      .split('\n')
      .map(line => line.replace(/\r$/, ''))
      .filter(line => line.length >= 4)
      // Skip any status where X or Y is 'D' (deletion). Working-tree ingestion only
      // reads surviving files; canonical page migrations carry deletions explicitly
      // through `BuildWikiIngestChangesResult.deletedPaths` into the Git Data API tree.
      .filter(line => !line.slice(0, 2).includes('D'))
      .map(line => line.slice(3))
      .filter(path => path !== '')
  )
}

function parsePayload(raw: string): WikiIngestPayload {
  const parsed: unknown = JSON.parse(raw)
  if (
    !isRecord(parsed) ||
    !isWikiOperation(parsed.operation) ||
    typeof parsed.target !== 'string' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.sources) ||
    !Array.isArray(parsed.pages)
  ) {
    throw new WikiIngestError({
      code: 'INVALID_PAYLOAD',
      message: 'wiki ingest payload is missing required fields',
      remediation: 'Provide operation, target, summary, sources, and pages in the JSON payload.',
    })
  }

  return {
    operation: parsed.operation,
    target: parsed.target,
    summary: parsed.summary,
    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
    sources: parsed.sources.filter(isWikiSource),
    pages: parsed.pages.filter(isWikiPageInput),
    node_id: typeof parsed.node_id === 'string' ? parsed.node_id : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
    owner: typeof parsed.owner === 'string' ? parsed.owner : undefined,
    repo: typeof parsed.repo === 'string' ? parsed.repo : undefined,
    branch: typeof parsed.branch === 'string' ? parsed.branch : undefined,
  }
}

function isWikiOperation(value: unknown): value is WikiOperation {
  return value === 'survey' || value === 'event' || value === 'lint' || value === 'manual-edit'
}

function isWikiPageInput(value: unknown): value is WikiPageInput {
  return isRecord(value) && typeof value.path === 'string' && typeof value.content === 'string'
}

function defaultCommitMessage(payload: WikiIngestPayload): string {
  return `feat(knowledge): ${payload.operation} ${payload.target}`
}

const WIKI_PAGE_PATTERN = /^knowledge\/wiki\/(?:repos|topics|entities|comparisons)\/[^/]+\.md$/

/**
 * Count the number of wiki entry pages in a list of paths.
 * Only paths matching `knowledge/wiki/(repos|topics|entities|comparisons)/<filename>.md`
 * are counted. Excludes knowledge/index.md, knowledge/log.md, and any paths outside
 * the four category directories.
 */
export function countWikiPages(paths: string[]): number {
  return paths.filter(p => WIKI_PAGE_PATTERN.test(p)).length
}

async function emitPagesChanged(n: number): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    await appendFile(outputPath, `pages_changed=${n}\n`)
  }
}

interface HandoffManifest {
  changed: string[]
  deleted: string[]
}

interface LoadedHandoff {
  readonly octokit: OctokitClient
  /** The data commit the agent job synced, from the workflow's sync step. */
  readonly agentCommitSha: string
  /** Log text the agent appended; `undefined` when it appended nothing usable. */
  readonly agentLogEntries: string | undefined
  /** The handed-off pages: everything the manifest lists as changed or deleted. */
  readonly pagePaths: string[]
  /** The manifest's deleted pages, shared files excluded. */
  readonly deletedPagePaths: string[]
  readonly warnings: WikiIngestWarning[]
}

function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function handoffBaseInvalid(message: string): WikiIngestError {
  return new WikiIngestError({
    code: 'HANDOFF_BASE_INVALID',
    message: `wiki ingest refused: ${message}`,
    remediation: HANDOFF_BASE_REMEDIATION,
  })
}

/** LF line endings and exactly one final newline; an empty log stays empty. */
function normalizeLogText(value: string): string {
  const trimmed = value.replaceAll('\r\n', '\n').trimEnd()
  return trimmed === '' ? '' : `${trimmed}\n`
}

/**
 * The log text an agent appended: what its `knowledge/log.md` adds after `knowledge/log.md` at the
 * commit it started from. `undefined` when the agent changed anything before that point, or the base
 * log is empty, so there is nothing safe to take. Both inputs are normalized first (LF, one final newline).
 */
export function deriveAgentLogEntries(baseLog: string, handoffLog: string): string | undefined {
  const base = normalizeLogText(baseLog)
  const handoff = normalizeLogText(handoffLog)
  if (base === '' || !handoff.startsWith(base)) return undefined
  return handoff.slice(base.length)
}

async function readHandoffManifest(handoffDir: string): Promise<HandoffManifest> {
  const parsed: unknown = JSON.parse(await readFile(join(handoffDir, 'manifest.json'), 'utf8'))
  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(entry => typeof entry === 'string')
  if (!isRecord(parsed) || !isStringArray(parsed.changed) || !isStringArray(parsed.deleted)) {
    throw new WikiIngestError({
      code: 'INVALID_PAYLOAD',
      message: 'wiki handoff manifest.json must hold string arrays "changed" and "deleted"',
      remediation: 'Rebuild the handoff artifact with scripts/wiki-handoff-build.ts.',
    })
  }
  return {changed: parsed.changed, deleted: parsed.deleted}
}

/** The text of `path` in the tree of `commitSha`, or `undefined` when the commit has no such file. */
async function readFileAtCommit(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  commitSha: string,
  path: string,
): Promise<string | undefined> {
  const commit = await octokit.rest.git.getCommit({owner, repo, commit_sha: commitSha})
  const tree = await octokit.rest.git.getTree({owner, repo, tree_sha: commit.data.tree.sha, recursive: 'true'})
  if (tree.data.truncated === true) throw new Error('tree listing was truncated')
  const entry = tree.data.tree.find(candidate => candidate.path === path)
  if (entry?.sha === undefined || entry.type !== 'blob') return undefined
  const blob = await octokit.rest.git.getBlob({owner, repo, file_sha: entry.sha})
  return Buffer.from(blob.data.content, 'base64').toString('utf8')
}

/**
 * Reads the handoff the trusted job applied. `undefined` outside a handoff run (neither
 * `WIKI_HANDOFF_DIR` nor `WIKI_HANDOFF_BASE_SHA` set). Inside one, the agent job's data commit must be a
 * full commit SHA, and the log entries the agent appended are derived against that commit's `log.md`.
 */
async function loadHandoff(
  dependencies: RunWikiIngestCliDependencies,
  target: {owner?: string; repo?: string},
): Promise<LoadedHandoff | undefined> {
  const handoffDir = envValue('WIKI_HANDOFF_DIR')
  const agentCommitSha = envValue('WIKI_HANDOFF_BASE_SHA')
  if (handoffDir === undefined && agentCommitSha === undefined) return undefined
  if (handoffDir === undefined || agentCommitSha === undefined || !COMMIT_SHA_PATTERN.test(agentCommitSha)) {
    throw handoffBaseInvalid('the agent job data commit is missing or is not a commit SHA')
  }

  const octokit = dependencies.octokit ?? (await createOctokitFromEnv())
  const manifest = await readHandoffManifest(handoffDir)
  const pagePaths = [...manifest.changed, ...manifest.deleted]
  const deletedPagePaths = manifest.deleted.filter(path => path !== LOG_PATH && path !== INDEX_PATH)
  if (!manifest.changed.includes(LOG_PATH)) {
    return {octokit, agentCommitSha, agentLogEntries: undefined, pagePaths, deletedPagePaths, warnings: []}
  }

  const handoffLog = await readFile(join(handoffDir, 'files', LOG_PATH), 'utf8')
  let baseLog: string | undefined
  try {
    baseLog = await readFileAtCommit(
      octokit,
      target.owner ?? DEFAULT_OWNER,
      target.repo ?? DEFAULT_REPO,
      agentCommitSha,
      LOG_PATH,
    )
  } catch {
    throw handoffBaseInvalid(`could not read ${LOG_PATH} at the agent job data commit`)
  }

  const agentLogEntries = baseLog === undefined ? undefined : deriveAgentLogEntries(baseLog, handoffLog)
  const warnings: WikiIngestWarning[] =
    agentLogEntries === undefined
      ? [
          {
            code: 'agent-log-entries-dropped',
            reason: baseLog === undefined ? 'base-log-missing' : 'not-append-only',
          },
        ]
      : []
  return {octokit, agentCommitSha, agentLogEntries, pagePaths, deletedPagePaths, warnings}
}

export async function runWikiIngestCli(dependencies: RunWikiIngestCliDependencies = {}): Promise<void> {
  const payloadPath = process.argv[2] ?? process.env.WIKI_INGEST_INPUT
  const readCorrectionsImpl = dependencies.readCorrections ?? readCorrections
  const commitWikiChangesImpl = dependencies.commitWikiChanges ?? commitWikiChanges
  const getChangedWikiPathsImpl = dependencies.getChangedWikiPaths ?? getChangedWikiPaths
  const {files: existingFiles, baseCommitSha} = await loadExistingWikiFiles()
  let correctionRead: CorrectionsReadResult
  try {
    correctionRead = await readCorrectionsImpl()
  } catch (error: unknown) {
    if (error instanceof CorrectionStoreError) {
      process.stderr.write(
        `wiki-ingest:warning:${JSON.stringify({
          code: 'corrections-read-failed',
          error: error.code,
          path: error.path,
          message: error.message,
        })}\n`,
      )
    }
    throw error
  }
  for (const warning of correctionRead.warnings) {
    process.stderr.write(`wiki-ingest:warning:${JSON.stringify({code: 'corrections-read-failed', message: warning})}\n`)
  }

  let built: BuildWikiIngestChangesResult
  let owner: string | undefined
  let repo: string | undefined
  let branch: string | undefined
  let message: string
  let identityWarnings: WikiIngestWarning[] = []

  let committedPagePaths: string[]
  let handoff: LoadedHandoff | undefined

  try {
    if (payloadPath !== undefined && payloadPath !== '') {
      const payload = parsePayload(await readFile(payloadPath, 'utf8'))
      handoff = await loadHandoff(dependencies, payload)
      const tracked = await loadTrackedRepoNodeIds()
      identityWarnings = [...tracked.warnings, ...(handoff?.warnings ?? [])]
      built = buildWikiIngestChanges({
        existingFiles,
        operation: payload.operation,
        target: payload.target,
        summary: payload.summary,
        timestamp: payload.timestamp === undefined ? new Date() : new Date(payload.timestamp),
        sources: payload.sources,
        pages: payload.pages,
        trackedRepoNodeIds: tracked.nodeIds,
        fallbackNodeId: payload.node_id,
        trackedMetadataAvailable: tracked.metadataAvailable,
        corrections: correctionRead.corrections,
        agentLogEntries: handoff?.agentLogEntries,
        handoffDeletedPaths: handoff?.deletedPagePaths,
      })
      owner = payload.owner
      repo = payload.repo
      branch = payload.branch
      message = payload.message ?? defaultCommitMessage(payload)
      committedPagePaths = payload.pages.map(p => p.path)
    } else {
      const changedPaths = await getChangedWikiPathsImpl()
      handoff = await loadHandoff(dependencies, {owner: process.env.WIKI_OWNER, repo: process.env.WIKI_REPO})
      // `git status` drops deletions, so an agent's deleted pages come from the manifest.
      if (changedPaths.length === 0 && (handoff?.deletedPagePaths ?? []).length === 0) {
        await emitPagesChanged(0)
        process.stdout.write(`${JSON.stringify({committed: false, attempts: 1, pagesChanged: 0})}\n`)
        return
      }

      const pages = await loadWorkingTreeWikiFiles(changedPaths)
      const operation = isWikiOperation(process.env.WIKI_OPERATION) ? process.env.WIKI_OPERATION : 'event'
      const target = process.env.WIKI_TARGET ?? 'repo:unknown/unknown'
      const tracked = await loadTrackedRepoNodeIds()
      identityWarnings = [...tracked.warnings, ...(handoff?.warnings ?? [])]
      built = buildWikiIngestChanges({
        existingFiles,
        operation,
        target,
        summary: process.env.WIKI_SUMMARY ?? 'Updated wiki content from working tree changes.',
        timestamp: process.env.WIKI_TIMESTAMP === undefined ? new Date() : new Date(process.env.WIKI_TIMESTAMP),
        sources: parseSources(process.env.WIKI_SOURCES),
        pages: Object.entries(pages).map(([path, content]) => ({path, content})),
        trackedRepoNodeIds: tracked.nodeIds,
        targetNodeId: process.env.REPO_NODE_ID,
        trackedMetadataAvailable: tracked.metadataAvailable,
        corrections: correctionRead.corrections,
        agentLogEntries: handoff?.agentLogEntries,
        handoffDeletedPaths: handoff?.deletedPagePaths,
      })
      owner = process.env.WIKI_OWNER
      repo = process.env.WIKI_REPO
      branch = process.env.WIKI_BRANCH
      message =
        process.env.WIKI_COMMIT_MESSAGE ??
        `feat(knowledge): ${process.env.WIKI_OPERATION ?? 'event'} ${process.env.WIKI_TARGET ?? 'wiki update'}`
      committedPagePaths = changedPaths
    }
  } catch (error: unknown) {
    if (error instanceof WikiIngestError) {
      for (const finding of error.findings) {
        process.stderr.write(`wiki-ingest:finding:${JSON.stringify(finding)}\n`)
      }
    }
    throw error
  }

  for (const warning of identityWarnings) {
    process.stderr.write(`wiki-ingest:warning:${JSON.stringify(warning)}\n`)
  }
  for (const finding of built.findings) {
    process.stderr.write(`wiki-ingest:finding:${JSON.stringify(finding)}\n`)
  }

  const result = await commitWikiChangesImpl({
    owner,
    repo,
    branch,
    message,
    files: built.files,
    deletedPaths: built.deletedPaths,
    ...(baseCommitSha === undefined ? {} : {baseCommitSha}),
    ...(handoff === undefined
      ? {}
      : {octokit: handoff.octokit, handoff: {agentCommitSha: handoff.agentCommitSha, paths: handoff.pagePaths}}),
  })

  const pagesChanged = countWikiPages(committedPagePaths)
  await emitPagesChanged(pagesChanged)
  process.stdout.write(`${JSON.stringify({...result, pagesChanged})}\n`)
}

type ReadUtf8File = (path: string, encoding: 'utf8') => Promise<string>

const readUtf8File: ReadUtf8File = async (path, encoding) => readFile(path, encoding)

export async function loadTrackedRepoNodeIds(
  readFileImpl: ReadUtf8File = readUtf8File,
): Promise<TrackedRepoNodeIdsResult> {
  let raw: string
  try {
    raw = await readFileImpl('metadata/repos.yaml', 'utf8')
  } catch {
    return {
      metadataAvailable: false,
      nodeIds: new Map(),
      warnings: [{code: 'repos-metadata-unavailable', reason: 'read-failed'}],
    }
  }

  let parsed: unknown
  try {
    parsed = parse(raw)
    assertReposFile(parsed)
  } catch {
    return {
      metadataAvailable: false,
      nodeIds: new Map(),
      warnings: [{code: 'repos-metadata-unavailable', reason: 'parse-failed'}],
    }
  }

  const candidates = parsed.repos.flatMap(entry => {
    if (entry.private !== false || typeof entry.node_id !== 'string') return []
    return [
      {
        databaseId: entry.database_id,
        nodeId: entry.node_id,
        slug: computeRepoSlug(entry.owner, entry.name),
      },
    ]
  })
  const nodeSlugs = new Map<string, Set<string>>()
  const databaseSlugs = new Map<number, Set<string>>()
  for (const candidate of candidates) {
    const nodeGroup = nodeSlugs.get(candidate.nodeId) ?? new Set<string>()
    nodeGroup.add(candidate.slug)
    nodeSlugs.set(candidate.nodeId, nodeGroup)
    if (candidate.databaseId !== undefined) {
      const databaseGroup = databaseSlugs.get(candidate.databaseId) ?? new Set<string>()
      databaseGroup.add(candidate.slug)
      databaseSlugs.set(candidate.databaseId, databaseGroup)
    }
  }

  const collidingSlugs = new Set<string>()
  const warningGroups = new Map<string, Set<string>>()
  const registerCollision = (slugs: Set<string>): void => {
    if (slugs.size < 2) return
    const orderedSlugs = [...slugs].sort((left, right) => left.localeCompare(right))
    const key = orderedSlugs.join('\u0000')
    warningGroups.set(key, slugs)
    for (const slug of slugs) collidingSlugs.add(slug)
  }
  for (const slugs of nodeSlugs.values()) registerCollision(slugs)
  for (const slugs of databaseSlugs.values()) registerCollision(slugs)

  const warnings: WikiIngestWarning[] = [...warningGroups.values()]
    .map((slugs): WikiIngestWarning => ({
      code: 'duplicate-repo-identity' as const,
      node_ids: candidates
        .filter(candidate => slugs.has(candidate.slug))
        .map(candidate => candidate.nodeId)
        .filter((nodeId, index, values) => values.indexOf(nodeId) === index)
        .sort((left, right) => left.localeCompare(right)),
      slugs: [...slugs].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) =>
      (left.slugs?.join('\u0000') ?? left.code).localeCompare(right.slugs?.join('\u0000') ?? right.code),
    )

  const nodeIds = new Map<string, string>()
  for (const candidate of candidates) {
    if (collidingSlugs.has(candidate.slug)) continue
    nodeIds.set(candidate.slug, candidate.nodeId)
  }
  return {metadataAvailable: true, nodeIds, warnings}
}

function repoTargetParts(target: string): {owner: string; name: string} | undefined {
  if (!target.startsWith('repo:')) return undefined
  const nameWithOwner = target.slice('repo:'.length)
  const slash = nameWithOwner.indexOf('/')
  if (slash < 1 || slash === nameWithOwner.length - 1) return undefined
  return {owner: nameWithOwner.slice(0, slash), name: nameWithOwner.slice(slash + 1)}
}

function parseSources(raw: string | undefined): WikiSource[] {
  if (raw === undefined || raw === '') {
    return []
  }

  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed.filter(isWikiSource) : []
}

function isWikiSource(value: unknown): value is WikiSource {
  return isRecord(value) && typeof value.url === 'string' && typeof value.accessed === 'string'
}

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === 'ENOENT'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiIngestCli()
}
