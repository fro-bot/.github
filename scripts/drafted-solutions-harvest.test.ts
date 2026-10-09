import type {OctokitClient} from './capture-learnings-harvest.ts'

import {describe, expect, it, vi} from 'vitest'

import {buildMergeShaMarker} from './capture-learnings-harvest.ts'
import {harvestDraftedProposals} from './drafted-solutions-harvest.ts'
import {hashProposalBody, parseCoverageBlock, renderPrBody, type CoverageRow} from './drafted-solutions-pr-body.ts'
import {DraftedSolutionsError, parseDigest} from './drafted-solutions-shared.ts'

const OWNER = 'fro-bot'
const REPO = '.github'
const FULL_NAME = `${OWNER}/${REPO}`
const MERGE_SHA = 'b'.repeat(40)
const MAIN_SHA = '1'.repeat(40)
const BRANCH_SHA = '2'.repeat(40)

interface FakeIssue {
  number: number
  title: string
  body: string | null
  created_at: string
  state: 'open' | 'closed'
  user: {login: string} | null
  labels: (string | {name: string})[]
  pull_request?: unknown
}

function makeIssue(number: number, overrides: Partial<FakeIssue> = {}): FakeIssue {
  return {
    number,
    title: `Proposal ${number}`,
    body: `Lesson ${number}\n\n${buildMergeShaMarker(MERGE_SHA)}`,
    created_at: `2026-10-${String(number % 28 || 1).padStart(2, '0')}T00:00:00Z`,
    state: 'open',
    user: {login: 'fro-bot[bot]'},
    labels: [{name: 'learning-proposal'}],
    ...overrides,
  }
}

function makeRow(issue: FakeIssue, overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    issue: issue.number,
    outcome: 'new-doc',
    targetDoc: `docs/solutions/best-practices/doc-${issue.number}.md`,
    sourceSha: 'a'.repeat(40),
    evidence: [{kind: 'pr', ref: '#1'}],
    droppedClaims: [],
    bodyHash: hashProposalBody(issue.body ?? ''),
    reason: '',
    ...overrides,
  }
}

interface FakePull {
  number: number
  body: string | null
  head: {ref: string; sha: string; repo: {full_name: string; fork: boolean} | null}
  base: {repo: {full_name: string}}
  user: {login: string} | null
}

function makePull(overrides: Partial<FakePull> = {}): FakePull {
  return {
    number: 900,
    body: renderPrBody([]),
    head: {ref: 'docs/drafted-solutions', sha: 'c'.repeat(40), repo: {full_name: FULL_NAME, fork: false}},
    base: {repo: {full_name: FULL_NAME}},
    user: {login: 'fro-bot[bot]'},
    ...overrides,
  }
}

function makeOctokit(params: {
  openIssues: FakeIssue[]
  allIssues?: FakeIssue[]
  pulls?: FakePull[]
  refs?: Record<string, string>
  /** Logins currently requested as reviewers on the PR. */
  requestedReviewers?: string[]
  /** Reviews on the PR: reviewer login and the commit the review was left on. */
  reviews?: {login: string; commitId: string}[]
}) {
  const byNumber = new Map([...(params.allIssues ?? []), ...params.openIssues].map(issue => [issue.number, issue]))
  const listForRepo = vi.fn(async () => ({data: params.openIssues}))
  const get = vi.fn(async (args: {issue_number: number}) => {
    const issue = byNumber.get(args.issue_number)
    if (issue === undefined) throw Object.assign(new Error('Not Found'), {status: 404})
    return {data: issue}
  })
  const list = vi.fn(async () => ({data: params.pulls ?? []}))
  const refs: Record<string, string> = {
    'heads/main': MAIN_SHA,
    'heads/docs/drafted-solutions': BRANCH_SHA,
    ...params.refs,
  }
  const getRef = vi.fn(async (args: {ref: string}) => {
    const sha = refs[args.ref]
    if (sha === undefined) throw Object.assign(new Error('Not Found'), {status: 404})
    return {data: {object: {sha}}}
  })
  const listRequestedReviewers = vi.fn(async () => ({
    data: {users: (params.requestedReviewers ?? []).map(login => ({login})), teams: []},
  }))
  const listReviews = vi.fn(async () => ({
    data: (params.reviews ?? []).map(review => ({
      user: {login: review.login},
      commit_id: review.commitId,
      state: 'CHANGES_REQUESTED',
    })),
  }))
  const octokit = {
    paginate: vi.fn(async (fn: (p: unknown) => Promise<{data: unknown[]}>, p: unknown) => (await fn(p)).data),
    rest: {issues: {listForRepo, get}, pulls: {list, listRequestedReviewers, listReviews}, git: {getRef}},
  } as unknown as OctokitClient
  return {octokit, listForRepo, get, list, getRef, listRequestedReviewers, listReviews}
}

async function harvest(octokit: OctokitClient) {
  return harvestDraftedProposals({octokit, owner: OWNER, repo: REPO})
}

describe('harvestDraftedProposals', () => {
  it('two proposals, no PR → both uncovered, PR state none', async () => {
    const issues = [makeIssue(11), makeIssue(12)]
    const {octokit} = makeOctokit({openIssues: issues})

    const {digest, hasWork} = await harvest(octokit)

    expect(hasWork).toBe(true)
    expect(digest.pr).toStrictEqual({state: 'none'})
    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([11, 12])
    expect(digest.proposals[0]).toStrictEqual({
      issue: 11,
      title: 'Proposal 11',
      body: issues[0]?.body,
      bodyHash: hashProposalBody(issues[0]?.body ?? ''),
      mergeSha: MERGE_SHA,
      createdAt: issues[0]?.created_at,
    })
  })

  it("pins the drafting base: main's head when no PR is open", async () => {
    const {octokit} = makeOctokit({openIssues: [makeIssue(11)]})

    const {digest} = await harvest(octokit)

    expect(digest.draftBaseSha).toBe(MAIN_SHA)
    expect(digest.mainSha).toBe(MAIN_SHA)
  })

  it("pins the drafting base: the live drafted-branch head (not the PR's recorded head) when a PR is open", async () => {
    const {octokit} = makeOctokit({openIssues: [makeIssue(11)], pulls: [makePull()]})

    const {digest} = await harvest(octokit)

    expect(digest.draftBaseSha).toBe(BRANCH_SHA)
    expect(digest.mainSha).toBe(MAIN_SHA)
    expect(digest.pr).toMatchObject({headSha: 'c'.repeat(40)})
  })

  it('the digest round-trips both SHAs through parseDigest', async () => {
    const {octokit} = makeOctokit({openIssues: [makeIssue(11)], pulls: [makePull()]})

    const {digest} = await harvest(octokit)

    expect(parseDigest(JSON.parse(JSON.stringify(digest)))).toStrictEqual(digest)
  })

  it('fails closed when main cannot be read', async () => {
    const {octokit, getRef} = makeOctokit({openIssues: [makeIssue(11)]})
    getRef.mockRejectedValue(Object.assign(new Error('Not Found'), {status: 404}))

    await expect(harvest(octokit)).rejects.toThrow(DraftedSolutionsError)
  })

  it('fails closed when a drafted PR is open but its branch ref is missing', async () => {
    const {octokit, getRef} = makeOctokit({openIssues: [makeIssue(11)], pulls: [makePull()]})
    getRef.mockImplementation(async (args: {ref: string}) => {
      if (args.ref === 'heads/main') return {data: {object: {sha: MAIN_SHA}}}
      throw Object.assign(new Error('Not Found'), {status: 404})
    })

    await expect(harvest(octokit)).rejects.toThrow(/does not exist/)
  })

  describe('review_needed (review-request reconciliation, independent of new work)', () => {
    const HEAD = 'c'.repeat(40)

    it('is false and makes no review lookups when no drafted PR is open', async () => {
      const {octokit, listRequestedReviewers, listReviews} = makeOctokit({openIssues: [makeIssue(11)]})

      const result = await harvest(octokit)

      expect(result.reviewNeeded).toBe(false)
      expect(listRequestedReviewers).not.toHaveBeenCalled()
      expect(listReviews).not.toHaveBeenCalled()
    })

    it('is true when a drafted PR is open, fro-bot is not requested, and has not reviewed the head', async () => {
      const {octokit} = makeOctokit({openIssues: [], pulls: [makePull()]})

      const result = await harvest(octokit)

      expect(result.reviewNeeded).toBe(true)
      expect(result.hasWork).toBe(false)
    })

    it('is true when fro-bot only reviewed an older commit', async () => {
      const {octokit} = makeOctokit({
        openIssues: [],
        pulls: [makePull()],
        reviews: [{login: 'fro-bot', commitId: 'd'.repeat(40)}],
      })

      expect((await harvest(octokit)).reviewNeeded).toBe(true)
    })

    it('is true when only someone else reviewed the head', async () => {
      const {octokit} = makeOctokit({
        openIssues: [],
        pulls: [makePull()],
        reviews: [{login: 'someone-else', commitId: HEAD}],
      })

      expect((await harvest(octokit)).reviewNeeded).toBe(true)
    })

    it('is false when fro-bot has reviewed the current head', async () => {
      const {octokit} = makeOctokit({
        openIssues: [],
        pulls: [makePull()],
        reviews: [{login: 'fro-bot', commitId: HEAD}],
      })

      expect((await harvest(octokit)).reviewNeeded).toBe(false)
    })

    it('treats the app login fro-bot[bot] as fro-bot for an existing review', async () => {
      const {octokit} = makeOctokit({
        openIssues: [],
        pulls: [makePull()],
        reviews: [{login: 'fro-bot[bot]', commitId: HEAD}],
      })

      expect((await harvest(octokit)).reviewNeeded).toBe(false)
    })

    it('is false when fro-bot is already a requested reviewer', async () => {
      const {octokit} = makeOctokit({openIssues: [], pulls: [makePull()], requestedReviewers: ['fro-bot']})

      expect((await harvest(octokit)).reviewNeeded).toBe(false)
    })

    it('is independent of new work: true alongside uncovered proposals too', async () => {
      const {octokit} = makeOctokit({openIssues: [makeIssue(11)], pulls: [makePull()]})

      const result = await harvest(octokit)

      expect(result.hasWork).toBe(true)
      expect(result.reviewNeeded).toBe(true)
    })

    it('ignores a PR that fails the drafted-PR predicate (it aborts instead)', async () => {
      const {octokit} = makeOctokit({
        openIssues: [],
        pulls: [makePull({user: {login: 'someone-else'}})],
      })

      await expect(harvest(octokit)).rejects.toThrow(DraftedSolutionsError)
    })
  })

  it('records a null merge SHA when the capture marker is absent', async () => {
    const {octokit} = makeOctokit({openIssues: [makeIssue(11, {body: 'no marker here'})]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals[0]?.mergeSha).toBeNull()
  })

  it('treats a null issue body as empty', async () => {
    const {octokit} = makeOctokit({openIssues: [makeIssue(11, {body: null})]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals[0]?.body).toBe('')
    expect(digest.proposals[0]?.bodyHash).toBe(hashProposalBody(''))
  })

  it('PR covers one proposal with a matching hash → only the other is uncovered', async () => {
    const covered = makeIssue(11)
    const other = makeIssue(12)
    const pull = makePull({body: renderPrBody([makeRow(covered)])})
    const {octokit} = makeOctokit({openIssues: [covered, other], pulls: [pull]})

    const {digest, hasWork} = await harvest(octokit)

    expect(hasWork).toBe(true)
    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([12])
    expect(digest.pr).toMatchObject({state: 'open', number: 900, headSha: 'c'.repeat(40)})
    expect(digest.pr.state === 'open' && digest.pr.rows.map(row => row.issue)).toStrictEqual([11])
  })

  it('a covered proposal whose body was edited (hash changed) is uncovered again', async () => {
    const original = makeIssue(11)
    const pull = makePull({body: renderPrBody([makeRow(original)])})
    const edited = makeIssue(11, {body: 'Corrected lesson'})
    const {octokit} = makeOctokit({openIssues: [edited], pulls: [pull]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([11])
  })

  it('all covered → no work and an empty proposal list', async () => {
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([makeRow(issue)])})
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [pull]})

    const {digest, hasWork} = await harvest(octokit)

    expect(hasWork).toBe(false)
    expect(digest.proposals).toStrictEqual([])
  })

  it('no open proposals → no work', async () => {
    const {octokit} = makeOctokit({openIssues: []})

    const {digest, hasWork} = await harvest(octokit)

    expect(hasWork).toBe(false)
    expect(digest).toStrictEqual({
      version: 1,
      draftBaseSha: MAIN_SHA,
      mainSha: MAIN_SHA,
      proposals: [],
      pr: {state: 'none'},
    })
  })

  it('seven uncovered proposals → the five oldest, in order', async () => {
    const issues = [7, 6, 5, 4, 3, 2, 1].map(n => makeIssue(100 + n, {created_at: `2026-09-0${n}T00:00:00Z`}))
    const {octokit} = makeOctokit({openIssues: issues})

    const {digest, hasWork} = await harvest(octokit)

    expect(hasWork).toBe(true)
    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([101, 102, 103, 104, 105])
  })

  it('counts coverage before applying the cap', async () => {
    const issues = [1, 2, 3, 4, 5, 6, 7].map(n => makeIssue(100 + n, {created_at: `2026-09-0${n}T00:00:00Z`}))
    const pull = makePull({body: renderPrBody([makeRow(issues[0] as FakeIssue), makeRow(issues[1] as FakeIssue)])})
    const {octokit} = makeOctokit({openIssues: issues, pulls: [pull]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([103, 104, 105, 106, 107])
  })

  it('requests only open learning-proposal issues and never reads comments', async () => {
    const {octokit, listForRepo} = makeOctokit({openIssues: []})
    const rest = (octokit as unknown as {rest: Record<string, Record<string, unknown>>}).rest

    await harvest(octokit)

    expect(listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({owner: OWNER, repo: REPO, state: 'open', labels: 'learning-proposal'}),
    )
    expect(rest.issues).not.toHaveProperty('listComments')
  })

  it('ignores a labeled issue authored by someone else', async () => {
    const mine = makeIssue(11)
    const foreign = makeIssue(12, {user: {login: 'someone-else'}})
    const {octokit} = makeOctokit({openIssues: [mine, foreign]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([11])
  })

  it('ignores pull requests that appear in the issues listing', async () => {
    const issue = makeIssue(11)
    const pullAsIssue = makeIssue(12, {pull_request: {url: 'x'}})
    const {octokit} = makeOctokit({openIssues: [issue, pullAsIssue]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([11])
  })

  it('produces a digest that passes parseDigest', async () => {
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([makeRow(makeIssue(10))])})
    const {octokit} = makeOctokit({openIssues: [issue], allIssues: [makeIssue(10, {state: 'closed'})], pulls: [pull]})

    const {digest} = await harvest(octokit)

    expect(parseDigest(JSON.parse(JSON.stringify(digest)))).toStrictEqual(digest)
  })
})

describe('harvestDraftedProposals fails closed', () => {
  const issue = makeIssue(11)

  it.each([
    ['another author', makePull({user: {login: 'renovate[bot]'}})],
    ['the fro-bot user', makePull({user: {login: 'fro-bot'}})],
    [
      'a fork head repo',
      makePull({
        head: {ref: 'docs/drafted-solutions', sha: 'c'.repeat(40), repo: {full_name: 'evil/.github', fork: true}},
      }),
    ],
    [
      'a fork flag on the same-named repo',
      makePull({head: {ref: 'docs/drafted-solutions', sha: 'c'.repeat(40), repo: {full_name: FULL_NAME, fork: true}}}),
    ],
    ['a deleted head repo', makePull({head: {ref: 'docs/drafted-solutions', sha: 'c'.repeat(40), repo: null}})],
    ['a different base repo', makePull({base: {repo: {full_name: 'other/.github'}}})],
    ['no author', makePull({user: null})],
  ])('aborts when the PR on the drafted branch has %s', async (_label: string, pull: FakePull) => {
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [pull]})

    await expect(harvest(octokit)).rejects.toThrow(DraftedSolutionsError)
  })

  it('aborts when two PRs use the drafted branch', async () => {
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [makePull(), makePull({number: 901})]})

    await expect(harvest(octokit)).rejects.toThrow(/2 open PRs/)
  })

  it('ignores open PRs on other branches, whoever authored them', async () => {
    const other = makePull({
      number: 5,
      user: {login: 'renovate[bot]'},
      head: {ref: 'renovate/x', sha: 'd'.repeat(40), repo: {full_name: FULL_NAME, fork: false}},
    })
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [other]})

    const {digest} = await harvest(octokit)

    expect(digest.pr).toStrictEqual({state: 'none'})
  })

  it('aborts on a PR body with no coverage block', async () => {
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [makePull({body: 'hand-written'})]})

    await expect(harvest(octokit)).rejects.toThrow(/missing/)
  })

  it('aborts on a malformed block', async () => {
    const body = renderPrBody([]).replace('-->', '')
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [makePull({body})]})

    await expect(harvest(octokit)).rejects.toThrow(/truncated|malformed/)
  })

  it('aborts when a block row names an issue that is not a learning proposal', async () => {
    const stranger = makeIssue(77, {labels: [{name: 'bug'}]})
    const pull = makePull({body: renderPrBody([makeRow(stranger)])})
    const {octokit} = makeOctokit({openIssues: [issue], allIssues: [stranger], pulls: [pull]})

    await expect(harvest(octokit)).rejects.toThrow(/#77 does not name a learning-proposal issue/)
  })

  it('aborts when a block row names a proposal issue authored by someone else', async () => {
    const forged = makeIssue(78, {user: {login: 'mallory'}})
    const pull = makePull({body: renderPrBody([makeRow(forged)])})
    const {octokit} = makeOctokit({openIssues: [issue], allIssues: [forged], pulls: [pull]})

    await expect(harvest(octokit)).rejects.toThrow(/#78/)
  })

  it('aborts when a block row names a pull request', async () => {
    const asPull = makeIssue(79, {pull_request: {url: 'x'}})
    const pull = makePull({body: renderPrBody([makeRow(asPull)])})
    const {octokit} = makeOctokit({openIssues: [issue], allIssues: [asPull], pulls: [pull]})

    await expect(harvest(octokit)).rejects.toThrow(/#79/)
  })

  it('aborts when a block row names an issue that does not exist', async () => {
    const ghost = makeIssue(80)
    const pull = makePull({body: renderPrBody([makeRow(ghost)])})
    const {octokit} = makeOctokit({openIssues: [issue], pulls: [pull]})

    await expect(harvest(octokit)).rejects.toThrow(/#80 could not be read/)
  })

  it('accepts a closed proposal issue in a block row', async () => {
    const closed = makeIssue(81, {state: 'closed'})
    const pull = makePull({body: renderPrBody([makeRow(closed)])})
    const {octokit} = makeOctokit({openIssues: [issue], allIssues: [closed], pulls: [pull]})

    const {digest} = await harvest(octokit)

    expect(digest.proposals.map(proposal => proposal.issue)).toStrictEqual([11])
  })

  it('parses the drafted PR body as an existing PR (round trip with the pr-body module)', () => {
    expect(parseCoverageBlock(makePull().body, 'existing-pr')).toStrictEqual({ok: true, rows: []})
  })
})
