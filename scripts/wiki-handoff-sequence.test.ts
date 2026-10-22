/**
 * Replays the 2026-10-20 and 2026-10-21 lost-update sequences end to end: a handoff built from the
 * agent's checkout, the trusted apply, and the ingest CLI committing through the Git Data fake.
 * Two agents sync before either writer persists, so the second writer's handoff is stale.
 */
import type {CommitWikiChangesParams, OctokitClient} from '../packages/wiki-write-core/src/wiki-ingest.ts'
import type {GitDataFake} from './git-data-fake.ts'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'

import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from 'vitest'
import {
  appendLogEntry,
  commitWikiChanges,
  rebuildWikiIndex,
  runWikiIngestCli,
} from '../packages/wiki-write-core/src/wiki-ingest.ts'
import {createGitDataFake} from './git-data-fake.ts'
import {validateAndApplyWikiHandoff} from './wiki-handoff-core.ts'

const LOG = 'knowledge/log.md'
const INDEX = 'knowledge/index.md'
const CI_PAGE = 'knowledge/wiki/topics/github-actions-ci.md'
const OLD_PAGE = 'knowledge/wiki/topics/old-notes.md'
const HA_PAGE = 'knowledge/wiki/topics/ha-config-notes.md'
const SYSTEMATIC_PAGE = 'knowledge/wiki/topics/systematic-notes.md'

const ENV_KEYS = [
  'WIKI_INGEST_DATA_TIP_SHA',
  'WIKI_HANDOFF_DIR',
  'WIKI_HANDOFF_BASE_SHA',
  'WIKI_OPERATION',
  'WIKI_TARGET',
  'WIKI_SUMMARY',
  'WIKI_TIMESTAMP',
  'WIKI_OWNER',
  'WIKI_REPO',
  'WIKI_BRANCH',
  'WIKI_COMMIT_MESSAGE',
  'WIKI_SOURCES',
  'GITHUB_OUTPUT',
] as const

function topic(title: string, body: string): string {
  return `---\ntype: topic\ntitle: ${title}\ncreated: 2026-04-16\nupdated: 2026-10-19\n---\n\n${body}\n`
}

function seedFiles(): Record<string, string> {
  const pages = {
    [CI_PAGE]: topic('GitHub Actions CI', 'Seed CI notes.'),
    [OLD_PAGE]: topic('Old Notes', 'Old notes.'),
  }
  return {
    ...pages,
    [INDEX]: rebuildWikiIndex({wikiFiles: pages}),
    [LOG]: appendLogEntry(undefined, {
      operation: 'survey',
      target: 'repo:seed/seed',
      summary: 'Seed entry.',
      timestamp: new Date('2026-10-01T00:00:00Z'),
      sources: [],
    }),
  }
}

function logEntry(log: string, target: string, detail: string, hour: number): string {
  return appendLogEntry(log, {
    operation: 'survey',
    target,
    summary: detail,
    timestamp: new Date(Date.UTC(2026, 9, 20, hour, 0)),
    sources: [],
  })
}

function asOctokit(fake: GitDataFake): OctokitClient {
  return fake.client as unknown as OctokitClient
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

interface Agent {
  /** The data commit the agent job synced, from its sync step. */
  readonly base: string
  readonly baseline: Readonly<Record<string, string>>
  /** The agent's working tree; edit it, then build the handoff. */
  readonly files: Record<string, string>
}

function syncAgent(fake: GitDataFake): Agent {
  const baseline = fake.files()
  return {base: fake.head(), baseline, files: {...baseline}}
}

function writeTree(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), {recursive: true})
    writeFileSync(target, content)
  }
}

/** The handoff the agent job uploads: changed files in full, deleted paths in the manifest. */
function buildHandoff(agent: Agent, root: string): string {
  const changed = Object.keys(agent.files).filter(path => agent.files[path] !== agent.baseline[path])
  const deleted = Object.keys(agent.baseline).filter(path => agent.files[path] === undefined)
  const dir = mkdtempSync(join(root, 'handoff-'))
  for (const path of changed) {
    const target = join(dir, 'files', path)
    mkdirSync(dirname(target), {recursive: true})
    writeFileSync(target, agent.files[path] ?? '')
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({changed, deleted})}\n`)
  return dir
}

describe('wiki handoff replay (lost updates between overlapping surveys)', () => {
  const originalCwd = process.cwd()
  const originalEnv = new Map<string, string | undefined>()
  let root: string
  let stderr: string[]
  let fake: GitDataFake
  let bootstrap: Mock<NonNullable<CommitWikiChangesParams['bootstrapDataBranch']>>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wiki-handoff-sequence-'))
    for (const key of ENV_KEYS) originalEnv.set(key, process.env[key])
    delete process.env.GITHUB_OUTPUT
    stderr = []
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk))
      return true
    })
    fake = createGitDataFake({branch: 'data', files: seedFiles()})
    bootstrap = vi.fn<NonNullable<CommitWikiChangesParams['bootstrapDataBranch']>>(async () => ({
      created: false,
      ref: 'refs/heads/data',
      sha: fake.head(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.chdir(originalCwd)
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, {recursive: true, force: true})
  })

  /** One trusted writer job: sync `data`, apply the handoff, run the ingest CLI, commit. */
  async function persist(
    handoffDir: string,
    options: {base: string; target: string; summary: string; hour: number},
  ): Promise<void> {
    const workspace = mkdtempSync(join(root, 'workspace-'))
    writeTree(workspace, fake.files())
    process.chdir(workspace)
    process.env.WIKI_INGEST_DATA_TIP_SHA = fake.head()
    process.env.WIKI_HANDOFF_DIR = handoffDir
    process.env.WIKI_HANDOFF_BASE_SHA = options.base
    process.env.WIKI_OPERATION = 'survey'
    process.env.WIKI_TARGET = options.target
    process.env.WIKI_SUMMARY = options.summary
    process.env.WIKI_TIMESTAMP = new Date(Date.UTC(2026, 9, 20, options.hour, 30)).toISOString()
    process.env.WIKI_OWNER = 'fro-bot'
    process.env.WIKI_REPO = '.github'
    process.env.WIKI_BRANCH = 'data'
    process.env.WIKI_COMMIT_MESSAGE = `feat(knowledge): ${options.target}`

    const applied = await validateAndApplyWikiHandoff({handoffDir, workspaceDir: workspace})
    await runWikiIngestCli({
      readCorrections: async () => ({corrections: {version: 1, corrections: []}, warnings: []}),
      // Stands in for `git status` against `main`: the pages the handoff just wrote.
      getChangedWikiPaths: async () => applied.applied.filter(path => path.startsWith('knowledge/wiki/')),
      commitWikiChanges: async params =>
        commitWikiChanges({...params, octokit: asOctokit(fake), bootstrapDataBranch: bootstrap}),
      octokit: asOctokit(fake),
    })
  }

  it('keeps both surveys log entries, index rows and pages when the second handoff is stale (2026-10-20)', async () => {
    // #given two agents sync at the same commit and each adds a page, an index row and a log entry
    const agentA = syncAgent(fake)
    const agentB = syncAgent(fake)
    agentA.files[HA_PAGE] = topic('HA Config Notes', 'Home Assistant config notes.')
    agentA.files[INDEX] = rebuildWikiIndex({existingIndex: agentA.files[INDEX], wikiFiles: agentA.files})
    agentA.files[LOG] = logEntry(agentA.files[LOG] ?? '', 'repo:alice/ha-config', 'Agent A detail.', 10)
    agentB.files[SYSTEMATIC_PAGE] = topic('Systematic Notes', 'Systematic notes.')
    agentB.files[INDEX] = rebuildWikiIndex({existingIndex: agentB.files[INDEX], wikiFiles: agentB.files})
    agentB.files[LOG] = logEntry(agentB.files[LOG] ?? '', 'repo:alice/systematic', 'Agent B detail.', 11)
    const handoffA = buildHandoff(agentA, root)
    const handoffB = buildHandoff(agentB, root)

    // #when A persists, then B persists over A's commit
    await persist(handoffA, {base: agentA.base, target: 'repo:alice/ha-config', summary: 'Summary A.', hour: 10})
    await persist(handoffB, {base: agentB.base, target: 'repo:alice/systematic', summary: 'Summary B.', hour: 11})

    // #then data holds every entry in order, both index rows, and both pages
    const data = fake.files()
    const log = data[LOG] ?? ''
    const order = ['Seed entry.', 'Agent A detail.', 'Summary A.', 'Agent B detail.', 'Summary B.'].map(text =>
      log.indexOf(text),
    )
    expect(order.every(position => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
    expect(data[INDEX]).toContain('[[ha-config-notes]]')
    expect(data[INDEX]).toContain('[[systematic-notes]]')
    expect(data[HA_PAGE]).toContain('Home Assistant config notes.')
    expect(data[SYSTEMATIC_PAGE]).toContain('Systematic notes.')
  })

  it('refuses the second writer when both surveys edited the same page, then lands the re-run (2026-10-21)', async () => {
    // #given both agents sync at the same commit and both edit the CI topic page
    const agentA = syncAgent(fake)
    const agentB = syncAgent(fake)
    agentA.files[CI_PAGE] = topic('GitHub Actions CI', 'Seed CI notes.\n\nInfra survey: pinned actions.')
    agentA.files[LOG] = logEntry(agentA.files[LOG] ?? '', 'repo:alice/infra', 'Agent A detail.', 10)
    agentB.files[CI_PAGE] = topic('GitHub Actions CI', 'Seed CI notes.\n\nMarcus survey: reusable workflows.')
    agentB.files[LOG] = logEntry(agentB.files[LOG] ?? '', 'repo:alice/marcus', 'Agent B detail.', 11)
    const handoffA = buildHandoff(agentA, root)
    const handoffB = buildHandoff(agentB, root)
    await persist(handoffA, {base: agentA.base, target: 'repo:alice/infra', summary: 'Summary A.', hour: 10})
    const headAfterA = fake.head()

    // #when B persists
    const error = await rejection(
      persist(handoffB, {base: agentB.base, target: 'repo:alice/marcus', summary: 'Summary B.', hour: 11}),
    )

    // #then it is a page conflict, and nothing was committed
    expect(error).toMatchObject({code: 'HANDOFF_PAGE_CHANGED'})
    expect(fake.head()).toBe(headAfterA)

    // #when B re-runs from a fresh sync at the new head and edits the same page
    const rerun = syncAgent(fake)
    rerun.files[CI_PAGE] = topic(
      'GitHub Actions CI',
      'Seed CI notes.\n\nInfra survey: pinned actions.\n\nMarcus survey: reusable workflows.',
    )
    rerun.files[LOG] = logEntry(rerun.files[LOG] ?? '', 'repo:alice/marcus', 'Agent B detail.', 12)
    await persist(buildHandoff(rerun, root), {
      base: rerun.base,
      target: 'repo:alice/marcus',
      summary: 'Summary B.',
      hour: 12,
    })

    // #then the page holds both contributions and the log holds every entry
    const data = fake.files()
    expect(data[CI_PAGE]).toContain('Infra survey: pinned actions.')
    expect(data[CI_PAGE]).toContain('Marcus survey: reusable workflows.')
    for (const text of ['Seed entry.', 'Agent A detail.', 'Summary A.', 'Agent B detail.', 'Summary B.']) {
      expect(data[LOG]).toContain(text)
    }
  })

  it('lands a page and keeps another writers change to a different page', async () => {
    // #given the agent syncs, edits the CI page, and another writer then changes only the old page
    const agent = syncAgent(fake)
    agent.files[CI_PAGE] = topic('GitHub Actions CI', 'Seed CI notes.\n\nAgent edit.')
    const handoff = buildHandoff(agent, root)
    fake.advance({[OLD_PAGE]: topic('Old Notes', 'Changed by another writer.')})

    // #when the writer persists
    await persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10})

    // #then both changes are on data
    const data = fake.files()
    expect(data[CI_PAGE]).toContain('Agent edit.')
    expect(data[OLD_PAGE]).toContain('Changed by another writer.')
  })

  it('removes a page the agent deleted when it is unchanged on data', async () => {
    const agent = syncAgent(fake)
    delete agent.files[OLD_PAGE]
    agent.files[LOG] = logEntry(agent.files[LOG] ?? '', 'repo:alice/infra', 'Agent detail.', 10)
    const handoff = buildHandoff(agent, root)

    await persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10})

    const data = fake.files()
    expect(data[OLD_PAGE]).toBeUndefined()
    expect(data[INDEX]).not.toContain('[[old-notes]]')
    expect(data[CI_PAGE]).toBeDefined()
    expect(data[LOG]).toContain('Agent detail.')
  })

  it('refuses a deletion when another writer edited the page after the agent synced', async () => {
    const agent = syncAgent(fake)
    delete agent.files[OLD_PAGE]
    const handoff = buildHandoff(agent, root)
    fake.advance({[OLD_PAGE]: topic('Old Notes', 'Edited by another writer.')})
    const head = fake.head()

    const error = await rejection(
      persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10}),
    )

    expect(error).toMatchObject({code: 'HANDOFF_PAGE_CHANGED'})
    expect(fake.head()).toBe(head)
  })

  it('refuses an edit when another writer deleted the page after the agent synced', async () => {
    const agent = syncAgent(fake)
    agent.files[OLD_PAGE] = topic('Old Notes', 'Agent edit.')
    const handoff = buildHandoff(agent, root)
    fake.advance({[OLD_PAGE]: null})
    const head = fake.head()

    const error = await rejection(
      persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10}),
    )

    expect(error).toMatchObject({code: 'HANDOFF_PAGE_CHANGED'})
    expect(fake.head()).toBe(head)
  })

  it('drops the agents log entries when it rewrote an earlier entry, and keeps every existing entry', async () => {
    // #given the agent rewrites the seed entry as well as appending its own
    const agent = syncAgent(fake)
    const rewritten = (agent.files[LOG] ?? '').replace('Seed entry.', 'Seed entry, rewritten.')
    agent.files[LOG] = logEntry(rewritten, 'repo:alice/infra', 'Agent detail.', 10)
    agent.files[HA_PAGE] = topic('HA Config Notes', 'Home Assistant config notes.')
    const handoff = buildHandoff(agent, root)

    // #when the writer persists
    await persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10})

    // #then only the summary entry lands, with a warning
    const log = fake.files()[LOG] ?? ''
    expect(log).toContain('Seed entry.')
    expect(log).not.toContain('rewritten')
    expect(log).not.toContain('Agent detail.')
    expect(log).toContain('Summary.')
    expect(stderr.join('')).toContain('wiki-ingest:warning:')
  })

  it('ignores a handoff that deletes the log and the index', async () => {
    const agent = syncAgent(fake)
    agent.files[HA_PAGE] = topic('HA Config Notes', 'Home Assistant config notes.')
    delete agent.files[LOG]
    delete agent.files[INDEX]
    const handoff = buildHandoff(agent, root)

    await persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10})

    const data = fake.files()
    expect(data[LOG]).toContain('Seed entry.')
    expect(data[LOG]).toContain('Summary.')
    expect(data[INDEX]).toContain('[[ha-config-notes]]')
    expect(data[INDEX]).toContain('[[old-notes]]')
  })

  it('refuses when reading the log at the agent commit fails', async () => {
    const agent = syncAgent(fake)
    agent.files[LOG] = logEntry(agent.files[LOG] ?? '', 'repo:alice/infra', 'Agent detail.', 10)
    agent.files[HA_PAGE] = topic('HA Config Notes', 'Home Assistant config notes.')
    const handoff = buildHandoff(agent, root)
    const head = fake.head()
    fake.failNext('getBlob', 500)

    await rejection(persist(handoff, {base: agent.base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10}))

    expect(fake.head()).toBe(head)
  })

  describe('an unusable agent commit', () => {
    it.each(['empty', 'malformed', 'unknown', 'not an ancestor of the head'])(
      'refuses %s without bootstrapping or writing',
      async kind => {
        const agent = syncAgent(fake)
        agent.files[HA_PAGE] = topic('HA Config Notes', 'Home Assistant config notes.')
        const handoff = buildHandoff(agent, root)
        const head = fake.head()
        let base = ''
        if (kind === 'malformed') base = 'not-a-sha'
        if (kind === 'unknown') base = 'a'.repeat(40)
        if (kind === 'not an ancestor of the head') {
          fake.createBranch('side')
          base = fake.commit('side', {'knowledge/wiki/topics/side.md': topic('Side', 'Side.')})
        }

        const error = await rejection(
          persist(handoff, {base, target: 'repo:alice/infra', summary: 'Summary.', hour: 10}),
        )

        expect(error).toMatchObject({code: 'HANDOFF_BASE_INVALID'})
        expect(bootstrap).not.toHaveBeenCalled()
        expect(fake.head()).toBe(head)
        expect(fake.calls.some(call => call.method === 'createBlob' || call.method === 'updateRef')).toBe(false)
      },
    )
  })
})
