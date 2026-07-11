/**
 * Tests for scripts/improvement-metrics-detect.ts
 *
 * Structure:
 * - scoreCandidateLink (O8-native asymmetric scorer)
 * - computeMetrics (pure core): discovery, recidivism, backlog, prior-window delta, state
 * - I/O shell: fetchProposalEventsFromRepo, recoverPriorTickState, writeImprovementMetricsDigestFile,
 *   loadGitAddDates fail-closed path
 */

import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {describe, expect, it} from 'vitest'
import {buildClassKey, buildEdgeFingerprint} from './improvement-metrics-core.ts'
import {
  computeMetrics,
  fetchProposalEventsFromRepo,
  loadGitAddDates,
  recoverPriorTickState,
  scoreCandidateLink,
  writeImprovementMetricsDigestFile,
  type ComputeMetricsInput,
  type ComputeMetricsResult,
  type ImprovementMetricsOctokitClient,
  type PriorTickState,
  type ProposalEvent,
  type SolutionDocRecord,
} from './improvement-metrics-detect.ts'

const NOW = new Date('2026-07-10T00:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function makeDoc(overrides: Partial<SolutionDocRecord> = {}): SolutionDocRecord {
  return {
    frontmatter: {module: 'scripts/foo.ts', component: undefined, problem_type: 'retry-storms'},
    title: 'Retry idempotent writes after 5xx failures',
    tags: ['best-practice', 'retries'],
    gitAddDate: daysAgo(10),
    ...overrides,
  }
}

function makeEvent(overrides: Partial<ProposalEvent> = {}): ProposalEvent {
  return {
    id: '101',
    title: 'Retry storm on 5xx during deploy',
    labels: ['learning-proposal'],
    createdAt: daysAgo(5),
    url: 'https://github.com/fro-bot/.github/issues/101',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// scoreCandidateLink
// ---------------------------------------------------------------------------

describe('scoreCandidateLink', () => {
  it('scores shared title tokens as a strong match', () => {
    const event = makeEvent({title: 'Retry idempotent writes flake in CI'})
    const doc = makeDoc({title: 'Retry idempotent writes after 5xx failures'})
    const result = scoreCandidateLink(event, doc)
    expect(result.strongMatch).toBe(true)
    expect(result.score).toBeGreaterThan(0)
  })

  it('scores a label matching a class tag as a strong match', () => {
    const event = makeEvent({title: 'Totally unrelated wording', labels: ['best-practice']})
    const doc = makeDoc({tags: ['best-practice']})
    const result = scoreCandidateLink(event, doc)
    expect(result.strongMatch).toBe(true)
  })

  it('module-token-only overlap is never a strong match on its own', () => {
    const event = makeEvent({title: 'The foo utility needs updating', labels: []})
    const doc = makeDoc({title: 'Nothing shared here at all', tags: [], frontmatter: {module: 'scripts/foo.ts'}})
    const result = scoreCandidateLink(event, doc)
    // "foo" token matches module ("foo" >= 3 chars, in scripts/foo.ts split), but no title/tag strong match.
    expect(result.strongMatch).toBe(false)
  })

  it('no overlap scores zero and no strong match', () => {
    const event = makeEvent({title: 'Completely unrelated rename config key', labels: ['unrelated-label']})
    const doc = makeDoc({title: 'Best practice guidance workflow hygiene', tags: ['hygiene'], frontmatter: {}})
    const result = scoreCandidateLink(event, doc)
    expect(result.score).toBe(0)
    expect(result.strongMatch).toBe(false)
  })

  it('a single generic shared title token is never a strong match on its own (generic-token noise defect)', () => {
    // Two independent title-token hits ("drift", "detection") but zero module correlation:
    // this is the exact shape of the #3667 x self-audit noise edge from the ground-truth walkthrough.
    const event = makeEvent({
      title: 'Pattern proposal: When building automated inspection or drift-detection systems',
      labels: ['pattern-proposal'],
    })
    const doc = makeDoc({
      title: 'Synthetic self-audit claim kinds for in-file drift detection',
      tags: ['status-truth', 'synthetic-claims', 'drift-detection', 'frontmatter'],
      frontmatter: {module: 'status-truth-detect'},
    })
    const result = scoreCandidateLink(event, doc)
    // score clears the numeric threshold (2 title tokens x 10 = 20) but must not be a strong match:
    // both shared tokens ("drift", "detection") are generic domain vocabulary with zero independent
    // module-token correlation.
    expect(result.score).toBeGreaterThanOrEqual(20)
    expect(result.strongMatch).toBe(false)
  })

  it('one generic title token combined with an independent module-token match IS a strong match', () => {
    // This is the true edge's exact anatomy: #3656 (status truth drift proposal) x the self-audit
    // class. Only "drift" is shared in title, but "status"/"truth" independently correlate against
    // the class's module tokens (status-truth-detect) -- cross-signal correlation, not generic noise.
    const event = makeEvent({
      title: 'Status truth: plan-consistency drift in docs/plans/2026-07-07-001-fix-a3-receipt-contract-state-plan.md',
      labels: [],
    })
    const doc = makeDoc({
      title: 'Synthetic self-audit claim kinds for in-file drift detection',
      tags: ['status-truth', 'synthetic-claims', 'drift-detection', 'frontmatter'],
      frontmatter: {module: 'status-truth-detect'},
    })
    const result = scoreCandidateLink(event, doc)
    expect(result.score).toBeGreaterThanOrEqual(20)
    expect(result.strongMatch).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// computeMetrics: happy path
// ---------------------------------------------------------------------------

describe('computeMetrics', () => {
  it('discovery counts distinct anchors once, not repeated proposals for the same class', () => {
    const docA = makeDoc({
      frontmatter: {module: 'scripts/a.ts', component: undefined, problem_type: 'retry-storms'},
      title: 'Retry idempotent writes after 5xx failures',
      tags: ['retries'],
      gitAddDate: daysAgo(10),
    })
    const docB = makeDoc({
      frontmatter: {module: 'scripts/b.ts', component: undefined, problem_type: 'cache-invalidation'},
      title: 'Cache invalidation on region rotation',
      tags: ['cache'],
      gitAddDate: daysAgo(20),
    })
    const docC = makeDoc({
      frontmatter: {module: 'scripts/c.ts', component: undefined, problem_type: 'unrelated-c'},
      title: 'Completely unrelated topic entirely',
      tags: [],
      gitAddDate: daysAgo(30),
    })
    const repeatedEvent1 = makeEvent({id: '1', title: 'Retry idempotent writes flake', createdAt: daysAgo(3)})
    const repeatedEvent2 = makeEvent({id: '2', title: 'Retry idempotent writes flake again', createdAt: daysAgo(2)})

    const input: ComputeMetricsInput = {
      solutionDocs: [docA, docB, docC],
      proposalEvents: [repeatedEvent1, repeatedEvent2],
      priorTickState: new Set([buildEdgeFingerprint('scripts/a.ts\u0001unknown\u0001retry-storms', '1')]),
      now: NOW,
    }
    const {digest, edges} = computeMetrics(input)

    expect(digest.anchors).toBe(3)
    // Discovery is driven by distinct in-window anchors, never by repeated proposal events.
    expect(digest.discovery).toBe(3)
    // A ticked edge (event 1 -> class A) raises recidivism.
    expect(digest.confirmedRecidivism).toBeGreaterThanOrEqual(1)
    // The unticked edge (event 2) must not count as recidivism.
    const event2Edges = edges.filter(e => e.eventId === '2')
    for (const edge of event2Edges) {
      if (edge.classKey.startsWith('scripts/a.ts')) expect(edge.ticked).toBe(false)
    }
  })

  it('below-floor volume renders insufficient-signal and suppresses all candidate surfacing', () => {
    const input: ComputeMetricsInput = {
      solutionDocs: [makeDoc({gitAddDate: daysAgo(5)})], // only 1 anchor, below MIN_ANCHORS=3
      proposalEvents: [makeEvent()],
      priorTickState: new Set(),
      now: NOW,
    }
    const {digest, edges} = computeMetrics(input)
    expect(digest.state).toBe('insufficient-signal')
    expect(edges.length).toBe(0)
    expect(digest.backlogCount).toBe(0)
  })

  it('discovery below prior window with no confirmed recidivism renders ambiguous', () => {
    // Prior window has 3 anchors; current window has only 3 anchors but discovery must be lower.
    // Use a config with lower thresholds tailored to this scenario.
    const priorDocs = [
      makeDoc({
        frontmatter: {module: 'p1', component: undefined, problem_type: 'p1'},
        gitAddDate: daysAgo(100),
      }),
      makeDoc({
        frontmatter: {module: 'p2', component: undefined, problem_type: 'p2'},
        gitAddDate: daysAgo(110),
      }),
      makeDoc({
        frontmatter: {module: 'p3', component: undefined, problem_type: 'p3'},
        gitAddDate: daysAgo(120),
      }),
    ]
    const currentDocs = [
      makeDoc({
        frontmatter: {module: 'c1', component: undefined, problem_type: 'c1'},
        gitAddDate: daysAgo(10),
      }),
      makeDoc({
        frontmatter: {module: 'c2', component: undefined, problem_type: 'c2'},
        gitAddDate: daysAgo(20),
      }),
    ]
    const input: ComputeMetricsInput = {
      solutionDocs: [...priorDocs, ...currentDocs],
      proposalEvents: [],
      priorTickState: new Set(),
      now: NOW,
    }
    const {digest} = computeMetrics(input)
    expect(digest.anchors).toBe(5)
    expect(digest.discovery).toBe(2)
    expect(digest.priorDiscovery).toBe(3)
    expect(digest.discovery).toBeLessThan(digest.priorDiscovery)
    expect(digest.state).toBe('ambiguous')
  })

  it('stale unticked candidate surfaces backlog + oldest age and forces ambiguous even when discovery is healthy', () => {
    const docs = [
      makeDoc({frontmatter: {module: 'a', component: undefined, problem_type: 'a'}, gitAddDate: daysAgo(10)}),
      makeDoc({frontmatter: {module: 'b', component: undefined, problem_type: 'b'}, gitAddDate: daysAgo(20)}),
      makeDoc({frontmatter: {module: 'c', component: undefined, problem_type: 'c'}, gitAddDate: daysAgo(30)}),
    ]
    const staleEvent = makeEvent({
      id: 'stale-1',
      title: 'Retry idempotent writes after 5xx failures',
      createdAt: daysAgo(20),
    })
    const input: ComputeMetricsInput = {
      solutionDocs: docs,
      proposalEvents: [staleEvent],
      priorTickState: new Set(),
      now: NOW,
    }
    const {digest, edges} = computeMetrics(input)
    expect(edges.length).toBeGreaterThan(0)
    expect(digest.backlogCount).toBeGreaterThan(0)
    expect(digest.oldestPendingAgeDays).not.toBeNull()
    expect(digest.oldestPendingAgeDays as number).toBeGreaterThan(14)
    expect(digest.state).toBe('ambiguous')
  })

  it('one event scoring over threshold for two anchors surfaces two independent edges', () => {
    const docA = makeDoc({
      frontmatter: {module: 'a', component: undefined, problem_type: 'a'},
      title: 'Retry idempotent writes every 5xx',
      gitAddDate: daysAgo(10),
    })
    const docB = makeDoc({
      frontmatter: {module: 'b', component: undefined, problem_type: 'b'},
      title: 'Retry idempotent writes across all 5xx paths',
      gitAddDate: daysAgo(20),
    })
    const docC = makeDoc({
      frontmatter: {module: 'c', component: undefined, problem_type: 'c'},
      title: 'Completely unrelated cache invalidation topic',
      tags: [],
      gitAddDate: daysAgo(30),
    })
    const event = makeEvent({title: 'Retry idempotent writes after 5xx failures', createdAt: daysAgo(3)})
    const input: ComputeMetricsInput = {
      solutionDocs: [docA, docB, docC],
      proposalEvents: [event],
      priorTickState: new Set(),
      now: NOW,
    }
    const {edges} = computeMetrics(input)
    const matchingEdges = edges.filter(e => e.eventId === event.id)
    expect(matchingEdges.length).toBe(2)
    expect(new Set(matchingEdges.map(e => e.classKey)).size).toBe(2)
  })

  it('discovery is derived from git add-date, not frontmatter date (structural: only gitAddDate is an input)', () => {
    // The pure core has no `date` field at all on SolutionDocRecord — gitAddDate is
    // the only date input, so a frontmatter-date mismatch cannot influence discovery.
    const doc = makeDoc({
      frontmatter: {module: 'old', component: undefined, problem_type: 'old'},
      gitAddDate: daysAgo(200),
    }) // outside window regardless of any hypothetical frontmatter date
    const anchors = [
      doc,
      makeDoc({frontmatter: {module: 'new1', component: undefined, problem_type: 'new1'}, gitAddDate: daysAgo(10)}),
      makeDoc({frontmatter: {module: 'new2', component: undefined, problem_type: 'new2'}, gitAddDate: daysAgo(20)}),
    ]
    const input: ComputeMetricsInput = {
      solutionDocs: anchors,
      proposalEvents: [],
      priorTickState: new Set(),
      now: NOW,
    }
    const {digest} = computeMetrics(input)
    // Only 2 of the 3 anchors are in-window by gitAddDate.
    expect(digest.discovery).toBe(2)
  })

  it('a ticked edge fingerprint in prior tick-state flows through to confirmedRecidivism', () => {
    const doc = makeDoc({
      frontmatter: {module: 'x', component: undefined, problem_type: 'x'},
      gitAddDate: daysAgo(10),
    })
    const docs = [
      doc,
      makeDoc({frontmatter: {module: 'y', component: undefined, problem_type: 'y'}, gitAddDate: daysAgo(20)}),
      makeDoc({frontmatter: {module: 'z', component: undefined, problem_type: 'z'}, gitAddDate: daysAgo(30)}),
    ]
    const event = makeEvent({id: 'e1', title: doc.title, createdAt: daysAgo(3)})
    const classKey = 'x\u0001unknown\u0001x'
    const fingerprint = buildEdgeFingerprint(classKey, 'e1')
    const input: ComputeMetricsInput = {
      solutionDocs: docs,
      proposalEvents: [event],
      priorTickState: new Set([fingerprint]),
      now: NOW,
    }
    const {digest, edges} = computeMetrics(input)
    const edge = edges.find(e => e.fingerprint === fingerprint)
    expect(edge?.ticked).toBe(true)
    expect(digest.confirmedRecidivism).toBeGreaterThanOrEqual(1)
  })

  it('confirmed recidivism at or above discovery renders failing', () => {
    const docA = makeDoc({
      frontmatter: {module: 'a', component: undefined, problem_type: 'a'},
      title: 'Retry idempotent writes yet again 5xx',
      gitAddDate: daysAgo(10),
    })
    const docB = makeDoc({
      frontmatter: {module: 'b', component: undefined, problem_type: 'b'},
      gitAddDate: daysAgo(20),
    })
    const docC = makeDoc({
      frontmatter: {module: 'c', component: undefined, problem_type: 'c'},
      gitAddDate: daysAgo(30),
    })
    const event = makeEvent({id: 'e2', title: 'Retry idempotent writes once more 5xx', createdAt: daysAgo(3)})
    const classKeyA = 'a\u0001unknown\u0001a'
    const fingerprintA = buildEdgeFingerprint(classKeyA, 'e2')
    const input: ComputeMetricsInput = {
      solutionDocs: [docA, docB, docC],
      proposalEvents: [event],
      priorTickState: new Set([fingerprintA]),
      now: NOW,
    }
    const {digest} = computeMetrics(input)
    expect(digest.discovery).toBe(3)
    expect(digest.confirmedRecidivism).toBeGreaterThanOrEqual(1)
    // With confirmedRecidivism >= discovery: failing takes priority over healthy/ambiguous.
    if (digest.confirmedRecidivism >= digest.discovery) {
      expect(digest.state).toBe('failing')
    }
  })

  it('temporal rule: an event at or before the class doc gitAddDate is founding evidence, not recurrence', () => {
    const docs = [
      makeDoc({
        frontmatter: {module: 'a', component: undefined, problem_type: 'a'},
        title: 'Retry idempotent writes after 5xx failures',
        gitAddDate: daysAgo(10),
      }),
      makeDoc({
        frontmatter: {module: 'b', component: undefined, problem_type: 'b'},
        title: 'Completely unrelated cache invalidation topic',
        tags: [],
        gitAddDate: daysAgo(20),
      }),
      makeDoc({
        frontmatter: {module: 'c', component: undefined, problem_type: 'c'},
        title: 'Something else entirely off topic here',
        tags: [],
        gitAddDate: daysAgo(30),
      }),
    ]
    // Event created strictly BEFORE the class doc's gitAddDate -- founding evidence, must not surface.
    const foundingEvent = makeEvent({
      id: 'founding',
      title: 'Retry idempotent writes after 5xx failures',
      createdAt: daysAgo(12),
    })
    const input: ComputeMetricsInput = {
      solutionDocs: docs,
      proposalEvents: [foundingEvent],
      priorTickState: new Set(),
      now: NOW,
    }
    const {edges} = computeMetrics(input)
    expect(edges.filter(e => e.eventId === 'founding')).toHaveLength(0)
  })

  it('temporal rule: an event strictly after the class doc gitAddDate is eligible recurrence', () => {
    const docs = [
      makeDoc({
        frontmatter: {module: 'a', component: undefined, problem_type: 'a'},
        title: 'Retry idempotent writes after 5xx failures',
        gitAddDate: daysAgo(10),
      }),
      makeDoc({
        frontmatter: {module: 'b', component: undefined, problem_type: 'b'},
        title: 'Completely unrelated cache invalidation topic',
        tags: [],
        gitAddDate: daysAgo(20),
      }),
      makeDoc({
        frontmatter: {module: 'c', component: undefined, problem_type: 'c'},
        title: 'Something else entirely off topic here',
        tags: [],
        gitAddDate: daysAgo(30),
      }),
    ]
    const recurrenceEvent = makeEvent({
      id: 'recurrence',
      title: 'Retry idempotent writes after 5xx failures',
      createdAt: daysAgo(3),
    })
    const input: ComputeMetricsInput = {
      solutionDocs: docs,
      proposalEvents: [recurrenceEvent],
      priorTickState: new Set(),
      now: NOW,
    }
    const {edges} = computeMetrics(input)
    expect(edges.filter(e => e.eventId === 'recurrence')).toHaveLength(1)
  })

  it('temporal rule: an event created at exactly the class doc gitAddDate is founding evidence (not strictly after)', () => {
    const sameInstant = daysAgo(10)
    const docs = [
      makeDoc({
        frontmatter: {module: 'a', component: undefined, problem_type: 'a'},
        title: 'Retry idempotent writes after 5xx failures',
        gitAddDate: sameInstant,
      }),
      makeDoc({
        frontmatter: {module: 'b', component: undefined, problem_type: 'b'},
        title: 'Completely unrelated cache invalidation topic',
        tags: [],
        gitAddDate: daysAgo(20),
      }),
      makeDoc({
        frontmatter: {module: 'c', component: undefined, problem_type: 'c'},
        title: 'Something else entirely off topic here',
        tags: [],
        gitAddDate: daysAgo(30),
      }),
    ]
    const coincidentEvent = makeEvent({
      id: 'coincident',
      title: 'Retry idempotent writes after 5xx failures',
      createdAt: sameInstant,
    })
    const input: ComputeMetricsInput = {
      solutionDocs: docs,
      proposalEvents: [coincidentEvent],
      priorTickState: new Set(),
      now: NOW,
    }
    const {edges} = computeMetrics(input)
    expect(edges.filter(e => e.eventId === 'coincident')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// walkthrough ground truth (2026-07-11)
// ---------------------------------------------------------------------------
//
// Live report #3674's first operator walkthrough adjudicated all 14 surfaced
// edges: exactly ONE is a genuine recurrence (#3656 x status-truth-detect); 13
// are noise (founding evidence or generic-token overlap). Fixture built from
// real fetched data: `gh issue view N --repo fro-bot/.github --json
// title,labels,createdAt` for events; `git log --diff-filter=A --format=%aI`
// for class doc git-add dates. All values are public/immutable.

describe('walkthrough ground truth (2026-07-11)', () => {
  const GROUND_TRUTH_NOW = new Date('2026-07-11T00:00:00.000Z')

  // Events (real, fetched via `gh issue view`)
  const event3614 = makeEvent({
    id: '3614',
    title: 'Status truth: plan-consistency drift in docs/plans/2026-06-22-003-feat-enrich-capture-digest-plan.md',
    labels: [],
    createdAt: '2026-07-03T00:25:55Z',
  })
  const event3615 = makeEvent({
    id: '3615',
    title:
      'Status truth: plan-consistency drift in docs/plans/2026-06-22-004-feat-c2-failed-then-fixed-capture-plan.md',
    labels: [],
    createdAt: '2026-07-03T00:25:55Z',
  })
  const event3616 = makeEvent({
    id: '3616',
    title: 'Status truth: plan-consistency drift in docs/plans/2026-06-23-001-fix-merged-candidate-evidence-plan.md',
    labels: [],
    createdAt: '2026-07-03T00:25:55Z',
  })
  const event3656 = makeEvent({
    id: '3656',
    title: 'Status truth: plan-consistency drift in docs/plans/2026-07-07-001-fix-a3-receipt-contract-state-plan.md',
    labels: [],
    createdAt: '2026-07-07T10:32:59Z',
  })
  const event3667 = makeEvent({
    id: '3667',
    title: 'Pattern proposal: When building automated inspection or drift-detection ove\u2026',
    labels: ['pattern-proposal', 'pattern-proposal:accepted'],
    createdAt: '2026-07-09T08:19:31Z',
  })

  // Classes (real frontmatter + real git add-dates)
  const selfAuditDoc: SolutionDocRecord = {
    frontmatter: {module: 'status-truth-detect', component: 'tooling', problem_type: 'architecture_pattern'},
    title: 'Synthetic self-audit claim kinds for in-file drift detection',
    tags: ['status-truth', 'synthetic-claims', 'drift-detection', 'frontmatter'],
    gitAddDate: '2026-07-02T21:20:45-07:00',
  }
  const closedVocabDoc: SolutionDocRecord = {
    frontmatter: {module: 'status-truth', component: 'tooling', problem_type: 'best_practice'},
    title: 'Closed-vocabulary identifiers for automated inspection and drift detection',
    tags: ['closed-vocabulary', 'status-truth', 'identifier-constraint', 'drift-detection', 'enumeration'],
    gitAddDate: '2026-07-09T10:06:26-07:00',
  }
  const wikiIngestDoc: SolutionDocRecord = {
    frontmatter: {module: 'scripts/wiki-ingest.ts', component: 'workflow', problem_type: 'runtime_error'},
    title: 'Silent Failures in Autonomous Multi-Step Pipelines (Wiki Commit Drift + Misclassified Status)',
    tags: [
      'workflow',
      'github-actions',
      'wiki-ingest',
      'porcelain',
      'silent-failure',
      'status-classification',
      'additive-pipeline',
      'autonomous',
      'reconcile',
    ],
    gitAddDate: '2026-04-19T06:53:01-07:00',
  }

  const TRUE_EDGE_CLASS_KEY = buildClassKey(selfAuditDoc.frontmatter)
  const TRUE_EDGE_FINGERPRINT = buildEdgeFingerprint(TRUE_EDGE_CLASS_KEY, '3656')

  function runFixture(priorTickState: PriorTickState = new Set()): ComputeMetricsResult {
    return computeMetrics({
      solutionDocs: [selfAuditDoc, closedVocabDoc, wikiIngestDoc],
      proposalEvents: [event3614, event3615, event3616, event3656, event3667],
      priorTickState,
      now: GROUND_TRUTH_NOW,
    })
  }

  it('surfaces exactly the one true edge (#3656 x status-truth-detect self-audit class)', () => {
    const {edges} = runFixture()
    expect(edges).toHaveLength(1)
    expect(edges[0]?.eventId).toBe('3656')
    expect(edges[0]?.classKey).toBe(TRUE_EDGE_CLASS_KEY)
    expect(edges[0]?.fingerprint).toBe(TRUE_EDGE_FINGERPRINT)
  })

  it('rejects the 13 false pairs, including all founding-evidence and generic-token-noise edges', () => {
    const {edges} = runFixture()
    const falsePairs: [string, string][] = [
      ['3614', buildClassKey(selfAuditDoc.frontmatter)],
      ['3615', buildClassKey(selfAuditDoc.frontmatter)],
      ['3616', buildClassKey(selfAuditDoc.frontmatter)],
      ['3667', buildClassKey(selfAuditDoc.frontmatter)],
      ['3667', buildClassKey(closedVocabDoc.frontmatter)],
      ['3614', buildClassKey(closedVocabDoc.frontmatter)],
      ['3615', buildClassKey(closedVocabDoc.frontmatter)],
      ['3616', buildClassKey(closedVocabDoc.frontmatter)],
      ['3656', buildClassKey(closedVocabDoc.frontmatter)],
      ['3614', buildClassKey(wikiIngestDoc.frontmatter)],
      ['3615', buildClassKey(wikiIngestDoc.frontmatter)],
      ['3616', buildClassKey(wikiIngestDoc.frontmatter)],
      ['3656', buildClassKey(wikiIngestDoc.frontmatter)],
    ]
    expect(falsePairs).toHaveLength(13)
    for (const [eventId, classKey] of falsePairs) {
      const found = edges.some(e => e.eventId === eventId && e.classKey === classKey)
      expect(found, `expected no edge for event ${eventId} x class ${classKey}`).toBe(false)
    }
  })

  it('confirmedRecidivism honors a prior tick on the true edge fingerprint', () => {
    const {digest, edges} = runFixture(new Set([TRUE_EDGE_FINGERPRINT]))
    const trueEdge = edges.find(e => e.fingerprint === TRUE_EDGE_FINGERPRINT)
    expect(trueEdge?.ticked).toBe(true)
    expect(digest.confirmedRecidivism).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// I/O shell: fetchProposalEventsFromRepo
// ---------------------------------------------------------------------------

function makeMockOctokit(overrides: Partial<ImprovementMetricsOctokitClient> = {}): ImprovementMetricsOctokitClient {
  return {
    paginate: async () => [],
    rest: {
      issues: {
        listForRepo: async () => ({data: []}),
      },
    },
    ...overrides,
  }
}

describe('fetchProposalEventsFromRepo', () => {
  it('fetches one paginated call per source label and maps issue shape', async () => {
    const calls: Record<string, unknown>[] = []
    const octokit = makeMockOctokit({
      paginate: async (_fn, params) => {
        calls.push(params)
        return [
          {
            number: 7,
            title: 'Some proposal',
            created_at: '2026-01-01T00:00:00.000Z',
            html_url: 'https://github.com/fro-bot/.github/issues/7',
            labels: ['learning-proposal', {name: 'ci'}],
          },
        ]
      },
    })
    const events = await fetchProposalEventsFromRepo(octokit, 'fro-bot', '.github')
    expect(calls.length).toBe(3)
    expect(calls.map(c => c.labels)).toEqual(['learning-proposal', 'pattern-proposal', 'status-truth'])
    expect(events.length).toBe(3)
    expect(events[0]?.id).toBe('7')
    expect(events[0]?.labels).toEqual(['learning-proposal', 'ci'])
  })
})

// ---------------------------------------------------------------------------
// I/O shell: recoverPriorTickState
// ---------------------------------------------------------------------------

describe('recoverPriorTickState', () => {
  it('recovers only ticked edge fingerprints from a report body', () => {
    const fp1 = 'a'.repeat(64)
    const fp2 = 'b'.repeat(64)
    const body = [
      `- [x] <!-- improvement-metrics:edge=${fp1} -->`,
      `- [ ] <!-- improvement-metrics:edge=${fp2} -->`,
    ].join('\n')
    const ticked = recoverPriorTickState(body)
    expect(ticked.has(fp1)).toBe(true)
    expect(ticked.has(fp2)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// I/O shell: writeImprovementMetricsDigestFile fail-closed
// ---------------------------------------------------------------------------

describe('writeImprovementMetricsDigestFile', () => {
  it('throws when IMPROVEMENT_METRICS_DIGEST_PATH is not set', async () => {
    const previous = process.env.IMPROVEMENT_METRICS_DIGEST_PATH
    delete process.env.IMPROVEMENT_METRICS_DIGEST_PATH
    await expect(
      writeImprovementMetricsDigestFile(
        {
          windowDays: 90,
          anchors: 0,
          discovery: 0,
          priorDiscovery: 0,
          confirmedRecidivism: 0,
          backlogCount: 0,
          oldestPendingAgeDays: null,
          state: 'insufficient-signal',
        },
        [],
      ),
    ).rejects.toThrow('IMPROVEMENT_METRICS_DIGEST_PATH')
    if (previous !== undefined) process.env.IMPROVEMENT_METRICS_DIGEST_PATH = previous
  })

  it('writes counts-only digest + edges to the configured path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'improvement-metrics-'))
    const digestPath = join(dir, 'digest.json')
    const previous = process.env.IMPROVEMENT_METRICS_DIGEST_PATH
    process.env.IMPROVEMENT_METRICS_DIGEST_PATH = digestPath
    try {
      await writeImprovementMetricsDigestFile(
        {
          windowDays: 90,
          anchors: 1,
          discovery: 1,
          priorDiscovery: 0,
          confirmedRecidivism: 0,
          backlogCount: 0,
          oldestPendingAgeDays: null,
          state: 'healthy',
        },
        [],
      )
      const {readFile} = await import('node:fs/promises')
      const raw = await readFile(digestPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      expect(parsed).toMatchObject({digest: {anchors: 1, state: 'healthy'}, edges: []})
    } finally {
      if (previous === undefined) delete process.env.IMPROVEMENT_METRICS_DIGEST_PATH
      else process.env.IMPROVEMENT_METRICS_DIGEST_PATH = previous
      await rm(dir, {recursive: true, force: true})
    }
  })
})

// ---------------------------------------------------------------------------
// I/O shell: loadGitAddDates fail-closed
// ---------------------------------------------------------------------------

describe('loadGitAddDates', () => {
  it('resolves the earliest add-date per path from git log output', () => {
    const fakeExec = ((_cmd: string, args: readonly string[]) => {
      expect(args).toContain('--diff-filter=A')
      return '2026-05-01T00:00:00+00:00\n'
    }) as unknown as typeof import('node:child_process').execFileSync
    const result = loadGitAddDates(['docs/solutions/best-practices/x.md'], fakeExec)
    expect(result.get('docs/solutions/best-practices/x.md')).toBe('2026-05-01T00:00:00+00:00')
  })

  it('throws (fail-closed) when a path has no resolvable git add-date', () => {
    const fakeExec = (() => '') as unknown as typeof import('node:child_process').execFileSync
    expect(() => loadGitAddDates(['docs/solutions/best-practices/missing.md'], fakeExec)).toThrow()
  })
})
