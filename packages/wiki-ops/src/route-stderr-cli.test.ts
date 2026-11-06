import {Buffer} from 'node:buffer'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {runCli} from '@fro-bot/core/cli'
import {spawnEntrypoint} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {loadRouterSteps} from '../fixtures/route-stderr-workflow-steps.ts'
import {main, routeStderrCli} from './route-stderr-cli.ts'

const CHILD = fileURLToPath(new URL('../fixtures/route-stderr-child.ts', import.meta.url))
const ENTRYPOINT = fileURLToPath(new URL('../../../scripts/route-stderr.ts', import.meta.url))

interface ParityCase {
  readonly step: 'fro-bot-ingest' | 'survey-wiki-commit' | 'survey-corrections'
  readonly name: string
  readonly stderr: string
  readonly stdout: string
  readonly childOutput: string
  readonly exit: number
  readonly observed: {
    readonly status: number
    readonly stdout: string
    readonly stderr: string
    readonly summary: string
    readonly output: string
  }
}

const PARITY = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/route-stderr-parity.json', import.meta.url)), 'utf8'),
) as {cases: ParityCase[]}

let dir = ''
let summaryPath = ''
let argvFile = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'route-stderr-cli-'))
  summaryPath = join(dir, 'summary')
  argvFile = join(dir, 'argv.json')
  writeFileSync(summaryPath, '')
})

afterEach(() => {
  rmSync(dir, {recursive: true, force: true})
  vi.restoreAllMocks()
  process.exitCode = undefined
})

function runnerEnv(extra: Record<string, string> = {}): Record<string, string> {
  const outputPath = join(dir, 'output')
  if (!existsSync(outputPath)) writeFileSync(outputPath, '')
  return {
    PATH: process.env.PATH ?? '',
    GITHUB_STEP_SUMMARY: summaryPath,
    GITHUB_OUTPUT: outputPath,
    CASE_ARGV_FILE: argvFile,
    ...extra,
  }
}

async function drive(argv: readonly string[], env: Record<string, string> = runnerEnv()) {
  const replayed: Uint8Array[] = []
  const result = await runCli(
    routeStderrCli({
      replay: chunk => {
        replayed.push(chunk)
      },
    }),
    {argv, env},
  )
  return {...result, replayed: Buffer.concat(replayed).toString('utf8')}
}

const CHILD_COMMAND = [process.execPath, CHILD]
const ROUTE = '--route=wiki-ingest:warning:=Wiki ingest warnings'

describe('the config', () => {
  it('is one writing root command with a variadic command positional and the router options', () => {
    const config = routeStderrCli()
    expect(config.name).toBe('route-stderr')
    expect(config.commands).toHaveLength(1)
    const [command] = config.commands
    expect(command?.name).toBe('')
    expect(command?.readOnly).toBe(false)
    expect(command?.positionals).toStrictEqual([{name: 'command', kind: 'variadic'}])
    expect(Object.keys(command?.options ?? {}).sort()).toStrictEqual([
      'conflictExit',
      'conflictOutput',
      'route',
      'summary',
    ])
  })

  it('builds a fresh object on every call', () => {
    expect(routeStderrCli()).not.toBe(routeStderrCli())
  })
})

describe('argv', () => {
  it('runs the command after the router flags and returns its exit code', async () => {
    const result = await drive(
      ['--route', 'wiki-ingest:warning:=Wiki ingest warnings', ...CHILD_COMMAND],
      runnerEnv({CASE_EXIT: '4', CASE_STDERR: 'plain\n'}),
    )
    expect(result.exitCode).toBe(4)
    expect(result.stderr).toBe('')
    expect(result.replayed).toBe('plain\n')
  })

  it('takes one --route as a string, two as an array, and the = form', async () => {
    const env = runnerEnv({CASE_STDERR: 'wiki-ingest:warning:w1\nwiki-ingest:finding:f1\n'})
    await drive(['--route', 'wiki-ingest:warning:=Warnings', ...CHILD_COMMAND], env)
    expect(readFileSync(summaryPath, 'utf8')).toBe('### Warnings\n- w1\n')
    writeFileSync(summaryPath, '')
    await drive(
      ['--route', 'wiki-ingest:warning:=Warnings', '--route', 'wiki-ingest:finding:=Findings', ...CHILD_COMMAND],
      env,
    )
    expect(readFileSync(summaryPath, 'utf8')).toBe('### Warnings\n- w1\n### Findings\n- f1\n')
    writeFileSync(summaryPath, '')
    await drive(['--route=wiki-ingest:finding:=Findings', ...CHILD_COMMAND], env)
    expect(readFileSync(summaryPath, 'utf8')).toBe('### Findings\n- f1\n')
  })

  it('defaults --summary to filtered and takes all', async () => {
    const env = runnerEnv({CASE_STDERR: 'note\ncorrections:warning:w1\n'})
    await drive(['--route', 'corrections:warning:=Heading', ...CHILD_COMMAND], env)
    expect(readFileSync(summaryPath, 'utf8')).toBe('### Heading\n- w1\n')
    writeFileSync(summaryPath, '')
    await drive(['--route', 'corrections:warning:=Heading', '--summary', 'all', ...CHILD_COMMAND], env)
    expect(readFileSync(summaryPath, 'utf8')).toBe('### Heading\nnote\n- w1\n')
  })

  it('writes the conflict output on the declared exit code', async () => {
    const env = runnerEnv({CASE_EXIT: '3'})
    const result = await drive([ROUTE, '--conflict-exit', '3', '--conflict-output', 'conflict', ...CHILD_COMMAND], env)
    expect(result.exitCode).toBe(3)
    expect(readFileSync(env.GITHUB_OUTPUT ?? '', 'utf8')).toBe('conflict=true\n')
  })

  it('passes the command arguments through untouched', async () => {
    const hostile = ['$(x)', ';', '*', 'a b', "it's"]
    await drive([ROUTE, ...CHILD_COMMAND, ...hostile])
    expect(JSON.parse(readFileSync(argvFile, 'utf8'))).toStrictEqual(hostile)
  })

  it.each([
    ['no command', [ROUTE], 'route-stderr: a command to run is required\n'],
    ['no route', [...CHILD_COMMAND], 'route-stderr: at least one --route is required\n'],
    ['no argv at all', [], 'route-stderr: at least one --route is required\n'],
    [
      'a conflict exit without an output name',
      [ROUTE, '--conflict-exit', '3', ...CHILD_COMMAND],
      'route-stderr: --conflict-exit and --conflict-output go together\n',
    ],
    [
      'a conflict output without an exit code',
      [ROUTE, '--conflict-output', 'conflict', ...CHILD_COMMAND],
      'route-stderr: --conflict-exit and --conflict-output go together\n',
    ],
    [
      'a malformed route',
      ['--route', 'no-separator', ...CHILD_COMMAND],
      'route-stderr: --route needs <prefix>=<heading>, with a non-empty prefix and heading on one line\n',
    ],
    [
      'all with two routes',
      [ROUTE, '--route', 'b:=B', '--summary', 'all', ...CHILD_COMMAND],
      'route-stderr: --summary all takes exactly one --route\n',
    ],
  ])('%s is a usage error: exit 1, the message on stderr, the command never runs', async (_name, argv, message) => {
    const result = await drive(argv)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(message)
    expect(existsSync(argvFile)).toBe(false)
  })

  it.each([
    ['an unknown flag after the command', [ROUTE, ...CHILD_COMMAND, '--bogus']],
    ['an unknown flag before the command', [ROUTE, '--bogus', ...CHILD_COMMAND]],
    ['a separator', [ROUTE, '--', ...CHILD_COMMAND]],
    ['--help', ['--help']],
    ['a bad summary mode', [ROUTE, '--summary', 'some', ...CHILD_COMMAND]],
    ['a conflict exit of 0', [ROUTE, '--conflict-exit', '0', '--conflict-output', 'c', ...CHILD_COMMAND]],
    ['a conflict exit of 256', [ROUTE, '--conflict-exit', '256', '--conflict-output', 'c', ...CHILD_COMMAND]],
    ['a conflict exit of 1.5', [ROUTE, '--conflict-exit', '1.5', '--conflict-output', 'c', ...CHILD_COMMAND]],
    ['a conflict exit of x', [ROUTE, '--conflict-exit', 'x', '--conflict-output', 'c', ...CHILD_COMMAND]],
    ['an empty conflict output', [ROUTE, '--conflict-exit', '3', '--conflict-output', '', ...CHILD_COMMAND]],
    ['a dotted option', [ROUTE, '--a.b=1', ...CHILD_COMMAND]],
  ])('%s is a usage error: exit 1, usage on stderr, the command never runs', async (_name, argv) => {
    const result = await drive(argv)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toBe('')
    expect(existsSync(argvFile)).toBe(false)
  })

  it('never echoes the wrapped command or the environment in a usage line', async () => {
    const result = await drive(
      ['--route', 'no-separator', 'secret-command', 'secret-arg'],
      runnerEnv({TOKEN: 'secret-env'}),
    )
    expect(result.stderr).not.toContain('secret')
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code', async () => {
    const argv = process.argv
    process.argv = [argv[0] ?? '', argv[1] ?? '', '--help']
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(write).toHaveBeenCalled()
  })
})

describe('the default replay', () => {
  it('writes the captured stderr to process.stderr as bytes', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(routeStderrCli(), {
      argv: [ROUTE, ...CHILD_COMMAND],
      env: runnerEnv({CASE_STDERR: 'to the process\n'}),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(write).toHaveBeenCalledTimes(1)
    expect(Buffer.from(write.mock.calls[0]?.[0] as Uint8Array).toString('utf8')).toBe('to the process\n')
  })
})

/** A `bun` on PATH that runs the child fixture, so the step's own `bun scripts/<name>.ts` reaches it. */
function stubBin(): string {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'bun'), `#!/bin/sh\nexec "${process.execPath}" "${CHILD}" "$@"\n`)
  chmodSync(join(bin, 'bun'), 0o755)
  return bin
}

describe('each workflow step, with its real argv', () => {
  const steps = loadRouterSteps()

  it('finds the four steps', () => {
    expect(steps.map(step => `${step.file}/${step.job}`)).toStrictEqual([
      'fro-bot.yaml/fro-bot-wiki-ingest',
      'fro-bot.yaml/fro-bot-observe-wiki-ingest',
      'survey-repo.yaml/survey-persist',
      'survey-repo.yaml/survey-repo',
    ])
  })

  it.each([0, 1, 2, 3])("%s: runs its wrapped command and returns that command's exit code", async exit => {
    const bin = stubBin()
    for (const step of steps) {
      rmSync(argvFile, {force: true})
      const result = await drive(
        step.argv,
        runnerEnv({PATH: `${bin}:${process.env.PATH ?? ''}`, CASE_EXIT: String(exit)}),
      )
      expect(result.exitCode, `${step.file}/${step.job}`).toBe(exit)
      expect(JSON.parse(readFileSync(argvFile, 'utf8')), `${step.file}/${step.job}`).toStrictEqual([step.wrapped[1]])
    }
  })
})

describe('parity with the shell steps this CLI replaced', () => {
  const steps = loadRouterSteps()

  it('has a captured case for every step and the five named inputs', () => {
    const names = new Set(PARITY.cases.map(c => c.name))
    for (const name of ['two warnings', 'empty stderr', 'exit 1 with unprefixed text']) {
      expect(PARITY.cases.some(c => c.name === name || c.name.startsWith(name))).toBe(true)
    }
    expect(names.has('warnings and findings')).toBe(true)
    expect(names.has('exit 3 conflict with a finding')).toBe(true)
    expect(new Set(PARITY.cases.map(c => c.step))).toStrictEqual(
      new Set(['fro-bot-ingest', 'survey-wiki-commit', 'survey-corrections']),
    )
  })

  for (const parityCase of PARITY.cases) {
    const matching = steps.filter(step => step.key === parityCase.step)
    it(`${parityCase.step}: ${parityCase.name}`, async () => {
      expect(matching.length).toBeGreaterThan(0)
      for (const step of matching) {
        writeFileSync(summaryPath, '')
        const result = await spawnEntrypoint({
          entrypoint: ENTRYPOINT,
          argv: [...step.routerFlags, process.execPath, CHILD],
          env: {
            GITHUB_STEP_SUMMARY: summaryPath,
            CASE_STDERR: parityCase.stderr,
            CASE_STDOUT: parityCase.stdout,
            CASE_OUTPUT: parityCase.childOutput,
            CASE_EXIT: String(parityCase.exit),
          },
        })
        const where = `${step.file}/${step.job}`
        expect({
          where,
          status: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          summary: readFileSync(summaryPath, 'utf8'),
          output: result.githubOutput,
        }).toStrictEqual({where, ...parityCase.observed})
      }
    })
  }
})
