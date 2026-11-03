import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {capturePatternsOpenCli, main} from './capture-patterns-open-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'capture-patterns-open-cli-'))
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
    const config = capturePatternsOpenCli()
    expect(config.name).toBe('capture-patterns-open')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(capturePatternsOpenCli()).not.toBe(capturePatternsOpenCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(capturePatternsOpenCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(result.stderr).not.toContain('is required')
    },
  )
})

describe('a run', () => {
  it('throws a message-only error for the first missing input and exits 1', async () => {
    const result = await runCli(capturePatternsOpenCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('capture-patterns-open: CAPTURE_PATTERNS_DIGEST_PATH is required\n')
  })

  it('names the bodies path when only the digest path is set', async () => {
    const result = await runCli(capturePatternsOpenCli(), {argv: [], env: {CAPTURE_PATTERNS_DIGEST_PATH: 'x'}})
    expect(result.stderr).toBe('capture-patterns-open: CAPTURE_PATTERNS_BODIES_PATH is required\n')
  })

  it('treats an empty path as missing', async () => {
    const result = await runCli(capturePatternsOpenCli(), {argv: [], env: {CAPTURE_PATTERNS_DIGEST_PATH: ''}})
    expect(result.stderr).toBe('capture-patterns-open: CAPTURE_PATTERNS_DIGEST_PATH is required\n')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('CAPTURE_PATTERNS_DIGEST_PATH', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/capture-patterns-open.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe('capture-patterns-open: CAPTURE_PATTERNS_DIGEST_PATH is required\n')
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
