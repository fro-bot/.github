import process from 'node:process'
import {main} from '@fro-bot/wiki-ops/rebuild-wiki-index-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
