/**
 * The `scripts/capture-learnings-harvest.ts` entrypoint on the goke runner. It takes no argument: one
 * read-only root command lists the merged pull requests of the last 30 days, builds the candidate digest,
 * writes it to `CAPTURE_LEARNINGS_DIGEST_PATH` and prints it on stdout, where `capture-learnings.yaml` reads
 * the `.telemetry.*` counters. Any failure falls back to an empty digest and exits 0, because the harvest
 * must never fail the workflow. Argv that matches nothing declared, `--help` included, is a usage error
 * and harvests nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCaptureLearningsHarvest} from './capture-learnings-harvest.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function captureLearningsHarvestCli(): CliConfig {
  return {
    name: 'capture-learnings-harvest',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runCaptureLearningsHarvest(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(captureLearningsHarvestCli())
}
