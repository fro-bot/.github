/**
 * The `scripts/drafted-solutions-publish.ts` entrypoint on the goke runner. It takes no argument: one
 * writing root command validates the agent's handoff and rows, privacy-gates every public surface and only
 * then writes the drafted branch and PR or closes proposals. The exit code is `runCli`'s: 0 after the one-line
 * JSON result on stdout (and in `DRAFTED_SOLUTIONS_RESULT_PATH`, where `draft-solutions.yaml` reads `.mode`
 * and `.prNumber`), 1 after `::error::drafted-solutions-publish: <message>` on stderr. Argv that matches
 * nothing declared, `--help` included, is a usage error and publishes nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCli} from './drafted-solutions-publish.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function draftedSolutionsPublishCli(): CliConfig {
  return {
    name: 'drafted-solutions-publish',
    commands: [
      defineCommand({
        readOnly: false,
        // runCli reports its own failures on stderr and returns the exit code, so nothing reaches the runner's error path.
        action: async context => runCli(context.env, {stdout: context.stdout, stderr: context.stderr}),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(draftedSolutionsPublishCli())
}
