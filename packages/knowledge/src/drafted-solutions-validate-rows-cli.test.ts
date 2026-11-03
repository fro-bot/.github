import {createHash} from 'node:crypto'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {runCli} from '@fro-bot/core/cli'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {draftedSolutionsValidateRowsCli, main} from './drafted-solutions-validate-rows-cli.ts'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drafted-solutions-validate-rows-cli-'))
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
    const config = draftedSolutionsValidateRowsCli()
    expect(config.name).toBe('drafted-solutions-validate-rows')
    expect(config.commands).toHaveLength(1)
    expect(config.commands[0]?.name).toBe('')
    expect(config.commands[0]?.readOnly).toBe(true)
    expect(config.commands[0]?.positionals).toEqual([])
    expect(config.commands[0]?.options).toEqual({})
  })

  it('builds a fresh object on every call', () => {
    expect(draftedSolutionsValidateRowsCli()).not.toBe(draftedSolutionsValidateRowsCli())
  })
})

const SHA = 'a'.repeat(40)

/** Writes a digest of the given proposals and a rows file into a fresh directory; returns the env that points at them. */
function files(issues: readonly number[], rows: unknown, directory = mkdtempSync(join(root, 'run-'))) {
  const bodyHash = (issue: number) => createHash('sha256').update(`Lesson ${issue}`).digest('hex')
  const digest = {
    version: 1,
    draftBaseSha: SHA,
    mainSha: SHA,
    proposals: issues.map(issue => ({
      issue,
      title: `Proposal ${issue}`,
      body: `Lesson ${issue}`,
      bodyHash: bodyHash(issue),
      mergeSha: SHA,
      createdAt: '2026-10-01T00:00:00Z',
    })),
    pr: {state: 'none'},
  }
  writeFileSync(join(directory, 'digest.json'), JSON.stringify(digest))
  writeFileSync(join(directory, 'rows.json'), typeof rows === 'string' ? rows : JSON.stringify(rows))
  return {
    DRAFTED_SOLUTIONS_DIGEST_PATH: join(directory, 'digest.json'),
    DRAFTED_SOLUTIONS_ROWS_PATH: join(directory, 'rows.json'),
  }
}

const unverified = (issue: number, extra: Record<string, unknown> = {}) => ({
  issue,
  outcome: 'unverified',
  targetDoc: null,
  sourceSha: SHA,
  evidence: [],
  droppedClaims: [],
  reason: 'No merged PR found.',
  ...extra,
})

describe('the strings the drafting agent reads', () => {
  it('valid rows: one summary line on stdout, nothing on stderr, exit 0', async () => {
    const env = files([1, 2], [unverified(1), unverified(2)])
    const result = await runCli(draftedSolutionsValidateRowsCli(), {argv: [], env})
    expect(result).toStrictEqual({exitCode: 0, stdout: 'rows valid: 2 row(s), one per digest proposal\n', stderr: ''})
  })

  it('invalid rows: one line per error, then the count line, on stderr; exit 1; nothing on stdout', async () => {
    const env = files([1, 2], [unverified(1, {sourceSha: 'zz'}), 'not-an-object'])
    const result = await runCli(draftedSolutionsValidateRowsCli(), {argv: [], env})
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      [
        'rows[1] must be an object with a numeric issue',
        'no evidence row for proposal #2',
        '#1: sourceSha must be a lowercase hex commit SHA',
        '3 error(s): fix rows.json and run this again.',
        '',
      ].join('\n'),
    )
  })

  it('reports an empty rows array against a digest with proposals', async () => {
    const result = await runCli(draftedSolutionsValidateRowsCli(), {argv: [], env: files([5], [])})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('no evidence row for proposal #5\n1 error(s): fix rows.json and run this again.\n')
  })

  it('accepts no rows for a digest with no proposals', async () => {
    const result = await runCli(draftedSolutionsValidateRowsCli(), {argv: [], env: files([], [])})
    expect(result).toStrictEqual({exitCode: 0, stdout: 'rows valid: 0 row(s), one per digest proposal\n', stderr: ''})
  })

  it('a rows file that is not an array is one error', async () => {
    const result = await runCli(draftedSolutionsValidateRowsCli(), {argv: [], env: files([1], '{"rows": []}')})
    expect(result.stderr).toBe(
      'rows file must be a JSON array of coverage rows\n1 error(s): fix rows.json and run this again.\n',
    )
  })

  it('an unreadable or non-JSON input prints its message alone and exits 1', async () => {
    const env = files([1], '{nope')
    const notJson = await runCli(draftedSolutionsValidateRowsCli(), {argv: [], env})
    expect(notJson).toStrictEqual({exitCode: 1, stdout: '', stderr: 'rows file is not valid JSON\n'})

    const missing = await runCli(draftedSolutionsValidateRowsCli(), {
      argv: [],
      env: {...env, DRAFTED_SOLUTIONS_ROWS_PATH: join(root, 'absent.json')},
    })
    expect(missing).toStrictEqual({
      exitCode: 1,
      stdout: '',
      stderr: `rows file could not be read at ${join(root, 'absent.json')}\n`,
    })

    const badDigest = await runCli(draftedSolutionsValidateRowsCli(), {
      argv: [],
      env: {...env, DRAFTED_SOLUTIONS_DIGEST_PATH: env.DRAFTED_SOLUTIONS_ROWS_PATH},
    })
    expect(badDigest.stderr).toBe('digest is not valid JSON\n')
    expect(badDigest.exitCode).toBe(1)
  })

  it('reads the default paths from the working directory when the variables are unset or empty', async () => {
    const result = await runCli(draftedSolutionsValidateRowsCli(), {
      argv: [],
      env: {DRAFTED_SOLUTIONS_ROWS_PATH: '', DRAFTED_SOLUTIONS_DIGEST_PATH: ''},
    })
    // The default digest is .drafted-solutions/drafted-solutions-digest.json under the cwd, which this checkout does not have.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('digest could not be read at .drafted-solutions/drafted-solutions-digest.json\n')
  })
})

describe('argv that no caller sends', () => {
  // Before the runner, any argument was ignored and the step ran.
  it.each([[['--help']], [['--help=false']], [['--bogus']], [['extra']], [['x', '--y']]])(
    '%j is a usage error: exit 1, usage on stderr, nothing runs',
    async argv => {
      const result = await runCli(draftedSolutionsValidateRowsCli(), {argv, env: files([1], [unverified(1)])})
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Usage')
      // Valid rows would have printed the summary; a usage error never reads them.
    },
  )
})

describe('main', () => {
  it('runs the CLI against process.argv and sets the exit code without exiting the process', async () => {
    const env = files([1], [unverified(1)])
    vi.stubEnv('DRAFTED_SOLUTIONS_DIGEST_PATH', env.DRAFTED_SOLUTIONS_DIGEST_PATH)
    vi.stubEnv('DRAFTED_SOLUTIONS_ROWS_PATH', env.DRAFTED_SOLUTIONS_ROWS_PATH)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const argv = process.argv
    process.argv = [argv[0] ?? 'node', '/x/drafted-solutions-validate-rows.ts']
    try {
      await main()
    } finally {
      process.argv = argv
    }
    expect(process.exitCode).toBe(0)
    expect(String(stdout.mock.calls[0]?.[0])).toBe('rows valid: 1 row(s), one per digest proposal\n')
    expect(exit).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
