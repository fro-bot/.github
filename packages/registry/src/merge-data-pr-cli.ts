/**
 * The `scripts/merge-data-pr.ts` entrypoint on the goke runner. It takes no arguments: the App token
 * comes from `GITHUB_TOKEN`. Argv that matches nothing declared is a usage error and opens no PR. The
 * exit code is 1 when the promotion PR is conflicted or its mergeability could not be read.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runMergeDataPr} from './merge-data-pr.ts'

export function mergeDataPrCli(): CliConfig {
  return {
    name: 'merge-data-pr',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => runMergeDataPr(context),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(mergeDataPrCli())
}
