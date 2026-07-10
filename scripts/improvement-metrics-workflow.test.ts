/**
 * Contract tests for .github/workflows/improvement-metrics.yaml: dry-run
 * default, live-write token boundary, digest env wiring, full-history
 * checkout, and no-agent-step perimeter. Style mirrors
 * capture-patterns-workflow.test.ts.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  steps: WorkflowStep[]
  permissions?: Record<string, string>
  needs?: string
  if?: string
}

function assertImprovementMetricsWorkflow(value: unknown): asserts value is {
  on: {workflow_dispatch?: {inputs?: Record<string, {default?: string}>}; schedule?: unknown}
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  'run-name'?: string
  jobs: Record<string, WorkflowJob>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('improvement-metrics.yaml does not have expected shape: missing jobs object')
  }
}

describe('improvement-metrics.yaml workflow contract', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/improvement-metrics.yaml')
  const raw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(raw)
  assertImprovementMetricsWorkflow(parsed)

  const detectJob = parsed.jobs.detect
  const reportJob = parsed.jobs.report

  it('has a manual dispatch trigger with dry_run defaulting to true', () => {
    const dryRunInput = parsed.on.workflow_dispatch?.inputs?.dry_run
    expect(dryRunInput).toBeDefined()
    expect(dryRunInput?.default).toBe('true')
  })

  it('has no schedule trigger — manual dispatch only', () => {
    expect(parsed.on).not.toHaveProperty('schedule')
  })

  it('serializes runs with a static concurrency group and never cancels in-progress runs', () => {
    expect(parsed.concurrency?.group).toBe('improvement-metrics')
    expect(parsed.concurrency?.['cancel-in-progress']).toBe(false)
    expect(String(parsed.concurrency?.group ?? '')).not.toContain('${{')
  })

  it('does not interpolate inputs into run-name', () => {
    const runName = parsed['run-name']
    if (runName !== undefined) {
      expect(String(runName)).not.toContain('${{')
    }
  })

  it('detect job carries only read-only permissions', () => {
    expect(detectJob).toBeDefined()
    expect(detectJob?.permissions).toEqual({contents: 'read', issues: 'read'})
  })

  it('report job carries only read-only contents permission on the job token', () => {
    expect(reportJob).toBeDefined()
    expect(reportJob?.permissions).toEqual({contents: 'read'})
  })

  it('the report job itself is skipped entirely on dry-run — the job-level `if` requires an explicit live dispatch', () => {
    expect(reportJob?.if).toBeDefined()
    expect(String(reportJob?.if)).toContain("github.event_name == 'workflow_dispatch'")
    expect(String(reportJob?.if)).toContain("github.event.inputs.dry_run == 'false'")
  })

  it('the write-scoped app token is minted only for an explicit live (dry_run=false) manual dispatch', () => {
    const mintStep = reportJob?.steps.find(step => step.id === 'app-token')
    expect(mintStep).toBeDefined()
    expect(mintStep?.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(mintStep?.if).toContain("github.event.inputs.dry_run == 'false'")
  })

  it('the app token is scoped to this repository only, with issues:write', () => {
    const mintStep = reportJob?.steps.find(step => step.id === 'app-token')
    const withBlock = mintStep?.with
    expect(String(withBlock?.repositories ?? '')).toContain('github.event.repository.name')
    expect(withBlock?.['permission-issues']).toBe('write')
  })

  it('the detect checkout step uses fetch-depth: 0 for full git history', () => {
    const checkoutStep = detectJob?.steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(checkoutStep).toBeDefined()
    expect(checkoutStep?.with?.['fetch-depth']).toBe(0)
  })

  it('the detect step uses the read-only workflow token explicitly, not the minted app token', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    const token = String(detectStep?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('github.token')
    expect(token).not.toContain('steps.app-token')
  })

  it('the report step uses only the minted app token and does not fall back to the job token', () => {
    const reportStep = reportJob?.steps.find(step => step.id === 'report')
    const token = String(reportStep?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
    expect(token).not.toContain('github.token')
  })

  it('the detect step writes the digest to IMPROVEMENT_METRICS_DIGEST_PATH under runner.temp', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    const digestPath = detectStep?.env?.IMPROVEMENT_METRICS_DIGEST_PATH
    expect(typeof digestPath).toBe('string')
    expect(String(digestPath)).toContain('runner.temp')
  })

  it('the detect and report steps reference the same IMPROVEMENT_METRICS_DIGEST_PATH', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    const reportStep = reportJob?.steps.find(step => step.id === 'report')
    expect(detectStep?.env?.IMPROVEMENT_METRICS_DIGEST_PATH).toBe(reportStep?.env?.IMPROVEMENT_METRICS_DIGEST_PATH)
  })

  it('the report step wires IMPROVEMENT_METRICS_RESULT_PATH under runner.temp', () => {
    const reportStep = reportJob?.steps.find(step => step.id === 'report')
    const resultPath = reportStep?.env?.IMPROVEMENT_METRICS_RESULT_PATH
    expect(String(resultPath ?? '')).toContain('runner.temp')
  })

  it('the digest -> report sequence depends on the detect job completing first', () => {
    expect(reportJob?.needs).toBe('detect')
  })

  it('the report job has no agent step — the report is fully deterministic', () => {
    const agentStep = reportJob?.steps.find(
      step => step.id === 'agent' || (typeof step.uses === 'string' && step.uses.includes('fro-bot/agent')),
    )
    expect(agentStep).toBeUndefined()
  })

  it('the report node|tee pipeline runs under pipefail so a node failure fails the step', () => {
    const reportStep = reportJob?.steps.find(step => step.id === 'report')
    expect(String(reportStep?.run ?? '')).toContain('| tee')
    expect(String((reportStep as WorkflowStep & {shell?: string})?.shell ?? '')).toContain('pipefail')
  })

  it('the detect step runs under pipefail without a shell', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    expect(String((detectStep as WorkflowStep & {shell?: string})?.shell ?? '')).toContain('pipefail')
  })

  it('the detect step does NOT tee stdout over its own IMPROVEMENT_METRICS_DIGEST_PATH — stdout is a different, flatter shape than the file the script writes, and tee would clobber the file after the write (regression guard for the detect/report wiring defect)', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    const run = String(detectStep?.run ?? '')
    expect(run).not.toContain('tee')
    expect(run.trim()).toBe('node scripts/improvement-metrics-detect.ts')
  })

  it('the digest artifact retains for 1 day, not the default longer window', () => {
    const uploadStep = detectJob?.steps.find(
      step => typeof step.name === 'string' && step.name.includes('Upload digest artifact'),
    ) as (WorkflowStep & {with?: {'retention-days'?: number}}) | undefined
    expect(uploadStep?.with?.['retention-days']).toBe(1)
  })

  it('the workflow file uses plain operator-facing vocabulary, not internal plan taxonomy', () => {
    const forbiddenPatterns = [/\bUnit \d/u, /\bU\d\b/u, /\bO8\b/u, /\bA1\b/u, /\bC4\b/u]
    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })

  it('never echoes digest file contents or the write token into logs', () => {
    const suspiciousPatterns = [
      /echo.*IMPROVEMENT_METRICS_DIGEST_PATH/u,
      /cat.*IMPROVEMENT_METRICS_DIGEST_PATH/u,
      /echo.*steps\.app-token\.outputs\.token/u,
    ]
    for (const pattern of suspiciousPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })
})
