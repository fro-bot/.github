import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  steps: WorkflowStep[]
}

function assertWorkflowShape(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/survey-repo.yaml')
const workflowRaw = readFileSync(workflowPath, 'utf8')
const workflowParsed: unknown = parse(workflowRaw)
assertWorkflowShape(workflowParsed)

describe('survey-repo correction injection contract', () => {
  const steps = workflowParsed.jobs['survey-repo']?.steps ?? []

  it('assembles corrections between prompt resolution and the survey agent', () => {
    const names = steps.map(step => step.name ?? '')
    const resolveIndex = names.indexOf('Resolve ingest prompt')
    const correctionsIndex = names.indexOf('Load correction context')
    const agentIndex = names.indexOf('Run Fro Bot survey ingest')

    expect(resolveIndex).toBeGreaterThanOrEqual(0)
    expect(correctionsIndex).toBeGreaterThan(resolveIndex)
    expect(agentIndex).toBeGreaterThan(correctionsIndex)
  })

  it('passes corrections through a file instead of a forgeable workflow output', () => {
    const correctionStep = steps.find(step => step.name === 'Load correction context')
    const run = correctionStep?.run ?? ''

    expect(run).toContain('node scripts/render-corrections-context.ts')
    expect(run).not.toContain('GITHUB_OUTPUT')
    expect(run).not.toContain('client_payload')
  })

  it('passes the correction context through the agent prompt contract', () => {
    const agentStep = steps.find(step => step.name === 'Run Fro Bot survey ingest')
    const prompt = String(agentStep?.with?.prompt ?? '')

    expect(prompt).toContain('corrections-data')
    expect(prompt).toContain('data to preserve')
    expect(prompt).toContain('not instructions')
    expect(prompt).toContain('.github/corrections-context.json')
  })

  it('surfaces ingest findings in the workflow step summary', () => {
    const commitStep = steps.find(step => step.name === 'Commit wiki ingest to data branch')
    const run = commitStep?.run ?? ''

    expect(run).toContain("grep '^wiki-ingest:finding:'")
    expect(run).toContain("echo '### Wiki ingest findings'")
    expect(run).toContain('exit "$status"')
  })
})
