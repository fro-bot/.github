/**
 * Repo-wide guard: in any job containing a `fro-bot/agent` step, no step AFTER the agent
 * step may reference a credential the model doesn't already hold — and neither may any
 * mechanism that hands a credential to the whole job (inherited env, `secrets: inherit`,
 * a reusable-workflow call, or a local composite action a post-agent step invokes).
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
 * Beyond scanning each post-agent step's own `env`/`with`/`run`, this guard also fails on:
 *   (a) a job-level or workflow-level `env:` value referencing a credential — every step
 *       in the job, including post-agent ones, inherits both.
 *   (b) `secrets: inherit` on the job, or a job-level `uses:` pointing at a reusable
 *       workflow (`.github/workflows/*.y*ml`) — both hand the whole job a credential set.
 *   (c) a post-agent step whose `uses:` is a local composite action
 *       (`./.github/actions/<name>`) whose `action.y*ml` itself references a credential
 *       in its `inputs` defaults or `steps`.
 *   (d) ANY `actions/create-github-app-token` step in the job, before or after the agent.
 *       That action declares a `post:` phase which re-reads its own `with:` inputs
 *       (app-id, private-key) and `core.getState('token')` from runner state after every
 *       main step in the job — including the agent step. Its compiled `post.cjs` lives in
 *       the runner's `_actions` tree, which the agent's shell can tamper with as the same
 *       user, so a PRE-agent mint is exposed exactly like a post-agent one would be.
 *   (e) a PRE-agent `uses:` step whose `with:`/`env:` carries a credential other than the
 *       agent's own — the same `post:`-phase re-exposure mechanism as (d), generalized to
 *       any action (not just create-github-app-token) that has one.
 *
 * Supersedes the narrower `agent-token-mint-order-guard.test.ts` (which only caught a
 * token MINTED after the agent step, not one minted before and merely reused after).
 *
 * Non-vacuity: asserts the exact number of agent-containing jobs inspected.
 */

import {existsSync, readdirSync, readFileSync} from 'node:fs'
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
  env?: Record<string, unknown>
  secrets?: unknown
  uses?: string
}

interface WorkflowRoot {
  jobs: Record<string, WorkflowJob>
  env?: Record<string, unknown>
}

function assertWorkflowShape(value: unknown): asserts value is WorkflowRoot {
  if (typeof value !== 'object' || value === null || !('jobs' in value)) {
    throw new TypeError('workflow file does not have expected jobs shape')
  }
}

const AGENT_USES_PREFIX = 'fro-bot/agent@'
const APP_TOKEN_USES_PREFIX = 'actions/create-github-app-token@'
const LOCAL_ACTION_USES_PATTERN = /^\.\/\.github\/actions\/([\w-]+)\/?$/
const REUSABLE_WORKFLOW_USES_PATTERN = /\.github\/workflows\/[\w-]+\.ya?ml/

/** Matches a single credential-shaped token within a larger string (not anchored). */
const CREDENTIAL_REF_PATTERNS = [/secrets\.\w+/g, /steps\.[\w-]+\.outputs\.token/g, /github\.token/g]

/** Wider net for composite-action content: also flags a bare GITHUB_TOKEN reference. */
const COMPOSITE_ACTION_CREDENTIAL_PATTERNS = [...CREDENTIAL_REF_PATTERNS, /\bGITHUB_TOKEN\b/g]

function findRefs(text: string, patterns: RegExp[]): string[] {
  const found: string[] = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[0])
  }
  return found
}

function findCredentialRefs(text: string): string[] {
  return findRefs(text, CREDENTIAL_REF_PATTERNS)
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

function envText(env: Record<string, unknown> | undefined): string {
  return Object.values(env ?? {})
    .map(value => String(value))
    .join('\n')
}

interface Violation {
  step: string
  ref: string
}

export interface ScanAgentJobParams {
  job: WorkflowJob
  workflowEnv?: Record<string, unknown>
  /**
   * Resolves a local composite action's `action.y*ml` content by action-dir name (the
   * capture group from `./.github/actions/<name>`). Returns `undefined` if unresolvable —
   * the scan then reports an `unresolved composite action` violation rather than silently
   * skipping it, so a future action rename/removal fails loudly instead of going dark.
   */
  resolveCompositeAction: (actionName: string) => string | undefined
}

export interface ScanAgentJobResult {
  agentCredential: string | undefined
  violations: Violation[]
}

/**
 * Pure detection core, factored out so every rule can be exercised against in-memory
 * fixture jobs (see the `describe.each` blocks below) as well as the real workflow files.
 */
export function scanAgentJob(params: ScanAgentJobParams): ScanAgentJobResult {
  const {job, workflowEnv, resolveCompositeAction} = params
  const steps = job.steps ?? []
  const agentStepIndex = steps.findIndex(step => (step.uses ?? '').startsWith(AGENT_USES_PREFIX))
  if (agentStepIndex === -1) {
    return {agentCredential: undefined, violations: []}
  }

  const agentStep = steps[agentStepIndex]
  const agentTokenInput = String(agentStep?.with?.['github-token'] ?? '')
  const agentCredentialRefs = findCredentialRefs(agentTokenInput).map(normalizeCredentialRef)
  const agentCredential = agentCredentialRefs[0]

  const violations: Violation[] = []

  const pushIfForeign = (label: string, refs: string[]) => {
    for (const ref of refs.map(normalizeCredentialRef)) {
      if (ref !== agentCredential) {
        violations.push({step: label, ref})
      }
    }
  }

  // Rule: post-agent step env/with/run.
  for (const step of steps.slice(agentStepIndex + 1)) {
    pushIfForeign(step.name ?? step.id ?? '(unnamed step)', findCredentialRefs(stepText(step)))
  }

  // Rule (a): workflow-level and job-level env — every step in the job inherits both.
  pushIfForeign('(workflow-level env)', findCredentialRefs(envText(workflowEnv)))
  pushIfForeign('(job-level env)', findCredentialRefs(envText(job.env)))

  // Rule (b): secrets: inherit, or a job-level uses: pointing at a reusable workflow.
  if (job.secrets === 'inherit') {
    violations.push({step: '(job: secrets: inherit)', ref: 'secrets: inherit'})
  }
  if (typeof job.uses === 'string' && REUSABLE_WORKFLOW_USES_PATTERN.test(job.uses)) {
    violations.push({step: '(job: uses reusable workflow)', ref: job.uses})
  }

  // Rule (c): a post-agent step that invokes a local composite action whose action.y*ml
  // itself references a credential in its inputs defaults or steps.
  for (const step of steps.slice(agentStepIndex + 1)) {
    const match = LOCAL_ACTION_USES_PATTERN.exec(step.uses ?? '')
    const actionName = match?.[1]
    if (actionName === undefined) continue
    const actionContent = resolveCompositeAction(actionName)
    const label = step.name ?? step.id ?? `(composite action: ${actionName})`
    if (actionContent === undefined) {
      violations.push({step: label, ref: `unresolved composite action: ${actionName}`})
      continue
    }
    pushIfForeign(label, findRefs(actionContent, COMPOSITE_ACTION_CREDENTIAL_PATTERNS))
  }

  // Rule (d): actions/create-github-app-token declares a `post:` phase that re-reads its
  // own `with:` inputs (app-id, private-key) and `core.getState('token')` from runner
  // state AFTER every main step in the job completes — including the agent step. The
  // action's compiled post.cjs lives in the runner's _actions tree, which the agent's
  // shell can tamper with. A pre-agent mint is therefore just as exposed as a post-agent
  // one: fail on ANY create-github-app-token step anywhere in an agent job.
  for (const step of steps) {
    if ((step.uses ?? '').startsWith(APP_TOKEN_USES_PREFIX)) {
      violations.push({step: step.name ?? step.id ?? '(unnamed step)', ref: 'actions/create-github-app-token'})
    }
  }

  // Rule (e): a PRE-agent uses: step whose with:/env: carries a credential other than the
  // agent's own. Its post: phase (if any) re-exposes those inputs after the agent runs,
  // same mechanism as rule (d) but for third-party/other actions in general, not just
  // create-github-app-token specifically.
  for (const step of steps.slice(0, agentStepIndex)) {
    if (typeof step.uses !== 'string' || step.uses === '') continue
    pushIfForeign(step.name ?? step.id ?? '(unnamed step)', findCredentialRefs(stepText(step)))
  }

  return {agentCredential, violations}
}

const workflowsDir = resolve(import.meta.dirname, '../.github/workflows')
const actionsDir = resolve(import.meta.dirname, '../.github/actions')
const workflowFiles = readdirSync(workflowsDir).filter(name => name.endsWith('.yaml') || name.endsWith('.yml'))

function resolveRepoCompositeAction(actionName: string): string | undefined {
  for (const ext of ['action.yml', 'action.yaml']) {
    const candidate = resolve(actionsDir, actionName, ext)
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
  }
  return undefined
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
      const hasAgentStep = steps.some(step => (step.uses ?? '').startsWith(AGENT_USES_PREFIX))
      if (!hasAgentStep) continue

      const {agentCredential, violations} = scanAgentJob({
        job,
        workflowEnv: parsed.env,
        resolveCompositeAction: resolveRepoCompositeAction,
      })

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
    'agent job %o references no credential after its agent step, from inherited env, secrets: inherit, a reusable-workflow call, or a post-agent local composite action, other than the one the agent itself holds',
    ref => {
      expect(
        ref.violations,
        `${ref.file} > ${ref.job} (agent credential: ${ref.agentCredential ?? '(none found)'}) references a stronger/different credential`,
      ).toStrictEqual([])
    },
  )
})

describe('scanAgentJob (fixture-driven unit tests for each new rule)', () => {
  // Literal GitHub Actions expression syntax in fixture strings — split to dodge eslint's
  // no-template-curly-in-string rule (it can't tell this from a stray JS interpolation).
  const EXPR = '$' + '{{'

  const agentStep: WorkflowStep = {
    uses: 'fro-bot/agent@b711f08e4049ff0add1ec06859743b2dcb7764ce',
    with: {'github-token': `${EXPR} secrets.FRO_BOT_PAT }}`},
  }
  const noOpResolver = () => undefined

  it('is a no-op for a job with no agent step', () => {
    const result = scanAgentJob({
      job: {steps: [{name: 'echo', run: 'echo hi'}]},
      resolveCompositeAction: noOpResolver,
    })
    expect(result).toStrictEqual({agentCredential: undefined, violations: []})
  })

  it("passes clean for a job whose only post-agent reference is the agent's own credential", () => {
    const result = scanAgentJob({
      job: {steps: [agentStep, {name: 'echo agent token', run: `echo ${EXPR} secrets.FRO_BOT_PAT }}`}]},
      resolveCompositeAction: noOpResolver,
    })
    expect(result.violations).toStrictEqual([])
  })

  describe('rule (a): inherited env', () => {
    it('fails on a job-level env value referencing a foreign secret', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'later', run: 'echo done'}],
          env: {X: `${EXPR} secrets.GATEWAY_WEBHOOK_SECRET }}`},
        },
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: '(job-level env)', ref: 'secrets.GATEWAY_WEBHOOK_SECRET'}])
    })

    it('fails on a workflow-level env value referencing a foreign secret', () => {
      const result = scanAgentJob({
        job: {steps: [agentStep, {name: 'later', run: 'echo done'}]},
        workflowEnv: {X: `${EXPR} secrets.GATEWAY_WEBHOOK_SECRET }}`},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: '(workflow-level env)', ref: 'secrets.GATEWAY_WEBHOOK_SECRET'}])
    })

    it("does not flag a job-level env value that only references the agent's own credential", () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'later', run: 'echo done'}],
          env: {X: `${EXPR} secrets.FRO_BOT_PAT }}`},
        },
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([])
    })

    it('fails on a job-level env value referencing github.token when the agent holds a different credential', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'later', run: 'echo done'}],
          env: {X: `${EXPR} github.token }}`},
        },
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: '(job-level env)', ref: 'github.token'}])
    })
  })

  describe('rule (b): secrets: inherit / reusable-workflow uses', () => {
    it('fails on secrets: inherit', () => {
      const result = scanAgentJob({
        job: {steps: [agentStep], secrets: 'inherit'},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: '(job: secrets: inherit)', ref: 'secrets: inherit'}])
    })

    it('fails on a job-level uses: pointing at a reusable workflow', () => {
      const result = scanAgentJob({
        job: {steps: [agentStep], uses: './.github/workflows/some-reusable.yaml'},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([
        {step: '(job: uses reusable workflow)', ref: './.github/workflows/some-reusable.yaml'},
      ])
    })

    it('does not flag a job-level uses: pointing at something that is not a reusable workflow path', () => {
      const result = scanAgentJob({
        job: {steps: [agentStep], uses: './.github/actions/setup'},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([])
    })
  })

  describe('rule (c): post-agent local composite action', () => {
    it('fails when a post-agent local composite action references a foreign secret in its inputs defaults', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'run composite', uses: './.github/actions/leaky'}],
        },
        resolveCompositeAction: actionName => {
          expect(actionName).toBe('leaky')
          return [
            'inputs:',
            '  token:',
            `    default: ${EXPR} secrets.GATEWAY_WEBHOOK_SECRET }}`,
            'runs:',
            '  using: composite',
            '  steps: []',
          ].join('\n')
        },
      })
      expect(result.violations).toStrictEqual([{step: 'run composite', ref: 'secrets.GATEWAY_WEBHOOK_SECRET'}])
    })

    it('fails when a post-agent local composite action references github.token in a step', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'run composite', uses: './.github/actions/leaky'}],
        },
        resolveCompositeAction: () =>
          [
            'runs:',
            '  using: composite',
            '  steps:',
            `    - run: echo ${EXPR} github.token }}`,
            '      shell: bash',
          ].join('\n'),
      })
      expect(result.violations).toStrictEqual([{step: 'run composite', ref: 'github.token'}])
    })

    it('fails when a post-agent local composite action references a bare GITHUB_TOKEN', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'run composite', uses: './.github/actions/leaky'}],
        },
        resolveCompositeAction: () =>
          ['runs:', '  using: composite', '  steps:', '    - run: echo $GITHUB_TOKEN', '      shell: bash'].join('\n'),
      })
      expect(result.violations).toStrictEqual([{step: 'run composite', ref: 'GITHUB_TOKEN'}])
    })

    it('passes for a post-agent local composite action with no credential references', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'run clean', uses: './.github/actions/clean'}],
        },
        resolveCompositeAction: () => ['runs:', '  using: composite', '  steps:', '    - run: echo hi'].join('\n'),
      })
      expect(result.violations).toStrictEqual([])
    })

    it('does not scan a PRE-agent local composite action', () => {
      const result = scanAgentJob({
        job: {
          steps: [{name: 'pre-agent setup', uses: './.github/actions/leaky'}, agentStep],
        },
        resolveCompositeAction: () => {
          throw new Error('must not resolve a pre-agent composite action')
        },
      })
      expect(result.violations).toStrictEqual([])
    })

    it('fails loudly (does not silently skip) when the composite action cannot be resolved', () => {
      const result = scanAgentJob({
        job: {
          steps: [agentStep, {name: 'run missing', uses: './.github/actions/does-not-exist'}],
        },
        resolveCompositeAction: () => undefined,
      })
      expect(result.violations).toStrictEqual([
        {step: 'run missing', ref: 'unresolved composite action: does-not-exist'},
      ])
    })
  })

  describe('rule (d): any actions/create-github-app-token step in the job, before or after the agent', () => {
    it('fails on a PRE-agent App-token mint', () => {
      const mintStep: WorkflowStep = {
        name: 'Mint App token',
        uses: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
      }
      const result = scanAgentJob({
        job: {steps: [mintStep, agentStep]},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: 'Mint App token', ref: 'actions/create-github-app-token'}])
    })

    it('fails on a POST-agent App-token mint', () => {
      const mintStep: WorkflowStep = {
        name: 'Mint App token',
        uses: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
      }
      const result = scanAgentJob({
        job: {steps: [agentStep, mintStep]},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: 'Mint App token', ref: 'actions/create-github-app-token'}])
    })

    it('passes for an agent job with no create-github-app-token step anywhere', () => {
      const result = scanAgentJob({
        job: {steps: [{name: 'checkout', uses: 'actions/checkout@abc'}, agentStep]},
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([])
    })
  })

  describe("rule (e): a PRE-agent uses: step whose with:/env: carries a credential other than the agent's own", () => {
    it('fails on a pre-agent uses: step whose with: carries a foreign secret', () => {
      const result = scanAgentJob({
        job: {
          steps: [
            {
              name: 'pre-agent fetch',
              uses: 'some-org/some-action@abc',
              with: {token: `${EXPR} secrets.GATEWAY_WEBHOOK_SECRET }}`},
            },
            agentStep,
          ],
        },
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([{step: 'pre-agent fetch', ref: 'secrets.GATEWAY_WEBHOOK_SECRET'}])
    })

    it('fails on a pre-agent uses: step whose env: carries a steps.*.outputs.token reference', () => {
      const result = scanAgentJob({
        job: {
          steps: [
            {name: 'mint', id: 'mint', uses: 'actions/create-github-app-token@abc'},
            {
              name: 'pre-agent use',
              uses: 'some-org/some-action@abc',
              env: {GH_TOKEN: `${EXPR} steps.mint.outputs.token }}`},
            },
            agentStep,
          ],
        },
        resolveCompositeAction: noOpResolver,
      })
      // Two violations expected: rule (d) on the mint step itself, and rule (e) on the
      // step that consumes its token before the agent runs.
      expect(result.violations).toStrictEqual([
        {step: 'mint', ref: 'actions/create-github-app-token'},
        {step: 'pre-agent use', ref: 'steps.mint.outputs.token'},
      ])
    })

    it("does not flag a pre-agent uses: step (e.g. checkout) that carries the agent's own credential", () => {
      const result = scanAgentJob({
        job: {
          steps: [
            {name: 'checkout', uses: 'actions/checkout@abc', with: {token: `${EXPR} secrets.FRO_BOT_PAT }}`}},
            agentStep,
          ],
        },
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([])
    })

    it('does not flag a pre-agent uses: step with no with:/env: at all', () => {
      const result = scanAgentJob({
        job: {
          steps: [{name: 'setup', uses: './.github/actions/setup'}, agentStep],
        },
        resolveCompositeAction: noOpResolver,
      })
      expect(result.violations).toStrictEqual([])
    })
  })
})
