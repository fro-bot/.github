/**
 * The `scripts/drafted-solutions-validate-rows.ts` entrypoint on the goke runner. The drafting agent runs it
 * until it exits 0, so its strings are a contract: valid rows print `rows valid: N row(s), one per digest
 * proposal` on stdout and exit 0; invalid rows print one error per line and then `N error(s): fix rows.json
 * and run this again.` on stderr and exit 1; an unreadable or non-JSON input prints its message on stderr
 * and exits 1. It reads two files and makes no network call. Argv that matches nothing declared, `--help`
 * included, is a usage error and validates nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runDraftedSolutionsValidateRows} from './drafted-solutions-validate-rows.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function draftedSolutionsValidateRowsCli(): CliConfig {
  return {
    name: 'drafted-solutions-validate-rows',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => runDraftedSolutionsValidateRows(context.env, context),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(draftedSolutionsValidateRowsCli())
}
