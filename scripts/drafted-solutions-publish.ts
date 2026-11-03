import process from 'node:process'
import {runCli} from '@fro-bot/knowledge/drafted-solutions-publish'

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.env)
}
