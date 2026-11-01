/**
 * The `scripts/check-private-leak.ts` entrypoint on the goke runner.
 *
 * - No argv scans the pull request that triggered the `workflow_run` event (`check-private-leak.yaml`).
 * - `--promotion` scans the `data` to `main` promotion diff (`merge-data.yaml`).
 * - Argv that matches nothing declared, `--help` included, is a usage error: it writes
 *   `scan_result=error` to `$GITHUB_OUTPUT`, exits 1 and scans nothing, so the status step cannot read
 *   a stale or missing result for a run that never scanned.
 */

import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {runPromotionCli, main as scanPullRequest, writeScanResult} from './check-private-leak.ts'

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
          await scanPullRequest()
          return undefined
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkPrivateLeakCli())
}
