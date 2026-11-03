import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {draftedSolutionsPublishCli, main} from './drafted-solutions-publish-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drafted-solutions-publish-cli-'))
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
  it('is one writing root command that takes no argument and no option', () => {
    const config = draftedSolutionsPublishCli()
    expect(config.name).toBe('drafted-solutions-publish')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(draftedSolutionsPublishCli()).not.toBe(draftedSolutionsPublishCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(draftedSolutionsPublishCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(result.stderr).not.toContain('::error::')
    },
  )
})

describe('a run', () => {
  it.each([
    [{}, 'GITHUB_REPOSITORY is required'],
    [{GITHUB_REPOSITORY: 'only-one'}, 'GITHUB_REPOSITORY must be "owner/repo"'],
    [{GITHUB_REPOSITORY: 'a/b'}, 'GITHUB_TOKEN is required'],
    [{GITHUB_REPOSITORY: 'a/b', GITHUB_TOKEN: 't'}, 'DRAFTED_SOLUTIONS_DIGEST_PATH is required'],
    [
      {GITHUB_REPOSITORY: 'a/b', GITHUB_TOKEN: 't', DRAFTED_SOLUTIONS_DIGEST_PATH: 'd'},
      'DRAFTED_SOLUTIONS_HANDOFF_DIR is required',
    ],
    [
      {
        GITHUB_REPOSITORY: 'a/b',
        GITHUB_TOKEN: 't',
        DRAFTED_SOLUTIONS_DIGEST_PATH: 'd',
        DRAFTED_SOLUTIONS_HANDOFF_DIR: 'h',
      },
      'DRAFTED_SOLUTIONS_ROWS_PATH is required',
    ],
  ])('%j exits 1 with the ::error:: line runCli prints', async (env, message) => {
    const result = await runCli(draftedSolutionsPublishCli(), {argv: [], env})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`::error::drafted-solutions-publish: ${message}\n`)
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/drafted-solutions-publish.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      '::error::drafted-solutions-publish: GITHUB_REPOSITORY is required\n',
    )
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
