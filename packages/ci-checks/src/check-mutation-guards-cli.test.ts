import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {checkMutationGuardsCli, main} from './check-mutation-guards-cli.ts'
import {VERDICTS, type ClassificationResult} from './check-mutation-guards.ts'

// Nothing here may spawn Stryker or call `gh`: the mock replaces both child-process entry points the module graph
// reaches (`spawnSync` in the gate, `execFileSync` in the changed-file fetch of @fro-bot/core/wiki-authority).
const {mockSpawnSync, mockExecFileSync} = vi.hoisted(() => ({mockSpawnSync: vi.fn(), mockExecFileSync: vi.fn()}))
vi.mock('node:child_process', () => ({spawnSync: mockSpawnSync, execFileSync: mockExecFileSync}))

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-mutation-guards-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  mockSpawnSync.mockReset()
  mockExecFileSync.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

const result = (verdict: ClassificationResult['verdict']): ClassificationResult => ({verdict, mutants: []})

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = checkMutationGuardsCli()
    expect(config.name).toBe('check-mutation-guards')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(checkMutationGuardsCli()).not.toBe(checkMutationGuardsCli())
  })
})

describe('the exit code', () => {
  // The step fails on any verdict but these two; the report upload is `if: always()` and does not read it.
  const EXPECTED: Record<(typeof VERDICTS)[number], number> = {
    'instrumentation-failed': 1,
    'directive-violation': 1,
    'mutant-timeout': 1,
    'mutants-uncovered': 1,
    'mutants-survived': 1,
    clean: 0,
    'not-applicable': 0,
  }

  it.each(VERDICTS)('is %s -> the exit code of exitCodeFor', async verdict => {
    const run = vi.fn(async () => result(verdict))
    const print = vi.fn()
    const outcome = await runCli(checkMutationGuardsCli(run, print), {argv: [], env: {}})
    expect(outcome).toEqual({exitCode: EXPECTED[verdict], stdout: '', stderr: ''})
    expect(print).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledWith(result(verdict))
  })

  it('prints the result after the run, once, and runs the guard once', async () => {
    const order: string[] = []
    const run = vi.fn(async () => {
      order.push('run')
      return result('clean')
    })
    const print = vi.fn(() => {
      order.push('print')
    })
    await runCli(checkMutationGuardsCli(run, print), {argv: [], env: {}})
    expect(order).toEqual(['run', 'print'])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('exits 1 with the message on stderr when the guard throws, and prints no verdict', async () => {
    const run = vi.fn(async (): Promise<ClassificationResult> => {
      throw new Error('ENOENT: no such file or directory, open stryker.config.json')
    })
    const print = vi.fn()
    const outcome = await runCli(checkMutationGuardsCli(run, print), {argv: [], env: {}})
    expect(outcome).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'ENOENT: no such file or directory, open stryker.config.json\n',
    })
    expect(print).not.toHaveBeenCalled()
  })
})

describe('argv that no caller sends', () => {
  // Before the runner these were ignored and the gate ran.
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, the guard does not run',
    async argv => {
      const run = vi.fn(async () => result('clean'))
      const print = vi.fn()
      const outcome = await runCli(checkMutationGuardsCli(run, print), {argv, env: {}})
      expect(outcome.exitCode).toBe(1)
      expect(outcome.stdout).toBe('')
      expect(outcome.stderr).toContain('Usage')
      expect(run).not.toHaveBeenCalled()
      expect(print).not.toHaveBeenCalled()
    },
  )
})

function eventFile(name: string): string {
  const path = join(root, `${name}.json`)
  writeFileSync(
    path,
    JSON.stringify({
      pull_request: {
        number: 7,
        user: {login: 'someone'},
        head: {ref: 'feature', repo: {full_name: 'fro-bot/.github'}},
        base: {repo: {full_name: 'fro-bot/.github'}},
      },
    }),
  )
  return path
}

// What `gh api --paginate .../pulls/{n}/files --jq '.[] | {filename, previous_filename}'` prints: one compact JSON
// object per changed file. A string entry is a file with no previous path; a `[filename, previous]` tuple is a rename.
function ghFiles(...entries: readonly (string | readonly [filename: string, previous: string])[]): string {
  return entries
    .map(entry => {
      const [filename, previous] = typeof entry === 'string' ? [entry, null] : entry
      return `${JSON.stringify({filename, previous_filename: previous})}\n`
    })
    .join('')
}

async function runMain(env: Record<string, string>): Promise<{stdout: string; stderr: string}> {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const argv = process.argv
  process.argv = [argv[0] ?? 'node', '/x/check-mutation-guards.ts']
  try {
    await main()
  } finally {
    process.argv = argv
  }
  expect(exit).not.toHaveBeenCalled()
  return {
    stdout: stdout.mock.calls.map(call => String(call[0])).join(''),
    stderr: stderr.mock.calls.map(call => String(call[0])).join(''),
  }
}

describe('main, with the real guard against the real stryker.config.json and a stubbed pull_request event', () => {
  it('reports not-applicable and exits 0 for a docs-only change, without spawning Stryker', async () => {
    mockExecFileSync.mockReturnValue(ghFiles('README.md', 'docs/plans/x.md'))
    const summary = join(root, 'summary-na.md')
    writeFileSync(summary, 'earlier\n')
    const output = await runMain({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventFile('docs-only'),
      GITHUB_STEP_SUMMARY: summary,
    })
    expect(process.exitCode).toBe(0)
    expect(output.stdout).toMatch(/^trigger-gate:0:0 trigger-gate NotApplicable\nnot-applicable\n$/u)
    expect(readFileSync(summary, 'utf8')).toBe(`earlier\n${output.stdout}`)
    expect(mockSpawnSync).not.toHaveBeenCalled()
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'gh',
      ['api', '--paginate', '/repos/fro-bot/.github/pulls/7/files', '--jq', '.[] | {filename, previous_filename}'],
      {encoding: 'utf8'},
    )
  })

  it('runs the gate when a configured mutation test is renamed to an unrelated path', async () => {
    // #given the only new path is outside the trigger set, but its previous path is a configured test file
    mockExecFileSync.mockReturnValue(
      ghFiles(['docs/moved-test.ts', 'packages/ci-checks/src/check-md-links-cli.test.ts']),
    )
    const output = await runMain({GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile('renamed-test')})
    // #then the gate does not short-circuit to not-applicable and reaches Stryker
    expect(output.stdout).not.toContain('NotApplicable')
    expect(output.stdout).not.toContain('not-applicable')
    expect(mockSpawnSync).toHaveBeenCalled()
  })

  it('fails closed with instrumentation-failed and exit 1 when the changed files cannot be fetched', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh: HTTP 502')
    })
    const output = await runMain({GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile('gh-fails')})
    expect(process.exitCode).toBe(1)
    expect(output.stdout).toMatch(/^trigger-gate:0:0 trigger-gate ChangedFileGateFailed\ninstrumentation-failed\n$/u)
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })
})
