/**
 * Repo-wide guard: in any job containing a `fro-bot/agent` step, no step AFTER the agent
 * step may reference a credential the model doesn't already hold.
 *
 * The agent's shell can rewrite checked-out code and PATH on its own runner. Any LATER
 * step in the SAME job that runs with a stronger credential is an escalation path — even
 * if that credential was minted BEFORE the agent step ran (the agent had the whole
 * remainder of the job to tamper with the code/PATH that later step will execute).
 *
 * A credential reference is one of:
 *   - `secrets.<NAME>` for any secret other than the exact one passed as the agent
 *     step's own `github-token` input (the model already holds that one)
 *   - `steps.<id>.outputs.token` (the shape every App-token mint in this repo produces),
 *     whether minted before or after the agent step
 *   - `github.token` / `secrets.GITHUB_TOKEN` (treated as aliases), unless the agent's
 *     own `github-token` input was itself `github.token`/`secrets.GITHUB_TOKEN`
 *
 * Supersedes the narrower `agent-token-mint-order-guard.test.ts` (which only caught a
 * token MINTED after the agent step, not one minted before and merely reused after).
 *
 * Non-vacuity: asserts the exact number of agent-containing jobs inspected.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface WorkflowStep {
  name?: string
  id?: string
  uses?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
  run?: string
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

/** Matches a single credential-shaped token within a larger string (not anchored). */
const CREDENTIAL_REF_PATTERNS = [/secrets\.\w+/g, /steps\.[\w-]+\.outputs\.token/g, /github\.token/g]

function findCredentialRefs(text: string): string[] {
  const found: string[] = []
  for (const pattern of CREDENTIAL_REF_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push(match[0])
  }
  return found
}

/** `secrets.GITHUB_TOKEN` and `github.token` are the same credential under different spellings. */
function normalizeCredentialRef(ref: string): string {
  return ref === 'secrets.GITHUB_TOKEN' ? 'github.token' : ref
}

function stepText(step: WorkflowStep): string {
  const envValues = Object.values(step.env ?? {}).map(value => String(value))
  const withValues = Object.values(step.with ?? {}).map(value => String(value))
  const runText = step.run ?? ''
  return [...envValues, ...withValues, runText].join('\n')
}

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')
const workflowFiles = readdirSync(workflowsDir).filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))

interface Violation {
  step: string
  ref: string
}

interface AgentJobRef {
  file: string
  job: string
  agentCredential: string | undefined
  violations: Violation[]
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

      const agentStep = steps[agentStepIndex]
      const agentTokenInput = String(agentStep?.with?.['github-token'] ?? '')
      const agentCredentialRefs = findCredentialRefs(agentTokenInput).map(normalizeCredentialRef)
      const agentCredential = agentCredentialRefs[0]

      const violations: Violation[] = []
      for (const step of steps.slice(agentStepIndex + 1)) {
        const refs = findCredentialRefs(stepText(step)).map(normalizeCredentialRef)
        for (const ref of refs) {
          if (ref !== agentCredential) {
            violations.push({step: step.name ?? step.id ?? '(unnamed step)', ref})
          }
        }
      }

      found.push({file, job: jobName, agentCredential, violations})
    }
  }

  return found
}

describe('agent post-step credential guard', () => {
  const agentJobs = findAgentJobs()

  it('finds the expected number of jobs containing a fro-bot/agent step (non-vacuity check)', () => {
    // fro-bot.yaml: fro-bot, fro-bot-remediate, fro-bot-observe (3). survey-repo.yaml:
    // survey-repo (1). capture-learnings.yaml: capture-learnings (1). capture-patterns.yaml:
    // open (1). Total: 6.
    expect(agentJobs).toHaveLength(6)
  })

  it.each(agentJobs.length > 0 ? agentJobs.map(ref => [ref] as const) : [])(
    'agent job %o references no credential after its agent step other than the one the agent itself holds',
    ref => {
      expect(
        ref.violations,
        `${ref.file} > ${ref.job} (agent credential: ${ref.agentCredential ?? '(none found)'}) references a stronger/different credential after the agent step`,
      ).toStrictEqual([])
    },
  )
})
