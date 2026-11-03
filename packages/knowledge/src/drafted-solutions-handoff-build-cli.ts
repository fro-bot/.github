/**
 * The `scripts/drafted-solutions-handoff-build.ts` entrypoint on the goke runner. It takes no argument: one
 * root command turns the agent's `docs/solutions` edits in the checkout into the `manifest.json` and
 * `files/` handoff, appends `changed=true|false` to `$GITHUB_OUTPUT` and prints `{"changed":n}` on stdout.
 * It writes only the handoff directory the caller names, so it is read-only. Any violation prints
 * `::error::<message>` on stderr and exits 1. Argv that matches nothing declared, `--help` included, is a
 * usage error and builds nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runDraftedSolutionsHandoffBuild} from './drafted-solutions-handoff-build.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function draftedSolutionsHandoffBuildCli(): CliConfig {
  return {
    name: 'drafted-solutions-handoff-build',
    errorFormat: error => `::error::${error instanceof Error ? error.message : String(error)}\n`,
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runDraftedSolutionsHandoffBuild(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(draftedSolutionsHandoffBuildCli())
}
