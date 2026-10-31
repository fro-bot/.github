import {fileURLToPath} from 'node:url'
import {spawnEntrypoint, type Runtime} from '@fro-bot/test-kit/spawn-entrypoint'
import {describe, expect, it} from 'vitest'

import {fixtureConfig} from '../fixtures/cli-fixture-config.ts'
import {runCli} from './cli.ts'

/**
 * The runner through a real process. Output a command writes straight to `process.stdout` bypasses the
 * runner's sinks, so this is the parity authority for what a workflow step sees. These tests do not
 * run under Stryker: `cli.test.ts` kills the runner's mutants in process.
 */

const ENTRYPOINT = fileURLToPath(new URL('../fixtures/cli-fixture.ts', import.meta.url))
const ESC = String.fromCodePoint(27)

describe.each<Runtime>(['bun', 'node'])('the runner through a spawned process under %s', runtime => {
  const spawnFixture = async (shape: string, argv: readonly string[] = [], env: Record<string, string> = {}) =>
    spawnEntrypoint({entrypoint: ENTRYPOINT, argv, env: {FIXTURE_SHAPE: shape, ...env}, runtime})

  it('dispatch shape: no argv runs the root, `plan` runs the read-only command', async () => {
    expect(await spawnFixture('dispatch')).toEqual({exitCode: 0, stdout: 'dispatched\n', stderr: '', githubOutput: ''})
    expect(await spawnFixture('dispatch', ['plan'])).toEqual({
      exitCode: 0,
      stdout: 'planned\n',
      stderr: '',
      githubOutput: '',
    })
  })

  it.each([['pln'], ['--help'], ['plan', 'extra']])(
    'dispatch shape: argv %j is a usage error, stdout empty, nothing dispatched',
    async (...argv) => {
      const result = await spawnFixture('dispatch', argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage:')
    },
  )

  it('usage shape: no argv prints usage on stdout and exits 1, --help exits 0', async () => {
    const none = await spawnFixture('usage')
    expect(none.exitCode).toBe(1)
    expect(none.stdout).toContain('Usage:')
    expect(none.stderr).toBe('')
    const help = await spawnFixture('usage', ['--help'])
    expect(help).toMatchObject({exitCode: 0, stdout: none.stdout, stderr: ''})
    expect(await spawnFixture('usage', ['--branch', 'main'])).toMatchObject({exitCode: 0, stdout: 'branch=main\n'})
  })

  it('a refinement violation is a usage error with the message on stderr', async () => {
    const result = await spawnFixture('limit', ['--limit', '0'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('error: limit: ')
  })

  it('an action that exits 3 exits the process with 3', async () => {
    expect((await spawnFixture('exit-three')).exitCode).toBe(3)
  })

  it('a thrown action error exits 1 with the message on stderr and keeps what the step wrote to GITHUB_OUTPUT', async () => {
    const result = await spawnFixture('github-output')
    expect(result).toEqual({exitCode: 1, stdout: '', stderr: 'boom\n', githubOutput: 'scan_result=error\n'})
  })

  it('output written straight to process.stdout is invisible in process and visible to the spawn', async () => {
    const inProcess = await runCli(fixtureConfig('direct-write'), {argv: []})
    expect(inProcess).toEqual({exitCode: 0, stdout: '', stderr: ''})
    expect((await spawnFixture('direct-write')).stdout).toBe('direct\n')
  })

  it('delivers a 300 KB stdout payload whole when the process exits on its own', async () => {
    const result = await spawnFixture('payload')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toHaveLength(300_000)
  })

  it('control: process.exit(0) right after a 300 KB write loses part of it when stdout is a pipe', async () => {
    const result = await spawnFixture('exit-control')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeLessThan(300_000)
  })

  it('CI=true: help and a parse error carry no ANSI, because the runner sets NO_COLOR before goke loads', async () => {
    for (const argv of [['--help'], ['--bogus'], ['pln']]) {
      const result = await spawnFixture('dispatch', argv, {CI: 'true'})
      expect(`${result.stdout}${result.stderr}`).not.toContain(ESC)
    }
  })

  it('control: with goke loaded first and colour forced, goke itself emits ANSI', async () => {
    const result = await spawnFixture('dispatch', [], {
      FIXTURE_PRELOAD_GOKE: '1',
      FIXTURE_COLOUR_CONTROL: '1',
      FORCE_COLOR: '1',
    })
    expect(result.stdout).toContain(ESC)
  })

  it('goke already loaded with colour on: the sinks still strip ANSI from help and parse errors', async () => {
    for (const argv of [['--help'], ['--bogus'], ['pln']]) {
      const result = await spawnFixture('dispatch', argv, {FIXTURE_PRELOAD_GOKE: '1', FORCE_COLOR: '1'})
      expect(`${result.stdout}${result.stderr}`).not.toContain(ESC)
      expect(result.exitCode).toBe(1)
    }
  })
})
