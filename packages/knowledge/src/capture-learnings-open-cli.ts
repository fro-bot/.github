/**
 * The `scripts/capture-learnings-open.ts` entrypoint on the goke runner. It takes no argument: one writing
 * root command reads the harvest digest and the agent's bodies, runs the fail-closed privacy gate and opens
 * the `learning-proposal` issues, then prints the counts on stdout and writes them to
 * `CAPTURE_LEARNINGS_RESULT_PATH`, where `capture-learnings.yaml` reads
 * `.learningsOpened .blockedOnPrivacy .skippedDuplicate .failed`. A missing input, an unreadable
 * `metadata/repos.yaml` or a missing token throws a message-only error and exits 1. Argv that matches
 * nothing declared, `--help` included, is a usage error and opens nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCaptureLearningsOpen} from './capture-learnings-open.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function captureLearningsOpenCli(): CliConfig {
  return {
    name: 'capture-learnings-open',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await runCaptureLearningsOpen(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(captureLearningsOpenCli())
}
