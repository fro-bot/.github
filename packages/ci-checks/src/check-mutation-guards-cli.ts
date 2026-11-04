/**
 * The `scripts/check-mutation-guards.ts` entrypoint on the goke runner. One read-only root command, with no
 * argument and no option, runs the mutation guard and prints the located mutants and the verdict. Stryker
 * writes `reports/mutation/mutation.json`, which `main.yaml` uploads in a step that runs `if: always()`,
 * and the located list and verdict also go to the step summary.
 *
 * The exit code is `exitCodeFor(verdict)`: 0 for `clean` and `not-applicable`, 1 for every other verdict.
 * A throw (an unreadable or malformed `stryker.config.json`, for one) prints its message on stderr and exits
 * 1, so the gate never ends in 0 without a verdict. Argv that matches nothing declared, `--help` included, is a
 * usage error: exit 1, usage on stderr, no Stryker run.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {exitCodeFor, printResult, runMutationGuardCheck, type ClassificationResult} from './check-mutation-guards.ts'

/**
 * `run` and `print` are the two effects a test replaces: a real run spawns Stryker. A function rather than a
 * top-level constant, so every mutant in the config is exercised when a test builds it.
 */
export function checkMutationGuardsCli(
  run: () => Promise<ClassificationResult> = async () => runMutationGuardCheck(),
  print: (result: ClassificationResult) => void = printResult,
): CliConfig {
  return {
    name: 'check-mutation-guards',
    commands: [
      defineCommand({
        readOnly: true,
        action: async () => {
          const result = await run()
          print(result)
          return exitCodeFor(result.verdict)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkMutationGuardsCli())
}
