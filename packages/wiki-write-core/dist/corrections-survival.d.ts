import { type CorrectionsFile, type CorrectionSurvivalResult } from './corrections.js';
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
export declare function verifyCorrectionSurvival(files: Record<string, string>, corrections: CorrectionsFile | undefined, fallbackFiles?: Record<string, string>): CorrectionSurvivalResult;
/**
 * Substitutes each link's visible label (markdown or wiki, labeled or bare) before the generic
 * punctuation strip below. Exported only for `corrections-survival.test.ts`'s exhaustive
 * differential test against the pre-refactor reference implementation.
 */
export declare function normalizeFormattingText(value: string): string;
/**
 * Masks markdown inline links `[label](url)` to spaces so exact prose matching ignores link
 * targets; wiki links `[[...]]` are left untouched (module docstring). A regex port was proven
 * non-equivalent by exhaustive differential testing (corrections-survival.test.ts), so this
 * scanner stays; its directived lines are deterministic hangs under mutation, not timing noise.
 */
export declare function maskMarkdownLinks(content: string): string;
