import process from 'node:process'
import {main} from '@fro-bot/ci-checks/check-renovate-config-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
