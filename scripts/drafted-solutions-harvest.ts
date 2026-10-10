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
 *   open, else main's head), `main_sha=<sha>` (main's head) and `review_needed=true|false` (an
 *   open drafted PR that `fro-bot` is neither requested on nor has reviewed at its current head)
 *   to `$GITHUB_OUTPUT`; stdout gets a one-line counts summary.
 * - exits 0 on success, 1 on any fail-closed condition (message on stderr).
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {OctokitClient} from './capture-learnings-harvest.ts'
import {appendFile, writeFile} from 'node:fs/promises'
import process from 'node:process'

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
  readRefSha,
  reauthorizeRows,
  REVIEWER_LOGIN,
  REVIEWER_REVIEW_LOGINS,
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
  /**
   * An open drafted PR still lacks its Fro Bot review: not requested, and none on the current head.
   * Independent of `hasWork`, so a failed review request is repaired even when no proposal is left.
   */
  reviewNeeded: boolean
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

/** True when an open drafted PR has neither a pending Fro Bot review request nor a review on its head. */
async function needsReview(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  pr: {number: number; headSha: string},
): Promise<boolean> {
  const {data: requested} = await octokit.rest.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  })
  if (requested.users.some(user => user.login.toLowerCase() === REVIEWER_LOGIN)) return false

  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  })
  return !reviews.some(
    review =>
      review.commit_id === pr.headSha &&
      review.user !== null &&
      REVIEWER_REVIEW_LOGINS.includes(review.user.login.toLowerCase()),
  )
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
    reviewNeeded: openPr !== null && (await needsReview(octokit, owner, repo, openPr)),
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new DraftedSolutionsError(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const digestPath = requiredEnv('DRAFTED_SOLUTIONS_DIGEST_PATH')
  const [owner, repo, ...rest] = requiredEnv('GITHUB_REPOSITORY').split('/')
  if (owner === undefined || repo === undefined || owner === '' || repo === '' || rest.length > 0) {
    throw new DraftedSolutionsError('GITHUB_REPOSITORY must be "owner/repo"')
  }

  const {Octokit} = await import('@octokit/rest')
  const octokit = new Octokit({auth: requiredEnv('GITHUB_TOKEN')})

  const {digest, hasWork, reviewNeeded} = await harvestDraftedProposals({octokit, owner, repo})

  await writeFile(digestPath, `${JSON.stringify(digest)}\n`, {flag: 'w'})
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    await appendFile(
      outputPath,
      `has_work=${hasWork}\ndraft_base_sha=${digest.draftBaseSha}\nmain_sha=${digest.mainSha}\nreview_needed=${reviewNeeded}\n`,
    )
  }
  process.stdout.write(
    `${JSON.stringify({hasWork, reviewNeeded, proposals: digest.proposals.length, prState: digest.pr.state})}\n`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    process.stderr.write(
      `::error::drafted-solutions-harvest: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }
}
