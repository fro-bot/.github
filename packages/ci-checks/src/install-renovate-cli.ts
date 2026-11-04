/**
 * The `scripts/install-renovate.ts` entrypoint on the goke runner, run under Node (`re2`'s native binding is
 * built for Node's ABI). One root command, with no argument and no option, installs the Renovate version pinned
 * in `.github/workflows/main.yaml` into a scratch prefix outside the repository and prints the prefix path on
 * stdout. It is read-only: the scratch install is a tool-output directory (`RENOVATE_PREFIX`), not a tracked
 * path.
 *
 * `bun run check:renovate-config` chains it with `&&` before the check, so a failure here (exit 1, a
 * `install-renovate: <message>` line on stderr) stops the chain. Argv that matches nothing declared, `--help`
 * included, is a usage error: exit 1, usage on stderr, nothing installed.
 */

import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runInstallRenovate} from './install-renovate.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function installRenovateCli(): CliConfig {
  return {
    name: 'install-renovate',
    errorFormat: error => `install-renovate: ${error instanceof Error ? error.message : String(error)}\n`,
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runInstallRenovate(process.cwd(), context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(installRenovateCli())
}
