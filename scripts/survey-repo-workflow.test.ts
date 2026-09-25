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

  it('survey-persist mints its own App token, distinct from the initial gate token minted in survey-repo', () => {
    const mintStep = persistJob?.steps.find(step => step.id === 'app-token')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
  })

  it('survey-repo mints no App token after its agent step (trusted-writer invariant)', () => {
    const agentIndex = surveyJob?.steps.findIndex(step => step.id === 'survey-agent') ?? -1
    expect(agentIndex).toBeGreaterThanOrEqual(0)
    const mintIndicesAfterAgent = (surveyJob?.steps ?? [])
      .slice(agentIndex + 1)
      .filter(step => (step.uses ?? '').startsWith('actions/create-github-app-token@'))
    expect(mintIndicesAfterAgent).toStrictEqual([])
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

  it('survey-repo has no visibility recheck step at all — it moved to survey-persist', () => {
    expect(surveyJob?.steps.find(step => step.name === '🔒 Recheck visibility')).toBeUndefined()
    expect(surveyJob?.steps.find(step => step.id === 'recheck-token')).toBeUndefined()
  })

  it('exposes the job outputs survey-persist depends on for gating (no recheck outputs — those are local to survey-persist now)', () => {
    const outputs = surveyJob?.outputs ?? {}
    for (const key of [
      'wiki-artifact-ready',
      'agent-conclusion',
      'resolve-outcome',
      'resolve-owner',
      'resolve-repo',
      'onboarded',
      'target-repository',
      'target-slug',
    ]) {
      expect(outputs[key], `missing job output: ${key}`).toBeDefined()
    }
    expect(outputs['recheck-conclusion']).toBeUndefined()
    expect(outputs['recheck-private']).toBeUndefined()
    expect(outputs['ts-now']).toBeUndefined()
  })
})

describe('survey-repo.yaml/survey-persist.yaml A2: trusted-job privacy recheck', () => {
  const surveyJob = workflowParsed.jobs['survey-repo']
  const persistJob = workflowParsed.jobs['survey-persist']

  it('survey-persist mints its App token, then rechecks visibility, before any sync/download/apply/commit/record/announce step', () => {
    const names = (persistJob?.steps ?? []).map(step => step.name ?? '')
    const mintIndex = names.indexOf('🔑 Mint App token for data writes')
    const recheckIndex = names.indexOf('🔒 Recheck visibility')
    const persistenceStepNames = [
      'Sync wiki from data branch',
      'Download wiki handoff artifact',
      'Validate and apply wiki handoff',
      'Commit wiki ingest to data branch',
      'Record survey result',
      '📣 Announce survey to gateway',
      'Record survey result (cancelled/timeout fallback)',
    ]

    expect(mintIndex).toBeGreaterThanOrEqual(0)
    expect(recheckIndex).toBeGreaterThan(mintIndex)
    for (const stepName of persistenceStepNames) {
      const index = names.indexOf(stepName)
      expect(index, `missing persistence step: ${stepName}`).toBeGreaterThanOrEqual(0)
      expect(index, `${stepName} must run after the trusted recheck`).toBeGreaterThan(recheckIndex)
    }
  })

  it("every persistence step gates on this job's own steps.recheck, not a needs.survey-repo recheck output", () => {
    const persistenceStepNames = [
      'Sync wiki from data branch',
      'Download wiki handoff artifact',
      'Validate and apply wiki handoff',
      'Commit wiki ingest to data branch',
      'Record survey result',
      '📣 Announce survey to gateway',
    ]
    for (const stepName of persistenceStepNames) {
      const step = persistJob?.steps.find(s => s.name === stepName)
      const condition = String(step?.if ?? '')
      expect(condition, `${stepName} if: must reference steps.recheck`).toContain('steps.recheck.')
      expect(condition, `${stepName} if: must not reference a needs.survey-repo recheck output`).not.toContain(
        'needs.survey-repo.outputs.recheck',
      )
    }
  })

  it('the recheck step uses its own dedicated recheck-token (not the data-write app-token), and REPO_PRIVATE downstream reads the local recheck output', () => {
    const recheckStep = persistJob?.steps.find(step => step.name === '🔒 Recheck visibility')
    expect(String(recheckStep?.env?.GH_TOKEN ?? '')).toContain('steps.recheck-token.outputs.token')
    expect(String(recheckStep?.env?.NODE_ID ?? '')).toContain('inputs.node_id')

    for (const stepName of ['Record survey result', 'Record survey result (cancelled/timeout fallback)']) {
      const step = persistJob?.steps.find(s => s.name === stepName)
      expect(String(step?.env?.REPO_PRIVATE ?? '')).toContain('steps.recheck.outputs.private')
    }
  })

  it("the recheck token is a dedicated mint scoped like main's pre-A2 recheck token: owner:, no repositories:/permission-contents:write", () => {
    const recheckTokenStep = persistJob?.steps.find(step => step.id === 'recheck-token')
    expect(recheckTokenStep).toBeDefined()
    expect(recheckTokenStep?.uses).toContain('actions/create-github-app-token@')
    expect(String(recheckTokenStep?.with?.owner ?? '')).toContain('github.repository_owner')
    expect(recheckTokenStep?.with?.repositories).toBeUndefined()
    expect(recheckTokenStep?.with?.['permission-contents']).toBeUndefined()
  })

  it('the recheck token is a distinct step from the repo-scoped data-write app-token', () => {
    const recheckTokenStep = persistJob?.steps.find(step => step.id === 'recheck-token')
    const dataWriteTokenStep = persistJob?.steps.find(step => step.id === 'app-token')
    expect(dataWriteTokenStep).toBeDefined()
    expect(dataWriteTokenStep?.id).not.toBe(recheckTokenStep?.id)
    expect(String(dataWriteTokenStep?.with?.repositories ?? '')).toContain('github.event.repository.name')
    expect(dataWriteTokenStep?.with?.['permission-contents']).toBe('write')
  })

  it("the recheck-token mint's if: matches the recheck step's if: (both skip when the agent step was skipped)", () => {
    const recheckTokenStep = persistJob?.steps.find(step => step.id === 'recheck-token')
    const recheckStep = persistJob?.steps.find(step => step.name === '🔒 Recheck visibility')
    expect(String(recheckTokenStep?.if ?? '')).toBe(String(recheckStep?.if ?? ''))
    expect(String(recheckStep?.if ?? '')).toContain("needs.survey-repo.outputs.agent-conclusion != 'skipped'")
  })

  it('the fallback record step also requires a successful trusted recheck (fail-closed, not just the primary record step)', () => {
    const fallbackStep = persistJob?.steps.find(
      step => step.name === 'Record survey result (cancelled/timeout fallback)',
    )
    expect(String(fallbackStep?.if ?? '')).toContain("steps.recheck.conclusion == 'success'")
  })

  it("every step in survey-persist that runs record-survey-result.ts or wiki-ingest.ts is gated on steps.recheck.conclusion == 'success' (non-vacuous)", () => {
    const writerSteps = (persistJob?.steps ?? []).filter(
      step =>
        typeof step.run === 'string' &&
        (step.run.includes('record-survey-result.ts') || step.run.includes('wiki-ingest.ts')),
    )
    // Commit wiki ingest (wiki-ingest.ts), Record survey result, and the cancelled/timeout
    // fallback (both record-survey-result.ts) = 3 writer steps.
    expect(writerSteps).toHaveLength(3)
    for (const step of writerSteps) {
      expect(String(step.if ?? ''), `${step.name} must gate on steps.recheck.conclusion == 'success'`).toContain(
        "steps.recheck.conclusion == 'success'",
      )
    }
  })

  it('WIKI_* env in the trusted commit step is sourced from needs.survey-repo pre-agent outputs and inputs.*, never metadata.json', () => {
    const commitStep = persistJob?.steps.find(step => step.name === 'Commit wiki ingest to data branch')
    const run = String(commitStep?.run ?? '')
    expect(run).not.toContain('metadata.json')
    expect(run).not.toContain('jq')

    const env = commitStep?.env ?? {}
    expect(String(env.WIKI_TARGET ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_SUMMARY ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_COMMIT_MESSAGE ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_SOURCES ?? '')).toContain('needs.survey-repo.outputs.target-repository')
    expect(String(env.WIKI_SOURCES ?? '')).toContain('steps.ts.outputs.now')
    expect(String(env.REPO_NODE_ID ?? '')).toContain('inputs.node_id')
  })

  it('survey-repo builds the artifact without recheck gating (privacy is enforced entirely in survey-persist now)', () => {
    const buildStep = surveyJob?.steps.find(step => step.name === 'Build wiki handoff artifact')
    const condition = String(buildStep?.if ?? '')
    expect(condition).toContain("steps.wiki-changes.outputs.changed == 'true'")
    expect(condition).toContain("steps.onboarded.outputs.onboarded == 'true'")
    expect(condition).not.toContain('recheck')
    expect(Object.keys(buildStep?.env ?? {}).sort()).toStrictEqual(['WIKI_HANDOFF_BASELINE_PATH', 'WIKI_HANDOFF_DIR'])
    expect(String(buildStep?.env?.WIKI_HANDOFF_DIR ?? '')).toContain('runner.temp')
  })

  it('survey-repo captures a wiki content baseline before the agent step, wired to the build step', () => {
    const steps = surveyJob?.steps ?? []
    const baselineIndex = steps.findIndex(step => step.name === 'Capture wiki content baseline')
    const agentIndex = steps.findIndex(step => step.id === 'survey-agent')
    const buildIndex = steps.findIndex(step => step.name === 'Build wiki handoff artifact')

    expect(baselineIndex).toBeGreaterThanOrEqual(0)
    expect(agentIndex).toBeGreaterThan(baselineIndex)
    expect(buildIndex).toBeGreaterThan(agentIndex)

    const baselineStep = steps[baselineIndex]
    const buildStep = steps[buildIndex]
    expect(String(baselineStep?.run ?? '')).toContain('wiki-handoff-baseline.ts')
    expect(baselineStep?.env?.WIKI_HANDOFF_BASELINE_PATH).toBe(buildStep?.env?.WIKI_HANDOFF_BASELINE_PATH)
  })

  it("survey-repo's upload step requires the build step's own non-empty-manifest signal, not just success", () => {
    const uploadStep = surveyJob?.steps.find(step => step.name === 'Upload wiki handoff artifact')
    const condition = String(uploadStep?.if ?? '')
    expect(condition).toContain("steps.wiki-handoff-build.outcome == 'success'")
    expect(condition).toContain("steps.wiki-handoff-build.outputs.changed == 'true'")
  })
})
