import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, wikiLintIssuesCli} from './wiki-lint-issues-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one writing root command that takes one optional report path and no option', () => {
    const config = wikiLintIssuesCli()
    expect(config.name).toBe('wiki-lint-issues')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([{name: 'jsonPath', kind: 'optional'}])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(wikiLintIssuesCli()).not.toBe(wikiLintIssuesCli())
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['a.json', 'b.json']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(wikiLintIssuesCli(), {argv, env: {GITHUB_TOKEN: 'tok'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('a run with its input missing', () => {
  it('reports the missing report path as the step always has, and exits 1', async () => {
    const result = await runCli(wikiLintIssuesCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('wiki-lint-issues: WIKI_LINT_JSON_PATH or first argument is required\n')
  })

  it('reads the report path from the positional when the variable is unset', async () => {
    const result = await runCli(wikiLintIssuesCli(), {argv: ['/nonexistent/report.json'], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('wiki-lint-issues: failed to read /nonexistent/report.json: Error: ENOENT')
  })

  it('reports a file that is not a lint report as an invalid shape, not as an unhandled error', async () => {
    const result = await runCli(wikiLintIssuesCli(), {
      argv: [],
      env: {WIKI_LINT_JSON_PATH: new URL('../../../package.json', import.meta.url).pathname},
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('wiki-lint-issues: invalid report shape: schema_version is not a number\n')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('WIKI_LINT_JSON_PATH', '')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/wiki-lint-issues.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      'wiki-lint-issues: WIKI_LINT_JSON_PATH or first argument is required\n',
    )
    expect(exit).not.toHaveBeenCalled()
  })
})
