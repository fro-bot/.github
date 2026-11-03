import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {draftedSolutionsHarvestCli, main} from './drafted-solutions-harvest-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drafted-solutions-harvest-cli-'))
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
  it('is one read-only root command that takes no argument and no option', () => {
    const config = draftedSolutionsHarvestCli()
    expect(config.name).toBe('drafted-solutions-harvest')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(draftedSolutionsHarvestCli()).not.toBe(draftedSolutionsHarvestCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(draftedSolutionsHarvestCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      // A run would have failed on its first missing variable; a usage error never gets that far.
      expect(result.stderr).not.toContain('::error::')
    },
  )
})

describe('a run', () => {
  it.each([
    [{}, 'DRAFTED_SOLUTIONS_DIGEST_PATH is required'],
    [{DRAFTED_SOLUTIONS_DIGEST_PATH: 'd'}, 'GITHUB_REPOSITORY is required'],
    [{DRAFTED_SOLUTIONS_DIGEST_PATH: 'd', GITHUB_REPOSITORY: ''}, 'GITHUB_REPOSITORY is required'],
    [{DRAFTED_SOLUTIONS_DIGEST_PATH: 'd', GITHUB_REPOSITORY: 'only-one'}, 'GITHUB_REPOSITORY must be "owner/repo"'],
    [{DRAFTED_SOLUTIONS_DIGEST_PATH: 'd', GITHUB_REPOSITORY: 'a/b/c'}, 'GITHUB_REPOSITORY must be "owner/repo"'],
    [{DRAFTED_SOLUTIONS_DIGEST_PATH: 'd', GITHUB_REPOSITORY: '/b'}, 'GITHUB_REPOSITORY must be "owner/repo"'],
    [{DRAFTED_SOLUTIONS_DIGEST_PATH: 'd', GITHUB_REPOSITORY: 'a/b'}, 'GITHUB_TOKEN is required'],
  ])(
    '%j fails closed with the ::error:: line the job log shows, exit 1 and nothing on stdout',
    async (env, message) => {
      const result = await runCli(draftedSolutionsHarvestCli(), {argv: [], env})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(`::error::drafted-solutions-harvest: ${message}\n`)
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('DRAFTED_SOLUTIONS_DIGEST_PATH', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/drafted-solutions-harvest.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      '::error::drafted-solutions-harvest: DRAFTED_SOLUTIONS_DIGEST_PATH is required\n',
    )
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
