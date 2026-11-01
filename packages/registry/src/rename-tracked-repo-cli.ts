/**
 * The `scripts/rename-tracked-repo.ts` entrypoint on the goke runner. It takes no arguments: the node
 * ID, the optional old name and both tokens come from the environment. Argv that matches nothing
 * declared is a usage error and renames nothing. The exit code is what `runCli` returns.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCli} from './rename-tracked-repo.ts'

export function renameTrackedRepoCli(): CliConfig {
  return {
    name: 'rename-tracked-repo',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => runCli(context.env, {stdout: context.stdout, stderr: context.stderr}),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(renameTrackedRepoCli())
}
