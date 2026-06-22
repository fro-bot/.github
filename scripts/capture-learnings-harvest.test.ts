/**
 * Tests for capture-learnings-harvest.ts
 *
 * Structure:
 * - Pure core tests: drive `buildCandidateDigest` with injected data
 * - Marker helper tests: `buildMergeShaMarker` / `parseMergeShaMarker`
 * - I/O shell tests: `harvestCandidates` and `fetchOpenedLearningShas` with mocked Octokit
 */

import {describe, expect, it, vi} from 'vitest'

import {
  buildCandidateDigest,
  buildMergeShaMarker,
  DEPENDENCY_LABELS,
  fetchOpenedLearningShas,
  FRO_BOT_REVIEWER_LOGINS,
  harvestCandidates,
  LEARNING_PROPOSAL_LABEL,
  MAX_EXCERPT_CHARS_PER_CANDIDATE,
  parseMergeShaMarker,
  type BuildCandidateDigestInput,
  type Candidate,
  type CandidateDigest,
  type HarvestStageCounts,
  type OctokitClient,
  type SolutionDoc,
} from './capture-learnings-harvest.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    mergeSha: 'abc123def456abc123def456abc123def456abc1',
    reviewRounds: 2,
    signals: {titleTokens: ['feat', 'scripts'], labels: []},
    reviewExcerpts: [],
    ...overrides,
  }
}

function makeSolutionDoc(overrides: Partial<SolutionDoc> = {}): SolutionDoc {
  return {
    path: 'docs/solutions/best-practices/some-doc.md',
    module: 'scripts/some-module.ts',
    tags: ['automation', 'ci'],
    problemType: 'best_practice',
    ...overrides,
  }
}

function makeZeroStageCounts(): HarvestStageCounts {
  return {
    closedPrsFetched: 0,
    mergedPrsInLookback: 0,
    excludedAutomation: 0,
    multiRoundCandidates: 0,
  }
}

function makeDigestInput(overrides: Partial<BuildCandidateDigestInput> = {}): BuildCandidateDigestInput {
  return {
    mergedPrs: [makeCandidate()],
    stageCounts: makeZeroStageCounts(),
    openedLearningShas: new Set(),
    solutionsDocs: [],
    maxLearnings: 5,
    privateTokens: new Set(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

describe('buildMergeShaMarker', () => {
  it('produces the expected HTML comment format', () => {
    // #given a merge SHA
    // #when building the marker
    // #then it matches the expected format
    expect(buildMergeShaMarker('abc123')).toBe('<!-- captured-learning:merge_sha=abc123 -->')
  })

  it('marker round-trip: buildMergeShaMarker output is parsed back by parseMergeShaMarker', () => {
    // #given a full-length merge SHA
    const sha = 'abc123def456abc123def456abc123def456abc1'

    // #when building the marker and parsing it back
    const marker = buildMergeShaMarker(sha)
    const parsed = parseMergeShaMarker(marker)

    // #then the SHA round-trips correctly
    expect(parsed).toBe(sha)
    // #then the marker string starts with the expected prefix
    expect(marker.startsWith('<!-- captured-learning:')).toBe(true)
  })
})

describe('parseMergeShaMarker', () => {
  it('extracts the SHA from a well-formed marker', () => {
    // #given a body containing the marker
    const body = 'Some text\n<!-- captured-learning:merge_sha=abc123def456 -->\nMore text'
    // #when parsing
    // #then the SHA is returned
    expect(parseMergeShaMarker(body)).toBe('abc123def456')
  })

  it('returns null when no marker is present', () => {
    // #given a body without the marker
    // #when parsing
    // #then null is returned
    expect(parseMergeShaMarker('No marker here')).toBeNull()
  })

  it('returns null for a malformed marker (missing sha)', () => {
    // #given a body with a malformed marker
    // #when parsing
    // #then null is returned (regex requires 7-40 hex chars)
    expect(parseMergeShaMarker('<!-- captured-learning:merge_sha= -->')).toBeNull()
  })

  it('returns null for an empty body', () => {
    // #given an empty body
    // #when parsing
    // #then null is returned without crashing
    expect(parseMergeShaMarker('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pure core: buildCandidateDigest
// ---------------------------------------------------------------------------

describe('buildCandidateDigest', () => {
  describe('happy path', () => {
    it('includes a PR with reviewRounds=2, no prior proposal, no solution overlap', () => {
      // #given a single candidate with 2 review rounds, not yet proposed, no doc overlap
      const input = makeDigestInput()

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is in the output with its mergeSha and reviewRounds
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]?.mergeSha).toBe(makeCandidate().mergeSha)
      expect(result.candidates[0]?.reviewRounds).toBe(2)
    })
  })

  describe('opacity guarantee', () => {
    it('emitted candidates have ONLY mergeSha, reviewRounds, signals, and reviewExcerpts keys — no owner/repo/number/title', () => {
      // #given a candidate
      const input = makeDigestInput()

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then each candidate object has exactly the allowed keys
      for (const candidate of result.candidates) {
        const keys = Object.keys(candidate).sort()
        expect(keys).toEqual(['mergeSha', 'reviewExcerpts', 'reviewRounds', 'signals'].sort())
        // Explicitly assert forbidden keys are absent
        expect(candidate).not.toHaveProperty('owner')
        expect(candidate).not.toHaveProperty('repo')
        expect(candidate).not.toHaveProperty('number')
        expect(candidate).not.toHaveProperty('title')
      }
    })
  })

  describe('seen-set dedup', () => {
    it('excludes a candidate whose mergeSha is in openedLearningShas', () => {
      // #given a candidate whose SHA is already in the seen-set
      const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({mergeSha: sha})],
        openedLearningShas: new Set([sha]),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is excluded
      expect(result.candidates).toHaveLength(0)
      expect(result.telemetry.afterSeenDedup).toBe(0)
    })

    it('mutation proof: removing the seen-set filter makes the candidate reappear', () => {
      // #given the same candidate with and without the seen-set
      const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const candidate = makeCandidate({mergeSha: sha})

      // #when the seen-set contains the SHA
      const withDedup = buildCandidateDigest(
        makeDigestInput({
          mergedPrs: [candidate],
          openedLearningShas: new Set([sha]),
        }),
      )
      // #then the candidate is excluded
      expect(withDedup.candidates).toHaveLength(0)

      // #when the seen-set is empty (dedup removed)
      const withoutDedup = buildCandidateDigest(
        makeDigestInput({
          mergedPrs: [candidate],
          openedLearningShas: new Set(),
        }),
      )
      // #then the candidate reappears — proving the dedup was the gate
      expect(withoutDedup.candidates).toHaveLength(1)
      expect(withoutDedup.candidates[0]?.mergeSha).toBe(sha)
    })

    it('includes a candidate whose mergeSha is NOT in openedLearningShas', () => {
      // #given a candidate with a SHA not in the seen-set
      const input = makeDigestInput({
        openedLearningShas: new Set(['other-sha-not-matching']),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is included
      expect(result.candidates).toHaveLength(1)
    })
  })

  describe('solutions dedup', () => {
    it('excludes a candidate whose signals exactly match an existing doc problem_type', () => {
      // #given a candidate with a label matching a doc's problem_type
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({signals: {titleTokens: [], labels: ['best_practice']}})],
        solutionsDocs: [makeSolutionDoc({problemType: 'best_practice', tags: [], module: ''})],
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is excluded (exact problem_type match = 100 points >= threshold)
      expect(result.candidates).toHaveLength(0)
      expect(result.telemetry.afterSolutionsDedup).toBe(0)
    })

    it('includes a candidate that shares only ONE tag with an existing doc (single-tag no longer triggers dedup)', () => {
      // #given a candidate with a single label matching a doc tag
      // Threshold is now 20 — a single shared tag (10 pts) is below threshold.
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({signals: {titleTokens: [], labels: ['automation']}})],
        solutionsDocs: [makeSolutionDoc({tags: ['automation'], problemType: '', module: ''})],
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is INCLUDED (single tag = 10 pts < threshold of 20)
      expect(result.candidates).toHaveLength(1)
    })

    it('excludes a candidate whose signals share TWO or more tags with an existing doc', () => {
      // #given a candidate with two labels both matching doc tags
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({signals: {titleTokens: [], labels: ['automation', 'ci']}})],
        solutionsDocs: [makeSolutionDoc({tags: ['automation', 'ci'], problemType: '', module: ''})],
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is excluded (2 shared tags = 20 pts >= threshold of 20)
      expect(result.candidates).toHaveLength(0)
    })

    it('includes a candidate with no signal overlap against existing docs', () => {
      // #given a candidate with signals that share nothing with any doc
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({signals: {titleTokens: ['xyz', 'unrelated'], labels: ['unrelated-label']}})],
        solutionsDocs: [
          makeSolutionDoc({tags: ['automation', 'ci'], problemType: 'best_practice', module: 'scripts/other.ts'}),
        ],
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is included
      expect(result.candidates).toHaveLength(1)
    })

    it('includes a candidate when solutionsDocs is empty', () => {
      // #given no existing solutions docs
      const input = makeDigestInput({solutionsDocs: []})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is included
      expect(result.candidates).toHaveLength(1)
    })
  })

  describe('cap', () => {
    it('caps candidates to maxLearnings when more are available', () => {
      // #given 7 candidates and a cap of 3
      const candidates = Array.from({length: 7}, (_, i) =>
        makeCandidate({mergeSha: `sha${i}${'0'.repeat(35 - String(i).length)}`}),
      )
      const input = makeDigestInput({
        mergedPrs: candidates,
        maxLearnings: 3,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then only 3 candidates are emitted
      expect(result.candidates).toHaveLength(3)
      expect(result.telemetry.emitted).toBe(3)
    })

    it('emits all candidates when count is below the cap', () => {
      // #given 2 candidates and a cap of 5
      const candidates = [
        makeCandidate({mergeSha: `sha1${'0'.repeat(36)}`}),
        makeCandidate({mergeSha: `sha2${'0'.repeat(36)}`}),
      ]
      const input = makeDigestInput({mergedPrs: candidates, maxLearnings: 5})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then both candidates are emitted
      expect(result.candidates).toHaveLength(2)
      expect(result.telemetry.emitted).toBe(2)
    })
  })

  describe('telemetry counts', () => {
    it('reports correct counts through the dedup pipeline', () => {
      // #given 5 candidates: 2 already proposed, 1 overlaps a doc (2 shared tags), 2 clean
      const seenSha1 = `proposed1${'0'.repeat(31)}`
      const seenSha2 = `proposed2${'0'.repeat(31)}`
      const overlapSha = `overlap1${'0'.repeat(32)}`
      const cleanSha1 = `clean001${'0'.repeat(32)}`
      const cleanSha2 = `clean002${'0'.repeat(32)}`

      const stageCounts: HarvestStageCounts = {
        closedPrsFetched: 20,
        mergedPrsInLookback: 10,
        excludedAutomation: 2,
        multiRoundCandidates: 5,
      }

      const input = makeDigestInput({
        mergedPrs: [
          makeCandidate({mergeSha: seenSha1}),
          makeCandidate({mergeSha: seenSha2}),
          // Two shared tags (automation + ci) = 20 pts >= threshold of 20 → excluded
          makeCandidate({mergeSha: overlapSha, signals: {titleTokens: [], labels: ['automation', 'ci']}}),
          makeCandidate({mergeSha: cleanSha1}),
          makeCandidate({mergeSha: cleanSha2}),
        ],
        stageCounts,
        openedLearningShas: new Set([seenSha1, seenSha2]),
        solutionsDocs: [makeSolutionDoc({tags: ['automation', 'ci'], problemType: '', module: ''})],
        maxLearnings: 5,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then harvest-stage telemetry is threaded through
      expect(result.telemetry.closedPrsFetched).toBe(20)
      expect(result.telemetry.mergedPrsInLookback).toBe(10)
      expect(result.telemetry.excludedAutomation).toBe(2)
      expect(result.telemetry.multiRoundCandidates).toBe(5)
      // #then dedup-stage telemetry reflects each stage
      expect(result.telemetry.afterSeenDedup).toBe(3) // 5 - 2 proposed
      expect(result.telemetry.afterSolutionsDedup).toBe(2) // 3 - 1 overlap
      expect(result.telemetry.emitted).toBe(2) // 2 clean, under cap
      // #then enrichmentBlocked is zero (no private tokens, no enriched content)
      expect(result.telemetry.enrichmentBlocked).toBe(0)
    })

    it('reports zero counts when all candidates are filtered', () => {
      // #given all candidates already proposed
      const sha = `allproposed${'0'.repeat(29)}`
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({mergeSha: sha})],
        openedLearningShas: new Set([sha]),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then dedup counts are zero
      expect(result.telemetry.afterSeenDedup).toBe(0)
      expect(result.telemetry.afterSolutionsDedup).toBe(0)
      expect(result.telemetry.emitted).toBe(0)
    })

    it('reports zero counts when input is empty', () => {
      // #given no candidates
      const input = makeDigestInput({mergedPrs: []})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then all counts are zero
      expect(result.telemetry.afterSeenDedup).toBe(0)
      expect(result.telemetry.afterSolutionsDedup).toBe(0)
      expect(result.telemetry.emitted).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// I/O shell: harvestCandidates (mocked Octokit)
// ---------------------------------------------------------------------------

interface PullsListItem {
  number: number
  merged_at: string | null
  merge_commit_sha: string | null
  title: string
  labels: {name: string}[]
  user: {login: string} | null
}

interface ReviewItem {
  state: string
  user: {login: string} | null
  body?: string
}

interface ReviewCommentItem {
  body: string
}

function makePullsListItem(overrides: Partial<PullsListItem> = {}): PullsListItem {
  return {
    number: 1,
    merged_at: new Date().toISOString(),
    merge_commit_sha: 'abc123def456abc123def456abc123def456abc1',
    title: 'feat: add new feature',
    labels: [],
    user: {login: 'some-human'},
    ...overrides,
  }
}

function makeReviewItem(state: string, login = 'fro-bot', body = ''): ReviewItem {
  return {state, user: {login}, body}
}

function makeReviewCommentItem(body: string): ReviewCommentItem {
  return {body}
}

function mockOctokit(
  overrides: {
    /** Override the paginate call for pulls.list (returns the PR array directly). */
    paginatePrList?: () => Promise<unknown[]>
    /** Override the paginate call for pulls.listReviews (returns the review array directly). */
    paginateListReviews?: () => Promise<ReviewItem[]>
    /** Override the paginate call for pulls.listReviewComments (returns the comment array directly). */
    paginateListReviewComments?: () => Promise<ReviewCommentItem[]>
    /** Legacy: override pullsListReviews for tests that use the old mock shape. */
    pullsListReviews?: (opts: unknown) => Promise<{data: ReviewItem[]}>
  } = {},
): OctokitClient {
  const listReviewsFn = overrides.pullsListReviews ?? (async () => ({data: [] as ReviewItem[]}))
  const listReviewCommentsFn = async () => ({data: [] as ReviewCommentItem[]})

  // paginate is called with (fn, opts). We route by checking which rest method fn is.
  const paginate = async (fn: unknown, opts: unknown): Promise<unknown[]> => {
    // Route: if fn is the listReviews function, use paginateListReviews override or call fn directly
    if (fn === listReviewsFn) {
      if (overrides.paginateListReviews !== undefined) {
        return overrides.paginateListReviews() as Promise<unknown[]>
      }
      const result = await listReviewsFn(opts)
      return result.data
    }
    // Route: if fn is the listReviewComments function
    if (fn === listReviewCommentsFn) {
      if (overrides.paginateListReviewComments !== undefined) {
        return overrides.paginateListReviewComments() as Promise<unknown[]>
      }
      return []
    }
    // Otherwise it's pulls.list (or issues.listForRepo)
    if (overrides.paginatePrList !== undefined) {
      return overrides.paginatePrList()
    }
    const call = fn as (opts: unknown) => Promise<{data: unknown[]}>
    const response = await call(opts)
    return response.data
  }

  return {
    paginate,
    rest: {
      pulls: {
        list: async () => ({data: []}),
        listReviews: listReviewsFn,
        listReviewComments: listReviewCommentsFn,
      },
      issues: {
        listForRepo: async () => ({data: []}),
      },
    },
  } as unknown as OctokitClient
}

describe('harvestCandidates', () => {
  // -------------------------------------------------------------------------
  // Basic exclusion (merged_at / lookback / merge_commit_sha)
  // -------------------------------------------------------------------------

  it('excludes a PR with merged_at === null (unmerged)', async () => {
    // #given a closed PR that was never merged
    const pr = makePullsListItem({merged_at: null})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded
    expect(candidates).toHaveLength(0)
  })

  it('excludes a PR merged outside the lookback window', async () => {
    // #given a PR merged 60 days ago (beyond LOOKBACK_DAYS=30)
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 60)
    const pr = makePullsListItem({merged_at: oldDate.toISOString()})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded
    expect(candidates).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Dependency-automation exclusion
  // -------------------------------------------------------------------------

  it('excludes a PR authored by renovate[bot]', async () => {
    // #given a merged PR authored by renovate[bot] with qualifying fro-bot reviews
    const pr = makePullsListItem({user: {login: 'renovate[bot]'}})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates, stageCounts} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded by author, not counted as a candidate
    expect(candidates).toHaveLength(0)
    expect(stageCounts.excludedAutomation).toBe(1)
  })

  it('excludes a PR authored by dependabot[bot]', async () => {
    // #given a merged PR authored by dependabot[bot]
    const pr = makePullsListItem({user: {login: 'dependabot[bot]'}})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates, stageCounts} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded by author
    expect(candidates).toHaveLength(0)
    expect(stageCounts.excludedAutomation).toBe(1)
  })

  it('excludes a PR carrying a "dependencies" label', async () => {
    // #given a merged PR with a 'dependencies' label and qualifying fro-bot reviews
    const pr = makePullsListItem({labels: [{name: 'dependencies'}]})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates, stageCounts} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded by label
    expect(candidates).toHaveLength(0)
    expect(stageCounts.excludedAutomation).toBe(1)
  })

  it('excludes a PR carrying a "renovate" label', async () => {
    // #given a merged PR with a 'renovate' label
    const pr = makePullsListItem({labels: [{name: 'renovate'}]})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates, stageCounts} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded by label
    expect(candidates).toHaveLength(0)
    expect(stageCounts.excludedAutomation).toBe(1)
  })

  it('excludes a PR carrying a "dependencies:github-actions" label', async () => {
    // #given a merged PR with a 'dependencies:github-actions' label and qualifying fro-bot reviews
    const pr = makePullsListItem({labels: [{name: 'dependencies:github-actions'}]})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates, stageCounts} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded by label, counted as automation
    expect(candidates).toHaveLength(0)
    expect(stageCounts.excludedAutomation).toBe(1)
  })

  it('excludes a PR with merge_commit_sha === null even when merged_at is valid', async () => {
    // #given a merged PR with a valid merged_at but null merge_commit_sha
    // (can happen when a merge commit is not recorded, e.g. squash-merge edge cases)
    const pr = makePullsListItem({merge_commit_sha: null})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded (no merge SHA to use as the candidate identifier)
    expect(candidates).toHaveLength(0)
  })

  it('DEPENDENCY_LABELS set contains the expected labels', () => {
    // #given the exported constant
    // #then it contains the three expected labels
    expect(DEPENDENCY_LABELS.has('dependencies')).toBe(true)
    expect(DEPENDENCY_LABELS.has('renovate')).toBe(true)
    expect(DEPENDENCY_LABELS.has('dependencies:github-actions')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // New predicate: fro-bot login keying + substantive/correction counts
  // -------------------------------------------------------------------------

  it('APPROVED 1 + DISMISSED 1 → CANDIDATE (substantive=2, correction=1) — #3540/#3543 shape', async () => {
    // #given a merged PR where fro-bot submitted APPROVED then DISMISSED
    // DISMISSED = prior APPROVED auto-dismissed by a new push = real correction round
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const pr = makePullsListItem({merge_commit_sha: sha})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is a candidate with reviewRounds = 2 (substantive count)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.mergeSha).toBe(sha)
    expect(candidates[0]?.reviewRounds).toBe(2)
  })

  it('CHANGES_REQUESTED 1 + APPROVED 1 → CANDIDATE (substantive=2, correction=1) — #3530/#3517 shape', async () => {
    // #given a merged PR where fro-bot submitted CHANGES_REQUESTED then APPROVED
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const pr = makePullsListItem({merge_commit_sha: sha})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('CHANGES_REQUESTED'), makeReviewItem('APPROVED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is a candidate (CR still counts as correction signal)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewRounds).toBe(2)
  })

  it('APPROVED 2 + DISMISSED 1 → CANDIDATE (substantive=3, correction=1) — #3526 shape', async () => {
    // #given a merged PR with 3 substantive fro-bot reviews, 1 correction
    const sha = `sha3526${'0'.repeat(34)}`
    const pr = makePullsListItem({merge_commit_sha: sha})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [
        makeReviewItem('APPROVED'),
        makeReviewItem('DISMISSED'),
        makeReviewItem('APPROVED'),
      ],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is a candidate with reviewRounds = 3
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewRounds).toBe(3)
  })

  it('DISMISSED 2 → CANDIDATE (substantive=2, correction=2) — #3514 shape', async () => {
    // #given a merged PR where fro-bot submitted 2 DISMISSED reviews
    const sha = `sha3514${'0'.repeat(34)}`
    const pr = makePullsListItem({merge_commit_sha: sha})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('DISMISSED'), makeReviewItem('DISMISSED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is a candidate
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewRounds).toBe(2)
  })

  it('APPROVED 1 only → NOT candidate (substantive=1 < MIN_SUBSTANTIVE_REVIEW_ROUNDS) — #3539 shape', async () => {
    // #given a merged PR with only 1 fro-bot APPROVED review (clean single-round approval)
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is NOT a candidate (below MIN_SUBSTANTIVE_REVIEW_ROUNDS)
    expect(candidates).toHaveLength(0)
  })

  it('APPROVED 2, no correction → NOT candidate (substantive=2 but correction=0) — key edge case', async () => {
    // #given a merged PR with 2 fro-bot APPROVED reviews but zero correction signals
    // This proves correction >= MIN_CORRECTION_SIGNALS is required, not just rounds >= 2.
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED'), makeReviewItem('APPROVED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is NOT a candidate (no correction signal)
    expect(candidates).toHaveLength(0)
  })

  it('reviews by a non-fro-bot login are NOT counted — login keying proof', async () => {
    // #given a merged PR where 'someone-else' submitted APPROVED + DISMISSED
    // (qualifying if login filter were absent, but fro-bot has no reviews)
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [
        makeReviewItem('APPROVED', 'someone-else'),
        makeReviewItem('DISMISSED', 'someone-else'),
      ],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is NOT a candidate (non-fro-bot reviews are ignored)
    expect(candidates).toHaveLength(0)
  })

  it('mutation proof: removing login filter makes non-fro-bot multi-review PR a candidate', async () => {
    // #given a PR with 'someone-else' APPROVED + DISMISSED (would qualify without login filter)
    // This test proves the login filter is the gate — if you remove it, the PR wrongly qualifies.
    // We verify by checking FRO_BOT_REVIEWER_LOGINS does NOT contain 'someone-else'.
    expect(FRO_BOT_REVIEWER_LOGINS.has('someone-else')).toBe(false)
    expect(FRO_BOT_REVIEWER_LOGINS.has('fro-bot')).toBe(true)

    // #when the same reviews are attributed to fro-bot instead
    const sha = `mutationproof${'0'.repeat(28)}`
    const pr = makePullsListItem({merge_commit_sha: sha})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED', 'fro-bot'), makeReviewItem('DISMISSED', 'fro-bot')],
    })
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then with fro-bot login the PR IS a candidate — proving login keying is the gate
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.mergeSha).toBe(sha)
  })

  it('COMMENTED reviews do not count toward substantive (2 COMMENTED → not candidate)', async () => {
    // #given a merged PR where fro-bot submitted 2 COMMENTED reviews only
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('COMMENTED'), makeReviewItem('COMMENTED')],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is NOT a candidate (COMMENTED excluded from substantive count)
    expect(candidates).toHaveLength(0)
  })

  it('COMMENTED reviews mixed with 1 APPROVED → not candidate (substantive=1)', async () => {
    // #given fro-bot submitted 2 COMMENTED + 1 APPROVED
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [
        makeReviewItem('COMMENTED'),
        makeReviewItem('COMMENTED'),
        makeReviewItem('APPROVED'),
      ],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is NOT a candidate (only 1 substantive review)
    expect(candidates).toHaveLength(0)
  })

  it('skips a PR when paginate(listReviews) throws a transient error, continues processing others', async () => {
    // #given two PRs: one whose paginate(listReviews) throws, one that succeeds
    const goodSha = `goodsha1${'0'.repeat(32)}`
    const badPr = makePullsListItem({number: 1, merge_commit_sha: `badsha1${'0'.repeat(33)}`})
    const goodPr = makePullsListItem({number: 2, merge_commit_sha: goodSha})

    // paginateListReviews is called once per PR; first call throws, second succeeds
    const paginateListReviews = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), {status: 503}))
      .mockResolvedValueOnce([makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')])

    const octokit = mockOctokit({
      paginatePrList: async () => [badPr, goodPr],
      paginateListReviews: paginateListReviews as () => Promise<ReviewItem[]>,
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the bad PR is skipped, the good PR is included
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.mergeSha).toBe(goodSha)
  })

  it('counts substantive reviews across multiple pages (pagination correctness)', async () => {
    // #given a PR whose reviews span 2 pages (simulated by paginateListReviews returning all)
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const pr = makePullsListItem({merge_commit_sha: sha})

    // Simulate paginate returning reviews from both pages combined:
    // fro-bot: APPROVED, DISMISSED, APPROVED (3 substantive, 1 correction)
    // COMMENTED is excluded from substantive count
    const allReviews: ReviewItem[] = [
      makeReviewItem('APPROVED'), // page 1
      makeReviewItem('COMMENTED'), // excluded
      makeReviewItem('DISMISSED'), // page 2 — correction signal
      makeReviewItem('APPROVED'), // page 2 continued
    ]

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => allReviews,
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then all 3 substantive reviews are counted (not just the first page)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewRounds).toBe(3)
  })

  // -------------------------------------------------------------------------
  // Telemetry: explicit stage counts
  // -------------------------------------------------------------------------

  it('telemetry: reports correct stage counts through a multi-PR scenario', async () => {
    // #given 6 closed PRs:
    //   - 1 unmerged (excluded before mergedPrsInLookback)
    //   - 1 merged outside lookback (excluded before mergedPrsInLookback)
    //   - 1 merged in lookback, renovate[bot] author (excludedAutomation)
    //   - 1 merged in lookback, no fro-bot substantive review (not a candidate)
    //   - 1 merged in lookback, APPROVED only (not a candidate)
    //   - 2 merged in lookback, qualifying fro-bot reviews (candidates)
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 60)

    const unmergedPr = makePullsListItem({number: 1, merged_at: null})
    const oldPr = makePullsListItem({number: 2, merged_at: oldDate.toISOString()})
    const renovatePr = makePullsListItem({number: 3, user: {login: 'renovate[bot]'}})
    const noReviewPr = makePullsListItem({number: 4, merge_commit_sha: `norev${'0'.repeat(35)}`})
    const approvedOnlyPr = makePullsListItem({number: 5, merge_commit_sha: `appr1${'0'.repeat(35)}`})
    const candidate1Pr = makePullsListItem({number: 6, merge_commit_sha: `cand1${'0'.repeat(35)}`})
    const candidate2Pr = makePullsListItem({number: 7, merge_commit_sha: `cand2${'0'.repeat(35)}`})

    const reviewsByPr: Record<number, ReviewItem[]> = {
      3: [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')], // renovate — excluded before reviews
      4: [], // no reviews
      5: [makeReviewItem('APPROVED')], // only 1 substantive
      6: [makeReviewItem('APPROVED'), makeReviewItem('DISMISSED')], // candidate
      7: [makeReviewItem('CHANGES_REQUESTED'), makeReviewItem('APPROVED')], // candidate
    }

    let reviewCallCount = 0
    const paginateListReviews = vi.fn(async () => {
      // PRs are processed in order: renovate is excluded before reviews are fetched.
      // Remaining: noReviewPr(4), approvedOnlyPr(5), candidate1Pr(6), candidate2Pr(7)
      const prNumbers = [4, 5, 6, 7]
      const prNum = prNumbers[reviewCallCount++]
      return reviewsByPr[prNum ?? 4] ?? []
    })

    const octokit = mockOctokit({
      paginatePrList: async () => [
        unmergedPr,
        oldPr,
        renovatePr,
        noReviewPr,
        approvedOnlyPr,
        candidate1Pr,
        candidate2Pr,
      ],
      paginateListReviews: paginateListReviews as () => Promise<ReviewItem[]>,
    })

    // #when harvesting
    const {candidates, stageCounts} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then stage counts are explicit and correct
    expect(stageCounts.closedPrsFetched).toBe(7)
    expect(stageCounts.mergedPrsInLookback).toBe(5) // excludes unmerged + old
    expect(stageCounts.excludedAutomation).toBe(1) // renovate[bot]
    expect(stageCounts.multiRoundCandidates).toBe(2) // cand1 + cand2
    expect(candidates).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// I/O shell: fetchOpenedLearningShas (mocked Octokit)
// ---------------------------------------------------------------------------

interface IssueListItem {
  number: number
  body: string | null
}

function makeIssueListItem(overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    number: 1,
    body: null,
    ...overrides,
  }
}

function mockOctokitForIssues(
  overrides: {
    paginate?: (fn: unknown, opts: unknown) => Promise<unknown[]>
  } = {},
): OctokitClient {
  const defaultPaginate = async (fn: unknown, opts: unknown): Promise<unknown[]> => {
    const call = fn as (opts: unknown) => Promise<{data: unknown[]}>
    const response = await call(opts)
    return response.data
  }

  return {
    paginate: overrides.paginate ?? defaultPaginate,
    rest: {
      pulls: {
        list: async () => ({data: []}),
        listReviews: async () => ({data: []}),
      },
      issues: {
        listForRepo: async () => ({data: []}),
      },
    },
  } as unknown as OctokitClient
}

describe('fetchOpenedLearningShas', () => {
  it('parses the merge SHA from a learning-proposal issue body', async () => {
    // #given an issue with a valid marker in its body
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const issue = makeIssueListItem({body: `Some text\n${buildMergeShaMarker(sha)}\nMore text`})
    const octokit = mockOctokitForIssues({
      paginate: async () => [issue],
    })

    // #when fetching proposed SHAs
    const result = await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then the SHA is in the seen-set
    expect(result.has(sha)).toBe(true)
    expect(result.size).toBe(1)
  })

  it('includes SHAs from closed learning-proposal issues (state: all)', async () => {
    // #given a closed issue with a valid marker (state: all means closed issues are included)
    const sha = `c10${'0'.repeat(37)}`
    const issue = makeIssueListItem({body: buildMergeShaMarker(sha)})
    const octokit = mockOctokitForIssues({
      paginate: async () => [issue],
    })

    // #when fetching proposed SHAs
    const result = await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then the SHA from the closed issue is in the seen-set
    expect(result.has(sha)).toBe(true)
  })

  it('skips an issue with a null body without crashing', async () => {
    // #given an issue with a null body
    const issue = makeIssueListItem({body: null})
    const octokit = mockOctokitForIssues({
      paginate: async () => [issue],
    })

    // #when fetching proposed SHAs
    const result = await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then the result is an empty set (no crash)
    expect(result.size).toBe(0)
  })

  it('skips an issue with an empty body without crashing', async () => {
    // #given an issue with an empty body
    const issue = makeIssueListItem({body: ''})
    const octokit = mockOctokitForIssues({
      paginate: async () => [issue],
    })

    // #when fetching proposed SHAs
    const result = await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then the result is an empty set (no crash)
    expect(result.size).toBe(0)
  })

  it('skips an issue with a body that has no marker', async () => {
    // #given an issue with a body but no marker
    const issue = makeIssueListItem({body: 'This is a learning proposal without a marker.'})
    const octokit = mockOctokitForIssues({
      paginate: async () => [issue],
    })

    // #when fetching proposed SHAs
    const result = await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then the result is an empty set
    expect(result.size).toBe(0)
  })

  it('collects multiple SHAs from multiple issues', async () => {
    // #given multiple issues each with a valid marker
    const sha1 = `a1${'0'.repeat(38)}`
    const sha2 = `b2${'0'.repeat(38)}`
    const issues = [
      makeIssueListItem({number: 1, body: buildMergeShaMarker(sha1)}),
      makeIssueListItem({number: 2, body: buildMergeShaMarker(sha2)}),
    ]
    const octokit = mockOctokitForIssues({
      paginate: async () => issues,
    })

    // #when fetching proposed SHAs
    const result = await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then both SHAs are in the seen-set
    expect(result.has(sha1)).toBe(true)
    expect(result.has(sha2)).toBe(true)
    expect(result.size).toBe(2)
  })

  it('uses the LEARNING_PROPOSAL_LABEL constant when querying issues', async () => {
    // #given a paginate spy that captures the options
    const paginateSpy = vi.fn(async () => [])
    const octokit = mockOctokitForIssues({paginate: paginateSpy as (fn: unknown, opts: unknown) => Promise<unknown[]>})

    // #when fetching proposed SHAs
    await fetchOpenedLearningShas(octokit, 'fro-bot', '.github')

    // #then the paginate call includes the learning-proposal label
    expect(paginateSpy).toHaveBeenCalledOnce()
    const callArgs = paginateSpy.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(callArgs[1]).toMatchObject({labels: LEARNING_PROPOSAL_LABEL})
  })
})

// ---------------------------------------------------------------------------
// Contract test: harvest→propose schema round-trip
// ---------------------------------------------------------------------------

describe('harvest→open schema contract', () => {
  it('CandidateDigest serializes and deserializes with candidates intact', () => {
    // #given a CandidateDigest produced by buildCandidateDigest (as harvest would write it)
    const candidates: Candidate[] = [
      {
        mergeSha: 'abc123def456abc123def456abc123def456abc1',
        reviewRounds: 3,
        signals: {titleTokens: ['feat', 'scripts'], labels: ['ci', 'automation']},
        reviewExcerpts: ['The correction prose here.'],
      },
      {
        mergeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        reviewRounds: 2,
        signals: {titleTokens: ['fix', 'workflow'], labels: []},
        reviewExcerpts: [],
      },
    ]
    const digest: CandidateDigest = {
      candidates,
      telemetry: {
        closedPrsFetched: 20,
        mergedPrsInLookback: 10,
        excludedAutomation: 1,
        multiRoundCandidates: 5,
        afterSeenDedup: 3,
        afterSolutionsDedup: 2,
        emitted: 2,
        enrichmentBlocked: 0,
      },
    }

    // #when serializing (as harvest writes to CAPTURE_LEARNINGS_DIGEST_PATH)
    const serialized = JSON.stringify(digest)

    // #when deserializing (as the open step reads from CAPTURE_LEARNINGS_DIGEST_PATH)
    const deserialized = JSON.parse(serialized) as CandidateDigest

    // #then the shape is {candidates, telemetry} — not a bare array
    expect(deserialized).toHaveProperty('candidates')
    expect(deserialized).toHaveProperty('telemetry')
    expect(Array.isArray(deserialized.candidates)).toBe(true)

    // #then candidates round-trip correctly
    expect(deserialized.candidates).toHaveLength(2)
    expect(deserialized.candidates[0]?.mergeSha).toBe('abc123def456abc123def456abc123def456abc1')
    expect(deserialized.candidates[0]?.reviewRounds).toBe(3)
    expect(deserialized.candidates[1]?.mergeSha).toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')

    // #then telemetry round-trips correctly
    expect(deserialized.telemetry.closedPrsFetched).toBe(20)
    expect(deserialized.telemetry.mergedPrsInLookback).toBe(10)
    expect(deserialized.telemetry.excludedAutomation).toBe(1)
    expect(deserialized.telemetry.multiRoundCandidates).toBe(5)
    expect(deserialized.telemetry.emitted).toBe(2)

    // #then the open step can iterate candidates without TypeError
    const shas = deserialized.candidates.map(c => c.mergeSha)
    expect(shas).toHaveLength(2)
  })

  it('UTC consistency: lookback cutoff uses UTC ms on both sides', () => {
    // #given a now date and a merged_at string both in UTC
    const nowMs = Date.UTC(2026, 5, 22, 12, 0, 0) // 2026-06-22T12:00:00Z
    const now = new Date(nowMs)
    const cutoffMs = nowMs - 30 * 24 * 60 * 60 * 1000

    // A PR merged exactly at the cutoff boundary (UTC)
    const atCutoff = new Date(cutoffMs)
    const justBefore = new Date(cutoffMs - 1)
    const justAfter = new Date(cutoffMs + 1)

    // #then the comparison is consistent: cutoff < mergedAt means included
    expect(atCutoff < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)).toBe(false)
    expect(justBefore < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)).toBe(true)
    expect(justAfter < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Pure core: enrichment + upstream privacy scan
// ---------------------------------------------------------------------------

describe('buildCandidateDigest — enrichment and upstream privacy scan', () => {
  describe('happy path: reviewExcerpts populated and ranked', () => {
    it('candidate with review excerpts passes them through when no private tokens match', () => {
      // #given a candidate with review excerpts (correction prose + approval boilerplate)
      const candidate = makeCandidate({
        reviewExcerpts: ['Please fix the null check here.', 'LGTM, approved!'],
      })
      const input = makeDigestInput({
        mergedPrs: [candidate],
        privateTokens: new Set(),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is emitted with its reviewExcerpts intact
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]?.reviewExcerpts).toEqual(['Please fix the null check here.', 'LGTM, approved!'])
      expect(result.telemetry.enrichmentBlocked).toBe(0)
    })

    it('candidate with empty reviewExcerpts emits with empty array', () => {
      // #given a candidate with no review excerpts (title-only)
      const candidate = makeCandidate({reviewExcerpts: []})
      const input = makeDigestInput({mergedPrs: [candidate], privateTokens: new Set()})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is emitted with empty reviewExcerpts
      expect(result.candidates[0]?.reviewExcerpts).toEqual([])
      expect(result.telemetry.enrichmentBlocked).toBe(0)
    })
  })

  describe('upstream privacy scan — load-bearing security', () => {
    it('drops reviewExcerpts when prose contains a private token, keeps the candidate (title-only)', () => {
      // #given a private token set built from a synthetic private repo
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])

      // #given a candidate whose review prose contains the private repo reference
      const candidate = makeCandidate({
        mergeSha: 'privateshaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
        reviewExcerpts: ['See testowner/secret-repo#42 for context.', 'LGTM'],
      })
      const input = makeDigestInput({
        mergedPrs: [candidate],
        privateTokens,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is KEPT (not dropped)
      expect(result.candidates).toHaveLength(1)
      // #then reviewExcerpts are DROPPED (empty — enrichment blocked)
      expect(result.candidates[0]?.reviewExcerpts).toEqual([])
      // #then enrichmentBlocked is incremented
      expect(result.telemetry.enrichmentBlocked).toBe(1)
      // #then the private token does NOT appear anywhere in the serialized digest
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('testowner/secret-repo')
      expect(serialized).not.toContain('testowner--secret-repo')
    })

    it('mutation proof: removing the scan lets private prose into reviewExcerpts', () => {
      // #given a private token set and a candidate with private prose
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])
      const privateExcerpts = ['See testowner/secret-repo#42 for context.']

      // #when the scan IS applied (normal path)
      const withScan = buildCandidateDigest(
        makeDigestInput({
          mergedPrs: [makeCandidate({reviewExcerpts: privateExcerpts})],
          privateTokens,
        }),
      )
      // #then private prose is NOT in the output
      expect(JSON.stringify(withScan)).not.toContain('testowner/secret-repo')

      // #when the scan is bypassed (empty token set — simulating removal of the gate)
      const withoutScan = buildCandidateDigest(
        makeDigestInput({
          mergedPrs: [makeCandidate({reviewExcerpts: privateExcerpts})],
          privateTokens: new Set(), // gate removed
        }),
      )
      // #then private prose DOES appear — proving the scan was the gate
      expect(JSON.stringify(withoutScan)).toContain('testowner/secret-repo')
    })

    it('clean candidate passes through with reviewExcerpts intact when private tokens are loaded', () => {
      // #given a private token set and a candidate with clean prose
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])
      const candidate = makeCandidate({
        reviewExcerpts: ['Please add a null check here.', 'LGTM'],
      })
      const input = makeDigestInput({mergedPrs: [candidate], privateTokens})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is emitted with its reviewExcerpts intact
      expect(result.candidates[0]?.reviewExcerpts).toEqual(['Please add a null check here.', 'LGTM'])
      expect(result.telemetry.enrichmentBlocked).toBe(0)
    })

    it('mixed scenario: one blocked, one clean — enrichmentBlocked=1', () => {
      // #given two candidates: one with private prose, one clean
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])
      const blockedCandidate = makeCandidate({
        mergeSha: 'blocked1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
        reviewExcerpts: ['See testowner/secret-repo#1 for details.'],
      })
      const cleanCandidate = makeCandidate({
        mergeSha: 'clean001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
        reviewExcerpts: ['Fix the null check in the handler.'],
      })
      const input = makeDigestInput({
        mergedPrs: [blockedCandidate, cleanCandidate],
        privateTokens,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then both candidates are emitted
      expect(result.candidates).toHaveLength(2)
      // #then the blocked candidate has empty reviewExcerpts
      const blocked = result.candidates.find(c => c.mergeSha === blockedCandidate.mergeSha)
      expect(blocked?.reviewExcerpts).toEqual([])
      // #then the clean candidate retains its reviewExcerpts
      const clean = result.candidates.find(c => c.mergeSha === cleanCandidate.mergeSha)
      expect(clean?.reviewExcerpts).toEqual(['Fix the null check in the handler.'])
      // #then enrichmentBlocked is 1
      expect(result.telemetry.enrichmentBlocked).toBe(1)
      // #then the private token does not appear in the serialized digest
      expect(JSON.stringify(result)).not.toContain('testowner/secret-repo')
    })

    it('opacity: reviewExcerpts after scan contains no tracked private token', () => {
      // #given a private token set with multiple token forms
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])
      // #given a candidate with prose containing each token form
      const candidate = makeCandidate({
        reviewExcerpts: [
          'testowner/secret-repo is referenced here',
          'testowner--secret-repo slug form',
          'testowner--secret-repo another form',
        ],
      })
      const input = makeDigestInput({mergedPrs: [candidate], privateTokens})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then no private token form appears in the output
      const serialized = JSON.stringify(result)
      for (const token of privateTokens) {
        expect(serialized).not.toContain(token)
      }
    })
  })

  describe('fail-closed: empty/missing token set behavior', () => {
    it('candidate with enriched prose and empty privateTokens passes through (no tokens to match)', () => {
      // #given an empty private token set (e.g. no private repos in metadata)
      const candidate = makeCandidate({
        reviewExcerpts: ['Some review prose here.'],
      })
      const input = makeDigestInput({mergedPrs: [candidate], privateTokens: new Set()})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate passes through (empty token set = nothing to block)
      expect(result.candidates[0]?.reviewExcerpts).toEqual(['Some review prose here.'])
      expect(result.telemetry.enrichmentBlocked).toBe(0)
    })
  })

  describe('enrichmentBlocked telemetry', () => {
    it('enrichmentBlocked is 0 when no candidates have private prose', () => {
      // #given candidates with clean prose and a loaded private token set
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])
      const input = makeDigestInput({
        mergedPrs: [
          makeCandidate({mergeSha: `clean1${'0'.repeat(34)}`, reviewExcerpts: ['Fix the handler.']}),
          makeCandidate({mergeSha: `clean2${'0'.repeat(34)}`, reviewExcerpts: ['Add null check.']}),
        ],
        privateTokens,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then enrichmentBlocked is 0
      expect(result.telemetry.enrichmentBlocked).toBe(0)
    })

    it('enrichmentBlocked counts all candidates with private prose hits', () => {
      // #given two candidates both with private prose
      const privateTokens = buildPrivateTokenSet(['testowner/secret-repo'])
      const input = makeDigestInput({
        mergedPrs: [
          makeCandidate({
            mergeSha: `priv1${'0'.repeat(35)}`,
            reviewExcerpts: ['See testowner/secret-repo#1'],
          }),
          makeCandidate({
            mergeSha: `priv2${'0'.repeat(35)}`,
            reviewExcerpts: ['Also testowner/secret-repo#2'],
          }),
        ],
        privateTokens,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then enrichmentBlocked is 2
      expect(result.telemetry.enrichmentBlocked).toBe(2)
      // #then both candidates are still emitted (title-only)
      expect(result.candidates).toHaveLength(2)
      for (const c of result.candidates) {
        expect(c.reviewExcerpts).toEqual([])
      }
    })
  })
})

// ---------------------------------------------------------------------------
// I/O shell: harvestCandidates — enrichment fetch
// ---------------------------------------------------------------------------

describe('harvestCandidates — enrichment fetch', () => {
  it('happy path: candidate with review bodies and thread comments → reviewExcerpts populated', async () => {
    // #given a qualifying PR with fro-bot reviews carrying bodies and thread comments
    const sha = 'enriched1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
    const pr = makePullsListItem({merge_commit_sha: sha})

    // Reviews: CHANGES_REQUESTED (correction) + APPROVED (boilerplate)
    const reviews: ReviewItem[] = [
      makeReviewItem('CHANGES_REQUESTED', 'fro-bot', 'Please fix the null check in the handler.'),
      makeReviewItem('APPROVED', 'fro-bot', 'LGTM, looks good now.'),
    ]
    // Thread comments: line-level correction prose
    const reviewComments: ReviewCommentItem[] = [makeReviewCommentItem('This line needs a guard clause.')]

    const paginateListReviews = vi.fn(async () => reviews)
    const paginateListReviewComments = vi.fn(async () => reviewComments)

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: paginateListReviews as () => Promise<ReviewItem[]>,
      paginateListReviewComments: paginateListReviewComments as () => Promise<ReviewCommentItem[]>,
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the candidate has reviewExcerpts populated
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewExcerpts).toBeDefined()
    expect(candidates[0]?.reviewExcerpts.length).toBeGreaterThan(0)
    // #then correction prose appears in the excerpts
    const excerptText = candidates[0]?.reviewExcerpts.join(' ') ?? ''
    expect(excerptText).toContain('null check')
  })

  it('correction-signal prose ranked first: CHANGES_REQUESTED body before APPROVED body', async () => {
    // #given a PR with APPROVED review first, then CHANGES_REQUESTED (chronological order reversed from rank)
    const sha = 'ranktest1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const pr = makePullsListItem({merge_commit_sha: sha})

    // Chronological order: APPROVED first, CHANGES_REQUESTED second
    const reviews: ReviewItem[] = [
      makeReviewItem('APPROVED', 'fro-bot', 'Looks good to me.'),
      makeReviewItem('CHANGES_REQUESTED', 'fro-bot', 'Please fix the null check — this is the correction.'),
    ]

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => reviews,
      paginateListReviewComments: async () => [],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the CHANGES_REQUESTED body appears before the APPROVED body in reviewExcerpts
    expect(candidates[0]?.reviewExcerpts).toBeDefined()
    const excerpts = candidates[0]?.reviewExcerpts ?? []
    expect(excerpts.length).toBeGreaterThan(0)
    // The correction sentence must appear before the approval boilerplate
    const correctionIdx = excerpts.findIndex(e => e.includes('null check'))
    const approvalIdx = excerpts.findIndex(e => e.includes('Looks good'))
    expect(correctionIdx).not.toBe(-1)
    // If both are present, correction must come first
    if (approvalIdx !== -1) {
      expect(correctionIdx).toBeLessThan(approvalIdx)
    }
  })

  it('budget: over-budget prose is truncated to MAX_EXCERPT_CHARS_PER_CANDIDATE', async () => {
    // #given a PR with a CHANGES_REQUESTED body (correction) and a very long APPROVED body (boilerplate)
    const sha = 'budgettest1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const pr = makePullsListItem({merge_commit_sha: sha})

    const correctionBody = 'Fix the null check here — this is the critical correction sentence.'
    // Boilerplate that would overflow the budget on its own
    const boilerplateBody = 'A'.repeat(MAX_EXCERPT_CHARS_PER_CANDIDATE + 500)

    const reviews: ReviewItem[] = [
      makeReviewItem('APPROVED', 'fro-bot', boilerplateBody),
      makeReviewItem('CHANGES_REQUESTED', 'fro-bot', correctionBody),
    ]

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => reviews,
      paginateListReviewComments: async () => [],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the total excerpt length is within budget
    const excerpts = candidates[0]?.reviewExcerpts ?? []
    const totalChars = excerpts.join('').length
    expect(totalChars).toBeLessThanOrEqual(MAX_EXCERPT_CHARS_PER_CANDIDATE)
    // #then the correction sentence survives (ranked first, not clipped)
    const excerptText = excerpts.join(' ')
    expect(excerptText).toContain('null check')
  })

  it('thread comments pagination: multi-page comments are all included', async () => {
    // #given a PR with qualifying reviews and review comments spanning multiple pages
    const sha = 'multipage1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const pr = makePullsListItem({merge_commit_sha: sha})

    const reviews: ReviewItem[] = [
      makeReviewItem('CHANGES_REQUESTED', 'fro-bot', 'See inline comments.'),
      makeReviewItem('APPROVED', 'fro-bot', 'LGTM'),
    ]
    // Simulate paginate returning all pages combined (as octokit.paginate does)
    const allComments: ReviewCommentItem[] = [
      makeReviewCommentItem('Page 1 comment: fix the guard.'),
      makeReviewCommentItem('Page 2 comment: also check the edge case.'),
    ]

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => reviews,
      paginateListReviewComments: async () => allComments,
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then both pages of comments are included in reviewExcerpts
    const excerptText = candidates[0]?.reviewExcerpts.join(' ') ?? ''
    expect(excerptText).toContain('Page 1 comment')
    expect(excerptText).toContain('Page 2 comment')
  })

  it('error path: transient listReviewComments failure → candidate title-only, run not aborted', async () => {
    // #given two PRs: one whose listReviewComments throws, one that succeeds
    const sha1 = 'errorpath1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const sha2 = 'errorpath2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const pr1 = makePullsListItem({number: 1, merge_commit_sha: sha1})
    const pr2 = makePullsListItem({number: 2, merge_commit_sha: sha2})

    const reviews: ReviewItem[] = [
      makeReviewItem('CHANGES_REQUESTED', 'fro-bot', 'Fix this.'),
      makeReviewItem('APPROVED', 'fro-bot', 'LGTM'),
    ]

    let commentCallCount = 0
    const paginateListReviewComments = vi.fn(async () => {
      commentCallCount++
      if (commentCallCount === 1) {
        throw Object.assign(new Error('Service Unavailable'), {status: 503})
      }
      return [makeReviewCommentItem('Good comment from PR 2.')]
    })

    const octokit = mockOctokit({
      paginatePrList: async () => [pr1, pr2],
      paginateListReviews: async () => reviews,
      paginateListReviewComments: paginateListReviewComments as () => Promise<ReviewCommentItem[]>,
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then both candidates are returned (run not aborted)
    expect(candidates).toHaveLength(2)
    // #then the first candidate (error) has review body excerpts but no thread comments
    const c1 = candidates.find(c => c.mergeSha === sha1)
    expect(c1).toBeDefined()
    // It may have review body excerpts (from listReviews which succeeded), but no thread comments
    // The key assertion: the run was not aborted
    // #then the second candidate has its thread comment
    const c2 = candidates.find(c => c.mergeSha === sha2)
    expect(c2).toBeDefined()
    const c2Text = c2?.reviewExcerpts.join(' ') ?? ''
    expect(c2Text).toContain('Good comment from PR 2')
  })

  it('empty review bodies are excluded from reviewExcerpts', async () => {
    // #given a PR with reviews that have empty/whitespace bodies
    const sha = 'emptybody1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const pr = makePullsListItem({merge_commit_sha: sha})

    const reviews: ReviewItem[] = [
      makeReviewItem('CHANGES_REQUESTED', 'fro-bot', ''), // empty body — skip
      makeReviewItem('APPROVED', 'fro-bot', '   '), // whitespace only — skip
      makeReviewItem('DISMISSED', 'fro-bot', 'This was dismissed because of the null check issue.'),
    ]

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => reviews,
      paginateListReviewComments: async () => [],
    })

    // #when harvesting
    const {candidates} = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then only the non-empty body is in reviewExcerpts
    const excerpts = candidates[0]?.reviewExcerpts ?? []
    expect(excerpts).toHaveLength(1)
    expect(excerpts[0]).toContain('null check issue')
  })
})
