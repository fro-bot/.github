import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, wikiRepairCli} from './wiki-repair-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one writing root command that takes no argument and no option', () => {
    const config = wikiRepairCli()
    expect(config.name).toBe('wiki-repair')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(wikiRepairCli()).not.toBe(wikiRepairCli())
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(wikiRepairCli(), {argv, env: {WIKI_REPAIR_DRY_RUN: 'true'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('a run that cannot start', () => {
  it('records an abort, prints the result, fails the job and still names the cause on stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(wikiRepairCli(), {argv: [], env: {WIKI_REPAIR_DRY_RUN: 'true'}})
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      repairable_seen: 0,
      repaired: 0,
      aborted: 1,
      out_of_scope: 0,
      privacy_blocked: 0,
      path_refused: 0,
      conflict_retries: 0,
      noop: 0,
      dry_run: true,
    })
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      '::error::wiki-repair aborted: wiki-repair: WIKI_REPAIR_DATA_TIP_SHA is required in the environment\n',
    )
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code from the repair, without exiting the process', async () => {
    vi.stubEnv('WIKI_REPAIR_DATA_TIP_SHA', '')
    vi.stubEnv('WIKI_REPAIR_RESULT_PATH', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/wiki-repair.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({aborted: 1})
    expect(exit).not.toHaveBeenCalled()
  })
})
