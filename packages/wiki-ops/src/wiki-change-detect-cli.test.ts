import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, wikiChangeDetectCli} from './wiki-change-detect-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one read-only root command with an optional mode positional and no option', () => {
    const config = wikiChangeDetectCli()
    expect(config.name).toBe('wiki-change-detect')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([{name: 'mode', kind: 'optional'}])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(wikiChangeDetectCli()).not.toBe(wikiChangeDetectCli())
  })
})

describe('a mode that is not baseline or detect (survey-repo.yaml sends only those two)', () => {
  it.each([
    [['frobnicate'], 'frobnicate'],
    [[], '<none>'],
    [['BASELINE'], 'BASELINE'],
  ])('%j prints the workflow error naming the mode and exits 1, before reading GITHUB_OUTPUT', async (argv, shown) => {
    const result = await runCli(wikiChangeDetectCli(), {argv, env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`::error::wiki-change-detect: mode must be "baseline" or "detect" (got ${shown})\n`)
  })
})

describe('a valid mode with its inputs missing', () => {
  it('baseline without GITHUB_OUTPUT throws its own message', async () => {
    const result = await runCli(wikiChangeDetectCli(), {argv: ['baseline'], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('::error::wiki-change-detect: GITHUB_OUTPUT is required\n')
  })

  it('an empty GITHUB_OUTPUT counts as unset', async () => {
    const result = await runCli(wikiChangeDetectCli(), {argv: ['detect'], env: {GITHUB_OUTPUT: ''}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('::error::wiki-change-detect: GITHUB_OUTPUT is required\n')
  })

  it('detect checks GITHUB_OUTPUT before the baseline hash', async () => {
    const result = await runCli(wikiChangeDetectCli(), {argv: ['detect'], env: {WIKI_CHANGE_BASELINE_HASH: 'x'}})
    expect(result.stderr).toBe('::error::wiki-change-detect: GITHUB_OUTPUT is required\n')
  })

  it('detect without a baseline hash says so', async () => {
    const result = await runCli(wikiChangeDetectCli(), {argv: ['detect'], env: {GITHUB_OUTPUT: '/dev/null'}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('::error::wiki-change-detect: WIKI_CHANGE_BASELINE_HASH is required\n')
  })

  it.each(['not-a-hash', 'ABCDEF'.repeat(11).slice(0, 64), 'a'.repeat(63), 'a'.repeat(65)])(
    'detect refuses the malformed baseline hash %j',
    async hash => {
      const result = await runCli(wikiChangeDetectCli(), {
        argv: ['detect'],
        env: {GITHUB_OUTPUT: '/dev/null', WIKI_CHANGE_BASELINE_HASH: hash},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe(
        `::error::wiki-change-detect: WIKI_CHANGE_BASELINE_HASH must be a 64-character lowercase hex sha256 digest, got: ${hash}\n`,
      )
    },
  )
})

describe('argv that no caller sends', () => {
  it.each([
    [['--help']],
    [['--help=false']],
    [['-h']],
    [['--bogus']],
    [['baseline', 'extra']],
    [['baseline', '--bogus']],
    [['x', '--y']],
  ])('%j is a usage error: exit 1, usage on stderr, nothing runs', async argv => {
    const result = await runCli(wikiChangeDetectCli(), {argv, env: {GITHUB_OUTPUT: '/dev/null'}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(result.stderr).not.toContain('::error::wiki-change-detect:')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('GITHUB_OUTPUT', '')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/wiki-change-detect.ts', 'baseline']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe('::error::wiki-change-detect: GITHUB_OUTPUT is required\n')
    expect(exit).not.toHaveBeenCalled()
  })
})
