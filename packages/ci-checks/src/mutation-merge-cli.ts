/**
 * The `scripts/mutation-merge.ts` entrypoint on the goke runner: the final job of the PR mutation gate. One read-only
 * root command with no argument and no option. It reads `MUTATION_ARTIFACT_DIR`, `MUTATION_EVENT_SHA` and one
 * `MUTATION_SHARD_<n>_RESULT` per shard from the environment, checks and merges the shard artifacts
 * (`mutation-merge.ts`), classifies the merged report and prints the located mutants and the verdict once.
 *
 * The exit code is `exitCodeFor(verdict)`, the same contract as `check-mutation-guards`: 0 for `clean` and
 * `not-applicable`, 1 for every other verdict. A usage error and a throw (an unreadable `stryker.config.json`, for one)
 * print their message on stderr and exit 1, so the job never ends in 0 without a verdict. Argv that matches nothing
 * declared, `--help` included, is a usage error.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {exitCodeFor, printResult, type ClassificationResult} from './check-mutation-guards.ts'
import {defaultMergeDeps, runMutationMerge, type MergeOutcome} from './mutation-merge.ts'

/**
 * `run` and `print` are the two effects a test replaces. A function rather than a top-level constant, so every mutant in
 * the config is exercised when a test builds it.
 */
export function mutationMergeCli(
  run: (env: Readonly<Record<string, string | undefined>>) => Promise<MergeOutcome> = async env =>
    runMutationMerge(env, defaultMergeDeps()),
  print: (result: ClassificationResult) => void = printResult,
): CliConfig {
  return {
    name: 'mutation-merge',
    commands: [
      defineCommand({
        readOnly: true,
        action: async ({env, stderr}) => {
          const outcome = await run(env)
          if (outcome.kind === 'usage') {
            stderr(
              `mutation-merge: ${outcome.message}\n` +
                'Usage: set MUTATION_ARTIFACT_DIR, MUTATION_EVENT_SHA and MUTATION_SHARD_<n>_RESULT for every shard in the environment; the command takes no arguments.\n',
            )
            return 1
          }
          print(outcome.result)
          return exitCodeFor(outcome.result.verdict)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(mutationMergeCli())
}
