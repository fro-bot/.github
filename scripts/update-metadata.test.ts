import type {OctokitClient} from './update-metadata.ts'

import {beforeEach, describe, expect, it, vi} from 'vitest'

// BDD: buildRenovateFile
// Given: a list of detected repo names
// When: buildRenovateFile is called
// Then: returns a RenovateFile with names sorted and deduplicated

// BDD: discoverRenovateRepos
// Given: an Octokit client and a target org
// When: discoverRenovateRepos is called
// Then: lists org repos (excluding archived and forks), probes each for
//       .github/workflows/renovate.yaml, returns matching names in discovery order

const {mocks, mockOctokit} = vi.hoisted(() => {
  const mocks = {
    listForOrg: vi.fn(),
    getContent: vi.fn(),
    paginate: vi.fn(),
  }
  return {
    mocks,
    mockOctokit: {
      paginate: mocks.paginate,
      rest: {
        repos: {
          listForOrg: mocks.listForOrg,
          getContent: mocks.getContent,
        },
      },
    } as unknown as OctokitClient,
  }
})

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
    // #given an org with three repos and two of them have a Renovate workflow
    // #when discoverRenovateRepos is called
    // #then it returns matching names in the order paginate yielded them (sort happens in buildRenovateFile)
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'agent', archived: false, fork: false},
      {name: '.github', archived: false, fork: false},
      {name: 'tokentoilet', archived: false, fork: false},
    ])
    // probe order matches input order; resolve = present (200), reject 404 = absent
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockResolvedValueOnce({status: 200})
    mocks.getContent.mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent', '.github'])
  })

  it('calls paginate with listForOrg and the correct org/type/per_page options', async () => {
    // #given a target org
    // #when discoverRenovateRepos is called
    // #then paginate receives the listForOrg method plus org/type/per_page=100 so private+public+forks are enumerated
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([])

    await discoverRenovateRepos(mockOctokit, 'other-org')
    expect(mocks.paginate).toHaveBeenCalledTimes(1)
    expect(mocks.paginate).toHaveBeenCalledWith(mocks.listForOrg, {
      org: 'other-org',
      type: 'all',
      per_page: 100,
    })
  })

  it('skips archived repos (no probe call for them)', async () => {
    // #given an archived repo in the org listing
    // #when discoverRenovateRepos is called
    // #then no probe is issued for the archived repo and it is excluded from output
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'archived-repo', archived: true, fork: false},
      {name: 'agent', archived: false, fork: false},
    ])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual(['agent'])
    expect(mocks.getContent).toHaveBeenCalledTimes(1)
    expect(mocks.getContent).toHaveBeenCalledWith(expect.objectContaining({repo: 'agent'}))
  })

  it('skips forks (no probe call for them)', async () => {
    // #given a forked repo in the org listing
    // #when discoverRenovateRepos is called
    // #then no probe is issued for the fork and it is excluded from output
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([
      {name: 'forked-repo', archived: false, fork: true},
      {name: 'agent', archived: false, fork: false},
    ])
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
    mocks.paginate.mockResolvedValueOnce([{name: 'no-renovate', archived: false, fork: false}])
    mocks.getContent.mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))

    const result = await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(result).toEqual([])
  })

  it('rethrows non-404 errors with repo context so the offending repo is identifiable', async () => {
    // #given a repo whose probe returns 500
    // #when discoverRenovateRepos is called
    // #then the error wraps the original with org/repo and status context, and exposes the original via cause
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockResolvedValueOnce([{name: 'broken-repo', archived: false, fork: false}])
    const original = Object.assign(new Error('Server Error'), {status: 500})
    mocks.getContent.mockRejectedValueOnce(original)

    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toThrow(/fro-bot\/broken-repo.*status=500/)
    // Re-run to inspect the cause chain (the previous expect consumed the rejection).
    mocks.paginate.mockResolvedValueOnce([{name: 'broken-repo', archived: false, fork: false}])
    mocks.getContent.mockRejectedValueOnce(original)
    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toMatchObject({cause: original})
  })

  it('propagates paginate rejections without probing any repos', async () => {
    // #given the org listing call itself fails
    // #when discoverRenovateRepos is called
    // #then the error propagates and no per-repo probes happen
    const {discoverRenovateRepos} = await import('./update-metadata.ts')
    mocks.paginate.mockRejectedValueOnce(new Error('API down'))

    await expect(discoverRenovateRepos(mockOctokit, 'fro-bot')).rejects.toThrow('API down')
    expect(mocks.getContent).not.toHaveBeenCalled()
  })

  it('returns an empty array when org has no repos', async () => {
    // #given an empty org listing
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
    mocks.paginate.mockResolvedValueOnce([{name: 'agent', archived: false, fork: false}])
    mocks.getContent.mockResolvedValueOnce({status: 200})

    await discoverRenovateRepos(mockOctokit, 'fro-bot')
    expect(mocks.getContent).toHaveBeenCalledWith({
      owner: 'fro-bot',
      repo: 'agent',
      path: '.github/workflows/renovate.yaml',
    })
  })
})
