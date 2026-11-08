/**
 * The `scripts/mutation-merge.ts` entrypoint: the final job of the PR mutation gate. Reads `MUTATION_ARTIFACT_DIR`,
 * `MUTATION_EVENT_SHA` and `MUTATION_SHARD_<n>_RESULT` from the environment; takes no arguments. Prints the located
 * mutants and the verdict once and exits with `exitCodeFor(verdict)`. A usage error or a throw exits 1.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {exitCodeFor, printResult, type ClassificationResult} from './check-mutation-guards.ts'
import {defaultMergeDeps, runMutationMerge, type MergeOutcome} from './mutation-merge.ts'

/** `run` and `print` are the seams a test replaces. */
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
          // printResult drops the reason, so the detail of a merge check goes to stderr, one line per failure.
          if (outcome.result.verdict === 'instrumentation-failed') {
            for (const mutant of outcome.result.mutants) {
              if (
                mutant.reason !== undefined &&
                (mutant.mutator === 'shard-merge' || mutant.mutator === 'vitest-config')
              ) {
                stderr(`mutation-merge: ${mutant.file}: ${mutant.status}: ${mutant.reason}\n`)
              }
            }
          }
          return exitCodeFor(outcome.result.verdict)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(mutationMergeCli())
}
