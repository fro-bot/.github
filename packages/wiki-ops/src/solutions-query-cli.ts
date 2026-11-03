/**
 * The `scripts/solutions-query.ts` entrypoint on the goke runner. It reads docs/solutions from the checkout, appends `excerpt`, `selected-paths` and `byte-length` to `$GITHUB_OUTPUT` and prints the result as one JSON line. Retrieval is best-effort: any error falls back to an empty result and exit 0. It takes no argument; argv that matches
 * nothing declared, `--help` included, is a usage error and runs nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runSolutionsQuery} from './solutions-query.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function solutionsQueryCli(): CliConfig {
  return {
    name: 'solutions-query',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runSolutionsQuery(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(solutionsQueryCli())
}
