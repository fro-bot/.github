/**
 * The `scripts/wiki-lint-issues.ts` entrypoint on the goke runner. `wiki-lint.yaml` runs it with no
 * argument and `WIKI_LINT_JSON_PATH` set; it also declares the optional report path as its one
 * positional, read after the variable. It opens, comments on, reopens and closes issues, so it is not
 * read-only. A condition the step reports (a missing or malformed report, an unknown version, a failed
 * issue call) prints its `wiki-lint-issues:` line and exits 1, the failed-call case after the outputs
 * are written; anything unexpected prints `wiki-lint-issues: unhandled error: ...`. A second
 * positional, a flag and `--help` are usage errors and sync nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {formatWikiLintIssuesError, runWikiLintIssues} from './wiki-lint-issues.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function wikiLintIssuesCli(): CliConfig {
  return {
    name: 'wiki-lint-issues',
    errorFormat: formatWikiLintIssuesError,
    commands: [
      defineCommand({
        readOnly: false,
        positionals: [{name: 'jsonPath', kind: 'optional'}],
        action: async context => {
          const jsonPath = context.positionals.jsonPath
          return runWikiLintIssues(context.env, context, typeof jsonPath === 'string' ? jsonPath : undefined)
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(wikiLintIssuesCli())
}
