/**
 * The `scripts/handle-invitation.ts` entrypoint on the goke runner. It takes no arguments: the
 * credentials come from `GITHUB_TOKEN` and `METADATA_WRITE_TOKEN`. Argv that matches nothing declared
 * is a usage error and polls nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runHandleInvitation} from './handle-invitation.ts'

export function handleInvitationCli(): CliConfig {
  return {
    name: 'handle-invitation',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runHandleInvitation(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(handleInvitationCli())
}
