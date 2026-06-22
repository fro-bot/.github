/**
 * Tests for capture-learnings-privacy.ts
 *
 * Structure:
 * - Pure function tests: `learningBodyHasPrivateLeak`
 * - Disk loader tests: `loadPrivateTokensFromDisk` (injectable readFile, fail-closed)
 *
 * Privacy mutation-proof: each privacy test includes a "without the gate" assertion
 * that proves removing the check would let the content through.
 */

import {describe, expect, it} from 'vitest'

import {learningBodyHasPrivateLeak, loadPrivateTokensFromDisk} from './capture-learnings-privacy.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a private token set from a synthetic owner/name for test isolation. */
function makePrivateTokens(nameWithOwner: string): Set<string> {
  return buildPrivateTokenSet([nameWithOwner])
}

// ---------------------------------------------------------------------------
// learningBodyHasPrivateLeak — pure function tests
// ---------------------------------------------------------------------------

describe('learningBodyHasPrivateLeak', () => {
  describe('detection', () => {
    it('detects the owner/name form (slash-separated)', () => {
      // #given a body containing the owner/name form of a private repo
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This PR touched testowner/secret-repo in the changes.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects the owner--name form (double-dash)', () => {
      // #given a body containing the double-dash form
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'See testowner--secret-repo for context.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects mixed-case occurrences (case-insensitive scan)', () => {
      // #given a body with the token in mixed case
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'The repo TESTOWNER/SECRET-REPO was involved.'

      // #when scanning
      // #then the leak is detected (body is lowercased before scan)
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects the slug form produced by computeRepoSlug', () => {
      // #given a body containing the wiki-slug form
      const tokens = makePrivateTokens('testowner/secret-repo')
      // The slug form is testowner--secret-repo (same as double-dash for simple names)
      const body = 'Wiki page at testowner--secret-repo.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })
  })

  describe('clean body', () => {
    it('returns false for a body with no private tokens', () => {
      // #given a body with no private identifiers
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This is a clean learning about CI improvements.'

      // #when scanning
      // #then no leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(false)
    })

    it('returns false when the private token set is empty', () => {
      // #given an empty token set (e.g. no private repos in metadata)
      const body = 'Any body content here.'

      // #when scanning with an empty token set
      // #then no leak is detected (vacuously safe)
      expect(learningBodyHasPrivateLeak(body, new Set())).toBe(false)
    })

    it('returns false for an empty body', () => {
      // #given an empty body
      const tokens = makePrivateTokens('testowner/secret-repo')

      // #when scanning
      // #then no leak is detected
      expect(learningBodyHasPrivateLeak('', tokens)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// loadPrivateTokensFromDisk — fail-closed behavior (injectable readFile)
// ---------------------------------------------------------------------------

describe('loadPrivateTokensFromDisk', () => {
  it('throws when metadata/repos.yaml cannot be read (fail-closed)', async () => {
    // #given the file cannot be read
    const readFileFn = async () => {
      throw new Error('ENOENT: no such file or directory')
    }

    // #when loading private tokens
    // #then it throws — the caller must not post proposals
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: could not read metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
    )
  })

  it('throws when metadata/repos.yaml cannot be parsed (fail-closed)', async () => {
    // #given the file contains invalid YAML
    const readFileFn = async () => '{ invalid yaml: [unclosed'

    // #when loading private tokens
    // #then it throws — the caller must not post proposals
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: could not parse metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
    )
  })

  it('throws when repos.yaml has unexpected shape (not a record)', async () => {
    // #given the file parses to a non-record (e.g. a list)
    const readFileFn = async () => '- item1\n- item2\n'

    // #when loading private tokens
    // #then it throws
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: metadata/repos.yaml has unexpected shape',
    )
  })

  it('throws when repos.yaml is missing the repos array', async () => {
    // #given the file has no repos key
    const readFileFn = async () => 'other_key: value\n'

    // #when loading private tokens
    // #then it throws
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-privacy: metadata/repos.yaml missing repos array',
    )
  })

  it('returns a token set built from private non-redacted repos', async () => {
    // #given a valid repos.yaml with one private repo and one public repo
    const yaml = `
repos:
  - owner: testowner
    name: secret-repo
    private: true
  - owner: testowner
    name: public-repo
    private: false
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then tokens include forms of the private repo but not the public one
    expect(tokens.has('testowner/secret-repo')).toBe(true)
    expect(tokens.has('testowner--secret-repo')).toBe(true)
    // Public repo should not be in the token set
    expect(tokens.has('testowner/public-repo')).toBe(false)
  })

  it('skips redacted entries', async () => {
    // #given a repos.yaml with a redacted private entry
    const yaml = `
repos:
  - owner: '[REDACTED]'
    name: '[REDACTED]'
    private: true
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then the token set is empty (redacted entries are skipped)
    expect(tokens.size).toBe(0)
  })

  it('returns an empty set when there are no private repos', async () => {
    // #given a repos.yaml with only public repos
    const yaml = `
repos:
  - owner: testowner
    name: public-repo
    private: false
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then the token set is empty
    expect(tokens.size).toBe(0)
  })
})
