/**
 * Pins which kind of work each agent step is, and that each one reads the model the `agent-model` action
 * resolved. The action's own behavior (the tier pick, the fallback, the failure messages) is pinned once, in
 * `agent-model-action.test.ts`. This file pins who calls it, with what, and what the agent step receives.
 *
 * Every `fro-bot/agent` step in `.github/workflows/` must appear in {@link AGENT_STEPS}. A new agent step fails
 * here until it is classified.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {evaluateExpressionValue} from '@fro-bot/test-kit/workflow-expression'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../.github/workflows')
const ACTION = './.github/actions/agent-model'
const ACTION_FILE = resolve(import.meta.dirname, '../.github/actions/agent-model/action.yaml')
const AGENT_PREFIX = 'fro-bot/agent@'
const RESOLVER_ID = 'agent-model'
// Literal GitHub Actions expression syntax, split to dodge eslint's no-template-curly-in-string rule.
const OPEN = '$' + '{{'
const expr = (body: string): string => `${OPEN} ${body} }}`

const RESOLVED = expr(`steps.${RESOLVER_ID}.outputs.model`)
const HARVEST_RESOLVED = expr('needs.harvest.outputs.model')

/** Review for a pull request run, light for everything else the content job answers. */
const CONTENT_TIER = expr(
  "(github.event_name == 'pull_request' || github.event_name == 'pull_request_review_comment' || (github.event_name == 'issue_comment' && github.event.issue.pull_request != null)) && 'review' || 'light'",
)

const RESOLVER_INPUTS = {
  review: expr('vars.FRO_BOT_MODEL_REVIEW'),
  act: expr('vars.FRO_BOT_MODEL_ACT'),
  light: expr('vars.FRO_BOT_MODEL_LIGHT'),
  fallback: expr('vars.FRO_BOT_MODEL'),
} as const

interface Step {
  name?: string
  id?: string
  uses?: string
  if?: string
  run?: string
  shell?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
  'continue-on-error'?: unknown
}

interface Job {
  needs?: unknown
  outputs?: Record<string, unknown>
  steps?: Step[]
}

interface Workflow {
  jobs?: Record<string, Job>
}

function load(file: string): Workflow {
  return parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8')) as Workflow
}

function jobOf(file: string, job: string): Job {
  const found = load(file).jobs?.[job]
  if (found === undefined) throw new TypeError(`${file} has no job ${job}`)
  return found
}

function stepsOf(file: string, job: string): readonly Step[] {
  const steps = jobOf(file, job).steps
  if (steps === undefined) throw new TypeError(`${file} has no steps in ${job}`)
  return steps
}

interface AgentRow {
  /** `<workflow>/<job>/<step id>`. */
  readonly key: string
  /** The tier input the job's resolver step carries. */
  readonly tier: string
  /** The job whose resolver step supplies the model: the agent step's own job, or `harvest` for `draft`. */
  readonly resolverJob: string
  /** What the agent step's `model` input reads. */
  readonly model: string
}

const AGENT_STEPS: readonly AgentRow[] = [
  {
    key: 'fro-bot.yaml/fro-bot/fro-bot-agent',
    tier: CONTENT_TIER,
    resolverJob: 'fro-bot',
    model: RESOLVED,
  },
  {key: 'fro-bot.yaml/fro-bot-remediate/fro-bot-agent', tier: 'act', resolverJob: 'fro-bot-remediate', model: RESOLVED},
  {key: 'fro-bot.yaml/fro-bot-observe/fro-bot-agent', tier: 'act', resolverJob: 'fro-bot-observe', model: RESOLVED},
  {key: 'survey-repo.yaml/survey-repo/survey-agent', tier: 'act', resolverJob: 'survey-repo', model: RESOLVED},
  {key: 'survey-repo.yaml/survey-repo/survey-agent-retry-1', tier: 'act', resolverJob: 'survey-repo', model: RESOLVED},
  {key: 'survey-repo.yaml/survey-repo/survey-agent-retry-2', tier: 'act', resolverJob: 'survey-repo', model: RESOLVED},
  {
    key: 'capture-learnings.yaml/capture-learnings/agent',
    tier: 'light',
    resolverJob: 'capture-learnings',
    model: RESOLVED,
  },
  {key: 'capture-patterns.yaml/open/agent', tier: 'light', resolverJob: 'open', model: RESOLVED},
  {key: 'draft-solutions.yaml/draft/agent', tier: 'light', resolverJob: 'harvest', model: HARVEST_RESOLVED},
]

interface Found {
  readonly key: string
  readonly workflow: string
  readonly job: string
  readonly step: Step
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.yaml'))
}

function foundAgentSteps(): Found[] {
  const found: Found[] = []
  for (const file of workflowFiles()) {
    for (const [job, body] of Object.entries(load(file).jobs ?? {})) {
      for (const step of body.steps ?? []) {
        if (step.uses?.startsWith(AGENT_PREFIX) === true) {
          found.push({key: `${file}/${job}/${step.id ?? '(no id)'}`, workflow: file, job, step})
        }
      }
    }
  }
  return found
}

function foundResolvers(): string[] {
  const found: string[] = []
  for (const file of workflowFiles()) {
    for (const [job, body] of Object.entries(load(file).jobs ?? {})) {
      for (const step of body.steps ?? []) {
        if (step.uses === ACTION) found.push(`${file}/${job}`)
      }
    }
  }
  return found
}

/** The jobs that hold a resolver step, with the tier each one passes. */
function resolverJobs(): {workflow: string; job: string; tier: string}[] {
  const jobs = new Map<string, {workflow: string; job: string; tier: string}>()
  for (const row of AGENT_STEPS) {
    const [workflow = ''] = row.key.split('/')
    jobs.set(`${workflow}/${row.resolverJob}`, {workflow, job: row.resolverJob, tier: row.tier})
  }
  return [...jobs.values()]
}

function indexOfStep(steps: readonly Step[], predicate: (step: Step) => boolean, label: string): number {
  const index = steps.findIndex(predicate)
  if (index === -1) throw new TypeError(`no step: ${label}`)
  return index
}

const isCheckout = (step: Step): boolean => step.uses?.startsWith('actions/checkout@') === true
const isAgent = (step: Step): boolean => step.uses?.startsWith(AGENT_PREFIX) === true

describe('agent model callers: the classification is total', () => {
  it('puts every fro-bot/agent step in the table, and nothing else', () => {
    expect(
      foundAgentSteps()
        .map(found => found.key)
        .toSorted(),
    ).toStrictEqual(AGENT_STEPS.map(row => row.key).toSorted())
  })

  it('has nine agent steps: the content job, Remediate, Observe, three survey attempts and three capture steps', () => {
    expect(AGENT_STEPS).toHaveLength(9)
    expect(foundAgentSteps()).toHaveLength(9)
  })

  it('holds a resolver in exactly the jobs the table names, once each', () => {
    const expected = resolverJobs().map(job => `${job.workflow}/${job.job}`)

    expect(foundResolvers().toSorted()).toStrictEqual(expected.toSorted())
    expect(new Set(foundResolvers()).size).toBe(foundResolvers().length)
  })

  it('classifies Remediate, Observe and every survey attempt as act, and the capture jobs as light', () => {
    const tierOf = (key: string): string | undefined => AGENT_STEPS.find(row => row.key === key)?.tier

    for (const key of [
      'fro-bot.yaml/fro-bot-remediate/fro-bot-agent',
      'fro-bot.yaml/fro-bot-observe/fro-bot-agent',
      'survey-repo.yaml/survey-repo/survey-agent',
      'survey-repo.yaml/survey-repo/survey-agent-retry-1',
      'survey-repo.yaml/survey-repo/survey-agent-retry-2',
    ]) {
      expect(tierOf(key), key).toBe('act')
    }
    for (const key of [
      'capture-learnings.yaml/capture-learnings/agent',
      'capture-patterns.yaml/open/agent',
      'draft-solutions.yaml/draft/agent',
    ]) {
      expect(tierOf(key), key).toBe('light')
    }
  })
})

describe('agent model callers: every agent step reads the resolved model', () => {
  it.each(AGENT_STEPS)('$key reads $model and no repository variable', row => {
    const found = foundAgentSteps().find(candidate => candidate.key === row.key)

    expect(found, row.key).toBeDefined()
    expect(found?.step.with?.model).toBe(row.model)
    expect(String(found?.step.with?.model)).not.toContain('vars.')
  })

  it('no agent step names a repository variable anywhere in its model input or its env', () => {
    for (const found of foundAgentSteps()) {
      expect(JSON.stringify(found.step.with?.model), found.key).not.toContain('vars.')
      expect(JSON.stringify(found.step.env ?? {}), found.key).not.toContain('FRO_BOT_MODEL')
    }
  })

  it('the survey attempts read one resolved value', () => {
    const models = foundAgentSteps()
      .filter(found => found.workflow === 'survey-repo.yaml')
      .map(found => found.step.with?.model)

    expect(models).toStrictEqual([RESOLVED, RESOLVED, RESOLVED])
  })
})

describe.each(resolverJobs())('agent model resolver in $workflow / $job', ({workflow, job, tier}) => {
  const steps = stepsOf(workflow, job)
  const resolverIndex = steps.findIndex(step => step.uses === ACTION)
  const resolver = steps[resolverIndex]

  it('is the only resolver step in the job, with the expected id and no if:, env, run or continue-on-error', () => {
    expect(steps.filter(step => step.uses === ACTION)).toHaveLength(1)
    expect(resolver?.id).toBe(RESOLVER_ID)
    expect(resolver?.if).toBeUndefined()
    expect(resolver?.['continue-on-error']).toBeUndefined()
    expect(resolver?.env).toBeUndefined()
    expect(resolver?.run).toBeUndefined()
  })

  it('passes the tier and the four variables through with: only', () => {
    expect(resolver?.with).toStrictEqual({tier, ...RESOLVER_INPUTS})
  })

  it('runs after the checkout', () => {
    expect(resolverIndex).toBeGreaterThan(indexOfStep(steps, isCheckout, 'checkout'))
  })

  it('runs before every agent step of its own job', () => {
    expect(resolverIndex).toBeGreaterThanOrEqual(0)
    for (const [index, step] of steps.entries()) {
      if (isAgent(step)) expect(index, step.id).toBeGreaterThan(resolverIndex)
    }
  })

  it('carries no credential', () => {
    const text = JSON.stringify(resolver)

    expect(text).not.toContain('secrets.')
    expect(text).not.toContain('token')
  })
})

describe('agent model callers: the job-level resolver is never skipped', () => {
  it.each(resolverJobs())(
    '$workflow / $job has no job-level continue-on-error that could hide a failed resolver',
    ({workflow, job}) => {
      expect(jobOf(workflow, job)).not.toHaveProperty('continue-on-error')
    },
  )
})

describe('agent model callers: the survey shares one resolver and a summary stays next to its agent step', () => {
  const steps = stepsOf('survey-repo.yaml', 'survey-repo')

  it('has one resolver before the first of three attempts', () => {
    const agents = steps.filter(isAgent)

    expect(agents.map(step => step.id)).toStrictEqual(['survey-agent', 'survey-agent-retry-1', 'survey-agent-retry-2'])
    expect(steps.filter(step => step.uses === ACTION)).toHaveLength(1)
  })

  it.each([
    'fro-bot.yaml/fro-bot',
    'fro-bot.yaml/fro-bot-remediate',
    'fro-bot.yaml/fro-bot-observe',
    'survey-repo.yaml/survey-repo',
  ])('in %s the step right after each agent step is the knowledge summary, not the resolver', path => {
    const [workflow = '', job = ''] = path.split('/')
    const jobSteps = stepsOf(workflow, job)

    for (const [index, step] of jobSteps.entries()) {
      if (!isAgent(step)) continue
      expect(jobSteps[index + 1]?.uses, step.id).toBe('./.github/actions/knowledge-mcp-summary')
    }
  })
})

describe('agent model callers: draft-solutions resolves in harvest and checks again in draft', () => {
  const harvest = jobOf('draft-solutions.yaml', 'harvest')
  const draft = jobOf('draft-solutions.yaml', 'draft')
  const harvestSteps = harvest.steps ?? []
  const draftSteps = draft.steps ?? []
  const guardIndex = draftSteps.findIndex(step => step.id === 'require-agent-model')
  const guard = draftSteps[guardIndex]
  const guardScript = String(guard?.run ?? '')

  it('resolves before the harvest step and exposes the model as a job output', () => {
    const resolverIndex = harvestSteps.findIndex(step => step.uses === ACTION)

    expect(resolverIndex).toBeGreaterThanOrEqual(0)
    expect(resolverIndex).toBeLessThan(indexOfStep(harvestSteps, step => step.id === 'harvest', 'harvest step'))
    expect(resolverIndex).toBeGreaterThan(indexOfStep(harvestSteps, isCheckout, 'harvest checkout'))
    expect(harvest.outputs?.model).toBe(RESOLVED)
  })

  it('has no resolver in draft, which runs on a checkout that can predate the action', () => {
    expect(draftSteps.some(step => step.uses === ACTION)).toBe(false)
    expect(draft.needs).toBe('harvest')
  })

  it('checks the received model in a step before the agent, with no if: or continue-on-error', () => {
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(indexOfStep(draftSteps, isAgent, 'draft agent'))
    expect(guard?.if).toBeUndefined()
    expect(guard?.['continue-on-error']).toBeUndefined()
    expect(guard?.shell).toBe('bash')
    expect(guard?.env).toStrictEqual({AGENT_MODEL: HARVEST_RESOLVED})
    expect(guardScript).not.toContain(OPEN)
  })

  it('reads the same value in the agent step as the guard checks', () => {
    const agent = draftSteps.find(isAgent)

    expect(agent?.with?.model).toBe(HARVEST_RESOLVED)
    expect(guard?.env?.AGENT_MODEL).toBe(agent?.with?.model)
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only a line break', '\n'],
  ] as const)('the guard fails with a fixed message when the received model is %s', (_label, value) => {
    const result = runStepWithStubs(guardScript, {env: {AGENT_MODEL: value}})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe('::error::draft-solutions: the harvest job passed no agent model.\n')
    expect(result.stdout).toBe('')
  })

  it('the guard passes, silently, when a model arrived', () => {
    const result = runStepWithStubs(guardScript, {env: {AGENT_MODEL: 'provider/model'}})

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})

describe('agent model callers: the content job tier, per event', () => {
  const resolver = stepsOf('fro-bot.yaml', 'fro-bot').find(step => step.uses === ACTION)
  const tier = String(resolver?.with?.tier ?? '')
  const inner = /^\$\{\{([\s\S]*)\}\}$/u.exec(tier)?.[1]

  const pullRequestIssue = {number: 7, pull_request: {url: 'https://api.github.com/repos/fro-bot/.github/pulls/7'}}
  const plainIssue = {number: 8}

  const evaluate = (eventName: string, issue?: Record<string, unknown>): unknown => {
    if (inner === undefined) throw new TypeError('the content job tier is not an expression')
    return evaluateExpressionValue(inner, {github: {event_name: eventName, event: issue === undefined ? {} : {issue}}})
  }

  it('is the expression the table pins', () => {
    expect(tier).toBe(CONTENT_TIER)
  })

  it.each([
    ['pull_request', 'pull_request', undefined],
    ['pull_request_review_comment', 'pull_request_review_comment', undefined],
    ['an issue comment on a pull request', 'issue_comment', pullRequestIssue],
  ] as const)('is review for %s', (_label, eventName, issue) => {
    expect(evaluate(eventName, issue)).toBe('review')
  })

  it.each([
    ['issues', 'issues', plainIssue],
    ['an issue comment on an issue', 'issue_comment', plainIssue],
    ['discussion_comment', 'discussion_comment', undefined],
  ] as const)('is light for %s', (_label, eventName, issue) => {
    expect(evaluate(eventName, issue)).toBe('light')
  })

  it('is light for an event no trigger of the content job names', () => {
    expect(evaluate('workflow_dispatch')).toBe('light')
  })
})

describe('agent model callers: with only FRO_BOT_MODEL_REVIEW and FRO_BOT_MODEL set', () => {
  const action = parse(readFileSync(ACTION_FILE, 'utf8')) as {runs?: {steps?: Step[]}}
  const script = String(action.runs?.steps?.find(step => step.id === 'resolve')?.run ?? '')
  const VARIABLES = {FRO_BOT_MODEL_REVIEW: 'openai/review-model', FRO_BOT_MODEL: 'anthropic/act-model'} as const

  /** A resolver input as Actions renders it: an expression is evaluated, a literal is passed as is. */
  function render(value: unknown, context: unknown): string {
    const text = String(value)
    const body = /^\$\{\{([\s\S]*)\}\}$/u.exec(text)?.[1]
    if (body === undefined) return text
    const result = evaluateExpressionValue(body, context)
    return typeof result === 'string' ? result : ''
  }

  /** The model the agent step of `row` would be given, resolved from the job's resolver step and the variables. */
  function modelFor(
    workflow: string,
    job: string,
    context: Record<string, unknown>,
  ): ReturnType<typeof runStepWithStubs> {
    const resolver = stepsOf(workflow, job).find(step => step.uses === ACTION)
    const withs = resolver?.with ?? {}
    return runStepWithStubs(script, {
      env: {
        AGENT_MODEL_TIER: render(withs.tier, context),
        AGENT_MODEL_REVIEW: render(withs.review, context),
        AGENT_MODEL_ACT: render(withs.act, context),
        AGENT_MODEL_LIGHT: render(withs.light, context),
        AGENT_MODEL_FALLBACK: render(withs.fallback, context),
      },
    })
  }

  const pullRequestIssue = {number: 7, pull_request: {url: 'https://api.github.com/repos/fro-bot/.github/pulls/7'}}

  it.each([
    [
      'a pull request review',
      {github: {event_name: 'pull_request', event: {}}},
      'openai/review-model',
      'FRO_BOT_MODEL_REVIEW',
    ],
    [
      'a review comment mention',
      {github: {event_name: 'pull_request_review_comment', event: {}}},
      'openai/review-model',
      'FRO_BOT_MODEL_REVIEW',
    ],
    [
      'a comment on a pull request',
      {github: {event_name: 'issue_comment', event: {issue: pullRequestIssue}}},
      'openai/review-model',
      'FRO_BOT_MODEL_REVIEW',
    ],
    [
      'an issue run',
      {github: {event_name: 'issues', event: {issue: {number: 8}}}},
      'anthropic/act-model',
      'FRO_BOT_MODEL',
    ],
    [
      'a comment on an issue',
      {github: {event_name: 'issue_comment', event: {issue: {number: 8}}}},
      'anthropic/act-model',
      'FRO_BOT_MODEL',
    ],
    [
      'a discussion comment',
      {github: {event_name: 'discussion_comment', event: {}}},
      'anthropic/act-model',
      'FRO_BOT_MODEL',
    ],
  ] as const)('the content job resolves %s', (_label, base, model, source) => {
    const result = modelFor('fro-bot.yaml', 'fro-bot', {...base, vars: VARIABLES})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model})
    expect(result.stdout).toBe(`Agent model: ${model} (from ${source})\n`)
  })

  it.each([
    ['fro-bot.yaml', 'fro-bot-remediate'],
    ['fro-bot.yaml', 'fro-bot-observe'],
    ['survey-repo.yaml', 'survey-repo'],
    ['capture-learnings.yaml', 'capture-learnings'],
    ['capture-patterns.yaml', 'open'],
    ['draft-solutions.yaml', 'harvest'],
  ] as const)('%s / %s resolves to the fallback', (workflow, job) => {
    const result = modelFor(workflow, job, {github: {event_name: 'schedule', event: {}}, vars: VARIABLES})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: 'anthropic/act-model'})
    expect(result.stdout).toBe('Agent model: anthropic/act-model (from FRO_BOT_MODEL)\n')
  })

  it('every job fails before the agent when no variable is set at all', () => {
    for (const {workflow, job} of resolverJobs()) {
      const result = modelFor(workflow, job, {github: {event_name: 'schedule', event: {}}, vars: {}})

      expect(result.status, `${workflow}/${job}`).not.toBe(0)
      expect(result.githubOutput, `${workflow}/${job}`).toBe('')
    }
  })
})
