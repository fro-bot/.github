import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, rolloutTrackerSnapshotCli} from './rollout-tracker-snapshot-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun:
    vi.fn<
      (
        env: Record<string, string | undefined>,
        io: {stdout: (text: string) => void; stderr: (text: string) => void},
      ) => Promise<number>
    >(),
}))

vi.mock('./rollout-tracker-snapshot.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./rollout-tracker-snapshot.ts')>()
  return {...real, runRolloutTrackerSnapshot: mockRun}
})

beforeEach(() => {
  mockRun.mockReset().mockImplementation(async (_env, io) => {
    io.stdout('{"should_comment":false}\n')
    return 0
  })
})

afterEach(() => {
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one read-only root command that takes no argument', () => {
    const config = rolloutTrackerSnapshotCli()
    expect(config.name).toBe('rollout-tracker-snapshot')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(rolloutTrackerSnapshotCli()).not.toBe(rolloutTrackerSnapshotCli())
  })
})

describe('no argv (gateway-rollout-tracker.yaml and status-truth.yaml)', () => {
  it('runs with the env of the run and prints the result on stdout', async () => {
    const env = {ROLLOUT_TRACKER_ISSUE: 'a/b#1'}
    const result = await runCli(rolloutTrackerSnapshotCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 0, stdout: '{"should_comment":false}\n', stderr: ''})
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockRun.mock.calls[0]?.[0]).toBe(env)
  })

  it('returns the exit code of the run and its stderr', async () => {
    mockRun.mockImplementation(async (_env, io) => {
      io.stderr('rollout-tracker-snapshot: FATAL — failed to read external signals: boom\n')
      return 1
    })
    const result = await runCli(rolloutTrackerSnapshotCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'rollout-tracker-snapshot: FATAL — failed to read external signals: boom\n',
    })
  })

  it('prints a thrown error as its message and exits 1, with no stack', async () => {
    mockRun.mockRejectedValue(new Error('unexpected shape'))
    const result = await runCli(rolloutTrackerSnapshotCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'unexpected shape\n'})
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the snapshot was read.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']], [['-h']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(rolloutTrackerSnapshotCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(mockRun).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('writes the result to stdout and sets the exit code without exiting the process', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/rollout-tracker-snapshot.ts']
    mockRun.mockImplementation(async (_env, io) => {
      io.stdout('{"a":1}\n')
      return 3
    })
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(stdout).toHaveBeenCalledWith('{"a":1}\n')
    expect(process.exitCode).toBe(3)
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    exit.mockRestore()
  })
})
