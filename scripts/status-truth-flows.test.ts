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

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {spawnEntrypoint, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..')

let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'status-truth-flows-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

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
  it.each(['rollout-tracker-snapshot'])(
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
