import process from 'node:process'
import {main} from '@fro-bot/registry/check-repo-onboarded-cli'

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
