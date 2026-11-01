import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, mergeBackDataCli} from './merge-back-data-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun: vi.fn<(env: Record<string, string | undefined>) => Promise<number>>(),
}))

vi.mock('./merge-back-data.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./merge-back-data.ts')>()
  return {...real, runCli: mockRun}
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
    const config = mergeBackDataCli()
    expect(config.name).toBe('merge-back-data')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(mergeBackDataCli()).not.toBe(mergeBackDataCli())
  })
})

describe('no argv (the workflow call)', () => {
  it('runs the body with the env of the run and passes its output and exit code through', async () => {
    const env = {FIXTURE: 'value'}
    mockRun.mockResolvedValue(1)
    const result = await runCli(mergeBackDataCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: ''})
    expect(mockRun).toHaveBeenCalledExactlyOnceWith(env)
  })

  it('returns a clean run as exit 0', async () => {
    const result = await runCli(mergeBackDataCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('prints a thrown error as its message and exits 1', async () => {
    mockRun.mockRejectedValue(new Error('merge-back-data: boom'))
    const result = await runCli(mergeBackDataCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'merge-back-data: boom\n'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])('%s is a usage error and runs nothing', async arg => {
    const result = await runCli(mergeBackDataCli(), {argv: [arg], env: {}})
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
    process.argv = [argv[0] ?? 'node', '/x/merge-back-data.ts']
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
