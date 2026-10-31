import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * What each caller hands the core factory is part of its contract: which environment variable it
 * reads, and the timeout and logger it passes. These tests mock `@octokit/rest` with a constructor
 * that records its options and drive the callers whose factories can be reached from outside.
 */

const constructed: Record<string, unknown>[] = []

const ENVIRONMENT = ['GITHUB_TOKEN', 'METADATA_WRITE_TOKEN', 'STATUS_TRUTH_FETCH_TOKEN'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  constructed.length = 0
  for (const name of ENVIRONMENT) saved[name] = process.env[name]
  vi.resetModules()
  vi.doMock('@octokit/rest', () => ({
    Octokit: function Octokit(options: Record<string, unknown>) {
      constructed.push(options)
    },
  }))
})

afterEach(() => {
  for (const name of ENVIRONMENT) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  vi.doUnmock('@octokit/rest')
  vi.resetModules()
})

describe('capture-learnings-harvest createOctokitFromEnv', () => {
  it('reads GITHUB_TOKEN and sets neither a timeout nor a logger', async () => {
    process.env.GITHUB_TOKEN = 'harvest-token'
    const {createOctokitFromEnv} = await import('./capture-learnings-harvest.ts')
    await createOctokitFromEnv()
    expect(constructed).toStrictEqual([{auth: 'harvest-token'}])
  })

  it('throws its own message when GITHUB_TOKEN is unset or empty', async () => {
    const {createOctokitFromEnv} = await import('./capture-learnings-harvest.ts')
    delete process.env.GITHUB_TOKEN
    await expect(createOctokitFromEnv()).rejects.toThrow(
      'capture-learnings-harvest requires GITHUB_TOKEN in the environment',
    )
    process.env.GITHUB_TOKEN = ''
    await expect(createOctokitFromEnv()).rejects.toThrow(
      'capture-learnings-harvest requires GITHUB_TOKEN in the environment',
    )
    expect(constructed).toStrictEqual([])
  })
})

describe('status-truth-prs env-backed clients', () => {
  it('builds the fetch client from STATUS_TRUTH_FETCH_TOKEN with a 10 s timeout and a silent logger', async () => {
    process.env.STATUS_TRUTH_FETCH_TOKEN = 'fetch-token'
    process.env.GITHUB_TOKEN = 'write-token'
    const {buildEnvBackedRunPrsCoreDeps} = await import('./status-truth-prs.ts')
    await buildEnvBackedRunPrsCoreDeps().createFetchClient()
    expect(constructed).toHaveLength(1)
    expect(constructed[0]).toMatchObject({auth: 'fetch-token', request: {timeout: 10_000}})
    const log = constructed[0]?.log as Record<string, () => unknown>
    expect(Object.keys(log).sort()).toEqual(['debug', 'error', 'info', 'warn'])
    expect(log.debug?.()).toBeUndefined()
  })

  it('builds the write client from GITHUB_TOKEN with the same timeout and a silent logger', async () => {
    process.env.STATUS_TRUTH_FETCH_TOKEN = 'fetch-token'
    process.env.GITHUB_TOKEN = 'write-token'
    const {buildEnvBackedRunPrsCoreDeps} = await import('./status-truth-prs.ts')
    await buildEnvBackedRunPrsCoreDeps().createWriteClient()
    expect(constructed).toHaveLength(1)
    expect(constructed[0]).toMatchObject({auth: 'write-token', request: {timeout: 10_000}})
    expect(Object.keys(constructed[0]?.log as object).sort()).toEqual(['debug', 'error', 'info', 'warn'])
  })
})

describe('handle-invitation builds one client per credential', () => {
  it('uses GITHUB_TOKEN for the poll client and METADATA_WRITE_TOKEN for the metadata client, in that order', async () => {
    process.env.GITHUB_TOKEN = 'poll-token'
    process.env.METADATA_WRITE_TOKEN = 'metadata-token'
    const {handleInvitations} = await import('./handle-invitation.ts')
    // The recording constructor yields objects with no API, so the run fails once both clients exist.
    await handleInvitations().catch(() => undefined)
    expect(constructed.slice(0, 2)).toStrictEqual([{auth: 'poll-token'}, {auth: 'metadata-token'}])
  })

  it('never reuses the poll credential for the metadata client', async () => {
    process.env.GITHUB_TOKEN = 'poll-token'
    delete process.env.METADATA_WRITE_TOKEN
    const {handleInvitations} = await import('./handle-invitation.ts')
    const failure = await handleInvitations().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({code: 'MISSING_METADATA_TOKEN'})
    expect(constructed).toStrictEqual([{auth: 'poll-token'}])
  })
})
