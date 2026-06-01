import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import process from 'node:process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a single node_id → nameWithOwner resolution attempt.
 * - `{nameWithOwner}`: resolved successfully
 * - `{error:'access-lost'}`: node returned null (deleted / no access)
 * - `{error:'error'; stderr?}`: gh command failed; stderr captured when available
 */
export type NodeIdResolverResult =
  | {readonly nameWithOwner: string}
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

export const GRAPHQL_QUERY = 'query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner } } }'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /rate.?limit/i.test(err.message)
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extractStderr(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined
  const s = err.stderr
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
  return async (nodeId: string): Promise<NodeIdResolverResult> => {
    let attempt = 0

    while (true) {
      try {
        const env: NodeJS.ProcessEnv = token === undefined ? {...process.env} : {...process.env, GH_TOKEN: token}
        const stdout = execFileSync('gh', ['api', 'graphql', '-f', `query=${GRAPHQL_QUERY}`, '-f', `id=${nodeId}`], {
          encoding: 'utf8',
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        const parsed: unknown = JSON.parse(stdout)
        if (!isRecord(parsed)) return {error: 'error'}

        const data = parsed.data
        if (!isRecord(data)) return {error: 'error'}

        const node = data.node
        if (node === null || node === undefined) return {error: 'access-lost'}

        if (isRecord(node) && typeof node.nameWithOwner === 'string') {
          return {nameWithOwner: node.nameWithOwner}
        }

        // node exists but no nameWithOwner (unexpected shape)
        return {error: 'access-lost'}
      } catch (error: unknown) {
        if (isRateLimitError(error) && attempt < retryOptions.maxRetries) {
          attempt++
          await sleep(retryOptions.baseDelayMs * 2 ** (attempt - 1))
          continue
        }
        return {error: 'error', stderr: extractStderr(error)}
      }
    }
  }
}
