/**
 * The one branch-safety rule shared by every writer that commits to `fro-bot/.github`.
 *
 * - Never `main`: writers target `data`, and `main` only receives it through a promotion PR.
 * - Never a protected branch, except the canonical `fro-bot/.github@data`: its ruleset reports it as
 *   protected while bypassing the App by actor, so the App writer is the one intended to write there.
 *
 * Each writer reports a refusal in its own error type, so this function takes a `refuse` callback
 * instead of throwing: the rule lives here once, and the error shape stays with the caller.
 */

const CANONICAL_OWNER = 'fro-bot'
const CANONICAL_REPO = '.github'
const CANONICAL_BRANCH = 'data'
const MAIN_BRANCH = 'main'

/** Why a branch was refused. */
export type BranchRefusal = 'main' | 'protected'

/** The one call the rule needs. The real Octokit satisfies it structurally. */
export interface BranchProtectionClient {
  rest: {
    repos: {
      getBranch: (params: {owner: string; repo: string; branch: string}) => Promise<{
        data: {protected?: boolean; protection?: {enabled?: boolean} | null}
      }>
    }
  }
}

/**
 * Resolve if `owner/repo@branch` may be written, otherwise call `refuse` (which must throw).
 *
 * `main` is refused without a network call. Otherwise GitHub is asked, and both the top-level
 * `protected` flag and the nested `protection.enabled` are checked: the REST API surfaces branch
 * protection through both, and older clients that read only the latter miss repos configured
 * through rulesets.
 */
export async function assertBranchWritable(
  client: BranchProtectionClient,
  owner: string,
  repo: string,
  branch: string,
  refuse: (reason: BranchRefusal) => never,
): Promise<void> {
  if (branch === MAIN_BRANCH) return refuse('main')

  const response = await client.rest.repos.getBranch({owner, repo, branch})
  const isProtected = response.data.protected === true || response.data.protection?.enabled === true
  const isCanonical = owner === CANONICAL_OWNER && repo === CANONICAL_REPO && branch === CANONICAL_BRANCH
  if (isProtected && !isCanonical) return refuse('protected')
}
