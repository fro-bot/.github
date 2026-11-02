import {execFile} from 'node:child_process'
import process from 'node:process'
import {promisify} from 'node:util'

import {requiredEnv} from '@fro-bot/core/env'
import {writeGithubOutputs} from '@fro-bot/core/output'
import {computeWikiChangeHash} from './wiki-change-detect-core.ts'

const execFileAsync = promisify(execFile)

/** Same three paths the old inline `wiki-baseline`/`wiki-changes` steps diffed. */
const WIKI_SCOPE_PATHS = ['knowledge/index.md', 'knowledge/log.md', 'knowledge/wiki']

/**
 * One command backs both the `wiki-baseline` and `wiki-changes` survey-repo steps (a third
 * copy lands in Unit 3's retries), replacing duplicated inline `git diff` hashing that
 * couldn't see untracked files. Hashing is scoped to eligible content only (allowlisted
 * paths, not git-ignored) so a positive detection always corresponds to a real
 * transferable delta. See wiki-change-detect-core.ts for the hash and eligibility contract.
 *
 * Usage: `bun scripts/wiki-change-detect.ts baseline|detect`
 *   baseline — writes `hash=<sha256>` to GITHUB_OUTPUT.
 *   detect   — compares against WIKI_CHANGE_BASELINE_HASH and writes `changed=true|false`.
 *
 * Fails closed: an invalid mode, a missing/malformed baseline hash, running outside a git
 * work tree, or any filesystem error throws before anything is written, so `changed=true`
 * is never written on a partial failure.
 */
export async function runWikiChangeDetect(
  mode: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): Promise<void> {
  if (mode !== 'baseline' && mode !== 'detect') {
    throw new Error(`mode must be "baseline" or "detect" (got ${mode ?? '<none>'})`)
  }

  requiredEnv(env, 'GITHUB_OUTPUT')

  let baselineHash: string | undefined
  if (mode === 'detect') {
    baselineHash = requiredEnv(env, 'WIKI_CHANGE_BASELINE_HASH')
    if (!/^[0-9a-f]{64}$/u.test(baselineHash)) {
      throw new Error(
        `WIKI_CHANGE_BASELINE_HASH must be a 64-character lowercase hex sha256 digest, got: ${baselineHash}`,
      )
    }
  }

  // Content detection no longer touches git at all, but the CLI still needs to fail the
  // way it always has outside a real checkout. `--is-inside-work-tree` is bounded (a few
  // bytes: "true\n" or nothing) and carries no wiki content, unlike a kept `git diff`.
  await assertInsideGitWorkTree(cwd)

  const hash = await computeWikiChangeHash({cwd, scopePaths: WIKI_SCOPE_PATHS})

  if (mode === 'baseline') {
    writeGithubOutputs({hash}, {onMissing: 'throw', env})
    return
  }

  const changed = hash !== baselineHash
  writeGithubOutputs({changed: String(changed)}, {onMissing: 'throw', env})
}

async function assertInsideGitWorkTree(cwd: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {cwd})
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`not inside a git work tree: ${message}`)
  }
}

/** The step's stderr line: a workflow command, so the runner annotates the failure. */
export function formatWikiChangeDetectError(error: unknown): string {
  return `::error::wiki-change-detect: ${error instanceof Error ? error.message : String(error)}\n`
}
