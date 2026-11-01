import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, resolvePrivateCli} from './resolve-private-cli.ts'

const {mockExecFileSync} = vi.hoisted(() => ({mockExecFileSync: vi.fn()}))

vi.mock('node:child_process', () => ({execFileSync: mockExecFileSync}))

const readPaths: string[] = []
let reposPathForDefault = ''

vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: vi.fn(async (path: string, ...rest: unknown[]) => {
      readPaths.push(path)
      return real.readFile(path === 'metadata/repos.yaml' ? reposPathForDefault : path, ...(rest as ['utf8']))
    }),
  }
})

const REPOS = `version: 1
repos:
  - owner: '[REDACTED]'
    name: R_kgDOAAAAAA
    added: 2026-06-01
    onboarding_status: pending
    last_survey_at: null
    last_survey_status: null
    has_fro_bot_workflow: true
    has_renovate: false
    private: true
    node_id: R_kgDOAAAAAA
`

let directory = ''
let reposPath = ''

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'resolve-private-cli-'))
  reposPath = join(directory, 'repos.yaml')
  reposPathForDefault = reposPath
  writeFileSync(reposPath, REPOS)
})

afterAll(() => {
  rmSync(directory, {recursive: true, force: true})
})

beforeEach(() => {
  readPaths.length = 0
  mockExecFileSync
    .mockReset()
    .mockReturnValue(JSON.stringify({data: {node: {nameWithOwner: 'secret-owner/secret-repo'}}}))
})

describe('the config', () => {
  it('declares one read-only command with one optional positional and no options', () => {
    const config = resolvePrivateCli()
    expect(config.name).toBe('resolve-private')
    const [command] = config.commands
    expect(command?.readOnly).toBe(true)
    expect(command?.positionals).toEqual([{name: 'repos-path', kind: 'optional'}])
    expect(command?.options).toEqual({})
  })
})

describe('the table', () => {
  it('prints the resolved name for the repos path given as the positional', async () => {
    const result = await runCli(resolvePrivateCli(), {argv: [reposPath], env: {GH_TOKEN: 'tok'}})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('R_kgDOAAAAAA')
    expect(result.stdout).toContain('secret-owner/secret-repo')
    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
  })

  it('reads metadata/repos.yaml when no path is given', async () => {
    const result = await runCli(resolvePrivateCli(), {argv: [], env: {GH_TOKEN: 'tok'}})
    expect(result.exitCode).toBe(0)
    expect(readPaths).toEqual(['metadata/repos.yaml'])
  })

  it('reads the path it was given, and only that', async () => {
    await runCli(resolvePrivateCli(), {argv: [reposPath], env: {GH_TOKEN: 'tok'}})
    expect(readPaths).toEqual([reposPath])
  })

  it('hands the token to the resolver through the gh subprocess env, and nothing else from the token', async () => {
    await runCli(resolvePrivateCli(), {argv: [reposPath], env: {GH_TOKEN: 'operator-pat'}})
    const options = mockExecFileSync.mock.calls[0]?.[2] as {env: Record<string, string>}
    expect(options.env.GH_TOKEN).toBe('operator-pat')
  })
})

describe('failures', () => {
  it('exits 1 with the missing-token message and runs no gh call', async () => {
    const result = await runCli(resolvePrivateCli(), {argv: [reposPath], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'resolve-private: GH_TOKEN is not set. Set GH_TOKEN to an operator PAT before running this script.\n',
    })
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('exits 1 with the read error when the file is missing', async () => {
    const result = await runCli(resolvePrivateCli(), {argv: [join(directory, 'nope.yaml')], env: {GH_TOKEN: 'tok'}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('ENOENT')
    expect(result.stdout).toBe('')
  })

  it.each([[['--help']], [['--bogus']], [['a.yaml', 'extra']], [['--']]])(
    '%j is a usage error and reads nothing',
    async argv => {
      const result = await runCli(resolvePrivateCli(), {argv, env: {GH_TOKEN: 'tok'}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('resolve-private')
      expect(mockExecFileSync).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI on the process argv and env and sets the exit code', async () => {
    const originalArgv = process.argv
    vi.stubEnv('GH_TOKEN', 'tok')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    process.argv = [originalArgv[0] ?? 'node', 'resolve-private.ts', reposPath]
    try {
      await main()
      expect(process.exitCode).toBe(0)
      expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('secret-owner/secret-repo')
    } finally {
      process.argv = originalArgv
      stdout.mockRestore()
      vi.unstubAllEnvs()
      process.exitCode = undefined
    }
  })
})
