/**
 * The IDs of private repositories that must never reach a public surface: the `node_id` and
 * `database_id` of every `private: true` entry in `metadata/repos.yaml`. The public-output gate
 * (`status-truth-public-output`) denylists them as a secondary guard next to the private repo names.
 */

import type {RepoEntry} from '@fro.bot/wiki-write-core/schemas'
import {readFile} from 'node:fs/promises'
import {isRecord} from '@fro-bot/core/guards'
import {assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {parse} from 'yaml'

/**
 * Extract redacted canonical IDs (node_id and database_id as string) from private repo entries.
 *
 * Only entries with `private === true` contribute IDs. Public entries and entries with
 * `private` absent are excluded. This is the secondary denylist guard: node_id and
 * database_id values must never appear in any public output surface.
 *
 * Pure function: no I/O, no side effects.
 */
export function extractRedactedCanonicalIds(repos: readonly RepoEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of repos) {
    if (entry.private !== true) continue
    if (entry.node_id !== undefined && entry.node_id !== '') {
      ids.add(entry.node_id)
    }
    if (entry.database_id !== undefined) {
      ids.add(String(entry.database_id))
    }
  }
  return ids
}

/**
 * Load redacted canonical IDs from `metadata/repos.yaml`.
 *
 * Reads and validates the repos file, then delegates to `extractRedactedCanonicalIds`.
 *
 * Fail-closed contract:
 * - If the file cannot be read, parsed, or validated, this function THROWS.
 * - The caller MUST NOT emit any public output when this throws.
 * - Never use an empty set as a proxy for a failed load.
 *
 * @param readFileFn - Injectable readFile for testing (defaults to node:fs/promises readFile).
 */
export async function loadRedactedCanonicalIdsFromDisk(
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<Set<string>> {
  let reposYaml: string
  try {
    reposYaml = await readFileFn('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    throw new Error(
      'status-truth-proposals: could not read metadata/repos.yaml — redacted canonical ID gate cannot operate',
      {cause: error},
    )
  }

  let parsed: unknown
  try {
    parsed = parse(reposYaml)
  } catch (error: unknown) {
    throw new Error(
      'status-truth-proposals: could not parse metadata/repos.yaml — redacted canonical ID gate cannot operate',
      {cause: error},
    )
  }

  if (!isRecord(parsed)) {
    throw new TypeError(
      'status-truth-proposals: metadata/repos.yaml has unexpected shape — redacted canonical ID gate cannot operate',
    )
  }

  // Validate schema — throws SchemaValidationError on invalid shape
  assertReposFile(parsed, 'repos')

  return extractRedactedCanonicalIds(parsed.repos)
}
