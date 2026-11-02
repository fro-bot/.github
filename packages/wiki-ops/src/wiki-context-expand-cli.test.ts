import process from 'node:process'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {main} from './wiki-context-expand-cli.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
})

async function runMain(args: string[]): Promise<{stdout: string; stderr: string}> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const argv = process.argv
  process.argv = [argv[0] ?? 'node', '/x/wiki-context-expand.ts', ...args]
  try {
    await main()
  } finally {
    process.argv = argv
  }
  return {stdout: stdout.mock.calls.map(call => String(call[0])).join(''), stderr: stderr.mock.calls.map(call => String(call[0])).join('')}
}

describe('main (hand-parsed: the goke runner would read free text that starts with - as a flag)', () => {
  it('prints usage on stderr for --help and exits 0', async () => {
    const out = await runMain(['--help'])
    expect(out.stdout).toBe('')
    expect(out.stderr).toBe('Usage: wiki-context-expand <linked|query> [query text]\n')
    expect(process.exitCode).toBe(0)
  })

  it('reads query text that starts with a dash as the query, not a flag', async () => {
    const out = await runMain(['query', '--help'])
    expect(out.stderr).not.toContain('Usage:')
    expect(JSON.parse(out.stdout)).toMatchObject({mode: 'query'})
    expect(process.exitCode).toBe(0)
  })

  it('rejects an unknown mode with the bad-args result and exit 1, without exiting the process', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const out = await runMain(['frobnicate'])
    expect(out.stderr).toBe('wiki-context-expand:error:bad-args\n')
    expect(JSON.parse(out.stdout)).toEqual({
      status: 'empty',
      mode: 'query',
      selectedPaths: [],
      excerpt: '',
      byteLength: 0,
      pageCount: 0,
      reason: 'bad-args',
    })
    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
  })
})
