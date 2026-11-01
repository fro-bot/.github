/**
 * Surface tier for the dispatch CLIs end to end: each test runs the real `scripts/<name>.ts` shim in a child
 * process, through the goke runner and the production CLI body with its default dependencies, against a fake
 * GitHub API (`@fro-bot/test-kit/fake-github`) that replaces `fetch` in the child. Nothing is mocked inside
 * the CLI, so a broken shim, runner config, mode wiring or per-owner client fails here.
 *
 * `cross-repo-dispatch.yaml` reads `.counts.*` from the result file with a `// 0` fallback, so a renamed key
 * would read as zero without an error: the result-file tests pin every key the workflow reads.
 */

import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {buildMarkerComment} from '@fro-bot/dispatch/dispatch-marker'
import {buildResultMarker, hashNonce, parseDecomposition} from '@fro-bot/dispatch/dispatch-receipts'
import {createFakeGithub, route, type FakeGithub, type FakeRoute} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')
const CONTROL = '/repos/fro-bot/.github'
const HOUR = 3_600_000

/** The keys `cross-repo-dispatch.yaml` reads from the result file (`:143-150` and `:290-297`). */
const WORKFLOW_DISPATCH_KEYS = [
  'refused',
  'dispatched',
  'deferred',
  'blocked',
  'reconciled',
  'skippedUnsafePrompt',
  'casDeferred',
] as const
const WORKFLOW_TRACK_KEYS = [
  'goalsProcessed',
  'itemsCompleted',
  'itemsFailed',
  'itemsBlocked',
  'itemsStillOpen',
  'goalsClosed',
  'idempotentNoop',
  'casDeferred',
] as const

const DISPATCH_COUNT_KEYS = [...WORKFLOW_DISPATCH_KEYS, 'seedRejected', 'dispatchError'].sort()
const TRACK_COUNT_KEYS = [...WORKFLOW_TRACK_KEYS, 'itemsNeedsAttention'].sort()

const REPOS_YAML = `version: 1
repos:
  - owner: fro-bot
    name: agent
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    discovery_channel: owned
    next_survey_eligible_at: null
    private: false
    node_id: R_kgDOAGENT001
  - owner: fro-bot
    name: legacy
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: false
    has_renovate: false
    discovery_channel: owned
    next_survey_eligible_at: null
    private: false
    node_id: R_kgDOLEGACY01
`

const TOKENS = JSON.stringify({'fro-bot': 'tok-fro-bot', marcusrbrown: 'tok-mrb'})
const EVENT = {label: {name: 'dispatch-approved'}, sender: {login: 'marcusrbrown'}, issue: {number: 50}}

let root = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dispatch-flows-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  fake?.cleanup()
  fake = undefined
})

function checkout(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(root, 'cwd-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), content)
  }
  return directory
}

async function run(
  script: string,
  argv: readonly string[],
  routes: readonly FakeRoute[],
  options: {
    readonly cwd?: string
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly githubOutput?: 'file' | 'unset' | 'empty'
  } = {},
): Promise<SpawnEntrypointResult> {
  const github = createFakeGithub(routes)
  fake = github
  return spawnEntrypoint({
    entrypoint: join(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: github.runtimeArgs('bun'),
    argv,
    cwd: options.cwd ?? checkout({}),
    githubOutput: options.githubOutput,
    env: {FAKE_GH_DIR: github.directory, ...options.env},
  })
}

/** Every request the run made, as logged (`METHOD /path?query auth=<token> body=<json>`), matched or not. */
function requests(): string[] {
  return (fake?.requests() ?? []).map(request => request.line)
}

function requestsTo(prefix: string): string[] {
  return requests().filter(line => line.startsWith(prefix))
}

function unhandledMutations(): string[] {
  return (fake?.unhandledMutations() ?? []).map(request => request.line)
}

function comment(id: number, body: string, login = 'fro-bot[bot]') {
  return {id, body, user: {login}}
}

function decomposition(...lines: readonly string[]): string {
  return ['<!-- fro-bot:cross-repo-items:start -->', ...lines, '<!-- fro-bot:cross-repo-items:end -->'].join('\n')
}

function sha16(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function parseCounts(text: string): Record<string, number> {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('counts' in parsed)) throw new TypeError('no counts')
  return (parsed as {counts: Record<string, number>}).counts
}

/** The result file and stdout of a finished run carry the same single JSON line. */
function expectResult(
  result: SpawnEntrypointResult,
  resultPath: string,
  keys: readonly string[],
): Record<string, number> {
  const file = readFileSync(resultPath, 'utf8')
  expect(result.stdout).toBe(file)
  expect(file.endsWith('\n')).toBe(true)
  const counts = parseCounts(file)
  expect(Object.keys(counts).sort()).toStrictEqual([...keys])
  for (const value of Object.values(counts)) expect(Number.isInteger(value)).toBe(true)
  return counts
}

function crossRepoEnv(directory: string, extra: Readonly<Record<string, string | undefined>> = {}) {
  return {
    GITHUB_REPOSITORY: 'fro-bot/.github',
    GITHUB_TOKEN: 'tok-control',
    GITHUB_EVENT_PATH: join(directory, 'event.json'),
    CROSS_REPO_DISPATCH_RESULT_PATH: join(directory, 'result.json'),
    CROSS_REPO_DISPATCH_TARGET_TOKENS: TOKENS,
    ...extra,
  }
}

const goalIssues = (...numbers: readonly number[]) =>
  route('GET', `${CONTROL}/issues`, {q: 'labels=cross-repo-goal', b: numbers.map(number => ({number}))})
const issueComments = (number: number, ...answers: readonly (readonly ReturnType<typeof comment>[])[]) =>
  route('GET', `${CONTROL}/issues/${number}/comments`, {seq: answers.map(b => ({b}))})
const anyCommentPatch = route('PATCH', String.raw`~^/repos/fro-bot/\.github/issues/comments/\d+$`, {b: {}})
const anyCommentPost = route('POST', String.raw`~^/repos/fro-bot/\.github/issues/\d+/comments$`, {s: 201, b: {id: 900}})

describe('cross-repo-dispatch dispatch (bun, cross-repo-dispatch.yaml: argv `dispatch`)', () => {
  it('a refusal removes the label and writes all nine counts to the result file and stdout', async () => {
    const cwd = checkout({
      'event.json': JSON.stringify({...EVENT, sender: {login: 'someone'}}),
      'metadata/repos.yaml': REPOS_YAML,
    })
    const result = await run(
      'cross-repo-dispatch',
      ['dispatch'],
      [route('DELETE', `${CONTROL}/issues/50/labels/dispatch-approved`, {b: []})],
      {
        cwd,
        env: crossRepoEnv(cwd),
      },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const counts = expectResult(result, join(cwd, 'result.json'), DISPATCH_COUNT_KEYS)
    expect(counts).toMatchObject({refused: 1, dispatched: 0})
    for (const key of WORKFLOW_DISPATCH_KEYS) expect(counts, key).toHaveProperty(key)
    expect(requests()).toStrictEqual([
      `DELETE /repos/fro-bot/.github/issues/50/labels/dispatch-approved auth=tok-control`,
    ])
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('a cold start seeds the marker, approves it and blocks an item whose target has no workflow', async () => {
    const cwd = checkout({'event.json': JSON.stringify(EVENT), 'metadata/repos.yaml': REPOS_YAML})
    const checklist = decomposition('- [ ] fro-bot/legacy: Touch the legacy repository')
    const parsed = parseDecomposition(checklist)
    expect(parsed.ok).toBe(true)
    const seedMarker = buildMarkerComment({goal: 'issue-50', items: parsed.items, markerHash: ''})
    const planner = comment(1, checklist)

    // Reads: the initial list; the seed write's read (no marker yet); the approval write's read (the seed marker).
    const result = await run(
      'cross-repo-dispatch',
      ['dispatch'],
      [
        goalIssues(50),
        issueComments(50, [planner], [planner], [planner, comment(77, seedMarker)]),
        anyCommentPost,
        anyCommentPatch,
      ],
      {cwd, env: crossRepoEnv(cwd)},
    )

    expect(result.exitCode).toBe(0)
    const counts = expectResult(result, join(cwd, 'result.json'), DISPATCH_COUNT_KEYS)
    expect(counts).toMatchObject({blocked: 1, dispatched: 0, casDeferred: 0, seedRejected: 0})
    expect(requestsTo('POST /repos/fro-bot/.github/issues/50/comments')).toHaveLength(1)
    expect(requestsTo('PATCH /repos/fro-bot/.github/issues/comments/77')).toHaveLength(1)
    expect(requests().filter(line => line.includes('/dispatches'))).toStrictEqual([])
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('resuming an intent item whose run exists reconciles it to dispatched, looking the run up with the target owner token', async () => {
    const cwd = checkout({'event.json': JSON.stringify(EVENT), 'metadata/repos.yaml': REPOS_YAML})
    const prompt = 'Update the agent docs'
    const correlationId = 'c0'.repeat(10)
    const intentItem = {
      id: 'item-1',
      target: {owner: 'fro-bot', name: 'agent'},
      promptHash: sha16(prompt),
      status: 'intent' as const,
      correlationId,
      nonceHash: hashNonce('n'.repeat(43)),
    }
    const marker = buildMarkerComment({goal: 'issue-50', items: [intentItem], markerHash: ''})
    const planner = comment(1, decomposition(`- [ ] fro-bot/agent: ${prompt}`))

    const result = await run(
      'cross-repo-dispatch',
      ['dispatch'],
      [
        goalIssues(50),
        issueComments(50, [planner, comment(2, marker)]),
        route('GET', '/repos/fro-bot/agent/actions/runs', {
          q: 'workflow_id=fro-bot.yaml',
          b: {
            total_count: 1,
            workflow_runs: [
              {
                id: 7,
                name: 'Fro Bot',
                display_title: `Fro Bot (${correlationId})`,
                status: 'completed',
                conclusion: 'success',
              },
            ],
          },
        }),
        anyCommentPatch,
      ],
      {cwd, env: crossRepoEnv(cwd)},
    )

    expect(result.exitCode).toBe(0)
    expect(expectResult(result, join(cwd, 'result.json'), DISPATCH_COUNT_KEYS)).toMatchObject({
      reconciled: 1,
      dispatched: 0,
      casDeferred: 0,
    })
    const lookup = requestsTo('GET /repos/fro-bot/agent/actions/runs')
    expect(lookup).toHaveLength(1)
    expect(lookup[0]).toContain('auth=tok-fro-bot')
    expect(requestsTo('PATCH /repos/fro-bot/.github/issues/comments/2')).toHaveLength(2)
    expect(requests().filter(line => line.includes('/dispatches'))).toStrictEqual([])
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('a checklist that fails the grammar is reported as seedRejected and writes nothing', async () => {
    const cwd = checkout({'event.json': JSON.stringify(EVENT), 'metadata/repos.yaml': REPOS_YAML})
    const result = await run(
      'cross-repo-dispatch',
      ['dispatch'],
      [goalIssues(50), issueComments(50, [comment(1, decomposition('- [ ] this line is not owner/name shaped'))])],
      {cwd, env: crossRepoEnv(cwd)},
    )

    expect(result.exitCode).toBe(0)
    expect(expectResult(result, join(cwd, 'result.json'), DISPATCH_COUNT_KEYS)).toMatchObject({seedRejected: 1})
    expect(requests().filter(line => !line.startsWith('GET '))).toStrictEqual([])
  })

  it('without an event path it names the variable on stderr, exits 1 and makes no request', async () => {
    const cwd = checkout({})
    const result = await run('cross-repo-dispatch', ['dispatch'], [goalIssues(50)], {
      cwd,
      env: crossRepoEnv(cwd, {GITHUB_EVENT_PATH: undefined}),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('cross-repo-dispatch: GITHUB_EVENT_PATH is required for dispatch mode\n')
    expect(requests()).toStrictEqual([])
  })

  it('without GITHUB_TOKEN it fails with its own message before any request', async () => {
    const cwd = checkout({'event.json': JSON.stringify(EVENT)})
    const result = await run('cross-repo-dispatch', ['dispatch'], [], {
      cwd,
      env: crossRepoEnv(cwd, {GITHUB_TOKEN: undefined}),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('cross-repo-dispatch: GITHUB_TOKEN is required in the environment\n')
    expect(requests()).toStrictEqual([])
  })
})

describe('cross-repo-dispatch track (bun, cross-repo-dispatch.yaml: argv `track`)', () => {
  const NONCE = 'n'.repeat(43)
  const CORRELATION = 'c1'.repeat(10)
  const PROMPT = 'Update the agent docs'

  function dispatchedItem(ageMs: number) {
    return {
      id: 'item-1',
      target: {owner: 'fro-bot', name: 'agent'},
      promptHash: sha16(PROMPT),
      status: 'dispatched' as const,
      correlationId: CORRELATION,
      nonceHash: hashNonce(NONCE),
      epoch: Date.now() - ageMs,
    }
  }

  function trackedMarker(ageMs: number): string {
    return buildMarkerComment({goal: 'issue-50', items: [dispatchedItem(ageMs)], markerHash: ''})
  }

  const receipt = (nonce: string) =>
    buildResultMarker({correlationId: CORRELATION, nonce, status: 'success', summary: 'Done.'})

  it('with no open goals it writes all nine counts as zero and nothing else', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
    const result = await run('cross-repo-dispatch', ['track'], [route('GET', `${CONTROL}/issues`, {b: []})], {
      cwd,
      env: crossRepoEnv(cwd, {GITHUB_EVENT_PATH: undefined}),
    })

    expect(result.exitCode).toBe(0)
    const counts = expectResult(result, join(cwd, 'result.json'), TRACK_COUNT_KEYS)
    expect(Object.values(counts)).toStrictEqual(TRACK_COUNT_KEYS.map(() => 0))
    for (const key of WORKFLOW_TRACK_KEYS) expect(counts, key).toHaveProperty(key)
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('an authentic receipt completes the item, closes the goal and comments the totals', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
    const comments = [comment(5, trackedMarker(HOUR)), comment(6, receipt(NONCE))]
    const result = await run(
      'cross-repo-dispatch',
      ['track'],
      [
        goalIssues(50),
        issueComments(50, comments),
        anyCommentPatch,
        anyCommentPost,
        route('PATCH', `${CONTROL}/issues/50`, {b: {}}),
      ],
      {cwd, env: crossRepoEnv(cwd, {GITHUB_EVENT_PATH: undefined})},
    )

    expect(result.exitCode).toBe(0)
    const counts = expectResult(result, join(cwd, 'result.json'), TRACK_COUNT_KEYS)
    expect(counts).toMatchObject({goalsProcessed: 1, itemsCompleted: 1, goalsClosed: 1, casDeferred: 0})
    expect(requestsTo('PATCH /repos/fro-bot/.github/issues/comments/5')).toHaveLength(1)
    const posts = requestsTo('POST /repos/fro-bot/.github/issues/50/comments')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain('Goal complete. completed=1 failed=0 blocked=0')
    const close = requestsTo('PATCH /repos/fro-bot/.github/issues/50 ')
    expect(close).toHaveLength(1)
    expect(close[0]).toContain('"state":"closed"')
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('a receipt with the wrong nonce is ignored: the item stays open and nothing is written', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
    const result = await run(
      'cross-repo-dispatch',
      ['track'],
      [goalIssues(50), issueComments(50, [comment(5, trackedMarker(HOUR)), comment(6, receipt('x'.repeat(43)))])],
      {cwd, env: crossRepoEnv(cwd, {GITHUB_EVENT_PATH: undefined})},
    )

    expect(result.exitCode).toBe(0)
    expect(expectResult(result, join(cwd, 'result.json'), TRACK_COUNT_KEYS)).toMatchObject({
      itemsStillOpen: 1,
      idempotentNoop: 1,
      itemsCompleted: 0,
    })
    expect(requests().filter(line => !line.startsWith('GET '))).toStrictEqual([])
  })

  it('past the SLA with no receipt the item needs attention, and the run lookup uses the target owner token', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
    const result = await run(
      'cross-repo-dispatch',
      ['track'],
      [
        goalIssues(50),
        issueComments(50, [comment(5, trackedMarker(25 * HOUR))]),
        route('GET', '/repos/fro-bot/agent/actions/runs', {
          q: 'workflow_id=fro-bot.yaml',
          b: {total_count: 0, workflow_runs: []},
        }),
        anyCommentPatch,
      ],
      {cwd, env: crossRepoEnv(cwd, {GITHUB_EVENT_PATH: undefined})},
    )

    expect(result.exitCode).toBe(0)
    expect(expectResult(result, join(cwd, 'result.json'), TRACK_COUNT_KEYS)).toMatchObject({
      itemsNeedsAttention: 1,
      itemsStillOpen: 1,
      goalsClosed: 0,
    })
    const lookup = requestsTo('GET /repos/fro-bot/agent/actions/runs')
    expect(lookup).toHaveLength(1)
    expect(lookup[0]).toContain('auth=tok-fro-bot')
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('a malformed GITHUB_REPOSITORY fails with its own message and exits 1', async () => {
    const cwd = checkout({})
    const result = await run('cross-repo-dispatch', ['track'], [], {
      cwd,
      env: crossRepoEnv(cwd, {GITHUB_REPOSITORY: 'nope', GITHUB_EVENT_PATH: undefined}),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('cross-repo-dispatch: GITHUB_REPOSITORY must be in owner/repo format\n')
    expect(requests()).toStrictEqual([])
  })
})

describe('cross-repo-dispatch argv (bun)', () => {
  const MODE_ERROR = 'cross-repo-dispatch: expected argv[2] to be "dispatch" or "track"\n'

  it.each([[[]], [['bogus']], [['Dispatch']]])(
    '%j keeps the expected-mode message, exits 1 and makes no request',
    async argv => {
      const cwd = checkout({'event.json': JSON.stringify(EVENT)})
      const result = await run('cross-repo-dispatch', argv, [goalIssues(50)], {cwd, env: crossRepoEnv(cwd)})

      expect(result).toMatchObject({exitCode: 1, stdout: '', stderr: MODE_ERROR})
      expect(requests()).toStrictEqual([])
    },
  )

  it.each([[['--help']], [['--bogus']], [['dispatch', 'extra']], [['track', 'extra']]])(
    '%j is a usage error: exit 1, usage on stderr, no request',
    async argv => {
      const cwd = checkout({'event.json': JSON.stringify(EVENT)})
      const result = await run('cross-repo-dispatch', argv, [goalIssues(50)], {cwd, env: crossRepoEnv(cwd)})

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
      expect(requests()).toStrictEqual([])
    },
  )
})

describe('dispatch-renovate (bun, dispatch-renovate.yaml)', () => {
  const RENOVATE = 'version: 1\nrepositories:\n  with-renovate:\n    - agent\n    - dashboard\n    - stale-repo\n'
  const installation = route('GET', '/installation/repositories', {
    b: {
      total_count: 3,
      repositories: [
        {name: 'agent', owner: {login: 'fro-bot'}},
        {name: 'dashboard', owner: {login: 'fro-bot'}},
        {name: 'unrelated', owner: {login: 'fro-bot'}},
      ],
    },
  })
  const idle = route('GET', String.raw`~^/repos/fro-bot/[^/]+/actions/workflows/renovate\.yaml/runs$`, {
    b: {total_count: 0, workflow_runs: []},
  })
  const dispatchOk = route('POST', String.raw`~^/repos/fro-bot/[^/]+/actions/workflows/renovate\.yaml/dispatches$`, {
    s: 204,
  })

  it('`plan` writes the reachable repositories to $GITHUB_OUTPUT and dispatches nothing', async () => {
    const cwd = checkout({'metadata/renovate.yaml': RENOVATE})
    const result = await run('dispatch-renovate', ['plan'], [installation], {cwd, env: {GITHUB_TOKEN: 'tok-discovery'}})

    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('repositories=agent,dashboard\n')
    expect(result.stdout).toBe('dispatch-renovate: planned 2 repositories\n')
    expect(requests()).toStrictEqual(['GET /installation/repositories auth=tok-discovery'])
  })

  it('`plan` throws without $GITHUB_OUTPUT, as the workflow step relies on', async () => {
    const cwd = checkout({'metadata/renovate.yaml': RENOVATE})
    const result = await run('dispatch-renovate', ['plan'], [installation], {
      cwd,
      env: {GITHUB_TOKEN: 'tok-discovery'},
      githubOutput: 'unset',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('GITHUB_OUTPUT is required in plan mode\n')
    expect(result.githubOutput).toBe('')
  })

  it('with no argument it dispatches each planned repository and prints the summary', async () => {
    const result = await run('dispatch-renovate', [], [idle, dispatchOk], {
      env: {GITHUB_TOKEN: 'tok-dispatch', DISPATCH_REPOSITORIES: 'agent,dashboard'},
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toStrictEqual({eligible: 2, dispatched: 2, skippedRunning: 0, failed: 0})
    expect(requestsTo('POST ')).toHaveLength(2)
    expect(requests().every(line => line.includes('auth=tok-dispatch'))).toBe(true)
    expect(unhandledMutations()).toStrictEqual([])
  })

  it('a failed dispatch prints `dispatch-renovate: failed <name>: <error>` and the run still exits 0', async () => {
    const result = await run(
      'dispatch-renovate',
      [],
      [
        idle,
        route('POST', '/repos/fro-bot/dashboard/actions/workflows/renovate.yaml/dispatches', {
          s: 422,
          b: {message: 'Workflow does not have workflow_dispatch trigger'},
        }),
        dispatchOk,
      ],
      {env: {GITHUB_TOKEN: 'tok-dispatch', DISPATCH_REPOSITORIES: 'agent,dashboard'}},
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toMatch(/^dispatch-renovate: failed dashboard: .*workflow_dispatch trigger/mu)
    expect(JSON.parse(result.stdout)).toMatchObject({dispatched: 1, failed: 1})
  })

  it('without DISPATCH_REPOSITORIES it names the variable and exits 1 before any request', async () => {
    const result = await run('dispatch-renovate', [], [idle, dispatchOk], {env: {GITHUB_TOKEN: 'tok-dispatch'}})

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('DISPATCH_REPOSITORIES is required and must name at least one repository\n')
    expect(requests()).toStrictEqual([])
  })

  // Before the runner, anything but the exact `plan` dispatched, so a typo or `--help` wrote to every repository.
  it.each([[['pln']], [['Plan']], [['--help']], [['--bogus']], [['x']], [['plan', 'extra']], [['plan', '--help']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing planned or dispatched',
    async argv => {
      const result = await run('dispatch-renovate', argv, [installation, idle, dispatchOk], {
        cwd: checkout({'metadata/renovate.yaml': RENOVATE}),
        env: {GITHUB_TOKEN: 'tok', DISPATCH_REPOSITORIES: 'agent,dashboard'},
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
      expect(result.githubOutput).toBe('')
      expect(requests()).toStrictEqual([])
    },
  )
})

describe('the shims run nothing on import', () => {
  it.each(['cross-repo-dispatch', 'dispatch-renovate'])(
    'importing scripts/%s.ts makes no request and sets no exit code',
    async script => {
      const github = createFakeGithub([])
      fake = github
      const harness = join(root, `import-${script}.ts`)
      writeFileSync(
        harness,
        `await import(${JSON.stringify(join(repoRoot, 'scripts', `${script}.ts`))})\nprocess.stdout.write(String(process.exitCode))\n`,
      )
      const result = await spawnEntrypoint({
        entrypoint: harness,
        runtime: 'bun',
        runtimeArgs: github.runtimeArgs('bun'),
        env: {FAKE_GH_DIR: github.directory},
      })

      expect(result).toMatchObject({exitCode: 0, stdout: 'undefined', stderr: '', githubOutput: ''})
      expect(requests()).toStrictEqual([])
    },
  )
})
