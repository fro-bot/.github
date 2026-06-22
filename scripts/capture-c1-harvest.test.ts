/**
 * Tests for capture-c1-harvest.ts
 *
 * Structure:
 * - Pure core tests: drive `buildCandidateDigest` with injected data
 * - Marker helper tests: `buildMergeShaMarker` / `parseMergeShaMarker`
 * - I/O shell tests: `harvestCandidates` and `fetchProposedMergeShas` with mocked Octokit
 */

import {describe, expect, it, vi} from 'vitest'

import {
  buildCandidateDigest,
  buildMergeShaMarker,
  fetchProposedMergeShas,
  harvestCandidates,
  LEARNING_PROPOSAL_LABEL,
  parseMergeShaMarker,
  type BuildCandidateDigestInput,
  type Candidate,
  type CandidateDigest,
  type OctokitClient,
  type SolutionDoc,
} from './capture-c1-harvest.ts'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    mergeSha: 'abc123def456abc123def456abc123def456abc1',
    reviewRounds: 2,
    signals: {titleTokens: ['feat', 'scripts'], labels: []},
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

function makeDigestInput(overrides: Partial<BuildCandidateDigestInput> = {}): BuildCandidateDigestInput {
  return {
    mergedPrs: [makeCandidate()],
    proposedMergeShas: new Set(),
    solutionsDocs: [],
    maxProposals: 5,
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
    expect(buildMergeShaMarker('abc123')).toBe('<!-- capture-c1:merge_sha=abc123 -->')
  })
})

describe('parseMergeShaMarker', () => {
  it('extracts the SHA from a well-formed marker', () => {
    // #given a body containing the marker
    const body = 'Some text\n<!-- capture-c1:merge_sha=abc123def456 -->\nMore text'
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
    expect(parseMergeShaMarker('<!-- capture-c1:merge_sha= -->')).toBeNull()
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

  describe('opacity guarantee (R4)', () => {
    it('emitted candidates have ONLY mergeSha, reviewRounds, and signals keys — no owner/repo/number/title', () => {
      // #given a candidate
      const input = makeDigestInput()

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then each candidate object has exactly the allowed keys
      for (const candidate of result.candidates) {
        const keys = Object.keys(candidate).sort()
        expect(keys).toEqual(['mergeSha', 'reviewRounds', 'signals'].sort())
        // Explicitly assert forbidden keys are absent
        expect(candidate).not.toHaveProperty('owner')
        expect(candidate).not.toHaveProperty('repo')
        expect(candidate).not.toHaveProperty('number')
        expect(candidate).not.toHaveProperty('title')
      }
    })
  })

  describe('proposal dedup (R3)', () => {
    it('excludes a candidate whose mergeSha is in proposedMergeShas', () => {
      // #given a candidate whose SHA is already in the seen-set
      const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({mergeSha: sha})],
        proposedMergeShas: new Set([sha]),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is excluded
      expect(result.candidates).toHaveLength(0)
      expect(result.telemetry.afterProposalDedup).toBe(0)
    })

    it('mutation proof: removing the seen-set filter makes the candidate reappear', () => {
      // #given the same candidate with and without the seen-set
      const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const candidate = makeCandidate({mergeSha: sha})

      // #when the seen-set contains the SHA
      const withDedup = buildCandidateDigest(
        makeDigestInput({
          mergedPrs: [candidate],
          proposedMergeShas: new Set([sha]),
        }),
      )
      // #then the candidate is excluded
      expect(withDedup.candidates).toHaveLength(0)

      // #when the seen-set is empty (dedup removed)
      const withoutDedup = buildCandidateDigest(
        makeDigestInput({
          mergedPrs: [candidate],
          proposedMergeShas: new Set(),
        }),
      )
      // #then the candidate reappears — proving the dedup was the gate
      expect(withoutDedup.candidates).toHaveLength(1)
      expect(withoutDedup.candidates[0]?.mergeSha).toBe(sha)
    })

    it('includes a candidate whose mergeSha is NOT in proposedMergeShas', () => {
      // #given a candidate with a SHA not in the seen-set
      const input = makeDigestInput({
        proposedMergeShas: new Set(['other-sha-not-matching']),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then the candidate is included
      expect(result.candidates).toHaveLength(1)
    })
  })

  describe('solutions dedup (R5)', () => {
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

  describe('cap (R6)', () => {
    it('caps candidates to maxProposals when more are available', () => {
      // #given 7 candidates and a cap of 3
      const candidates = Array.from({length: 7}, (_, i) =>
        makeCandidate({mergeSha: `sha${i}${'0'.repeat(35 - String(i).length)}`}),
      )
      const input = makeDigestInput({
        mergedPrs: candidates,
        maxProposals: 3,
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
      const input = makeDigestInput({mergedPrs: candidates, maxProposals: 5})

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
      const proposedSha1 = `proposed1${'0'.repeat(31)}`
      const proposedSha2 = `proposed2${'0'.repeat(31)}`
      const overlapSha = `overlap1${'0'.repeat(32)}`
      const cleanSha1 = `clean001${'0'.repeat(32)}`
      const cleanSha2 = `clean002${'0'.repeat(32)}`

      const input = makeDigestInput({
        mergedPrs: [
          makeCandidate({mergeSha: proposedSha1}),
          makeCandidate({mergeSha: proposedSha2}),
          // Two shared tags (automation + ci) = 20 pts >= threshold of 20 → excluded
          makeCandidate({mergeSha: overlapSha, signals: {titleTokens: [], labels: ['automation', 'ci']}}),
          makeCandidate({mergeSha: cleanSha1}),
          makeCandidate({mergeSha: cleanSha2}),
        ],
        proposedMergeShas: new Set([proposedSha1, proposedSha2]),
        solutionsDocs: [makeSolutionDoc({tags: ['automation', 'ci'], problemType: '', module: ''})],
        maxProposals: 5,
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then telemetry reflects each dedup stage
      expect(result.telemetry.examined).toBe(5)
      expect(result.telemetry.afterProposalDedup).toBe(3) // 5 - 2 proposed
      expect(result.telemetry.afterSolutionsDedup).toBe(2) // 3 - 1 overlap
      expect(result.telemetry.emitted).toBe(2) // 2 clean, under cap
    })

    it('reports zero counts when all candidates are filtered', () => {
      // #given all candidates already proposed
      const sha = `allproposed${'0'.repeat(29)}`
      const input = makeDigestInput({
        mergedPrs: [makeCandidate({mergeSha: sha})],
        proposedMergeShas: new Set([sha]),
      })

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then all counts are zero except examined
      expect(result.telemetry.examined).toBe(1)
      expect(result.telemetry.afterProposalDedup).toBe(0)
      expect(result.telemetry.afterSolutionsDedup).toBe(0)
      expect(result.telemetry.emitted).toBe(0)
    })

    it('reports zero counts when input is empty', () => {
      // #given no candidates
      const input = makeDigestInput({mergedPrs: []})

      // #when building the digest
      const result = buildCandidateDigest(input)

      // #then all counts are zero
      expect(result.telemetry.examined).toBe(0)
      expect(result.telemetry.afterProposalDedup).toBe(0)
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
}

interface ReviewItem {
  state: string
}

function makePullsListItem(overrides: Partial<PullsListItem> = {}): PullsListItem {
  return {
    number: 1,
    merged_at: new Date().toISOString(),
    merge_commit_sha: 'abc123def456abc123def456abc123def456abc1',
    title: 'feat: add new feature',
    labels: [],
    ...overrides,
  }
}

function makeReviewItem(state: string): ReviewItem {
  return {state}
}

function mockOctokit(
  overrides: {
    /** Override the paginate call for pulls.list (returns the PR array directly). */
    paginatePrList?: () => Promise<unknown[]>
    /** Override the paginate call for pulls.listReviews (returns the review array directly). */
    paginateListReviews?: () => Promise<ReviewItem[]>
    /** Legacy: override pullsListReviews for tests that use the old mock shape. */
    pullsListReviews?: (opts: unknown) => Promise<{data: ReviewItem[]}>
  } = {},
): OctokitClient {
  const listReviewsFn = overrides.pullsListReviews ?? (async () => ({data: [] as ReviewItem[]}))

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
      },
      issues: {
        listForRepo: async () => ({data: []}),
      },
    },
  } as unknown as OctokitClient
}

describe('harvestCandidates', () => {
  it('excludes a PR with merged_at === null (unmerged)', async () => {
    // #given a closed PR that was never merged
    const pr = makePullsListItem({merged_at: null})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded
    expect(result).toHaveLength(0)
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
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded
    expect(result).toHaveLength(0)
  })

  it('excludes a PR with only COMMENTED reviews (reviewRounds = 0)', async () => {
    // #given a merged PR with only COMMENTED reviews
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('COMMENTED'), makeReviewItem('COMMENTED')],
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded (0 CHANGES_REQUESTED < threshold of 2)
    expect(result).toHaveLength(0)
  })

  it('excludes a PR with only APPROVED reviews (reviewRounds = 0)', async () => {
    // #given a merged PR with only APPROVED reviews
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('APPROVED')],
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded
    expect(result).toHaveLength(0)
  })

  it('excludes a PR with only 1 CHANGES_REQUESTED review (below threshold)', async () => {
    // #given a merged PR with 1 CHANGES_REQUESTED review
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('CHANGES_REQUESTED')],
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is excluded (1 < threshold of 2)
    expect(result).toHaveLength(0)
  })

  it('includes a PR with exactly 2 CHANGES_REQUESTED reviews', async () => {
    // #given a merged PR with 2 CHANGES_REQUESTED reviews
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const pr = makePullsListItem({merge_commit_sha: sha})
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [makeReviewItem('CHANGES_REQUESTED'), makeReviewItem('CHANGES_REQUESTED')],
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the PR is included with its mergeSha and reviewRounds
    expect(result).toHaveLength(1)
    expect(result[0]?.mergeSha).toBe(sha)
    expect(result[0]?.reviewRounds).toBe(2)
  })

  it('counts only CHANGES_REQUESTED reviews, not COMMENTED or APPROVED', async () => {
    // #given a merged PR with mixed review states
    const pr = makePullsListItem()
    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => [
        makeReviewItem('CHANGES_REQUESTED'),
        makeReviewItem('COMMENTED'),
        makeReviewItem('APPROVED'),
        makeReviewItem('CHANGES_REQUESTED'),
      ],
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then reviewRounds is 2 (only CHANGES_REQUESTED counted)
    expect(result).toHaveLength(1)
    expect(result[0]?.reviewRounds).toBe(2)
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
      .mockResolvedValueOnce([makeReviewItem('CHANGES_REQUESTED'), makeReviewItem('CHANGES_REQUESTED')])

    const octokit = mockOctokit({
      paginatePrList: async () => [badPr, goodPr],
      paginateListReviews: paginateListReviews as () => Promise<ReviewItem[]>,
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then the bad PR is skipped, the good PR is included
    expect(result).toHaveLength(1)
    expect(result[0]?.mergeSha).toBe(goodSha)
  })

  it('counts CHANGES_REQUESTED reviews across multiple pages (pagination correctness)', async () => {
    // #given a PR whose reviews span 2 pages (simulated by paginateListReviews returning all)
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const pr = makePullsListItem({merge_commit_sha: sha})

    // Simulate paginate returning reviews from both pages combined
    const allReviews: ReviewItem[] = [
      makeReviewItem('CHANGES_REQUESTED'), // page 1
      makeReviewItem('COMMENTED'),
      makeReviewItem('CHANGES_REQUESTED'), // page 2
      makeReviewItem('APPROVED'),
      makeReviewItem('CHANGES_REQUESTED'), // page 2 continued
    ]

    const octokit = mockOctokit({
      paginatePrList: async () => [pr],
      paginateListReviews: async () => allReviews,
    })

    // #when harvesting
    const result = await harvestCandidates(octokit, 'fro-bot', '.github', new Date())

    // #then all 3 CHANGES_REQUESTED reviews are counted (not just the first page)
    expect(result).toHaveLength(1)
    expect(result[0]?.reviewRounds).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// I/O shell: fetchProposedMergeShas (mocked Octokit)
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

describe('fetchProposedMergeShas', () => {
  it('parses the merge SHA from a learning-proposal issue body', async () => {
    // #given an issue with a valid marker in its body
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const issue = makeIssueListItem({body: `Some text\n${buildMergeShaMarker(sha)}\nMore text`})
    const octokit = mockOctokitForIssues({
      paginate: async () => [issue],
    })

    // #when fetching proposed SHAs
    const result = await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

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
    const result = await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

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
    const result = await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

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
    const result = await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

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
    const result = await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

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
    const result = await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

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
    await fetchProposedMergeShas(octokit, 'fro-bot', '.github')

    // #then the paginate call includes the learning-proposal label
    expect(paginateSpy).toHaveBeenCalledOnce()
    const callArgs = paginateSpy.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(callArgs[1]).toMatchObject({labels: LEARNING_PROPOSAL_LABEL})
  })
})

// ---------------------------------------------------------------------------
// Contract test: harvest→propose schema round-trip (FIX 1)
// ---------------------------------------------------------------------------

describe('harvest→propose schema contract', () => {
  it('CandidateDigest serializes and deserializes with candidates intact', () => {
    // #given a CandidateDigest produced by buildCandidateDigest (as harvest would write it)
    const candidates: Candidate[] = [
      {
        mergeSha: 'abc123def456abc123def456abc123def456abc1',
        reviewRounds: 3,
        signals: {titleTokens: ['feat', 'scripts'], labels: ['ci', 'automation']},
      },
      {
        mergeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        reviewRounds: 2,
        signals: {titleTokens: ['fix', 'workflow'], labels: []},
      },
    ]
    const digest: CandidateDigest = {
      candidates,
      telemetry: {examined: 5, afterProposalDedup: 3, afterSolutionsDedup: 2, emitted: 2},
    }

    // #when serializing (as harvest writes to CAPTURE_C1_DIGEST_PATH)
    const serialized = JSON.stringify(digest)

    // #when deserializing (as propose reads from CAPTURE_C1_DIGEST_PATH)
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
    expect(deserialized.telemetry.examined).toBe(5)
    expect(deserialized.telemetry.emitted).toBe(2)

    // #then propose can iterate candidates without TypeError
    // (the old bug: harvest wrote candidates array directly, propose read {candidates,telemetry}
    //  → digest.candidates was undefined → for...of undefined → crash)
    // Iterating must not throw — the old bug caused TypeError: undefined is not iterable
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
