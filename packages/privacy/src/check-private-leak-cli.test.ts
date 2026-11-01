import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {checkPrivateLeakCli, main} from './check-private-leak-cli.ts'

const {mockScan, mockPromotion} = vi.hoisted(() => ({
  mockScan: vi.fn<() => Promise<void>>(),
  mockPromotion: vi.fn<() => Promise<number>>(),
}))

vi.mock('./check-private-leak.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./check-private-leak.ts')>()
  return {...real, main: mockScan, runPromotionCli: mockPromotion}
})

let directory = ''
let outputPath = ''

function githubOutput(): string {
  try {
    return readFileSync(outputPath, 'utf8')
  } catch {
    return ''
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'check-private-leak-cli-'))
  outputPath = join(directory, 'github-output')
  mockScan.mockReset().mockResolvedValue()
  mockPromotion.mockReset().mockResolvedValue(0)
})

afterEach(() => {
  rmSync(directory, {recursive: true, force: true})
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

describe('the config', () => {
  it('is named for the script and declares one writing command with one flag', () => {
    const config = checkPrivateLeakCli()
    expect(config.name).toBe('check-private-leak')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(Object.keys(command?.options ?? {})).toEqual(['promotion'])
    expect(command?.options.promotion?.flag).toBe('--promotion')
    expect(command?.positionals).toEqual([])
  })

  it('builds a fresh object on every call', () => {
    expect(checkPrivateLeakCli()).not.toBe(checkPrivateLeakCli())
  })
})

describe('no argv (check-private-leak.yaml)', () => {
  it('scans the pull request once, leaves the promotion scan alone and exits 0', async () => {
    const result = await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: outputPath}})
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
    expect(mockScan).toHaveBeenCalledTimes(1)
    expect(mockPromotion).not.toHaveBeenCalled()
    expect(githubOutput()).toBe('')
  })

  it('exits 1 with the scan error as the message and writes scan_result=error when the scan throws', async () => {
    mockScan.mockRejectedValue(new Error('gh exploded'))
    const result = await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: outputPath}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'gh exploded\n'})
    expect(githubOutput()).toBe('scan_result=error\n')
  })

  it.each([['detection'], ['success'], ['error']])(
    'leaves the scan_result the scan already wrote (%s) alone when it throws afterwards',
    async written => {
      writeFileSync(outputPath, `other=1\nscan_result=${written}\n`)
      mockScan.mockRejectedValue(new Error('late failure'))
      const result = await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: outputPath}})
      expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'late failure\n'})
      expect(githubOutput()).toBe(`other=1\nscan_result=${written}\n`)
    },
  )

  it('appends scan_result=error after other outputs that are not a scan_result', async () => {
    writeFileSync(outputPath, 'not_scan_result=1\nx_scan_result=2\n')
    mockScan.mockRejectedValue(new Error('boom'))
    await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: outputPath}})
    expect(githubOutput()).toBe('not_scan_result=1\nx_scan_result=2\nscan_result=error\n')
  })

  it.each([[undefined], ['']])('rethrows the error unchanged when GITHUB_OUTPUT is %j', async value => {
    mockScan.mockRejectedValue(new Error('no output file'))
    const result = await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: value}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'no output file\n'})
  })

  it('writes scan_result=error to a GITHUB_OUTPUT file that does not exist yet', async () => {
    mockScan.mockRejectedValue(new Error('first write'))
    await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: outputPath}})
    expect(githubOutput()).toBe('scan_result=error\n')
  })

  it('rethrows a non-Error rejection as the runner reports it', async () => {
    mockScan.mockRejectedValue('plain string')
    const result = await runCli(checkPrivateLeakCli(), {argv: [], env: {GITHUB_OUTPUT: outputPath}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('plain string\n')
    expect(githubOutput()).toBe('scan_result=error\n')
  })
})

describe('--promotion (merge-data.yaml)', () => {
  it.each([0, 1])('runs the promotion scan, not the pull request scan, and exits with its code %i', async code => {
    mockPromotion.mockResolvedValue(code)
    const result = await runCli(checkPrivateLeakCli(), {argv: ['--promotion'], env: {GITHUB_OUTPUT: outputPath}})
    expect(result).toEqual({exitCode: code, stdout: '', stderr: ''})
    expect(mockPromotion).toHaveBeenCalledTimes(1)
    expect(mockScan).not.toHaveBeenCalled()
    expect(githubOutput()).toBe('')
  })
})

describe('--promotion that throws', () => {
  it('exits 1 with the message and writes no scan_result: promotion gates on its exit code alone', async () => {
    mockPromotion.mockRejectedValue(new Error('git exploded'))
    const result = await runCli(checkPrivateLeakCli(), {argv: ['--promotion'], env: {GITHUB_OUTPUT: outputPath}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'git exploded\n'})
    expect(githubOutput()).toBe('')
  })
})

describe('argv that matches nothing declared', () => {
  it.each([
    [['--help']],
    [['-h']],
    [['--bogus']],
    [['stray']],
    [['--promotion', '--bogus']],
    [['--promotion', 'stray']],
    [['--promotion', '--help']],
    [['--']],
    [['--promotion=false', '--bogus']],
  ])('%j is a usage error: exit 1, scan_result=error, nothing scanned', async argv => {
    const result = await runCli(checkPrivateLeakCli(), {argv, env: {GITHUB_OUTPUT: outputPath}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('check-private-leak')
    expect(result.stderr).toContain('--promotion')
    expect(githubOutput()).toBe('scan_result=error\n')
    expect(mockScan).not.toHaveBeenCalled()
    expect(mockPromotion).not.toHaveBeenCalled()
  })

  it('writes scan_result=error once, even when a usage error is followed by more output', async () => {
    await runCli(checkPrivateLeakCli(), {argv: ['--bogus'], env: {GITHUB_OUTPUT: outputPath}})
    expect(githubOutput().split('\n').filter(Boolean)).toEqual(['scan_result=error'])
  })

  it.each([[undefined], ['']])('does not throw when GITHUB_OUTPUT is %j', async value => {
    const result = await runCli(checkPrivateLeakCli(), {argv: ['--help'], env: {GITHUB_OUTPUT: value}})
    expect(result.exitCode).toBe(1)
    expect(githubOutput()).toBe('')
  })

  it('reads GITHUB_OUTPUT from the process environment when no env is given', async () => {
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
    const result = await runCli(checkPrivateLeakCli(), {argv: ['--help']})
    expect(result.exitCode).toBe(1)
    expect(githubOutput()).toBe('scan_result=error\n')
  })
})

describe('main', () => {
  it('runs the CLI on the process argv and sets the exit code', async () => {
    const originalArgv = process.argv
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
    process.argv = [originalArgv[0] ?? 'node', 'check-private-leak.ts', '--promotion']
    mockPromotion.mockResolvedValue(1)
    try {
      await main()
      expect(process.exitCode).toBe(1)
      expect(mockPromotion).toHaveBeenCalledTimes(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('writes a usage error to the process stderr and scan_result=error to GITHUB_OUTPUT', async () => {
    const originalArgv = process.argv
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    process.argv = [originalArgv[0] ?? 'node', 'check-private-leak.ts', '--help']
    try {
      await main()
      expect(process.exitCode).toBe(1)
      expect(write.mock.calls.map(call => String(call[0])).join('')).toContain('--promotion')
      expect(githubOutput()).toBe('scan_result=error\n')
    } finally {
      process.argv = originalArgv
      write.mockRestore()
    }
  })
})
