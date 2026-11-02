import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {dispatchRenovateCli, main} from './dispatch-renovate-cli.ts'

interface Deps {
  stdout?: (text: string) => void
}

const {mockPlan, mockDispatch} = vi.hoisted(() => ({
  mockPlan: vi.fn<(env: Record<string, string | undefined>, deps?: Deps) => Promise<void>>(),
  mockDispatch: vi.fn<(env: Record<string, string | undefined>, deps?: Deps) => Promise<void>>(),
}))

vi.mock('./dispatch-renovate.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./dispatch-renovate.ts')>()
  return {...real, runRenovatePlanCli: mockPlan, runRenovateDispatchCli: mockDispatch}
})

beforeEach(() => {
  mockPlan.mockReset().mockImplementation(async (_env, deps) => {
    deps?.stdout?.('dispatch-renovate: planned 2 repositories\n')
  })
  mockDispatch.mockReset().mockImplementation(async (_env, deps) => {
    deps?.stdout?.('{"eligible":2}\n')
  })
})

afterEach(() => {
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares a read-only `plan` command and a writing root command', () => {
    const config = dispatchRenovateCli()
    expect(config.name).toBe('dispatch-renovate')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands.map(command => [command.name, command.readOnly])).toEqual([
      ['plan', true],
      ['', false],
    ])
    for (const command of config.commands) {
      expect(command.options).toEqual({})
      expect(command.positionals).toEqual([])
    }
  })

  it('builds a fresh object on every call', () => {
    expect(dispatchRenovateCli()).not.toBe(dispatchRenovateCli())
  })
})

describe('plan (dispatch-renovate.yaml: argv `plan`)', () => {
  it('runs plan mode with the env of the run and prints its output', async () => {
    const env = {GITHUB_TOKEN: 'discovery', GITHUB_OUTPUT: '/tmp/out'}
    const result = await runCli(dispatchRenovateCli(), {argv: ['plan'], env})
    expect(result).toEqual({exitCode: 0, stdout: 'dispatch-renovate: planned 2 repositories\n', stderr: ''})
    expect(mockPlan).toHaveBeenCalledTimes(1)
    expect(mockPlan.mock.calls[0]?.[0]).toBe(env)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('prints a thrown error as its message and exits 1', async () => {
    mockPlan.mockRejectedValue(new Error('GITHUB_OUTPUT is required in plan mode'))
    const result = await runCli(dispatchRenovateCli(), {argv: ['plan'], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'GITHUB_OUTPUT is required in plan mode\n'})
  })
})

describe('dispatch (dispatch-renovate.yaml: no argv)', () => {
  it('runs dispatch mode with the env of the run and prints its output', async () => {
    const env = {GITHUB_TOKEN: 'dispatch', DISPATCH_REPOSITORIES: 'agent,.github'}
    const result = await runCli(dispatchRenovateCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 0, stdout: '{"eligible":2}\n', stderr: ''})
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch.mock.calls[0]?.[0]).toBe(env)
    expect(mockPlan).not.toHaveBeenCalled()
  })

  it('prints a thrown error as its message and exits 1', async () => {
    mockDispatch.mockRejectedValue(new Error('DISPATCH_REPOSITORIES is required and must name at least one repository'))
    const result = await runCli(dispatchRenovateCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'DISPATCH_REPOSITORIES is required and must name at least one repository\n',
    })
  })
})

describe('argv that is neither `plan` nor empty', () => {
  // Before the runner, anything but the exact `plan` ran dispatch mode, so a typo such as `pln` dispatched.
  it.each([
    [['pln']],
    [['Plan']],
    [['PLAN']],
    [['plan ']],
    [['dispatch']],
    [['other', 'plan']],
    [['--help']],
    [['--help=false']],
    [['--bogus']],
    [['plan', 'extra']],
    [['plan', '--help']],
    [['plan', '--bogus']],
    [['x']],
  ])('%j is a usage error: exit 1, usage on stderr, nothing runs', async argv => {
    const result = await runCli(dispatchRenovateCli(), {
      argv,
      env: {GITHUB_TOKEN: 'tok', DISPATCH_REPOSITORIES: 'agent'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(mockPlan).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    mockDispatch.mockRejectedValue(new Error('failed'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/dispatch-renovate.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    stderr.mockRestore()
  })
})
