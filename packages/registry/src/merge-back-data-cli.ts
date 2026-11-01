/**
 * The `scripts/merge-back-data.ts` entrypoint on the goke runner. It takes no arguments: the App token
 * comes from `GITHUB_TOKEN`. Argv that matches nothing declared is a usage error and merges nothing.
 * The exit code is what `runCli` returns, so a blocked or failed merge-back fails the job.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCli} from './merge-back-data.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function mergeBackDataCli(): CliConfig {
  return {
    name: 'merge-back-data',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => runCli(context.env),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(mergeBackDataCli())
}
