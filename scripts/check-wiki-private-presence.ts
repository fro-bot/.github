import process from 'node:process'
import {main} from '@fro-bot/privacy/check-wiki-private-presence-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
