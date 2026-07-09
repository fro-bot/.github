/**
 * Contract tests for .github/workflows/capture-patterns.yaml: dry-run default,
 * live-write token boundary, digest/body-file env wiring, and agent prompt
 * write contract. Style mirrors fro-bot-workflow-wiki-handoff.test.ts.
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
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  steps: WorkflowStep[]
  permissions?: Record<string, string>
}

function assertCapturePatternsWorkflow(value: unknown): asserts value is {
  on: {workflow_dispatch?: {inputs?: Record<string, {default?: string}>}}
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  jobs: Record<string, WorkflowJob>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('capture-patterns.yaml does not have expected shape: missing jobs object')
  }
}

describe('capture-patterns.yaml workflow contract', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/capture-patterns.yaml')
  const raw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(raw)
  assertCapturePatternsWorkflow(parsed)

  const detectJob = parsed.jobs.detect
  const openJob = parsed.jobs.open

  it('has a manual dispatch trigger with dry_run defaulting to true', () => {
    const dryRunInput = parsed.on.workflow_dispatch?.inputs?.dry_run
    expect(dryRunInput).toBeDefined()
    expect(dryRunInput?.default).toBe('true')
  })

  it('has no schedule trigger — no live scheduled writes in v1', () => {
    expect(parsed.on).not.toHaveProperty('schedule')
  })

  it('serializes runs with a dedicated concurrency group and never cancels in-progress runs', () => {
    expect(parsed.concurrency?.group).toBe('capture-patterns')
    expect(parsed.concurrency?.['cancel-in-progress']).toBe(false)
  })

  it('detect job carries only read-only permissions', () => {
    expect(detectJob).toBeDefined()
    expect(detectJob?.permissions).toEqual({contents: 'read', issues: 'read'})
  })

  it('open job carries only read-only permissions on the job token; writes come from a minted app token', () => {
    expect(openJob).toBeDefined()
    expect(openJob?.permissions).toEqual({contents: 'read', issues: 'read'})
  })

  it('the write-scoped app token is minted only for an explicit live (dry_run=false) manual dispatch', () => {
    const mintStep = openJob?.steps.find(step => step.id === 'app-token')
    expect(mintStep).toBeDefined()
    expect(mintStep?.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(mintStep?.if).toContain("github.event.inputs.dry_run == 'false'")
  })

  it('the app token is scoped to this repository only', () => {
    const mintStep = openJob?.steps.find(step => step.id === 'app-token')
    const withBlock = mintStep?.with
    expect(String(withBlock?.repositories ?? '')).toContain('github.event.repository.name')
  })

  it('the open (issue-write) step itself only runs on an explicit live dispatch', () => {
    const openStep = openJob?.steps.find(step => step.id === 'open')
    expect(openStep).toBeDefined()
    expect(openStep?.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(openStep?.if).toContain("github.event.inputs.dry_run == 'false'")
  })

  it('the agent drafting step only runs on an explicit live dispatch', () => {
    const agentStep = openJob?.steps.find(step => step.id === 'agent')
    expect(agentStep).toBeDefined()
    expect(agentStep?.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(agentStep?.if).toContain("github.event.inputs.dry_run == 'false'")
    expect(agentStep?.if).not.toContain('||')
  })

  it('the detect step writes the digest to CAPTURE_PATTERNS_DIGEST_PATH under runner.temp', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    expect(detectStep).toBeDefined()
    const digestPath = detectStep?.env?.CAPTURE_PATTERNS_DIGEST_PATH
    expect(typeof digestPath).toBe('string')
    expect(String(digestPath)).toContain('runner.temp')
  })

  it('the agent step and the open step receive the same digest path env var', () => {
    const agentStep = openJob?.steps.find(step => step.id === 'agent')
    const openStep = openJob?.steps.find(step => step.id === 'open')
    expect(agentStep).toBeDefined()
    expect(openStep).toBeDefined()

    const agentDigestPath = agentStep?.env?.CAPTURE_PATTERNS_DIGEST_PATH
    const openDigestPath = openStep?.env?.CAPTURE_PATTERNS_DIGEST_PATH
    expect(typeof agentDigestPath).toBe('string')
    expect(agentDigestPath).toBe(openDigestPath)
  })

  it('the open step wires CAPTURE_PATTERNS_BODIES_PATH and CAPTURE_PATTERNS_RESULT_PATH under runner.temp', () => {
    const openStep = openJob?.steps.find(step => step.id === 'open')
    const bodiesPath = openStep?.env?.CAPTURE_PATTERNS_BODIES_PATH
    const resultPath = openStep?.env?.CAPTURE_PATTERNS_RESULT_PATH
    expect(String(bodiesPath ?? '')).toContain('runner.temp')
    expect(String(resultPath ?? '')).toContain('runner.temp')
  })

  it('the detect step uses the read-only workflow token explicitly', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    expect(String(detectStep?.env?.GITHUB_TOKEN ?? '')).toContain('github.token')
  })

  it('the open step uses only the minted app token and does not fall back to the job token', () => {
    const openStep = openJob?.steps.find(step => step.id === 'open')
    const token = String(openStep?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
    expect(token).not.toContain('github.token')
  })

  it('the agent step uses the read-only workflow GITHUB_TOKEN, not the minted write token', () => {
    const agentStep = openJob?.steps.find(step => step.id === 'agent')
    const withBlock = agentStep?.with
    expect(String(withBlock?.['github-token'] ?? '')).toContain('github.token')
  })

  it('the agent prompt states a temp-file-only write contract and no repo-edit instruction', () => {
    const agentStep = openJob?.steps.find(step => step.id === 'agent')
    const prompt = String(agentStep?.env?.TASK_PROMPT ?? '')

    expect(prompt).toContain('capture-patterns-bodies.json')
    expect(prompt.toLowerCase()).toContain('no code edits')
    expect(prompt.toLowerCase()).toContain('never create issues yourself')
    expect(prompt.toLowerCase()).toContain('never write to any path other than')
  })

  it('the digest → open sequence depends on the detect job completing first', () => {
    expect((parsed.jobs.open as unknown as {needs?: string}).needs).toBe('detect')
  })

  it('the workflow file uses plain operator-facing vocabulary, not internal plan taxonomy', () => {
    const forbiddenPatterns = [/\bUnit \d/u, /\bU\d\b/u, /\bA1\b/u, /\bC4\b/u]
    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })

  it('never echoes digest/body file contents or the write token into logs', () => {
    const suspiciousPatterns = [
      /echo.*CAPTURE_PATTERNS_DIGEST_PATH/u,
      /cat.*CAPTURE_PATTERNS_DIGEST_PATH/u,
      /echo.*CAPTURE_PATTERNS_BODIES_PATH/u,
      /cat.*CAPTURE_PATTERNS_BODIES_PATH/u,
      /echo.*steps\.app-token\.outputs\.token/u,
    ]
    for (const pattern of suspiciousPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })
})
