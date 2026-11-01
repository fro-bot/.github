import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {checkWikiPrivatePresenceCli, main} from './check-wiki-private-presence-cli.ts'

const {mockDetect} = vi.hoisted(() => ({
  mockDetect:
    vi.fn<
      (
        argv: string[],
        env: Record<string, string | undefined>,
      ) => Promise<{exitCode: number; stdout: string; stderr: string}>
    >(),
}))

vi.mock('./check-wiki-private-presence.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./check-wiki-private-presence.ts')>()
  return {...real, runCli: mockDetect}
})

beforeEach(() => {
  mockDetect.mockReset().mockResolvedValue({exitCode: 0, stdout: 'no private wiki leaks detected\n', stderr: ''})
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one read-only command with one flag', () => {
    const config = checkWikiPrivatePresenceCli()
    expect(config.name).toBe('check-wiki-private-presence')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(true)
    expect(Object.keys(command?.options ?? {})).toEqual(['operatorReport'])
    expect(command?.options.operatorReport?.flag).toBe('--operator-report')
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(checkWikiPrivatePresenceCli()).not.toBe(checkWikiPrivatePresenceCli())
  })
})

describe('no argv (merge-data.yaml)', () => {
  it('runs the detection with no argv and the env of the run, and returns its output and exit code', async () => {
    mockDetect.mockResolvedValue({exitCode: 1, stdout: 'out\n', stderr: 'err\n'})
    const env = {GRANDFATHER_WIKI_REPOS_DIR: '../knowledge/wiki/repos'}
    const result = await runCli(checkWikiPrivatePresenceCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 1, stdout: 'out\n', stderr: 'err\n'})
    expect(mockDetect).toHaveBeenCalledExactlyOnceWith([], env)
  })

  it('returns a clean run as exit 0', async () => {
    const result = await runCli(checkWikiPrivatePresenceCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: 'no private wiki leaks detected\n', stderr: ''})
  })

  it('passes the exit code of the CI refusal through', async () => {
    mockDetect.mockResolvedValue({exitCode: 2, stdout: '', stderr: 'refusing\n'})
    const result = await runCli(checkWikiPrivatePresenceCli(), {argv: ['--operator-report'], env: {}})
    expect(result).toEqual({exitCode: 2, stdout: '', stderr: 'refusing\n'})
  })

  it('exits 1 with the error as the message when the detection throws', async () => {
    mockDetect.mockRejectedValue(new Error('GRANDFATHER_WIKI_REPOS_DIR env var is required'))
    const result = await runCli(checkWikiPrivatePresenceCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'GRANDFATHER_WIKI_REPOS_DIR env var is required\n'})
  })
})

describe('--operator-report', () => {
  it('hands the flag to the detection', async () => {
    await runCli(checkWikiPrivatePresenceCli(), {argv: ['--operator-report'], env: {X: '1'}})
    expect(mockDetect).toHaveBeenCalledExactlyOnceWith(['--operator-report'], {X: '1'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([[['--help']], [['--bogus']], [['stray']], [['--operator-report', 'stray']], [['--']]])(
    '%j is a usage error that runs no detection',
    async argv => {
      const result = await runCli(checkWikiPrivatePresenceCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('check-wiki-private-presence')
      expect(result.stderr).toContain('--operator-report')
      expect(mockDetect).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI on the process argv and env, writes the output and sets the exit code', async () => {
    const originalArgv = process.argv
    vi.stubEnv('GRANDFATHER_WIKI_REPOS_DIR', '/grandfather')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    mockDetect.mockResolvedValue({exitCode: 1, stdout: 'out\n', stderr: 'err\n'})
    process.argv = [originalArgv[0] ?? 'node', 'check-wiki-private-presence.ts']
    try {
      await main()
      expect(process.exitCode).toBe(1)
      expect(stdout).toHaveBeenCalledWith('out\n')
      expect(stderr).toHaveBeenCalledWith('err\n')
      expect(mockDetect.mock.calls[0]?.[1].GRANDFATHER_WIKI_REPOS_DIR).toBe('/grandfather')
    } finally {
      process.argv = originalArgv
      stdout.mockRestore()
      stderr.mockRestore()
    }
  })
})
