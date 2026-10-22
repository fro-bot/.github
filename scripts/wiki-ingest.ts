import process from 'node:process'

import {runWikiIngestCli, WikiIngestError} from '@fro.bot/wiki-write-core/wiki-ingest'

export * from '@fro.bot/wiki-write-core/wiki-ingest'

/** Exit status for a page conflict, so a workflow can tell it from any other failure (which exits 1). */
export const HANDOFF_PAGE_CHANGED_EXIT_CODE = 3

/** Runs the ingest CLI. A page conflict sets exit code 3; every other error propagates unchanged. */
export async function runWikiIngestEntry(run: () => Promise<void> = runWikiIngestCli): Promise<void> {
  try {
    await run()
  } catch (error: unknown) {
    if (!(error instanceof WikiIngestError && error.code === 'HANDOFF_PAGE_CHANGED')) throw error
    process.stderr.write(`::error::wiki-ingest: ${error.message}. ${error.remediation}\n`)
    process.exitCode = HANDOFF_PAGE_CHANGED_EXIT_CODE
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiIngestEntry()
}
