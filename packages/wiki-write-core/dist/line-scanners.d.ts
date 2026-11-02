export interface IndexEntryLine {
    /** The text between `- [[` and `]]`, not trimmed. */
    readonly slug: string;
    /** The whole entry line, from the dash to the end of its text. */
    readonly line: string;
}
/**
 * Finds the index entry lines `- [[slug]] — description` of an index document, left to right, as
 * `/^- \[\[([^\]|]+)\]\]\s*—\s*(?:\S.*|[\t\v\f \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/gmu`
 * does:
 * - the line starts at the beginning of the text or after a line terminator, with `- [[`;
 * - the slug is a non-empty run up to the first `]` or `|`, which may cross lines, and `]]` follows it;
 * - whitespace (newlines included), an em dash, whitespace again;
 * - then either a non-whitespace character and the rest of its line, or, when only whitespace remains to the end
 *   of the text, a single non-newline whitespace character that ends its line.
 *
 * Each run ends at the first character that cannot continue it, so a run is read once from a table of stop
 * offsets and each candidate line is decided in constant time. The regex rescans the rest of the text from every
 * `- [[` line that has no `]]` after it, which is quadratic in the length of the text.
 */
export declare function findIndexEntryLines(index: string): IndexEntryLine[];
/**
 * The inside of a flow-style `related: [a, b]` line, or `undefined` when the line is not one, as
 * `/^related:\s*\[(.*)\]\s*(?:#.*)?$/u` does. The inside runs to the last `]` before the line's first terminator
 * that is followed only by whitespace and an optional `#` comment running to the end of the text.
 *
 * The regex tries every `]` from the right and rescans the tail from each, which is quadratic when the tail
 * stops short of the end of the text (a carriage return inside a `#` comment, say). Here the tail is decided
 * from two tables of stop offsets in constant time per `]`.
 */
export declare function parseRelatedFlow(line: string): string | undefined;
