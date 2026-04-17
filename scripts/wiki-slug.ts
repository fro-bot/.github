import process from 'node:process'

/**
 * Canonical wiki slug for a repo page.
 *
 * Produces `{owner-slug}--{repo-slug}` with:
 * - each segment lowercased
 * - runs of characters outside `[a-z0-9-]` collapsed to a single `-`
 * - leading and trailing `-` trimmed within each segment
 * - segments joined with a literal `--` separator
 *
 * The double-dash between owner and repo is the filename convention declared in
 * `knowledge/schema.md` (repo pages live at `knowledge/wiki/repos/{owner}--{repo}.md`).
 * Per-segment sanitization preserves that separator even when owner or repo names
 * contain dots, spaces, or other characters that must be replaced.
 *
 * Throws if either segment sanitizes to an empty string — an empty slug cannot be
 * validated against the schema and would produce an invalid wiki filename.
 */
export function computeRepoSlug(owner: string, repo: string): string {
  const ownerSlug = sanitizeSegment(owner)
  const repoSlug = sanitizeSegment(repo)

  if (ownerSlug === '' || repoSlug === '') {
    throw new Error(
      `computeRepoSlug: segment sanitized to empty string (owner=${JSON.stringify(owner)} -> ${JSON.stringify(
        ownerSlug,
      )}, repo=${JSON.stringify(repo)} -> ${JSON.stringify(repoSlug)})`,
    )
  }

  return `${ownerSlug}--${repoSlug}`
}

function sanitizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

async function main(): Promise<void> {
  const [, , owner, repo] = process.argv

  if (owner === undefined || repo === undefined || owner === '' || repo === '') {
    process.stderr.write('Usage: node scripts/wiki-slug.ts <owner> <repo>\n')
    process.exit(1)
  }

  process.stdout.write(computeRepoSlug(owner, repo))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
