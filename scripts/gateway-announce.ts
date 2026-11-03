import process from 'node:process'
import {main} from '@fro-bot/reports/gateway-announce-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
