import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, promotionSelfMergeCli} from './promotion-self-merge-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun: vi.fn<(params: {env: Record<string, string | undefined>}) => Promise<number>>(),
}))

vi.mock('./promotion-self-merge.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./promotion-self-merge.ts')>()
  return {...real, runSelfMerge: mockRun}
})

beforeEach(() => {
  mockRun.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one root command that can write, with no options', () => {
    const config = promotionSelfMergeCli()
    expect(config.name).toBe('promotion-self-merge')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(promotionSelfMergeCli()).not.toBe(promotionSelfMergeCli())
  })
})

describe('no argv (the workflow call)', () => {
  it('runs the body with the env of the run and the real seams, and passes the exit code through', async () => {
    mockRun.mockResolvedValue(1)
    const env = {GH_TOKEN: 'x', PROMOTION_PR: '7'}
    const result = await runCli(promotionSelfMergeCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: ''})
    const params = mockRun.mock.calls[0]?.[0] as unknown as {
      env: unknown
      now: () => number
      sleep: (ms: number) => Promise<void>
      signal: (ms: number) => AbortSignal
      readSettings: () => string
    }
    expect(params.env).toEqual(env)
    expect(Math.abs(params.now() - Date.now())).toBeLessThan(1000)
    vi.useFakeTimers()
    let slept = false
    const sleeping = params.sleep(20).then(() => {
      slept = true
    })
    await vi.advanceTimersByTimeAsync(19)
    expect(slept).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await sleeping
    expect(slept).toBe(true)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const signal = params.signal(30)
    expect(timeout).toHaveBeenCalledExactlyOnceWith(30)
    expect(signal.aborted).toBe(false)
    vi.useRealTimers()
    expect(params.readSettings()).toContain('required_status_checks')
  })

  it('routes the body output to the runner sinks', async () => {
    mockRun.mockImplementation(async (params: unknown) => {
      const sinks = params as {stdout: (text: string) => void; stderr: (text: string) => void}
      sinks.stdout('out\n')
      sinks.stderr('err\n')
      return 0
    })
    expect(await runCli(promotionSelfMergeCli(), {argv: [], env: {}})).toEqual({
      exitCode: 0,
      stdout: 'out\n',
      stderr: 'err\n',
    })
  })

  it('prints a thrown error as its message and exits 1', async () => {
    mockRun.mockRejectedValue(new Error('promotion-self-merge: boom'))
    const result = await runCli(promotionSelfMergeCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'promotion-self-merge: boom\n'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])('%s is a usage error and runs nothing', async arg => {
    const result = await runCli(promotionSelfMergeCli(), {argv: [arg], env: {}})
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
    process.argv = [argv[0] ?? 'node', '/x/promotion-self-merge.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
})
