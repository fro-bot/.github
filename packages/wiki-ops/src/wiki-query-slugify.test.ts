/**
 * `slugify` trims leading and trailing dashes with an index scan. It used to use `/^-+|-+$/g`, which
 * CodeQL reports as polynomial (`js/polynomial-redos`). This file keeps that expression as the reference
 * and compares the scan with it on seeded strings, then pins the edges.
 */

import {describe, expect, it} from 'vitest'
import {slugify} from './wiki-query.ts'

/** The implementation before the scan. */
function referenceSlugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

/** A small seeded generator, so a failure names the seed and replays. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const ALPHABET = ['a', 'Z', '0', '9', '-', '-', '_', ' ', '.', '/', 'é', '日', '😀', '\uD800', '\n', '--']

describe('slugify keeps the output of the expression it replaced', () => {
  it('matches the reference on 12 seeds x 2,000 strings', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const next = random(seed)
      for (let count = 0; count < 2000; count += 1) {
        const length = Math.floor(next() * 24)
        let value = ''
        for (let index = 0; index < length; index += 1) {
          const pick = ALPHABET[Math.floor(next() * ALPHABET.length)] ?? 'a'
          value += next() < 0.2 ? pick.repeat(1 + Math.floor(next() * 5)) : pick
        }
        expect(slugify(value), `seed ${seed} string ${count}: ${JSON.stringify(value)}`).toBe(referenceSlugify(value))
      }
    }
  })

  it.each([
    '',
    '-',
    '--',
    '---',
    '- -',
    '_',
    '___',
    ' ',
    'a',
    '-a',
    'a-',
    '-a-',
    '--a--',
    'a--b',
    '-a-b-',
    'Acme/Widgets',
    '.github',
    'fro-bot',
    '日本語',
    '-日本語-',
  ])('matches the reference on %j', value => {
    expect(slugify(value)).toBe(referenceSlugify(value))
  })
})

describe('slugify', () => {
  it('lowercases, collapses every run of other characters into one dash and trims the ends', () => {
    expect(slugify('Acme/Widgets')).toBe('acme-widgets')
    expect(slugify('.github')).toBe('github')
    expect(slugify('--A__B--')).toBe('a-b')
  })

  it('returns an empty string for a value with no letters or digits', () => {
    expect(slugify('')).toBe('')
    expect(slugify('---')).toBe('')
    expect(slugify('_ . /')).toBe('')
  })
})
