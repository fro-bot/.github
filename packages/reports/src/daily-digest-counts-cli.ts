/**
 * The `scripts/daily-digest-counts.ts` entrypoint on the goke runner. One read-only root command declares two
 * optional positionals, the repos file and today's UTC date, and prints the digest counts as one JSON line.
 * `fro-bot.yaml` runs it as `RESULT="$(bun scripts/daily-digest-counts.ts metadata/repos.yaml "$TODAY_UTC")"`
 * under `set -euo pipefail` and reads `.repos_tracked`, `.surveys_today` and `.count_status` from stdout.
 *
 * The date is the second positional, else `TODAY_UTC`, else the UTC clock. A read or derive failure exits 0
 * with `count_status: "error"`: the workflow skips the announce on that value and does not read the exit code.
 * Argv beyond the two positionals, an unknown flag or `--help` is a usage error that prints no counts.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runDailyDigestCounts} from './daily-digest-counts.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function dailyDigestCountsCli(): CliConfig {
  return {
    name: 'daily-digest-counts',
    commands: [
      defineCommand({
        readOnly: true,
        positionals: [
          {name: 'path', kind: 'optional'},
          {name: 'date', kind: 'optional'},
        ],
        action: context => {
          // An optional positional is a string or undefined; only a variadic one is an array.
          const {path, date} = context.positionals as {path: string | undefined; date: string | undefined}
          runDailyDigestCounts({path, date}, context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(dailyDigestCountsCli())
}
