import {execFile} from 'node:child_process'
import process from 'node:process'
import {promisify} from 'node:util'

import {buildWikiHandoff} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

/**
 * Runs in the (untrusted-adjacent) agent job, after the agent step, once a wiki diff has
 * already been detected against the pre-agent baseline. Holds no write credential and
 * writes no ingest metadata into the artifact — see `wiki-handoff-core.ts` module doc for
 * the security property this relies on.
 */
async function main(): Promise<void> {
  const outDir = requiredEnv('WIKI_HANDOFF_DIR')

  const result = await buildWikiHandoff({
    cwd: process.cwd(),
    outDir,
    runGitStatus: async () => {
      const {stdout} = await execFileAsync('git', [
        'status',
        '--porcelain=v1',
        '--',
        'knowledge/wiki',
        'knowledge/index.md',
        'knowledge/log.md',
      ])
      return stdout
    },
  })

  process.stdout.write(`${JSON.stringify({changed: result.changed.length, deleted: result.deleted.length})}\n`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
