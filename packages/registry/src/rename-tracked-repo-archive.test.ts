import type {GitDataFake} from '@fro-bot/test-kit/git-data-fake'
import {createGitDataFake} from '@fro-bot/test-kit/git-data-fake'
import {ARCHIVE_NOTICE} from '@fro.bot/wiki-write-core/wiki-utils'
import {describe, expect, it, vi, type Mock} from 'vitest'
import {parse, stringify} from 'yaml'
import {
  assertLifecyclePolicy,
  lifecycleTrackedRepo,
  RenameError,
  runCli,
  type LifecycleAction,
  type LifecycleDeps,
  type LifecycleOutcome,
  type RenameTransport,
} from './rename-tracked-repo.ts'

// Invented names throughout: none of these repositories exists.
const OWNER = 'example-org'
const NAME = 'lantern'
const REPOSITORY = `${OWNER}/${NAME}`
const SLUG = 'example-org--lantern'
const NODE_ID = 'R_kgDOArchive1'
const DATABASE_ID = 424_242
const TODAY = '2026-11-16'
const NOW = new Date('2026-11-16T23:59:59Z')

const REPOS_PATH = 'metadata/repos.yaml'
const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'
const PAGE_PATH = `knowledge/wiki/repos/${SLUG}.md`
const BEACON_PAGE_PATH = 'knowledge/wiki/repos/example-org--beacon.md'
const CURATED = `- [[${SLUG}]] — A curated description of the lantern.`

type Row = Record<string, unknown>

function row(overrides: Row = {}): Row {
  return {
    owner: OWNER,
    name: NAME,
    added: '2026-09-26',
    onboarding_status: 'onboarded',
    last_survey_at: '2026-09-27',
    last_survey_status: 'success',
    has_fro_bot_workflow: true,
    has_renovate: false,
    discovery_channel: 'collab',
    next_survey_eligible_at: '2026-10-27',
    private: false,
    node_id: NODE_ID,
    database_id: DATABASE_ID,
    ...overrides,
  }
}

/** The legacy shape of the first real use: lost access, and no IDs and no `private` key. */
function legacyRow(overrides: Row = {}): Row {
  return {
    owner: OWNER,
    name: NAME,
    added: '2026-03-01',
    onboarding_status: 'lost-access',
    last_survey_at: '2026-04-01',
    last_survey_status: 'success',
    has_fro_bot_workflow: true,
    has_renovate: false,
    ...overrides,
  }
}

/** A repository reconcile could not see: stored redacted, the database ID kept. */
function redactedRow(overrides: Row = {}): Row {
  return row({owner: '[REDACTED]', name: NODE_ID, private: true, onboarding_status: 'lost-access', ...overrides})
}

function otherRows(): Row[] {
  return [
    row({name: 'beacon', node_id: 'R_kgDOBeacon2', database_id: 7}),
    row({owner: 'hidden-org', name: 'vault', private: true, node_id: 'R_kgDOVault3', database_id: 8}),
  ]
}

function reposYaml(rows: Row[]): string {
  return stringify({version: 1, repos: rows}, {indent: 2, lineWidth: 0, singleQuote: true})
}

function page(options: {archived?: string; title?: string; nodeId?: string | null; url?: string} = {}): string {
  const title = options.title ?? REPOSITORY
  const nodeId = options.nodeId === undefined ? NODE_ID : options.nodeId
  return [
    '---',
    'type: repo',
    `title: ${title}`,
    'created: 2026-09-26',
    'updated: 2026-09-27',
    ...(nodeId === null ? [] : [`node_id: ${nodeId}`]),
    'sources:',
    `  - url: ${options.url ?? `https://github.com/${title}`}`,
    `    sha: ${'a'.repeat(40)}`,
    '    accessed: 2026-09-27',
    'tags:',
    '  - repository-stub',
    ...(options.archived === undefined ? [] : [`archived: ${options.archived}`]),
    '---',
    '',
    `# ${title}`,
    '',
    ...(options.archived === undefined ? [] : [ARCHIVE_NOTICE, '']),
    'Survey notes about the lantern.',
    '',
  ].join('\n')
}

const BEACON_PAGE = page({title: `${OWNER}/beacon`, nodeId: 'R_kgDOBeacon2'})

const LOG_HISTORY = [
  '# Wiki Log',
  '',
  'Chronological record of all wiki operations.',
  '',
  '---',
  '',
  '_Entries are appended by ingest, query, lint, and manual-edit operations. This file is append-only._',
  '',
  '## [2026-09-27 10:00] ingest | example-org/lantern',
  '',
  'Survey of the repo.',
  '',
  'Sources: https://github.com/example-org/lantern',
  '',
].join('\n')

const INDEX_PREFIX = ['# Wiki Index', '', 'Master catalog of all wiki pages, organized by type.', '', '## Repos', '']
const INDEX_SUFFIX = [
  '## Topics',
  '',
  '_No topic pages yet. Pages will appear here as cross-cutting themes emerge._',
  '',
  '## Entities',
  '',
  '_No entity pages yet. Pages will appear here as tools and services are documented._',
  '',
  '## Comparisons',
  '',
  '_No comparison pages yet. Pages will appear here as alternatives are analyzed._',
  '',
]
const INDEX_FOOTER = [
  '---',
  '',
  '_This index is maintained automatically by wiki ingest operations. Manual edits are preserved across updates._',
  '',
]

const BEACON_LINE = '- [[example-org--beacon]] — example-org/beacon'
const LIVE_INDEX = [...INDEX_PREFIX, BEACON_LINE, CURATED, '', ...INDEX_SUFFIX, ...INDEX_FOOTER].join('\n')
const ARCHIVED_INDEX = [
  ...INDEX_PREFIX,
  BEACON_LINE,
  '',
  ...INDEX_SUFFIX,
  '## Archived',
  '',
  CURATED,
  '',
  ...INDEX_FOOTER,
].join('\n')

/** The index of a wiki that has no page for the repository. */
const INDEX_WITHOUT_PAGE = [...INDEX_PREFIX, BEACON_LINE, '', ...INDEX_SUFFIX, ...INDEX_FOOTER].join('\n')

function worldFiles(rows: Row[], overrides: Record<string, string | null> = {}): Record<string, string> {
  const files: Record<string, string> = {
    [REPOS_PATH]: reposYaml(rows),
    [INDEX_PATH]: LIVE_INDEX,
    [LOG_PATH]: LOG_HISTORY,
    [PAGE_PATH]: page(),
    [BEACON_PAGE_PATH]: BEACON_PAGE,
  }
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path]
    else files[path] = content
  }
  return files
}

/** An archived row, its marked page, and the index with the page under Archived. */
function archivedWorld(rows: Row[] = [row({onboarding_status: 'archived'}), ...otherRows()]) {
  return worldFiles(rows, {[PAGE_PATH]: page({archived: TODAY}), [INDEX_PATH]: ARCHIVED_INDEX})
}

function node(overrides: Row = {}): Row {
  return {
    id: NODE_ID,
    databaseId: DATABASE_ID,
    name: NAME,
    owner: {login: OWNER},
    visibility: 'PUBLIC',
    isArchived: false,
    ...overrides,
  }
}

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {status})
}

interface TransportFake extends RenameTransport {
  readonly byNode: Mock<(...args: unknown[]) => Promise<unknown>>
}

function transportFor(byNode: () => Promise<unknown> = async () => node()): TransportFake {
  const byNodeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(byNode)
  const unused = async (): Promise<unknown> => Promise.reject(new Error('the rename reads are not used here'))
  return {
    byNode: byNodeMock,
    getRepositoryById: unused,
    getRepositoryByName: unused,
    getRepositoryByNodeId: async id => byNodeMock(id),
  }
}

async function run(
  fake: GitDataFake,
  action: LifecycleAction,
  transport: RenameTransport = transportFor(),
  overrides: Partial<LifecycleDeps> = {},
): Promise<LifecycleOutcome> {
  return lifecycleTrackedRepo({transport, writer: fake.client, action, nodeId: NODE_ID, now: () => NOW, ...overrides})
}

function rows(files: Record<string, string>): Row[] {
  return (parse(files[REPOS_PATH] ?? '') as {repos: Row[]}).repos
}

function lanternRow(files: Record<string, string>): Row | undefined {
  return rows(files).find(candidate => candidate.node_id === NODE_ID || candidate.name === NAME)
}

function writeCalls(fake: GitDataFake): string[] {
  return fake.calls
    .map(call => call.method)
    .filter(method => ['createBlob', 'createTree', 'createCommit', 'updateRef'].includes(method))
}

function section(index: string, heading: string, next: string): string {
  return index.slice(index.indexOf(`## ${heading}`), next === '' ? undefined : index.indexOf(next))
}

function changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(path => before[path] !== after[path])
    .sort()
}

/** A page compared as data: frontmatter values and body, so the test does not pin the YAML layout. */
function pageParts(content: string | undefined): {values: Row; body: string} {
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/u.exec(content ?? '')
  return {values: parse(match?.[1] ?? '') as Row, body: match?.[2]?.trim() ?? ''}
}

function expectNoWrite(fake: GitDataFake, head: string): void {
  expect(writeCalls(fake)).toEqual([])
  expect(fake.head()).toBe(head)
}

describe('lifecycleTrackedRepo: archive', () => {
  it('archives an onboarded public row in one commit: row, marked page, regrouped index, one log entry', async () => {
    // #given an onboarded public row with a page, and GitHub showing the node public
    const before = worldFiles([row(), ...otherRows()])
    const fake = createGitDataFake({files: before})
    const head = fake.head()

    // #when the operator archives it
    const outcome = await run(fake, 'archive')

    // #then it is exactly one non-force commit on the previous head
    expect(outcome).toMatchObject({result: 'archived', attempts: 1, page: 'edited'})
    expect(fake.parentsOf(fake.head())).toEqual([head])
    expect(writeCalls(fake).filter(method => method === 'updateRef')).toHaveLength(1)
    expect(fake.calls.find(call => call.method === 'updateRef')?.args).toMatchObject({ref: 'heads/data', force: false})
    expect(fake.messageOf(fake.head())).toBe(`chore(archive): archive ${REPOSITORY}`)

    // #and only the row, the page, the index and the log changed
    const after = fake.files()
    expect(changedPaths(before, after)).toEqual([INDEX_PATH, LOG_PATH, PAGE_PATH, REPOS_PATH].sort())

    // #and the row is archived and named, every other field kept, other rows untouched
    expect(lanternRow(after)).toEqual(row({onboarding_status: 'archived'}))
    expect(rows(after).filter(candidate => candidate.node_id !== NODE_ID)).toEqual(otherRows())

    // #and the page gained the date and the notice and nothing else
    const marked = pageParts(after[PAGE_PATH])
    const original = pageParts(page())
    expect(marked.values).toEqual({...original.values, archived: TODAY})
    expect(marked.body).toBe(pageParts(page({archived: TODAY})).body)
    expect(marked.body.replace(`${ARCHIVE_NOTICE}\n\n`, '')).toBe(original.body)

    // #and the index lists it under Archived with its curated line, and not under Repos
    const index = after[INDEX_PATH] ?? ''
    expect(section(index, 'Repos', '## Topics')).not.toContain(SLUG)
    expect(section(index, 'Archived', '\n---')).toBe(`## Archived\n\n${CURATED}\n`)

    // #and the log gained exactly one manual-edit entry, history untouched
    const log = after[LOG_PATH] ?? ''
    expect(log.startsWith(LOG_HISTORY)).toBe(true)
    expect(log.match(/^## \[/gmu)).toHaveLength(2)
    expect(log).toContain(`manual-edit | repo:${REPOSITORY}`)
  })

  describe('a page body with its own spacing', () => {
    const bodies = {
      'one blank line': `# ${REPOSITORY}\n\nSurvey notes.`,
      'several blank lines': `# ${REPOSITORY}\n\n\n\nSurvey notes.\n\n\nMore notes.`,
      'CRLF line endings': `# ${REPOSITORY}\r\n\r\n\r\nSurvey notes.\r\nMore.`,
      'no text after the heading': `# ${REPOSITORY}`,
    }
    const withBody = (body: string): string => page().replace(/\n---\n\n[\s\S]*$/u, `\n---\n\n${body}\n`)

    it.each(Object.entries(bodies))(
      'archives in one commit with no other body change, and unarchives to the same body: %s',
      async (_label, body) => {
        const original = withBody(body)
        const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()], {[PAGE_PATH]: original})})
        const head = fake.head()

        // #when it is archived
        const archived = await run(fake, 'archive')

        // #then one commit lands, and the body differs only by the notice paragraph and one blank line
        expect(archived).toMatchObject({result: 'archived', attempts: 1, page: 'edited'})
        expect(fake.parentsOf(fake.head())).toEqual([head])
        const marked = pageParts(fake.files()[PAGE_PATH])
        expect(marked.body).toContain(ARCHIVE_NOTICE)

        // #when it is unarchived again
        const unarchived = await run(fake, 'unarchive')

        // #then the body is the original, byte for byte
        expect(unarchived).toMatchObject({result: 'unarchived'})
        expect(pageParts(fake.files()[PAGE_PATH]).body).toBe(body)
        expect(pageParts(fake.files()[PAGE_PATH]).values).toEqual(pageParts(original).values)
      },
    )

    it('adds only the notice paragraph: the lines of the page are the original lines plus the notice', async () => {
      const original = withBody(bodies['several blank lines'])
      const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()], {[PAGE_PATH]: original})})

      await run(fake, 'archive')

      const originalLines = pageParts(original).body.split('\n')
      const markedLines = pageParts(fake.files()[PAGE_PATH]).body.split('\n')
      expect(markedLines).toEqual([originalLines[0], '', ARCHIVE_NOTICE, ...originalLines.slice(1)])
    })
  })

  it('writes the date as the UTC calendar day of the run', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})

    await run(fake, 'archive', transportFor(), {now: () => new Date('2026-12-31T23:59:59Z')})

    expect(pageParts(fake.files()[PAGE_PATH]).values.archived).toBe('2026-12-31')
  })

  it('restores the name of a lost-access redacted row whose node GitHub shows public, and archives it', async () => {
    // #given reconcile's redacted lost-access row, and GitHub showing the node public under its name
    const fake = createGitDataFake({files: worldFiles([redactedRow(), ...otherRows()])})

    // #when it is archived
    const outcome = await run(fake, 'archive')

    // #then the row is named, public and archived, with its other fields kept
    expect(outcome).toMatchObject({result: 'archived'})
    expect(lanternRow(fake.files())).toEqual(row({onboarding_status: 'archived', last_survey_at: '2026-09-27'}))
    expect(pageParts(fake.files()[PAGE_PATH]).values.archived).toBe(TODAY)
  })

  it('stores the IDs, private:false and the archived state on a legacy row that has no node ID', async () => {
    // #given the legacy row shape, and a page that lists the repository's URL (and has no node ID)
    const fake = createGitDataFake({
      files: worldFiles([legacyRow(), ...otherRows()], {[PAGE_PATH]: page({nodeId: null})}),
    })

    // #when the supplied node matches by GitHub's owner and name
    const outcome = await run(fake, 'archive')

    // #then the IDs are stored in the same commit and nothing else of the row changed
    expect(outcome).toMatchObject({result: 'archived'})
    expect(lanternRow(fake.files())).toEqual({
      ...legacyRow(),
      onboarding_status: 'archived',
      private: false,
      node_id: NODE_ID,
      database_id: DATABASE_ID,
    })
    expect(pageParts(fake.files()[PAGE_PATH]).values.archived).toBe(TODAY)
  })

  it('keeps a database ID the row already stores, and refuses one that differs from GitHub', async () => {
    const same = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    await run(same, 'archive')
    expect(lanternRow(same.files())?.database_id).toBe(DATABASE_ID)

    const differs = createGitDataFake({files: worldFiles([row({database_id: 99}), ...otherRows()])})
    const head = differs.head()
    expect(await run(differs, 'archive')).toEqual({result: 'blocked', reason: 'identity-not-confirmed'})
    expectNoWrite(differs, head)
  })

  it('writes the row and the log but no page when the page does not exist', async () => {
    const before = worldFiles([row(), ...otherRows()], {[PAGE_PATH]: null, [INDEX_PATH]: INDEX_WITHOUT_PAGE})
    const fake = createGitDataFake({files: before})

    const outcome = await run(fake, 'archive')

    expect(outcome).toMatchObject({result: 'archived', page: 'missing'})
    expect(changedPaths(before, fake.files())).toEqual([LOG_PATH, REPOS_PATH])
  })

  describe('a row with no node ID is matched only on exact evidence', () => {
    it('is refused when two rows lack a node ID and share the name', async () => {
      const fake = createGitDataFake({
        files: worldFiles([legacyRow(), legacyRow({added: '2026-05-05'}), ...otherRows()], {
          [PAGE_PATH]: page({nodeId: null}),
        }),
      })
      const head = fake.head()

      expect(await run(fake, 'archive')).toEqual({result: 'blocked', reason: 'ambiguous-legacy-match'})
      expectNoWrite(fake, head)
    })

    it('is refused when no page lists the repository URL', async () => {
      const fake = createGitDataFake({
        files: worldFiles([legacyRow(), ...otherRows()], {
          [PAGE_PATH]: page({nodeId: null, url: 'https://github.com/example-org/another'}),
        }),
      })
      const head = fake.head()

      expect(await run(fake, 'archive')).toEqual({result: 'blocked', reason: 'ambiguous-legacy-match'})
      expectNoWrite(fake, head)
    })

    it('is refused when two pages list the repository URL', async () => {
      const fake = createGitDataFake({
        files: worldFiles([legacyRow(), ...otherRows()], {
          [PAGE_PATH]: page({nodeId: null}),
          'knowledge/wiki/repos/example-org--lantern-copy.md': page({nodeId: null}),
        }),
      })
      const head = fake.head()

      expect(await run(fake, 'archive')).toEqual({result: 'blocked', reason: 'ambiguous-legacy-match'})
      expectNoWrite(fake, head)
    })

    it.each([
      ['owner', {owner: {login: 'someone-else'}}],
      ['name', {name: 'renamed'}],
    ])("is refused when GitHub's %s differs from the row", async (_label, overrides) => {
      const fake = createGitDataFake({
        files: worldFiles([legacyRow(), ...otherRows()], {[PAGE_PATH]: page({nodeId: null})}),
      })
      const head = fake.head()

      expect(
        await run(
          fake,
          'archive',
          transportFor(async () => node(overrides)),
        ),
      ).toEqual({
        result: 'blocked',
        reason: 'row-not-found',
      })
      expectNoWrite(fake, head)
    })
  })

  describe('refusals write nothing', () => {
    it.each([
      [
        'an untracked node',
        () => [row({node_id: 'R_kgDOElsewhere9', name: 'other'})],
        async () => node(),
        'row-not-found',
      ],
      [
        'a private row (GitHub shows the node private)',
        () => [redactedRow()],
        async () => node({visibility: 'PRIVATE'}),
        'row-not-public',
      ],
      [
        'a public row that GitHub now shows private',
        () => [row()],
        async () => node({visibility: 'PRIVATE'}),
        'repository-private',
      ],
      ['a node GitHub cannot confirm (null)', () => [row()], async () => null, 'identity-not-confirmed'],
      ['a node GitHub answers with nothing usable', () => [row()], async () => ({}), 'identity-not-confirmed'],
      [
        'a node GitHub answers with another ID',
        () => [row()],
        async () => node({id: 'R_kgDOSomethingElse'}),
        'identity-not-confirmed',
      ],
      [
        'a second row with the same node ID',
        () => [row(), row({name: 'twin'})],
        async () => node(),
        'duplicate-identity',
      ],
      [
        'another row that shares the database ID',
        () => [row(), row({name: 'twin', node_id: 'R_kgDOTwin5'})],
        async () => node(),
        'duplicate-identity',
      ],
    ])('%s', async (_label, makeRows, byNode, reason) => {
      const fake = createGitDataFake({files: worldFiles([...makeRows(), ...otherRows()])})
      const head = fake.head()

      const outcome = await run(fake, 'archive', transportFor(byNode))

      expect(outcome).toEqual({result: 'blocked', reason})
      expectNoWrite(fake, head)
    })

    it('fails with a status-only error when the node lookup itself fails', async () => {
      const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
      const head = fake.head()

      await expect(
        run(
          fake,
          'archive',
          transportFor(async () => Promise.reject(httpError(502))),
        ),
      ).rejects.toMatchObject({code: 'EVIDENCE_FAILED', phase: 'evidence', status: 502})
      expectNoWrite(fake, head)
    })
  })

  it('reports an already archived named row as a no-op: no lookup, no commit', async () => {
    const fake = createGitDataFake({files: archivedWorld()})
    const head = fake.head()
    const transport = transportFor()

    const outcome = await run(fake, 'archive', transport)

    expect(outcome).toEqual({result: 'noop', state: 'archived'})
    expect(transport.byNode).not.toHaveBeenCalled()
    expectNoWrite(fake, head)
  })

  describe('a redacted archived row (reconcile redacted it after the archive)', () => {
    const redactedArchived = (): Row => redactedRow({onboarding_status: 'archived'})

    it('is re-archived when GitHub shows the same node public under the name its page is attributed to', async () => {
      const fake = createGitDataFake({
        files: archivedWorld([redactedArchived(), ...otherRows()]),
      })

      const outcome = await run(fake, 'archive')

      expect(outcome).toMatchObject({result: 'archived'})
      expect(lanternRow(fake.files())).toEqual(row({onboarding_status: 'archived', last_survey_at: '2026-09-27'}))
      // the page already carried the date; it keeps it
      expect(pageParts(fake.files()[PAGE_PATH]).values.archived).toBe(TODAY)
    })

    it('is refused when the repository now has another name', async () => {
      const fake = createGitDataFake({files: archivedWorld([redactedArchived(), ...otherRows()])})
      const head = fake.head()

      const outcome = await run(
        fake,
        'archive',
        transportFor(async () => node({name: 'renamed'})),
      )

      expect(outcome).toEqual({result: 'blocked', reason: 'identity-not-confirmed'})
      expectNoWrite(fake, head)
    })

    it('is refused when no page is attributed to the node at that name', async () => {
      const fake = createGitDataFake({
        files: {
          ...archivedWorld([redactedArchived(), ...otherRows()]),
          [PAGE_PATH]: page({archived: TODAY, nodeId: 'R_kgDOSomeoneElse'}),
        },
      })
      const head = fake.head()

      expect(await run(fake, 'archive')).toEqual({result: 'blocked', reason: 'identity-not-confirmed'})
      expectNoWrite(fake, head)
    })
  })

  it('rebuilds once from the new head when the ref moves, keeping the concurrent change and asking GitHub once', async () => {
    // #given the branch moves between the read and the write
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    fake.beforeUpdateRef(1, () => {
      fake.advance({
        'knowledge/wiki/topics/concurrent.md':
          '---\ntype: topic\ntitle: Concurrent\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\nNew page.\n',
      })
    })
    const transport = transportFor()

    // #when the archive runs
    const outcome = await run(fake, 'archive', transport)

    // #then it retried once, kept the concurrent page, put it in the index and landed the archive
    expect(outcome).toMatchObject({result: 'archived', attempts: 2})
    expect(fake.files()['knowledge/wiki/topics/concurrent.md']).toContain('Concurrent')
    expect(fake.files()[INDEX_PATH]).toContain('[[concurrent]]')
    expect(lanternRow(fake.files())?.onboarding_status).toBe('archived')
    expect(fake.calls.filter(call => call.method === 'updateRef')).toHaveLength(2)
    expect(transport.byNode).toHaveBeenCalledTimes(1)
  })

  it('fails with the existing retries-exhausted error when the ref keeps moving', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    for (const attempt of [1, 2, 3]) {
      fake.beforeUpdateRef(attempt, () => {
        fake.advance({
          [`knowledge/wiki/topics/race-${attempt}.md`]: `---\ntype: topic\ntitle: R${attempt}\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\nx\n`,
        })
      })
    }

    await expect(run(fake, 'archive')).rejects.toMatchObject({code: 'RETRIES_EXHAUSTED', phase: 'updateRef'})
  })
})

describe('lifecycleTrackedRepo: unarchive', () => {
  it.each([
    ['a previously onboarded row', row({onboarding_status: 'archived'})],
    [
      'a never-surveyed row',
      row({
        onboarding_status: 'archived',
        last_survey_at: null,
        last_survey_status: null,
        next_survey_eligible_at: null,
      }),
    ],
    [
      'a row with a future eligibility date',
      row({onboarding_status: 'archived', next_survey_eligible_at: '2027-02-01'}),
    ],
  ])(
    'sets pending, keeps the survey history, removes the date and notice and regroups the index: %s',
    async (_label, archived) => {
      // #given an archived row, its marked page and the index with the page under Archived
      const before = archivedWorld([archived, ...otherRows()])
      const fake = createGitDataFake({files: before})
      const head = fake.head()
      const transport = transportFor()

      // #when it is unarchived
      const outcome = await run(fake, 'unarchive', transport)

      // #then one commit lands
      expect(outcome).toMatchObject({result: 'unarchived', attempts: 1, page: 'edited'})
      expect(fake.parentsOf(fake.head())).toEqual([head])
      expect(fake.messageOf(fake.head())).toBe(`chore(archive): unarchive ${REPOSITORY}`)
      expect(transport.byNode).toHaveBeenCalledTimes(1)

      // #and the row is pending and every other field, survey history and eligibility date included, is kept
      const after = fake.files()
      expect(lanternRow(after)).toEqual({...archived, onboarding_status: 'pending'})
      expect(rows(after).filter(candidate => candidate.node_id !== NODE_ID)).toEqual(otherRows())

      // #and the page lost the date and the notice and nothing else
      expect(pageParts(after[PAGE_PATH])).toEqual(pageParts(page()))
      expect(after[PAGE_PATH]).not.toContain(ARCHIVE_NOTICE)

      // #and the index lists it under Repos again with no Archived section
      const index = after[INDEX_PATH] ?? ''
      expect(index).not.toContain('## Archived')
      expect(section(index, 'Repos', '## Topics')).toContain(CURATED)

      // #and one log entry was appended
      expect((after[LOG_PATH] ?? '').match(/^## \[/gmu)).toHaveLength(2)
      expect(after[LOG_PATH]).toContain(`manual-edit | repo:${REPOSITORY}`)
    },
  )

  it('reports a row that is not archived as a no-op, without a commit', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    const head = fake.head()

    expect(await run(fake, 'unarchive')).toEqual({result: 'noop', state: 'not-archived'})
    expectNoWrite(fake, head)
  })

  it.each([
    [
      'an untracked node',
      () => [row({node_id: 'R_kgDOElsewhere9', name: 'other'})],
      async () => node(),
      'row-not-found',
    ],
    [
      'GitHub shows the repository archived',
      () => [row({onboarding_status: 'archived'})],
      async () => node({isArchived: true}),
      'repository-archived',
    ],
    [
      'GitHub shows the repository private',
      () => [row({onboarding_status: 'archived'})],
      async () => node({visibility: 'PRIVATE'}),
      'repository-private',
    ],
    [
      'a node GitHub cannot confirm',
      () => [row({onboarding_status: 'archived'})],
      async () => null,
      'identity-not-confirmed',
    ],
    ['a redacted row', () => [redactedRow({onboarding_status: 'archived'})], async () => node(), 'row-not-public'],
  ])('is refused for %s, without writing', async (_label, makeRows, byNode, reason) => {
    const fake = createGitDataFake({files: archivedWorld([...makeRows(), ...otherRows()])})
    const head = fake.head()

    expect(await run(fake, 'unarchive', transportFor(byNode))).toEqual({result: 'blocked', reason})
    expectNoWrite(fake, head)
  })

  it.each([
    ['another row with the same node ID', (): Row[] => [row({onboarding_status: 'archived'}), row({name: 'twin'})]],
    [
      'another row that shares the database ID',
      (): Row[] => [row({onboarding_status: 'archived'}), row({name: 'twin', node_id: 'R_kgDOTwin5'})],
    ],
  ])('is refused as duplicate-identity for %s, without writing', async (_label, makeRows) => {
    const fake = createGitDataFake({files: archivedWorld([...makeRows(), ...otherRows()])})
    const head = fake.head()

    expect(await run(fake, 'unarchive')).toEqual({result: 'blocked', reason: 'duplicate-identity'})
    expectNoWrite(fake, head)
  })

  it('writes the row and the log but no page when the page does not exist', async () => {
    const before: Record<string, string> = {...archivedWorld(), [INDEX_PATH]: INDEX_WITHOUT_PAGE}
    delete before[PAGE_PATH]
    const fake = createGitDataFake({files: before})

    const outcome = await run(fake, 'unarchive')

    expect(outcome).toMatchObject({result: 'unarchived', page: 'missing'})
    expect(changedPaths(before, fake.files())).toEqual([LOG_PATH, REPOS_PATH])
  })
})

describe('assertLifecyclePolicy: the field-by-field check', () => {
  const rowsBefore = [row(), ...otherRows()] as never[]
  const check = (
    action: LifecycleAction,
    change: (rowsAfter: Row[]) => void,
    pages: {before?: string | undefined; after?: string | undefined} = {},
    before: Row[] = rowsBefore,
  ): void => {
    const rowsAfter = structuredClone(before)
    change(rowsAfter)
    assertLifecyclePolicy({
      action,
      rowsBefore: before as never[],
      rowsAfter: rowsAfter as never[],
      targetIndex: 0,
      pageBefore: 'before' in pages ? pages.before : page(),
      pageAfter: 'after' in pages ? pages.after : page({archived: TODAY}),
    })
  }
  const archive = (target: Row): void => {
    target.onboarding_status = 'archived'
  }

  it('accepts exactly the archive: state, missing IDs, redaction, and the page date and notice', () => {
    expect(() => check('archive', rowsAfter => archive(rowsAfter[0] ?? {}))).not.toThrow()
    expect(() =>
      check(
        'archive',
        rowsAfter =>
          Object.assign(rowsAfter[0] ?? {}, {onboarding_status: 'archived', private: false, node_id: NODE_ID}),
        {},
        [legacyRow(), ...otherRows()] as never[],
      ),
    ).not.toThrow()
  })

  it.each([
    ['a changed survey field', (rowsAfter: Row[]) => Object.assign(rowsAfter[0] ?? {}, {last_survey_at: null})],
    ['a changed name of a named row', (rowsAfter: Row[]) => Object.assign(rowsAfter[0] ?? {}, {name: 'renamed'})],
    ['an added key', (rowsAfter: Row[]) => Object.assign(rowsAfter[0] ?? {}, {cross_repo_receipts: 'x'})],
    ['a changed ID that was present', (rowsAfter: Row[]) => Object.assign(rowsAfter[0] ?? {}, {database_id: 1})],
    ['a removed field', (rowsAfter: Row[]) => Reflect.deleteProperty(rowsAfter[0] ?? {}, 'has_renovate')],
    ['a changed other row', (rowsAfter: Row[]) => Object.assign(rowsAfter[1] ?? {}, {has_renovate: true})],
    ['a dropped other row', (rowsAfter: Row[]) => rowsAfter.pop()],
    ['a wrong state', (rowsAfter: Row[]) => Object.assign(rowsAfter[0] ?? {}, {onboarding_status: 'failed'})],
  ])('rejects %s on archive', (_label, change) => {
    expect(() =>
      check('archive', rowsAfter => {
        archive(rowsAfter[0] ?? {})
        change(rowsAfter)
      }),
    ).toThrow(RenameError)
  })

  it.each([
    ['another frontmatter key changed', page({archived: TODAY}).replace('updated: 2026-09-27', 'updated: 2026-11-16')],
    ['a body line changed', page({archived: TODAY}).replace('Survey notes about the lantern.', 'Rewritten notes.')],
    ['the notice missing', page({archived: TODAY}).replace(`${ARCHIVE_NOTICE}\n\n`, '')],
    ['the date missing', page({archived: TODAY}).replace(`archived: ${TODAY}\n`, '')],
    ['a malformed date', page({archived: 'yesterday'})],
    ['a tag added', page({archived: TODAY}).replace('  - repository-stub', '  - repository-stub\n  - extra')],
  ])('rejects a page with %s on archive', (_label, pageAfter) => {
    expect(() => check('archive', rowsAfter => archive(rowsAfter[0] ?? {}), {after: pageAfter})).toThrow(RenameError)
  })

  it('rejects a page created from nothing, and a page that disappears', () => {
    expect(() => check('archive', rowsAfter => archive(rowsAfter[0] ?? {}), {before: undefined})).toThrow(RenameError)
    expect(() => check('archive', rowsAfter => archive(rowsAfter[0] ?? {}), {after: undefined})).toThrow(RenameError)
  })

  it('allows an unarchive to change the state and remove the date and notice only', () => {
    const archived = [row({onboarding_status: 'archived'}), ...otherRows()]
    const unarchive = (rowsAfter: Row[]): void => {
      rowsAfter[0] = {...(rowsAfter[0] ?? {}), onboarding_status: 'pending'}
    }
    expect(() =>
      check('unarchive', unarchive, {before: page({archived: TODAY}), after: page()}, archived),
    ).not.toThrow()
    // a changed survey field, a leftover date, a leftover notice, a changed line
    expect(() =>
      check(
        'unarchive',
        rowsAfter => {
          unarchive(rowsAfter)
          Object.assign(rowsAfter[0] ?? {}, {last_survey_at: null})
        },
        {before: page({archived: TODAY}), after: page()},
        archived,
      ),
    ).toThrow(RenameError)
    for (const after of [
      page({archived: TODAY}),
      page().replace('Survey notes', `${ARCHIVE_NOTICE}\n\nSurvey notes`),
      page().replace('Survey notes about the lantern.', 'Rewritten.'),
    ]) {
      expect(() => check('unarchive', unarchive, {before: page({archived: TODAY}), after}, archived)).toThrow(
        RenameError,
      )
    }
  })
})

function cliIo(fake: GitDataFake, transport: RenameTransport = transportFor()) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    deps: {
      createTransport: () => transport,
      createWriter: () => fake.client,
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      now: () => NOW,
    },
  }
}

describe('runCli: the archive and unarchive actions', () => {
  const env = {
    GITHUB_TOKEN: 'ghp_readTokenValue',
    RENAME_WRITER_TOKEN: 'ghs_writerTokenValue',
    NODE_ID,
    ACTION: 'archive',
  }

  it('archives and prints one summary line: the action, the outcome and the node ID', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    const io = cliIo(fake)

    const code = await runCli(env, io.deps)

    expect(code).toBe(0)
    expect(io.stdout.join('')).toBe(`${JSON.stringify({action: 'archive', result: 'archived', node_id: NODE_ID})}\n`)
    expect(io.stderr).toEqual([])
    expect(lanternRow(fake.files())?.onboarding_status).toBe('archived')
  })

  it('reports an already archived row with exit 0 and no commit', async () => {
    const fake = createGitDataFake({files: archivedWorld()})
    const head = fake.head()
    const io = cliIo(fake)

    const code = await runCli(env, io.deps)

    expect(code).toBe(0)
    expect(io.stdout.join('')).toBe(
      `${JSON.stringify({action: 'archive', result: 'already-archived', node_id: NODE_ID})}\n`,
    )
    expect(fake.head()).toBe(head)
  })

  it('unarchives', async () => {
    const fake = createGitDataFake({files: archivedWorld()})
    const io = cliIo(fake)

    const code = await runCli({...env, ACTION: 'unarchive'}, io.deps)

    expect(code).toBe(0)
    expect(io.stdout.join('')).toBe(
      `${JSON.stringify({action: 'unarchive', result: 'unarchived', node_id: NODE_ID})}\n`,
    )
    expect(lanternRow(fake.files())?.onboarding_status).toBe('pending')
  })

  it('fails a refusal with its fixed reason, naming no repository, and writes nothing', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    const head = fake.head()
    const io = cliIo(
      fake,
      transportFor(async () => node({visibility: 'PRIVATE'})),
    )

    const code = await runCli(env, io.deps)

    expect(code).toBe(1)
    expect(io.stderr.join('')).toBe(
      '::error::rename-tracked-repo: blocked (reason=repository-private). Nothing was written. See metadata/README.md, "Archiving a repository".\n',
    )
    expect(io.stderr.join('')).not.toContain(OWNER)
    expect(io.stdout).toEqual([])
    expect(fake.head()).toBe(head)
  })

  it('rejects an unknown action before building a client', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    const created = vi.fn()
    const io = cliIo(fake)

    const code = await runCli({...env, ACTION: 'delete'}, {...io.deps, createTransport: created, createWriter: created})

    expect(code).toBe(1)
    expect(io.stderr.join('')).toBe('::error::rename-tracked-repo: INVALID_INPUT (field=action)\n')
    expect(created).not.toHaveBeenCalled()
  })

  it('runs the rename, not a lifecycle action, when ACTION is omitted, empty or apply', async () => {
    // #given a row that still holds the old name, GitHub showing the new one, and the page at the old slug
    const oldName = 'old-lantern'
    const renameWorld = (): Record<string, string> =>
      worldFiles([row({name: oldName}), ...otherRows()], {
        [PAGE_PATH]: null,
        [`knowledge/wiki/repos/${OWNER}--${oldName}.md`]: page({title: `${OWNER}/${oldName}`}),
      })

    for (const action of [undefined, '', 'apply']) {
      const fake = createGitDataFake({files: renameWorld()})
      const io = cliIo(fake)
      const byId = vi.fn(async () => ({
        id: DATABASE_ID,
        node_id: NODE_ID,
        name: NAME,
        owner: {login: OWNER},
        private: false,
      }))
      const transport = {...transportFor(), getRepositoryById: byId}

      // #when the CLI runs with valid identity evidence
      const code = await runCli({...env, ACTION: action}, {...io.deps, createTransport: () => transport})

      // #then the rename ran: it read the repository by database ID, never by node, and moved the page
      expect(code).toBe(0)
      expect(byId).toHaveBeenCalledWith(DATABASE_ID)
      expect(transport.byNode).not.toHaveBeenCalled()
      expect(JSON.parse(io.stdout.join(''))).toMatchObject({result: 'renamed', page: 'moved', attempts: 1})
      expect(lanternRow(fake.files())?.name).toBe(NAME)
      expect(fake.files()[PAGE_PATH]).toContain(`node_id: ${NODE_ID}`)
      expect(fake.files()[`knowledge/wiki/repos/${OWNER}--${oldName}.md`]).toBeUndefined()
    }
  })

  it('ignores OLD_NAME for archive and unarchive', async () => {
    const fake = createGitDataFake({files: worldFiles([row(), ...otherRows()])})
    const io = cliIo(fake)

    const code = await runCli({...env, OLD_NAME: 'not a name'}, io.deps)

    expect(code).toBe(0)
  })
})
