/**
 * One link in `replaceLinkLabels`: the capture groups of a markdown link `[text](target)` or a wiki link
 * `[[target]]` / `[[target|label]]`. The groups of the branch that did not match are `undefined`.
 */
export interface LinkLabelParts {
    readonly markdownText: string | undefined;
    readonly wikiTarget: string | undefined;
    readonly wikiLabel: string | undefined;
}
/**
 * Replaces every markdown link and wiki link in `text` with `render(parts)`, scanning left to right once, as
 * `text.replaceAll(/!?(?:\[([^\]]*)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/gu, ...)` does. A leading `!`
 * (an image) is part of the match. The markdown form is tried before the wiki form at each `[`:
 * - markdown: `[`, any text up to the first `]`, `](`, any run up to the first `)`, and that `)`;
 * - wiki: `[[`, a non-empty target up to the first `]` or `|`, then either `]]` or `|`, a non-empty label up to
 *   the first `]`, and `]]`.
 *
 * Every run ends at the first character that cannot continue it, so the stop offsets are read from tables built
 * right to left and each `[` is decided in constant time. The regex form rescans the rest of the text from every
 * unclosed `[`, which is quadratic in the length of the text.
 */
export declare function replaceLinkLabels(text: string, render: (parts: LinkLabelParts) => string): string;
