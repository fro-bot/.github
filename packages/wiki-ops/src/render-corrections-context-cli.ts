/**
 * The `scripts/render-corrections-context.ts` entrypoint on the goke runner. `survey-repo.yaml` runs it
 * as `if bun scripts/render-corrections-context.ts 2>"$warning_file"; then` and then greps the file for
 * `^corrections:warning:` lines and re-raises the exit status. It takes no argument: the page comes
 * from `REPO_NODE_ID`. It writes `.github/corrections-context.json` in the checkout, so it is not
 * read-only. A failure keeps exit 1 and prints its message after any warning lines. Argv that matches
 * nothing declared, `--help` included, is a usage error and writes nothing.
 */

import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {renderCorrectionsContext} from './render-corrections-context.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function renderCorrectionsContextCli(): CliConfig {
  return {
    name: 'render-corrections-context',
    commands: [
      defineCommand({
        readOnly: false,
        action: async context => {
          await renderCorrectionsContext(context.env, {stderr: context.stderr})
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(renderCorrectionsContextCli())
}
