import type {Dirent} from 'node:fs'
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
  reason: 'unattributable-page' | 'ambiguous-public-slug' | 'invalid-wiki-structure'
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
// loadWikiPages — flat, regular-files-only; exported for testing
// ---------------------------------------------------------------------------

/**
 * Load all `.md` files in `dir` as WikiPageSnapshot records (filename, stem, hash, content).
 *
 * Performs a FLAT scan — only regular files at the top level of `dir` are loaded.
 * Non-regular entries (directories, symlinks, etc.) are silently ignored here;
 * structural violations are detected and reported by `findStructuralViolations`.
 *
 * ENOENT is graceful (fresh checkout, no wiki yet) → returns [].
 * Any other error propagates — do not silently swallow FS errors.
 *
 * @param dir - Directory path to read (absolute or relative to CWD).
 */
export async function loadWikiPages(dir: string): Promise<WikiPageSnapshot[]> {
  let dirents: Dirent<string>[]
  try {
    dirents = await readdir(dir, {withFileTypes: true})
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const snapshots: WikiPageSnapshot[] = []
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue
    const path = join(dir, dirent.name)
    const content = await readFile(path, 'utf8')
    const hash = createHash('sha256').update(content).digest('hex')
    const stem = dirent.name.replace(/\.md$/i, '').toLowerCase()
    snapshots.push({filename: dirent.name, stem, hash, content})
  }
  return snapshots
}

// ---------------------------------------------------------------------------
// findStructuralViolations — detect nesting/symlinks in wiki repos dir
// ---------------------------------------------------------------------------

/**
 * Detect non-regular entries in the wiki repos directory.
 *
 * The wiki schema is FLAT: `knowledge/wiki/repos/` contains only top-level
 * `owner--repo.md` files. Any directory, symlink, or other non-regular entry
 * is an illegal structure that must be treated as a leak — never attributed.
 *
 * This function performs a FLAT readdir and flags every entry that is NOT a
 * regular file (directories, symlinks, block/char/fifo/socket devices).
 * Regular non-`.md` files (e.g. `.gitkeep`, `README.md`) are NOT violations.
 *
 * ENOENT → returns [] (fresh checkout).
 * Any other error propagates (fail closed).
 *
 * @param dir - Directory path to scan (absolute or relative to CWD).
 */
export async function findStructuralViolations(dir: string): Promise<PrivateWikiLeak[]> {
  let dirents: Dirent<string>[]
  try {
    dirents = await readdir(dir, {withFileTypes: true})
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const leaks: PrivateWikiLeak[] = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) {
      leaks.push({filename: dirent.name, reason: 'invalid-wiki-structure'})
    }
  }
  return leaks
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

/**
 * Format the BLOCKED failure report WITHOUT leaking canonical identities.
 *
 * The leaked filenames have the form `owner--repo.md` — they ARE the canonical
 * names the privacy posture keeps off public surfaces. This gate's failure output
 * goes to a public GitHub Actions log, so it must not echo those filenames (or any
 * derivative — a hash of a low-entropy slug is trivially reversible by enumeration).
 *
 * Instead we emit:
 *   - per-run ephemeral labels (`leak-1`, `leak-2`, …) with the classification reason,
 *   - the total count,
 *   - a pointer to the operator-only resolution tool.
 *
 * Labels are positional within a single run only; they carry no information that
 * survives the run or maps back to a repo without operator credentials. An operator
 * runs `scripts/resolve-private.ts` locally to map redacted entries to names.
 *
 * Exported so tests can assert no `owner--repo` substring ever appears in the output.
 */
export function formatLeakReport(leaks: readonly PrivateWikiLeak[]): string {
  return `${[
    'check-wiki-private-presence: BLOCKED — unattributable wiki repo pages detected.',
    ...leaks.map((leak, index) => `  - leak-${index + 1}: ${leak.reason}`),
    '',
    `Leak count: ${leaks.length}`,
    'Identifiers are redacted from this public log. To map them to repositories,',
    'run `node scripts/resolve-private.ts` locally with operator credentials and',
    'inspect the data branch wiki pages directly.',
  ].join('\n')}\n`
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

  // 3. Check for structural violations (subdirs, symlinks) in the wiki repos dir.
  //    Any non-regular entry is blocked immediately — nesting is always illegal.
  const structuralLeaks = await findStructuralViolations('knowledge/wiki/repos')

  // 4. Load data wiki pages (flat scan — only regular .md files).
  const dataWikiPages = await loadWikiPages('knowledge/wiki/repos')

  // 5. Load grandfather pages from main's wiki dir.
  //    Fail closed: GRANDFATHER_WIKI_REPOS_DIR MUST be supplied by the workflow.
  //    An unset var → throw loudly; misconfiguration must not silently pass or over-block.
  const grandfatherDir = requireGrandfatherDir(process.env.GRANDFATHER_WIKI_REPOS_DIR)
  const grandfatherPages = await loadWikiPages(grandfatherDir)

  // 6. Detect content-attribution leaks — pure function, no GraphQL.
  const contentLeaks = detectPrivateWikiLeaks({dataWikiPages, publicSlugMap, grandfatherPages})

  // 7. Merge structural and content leaks.
  const leaks = [...structuralLeaks, ...contentLeaks]

  // 8. Report — redacted: the failure goes to a public Actions log, so it must
  //    never echo the leaked owner--repo.md filenames (see formatLeakReport).
  if (leaks.length > 0) {
    process.stderr.write(formatLeakReport(leaks))
    process.exit(1)
  }

  process.stdout.write('no private wiki leaks detected\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
