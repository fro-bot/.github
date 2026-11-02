import process from 'node:process'
import {main} from '@fro-bot/status-truth/rollout-tracker-snapshot-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
