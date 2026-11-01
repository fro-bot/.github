/**
 * The `scripts/check-private-leak.ts` entrypoint on the goke runner.
 *
 * - No argv scans the pull request that triggered the `workflow_run` event (`check-private-leak.yaml`).
 * - `--promotion` scans the `data` to `main` promotion diff (`merge-data.yaml`).
 * - Argv that matches nothing declared, `--help` included, is a usage error: it writes
 *   `scan_result=error` to `$GITHUB_OUTPUT`, exits 1 and scans nothing, so the status step cannot read
 *   a stale or missing result for a run that never scanned.
 *
 * The pull request scan writes `scan_result` before every exit it chooses. An error it does not
 * handle (a failing `gh repo view`) leaves through here: the CLI writes `scan_result=error` unless
 * the scan already wrote a `scan_result`, then rethrows, so the runner still exits 1 with the message.
 * `--promotion` gates on its exit code alone and writes no `scan_result`.
 */

import {existsSync, readFileSync} from 'node:fs'
import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {runPromotionCli, main as scanPullRequest, writeScanResult} from './check-private-leak.ts'

/**
 * Whether the `$GITHUB_OUTPUT` file of this run already holds a `scan_result` line. An unset
 * variable becomes the path `undefined`, which does not exist, so it reads as "no".
 */
function hasScanResult(env: Readonly<Record<string, string | undefined>>): boolean {
  const path = String(env.GITHUB_OUTPUT)
  return existsSync(path) && /^scan_result=/mu.test(String(readFileSync(path)))
}

/**
 * `readOnly` is false: the default scan can post the override transparency comment on the pull
 * request. A function rather than a top-level constant, so every mutant in the config is exercised
 * when a test builds it.
 */
export function checkPrivateLeakCli(): CliConfig {
  return {
    name: 'check-private-leak',
    onUsage: env => {
      writeScanResult('error', env)
    },
    commands: [
      defineCommand({
        readOnly: false,
        options: {promotion: {flag: '--promotion', schema: z.boolean().optional()}},
        action: async context => {
          if (context.options.promotion === true) return runPromotionCli()
          try {
            await scanPullRequest()
          } catch (error: unknown) {
            if (!hasScanResult(context.env)) writeScanResult('error', context.env)
            throw error
          }
          return undefined
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkPrivateLeakCli())
}
