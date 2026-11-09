/**
 * The `scripts/promotion-self-merge.ts` entrypoint on the goke runner, and the real clock, sleep, settings
 * read and Octokit behind `runSelfMerge`. It takes no arguments: the token is `GH_TOKEN` (`FRO_BOT_PAT`),
 * the promotion comes from `PROMOTION_PR`, `PROMOTION_PIN` and `PROMOTION_QUALIFIES`, and the switch from
 * `PROMOTION_SELF_MERGE`. Argv that matches nothing declared is a usage error and approves nothing.
 */

import {readFileSync} from 'node:fs'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {createOctokit} from '@fro-bot/core/github'
import {runSelfMerge} from './promotion-self-merge.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function promotionSelfMergeCli(): CliConfig {
  return {
    name: 'promotion-self-merge',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context =>
          runSelfMerge({
            env: context.env,
            readSettings: () => readFileSync('.github/settings.yml', 'utf8'),
            createClient: async token => createOctokit(token),
            now: () => Date.now(),
            sleep: async ms =>
              new Promise<void>(resolve => {
                setTimeout(resolve, ms)
              }),
            signal: ms => AbortSignal.timeout(ms),
            stdout: context.stdout,
            stderr: context.stderr,
          }),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(promotionSelfMergeCli())
}
