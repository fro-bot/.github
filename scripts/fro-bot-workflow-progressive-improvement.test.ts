import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowDocument {
  env: {
    SCHEDULE_PROMPT: string
  }
}

/** Narrow the parsed YAML to the schedule-prompt shape asserted below. */
function assertFroBotWorkflow(value: unknown): asserts value is WorkflowDocument {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('env' in value) ||
    typeof (value as Record<string, unknown>).env !== 'object' ||
    (value as {env?: Record<string, unknown>}).env?.SCHEDULE_PROMPT === undefined ||
    typeof (value as {env?: Record<string, unknown>}).env?.SCHEDULE_PROMPT !== 'string'
  ) {
    throw new TypeError('fro-bot.yaml does not have expected shape: missing SCHEDULE_PROMPT')
  }
}

describe('fro-bot.yaml progressive improvement prompt', () => {
  // #given the fro-bot workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
  const raw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(raw)
  assertFroBotWorkflow(parsed)
  const prompt = parsed.env.SCHEDULE_PROMPT

  it('flags stalled learning proposals', () => {
    // #then category 7 names the intake, expected authoring action, thresholds,
    // and the Improvement Metrics false-green warning
    expect(prompt).toContain('open issues labeled `learning-proposal`')
    expect(prompt).toContain('authoring the learning into `docs/solutions/`')
    expect(prompt).toContain('older than 14')
    expect(prompt).toContain('two or more open at once')
    expect(prompt).toContain('Improvement Metrics report (#3674)')
  })
})
