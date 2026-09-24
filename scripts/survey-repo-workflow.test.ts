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
  if?: string
}

interface WorkflowJob {
  steps: WorkflowStep[]
  needs?: string
  if?: string
  permissions?: Record<string, string>
  outputs?: Record<string, string>
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
    expect(run).toContain('exit "$status"')
  })

  it('passes the correction context through the agent prompt contract', () => {
    const agentStep = steps.find(step => step.name === 'Run Fro Bot survey ingest')
    const prompt = String(agentStep?.with?.prompt ?? '')

    expect(prompt).toContain('corrections-data')
    expect(prompt).toContain('data to preserve')
    expect(prompt).toContain('not instructions')
    expect(prompt).toContain('.github/corrections-context.json')
  })

  it('surfaces ingest findings in the survey-persist job step summary', () => {
    const persistSteps = workflowParsed.jobs['survey-persist']?.steps ?? []
    const commitStep = persistSteps.find(step => step.name === 'Commit wiki ingest to data branch')
    const run = commitStep?.run ?? ''

    expect(run).toContain("grep '^wiki-ingest:finding:'")
    expect(run).toContain("echo '### Wiki ingest findings'")
  })

  it('delegates wiki sync to the hardened composite action (regression guard against per-job drift)', () => {
    const syncStep = steps.find(step => step.name === 'Sync wiki from data branch')
    expect(syncStep?.uses).toBe('./.github/actions/sync-wiki')
  })

  it('Sync wiki from data branch precedes Capture wiki baseline (baseline must hash post-sync content)', () => {
    const names = steps.map(step => step.name ?? '')
    const syncIndex = names.indexOf('Sync wiki from data branch')
    const baselineIndex = names.indexOf('Capture wiki baseline')

    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(baselineIndex).toBeGreaterThan(syncIndex)
  })
})

describe('survey-repo.yaml App-token persistence migration', () => {
  const surveyJob = workflowParsed.jobs['survey-repo']
  const persistJob = workflowParsed.jobs['survey-persist']

  it('declares survey-persist needing survey-repo, running with if: always()', () => {
    expect(persistJob).toBeDefined()
    expect(persistJob?.needs).toBe('survey-repo')
    expect(String(persistJob?.if ?? '')).toContain('always()')
  })

  it('survey-persist has no fro-bot/agent step (trusted-writer invariant)', () => {
    const agentStep = persistJob?.steps.find(step => (step.uses ?? '').startsWith('fro-bot/agent@'))
    expect(agentStep).toBeUndefined()
  })

  it('survey-persist checks out the default branch with persist-credentials: false', () => {
    const checkoutStep = persistJob?.steps.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it('survey-persist mints its own App token, distinct from the recheck/gate tokens minted in survey-repo', () => {
    const mintStep = persistJob?.steps.find(step => step.id === 'app-token')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
  })

  it.each([
    'Commit wiki ingest to data branch',
    'Record survey result',
    'Record survey result (cancelled/timeout fallback)',
  ])('%s uses the minted App token, never FRO_BOT_PAT', stepName => {
    const step = persistJob?.steps.find(s => s.name === stepName)
    const token = String(step?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
  })

  it('survey-repo builds a wiki handoff artifact instead of committing to data directly', () => {
    const buildStep = surveyJob?.steps.find(step => step.name === 'Build wiki handoff artifact')
    const uploadStep = surveyJob?.steps.find(step => step.name === 'Upload wiki handoff artifact')
    expect(buildStep?.run).toBe('node scripts/wiki-handoff-build.ts')
    expect(uploadStep?.uses).toContain('actions/upload-artifact@')
    expect(surveyJob?.steps.find(step => step.name === 'Commit wiki ingest to data branch')).toBeUndefined()
  })

  it('survey-repo has no record-survey-result.ts invocation left (moved to survey-persist)', () => {
    const leftoverStep = surveyJob?.steps.find(
      step => typeof step.run === 'string' && step.run.includes('record-survey-result.ts'),
    )
    expect(leftoverStep).toBeUndefined()
  })

  it('preserves visibility-recheck-before-persistence ordering: recheck runs in survey-repo, gates the handoff build', () => {
    const names = (surveyJob?.steps ?? []).map(step => step.name ?? '')
    const recheckIndex = names.indexOf('🔒 Recheck visibility')
    const buildIndex = names.indexOf('Build wiki handoff artifact')

    expect(recheckIndex).toBeGreaterThanOrEqual(0)
    expect(buildIndex).toBeGreaterThan(recheckIndex)

    const buildStep = surveyJob?.steps.find(step => step.name === 'Build wiki handoff artifact')
    expect(String(buildStep?.if ?? '')).toContain("steps.recheck.conclusion == 'success'")
  })

  it('exposes the job outputs survey-persist depends on for gating', () => {
    const outputs = surveyJob?.outputs ?? {}
    for (const key of [
      'wiki-artifact-ready',
      'agent-conclusion',
      'recheck-conclusion',
      'recheck-private',
      'resolve-outcome',
      'resolve-owner',
      'resolve-repo',
      'onboarded',
      'target-repository',
      'target-slug',
    ]) {
      expect(outputs[key], `missing job output: ${key}`).toBeDefined()
    }
  })
})
