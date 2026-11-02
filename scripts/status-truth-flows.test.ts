/**
 * Surface tier for the status-truth CLIs end to end: each test runs the real `scripts/<name>.ts` shim in a
 * child process under Bun, the callers' runtime, through the goke runner and the production CLI body with its
 * default dependencies. Nothing is mocked inside the CLI, so a broken shim, runner config, env wiring or output
 * path fails here.
 *
 * `gateway-rollout-tracker.yaml` reads five fields of the snapshot result and `status-truth.yaml` pipes it to
 * `jq -e '.snapshot'`, so a result cut short by an early `process.exit` or a renamed field reads as a failed
 * step, or as a missing field with no error. The tests pin every field a workflow reads.
 */

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {createFakeGithub, route, type FakeGithub, type FakeRoute} from '@fro-bot/test-kit/fake-github'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

const CONTROL = '/repos/fro-bot/.github'

let root = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'status-truth-flows-'))
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

/** Runs a shim against a fake GitHub API that replaces `fetch` in the child. */
async function runFake(
  script: string,
  routes: readonly FakeRoute[],
  options: {
    readonly argv?: readonly string[]
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly cwd?: string
  } = {},
): Promise<SpawnEntrypointResult> {
  const github = createFakeGithub(routes)
  fake = github
  return spawnEntrypoint({
    entrypoint: resolve(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: github.runtimeArgs('bun'),
    argv: options.argv,
    cwd: options.cwd ?? checkout({}),
    env: {FAKE_GH_DIR: github.directory, ...options.env},
  })
}

/** Every request the run made, as logged (`METHOD /path?query auth=<token> body=<json>`), matched or not. */
function requests(): string[] {
  return (fake?.requests() ?? []).map(request => request.line)
}

function unhandledMutations(): string[] {
  return (fake?.unhandledMutations() ?? []).map(request => request.line)
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

async function run(
  script: string,
  options: {
    readonly argv?: readonly string[]
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly cwd?: string
  } = {},
): Promise<SpawnEntrypointResult> {
  return spawnEntrypoint({
    entrypoint: resolve(repoRoot, 'scripts', `${script}.ts`),
    runtime: 'bun',
    runtimeArgs: ['--no-install', '--no-env-file'],
    argv: options.argv,
    env: options.env,
    cwd: options.cwd,
  })
}

// ─── rollout-tracker-snapshot ────────────────────────────────────────────────────────────────────

const SIGNAL_ENV = {
  ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify({agent: {tag_name: 'v1.2.3'}, dashboard: {tag_name: 'v4.5.6'}}),
  ROLLOUT_TRACKER_DEPLOYS_JSON: JSON.stringify({
    gateway: {workflow_runs: [{id: 100, head_sha: 'sha-gateway'}]},
    dashboard: {workflow_runs: [{id: 101, head_sha: 'sha-dashboard'}]},
    router: {workflow_runs: [{id: 102, head_sha: 'sha-router'}]},
  }),
  ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify({contractVersion: '2026.10'}),
}

function snapshotEnv(items: readonly unknown[], extra: Readonly<Record<string, string | undefined>> = {}) {
  return {
    ...SIGNAL_ENV,
    ROLLOUT_TRACKER_ITEMS_JSON: JSON.stringify(items),
    ROLLOUT_TRACKER_ISSUES_JSON: '[]',
    ROLLOUT_TRACKER_COMMENT_BODY: '',
    ...extra,
  }
}

const item = (number: number) => ({
  id: `i${number}`,
  content_number: number,
  content_repo: 'fro-bot/.github',
  status: 'Todo',
  readiness: 'ready',
  gate: 'open',
})

describe('rollout-tracker-snapshot (bun; gateway-rollout-tracker.yaml and status-truth.yaml: no argv)', () => {
  it('prints one JSON line with the five fields the preflight job reads and exits 0', async () => {
    const result = await run('rollout-tracker-snapshot', {env: snapshotEnv([item(1)])})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.endsWith('\n')).toBe(true)
    expect(result.stdout.split('\n')).toHaveLength(2)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    // `.should_comment .reason .pending_mention_ids .marker .marker_comment_id`: the five job outputs.
    for (const field of ['should_comment', 'reason', 'pending_mention_ids', 'marker', 'marker_comment_id']) {
      expect(parsed).toHaveProperty(field)
    }
    expect(parsed.should_comment).toBe(true)
    expect(typeof parsed.reason).toBe('string')
    expect(parsed.pending_mention_ids).toEqual([])
    expect(String(parsed.marker).startsWith('<!-- gateway-rollout-tracker:')).toBe(true)
    expect(parsed.marker_comment_id).toBeNull()
    // `.snapshot` then `.items | length`: the shape status-truth.yaml pipes to jq.
    expect((parsed.snapshot as {items: unknown[]}).items).toHaveLength(1)
  })

  it('delivers a result of more than 300 KB complete when it is piped (no process.exit on the success path)', async () => {
    const items = Array.from({length: 900}, (_, index) => item(1000 + index))
    const result = await run('rollout-tracker-snapshot', {env: snapshotEnv(items)})
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(300_000)
    expect(result.stdout.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(result.stdout) as {snapshot: {items: unknown[]}}
    expect(parsed.snapshot.items).toHaveLength(900)
  })

  it('fails with a FATAL line, exit 1 and an empty stdout when a signal read fails, so `jq -e` fails the `if`', async () => {
    const result = await run('rollout-tracker-snapshot', {
      env: snapshotEnv([item(1)], {ROLLOUT_TRACKER_HEALTH_JSON: '{nope'}),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('rollout-tracker-snapshot: FATAL — failed to read external signals: ')
    expect(result.stderr).toContain(
      'rollout-tracker-snapshot: refusing to treat a signal read failure as no-drift; exiting 1\n',
    )
  })

  it('rejects a non-numeric comment ID before it reads anything', async () => {
    const result = await run('rollout-tracker-snapshot', {
      env: snapshotEnv([item(1)], {ROLLOUT_TRACKER_COMMENT_ID: '12x'}),
    })
    expect(result).toMatchObject({
      exitCode: 1,
      stdout: '',
      stderr: 'rollout-tracker-snapshot: FATAL — ROLLOUT_TRACKER_COMMENT_ID must be numeric or empty\n',
    })
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error: exit 1, nothing on stdout, nothing read',
    async argv => {
      const result = await run('rollout-tracker-snapshot', {argv, env: snapshotEnv([item(1)])})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('the shims run nothing on import', () => {
  it.each(['rollout-tracker-snapshot', 'status-truth-detect'])(
    'importing scripts/%s.ts reads nothing, prints nothing and sets no exit code',
    async script => {
      const harness = join(root, `import-${script}.ts`)
      writeFileSync(
        harness,
        `await import(${JSON.stringify(join(repoRoot, 'scripts', `${script}.ts`))})\nprocess.stdout.write(String(process.exitCode))\n`,
      )
      const result = await spawnEntrypoint({
        entrypoint: harness,
        runtime: 'bun',
        runtimeArgs: ['--no-install', '--no-env-file'],
        env: {},
      })
      expect(result).toMatchObject({exitCode: 0, stdout: 'undefined', stderr: '', githubOutput: ''})
    },
  )
})

// ─── status-truth-detect ─────────────────────────────────────────────────────────────────────────

const PLAN_DRIFTED = '---\nstatus: active\n---\n# Plan\n\n- [x] **Unit 1: a**\n- [x] **Unit 2: b**\n'

const DETECT_DOCS = {
  'README.md': 'PR #579 is open\nissue #12 is closed\nrelease v1.0.0 is published\nplan docs/plans/a.md is active\n',
  'docs/plans/a.md': '---\nstatus: complete\n---\n# Plan\n\n- [x] **Unit 1: a**\n',
  'docs/plans/b.md': PLAN_DRIFTED,
}

const DETECT_API: readonly FakeRoute[] = [
  route('GET', `${CONTROL}/issues`, {b: [{number: 7, title: 'tracking', body: 'issue #7 is open', labels: []}]}),
  route('GET', `${CONTROL}/issues/7/comments`, {b: [{id: 70, body: 'PR #580 is merged'}]}),
  route('GET', `${CONTROL}/pulls/579`, {b: {state: 'closed', merged: true}}),
  route('GET', `${CONTROL}/pulls/580`, {b: {state: 'open', merged: false}}),
  route('GET', `${CONTROL}/issues/12`, {b: {state: 'closed'}}),
  route('GET', `${CONTROL}/issues/7`, {b: {state: 'open'}}),
  route('GET', `${CONTROL}/releases/tags/v1.0.0`, {b: {draft: false, prerelease: false}}),
]

/** The report and summary paths `status-truth.yaml` reads with `jq` (`:153-160`). */
const DETECT_COUNT_KEYS = ['total', 'current', 'drifted', 'unresolved', 'unsafe', 'proposal_eligible'] as const

function detectEnv(directory: string, extra: Readonly<Record<string, string | undefined>> = {}) {
  return {STATUS_TRUTH_REPORT_PATH: join(directory, 'report.json'), GITHUB_REPOSITORY: 'fro-bot/.github', ...extra}
}

describe('status-truth-detect (bun, status-truth.yaml: no argv)', () => {
  it('writes the report the summary step reads and prints counts only, with a token and the live state', async () => {
    const cwd = checkout(DETECT_DOCS)
    const result = await runFake('status-truth-detect', DETECT_API, {
      cwd,
      env: detectEnv(root, {GITHUB_TOKEN: 'tok-read', STATUS_TRUTH_REPORT_PATH: join(cwd, 'report.json')}),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const report = readJson(join(cwd, 'report.json'))
    // `.status .scan_complete .counts.{total,current,drifted,unresolved,unsafe,proposal_eligible}`
    expect(report.status).toBe('findings')
    expect(report.scan_complete).toBe(true)
    const counts = report.counts as Record<string, number>
    expect(Object.keys(counts).sort()).toEqual([...DETECT_COUNT_KEYS].sort())
    expect(counts.drifted).toBeGreaterThan(0)
    expect(counts.proposal_eligible).toBeGreaterThan(0)
    expect(counts.total).toBe((report.findings as unknown[]).length)
    // stdout is the counts-only summary: no claim text, path, fingerprint or token.
    expect(JSON.parse(result.stdout)).toEqual({status: report.status, scan_complete: true, counts})
    expect(result.stdout).not.toContain('README')
    expect(result.stdout).not.toContain('tok-read')
    // Detect holds a read-only token: every request is a GET, and each carried that token.
    expect(requests().length).toBeGreaterThan(0)
    for (const line of requests()) {
      expect(line.startsWith('GET ')).toBe(true)
      expect(line).toContain(' auth=tok-read')
    }
    expect(unhandledMutations()).toEqual([])
  })

  it('resolves the claims it can without a token and makes no request', async () => {
    const cwd = checkout(DETECT_DOCS)
    const result = await runFake('status-truth-detect', DETECT_API, {
      cwd,
      env: detectEnv(root, {STATUS_TRUTH_REPORT_PATH: join(cwd, 'report.json')}),
    })

    expect(result.exitCode).toBe(0)
    expect(requests()).toEqual([])
    const report = readJson(join(cwd, 'report.json'))
    const kinds = (report.findings as {kind: string; verdict: string}[]).map(
      finding => `${finding.kind}:${finding.verdict}`,
    )
    // The file-parse kinds resolve locally; the API kinds stay unresolved rather than looking current.
    expect(kinds).toContain('plan-consistency:drifted')
    expect(kinds).toContain('plan-status:drifted')
    expect(kinds).toContain('pr-state:unresolved')
  })

  it('reads the rollout snapshot named by STATUS_TRUTH_ROLLOUT_SNAPSHOT_PATH for rollout-tracker claims', async () => {
    const cwd = checkout({
      'README.md': 'rollout tracker #3512 is open\n',
      'snapshot.json': JSON.stringify({
        items: [{content_number: 3512, content_repo: 'fro-bot/.github', issue_state: 'closed', issue_labels: []}],
      }),
    })
    const result = await runFake('status-truth-detect', [route('GET', `${CONTROL}/issues`, {b: []})], {
      cwd,
      env: detectEnv(root, {
        GITHUB_TOKEN: 'tok-read',
        STATUS_TRUTH_REPORT_PATH: join(cwd, 'report.json'),
        STATUS_TRUTH_ROLLOUT_SNAPSHOT_PATH: join(cwd, 'snapshot.json'),
      }),
    })

    expect(result.exitCode).toBe(0)
    const findings = readJson(join(cwd, 'report.json')).findings as {
      kind: string
      verdict: string
      liveState?: string
    }[]
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({kind: 'rollout-tracker-status', verdict: 'drifted', liveState: 'closed'})
  })

  it('still writes the report, with an execution-failure status, when the issue list fails', async () => {
    const cwd = checkout({'README.md': 'nothing\n'})
    const result = await runFake(
      'status-truth-detect',
      [route('GET', `${CONTROL}/issues`, {s: 500, b: {message: 'boom'}})],
      {
        cwd,
        env: detectEnv(root, {GITHUB_TOKEN: 'tok-read', STATUS_TRUTH_REPORT_PATH: join(cwd, 'report.json')}),
      },
    )

    expect(result.exitCode).toBe(0)
    expect(readJson(join(cwd, 'report.json'))).toMatchObject({
      status: 'execution-failure',
      scan_complete: false,
      failure_class: 'api-unavailable',
    })
    expect(JSON.parse(result.stdout)).toMatchObject({status: 'execution-failure', scan_complete: false})
  })

  it.each([
    [
      'STATUS_TRUTH_REPORT_PATH is unset',
      {STATUS_TRUTH_REPORT_PATH: undefined},
      'status-truth-detect: STATUS_TRUTH_REPORT_PATH is required\n',
    ],
    [
      'STATUS_TRUTH_REPORT_PATH is empty',
      {STATUS_TRUTH_REPORT_PATH: ''},
      'status-truth-detect: STATUS_TRUTH_REPORT_PATH is required\n',
    ],
    [
      'GITHUB_REPOSITORY has no slash',
      {GITHUB_REPOSITORY: 'nowhere'},
      'status-truth-detect: GITHUB_REPOSITORY must be in owner/repo format\n',
    ],
    [
      'the report path is unwritable',
      {STATUS_TRUTH_REPORT_PATH: '/nonexistent-directory/for/status-truth/r.json'},
      'status-truth-detect: could not write report: error-class=write-failure\n',
    ],
  ])('exits 1 with a message-only stderr when %s', async (_name, env, stderr) => {
    const cwd = checkout({'README.md': 'PR #1 is open\n'})
    const result = await runFake('status-truth-detect', [], {cwd, env: detectEnv(cwd, env)})

    expect(result).toMatchObject({exitCode: 1, stdout: '', stderr})
    expect(requests()).toEqual([])
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error: exit 1, nothing scanned, no report written',
    async argv => {
      const cwd = checkout({'README.md': 'PR #1 is open\n'})
      const result = await runFake('status-truth-detect', [], {cwd, argv, env: detectEnv(cwd)})

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(() => readFileSync(join(cwd, 'report.json'), 'utf8')).toThrow()
    },
  )
})
