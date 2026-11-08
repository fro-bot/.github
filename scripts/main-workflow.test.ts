import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

// Guard for the mutation gate jobs in `main.yaml` (three `mutation-shard-<n>` jobs and the final required
// `check-mutation-guards` job) and for the `mutation-shard` composite action: `main.yaml` had no shape test at
// all before this file. Mirrors `scripts/merge-data-workflow.test.ts`'s parse + narrowing-assert + job-shape
// pattern. `always()` has no evaluator in `@fro-bot/test-kit`, so the final job's `if` is pinned as a literal
// string and its status behaviour is checked live on the pull request.

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
  readonly needs?: readonly string[]
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

const EXPRESSION_START = '$' + '{{'
const HEAD_SHA = `${EXPRESSION_START} github.event.pull_request.head.sha }}`
const SHARD_JOBS = ['mutation-shard-1', 'mutation-shard-2', 'mutation-shard-3'] as const
const SHA_PINNED_ACTION = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u

function loadMainWorkflow(): {jobs: Record<string, MainWorkflowJob>} {
  const parsed: unknown = parse(readFileSync(resolve(import.meta.dirname, '../.github/workflows/main.yaml'), 'utf8'))
  assertMainWorkflow(parsed)
  return parsed
}

interface CompositeStep {
  readonly name?: string
  readonly run?: string
  readonly shell?: string
  readonly uses?: string
  readonly with?: Record<string, unknown>
  readonly env?: Record<string, unknown>
  readonly if?: string
}

interface CompositeAction {
  readonly inputs?: Record<string, {readonly required?: boolean}>
  readonly runs?: {readonly using?: string; readonly steps?: readonly CompositeStep[]}
}

function loadShardAction(): CompositeAction {
  const parsed: unknown = parse(
    readFileSync(resolve(import.meta.dirname, '../.github/actions/mutation-shard/action.yaml'), 'utf8'),
  )
  if (typeof parsed !== 'object' || parsed === null) throw new TypeError('mutation-shard action.yaml is not a mapping')
  return parsed
}

describe('main.yaml check-mutation-guards job (the final, required job)', () => {
  const parsed = loadMainWorkflow()
  const job = parsed.jobs['check-mutation-guards']

  it('exists in main.yaml (fails if the job is removed)', () => {
    expect(job).toBeDefined()
  })

  it('has the exact job name "Check Mutation Guards" (becomes the required status check context)', () => {
    expect(job?.name).toBe('Check Mutation Guards')
  })

  it("runs on every pull_request whatever the shard results: the literal if is always() && github.event_name == 'pull_request'", () => {
    expect(job?.if).toBe("always() && github.event_name == 'pull_request'")
  })

  it('needs all three shard jobs, and nothing else', () => {
    expect([...(job?.needs ?? [])].toSorted()).toEqual([...SHARD_JOBS])
  })

  it.each(SHARD_JOBS)('needs %s (removing it from needs would let its failure pass unnoticed)', shard => {
    expect(job?.needs).toContain(shard)
  })

  it('requests least-privilege permissions: contents read, nothing else (it reads no pull request and calls no API)', () => {
    expect(job?.permissions).toEqual({contents: 'read'})
  })

  it('checks out the pull request head SHA, not the branch name or the merge commit', () => {
    const checkout = job?.steps?.find(step => step.uses?.startsWith('actions/checkout@') === true)
    expect(checkout?.with?.ref).toBe(HEAD_SHA)
  })

  it('uses the shared setup action', () => {
    expect(job?.steps?.find(step => step.uses === './.github/actions/setup')).toBeDefined()
  })

  it('downloads the shard artifacts by pattern, with no merge-multiple, outside reports/mutation/', () => {
    const download = job?.steps?.find(step => step.uses?.startsWith('actions/download-artifact@') === true)
    expect(download).toBeDefined()
    expect(download?.with?.pattern).toBe('mutation-shard-*')
    expect(download?.with).not.toHaveProperty('merge-multiple')
    expect(download?.with).not.toHaveProperty('name')
    const path = String(download?.with?.path)
    expect(path).toBe(`${EXPRESSION_START} runner.temp }}/mutation-shards`)
    expect(path).not.toContain('reports/mutation')
  })

  it('runs the merge shim, which receives the artifact directory, the event SHA and every shard result by name', () => {
    const merge = job?.steps?.find(step => step.run === 'bun scripts/mutation-merge.ts')
    expect(merge).toBeDefined()
    expect(merge?.env).toEqual({
      MUTATION_ARTIFACT_DIR: `${EXPRESSION_START} runner.temp }}/mutation-shards`,
      MUTATION_EVENT_SHA: HEAD_SHA,
      MUTATION_SHARD_1_RESULT: `${EXPRESSION_START} needs.mutation-shard-1.result }}`,
      MUTATION_SHARD_2_RESULT: `${EXPRESSION_START} needs.mutation-shard-2.result }}`,
      MUTATION_SHARD_3_RESULT: `${EXPRESSION_START} needs.mutation-shard-3.result }}`,
    })
  })

  it('runs the merge after the download and before the upload', () => {
    const order = (job?.steps ?? []).map(step => step.uses?.split('@')[0] ?? step.run ?? '')
    expect(order.indexOf('actions/download-artifact')).toBeGreaterThan(order.indexOf('./.github/actions/setup'))
    expect(order.indexOf('bun scripts/mutation-merge.ts')).toBeGreaterThan(order.indexOf('actions/download-artifact'))
    expect(order.indexOf('actions/upload-artifact')).toBeGreaterThan(order.indexOf('bun scripts/mutation-merge.ts'))
  })

  it('uploads the merged mutation report even when the merge step fails, replacing an earlier attempt', () => {
    const uploadStep = job?.steps?.find(step => step.uses?.startsWith('actions/upload-artifact@') === true)
    expect(uploadStep).toBeDefined()
    expect(uploadStep?.if).toBe('always()')
    expect(uploadStep?.with?.name).toBe('mutation-report')
    expect(uploadStep?.with?.path).toBe('reports/mutation/')
    expect(uploadStep?.with?.overwrite).toBe(true)
    expect(uploadStep?.with?.['retention-days']).toBe(7)
  })

  it('sets a timeout of 10 minutes', () => {
    expect(job?.['timeout-minutes']).toBe(10)
  })

  it('does not declare a per-job concurrency group (inherits the workflow-level one)', () => {
    expect(job).not.toHaveProperty('concurrency')
  })
})

describe('main.yaml mutation shard jobs', () => {
  const parsed = loadMainWorkflow()

  it.each(SHARD_JOBS.map((id, index) => [id, index + 1] as const))('%s is named "Mutation Shard %i"', (id, number) => {
    expect(parsed.jobs[id]?.name).toBe(`Mutation Shard ${String(number)}`)
  })

  it.each(SHARD_JOBS)("%s runs only on pull_request events (if: github.event_name == 'pull_request')", id => {
    expect(parsed.jobs[id]?.if).toBe("github.event_name == 'pull_request'")
  })

  it.each(SHARD_JOBS)('%s runs in parallel: it needs no other job', id => {
    expect(parsed.jobs[id]).not.toHaveProperty('needs')
  })

  it.each(SHARD_JOBS)('%s requests contents read and pull-requests read, as the single job did', id => {
    expect(parsed.jobs[id]?.permissions).toEqual({contents: 'read', 'pull-requests': 'read'})
  })

  it.each(SHARD_JOBS)('%s has a timeout of 20 minutes', id => {
    expect(parsed.jobs[id]?.['timeout-minutes']).toBe(20)
  })

  it.each(SHARD_JOBS)('%s checks out the pull request head SHA, then runs the composite', id => {
    const steps = parsed.jobs[id]?.steps ?? []
    expect(steps).toHaveLength(2)
    expect(steps[0]?.uses?.startsWith('actions/checkout@')).toBe(true)
    expect(steps[0]?.with?.ref).toBe(HEAD_SHA)
    expect(steps[1]?.uses).toBe('./.github/actions/mutation-shard')
  })

  it.each(SHARD_JOBS.map((id, index) => [id, String(index + 1)] as const))(
    '%s gives the composite its own shard number and the pull request head SHA',
    (id, number) => {
      const composite = parsed.jobs[id]?.steps?.find(step => step.uses === './.github/actions/mutation-shard')
      expect(composite?.with).toEqual({shard: number, 'event-sha': HEAD_SHA})
    },
  )

  it('the three shards differ only in their number', () => {
    const shape = (id: string): string =>
      JSON.stringify(parsed.jobs[id], null, 1).replaceAll(/Shard \d|"shard": "\d"/gu, 'N')
    expect(shape('mutation-shard-2')).toBe(shape('mutation-shard-1'))
    expect(shape('mutation-shard-3')).toBe(shape('mutation-shard-1'))
  })
})

describe('the mutation-shard composite action', () => {
  const action = loadShardAction()
  const steps = action.runs?.steps ?? []

  it('is a composite action with shard and event-sha as required inputs', () => {
    expect(action.runs?.using).toBe('composite')
    expect(action.inputs?.shard?.required).toBe(true)
    expect(action.inputs?.['event-sha']?.required).toBe(true)
  })

  it('runs the shared setup action first', () => {
    expect(steps[0]?.uses).toBe('./.github/actions/setup')
  })

  it('runs the shard shim with GH_TOKEN, the shard, the event SHA and the output directory in env', () => {
    const shard = steps.find(step => step.run === 'bun scripts/mutation-shard.ts')
    expect(shard).toBeDefined()
    expect(shard?.env).toEqual({
      GH_TOKEN: `${EXPRESSION_START} github.token }}`,
      MUTATION_SHARD: `${EXPRESSION_START} inputs.shard }}`,
      MUTATION_SHARD_EVENT_SHA: `${EXPRESSION_START} inputs.event-sha }}`,
      MUTATION_SHARD_OUTPUT_DIR: `${EXPRESSION_START} runner.temp }}/mutation-shard-${EXPRESSION_START} inputs.shard }}`,
    })
  })

  it('uploads mutation-shard-<n> only on success, replacing an earlier attempt, and errors on an empty upload', () => {
    const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@') === true)
    expect(upload).toBeDefined()
    expect(upload?.if).toBe('success()')
    expect(upload?.with?.name).toBe(`mutation-shard-${EXPRESSION_START} inputs.shard }}`)
    expect(upload?.with?.path).toBe(
      `${EXPRESSION_START} runner.temp }}/mutation-shard-${EXPRESSION_START} inputs.shard }}`,
    )
    expect(upload?.with?.overwrite).toBe(true)
    expect(upload?.with?.['if-no-files-found']).toBe('error')
  })

  it('uploads the directory the shard step writes to', () => {
    const shard = steps.find(step => step.run === 'bun scripts/mutation-shard.ts')
    const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@') === true)
    expect(upload?.with?.path).toBe(shard?.env?.MUTATION_SHARD_OUTPUT_DIR)
  })

  it('declares shell: bash on every run step', () => {
    const runSteps = steps.filter(step => step.run !== undefined)
    expect(runSteps.length).toBeGreaterThan(0)
    for (const step of runSteps) expect(step.shell, step.name).toBe('bash')
  })
})

describe('the mutation jobs and the composite keep expressions out of run:', () => {
  const parsed = loadMainWorkflow()
  const composite = loadShardAction()

  it('has no ${{ in any run: of the shard jobs, the final job or the composite', () => {
    const runs = [
      ...[...SHARD_JOBS, 'check-mutation-guards'].flatMap(id => parsed.jobs[id]?.steps ?? []),
      ...(composite.runs?.steps ?? []),
    ]
      .map(step => step.run)
      .filter((run): run is string => run !== undefined)
    expect(runs.length).toBeGreaterThanOrEqual(2)
    for (const run of runs) expect(run).not.toContain(EXPRESSION_START)
  })

  it('pins every third-party action in them by a full commit SHA', () => {
    const uses = [
      ...[...SHARD_JOBS, 'check-mutation-guards'].flatMap(id => parsed.jobs[id]?.steps ?? []),
      ...(composite.runs?.steps ?? []),
    ]
      .map(step => step.uses)
      .filter((value): value is string => value !== undefined && !value.startsWith('./'))
    expect(uses.length).toBeGreaterThanOrEqual(5)
    for (const value of uses) expect(value, value).toMatch(SHA_PINNED_ACTION)
  })

  it('uses the same pins as the rest of main.yaml for checkout, and those the repo already uses for the artifact actions', () => {
    const lint = parsed.jobs.lint?.steps?.find(step => step.uses?.startsWith('actions/checkout@'))
    const finalJob = parsed.jobs['check-mutation-guards']?.steps?.find(step =>
      step.uses?.startsWith('actions/checkout@'),
    )
    expect(finalJob?.uses).toBe(lint?.uses)
  })
})

interface SettingsBranchProtection {
  readonly required_status_checks?: {
    // `unknown`, not `string`: an unquoted colon-bearing context (e.g. `Security: Private
    // Leak Scan`) parses as a YAML mapping, not a string, and a `readonly string[]` type
    // would silently assume that away instead of letting the string-invariant test below
    // actually check it.
    readonly contexts?: readonly unknown[]
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

  it('has only string entries in required_status_checks.contexts (an unquoted colon-bearing context parses as a YAML mapping, not a string)', () => {
    const contexts = mainBranch?.protection?.required_status_checks?.contexts
    // Pin the premise: without this the loop below passes vacuously if the key ever moves.
    expect(
      Array.isArray(contexts) && contexts.length > 0,
      'required_status_checks.contexts must be a non-empty array',
    ).toBe(true)
    for (const context of contexts ?? []) {
      expect(typeof context, `context entry ${JSON.stringify(context)} is not a string`).toBe('string')
    }
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
