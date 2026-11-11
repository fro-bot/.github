/**
 * The `scripts/renovate-approve.ts` entrypoint on the goke runner, and the real clock, sleep, settings read
 * and Octokit behind `runApprove`. It takes no arguments: the token is `GH_TOKEN` (`FRO_BOT_PAT`), the
 * repository is `GITHUB_REPOSITORY` and the switch is `RENOVATE_APPROVE`. Argv that matches nothing declared
 * is a usage error and approves nothing.
 */

import {readFileSync} from 'node:fs'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {createOctokit} from '@fro-bot/core/github'
import {runApprove} from './renovate-approve.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function renovateApproveCli(): CliConfig {
  return {
    name: 'renovate-approve',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context =>
          runApprove({
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
  await runCliMain(renovateApproveCli())
}
