import process from 'node:process'
import {main} from '@fro-bot/privacy/check-private-leak-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
