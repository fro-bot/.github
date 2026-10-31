import {fileURLToPath} from 'node:url'
import {spawnEntrypoint, type Runtime} from '@fro-bot/test-kit/spawn-entrypoint'
import {describe, expect, it} from 'vitest'

/**
 * Hostile argv through the runner, one child process per case. goke writes a dotted option name into
 * nested objects, and a path through an inherited property reaches a built-in prototype, so a
 * regression here would poison whatever process runs it. The probe reports whether any built-in
 * changed; these tests do not run under Stryker, `cli.test.ts` kills the rejection's mutants.
 */

const PROBE = fileURLToPath(new URL('../fixtures/pollution-probe.ts', import.meta.url))

interface ProbeReport {
  readonly outcome: {readonly exitCode: number; readonly stdout: string; readonly stderr: string}
  readonly ran: boolean
  readonly changed: readonly string[]
  readonly toString: string
  readonly map: readonly number[] | string
}

async function probe(runtime: Runtime, argv: readonly string[], stream: 'stdout' | 'stderr' = 'stderr') {
  const result = await spawnEntrypoint({
    entrypoint: PROBE,
    runtime,
    env: {PROBE_ARGV: JSON.stringify(argv), PROBE_STREAM: stream},
  })
  expect(result.stderr).toBe('')
  return JSON.parse(result.stdout) as ProbeReport
}

const HOSTILE: readonly (readonly string[])[] = [
  ['--toString.call=attacker'],
  ['--toString.call', 'attacker'],
  ['--a.0=x', '--a.map.call=attacker'],
  ['--__proto__.x=y'],
  ['--no-a.b'],
  ['--constructor.prototype.reviewProbe=attacker'],
  ['--a.__proto__.reviewProbe', 'attacker'],
  ['--hasOwnProperty.call=attacker'],
  ['--valueOf.x=attacker'],
  ['--flag', '--a.b=c'],
]

/** A bare `__proto__` is no dotted name, and goke's `__proto__` setter swallows it before any option check. */
const PROTO_NAMES: readonly (readonly string[])[] = [
  ['--__proto__'],
  ['--__proto__=attacker'],
  ['--__proto__='],
  ['--__proto__', 'attacker'],
  ['--no-__proto__'],
  ['--no-__proto__=attacker'],
  ['-__proto__'],
  ['---__proto__=attacker'],
  ['--flag', '--__proto__'],
]

describe.each<Runtime>(['bun', 'node'])('hostile option names under %s', runtime => {
  it.each(HOSTILE)('%j: usage error, no action, no built-in touched', async (...argv) => {
    const report = await probe(runtime, argv)
    expect(report.outcome).toMatchObject({exitCode: 64, stdout: ''})
    expect(report.outcome.stderr).toMatch(/^error: unsupported dotted option name `-[^`]+`\n/u)
    expect(report.outcome.stderr).toContain('Usage:')
    expect(report.ran).toBe(false)
    expect(report.changed).toEqual([])
    expect(report.toString).toBe('[object Object]')
    expect(report.map).toEqual([1])
  })

  it.each(PROTO_NAMES)('%j: usage error, no action, no built-in touched', async (...argv) => {
    const report = await probe(runtime, argv)
    expect(report.outcome).toMatchObject({exitCode: 64, stdout: ''})
    expect(report.outcome.stderr).toMatch(/^error: unsupported option name `-+(?:no-)?__proto__`\n/u)
    expect(report.outcome.stderr).not.toContain('attacker')
    expect(report.ran).toBe(false)
    expect(report.changed).toEqual([])
    expect(report.toString).toBe('[object Object]')
    expect(report.map).toEqual([1])
  })

  it('writes the usage error to the usage stream, with the exit code of the CLI', async () => {
    const report = await probe(runtime, ['--toString.call=attacker'], 'stdout')
    expect(report.outcome).toMatchObject({
      exitCode: 64,
      stderr: 'error: unsupported dotted option name `--toString.call`\n',
    })
    expect(report.outcome.stdout).toContain('Usage:')
    expect(report.changed).toEqual([])
  })

  it('the probe itself reports a change when a built-in is modified', async () => {
    // A control for the assertions above: the same probe, with a built-in mutated on purpose, must say so.
    const result = await spawnEntrypoint({
      entrypoint: PROBE,
      runtime,
      env: {PROBE_ARGV: '[]', PROBE_CONTROL_MUTATE: '1'},
    })
    expect((JSON.parse(result.stdout) as ProbeReport).changed).toEqual(['Object.prototype.toString.call'])
  })
})
