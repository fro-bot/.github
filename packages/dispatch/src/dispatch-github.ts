/** GitHub adapters: run and goal-issue lookups, the per-owner token map and the per-owner client resolver. */

import {createOctokit} from '@fro-bot/core/github'
import {
  CROSS_REPO_GOAL_LABEL,
  TARGET_WORKFLOW_ID,
  type CrossRepoDispatchOctokitClient,
  type DispatchTarget,
  type GoalState,
} from './dispatch-model.ts'
import {readLatestMarker, type OpenGoalIssue, type RepoRepository} from './dispatch-run.ts'

/** Bounded page size for recent-run lookups — correlation ids are recent by construction. */
const RUN_LOOKUP_PAGE_SIZE = 30

/**
 * Find the `fro-bot.yaml` run in `target` whose run-name/display_title
 * contains `correlationId`. Matches the echo format in
 * `.github/workflows/fro-bot.yaml`'s `run-name:` (` (correlationId)` suffix
 * on manual dispatch runs). Bounded to the most recent runs — a correlation
 * id is looked up shortly after the dispatch that minted it.
 */
export async function findWorkflowRunByCorrelationId(
  octokit: CrossRepoDispatchOctokitClient,
  target: DispatchTarget,
  correlationId: string,
): Promise<{id: number; status: string | null; conclusion: string | null} | null> {
  const response = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner: target.owner,
    repo: target.name,
    workflow_id: TARGET_WORKFLOW_ID,
    per_page: RUN_LOOKUP_PAGE_SIZE,
  })
  const match = response.data.workflow_runs.find(run => (run.display_title ?? run.name ?? '').includes(correlationId))
  if (match === undefined) return null
  return {id: match.id, status: match.status, conclusion: match.conclusion}
}

/** Factory: `findRunByCorrelationId` collaborator — run existence, any status. */
export function findRunByCorrelationId(
  octokit: CrossRepoDispatchOctokitClient,
): (target: DispatchTarget, correlationId: string) => Promise<boolean> {
  return async (target, correlationId) => {
    const run = await findWorkflowRunByCorrelationId(octokit, target, correlationId)
    return run !== null
  }
}

/** Factory: `findRunConclusion` collaborator — conclusion only once the run has completed. */
export function findRunConclusion(
  octokit: CrossRepoDispatchOctokitClient,
): (target: DispatchTarget, correlationId: string) => Promise<'success' | 'failure' | undefined> {
  return async (target, correlationId) => {
    const run = await findWorkflowRunByCorrelationId(octokit, target, correlationId)
    if (run === null || run.status !== 'completed') return undefined
    return run.conclusion === 'success' ? 'success' : 'failure'
  }
}

/**
 * Enumerate this repo's OPEN `cross-repo-goal`-labeled issues and resolve
 * each one's latest bot-authored state marker. Issues without a readable
 * marker are skipped (nothing to track yet).
 */
export async function loadOpenGoalIssues(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
): Promise<OpenGoalIssue[]> {
  const issuesResponse = await octokit.rest.issues.listForRepo({
    owner: repo.owner,
    repo: repo.repo,
    labels: CROSS_REPO_GOAL_LABEL,
    state: 'open',
    per_page: 100,
  })

  const results: OpenGoalIssue[] = []
  for (const issue of issuesResponse.data) {
    const marker = await readLatestMarker(octokit, repo, issue.number)
    if (marker === null) continue
    results.push({issueNumber: issue.number, marker})
  }
  return results
}

/**
 * Enumerate OTHER open `cross-repo-goal` issues' marker states (excluding
 * `currentIssueNumber`) for same-target in-flight serialization in
 * `planDispatch`.
 */
export async function loadOtherOpenGoalMarkers(
  octokit: CrossRepoDispatchOctokitClient,
  repo: RepoRepository,
  currentIssueNumber: number,
): Promise<GoalState[]> {
  const issuesResponse = await octokit.rest.issues.listForRepo({
    owner: repo.owner,
    repo: repo.repo,
    labels: CROSS_REPO_GOAL_LABEL,
    state: 'open',
    per_page: 100,
  })

  const results: GoalState[] = []
  for (const issue of issuesResponse.data) {
    if (issue.number === currentIssueNumber) continue
    const marker = await readLatestMarker(octokit, repo, issue.number)
    if (marker === null) continue
    results.push({...marker.state, markerHash: marker.hash})
  }
  return results
}

export const REQUEST_TIMEOUT_MS = 15_000

async function createOctokitForToken(token: string): Promise<CrossRepoDispatchOctokitClient> {
  return createOctokit(token, {timeoutMs: REQUEST_TIMEOUT_MS})
}

/**
 * Parse the owner→token JSON map. The App private key never enters this
 * script — only already-minted per-owner tokens, one per eligible owner
 * (fro-bot and marcusrbrown are separate App installations; one token can't
 * span both). Malformed/absent input yields an empty map (fail-closed: every
 * target owner is then treated as missing a token).
 */
export function parseTargetTokens(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [owner, token] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof token === 'string' && token !== '') result[owner] = token
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Per-owner target-repo client resolver. fro-bot and marcusrbrown are
 * separate App installations — a token minted for one owner 403s against
 * the other's repos, so every target-repo operation (dispatch,
 * run-lookup, PR search) must go through the client for THAT target's
 * owner, never the control-plane client.
 */
export interface TargetClientResolver {
  targetClientFor: (owner: string) => CrossRepoDispatchOctokitClient
  hasTargetToken: (owner: string) => boolean
}

/** Build a resolver from an owner→client map. Missing owner throws (fail-closed misconfiguration). */
export function createTargetClientResolver(
  clientsByOwner: ReadonlyMap<string, CrossRepoDispatchOctokitClient>,
): TargetClientResolver {
  return {
    targetClientFor: owner => {
      const client = clientsByOwner.get(owner)
      if (client === undefined) {
        throw new Error(`cross-repo-dispatch: no dispatch token minted for owner "${owner}"`)
      }
      return client
    },
    hasTargetToken: owner => clientsByOwner.has(owner),
  }
}

/** Build the owner→client map from the parsed token map, reusing one client per distinct token. */
export async function buildTargetClients(
  tokens: Record<string, string>,
): Promise<Map<string, CrossRepoDispatchOctokitClient>> {
  const clientsByToken = new Map<string, CrossRepoDispatchOctokitClient>()
  const clientsByOwner = new Map<string, CrossRepoDispatchOctokitClient>()
  for (const [owner, token] of Object.entries(tokens)) {
    let client = clientsByToken.get(token)
    if (client === undefined) {
      client = await createOctokitForToken(token)
      clientsByToken.set(token, client)
    }
    clientsByOwner.set(owner, client)
  }
  return clientsByOwner
}
