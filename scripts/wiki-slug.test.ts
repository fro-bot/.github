import {describe, expect, it} from 'vitest'

import {buildPrivateNameTokens, computeRepoSlug} from './wiki-slug.ts'

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

describe('buildPrivateNameTokens', () => {
  it('returns canonical, double-dash, and slug forms for a known input', () => {
    // #given a synthetic owner/name pair
    const tokens = buildPrivateNameTokens('testowner/secret-repo')

    // #when the token set is built
    // #then it contains the canonical, raw double-dash, and slug forms
    expect(tokens).toContain('testowner/secret-repo')
    expect(tokens).toContain('testowner--secret-repo')
    // computeRepoSlug('testowner', 'secret-repo') → 'testowner--secret-repo' (same for simple names)
    // The set deduplicates, so length is 2 for simple names where raw == slug
    expect(tokens.length).toBeGreaterThanOrEqual(2)
  })

  it('deduplicates when raw double-dash form equals the slug form', () => {
    // #given a simple name where owner--name == computeRepoSlug(owner, name)
    const tokens = buildPrivateNameTokens('testowner/secret-repo')

    // #when the forms are identical
    // #then the result is deduplicated (no duplicate entries)
    const unique = new Set(tokens)
    expect(unique.size).toBe(tokens.length)
  })

  it('includes all three distinct forms when slug differs from raw double-dash', () => {
    // #given a name with underscores where slug sanitization differs from raw
    const tokens = buildPrivateNameTokens('testowner/my_private_repo')

    // #when the slug sanitizes underscores to dashes
    // #then all three distinct forms are present
    expect(tokens).toContain('testowner/my_private_repo') // canonical
    expect(tokens).toContain('testowner--my_private_repo') // raw double-dash (unsanitized)
    expect(tokens).toContain('testowner--my-private-repo') // slug (sanitized)
    expect(tokens.length).toBe(3)
  })

  it('returns empty array for input with no slash', () => {
    expect(buildPrivateNameTokens('noslash')).toEqual([])
  })

  it('returns empty array for input with empty owner or name', () => {
    expect(buildPrivateNameTokens('/name')).toEqual([])
    expect(buildPrivateNameTokens('owner/')).toEqual([])
  })
})
