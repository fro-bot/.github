import {execFile} from 'node:child_process'
import {appendFile} from 'node:fs/promises'
import process from 'node:process'
import {promisify} from 'node:util'

import {buildWikiHandoff} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

/**
 * Runs in the (untrusted-adjacent) agent job, after the agent step, once a wiki diff has
 * already been detected against the pre-agent baseline. Holds no write credential and
 * writes no ingest metadata into the artifact — see `wiki-handoff-core.ts` module doc for
 * the security property this relies on.
 *
 * When `WIKI_HANDOFF_BASELINE_PATH` is set (pointing at a snapshot written by
 * `wiki-handoff-baseline.ts` before the agent ran), the manifest is scoped to only what
 * changed since that baseline — not every path `data` differs from `main` on. See
 * `wiki-handoff-core.ts`'s "Baseline scoping" module doc.
 */
async function main(): Promise<void> {
  const outDir = requiredEnv('WIKI_HANDOFF_DIR')
  const baselinePath = optionalEnv('WIKI_HANDOFF_BASELINE_PATH')

  const result = await buildWikiHandoff({
    cwd: process.cwd(),
    outDir,
    ...(baselinePath === undefined ? {} : {baselinePath}),
    runGitStatus: async () => {
      const {stdout} = await execFileAsync('git', [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        'knowledge/wiki',
        'knowledge/index.md',
        'knowledge/log.md',
      ])
      return stdout
    },
  })

  const hasChanges = result.changed.length > 0 || result.deleted.length > 0
  process.stdout.write(`${JSON.stringify({changed: result.changed.length, deleted: result.deleted.length})}\n`)

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput !== undefined && githubOutput !== '') {
    await appendFile(githubOutput, `changed=${String(hasChanges)}\n`)
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
