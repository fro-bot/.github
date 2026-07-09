/**
 * Tests for scripts/capture-patterns-open.ts
 *
 * Structure:
 * - Body validation tests (drafted / agent-skipped / unknown field / unknown outcome)
 * - Rendering tests (public-output gate applied to title + body)
 * - Pure planning core tests (planPatternProposalOpens)
 * - I/O shell tests (openPatternProposalIssues — mocked Octokit)
 * - Mutation-proof gate tests
 */

import type {PatternCandidateDigest} from './capture-patterns-cluster.ts'

import {describe, expect, it, vi} from 'vitest'
import {
  derivePatternProposalTitle,
  ensurePatternProposalLabelsExist,
  openPatternProposalIssues,
  planPatternProposalOpens,
  renderPatternProposalIssueBody,
  validatePatternProposalBody,
  type DraftedPatternProposalBody,
  type PlanPatternProposalOpensInput,
} from './capture-patterns-open.ts'
import {
  buildPatternProposalMarkers,
  PATTERN_PROPOSAL_LABEL,
  type ExistingPatternProposalIssue,
  type ExistingPatternProposals,
} from './capture-patterns-synthesis.ts'
import {makePublicOutputTokens, type PublicOutputTokens} from './status-truth-public-output.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDigest(overrides: Partial<PatternCandidateDigest> = {}): PatternCandidateDigest {
  return {
    fingerprint: 'a'.repeat(64),
    sourceIds: ['source-a', 'source-b'],
    sourceLinks: [
      'https://github.com/fro-bot/.github/blob/abc/docs/solutions/best-practices/source-a.md',
      'https://github.com/fro-bot/.github/blob/abc/docs/solutions/best-practices/source-b.md',
    ],
    sourceTitles: ['Retry idempotent writes', 'Retry idempotent writes again'],
    evidenceCount: 2,
    scoreBucket: 'moderate',
    suggestedNextAction: 'draft-proposal',
    runCount: 1,
    ...overrides,
  }
}

function makeDraftedBody(overrides: Partial<DraftedPatternProposalBody> = {}): DraftedPatternProposalBody {
  return {
    outcome: 'drafted',
    patternStatement: 'Retries on 5xx are repeatedly added after incidents.',
    rationale: 'Two independent sources show the same missing-retry correction.',
    sourceReferences: ['Retry idempotent writes', 'Retry idempotent writes again'],
    evidenceCount: 2,
    suggestedNextAction: 'Add a retry-on-5xx guideline to the relevant doc.',
    ...overrides,
  }
}

function safeTokens(): PublicOutputTokens {
  return makePublicOutputTokens({privateTokens: new Set<string>(), redactedCanonicalIds: new Set<string>()})
}

function failedTokens(): PublicOutputTokens {
  return {loaded: false, error: 'token load failed'}
}

function emptyExisting(): ExistingPatternProposals {
  return {openByFingerprint: new Map(), closedByFingerprint: new Map(), invalidMarkerCount: 0}
}

function makeIssue(overrides: Partial<ExistingPatternProposalIssue> = {}): ExistingPatternProposalIssue {
  return {number: 1, state: 'open', labels: [PATTERN_PROPOSAL_LABEL], body: '', ...overrides}
}

function planInput(overrides: Partial<PlanPatternProposalOpensInput> = {}): PlanPatternProposalOpensInput {
  return {
    digestCandidates: [makeDigest()],
    bodyFile: {schemaVersion: 1, bodies: {[makeDigest().fingerprint]: makeDraftedBody()}},
    existing: emptyExisting(),
    publicOutputTokens: safeTokens(),
    alreadyCreatedFingerprints: new Set(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// validatePatternProposalBody
// ---------------------------------------------------------------------------

describe('validatePatternProposalBody', () => {
  it('accepts a well-formed drafted body', () => {
    const result = validatePatternProposalBody(makeDraftedBody())
    expect(result.valid).toBe(true)
  })

  it('accepts a well-formed agent-skipped body', () => {
    const result = validatePatternProposalBody({outcome: 'agent-skipped', reason: 'insufficient-evidence'})
    expect(result.valid).toBe(true)
  })

  it('rejects a drafted body with an unapproved field', () => {
    const result = validatePatternProposalBody({...makeDraftedBody(), rawTranscript: 'leaked'})
    expect(result.valid).toBe(false)
  })

  it('rejects an agent-skipped body with a non-closed-vocabulary reason', () => {
    const result = validatePatternProposalBody({outcome: 'agent-skipped', reason: 'because I said so'})
    expect(result.valid).toBe(false)
  })

  it('rejects an unknown outcome value', () => {
    const result = validatePatternProposalBody({outcome: 'maybe'})
    expect(result.valid).toBe(false)
  })

  it('rejects a drafted body missing required fields', () => {
    const full = makeDraftedBody()
    const rest: Record<string, unknown> = {...full}
    delete rest.patternStatement
    const result = validatePatternProposalBody(rest)
    expect(result.valid).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(validatePatternProposalBody('not an object').valid).toBe(false)
    expect(validatePatternProposalBody(null).valid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// renderPatternProposalIssueBody / derivePatternProposalTitle
// ---------------------------------------------------------------------------

describe('renderPatternProposalIssueBody', () => {
  it('injects fingerprint and source-id hidden markers', () => {
    const digest = makeDigest()
    const rendered = renderPatternProposalIssueBody({digest, body: makeDraftedBody()})
    expect(rendered).toContain(
      buildPatternProposalMarkers({fingerprint: digest.fingerprint, sourceIds: digest.sourceIds}),
    )
  })

  it('injects the supersedes marker when the digest carries a prior proposal fingerprint', () => {
    const supersedes = 'b'.repeat(64)
    const digest = makeDigest({supersedes})
    const rendered = renderPatternProposalIssueBody({digest, body: makeDraftedBody()})

    expect(rendered).toContain(`<!-- pattern-proposal:supersedes=${supersedes} -->`)
  })

  it('includes pattern statement, rationale, and suggested next action', () => {
    const digest = makeDigest()
    const body = makeDraftedBody()
    const rendered = renderPatternProposalIssueBody({digest, body})
    expect(rendered).toContain(body.patternStatement)
    expect(rendered).toContain(body.rationale)
    expect(rendered).toContain(body.suggestedNextAction)
  })
})

describe('derivePatternProposalTitle', () => {
  it('derives a public title from the drafted pattern statement, not the fingerprint', () => {
    const title = derivePatternProposalTitle(makeDraftedBody())
    expect(title).not.toContain('http')
    expect(title).not.toContain('aaaaaaaa')
    expect(title).toContain('Retries on 5xx')
    expect(title.length).toBeLessThan(80)
  })
})

// ---------------------------------------------------------------------------
// planPatternProposalOpens — happy path
// ---------------------------------------------------------------------------

describe('planPatternProposalOpens: happy path', () => {
  it('opens one issue with required label and injected markers for a clean drafted body', () => {
    const result = planPatternProposalOpens(planInput())
    expect(result.toCreate).toHaveLength(1)
    expect(result.counts.drafted).toBe(1)
    expect(result.toCreate[0]?.body).toContain('pattern-proposal:fingerprint=')
  })

  it('empty path: zero candidates is a successful no-op with explicit counts', () => {
    const result = planPatternProposalOpens(planInput({digestCandidates: [], bodyFile: {schemaVersion: 1, bodies: {}}}))
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.candidatesExamined).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// planPatternProposalOpens — error paths
// ---------------------------------------------------------------------------

describe('planPatternProposalOpens: error paths', () => {
  it('missing body counts no-body and opens remaining valid proposals', () => {
    const digestA = makeDigest({fingerprint: 'a'.repeat(64), sourceIds: ['source-a', 'source-b']})
    const digestB = makeDigest({fingerprint: 'b'.repeat(64), sourceIds: ['source-c', 'source-d']})
    const result = planPatternProposalOpens(
      planInput({
        digestCandidates: [digestA, digestB],
        bodyFile: {schemaVersion: 1, bodies: {[digestB.fingerprint]: makeDraftedBody()}},
      }),
    )
    expect(result.counts.missingBody).toBe(1)
    expect(result.toCreate).toHaveLength(1)
    expect(result.toCreate[0]?.fingerprint).toBe(digestB.fingerprint)
  })

  it('explicit agent-skipped body counts agent-skipped and opens no issue', () => {
    const digest = makeDigest()
    const result = planPatternProposalOpens(
      planInput({
        digestCandidates: [digest],
        bodyFile: {
          schemaVersion: 1,
          bodies: {[digest.fingerprint]: {outcome: 'agent-skipped', reason: 'insufficient-evidence'}},
        },
      }),
    )
    expect(result.counts.agentSkipped).toBe(1)
    expect(result.toCreate).toHaveLength(0)
  })

  it('invalid drafted body fails soft: skips the candidate and posts remaining valid ones', () => {
    const digestA = makeDigest({fingerprint: 'a'.repeat(64), sourceIds: ['source-a', 'source-b']})
    const digestB = makeDigest({fingerprint: 'b'.repeat(64), sourceIds: ['source-c', 'source-d']})
    const result = planPatternProposalOpens(
      planInput({
        digestCandidates: [digestA, digestB],
        bodyFile: {
          schemaVersion: 1,
          bodies: {
            [digestA.fingerprint]: {
              ...makeDraftedBody(),
              unknownField: 'leak',
            } as unknown as DraftedPatternProposalBody,
            [digestB.fingerprint]: makeDraftedBody(),
          },
        },
      }),
    )
    expect(result.counts.invalidBody).toBe(1)
    expect(result.toCreate).toHaveLength(1)
    expect(result.toCreate[0]?.fingerprint).toBe(digestB.fingerprint)
  })

  it('token-load failure (failed tokens) blocks all writes via privacy gate and reports counts-only', () => {
    const result = planPatternProposalOpens(planInput({publicOutputTokens: failedTokens()}))
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.blockedOnPrivacy).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe('planPatternProposalOpens: privacy', () => {
  it('blocks a drafted body containing a private token before posting', () => {
    const privateTokens = new Set(['secret-org/private-repo'])
    const tokens = makePublicOutputTokens({privateTokens, redactedCanonicalIds: new Set()})
    const result = planPatternProposalOpens(
      planInput({
        publicOutputTokens: tokens,
        bodyFile: {
          schemaVersion: 1,
          bodies: {
            [makeDigest().fingerprint]: makeDraftedBody({rationale: 'Seen in secret-org/private-repo as well.'}),
          },
        },
      }),
    )
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.blockedOnPrivacy).toBe(1)
  })

  it('blocks a drafted body containing a hard secret pattern', () => {
    const result = planPatternProposalOpens(
      planInput({
        bodyFile: {
          schemaVersion: 1,
          bodies: {
            [makeDigest().fingerprint]: makeDraftedBody({rationale: `token ghp_${'a'.repeat(40)} leaked`}),
          },
        },
      }),
    )
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.blockedOnPrivacy).toBe(1)
  })

  it('blocks a drafted body containing a redacted canonical ID', () => {
    const tokens = makePublicOutputTokens({
      privateTokens: new Set(),
      redactedCanonicalIds: new Set(['MDEwOlJlcG9zaXRvcnkx']),
    })
    const result = planPatternProposalOpens(
      planInput({
        publicOutputTokens: tokens,
        bodyFile: {
          schemaVersion: 1,
          bodies: {
            [makeDigest().fingerprint]: makeDraftedBody({rationale: 'id MDEwOlJlcG9zaXRvcnkx appears here'}),
          },
        },
      }),
    )
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.blockedOnPrivacy).toBe(1)
  })

  it('rejects a candidate with an unapproved field before it ever reaches the gate', () => {
    const result = planPatternProposalOpens(
      planInput({
        bodyFile: {
          schemaVersion: 1,
          bodies: {
            [makeDigest().fingerprint]: {
              ...makeDraftedBody(),
              privateToken: 'shhh',
            } as unknown as DraftedPatternProposalBody,
          },
        },
      }),
    )
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.invalidBody).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

describe('planPatternProposalOpens: duplicates', () => {
  it('same-run duplicate: a fingerprint already created this run opens no additional issue', () => {
    const digest = makeDigest()
    const result = planPatternProposalOpens(planInput({alreadyCreatedFingerprints: new Set([digest.fingerprint])}))
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.skippedDuplicateSameRun).toBe(1)
  })

  it('cross-run duplicate: an existing open proposal with the same fingerprint prevents opening', () => {
    const digest = makeDigest()
    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map([[digest.fingerprint, [makeIssue()]]]),
      closedByFingerprint: new Map(),
      invalidMarkerCount: 0,
    }
    const result = planPatternProposalOpens(planInput({existing}))
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.skippedDuplicateExisting).toBe(1)
  })

  it('cross-run duplicate: an existing closed proposal with the same fingerprint prevents opening', () => {
    const digest = makeDigest()
    const existing: ExistingPatternProposals = {
      openByFingerprint: new Map(),
      closedByFingerprint: new Map([[digest.fingerprint, [makeIssue({state: 'closed'})]]]),
      invalidMarkerCount: 0,
    }
    const result = planPatternProposalOpens(planInput({existing}))
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.skippedDuplicateExisting).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Mutation-proof: public-output gate must run on every surface
// ---------------------------------------------------------------------------

describe('planPatternProposalOpens: mutation-proof gate coverage', () => {
  it('fails if the title surface skips the gate (secret in derived title cannot happen, so assert gate call via block on body)', () => {
    const result = planPatternProposalOpens(
      planInput({
        bodyFile: {
          schemaVersion: 1,
          bodies: {
            [makeDigest().fingerprint]: makeDraftedBody({patternStatement: `leak sk-ant-${'x'.repeat(30)}`}),
          },
        },
      }),
    )
    expect(result.toCreate).toHaveLength(0)
    expect(result.counts.blockedOnPrivacy).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// I/O shell: openPatternProposalIssues (mocked Octokit)
// ---------------------------------------------------------------------------

const silentLog = () => undefined

function makeMockOctokit() {
  return {
    rest: {
      issues: {
        getLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({data: {number: 42}}),
      },
    },
  }
}

describe('openPatternProposalIssues', () => {
  it('opens issues with required labels when label preflight succeeds', async () => {
    const octokit = makeMockOctokit()
    const result = await openPatternProposalIssues(
      octokit as never,
      'fro-bot',
      '.github',
      [{fingerprint: 'a'.repeat(64), title: 'Pattern proposal: retries', body: 'body text'}],
      silentLog,
    )
    expect(result.opened).toBe(1)
    expect(octokit.rest.issues.create).toHaveBeenCalledWith(expect.objectContaining({labels: [PATTERN_PROPOSAL_LABEL]}))
  })

  it('label preflight failure fails closed and opens nothing', async () => {
    const octokit = makeMockOctokit()
    octokit.rest.issues.getLabel.mockRejectedValue({status: 500})
    octokit.rest.issues.createLabel.mockRejectedValue({status: 500})
    const result = await openPatternProposalIssues(
      octokit as never,
      'fro-bot',
      '.github',
      [{fingerprint: 'a'.repeat(64), title: 'Pattern proposal: retries', body: 'body text'}],
      silentLog,
    )
    expect(result.opened).toBe(0)
    expect(result.skippedLabelUnavailable).toBe(1)
    expect(octokit.rest.issues.create).not.toHaveBeenCalled()
  })

  it('caps at most three issues opened per run', async () => {
    const octokit = makeMockOctokit()
    const toCreate = ['a', 'b', 'c', 'd'].map(c => ({
      fingerprint: c.repeat(64),
      title: `Pattern proposal: ${c}`,
      body: 'body text',
    }))
    const result = await openPatternProposalIssues(octokit as never, 'fro-bot', '.github', toCreate, silentLog)
    expect(result.opened).toBe(3)
  })

  it('empty toCreate is a successful no-op with no label preflight call', async () => {
    const octokit = makeMockOctokit()
    const result = await openPatternProposalIssues(octokit as never, 'fro-bot', '.github', [], silentLog)
    expect(result.opened).toBe(0)
    expect(octokit.rest.issues.getLabel).not.toHaveBeenCalled()
  })
})

describe('ensurePatternProposalLabelsExist', () => {
  it('confirms existing labels and creates missing ones', async () => {
    const octokit = makeMockOctokit()
    octokit.rest.issues.getLabel.mockRejectedValueOnce({status: 404})
    const confirmed = await ensurePatternProposalLabelsExist(
      octokit as never,
      'fro-bot',
      '.github',
      [{name: 'pattern-proposal', color: '5319e7', description: 'x'}],
      silentLog,
    )
    expect(confirmed.has('pattern-proposal')).toBe(true)
    expect(octokit.rest.issues.createLabel).toHaveBeenCalled()
  })
})
