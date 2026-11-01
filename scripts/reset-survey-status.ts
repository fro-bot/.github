import process from 'node:process'
import {main} from '@fro-bot/registry/reset-survey-status-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
