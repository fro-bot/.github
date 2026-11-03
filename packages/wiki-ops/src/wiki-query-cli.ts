/**
 * The `scripts/wiki-query.ts` entrypoint on the goke runner. It reads the wiki from the checkout, appends `excerpt`, `selected-paths` and `byte-length` to `$GITHUB_OUTPUT`, writes the selected-path handoff file at the caller-supplied `WIKI_CONTEXT_HANDOFF_PATH`, and prints the result as one JSON line. Both writes go to caller-supplied paths, so it is read-only. It takes no argument; argv that matches
 * nothing declared, `--help` included, is a usage error and runs nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runWikiQuery} from './wiki-query.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiQueryCli(): CliConfig {
  return {
    name: 'wiki-query',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runWikiQuery(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiQueryCli())
}
