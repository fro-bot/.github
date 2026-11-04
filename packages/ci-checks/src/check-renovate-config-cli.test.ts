import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {checkRenovateConfigCli, main} from './check-renovate-config-cli.ts'
import {runCheckRenovateConfig} from './check-renovate-config.ts'

// The check needs the pinned Renovate and, for presets, the network. Its body is `runCheckRenovateConfig`, tested
// in check-renovate-config.test.ts against the real install; here the spy delegates to the real function, so a
// run without a scratch install fails the way a step does, and a test that needs a verdict replaces the result.
vi.mock('./check-renovate-config.ts', async importOriginal => {
  const original = await importOriginal<typeof import('./check-renovate-config.ts')>()
  return {...original, runCheckRenovateConfig: vi.fn(original.runCheckRenovateConfig)}
})

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-renovate-config-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.mocked(runCheckRenovateConfig).mockClear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

function checkout(name: string): string {
  const directory = join(root, name)
  mkdirSync(join(directory, '.github', 'workflows'), {recursive: true})
  writeFileSync(join(directory, '.github', 'workflows', 'main.yaml'), 'env:\n  RENOVATE_VERSION: 44.198.0\n')
  return directory
}

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = checkRenovateConfigCli()
    expect(config.name).toBe('check-renovate-config')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(checkRenovateConfigCli()).not.toBe(checkRenovateConfigCli())
  })
})

describe('a run', () => {
  it('checks the working directory and returns the exit code of the check', async () => {
    const directory = checkout('exit-code')
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    for (const code of [0, 1]) {
      vi.mocked(runCheckRenovateConfig).mockResolvedValueOnce(code)
      const result = await runCli(checkRenovateConfigCli(), {argv: [], env: {}})
      expect(result).toEqual({exitCode: code, stdout: '', stderr: ''})
    }
    expect(vi.mocked(runCheckRenovateConfig).mock.calls).toEqual([[directory], [directory]])
  })

  it('fails with a plain message, not a stack trace, when the scratch install is missing', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(checkout('no-install'))
    vi.stubEnv('RENOVATE_PREFIX', join(root, 'not-installed'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(checkRenovateConfigCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      `check-renovate-config: Renovate is not installed under RENOVATE_PREFIX=${join(root, 'not-installed')}. Run \`node scripts/install-renovate.ts\` (or \`bun run check:renovate-config\`, which does) first.\n`,
    )
  })

  it('turns a throw out of the check into its message on stderr and exit 1', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(checkout('throws'))
    vi.mocked(runCheckRenovateConfig).mockRejectedValueOnce(
      new Error('ENOENT: no such file or directory, open default.json'),
    )
    const result = await runCli(checkRenovateConfigCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'ENOENT: no such file or directory, open default.json\n',
    })
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing checked',
    async argv => {
      const result = await runCli(checkRenovateConfigCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(vi.mocked(runCheckRenovateConfig)).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(checkout('main'))
    vi.mocked(runCheckRenovateConfig).mockResolvedValueOnce(1)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/check-renovate-config.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
  })
})
