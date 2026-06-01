import type {ReposFile} from './schemas.ts'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'
import {assertReposFile} from './schemas.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NodeIdResolver = (
  nodeId: string,
) => Promise<{nameWithOwner: string} | {error: 'access-lost'} | {error: 'error'}>

export type ResolvedEntry =
  | {node_id: string; owner: string; name: string; status: 'resolved'}
  | {node_id: string; status: 'access-lost' | 'error'}

export interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
}

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
        const [owner, name] = result.nameWithOwner.split('/')
        return {node_id: nodeId, owner: owner ?? '', name: name ?? '', status: 'resolved'} satisfies ResolvedEntry
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
// Real resolver (shells out to `gh`)
// ---------------------------------------------------------------------------

const GRAPHQL_QUERY = 'query($id: ID!) { node(id: $id) { ... on Repository { nameWithOwner } } }'

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return /rate.?limit/i.test(err.message)
  }
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Builds the real NodeIdResolver that shells out to `gh api graphql`.
 * Accepts optional RetryOptions to control retry/backoff behavior (useful in tests).
 */
export function makeRealResolver(
  token: string,
  retryOptions: RetryOptions = {maxRetries: 3, baseDelayMs: 2000},
): NodeIdResolver {
  return async (nodeId: string) => {
    let attempt = 0

    while (true) {
      try {
        const stdout = execFileSync('gh', ['api', 'graphql', '-f', `query=${GRAPHQL_QUERY}`, '-f', `id=${nodeId}`], {
          encoding: 'utf8',
          env: {...process.env, GH_TOKEN: token},
        })

        const parsed = JSON.parse(stdout) as unknown

        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'data' in parsed &&
          typeof (parsed as Record<string, unknown>).data === 'object'
        ) {
          const data = (parsed as {data: Record<string, unknown>}).data
          const node = data.node

          if (node === null || node === undefined) {
            return {error: 'access-lost'}
          }

          if (typeof node === 'object' && 'nameWithOwner' in node) {
            const nameWithOwner = (node as {nameWithOwner: unknown}).nameWithOwner
            if (typeof nameWithOwner === 'string') {
              return {nameWithOwner}
            }
          }

          // node exists but no nameWithOwner (unexpected shape)
          return {error: 'access-lost'}
        }

        return {error: 'error'}
      } catch (error: unknown) {
        if (isRateLimitError(error) && attempt < retryOptions.maxRetries) {
          attempt++
          const delayMs = retryOptions.baseDelayMs * 2 ** (attempt - 1)
          await sleep(delayMs)
          continue
        }
        return {error: 'error'}
      }
    }
  }
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
  const parsed = parseYaml(raw) as unknown

  assertReposFile(parsed)

  const resolver = makeRealResolver(token)
  const results = await resolvePrivateEntries(parsed, resolver)

  process.stdout.write(formatTable(results))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
