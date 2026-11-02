/**
 * The inline-link scanner behind `resolveMarkdownLinks`. It is an internal module: the package does not
 * export it, so the only way to reach it is through `markdown-links`.
 */
export interface InlineLink {
    /** Offset of the opening `[` in the line. */
    readonly index: number;
    /** Length of the whole `[text](destination "title")` span. */
    readonly length: number;
    /** The destination as written: `<angle>` with its brackets, or the bare run. */
    readonly target: string;
}
/**
 * Builds a function that finds the inline links of one line, `[text](destination "title")`, left to right.
 * `find(from)` returns the leftmost link that starts at or after `from`, or `undefined`.
 *
 * The grammar, over the characters of the line:
 * - `[`, a non-empty text with no `]` or newline, then `](`;
 * - optional whitespace, then the destination: `<` with a non-empty run of no `>` or newline and `>`, or else
 *   a non-empty run of no `)` or whitespace; the angle form is tried first and the bare run is the fallback
 *   when the angle form is not followed by a valid ending;
 * - an optional title, set off by whitespace, in double quotes, in single quotes or in parentheses, each with
 *   no newline inside and no closing delimiter before its end;
 * - optional whitespace, then `)`. A title that is present but does not lead to `)` is dropped, and the
 *   destination alone must then be followed by whitespace and `)`.
 *
 * Every run in the grammar ends at the first character that cannot continue it, so a run is read once from
 * a table of stop offsets built right to left, and every start offset is decided in constant time. The
 * tables are built on first use and only for a line that holds `](`.
 */
export declare function createInlineLinkFinder(line: string): (from: number) => InlineLink | undefined;
