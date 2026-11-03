import process from 'node:process'
import {main} from '@fro-bot/reports/improvement-metrics-report-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
