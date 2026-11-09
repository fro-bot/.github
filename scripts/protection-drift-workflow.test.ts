import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface Step {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
  if?: string
  'continue-on-error'?: boolean
}

interface Job {
  name?: string
  needs?: unknown
  if?: string
  'timeout-minutes'?: number
  permissions?: Record<string, string>
  env?: unknown
  steps: Step[]
}

function assertDriftWorkflow(value: unknown): asserts value is {
  name: string
  on: Record<string, {types?: string[]} | null>
  permissions?: Record<string, string>
  concurrency?: unknown
  jobs: Record<string, Job>
} {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('protection-drift.yaml does not have expected shape')
  }
  const record = value as Record<string, unknown>
  if (typeof record.on !== 'object' || record.on === null || typeof record.jobs !== 'object' || record.jobs === null) {
    throw new TypeError('protection-drift.yaml does not have expected shape')
  }
}

const expressionStart = '$' + '{{'
const raw = readFileSync(resolve(import.meta.dirname, '../.github/workflows/protection-drift.yaml'), 'utf8')
const parsed: unknown = parse(raw)
assertDriftWorkflow(parsed)
const job = parsed.jobs.report
if (job === undefined) throw new TypeError('protection-drift.yaml must define the report job')

describe('protection-drift.yaml', () => {
  it('runs on every branch_protection_rule event for created, edited and deleted, and on nothing else', () => {
    expect(Object.keys(parsed.on)).toEqual(['branch_protection_rule'])
    expect(parsed.on.branch_protection_rule?.types).toEqual(['created', 'edited', 'deleted'])
  })

  it('has the one report job, with contents read and issues write and nothing more', () => {
    expect(Object.keys(parsed.jobs)).toEqual(['report'])
    expect(parsed.permissions).toEqual({contents: 'read'})
    expect(job.permissions).toEqual({contents: 'read', issues: 'write'})
    expect(job['timeout-minutes']).toBe(10)
    expect(job.needs).toBeUndefined()
    expect(job.if).toBeUndefined()
  })

  it('has no concurrency group, so a burst of events cannot replace a pending run', () => {
    expect(parsed.concurrency).toBeUndefined()
    expect(job).not.toHaveProperty('concurrency')
    expect(raw).not.toMatch(/^\s*concurrency:/mu)
    expect(raw).not.toContain('cancel-in-progress')
  })

  it('uses no secret, no variable, no App token and no job env', () => {
    expect(raw).not.toContain('secrets.')
    expect(raw).not.toContain('vars.')
    expect(raw).not.toContain('create-github-app-token')
    expect(raw).not.toContain('FRO_BOT')
    expect(raw).not.toContain('client_payload')
    expect(job.env).toBeUndefined()
  })

  it('checks out the default branch, sets up, and runs the report with the workflow token', () => {
    expect(job.steps.map(step => step.name)).toEqual(['⤵ Checkout Branch', '📦 Setup', '🚨 Report protection drift'])
    expect(job.steps[0]?.uses?.startsWith('actions/checkout@')).toBe(true)
    expect(job.steps[0]?.with).toBeUndefined()
    expect(job.steps[1]?.uses).toBe('./.github/actions/setup')
    expect(job.steps[2]?.run).toBe('bun scripts/protection-drift.ts')
    expect(job.steps[2]?.env).toEqual({GITHUB_TOKEN: `${expressionStart} github.token }}`})
  })

  it('lets nothing neuter the report step', () => {
    for (const step of job.steps) {
      expect(step.if).toBeUndefined()
      expect(step['continue-on-error']).toBeUndefined()
    }
  })

  it('pins every action to a commit SHA', () => {
    for (const step of job.steps) {
      if (step.uses === undefined || step.uses.startsWith('./')) continue
      expect(step.uses).toMatch(/@[0-9a-f]{40}(?: |$)/u)
    }
  })
})
