import type {FakeClient, FileSpec, GitDataFake} from '@fro-bot/test-kit/git-data-fake'
import type {MergeBackAlert, MergeBackOutcome} from './merge-back-data.ts'
import process from 'node:process'
import {createGitDataFake} from '@fro-bot/test-kit/git-data-fake'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {isDataOwnedPath} from '@fro-bot/core/wiki-authority'
import {DataBranchBootstrapError} from './data-branch-bootstrap.ts'
import {mergeBackData, MergeBackError, runCli} from './merge-back-data.ts'

// The Octokit the CLI builds is replaced by whatever `octokitMock.make` returns, so `runCli` runs
// against the in-memory Git Data fake, including the real `bootstrapDataBranch` and alert helper.
const octokitMock = vi.hoisted(() => ({
  constructed: [] as {auth?: string}[],
  make: undefined as undefined | (() => unknown),
}))

// The real bootstrap runs unless a test sets `override`, to make it fail the way GitHub would.
const bootstrapMock = vi.hoisted(() => ({
  override: undefined as undefined | (() => Promise<never>),
}))

vi.mock('./data-branch-bootstrap.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./data-branch-bootstrap.ts')>()
  return {
    ...actual,
    bootstrapDataBranch: async (params: Parameters<typeof actual.bootstrapDataBranch>[0]) =>
      bootstrapMock.override === undefined ? actual.bootstrapDataBranch(params) : bootstrapMock.override(),
  }
})

vi.mock('@octokit/rest', () => ({
  // A plain function: `new` on it yields the object it returns.
  Octokit: function Octokit(options: {auth?: string}) {
    octokitMock.constructed.push(options)
    return octokitMock.make?.() as object
  },
}))

function anyString(): string {
  return expect.any(String) as string
}

/** The error a promise rejects with. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (error: unknown) => error,
  )
}

const BOT = {name: 'fro-bot[bot]', email: '109017866+fro-bot[bot]@users.noreply.github.com'}

/** `main` and `data` start at one shared base commit; the tests then diverge them. */
const BASE: Record<string, FileSpec> = {
  'metadata/repos.yaml': 'row: pending\n',
  'metadata/README.md': 'readme base\n',
  '.github/workflows/a.yaml': 'workflow base\n',
  'scripts/b.ts': 'b base\n',
  'knowledge/index.md': 'index base\n',
  'knowledge/wiki/repos/old-page.md': 'old page\n',
}

function createRepo(base: Readonly<Record<string, FileSpec>> = BASE): GitDataFake {
  const fake = createGitDataFake({branch: 'data', files: base})
  fake.createBranch('main')
  return fake
}

/** Override part of the fake's Git Data surface, e.g. to make one call fail. */
function withGit(client: FakeClient, git: Partial<FakeClient['rest']['git']>): FakeClient {
  return {rest: {repos: client.rest.repos, git: {...client.rest.git, ...git}}}
}

/**
 * Makes the n-th `heads/main` read (1-based) return the current tip and then run `afterRead`, so a
 * test can move `main` or `data` right after an attempt captured the tip.
 */
function movingMain(fake: GitDataFake, afterRead: (readNumber: number) => void | Promise<void>): FakeClient {
  let reads = 0
  return withGit(fake.client, {
    getRef: async params => {
      const result = await fake.client.rest.git.getRef(params)
      if (params.ref === 'heads/main') {
        reads += 1
        await afterRead(reads)
      }
      return result
    },
  })
}

function methods(fake: GitDataFake): string[] {
  return fake.calls.map(call => call.method)
}

function writes(fake: GitDataFake, from = 0): string[] {
  return methods(fake)
    .slice(from)
    .filter(method => ['createTree', 'createCommit', 'updateRef', 'createRef'].includes(method))
}

function callsTo(fake: GitDataFake, method: string): Record<string, unknown>[] {
  return fake.calls.filter(call => call.method === method).map(call => call.args)
}

function harness(fake: GitDataFake, client: FakeClient = fake.client) {
  const alerts: MergeBackAlert[] = []
  const bootstrapDataBranch = vi.fn(async () => {
    // What the real bootstrap leaves behind: `data` one restore commit past `main`, same tree.
    fake.createBranch('data', 'main')
    fake.commit('data', {}, {message: 'chore(data): restore data branch'})
  })
  const params = {
    client,
    owner: 'fro-bot',
    repo: '.github',
    bootstrapDataBranch,
    fileAlert: async (alert: MergeBackAlert) => {
      alerts.push(alert)
    },
  }
  return {alerts, bootstrapDataBranch, params, run: async () => mergeBackData(params)}
}

function unownedFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !isDataOwnedPath(path)))
}

function shaOf(fake: GitDataFake, ref: string, path: string): string {
  const entry = fake.entries(ref).find(candidate => candidate.path === path)
  if (entry === undefined) throw new Error(`no ${path} on ${ref}`)
  return entry.sha
}

async function expectMerged(promise: Promise<MergeBackOutcome>): Promise<{commit: string; attempts: number}> {
  const outcome = await promise
  if (outcome.result !== 'merged') throw new Error(`expected a merge, got ${JSON.stringify(outcome)}`)
  return outcome
}

describe('mergeBackData: the ownership merge', () => {
  it('takes owned paths from data and everything else from main (AE2)', async () => {
    // #given main squash-promoted a row as complete (plus workflow and script changes), and data later set it to stale
    const fake = createRepo()
    fake.commit('main', {
      'metadata/repos.yaml': 'row: complete\n',
      '.github/workflows/a.yaml': 'workflow main\n',
      'scripts/b.ts': 'b main\n',
    })
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})
    const mainTip = fake.head('main')
    const dataTip = fake.head('data')
    const staleSha = shaOf(fake, 'data', 'metadata/repos.yaml')

    // #when the merge-back runs
    const {run, alerts} = harness(fake)
    const merged = await expectMerged(run())

    // #then the row reads stale, every unowned path is main's, and only the differing owned path was written
    expect(fake.files('data')['metadata/repos.yaml']).toBe('row: stale\n')
    expect(unownedFiles(fake.files('data'))).toEqual(unownedFiles(fake.files('main')))
    expect(fake.files('data')['.github/workflows/a.yaml']).toBe('workflow main\n')
    expect(callsTo(fake, 'createTree')).toEqual([
      {
        owner: 'fro-bot',
        repo: '.github',
        base_tree: anyString(),
        tree: [{path: 'metadata/repos.yaml', mode: '100644', type: 'blob', sha: staleSha}],
      },
    ])
    expect(merged.attempts).toBe(1)
    expect(fake.head('data')).toBe(merged.commit)
    expect(fake.parentsOf(merged.commit)).toEqual([mainTip, dataTip])
    expect(alerts).toEqual([])
  })

  it('writes the commit with parents [main, data], the App as author and committer, and a non-force ref update', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})
    const mainTip = fake.head('main')
    const dataTip = fake.head('data')

    const merged = await expectMerged(harness(fake).run())

    const [commitCall] = callsTo(fake, 'createCommit')
    expect(commitCall).toEqual({
      owner: 'fro-bot',
      repo: '.github',
      message: 'chore(data): merge main into data',
      tree: anyString(),
      parents: [mainTip, dataTip],
      author: BOT,
      committer: BOT,
    })
    expect(callsTo(fake, 'updateRef')).toEqual([
      {owner: 'fro-bot', repo: '.github', ref: 'heads/data', sha: merged.commit, force: false},
    ])
    expect(callsTo(fake, 'compareCommitsWithBasehead')).toEqual([
      {owner: 'fro-bot', repo: '.github', basehead: `${mainTip}...${dataTip}`},
    ])
    expect(callsTo(fake, 'getRef')).toEqual([
      {owner: 'fro-bot', repo: '.github', ref: 'heads/main'},
      {owner: 'fro-bot', repo: '.github', ref: 'heads/data'},
    ])
  })

  it('drops an owned path data deleted and adds the one it created (AE3)', async () => {
    // #given data deleted a repo page at its old slug and added one at the new slug
    const fake = createRepo()
    fake.advance({'knowledge/wiki/repos/old-page.md': null, 'knowledge/wiki/repos/z-new-page.md': 'new page\n'})
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    const newSha = shaOf(fake, 'data', 'knowledge/wiki/repos/z-new-page.md')

    // #when the merge-back runs
    await expectMerged(harness(fake).run())

    // #then the old page is gone, the new one is there, and the tree items are exactly those two, sorted by path
    const files = fake.files('data')
    expect(files).not.toHaveProperty(['knowledge/wiki/repos/old-page.md'])
    expect(files['knowledge/wiki/repos/z-new-page.md']).toBe('new page\n')
    expect(callsTo(fake, 'createTree')[0]?.tree).toEqual([
      {path: 'knowledge/wiki/repos/old-page.md', mode: '100644', type: 'blob', sha: null},
      {path: 'knowledge/wiki/repos/z-new-page.md', mode: '100644', type: 'blob', sha: newSha},
    ])
  })

  it('carries a new owned file in a new directory', async () => {
    const fake = createRepo()
    fake.advance({'knowledge/wiki/topics/deep/er/page.md': 'topic\n'})
    fake.commit('main', {'scripts/b.ts': 'b main\n'})

    await expectMerged(harness(fake).run())

    expect(fake.files('data')['knowledge/wiki/topics/deep/er/page.md']).toBe('topic\n')
  })

  it('keeps an owned path that main and data hold identically out of the tree items', async () => {
    // #given main and data both changed the index to the same content, and data alone changed the log
    const fake = createRepo()
    fake.commit('main', {'knowledge/index.md': 'index same\n'})
    fake.advance({'knowledge/index.md': 'index same\n', 'knowledge/log.md': 'log\n'})

    await expectMerged(harness(fake).run())

    // #then only the log is a tree item
    const items = callsTo(fake, 'createTree')[0]?.tree as {path: string}[]
    expect(items.map(item => item.path)).toEqual(['knowledge/log.md'])
  })

  it('carries an owned path that only differs in mode, keeping data mode and type', async () => {
    const fake = createRepo({...BASE, 'metadata/run.yaml': 'same\n'})
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/run.yaml': {content: 'same\n', mode: '100755'}})
    const sha = shaOf(fake, 'data', 'metadata/run.yaml')

    await expectMerged(harness(fake).run())

    expect(callsTo(fake, 'createTree')[0]?.tree).toEqual([
      {path: 'metadata/run.yaml', mode: '100755', type: 'blob', sha},
    ])
    expect(fake.entries('data').find(entry => entry.path === 'metadata/run.yaml')?.mode).toBe('100755')
  })

  it('carries an owned path that only differs in type', async () => {
    // #given data holds the same sha at an owned path as a submodule entry where main holds a blob
    const fake = createRepo({...BASE, 'metadata/link.yaml': 'target\n'})
    const sha = shaOf(fake, 'data', 'metadata/link.yaml')
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/link.yaml': {content: sha, type: 'commit', mode: '100644'}})

    await expectMerged(harness(fake).run())

    expect(callsTo(fake, 'createTree')[0]?.tree).toEqual([
      {path: 'metadata/link.yaml', mode: '100644', type: 'commit', sha},
    ])
  })

  it('reuses main tree and calls createTree zero times when no owned path differs', async () => {
    // #given data wrote nothing since the base, and main moved on
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    const mainTree = (await fake.client.rest.git.getCommit({owner: 'o', repo: 'r', commit_sha: fake.head('main')})).data
      .tree.sha

    // #when the merge-back runs
    const merged = await expectMerged(harness(fake).run())

    // #then data still contains main: a commit over main's own tree, written without a createTree call
    expect(methods(fake)).not.toContain('createTree')
    const commit = (await fake.client.rest.git.getCommit({owner: 'o', repo: 'r', commit_sha: merged.commit})).data
    expect(commit.tree.sha).toBe(mainTree)
    expect(fake.files('data')).toEqual(fake.files('main'))
  })

  it('removes an owned path that main has and data lacks even when data never touched it since the base', async () => {
    // #given main gained an owned page by promotion and data removed it afterwards
    const fake = createRepo()
    fake.commit('main', {'knowledge/wiki/repos/promoted.md': 'promoted\n'})
    fake.advance({'knowledge/wiki/repos/promoted.md': 'promoted\n'})
    fake.advance({'knowledge/wiki/repos/promoted.md': null})

    await expectMerged(harness(fake).run())

    expect(fake.files('data')).not.toHaveProperty(['knowledge/wiki/repos/promoted.md'])
  })
})

describe('mergeBackData: no-op and recovery', () => {
  it('writes nothing when data already contains main, on this run and on the next (AE7)', async () => {
    // #given one merge-back has already put main inside data
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})
    const {run} = harness(fake)
    await expectMerged(run())
    const tip = fake.head('data')
    const callsBefore = fake.calls.length

    // #when it runs twice more
    const first = await run()
    const second = await run()

    // #then both are no-ops with no write calls and an unmoved tip
    expect(first).toEqual({result: 'noop'})
    expect(second).toEqual({result: 'noop'})
    expect(writes(fake, callsBefore)).toEqual([])
    expect(fake.head('data')).toBe(tip)
  })

  it('bootstraps a missing data branch and writes nothing itself (AE8)', async () => {
    const fake = createRepo()
    fake.deleteBranch('data')
    const {run, bootstrapDataBranch} = harness(fake)

    const outcome = await run()

    expect(bootstrapDataBranch).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({result: 'noop'})
    expect(writes(fake)).toEqual([])
    expect(fake.hasBranch('data')).toBe(true)
  })

  it('does not bootstrap when data exists', async () => {
    const fake = createRepo()
    const {run, bootstrapDataBranch} = harness(fake)

    await run()

    expect(bootstrapDataBranch).not.toHaveBeenCalled()
  })

  it('does not bootstrap on a data read failure other than 404', async () => {
    const fake = createRepo()
    const client = withGit(fake.client, {
      getRef: async params => {
        if (params.ref === 'heads/data') throw Object.assign(new Error('boom'), {status: 500})
        return fake.client.rest.git.getRef(params)
      },
    })
    const {run, bootstrapDataBranch} = harness(fake, client)

    await expect(run()).rejects.toMatchObject({status: 500})
    expect(bootstrapDataBranch).not.toHaveBeenCalled()
  })

  it('does not bootstrap on an error without a numeric status', async () => {
    const fake = createRepo()
    const client = withGit(fake.client, {
      getRef: async params => {
        if (params.ref === 'heads/data') throw Object.assign(new Error('boom'), {status: '404'})
        return fake.client.rest.git.getRef(params)
      },
    })
    const {run, bootstrapDataBranch} = harness(fake, client)

    await expect(run()).rejects.toThrow('boom')
    expect(bootstrapDataBranch).not.toHaveBeenCalled()
  })

  it('does not bootstrap on a thrown non-object', async () => {
    const fake = createRepo()
    const client = withGit(fake.client, {
      getRef: async params => {
        // eslint-disable-next-line no-throw-literal
        if (params.ref === 'heads/data') throw 'plain string'
        return fake.client.rest.git.getRef(params)
      },
    })
    const {run, bootstrapDataBranch} = harness(fake, client)

    await expect(run()).rejects.toBe('plain string')
    expect(bootstrapDataBranch).not.toHaveBeenCalled()
  })

  it('does not bootstrap on a thrown null', async () => {
    const fake = createRepo()
    const client = withGit(fake.client, {
      getRef: async params => {
        // eslint-disable-next-line no-throw-literal
        if (params.ref === 'heads/data') throw null
        return fake.client.rest.git.getRef(params)
      },
    })
    const {run, bootstrapDataBranch} = harness(fake, client)

    await expect(run()).rejects.toBeNull()
    expect(bootstrapDataBranch).not.toHaveBeenCalled()
  })
})

describe('mergeBackData: fail closed on unowned changes (R6)', () => {
  it('writes nothing, files the alert and reports the paths when data changed an unowned file (AE4)', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/README.md': 'readme from data\n'})
    const tip = fake.head('data')
    const {run, alerts} = harness(fake)

    const outcome = await run()

    expect(outcome).toEqual({result: 'blocked', paths: ['metadata/README.md']})
    expect(writes(fake)).toEqual([])
    expect(fake.head('data')).toBe(tip)
    expect(alerts).toEqual([
      {
        title: 'Data merge-back blocked: unowned changes on data',
        body: [
          'The merge-back of `main` into `data` wrote nothing: 1 path(s) outside the data-owned set changed on `data` to content that neither the merge base nor `main` holds.',
          '',
          '- `metadata/README.md`',
          '',
          'Only the Fro Bot App writes `data`. Land the same content on `main` through an ordinary pull request, or ask the writer to stop touching these paths. Later merge-data runs stay blocked until then.',
        ].join('\n'),
      },
    ])
  })

  it('checks on a no-op run too', async () => {
    // #given data contains main already (merge base is main's tip) but carries an unowned change
    const fake = createRepo()
    fake.advance({'scripts/b.ts': 'b from data\n'})
    const {run, alerts} = harness(fake)

    const outcome = await run()

    expect(outcome).toEqual({result: 'blocked', paths: ['scripts/b.ts']})
    expect(alerts).toHaveLength(1)
    expect(writes(fake)).toEqual([])
  })

  it('passes when data changed an unowned file to exactly what main has', async () => {
    const fake = createRepo()
    fake.commit('main', {'metadata/README.md': 'readme new\n'})
    fake.advance({'metadata/README.md': 'readme new\n'})
    const {run, alerts} = harness(fake)

    await expectMerged(run())

    expect(alerts).toEqual([])
    expect(fake.files('data')['metadata/README.md']).toBe('readme new\n')
  })

  it('passes when data left an unowned file alone and main changed it', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})

    await expectMerged(harness(fake).run())

    expect(fake.files('data')['scripts/b.ts']).toBe('b main\n')
  })

  it('treats absence as a value: data deleting an unowned file main still has is a violation', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/b.ts': null})
    const {run} = harness(fake)

    expect(await run()).toEqual({result: 'blocked', paths: ['scripts/b.ts']})
  })

  it('passes when data and main both deleted the same unowned file', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': null})
    fake.advance({'scripts/b.ts': null})

    await expectMerged(harness(fake).run())

    expect(fake.files('data')).not.toHaveProperty(['scripts/b.ts'])
  })

  it('treats absence as a value: data adding an unowned file neither base nor main has is a violation', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/new.ts': 'new\n'})

    expect(await harness(fake).run()).toEqual({result: 'blocked', paths: ['scripts/new.ts']})
  })

  it('treats a mode-only change as a difference', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/b.ts': {content: 'b base\n', mode: '100755'}})

    expect(await harness(fake).run()).toEqual({result: 'blocked', paths: ['scripts/b.ts']})
  })

  it('treats a type-only change as a difference', async () => {
    const fake = createRepo()
    const sha = shaOf(fake, 'data', 'scripts/b.ts')
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/b.ts': {content: sha, type: 'commit', mode: '100644'}})

    expect(await harness(fake).run()).toEqual({result: 'blocked', paths: ['scripts/b.ts']})
  })

  it('treats a content-only change as a difference', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/b.ts': 'b changed\n'})

    expect(await harness(fake).run()).toEqual({result: 'blocked', paths: ['scripts/b.ts']})
  })

  it('reports paths sorted across data-side and base-side entries', async () => {
    // #given data deleted an unowned file only the base holds and added one only it holds
    const fake = createRepo({...BASE, 'aaa/deleted.ts': 'gone\n'})
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'aaa/deleted.ts': null, 'zzz/added.ts': 'new\n'})

    // #then the paths come back in order, not in discovery order
    expect(await harness(fake).run()).toEqual({result: 'blocked', paths: ['aaa/deleted.ts', 'zzz/added.ts']})
  })

  it('reports sorted paths and caps the listed paths at 20 with a count of the rest', async () => {
    // #given 22 unowned files added in descending order
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    const added: Record<string, string> = {}
    for (let index = 22; index >= 1; index -= 1) added[`extra/f${String(index).padStart(2, '0')}.txt`] = 'x'
    fake.advance(added)
    const {run, alerts} = harness(fake)

    // #when the merge-back runs
    const outcome = await run()

    // #then the paths come back sorted, 20 are listed, and the other 2 are counted
    expect(outcome.result === 'blocked' ? outcome.paths : []).toEqual(
      Array.from({length: 22}, (_, index) => `extra/f${String(index + 1).padStart(2, '0')}.txt`),
    )
    const lines = alerts[0]?.body.split('\n') ?? []
    expect(lines.filter(line => line.startsWith('- `'))).toHaveLength(20)
    expect(lines).toContain('- `extra/f01.txt`')
    expect(lines).toContain('- `extra/f20.txt`')
    expect(lines).not.toContain('- `extra/f21.txt`')
    expect(lines).toContain('- and 2 more')
    expect(lines[0]).toContain('22 path(s)')
  })

  it('lists exactly 20 paths with no remainder line', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    const added: Record<string, string> = {}
    for (let index = 1; index <= 20; index += 1) added[`extra/f${String(index).padStart(2, '0')}.txt`] = 'x'
    fake.advance(added)
    const {run, alerts} = harness(fake)

    await run()

    const lines = alerts[0]?.body.split('\n') ?? []
    expect(lines.filter(line => line.startsWith('- `'))).toHaveLength(20)
    expect(lines.some(line => line.includes('more'))).toBe(false)
  })

  it('still reports the block, with the alert failure status, when the alert cannot be delivered', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/b.ts': 'b changed\n'})
    const {params} = harness(fake)

    const outcome = await mergeBackData({
      ...params,
      fileAlert: async () => {
        throw Object.assign(new Error('alert failed'), {status: 403})
      },
    })

    expect(outcome).toEqual({result: 'blocked', paths: ['scripts/b.ts'], alertFailure: {status: 403}})
    expect(writes(fake)).toEqual([])
  })

  it('reports an alert failure without a status as an undefined status', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/c.ts': 'c\n'})
    fake.advance({'scripts/b.ts': 'b changed\n'})
    const {params} = harness(fake)

    const outcome = await mergeBackData({
      ...params,
      fileAlert: async () => {
        throw new Error('alert failed')
      },
    })

    expect(outcome).toEqual({result: 'blocked', paths: ['scripts/b.ts'], alertFailure: {status: undefined}})
  })
})

describe('mergeBackData: overlapping merge-backs (main moves under an attempt)', () => {
  it('retries instead of alerting when another run merged a newer main into data after this run read main (M0/M1)', async () => {
    // #given this run captured main at M0, then another run merged M1 into data, so data inherits M1's
    // changes to an unowned path
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b M0\n'})
    const other = harness(fake)
    const client = movingMain(fake, async readNumber => {
      if (readNumber !== 1) return
      fake.commit('main', {'scripts/b.ts': 'b M1\n'})
      await other.run()
    })
    const mine = harness(fake, client)

    // #when this run proceeds
    const outcome = await mine.run()

    // #then it re-reads, finds nothing unowned against the settled main, and files no alert
    expect(mine.alerts).toEqual([])
    expect(other.alerts).toEqual([])
    expect(other.alerts).toEqual([])
    expect(outcome).toEqual({result: 'noop'})
    expect(fake.files('data')['scripts/b.ts']).toBe('b M1\n')
    expect(callsTo(fake, 'getRef').filter(call => call.ref === 'heads/main').length).toBeGreaterThanOrEqual(3)
  })

  it('alerts once a retry finds the violation against a main that stayed put', async () => {
    // #given main moves once (during the first attempt) and data carries a genuine unowned write
    const fake = createRepo()
    fake.advance({'scripts/evil.ts': 'evil\n'})
    const client = movingMain(fake, readNumber => {
      if (readNumber === 1) fake.commit('main', {'scripts/c.ts': 'c\n'})
    })
    const mine = harness(fake, client)

    const outcome = await mine.run()

    expect(outcome).toEqual({result: 'blocked', paths: ['scripts/evil.ts']})
    expect(mine.alerts).toHaveLength(1)
    expect(writes(fake)).toEqual([])
  })

  it('fails with MAIN_MOVED, without an alert, when main moves on every attempt', async () => {
    const fake = createRepo()
    fake.advance({'scripts/evil.ts': 'evil\n'})
    // the first read of an attempt is odd, the pre-alert re-read is even: move main after each odd read
    const client = movingMain(fake, readNumber => {
      // bounded, so a retry loop that failed to stop at the limit would end differently instead of hanging
      if (readNumber % 2 === 1 && readNumber <= 12) fake.commit('main', {'scripts/c.ts': `c ${readNumber}\n`})
    })
    const mine = harness(fake, client)

    const error = await rejection(mine.run())

    expect(error).toMatchObject({name: 'MergeBackError', code: 'MAIN_MOVED'})
    expect((error as Error).message).toBe('merge-back-data: MAIN_MOVED')
    expect(mine.alerts).toEqual([])
    expect(writes(fake)).toEqual([])
    expect(callsTo(fake, 'getRef').filter(call => call.ref === 'heads/main')).toHaveLength(6)
  })

  it('reports the last failure when a ref race is followed by main moving', async () => {
    const fake = createRepo()
    fake.advance({'scripts/evil.ts': 'evil\n'})
    const client = movingMain(fake, readNumber => {
      if (readNumber % 2 === 1 && readNumber <= 12) fake.commit('main', {'scripts/c.ts': `c ${readNumber}\n`})
    })

    const error = await rejection(harness(fake, client).run())

    expect(error).toMatchObject({code: 'MAIN_MOVED'})
    expect((error as MergeBackError).status).toBeUndefined()
  })
})

describe('mergeBackData: tree reads', () => {
  it('reads three recursive trees (merge base, main, data)', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})

    await expectMerged(harness(fake).run())

    const reads = callsTo(fake, 'getTree')
    expect(reads).toHaveLength(3)
    expect(reads.every(read => read.recursive === 'true' && read.owner === 'fro-bot' && read.repo === '.github')).toBe(
      true,
    )
  })

  it('ignores directory entries in a recursive read', async () => {
    // #given an unowned file added under a nested directory, which the real API lists as `tree` entries too
    const fake = createRepo({...BASE, 'knowledge/wiki/repos/deep/dir/page.md': 'p\n', 'tools/x/y.ts': 'y\n'})
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'scripts/nested/x.ts': 'x\n'})

    // #then only the file is reported: no directory path leaks into the list
    expect(await harness(fake).run()).toEqual({result: 'blocked', paths: ['scripts/nested/x.ts']})
  })

  it('fails the run before any write when a tree read is truncated', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.truncate(true)

    const error = await rejection(harness(fake).run())

    expect(error).toBeInstanceOf(MergeBackError)
    expect(error).toMatchObject({code: 'TREE_TRUNCATED', message: 'merge-back-data: TREE_TRUNCATED'})
    expect(writes(fake)).toEqual([])
  })

  describe.each([
    ['a missing path', {type: 'blob', mode: '100644', sha: 'a'.repeat(40)}],
    ['a missing sha', {path: 'scripts/x.ts', type: 'blob', mode: '100644'}],
    ['a missing type', {path: 'scripts/x.ts', mode: '100644', sha: 'a'.repeat(40)}],
    ['an unknown type', {path: 'scripts/x.ts', type: 'weird', mode: '100644', sha: 'a'.repeat(40)}],
    ['a missing mode', {path: 'scripts/x.ts', type: 'blob', sha: 'a'.repeat(40)}],
    ['an unknown mode', {path: 'scripts/x.ts', type: 'blob', mode: '040000', sha: 'a'.repeat(40)}],
  ])('a malformed tree entry: %s', (_label, entry) => {
    it('fails the run before any write', async () => {
      const fake = createRepo()
      fake.commit('main', {'scripts/b.ts': 'b main\n'})
      const client = withGit(fake.client, {
        getTree: async () => ({data: {sha: 'tree', truncated: false, tree: [entry]}}),
      })

      const error = await rejection(harness(fake, client).run())

      expect(error).toMatchObject({name: 'MergeBackError', code: 'TREE_MALFORMED'})
      expect(writes(fake)).toEqual([])
    })
  })

  it.each(['100644', '100755', '120000'])('accepts a %s blob entry', async mode => {
    const fake = createRepo({...BASE, 'tools/special': {content: 'x', mode}})
    fake.commit('main', {'scripts/b.ts': 'b main\n'})

    await expectMerged(harness(fake).run())
  })

  it('accepts a 160000 submodule entry', async () => {
    const fake = createRepo({...BASE, 'vendor/sub': {content: 'c'.repeat(40), mode: '160000', type: 'commit'}})
    fake.commit('main', {'scripts/b.ts': 'b main\n'})

    await expectMerged(harness(fake).run())
    expect(fake.entries('data').find(entry => entry.path === 'vendor/sub')?.type).toBe('commit')
  })
})

describe('mergeBackData: retries on a moved ref (R7)', () => {
  it('rebuilds on the new tip and keeps a concurrent owned write (AE5)', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})
    // #given an owned write lands just before the first ref update
    fake.beforeUpdateRef(1, () => {
      fake.advance({'knowledge/log.md': 'log from a concurrent writer\n'})
    })

    // #when the merge-back runs
    const merged = await expectMerged(harness(fake).run())

    // #then the second attempt wins and carries the concurrent write
    expect(merged.attempts).toBe(2)
    expect(fake.files('data')['knowledge/log.md']).toBe('log from a concurrent writer\n')
    expect(fake.files('data')['metadata/repos.yaml']).toBe('row: stale\n')
    expect(callsTo(fake, 'updateRef')).toHaveLength(2)
    expect(callsTo(fake, 'getRef').filter(call => call.ref === 'heads/main')).toHaveLength(2)
    expect(callsTo(fake, 'getTree')).toHaveLength(6)
  })

  it('fails the re-check when the concurrent write is unowned and novel (AE6)', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})
    fake.beforeUpdateRef(1, () => {
      fake.advance({'scripts/evil.ts': 'evil\n'})
    })
    const {run, alerts} = harness(fake)

    const outcome = await run()

    expect(outcome).toEqual({result: 'blocked', paths: ['scripts/evil.ts']})
    expect(alerts).toHaveLength(1)
    // data holds only the concurrent writer's commit: ours was never written
    expect(fake.files('data')['scripts/evil.ts']).toBe('evil\n')
    expect(fake.parentsOf(fake.head('data'))).toHaveLength(1)
    expect(callsTo(fake, 'updateRef')).toHaveLength(1)
  })

  it.each([409, 422])('retries once on a %i from updateRef', async status => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.failNext('updateRef', status)

    const merged = await expectMerged(harness(fake).run())

    expect(merged.attempts).toBe(2)
    expect(callsTo(fake, 'updateRef')).toHaveLength(2)
  })

  it('fails with the last status after 3 attempts and leaves data unchanged', async () => {
    // #given a concurrent owned write lands before every update
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    for (const attempt of [1, 2, 3, 4]) {
      fake.beforeUpdateRef(attempt, () => {
        fake.advance({'knowledge/log.md': `log ${attempt}\n`})
      })
    }

    // #when the merge-back runs
    const error = await rejection(harness(fake).run())

    // #then it stops at 3 attempts, and data holds only the concurrent writers' commits
    expect(error).toMatchObject({name: 'MergeBackError', code: 'RETRIES_EXHAUSTED', status: 422})
    expect((error as Error).message).toBe('merge-back-data: RETRIES_EXHAUSTED (status=422)')
    expect(callsTo(fake, 'updateRef')).toHaveLength(3)
    expect(callsTo(fake, 'getRef').filter(call => call.ref === 'heads/main')).toHaveLength(3)
    expect(fake.files('data')['knowledge/log.md']).toBe('log 3\n')
    expect(fake.parentsOf(fake.head('data'))).toHaveLength(1)
  })

  it('reports a 409 as the last status when every update says 409', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    const client = withGit(fake.client, {
      updateRef: async () => {
        throw Object.assign(new Error('moved'), {status: 409})
      },
    })

    const error = await rejection(harness(fake, client).run())

    expect(error).toMatchObject({code: 'RETRIES_EXHAUSTED', status: 409})
  })

  it('does not retry an updateRef failure other than 409 or 422', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.failNext('updateRef', 500)

    await expect(harness(fake).run()).rejects.toMatchObject({status: 500})
    expect(callsTo(fake, 'updateRef')).toHaveLength(1)
  })

  it('does not retry an updateRef failure without a numeric status', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    const client = withGit(fake.client, {
      updateRef: async () => {
        throw Object.assign(new Error('odd'), {status: '409'})
      },
    })

    await expect(harness(fake, client).run()).rejects.toThrow('odd')
  })
})

describe('mergeBackData: terminal errors', () => {
  it('does not retry a createTree failure', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/repos.yaml': 'row: stale\n'})
    fake.failNext('createTree', 422)

    await expect(harness(fake).run()).rejects.toMatchObject({status: 422})

    expect(callsTo(fake, 'createTree')).toHaveLength(1)
    expect(methods(fake)).not.toContain('createCommit')
    expect(methods(fake)).not.toContain('updateRef')
  })

  it('does not retry a createCommit failure', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.failNext('createCommit', 409)

    await expect(harness(fake).run()).rejects.toMatchObject({status: 409})

    expect(callsTo(fake, 'createCommit')).toHaveLength(1)
    expect(methods(fake)).not.toContain('updateRef')
  })
})

describe('mergeBackData: branch safety', () => {
  it('asks whether data is writable before any write, and allows the canonical protected data branch', async () => {
    const fake = createGitDataFake({branch: 'data', files: BASE, protectedBranch: true})
    fake.createBranch('main')
    fake.commit('main', {'scripts/b.ts': 'b main\n'})

    await expectMerged(harness(fake).run())

    const order = methods(fake)
    const probe = callsTo(fake, 'getBranch')
    expect(probe).toEqual([{owner: 'fro-bot', repo: '.github', branch: 'data'}])
    expect(order.indexOf('getBranch')).toBeLessThan(order.indexOf('createCommit'))
  })

  it('refuses a protected data branch of any other repository', async () => {
    const fake = createGitDataFake({branch: 'data', files: BASE, protectedBranch: true})
    fake.createBranch('main')
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    const {params} = harness(fake)

    const error = await rejection(mergeBackData({...params, owner: 'someone', repo: 'else'}))

    expect(error).toMatchObject({name: 'MergeBackError', code: 'PROTECTED_BRANCH'})
    expect((error as Error).message).toBe('merge-back-data: PROTECTED_BRANCH')
    expect(writes(fake)).toEqual([])
  })
})

describe('MergeBackError', () => {
  it('carries the code and status, and omits the status when there is none', () => {
    const withStatus = new MergeBackError('RETRIES_EXHAUSTED', 409)
    const without = new MergeBackError('TREE_TRUNCATED')

    expect(withStatus).toMatchObject({name: 'MergeBackError', code: 'RETRIES_EXHAUSTED', status: 409})
    expect(withStatus.message).toBe('merge-back-data: RETRIES_EXHAUSTED (status=409)')
    expect(without.status).toBeUndefined()
    expect(without.message).toBe('merge-back-data: TREE_TRUNCATED')
  })
})

describe('runCli', () => {
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    stdout = []
    stderr = []
    octokitMock.constructed.length = 0
    octokitMock.make = undefined
    bootstrapMock.override = undefined
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  interface Issue {
    number: number
    title: string
    body?: string
  }

  /** The fake as an Octokit: the Git Data surface plus the issue calls the alert helper makes. */
  function octokitFor(fake: GitDataFake, issues: Issue[] = [], createError?: Error) {
    const created: {title: string; body: string}[] = []
    const updated: {issue_number: number; body: string}[] = []
    const listForRepo = async () => ({data: issues})
    const octokit = {
      paginate: async (route: () => Promise<{data: Issue[]}>) => (await route()).data,
      rest: {
        ...fake.client.rest,
        issues: {
          listForRepo,
          create: async (params: {title: string; body: string}) => {
            if (createError !== undefined) throw createError
            created.push(params)
            return {data: {number: 900}}
          },
          update: async (params: {issue_number: number; body: string}) => {
            updated.push(params)
            return {data: {}}
          },
        },
      },
    }
    octokitMock.make = () => octokit
    return {created, updated}
  }

  it('fails with MISSING_TOKEN, before building a client, when GITHUB_TOKEN is unset or empty', async () => {
    expect(await runCli({})).toBe(1)
    expect(await runCli({GITHUB_TOKEN: ''})).toBe(1)

    expect(stderr).toEqual(['::error::merge-back-data: MISSING_TOKEN\n', '::error::merge-back-data: MISSING_TOKEN\n'])
    expect(octokitMock.constructed).toEqual([])
  })

  it('builds the client with the token and prints the merge on success', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    octokitFor(fake)

    const code = await runCli({GITHUB_TOKEN: 'tok'})

    expect(code).toBe(0)
    expect(octokitMock.constructed).toEqual([{auth: 'tok'}])
    expect(stdout).toEqual([`${JSON.stringify({result: 'merged', attempts: 1, commit: fake.head('data')})}\n`])
    expect(stderr).toEqual([])
    expect(callsTo(fake, 'getRef')[0]).toEqual({owner: 'fro-bot', repo: '.github', ref: 'heads/main'})
  })

  it('prints a no-op as such', async () => {
    octokitFor(createRepo())

    const code = await runCli({GITHUB_TOKEN: 'tok'})

    expect(code).toBe(0)
    expect(stdout).toEqual(['{"result":"noop"}\n'])
  })

  it('bootstraps a missing data branch with the real bootstrap and writes no merge (AE8)', async () => {
    const fake = createRepo()
    fake.deleteBranch('data')
    octokitFor(fake)

    const code = await runCli({GITHUB_TOKEN: 'tok'})

    expect(code).toBe(0)
    expect(stdout).toEqual(['{"result":"noop"}\n'])
    expect(callsTo(fake, 'createRef')).toEqual([
      {owner: 'fro-bot', repo: '.github', ref: 'refs/heads/data', sha: anyString()},
    ])
    expect(methods(fake)).not.toContain('updateRef')
    expect(fake.hasBranch('data')).toBe(true)
  })

  it('files the alert through the issue helper and exits 1 when blocked (AE4)', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/README.md': 'readme from data\n'})
    const {created, updated} = octokitFor(fake)

    const code = await runCli({GITHUB_TOKEN: 'tok'})

    expect(code).toBe(1)
    expect(created).toHaveLength(1)
    expect(created[0]?.title).toBe('Data merge-back blocked: unowned changes on data')
    expect(created[0]?.body).toContain('`metadata/README.md`')
    expect(updated).toEqual([])
    expect(stdout).toEqual([])
    expect(stderr).toEqual([
      '::error::merge-back-data: BLOCKED (unowned_paths=1). Nothing was written; an alert issue was filed.\n',
    ])
    expect(writes(fake)).toEqual([])
  })

  it('keeps the block visible, with the alert failure status, when the alert cannot be filed', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/README.md': 'readme from data\n'})
    octokitFor(fake, [], Object.assign(new Error('secret detail from upstream'), {status: 403}))

    const code = await runCli({GITHUB_TOKEN: 'tok'})

    expect(code).toBe(1)
    expect(stderr).toEqual([
      '::error::merge-back-data: BLOCKED (unowned_paths=1). Nothing was written.\n',
      '::error::merge-back-data: ALERT_DELIVERY_FAILED (status=403)\n',
    ])
    // the repository is public: neither a path name nor an upstream message may reach the output
    expect(stderr.join('')).not.toContain('README')
    expect(stderr.join('')).not.toContain('secret')
    expect(stdout).toEqual([])
    expect(writes(fake)).toEqual([])
  })

  it('prints ALERT_DELIVERY_FAILED without a status when the alert failure has none', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/README.md': 'readme from data\n'})
    octokitFor(fake, [], new Error('network'))

    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)

    expect(stderr).toEqual([
      '::error::merge-back-data: BLOCKED (unowned_paths=1). Nothing was written.\n',
      '::error::merge-back-data: ALERT_DELIVERY_FAILED\n',
    ])
  })

  it('updates the existing alert instead of filing a second one', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.advance({'metadata/README.md': 'readme from data\n'})
    const {created, updated} = octokitFor(fake, [
      {number: 77, title: 'Data merge-back blocked: unowned changes on data'},
    ])

    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)

    expect(created).toEqual([])
    expect(updated).toHaveLength(1)
    expect(updated[0]?.issue_number).toBe(77)
  })

  it('prints a MergeBackError as its fixed code line', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.truncate(true)
    octokitFor(fake)

    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)

    expect(stderr).toEqual(['::error::merge-back-data: TREE_TRUNCATED\n'])
  })

  it('prints an API failure as its status only, never the upstream message', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    fake.failNext('createCommit', 422, 'secret detail from upstream')
    octokitFor(fake)

    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)

    expect(stderr).toEqual(['::error::merge-back-data: API_ERROR (status=422)\n'])
    expect(stderr.join('')).not.toContain('secret')
  })

  it('prints a bootstrap failure as BOOTSTRAP_<code>, never as UNEXPECTED_FAILURE', async () => {
    // #given data is missing and the bootstrap cannot find main
    const fake = createRepo()
    fake.deleteBranch('data')
    octokitFor(fake)
    bootstrapMock.override = async () => {
      throw new DataBranchBootstrapError({
        code: 'MAIN_BRANCH_NOT_FOUND',
        message: 'secret detail from upstream',
        remediation: 'restore main',
      })
    }

    // #then the run fails with the fixed code line only
    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)
    expect(stderr).toEqual(['::error::merge-back-data: BOOTSTRAP_MAIN_BRANCH_NOT_FOUND\n'])
    expect(stdout).toEqual([])
  })

  it('prints an error whose status is not a number as UNEXPECTED_FAILURE', async () => {
    const fake = createRepo()
    fake.commit('main', {'scripts/b.ts': 'b main\n'})
    octokitFor(fake)
    octokitMock.make = () => ({
      paginate: vi.fn(),
      rest: {
        ...fake.client.rest,
        git: {
          ...fake.client.rest.git,
          createCommit: async () => {
            throw Object.assign(new Error('odd'), {status: '422'})
          },
        },
      },
    })

    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)

    expect(stderr).toEqual(['::error::merge-back-data: UNEXPECTED_FAILURE\n'])
  })

  it('prints an error without a status as UNEXPECTED_FAILURE', async () => {
    octokitMock.make = () => {
      throw new Error('constructor blew up: ghs_token')
    }

    expect(await runCli({GITHUB_TOKEN: 'tok'})).toBe(1)

    expect(stderr).toEqual(['::error::merge-back-data: UNEXPECTED_FAILURE\n'])
  })
})

describe('CLI self-invoke guard (import.meta.url === file://<argv[1]>)', () => {
  const originalArgv = [...process.argv]
  const originalToken = process.env.GITHUB_TOKEN
  const originalExitCode = process.exitCode

  afterEach(() => {
    vi.restoreAllMocks()
    process.argv = originalArgv
    process.exitCode = originalExitCode
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
  })

  it('runs the CLI and sets process.exitCode without calling process.exit when invoked as the entry script', async () => {
    const modulePath = new URL('./merge-back-data.ts', import.meta.url)
    const fake = createRepo()
    octokitMock.make = () => ({paginate: vi.fn(), rest: fake.client.rest})
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    process.env.GITHUB_TOKEN = 'tok'
    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname]
    process.exitCode = undefined

    await import(`${modulePath.href}?guard-test-entry`)

    expect(out).toEqual(['{"result":"noop"}\n'])
    expect(process.exitCode).toBe(0)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('stays inert when imported without being the entry script', async () => {
    const modulePath = new URL('./merge-back-data.ts', import.meta.url)
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    process.argv = [originalArgv[0] ?? 'node', '/somewhere/else.ts']
    process.exitCode = undefined

    await import(`${modulePath.href}?guard-test-inert`)

    expect(write).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })
})
