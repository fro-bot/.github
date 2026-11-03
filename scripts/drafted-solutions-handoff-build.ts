import process from 'node:process'
import {main} from '@fro-bot/knowledge/drafted-solutions-handoff-build'

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
