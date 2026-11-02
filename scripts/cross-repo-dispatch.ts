import process from 'node:process'
import {main} from '@fro-bot/dispatch/dispatch-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
