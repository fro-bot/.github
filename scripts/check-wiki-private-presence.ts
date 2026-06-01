import {readdir, readFile} from 'node:fs/promises'
import process from 'node:process'

import YAML from 'yaml'

import {assertReposFile} from './schemas.ts'
import {computeRepoSlug} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivateWikiLeak {
  filename: string
  reason: 'unattributable-page'
}

// ---------------------------------------------------------------------------
// detectPrivateWikiLeaks — pure function (no I/O, no subprocess)
// ---------------------------------------------------------------------------

/**
 * Pure function: flag data wiki pages that cannot be attributed to a known-public
 * or already-grandfathered repo.
 *
 * A page is a LEAK iff its stem (filename without .md, lowercased) is in NEITHER:
 *   - publicSlugs: slugs computed from repos.yaml entries with private === false
 *   - grandfatheredSlugs: stems of pages already on main's knowledge/wiki/repos/
 *
 * This design requires NO GraphQL — dead private orphans are handled gracefully:
 * if their page was already on main it is grandfathered; if it is genuinely new
 * it is flagged.
 */
export function detectPrivateWikiLeaks(params: {
  dataWikiFilenames: readonly string[]
  publicSlugs: ReadonlySet<string>
  grandfatheredSlugs: ReadonlySet<string>
}): PrivateWikiLeak[] {
  const {dataWikiFilenames, publicSlugs, grandfatheredSlugs} = params
  const leaks: PrivateWikiLeak[] = []

  for (const filename of dataWikiFilenames) {
    const stem = filename.replace(/\.md$/i, '').toLowerCase()
    if (!publicSlugs.has(stem) && !grandfatheredSlugs.has(stem)) {
      leaks.push({filename, reason: 'unattributable-page'})
    }
  }

  return leaks
}

// ---------------------------------------------------------------------------
// loadWikiFilenames — exported for testing; ENOENT-only graceful
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
// CLI entry-point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Read and validate data branch's own metadata/repos.yaml (CWD = data-branch-check).
  //    Fail closed: throws on read/parse error.
  const reposRaw = await readFile('metadata/repos.yaml', 'utf8')
  const reposParsed: unknown = YAML.parse(reposRaw)
  assertReposFile(reposParsed)

  // 2. Build publicSlugs from entries with explicit private === false.
  //    IMPORTANT: absent/undefined private is NOT admitted — fail-safe default is "private".
  //    Uses computeRepoSlug (not raw owner--name) so sanitization matches actual wiki filenames.
  const publicSlugs = new Set(
    reposParsed.repos
      .filter((e): e is typeof e & {private: false} => e.private === false)
      .map(e => computeRepoSlug(e.owner, e.name)),
  )

  // 3. List data wiki pages (CWD = data-branch-check).
  const dataWikiFilenames = await loadWikiFilenames('knowledge/wiki/repos')

  // 4. Build grandfatheredSlugs from main's wiki dir.
  //    Fail closed: GRANDFATHER_WIKI_REPOS_DIR MUST be supplied by the workflow.
  //    An unset var → throw loudly; misconfiguration must not silently pass or over-block.
  const grandfatherDir = process.env.GRANDFATHER_WIKI_REPOS_DIR
  if (grandfatherDir === undefined || grandfatherDir.trim() === '') {
    throw new Error(
      'check-wiki-private-presence: GRANDFATHER_WIKI_REPOS_DIR env var is required but not set. ' +
        "The workflow must supply the path to main's knowledge/wiki/repos/ directory " +
        'so that pages already public are not re-flagged.',
    )
  }
  const grandfatheredFilenames = await loadWikiFilenames(grandfatherDir)
  const grandfatheredSlugs = new Set(grandfatheredFilenames.map(f => f.replace(/\.md$/i, '').toLowerCase()))

  // 5. Detect leaks — pure function, no GraphQL.
  const leaks = detectPrivateWikiLeaks({dataWikiFilenames, publicSlugs, grandfatheredSlugs})

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
