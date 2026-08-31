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
