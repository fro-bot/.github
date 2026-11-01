/**
 * The `scripts/reset-survey-status.ts` entrypoint on the goke runner. It takes no arguments: the
 * targets come from `TARGETS`. Argv that matches nothing declared is a usage error and writes nothing.
 * Every failure prints `reset-survey-status: <message>` and exits 1.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runResetSurveyStatus} from './reset-survey-status.ts'

export function resetSurveyStatusCli(): CliConfig {
  return {
    name: 'reset-survey-status',
    errorFormat: error => `reset-survey-status: ${error instanceof Error ? error.message : String(error)}\n`,
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runResetSurveyStatus(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(resetSurveyStatusCli())
}
