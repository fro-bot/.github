import process from 'node:process'
import {main} from '@fro-bot/knowledge/capture-patterns-open'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
