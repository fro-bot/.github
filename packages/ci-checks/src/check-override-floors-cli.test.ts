import type {AuditRunResult} from './check-override-floors.ts'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {checkOverrideFloorsCli, main} from './check-override-floors-cli.ts'

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

function audit(advisories: Record<string, unknown>): {runAudit: () => AuditRunResult} {
  return {runAudit: () => ({ok: true, advisories})}
}

const record = (severity: string) => ({
  id: 7,
  severity,
  vulnerable_versions: '<1.0.0',
  url: 'https://example.invalid/7',
})

describe('the config', () => {
  it('is one read-only root command with no positional and no option', () => {
    const config = checkOverrideFloorsCli()
    expect(config.name).toBe('check-override-floors')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(checkOverrideFloorsCli()).not.toBe(checkOverrideFloorsCli())
  })
})

// The agent prompt in fro-bot.yaml acts on the exit code alone: 0 means the lockfile is clean.
describe('the exit code the lint chain and the agent prompt read', () => {
  it.each(['high', 'critical'])('exits 1 on a %s advisory and names it on stderr', async severity => {
    const result = await runCli(checkOverrideFloorsCli(audit({'left-pad': [record(severity)]})), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      `check-override-floors: left-pad: advisory 7 (${severity.toUpperCase()}) affects an installed version in vulnerable range "<1.0.0"; advisory: https://example.invalid/7\n`,
    )
  })

  it.each([
    ['clean', {}],
    ['moderate, low and info only', {a: [record('moderate'), record('low'), record('info')]}],
  ])('exits 0 with no output for a %s audit', async (_name, advisories) => {
    const result = await runCli(checkOverrideFloorsCli(audit(advisories)), {argv: [], env: {}})
    expect(result).toEqual({exitCode: 0, stdout: '', stderr: ''})
  })

  it('exits 1 when the audit could not be run or parsed', async () => {
    const result = await runCli(
      checkOverrideFloorsCli({runAudit: () => ({ok: false, reason: 'bun audit output did not parse as JSON: x'})}),
      {argv: [], env: {}},
    )
    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'check-override-floors: bun audit output did not parse as JSON: x\n',
    })
  })

  it('exits 1 on an advisory it cannot interpret', async () => {
    const result = await runCli(checkOverrideFloorsCli(audit({a: [record('catastrophic')]})), {argv: [], env: {}})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('check-override-floors: a: advisory 7 has an unrecognized severity "catastrophic"\n')
  })
})

describe('argv that no caller sends', () => {
  // Before the runner these were ignored and the audit ran.
  it.each([[['--help']], [['--help=false']], [['-h']], [['--bogus']], [['stray']], [['--', 'x']]])(
    '%j is a usage error: exit 1, usage on stderr, no audit',
    async argv => {
      const runAudit = vi.fn<() => AuditRunResult>(() => ({ok: true, advisories: {}}))
      const result = await runCli(checkOverrideFloorsCli({runAudit}), {argv, env: {}})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(runAudit).not.toHaveBeenCalled()
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/check-override-floors.ts']
    try {
      await main(audit({a: [record('high')]}))
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(1)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('check-override-floors: a: advisory 7 (HIGH)')
    expect(exit).not.toHaveBeenCalled()
  })
})
