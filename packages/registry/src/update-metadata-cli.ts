/**
 * The `scripts/update-metadata.ts` entrypoint on the goke runner. It takes no arguments: the two App
 * tokens and the optional owner come from the environment. Argv that matches nothing declared is a
 * usage error and writes nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runUpdateMetadataCli} from './update-metadata.ts'

export function updateMetadataCli(): CliConfig {
  return {
    name: 'update-metadata',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runUpdateMetadataCli(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(updateMetadataCli())
}
