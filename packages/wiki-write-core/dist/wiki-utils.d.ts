/** Canonical root directory for wiki page content. Shared by every wiki script. */
export declare const WIKI_ROOT = "knowledge/wiki";
export type WikiPageType = 'repo' | 'topic' | 'entity' | 'comparison';
export interface WikiPage {
    readonly path: string;
    readonly slug: string;
    readonly title: string;
    readonly type: WikiPageType;
    readonly aliases: readonly string[];
    readonly tags: readonly string[];
    readonly body: string;
    readonly frontmatter: Record<string, unknown>;
    readonly frontmatterError?: string;
}
export interface SplitFrontmatterResult {
    readonly frontmatter: Record<string, unknown>;
    readonly body: string;
    readonly error?: string;
}
/**
 * Split raw wiki page content into frontmatter and body.
 *
 * Stricter than a naive split: malformed YAML frontmatter is surfaced via `error`
 * rather than silently discarded, so downstream safety/lint logic can observe it.
 */
export declare function splitFrontmatter(content: string): SplitFrontmatterResult;
/** Collect `[[target]]` and `[[target|label]]` wikilink targets from page body content. */
export declare function collectWikilinks(content: string): string[];
/** Parse a single wiki page's content (relative path + raw content) into a page record. */
export declare function parseWikiPage(path: string, content: string): WikiPage;
/** Collect all `knowledge/wiki/**.md` pages from a path→content file map. */
export declare function collectWikiPages(files: Record<string, string>): WikiPage[];
/**
 * Build the set of all resolvable link targets (slug + aliases) across a page collection.
 * Used by wiki-lint to validate wikilinks and index entries against pages on disk.
 */
export declare function collectPageTargets(pages: readonly {
    readonly slug: string;
    readonly aliases: readonly string[];
}[]): Set<string>;
/**
 * Indexed path/slug/alias -> page resolver for wikilink target resolution.
 *
 * Ambiguous targets — where more than one page maps to the same slug/alias string —
 * resolve to `undefined` rather than picking arbitrarily. Missing targets also
 * resolve to `undefined`. Callers must skip both cases rather than fuzzy-matching.
 */
export interface WikiTargetPage {
    readonly path: string;
    readonly slug: string;
    readonly aliases: readonly string[];
}
export interface WikiTargetIndex {
    resolve: (target: string) => WikiTargetPage | undefined;
}
export declare function buildWikiTargetIndex(pages: readonly WikiTargetPage[]): WikiTargetIndex;
export declare function byteLength(value: string): number;
export declare function truncateToBytes(value: string, maxBytes: number): string;
