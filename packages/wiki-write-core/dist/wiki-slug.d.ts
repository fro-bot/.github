/**
 * Build a flat set of private identifier tokens from a list of `owner/name` strings.
 * Tokens: [owner/name, owner--name, computeRepoSlug(owner, name)] — lowercased, deduplicated.
 * Entries with `[REDACTED]` owner or name are skipped.
 *
 * Shared by capture-learnings-open.ts and solutions-query.ts — single source of truth.
 */
export declare function buildPrivateTokenSet(privateNames: string[]): Set<string>;
/**
 * Build the canonical private-name token set for a single `owner/name` string.
 *
 * Returns up to three forms — [nameWithOwner, owner--name, computeRepoSlug(owner,name)] —
 * deduplicated via a Set round-trip. The raw double-dash form is always present even if
 * computeRepoSlug throws. Bare name is intentionally excluded (false-positive risk on short names).
 *
 * Returns an empty array when the input has no slash, or when owner/name is empty.
 */
export declare function buildPrivateNameTokens(nameWithOwner: string): string[];
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
export declare function computeRepoSlug(owner: string, repo: string): string;
export declare function runWikiSlugCli(argv?: readonly string[]): Promise<void>;
