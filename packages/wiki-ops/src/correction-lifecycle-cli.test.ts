import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {main} from './correction-lifecycle-cli.ts'

/**
 * `record` writes `knowledge/corrections.yaml` under the repository root found from the working directory,
 * so every test runs in a test-owned temp checkout the process has changed into. A guard that regressed,
 * or a mutant, would write there and never into the tracked tree.
 */
const STORE = 'version: 1\ncorrections: []\n'
let originalCwd = ''
let tempCwd = ''

beforeEach(() => {
  originalCwd = process.cwd()
  tempCwd = mkdtempSync(join(tmpdir(), 'correction-lifecycle-cli-'))
  mkdirSync(join(tempCwd, 'knowledge'), {recursive: true})
  writeFileSync(join(tempCwd, 'package.json'), '{"name":"fixture","private":true}\n')
  writeFileSync(join(tempCwd, 'knowledge/corrections.yaml'), STORE)
  process.chdir(tempCwd)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(tempCwd, {recursive: true, force: true})
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

function expectStoreUntouched(): void {
  expect(process.cwd()).toBe(realpathSync(tempCwd))
  expect(readFileSync(join(tempCwd, 'knowledge/corrections.yaml'), 'utf8')).toBe(STORE)
}

async function runMain(args: string[]): Promise<{stdout: string; stderr: string}> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const argv = process.argv
  process.argv = [argv[0] ?? 'node', '/x/correction-lifecycle.ts', ...args]
  try {
    await main()
  } finally {
    process.argv = argv
  }
  return {
    stdout: stdout.mock.calls.map(call => String(call[0])).join(''),
    stderr: stderr.mock.calls.map(call => String(call[0])).join(''),
  }
}

// Hand-parsed: `record ... --text --help` must be a value error, which a goke flag parse cannot tell from a help request.
describe('main', () => {
  it('prints the machine-readable help for --help and sets exit code 0', async () => {
    const out = await runMain(['--help'])
    expect(out.stderr).toBe('')
    expect(JSON.parse(out.stdout)).toMatchObject({ok: true, command: 'help'})
    expect(process.exitCode).toBe(0)
  })

  it('prints the per-command help for `record --help`', async () => {
    const out = await runMain(['record', '--help'])
    expect(JSON.parse(out.stdout)).toMatchObject({
      ok: true,
      command: 'record',
      required: ['--id', '--node-id', '--text'],
    })
    expect(process.exitCode).toBe(0)
  })

  it('treats `record --text --help` as a value error, not a help request', async () => {
    const out = await runMain(['record', '--id', 'x', '--node-id', 'n', '--text', '--help'])
    expect(out.stdout).toBe('')
    expect(JSON.parse(out.stderr)).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
    expect(process.exitCode).toBe(1)
    expectStoreUntouched()
  })

  it('records into the temp checkout store when the arguments are valid, which proves the checks around it would see a write', async () => {
    vi.stubEnv('GITHUB_ACTOR', 'octocat')
    const out = await runMain([
      'record',
      '--id',
      '11111111-2222-3333-4444-555555555555',
      '--node-id',
      'R_1',
      '--text',
      'a fact',
    ])
    expect(JSON.parse(out.stdout)).toMatchObject({ok: true, command: 'record'})
    expect(process.exitCode).toBe(0)
    expect(readFileSync(join(tempCwd, 'knowledge/corrections.yaml'), 'utf8')).toContain('a fact')
  })

  it('reports a missing command as INVALID_ARGUMENT with exit code 1, without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const out = await runMain([])
    expect(JSON.parse(out.stderr)).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
    expectStoreUntouched()
    expect(existsSync(join(tempCwd, 'knowledge/corrections.yaml'))).toBe(true)
  })
})
