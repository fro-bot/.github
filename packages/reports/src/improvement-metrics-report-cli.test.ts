import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {improvementMetricsReportCli, main} from './improvement-metrics-report-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'improvement-metrics-report-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one root command that takes no argument and no option, and is not read-only because it writes an issue', () => {
    const config = improvementMetricsReportCli()
    expect(config.name).toBe('improvement-metrics-report')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(improvementMetricsReportCli()).not.toBe(improvementMetricsReportCli())
  })
})

describe('argv that no caller sends', () => {
  const resultPath = () => join(root, 'usage-result.json')
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, no result file',
    async argv => {
      const result = await runCli(improvementMetricsReportCli(), {
        argv,
        env: {IMPROVEMENT_METRICS_RESULT_PATH: resultPath()},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(existsSync(resultPath())).toBe(false)
    },
  )
})

describe('a run', () => {
  it('without a digest path reports the read failure on stdout and in the result file, and exits 0', async () => {
    const resultPath = join(root, 'result.json')
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(improvementMetricsReportCli(), {
      argv: [],
      env: {IMPROVEMENT_METRICS_RESULT_PATH: resultPath},
    })
    expect(result.exitCode).toBe(0)
    const summary = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(summary)).toEqual(['outcome', 'tokenLoadFailure', 'digestReadFailure'])
    expect(summary.outcome).toBeNull()
    // The token load reads metadata/repos.yaml of the working directory; either way no issue is written.
    expect(summary.digestReadFailure === true || summary.tokenLoadFailure === true).toBe(true)
    expect(readFileSync(resultPath, 'utf8')).toBe(result.stdout)
  })

  it('exits 1 with the message on stderr when the run throws', async () => {
    const env = new Proxy(
      {},
      {
        get: () => {
          throw new Error('env is unreadable')
        },
      },
    )
    const result = await runCli(improvementMetricsReportCli(), {argv: [], env})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('env is unreadable\n')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('IMPROVEMENT_METRICS_DIGEST_PATH', '')
    vi.stubEnv('IMPROVEMENT_METRICS_RESULT_PATH', join(root, 'main-result.json'))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/improvement-metrics-report.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toMatch(/^\{"outcome":null,/u)
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
