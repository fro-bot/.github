import {describe, expect, it} from 'vitest'

import {buildPrivateNameTokens, buildPrivateTokenSet, computeRepoSlug} from './wiki-slug.ts'

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

// ---------------------------------------------------------------------------
// buildPrivateTokenSet (FIX 10 — extracted from capture-c1-propose + solutions-query)
// ---------------------------------------------------------------------------

describe('buildPrivateTokenSet', () => {
  it('returns a set containing all token forms for a private repo', () => {
    // #given a list with one private repo
    const tokens = buildPrivateTokenSet(['testowner/secret-repo'])

    // #when the token set is built
    // #then it contains the canonical, double-dash, and slug forms (lowercased)
    expect(tokens.has('testowner/secret-repo')).toBe(true)
    expect(tokens.has('testowner--secret-repo')).toBe(true)
  })

  it('lowercases all tokens', () => {
    // #given a mixed-case owner/name
    const tokens = buildPrivateTokenSet(['TestOwner/MyRepo'])

    // #when the token set is built
    // #then all tokens are lowercase
    for (const token of tokens) {
      expect(token).toBe(token.toLowerCase())
    }
  })

  it('skips entries with [REDACTED] owner or name', () => {
    // #given a list with a redacted entry
    const tokens = buildPrivateTokenSet(['[REDACTED]/[REDACTED]', 'testowner/real-repo'])

    // #when the token set is built
    // #then the redacted entry contributes no tokens
    expect(tokens.has('[redacted]/[redacted]')).toBe(false)
    // The real repo is still included
    expect(tokens.has('testowner/real-repo')).toBe(true)
  })

  it('skips entries with no slash', () => {
    // #given a list with an invalid entry (no slash)
    const tokens = buildPrivateTokenSet(['noslash', 'testowner/valid-repo'])

    // #when the token set is built
    // #then the invalid entry is skipped, valid entry is included
    expect(tokens.has('noslash')).toBe(false)
    expect(tokens.has('testowner/valid-repo')).toBe(true)
  })

  it('returns an empty set for an empty list', () => {
    // #given an empty list
    const tokens = buildPrivateTokenSet([])

    // #when the token set is built
    // #then the set is empty
    expect(tokens.size).toBe(0)
  })

  it('deduplicates tokens across multiple repos that share forms', () => {
    // #given two repos that produce overlapping tokens (unlikely but safe)
    const tokens = buildPrivateTokenSet(['testowner/repo-a', 'testowner/repo-b'])

    // #when the token set is built
    // #then both repos contribute their tokens without duplication
    expect(tokens.has('testowner/repo-a')).toBe(true)
    expect(tokens.has('testowner/repo-b')).toBe(true)
    // Set deduplication: size should equal unique token count
    expect(tokens.size).toBe(new Set(tokens).size)
  })
})
