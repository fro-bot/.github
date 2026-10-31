import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Four callers map the core factory's `OctokitLoadError` onto their own error class. A broken
 * `@octokit/rest` export surface cannot happen in production, so these are the only tests that reach
 * the mapping: the module under test is imported fresh against a mocked `@octokit/rest`.
 */

const TOKEN_VARIABLES = ['GITHUB_TOKEN', 'METADATA_WRITE_TOKEN', 'FRO_BOT_POLL_PAT'] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of TOKEN_VARIABLES) {
    saved[name] = process.env[name]
    process.env[name] = 'test-token'
  }
})

afterEach(() => {
  for (const name of TOKEN_VARIABLES) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  vi.doUnmock('@octokit/rest')
  vi.resetModules()
})

function mockOctokitRest(exportsOfModule: Record<string, unknown>): void {
  vi.resetModules()
  vi.doMock('@octokit/rest', () => exportsOfModule)
}

/** The error a promise rejects with. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

async function runCommitMetadata(): Promise<unknown> {
  const {commitMetadata} = await import('./commit-metadata.ts')
  return rejection(
    commitMetadata({
      path: 'metadata/repos.yaml',
      message: 'm',
      mutator: value => value,
    }),
  )
}

async function runMergeDataPr(): Promise<unknown> {
  const {mergeDataPr} = await import('./merge-data-pr.ts')
  return rejection(mergeDataPr())
}

const MISSING_EXPORT = {} as const
const NOT_A_CONSTRUCTOR = {Octokit: 'not a function'} as const

describe('commit-metadata', () => {
  it('maps a missing Octokit export to OCTOKIT_LOAD_FAILED', async () => {
    mockOctokitRest(MISSING_EXPORT)
    const error = await runCommitMetadata()
    expect(error).toMatchObject({
      name: 'CommitMetadataError',
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  })

  it('maps a non-constructor Octokit export to a TypeError', async () => {
    mockOctokitRest(NOT_A_CONSTRUCTOR)
    const error = await runCommitMetadata()
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({message: 'Invalid @octokit/rest Octokit export'})
  })
})

describe('merge-data-pr', () => {
  it('maps a missing Octokit export to OCTOKIT_LOAD_FAILED', async () => {
    mockOctokitRest(MISSING_EXPORT)
    const error = await runMergeDataPr()
    expect(error).toMatchObject({
      name: 'MergeDataPrError',
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  })

  it('maps a non-constructor Octokit export to a TypeError', async () => {
    mockOctokitRest(NOT_A_CONSTRUCTOR)
    const error = await runMergeDataPr()
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({message: 'Invalid @octokit/rest Octokit export'})
  })
})

describe('handle-invitation', () => {
  it.each([
    ['a missing export', MISSING_EXPORT],
    ['a non-constructor export', NOT_A_CONSTRUCTOR],
  ])('maps %s to OCTOKIT_LOAD_FAILED', async (_label, mocked) => {
    mockOctokitRest(mocked)
    const {handleInvitations} = await import('./handle-invitation.ts')
    const error = await rejection(handleInvitations())
    expect(error).toMatchObject({
      name: 'InvitationHandlingError',
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  })

  it('maps the metadata client the same way when only that one is built', async () => {
    mockOctokitRest(MISSING_EXPORT)
    const {handleInvitations} = await import('./handle-invitation.ts')
    const poll = {} as never
    const error = await rejection(handleInvitations({octokit: poll}))
    expect(error).toMatchObject({code: 'OCTOKIT_LOAD_FAILED'})
  })
})

describe('reconcile-repos', () => {
  it.each([
    ['a missing export', MISSING_EXPORT],
    ['a non-constructor export', NOT_A_CONSTRUCTOR],
  ])('maps %s to OCTOKIT_LOAD_FAILED', async (_label, mocked) => {
    mockOctokitRest(mocked)
    const {handleReconcile} = await import('./reconcile-repos.ts')
    const error = await rejection(handleReconcile())
    expect(error).toMatchObject({
      name: 'ReconcileError',
      code: 'OCTOKIT_LOAD_FAILED',
      message: 'Failed to load @octokit/rest Octokit constructor',
      remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
    })
  })
})
