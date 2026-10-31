import type {Octokit} from '@octokit/rest'
import type {OctokitConstructorOptions, OctokitLog} from './github.ts'

import {describe, expect, expectTypeOf, it, vi} from 'vitest'
import {createOctokit, loadOctokitConstructor, noopLog, OctokitLoadError} from './github.ts'

/** The error a promise rejects with. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

interface FakeClient {
  readonly options: OctokitConstructorOptions
}

/** A constructor that records exactly what it was constructed with. */
function recordingConstructor(): {
  readonly constructed: OctokitConstructorOptions[]
  readonly Constructor: new (options: OctokitConstructorOptions) => FakeClient
} {
  const constructed: OctokitConstructorOptions[] = []
  class Constructor {
    readonly options: OctokitConstructorOptions
    constructor(options: OctokitConstructorOptions) {
      this.options = options
      constructed.push(options)
    }
  }
  return {constructed, Constructor}
}

describe('createOctokit: what reaches the constructor', () => {
  const LOG = noopLog()

  it('passes only the token when no option is given', async () => {
    const {constructed, Constructor} = recordingConstructor()
    const client = await createOctokit<FakeClient>('tok', {loadConstructor: async () => Constructor})
    expect(constructed).toHaveLength(1)
    // strict: no `request` and no `log` key at all, not even undefined ones
    expect(Object.keys(constructed[0] ?? {})).toEqual(['auth'])
    expect(constructed[0]).toStrictEqual({auth: 'tok'})
    expect(client).toBeInstanceOf(Constructor)
  })

  it('passes only the token when no options object is given', async () => {
    const {constructed, Constructor} = recordingConstructor()
    const spy = vi.fn(async () => Constructor)
    await createOctokit<FakeClient>('tok', {loadConstructor: spy})
    expect(constructed).toStrictEqual([{auth: 'tok'}])
  })

  it('passes the token, a 15 s timeout and the no-op logger through when asked', async () => {
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>('tok', {
      timeoutMs: 15_000,
      log: LOG,
      loadConstructor: async () => Constructor,
    })
    expect(constructed).toStrictEqual([{auth: 'tok', request: {timeout: 15_000}, log: LOG}])
  })

  it('passes a timeout without a logger', async () => {
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>('tok', {timeoutMs: 10_000, loadConstructor: async () => Constructor})
    expect(constructed).toStrictEqual([{auth: 'tok', request: {timeout: 10_000}}])
  })

  it('passes a logger without a timeout', async () => {
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>('tok', {log: LOG, loadConstructor: async () => Constructor})
    expect(constructed).toStrictEqual([{auth: 'tok', log: LOG}])
  })

  it('keeps a timeout of 0, which is not "unset"', async () => {
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>('tok', {timeoutMs: 0, loadConstructor: async () => Constructor})
    expect(constructed).toStrictEqual([{auth: 'tok', request: {timeout: 0}}])
  })

  it('builds one client per call, each with its own token', async () => {
    const {constructed, Constructor} = recordingConstructor()
    const loadConstructor = async () => Constructor
    const first = await createOctokit<FakeClient>('one', {loadConstructor})
    const second = await createOctokit<FakeClient>('two', {loadConstructor})
    expect(first).not.toBe(second)
    expect(constructed).toStrictEqual([{auth: 'one'}, {auth: 'two'}])
  })

  it('loads the constructor once per call', async () => {
    const {Constructor} = recordingConstructor()
    const loadConstructor = vi.fn(async () => Constructor)
    await createOctokit<FakeClient>('tok', {loadConstructor})
    expect(loadConstructor).toHaveBeenCalledTimes(1)
  })
})

describe('createOctokit: a token that must exist', () => {
  const missingToken = (): Error => new Error('the caller says the token is missing')

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
  ])('throws the caller error for %s, before loading the constructor', async (_label, token) => {
    const loadConstructor = vi.fn(async () => recordingConstructor().Constructor)
    await expect(createOctokit<FakeClient>(token, {missingToken, loadConstructor})).rejects.toThrow(
      'the caller says the token is missing',
    )
    expect(loadConstructor).not.toHaveBeenCalled()
  })

  it('throws the very error the factory returned, not a copy', async () => {
    const error = new RangeError('custom class')
    const thrown = await rejection(
      createOctokit(undefined, {
        missingToken: () => error,
        loadConstructor: async () => recordingConstructor().Constructor,
      }),
    )
    expect(thrown).toBe(error)
  })

  it('does not call the error factory when the token is present', async () => {
    const factory = vi.fn(missingToken)
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>('tok', {missingToken: factory, loadConstructor: async () => Constructor})
    expect(factory).not.toHaveBeenCalled()
    expect(constructed).toStrictEqual([{auth: 'tok'}])
  })

  it('treats a whitespace-only token as present', async () => {
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>(' ', {missingToken, loadConstructor: async () => Constructor})
    expect(constructed).toStrictEqual([{auth: ' '}])
  })

  it('without missingToken, an empty string is used as given (the sites that never checked)', async () => {
    const {constructed, Constructor} = recordingConstructor()
    await createOctokit<FakeClient>('', {loadConstructor: async () => Constructor})
    expect(constructed).toStrictEqual([{auth: ''}])
  })

  it('lets the load failure through after the token check passed', async () => {
    const failure = new Error('loader failed')
    await expect(
      createOctokit<FakeClient>('tok', {
        missingToken,
        loadConstructor: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
  })
})

describe('createOctokit: the default constructor is the real @octokit/rest', () => {
  const LOG = noopLog()

  it('builds a working client with the rest namespaces', async () => {
    const client = await createOctokit('tok')
    expect(typeof client.rest.repos.get).toBe('function')
    expect(typeof client.request).toBe('function')
  })

  it('applies a request timeout to the real client without throwing', async () => {
    const client = await createOctokit('tok', {timeoutMs: 1234, log: LOG})
    expect(typeof client.rest.issues.create).toBe('function')
  })
})

describe('createOctokit: the default path is checked against the real Octokit', () => {
  it('returns the real Octokit type, with no client type to name', async () => {
    const direct = createOctokit('tok')
    const unset: string | undefined = undefined
    const checked = createOctokit(unset, {missingToken: () => new Error('no token')})
    const constructor = loadOctokitConstructor()
    expectTypeOf(direct).resolves.toEqualTypeOf<Octokit>()
    expectTypeOf(checked).resolves.toEqualTypeOf<Octokit>()
    expectTypeOf(constructor).resolves.toEqualTypeOf<new (options: OctokitConstructorOptions) => Octokit>()
    await expect(direct).resolves.toBeDefined()
    // The token is undefined, so the checked call rejects with the caller's error.
    await expect(checked).rejects.toThrow('no token')
    await expect(constructor).resolves.toBeTypeOf('function')
  })

  it('accepts a caller interface the real Octokit satisfies', async () => {
    interface NeedsRepos {
      readonly rest: {readonly repos: {readonly get: Octokit['rest']['repos']['get']}}
    }
    const client: NeedsRepos = await createOctokit('tok')
    expect(typeof client.rest.repos.get).toBe('function')
  })

  it('rejects a client type the real Octokit does not satisfy', async () => {
    interface Unrelated {
      missingMethod: () => void
    }
    const client = await createOctokit('tok')
    expectTypeOf(client).toEqualTypeOf<Octokit>()
    expectTypeOf(client).not.toMatchTypeOf<Unrelated>()
  })

  it('infers the client type from a custom loadConstructor, and only then', async () => {
    const {Constructor} = recordingConstructor()
    const client = await createOctokit('tok', {loadConstructor: async () => Constructor})
    expectTypeOf(client).toEqualTypeOf<FakeClient>()
    expectTypeOf(client).not.toMatchTypeOf<{missingMethod: () => void}>()
  })
})

describe('loadOctokitConstructor', () => {
  it('returns the Octokit constructor of @octokit/rest', async () => {
    const Constructor = await loadOctokitConstructor()
    expect(typeof Constructor).toBe('function')
    const instance = new Constructor({auth: 'tok'}) as {request?: unknown}
    expect(typeof instance.request).toBe('function')
  })
})

describe('OctokitLoadError', () => {
  it('is a TypeError with the message every site used', () => {
    const error = new OctokitLoadError('missing-export')
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('OctokitLoadError')
    expect(error.message).toBe('Failed to load @octokit/rest Octokit constructor')
    expect(error.reason).toBe('missing-export')
    expect(new OctokitLoadError('not-a-constructor').reason).toBe('not-a-constructor')
  })
})

describe('noopLog', () => {
  it('hands out a fresh object per call', () => {
    expect(noopLog()).not.toBe(noopLog())
  })

  it('has the four Octokit log methods and each returns undefined', () => {
    const log = noopLog()
    expect(Object.keys(log).sort()).toEqual(['debug', 'error', 'info', 'warn'])
    expect(log.debug()).toBeUndefined()
    expect(log.info()).toBeUndefined()
    expect(log.warn()).toBeUndefined()
    expect(log.error()).toBeUndefined()
  })

  it('accepts and ignores a message argument', () => {
    const log: OctokitLog = noopLog()
    expect(log.debug('GET /repos/x/y - 404')).toBeUndefined()
    expect(log.error('boom', {extra: true})).toBeUndefined()
  })
})
