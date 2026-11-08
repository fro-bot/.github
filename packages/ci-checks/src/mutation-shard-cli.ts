/**
 * The `scripts/mutation-shard.ts` entrypoint on the goke runner: one shard of the PR mutation gate. One read-only
 * root command with no argument and no option; it reads `MUTATION_SHARD`, `MUTATION_SHARD_EVENT_SHA` and
 * `MUTATION_SHARD_OUTPUT_DIR` from the environment, runs the shard (`mutation-shard.ts`) and writes the output
 * directory that the workflow uploads as `mutation-shard-<n>`.
 *
 * Exit 0 when the output is written, whether the shard applied or not. Exit 1 on a usage error, on any failure
 * (stderr names it) and on a throw, so the shard never ends in 0 without its output. It never judges a mutant: the
 * merge step does. Argv that matches nothing declared, `--help` included, is a usage error: exit 1, usage on stderr,
 * no Stryker run.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {defaultShardDeps, runMutationShard, type ShardResult} from './mutation-shard.ts'

/**
 * `run` is the one effect a test replaces: a real run reads the repository and may spawn Stryker. A function rather
 * than a top-level constant, so every mutant in the config is exercised when a test builds it.
 */
export function mutationShardCli(
  run: (env: Readonly<Record<string, string | undefined>>) => Promise<ShardResult> = async env =>
    runMutationShard(env, defaultShardDeps()),
): CliConfig {
  return {
    name: 'mutation-shard',
    commands: [
      defineCommand({
        readOnly: true,
        action: async ({env, stdout, stderr}) => {
          const result = await run(env)
          if (result.kind === 'written') {
            const {shard, applicability, head} = result.manifest
            stdout(`mutation-shard: shard ${String(shard)} ${applicability} (head ${head})\n`)
            return 0
          }
          if (result.kind === 'usage') {
            stderr(
              `mutation-shard: ${result.message}\n` +
                'Usage: set MUTATION_SHARD, MUTATION_SHARD_EVENT_SHA and MUTATION_SHARD_OUTPUT_DIR in the environment; the command takes no arguments.\n',
            )
            return 1
          }
          stderr(`mutation-shard: ${result.reason}\n`)
          return 1
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(mutationShardCli())
}
