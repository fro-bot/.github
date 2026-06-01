import type {RepoEntry} from './schemas.ts'

import {describe, expect, it, vi} from 'vitest'
import {
  buildPublicSlugMap,
  buildPublicSlugs,
  detectPrivateWikiLeaks,
  loadWikiFilenames,
  loadWikiPages,
  requireGrandfatherDir,
  type WikiPageSnapshot,
} from './check-wiki-private-presence.ts'
import {computeRepoSlug} from './wiki-slug.ts'

// Hoisted mocks — vitest transforms these to the top of the module at compile time,
// so they take effect before any imports regardless of source order.
const {mockReaddir, mockReadFile} = vi.hoisted(() => {
  return {
    mockReaddir: vi.fn(),
    mockReadFile: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  readdir: mockReaddir,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal WikiPageSnapshot for tests — content defaults to empty string. */
function page(filename: string, hash: string, content = ''): WikiPageSnapshot {
  const stem = filename.replace(/\.md$/i, '').toLowerCase()
  return {filename, stem, hash, content}
}

// ---------------------------------------------------------------------------
// detectPrivateWikiLeaks
// ---------------------------------------------------------------------------

describe('detectPrivateWikiLeaks', () => {
  describe('happy path — no leaks', () => {
    it('returns empty array when all data pages are in publicSlugMap (with attribution)', () => {
      // #given data pages whose stems are all in publicSlugMap with correct attribution URLs
      // #when detection runs
      // #then no leaks are reported
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [
          page('marcusrbrown--poly.md', 'hash1', 'url: https://github.com/marcusrbrown/poly'),
          page('some-org--some-repo.md', 'hash2', 'url: https://github.com/some-org/some-repo'),
        ],
        publicSlugMap: new Map([
          ['marcusrbrown--poly', [{owner: 'marcusrbrown', name: 'poly', private: false} as unknown as RepoEntry]],
          ['some-org--some-repo', [{owner: 'some-org', name: 'some-repo', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('returns empty array when data pages are empty', () => {
      // #given no data wiki pages at all
      // #when detection runs
      // #then no leaks are reported
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [],
        publicSlugMap: new Map([
          ['some-org--public', [{owner: 'some-org', name: 'public', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('returns empty array when a redacted private entry exists but no corresponding data page', () => {
      // #given a private entry's slug is not in publicSlugMap and no corresponding wiki file
      // #when detection runs
      // #then no leak is reported (no page = no exposure)
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('some-org--public.md', 'h1', 'url: https://github.com/some-org/public')],
        publicSlugMap: new Map([
          ['some-org--public', [{owner: 'some-org', name: 'public', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })
  })

  describe('Fix #2 — content-hash grandfathering (the core fix)', () => {
    it('passes: unchanged grandfathered absent-private page (the copiloting case)', () => {
      // #given a page with no publicSlugMap entry (absent private, e.g. lost-access)
      //        whose content-hash equals the corresponding page on main
      // #when detection runs
      // #then NO leak — content is identical to what is already on main
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('marcusrbrown--copiloting.md', 'same-hash', '# copiloting content')],
        publicSlugMap: new Map(), // not in public set
        grandfatherPages: [page('marcusrbrown--copiloting.md', 'same-hash', '# copiloting content')],
      })
      expect(result).toEqual([])
    })

    it('blocks: modified grandfathered page whose entry is NOT private===false', () => {
      // #given a page that exists on main (grandfathered) but its data-branch version has changed
      //        AND the entry is NOT private===false (absent/private)
      // #when detection runs
      // #then BLOCKED — modified content without public attribution is a leak
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('marcusrbrown--copiloting.md', 'new-hash', '# updated content')],
        publicSlugMap: new Map(), // not public
        grandfatherPages: [page('marcusrbrown--copiloting.md', 'old-hash', '# original content')],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'marcusrbrown--copiloting.md', reason: 'unattributable-page'})
    })

    it('passes: modified grandfathered page whose entry IS private===false (public repo)', () => {
      // #given a page that exists on main AND in publicSlugMap (private===false)
      //        even though its hash has changed (content was updated)
      // #when detection runs
      // #then passes — it is a public repo, attribution URL present
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'new-hash', 'url: https://github.com/acme/widget updated content')],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [page('acme--widget.md', 'old-hash', 'old content')],
      })
      expect(result).toEqual([])
    })

    it('blocks: new page not in publicSlugMap and not grandfathered at all', () => {
      // #given a brand-new data page with no matching public entry and no grandfather
      // #when detection runs
      // #then BLOCKED — unattributable
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--secret.md', 'h1', 'private content')],
        publicSlugMap: new Map(),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--secret.md', reason: 'unattributable-page'})
    })
  })

  describe('Fix #1 — collision detection (ambiguous-public-slug)', () => {
    it('blocks: stem maps to 2+ public entries (ambiguous slug)', () => {
      // #given two public repos that sanitize to the same slug
      //        e.g. "acme/foo-bar" and "acme/foo_bar" both → "acme--foo-bar"
      // #when detection runs
      // #then BLOCKED with ambiguous-public-slug (fail closed)
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--foo-bar.md', 'h1', 'url: https://github.com/acme/foo-bar')],
        publicSlugMap: new Map([
          [
            'acme--foo-bar',
            [
              {owner: 'acme', name: 'foo-bar', private: false} as unknown as RepoEntry,
              {owner: 'acme', name: 'foo_bar', private: false} as unknown as RepoEntry,
            ],
          ],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--foo-bar.md', reason: 'ambiguous-public-slug'})
    })

    it('passes: stem maps to exactly 1 public entry (unambiguous)', () => {
      // #given a page whose stem resolves to a single public entry
      // #when detection runs
      // #then passes (unambiguous, attribution satisfied)
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', 'url: https://github.com/acme/widget')],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })
  })

  describe('Fix #1 — attribution check (content must reference the public repo)', () => {
    it('passes: page content contains expected GitHub URL for the matched public entry', () => {
      // #given a page in publicSlugMap whose content references the expected URL
      // #when detection runs
      // #then passes
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [
          page(
            'marcusrbrown--dotfiles.md',
            'h1',
            '---\ntitle: "marcusrbrown/.dotfiles"\nsources:\n  - url: https://github.com/marcusrbrown/.dotfiles\n---',
          ),
        ],
        publicSlugMap: new Map([
          [
            'marcusrbrown--dotfiles',
            [{owner: 'marcusrbrown', name: '.dotfiles', private: false} as unknown as RepoEntry],
          ],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('blocks: page content does NOT contain expected GitHub URL (wrong repo frontmatter)', () => {
      // #given a page whose stem matches a public slug but content references a DIFFERENT repo
      //        (slug collision via content spoofing)
      // #when detection runs
      // #then BLOCKED — content attribution fails
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [
          page(
            'acme--widget.md',
            'h1',
            '---\ntitle: "acme/other-thing"\nsources:\n  - url: https://github.com/acme/other-thing\n---',
          ),
        ],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
    })
  })

  describe('slug sanitization (P0) — computeRepoSlug required', () => {
    it('does NOT leak when publicSlugMap is built from computeRepoSlug for dotfiles entry', () => {
      // #given entry {owner:'marcusrbrown', name:'.dotfiles', private:false}
      // computeRepoSlug sanitizes the leading dot: .dotfiles → dotfiles
      // so the slug is 'marcusrbrown--dotfiles', matching the page stem
      const slug = computeRepoSlug('marcusrbrown', '.dotfiles')
      expect(slug).toBe('marcusrbrown--dotfiles')

      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('marcusrbrown--dotfiles.md', 'h1', 'url: https://github.com/marcusrbrown/.dotfiles')],
        publicSlugMap: new Map([
          [slug, [{owner: 'marcusrbrown', name: '.dotfiles', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })
  })

  describe('grandfather (P0) — pages already on main are safe when unchanged', () => {
    it('does NOT flag marcusrbrown--copiloting.md when hash matches grandfather', () => {
      // #given a page that is on main (grandfathered) with ABSENT private field
      // #when detection runs with same hash
      // #then NO leak — content-identical to what is already public on main
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('marcusrbrown--copiloting.md', 'copiloting-hash', '# content')],
        publicSlugMap: new Map(),
        grandfatherPages: [page('marcusrbrown--copiloting.md', 'copiloting-hash', '# content')],
      })
      expect(result).toEqual([])
    })

    it('DOES flag marcusrbrown--copiloting.md when grandfatherPages is EMPTY', () => {
      // #given the same page but no grandfathering at all
      // #when detection runs without grandfather pages
      // #then flagged — grandfathering is what saves it
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('marcusrbrown--copiloting.md', 'h1', 'content')],
        publicSlugMap: new Map(),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'marcusrbrown--copiloting.md', reason: 'unattributable-page'})
    })

    it('DOES flag marcusrbrown--copiloting.md when hash differs from grandfather', () => {
      // #given a grandfathered page whose content was modified on the data branch
      // #when detection runs
      // #then flagged — content-identity grandfathering blocks modified private pages
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('marcusrbrown--copiloting.md', 'new-hash', 'modified content')],
        publicSlugMap: new Map(),
        grandfatherPages: [page('marcusrbrown--copiloting.md', 'old-hash', 'original content')],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'marcusrbrown--copiloting.md', reason: 'unattributable-page'})
    })
  })

  describe('new private page — flagged as leak', () => {
    it('flags a page whose stem is in neither publicSlugMap nor grandfatherPages', () => {
      // #given a data page for a private entry, not in either set
      // #when detection runs
      // #then flagged with reason unattributable-page
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--secret-repo.md', 'h1', 'secret content')],
        publicSlugMap: new Map([
          ['acme--public-repo', [{owner: 'acme', name: 'public-repo', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [page('other--old-page.md', 'h2', 'other content')],
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
        dataWikiPages: [page('deleted-org--deleted-repo.md', 'h1', 'content')],
        publicSlugMap: new Map(),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'deleted-org--deleted-repo.md', reason: 'unattributable-page'})
    })
  })

  describe('fail-safe predicate — private === false, NOT private !== true', () => {
    it('flags a page whose entry has ABSENT private field and is not grandfathered', () => {
      // #given an entry with absent private (legacy/unprobed)
      // Under the correct predicate (=== false), absent private is NOT in publicSlugMap → page gets flagged
      // Under wrong predicate (!== true), absent private WOULD be wrongly admitted → leak slips through

      // buildPublicSlugMap with absent-private entry produces empty map
      const resultWithAbsentPrivate = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--mystery.md', 'h1', 'content')],
        publicSlugMap: new Map(), // absent private correctly excluded
        grandfatherPages: [],
      })
      expect(resultWithAbsentPrivate).toHaveLength(1)
      expect(resultWithAbsentPrivate[0]).toMatchObject({reason: 'unattributable-page'})
    })
  })

  describe('node_id-named page — flagged', () => {
    it('flags a page whose stem is a node_id (R_kgDO…) not in either set', () => {
      // #given a data page named after a node_id (legacy naming or defensive case)
      // #when detection runs
      // #then flagged — node_id-named pages are not in publicSlugMap or grandfatherPages
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('R_kgDOABCDEF.md', 'h1', 'content')],
        publicSlugMap: new Map(),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'R_kgDOABCDEF.md', reason: 'unattributable-page'})
    })
  })

  describe('case-insensitive stem matching', () => {
    it('matches case-insensitively (MarcusRBrown--Poly.md stem lowercased to match publicSlugMap)', () => {
      // #given a wiki filename with mixed case
      // #when detection runs
      // #then matched case-insensitively against publicSlugMap
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('MarcusRBrown--Poly.md', 'h1', 'url: https://github.com/marcusrbrown/poly')],
        publicSlugMap: new Map([
          ['marcusrbrown--poly', [{owner: 'marcusrbrown', name: 'poly', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })
  })

  describe('multiple pages — partial leaks', () => {
    it('flags only pages not covered by publicSlugMap or unchanged grandfatherPages', () => {
      // #given a mix of public (with attribution), grandfathered-unchanged, and new-private pages
      // #when detection runs
      // #then only uncovered pages are flagged
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [
          page('acme--public.md', 'h1', 'url: https://github.com/acme/public'), // in publicSlugMap, attribution ok
          page('marcusrbrown--copiloting.md', 'same-hash', '# copiloting'), // unchanged grandfather
          page('acme--secret.md', 'h3', 'private content'), // neither → leak
        ],
        publicSlugMap: new Map([
          ['acme--public', [{owner: 'acme', name: 'public', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [page('marcusrbrown--copiloting.md', 'same-hash', '# copiloting')],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--secret.md', reason: 'unattributable-page'})
    })
  })
})

// ---------------------------------------------------------------------------
// loadWikiPages
// ---------------------------------------------------------------------------

describe('loadWikiPages', () => {
  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // #given the wiki repos directory does not exist
    // #when loadWikiPages is called
    // #then it returns [] gracefully (fresh checkout, no wiki yet)
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toEqual([])
  })

  it('propagates non-ENOENT errors from readdir (fail-closed)', async () => {
    // #given readdir throws a permission error (not ENOENT)
    // #when loadWikiPages is called
    // #then the error propagates — do not silently swallow FS errors
    const eperm = Object.assign(new Error('EPERM: operation not permitted'), {code: 'EPERM'})
    mockReaddir.mockRejectedValue(eperm)
    await expect(loadWikiPages('knowledge/wiki/repos')).rejects.toThrow(/EPERM/)
  })

  it('propagates non-ENOENT errors from readFile (fail-closed)', async () => {
    // #given readdir succeeds but readFile throws a permission error
    // #when loadWikiPages is called
    // #then the error propagates
    mockReaddir.mockResolvedValue(['foo.md'])
    const eperm = Object.assign(new Error('EPERM: cannot read file'), {code: 'EPERM'})
    mockReadFile.mockRejectedValue(eperm)
    await expect(loadWikiPages('knowledge/wiki/repos')).rejects.toThrow(/EPERM/)
  })

  it('returns WikiPageSnapshot records with correct fields', async () => {
    // #given two .md files in the directory
    // #when loadWikiPages is called
    // #then returns snapshots with filename, stem, hash, content
    mockReaddir.mockResolvedValue(['acme--widget.md', 'other.txt', '.gitkeep'])
    mockReadFile.mockResolvedValue('url: https://github.com/acme/widget\n')
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toHaveLength(1)
    expect(result[0]?.filename).toBe('acme--widget.md')
    expect(result[0]?.stem).toBe('acme--widget')
    expect(result[0]?.content).toBe('url: https://github.com/acme/widget\n')
    // hash must be a 64-char hex string (SHA-256)
    expect(result[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same hash for identical content (deterministic)', async () => {
    // #given two pages with identical content
    // #when loadWikiPages is called
    // #then both snapshots have the same hash
    mockReaddir.mockResolvedValue(['page-a.md', 'page-b.md'])
    mockReadFile.mockResolvedValue('same content')
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toHaveLength(2)
    expect(result[0]?.hash).toBe(result[1]?.hash)
  })

  it('produces different hashes for different content', async () => {
    // #given two pages with different content
    // #when loadWikiPages is called
    // #then hashes differ
    mockReaddir.mockResolvedValue(['page-a.md', 'page-b.md'])
    mockReadFile.mockResolvedValueOnce('content A').mockResolvedValueOnce('content B')
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toHaveLength(2)
    expect(result[0]?.hash).not.toBe(result[1]?.hash)
  })

  it('passes the joined dir+filename path to readFile', async () => {
    // #given a custom directory path
    // #when loadWikiPages is called with that path
    // #then readFile is called with the joined path
    mockReaddir.mockResolvedValue(['foo--bar.md'])
    mockReadFile.mockResolvedValue('content')
    await loadWikiPages('/some/custom/dir')
    expect(mockReadFile).toHaveBeenCalledWith('/some/custom/dir/foo--bar.md', 'utf8')
  })
})

// ---------------------------------------------------------------------------
// loadWikiFilenames (kept for backward compatibility)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildPublicSlugMap
// ---------------------------------------------------------------------------

describe('buildPublicSlugMap', () => {
  it('returns empty map when no entries have private: false', () => {
    const result = buildPublicSlugMap([
      {owner: 'acme', name: 'secret', private: true} as unknown as RepoEntry,
      {owner: 'acme', name: 'mystery'} as unknown as RepoEntry, // absent private
    ])
    expect(result.size).toBe(0)
  })

  it('includes entries with private: false using computeRepoSlug', () => {
    const result = buildPublicSlugMap([
      {owner: 'marcusrbrown', name: '.dotfiles', private: false} as unknown as RepoEntry,
    ])
    expect(result.has('marcusrbrown--dotfiles')).toBe(true)
    expect(result.get('marcusrbrown--dotfiles')).toHaveLength(1)
  })

  it('groups multiple public entries under the same slug (collision detection)', () => {
    // Two repos that sanitize to the same slug
    const result = buildPublicSlugMap([
      {owner: 'acme', name: 'foo-bar', private: false} as unknown as RepoEntry,
      {owner: 'acme', name: 'foo_bar', private: false} as unknown as RepoEntry,
    ])
    expect(result.get('acme--foo-bar')).toHaveLength(2)
  })

  it('keeps distinct slugs separate', () => {
    const result = buildPublicSlugMap([
      {owner: 'acme', name: 'alpha', private: false} as unknown as RepoEntry,
      {owner: 'acme', name: 'beta', private: false} as unknown as RepoEntry,
    ])
    expect(result.size).toBe(2)
    expect(result.get('acme--alpha')).toHaveLength(1)
    expect(result.get('acme--beta')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// buildPublicSlugs (Fix #4 — load-bearing predicate end-to-end)
// ---------------------------------------------------------------------------

describe('buildPublicSlugs (Fix #4 — load-bearing predicate end-to-end)', () => {
  it('excludes entry with ABSENT private field (private !== true would wrongly include it)', () => {
    // #given entry {owner:'acme', name:'mystery'} with NO private field
    // Under private === false: absent is NOT admitted (fail-safe)
    // Under private !== true: absent WOULD be admitted (bug)
    const result = buildPublicSlugs([
      {
        owner: 'acme',
        name: 'mystery',
        // private is absent (undefined)
        added: '2025-01-01',
        onboarding_status: 'pending',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ])

    const slug = computeRepoSlug('acme', 'mystery')
    // Fail-safe: absent private must NOT be admitted
    expect(result.has(slug)).toBe(false)
  })

  it('includes entry with private: false and uses computeRepoSlug (not raw join)', () => {
    // #given entry {owner:'marcusrbrown', name:'.dotfiles', private:false}
    // computeRepoSlug sanitizes '.dotfiles' → 'dotfiles'
    // so the slug is 'marcusrbrown--dotfiles', NOT 'marcusrbrown--.dotfiles'
    const result = buildPublicSlugs([
      {
        owner: 'marcusrbrown',
        name: '.dotfiles',
        private: false,
        added: '2025-01-01',
        onboarding_status: 'pending',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ])

    // computeRepoSlug-based slug IS in the set
    expect(result.has('marcusrbrown--dotfiles')).toBe(true)

    // Raw owner--name join is NOT in the set (proving computeRepoSlug is used)
    expect(result.has('marcusrbrown--.dotfiles')).toBe(false)
  })

  it('excludes entry with private: true', () => {
    // #given a private repo entry
    // #when buildPublicSlugs runs
    // #then the slug is NOT in the result
    const result = buildPublicSlugs([
      {
        owner: 'acme',
        name: 'secret',
        private: true,
        added: '2025-01-01',
        onboarding_status: 'pending',
        last_survey_at: null,
        last_survey_status: null,
        has_fro_bot_workflow: false,
        has_renovate: false,
      },
    ])

    expect(result.has(computeRepoSlug('acme', 'secret'))).toBe(false)
    expect(result.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// requireGrandfatherDir (Fix #6 — fail-closed missing-env branch)
// ---------------------------------------------------------------------------

describe('requireGrandfatherDir (Fix #6 — fail-closed missing-env branch)', () => {
  it('throws when env is undefined', () => {
    // #given GRANDFATHER_WIKI_REPOS_DIR is not set
    expect(() => requireGrandfatherDir(undefined)).toThrow(/GRANDFATHER_WIKI_REPOS_DIR/)
  })

  it('throws when env is blank (empty string)', () => {
    // #given GRANDFATHER_WIKI_REPOS_DIR is set to an empty string
    expect(() => requireGrandfatherDir('')).toThrow(/GRANDFATHER_WIKI_REPOS_DIR/)
  })

  it('throws when env is whitespace-only', () => {
    // #given GRANDFATHER_WIKI_REPOS_DIR is set to only spaces
    expect(() => requireGrandfatherDir('   ')).toThrow(/GRANDFATHER_WIKI_REPOS_DIR/)
  })

  it('returns the trimmed dir when env is valid', () => {
    // #given a valid path (possibly with surrounding whitespace)
    const result = requireGrandfatherDir('  /path/to/main-wiki  ')
    expect(result).toBe('/path/to/main-wiki')
  })

  it('returns the dir as-is when no trimming needed', () => {
    // #given a clean path string
    const result = requireGrandfatherDir('/workspace/main/knowledge/wiki/repos')
    expect(result).toBe('/workspace/main/knowledge/wiki/repos')
  })
})
