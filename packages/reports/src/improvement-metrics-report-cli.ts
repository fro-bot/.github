/**
 * The `scripts/improvement-metrics-report.ts` entrypoint on the goke runner. It takes no argument: one root
 * command reads the digest file at `IMPROVEMENT_METRICS_DIGEST_PATH`, upserts the perpetual report issue and
 * writes `{outcome, tokenLoadFailure, digestReadFailure}` to stdout and to `IMPROVEMENT_METRICS_RESULT_PATH`,
 * the file the workflow summary reads back. The command is not read-only: it creates and updates an issue
 * and creates the report label.
 *
 * A failed token load or digest read is reported in the result and exits 0. An empty or missing `GITHUB_TOKEN`
 * with a readable digest is not a dry run: client construction throws, the run exits 1 and no result file is
 * written. The workflow skips the report job on a dry run, so it never reaches that path. Argv that matches
 * nothing declared, `--help` included, is a usage error and writes nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runImprovementMetricsReport} from './improvement-metrics-report.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function improvementMetricsReportCli(): CliConfig {
  return {
    name: 'improvement-metrics-report',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runImprovementMetricsReport(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(improvementMetricsReportCli())
}
