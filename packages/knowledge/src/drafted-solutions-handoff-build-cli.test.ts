import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {draftedSolutionsHandoffBuildCli, main} from './drafted-solutions-handoff-build-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drafted-solutions-handoff-build-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is one read-only root command that takes no argument and no option', () => {
    const config = draftedSolutionsHandoffBuildCli()
    expect(config.name).toBe('drafted-solutions-handoff-build')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(draftedSolutionsHandoffBuildCli()).not.toBe(draftedSolutionsHandoffBuildCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(draftedSolutionsHandoffBuildCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(result.stderr).not.toContain('::error::')
    },
  )
})

describe('a run', () => {
  it('fails closed with a bare ::error:: line, exit 1 and nothing on stdout when the handoff directory is unset', async () => {
    const result = await runCli(draftedSolutionsHandoffBuildCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('::error::DRAFTED_SOLUTIONS_HANDOFF_DIR is required\n')
  })

  it('treats an empty handoff directory as unset', async () => {
    const result = await runCli(draftedSolutionsHandoffBuildCli(), {argv: [], env: {DRAFTED_SOLUTIONS_HANDOFF_DIR: ''}})
    expect(result.stderr).toBe('::error::DRAFTED_SOLUTIONS_HANDOFF_DIR is required\n')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('DRAFTED_SOLUTIONS_HANDOFF_DIR', '')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/drafted-solutions-handoff-build.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toBe('::error::DRAFTED_SOLUTIONS_HANDOFF_DIR is required\n')
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
