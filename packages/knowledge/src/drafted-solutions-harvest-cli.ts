/**
 * The `scripts/drafted-solutions-harvest.ts` entrypoint on the goke runner. It takes no argument: one
 * read-only root command finds the open learning proposals the open drafted PR does not yet cover, writes
 * the digest to `DRAFTED_SOLUTIONS_DIGEST_PATH`, appends `has_work`, `draft_base_sha` and `main_sha` to
 * `$GITHUB_OUTPUT` and prints `{hasWork, proposals, prState}` on stdout. Every fail-closed condition
 * prints `::error::drafted-solutions-harvest: <message>` on stderr and exits 1. Argv that matches nothing
 * declared, `--help` included, is a usage error and harvests nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runDraftedSolutionsHarvest} from './drafted-solutions-harvest.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function draftedSolutionsHarvestCli(): CliConfig {
  return {
    name: 'drafted-solutions-harvest',
    errorFormat: error =>
      `::error::drafted-solutions-harvest: ${error instanceof Error ? error.message : String(error)}\n`,
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => {
          await runDraftedSolutionsHarvest(context.env, context)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(draftedSolutionsHarvestCli())
}
