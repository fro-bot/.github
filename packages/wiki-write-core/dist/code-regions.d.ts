/** A half-open `[start, end)` range of offsets in a string that holds literal code, not markdown. */
export interface CodeRegion {
    readonly start: number;
    readonly end: number;
}
/**
 * Locate fenced code blocks and inline code spans in markdown, as sorted, non-overlapping regions.
 * Link extractors use it so link-shaped text inside code stays literal.
 *
 * - A fence opens at a line starting with three or more backticks or tildes and closes at a line
 *   with the same character and at least as many. An unclosed fence runs to the end of the content.
 *   The fence lines themselves are part of the region.
 * - Outside a fence, a run of N backticks opens an inline span that closes at the next run of
 *   exactly N backticks on the same line (CommonMark, minus spans that cross a line break). A run
 *   with no matching closer is literal text. A backslash outside a span escapes the next
 *   character, so an escaped backtick never opens a span.
 */
export declare function findCodeRegions(content: string): CodeRegion[];
/** The region that contains `offset`, if any. `regions` must come from {@link findCodeRegions}. */
export declare function findRegionAt(regions: readonly CodeRegion[], offset: number): CodeRegion | undefined;
