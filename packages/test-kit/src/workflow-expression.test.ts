import {describe, expect, it} from 'vitest'

import {evaluateExpression, evaluateExpressionValue} from './workflow-expression.ts'

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

describe('evaluateExpressionValue', () => {
  it('returns the first truthy operand of an || chain, as Actions does', () => {
    expect(
      evaluateExpressionValue("inputs.key || github.number || 'daily'", {inputs: {key: ''}, github: {number: 7}}),
    ).toBe(7)
    expect(
      evaluateExpressionValue("inputs.key || github.number || 'daily'", {inputs: {key: 'k'}, github: {number: 7}}),
    ).toBe('k')
    expect(evaluateExpressionValue("inputs.key || 'daily'", {})).toBe('daily')
  })

  it('reads a property name that carries a hyphen', () => {
    expect(evaluateExpressionValue('inputs.concurrency-key', {inputs: {'concurrency-key': 'program-tracker-x'}})).toBe(
      'program-tracker-x',
    )
  })

  it('returns the right operand of a truthy && and the left operand of a falsy one', () => {
    expect(
      evaluateExpressionValue("github.event_name == 'schedule' && 'daily'", {github: {event_name: 'schedule'}}),
    ).toBe('daily')
    expect(evaluateExpressionValue("github.event_name == 'schedule' && 'daily'", {github: {event_name: 'push'}})).toBe(
      false,
    )
  })

  it('rejects tokens it cannot parse', () => {
    expect(() => evaluateExpressionValue("'a' 'b'", {})).toThrow(/unparsed tokens/)
  })
})
