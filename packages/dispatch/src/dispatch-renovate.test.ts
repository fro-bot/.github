import type {CliClient, DispatchClient, PlanClient} from './dispatch-renovate.ts'
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

const {mocks} = vi.hoisted(() => ({
  mocks: {
    listWorkflowRuns: vi.fn(),
    createWorkflowDispatch: vi.fn(),
    listReposAccessibleToInstallation: vi.fn(),
    paginate: vi.fn(),
  },
}))

// Narrow structural client for the plan path: only what planning calls. `satisfies` keeps the mock
// honest against the production type with no cast.
const planClient = {
  paginate: mocks.paginate,
  rest: {apps: {listReposAccessibleToInstallation: mocks.listReposAccessibleToInstallation}},
} satisfies PlanClient

// Narrow doubles typed against the production seams; no casts. The full client covers both modes.
const dispatchClient = {
  rest: {actions: {listWorkflowRuns: mocks.listWorkflowRuns, createWorkflowDispatch: mocks.createWorkflowDispatch}},
} satisfies DispatchClient

const cliClient = {
  paginate: mocks.paginate,
  rest: {
    apps: {listReposAccessibleToInstallation: mocks.listReposAccessibleToInstallation},
    actions: {listWorkflowRuns: mocks.listWorkflowRuns, createWorkflowDispatch: mocks.createWorkflowDispatch},
  },
} satisfies CliClient

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

describe('dispatchRenovate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty result for empty eligible list', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    const result = await dispatchRenovate({octokit: dispatchClient, eligible: []})
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
      octokit: dispatchClient,
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
      octokit: dispatchClient,
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
      octokit: dispatchClient,
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
      octokit: dispatchClient,
      eligible: [{owner: 'fro-bot', name: 'agent', workflowPath: 'renovate.yaml'}],
    })

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({name: 'agent', error: 'API 500'})
  })

  it('records failure when run-check API errors', async () => {
    const {dispatchRenovate} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockRejectedValueOnce(new Error('API 403'))

    const result = await dispatchRenovate({
      octokit: dispatchClient,
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
      octokit: dispatchClient,
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

// BDD: planning mode
// Given: the discovery client (installation repos) and the parsed metadata/renovate.yaml list
// When: the plan is built
// Then: the cleaned intersection is written to GITHUB_OUTPUT; stale, blank and duplicate entries never
//       reach the dispatch mint, and a failed discovery fails the step instead of widening reach.

interface FakeRepo {
  name: string
  owner: {login: string}
  node_id?: string
  id?: number
}

function installation(...names: string[]): FakeRepo[] {
  return names.map(name => ({name, owner: {login: 'fro-bot'}}))
}

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

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['agent', '.github'],
      archivedRows: [],
    })

    expect(plan).toEqual(['agent', '.github'])
    expect(mocks.paginate).toHaveBeenCalledWith(mocks.listReposAccessibleToInstallation, {per_page: 100})
  })

  it('drops a listed repo the installation no longer covers', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent'))

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['agent', 'gone-repo'],
      archivedRows: [],
    })

    expect(plan).toEqual(['agent'])
  })

  it('ignores installation repos under a different owner', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'agent', owner: {login: 'someone-else'}},
      {name: '.github', owner: {login: 'fro-bot'}},
    ])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['agent', '.github'],
      archivedRows: [],
    })

    expect(plan).toEqual(['.github'])
  })

  it('cleans whitespace, duplicate and empty entries before intersecting', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent', '.github'))

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: [' agent ', '', '  ', 'agent', '.github'],
      archivedRows: [],
    })

    expect(plan).toEqual(['agent', '.github'])
  })

  it('returns an empty plan when every entry is stale', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('unrelated'))

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['gone-1', 'gone-2'],
      archivedRows: [],
    })

    expect(plan).toEqual([])
  })

  it('returns an empty plan without calling the API when there is nothing requested', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')

    const plan = await planDispatchRepositories({octokit: planClient, requested: ['', '  '], archivedRows: []})

    expect(plan).toEqual([])
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it('rejects when discovery fails, never falling back to the unfiltered list', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API 403'))

    await expect(
      planDispatchRepositories({octokit: planClient, requested: ['agent'], archivedRows: []}),
    ).rejects.toThrow('API 403')
  })
})

describe('planDispatchRepositories (archived rows)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const row = (overrides: Record<string, unknown> = {}) => ({
    owner: 'fro-bot',
    name: 'retired-repo',
    ...overrides,
  })

  it('drops a repository whose node ID matches an archived row, though GitHub does not report it archived', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'retired-repo', owner: {login: 'fro-bot'}, node_id: 'R_kgDORETIRED', id: 11},
      {name: 'live-repo', owner: {login: 'fro-bot'}, node_id: 'R_kgDOLIVE', id: 12},
    ])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['retired-repo', 'live-repo'],
      archivedRows: [row({node_id: 'R_kgDORETIRED', database_id: 11})],
    })

    expect(plan).toEqual(['live-repo'])
  })

  it('still drops it after a rename on GitHub: the archived row keeps its stored name, the IDs match', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'retired-repo-renamed', owner: {login: 'fro-bot'}, node_id: 'R_kgDORETIRED', id: 11},
    ])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['retired-repo-renamed'],
      archivedRows: [row({node_id: 'R_kgDORETIRED', database_id: 11})],
    })

    expect(plan).toEqual([])
  })

  it.each([
    ['node ID only', {node_id: 'R_kgDORETIRED'}, {node_id: 'R_kgDORETIRED', id: 99}],
    ['database ID only', {database_id: 11}, {node_id: 'R_kgDOOTHER', id: 11}],
  ])('matches an archived row by %s', async (_label, rowIds, repoIds) => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([{name: 'renamed', owner: {login: 'fro-bot'}, ...repoIds}])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['renamed'],
      archivedRows: [row(rowIds)],
    })

    expect(plan).toEqual([])
  })

  it('matches a row with neither ID by owner and name', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'retired-repo', owner: {login: 'fro-bot'}, node_id: 'R_kgDOANY', id: 1},
      {name: 'live-repo', owner: {login: 'fro-bot'}, node_id: 'R_kgDOLIVE', id: 2},
    ])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['retired-repo', 'live-repo'],
      archivedRows: [row()],
    })

    expect(plan).toEqual(['live-repo'])
  })

  it('does not match an archived row that has IDs by name alone: a new repository may reuse the name', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'retired-repo', owner: {login: 'fro-bot'}, node_id: 'R_kgDONEWREPO', id: 77},
    ])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['retired-repo'],
      archivedRows: [row({node_id: 'R_kgDORETIRED', database_id: 11})],
    })

    expect(plan).toEqual(['retired-repo'])
  })

  it('does not match an owner-and-name row against another owner', async () => {
    const {planDispatchRepositories} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([{name: 'retired-repo', owner: {login: 'fro-bot'}}])

    const plan = await planDispatchRepositories({
      octokit: planClient,
      requested: ['retired-repo'],
      archivedRows: [row({owner: 'someone-else'})],
    })

    expect(plan).toEqual(['retired-repo'])
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

  async function registryFile(): Promise<string> {
    const path = join(dir, 'repos.yaml')
    await writeFile(path, 'version: 1\nrepos: []\n')
    return path
  }

  it('writes the comma-separated cleaned list to GITHUB_OUTPUT', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent', '.github'))
    const outputPath = join(dir, 'output')

    await runPlanMode({
      octokit: planClient,
      renovatePath: await renovateFile([' agent', 'agent', '.github', 'stale']),
      registryPath: await registryFile(),
      outputPath,
    })

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=agent,.github\n')
  })

  it('writes an empty output when every entry is stale', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('unrelated'))
    const outputPath = join(dir, 'output')

    await runPlanMode({
      octokit: planClient,
      renovatePath: await renovateFile(['stale']),
      registryPath: await registryFile(),
      outputPath,
    })

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
  })

  it('writes an empty output when the file has no with-renovate entries', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const outputPath = join(dir, 'output')

    await runPlanMode({
      octokit: planClient,
      renovatePath: await renovateFile([]),
      registryPath: await registryFile(),
      outputPath,
    })

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it('writes an empty output when metadata/renovate.yaml does not exist yet', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const outputPath = join(dir, 'output')

    await runPlanMode({
      octokit: planClient,
      renovatePath: join(dir, 'missing.yaml'),
      registryPath: await registryFile(),
      outputPath,
    })

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
  })

  it('fails the step on a discovery error and writes no output', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API 500'))
    const outputPath = join(dir, 'output')

    await expect(
      runPlanMode({
        octokit: planClient,
        renovatePath: await renovateFile(['agent']),
        registryPath: await registryFile(),
        outputPath,
      }),
    ).rejects.toThrow('API 500')
    await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
  })

  it('fails the step on a corrupt renovate.yaml rather than treating it as empty', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const path = join(dir, 'renovate.yaml')
    await writeFile(path, 'repositories: nope\n')

    await expect(
      runPlanMode({
        octokit: planClient,
        renovatePath: path,
        registryPath: await registryFile(),
        outputPath: join(dir, 'o'),
      }),
    ).rejects.toThrow()
  })
})

describe('runPlanMode (archived rows and the registry)', () => {
  let dir = ''
  const FIXED_LINE = 'dispatch-renovate: registry unreadable; planning no repositories\n'

  beforeEach(async () => {
    vi.resetAllMocks()
    if (dir !== '') await rm(dir, {recursive: true, force: true})
    dir = await mkdtemp(join(tmpdir(), 'dispatch-renovate-archived-'))
  })

  async function renovateFile(names: string[]): Promise<string> {
    const path = join(dir, 'renovate.yaml')
    await writeFile(path, `repositories:\n  with-renovate: ${JSON.stringify(names)}\n`)
    return path
  }

  const registryRow = (name: string, status: string, ids = '') => `  - owner: fro-bot
    name: ${name}
    added: '2026-01-01'
    onboarding_status: ${status}
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: true
    discovery_channel: owned
    next_survey_eligible_at: null
    private: false
${ids}`

  async function registryText(text: string): Promise<string> {
    const path = join(dir, 'repos.yaml')
    await writeFile(path, text)
    return path
  }

  it('leaves an archived repository out of the plan that GitHub reports as active under a new name', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'retired-renamed', owner: {login: 'fro-bot'}, node_id: 'R_kgDORETIRED', id: 11},
      {name: 'live-repo', owner: {login: 'fro-bot'}, node_id: 'R_kgDOLIVE', id: 12},
    ])
    const outputPath = join(dir, 'output')
    const registryPath = await registryText(
      `version: 1\nrepos:\n${registryRow('retired-repo', 'archived', '    node_id: R_kgDORETIRED\n    database_id: 11\n')}${registryRow('live-repo', 'onboarded', '    node_id: R_kgDOLIVE\n    database_id: 12\n')}`,
    )

    const plan = await runPlanMode({
      octokit: planClient,
      renovatePath: await renovateFile(['retired-renamed', 'live-repo']),
      registryPath,
      outputPath,
    })

    expect(plan).toEqual(['live-repo'])
    expect(await readFile(outputPath, 'utf8')).toBe('repositories=live-repo\n')
  })

  it.each([
    ['a missing file', async () => join(dir, 'absent.yaml')],
    ['malformed YAML', async () => registryText(': : [[[')],
    ['an invalid registry', async () => registryText('version: 1\nrepos: nope\n')],
    ['an empty file', async () => registryText('')],
  ])('plans no repositories and logs one fixed line for %s, with no discovery call', async (_label, makePath) => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    const outputPath = join(dir, 'output')
    const lines: string[] = []

    const plan = await runPlanMode({
      octokit: planClient,
      renovatePath: await renovateFile(['agent']),
      registryPath: await makePath(),
      outputPath,
      stderr: text => {
        lines.push(text)
      },
    })

    expect(plan).toEqual([])
    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
    expect(lines).toEqual([FIXED_LINE])
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it('logs nothing for a readable registry', async () => {
    const {runPlanMode} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent'))
    const lines: string[] = []

    await runPlanMode({
      octokit: planClient,
      renovatePath: await renovateFile(['agent']),
      registryPath: await registryText('version: 1\nrepos: []\n'),
      outputPath: join(dir, 'output'),
      stderr: text => {
        lines.push(text)
      },
    })

    expect(lines).toEqual([])
  })
})

describe('runRenovatePlanCli and runRenovateDispatchCli (inputs)', () => {
  let dir = ''
  let outputPath = ''
  let renovatePath = ''
  let registryPath = ''
  const createOctokit = vi.fn(async (_token: string) => cliClient)
  const out: string[] = []
  const stdout = (text: string) => {
    out.push(text)
  }

  beforeEach(async () => {
    vi.resetAllMocks()
    out.length = 0
    createOctokit.mockImplementation(async () => cliClient)
    if (dir !== '') await rm(dir, {recursive: true, force: true})
    dir = await mkdtemp(join(tmpdir(), 'dispatch-renovate-cli-'))
    outputPath = join(dir, 'output')
    renovatePath = join(dir, 'renovate.yaml')
    await writeFile(renovatePath, 'repositories:\n  with-renovate: ["agent", ".github", "stale"]\n')
    registryPath = join(dir, 'repos.yaml')
    await writeFile(registryPath, 'version: 1\nrepos: []\n')
  })

  const planEnv = () => ({GITHUB_TOKEN: 'discovery-token', GITHUB_OUTPUT: outputPath})
  const dispatchEnv = () => ({GITHUB_TOKEN: 'dispatch-token', DISPATCH_REPOSITORIES: 'agent,.github'})

  it('plan mode lists, writes the output and never dispatches', async () => {
    const {runRenovatePlanCli} = await import('./dispatch-renovate.ts')
    mocks.paginate.mockResolvedValueOnce(installation('agent', '.github'))

    // DISPATCH_REPOSITORIES is set on purpose: plan mode must ignore it.
    await runRenovatePlanCli(
      {...planEnv(), DISPATCH_REPOSITORIES: 'other'},
      {createOctokit, stdout, renovatePath, registryPath},
    )

    expect(createOctokit).toHaveBeenCalledExactlyOnceWith('discovery-token')
    expect(await readFile(outputPath, 'utf8')).toBe('repositories=agent,.github\n')
    expect(out.join('')).toBe('dispatch-renovate: planned 2 repositories\n')
    expect(mocks.listWorkflowRuns).not.toHaveBeenCalled()
    expect(mocks.createWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('plan mode with an unreadable registry plans nothing, says so once on stderr and never lists the installation', async () => {
    const {runRenovatePlanCli} = await import('./dispatch-renovate.ts')
    const lines: string[] = []

    await runRenovatePlanCli(planEnv(), {
      createOctokit,
      stdout,
      renovatePath,
      registryPath: join(dir, 'absent.yaml'),
      stderr: text => {
        lines.push(text)
      },
    })

    expect(await readFile(outputPath, 'utf8')).toBe('repositories=\n')
    expect(lines).toEqual(['dispatch-renovate: registry unreadable; planning no repositories\n'])
    expect(out.join('')).toBe('dispatch-renovate: planned 0 repositories\n')
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it('dispatch mode dispatches the planned list and never lists the installation', async () => {
    const {runRenovateDispatchCli} = await import('./dispatch-renovate.ts')
    mocks.listWorkflowRuns.mockResolvedValue({data: {total_count: 0}})
    mocks.createWorkflowDispatch.mockResolvedValue({status: 204})

    await runRenovateDispatchCli(dispatchEnv(), {createOctokit, stdout})

    expect(createOctokit).toHaveBeenCalledExactlyOnceWith('dispatch-token')
    expect(mocks.createWorkflowDispatch).toHaveBeenCalledTimes(2)
    expect(mocks.createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: 'agent',
      workflow_id: 'renovate.yaml',
      ref: 'main',
    })
    expect(mocks.paginate).not.toHaveBeenCalled()
    expect(JSON.parse(out.join(''))).toEqual({eligible: 2, dispatched: 2, skippedRunning: 0, failed: 0})
  })

  it.each(['plan', 'dispatch'] as const)(
    '%s mode fails without GITHUB_TOKEN, before building any client',
    async mode => {
      const {runRenovateDispatchCli, runRenovatePlanCli} = await import('./dispatch-renovate.ts')
      const run = mode === 'plan' ? runRenovatePlanCli : runRenovateDispatchCli
      for (const token of [undefined, '']) {
        await expect(
          run({GITHUB_TOKEN: token, GITHUB_OUTPUT: outputPath, DISPATCH_REPOSITORIES: 'agent'}, {createOctokit}),
        ).rejects.toThrow('GITHUB_TOKEN is required')
      }
      expect(createOctokit).not.toHaveBeenCalled()
    },
  )

  it.each([[undefined], ['']])('plan mode fails without GITHUB_OUTPUT (%j) and makes no API call', async output => {
    const {runRenovatePlanCli} = await import('./dispatch-renovate.ts')
    await expect(
      runRenovatePlanCli(
        {GITHUB_TOKEN: 'discovery-token', GITHUB_OUTPUT: output},
        {createOctokit, renovatePath, registryPath},
      ),
    ).rejects.toThrow('GITHUB_OUTPUT is required in plan mode')
    expect(mocks.paginate).not.toHaveBeenCalled()
  })

  it.each([[undefined], [''], ['   '], [' , ,']])(
    'dispatch mode fails when DISPATCH_REPOSITORIES is %j and dispatches nothing',
    async repositories => {
      const {runRenovateDispatchCli} = await import('./dispatch-renovate.ts')
      await expect(
        runRenovateDispatchCli(
          {GITHUB_TOKEN: 'dispatch-token', DISPATCH_REPOSITORIES: repositories},
          {createOctokit, stdout},
        ),
      ).rejects.toThrow('DISPATCH_REPOSITORIES is required and must name at least one repository')
      expect(mocks.listWorkflowRuns).not.toHaveBeenCalled()
      expect(mocks.createWorkflowDispatch).not.toHaveBeenCalled()
      expect(out).toEqual([])
    },
  )
})

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
    expect(plan?.run?.trim()).toBe('bun scripts/dispatch-renovate.ts plan')
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

  it("restores data's registry before planning, failing the step when the data branch is absent or unreadable", async () => {
    const steps = await loadWorkflowSteps()
    const sync = steps.find(step => step.uses === './.github/actions/sync-data')
    const syncIndex = steps.indexOf(sync as ContractStep)
    const checkoutIndex = steps.findIndex(step => step.uses?.startsWith('actions/checkout@'))
    const planIndex = steps.findIndex(step => step.id === 'plan')

    expect(sync?.with).toStrictEqual({paths: 'metadata/repos.yaml', 'if-absent': 'fail'})
    expect(syncIndex).toBeGreaterThan(checkoutIndex)
    expect(syncIndex).toBeLessThan(planIndex)
    expect(JSON.stringify(sync)).not.toContain('token')
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
    // Exact: `plan` here would make the dispatch step re-plan with the dispatch token instead of dispatching.
    expect(dispatch?.run?.trim()).toBe('bun scripts/dispatch-renovate.ts')
  })
})
