import process from 'node:process'
import {main} from '@fro-bot/privacy/resolve-private-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
