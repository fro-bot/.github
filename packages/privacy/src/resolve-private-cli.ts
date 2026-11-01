/**
 * The `scripts/resolve-private.ts` entrypoint on the goke runner: `GH_TOKEN=<operator PAT> bun
 * scripts/resolve-private.ts [repos-path]` prints the node_id to owner/name table for the private
 * entries of `metadata/repos.yaml` (or of `repos-path`).
 */

import {readFile} from 'node:fs/promises'
import {defineCommand, runCliMain, type CliConfig} from '@fro-bot/core/cli'
import {assertReposFile} from '@fro.bot/wiki-write-core/schemas'
import {parse as parseYaml} from 'yaml'
import {makeGhNodeIdResolver} from './private-repo-resolution.ts'
import {formatTable, requireToken, resolvePrivateEntries} from './resolve-private.ts'

export function resolvePrivateCli(): CliConfig {
  return {
    name: 'resolve-private',
    commands: [
      defineCommand({
        readOnly: true,
        positionals: [{name: 'repos-path', kind: 'optional'}],
        action: async context => {
          const token = requireToken(context.env)
          const reposPath = context.positionals['repos-path']
          const raw = await readFile(typeof reposPath === 'string' ? reposPath : 'metadata/repos.yaml', 'utf8')
          const parsed: unknown = parseYaml(raw)
          assertReposFile(parsed)
          const results = await resolvePrivateEntries(parsed, makeGhNodeIdResolver(token))
          context.stdout(formatTable(results))
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(resolvePrivateCli())
}
