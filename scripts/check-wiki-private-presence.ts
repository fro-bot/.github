import {createHash} from 'node:crypto'
import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

import YAML from 'yaml'

import {assertReposFile, type RepoEntry} from './schemas.ts'
import {computeRepoSlug} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikiPageSnapshot {
  filename: string
  stem: string
  /** SHA-256 hex digest of the file content — used for content-identity grandfathering. */
  hash: string
  /** Raw file content — used for attribution checks. */
  content: string
}

export interface PrivateWikiLeak {
  filename: string
  reason: 'unattributable-page' | 'ambiguous-public-slug'
}

// ---------------------------------------------------------------------------
// detectPrivateWikiLeaks — pure function (no I/O, no subprocess)
// ---------------------------------------------------------------------------

/**
 * Pure function: flag data wiki pages that cannot be attributed to a known-public
 * or unchanged-grandfathered repo.
 *
 * For each data page its stem is checked in this order:
 *
 * 1. If `publicSlugMap` has 2+ entries for the stem → `ambiguous-public-slug`
 *    (two public repos share the slug after sanitization; fail closed).
 *
 * 2. If `publicSlugMap` has exactly 1 entry for the stem AND the page content
 *    contains `https://github.com/{owner}/{name}` for that entry → **passes**
 *    (explicitly public AND attributable).
 *    If the URL is absent → `unattributable-page` (slug collision via content spoofing).
 *
 * 3. If the stem appears in `grandfatherPages` with the **same hash** as the
 *    corresponding data page → **passes** (content-identical to what is already on
 *    main; e.g. `marcusrbrown/copiloting` with `lost-access`).
 *    A modified page (different hash) falls through to step 4.
 *
 * 4. Otherwise → `unattributable-page`.
 *
 * This design requires NO GraphQL. Unchanged grandfathered pages (even absent-
 * `private` entries like `marcusrbrown/copiloting`) are handled gracefully.
 * Modified or new unattirbutable pages are blocked.
 */
export function detectPrivateWikiLeaks(params: {
  dataWikiPages: readonly WikiPageSnapshot[]
  publicSlugMap: ReadonlyMap<string, readonly RepoEntry[]>
  grandfatherPages: readonly WikiPageSnapshot[]
}): PrivateWikiLeak[] {
  const {dataWikiPages, publicSlugMap, grandfatherPages} = params

  // Build grandfather index: stem → hash (for O(1) lookup)
  const grandfatherByStem = new Map<string, string>()
  for (const page of grandfatherPages) {
    grandfatherByStem.set(page.stem, page.hash)
  }

  const leaks: PrivateWikiLeak[] = []

  for (const page of dataWikiPages) {
    const entries = publicSlugMap.get(page.stem)

    if (entries !== undefined) {
      // Slug matches at least one public entry.
      if (entries.length > 1) {
        // Ambiguous: 2+ public repos sanitize to the same slug.
        leaks.push({filename: page.filename, reason: 'ambiguous-public-slug'})
        continue
      }

      // Single unique public entry — verify content attribution.
      // entries.length === 1 is guaranteed by the guard above; the non-null assertion
      // is safe but we narrow with a runtime guard to satisfy strict noUncheckedIndexedAccess.
      const entry = entries[0]
      if (entry === undefined) {
        leaks.push({filename: page.filename, reason: 'unattributable-page'})
        continue
      }
      const expectedUrl = `https://github.com/${entry.owner}/${entry.name}`
      if (page.content.includes(expectedUrl)) {
        continue // passes: explicitly public and attributable
      }

      // Content doesn't reference the expected repo — possible slug collision.
      leaks.push({filename: page.filename, reason: 'unattributable-page'})
      continue
    }

    // Stem not in publicSlugMap — check content-identity grandfathering.
    const grandfatherHash = grandfatherByStem.get(page.stem)
    if (grandfatherHash !== undefined && grandfatherHash === page.hash) {
      continue // unchanged from main → grandfathered (e.g. copiloting/lost-access)
    }

    // Not public, not unchanged-grandfathered → block.
    leaks.push({filename: page.filename, reason: 'unattributable-page'})
  }

  return leaks
}

// ---------------------------------------------------------------------------
// loadWikiPages — exported for testing; ENOENT-only graceful
// ---------------------------------------------------------------------------

/**
 * Load all .md files in `dir` as WikiPageSnapshot records (filename, stem, hash, content).
 *
 * ENOENT is graceful (fresh checkout, no wiki yet) → returns [].
 * Any other error propagates — do not silently swallow FS errors.
 *
 * @param dir - Directory path to read (absolute or relative to CWD).
 */
export async function loadWikiPages(dir: string): Promise<WikiPageSnapshot[]> {
  let filenames: string[]
  try {
    const entries = await readdir(dir)
    filenames = entries.filter(f => f.endsWith('.md'))
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  return Promise.all(
    filenames.map(async (filename): Promise<WikiPageSnapshot> => {
      const content = await readFile(join(dir, filename), 'utf8')
      const hash = createHash('sha256').update(content).digest('hex')
      const stem = filename.replace(/\.md$/i, '').toLowerCase()
      return {filename, stem, hash, content}
    }),
  )
}

// ---------------------------------------------------------------------------
// loadWikiFilenames — kept for backward compatibility; ENOENT-only graceful
// ---------------------------------------------------------------------------

/**
 * List .md filenames in the given directory.
 *
 * ENOENT is graceful (fresh checkout, no wiki yet) → returns [].
 * Any other error propagates — do not silently swallow FS errors.
 *
 * @param dir - Directory path to read (absolute or relative to CWD).
 */
export async function loadWikiFilenames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter(f => f.endsWith('.md'))
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// buildPublicSlugMap / buildPublicSlugs
// ---------------------------------------------------------------------------

/**
 * Build a map from slug → RepoEntry[] for all entries with explicit `private === false`.
 *
 * A stem with 2+ entries signals a slug collision (two repos sanitize to the same
 * string). Callers must flag ambiguous stems rather than silently admitting them.
 *
 * Uses `computeRepoSlug` (not raw `owner--name` join) so leading-dot sanitization
 * matches actual wiki filenames.
 *
 * Exported for testing.
 */
export function buildPublicSlugMap(repos: readonly RepoEntry[]): Map<string, RepoEntry[]> {
  const map = new Map<string, RepoEntry[]>()
  for (const entry of repos) {
    if (entry.private === false) {
      const slug = computeRepoSlug(entry.owner, entry.name)
      const existing = map.get(slug)
      if (existing === undefined) {
        map.set(slug, [entry])
      } else {
        existing.push(entry)
      }
    }
  }
  return map
}

/**
 * Build the set of public repo slugs from a repos.yaml entry list.
 *
 * Only entries with explicit `private === false` are admitted — absent/undefined
 * private is treated as private (fail-safe). Uses `computeRepoSlug` (not a raw
 * `owner--name` join) so leading-dot sanitization matches actual wiki filenames.
 *
 * Exported as a pure helper so tests can exercise the predicate directly without
 * standing up the full CLI entry-point.
 */
export function buildPublicSlugs(repos: readonly RepoEntry[]): Set<string> {
  return new Set(buildPublicSlugMap(repos).keys())
}

/**
 * Validate and return the `GRANDFATHER_WIKI_REPOS_DIR` environment variable.
 *
 * Throws on undefined or blank input — misconfiguration must never silently
 * pass or over-block. Returns the trimmed path string on success.
 *
 * Exported as a pure helper so tests can exercise the validation branch without
 * standing up the full CLI entry-point.
 */
export function requireGrandfatherDir(env: string | undefined): string {
  if (env === undefined || env.trim() === '') {
    throw new Error(
      'check-wiki-private-presence: GRANDFATHER_WIKI_REPOS_DIR env var is required but not set. ' +
        "The workflow must supply the path to main's knowledge/wiki/repos/ directory " +
        'so that pages already public are not re-flagged.',
    )
  }
  return env.trim()
}

async function main(): Promise<void> {
  // 1. Read and validate data branch's own metadata/repos.yaml (CWD = data-branch-check).
  //    Fail closed: throws on read/parse error.
  const reposRaw = await readFile('metadata/repos.yaml', 'utf8')
  const reposParsed: unknown = YAML.parse(reposRaw)
  assertReposFile(reposParsed)

  // 2. Build publicSlugMap from entries with explicit private === false.
  //    IMPORTANT: absent/undefined private is NOT admitted — fail-safe default is "private".
  //    Uses computeRepoSlug (not raw owner--name) so sanitization matches actual wiki filenames.
  const publicSlugMap = buildPublicSlugMap(reposParsed.repos)

  // 3. Load data wiki pages (CWD = data-branch-check).
  const dataWikiPages = await loadWikiPages('knowledge/wiki/repos')

  // 4. Load grandfather pages from main's wiki dir.
  //    Fail closed: GRANDFATHER_WIKI_REPOS_DIR MUST be supplied by the workflow.
  //    An unset var → throw loudly; misconfiguration must not silently pass or over-block.
  const grandfatherDir = requireGrandfatherDir(process.env.GRANDFATHER_WIKI_REPOS_DIR)
  const grandfatherPages = await loadWikiPages(grandfatherDir)

  // 5. Detect leaks — pure function, no GraphQL.
  const leaks = detectPrivateWikiLeaks({dataWikiPages, publicSlugMap, grandfatherPages})

  // 6. Report
  if (leaks.length > 0) {
    const filenames = leaks.map(l => l.filename)
    process.stderr.write(
      `${[
        'check-wiki-private-presence: BLOCKED — private wiki pages detected in knowledge/wiki/repos/:',
        ...filenames.map(f => `  - ${f}`),
        '',
        'These files expose private repository identities. Remove them from the data branch before promoting.',
        `Leak count: ${leaks.length}`,
      ].join('\n')}\n`,
    )
    process.exit(1)
  }

  process.stdout.write('no private wiki leaks detected\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
