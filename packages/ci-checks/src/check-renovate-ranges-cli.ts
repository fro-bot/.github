/**
 * The `scripts/check-renovate-ranges.ts` entrypoint on the goke runner, run under Node (`re2`'s native binding
 * is built for Node's ABI). One read-only root command takes any number of config paths as its variadic
 * positional and judges every `allowedVersions` value in them with the pinned Renovate under `RENOVATE_PREFIX`.
 * With no path it checks `default.json` and `.github/renovate.json5`. Exit 1 on an invalid range or any failure
 * to load Renovate or read a config.
 *
 * No workflow calls it directly; `check-renovate-config` runs the same check. A flag, `--help` included, is a
 * usage error: exit 1, usage on stderr, no check. A path that starts with `-` cannot be named.
 */

import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {DEFAULT_CONFIG_FILES, runCheckRenovateRanges} from './check-renovate-ranges.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkRenovateRangesCli(): CliConfig {
  return {
    name: 'check-renovate-ranges',
    commands: [
      defineCommand({
        readOnly: true,
        positionals: [{name: 'paths', kind: 'variadic'}],
        action: async context => {
          // A variadic positional is always an array.
          const paths = context.positionals.paths as readonly string[]
          return runCheckRenovateRanges(paths.length > 0 ? paths : DEFAULT_CONFIG_FILES, process.cwd())
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkRenovateRangesCli())
}
