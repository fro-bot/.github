/**
 * Trusted publish step for the drafted solution docs workflow: the only holder of a write
 * credential. It validates the agent's handoff, privacy-gates every public surface, and only then
 * writes — either a commit on the drafted branch plus a PR, or comments and closures when the run
 * produced no doc changes.
 *
 * Order (every step fails closed; nothing is written until step 6):
 *  1. load the privacy token sets (private repos + redacted canonical IDs);
 *  2. validate the handoff against the drafted-solutions path policy into a staging dir;
 *  3. validate the agent's evidence rows against the digest (exactly one row per proposal);
 *  4. re-verify digest proposals and any open drafted PR against the API (the digest and PR body
 *     are not trusted);
 *  5. gate every file (path and content), the PR title, the commit message, the fully rendered PR
 *     body, and every comment;
 *  6. write.
 *
 * Error messages never echo agent-supplied text that failed the privacy gate.
 *
 * CLI contract:
 * - env `GITHUB_TOKEN` (App token with contents, pull-requests, issues write), `GITHUB_REPOSITORY`,
 *   `DRAFTED_SOLUTIONS_DIGEST_PATH`, `DRAFTED_SOLUTIONS_HANDOFF_DIR` (manifest.json + files/),
 *   `DRAFTED_SOLUTIONS_ROWS_PATH` (the agent's evidence rows: a JSON array of coverage rows), and
 *   optionally `DRAFTED_SOLUTIONS_WORKSPACE` (checked-out drafted tree, default cwd) and
 *   `DRAFTED_SOLUTIONS_RESULT_PATH` (result JSON destination).
 * - stdout: one-line JSON result. exit 0 on success, 1 on any fail-closed condition.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {OctokitClient} from './capture-learnings-harvest.ts'
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
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
  DRAFTED_BRANCH,
  DraftedSolutionsError,
  findOpenDraftedPr,
  isLearningProposalIssue,
  parseDigest,
  reauthorizeRows,
  type DraftedDigest,
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
  /** Checked-out drafted tree (drafted branch head if a PR is open, else main), for covered-doc checks. */
  workspaceDir: string
  loadTokens?: () => Promise<PublicOutputTokens>
  logger?: PublishLogger
  /** Overridable so tests can prove the title is gated. */
  prTitle?: string
}

export type PublishResult =
  | {mode: 'noop'}
  | {mode: 'created-pr'; prNumber: number; commitSha: string}
  | {mode: 'updated-pr'; prNumber: number; commitSha: string}
  | {mode: 'closed-proposals'; closed: number[]; skipped: number[]}

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

async function docExists(workspaceDir: string, relativePath: string): Promise<boolean> {
  try {
    await access(path.join(workspaceDir, relativePath))
    return true
  } catch {
    return false
  }
}

/** Rows must agree with the handoff: drafted docs are in it; covered docs exist in it or on the tree. */
async function checkRowsAgainstTree(
  rows: readonly CoverageRow[],
  files: readonly StagedFile[],
  workspaceDir: string,
): Promise<void> {
  const changed = new Set(files.map(file => file.path))
  for (const row of rows) {
    if (row.outcome === 'new-doc' || row.outcome === 'extension') {
      if (row.targetDoc === null || !changed.has(row.targetDoc)) {
        throw new DraftedSolutionsError(`${row.outcome} row #${row.issue}: its target doc is not part of the handoff`)
      }
    } else if (row.outcome === 'covered') {
      const present =
        row.targetDoc !== null && (changed.has(row.targetDoc) || (await docExists(workspaceDir, row.targetDoc)))
      if (!present) {
        throw new DraftedSolutionsError(`covered row #${row.issue}: its doc does not exist on the drafted tree`)
      }
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

function closingComment(row: CoverageRow): string {
  if (row.outcome === 'covered') {
    return [
      `Reviewed against the merged change, its reviews, and current main: this lesson is already documented in \`${row.targetDoc}\`.`,
      row.reason,
      'Closing as completed.',
    ].join('\n\n')
  }
  return [
    "Could not verify this proposal's claims against the merged change and current main, so no doc was drafted.",
    row.reason,
    'Closing as not planned. Reopen with a corrected body to have it considered again.',
  ].join('\n\n')
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
    parents: [parentSha],
  })
  return commit.data.sha
}

async function readRefSha(octokit: OctokitClient, owner: string, repo: string, ref: string): Promise<string | null> {
  try {
    return (await octokit.rest.git.getRef({owner, repo, ref})).data.object.sha
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
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

async function publishCore(params: PublishParams, tokens: PublicOutputTokens): Promise<PublishResult> {
  const {octokit, owner, repo} = params
  const logger = params.logger ?? DEFAULT_LOGGER
  const title = params.prTitle ?? DRAFTED_PR_TITLE

  const digest = parseDigest(await readJson(params.digestPath, 'digest'))
  const files = await stageHandoff(params.handoffDir)
  const rows = prepareRows(await readJson(params.rowsPath, 'rows file'), digest)

  if (digest.proposals.length === 0) {
    if (files.length > 0) throw new DraftedSolutionsError('the handoff has doc changes but the digest has no proposals')
    return {mode: 'noop'}
  }

  await checkRowsAgainstTree(rows, files, params.workspaceDir)
  const states = await verifyProposals(octokit, owner, repo, digest)
  const openPr = await findOpenDraftedPr(octokit, owner, repo)
  const existingRows = openPr === null ? [] : await existingRowsOf(octokit, owner, repo, openPr)

  const hasDocChanges = files.length > 0
  const mergedRows = mergeCoverageRows(existingRows, rows)
  const body = hasDocChanges ? renderPrBody(mergedRows) : ''
  const commentRows = hasDocChanges ? [] : rows.filter(row => states.get(row.issue) !== 'closed')

  assertPublicSafe(tokens, [
    ...files.flatMap((file, index) => [
      {surface: 'pr-body' as const, label: `file #${index + 1} path`, content: file.path},
      {surface: 'pr-body' as const, label: `file #${index + 1} content`, content: file.content},
    ]),
    {surface: 'pr-title', label: 'PR title', content: title},
    {surface: 'pr-commit-message', label: 'commit message', content: DRAFTED_COMMIT_MESSAGE},
    {surface: 'pr-body', label: 'PR body', content: body},
    ...commentRows.map(row => ({
      surface: 'proposal-comment' as const,
      label: `comment for #${row.issue}`,
      content: closingComment(row),
    })),
  ])

  if (!hasDocChanges) {
    const closed: number[] = []
    for (const row of commentRows) {
      await octokit.rest.issues.createComment({owner, repo, issue_number: row.issue, body: closingComment(row)})
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: row.issue,
        state: 'closed',
        state_reason: row.outcome === 'covered' ? 'completed' : 'not_planned',
      })
      closed.push(row.issue)
    }
    const skipped = rows.filter(row => states.get(row.issue) === 'closed').map(row => row.issue)
    return {mode: 'closed-proposals', closed, skipped}
  }

  if (openPr !== null) {
    // The PR's recorded head may be stale (operator or update-branch commits); build on the ref now.
    const headSha = await readRefSha(octokit, owner, repo, DRAFTED_UPDATE_REF)
    if (headSha === null) {
      throw new DraftedSolutionsError(`drafted PR #${openPr.number} is open but ${DRAFTED_BRANCH} does not exist`)
    }
    const commitSha = await commitFiles(octokit, owner, repo, headSha, files)
    await octokit.rest.git.updateRef({owner, repo, ref: DRAFTED_UPDATE_REF, sha: commitSha, force: false})
    await octokit.rest.pulls.update({owner, repo, pull_number: openPr.number, body})
    return {mode: 'updated-pr', prNumber: openPr.number, commitSha}
  }

  const baseSha = await readRefSha(octokit, owner, repo, `heads/${BASE_BRANCH}`)
  if (baseSha === null) throw new DraftedSolutionsError(`${BASE_BRANCH} does not exist`)
  const commitSha = await commitFiles(octokit, owner, repo, baseSha, files)

  const oldSha = await readRefSha(octokit, owner, repo, DRAFTED_UPDATE_REF)
  if (oldSha === null) {
    await octokit.rest.git.createRef({owner, repo, ref: DRAFTED_CREATE_REF, sha: commitSha})
  } else {
    logger.info(`resetting ${DRAFTED_BRANCH} ${oldSha} -> ${commitSha}`)
    await octokit.rest.git.updateRef({owner, repo, ref: DRAFTED_UPDATE_REF, sha: commitSha, force: true})
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
    if (errorStatus(error) !== 422) throw error
  }

  // A PR appeared between discovery and create: treat the create as an update of that PR.
  const raced = await findOpenDraftedPr(octokit, owner, repo)
  if (raced === null) throw new DraftedSolutionsError('PR creation was rejected (422) and no drafted PR exists')
  const racedRows = mergeCoverageRows(await existingRowsOf(octokit, owner, repo, raced), rows)
  const racedBody = renderPrBody(racedRows)
  assertPublicSafe(tokens, [{surface: 'pr-body', label: 'PR body', content: racedBody}])
  await octokit.rest.pulls.update({owner, repo, pull_number: raced.number, body: racedBody})
  return {mode: 'updated-pr', prNumber: raced.number, commitSha}
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
    workspaceDir: process.env.DRAFTED_SOLUTIONS_WORKSPACE ?? process.cwd(),
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
