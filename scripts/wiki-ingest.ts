import process from 'node:process'

import {runWikiIngestCli} from '@fro-bot/wiki-write-core/wiki-ingest'

export * from '@fro-bot/wiki-write-core/wiki-ingest'

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiIngestCli()
}
