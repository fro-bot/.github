import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {capturePatternsClusterCli, main} from './capture-patterns-cluster-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'capture-patterns-cluster-cli-'))
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
    const config = capturePatternsClusterCli()
    expect(config.name).toBe('capture-patterns-cluster')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(capturePatternsClusterCli()).not.toBe(capturePatternsClusterCli())
  })
})

describe('argv that no caller sends', () => {
  const digestPath = () => join(root, 'usage-digest.json')
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(capturePatternsClusterCli(), {
        argv,
        env: {CAPTURE_PATTERNS_DIGEST_PATH: digestPath()},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      // Detection writes a digest even when it fails; a usage error writes nothing.
      expect(existsSync(digestPath())).toBe(false)
    },
  )
})

describe('a run', () => {
  it('without a token reports the failure in the result, writes an empty digest and exits 0', async () => {
    const digestPath = join(root, 'fallback-digest.json')
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(capturePatternsClusterCli(), {
      argv: [],
      env: {CAPTURE_PATTERNS_DIGEST_PATH: digestPath},
    })
    expect(result.exitCode).toBe(0)
    const summary = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(summary)).toHaveLength(13)
    // Either the token load or the client construction failed, and the workflow reads both flags.
    expect(summary.tokenLoadFailure === true || summary.scanFailure === true).toBe(true)
    expect(readFileSync(digestPath, 'utf8')).toBe('[]\n')
  })

  it('reports a scan failure when the digest path is unset', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(capturePatternsClusterCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({scanFailure: true})
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('GITHUB_TOKEN', '')
    vi.stubEnv('CAPTURE_PATTERNS_DIGEST_PATH', join(root, 'main-digest.json'))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/capture-patterns-cluster.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toMatch(/^\{"sourcesLoaded":/u)
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
