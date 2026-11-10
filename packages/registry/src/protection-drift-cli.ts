/**
 * The `scripts/protection-drift.ts` entrypoint on the goke runner, and the real file reads and Octokit
 * behind `runProtectionDrift`. It takes no arguments: the event is `GITHUB_EVENT_PATH` and the token is
 * `GITHUB_TOKEN` (`github.token`, with `issues: write`). Argv that matches nothing declared is a usage error
 * and reports nothing.
 */

import {readFileSync} from 'node:fs'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {createOctokit} from '@fro-bot/core/github'
import {runProtectionDrift} from './protection-drift.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function protectionDriftCli(): CliConfig {
  return {
    name: 'protection-drift',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context =>
          runProtectionDrift({
            env: context.env,
            readFile: path => readFileSync(path, 'utf8'),
            createClient: async token => createOctokit(token),
            now: () => new Date(),
            sleep: async ms =>
              new Promise<void>(resolve => {
                setTimeout(resolve, ms)
              }),
            signal: ms => AbortSignal.timeout(ms),
            // The identity `github.token` writes as; the one place it is named.
            author: {login: 'github-actions[bot]', type: 'Bot'},
            stdout: context.stdout,
            stderr: context.stderr,
          }),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(protectionDriftCli())
}
