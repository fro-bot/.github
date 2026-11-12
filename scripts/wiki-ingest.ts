import process from 'node:process'

import {runWikiIngestCli, WikiIngestError} from '@fro.bot/wiki-write-core/wiki-ingest'

export * from '@fro.bot/wiki-write-core/wiki-ingest'

/**
 * Exit status for a conflict with another writer, so a workflow can tell it from any other failure (which exits 1).
 * Covers a page the agent edited that changed on `data` (`HANDOFF_PAGE_CHANGED`) and a write set another writer
 * changed or a tree read that could not be verified (`CONFLICT_EXHAUSTED`); a re-run starts from the current head.
 */
export const HANDOFF_PAGE_CHANGED_EXIT_CODE = 3

const CONFLICT_CODES: ReadonlySet<string> = new Set(['HANDOFF_PAGE_CHANGED', 'CONFLICT_EXHAUSTED'])

/** Runs the ingest CLI. A conflict with another writer sets exit code 3; every other error propagates unchanged. */
export async function runWikiIngestEntry(run: () => Promise<void> = runWikiIngestCli): Promise<void> {
  try {
    await run()
  } catch (error: unknown) {
    if (!(error instanceof WikiIngestError && CONFLICT_CODES.has(error.code))) throw error
    process.stderr.write(`::error::wiki-ingest: ${error.message}. ${error.remediation}\n`)
    process.exitCode = HANDOFF_PAGE_CHANGED_EXIT_CODE
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiIngestEntry()
}
