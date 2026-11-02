import process from 'node:process'
import {main} from '@fro-bot/wiki-ops/wiki-context-expand-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
