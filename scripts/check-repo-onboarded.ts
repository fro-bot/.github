import {appendFile, readFile} from 'node:fs/promises'
import process from 'node:process'

import YAML from 'yaml'

import {publicRepoEntryExists} from './repos-metadata.ts'

/**
 * Gate script: reads `metadata/repos.yaml` from the current working directory and checks
 * whether the repo identified by `REPO_OWNER`/`REPO_NAME` has an entry with
 * `private === false` (explicit public). Aligns with the promotion privacy gate in
 * `buildPublicSlugMap` (check-wiki-private-presence.ts), which only admits wiki pages
 * for repos with explicit `private === false`.
 *
 * Writes `onboarded=true` or `onboarded=false` to `GITHUB_OUTPUT` (append) and to stdout
 * as a JSON line for observability. Always exits 0 — fail-closed means writing
 * `onboarded=false` on any error path, never `onboarded=true`.
 *
 * Inputs (env vars):
 *   REPO_OWNER     — target repository owner (e.g. "fro-bot")
 *   REPO_NAME      — target repository name (e.g. "tokentoilet")
 *   GITHUB_OUTPUT  — path to the GitHub Actions output file (set automatically by Actions)
 *
 * Fail-closed paths (write onboarded=false + structured stderr, exit 0):
 *   - REPO_OWNER or REPO_NAME unset or empty
 *   - metadata/repos.yaml missing (ENOENT)
 *   - metadata/repos.yaml contains malformed YAML
 *   - parsed YAML is not a valid ReposFile (assertReposFile throws)
 *   - entry present but private is absent or true (not explicitly public)
 */

export interface RunCheckResult {
  onboarded: boolean
  target: string
  reason?: string
}

/**
 * Parse-and-decide logic for the onboarded gate. Testable seam: does NOT call
 * process.exit and does NOT read process.env directly.
 *
 * Returns fail-closed (onboarded:false) on missing env, ENOENT, malformed YAML,
 * schema failure, or absent/non-public entry. Returns onboarded:true ONLY for a
 * genuine private===false match.
 */
export async function runCheck(
  env: Record<string, string | undefined>,
  deps?: {readFileImpl?: typeof readFile},
): Promise<RunCheckResult> {
  const readFileImpl = deps?.readFileImpl ?? readFile
  const owner = env.REPO_OWNER
  const repo = env.REPO_NAME

  if (owner === undefined || owner === '' || repo === undefined || repo === '') {
    return {
      onboarded: false,
      target: `${owner ?? ''}/${repo ?? ''}`,
      reason: 'REPO_OWNER and REPO_NAME must be set',
    }
  }

  const target = `${owner}/${repo}`

  let raw: string
  try {
    raw = await readFileImpl('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    const isEnoent = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    const reason = isEnoent
      ? 'metadata/repos.yaml not found; repo is not onboarded'
      : `failed to read metadata/repos.yaml: ${error instanceof Error ? error.message : String(error)}`
    return {onboarded: false, target, reason}
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(raw)
  } catch (error: unknown) {
    return {
      onboarded: false,
      target,
      reason: `metadata/repos.yaml is malformed YAML: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let onboarded: boolean
  try {
    onboarded = publicRepoEntryExists(parsed, owner, repo)
  } catch (error: unknown) {
    return {
      onboarded: false,
      target,
      reason: `metadata/repos.yaml failed schema validation: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return {
    onboarded,
    target,
    ...(onboarded ? {} : {reason: `${target} has no public entry in metadata/repos.yaml`}),
  }
}

async function main(): Promise<void> {
  const result = await runCheck(process.env as Record<string, string | undefined>)

  if (!result.onboarded && result.reason !== undefined) {
    process.stderr.write(`check-repo-onboarded: ${result.reason}\n`)
  }

  process.stdout.write(
    `${JSON.stringify({onboarded: result.onboarded, target: result.target, ...(result.reason === undefined ? {} : {reason: result.reason})})}\n`,
  )

  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    await appendFile(outputPath, `onboarded=${String(result.onboarded)}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
