import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main, wikiIndexCli} from './wiki-index-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one read-only root command that takes no argument and no option', () => {
    const config = wikiIndexCli()
    expect(config.name).toBe('wiki-index')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(wikiIndexCli()).not.toBe(wikiIndexCli())
  })
})

describe('argv that no caller sends', () => {
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(wikiIndexCli(), {argv, env: {GITHUB_OUTPUT: '/nonexistent/out'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
    },
  )
})

describe('main', () => {
  it('reads the wiki under the working directory, prints one status line and sets the exit code without exiting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wiki-index-cli-'))
    const previous = process.cwd()
    try {
      await mkdir(join(root, 'knowledge/wiki/topics'), {recursive: true})
      await writeFile(
        join(root, 'knowledge/wiki/topics/a.md'),
        '---\ntype: topic\ntitle: A\n---\n\n# A\n\nAn opening sentence.\n',
      )
      process.chdir(root)
      vi.stubEnv('GITHUB_OUTPUT', '')
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      const argv = process.argv
      process.argv = [argv[0] ?? 'node', '/x/wiki-index.ts']
      try {
        await main()
      } finally {
        process.argv = argv
      }
      expect(process.exitCode).toBe(0)
      expect(stdout.mock.calls.map(call => String(call[0]))).toEqual([
        expect.stringMatching(/^wiki-index: listed=1 held=1 sentences=kept bytes=\d+\n$/u),
      ])
      expect(exit).not.toHaveBeenCalled()
    } finally {
      process.chdir(previous)
      await rm(root, {recursive: true, force: true})
    }
  })
})
