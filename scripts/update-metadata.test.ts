import type {OctokitClient} from './update-metadata.ts'

import {beforeEach, describe, expect, it, vi} from 'vitest'

// BDD: buildRenovateFile
// Given: a list of detected repo names
// When: buildRenovateFile is called
// Then: returns a RenovateFile with names sorted and deduplicated

// BDD: discoverRenovateRepos
// Given: an Octokit client and a target owner
// When: discoverRenovateRepos is called
// Then: lists installation-accessible repos, filters to owner (excluding archived
//       and forks), probes each for .github/workflows/renovate.yaml, returns
//       matching names in discovery order

const {mocks, mockOctokit} = vi.hoisted(() => {
  const mocks = {
    listReposAccessibleToInstallation: vi.fn(),
    getContent: vi.fn(),
    paginate: vi.fn(),
  }
  return {
    mocks,
    mockOctokit: {
      paginate: mocks.paginate,
      rest: {
        apps: {
          listReposAccessibleToInstallation: mocks.listReposAccessibleToInstallation,
        },
        repos: {
          getContent: mocks.getContent,
        },
      },
    } as unknown as OctokitClient,
  }
})

// Test fixture builder so each repo carries the realistic owner/archived/fork shape
// returned by `apps.listReposAccessibleToInstallation`.
function repo(name: string, opts?: {owner?: string; archived?: boolean; fork?: boolean}) {
  return {
    name,
    archived: opts?.archived ?? false,
    fork: opts?.fork ?? false,
    owner: {login: opts?.owner ?? 'fro-bot'},
  }
}

describe('buildRenovateFile', () => {
  it('wraps names in the renovate.yaml schema shape', async () => {
    // #given a list of repo names
    // #when buildRenovateFile is called
    // #then it returns the canonical {repositories: {with-renovate: ...}} shape
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile(['agent', '.github'])
    expect(result).toEqual({repositories: {'with-renovate': ['.github', 'agent']}})
  })

  it('sorts names alphabetically using locale order', async () => {
    // #given an unsorted list
    // #when buildRenovateFile is called
    // #then the output is alphabetically sorted via localeCompare
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile(['tokentoilet', 'agent', '.github'])
    expect(result.repositories['with-renovate']).toEqual(['.github', 'agent', 'tokentoilet'])
  })

  it('deduplicates duplicate repo names', async () => {
    // #given a list with duplicates
    // #when buildRenovateFile is called
    // #then the duplicates are collapsed to a single entry
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile(['agent', 'agent', '.github'])
    expect(result.repositories['with-renovate']).toEqual(['.github', 'agent'])
  })

  it('returns empty list shape for empty input', async () => {
    // #given an empty input list
    // #when buildRenovateFile is called
    // #then the schema is preserved with an empty array
    const {buildRenovateFile} = await import('./update-metadata.ts')
    const result = buildRenovateFile([])
    expect(result).toEqual({repositories: {'with-renovate': []}})
  })
})

describe('discoverRenovateRepos', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns repos containing .github/workflows/renovate.yaml in discovery order', async () => {
    // #given the installation lists three fro-bot repos and two have a Renovate workflow
    // #when discoverRenovateRepos is called for fro-bot
    // #then it returns matching names in pagination order (sort happens in buildRenovateFile)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('agent'), repo('.github'), repo('tokentoilet')])
    // probe order matches input order; resolve = present, reject 404 = absent
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent', '.github'])
  })

  it('calls paginate against listReposAccessibleToInstallation with per_page=100', async () => {
    // #given a target owner
    // #when discoverRenovateRepos is called
    // #then paginate uses the App installation listing endpoint (works for users and orgs)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([])

    await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(mocks.paginate).toHaveBeenCalledTimes(1)
    expect(mocks.paginate).toHaveBeenCalledWith(mocks.listReposAccessibleToInstallation, {per_page: 100})
  })

  it('filters out repos owned by accounts other than the target owner', async () => {
    // #given the installation lists repos under multiple owners
    // #when discoverRenovateRepos is called for fro-bot
    // #then repos owned by anyone other than fro-bot are skipped (no probe call)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([
      repo('agent', {owner: 'fro-bot'}),
      repo('config', {owner: 'marcusrbrown'}),
      repo('.github', {owner: 'fro-bot'}),
    ])
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent', '.github'])
    expect(mocks.getContent).toHaveBeenCalledTimes(2)
    expect(mocks.getContent).not.toHaveBeenCalledWith(expect.objectContaining({repo: 'config'}))
  })

  it('skips archived repos (no probe call for them)', async () => {
    // #given an archived repo in the listing
    // #when discoverRenovateRepos is called
    // #then no probe is issued for the archived repo and it is excluded from output
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('archived-repo', {archived: true}), repo('agent')])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent'])
    expect(mocks.getContent).toHaveBeenCalledTimes(1)
    expect(mocks.getContent).toHaveBeenCalledWith(expect.objectContaining({repo: 'agent'}))
  })

  it('skips forks (no probe call for them)', async () => {
    // #given a forked repo in the listing
    // #when discoverRenovateRepos is called
    // #then no probe is issued for the fork and it is excluded from output
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('forked-repo', {fork: true}), repo('agent')])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent'])
    expect(mocks.getContent).toHaveBeenCalledTimes(1)
  })

  it('treats 404 from probe as missing-config (not an error)', async () => {
    // #given a repo whose probe returns 404
    // #when discoverRenovateRepos is called
    // #then the repo is omitted from the result without throwing
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('no-renovate')])
    mocks.getContent.mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual([])
  })

  it('rethrows non-404 errors with repo context so the offending repo is identifiable', async () => {
    // #given a repo whose probe returns 500
    // #when discoverRenovateRepos is called
    // #then the error wraps the original with owner/repo and status context, and exposes the original via cause
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('broken-repo')])
    const original = Object.assign(new Error('Server Error'), {status: 500})
    mocks.getContent.mockRejectedValueOnce(original)

    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toThrow(/fro-bot\/broken-repo.*status=500/)
    // Re-run to inspect the cause chain (the previous expect consumed the rejection).
    mocks.paginate.mockResolvedValueOnce([repo('broken-repo')])
    mocks.getContent.mockRejectedValueOnce(original)
    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toMatchObject({cause: original})
  })

  it('propagates paginate rejections without probing any repos', async () => {
    // #given the installation listing call itself fails
    // #when discoverRenovateRepos is called
    // #then the error propagates and no per-repo probes happen
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API down'))

    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toThrow('API down')
    expect(mocks.getContent).not.toHaveBeenCalled()
  })

  it('returns an empty array when the installation has no repos', async () => {
    // #given an empty installation listing
    // #when discoverRenovateRepos is called
    // #then it returns []
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([])

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual([])
    expect(mocks.getContent).not.toHaveBeenCalled()
  })

  it('probes the canonical workflow path (.github/workflows/renovate.yaml)', async () => {
    // #given a single repo
    // #when discoverRenovateRepos is called
    // #then it probes exactly the canonical path under the correct owner/repo
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([repo('agent')])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(mocks.getContent).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: 'agent',
      path: '.github/workflows/renovate.yaml',
    })
  })
})
