import {describe, expect, it} from 'vitest'

import {computeRepoSlug} from './wiki-slug.ts'

describe('computeRepoSlug', () => {
  it('preserves the double-dash separator between owner and repo', () => {
    // #given a standard owner/repo pair that would previously be squeezed to single-dash
    // #when the slug is computed
    // #then the canonical `{owner}--{repo}` form is preserved
    expect(computeRepoSlug('marcusrbrown', 'ha-config')).toBe('marcusrbrown--ha-config')
  })

  it('lowercases segments without mangling internal dashes', () => {
    // #given mixed-case owner and repo with internal dashes
    // #when the slug is computed
    // #then each segment is lowered and internal dashes are preserved
    expect(computeRepoSlug('Marcus-R', 'Hello-World')).toBe('marcus-r--hello-world')
  })

  it('replaces non-alphanumeric characters with single dashes per segment', () => {
    // #given segments containing characters outside [a-z0-9-] (spaces, dots, underscores)
    // #when the slug is computed
    // #then non-kept runs collapse to a single dash within each segment, then segments join with --
    expect(computeRepoSlug('fro-bot', '.github')).toBe('fro-bot--github')
    expect(computeRepoSlug('my org', 'weird  name')).toBe('my-org--weird-name')
    expect(computeRepoSlug('under_score', 'dot.name')).toBe('under-score--dot-name')
  })

  it('trims leading and trailing dashes within each segment before joining', () => {
    // #given segments whose sanitization would leave leading or trailing dashes
    // #when the slug is computed
    // #then those dashes are trimmed so the final form never has 3+ consecutive dashes
    expect(computeRepoSlug('__weird', 'trailing-')).toBe('weird--trailing')
    expect(computeRepoSlug('-leading', 'ok')).toBe('leading--ok')
  })

  it('throws when a segment sanitizes to an empty string', () => {
    // #given a segment that consists entirely of non-kept characters
    // #when the slug is computed
    // #then the helper refuses rather than producing an invalid slug
    expect(() => computeRepoSlug('___', 'valid')).toThrow(/empty/)
    expect(() => computeRepoSlug('valid', '')).toThrow(/empty/)
  })

  it('handles segments with dots in repo names (GitHub permits them)', () => {
    // #given a repo name like `.github` where GitHub's server convention keeps the leading dot
    // #when the slug is computed
    // #then we strip the dot-induced leading dash so the slug stays valid
    expect(computeRepoSlug('fro-bot', '.github')).toBe('fro-bot--github')
    expect(computeRepoSlug('marcusrbrown', 'esphome.life')).toBe('marcusrbrown--esphome-life')
  })
})
