/**
 * Shared fail-closed privacy gate for the learning-capture pipeline.
 *
 * Provides the pure privacy-scan function and the fail-closed disk loader for the
 * private identifier token set. Both the open step (authored-body scan) and the
 * harvest step (upstream enrichment scan) import from here — single source of truth.
 *
 * Fail-closed contract:
 * - If `loadPrivateTokensFromDisk` throws, the caller MUST NOT post or emit any
 *   unscanned content (no private set loaded ⇒ no proposals / no enriched content).
 * - The privacy gate blocks on a hit; it never redacts. Counts-only telemetry.
 * - Private names are never logged; only counts appear in output.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {readFile} from 'node:fs/promises'
import process from 'node:process'
import {parse} from 'yaml'

import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Privacy gate — pure, fail-closed
// ---------------------------------------------------------------------------

/**
 * Returns true if the body contains any private identifier token.
 *
 * The body is lowercased before scanning. The caller MUST block (skip) the
 * content on true. Never redacts — block only. Counts-only telemetry.
 *
 * Pure function: no I/O, fully testable.
 */
export function learningBodyHasPrivateLeak(body: string, privateTokens: Set<string>): boolean {
  const lower = body.toLowerCase()
  for (const token of privateTokens) {
    if (lower.includes(token)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Disk loader for private token set
// ---------------------------------------------------------------------------

/**
 * Load the private identifier token set from `metadata/repos.yaml`.
 *
 * Reads the overlay-checked-out metadata file, filters `private: true` non-redacted
 * entries, and builds the token set via `buildPrivateTokenSet`.
 *
 * Fail-closed contract:
 * - If the file cannot be read or parsed, this function THROWS.
 * - The caller MUST NOT post any proposals or emit enriched content when this throws
 *   (no private set ⇒ no unscanned content passes through).
 * - This is intentional: a missing overlay means the privacy gate cannot operate,
 *   and passing unscanned content would violate the privacy-gate contract.
 *
 * Counts-only: private names are never logged; only counts appear in stderr.
 *
 * @param readFileFn - Injectable readFile for testing (defaults to node:fs/promises readFile).
 */
export async function loadPrivateTokensFromDisk(
  readFileFn: (path: string, encoding: BufferEncoding) => Promise<string> = readFile,
): Promise<Set<string>> {
  let reposYaml: string

  try {
    reposYaml = await readFileFn('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    throw new Error(
      'capture-learnings-privacy: could not read metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
      {cause: error},
    )
  }

  let parsed: unknown
  try {
    parsed = parse(reposYaml)
  } catch (error: unknown) {
    throw new Error(
      'capture-learnings-privacy: could not parse metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
      {cause: error},
    )
  }

  if (!isRecord(parsed)) {
    throw new TypeError(
      'capture-learnings-privacy: metadata/repos.yaml has unexpected shape — privacy gate cannot operate; no learnings will be posted',
    )
  }

  const repos = parsed.repos
  if (!Array.isArray(repos)) {
    throw new TypeError(
      'capture-learnings-privacy: metadata/repos.yaml missing repos array — privacy gate cannot operate; no learnings will be posted',
    )
  }

  const privateNames: string[] = []
  for (const entry of repos) {
    if (!isRecord(entry)) continue
    if (entry.private !== true) continue
    const owner = entry.owner
    const name = entry.name
    if (typeof owner !== 'string' || typeof name !== 'string' || owner === '[REDACTED]' || name === '[REDACTED]') {
      continue
    }
    privateNames.push(`${owner}/${name}`)
  }

  const tokenSet = buildPrivateTokenSet(privateNames)
  process.stderr.write(
    `capture-learnings-privacy: loaded private token set (private-repo count=${privateNames.length}, token-count=${tokenSet.size})\n`,
  )
  return tokenSet
}
