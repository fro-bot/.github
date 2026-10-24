import process from 'node:process'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {formatJsonLine, writeJsonLine} from './json.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatJsonLine', () => {
  it('is compact JSON followed by one newline by default', () => {
    expect(formatJsonLine({a: 1, b: [1, 2], c: {d: 'x'}})).toBe('{"a":1,"b":[1,2],"c":{"d":"x"}}\n')
  })

  it('indents by the given number of spaces, still ending in one newline', () => {
    expect(formatJsonLine({a: 1, b: [1]}, {indent: 2})).toBe('{\n  "a": 1,\n  "b": [\n    1\n  ]\n}\n')
    expect(formatJsonLine({a: 1}, {indent: 4})).toBe('{\n    "a": 1\n}\n')
  })

  it('treats an indent of 0 as compact', () => {
    expect(formatJsonLine({a: 1}, {indent: 0})).toBe('{"a":1}\n')
  })

  it('is compact when the options carry no indent', () => {
    expect(formatJsonLine({a: 1}, {})).toBe('{"a":1}\n')
  })

  it('serializes scalars and null', () => {
    expect(formatJsonLine('text')).toBe('"text"\n')
    expect(formatJsonLine(3)).toBe('3\n')
    expect(formatJsonLine(null)).toBe('null\n')
    expect(formatJsonLine([])).toBe('[]\n')
  })

  it('keeps an embedded newline escaped, so the document is one line', () => {
    expect(formatJsonLine({text: 'a\nb'})).toBe('{"text":"a\\nb"}\n')
  })

  it.each([undefined, () => 1, Symbol('s')])('throws a TypeError for %s, which has no JSON form', value => {
    expect(() => formatJsonLine(value)).toThrow(TypeError)
    expect(() => formatJsonLine(value)).toThrow('value cannot be represented as JSON')
  })
})

describe('writeJsonLine', () => {
  it('writes one compact line to the sink', () => {
    const chunks: string[] = []
    writeJsonLine({ok: true}, {sink: {write: chunk => chunks.push(chunk)}})
    expect(chunks).toEqual(['{"ok":true}\n'])
  })

  it('passes the indent through to the sink write', () => {
    const chunks: string[] = []
    writeJsonLine({ok: true}, {indent: 2, sink: {write: chunk => chunks.push(chunk)}})
    expect(chunks).toEqual(['{\n  "ok": true\n}\n'])
  })

  it('writes to process.stdout when no sink is given', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    writeJsonLine({n: 1})
    expect(write).toHaveBeenCalledExactlyOnceWith('{"n":1}\n')
  })

  it('writes nothing when the value has no JSON form', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    expect(() => writeJsonLine(undefined)).toThrow(TypeError)
    expect(write).not.toHaveBeenCalled()
  })
})
