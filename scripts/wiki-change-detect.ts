import {execFile} from 'node:child_process'
import {appendFile} from 'node:fs/promises'
import process from 'node:process'
import {promisify} from 'node:util'

import {computeWikiChangeHash} from './wiki-change-detect-core.ts'

const execFileAsync = promisify(execFile)

/** Same three paths the old inline `wiki-baseline`/`wiki-changes` steps diffed. */
const WIKI_SCOPE_PATHS = ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki']

/**
 * One script backs both the `wiki-baseline` and `wiki-changes` survey-repo steps (a third
 * copy lands in Unit 3's retries), replacing duplicated inline `git diff` hashing that
 * couldn't see untracked files. See wiki-change-detect-core.ts for the hash contract.
 *
 * Usage: `node scripts/wiki-change-detect.ts baseline|detect`
 *   baseline — writes `hash=<sha256>` to GITHUB_OUTPUT.
 *   detect   — compares against WIKI_CHANGE_BASELINE_HASH and writes `changed=true|false`.
 *
 * Fails closed: an invalid mode, a missing GITHUB_OUTPUT/baseline hash, or any git/IO error
 * throws before anything is written, so `changed=true` is never written on a partial failure.
 */
async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode !== 'baseline' && mode !== 'detect') {
    throw new Error(`mode must be "baseline" or "detect" (got ${mode ?? '<none>'})`)
  }

  const githubOutput = requiredEnv('GITHUB_OUTPUT')
  const baselineHash = mode === 'detect' ? requiredEnv('WIKI_CHANGE_BASELINE_HASH') : undefined

  const hash = await computeWikiChangeHash({
    cwd: process.cwd(),
    runGitDiff: async () => {
      const {stdout} = await execFileAsync('git', ['diff', '--no-ext-diff', '--', ...WIKI_SCOPE_PATHS])
      return stdout
    },
    runGitStatus: async () => {
      const {stdout} = await execFileAsync('git', [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        ...WIKI_SCOPE_PATHS,
      ])
      return stdout
    },
  })

  if (mode === 'baseline') {
    await appendFile(githubOutput, `hash=${hash}\n`)
    return
  }

  const changed = hash !== baselineHash
  await appendFile(githubOutput, `changed=${String(changed)}\n`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`::error::wiki-change-detect: ${message}\n`)
    process.exit(1)
  }
}
