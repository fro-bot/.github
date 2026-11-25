/**
 * Contract tests for `.github/workflows/manage-issues.yaml`: it carries the stale and lock jobs only. The
 * daily report is closed by the next daily run (`OBSERVE_OUTPUT` in `fro-bot.yaml`), so no job here matches a
 * report title. A title-regex close step would match no report (the legacy titles are gone) and would hold an
 * issues-write App token for nothing.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  run?: string
}

interface WorkflowJob {
  needs?: string | string[]
  steps?: WorkflowStep[]
}

interface WorkflowFile {
  env?: Record<string, unknown>
  jobs: Record<string, WorkflowJob>
}

const load = (name: string): {raw: string; parsed: WorkflowFile} => {
  const raw = readFileSync(resolve(import.meta.dirname, `../.github/workflows/${name}`), 'utf8')
  return {raw, parsed: parse(raw) as WorkflowFile}
}

const manageIssues = load('manage-issues.yaml')
const froBot = load('fro-bot.yaml')

/** Collapse line wrapping so assertions pin wording, not where the YAML folds a line. */
const flat = (text: string): string => text.replaceAll(/\s+/g, ' ')

describe('manage-issues workflow: no report-title close step', () => {
  it('has the stale and lock jobs and nothing that closes a report', () => {
    expect(Object.keys(manageIssues.parsed.jobs)).toEqual(['stale', 'lock'])
  })

  it('does not match a daily report title or run `gh issue close`', () => {
    expect(manageIssues.raw).not.toContain('Org Oversight')
    expect(manageIssues.raw).not.toContain('Autohealing')
    expect(manageIssues.raw).not.toContain('gh issue close')
    expect(manageIssues.raw).not.toContain('close-automated-reports')
  })

  it('keeps stale as the first job and lock behind stale', () => {
    expect(manageIssues.parsed.jobs.stale?.needs).toBeUndefined()
    expect(manageIssues.parsed.jobs.lock?.needs).toBe('stale')
  })
})

describe('fro-bot.yaml: the daily run closes the predecessor report', () => {
  const output = flat(String(froBot.parsed.env?.OBSERVE_OUTPUT ?? ''))

  it("creates today's report, reads it back, then closes every older open report", () => {
    const create = output.indexOf("create today's report")
    const readBack = output.indexOf("read today's report back")
    const close = output.indexOf('CLOSE every older open issue whose title starts with "Daily Fro Bot Report —"')
    expect(create).toBeGreaterThanOrEqual(0)
    expect(readBack).toBeGreaterThan(create)
    expect(close).toBeGreaterThan(readBack)
  })

  it('leaves a closing comment that links the newest report and ends with one open report', () => {
    expect(output).toContain('leaving a one-line closing comment that links the newest report')
    expect(output).toContain('There must be exactly one open daily report when the run finishes.')
  })
})
