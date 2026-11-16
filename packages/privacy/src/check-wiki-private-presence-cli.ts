/**
 * The `scripts/check-wiki-private-presence.ts` entrypoint on the goke runner. It runs the detection
 * through `runCli` and returns its exit code. `--operator-report` is the only flag; argv that matches
 * nothing declared is a usage error and runs no detection.
 *
 * The detection looks up an archived row's node to confirm it public. The token for that is `GH_TOKEN`,
 * else `GITHUB_TOKEN`, from the step env; with neither, the detection gets no resolver and treats an
 * archived row as unconfirmed (fail closed). No token is added or read from anywhere else.
 */

import type {NodeIdResolver} from './private-repo-resolution.ts'
import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {runCli} from './check-wiki-private-presence.ts'
import {makeGhNodeIdResolver} from './private-repo-resolution.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkWikiPrivatePresenceCli(
  makeResolver: (token: string) => NodeIdResolver = makeGhNodeIdResolver,
): CliConfig {
  return {
    name: 'check-wiki-private-presence',
    commands: [
      defineCommand({
        readOnly: true,
        options: {operatorReport: {flag: '--operator-report', schema: z.boolean().optional()}},
        action: async context => {
          const token = [context.env.GH_TOKEN, context.env.GITHUB_TOKEN].find(
            value => value !== undefined && value !== '',
          )
          const result = await runCli(
            context.options.operatorReport === true ? ['--operator-report'] : [],
            context.env,
            token === undefined ? undefined : makeResolver(token),
          )
          context.stdout(result.stdout)
          context.stderr(result.stderr)
          return result.exitCode
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkWikiPrivatePresenceCli())
}
