import {execFile} from 'node:child_process'
import {appendFile} from 'node:fs/promises'
import process from 'node:process'
import {promisify} from 'node:util'

import {computeWikiChangeHash} from './wiki-change-detect-core.ts'

const execFileAsync = promisify(execFile)

/** Same three paths the old inline `wiki-baseline`/`wiki-changes` steps diffed. */
const WIKI_SCOPE_PATHS = ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki']

const BASELINE_HASH_PATTERN = /^[0-9a-f]{64}$/

/**
 * One script backs both the `wiki-baseline` and `wiki-changes` survey-repo steps (a third
 * copy lands in Unit 3's retries), replacing duplicated inline `git diff` hashing that
 * couldn't see untracked files. Hashing is scoped to eligible content only (allowlisted
 * paths, not git-ignored) so a positive detection always corresponds to a real
 * transferable delta. See wiki-change-detect-core.ts for the hash and eligibility contract.
 *
 * Usage: `node scripts/wiki-change-detect.ts baseline|detect`
 *   baseline — writes `hash=<sha256>` to GITHUB_OUTPUT.
 *   detect   — compares against WIKI_CHANGE_BASELINE_HASH and writes `changed=true|false`.
 *
 * Fails closed: an invalid mode, a missing/malformed baseline hash, running outside a git
 * work tree, or any filesystem error throws before anything is written, so `changed=true`
 * is never written on a partial failure.
 */
async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode !== 'baseline' && mode !== 'detect') {
    throw new Error(`mode must be "baseline" or "detect" (got ${mode ?? '<none>'})`)
  }

  const githubOutput = requiredEnv('GITHUB_OUTPUT')

  let baselineHash: string | undefined
  if (mode === 'detect') {
    baselineHash = requiredEnv('WIKI_CHANGE_BASELINE_HASH')
    if (!BASELINE_HASH_PATTERN.test(baselineHash)) {
      throw new Error(
        `WIKI_CHANGE_BASELINE_HASH must be a 64-character lowercase hex sha256 digest, got: ${baselineHash}`,
      )
    }
  }

  const cwd = process.cwd()
  // Content detection no longer touches git at all, but the CLI still needs to fail the
  // way it always has outside a real checkout. `--is-inside-work-tree` is bounded (a few
  // bytes: "true\n" or nothing) and carries no wiki content, unlike a kept `git diff`.
  await assertInsideGitWorkTree(cwd)

  const hash = await computeWikiChangeHash({cwd, scopePaths: WIKI_SCOPE_PATHS})

  if (mode === 'baseline') {
    await appendFile(githubOutput, `hash=${hash}\n`)
    return
  }

  const changed = hash !== baselineHash
  await appendFile(githubOutput, `changed=${String(changed)}\n`)
}

async function assertInsideGitWorkTree(cwd: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {cwd})
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`not inside a git work tree: ${message}`)
  }
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
