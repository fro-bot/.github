import process from 'node:process'
import {main} from '@fro-bot/wiki-ops/solutions-query-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
