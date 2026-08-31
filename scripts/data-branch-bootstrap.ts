import process from 'node:process'

import {runDataBranchBootstrapCli} from '@fro-bot/wiki-write-core/data-branch-bootstrap'

export * from '@fro-bot/wiki-write-core/data-branch-bootstrap'

if (import.meta.url === `file://${process.argv[1]}`) {
  await runDataBranchBootstrapCli()
}
