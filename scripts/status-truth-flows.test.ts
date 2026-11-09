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

import {Buffer} from 'node:buffer'
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
    ROLLOUT_TRACKER_VISIBILITY_JSON: JSON.stringify({'fro-bot/.github': 'public'}),
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
    // The marker no longer carries the snapshot, so two long external signals (each in its own env
    // var, under the 128 KiB per-variable limit on Linux) lift the result past 300 KB.
    const result = await run('rollout-tracker-snapshot', {
      env: snapshotEnv(items, {
        ROLLOUT_TRACKER_RELEASES_JSON: JSON.stringify({
          agent: {tag_name: `v${'1'.repeat(100_000)}`},
          dashboard: {tag_name: 'v4.5.6'},
        }),
        ROLLOUT_TRACKER_HEALTH_JSON: JSON.stringify({contractVersion: '2'.repeat(100_000)}),
      }),
    })
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
  it.each(['rollout-tracker-snapshot', 'status-truth-detect', 'status-truth-proposals', 'status-truth-prs'])(
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

// ─── status-truth-proposals ──────────────────────────────────────────────────────────────────────

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
  - owner: acme
    name: secret-thing
    added: 2026-06-15
    onboarding_status: onboarded
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    discovery_channel: owned
    next_survey_eligible_at: null
    private: true
    node_id: R_kgDOSECRET001
`

function finding(kind: string, fingerprint: string, extra: Readonly<Record<string, unknown>> = {}) {
  return {
    kind,
    path: 'docs/plans/example.md',
    sourceRef: '#42',
    verdict: 'drifted',
    fingerprint,
    claimedState: 'open',
    liveState: 'merged',
    proposalEligible: true,
    proposedCorrection: 'PR #42 is merged',
    ...extra,
  }
}

function reportOf(findings: readonly unknown[], extra: Readonly<Record<string, unknown>> = {}) {
  return {
    schema_version: 1,
    fingerprint_version: 1,
    status: 'findings',
    scan_complete: true,
    generated_at: '2026-11-01T12:00:00.000Z',
    failure_class: null,
    repair_eligible: true,
    findings,
    counts: {
      total: findings.length,
      current: 0,
      drifted: findings.length,
      unresolved: 0,
      unsafe: 0,
      proposal_eligible: findings.length,
    },
    ...extra,
  }
}

function proposalMarker(fingerprint: string, liveState: string, kind: string): string {
  return [
    `<!-- status-truth:fingerprint=${fingerprint} -->`,
    `<!-- status-truth:live-state=${liveState} -->`,
    `<!-- status-truth:kind=${kind} -->`,
  ].join('\n')
}

function proposalIssue(number: number, state: 'open' | 'closed', labels: readonly string[], body: string) {
  return {
    number,
    state,
    title: '[status-truth] proposal',
    body,
    closed_at: state === 'closed' ? '2026-10-01T00:00:00Z' : null,
    labels: labels.map(name => ({name})),
  }
}

const EMPTY_LISTS: readonly FakeRoute[] = [route('GET', `${CONTROL}/issues`, {b: []})]
const LABEL_GET = route('GET', String.raw`~^/repos/fro-bot/\.github/labels/`, {b: {name: 'x'}})
const WRITE_ROUTES: readonly FakeRoute[] = [
  route('POST', `${CONTROL}/issues`, {s: 201, b: {number: 900}}),
  route('POST', String.raw`~^/repos/fro-bot/\.github/issues/\d+/comments$`, {s: 201, b: {id: 1}}),
  route('PATCH', String.raw`~^/repos/fro-bot/\.github/issues/\d+$`, {b: {number: 1}}),
  route('POST', String.raw`~^/repos/fro-bot/\.github/issues/\d+/labels$`, {b: []}),
  route('DELETE', String.raw`~^/repos/fro-bot/\.github/issues/\d+/labels/`, {b: []}),
]

const FP_OPEN = 'aaaaaaaaaaaaaaaa'
const FP_UPDATE = 'bbbbbbbbbbbbbbbb'
const FP_REOPEN = 'cccccccccccccccc'
const FP_SUPPRESS = 'dddddddddddddddd'
const FP_CLEARED = 'eeeeeeeeeeeeeeee'

const PROPOSAL_REPORT = reportOf([
  finding('pr-state', FP_OPEN),
  finding('issue-state', FP_UPDATE, {sourceRef: '#43', claimedState: 'open', liveState: 'closed'}),
  finding('release-tag-state', FP_REOPEN, {sourceRef: '@v1', claimedState: 'published', liveState: 'draft'}),
  finding('plan-status', FP_SUPPRESS, {sourceRef: 'docs/plans/x.md', claimedState: 'active', liveState: 'complete'}),
])

const EXISTING_OPEN = [
  proposalIssue(301, 'open', ['status-truth'], proposalMarker(FP_UPDATE, 'open', 'issue-state')),
  proposalIssue(303, 'open', ['status-truth'], proposalMarker(FP_CLEARED, 'open', 'pr-state')),
]
const EXISTING_CLOSED = [
  proposalIssue(
    311,
    'closed',
    ['status-truth', 'status-truth:resolved'],
    proposalMarker(FP_REOPEN, 'published', 'release-tag-state'),
  ),
  proposalIssue(
    312,
    'closed',
    ['status-truth', 'status-truth:false-positive'],
    proposalMarker(FP_SUPPRESS, 'active', 'plan-status'),
  ),
]
const LISTS: readonly FakeRoute[] = [
  route('GET', `${CONTROL}/issues`, {q: 'state=open', b: EXISTING_OPEN}),
  route('GET', `${CONTROL}/issues`, {q: 'state=closed', b: EXISTING_CLOSED}),
]

/** Every `jq` path of the "Write open summary" step (`status-truth.yaml:266-315`). */
const OPEN_COUNT_KEYS = ['opened', 'updated', 'reopened', 'closed', 'suppressed', 'failed'] as const
const OPEN_PLANNED_KEYS = [
  'sameRunDeduplicated',
  'versionRejected',
  'blocked',
  'overflowed',
  'needsOutcomeCooldown',
] as const
const OUTCOME_KEYS = [
  'proposedPending',
  'explicitAccepted',
  'explicitRejected',
  'falsePositive',
  'resolvedPositive',
  'superseded',
  'needsOutcome',
  'conflictingLabels',
  'malformedOutcome',
] as const
const BY_KIND_KEYS = ['opened', 'updated', 'reopened', 'closed', 'suppressed'] as const

function openCheckout(report: unknown = PROPOSAL_REPORT, extra: Readonly<Record<string, string>> = {}) {
  return checkout({'report.json': JSON.stringify(report), 'metadata/repos.yaml': REPOS_YAML, ...extra})
}

function openEnv(cwd: string, extra: Readonly<Record<string, string | undefined>> = {}) {
  return {
    STATUS_TRUTH_REPORT_PATH: join(cwd, 'report.json'),
    STATUS_TRUTH_OPEN_RESULT_PATH: join(cwd, 'result.json'),
    GITHUB_REPOSITORY: 'fro-bot/.github',
    ...extra,
  }
}

function mutating(): string[] {
  return requests().filter(line => !line.startsWith('GET '))
}

describe('status-truth-proposals (bun, status-truth.yaml: no argv)', () => {
  it('a dry run counts the planned actions, writes every key the summary step reads and mutates nothing', async () => {
    const cwd = openCheckout()
    const result = await runFake('status-truth-proposals', [...LISTS, ...WRITE_ROUTES, LABEL_GET], {
      cwd,
      env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', GITHUB_TOKEN: 'tok-read'}),
    })

    expect(result.exitCode).toBe(0)
    const file = readFileSync(join(cwd, 'result.json'), 'utf8')
    expect(result.stdout).toBe(file)
    const parsed = JSON.parse(file) as Record<string, Record<string, unknown>> & {
      dryRun: boolean
      labelGateFailed: boolean
    }
    expect(parsed.dryRun).toBe(true)
    expect(parsed.labelGateFailed).toBe(false)
    expect(Object.keys(parsed.counts ?? {}).sort()).toEqual([...OPEN_COUNT_KEYS, 'sameRunDeduplicated'].sort())
    expect(Object.keys(parsed.plannedCounts ?? {}).sort()).toEqual([...OPEN_PLANNED_KEYS].sort())
    expect(Object.keys(parsed.outcomeCounts ?? {}).sort()).toEqual([...OUTCOME_KEYS].sort())
    // update, reopen and close come from the existing issues; one open and one suppress remain.
    expect(parsed.counts).toMatchObject({opened: 1, updated: 1, reopened: 1, closed: 1, suppressed: 1, failed: 0})
    // `.plannedCountsByKind | to_entries[]` then `.value.{opened,updated,reopened,closed,suppressed}`.
    const byKind = parsed.plannedCountsByKind as Record<string, Record<string, number>>
    expect(Object.keys(byKind).length).toBeGreaterThan(0)
    for (const value of Object.values(byKind)) expect(Object.keys(value).sort()).toEqual([...BY_KIND_KEYS].sort())
    const outcomeByKind = parsed.outcomeCountsByKind as Record<string, Record<string, number>>
    expect(Object.keys(outcomeByKind).length).toBeGreaterThan(0)
    for (const value of Object.values(outcomeByKind))
      expect(Object.keys(value).sort()).toEqual([...OUTCOME_KEYS].sort())
    // Zero mutating calls, and each read carried the job token.
    expect(mutating()).toEqual([])
    expect(unhandledMutations()).toEqual([])
    expect(requests().length).toBeGreaterThan(0)
    for (const line of requests()) expect(line).toContain(' auth=tok-read')
  })

  it('a dry run needs no token: no request is made and the planned opens are counted', async () => {
    const cwd = openCheckout()
    const result = await runFake('status-truth-proposals', [...LISTS, ...WRITE_ROUTES, LABEL_GET], {
      cwd,
      env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true'}),
    })

    expect(result.exitCode).toBe(0)
    expect(requests()).toEqual([])
    expect(JSON.parse(result.stdout)).toMatchObject({dryRun: true, counts: {opened: 4, failed: 0}})
  })

  it('a dry run falls back to an empty issue list when the read fails, and still mutates nothing', async () => {
    const cwd = openCheckout()
    const result = await runFake(
      'status-truth-proposals',
      [route('GET', `${CONTROL}/issues`, {s: 500, b: {message: 'boom'}}), ...WRITE_ROUTES, LABEL_GET],
      {cwd, env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', GITHUB_TOKEN: 'tok-read'})},
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({dryRun: true, counts: {opened: 4}})
    expect(mutating()).toEqual([])
  })

  it('STATUS_TRUTH_DRY_RUN=false confirms the labels, then opens, updates, reopens and closes', async () => {
    const cwd = openCheckout()
    const result = await runFake('status-truth-proposals', [...LISTS, ...WRITE_ROUTES, LABEL_GET], {
      cwd,
      env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', GITHUB_TOKEN: 'tok-write'}),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: false,
      labelGateFailed: false,
      counts: {opened: 1, updated: 1, reopened: 1, closed: 1, suppressed: 1, failed: 0},
    })
    expect(requests().filter(line => line.startsWith('GET /repos/fro-bot/.github/labels/'))).toHaveLength(8)
    expect(
      requests().filter(line => line.startsWith('POST /repos/fro-bot/.github/issues auth=tok-write')),
    ).toHaveLength(1)
    expect(requests().filter(line => line.startsWith('PATCH '))).toHaveLength(2)
    expect(unhandledMutations()).toEqual([])
    for (const line of mutating()) expect(line).toContain(' auth=tok-write')
  })

  it('fails closed without opening anything when a required label cannot be confirmed', async () => {
    const cwd = openCheckout()
    const result = await runFake(
      'status-truth-proposals',
      [
        ...LISTS,
        ...WRITE_ROUTES,
        route('GET', String.raw`~^/repos/fro-bot/\.github/labels/`, {s: 404, b: {message: 'Not Found'}}),
        route('POST', `${CONTROL}/labels`, {s: 500, b: {message: 'boom'}}),
      ],
      {cwd, env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', GITHUB_TOKEN: 'tok-write'})},
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({dryRun: false, labelGateFailed: true, counts: {opened: 0}})
    expect(requests().filter(line => line.startsWith('POST /repos/fro-bot/.github/issues'))).toEqual([])
  })

  it('exits 1 before planning when the live issue read fails', async () => {
    const cwd = openCheckout()
    const result = await runFake(
      'status-truth-proposals',
      [route('GET', `${CONTROL}/issues`, {s: 500, b: {message: 'boom'}})],
      {
        cwd,
        env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', GITHUB_TOKEN: 'tok-write'}),
      },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('status-truth-proposals: existing issue fetch failed: error-class=fetch-failure\n')
    expect(mutating()).toEqual([])
  })

  it('exits 1 with a message-only stderr when a live run has no token', async () => {
    const cwd = openCheckout()
    const result = await runFake('status-truth-proposals', [], {
      cwd,
      env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false'}),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('status-truth-proposals: GITHUB_TOKEN is required in the environment\n')
    expect(requests()).toEqual([])
  })

  // The dry run is the default of status-truth.yaml (`github.event.inputs.dry_run || 'true'`), not of this script:
  // the script treats only the exact string 'true' as a dry run. These two tests record that, so a change that
  // makes an unset variable dry (or an unset variable write) is a visible decision.
  it('takes the live path when STATUS_TRUTH_DRY_RUN is unset (the workflow default supplies the dry run)', async () => {
    const cwd = openCheckout(reportOf([finding('pr-state', FP_OPEN)]))
    const result = await runFake('status-truth-proposals', [...EMPTY_LISTS, ...WRITE_ROUTES, LABEL_GET], {
      cwd,
      env: openEnv(cwd, {GITHUB_TOKEN: 'tok-write'}),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({dryRun: false, counts: {opened: 1}})
    expect(
      requests().filter(line => line.startsWith('POST /repos/fro-bot/.github/issues auth=tok-write')),
    ).toHaveLength(1)
  })

  it.each(['TRUE', '1', ''])(
    'takes the live path when STATUS_TRUTH_DRY_RUN=%j (only the exact string true is a dry run)',
    async value => {
      const cwd = openCheckout(reportOf([finding('pr-state', FP_OPEN)]))
      const result = await runFake('status-truth-proposals', [...EMPTY_LISTS, ...WRITE_ROUTES, LABEL_GET], {
        cwd,
        env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: value, GITHUB_TOKEN: 'tok-write'}),
      })

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({dryRun: false})
    },
  )

  it('prints the result on stdout and exits 0 when the result file is unwritable', async () => {
    const cwd = openCheckout()
    const result = await runFake('status-truth-proposals', [], {
      cwd,
      env: openEnv(cwd, {
        STATUS_TRUTH_DRY_RUN: 'true',
        STATUS_TRUTH_OPEN_RESULT_PATH: '/nonexistent-directory/for/status-truth/r.json',
      }),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({dryRun: true})
    expect(result.stderr).toContain('status-truth-proposals: could not write result: error-class=write-failure\n')
  })

  it.each([
    [
      'the report path is unset',
      {STATUS_TRUTH_REPORT_PATH: undefined},
      undefined,
      'status-truth-proposals: STATUS_TRUTH_REPORT_PATH is required\n',
    ],
    [
      'the report is not JSON',
      {},
      '{nope',
      'status-truth-proposals: could not parse report artifact: error-class=parse-failure\n',
    ],
    [
      'the artifact has an unknown version',
      {},
      JSON.stringify({schema_version: 2, fingerprint_version: 1}),
      'status-truth-proposals: artifact validation failed: error-class=validation-failure\n',
    ],
  ])('exits 1 with a message-only stderr and mutates nothing when %s', async (_name, env, report, stderr) => {
    const cwd = openCheckout(
      report === undefined ? PROPOSAL_REPORT : undefined,
      report === undefined ? {} : {'report.json': report},
    )
    const result = await runFake('status-truth-proposals', [...WRITE_ROUTES], {
      cwd,
      env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', GITHUB_TOKEN: 'tok', ...env}),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(stderr)
    expect(requests()).toEqual([])
  })

  it('fails closed with a token-load failure when metadata/repos.yaml is missing', async () => {
    const cwd = checkout({'report.json': JSON.stringify(PROPOSAL_REPORT)})
    const result = await runFake('status-truth-proposals', [...WRITE_ROUTES], {
      cwd,
      env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', GITHUB_TOKEN: 'tok'}),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(
      'status-truth-proposals: privacy token load failed: error-class=token-load-failure\n',
    )
    expect(requests()).toEqual([])
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error: exit 1, nothing read, nothing written, even on the live path',
    async argv => {
      const cwd = openCheckout()
      const result = await runFake('status-truth-proposals', [...EMPTY_LISTS, ...WRITE_ROUTES, LABEL_GET], {
        cwd,
        argv,
        env: openEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', GITHUB_TOKEN: 'tok-write'}),
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(requests()).toEqual([])
      expect(() => readFileSync(join(cwd, 'result.json'), 'utf8')).toThrow()
    },
  )
})

// ─── status-truth-prs ────────────────────────────────────────────────────────────────────────────

const PLAN_B_LIVE = '---\nstatus: active\n---\n# Plan\n\n- [x] **Unit 1: thing**\n- [x] **Unit 2: thing**\n'
const PLAN_B_CORRECTED = PLAN_B_LIVE.replace('status: active', 'status: complete')
const FP_PLAN_B = '229e16b3ce7e4e6b'
// sha256("status-truth-pr:" + fingerprint), first 16 hex digits: the opaque digest in the branch name and title.
const BRANCH_B = 'status-truth/correction-07c2afe4f3322f80'

const PLAN_REPORT = reportOf([
  {
    kind: 'plan-consistency',
    path: 'docs/plans/b.md',
    sourceRef: 'docs/plans/b.md',
    verdict: 'drifted',
    fingerprint: FP_PLAN_B,
    claimedState: 'active',
    liveState: 'checked-2-unchecked-0',
    proposalEligible: true,
    proposedCorrection: 'status: complete',
  },
])

const b64 = (text: string) => Buffer.from(text).toString('base64')
const NO_PRS = route('GET', `${CONTROL}/pulls`, {b: []})
const NO_TERMINAL_ISSUES = route('GET', `${CONTROL}/issues`, {b: []})
const OPEN_PATH: readonly FakeRoute[] = [
  NO_PRS,
  NO_TERMINAL_ISSUES,
  route('GET', `${CONTROL}/contents/docs/plans/b.md`, {
    b: {content: b64(PLAN_B_LIVE), encoding: 'base64', sha: 'base-sha'},
  }),
  route('GET', `${CONTROL}/git/ref/heads/main`, {b: {object: {sha: 'head-sha'}}}),
  route('POST', `${CONTROL}/git/refs`, {s: 201, b: {ref: 'refs/heads/x'}}),
  route('PUT', `${CONTROL}/contents/docs/plans/b.md`, {b: {commit: {sha: 'c1'}}}),
  route('POST', `${CONTROL}/pulls`, {s: 201, b: {number: 700}}),
]

const ARMED_ENV = {STATUS_TRUTH_PRS_ENABLED: 'true', STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true'}
const TOKENS = {GITHUB_TOKEN: 'tok-write', STATUS_TRUTH_FETCH_TOKEN: 'tok-fetch'}

/** Every `jq` path of the "Write PR execution summary" step (`status-truth.yaml:448-468`). */
const PLANNED_KEYS = [
  'prActionsPlanned',
  'downgradedToProposalOnly',
  'pathForbidden',
  'privacyGateBlocked',
  'overflow',
  'versionRejected',
]
const EXECUTED_KEYS = [
  'opened',
  'closed',
  'downgraded',
  'safetyRefused',
  'failed',
  'branchDeleteFailed',
  'rediscovered',
  'wouldOpen',
  'wouldClose',
  'wouldRediscover',
]

function prsEnv(cwd: string, extra: Readonly<Record<string, string | undefined>> = {}) {
  return {
    STATUS_TRUTH_REPORT_PATH: join(cwd, 'report.json'),
    STATUS_TRUTH_PRS_RESULT_PATH: join(cwd, 'result.json'),
    GITHUB_REPOSITORY: 'fro-bot/.github',
    ...extra,
  }
}

function prsCheckout(report: unknown = PLAN_REPORT, extra: Readonly<Record<string, string>> = {}) {
  return checkout({'report.json': JSON.stringify(report), 'metadata/repos.yaml': REPOS_YAML, ...extra})
}

describe('status-truth-prs (bun, status-truth.yaml: no argv)', () => {
  it('a disarmed run prints a counts-only result, writes the result file, reads nothing and exits 0', async () => {
    const cwd = checkout({})
    const result = await runFake('status-truth-prs', OPEN_PATH, {
      cwd,
      env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', STATUS_TRUTH_PRS_DISPATCH_INPUT: 'false'}),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(readFileSync(join(cwd, 'result.json'), 'utf8')).toBe(result.stdout)
    const parsed = JSON.parse(result.stdout) as Record<string, Record<string, number> | boolean>
    expect(parsed.armed).toBe(false)
    expect(parsed.dryRun).toBe(true)
    expect(Object.keys(parsed.plannedCounts as object).sort()).toEqual([...PLANNED_KEYS].sort())
    expect(Object.keys(parsed.executedCounts as object).sort()).toEqual([...EXECUTED_KEYS].sort())
    expect(requests()).toEqual([])
  })

  it('an armed dry run (the workflow default) plans the open, reports wouldOpen and makes no mutating call', async () => {
    const cwd = prsCheckout()
    const result = await runFake('status-truth-prs', OPEN_PATH, {
      cwd,
      env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', ...ARMED_ENV, ...TOKENS}),
    })

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toMatchObject({
      armed: true,
      dryRun: true,
      plannedCounts: {prActionsPlanned: 1},
      executedCounts: {wouldOpen: 1, opened: 0, failed: 0},
      terminalFingerprintsSkipped: 0,
      terminalFingerprintDuplicates: 0,
    })
    expect(parsed.error).toBeUndefined()
    expect(readFileSync(join(cwd, 'result.json'), 'utf8')).toBe(result.stdout)
    // Dry run reads only: the open-PR list and the terminal proposals, with the read-only token, and no write.
    expect(requests().every(line => line.startsWith('GET '))).toBe(true)
    expect(requests().every(line => line.includes(' auth=tok-fetch'))).toBe(true)
    expect(unhandledMutations()).toEqual([])
  })

  it('an armed dry run needs no token and makes no request', async () => {
    const cwd = prsCheckout()
    const result = await runFake('status-truth-prs', OPEN_PATH, {
      cwd,
      env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', ...ARMED_ENV}),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({armed: true, dryRun: true, executedCounts: {wouldOpen: 1}})
    expect(requests()).toEqual([])
  })

  it('STATUS_TRUTH_DRY_RUN=false opens one correction PR: branch, file update and pull request, with the write token', async () => {
    const cwd = prsCheckout()
    const result = await runFake('status-truth-prs', OPEN_PATH, {
      cwd,
      env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', ...ARMED_ENV, ...TOKENS}),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      armed: true,
      dryRun: false,
      plannedCounts: {prActionsPlanned: 1},
      executedCounts: {opened: 1, failed: 0},
    })
    const writes = mutating()
    expect(writes).toHaveLength(3)
    for (const line of writes) expect(line).toContain(' auth=tok-write')
    expect(writes[0]).toContain(
      `POST /repos/fro-bot/.github/git/refs auth=tok-write body={"ref":"refs/heads/${BRANCH_B}"`,
    )
    expect(writes[1]).toContain(`PUT /repos/fro-bot/.github/contents/docs/plans/b.md`)
    expect(writes[1]).toContain(JSON.stringify(PLAN_B_CORRECTED).slice(1, -1))
    expect(writes[2]).toContain(`"head":"${BRANCH_B}"`)
    expect(writes[2]).toContain('"base":"main"')
    expect(unhandledMutations()).toEqual([])
  })

  it('exits 1 with a closed-vocabulary error and a result when the report is missing, unreadable or invalid', async () => {
    const cwd = prsCheckout(undefined, {'report.json': '{nope'})
    const result = await runFake('status-truth-prs', OPEN_PATH, {
      cwd,
      env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'true', ...ARMED_ENV, ...TOKENS}),
    })

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({armed: true, dryRun: true, error: 'report-failure'})
    expect(readFileSync(join(cwd, 'result.json'), 'utf8')).toBe(result.stdout)
    expect(requests()).toEqual([])
  })

  it('exits 1 with error=fetch-failure before any write when a live fetch fails', async () => {
    const cwd = prsCheckout()
    const result = await runFake(
      'status-truth-prs',
      [route('GET', `${CONTROL}/pulls`, {s: 500, b: {message: 'boom'}}), NO_TERMINAL_ISSUES],
      {
        cwd,
        env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', ...ARMED_ENV, ...TOKENS}),
      },
    )

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({armed: true, dryRun: false, error: 'fetch-failure'})
    expect(mutating()).toEqual([])
  })

  // Only the exact string 'true' is a dry run in the script; the workflow supplies it by default
  // (`github.event.inputs.dry_run || 'true'`). A disarmed run writes nothing whatever the value is.
  it.each([[undefined], ['1'], ['TRUE']])(
    'STATUS_TRUTH_DRY_RUN=%j is not a dry run once armed (the workflow default supplies it)',
    async value => {
      const cwd = prsCheckout()
      const result = await runFake('status-truth-prs', OPEN_PATH, {
        cwd,
        env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: value, ...ARMED_ENV, ...TOKENS}),
      })

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({armed: true, dryRun: false, executedCounts: {opened: 1}})
    },
  )

  it('stays disarmed, and writes nothing, without both arming keys even on the live path', async () => {
    const cwd = prsCheckout()
    const result = await runFake('status-truth-prs', OPEN_PATH, {
      cwd,
      env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', STATUS_TRUTH_PRS_ENABLED: 'true', ...TOKENS}),
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({armed: false, dryRun: false})
    expect(requests()).toEqual([])
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']]])(
    'argv %j is a usage error: exit 1, nothing read, nothing written, even when armed and live',
    async argv => {
      const cwd = prsCheckout()
      const result = await runFake('status-truth-prs', OPEN_PATH, {
        cwd,
        argv,
        env: prsEnv(cwd, {STATUS_TRUTH_DRY_RUN: 'false', ...ARMED_ENV, ...TOKENS}),
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(requests()).toEqual([])
      expect(() => readFileSync(join(cwd, 'result.json'), 'utf8')).toThrow()
    },
  )
})
