import process from 'node:process'
import {main} from '@fro-bot/knowledge/drafted-solutions-validate-rows-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
