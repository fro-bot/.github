import process from 'node:process'

import {validateAndApplyWikiHandoff, WikiHandoffValidationError} from './wiki-handoff-core.ts'

/**
 * Trusted job (fresh default-branch checkout, no agent): validates and applies the
 * build-side artifact so wiki-ingest.ts's git-status diff is exactly that delta.
 */
async function main(): Promise<void> {
  const handoffDir = requiredEnv('WIKI_HANDOFF_DIR')
  const workspaceDir = process.env.WIKI_HANDOFF_WORKSPACE ?? process.cwd()

  const result = await validateAndApplyWikiHandoff({handoffDir, workspaceDir})
  process.stdout.write(`${JSON.stringify({applied: result.applied.length, deleted: result.deleted.length})}\n`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main()
  } catch (error: unknown) {
    const message = error instanceof WikiHandoffValidationError ? error.message : errorMessage(error)
    process.stderr.write(`::error::wiki-handoff-apply: ${message}\n`)
    process.exit(1)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
