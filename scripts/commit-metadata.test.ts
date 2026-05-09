import type {OctokitClient} from './commit-metadata.ts'
import {Buffer} from 'node:buffer'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {stringify} from 'yaml'
import {commitMetadata, CommitMetadataError, deepEquals} from './commit-metadata.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encode(value: unknown): string {
  const yaml = stringify(value, {indent: 2, lineWidth: 0})
  const text = yaml.endsWith('\n') ? yaml : `${yaml}\n`
  return Buffer.from(text, 'utf8').toString('base64')
}

interface MockOverrides {
  getBranch?: (params: {owner: string; repo: string; branch: string}) => Promise<unknown>
  getContent?: (params: {owner: string; repo: string; ref: string; path: string}) => Promise<unknown>
  createOrUpdateFileContents?: (params: {
    owner: string
    repo: string
    branch: string
    path: string
    message: string
    sha: string
    content: string
  }) => Promise<unknown>
}

// Tests construct a minimal shape and cast to OctokitClient (the real @octokit/rest
// type is massive and includes internals like `endpoint`/`defaults` we never exercise).
// Production call sites still enforce SDK method-name and nullability correctness —
// the cast here only relaxes what test mocks must implement, not what prod code sees.
function mockOctokit(overrides?: MockOverrides): OctokitClient {
  return {
    rest: {
      repos: {
        getBranch:
          overrides?.getBranch ??
          (async ({branch}: {branch: string}) => ({
            data: {name: branch, protected: false, protection: {enabled: false}, commit: {sha: `${branch}-sha`}},
          })),
        getContent:
          overrides?.getContent ??
          (async () => ({
            data: {type: 'file' as const, sha: 'abc123', content: encode({version: 1}), encoding: 'base64'},
          })),
        createOrUpdateFileContents:
          overrides?.createOrUpdateFileContents ?? (async () => ({data: {commit: {sha: 'new-sha-456'}}})),
      },
    },
  } as unknown as OctokitClient
}

// ---------------------------------------------------------------------------
// deepEquals
// ---------------------------------------------------------------------------

describe('deepEquals', () => {
  it('returns true for identical primitives', () => {
    expect(deepEquals(1, 1)).toBe(true)
    expect(deepEquals('hello', 'hello')).toBe(true)
    expect(deepEquals(null, null)).toBe(true)
    expect(deepEquals(undefined, undefined)).toBe(true)
    expect(deepEquals(true, true)).toBe(true)
  })

  it('returns false for differing primitives', () => {
    expect(deepEquals(1, 2)).toBe(false)
    expect(deepEquals('a', 'b')).toBe(false)
    expect(deepEquals(true, false)).toBe(false)
    expect(deepEquals(null, undefined)).toBe(false)
  })

  it('handles NaN via Object.is', () => {
    expect(deepEquals(Number.NaN, Number.NaN)).toBe(true)
  })

  it('compares flat objects', () => {
    expect(deepEquals({a: 1, b: 2}, {a: 1, b: 2})).toBe(true)
    expect(deepEquals({a: 1, b: 2}, {a: 1, b: 3})).toBe(false)
  })

  it('compares nested objects', () => {
    expect(deepEquals({a: {b: {c: 1}}}, {a: {b: {c: 1}}})).toBe(true)
    expect(deepEquals({a: {b: {c: 1}}}, {a: {b: {c: 2}}})).toBe(false)
  })

  it('compares arrays', () => {
    expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(deepEquals([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEquals([1, 2, 3], [1, 3, 2])).toBe(false)
  })

  it('compares arrays of objects', () => {
    expect(deepEquals([{a: 1}], [{a: 1}])).toBe(true)
    expect(deepEquals([{a: 1}], [{a: 2}])).toBe(false)
  })

  it('distinguishes arrays from objects', () => {
    expect(deepEquals([1, 2], {0: 1, 1: 2})).toBe(false)
  })

  it('distinguishes objects with different keys but same length', () => {
    expect(deepEquals({a: undefined}, {b: undefined})).toBe(false)
  })

  it('handles circular references without stack overflow', () => {
    const a: Record<string, unknown> = {x: 1}
    a.self = a
    const b: Record<string, unknown> = {x: 1}
    b.self = b
    expect(deepEquals(a, b)).toBe(true)
  })

  it('detects mismatched circular structures', () => {
    const a: Record<string, unknown> = {x: 1}
    a.self = a
    const b: Record<string, unknown> = {x: 2}
    b.self = b
    expect(deepEquals(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// commitMetadata — synchronous guards
// ---------------------------------------------------------------------------

describe('commitMetadata guards', () => {
  it('rejects invalid paths (INVALID_PATH)', async () => {
    const error = await commitMetadata({path: 'not-metadata/foo.yaml', message: 'test', mutator: x => x}).catch(
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('INVALID_PATH')
    expect((error as CommitMetadataError).remediation).toContain('metadata/')
  })

  it('rejects paths with traversal characters', async () => {
    await expect(commitMetadata({path: 'metadata/../secrets.yaml', message: 'test', mutator: x => x})).rejects.toThrow(
      CommitMetadataError,
    )
  })

  it('rejects non-yaml paths in metadata/', async () => {
    await expect(commitMetadata({path: 'metadata/config.json', message: 'test', mutator: x => x})).rejects.toThrow(
      CommitMetadataError,
    )
  })

  it('rejects maxRetries < 1 (INVALID_RETRIES)', async () => {
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      maxRetries: 0,
      message: 'test',
      mutator: x => x,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('INVALID_RETRIES')
  })

  it('rejects non-data branches without allowUnsafeBranch (UNSAFE_BRANCH)', async () => {
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      branch: 'random-branch',
      message: 'test',
      mutator: x => x,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('UNSAFE_BRANCH')
    expect((error as CommitMetadataError).remediation).toContain('allowUnsafeBranch')
  })

  it('allows non-data branches with allowUnsafeBranch: true', async () => {
    const octokit = mockOctokit()
    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      branch: 'test-branch',
      allowUnsafeBranch: true,
      message: 'test',
      mutator: x => x,
      octokit,
    })
    expect(result.committed).toBe(false) // no-op since mutator returns same
  })

  it('rejects missing GITHUB_TOKEN when no octokit provided (MISSING_TOKEN)', async () => {
    const original = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN

    try {
      const error = await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'test',
        mutator: x => x,
      }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('MISSING_TOKEN')
    } finally {
      if (original !== undefined) {
        process.env.GITHUB_TOKEN = original
      }
    }
  })
})

// ---------------------------------------------------------------------------
// commitMetadata — API interactions (mock Octokit)
// ---------------------------------------------------------------------------

describe('commitMetadata API', () => {
  it('refuses to write to main branch (PROTECTED_BRANCH)', async () => {
    const octokit = mockOctokit()
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      branch: 'main',
      allowUnsafeBranch: true,
      message: 'test',
      mutator: x => x,
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('PROTECTED_BRANCH')
  })

  it('refuses protected: true branches (PROTECTED_BRANCH)', async () => {
    const octokit = mockOctokit({
      getBranch: async () => ({data: {name: 'data', protected: true, commit: {sha: 'data-sha'}}}),
    })
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'test',
      mutator: x => x,
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('PROTECTED_BRANCH')
  })

  it('refuses protection.enabled branches (PROTECTED_BRANCH)', async () => {
    const octokit = mockOctokit({
      getBranch: async () => ({
        data: {name: 'data', protected: false, protection: {enabled: true}, commit: {sha: 'data-sha'}},
      }),
    })
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'test',
      mutator: x => x,
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('PROTECTED_BRANCH')
  })

  it('throws MISSING_FILE on 404 with init remediation', async () => {
    const octokit = mockOctokit({
      getContent: async () => {
        throw Object.assign(new Error('Not Found'), {status: 404})
      },
    })
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'test',
      mutator: x => x,
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('MISSING_FILE')
    expect((error as CommitMetadataError).remediation).toContain('Initialize')
  })

  it('throws INVALID_FILE when getContent returns a directory listing', async () => {
    const octokit = mockOctokit({
      getContent: async () => ({data: [{name: 'file1.yaml'}, {name: 'file2.yaml'}]}),
    })
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'test',
      mutator: x => x,
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('INVALID_FILE')
  })

  it('throws INVALID_FILE when content is not base64-encoded', async () => {
    const octokit = mockOctokit({
      getContent: async () => ({
        data: {type: 'file' as const, sha: 'abc', content: undefined, encoding: 'none'},
      }),
    })
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'test',
      mutator: x => x,
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('INVALID_FILE')
    expect((error as CommitMetadataError).remediation).toContain('base64')
  })

  it('returns committed: false when content is unchanged', async () => {
    const octokit = mockOctokit()
    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'noop',
      mutator: current => current, // return same value
      octokit,
    })
    expect(result.committed).toBe(false)
    expect(result.attempts).toBe(1)
  })

  it('detects in-place mutation returning same reference as unchanged', async () => {
    const octokit = mockOctokit()
    // Even though we "mutate" in place, the serialized form stays the same
    // because the mutation is a no-op (setting version to its existing value)
    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'noop via in-place',
      mutator: current => {
        // In-place mutation that produces identical serialized output
        if (typeof current === 'object' && current !== null) {
          ;(current as Record<string, unknown>).version = 1
        }
        return current
      },
      octokit,
    })
    expect(result.committed).toBe(false)
  })

  it('commits when mutator produces different content', async () => {
    const createSpy = vi.fn(async () => ({data: {commit: {sha: 'commit-sha-789'}}}))
    const octokit = mockOctokit({createOrUpdateFileContents: createSpy})

    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'update version',
      mutator: () => ({version: 2}), // different from mock's {version: 1}
      octokit,
    })

    expect(result.committed).toBe(true)
    expect(result.sha).toBe('commit-sha-789')
    expect(result.attempts).toBe(1)
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it('bootstraps the data branch before reading metadata', async () => {
    const calls: string[] = []
    const createSpy = vi.fn(async () => ({data: {commit: {sha: 'commit-sha-789'}}}))
    const bootstrapDataBranch = vi.fn(async () => {
      calls.push('bootstrap')
      return {created: false, ref: 'refs/heads/data', sha: 'data-sha'}
    })
    const octokit = mockOctokit({
      getBranch: async ({branch}: {branch: string}) => {
        calls.push(`getBranch:${branch}`)
        return {data: {name: branch, protected: false, protection: {enabled: false}}}
      },
      getContent: async () => {
        calls.push('getContent')
        return {data: {type: 'file' as const, sha: 'abc123', content: encode({version: 1}), encoding: 'base64'}}
      },
      createOrUpdateFileContents: createSpy,
    })

    await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'update version',
      mutator: () => ({version: 2}),
      octokit,
      bootstrapDataBranch,
    })

    expect(bootstrapDataBranch).toHaveBeenCalledWith({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      dataBranch: 'data',
    })
    expect(calls).toEqual(['bootstrap', 'getBranch:data', 'getContent'])
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it('does not bootstrap when writing to an explicitly allowed non-data branch', async () => {
    const bootstrapDataBranch = vi.fn(async () => {
      throw new Error('bootstrap should not run')
    })
    const createSpy = vi.fn(async () => ({data: {commit: {sha: 'commit-sha-789'}}}))
    const octokit = mockOctokit({createOrUpdateFileContents: createSpy})

    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      branch: 'test-branch',
      allowUnsafeBranch: true,
      message: 'update version',
      mutator: () => ({version: 2}),
      octokit,
      bootstrapDataBranch,
    })

    expect(result.committed).toBe(true)
    expect(bootstrapDataBranch).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it('rebootstraps and retries when data disappears after the initial bootstrap', async () => {
    const calls: string[] = []
    const bootstrapDataBranch = vi.fn(async () => {
      calls.push('bootstrap')
      return {created: false, ref: 'refs/heads/data', sha: 'data-sha'}
    })
    const createSpy = vi.fn(async () => ({data: {commit: {sha: 'commit-sha-789'}}}))
    const octokit = mockOctokit({
      getBranch: vi
        .fn<NonNullable<MockOverrides['getBranch']>>()
        .mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))
        .mockResolvedValue({
          data: {name: 'data', protected: false, protection: {enabled: false}, commit: {sha: 'data-sha'}},
        }),
      createOrUpdateFileContents: createSpy,
    })

    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'update version',
      maxRetries: 2,
      mutator: () => ({version: 2}),
      octokit,
      bootstrapDataBranch,
    })

    expect(result.committed).toBe(true)
    expect(bootstrapDataBranch).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['bootstrap', 'bootstrap'])
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it('rebootstraps and retries when data disappears before reading metadata content', async () => {
    const calls: string[] = []
    const bootstrapDataBranch = vi.fn(async () => {
      calls.push('bootstrap')
      return {created: false, ref: 'refs/heads/data', sha: 'data-sha'}
    })
    const createSpy = vi.fn(async () => ({data: {commit: {sha: 'commit-sha-789'}}}))
    const getBranch = vi
      .fn<NonNullable<MockOverrides['getBranch']>>()
      .mockResolvedValueOnce({
        data: {name: 'data', protected: false, protection: {enabled: false}, commit: {sha: 'data-sha'}},
      })
      .mockResolvedValue({
        data: {name: 'data', protected: false, protection: {enabled: false}, commit: {sha: 'data-sha'}},
      })
    const getContent = vi
      .fn<NonNullable<MockOverrides['getContent']>>()
      .mockRejectedValueOnce(Object.assign(new Error('Not Found'), {status: 404}))
      .mockResolvedValue({
        data: {type: 'file' as const, sha: 'abc123', content: encode({version: 1}), encoding: 'base64'},
      })
    const octokit = mockOctokit({
      getBranch,
      getContent,
      createOrUpdateFileContents: createSpy,
    })

    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'update version',
      maxRetries: 2,
      mutator: () => ({version: 2}),
      octokit,
      bootstrapDataBranch,
    })

    expect(result.committed).toBe(true)
    expect(bootstrapDataBranch).toHaveBeenCalledTimes(2)
    expect(getBranch).toHaveBeenCalledTimes(2)
    expect(getContent).toHaveBeenCalledTimes(2)
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it('stops before metadata reads and writes when bootstrap fails', async () => {
    const bootstrapDataBranch = vi.fn(async () => {
      throw new Error('bootstrap failed')
    })
    const getBranch = vi.fn<NonNullable<MockOverrides['getBranch']>>()
    const getContent = vi.fn<NonNullable<MockOverrides['getContent']>>()
    const createSpy = vi.fn<NonNullable<MockOverrides['createOrUpdateFileContents']>>()
    const octokit = mockOctokit({getBranch, getContent, createOrUpdateFileContents: createSpy})

    await expect(
      commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'update version',
        mutator: () => ({version: 2}),
        octokit,
        bootstrapDataBranch,
      }),
    ).rejects.toThrow('bootstrap failed')

    expect(getBranch).not.toHaveBeenCalled()
    expect(getContent).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('serializes redacted metadata values in Prettier-compatible single quotes', async () => {
    let serialized = ''
    const createSpy = vi.fn<NonNullable<MockOverrides['createOrUpdateFileContents']>>(async params => {
      serialized = Buffer.from(params.content, 'base64').toString('utf8')
      return {data: {commit: {sha: 'commit-sha-789'}}}
    })
    const octokit = mockOctokit({createOrUpdateFileContents: createSpy})

    await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'redacted formatting',
      mutator: () => ({repos: [{owner: '[REDACTED]', name: 'R_private', private: true}]}),
      octokit,
    })

    expect(createSpy).toHaveBeenCalledOnce()
    expect(serialized).toContain("owner: '[REDACTED]'")
    expect(serialized).not.toContain('owner: "[REDACTED]"')
  })

  it('commits Prettier-compatible normalization when parsed metadata is unchanged', async () => {
    let serialized = ''
    const createSpy = vi.fn<NonNullable<MockOverrides['createOrUpdateFileContents']>>(async params => {
      serialized = Buffer.from(params.content, 'base64').toString('utf8')
      return {data: {commit: {sha: 'commit-sha-789'}}}
    })
    const octokit = mockOctokit({
      getContent: async () => ({
        data: {
          type: 'file' as const,
          sha: 'abc123',
          content: Buffer.from('repos:\n  - owner: "[REDACTED]"\n    name: R_private\n    private: true\n').toString(
            'base64',
          ),
          encoding: 'base64',
        },
      }),
      createOrUpdateFileContents: createSpy,
    })

    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'redacted formatting',
      mutator: current => current,
      octokit,
    })

    expect(result.committed).toBe(true)
    expect(createSpy).toHaveBeenCalledOnce()
    expect(serialized).toContain("owner: '[REDACTED]'")
    expect(serialized).not.toContain('owner: "[REDACTED]"')
  })

  it('retries on 409 conflict then succeeds', async () => {
    let callCount = 0
    const createSpy = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        const err = Object.assign(new Error('Conflict'), {status: 409})
        throw err
      }
      return {data: {commit: {sha: 'retry-sha'}}}
    })
    const octokit = mockOctokit({createOrUpdateFileContents: createSpy})

    const result = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'retry test',
      mutator: () => ({version: 99}),
      octokit,
    })

    expect(result.committed).toBe(true)
    expect(result.sha).toBe('retry-sha')
    expect(result.attempts).toBe(2)
  })

  it('throws CONFLICT_EXHAUSTED after maxRetries 409s', async () => {
    const octokit = mockOctokit({
      createOrUpdateFileContents: async () => {
        throw Object.assign(new Error('Conflict'), {status: 409})
      },
    })
    const error = await commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'conflict test',
      maxRetries: 2,
      mutator: () => ({version: 999}),
      octokit,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommitMetadataError)
    expect((error as CommitMetadataError).code).toBe('CONFLICT_EXHAUSTED')
    expect((error as CommitMetadataError).remediation).toContain('maxRetries')
  })

  it('propagates non-conflict API errors directly', async () => {
    const octokit = mockOctokit({
      createOrUpdateFileContents: async () => {
        throw Object.assign(new Error('Internal Server Error'), {status: 500})
      },
    })

    await expect(
      commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'error test',
        mutator: () => ({version: 2}),
        octokit,
      }),
    ).rejects.toThrow('Internal Server Error')
  })
})
