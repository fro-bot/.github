import process from 'node:process';
/**
 * Build a flat set of private identifier tokens from a list of `owner/name` strings.
 * Tokens: [owner/name, owner--name, computeRepoSlug(owner, name)] — lowercased, deduplicated.
 * Entries with `[REDACTED]` owner or name are skipped.
 *
 * Shared by capture-learnings-open.ts and solutions-query.ts — single source of truth.
 */
export function buildPrivateTokenSet(privateNames) {
    const tokens = new Set();
    for (const nameWithOwner of privateNames) {
        const slashIndex = nameWithOwner.indexOf('/');
        if (slashIndex < 1)
            continue;
        const owner = nameWithOwner.slice(0, slashIndex);
        const name = nameWithOwner.slice(slashIndex + 1);
        if (owner === '[REDACTED]' || name === '[REDACTED]')
            continue;
        for (const token of buildPrivateNameTokens(nameWithOwner)) {
            tokens.add(token.toLowerCase());
        }
    }
    return tokens;
}
/**
 * Build the canonical private-name token set for a single `owner/name` string.
 *
 * Returns up to three forms — [nameWithOwner, owner--name, computeRepoSlug(owner,name)] —
 * deduplicated via a Set round-trip. The raw double-dash form is always present even if
 * computeRepoSlug throws. Bare name is intentionally excluded (false-positive risk on short names).
 *
 * Returns an empty array when the input has no slash, or when owner/name is empty.
 */
export function buildPrivateNameTokens(nameWithOwner) {
    const slashIndex = nameWithOwner.indexOf('/');
    if (slashIndex < 1)
        return [];
    const owner = nameWithOwner.slice(0, slashIndex);
    const name = nameWithOwner.slice(slashIndex + 1);
    if (owner === '' || name === '')
        return [];
    // Raw double-dash form — original chars, no sanitization. Always added first.
    const rawDoubleDash = `${owner}--${name}`;
    const tokens = [nameWithOwner, rawDoubleDash];
    try {
        tokens.push(computeRepoSlug(owner, name));
    }
    catch {
        // computeRepoSlug throws on empty segments — skip slug form
    }
    // Dedup: identical forms (e.g. simple names where raw == slug) don't double up.
    return [...new Set(tokens)];
}
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
export function computeRepoSlug(owner, repo) {
    const ownerSlug = sanitizeSegment(owner);
    const repoSlug = sanitizeSegment(repo);
    if (ownerSlug === '' || repoSlug === '') {
        throw new Error(`computeRepoSlug: segment sanitized to empty string (owner=${JSON.stringify(owner)} -> ${JSON.stringify(ownerSlug)}, repo=${JSON.stringify(repo)} -> ${JSON.stringify(repoSlug)})`);
    }
    return `${ownerSlug}--${repoSlug}`;
}
function sanitizeSegment(segment) {
    const sanitized = segment.toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-');
    let start = 0;
    let end = sanitized.length;
    while (sanitized[start] === '-')
        start += 1;
    while (end > start && sanitized[end - 1] === '-')
        end -= 1;
    return sanitized.slice(start, end);
}
export async function runWikiSlugCli(argv = process.argv) {
    const [, , owner, repo] = argv;
    if (owner === undefined || repo === undefined || owner === '' || repo === '') {
        process.stderr.write('Usage: node scripts/wiki-slug.ts <owner> <repo>\n');
        process.exit(1);
    }
    process.stdout.write(computeRepoSlug(owner, repo));
}
if (import.meta.url === `file://${process.argv[1]}`) {
    await runWikiSlugCli();
}
