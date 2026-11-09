import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {createPromotionGit, main, promotionQualifyCli} from './promotion-qualify-cli.ts'

let root = ''
let counter = 0

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'promotion-qualify-cli-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

function git(cwd: string, ...args: readonly string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', ...args],
    {cwd, encoding: 'utf8'},
  )
}

/** Writes `files` (a null value deletes the file), commits them and returns the commit. */
function commit(cwd: string, files: Readonly<Record<string, string | null>>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path)
    if (content === null) {
      git(cwd, 'rm', '-q', '--', path)
      continue
    }
    mkdirSync(dirname(full), {recursive: true})
    writeFileSync(full, content)
    git(cwd, 'add', '--', path)
  }
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD').trim()
}

/**
 * A checkout whose `origin/main` and `origin/data` are the tips of `main` and `data`, with a shared
 * history first. `onData` and `onMain` apply after the fork.
 */
function fixture(options: {
  readonly onData: Readonly<Record<string, string | null>>
  readonly onMain?: Readonly<Record<string, string | null>>
}): string {
  counter += 1
  const cwd = join(root, `repo-${String(counter)}`)
  mkdirSync(cwd)
  git(cwd, 'init', '-q', '-b', 'main')
  commit(cwd, {'README.md': 'base\n', 'scripts/x.ts': 'x\n', 'knowledge/a.md': 'a\n'}, 'base')
  git(cwd, 'checkout', '-q', '-b', 'data')
  const data = commit(cwd, options.onData, 'data')
  git(cwd, 'checkout', '-q', 'main')
  const main = options.onMain === undefined ? git(cwd, 'rev-parse', 'HEAD').trim() : commit(cwd, options.onMain, 'main')
  git(cwd, 'update-ref', 'refs/remotes/origin/main', main)
  git(cwd, 'update-ref', 'refs/remotes/origin/data', data)
  return cwd
}

describe('createPromotionGit', () => {
  it('lists the three-dot name-status diff with NUL separators', async () => {
    const cwd = fixture({onData: {'knowledge/b.md': 'b\n', 'metadata/m.yaml': 'm\n'}})
    const raw = await createPromotionGit({cwd}).diffNameStatus()
    expect(raw).toBe('A\0knowledge/b.md\0A\0metadata/m.yaml\0')
  })

  it('reports a rename with both paths', async () => {
    // `scripts/x.ts` holds `x\n` on main, so the same body under `knowledge/` is detected as a rename.
    const cwd = fixture({onData: {'scripts/x.ts': null, 'knowledge/x.md': 'x\n'}})
    expect(await createPromotionGit({cwd}).diffNameStatus()).toBe('R100\0scripts/x.ts\0knowledge/x.md\0')
  })

  it('ignores a change made on main after the fork (three-dot)', async () => {
    const cwd = fixture({onData: {'knowledge/b.md': 'b\n'}, onMain: {'scripts/only-main.ts': 'm\n'}})
    expect(await createPromotionGit({cwd}).diffNameStatus()).toBe('A\0knowledge/b.md\0')
  })

  it('returns the mode and object of a path at each tip, and null when it is absent', async () => {
    const cwd = fixture({onData: {'knowledge/a.md': 'changed\n', 'knowledge/new.md': 'n\n'}})
    const adapter = createPromotionGit({cwd})
    const base = await adapter.entryAt('base', 'knowledge/a.md')
    const head = await adapter.entryAt('head', 'knowledge/a.md')
    expect(base).toMatch(/^100644 blob [0-9a-f]{40,64}$/u)
    expect(head).toMatch(/^100644 blob [0-9a-f]{40,64}$/u)
    expect(head).not.toBe(base)
    expect(await adapter.entryAt('base', 'knowledge/new.md')).toBeNull()
    expect(await adapter.entryAt('head', 'knowledge/new.md')).toMatch(/^100644 blob /u)
    expect(await adapter.entryAt('head', 'nowhere/at-all.md')).toBeNull()
  })

  it('reads the entry of a path with spaces and a colon', async () => {
    const cwd = fixture({onData: {'knowledge/a b:c.md': 'z\n'}})
    expect(await createPromotionGit({cwd}).entryAt('head', 'knowledge/a b:c.md')).toMatch(/^100644 blob /u)
  })

  it('gives an equal entry for content that main already has', async () => {
    const cwd = fixture({onData: {'scripts/x.ts': 'same\n'}, onMain: {'scripts/x.ts': 'same\n'}})
    const adapter = createPromotionGit({cwd})
    expect(await adapter.entryAt('head', 'scripts/x.ts')).toBe(await adapter.entryAt('base', 'scripts/x.ts'))
  })

  it('rejects when git fails', async () => {
    const cwd = join(root, 'not-a-repo')
    mkdirSync(cwd)
    await expect(createPromotionGit({cwd}).diffNameStatus()).rejects.toThrow()
  })
})

describe('the config', () => {
  it('is named for the script and declares one read-only root command with no options', () => {
    const config = promotionQualifyCli()
    expect(config.name).toBe('promotion-qualify')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(true)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(promotionQualifyCli()).not.toBe(promotionQualifyCli())
  })
})

describe('no argv', () => {
  it('fails closed without an event name and prints a fixed line', async () => {
    const result = await runCli(promotionQualifyCli(), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'promotion-qualify: GITHUB_EVENT_NAME is required\n'})
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])('%s is a usage error', async arg => {
    const result = await runCli(promotionQualifyCli(), {argv: [arg], env: {GITHUB_EVENT_NAME: 'schedule'}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toBe('')
    expect(result.stderr).not.toContain('is required')
  })
})

describe('main', () => {
  it('runs against process.argv and sets the exit code', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.stubEnv('GITHUB_EVENT_NAME', '')
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/promotion-qualify.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith('promotion-qualify: GITHUB_EVENT_NAME is required\n')
    stderr.mockRestore()
  })
})
