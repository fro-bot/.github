/**
 * The `scripts/check-override-floors.ts` entrypoint on the goke runner. One read-only root command, with no
 * argument and no option, audits the locked dependency tree with `bun audit --json` and fails on any `high` or
 * `critical` advisory. The `bun run lint` chain and the agent prompt in `fro-bot.yaml` read only the exit code:
 * 1 on a high or critical advisory or on anything the check cannot interpret, 0 otherwise. Problems go to
 * stderr as `check-override-floors: ...` lines.
 *
 * Argv that matches nothing declared, `--help` included, is a usage error: exit 1, usage on stderr, no audit.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCheckOverrideFloors, type CheckOverrideFloorsOptions} from './check-override-floors.ts'

/**
 * `options.runAudit`, `options.readAccepted` and `options.now` are the effects a test replaces: the defaults run
 * `bun audit --json`, read `accepted-advisories.json` and read the clock. A function rather than a top-level
 * constant, so every mutant in the config is exercised when a test builds it.
 */
export function checkOverrideFloorsCli(options: CheckOverrideFloorsOptions = {}): CliConfig {
  return {
    name: 'check-override-floors',
    commands: [
      defineCommand({
        readOnly: true,
        action: context => runCheckOverrideFloors(context.stderr, options),
      }),
    ],
  }
}

export async function main(options: CheckOverrideFloorsOptions = {}): Promise<void> {
  await runCliMain(checkOverrideFloorsCli(options))
}
