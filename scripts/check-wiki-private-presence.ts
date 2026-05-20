import {execFileSync} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import process from 'node:process'

import YAML from 'yaml'

import {assertReposFile} from './schemas.ts'

export interface PrivateWikiLeak {
  filename: string
  reason: 'canonical-slug-match' | 'node-id-match'
  node_id: string
}

/**
 * Pure function: detect wiki files in knowledge/wiki/repos/ that correspond to private repo entries.
 *
 * For each private entry:
 * - If canonicalSlug is provided, check for a case-insensitive stem match against wiki filenames.
 * - Always check if any wiki filename stem matches the entry's node_id (defensive).
 *
 * Returns all leaks found without short-circuiting.
 */
export function detectPrivateWikiLeaks(params: {
  privateEntries: readonly {node_id: string; canonicalSlug?: string}[]
  wikiRepoFilenames: readonly string[]
}): PrivateWikiLeak[] {
  const {privateEntries, wikiRepoFilenames} = params
  const leaks: PrivateWikiLeak[] = []

  for (const entry of privateEntries) {
    for (const filename of wikiRepoFilenames) {
      const stem = filename.replace(/\.md$/i, '')

      // Canonical slug match (case-insensitive)
      if (entry.canonicalSlug !== undefined && stem.toLowerCase() === entry.canonicalSlug.toLowerCase()) {
        leaks.push({filename, reason: 'canonical-slug-match', node_id: entry.node_id})
        continue
      }

      // Node ID match (defensive)
      if (stem === entry.node_id) {
        leaks.push({filename, reason: 'node-id-match', node_id: entry.node_id})
      }
    }
  }

  return leaks
}

// ---------------------------------------------------------------------------
// Type guard for GraphQL response (P2 #6 — no unsafe casts at JSON boundary)
// ---------------------------------------------------------------------------

function isGraphQLRepoNameResponse(value: unknown): value is {data: {node: {nameWithOwner: string}}} {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.data !== 'object' || v.data === null) return false
  const data = v.data as Record<string, unknown>
  if (typeof data.node !== 'object' || data.node === null) return false
  const node = data.node as Record<string, unknown>
  return typeof node.nameWithOwner === 'string' && node.nameWithOwner.length > 0
}

// ---------------------------------------------------------------------------
// resolveCanonicalSlugs — exported for testing; fail-closed (P1 #2)
// ---------------------------------------------------------------------------

export interface ResolvedEntry {
  node_id: string
  canonicalSlug: string
}

export interface SlugResolutionResult {
  resolved: ResolvedEntry[]
  failures: string[] // node_ids that failed — always empty on success; throws if non-empty
}

/**
 * Resolve canonical slugs for all private entries via GraphQL.
 *
 * Fail-closed: if ANY entry's slug cannot be resolved (API error, lost access,
 * deleted repo), throws with the list of failing node_ids. The caller must not
 * proceed — a canonical leak could slip through undetected.
 *
 * Captures all subprocess output; never echoes to stdout/stderr.
 */
export function resolveCanonicalSlugs(entries: readonly {node_id: string}[]): SlugResolutionResult {
  const resolved: ResolvedEntry[] = []
  const failures: string[] = []

  for (const entry of entries) {
    try {
      const stdout = execFileSync(
        'gh',
        ['api', 'graphql', '-f', `query={ node(id: "${entry.node_id}") { ... on Repository { nameWithOwner } } }`],
        {encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe']},
      )
      const parsed: unknown = JSON.parse(stdout)
      if (isGraphQLRepoNameResponse(parsed)) {
        // Convert "owner/repo" → "owner--repo" (wiki slug convention)
        resolved.push({node_id: entry.node_id, canonicalSlug: parsed.data.node.nameWithOwner.replace('/', '--')})
      } else {
        // Unexpected response shape — treat as failure
        failures.push(entry.node_id)
      }
    } catch {
      failures.push(entry.node_id)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `check-wiki-private-presence: cannot verify private wiki presence — ${failures.length} private ${failures.length === 1 ? 'entry' : 'entries'} failed slug resolution: ${failures.join(', ')}. Investigate token scope / repo access before re-running.`,
    )
  }

  return {resolved, failures}
}

// ---------------------------------------------------------------------------
// loadWikiFilenames — exported for testing; ENOENT-only graceful (P1 #3)
// ---------------------------------------------------------------------------

/**
 * List .md filenames in knowledge/wiki/repos/.
 *
 * ENOENT is graceful (fresh checkout, no wiki yet) → returns [].
 * Any other error propagates — do not silently swallow FS errors.
 */
export async function loadWikiFilenames(): Promise<string[]> {
  try {
    const entries = await readdir('knowledge/wiki/repos')
    return entries.filter(f => f.endsWith('.md'))
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Read and validate metadata/repos.yaml
  const reposRaw = await readFile('metadata/repos.yaml', 'utf8')
  const reposParsed: unknown = YAML.parse(reposRaw)
  assertReposFile(reposParsed)

  // 2. Filter to private entries with node_id
  const privateEntries = reposParsed.repos.filter(
    (r): r is typeof r & {node_id: string} => r.private === true && typeof r.node_id === 'string',
  )

  if (privateEntries.length === 0) {
    process.stdout.write('no private wiki leaks detected\n')
    return
  }

  // 3. List wiki repo filenames from the working directory (data branch checkout)
  const wikiRepoFilenames = await loadWikiFilenames()

  // 4. Resolve canonical slugs via GraphQL (fail-closed — throws on any failure)
  const {resolved} = resolveCanonicalSlugs(privateEntries)

  // 5. Detect leaks
  const leaks = detectPrivateWikiLeaks({
    privateEntries: resolved,
    wikiRepoFilenames,
  })

  // 6. Report
  if (leaks.length > 0) {
    const filenames = leaks.map(l => l.filename)
    process.stderr.write(
      `${[
        'check-wiki-private-presence: BLOCKED — private wiki pages detected in knowledge/wiki/repos/:',
        ...filenames.map(f => `  - ${f}`),
        '',
        'These files expose private repository identities. Remove them from the data branch before promoting.',
        `Leak count: ${leaks.length}`,
      ].join('\n')}\n`,
    )
    process.exit(1)
  }

  process.stdout.write('no private wiki leaks detected\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
