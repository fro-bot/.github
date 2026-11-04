/**
 * The `scripts/check-solutions-examples.ts` entrypoint on the goke runner. One read-only root command, with no
 * argument and no option, checks the fenced TypeScript examples in `docs/solutions/**` of the working
 * directory: each must parse, and each `<!-- verify: NAME from PATH -->` marker must name a symbol that exists
 * with the arity the example calls it with. Every finding is a `path:line -> reason` line on stderr and the
 * exit code is 1; no finding is exit 0 with no output. `bun run lint` chains it with `&&`.
 *
 * Argv that matches nothing declared, `--help` included, is a usage error: exit 1, usage on stderr, no check.
 */

import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCheckSolutionsExamples} from './check-solutions-examples.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkSolutionsExamplesCli(): CliConfig {
  return {
    name: 'check-solutions-examples',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => runCheckSolutionsExamples(process.cwd(), context.stderr),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkSolutionsExamplesCli())
}
