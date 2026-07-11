/**
 * Tests for the public-output privacy gate adapter.
 *
 * Key invariants under test:
 * - One shared gate function covers every public surface kind.
 * - Private-token or secret-like content blocks output; only counters are returned.
 * - Token-load failure blocks all output (fail-closed).
 * - Fingerprints never appear in counts-only surfaces (workflow-summary-row,
 *   workflow-run-display-name, workflow-step-summary).
 * - Phase 2 PR surfaces are gated in Phase 1.
 * - Mutation guard: replacing the gate with an identity passthrough fails a private-identity test.
 */

import type {PublicOutputSurface, PublicOutputTokens} from './status-truth-public-output.ts'

import {describe, expect, it} from 'vitest'
import {learningBodyHasPrivateLeak} from './capture-learnings-privacy.ts'
import {
  applyPublicOutputGate,
  COUNTS_ONLY_SURFACES,
  isCountsOnlySurface,
  isPublicOutputTokensLoaded,
  makePublicOutputTokens,
  PHASE2_RESERVED_SURFACES,
} from './status-truth-public-output.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal loaded token set with no private tokens and no redacted IDs. */
function makeEmptyTokens(): PublicOutputTokens & {loaded: true} {
  return makePublicOutputTokens({
    privateTokens: new Set<string>(),
    redactedCanonicalIds: new Set<string>(),
  })
}

/** Build a loaded token set with a known private token. */
function makePrivateTokens(privateNames: string[]): PublicOutputTokens & {loaded: true} {
  return makePublicOutputTokens({
    privateTokens: buildPrivateTokenSet(privateNames),
    redactedCanonicalIds: new Set<string>(),
  })
}

/** Build a loaded token set with a known redacted canonical ID. */
function makeRedactedIdTokens(ids: string[]): PublicOutputTokens & {loaded: true} {
  return makePublicOutputTokens({
    privateTokens: new Set<string>(),
    redactedCanonicalIds: new Set<string>(ids),
  })
}

// ---------------------------------------------------------------------------
// Token loading model
// ---------------------------------------------------------------------------

describe('makePublicOutputTokens / isPublicOutputTokensLoaded', () => {
  it('loaded tokens have loaded:true and expose the token sets', () => {
    const tokens = makePublicOutputTokens({
      privateTokens: new Set(['acme/private-repo']),
      redactedCanonicalIds: new Set(['R_kgDOABC123']),
    })
    expect(tokens.loaded).toBe(true)
    if (tokens.loaded) {
      expect(tokens.privateTokens.has('acme/private-repo')).toBe(true)
      expect(tokens.redactedCanonicalIds.has('R_kgDOABC123')).toBe(true)
    }
  })

  it('failed tokens have loaded:false and isPublicOutputTokensLoaded returns false', () => {
    const tokens: PublicOutputTokens = {loaded: false, error: 'could not read metadata/repos.yaml'}
    expect(tokens.loaded).toBe(false)
    expect(isPublicOutputTokensLoaded(tokens)).toBe(false)
  })

  it('isPublicOutputTokensLoaded narrows to loaded variant', () => {
    const tokens = makeEmptyTokens()
    expect(isPublicOutputTokensLoaded(tokens)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Surface constants
// ---------------------------------------------------------------------------

describe('surface constants', () => {
  it('COUNTS_ONLY_SURFACES contains workflow-summary-row, workflow-run-display-name, workflow-step-summary', () => {
    expect(COUNTS_ONLY_SURFACES).toContain('workflow-summary-row')
    expect(COUNTS_ONLY_SURFACES).toContain('workflow-run-display-name')
    expect(COUNTS_ONLY_SURFACES).toContain('workflow-step-summary')
  })

  it('isCountsOnlySurface returns true for counts-only surfaces and false for others', () => {
    expect(isCountsOnlySurface('workflow-summary-row')).toBe(true)
    expect(isCountsOnlySurface('workflow-run-display-name')).toBe(true)
    expect(isCountsOnlySurface('workflow-step-summary')).toBe(true)
    expect(isCountsOnlySurface('proposal-body')).toBe(false)
    expect(isCountsOnlySurface('pr-title')).toBe(false)
  })

  it('PHASE2_RESERVED_SURFACES contains pr-title, pr-body, pr-commit-message, pr-branch-name, pr-label', () => {
    expect(PHASE2_RESERVED_SURFACES).toContain('pr-title')
    expect(PHASE2_RESERVED_SURFACES).toContain('pr-body')
    expect(PHASE2_RESERVED_SURFACES).toContain('pr-commit-message')
    expect(PHASE2_RESERVED_SURFACES).toContain('pr-branch-name')
    expect(PHASE2_RESERVED_SURFACES).toContain('pr-label')
  })
})

// ---------------------------------------------------------------------------
// Happy path: known-public content passes
// ---------------------------------------------------------------------------

describe('applyPublicOutputGate — happy path', () => {
  it('known-public proposal title passes and returns sanitized content', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'proposal-title',
      content: 'Status drift: PR #42 is closed (was open)',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.sanitizedContent).toBe('Status drift: PR #42 is closed (was open)')
    }
  })

  it('proposal body with fingerprint in content passes (fingerprint allowed in proposal surfaces)', () => {
    const tokens = makeEmptyTokens()
    const fingerprint = 'abcdef0123456789'
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: `<!-- status-truth:fingerprint:${fingerprint} -->\n\nDrift detected.`,
      tokens,
      fingerprint,
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.sanitizedContent).toContain('Drift detected.')
    }
  })

  it('workflow-summary-row passes with counts-only content (no fingerprint parameter)', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'workflow-summary-row',
      content: '| pr-state | 3 | 1 | 2 |',
      tokens,
      fingerprint: undefined,
    })
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Private token and redacted ID blocks
// ---------------------------------------------------------------------------

describe('applyPublicOutputGate — private token block', () => {
  it('private repo token in proposal body blocks output and returns only counter', () => {
    const tokens = makePrivateTokens(['acme/private-repo'])
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: 'The claim references acme/private-repo which is private.',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      // Blocked text must not be returned
      expect('sanitizedContent' in result).toBe(false)
      expect('blockedContent' in result).toBe(false)
    }
  })

  it('private token in wiki-slug form (owner--repo) is also blocked', () => {
    const tokens = makePrivateTokens(['acme/private-repo'])
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: 'See acme--private-repo for details.',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
  })

  it('content referencing a redacted canonical ID is blocked', () => {
    const tokens = makeRedactedIdTokens(['R_kgDOABC123'])
    const result = applyPublicOutputGate({
      surface: 'proposal-title',
      content: 'Drift in R_kgDOABC123 repository',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
    }
  })

  it('canonical ID match is case-sensitive: exact fixture node_id as substring is blocked', () => {
    // The canonical ID 'R_kgDOFIXTURE001' must block content containing it as a substring
    const fixtureId = 'R_kgDOFIXTURE001'
    const tokens = makeRedactedIdTokens([fixtureId])
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: `Repo node_id: ${fixtureId} is referenced here.`,
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
    }
  })

  it('canonical ID match is case-sensitive: different-case variant of fixture node_id is NOT blocked', () => {
    // node_id values have fixed casing; a different-case variant is a different string
    const fixtureId = 'R_kgDOFIXTURE001'
    const tokens = makeRedactedIdTokens([fixtureId])
    // Lowercase variant — must NOT be treated as the same canonical ID
    const differentCase = fixtureId.toLowerCase() // 'r_kgdofixture001'
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: `Ref: ${differentCase} is safe.`,
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    // Case-sensitive: different-case variant must pass
    expect(result.allowed).toBe(true)
  })

  it('canonical ID match is case-sensitive: uppercase variant of lowercase fixture ID is NOT blocked', () => {
    // Fixture ID is lowercase; uppercase variant must not be blocked
    const fixtureId = 'fixture_id_lowercase_001'
    const tokens = makeRedactedIdTokens([fixtureId])
    const upperCase = fixtureId.toUpperCase() // 'FIXTURE_ID_LOWERCASE_001'
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: `Ref: ${upperCase} is safe.`,
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    // Case-sensitive: uppercase variant must pass
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Secret-like content blocks output
// ---------------------------------------------------------------------------

describe('applyPublicOutputGate — secret-like content', () => {
  it('GitHub PAT in proposed correction blocks output', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: 'Correction: use token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
    }
  })

  it('AWS access key in proposal body blocks output', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: 'Key: AKIAIOSFODNN7EXAMPLE is referenced',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
  })

  it('private key block in recurrence comment blocks output', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'recurrence-comment',
      content: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Token loading failure blocks all output
// ---------------------------------------------------------------------------

describe('applyPublicOutputGate — token loading failure', () => {
  it('failed token load blocks output and reports load failure reason', () => {
    const failedTokens: PublicOutputTokens = {
      loaded: false,
      error: 'could not read metadata/repos.yaml',
    }
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: 'Drift detected: PR #42 is closed.',
      tokens: failedTokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      expect(result.blockReason).toMatch(/token.*load|load.*fail/i)
    }
  })

  it('failed token load blocks workflow summary output', () => {
    const failedTokens: PublicOutputTokens = {loaded: false, error: 'parse error'}
    const result = applyPublicOutputGate({
      surface: 'workflow-summary-row',
      content: '| pr-state | 3 | 1 | 2 |',
      tokens: failedTokens,
      fingerprint: undefined,
    })
    expect(result.allowed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fingerprint surface rules
// ---------------------------------------------------------------------------

describe('applyPublicOutputGate — fingerprint surface rules', () => {
  it('fingerprint parameter on workflow-summary-row is blocked (counts-only surface)', () => {
    const tokens = makeEmptyTokens()
    const fingerprint = 'abcdef0123456789'
    const result = applyPublicOutputGate({
      surface: 'workflow-summary-row',
      content: '| pr-state | 3 | 1 |',
      tokens,
      fingerprint,
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockReason).toMatch(/fingerprint|counts.only/i)
    }
  })

  it('fingerprint parameter on workflow-run-display-name is blocked (counts-only surface)', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'workflow-run-display-name',
      content: 'Status truth: 3 findings',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockReason).toMatch(/fingerprint|counts.only/i)
    }
  })

  it('fingerprint parameter on workflow-step-summary is blocked (counts-only surface)', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'workflow-step-summary',
      content: 'Step completed.',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockReason).toMatch(/fingerprint|counts.only/i)
    }
  })

  it('counts-only surface with no fingerprint parameter passes', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'workflow-run-display-name',
      content: 'Status truth: 3 findings, 1 proposal',
      tokens,
      fingerprint: undefined,
    })
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mutation guard: gate is load-bearing
// ---------------------------------------------------------------------------

describe('mutation guard — gate is load-bearing', () => {
  it('private identity in proposal body is blocked by the gate (not passed through)', () => {
    // If the gate were replaced with an identity passthrough, this would return allowed:true
    // and the private name would leak.
    const tokens = makePrivateTokens(['acme/private-repo'])
    const privateContent = 'This proposal references acme/private-repo directly.'

    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: privateContent,
      tokens,
      fingerprint: 'abcdef0123456789',
    })

    expect(result.allowed).toBe(false)

    // Verify the raw privacy check catches it (proving the gate wraps the right function)
    const rawCheck = learningBodyHasPrivateLeak(privateContent, tokens.loaded ? tokens.privateTokens : new Set())
    expect(rawCheck).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Integration: all 12 surfaces use the same gate
// ---------------------------------------------------------------------------

describe('applyPublicOutputGate — integration: all surfaces use one gate', () => {
  const surfaces: PublicOutputSurface[] = [
    'proposal-title',
    'proposal-body',
    'proposal-comment',
    'recurrence-comment',
    'workflow-summary-row',
    'workflow-step-summary',
    'workflow-run-display-name',
    'pr-title',
    'pr-body',
    'pr-commit-message',
    'pr-branch-name',
    'pr-label',
  ]

  it('all 12 surface kinds are recognized by the gate (no unknown-surface error)', () => {
    const tokens = makeEmptyTokens()
    for (const surface of surfaces) {
      const countsOnly = isCountsOnlySurface(surface)
      const content = countsOnly ? '| pr-state | 1 | 0 | 1 |' : 'Safe public content for testing.'
      const fingerprint = countsOnly ? undefined : 'abcdef0123456789'

      const result = applyPublicOutputGate({surface, content, tokens, fingerprint})
      expect(typeof result.allowed).toBe('boolean')
    }
  })

  it('private token blocks ALL surface kinds', () => {
    const tokens = makePrivateTokens(['acme/private-repo'])
    const privateContent = 'acme/private-repo is referenced here'

    for (const surface of surfaces) {
      const countsOnly = isCountsOnlySurface(surface)
      const content = countsOnly ? `| acme/private-repo | 1 |` : privateContent
      const fingerprint = countsOnly ? undefined : 'abcdef0123456789'

      const result = applyPublicOutputGate({surface, content, tokens, fingerprint})
      expect(result.allowed).toBe(false)
    }
  })

  it('secret blocks ALL surface kinds', () => {
    const tokens = makeEmptyTokens()
    const secretContent = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    for (const surface of surfaces) {
      const countsOnly = isCountsOnlySurface(surface)
      const content = countsOnly ? `| ${secretContent} |` : secretContent
      const fingerprint = countsOnly ? undefined : 'abcdef0123456789'

      const result = applyPublicOutputGate({surface, content, tokens, fingerprint})
      expect(result.allowed).toBe(false)
    }
  })

  it('proposal surfaces (title, body, comment, recurrence-comment) all pass with clean public content', () => {
    const tokens = makeEmptyTokens()
    const proposalSurfaces: PublicOutputSurface[] = [
      'proposal-title',
      'proposal-body',
      'proposal-comment',
      'recurrence-comment',
    ]
    for (const surface of proposalSurfaces) {
      const result = applyPublicOutputGate({
        surface,
        content: 'Status drift: PR #42 is closed (was open).',
        tokens,
        fingerprint: 'abcdef0123456789',
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('Phase 2 PR surfaces are gated and pass with clean content', () => {
    const tokens = makeEmptyTokens()
    const prSurfaces: PublicOutputSurface[] = ['pr-title', 'pr-body', 'pr-commit-message', 'pr-branch-name', 'pr-label']
    for (const surface of prSurfaces) {
      const result = applyPublicOutputGate({
        surface,
        content: 'fix: correct PR #42 state in docs/plans/example.md',
        tokens,
        fingerprint: 'abcdef0123456789',
      })
      expect(result.allowed).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Fix #8: MUTATION PROOF — gate adapter is load-bearing for private-token content
// ---------------------------------------------------------------------------

describe('MUTATION PROOF — applyPublicOutputGate blocks private-token content', () => {
  it('content with a private token would be allowed absent the gate but applyPublicOutputGate blocks it', () => {
    // MUTATION PROOF: if applyPublicOutputGate were replaced with an identity passthrough,
    // this test would fail because the private token would leak into the output.
    const privateToken = 'acme/secret-internal-repo'
    const tokens = makePrivateTokens([privateToken])
    const contentWithPrivateToken = `Status drift: PR #42 in ${privateToken} is closed (was open).`

    // Without the gate (identity passthrough), this content would be returned as-is.
    // The gate must block it.
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: contentWithPrivateToken,
      tokens,
      fingerprint: 'abcdef0123456789',
    })

    // Gate blocks the content — private token must not appear in any output field
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      // No sanitizedContent or blockedContent fields (private token must not leak)
      expect('sanitizedContent' in result).toBe(false)
      expect('blockedContent' in result).toBe(false)
    }

    // Verify the raw privacy check confirms the content is private
    // (proving the gate wraps the correct underlying check)
    // learningBodyHasPrivateLeak is already imported at the top of this file
    const rawCheck = learningBodyHasPrivateLeak(
      contentWithPrivateToken,
      tokens.loaded ? tokens.privateTokens : new Set(),
    )
    expect(rawCheck).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Type contract: SafePublicOutput discriminated union
// ---------------------------------------------------------------------------

describe('SafePublicOutput type contract', () => {
  it('allowed result has sanitizedContent and no blockedCount', () => {
    const tokens = makeEmptyTokens()
    const result = applyPublicOutputGate({
      surface: 'proposal-title',
      content: 'Safe title',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(typeof result.sanitizedContent).toBe('string')
      expect('blockedCount' in result).toBe(false)
    }
  })

  it('blocked result has blockedCount and blockReason, no sanitizedContent or blockedContent', () => {
    const tokens: PublicOutputTokens = {loaded: false, error: 'test error'}
    const result = applyPublicOutputGate({
      surface: 'proposal-body',
      content: 'Some content',
      tokens,
      fingerprint: 'abcdef0123456789',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.blockedCount).toBe(1)
      expect(typeof result.blockReason).toBe('string')
      expect('sanitizedContent' in result).toBe(false)
      expect('blockedContent' in result).toBe(false)
    }
  })
})
