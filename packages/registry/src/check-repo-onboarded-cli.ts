/**
 * The `scripts/check-repo-onboarded.ts` entrypoint on the goke runner. It takes no arguments: the
 * target comes from `REPO_OWNER` and `REPO_NAME`. Argv that matches nothing declared is a usage
 * error and runs no check.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCheckRepoOnboarded} from './check-repo-onboarded.ts'

export function checkRepoOnboardedCli(): CliConfig {
  return {
    name: 'check-repo-onboarded',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runCheckRepoOnboarded(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkRepoOnboardedCli())
}
