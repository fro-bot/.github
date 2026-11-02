import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, solutionsQueryCli} from './solutions-query-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one read-only root command that takes no argument and no option', () => {
    const config = solutionsQueryCli()
    expect(config.name).toBe('solutions-query')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(solutionsQueryCli()).not.toBe(solutionsQueryCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(solutionsQueryCli(), {argv, env: {GITHUB_OUTPUT: '/nonexistent/out'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv, prints one JSON line and sets the exit code without exiting the process', async () => {
    vi.stubEnv('GITHUB_OUTPUT', '')
    vi.stubEnv('SOLUTIONS_QUERY_EVENT_NAME', 'schedule')
    vi.stubEnv('SOLUTIONS_QUERY_OWNER', '')
    vi.stubEnv('SOLUTIONS_QUERY_REPO', '')
    vi.stubEnv('SOLUTIONS_QUERY_TITLE', 'zzzz-no-such-token-qqqq')
    vi.stubEnv('SOLUTIONS_QUERY_BODY', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/solutions-query.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('unexpected error'))
    expect(String(stdout.mock.calls[0]?.[0])).toBe('{"excerpt":"","selectedPaths":[],"byteLength":0}\n')
    expect(exit).not.toHaveBeenCalled()
  })
})
