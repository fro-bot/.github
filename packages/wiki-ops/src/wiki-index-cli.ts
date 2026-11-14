/**
 * The `scripts/wiki-index.ts` entrypoint on the goke runner. It reads the wiki from the checkout, appends the
 * `index` output to the caller-supplied `$GITHUB_OUTPUT`, and prints one status line, so it is read-only. It
 * takes no argument; argv that matches nothing declared, `--help` included, is a usage error and runs nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runWikiIndex} from './wiki-index.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiIndexCli(): CliConfig {
  return {
    name: 'wiki-index',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runWikiIndex(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiIndexCli())
}
