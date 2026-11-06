import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {gatewayAnnounceCli, main} from './gateway-announce-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

/** A fetch that records its calls and answers with `status`. Nothing in this file reaches a network. */
function stubFetch(status = 200) {
  const fetchSpy = vi.fn(async () => new Response('{}', {status}))
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

describe('the config', () => {
  it('is one root command that takes no argument and one option, and is not read-only because it POSTs', () => {
    const config = gatewayAnnounceCli()
    expect(config.name).toBe('gateway-announce')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(false)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(Object.keys(config.commands[0]?.options ?? {})).toEqual(['event'])
    expect(config.commands[0]?.options.event?.flag).toBe('--event <name>')
  })

  it('exits 0 for usage, help and a thrown error, so no outcome fails a step', () => {
    const config = gatewayAnnounceCli()
    expect(config.usageCode).toBe(0)
    expect(config.errorExitCode).toBe(0)
    expect(config.helpCode).toBeUndefined()
  })

  it('builds a fresh object on every call', () => {
    expect(gatewayAnnounceCli()).not.toBe(gatewayAnnounceCli())
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the POST went out. Now nothing is posted, and the exit
  // code stays 0 because an announce failure must never fail a workflow.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j prints usage on stderr, exits 0 and posts nothing',
    async argv => {
      const fetchSpy = stubFetch()
      const result = await runCli(gatewayAnnounceCli(), {
        argv,
        env: {
          EVENT_TYPE: 'daily_digest',
          EVENT_CONTEXT_JSON: '{}',
          GATEWAY_PRESENCE_URL: 'http://127.0.0.1:1/presence',
          GATEWAY_WEBHOOK_SECRET: 'secret',
        },
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )
})

describe('a run', () => {
  it.each([
    [
      'the kill switch',
      {GATEWAY_ANNOUNCE_DISABLED: 'true'},
      '{"posted":false,"skipped":"kill-switch"}\n',
      'kill switch active',
    ],
    [
      'a missing EVENT_TYPE',
      {EVENT_TYPE: undefined},
      '{"posted":false,"failure":"missing-event-type"}\n',
      'EVENT_TYPE not set',
    ],
    [
      'malformed context JSON',
      {EVENT_CONTEXT_JSON: '{'},
      '{"posted":false,"failure":"malformed-context"}\n',
      'malformed EVENT_CONTEXT_JSON',
    ],
  ])('exits 0 and prints the result for %s', async (_name, overrides, stdout, stderrPart) => {
    const fetchSpy = stubFetch()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runCli(gatewayAnnounceCli(), {
      argv: [],
      env: {
        EVENT_TYPE: 'daily_digest',
        EVENT_CONTEXT_JSON: '{}',
        GATEWAY_PRESENCE_URL: 'http://127.0.0.1:1/presence',
        GATEWAY_WEBHOOK_SECRET: 'secret',
        ...overrides,
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(stdout)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(stderrPart))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exits 0 on a non-2xx and prints the status', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const fetchSpy = stubFetch(404)
    const result = await runCli(gatewayAnnounceCli(), {
      argv: [],
      env: {
        EVENT_TYPE: 'daily_digest',
        EVENT_CONTEXT_JSON: '{"a":1}',
        GATEWAY_PRESENCE_URL: 'http://127.0.0.1:1/presence',
        GATEWAY_WEBHOOK_SECRET: 'secret',
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"posted":false,"failure":"http","status":404}\n')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('exits 0 when the run itself throws, with the message on stderr', async () => {
    const env = new Proxy(
      {},
      {
        get: () => {
          throw new Error('env is unreadable')
        },
      },
    )
    const result = await runCli(gatewayAnnounceCli(), {argv: [], env})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('env is unreadable\n')
  })
})

describe('--event', () => {
  const DIGEST_ENV = {
    REPOS_TRACKED: '14',
    SURVEYS_TODAY: '3',
    REPORT_URL: 'https://github.com/fro-bot/.github/issues/99',
    GATEWAY_PRESENCE_URL: 'http://127.0.0.1:1/presence',
    GATEWAY_WEBHOOK_SECRET: 'secret',
  }

  it.each([
    [['--event', 'bogus']],
    [['--event']],
    [['--event', 'daily_digest', '--event', 'survey_completed']],
    [['--event=']],
  ])('%j prints usage on stderr, exits 0 and posts nothing', async argv => {
    const fetchSpy = stubFetch()
    const result = await runCli(gatewayAnnounceCli(), {argv, env: DIGEST_ENV})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('builds the context from the env and POSTs the signed event once', async () => {
    const fetchSpy = stubFetch()
    const result = await runCli(gatewayAnnounceCli(), {argv: ['--event', 'daily_digest'], env: DIGEST_ENV})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"posted":true,"status":200}\n')
    expect(result.stderr).toBe('')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = (fetchSpy.mock.calls as unknown as [string, RequestInit][])[0]?.[1]
    const body: unknown = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      v: 1,
      event_type: 'daily_digest',
      context: {repos_tracked: 14, surveys_today: 3, report_url: 'https://github.com/fro-bot/.github/issues/99'},
    })
  })

  it('exits 0, prints the fixed line and a warning, and posts nothing for a context it cannot build', async () => {
    const fetchSpy = stubFetch()
    const result = await runCli(gatewayAnnounceCli(), {
      argv: ['--event', 'daily_digest'],
      env: {...DIGEST_ENV, REPOS_TRACKED: 'leaky-value'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"posted":false,"failure":"invalid-context"}\n')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exits 0 and posts nothing when EVENT_TYPE is also set', async () => {
    const fetchSpy = stubFetch()
    const result = await runCli(gatewayAnnounceCli(), {
      argv: ['--event', 'daily_digest'],
      env: {...DIGEST_ENV, EVENT_TYPE: 'daily_digest'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"posted":false,"failure":"conflicting-input"}\n')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('exits 0 and posts nothing on the kill switch, before the context is validated', async () => {
    const fetchSpy = stubFetch()
    const result = await runCli(gatewayAnnounceCli(), {
      argv: ['--event', 'daily_digest'],
      env: {GATEWAY_ANNOUNCE_DISABLED: 'true', REPOS_TRACKED: 'leaky-value'},
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"posted":false,"skipped":"kill-switch"}\n')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('main', () => {
  it('runs the CLI against process.argv and sets exit code 0 without exiting the process', async () => {
    vi.stubEnv('GATEWAY_ANNOUNCE_DISABLED', 'true')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/gateway-announce.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toBe('{"posted":false,"skipped":"kill-switch"}\n')
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
