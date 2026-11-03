import process from 'node:process'
import {main} from '@fro-bot/knowledge/capture-learnings-harvest'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
