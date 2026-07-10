/**
 * Public-safe report rendering for the improvement-metric loop.
 *
 * Pure render functions only — the upsert I/O shell and `main()` are added by
 * Unit 4. This module never touches octokit, the filesystem, or the network.
 *
 * Every rendered surface is routed through `applyPublicOutputGate` before it is
 * returned. A gate failure blocks that surface outright (throws
 * `ReportRenderBlockedError`) — there is no advisory-only fallback (R19).
 *
 * The candidate checklist is public-safe by construction: `DetectEdge` (from
 * `improvement-metrics-detect.ts`) carries only `{fingerprint, classKey, eventId,
 * eventUrl, eventCreatedAt, ticked}` — no source title or body excerpt is even in
 * scope for these render functions, which makes the R20 denylist structural
 * rather than a runtime check (R20).
 *
 * Strip-only safe: no enums, namespaces, parameter properties, or `any`.
 */

import type {DetectEdge, MetricsDigest} from './improvement-metrics-detect.ts'
import {buildEdgeChecklistLine, buildReportVersionMarker} from './improvement-metrics-core.ts'
import {applyPublicOutputGate, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Gate-failure contract
// ---------------------------------------------------------------------------

/**
 * Thrown when a rendered surface fails `applyPublicOutputGate`. Fail-closed by
 * construction: the caller (Unit 4's I/O shell) must catch this and perform no
 * write, never fall back to an unsanitized or partially-sanitized body (R19).
 */
export class ReportRenderBlockedError extends Error {
  readonly surface: string
  readonly blockReason: string

  constructor(surface: string, blockReason: string) {
    super(`improvement-metrics-report: blocked rendering surface "${surface}": ${blockReason}`)
    this.name = 'ReportRenderBlockedError'
    this.surface = surface
    this.blockReason = blockReason
  }
}

/** Current report body schema version, embedded via the hidden version marker. */
export const REPORT_BODY_VERSION = 1

// ---------------------------------------------------------------------------
// Report body rendering
// ---------------------------------------------------------------------------

function renderCandidateChecklist(edges: readonly DetectEdge[]): string[] {
  if (edges.length === 0) {
    return ['(no pending or confirmed candidates this run)']
  }
  const sorted = [...edges].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
  return sorted.map(edge => {
    const checklistLine = buildEdgeChecklistLine({fingerprint: edge.fingerprint, checked: edge.ticked})
    return `${checklistLine}\n  - class: \`${edge.classKey}\` — ${edge.eventUrl}`
  })
}

/**
 * Render the perpetual report issue body from the digest + edge list.
 *
 * Public-safe by construction: the checklist is built only from each edge's
 * class key, public issue URL, and checkbox+fingerprint marker — never a
 * source title, body excerpt, or repo/branch name (R20). Ticked edges still
 * present in `edges` are re-emitted as `[x]` via `edge.ticked`.
 *
 * Below the `insufficient-signal` floor, no trend/interpretation line and no
 * candidate checklist are rendered (Unit 2 already suppresses candidate
 * surfacing at that floor, so `edges` is expected empty in that state).
 *
 * @throws {ReportRenderBlockedError} if the rendered body fails the public-output gate (R19).
 */
export function renderReportBody(
  digest: MetricsDigest,
  edges: readonly DetectEdge[],
  tokens: PublicOutputTokens,
): string {
  const lines: string[] = []

  lines.push('# Improvement Metrics')
  lines.push('')
  lines.push(`Report state: **${digest.state}**`)
  lines.push('')
  lines.push(`Window: ${digest.windowDays} days`)
  lines.push(`Codified anchors in window: ${digest.anchors}`)
  lines.push(`Discovery (newly codified classes): ${digest.discovery}`)
  lines.push(`Prior-window discovery: ${digest.priorDiscovery}`)
  lines.push(`Confirmed recidivism (ticked edges): ${digest.confirmedRecidivism}`)
  lines.push(
    `Pending backlog: ${digest.backlogCount}${
      digest.oldestPendingAgeDays === null ? '' : ` (oldest pending candidate: ${digest.oldestPendingAgeDays}d)`
    }`,
  )
  lines.push('')

  if (digest.state === 'insufficient-signal') {
    lines.push('_Below the minimum-volume floor — no trend or interpretation is claimed this run._')
  } else {
    lines.push('## Candidate recurrences')
    lines.push('')
    lines.push('Tick a checkbox below to confirm a recurrence. Confirmed edges persist across rewrites.')
    lines.push('')
    lines.push(...renderCandidateChecklist(edges))
  }

  lines.push('')
  lines.push(buildReportVersionMarker(REPORT_BODY_VERSION))

  const body = lines.join('\n')

  const gate = applyPublicOutputGate({
    surface: 'proposal-body',
    content: body,
    tokens,
    fingerprint: undefined,
  })

  if (!gate.allowed) {
    throw new ReportRenderBlockedError('proposal-body', gate.blockReason)
  }

  return gate.sanitizedContent
}

// ---------------------------------------------------------------------------
// Workflow run summary rendering
// ---------------------------------------------------------------------------

/**
 * Render the counts-only workflow step-summary line for the report job.
 *
 * Counts-only surface: `fingerprint` is always `undefined`, per the gate's
 * counts-only-surface enforcement.
 *
 * @throws {ReportRenderBlockedError} if the rendered summary fails the public-output gate (R19).
 */
export function renderRunSummary(digest: MetricsDigest, tokens: PublicOutputTokens): string {
  const summary =
    `Improvement Metrics: state=${digest.state} discovery=${digest.discovery}` +
    ` (prior=${digest.priorDiscovery}) confirmedRecidivism=${digest.confirmedRecidivism}` +
    ` backlog=${digest.backlogCount}${
      digest.oldestPendingAgeDays === null ? '' : ` oldestPendingAgeDays=${digest.oldestPendingAgeDays}`
    } window=${digest.windowDays}d anchors=${digest.anchors}`

  const gate = applyPublicOutputGate({
    surface: 'workflow-summary-row',
    content: summary,
    tokens,
    fingerprint: undefined,
  })

  if (!gate.allowed) {
    throw new ReportRenderBlockedError('workflow-summary-row', gate.blockReason)
  }

  return gate.sanitizedContent
}
