import process from 'node:process'
import {main} from '@fro-bot/knowledge/drafted-solutions-harvest'

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    process.stderr.write(
      `::error::drafted-solutions-harvest: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  }
}
