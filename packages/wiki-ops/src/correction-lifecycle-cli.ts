/**
 * The `scripts/correction-lifecycle.ts` entrypoint. The agent runs it from a shell
 * (`bun scripts/correction-lifecycle.ts record --id ... --text "..."`), and an option value such as
 * `--text --help` must stay a value error rather than a help request. It keeps its hand-written argv
 * parser rather than the goke runner, which cannot tell the two apart. The command writes
 * `knowledge/corrections.yaml` in the checkout, so it is not read-only.
 */

import process from 'node:process'

import {main as runCorrectionLifecycle} from './correction-lifecycle.ts'

export async function main(): Promise<void> {
  process.exitCode = await runCorrectionLifecycle()
}
