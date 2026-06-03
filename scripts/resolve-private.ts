import type {NodeIdResolver, RetryOptions} from './private-repo-resolution.ts'
import type {ReposFile} from './schemas.ts'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'
import {makeGhNodeIdResolver} from './private-repo-resolution.ts'
import {assertReposFile} from './schemas.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type {NodeIdResolver, NodeIdResolverResult, RetryOptions} from './private-repo-resolution.ts'

export type ResolvedEntry =
  | {node_id: string; owner: string; name: string; status: 'resolved'}
  | {node_id: string; status: 'access-lost' | 'error'}

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

/**
 * Resolves all private entries in a ReposFile using the provided resolver.
 * Public entries are skipped — their owner/name are already in the file.
 * Private entries without a node_id are also skipped (pre-migration legacy).
 */
export async function resolvePrivateEntries(file: ReposFile, resolver: NodeIdResolver): Promise<ResolvedEntry[]> {
  const privateEntries = file.repos.filter(entry => entry.private === true && typeof entry.node_id === 'string')

  const results = await Promise.all(
    privateEntries.map(async entry => {
      const nodeId = entry.node_id as string
      const result = await resolver(nodeId)

      if ('nameWithOwner' in result) {
        // FIX #8: validate nameWithOwner has exactly two non-empty segments.
        const parts = result.nameWithOwner.split('/')
        if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
          return {node_id: nodeId, status: 'error'} satisfies ResolvedEntry
        }
        // Safe: length and emptiness checked above.
        const owner = parts[0] as string
        const name = parts[1] as string
        return {node_id: nodeId, owner, name, status: 'resolved'} satisfies ResolvedEntry
      }

      return {node_id: nodeId, status: result.error} satisfies ResolvedEntry
    }),
  )

  return results
}

// ---------------------------------------------------------------------------
// Token guard
// ---------------------------------------------------------------------------

/**
 * Returns the GH_TOKEN from the provided env or throws a structured error.
 * Call this before doing any network work.
 */
export function requireToken(env: Record<string, string | undefined>): string {
  const token = env.GH_TOKEN
  if (typeof token !== 'string' || token === '') {
    throw new Error('resolve-private: GH_TOKEN is not set. Set GH_TOKEN to an operator PAT before running this script.')
  }
  return token
}

// ---------------------------------------------------------------------------
// Real resolver (delegates to shared module)
// ---------------------------------------------------------------------------

/**
 * Builds the real NodeIdResolver that shells out to `gh api graphql`.
 * Accepts optional RetryOptions to control retry/backoff behavior (useful in tests).
 *
 * Delegates to `makeGhNodeIdResolver` from `./private-repo-resolution.ts`.
 */
export function makeRealResolver(token: string, retryOptions?: RetryOptions): NodeIdResolver {
  return makeGhNodeIdResolver(token, retryOptions)
}

// ---------------------------------------------------------------------------
// Table output
// ---------------------------------------------------------------------------

function formatTable(entries: ResolvedEntry[]): string {
  if (entries.length === 0) {
    return '(no private entries found)\n'
  }

  const COL_WIDTH = 40
  const header = `${'node_id'.padEnd(COL_WIDTH)}  owner/name or status`
  const separator = '-'.repeat(COL_WIDTH + 2 + 30)

  const rows = entries.map(entry => {
    const col2 = entry.status === 'resolved' ? `${entry.owner}/${entry.name}` : `[${entry.status}]`
    return `${entry.node_id.padEnd(COL_WIDTH)}  ${col2}`
  })

  return [header, separator, ...rows, ''].join('\n')
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const token = requireToken(process.env as Record<string, string | undefined>)

  const filePath = process.argv[2] ?? 'metadata/repos.yaml'
  const raw = await readFile(filePath, 'utf8')
  const parsed: unknown = parseYaml(raw)

  assertReposFile(parsed)

  const resolver = makeGhNodeIdResolver(token)
  const results = await resolvePrivateEntries(parsed, resolver)

  process.stdout.write(formatTable(results))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
