import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {installRenovateCli, main} from './install-renovate-cli.ts'
import {installRenovate} from './renovate-runtime.ts'

// The install itself runs `bun install` and builds a native binding; the CLI's job is the wiring around it, so the
// install is replaced. The pin reader and the prefix resolver are the real ones.
vi.mock('./renovate-runtime.ts', async importOriginal => {
  const original = await importOriginal<typeof import('./renovate-runtime.ts')>()
  return {...original, installRenovate: vi.fn()}
})

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'install-renovate-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.mocked(installRenovate).mockReset()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** A test-owned checkout whose `main.yaml` pins `version`, or has no pin at all when `version` is undefined. */
function checkout(name: string, version: string | undefined): string {
  const directory = join(root, name)
  mkdirSync(join(directory, '.github', 'workflows'), {recursive: true})
  writeFileSync(
    join(directory, '.github', 'workflows', 'main.yaml'),
    version === undefined ? 'name: Main\njobs: {}\n' : `name: Main\nenv:\n  RENOVATE_VERSION: ${version}\njobs: {}\n`,
  )
  return directory
}

async function run(directory: string, env: Record<string, string | undefined>, argv: readonly string[] = []) {
  vi.spyOn(process, 'cwd').mockReturnValue(directory)
  return runCli(installRenovateCli(), {argv, env})
}

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = installRenovateCli()
    expect(config.name).toBe('install-renovate')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('prefixes a thrown error with the CLI name and ends it with a newline', () => {
    const format = installRenovateCli().errorFormat
    expect(format?.(new Error('boom'))).toBe('install-renovate: boom\n')
    expect(format?.('plain')).toBe('install-renovate: plain\n')
  })

  it('builds a fresh object on every call', () => {
    expect(installRenovateCli()).not.toBe(installRenovateCli())
  })
})

describe('a run', () => {
  it.each(['installed', 'already-installed'] as const)(
    'installs the pinned version into RENOVATE_PREFIX (%s): the prefix on stdout, one line on stderr, exit 0',
    async outcome => {
      vi.mocked(installRenovate).mockResolvedValue(outcome)
      const result = await run(checkout(`ok-${outcome}`, '44.198.0'), {RENOVATE_PREFIX: '/scratch/renovate'})
      expect(result).toEqual({
        exitCode: 0,
        stdout: '/scratch/renovate\n',
        stderr: `install-renovate: renovate@44.198.0 ${outcome} at /scratch/renovate\n`,
      })
      expect(vi.mocked(installRenovate)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(installRenovate).mock.calls[0]?.slice(0, 2)).toEqual(['/scratch/renovate', '44.198.0'])
    },
  )

  it('falls back to a per-version directory under RUNNER_TEMP when RENOVATE_PREFIX is unset', async () => {
    vi.mocked(installRenovate).mockResolvedValue('installed')
    const result = await run(checkout('runner-temp', '44.198.0'), {RUNNER_TEMP: '/runner/tmp'})
    expect(result.stdout).toBe('/runner/tmp/renovate-44.198.0\n')
    expect(vi.mocked(installRenovate).mock.calls[0]?.[0]).toBe('/runner/tmp/renovate-44.198.0')
  })

  it('prints a failed install as install-renovate: <message> on stderr, nothing on stdout, exit 1', async () => {
    vi.mocked(installRenovate).mockRejectedValue(new Error('bun install renovate@44.198.0 exited 1'))
    const result = await run(checkout('install-fails', '44.198.0'), {RENOVATE_PREFIX: '/scratch/x'})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'install-renovate: bun install renovate@44.198.0 exited 1\n',
    })
  })

  it('fails without installing when the workflow pins no exact version', async () => {
    const result = await run(checkout('no-pin', undefined), {RENOVATE_PREFIX: '/scratch/x'})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('install-renovate: .github/workflows/main.yaml: top-level env.RENOVATE_VERSION')
    expect(vi.mocked(installRenovate)).not.toHaveBeenCalled()
  })

  it('fails without installing when the workflow file is missing', async () => {
    const result = await run(join(root, 'nowhere'), {RENOVATE_PREFIX: '/scratch/x'})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('install-renovate: ENOENT')
    expect(vi.mocked(installRenovate)).not.toHaveBeenCalled()
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing installed',
    async argv => {
      const result = await run(checkout('usage', '44.198.0'), {RENOVATE_PREFIX: '/scratch/x'}, argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(vi.mocked(installRenovate)).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.mocked(installRenovate).mockResolvedValue('installed')
    vi.spyOn(process, 'cwd').mockReturnValue(checkout('main', '44.198.0'))
    vi.stubEnv('RENOVATE_PREFIX', '/scratch/main')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/install-renovate.ts']
    try {
      await main()
    } finally {
      process.argv = argv
      vi.unstubAllEnvs()
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toBe('/scratch/main\n')
    expect(exit).not.toHaveBeenCalled()
  })
})
