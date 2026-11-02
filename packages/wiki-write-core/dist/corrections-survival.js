import { normalizeCorrectionText } from "./correction-text.js";
import { assertCorrectionsFile, getCorrectionLifecycle, } from "./corrections.js";
import { replaceLinkLabels } from "./link-labels.js";
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
 * punctuation strip below. A single combined alternation, scanned once left to right: a
 * two-pass split (markdown pattern, then wiki pattern) lets the first pass's substitution text
 * form a NEW `[[...|...]]`-shaped string the second pass then matches, re-interpreting already-
 * substituted output as if it were original content (see corrections-survival.test.ts's
 * `[[[]()a|b]]` counterexample). Exported only for the exhaustive differential test against
 * the pre-refactor reference implementation.
 */
export function normalizeFormattingText(value) {
    return (replaceLinkLabels(value.normalize('NFKC'), renderVisibleLinkText)
        // `\s+` below absorbs any run this leaves; a `+` here would be unobservable.
        .replaceAll(/[^\p{L}\p{N}]/gu, ' ')
        .trim()
        .replaceAll(/\s+/gu, ' ')
        .toLowerCase());
}
function renderVisibleLinkText({ markdownText, wikiTarget, wikiLabel }) {
    // replaceLinkLabels calls this with exactly one branch matched: the markdown branch always has
    // markdownText (possibly '', never undefined), and the wiki branch always has wikiTarget
    // (required, 1+ chars). A final '' fallback covering "neither captured" is unreachable --
    // asserted, not defaulted.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see comment above
    return (markdownText ?? wikiLabel ?? wikiTarget);
}
/**
 * Masks markdown inline links `[label](url)` to spaces so exact prose matching ignores link
 * targets; wiki links `[[...]]` are left untouched (module docstring). A regex port was proven
 * non-equivalent by exhaustive differential testing (corrections-survival.test.ts), so this
 * stays a scanner.
 *
 * At each `]` that is followed by `(` and preceded by a `[`, the link runs from the last `[` to the
 * `)` that closes that `(`, counting nested parentheses. A `(` with no closing `)` is not a link,
 * and the scan goes on from the next character. After a link, the scan resumes past its `)` with no
 * `[` open. The closing `)` of every `(` is found once, up front, so the scan is linear in the
 * length of the content.
 */
export function maskMarkdownLinks(content) {
    const characters = content.split('');
    const closers = findClosingParentheses(characters);
    const masked = [...characters];
    let open = -1;
    let resumeAt = 0;
    for (const [index, character] of characters.entries()) {
        if (index < resumeAt)
            continue;
        if (character === '[')
            open = index;
        if (character === ']' && open !== -1) {
            // `closers` has an entry only for a `(`, so the next character is a `(` with a closer or there is no link.
            const close = closers.get(index + 1);
            if (close !== undefined) {
                masked.fill(' ', open, close + 1);
                resumeAt = close + 1;
                open = -1;
            }
        }
    }
    return masked.join('');
}
/**
 * Maps the index of each `(` to the index of the `)` that closes it, counting nested parentheses,
 * or to `undefined` when nothing closes it. Read from the right, each `(` takes the nearest `)`
 * that no `(` between them has taken, which pairs the same parentheses as counting depth to the
 * right of each `(`. A `)` with no `(` before it is left unpaired and never looked up.
 */
function findClosingParentheses(characters) {
    const closers = new Map();
    const unpaired = [];
    for (const [reversedIndex, character] of characters.toReversed().entries()) {
        const index = characters.length - 1 - reversedIndex;
        if (character === ')') {
            unpaired.push(index);
        }
        else if (character === '(') {
            closers.set(index, unpaired.pop());
        }
    }
    return closers;
}
