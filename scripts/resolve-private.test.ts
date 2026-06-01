import type {NodeIdResolver, ResolvedEntry} from './resolve-private.ts'
import type {ReposFile} from './schemas.ts'
import {describe, expect, it, vi} from 'vitest'
import {requireToken, resolvePrivateEntries} from './resolve-private.ts'

// Hoisted mock for execFileSync — must precede any import that might trigger the module.
const {mockExecFileSync} = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

// Hoisted mock for fs/promises — ensures resolve-private never writes to disk.
const {mockWriteFile, mockAppendFile} = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
  mockAppendFile: vi.fn(),
}))

vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: mockWriteFile,
    appendFile: mockAppendFile,
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(entries: Partial<import('./schemas.ts').RepoEntry>[]): ReposFile {
  return {
    version: 1,
    repos: entries.map((e, i) => ({
      owner: e.owner ?? '[REDACTED]',
      name: e.name ?? `repo-${i}`,
      added: '2024-01-01',
      onboarding_status: 'onboarded',
      last_survey_at: null,
      last_survey_status: null,
      has_fro_bot_workflow: false,
      has_renovate: false,
      ...e,
    })),
  }
}

async function resolvedOk(nameWithOwner: string): ReturnType<NodeIdResolver> {
  return Promise.resolve({nameWithOwner})
}

async function resolvedAccessLost(): ReturnType<NodeIdResolver> {
  return Promise.resolve({error: 'access-lost'} as const)
}

async function resolvedError(): ReturnType<NodeIdResolver> {
  return Promise.resolve({error: 'error'} as const)
}

// ---------------------------------------------------------------------------
// resolvePrivateEntries
// ---------------------------------------------------------------------------

describe('resolvePrivateEntries', () => {
  it('mixed public/private file — returns only resolved private entries', async () => {
    // #given a file with one public entry and one private entry
    const file = makeFile([
      {owner: 'acme', name: 'public-repo', private: false, node_id: 'R_public'},
      {owner: '[REDACTED]', name: 'R_private1', private: true, node_id: 'R_private1'},
    ])

    const resolver: NodeIdResolver = async id => {
      if (id === 'R_private1') return resolvedOk('secret-org/secret-repo')
      return resolvedError()
    }

    // #when
    const results = await resolvePrivateEntries(file, resolver)

    // #then only the private entry is in the output
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual<ResolvedEntry>({
      node_id: 'R_private1',
      owner: 'secret-org',
      name: 'secret-repo',
      status: 'resolved',
    })
  })

  it('all public entries — returns empty array', async () => {
    // #given a file with no private entries
    const file = makeFile([
      {owner: 'acme', name: 'alpha', private: false, node_id: 'R_1'},
      {owner: 'acme', name: 'beta', private: false, node_id: 'R_2'},
    ])

    const resolver: NodeIdResolver = vi.fn().mockResolvedValue({error: 'error'} as const)

    // #when
    const results = await resolvePrivateEntries(file, resolver)

    // #then nothing to resolve
    expect(results).toHaveLength(0)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('node_id resolves to 404 (deleted repo) — returns access-lost status', async () => {
    // #given a private entry whose node resolves to access-lost
    const file = makeFile([{owner: '[REDACTED]', name: 'R_gone', private: true, node_id: 'R_gone'}])

    const resolver: NodeIdResolver = async () => resolvedAccessLost()

    // #when
    const results = await resolvePrivateEntries(file, resolver)

    // #then status is access-lost and node_id is present
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual<ResolvedEntry>({node_id: 'R_gone', status: 'access-lost'})
  })

  it('resolver returns error — entry has error status', async () => {
    // #given a private entry whose resolver throws a generic error
    const file = makeFile([{owner: '[REDACTED]', name: 'R_bad', private: true, node_id: 'R_bad'}])

    const resolver: NodeIdResolver = async () => resolvedError()

    // #when
    const results = await resolvePrivateEntries(file, resolver)

    // #then status is error
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual<ResolvedEntry>({node_id: 'R_bad', status: 'error'})
  })

  it('private entries without node_id are skipped gracefully', async () => {
    // #given a private entry with no node_id (pre-migration legacy)
    const file = makeFile([{owner: '[REDACTED]', name: 'no-id', private: true}])

    const resolver: NodeIdResolver = vi.fn().mockResolvedValue({error: 'error'} as const)

    // #when
    const results = await resolvePrivateEntries(file, resolver)

    // #then nothing to resolve (no node_id to look up)
    expect(results).toHaveLength(0)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('multiple private entries — resolves all', async () => {
    // #given multiple private entries
    const file = makeFile([
      {owner: '[REDACTED]', name: 'R_a', private: true, node_id: 'R_a'},
      {owner: '[REDACTED]', name: 'R_b', private: true, node_id: 'R_b'},
    ])

    const resolver: NodeIdResolver = async id => {
      if (id === 'R_a') return resolvedOk('org-a/repo-a')
      if (id === 'R_b') return resolvedOk('org-b/repo-b')
      return resolvedError()
    }

    // #when
    const results = await resolvePrivateEntries(file, resolver)

    // #then both are resolved
    expect(results).toHaveLength(2)
    expect(results).toEqual<ResolvedEntry[]>([
      {node_id: 'R_a', owner: 'org-a', name: 'repo-a', status: 'resolved'},
      {node_id: 'R_b', owner: 'org-b', name: 'repo-b', status: 'resolved'},
    ])
  })

  it('resolver never writes to the working tree (no fs write calls in resolve path)', async () => {
    // #given a normal private entry
    const file = makeFile([{owner: '[REDACTED]', name: 'R_x', private: true, node_id: 'R_x'}])

    const resolver: NodeIdResolver = async () => resolvedOk('org/repo')

    // #when
    await resolvePrivateEntries(file, resolver)

    // #then no file writes occurred
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockAppendFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// requireToken
// ---------------------------------------------------------------------------

describe('requireToken', () => {
  it('returns token string when GH_TOKEN is set', () => {
    // #given GH_TOKEN is present in env
    const token = requireToken({GH_TOKEN: 'ghp_abc123'})
    expect(token).toBe('ghp_abc123')
  })

  it('throws structured error when GH_TOKEN is absent', () => {
    // #given GH_TOKEN is not set
    expect(() => requireToken({})).toThrowError(/GH_TOKEN/)
  })

  it('throws structured error when GH_TOKEN is empty string', () => {
    // #given GH_TOKEN is an empty string
    expect(() => requireToken({GH_TOKEN: ''})).toThrowError(/GH_TOKEN/)
  })
})

// ---------------------------------------------------------------------------
// makeRealResolver (rate-limit / backoff behavior via mocked execFileSync)
// ---------------------------------------------------------------------------

describe('makeRealResolver', () => {
  it('parses a successful GraphQL response into nameWithOwner', async () => {
    // #given gh returns a successful node response
    const payload = JSON.stringify({data: {node: {nameWithOwner: 'owner/repo'}}})
    mockExecFileSync.mockReturnValueOnce(payload)

    const {makeRealResolver} = await import('./resolve-private.ts')
    const resolver = makeRealResolver('ghp_token')
    const result = await resolver('R_1')

    expect(result).toEqual({nameWithOwner: 'owner/repo'})
  })

  it('returns access-lost when node is null (repo deleted or no access)', async () => {
    // #given gh returns null node
    const payload = JSON.stringify({data: {node: null}})
    mockExecFileSync.mockReturnValueOnce(payload)

    const {makeRealResolver} = await import('./resolve-private.ts')
    const resolver = makeRealResolver('ghp_token')
    const result = await resolver('R_gone')

    expect(result).toEqual({error: 'access-lost'})
  })

  it('retries on rate-limit and eventually returns error when exhausted', async () => {
    // #given execFileSync always throws a rate-limit error
    mockExecFileSync.mockReset()
    mockExecFileSync.mockImplementation(() => {
      throw new Error('API rate limit exceeded')
    })

    const {makeRealResolver} = await import('./resolve-private.ts')
    // Use a resolver with very short delays for the test
    const resolver = makeRealResolver('ghp_token', {maxRetries: 2, baseDelayMs: 1})
    const result = await resolver('R_rate')

    // #then after exhausting retries, returns error
    expect(result).toEqual({error: 'error'})
    // #and retried (called more than once)
    expect(mockExecFileSync).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })
})
