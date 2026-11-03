/**
 * Harvest for the drafted solution docs workflow: finds the open learning proposals the open
 * drafted PR does not yet cover and writes a digest for the (no-write) drafting agent.
 *
 * Read-only: issues and PR listing only. Proposal comments are never read — they are
 * non-authoritative, and a correction belongs in the issue body (editing it changes the body
 * hash, which re-drafts the proposal).
 *
 * CLI contract:
 * - env `GITHUB_TOKEN` (read scopes), `GITHUB_REPOSITORY` (`owner/repo`),
 *   `DRAFTED_SOLUTIONS_DIGEST_PATH` (digest JSON destination, workspace-relative), and
 *   optionally `GITHUB_OUTPUT`.
 * - writes the digest file (always, even when there is no work) and appends `has_work=true|false`,
 *   `draft_base_sha=<sha>` (the commit the agent edits: the live drafted-branch head when a PR is
 *   open, else main's head) and `main_sha=<sha>` (main's head) to `$GITHUB_OUTPUT`; stdout gets a
 *   one-line counts summary.
 * - exits 0 on success, 1 on any fail-closed condition (message on stderr).
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {OctokitClient} from './capture-learnings-harvest.ts'
import {writeFile} from 'node:fs/promises'
import {requiredEnv} from '@fro-bot/core/env'
import {createOctokit} from '@fro-bot/core/github'
import {formatJsonLine} from '@fro-bot/core/json'
import {writeGithubOutputs} from '@fro-bot/core/output'

import {LEARNING_PROPOSAL_LABEL, parseMergeShaMarker} from './capture-learnings-harvest.ts'
import {hashProposalBody, parseCoverageBlock} from './drafted-solutions-pr-body.ts'
import {
  BASE_BRANCH,
  DIGEST_VERSION,
  DRAFTED_BRANCH,
  DraftedSolutionsError,
  findOpenDraftedPr,
  isLearningProposalIssue,
  MAX_PROPOSALS_PER_RUN,
  missingDraftedEnv,
  readRefSha,
  reauthorizeRows,
  type DraftedDigest,
  type DraftedPrState,
  type ProposalDigestEntry,
} from './drafted-solutions-shared.ts'

export interface HarvestParams {
  octokit: OctokitClient
  owner: string
  repo: string
}

export interface HarvestResult {
  digest: DraftedDigest
  hasWork: boolean
}

async function listOpenProposals(octokit: OctokitClient, owner: string, repo: string): Promise<ProposalDigestEntry[]> {
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    labels: LEARNING_PROPOSAL_LABEL,
    per_page: 100,
  })

  return issues
    .filter(issue => isLearningProposalIssue(issue))
    .map(issue => {
      const body = issue.body ?? ''
      return {
        issue: issue.number,
        title: issue.title,
        body,
        bodyHash: hashProposalBody(body),
        mergeSha: parseMergeShaMarker(body),
        createdAt: issue.created_at,
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.issue - b.issue)
}

/** Builds the digest: the five oldest proposals the open drafted PR (if any) does not cover. */
export async function harvestDraftedProposals(params: HarvestParams): Promise<HarvestResult> {
  const {octokit, owner, repo} = params

  const proposals = await listOpenProposals(octokit, owner, repo)
  const openPr = await findOpenDraftedPr(octokit, owner, repo)

  // Pin the drafting base to exact commits: the agent edits `draftBaseSha` and verifies "current
  // main" against `mainSha`, and publish later detects lost updates against `draftBaseSha`.
  const mainSha = await readRefSha(octokit, owner, repo, `heads/${BASE_BRANCH}`)
  if (mainSha === null) throw new DraftedSolutionsError(`${BASE_BRANCH} does not exist`)
  let draftBaseSha = mainSha
  if (openPr !== null) {
    const branchSha = await readRefSha(octokit, owner, repo, `heads/${DRAFTED_BRANCH}`)
    if (branchSha === null) {
      throw new DraftedSolutionsError(`drafted PR #${openPr.number} is open but ${DRAFTED_BRANCH} does not exist`)
    }
    draftBaseSha = branchSha
  }

  let pr: DraftedPrState = {state: 'none'}
  const coveredHashes = new Map<number, string>()
  if (openPr !== null) {
    const parsed = parseCoverageBlock(openPr.body, 'existing-pr')
    if (!parsed.ok) {
      throw new DraftedSolutionsError(`drafted PR #${openPr.number}: ${parsed.reason}`)
    }
    await reauthorizeRows(octokit, owner, repo, parsed.rows)
    for (const row of parsed.rows) coveredHashes.set(row.issue, row.bodyHash)
    pr = {state: 'open', number: openPr.number, headSha: openPr.headSha, rows: parsed.rows}
  }

  const uncovered = proposals.filter(proposal => coveredHashes.get(proposal.issue) !== proposal.bodyHash)
  const selected = uncovered.slice(0, MAX_PROPOSALS_PER_RUN)

  return {
    digest: {version: DIGEST_VERSION, draftBaseSha, mainSha, proposals: selected, pr},
    hasWork: selected.length > 0,
  }
}

/** The environment a run reads: `process.env` in production, the runner's env in the CLI. */
type Env = Readonly<Record<string, string | undefined>>

/** Where a run writes its one stdout line. */
export interface HarvestIo {
  readonly stdout: (text: string) => void
}

export async function runDraftedSolutionsHarvest(env: Env, io: HarvestIo): Promise<void> {
  const required = (name: string): string => requiredEnv(env, name, {missing: missingDraftedEnv})
  const digestPath = required('DRAFTED_SOLUTIONS_DIGEST_PATH')
  const [owner, repo, ...rest] = required('GITHUB_REPOSITORY').split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '' || rest.length > 0) {
    throw new DraftedSolutionsError('GITHUB_REPOSITORY must be "owner/repo"')
  }

  const octokit = await createOctokit(required('GITHUB_TOKEN'))

  const {digest, hasWork} = await harvestDraftedProposals({octokit, owner, repo})

  await writeFile(digestPath, formatJsonLine(digest), {flag: 'w'})
  writeGithubOutputs(
    {has_work: String(hasWork), draft_base_sha: digest.draftBaseSha, main_sha: digest.mainSha},
    {onMissing: 'skip', env},
  )
  io.stdout(formatJsonLine({hasWork, proposals: digest.proposals.length, prState: digest.pr.state}))
}
