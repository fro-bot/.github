/**
 * Repo-wide guard: no job containing a `fro-bot/agent` step may mint a GitHub App
 * installation token (`actions/create-github-app-token`) AFTER that step.
 *
 * Rationale: the agent's shell can rewrite any file in its own job's checkout. Minting a
 * write-tier App token later in the SAME job hands a privileged credential to an
 * execution context the agent already touched — exactly the invariant this repo's
 * data-branch-write migration (A1) and its follow-up (A2) exist to close. A token minted
 * strictly BEFORE the agent step (e.g. the read-only privacy-gate token in survey-repo.yaml)
 * is fine; this guard only flags mints that happen after.
 *
 * Non-vacuity: asserts the exact number of agent-containing jobs inspected, so a future
 * refactor that stops matching any job (renamed action ref, moved step) fails loudly
 * instead of silently passing an empty guard.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  uses?: string
}

interface WorkflowJob {
  steps?: WorkflowStep[]
}

function assertWorkflowShape(value: unknown): asserts value is {jobs: Record<string, WorkflowJob>} {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

const AGENT_USES_PREFIX = 'fro-bot/agent@'
const APP_TOKEN_USES_PREFIX = 'actions/create-github-app-token@'

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')
const workflowFiles = readdirSync(workflowsDir).filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))

interface AgentJobRef {
  file: string
  job: string
  agentStepIndex: number
  mintStepsAfterAgent: string[]
}

function findAgentJobs(): AgentJobRef[] {
  const found: AgentJobRef[] = []

  for (const file of workflowFiles) {
    const raw = readFileSync(resolve(workflowsDir, file), 'utf8')
    const parsed: unknown = parse(raw)
    assertWorkflowShape(parsed)

    for (const [jobName, job] of Object.entries(parsed.jobs)) {
      const steps = job.steps ?? []
      const agentStepIndex = steps.findIndex(step => (step.uses ?? '').startsWith(AGENT_USES_PREFIX))
      if (agentStepIndex === -1) continue

      const mintStepsAfterAgent = steps
        .slice(agentStepIndex + 1)
        .filter(step => (step.uses ?? '').startsWith(APP_TOKEN_USES_PREFIX))
        .map(step => step.name ?? step.id ?? '(unnamed step)')

      found.push({file, job: jobName, agentStepIndex, mintStepsAfterAgent})
    }
  }

  return found
}

describe('agent-token-mint-order guard', () => {
  const agentJobs = findAgentJobs()

  it('finds the expected number of jobs containing a fro-bot/agent step (non-vacuity check)', () => {
    // fro-bot.yaml: fro-bot, fro-bot-remediate, fro-bot-observe (3). survey-repo.yaml:
    // survey-repo (1). capture-learnings.yaml: 1. capture-patterns.yaml: 1. Total: 6.
    expect(agentJobs).toHaveLength(6)
  })

  it.each(agentJobs.length > 0 ? agentJobs.map(ref => [ref] as const) : [])(
    'agent job %o mints no App token after its agent step',
    ref => {
      expect(
        ref.mintStepsAfterAgent,
        `${ref.file} > ${ref.job} minted an App token after the agent step`,
      ).toStrictEqual([])
    },
  )
})
