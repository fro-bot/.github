import type {OctokitClient} from './commit-metadata.js'
import {Buffer} from 'node:buffer'
import process from 'node:process'
import {describe, expect, it, vi} from 'vitest'
import {stringify} from 'yaml'
import {commitMetadata, CommitMetadataError, deepEquals} from './commit-metadata.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encode(value: unknown): string {
  const yaml = stringify(value, {indent: 2, lineWidth: 0})
  const text = yaml.endsWith('\n') ? yaml : `${yaml}\n`
  return Buffer.from(text, 'utf8').toString('base64')
}

function mockOctokit(overrides?: {
  getBranch?: OctokitClient['rest']['repos']['getBranch']
  getContent?: OctokitClient['rest']['repos']['getContent']
  createOrUpdateFileContents?: OctokitClient['rest']['repos']['createOrUpdateFileContents']
}): OctokitClient {
  return {
    rest: {
      repos: {
        getBranch:
          overrides?.getBranch ??
          (async () => ({data: {name: 'data', protected: false, protection: {enabled: false}}})),
        getContent:
          overrides?.getContent ??
          (async () => ({
            data: {type: 'file' as const, sha: 'abc123', content: encode({version: 1}), encoding: 'base64'},
          })),
        createOrUpdateFileContents:
          overrides?.createOrUpdateFileContents ?? (async () => ({data: {commit: {sha: 'new-sha-456'}}})),
      },
    },
  }
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
    await expect(commitMetadata({path: 'not-metadata/foo.yaml', message: 'test', mutator: x => x})).rejects.toThrow(
      CommitMetadataError,
    )

    try {
      await commitMetadata({path: 'not-metadata/foo.yaml', message: 'test', mutator: x => x})
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('INVALID_PATH')
      expect((error as CommitMetadataError).remediation).toContain('metadata/')
    }
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
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        maxRetries: 0,
        message: 'test',
        mutator: x => x,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('INVALID_RETRIES')
    }
  })

  it('rejects non-data branches without allowUnsafeBranch (UNSAFE_BRANCH)', async () => {
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        branch: 'random-branch',
        message: 'test',
        mutator: x => x,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('UNSAFE_BRANCH')
      expect((error as CommitMetadataError).remediation).toContain('allowUnsafeBranch')
    }
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
      await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'test',
        mutator: x => x,
      })
    } catch (error) {
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
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        branch: 'main',
        allowUnsafeBranch: true,
        message: 'test',
        mutator: x => x,
        octokit,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('PROTECTED_BRANCH')
    }
  })

  it('refuses protected: true branches (PROTECTED_BRANCH)', async () => {
    const octokit = mockOctokit({
      getBranch: async () => ({data: {name: 'data', protected: true}}),
    })
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'test',
        mutator: x => x,
        octokit,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('PROTECTED_BRANCH')
    }
  })

  it('refuses protection.enabled branches (PROTECTED_BRANCH)', async () => {
    const octokit = mockOctokit({
      getBranch: async () => ({data: {name: 'data', protected: false, protection: {enabled: true}}}),
    })
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'test',
        mutator: x => x,
        octokit,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('PROTECTED_BRANCH')
    }
  })

  it('throws MISSING_FILE on 404 with init remediation', async () => {
    const octokit = mockOctokit({
      getContent: async () => {
        const err = Object.assign(new Error('Not Found'), {status: 404})
        throw err
      },
    })
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'test',
        mutator: x => x,
        octokit,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('MISSING_FILE')
      expect((error as CommitMetadataError).remediation).toContain('Initialize')
    }
  })

  it('throws INVALID_FILE when getContent returns a directory listing', async () => {
    const octokit = mockOctokit({
      getContent: async () => ({data: [{name: 'file1.yaml'}, {name: 'file2.yaml'}]}),
    })
    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'test',
        mutator: x => x,
        octokit,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('INVALID_FILE')
    }
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

    try {
      await commitMetadata({
        path: 'metadata/repos.yaml',
        message: 'conflict test',
        maxRetries: 2,
        mutator: () => ({version: 999}),
        octokit,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CommitMetadataError)
      expect((error as CommitMetadataError).code).toBe('CONFLICT_EXHAUSTED')
      expect((error as CommitMetadataError).remediation).toContain('maxRetries')
    }
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
