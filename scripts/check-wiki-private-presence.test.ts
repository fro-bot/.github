import {describe, expect, it, vi} from 'vitest'

import {detectPrivateWikiLeaks, loadWikiFilenames} from './check-wiki-private-presence.ts'
import {computeRepoSlug} from './wiki-slug.ts'

// Hoisted mocks — vitest transforms these to the top of the module at compile time,
// so they take effect before any imports regardless of source order.
const {mockReaddir} = vi.hoisted(() => {
  return {
    mockReaddir: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: mockReaddir,
}))

describe('detectPrivateWikiLeaks', () => {
  describe('happy path — no leaks', () => {
    it('returns empty array when all data pages are in publicSlugs', () => {
      // #given data pages whose stems are all in publicSlugs
      // #when detection runs
      // #then no leaks are reported
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['marcusrbrown--poly.md', 'some-org--some-repo.md'],
        publicSlugs: new Set(['marcusrbrown--poly', 'some-org--some-repo']),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toEqual([])
    })

    it('returns empty array when data pages are empty', () => {
      // #given no data wiki pages at all
      // #when detection runs
      // #then no leaks are reported
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: [],
        publicSlugs: new Set(['some-org--public']),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toEqual([])
    })

    it('returns empty array when data page is in grandfatheredSlugs but not publicSlugs', () => {
      // #given a data page whose stem is only in grandfatheredSlugs
      // #when detection runs
      // #then no leak is reported (grandfathering covers it)
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['marcusrbrown--copiloting.md'],
        publicSlugs: new Set(),
        grandfatheredSlugs: new Set(['marcusrbrown--copiloting']),
      })
      expect(result).toEqual([])
    })

    it('returns empty array when a redacted private entry exists but no corresponding data page', () => {
      // #given a private entry's slug is not in publicSlugs and no corresponding wiki file
      // #when detection runs
      // #then no leak is reported (no page = no exposure)
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['some-org--public.md'],
        publicSlugs: new Set(['some-org--public']),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toEqual([])
    })
  })

  describe('slug sanitization (P0) — computeRepoSlug required', () => {
    it('does NOT leak when publicSlugs is built from computeRepoSlug for dotfiles entry', () => {
      // #given entry {owner:'marcusrbrown', name:'.dotfiles', private:false}
      // computeRepoSlug sanitizes the leading dot: .dotfiles → dotfiles
      // so the slug is 'marcusrbrown--dotfiles', matching the page stem
      const slug = computeRepoSlug('marcusrbrown', '.dotfiles')
      expect(slug).toBe('marcusrbrown--dotfiles')

      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['marcusrbrown--dotfiles.md'],
        publicSlugs: new Set([slug]),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toEqual([])

      // Demonstrate why raw owner--name join would FAIL to admit the page:
      // 'marcusrbrown--.dotfiles' !== 'marcusrbrown--dotfiles'
      const rawJoin = 'marcusrbrown--.dotfiles'
      expect(rawJoin).not.toBe(slug)
      const resultWithRawJoin = detectPrivateWikiLeaks({
        dataWikiFilenames: ['marcusrbrown--dotfiles.md'],
        publicSlugs: new Set([rawJoin]),
        grandfatheredSlugs: new Set(),
      })
      // Raw join does NOT match the actual page → wrongly flagged as leak
      expect(resultWithRawJoin).toHaveLength(1)
      expect(resultWithRawJoin[0]).toMatchObject({reason: 'unattributable-page'})
    })
  })

  describe('grandfather (P0) — pages already on main are safe', () => {
    it('does NOT flag marcusrbrown--copiloting.md when it is in grandfatheredSlugs', () => {
      // #given a page that is on main (grandfathered) but has ABSENT private field (not in publicSlugs)
      // #when detection runs with grandfathering
      // #then NO leak — already public, already on main
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['marcusrbrown--copiloting.md'],
        publicSlugs: new Set(),
        grandfatheredSlugs: new Set(['marcusrbrown--copiloting']),
      })
      expect(result).toEqual([])
    })

    it('DOES flag marcusrbrown--copiloting.md when grandfatheredSlugs is EMPTY', () => {
      // #given the same page but no grandfathering
      // #when detection runs without grandfathering
      // #then flagged — grandfathering is what saves it
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['marcusrbrown--copiloting.md'],
        publicSlugs: new Set(),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'marcusrbrown--copiloting.md', reason: 'unattributable-page'})
    })
  })

  describe('new private page — flagged as leak', () => {
    it('flags a page whose stem is in neither publicSlugs nor grandfatheredSlugs', () => {
      // #given a data page for a private entry, not in either set
      // #when detection runs
      // #then flagged with reason unattributable-page
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['acme--secret-repo.md'],
        publicSlugs: new Set(['acme--public-repo']),
        grandfatheredSlugs: new Set(['other--old-page']),
      })
      expect(result).toHaveLength(1)
      expect(result).toContainEqual({filename: 'acme--secret-repo.md', reason: 'unattributable-page'})
    })
  })

  describe('node-null tolerance — no GraphQL call required', () => {
    it('flags a page for a deleted repo (no public entry, not grandfathered) — pure function, no gh call', () => {
      // #given a page whose repo is deleted (would have been node-null under old GraphQL approach)
      // #when detection runs (detectPrivateWikiLeaks is PURE — no subprocess, no gh)
      // #then flagged as unattributable-page (not in public set, not grandfathered)
      // This test exercises the pure function directly — no mock needed, proving no GraphQL call is made.
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['deleted-org--deleted-repo.md'],
        publicSlugs: new Set(),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'deleted-org--deleted-repo.md', reason: 'unattributable-page'})
    })
  })

  describe('fail-safe predicate — private === false, NOT private !== true', () => {
    it('flags a page whose entry has ABSENT private field and is not grandfathered', () => {
      // #given an entry with absent private (legacy/unprobed)
      // Under the correct predicate (=== false), absent private is NOT in publicSlugs → page gets flagged
      // Under wrong predicate (!== true), absent private WOULD be wrongly admitted → leak slips through

      // Simulate: entry has owner='acme', name='mystery', private=undefined
      // Correct: only private===false entries go into publicSlugs
      const entryPrivate = undefined // absent — legacy
      const entrySlug = computeRepoSlug('acme', 'mystery')

      // Correct publicSlugs does NOT include this slug (private !== false)
      const publicSlugsCorrect = new Set<string>(entryPrivate === false ? [entrySlug] : [])
      expect(publicSlugsCorrect.has(entrySlug)).toBe(false)

      // Wrong publicSlugs WOULD include it (private !== true = wrongly admits absent)
      const publicSlugsWrong = new Set<string>(entryPrivate === true ? [] : [entrySlug])
      expect(publicSlugsWrong.has(entrySlug)).toBe(true)

      // With correct predicate: flagged
      const resultCorrect = detectPrivateWikiLeaks({
        dataWikiFilenames: ['acme--mystery.md'],
        publicSlugs: publicSlugsCorrect,
        grandfatheredSlugs: new Set(),
      })
      expect(resultCorrect).toHaveLength(1)
      expect(resultCorrect[0]).toMatchObject({reason: 'unattributable-page'})

      // With wrong predicate: NOT flagged — demonstrating the fail-safe inversion bug
      const resultWrong = detectPrivateWikiLeaks({
        dataWikiFilenames: ['acme--mystery.md'],
        publicSlugs: publicSlugsWrong,
        grandfatheredSlugs: new Set(),
      })
      expect(resultWrong).toHaveLength(0) // wrong predicate silently admits it
    })
  })

  describe('node_id-named page — flagged', () => {
    it('flags a page whose stem is a node_id (R_kgDO…) not in either set', () => {
      // #given a data page named after a node_id (legacy naming or defensive case)
      // #when detection runs
      // #then flagged — node_id-named pages are not in publicSlugs or grandfatheredSlugs
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['R_kgDOABCDEF.md'],
        publicSlugs: new Set(),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'R_kgDOABCDEF.md', reason: 'unattributable-page'})
    })
  })

  describe('case-insensitive stem matching', () => {
    it('matches case-insensitively (MarcusRBrown--Poly.md stem lowercased to match publicSlugs)', () => {
      // #given a wiki filename with mixed case
      // #when detection runs
      // #then matched case-insensitively against publicSlugs
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: ['MarcusRBrown--Poly.md'],
        publicSlugs: new Set(['marcusrbrown--poly']),
        grandfatheredSlugs: new Set(),
      })
      expect(result).toEqual([])
    })
  })

  describe('multiple pages — partial leaks', () => {
    it('flags only pages not covered by publicSlugs or grandfatheredSlugs', () => {
      // #given a mix of public, grandfathered, and new-private pages
      // #when detection runs
      // #then only uncovered pages are flagged
      const result = detectPrivateWikiLeaks({
        dataWikiFilenames: [
          'acme--public.md', // in publicSlugs
          'marcusrbrown--copiloting.md', // grandfathered
          'acme--secret.md', // neither → leak
        ],
        publicSlugs: new Set(['acme--public']),
        grandfatheredSlugs: new Set(['marcusrbrown--copiloting']),
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--secret.md', reason: 'unattributable-page'})
    })
  })
})

describe('loadWikiFilenames', () => {
  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // #given the wiki repos directory does not exist
    // #when loadWikiFilenames is called
    // #then it returns [] gracefully (fresh checkout, no wiki yet)
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    const result = await loadWikiFilenames('knowledge/wiki/repos')
    expect(result).toEqual([])
  })

  it('propagates non-ENOENT errors (fail-closed)', async () => {
    // #given readdir throws a permission error (not ENOENT)
    // #when loadWikiFilenames is called
    // #then the error propagates — do not silently swallow FS errors
    const eperm = Object.assign(new Error('EPERM: operation not permitted'), {code: 'EPERM'})
    mockReaddir.mockRejectedValue(eperm)
    await expect(loadWikiFilenames('knowledge/wiki/repos')).rejects.toThrow(/EPERM/)
  })

  it('returns only .md files from the directory listing', async () => {
    // #given the directory contains .md and non-.md files
    // #when loadWikiFilenames is called
    // #then only .md filenames are returned
    mockReaddir.mockResolvedValue(['acme--secret.md', 'README.md', '.gitkeep', 'other.txt'])
    const result = await loadWikiFilenames('knowledge/wiki/repos')
    expect(result).toEqual(['acme--secret.md', 'README.md'])
  })

  it('accepts an explicit directory argument (used for grandfather dir)', async () => {
    // #given a custom directory path
    // #when loadWikiFilenames is called with that path
    // #then readdir is called with the given path
    mockReaddir.mockResolvedValue(['foo--bar.md'])
    const result = await loadWikiFilenames('/some/custom/dir')
    expect(mockReaddir).toHaveBeenCalledWith('/some/custom/dir')
    expect(result).toEqual(['foo--bar.md'])
  })
})
