/**
 * The `scripts/check-wiki-private-presence.ts` entrypoint on the goke runner. It runs the detection
 * through `runCli` and returns its exit code. `--operator-report` is the only flag; argv that matches
 * nothing declared is a usage error and runs no detection.
 */

import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {runCli} from './check-wiki-private-presence.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkWikiPrivatePresenceCli(): CliConfig {
  return {
    name: 'check-wiki-private-presence',
    commands: [
      defineCommand({
        readOnly: true,
        options: {operatorReport: {flag: '--operator-report', schema: z.boolean().optional()}},
        action: async context => {
          const result = await runCli(context.options.operatorReport === true ? ['--operator-report'] : [], context.env)
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
