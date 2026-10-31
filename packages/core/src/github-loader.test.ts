import {afterEach, describe, expect, it, vi} from 'vitest'

afterEach(() => {
  vi.doUnmock('@octokit/rest')
  vi.resetModules()
})

/** The error a promise rejects with. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

/** Imports a fresh `github.ts` against a mocked `@octokit/rest` module. */
async function githubWith(mockedModule: Record<string, unknown>): Promise<typeof import('./github.ts')> {
  vi.resetModules()
  vi.doMock('@octokit/rest', () => mockedModule)
  return import('./github.ts')
}

describe('loadOctokitConstructor against a mocked @octokit/rest', () => {
  it('returns the Octokit export when it is a function', async () => {
    class FakeOctokit {
      readonly marker = 'fake'
    }
    const {loadOctokitConstructor} = await githubWith({Octokit: FakeOctokit})
    await expect(loadOctokitConstructor()).resolves.toBe(FakeOctokit)
  })

  it('accepts a plain function export, which `new` can still call', async () => {
    const constructed: unknown[] = []
    const Plain = function Plain(this: unknown, options: unknown) {
      constructed.push(options)
    }
    const {createOctokit} = await githubWith({Octokit: Plain})
    await createOctokit('tok')
    expect(constructed).toStrictEqual([{auth: 'tok'}])
  })

  it('throws OctokitLoadError "missing-export" when the module has no Octokit key', async () => {
    const {loadOctokitConstructor, OctokitLoadError} = await githubWith({})
    const error = await rejection(loadOctokitConstructor())
    expect(error).toBeInstanceOf(OctokitLoadError)
    expect(error).toMatchObject({reason: 'missing-export', message: 'Failed to load @octokit/rest Octokit constructor'})
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object', {}],
    ['a string', 'Octokit'],
    ['a number', 5],
  ])('throws OctokitLoadError "not-a-constructor" when the Octokit export is %s', async (_label, value) => {
    const {loadOctokitConstructor, OctokitLoadError} = await githubWith({Octokit: value})
    const error = await rejection(loadOctokitConstructor())
    expect(error).toBeInstanceOf(OctokitLoadError)
    expect(error).toMatchObject({reason: 'not-a-constructor'})
  })

  it('createOctokit surfaces the load failure after its token check', async () => {
    const {createOctokit, OctokitLoadError} = await githubWith({Octokit: 'nope'})
    await expect(createOctokit('tok')).rejects.toBeInstanceOf(OctokitLoadError)
    await expect(createOctokit(undefined, {missingToken: () => new Error('no token')})).rejects.toThrow('no token')
  })
})
