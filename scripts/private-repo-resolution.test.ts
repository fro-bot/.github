import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

import {makeGhNodeIdResolver} from './private-repo-resolution.ts'

// Hoisted mock for execFileSync.
const {mockExecFileSync} = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

// ---------------------------------------------------------------------------
// makeGhNodeIdResolver
// ---------------------------------------------------------------------------

describe('makeGhNodeIdResolver', () => {
  it('resolves a successful GraphQL response to nameWithOwner', async () => {
    // #given gh returns a valid node response
    const payload = JSON.stringify({data: {node: {nameWithOwner: 'org/repo'}}})
    mockExecFileSync.mockReturnValueOnce(payload)

    const resolver = makeGhNodeIdResolver('ghp_test')
    const result = await resolver('R_1')

    expect(result).toEqual({nameWithOwner: 'org/repo'})
  })

  it('returns access-lost when node is null (repo deleted or no access)', async () => {
    // #given gh returns null for the node (404 / no access)
    const payload = JSON.stringify({data: {node: null}})
    mockExecFileSync.mockReturnValueOnce(payload)

    const resolver = makeGhNodeIdResolver('ghp_test')
    const result = await resolver('R_gone')

    expect(result).toEqual({error: 'access-lost'})
  })

  it('returns access-lost when node exists but has no nameWithOwner (unexpected shape)', async () => {
    // #given gh returns a node with no nameWithOwner (e.g., not a Repository)
    const payload = JSON.stringify({data: {node: {__typename: 'User'}}})
    mockExecFileSync.mockReturnValueOnce(payload)

    const resolver = makeGhNodeIdResolver('ghp_test')
    const result = await resolver('R_user')

    expect(result).toEqual({error: 'access-lost'})
  })

  it('returns error with stderr when gh command fails', async () => {
    // #given gh throws with stderr content
    const err = Object.assign(new Error('gh failed'), {stderr: 'Bad credentials'})
    mockExecFileSync.mockImplementationOnce(() => {
      throw err
    })

    const resolver = makeGhNodeIdResolver('ghp_test')
    const result = await resolver('R_err')

    expect(result).toEqual({error: 'error', stderr: 'Bad credentials'})
  })

  it('returns error (no stderr) when gh throws without stderr property', async () => {
    // #given gh throws an error with no stderr
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('connection refused')
    })

    const resolver = makeGhNodeIdResolver('ghp_test')
    const result = await resolver('R_noStderr')

    expect(result).toEqual({error: 'error', stderr: undefined})
  })

  it('returns error when JSON response has no data field', async () => {
    // #given gh returns unexpected JSON shape
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({errors: [{message: 'bad query'}]}))

    const resolver = makeGhNodeIdResolver('ghp_test')
    const result = await resolver('R_bad')

    expect(result).toEqual({error: 'error'})
  })

  it('retries on rate-limit error and eventually returns error when exhausted', async () => {
    // #given execFileSync always throws a rate-limit error
    mockExecFileSync.mockReset()
    mockExecFileSync.mockImplementation(() => {
      throw new Error('API rate limit exceeded')
    })

    const resolver = makeGhNodeIdResolver('ghp_test', {maxRetries: 2, baseDelayMs: 1})
    const result = await resolver('R_rate')

    // #then after exhausting retries, returns error
    expect(result).toMatchObject({error: 'error'})
    // #and retried: 1 initial + 2 retries = 3 calls
    expect(mockExecFileSync).toHaveBeenCalledTimes(3)
  })

  it('does not retry on non-rate-limit errors', async () => {
    // #given execFileSync throws a non-rate-limit error
    mockExecFileSync.mockReset()
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('Bad credentials')
    })

    const resolver = makeGhNodeIdResolver('ghp_test', {maxRetries: 3, baseDelayMs: 1})
    await resolver('R_noRetry')

    // #then only called once (no retry)
    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
  })

  it('#3429: strips FRO_BOT_POLL_PAT from subprocess env and passes only GH_TOKEN', async () => {
    // #given: FRO_BOT_POLL_PAT and GITHUB_TOKEN are set in the ambient environment
    const savedPat = process.env.FRO_BOT_POLL_PAT
    const savedGithubToken = process.env.GITHUB_TOKEN
    process.env.FRO_BOT_POLL_PAT = 'ghp_ambient_pat'
    process.env.GITHUB_TOKEN = 'github_ambient'

    // Capture the options argument (3rd arg) passed to execFileSync
    let capturedOptions: {env?: NodeJS.ProcessEnv} | undefined
    const payload = JSON.stringify({data: {node: {nameWithOwner: 'org/repo'}}})
    mockExecFileSync.mockImplementationOnce((_cmd: unknown, _args: unknown, options: {env?: NodeJS.ProcessEnv}) => {
      capturedOptions = options
      return payload
    })

    try {
      const resolver = makeGhNodeIdResolver('ghp_test')
      await resolver('R_env_strip')

      // #then: the ambient PAT must NOT appear in the subprocess env
      expect(capturedOptions).toBeDefined()
      expect(capturedOptions?.env?.FRO_BOT_POLL_PAT).toBeUndefined()

      // #then: GH_TOKEN is set to the token passed to makeGhNodeIdResolver
      expect(capturedOptions?.env?.GH_TOKEN).toBe('ghp_test')

      // #then: GITHUB_TOKEN alias must NOT appear in the subprocess env (alias stripping)
      expect(capturedOptions?.env?.GITHUB_TOKEN).toBeUndefined()
    } finally {
      delete process.env.FRO_BOT_POLL_PAT
      if (savedPat !== undefined) process.env.FRO_BOT_POLL_PAT = savedPat
      delete process.env.GITHUB_TOKEN
      if (savedGithubToken !== undefined) process.env.GITHUB_TOKEN = savedGithubToken
    }
  })
})
