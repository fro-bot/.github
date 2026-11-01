/**
 * The `scripts/enumerate-existing-leaks.ts` entrypoint on the goke runner. An operator tool: it scans
 * the local checkout for surfaces where the supplied private repo identifiers appear in public
 * artifacts.
 *
 * Usage prints on stdout. No argv and a usage error exit 1, `--help` exits 0.
 */

import process from 'node:process'
import {defineCommand, runCliMain, z, type CliConfig} from '@fro-bot/core/cli'
import {formatLeakReport, parsePrivateArgs, runCli} from './enumerate-existing-leaks.ts'

function usageText(): string {
  return `${[
    'Usage: bun scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name> [--private ...] [--branch <ref>]',
    '',
    'Scans the local checkout for surfaces where the supplied private repo identifiers appear',
    'in public artifacts (commit subjects on main, recent Survey Repo workflow runs,',
    'metadata/repos.yaml entries, and knowledge/wiki/repos/ filenames).',
    '',
    'By default reads metadata/repos.yaml from the working tree (typically main). Pass',
    '--branch origin/data to also catch entries that have not yet promoted via the weekly',
    'merge-data PR. Operators should run both passes for full coverage.',
    '',
    'Examples:',
    '  bun scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name>',
    '  bun scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name> --branch origin/data',
    '',
    'For each surface, the operator decides REMEDIATE (run the printed command) or ACCEPT',
    '(record the disclosure in metadata/README.md). Phase 0 closes when every surface has',
    'an explicit decision.',
  ].join('\n')}\n`
}

export function enumerateExistingLeaksCli(): CliConfig {
  return {
    name: 'enumerate-existing-leaks',
    noArgv: 'usage',
    usageStream: 'stdout',
    usageCode: 1,
    helpCode: 0,
    usageText: usageText(),
    commands: [
      defineCommand({
        readOnly: true,
        options: {
          private: {flag: '--private <mapping>', schema: z.union([z.string(), z.array(z.string())]).optional()},
          branch: {flag: '--branch <ref>', schema: z.string().optional()},
        },
        action: async context => {
          const mappings = context.options.private
          const specs = typeof mappings === 'string' ? [mappings] : (mappings ?? [])
          const privateRepos = parsePrivateArgs(specs.flatMap(spec => ['--private', spec]))
          if (privateRepos.length === 0) {
            context.stderr('enumerate-existing-leaks: no --private mappings supplied\n')
            return 1
          }
          const surfaces = await runCli({
            privateRepos,
            repoRoot: process.cwd(),
            mainBranch: 'main',
            metadataRef: context.options.branch,
          })
          context.stdout(`${formatLeakReport(surfaces)}\n`)
          return undefined
        },
      }),
    ],
  }
}

export async function main(): Promise<void> {
  await runCliMain(enumerateExistingLeaksCli())
}
