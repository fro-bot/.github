/**
 * The `scripts/record-survey-result.ts` entrypoint on the goke runner. It takes no arguments: the
 * survey outcome comes from the `REPO_*` and `SURVEY_*` variables. Argv that matches nothing declared
 * is a usage error and writes nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runRecordSurveyResult} from './record-survey-result.ts'

export function recordSurveyResultCli(): CliConfig {
  return {
    name: 'record-survey-result',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => runRecordSurveyResult(context.env, context),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(recordSurveyResultCli())
}
