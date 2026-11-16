import {Buffer} from 'node:buffer'
import {describe, expect, it, vi} from 'vitest'
import {buildPrivateNameTokens as workflowPrivateNameTokens} from '../../../scripts/wiki-slug.ts'
import {
  checkPrivateLeakWithGitHub,
  createGitHubPrivateLeakAdapter,
  PrivateLeakAdapterError,
  type GitHubPrivateLeakClient,
} from './private-leak-adapter.ts'
import {buildPrivateNameTokens as packagePrivateNameTokens} from './wiki-slug.ts'

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
  graphqlError?: Error
  /** Answers each lookup by the node IDs it asks about; overrides `nodes` and `graphqlError`. */
  respond?: (ids: readonly string[]) => unknown
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
    graphql: vi.fn(async (_query: string, variables?: {ids: readonly string[]}) => {
      params.onGraphql?.()
      if (params.respond !== undefined) return params.respond(variables?.ids ?? [])
      if (params.graphqlError !== undefined) throw params.graphqlError
      return {nodes: params.nodes ?? []}
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

  it('accepts the unwrapped Octokit GraphQL response shape', async () => {
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

  it('returns the same canonical token authority set as the workflow gate', async () => {
    const resolvedName = 'acme/private_repo'
    const client = mockClient({
      metadata: metadataResponse([{private: true, node_id: 'R_private'}]),
      nodes: [{nameWithOwner: resolvedName, isPrivate: true}],
    })
    const adapter = await createGitHubPrivateLeakAdapter({token: 'token-only-input', octokit: client})

    const tokens = await adapter.resolvePrivateRepositoryNames({content: resolvedName})

    expect(tokens).toEqual(packagePrivateNameTokens(resolvedName))
    expect(tokens).toEqual(workflowPrivateNameTokens(resolvedName))
    expect(tokens).toContain('acme--private_repo')
    expect(tokens).toContain('acme--private-repo')
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

// ---------------------------------------------------------------------------
// An archived named row: scanned unless GitHub confirms it public at scan time
// ---------------------------------------------------------------------------

async function scan(client: GitHubPrivateLeakClient, line: string) {
  return checkPrivateLeakWithGitHub({
    ...requestDefaults,
    content: line,
    diff: diffFor(line),
    token: 'token-only-input',
    octokit: client,
  })
}

describe('GitHub private-leak adapter — an archived named row', () => {
  const storedName = 'acme/archived-widget'
  const liveName = 'other-org/renamed-widget'
  const archived = {
    owner: 'acme',
    name: 'archived-widget',
    private: false,
    node_id: 'R_arch',
    onboarding_status: 'archived',
  }
  const privateRow = {private: true, node_id: 'R_private', owner: 'redacted-owner', name: 'redacted-name'}
  const privateNode = {nameWithOwner: 'acme/private-repo', isPrivate: true}

  it('passes a line naming it when GitHub reports it PUBLIC', async () => {
    const client = mockClient({
      metadata: metadataResponse([archived]),
      nodes: [{nameWithOwner: storedName, isPrivate: false, visibility: 'PUBLIC'}],
    })

    expect(await scan(client, `See ${storedName} for details.`)).toEqual({ok: true})
  })

  it.each([
    ['PRIVATE', {isPrivate: true, visibility: 'PRIVATE'}],
    ['INTERNAL', {isPrivate: true, visibility: 'INTERNAL'}],
    ['a missing visibility', {isPrivate: false}],
    ['a null visibility', {isPrivate: false, visibility: null}],
    ['a lowercase public', {isPrivate: false, visibility: 'public'}],
    ['a padded PUBLIC', {isPrivate: false, visibility: 'PUBLIC '}],
    ['a boolean true', {isPrivate: false, visibility: true}],
    ['an array', {isPrivate: false, visibility: ['PUBLIC']}],
    ['an empty string', {isPrivate: false, visibility: ''}],
  ])('fails a line naming it, by the stored or the live name, when the lookup says %s', async (_label, extra) => {
    const client = mockClient({
      metadata: metadataResponse([archived]),
      nodes: [{nameWithOwner: liveName, ...extra}],
    })

    expect(await scan(client, `See ${storedName} for details.`)).toEqual({
      ok: false,
      matchedFiles: ['knowledge/wiki/topics/security.md'],
    })
    expect(await scan(client, `See ${liveName} for details.`)).toEqual({
      ok: false,
      matchedFiles: ['knowledge/wiki/topics/security.md'],
    })
  })

  it.each([
    ['an unresolved node', {nodes: [null]}],
    ['a node with no name', {nodes: [{isPrivate: false, visibility: 'PUBLIC'}]}],
    ['a rejected lookup', {graphqlError: new Error('rate limited')}],
    ['a short response', {nodes: []}],
  ])('scans by the stored name, without an error, for %s', async (_label, behavior) => {
    const client = mockClient({metadata: metadataResponse([archived]), ...behavior})

    expect(await scan(client, `See ${storedName} for details.`)).toEqual({
      ok: false,
      matchedFiles: ['knowledge/wiki/topics/security.md'],
    })
    expect(await scan(client, 'See acme/unrelated for details.')).toEqual({ok: true})
  })

  it.each([
    ['an empty name', ''],
    ['a whitespace-only name', ' \t '],
    ['a missing name', undefined],
    ['a number', 5],
    ['null', null],
  ])('scans by the stored name when GitHub says PUBLIC with %s', async (_label, name) => {
    const client = mockClient({
      metadata: metadataResponse([archived]),
      nodes: [{nameWithOwner: name, isPrivate: false, visibility: 'PUBLIC'}],
    })

    expect(await scan(client, `See ${storedName} for details.`)).toEqual({
      ok: false,
      matchedFiles: ['knowledge/wiki/topics/security.md'],
    })
    expect(await scan(client, 'See acme/unrelated for details.')).toEqual({ok: true})
  })

  it.each([
    ['an empty name', ''],
    ['a number', 5],
    ['null', null],
    ['a missing name', undefined],
  ])('adds no live token, and does not throw, when %s comes with a non-public node', async (_label, name) => {
    const client = mockClient({
      metadata: metadataResponse([archived]),
      nodes: [{nameWithOwner: name, isPrivate: true, visibility: 'PRIVATE'}],
    })

    expect(await scan(client, `See ${storedName} for details.`)).toMatchObject({ok: false})
  })

  it('still throws for a row stored private whose PUBLIC answer has an empty name: unchanged for private rows', async () => {
    const client = mockClient({
      metadata: metadataResponse([privateRow]),
      nodes: [{nameWithOwner: '', isPrivate: false, visibility: 'PUBLIC'}],
    })

    await expect(scan(client, 'Public documentation.')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
  })

  it('scans by the stored name and asks GitHub nothing for a row with no node_id', async () => {
    const client = mockClient({metadata: metadataResponse([{...archived, node_id: undefined}])})

    expect(await scan(client, `See ${storedName} for details.`)).toEqual({
      ok: false,
      matchedFiles: ['knowledge/wiki/topics/security.md'],
    })
    expect(client.graphql).not.toHaveBeenCalled()
  })

  it('treats a row with no private key as named', async () => {
    const client = mockClient({metadata: metadataResponse([{...archived, private: undefined}]), nodes: [null]})

    expect(await scan(client, `See ${storedName} for details.`)).toMatchObject({ok: false})
  })

  it('asks for the visibility of the archived row, and looks the private rows up in a batch of their own', async () => {
    const nodes: Record<string, unknown> = {
      R_arch: {nameWithOwner: storedName, isPrivate: false, visibility: 'PUBLIC'},
      R_private: privateNode,
    }
    const client = mockClient({
      metadata: metadataResponse([archived, privateRow]),
      respond: ids => ({nodes: ids.map(id => nodes[id])}),
    })

    const result = await scan(client, 'See acme/private-repo for details.')

    expect(result).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/security.md']})
    const calls = vi.mocked(client.graphql).mock.calls as unknown as [string, {ids: string[]}][]
    expect(calls.map(([, variables]) => variables.ids)).toEqual([['R_private'], ['R_arch']])
    expect(calls.every(([query]) => query.includes('visibility'))).toBe(true)
  })

  it('still throws for an unresolved private row beside an archived row', async () => {
    const client = mockClient({
      metadata: metadataResponse([archived, privateRow]),
      nodes: [{nameWithOwner: storedName, isPrivate: false, visibility: 'PUBLIC'}, null],
    })

    await expect(scan(client, 'Public documentation.')).rejects.toMatchObject({
      constructor: PrivateLeakAdapterError,
      code: 'RESOLUTION_FAILED',
    })
  })

  it.each([
    ['a rejected lookup', {graphqlError: new Error('rate limited')}],
    ['a short response', {nodes: [{nameWithOwner: storedName, isPrivate: false, visibility: 'PUBLIC'}]}],
  ])('still throws for %s when a private row is in the batch', async (_label, behavior) => {
    const client = mockClient({metadata: metadataResponse([archived, privateRow]), ...behavior})

    await expect(scan(client, 'Public documentation.')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
  })

  it('still throws when GitHub reports a row stored private as public: unchanged for private rows', async () => {
    const client = mockClient({
      metadata: metadataResponse([privateRow]),
      nodes: [{nameWithOwner: 'acme/private-repo', isPrivate: false, visibility: 'PUBLIC'}],
    })

    await expect(scan(client, 'Public documentation.')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
  })

  it('treats a redacted archived row as a private row: it throws when GitHub reports it public or cannot resolve it', async () => {
    const redacted = {...archived, private: true, owner: 'redacted-owner', name: 'R_arch'}

    const reportedPublic = mockClient({
      metadata: metadataResponse([redacted]),
      nodes: [{nameWithOwner: storedName, isPrivate: false, visibility: 'PUBLIC'}],
    })
    const unresolved = mockClient({metadata: metadataResponse([redacted]), nodes: [null]})
    const noId = mockClient({metadata: metadataResponse([{...redacted, node_id: undefined}])})

    await expect(scan(reportedPublic, 'x')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
    await expect(scan(unresolved, 'x')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
    await expect(scan(noId, 'x')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
  })

  it('does not ask about a row that is neither private nor archived', async () => {
    const client = mockClient({metadata: metadataResponse([{...archived, onboarding_status: 'onboarded'}])})

    expect(await scan(client, `See ${storedName} for details.`)).toEqual({ok: true})
    expect(client.graphql).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// A reused adapter: an archived row is resolved on every scan, a private row once per metadata SHA
// ---------------------------------------------------------------------------

const reusedPrivateNode = {nameWithOwner: 'acme/private-repo', isPrivate: true}

/** A client whose answers per node ID can change between scans while the metadata blob stays the same. */
function reusedClient(rows: readonly Record<string, unknown>[]) {
  const answers: Record<string, unknown> = {R_private: reusedPrivateNode}
  const asked: string[][] = []
  const client = mockClient({
    metadata: metadataResponse(rows),
    respond: ids => {
      asked.push([...ids])
      const answer = ids.map(id => answers[id])
      if (answer.some(item => item instanceof Error)) throw new Error('lookup failed')
      return {nodes: answer}
    },
  })
  return {client, answers, asked}
}

async function scanWith(adapter: Awaited<ReturnType<typeof createGitHubPrivateLeakAdapter>>, line: string) {
  return checkPrivateLeakWithGitHub({
    ...requestDefaults,
    content: line,
    diff: diffFor(line),
    adapter,
  })
}

describe('GitHub private-leak adapter — reuse with an unchanged metadata SHA', () => {
  const storedName = 'acme/archived-widget'
  const liveName = 'other-org/renamed-widget'
  const archived = {
    owner: 'acme',
    name: 'archived-widget',
    private: false,
    node_id: 'R_arch',
    onboarding_status: 'archived',
  }
  const privateRow = {private: true, node_id: 'R_private', owner: 'redacted-owner', name: 'redacted-name'}
  const publicNode = {nameWithOwner: storedName, isPrivate: false, visibility: 'PUBLIC'}
  const privateNode = {nameWithOwner: 'acme/private-repo', isPrivate: true}

  it('re-resolves an archived row on every scan: PUBLIC then PRIVATE blocks the second scan', async () => {
    const {client, answers, asked} = reusedClient([archived])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})
    answers.R_arch = publicNode

    const first = await scanWith(adapter, `See ${storedName} for details.`)
    answers.R_arch = {nameWithOwner: storedName, isPrivate: true, visibility: 'PRIVATE'}
    const second = await scanWith(adapter, `See ${storedName} for details.`)

    expect(first).toEqual({ok: true})
    expect(second).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/security.md']})
    expect(asked).toEqual([['R_arch'], ['R_arch']])
  })

  it('picks up the live name on recovery: a failed lookup first, then a non-public answer under a new name', async () => {
    const {client, answers, asked} = reusedClient([archived])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})
    answers.R_arch = new Error('lookup failed')

    const first = await scanWith(adapter, `See ${liveName} for details.`)
    answers.R_arch = {nameWithOwner: liveName, isPrivate: true, visibility: 'PRIVATE'}
    const second = await scanWith(adapter, `See ${liveName} for details.`)
    const secondByStoredName = await scanWith(adapter, `See ${storedName} for details.`)

    expect(first).toEqual({ok: true})
    expect(second).toEqual({ok: false, matchedFiles: ['knowledge/wiki/topics/security.md']})
    expect(secondByStoredName).toMatchObject({ok: false})
    expect(asked).toHaveLength(3)
  })

  it('clears the row on the second scan when it turns PUBLIC after a PRIVATE first scan', async () => {
    const {client, answers} = reusedClient([archived])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})
    answers.R_arch = {nameWithOwner: storedName, isPrivate: true, visibility: 'PRIVATE'}

    const first = await scanWith(adapter, `See ${storedName} for details.`)
    answers.R_arch = publicNode
    const second = await scanWith(adapter, `See ${storedName} for details.`)

    expect(first).toMatchObject({ok: false})
    expect(second).toEqual({ok: true})
  })

  it('looks a private row up once per metadata SHA, and the archived row on every scan, beside each other', async () => {
    const {client, answers, asked} = reusedClient([archived, privateRow])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})
    answers.R_arch = publicNode

    await scanWith(adapter, 'See acme/private-repo for details.')
    await scanWith(adapter, 'See acme/private-repo for details.')
    const third = await scanWith(adapter, 'See acme/private-repo for details.')

    expect(third).toMatchObject({ok: false})
    expect(asked.filter(ids => ids.includes('R_private'))).toEqual([['R_private']])
    expect(asked.filter(ids => ids.includes('R_arch'))).toEqual([['R_arch'], ['R_arch'], ['R_arch']])
  })

  it('makes a private-row lookup failure fatal once and retries it on the next scan, as before', async () => {
    const {client, answers, asked} = reusedClient([archived, privateRow])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})
    answers.R_arch = publicNode
    answers.R_private = new Error('lookup failed')

    await expect(scanWith(adapter, 'x')).rejects.toMatchObject({code: 'RESOLUTION_FAILED'})
    answers.R_private = privateNode
    expect(await scanWith(adapter, 'See acme/private-repo for details.')).toMatchObject({ok: false})
    expect(asked.filter(ids => ids.includes('R_private'))).toEqual([['R_private'], ['R_private']])
  })

  it('makes the same number of GitHub calls as before when no row is archived: one lookup per SHA', async () => {
    const {client, asked} = reusedClient([privateRow])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})

    await scanWith(adapter, 'Public documentation.')
    await scanWith(adapter, 'Public documentation.')

    expect(asked).toEqual([['R_private']])
    expect(client.rest.repos.getContent).toHaveBeenCalledTimes(2)
  })

  it('makes no lookup at all for a registry with neither a private nor an archived row', async () => {
    const {client, asked} = reusedClient([])
    const adapter = await createGitHubPrivateLeakAdapter({octokit: client})

    await scanWith(adapter, 'Public documentation.')
    await scanWith(adapter, 'Public documentation.')

    expect(asked).toEqual([])
  })
})
