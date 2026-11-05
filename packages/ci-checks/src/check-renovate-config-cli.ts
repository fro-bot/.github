/**
 * The `scripts/check-renovate-config.ts` entrypoint on the goke runner, run under Node (`re2`'s native binding
 * is built for Node's ABI). One read-only root command, with no argument and no option, validates
 * `default.json`, `.github/renovate.json5` and the version-pinned `github>` presets they extend with the pinned
 * Renovate installed under `RENOVATE_PREFIX`, then range-checks every `allowedVersions`. Exit 1 on any failure;
 * the output goes straight to the process streams, in the order the checks produce it.
 *
 * `bun run check:renovate-config` runs it after `install-renovate` and `main.yaml` runs the same script.
 * Argv that matches nothing declared, `--help` included, is a usage error: exit 1, usage on stderr, no check.
 */

import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCheckRenovateConfig} from './check-renovate-config.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkRenovateConfigCli(): CliConfig {
  return {
    name: 'check-renovate-config',
    commands: [
      defineCommand({
        readOnly: true,
        action: async () => runCheckRenovateConfig(process.cwd()),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkRenovateConfigCli())
}
