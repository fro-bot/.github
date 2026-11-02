import {execFile} from 'node:child_process'
import process from 'node:process'
import {promisify} from 'node:util'

import {requiredEnv} from '@fro-bot/core/env'
import {formatJsonLine} from '@fro-bot/core/json'
import {captureWikiBaseline} from './wiki-handoff-core.ts'

const execFileAsync = promisify(execFile)

/** What the step writes: stdout only, so a test or the runner can hold it. */
export interface WikiHandoffBaselineIo {
  readonly stdout: (text: string) => void
}

/**
 * Runs right after sync-wiki, before the agent step, so the baseline reflects pre-agent
 * `data` content rather than every main-vs-data difference (see wiki-handoff-core.ts).
 */
export async function runWikiHandoffBaseline(
  env: Readonly<Record<string, string | undefined>>,
  io: WikiHandoffBaselineIo,
  cwd: string = process.cwd(),
): Promise<void> {
  const baselinePath = requiredEnv(env, 'WIKI_HANDOFF_BASELINE_PATH')

  const manifest = await captureWikiBaseline({
    cwd,
    baselinePath,
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

  io.stdout(formatJsonLine({files: Object.keys(manifest.files).length}))
}
