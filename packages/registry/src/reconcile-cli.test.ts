import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main, reconcileReposCli} from './reconcile-cli.ts'

const {mockHandle} = vi.hoisted(() => ({
  mockHandle: vi.fn<(params: {owner?: string; repo?: string}) => Promise<unknown>>(),
}))

vi.mock('./reconcile-handler.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./reconcile-handler.ts')>()
  return {...real, handleReconcile: mockHandle}
})

beforeEach(() => {
  mockHandle.mockReset().mockResolvedValue({accessListSize: 0, committed: false})
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one writing root command with no options', () => {
    const config = reconcileReposCli()
    expect(config.name).toBe('reconcile-repos')
    expect(config.errorFormat).toBeUndefined()
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.options).toEqual({})
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(reconcileReposCli()).not.toBe(reconcileReposCli())
  })
})

describe('no argv (reconcile-repos.yaml)', () => {
  it('reconciles the repository named by GITHUB_REPOSITORY and prints the result as one JSON line', async () => {
    const result = await runCli(reconcileReposCli(), {argv: [], env: {GITHUB_REPOSITORY: 'someone/else'}})
    expect(result).toEqual({exitCode: 0, stdout: '{"accessListSize":0,"committed":false}\n', stderr: ''})
    expect(mockHandle).toHaveBeenCalledExactlyOnceWith({owner: 'someone', repo: 'else'})
  })

  it('defaults to fro-bot/.github when GITHUB_REPOSITORY is unset', async () => {
    await runCli(reconcileReposCli(), {argv: [], env: {}})
    expect(mockHandle).toHaveBeenCalledExactlyOnceWith({owner: 'fro-bot', repo: '.github'})
  })

  it.each([[''], ['nope'], ['/repo'], ['owner/']])(
    'rejects the invalid GITHUB_REPOSITORY %j before reconciling',
    async value => {
      const result = await runCli(reconcileReposCli(), {argv: [], env: {GITHUB_REPOSITORY: value}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(`Invalid GITHUB_REPOSITORY value: "${value}"\n`)
      expect(mockHandle).not.toHaveBeenCalled()
    },
  )

  it('prints a thrown error as its message and exits 1', async () => {
    mockHandle.mockRejectedValue(new Error('reconcileRepos requires FRO_BOT_POLL_PAT in the environment'))
    const result = await runCli(reconcileReposCli(), {argv: [], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'reconcileRepos requires FRO_BOT_POLL_PAT in the environment\n',
    })
  })
})

describe('argv that matches nothing declared', () => {
  it.each([['--help'], ['--bogus'], ['stray'], ['--help=false']])(
    '%s is a usage error and reconciles nothing',
    async arg => {
      const result = await runCli(reconcileReposCli(), {argv: [arg], env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).not.toBe('')
      expect(mockHandle).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    mockHandle.mockRejectedValue(new Error('failed'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/reconcile-repos.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(mockHandle).toHaveBeenCalledTimes(1)
    stderr.mockRestore()
  })
})
