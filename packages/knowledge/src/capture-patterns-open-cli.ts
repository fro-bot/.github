/**
 * The `scripts/capture-patterns-open.ts` entrypoint on the goke runner. It takes no argument: one writing
 * root command validates the agent's body file against the digest, runs every title and body through the
 * public-output gate and opens at most three `pattern-proposal` issues, then prints the counts on stdout and
 * writes them to `CAPTURE_PATTERNS_RESULT_PATH`, where `capture-patterns.yaml` reads the fourteen result
 * keys. A missing input or token throws a message-only error and exits 1. The workflow never runs it on a
 * dry run. Argv that matches nothing declared, `--help` included, is a usage error and opens nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCapturePatternsOpen} from './capture-patterns-open.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function capturePatternsOpenCli(): CliConfig {
  return {
    name: 'capture-patterns-open',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runCapturePatternsOpen(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(capturePatternsOpenCli())
}
