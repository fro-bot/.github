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
  const pagesByNodeId = new Map<string, (typeof pages)[number]>()
  const fallbackPagesByNodeId = new Map<string, (typeof fallbackPages)[number]>()
  for (const page of pages) {
    const nodeId = page.frontmatter.node_id
    if (typeof nodeId === 'string' && nodeId !== '') pagesByNodeId.set(nodeId, page)
  }
  for (const page of fallbackPages) {
    const nodeId = page.frontmatter.node_id
    if (typeof nodeId === 'string' && nodeId !== '') fallbackPagesByNodeId.set(nodeId, page)
  }

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

    const normalizedSpan = normalizeCorrectionText(correction.span.text)
    const proseBody = page === undefined ? '' : maskNonProseContent(page.body)
    const normalizedBody = normalizeCorrectionText(maskMarkdownLinks(proseBody))
    if (page === undefined || normalizedSpan === '' || !normalizedBody.includes(normalizedSpan)) {
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

function normalizeFormattingText(value: string): string {
  const markdownLinkPattern = /!?(?:\[([^\]]*)\]\([^)]*\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/gu
  return value
    .normalize('NFKC')
    .replaceAll(markdownLinkPattern, renderVisibleLinkText)
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .toLowerCase()
}

function renderVisibleLinkText(
  _match: string,
  markdownText: string | undefined,
  wikiTarget: string | undefined,
  wikiLabel: string | undefined,
): string {
  return markdownText ?? wikiLabel ?? wikiTarget ?? ''
}

function maskMarkdownLinks(content: string): string {
  const masked = content.split('')
  let open = -1
  let index = 0
  while (index < content.length) {
    if (content[index] === '[') open = index
    if (content[index] === ']' && content[index + 1] === '(' && open !== -1) {
      let close = index + 2
      let depth = 1
      while (close < content.length && depth > 0) {
        if (content[close] === '(') depth += 1
        else if (content[close] === ')') depth -= 1
        close += 1
      }
      if (depth === 0) {
        for (let maskIndex = open; maskIndex < close; maskIndex += 1) masked[maskIndex] = ' '
        index = close
        open = -1
        continue
      }
    }
    index += 1
  }
  return masked.join('')
}
