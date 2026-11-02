import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, renderCorrectionsContextCli} from './render-corrections-context-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one writing root command that takes no argument and no option', () => {
    const config = renderCorrectionsContextCli()
    expect(config.name).toBe('render-corrections-context')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(renderCorrectionsContextCli()).not.toBe(renderCorrectionsContextCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(renderCorrectionsContextCli(), {argv, env: {REPO_NODE_ID: 'R_123'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('a run with its input missing', () => {
  it('reports the missing node id and exits 1, writing nothing', async () => {
    const result = await runCli(renderCorrectionsContextCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('REPO_NODE_ID is required\n')
  })

  it('treats an empty node id as missing', async () => {
    const result = await runCli(renderCorrectionsContextCli(), {argv: [], env: {REPO_NODE_ID: ''}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('REPO_NODE_ID is required\n')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('REPO_NODE_ID', '')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/render-corrections-context.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe('REPO_NODE_ID is required\n')
    expect(exit).not.toHaveBeenCalled()
  })
})
