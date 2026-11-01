import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, resetSurveyStatusCli} from './reset-survey-status-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun:
    vi.fn<
      (
        env: Record<string, string | undefined>,
        io: {stdout: (text: string) => void; stderr: (text: string) => void},
      ) => Promise<void>
    >(),
}))

vi.mock('./reset-survey-status.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./reset-survey-status.ts')>()
  return {...real, runResetSurveyStatus: mockRun}
})

beforeEach(() => {
  mockRun.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one root command with no options', () => {
    const config = resetSurveyStatusCli()
    expect(config.name).toBe('reset-survey-status')
    expect(config.errorFormat).toBeTypeOf('function')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(resetSurveyStatusCli()).not.toBe(resetSurveyStatusCli())
  })
})

describe('no argv (the workflow call)', () => {
  it('runs the body with the env of the run and passes its output through', async () => {
    const env = {FIXTURE: 'value'}
    mockRun.mockImplementation(async (_env, io) => {
      io.stdout('out\n')
      io.stderr('err\n')
    })
    const result = await runCli(resetSurveyStatusCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 0, stdout: 'out\n', stderr: 'err\n'})
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockRun.mock.calls[0]?.[0]).toBe(env)
  })

  it('returns a clean run as exit 0', async () => {
    mockRun.mockResolvedValue(undefined)
    const result = await runCli(resetSurveyStatusCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('prints a thrown error as the script name and its message, and exits 1', async () => {
    mockRun.mockRejectedValue(new Error('TARGETS is required'))
    const result = await runCli(resetSurveyStatusCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'reset-survey-status: TARGETS is required\n'})
  })

  it('prints a thrown non-Error as the script name and its string form', async () => {
    mockRun.mockRejectedValue('plain')
    const result = await runCli(resetSurveyStatusCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'reset-survey-status: plain\n'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])('%s is a usage error and runs nothing', async arg => {
    const result = await runCli(resetSurveyStatusCli(), {argv: [arg], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(mockRun).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    mockRun.mockRejectedValue(new Error('failed'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/reset-survey-status.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(mockRun).toHaveBeenCalledTimes(1)
    stderr.mockRestore()
  })
})
