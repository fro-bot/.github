import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {checkRenovateRangesCli, main} from './check-renovate-ranges-cli.ts'
import {runCheckRenovateRanges} from './check-renovate-ranges.ts'

// The check needs the pinned Renovate. Its body is `runCheckRenovateRanges`, tested in check-renovate-ranges.test.ts
// against the real install; here the spy delegates to the real function, so a run without a scratch install fails
// the way a step does, and a test that needs a verdict replaces the result.
vi.mock('./check-renovate-ranges.ts', async importOriginal => {
  const original = await importOriginal<typeof import('./check-renovate-ranges.ts')>()
  return {...original, runCheckRenovateRanges: vi.fn(original.runCheckRenovateRanges)}
})

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-renovate-ranges-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.mocked(runCheckRenovateRanges).mockClear()
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
  it('is one read-only root command with one variadic positional, the config paths, and no option', () => {
    const config = checkRenovateRangesCli()
    expect(config.name).toBe('check-renovate-ranges')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([{name: 'paths', kind: 'variadic'}])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(checkRenovateRangesCli()).not.toBe(checkRenovateRangesCli())
  })
})

describe('a run', () => {
  it('checks default.json and .github/renovate.json5 when no path is given', async () => {
    const directory = checkout('defaults')
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    vi.mocked(runCheckRenovateRanges).mockResolvedValueOnce(0)
    const result = await runCli(checkRenovateRangesCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
    expect(vi.mocked(runCheckRenovateRanges).mock.calls).toEqual([
      [['default.json', '.github/renovate.json5'], directory],
    ])
  })

  it('checks exactly the paths it is given, in order, and returns the exit code of the check', async () => {
    const directory = checkout('explicit')
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    vi.mocked(runCheckRenovateRanges).mockResolvedValueOnce(1)
    const result = await runCli(checkRenovateRangesCli(), {argv: ['b.json', 'a.json5', 'c/d.json'], env: {}})
    expect(result.exitCode).toBe(1)
    expect(vi.mocked(runCheckRenovateRanges).mock.calls).toEqual([[['b.json', 'a.json5', 'c/d.json'], directory]])
  })

  it('fails with a plain message, not a stack trace, when the scratch install is missing', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(checkout('no-install'))
    vi.stubEnv('RENOVATE_PREFIX', join(root, 'not-installed'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(checkRenovateRangesCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      `check-renovate-ranges: Renovate is not installed under RENOVATE_PREFIX=${join(root, 'not-installed')}. Run \`node scripts/install-renovate.ts\` (or \`bun run check:renovate-config\`, which does) first.\n`,
    )
  })
})

describe('argv that no caller sends', () => {
  // Before the runner every argument was a config path, a flag included, so `--help` failed with ENOENT on `--help`.
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['default.json', '--bogus']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing checked',
    async argv => {
      const result = await runCli(checkRenovateRangesCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(vi.mocked(runCheckRenovateRanges)).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    const directory = checkout('main')
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    vi.mocked(runCheckRenovateRanges).mockResolvedValueOnce(1)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/check-renovate-ranges.ts', 'x.json']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(vi.mocked(runCheckRenovateRanges).mock.calls).toEqual([[['x.json'], directory]])
    expect(exit).not.toHaveBeenCalled()
  })
})
