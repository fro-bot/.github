/**
 * Trusted publish step for the drafted solution docs workflow: the only holder of a write
 * credential. It validates the agent's handoff, privacy-gates every public surface, and only then
 * writes — either a commit on the drafted branch plus a PR, or comments and closures when the run
 * produced no doc changes.
 *
 * Order (every step fails closed; nothing is written until step 6):
 *  1. load the privacy token sets (private repos + redacted canonical IDs);
 *  2. validate the handoff against the drafted-solutions path policy into a staging dir;
 *  3. validate the agent's evidence rows against the digest (exactly one row per proposal), and
 *     account for the handoff both ways: each new-doc/extension row's doc is in it, and each file in
 *     it belongs to such a row;
 *  4. re-verify digest proposals and any open drafted PR against the API (the digest and PR body
 *     are not trusted), resolve the commit that will back the PR, and check that every row about to
 *     claim a doc (the whole merged PR body, existing rows included, plus covered rows closed
 *     directly) points at one on that commit's tree or in the handoff: the live drafted-branch head
 *     when a PR is open, else main's head;
 *  5. gate every file (path and content), the PR title, the commit message, the fully rendered PR
 *     body, and every comment;
 *  6. write.
 *
 * Routing (outcome x drafted PR open x doc changes):
 *   new-doc / extension -> always in the PR body (they require doc changes in the handoff).
 *   covered             -> in the PR body when a PR is open or the run has doc changes; otherwise
 *                          comment + close as completed. A PR open with no doc changes gets a
 *                          body-only update (no commit, no ref write).
 *   unverified          -> always comment + close as not planned; never in the PR body or a
 *                          `Closes` line (a merge would close it as completed).
 * Closure comments carry a hidden per-decision marker (issue, outcome, proposal body hash) so a
 * retry of the same decision never posts a second comment.
 *
 * Error messages never echo agent-supplied text that failed the privacy gate.
 *
 * CLI contract:
 * - env `GITHUB_TOKEN` (App token with contents, pull-requests, issues write), `GITHUB_REPOSITORY`,
 *   `DRAFTED_SOLUTIONS_DIGEST_PATH`, `DRAFTED_SOLUTIONS_HANDOFF_DIR` (manifest.json + files/),
 *   `DRAFTED_SOLUTIONS_ROWS_PATH` (the agent's evidence rows: a JSON array of coverage rows), and
 *   optionally `DRAFTED_SOLUTIONS_RESULT_PATH` (result JSON destination). Covered docs are verified
 *   through the API, on the tree that will back the PR; no checkout is read.
 * - stdout: one-line JSON result. exit 0 on success, 1 on any fail-closed condition.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {OctokitClient} from './capture-learnings-harvest.ts'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {isRecord, loadPrivateTokensFromDisk} from './capture-learnings-privacy.ts'
import {
  hashProposalBody,
  mergeCoverageRows,
  parseCoverageBlock,
  renderPrBody,
  validateCoverageRows,
  type CoverageRow,
} from './drafted-solutions-pr-body.ts'
import {
  BASE_BRANCH,
  BOT_LOGIN,
  DRAFTED_BRANCH,
  DraftedSolutionsError,
  findOpenDraftedPr,
  isLearningProposalIssue,
  parseDigest,
  readRefSha,
  reauthorizeRows,
  type DraftedDigest,
  type OpenDraftedPr,
} from './drafted-solutions-shared.ts'
import {loadRedactedCanonicalIdsFromDisk} from './status-truth-proposals.ts'
import {
  applyPublicOutputGate,
  makePublicOutputTokens,
  type PublicOutputSurface,
  type PublicOutputTokens,
} from './status-truth-public-output.ts'
import {
  DRAFTED_SOLUTIONS_HANDOFF_POLICY,
  validateAndApplyHandoff,
  WikiHandoffValidationError,
} from './wiki-handoff-core.ts'

export const DRAFTED_PR_TITLE = 'docs(solutions): drafted learnings from open proposals'
export const DRAFTED_COMMIT_MESSAGE = 'docs(solutions): draft learnings from open proposals'
const REVIEWER = 'fro-bot'
const DRAFTED_UPDATE_REF = `heads/${DRAFTED_BRANCH}`
const DRAFTED_CREATE_REF = `refs/heads/${DRAFTED_BRANCH}`
const PR_APPEARED_MESSAGE = 'drafted PR appeared during publish; the next run reconciles it'
const WITHHELD = '[message withheld: matched the privacy gate]'

export interface PublishLogger {
  info: (message: string) => void
}

export interface PublishParams {
  octokit: OctokitClient
  owner: string
  repo: string
  digestPath: string
  handoffDir: string
  rowsPath: string
  loadTokens?: () => Promise<PublicOutputTokens>
  logger?: PublishLogger
  /** Overridable so tests can prove the title is gated. */
  prTitle?: string
}

/** Proposals closed directly this run, and proposals skipped because they were already closed. */
interface DirectClosures {
  closed: number[]
  skipped: number[]
}

export type PublishResult =
  | {mode: 'noop'}
  | ({mode: 'created-pr'; prNumber: number; commitSha: string} & DirectClosures)
  | ({mode: 'updated-pr'; prNumber: number; commitSha: string} & DirectClosures)
  | ({mode: 'updated-pr-body'; prNumber: number} & DirectClosures)
  | ({mode: 'closed-proposals'} & DirectClosures)

interface StagedFile {
  path: string
  content: string
}

interface GateItem {
  surface: PublicOutputSurface
  label: string
  content: string
}

const DEFAULT_LOGGER: PublishLogger = {
  info(message) {
    process.stderr.write(`drafted-solutions-publish: ${message}\n`)
  },
}

function errorStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === 'number' ? error.status : undefined
}

async function loadTokensFromDisk(): Promise<PublicOutputTokens> {
  const [privateTokens, redactedCanonicalIds] = await Promise.all([
    loadPrivateTokensFromDisk(),
    loadRedactedCanonicalIdsFromDisk(),
  ])
  return makePublicOutputTokens({privateTokens, redactedCanonicalIds})
}

async function readJson(filePath: string, label: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    throw new DraftedSolutionsError(`${label} could not be read`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new DraftedSolutionsError(`${label} is not valid JSON`)
  }
}

/** Validates the handoff into a throwaway staging dir and returns what it would write. */
async function stageHandoff(handoffDir: string): Promise<StagedFile[]> {
  const stagingDir = await mkdtemp(path.join(tmpdir(), 'drafted-solutions-stage-'))
  try {
    const {applied} = await validateAndApplyHandoff({
      policy: DRAFTED_SOLUTIONS_HANDOFF_POLICY,
      handoffDir,
      workspaceDir: stagingDir,
    })
    const files: StagedFile[] = []
    for (const relativePath of applied) {
      files.push({path: relativePath, content: await readFile(path.join(stagingDir, relativePath), 'utf8')})
    }
    return files
  } catch (error: unknown) {
    if (error instanceof WikiHandoffValidationError)
      throw new DraftedSolutionsError(`handoff rejected: ${error.message}`)
    throw error
  } finally {
    await rm(stagingDir, {recursive: true, force: true})
  }
}

/**
 * Parses the agent's rows and reconciles them with the digest: exactly one row per digest
 * proposal, none extra. `bodyHash` always comes from the digest (the agent cannot be trusted to
 * hash, and must not be able to claim another body); `sourceSha` defaults to the proposal's
 * capture marker when the agent omits it.
 */
function prepareRows(raw: unknown, digest: DraftedDigest): CoverageRow[] {
  if (!Array.isArray(raw)) throw new DraftedSolutionsError('rows file must be a JSON array of coverage rows')

  const proposals = new Map(digest.proposals.map(proposal => [proposal.issue, proposal]))
  const seen = new Set<number>()
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry) || typeof entry.issue !== 'number') {
      throw new DraftedSolutionsError(`rows[${index}] must be an object with a numeric issue`)
    }
    if (!proposals.has(entry.issue)) {
      throw new DraftedSolutionsError(`row for #${entry.issue} is not in the digest`)
    }
    if (seen.has(entry.issue)) throw new DraftedSolutionsError(`duplicate row for issue #${entry.issue}`)
    seen.add(entry.issue)
  }
  for (const proposal of digest.proposals) {
    if (!seen.has(proposal.issue)) {
      throw new DraftedSolutionsError(`no evidence row for proposal #${proposal.issue}`)
    }
  }

  const filled = raw.map((entry: Record<string, unknown>) => {
    const proposal = proposals.get(entry.issue as number)
    return {
      ...entry,
      bodyHash: proposal?.bodyHash,
      ...(entry.sourceSha === undefined && proposal?.mergeSha != null ? {sourceSha: proposal.mergeSha} : {}),
    }
  })

  const validated = validateCoverageRows(filled)
  if (!validated.ok) throw new DraftedSolutionsError(validated.reason)
  return validated.rows
}

/**
 * Rows and handoff must account for each other. Forward: every new-doc/extension row's doc is in the
 * handoff. Inverse: every handoff file is the target doc of at least one new-doc/extension row, so
 * nothing rides along that no row (and no reviewer-facing evidence) vouches for. Messages name an
 * index or an issue, never an agent-supplied path.
 */
function checkRowsAgainstHandoff(rows: readonly CoverageRow[], files: readonly StagedFile[]): void {
  const changed = new Set(files.map(file => file.path))
  const draftedTargets = new Set<string>()
  for (const row of rows) {
    if (row.outcome !== 'new-doc' && row.outcome !== 'extension') continue
    if (row.targetDoc === null || !changed.has(row.targetDoc)) {
      throw new DraftedSolutionsError(`${row.outcome} row #${row.issue}: its target doc is not part of the handoff`)
    }
    draftedTargets.add(row.targetDoc)
  }
  for (const [index, file] of files.entries()) {
    if (!draftedTargets.has(file.path)) {
      throw new DraftedSolutionsError(
        `handoff file #${index + 1} is not the target doc of any new-doc or extension row`,
      )
    }
  }
}

/** True when `relativePath` is a regular file in the tree of commit `commitSha` (read through the API). */
async function docExistsAt(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  commitSha: string,
  relativePath: string,
): Promise<boolean> {
  try {
    const {data} = await octokit.rest.repos.getContent({owner, repo, path: relativePath, ref: commitSha})
    return !Array.isArray(data) && data.type === 'file'
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return false
    throw error
  }
}

/** The blob SHA of `relativePath` at `commitSha`; null when absent. Anything that is not a file is its own value. */
async function blobShaAt(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  commitSha: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const {data} = await octokit.rest.repos.getContent({owner, repo, path: relativePath, ref: commitSha})
    return !Array.isArray(data) && data.type === 'file' ? data.sha : 'not-a-file'
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

/**
 * Lost-update guard. The agent edited whole files at the digest's `draftBaseSha` (D); the commit is
 * built on the live base (B). If any handoff path differs between D and B (content changed, or the
 * file appeared or vanished), publishing would silently overwrite whoever changed it, so fail
 * closed. Both absent is fine; changes to other files do not matter. Counts only, never paths.
 */
async function checkDraftBaseUnmoved(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  draftBaseSha: string,
  liveBaseSha: string,
  files: readonly StagedFile[],
): Promise<void> {
  if (draftBaseSha === liveBaseSha) return
  let moved = 0
  for (const file of files) {
    const [drafted, live] = await Promise.all([
      blobShaAt(octokit, owner, repo, draftBaseSha, file.path),
      blobShaAt(octokit, owner, repo, liveBaseSha, file.path),
    ])
    if (drafted !== live) moved += 1
  }
  if (moved > 0) {
    throw new DraftedSolutionsError(`drafted base moved under ${moved} handoff file(s); re-run to redraft`)
  }
}

/**
 * Every row that will claim a doc must point at one that exists on the tree that will back the PR:
 * the base commit's tree plus this handoff. Applies to all rows about to be rendered (this run's
 * and the open PR's existing ones) and to covered rows about to be closed directly. Docs this
 * handoff writes need no lookup; each distinct path is looked up once. Names the issue only.
 */
async function checkRowDocs(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  baseSha: string,
  rows: readonly CoverageRow[],
  files: readonly StagedFile[],
): Promise<void> {
  const inHandoff = new Set(files.map(file => file.path))
  const verdicts = new Map<string, boolean>()
  for (const row of rows) {
    const doc = row.targetDoc
    if (doc === null || inHandoff.has(doc)) continue
    let exists = verdicts.get(doc)
    if (exists === undefined) {
      exists = await docExistsAt(octokit, owner, repo, baseSha, doc)
      verdicts.set(doc, exists)
    }
    if (!exists) {
      throw new DraftedSolutionsError(`coverage row for #${row.issue} points at a doc missing from the published tree`)
    }
  }
}

/** Re-checks each digest proposal against the live issue; returns issue number → state. */
async function verifyProposals(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  digest: DraftedDigest,
): Promise<Map<number, string>> {
  const states = new Map<number, string>()
  for (const proposal of digest.proposals) {
    let issue
    try {
      issue = (await octokit.rest.issues.get({owner, repo, issue_number: proposal.issue})).data
    } catch {
      throw new DraftedSolutionsError(`proposal #${proposal.issue} could not be read`)
    }
    if (!isLearningProposalIssue(issue)) {
      throw new DraftedSolutionsError(
        `proposal #${proposal.issue} is not a learning-proposal issue authored by the bot`,
      )
    }
    if (hashProposalBody(issue.body ?? '') !== proposal.bodyHash) {
      throw new DraftedSolutionsError(`proposal #${proposal.issue} changed since harvest`)
    }
    states.set(proposal.issue, issue.state)
  }
  return states
}

/**
 * Hidden per-decision marker: the same issue, outcome, and proposal body. A retry of the same
 * decision sees it and does not comment twice; a changed body or outcome is a new decision and
 * gets its own comment.
 */
export function closureMarker(row: CoverageRow): string {
  return `<!-- fro-bot:drafted-solutions-closure v2 issue=${row.issue} outcome=${row.outcome} body=${row.bodyHash} -->`
}

/** Agent text goes into a public comment: keep it from forging or terminating an HTML comment marker. */
function escapeCommentText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function closingComment(row: CoverageRow): string {
  const reason = escapeCommentText(row.reason)
  const body =
    row.outcome === 'covered'
      ? [
          `Reviewed against the merged change, its reviews, and current main: this lesson is already documented in \`${escapeCommentText(row.targetDoc ?? '')}\`.`,
          reason,
          'Closing as completed.',
        ]
      : [
          "Could not verify this proposal's claims against the merged change and current main, so no doc was drafted.",
          reason,
          'Closing as not planned. Reopen with a corrected body to have it considered again.',
        ]
  return [...body, closureMarker(row)].join('\n\n')
}

/** Throws on the first blocked surface. Names the surface by label, never by blocked text. */
function assertPublicSafe(tokens: PublicOutputTokens, items: readonly GateItem[]): void {
  for (const item of items) {
    const verdict = applyPublicOutputGate({
      surface: item.surface,
      content: item.content,
      tokens,
      fingerprint: undefined,
    })
    if (!verdict.allowed) {
      throw new DraftedSolutionsError(`privacy gate blocked ${item.label}: ${verdict.blockReason}`)
    }
  }
}

function scrub(tokens: PublicOutputTokens, message: string): string {
  const verdict = applyPublicOutputGate({surface: 'pr-body', content: message, tokens, fingerprint: undefined})
  return verdict.allowed ? message : WITHHELD
}

async function commitFiles(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  parentSha: string,
  files: readonly StagedFile[],
  extraParents: readonly string[] = [],
): Promise<string> {
  const parent = await octokit.rest.git.getCommit({owner, repo, commit_sha: parentSha})
  const tree: {path: string; mode: '100644'; type: 'blob'; sha: string}[] = []
  for (const file of files) {
    const blob = await octokit.rest.git.createBlob({owner, repo, content: file.content, encoding: 'utf-8'})
    tree.push({path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha})
  }
  const createdTree = await octokit.rest.git.createTree({owner, repo, base_tree: parent.data.tree.sha, tree})
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: DRAFTED_COMMIT_MESSAGE,
    tree: createdTree.data.sha,
    parents: [parentSha, ...extraParents],
  })
  return commit.data.sha
}

async function requestReview(octokit: OctokitClient, owner: string, repo: string, prNumber: number): Promise<void> {
  try {
    await octokit.rest.pulls.requestReviewers({owner, repo, pull_number: prNumber, reviewers: [REVIEWER]})
  } catch (error: unknown) {
    // 422: already requested (or reviewer already acted). Anything else is a real failure.
    if (errorStatus(error) !== 422) throw error
  }
}

/** Parses and re-authorizes the rows of an open drafted PR; its body is rendered from them. */
async function existingRowsOf(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  pr: {number: number; body: string},
): Promise<CoverageRow[]> {
  const parsed = parseCoverageBlock(pr.body, 'existing-pr')
  if (!parsed.ok) throw new DraftedSolutionsError(`drafted PR #${pr.number}: ${parsed.reason}`)
  await reauthorizeRows(octokit, owner, repo, parsed.rows)
  return parsed.rows
}

/**
 * The commit whose tree will back the PR: the live drafted-branch head when a PR is open (not the
 * PR's recorded head, which operator or update-branch commits can outdate), else main's head.
 */
async function resolveBaseSha(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  openPr: OpenDraftedPr | null,
): Promise<string> {
  if (openPr !== null) {
    const headSha = await readRefSha(octokit, owner, repo, DRAFTED_UPDATE_REF)
    if (headSha === null) {
      throw new DraftedSolutionsError(`drafted PR #${openPr.number} is open but ${DRAFTED_BRANCH} does not exist`)
    }
    return headSha
  }
  const baseSha = await readRefSha(octokit, owner, repo, `heads/${BASE_BRANCH}`)
  if (baseSha === null) throw new DraftedSolutionsError(`${BASE_BRANCH} does not exist`)
  return baseSha
}

type PrWrite =
  | {mode: 'created-pr'; prNumber: number; commitSha: string}
  | {mode: 'updated-pr'; prNumber: number; commitSha: string}
  | {mode: 'updated-pr-body'; prNumber: number}

/** Commits the handoff and creates or updates the drafted PR. Branch writes happen only here. */
async function writePr(
  params: PublishParams,
  context: {openPr: OpenDraftedPr | null; baseSha: string; files: readonly StagedFile[]; body: string},
): Promise<PrWrite> {
  const {octokit, owner, repo} = params
  const logger = params.logger ?? DEFAULT_LOGGER
  const title = params.prTitle ?? DRAFTED_PR_TITLE
  const {openPr, baseSha, files, body} = context

  if (openPr !== null && files.length === 0) {
    // Covered rows only: repair the PR body without touching the branch.
    await octokit.rest.pulls.update({owner, repo, pull_number: openPr.number, body})
    return {mode: 'updated-pr-body', prNumber: openPr.number}
  }

  if (openPr !== null) {
    // baseSha is the live branch head (not the PR's possibly stale recorded head), read just before
    // the gate; updateRef without force fails if the branch moves in between.
    const commitSha = await commitFiles(octokit, owner, repo, baseSha, files)
    await octokit.rest.git.updateRef({owner, repo, ref: DRAFTED_UPDATE_REF, sha: commitSha, force: false})
    await octokit.rest.pulls.update({owner, repo, pull_number: openPr.number, body})
    return {mode: 'updated-pr', prNumber: openPr.number, commitSha}
  }

  // No open PR. The branch is never reset: a stale one (left by a closed PR) is fast-forwarded by a
  // commit whose parents are [main, old head] and whose tree is main's tree plus the handoff, so the
  // merge-base with main stays main's head and the PR diff is only the handoff. A non-forced
  // updateRef is a compare-and-swap: it fails if the branch moved since we read it.
  const oldHead = await readRefSha(octokit, owner, repo, DRAFTED_UPDATE_REF)
  const commitSha = await commitFiles(octokit, owner, repo, baseSha, files, oldHead === null ? [] : [oldHead])

  // Immediately before the ref write: a PR opened or reopened since discovery owns the branch now.
  if ((await findOpenDraftedPr(octokit, owner, repo)) !== null) throw new DraftedSolutionsError(PR_APPEARED_MESSAGE)

  if (oldHead === null) {
    await octokit.rest.git.createRef({owner, repo, ref: DRAFTED_CREATE_REF, sha: commitSha})
  } else {
    logger.info(`fast-forwarding stale ${DRAFTED_BRANCH} ${oldHead} -> ${commitSha}`)
    await octokit.rest.git.updateRef({owner, repo, ref: DRAFTED_UPDATE_REF, sha: commitSha, force: false})
  }

  try {
    const created = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      head: DRAFTED_BRANCH,
      base: BASE_BRANCH,
      body,
    })
    await requestReview(octokit, owner, repo, created.data.number)
    return {mode: 'created-pr', prNumber: created.data.number, commitSha}
  } catch (error: unknown) {
    // 422: a PR for this head already exists. Do not repair its body from here; the next run
    // re-harvests, re-authorizes, and reconciles it against the tree it actually has.
    if (errorStatus(error) === 422) throw new DraftedSolutionsError(PR_APPEARED_MESSAGE)
    throw error
  }
}

/** Posts the closure comment unless the bot already left it, then closes the issue. */
async function closeProposal(octokit: OctokitClient, owner: string, repo: string, row: CoverageRow): Promise<void> {
  const marker = closureMarker(row)
  const existing = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: row.issue,
    per_page: 100,
  })
  const alreadyCommented = existing.some(comment => comment.user?.login === BOT_LOGIN && comment.body?.includes(marker))
  if (!alreadyCommented) {
    await octokit.rest.issues.createComment({owner, repo, issue_number: row.issue, body: closingComment(row)})
  }
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: row.issue,
    state: 'closed',
    state_reason: row.outcome === 'covered' ? 'completed' : 'not_planned',
  })
}

async function publishCore(params: PublishParams, tokens: PublicOutputTokens): Promise<PublishResult> {
  const {octokit, owner, repo} = params
  const title = params.prTitle ?? DRAFTED_PR_TITLE

  const digest = parseDigest(await readJson(params.digestPath, 'digest'))
  const files = await stageHandoff(params.handoffDir)
  const rows = prepareRows(await readJson(params.rowsPath, 'rows file'), digest)

  if (digest.proposals.length === 0) {
    if (files.length > 0) throw new DraftedSolutionsError('the handoff has doc changes but the digest has no proposals')
    return {mode: 'noop'}
  }

  checkRowsAgainstHandoff(rows, files)
  const states = await verifyProposals(octokit, owner, repo, digest)
  const openPr = await findOpenDraftedPr(octokit, owner, repo)
  const existingRows = openPr === null ? [] : await existingRowsOf(octokit, owner, repo, openPr)

  // Routing. Recorded in the PR body (closing on merge): drafted docs, and covered rows whenever a
  // drafted PR is open or this run has doc changes. Closed directly: unverified rows always (they
  // must never close as completed on merge), and covered rows only when there is no PR to carry them.
  const hasDocChanges = files.length > 0
  const bodyRows = rows.filter(
    row =>
      row.outcome === 'new-doc' ||
      row.outcome === 'extension' ||
      (row.outcome === 'covered' && (openPr !== null || hasDocChanges)),
  )
  const directRows = rows.filter(row => !bodyRows.includes(row))
  const closeRows = directRows.filter(row => states.get(row.issue) !== 'closed')
  const skipped = directRows.filter(row => states.get(row.issue) === 'closed').map(row => row.issue)
  const writesPr = hasDocChanges || (openPr !== null && bodyRows.length > 0)
  const mergedRows = writesPr ? mergeCoverageRows(existingRows, bodyRows) : []
  const body = writesPr ? renderPrBody(mergedRows) : ''

  // Read-only, before the gate and any write: resolve the commit whose tree backs the PR and verify
  // that every row about to claim a doc (the whole merged body, plus covered rows closed directly)
  // points at one that exists on that tree or in this handoff.
  const directCovered = directRows.filter(row => row.outcome === 'covered')
  const baseSha = writesPr || directCovered.length > 0 ? await resolveBaseSha(octokit, owner, repo, openPr) : null
  if (baseSha !== null) {
    await checkDraftBaseUnmoved(octokit, owner, repo, digest.draftBaseSha, baseSha, files)
    await checkRowDocs(octokit, owner, repo, baseSha, [...mergedRows, ...directCovered], files)
  }

  assertPublicSafe(tokens, [
    ...files.flatMap((file, index) => [
      {surface: 'pr-body' as const, label: `file #${index + 1} path`, content: file.path},
      {surface: 'pr-body' as const, label: `file #${index + 1} content`, content: file.content},
    ]),
    {surface: 'pr-title', label: 'PR title', content: title},
    {surface: 'pr-commit-message', label: 'commit message', content: DRAFTED_COMMIT_MESSAGE},
    {surface: 'pr-body', label: 'PR body', content: body},
    ...closeRows.map(row => ({
      surface: 'proposal-comment' as const,
      label: `comment for #${row.issue}`,
      content: closingComment(row),
    })),
  ])

  if (writesPr && baseSha === null) throw new DraftedSolutionsError('internal: a PR write has no base commit')
  const prWrite = writesPr && baseSha !== null ? await writePr(params, {openPr, baseSha, files, body}) : null

  const closed: number[] = []
  for (const row of closeRows) {
    await closeProposal(octokit, owner, repo, row)
    closed.push(row.issue)
  }

  return prWrite === null ? {mode: 'closed-proposals', closed, skipped} : {...prWrite, closed, skipped}
}

/** Validates, gates, then writes. See the module header for the contract. */
export async function publishDraftedSolutions(params: PublishParams): Promise<PublishResult> {
  let tokens: PublicOutputTokens
  try {
    tokens = await (params.loadTokens ?? loadTokensFromDisk)()
  } catch {
    throw new DraftedSolutionsError('could not load the privacy token sets; refusing to publish')
  }

  try {
    return await publishCore(params, tokens)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    // No `cause`: the original error may carry unscrubbed agent text.
    throw new DraftedSolutionsError(scrub(tokens, message))
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new DraftedSolutionsError(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const [owner, repo, ...rest] = requiredEnv('GITHUB_REPOSITORY').split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '' || rest.length > 0) {
    throw new DraftedSolutionsError('GITHUB_REPOSITORY must be "owner/repo"')
  }
  const {Octokit} = await import('@octokit/rest')
  const octokit = new Octokit({auth: requiredEnv('GITHUB_TOKEN')})

  const result = await publishDraftedSolutions({
    octokit,
    owner,
    repo,
    digestPath: requiredEnv('DRAFTED_SOLUTIONS_DIGEST_PATH'),
    handoffDir: requiredEnv('DRAFTED_SOLUTIONS_HANDOFF_DIR'),
    rowsPath: requiredEnv('DRAFTED_SOLUTIONS_ROWS_PATH'),
  })

  const line = `${JSON.stringify(result)}\n`
  process.stdout.write(line)
  const resultPath = process.env.DRAFTED_SOLUTIONS_RESULT_PATH
  if (resultPath !== undefined && resultPath !== '') await writeFile(resultPath, line, {flag: 'w'})
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    process.stderr.write(
      `::error::drafted-solutions-publish: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }
}
