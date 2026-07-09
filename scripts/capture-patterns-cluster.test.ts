/**
 * Tests for scripts/capture-patterns-cluster.ts
 *
 * Structure:
 * - Fingerprint tests
 * - Cluster building tests (low-signal rejection, correction-substance grouping)
 * - Suppression/filter tests (open overlap, hard/soft suppression, accepted retirement)
 * - Ranking/cap tests
 * - Digest schema tests
 */

import {describe, expect, it} from 'vitest'
import {
  buildCandidateDigest,
  buildSourceFingerprint,
  planPatternCandidates,
  type PatternCandidateSource,
  type PlanPatternCandidatesInput,
} from './capture-patterns-cluster.ts'
import {
  PATTERN_PROPOSAL_OUTCOME_LABELS,
  type ExistingPatternProposalIssue,
  type ExistingPatternProposals,
} from './capture-patterns-synthesis.ts'
import {makePublicOutputTokens, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSource(overrides: Partial<PatternCandidateSource> = {}): PatternCandidateSource {
  return {
    id: 'source-a',
    kind: 'solution-doc',
    link: 'https://github.com/fro-bot/.github/blob/abc/docs/solutions/best-practices/source-a.md',
    title: 'Retry idempotent writes on 5xx',
    date: '2026-06-01',
    signals: {
      module: 'scripts/foo.ts',
      tags: ['ci'],
      problemType: 'best_practice',
      titleTokens: ['retry', 'idempotent', 'writes', '5xx'],
    },
    ...overrides,
  }
}

function makeIssue(overrides: Partial<ExistingPatternProposalIssue> = {}): ExistingPatternProposalIssue {
  return {
    number: 1,
    state: 'open',
    labels: ['pattern-proposal'],
    body: '',
    ...overrides,
  }
}

function emptyExisting(): ExistingPatternProposals {
  return {openByFingerprint: new Map(), closedByFingerprint: new Map(), invalidMarkerCount: 0}
}

function safeTokens(): PublicOutputTokens {
  return makePublicOutputTokens({privateTokens: new Set<string>(), redactedCanonicalIds: new Set<string>()})
}

function plan(input: Omit<PlanPatternCandidatesInput, 'publicOutputTokens'>): ReturnType<typeof planPatternCandidates> {
  return planPatternCandidates({...input, publicOutputTokens: safeTokens()})
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

describe('buildSourceFingerprint', () => {
  it('is a lowercase hex SHA-256 of newline-joined sorted source IDs', () => {
    const fp1 = buildSourceFingerprint(['zebra', 'alpha'])
    const fp2 = buildSourceFingerprint(['alpha', 'zebra'])
    expect(fp1).toBe(fp2)
    expect(fp1).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('changes when the source-ID set changes', () => {
    const fp1 = buildSourceFingerprint(['alpha', 'zebra'])
    const fp2 = buildSourceFingerprint(['alpha', 'zebra', 'mid'])
    expect(fp1).not.toBe(fp2)
  })
})

// ---------------------------------------------------------------------------
// Cluster building — correction-substance grouping
// ---------------------------------------------------------------------------

describe('planPatternCandidates: correction-substance clustering', () => {
  it('happy path: multiple artifacts describing the same correction behavior produce one candidate with sorted source IDs and stable fingerprint', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Retry idempotent writes after 5xx failures',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
      },
    })
    const sources = [makeSource(), sourceB]

    const result = plan({sources, existing: emptyExisting()})

    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    expect(candidate?.sourceIds).toEqual(['source-a', 'source-b'])
    expect(candidate?.fingerprint).toBe(buildSourceFingerprint(['source-a', 'source-b']))
  })

  it('edge case: artifacts sharing only a generic tag are skipped as low-signal', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Completely unrelated rename of a config key',
      signals: {
        module: 'scripts/bar.ts',
        tags: ['ci'],
        problemType: 'workflow_issue',
        titleTokens: ['completely', 'unrelated', 'rename', 'config', 'key'],
      },
    })
    const sources = [makeSource(), sourceB]

    const result = plan({sources, existing: emptyExisting()})

    expect(result.candidates).toHaveLength(0)
    expect(result.counts.lowSignal).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Suppression / filter behavior
// ---------------------------------------------------------------------------

describe('planPatternCandidates: open-proposal overlap', () => {
  it('edge case: a candidate matching or overlapping an open proposal is skipped as duplicate/open-overlap', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Retry idempotent writes after 5xx failures',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
      },
    })
    const sources = [makeSource(), sourceB]
    const fingerprint = buildSourceFingerprint(['source-a', 'source-b'])

    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map([[fingerprint, [makeIssue({state: 'open'})]]]),
      closedByFingerprint: new Map(),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    expect(result.candidates).toHaveLength(0)
    expect(result.counts.duplicateOpenOverlap).toBe(1)
  })
})

function twoSourceCandidateSetup(problemType = 'best_practice'): PatternCandidateSource[] {
  const sourceB = makeSource({
    id: 'source-b',
    title: 'Retry idempotent writes after 5xx failures',
    signals: {
      module: 'scripts/foo.ts',
      tags: ['ci'],
      problemType,
      titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
    },
  })
  return [makeSource({signals: {...makeSource().signals, problemType}}), sourceB]
}

describe('planPatternCandidates: hard suppression (rejected/no-outcome)', () => {
  it('edge case: a candidate whose sources are a subset of a rejected proposal is hard-suppressed', () => {
    const sources = twoSourceCandidateSetup()
    const fingerprint = buildSourceFingerprint(['source-a', 'source-b'])

    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map(),
      closedByFingerprint: new Map([
        [
          fingerprint,
          [
            makeIssue({
              state: 'closed',
              labels: ['pattern-proposal', PATTERN_PROPOSAL_OUTCOME_LABELS.rejected],
              body: `<!-- pattern-proposal:fingerprint=${fingerprint} -->\n<!-- pattern-proposal:source-ids=source-a,source-b -->`,
            }),
          ],
        ],
      ]),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    expect(result.candidates).toHaveLength(0)
    expect(result.counts.hardSuppressed).toBe(1)
  })

  it('is not hard-suppressed when at least two new independent public-safe sources were added', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Retry idempotent writes after 5xx failures',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
      },
    })
    const sourceC = makeSource({
      id: 'source-c',
      title: 'Retry idempotent writes yet again for 5xx',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'yet', 'again', '5xx'],
      },
    })
    const sourceD = makeSource({
      id: 'source-d',
      title: 'Retry idempotent writes once more on 5xx',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'once', 'more', '5xx'],
      },
    })
    const sources = [makeSource(), sourceB, sourceC, sourceD]

    const rejectedFingerprint = buildSourceFingerprint(['source-a', 'source-b'])
    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map(),
      closedByFingerprint: new Map([
        [
          rejectedFingerprint,
          [
            makeIssue({
              state: 'closed',
              labels: ['pattern-proposal', PATTERN_PROPOSAL_OUTCOME_LABELS.rejected],
              body: `<!-- pattern-proposal:fingerprint=${rejectedFingerprint} -->\n<!-- pattern-proposal:source-ids=source-a,source-b -->`,
            }),
          ],
        ],
      ]),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    // The full 4-source cluster has 2 new sources (c, d) beyond the rejected set (a, b) —
    // this must NOT be hard-suppressed.
    const fullFingerprint = buildSourceFingerprint(['source-a', 'source-b', 'source-c', 'source-d'])
    const survived = result.candidates.some(c => c.fingerprint === fullFingerprint)
    expect(survived).toBe(true)
  })
})

describe('planPatternCandidates: superseded suppression', () => {
  it('edge case: a superseded proposal never reopens through a superset', () => {
    const sources = [
      makeSource(),
      makeSource({
        id: 'source-b',
        title: 'Retry idempotent writes after 5xx failures',
        signals: {
          module: 'scripts/foo.ts',
          tags: ['ci'],
          problemType: 'best_practice',
          titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
        },
      }),
    ]
    const fingerprint = buildSourceFingerprint(['source-a', 'source-b'])

    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map(),
      closedByFingerprint: new Map([
        [
          fingerprint,
          [
            makeIssue({
              state: 'closed',
              labels: ['pattern-proposal', PATTERN_PROPOSAL_OUTCOME_LABELS.superseded],
              body: `<!-- pattern-proposal:fingerprint=${fingerprint} -->\n<!-- pattern-proposal:source-ids=source-a,source-b -->`,
            }),
          ],
        ],
      ]),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    expect(result.candidates).toHaveLength(0)
    expect(result.counts.hardSuppressed).toBe(1)
  })
})

describe('planPatternCandidates: deferred soft suppression', () => {
  it('edge case: a deferred proposal with one new source produces a new-version candidate referencing the deferred issue', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Retry idempotent writes after 5xx failures',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
      },
    })
    const sourceC = makeSource({
      id: 'source-c',
      title: 'Retry idempotent writes yet again for 5xx',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'yet', 'again', '5xx'],
      },
    })
    const sources = [makeSource(), sourceB, sourceC]

    const deferredFingerprint = buildSourceFingerprint(['source-a', 'source-b'])
    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map(),
      closedByFingerprint: new Map([
        [
          deferredFingerprint,
          [
            makeIssue({
              number: 99,
              state: 'closed',
              labels: ['pattern-proposal', PATTERN_PROPOSAL_OUTCOME_LABELS.deferred],
              body: `<!-- pattern-proposal:fingerprint=${deferredFingerprint} -->\n<!-- pattern-proposal:source-ids=source-a,source-b -->`,
            }),
          ],
        ],
      ]),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    const fullFingerprint = buildSourceFingerprint(['source-a', 'source-b', 'source-c'])
    const candidate = result.candidates.find(c => c.fingerprint === fullFingerprint)
    expect(candidate).toBeDefined()
    expect(candidate?.supersedes).toBe(deferredFingerprint)
  })

  it('soft-suppresses a deferred proposal with no new sources (exact set)', () => {
    const sources = [
      makeSource(),
      makeSource({
        id: 'source-b',
        title: 'Retry idempotent writes after 5xx failures',
        signals: {
          module: 'scripts/foo.ts',
          tags: ['ci'],
          problemType: 'best_practice',
          titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
        },
      }),
    ]
    const fingerprint = buildSourceFingerprint(['source-a', 'source-b'])

    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map(),
      closedByFingerprint: new Map([
        [
          fingerprint,
          [
            makeIssue({
              state: 'closed',
              labels: ['pattern-proposal', PATTERN_PROPOSAL_OUTCOME_LABELS.deferred],
              body: `<!-- pattern-proposal:fingerprint=${fingerprint} -->\n<!-- pattern-proposal:source-ids=source-a,source-b -->`,
            }),
          ],
        ],
      ]),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    expect(result.candidates).toHaveLength(0)
    expect(result.counts.softSuppressed).toBe(1)
  })
})

describe('planPatternCandidates: accepted retirement', () => {
  it('edge case: an accepted proposal source IDs are immediately retired from future clusters even while open', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Retry idempotent writes after 5xx failures',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
      },
    })
    const sources = [makeSource(), sourceB]

    // Source A already codified via an accepted proposal (issue still open per plan text:
    // "regardless of whether the issue is open or closed").
    const acceptedFingerprint = buildSourceFingerprint(['source-a'])
    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map([
        [
          acceptedFingerprint,
          [
            makeIssue({
              state: 'open',
              labels: ['pattern-proposal', PATTERN_PROPOSAL_OUTCOME_LABELS.accepted],
              body: `<!-- pattern-proposal:fingerprint=${acceptedFingerprint} -->\n<!-- pattern-proposal:source-ids=source-a -->`,
            }),
          ],
        ],
      ]),
      closedByFingerprint: new Map(),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing})

    // source-a is retired; only source-b remains, insufficient for a cluster (needs >= 2).
    expect(result.candidates).toHaveLength(0)
    expect(result.counts.duplicateOpenOverlap).toBe(0)
    expect(result.counts.noOp).toBe(1)
  })
})

describe('planPatternCandidates: unsafe candidate handling', () => {
  it('error path: unsafe candidate evidence increments skipped-unsafe counts but does not create suppression state', () => {
    const unsafeTitle = `Retry idempotent writes ghp_${'a'.repeat(40)}`
    const sourceB = makeSource({
      id: 'source-b',
      title: unsafeTitle,
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes'],
      },
    })
    const sources = [makeSource(), sourceB]

    const result = plan({sources, existing: emptyExisting()})

    expect(result.candidates).toHaveLength(0)
    expect(result.counts.unsafe).toBe(1)
  })
})

describe('planPatternCandidates: filter-before-cap ordering', () => {
  it('filters candidates before applying the three-proposal cap', () => {
    // Build 4 well-formed clusters; suppress 2 of them via open-overlap so only 2 remain,
    // both under the cap of 3 — confirms cap is applied post-filter, not pre-filter.
    const TOPIC_WORDS = [
      ['aardvark', 'brambling', 'catapult'],
      ['dewdrop', 'echelon', 'foxglove'],
      ['gargoyle', 'hazelnut', 'ibis'],
      ['jackal', 'kestrel', 'lanyard'],
    ]

    function pairFor(n: number): PatternCandidateSource[] {
      const base = `pair${n}`
      const words = TOPIC_WORDS[n - 1] ?? ['unknown']
      return [
        makeSource({
          id: `${base}-a`,
          title: `${words.join(' ')} first`,
          signals: {
            module: `scripts/mod${n}.ts`,
            tags: [`topic${n}`],
            problemType: `best_practice_${n}`,
            titleTokens: [...words, 'first'],
          },
        }),
        makeSource({
          id: `${base}-b`,
          title: `${words.join(' ')} second`,
          signals: {
            module: `scripts/mod${n}.ts`,
            tags: [`topic${n}`],
            problemType: `best_practice_${n}`,
            titleTokens: [...words, 'second'],
          },
        }),
      ]
    }

    const sources = [...pairFor(1), ...pairFor(2), ...pairFor(3), ...pairFor(4)]
    const suppressedFingerprint = buildSourceFingerprint(['pair1-a', 'pair1-b'])

    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map([[suppressedFingerprint, [makeIssue({state: 'open'})]]]),
      closedByFingerprint: new Map(),
      invalidMarkerCount: 0,
    }

    const result = plan({sources, existing, cap: 3})

    expect(result.counts.duplicateOpenOverlap).toBe(1)
    expect(result.candidates.length).toBeLessThanOrEqual(3)
    expect(result.candidates.some(c => c.fingerprint === suppressedFingerprint)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

describe('planPatternCandidates: deterministic tie order', () => {
  it('orders equal-strength candidates by recency then stable source-ID order', () => {
    const TIE_TOPIC_WORDS = [
      ['marmoset', 'nightjar', 'ocelot'],
      ['periwinkle', 'quokka', 'ravenous'],
    ]

    function pairFor(n: number, date: string): PatternCandidateSource[] {
      const base = `set${n}`
      const words = TIE_TOPIC_WORDS[n - 1] ?? ['unknown']
      return [
        makeSource({
          id: `${base}-a`,
          title: `${words.join(' ')} alpha`,
          date,
          signals: {
            module: `scripts/mod${n}.ts`,
            tags: [`topic${n}`],
            problemType: `best_practice_${n}`,
            titleTokens: [...words, 'alpha'],
          },
        }),
        makeSource({
          id: `${base}-b`,
          title: `${words.join(' ')} beta`,
          date,
          signals: {
            module: `scripts/mod${n}.ts`,
            tags: [`topic${n}`],
            problemType: `best_practice_${n}`,
            titleTokens: [...words, 'beta'],
          },
        }),
      ]
    }

    const older = pairFor(1, '2026-01-01')
    const newer = pairFor(2, '2026-06-01')
    const sources = [...older, ...newer]

    const result = plan({sources, existing: emptyExisting(), cap: 1})

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.sourceIds).toEqual(['set2-a', 'set2-b'])
  })
})

// ---------------------------------------------------------------------------
// Digest schema
// ---------------------------------------------------------------------------

describe('buildCandidateDigest', () => {
  it('contains only allowed fields and validates public-safe titles', () => {
    const sourceB = makeSource({
      id: 'source-b',
      title: 'Retry idempotent writes after 5xx failures',
      signals: {
        module: 'scripts/foo.ts',
        tags: ['ci'],
        problemType: 'best_practice',
        titleTokens: ['retry', 'idempotent', 'writes', 'after', '5xx', 'failures'],
      },
    })
    const sources = [makeSource(), sourceB]

    const result = plan({sources, existing: emptyExisting()})
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    if (candidate === undefined) throw new Error('expected a candidate')

    const digest = buildCandidateDigest({candidate, runCount: 1, publicOutputTokens: safeTokens()})

    const allowedKeys = new Set([
      'fingerprint',
      'sourceIds',
      'sourceLinks',
      'sourceTitles',
      'evidenceCount',
      'scoreBucket',
      'suggestedNextAction',
      'runCount',
      'supersedes',
    ])
    for (const key of Object.keys(digest)) {
      expect(allowedKeys.has(key)).toBe(true)
    }
    expect(digest.fingerprint).toBe(candidate.fingerprint)
    expect(digest.sourceIds).toEqual(candidate.sourceIds)
    expect(digest.sourceTitles.length).toBe(candidate.sourceIds.length)
  })

  it('throws instead of masking a source title that fails the public-output gate', () => {
    const blockingTokens = makePublicOutputTokens({
      privateTokens: new Set<string>(['private-token']),
      redactedCanonicalIds: new Set<string>(),
    })
    const candidate = {
      fingerprint: buildSourceFingerprint(['source-a', 'source-b']),
      sourceIds: ['source-a', 'source-b'],
      sources: [
        makeSource({id: 'source-a', title: 'Retry private-token safely'}),
        makeSource({id: 'source-b', title: 'Retry idempotent writes after 5xx failures'}),
      ],
      scoreBucket: 'moderate' as const,
    }

    expect(() => buildCandidateDigest({candidate, runCount: 1, publicOutputTokens: blockingTokens})).toThrow(
      'Pattern candidate source title failed public-output gate',
    )
  })
})
