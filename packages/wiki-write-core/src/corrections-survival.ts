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
  // Keyed by `unknown`: correction.page_node_id is a validated non-empty string
  // (corrections.ts parseLooseCorrectionRecord), so unkeyable pages are never looked up.
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

    // normalizedSpan is never '' (assertCorrectionSpan, corrections.ts:185); page === undefined
    // forces proseBody '', and '' can never include a non-empty span, so that disjunct is dead.
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
 * Substitutes each link's visible label (markdown or wiki, labeled or bare) before the generic
 * punctuation strip below. Exported only for `corrections-survival.test.ts`'s exhaustive
 * differential test against the pre-refactor reference implementation.
 */
export function normalizeFormattingText(value: string): string {
  const markdownLinkPattern = /!?\[([^\]]*)\]\([^)]*\)/gu
  const wikiLinkPattern = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu
  return (
    value
      .normalize('NFKC')
      .replaceAll(markdownLinkPattern, (_match: string, label: string) => label)
      .replaceAll(wikiLinkPattern, (_match: string, target: string, label: string | undefined) => label ?? target)
      // `\s+` below absorbs any run this leaves; a `+` here would be unobservable.
      .replaceAll(/[^\p{L}\p{N}]/gu, ' ')
      .trim()
      .replaceAll(/\s+/gu, ' ')
      .toLowerCase()
  )
}

/**
 * Masks markdown inline links `[label](url)` to spaces so exact prose matching ignores link
 * targets; wiki links `[[...]]` are left untouched (module docstring). Ported from a
 * char-scanning algorithm; URLs nest parens up to 4 levels deep, a proven, tested bound.
 * KNOWN DIVERGENCE from the ported algorithm, found by exhaustive differential testing and not
 * yet resolved: a malformed link whose label is empty/near-empty and immediately followed by
 * another `](` that itself fails to close (e.g. `[](]()`) — see corrections-survival.test.ts.
 * Exported only for that test.
 */
export function maskMarkdownLinks(content: string): string {
  const pattern = /\[(?:(?!\]\()[^[])*\]\((?:[^()]|\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\))*\)/gu
  return content.replaceAll(pattern, match => ' '.repeat(match.length))
}
