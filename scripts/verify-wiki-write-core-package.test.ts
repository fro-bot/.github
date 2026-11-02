import {describe, expect, it} from 'vitest'

import {parsePackResult} from './verify-wiki-write-core-package.ts'

describe('parsePackResult', () => {
  const entry = {filename: 'pkg-1.0.0.tgz', files: [{path: 'package.json'}, {path: 'dist/index.js'}]}

  it('reads the array shape of npm 11 and earlier', () => {
    expect(parsePackResult(JSON.stringify([entry]))).toEqual({
      filename: 'pkg-1.0.0.tgz',
      files: ['package.json', 'dist/index.js'],
    })
  })

  it('reads the keyed object shape of npm 12', () => {
    expect(parsePackResult(JSON.stringify({'@fro.bot/wiki-write-core': entry}))).toEqual({
      filename: 'pkg-1.0.0.tgz',
      files: ['package.json', 'dist/index.js'],
    })
  })

  it.each([
    ['a string', '"text"'],
    ['null', 'null'],
    ['an empty array', '[]'],
    ['a result without a filename', JSON.stringify([{files: []}])],
    ['a result without a files array', JSON.stringify([{filename: 'a.tgz'}])],
  ])('rejects %s', (_label, output) => {
    expect(() => parsePackResult(output)).toThrow('unexpected npm pack --json output')
  })

  it('rejects a file entry without a path', () => {
    expect(() => parsePackResult(JSON.stringify([{filename: 'a.tgz', files: [{size: 1}]}]))).toThrow(
      'unexpected npm pack file entry',
    )
  })
})
