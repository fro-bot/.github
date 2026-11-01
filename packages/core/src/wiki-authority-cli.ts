/**
 * The `scripts/check-wiki-authority.ts` entrypoint on the goke runner. It takes no arguments: the
 * pull_request event comes from `GITHUB_EVENT_PATH`. Argv that matches nothing declared is a usage
 * error and runs no check.
 */

import {defineCommand, runCliMain, type CliConfig} from './cli.ts'
import {runWikiAuthority} from './wiki-authority.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkWikiAuthorityCli(): CliConfig {
  return {
    name: 'check-wiki-authority',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          const result = await runWikiAuthority(context.env)
          context.stdout(result.stdout)
          context.stderr(result.stderr)
          return result.exitCode
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkWikiAuthorityCli())
}
