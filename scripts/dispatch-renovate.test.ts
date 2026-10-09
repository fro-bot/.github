import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {parse} from 'yaml'

// BDD: buildDispatchPlan
// Given: a list of repo names from metadata/renovate.yaml
// When: buildDispatchPlan is called
// Then: it returns EligibleRepo[] with fro-bot as owner and default workflow path

// BDD: dispatchRenovate
// Given: a list of eligible repos and an Octokit client
// When: dispatchRenovate is called
// Then: for each repo, it checks if a Renovate workflow is already in_progress/queued
//       - if active → skips
//       - if idle → dispatches workflow_dispatch
//       - if API error → records failure

const {mocks, mockOctokit} = vi.hoisted(() => {
  const mocks = {
    listWorkflowRuns: vi.fn(),
    createWorkflowDispatch: vi.fn(),
    listReposAccessibleToInstallation: vi.fn(),
    paginate: vi.fn(),
  }
  return {
    mocks,
    mockOctokit: {
      paginate: mocks.paginate,
      rest: {
        actions: {
          listWorkflowRuns: mocks.listWorkflowRuns,
          createWorkflowDispatch: mocks.createWorkflowDispatch,
        },
        apps: {
          listReposAccessibleToInstallation: mocks.listReposAccessibleToInstallation,
        },
      },
    },
  }
})

describe('buildDispatchPlan', () => {
  it('maps repo names to EligibleRepo with fro-bot owner', async () => {
    const {buildDispatchPlan} = await import('./dispatch-renovate.ts')
    const result = buildDispatchPlan(['agent', '.github', 'tokentoilet'])
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'})
    expect(result[2]).toMatchObject({owner: 'fro-bot', name: 'tokentoilet'})
  })

  it('returns empty array for empty input', async () => {
    const {buildDispatchPlan} = await import('./dispatch-renovate.ts')
    expect(buildDispatchPlan([])).toHaveLength(0)
  })

  it('accepts custom owner', async () => {
    const {buildDispatchPlan} = await import('./dispatch-renovate.ts')
    const result = buildDispatchPlan(['repo1'], 'custom-org')
    expect(result[0]?.owner).toBe('custom-org')
  })
})

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
describe('dispatchRenovate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty result for empty eligible list', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    const result = await dispatchRenovate({octokit: mockOctokit as any, eligible: []})
    expect(result.dispatched).toHaveLength(0)
    expect(result.skippedRunning).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
    expect(mocks.listWorkflowRuns).not.toHaveBeenCalled()
  })

  it('dispatches when no in_progress or queued run exists', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.createWorkflowDispatch.mockResolvedValueOnce({status: 204})

    const result = await dispatchRenovate({
      octokit: mockOctokit as any,
      eligible: [{owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'}],
    })

    expect(result.dispatched).toEqual(['agent'])
    expect(result.skippedRunning).toHaveLength(0)
    expect(mocks.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: 'agent',
      workflow_id: 'renovate.yaml',
      ref: 'main',
    })
  })

  it('skips dispatch when in_progress run exists', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockResolvedValueOnce({
      data: {total_count: 1, workflow_runs: [{id: 123}]},
    })

    const result = await dispatchRenovate({
      octokit: mockOctokit as any,
      eligible: [{owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'}],
    })

    expect(result.dispatched).toHaveLength(0)
    expect(result.skippedRunning).toEqual(['agent'])
    expect(mocks.createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('skips dispatch when queued run exists', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.listWorkflowRuns.mockResolvedValueOnce({
      data: {total_count: 1, workflow_runs: [{id: 456}]},
    })

    const result = await dispatchRenovate({
      octokit: mockOctokit as any,
      eligible: [{owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'}],
    })

    expect(result.dispatched).toHaveLength(0)
    expect(result.skippedRunning).toEqual(['agent'])
    expect(result.failed).toHaveLength(0)
    expect(mocks.createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('records failure when dispatch API errors', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.createWorkflowDispatch.mockRejectedValueOnce(new Error('API 500'))

    const result = await dispatchRenovate({
      octokit: mockOctokit as any,
      eligible: [{owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'}],
    })

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({name: 'agent', error: 'API 500'})
  })

  it('records failure when run-check API errors', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockRejectedValueOnce(new Error('API 403'))

    const result = await dispatchRenovate({
      octokit: mockOctokit as any,
      eligible: [{owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'}],
    })

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({name: 'agent', error: 'API 403'})
  })

  it('handles mixed results across multiple repos', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    // agent: idle → dispatch
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.createWorkflowDispatch.mockResolvedValueOnce({status: 204})
    // .github: in_progress → skip
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 1, workflow_runs: [{id: 1}]}})
    // tokentoilet: idle → dispatch fails
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.listWorkflowRuns.mockResolvedValueOnce({data: {total_count: 0, workflow_runs: []}})
    mocks.createWorkflowDispatch.mockRejectedValueOnce(new Error('timeout'))

    const result = await dispatchRenovate({
      octokit: mockOctokit as any,
      eligible: [
        {owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'},
        {owner: 'fro-bot', name: '.github', workflowPath: 'renovate.yaml'},
        {owner: 'fro-bot', name: 'tokentoilet', workflowPath: 'renovate.yaml'},
      ],
    })

    expect(result.dispatched).toEqual(['agent'])
    expect(result.skippedRunning).toEqual(['.github'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.name).toBe('tokentoilet')
  })
})
/* eslint-enable @typescript-eslint/no-unsafe-assignment */

// BDD: planning mode
// Given: the discovery client (installation repos) and the parsed metadata/renovate.yaml list
// When: the plan is built
// Then: the cleaned intersection is written to GITHUB_OUTPUT; stale, blank and duplicate entries never
//       reach the dispatch mint, and a failed discovery fails the step instead of widening reach.

interface FakeRepo {
  name: string
  owner: {login: string}
}

function installation(...names: string[]): FakeRepo[] {
  return names.map(name => ({name, owner: {login: 'fro-bot'}}))
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
describe('cleanRepoNames', () => {
  it('trims, drops empties and dedupes while keeping first-seen order', async () => {
    const {cleanRepoNames} = await import('./dispatch-renovate.ts')
    expect(cleanRepoNames([' agent ', '', '   ', 'agent', '.github', '\ttokentoilet\n', '.github'])).toEqual([
      'agent',
      '.github',
      'tokentoilet',
    ])
  })

  it('returns an empty list for an empty input', async () => {
    const {cleanRepoNames} = await import('./dispatch-renovate.ts')
    expect(cleanRepoNames([])).toEqual([])
  })
})

describe('planDispatchRepositories', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('lists the installation with pagination and returns both listed repos when both are installed', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent', '.github', 'tokentoilet'))

    const plan = await planDispatchRepositories({octokit: mockOctokit as any, requested: ['agent', '.github']})

    expect(plan).toEqual(['agent', '.github'])
    expect(mocks.paginate).toHaveBeenCalledWith(mocks.listReposAccessibleToInstallation, {per_page: 100})
  })

  it('drops a listed repo the installation no longer covers', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent'))

    const plan = await planDispatchRepositories({octokit: mockOctokit as any, requested: ['agent', 'gone-repo']})

    expect(plan).toEqual(['agent'])
  })

  it('ignores installation repos under a different owner', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'agent', owner: {login: 'someone-else'}},
      {name: '.github', owner: {login: 'fro-bot'}},
    ])

    const plan = await planDispatchRepositories({octokit: mockOctokit as any, requested: ['agent', '.github']})

    expect(plan).toEqual(['.github'])
  })

  it('cleans whitespace, duplicate and empty entries before intersecting', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent', '.github'))

    const plan = await planDispatchRepositories({
      octokit: mockOctokit as any,
      requested: [' agent ', '', '  ', 'agent', '.github'],
    })

    expect(plan).toEqual(['agent', '.github'])
  })

  it('returns an empty plan when every entry is stale', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('unrelated'))

    const plan = await planDispatchRepositories({octokit: mockOctokit as any, requested: ['gone-1', 'gone-2']})

    expect(plan).toEqual([])
  })

  it('returns an empty plan without calling the API when there is nothing requested', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')

    const plan = await planDispatchRepositories({octokit: mockOctokit as any, requested: ['', '  ']})

    expect(plan).toEqual([])
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it('rejects when discovery fails, never falling back to the unfiltered list', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API 403'))

    await expect(planDispatchRepositories({octokit: mockOctokit as any, requested: ['agent']})).rejects.toThrow(
      'API 403',
    )
  })
})

describe('runPlanMode', () => {
  let dir = ''

  beforeEach(async () => {
    vi.resetAllMocks()
    if (dir !== '') await rm(dir, {recursive: true, force: true})
    dir = await mkdtemp(join(tmpdir(), 'dispatch-renovate-'))
  })

  async function renovateFile(names: string[]): Promise<string> {
    const path = join(dir, 'renovate.yaml')
    await writeFile(path, `repositories:\n  with-renovate: ${JSON.stringify(names)}\n`)
    return path
  }

  it('writes the comma-separated cleaned list to GITHUB_OUTPUT', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent', '.github'))
    const outputPath = join(dir, 'output')

    await runPlanMode({
      octokit: mockOctokit as any,
      renovatePath: await renovateFile([' agent', 'agent', '.github', 'stale']),
      outputPath,
    })

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=agent,.github\n')
  })

  it('writes an empty output when every entry is stale', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('unrelated'))
    const outputPath = join(dir, 'output')

    await runPlanMode({octokit: mockOctokit as any, renovatePath: await renovateFile(['stale']), outputPath})

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
  })

  it('writes an empty output when the file has no with-renovate entries', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const outputPath = join(dir, 'output')

    await runPlanMode({octokit: mockOctokit as any, renovatePath: await renovateFile([]), outputPath})

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it('writes an empty output when metadata/renovate.yaml does not exist yet', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const outputPath = join(dir, 'output')

    await runPlanMode({octokit: mockOctokit as any, renovatePath: join(dir, 'missing.yaml'), outputPath})

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
  })

  it('fails the step on a discovery error and writes no output', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API 500'))
    const outputPath = join(dir, 'output')

    await expect(
      runPlanMode({octokit: mockOctokit as any, renovatePath: await renovateFile(['agent']), outputPath}),
    ).rejects.toThrow('API 500')
    await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
  })

  it('fails the step on a corrupt renovate.yaml rather than treating it as empty', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const path = join(dir, 'renovate.yaml')
    await writeFile(path, 'repositories: nope\n')

    await expect(
      runPlanMode({octokit: mockOctokit as any, renovatePath: path, outputPath: join(dir, 'o')}),
    ).rejects.toThrow()
  })
})
/* eslint-enable @typescript-eslint/no-unsafe-assignment */

// ─── Workflow contract ──────────────────────────────────────────────────────

interface ContractStep {
  id?: string
  uses?: string
  if?: string
  run?: string
  env?: Record<string, unknown>
  with?: Record<string, unknown>
}

const gh = (inner: string): string => `$${'{{'} ${inner} }}`

async function loadWorkflowSteps(): Promise<ContractStep[]> {
  const raw: unknown = parse(await readFile('.github/workflows/dispatch-renovate.yaml', 'utf8'))
  const jobs = (raw as {jobs?: Record<string, {steps?: ContractStep[]}>}).jobs
  const steps = jobs?.['dispatch-renovate']?.steps
  if (steps === undefined) throw new TypeError('dispatch-renovate job has no steps')
  return steps
}

describe('dispatch-renovate.yaml workflow contract', () => {
  it('mints an owner-wide metadata:read discovery token and nothing wider', async () => {
    const steps = await loadWorkflowSteps()
    const discovery = steps.find(step => step.id === 'discovery-token')
    expect(discovery?.uses).toContain('actions/create-github-app-token@')
    expect(discovery?.with?.owner).toBe('fro-bot')
    expect(discovery?.with).not.toHaveProperty('repositories')
    const permissions = Object.entries(discovery?.with ?? {}).filter(([name]) => name.startsWith('permission-'))
    expect(permissions).toStrictEqual([['permission-metadata', 'read']])
  })

  it('plans with only the discovery token, after checkout and setup', async () => {
    const steps = await loadWorkflowSteps()
    const ids = steps.map(step => step.id)
    const plan = steps.find(step => step.id === 'plan')
    expect(plan?.run).toContain('scripts/dispatch-renovate.ts plan')
    expect(plan?.env?.GITHUB_TOKEN).toBe(gh('steps.discovery-token.outputs.token'))
    expect(JSON.stringify(plan)).not.toContain('dispatch-token')
    const planIndex = steps.indexOf(plan as ContractStep)
    const checkoutIndex = steps.findIndex(step => step.uses?.startsWith('actions/checkout@'))
    const setupIndex = steps.findIndex(step => step.uses === './.github/actions/setup')
    expect(checkoutIndex).toBeGreaterThanOrEqual(0)
    expect(setupIndex).toBeGreaterThan(checkoutIndex)
    expect(planIndex).toBeGreaterThan(setupIndex)
    expect(ids.indexOf('dispatch-token')).toBeGreaterThan(planIndex)
  })

  it('mints the dispatch token for the planned list only, guarded on a non-empty list', async () => {
    const steps = await loadWorkflowSteps()
    const dispatchMint = steps.find(step => step.id === 'dispatch-token')
    expect(dispatchMint?.uses).toContain('actions/create-github-app-token@')
    expect(dispatchMint?.if).toBe("steps.plan.outputs.repositories != ''")
    expect(dispatchMint?.with?.owner).toBe('fro-bot')
    expect(dispatchMint?.with?.repositories).toBe(gh('steps.plan.outputs.repositories'))
    expect(dispatchMint?.with?.['permission-actions']).toBe('write')
    const permissions = Object.keys(dispatchMint?.with ?? {}).filter(name => name.startsWith('permission-'))
    expect(permissions).toStrictEqual(['permission-actions'])
  })

  it('dispatches with only the dispatch token, under the same guard, for the planned list', async () => {
    const steps = await loadWorkflowSteps()
    const dispatch = steps.find(step => step.id === 'dispatch')
    expect(dispatch?.if).toBe("steps.plan.outputs.repositories != ''")
    expect(dispatch?.env?.GITHUB_TOKEN).toBe(gh('steps.dispatch-token.outputs.token'))
    expect(dispatch?.env?.DISPATCH_REPOSITORIES).toBe(gh('steps.plan.outputs.repositories'))
    expect(JSON.stringify(dispatch)).not.toContain('discovery-token')
    expect(dispatch?.run).toContain('scripts/dispatch-renovate.ts')
  })
})
