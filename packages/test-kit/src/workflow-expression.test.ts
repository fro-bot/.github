import {describe, expect, it} from 'vitest'

import {evaluateExpression} from './workflow-expression.ts'

describe('evaluateExpression', () => {
  it('treats the number 0 as falsy, like Actions', () => {
    expect(evaluateExpression('inputs.count', {inputs: {count: 0}})).toBe(false)
    expect(evaluateExpression('inputs.count', {inputs: {count: 3}})).toBe(true)
    expect(evaluateExpression('inputs.count || inputs.fallback', {inputs: {count: 0, fallback: 'x'}})).toBe(true)
    expect(evaluateExpression('!inputs.count', {inputs: {count: 0}})).toBe(true)
  })

  it('compares integer literals', () => {
    expect(evaluateExpression('github.number == 3512', {github: {number: 3512}})).toBe(true)
    expect(evaluateExpression('github.number == 3512', {github: {number: 3511}})).toBe(false)
  })

  it.each([
    'inputs.a ~ inputs.b',
    'inputs.a & inputs.b',
    'inputs.a | inputs.b',
    'inputs.a = inputs.b',
    "'unterminated",
  ])('rejects a character that starts no token in %j', source => {
    expect(() => evaluateExpression(source, {inputs: {a: 'x', b: 'x'}})).toThrow(/unexpected character/)
  })

  it('keeps accepting a well-formed expression with strings, calls and grouping', () => {
    expect(
      evaluateExpression("contains(github.body || '', '@fro-bot') && (github.actor != 'fro-bot')", {
        github: {body: 'hi @fro-bot', actor: 'marcusrbrown'},
      }),
    ).toBe(true)
  })
})
