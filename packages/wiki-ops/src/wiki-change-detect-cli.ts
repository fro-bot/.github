/**
 * The `scripts/wiki-change-detect.ts` entrypoint on the goke runner. It takes one optional positional,
 * the mode, so a bad or missing mode reaches the command and prints `::error::wiki-change-detect:
 * mode must be "baseline" or "detect" (got <mode>)` as it always has, rather than a usage error.
 * `survey-repo.yaml` runs `baseline` once and `detect` after each attempt, and reads `hash=` and
 * `changed=` from `$GITHUB_OUTPUT`. The writer throws when `$GITHUB_OUTPUT` is unset. The command only
 * reads the checkout and appends to `$GITHUB_OUTPUT`, so it is read-only. A second positional, a flag
 * and `--help` are usage errors.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {formatWikiChangeDetectError, runWikiChangeDetect} from './wiki-change-detect.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiChangeDetectCli(): CliConfig {
  return {
    name: 'wiki-change-detect',
    errorFormat: formatWikiChangeDetectError,
    commands: [
      defineCommand({
        readOnly: true,
        positionals: [{name: 'mode', kind: 'optional'}],
        action: async context => {
          const mode = context.positionals.mode
          await runWikiChangeDetect(typeof mode === 'string' ? mode : undefined, context.env)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiChangeDetectCli())
}
