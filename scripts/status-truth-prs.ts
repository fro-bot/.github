import process from 'node:process'
import {main} from '@fro-bot/status-truth/prs-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
