import {execFile} from 'node:child_process'
import process from 'node:process'
import {promisify} from 'node:util'

import {captureWikiBaseline} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

/**
 * Runs right after sync-wiki, before the agent step, so the baseline reflects pre-agent
 * `data` content rather than every main-vs-data difference (see wiki-handoff-core.ts).
 */
async function main(): Promise<void> {
  const baselinePath = requiredEnv('WIKI_HANDOFF_BASELINE_PATH')

  const manifest = await captureWikiBaseline({
    cwd: process.cwd(),
    baselinePath,
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

  process.stdout.write(`${JSON.stringify({files: Object.keys(manifest.files).length})}\n`)
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
