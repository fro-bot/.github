/**
 * Tests for capture-learnings-open.ts
 *
 * Structure:
 * - Pure function tests: `learningBodyHasPrivateLeak`, `planLearnings`
 * - Disk loader tests: `loadPrivateTokensFromDisk` (injectable readFile)
 * - I/O shell tests: `openLearningIssues`, `ensureLabelsExist` (mocked Octokit)
 *
 * Privacy mutation-proof: each privacy test includes a "without the gate" assertion
 * that proves removing the check would let the learning through.
 */

import {describe, expect, it, vi} from 'vitest'

import {
  buildMergeShaMarker,
  LEARNING_PROPOSAL_LABEL,
  type Candidate,
  type OctokitClient,
} from './capture-learnings-harvest.ts'
import {
  ensureLabelsExist,
  learningBodyHasPrivateLeak,
  loadPrivateTokensFromDisk,
  openLearningIssues,
  planLearnings,
  type LabelDescriptor,
  type LearningToOpen,
  type PlanLearningsInput,
} from './capture-learnings-open.ts'
import {buildPrivateTokenSet} from './wiki-slug.ts'

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

function makePlanInput(overrides: Partial<PlanLearningsInput> = {}): PlanLearningsInput {
  return {
    candidates: [makeCandidate()],
    learningBodies: new Map([['abc123def456abc123def456abc123def456abc1', 'A clean learning body.']]),
    privateTokens: new Set(),
    alreadyCreatedShas: new Set(),
    ...overrides,
  }
}

/** Build a private token set from a synthetic owner/name for test isolation. */
function makePrivateTokens(nameWithOwner: string): Set<string> {
  return buildPrivateTokenSet([nameWithOwner])
}

function makeToCreate(overrides: Partial<LearningToOpen> = {}): LearningToOpen {
  const sha = 'abc123def456abc123def456abc123def456abc1'
  return {
    mergeSha: sha,
    body: `A clean learning.\n\n${buildMergeShaMarker(sha)}`,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// learningBodyHasPrivateLeak — pure function tests
// ---------------------------------------------------------------------------

describe('learningBodyHasPrivateLeak', () => {
  describe('detection', () => {
    it('detects the owner/name form (slash-separated)', () => {
      // #given a body containing the owner/name form of a private repo
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This PR touched testowner/secret-repo in the changes.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects the owner--name form (double-dash)', () => {
      // #given a body containing the double-dash form
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'See testowner--secret-repo for context.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects mixed-case occurrences (case-insensitive scan)', () => {
      // #given a body with the token in mixed case
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'The repo TESTOWNER/SECRET-REPO was involved.'

      // #when scanning
      // #then the leak is detected (body is lowercased before scan)
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })

    it('detects the slug form produced by computeRepoSlug', () => {
      // #given a body containing the wiki-slug form
      const tokens = makePrivateTokens('testowner/secret-repo')
      // The slug form is testowner--secret-repo (same as double-dash for simple names)
      const body = 'Wiki page at testowner--secret-repo.'

      // #when scanning
      // #then the leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(true)
    })
  })

  describe('clean body', () => {
    it('returns false for a body with no private tokens', () => {
      // #given a body with no private identifiers
      const tokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This is a clean learning about CI improvements.'

      // #when scanning
      // #then no leak is detected
      expect(learningBodyHasPrivateLeak(body, tokens)).toBe(false)
    })

    it('returns false when the private token set is empty', () => {
      // #given an empty token set (e.g. no private repos in metadata)
      const body = 'Any body content here.'

      // #when scanning with an empty token set
      // #then no leak is detected (vacuously safe)
      expect(learningBodyHasPrivateLeak(body, new Set())).toBe(false)
    })

    it('returns false for an empty body', () => {
      // #given an empty body
      const tokens = makePrivateTokens('testowner/secret-repo')

      // #when scanning
      // #then no leak is detected
      expect(learningBodyHasPrivateLeak('', tokens)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// planLearnings — pure core tests
// ---------------------------------------------------------------------------

describe('planLearnings', () => {
  describe('happy path', () => {
    it('includes a clean candidate with the merge-SHA marker appended to the body', () => {
      // #given a candidate with a clean body, not duplicate, no private leak
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const body = 'A clean learning body.'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map([[sha, body]]),
      })

      // #when planning
      const result = planLearnings(input)

      // #then the candidate is in toCreate with the marker appended
      expect(result.toCreate).toHaveLength(1)
      expect(result.toCreate[0]?.mergeSha).toBe(sha)
      expect(result.toCreate[0]?.body).toContain(body)
      expect(result.toCreate[0]?.body).toContain(buildMergeShaMarker(sha))
      expect(result.blockedOnPrivacy).toBe(0)
      expect(result.skippedDuplicate).toBe(0)
    })

    it('appends the marker AFTER the body content', () => {
      // #given a candidate with a body
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const body = 'Learning content here.'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map([[sha, body]]),
      })

      // #when planning
      const result = planLearnings(input)

      // #then the marker appears after the body
      const fullBody = result.toCreate[0]?.body ?? ''
      const bodyIndex = fullBody.indexOf(body)
      const markerIndex = fullBody.indexOf(buildMergeShaMarker(sha))
      expect(bodyIndex).toBeGreaterThanOrEqual(0)
      expect(markerIndex).toBeGreaterThan(bodyIndex)
    })
  })

  describe('privacy gate', () => {
    it('blocks a candidate whose body contains a private token', () => {
      // #given a body containing a private identifier
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const privateTokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This learning references testowner/secret-repo.'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map([[sha, body]]),
        privateTokens,
      })

      // #when planning
      const result = planLearnings(input)

      // #then the candidate is blocked, not in toCreate
      expect(result.toCreate).toHaveLength(0)
      expect(result.blockedOnPrivacy).toBe(1)
    })

    it('mutation proof: removing the privacy gate lets the blocked candidate through', () => {
      // #given the same body with a private token
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const privateTokens = makePrivateTokens('testowner/secret-repo')
      const body = 'This learning references testowner/secret-repo.'

      // #when planning WITH the privacy gate (non-empty token set)
      const withGate = planLearnings(
        makePlanInput({
          candidates: [makeCandidate({mergeSha: sha})],
          learningBodies: new Map([[sha, body]]),
          privateTokens,
        }),
      )
      // #then the candidate is blocked
      expect(withGate.toCreate).toHaveLength(0)
      expect(withGate.blockedOnPrivacy).toBe(1)

      // #when planning WITHOUT the privacy gate (empty token set — gate removed)
      const withoutGate = planLearnings(
        makePlanInput({
          candidates: [makeCandidate({mergeSha: sha})],
          learningBodies: new Map([[sha, body]]),
          privateTokens: new Set(), // gate removed
        }),
      )
      // #then the candidate appears in toCreate — proving the gate was the blocker
      expect(withoutGate.toCreate).toHaveLength(1)
      expect(withoutGate.blockedOnPrivacy).toBe(0)
    })

    it('blocks multiple candidates with private tokens, counts each', () => {
      // #given two candidates both with private tokens in their bodies
      const sha1 = `sha1${'0'.repeat(36)}`
      const sha2 = `sha2${'0'.repeat(36)}`
      const privateTokens = makePrivateTokens('testowner/secret-repo')
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha1}), makeCandidate({mergeSha: sha2})],
        learningBodies: new Map([
          [sha1, 'References testowner/secret-repo here.'],
          [sha2, 'Also mentions testowner/secret-repo.'],
        ]),
        privateTokens,
      })

      // #when planning
      const result = planLearnings(input)

      // #then both are blocked
      expect(result.toCreate).toHaveLength(0)
      expect(result.blockedOnPrivacy).toBe(2)
    })
  })

  describe('same-run dedup', () => {
    it('skips a candidate whose mergeSha is in alreadyCreatedShas', () => {
      // #given a candidate whose SHA is already in the created set
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map([[sha, 'A clean body.']]),
        alreadyCreatedShas: new Set([sha]),
      })

      // #when planning
      const result = planLearnings(input)

      // #then the candidate is skipped as a duplicate
      expect(result.toCreate).toHaveLength(0)
      expect(result.skippedDuplicate).toBe(1)
      expect(result.blockedOnPrivacy).toBe(0)
    })

    it('includes a candidate whose mergeSha is NOT in alreadyCreatedShas', () => {
      // #given a candidate with a SHA not in the created set
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map([[sha, 'A clean body.']]),
        alreadyCreatedShas: new Set(['other-sha-not-matching']),
      })

      // #when planning
      const result = planLearnings(input)

      // #then the candidate is included
      expect(result.toCreate).toHaveLength(1)
      expect(result.skippedDuplicate).toBe(0)
    })
  })

  describe('no body for a candidate', () => {
    it('skips a candidate with no entry in learningBodies without crashing', () => {
      // #given a candidate with no body in the map
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map(), // empty — no body for this candidate
      })

      // #when planning
      const result = planLearnings(input)

      // #then the candidate is silently skipped
      expect(result.toCreate).toHaveLength(0)
      expect(result.blockedOnPrivacy).toBe(0)
      expect(result.skippedDuplicate).toBe(0)
    })

    it('skips a candidate with an empty string body', () => {
      // #given a candidate with an empty body
      const sha = 'abc123def456abc123def456abc123def456abc1'
      const input = makePlanInput({
        candidates: [makeCandidate({mergeSha: sha})],
        learningBodies: new Map([[sha, '']]),
      })

      // #when planning
      const result = planLearnings(input)

      // #then the candidate is silently skipped
      expect(result.toCreate).toHaveLength(0)
    })
  })

  describe('mixed candidates', () => {
    it('correctly partitions clean, blocked, duplicate, and no-body candidates', () => {
      // #given four candidates: one clean, one blocked, one duplicate, one no-body
      const cleanSha = `clean0${'0'.repeat(34)}`
      const blockedSha = `block0${'0'.repeat(34)}`
      const dupSha = `dupsha${'0'.repeat(34)}`
      const noBodySha = `nobody${'0'.repeat(34)}`

      const privateTokens = makePrivateTokens('testowner/secret-repo')

      const input = makePlanInput({
        candidates: [
          makeCandidate({mergeSha: cleanSha}),
          makeCandidate({mergeSha: blockedSha}),
          makeCandidate({mergeSha: dupSha}),
          makeCandidate({mergeSha: noBodySha}),
        ],
        learningBodies: new Map([
          [cleanSha, 'A clean learning.'],
          [blockedSha, 'References testowner/secret-repo.'],
          [dupSha, 'Another clean learning.'],
          // noBodySha intentionally absent
        ]),
        privateTokens,
        alreadyCreatedShas: new Set([dupSha]),
      })

      // #when planning
      const result = planLearnings(input)

      // #then only the clean candidate is in toCreate
      expect(result.toCreate).toHaveLength(1)
      expect(result.toCreate[0]?.mergeSha).toBe(cleanSha)
      expect(result.blockedOnPrivacy).toBe(1)
      expect(result.skippedDuplicate).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// loadPrivateTokensFromDisk — fail-closed behavior (injectable readFile)
// ---------------------------------------------------------------------------

describe('loadPrivateTokensFromDisk', () => {
  it('throws when metadata/repos.yaml cannot be read (fail-closed)', async () => {
    // #given the file cannot be read
    const readFileFn = async () => {
      throw new Error('ENOENT: no such file or directory')
    }

    // #when loading private tokens
    // #then it throws — the caller must not post proposals
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-open: could not read metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
    )
  })

  it('throws when metadata/repos.yaml cannot be parsed (fail-closed)', async () => {
    // #given the file contains invalid YAML
    const readFileFn = async () => '{ invalid yaml: [unclosed'

    // #when loading private tokens
    // #then it throws — the caller must not post proposals
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-open: could not parse metadata/repos.yaml — privacy gate cannot operate; no learnings will be posted',
    )
  })

  it('throws when repos.yaml has unexpected shape (not a record)', async () => {
    // #given the file parses to a non-record (e.g. a list)
    const readFileFn = async () => '- item1\n- item2\n'

    // #when loading private tokens
    // #then it throws
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-open: metadata/repos.yaml has unexpected shape',
    )
  })

  it('throws when repos.yaml is missing the repos array', async () => {
    // #given the file has no repos key
    const readFileFn = async () => 'other_key: value\n'

    // #when loading private tokens
    // #then it throws
    await expect(loadPrivateTokensFromDisk(readFileFn)).rejects.toThrow(
      'capture-learnings-open: metadata/repos.yaml missing repos array',
    )
  })

  it('returns a token set built from private non-redacted repos', async () => {
    // #given a valid repos.yaml with one private repo and one public repo
    const yaml = `
repos:
  - owner: testowner
    name: secret-repo
    private: true
  - owner: testowner
    name: public-repo
    private: false
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then tokens include forms of the private repo but not the public one
    expect(tokens.has('testowner/secret-repo')).toBe(true)
    expect(tokens.has('testowner--secret-repo')).toBe(true)
    // Public repo should not be in the token set
    expect(tokens.has('testowner/public-repo')).toBe(false)
  })

  it('skips redacted entries', async () => {
    // #given a repos.yaml with a redacted private entry
    const yaml = `
repos:
  - owner: '[REDACTED]'
    name: '[REDACTED]'
    private: true
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then the token set is empty (redacted entries are skipped)
    expect(tokens.size).toBe(0)
  })

  it('returns an empty set when there are no private repos', async () => {
    // #given a repos.yaml with only public repos
    const yaml = `
repos:
  - owner: testowner
    name: public-repo
    private: false
`
    const readFileFn = async () => yaml

    // #when loading private tokens
    const tokens = await loadPrivateTokensFromDisk(readFileFn)

    // #then the token set is empty
    expect(tokens.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Mocked Octokit helpers
// ---------------------------------------------------------------------------

interface IssuesCreateCall {
  owner: string
  repo: string
  title: string
  body: string
  labels: string[]
}

function mockOctokit(
  overrides: {
    getLabelResult?: 'found' | 404 | 'error'
    createLabelResult?: 'created' | 422 | 'error'
    issuesCreateResult?: 'ok' | 'error'
    issuesCreateSpy?: ReturnType<typeof vi.fn>
  } = {},
): OctokitClient {
  const {
    getLabelResult = 'found',
    createLabelResult = 'created',
    issuesCreateResult = 'ok',
    issuesCreateSpy,
  } = overrides

  const getLabel = async () => {
    if (getLabelResult === 'found') return {data: {name: LEARNING_PROPOSAL_LABEL}}
    if (getLabelResult === 404) throw Object.assign(new Error('Not Found'), {status: 404})
    throw Object.assign(new Error('Server Error'), {status: 500})
  }

  const createLabel = async () => {
    if (createLabelResult === 'created') return {data: {name: LEARNING_PROPOSAL_LABEL}}
    if (createLabelResult === 422) throw Object.assign(new Error('Unprocessable'), {status: 422})
    throw Object.assign(new Error('Server Error'), {status: 500})
  }

  const defaultIssuesCreate = async () => {
    if (issuesCreateResult === 'ok') return {data: {number: 1}}
    throw Object.assign(new Error('Server Error'), {status: 500})
  }

  return {
    rest: {
      issues: {
        getLabel,
        createLabel,
        create: issuesCreateSpy ?? defaultIssuesCreate,
      },
    },
  } as unknown as OctokitClient
}

// ---------------------------------------------------------------------------
// ensureLabelsExist — I/O shell tests
// ---------------------------------------------------------------------------

describe('ensureLabelsExist', () => {
  const labels: LabelDescriptor[] = [{name: LEARNING_PROPOSAL_LABEL, color: '0e8a16', description: 'Test label'}]

  it('confirms a label that already exists (getLabel succeeds)', async () => {
    // #given the label already exists
    const octokit = mockOctokit({getLabelResult: 'found'})

    // #when ensuring labels exist
    const confirmed = await ensureLabelsExist(octokit, 'fro-bot', '.github', labels)

    // #then the label is confirmed
    expect(confirmed.has(LEARNING_PROPOSAL_LABEL)).toBe(true)
    expect(confirmed.size).toBe(1)
  })

  it('creates and confirms a label on 404 (label not found)', async () => {
    // #given the label does not exist (404) and createLabel succeeds
    const octokit = mockOctokit({getLabelResult: 404, createLabelResult: 'created'})

    // #when ensuring labels exist
    const confirmed = await ensureLabelsExist(octokit, 'fro-bot', '.github', labels)

    // #then the label is confirmed after creation
    expect(confirmed.has(LEARNING_PROPOSAL_LABEL)).toBe(true)
  })

  it('confirms a label on 404 + 422 (race — another writer created it first)', async () => {
    // #given the label does not exist (404) and createLabel returns 422 (race)
    const octokit = mockOctokit({getLabelResult: 404, createLabelResult: 422})

    // #when ensuring labels exist
    const confirmed = await ensureLabelsExist(octokit, 'fro-bot', '.github', labels)

    // #then the label is confirmed (422 means it now exists)
    expect(confirmed.has(LEARNING_PROPOSAL_LABEL)).toBe(true)
  })

  it('excludes a label when getLabel fails with a non-404 error', async () => {
    // #given getLabel fails with a 500 error
    const octokit = mockOctokit({getLabelResult: 'error'})

    // #when ensuring labels exist
    const confirmed = await ensureLabelsExist(octokit, 'fro-bot', '.github', labels)

    // #then the label is excluded from the confirmed set
    expect(confirmed.has(LEARNING_PROPOSAL_LABEL)).toBe(false)
    expect(confirmed.size).toBe(0)
  })

  it('excludes a label when createLabel fails with a non-422 error', async () => {
    // #given the label does not exist (404) and createLabel fails with 500
    const octokit = mockOctokit({getLabelResult: 404, createLabelResult: 'error'})

    // #when ensuring labels exist
    const confirmed = await ensureLabelsExist(octokit, 'fro-bot', '.github', labels)

    // #then the label is excluded
    expect(confirmed.has(LEARNING_PROPOSAL_LABEL)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// openLearningIssues — I/O shell tests
// ---------------------------------------------------------------------------

describe('openLearningIssues', () => {
  it('creates an issue with the learning-proposal label and the merge-SHA marker in the body', async () => {
    // #given a single learning to create
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const createSpy = vi.fn().mockResolvedValue({data: {number: 42}})
    const octokit = mockOctokit({getLabelResult: 'found', issuesCreateSpy: createSpy})
    const toCreate = [makeToCreate({mergeSha: sha})]

    // #when opening learning issues
    const counts = await openLearningIssues(octokit, 'fro-bot', '.github', toCreate)

    // #then the issue was created with the correct label and marker
    expect(counts.created).toBe(1)
    expect(counts.failed).toBe(0)
    expect(createSpy).toHaveBeenCalledOnce()
    const callArg = createSpy.mock.calls[0]?.[0] as IssuesCreateCall
    expect(callArg.labels).toContain(LEARNING_PROPOSAL_LABEL)
    expect(callArg.body).toContain(buildMergeShaMarker(sha))
  })

  it('creates an issue even when the label had to be created (404 → create)', async () => {
    // #given the label does not exist and must be created
    const createSpy = vi.fn().mockResolvedValue({data: {number: 1}})
    const octokit = mockOctokit({getLabelResult: 404, createLabelResult: 'created', issuesCreateSpy: createSpy})

    // #when opening learning issues
    const counts = await openLearningIssues(octokit, 'fro-bot', '.github', [makeToCreate()])

    // #then the issue was created
    expect(counts.created).toBe(1)
    const callArg = createSpy.mock.calls[0]?.[0] as IssuesCreateCall
    expect(callArg.labels).toContain(LEARNING_PROPOSAL_LABEL)
  })

  it('skips ALL learnings when the label cannot be confirmed (fail-closed on labeling)', async () => {
    // #given the label cannot be confirmed (getLabel 500 error)
    // An unlabeled learning is invisible to the seen-set query (filtered by label)
    // and would be re-proposed forever — worse than skipping.
    const createSpy = vi.fn().mockResolvedValue({data: {number: 1}})
    const octokit = mockOctokit({getLabelResult: 'error', issuesCreateSpy: createSpy})

    // #when opening learning issues
    const counts = await openLearningIssues(octokit, 'fro-bot', '.github', [makeToCreate()])

    // #then NO issue is created and skippedLabelUnavailable is incremented
    expect(counts.created).toBe(0)
    expect(counts.skippedLabelUnavailable).toBe(1)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('same-run Set guard: two toCreate items with the same mergeSha → only one created', async () => {
    // #given two items with the same mergeSha (simulates a same-run duplicate)
    const sha = 'abc123def456abc123def456abc123def456abc1'
    const createSpy = vi.fn().mockResolvedValue({data: {number: 1}})
    const octokit = mockOctokit({getLabelResult: 'found', issuesCreateSpy: createSpy})
    const toCreate = [makeToCreate({mergeSha: sha}), makeToCreate({mergeSha: sha})]

    // #when opening learning issues
    const counts = await openLearningIssues(octokit, 'fro-bot', '.github', toCreate)

    // #then only one issue was created (the second was suppressed by the in-memory Set)
    expect(counts.created).toBe(1)
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it('continues creating other learnings when one fails', async () => {
    // #given two learnings: the first create call fails, the second succeeds
    const sha1 = `sha1${'0'.repeat(36)}`
    const sha2 = `sha2${'0'.repeat(36)}`
    const createSpy = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Server Error'), {status: 500}))
      .mockResolvedValueOnce({data: {number: 2}})
    const octokit = mockOctokit({getLabelResult: 'found', issuesCreateSpy: createSpy})
    const toCreate = [
      makeToCreate({mergeSha: sha1, body: `Body 1\n\n${buildMergeShaMarker(sha1)}`}),
      makeToCreate({mergeSha: sha2, body: `Body 2\n\n${buildMergeShaMarker(sha2)}`}),
    ]

    // #when opening learning issues
    const counts = await openLearningIssues(octokit, 'fro-bot', '.github', toCreate)

    // #then the first failed but the second succeeded
    expect(counts.created).toBe(1)
    expect(counts.failed).toBe(1)
    expect(createSpy).toHaveBeenCalledTimes(2)
  })

  it('returns zero counts when toCreate is empty', async () => {
    // #given no learnings to create
    const octokit = mockOctokit()

    // #when opening learning issues with an empty list
    const counts = await openLearningIssues(octokit, 'fro-bot', '.github', [])

    // #then no API calls are made and counts are zero
    expect(counts.created).toBe(0)
    expect(counts.failed).toBe(0)
  })

  it('includes the title derived from the mergeSha (short SHA, no private info)', async () => {
    // #given a learning with a known mergeSha
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const createSpy = vi.fn().mockResolvedValue({data: {number: 1}})
    const octokit = mockOctokit({getLabelResult: 'found', issuesCreateSpy: createSpy})

    // #when opening learning issues
    await openLearningIssues(octokit, 'fro-bot', '.github', [
      makeToCreate({mergeSha: sha, body: `Body\n\n${buildMergeShaMarker(sha)}`}),
    ])

    // #then the title contains the short SHA (first 8 chars) and no private info
    const callArg = createSpy.mock.calls[0]?.[0] as IssuesCreateCall
    expect(callArg.title).toContain('deadbeef')
    expect(callArg.title).toContain('Learning proposal')
  })
})
