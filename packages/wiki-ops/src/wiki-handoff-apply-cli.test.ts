import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, wikiHandoffApplyCli} from './wiki-handoff-apply-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one writing root command that takes no argument and no option', () => {
    const config = wikiHandoffApplyCli()
    expect(config.name).toBe('wiki-handoff-apply')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(wikiHandoffApplyCli()).not.toBe(wikiHandoffApplyCli())
  })
})

describe('a run with its input missing', () => {
  it('reports the missing variable and exits 1', async () => {
    const result = await runCli(wikiHandoffApplyCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('::error::wiki-handoff-apply: WIKI_HANDOFF_DIR is required\n')
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(wikiHandoffApplyCli(), {argv, env: {WIKI_HANDOFF_DIR: '/nonexistent/handoff'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('WIKI_HANDOFF_DIR', '')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/wiki-handoff-apply.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('::error::wiki-handoff-apply: WIKI_HANDOFF_DIR is required')
    expect(exit).not.toHaveBeenCalled()
  })
})
