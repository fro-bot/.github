/**
 * The `scripts/mutation-shard.ts` entrypoint: one PR shard. Reads `MUTATION_SHARD`, `MUTATION_SHARD_EVENT_SHA` and
 * `MUTATION_SHARD_OUTPUT_DIR` from the environment; takes no arguments. Exit 0 once the output is written, applicable or
 * not; exit 1 on a usage error or a failure, with the reason on stderr.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {defaultShardDeps, runMutationShard, type ShardResult} from './mutation-shard.ts'

/** `run` is the seam a test replaces; a real run may spawn Stryker. */
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
