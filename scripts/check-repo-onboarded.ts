import {appendFile, readFile} from 'node:fs/promises'
import process from 'node:process'

import YAML from 'yaml'

import {repoEntryExists} from './repos-metadata.ts'

/**
 * Gate script: reads `metadata/repos.yaml` from the current working directory and checks
 * whether the repo identified by `REPO_OWNER`/`REPO_NAME` has an entry.
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
 */
async function main(): Promise<void> {
  const owner = process.env.REPO_OWNER
  const repo = process.env.REPO_NAME

  if (owner === undefined || owner === '' || repo === undefined || repo === '') {
    await emitResult(false, 'REPO_OWNER and REPO_NAME must be set')
    return
  }

  let raw: string
  try {
    raw = await readFile('metadata/repos.yaml', 'utf8')
  } catch (error: unknown) {
    const isEnoent = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    const reason = isEnoent
      ? 'metadata/repos.yaml not found; repo is not onboarded'
      : `failed to read metadata/repos.yaml: ${error instanceof Error ? error.message : String(error)}`
    await emitResult(false, reason)
    return
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(raw)
  } catch (error: unknown) {
    await emitResult(
      false,
      `metadata/repos.yaml is malformed YAML: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  let onboarded: boolean
  try {
    onboarded = repoEntryExists(parsed, owner, repo)
  } catch (error: unknown) {
    await emitResult(
      false,
      `metadata/repos.yaml failed schema validation: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  await emitResult(onboarded, onboarded ? undefined : `${owner}/${repo} has no entry in metadata/repos.yaml`)
}

async function emitResult(onboarded: boolean, reason?: string): Promise<void> {
  if (!onboarded && reason !== undefined) {
    process.stderr.write(`check-repo-onboarded: ${reason}\n`)
  }

  process.stdout.write(`${JSON.stringify({onboarded, ...(reason === undefined ? {} : {reason})})}\n`)

  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath !== undefined && outputPath !== '') {
    await appendFile(outputPath, `onboarded=${String(onboarded)}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
