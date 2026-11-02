import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, runOpen, statusTruthProposalsCli} from './proposals-cli.ts'

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
  it('is one writing root command that takes no argument and no option', () => {
    const config = statusTruthProposalsCli()
    expect(config.name).toBe('status-truth-proposals')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(statusTruthProposalsCli()).not.toBe(statusTruthProposalsCli())
  })
})

describe('the preconditions (status-truth.yaml:249: a failed step, with the summary step running if: always())', () => {
  it.each([[undefined], ['']])('STATUS_TRUTH_REPORT_PATH=%j is an error before anything is read', async value => {
    const run = io()
    await expect(runOpen({STATUS_TRUTH_REPORT_PATH: value, STATUS_TRUTH_DRY_RUN: 'true'}, run.sinks)).rejects.toThrow(
      new Error('status-truth-proposals: STATUS_TRUTH_REPORT_PATH is required'),
    )
    expect(run.stdout).toEqual([])
    expect(run.stderr).toEqual([])
  })

  it('an unreadable report is a read failure', async () => {
    const run = io()
    await expect(
      runOpen({STATUS_TRUTH_REPORT_PATH: '/nonexistent-directory/for/status-truth/r.json'}, run.sinks),
    ).rejects.toThrow(new Error('status-truth-proposals: could not read report artifact: error-class=read-failure'))
    expect(run.stdout).toEqual([])
  })

  it('reads the env the runner supplies, never process.env', async () => {
    vi.stubEnv('STATUS_TRUTH_REPORT_PATH', '/tmp/from-process-env.json')
    const run = io()
    await expect(runOpen({}, run.sinks)).rejects.toThrow('STATUS_TRUTH_REPORT_PATH is required')
  })

  it('a message-only error reaches stderr through the runner with exit 1 and no stack', async () => {
    const result = await runCli(statusTruthProposalsCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'status-truth-proposals: STATUS_TRUTH_REPORT_PATH is required\n',
    })
    expect(written).toEqual([])
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran, writing when STATUS_TRUTH_DRY_RUN was not 'true'.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(statusTruthProposalsCli(), {
        argv,
        env: {STATUS_TRUTH_REPORT_PATH: '/nonexistent-directory/for/status-truth/r.json'},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(result.stderr).not.toContain('could not read report artifact')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('STATUS_TRUTH_REPORT_PATH', '')
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/status-truth-proposals.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(written.join('')).toBe('status-truth-proposals: STATUS_TRUTH_REPORT_PATH is required\n')
    expect(exit).not.toHaveBeenCalled()
  })
})
