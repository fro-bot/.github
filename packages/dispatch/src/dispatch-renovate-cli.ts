/**
 * The `scripts/dispatch-renovate.ts` entrypoint on the goke runner. It takes `plan` or no argument:
 * `plan` lists the repositories the installation can reach and writes `repositories=<csv>` to
 * `$GITHUB_OUTPUT`; no argument dispatches Renovate to `DISPATCH_REPOSITORIES`. Any other argv, `--help`
 * included, is a usage error and dispatches nothing. A failure prints its message and exits 1.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runRenovateDispatchCli, runRenovatePlanCli} from './dispatch-renovate.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function dispatchRenovateCli(): CliConfig {
  return {
    name: 'dispatch-renovate',
    commands: [
      defineCommand({
        name: 'plan',
        readOnly: true,
        action: async context => {
          await runRenovatePlanCli(context.env, {stdout: context.stdout})
        },
      }),
      defineCommand({
        readOnly: false,
        action: async context => {
          await runRenovateDispatchCli(context.env, {stdout: context.stdout})
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(dispatchRenovateCli())
}
