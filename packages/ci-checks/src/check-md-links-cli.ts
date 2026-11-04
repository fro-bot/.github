/**
 * The `scripts/check-md-links.ts` entrypoint on the goke runner. One read-only root command, with no argument
 * and no option, checks the root-level markdown files and the markdown files below `docs/` of the working
 * directory for broken relative links. It prints one `path:line -> target` line per broken link on stderr
 * and exits 1; no broken link is exit 0 with no output. `bun run lint` chains it with `&&`, so a broken link
 * stops the chain.
 *
 * Argv that matches nothing declared, `--help` included, is a usage error: exit 1, usage on stderr, no check.
 */

import process from 'node:process'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {runCheckMarkdownLinks} from './check-md-links.ts'

/** A function rather than a top-level constant, so every mutant in the config is exercised when a test builds it. */
export function checkMarkdownLinksCli(): CliConfig {
  return {
    name: 'check-md-links',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context => runCheckMarkdownLinks(process.cwd(), context.stderr),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(checkMarkdownLinksCli())
}
