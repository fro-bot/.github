/**
 * The `scripts/status-truth-prs.ts` entrypoint on the goke runner. It takes no argument: one writing root
 * command re-checks the three arming keys, reads the report artifact the detect step wrote, plans and
 * executes bounded correction PRs, and prints a counts-only result on stdout and, when asked, in a result
 * file. Any argument, `--help` included, is a usage error and does nothing.
 *
 * `runPrs` reports every anticipated failure as a result with a closed-vocabulary `error` and sets the
 * exit code through its dependencies. The action collects that code and returns it to the runner, which
 * would otherwise overwrite `process.exitCode`. `status-truth.yaml` runs the step only on a manual
 * dispatch with `dry_run=false`, and `STATUS_TRUTH_DRY_RUN=true` makes no write.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {buildEnvBackedRunPrsCoreDeps, runPrs} from './status-truth-prs.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function statusTruthPrsCli(): CliConfig {
  return {
    name: 'status-truth-prs',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          let exitCode = 0
          await runPrs(
            buildEnvBackedRunPrsCoreDeps(context.env, {
              stdout: context.stdout,
              stderr: context.stderr,
              setExitCode: code => {
                exitCode = code
              },
            }),
          )
          return exitCode
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(statusTruthPrsCli())
}
