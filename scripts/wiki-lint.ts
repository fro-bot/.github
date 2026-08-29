import process from 'node:process'

import {runWikiLintCli} from '@fro-bot/wiki-write-core/wiki-lint'

export * from '@fro-bot/wiki-write-core/wiki-lint'

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWikiLintCli()
}
