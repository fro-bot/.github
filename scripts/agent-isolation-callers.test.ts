/**
 * Pins that every `fro-bot/agent` step runs under `isolate-agent`, and that every checkout in its job leaves no git
 * credential on disk. Under isolation the agent can read the checkout, so a persisted credential would reach it; the
 * step receives its token through the explicit `github-token` input instead, and a checkout that needs a token keeps
 * its own `token` input.
 *
 * The list is found, not written down: a new agent step fails here until it opts in.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

const WORKFLOWS_DIR = resolve(import.meta.dirname, '../.github/workflows')
const AGENT_PREFIX = 'fro-bot/agent@'
const CHECKOUT_PREFIX = 'actions/checkout@'

interface Step {
  name?: string
  id?: string
  uses?: string
  with?: Record<string, unknown>
}

interface Job {
  steps?: Step[]
}

interface Workflow {
  jobs?: Record<string, Job>
}

interface AgentJob {
  /** `<workflow>/<job>/<step id>`. */
  readonly key: string
  readonly agent: Step
  readonly checkouts: readonly Step[]
}

function foundAgentJobs(): AgentJob[] {
  const found: AgentJob[] = []
  for (const file of readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.yaml'))) {
    const workflow = parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8')) as Workflow
    for (const [job, body] of Object.entries(workflow.jobs ?? {})) {
      const steps = body.steps ?? []
      const checkouts = steps.filter(step => step.uses?.startsWith(CHECKOUT_PREFIX) === true)
      for (const agent of steps.filter(step => step.uses?.startsWith(AGENT_PREFIX) === true)) {
        found.push({key: `${file}/${job}/${agent.id ?? '(no id)'}`, agent, checkouts})
      }
    }
  }
  return found
}

describe('isolate-agent: every agent step is isolated and every checkout in its job is unpersisted', () => {
  const agentJobs = foundAgentJobs()

  it('finds the nine agent steps: the content job, Remediate, Observe, three survey attempts and three capture steps', () => {
    expect(agentJobs.map(found => found.key).toSorted()).toStrictEqual([
      'capture-learnings.yaml/capture-learnings/agent',
      'capture-patterns.yaml/open/agent',
      'draft-solutions.yaml/draft/agent',
      'fro-bot.yaml/fro-bot-observe/fro-bot-agent',
      'fro-bot.yaml/fro-bot-remediate/fro-bot-agent',
      'fro-bot.yaml/fro-bot/fro-bot-agent',
      'survey-repo.yaml/survey-repo/survey-agent',
      'survey-repo.yaml/survey-repo/survey-agent-retry-1',
      'survey-repo.yaml/survey-repo/survey-agent-retry-2',
    ])
  })

  it.each(agentJobs.map(found => [found.key, found] as const))('%s sets isolate-agent: true', (_key, found) => {
    expect(found.agent.with?.['isolate-agent']).toBe('true')
  })

  it.each(agentJobs.map(found => [found.key, found] as const))(
    '%s has a checkout, and none of its checkouts persists credentials',
    (_key, found) => {
      expect(found.checkouts.length).toBeGreaterThan(0) // guards against a vacuous pass
      for (const checkout of found.checkouts) {
        expect(checkout.with?.['persist-credentials'], checkout.name).toBe(false)
      }
    },
  )

  it.each(agentJobs.map(found => [found.key, found] as const))(
    '%s passes its token through the explicit github-token input',
    (_key, found) => {
      expect(typeof found.agent.with?.['github-token']).toBe('string')
      expect(String(found.agent.with?.['github-token'])).not.toBe('')
    },
  )
})
