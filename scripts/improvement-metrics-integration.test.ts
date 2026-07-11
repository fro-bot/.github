/**
 * Golden-path integration test for the improvement-metric loop.
 *
 * Drives the REAL detect -> render -> upsert compose path on real-shaped
 * fixtures: `computeMetrics` (pure core) -> `renderReportBody` (pure render,
 * invoked internally by `upsertReportIssue`) -> `upsertReportIssue` (I/O
 * shell), against a hand-rolled mock octokit at the upsert boundary only.
 * `applyPublicOutputGate` is exercised for real via `makePublicOutputTokens`
 * — never mocked — so a removed gate call or an altered state-ladder
 * threshold fails this test (the anti-recurrence contract).
 *
 * Structure:
 * - happy end-to-end: correct paired counts, selected state, backlog surfacing
 * - tick-state preservation across upsert (ticked edge stays [x], unticked stays [ ])
 * - confirmed recidivism counts only the ticked edge
 * - mutation-proof: a private-identifier-shaped string reaching the body via a
 *   fixture field blocks the render AND performs no upsert
 */

import type {ProposalEvent, SolutionDocRecord} from './improvement-metrics-detect.ts'
import type {ImprovementMetricsReportOctokitClient} from './improvement-metrics-report.ts'

import {randomUUID} from 'node:crypto'
import {rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildClassKey, buildEdgeFingerprint} from './improvement-metrics-core.ts'
import {computeMetrics, recoverPriorTickState, writeImprovementMetricsDigestFile} from './improvement-metrics-detect.ts'
import {
  readDigestFile,
  renderReportBody,
  ReportRenderBlockedError,
  upsertReportIssue,
} from './improvement-metrics-report.ts'
import {makePublicOutputTokens, type PublicOutputTokens} from './status-truth-public-output.ts'

const NOW = new Date('2026-07-10T00:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

const NO_PRIVATE_TOKENS: PublicOutputTokens = makePublicOutputTokens({
  privateTokens: new Set(),
  redactedCanonicalIds: new Set(),
})

// ---------------------------------------------------------------------------
// Real-shaped fixtures
// ---------------------------------------------------------------------------

const RETRY_DOC: SolutionDocRecord = {
  frontmatter: {module: 'scripts/retry.ts', component: undefined, problem_type: 'retry-storms'},
  title: 'Retry idempotent writes after 5xx failures',
  tags: ['best-practice', 'retries'],
  gitAddDate: daysAgo(10), // in-window
}

const AUTH_DOC: SolutionDocRecord = {
  frontmatter: {module: 'scripts/auth.ts', component: undefined, problem_type: 'token-expiry'},
  title: 'Refresh auth tokens before expiry',
  tags: ['best-practice', 'auth'],
  gitAddDate: daysAgo(20), // in-window
}

const CACHE_DOC: SolutionDocRecord = {
  frontmatter: {module: 'scripts/cache.ts', component: undefined, problem_type: 'cache-invalidation'},
  title: 'Invalidate cache on region rotation',
  tags: ['best-practice', 'cache'],
  gitAddDate: daysAgo(150), // in prior window only
}

const QUEUE_DOC: SolutionDocRecord = {
  frontmatter: {module: 'scripts/queue.ts', component: undefined, problem_type: 'queue-backpressure'},
  title: 'Apply backpressure under queue overflow',
  tags: ['best-practice', 'queue'],
  gitAddDate: daysAgo(200), // outside both windows
}

const SOLUTION_DOCS: readonly SolutionDocRecord[] = [RETRY_DOC, AUTH_DOC, CACHE_DOC, QUEUE_DOC]

const RETRY_EVENT: ProposalEvent = {
  id: '201',
  title: 'Retry storm on 5xx errors during deploy',
  // Tag match against RETRY_DOC.tags ('retries') is the strong-match signal here, deliberately
  // independent of frontmatter.module — the mutation-proof test below rewrites RETRY_DOC.module
  // to inject a private token, and the strong match must survive that mutation on its own merits.
  labels: ['learning-proposal', 'retries'],
  createdAt: daysAgo(5),
  url: 'https://github.com/fro-bot/.github/issues/201',
}

const AUTH_EVENT: ProposalEvent = {
  id: '202',
  title: 'Auth token refresh flake causing 401s',
  labels: ['learning-proposal', 'auth'],
  createdAt: daysAgo(8),
  url: 'https://github.com/fro-bot/.github/issues/202',
}

const PROPOSAL_EVENTS: readonly ProposalEvent[] = [RETRY_EVENT, AUTH_EVENT]

const RETRY_CLASS_KEY = buildClassKey(RETRY_DOC.frontmatter)
const AUTH_CLASS_KEY = buildClassKey(AUTH_DOC.frontmatter)
const RETRY_FINGERPRINT = buildEdgeFingerprint(RETRY_CLASS_KEY, RETRY_EVENT.id)
const AUTH_FINGERPRINT = buildEdgeFingerprint(AUTH_CLASS_KEY, AUTH_EVENT.id)

/**
 * A prior report body as would be produced by a previous `renderReportBody` run:
 * the retry edge ticked (confirmed last time), the auth edge unticked (still backlog).
 */
function buildPriorReportBody(): string {
  return renderReportBody(
    {
      windowDays: 90,
      anchors: 3,
      discovery: 1,
      priorDiscovery: 1,
      confirmedRecidivism: 1,
      backlogCount: 1,
      oldestPendingAgeDays: 3,
      state: 'healthy',
    },
    [
      {
        fingerprint: RETRY_FINGERPRINT,
        classKey: RETRY_CLASS_KEY,
        eventId: RETRY_EVENT.id,
        eventUrl: RETRY_EVENT.url,
        eventCreatedAt: RETRY_EVENT.createdAt,
        ticked: true,
      },
      {
        fingerprint: AUTH_FINGERPRINT,
        classKey: AUTH_CLASS_KEY,
        eventId: AUTH_EVENT.id,
        eventUrl: AUTH_EVENT.url,
        eventCreatedAt: AUTH_EVENT.createdAt,
        ticked: false,
      },
    ],
    NO_PRIVATE_TOKENS,
  )
}

// ---------------------------------------------------------------------------
// Hand-rolled mock octokit (upsert boundary only)
// ---------------------------------------------------------------------------

function makeMockOctokit(existingBody: string | null): {
  octokit: ImprovementMetricsReportOctokitClient
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
} {
  const listForRepo = vi.fn(async () => ({
    data: existingBody === null ? [] : [{number: 501, body: existingBody}],
  }))
  const create = vi.fn(async (params: {title: string; body: string}) => ({data: {number: 501}, ...params}))
  const update = vi.fn(async () => ({}))
  const getLabel = vi.fn(async () => ({}))
  const createLabel = vi.fn(async () => ({}))

  return {
    octokit: {issues: {listForRepo, create, update, getLabel, createLabel}},
    create,
    update,
  }
}

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

describe('improvement-metrics golden path (detect -> render -> upsert)', () => {
  it('computes correct paired counts, state, and backlog from real-shaped sources', () => {
    const priorBody = buildPriorReportBody()
    const priorTickState = recoverPriorTickState(priorBody)

    const {digest, edges} = computeMetrics({
      solutionDocs: SOLUTION_DOCS,
      proposalEvents: PROPOSAL_EVENTS,
      priorTickState,
      now: NOW,
    })

    expect(digest.anchors).toBe(4)
    expect(digest.discovery).toBe(2) // retry + auth, in-window
    expect(digest.priorDiscovery).toBe(1) // cache, in prior window
    expect(digest.confirmedRecidivism).toBe(1) // retry edge ticked
    expect(digest.backlogCount).toBe(1) // auth edge unticked
    expect(digest.oldestPendingAgeDays).not.toBeNull()
    expect(digest.state).toBe('healthy')

    const retryEdge = edges.find(e => e.fingerprint === RETRY_FINGERPRINT)
    const authEdge = edges.find(e => e.fingerprint === AUTH_FINGERPRINT)
    expect(retryEdge?.ticked).toBe(true)
    expect(authEdge?.ticked).toBe(false)
  })

  it('preserves tick state across upsert: the ticked edge is re-emitted [x], the unticked stays [ ]', async () => {
    const priorBody = buildPriorReportBody()
    const priorTickState = recoverPriorTickState(priorBody)

    const {digest, edges} = computeMetrics({
      solutionDocs: SOLUTION_DOCS,
      proposalEvents: PROPOSAL_EVENTS,
      priorTickState,
      now: NOW,
    })

    const {octokit, create, update} = makeMockOctokit(priorBody)

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest,
      edges,
      tokens: NO_PRIVATE_TOKENS,
    })

    expect(result.outcome).toBe('updated')
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)

    const updateCall = update.mock.calls[0]?.[0] as {body: string}
    expect(updateCall.body).toContain(`- [x] <!-- improvement-metrics:edge=${RETRY_FINGERPRINT} -->`)
    expect(updateCall.body).toContain(`- [ ] <!-- improvement-metrics:edge=${AUTH_FINGERPRINT} -->`)

    // Backlog surfacing: the unticked candidate's age is present.
    expect(updateCall.body).toContain('Pending backlog: 1')
    expect(updateCall.body).toMatch(/oldest pending candidate: \d+(\.\d+)?d/u)

    // Public-safe: no fixture private-identifier string leaks (there are none here,
    // but this locks that a clean fixture renders a clean body).
    expect(updateCall.body).not.toMatch(/marcusrbrown\/secret-internal-repo/u)
  })

  it('MUTATION-PROOF: a private-identifier-shaped string reaching the body blocks render and performs no upsert', async () => {
    const PRIVATE_TOKEN = 'marcusrbrown/secret-internal-repo'
    const maliciousTokens = makePublicOutputTokens({
      privateTokens: new Set([PRIVATE_TOKEN]),
      redactedCanonicalIds: new Set(),
    })

    // Inject the private token via a classKey-derived field (frontmatter.module),
    // the only free-text-shaped field that flows into the rendered checklist.
    const maliciousDoc: SolutionDocRecord = {
      ...RETRY_DOC,
      frontmatter: {...RETRY_DOC.frontmatter, module: PRIVATE_TOKEN},
    }

    const {digest, edges} = computeMetrics({
      solutionDocs: [maliciousDoc, AUTH_DOC, CACHE_DOC, QUEUE_DOC],
      proposalEvents: PROPOSAL_EVENTS,
      priorTickState: new Set(),
      now: NOW,
    })

    // Direct render call: this MUST throw if the gate is real and wired in.
    expect(() => renderReportBody(digest, edges, maliciousTokens)).toThrow(ReportRenderBlockedError)

    // Compose-path assertion: upsertReportIssue must perform NO create/update.
    const {octokit, create, update} = makeMockOctokit(null)

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest,
      edges,
      tokens: maliciousTokens,
    })

    expect(result.outcome).toBe('blockedOnPrivacy')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Detect-write -> report-read file serialization contract
// ---------------------------------------------------------------------------

describe('detect-file-write -> report-file-read serialization contract', () => {
  const priorDigestPathEnv = process.env.IMPROVEMENT_METRICS_DIGEST_PATH
  let digestPath: string

  afterEach(async () => {
    if (priorDigestPathEnv === undefined) {
      delete process.env.IMPROVEMENT_METRICS_DIGEST_PATH
    } else {
      process.env.IMPROVEMENT_METRICS_DIGEST_PATH = priorDigestPathEnv
    }
    await rm(digestPath, {force: true})
  })

  it('the {digest, edges} shape written by writeImprovementMetricsDigestFile survives a real file round-trip into upsertReportIssue', async () => {
    digestPath = join(tmpdir(), `improvement-metrics-digest-${randomUUID()}.json`)
    process.env.IMPROVEMENT_METRICS_DIGEST_PATH = digestPath

    const {digest, edges} = computeMetrics({
      solutionDocs: SOLUTION_DOCS,
      proposalEvents: PROPOSAL_EVENTS,
      priorTickState: new Set(),
      now: NOW,
    })

    // Real detect-side writer: writes {digest, edges} to IMPROVEMENT_METRICS_DIGEST_PATH.
    await writeImprovementMetricsDigestFile(digest, edges)

    // Real report-side reader: reads the same path and casts to {digest, edges}.
    const digestFile = await readDigestFile(digestPath)

    // This is the exact assertion that fails against the `tee`-clobber defect: if the
    // workflow's tee had overwritten the file with the detect script's flat stdout
    // DetectResult (no `digest`/`edges` wrapper), `digestFile.digest` and
    // `digestFile.edges` would be `undefined` here, and upsertReportIssue would throw
    // (or silently render `undefined` state) instead of returning `created`/`updated`.
    expect(digestFile.digest).toEqual(digest)
    expect(digestFile.edges).toEqual(edges)

    const {octokit, create} = makeMockOctokit(null)

    const result = await upsertReportIssue({
      octokit,
      owner: 'fro-bot',
      repo: '.github',
      digest: digestFile.digest,
      edges: digestFile.edges,
      tokens: NO_PRIVATE_TOKENS,
    })

    expect(result.outcome).toBe('created')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
