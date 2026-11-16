import type {Dirent} from 'node:fs'
import type {NodeIdResolver} from './private-repo-resolution.ts'
import {createHash} from 'node:crypto'
import {readdir, readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {parseFrontmatterDocument} from '@fro.bot/wiki-write-core/frontmatter'
import {assertReposFile, type RepoEntry} from '@fro.bot/wiki-write-core/schemas'
import {computeRepoSlug} from '@fro.bot/wiki-write-core/wiki-slug'
import YAML from 'yaml'
import {confirmArchivedPublic} from './check-private-leak.ts'

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
// parseFrontmatterSources — extract structured source URLs from YAML frontmatter
// ---------------------------------------------------------------------------

/**
 * Read the `sources` attribution of a wiki page from its YAML frontmatter.
 *
 * - `null`       → the page has no readable block: no block, a block that is never
 *                  closed, a block that is not valid YAML, or a block that is not a
 *                  mapping. The page body is never read, and no parser message is kept.
 * - `[]`         → the block is a mapping with no `sources` key, a `sources` value that
 *                  is not an array (e.g. a scalar, null), or an array with no entries
 *                  that have a `url` string.
 * - `string[]`   → `sources` is an array with at least one usable URL string. The
 *                  caller checks each URL against the repo.
 *
 * Both `null` and `[]` end in `unattributable-page`: no state leaves the caller a way to
 * pass a page without a matching source.
 *
 * Where the block starts and ends is decided by `splitFrontmatterBlock` (through
 * `parseFrontmatterDocument`); this function only judges what the block says.
 */
function parseFrontmatterSources(content: string): string[] | null {
  let values: Record<string, unknown>
  try {
    values = parseFrontmatterDocument(content).values
  } catch {
    // No block, an unclosed block, invalid YAML and a non-mapping all end here. The error is dropped:
    // a parser message can carry page text, and this gate's output must not.
    return null
  }

  const sources = values.sources

  // No `sources` key, or a value that is not an array (a scalar, null) → an empty list, which matches no
  // repository (fail-closed).
  // Stryker disable next-line ArrayDeclaration: sourceUrlMatchesRepo's `new URL(...)` throws
  // (caught, returns false) for any non-URL string, so a non-empty seed here can't affect .some().
  if (!Array.isArray(sources)) return []

  // An array → extract url strings (possibly returns []).
  // Stryker disable next-line ArrayDeclaration: same reasoning — sourceUrlMatchesRepo rejects any
  // non-URL seed string via the URL constructor throw, so it can't affect .some()'s result.
  const urls: string[] = []
  for (const src of sources) {
    const url = (src as Record<string, unknown> | null | undefined)?.url
    if (typeof url === 'string') urls.push(url)
  }
  return urls
}

// ---------------------------------------------------------------------------
// sourceUrlMatchesRepo — exact owner/repo URL matching without prefix collisions
// ---------------------------------------------------------------------------

/**
 * Return true iff `sourceUrl` refers to exactly the repo identified by `owner`
 * and `name` on github.com.
 *
 * Matching rules:
 * - Protocol must be exactly `https:` (rejects http, ftp, etc.).
 * - URL host must be exactly `github.com` (strict — no www.).
 * - No explicit port (`parsed.port` must be empty string — rejects :444, etc.).
 * - URL pathname segments[0] must equal `owner` and segments[1] must equal `name`
 *   (case-insensitive; GitHub owner/repo names are case-insensitive).
 * - Trailing path segments (e.g. `/blob/main/README.md`) are allowed — only the
 *   first two segments are checked.
 * - Query string and hash are ignored (URL parsing handles this).
 * - Malformed URLs (parse failure) return false — never throw.
 */
function sourceUrlMatchesRepo(sourceUrl: string, owner: string, name: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.hostname !== 'github.com') return false
  if (parsed.port !== '') return false
  const segments = parsed.pathname.split('/').filter(s => s.length > 0)
  // GitHub owner/repo names are case-insensitive: compare lowercased so a source URL like
  // `https://github.com/Acme/Widget` correctly attributes to an entry stored as `acme/widget`.
  // Optional chaining on segments[1] guards the `/owner`-only path (undefined?.toLowerCase()
  // returns undefined, which !== any string, so it's a safe no-match). This can only convert
  // an over-block into a correct attribution — it cannot match a genuinely different repo.
  return segments[0]?.toLowerCase() === owner.toLowerCase() && segments[1]?.toLowerCase() === name.toLowerCase()
}

// ---------------------------------------------------------------------------
// detectPrivateWikiLeaks — classifies each data wiki page
// ---------------------------------------------------------------------------

/**
 * Flag data wiki pages that cannot be attributed to a known-public
 * or unchanged-grandfathered repo.
 *
 * For each data page its stem is checked in this order:
 *
 * 1. If `publicSlugMap` has 2+ entries for the stem → `ambiguous-public-slug`
 *    (two public repos share the slug after sanitization; fail closed).
 *
 * 2. If `publicSlugMap` has exactly 1 entry for the stem, the page passes only when it
 *    has a valid frontmatter block (found by `splitFrontmatterBlock`) that parses to a
 *    YAML mapping whose `sources` lists a URL for that repository. No block, a block
 *    that is never closed, invalid YAML, a non-mapping, a mapping with no `sources` key
 *    and non-matching sources all report `unattributable-page`. The page body is never
 *    read, and nothing from the page reaches the result or stderr.
 *
 *    If that one entry shares its slug with an archived row GitHub did not confirm public
 *    (`unconfirmedSlugs`), attribution is skipped: the page cannot be told apart between the
 *    two claimants. It then takes step 3, and a changed page is `ambiguous-public-slug`.
 *
 * 3. If the stem appears in `grandfatherPages` with the **same hash** as the
 *    corresponding data page → **passes** (content-identical to what is already on
 *    main; e.g. `marcusrbrown/copiloting` with `lost-access`). The page's block is
 *    not read. A modified page (different hash) falls through to step 4.
 *
 * 4. Otherwise → `unattributable-page`.
 *
 * This design requires NO GraphQL. Unchanged grandfathered pages (even absent-
 * `private` entries like `marcusrbrown/copiloting`) are handled gracefully.
 * Modified or new unattributable pages are blocked.
 */
export function detectPrivateWikiLeaks(params: {
  dataWikiPages: readonly WikiPageSnapshot[]
  publicSlugMap: ReadonlyMap<string, readonly RepoEntry[]>
  grandfatherPages: readonly WikiPageSnapshot[]
  /**
   * Slugs of archived rows GitHub did not confirm public (`buildUnconfirmedArchivedSlugs`). Required, with
   * an empty set where there are none: a caller that left it out would silently skip the collision check.
   */
  unconfirmedSlugs: ReadonlySet<string>
}): PrivateWikiLeak[] {
  const {dataWikiPages, publicSlugMap, grandfatherPages, unconfirmedSlugs} = params

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

      // An archived row GitHub did not confirm public shares this slug with the one public row. It is never
      // an attribution candidate, but it is a claimant: a page sourced to both cannot be told apart, so it
      // is attributed to neither and falls through to the grandfather check below.
      if (!unconfirmedSlugs.has(page.stem)) {
        // entries.length === 1 here: the `entries.length > 1` branch above already continued.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const entry = entries[0]!
        const sources = parseFrontmatterSources(page.content)

        // A public repo page passes only with a valid frontmatter block whose `sources` has a URL for this
        // repository. The body is never consulted: no block, an unclosed block, invalid YAML, a non-mapping,
        // a mapping with no `sources` key and non-matching sources are all unattributable.
        if (sources !== null && sources.some(url => sourceUrlMatchesRepo(url, entry.owner, entry.name))) {
          continue
        }
        leaks.push({filename: page.filename, reason: 'unattributable-page'})
        continue
      }
    }

    // Stem not attributable through publicSlugMap — check content-identity grandfathering.
    // page.hash is always a string, so an undefined grandfatherHash already fails this check.
    const grandfatherHash = grandfatherByStem.get(page.stem)
    if (grandfatherHash === page.hash) {
      continue // unchanged from main → grandfathered (e.g. copiloting/lost-access)
    }

    // Not public, not unchanged-grandfathered → block. A slug also claimed by an unconfirmed archived row
    // is ambiguous (`entries !== undefined` here means exactly that); any other stem is unattributable.
    leaks.push({
      filename: page.filename,
      reason: entries === undefined ? 'unattributable-page' : 'ambiguous-public-slug',
    })
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
 * Build a map from slug → RepoEntry[] for all entries admitted as public: an entry with explicit
 * `private === false` that is not archived, and an archived entry only when its node is in
 * `confirmedPublicNodeIds`.
 *
 * Reconcile keeps an archived row named, `private: false`, when it cannot see the repository, so for
 * an archived row the stored value is not evidence. `confirmArchivedPublic` collects the nodes GitHub
 * reports `PUBLIC` at check time, and only those are admitted. An archived row with no node ID, a
 * redacted one and an unconfirmed one are left out, so a page for it passes only when it is
 * unchanged from `main` (the grandfather rule in `detectPrivateWikiLeaks`). The set is typed to
 * accept `undefined` so a row with no node ID is "not in the set" without a branch of its own.
 *
 * A stem with 2+ entries signals a slug collision (two repos sanitize to the same
 * string). Callers must flag ambiguous stems rather than silently admitting them.
 *
 * Uses `computeRepoSlug` (not raw `owner--name` join) so leading-dot sanitization
 * matches actual wiki filenames.
 *
 * Exported for testing.
 */
export function buildPublicSlugMap(
  repos: readonly RepoEntry[],
  confirmedPublicNodeIds: ReadonlySet<string | undefined> = new Set<string>(),
): Map<string, RepoEntry[]> {
  const map = new Map<string, RepoEntry[]>()
  for (const entry of repos) {
    if (
      entry.private === false &&
      (entry.onboarding_status !== 'archived' || confirmedPublicNodeIds.has(entry.node_id))
    ) {
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
 * The slugs of archived named rows GitHub did not confirm public. `buildPublicSlugMap` leaves such a
 * row out so it can never attribute a page, but it must still count as a claimant of its slug: if it
 * vanished, a page sourced to it and to a public row sharing the slug would look unambiguous and
 * pass. `detectPrivateWikiLeaks` treats a stem in this set as ambiguous. A row stored private (a
 * redacted archived row included) is not listed: its stored name is `[REDACTED]`, so no slug of a
 * real repository can be computed from it. A name that cannot form a slug cannot name a page file
 * and is skipped.
 */
export function buildUnconfirmedArchivedSlugs(
  repos: readonly RepoEntry[],
  confirmedPublicNodeIds: ReadonlySet<string | undefined> = new Set<string>(),
): Set<string> {
  const slugs = new Set<string>()
  for (const entry of repos) {
    if (entry.onboarding_status !== 'archived' || entry.private === true || confirmedPublicNodeIds.has(entry.node_id)) {
      continue
    }
    try {
      slugs.add(computeRepoSlug(entry.owner, entry.name))
    } catch {
      // A name that cannot form a slug cannot name a wiki page file.
    }
  }
  return slugs
}

/**
 * Build the set of public repo slugs from a repos.yaml entry list.
 *
 * Only entries with explicit `private === false` are admitted — absent/undefined
 * private is treated as private (fail-safe) — and an archived entry only when its node is in
 * `confirmedPublicNodeIds` (see `buildPublicSlugMap`). Uses `computeRepoSlug` (not a raw
 * `owner--name` join) so leading-dot sanitization matches actual wiki filenames.
 *
 * Exported as a pure helper so tests can exercise the predicate directly without
 * standing up the full CLI entry-point.
 */
export function buildPublicSlugs(
  repos: readonly RepoEntry[],
  confirmedPublicNodeIds: ReadonlySet<string | undefined> = new Set<string>(),
): Set<string> {
  return new Set(buildPublicSlugMap(repos, confirmedPublicNodeIds).keys())
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
    'run `bun scripts/resolve-private.ts` locally with operator credentials and',
    'inspect the data branch wiki pages directly.',
  ].join('\n')}\n`
}

/**
 * Format the BLOCKED failure report WITH full page identities for local operator use.
 *
 * **LOCAL-ONLY OUTPUT — do not wire this into any workflow or paste into public logs.**
 *
 * Unlike `formatLeakReport`, this function includes each leak's `filename` and `reason`
 * so an operator or local agent can identify and remediate offending pages without
 * reverse-engineering the redacted gate output.
 *
 * This function MUST only be called from the `--operator-report` branch of `runCli`,
 * which hard-refuses to run when `GITHUB_ACTIONS` or `CI=true` is set. It must never
 * be wired into a GitHub Actions workflow step.
 *
 * Exported for testing only.
 */
export function formatOperatorReport(leaks: readonly PrivateWikiLeak[]): string {
  const lines: string[] = [
    `check-wiki-private-presence: BLOCKED — ${leaks.length} unattributable wiki repo page(s).`,
    '',
    'Offending pages (LOCAL OPERATOR OUTPUT — do not paste into public logs):',
    ...leaks.map(leak => `  - knowledge/wiki/repos/${leak.filename}  (${leak.reason})`),
    '',
    'Remediation:',
    '  1. Inspect each page on the data branch; if its repo is private, the page must not be promoted.',
    '  2. Redact via a fro-bot[bot] write to data (dispatch fro-bot.yaml) — never a human-authored PR (wiki authority guard).',
    '  3. If the repo is actually public, ensure its metadata/repos.yaml entry has `private: false` so the slug is admitted.',
    '  4. Re-run the promotion (Merge Data Branch) once data is clean.',
  ]
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// collectLeaks — shared detection pipeline (used by both normal and operator paths)
// ---------------------------------------------------------------------------

/**
 * Run the full leak-detection pipeline and return all detected leaks.
 *
 * Reads `metadata/repos.yaml` from CWD, scans `knowledge/wiki/repos`, and loads
 * grandfather pages from the path in `env.GRANDFATHER_WIKI_REPOS_DIR`.
 *
 * Extracted as a shared helper so the normal (redacted) path and the operator
 * (unredacted) path use ONE detection implementation with no drift risk.
 *
 * `resolver` looks up archived rows (see `buildPublicSlugMap`); with none, an archived row is
 * unconfirmed. A registry with no archived row makes no lookup at all.
 */
async function collectLeaks(
  env: Record<string, string | undefined>,
  resolver: NodeIdResolver | undefined,
): Promise<PrivateWikiLeak[]> {
  const dataWikiDir = resolve('knowledge/wiki/repos')
  const grandfatherDir = resolve(requireGrandfatherDir(env.GRANDFATHER_WIKI_REPOS_DIR))
  if (dataWikiDir === grandfatherDir) {
    // This catches path aliasing when GRANDFATHER_WIKI_REPOS_DIR collapses onto the data wiki.
    // Separate checkouts with identical content are not covered; ref: main in merge-data.yaml
    // is the control for that grandfather-collapse case.
    throw new TypeError('data and grandfather wiki directories must not resolve to the same path')
  }

  // 1. Read and validate data branch's own metadata/repos.yaml (CWD = data-branch-check).
  //    Fail closed: throws on read/parse error.
  const reposRaw = await readFile('metadata/repos.yaml', 'utf8')
  const reposParsed: unknown = YAML.parse(reposRaw)
  assertReposFile(reposParsed)

  // 2. Build publicSlugMap from entries with explicit private === false.
  //    IMPORTANT: absent/undefined private is NOT admitted — fail-safe default is "private".
  //    Uses computeRepoSlug (not raw owner--name) so sanitization matches actual wiki filenames.
  //    An archived entry is admitted only when GitHub confirms its node public right now.
  const confirmedPublic = await confirmArchivedPublic(reposParsed.repos, resolver)
  const publicSlugMap = buildPublicSlugMap(reposParsed.repos, confirmedPublic)
  //    An unconfirmed archived row never attributes a page, but it still claims its slug.
  const unconfirmedSlugs = buildUnconfirmedArchivedSlugs(reposParsed.repos, confirmedPublic)

  // 3. Check for structural violations (subdirs, symlinks) in the wiki repos dir.
  //    Any non-regular entry is blocked immediately — nesting is always illegal.
  const structuralLeaks = await findStructuralViolations(dataWikiDir)

  // 4. Load data wiki pages (flat scan — only regular .md files).
  const dataWikiPages = await loadWikiPages(dataWikiDir)

  // 5. Load grandfather pages from main's wiki dir.
  //    Fail closed: GRANDFATHER_WIKI_REPOS_DIR MUST be supplied by the workflow.
  //    An unset var → throw loudly; misconfiguration must not silently pass or over-block.
  const grandfatherPages = await loadWikiPages(grandfatherDir)

  // 6. Detect content-attribution leaks — pure function, no GraphQL.
  const contentLeaks = detectPrivateWikiLeaks({dataWikiPages, publicSlugMap, grandfatherPages, unconfirmedSlugs})

  // 7. Merge structural and content leaks.
  return [...structuralLeaks, ...contentLeaks]
}

// ---------------------------------------------------------------------------
// runCli — testable seam (no process.exit / process.env / process.argv reads)
// ---------------------------------------------------------------------------

/**
 * Testable CLI entry point. Does NOT call `process.exit` or read `process.env`/`process.argv`
 * directly — all inputs are injected so tests can assert on exit codes and output without
 * spawning a subprocess.
 *
 * The `check-wiki-private-presence-cli` module calls this and returns the result's exit code.
 */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined>,
  resolver?: NodeIdResolver,
): Promise<{exitCode: number; stdout: string; stderr: string}> {
  const operatorMode = argv.includes('--operator-report')

  if (operatorMode) {
    // Hard-refuse BEFORE loading or printing ANYTHING sensitive.
    // Any value for GITHUB_ACTIONS, or CI === 'true', means we are in CI.
    if (env.GITHUB_ACTIONS !== undefined || env.CI === 'true') {
      return {
        exitCode: 2,
        stdout: '',
        stderr: 'check-wiki-private-presence: --operator-report is local-only; refusing to run in CI\n',
      }
    }

    // Local operator path — run detection and emit unredacted report.
    const leaks = await collectLeaks(env, resolver)
    if (leaks.length > 0) {
      return {exitCode: 1, stdout: formatOperatorReport(leaks), stderr: ''}
    }
    return {exitCode: 0, stdout: 'no private wiki leaks detected\n', stderr: ''}
  }

  // Normal (redacted) path — used in CI and locally without the flag.
  const leaks = await collectLeaks(env, resolver)
  if (leaks.length > 0) {
    return {exitCode: 1, stdout: '', stderr: formatLeakReport(leaks)}
  }
  return {exitCode: 0, stdout: 'no private wiki leaks detected\n', stderr: ''}
}
