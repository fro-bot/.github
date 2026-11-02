/**
 * The `scripts/rebuild-wiki-index.ts` entrypoint on the goke runner. No workflow runs it; an operator
 * heals the catalog files after merge conflicts:
 *
 * - no argument rebuilds `knowledge/index.md` from the wiki pages on disk;
 * - `--merge-logs <path> [path...]` merges the given log.md files into `knowledge/log.md`.
 *
 * It writes tracked files in the checkout, so it is not read-only. Paths without `--merge-logs`, a
 * flag it does not declare and `--help` are usage errors and write nothing.
 */

import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {runRebuildWikiIndex} from './rebuild-wiki-index.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function rebuildWikiIndexCli(): CliConfig {
  return {
    name: 'rebuild-wiki-index',
    commands: [
      defineCommand({
        readOnly: false,
        positionals: [{name: 'paths', kind: 'variadic'}],
        // goke reads the first path after the flag as its value; the rest are positionals.
        options: {mergeLogs: {flag: '--merge-logs <path>', schema: z.string().optional()}},
        action: async context => {
          const rest = Array.isArray(context.positionals.paths) ? context.positionals.paths.map(String) : []
          const first = context.options.mergeLogs
          if (first === undefined) {
            if (rest.length > 0) {
              context.stderr(`error: unexpected arguments: ${rest.join(' ')} (log paths need --merge-logs)\n`)
              return 1
            }
            await runRebuildWikiIndex(context)
            return 0
          }
          await runRebuildWikiIndex(context, {mergeLogs: [first, ...rest]})
          return 0
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(rebuildWikiIndexCli())
}
