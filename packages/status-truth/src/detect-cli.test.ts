import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, runDetect, statusTruthDetectCli} from './detect-cli.ts'

let written: string[] = []

beforeEach(() => {
  written = []
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

function io() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    sinks: {stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text)},
  }
}

describe('the config', () => {
  it('is one read-only root command that takes no argument and no option', () => {
    const config = statusTruthDetectCli()
    expect(config.name).toBe('status-truth-detect')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(statusTruthDetectCli()).not.toBe(statusTruthDetectCli())
  })
})

describe('the preconditions (status-truth.yaml:124 reads the exit code and the artifact step runs if: always())', () => {
  it.each([[undefined], ['']])('STATUS_TRUTH_REPORT_PATH=%j is an error with no output', async value => {
    const run = io()
    await expect(runDetect({STATUS_TRUTH_REPORT_PATH: value}, run.sinks)).rejects.toThrow(
      new Error('status-truth-detect: STATUS_TRUTH_REPORT_PATH is required'),
    )
    expect(run.stdout).toEqual([])
    expect(run.stderr).toEqual([])
  })

  it.each([['nowhere'], ['/repo'], ['owner/']])('GITHUB_REPOSITORY=%j is an error with no output', async value => {
    const run = io()
    await expect(
      runDetect({STATUS_TRUTH_REPORT_PATH: '/tmp/never-written.json', GITHUB_REPOSITORY: value}, run.sinks),
    ).rejects.toThrow(new Error('status-truth-detect: GITHUB_REPOSITORY must be in owner/repo format'))
    expect(run.stdout).toEqual([])
  })

  it('reads the env the runner supplies, never process.env', async () => {
    vi.stubEnv('STATUS_TRUTH_REPORT_PATH', '/tmp/from-process-env.json')
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo')
    const run = io()
    await expect(runDetect({}, run.sinks)).rejects.toThrow('STATUS_TRUTH_REPORT_PATH is required')
    await expect(runDetect({STATUS_TRUTH_REPORT_PATH: '/tmp/x', GITHUB_REPOSITORY: 'bad'}, run.sinks)).rejects.toThrow(
      'GITHUB_REPOSITORY must be in owner/repo format',
    )
  })

  it('a message-only error reaches stderr through the runner with exit 1 and no stack', async () => {
    const result = await runCli(statusTruthDetectCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'status-truth-detect: STATUS_TRUTH_REPORT_PATH is required\n',
    })
    expect(written).toEqual([])
  })
})

describe('an unwritable report', () => {
  it('prints the write-failure line, exits 1 and prints no summary', async () => {
    const result = await runCli(statusTruthDetectCli(), {
      argv: [],
      env: {STATUS_TRUTH_REPORT_PATH: '/nonexistent-directory/for/status-truth/report.json', GITHUB_REPOSITORY: 'o/r'},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('status-truth-detect: could not write report: error-class=write-failure\n')
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the scan ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(statusTruthDetectCli(), {
        argv,
        env: {STATUS_TRUTH_REPORT_PATH: '/nonexistent-directory/for/status-truth/report.json'},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(result.stderr).not.toContain('could not write report')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('STATUS_TRUTH_REPORT_PATH', '')
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/status-truth-detect.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(written.join('')).toBe('status-truth-detect: STATUS_TRUTH_REPORT_PATH is required\n')
    expect(exit).not.toHaveBeenCalled()
  })
})
