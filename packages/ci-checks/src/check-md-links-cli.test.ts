import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {checkMarkdownLinksCli, main} from './check-md-links-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-md-links-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** A test-owned checkout; the CLI reads the working directory, so `process.cwd` is pointed at it. */
function checkout(name: string, files: Readonly<Record<string, string>>): string {
  const directory = join(root, name)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), {recursive: true})
    writeFileSync(join(directory, path), text)
  }
  mkdirSync(directory, {recursive: true})
  return directory
}

const GOOD = {'README.md': '[Docs](docs/guide.md)\n', 'docs/guide.md': '[Root](../README.md)\n'}
const BROKEN = {
  'README.md': '[Docs](docs/guide.md)\n',
  'docs/guide.md': '[One](missing-one.md)\n\n[Two](missing-two.md)\n',
}

async function run(directory: string, argv: readonly string[] = []) {
  vi.spyOn(process, 'cwd').mockReturnValue(directory)
  return runCli(checkMarkdownLinksCli(), {argv, env: {}})
}

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = checkMarkdownLinksCli()
    expect(config.name).toBe('check-md-links')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
    expect(config.usageCode).toBeUndefined()
  })

  it('builds a fresh object on every call', () => {
    expect(checkMarkdownLinksCli()).not.toBe(checkMarkdownLinksCli())
  })
})

describe('a run', () => {
  it('exits 0 with no output when every link resolves', async () => {
    const result = await run(checkout('good', GOOD))
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('prints one path:line -> target line per broken link on stderr and exits 1', async () => {
    const result = await run(checkout('broken', BROKEN))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('docs/guide.md:1 -> missing-one.md\ndocs/guide.md:3 -> missing-two.md\n')
  })

  it('checks the working directory the process has, not the repository the module lives in', async () => {
    const result = await run(checkout('elsewhere', {'README.md': '[x](nowhere.md)\n'}))
    expect(result.stderr).toBe('README.md:1 -> nowhere.md\n')
  })

  it('reports an unreadable docs entry as a thrown error: message on stderr, exit 1', async () => {
    const result = await run(checkout('docs-file', {docs: 'not a directory'}))
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
  })
})

describe('argv that no caller sends', () => {
  // Before the runner these were ignored and the check ran, which is a pass for a broken tree under `--help`.
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['stray.md']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing checked',
    async argv => {
      const result = await run(checkout('usage', BROKEN), argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(result.stderr).not.toContain('missing-one.md')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    const directory = checkout('main', BROKEN)
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/check-md-links.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      'docs/guide.md:1 -> missing-one.md\ndocs/guide.md:3 -> missing-two.md\n',
    )
    expect(exit).not.toHaveBeenCalled()
  })
})
