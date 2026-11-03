import process from 'node:process'
import {main} from '@fro-bot/knowledge/drafted-solutions-validate-rows'

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main()
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
