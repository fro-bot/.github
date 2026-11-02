import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, rebuildWikiIndexCli} from './rebuild-wiki-index-cli.ts'
import {runRebuildWikiIndex} from './rebuild-wiki-index.ts'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, {recursive: true, force: true})
  }
})

/** A temp checkout the module writes into through `cwd`, so no test touches the real `knowledge/` tree. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rebuild-wiki-index-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), {recursive: true})
    writeFileSync(join(root, path), content)
  }
  return root
}

const PAGE = '---\ntype: topic\ntitle: Alpha\ncreated: 2026-04-16\nupdated: 2026-04-16\n---\n\nBody.\n'
const LOG_A = '# Wiki Log\n\n---\n\n## [2026-10-01 00:00] ingest | acme/a\n\nA.\n'
const LOG_B = `${LOG_A}\n## [2026-10-02 00:00] ingest | acme/b\n\nB.\n`

describe('the config', () => {
  it('is one writing root command with a variadic paths positional and a --merge-logs option', () => {
    const config = rebuildWikiIndexCli()
    expect(config.name).toBe('rebuild-wiki-index')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([{name: 'paths', kind: 'variadic'}])
    expect(Object.keys(config.commands[0]?.options ?? {})).toEqual(['mergeLogs'])
  })

  it('builds a fresh object on every call', () => {
    expect(rebuildWikiIndexCli()).not.toBe(rebuildWikiIndexCli())
  })
})

describe('runRebuildWikiIndex (a temp checkout)', () => {
  it('rebuilds the index from the wiki pages and says how many it read', async () => {
    const root = checkout({'knowledge/wiki/topics/alpha.md': PAGE, 'knowledge/wiki/topics/notes.txt': 'x'})
    const out: string[] = []
    await runRebuildWikiIndex({stdout: text => out.push(text)}, {cwd: root})
    expect(out).toEqual(['rebuilt knowledge/index.md from 1 wiki file(s)\n'])
    expect(readFileSync(join(root, 'knowledge/index.md'), 'utf8')).toContain('[[alpha]]')
  })

  it('merges the given logs into knowledge/log.md and says how many sources it read', async () => {
    const root = checkout({'a.md': LOG_A, 'b.md': LOG_B, 'knowledge/.keep': ''})
    const out: string[] = []
    await runRebuildWikiIndex({stdout: text => out.push(text)}, {cwd: root, mergeLogs: ['a.md', 'b.md', 'missing.md']})
    expect(out).toEqual(['merged 3 log source(s) into knowledge/log.md\n'])
    const merged = readFileSync(join(root, 'knowledge/log.md'), 'utf8')
    expect(merged).toContain('acme/a')
    expect(merged).toContain('acme/b')
  })

  it('refuses an empty merge list', async () => {
    const root = checkout({})
    await expect(runRebuildWikiIndex({stdout: () => undefined}, {cwd: root, mergeLogs: []})).rejects.toThrow(
      'rebuild-wiki-index: --merge-logs requires at least one log.md path',
    )
  })
})

describe('argv', () => {
  it('rejects log paths without --merge-logs, and writes nothing', async () => {
    const result = await runCli(rebuildWikiIndexCli(), {argv: ['extra'], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('error: unexpected arguments: extra (log paths need --merge-logs)\n')
  })

  it.each([[['--help']], [['--help=false']], [['--bogus']], [['--merge-logs']], [['a.md', '--merge-logs']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(rebuildWikiIndexCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/rebuild-wiki-index.ts', 'extra']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('unexpected arguments: extra')
    expect(exit).not.toHaveBeenCalled()
  })
})
