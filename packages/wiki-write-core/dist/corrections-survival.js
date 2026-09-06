import { normalizeCorrectionText } from "./correction-text.js";
import { assertCorrectionsFile, getCorrectionLifecycle, } from "./corrections.js";
import { maskNonProseContent } from "./rendering-policy.js";
import { collectWikiPages } from "./wiki-utils.js";
/**
 * Verify marked spans mechanically after ingest regeneration.
 *
 * Matching trims the span and collapses every whitespace run to one space, then
 * performs an exact substring search in prose only. Markdown inline links are
 * excluded from that exact search; wiki links remain in it because their target
 * text is page prose for this purpose. Fenced code, indented code, and blockquotes
 * are excluded because quoted material is not evidence that the correction survived
 * in the page's actual prose.
 *
 * If exact prose matching fails, a second conservative comparison replaces
 * Markdown links with their visible text, removes Markdown emphasis/code markers,
 * converts punctuation to whitespace, collapses whitespace, and lowercases text.
 * A match under that rule is formatting-only drift and emits an advisory
 * `correction-needs-reconfirmation`; any other miss is erosion and blocks ingest.
 */
export function verifyCorrectionSurvival(files, corrections, fallbackFiles = {}) {
    if (corrections === undefined)
        return { ok: true, deterministicFindings: [], advisoryFindings: [] };
    assertCorrectionsFile(corrections);
    const pages = collectWikiPages(files);
    const fallbackPages = collectWikiPages(fallbackFiles);
    // Keyed by `unknown`: correction.page_node_id is a validated non-empty string
    // (corrections.ts parseLooseCorrectionRecord), so unkeyable pages are never looked up.
    const pagesByNodeId = new Map();
    const fallbackPagesByNodeId = new Map();
    for (const page of pages)
        pagesByNodeId.set(page.frontmatter.node_id, page);
    for (const page of fallbackPages)
        fallbackPagesByNodeId.set(page.frontmatter.node_id, page);
    const deterministicFindings = [];
    const advisoryFindings = [];
    for (const correction of corrections.corrections) {
        const state = getCorrectionLifecycle(correction);
        if (state === 'superseded' || state === 'retired')
            continue;
        const page = pagesByNodeId.get(correction.page_node_id);
        const fallbackPage = fallbackPagesByNodeId.get(correction.page_node_id);
        const path = page?.path ?? fallbackPage?.path ?? 'knowledge/corrections.yaml';
        if (state === 'needs-reconfirmation') {
            advisoryFindings.push({
                kind: 'correction-needs-reconfirmation',
                path,
                target: correction.id,
                recovery: { lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction' },
                message: `Correction ${correction.id} needs operator reconfirmation before it is enforced.`,
            });
            continue;
        }
        // normalizedSpan is never '' (assertCorrectionSpan, corrections.ts:185); page === undefined
        // forces proseBody '', and '' can never include a non-empty span, so that disjunct is dead.
        const normalizedSpan = normalizeCorrectionText(correction.span.text);
        const proseBody = page === undefined ? '' : maskNonProseContent(page.body);
        const normalizedBody = normalizeCorrectionText(maskMarkdownLinks(proseBody));
        if (!normalizedBody.includes(normalizedSpan)) {
            const formattingSpan = normalizeFormattingText(correction.span.text);
            const formattingBody = normalizeFormattingText(proseBody);
            if (formattingSpan !== '' && formattingBody.includes(formattingSpan)) {
                advisoryFindings.push({
                    kind: 'correction-needs-reconfirmation',
                    path,
                    target: correction.id,
                    recovery: { lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction' },
                    message: `Correction ${correction.id} appears preserved with formatting-only changes and needs operator reconfirmation.`,
                });
                continue;
            }
            deterministicFindings.push({
                kind: 'correction-eroded',
                path,
                target: correction.id,
                recovery: { lifecycle: 'active', action: 'restore-span' },
                message: `Active correction ${correction.id} was not found in the regenerated page.`,
            });
        }
    }
    return {
        ok: deterministicFindings.length === 0,
        deterministicFindings,
        advisoryFindings,
    };
}
/**
 * Substitutes each link's visible label (markdown or wiki, labeled or bare) before the generic
 * punctuation strip below. Exported only for `corrections-survival.test.ts`'s exhaustive
 * differential test against the pre-refactor reference implementation.
 */
export function normalizeFormattingText(value) {
    const markdownLinkPattern = /!?\[([^\]]*)\]\([^)]*\)/gu;
    const wikiLinkPattern = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu;
    return (value
        .normalize('NFKC')
        .replaceAll(markdownLinkPattern, (_match, label) => label)
        .replaceAll(wikiLinkPattern, (_match, target, label) => label ?? target)
        // `\s+` below absorbs any run this leaves; a `+` here would be unobservable.
        .replaceAll(/[^\p{L}\p{N}]/gu, ' ')
        .trim()
        .replaceAll(/\s+/gu, ' ')
        .toLowerCase());
}
/**
 * Masks markdown inline links `[label](url)` to spaces so exact prose matching ignores link
 * targets; wiki links `[[...]]` are left untouched (module docstring). A regex port was proven
 * non-equivalent by exhaustive differential testing (corrections-survival.test.ts), so this
 * scanner stays; its directived lines are deterministic hangs under mutation, not timing noise.
 */
export function maskMarkdownLinks(content) {
    const masked = content.split('');
    let open = -1;
    let index = 0;
    // Stryker disable next-line BlockStatement,EqualityOperator: BlockStatement mutation destroys mandatory loop progress (deterministic hang, not a timing artifact); EqualityOperator's >= variant hangs on empty content (0 >= 0 is true, index only grows, so it never becomes false again) and its <= variant only extends the loop to content[content.length], which is always undefined and has no side effect on open/masked/depth
    while (index < content.length) {
        if (content[index] === '[')
            open = index;
        if (content[index] === ']' && content[index + 1] === '(' && open !== -1) {
            let close = index + 2;
            let depth = 1;
            // Split from the original `close < content.length && depth > 0` combined condition so
            // each half's mutants land on their own line; the `depth <= 0` check below is bounded by
            // this while's own `close < content.length`, so its mutants are not a hang, just wrong
            // output, and are killed by the differential test like any other behavior change.
            // Stryker disable next-line BlockStatement,EqualityOperator: BlockStatement mutation destroys mandatory loop progress (deterministic hang, not a timing artifact); EqualityOperator's >= variant hangs when close starts at or past content.length (a link's `](` at the very end of the string) for the same reason as the outer loop above, and its <= variant only extends the loop to content[content.length], which is always undefined and has no side effect on open/masked/depth
            while (close < content.length) {
                if (depth <= 0)
                    break;
                if (content[close] === '(')
                    depth += 1;
                else if (content[close] === ')')
                    depth -= 1;
                // Stryker disable next-line AssignmentOperator: mutation destroys mandatory loop progress; deterministic hang, not a timing artifact
                close += 1;
            }
            if (depth === 0) {
                // Stryker disable next-line AssignmentOperator: mutation destroys mandatory loop progress; deterministic hang, not a timing artifact
                for (let maskIndex = open; maskIndex < close; maskIndex += 1)
                    masked[maskIndex] = ' ';
                index = close;
                open = -1;
                continue;
            }
        }
        // Stryker disable next-line AssignmentOperator: mutation destroys mandatory loop progress; deterministic hang, not a timing artifact
        index += 1;
    }
    return masked.join('');
}
