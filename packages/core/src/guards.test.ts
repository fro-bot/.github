import {describe, expect, it} from 'vitest'

import {isApiStatus, isApiStatusOfAnyObject, isObject, isRecord} from './guards.ts'

const arrayWithStatus = Object.assign([], {status: 404})
const notObjects: readonly unknown[] = [null, undefined, 0, 1, '', 'text', true, false, Symbol('s'), 10n, () => ({})]

describe('isObject', () => {
  it.each([{}, {a: 1}, Object.create(null), new Date(), new Error('boom'), [], [1, 2], arrayWithStatus])(
    'accepts %j',
    value => {
      expect(isObject(value)).toBe(true)
    },
  )

  it.each(notObjects)('rejects %s', value => {
    expect(isObject(value)).toBe(false)
  })
})

describe('isRecord', () => {
  it.each([{}, {a: 1}, Object.create(null), new Date(), new Error('boom')])('accepts %j', value => {
    expect(isRecord(value)).toBe(true)
  })

  it('rejects an array, which isObject accepts', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord([1, 2])).toBe(false)
    expect(isRecord(arrayWithStatus)).toBe(false)
    expect(isObject([])).toBe(true)
  })

  it.each(notObjects)('rejects %s', value => {
    expect(isRecord(value)).toBe(false)
  })

  it('narrows to a record whose keys can be read', () => {
    const value: unknown = {name: 'fro-bot'}
    expect(isRecord(value) ? value.name : undefined).toBe('fro-bot')
  })
})

describe('isApiStatus', () => {
  it('is true for an object whose status is exactly the number asked for', () => {
    expect(isApiStatus({status: 404}, 404)).toBe(true)
    expect(isApiStatus(Object.assign(new Error('Not Found'), {status: 404}), 404)).toBe(true)
    expect(isApiStatus({status: 0}, 0)).toBe(true)
  })

  it('is false for a different status', () => {
    expect(isApiStatus({status: 404}, 403)).toBe(false)
    expect(isApiStatus({status: 403}, 404)).toBe(false)
  })

  it('is false when the status is not a number, even one that coerces to it', () => {
    expect(isApiStatus({status: '404'}, 404)).toBe(false)
    expect(isApiStatus({status: [404]}, 404)).toBe(false)
    expect(isApiStatus({status: null}, 404)).toBe(false)
  })

  it('is false when there is no status', () => {
    expect(isApiStatus({}, 404)).toBe(false)
    expect(isApiStatus({code: 404}, 404)).toBe(false)
    expect(isApiStatus(new Error('plain'), 404)).toBe(false)
  })

  it('is false for an array, even one that carries a matching status', () => {
    expect(isApiStatus(arrayWithStatus, 404)).toBe(false)
  })

  it.each(notObjects)('is false for %s', value => {
    expect(isApiStatus(value, 404)).toBe(false)
  })
})

describe('isApiStatusOfAnyObject', () => {
  it('is true for an object whose status is exactly the number asked for', () => {
    expect(isApiStatusOfAnyObject({status: 422}, 422)).toBe(true)
    expect(isApiStatusOfAnyObject(Object.assign(new Error('Unprocessable'), {status: 422}), 422)).toBe(true)
  })

  it('is true for an array that carries a matching status, which isApiStatus rejects', () => {
    expect(isApiStatusOfAnyObject(arrayWithStatus, 404)).toBe(true)
    expect(isApiStatus(arrayWithStatus, 404)).toBe(false)
  })

  it('tells a missing status from one that is present and undefined', () => {
    const undefinedStatus = undefined as unknown as number
    expect(isApiStatusOfAnyObject({status: undefined}, undefinedStatus)).toBe(true)
    expect(isApiStatusOfAnyObject({}, undefinedStatus)).toBe(false)
    expect(isApiStatusOfAnyObject([], undefinedStatus)).toBe(false)
  })

  it('is false for a different status, a non-number status or a missing status', () => {
    expect(isApiStatusOfAnyObject({status: 404}, 403)).toBe(false)
    expect(isApiStatusOfAnyObject({status: '404'}, 404)).toBe(false)
    expect(isApiStatusOfAnyObject({}, 404)).toBe(false)
    expect(isApiStatusOfAnyObject([], 404)).toBe(false)
  })

  it.each(notObjects)('is false for %s', value => {
    expect(isApiStatusOfAnyObject(value, 404)).toBe(false)
  })
})
