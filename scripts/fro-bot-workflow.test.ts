/**
 * Contract tests for .github/workflows/fro-bot.yaml's daily-pass delivery-mode
 * split: the schedule/workflow_dispatch path runs as two jobs
 * (fro-bot-remediate: categories 1–4, branch-pr; fro-bot-observe: categories
 * 5–8 + daily report, working-dir), a custom prompt resolves to exactly one
 * of them, and the reusable-workflow callers (apply-branding.yaml,
 * gateway-rollout-tracker.yaml) declare the output-mode they need. Style
 * mirrors publish-wiki-workflow.test.ts.
 */

import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {evaluateExpression, evaluateExpressionValue} from '@fro-bot/test-kit/workflow-expression'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
import {issueRef, parseProgramTrackers} from '../packages/status-truth/src/program-trackers.ts'

interface WorkflowStep {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  shell?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  name?: string
  steps?: WorkflowStep[]
  needs?: string | string[]
  if?: string
  outputs?: Record<string, string>
  with?: Record<string, unknown>
  'timeout-minutes'?: number
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
  concurrency?: unknown
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

  it('fro-bot-observe gives the agent 45 minutes, inside the 60-minute job limit', () => {
    const agentStep = observeJob?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(agentStep?.with?.timeout).toBe('2700000')
    expect(observeJob?.['timeout-minutes']).toBe(60)
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

  it('within fro-bot-observe: Capture wiki baseline precedes the agent step, which precedes Detect/Build handoff', () => {
    const baselineIndex = findStepIndex(observeJob, step => step.name === 'Capture wiki baseline')
    const agentIndex = findStepIndex(observeJob, step => step.id === 'fro-bot-agent')
    const detectIndex = findStepIndex(observeJob, step => step.name === 'Detect wiki insight changes')
    const buildIndex = findStepIndex(observeJob, step => step.name === 'Build wiki handoff artifact')
    const uploadIndex = findStepIndex(observeJob, step => step.name === 'Upload wiki handoff artifact')

    expect(baselineIndex).toBeGreaterThanOrEqual(0)
    expect(agentIndex).toBeGreaterThan(baselineIndex)
    expect(detectIndex).toBeGreaterThan(agentIndex)
    expect(buildIndex).toBeGreaterThan(detectIndex)
    expect(uploadIndex).toBeGreaterThan(buildIndex)
  })

  it('fro-bot-observe never runs wiki-ingest.ts itself — that only happens in the trusted follow-on job', () => {
    expect(findStepIndex(observeJob, step => typeof step.run === 'string' && step.run.includes('wiki-ingest.ts'))).toBe(
      -1,
    )
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

  it('the remediate prompt batches override-floor fixes into one PR gated on a passing check-override-floors', () => {
    // check-override-floors audits every advisory at once, so per-package PRs stay red and cannot merge.
    const security = (env.REMEDIATE_CATEGORIES ?? '').replaceAll(/\s+/g, ' ')
    expect(security).toContain('ONE combined PR')
    expect(security).toContain('`fix/security-override-floors`')
    expect(security).toContain('push to it')
    expect(security).toContain('instead of opening another')
    expect(security).toContain('only when `bun scripts/check-override-floors.ts` exits 0')
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

  it('the observe prompt hands knowledge edits to a separate trusted ingest job, not a same-job step', () => {
    // The observe job only builds + uploads a data-only handoff artifact; fro-bot-observe-wiki-ingest
    // (a separate job) downloads, validates and commits it to `data`.
    const observeIntro = (env.OBSERVE_INTRO ?? '').replaceAll(/\s+/g, ' ')
    expect(observeIntro).not.toContain('same job')
    expect(observeIntro).toContain('separate trusted ingest job')
    expect(observeIntro).toContain('validates it and commits it to the data branch')
    expect(froBotParsed.jobs['fro-bot-observe-wiki-ingest']?.needs).toBe('fro-bot-observe')
  })

  it('the remediate prompt never instructs editing knowledge/** — durable knowledge goes to Needs Human Attention', () => {
    // Composed the same way the remediate job builds it: TASK_PROMPT pieces + the agent step's
    // <knowledge_persistence> block.
    const agentStep = froBotParsed.jobs['fro-bot-remediate']?.steps?.find(step => step.id === 'fro-bot-agent')
    const knowledgeBlock = /<knowledge_persistence>[\s\S]*?<\/knowledge_persistence>/.exec(
      String(agentStep?.with?.prompt ?? ''),
    )?.[0]
    expect(knowledgeBlock).toBeDefined()
    const composed = [
      env.REMEDIATE_INTRO,
      env.SHARED_RULES,
      env.REMEDIATE_CATEGORIES,
      env.HARD_BOUNDARIES,
      env.AGENT_NOTES,
      knowledgeBlock,
    ]
      .join('\n')
      .replaceAll(/\s+/g, ' ')

    // The unconditional wiki-persistence instructions that used to reach this run.
    expect(composed).not.toContain('also persist it to the wiki')
    expect(composed).not.toContain('update only `knowledge/wiki/**`')
    // The conditional replacement routes non-owning runs to the report.
    expect(composed).toContain('any other run (for example branch-pr) records it under "Needs Human Attention"')
    expect(composed).toContain('and does not edit knowledge/**')
    expect(composed).toContain('Wiki persistence does not happen in this run at all')
  })

  it('the observe prompt still tells the run that owns the handoff to write knowledge files', () => {
    const observeIntro = env.OBSERVE_INTRO ?? ''
    expect(observeIntro).toContain('write it directly into knowledge/wiki/**')
    const agentStep = froBotParsed.jobs['fro-bot-observe']?.steps?.find(step => step.id === 'fro-bot-agent')
    expect(String(agentStep?.with?.prompt ?? '').replaceAll(/\s+/g, ' ')).toContain('update only `knowledge/wiki/**`')
  })

  it('the daily report is named consistently — no stale Daily Org Oversight Report in category text', () => {
    const categories = env.OBSERVE_CATEGORIES ?? ''
    const output = env.OBSERVE_OUTPUT ?? ''
    expect(categories).not.toContain('Daily Org Oversight Report')
    expect(categories).toContain('Daily Fro Bot Report')
    expect(output).toContain('"Daily Fro Bot Report — YYYY-MM-DD (UTC)"')
    // The only remaining mention is the legacy-title cleanup match in OBSERVE_OUTPUT.
    const staleMentions = Object.entries(env).filter(
      ([name, value]) => name !== 'OBSERVE_OUTPUT' && String(value).includes('Daily Org Oversight Report'),
    )
    expect(staleMentions).toEqual([])
    expect(output).toContain('"Daily Org Oversight Report —" (the previous')
  })
})

/** Collapse line wrapping so assertions pin wording, not where the YAML folds a line. */
const flat = (text: string): string => text.replaceAll(/\s+/g, ' ')

/**
 * Evaluate a `format('{0}{1}…', env.A, env.B, …)` expression the way Actions does: each `{n}` is replaced
 * by argument n, so an omitted, repeated or reordered index changes the result.
 */
const renderFormatExpression = (expression: string, env: Record<string, unknown>): string => {
  const match = /format\('([^']*)',([^)]*)\)/.exec(expression)
  if (match?.[1] === undefined || match[2] === undefined) throw new TypeError('expression has no format() call')
  const values = match[2].split(',').map(arg => {
    const name = arg.trim().replace(/^env\./, '')
    const value = env[name]
    if (typeof value !== 'string') throw new TypeError(`env.${name} is not a string`)
    return value
  })
  return match[1].replaceAll(/\{(\d+)\}/g, (_placeholder, index: string) => {
    const value = values[Number(index)]
    if (value === undefined) throw new RangeError(`format() placeholder {${index}} has no argument`)
    return value
  })
}

/** Rebuild the observe agent prompt: render TASK_PROMPT's format(), then splice it into the agent step's prompt. */
const composeObservePrompt = (): string => {
  const step = froBotParsed.jobs['fro-bot-observe']?.steps?.find(candidate => candidate.id === 'fro-bot-agent')
  const task = renderFormatExpression(String(step?.env?.TASK_PROMPT ?? ''), froBotParsed.env ?? {})
  const prompt = String(step?.with?.prompt ?? '')
  const reference = '$' + '{{ env.TASK_PROMPT }}'
  if (!prompt.includes(reference)) throw new TypeError('agent prompt does not embed env.TASK_PROMPT')
  return prompt.replace(reference, () => task)
}

describe('fro-bot.yaml observe prompt: live, actionable Needs Human Attention list', () => {
  const env = froBotParsed.env as Record<string, string>
  const output = flat(env.OBSERVE_OUTPUT ?? '')

  it('closes the predecessor in a fixed order: find, read, create, read back, close', () => {
    const order = [
      'find the open predecessor daily report',
      'read it',
      "create today's report",
      "read today's report back",
      'only then CLOSE',
    ].map(phrase => output.indexOf(phrase))

    expect(order).not.toContain(-1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(output).not.toContain('Before or after creating it')
  })

  it('keys each item to the object its next action works on, and never to evidence', () => {
    expect(output).toContain('Key each item to the object its next action works on')
    expect(output).toContain('an issue, PR or Project item URL, a normalized repo path, or a repo plus workflow file')
    expect(output).toContain('Runs, comments and documents are evidence only, never a key')
    expect(output).toContain('One problem per item. Split bundled bullets')
    expect(output).toContain('Two problems on one object are two items, each with its own tag')
  })

  it('renders every key as a key: line that matching, counting and reuse all read', () => {
    expect(output).toContain('End every item with a line "key: <object> — <problem tag>"')
    expect(output).toContain('starting with the key line')
  })

  it('tags every key from its first appearance', () => {
    expect(output).toContain("Every key carries a problem tag from the item's first appearance")
    expect(output).not.toContain('never carries one')
    expect(output).toContain(
      'The tag stays the same from one report to the next, whatever other problems the object has',
    )
  })

  it('gives every item an owner, one next action and an observed or inferred tag', () => {
    expect(output).toContain(
      'Every item names an owner (a handle, or "you"), one next action, and whether it is observed or inferred',
    )
  })

  it('re-checks each key just before publishing and keeps an item whose evidence alone resolved', () => {
    expect(output).toContain('Just before publishing, re-read the object behind each key')
    expect(output).toContain('If the key has resolved, drop the item')
    expect(output).toContain('If only the evidence has resolved, refresh the evidence and keep the item')
    expect(output).toContain('keep the item marked "could not re-check"')
    expect(output).toContain('name the source only if its repo is public')
  })

  it('takes first-seen by walking back through prior reports, with today as the fallback', () => {
    expect(output).toContain('oldest consecutive earlier daily report that lists the same item')
    expect(output).toContain('stop at the first report that does not')
    expect(output).toContain('If no earlier report lists it, use today. Never guess a date')
  })

  it('matches a report with key: lines on the exact key line', () => {
    expect(output).toContain('A report with `key:` lines lists an item when it has the same key line')
    expect(output).toContain('From the first report with `key:` lines onward, use the tagged key line')
  })

  it('counts an earlier report without key: lines only for the same object, the same problem and a single matching item', () => {
    expect(output).toContain('An earlier report without `key:` lines lists an item only when')
    expect(output).toContain(
      'it names the same object, plainly describes the same problem, and exactly one of its items fits',
    )
  })

  it('stops the walk at a legacy report whose match is ambiguous', () => {
    expect(output).toContain('If the match is ambiguous, stop the walk at that report')
  })

  it('counts the three consecutive reports for escalation with the same matching as first-seen', () => {
    expect(output).toContain(
      "live on three consecutive reports, today's included, counted by the same matching as first-seen",
    )
  })

  it('leads Needs Human Attention with the operator-only "Awaiting you" items', () => {
    const structure = (env.OBSERVE_OUTPUT ?? '').split('\n').map(line => line.trim())
    const heading = structure.indexOf('### Needs Human Attention')
    expect(heading).toBeGreaterThan(-1)
    expect(structure[heading + 1]).toBe('#### Awaiting you')
    expect(output).toContain('list the items only the operator can do, each with its exact step')
  })

  it('escalates a key live on three consecutive reports, with the listed exclusions', () => {
    expect(output).toContain("Escalate a key that is live on three consecutive reports, today's included")
    expect(output).toContain('Do not escalate keys that are already issues, items already tracked')
    expect(output).toContain('"Awaiting you" items or Renovate-owned fixes')
    expect(output).toContain('file a tracking issue in the AGENT NOTES format')
    expect(output).toContain(
      'Show each escalated item as one line linking its issue, with its first seen date, and ending with its key line',
    )
    expect(output).toContain('skip escalation and say so in the Run Summary')
  })

  it('reuses an open tracking issue and never refiles after an operator close, for any close reason', () => {
    expect(output).toContain('Search issues labeled `attention-tracking`, open and closed, for the same key line')
    expect(output).toContain('Reuse an open one')
    expect(output).toContain(
      'A matching issue the operator closed, for any reason, ends that occurrence: do not refile',
    )
    expect(output).toContain('report the item once as declined')
    expect(output).toContain('File a new issue only after a confirmed resolution followed by a fresh recurrence')
    expect(output).not.toContain('not planned')
  })

  it('caps new tracking issues per run, oldest first-seen first, and leaves the rest as ordinary items', () => {
    expect(output).toContain('Create at most 2 new tracking issues per run, oldest first-seen first')
    expect(output).toContain('Any other eligible item stays in the report as an ordinary item until a later run')
  })

  it('closes only fro-bot-authored attention-tracking issues, on affirmative evidence per key type', () => {
    expect(output).toContain('close an open issue labeled `attention-tracking` and authored by `fro-bot`')
    expect(output).toContain('only on affirmative evidence that its problem is resolved')
    expect(output).toContain('for an issue or PR key, it is closed or merged')
    expect(output).toContain('for a Project item key, its Status is Done (a removed item is not resolution')
    expect(output).toContain(
      'for a workflow key, a fix for the cited failure is merged and linked and every default-branch run since it succeeded',
    )
    expect(output).not.toContain('the last 3 runs on the default branch succeeded')
    expect(output).toContain('for a file or path key, the default branch no longer shows the cited problem')
    expect(output).toContain('A failed re-check, one passing run, or a finding that is merely absent is not resolution')
    expect(output).toContain('editing the issue body, not in a comment')
  })

  it('shows first seen on every item', () => {
    expect(output).toContain('Every item also shows `first seen YYYY-MM-DD`')
  })

  it('includes an attention item only when every source of it is confirmed public', () => {
    expect(output).toContain('Include an attention item only if every source of it is public')
    expect(output).toContain("the key's repo and every repo its evidence or root cause comes from")
    expect(output).toContain('gh repo view <owner/repo> --json visibility')
    expect(output).toContain('public only when it returns PUBLIC')
    expect(output).toContain('Any other result, including an error, means private')
    expect(output).toContain(
      'If any source is not confirmed public, leave the whole item out of the report, the Run Summary and tracking issues',
    )
    expect(output).toContain('never refer to a "private repository"')
  })

  it('re-checks sources before editing or closing a tracking issue and withholds evidence about a source gone private', () => {
    expect(output).toContain('Before editing or closing a tracking issue, check its sources again')
    expect(output).toContain(
      'If one is no longer public, edit or close it without any evidence that names or describes that source',
    )
  })

  it('scopes the visibility rule to attention items and does not widen it to other report sections', () => {
    expect(output).not.toContain('every report section')
    expect(output).not.toContain('every Observe output')
  })

  it('category 5 allows only the attention-tracking exception and keeps the rest report-only', () => {
    const category = flat(env.OBSERVE_CATEGORIES ?? '')
    const oversight = category.slice(category.indexOf('5. OVERSIGHT'), category.indexOf('6. CROSS-PROJECT'))
    expect(oversight).toContain('Do NOT modify individual issues/PRs or apply labels in this category')
    expect(oversight).toContain(
      'except issues labeled `attention-tracking`: create, label, edit and close those under the attention rules in the output section',
    )
  })

  it('keeps the existing Needs Human Attention routing and the report title pinned', () => {
    expect(flat(env.SHARED_RULES ?? '')).toContain('SCOPE CAP')
    expect(flat(env.SHARED_RULES ?? '')).toContain('TRUSTED AUTHORS')
    expect(flat(env.SHARED_RULES ?? '')).toContain('record it under "Needs Human Attention"')
    expect(flat(env.AGENT_NOTES ?? '')).toContain('AGENT NOTES')
    expect(output).toContain('"Daily Fro Bot Report — YYYY-MM-DD (UTC)"')
  })

  describe('the format() renderer honours placeholder indices', () => {
    const argsWithoutOutput =
      'env.OBSERVE_INTRO, env.SHARED_RULES, env.OBSERVE_CATEGORIES, env.HARD_BOUNDARIES, env.AGENT_NOTES'
    const marker = 'NEEDS HUMAN ATTENTION RULES'

    it('renders the attention block through the real template', () => {
      const expression = `format('{0}{1}{2}{3}{4}{5}', ${argsWithoutOutput}, env.OBSERVE_OUTPUT)`
      expect(renderFormatExpression(expression, env)).toContain(marker)
    })

    it('omits the attention block when the template drops the OBSERVE_OUTPUT index', () => {
      const expression = `format('{0}{1}{2}{3}{4}{4}', ${argsWithoutOutput}, env.OBSERVE_OUTPUT)`
      expect(renderFormatExpression(expression, env)).not.toContain(marker)
    })

    it('omits the attention block when the OBSERVE_OUTPUT argument is removed', () => {
      const expression = `format('{0}{1}{2}{3}{4}', ${argsWithoutOutput})`
      expect(renderFormatExpression(expression, env)).not.toContain(marker)
    })

    it('rejects a placeholder with no argument', () => {
      expect(() => renderFormatExpression(`format('{0}{5}', env.OBSERVE_INTRO)`, env)).toThrow(RangeError)
    })
  })

  it('delivers the duties in the composed agent prompt, not only the env value', () => {
    const composed = flat(composeObservePrompt())

    expect(composed).toContain('SCOPE CAP')
    expect(composed).toContain('TRUSTED AUTHORS')
    expect(composed).toContain('AGENT NOTES')
    expect(composed).toContain('"Daily Fro Bot Report — YYYY-MM-DD (UTC)"')
    expect(composed).toContain('End every item with a line "key: <object> — <problem tag>"')
    expect(composed).toContain('Include an attention item only if every source of it is public')
    expect(composed).toContain('Create at most 2 new tracking issues per run')
    expect(composed).toContain('authored by `fro-bot`')
    expect(composed).toContain('gh repo view <owner/repo> --json visibility')
    expect(composed).toContain('Escalate a key that is live on three consecutive reports')
    expect(composed).toContain('except issues labeled `attention-tracking`')
    expect(composed).toContain("read today's report back")
    expect(composed).not.toContain('Before or after creating it')
  })
})
const draftedBranch = 'docs/drafted-solutions'

interface PullRequestFixture {
  login: string
  ref: string
  fork?: boolean
  fullName?: string
}

function pullRequestEvent({login, ref, fork = false, fullName = 'fro-bot/.github'}: PullRequestFixture): unknown {
  return {
    github: {
      event_name: 'pull_request',
      repository: 'fro-bot/.github',
      event: {pull_request: {user: {login}, head: {ref, repo: {fork, full_name: fullName}}}},
    },
  }
}

/** The operator of #3512: the content job leaves this user's tracker comments and issue edits to the tracker. */
const OPERATOR_ID = 831617
const STRANGER_ID = 4242

function commentEvent(fixture: {
  eventName?: string
  issueNumber: number
  pullRequest?: boolean
  login: string
  userId?: number
  body?: string
  association?: string
}): unknown {
  return {
    github: {
      event_name: fixture.eventName ?? 'issue_comment',
      event: {
        issue: {number: fixture.issueNumber, pull_request: fixture.pullRequest === true ? {url: 'pr'} : null},
        comment: {
          body: fixture.body ?? '@fro-bot status?',
          user: {login: fixture.login, id: fixture.userId ?? STRANGER_ID},
          author_association: fixture.association ?? 'OWNER',
        },
        sender: {login: fixture.login, id: fixture.userId ?? STRANGER_ID},
      },
    },
  }
}

function issuesEvent(fixture: {
  action: 'opened' | 'edited'
  authorLogin: string
  senderLogin: string
  senderId?: number
  issueNumber?: number
}): unknown {
  return {
    github: {
      event_name: 'issues',
      event: {
        action: fixture.action,
        issue: {number: fixture.issueNumber ?? 3511, user: {login: fixture.authorLogin}, author_association: 'OWNER'},
        sender: {login: fixture.senderLogin, id: fixture.senderId ?? STRANGER_ID},
      },
    },
  }
}

describe('fro-bot.yaml content-trigger job: issues-branch trust and checkout credential scope', () => {
  const contentJob = froBotParsed.jobs['fro-bot']
  const contentIf = String(contentJob?.if ?? '')
  const checkoutStep = contentJob?.steps?.find(step => step.name === 'Checkout repository')

  it('configuration contract: full if predicate matches expected condition (whitespace-normalized)', () => {
    // Not redundant with the narrower tests below: only a full-predicate pin catches
    // guard placement drift (right clause text, wrong branch) and an unsafe `|| true`
    // bypass appended to one clause — neither a substring/contains check on a single
    // clause would detect either. This is a static string comparison, not a live GHA evaluation.
    const expectedIf = `
      !(
        github.event.issue.pull_request == null &&
        (github.event_name == 'issue_comment' || github.event_name == 'issues') &&
        (
          (github.event.issue.number == 3512 && github.event.sender.id == 831617)
        )
      ) && (
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
          (github.event.sender.login || '') != 'fro-bot' &&
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

  it.each([
    ['fro-bot[bot] on a renovate/* head', pullRequestEvent({login: 'fro-bot[bot]', ref: 'renovate/foo'}), false],
    ['fro-bot[bot] on the data head', pullRequestEvent({login: 'fro-bot[bot]', ref: 'data'}), false],
    // Drafted-solutions PRs get manual review (fro-bot/agent#1520): no head-ref exemption from the bot exclusion.
    ['fro-bot[bot] on docs/drafted-solutions', pullRequestEvent({login: 'fro-bot[bot]', ref: draftedBranch}), false],
    ['dependabot[bot]', pullRequestEvent({login: 'dependabot[bot]', ref: draftedBranch}), false],
    ['the fro-bot user', pullRequestEvent({login: 'fro-bot', ref: 'feat/x'}), false],
    [
      'a human PR from a fork',
      pullRequestEvent({login: 'marcusrbrown', ref: 'feat/x', fork: true, fullName: 'someone/.github'}),
      false,
    ],
    ['a human PR', pullRequestEvent({login: 'marcusrbrown', ref: 'feat/x'}), true],
  ])('evaluates the content-trigger predicate against a fixture: %s', (_name, event, expected) => {
    expect(evaluateExpression(contentIf, event)).toBe(expected)
  })

  it.each([
    [
      'the operator mentioning on #3512 (the tracker mention workflow answers it)',
      {issueNumber: 3512, login: 'marcusrbrown', userId: OPERATOR_ID},
      false,
    ],
    [
      'the operator under a different login case (the user id decides, not the login)',
      {issueNumber: 3512, login: 'MarcusRBrown', userId: OPERATOR_ID},
      false,
    ],
    [
      'a user who only borrows the operator login on #3512',
      {issueNumber: 3512, login: 'marcusrbrown', userId: STRANGER_ID},
      true,
    ],
    ['the operator mentioning on another issue', {issueNumber: 3511, login: 'marcusrbrown', userId: OPERATOR_ID}, true],
    [
      'the operator mentioning on pull request 3512',
      {issueNumber: 3512, pullRequest: true, login: 'marcusrbrown', userId: OPERATOR_ID},
      true,
    ],
    [
      'another trusted author mentioning on #3512',
      {issueNumber: 3512, login: 'octocat', association: 'COLLABORATOR'},
      true,
    ],
    [
      'the operator commenting on #3512 without a mention',
      {issueNumber: 3512, login: 'marcusrbrown', userId: OPERATOR_ID, body: 'ack'},
      false,
    ],
    ['an untrusted author mentioning on #3512', {issueNumber: 3512, login: 'octocat', association: 'NONE'}, false],
    [
      'the operator reviewing a comment on pull request 3512',
      {eventName: 'pull_request_review_comment', issueNumber: 3512, login: 'marcusrbrown', userId: OPERATOR_ID},
      true,
    ],
  ])('evaluates the comment predicate against a fixture: %s', (_name, fixture, expected) => {
    expect(evaluateExpression(contentIf, commentEvent(fixture))).toBe(expected)
  })

  it.each([
    ['an edit made by the fro-bot account to an operator-authored issue', 'edited', 'marcusrbrown', 'fro-bot', false],
    ['an edit made by the operator to their own issue', 'edited', 'marcusrbrown', 'marcusrbrown', true],
    ['an issue the operator opens', 'opened', 'marcusrbrown', 'marcusrbrown', true],
    ['an issue the fro-bot account opens', 'opened', 'fro-bot', 'fro-bot', false],
  ] as const)(
    'evaluates the issues predicate against a fixture: %s',
    (_name, action, authorLogin, senderLogin, expected) => {
      const senderId = senderLogin === 'marcusrbrown' ? OPERATOR_ID : STRANGER_ID

      expect(evaluateExpression(contentIf, issuesEvent({action, authorLogin, senderLogin, senderId}))).toBe(expected)
    },
  )

  it.each([
    ['the operator edits the body of a configured tracker issue', 'edited', 3512, OPERATOR_ID, false],
    ['the operator opens a configured tracker issue', 'opened', 3512, OPERATOR_ID, false],
    ['another user edits the body of a configured tracker issue', 'edited', 3512, STRANGER_ID, true],
    ['the operator edits an issue that is no tracker', 'edited', 3511, OPERATOR_ID, true],
  ] as const)(
    'skips the operator issues events on a configured tracker issue only: %s',
    (_name, action, issueNumber, senderId, expected) => {
      const event = issuesEvent({
        action,
        authorLogin: 'marcusrbrown',
        senderLogin: 'marcusrbrown',
        senderId,
        issueNumber,
      })

      expect(evaluateExpression(contentIf, event)).toBe(expected)
    },
  )

  it('keeps the issues branch bot exclusions and opened/edited event types unchanged', () => {
    expect(contentIf).toContain(`!endsWith(github.event.issue.user.login || '', '[bot]')`)
    expect(contentIf).toContain(`(github.event.issue.user.login || '') != 'fro-bot'`)
    const issuesTypes = (froBotParsed.on as {issues?: {types?: string[]}}).issues?.types
    expect(issuesTypes).toEqual(['opened', 'edited'])
  })

  it('leaves the comment branch untouched', () => {
    expect(contentIf).toContain(
      `contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || '')`,
    )
  })

  it('fro-bot-remediate keeps checkout credential persistence effective (its branch-pr push needs it)', () => {
    const remediateCheckout = froBotParsed.jobs['fro-bot-remediate']?.steps?.find(
      step => step.name === 'Checkout repository',
    )
    expect(remediateCheckout).toBeDefined() // guards against a vacuous pass if the step were renamed/removed
    // output-mode: branch-pr commits and pushes from this job, so persist-credentials must
    // stay effective — the actions/checkout default (undefined) or an explicit true; never false.
    expect(remediateCheckout?.with?.['persist-credentials']).not.toBe(false)
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

describe('fro-bot.yaml: all three jobs delegate wiki sync to the hardened composite action (regression guard against per-job drift)', () => {
  it.each(['fro-bot', 'fro-bot-remediate', 'fro-bot-observe'])(
    '%s has a Sync wiki from data branch step using ./.github/actions/sync-data for knowledge',
    jobName => {
      const syncStep = froBotParsed.jobs[jobName]?.steps?.find(step => step.name === 'Sync wiki from data branch')
      expect(syncStep?.uses).toBe('./.github/actions/sync-data')
      expect(syncStep?.with).toStrictEqual({paths: 'knowledge', 'if-absent': 'skip'})
    },
  )

  it.each(['fro-bot', 'fro-bot-observe'])(
    '%s: Sync wiki from data branch precedes Capture wiki baseline (baseline must hash post-sync content)',
    jobName => {
      const job = froBotParsed.jobs[jobName]
      const syncIndex = findStepIndex(job, step => step.name === 'Sync wiki from data branch')
      const baselineIndex = findStepIndex(job, step => step.name === 'Capture wiki baseline')

      expect(syncIndex).toBeGreaterThanOrEqual(0)
      expect(baselineIndex).toBeGreaterThan(syncIndex)
    },
  )
})

describe('fro-bot.yaml App-token wiki ingest migration', () => {
  const froBotJob = froBotParsed.jobs['fro-bot']
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const wikiIngestJob = froBotParsed.jobs['fro-bot-wiki-ingest']
  const observeWikiIngestJob = froBotParsed.jobs['fro-bot-observe-wiki-ingest']

  it('declares both trusted writer jobs, each needing its agent job', () => {
    expect(wikiIngestJob).toBeDefined()
    expect(observeWikiIngestJob).toBeDefined()
    expect((wikiIngestJob as {needs?: string}).needs).toBe('fro-bot')
    expect((observeWikiIngestJob as {needs?: string}).needs).toBe('fro-bot-observe')
  })

  it("gates each trusted writer job on the agent job's wiki-changed output", () => {
    expect(String((wikiIngestJob as {if?: string}).if ?? '')).toContain("needs.fro-bot.outputs.wiki-changed == 'true'")
    expect(String((observeWikiIngestJob as {if?: string}).if ?? '')).toContain(
      "needs.fro-bot-observe.outputs.wiki-changed == 'true'",
    )
  })

  it('exposes wiki-changed as a job output on both agent jobs', () => {
    expect((froBotJob as {outputs?: Record<string, string>}).outputs?.['wiki-changed']).toContain(
      'steps.wiki-changes.outputs.changed',
    )
    expect((observeJob as {outputs?: Record<string, string>}).outputs?.['wiki-changed']).toContain(
      'steps.wiki-changes.outputs.changed',
    )
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s has no fro-bot/agent step (trusted-writer invariant)', (_name, job) => {
    const agentStep = findStepIndex(job, step => (step.uses ?? '').startsWith('fro-bot/agent@'))
    expect(agentStep).toBe(-1)
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s checks out the default branch with persist-credentials: false', (_name, job) => {
    const checkoutStep = (job as WorkflowJob)?.steps?.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s runs wiki-ingest.ts with a minted App token, never FRO_BOT_PAT', (_name, job) => {
    const ingestStep = (job as WorkflowJob)?.steps?.find(
      step => typeof step.run === 'string' && step.run.includes('wiki-ingest.ts'),
    )
    const token = String(ingestStep?.env?.GITHUB_TOKEN ?? '')
    expect(token).toContain('steps.app-token.outputs.token')
    expect(token).not.toContain('secrets.FRO_BOT_PAT')

    const mintStep = (job as WorkflowJob)?.steps?.find(step => step.id === 'app-token')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])('%s mints no App token after any fro-bot/agent step (there is none in this job at all)', (_name, job) => {
    const mintSteps = ((job as WorkflowJob)?.steps ?? []).filter(step =>
      (step.uses ?? '').startsWith('actions/create-github-app-token@'),
    )
    expect(mintSteps).toHaveLength(1)
  })

  it.each([
    ['fro-bot-wiki-ingest', wikiIngestJob],
    ['fro-bot-observe-wiki-ingest', observeWikiIngestJob],
  ])(
    "%s sources WIKI_* env from github.* context and this job's own trusted timestamp — never from an artifact-carried metadata.json",
    (_name, job) => {
      const ingestStep = (job as WorkflowJob)?.steps?.find(
        step => typeof step.run === 'string' && step.run.includes('wiki-ingest.ts'),
      )
      const run = String(ingestStep?.run ?? '')
      expect(run).not.toContain('metadata.json')
      expect(run).not.toContain('jq')

      const env = ingestStep?.env ?? {}
      expect(String(env.WIKI_TARGET ?? '')).toContain('github.repository')
      expect(String(env.WIKI_SUMMARY ?? '')).toContain('github.event_name')
      expect(String(env.WIKI_COMMIT_MESSAGE ?? '')).toContain('github.event_name')
      expect(String(env.WIKI_SOURCES ?? '')).toContain('github.sha')
      expect(String(env.WIKI_SOURCES ?? '')).toContain('steps.ingest-ts.outputs.now')

      const timestampStep = (job as WorkflowJob)?.steps?.find(step => step.id === 'ingest-ts')
      expect(timestampStep?.run).toContain('date -u')
    },
  )

  it.each([
    ['fro-bot', froBotJob],
    ['fro-bot-observe', observeJob],
  ])('%s (agent job): the build step writes no WIKI_* metadata into the handoff artifact', (_name, job) => {
    const buildStep = (job as WorkflowJob)?.steps?.find(step => step.name === 'Build wiki handoff artifact')
    const env = buildStep?.env ?? {}
    expect(Object.keys(env).sort()).toStrictEqual(['WIKI_HANDOFF_BASELINE_PATH', 'WIKI_HANDOFF_DIR'])
  })

  it.each([
    ['fro-bot', froBotJob],
    ['fro-bot-observe', observeJob],
  ])(
    '%s (agent job): captures a wiki content baseline before the agent step, wired to the build step',
    (_name, job) => {
      const steps = (job as WorkflowJob)?.steps ?? []
      const baselineIndex = steps.findIndex(step => step.name === 'Capture wiki content baseline')
      const agentIndex = steps.findIndex(step => step.id === 'fro-bot-agent')
      const buildIndex = steps.findIndex(step => step.name === 'Build wiki handoff artifact')

      expect(baselineIndex).toBeGreaterThanOrEqual(0)
      expect(agentIndex).toBeGreaterThan(baselineIndex)
      expect(buildIndex).toBeGreaterThan(agentIndex)

      const baselineStep = steps[baselineIndex]
      const buildStep = steps[buildIndex]
      expect(String(baselineStep?.run ?? '')).toContain('wiki-handoff-baseline.ts')
      expect(baselineStep?.env?.WIKI_HANDOFF_BASELINE_PATH).toBe(buildStep?.env?.WIKI_HANDOFF_BASELINE_PATH)
    },
  )

  it.each([
    ['fro-bot', froBotJob],
    ['fro-bot-observe', observeJob],
  ])(
    "%s (agent job): the upload step requires the build step's own non-empty-manifest signal, not just success",
    (_name, job) => {
      const uploadStep = (job as WorkflowJob)?.steps?.find(step => step.name === 'Upload wiki handoff artifact')
      const condition = String(uploadStep?.if ?? '')
      expect(condition).toContain("steps.wiki-handoff-build.outcome == 'success'")
      expect(condition).toContain("steps.wiki-handoff-build.outputs.changed == 'true'")
    },
  )
})

describe('fro-bot.yaml daily-digest announce isolation (agent post-step credential guard)', () => {
  const observeJob = froBotParsed.jobs['fro-bot-observe']
  const announceJob = froBotParsed.jobs['fro-bot-observe-announce']

  it('fro-bot-observe no longer announces the daily digest itself', () => {
    expect(findStepIndex(observeJob, step => step.name === '📣 Announce daily digest to gateway')).toBe(-1)
  })

  it('fro-bot-observe no longer exposes report-url/repos-tracked/surveys-today/count-status outputs, or the steps that only fed them', () => {
    const outputs = (observeJob as {outputs?: Record<string, string>})?.outputs ?? {}
    // agent-base-sha comes from the sync step that runs before the agent (see the write-base contract below).
    expect(Object.keys(outputs)).toStrictEqual(['wiki-changed', 'agent-base-sha'])
    expect(findStepIndex(observeJob, step => step.name === '🔍 Discover daily report URL')).toBe(-1)
    expect(findStepIndex(observeJob, step => step.name === '📊 Derive daily digest counts')).toBe(-1)
  })

  it('declares fro-bot-observe-announce needing fro-bot-observe, with no fro-bot/agent step (trusted-writer invariant)', () => {
    expect(announceJob).toBeDefined()
    expect((announceJob as {needs?: string})?.needs).toBe('fro-bot-observe')
    expect(findStepIndex(announceJob, step => (step.uses ?? '').startsWith('fro-bot/agent@'))).toBe(-1)
  })

  it('fro-bot-observe-announce checks out the default branch with persist-credentials: false', () => {
    const checkoutStep = announceJob?.steps?.find(step => (step.uses ?? '').startsWith('actions/checkout@'))
    expect(String(checkoutStep?.with?.ref ?? '')).toContain('github.event.repository.default_branch')
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
  })

  it('fro-bot-observe-announce gates only on dry-run/DAILY_DIGEST_ENABLED — no needs.fro-bot-observe.outputs reference (those outputs no longer exist)', () => {
    const jobIf = String((announceJob as {if?: string})?.if ?? '')
    expect(jobIf).toContain("inputs.prompt == ''")
    expect(jobIf).toContain("vars.DAILY_DIGEST_ENABLED == 'true'")
    expect(jobIf).not.toContain('needs.fro-bot-observe')
  })

  it('does not add job-level permissions (reusable workflow — relies on the workflow-level contents: read)', () => {
    expect((announceJob as {permissions?: unknown})?.permissions).toBeUndefined()
  })

  it('overlays metadata from the data branch before discovering the report URL or deriving counts', () => {
    const steps = announceJob?.steps ?? []
    const overlayIndex = steps.findIndex(step => step.name === '⤵ Overlay metadata from data branch')
    const discoverIndex = steps.findIndex(step => step.name === '🔍 Discover daily report URL')
    const countsIndex = steps.findIndex(step => step.name === '📊 Derive daily digest counts')
    expect(overlayIndex).toBeGreaterThanOrEqual(0)
    expect(discoverIndex).toBeGreaterThan(overlayIndex)
    expect(countsIndex).toBeGreaterThan(overlayIndex)
  })

  it('discovers the report URL trusted-side with an App token minted in this job (no agent step here, so minting is safe)', () => {
    const mintStep = announceJob?.steps?.find(step => step.id === 'report-token')
    const discoverStep = announceJob?.steps?.find(step => step.name === '🔍 Discover daily report URL')
    expect(mintStep?.uses).toContain('actions/create-github-app-token@')
    expect(mintStep?.with?.['permission-issues']).toBe('read')
    expect(String(discoverStep?.env?.GH_TOKEN ?? '')).toContain('steps.report-token.outputs.token')
    expect(String(discoverStep?.env?.GH_TOKEN ?? '')).not.toContain('FRO_BOT_PAT')
    const run = String(discoverStep?.run ?? '')
    expect(run).toContain('Daily Fro Bot Report')
    expect(run).toContain(String.raw`github\.com/fro-bot/\.github/issues/[0-9]+`)
  })

  it('derives digest counts trusted-side from metadata/repos.yaml via the same script the old observe step used', () => {
    const countsStep = announceJob?.steps?.find(step => step.name === '📊 Derive daily digest counts')
    expect(String(countsStep?.run ?? '')).toContain('scripts/daily-digest-counts.ts')
  })

  it('validates count_status/report-url shape and repos-tracked/surveys-today as non-negative integers before announcing, reading from its own steps (not needs.fro-bot-observe)', () => {
    const validateStep = announceJob?.steps?.find(step => step.name === '🔒 Validate digest values')
    expect(String(validateStep?.env?.REPORT_URL ?? '')).toContain('steps.report-url.outputs.report_url')
    expect(String(validateStep?.env?.REPOS_TRACKED ?? '')).toContain('steps.digest-counts.outputs.repos_tracked')
    expect(String(validateStep?.env?.SURVEYS_TODAY ?? '')).toContain('steps.digest-counts.outputs.surveys_today')
    expect(String(validateStep?.env?.COUNT_STATUS ?? '')).toContain('steps.digest-counts.outputs.count_status')

    const run = String(validateStep?.run ?? '')
    expect(run).toContain(String.raw`github\.com/fro-bot/\.github/issues/[0-9]+`)
    expect(run).toContain("grep -qE '^[0-9]+$'")
    expect(run).toContain('::error::')

    const announceStep = announceJob?.steps?.find(step => step.name === '📣 Announce daily digest to gateway')
    expect(String(announceStep?.if ?? '')).toContain("steps.validated.outputs.valid == 'true'")
  })

  // Non-vacuity for the item-2 fix: if the announce step (or the values it validates) ever
  // points back at needs.fro-bot-observe.outputs.*, this must fail — those outputs are
  // agent-influenceable and no longer exist on fro-bot-observe at all.
  it("the announce step and the values it validates read from this job's own trusted steps, never from needs.fro-bot-observe", () => {
    const validateStep = announceJob?.steps?.find(step => step.name === '🔒 Validate digest values')
    const announceStep = announceJob?.steps?.find(step => step.name === '📣 Announce daily digest to gateway')

    for (const step of [validateStep, announceStep]) {
      const envText = JSON.stringify(step?.env ?? {})
      expect(envText).not.toContain('needs.fro-bot-observe')
    }

    expect(String(announceStep?.env?.REPORT_URL ?? '')).toContain('steps.report-url.outputs.report_url')
    expect(String(announceStep?.env?.REPOS_TRACKED ?? '')).toContain('steps.digest-counts.outputs.repos_tracked')
    expect(String(announceStep?.env?.SURVEYS_TODAY ?? '')).toContain('steps.digest-counts.outputs.surveys_today')
    expect(String(announceStep?.env?.GATEWAY_WEBHOOK_SECRET ?? '')).toContain('secrets.GATEWAY_WEBHOOK_SECRET')
  })
})

describe('fro-bot-observe-announce: 🔒 Validate digest values — extract-and-execute against fixtures (shell-flow, not a hosted GHA run)', () => {
  const announceJob = froBotParsed.jobs['fro-bot-observe-announce']
  const validateStep = announceJob?.steps?.find(step => step.name === '🔒 Validate digest values')
  const runScript = String(validateStep?.run ?? '')

  function runValidateStep(
    env: Partial<Record<'REPORT_URL' | 'REPOS_TRACKED' | 'SURVEYS_TODAY' | 'COUNT_STATUS', string>>,
  ): {status: number; valid: string | undefined} {
    const dir = mkdtempSync(join(tmpdir(), 'fro-bot-validate-digest-'))
    try {
      const scriptPath = join(dir, 'step.sh')
      writeFileSync(scriptPath, runScript)
      const outputPath = join(dir, 'github-output')
      writeFileSync(outputPath, '')
      const runEnv = {
        COUNT_STATUS: 'ok',
        REPORT_URL: '',
        REPOS_TRACKED: '',
        SURVEYS_TODAY: '',
        ...env,
        PATH: process.env.PATH ?? '',
        GITHUB_OUTPUT: outputPath,
      }
      let status = 0
      try {
        execFileSync('bash', ['-c', 'bash "$0"', scriptPath], {cwd: dir, env: runEnv, encoding: 'utf8'})
      } catch (error) {
        status = (error as {status?: number}).status ?? 1
      }
      const outputContent = readFileSync(outputPath, 'utf8')
      const match = /^valid=(.*)$/m.exec(outputContent)
      return {status, valid: match?.[1]}
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  }

  it('finds the Validate digest values step (guards against a vacuous pass if the step were renamed/removed)', () => {
    expect(validateStep).toBeDefined()
  })

  it('produces valid=true for a valid report URL and valid counts', () => {
    const result = runValidateStep({
      REPORT_URL: 'https://github.com/fro-bot/.github/issues/123',
      REPOS_TRACKED: '5',
      SURVEYS_TODAY: '2',
    })
    expect(result.status).toBe(0)
    expect(result.valid).toBe('true')
  })

  it('produces valid=false for a URL scoped to another repo', () => {
    const result = runValidateStep({
      REPORT_URL: 'https://github.com/other-org/other-repo/issues/123',
      REPOS_TRACKED: '5',
      SURVEYS_TODAY: '2',
    })
    expect(result.valid).toBe('false')
  })

  it('produces valid=false for a URL that is not an issue (a pull request)', () => {
    const result = runValidateStep({
      REPORT_URL: 'https://github.com/fro-bot/.github/pull/123',
      REPOS_TRACKED: '5',
      SURVEYS_TODAY: '2',
    })
    expect(result.valid).toBe('false')
  })

  it('produces valid=false for a URL with a trailing injection string', () => {
    const result = runValidateStep({
      REPORT_URL: 'https://github.com/fro-bot/.github/issues/123; rm -rf /',
      REPOS_TRACKED: '5',
      SURVEYS_TODAY: '2',
    })
    expect(result.valid).toBe('false')
  })

  it('produces valid=false for non-numeric counts', () => {
    const result = runValidateStep({
      REPORT_URL: 'https://github.com/fro-bot/.github/issues/123',
      REPOS_TRACKED: 'abc',
      SURVEYS_TODAY: '2',
    })
    expect(result.valid).toBe('false')
  })

  it('produces valid=false for negative counts', () => {
    const result = runValidateStep({
      REPORT_URL: 'https://github.com/fro-bot/.github/issues/123',
      REPOS_TRACKED: '5',
      SURVEYS_TODAY: '-1',
    })
    expect(result.valid).toBe('false')
  })

  it('produces valid=false for empty values', () => {
    const result = runValidateStep({REPORT_URL: '', REPOS_TRACKED: '', SURVEYS_TODAY: ''})
    expect(result.valid).toBe('false')
  })

  it('produces valid=false when count_status is not ok, without ever evaluating the report URL', () => {
    const result = runValidateStep({
      COUNT_STATUS: 'error',
      REPORT_URL: 'https://github.com/fro-bot/.github/issues/123',
      REPOS_TRACKED: '5',
      SURVEYS_TODAY: '2',
    })
    expect(result.valid).toBe('false')
  })

  it('the announce step never runs unless this step set valid=true (structural check pairing the fixture runs above)', () => {
    const announceStep = announceJob?.steps?.find(step => step.name === '📣 Announce daily digest to gateway')
    expect(String(announceStep?.if ?? '')).toBe("steps.validated.outputs.valid == 'true'")
  })
})

describe('wiki ingest write base: the synced data commit reaches wiki-ingest.ts (contract)', () => {
  const expressionStart = '$' + '{{'

  it.each([
    ['fro-bot-wiki-ingest', 'Ingest wiki insight changes'],
    ['fro-bot-observe-wiki-ingest', 'Ingest wiki insight changes'],
  ])('%s exports the sync step output to wiki-ingest.ts through env, not run:', (jobName, stepName) => {
    const job = froBotParsed.jobs[jobName]
    const syncIndex = findStepIndex(job, step => step.uses === './.github/actions/sync-data')
    const ingestIndex = findStepIndex(job, step => step.name === stepName)
    const ingestStep = job?.steps?.[ingestIndex]

    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(ingestIndex).toBeGreaterThan(syncIndex)
    expect(job?.steps?.[syncIndex]?.id).toBe('sync-wiki')
    expect(ingestStep?.run).toContain('bun scripts/wiki-ingest.ts')
    expect(ingestStep?.env?.WIKI_INGEST_DATA_TIP_SHA).toBe(`${expressionStart} steps.sync-wiki.outputs.data-sha }}`)
    expect(ingestStep?.run).not.toContain('data-sha')
  })

  it.each([
    ['fro-bot-wiki-ingest', 'Ingest wiki insight changes'],
    ['fro-bot-observe-wiki-ingest', 'Ingest wiki insight changes'],
  ])(
    '%s routes ingest warnings (not findings) into the summary through the router, byte for byte the same line',
    (jobName, stepName) => {
      const ingestStep = froBotParsed.jobs[jobName]?.steps?.find(step => step.name === stepName)

      expect(ingestStep?.run?.trim()).toBe(
        "bun scripts/route-stderr.ts --route 'wiki-ingest:warning:=Wiki ingest warnings' --summary filtered bun scripts/wiki-ingest.ts",
      )
    },
  )

  it.each([
    ['fro-bot', 'fro-bot-wiki-ingest'],
    ['fro-bot-observe', 'fro-bot-observe-wiki-ingest'],
  ])('%s hands its sync commit to %s through a job output, before any agent step', (agentJobName, ingestJobName) => {
    const agentJob = froBotParsed.jobs[agentJobName]
    const ingestJob = froBotParsed.jobs[ingestJobName]
    const syncIndex = findStepIndex(agentJob, step => step.uses === './.github/actions/sync-data')
    const firstAgentIndex = findStepIndex(agentJob, step => (step.uses ?? '').startsWith('fro-bot/agent@'))
    const applyStep = ingestJob?.steps?.find(step => step.name === 'Validate and apply wiki handoff')
    const ingestStep = ingestJob?.steps?.find(step => step.name === 'Ingest wiki insight changes')

    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(agentJob?.steps?.[syncIndex]?.id).toBe('sync-wiki')
    expect(firstAgentIndex).toBeGreaterThan(syncIndex)
    expect(agentJob?.outputs?.['agent-base-sha']).toBe(`${expressionStart} steps.sync-wiki.outputs.data-sha }}`)
    expect(ingestStep?.env?.WIKI_HANDOFF_BASE_SHA).toBe(
      `${expressionStart} needs.${agentJobName}.outputs.agent-base-sha }}`,
    )
    expect(ingestStep?.env?.WIKI_HANDOFF_DIR).toBe(applyStep?.env?.WIKI_HANDOFF_DIR)
  })
})

describe('fro-bot.yaml agent prompts leave knowledge/index.md to the trusted ingest job', () => {
  const env = froBotParsed.env ?? {}
  const agentPrompt = (jobName: string): string => {
    const step = froBotParsed.jobs[jobName]?.steps?.find(candidate =>
      (candidate.uses ?? '').startsWith('fro-bot/agent@'),
    )
    return String(step?.with?.prompt ?? '')
  }
  const promptTexts: [string, string][] = [
    ['the observe intro', String(env.OBSERVE_INTRO ?? '')],
    ['the fro-bot job prompt', agentPrompt('fro-bot')],
    ['the fro-bot-observe job prompt', agentPrompt('fro-bot-observe')],
  ]

  it.each(promptTexts)('%s never permits editing the index, and says the ingest job maintains it', (_name, text) => {
    const indexLines = text.split('\n').filter(line => line.includes('knowledge/index.md'))

    expect(indexLines.length).toBeGreaterThan(0)
    for (const line of indexLines) expect(line).toContain('Do not edit')
    expect(text.replaceAll(/\s+/g, ' ')).toContain('the trusted ingest job')
    expect(text.replaceAll(/\s+/g, ' ')).not.toMatch(/update only[^.]*knowledge\/index\.md/)
    expect(text.replaceAll(/\s+/g, ' ')).not.toMatch(/write it directly into[^.]*knowledge\/index\.md/)
  })

  it.each(promptTexts.slice(1))('%s still permits knowledge/wiki/** and knowledge/log.md edits', (_name, text) => {
    expect(text.replaceAll(/\s+/g, ' ')).toContain('update only `knowledge/wiki/**` and `knowledge/log.md`')
  })
})

describe('fro-bot.yaml concurrency group', () => {
  const concurrency = froBotParsed.concurrency as {group?: string; 'cancel-in-progress'?: boolean} | undefined
  const group = String(concurrency?.group)
  const inner = /\$\{\{([\s\S]*)\}\}/.exec(group)?.[1] ?? ''
  const groupFor = (context: unknown): string =>
    `${group.slice(0, group.indexOf('$'))}${String(evaluateExpressionValue(inner, context))}`

  it('declares a concurrency-key input for reusable callers, empty by default', () => {
    const inputs = (froBotParsed.on.workflow_call as {inputs?: Record<string, WorkflowInput>}).inputs ?? {}

    expect(inputs['concurrency-key']).toMatchObject({required: false, type: 'string', default: ''})
  })

  it("puts a caller that passes the key in that key's group, ahead of the daily group", () => {
    const tracker = {
      github: {event_name: 'workflow_dispatch', run_id: 55, event: {}},
      inputs: {'concurrency-key': 'program-tracker-gateway'},
    }

    expect(groupFor(tracker)).toBe('fro-bot-program-tracker-gateway')
    expect(groupFor({...tracker, github: {...tracker.github, event_name: 'schedule'}})).toBe(
      'fro-bot-program-tracker-gateway',
    )
  })

  it.each([
    ['a scheduled run', {github: {event_name: 'schedule', run_id: 55, event: {}}, inputs: {}}, 'fro-bot-daily'],
    [
      'a manual dispatch',
      {
        github: {event_name: 'workflow_dispatch', run_id: 55, event: {}},
        inputs: {prompt: 'x', 'output-mode': 'branch-pr'},
      },
      'fro-bot-daily',
    ],
    [
      'a reusable caller that passes no key, from a dispatch',
      {github: {event_name: 'workflow_dispatch', run_id: 55, event: {}}, inputs: {prompt: 'x', 'concurrency-key': ''}},
      'fro-bot-daily',
    ],
    [
      'a comment on issue 7',
      {github: {event_name: 'issue_comment', run_id: 55, event: {issue: {number: 7}}}, inputs: {}},
      'fro-bot-7',
    ],
    [
      'a pull request 12',
      {github: {event_name: 'pull_request', run_id: 55, event: {pull_request: {number: 12}}}, inputs: {}},
      'fro-bot-12',
    ],
    [
      'a discussion 3',
      {github: {event_name: 'discussion_comment', run_id: 55, event: {discussion: {number: 3}}}, inputs: {}},
      'fro-bot-3',
    ],
    ['an event with no number', {github: {event_name: 'push', run_id: 55, event: {}}, inputs: {}}, 'fro-bot-55'],
  ])('keeps the group of %s', (_name, context, expected) => {
    expect(groupFor(context)).toBe(expected)
  })

  it('never cancels a run in progress', () => {
    expect(concurrency?.['cancel-in-progress']).toBe(false)
  })
})

describe('fro-bot.yaml content-job tracker exclusion matches program-trackers.json', () => {
  const contentIf = String(froBotParsed.jobs['fro-bot']?.if ?? '')
  const config = parseProgramTrackers(readFileSync(resolve(import.meta.dirname, '../program-trackers.json'), 'utf8'))
  const literalPairs = [
    ...contentIf.matchAll(/github\.event\.issue\.number == (\d+) && github\.event\.sender\.id == (\d+)/g),
  ].map(match => `${match[1]}:${match[2]}`)

  // An issue number no program names, so the "unrelated issue" case cannot collide with a configured one.
  const configuredNumbers = new Set(config.programs.map(entry => issueRef(entry).number))
  const unconfiguredIssueNumber = Math.max(0, ...configuredNumbers) + 1000

  it('picks an unrelated issue number that no program uses', () => {
    expect(configuredNumbers.has(unconfiguredIssueNumber)).toBe(false)
  })

  it('carries one issue-number and operator-ID pair for each configured program, and no other', () => {
    const configured = config.programs.map(entry => `${issueRef(entry).number}:${entry.operator.id}`)

    expect(literalPairs.sort()).toEqual(configured.sort())
  })

  it('serves tracker issues of this repository only, because the job can only name an issue number', () => {
    for (const entry of config.programs) {
      expect(issueRef(entry).repo).toBe('fro-bot/.github')
    }
  })

  it("skips each configured operator on that program's issue and no one else", () => {
    for (const entry of config.programs) {
      const issueNumber = issueRef(entry).number
      const operator = commentEvent({issueNumber, login: entry.operator.login, userId: entry.operator.id})
      const stranger = commentEvent({issueNumber, login: entry.operator.login, userId: entry.operator.id + 1})
      const elsewhere = commentEvent({
        issueNumber: unconfiguredIssueNumber,
        login: entry.operator.login,
        userId: entry.operator.id,
      })

      expect(evaluateExpression(contentIf, operator)).toBe(false)
      expect(evaluateExpression(contentIf, stranger)).toBe(true)
      expect(evaluateExpression(contentIf, elsewhere)).toBe(true)
    }
  })
})

describe('fro-bot.yaml: program requests read the program skill', () => {
  const env = froBotParsed.env as Record<string, string>
  const note = flat(env.PROGRAM_REQUEST_NOTE ?? '')

  it('names the skill by path and limits itself to program requests', () => {
    expect(note).toContain('A request to start, run or close out a cross-repo program')
    expect(note).toContain('.agents/skills/cross-repo-program/SKILL.md')
    expect(note).toContain('Read it before you act on such a request')
    expect(note).toContain('It does not apply to any other request')
  })

  it.each(['fro-bot-remediate', 'fro-bot-observe'])(
    'puts the note ahead of the task in the %s agent prompt',
    jobName => {
      const step = froBotParsed.jobs[jobName]?.steps?.find(candidate => candidate.id === 'fro-bot-agent')
      const prompt = String(step?.with?.prompt ?? '')
      const noteReference = '$' + '{{ env.PROGRAM_NOTE }}'
      const taskReference = '$' + '{{ env.TASK_PROMPT }}'

      expect(prompt).toContain(noteReference)
      expect(prompt.indexOf(noteReference)).toBeLessThan(prompt.indexOf(taskReference))
      expect(prompt.indexOf(noteReference)).toBeGreaterThan(prompt.indexOf('</persona>'))
    },
  )

  it.each(['fro-bot-remediate', 'fro-bot-observe'])(
    'adds the note to a custom dispatch prompt and to nothing else in %s',
    jobName => {
      const step = froBotParsed.jobs[jobName]?.steps?.find(candidate => candidate.id === 'fro-bot-agent')
      const expression = String(step?.env?.PROGRAM_NOTE ?? '')
      const inner = /\$\{\{([\s\S]*)\}\}/.exec(expression)?.[1] ?? ''
      const context = (eventName: string, prompt: string): unknown => ({
        github: {event_name: eventName, event: {inputs: {prompt}}},
        env: {PROGRAM_REQUEST_NOTE: 'NOTE'},
        inputs: {prompt: ''},
      })

      expect(evaluateExpressionValue(inner, context('workflow_dispatch', 'start a program for X'))).toBe('NOTE')
      expect(evaluateExpressionValue(inner, context('workflow_dispatch', ''))).toBe('')
      expect(evaluateExpressionValue(inner, context('schedule', ''))).toBe('')
      expect(evaluateExpressionValue(inner, context('schedule', 'x'))).toBe('')
    },
  )

  it('does not touch the prompt of the content-trigger job', () => {
    const step = froBotParsed.jobs['fro-bot']?.steps?.find(candidate => candidate.id === 'fro-bot-agent')

    expect(String(step?.with?.prompt ?? '')).not.toContain('PROGRAM_NOTE')
    expect(step?.env?.PROGRAM_NOTE).toBeUndefined()
  })
})
