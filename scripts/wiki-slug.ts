import process from 'node:process'

import {runWikiSlugCli} from '@fro-bot/wiki-write-core/wiki-slug'

export * from '@fro-bot/wiki-write-core/wiki-slug'

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiSlugCli()
}
