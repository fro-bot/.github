import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, statusTruthPrsCli} from './prs-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one writing root command that takes no argument and no option', () => {
    const config = statusTruthPrsCli()
    expect(config.name).toBe('status-truth-prs')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(statusTruthPrsCli()).not.toBe(statusTruthPrsCli())
  })
})

describe('a disarmed run (status-truth.yaml:431 with the dispatch input false)', () => {
  it('prints the counts-only result on stdout, exits 0 and reads no report', async () => {
    const result = await runCli(statusTruthPrsCli(), {
      argv: [],
      env: {STATUS_TRUTH_DRY_RUN: 'true', STATUS_TRUTH_PRS_DISPATCH_INPUT: 'false'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({armed: false, dryRun: true})
    expect(result.stdout.endsWith('\n')).toBe(true)
  })

  it('reads the env the runner supplies, never process.env', async () => {
    vi.stubEnv('STATUS_TRUTH_DRY_RUN', 'true')
    const result = await runCli(statusTruthPrsCli(), {argv: [], env: {}})
    expect(JSON.parse(result.stdout)).toMatchObject({armed: false, dryRun: false})
  })
})

describe('an armed run that fails early', () => {
  it('returns the exit code that the step set, with the closed-vocabulary error in the result', async () => {
    const result = await runCli(statusTruthPrsCli(), {
      argv: [],
      env: {STATUS_TRUTH_PRS_ENABLED: 'true', STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true', STATUS_TRUTH_DRY_RUN: 'true'},
    })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({armed: true, dryRun: true, error: 'missing-report'})
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran, writing when it was armed and not a dry run.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(statusTruthPrsCli(), {
        argv,
        env: {STATUS_TRUTH_PRS_ENABLED: 'true', STATUS_TRUTH_PRS_DISPATCH_INPUT: 'true'},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('STATUS_TRUTH_PRS_ENABLED', 'true')
    vi.stubEnv('STATUS_TRUTH_PRS_DISPATCH_INPUT', 'true')
    vi.stubEnv('STATUS_TRUTH_REPORT_PATH', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/status-truth-prs.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stdout.mock.calls[0]?.[0])).toContain('"error":"missing-report"')
    expect(exit).not.toHaveBeenCalled()
  })
})
