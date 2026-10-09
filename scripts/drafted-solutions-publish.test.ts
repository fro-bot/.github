import type {OctokitClient} from './capture-learnings-harvest.ts'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {buildMergeShaMarker} from './capture-learnings-harvest.ts'
import {hashProposalBody, parseCoverageBlock, renderPrBody, type CoverageRow} from './drafted-solutions-pr-body.ts'
import {
  DRAFTED_PR_TITLE,
  publishDraftedSolutions,
  type PublishParams,
  type PublishResult,
} from './drafted-solutions-publish.ts'
import {DIGEST_VERSION, DraftedSolutionsError, type DraftedDigest} from './drafted-solutions-shared.ts'
import {makePublicOutputTokens, type PublicOutputTokens} from './status-truth-public-output.ts'

const OWNER = 'fro-bot'
const REPO = '.github'
const FULL_NAME = `${OWNER}/${REPO}`
const BRANCH_REF = 'heads/docs/drafted-solutions'
const MAIN_SHA = '1'.repeat(40)
const BRANCH_SHA = '2'.repeat(40)
const STALE_PR_HEAD_SHA = '3'.repeat(40)
const SOURCE_SHA = 'a'.repeat(40)

const PRIVATE_TOKEN = 'acme-private-repo'
const REDACTED_ID = 'R_kgDOSecretNodeId'
const DOC_BODY = '---\ntitle: Example\n---\n\n# Example\n\nA durable lesson.\n'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async dir => rm(dir, {recursive: true, force: true})))
})

// ---------------------------------------------------------------------------
// Fake GitHub
// ---------------------------------------------------------------------------

interface FakeIssue {
  number: number
  title: string
  body: string | null
  created_at: string
  state: 'open' | 'closed'
  user: {login: string} | null
  labels: {name: string}[]
  pull_request?: unknown
}

function makeIssue(number: number, overrides: Partial<FakeIssue> = {}): FakeIssue {
  return {
    number,
    title: `Proposal ${number}`,
    body: `Lesson ${number}\n\n${buildMergeShaMarker('b'.repeat(40))}`,
    created_at: '2026-10-01T00:00:00Z',
    state: 'open',
    user: {login: 'fro-bot[bot]'},
    labels: [{name: 'learning-proposal'}],
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
    head: {ref: 'docs/drafted-solutions', sha: STALE_PR_HEAD_SHA, repo: {full_name: FULL_NAME, fork: false}},
    base: {repo: {full_name: FULL_NAME}},
    user: {login: 'fro-bot[bot]'},
    ...overrides,
  }
}

interface Call {
  op: string
  args: Record<string, unknown>
}

const WRITE_OPS = new Set([
  'git.createBlob',
  'git.createTree',
  'git.createCommit',
  'git.createRef',
  'git.updateRef',
  'pulls.create',
  'pulls.update',
  'pulls.requestReviewers',
  'issues.createComment',
  'issues.update',
])

interface FakeOptions {
  issues: FakeIssue[]
  pulls?: FakePull[]
  /** Branch ref exists (without an open PR when `pulls` is empty). */
  branchExists?: boolean
  /** The first pulls.create loses a race: a PR appears and the call fails with 422. */
  createRace?: boolean
  /** pulls.create fails with 422 but no PR ever appears. */
  createRejectedWithoutPr?: boolean
  /** An open PR exists but the drafted branch ref does not. */
  branchMissing?: boolean
  reviewRequestError?: unknown
  /** Comments already on proposal issues, by issue number. */
  existingComments?: Record<number, {body: string; user: {login: string}}[]>
  /** The next issues.update fails once (a close that did not land). */
  failNextIssueUpdate?: boolean
  /** The next pulls.update fails once (a PR-body update that did not land). */
  failNextPullUpdate?: boolean
  /** Docs present on main's head tree / on the live drafted branch tree (served by repos.getContent). */
  mainDocs?: string[]
  branchDocs?: string[]
  /** Paths that resolve to a directory (getContent returns an array), not a file. */
  directoryPaths?: string[]
}

function makeFake(options: FakeOptions) {
  const calls: Call[] = []
  const pulls = [...(options.pulls ?? [])]
  const issues = new Map(options.issues.map(issue => [issue.number, {...issue}]))
  const refs = new Map<string, string>([['heads/main', MAIN_SHA]])
  if ((options.branchExists === true || pulls.length > 0) && options.branchMissing !== true) {
    refs.set(BRANCH_REF, BRANCH_SHA)
  }
  const comments = new Map<number, {id: number; body: string; user: {login: string}}[]>(
    Object.entries(options.existingComments ?? {}).map(([issue, list]) => [
      Number(issue),
      list.map((comment, index) => ({id: 9000 + index, ...comment})),
    ]),
  )
  const treeDocs = new Map<string, Set<string>>([
    [MAIN_SHA, new Set(options.mainDocs ?? [])],
    [BRANCH_SHA, new Set(options.branchDocs ?? [])],
  ])
  let counter = 0

  const record = <T>(op: string, args: Record<string, unknown>, result: T): T => {
    calls.push({op, args})
    return result
  }
  const notFound = () => Object.assign(new Error('Not Found'), {status: 404})

  const rest = {
    issues: {
      get: vi.fn(async (args: {issue_number: number}) => {
        const issue = issues.get(args.issue_number)
        if (issue === undefined) throw notFound()
        return record('issues.get', args, {data: issue})
      }),
      listComments: vi.fn(async (args: {issue_number: number}) =>
        record('issues.listComments', args, {data: comments.get(args.issue_number) ?? []}),
      ),
      createComment: vi.fn(async (args: {issue_number: number; body: string}) => {
        const list = comments.get(args.issue_number) ?? []
        list.push({id: ++counter, body: args.body, user: {login: 'fro-bot[bot]'}})
        comments.set(args.issue_number, list)
        return record('issues.createComment', args, {data: {id: counter}})
      }),
      update: vi.fn(async (args: {issue_number: number; state?: string}) => {
        if (options.failNextIssueUpdate === true) {
          options.failNextIssueUpdate = false
          throw Object.assign(new Error('update failed'), {status: 500})
        }
        const issue = issues.get(args.issue_number)
        if (issue !== undefined && args.state === 'closed') issue.state = 'closed'
        return record('issues.update', args, {data: {}})
      }),
    },
    pulls: {
      list: vi.fn(async () => ({data: pulls})),
      create: vi.fn(async (args: {body: string; title: string}) => {
        if (options.createRejectedWithoutPr === true) {
          throw Object.assign(new Error('Validation Failed'), {status: 422})
        }
        if (options.createRace === true) {
          options.createRace = false
          pulls.push(makePull({number: 905}))
          throw Object.assign(new Error('Validation Failed'), {
            status: 422,
            response: {data: {message: 'Validation Failed', errors: [{message: 'A pull request already exists'}]}},
          })
        }
        const pull = makePull({number: 901, body: args.body})
        pulls.push(pull)
        return record('pulls.create', args, {data: {number: pull.number, html_url: 'https://example.test/901'}})
      }),
      update: vi.fn(async (args: {pull_number: number; body?: string}) => {
        if (options.failNextPullUpdate === true) {
          options.failNextPullUpdate = false
          throw Object.assign(new Error('pull update failed'), {status: 500})
        }
        const pull = pulls.find(candidate => candidate.number === args.pull_number)
        if (pull !== undefined && args.body !== undefined) pull.body = args.body
        return record('pulls.update', args, {data: {}})
      }),
      requestReviewers: vi.fn(async (args: Record<string, unknown>) => {
        if (options.reviewRequestError !== undefined) throw options.reviewRequestError
        return record('pulls.requestReviewers', args, {data: {}})
      }),
    },
    repos: {
      getContent: vi.fn(async (args: {path: string; ref: string}) => {
        record('repos.getContent', args, undefined)
        if (options.directoryPaths?.includes(args.path) === true) return {data: [{type: 'file', path: args.path}]}
        if (treeDocs.get(args.ref)?.has(args.path) !== true) throw notFound()
        return {data: {type: 'file', path: args.path}}
      }),
    },
    git: {
      getRef: vi.fn(async (args: {ref: string}) => {
        const sha = refs.get(args.ref)
        if (sha === undefined) throw notFound()
        return record('git.getRef', args, {data: {object: {sha}}})
      }),
      getCommit: vi.fn(async (args: {commit_sha: string}) =>
        record('git.getCommit', args, {data: {sha: args.commit_sha, tree: {sha: `tree-of-${args.commit_sha}`}}}),
      ),
      createBlob: vi.fn(async (args: {content: string}) =>
        record('git.createBlob', args, {data: {sha: `blob-${++counter}`}}),
      ),
      createTree: vi.fn(async (args: Record<string, unknown>) =>
        record('git.createTree', args, {data: {sha: `tree-${++counter}`}}),
      ),
      createCommit: vi.fn(async (args: Record<string, unknown>) =>
        record('git.createCommit', args, {data: {sha: `${'9'.repeat(39)}${++counter % 10}`}}),
      ),
      createRef: vi.fn(async (args: {ref: string; sha: string}) => {
        refs.set(args.ref.replace(/^refs\//, ''), args.sha)
        return record('git.createRef', args, {data: {}})
      }),
      updateRef: vi.fn(async (args: {ref: string; sha: string}) => {
        refs.set(args.ref, args.sha)
        return record('git.updateRef', args, {data: {}})
      }),
    },
  }

  const octokit = {
    paginate: vi.fn(async (fn: (p: unknown) => Promise<{data: unknown[]}>, p: unknown) => (await fn(p)).data),
    rest,
  } as unknown as OctokitClient

  return {octokit, calls, pulls, issues, refs, comments, treeDocs}
}

type Fake = ReturnType<typeof makeFake>

const callsOf = (fake: Fake, op: string): Call[] => fake.calls.filter(call => call.op === op)
const writeCalls = (fake: Fake): Call[] => fake.calls.filter(call => WRITE_OPS.has(call.op))

// ---------------------------------------------------------------------------
// Workspace fixtures
// ---------------------------------------------------------------------------

function agentRow(issue: FakeIssue, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issue: issue.number,
    outcome: 'new-doc',
    targetDoc: `docs/solutions/best-practices/doc-${issue.number}.md`,
    sourceSha: SOURCE_SHA,
    evidence: [{kind: 'pr', ref: '#1'}],
    droppedClaims: [],
    reason: '',
    ...overrides,
  }
}

function coveredRow(issue: FakeIssue, targetDoc = 'docs/solutions/best-practices/existing.md') {
  return agentRow(issue, {outcome: 'covered', targetDoc, evidence: [], reason: 'Already documented.'})
}

function unverifiedRow(issue: FakeIssue) {
  return agentRow(issue, {outcome: 'unverified', targetDoc: null, evidence: [], reason: 'No merged PR found.'})
}

interface ArrangeOptions {
  proposals: FakeIssue[]
  rows: unknown
  /** path → content for docs the agent wrote; omitted means an empty handoff. */
  changed?: Record<string, string>
  manifest?: unknown
  /** Digest hash overrides, by issue (to simulate a body edited after harvest). */
  digestBodyOverride?: Record<number, string>
}

async function arrange(options: ArrangeOptions) {
  const root = await mkdtemp(path.join(tmpdir(), 'drafted-publish-test-'))
  tempDirs.push(root)
  const handoffDir = path.join(root, 'handoff')
  await mkdir(path.join(handoffDir, 'files'), {recursive: true})

  const changed = options.changed ?? {}
  for (const [relativePath, content] of Object.entries(changed)) {
    const dest = path.join(handoffDir, 'files', relativePath)
    await mkdir(path.dirname(dest), {recursive: true})
    await writeFile(dest, content)
  }
  await writeFile(
    path.join(handoffDir, 'manifest.json'),
    JSON.stringify(options.manifest ?? {changed: Object.keys(changed), deleted: []}),
  )

  const digest: DraftedDigest = {
    version: DIGEST_VERSION,
    proposals: options.proposals.map(issue => {
      const body = options.digestBodyOverride?.[issue.number] ?? issue.body ?? ''
      return {
        issue: issue.number,
        title: issue.title,
        body,
        bodyHash: hashProposalBody(body),
        mergeSha: 'b'.repeat(40),
        createdAt: issue.created_at,
      }
    }),
    pr: {state: 'none'},
  }
  const digestPath = path.join(root, 'digest.json')
  const rowsPath = path.join(root, 'rows.json')
  await writeFile(digestPath, JSON.stringify(digest))
  await writeFile(rowsPath, typeof options.rows === 'string' ? options.rows : JSON.stringify(options.rows))

  return {digestPath, handoffDir, rowsPath}
}

const okTokens = async (): Promise<PublicOutputTokens> =>
  makePublicOutputTokens({privateTokens: new Set([PRIVATE_TOKEN]), redactedCanonicalIds: new Set([REDACTED_ID])})

async function run(
  fake: Fake,
  options: ArrangeOptions,
  overrides: Partial<PublishParams> = {},
): Promise<PublishResult> {
  const paths = await arrange(options)
  return publishDraftedSolutions({
    octokit: fake.octokit,
    owner: OWNER,
    repo: REPO,
    ...paths,
    loadTokens: okTokens,
    logger: {info: () => undefined},
    ...overrides,
  })
}

const docPath = (n: number): string => `docs/solutions/best-practices/doc-${n}.md`

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('publishDraftedSolutions: doc changes without an open PR', () => {
  it('resets the branch to main head, commits once, opens a PR with closing lines, requests review', async () => {
    const issues = [makeIssue(11), makeIssue(12)]
    const fake = makeFake({issues})

    const result = await run(fake, {
      proposals: issues,
      rows: issues.map(issue => agentRow(issue)),
      changed: {[docPath(11)]: DOC_BODY, [docPath(12)]: DOC_BODY},
    })

    expect(result).toMatchObject({mode: 'created-pr', prNumber: 901})
    expect(callsOf(fake, 'git.createBlob')).toHaveLength(2)
    expect(callsOf(fake, 'git.createTree')).toHaveLength(1)
    expect(callsOf(fake, 'git.createTree')[0]?.args).toMatchObject({base_tree: `tree-of-${MAIN_SHA}`})
    expect(callsOf(fake, 'git.createCommit')).toHaveLength(1)
    expect(callsOf(fake, 'git.createCommit')[0]?.args).toMatchObject({parents: [MAIN_SHA]})
    expect(callsOf(fake, 'git.createRef')[0]?.args).toMatchObject({ref: 'refs/heads/docs/drafted-solutions'})
    expect(callsOf(fake, 'git.updateRef')).toHaveLength(0)

    const create = callsOf(fake, 'pulls.create')[0]?.args as {title: string; body: string; head: string; base: string}
    expect(create).toMatchObject({title: DRAFTED_PR_TITLE, head: 'docs/drafted-solutions', base: 'main'})
    expect(create.body.match(/^Closes #\d+$/gm)).toStrictEqual(['Closes #11', 'Closes #12'])
    expect(callsOf(fake, 'pulls.requestReviewers')[0]?.args).toMatchObject({pull_number: 901, reviewers: ['fro-bot']})
  })

  it('writes the exact handoff content into blobs and uses the digest body hash for rows', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await run(fake, {
      proposals: [issue],
      rows: [agentRow(issue, {bodyHash: 'f'.repeat(64)})],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(callsOf(fake, 'git.createBlob')[0]?.args).toMatchObject({content: DOC_BODY})
    const body = (callsOf(fake, 'pulls.create')[0]?.args as {body: string}).body
    const parsed = parseCoverageBlock(body, 'existing-pr')
    expect(parsed.ok && parsed.rows[0]?.bodyHash).toBe(hashProposalBody(issue.body ?? ''))
  })

  it('force-resets an existing branch with no open PR, logging old → new', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], branchExists: true})
    const info = vi.fn()

    const result = await run(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      {logger: {info}},
    )

    expect(result.mode).toBe('created-pr')
    expect(callsOf(fake, 'git.createRef')).toHaveLength(0)
    expect(callsOf(fake, 'git.updateRef')[0]?.args).toMatchObject({ref: BRANCH_REF, force: true})
    expect(info).toHaveBeenCalledWith(expect.stringContaining(BRANCH_SHA))
    expect(callsOf(fake, 'pulls.create')).toHaveLength(1)
  })

  it('tolerates a 422 from the review request (already requested)', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], reviewRequestError: Object.assign(new Error('x'), {status: 422})})

    await expect(
      run(fake, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}}),
    ).resolves.toMatchObject({mode: 'created-pr'})
  })

  it('surfaces other review-request failures', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], reviewRequestError: Object.assign(new Error('boom'), {status: 500})})

    await expect(
      run(fake, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}}),
    ).rejects.toThrow(/boom/)
  })

  it('a create-422 falls back to updating the PR that appeared', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], createRace: true})

    const result = await run(fake, {
      proposals: [issue],
      rows: [agentRow(issue)],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result).toMatchObject({mode: 'updated-pr', prNumber: 905})
    expect(callsOf(fake, 'pulls.update')[0]?.args).toMatchObject({pull_number: 905})
    expect((callsOf(fake, 'pulls.update')[0]?.args as {body: string}).body).toContain('Closes #11')
  })
})

describe('publishDraftedSolutions: PR/branch inconsistencies', () => {
  it('rejects an open drafted PR whose branch ref does not exist, with zero writes', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()], branchMissing: true})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /is open but docs\/drafted-solutions does not exist/,
    )
  })

  it('rejects a create-422 when no drafted PR appeared, and never updates a PR', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], createRejectedWithoutPr: true})

    await expect(
      run(fake, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}}),
    ).rejects.toThrow(/PR creation was rejected \(422\) and no drafted PR exists/)
    expect(callsOf(fake, 'pulls.update')).toHaveLength(0)
    expect(callsOf(fake, 'pulls.create')).toHaveLength(0)
  })
})

describe('publishDraftedSolutions: doc changes with an open PR', () => {
  it('commits a delta on the branch head read at commit time and merges rows into the body', async () => {
    const earlier = makeIssue(9, {state: 'closed'})
    const issue = makeIssue(11)
    const existingRow: CoverageRow = {
      issue: 9,
      outcome: 'new-doc',
      targetDoc: docPath(9),
      sourceSha: SOURCE_SHA,
      evidence: [{kind: 'pr', ref: '#9'}],
      droppedClaims: [],
      bodyHash: hashProposalBody(earlier.body ?? ''),
      reason: '',
    }
    const pull = makePull({body: renderPrBody([existingRow])})
    // The existing row's doc is on the live branch tree, so its claim is still true.
    const fake = makeFake({issues: [earlier, issue], pulls: [pull], branchDocs: [docPath(9)]})

    const result = await run(fake, {
      proposals: [issue],
      rows: [agentRow(issue)],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result).toMatchObject({mode: 'updated-pr', prNumber: 900})
    // The PR's recorded head is stale; the commit must sit on the branch ref's current head.
    expect(callsOf(fake, 'git.getRef').some(call => call.args.ref === BRANCH_REF)).toBe(true)
    expect(callsOf(fake, 'git.createTree')[0]?.args).toMatchObject({base_tree: `tree-of-${BRANCH_SHA}`})
    expect(callsOf(fake, 'git.createCommit')[0]?.args).toMatchObject({parents: [BRANCH_SHA]})
    expect(callsOf(fake, 'git.updateRef')[0]?.args).toMatchObject({ref: BRANCH_REF, force: false})
    expect(callsOf(fake, 'git.createRef')).toHaveLength(0)
    expect(callsOf(fake, 'pulls.create')).toHaveLength(0)

    const body = (callsOf(fake, 'pulls.update')[0]?.args as {body: string}).body
    expect(body.match(/^Closes #\d+$/gm)).toStrictEqual(['Closes #9', 'Closes #11'])
    const parsed = parseCoverageBlock(body, 'existing-pr')
    expect(parsed.ok && parsed.rows.map(row => row.issue)).toStrictEqual([9, 11])
  })

  it('replaces the existing row when a proposal is re-drafted', async () => {
    const issue = makeIssue(11, {body: 'Corrected lesson'})
    const staleRow: CoverageRow = {
      issue: 11,
      outcome: 'new-doc',
      targetDoc: docPath(11),
      sourceSha: SOURCE_SHA,
      evidence: [{kind: 'pr', ref: '#1'}],
      droppedClaims: [],
      bodyHash: hashProposalBody('Original lesson'),
      reason: '',
    }
    const fake = makeFake({issues: [issue], pulls: [makePull({body: renderPrBody([staleRow])})]})

    await run(fake, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}})

    const body = (callsOf(fake, 'pulls.update')[0]?.args as {body: string}).body
    const parsed = parseCoverageBlock(body, 'existing-pr')
    expect(parsed.ok && parsed.rows).toHaveLength(1)
    expect(parsed.ok && parsed.rows[0]?.bodyHash).toBe(hashProposalBody('Corrected lesson'))
  })
})

describe('publishDraftedSolutions: no doc changes', () => {
  it('comments on and closes each processed proposal, with no branch or PR call', async () => {
    const covered = makeIssue(11)
    const unverified = makeIssue(12)
    const fake = makeFake({issues: [covered, unverified], mainDocs: ['docs/solutions/best-practices/existing.md']})

    const result = await run(fake, {
      proposals: [covered, unverified],
      rows: [coveredRow(covered), unverifiedRow(unverified)],
    })

    expect(result).toStrictEqual({mode: 'closed-proposals', closed: [11, 12], skipped: []})
    const comments = callsOf(fake, 'issues.createComment')
    expect(comments).toHaveLength(2)
    expect(comments[0]?.args).toMatchObject({issue_number: 11})
    expect(comments[0]?.args.body).toContain('docs/solutions/best-practices/existing.md')
    expect(comments[0]?.args.body).toContain('Already documented.')
    expect(comments[1]?.args.body).toContain('No merged PR found.')
    expect(callsOf(fake, 'issues.update').map(call => call.args)).toMatchObject([
      {issue_number: 11, state: 'closed', state_reason: 'completed'},
      {issue_number: 12, state: 'closed', state_reason: 'not_planned'},
    ])
    expect(fake.calls.filter(call => call.op.startsWith('git.') && call.op !== 'git.getRef')).toHaveLength(0)
    expect(fake.calls.some(call => call.op.startsWith('pulls.'))).toBe(false)
  })

  it('posts each comment before closing its issue', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await run(fake, {
      proposals: [issue],
      rows: [unverifiedRow(issue)],
    })

    const ops = fake.calls.map(call => call.op)
    expect(ops.indexOf('issues.createComment')).toBeLessThan(ops.indexOf('issues.update'))
  })

  it('skips proposals that are already closed', async () => {
    const open = makeIssue(11)
    const closed = makeIssue(12, {state: 'closed'})
    const fake = makeFake({issues: [open, closed]})

    const result = await run(fake, {
      proposals: [open, closed],
      rows: [unverifiedRow(open), unverifiedRow(closed)],
    })

    expect(result).toStrictEqual({mode: 'closed-proposals', closed: [11], skipped: [12]})
    expect(callsOf(fake, 'issues.createComment').map(call => call.args.issue_number)).toStrictEqual([11])
  })

  it('does not touch an open PR when the run has no doc changes', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()]})

    const result = await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(result.mode).toBe('closed-proposals')
    expect(fake.calls.some(call => call.op === 'pulls.update' || call.op === 'git.updateRef')).toBe(false)
  })

  it('is a no-op for an empty digest', async () => {
    const fake = makeFake({issues: []})

    const result = await run(fake, {proposals: [], rows: []})

    expect(result).toStrictEqual({mode: 'noop'})
    expect(writeCalls(fake)).toHaveLength(0)
  })
})

describe('publishDraftedSolutions: mixed run (AE2)', () => {
  it('puts a new-doc row and a covered row in one PR and does not close the covered proposal directly', async () => {
    const drafted = makeIssue(11)
    const covered = makeIssue(12)
    const fake = makeFake({issues: [drafted, covered], mainDocs: ['docs/solutions/best-practices/existing.md']})

    const result = await run(fake, {
      proposals: [drafted, covered],
      rows: [agentRow(drafted), coveredRow(covered)],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result.mode).toBe('created-pr')
    const body = (callsOf(fake, 'pulls.create')[0]?.args as {body: string}).body
    expect(body.match(/^Closes #\d+$/gm)).toStrictEqual(['Closes #11', 'Closes #12'])
    expect(callsOf(fake, 'issues.createComment')).toHaveLength(0)
    expect(callsOf(fake, 'issues.update')).toHaveLength(0)
  })

  it('accepts a covered row whose doc is created by this same handoff', async () => {
    const drafted = makeIssue(11)
    const covered = makeIssue(12)
    const fake = makeFake({issues: [drafted, covered]})

    const result = await run(fake, {
      proposals: [drafted, covered],
      rows: [agentRow(drafted), coveredRow(covered, docPath(11))],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result.mode).toBe('created-pr')
  })
})

// ---------------------------------------------------------------------------
// Routing: outcome x PR open x doc changes
// ---------------------------------------------------------------------------

const GIT_WRITE_OPS = ['git.createBlob', 'git.createTree', 'git.createCommit', 'git.createRef', 'git.updateRef']
const EXISTING_DOC = 'docs/solutions/best-practices/existing.md'

/** The body of the last PR create/update, or null when the run never wrote a PR body. */
function lastPrBody(fake: Fake): string | null {
  const bodies = fake.calls
    .filter(call => call.op === 'pulls.create' || call.op === 'pulls.update')
    .map(call => String(call.args.body))
  return bodies.at(-1) ?? null
}

describe('publishDraftedSolutions: unverified proposals are always closed directly as not planned', () => {
  it.each([
    ['no PR, with doc changes', false, true],
    ['an open PR, with doc changes', true, true],
    ['an open PR, without doc changes', true, false],
    ['no PR, without doc changes', false, false],
  ])('%s', async (_label: string, prOpen: boolean, withDocs: boolean) => {
    const drafted = makeIssue(20)
    const unverified = makeIssue(11)
    const fake = makeFake({issues: [drafted, unverified], pulls: prOpen ? [makePull()] : []})

    await run(fake, {
      proposals: withDocs ? [drafted, unverified] : [unverified],
      rows: withDocs ? [agentRow(drafted), unverifiedRow(unverified)] : [unverifiedRow(unverified)],
      changed: withDocs ? {[docPath(20)]: DOC_BODY} : {},
    })

    const body = lastPrBody(fake)
    if (body !== null) {
      expect(body).not.toContain('Closes #11')
      const parsed = parseCoverageBlock(body, 'existing-pr')
      expect(parsed.ok && parsed.rows.map(row => row.issue)).not.toContain(11)
    }
    expect(callsOf(fake, 'issues.createComment').map(call => call.args.issue_number)).toStrictEqual([11])
    expect(callsOf(fake, 'issues.update').map(call => call.args)).toMatchObject([
      {issue_number: 11, state: 'closed', state_reason: 'not_planned'},
    ])
  })
})

describe('publishDraftedSolutions: routing table (outcome x PR open x doc changes)', () => {
  // inBody: the proposal gets a row + `Closes #N` in the PR body. direct: it is commented on and closed now.
  it.each([
    ['new-doc', false, true, {inBody: true, direct: false}],
    ['new-doc', true, true, {inBody: true, direct: false}],
    ['covered', false, true, {inBody: true, direct: false}],
    ['covered', true, true, {inBody: true, direct: false}],
    ['covered', true, false, {inBody: true, direct: false}],
    ['covered', false, false, {inBody: false, direct: true}],
    ['unverified', false, true, {inBody: false, direct: true}],
    ['unverified', true, true, {inBody: false, direct: true}],
    ['unverified', true, false, {inBody: false, direct: true}],
    ['unverified', false, false, {inBody: false, direct: true}],
  ] as const)(
    '%s, PR open=%s, doc changes=%s',
    async (outcome: 'new-doc' | 'covered' | 'unverified', prOpen: boolean, withDocs: boolean, expected) => {
      const target = makeIssue(11)
      const companion = makeIssue(20)
      const fake = makeFake({
        issues: [target, companion],
        pulls: prOpen ? [makePull()] : [],
        mainDocs: [EXISTING_DOC],
        branchDocs: [EXISTING_DOC],
      })
      const targetRow =
        outcome === 'new-doc' ? agentRow(target) : outcome === 'covered' ? coveredRow(target) : unverifiedRow(target)
      // A new-doc row needs its doc in the handoff; "with doc changes" is carried by a companion new-doc row.
      const needsCompanion = withDocs && outcome !== 'new-doc'

      await run(fake, {
        proposals: needsCompanion ? [target, companion] : [target],
        rows: needsCompanion ? [targetRow, agentRow(companion)] : [targetRow],
        changed: withDocs ? {[docPath(needsCompanion ? 20 : 11)]: DOC_BODY} : {},
      })

      const body = lastPrBody(fake)
      if (expected.inBody) {
        expect(body).toContain('Closes #11')
        const parsed = parseCoverageBlock(body, 'existing-pr')
        expect(parsed.ok && parsed.rows.map(row => row.issue)).toContain(11)
      } else {
        expect(body ?? '').not.toContain('Closes #11')
      }
      const closedDirectly = callsOf(fake, 'issues.update').some(call => call.args.issue_number === 11)
      expect(closedDirectly).toBe(expected.direct)
      expect(callsOf(fake, 'issues.createComment').some(call => call.args.issue_number === 11)).toBe(expected.direct)
      if (expected.direct && outcome === 'covered') {
        expect(callsOf(fake, 'issues.update')[0]?.args).toMatchObject({state_reason: 'completed'})
      }
    },
  )
})

describe('publishDraftedSolutions: covered rows with an open PR and no doc changes', () => {
  it('updates only the PR body: no blob, tree, commit, or ref write', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()], branchDocs: [EXISTING_DOC]})

    const result = await run(fake, {proposals: [issue], rows: [coveredRow(issue)]})

    expect(result).toMatchObject({mode: 'updated-pr-body', prNumber: 900})
    expect(fake.calls.filter(call => GIT_WRITE_OPS.includes(call.op))).toStrictEqual([])
    expect(callsOf(fake, 'pulls.update')).toHaveLength(1)
    expect((callsOf(fake, 'pulls.update')[0]?.args as {body: string}).body).toContain('Closes #11')
    expect(callsOf(fake, 'issues.createComment')).toHaveLength(0)
    expect(callsOf(fake, 'issues.update')).toHaveLength(0)
  })

  it('recovers after a PR-body update failed following a successful ref update', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()], failNextPullUpdate: true})

    // Run 1: the branch moves, then the PR-body update fails.
    await expect(
      run(fake, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}}),
    ).rejects.toThrow(/pull update failed/)
    expect(callsOf(fake, 'git.updateRef')).toHaveLength(1)
    expect(fake.pulls[0]?.body ?? '').not.toContain('Closes #11')

    // Run 2: harvest lists #11 as uncovered again; the doc is already on the drafted tree, so the
    // agent marks it covered. Only the PR body is repaired; the proposal is not closed directly.
    // The branch moved in run 1, so the doc is now on the live branch tree.
    fake.treeDocs.set(fake.refs.get(BRANCH_REF) ?? '', new Set([docPath(11)]))
    const result = await run(fake, {proposals: [issue], rows: [coveredRow(issue, docPath(11))]})

    expect(result).toMatchObject({mode: 'updated-pr-body', prNumber: 900})
    expect(callsOf(fake, 'git.updateRef')).toHaveLength(1)
    expect(callsOf(fake, 'git.createCommit')).toHaveLength(1)
    expect(fake.pulls[0]?.body).toContain('Closes #11')
    const parsed = parseCoverageBlock(fake.pulls[0]?.body, 'existing-pr')
    expect(parsed.ok && parsed.rows.map(row => [row.issue, row.outcome])).toStrictEqual([[11, 'covered']])
    expect(callsOf(fake, 'issues.createComment')).toHaveLength(0)
    expect(callsOf(fake, 'issues.update')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Closure comments are idempotent
// ---------------------------------------------------------------------------

/** The decision-scoped marker: same issue, same outcome, same proposal body. */
function marker(issue: FakeIssue, outcome: 'covered' | 'unverified' = 'unverified', body = issue.body ?? ''): string {
  return `<!-- fro-bot:drafted-solutions-closure v2 issue=${issue.number} outcome=${outcome} body=${hashProposalBody(body)} -->`
}

describe('publishDraftedSolutions: closure comments are idempotent per decision', () => {
  it('carries a hidden marker naming the issue, the outcome, and the proposal body hash', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(String(callsOf(fake, 'issues.createComment')[0]?.args.body)).toContain(marker(issue))
  })

  it('a covered closure carries outcome=covered', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], mainDocs: [EXISTING_DOC]})

    await run(fake, {proposals: [issue], rows: [coveredRow(issue)]})

    expect(String(callsOf(fake, 'issues.createComment')[0]?.args.body)).toContain(marker(issue, 'covered'))
  })

  it('an exact-match retry after a failed close posts no second comment, then closes the issue', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], failNextIssueUpdate: true})
    const options = {proposals: [issue], rows: [unverifiedRow(issue)]}

    await expect(run(fake, options)).rejects.toThrow(/update failed/)
    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
    expect(fake.issues.get(11)?.state).toBe('open')

    const result = await run(fake, options)

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
    expect(callsOf(fake, 'issues.update')).toHaveLength(1)
    expect(fake.issues.get(11)?.state).toBe('closed')
    expect(result).toMatchObject({mode: 'closed-proposals', closed: [11]})
  })

  it('skips the comment when the bot already left the exact marker, but still closes', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({
      issues: [issue],
      existingComments: {11: [{body: `earlier closure\n\n${marker(issue)}`, user: {login: 'fro-bot[bot]'}}]},
    })

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(0)
    expect(callsOf(fake, 'issues.update')).toHaveLength(1)
  })

  it('the same issue with a different body hash gets a fresh comment', async () => {
    const issue = makeIssue(11, {body: 'Corrected lesson'})
    const fake = makeFake({
      issues: [issue],
      existingComments: {
        11: [{body: marker(issue, 'unverified', 'Original lesson'), user: {login: 'fro-bot[bot]'}}],
      },
    })

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
    expect(String(callsOf(fake, 'issues.createComment')[0]?.args.body)).toContain(marker(issue))
  })

  it('the same issue with a different outcome gets a fresh comment', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({
      issues: [issue],
      existingComments: {11: [{body: marker(issue, 'covered'), user: {login: 'fro-bot[bot]'}}]},
    })

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
  })

  it('a v1 issue-only marker does not suppress', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({
      issues: [issue],
      existingComments: {
        11: [{body: '<!-- fro-bot:drafted-solutions-closure v1 issue=11 -->', user: {login: 'fro-bot[bot]'}}],
      },
    })

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
  })

  it('ignores an exact marker from another author', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({
      issues: [issue],
      existingComments: {11: [{body: `fake\n\n${marker(issue)}`, user: {login: 'mallory'}}]},
    })

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
    expect(fake.issues.get(11)?.state).toBe('closed')
  })

  it('ignores a bot comment carrying a different issue number or prose only', async () => {
    const issue = makeIssue(11)
    const other = makeIssue(12)
    const fake = makeFake({
      issues: [issue],
      existingComments: {
        11: [
          {body: marker(other), user: {login: 'fro-bot[bot]'}},
          {body: 'mentions drafted-solutions-closure in prose', user: {login: 'fro-bot[bot]'}},
        ],
      },
    })

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'issues.createComment')).toHaveLength(1)
  })

  it('escapes agent text so it cannot forge or close an HTML comment marker', async () => {
    const a = makeIssue(11)
    const b = makeIssue(12)
    const fake = makeFake({issues: [a, b]})
    const forged = `${marker(b)} --> <b>x</b>`

    await run(fake, {
      proposals: [a, b],
      rows: [{...unverifiedRow(a), reason: forged}, unverifiedRow(b)],
    })

    const comment = String(callsOf(fake, 'issues.createComment')[0]?.args.body)
    expect(comment).toContain(marker(a))
    expect(comment.match(/<!--/g)).toHaveLength(1)
    expect(comment).not.toContain('<b>')
    expect(comment).toContain('&lt;!-- fro-bot:drafted-solutions-closure v2 issue=12')
    // The forged text did not suppress issue 12's own comment.
    expect(callsOf(fake, 'issues.createComment').map(call => call.args.issue_number)).toStrictEqual([11, 12])
  })
})

// ---------------------------------------------------------------------------
// Inverse accounting: every handoff file belongs to a drafted row
// ---------------------------------------------------------------------------

describe('publishDraftedSolutions: every handoff file is a new-doc or extension target (zero writes)', () => {
  it('rejects all-unverified rows with a doc in the handoff', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [unverifiedRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /not the target doc of any new-doc or extension row/,
    )
  })

  it('rejects a covered-only row whose targetDoc is in the handoff', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [coveredRow(issue, docPath(11))], changed: {[docPath(11)]: DOC_BODY}},
      /not the target doc of any new-doc or extension row/,
    )
  })

  it('rejects one new-doc row plus an extra unreferenced doc, without echoing the extra path', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    const message = await expectBlocked(
      fake,
      {
        proposals: [issue],
        rows: [agentRow(issue)],
        changed: {
          [docPath(11)]: DOC_BODY,
          'docs/solutions/best-practices/smuggled-extra-doc.md': DOC_BODY,
        },
      },
      /not the target doc of any new-doc or extension row/,
    )

    expect(message).not.toContain('smuggled-extra-doc')
  })

  it('accepts an extension row as the owner of its doc, and one doc shared by two rows', async () => {
    const a = makeIssue(11)
    const b = makeIssue(12)
    const fake = makeFake({issues: [a, b]})

    const result = await run(fake, {
      proposals: [a, b],
      rows: [agentRow(a, {outcome: 'extension'}), agentRow(b, {targetDoc: docPath(11)})],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result.mode).toBe('created-pr')
  })
})

// ---------------------------------------------------------------------------
// Covered docs are verified on the tree that will back the PR (read through the API)
// ---------------------------------------------------------------------------

const contentRefs = (fake: Fake): unknown[] => callsOf(fake, 'repos.getContent').map(call => call.args.ref)

describe('publishDraftedSolutions: covered docs are verified on the published tree', () => {
  it('body-only update: rejects a doc present on main but not on the live branch tree, with zero writes', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()], mainDocs: [EXISTING_DOC], branchDocs: []})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [coveredRow(issue)]},
      /points at a doc missing from the published tree/,
    )
    expect(contentRefs(fake)).toStrictEqual([BRANCH_SHA])
  })

  it('body-only update: accepts a doc on the live branch tree, read at the live branch head', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()], branchDocs: [EXISTING_DOC]})

    const result = await run(fake, {proposals: [issue], rows: [coveredRow(issue)]})

    expect(result).toMatchObject({mode: 'updated-pr-body'})
    expect(contentRefs(fake)).toStrictEqual([BRANCH_SHA])
    expect(callsOf(fake, 'repos.getContent')[0]?.args).toMatchObject({path: EXISTING_DOC})
  })

  it('body-only update: a missing branch ref fails closed with zero writes', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull()], branchMissing: true, mainDocs: [EXISTING_DOC]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [coveredRow(issue)]},
      /is open but docs\/drafted-solutions does not exist/,
    )
  })

  it('direct close: rejects a covered row whose doc is missing on main', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], mainDocs: []})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [coveredRow(issue)]},
      /points at a doc missing from the published tree/,
    )
    expect(contentRefs(fake)).toStrictEqual([MAIN_SHA])
  })

  it("direct close: accepts a doc on main's head tree", async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], mainDocs: [EXISTING_DOC]})

    const result = await run(fake, {proposals: [issue], rows: [coveredRow(issue)]})

    expect(result).toMatchObject({mode: 'closed-proposals', closed: [11]})
    expect(contentRefs(fake)).toStrictEqual([MAIN_SHA])
  })

  it("commit path, new PR: base tree is main's head; a covered doc missing there is rejected", async () => {
    const drafted = makeIssue(11)
    const covered = makeIssue(12)
    const fake = makeFake({issues: [drafted, covered], mainDocs: []})

    await expectBlocked(
      fake,
      {
        proposals: [drafted, covered],
        rows: [agentRow(drafted), coveredRow(covered)],
        changed: {[docPath(11)]: DOC_BODY},
      },
      /points at a doc missing from the published tree/,
    )
    expect(contentRefs(fake)).toStrictEqual([MAIN_SHA])
  })

  it('commit path, open PR: base tree is the live branch head, not main', async () => {
    const drafted = makeIssue(11)
    const covered = makeIssue(12)
    const fake = makeFake({issues: [drafted, covered], pulls: [makePull()], mainDocs: [EXISTING_DOC], branchDocs: []})

    await expectBlocked(
      fake,
      {
        proposals: [drafted, covered],
        rows: [agentRow(drafted), coveredRow(covered)],
        changed: {[docPath(11)]: DOC_BODY},
      },
      /points at a doc missing from the published tree/,
    )
    expect(contentRefs(fake)).toStrictEqual([BRANCH_SHA])
  })

  it('commit path: a covered doc on the base tree is accepted alongside a drafted doc', async () => {
    const drafted = makeIssue(11)
    const covered = makeIssue(12)
    const fake = makeFake({issues: [drafted, covered], mainDocs: [EXISTING_DOC]})

    const result = await run(fake, {
      proposals: [drafted, covered],
      rows: [agentRow(drafted), coveredRow(covered)],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result.mode).toBe('created-pr')
  })

  it('a covered doc created by this same handoff needs no tree lookup', async () => {
    const drafted = makeIssue(11)
    const covered = makeIssue(12)
    const fake = makeFake({issues: [drafted, covered]})

    await run(fake, {
      proposals: [drafted, covered],
      rows: [agentRow(drafted), coveredRow(covered, docPath(11))],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(callsOf(fake, 'repos.getContent')).toHaveLength(0)
  })

  it('treats a directory at the path as a missing doc', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], mainDocs: [EXISTING_DOC], directoryPaths: [EXISTING_DOC]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [coveredRow(issue)]},
      /points at a doc missing from the published tree/,
    )
  })

  it('makes no tree lookup when no row is covered', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(callsOf(fake, 'repos.getContent')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Existing coverage-block rows are verified too: the whole merged body must be true
// ---------------------------------------------------------------------------

function blockRow(
  issue: FakeIssue,
  outcome: 'new-doc' | 'covered',
  targetDoc: string,
  overrides: Partial<CoverageRow> = {},
): CoverageRow {
  return {
    issue: issue.number,
    outcome,
    targetDoc,
    sourceSha: SOURCE_SHA,
    evidence: outcome === 'covered' ? [] : [{kind: 'pr', ref: '#1'}],
    droppedClaims: [],
    bodyHash: hashProposalBody(issue.body ?? ''),
    reason: outcome === 'covered' ? 'Already documented.' : '',
    ...overrides,
  }
}

describe('publishDraftedSolutions: existing coverage rows are verified on the published tree', () => {
  const MISSING_PATTERN = /coverage row for #9 points at a doc missing from the published tree/

  it('body-only update: rejects an existing covered row whose doc is gone, with zero writes', async () => {
    const earlier = makeIssue(9, {state: 'closed'})
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([blockRow(earlier, 'covered', EXISTING_DOC)])})
    const fake = makeFake({issues: [earlier, issue], pulls: [pull], branchDocs: [docPath(11)]})

    const message = await expectBlocked(
      fake,
      {proposals: [issue], rows: [coveredRow(issue, docPath(11))]},
      MISSING_PATTERN,
    )

    expect(message).not.toContain(EXISTING_DOC)
  })

  it('commit path: rejects an existing new-doc row whose doc was deleted from the branch, with zero writes', async () => {
    const earlier = makeIssue(9, {state: 'closed'})
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([blockRow(earlier, 'new-doc', docPath(9))])})
    const fake = makeFake({issues: [earlier, issue], pulls: [pull], branchDocs: []})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      MISSING_PATTERN,
    )
  })

  it('happy path: existing rows whose docs are present on the branch are kept and the update lands', async () => {
    const a = makeIssue(8, {state: 'closed'})
    const b = makeIssue(9, {state: 'closed'})
    const issue = makeIssue(11)
    const pull = makePull({
      body: renderPrBody([blockRow(a, 'covered', EXISTING_DOC), blockRow(b, 'new-doc', docPath(9))]),
    })
    const fake = makeFake({
      issues: [a, b, issue],
      pulls: [pull],
      branchDocs: [EXISTING_DOC, docPath(9), docPath(11)],
    })

    const result = await run(fake, {proposals: [issue], rows: [coveredRow(issue, docPath(11))]})

    expect(result).toMatchObject({mode: 'updated-pr-body'})
    const parsed = parseCoverageBlock(fake.pulls[0]?.body, 'existing-pr')
    expect(parsed.ok && parsed.rows.map(row => row.issue)).toStrictEqual([8, 9, 11])
  })

  it('looks each distinct path up once, however many rows point at it', async () => {
    const a = makeIssue(8, {state: 'closed'})
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([blockRow(a, 'covered', EXISTING_DOC)])})
    const fake = makeFake({issues: [a, issue], pulls: [pull], branchDocs: [EXISTING_DOC]})

    await run(fake, {proposals: [issue], rows: [coveredRow(issue, EXISTING_DOC)]})

    expect(callsOf(fake, 'repos.getContent').map(call => call.args.path)).toStrictEqual([EXISTING_DOC])
  })

  it('an existing row whose doc this handoff writes needs no lookup', async () => {
    const earlier = makeIssue(9, {state: 'closed'})
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([blockRow(earlier, 'new-doc', docPath(11))])})
    const fake = makeFake({issues: [earlier, issue], pulls: [pull], branchDocs: []})

    const result = await run(fake, {
      proposals: [issue],
      rows: [agentRow(issue)],
      changed: {[docPath(11)]: DOC_BODY},
    })

    expect(result).toMatchObject({mode: 'updated-pr'})
    expect(callsOf(fake, 'repos.getContent')).toHaveLength(0)
  })

  it('does not inspect existing rows when the run writes nothing to the PR', async () => {
    const earlier = makeIssue(9, {state: 'closed'})
    const issue = makeIssue(11)
    const pull = makePull({body: renderPrBody([blockRow(earlier, 'covered', EXISTING_DOC)])})
    const fake = makeFake({issues: [earlier, issue], pulls: [pull], branchDocs: []})

    const result = await run(fake, {proposals: [issue], rows: [unverifiedRow(issue)]})

    expect(result).toMatchObject({mode: 'closed-proposals', closed: [11]})
    expect(callsOf(fake, 'repos.getContent')).toHaveLength(0)
    expect(callsOf(fake, 'pulls.update')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fail-closed paths
// ---------------------------------------------------------------------------

async function expectBlocked(
  fake: Fake,
  options: ArrangeOptions,
  pattern: RegExp,
  overrides: Partial<PublishParams> = {},
) {
  let error: unknown
  try {
    await run(fake, options, overrides)
  } catch (error_: unknown) {
    error = error_
  }
  expect(error).toBeInstanceOf(DraftedSolutionsError)
  expect((error as Error).message).toMatch(pattern)
  expect(writeCalls(fake)).toStrictEqual([])
  return (error as Error).message
}

describe('publishDraftedSolutions: privacy gate (zero writes)', () => {
  it('blocks a private token in a doc file, without echoing it', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    const message = await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: `${DOC_BODY}\nSee ${PRIVATE_TOKEN}.\n`}},
      /privacy gate/,
    )

    expect(message).not.toContain(PRIVATE_TOKEN)
  })

  it('blocks a private token that surfaces only in the rendered PR body', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    const message = await expectBlocked(
      fake,
      {
        proposals: [issue],
        rows: [agentRow(issue, {droppedClaims: [`claim about ${PRIVATE_TOKEN}`]})],
        changed: {[docPath(11)]: DOC_BODY},
      },
      /privacy gate/,
    )

    expect(message).not.toContain(PRIVATE_TOKEN)
  })

  it('blocks a private token in a comment', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue, {...unverifiedRow(issue), reason: `mentions ${PRIVATE_TOKEN}`})]},
      /privacy gate/,
    )
  })

  it('blocks a private token in a file path', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})
    const leakyPath = `docs/solutions/best-practices/${PRIVATE_TOKEN}.md`

    const message = await expectBlocked(
      fake,
      {
        proposals: [issue],
        rows: [agentRow(issue, {targetDoc: leakyPath})],
        changed: {[leakyPath]: DOC_BODY},
      },
      /privacy gate/,
    )

    expect(message).not.toContain(PRIVATE_TOKEN)
  })

  it('withholds validation errors that would echo agent-supplied private text', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    const message = await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue, {[PRIVATE_TOKEN]: 1})], changed: {[docPath(11)]: DOC_BODY}},
      /withheld/,
    )

    expect(message).not.toContain(PRIVATE_TOKEN)
  })

  it('blocks a redacted canonical ID in a doc', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    const message = await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: `${DOC_BODY}\n${REDACTED_ID}\n`}},
      /privacy gate/,
    )

    expect(message).not.toContain(REDACTED_ID)
  })

  it('blocks a redacted canonical ID in the PR title', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /privacy gate/,
      {prTitle: `docs: ${REDACTED_ID}`},
    )
  })

  it('blocks a redacted canonical ID in a comment', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [{...unverifiedRow(issue), reason: `ref ${REDACTED_ID}`}]},
      /privacy gate/,
    )
  })

  it('blocks a secret-shaped string in a doc', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {
        proposals: [issue],
        rows: [agentRow(issue)],
        changed: {[docPath(11)]: `${DOC_BODY}\nghp_${'a'.repeat(36)}\n`},
      },
      /privacy gate/,
    )
  })

  it('fails closed when the private tokens cannot be loaded', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /could not load/,
      {
        loadTokens: async () => {
          throw new Error('metadata/repos.yaml unreadable')
        },
      },
    )
  })
})

describe('publishDraftedSolutions: validation (zero writes)', () => {
  it('rejects a covered row whose doc exists nowhere', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(fake, {proposals: [issue], rows: [coveredRow(issue)]}, /points at a doc missing/)
  })

  it('rejects a new-doc row whose target doc is not in the handoff', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(99)]: DOC_BODY}},
      /not part of the handoff/,
    )
  })

  it('rejects a digest proposal with no row', async () => {
    const a = makeIssue(11)
    const b = makeIssue(12)
    const fake = makeFake({issues: [a, b]})

    await expectBlocked(
      fake,
      {proposals: [a, b], rows: [agentRow(a)], changed: {[docPath(11)]: DOC_BODY}},
      /no evidence row for proposal #12/,
    )
  })

  it('rejects a row for a proposal that is not in the digest', async () => {
    const a = makeIssue(11)
    const stranger = makeIssue(77)
    const fake = makeFake({issues: [a, stranger]})

    await expectBlocked(
      fake,
      {
        proposals: [a],
        rows: [agentRow(a), agentRow(stranger)],
        changed: {[docPath(11)]: DOC_BODY, [docPath(77)]: DOC_BODY},
      },
      /#77 is not in the digest/,
    )
  })

  it('rejects duplicate rows for one proposal', async () => {
    const a = makeIssue(11)
    const fake = makeFake({issues: [a]})

    await expectBlocked(
      fake,
      {proposals: [a], rows: [agentRow(a), agentRow(a)], changed: {[docPath(11)]: DOC_BODY}},
      /duplicate/,
    )
  })

  it('rejects schema-invalid rows (new-doc without evidence)', async () => {
    const a = makeIssue(11)
    const fake = makeFake({issues: [a]})

    await expectBlocked(
      fake,
      {proposals: [a], rows: [agentRow(a, {evidence: []})], changed: {[docPath(11)]: DOC_BODY}},
      /evidence/,
    )
  })

  it('rejects rows that are not valid JSON', async () => {
    const a = makeIssue(11)
    const fake = makeFake({issues: [a]})

    await expectBlocked(fake, {proposals: [a], rows: '{not json'}, /rows file/)
  })

  it.each([
    ['a workflow file', '.github/workflows/x.yaml'],
    ['a plan doc', 'docs/plans/x.md'],
    ['a solution without a category', 'docs/solutions/x.md'],
    ['a traversal path', 'docs/solutions/best-practices/../../../x.md'],
  ])('rejects a handoff path outside solutions: %s', async (_label: string, bad: string) => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {
        proposals: [issue],
        rows: [agentRow(issue)],
        changed: {[docPath(11)]: DOC_BODY},
        manifest: {changed: [docPath(11), bad], deleted: []},
      },
      /handoff/,
    )
  })

  it('rejects a handoff that deletes a file', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {
        proposals: [issue],
        rows: [agentRow(issue)],
        changed: {[docPath(11)]: DOC_BODY},
        manifest: {changed: [docPath(11)], deleted: ['docs/solutions/best-practices/old.md']},
      },
      /deletions/,
    )
  })

  it('rejects doc changes when the digest is empty', async () => {
    const fake = makeFake({issues: []})

    await expectBlocked(fake, {proposals: [], rows: [], changed: {[docPath(11)]: DOC_BODY}}, /no proposals/)
  })
})

describe('publishDraftedSolutions: trust re-established from the API (zero writes)', () => {
  it('rejects a digest proposal whose body changed since harvest', async () => {
    const issue = makeIssue(11, {body: 'Edited after harvest'})
    const fake = makeFake({issues: [issue]})

    await expectBlocked(
      fake,
      {
        proposals: [issue],
        digestBodyOverride: {11: 'Body at harvest time'},
        rows: [unverifiedRow(issue)],
      },
      /changed since harvest/,
    )
  })

  it('rejects a digest proposal that is not a learning proposal by the bot', async () => {
    const forged = makeIssue(11, {user: {login: 'mallory'}})
    const fake = makeFake({issues: [forged]})

    await expectBlocked(fake, {proposals: [forged], rows: [unverifiedRow(forged)]}, /not a learning-proposal/)
  })

  it('rejects a digest proposal that does not exist', async () => {
    const ghost = makeIssue(11)
    const fake = makeFake({issues: []})

    await expectBlocked(fake, {proposals: [ghost], rows: [unverifiedRow(ghost)]}, /could not be read/)
  })

  it('rejects an open PR on the drafted branch by another author', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull({user: {login: 'mallory'}})]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /not a fro-bot\[bot\] PR/,
    )
  })

  it('rejects an open PR whose block has a forged row naming a non-proposal issue', async () => {
    const issue = makeIssue(11)
    const stranger = makeIssue(77, {labels: [{name: 'bug'}]})
    const forgedRow: CoverageRow = {
      issue: 77,
      outcome: 'new-doc',
      targetDoc: docPath(77),
      sourceSha: SOURCE_SHA,
      evidence: [{kind: 'pr', ref: '#1'}],
      droppedClaims: [],
      bodyHash: hashProposalBody(stranger.body ?? ''),
      reason: '',
    }
    const fake = makeFake({issues: [issue, stranger], pulls: [makePull({body: renderPrBody([forgedRow])})]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /#77 does not name a learning-proposal/,
    )
  })

  it('rejects an open PR with no coverage block', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue], pulls: [makePull({body: 'hand-written'})]})

    await expectBlocked(
      fake,
      {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}},
      /missing/,
    )
  })
})

describe('publishDraftedSolutions: write targets', () => {
  it('never writes any ref other than the drafted branch (new PR, reset, and update flows)', async () => {
    const issue = makeIssue(11)
    const flows: Fake[] = []

    const fresh = makeFake({issues: [issue]})
    await run(fresh, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}})
    flows.push(fresh)

    const reset = makeFake({issues: [issue], branchExists: true})
    await run(reset, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}})
    flows.push(reset)

    const update = makeFake({issues: [issue], pulls: [makePull()]})
    await run(update, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}})
    flows.push(update)

    for (const fake of flows) {
      const refWrites = fake.calls
        .filter(call => call.op === 'git.createRef' || call.op === 'git.updateRef')
        .map(call => String(call.args.ref).replace(/^refs\//, ''))
      expect(refWrites.length).toBeGreaterThan(0)
      for (const ref of refWrites) expect(ref).toBe(BRANCH_REF)
      // main is read (to base the branch on) but never written.
      expect(refWrites.some(ref => ref.endsWith('/main') || ref.endsWith('/data'))).toBe(false)
    }
  })

  it('performs no write before validation completes (all gates precede the first write)', async () => {
    const issue = makeIssue(11)
    const fake = makeFake({issues: [issue]})

    await run(fake, {proposals: [issue], rows: [agentRow(issue)], changed: {[docPath(11)]: DOC_BODY}})

    const firstWrite = fake.calls.findIndex(call => WRITE_OPS.has(call.op))
    const lastRead = fake.calls.map(call => call.op).lastIndexOf('issues.get')
    expect(firstWrite).toBeGreaterThan(lastRead)
  })
})
