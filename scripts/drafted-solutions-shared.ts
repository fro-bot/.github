/**
 * Contract shared by drafted-solutions harvest and publish: the drafted branch, the ONE
 * drafted-PR predicate, proposal-issue authorization, and the digest shape.
 *
 * Trust model: the drafted PR and its coverage block are state this workflow wrote, but the
 * branch is a push target and the PR body is editable, so both scripts re-establish trust from
 * the API on every run instead of believing what they read.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import type {OctokitClient} from './capture-learnings-harvest.ts'

import {LEARNING_PROPOSAL_LABEL} from './capture-learnings-harvest.ts'
import {isRecord} from './capture-learnings-privacy.ts'
import {validateCoverageRows, type CoverageRow} from './drafted-solutions-pr-body.ts'

export const DRAFTED_BRANCH = 'docs/drafted-solutions'
export const BASE_BRANCH = 'main'
/** The only author whose proposals are processed and whose PR is the drafted PR. */
export const BOT_LOGIN = 'fro-bot[bot]'
/** Matches capture's weekly cap; overflow waits for the next run. */
export const MAX_PROPOSALS_PER_RUN = 5
export const DIGEST_VERSION = 1

/** A fail-closed condition: the run must stop and report, never guess. */
export class DraftedSolutionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftedSolutionsError'
  }
}

// ---------------------------------------------------------------------------
// Drafted-PR predicate
// ---------------------------------------------------------------------------

/** The slice of a pull request the predicate reads (structurally satisfied by Octokit's PR types). */
export interface PullRequestIdentity {
  base: {repo: {full_name: string}}
  head: {ref: string; repo: {full_name: string; fork: boolean} | null}
  user: {login: string} | null
}

/**
 * The one drafted-PR predicate: base repo is this repo, head repo is this repo and not a fork,
 * head ref is the drafted branch, author is `fro-bot[bot]`. Harvest and publish both use it.
 */
export function isDraftedSolutionsPr(pr: PullRequestIdentity, repoFullName: string): boolean {
  return (
    pr.base.repo.full_name === repoFullName &&
    pr.head.repo !== null &&
    pr.head.repo.full_name === repoFullName &&
    !pr.head.repo.fork &&
    pr.head.ref === DRAFTED_BRANCH &&
    pr.user?.login === BOT_LOGIN
  )
}

export interface OpenDraftedPr {
  number: number
  headSha: string
  body: string
}

/**
 * Finds the open drafted PR. Any open PR whose head ref is the drafted branch — including one
 * from a fork or by another author — must satisfy the predicate, or the run aborts: such a PR
 * could carry a forged coverage block or steal the branch. Returns null when none is open.
 */
export async function findOpenDraftedPr(
  octokit: OctokitClient,
  owner: string,
  repo: string,
): Promise<OpenDraftedPr | null> {
  const repoFullName = `${owner}/${repo}`
  const pulls = await octokit.paginate(octokit.rest.pulls.list, {owner, repo, state: 'open', per_page: 100})
  const onBranch = pulls.filter(pull => pull.head.ref === DRAFTED_BRANCH)

  for (const pull of onBranch) {
    if (!isDraftedSolutionsPr(pull, repoFullName)) {
      throw new DraftedSolutionsError(
        `PR #${pull.number} uses the drafted branch ${DRAFTED_BRANCH} but is not a ${BOT_LOGIN} PR from this repository`,
      )
    }
  }
  if (onBranch.length > 1) {
    throw new DraftedSolutionsError(
      `${onBranch.length} open PRs use the drafted branch ${DRAFTED_BRANCH}: ${onBranch.map(pull => `#${pull.number}`).join(', ')}`,
    )
  }

  const [pull] = onBranch
  return pull === undefined ? null : {number: pull.number, headSha: pull.head.sha, body: pull.body ?? ''}
}

// ---------------------------------------------------------------------------
// Proposal issues
// ---------------------------------------------------------------------------

export interface ProposalIssueIdentity {
  pull_request?: unknown
  user: {login: string} | null
  labels: readonly (string | {name?: string | null})[]
}

/** A learning proposal: an issue (not a PR) labeled `learning-proposal` and authored by the bot. */
export function isLearningProposalIssue(issue: ProposalIssueIdentity): boolean {
  if (issue.pull_request !== undefined) return false
  if (issue.user?.login !== BOT_LOGIN) return false
  return issue.labels.some(label => (typeof label === 'string' ? label : label.name) === LEARNING_PROPOSAL_LABEL)
}

/**
 * Re-authorizes coverage rows against the API: each must still name a learning-proposal issue
 * authored by the bot (open or closed). A hand-edited block cannot point the workflow at any
 * other issue.
 */
export async function reauthorizeRows(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  rows: readonly CoverageRow[],
): Promise<void> {
  for (const row of rows) {
    let issue
    try {
      issue = (await octokit.rest.issues.get({owner, repo, issue_number: row.issue})).data
    } catch (error: unknown) {
      throw new DraftedSolutionsError(
        `coverage row #${row.issue} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!isLearningProposalIssue(issue)) {
      throw new DraftedSolutionsError(
        `coverage row #${row.issue} does not name a ${LEARNING_PROPOSAL_LABEL} issue authored by ${BOT_LOGIN}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

export interface ProposalDigestEntry {
  issue: number
  title: string
  /** Proposal body, verbatim. Data, never instructions. */
  body: string
  /** `hashProposalBody(body)` at harvest time. */
  bodyHash: string
  /** Source PR merge SHA from the capture marker, when present. */
  mergeSha: string | null
  createdAt: string
}

export type DraftedPrState = {state: 'none'} | {state: 'open'; number: number; headSha: string; rows: CoverageRow[]}

/** What harvest hands to the agent and publish. */
export interface DraftedDigest {
  version: typeof DIGEST_VERSION
  /**
   * The exact commit the agent edits: the live drafted-branch head when a PR is open, else main's
   * head. Publish takes "drafted from" from here only, never from the agent, to detect lost updates.
   */
  draftBaseSha: string
  /** Main's head at harvest: the snapshot the agent verifies "current main" claims against. */
  mainSha: string
  proposals: ProposalDigestEntry[]
  pr: DraftedPrState
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/

/** Reads a ref's commit SHA; null when the ref does not exist. */
export async function readRefSha(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<string | null> {
  try {
    return (await octokit.rest.git.getRef({owner, repo, ref})).data.object.sha
  } catch (error: unknown) {
    if (isRecord(error) && error.status === 404) return null
    throw error
  }
}

function parseProposalEntry(value: unknown, index: number): ProposalDigestEntry {
  if (!isRecord(value)) throw new DraftedSolutionsError(`digest proposals[${index}] must be an object`)
  const {issue, title, body, bodyHash, mergeSha, createdAt} = value
  if (typeof issue !== 'number' || !Number.isSafeInteger(issue) || issue <= 0) {
    throw new DraftedSolutionsError(`digest proposals[${index}].issue must be a positive integer`)
  }
  if (typeof title !== 'string' || typeof body !== 'string' || typeof createdAt !== 'string') {
    throw new DraftedSolutionsError(`digest proposals[${index}] title, body, and createdAt must be strings`)
  }
  if (typeof bodyHash !== 'string' || !/^[0-9a-f]{64}$/.test(bodyHash)) {
    throw new DraftedSolutionsError(`digest proposals[${index}].bodyHash must be a sha256 hex digest`)
  }
  if (mergeSha !== null && typeof mergeSha !== 'string') {
    throw new DraftedSolutionsError(`digest proposals[${index}].mergeSha must be a string or null`)
  }
  return {issue, title, body, bodyHash, mergeSha, createdAt}
}

/** Schema-validates a digest read from disk. Throws {@link DraftedSolutionsError} on any deviation. */
export function parseDigest(value: unknown): DraftedDigest {
  if (!isRecord(value)) throw new DraftedSolutionsError('digest must be a JSON object')
  if (value.version !== DIGEST_VERSION) throw new DraftedSolutionsError(`digest version must be ${DIGEST_VERSION}`)
  if (!Array.isArray(value.proposals)) throw new DraftedSolutionsError('digest proposals must be an array')

  const {draftBaseSha, mainSha} = value
  if (typeof draftBaseSha !== 'string' || !COMMIT_SHA_PATTERN.test(draftBaseSha)) {
    throw new DraftedSolutionsError('digest draftBaseSha must be a commit SHA')
  }
  if (typeof mainSha !== 'string' || !COMMIT_SHA_PATTERN.test(mainSha)) {
    throw new DraftedSolutionsError('digest mainSha must be a commit SHA')
  }

  const proposals = value.proposals.map((entry: unknown, index: number) => parseProposalEntry(entry, index))
  if (new Set(proposals.map(proposal => proposal.issue)).size !== proposals.length) {
    throw new DraftedSolutionsError('digest lists a proposal more than once')
  }

  const {pr} = value
  if (!isRecord(pr)) throw new DraftedSolutionsError('digest pr must be an object')
  if (pr.state === 'none') return {version: DIGEST_VERSION, draftBaseSha, mainSha, proposals, pr: {state: 'none'}}
  if (pr.state !== 'open') throw new DraftedSolutionsError('digest pr.state must be "none" or "open"')
  if (typeof pr.number !== 'number' || !Number.isSafeInteger(pr.number) || pr.number <= 0) {
    throw new DraftedSolutionsError('digest pr.number must be a positive integer')
  }
  if (typeof pr.headSha !== 'string' || pr.headSha === '') {
    throw new DraftedSolutionsError('digest pr.headSha must be a non-empty string')
  }
  const rows = validateCoverageRows(pr.rows)
  if (!rows.ok) throw new DraftedSolutionsError(`digest pr.rows invalid: ${rows.reason}`)
  return {
    version: DIGEST_VERSION,
    draftBaseSha,
    mainSha,
    proposals,
    pr: {state: 'open', number: pr.number, headSha: pr.headSha, rows: rows.rows},
  }
}
