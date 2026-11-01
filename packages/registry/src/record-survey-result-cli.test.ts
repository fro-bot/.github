import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, recordSurveyResultCli} from './record-survey-result-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun:
    vi.fn<
      (
        env: Record<string, string | undefined>,
        io: {stdout: (text: string) => void; stderr: (text: string) => void},
      ) => Promise<number>
    >(),
}))

vi.mock('./record-survey-result.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./record-survey-result.ts')>()
  return {...real, runRecordSurveyResult: mockRun}
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
    const config = recordSurveyResultCli()
    expect(config.name).toBe('record-survey-result')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(recordSurveyResultCli()).not.toBe(recordSurveyResultCli())
  })
})

describe('no argv (the workflow call)', () => {
  it('runs the body with the env of the run and passes its output and exit code through', async () => {
    const env = {FIXTURE: 'value'}
    mockRun.mockImplementation(async (_env, io) => {
      io.stdout('out\n')
      io.stderr('err\n')
      return 1
    })
    const result = await runCli(recordSurveyResultCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 1, stdout: 'out\n', stderr: 'err\n'})
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockRun.mock.calls[0]?.[0]).toBe(env)
  })

  it('returns a clean run as exit 0', async () => {
    mockRun.mockResolvedValue(0)
    const result = await runCli(recordSurveyResultCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('prints a thrown error as its message and exits 1', async () => {
    mockRun.mockRejectedValue(new Error('record-survey-result: boom'))
    const result = await runCli(recordSurveyResultCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'record-survey-result: boom\n'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])('%s is a usage error and runs nothing', async arg => {
    const result = await runCli(recordSurveyResultCli(), {argv: [arg], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(mockRun).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    mockRun.mockResolvedValue(1)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/record-survey-result.ts']
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
