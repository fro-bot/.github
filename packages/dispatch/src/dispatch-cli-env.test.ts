/**
 * `cross-repo-dispatch` reads the env the runner hands its action, not `process.env`: the repository, the
 * control token, the target-token map, the event and result paths and the approval label. Each test sets
 * conflicting ambient values and supplies its own; only the supplied ones may be used.
 */

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {crossRepoDispatchCli} from './dispatch-cli.ts'

interface IssueCall {
  readonly owner: string
  readonly repo: string
  readonly issue_number?: number
  readonly name?: string
}

const recorded = vi.hoisted(() => ({
  constructed: [] as {auth?: string; request?: {timeout?: number}}[],
  listComments: [] as unknown[],
  listForRepo: [] as unknown[],
  removeLabel: [] as unknown[],
}))

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    readonly rest: unknown
    constructor(options: {auth?: string; request?: {timeout?: number}}) {
      recorded.constructed.push(options)
      this.rest = {
        issues: {
          listComments: async (params: unknown) => {
            recorded.listComments.push(params)
            return {data: []}
          },
          listForRepo: async (params: unknown) => {
            recorded.listForRepo.push(params)
            return {data: []}
          },
          removeLabel: async (params: unknown) => {
            recorded.removeLabel.push(params)
            return {data: []}
          },
        },
        actions: {},
      }
    }
  },
}))

const AMBIENT = {
  GITHUB_REPOSITORY: 'ambient-owner/ambient-repo',
  GITHUB_TOKEN: 'ambient-token',
  CROSS_REPO_DISPATCH_TARGET_TOKENS: JSON.stringify({'ambient-owner': 'ambient-target'}),
  CROSS_REPO_DISPATCH_APPROVE_LABEL: 'ambient-label',
} as const

let directory = ''
let stderrWritten: string[] = []

function event(issue: number, label: string, sender: string): string {
  return JSON.stringify({label: {name: label}, sender: {login: sender}, issue: {number: issue}})
}

function suppliedEnv(extra: Readonly<Record<string, string | undefined>> = {}) {
  return {
    GITHUB_REPOSITORY: 'supplied-owner/supplied-repo',
    GITHUB_TOKEN: 'supplied-token',
    GITHUB_EVENT_PATH: join(directory, 'supplied-event.json'),
    CROSS_REPO_DISPATCH_RESULT_PATH: join(directory, 'supplied-result.json'),
    CROSS_REPO_DISPATCH_TARGET_TOKENS: JSON.stringify({'fro-bot': 'supplied-target'}),
    CROSS_REPO_DISPATCH_APPROVE_LABEL: 'supplied-label',
    ...extra,
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dispatch-cli-env-'))
  mkdirSync(directory, {recursive: true})
  // A supplied event the approver applied the supplied label on, and an ambient one that would be refused.
  writeFileSync(join(directory, 'supplied-event.json'), event(7, 'supplied-label', 'marcusrbrown'))
  writeFileSync(join(directory, 'ambient-event.json'), event(999, 'ambient-label', 'someone'))
  for (const [name, value] of Object.entries(AMBIENT)) vi.stubEnv(name, value)
  vi.stubEnv('GITHUB_EVENT_PATH', join(directory, 'ambient-event.json'))
  vi.stubEnv('CROSS_REPO_DISPATCH_RESULT_PATH', join(directory, 'ambient-result.json'))
  recorded.constructed.length = 0
  recorded.listComments.length = 0
  recorded.listForRepo.length = 0
  recorded.removeLabel.length = 0
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrWritten = []
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    stderrWritten.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(directory, {recursive: true, force: true})
  process.exitCode = undefined
})

describe('dispatch uses only the supplied env', () => {
  it('reads the repository, token, target tokens, event, label and result path from the supplied env', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['dispatch'], env: suppliedEnv()})

    expect(result.exitCode).toBe(0)
    // The control client and one client per distinct target token, all from the supplied values.
    expect(recorded.constructed.map(options => options.auth)).toStrictEqual(['supplied-token', 'supplied-target'])
    // The supplied event (issue 7, an approver applying the supplied label) is read, so the run is not refused
    // and it lists the comments of the supplied repository.
    expect(recorded.removeLabel).toStrictEqual([])
    expect(recorded.listComments as IssueCall[]).toStrictEqual([
      {owner: 'supplied-owner', repo: 'supplied-repo', issue_number: 7},
    ])
    // The result goes to the supplied path, not the ambient one.
    expect(existsSync(join(directory, 'ambient-result.json'))).toBe(false)
    const written = readFileSync(join(directory, 'supplied-result.json'), 'utf8')
    expect(JSON.parse(written)).toMatchObject({counts: {refused: 0, dispatched: 0}})
  })

  it('refuses by the supplied approval label, using the supplied event and repository', async () => {
    writeFileSync(join(directory, 'supplied-event.json'), event(7, 'supplied-label', 'someone'))

    const result = await runCli(crossRepoDispatchCli(), {argv: ['dispatch'], env: suppliedEnv()})

    expect(result.exitCode).toBe(0)
    expect(recorded.removeLabel as IssueCall[]).toStrictEqual([
      {owner: 'supplied-owner', repo: 'supplied-repo', issue_number: 7, name: 'supplied-label'},
    ])
    expect(JSON.parse(readFileSync(join(directory, 'supplied-result.json'), 'utf8'))).toMatchObject({
      counts: {refused: 1},
    })
  })

  it('defaults the approval label itself when the supplied env has none, not from the ambient one', async () => {
    writeFileSync(join(directory, 'supplied-event.json'), event(7, 'dispatch-approved', 'marcusrbrown'))

    await runCli(crossRepoDispatchCli(), {
      argv: ['dispatch'],
      env: suppliedEnv({CROSS_REPO_DISPATCH_APPROVE_LABEL: undefined}),
    })

    expect(recorded.removeLabel).toStrictEqual([])
    expect(recorded.listComments).toHaveLength(1)
  })

  it('does not fall back to the ambient event path when the supplied env has none', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['dispatch'], env: {}})

    expect(result.exitCode).toBe(1)
    expect(recorded.constructed).toStrictEqual([])
    expect(stderrWritten.join('')).toBe('cross-repo-dispatch: GITHUB_EVENT_PATH is required for dispatch mode\n')
    expect(existsSync(join(directory, 'ambient-result.json'))).toBe(false)
  })

  it('does not fall back to the ambient repository', async () => {
    const result = await runCli(crossRepoDispatchCli(), {
      argv: ['dispatch'],
      env: suppliedEnv({GITHUB_REPOSITORY: 'not-a-repository'}),
    })

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: 'cross-repo-dispatch: GITHUB_REPOSITORY must be in owner/repo format\n',
    })
    expect(recorded.constructed).toStrictEqual([])
  })

  it('does not fall back to the ambient token', async () => {
    const result = await runCli(crossRepoDispatchCli(), {
      argv: ['dispatch'],
      env: suppliedEnv({GITHUB_TOKEN: undefined}),
    })

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: 'cross-repo-dispatch: GITHUB_TOKEN is required in the environment\n',
    })
    expect(recorded.constructed).toStrictEqual([])
  })

  it('does not fall back to the ambient target-token map: an absent one builds no target client', async () => {
    await runCli(crossRepoDispatchCli(), {
      argv: ['dispatch'],
      env: suppliedEnv({CROSS_REPO_DISPATCH_TARGET_TOKENS: undefined}),
    })

    expect(recorded.constructed.map(options => options.auth)).toStrictEqual(['supplied-token'])
  })

  it('writes no result file when the supplied env names none, whatever the ambient env names', async () => {
    await runCli(crossRepoDispatchCli(), {
      argv: ['dispatch'],
      env: suppliedEnv({CROSS_REPO_DISPATCH_RESULT_PATH: undefined}),
    })

    expect(existsSync(join(directory, 'ambient-result.json'))).toBe(false)
    expect(existsSync(join(directory, 'supplied-result.json'))).toBe(false)
  })
})

describe('track uses only the supplied env', () => {
  it('reads the repository, token, target tokens and result path from the supplied env', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['track'], env: suppliedEnv()})

    expect(result.exitCode).toBe(0)
    expect(recorded.constructed.map(options => options.auth)).toStrictEqual(['supplied-token', 'supplied-target'])
    expect(recorded.listForRepo as IssueCall[]).toHaveLength(1)
    expect((recorded.listForRepo as IssueCall[])[0]).toMatchObject({owner: 'supplied-owner', repo: 'supplied-repo'})
    expect(existsSync(join(directory, 'ambient-result.json'))).toBe(false)
    expect(JSON.parse(readFileSync(join(directory, 'supplied-result.json'), 'utf8'))).toMatchObject({
      counts: {goalsProcessed: 0},
    })
  })

  it('does not fall back to the ambient repository', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['track'], env: suppliedEnv({GITHUB_REPOSITORY: ''})})

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: 'cross-repo-dispatch: GITHUB_REPOSITORY must be in owner/repo format\n',
    })
    expect(recorded.constructed).toStrictEqual([])
  })

  it('does not fall back to the ambient token', async () => {
    const result = await runCli(crossRepoDispatchCli(), {argv: ['track'], env: suppliedEnv({GITHUB_TOKEN: undefined})})

    expect(result).toMatchObject({
      exitCode: 1,
      stderr: 'cross-repo-dispatch: GITHUB_TOKEN is required in the environment\n',
    })
    expect(recorded.constructed).toStrictEqual([])
  })

  it('does not fall back to the ambient target-token map or result path', async () => {
    await runCli(crossRepoDispatchCli(), {
      argv: ['track'],
      env: suppliedEnv({CROSS_REPO_DISPATCH_TARGET_TOKENS: undefined, CROSS_REPO_DISPATCH_RESULT_PATH: undefined}),
    })

    expect(recorded.constructed.map(options => options.auth)).toStrictEqual(['supplied-token'])
    expect(existsSync(join(directory, 'ambient-result.json'))).toBe(false)
    expect(existsSync(join(directory, 'supplied-result.json'))).toBe(false)
  })
})
