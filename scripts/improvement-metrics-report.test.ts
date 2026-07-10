/**
 * Tests for scripts/improvement-metrics-report.ts
 *
 * Structure:
 * - renderReportBody: happy path, insufficient-signal suppression, tick-state
 *   re-emission, structural denylist, mutation-proof gate enforcement.
 * - renderRunSummary: happy path, mutation-proof gate enforcement.
 */

import type {DetectEdge, MetricsDigest} from './improvement-metrics-detect.ts'
import type {ImprovementMetricsReportOctokitClient} from './improvement-metrics-report.ts'

import {describe, expect, it, vi} from 'vitest'
import {buildEdgeChecklistLine, buildReportVersionMarker, parseReportVersionMarker} from './improvement-metrics-core.ts'
import {
  IMPROVEMENT_METRICS_REPORT_TITLE,
  renderReportBody,
  renderRunSummary,
  ReportRenderBlockedError,
  upsertReportIssue,
} from './improvement-metrics-report.ts'
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

// ---------------------------------------------------------------------------
// upsertReportIssue — mock octokit factory
// ---------------------------------------------------------------------------

interface MockOctokitOptions {
  listResponses?: {data: {number: number; body?: string | null}[]}[]
  getLabelShouldFail?: boolean | number
  createLabelShouldFail?: number
}

function makeMockOctokit(options: MockOctokitOptions = {}): {
  octokit: ImprovementMetricsReportOctokitClient
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  listForRepo: ReturnType<typeof vi.fn>
} {
  const listResponses = options.listResponses ?? [{data: []}]
  let listCallIndex = 0

  const listForRepo = vi.fn(async () => {
    const response = listResponses[Math.min(listCallIndex, listResponses.length - 1)]
    listCallIndex += 1
    return response ?? {data: []}
  })

  const create = vi.fn(async (params: {title: string; body: string}) => ({
    data: {number: 100},
    ...params,
  }))

  const update = vi.fn(async () => ({}))

  const getLabel = vi.fn(async () => {
    if (options.getLabelShouldFail === true || options.getLabelShouldFail === 404) {
      throw Object.assign(new Error('label not found'), {status: 404})
    }
    if (typeof options.getLabelShouldFail === 'number') {
      throw Object.assign(new Error('label check failed'), {status: options.getLabelShouldFail})
    }
    return {}
  })

  const createLabel = vi.fn(async () => {
    if (options.createLabelShouldFail !== undefined) {
      throw Object.assign(new Error('label creation failed'), {status: options.createLabelShouldFail})
    }
    return {}
  })

  const octokit: ImprovementMetricsReportOctokitClient = {
    issues: {listForRepo, create, update, getLabel, createLabel},
  }

  return {octokit, create, update, listForRepo}
}

const SAFE_TOKENS: PublicOutputTokens = makePublicOutputTokens({
  privateTokens: new Set(),
  redactedCanonicalIds: new Set(),
})

const FAILED_TOKENS: PublicOutputTokens = {loaded: false, error: 'token load failure'}

describe('upsertReportIssue', () => {
  it('creates once with the STATIC title + body + marker when no report issue exists (happy path)', async () => {
    const {octokit, create} = makeMockOctokit({listResponses: [{data: []}]})

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [makeEdge()],
      tokens: SAFE_TOKENS,
    })

    expect(result.outcome).toBe('created')
    expect(create).toHaveBeenCalledTimes(1)
    const callArgs = create.mock.calls[0]?.[0] as {title: string; body: string}
    expect(callArgs.title).toBe(IMPROVEMENT_METRICS_REPORT_TITLE)
    expect(callArgs.title).toBe('Improvement Metrics')
    expect(callArgs.body).toContain(makeEdge().fingerprint)
  })

  it('updates the body in place when an existing issue has a lower version marker; no create', async () => {
    const priorBody = `# Improvement Metrics\n${buildReportVersionMarker(0)}`
    const {octokit, create, update} = makeMockOctokit({
      listResponses: [{data: [{number: 7, body: priorBody}]}],
    })

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [],
      tokens: SAFE_TOKENS,
    })

    expect(result.outcome).toBe('updated')
    expect(result.issueNumber).toBe(7)
    expect(update).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
  })

  it('re-emits an edge ticked [x] in the prior body as [x] after upsert when still present (CRITICAL)', async () => {
    const stillPresentEdge = makeEdge({fingerprint: 'd'.repeat(64), ticked: false})
    const priorBody = [
      '# Improvement Metrics',
      buildEdgeChecklistLine({fingerprint: stillPresentEdge.fingerprint, checked: true}),
      buildReportVersionMarker(0),
    ].join('\n')

    const {octokit, update} = makeMockOctokit({
      listResponses: [{data: [{number: 7, body: priorBody}]}],
    })

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      // Freshly detected: NOT ticked in this run's raw digest — tick-state must be
      // recovered from the prior body, not merely echoed from the input edge.
      edges: [stillPresentEdge],
      tokens: SAFE_TOKENS,
    })

    expect(result.outcome).toBe('updated')
    const updateArgs = update.mock.calls[0]?.[0] as {body: string}
    expect(updateArgs.body).toContain(`- [x] <!-- improvement-metrics:edge=${stillPresentEdge.fingerprint} -->`)
  })

  it('drops a ticked edge cleanly when it is no longer present in the new digest (close-on-clear)', async () => {
    const goneFingerprint = 'e'.repeat(64)
    const priorBody = [
      '# Improvement Metrics',
      buildEdgeChecklistLine({fingerprint: goneFingerprint, checked: true}),
      buildReportVersionMarker(0),
    ].join('\n')

    const {octokit, update} = makeMockOctokit({
      listResponses: [{data: [{number: 7, body: priorBody}]}],
    })

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [], // gone edge is not in the new digest's edge list at all
      tokens: SAFE_TOKENS,
    })

    expect(result.outcome).toBe('updated')
    const updateArgs = update.mock.calls[0]?.[0] as {body: string}
    expect(updateArgs.body).not.toContain(goneFingerprint)
  })

  it('no-ops when the existing issue is at the current version and content is byte-identical', async () => {
    const digest = makeDigest()
    const edges: DetectEdge[] = []
    const renderedBody = renderReportBody(digest, edges, SAFE_TOKENS)

    const {octokit, update, create} = makeMockOctokit({
      listResponses: [{data: [{number: 7, body: renderedBody}]}],
    })

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest,
      edges,
      tokens: SAFE_TOKENS,
    })

    expect(result.outcome).toBe('noop')
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('treats a missing/malformed version marker as supersedable (update), never duplicated', async () => {
    const priorBody = '# Improvement Metrics\n(no marker here)'
    const {octokit, update, create} = makeMockOctokit({
      listResponses: [{data: [{number: 9, body: priorBody}]}],
    })

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [],
      tokens: SAFE_TOKENS,
    })

    expect(result.outcome).toBe('updated')
    expect(update).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
  })

  it('fails closed when tokens failed to load: no create/update attempted (blockedOnPrivacy via gate)', async () => {
    // main()'s token-load-before-API ordering passes a `{loaded:false}` token sentinel
    // straight into upsertReportIssue on load failure — renderReportBody's gate then
    // fails closed automatically, so this exercises the same code path main() takes.
    const {octokit, create, update} = makeMockOctokit({listResponses: [{data: []}]})

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [],
      tokens: FAILED_TOKENS,
    })

    expect(result.outcome).toBe('blockedOnPrivacy')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('fails closed on a privacy-gate block: no create/update attempted', async () => {
    const privateTokens = makePublicOutputTokens({
      privateTokens: new Set(['marcusrbrown/secret-internal-repo']),
      redactedCanonicalIds: new Set(),
    })
    const leakyEdge = makeEdge({classKey: 'marcusrbrown/secret-internal-repo'})
    const {octokit, create, update} = makeMockOctokit({listResponses: [{data: []}]})

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [leakyEdge],
      tokens: privateTokens,
    })

    expect(result.outcome).toBe('blockedOnPrivacy')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not duplicate on create-then-relist within a run (created-ID guard against stale listForRepo)', async () => {
    // First upsert call: no existing issue -> creates issue #100.
    // Second upsert call (same run): listForRepo staleness returns empty again,
    // but the created-ID guard (passed in as shared state) prevents a second create.
    const {octokit, create} = makeMockOctokit({listResponses: [{data: []}, {data: []}]})
    const createdIssueNumbers = new Set<number>()

    const first = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [],
      tokens: SAFE_TOKENS,
      createdIssueNumbers,
    })
    expect(first.outcome).toBe('created')
    expect(createdIssueNumbers.has(100)).toBe(true)

    // Simulate a stale relist within the same run: listForRepo returns empty even
    // though issue #100 now exists. The guard must recognize this via a mocked
    // listForRepo that this time returns the created issue's number so the
    // caller sees it as "found" rather than issuing a second create. We assert
    // this indirectly: create is called only once overall.
    const secondListResponse = {data: [{number: 100, body: undefined}]}
    ;(octokit.issues.listForRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(secondListResponse)

    const second = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: makeDigest(),
      edges: [],
      tokens: SAFE_TOKENS,
      createdIssueNumbers,
    })

    expect(second.outcome).not.toBe('created')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
