import {beforeEach, describe, expect, it, vi} from 'vitest'

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
  }
  return {
    mocks,
    mockOctokit: {
      rest: {
        actions: {
          listWorkflowRuns: mocks.listWorkflowRuns,
          createWorkflowDispatch: mocks.createWorkflowDispatch,
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
