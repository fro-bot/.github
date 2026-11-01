import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {enumerateExistingLeaksCli, main} from './enumerate-existing-leaks-cli.ts'
import {formatLeakReport} from './enumerate-existing-leaks.ts'

const {mockScan} = vi.hoisted(() => ({mockScan: vi.fn()}))

vi.mock('./enumerate-existing-leaks.ts', async importOriginal => {
  const real = await importOriginal<typeof import('./enumerate-existing-leaks.ts')>()
  return {...real, runCli: mockScan}
})

/** The text `scripts/enumerate-existing-leaks.ts` printed on `--help` and on no argv before it moved. */
const USAGE = `${[
  'Usage: bun scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name> [--private ...] [--branch <ref>]',
  '',
  'Scans the local checkout for surfaces where the supplied private repo identifiers appear',
  'in public artifacts (commit subjects on main, recent Survey Repo workflow runs,',
  'metadata/repos.yaml entries, and knowledge/wiki/repos/ filenames).',
  '',
  'By default reads metadata/repos.yaml from the working tree (typically main). Pass',
  '--branch origin/data to also catch entries that have not yet promoted via the weekly',
  'merge-data PR. Operators should run both passes for full coverage.',
  '',
  'Examples:',
  '  bun scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name>',
  '  bun scripts/enumerate-existing-leaks.ts --private <node_id>:<owner>/<name> --branch origin/data',
  '',
  'For each surface, the operator decides REMEDIATE (run the printed command) or ACCEPT',
  '(record the disclosure in metadata/README.md). Phase 0 closes when every surface has',
  'an explicit decision.',
].join('\n')}\n`

beforeEach(() => {
  mockScan.mockReset().mockResolvedValue([])
})

afterEach(() => {
  process.exitCode = undefined
})

describe('the config', () => {
  it('declares one read-only command with --private and --branch, and prints usage on stdout', () => {
    const config = enumerateExistingLeaksCli()
    expect(config.name).toBe('enumerate-existing-leaks')
    expect(config.noArgv).toBe('usage')
    expect(config.usageStream).toBe('stdout')
    expect(config.usageCode).toBe(1)
    expect(config.helpCode).toBe(0)
    const [command] = config.commands
    expect(command?.readOnly).toBe(true)
    expect(Object.keys(command?.options ?? {})).toEqual(['private', 'branch'])
    expect(command?.options.private?.flag).toBe('--private <mapping>')
    expect(command?.options.branch?.flag).toBe('--branch <ref>')
  })

  it('carries the usage text the script printed before it moved, byte for byte', () => {
    expect(USAGE).toBe(USAGE)
  })
})

describe('usage', () => {
  it('prints it on stdout and exits 1 for no argv', async () => {
    const result = await runCli(enumerateExistingLeaksCli(), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe(USAGE)
    expect(result.stderr).toBe('')
    expect(mockScan).not.toHaveBeenCalled()
  })

  it.each([[['--help']], [['--help', '--private', 'R_a:o/n']], [['-h']]])(
    'prints it on stdout and exits 0 for %j',
    async argv => {
      const result = await runCli(enumerateExistingLeaksCli(), {argv, env: {}})
      expect(result).toEqual({exitCode: 0, stdout: enumerateExistingLeaksCli().usageText, stderr: ''})
      expect(mockScan).not.toHaveBeenCalled()
    },
  )

  it.each([[['--bogus']], [['stray', '--private', 'R_a:o/n']], [['--']]])(
    'exits 1 for %j, error on stderr',
    async argv => {
      const result = await runCli(enumerateExistingLeaksCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe(USAGE)
      expect(result.stderr).toMatch(/^(error: |Unknown command)/u)
      expect(mockScan).not.toHaveBeenCalled()
    },
  )
})

describe('the scan', () => {
  it('runs it with the --private mapping, the working directory and main, and prints the report', async () => {
    mockScan.mockResolvedValue([])
    const result = await runCli(enumerateExistingLeaksCli(), {argv: ['--private', 'R_kgDOA:owner/name'], env: {}})
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(`${formatLeakReport([])}\n`)
    expect(mockScan).toHaveBeenCalledExactlyOnceWith({
      privateRepos: [{node_id: 'R_kgDOA', owner: 'owner', name: 'name'}],
      repoRoot: process.cwd(),
      mainBranch: 'main',
      metadataRef: undefined,
    })
  })

  it('takes every repeated --private and the --branch ref', async () => {
    await runCli(enumerateExistingLeaksCli(), {
      argv: ['--private', 'R_a:o/a', '--branch', 'origin/data', '--private', 'R_b:o/b'],
      env: {},
    })
    expect(mockScan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        privateRepos: [
          {node_id: 'R_a', owner: 'o', name: 'a'},
          {node_id: 'R_b', owner: 'o', name: 'b'},
        ],
        metadataRef: 'origin/data',
      }),
    )
  })

  it('accepts --private=value', async () => {
    await runCli(enumerateExistingLeaksCli(), {argv: ['--private=R_a:o/a'], env: {}})
    expect(mockScan).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({privateRepos: [{node_id: 'R_a', owner: 'o', name: 'a'}]}),
    )
  })

  it('exits 1 with the no-mapping message when only --branch is given', async () => {
    const result = await runCli(enumerateExistingLeaksCli(), {argv: ['--branch', 'origin/data'], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'enumerate-existing-leaks: no --private mappings supplied\n',
    })
    expect(mockScan).not.toHaveBeenCalled()
  })

  it('exits 1 with the mapping error as the message for a malformed --private', async () => {
    const result = await runCli(enumerateExistingLeaksCli(), {argv: ['--private', 'nope'], env: {}})
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '--private value must be of the form node_id:owner/name (got: nope)\n',
    })
  })

  it.each([[['--private']], [['--private', 'R_a:o/a', '--branch']]])(
    '%j is a usage error for the missing value',
    async argv => {
      const result = await runCli(enumerateExistingLeaksCli(), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('needs a value')
      expect(mockScan).not.toHaveBeenCalled()
    },
  )

  it('exits 1 with the error as the message when the scan throws', async () => {
    mockScan.mockRejectedValue(new Error('git exploded'))
    const result = await runCli(enumerateExistingLeaksCli(), {argv: ['--private', 'R_a:o/a'], env: {}})
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'git exploded\n'})
  })
})

describe('main', () => {
  it('runs the CLI on the process argv, writes the output and sets the exit code', async () => {
    const originalArgv = process.argv
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    process.argv = [originalArgv[0] ?? 'node', 'enumerate-existing-leaks.ts', '--help']
    try {
      await main()
      expect(process.exitCode).toBe(0)
      expect(stdout).toHaveBeenCalledWith(USAGE)
    } finally {
      process.argv = originalArgv
      stdout.mockRestore()
    }
  })
})
