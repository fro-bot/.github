/**
 * Contract tests for .github/workflows/capture-learnings.yaml: the capture-learnings
 * (draft) job and capture-learnings-publish (trusted) job are split so a prompt-injected
 * agent never shares a runner with the App token that opens learning-proposal issues —
 * see scripts/agent-post-step-credential-guard.test.ts for the repo-wide invariant.
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
  needs?: string
  permissions?: Record<string, string>
}

function assertWorkflowShape(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/capture-learnings.yaml')
const raw = readFileSync(workflowPath, 'utf8')
const parsed: unknown = parse(raw)
assertWorkflowShape(parsed)

describe('capture-learnings.yaml harvest/draft/publish split', () => {
  const harvestJob = parsed.jobs['capture-learnings-harvest']
  const draftJob = parsed.jobs['capture-learnings']
  const publishJob = parsed.jobs['capture-learnings-publish']

  it('declares all three jobs: harvest -> draft -> publish', () => {
    expect(harvestJob).toBeDefined()
    expect(draftJob).toBeDefined()
    expect(publishJob).toBeDefined()
    expect(draftJob?.needs).toBe('capture-learnings-harvest')
    expect(publishJob?.needs).toBe('capture-learnings')
  })

  it('the harvest job (no agent step) mints no App token; the draft (agent) job mints no App token at all', () => {
    expect(harvestJob?.steps.find(step => (step.uses ?? '').startsWith('fro-bot/agent@'))).toBeUndefined()
    expect(
      harvestJob?.steps.find(step => (step.uses ?? '').startsWith('actions/create-github-app-token@')),
    ).toBeUndefined()

    const agentIndex = draftJob?.steps.findIndex(step => (step.uses ?? '').startsWith('fro-bot/agent@')) ?? -1
    expect(agentIndex).toBeGreaterThanOrEqual(0)
    expect(
      draftJob?.steps.find(step => (step.uses ?? '').startsWith('actions/create-github-app-token@')),
    ).toBeUndefined()
  })

  it('the harvest job uses the workflow GITHUB_TOKEN, scoped by its own permissions block, to call scripts/capture-learnings-harvest.ts', () => {
    const harvestStep = harvestJob?.steps.find(step => step.id === 'harvest')
    expect(String(harvestStep?.env?.GITHUB_TOKEN ?? '')).toContain('secrets.GITHUB_TOKEN')
    expect(harvestStep?.run).toContain('scripts/capture-learnings-harvest.ts')
    expect(harvestJob?.permissions).toStrictEqual({
      contents: 'read',
      actions: 'read',
      'pull-requests': 'read',
      issues: 'read',
    })
  })

  it('the harvest job uploads the digest artifact; the draft job downloads it and uploads only the bodies artifact', () => {
    expect(harvestJob?.steps.find(step => step.name === '📤 Upload digest artifact')).toBeDefined()
    expect(draftJob?.steps.find(step => step.name === '📥 Download digest artifact')).toBeDefined()
    expect(draftJob?.steps.find(step => step.name === '📤 Upload digest artifact')).toBeUndefined()

    const bodiesUpload = draftJob?.steps.find(step => step.name === '📤 Upload bodies artifact')
    expect(bodiesUpload).toBeDefined()
    expect(bodiesUpload?.with?.['if-no-files-found']).toBe('warn')
    expect(draftJob?.steps.find(step => step.name === '📬 Open learning-proposal issues')).toBeUndefined()
  })

  it('publish job has no fro-bot/agent step (trusted-writer invariant)', () => {
    expect(publishJob?.steps.find(step => (step.uses ?? '').startsWith('fro-bot/agent@'))).toBeUndefined()
  })

  it('publish job checks out the default branch with persist-credentials: false', () => {
    const checkoutStep = publishJob?.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it('publish job downloads both artifacts, tolerating a missing bodies artifact', () => {
    const digestDownload = publishJob?.steps.find(step => step.name === '📥 Download digest artifact')
    const bodiesDownload = publishJob?.steps.find(step => step.name === '📥 Download bodies artifact')
    expect(digestDownload?.with?.name).toBe('capture-learnings-digest')
    expect(bodiesDownload?.with?.name).toBe('capture-learnings-bodies')
    expect((bodiesDownload as WorkflowStep & {'continue-on-error'?: boolean})?.['continue-on-error']).toBe(true)
  })

  it('publish job mints its own App token and uses it for the open step, not any token from the draft job', () => {
    const mintStep = publishJob?.steps.find(step => step.id === 'get-workflow-app-token')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
    const openStep = publishJob?.steps.find(step => step.id === 'open')
    expect(String(openStep?.env?.GITHUB_TOKEN ?? '')).toContain('steps.get-workflow-app-token.outputs.token')
  })

  it('publish job overlays metadata from the data branch before the privacy-gated open step', () => {
    const overlayIndex = publishJob?.steps.findIndex(step => step.name === '⤵ Overlay metadata from data branch') ?? -1
    const openIndex = publishJob?.steps.findIndex(step => step.id === 'open') ?? -1
    expect(overlayIndex).toBeGreaterThanOrEqual(0)
    expect(openIndex).toBeGreaterThan(overlayIndex)
  })

  it('the agent step uses the read-only workflow GITHUB_TOKEN, never a write token', () => {
    const agentStep = draftJob?.steps.find(step => step.id === 'agent')
    expect(String(agentStep?.with?.['github-token'] ?? '')).toContain('secrets.GITHUB_TOKEN')
  })

  it('the agent prompt states a temp-file-only write contract and no repo-edit instruction', () => {
    const agentStep = draftJob?.steps.find(step => step.id === 'agent')
    const prompt = String(agentStep?.env?.TASK_PROMPT ?? '')
    expect(prompt).toContain('capture-learnings-bodies.json')
    expect(prompt.toLowerCase()).toContain('never create issues yourself')
    expect(prompt.toLowerCase()).toContain('never write to any path other than')
  })
})
