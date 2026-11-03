import process from 'node:process'

import {requiredEnv} from '@fro-bot/core/env'
import {formatJsonLine} from '@fro-bot/core/json'
import {validateAndApplyWikiHandoff} from './wiki-handoff-core.ts'

export interface WikiHandoffApplyIo {
  readonly stdout: (text: string) => void
}

/**
 * Trusted job (fresh default-branch checkout, no agent): validates and applies the
 * build-side artifact so wiki-ingest.ts's git-status diff is exactly that delta.
 */
export async function runWikiHandoffApply(
  env: Readonly<Record<string, string | undefined>>,
  io: WikiHandoffApplyIo,
  cwd: string = process.cwd(),
): Promise<void> {
  const handoffDir = requiredEnv(env, 'WIKI_HANDOFF_DIR')
  const workspaceDir = env.WIKI_HANDOFF_WORKSPACE ?? cwd

  const result = await validateAndApplyWikiHandoff({handoffDir, workspaceDir})
  io.stdout(
    formatJsonLine({applied: result.applied.length, deleted: result.deleted.length, skipped: result.skipped.length}),
  )
}

/** The step's stderr line: a workflow command, so the runner annotates the failure. */
export function formatWikiHandoffApplyError(error: unknown): string {
  return `::error::wiki-handoff-apply: ${error instanceof Error ? error.message : String(error)}\n`
}
