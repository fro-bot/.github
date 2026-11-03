/**
 * The `scripts/improvement-metrics-detect.ts` entrypoint on the goke runner. It takes no argument: one
 * read-only root command loads the solution docs, the proposal issues and the prior report's tick state,
 * computes the digest and writes `{digest, edges}` to `IMPROVEMENT_METRICS_DIGEST_PATH`, the file
 * `improvement-metrics.yaml` uploads and reads back. Stdout is a different, flat result shape (counts and
 * the three failure flags); it must never be redirected onto the digest path.
 *
 * A failed token load, a failed scan or unavailable git history falls back to an empty digest and exits 0,
 * because detection must never fail the workflow. Argv that matches nothing declared, `--help` included, is
 * a usage error and detects nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runImprovementMetricsDetect} from './improvement-metrics-detect.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function improvementMetricsDetectCli(): CliConfig {
  return {
    name: 'improvement-metrics-detect',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runImprovementMetricsDetect(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(improvementMetricsDetectCli())
}
