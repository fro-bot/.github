import process from 'node:process'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main} from './correction-lifecycle-cli.ts'

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

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
  })

  it('reports a missing command as INVALID_ARGUMENT with exit code 1, without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const out = await runMain([])
    expect(JSON.parse(out.stderr)).toMatchObject({ok: false, error: {code: 'INVALID_ARGUMENT'}})
    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
  })
})
