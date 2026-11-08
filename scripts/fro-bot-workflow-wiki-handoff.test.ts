import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Regression guard: the baseline wiki-query step must write the run-local handoff file, and each agent
// job must declare the identical path so the `knowledge` MCP server's `wiki_linked` tool can read it (the
// path reaches the server through the `knowledge-mcp-config` composite, pinned in
// knowledge-mcp-callers.test.ts). The prompts name the three `knowledge_*` tools and carry no bash recipe.
// The workflow must never log the handoff path or selected paths content.

interface WorkflowStep {
  name?: string
  id?: string
  uses?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  name?: string
  steps?: WorkflowStep[]
}

/** Narrow the parsed YAML to the shape we index into, without any broad cast. */
function assertFroBotWorkflow(value: unknown): asserts value is {
  jobs: Record<string, WorkflowJob>
} {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobs' in value) ||
    typeof (value as Record<string, unknown>).jobs !== 'object'
  ) {
    throw new TypeError('fro-bot.yaml does not have expected shape: missing jobs object')
  }
}

const AGENT_USES_PREFIX = 'fro-bot/agent@'
const HANDOFF_VAR = 'WIKI_CONTEXT_HANDOFF_PATH'
const TOOL_IDS = ['knowledge_wiki_search', 'knowledge_wiki_linked', 'knowledge_solutions_search'] as const

interface AgentJobWiring {
  readonly jobKey: string
  readonly producerPath: string
  readonly consumerPath: string
  readonly prompt: string
}

function stringEnv(step: WorkflowStep | undefined, key: string): string {
  const value = step?.env?.[key]
  if (typeof value !== 'string') {
    throw new TypeError(`step ${step?.id ?? step?.name ?? '(unknown)'} does not define string env ${key}`)
  }
  return value
}

/** Every job that runs the fro-bot/agent action, with its producer/consumer handoff wiring. */
function collectAgentJobs(jobs: Record<string, WorkflowJob>): AgentJobWiring[] {
  const wirings: AgentJobWiring[] = []
  for (const [jobKey, job] of Object.entries(jobs)) {
    const steps = job.steps ?? []
    const agentStep = steps.find(step => step.uses?.startsWith(AGENT_USES_PREFIX) === true)
    if (agentStep === undefined) {
      continue
    }
    const producerStep = steps.find(step => step.id === 'wiki-query')
    wirings.push({
      jobKey,
      producerPath: stringEnv(producerStep, HANDOFF_VAR),
      consumerPath: stringEnv(agentStep, HANDOFF_VAR),
      prompt: String(agentStep.with?.prompt ?? ''),
    })
  }
  return wirings
}

/** The text between the `<wiki_context_expansion>` tags of a prompt. */
function expansionBlock(prompt: string): string {
  const open = prompt.indexOf('<wiki_context_expansion>')
  const close = prompt.indexOf('</wiki_context_expansion>')
  if (open === -1 || close === -1 || close < open) {
    throw new TypeError('prompt has no <wiki_context_expansion> block')
  }
  return prompt.slice(open, close)
}

describe('fro-bot.yaml baseline wiki handoff wiring', () => {
  // #given the fro-bot workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
  const raw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(raw)
  assertFroBotWorkflow(parsed)
  const agentJobs = collectAgentJobs(parsed.jobs)

  it('covers every agent job in the workflow', () => {
    // #then there are agent jobs, and each one carries the wiki context expansion block
    expect(agentJobs.length).toBeGreaterThanOrEqual(3)
    for (const wiring of agentJobs) {
      expect(wiring.prompt, `job ${wiring.jobKey}`).toContain('<wiki_context_expansion>')
    }
  })

  describe.each(agentJobs)('agent job $jobKey', wiring => {
    it('wiki-query producer sets the handoff path under runner.temp', () => {
      expect(wiring.producerPath).toContain('runner.temp')
      expect(wiring.producerPath).toContain('wiki-context-handoff-')
    })

    it('the agent step declares the identical handoff path as the producer', () => {
      expect(wiring.consumerPath).toBe(wiring.producerPath)
    })

    it('the prompt names the three knowledge tools inside the expansion block', () => {
      const block = expansionBlock(wiring.prompt)

      for (const tool of TOOL_IDS) {
        expect(block, `job ${wiring.jobKey}`).toContain(`\`${tool}\``)
      }
    })

    it('the prompt carries no bash recipe and no recipe fallback', () => {
      expect(wiring.prompt).not.toContain('wiki-context-expand')
      expect(wiring.prompt).not.toContain('bun scripts/')
      expect(wiring.prompt).not.toContain(`${HANDOFF_VAR}=`)
      expect(wiring.prompt).not.toContain('does not list them')
      expect(wiring.prompt).not.toContain('When this run lists the tools')
    })

    it('keeps the optional-expansion and no-echo guidance', () => {
      const block = expansionBlock(wiring.prompt)

      expect(block).toContain('Do not print or echo')
      expect(block.toLowerCase()).toContain('optionally')
    })
  })

  it('the workflow file never echoes the handoff path or selected paths into logs', () => {
    // #given the raw workflow text
    // #when scanning for common log-emission patterns near the handoff variable
    // #then no step pipes WIKI_CONTEXT_HANDOFF_PATH or its contents to echo/cat/GITHUB_OUTPUT
    const suspiciousPatterns = [/echo.*WIKI_CONTEXT_HANDOFF_PATH/u, /cat.*WIKI_CONTEXT_HANDOFF_PATH/u]
    for (const pattern of suspiciousPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })

  it('baseline wiki context is still injected as before', () => {
    // #then the <wiki_context> block referencing WIKI_CONTEXT remains in the prompt
    expect(raw).toContain('<wiki_context>')
    expect(raw).toContain('env.WIKI_CONTEXT')
  })

  it('no precomputed <wiki_deep_context> block is introduced', () => {
    // #then no automatic deep-context block exists anywhere in the workflow
    expect(raw).not.toContain('<wiki_deep_context>')
  })

  it('the workflow file uses plain operator-facing vocabulary, not internal plan taxonomy', () => {
    // #then no internal taxonomy terms leak onto this public workflow surface
    const forbiddenPatterns = [/C-deep/u, /A1 Phase 3/u, /\bUnit \d/u, /\bU\d\b/u, /wiki-deepen/u]
    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(raw)).toBe(false)
    }
  })
})
