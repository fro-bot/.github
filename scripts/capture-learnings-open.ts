import process from 'node:process'
import {main} from '@fro-bot/knowledge/capture-learnings-open-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
