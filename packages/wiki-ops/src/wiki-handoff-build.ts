import {execFile} from 'node:child_process'
import process from 'node:process'
import {promisify} from 'node:util'

import {requiredEnv} from '@fro-bot/core/env'
import {formatJsonLine} from '@fro-bot/core/json'
import {writeGithubOutputs} from '@fro-bot/core/output'
import {buildWikiHandoff} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

export interface WikiHandoffBuildIo {
  readonly stdout: (text: string) => void
}

function optionalEnv(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * Runs post-agent in the agent job (untrusted): builds the manifest.json + files/ delta.
 * Scopes to WIKI_HANDOFF_BASELINE_PATH when set (see wiki-handoff-core.ts).
 */
export async function runWikiHandoffBuild(
  env: Readonly<Record<string, string | undefined>>,
  io: WikiHandoffBuildIo,
  cwd: string = process.cwd(),
): Promise<void> {
  const outDir = requiredEnv(env, 'WIKI_HANDOFF_DIR')
  const baselinePath = optionalEnv(env, 'WIKI_HANDOFF_BASELINE_PATH')

  const result = await buildWikiHandoff({
    cwd,
    outDir,
    ...(baselinePath === undefined ? {} : {baselinePath}),
    runGitStatus: async () => {
      const {stdout} = await execFileAsync(
        'git',
        [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          'knowledge/wiki',
          'knowledge/index.md',
          'knowledge/log.md',
        ],
        {cwd},
      )
      return stdout
    },
  })

  const hasChanges = result.changed.length > 0 || result.deleted.length > 0
  io.stdout(formatJsonLine({changed: result.changed.length, deleted: result.deleted.length}))

  writeGithubOutputs({changed: String(hasChanges)}, {onMissing: 'skip', env})
}
