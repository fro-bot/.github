import {describe, expect, it, vi} from 'vitest'

import {requiredEnv} from './env.ts'

describe('requiredEnv', () => {
  it('returns the value of a set variable', () => {
    expect(requiredEnv({TOKEN: 'abc'}, 'TOKEN')).toBe('abc')
  })

  it('returns a whitespace-only value, which is set', () => {
    expect(requiredEnv({TOKEN: ' '}, 'TOKEN')).toBe(' ')
  })

  it('reads the variable it was asked for, not another', () => {
    expect(requiredEnv({A: 'one', B: 'two'}, 'B')).toBe('two')
  })

  it.each([
    ['unset', {}],
    ['undefined', {TOKEN: undefined}],
    ['an empty string', {TOKEN: ''}],
  ])('treats %s as missing, with the default message', (_label, env) => {
    expect(() => requiredEnv(env, 'TOKEN')).toThrow(new Error('TOKEN is required'))
  })

  it('throws the error the caller builds, for the variable asked for', () => {
    class CallerError extends RangeError {}
    const missing = vi.fn((name: string) => new CallerError(`custom: ${name}`))
    let thrown: unknown
    try {
      requiredEnv({TOKEN: ''}, 'TOKEN', {missing})
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CallerError)
    expect(thrown).toMatchObject({message: 'custom: TOKEN'})
    expect(missing).toHaveBeenCalledExactlyOnceWith('TOKEN')
  })

  it('does not call the error factory when the variable is set', () => {
    const missing = vi.fn((name: string) => new Error(name))
    expect(requiredEnv({TOKEN: 'abc'}, 'TOKEN', {missing})).toBe('abc')
    expect(missing).not.toHaveBeenCalled()
  })
})
