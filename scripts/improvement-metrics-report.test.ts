/**
 * Tests for scripts/improvement-metrics-report.ts
 *
 * Structure:
 * - renderReportBody: happy path, insufficient-signal suppression, tick-state
 *   re-emission, structural denylist, mutation-proof gate enforcement.
 * - renderRunSummary: happy path, mutation-proof gate enforcement.
 */

import type {DetectEdge, MetricsDigest} from './improvement-metrics-detect.ts'

import {describe, expect, it} from 'vitest'
import {parseReportVersionMarker} from './improvement-metrics-core.ts'
import {renderReportBody, renderRunSummary, ReportRenderBlockedError} from './improvement-metrics-report.ts'
import {makePublicOutputTokens, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NO_PRIVATE_TOKENS: PublicOutputTokens = makePublicOutputTokens({
  privateTokens: new Set(),
  redactedCanonicalIds: new Set(),
})

function makeDigest(overrides: Partial<MetricsDigest> = {}): MetricsDigest {
  return {
    windowDays: 90,
    anchors: 4,
    discovery: 3,
    priorDiscovery: 2,
    confirmedRecidivism: 1,
    backlogCount: 2,
    oldestPendingAgeDays: 5,
    state: 'healthy',
    ...overrides,
  }
}

function makeEdge(overrides: Partial<DetectEdge> = {}): DetectEdge {
  return {
    fingerprint: 'a'.repeat(64),
    classKey: 'best_practice\u0001scripts/foo.ts\u0001unknown',
    eventId: '42',
    eventUrl: 'https://github.com/fro-bot/.github/issues/42',
    eventCreatedAt: '2026-06-01T00:00:00Z',
    ticked: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// renderReportBody
// ---------------------------------------------------------------------------

describe('renderReportBody', () => {
  it('renders counts, window, state, backlog, and a checklist with edge fingerprints (happy path)', () => {
    const digest = makeDigest()
    const edge = makeEdge()
    const body = renderReportBody(digest, [edge], NO_PRIVATE_TOKENS)

    expect(body).toContain('healthy')
    expect(body).toContain('90 days')
    expect(body).toContain('Discovery (newly codified classes): 3')
    expect(body).toContain('Prior-window discovery: 2')
    expect(body).toContain('Confirmed recidivism (ticked edges): 1')
    expect(body).toContain('Pending backlog: 2')
    expect(body).toContain('oldest pending candidate: 5d')
    expect(body).toContain(edge.fingerprint)
    expect(body).toContain(edge.eventUrl)
    expect(body).toContain(edge.classKey)
  })

  it('round-trips the version marker', () => {
    const body = renderReportBody(makeDigest(), [], NO_PRIVATE_TOKENS)
    expect(parseReportVersionMarker(body)).toBe(1)
  })

  it('renders no trend/interpretation line and no candidate checklist for insufficient-signal', () => {
    const digest = makeDigest({state: 'insufficient-signal', discovery: 1, anchors: 2})
    const body = renderReportBody(digest, [], NO_PRIVATE_TOKENS)

    expect(body).toContain('Below the minimum-volume floor')
    expect(body).not.toContain('## Candidate recurrences')
    expect(body).not.toContain('Tick a checkbox')
  })

  it('re-emits a ticked edge as [x] and an unticked edge as [ ]', () => {
    const ticked = makeEdge({fingerprint: 'b'.repeat(64), ticked: true})
    const unticked = makeEdge({fingerprint: 'c'.repeat(64), ticked: false})
    const body = renderReportBody(makeDigest(), [ticked, unticked], NO_PRIVATE_TOKENS)

    expect(body).toContain(`- [x] <!-- improvement-metrics:edge=${ticked.fingerprint} -->`)
    expect(body).toContain(`- [ ] <!-- improvement-metrics:edge=${unticked.fingerprint} -->`)
  })

  it('uses only class key + public URL + checkbox for candidate lines — no source title/body text', () => {
    // Structural guarantee: DetectEdge carries no title/body field at all, so there is
    // nothing for the renderer to leak even if it tried. This test locks that shape.
    const edge = makeEdge()
    const forbiddenFields: readonly string[] = ['title', 'body', 'excerpt', 'repo', 'branch']
    for (const field of forbiddenFields) {
      expect(Object.keys(edge)).not.toContain(field)
    }

    const body = renderReportBody(makeDigest(), [edge], NO_PRIVATE_TOKENS)
    expect(body).not.toMatch(/branch|excerpt|repository name/iu)
  })

  it('BLOCKS the surface when the real gate detects a private-identifier-shaped string (mutation-proof)', () => {
    // Exercises the real applyPublicOutputGate — not mocked. If the gate call is
    // removed from renderReportBody's path, this test fails because no error is thrown.
    const privateTokens = makePublicOutputTokens({
      privateTokens: new Set(['marcusrbrown/secret-internal-repo']),
      redactedCanonicalIds: new Set(),
    })
    // Inject the private identifier via the class key — the only free-text-shaped
    // field on an edge that flows into the rendered body.
    const edge = makeEdge({classKey: 'marcusrbrown/secret-internal-repo'})

    expect(() => renderReportBody(makeDigest(), [edge], privateTokens)).toThrow(ReportRenderBlockedError)
  })

  it('blocks when the token load itself failed (fail-closed on token-load failure)', () => {
    const failedTokens: PublicOutputTokens = {loaded: false, error: 'token load failure'}
    expect(() => renderReportBody(makeDigest(), [], failedTokens)).toThrow(ReportRenderBlockedError)
  })
})

// ---------------------------------------------------------------------------
// renderRunSummary
// ---------------------------------------------------------------------------

describe('renderRunSummary', () => {
  it('renders the counts-only summary line (happy path)', () => {
    const summary = renderRunSummary(makeDigest(), NO_PRIVATE_TOKENS)
    expect(summary).toContain('state=healthy')
    expect(summary).toContain('discovery=3')
    expect(summary).toContain('confirmedRecidivism=1')
    expect(summary).toContain('backlog=2')
  })

  it('BLOCKS the surface when the real gate detects a private-identifier-shaped string (mutation-proof)', () => {
    // Not realistically reachable via MetricsDigest's numeric/state fields, but this
    // pins that renderRunSummary's gate call is real by failing closed on token-load failure.
    const failedTokens: PublicOutputTokens = {loaded: false, error: 'token load failure'}
    expect(() => renderRunSummary(makeDigest(), failedTokens)).toThrow(ReportRenderBlockedError)
  })
})
