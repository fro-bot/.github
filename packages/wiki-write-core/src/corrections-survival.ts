import type {WikiLintFinding} from './wiki-lint.ts'

import {normalizeCorrectionText} from './correction-text.ts'
import {
  assertCorrectionsFile,
  getCorrectionLifecycle,
  type CorrectionsFile,
  type CorrectionSurvivalResult,
} from './corrections.ts'
import {maskNonProseContent} from './rendering-policy.ts'
import {collectWikiPages} from './wiki-utils.ts'

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
export function verifyCorrectionSurvival(
  files: Record<string, string>,
  corrections: CorrectionsFile | undefined,
  fallbackFiles: Record<string, string> = {},
): CorrectionSurvivalResult {
  if (corrections === undefined) return {ok: true, deterministicFindings: [], advisoryFindings: []}

  assertCorrectionsFile(corrections)
  const pages = collectWikiPages(files)
  const fallbackPages = collectWikiPages(fallbackFiles)
  // Keyed by `unknown`, not narrowed to `string`: assertCorrectionsFile above guarantees
  // every correction.page_node_id is a validated non-empty string (corrections.ts
  // parseLooseCorrectionRecord), and Map lookup uses strict (SameValueZero) key equality
  // with no coercion, so a page whose frontmatter.node_id is missing, non-string, or empty
  // can never be retrieved by any valid correction lookup regardless of what it's keyed
  // under. Filtering those pages out before indexing would be unreachable dead code.
  const pagesByNodeId = new Map<unknown, (typeof pages)[number]>()
  const fallbackPagesByNodeId = new Map<unknown, (typeof fallbackPages)[number]>()
  for (const page of pages) pagesByNodeId.set(page.frontmatter.node_id, page)
  for (const page of fallbackPages) fallbackPagesByNodeId.set(page.frontmatter.node_id, page)

  const deterministicFindings: WikiLintFinding[] = []
  const advisoryFindings: WikiLintFinding[] = []
  for (const correction of corrections.corrections) {
    const state = getCorrectionLifecycle(correction)
    if (state === 'superseded' || state === 'retired') continue

    const page = pagesByNodeId.get(correction.page_node_id)
    const fallbackPage = fallbackPagesByNodeId.get(correction.page_node_id)
    const path = page?.path ?? fallbackPage?.path ?? 'knowledge/corrections.yaml'
    if (state === 'needs-reconfirmation') {
      advisoryFindings.push({
        kind: 'correction-needs-reconfirmation',
        path,
        target: correction.id,
        recovery: {lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction'},
        message: `Correction ${correction.id} needs operator reconfirmation before it is enforced.`,
      })
      continue
    }

    // `correction.span.text` is guaranteed to normalize non-empty by assertCorrectionSpan
    // (corrections.ts), enforced above via assertCorrectionsFile — no live input can make
    // normalizedSpan ''. `page === undefined` is also not tested as its own disjunct below:
    // it forces proseBody to '', and '' can never include the always-non-empty normalizedSpan,
    // so `!normalizedBody.includes(normalizedSpan)` is already true whenever page is undefined.
    const normalizedSpan = normalizeCorrectionText(correction.span.text)
    const proseBody = page === undefined ? '' : maskNonProseContent(page.body)
    const normalizedBody = normalizeCorrectionText(maskMarkdownLinks(proseBody))
    if (!normalizedBody.includes(normalizedSpan)) {
      const formattingSpan = normalizeFormattingText(correction.span.text)
      const formattingBody = normalizeFormattingText(proseBody)
      if (formattingSpan !== '' && formattingBody.includes(formattingSpan)) {
        advisoryFindings.push({
          kind: 'correction-needs-reconfirmation',
          path,
          target: correction.id,
          recovery: {lifecycle: 'needs-reconfirmation', action: 'reconfirm-correction'},
          message: `Correction ${correction.id} appears preserved with formatting-only changes and needs operator reconfirmation.`,
        })
        continue
      }
      deterministicFindings.push({
        kind: 'correction-eroded',
        path,
        target: correction.id,
        recovery: {lifecycle: 'active', action: 'restore-span'},
        message: `Active correction ${correction.id} was not found in the regenerated page.`,
      })
    }
  }

  return {
    ok: deterministicFindings.length === 0,
    deterministicFindings,
    advisoryFindings,
  }
}

/**
 * Two link forms get their visible label substituted in before the generic punctuation
 * strip below; a *label-less* wiki link `[[Target]]` is deliberately NOT special-cased
 * here — substituting it for its own target text is character-for-character identical to
 * leaving it raw and letting the generic `[^\p{L}\p{N}]+` pass strip the `[[`/`]]` wrapper
 * (both leave exactly the target's letters/digits), so a bare-link branch would be
 * unobservable dead code for this comparator.
 */
function normalizeFormattingText(value: string): string {
  const markdownLinkPattern = /!?\[([^\]]*)\]\([^)]*\)/gu
  const wikiLabeledLinkPattern = /\[\[([^\]|]+)\|([^\]]+)\]\]/gu
  return (
    value
      .normalize('NFKC')
      .replaceAll(markdownLinkPattern, (_match: string, label: string) => label)
      .replaceAll(wikiLabeledLinkPattern, (_match: string, _target: string, label: string) => label)
      // No `+` here: each stripped character becomes its own single-space replacement, and the
      // `\s+` collapse immediately below always runs afterward, absorbing any resulting run —
      // a `+` here would be unobservable given that guaranteed follow-up pass.
      .replaceAll(/[^\p{L}\p{N}]/gu, ' ')
      .trim()
      .replaceAll(/\s+/gu, ' ')
      .toLowerCase()
  )
}

/**
 * Mask markdown inline links `[label](url)` to spaces so exact prose matching ignores
 * link targets; wiki links `[[...]]` are left untouched (module docstring). The label
 * matches up to the LAST unmatched `[` before a `](`, mirroring the equivalent character-
 * scanning algorithm this replaced: `(?!\]\()[^[]` forbids the label from crossing another
 * `[` (a later `[` wins, like re-assigning `open`) or from swallowing a `](` pair (which
 * would end the label early, like the `open !== -1` match). The URL supports up to 4
 * levels of nested parens — real wiki/GitHub URLs never approach that (Wikipedia-style
 * disambiguation nests one level); deeper nesting is a documented, tested boundary (see
 * corrections-survival.test.ts's `maskMarkdownLinks` corpus), not an unfounded assumption.
 */
function maskMarkdownLinks(content: string): string {
  const pattern = /\[(?:(?!\]\()[^[])*\]\((?:[^()]|\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\))*\)/gu
  return content.replaceAll(pattern, match => ' '.repeat(match.length))
}
