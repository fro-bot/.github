/**
 * The `scripts/rollout-tracker-snapshot.ts` entrypoint on the goke runner. It takes no argument: one
 * root command reads the Project, the tracked issues, the tracker comments and the external signals,
 * and prints the preflight result as one JSON line on stdout. The two workflows that run it read that
 * line: `gateway-rollout-tracker.yaml` takes five fields from `RESULT="$(...)"`, and `status-truth.yaml`
 * pipes it to `jq -e '.snapshot'`. Any argument, `--help` included, is a usage error and reads nothing.
 *
 * The runner sets `process.exitCode` and never calls `process.exit`, so a large result written to a
 * pipe is delivered in full.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runRolloutTrackerSnapshot} from './rollout-tracker-snapshot.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function rolloutTrackerSnapshotCli(): CliConfig {
  return {
    name: 'rollout-tracker-snapshot',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context =>
          runRolloutTrackerSnapshot(context.env, {stdout: context.stdout, stderr: context.stderr}),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(rolloutTrackerSnapshotCli())
}
