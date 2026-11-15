import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import process from 'node:process'

import {isObject} from '@fro-bot/core/guards'
import {retry} from '@fro-bot/core/retry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a single node_id → nameWithOwner resolution attempt.
 * - `{nameWithOwner; visibility?}`: resolved successfully. `visibility` is GitHub's live
 *   `Repository.visibility` (`PUBLIC`, `PRIVATE` or `INTERNAL`), passed through unjudged and
 *   typed `unknown` on purpose: a missing field or an unexpected value must stay
 *   distinguishable from `PUBLIC` only by the caller's strict `=== 'PUBLIC'` test, which
 *   fails closed. Parsing it into a narrower type here would be a second decision point.
 * - `{error:'access-lost'}`: node returned null (deleted / no access)
 * - `{error:'error'; stderr?}`: gh command failed; stderr captured when available
 */
export type NodeIdResolverResult =
  | {readonly nameWithOwner: string; readonly visibility?: unknown}
  | {readonly error: 'access-lost'}
  | {readonly error: 'error'; readonly stderr?: string}

export type NodeIdResolver = (nodeId: string) => Promise<NodeIdResolverResult>

export interface RetryOptions {
  readonly maxRetries: number
  readonly baseDelayMs: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// `visibility` rather than `isPrivate`: it is an enum (PUBLIC / PRIVATE / INTERNAL), so a consumer
// can demand the one exact string `PUBLIC` and treat INTERNAL, a value GitHub adds later, a missing
// field and a wrong type alike as not public. A boolean's only positive signal is `false`, which a
// null or an absent field can imitate under a loose test.
export const GRAPHQL_QUERY = 'query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner visibility } } }'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /rate.?limit/i.test(err.message)
}

/** `value[key]` for any object, an array included; a missing key is `undefined`. */
function fieldOf(value: object, key: string): unknown {
  return Reflect.get(value, key)
}

function extractStderr(err: unknown): string | undefined {
  if (!isObject(err)) return undefined
  const s = fieldOf(err, 'stderr')
  if (typeof s === 'string') return s
  if (s instanceof Buffer) return s.toString('utf8')
  return undefined
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds a NodeIdResolver that shells out to `gh api graphql`.
 * Consistent error classification: resolved | access-lost | error.
 * Retries on rate-limit errors with exponential backoff.
 * Captures gh stderr on failure so callers can surface it.
 */
export function makeGhNodeIdResolver(
  token?: string,
  retryOptions: RetryOptions = {maxRetries: 3, baseDelayMs: 2000},
): NodeIdResolver {
  // `maxRetries` counts retries, so the first try adds one; a negative count is no retries.
  const attempts = Math.max(0, Math.ceil(retryOptions.maxRetries)) + 1

  const resolveOnce = async (nodeId: string): Promise<NodeIdResolverResult> => {
    // Scope the gh subprocess token. Always strip the named PAT (it must never
    // co-exist with GH_TOKEN). When an explicit token is supplied, also strip the
    // ambient GitHub token aliases and set GH_TOKEN from that token, so exactly one
    // token form reaches the subprocess. When no token is supplied, preserve the
    // ambient GH_TOKEN/GITHUB_TOKEN so callers relying on workflow auth still work.
    const env: NodeJS.ProcessEnv = {...process.env}
    delete env.FRO_BOT_POLL_PAT
    if (token !== undefined) {
      delete env.GH_TOKEN
      delete env.GITHUB_TOKEN
      env.GH_TOKEN = token
    }
    const stdout = execFileSync('gh', ['api', 'graphql', '-f', `query=${GRAPHQL_QUERY}`, '-f', `id=${nodeId}`], {
      encoding: 'utf8',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const parsed: unknown = JSON.parse(stdout)
    if (!isObject(parsed)) return {error: 'error'}

    const data = fieldOf(parsed, 'data')
    if (!isObject(data)) return {error: 'error'}

    const node = fieldOf(data, 'node')
    if (node === null || node === undefined) return {error: 'access-lost'}

    // node exists but is not an object, or has no nameWithOwner (unexpected shape)
    if (!isObject(node)) return {error: 'access-lost'}
    const nameWithOwner = fieldOf(node, 'nameWithOwner')
    if (typeof nameWithOwner !== 'string') return {error: 'access-lost'}

    return {nameWithOwner, visibility: fieldOf(node, 'visibility')}
  }

  return async (nodeId: string): Promise<NodeIdResolverResult> => {
    try {
      return await retry(async () => resolveOnce(nodeId), {
        attempts,
        delayMs: attempt => retryOptions.baseDelayMs * 2 ** (attempt - 1),
        shouldRetry: isRateLimitError,
      })
    } catch (error: unknown) {
      return {error: 'error', stderr: extractStderr(error)}
    }
  }
}
