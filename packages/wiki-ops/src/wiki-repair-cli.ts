/**
 * The `scripts/wiki-repair.ts` entrypoint on the goke runner. `wiki-lint.yaml` runs it with no argument
 * in the repair job; the inputs are the `WIKI_REPAIR_*` variables, `GRANDFATHER_WIKI_REPOS_DIR` and
 * `GITHUB_TOKEN`. It commits to `data` unless `WIKI_REPAIR_DRY_RUN=true`, so it is not read-only.
 * The runner would overwrite `process.exitCode`, so the action returns the code the repair decides.
 * An error that escapes the repair is reported on stderr and recorded as an abort; argv that matches
 * nothing declared, `--help` included, is a usage error and repairs nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runWikiRepairCli} from './wiki-repair.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiRepairCli(): CliConfig {
  return {
    name: 'wiki-repair',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => runWikiRepairCli(context.env, context),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiRepairCli())
}
