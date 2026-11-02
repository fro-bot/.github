import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {crossRepoDispatchCli, main, runDispatchCli} from './dispatch-cli.ts'

const MODE_ERROR = 'cross-repo-dispatch: expected argv[2] to be "dispatch" or "track"\n'

let written: string[] = []

beforeEach(() => {
  written = []
  vi.stubEnv('GITHUB_EVENT_PATH', '')
  vi.stubEnv('GITHUB_REPOSITORY', 'not-a-repository')
  vi.stubEnv('GITHUB_TOKEN', 'token')
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    written.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one writing root command that takes an optional mode', () => {
    const config = crossRepoDispatchCli()
    expect(config.name).toBe('cross-repo-dispatch')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([{name: 'mode', kind: 'optional'}])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(crossRepoDispatchCli()).not.toBe(crossRepoDispatchCli())
  })
})

describe('the mode', () => {
  it.each([[[]], [['bogus']], [['Dispatch']], [['TRACK']], [['dispatch ']], [['']]])(
    '%j keeps the expected-mode error on stderr and exits 1',
    async argv => {
      const result = await runCli(crossRepoDispatchCli(), {argv, env: {}})
      expect(result).toEqual({exitCode: 1, stdout: '', stderr: MODE_ERROR})
      expect(written).toEqual([])
    },
  )

  it('`dispatch` without an event path writes its message and exits 1, through the return value', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['dispatch'], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(written.join('')).toBe('cross-repo-dispatch: GITHUB_EVENT_PATH is required for dispatch mode\n')
    expect(process.exitCode).toBeUndefined()
  })

  it('`track` reports a malformed repository as its message and exits 1', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['track'], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'cross-repo-dispatch: GITHUB_REPOSITORY must be in owner/repo format\n',
    })
  })
})

describe('runDispatchCli', () => {
  it('returns 1 without setting the process exit code when the event path is missing', async () => {
    await expect(runDispatchCli()).resolves.toBe(1)
    expect(process.exitCode).toBeUndefined()
  })

  it('treats an empty event path the same as an unset one', async () => {
    vi.stubEnv('GITHUB_EVENT_PATH', '')
    await expect(runDispatchCli()).resolves.toBe(1)
    vi.unstubAllEnvs()
    vi.stubEnv('GITHUB_REPOSITORY', 'not-a-repository')
    delete process.env.GITHUB_EVENT_PATH
    await expect(runDispatchCli()).resolves.toBe(1)
  })
})

describe('argv the workflow never sends', () => {
  // Before the runner, `--help` and an unknown flag reached the mode check and printed the mode error; an extra
  // positional was ignored and the run went ahead.
  it.each([
    [['--help']],
    [['--help=false']],
    [['--bogus']],
    [['dispatch', 'extra']],
    [['track', 'extra']],
    [['dispatch', '--help']],
    [['track', '--bogus']],
  ])('%j is a usage error and runs neither mode', async argv => {
    const result = await runCli(crossRepoDispatchCli(), {argv, env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(result.stderr).not.toBe(MODE_ERROR)
    expect(written).toEqual([])
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/cross-repo-dispatch.ts', 'dispatch']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(written.join('')).toContain('GITHUB_EVENT_PATH is required for dispatch mode')
  })
})
