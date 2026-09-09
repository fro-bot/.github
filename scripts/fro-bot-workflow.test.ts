/**
 * Contract tests for .github/workflows/fro-bot.yaml's daily-pass delivery-mode
 * split: the schedule/workflow_dispatch path runs as two jobs
 * (fro-bot-remediate: categories 1–4, branch-pr; fro-bot-observe: categories
 * 5–8 + daily report, working-dir), a custom prompt resolves to exactly one
 * of them, and the reusable-workflow callers (apply-branding.yaml,
 * gateway-rollout-tracker.yaml) declare the output-mode they need. Style
 * mirrors publish-wiki-workflow.test.ts.
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
  name?: string
  steps?: WorkflowStep[]
  needs?: string | string[]
  if?: string
  with?: Record<string, unknown>
}

interface WorkflowInput {
  description?: string
  required?: boolean
  type?: string
  default?: unknown
  options?: string[]
}

function assertWorkflowShape(value: unknown): asserts value is {
  on: Record<string, unknown>
  env?: Record<string, unknown>
  jobs: Record<string, WorkflowJob>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('workflow file does not have expected shape: missing jobs object')
  }
}

const froBotPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
const froBotRaw = readFileSync(froBotPath, 'utf8')
const froBotParsed: unknown = parse(froBotRaw)
assertWorkflowShape(froBotParsed)

const applyBrandingPath = resolve(import.meta.dirname, '../.github/workflows/apply-branding.yaml')
const applyBrandingParsed: unknown = parse(readFileSync(applyBrandingPath, 'utf8'))
assertWorkflowShape(applyBrandingParsed)

const gatewayTrackerPath = resolve(import.meta.dirname, '../.github/workflows/gateway-rollout-tracker.yaml')
const gatewayTrackerParsed: unknown = parse(readFileSync(gatewayTrackerPath, 'utf8'))
assertWorkflowShape(gatewayTrackerParsed)

function findStepIndex(job: WorkflowJob | undefined, predicate: (step: WorkflowStep) => boolean): number {
  return (job?.steps ?? []).findIndex(predicate)
}

describe('fro-bot.yaml daily-pass job split', () => {
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const contentJob = froBotParsed.jobs['fro-bot']

  it('defines fro-bot-remediate and fro-bot-observe alongside the unchanged content-trigger job', () => {
    expect(contentJob).toBeDefined()
    expect(remediateJob).toBeDefined()
    expect(observeJob).toBeDefined()
  })

  it('fro-bot-remediate sets output-mode: branch-pr on the agent step', () => {
    const agentStep = remediateJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.['output-mode']).toBe('branch-pr')
  })

  it('fro-bot-observe sets output-mode: working-dir on the agent step', () => {
    const agentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.['output-mode']).toBe('working-dir')
  })

  it('the content-trigger job does not set an output-mode (unaffected by the split)', () => {
    const agentStep = contentJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.['output-mode']).toBeUndefined()
  })

  it('fro-bot-observe declares needs: fro-bot-remediate', () => {
    expect(observeJob?.needs).toBe('fro-bot-remediate')
  })

  it('content-trigger job if: still excludes schedule and workflow_dispatch (unchanged path)', () => {
    const contentIf = String(contentJob?.if ?? '')
    expect(contentIf).not.toContain("github.event_name == 'schedule'")
    expect(contentIf).not.toContain("github.event_name == 'workflow_dispatch'")
  })
})

describe('fro-bot.yaml wiki baseline/detect/ingest ordering', () => {
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']

  it('within fro-bot-observe: Capture wiki baseline precedes the agent step, which precedes Detect/Ingest', () => {
    const baselineIndex = findStepIndex(observeJob, step => step.name === 'Capture wiki baseline')
    const agentIndex = findStepIndex(observeJob, step => step.id === 'fro-bot-agent')
    const detectIndex = findStepIndex(observeJob, step => step.name === 'Detect wiki insight changes')
    const ingestIndex = findStepIndex(observeJob, step => step.name === 'Ingest wiki insight changes')

    expect(baselineIndex).toBeGreaterThanOrEqual(0)
    expect(agentIndex).toBeGreaterThan(baselineIndex)
    expect(detectIndex).toBeGreaterThan(agentIndex)
    expect(ingestIndex).toBeGreaterThan(detectIndex)
  })

  it('fro-bot-remediate has no wiki baseline/detect/ingest steps — it cannot commit knowledge/**', () => {
    expect(findStepIndex(remediateJob, step => step.name === 'Capture wiki baseline')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === 'Detect wiki insight changes')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === 'Ingest wiki insight changes')).toBe(-1)
  })

  it('fro-bot-remediate has no daily-report steps — only fro-bot-observe creates/announces the report', () => {
    expect(findStepIndex(remediateJob, step => step.name === '🔍 Discover daily report URL')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === '📊 Derive daily digest counts')).toBe(-1)
    expect(findStepIndex(remediateJob, step => step.name === '📣 Announce daily digest to gateway')).toBe(-1)
  })
})

describe('fro-bot.yaml pre-agent tree cleanliness', () => {
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']
  const observeJob = froBotParsed.jobs['fro-bot-observe']

  it('fro-bot-remediate restores knowledge/ to HEAD after solutions-query and before the agent runs', () => {
    const solutionsIndex = findStepIndex(remediateJob, step => step.id === 'solutions-query')
    const restoreIndex = findStepIndex(
      remediateJob,
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    const agentIndex = findStepIndex(remediateJob, step => step.id === 'fro-bot-agent')

    expect(solutionsIndex).toBeGreaterThanOrEqual(0)
    expect(restoreIndex).toBeGreaterThan(solutionsIndex)
    expect(agentIndex).toBeGreaterThan(restoreIndex)
  })

  it('the restore step verifies a clean git status --porcelain -- knowledge, not just the restore command', () => {
    const restoreStep = remediateJob?.steps?.find(
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    expect(String(restoreStep?.run ?? '')).toContain('git status --porcelain -- knowledge')
    expect(String(restoreStep?.run ?? '')).toContain('exit 1')
  })

  it('the restore step also removes untracked pages, which git restore cannot touch', () => {
    // `data` may carry a wiki page `main` lacks; the sync writes it untracked, and
    // `git restore` only manages tracked paths. Without the clean, the guard below it
    // fails the job the first time a survey adds a page before the weekly promotion.
    const restoreStep = remediateJob?.steps?.find(
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    expect(String(restoreStep?.run ?? '')).toContain('git clean -fd -- knowledge')
    expect(String(restoreStep?.run ?? '')).not.toContain('git clean -fdx')
  })

  it('fro-bot-observe has no such restore step — its dirty tree is load-bearing for wiki-ingest.ts', () => {
    const restoreIndex = findStepIndex(
      observeJob,
      step => typeof step.run === 'string' && step.run.includes('git restore --worktree --source=HEAD -- knowledge'),
    )
    expect(restoreIndex).toBe(-1)
  })
})

describe('fro-bot.yaml custom-prompt single-job resolution', () => {
  const workflowDispatchInputs = (froBotParsed.on as {workflow_dispatch?: {inputs?: Record<string, WorkflowInput>}})
    .workflow_dispatch?.inputs
  const workflowCallInputs = (froBotParsed.on as {workflow_call?: {inputs?: Record<string, WorkflowInput>}})
    .workflow_call?.inputs

  it('workflow_dispatch declares an output-mode choice input defaulting to branch-pr', () => {
    const input = workflowDispatchInputs?.['output-mode']
    expect(input).toBeDefined()
    expect(input?.type).toBe('choice')
    expect(input?.options).toEqual(['branch-pr', 'working-dir'])
    expect(input?.default).toBe('branch-pr')
  })

  it('workflow_call declares an output-mode input defaulting to working-dir (safest for an omitting caller)', () => {
    const input = workflowCallInputs?.['output-mode']
    expect(input).toBeDefined()
    expect(input?.required).toBe(false)
    expect(input?.default).toBe('working-dir')
  })

  it('fro-bot-remediate only runs a custom prompt when output-mode resolves to branch-pr', () => {
    const remediateIf = String(froBotParsed.jobs['fro-bot-remediate']?.if ?? '')
    expect(remediateIf).toContain("inputs.prompt == ''")
    expect(remediateIf).toContain("inputs['output-mode'] == 'branch-pr'")
  })

  it('fro-bot-observe only runs a custom prompt when output-mode resolves to working-dir', () => {
    const observeIf = String(froBotParsed.jobs['fro-bot-observe']?.if ?? '')
    expect(observeIf).toContain("inputs.prompt == ''")
    expect(observeIf).toContain("inputs['output-mode'] == 'working-dir'")
  })

  it('the two jobs gate on mutually exclusive output-mode values, so a custom prompt selects exactly one', () => {
    const remediateIf = String(froBotParsed.jobs['fro-bot-remediate']?.if ?? '')
    const observeIf = String(froBotParsed.jobs['fro-bot-observe']?.if ?? '')
    expect(remediateIf).toContain('branch-pr')
    expect(remediateIf).not.toContain("'working-dir'")
    expect(observeIf).toContain('working-dir')
    expect(observeIf).not.toContain("'branch-pr'")
  })

  it('fro-bot-observe runs regardless of fro-bot-remediate outcome (skipped or failed), only cancellation stops it', () => {
    const observeIf = String(froBotParsed.jobs['fro-bot-observe']?.if ?? '')
    expect(observeIf).toContain('!cancelled()')
    expect(observeIf).not.toContain('success()')
  })
})
describe('fro-bot.yaml: prompt bound to output-mode', () => {
  const remediateJob = froBotParsed.jobs['fro-bot-remediate']
  const observeJob = froBotParsed.jobs['fro-bot-observe']

  it('remediate task prompt references REMEDIATE pieces only', () => {
    const agentStep = remediateJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const taskPrompt = String(agentStep?.env?.TASK_PROMPT ?? '')
    expect(taskPrompt).toContain('env.REMEDIATE_INTRO')
    expect(taskPrompt).toContain('env.REMEDIATE_CATEGORIES')
    expect(taskPrompt).not.toContain('env.OBSERVE_INTRO')
    expect(taskPrompt).not.toContain('env.OBSERVE_CATEGORIES')
    expect(taskPrompt).not.toContain('env.OBSERVE_OUTPUT')
  })

  it('observe task prompt references OBSERVE pieces only', () => {
    const agentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const taskPrompt = String(agentStep?.env?.TASK_PROMPT ?? '')
    expect(taskPrompt).toContain('env.OBSERVE_INTRO')
    expect(taskPrompt).toContain('env.OBSERVE_CATEGORIES')
    expect(taskPrompt).toContain('env.OBSERVE_OUTPUT')
    expect(taskPrompt).not.toContain('env.REMEDIATE_INTRO')
    expect(taskPrompt).not.toContain('env.REMEDIATE_CATEGORIES')
  })

  it('both jobs share HARD_BOUNDARIES, AGENT_NOTES, and SHARED_RULES', () => {
    const remediateAgentStep = remediateJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const observeAgentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const remediateTaskPrompt = String(remediateAgentStep?.env?.TASK_PROMPT ?? '')
    const observeTaskPrompt = String(observeAgentStep?.env?.TASK_PROMPT ?? '')
    const sharedNames = ['env.SHARED_RULES', 'env.HARD_BOUNDARIES', 'env.AGENT_NOTES']
    for (const shared of sharedNames) {
      expect(remediateTaskPrompt).toContain(shared)
      expect(observeTaskPrompt).toContain(shared)
    }
  })
})
describe('reusable-workflow callers declare the output-mode they need', () => {
  it('apply-branding.yaml passes output-mode: branch-pr', () => {
    const job = applyBrandingParsed.jobs['apply-branding']
    expect(job?.with).toBeDefined()
    expect(job?.with?.['output-mode']).toBe('branch-pr')
  })

  it('gateway-rollout-tracker.yaml does not pass output-mode — it relies on the working-dir default', () => {
    const job = gatewayTrackerParsed.jobs['update-rollout-tracker']
    expect(job?.with?.['output-mode']).toBeUndefined()
  })
})

describe('fro-bot.yaml prompt content: delivery-mode instructions land in the right job', () => {
  const env = froBotParsed.env as Record<string, string>

  it('the observe prompt forbids branch/commit/push — it cannot deliver that way', () => {
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(observeIntro).toContain('never run `git branch`, `git commit`,')
    expect(observeIntro).toContain('delivers via branch+PR')
    expect(observeIntro.toLowerCase()).toContain('working-dir mode')
  })

  it('the remediate prompt instructs branch/commit/push as the required delivery mechanism', () => {
    const remediateIntro = env.REMEDIATE_INTRO ?? ''
    const remediateCategories = env.REMEDIATE_CATEGORIES ?? ''
    expect(remediateIntro.toLowerCase()).toContain('branch-pr mode')
    expect(remediateIntro).toContain('checking out a')
    expect(remediateCategories).toContain('push to that PR branch')
  })

  it('both the remediate and observe prompts state the guarded-paths boundary explicitly', () => {
    const remediateIntro = env.REMEDIATE_INTRO ?? ''
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(remediateIntro).toContain('knowledge/wiki/**')
    expect(remediateIntro).toContain('metadata/*.yaml')
    expect(observeIntro).toContain('metadata/*.yaml')
  })

  it('the observe prompt corrects the dirty-tree requirement for wiki-ingest.ts', () => {
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(observeIntro).toContain('git status --porcelain')
    expect(observeIntro).toContain('leave that tree dirty')
  })

  it('the observe output section instructs reading remediate PRs instead of re-analysis', () => {
    const observeOutput = env.OBSERVE_OUTPUT ?? ''
    expect(observeOutput).toContain('Do not re-analyze those')
    expect(observeOutput).toContain('Fro-Bot-authored PRs')
  })
})

describe('fro-bot.yaml content-trigger job: issues-branch trust and checkout credential scope', () => {
  const contentJob = froBotParsed.jobs['fro-bot']
  const contentIf = String(contentJob?.if ?? '')
  const checkoutStep = contentJob?.steps?.find(step => step.name === 'Checkout repository')

  it('configuration contract: the fro-bot job if predicate matches the expected condition exactly, whitespace-normalized (static string comparison, not a live GHA evaluation)', () => {
    const expectedIf = `
      (
        github.event.pull_request == null ||
        (
          !github.event.pull_request.head.repo.fork &&
          !endsWith(github.event.pull_request.user.login || '', '[bot]')
        )
      ) && (
        (
          github.event_name == 'issues' &&
          !endsWith(github.event.issue.user.login || '', '[bot]') &&
          (github.event.issue.user.login || '') != 'fro-bot' &&
          contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.issue.author_association || '')
        ) ||
        (
          github.event_name == 'pull_request' &&
          !endsWith(github.event.pull_request.user.login || '', '[bot]') &&
          (github.event.pull_request.user.login || '') != 'fro-bot'
        ) ||
        (
          (github.event_name == 'issue_comment' ||
           github.event_name == 'pull_request_review_comment' ||
           github.event_name == 'discussion_comment') &&
          contains(github.event.comment.body || '', '@fro-bot') &&
          (github.event.comment.user.login || '') != 'fro-bot' &&
          contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || '')
        )
      )
    `

    expect(contentIf.replaceAll(/\s+/g, ' ').trim()).toBe(expectedIf.replaceAll(/\s+/g, ' ').trim())
  })

  it('keeps the issues branch bot exclusions and opened/edited event types unchanged', () => {
    expect(contentIf).toContain(`!endsWith(github.event.issue.user.login || '', '[bot]')`)
    expect(contentIf).toContain(`(github.event.issue.user.login || '') != 'fro-bot'`)
    const issuesTypes = (froBotParsed.on as {issues?: {types?: string[]}}).issues?.types
    expect(issuesTypes).toEqual(['opened', 'edited'])
  })

  it('leaves the comment branch and other jobs untouched', () => {
    expect(contentIf).toContain(
      `contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || '')`,
    )
    const remediateCheckout = froBotParsed.jobs['fro-bot-remediate']?.steps?.find(
      step => step.name === 'Checkout repository',
    )
    const observeCheckout = froBotParsed.jobs['fro-bot-observe']?.steps?.find(
      step => step.name === 'Checkout repository',
    )
    expect(remediateCheckout?.with?.['persist-credentials']).toBeUndefined()
    expect(observeCheckout?.with?.['persist-credentials']).toBeUndefined()
  })

  it('sets persist-credentials: false on the content-trigger job checkout while keeping the PAT token', () => {
    const expressionStart = '$' + '{{'
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
    expect(checkoutStep?.with?.token).toBe(`${expressionStart} secrets.FRO_BOT_PAT }}`)
    expect(checkoutStep?.with?.['fetch-depth']).toBe(0)
  })

  it('leaves the agent step github-token input unchanged', () => {
    const agentStep = contentJob?.steps?.find(step => step.id === 'fro-bot-agent')
    const expressionStart = '$' + '{{'
    expect(agentStep?.with?.['github-token']).toBe(`${expressionStart} secrets.FRO_BOT_PAT }}`)
  })
})
