import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Regression guard: the baseline wiki-query step must write the run-local handoff
// file, and the agent step must receive its path — without the workflow ever
// logging the handoff path or selected paths content.

interface WorkflowStep {
  name?: string
  id?: string
  run?: string
  env?: Record<string, unknown>
}

/** Narrow the parsed YAML to the shape we index into, without any broad cast. */
function assertFroBotWorkflow(value: unknown): asserts value is {
  jobs: Record<string, {steps: WorkflowStep[]}>
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

describe('fro-bot.yaml baseline wiki handoff wiring', () => {
  // #given the fro-bot workflow file parsed as a YAML document
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml')
  const raw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(raw)
  assertFroBotWorkflow(parsed)
  const jobKeys = Object.keys(parsed.jobs)
  const jobKey = jobKeys.find(key => parsed.jobs[key]?.steps.some(step => step.id === 'wiki-query')) ?? jobKeys[0]
  const steps = (jobKey === undefined ? undefined : parsed.jobs[jobKey]?.steps) ?? []

  it('wiki-query step sets WIKI_CONTEXT_HANDOFF_PATH under runner.temp', () => {
    // #when locating the baseline wiki-query step
    const wikiQueryStep = steps.find(step => step.id === 'wiki-query')

    // #then it defines a handoff path env var scoped to runner temp
    expect(wikiQueryStep).toBeDefined()
    const handoffPath = wikiQueryStep?.env?.WIKI_CONTEXT_HANDOFF_PATH
    expect(typeof handoffPath).toBe('string')
    expect(String(handoffPath)).toContain('runner.temp')
    expect(String(handoffPath)).toContain('wiki-context-handoff-')
  })

  it('the Fro Bot agent step receives the same handoff path env var', () => {
    // #when locating the agent step
    const agentStep = steps.find(step => step.id === 'fro-bot-agent')

    // #then it also defines WIKI_CONTEXT_HANDOFF_PATH so the agent can read it
    expect(agentStep).toBeDefined()
    const handoffPath = agentStep?.env?.WIKI_CONTEXT_HANDOFF_PATH
    expect(typeof handoffPath).toBe('string')
    expect(String(handoffPath)).toContain('runner.temp')
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

  it('the agent prompt exposes the wiki context expansion tool as optional guidance', () => {
    // #when locating the agent step's prompt input
    const agentStep = steps.find(step => step.id === 'fro-bot-agent')
    const withBlock = (agentStep as {with?: Record<string, unknown>} | undefined)?.with
    const prompt = String(withBlock?.prompt ?? '')

    // #then the prompt names both exact executable commands for the optional tool
    expect(prompt).toContain('node scripts/wiki-context-expand.ts linked')
    expect(prompt).toContain('node scripts/wiki-context-expand.ts query')

    // #then the prompt frames the tool as optional, not mandatory
    expect(prompt.toLowerCase()).toContain('optional')
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
