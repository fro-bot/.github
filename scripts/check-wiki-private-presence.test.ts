import {describe, expect, it, vi} from 'vitest'

import {detectPrivateWikiLeaks, loadWikiFilenames, resolveCanonicalSlugs} from './check-wiki-private-presence.ts'

// Hoisted mocks — vitest transforms these to the top of the module at compile time,
// so they take effect before any imports regardless of source order.
const {mockExecFileSync, mockReaddir} = vi.hoisted(() => {
  return {
    mockExecFileSync: vi.fn(),
    mockReaddir: vi.fn(),
  }
})

vi.mock('node:child_process', () => ({execFileSync: mockExecFileSync}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: mockReaddir,
}))

describe('detectPrivateWikiLeaks', () => {
  describe('happy path — no leaks', () => {
    it('returns empty array when privateEntries is empty', () => {
      // #given no private entries at all
      // #when detection runs
      // #then no leaks are reported
      const result = detectPrivateWikiLeaks({
        privateEntries: [],
        wikiRepoFilenames: ['marcusrbrown--poly.md', 'some-org--some-repo.md'],
      })
      expect(result).toEqual([])
    })

    it('returns empty array when no wiki filenames match any private entry', () => {
      // #given private entries whose slugs and node_ids do not appear in wiki filenames
      // #when detection runs
      // #then no leaks are reported
      const result = detectPrivateWikiLeaks({
        privateEntries: [
          {node_id: 'R_kgDOABCDEF', canonicalSlug: 'acme--secret-repo'},
          {node_id: 'R_kgDOXYZ123', canonicalSlug: 'acme--another-private'},
        ],
        wikiRepoFilenames: ['marcusrbrown--poly.md', 'some-org--public-repo.md'],
      })
      expect(result).toEqual([])
    })
  })

  describe('canonical slug matching', () => {
    it('returns a leak when a wiki filename stem matches the canonicalSlug exactly', () => {
      // #given a private entry whose canonicalSlug matches a wiki filename stem
      // #when detection runs
      // #then one leak is returned with reason canonical-slug-match
      const result = detectPrivateWikiLeaks({
        privateEntries: [{node_id: 'R_kgDOABCDEF', canonicalSlug: 'marcusrbrown--poly'}],
        wikiRepoFilenames: ['marcusrbrown--poly.md', 'other-repo.md'],
      })
      expect(result).toEqual([
        {
          filename: 'marcusrbrown--poly.md',
          reason: 'canonical-slug-match',
          node_id: 'R_kgDOABCDEF',
        },
      ])
    })

    it('matches case-insensitively (filename MarcusRBrown--Poly.md matches slug marcusrbrown--poly)', () => {
      // #given a wiki filename with mixed case that matches the lowercase slug
      // #when detection runs
      // #then the leak is detected despite case difference
      const result = detectPrivateWikiLeaks({
        privateEntries: [{node_id: 'R_kgDOABCDEF', canonicalSlug: 'marcusrbrown--poly'}],
        wikiRepoFilenames: ['MarcusRBrown--Poly.md'],
      })
      expect(result).toEqual([
        {
          filename: 'MarcusRBrown--Poly.md',
          reason: 'canonical-slug-match',
          node_id: 'R_kgDOABCDEF',
        },
      ])
    })
  })

  describe('node_id matching (defensive)', () => {
    it('returns a leak when a wiki filename stem matches the node_id', () => {
      // #given a wiki filename whose stem is the node_id (defensive future-proofing)
      // #when detection runs
      // #then one leak is returned with reason node-id-match
      const result = detectPrivateWikiLeaks({
        privateEntries: [{node_id: 'R_kgDOABCDEF'}],
        wikiRepoFilenames: ['R_kgDOABCDEF.md', 'other-repo.md'],
      })
      expect(result).toEqual([
        {
          filename: 'R_kgDOABCDEF.md',
          reason: 'node-id-match',
          node_id: 'R_kgDOABCDEF',
        },
      ])
    })

    it('applies only node_id matching when canonicalSlug is absent (resolution failed)', () => {
      // #given a private entry with no canonicalSlug (GraphQL resolution failed)
      // #when detection runs against wiki files that do not match the node_id
      // #then no leaks are reported (slug matching is skipped)
      const result = detectPrivateWikiLeaks({
        privateEntries: [{node_id: 'R_kgDOABCDEF'}],
        wikiRepoFilenames: ['marcusrbrown--poly.md'],
      })
      expect(result).toEqual([])
    })

    it('detects node_id leak when canonicalSlug is absent and node_id matches', () => {
      // #given a private entry with no canonicalSlug but node_id matches a wiki file
      // #when detection runs
      // #then the node_id-based leak is returned
      const result = detectPrivateWikiLeaks({
        privateEntries: [{node_id: 'R_kgDOABCDEF'}],
        wikiRepoFilenames: ['R_kgDOABCDEF.md'],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({reason: 'node-id-match', node_id: 'R_kgDOABCDEF'})
    })
  })

  describe('both slug and node_id match different files for the same entry', () => {
    it('returns two leaks when both canonicalSlug and node_id match different wiki files', () => {
      // #given a private entry whose slug matches one file and node_id matches another
      // #when detection runs
      // #then two leaks are returned (one per match, no short-circuit)
      const result = detectPrivateWikiLeaks({
        privateEntries: [{node_id: 'R_kgDOABCDEF', canonicalSlug: 'marcusrbrown--poly'}],
        wikiRepoFilenames: ['marcusrbrown--poly.md', 'R_kgDOABCDEF.md'],
      })
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({
        filename: 'marcusrbrown--poly.md',
        reason: 'canonical-slug-match',
        node_id: 'R_kgDOABCDEF',
      })
      expect(result).toContainEqual({
        filename: 'R_kgDOABCDEF.md',
        reason: 'node-id-match',
        node_id: 'R_kgDOABCDEF',
      })
    })
  })

  describe('multiple private entries — partial leaks', () => {
    it('returns leaks only for matching entries when some match and some do not', () => {
      // #given two private entries, only one of which has a matching wiki file
      // #when detection runs
      // #then only the matching entry produces a leak
      const result = detectPrivateWikiLeaks({
        privateEntries: [
          {node_id: 'R_kgDOABCDEF', canonicalSlug: 'acme--secret'},
          {node_id: 'R_kgDOXYZ123', canonicalSlug: 'acme--also-secret'},
        ],
        wikiRepoFilenames: ['acme--secret.md', 'public-repo.md'],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        filename: 'acme--secret.md',
        reason: 'canonical-slug-match',
        node_id: 'R_kgDOABCDEF',
      })
    })

    it('returns all leaks when multiple entries each match a wiki file — asserts per-leak shape', () => {
      // #given two private entries both matching wiki files
      // #when detection runs
      // #then both leaks are returned with correct filename, reason, and node_id (P3 #11 strengthened)
      const result = detectPrivateWikiLeaks({
        privateEntries: [
          {node_id: 'R_kgDOABCDEF', canonicalSlug: 'acme--secret'},
          {node_id: 'R_kgDOXYZ123', canonicalSlug: 'acme--also-secret'},
        ],
        wikiRepoFilenames: ['acme--secret.md', 'acme--also-secret.md'],
      })
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({
        filename: 'acme--secret.md',
        reason: 'canonical-slug-match',
        node_id: 'R_kgDOABCDEF',
      })
      expect(result).toContainEqual({
        filename: 'acme--also-secret.md',
        reason: 'canonical-slug-match',
        node_id: 'R_kgDOXYZ123',
      })
    })
  })
})

describe('resolveCanonicalSlugs', () => {
  it('returns resolved slugs for all entries when GraphQL succeeds', () => {
    // #given GraphQL returns a valid nameWithOwner for each node_id
    // #when resolveCanonicalSlugs is called
    // #then each entry gets its canonicalSlug set
    mockExecFileSync.mockReturnValue(JSON.stringify({data: {node: {nameWithOwner: 'acme/secret'}}}))
    const result = resolveCanonicalSlugs([{node_id: 'R_kgDOABCDEF'}])
    expect(result.resolved).toEqual([{node_id: 'R_kgDOABCDEF', canonicalSlug: 'acme--secret'}])
    expect(result.failures).toEqual([])
  })

  it('throws (fails closed) when GraphQL resolution fails for any entry', () => {
    // #given GraphQL throws for a private entry
    // #when resolveCanonicalSlugs is called
    // #then it throws with the failing node_id listed (fail-closed: P1 #2)
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh: HTTP 401')
    })
    expect(() => resolveCanonicalSlugs([{node_id: 'R_kgDOABCDEF'}])).toThrow(/R_kgDOABCDEF/)
  })

  it('throws listing all failing node_ids when multiple entries fail resolution', () => {
    // #given GraphQL throws for two private entries
    // #when resolveCanonicalSlugs is called
    // #then the error message names both node_ids
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh: HTTP 401')
    })
    expect(() => resolveCanonicalSlugs([{node_id: 'R_kgDOABCDEF'}, {node_id: 'R_kgDOXYZ123'}])).toThrow(
      /R_kgDOABCDEF.*R_kgDOXYZ123|R_kgDOXYZ123.*R_kgDOABCDEF/,
    )
  })
})

describe('loadWikiFilenames', () => {
  it('returns empty array when knowledge/wiki/repos/ does not exist (ENOENT)', async () => {
    // #given the wiki repos directory does not exist
    // #when loadWikiFilenames is called
    // #then it returns [] gracefully (fresh checkout, no wiki yet)
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    const result = await loadWikiFilenames()
    expect(result).toEqual([])
  })

  it('propagates non-ENOENT errors (fail-closed: P1 #3)', async () => {
    // #given readdir throws a permission error (not ENOENT)
    // #when loadWikiFilenames is called
    // #then the error propagates — do not silently swallow FS errors
    const eperm = Object.assign(new Error('EPERM: operation not permitted'), {code: 'EPERM'})
    mockReaddir.mockRejectedValue(eperm)
    await expect(loadWikiFilenames()).rejects.toThrow(/EPERM/)
  })

  it('returns only .md files from the directory listing', async () => {
    // #given the directory contains .md and non-.md files
    // #when loadWikiFilenames is called
    // #then only .md filenames are returned
    mockReaddir.mockResolvedValue(['acme--secret.md', 'README.md', '.gitkeep', 'other.txt'])
    const result = await loadWikiFilenames()
    expect(result).toEqual(['acme--secret.md', 'README.md'])
  })
})
