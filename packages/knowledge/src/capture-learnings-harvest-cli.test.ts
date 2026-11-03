import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {captureLearningsHarvestCli, main} from './capture-learnings-harvest-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'capture-learnings-harvest-cli-'))
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
    const config = captureLearningsHarvestCli()
    expect(config.name).toBe('capture-learnings-harvest')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(captureLearningsHarvestCli()).not.toBe(captureLearningsHarvestCli())
  })
})

describe('argv that no caller sends', () => {
  const digestPath = () => join(root, 'usage-digest.json')
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(captureLearningsHarvestCli(), {
        argv,
        env: {CAPTURE_LEARNINGS_DIGEST_PATH: digestPath()},
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      // The harvest writes an empty digest when it fails; a usage error writes nothing.
      expect(existsSync(digestPath())).toBe(false)
    },
  )
})

describe('a run', () => {
  it('without a token falls back to an empty digest: exit 0, the digest on stdout and in the file', async () => {
    const digestPath = join(root, 'fallback-digest.json')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(captureLearningsHarvestCli(), {
      argv: [],
      env: {CAPTURE_LEARNINGS_DIGEST_PATH: digestPath},
    })
    expect(result.exitCode).toBe(0)
    const telemetry = Object.fromEntries(
      [
        'closedPrsFetched',
        'mergedPrsInLookback',
        'excludedAutomation',
        'multiRoundCandidates',
        'ciFixPrsExamined',
        'ciFixCandidates',
        'afterSeenDedup',
        'afterSolutionsDedup',
        'emitted',
        'dualTriggerCandidates',
        'enrichmentBlocked',
        'enrichmentBlockedBySecret',
      ].map(key => [key, 0]),
    )
    expect(result.stdout).toBe(`${JSON.stringify({candidates: [], telemetry})}\n`)
    expect(readFileSync(digestPath, 'utf8')).toBe(result.stdout)
    expect(stderr).toHaveBeenCalledWith(
      'capture-learnings-harvest: unexpected error (Error), falling back to empty digest\n',
    )
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    vi.stubEnv('GITHUB_TOKEN', '')
    vi.stubEnv('CAPTURE_LEARNINGS_DIGEST_PATH', join(root, 'main-digest.json'))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/capture-learnings-harvest.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toContain('"candidates":[]')
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
