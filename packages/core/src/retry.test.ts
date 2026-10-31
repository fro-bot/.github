import {afterEach, describe, expect, it, vi} from 'vitest'

import {retry} from './retry.ts'

class Boom extends Error {
  readonly tag: string
  constructor(tag: string) {
    super(tag)
    this.tag = tag
  }
}

/** Sleep that records the wait and resolves at once, so no test waits for real. */
function recordingSleep(): {readonly waits: number[]; readonly sleep: (ms: number) => Promise<void>} {
  const waits: number[] = []
  return {
    waits,
    sleep: async ms => {
      waits.push(ms)
      await Promise.resolve()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('retry: success and the attempt number', () => {
  it('returns the first result without sleeping and passes attempt 1', async () => {
    const {waits, sleep} = recordingSleep()
    const operation = vi.fn(async (attempt: number) => `ok-${String(attempt)}`)
    await expect(retry(operation, {attempts: 3, delayMs: () => 100, sleep})).resolves.toBe('ok-1')
    expect(operation).toHaveBeenCalledExactlyOnceWith(1)
    expect(waits).toEqual([])
  })

  it('passes the 1-based attempt number to every call', async () => {
    const seen: number[] = []
    const result = await retry(
      async attempt => {
        seen.push(attempt)
        if (attempt < 3) throw new Boom('again')
        return attempt
      },
      {attempts: 5, shouldRetry: () => true},
    )
    expect(result).toBe(3)
    expect(seen).toEqual([1, 2, 3])
  })

  it('catches a synchronous throw from the operation like a rejection', async () => {
    const seen: number[] = []
    const operation = async (attempt: number): Promise<string> => {
      seen.push(attempt)
      if (attempt === 1) throw new Boom('sync')
      return Promise.resolve('recovered')
    }
    await expect(retry(operation, {attempts: 2, shouldRetry: () => true})).resolves.toBe('recovered')
    expect(seen).toEqual([1, 2])
  })
})

describe('retry: thrown errors', () => {
  it('never retries an error when there is no shouldRetry', async () => {
    const error = new Boom('first')
    const operation = vi.fn(async () => {
      throw error
    })
    await expect(retry(operation, {attempts: 5})).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('throws a non-retryable error on the first attempt, unchanged, without sleeping or onRetry', async () => {
    const {waits, sleep} = recordingSleep()
    const error = new Boom('fatal')
    const operation = vi.fn(async () => {
      throw error
    })
    const onRetry = vi.fn()
    const shouldRetry = vi.fn(() => false)
    await expect(retry(operation, {attempts: 4, delayMs: () => 50, shouldRetry, onRetry, sleep})).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledExactlyOnceWith(error, 1)
    expect(onRetry).not.toHaveBeenCalled()
    expect(waits).toEqual([])
  })

  it('stops at the first non-retryable error after retryable ones', async () => {
    const retryable = new Boom('retry')
    const fatal = new Boom('fatal')
    const errors = [retryable, retryable, fatal]
    const operation = vi.fn(async (attempt: number) => {
      throw errors[attempt - 1]
    })
    await expect(retry(operation, {attempts: 10, shouldRetry: error => error === retryable})).rejects.toBe(fatal)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('runs exactly `attempts` times and rethrows the last error unchanged', async () => {
    const errors = [new Boom('a'), new Boom('b'), new Boom('c')]
    const operation = vi.fn(async (attempt: number) => {
      throw errors[attempt - 1]
    })
    await expect(retry(operation, {attempts: 3, shouldRetry: () => true})).rejects.toBe(errors[2])
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('consults shouldRetry with (error, attempt) on every attempt except the last', async () => {
    const shouldRetry = vi.fn(() => true)
    const errors = [new Boom('a'), new Boom('b'), new Boom('c')]
    await expect(
      retry(
        async attempt => {
          throw errors[attempt - 1]
        },
        {attempts: 3, shouldRetry},
      ),
    ).rejects.toBeInstanceOf(Boom)
    expect(shouldRetry.mock.calls).toEqual([
      [errors[0], 1],
      [errors[1], 2],
    ])
  })

  it('throws the error as given for a non-Error value', async () => {
    await expect(
      retry(
        async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'plain string'
        },
        {attempts: 2, shouldRetry: () => true},
      ),
    ).rejects.toBe('plain string')
  })

  it('does not retry at all with a single attempt, and does not consult shouldRetry', async () => {
    const error = new Boom('only')
    const shouldRetry = vi.fn(() => true)
    const operation = vi.fn(async () => {
      throw error
    })
    await expect(retry(operation, {attempts: 1, shouldRetry})).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(shouldRetry).not.toHaveBeenCalled()
  })

  it('lets an error from shouldRetry propagate instead of retrying', async () => {
    const predicateError = new Boom('predicate')
    const operation = vi.fn(async () => {
      throw new Boom('op')
    })
    await expect(
      retry(operation, {
        attempts: 3,
        shouldRetry: () => {
          throw predicateError
        },
      }),
    ).rejects.toBe(predicateError)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('retry: returned values', () => {
  it('never retries a result when there is no retryResult', async () => {
    const operation = vi.fn(async () => 'anything')
    await expect(retry(operation, {attempts: 5})).resolves.toBe('anything')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries a retryable result until it is not retryable', async () => {
    const results = ['unknown', 'unknown', 'clean']
    const operation = vi.fn(async (attempt: number) => results[attempt - 1])
    await expect(retry(operation, {attempts: 5, retryResult: result => result === 'unknown'})).resolves.toBe('clean')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('returns the last result unchanged when it is still retryable on the last attempt', async () => {
    const last = {state: 'unknown'}
    const operation = vi.fn(async (attempt: number) => (attempt === 3 ? last : {state: 'unknown'}))
    const result = await retry(operation, {attempts: 3, retryResult: value => value.state === 'unknown'})
    expect(result).toBe(last)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('consults retryResult with (result, attempt) on every attempt except the last', async () => {
    const retryResult = vi.fn(() => true)
    await retry(async attempt => `r${String(attempt)}`, {attempts: 3, retryResult})
    expect(retryResult.mock.calls).toEqual([
      ['r1', 1],
      ['r2', 2],
    ])
  })

  it('does not consult retryResult with a single attempt', async () => {
    const retryResult = vi.fn(() => true)
    await expect(retry(async () => 'x', {attempts: 1, retryResult})).resolves.toBe('x')
    expect(retryResult).not.toHaveBeenCalled()
  })

  it('does not route an error from retryResult into shouldRetry', async () => {
    const predicateError = new Boom('result predicate')
    const shouldRetry = vi.fn(() => true)
    await expect(
      retry(async () => 'value', {
        attempts: 3,
        shouldRetry,
        retryResult: () => {
          throw predicateError
        },
      }),
    ).rejects.toBe(predicateError)
    expect(shouldRetry).not.toHaveBeenCalled()
  })

  it('mixes a retried error, a retried result and a final success', async () => {
    const seen: string[] = []
    const result = await retry(
      async attempt => {
        if (attempt === 1) throw new Boom('net')
        return attempt === 2 ? 'pending' : 'done'
      },
      {
        attempts: 4,
        shouldRetry: () => true,
        retryResult: value => value === 'pending',
        onRetry: (_error, attempt) => {
          seen.push(`retry-${String(attempt)}`)
        },
      },
    )
    expect(result).toBe('done')
    expect(seen).toEqual(['retry-1'])
  })
})

describe('retry: delays', () => {
  it('sleeps delayMs(attempt) after each failed attempt, but not after the last', async () => {
    const {waits, sleep} = recordingSleep()
    await expect(
      retry(
        async () => {
          throw new Boom('x')
        },
        {attempts: 4, delayMs: attempt => attempt * 1000, shouldRetry: () => true, sleep},
      ),
    ).rejects.toBeInstanceOf(Boom)
    expect(waits).toEqual([1000, 2000, 3000])
  })

  it('sleeps the same way between retried results', async () => {
    const {waits, sleep} = recordingSleep()
    await retry(async () => 'again', {attempts: 3, delayMs: attempt => attempt * 10, retryResult: () => true, sleep})
    expect(waits).toEqual([10, 20])
  })

  it('computes an exponential schedule from the attempt number', async () => {
    const {waits, sleep} = recordingSleep()
    await expect(
      retry(
        async () => {
          throw new Boom('rate limit')
        },
        {attempts: 4, delayMs: attempt => 2000 * 2 ** (attempt - 1), shouldRetry: () => true, sleep},
      ),
    ).rejects.toBeInstanceOf(Boom)
    expect(waits).toEqual([2000, 4000, 8000])
  })

  it('passes the failed attempt number to delayMs and never calls it for the last attempt', async () => {
    const delayMs = vi.fn(() => 5)
    const {sleep} = recordingSleep()
    await expect(
      retry(
        async () => {
          throw new Boom('x')
        },
        {attempts: 3, delayMs, shouldRetry: () => true, sleep},
      ),
    ).rejects.toBeInstanceOf(Boom)
    expect(delayMs.mock.calls).toEqual([[1], [2]])
  })

  it.each([
    ['omitted', undefined],
    ['zero', () => 0],
    ['negative', () => -5],
  ])('does not sleep when the delay is %s', async (_label, delayMs) => {
    const sleep = vi.fn(async () => {})
    await retry(async attempt => attempt, {
      attempts: 3,
      ...(delayMs === undefined ? {} : {delayMs}),
      retryResult: attempt => attempt < 3,
      sleep,
    })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('sleeps for a delay of 1, the smallest positive wait', async () => {
    const {waits, sleep} = recordingSleep()
    await retry(async attempt => attempt, {attempts: 2, delayMs: () => 1, retryResult: attempt => attempt < 2, sleep})
    expect(waits).toEqual([1])
  })

  it('waits for the sleep before the next attempt starts', async () => {
    const events: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const pending = retry(
      async attempt => {
        events.push(`start-${String(attempt)}`)
        if (attempt === 1) throw new Boom('x')
        return 'done'
      },
      {
        attempts: 2,
        delayMs: () => 10,
        shouldRetry: () => true,
        sleep: async () => {
          events.push('sleep')
          await gate
        },
      },
    )
    await vi.waitFor(() => {
      expect(events).toEqual(['start-1', 'sleep'])
    })
    release()
    await expect(pending).resolves.toBe('done')
    expect(events).toEqual(['start-1', 'sleep', 'start-2'])
  })

  it('lets a sleep failure propagate', async () => {
    const sleepError = new Boom('sleep')
    await expect(
      retry(
        async () => {
          throw new Boom('x')
        },
        {
          attempts: 2,
          delayMs: () => 10,
          shouldRetry: () => true,
          sleep: async () => {
            throw sleepError
          },
        },
      ),
    ).rejects.toBe(sleepError)
  })

  it('uses a real timer by default: pending until the delay has elapsed', async () => {
    vi.useFakeTimers()
    let settled = false
    const pending = retry(async attempt => attempt, {
      attempts: 2,
      delayMs: () => 1000,
      retryResult: attempt => attempt < 2,
    }).then(value => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(2)
    expect(settled).toBe(true)
  })

  it('looks the timer up when it sleeps, so a test that fakes timers later still controls it', async () => {
    const pending = (async () => {
      vi.useFakeTimers()
      return retry(async attempt => attempt, {attempts: 2, delayMs: () => 50, retryResult: attempt => attempt < 2})
    })()
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe(2)
  })
})

describe('retry: onRetry', () => {
  it('runs after shouldRetry says yes and before the sleep, with (error, attempt)', async () => {
    const events: string[] = []
    const errors = [new Boom('a'), new Boom('b')]
    await expect(
      retry(
        async attempt => {
          events.push(`op-${String(attempt)}`)
          throw errors[attempt - 1]
        },
        {
          attempts: 2,
          delayMs: () => 10,
          shouldRetry: () => {
            events.push('should')
            return true
          },
          onRetry: (error, attempt) => {
            events.push(`on-${String(attempt)}-${(error as Boom).tag}`)
          },
          sleep: async () => {
            events.push('sleep')
            await Promise.resolve()
          },
        },
      ),
    ).rejects.toBe(errors[1])
    expect(events).toEqual(['op-1', 'should', 'on-1-a', 'sleep', 'op-2'])
  })

  it('is awaited before the sleep and the next attempt', async () => {
    const events: string[] = []
    await retry(
      async attempt => {
        events.push(`op-${String(attempt)}`)
        if (attempt === 1) throw new Boom('x')
        return 'ok'
      },
      {
        attempts: 2,
        shouldRetry: () => true,
        onRetry: async () => {
          await Promise.resolve()
          events.push('on-done')
        },
      },
    )
    expect(events).toEqual(['op-1', 'on-done', 'op-2'])
  })

  it('does not run for the last attempt, for a non-retryable error or for a retried result', async () => {
    const onRetry = vi.fn()
    await expect(
      retry(
        async () => {
          throw new Boom('fatal')
        },
        {attempts: 3, shouldRetry: () => false, onRetry},
      ),
    ).rejects.toBeInstanceOf(Boom)
    await expect(
      retry(
        async () => {
          throw new Boom('x')
        },
        {attempts: 1, shouldRetry: () => true, onRetry},
      ),
    ).rejects.toBeInstanceOf(Boom)
    await retry(async attempt => attempt, {attempts: 3, retryResult: attempt => attempt < 3, onRetry})
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('lets a failure in onRetry propagate and stops retrying', async () => {
    const hookError = new Boom('hook')
    const operation = vi.fn(async () => {
      throw new Boom('x')
    })
    await expect(
      retry(operation, {
        attempts: 3,
        shouldRetry: () => true,
        onRetry: () => {
          throw hookError
        },
      }),
    ).rejects.toBe(hookError)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('retry: attempts validation', () => {
  it.each([0, -1, 1.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects attempts = %s without calling the operation',
    async attempts => {
      const operation = vi.fn(async () => 'x')
      await expect(retry(operation, {attempts})).rejects.toThrow(RangeError)
      await expect(retry(operation, {attempts})).rejects.toThrow(
        `retry attempts must be an integer >= 1, got ${String(attempts)}`,
      )
      expect(operation).not.toHaveBeenCalled()
    },
  )

  it('accepts 1 as the smallest value', async () => {
    await expect(retry(async () => 'x', {attempts: 1})).resolves.toBe('x')
  })
})
