import type {MergeOutcome} from './mutation-merge.ts'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {spawnEntrypoint} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {printResult, VERDICTS, type ClassificationResult} from './check-mutation-guards.ts'
import {main, mutationMergeCli} from './mutation-merge-cli.ts'
import {findRepositoryRoot} from './repository-root.ts'

// Nothing here may start Stryker or call `gh`: the module graph reaches both through `spawnSync` and `execFileSync`.
// `spawn` stays real, because the spawned-entrypoint tests below need it and no mutated module uses it.
const {mockSpawnSync, mockExecFileSync} = vi.hoisted(() => ({mockSpawnSync: vi.fn(), mockExecFileSync: vi.fn()}))
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: mockSpawnSync,
  execFileSync: mockExecFileSync,
}))

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mutation-merge-cli-'))
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

const result = (verdict: ClassificationResult['verdict']): ClassificationResult => ({
  verdict,
  mutants: [{file: 'a.ts', line: 3, col: 4, mutator: 'StringLiteral', status: 'Survived'}],
})
const resultOutcome = (verdict: ClassificationResult['verdict']): MergeOutcome => ({
  kind: 'result',
  result: result(verdict),
})

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = mutationMergeCli()
    expect(config.name).toBe('mutation-merge')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(mutationMergeCli()).not.toBe(mutationMergeCli())
  })
})

describe('the exit code', () => {
  const EXPECTED: Record<(typeof VERDICTS)[number], number> = {
    'instrumentation-failed': 1,
    'directive-violation': 1,
    'mutant-timeout': 1,
    'mutants-uncovered': 1,
    'mutants-survived': 1,
    clean: 0,
    'not-applicable': 0,
  }

  it.each(VERDICTS)('is %s -> the exit code of exitCodeFor, with the result printed once', async verdict => {
    const run = vi.fn(async () => resultOutcome(verdict))
    const print = vi.fn()
    const env = {MUTATION_EVENT_SHA: 'x'}
    const outcome = await runCli(mutationMergeCli(run, print), {argv: [], env})
    expect(outcome).toEqual({exitCode: EXPECTED[verdict], stdout: '', stderr: ''})
    expect(print).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledWith(result(verdict))
    expect(run).toHaveBeenCalledWith(env)
  })

  it('prints the result after the run, once, and runs the merge once', async () => {
    const order: string[] = []
    const run = vi.fn(async () => {
      order.push('run')
      return resultOutcome('clean')
    })
    const print = vi.fn(() => {
      order.push('print')
    })
    await runCli(mutationMergeCli(run, print), {argv: [], env: {}})
    expect(order).toEqual(['run', 'print'])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('exits 1 with the message and the usage line on stderr for a usage error, and prints no verdict', async () => {
    const print = vi.fn()
    const outcome = await runCli(
      mutationMergeCli(async () => ({kind: 'usage', message: 'MUTATION_ARTIFACT_DIR must be set (got unset)'}), print),
      {argv: [], env: {}},
    )
    expect(outcome.exitCode).toBe(1)
    expect(outcome.stdout).toBe('')
    expect(outcome.stderr).toBe(
      'mutation-merge: MUTATION_ARTIFACT_DIR must be set (got unset)\n' +
        'Usage: set MUTATION_ARTIFACT_DIR, MUTATION_EVENT_SHA and MUTATION_SHARD_<n>_RESULT for every shard in the environment; the command takes no arguments.\n',
    )
    expect(print).not.toHaveBeenCalled()
  })

  it('exits 1 with the message on stderr when the merge throws, and prints no verdict', async () => {
    const print = vi.fn()
    const outcome = await runCli(
      mutationMergeCli(async () => {
        throw new Error('ENOENT: no such file or directory, open stryker.config.json')
      }, print),
      {argv: [], env: {}},
    )
    expect(outcome).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'ENOENT: no such file or directory, open stryker.config.json\n',
    })
    expect(print).not.toHaveBeenCalled()
  })
})

describe('failure details on stderr', () => {
  const detail = (file: string, mutator: string, status: string, reason?: string) => ({
    file,
    line: 0,
    col: 0,
    mutator,
    status,
    ...(reason === undefined ? {} : {reason}),
  })

  it('writes one stderr line per merge failure with its status and reason, and leaves stdout and the exit code alone', async () => {
    const failed: ClassificationResult = {
      verdict: 'instrumentation-failed',
      mutants: [
        detail(
          'mutation-shard-2',
          'shard-merge',
          'ShardFilesMismatch',
          'files keys differ from the shard list: missing a.ts; unexpected b.ts',
        ),
        detail(
          'mutation-shard-3',
          'shard-merge',
          'ShardResultNotSuccess',
          'the job result is "cancelled", not "success"',
        ),
        detail(
          'packages/x.test.ts',
          'vitest-config',
          'TestFileNotExecuted',
          'shard 1 ran no tests from this configured test file',
        ),
      ],
    }
    const print = vi.fn()
    const outcome = await runCli(
      mutationMergeCli(async () => ({kind: 'result', result: failed}), print),
      {argv: [], env: {}},
    )
    expect(outcome.exitCode).toBe(1)
    expect(outcome.stdout).toBe('')
    expect(outcome.stderr).toBe(
      'mutation-merge: mutation-shard-2: ShardFilesMismatch: files keys differ from the shard list: missing a.ts; unexpected b.ts\n' +
        'mutation-merge: mutation-shard-3: ShardResultNotSuccess: the job result is "cancelled", not "success"\n' +
        'mutation-merge: packages/x.test.ts: TestFileNotExecuted: shard 1 ran no tests from this configured test file\n',
    )
    expect(print).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledWith(failed)
  })

  it('skips a mutant with no reason, and any mutant that did not come from a merge check', async () => {
    const result: ClassificationResult = {
      verdict: 'instrumentation-failed',
      mutants: [
        detail('mutation-shard-1', 'shard-merge', 'ShardArtifactMissing'),
        detail('/x/mutation.json', 'ReportUnreadable', 'RuntimeError', 'Unexpected token in JSON at position 0'),
      ],
    }
    const outcome = await runCli(
      mutationMergeCli(async () => ({kind: 'result', result}), vi.fn()),
      {argv: [], env: {}},
    )
    expect(outcome.stderr).toBe('')
  })

  it('writes nothing to stderr for a verdict that is not instrumentation-failed', async () => {
    const result: ClassificationResult = {
      verdict: 'mutants-survived',
      mutants: [detail('a.ts', 'shard-merge', 'Survived', 'a reason')],
    }
    const outcome = await runCli(
      mutationMergeCli(async () => ({kind: 'result', result}), vi.fn()),
      {argv: [], env: {}},
    )
    expect(outcome.stderr).toBe('')
    expect(outcome.exitCode).toBe(1)
  })
})

describe('the real printer', () => {
  it('prints the located mutants and the verdict once to stdout, and appends them once to the step summary', async () => {
    const summary = join(root, 'summary.md')
    writeFileSync(summary, 'earlier\n')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const outcome = await runCli(
      mutationMergeCli(async () => resultOutcome('mutants-survived'), printResult),
      {
        argv: [],
        env: {},
      },
    )
    expect(outcome.exitCode).toBe(1)

    const printed = stdout.mock.calls.map(call => String(call[0])).join('')
    expect(printed).toBe('a.ts:3:4 StringLiteral Survived\nmutants-survived\n')
    expect(readFileSync(summary, 'utf8')).toBe(`earlier\n${printed}`)
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, the merge does not run',
    async argv => {
      const run = vi.fn(async () => resultOutcome('clean'))
      const print = vi.fn()
      const outcome = await runCli(mutationMergeCli(run, print), {argv, env: {}})
      expect(outcome.exitCode).toBe(1)
      expect(outcome.stdout).toBe('')
      expect(outcome.stderr).toContain('Usage')
      expect(run).not.toHaveBeenCalled()
      expect(print).not.toHaveBeenCalled()
    },
  )
})

describe('main, with the real merge and an empty environment', () => {
  it('is a usage error and starts nothing', async () => {
    for (const name of ['MUTATION_ARTIFACT_DIR', 'MUTATION_EVENT_SHA']) vi.stubEnv(name, undefined)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/mutation-merge.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(stdout.mock.calls).toEqual([])
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain(
      'mutation-merge: MUTATION_ARTIFACT_DIR must be set (got unset)',
    )
    expect(mockSpawnSync).not.toHaveBeenCalled()
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })
})

describe('scripts/mutation-merge.ts, spawned', () => {
  // The same guard as the shard shim: a path with a space makes a `file://${process.argv[1]}` comparison false and the
  // shim would exit 0 without running. The copy runs with no merge environment, so it stops on the usage error.
  it('runs from a directory with a space in its name, and exits on the usage error', async () => {
    const repositoryRoot = findRepositoryRoot()
    const checkout = join(root, 'with space')
    mkdirSync(join(checkout, 'scripts'), {recursive: true})
    mkdirSync(join(checkout, 'node_modules', '@fro-bot'), {recursive: true})
    copyFileSync(join(repositoryRoot, 'scripts', 'mutation-merge.ts'), join(checkout, 'scripts', 'mutation-merge.ts'))
    symlinkSync(join(repositoryRoot, 'packages', 'ci-checks'), join(checkout, 'node_modules', '@fro-bot', 'ci-checks'))
    symlinkSync(join(repositoryRoot, 'packages', 'core'), join(checkout, 'node_modules', '@fro-bot', 'core'))

    const spawned = await spawnEntrypoint({
      entrypoint: join(checkout, 'scripts', 'mutation-merge.ts'),
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd: checkout,
      env: {MUTATION_ARTIFACT_DIR: undefined, MUTATION_EVENT_SHA: undefined},
    })
    expect(spawned.exitCode).toBe(1)
    expect(spawned.stdout).toBe('')
    expect(spawned.stderr).toContain('mutation-merge: MUTATION_ARTIFACT_DIR must be set (got unset)')
    expect(existsSync(join(checkout, 'reports'))).toBe(false)
  })

  it('does nothing when imported rather than run', async () => {
    const repositoryRoot = findRepositoryRoot()
    const harness = join(root, 'import-shim.ts')
    const shim = JSON.stringify(join(repositoryRoot, 'scripts', 'mutation-merge.ts'))
    writeFileSync(
      harness,
      `import {pathToFileURL} from 'node:url'
await import(pathToFileURL(${shim}).href)
process.stdout.write('imported:' + String(process.exitCode ?? 'unset'))
`,
    )
    const spawned = await spawnEntrypoint({
      entrypoint: harness,
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd: root,
      env: {MUTATION_ARTIFACT_DIR: undefined},
    })
    expect(spawned).toEqual({exitCode: 0, stdout: 'imported:unset', stderr: '', githubOutput: ''})
  })
})
