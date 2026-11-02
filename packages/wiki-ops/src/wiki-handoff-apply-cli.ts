/**
 * The `scripts/wiki-handoff-apply.ts` entrypoint on the goke runner. It takes no argument: the artifact
 * directory and the optional workspace come from `WIKI_HANDOFF_DIR` and `WIKI_HANDOFF_WORKSPACE`. It
 * writes the workspace tree, so the command is not read-only. Any failure prints
 * `::error::wiki-handoff-apply: <message>` and exits 1; argv that matches nothing declared is a usage
 * error and applies nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {formatWikiHandoffApplyError, runWikiHandoffApply} from './wiki-handoff-apply.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiHandoffApplyCli(): CliConfig {
  return {
    name: 'wiki-handoff-apply',
    errorFormat: formatWikiHandoffApplyError,
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runWikiHandoffApply(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiHandoffApplyCli())
}
