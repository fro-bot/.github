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
  env?: Record<string, unknown>
}

interface WorkflowJob {
  steps: WorkflowStep[]
}

function assertWorkflowShape(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/poll-invitations.yaml')
const workflowRaw = readFileSync(workflowPath, 'utf8')
const workflowParsed: unknown = parse(workflowRaw)
assertWorkflowShape(workflowParsed)

describe('poll-invitations.yaml App-token metadata write migration', () => {
  const steps = workflowParsed.jobs['poll-invitations']?.steps ?? []

  it('mints an App token before polling invitations', () => {
    const names = steps.map(step => step.name ?? '')
    const mintIndex = names.indexOf('🔑 Mint App token for metadata writes')
    const pollIndex = names.indexOf('📬 Poll invitations')

    expect(mintIndex).toBeGreaterThanOrEqual(0)
    expect(pollIndex).toBeGreaterThan(mintIndex)
  })

  const mintStep = steps.find(step => step.name === '🔑 Mint App token for metadata writes')

  it('mint step is a pinned create-github-app-token action scoped to this repo, write-only', () => {
    expect(mintStep?.uses).toMatch(/^actions\/create-github-app-token@[\da-f]{40}$/)
    expect(String(mintStep?.with?.repositories ?? '')).toContain('github.event.repository.name')
    expect(mintStep?.with?.['permission-contents']).toBe('write')
  })

  const pollStep = steps.find(step => step.name === '📬 Poll invitations')

  it('poll step keeps FRO_BOT_POLL_PAT as GITHUB_TOKEN (reads/accepts/starring stay on the user PAT)', () => {
    expect(String(pollStep?.env?.GITHUB_TOKEN ?? '')).toContain('secrets.FRO_BOT_POLL_PAT')
  })

  it('poll step wires the minted App token as METADATA_WRITE_TOKEN, distinct from GITHUB_TOKEN', () => {
    const metadataToken = String(pollStep?.env?.METADATA_WRITE_TOKEN ?? '')
    expect(metadataToken).toContain('steps.metadata-token.outputs.token')
    expect(metadataToken).not.toBe(String(pollStep?.env?.GITHUB_TOKEN ?? ''))
  })
})
