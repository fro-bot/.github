import {Buffer} from 'node:buffer'
import {describe, expect, it, vi} from 'vitest'
import {
  checkPrivateLeakWithGitHub,
  createGitHubPrivateLeakAdapter,
  PrivateLeakAdapterError,
  type GitHubPrivateLeakClient,
} from './private-leak-adapter.ts'

const {octokitConstructor} = vi.hoisted(() => ({octokitConstructor: vi.fn()}))

vi.mock('@octokit/rest', () => ({Octokit: octokitConstructor}))

function encode(value: unknown): string {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8').toString('base64')
}

function metadataResponse(
  repos: readonly Record<string, unknown>[],
  sha = 'metadata-sha-1',
): {data: {type: 'file'; sha: string; content: string; encoding: 'base64'}} {
  return {
    data: {
      type: 'file',
      sha,
      content: encode({
        version: 1,
        repos: repos.map(repo => ({
          owner: 'redacted-owner',
          name: 'redacted-name',
          added: '2026-08-29',
          onboarding_status: 'onboarded',
          last_survey_at: null,
          last_survey_status: null,
          has_fro_bot_workflow: true,
          has_renovate: false,
          ...repo,
        })),
      }),
      encoding: 'base64',
    },
  }
}

function diffFor(text: string): string {
  return [
    'diff --git a/knowledge/wiki/topics/security.md b/knowledge/wiki/topics/security.md',
    '--- a/knowledge/wiki/topics/security.md',
    '+++ b/knowledge/wiki/topics/security.md',
    '@@ -1 +1 @@',
    `+${text}`,
  ].join('\n')
}

function mockClient(params: {
  metadata: ReturnType<typeof metadataResponse> | Error
  nodes?: readonly unknown[]
  onGraphql?: () => void
}): GitHubPrivateLeakClient {
  return {
    rest: {
      repos: {
        getContent: vi.fn(async () => {
          if (params.metadata instanceof Error) throw params.metadata
          return params.metadata
        }),
      },
    },
    graphql: vi.fn(async () => {
      params.onGraphql?.()
      return {data: {nodes: params.nodes ?? []}}
    }),
  } as unknown as GitHubPrivateLeakClient
}

const requestDefaults = {
  content: 'candidate wiki content',
  override: {titlePrefixed: false, isOperator: false},
}

describe('GitHub private-leak adapter', () => {
  it('passes public-only content without requiring workflow context', async () => {
    const client = mockClient({metadata: metadataResponse([])})

    const result = await checkPrivateLeakWithGitHub({
      ...requestDefaults,
      diff: diffFor('Public documentation.'),
      token: 'token-only-input',
      octokit: client,
    })

    expect(result).toEqual({ok: true})
  })

  it('returns a finding when a private repository name appears in added content', async () => {
    const client = mockClient({
      metadata: metadataResponse([{private: true, node_id: 'R_private'}]),
      nodes: [{nameWithOwner: 'acme/private-repo', isPrivate: true}],
    })

    const result = await checkPrivateLeakWithGitHub({
      ...requestDefaults,
      content: 'See acme/private-repo for details.',
      diff: diffFor('See acme/private-repo for details.'),
      token: 'token-only-input',
      octokit: client,
    })

    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/security.md']})
  })

  it('fails closed with a typed metadata error when authority cannot be read', async () => {
    const error = new Error('metadata unavailable')
    const client = mockClient({metadata: error})

    await expect(
      checkPrivateLeakWithGitHub({
        ...requestDefaults,
        diff: diffFor('Public documentation.'),
        token: 'token-only-input',
        octokit: client,
      }),
    ).rejects.toMatchObject({
      constructor: PrivateLeakAdapterError,
      code: 'METADATA_UNAVAILABLE',
    })
  })

  it('fails closed with a distinct typed resolution error when a private node is unresolved', async () => {
    const client = mockClient({
      metadata: metadataResponse([{private: true, node_id: 'R_missing'}]),
      nodes: [null],
    })

    await expect(
      checkPrivateLeakWithGitHub({
        ...requestDefaults,
        diff: diffFor('Public documentation.'),
        token: 'token-only-input',
        octokit: client,
      }),
    ).rejects.toMatchObject({
      constructor: PrivateLeakAdapterError,
      code: 'RESOLUTION_FAILED',
    })
  })

  it('keeps cache-hit outcomes identical while batching resolution once per metadata blob SHA', async () => {
    let graphqlFetches = 0
    const client = mockClient({
      metadata: metadataResponse([{private: true, node_id: 'R_private'}]),
      nodes: [{nameWithOwner: 'acme/private-repo', isPrivate: true}],
      onGraphql: () => {
        graphqlFetches++
      },
    })
    const adapter = await createGitHubPrivateLeakAdapter({token: 'token-only-input', octokit: client})
    const request = {
      ...requestDefaults,
      content: 'See acme/private-repo for details.',
      diff: diffFor('See acme/private-repo for details.'),
    }

    const first = await checkPrivateLeakWithGitHub({...request, adapter})
    const second = await checkPrivateLeakWithGitHub({...request, adapter})

    expect(second).toEqual(first)
    expect(graphqlFetches).toBe(1)
  })

  it('constructs an adapter from a token without reading workflow environment', async () => {
    const client = mockClient({metadata: metadataResponse([])})
    class OctokitMock {
      readonly rest = client.rest
      readonly graphql = client.graphql
    }
    octokitConstructor.mockImplementationOnce(OctokitMock as unknown as (...args: unknown[]) => unknown)

    const result = await checkPrivateLeakWithGitHub({
      ...requestDefaults,
      diff: diffFor('Public documentation.'),
      token: 'token-only-input',
    })

    expect(result).toEqual({ok: true})
    expect(octokitConstructor).toHaveBeenCalledWith({auth: 'token-only-input'})
  })
})
