import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Guard for the `check-mutation-guards` job in `main.yaml`: `main.yaml` had no shape test at
// all before this file. Mirrors `scripts/merge-data-workflow.test.ts`'s parse +
// narrowing-assert + job-shape pattern.

interface MainWorkflowJobStep {
  readonly name?: string
  readonly run?: string
  readonly uses?: string
  readonly with?: Record<string, unknown>
  readonly env?: Record<string, unknown>
  readonly if?: string
}

interface MainWorkflowJob {
  readonly name?: string
  readonly if?: string
  readonly permissions?: Record<string, string>
  readonly 'timeout-minutes'?: number
  // Optional (not `readonly steps: readonly MainWorkflowJobStep[]`): a reusable-workflow job
  // (`uses: ./.github/workflows/other.yaml`) has no `steps` key at all, and this shape must
  // describe every job actually parsed from main.yaml, not just the ones this file happens to
  // assert against today.
  readonly steps?: readonly MainWorkflowJobStep[]
}

/** Narrow the parsed YAML to the shape this file indexes into, without any broad cast. */
function assertMainWorkflow(value: unknown): asserts value is {
  jobs: Record<string, MainWorkflowJob>
} {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('main.yaml does not have expected shape: missing workflow contract objects')
  }
  const record = value as Record<string, unknown>
  if (typeof record.jobs !== 'object' || record.jobs === null || Array.isArray(record.jobs)) {
    throw new TypeError('main.yaml does not have expected shape: missing "jobs"')
  }
}

describe('main.yaml check-mutation-guards job', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/main.yaml')
  const workflowRaw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(workflowRaw)
  assertMainWorkflow(parsed)
  const job = parsed.jobs['check-mutation-guards']

  it('exists in main.yaml (fails if the job is removed)', () => {
    expect(job).toBeDefined()
  })

  it('has the exact job name "Check Mutation Guards" (becomes the required status check context)', () => {
    expect(job?.name).toBe('Check Mutation Guards')
  })

  it("runs only on pull_request events (if: github.event_name == 'pull_request')", () => {
    expect(job?.if).toBe("github.event_name == 'pull_request'")
  })

  it('requests least-privilege permissions: contents read and pull-requests read, nothing else', () => {
    expect(job?.permissions).toEqual({contents: 'read', 'pull-requests': 'read'})
  })

  it('uses the shared setup action', () => {
    const setupStep = job?.steps?.find(step => step.uses === './.github/actions/setup')
    expect(setupStep).toBeDefined()
  })

  it('runs pnpm check:mutation-guards with GH_TOKEN set', () => {
    const checkStep = job?.steps?.find(step => step.run === 'pnpm check:mutation-guards')
    expect(checkStep).toBeDefined()
    const expressionStart = '$' + '{{'
    expect(checkStep?.env?.GH_TOKEN).toBe(`${expressionStart} github.token }}`)
  })

  it('uploads the mutation report artifact even when the check step fails', () => {
    const uploadStep = job?.steps?.find(step => step.uses?.startsWith('actions/upload-artifact@') === true)
    expect(uploadStep).toBeDefined()
    expect(uploadStep?.if).toBe('always()')
    expect(uploadStep?.with?.name).toBe('mutation-report')
    expect(uploadStep?.with?.path).toBe('reports/mutation/')
  })

  it('sets a timeout of 20 minutes', () => {
    expect(job?.['timeout-minutes']).toBe(20)
  })

  it('does not declare a per-job concurrency group (inherits the workflow-level one)', () => {
    expect(job).not.toHaveProperty('concurrency')
  })
})

interface SettingsBranchProtection {
  readonly required_status_checks?: {
    readonly contexts?: readonly string[]
  }
}

interface SettingsBranch {
  readonly name?: string
  readonly protection?: SettingsBranchProtection
}

/** Narrow the parsed settings YAML to the shape this file indexes into, without any broad cast. */
function assertSettings(value: unknown): asserts value is {
  branches: readonly SettingsBranch[]
} {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('settings.yml does not have expected shape: missing settings contract object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.branches)) {
    throw new TypeError('settings.yml does not have expected shape: missing "branches" array')
  }
}

describe('settings.yml required status checks', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/main.yaml')
  const workflowRaw = readFileSync(workflowPath, 'utf8')
  const parsedWorkflow: unknown = parse(workflowRaw)
  assertMainWorkflow(parsedWorkflow)
  const job = parsedWorkflow.jobs['check-mutation-guards']

  const settingsPath = resolve(import.meta.dirname, '../.github/settings.yml')
  const settingsRaw = readFileSync(settingsPath, 'utf8')
  const parsedSettings: unknown = parse(settingsRaw)
  assertSettings(parsedSettings)
  const mainBranch = parsedSettings.branches.find(branch => branch.name === 'main')

  it('lists the check-mutation-guards job name as a required status check context (byte-for-byte, not a repeated literal)', () => {
    expect(job?.name).toBeDefined()
    expect(mainBranch?.protection?.required_status_checks?.contexts).toContain(job?.name)
  })
})

describe('main.yaml top-level shape', () => {
  const workflowPath = resolve(import.meta.dirname, '../.github/workflows/main.yaml')
  const workflowRaw = readFileSync(workflowPath, 'utf8')
  const parsed: unknown = parse(workflowRaw)
  assertMainWorkflow(parsed)

  it('every job present in main.yaml has at least one step', () => {
    // `job.steps?.length ?? 0`: a reusable-workflow job (`uses: ./.github/workflows/x.yaml`,
    // no `steps` key at all) must fail this assertion with a clear "has no steps" message
    // rather than throwing a TypeError on `undefined.length` — main.yaml has none of that
    // shape today, but the assertion should describe the real requirement, not crash on it.
    for (const [jobName, job] of Object.entries(parsed.jobs)) {
      expect(job.steps?.length ?? 0, `job "${jobName}" has no steps`).toBeGreaterThan(0)
    }
  })
})
