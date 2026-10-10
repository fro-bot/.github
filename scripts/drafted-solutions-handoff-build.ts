/**
 * Runs post-agent in the (untrusted) agent job: turns the agent's `docs/solutions` edits in the
 * checkout into the manifest.json + files/ handoff that drafted-solutions-publish.ts validates
 * under the drafted-solutions path policy.
 *
 * The delta comes from git objects (staged blobs), not working-tree paths — see
 * `buildHandoffFromGitIndex` in wiki-handoff-core.ts for why that closes the symlink and
 * swap-after-check races. The checkout is clean before the agent runs, so the staged diff
 * against HEAD is exactly the agent's work.
 *
 * Fails the job on any out-of-scope path, backslash path, non-regular file (symlink, gitlink,
 * executable), deletion/rename, or oversize bundle, and on any git failure.
 *
 * CLI contract: env `DRAFTED_SOLUTIONS_HANDOFF_DIR` (output dir, workspace-relative or absolute);
 * appends `changed=true|false` to `$GITHUB_OUTPUT`; exits 1 on any violation.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {appendFile} from 'node:fs/promises'
import process from 'node:process'

import {
  buildHandoffFromGitIndex,
  DRAFTED_SOLUTIONS_HANDOFF_POLICY,
  type BuildWikiHandoffResult,
  type GitRunner,
} from './wiki-handoff-core.ts'

export interface BuildDraftedHandoffParams {
  cwd: string
  outDir: string
  /** Injectable for tests; defaults to `git` run via execFile in `cwd`. */
  runGit?: GitRunner
}

export async function buildDraftedHandoff(params: BuildDraftedHandoffParams): Promise<BuildWikiHandoffResult> {
  return buildHandoffFromGitIndex({
    cwd: params.cwd,
    outDir: params.outDir,
    pathspec: 'docs/solutions',
    policy: DRAFTED_SOLUTIONS_HANDOFF_POLICY,
    ...(params.runGit === undefined ? {} : {runGit: params.runGit}),
  })
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const result = await buildDraftedHandoff({
    cwd: process.cwd(),
    outDir: requiredEnv('DRAFTED_SOLUTIONS_HANDOFF_DIR'),
  })

  process.stdout.write(`${JSON.stringify({changed: result.changed.length})}\n`)
  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput !== undefined && githubOutput !== '') {
    await appendFile(githubOutput, `changed=${String(result.changed.length > 0)}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
