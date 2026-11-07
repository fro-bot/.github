/**
 * Pins which agent steps get the `knowledge` MCP server and how. The action's own behavior (the merge,
 * the masking, the fork pass-through) is pinned once, in `knowledge-mcp-config-action.test.ts`; the server
 * is pinned in `knowledge-mcp-server.test.ts`. This file pins who calls the action and what they tell the
 * model.
 *
 * Every `fro-bot/agent` step in `.github/workflows/` must appear in exactly one table: {@link CALLERS}
 * (the config comes from the action) or {@link RAW_SECRET_STEPS} (the config is the raw secret). A new agent
 * step fails here until it is classified.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../.github/workflows')
const ACTION = './.github/actions/knowledge-mcp-config'
const SUMMARY_ACTION = './.github/actions/knowledge-mcp-summary'
const AGENT_PREFIX = 'fro-bot/agent@'
// Literal GitHub Actions expression syntax, split to dodge eslint's no-template-curly-in-string rule.
const OPEN = '$' + '{{'
const expr = (body: string): string => `${OPEN} ${body} }}`

const SECRET = expr('secrets.OPENCODE_CONFIG')
const CONFIG_OUTPUT = expr('steps.knowledge-mcp.outputs.opencode-config')
const CALL_LOG_OUTPUT = expr('steps.knowledge-mcp.outputs.call-log')
const SUMMARY_IF = expr(`always() && steps.knowledge-mcp.outputs.call-log != ''`)
const FORK_FLAG = expr('github.event.pull_request.head.repo.fork')
const TOOL_IDS = ['knowledge_wiki_search', 'knowledge_wiki_linked', 'knowledge_solutions_search'] as const
const RECIPE_LINKED = `WIKI_CONTEXT_HANDOFF_PATH='${OPEN} env.WIKI_CONTEXT_HANDOFF_PATH }}' bun scripts/wiki-context-expand.ts linked`
const RECIPE_QUERY = 'bun scripts/wiki-context-expand.ts query "<short grounded query>"'

interface Step {
  name?: string
  id?: string
  uses?: string
  if?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
}

interface Job {
  steps?: Step[]
}

interface Workflow {
  jobs?: Record<string, Job>
}

function load(file: string): Workflow {
  return parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8')) as Workflow
}

function stepsOf(file: string, job: string): readonly Step[] {
  const steps = load(file).jobs?.[job]?.steps
  if (steps === undefined) throw new TypeError(`${file} has no job ${job}`)
  return steps
}

function indexOfStep(steps: readonly Step[], predicate: (step: Step) => boolean, label: string): number {
  const index = steps.findIndex(predicate)
  if (index === -1) throw new TypeError(`no step: ${label}`)
  return index
}

interface Caller {
  readonly workflow: string
  readonly job: string
  /** The agent step ids that read the action's output, in file order. */
  readonly agentSteps: readonly string[]
  /** The action's `handoff-path`, or undefined when the job has no handoff. */
  readonly handoffPath?: string
  /** The action's `fork` input, or undefined when the job passes none. */
  readonly fork?: string
  /** Whether the prompt carries the Fro Bot guidance (all three tools plus the bash recipe) or the survey one (two search tools). */
  readonly prompt: 'fro-bot' | 'survey'
}

const CALLERS: readonly Caller[] = [
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot',
    agentSteps: ['fro-bot-agent'],
    handoffPath: `${expr('runner.temp')}/wiki-context-handoff-${expr('github.run_id')}-${expr(
      'github.run_attempt',
    )}.json`,
    fork: FORK_FLAG,
    prompt: 'fro-bot',
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-remediate',
    agentSteps: ['fro-bot-agent'],
    handoffPath: `${expr('runner.temp')}/wiki-context-handoff-${expr('github.run_id')}-${expr(
      'github.run_attempt',
    )}-remediate.json`,
    fork: FORK_FLAG,
    prompt: 'fro-bot',
  },
  {
    workflow: 'fro-bot.yaml',
    job: 'fro-bot-observe',
    agentSteps: ['fro-bot-agent'],
    handoffPath: `${expr('runner.temp')}/wiki-context-handoff-${expr('github.run_id')}-${expr(
      'github.run_attempt',
    )}-observe.json`,
    fork: FORK_FLAG,
    prompt: 'fro-bot',
  },
  {
    workflow: 'survey-repo.yaml',
    job: 'survey-repo',
    agentSteps: ['survey-agent', 'survey-agent-retry-1', 'survey-agent-retry-2'],
    prompt: 'survey',
  },
]

/** The agent steps that keep the raw secret: their prompts limit them to a supplied digest, or they run on an older checkout. */
const RAW_SECRET_STEPS: readonly string[] = [
  'capture-learnings.yaml/capture-learnings/agent',
  'capture-patterns.yaml/open/agent',
  'draft-solutions.yaml/draft/agent',
]

/** What the excerpt steps looked like before the server existed; they are not touched. */
const EXCERPT_STEPS = {
  'wiki-query': {
    env: [
      'WIKI_QUERY_EVENT_NAME',
      'WIKI_QUERY_OWNER',
      'WIKI_QUERY_REPO',
      'WIKI_QUERY_TITLE',
      'WIKI_QUERY_BODY',
      'WIKI_CONTEXT_HANDOFF_PATH',
    ],
    run: 'bun scripts/wiki-query.ts',
  },
  'solutions-query': {
    env: [
      'SOLUTIONS_QUERY_EVENT_NAME',
      'SOLUTIONS_QUERY_OWNER',
      'SOLUTIONS_QUERY_REPO',
      'SOLUTIONS_QUERY_TITLE',
      'SOLUTIONS_QUERY_BODY',
    ],
    run: 'bun scripts/solutions-query.ts',
  },
} as const

function agentSteps(): {key: string; workflow: string; job: string; step: Step}[] {
  const found: {key: string; workflow: string; job: string; step: Step}[] = []
  for (const file of readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.yaml'))) {
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

describe('knowledge MCP callers: the classification is total', () => {
  it('puts every fro-bot/agent step in exactly one table', () => {
    const configured = CALLERS.flatMap(caller => caller.agentSteps.map(id => `${caller.workflow}/${caller.job}/${id}`))

    expect(
      agentSteps()
        .map(found => found.key)
        .toSorted(),
    ).toStrictEqual([...configured, ...RAW_SECRET_STEPS].toSorted())
  })

  it('keeps the raw secret on the steps that are not in the table, and nowhere else', () => {
    for (const found of agentSteps()) {
      const raw = RAW_SECRET_STEPS.includes(found.key)
      expect(found.step.with?.['opencode-config'], found.key).toBe(raw ? SECRET : CONFIG_OUTPUT)
    }
  })
})

describe('knowledge MCP callers: the call-log summary', () => {
  it('appears only in the jobs of the table, once per agent step', () => {
    const found: string[] = []
    for (const file of readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.yaml'))) {
      for (const [job, body] of Object.entries(load(file).jobs ?? {})) {
        for (const step of body.steps ?? []) {
          if (step.uses === SUMMARY_ACTION) found.push(`${file}/${job}`)
        }
      }
    }

    const expected = CALLERS.flatMap(caller => caller.agentSteps.map(() => `${caller.workflow}/${caller.job}`))
    expect(found.toSorted()).toStrictEqual(expected.toSorted())
  })
})

describe.each(CALLERS)('knowledge MCP caller $workflow / $job', caller => {
  const steps = stepsOf(caller.workflow, caller.job)
  const configIndex = indexOfStep(steps, step => step.uses === ACTION, 'knowledge-mcp-config')
  const configStep = steps[configIndex]

  it('has exactly one config step, with the expected id, and no if: or env', () => {
    expect(steps.filter(step => step.uses === ACTION)).toHaveLength(1)
    expect(configStep?.id).toBe('knowledge-mcp')
    expect(configStep?.if).toBeUndefined()
    expect(configStep?.env).toBeUndefined()
    expect(configStep?.run).toBeUndefined()
  })

  it('passes the secret, the handoff path and the fork flag through with: only', () => {
    expect(configStep?.with).toStrictEqual({
      'opencode-config': SECRET,
      ...(caller.handoffPath === undefined ? {} : {'handoff-path': caller.handoffPath}),
      ...(caller.fork === undefined ? {} : {fork: caller.fork}),
    })
  })

  it('runs after the checkout and the setup that installs the server dependencies', () => {
    const checkoutAt = indexOfStep(steps, step => step.uses?.startsWith('actions/checkout@') === true, 'checkout')
    const setupAt = indexOfStep(steps, step => step.uses === './.github/actions/setup', 'setup')

    expect(checkoutAt).toBeLessThan(setupAt)
    expect(setupAt).toBeLessThan(configIndex)
  })

  it('runs before every agent step, and each agent step reads its output', () => {
    const agents = steps.filter(step => step.uses?.startsWith(AGENT_PREFIX) === true)

    expect(agents.map(step => step.id)).toStrictEqual([...caller.agentSteps])
    for (const agent of agents) {
      expect(steps.indexOf(agent)).toBeGreaterThan(configIndex)
      expect(agent.with?.['opencode-config']).toBe(CONFIG_OUTPUT)
    }
  })

  it.each(caller.agentSteps)(
    'agent step %s has exactly one summary step right after it, reading the same config step output',
    id => {
      const agentAt = indexOfStep(steps, step => step.id === id, id)
      const nextAgentAt = steps.findIndex(
        (step, index) => index > agentAt && step.uses?.startsWith(AGENT_PREFIX) === true,
      )
      const between = steps.slice(agentAt + 1, nextAgentAt === -1 ? steps.length : nextAgentAt)
      const summary = steps[agentAt + 1]

      expect(summary?.uses).toBe(SUMMARY_ACTION)
      expect(summary?.name).toBe('Summarize knowledge tool calls')
      expect(summary?.if).toBe(SUMMARY_IF)
      expect(summary?.with).toStrictEqual({'call-log': CALL_LOG_OUTPUT})
      expect(summary?.id).toBeUndefined()
      expect(summary?.env).toBeUndefined()
      expect(summary?.run).toBeUndefined()
      // The step carries no secret and no credential.
      expect(JSON.stringify(summary)).not.toContain('secrets.')
      expect(JSON.stringify(summary)).not.toContain('token')
      expect(between.filter(step => step.uses === SUMMARY_ACTION)).toHaveLength(1)
    },
  )

  it.each(caller.agentSteps)('agent step %s names the right tools in its prompt', id => {
    const prompt = String(steps.find(step => step.id === id)?.with?.prompt ?? '')

    if (caller.prompt === 'survey') {
      expect(prompt).toContain('knowledge_wiki_search')
      expect(prompt).toContain('knowledge_solutions_search')
      expect(prompt).not.toContain('knowledge_wiki_linked')
      expect(prompt).not.toContain('wiki-context-expand')
      return
    }
    for (const tool of TOOL_IDS) expect(prompt).toContain(`\`${tool}\``)
    // The bash recipe stays as the fallback until a release that keeps credential-free servers on every trigger is pinned.
    expect(prompt).toContain(RECIPE_LINKED)
    expect(prompt).toContain(RECIPE_QUERY)
    expect(prompt.indexOf('knowledge_wiki_search')).toBeLessThan(prompt.indexOf(RECIPE_LINKED))
  })
})

describe('knowledge MCP callers: nothing else moves', () => {
  it.each(CALLERS.filter(caller => caller.prompt === 'fro-bot'))(
    'the excerpt steps of $job keep their env keys and command, and the agent step still reads them',
    caller => {
      const steps = stepsOf(caller.workflow, caller.job)

      for (const [id, expected] of Object.entries(EXCERPT_STEPS)) {
        const step = steps.find(candidate => candidate.id === id)
        expect(Object.keys(step?.env ?? {}), `${caller.job}/${id}`).toStrictEqual([...expected.env])
        expect(step?.run, `${caller.job}/${id}`).toBe(expected.run)
      }
      const agent = steps.find(step => step.id === 'fro-bot-agent')
      expect(agent?.env?.WIKI_CONTEXT).toBe(expr('steps.wiki-query.outputs.excerpt'))
      expect(agent?.env?.SOLUTIONS_CONTEXT).toBe(expr('steps.solutions-query.outputs.excerpt'))
    },
  )

  it.each(CALLERS.filter(caller => caller.prompt === 'fro-bot'))(
    'the handoff path the agent step declares is the one the config step passes ($job)',
    caller => {
      const steps = stepsOf(caller.workflow, caller.job)
      const agent = steps.find(step => step.id === 'fro-bot-agent')
      const producer = steps.find(step => step.id === 'wiki-query')

      expect(agent?.env?.WIKI_CONTEXT_HANDOFF_PATH).toBe(caller.handoffPath)
      expect(producer?.env?.WIKI_CONTEXT_HANDOFF_PATH).toBe(caller.handoffPath)
    },
  )
})
