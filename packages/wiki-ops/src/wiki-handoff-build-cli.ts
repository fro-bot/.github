/**
 * The `scripts/wiki-handoff-build.ts` entrypoint on the goke runner. It takes no argument: the artifact
 * directory and the optional baseline path come from `WIKI_HANDOFF_DIR` and `WIKI_HANDOFF_BASELINE_PATH`.
 * The artifact is written to a caller-supplied directory and `changed=` to `$GITHUB_OUTPUT`, so the
 * command is read-only in the CLI adoption rule's sense. Argv that matches nothing declared is a usage
 * error and builds nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runWikiHandoffBuild} from './wiki-handoff-build.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiHandoffBuildCli(): CliConfig {
  return {
    name: 'wiki-handoff-build',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runWikiHandoffBuild(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiHandoffBuildCli())
}
