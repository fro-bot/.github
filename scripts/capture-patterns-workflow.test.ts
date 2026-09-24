/**
 * Contract tests for .github/workflows/capture-patterns.yaml: dry-run default,
 * live-write token boundary, digest/body-file env wiring, and agent prompt
 * write contract. Style mirrors fro-bot-workflow-wiki-handoff.test.ts.
 *
 * The `open` job (agent, drafts proposal bodies) and `open-publish` job (trusted,
 * mints the write token and opens issues) are split so a prompt-injected agent
 * never shares a runner with a freshly-minted `issues: write` App token — see
 * scripts/agent-token-mint-order-guard.test.ts for the repo-wide invariant.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  uses?: string
  if?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  steps: WorkflowStep[]
  permissions?: Record<string, string>
  needs?: string | string[]
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
  const publishJob = parsed.jobs['open-publish']

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

  it('open (draft) job carries only read-only contents permission and mints no App token', () => {
    expect(openJob).toBeDefined()
    expect(openJob?.permissions).toEqual({contents: 'read'})
    expect(
      openJob?.steps.find(step => (step.uses ?? '').startsWith('actions/create-github-app-token@')),
    ).toBeUndefined()
  })

  it('open-publish job carries only read-only contents permission on the job token; writes come from the minted app token', () => {
    expect(publishJob).toBeDefined()
    expect(publishJob?.permissions).toEqual({contents: 'read'})
  })

  it('open-publish has no fro-bot/agent step (trusted-writer invariant)', () => {
    expect(publishJob?.steps.find(step => (step.uses ?? '').startsWith('fro-bot/agent@'))).toBeUndefined()
  })

  it('open-publish checks out the default branch with persist-credentials: false', () => {
    const checkoutStep = publishJob?.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it('the open (draft) job is skipped entirely on dry-run — the job-level `if` requires an explicit live dispatch', () => {
    const openJobRaw = (parsed.jobs.open as unknown as {if?: string}).if
    expect(openJobRaw).toBeDefined()
    expect(String(openJobRaw)).toContain("github.event_name == 'workflow_dispatch'")
    expect(String(openJobRaw)).toContain("github.event.inputs.dry_run == 'false'")
  })

  it('the open-publish job is skipped entirely on dry-run — the job-level `if` requires an explicit live dispatch', () => {
    const publishJobRaw = (parsed.jobs['open-publish'] as unknown as {if?: string}).if
    expect(publishJobRaw).toBeDefined()
    expect(String(publishJobRaw)).toContain("github.event_name == 'workflow_dispatch'")
    expect(String(publishJobRaw)).toContain("github.event.inputs.dry_run == 'false'")
  })

  it('the write-scoped app token is minted in open-publish (unconditionally within that already-gated job)', () => {
    const mintStep = publishJob?.steps.find(step => step.id === 'app-token')
    expect(mintStep).toBeDefined()
  })

  it('the app token is scoped to this repository only', () => {
    const mintStep = publishJob?.steps.find(step => step.id === 'app-token')
    const withBlock = mintStep?.with
    expect(String(withBlock?.repositories ?? '')).toContain('github.event.repository.name')
  })

  it('the open (issue-write) step lives in open-publish and requires no additional if — the job-level if already gates it', () => {
    const openStep = publishJob?.steps.find(step => step.id === 'open')
    expect(openStep).toBeDefined()
  })

  it('the agent drafting step only runs on an explicit live dispatch (redundant with, but independent of, the job-level if)', () => {
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
    const openStep = publishJob?.steps.find(step => step.id === 'open')
    expect(agentStep).toBeDefined()
    expect(openStep).toBeDefined()

    const agentDigestPath = agentStep?.env?.CAPTURE_PATTERNS_DIGEST_PATH
    const openDigestPath = openStep?.env?.CAPTURE_PATTERNS_DIGEST_PATH
    expect(typeof agentDigestPath).toBe('string')
    expect(agentDigestPath).toBe(openDigestPath)
  })

  it('the open step wires CAPTURE_PATTERNS_BODIES_PATH and CAPTURE_PATTERNS_RESULT_PATH under runner.temp', () => {
    const openStep = publishJob?.steps.find(step => step.id === 'open')
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
    const openStep = publishJob?.steps.find(step => step.id === 'open')
    const token = String(openStep?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
    expect(token).not.toContain('github.token')
  })

  it('the agent step uses the read-only workflow GITHUB_TOKEN, not any write token', () => {
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
    expect((parsed.jobs['open-publish'] as unknown as {needs?: string[]}).needs).toStrictEqual(['detect', 'open'])
  })

  it('the workflow file uses plain operator-facing vocabulary, not internal plan taxonomy', () => {
    const forbiddenPatterns = [/\bUnit \d/u, /\bU\d\b/u, /\bA1\b/u, /\bC4\b/u]
    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })

  it('the detect and open node|tee pipelines run under pipefail so a node failure fails the step', () => {
    const detectStep = detectJob?.steps.find(step => step.id === 'detect')
    const openStep = publishJob?.steps.find(step => step.id === 'open')
    expect(String(detectStep?.run ?? '')).toContain('| tee')
    expect(String((detectStep as WorkflowStep & {shell?: string})?.shell ?? '')).toContain('pipefail')
    expect(String(openStep?.run ?? '')).toContain('| tee')
    expect(String((openStep as WorkflowStep & {shell?: string})?.shell ?? '')).toContain('pipefail')
  })

  it('the digest artifact retains for 1 day, not the default longer window', () => {
    const uploadStep = detectJob?.steps.find(
      step => typeof step.name === 'string' && step.name.includes('Upload digest artifact'),
    )
    expect(uploadStep?.with?.['retention-days']).toBe(1)
  })

  it('the bodies artifact also retains for 1 day and tolerates a missing file (agent produced nothing)', () => {
    const uploadStep = openJob?.steps.find(
      step => typeof step.name === 'string' && step.name.includes('Upload bodies artifact'),
    )
    expect(uploadStep?.with?.['retention-days']).toBe(1)
    expect(uploadStep?.with?.['if-no-files-found']).toBe('warn')
  })

  it('the detect summary reports candidate quality suppression separately from low-signal skips', () => {
    expect(raw).toContain('Quality-suppressed')
    expect(raw).toContain('.qualitySuppressed // 0')
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
