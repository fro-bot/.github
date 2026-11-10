/**
 * The `scripts/promotion-qualify.ts` entrypoint on the goke runner, and the real git adapter behind the
 * `PromotionGit` seam. It takes no arguments: the trigger comes from `GITHUB_EVENT_NAME`,
 * `PROMOTION_SCHEDULE` and `PROMOTION_REFRESH_REVIEW`, and the refs are `origin/main` and `origin/data`
 * as the job fetched them. Argv that matches nothing declared is a usage error and decides nothing.
 */

import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {
  InvalidPathEncodingError,
  runPromotionQualify,
  type PromotionGit,
  type PromotionSide,
} from './promotion-qualify.ts'

const execFileAsync = promisify(execFile)

/**
 * Git over the two fetched refs. `cwd` is the checkout; a test points it at a fixture repository. Output is
 * read as bytes and decoded as UTF-8 with the fatal option, so a path with an invalid byte throws instead of
 * turning into U+FFFD. Every lookup passes literal pathspecs, so a path that looks like pathspec magic
 * (`:(top)knowledge/a.md`) or a glob names itself and nothing else.
 */
export function createPromotionGit(options: {readonly cwd?: string} = {}): PromotionGit {
  const git = async (args: readonly string[]): Promise<string> => {
    const {stdout} = await execFileAsync('git', ['--literal-pathspecs', ...args], {
      cwd: options.cwd,
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
    })
    try {
      return new TextDecoder('utf-8', {fatal: true}).decode(stdout)
    } catch {
      throw new InvalidPathEncodingError()
    }
  }
  const refs: Record<PromotionSide, string> = {base: 'origin/main', head: 'origin/data'}

  return {
    diffNameStatus: async () => git(['diff', '--name-status', '-M', '-z', `${refs.base}...${refs.head}`]),
    entryAt: async (side, path) => {
      const listing = await git(['ls-tree', '-z', '--full-tree', refs[side], '--', path])
      const tab = listing.indexOf('\t')
      return tab === -1 ? null : listing.slice(0, tab)
    },
  }
}

export function promotionQualifyCli(): CliConfig {
  return {
    name: 'promotion-qualify',
    commands: [
      defineCommand({
        readOnly: true,
        action: async context =>
          runPromotionQualify({env: context.env, git: createPromotionGit(), stderr: context.stderr}),
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(promotionQualifyCli())
}
