/**
 * The `scripts/wiki-handoff-baseline.ts` entrypoint on the goke runner. It takes no argument: the
 * baseline path comes from `WIKI_HANDOFF_BASELINE_PATH`. The baseline file lives at a caller-supplied
 * artifact path, so the command is read-only in the CLI adoption rule's sense. Argv that matches
 * nothing declared is a usage error and captures nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runWikiHandoffBaseline} from './wiki-handoff-baseline.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiHandoffBaselineCli(): CliConfig {
  return {
    name: 'wiki-handoff-baseline',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runWikiHandoffBaseline(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiHandoffBaselineCli())
}
