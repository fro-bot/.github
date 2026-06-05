import type {RepoEntry} from './schemas.ts'

import process from 'node:process'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildPublicSlugMap,
  buildPublicSlugs,
  detectPrivateWikiLeaks,
  findStructuralViolations,
  formatLeakReport,
  formatOperatorReport,
  loadWikiPages,
  requireGrandfatherDir,
  runCli,
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

// Suppress stderr during tests to avoid polluting output with legacy-attribution warnings.
// Individual tests that want to assert on stderr capture it explicitly.
const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

beforeEach(() => {
  vi.clearAllMocks()
  stderrSpy.mockClear()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal WikiPageSnapshot for tests — content defaults to empty string. */
function page(filename: string, hash: string, content = ''): WikiPageSnapshot {
  const stem = filename.replace(/\.md$/i, '').toLowerCase()
  return {filename, stem, hash, content}
}

/**
 * Minimal Dirent stub for the `readdir(dir, {withFileTypes: true})` flat walk.
 * Supports file, dir, and symlink kinds.
 */
function dirent(
  name: string,
  kind: 'file' | 'dir' | 'symlink' = 'file',
): {
  name: string
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
} {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'symlink',
  }
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
          page('marcusrbrown--cart.md', 'hash1', 'url: https://github.com/marcusrbrown/cart'),
          page('some-org--some-repo.md', 'hash2', 'url: https://github.com/some-org/some-repo'),
        ],
        publicSlugMap: new Map([
          ['marcusrbrown--cart', [{owner: 'marcusrbrown', name: 'cart', private: false} as unknown as RepoEntry]],
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

  describe('structured frontmatter attribution', () => {
    it('structured pass: page with matching sources[].url in frontmatter is attributed even without body URL', () => {
      // #given a page whose frontmatter sources list the expected public repo URL
      //        but whose body does NOT contain the raw URL
      // #when detection runs
      // #then passes via structured attribution — body is irrelevant when sources are present
      const content = [
        '---',
        'type: repo',
        'sources:',
        '  - url: https://github.com/owner/name',
        '---',
        'Body text with no raw URL here.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('owner--name.md', 'h1', content)],
        publicSlugMap: new Map([
          ['owner--name', [{owner: 'owner', name: 'name', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('decoy-URL spoof caught: structured sources present but non-matching, body has URL — still flagged', () => {
      // #given a page whose frontmatter sources point to a DIFFERENT repo (non-matching)
      //        but whose body contains the expected public URL as a decoy
      // #when detection runs
      // #then FLAGGED — structured sources are authoritative when present;
      //        body substring is ignored, closing the spoof vector
      const content = [
        '---',
        'type: repo',
        'sources:',
        '  - url: https://github.com/attacker/private-repo',
        '---',
        'Check out https://github.com/acme/widget for more info.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
    })

    it('legacy fallback (no over-block): page with NO sources key in frontmatter — body URL passes via fallback', () => {
      // #given a page with YAML frontmatter that has NO sources key at all
      //        but whose body contains the expected URL
      // #when detection runs
      // #then passes via legacy substring fallback — no sources key means no structured authority
      const content = [
        '---',
        'type: repo',
        'title: "acme/widget"',
        '---',
        'See https://github.com/acme/widget for details.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('legacy fallback (no over-block): page with no frontmatter at all — body URL passes via fallback', () => {
      // #given a page with no YAML frontmatter markers (legacy prose-only page)
      //        whose body contains the expected URL
      // #when detection runs
      // #then passes via legacy substring fallback — exactly as the pre-existing substring check
      const content = 'See https://github.com/acme/widget for details.'
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('unparseable frontmatter with body URL — falls back to substring and passes', () => {
      // #given a page with YAML frontmatter fences but invalid YAML content
      //        and the expected URL appears in the body
      // #when detection runs
      // #then falls back to legacy substring check and passes (no over-block)
      const content = [
        '---',
        ': invalid: yaml: content: [[[',
        '---',
        'See https://github.com/acme/widget for details.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })

    it('negative case: no sources, no URL in body — flagged as before', () => {
      // #given a page with no structured sources and no URL in body
      // #when detection runs
      // #then flagged — both structured and substring checks fail
      const content = 'Nothing useful here.'
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
    })

    it('legacy fallback emits redaction-safe stderr warning — parsed JSON contains only slug, never sensitive names', () => {
      // #given a page that passes via legacy substring fallback (no sources frontmatter)
      //        where 'widget-super-secret' is a sensitive private repo name that must never appear
      // #when detection runs
      // #then a warning is written to stderr as parseable JSON containing ONLY the public slug,
      //        with NO sensitive private name in the output
      const sensitiveName = 'widget-super-secret'
      const content = `See https://github.com/acme/widget for details. Internal name: ${sensitiveName}`
      detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(stderrSpy).toHaveBeenCalled()
      const written = stderrSpy.mock.calls.map(args => String(args[0])).join('')
      // Parse the JSON to assert structure (not just substring presence)
      const line = written.trim().split('\n')[0] ?? ''
      const parsed = JSON.parse(line) as Record<string, unknown>
      // Only allowed keys: level, event, message, slug
      expect(Object.keys(parsed).sort()).toEqual(['event', 'level', 'message', 'slug'])
      // Slug must be the safe public identifier
      expect(parsed.slug).toBe('acme--widget')
      // The sensitive private name must be absent from the entire stderr output
      expect(written).not.toContain(sensitiveName)
      // No raw filename (which would leak the owner--repo identity)
      expect(written).not.toContain('acme--widget.md')
    })
  })

  describe('present-but-empty sources key — authoritative fail-closed (no substring fallback)', () => {
    it('flags: sources key present as empty array, body has decoy URL — no fallback to substring', () => {
      // sources key IS present (empty array) → authoritative → some() is false → flagged
      // Before fix: parseFrontmatterSources returned null → substring fallback → attributed (bug)
      // After fix: returns [] → authoritative → flagged
      const content = [
        '---',
        'type: repo',
        'sources: []',
        '---',
        'See https://github.com/acme/widget for details.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
    })

    it('flags: sources key present as scalar string (malformed), body has decoy URL — authoritative fail-closed', () => {
      // sources key IS present but not an array → authoritative → return [] → flagged
      // Before fix: !Array.isArray → return null → substring fallback → attributed (bug)
      // After fix: present-but-non-array → return [] → flagged
      const content = [
        '---',
        'type: repo',
        'sources: "not-an-array"',
        '---',
        'See https://github.com/acme/widget for details.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
    })

    it('flags: sources key present as null value, body has decoy URL — authoritative fail-closed', () => {
      // sources: null → key is present, value is null → not an array → return [] → flagged
      const content = [
        '---',
        'type: repo',
        'sources: null',
        '---',
        'See https://github.com/acme/widget for details.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
    })

    it('passes: sources key ABSENT (no sources property), body URL → legacy substring fallback (no over-block)', () => {
      // sources key is completely absent from frontmatter → return null → substring fallback → attributed
      // This is the pre-existing legacy case that must keep passing
      const content = [
        '---',
        'type: repo',
        'title: "acme/widget"',
        '---',
        'See https://github.com/acme/widget for details.',
      ].join('\n')
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('acme--widget.md', 'h1', content)],
        publicSlugMap: new Map([
          ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
        ]),
        grandfatherPages: [],
      })
      expect(result).toEqual([])
    })
  })

  describe('case-insensitive stem matching', () => {
    it('matches case-insensitively (MarcusRBrown--Cart.md stem lowercased to match publicSlugMap)', () => {
      // #given a wiki filename with mixed case
      // #when detection runs
      // #then matched case-insensitively against publicSlugMap
      const result = detectPrivateWikiLeaks({
        dataWikiPages: [page('MarcusRBrown--Cart.md', 'h1', 'url: https://github.com/marcusrbrown/cart')],
        publicSlugMap: new Map([
          ['marcusrbrown--cart', [{owner: 'marcusrbrown', name: 'cart', private: false} as unknown as RepoEntry]],
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
// loadWikiPages — flat, regular-files-only
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
    mockReaddir.mockResolvedValue([dirent('foo.md')])
    const eperm = Object.assign(new Error('EPERM: cannot read file'), {code: 'EPERM'})
    mockReadFile.mockRejectedValue(eperm)
    await expect(loadWikiPages('knowledge/wiki/repos')).rejects.toThrow(/EPERM/)
  })

  it('returns WikiPageSnapshot records with correct fields', async () => {
    // #given two .md files in the directory (plus non-md entries to ignore)
    // #when loadWikiPages is called
    // #then returns snapshots with filename, stem, hash, content
    mockReaddir.mockResolvedValue([dirent('acme--widget.md'), dirent('other.txt'), dirent('.gitkeep')])
    mockReadFile.mockResolvedValue('url: https://github.com/acme/widget\n')
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toHaveLength(1)
    expect(result[0]?.filename).toBe('acme--widget.md')
    expect(result[0]?.stem).toBe('acme--widget')
    expect(result[0]?.content).toBe('url: https://github.com/acme/widget\n')
    // hash must be a 64-char hex string (SHA-256)
    expect(result[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores subdirectory entries (flat scan — subdir is a structural violation, not loaded)', async () => {
    // #given a top-level .md file and a subdirectory entry
    // #when loadWikiPages is called (flat scan)
    // #then only the regular .md file is loaded; subdir is silently ignored (flagged by findStructuralViolations)
    mockReaddir.mockResolvedValue([dirent('top--page.md'), dirent('nested', 'dir')])
    mockReadFile.mockResolvedValue('content')
    const result = await loadWikiPages('knowledge/wiki/repos')
    const filenames = result.map(p => p.filename)
    expect(filenames).toEqual(['top--page.md'])
    // readdir called exactly once (no recursion)
    expect(mockReaddir).toHaveBeenCalledTimes(1)
  })

  it('produces the same hash for identical content (deterministic)', async () => {
    // #given two pages with identical content
    // #when loadWikiPages is called
    // #then both snapshots have the same hash
    mockReaddir.mockResolvedValue([dirent('page-a.md'), dirent('page-b.md')])
    mockReadFile.mockResolvedValue('same content')
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toHaveLength(2)
    expect(result[0]?.hash).toBe(result[1]?.hash)
  })

  it('produces different hashes for different content', async () => {
    // #given two pages with different content
    // #when loadWikiPages is called
    // #then hashes differ
    mockReaddir.mockResolvedValue([dirent('page-a.md'), dirent('page-b.md')])
    mockReadFile.mockResolvedValueOnce('content A').mockResolvedValueOnce('content B')
    const result = await loadWikiPages('knowledge/wiki/repos')
    expect(result).toHaveLength(2)
    expect(result[0]?.hash).not.toBe(result[1]?.hash)
  })

  it('passes the joined dir+filename path to readFile', async () => {
    // #given a custom directory path
    // #when loadWikiPages is called with that path
    // #then readFile is called with the joined path
    mockReaddir.mockResolvedValue([dirent('foo--bar.md')])
    mockReadFile.mockResolvedValue('content')
    await loadWikiPages('/some/custom/dir')
    expect(mockReadFile).toHaveBeenCalledWith('/some/custom/dir/foo--bar.md', 'utf8')
  })
})

// ---------------------------------------------------------------------------
// findStructuralViolations — non-regular entries in wiki repos dir
// ---------------------------------------------------------------------------

describe('findStructuralViolations', () => {
  it('returns one leak for a subdirectory entry (nesting is always illegal)', async () => {
    // #given a directory entry in the wiki repos dir
    // #when findStructuralViolations is called
    // #then returns one leak with reason invalid-wiki-structure
    mockReaddir.mockResolvedValue([dirent('acme--secret', 'dir')])
    const result = await findStructuralViolations('knowledge/wiki/repos')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--secret', reason: 'invalid-wiki-structure'})
  })

  it('returns one leak for a symlink .md entry (symlinks are always illegal)', async () => {
    // #given a symlink named like a wiki page
    // #when findStructuralViolations is called
    // #then returns one leak — symlinks fail closed, never attributed
    mockReaddir.mockResolvedValue([dirent('acme--public.md', 'symlink')])
    const result = await findStructuralViolations('knowledge/wiki/repos')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--public.md', reason: 'invalid-wiki-structure'})
  })

  it('returns one leak for a directory named foo.md (dir is a dir even with .md extension)', async () => {
    // #given a directory whose name ends in .md
    // #when findStructuralViolations is called
    // #then returns one leak — it is a directory, not a regular file
    mockReaddir.mockResolvedValue([dirent('foo.md', 'dir')])
    const result = await findStructuralViolations('knowledge/wiki/repos')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'foo.md', reason: 'invalid-wiki-structure'})
  })

  it('does NOT flag regular non-.md files (.gitkeep, README.md)', async () => {
    // #given regular files that are not .md (or are a README)
    // #when findStructuralViolations is called
    // #then returns no leaks — only non-regular entries are violations
    mockReaddir.mockResolvedValue([dirent('.gitkeep', 'file'), dirent('README.md', 'file')])
    const result = await findStructuralViolations('knowledge/wiki/repos')
    expect(result).toEqual([])
  })

  it('returns empty array when all entries are regular .md files (clean flat wiki)', async () => {
    // #given only regular .md files (the expected wiki layout)
    // #when findStructuralViolations is called
    // #then no violations
    mockReaddir.mockResolvedValue([dirent('acme--widget.md'), dirent('marcusrbrown--cart.md')])
    const result = await findStructuralViolations('knowledge/wiki/repos')
    expect(result).toEqual([])
  })

  it('returns empty array when directory does not exist (ENOENT)', async () => {
    // #given the directory does not exist (fresh checkout)
    // #when findStructuralViolations is called
    // #then returns [] gracefully
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    const result = await findStructuralViolations('knowledge/wiki/repos')
    expect(result).toEqual([])
  })

  it('propagates non-ENOENT errors (fail-closed)', async () => {
    // #given readdir throws EPERM
    // #when findStructuralViolations is called
    // #then the error propagates — never fail open on FS errors
    const eperm = Object.assign(new Error('EPERM: operation not permitted'), {code: 'EPERM'})
    mockReaddir.mockRejectedValue(eperm)
    await expect(findStructuralViolations('knowledge/wiki/repos')).rejects.toThrow(/EPERM/)
  })

  it('composes with detectPrivateWikiLeaks: subdir flagged structurally, clean public page passes', async () => {
    // #given a structural violation (subdir) AND a clean public page
    // #when both functions are called and results merged
    // #then structural leak is present; public page does not appear in detectPrivateWikiLeaks results
    mockReaddir.mockResolvedValue([dirent('acme--secret', 'dir'), dirent('acme--public.md')])
    mockReadFile.mockResolvedValue('url: https://github.com/acme/public\n')

    const structuralLeaks = await findStructuralViolations('knowledge/wiki/repos')
    const pages = await loadWikiPages('knowledge/wiki/repos')
    const contentLeaks = detectPrivateWikiLeaks({
      dataWikiPages: pages,
      publicSlugMap: new Map([
        ['acme--public', [{owner: 'acme', name: 'public', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    const allLeaks = [...structuralLeaks, ...contentLeaks]

    expect(structuralLeaks).toHaveLength(1)
    expect(structuralLeaks[0]).toMatchObject({filename: 'acme--secret', reason: 'invalid-wiki-structure'})
    expect(contentLeaks).toEqual([])
    expect(allLeaks).toHaveLength(1)
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
// buildPublicSlugs (load-bearing predicate end-to-end)
// ---------------------------------------------------------------------------

describe('buildPublicSlugs (load-bearing predicate end-to-end)', () => {
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
// formatLeakReport (redaction)
// ---------------------------------------------------------------------------

describe('formatLeakReport (redaction)', () => {
  const twoLeaks = [
    {filename: 'marcusrbrown--cart.md', reason: 'unattributable-page' as const},
    {filename: 'acme--secret.md', reason: 'ambiguous-public-slug' as const},
  ]

  it('emits per-run ephemeral labels (leak-1, leak-2) and each reason', () => {
    // #given two leaks
    // #when formatLeakReport is called
    // #then output contains leak-1 and leak-2 with their respective reason strings
    const report = formatLeakReport(twoLeaks)
    expect(report).toContain('leak-1')
    expect(report).toContain('leak-2')
    expect(report).toContain('unattributable-page')
    expect(report).toContain('ambiguous-public-slug')
  })

  it('contains Leak count: 2 for two leaks', () => {
    // #given two leaks
    // #when formatLeakReport is called
    // #then output contains the count line
    const report = formatLeakReport(twoLeaks)
    expect(report).toContain('Leak count: 2')
  })

  it('references resolve-private.ts for operator resolution', () => {
    // #given any leaks
    // #when formatLeakReport is called
    // #then output points operators to the resolution tool
    const report = formatLeakReport(twoLeaks)
    expect(report).toContain('resolve-private.ts')
  })

  it('NEVER includes any leaked filename or owner--repo substring', () => {
    // #given leaks with owner--repo filenames
    // #when formatLeakReport is called
    // #then NO filename substring appears — public Actions log must not leak identities
    const report = formatLeakReport(twoLeaks)
    expect(report).not.toContain('marcusrbrown--cart')
    expect(report).not.toContain('acme--secret')
    expect(report).not.toContain('.md')
    // Stronger: no owner--repo shape anywhere (e.g. no derivative leakage)
    expect(report).not.toMatch(/[\w.-]+--[\w.-]+/)
    // Additional redaction assertions
    expect(report).not.toContain('marcusrbrown/cart')
    expect(report).not.toContain('https://github.com')
    expect(report).not.toContain('acme/secret')
  })

  it('empty leaks array → Leak count: 0 and no leak- lines', () => {
    // #given no leaks
    // #when formatLeakReport is called
    // #then count is 0 and no per-leak lines appear
    const report = formatLeakReport([])
    expect(report).toContain('Leak count: 0')
    expect(report).not.toMatch(/leak-\d/)
  })
})

// ---------------------------------------------------------------------------
// slug-variant + collision regression
// ---------------------------------------------------------------------------

describe('slug-variant + collision regression', () => {
  it('suffix variant (marcusrbrown--cart.draft) is flagged — only exact slug admitted', () => {
    // #given a page whose stem is 'marcusrbrown--cart.draft' (a .draft suffix variant)
    //        and publicSlugMap has only 'marcusrbrown--cart' (the plain slug, a different entry)
    //        and no grandfather
    // #when detection runs
    // #then BLOCKED — the suffix variant does NOT match the public slug, so unattributable-page
    const publicSlugMap = buildPublicSlugMap([
      {owner: 'marcusrbrown', name: 'cart', private: false} as unknown as RepoEntry,
    ])
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('marcusrbrown--cart.draft.md', 'h1', 'some content')],
      publicSlugMap,
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({reason: 'unattributable-page'})
  })

  it('underscore variant: slug matches but attribution URL absent → blocked (last line of defense against collision)', () => {
    // #given computeRepoSlug('acme', 'foo_bar') === 'acme--foo-bar' (underscore collapses to dash)
    //        so a page 'acme--foo-bar.md' DOES map to the public entry for acme/foo_bar
    //        BUT if the page content does NOT contain https://github.com/acme/foo_bar → blocked
    // This is the sharper collision test: a private acme/foo.bar could also sanitize to
    // acme--foo-bar; the attribution URL check is the last line of defense.
    const publicSlugMap = buildPublicSlugMap([{owner: 'acme', name: 'foo_bar', private: false} as unknown as RepoEntry])
    // Page content references a wrong repo (no acme/foo_bar URL)
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--foo-bar.md', 'h1', 'url: https://github.com/acme/foo-bar')],
      publicSlugMap,
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({reason: 'unattributable-page'})
  })

  it('case variant lowercased by page() helper — without public slug → flagged (casing cannot smuggle past)', () => {
    // #given the page() helper lowercases the stem (matching loadWikiPages behaviour)
    //        so 'MARCUSRBROWN--CART.md' → stem 'marcusrbrown--cart'
    //        and publicSlugMap does NOT contain that slug
    // #when detection runs
    // #then flagged — documents that casing normalization is consistent and cannot bypass the gate
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('MARCUSRBROWN--CART.md', 'h1', 'content')],
      publicSlugMap: new Map(),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({reason: 'unattributable-page'})
  })
})

// ---------------------------------------------------------------------------
// fail-safe regression — private:true cannot smuggle through
// ---------------------------------------------------------------------------

describe('fail-safe regression — private:true cannot smuggle through', () => {
  // BDD comment: PR-tree tamper (flipping private:true→false in a PR) is moot —
  // the gate runs only on schedule/workflow_dispatch reading data's sole-writer-protected
  // repos.yaml, never a PR tree. Residual: a trusted-writer downgrade on data is out of
  // scope for this pure function (tracked as in-progress follow-up hardening).

  it('private:true entry produces empty publicSlugMap; matching page is flagged', () => {
    // #given repos with private:true (which buildPublicSlugMap must exclude)
    // #when buildPublicSlugMap is called
    // #then map is EMPTY — private:true cannot slip into the public set
    const privateRepo: RepoEntry = {
      owner: 'marcusrbrown',
      name: 'cart',
      private: true,
      added: '2025-01-01',
      onboarding_status: 'pending',
      last_survey_at: null,
      last_survey_status: null,
      has_fro_bot_workflow: false,
      has_renovate: false,
    }
    const publicSlugMap = buildPublicSlugMap([privateRepo])
    expect(publicSlugMap.size).toBe(0)

    // #and a data page for that private repo (not grandfathered)
    // #when detectPrivateWikiLeaks runs
    // #then BLOCKED — flipping/holding private:true cannot smuggle the page through
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('marcusrbrown--cart.md', 'h1', 'content')],
      publicSlugMap,
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'marcusrbrown--cart.md', reason: 'unattributable-page'})
  })
})

// ---------------------------------------------------------------------------
// requireGrandfatherDir (fail-closed missing-env branch)
// ---------------------------------------------------------------------------

describe('requireGrandfatherDir (fail-closed missing-env branch)', () => {
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

// ---------------------------------------------------------------------------
// prefix-collision guard — sourceUrlMatchesRepo
// ---------------------------------------------------------------------------

describe('prefix-collision guard — sourceUrlMatchesRepo exact owner/repo matching', () => {
  it('prefix-collision: source url acme/widget-private must NOT attribute page for acme/widget', () => {
    // acme/widget-private is a prefix match for acme/widget under url.includes — must be FLAGGED
    const content = [
      '---',
      'sources:',
      '  - url: https://github.com/acme/widget-private',
      '---',
      'See https://github.com/acme/widget for details (decoy in body, body ignored when sources present).',
    ].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('trailing path: source url with /blob/main/README.md still attributes correctly', () => {
    // Trailing path segments beyond owner/repo are allowed — only owner and repo must match
    const content = [
      '---',
      'sources:',
      '  - url: https://github.com/acme/widget/blob/main/README.md',
      '---',
      'Content without extra URL.',
    ].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toEqual([])
  })

  it('trailing slash: source url https://github.com/acme/widget/ still attributes correctly', () => {
    const content = ['---', 'sources:', '  - url: https://github.com/acme/widget/', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toEqual([])
  })

  it('malformed source URL does not match (treated as no-match, not a crash)', () => {
    const content = ['---', 'sources:', '  - url: not-a-valid-url', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('non-github host does not match (strict github.com only)', () => {
    const content = ['---', 'sources:', '  - url: https://gitlab.com/acme/widget', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('non-https protocol (ftp) does not match — protocol restriction', () => {
    // ftp://github.com/acme/widget should not attribute — only https: is accepted
    const content = ['---', 'sources:', '  - url: ftp://github.com/acme/widget', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('custom port (https://github.com:444/acme/widget) does not match — port restriction', () => {
    // Non-default port rejects the URL to close spoofing vectors
    const content = ['---', 'sources:', '  - url: https://github.com:444/acme/widget', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('standard https://github.com/acme/widget still matches — positive regression guard', () => {
    // Ensure protocol/port restrictions do not break the happy path
    const content = ['---', 'sources:', '  - url: https://github.com/acme/widget', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toEqual([])
  })

  it('case-insensitive owner/repo: mixed-case source url Acme/Widget attributes to acme/widget entry', () => {
    // GitHub owner/repo names are case-insensitive; a source URL with different casing for the
    // same repo must attribute correctly rather than be over-blocked.
    const content = ['---', 'sources:', '  - url: https://github.com/Acme/Widget', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toEqual([])
  })

  it('case-insensitive owner/repo: different repo name (widget-other) still does NOT match acme/widget', () => {
    // Lowercasing both sides must not collapse different repo names — a distinct repo stays flagged.
    const content = ['---', 'sources:', '  - url: https://github.com/acme/widget-other', '---', 'Content.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })
})

// ---------------------------------------------------------------------------
// false-frontmatter guard — anchored frontmatter regex
// ---------------------------------------------------------------------------

describe('false-frontmatter guard — body-embedded block must not be treated as authoritative', () => {
  it('body-embedded wrong-url block does not block a page that has correct URL in plain body text', () => {
    // Content starts with prose (no leading ---), body has an embedded --- block with wrong URL,
    // but also has the expected URL in the leading prose.
    // Before fix (with /m): embedded block parsed as structured sources (wrong URL) → authoritative →
    //   body substring skipped → FLAGGED (over-block)
    // After fix (without /m): no leading frontmatter → null → falls back to substring →
    //   expected URL found in prose → PASSES (correct)
    const content = [
      'See https://github.com/acme/widget for details.',
      '',
      '---',
      'sources:',
      '  - url: https://github.com/some-other/repo',
      '---',
    ].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toEqual([])
  })

  it('real leading frontmatter is still parsed correctly — no regression from removing /m', () => {
    // A page with genuine leading ---...--- frontmatter must still be attributed via structured sources
    const content = [
      '---',
      'sources:',
      '  - url: https://github.com/acme/widget',
      '---',
      'Content without any URL in the body.',
    ].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// empty-sources guard — null when no usable URLs
// ---------------------------------------------------------------------------

describe('present-sources key is authoritative regardless of content — no substring fallback', () => {
  it('sources: [] with body URL → FLAGGED (authoritative empty array, no substring fallback)', () => {
    // sources key IS present as empty array → authoritative → return [] → some() false → flagged
    // Body URL is irrelevant when sources key is present
    const content = ['---', 'sources: []', '---', 'See https://github.com/acme/widget for details.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('sources entries without url key + body URL → FLAGGED (array present → authoritative, body ignored)', () => {
    // sources key IS present as array, entries have no url key → extracted urls = [] → return []
    // → authoritative → body substring not checked → flagged
    const content = [
      '---',
      'sources:',
      '  - name: acme-widget',
      '---',
      'See https://github.com/acme/widget for details.',
    ].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })

  it('sources: [] without body URL → flagged (no usable attribution)', () => {
    // Empty sources + no body URL — cannot attribute → flagged
    const content = ['---', 'sources: []', '---', 'No GitHub URL here.'].join('\n')
    const result = detectPrivateWikiLeaks({
      dataWikiPages: [page('acme--widget.md', 'h1', content)],
      publicSlugMap: new Map([
        ['acme--widget', [{owner: 'acme', name: 'widget', private: false} as unknown as RepoEntry]],
      ]),
      grandfatherPages: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({filename: 'acme--widget.md', reason: 'unattributable-page'})
  })
})

// ---------------------------------------------------------------------------
// formatOperatorReport (local-only unredacted output)
// ---------------------------------------------------------------------------

describe('formatOperatorReport (local-only unredacted output)', () => {
  const twoLeaks = [
    {filename: 'marcusrbrown--cart.md', reason: 'unattributable-page' as const},
    {filename: 'acme--secret.md', reason: 'ambiguous-public-slug' as const},
  ]

  it('includes the offending filename in the output', () => {
    // #given two leaks with known filenames
    // #when formatOperatorReport is called
    // #then each filename appears verbatim in the output
    const report = formatOperatorReport(twoLeaks)
    expect(report).toContain('marcusrbrown--cart.md')
    expect(report).toContain('acme--secret.md')
  })

  it('includes each reason alongside the filename', () => {
    // #given two leaks with distinct reasons
    // #when formatOperatorReport is called
    // #then each reason appears in the output
    const report = formatOperatorReport(twoLeaks)
    expect(report).toContain('unattributable-page')
    expect(report).toContain('ambiguous-public-slug')
  })

  it('includes the BLOCKED header with the leak count', () => {
    // #given two leaks
    // #when formatOperatorReport is called
    // #then the header contains BLOCKED and the count
    const report = formatOperatorReport(twoLeaks)
    expect(report).toContain('BLOCKED')
    expect(report).toContain('2')
  })

  it('includes the remediation header', () => {
    // #given any leaks
    // #when formatOperatorReport is called
    // #then a Remediation section is present
    const report = formatOperatorReport(twoLeaks)
    expect(report).toContain('Remediation')
  })

  it('includes the LOCAL OPERATOR OUTPUT warning label', () => {
    // #given any leaks
    // #when formatOperatorReport is called
    // #then the output contains the local-operator warning so operators know not to paste it publicly
    const report = formatOperatorReport(twoLeaks)
    expect(report).toContain('LOCAL OPERATOR OUTPUT')
  })

  it('empty leaks array → no filename lines, still has header', () => {
    // #given no leaks
    // #when formatOperatorReport is called
    // #then no filename lines appear but the header is still present
    const report = formatOperatorReport([])
    expect(report).toContain('check-wiki-private-presence')
    expect(report).not.toContain('marcusrbrown')
    expect(report).not.toContain('acme')
  })
})

// ---------------------------------------------------------------------------
// runCli — testable seam for --operator-report and normal mode
// ---------------------------------------------------------------------------

describe('runCli — CI-refusal (critical privacy gate)', () => {
  it('refuses with exitCode 2 when GITHUB_ACTIONS is set, regardless of leaks', async () => {
    // #given GITHUB_ACTIONS=true in env (simulating CI)
    // #when runCli is called with --operator-report
    // #then exitCode is 2 and stderr contains the refusal message
    // The refusal must short-circuit BEFORE any detection or file I/O
    const result = await runCli(['--operator-report'], {GITHUB_ACTIONS: 'true'})
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('local-only')
    expect(result.stderr).toContain('refusing to run in CI')
  })

  it('refuses with exitCode 2 when CI=true in env', async () => {
    // #given CI=true in env (simulating CI)
    // #when runCli is called with --operator-report
    // #then exitCode is 2
    const result = await runCli(['--operator-report'], {CI: 'true'})
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('refusing to run in CI')
  })

  it('CI-refusal stdout contains NO filename substring (short-circuits before detection)', async () => {
    // #given GITHUB_ACTIONS=true
    // #when runCli is called with --operator-report
    // #then stdout is empty — the refusal must not print any leak detail
    // This is the critical privacy assertion: even if leaks exist, CI must see nothing
    const result = await runCli(['--operator-report'], {GITHUB_ACTIONS: 'true'})
    expect(result.stdout).toBe('')
    // No owner--repo .md filename shape in either stream
    // Use literal check: the separator '--' followed by a word and '.md' must not appear
    const combined = result.stdout + result.stderr
    expect(combined).not.toContain('.md')
  })

  it('CI-refusal stderr contains NO filename substring', async () => {
    // #given GITHUB_ACTIONS=true
    // #when runCli is called with --operator-report
    // #then stderr contains only the refusal message, no filenames
    const result = await runCli(['--operator-report'], {GITHUB_ACTIONS: 'true'})
    // The refusal message must not contain any .md filename
    expect(result.stderr).not.toContain('.md')
  })

  it('GITHUB_ACTIONS=true WITHOUT --operator-report flag runs normally (redacted gate still works in CI)', async () => {
    // #given GITHUB_ACTIONS=true but no --operator-report flag
    // #when runCli is called without the flag
    // #then it does NOT refuse — the normal redacted gate must still work in CI
    // Set up mocks so the normal path can complete: no wiki pages, no leaks → exits 0
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    mockReadFile.mockResolvedValue('version: 1\nrepos: []\n')

    const result = await runCli([], {GITHUB_ACTIONS: 'true', GRANDFATHER_WIKI_REPOS_DIR: '/tmp/grandfather'})
    expect(result.exitCode).not.toBe(2)
    expect(result.stderr).not.toContain('refusing to run in CI')
  })
})

describe('runCli — local operator path (no CI env)', () => {
  it('exits 0 and prints "no private wiki leaks detected" when no leaks found', async () => {
    // #given a clean environment with no CI vars and a valid GRANDFATHER_WIKI_REPOS_DIR
    // #when runCli is called with --operator-report and readdir returns empty (no wiki pages)
    // #then exitCode 0 and stdout contains the clean message
    // We use the mocked readdir/readFile from the top-level vi.mock — reset to ENOENT for both dirs
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    mockReadFile.mockResolvedValue('version: 1\nrepos: []\n')

    const result = await runCli(['--operator-report'], {GRANDFATHER_WIKI_REPOS_DIR: '/tmp/empty-grandfather'})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('no private wiki leaks detected')
  })

  it('exits 1 and stdout contains the offending filename when leaks are found', async () => {
    // #given a local env with a known leak (a page not in publicSlugMap, not grandfathered)
    // #when runCli is called with --operator-report
    // #then exitCode 1 and stdout contains the offending filename
    const enoentGrandfather = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})

    // readdir: first call = structural check (knowledge/wiki/repos), second = loadWikiPages, third = grandfather ENOENT
    mockReaddir
      .mockResolvedValueOnce([dirent('acme--secret.md')]) // findStructuralViolations
      .mockResolvedValueOnce([dirent('acme--secret.md')]) // loadWikiPages
      .mockRejectedValueOnce(enoentGrandfather) // grandfather dir ENOENT

    mockReadFile
      .mockResolvedValueOnce('version: 1\nrepos: []\n') // metadata/repos.yaml
      .mockResolvedValueOnce('private content') // acme--secret.md content

    const result = await runCli(['--operator-report'], {GRANDFATHER_WIKI_REPOS_DIR: '/tmp/empty-grandfather'})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('acme--secret.md')
  })

  it('operator report stdout does NOT contain redacted leak-N labels (uses unredacted format)', async () => {
    // #given a local env with a known leak
    // #when runCli is called with --operator-report
    // #then stdout does NOT use the redacted "leak-1" format — it uses the operator format
    const enoentGrandfather = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})

    mockReaddir
      .mockResolvedValueOnce([dirent('acme--secret.md')])
      .mockResolvedValueOnce([dirent('acme--secret.md')])
      .mockRejectedValueOnce(enoentGrandfather)

    mockReadFile.mockResolvedValueOnce('version: 1\nrepos: []\n').mockResolvedValueOnce('private content')

    const result = await runCli(['--operator-report'], {GRANDFATHER_WIKI_REPOS_DIR: '/tmp/empty-grandfather'})
    // Should NOT use the redacted format
    expect(result.stdout).not.toMatch(/leak-\d+:/)
    // Should contain the filename
    expect(result.stdout).toContain('acme--secret.md')
  })
})

describe('runCli — normal mode (no --operator-report flag)', () => {
  it('normal mode with leaks exits 1 and stderr contains redacted report (no filenames)', async () => {
    // #given a local env with a known leak and no --operator-report flag
    // #when runCli is called without the flag
    // #then exitCode 1 and stderr contains the redacted report (no filenames)
    const enoentGrandfather = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})

    mockReaddir
      .mockResolvedValueOnce([dirent('acme--secret.md')])
      .mockResolvedValueOnce([dirent('acme--secret.md')])
      .mockRejectedValueOnce(enoentGrandfather)

    mockReadFile.mockResolvedValueOnce('version: 1\nrepos: []\n').mockResolvedValueOnce('private content')

    const result = await runCli([], {GRANDFATHER_WIKI_REPOS_DIR: '/tmp/empty-grandfather'})
    expect(result.exitCode).toBe(1)
    // Redacted format: no filename in stderr
    expect(result.stderr).not.toContain('acme--secret.md')
    // Contains the redacted leak label
    expect(result.stderr).toContain('leak-1')
  })

  it('normal mode with no leaks exits 0 and stdout contains clean message', async () => {
    // #given a clean env with no leaks and no --operator-report flag
    // #when runCli is called without the flag
    // #then exitCode 0 and stdout contains the clean message
    const enoent = Object.assign(new Error('ENOENT'), {code: 'ENOENT'})
    mockReaddir.mockRejectedValue(enoent)
    mockReadFile.mockResolvedValue('version: 1\nrepos: []\n')

    const result = await runCli([], {GRANDFATHER_WIKI_REPOS_DIR: '/tmp/empty-grandfather'})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('no private wiki leaks detected')
  })
})
