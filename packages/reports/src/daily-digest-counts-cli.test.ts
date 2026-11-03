import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {dailyDigestCountsCli, main} from './daily-digest-counts-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'daily-digest-counts-cli-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** Three public repos surveyed on 2026-05-09, 2026-05-10 and 2026-05-10 again, and one private repo surveyed on the 10th. */
const REPOS = `repos:
  - {private: false, last_survey_at: 2026-05-09}
  - {private: false, last_survey_at: 2026-05-10}
  - {private: false, last_survey_at: 2026-05-10}
  - {private: true, last_survey_at: 2026-05-10}
`

function reposFile(name: string, text = REPOS): string {
  const path = join(root, name)
  writeFileSync(path, text)
  return path
}

async function run(argv: readonly string[], env: Record<string, string | undefined> = {}) {
  return runCli(dailyDigestCountsCli(), {argv, env})
}

describe('the config', () => {
  it('is one read-only root command with two optional positionals, the path then the date, and no option', () => {
    const config = dailyDigestCountsCli()
    expect(config.name).toBe('daily-digest-counts')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([
      {name: 'path', kind: 'optional'},
      {name: 'date', kind: 'optional'},
    ])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(dailyDigestCountsCli()).not.toBe(dailyDigestCountsCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, a third argument, a flag or --help was read as a path and the step printed error counts.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['a.yaml', '2026-05-11', 'extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, no counts',
    async argv => {
      const result = await run(argv)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
    },
  )
})

describe('a run', () => {
  it('counts public repos and the surveys of the day before the date argument, as one JSON line', async () => {
    const result = await run([reposFile('repos.yaml'), '2026-05-11'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('{"repos_tracked":3,"surveys_today":2,"should_post":true,"count_status":"ok"}\n')
  })

  it('takes the date from the second argument before TODAY_UTC', async () => {
    const path = reposFile('precedence.yaml')
    const argvWins = await run([path, '2026-05-11'], {TODAY_UTC: '2026-05-10'})
    expect(JSON.parse(argvWins.stdout)).toMatchObject({surveys_today: 2})
    // Only the env date is 2026-05-10, so yesterday is the 9th and one survey counts.
    const envOnly = await run([path], {TODAY_UTC: '2026-05-10'})
    expect(JSON.parse(envOnly.stdout)).toMatchObject({surveys_today: 1})
  })

  it('takes the date from the clock when neither the argument nor TODAY_UTC is set', async () => {
    vi.useFakeTimers({toFake: ['Date']})
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'))
    const result = await run([reposFile('clock.yaml')])
    expect(JSON.parse(result.stdout)).toMatchObject({surveys_today: 2, count_status: 'ok'})
  })

  it('reports an unreadable file as count_status error on stdout and a daily-digest-counts line on stderr, exit 0', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await run([join(root, 'absent.yaml'), '2026-05-11'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"repos_tracked":0,"surveys_today":0,"should_post":false,"count_status":"error"}\n')
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^daily-digest-counts: failed to read /u))
  })

  it('reports a malformed repos[] element as count_status error on stderr, and does not throw', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await run([reposFile('malformed.yaml', 'repos:\n  - null\n'), '2026-05-11'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({count_status: 'error', should_post: false})
    expect(stderr).toHaveBeenCalledWith('daily-digest-counts: malformed repos[] element (null, non-object, or array)\n')
  })

  it('reports an invalid date as count_status error', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await run([reposFile('baddate.yaml'), 'not-a-date'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({count_status: 'error'})
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('daily-digest-counts: unexpected error in deriveCounts'),
    )
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    const path = reposFile('main.yaml')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/daily-digest-counts.ts', path, '2026-05-11']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toBe(
      '{"repos_tracked":3,"surveys_today":2,"should_post":true,"count_status":"ok"}\n',
    )
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
  })
})
