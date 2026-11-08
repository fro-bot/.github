import type {ShardManifest, ShardResult} from './mutation-shard.ts'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {spawnEntrypoint} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {main, mutationShardCli} from './mutation-shard-cli.ts'
import {findRepositoryRoot} from './repository-root.ts'

// Nothing here may start Stryker or call `gh`: the module graph reaches both through `spawnSync` and `execFileSync`. `spawn`
// stays real, because the spawned-entrypoint test below needs it and no mutated module uses it.
const {mockSpawnSync, mockExecFileSync} = vi.hoisted(() => ({mockSpawnSync: vi.fn(), mockExecFileSync: vi.fn()}))
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: mockSpawnSync,
  execFileSync: mockExecFileSync,
}))

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mutation-shard-cli-'))
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

const SHA = 'c'.repeat(40)
const manifest = (applicability: ShardManifest['applicability']): ShardManifest => ({
  shard: 2,
  head: SHA,
  eventSha: SHA,
  applicability,
})

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = mutationShardCli()
    expect(config.name).toBe('mutation-shard')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(mutationShardCli()).not.toBe(mutationShardCli())
  })
})

describe('the outcome of a shard run', () => {
  const env = {MUTATION_SHARD: '2'}

  it('prints the shard, its applicability and its HEAD, and exits 0 when the output is written', async () => {
    const run = vi.fn(async (): Promise<ShardResult> => ({kind: 'written', manifest: manifest('applicable')}))
    const outcome = await runCli(mutationShardCli(run), {argv: [], env})
    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `mutation-shard: shard 2 applicable (head ${SHA})\n`,
      stderr: '',
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(env)
  })

  it('says not-applicable for a not-applicable manifest, and still exits 0', async () => {
    const outcome = await runCli(
      mutationShardCli(async () => ({kind: 'written', manifest: manifest('not-applicable')})),
      {argv: [], env},
    )
    expect(outcome).toEqual({
      exitCode: 0,
      stdout: `mutation-shard: shard 2 not-applicable (head ${SHA})\n`,
      stderr: '',
    })
  })

  it('exits 1 with the reason on stderr and nothing on stdout when the shard failed', async () => {
    const outcome = await runCli(
      mutationShardCli(async () => ({kind: 'failed', reason: 'could not read the Stryker report /x'})),
      {argv: [], env},
    )
    expect(outcome).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'mutation-shard: could not read the Stryker report /x\n',
    })
  })

  it('exits 1 with the message and the usage line on stderr for a usage error', async () => {
    const outcome = await runCli(
      mutationShardCli(async () => ({kind: 'usage', message: 'MUTATION_SHARD must be one of 1-3 (got 4)'})),
      {argv: [], env},
    )
    expect(outcome.exitCode).toBe(1)
    expect(outcome.stdout).toBe('')
    expect(outcome.stderr).toBe(
      'mutation-shard: MUTATION_SHARD must be one of 1-3 (got 4)\n' +
        'Usage: set MUTATION_SHARD, MUTATION_SHARD_EVENT_SHA and MUTATION_SHARD_OUTPUT_DIR in the environment; the command takes no arguments.\n',
    )
  })

  it('exits 1 with the message when the run throws', async () => {
    const outcome = await runCli(
      mutationShardCli(async () => {
        throw new Error('kaboom')
      }),
      {argv: [], env},
    )
    expect(outcome).toEqual({exitCode: 1, stdout: '', stderr: 'kaboom\n'})
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, the shard does not run',
    async argv => {
      const run = vi.fn(async (): Promise<ShardResult> => ({kind: 'written', manifest: manifest('applicable')}))
      const outcome = await runCli(mutationShardCli(run), {argv, env: {}})
      expect(outcome.exitCode).toBe(1)
      expect(outcome.stdout).toBe('')
      expect(outcome.stderr).toContain('Usage')
      expect(run).not.toHaveBeenCalled()
    },
  )
})

describe('main, with the real shard and an empty environment', () => {
  it('is a usage error and starts nothing', async () => {
    for (const name of ['MUTATION_SHARD', 'MUTATION_SHARD_EVENT_SHA', 'MUTATION_SHARD_OUTPUT_DIR']) {
      vi.stubEnv(name, undefined)
    }
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/mutation-shard.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(stdout.mock.calls).toEqual([])
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain(
      'mutation-shard: MUTATION_SHARD must be a positive integer (got unset)',
    )
    expect(mockSpawnSync).not.toHaveBeenCalled()
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })
})

describe('scripts/mutation-shard.ts, spawned', () => {
  // The shim ends in `import.meta.main`. A comparison of `import.meta.url` with `file://${process.argv[1]}` is false for
  // a path with a space, and the shim would exit 0 without running. The copy sits in a directory with a space, linked to
  // the real packages. It runs with no shard environment, so it stops on the usage error and never reaches Stryker.
  it('runs from a directory with a space in its name, and exits on the usage error', async () => {
    const repositoryRoot = findRepositoryRoot()
    const checkout = join(root, 'with space')
    mkdirSync(join(checkout, 'scripts'), {recursive: true})
    mkdirSync(join(checkout, 'node_modules', '@fro-bot'), {recursive: true})
    copyFileSync(join(repositoryRoot, 'scripts', 'mutation-shard.ts'), join(checkout, 'scripts', 'mutation-shard.ts'))
    symlinkSync(join(repositoryRoot, 'packages', 'ci-checks'), join(checkout, 'node_modules', '@fro-bot', 'ci-checks'))
    symlinkSync(join(repositoryRoot, 'packages', 'core'), join(checkout, 'node_modules', '@fro-bot', 'core'))

    const result = await spawnEntrypoint({
      entrypoint: join(checkout, 'scripts', 'mutation-shard.ts'),
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd: checkout,
      env: {
        MUTATION_SHARD: undefined,
        MUTATION_SHARD_EVENT_SHA: undefined,
        MUTATION_SHARD_OUTPUT_DIR: undefined,
        GITHUB_EVENT_NAME: undefined,
      },
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('mutation-shard: MUTATION_SHARD must be a positive integer (got unset)')
    expect(existsSync(join(checkout, 'reports'))).toBe(false)
  })

  it('does nothing when imported rather than run', async () => {
    const repositoryRoot = findRepositoryRoot()
    const harness = join(root, 'import-shim.ts')
    const shim = JSON.stringify(join(repositoryRoot, 'scripts', 'mutation-shard.ts'))
    writeFileSync(
      harness,
      `import {pathToFileURL} from 'node:url'
await import(pathToFileURL(${shim}).href)
process.stdout.write('imported:' + String(process.exitCode ?? 'unset'))
`,
    )
    const result = await spawnEntrypoint({
      entrypoint: harness,
      runtimeArgs: ['--no-install', '--no-env-file'],
      cwd: root,
      env: {MUTATION_SHARD: undefined},
    })
    expect(result).toEqual({exitCode: 0, stdout: 'imported:unset', stderr: '', githubOutput: ''})
  })
})
