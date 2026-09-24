import {execFile} from 'node:child_process'
import process from 'node:process'
import {promisify} from 'node:util'

import {buildWikiHandoff} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

/**
 * Ingest env vars carried through the handoff as opaque metadata — the trusted job reads
 * these back out of `metadata.json` and re-exports them before invoking `wiki-ingest.ts`.
 * Kept as plain passthrough (not re-derived) so the two jobs stay in lockstep with
 * whatever wiki-ingest.ts's CLI env contract currently is.
 */
const METADATA_ENV_KEYS = [
  'WIKI_OPERATION',
  'WIKI_TARGET',
  'WIKI_SUMMARY',
  'WIKI_COMMIT_MESSAGE',
  'WIKI_SOURCES',
] as const

/**
 * Runs in the (untrusted-adjacent) agent job, after the agent step, once a wiki diff has
 * already been detected against the pre-agent baseline. Holds no write credential — see
 * `wiki-handoff-core.ts` module doc for the security property this relies on.
 */
async function main(): Promise<void> {
  const outDir = requiredEnv('WIKI_HANDOFF_DIR')
  const metadata: Record<string, string> = {}
  for (const key of METADATA_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) metadata[key] = value
  }

  const result = await buildWikiHandoff({
    cwd: process.cwd(),
    outDir,
    metadata,
    runGitStatus: async () => {
      const {stdout} = await execFileAsync('git', [
        'status',
        '--porcelain=v1',
        '--',
        'knowledge/wiki',
        'knowledge/index.md',
        'knowledge/log.md',
      ])
      return stdout
    },
  })

  process.stdout.write(`${JSON.stringify({changed: result.changed.length, deleted: result.deleted.length})}\n`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
