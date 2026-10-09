/**
 * Runs post-agent in the (untrusted) agent job: turns the agent's `docs/solutions` edits in the
 * checkout into the manifest.json + files/ handoff that drafted-solutions-publish.ts validates
 * under the drafted-solutions path policy. The checkout is clean before the agent runs, so
 * plain `git status` is the delta — no baseline is needed.
 *
 * Fails the job on any out-of-scope path or any deletion rather than silently dropping it: the
 * publish job would reject the same artifact, and failing here surfaces the problem earlier.
 *
 * CLI contract: env `DRAFTED_SOLUTIONS_HANDOFF_DIR` (output dir, workspace-relative or absolute);
 * appends `changed=true|false` to `$GITHUB_OUTPUT`; exits 1 on any violation.
 *
 * Strip-only safe: no parameter properties, enums, or namespaces.
 */

import {execFile} from 'node:child_process'
import {appendFile} from 'node:fs/promises'
import process from 'node:process'
import {promisify} from 'node:util'

import {
  buildWikiHandoff,
  isAllowedDraftedSolutionPath,
  type BuildWikiHandoffParams,
  type BuildWikiHandoffResult,
} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

export async function buildDraftedHandoff(
  params: Omit<BuildWikiHandoffParams, 'baselinePath' | 'isAllowedPath'>,
): Promise<BuildWikiHandoffResult> {
  const result = await buildWikiHandoff({...params, isAllowedPath: isAllowedDraftedSolutionPath})
  if (result.deleted.length > 0) {
    throw new Error(`drafted-solutions-handoff-build: deletions are not allowed (${result.deleted.length} reported)`)
  }
  return result
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
    runGitStatus: async () => {
      const {stdout} = await execFileAsync('git', [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        'docs/solutions',
      ])
      return stdout
    },
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
