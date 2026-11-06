/**
 * Contract tests for `.github/actions/sync-data`, the one definition of the data-branch sync every
 * workflow shares. The shell-flow cases run the action's `run:` text under bash with a stubbed `git`
 * and `sleep` (`@fro-bot/test-kit/workflow-step`), so they cost no network and no wall time. The
 * integration cases run the same text against real repositories with a real `data` branch.
 */

import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import process from 'node:process'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface ActionStep {
  name?: string
  id?: string
  run?: string
  shell?: string
  env?: Record<string, unknown>
}

interface ActionFile {
  name?: string
  inputs?: Record<string, {description?: string; required?: boolean; default?: unknown}>
  outputs?: Record<string, {description?: string; value?: string}>
  runs?: {using?: string; steps?: ActionStep[]}
}

const actionPath = resolve(import.meta.dirname, '../.github/actions/sync-data/action.yaml')
const actionSource = readFileSync(actionPath, 'utf8')
const action = parse(actionSource) as ActionFile
const syncStep = action.runs?.steps?.find(step => step.id === 'sync')
const runScript = String(syncStep?.run ?? '')
const expressionStart = '$' + '{{'

const PROBE = 'git ls-remote --exit-code origin data'
const FETCH = 'git fetch --no-tags origin data'
const REV_PARSE = 'git rev-parse FETCH_HEAD'
/** The restore a `knowledge` group gets: a mirror, so a page deleted on data is removed from the checkout. */
const restoreOf = (paths: string): string => `git restore --source FETCH_HEAD --worktree -- ${paths}`
/** The restore a `metadata` group gets: an overlay, so a tracked file only main has survives. */
const overlayOf = (paths: string): string => `git restore --source FETCH_HEAD --worktree --overlay -- ${paths}`

interface SyncOptions {
  paths?: string
  ifAbsent?: string
  retryDelay?: string
  exitSequences?: Record<string, number[]>
  lsRemoteExit?: number
  env?: Record<string, string>
  /** Files created in the step's working directory first, so a glob has something to match. */
  files?: readonly string[]
}

function runSync(options: SyncOptions = {}) {
  const env: Record<string, string> = {
    SYNC_DATA_PATHS: options.paths ?? 'knowledge',
    SYNC_DATA_IF_ABSENT: options.ifAbsent ?? 'skip',
    ...options.env,
  }
  if (options.retryDelay === undefined) {
    env.SYNC_WIKI_RETRY_DELAY_SECONDS = '0'
  } else {
    env.SYNC_WIKI_RETRY_DELAY_SECONDS = options.retryDelay
  }
  return runStepWithStubs(runScript, {
    env,
    revParseOutput: 'abc123def456',
    lsRemoteExit: options.lsRemoteExit ?? 0,
    ...(options.exitSequences === undefined ? {} : {exitSequences: options.exitSequences}),
    ...(options.files === undefined ? {} : {files: options.files}),
  })
}

describe('sync-data action: shape', () => {
  it('finds the sync step', () => {
    expect(syncStep).toBeDefined() // guards against a vacuous pass if the step were renamed or removed
  })

  it('is a composite action whose run step pins shell: bash', () => {
    expect(action.runs?.using).toBe('composite')
    expect(syncStep?.shell).toBe('bash')
  })

  it('takes two required inputs, paths and if-absent, and no token', () => {
    expect(Object.keys(action.inputs ?? {}).toSorted()).toStrictEqual(['if-absent', 'paths'])
    expect(action.inputs?.paths?.required).toBe(true)
    expect(action.inputs?.['if-absent']?.required).toBe(true)
    expect(JSON.stringify(action)).not.toMatch(/token/i)
  })

  it('declares data-sha, sourced from the sync step', () => {
    expect(action.outputs?.['data-sha']?.value).toBe(`${expressionStart} steps.sync.outputs.data-sha }}`)
  })

  it('reaches the shell through env: only, so no expression sits inside any run:', () => {
    expect(syncStep?.env).toStrictEqual({
      SYNC_DATA_PATHS: `${expressionStart} inputs.paths }}`,
      SYNC_DATA_IF_ABSENT: `${expressionStart} inputs.if-absent }}`,
    })
    for (const step of action.runs?.steps ?? []) {
      expect(String(step.run ?? '')).not.toContain(expressionStart)
    }
  })

  it('names neither a path nor a caller in its probe, fetch and absent-branch error text', () => {
    // Input-validation errors (prefixed `sync-data:`) may name the two trees the action supports.
    const errors = runScript
      .split('\n')
      .filter(line => line.includes('::error::') && !line.includes('::error::sync-data:'))
    expect(errors.length).toBeGreaterThan(0)
    for (const line of errors) {
      expect(line).not.toMatch(/knowledge|metadata|wiki/i)
    }
  })

  it('resolves FETCH_HEAD after the fetch and writes the output after the restore, once', () => {
    const fetchAt = runScript.indexOf('data branch fetch')
    const resolveAt = runScript.indexOf('git rev-parse FETCH_HEAD')
    const restoreAt = runScript.indexOf('git restore --source FETCH_HEAD')
    const writeAt = runScript.indexOf('>> "$GITHUB_OUTPUT"')

    expect(fetchAt).toBeGreaterThanOrEqual(0)
    expect(resolveAt).toBeGreaterThan(fetchAt)
    expect(restoreAt).toBeGreaterThan(resolveAt)
    expect(writeAt).toBeGreaterThan(restoreAt)
    expect(runScript.match(/GITHUB_OUTPUT/g)).toHaveLength(1)
  })

  it('fetches without a depth limit, without tags, and restores the working tree only', () => {
    expect(runScript).toContain('git fetch --no-tags origin data')
    expect(runScript).not.toMatch(/--depth|--unshallow|--shallow/)
    expect(runScript).toContain('--worktree')
    expect(runScript).not.toContain('--staged')
  })
})

describe('sync-data action: branch present (shell-flow, stubbed git)', () => {
  it('restores the listed path, writes data-sha, touches neither index nor warnings', () => {
    const run = runSync()

    expect(run.status).toBe(0)
    expect(run.outputs).toStrictEqual({'data-sha': 'abc123def456'})
    expect(run.githubOutput).toBe('data-sha=abc123def456\n')
    expect(run.stdout).not.toContain('::warning::')
    expect(run.stdout).not.toContain('not yet established')
    expect(run.trace).toStrictEqual([PROBE, FETCH, REV_PARSE, restoreOf('knowledge')])
    expect(run.trace.join('\n')).not.toMatch(/git (?:add|checkout|reset|stash|commit)\b/)
  })

  it('restores a metadata path as an overlay, never as a mirror', () => {
    const run = runSync({paths: 'metadata/'})

    expect(run.status).toBe(0)
    expect(run.trace).toStrictEqual([PROBE, FETCH, REV_PARSE, overlayOf('metadata/')])
    expect(run.outputs['data-sha']).toBe('abc123def456')
  })

  it('restores a mixed list as one mirror call for knowledge and one overlay call for metadata', () => {
    const run = runSync({paths: 'knowledge metadata/repos.yaml'})

    expect(run.status).toBe(0)
    expect(run.trace).toStrictEqual([PROBE, FETCH, REV_PARSE, restoreOf('knowledge'), overlayOf('metadata/repos.yaml')])
    expect(run.outputs['data-sha']).toBe('abc123def456')
  })

  it('groups by mode whatever order the list is written in, and several paths per group share one call', () => {
    const run = runSync({paths: 'metadata/repos.yaml knowledge/wiki metadata/other.yaml knowledge/index.md'})

    expect(run.status).toBe(0)
    expect(run.trace.slice(3)).toStrictEqual([
      restoreOf('knowledge/wiki knowledge/index.md'),
      overlayOf('metadata/repos.yaml metadata/other.yaml'),
    ])
  })

  it('splits paths on any whitespace, newlines included', () => {
    const run = runSync({paths: '  knowledge\n\tmetadata/repos.yaml  '})

    expect(run.status).toBe(0)
    expect(run.trace.slice(3)).toStrictEqual([restoreOf('knowledge'), overlayOf('metadata/repos.yaml')])
  })

  it('hands a path containing * to git restore literally, not expanded against the checkout', () => {
    // Files a glob would match, so an accidental shell expansion changes the trace instead of hiding.
    const files = ['knowledge/a.md', 'knowledge/b.md', 'knowledge/wiki/c.md', 'metadata/x.yaml', 'metadata/y.yaml']
    const knowledge = runSync({paths: 'knowledge/*', files})
    const metadata = runSync({paths: 'metadata/*', files})

    expect(knowledge.status).toBe(0)
    expect(knowledge.trace.at(-1)).toBe(restoreOf('knowledge/*'))
    expect(metadata.status).toBe(0)
    expect(metadata.trace.at(-1)).toBe(overlayOf('metadata/*'))
    // And a glob in the middle of a name, and a `?` and a bracket class.
    expect(runSync({paths: 'knowledge/*.md knowledge/?.md', files}).trace.at(-1)).toBe(
      restoreOf('knowledge/*.md knowledge/?.md'),
    )
    expect(runSync({paths: 'metadata/[xy].yaml', files}).trace.at(-1)).toBe(overlayOf('metadata/[xy].yaml'))
  })

  it('the fetch carries no depth flag', () => {
    const fetchLines = runSync().trace.filter(line => line.startsWith('git fetch'))

    expect(fetchLines).toStrictEqual([FETCH])
  })
})

describe('sync-data action: branch absent (shell-flow, stubbed git)', () => {
  it('skip: exits clean with an informational line, no data-sha, no fetch, one probe', () => {
    const run = runSync({ifAbsent: 'skip', lsRemoteExit: 2})

    expect(run.status).toBe(0)
    expect(run.stdout.toLowerCase()).toContain('not yet established')
    expect(run.stdout).not.toContain('::warning::')
    expect(run.githubOutput).toBe('')
    expect(run.trace).toStrictEqual([PROBE])
  })

  it('fail: exits non-zero with a neutral error, no data-sha, no fetch', () => {
    const run = runSync({ifAbsent: 'fail', lsRemoteExit: 2})

    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain('::error::')
    expect(run.githubOutput).toBe('')
    expect(run.trace).toStrictEqual([PROBE])
  })

  it('skip: probe fails transiently, then reports absent: skips but warns that absence followed a failure', () => {
    const run = runSync({exitSequences: {'ls-remote': [128, 2]}})

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('::warning::data branch probe returned exit 2 on attempt 2/3 after earlier failures')
    expect(run.stdout.toLowerCase()).toContain('not yet established')
    expect(run.trace).toStrictEqual([PROBE, PROBE])
  })
})

describe('sync-data action: probe and fetch failures (shell-flow, stubbed git)', () => {
  it('probe exit 128 on every attempt: fails closed after three attempts with a byte-identical ::error::, delays recorded', () => {
    const run = runSync({lsRemoteExit: 128, retryDelay: ''})

    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain(
      '::error::data branch probe failed (exit 128); refusing to continue on a possibly stale snapshot.',
    )
    expect(run.stdout.match(/::warning::/g)).toHaveLength(2)
    expect(run.trace).toStrictEqual([PROBE, PROBE, PROBE])
    expect(run.sleeps).toStrictEqual(['5', '10'])
    expect(run.githubOutput).toBe('')
  })

  it.each([1, 255])('any other probe exit (%i) fails closed naming the exit code, with no fetch', code => {
    const run = runSync({lsRemoteExit: code})

    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain(`::error::data branch probe failed (exit ${code})`)
    expect(run.trace).toStrictEqual([PROBE, PROBE, PROBE])
    expect(run.githubOutput).toBe('')
  })

  it('probe fails once, then succeeds: fetch and restore run, exactly one warning, no error', () => {
    const run = runSync({exitSequences: {'ls-remote': [128, 0]}})

    expect(run.status).toBe(0)
    expect(run.stdout).not.toContain('::error::')
    expect(run.stdout.match(/::warning::/g)).toHaveLength(1)
    expect(run.trace).toStrictEqual([PROBE, PROBE, FETCH, REV_PARSE, restoreOf('knowledge')])
  })

  it('fetch fails twice, then succeeds: restored, data-sha written, two warnings', () => {
    const run = runSync({exitSequences: {fetch: [1, 1, 0]}})

    expect(run.status).toBe(0)
    expect(run.stdout).not.toContain('::error::')
    expect(run.stdout.match(/::warning::/g)).toHaveLength(2)
    expect(run.trace).toStrictEqual([PROBE, FETCH, FETCH, FETCH, REV_PARSE, restoreOf('knowledge')])
    expect(run.outputs['data-sha']).toBe('abc123def456')
  })

  it('fetch fails every attempt: fails closed with a byte-identical ::error::, no restore, no data-sha', () => {
    const run = runSync({exitSequences: {fetch: [1]}})

    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain(
      '::error::data branch fetch failed; refusing to continue on a possibly stale snapshot.',
    )
    expect(run.stdout.match(/::warning::/g)).toHaveLength(2)
    expect(run.trace).toStrictEqual([PROBE, FETCH, FETCH, FETCH])
    expect(run.githubOutput).toBe('')
  })

  it('fails closed, with no output, when the fetched commit cannot be resolved', () => {
    const run = runSync({exitSequences: {'rev-parse': [128]}})

    expect(run.status).not.toBe(0)
    expect(run.githubOutput).toBe('')
    expect(run.trace).toStrictEqual([PROBE, FETCH, REV_PARSE])
  })

  it('restore of a path missing on data fails the step with no data-sha', () => {
    const run = runSync({paths: 'knowledge metadata/missing.yaml', exitSequences: {restore: [0, 1]}})

    expect(run.status).not.toBe(0)
    expect(run.githubOutput).toBe('')
    expect(run.trace.slice(3)).toStrictEqual([restoreOf('knowledge'), overlayOf('metadata/missing.yaml')])
  })

  it('a failing knowledge restore stops before the metadata restore and writes no data-sha', () => {
    const run = runSync({paths: 'knowledge metadata/repos.yaml', exitSequences: {restore: [1]}})

    expect(run.status).not.toBe(0)
    expect(run.githubOutput).toBe('')
    expect(run.trace.slice(3)).toStrictEqual([restoreOf('knowledge')])
  })

  it('keeps fetch output in the job log on every attempt while the probe stays silent', () => {
    const run = runSync({exitSequences: {'ls-remote': [0], fetch: [1, 0]}})

    expect(run.status).toBe(0)
    expect(run.stderr.match(/simulated fetch failure/g)).toHaveLength(1)
    expect(run.stderr).not.toContain('simulated ls-remote failure')

    const probeFails = runSync({exitSequences: {'ls-remote': [128, 0]}})
    expect(probeFails.stderr).not.toContain('simulated ls-remote failure')
  })

  it('a probe exit 2 is never retried: one probe, no warning', () => {
    const run = runSync({ifAbsent: 'skip', lsRemoteExit: 2})

    expect(run.trace.filter(line => line === PROBE)).toHaveLength(1)
    expect(run.stdout).not.toContain('::warning::')
  })
})

describe('sync-data action: input validation (fails before any git call)', () => {
  it.each(['', 'maybe', 'SKIP', 'skip fail', 'skip\nfail'])('rejects if-absent %j', ifAbsent => {
    const run = runSync({ifAbsent})

    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain('::error::')
    expect(run.trace).toStrictEqual([])
    expect(run.githubOutput).toBe('')
  })

  it('rejects an if-absent that is not set at all', () => {
    const run = runStepWithStubs(runScript, {env: {SYNC_DATA_PATHS: 'knowledge'}})

    expect(run.status).not.toBe(0)
    expect(run.trace).toStrictEqual([])
  })

  it.each(['', ' ', '\n\t ', '   \n'])('rejects empty paths %j', paths => {
    const run = runSync({paths})

    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain('::error::')
    expect(run.trace).toStrictEqual([])
    expect(run.githubOutput).toBe('')
  })

  it.each([
    'docs',
    'docs/solutions',
    'knowledgebase',
    'metadatafoo',
    'knowledge*',
    '.',
    '*',
    '/etc/passwd',
    '/knowledge',
    '../knowledge',
    'knowledge/../docs',
    'knowledge/..',
    'metadata/../.github',
    'metadata/a/../../x',
    '.github/workflows',
    '-n',
    'knowledge docs',
    'metadata/repos.yaml packages',
  ])('rejects the unsupported paths %j before any git call, whatever the branch state', paths => {
    for (const lsRemoteExit of [0, 2]) {
      const run = runSync({paths, lsRemoteExit})

      expect(run.status).not.toBe(0)
      expect(run.stdout).toContain('::error::')
      expect(run.trace).toStrictEqual([])
      expect(run.githubOutput).toBe('')
    }
  })

  it.each(['knowledge', 'knowledge/', 'knowledge/wiki/repos', 'metadata', 'metadata/', 'metadata/repos.yaml'])(
    'accepts the supported path %j',
    paths => {
      expect(runSync({paths}).status).toBe(0)
    },
  )

  it('rejects paths that are not set at all', () => {
    const run = runStepWithStubs(runScript, {env: {SYNC_DATA_IF_ABSENT: 'skip'}})

    expect(run.status).not.toBe(0)
    expect(run.trace).toStrictEqual([])
  })
})

describe('sync-data action: SYNC_WIKI_RETRY_DELAY_SECONDS', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'sync-data-pwn-'))
  afterAll(() => rmSync(scratch, {recursive: true, force: true}))

  it.each(['', '5s', `a[$(touch ${scratch}/pwned)]`])('falls back to the default delay when it is %j', delay => {
    const run = runSync({retryDelay: delay, exitSequences: {fetch: [1, 0]}})

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('retrying in 5s')
    expect(run.sleeps).toStrictEqual(['5'])
    expect(existsSync(join(scratch, 'pwned'))).toBe(false)
  })

  it('uses a numeric value as the base delay and backs off linearly', () => {
    const run = runSync({retryDelay: '2', exitSequences: {fetch: [1, 1, 1]}})

    expect(run.status).not.toBe(0)
    expect(run.sleeps).toStrictEqual(['2', '4'])
  })

  it('backs off 5s then 10s at the production default when unset', () => {
    const run = runStepWithStubs(runScript, {
      env: {SYNC_DATA_PATHS: 'knowledge', SYNC_DATA_IF_ABSENT: 'skip'},
      exitSequences: {fetch: [1, 1, 1]},
    })

    expect(run.status).not.toBe(0)
    expect(run.sleeps).toStrictEqual(['5', '10'])
  })
})

interface RealRun {
  paths: string
  ifAbsent: string
  /** The shell that runs the step. Only a test of the harness itself changes it. */
  shell?: string
  /** The script the shell runs. Only a test of the harness itself changes it. */
  script?: string
}

/**
 * Runs the action's script against a real clone. A nonzero exit of the script is a result; anything
 * else (the shell never launched, a signal ended it, a buffer overflowed) means the run proves nothing
 * and throws, so a negative case cannot pass because bash was missing.
 */
function runReal(clone: string, options: RealRun) {
  const outputFile = join(clone, '..', `github-output-${Math.random().toString(36).slice(2)}`)
  writeFileSync(outputFile, '')
  let status = 0
  let stdout = ''
  try {
    stdout = execFileSync(options.shell ?? 'bash', ['-c', options.script ?? runScript], {
      cwd: clone,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        SYNC_DATA_PATHS: options.paths,
        SYNC_DATA_IF_ABSENT: options.ifAbsent,
        SYNC_WIKI_RETRY_DELAY_SECONDS: '0',
        GITHUB_OUTPUT: outputFile,
      },
    })
  } catch (error) {
    const failure = error as {status?: unknown; signal?: unknown; stdout?: unknown}
    // A process that ran and exited reports a numeric status and no signal. Everything else is infrastructure.
    if (typeof failure.status !== 'number' || (failure.signal !== null && failure.signal !== undefined)) throw error
    status = failure.status
    stdout = String(failure.stdout ?? '')
  }
  return {status, stdout, githubOutput: readFileSync(outputFile, 'utf8')}
}

describe('sync-data action: the real-repository harness', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'sync-data-harness-'))
  const clone = join(scratch, 'clone')
  mkdirSync(clone)
  afterAll(() => rmSync(scratch, {recursive: true, force: true}))

  it('throws when the shell never launches, instead of reporting a failing exit', () => {
    expect(() => runReal(clone, {paths: 'knowledge', ifAbsent: 'skip', shell: join(scratch, 'no-such-shell')})).toThrow(
      /ENOENT/,
    )
  })

  it('throws when a signal ends the script, instead of reporting a failing exit', () => {
    expect(() => runReal(clone, {paths: 'knowledge', ifAbsent: 'skip', script: 'kill -TERM $$'})).toThrow()
  })

  it('returns a script that ran and exited nonzero as a result', () => {
    const run = runReal(clone, {paths: 'knowledge', ifAbsent: 'skip', script: 'echo ran; exit 7'})

    expect(run.status).toBe(7)
    expect(run.stdout).toBe('ran\n')
  })

  it('returns a script that exited zero as a result', () => {
    expect(runReal(clone, {paths: 'knowledge', ifAbsent: 'skip', script: 'true'}).status).toBe(0)
  })
})

describe('sync-data action: real repositories (integration)', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
    }).trim()

  interface Fixture {
    root: string
    origin: string
    dataTip: string
  }

  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
  })

  function createOrigin(options: {withData: boolean}): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'sync-data-real-'))
    roots.push(root)
    const seed = join(root, 'seed')
    const origin = join(root, 'origin.git')
    mkdirSync(seed)
    git(seed, 'init', '-q', '-b', 'main')
    mkdirSync(join(seed, 'knowledge'))
    mkdirSync(join(seed, 'metadata'))
    writeFileSync(join(seed, 'knowledge', 'page.md'), 'main page\n')
    writeFileSync(join(seed, 'metadata', 'repos.yaml'), 'main: repos\n')
    // Tracked on main only: data does not carry them (a mirror removes them, an overlay keeps them).
    writeFileSync(join(seed, 'knowledge', 'main-only.md'), 'main only page\n')
    writeFileSync(join(seed, 'metadata', 'main-only.yaml'), 'main: only\n')
    git(seed, 'add', '-A')
    git(seed, 'commit', '-q', '-m', 'main one')
    writeFileSync(join(seed, 'README.md'), 'second main commit\n')
    git(seed, 'add', '-A')
    git(seed, 'commit', '-q', '-m', 'main two')
    let dataTip = ''
    if (options.withData) {
      git(seed, 'checkout', '-q', '-b', 'data')
      writeFileSync(join(seed, 'knowledge', 'page.md'), 'data page\n')
      writeFileSync(join(seed, 'knowledge', 'only-on-data.md'), 'data only\n')
      writeFileSync(join(seed, 'metadata', 'repos.yaml'), 'data: repos\n')
      git(seed, 'rm', '-q', 'knowledge/main-only.md', 'metadata/main-only.yaml')
      git(seed, 'add', '-A')
      git(seed, 'commit', '-q', '-m', 'data one')
      writeFileSync(join(seed, 'knowledge', 'page.md'), 'data page, newest\n')
      git(seed, 'add', '-A')
      git(seed, 'commit', '-q', '-m', 'data two')
      dataTip = git(seed, 'rev-parse', 'HEAD')
      git(seed, 'checkout', '-q', 'main')
    }
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    git(seed, 'push', '-q', origin, '--all')
    return {root, origin, dataTip}
  }

  it('a shallow clone: restores the data tip, writes its SHA, leaves the index untouched', () => {
    const {root, origin, dataTip} = createOrigin({withData: true})
    const clone = join(root, 'shallow')
    git(root, 'clone', '-q', '--depth=1', '--branch', 'main', `file://${origin}`, clone)
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true')

    const run = runReal(clone, {paths: 'knowledge metadata/repos.yaml', ifAbsent: 'fail'})

    expect(run.status).toBe(0)
    expect(run.githubOutput).toBe(`data-sha=${dataTip}\n`)
    expect(readFileSync(join(clone, 'knowledge', 'page.md'), 'utf8')).toBe('data page, newest\n')
    expect(readFileSync(join(clone, 'knowledge', 'only-on-data.md'), 'utf8')).toBe('data only\n')
    expect(readFileSync(join(clone, 'metadata', 'repos.yaml'), 'utf8')).toBe('data: repos\n')
    expect(git(clone, 'diff', '--cached', '--name-only')).toBe('')
    // The restore is working-tree only, so the changes show as unstaged edits against HEAD: the knowledge
    // mirror removes the page data deleted, and the metadata overlay keeps the file only main has.
    expect(git(clone, 'diff', '--name-only').split('\n').toSorted()).toStrictEqual([
      'knowledge/main-only.md',
      'knowledge/page.md',
      'metadata/repos.yaml',
    ])
    expect(existsSync(join(clone, 'metadata', 'main-only.yaml'))).toBe(true)
    expect(git(clone, 'tag', '--list')).toBe('')
  })

  it('a full clone: restores the tip and leaves the clone unshallow', () => {
    const {root, origin, dataTip} = createOrigin({withData: true})
    const clone = join(root, 'full')
    git(root, 'clone', '-q', '--branch', 'main', `file://${origin}`, clone)
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('false')

    const run = runReal(clone, {paths: 'knowledge', ifAbsent: 'skip'})

    expect(run.status).toBe(0)
    expect(run.githubOutput).toBe(`data-sha=${dataTip}\n`)
    expect(readFileSync(join(clone, 'knowledge', 'page.md'), 'utf8')).toBe('data page, newest\n')
    // Paths the caller did not list stay as main has them.
    expect(readFileSync(join(clone, 'metadata', 'repos.yaml'), 'utf8')).toBe('main: repos\n')
    expect(existsSync(join(clone, 'metadata', 'main-only.yaml'))).toBe(true)
    expect(git(clone, 'diff', '--cached', '--name-only')).toBe('')
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('false')
    expect(git(clone, 'rev-list', '--count', dataTip)).toBe('4')
  })

  it('an absent data branch: skip exits clean with no data-sha and leaves files alone', () => {
    const {root, origin} = createOrigin({withData: false})
    const clone = join(root, 'clone')
    git(root, 'clone', '-q', `file://${origin}`, clone)

    const run = runReal(clone, {paths: 'knowledge', ifAbsent: 'skip'})

    expect(run.status).toBe(0)
    expect(run.githubOutput).toBe('')
    expect(readFileSync(join(clone, 'knowledge', 'page.md'), 'utf8')).toBe('main page\n')
  })

  it('an absent data branch: fail exits non-zero with no data-sha', () => {
    const {root, origin} = createOrigin({withData: false})
    const clone = join(root, 'clone')
    git(root, 'clone', '-q', `file://${origin}`, clone)

    const run = runReal(clone, {paths: 'knowledge', ifAbsent: 'fail'})

    expect(run.status).not.toBe(0)
    expect(run.githubOutput).toBe('')
  })

  it('a requested path that data does not carry fails the step and writes no data-sha', () => {
    const {root, origin} = createOrigin({withData: true})
    const clone = join(root, 'clone')
    git(root, 'clone', '-q', `file://${origin}`, clone)

    const run = runReal(clone, {paths: 'metadata/does-not-exist.yaml', ifAbsent: 'skip'})

    expect(run.status).not.toBe(0)
    expect(run.githubOutput).toBe('')
    // git rejects the unmatched pathspec before it writes anything.
    expect(readFileSync(join(clone, 'metadata', 'repos.yaml'), 'utf8')).toBe('main: repos\n')
  })

  function cloneFull() {
    const {root, origin, dataTip} = createOrigin({withData: true})
    const clone = join(root, 'full')
    git(root, 'clone', '-q', '--branch', 'main', `file://${origin}`, clone)
    return {clone, dataTip}
  }

  describe('restore mode follows the path group', () => {
    it('a metadata sync keeps a tracked metadata file that only main has, and updates the rest', () => {
      const {clone, dataTip} = cloneFull()

      const run = runReal(clone, {paths: 'metadata', ifAbsent: 'skip'})

      expect(run.status).toBe(0)
      expect(run.githubOutput).toBe(`data-sha=${dataTip}\n`)
      expect(readFileSync(join(clone, 'metadata', 'main-only.yaml'), 'utf8')).toBe('main: only\n')
      expect(readFileSync(join(clone, 'metadata', 'repos.yaml'), 'utf8')).toBe('data: repos\n')
      // The knowledge tree is not in the list, so it is untouched.
      expect(readFileSync(join(clone, 'knowledge', 'main-only.md'), 'utf8')).toBe('main only page\n')
      expect(git(clone, 'diff', '--cached', '--name-only')).toBe('')
    })

    it('a knowledge sync mirrors data: a page data deleted is removed, and one only data has appears', () => {
      const {clone, dataTip} = cloneFull()

      const run = runReal(clone, {paths: 'knowledge', ifAbsent: 'skip'})

      expect(run.status).toBe(0)
      expect(run.githubOutput).toBe(`data-sha=${dataTip}\n`)
      expect(existsSync(join(clone, 'knowledge', 'main-only.md'))).toBe(false)
      expect(readFileSync(join(clone, 'knowledge', 'page.md'), 'utf8')).toBe('data page, newest\n')
      expect(readFileSync(join(clone, 'knowledge', 'only-on-data.md'), 'utf8')).toBe('data only\n')
      // The metadata tree is not in the list, so it is untouched.
      expect(readFileSync(join(clone, 'metadata', 'main-only.yaml'), 'utf8')).toBe('main: only\n')
      expect(git(clone, 'diff', '--cached', '--name-only')).toBe('')
    })

    it('a mixed list does both: knowledge mirrors and metadata overlays', () => {
      const {clone, dataTip} = cloneFull()

      const run = runReal(clone, {paths: 'knowledge metadata/repos.yaml', ifAbsent: 'fail'})

      expect(run.status).toBe(0)
      expect(run.githubOutput).toBe(`data-sha=${dataTip}\n`)
      expect(existsSync(join(clone, 'knowledge', 'main-only.md'))).toBe(false)
      expect(readFileSync(join(clone, 'metadata', 'repos.yaml'), 'utf8')).toBe('data: repos\n')
      expect(readFileSync(join(clone, 'metadata', 'main-only.yaml'), 'utf8')).toBe('main: only\n')
      expect(git(clone, 'diff', '--cached', '--name-only')).toBe('')
    })

    it.each(['docs', 'README.md', 'knowledge/../README.md', 'knowledgebase', 'knowledge README.md'])(
      'an unsupported path (%j) fails before git runs: no fetch ref, no file touched, no data-sha',
      paths => {
        const {clone} = cloneFull()
        const before = git(clone, 'status', '--porcelain')

        const run = runReal(clone, {paths, ifAbsent: 'skip'})

        expect(run.status).not.toBe(0)
        expect(run.githubOutput).toBe('')
        expect(git(clone, 'status', '--porcelain')).toBe(before)
        expect(readFileSync(join(clone, 'knowledge', 'page.md'), 'utf8')).toBe('main page\n')
        // No fetch ran, so FETCH_HEAD was never written.
        expect(existsSync(join(clone, '.git', 'FETCH_HEAD'))).toBe(false)
      },
    )
  })
})
