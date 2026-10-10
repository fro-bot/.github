import type {GitDataFake} from './git-data-fake.ts'
import {Buffer} from 'node:buffer'
import {describe, expect, expectTypeOf, it, vi, type Mock} from 'vitest'
import {parse, stringify} from 'yaml'
import {createGitDataFake} from './git-data-fake.ts'
import {
  assertChangePolicy,
  assertWritableBranch,
  RenameError,
  renameTrackedRepo,
  runCli,
  type GitDataClient,
  type RenameChange,
  type RenameDeps,
  type RenameOutcome,
  type RenameTransport,
} from './rename-tracked-repo.ts'
import {
  INDEX_PATH,
  LOG_HISTORY,
  LOG_PATH,
  MOTHERSHIP_PATH,
  NEW_PAGE_PATH,
  NEW_SLUG,
  NODE_ID,
  OLD_NAME,
  OLD_PAGE_PATH,
  OLD_SLUG,
  oldRepoPage,
  OWNER,
  README_BODY,
  README_PATH,
  snapshot,
  TOPIC_PATH,
  topicPage,
} from './repo-page-move-fixtures.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NEW_NAME = 'panthea'
const DATABASE_ID = 652_124_881
const REPOS_PATH = 'metadata/repos.yaml'
const TIMESTAMP = new Date('2026-10-10T12:34:56Z')

/** A private repo that still carries a real name, and a redacted private row. Neither may ever surface. */
const PRIVATE_NAME = 'secret-owner/secret-project'
const PRIVATE_NODE_ID = 'R_privateNode99'
const REDACTED_NODE_ID = 'R_redactedNode77'

/** Fragments that must never reach public output: private identifiers, paths and token material. */
const FORBIDDEN_IN_PUBLIC_OUTPUT = [
  'secret-owner',
  'secret-project',
  PRIVATE_NODE_ID,
  REDACTED_NODE_ID,
  'knowledge/wiki',
  'contents/',
  'ghs_writerTokenValue',
  'ghp_evidenceTokenValue',
]

type Row = Record<string, unknown>

function repoRow(overrides: Row = {}): Row {
  return {
    owner: OWNER,
    name: OLD_NAME,
    added: '2026-09-26',
    onboarding_status: 'onboarded',
    last_survey_at: '2026-09-27',
    last_survey_status: 'success',
    has_fro_bot_workflow: true,
    has_renovate: true,
    discovery_channel: 'collab',
    next_survey_eligible_at: '2026-10-27',
    private: false,
    node_id: NODE_ID,
    database_id: DATABASE_ID,
    ...overrides,
  }
}

function otherRows(): Row[] {
  return [
    repoRow({name: 'mothership', node_id: 'R_kgDOTOX0_A', database_id: 1}),
    repoRow({owner: 'secret-owner', name: 'secret-project', private: true, node_id: PRIVATE_NODE_ID, database_id: 2}),
    repoRow({owner: '[REDACTED]', name: REDACTED_NODE_ID, private: true, node_id: REDACTED_NODE_ID, database_id: 3}),
  ]
}

function reposYaml(rows: Row[]): string {
  return stringify({version: 1, repos: rows}, {indent: 2, lineWidth: 0, singleQuote: true})
}

function worldFiles(overrides: Record<string, string | null> = {}, rows: Row[] = [repoRow(), ...otherRows()]) {
  const files: Record<string, string> = {...snapshot(), [REPOS_PATH]: reposYaml(rows)}
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path]
    else files[path] = content
  }
  return files
}

function githubRepo(overrides: Row = {}): Row {
  return {id: DATABASE_ID, node_id: NODE_ID, name: NEW_NAME, owner: {login: OWNER}, private: false, ...overrides}
}

function httpError(status: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), {status})
}

interface TransportFake extends RenameTransport {
  readonly byId: Mock<(...args: unknown[]) => Promise<unknown>>
  readonly byName: Mock<(...args: unknown[]) => Promise<unknown>>
}

function transportFor(options: {byId?: () => Promise<unknown>; byName?: () => Promise<unknown>} = {}): TransportFake {
  const byId = vi.fn<(...args: unknown[]) => Promise<unknown>>(options.byId ?? (async () => githubRepo()))
  const byName = vi.fn<(...args: unknown[]) => Promise<unknown>>(options.byName ?? (async () => githubRepo()))
  return {
    byId,
    byName,
    getRepositoryById: async id => byId(id),
    getRepositoryByName: async (owner, name) => byName(owner, name),
  }
}

function depsFor(fake: GitDataFake, transport: RenameTransport, overrides: Partial<RenameDeps> = {}): RenameDeps {
  return {transport, writer: fake.client, nodeId: NODE_ID, now: () => TIMESTAMP, ...overrides}
}

async function rename(
  fake: GitDataFake,
  transport: RenameTransport = transportFor(),
  overrides: Partial<RenameDeps> = {},
): Promise<RenameOutcome> {
  return renameTrackedRepo(depsFor(fake, transport, overrides))
}

function repoRows(files: Record<string, string>): Row[] {
  const parsed: unknown = parse(files[REPOS_PATH] ?? '')
  return (parsed as {repos: Row[]}).repos
}

function writeCalls(fake: GitDataFake): string[] {
  return fake.calls
    .map(call => call.method)
    .filter(method => ['createBlob', 'createTree', 'createCommit', 'updateRef'].includes(method))
}

function expectNoWrite(fake: GitDataFake, headBefore: string): void {
  expect(writeCalls(fake)).toEqual([])
  expect(fake.head()).toBe(headBefore)
}

async function captureError(promise: Promise<unknown>): Promise<RenameError> {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof RenameError) return error
    throw error
  }
  throw new Error('expected a RenameError')
}

function expectPublicSafe(text: string): void {
  for (const fragment of FORBIDDEN_IN_PUBLIC_OUTPUT) expect(text).not.toContain(fragment)
}

function planWith(changes: readonly {op: string; path: string; content?: string}[]): RenameDeps['planMove'] {
  return () => ({outcome: 'moved', changes}) as ReturnType<NonNullable<RenameDeps['planMove']>>
}

function client(protectedBranch: boolean | undefined, protection?: {enabled: boolean}) {
  return {
    rest: {
      repos: {
        getBranch: vi.fn(async () => ({
          data: {protected: protectedBranch, protection, commit: {sha: 'abc', author: {login: 'fro-bot[bot]'}}},
        })),
      },
    },
  }
}

function cliDeps(fake: GitDataFake, transport: RenameTransport = transportFor()) {
  const stdout: string[] = []
  const stderr: string[] = []
  const createdTokens: string[] = []
  return {
    stdout,
    stderr,
    createdTokens,
    deps: {
      createTransport: (token: string) => {
        createdTokens.push(`evidence:${token}`)
        return transport
      },
      createWriter: (token: string) => {
        createdTokens.push(`writer:${token}`)
        return fake.client
      },
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      now: () => TIMESTAMP,
    },
  }
}

// ---------------------------------------------------------------------------
// The atomic commit
// ---------------------------------------------------------------------------

describe('renameTrackedRepo: the happy path', () => {
  it('lands one non-force commit with the renamed row, moved page, repaired links, rebuilt index and log entry', async () => {
    // #given a row that still holds the old name, and GitHub reporting the new one
    const fake = createGitDataFake({files: worldFiles()})
    const before = fake.head()

    // #when the operator rename runs
    const outcome = await rename(fake)

    // #then it is exactly one commit on top of the previous head
    expect(outcome).toMatchObject({result: 'renamed', page: 'moved', attempts: 1})
    expect(fake.parentsOf(fake.head())).toEqual([before])
    expect(writeCalls(fake).filter(method => method === 'updateRef')).toEqual(['updateRef'])
    expect(fake.calls.find(call => call.method === 'updateRef')?.args).toMatchObject({
      ref: 'heads/data',
      force: false,
    })

    // #and the row is renamed with every other field kept
    const files = fake.files()
    const rows = repoRows(files)
    expect(rows.find(row => row.node_id === NODE_ID)).toEqual(repoRow({name: NEW_NAME}))
    expect(rows.filter(row => row.node_id !== NODE_ID)).toEqual(otherRows())

    // #and the page moved, links and related repaired, index rebuilt, log appended
    expect(files[OLD_PAGE_PATH]).toBeUndefined()
    expect(files[NEW_PAGE_PATH]).toContain(`node_id: ${NODE_ID}`)
    expect(files[TOPIC_PATH]).toContain(`[[${NEW_SLUG}]]`)
    expect(files[TOPIC_PATH]).not.toContain(OLD_SLUG)
    expect(files[INDEX_PATH]).toContain(`- [[${NEW_SLUG}]] —`)
    expect(files[INDEX_PATH]).not.toContain(OLD_SLUG)
    expect(files[LOG_PATH]?.startsWith(LOG_HISTORY)).toBe(true)
    expect(files[LOG_PATH]).toContain('manual-edit | repo:marcusrbrown/panthea')
    expect(files[README_PATH]).toBe(README_BODY)
    expect(files[MOTHERSHIP_PATH]).toBe(snapshot()[MOTHERSHIP_PATH])
  })

  it('names only the public old and new names in the commit message', async () => {
    const fake = createGitDataFake({files: worldFiles()})

    await rename(fake)

    const message = fake.messageOf(fake.head())
    expect(message).toBe('chore(rename): marcusrbrown/panthe.ai -> marcusrbrown/panthea')
    expectPublicSafe(message)
    expect(message).not.toContain(NODE_ID)
  })

  it('writes the commit with an in-place edit when the slug does not change', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const transport = transportFor({byId: async () => githubRepo({name: 'panthe-ai'})})

    const outcome = await rename(fake, transport)

    expect(outcome).toMatchObject({result: 'renamed', page: 'edited-in-place'})
    const files = fake.files()
    expect(files[OLD_PAGE_PATH]).toContain('title: marcusrbrown/panthe-ai')
    expect(repoRows(files).find(row => row.node_id === NODE_ID)?.name).toBe('panthe-ai')
  })

  it('commits only the row when there is no page for the old name', async () => {
    const fake = createGitDataFake({files: worldFiles({[OLD_PAGE_PATH]: null})})
    const before = fake.files()

    const outcome = await rename(fake)

    expect(outcome).toMatchObject({result: 'renamed', page: 'metadata-only'})
    const after = fake.files()
    const changed = Object.keys({...before, ...after}).filter(path => before[path] !== after[path])
    expect(changed).toEqual([REPOS_PATH])
  })

  it('reads the whole data tree recursively, so collision and overwrite checks see nested pages', async () => {
    const fake = createGitDataFake({files: worldFiles()})

    await rename(fake)

    const reads = fake.calls.filter(call => call.method === 'getTree')
    expect(reads).toHaveLength(1)
    expect(reads[0]?.args).toMatchObject({recursive: 'true'})
  })

  it('only ever sends a non-force ref update, and the seam cannot express a forced one', async () => {
    const fake = createGitDataFake({files: worldFiles()})

    await rename(fake)

    expect(fake.calls.filter(call => call.method === 'updateRef').map(call => call.args.force)).toEqual([false])
    type UpdateRefParams = Parameters<GitDataClient['rest']['git']['updateRef']>[0]
    expectTypeOf<UpdateRefParams['force']>().toEqualTypeOf<false | undefined>()
  })

  it('reads the data tree at the head sha it will build on, and builds the tree on that base', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const before = fake.head()

    await rename(fake)

    const createTree = fake.calls.find(call => call.method === 'createTree')
    expect(createTree?.args.base_tree).toBeDefined()
    const getCommit = fake.calls.find(call => call.method === 'getCommit')
    expect(getCommit?.args.commit_sha).toBe(before)
  })
})

describe('renameTrackedRepo: residue (the row already holds the new name)', () => {
  const residueFiles = () => worldFiles({}, [repoRow({name: NEW_NAME}), ...otherRows()])

  it('moves the page and leaves the row bytes unchanged when old_name is given and proven', async () => {
    const fake = createGitDataFake({files: residueFiles()})
    const reposBefore = fake.files()[REPOS_PATH]

    const outcome = await rename(fake, transportFor(), {oldName: `${OWNER}/${OLD_NAME}`})

    expect(outcome).toMatchObject({result: 'renamed', page: 'moved'})
    expect(fake.files()[REPOS_PATH]).toBe(reposBefore)
    expect(fake.files()[NEW_PAGE_PATH]).toBeDefined()
    expect(fake.files()[OLD_PAGE_PATH]).toBeUndefined()
  })

  it('asks GitHub whether the old name redirects to the same node', async () => {
    const fake = createGitDataFake({files: residueFiles()})
    const transport = transportFor()

    await rename(fake, transport, {oldName: `${OWNER}/${OLD_NAME}`})

    expect(transport.byName).toHaveBeenCalledWith(OWNER, OLD_NAME)
  })

  it('blocks without old_name', async () => {
    const fake = createGitDataFake({files: residueFiles()})
    const before = fake.head()

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'blocked', reason: 'old-name-required'})
    expectNoWrite(fake, before)
  })

  it('blocks when the old name now belongs to another repository', async () => {
    const fake = createGitDataFake({files: residueFiles()})
    const before = fake.head()
    const transport = transportFor({byName: async () => githubRepo({node_id: 'R_reusedByAnother', name: OLD_NAME})})

    const outcome = await rename(fake, transport, {oldName: `${OWNER}/${OLD_NAME}`})

    expect(outcome).toEqual({result: 'blocked', reason: 'old-name-reused'})
    expectNoWrite(fake, before)
  })

  it('blocks when the old name resolves to nothing (404) or does not redirect to the new name', async () => {
    for (const byName of [
      async () => {
        throw httpError(404)
      },
      async () => githubRepo({name: 'something-else'}),
    ]) {
      const fake = createGitDataFake({files: residueFiles()})
      const before = fake.head()

      const outcome = await rename(fake, transportFor({byName}), {oldName: `${OWNER}/${OLD_NAME}`})

      expect(outcome).toEqual({result: 'blocked', reason: 'old-name-unverifiable'})
      expectNoWrite(fake, before)
    }
  })

  it('blocks when the old page does not carry the exact old URL in its structured sources', async () => {
    const page = oldRepoPage({nodeId: NODE_ID, sourceUrls: ['https://github.com/someone/else']})
    const fake = createGitDataFake({files: {...residueFiles(), [OLD_PAGE_PATH]: page}})
    const before = fake.head()

    const outcome = await rename(fake, transportFor(), {oldName: `${OWNER}/${OLD_NAME}`})

    expect(outcome).toEqual({result: 'blocked', reason: 'residue-unproven'})
    expectNoWrite(fake, before)
  })

  it('blocks an old_name under another owner or equal to the current name', async () => {
    for (const oldName of ['someone-else/panthe.ai', `${OWNER}/${NEW_NAME}`]) {
      const fake = createGitDataFake({files: residueFiles()})
      const before = fake.head()

      const outcome = await rename(fake, transportFor(), {oldName})

      expect(outcome).toEqual({result: 'blocked', reason: 'old-name-mismatch'})
      expectNoWrite(fake, before)
    }
  })

  it('rejects an old_name that disagrees with the row when the row still holds the old name', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const before = fake.head()

    const outcome = await rename(fake, transportFor(), {oldName: `${OWNER}/something-else`})

    expect(outcome).toEqual({result: 'blocked', reason: 'old-name-mismatch'})
    expectNoWrite(fake, before)
  })
})

describe('renameTrackedRepo: already applied and named blocks', () => {
  const appliedFiles = () => {
    const page = oldRepoPage({nodeId: NODE_ID}).replaceAll('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    return worldFiles({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: page}, [repoRow({name: NEW_NAME}), ...otherRows()])
  }

  it('is a noop, with no commit, when the row and the page both carry the new name', async () => {
    const fake = createGitDataFake({files: appliedFiles()})
    const before = fake.head()

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'noop'})
    expectNoWrite(fake, before)
  })

  it('is not a noop while a page for this node still sits at the old slug', async () => {
    const files = appliedFiles()
    files[OLD_PAGE_PATH] = oldRepoPage({nodeId: NODE_ID})
    const fake = createGitDataFake({files})
    const before = fake.head()

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'blocked', reason: 'both-pages-present'})
    expectNoWrite(fake, before)
  })

  it('names an ID-less old-slug page as stray when old_name ties it to the old URL', async () => {
    const files = appliedFiles()
    files[OLD_PAGE_PATH] = oldRepoPage()
    const fake = createGitDataFake({files})
    const before = fake.head()

    const outcome = await rename(fake, transportFor(), {oldName: `${OWNER}/${OLD_NAME}`})

    expect(outcome).toEqual({result: 'blocked', reason: 'both-pages-present'})
    expectNoWrite(fake, before)
  })

  describe('a same-slug rename whose row was renamed but whose page keeps its old frontmatter', () => {
    const SAME_SLUG_NAME = 'panthe-ai'
    const residueFiles = () =>
      worldFiles({[OLD_PAGE_PATH]: oldRepoPage({nodeId: NODE_ID})}, [repoRow({name: SAME_SLUG_NAME}), ...otherRows()])
    const sameSlugTransport = () =>
      transportFor({
        byId: async () => githubRepo({name: SAME_SLUG_NAME}),
        byName: async () => githubRepo({name: SAME_SLUG_NAME}),
      })
    const oldName = `${OWNER}/${OLD_NAME}`

    it('repairs the page in place instead of reporting noop, then is a noop on a rerun', async () => {
      const fake = createGitDataFake({files: residueFiles()})

      const first = await rename(fake, sameSlugTransport(), {oldName})

      expect(first).toMatchObject({result: 'renamed', page: 'edited-in-place'})
      const page = fake.files()[OLD_PAGE_PATH] ?? ''
      expect(page).toContain(`title: ${OWNER}/${SAME_SLUG_NAME}`)
      expect(page).toContain(`https://github.com/${OWNER}/${SAME_SLUG_NAME}`)
      expect(page).toContain(`node_id: ${NODE_ID}`)
      // The row already held the new name, so the commit touches no row.
      expect(repoRows(fake.files()).find(row => row.node_id === NODE_ID)?.name).toBe(SAME_SLUG_NAME)

      const head = fake.head()
      const second = await rename(fake, sameSlugTransport(), {oldName})

      expect(second).toEqual({result: 'noop'})
      expect(fake.head()).toBe(head)
    })

    it('does not guess without old_name: the page cannot be shown to be current', async () => {
      const fake = createGitDataFake({files: residueFiles()})
      const before = fake.head()

      const outcome = await rename(fake, sameSlugTransport())

      expect(outcome).toEqual({result: 'blocked', reason: 'old-name-required'})
      expectNoWrite(fake, before)
    })

    it('stays a noop when the page already reflects the rename', async () => {
      const fake = createGitDataFake({files: residueFiles()})
      await rename(fake, sameSlugTransport(), {oldName})
      const head = fake.head()

      const outcome = await rename(fake, sameSlugTransport())

      expect(outcome).toEqual({result: 'noop'})
      expect(fake.head()).toBe(head)
    })
  })

  it('treats an unparseable page at the old slug as stray when old_name names it', async () => {
    const files = appliedFiles()
    files[OLD_PAGE_PATH] = 'not a wiki page: no frontmatter\n'
    const fake = createGitDataFake({files})
    const before = fake.head()

    const outcome = await rename(fake, transportFor(), {oldName: `${OWNER}/${OLD_NAME}`})

    expect(outcome).toEqual({result: 'blocked', reason: 'both-pages-present'})
    expectNoWrite(fake, before)
  })

  it('does not count an unparseable page elsewhere as stray', async () => {
    const files = appliedFiles()
    files['knowledge/wiki/repos/someone--else.md'] = 'not a wiki page: no frontmatter\n'
    const fake = createGitDataFake({files})
    const before = fake.head()

    const outcome = await rename(fake, transportFor(), {oldName: `${OWNER}/${OLD_NAME}`})

    expect(outcome).toEqual({result: 'noop'})
    expectNoWrite(fake, before)
  })

  it('stays a noop when the only other repo pages belong to other nodes', async () => {
    const files = appliedFiles()
    files['knowledge/wiki/repos/someone--else.md'] = oldRepoPage({
      nodeId: 'R_other',
      sourceUrls: ['https://github.com/someone/else'],
    })
    const fake = createGitDataFake({files})
    const before = fake.head()

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'noop'})
    expectNoWrite(fake, before)
  })

  it('blocks as both-pages-present when pages exist at the old and the new slug', async () => {
    const target = oldRepoPage({nodeId: NODE_ID}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    const fake = createGitDataFake({files: worldFiles({[NEW_PAGE_PATH]: target})})
    const before = fake.head()

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'blocked', reason: 'both-pages-present'})
    expectNoWrite(fake, before)
  })

  it('blocks as page-ahead-of-row when the row holds the old name but a page already sits at the new slug', async () => {
    const target = oldRepoPage({nodeId: NODE_ID}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    const fake = createGitDataFake({files: worldFiles({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: target})})
    const before = fake.head()

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'blocked', reason: 'page-ahead-of-row'})
    expectNoWrite(fake, before)
  })

  it('passes slug, private-name and page blocks through unchanged', async () => {
    const collision = createGitDataFake({
      files: worldFiles({}, [
        repoRow(),
        ...otherRows(),
        repoRow({name: 'PANTHEA', node_id: 'R_other', database_id: 9}),
      ]),
    })
    expect(await rename(collision)).toEqual({result: 'blocked', reason: 'slug-collision'})

    const privateCollision = createGitDataFake({
      files: worldFiles({}, [
        repoRow(),
        repoRow({owner: OWNER, name: NEW_NAME, private: true, node_id: PRIVATE_NODE_ID, database_id: 2}),
      ]),
    })
    expect(await rename(privateCollision)).toEqual({result: 'blocked', reason: 'slug-collision'})

    const unattributed = createGitDataFake({
      files: worldFiles({[OLD_PAGE_PATH]: oldRepoPage({sourceUrls: ['https://github.com/someone/else']})}),
    })
    expect(await rename(unattributed)).toEqual({result: 'blocked', reason: 'old-page-not-attributed'})
  })

  it('blocks a new name whose slug equals a private row that still carries a real name', async () => {
    const files = worldFiles({}, [
      repoRow(),
      repoRow({owner: OWNER, name: 'Pan.thea', private: true, node_id: PRIVATE_NODE_ID, database_id: 2}),
    ])
    const fake = createGitDataFake({files})
    const before = fake.head()
    const transport = transportFor({byId: async () => githubRepo({name: 'pan-thea'})})

    const outcome = await rename(fake, transport)

    expect(outcome).toEqual({result: 'blocked', reason: 'slug-collision'})
    expectNoWrite(fake, before)
  })
})

describe('renameTrackedRepo: evidence from GitHub', () => {
  const blockedCases: [string, () => Promise<unknown>, string][] = [
    ['a different node id', async () => githubRepo({node_id: 'R_someoneElse'}), 'node-mismatch'],
    ['a different owner', async () => githubRepo({owner: {login: 'someone-else'}}), 'owner-mismatch'],
    ['a private repository', async () => githubRepo({private: true}), 'repository-private'],
    ['a missing private flag', async () => githubRepo({private: undefined}), 'evidence-malformed'],
    ['a non-string name', async () => githubRepo({name: ['panthea']}), 'evidence-malformed'],
    ['an invalid name', async () => githubRepo({name: '../etc'}), 'evidence-malformed'],
    ['an empty name', async () => githubRepo({name: ''}), 'evidence-malformed'],
    ['a missing owner', async () => githubRepo({owner: null}), 'evidence-malformed'],
    ['a non-object body', async () => 'oops', 'evidence-malformed'],
  ]

  it.each(blockedCases)('blocks and writes nothing for %s', async (_label, byId, reason) => {
    const fake = createGitDataFake({files: worldFiles()})
    const before = fake.head()

    const outcome = await rename(fake, transportFor({byId}))

    expect(outcome).toEqual({result: 'blocked', reason})
    expectNoWrite(fake, before)
  })

  it('looks the repository up by the row database_id, never by name', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const transport = transportFor()

    await rename(fake, transport)

    expect(transport.byId).toHaveBeenCalledWith(DATABASE_ID)
    expect(transport.byName).not.toHaveBeenCalled()
  })

  it('treats the new name as GitHub reports it, never as an operator input', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const transport = transportFor({byId: async () => githubRepo({name: 'Panthea-Renamed'})})

    await rename(fake, transport)

    expect(repoRows(fake.files()).find(row => row.node_id === NODE_ID)?.name).toBe('Panthea-Renamed')
  })

  it('blocks when the row is missing, private, redacted or lacks a database_id', async () => {
    const cases: [Row[], string][] = [
      [otherRows(), 'row-not-found'],
      [[repoRow({private: true}), ...otherRows()], 'row-not-public'],
      [[repoRow({private: undefined}), ...otherRows()], 'row-not-public'],
      [[repoRow({owner: '[REDACTED]', name: NODE_ID}), ...otherRows()], 'row-not-public'],
      [[repoRow({database_id: undefined}), ...otherRows()], 'row-missing-database-id'],
    ]
    for (const [rows, reason] of cases) {
      const fake = createGitDataFake({files: worldFiles({}, rows)})
      const before = fake.head()

      expect(await rename(fake)).toEqual({result: 'blocked', reason})
      expectNoWrite(fake, before)
    }
  })

  it('reports an evidence transport failure as a status-only error and writes nothing', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const before = fake.head()
    const transport = transportFor({
      byId: async () => {
        throw httpError(500, `boom for ${PRIVATE_NAME} ${PRIVATE_NODE_ID} ghp_evidenceTokenValue`)
      },
    })

    const error = await captureError(rename(fake, transport))

    expect(error).toMatchObject({code: 'EVIDENCE_FAILED', phase: 'evidence', status: 500})
    expect(error.message).toBe('rename-tracked-repo: EVIDENCE_FAILED (phase=evidence, status=500)')
    expectPublicSafe(error.message)
    expectNoWrite(fake, before)
  })

  it('does not call GitHub for the old name when the row holds the old name', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const transport = transportFor()

    await rename(fake, transport)

    expect(transport.byName).not.toHaveBeenCalled()
  })
})

describe('renameTrackedRepo: rebuilding from head', () => {
  it('rebuilds on a 422 from updateRef and keeps the concurrent change', async () => {
    // #given the branch moves between the read and the write
    const fake = createGitDataFake({files: worldFiles()})
    fake.beforeUpdateRef(1, () => {
      fake.advance({
        'knowledge/wiki/topics/concurrent.md':
          '---\ntype: topic\ntitle: Concurrent\ncreated: 2026-10-10\nupdated: 2026-10-10\n---\n\nNew page.\n',
      })
    })

    // #when the rename runs
    const outcome = await rename(fake)

    // #then it rebuilt once, on top of the concurrent commit, and kept that commit's work
    expect(outcome).toMatchObject({result: 'renamed', attempts: 2})
    expect(fake.files()['knowledge/wiki/topics/concurrent.md']).toContain('Concurrent')
    expect(fake.files()[NEW_PAGE_PATH]).toBeDefined()
    expect(fake.calls.filter(call => call.method === 'updateRef')).toHaveLength(2)
    expect(fake.calls.filter(call => call.method === 'getRef')).toHaveLength(2)
  })

  it('preserves a concurrent change to the same file (the log) by rebuilding rather than replaying', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const concurrentEntry = `${LOG_HISTORY}\n## [2026-10-10 12:00] ingest | marcusrbrown/mothership\n\nConcurrent survey.\n\nSources: none\n`
    fake.beforeUpdateRef(1, () => {
      fake.advance({[LOG_PATH]: concurrentEntry})
    })

    await rename(fake)

    const log = fake.files()[LOG_PATH] ?? ''
    expect(log.startsWith(concurrentEntry)).toBe(true)
    expect(log).toContain('manual-edit | repo:marcusrbrown/panthea')
  })

  it('re-reads the row on each attempt and renames the fresh copy', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.beforeUpdateRef(1, () => {
      const rows = repoRows(fake.files()).map(row => (row.node_id === NODE_ID ? {...row, has_renovate: false} : row))
      fake.advance({[REPOS_PATH]: reposYaml(rows)})
    })

    await rename(fake)

    const renamed = repoRows(fake.files()).find(row => row.node_id === NODE_ID)
    expect(renamed).toMatchObject({name: NEW_NAME, has_renovate: false})
  })

  it('retries an updateRef 409 the same way', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.failNext('updateRef', 409)

    const outcome = await rename(fake)

    expect(outcome).toMatchObject({result: 'renamed', attempts: 2})
  })

  it('stops after three attempts and throws a status-only error, leaving the rename unapplied', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    for (const attempt of [1, 2, 3]) {
      fake.beforeUpdateRef(attempt, () => {
        fake.advance({
          [`knowledge/wiki/topics/race-${attempt}.md`]:
            '---\ntype: topic\ntitle: R\ncreated: 2026-10-10\nupdated: 2026-10-10\n---\n\nR.\n',
        })
      })
    }

    const error = await captureError(rename(fake))

    expect(error).toMatchObject({code: 'RETRIES_EXHAUSTED', phase: 'updateRef', status: 422})
    expect(error.message).toBe('rename-tracked-repo: RETRIES_EXHAUSTED (phase=updateRef, status=422)')
    expect(fake.calls.filter(call => call.method === 'updateRef')).toHaveLength(3)
    expect(fake.files()[OLD_PAGE_PATH]).toBeDefined()
    expect(fake.files()[NEW_PAGE_PATH]).toBeUndefined()
  })

  it('does not retry any other updateRef failure', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.failNext('updateRef', 500, `server error ${PRIVATE_NAME}`)

    const error = await captureError(rename(fake))

    expect(error).toMatchObject({code: 'REF_UPDATE_FAILED', phase: 'updateRef', status: 500})
    expect(fake.calls.filter(call => call.method === 'updateRef')).toHaveLength(1)
    expectPublicSafe(error.message)
  })

  it('blocks instead of renaming when the row changed to an unexpected name between reads', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.beforeUpdateRef(1, () => {
      const rows = repoRows(fake.files()).map(row =>
        row.node_id === NODE_ID ? {...row, name: 'someone-renamed-it'} : row,
      )
      fake.advance({[REPOS_PATH]: reposYaml(rows)})
    })

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'blocked', reason: 'row-name-unexpected'})
    expect(fake.files()[NEW_PAGE_PATH]).toBeUndefined()
  })

  it('becomes a noop when a concurrent writer already applied the same rename', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.beforeUpdateRef(1, () => {
      const rows = repoRows(fake.files()).map(row => (row.node_id === NODE_ID ? {...row, name: NEW_NAME} : row))
      const page = oldRepoPage({nodeId: NODE_ID}).replaceAll('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
      fake.advance({[REPOS_PATH]: reposYaml(rows), [OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: page})
    })

    const outcome = await rename(fake)

    expect(outcome).toEqual({result: 'noop'})
  })
})

describe('renameTrackedRepo: terminal failures write nothing more', () => {
  it('throws on a truncated tree and writes nothing', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.truncate(true)
    const before = fake.head()

    const error = await captureError(rename(fake))

    expect(error).toMatchObject({code: 'TREE_TRUNCATED', phase: 'readTree'})
    expectNoWrite(fake, before)
  })

  it('treats a createTree 422 as terminal on the first attempt', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.failNext('createTree', 422, `Invalid tree ${PRIVATE_NAME}`)

    const error = await captureError(rename(fake))

    expect(error).toMatchObject({code: 'TREE_INVALID', phase: 'createTree', status: 422})
    expect(fake.calls.filter(call => call.method === 'createTree')).toHaveLength(1)
    expect(fake.calls.filter(call => call.method === 'updateRef')).toHaveLength(0)
    expectPublicSafe(error.message)
  })

  it.each([
    ['createBlob', 'BLOB_FAILED'],
    ['createCommit', 'COMMIT_FAILED'],
    ['getTree', 'READ_FAILED'],
    ['getBlob', 'READ_FAILED'],
    ['getRef', 'READ_FAILED'],
    ['getCommit', 'READ_FAILED'],
  ])('wraps a %s failure as %s with the phase and status only', async (method, code) => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.failNext(
      method,
      503,
      `down: ${PRIVATE_NAME} ${PRIVATE_NODE_ID} knowledge/wiki/repos/x.md contents/y ghs_writerTokenValue`,
    )
    const before = fake.head()

    const error = await captureError(rename(fake))

    expect(error.code).toBe(code)
    expect(error.status).toBe(503)
    expect(error.message).toBe(`rename-tracked-repo: ${code} (phase=${error.phase}, status=503)`)
    expect('cause' in error).toBe(false)
    expectPublicSafe(error.message)
    expect(fake.head()).toBe(before)
  })

  it('refuses to build on a tip commit authored by someone else', async () => {
    const fake = createGitDataFake({files: worldFiles(), authorLogin: 'mallory'})
    const before = fake.head()

    const error = await captureError(rename(fake))

    expect(error).toMatchObject({code: 'INTEGRITY_FAILED', phase: 'integrity'})
    expectNoWrite(fake, before)
    expect(error.message).not.toContain('mallory')
  })

  it.each(['fro-bot', 'fro-bot[bot]'])('builds on a tip authored by %s', async login => {
    const fake = createGitDataFake({files: worldFiles(), authorLogin: login})

    expect((await rename(fake)).result).toBe('renamed')
  })
})

describe('renameTrackedRepo: path and overwrite policy before createTree', () => {
  it('throws before createTree when a change touches README.md', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const before = fake.head()

    const error = await captureError(
      rename(fake, transportFor(), {
        planMove: planWith([{op: 'repair-links', path: README_PATH, content: 'changed'}]),
      }),
    )

    expect(error).toMatchObject({code: 'PATH_POLICY', phase: 'policy'})
    expect(fake.calls.map(call => call.method)).not.toContain('createTree')
    expectNoWrite(fake, before)
  })

  it('throws before createTree when a change deletes a path outside knowledge/wiki/repos/', async () => {
    const fake = createGitDataFake({files: worldFiles()})

    const error = await captureError(
      rename(fake, transportFor(), {planMove: planWith([{op: 'delete-page', path: TOPIC_PATH}])}),
    )

    expect(error).toMatchObject({code: 'PATH_POLICY'})
    expect(fake.calls.map(call => call.method)).not.toContain('createTree')
  })

  it('throws before createTree when a create would overwrite an existing page', async () => {
    const fake = createGitDataFake({files: worldFiles()})

    const error = await captureError(
      rename(fake, transportFor(), {planMove: planWith([{op: 'create-page', path: MOTHERSHIP_PATH, content: 'x'}])}),
    )

    expect(error).toMatchObject({code: 'OVERWRITE'})
    expect(fake.calls.map(call => call.method)).not.toContain('createTree')
  })
})

describe('assertChangePolicy', () => {
  const head = (files: Record<string, string> = snapshot()) => ({
    files,
    paths: new Set(Object.keys(files)),
  })
  const context = (files: Record<string, string> = snapshot()) => ({
    ...head(files),
    nodeId: NODE_ID,
    oldSlug: OLD_SLUG,
    oldUrl: 'https://github.com/marcusrbrown/panthe.ai',
  })

  it('accepts the changes of a normal move', () => {
    expect(() =>
      assertChangePolicy(
        [
          {op: 'create-page', path: NEW_PAGE_PATH, content: 'new'},
          {op: 'delete-page', path: OLD_PAGE_PATH},
          {op: 'repair-links', path: TOPIC_PATH, content: topicPage().replace(OLD_SLUG, NEW_SLUG)},
          {op: 'write-index', path: INDEX_PATH, content: 'index'},
          {op: 'append-log', path: LOG_PATH, content: `${LOG_HISTORY}\nentry\n`},
        ],
        context(),
      ),
    ).not.toThrow()
  })

  it.each([
    ['README.md', {op: 'repair-links', path: README_PATH, content: 'x'}, 'PATH_POLICY'],
    ['a path outside the wiki', {op: 'repair-links', path: 'metadata/allowlist.yaml', content: 'x'}, 'PATH_POLICY'],
    ['a workflow file', {op: 'create-page', path: '.github/workflows/x.yaml', content: 'x'}, 'PATH_POLICY'],
    ['a nested path', {op: 'create-page', path: 'knowledge/wiki/repos/a/b.md', content: 'x'}, 'PATH_POLICY'],
    ['a traversal path', {op: 'create-page', path: 'knowledge/wiki/repos/../../x.md', content: 'x'}, 'PATH_POLICY'],
    ['a delete outside repos/', {op: 'delete-page', path: TOPIC_PATH}, 'PATH_POLICY'],
    ['a delete of an absent path', {op: 'delete-page', path: 'knowledge/wiki/repos/ghost.md'}, 'PATH_POLICY'],
    ['a create over an existing page', {op: 'create-page', path: MOTHERSHIP_PATH, content: 'x'}, 'OVERWRITE'],
    ['an index write somewhere else', {op: 'write-index', path: 'knowledge/other.md', content: 'x'}, 'PATH_POLICY'],
    ['a log write somewhere else', {op: 'append-log', path: 'knowledge/other.md', content: 'x'}, 'PATH_POLICY'],
    ['a log rewrite instead of an append', {op: 'append-log', path: LOG_PATH, content: 'rewritten'}, 'PATH_POLICY'],
    [
      'a link repair of a page with no reference',
      {op: 'repair-links', path: MOTHERSHIP_PATH, content: 'x'},
      'PATH_POLICY',
    ],
    [
      'a link repair of an absent page',
      {op: 'repair-links', path: 'knowledge/wiki/topics/ghost.md', content: 'x'},
      'PATH_POLICY',
    ],
    [
      'an in-place edit of an absent page',
      {op: 'edit-page', path: 'knowledge/wiki/repos/ghost.md', content: 'x'},
      'PATH_POLICY',
    ],
  ] as const)('rejects %s', (_label, change, code) => {
    expect(() => assertChangePolicy([change], context())).toThrow(RenameError)
    try {
      assertChangePolicy([change], context())
    } catch (error: unknown) {
      expect(error).toMatchObject({code, phase: 'policy'})
    }
  })

  it('fails closed on an op the policy does not know, rather than letting it through', () => {
    // The union is closed at compile time; this is the runtime backstop if a new op is added to the
    // planner without a policy rule. The cast is the only way to hand the policy an op it lacks.
    const unknown = {op: 'chmod-page', path: NEW_PAGE_PATH, content: 'x'} as unknown as RenameChange

    expect(() => assertChangePolicy([unknown], context())).toThrow(RenameError)
    try {
      assertChangePolicy([unknown], context())
    } catch (error: unknown) {
      expect(error).toMatchObject({code: 'PATH_POLICY', phase: 'policy'})
    }
  })

  it('rejects an in-place edit of a page that belongs to another node', () => {
    const files = {...snapshot(), [OLD_PAGE_PATH]: oldRepoPage({nodeId: 'R_someoneElse'})}

    expect(() => assertChangePolicy([{op: 'edit-page', path: OLD_PAGE_PATH, content: 'x'}], context(files))).toThrow(
      RenameError,
    )
  })

  it('accepts an in-place edit of a page with this node id, or a legacy page that names the old URL', () => {
    for (const nodeId of [NODE_ID, null]) {
      const files = {...snapshot(), [OLD_PAGE_PATH]: oldRepoPage({nodeId})}

      expect(() =>
        assertChangePolicy([{op: 'edit-page', path: OLD_PAGE_PATH, content: 'x'}], context(files)),
      ).not.toThrow()
    }
  })

  it('rejects an in-place edit of a legacy page whose sources name another repository', () => {
    const files = {...snapshot(), [OLD_PAGE_PATH]: oldRepoPage({nodeId: null, sourceUrls: ['https://github.com/a/b']})}

    expect(() => assertChangePolicy([{op: 'edit-page', path: OLD_PAGE_PATH, content: 'x'}], context(files))).toThrow(
      RenameError,
    )
  })

  it('applies the policy to the row file too: it must exist and be edited, never created or deleted', () => {
    const files = {...snapshot(), [REPOS_PATH]: 'version: 1\nrepos: []\n'}
    expect(() => assertChangePolicy([{op: 'write-row', path: REPOS_PATH, content: 'x'}], context(files))).not.toThrow()
    expect(() => assertChangePolicy([{op: 'write-row', path: REPOS_PATH, content: 'x'}], context())).toThrow(
      RenameError,
    )
    expect(() =>
      assertChangePolicy([{op: 'write-row', path: 'metadata/allowlist.yaml', content: 'x'}], context(files)),
    ).toThrow(RenameError)
  })
})

describe('assertWritableBranch', () => {
  it('refuses main without asking GitHub', async () => {
    const writer = client(false)

    await expect(assertWritableBranch(writer, 'fro-bot', '.github', 'main')).rejects.toMatchObject({
      code: 'PROTECTED_BRANCH',
    })
    expect(writer.rest.repos.getBranch).not.toHaveBeenCalled()
  })

  it('refuses a protected branch other than the canonical fro-bot/.github data branch', async () => {
    for (const [owner, repo, branch] of [
      ['fro-bot', '.github', 'staging'],
      ['someone', '.github', 'data'],
      ['fro-bot', 'other', 'data'],
    ] as const) {
      await expect(assertWritableBranch(client(true), owner, repo, branch)).rejects.toMatchObject({
        code: 'PROTECTED_BRANCH',
      })
      await expect(assertWritableBranch(client(false, {enabled: true}), owner, repo, branch)).rejects.toMatchObject({
        code: 'PROTECTED_BRANCH',
      })
    }
  })

  it('allows the canonical data branch even though its ruleset reports it as protected', async () => {
    await expect(assertWritableBranch(client(true), 'fro-bot', '.github', 'data')).resolves.toBeUndefined()
    await expect(
      assertWritableBranch(client(false, {enabled: true}), 'fro-bot', '.github', 'data'),
    ).resolves.toBeUndefined()
  })

  it('allows an unprotected branch', async () => {
    await expect(assertWritableBranch(client(false), 'fro-bot', '.github', 'staging')).resolves.toBeUndefined()
    await expect(assertWritableBranch(client(undefined), 'fro-bot', '.github', 'staging')).resolves.toBeUndefined()
  })

  it('the rename writer targets only fro-bot/.github@data', async () => {
    const fake = createGitDataFake({files: worldFiles()})

    await rename(fake)

    const targets = new Set(
      fake.calls.map(
        call =>
          `${String(call.args.owner)}/${String(call.args.repo)}@${String(call.args.branch ?? call.args.ref ?? '')}`,
      ),
    )
    for (const target of targets) expect(target).toMatch(/^fro-bot\/\.github@(?:data|heads\/data)?$/u)
    expect(fake.calls.some(call => call.method === 'getBranch' && call.args.branch === 'data')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

describe('runCli', () => {
  const goodEnv = {
    NODE_ID,
    OLD_NAME: '',
    GITHUB_TOKEN: 'ghp_evidenceTokenValue',
    RENAME_WRITER_TOKEN: 'ghs_writerTokenValue',
  }

  it('renames and prints a result line, with exit 0', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const cli = cliDeps(fake)

    const code = await runCli(goodEnv, cli.deps)

    expect(code).toBe(0)
    const line: unknown = JSON.parse(cli.stdout.join(''))
    expect(line).toMatchObject({result: 'renamed', page: 'moved', attempts: 1})
    expect(cli.createdTokens).toEqual(['evidence:ghp_evidenceTokenValue', 'writer:ghs_writerTokenValue'])
    expect(cli.stderr).toEqual([])
  })

  it('prints {"result":"noop"} with exit 0 when already applied', async () => {
    const page = oldRepoPage({nodeId: NODE_ID}).replaceAll('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    const fake = createGitDataFake({
      files: worldFiles({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: page}, [repoRow({name: NEW_NAME}), ...otherRows()]),
    })
    const cli = cliDeps(fake)

    const code = await runCli(goodEnv, cli.deps)

    expect(code).toBe(0)
    expect(cli.stdout.join('')).toBe('{"result":"noop"}\n')
  })

  it.each([
    ['both-pages-present', /remove one of the two pages by hand/u],
    ['page-ahead-of-row', /rename the row by hand/u],
  ])('exits non-zero with the named reason %s and a pointer to the manual step', async (reason, hint) => {
    const target = oldRepoPage({nodeId: NODE_ID}).replace('marcusrbrown/panthe.ai', 'marcusrbrown/panthea')
    const files =
      reason === 'both-pages-present'
        ? worldFiles({[NEW_PAGE_PATH]: target})
        : worldFiles({[OLD_PAGE_PATH]: null, [NEW_PAGE_PATH]: target})
    const cli = cliDeps(createGitDataFake({files}))

    const code = await runCli(goodEnv, cli.deps)

    expect(code).toBe(1)
    const output = cli.stderr.join('')
    expect(output).toContain(`reason=${reason}`)
    expect(output).toMatch(hint)
    expect(output).toContain('metadata/README.md')
    expect(cli.stdout).toEqual([])
    expectPublicSafe(output)
  })

  it('exits non-zero with a status-only message on an operational failure', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    fake.failNext('createTree', 422, `bad ${PRIVATE_NAME}`)
    const cli = cliDeps(fake)

    const code = await runCli(goodEnv, cli.deps)

    expect(code).toBe(1)
    expect(cli.stderr.join('')).toBe('::error::rename-tracked-repo: TREE_INVALID (phase=createTree, status=422)\n')
    expectPublicSafe(cli.stderr.join(''))
  })

  it('does not report an unexpected non-RenameError beyond a fixed line', async () => {
    const transport = transportFor({
      byId: async () => {
        throw new TypeError(`secret ${PRIVATE_NAME}`)
      },
    })
    const cli = cliDeps(createGitDataFake({files: worldFiles()}), transport)

    const code = await runCli(goodEnv, cli.deps)

    expect(code).toBe(1)
    expect(cli.stderr.join('')).toBe('::error::rename-tracked-repo: EVIDENCE_FAILED (phase=evidence)\n')
  })

  it.each([
    ['a missing node id', {...goodEnv, NODE_ID: undefined}],
    ['an empty node id', {...goodEnv, NODE_ID: ''}],
    ['a node id with a slash', {...goodEnv, NODE_ID: 'R_abc/def'}],
    ['a node id with whitespace', {...goodEnv, NODE_ID: 'R_abc def'}],
    ['a node id with a newline', {...goodEnv, NODE_ID: 'R_abc\ndef'}],
    ['an over-long node id', {...goodEnv, NODE_ID: `R_${'a'.repeat(200)}`}],
    ['an old_name without an owner', {...goodEnv, OLD_NAME: 'panthe.ai'}],
    ['an old_name with a traversal', {...goodEnv, OLD_NAME: 'marcusrbrown/../x'}],
    ['an old_name of "."', {...goodEnv, OLD_NAME: 'marcusrbrown/.'}],
    ['an old_name with extra segments', {...goodEnv, OLD_NAME: 'marcusrbrown/a/b'}],
    ['an old_name with a space', {...goodEnv, OLD_NAME: 'marcusrbrown/a b'}],
    ['an old_name with a newline', {...goodEnv, OLD_NAME: 'marcusrbrown/a\nb'}],
  ])('rejects %s before building any client, without echoing the input', async (_label, env) => {
    const cli = cliDeps(createGitDataFake({files: worldFiles()}))

    const code = await runCli(env, cli.deps)

    expect(code).toBe(1)
    expect(cli.createdTokens).toEqual([])
    expect(cli.stderr.join('')).toMatch(
      /^::error::rename-tracked-repo: INVALID_INPUT \(field=(?:node_id|old_name)\)\n$/u,
    )
  })

  it.each(['GITHUB_TOKEN', 'RENAME_WRITER_TOKEN'])('rejects a missing or empty %s', async name => {
    for (const value of [undefined, '']) {
      const cli = cliDeps(createGitDataFake({files: worldFiles()}))

      const code = await runCli({...goodEnv, [name]: value}, cli.deps)

      expect(code).toBe(1)
      expect(cli.stderr.join('')).toBe(`::error::rename-tracked-repo: MISSING_TOKEN (name=${name})\n`)
      expect(cli.createdTokens).toEqual([])
    }
  })

  it('accepts an empty OLD_NAME as absent and a valid one as given', async () => {
    const files = worldFiles({}, [repoRow({name: NEW_NAME}), ...otherRows()])
    const cli = cliDeps(createGitDataFake({files}))

    const code = await runCli({...goodEnv, OLD_NAME: `${OWNER}/${OLD_NAME}`}, cli.deps)

    expect(code).toBe(0)
    expect(JSON.parse(cli.stdout.join(''))).toMatchObject({result: 'renamed', page: 'moved'})
  })

  it('never prints a token or a private identifier on any path', async () => {
    const fake = createGitDataFake({files: worldFiles()})
    const cli = cliDeps(fake)

    await runCli(goodEnv, cli.deps)

    expectPublicSafe(cli.stdout.join('') + cli.stderr.join(''))
  })
})

// ---------------------------------------------------------------------------
// The fake itself: it must refuse what git refuses, or the writer tests prove nothing.
// ---------------------------------------------------------------------------

describe('createGitDataFake', () => {
  it('rejects a non-fast-forward updateRef with 422', async () => {
    const fake = createGitDataFake({files: {'a.md': 'a'}})
    const base = fake.head()
    const tree = (await fake.client.rest.git.getCommit({owner: 'o', repo: 'r', commit_sha: base})).data.tree.sha
    const side = (
      await fake.client.rest.git.createCommit({owner: 'o', repo: 'r', message: 'side', tree, parents: [base]})
    ).data.sha
    fake.advance({'b.md': 'b'})

    await expect(
      fake.client.rest.git.updateRef({owner: 'o', repo: 'r', ref: 'heads/data', sha: side, force: false}),
    ).rejects.toMatchObject({status: 422})
    expect(fake.head()).not.toBe(side)
  })

  it('rejects deleting a path that is not in the base tree', async () => {
    const fake = createGitDataFake({files: {'a.md': 'a'}})
    const base = fake.head()
    const tree = (await fake.client.rest.git.getCommit({owner: 'o', repo: 'r', commit_sha: base})).data.tree.sha

    await expect(
      fake.client.rest.git.createTree({
        owner: 'o',
        repo: 'r',
        base_tree: tree,
        tree: [{path: 'ghost.md', mode: '100644', type: 'blob', sha: null}],
      }),
    ).rejects.toMatchObject({status: 422})
  })

  it('returns only direct children unless the read is recursive, like the real API', async () => {
    const fake = createGitDataFake({files: {'top.md': 't', 'dir/a.md': 'a', 'dir/sub/b.md': 'b'}})
    const treeSha = (await fake.client.rest.git.getCommit({owner: 'o', repo: 'r', commit_sha: fake.head()})).data.tree
      .sha

    const flat = await fake.client.rest.git.getTree({owner: 'o', repo: 'r', tree_sha: treeSha})
    const deep = await fake.client.rest.git.getTree({owner: 'o', repo: 'r', tree_sha: treeSha, recursive: 'true'})

    expect(flat.data.tree.map(entry => [entry.path, entry.type])).toEqual([
      ['dir', 'tree'],
      ['top.md', 'blob'],
    ])
    expect(deep.data.tree.map(entry => entry.path)).toEqual(['dir/a.md', 'dir/sub/b.md', 'top.md'])
  })

  it('stores and returns blobs as base64', async () => {
    const fake = createGitDataFake({files: {'a.md': 'héllo'}})
    const tree = await fake.client.rest.git.getTree({
      owner: 'o',
      repo: 'r',
      tree_sha: (await fake.client.rest.git.getCommit({owner: 'o', repo: 'r', commit_sha: fake.head()})).data.tree.sha,
      recursive: 'true',
    })
    const sha = tree.data.tree[0]?.sha ?? ''

    const blob = await fake.client.rest.git.getBlob({owner: 'o', repo: 'r', file_sha: sha})

    expect(Buffer.from(blob.data.content, 'base64').toString('utf8')).toBe('héllo')
  })
})
