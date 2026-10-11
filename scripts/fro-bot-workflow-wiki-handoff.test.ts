import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

import {writeSelectedPathsHandoff} from './wiki-query.ts'

// Regression guard: the baseline wiki-query step must write the run-local handoff
// file, and the agent must be able to REACH it. The Action scrubs the OpenCode
// server child's environment to an allowlist, so a step-level `env:` entry never
// reaches the agent's shell — the prompt therefore carries the path as an inline
// assignment on the linked-mode command. The workflow must never log the handoff
// path or selected paths content.

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
// Literal GitHub Actions expression syntax — split to dodge eslint's no-template-curly-in-string rule.
const EXPECTED_LINKED_COMMAND =
  "WIKI_CONTEXT_HANDOFF_PATH='" +
  '$' +
  "{{ env.WIKI_CONTEXT_HANDOFF_PATH }}' node scripts/wiki-context-expand.ts linked"
const EXPRESSION = /\$\{\{ ([^}]+?) \}\}/gu

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

/** Render `${{ … }}` expressions from a fixed context; any expression outside it is a test error. */
function render(template: string, context: Readonly<Record<string, string>>): string {
  return template.replaceAll(EXPRESSION, (_match, expression: string) => {
    const value = context[expression]
    if (value === undefined) {
      throw new TypeError(`unsupported workflow expression in test renderer: ${expression}`)
    }
    return value
  })
}

/** The raw (unrendered) backtick-delimited command line in the prompt that ends with `linked`. */
function extractCommandLine(prompt: string, suffix: string): string {
  const line = prompt
    .split('\n')
    .map(candidate => candidate.trim())
    .find(candidate => candidate.startsWith('`') && candidate.endsWith(`${suffix}\``))
  if (line === undefined) {
    throw new TypeError(`prompt has no command line ending with ${suffix}`)
  }
  return line.slice(1, -1)
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

    it('the prompt hands the agent the linked command with an inline path assignment', () => {
      // #when reading the linked-mode command exactly as the model will see it (pre-render)
      const command = extractCommandLine(wiring.prompt, 'linked')

      // #then the path travels on the command itself — the agent shell does not inherit step env
      expect(command).toBe(EXPECTED_LINKED_COMMAND)
    })

    it('the rendered inline path is byte-identical to the rendered producer path', () => {
      // #given the expressions both sides use, rendered with one concrete context
      const context = {'runner.temp': '/runner/tmp', 'github.run_id': '4242', 'github.run_attempt': '3'}
      const producerRendered = render(wiring.producerPath, context)
      const command = extractCommandLine(wiring.prompt, 'linked')

      // #when the prompt's `env.WIKI_CONTEXT_HANDOFF_PATH` resolves against the agent step's own env
      const commandRendered = render(command, {
        ...context,
        'env.WIKI_CONTEXT_HANDOFF_PATH': render(wiring.consumerPath, context),
      })

      // #then the path the agent is told to read is the path the producer wrote
      expect(commandRendered).toBe(`${HANDOFF_VAR}='${producerRendered}' node scripts/wiki-context-expand.ts linked`)
    })

    it('query mode takes no handoff variable and the no-echo guidance is kept', () => {
      const queryCommand = extractCommandLine(wiring.prompt, '"<short grounded query>"')
      expect(queryCommand).toBe('node scripts/wiki-context-expand.ts query "<short grounded query>"')
      expect(wiring.prompt).toContain('Do not print or echo that path')
      expect(wiring.prompt.toLowerCase()).toContain('optional')
    })

    it('does not imply the variable is inherited from the environment', () => {
      expect(wiring.prompt).not.toMatch(/reads the baseline-selected pages from the path in/u)
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

// ---------------------------------------------------------------------------
// Subprocess: run the prompt's commands the way the agent shell would — with the
// handoff variable absent from the inherited environment.
// ---------------------------------------------------------------------------

const SCRIPT_RELATIVE = 'scripts/wiki-context-expand.ts'
const SCRIPT_ABSOLUTE = resolve(import.meta.dirname, 'wiki-context-expand.ts')

const AGENT_PAGE = [
  '---',
  'type: repo',
  'title: Fro Bot Agent',
  'tags: [agent]',
  '---',
  '',
  'Fro Bot Agent links to [[vitest]] for its workflow scripts.',
  '',
].join('\n')

const VITEST_PAGE = [
  '---',
  'type: topic',
  'title: Vitest',
  'tags: [testing]',
  '---',
  '',
  'Vitest is the repo test runner and exercises octokit github api access wrappers.',
  '',
].join('\n')

interface ExpandStdout {
  readonly status: string
  readonly mode: string
  readonly excerpt: string
}

function parseExpandStdout(stdout: string): ExpandStdout {
  const value: unknown = JSON.parse(stdout)
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('wiki-context-expand stdout is not a JSON object')
  }
  const record = value as Record<string, unknown>
  return {status: String(record.status), mode: String(record.mode), excerpt: String(record.excerpt)}
}

/** Run a shell command line with an environment that deliberately lacks the handoff variable. */
function runInAgentShell(command: string, cwd: string): ExpandStdout {
  const env: Record<string, string> = {PATH: process.env.PATH ?? ''}
  expect(HANDOFF_VAR in env).toBe(false)
  const stdout = execFileSync('sh', ['-c', command.replace(SCRIPT_RELATIVE, SCRIPT_ABSOLUTE)], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseExpandStdout(stdout)
}

async function withFixture(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wiki-handoff-subprocess-'))
  try {
    await mkdir(join(dir, 'knowledge/wiki/repos'), {recursive: true})
    await mkdir(join(dir, 'knowledge/wiki/topics'), {recursive: true})
    await mkdir(join(dir, 'metadata'), {recursive: true})
    await writeFile(join(dir, 'knowledge/wiki/repos/fro-bot--agent.md'), AGENT_PAGE)
    await writeFile(join(dir, 'knowledge/wiki/topics/vitest.md'), VITEST_PAGE)
    await writeFile(join(dir, 'metadata/repos.yaml'), 'repos: []\n')
    await run(dir)
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
}

describe('wiki-context-expand as the agent shell runs it (handoff variable not inherited)', () => {
  const workflowRaw = readFileSync(resolve(import.meta.dirname, '../.github/workflows/fro-bot.yaml'), 'utf8')
  const parsedWorkflow: unknown = parse(workflowRaw)
  assertFroBotWorkflow(parsedWorkflow)
  const agentJobs = collectAgentJobs(parsedWorkflow.jobs)

  it.each(agentJobs)(
    'linked expansion works for job $jobKey when only the inline assignment supplies the path',
    async wiring => {
      await withFixture(async dir => {
        // #given the producer wrote its handoff at the path the producer step declares
        const context = {'runner.temp': dir, 'github.run_id': '4242', 'github.run_attempt': '3'}
        const producerRendered = render(wiring.producerPath, context)
        await mkdir(dirname(producerRendered), {recursive: true})
        await writeSelectedPathsHandoff(producerRendered, ['knowledge/wiki/repos/fro-bot--agent.md'])

        // #when the rendered prompt command runs with the variable absent from the inherited env
        const command = render(extractCommandLine(wiring.prompt, 'linked'), {
          ...context,
          'env.WIKI_CONTEXT_HANDOFF_PATH': render(wiring.consumerPath, context),
        })
        const result = runInAgentShell(command, dir)

        // #then the handoff was found and the first-hop page was expanded
        expect(result.mode).toBe('linked')
        expect(result.status).toBe('ok')
        expect(result.excerpt).toContain('Vitest')
      })
    },
  )

  it('control: bare linked command without the inline assignment cannot find the handoff', async () => {
    await withFixture(async dir => {
      // #given a valid handoff exists, but the command does not point at it
      await writeSelectedPathsHandoff(join(dir, 'handoff.json'), ['knowledge/wiki/repos/fro-bot--agent.md'])

      // #when the pre-fix command shape runs with the variable absent
      const result = runInAgentShell(`node ${SCRIPT_RELATIVE} linked`, dir)

      // #then it degrades to an empty result — the bug the inline assignment fixes
      expect(result.mode).toBe('linked')
      expect(result.status).toBe('empty')
    })
  })

  it('query mode works with no handoff variable at all', async () => {
    await withFixture(async dir => {
      // #given the prompt's query command with a concrete grounded query substituted
      const queryTemplate = extractCommandLine(agentJobs[0]?.prompt ?? '', '"<short grounded query>"')
      const command = queryTemplate.replace('<short grounded query>', 'octokit github api access')

      // #when run with the variable absent
      const result = runInAgentShell(command, dir)

      // #then query expansion succeeds without a handoff
      expect(result.mode).toBe('query')
      expect(result.status).toBe('ok')
    })
  })
})
