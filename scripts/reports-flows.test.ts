/**
 * Surface tier for the `@fro-bot/reports` CLIs end to end: each test runs the real `scripts/<name>.ts`
 * shim in a child process under Bun, the callers' runtime, through the goke runner and the production
 * module with its default dependencies. The GitHub API is the fake GitHub (a `fetch` preload) and the
 * gateway is a local HTTP server, so nothing reaches a network. Nothing inside a CLI is mocked, so a
 * broken shim, runner config, env wiring or output path fails here.
 *
 * The workflows read these from the CLIs:
 * - `improvement-metrics.yaml`: the digest file detect writes (`.digest.state`, `.edges`) and the result
 *   file report writes (`.outcome .tokenLoadFailure .digestReadFailure`); detect's stdout is a different,
 *   flat shape.
 * - `fro-bot.yaml`: `.repos_tracked .surveys_today .count_status` from `daily-digest-counts`, read out of
 *   `RESULT="$(...)"` under `set -euo pipefail`.
 * - the three announce steps: `gateway-announce` exits 0 on every outcome and POSTs the signed event.
 *
 * Every test runs in a test-owned temp checkout that is both the working directory and the target of
 * every write. The child processes read the real clock, so every date in a fixture is generated relative
 * to `Date.now()` and none is a literal that a lookback window could exclude later. The last test checks
 * the real checkout is untouched, with a positive control that proves the check can see a write.
 */

import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {createHash, createHmac} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingHttpHeaders, type Server} from 'node:http'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve} from 'node:path'
import process from 'node:process'
import {
  createFakeGithub,
  fakeGithubPreloadPath,
  route,
  type FakeGithub,
  type FakeRoute,
} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

let root = ''
const fakes: FakeGithub[] = []

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'reports-flows-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  for (const github of fakes.splice(0)) github.cleanup()
})

/** The real checkout, listed before any test runs: the final test compares it with the tree after every flow. */
const realCheckoutBefore = snapshotTree(repoRoot, ['docs/solutions', 'metadata', 'knowledge'])

/** A map of every file under `paths` (relative to `base`) to its digest. A missing path contributes nothing. */
function snapshotTree(base: string, paths: readonly string[]): Map<string, string> {
  const files = new Map<string, string>()
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return
    for (const entry of readdirSync(absolute, {withFileTypes: true})) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) {
        files.set(relative(base, child), createHash('sha256').update(readFileSync(child)).digest('hex'))
      }
    }
  }
  for (const path of paths) visit(join(base, path))
  return files
}

/** A test-owned directory holding `files`. */
function checkout(files: Readonly<Record<string, string>> = {}): string {
  const directory = mkdtempSync(join(root, 'cwd-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), content)
  }
  return directory
}

function git(cwd: string, args: readonly string[], date?: string): void {
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        ...(date === undefined ? {} : {GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date}),
      },
    },
  )
}

const DAY = 24 * 60 * 60 * 1000
/** An ISO timestamp `days` before now. The child reads the same clock, a few seconds later. */
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString()

interface RunOptions {
  readonly argv?: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly cwd?: string
  readonly routes?: readonly FakeRoute[]
}

async function run(script: string, options: RunOptions = {}): Promise<SpawnEntrypointResult> {
  const github = options.routes === undefined ? undefined : createFakeGithub(options.routes)
  if (github !== undefined) fakes.push(github)
  return spawnEntrypoint({
    entrypoint: resolve(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: github === undefined ? ['--no-install', '--no-env-file'] : github.runtimeArgs('bun'),
    argv: options.argv,
    cwd: options.cwd ?? checkout(),
    env: {...(github === undefined ? {} : {FAKE_GH_DIR: github.directory}), ...options.env},
  })
}

/**
 * Runs `shim` under a shell script the way a workflow step does. `$1` is the shim, `$2` the fake GitHub
 * preload and the rest are `argv`: the paths are positional arguments, never interpolated into the script.
 */
async function runShell(
  shell: readonly string[],
  script: string,
  shim: string,
  options: {
    readonly env?: Record<string, string | undefined>
    readonly cwd?: string
    readonly argv?: readonly string[]
    readonly routes?: readonly FakeRoute[]
  },
) {
  const github = createFakeGithub(options.routes ?? [])
  fakes.push(github)
  return spawnEntrypoint({
    entrypoint: script,
    argv: ['_', resolve(repoRoot, 'scripts', `${shim}.ts`), fakeGithubPreloadPath, ...(options.argv ?? [])],
    executable: 'bash',
    runtimeArgs: [...shell, '-c'],
    cwd: options.cwd ?? checkout(),
    env: {FAKE_GH_DIR: github.directory, ...options.env},
  })
}

function requests(): string[] {
  return (fakes.at(-1)?.requests() ?? []).map(request => request.line)
}

function unhandledMutations(): string[] {
  return (fakes.at(-1)?.unhandledMutations() ?? []).map(request => request.line)
}

const REPOS_YAML = `version: 1
repos:
  - owner: acme
    name: widgets
    added: 2026-04-17
    onboarding_status: onboarded
    last_survey_at: 2026-10-20
    last_survey_status: success
    has_fro_bot_workflow: false
    has_renovate: true
    next_survey_eligible_at: 2026-11-19
    discovery_channel: collab
    private: false
    node_id: R_kgDOAAAAAA
    database_id: 100
  - owner: secretco
    name: vault
    added: 2026-04-17
    onboarding_status: onboarded
    last_survey_at: 2026-10-20
    last_survey_status: success
    has_fro_bot_workflow: false
    has_renovate: false
    next_survey_eligible_at: 2026-11-19
    discovery_channel: collab
    private: true
    node_id: R_kgDOCCCCCC
    database_id: 987654
`

// ---------------------------------------------------------------------------------------------------------------
// gateway-announce
// ---------------------------------------------------------------------------------------------------------------
interface GatewayRequest {
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

interface Gateway {
  readonly url: string
  readonly received: GatewayRequest[]
  readonly close: () => Promise<void>
}

/** A local gateway that answers `statuses` in order (the last repeats) and records every request. */
async function startGateway(statuses: readonly number[]): Promise<Gateway> {
  const received: GatewayRequest[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const status = statuses[Math.min(received.length, statuses.length - 1)] ?? 200
      received.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      response.writeHead(status, {'content-type': 'application/json'})
      response.end('{}')
    })
  })
  await new Promise<void>(resolveListening => {
    server.listen(0, '127.0.0.1', resolveListening)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${String(port)}/presence`,
    received,
    close: async () =>
      new Promise<void>(resolveClosed => {
        server.close(() => {
          resolveClosed()
        })
        server.closeAllConnections()
      }),
  }
}

const SECRET = 'flows-secret-do-not-print'
const DIGEST_CONTEXT = {repos_tracked: 14, surveys_today: 3, report_url: 'https://github.com/fro-bot/.github/issues/99'}

function announceEnv(gateway: Gateway, overrides: Record<string, string | undefined> = {}) {
  return {
    EVENT_TYPE: 'daily_digest',
    EVENT_CONTEXT_JSON: JSON.stringify(DIGEST_CONTEXT),
    GATEWAY_PRESENCE_URL: gateway.url,
    GATEWAY_WEBHOOK_SECRET: SECRET,
    ...overrides,
  }
}

async function withGateway<T>(statuses: readonly number[], body: (gateway: Gateway) => Promise<T>): Promise<T> {
  const gateway = await startGateway(statuses)
  try {
    return await body(gateway)
  } finally {
    await gateway.close()
  }
}

describe('gateway-announce through scripts/gateway-announce.ts', () => {
  it.each([
    ['invitation_accepted', {count: 2, repos: ['acme/widgets', 'acme/gadgets']}],
    ['survey_completed', {owner: 'acme', repo: 'widgets', slug: 'acme/widgets', wiki_pages_changed: 3}],
    ['daily_digest', DIGEST_CONTEXT],
  ])('posts the signed %s event once and exits 0', async (eventType, context) => {
    await withGateway([200], async gateway => {
      const result = await run('gateway-announce', {
        env: announceEnv(gateway, {EVENT_TYPE: eventType, EVENT_CONTEXT_JSON: JSON.stringify(context)}),
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"posted":true,"status":200}\n')
      expect(result.stderr).toBe('')
      expect(gateway.received).toHaveLength(1)
      const [received] = gateway.received
      expect(received?.method).toBe('POST')
      expect(received?.headers['content-type']).toBe('application/json')
      // The body is the exact bytes that were signed: fixed key order, the timestamp in the body and in the header.
      const timestamp = String(received?.headers['x-gateway-timestamp'])
      expect(received?.body).toBe(
        JSON.stringify({v: 1, event_type: eventType, fired_at: timestamp, context, rendered_text: null}),
      )
      expect(received?.headers['x-gateway-signature']).toBe(
        createHmac('sha256', SECRET)
          .update(`${timestamp}.${received?.body ?? ''}`)
          .digest('hex'),
      )
    })
  })

  it('never prints the secret or the signature, on success or on a non-2xx', async () => {
    for (const status of [200, 404]) {
      await withGateway([status], async gateway => {
        const result = await run('gateway-announce', {env: announceEnv(gateway)})
        const signature = String(gateway.received[0]?.headers['x-gateway-signature'])
        expect(signature).toMatch(/^[a-f0-9]{64}$/u)
        for (const output of [result.stdout, result.stderr]) {
          expect(output).not.toContain(SECRET)
          expect(output).not.toContain(signature)
          expect(output).not.toContain(DIGEST_CONTEXT.report_url)
        }
      })
    }
  })

  it('exits 0 and posts nothing on the kill switch, even when EVENT_TYPE is missing', async () => {
    await withGateway([200], async gateway => {
      const result = await run('gateway-announce', {
        env: announceEnv(gateway, {GATEWAY_ANNOUNCE_DISABLED: 'true', EVENT_TYPE: undefined}),
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"posted":false,"skipped":"kill-switch"}\n')
      expect(result.stderr).toBe('gateway-announce: kill switch active; skipping POST\n')
      expect(gateway.received).toEqual([])
    })
  })

  it.each([
    ['a missing EVENT_TYPE', {EVENT_TYPE: undefined}, 'missing-event-type', 'gateway-announce: EVENT_TYPE not set\n'],
    [
      'an unknown EVENT_TYPE',
      {EVENT_TYPE: 'repo_exploded'},
      'invalid-event-type',
      'gateway-announce: EVENT_TYPE is not a valid event type class\n',
    ],
    [
      'a missing EVENT_CONTEXT_JSON',
      {EVENT_CONTEXT_JSON: undefined},
      'missing-context',
      'gateway-announce: EVENT_CONTEXT_JSON not set\n',
    ],
    [
      'a context that is not an object',
      {EVENT_CONTEXT_JSON: '[1]'},
      'malformed-context',
      'gateway-announce: malformed EVENT_CONTEXT_JSON: context must be a JSON object\n',
    ],
  ])(
    'exits 0 with the failure on stdout and a gateway-announce line on stderr for %s',
    async (_name, overrides, failure, stderr) => {
      await withGateway([200], async gateway => {
        const result = await run('gateway-announce', {env: announceEnv(gateway, overrides)})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe(`{"posted":false,"failure":"${failure}"}\n`)
        expect(result.stderr).toBe(stderr)
        expect(gateway.received).toEqual([])
      })
    },
  )

  it('exits 0 on malformed context JSON', async () => {
    await withGateway([200], async gateway => {
      const result = await run('gateway-announce', {env: announceEnv(gateway, {EVENT_CONTEXT_JSON: '{'})})
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({posted: false, failure: 'malformed-context'})
      expect(result.stderr).toBe('gateway-announce: malformed EVENT_CONTEXT_JSON\n')
      expect(gateway.received).toEqual([])
    })
  })

  it.each([
    ['GATEWAY_WEBHOOK_SECRET', 'gateway-announce: missing config (GATEWAY_WEBHOOK_SECRET not set); skipping POST\n'],
    ['GATEWAY_PRESENCE_URL', 'gateway-announce: missing config (GATEWAY_PRESENCE_URL not set); skipping POST\n'],
  ])('exits 0 and posts nothing when %s is empty', async (variable, stderr) => {
    await withGateway([200], async gateway => {
      const result = await run('gateway-announce', {env: announceEnv(gateway, {[variable]: ''})})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"posted":false,"skipped":"missing-config"}\n')
      expect(result.stderr).toBe(stderr)
      expect(gateway.received).toEqual([])
    })
  })

  it('exits 0 on a 4xx and does not retry', async () => {
    await withGateway([404], async gateway => {
      const result = await run('gateway-announce', {env: announceEnv(gateway)})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"posted":false,"failure":"http","status":404}\n')
      expect(result.stderr).toBe('gateway-announce: event_type=daily_digest status=404 posted=false\n')
      expect(gateway.received).toHaveLength(1)
    })
  })

  it('retries a 5xx once after the wait, posts the same signed body twice and exits 0', async () => {
    await withGateway([503, 200], async gateway => {
      const result = await run('gateway-announce', {env: announceEnv(gateway)})
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"posted":true,"status":200}\n')
      expect(gateway.received).toHaveLength(2)
      expect(gateway.received[1]?.body).toBe(gateway.received[0]?.body)
      expect(gateway.received[1]?.headers['x-gateway-signature']).toBe(
        gateway.received[0]?.headers['x-gateway-signature'],
      )
    })
  }, 20_000)

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error that still exits 0 and posts nothing',
    async argv => {
      await withGateway([200], async gateway => {
        const result = await run('gateway-announce', {argv, env: announceEnv(gateway)})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('')
        expect(result.stderr).toContain('Usage')
        expect(gateway.received).toEqual([])
      })
    },
  )

  it('keeps the step green under a | tee pipeline with pipefail, whatever the gateway answers', async () => {
    for (const status of [200, 404]) {
      await withGateway([status], async gateway => {
        for (const shell of [
          ['--noprofile', '--norc', '-eo', 'pipefail'],
          ['-Eeuo', 'pipefail'],
        ]) {
          const result = await runShell(
            shell,
            'bun --no-install --no-env-file "$1" | tee out.json',
            'gateway-announce',
            {
              env: announceEnv(gateway),
            },
          )
          expect(result.exitCode).toBe(0)
        }
      })
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
// daily-digest-counts
// ---------------------------------------------------------------------------------------------------------------
describe('daily-digest-counts through scripts/daily-digest-counts.ts', () => {
  const dateOf = (days: number): string => daysAgo(days).slice(0, 10)

  const digestRepos = (surveyDate: string) =>
    `repos:\n  - {private: false, last_survey_at: ${surveyDate}}\n  - {private: false, last_survey_at: ${surveyDate}}\n  - {private: true, last_survey_at: ${surveyDate}}\n  - {private: false}\n`

  it('prints the three keys the workflow reads, counting the surveys of the day before the date argument', async () => {
    const cwd = checkout({'metadata/repos.yaml': digestRepos('2000-01-01')})
    const result = await run('daily-digest-counts', {cwd, argv: ['metadata/repos.yaml', '2000-01-02']})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('{"repos_tracked":3,"surveys_today":2,"should_post":true,"count_status":"ok"}\n')
  })

  it('takes the date argument before TODAY_UTC, TODAY_UTC before the clock, and metadata/repos.yaml as the default path', async () => {
    const cwd = checkout({'metadata/repos.yaml': digestRepos('2000-01-01')})
    const argvWins = await run('daily-digest-counts', {
      cwd,
      argv: ['metadata/repos.yaml', '2000-01-02'],
      env: {TODAY_UTC: '1999-01-01'},
    })
    expect(JSON.parse(argvWins.stdout)).toMatchObject({surveys_today: 2})
    const envOnly = await run('daily-digest-counts', {cwd, env: {TODAY_UTC: '2000-01-02'}})
    expect(JSON.parse(envOnly.stdout)).toMatchObject({surveys_today: 2, repos_tracked: 3})
    const envMiss = await run('daily-digest-counts', {cwd, env: {TODAY_UTC: '2000-01-03'}})
    expect(JSON.parse(envMiss.stdout)).toMatchObject({surveys_today: 0, repos_tracked: 3})
  })

  it('falls back to the UTC clock: the survey of the day before today counts', async () => {
    const beforeSpawn = dateOf(1)
    const cwd = checkout({'metadata/repos.yaml': digestRepos(beforeSpawn)})
    const result = await run('daily-digest-counts', {cwd})
    // A run that crosses midnight UTC reads a different "yesterday"; the check only holds on the same day.
    if (dateOf(1) !== beforeSpawn) return
    expect(JSON.parse(result.stdout)).toMatchObject({surveys_today: 2, count_status: 'ok'})
  })

  // The steps run as `RESULT="$(bun scripts/daily-digest-counts.ts metadata/repos.yaml "$TODAY_UTC")"` under `set -euo pipefail`.
  const WORKFLOW_STEP = [
    'set -euo pipefail',
    'export TODAY_UTC',
    'RESULT="$(bun --no-install --no-env-file "$1" metadata/repos.yaml "$TODAY_UTC")"',
    'echo "repos_tracked=$(echo "$RESULT" | jq \'.repos_tracked\')"',
    'echo "surveys_today=$(echo "$RESULT" | jq \'.surveys_today\')"',
    'echo "count_status=$(echo "$RESULT" | jq -r \'.count_status\')"',
  ].join('\n')

  it('runs in RESULT="$(...)" under set -euo pipefail and yields outputs the workflow validates', async () => {
    const cwd = checkout({'metadata/repos.yaml': digestRepos('2000-01-01')})
    const result = await runShell(['--noprofile', '--norc', '-e'], WORKFLOW_STEP, 'daily-digest-counts', {
      cwd,
      env: {TODAY_UTC: '2000-01-02'},
      argv: [],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('repos_tracked=3\nsurveys_today=2\ncount_status=ok\n')
  })

  it.each([
    ['a missing file', undefined, 'daily-digest-counts: failed to read '],
    ['an unparsable file', 'a: [unclosed\n', 'daily-digest-counts: failed to parse YAML: '],
    ['a file with no repos array', 'version: 1\n', 'daily-digest-counts: metadata/repos.yaml missing `repos` array\n'],
    [
      'a malformed repos[] element',
      'repos:\n  - null\n',
      'daily-digest-counts: malformed repos[] element (null, non-object, or array)\n',
    ],
  ])('reports %s as count_status error with a stderr line, and the step does not fail', async (_name, text, stderr) => {
    const cwd = checkout(text === undefined ? {} : {'metadata/repos.yaml': text})
    const result = await runShell(['--noprofile', '--norc', '-e'], WORKFLOW_STEP, 'daily-digest-counts', {
      cwd,
      env: {TODAY_UTC: '2000-01-02'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('repos_tracked=0\nsurveys_today=0\ncount_status=error\n')
    expect(result.stderr.startsWith(stderr)).toBe(true)
  })

  it('treats an invalid date as count_status error', async () => {
    const cwd = checkout({'metadata/repos.yaml': digestRepos('2000-01-01')})
    const result = await run('daily-digest-counts', {cwd, argv: ['metadata/repos.yaml', 'not-a-date']})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({count_status: 'error', should_post: false})
    expect(result.stderr).toMatch(/^daily-digest-counts: unexpected error in deriveCounts: /u)
  })

  it.each([[['--help']], [['--bogus']], [['metadata/repos.yaml', '2000-01-02', 'extra']]])(
    'argv %j is a usage error: exit 1 and no counts',
    async argv => {
      const cwd = checkout({'metadata/repos.yaml': digestRepos('2000-01-01')})
      const result = await run('daily-digest-counts', {cwd, argv})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
    },
  )
})

// ---------------------------------------------------------------------------------------------------------------
// improvement-metrics-detect and improvement-metrics-report
// ---------------------------------------------------------------------------------------------------------------
const BASE = '/repos/fro-bot/.github'

function solutionDoc(title: string, module: string, problemType: string, tags: string[]): string {
  return `---\ntitle: ${title}\nmodule: ${module}\ncomponent: detect\nproblem_type: ${problemType}\ntags: [${tags.join(', ')}]\n---\n\n# ${title}\n`
}

const SOLUTION_DOCS: Record<string, {readonly text: string; readonly addedDaysAgo: number}> = {
  'docs/solutions/best-practices/status-drift-guard.md': {
    text: solutionDoc('Status drift detection guard', 'packages/status-truth', 'best_practice', ['status', 'drift']),
    addedDaysAgo: 40,
  },
  'docs/solutions/security-issues/token-leak.md': {
    text: solutionDoc('Token leak in privacy scan', 'scripts/privacy', 'security_issue', ['privacy', 'token']),
    addedDaysAgo: 25,
  },
  'docs/solutions/runtime-errors/retry-storm.md': {
    text: solutionDoc('Retry storm exhausts quota', 'core/retry', 'runtime_error', ['retry']),
    addedDaysAgo: 60,
  },
  'docs/solutions/workflow-issues/old-cron.md': {
    text: solutionDoc('Old cron schedule drift', 'workflows', 'workflow_issue', ['cron']),
    addedDaysAgo: 120,
  },
}

/** A checkout whose solution docs are committed on dates relative to now, with `metadata/repos.yaml` beside them. */
function metricsCheckout(options: {readonly commit?: boolean; readonly metadata?: boolean} = {}): string {
  const cwd = checkout(options.metadata === false ? {} : {'metadata/repos.yaml': REPOS_YAML})
  git(cwd, ['init', '-q', '-b', 'main', '.'])
  for (const [path, {text, addedDaysAgo}] of Object.entries(SOLUTION_DOCS)) {
    mkdirSync(dirname(join(cwd, path)), {recursive: true})
    writeFileSync(join(cwd, path), text)
    if (options.commit !== false) {
      git(cwd, ['add', path])
      git(cwd, ['commit', '-q', '-m', `add ${path}`], daysAgo(addedDaysAgo))
    }
  }
  return cwd
}

interface IssueFixture {
  readonly number: number
  readonly title: string
  readonly labels: readonly string[]
  readonly createdDaysAgo: number
}

const PROPOSALS: Record<string, readonly IssueFixture[]> = {
  'learning-proposal': [
    {
      number: 11,
      title: 'Status drift detection regressed again',
      labels: ['learning-proposal', 'status'],
      createdDaysAgo: 10,
    },
    {number: 14, title: 'Status drift detection first seen', labels: ['learning-proposal'], createdDaysAgo: 80},
  ],
  'pattern-proposal': [
    {number: 12, title: 'Retry storm in core retry again', labels: ['pattern-proposal'], createdDaysAgo: 5},
  ],
  'status-truth': [
    {number: 13, title: 'Completely unrelated thing happened', labels: ['status-truth'], createdDaysAgo: 4},
  ],
}

function detectRoutes(priorReportBody?: string): FakeRoute[] {
  const labelRoutes = Object.entries(PROPOSALS).map(([label, issues]) =>
    route('GET', `${BASE}/issues`, {
      q: `labels=${label}`,
      b: issues.map(issue => ({
        number: issue.number,
        title: issue.title,
        labels: issue.labels.map(name => ({name})),
        created_at: daysAgo(issue.createdDaysAgo),
        html_url: `https://github.com/fro-bot/.github/issues/${String(issue.number)}`,
      })),
    }),
  )
  return [
    ...labelRoutes,
    route('GET', `${BASE}/issues`, {
      q: 'labels=improvement-metrics-report',
      b: priorReportBody === undefined ? [] : [{number: 50, body: priorReportBody}],
    }),
  ]
}

interface DetectOutput {
  readonly digest: Record<string, unknown>
  readonly edges: {readonly fingerprint: string; readonly eventId: string; readonly ticked: boolean}[]
}

const DETECT_STDOUT_KEYS = [
  'windowDays',
  'anchors',
  'discovery',
  'priorDiscovery',
  'confirmedRecidivism',
  'backlogCount',
  'oldestPendingAgeDays',
  'state',
  'edgeCount',
  'tokenLoadFailure',
  'scanFailure',
  'gitHistoryUnavailable',
]

const PIPEFAIL = ['-Eeuo', 'pipefail'] as const

async function runDetect(cwd: string, routes: readonly FakeRoute[], env: Record<string, string | undefined> = {}) {
  const digestPath = join(cwd, 'out', 'improvement-metrics-digest.json')
  mkdirSync(dirname(digestPath), {recursive: true})
  const result = await run('improvement-metrics-detect', {
    cwd,
    routes,
    env: {GITHUB_TOKEN: 'detect-token', IMPROVEMENT_METRICS_DIGEST_PATH: digestPath, ...env},
  })
  const digestText = existsSync(digestPath) ? readFileSync(digestPath, 'utf8') : undefined
  return {result, digestPath, digestText}
}

describe('improvement-metrics-detect through scripts/improvement-metrics-detect.ts', () => {
  it('writes {digest, edges} to the digest file and a different, flat result shape to stdout', async () => {
    const {result, digestText} = await runDetect(metricsCheckout(), detectRoutes())
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('capture-learnings-privacy: loaded private token set')
    const flat = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(flat)).toEqual(DETECT_STDOUT_KEYS)
    expect(flat).toMatchObject({anchors: 4, discovery: 3, priorDiscovery: 1, edgeCount: 2, state: 'healthy'})
    expect(flat).toMatchObject({tokenLoadFailure: false, scanFailure: false, gitHistoryUnavailable: false})
    // The file is the artifact the report step reads: a different shape, so stdout must never be redirected onto it.
    const file = JSON.parse(digestText ?? '') as DetectOutput
    expect(Object.keys(file)).toEqual(['digest', 'edges'])
    expect(Object.keys(file.digest)).toEqual([
      'windowDays',
      'anchors',
      'discovery',
      'priorDiscovery',
      'confirmedRecidivism',
      'backlogCount',
      'oldestPendingAgeDays',
      'state',
    ])
    expect(file.edges.map(edge => edge.eventId).toSorted()).toEqual(['11', '12'])
    for (const edge of file.edges) {
      expect(edge.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
      expect(edge.ticked).toBe(false)
    }
    expect(digestText?.endsWith('\n')).toBe(true)
    expect(digestText).not.toBe(result.stdout)
    expect(unhandledMutations()).toEqual([])
  })

  it('counts a tick in the prior report as confirmed recidivism', async () => {
    const first = await runDetect(metricsCheckout(), detectRoutes())
    const fingerprint = (JSON.parse(first.digestText ?? '') as DetectOutput).edges.find(
      edge => edge.eventId === '11',
    )?.fingerprint
    expect(fingerprint).toBeDefined()
    const ticked = await runDetect(
      metricsCheckout(),
      detectRoutes(`- [x] <!-- improvement-metrics:edge=${String(fingerprint)} -->\n`),
    )
    expect(JSON.parse(ticked.result.stdout)).toMatchObject({confirmedRecidivism: 1, backlogCount: 1, edgeCount: 2})
    expect((JSON.parse(ticked.digestText ?? '') as DetectOutput).edges.filter(edge => edge.ticked)).toHaveLength(1)
  })

  it('falls back to an empty digest and exits 0 when the private token set cannot load, before any API call', async () => {
    const {result, digestText} = await runDetect(metricsCheckout({metadata: false}), detectRoutes())
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({tokenLoadFailure: true, scanFailure: false, state: null})
    expect(JSON.parse(digestText ?? '')).toEqual({
      digest: {
        windowDays: 90,
        anchors: 0,
        discovery: 0,
        priorDiscovery: 0,
        confirmedRecidivism: 0,
        backlogCount: 0,
        oldestPendingAgeDays: null,
        state: 'insufficient-signal',
      },
      edges: [],
    })
    expect(requests()).toEqual([])
  })

  it('falls back to an empty digest and flags unavailable git history when a doc has no add commit', async () => {
    const {result, digestText} = await runDetect(metricsCheckout({commit: false}), detectRoutes())
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({gitHistoryUnavailable: true, scanFailure: false, state: null})
    expect((JSON.parse(digestText ?? '') as DetectOutput).edges).toEqual([])
  })

  it('flags a scan failure and still writes the empty digest when there is no token', async () => {
    const {result, digestText} = await runDetect(metricsCheckout(), detectRoutes(), {GITHUB_TOKEN: ''})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain(
      'improvement-metrics-detect: unexpected error (Error), falling back to empty digest',
    )
    expect(JSON.parse(result.stdout)).toMatchObject({scanFailure: true, state: null})
    expect(JSON.parse(digestText ?? '')).toMatchObject({edges: []})
    expect(requests()).toEqual([])
  })

  it('flags a scan failure when the digest path is unset, with a configuration error on stderr', async () => {
    const cwd = metricsCheckout()
    const result = await run('improvement-metrics-detect', {
      cwd,
      routes: detectRoutes(),
      env: {GITHUB_TOKEN: 'detect-token', IMPROVEMENT_METRICS_DIGEST_PATH: ''},
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({scanFailure: true})
    expect(readdirSync(cwd).toSorted()).toEqual(['.git', 'docs', 'metadata'])
  })

  it('runs under bash -Eeuo pipefail with no pipe and returns the CLI exit code', async () => {
    const cwd = metricsCheckout()
    const digestPath = join(cwd, 'out', 'digest.json')
    mkdirSync(dirname(digestPath))
    const result = await runShell(
      PIPEFAIL,
      'bun --no-install --no-env-file --preload "$2" "$1"',
      'improvement-metrics-detect',
      {
        cwd,
        routes: detectRoutes(),
        env: {GITHUB_TOKEN: 'detect-token', IMPROVEMENT_METRICS_DIGEST_PATH: digestPath},
      },
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(digestPath, 'utf8'))).toHaveProperty('edges')
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error: exit 1, usage on stderr, no digest and no API call',
    async argv => {
      const cwd = metricsCheckout()
      const digestPath = join(cwd, 'digest.json')
      const result = await run('improvement-metrics-detect', {
        cwd,
        argv,
        routes: detectRoutes(),
        env: {GITHUB_TOKEN: 'detect-token', IMPROVEMENT_METRICS_DIGEST_PATH: digestPath},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(existsSync(digestPath)).toBe(false)
      expect(requests()).toEqual([])
    },
  )
})

const REPORT_EDGE = {
  fingerprint: 'c'.repeat(64),
  classKey: 'packages/status-truth\u0001detect\u0001best_practice',
  eventId: '11',
  eventUrl: 'https://github.com/fro-bot/.github/issues/11',
  eventCreatedAt: '2026-10-20T10:00:00Z',
  ticked: false,
}

function reportDigest(edges: readonly Record<string, unknown>[] = [REPORT_EDGE], state = 'healthy'): string {
  return JSON.stringify({
    digest: {
      windowDays: 90,
      anchors: 4,
      discovery: 3,
      priorDiscovery: 1,
      confirmedRecidivism: 0,
      backlogCount: edges.length,
      oldestPendingAgeDays: 12.5,
      state,
    },
    edges,
  })
}

function reportRoutes(existing: readonly {number: number; body: string | null}[] = []): FakeRoute[] {
  return [
    route('GET', `${BASE}/issues`, {q: 'labels=improvement-metrics-report', b: existing}),
    route('GET', `${BASE}/labels/improvement-metrics-report`, {b: {name: 'improvement-metrics-report'}}),
    route('POST', `${BASE}/issues`, {s: 201, b: {number: 77}}),
    route('PATCH', `${BASE}/issues/50`, {b: {number: 50}}),
  ]
}

async function runReport(
  files: Record<string, string>,
  routes: readonly FakeRoute[],
  env: Record<string, string | undefined> = {},
  options: {readonly cwd?: string; readonly argv?: readonly string[]} = {},
) {
  const cwd = options.cwd ?? checkout({'metadata/repos.yaml': REPOS_YAML, ...files})
  const resultPath = join(cwd, 'result.json')
  const result = await run('improvement-metrics-report', {
    cwd,
    routes,
    argv: options.argv,
    env: {
      GITHUB_TOKEN: 'report-token',
      IMPROVEMENT_METRICS_DIGEST_PATH: join(cwd, 'digest.json'),
      IMPROVEMENT_METRICS_RESULT_PATH: resultPath,
      ...env,
    },
  })
  return {result, resultText: existsSync(resultPath) ? readFileSync(resultPath, 'utf8') : undefined}
}

describe('improvement-metrics-report through scripts/improvement-metrics-report.ts', () => {
  it('creates the report issue from the digest file and writes the same counts-only result to stdout and the result file', async () => {
    const {result, resultText} = await runReport({'digest.json': reportDigest()}, reportRoutes())
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"outcome":"created","tokenLoadFailure":false,"digestReadFailure":false}\n')
    expect(resultText).toBe(result.stdout)
    const created = requests().find(line => line.startsWith(`POST ${BASE}/issues `))
    expect(created).toBeDefined()
    expect(created).toContain('"title":"Improvement Metrics"')
    expect(created).toContain('"labels":["improvement-metrics-report"]')
    expect(created).toContain(`improvement-metrics:edge=${REPORT_EDGE.fingerprint}`)
    expect(unhandledMutations()).toEqual([])
  })

  it('updates the existing issue in place and keeps an operator tick on an edge still present', async () => {
    const prior = `# Improvement Metrics\n- [x] <!-- improvement-metrics:edge=${REPORT_EDGE.fingerprint} -->\n`
    const {result} = await runReport({'digest.json': reportDigest()}, reportRoutes([{number: 50, body: prior}]))
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({outcome: 'updated'})
    const update = requests().find(line => line.startsWith(`PATCH ${BASE}/issues/50 `))
    expect(update).toContain(`- [x] <!-- improvement-metrics:edge=${REPORT_EDGE.fingerprint} -->`)
    expect(requests().some(line => line.startsWith(`POST ${BASE}/issues `))).toBe(false)
  })

  it('writes nothing and reports blockedOnPrivacy when the report would name a private repository', async () => {
    const leaking = {...REPORT_EDGE, eventUrl: 'https://github.com/secretco/vault/issues/1'}
    const {result, resultText} = await runReport({'digest.json': reportDigest([leaking])}, reportRoutes())
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({outcome: 'blockedOnPrivacy'})
    expect(resultText).toBe(result.stdout)
    expect(result.stderr).toContain(
      'improvement-metrics-report: blocked rendering surface "proposal-body"; no create performed',
    )
    expect(requests().some(line => line.startsWith('POST ') || line.startsWith('PATCH '))).toBe(false)
  })

  it('fails closed without the private token set: no API call, tokenLoadFailure in the result, exit 0', async () => {
    const cwd = checkout({'digest.json': reportDigest()})
    const {result, resultText} = await runReport({}, reportRoutes(), {}, {cwd})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({outcome: null, tokenLoadFailure: true, digestReadFailure: false})
    expect(resultText).toBe(result.stdout)
    expect(requests()).toEqual([])
  })

  it.each([
    ['a missing digest file', {}, undefined],
    ['a digest file that is not JSON', {'digest.json': 'not json'}, undefined],
    ['a digest file of the wrong shape', {'digest.json': '{"digest":{},"edges":[]}'}, 'digest file has invalid shape'],
    ['an unset digest path', {'digest.json': reportDigest()}, undefined],
  ])('reports %s as digestReadFailure, writes nothing and exits 0', async (name, files, stderr) => {
    const env = name === 'an unset digest path' ? {IMPROVEMENT_METRICS_DIGEST_PATH: ''} : {}
    const {result, resultText} = await runReport(files, reportRoutes(), env)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({outcome: null, tokenLoadFailure: false, digestReadFailure: true})
    expect(resultText).toBe(result.stdout)
    if (stderr !== undefined) expect(result.stderr).toContain(stderr)
    expect(requests().some(line => line.startsWith('POST ') || line.startsWith('PATCH '))).toBe(false)
  })

  it.each([
    ['an empty GITHUB_TOKEN', {GITHUB_TOKEN: ''}],
    ['an unset GITHUB_TOKEN', {GITHUB_TOKEN: undefined}],
  ])(
    'is not a dry run with %s: a readable digest exits 1 with the message, no result file and no API call',
    async (_name, env) => {
      const {result, resultText} = await runReport({'digest.json': reportDigest()}, reportRoutes(), env)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('capture-learnings-harvest requires GITHUB_TOKEN in the environment\n')
      expect(resultText).toBeUndefined()
      expect(requests()).toEqual([])
    },
  )

  it('exits 1 with the API error on stderr when the issue list fails, and writes no result file', async () => {
    const failing = [route('GET', `${BASE}/issues`, {s: 500, b: {message: 'boom'}})]
    const {result, resultText} = await runReport({'digest.json': reportDigest()}, failing)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim().split('\n').at(-1)).toMatch(/boom|Unknown error/u)
    expect(resultText).toBeUndefined()
  })

  it('propagates the CLI exit code through bash -Eeuo pipefail', async () => {
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML, 'digest.json': reportDigest()})
    const env = {
      GITHUB_TOKEN: '',
      IMPROVEMENT_METRICS_DIGEST_PATH: join(cwd, 'digest.json'),
      IMPROVEMENT_METRICS_RESULT_PATH: join(cwd, 'result.json'),
    }
    const failing = await runShell(
      PIPEFAIL,
      'bun --no-install --no-env-file --preload "$2" "$1"',
      'improvement-metrics-report',
      {
        cwd,
        env,
        routes: reportRoutes(),
      },
    )
    expect(failing.exitCode).toBe(1)
    const piped = await runShell(
      PIPEFAIL,
      'bun --no-install --no-env-file --preload "$2" "$1" | tee out.json',
      'improvement-metrics-report',
      {cwd, env, routes: reportRoutes()},
    )
    expect(piped.exitCode).toBe(1)
    expect(existsSync(join(cwd, 'out.json'))).toBe(true)
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error: exit 1, usage on stderr, no result file and no API call',
    async argv => {
      const {result, resultText} = await runReport({'digest.json': reportDigest()}, reportRoutes(), {}, {argv})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(resultText).toBeUndefined()
      expect(requests()).toEqual([])
    },
  )
})

describe('detect feeds report through the digest file', () => {
  it('a digest written by the detect shim is accepted by the report shim and renders every edge', async () => {
    const detected = await runDetect(metricsCheckout(), detectRoutes())
    expect(detected.digestText).toBeDefined()
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML, 'digest.json': detected.digestText ?? ''})
    const {result} = await runReport({}, reportRoutes(), {}, {cwd})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({outcome: 'created', digestReadFailure: false})
    const created = requests().find(line => line.startsWith(`POST ${BASE}/issues `)) ?? ''
    for (const edge of (JSON.parse(detected.digestText ?? '') as DetectOutput).edges) {
      expect(created).toContain(`improvement-metrics:edge=${edge.fingerprint}`)
    }
  })

  it('a stdout redirected onto the digest path is rejected by the report shim: the shapes differ', async () => {
    const detected = await runDetect(metricsCheckout(), detectRoutes())
    const cwd = checkout({'metadata/repos.yaml': REPOS_YAML, 'digest.json': detected.result.stdout})
    const {result} = await runReport({}, reportRoutes(), {}, {cwd})
    expect(JSON.parse(result.stdout)).toMatchObject({outcome: null, digestReadFailure: true})
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The four shims, imported as a library
// ---------------------------------------------------------------------------------------------------------------
describe('a shim imported as a library does nothing', () => {
  const SHIMS = ['daily-digest-counts', 'gateway-announce', 'improvement-metrics-detect', 'improvement-metrics-report']

  // The entry guard compares `import.meta.url` with `process.argv[1]`, which is the harness here, so no `main` runs.
  // The shim path is an argument of the harness, never interpolated into its source.
  const HARNESS = `import {pathToFileURL} from 'node:url'
await import(pathToFileURL(process.argv[2]).href)
process.stdout.write('imported:' + String(process.exitCode ?? 'unset'))
`

  it.each(SHIMS.flatMap(name => (['bun', 'node'] as const).map(runtime => [name, runtime] as const)))(
    'scripts/%s.ts under %s: no output, no exit code, no POST, no file and no API call',
    async (name, runtime) => {
      await withGateway([200], async gateway => {
        const cwd = checkout({'metadata/repos.yaml': REPOS_YAML})
        const harness = join(cwd, 'import-shim.ts')
        writeFileSync(harness, HARNESS)
        const before = readdirSync(cwd).toSorted()
        const github = createFakeGithub([])
        fakes.push(github)
        const result = await spawnEntrypoint({
          entrypoint: harness,
          argv: [resolve(repoRoot, 'scripts', `${name}.ts`)],
          runtime,
          runtimeArgs: runtime === 'bun' ? ['--no-install', '--no-env-file', ...github.runtimeArgs('bun')] : [],
          cwd,
          env: {
            ...announceEnv(gateway),
            FAKE_GH_DIR: github.directory,
            GITHUB_TOKEN: 'import-token',
            IMPROVEMENT_METRICS_DIGEST_PATH: join(cwd, 'digest.json'),
            IMPROVEMENT_METRICS_RESULT_PATH: join(cwd, 'result.json'),
          },
        })
        expect(result).toEqual({exitCode: 0, stdout: 'imported:unset', stderr: '', githubOutput: ''})
        expect(gateway.received).toEqual([])
        expect(readdirSync(cwd).toSorted()).toEqual(before)
        expect(github.requests()).toEqual([])
      })
    },
    30_000,
  )

  it('positive control: the same harness shape runs a shim that is the entrypoint', async () => {
    await withGateway([200], async gateway => {
      const cwd = checkout()
      const result = await spawnEntrypoint({
        entrypoint: resolve(repoRoot, 'scripts', 'gateway-announce.ts'),
        cwd,
        env: announceEnv(gateway),
      })
      expect(result.stdout).toBe('{"posted":true,"status":200}\n')
      expect(gateway.received).toHaveLength(1)
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The real checkout
// ---------------------------------------------------------------------------------------------------------------
describe('the real checkout', () => {
  it('has the same files under docs/solutions, metadata and knowledge as before the flows ran', () => {
    const after = snapshotTree(repoRoot, ['docs/solutions', 'metadata', 'knowledge'])
    expect(after).toEqual(realCheckoutBefore)
  })

  it('is not the working directory of any flow: each runs in a test-owned checkout', () => {
    const scratch = checkout()
    expect(scratch.startsWith(root)).toBe(true)
    expect(statSync(scratch).isDirectory()).toBe(true)
    expect(scratch).not.toBe(repoRoot)
  })

  it('positive control: the same check sees a file written under a snapshotted path', () => {
    const scratch = checkout({'docs/solutions/a.md': 'a\n'})
    const before = snapshotTree(scratch, ['docs/solutions'])
    writeFileSync(join(scratch, 'docs/solutions/b.md'), 'b\n')
    writeFileSync(join(scratch, 'docs/solutions/a.md'), 'a, changed\n')
    const after = snapshotTree(scratch, ['docs/solutions'])
    expect(after).not.toEqual(before)
    expect([...after.keys()].toSorted()).toEqual(['docs/solutions/a.md', 'docs/solutions/b.md'])
  })
})
