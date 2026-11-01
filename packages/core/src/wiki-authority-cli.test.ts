import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {runCli} from './cli.ts'
import {checkWikiAuthorityCli, main} from './wiki-authority-cli.ts'

const {mockRun} = vi.hoisted(() => ({
  mockRun:
    vi.fn<(env: Record<string, string | undefined>) => Promise<{exitCode: number; stdout: string; stderr: string}>>(),
}))

vi.mock('./wiki-authority.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./wiki-authority.ts')>()
  return {...real, runWikiAuthority: mockRun}
})

beforeEach(() => {
  mockRun.mockReset().mockResolvedValue({exitCode: 0, stdout: 'check-wiki-authority: ok\n', stderr: ''})
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one read-only command with no options', () => {
    const config = checkWikiAuthorityCli()
    expect(config.name).toBe('check-wiki-authority')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(true)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(checkWikiAuthorityCli()).not.toBe(checkWikiAuthorityCli())
  })
})

describe('no argv (main.yaml)', () => {
  it('runs the check with the env of the run and returns its output and exit code', async () => {
    mockRun.mockResolvedValue({exitCode: 1, stdout: 'out\n', stderr: 'err\n'})
    const env = {GITHUB_EVENT_PATH: '/tmp/event.json'}
    const result = await runCli(checkWikiAuthorityCli(), {argv: [], env})
    expect(result).toEqual({exitCode: 1, stdout: 'out\n', stderr: 'err\n'})
    expect(mockRun).toHaveBeenCalledExactlyOnceWith(env)
  })

  it('returns a clean run as exit 0', async () => {
    const result = await runCli(checkWikiAuthorityCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: 'check-wiki-authority: ok\n', stderr: ''})
  })

  it('reports a thrown error as its message and exit 1', async () => {
    mockRun.mockRejectedValue(new Error('check-wiki-authority: event payload missing pull_request.head.ref'))
    const result = await runCli(checkWikiAuthorityCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'check-wiki-authority: event payload missing pull_request.head.ref\n',
    })
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])(
    '%s is a usage error and runs no check',
    async arg => {
      const result = await runCli(checkWikiAuthorityCli(), {argv: [arg], env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(mockRun).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    mockRun.mockResolvedValue({exitCode: 1, stdout: '', stderr: 'blocked\n'})
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/check-wiki-authority.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith('blocked\n')
    stderr.mockRestore()
  })
})
