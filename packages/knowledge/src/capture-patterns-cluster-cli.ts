/**
 * The `scripts/capture-patterns-cluster.ts` entrypoint on the goke runner. It takes no argument: one
 * read-only root command collects the accepted solution docs and the learning-proposal issues, plans the
 * cluster candidates, writes the digest to `CAPTURE_PATTERNS_DIGEST_PATH` and prints the counts on stdout,
 * where `capture-patterns.yaml` reads the thirteen summary keys. A failed token load or scan falls back to
 * an empty digest and exits 0, because detection must never fail the workflow. Argv that matches nothing
 * declared, `--help` included, is a usage error and detects nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCapturePatternsCluster} from './capture-patterns-cluster.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function capturePatternsClusterCli(): CliConfig {
  return {
    name: 'capture-patterns-cluster',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runCapturePatternsCluster(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(capturePatternsClusterCli())
}
