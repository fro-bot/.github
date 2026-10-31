import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The client options each entrypoint hands the core factory, observed through its own entry: the
 * module is imported with `process.argv[1]` pointing at it, which is what runs its CLI, against a
 * recording `@octokit/rest` constructor. The recording client has no API, so every run fails once it
 * reaches GitHub; what is asserted is what the constructor received before that.
 */

const constructed: Record<string, unknown>[] = []

const ENVIRONMENT = [
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_EVENT_PATH',
  'CROSS_REPO_DISPATCH_TARGET_TOKENS',
  'STATUS_TRUTH_REPORT_PATH',
  'STATUS_TRUTH_OPEN_RESULT_PATH',
  'STATUS_TRUTH_DRY_RUN',
  'WIKI_LINT_JSON_PATH',
] as const
const saved: Record<string, string | undefined> = {}
let workDirectory = ''
let exitMode: 'throw' | 'ignore' = 'throw'
let stderrLines: string[] = []

class ExitSignal extends Error {
  readonly code: number | string | null | undefined
  constructor(code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`)
    this.code = code
  }
}

beforeEach(async () => {
  constructed.length = 0
  exitMode = 'throw'
  for (const name of ENVIRONMENT) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  workDirectory = await mkdtemp(join(tmpdir(), 'octokit-entrypoints-'))
  vi.resetModules()
  vi.doMock('@octokit/rest', () => ({
    Octokit: function Octokit(options: Record<string, unknown>) {
      constructed.push(options)
    },
  }))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrLines = []
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderrLines.push(String(chunk))
    return true
  })
  vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    if (exitMode === 'throw') throw new ExitSignal(code)
    return undefined as never
  })
})

afterEach(async () => {
  for (const name of ENVIRONMENT) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  vi.restoreAllMocks()
  vi.doUnmock('@octokit/rest')
  vi.resetModules()
  process.exitCode = undefined
  await rm(workDirectory, {recursive: true, force: true})
})

function stderrText(): string {
  return stderrLines.join('')
}

/** Runs a script's CLI by importing it as the entry module. Resolves to what the run rejected with. */
async function runAsEntry(script: string, load: () => Promise<unknown>): Promise<unknown> {
  const originalEntry = process.argv[1]
  process.argv[1] = fileURLToPath(new URL(script, import.meta.url))
  try {
    await load()
    return undefined
  } catch (error: unknown) {
    return error
  } finally {
    if (originalEntry === undefined) process.argv.length = 1
    else process.argv[1] = originalEntry
  }
}

function silentLog(options: Record<string, unknown> | undefined): string[] {
  const log = options?.log as Record<string, (message: string) => unknown> | undefined
  return Object.keys(log ?? {}).sort()
}

async function writeLintReport(): Promise<void> {
  const path = join(workDirectory, 'lint.json')
  await writeFile(
    path,
    JSON.stringify({
      schema_version: 1,
      fingerprint_version: 1,
      status: 'clean',
      scan_complete: true,
      snapshot_sha: null,
      generated_at: '2026-06-28T00:00:00Z',
      failure_class: null,
      repair_eligible: false,
      findings: [],
      freshness: [],
      counts: {findings_total: 0, findings_deterministic: 0, findings_advisory: 0, pages_scanned: 0, pages_stale: 0},
    }),
    'utf8',
  )
  process.env.WIKI_LINT_JSON_PATH = path
}

async function writeEvent(): Promise<void> {
  const path = join(workDirectory, 'event.json')
  await writeFile(
    path,
    JSON.stringify({label: {name: 'dispatch-approved'}, sender: {login: 'someone'}, issue: {number: 7}}),
    'utf8',
  )
  process.env.GITHUB_EVENT_PATH = path
  process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
}

describe('status-truth-proposals', () => {
  const report = {
    schema_version: 1,
    fingerprint_version: 1,
    status: 'findings',
    scan_complete: true,
    generated_at: '2026-06-28T00:00:00Z',
    failure_class: null,
    repair_eligible: true,
    findings: [],
    counts: {total: 0, current: 0, drifted: 0, unresolved: 0, unsafe: 0, proposal_eligible: 0},
  }

  async function writeReport(): Promise<void> {
    const path = join(workDirectory, 'report.json')
    await writeFile(path, JSON.stringify(report), 'utf8')
    process.env.STATUS_TRUTH_REPORT_PATH = path
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
  }

  it('dry run: builds its read-only client from GITHUB_TOKEN with a 10 s timeout and a silent logger', async () => {
    await writeReport()
    process.env.STATUS_TRUTH_DRY_RUN = 'true'
    process.env.GITHUB_TOKEN = 'dry-run-token'

    await runAsEntry('./status-truth-proposals.ts', async () => import('./status-truth-proposals.ts'))

    expect(constructed).toHaveLength(1)
    expect(constructed[0]).toMatchObject({auth: 'dry-run-token', request: {timeout: 10_000}})
    expect(silentLog(constructed[0])).toEqual(['debug', 'error', 'info', 'warn'])
  })

  it('dry run: builds no client without a token', async () => {
    await writeReport()
    process.env.STATUS_TRUTH_DRY_RUN = 'true'

    await runAsEntry('./status-truth-proposals.ts', async () => import('./status-truth-proposals.ts'))

    expect(constructed).toStrictEqual([])
  })

  it('live run: builds its client from GITHUB_TOKEN with a 10 s timeout and a silent logger', async () => {
    await writeReport()
    process.env.GITHUB_TOKEN = 'live-token'

    const failure = await runAsEntry('./status-truth-proposals.ts', async () => import('./status-truth-proposals.ts'))

    // The recording client cannot list issues, so the live run exits before planning.
    expect(failure).toBeInstanceOf(ExitSignal)
    expect(constructed).toHaveLength(1)
    expect(constructed[0]).toMatchObject({auth: 'live-token', request: {timeout: 10_000}})
    expect(silentLog(constructed[0])).toEqual(['debug', 'error', 'info', 'warn'])
  })

  it('live run: without GITHUB_TOKEN, fails with its own message and builds no client', async () => {
    await writeReport()

    const failure = await runAsEntry('./status-truth-proposals.ts', async () => import('./status-truth-proposals.ts'))

    expect(failure).toMatchObject({message: 'status-truth-proposals: GITHUB_TOKEN is required in the environment'})
    expect(constructed).toStrictEqual([])
  })
})

describe('status-truth-detect', () => {
  it('builds its client from GITHUB_TOKEN with a 10 s timeout and a silent logger', async () => {
    process.env.STATUS_TRUTH_REPORT_PATH = join(workDirectory, 'detect-report.json')
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'
    process.env.GITHUB_TOKEN = 'detect-token'

    await runAsEntry('./status-truth-detect.ts', async () => import('./status-truth-detect.ts'))

    expect(constructed).toHaveLength(1)
    expect(constructed[0]).toMatchObject({auth: 'detect-token', request: {timeout: 10_000}})
    expect(silentLog(constructed[0])).toEqual(['debug', 'error', 'info', 'warn'])
  }, 60_000)

  it('builds no client without a token', async () => {
    process.env.STATUS_TRUTH_REPORT_PATH = join(workDirectory, 'detect-report.json')
    process.env.GITHUB_REPOSITORY = 'fro-bot/.github'

    await runAsEntry('./status-truth-detect.ts', async () => import('./status-truth-detect.ts'))

    expect(constructed).toStrictEqual([])
  }, 60_000)
})

describe('wiki-lint-issues', () => {
  it('builds its client from GITHUB_TOKEN, with no timeout and no logger', async () => {
    exitMode = 'ignore'
    await writeLintReport()
    process.env.GITHUB_TOKEN = 'lint-token'

    await runAsEntry('./wiki-lint-issues.ts', async () => import('./wiki-lint-issues.ts'))
    await vi.waitFor(() => {
      expect(constructed).toHaveLength(1)
    })

    expect(constructed).toStrictEqual([{auth: 'lint-token'}])
  })

  it('without GITHUB_TOKEN, reports its own message and builds no client', async () => {
    exitMode = 'ignore'
    await writeLintReport()

    await runAsEntry('./wiki-lint-issues.ts', async () => import('./wiki-lint-issues.ts'))
    await vi.waitFor(() => {
      expect(stderrText()).toContain('GITHUB_TOKEN is not set')
    })

    expect(constructed).toStrictEqual([])
  })
})

describe('cross-repo-dispatch', () => {
  it('builds the tracker client and every target client with a 15 s timeout and no logger', async () => {
    await writeEvent()
    process.env.GITHUB_TOKEN = 'tracker-token'
    process.env.CROSS_REPO_DISPATCH_TARGET_TOKENS = JSON.stringify({
      'fro-bot': 'target-one',
      marcusrbrown: 'target-two',
    })
    const {runDispatchCli} = await import('./cross-repo-dispatch.ts')

    await runDispatchCli().catch(() => undefined)

    expect(constructed).toStrictEqual([
      {auth: 'tracker-token', request: {timeout: 15_000}},
      {auth: 'target-one', request: {timeout: 15_000}},
      {auth: 'target-two', request: {timeout: 15_000}},
    ])
  })

  it('without GITHUB_TOKEN, fails with its own message before building any client', async () => {
    await writeEvent()
    const {runDispatchCli} = await import('./cross-repo-dispatch.ts')

    const failure = await runDispatchCli().then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({message: 'cross-repo-dispatch: GITHUB_TOKEN is required in the environment'})
    expect(constructed).toStrictEqual([])
  })
})
