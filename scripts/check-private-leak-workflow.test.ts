import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

describe('check-private-leak.yaml status contract', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/check-private-leak.yaml')
  const raw = readFileSync(workflowPath, 'utf8')

  it('uses distinct descriptions for detection and scan errors', () => {
    expect(raw).toContain('Private repository name found in PR diff.')
    expect(raw).toContain('Private leak scan could not complete (scan error); see run logs.')
    expect(raw).not.toContain('Private repository name(s) detected or scan error')
    expect(raw).toContain('steps.scan.outputs.scan_result')
  })
})

describe('fro-bot.yaml errored PR oversight contract', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
  const raw = readFileSync(workflowPath, 'utf8')

  it('requires checking both check runs and legacy commit statuses', () => {
    expect(raw).toContain('both sources: check runs and legacy commit statuses')
    expect(raw).toContain('check runs only')
    expect(raw).toContain('/commits/{sha}/status')
    expect(raw).toContain('failures from either source under "Errored PRs"')
  })
})
