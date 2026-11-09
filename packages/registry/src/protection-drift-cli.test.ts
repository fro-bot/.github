import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, protectionDriftCli} from './protection-drift-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun: vi.fn<(params: {env: Record<string, string | undefined>}) => Promise<number>>(),
}))

vi.mock('./protection-drift.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./protection-drift.ts')>()
  return {...real, runProtectionDrift: mockRun}
})

beforeEach(() => {
  mockRun.mockReset()
})

afterEach(() => {
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one root command that can write, with no options', () => {
    const config = protectionDriftCli()
    expect(config.name).toBe('protection-drift')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(protectionDriftCli()).not.toBe(protectionDriftCli())
  })
})

describe('no argv (the workflow call)', () => {
  it('runs the body with the env of the run and the real seams, and passes the exit code through', async () => {
    mockRun.mockResolvedValue(1)
    const env = {GITHUB_TOKEN: 'x', GITHUB_EVENT_PATH: '/e'}
    const result = await runCli(protectionDriftCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: ''})
    const params = mockRun.mock.calls[0]?.[0] as unknown as {
      env: unknown
      now: () => Date
      readFile: (path: string) => string
    }
    expect(params.env).toEqual(env)
    expect(Math.abs(params.now().getTime() - Date.now())).toBeLessThan(1000)
    expect(params.readFile('common-settings.yaml')).toContain('required_status_checks')
    expect(params.readFile('.github/settings.yml')).toContain('required_status_checks')
  })

  it('routes the body output to the runner sinks', async () => {
    mockRun.mockImplementation(async (params: unknown) => {
      const sinks = params as {stdout: (text: string) => void; stderr: (text: string) => void}
      sinks.stdout('out\n')
      sinks.stderr('err\n')
      return 0
    })
    expect(await runCli(protectionDriftCli(), {argv: [], env: {}})).toEqual({
      exitCode: 0,
      stdout: 'out\n',
      stderr: 'err\n',
    })
  })

  it('prints a thrown error as its message and exits 1', async () => {
    mockRun.mockRejectedValue(new Error('protection-drift: boom'))
    const result = await runCli(protectionDriftCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'protection-drift: boom\n'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])('%s is a usage error and runs nothing', async arg => {
    const result = await runCli(protectionDriftCli(), {argv: [arg], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(mockRun).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    mockRun.mockResolvedValue(1)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/protection-drift.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
})
