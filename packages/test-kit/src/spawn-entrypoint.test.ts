import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {spawnEntrypoint, type Runtime} from './spawn-entrypoint.ts'

let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'spawn-entrypoint-test-'))
})

afterAll(async () => {
  await rm(directory, {recursive: true, force: true})
})

async function script(name: string, body: string): Promise<string> {
  const path = join(directory, name)
  await writeFile(path, body, 'utf8')
  return path
}

describe.each<Runtime>(['bun', 'node'])('spawnEntrypoint under %s', runtime => {
  it('returns the exit code, stdout and stderr of the child', async () => {
    const entrypoint = await script(
      `report-${runtime}.ts`,
      String.raw`process.stdout.write('out:' + process.argv.slice(2).join(',') + '\n')
process.stderr.write('err:' + (process.env.FIXTURE_VALUE ?? 'unset') + '\n')
process.exitCode = 7
`,
    )
    const result = await spawnEntrypoint({entrypoint, argv: ['a', 'b'], env: {FIXTURE_VALUE: 'v'}, runtime})
    expect(result).toEqual({exitCode: 7, stdout: 'out:a,b\n', stderr: 'err:v\n', githubOutput: ''})
  })

  it('points GITHUB_OUTPUT at a file and returns what the child wrote to it', async () => {
    const entrypoint = await script(
      `output-${runtime}.ts`,
      String.raw`import {appendFileSync} from 'node:fs'
appendFileSync(process.env.GITHUB_OUTPUT ?? '', 'scan_result=error\n')
`,
    )
    const result = await spawnEntrypoint({entrypoint, runtime})
    expect(result.exitCode).toBe(0)
    expect(result.githubOutput).toBe('scan_result=error\n')
  })

  it('does not pass the caller shell environment through, and lets env remove a variable', async () => {
    process.env.SPAWN_ENTRYPOINT_LEAK = 'leaked'
    const entrypoint = await script(
      `env-${runtime}.ts`,
      `process.stdout.write(JSON.stringify({leak: process.env.SPAWN_ENTRYPOINT_LEAK ?? null, home: process.env.HOME !== undefined, removed: process.env.REMOVED ?? null}))
`,
    )
    try {
      const result = await spawnEntrypoint({entrypoint, runtime, env: {REMOVED: undefined}})
      expect(JSON.parse(result.stdout)).toEqual({leak: null, home: true, removed: null})
    } finally {
      delete process.env.SPAWN_ENTRYPOINT_LEAK
    }
  })

  it('runs in the given working directory', async () => {
    const entrypoint = await script(`cwd-${runtime}.ts`, `process.stdout.write(process.cwd())`)
    const result = await spawnEntrypoint({entrypoint, runtime, cwd: directory})
    expect(result.stdout.endsWith(directory.split('/').at(-1) ?? '')).toBe(true)
  })

  it('returns a failing child as a result, not an error', async () => {
    const entrypoint = await script(`throws-${runtime}.ts`, `throw new Error('boom')`)
    const result = await spawnEntrypoint({entrypoint, runtime})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('boom')
  })

  it('collects a 300 KB stdout payload whole', async () => {
    const entrypoint = await script(`payload-${runtime}.ts`, `process.stdout.write('x'.repeat(300_000))`)
    const result = await spawnEntrypoint({entrypoint, runtime})
    expect(result.stdout).toHaveLength(300_000)
  })

  it('kills a child that outlives the timeout and rejects', async () => {
    const entrypoint = await script(`hang-${runtime}.ts`, `setInterval(() => {}, 1000)`)
    await expect(spawnEntrypoint({entrypoint, runtime, timeoutMs: 300})).rejects.toThrow('did not exit within 300 ms')
  })
})

describe('spawnEntrypoint', () => {
  it('defaults to bun', async () => {
    const entrypoint = await script('runtime.ts', `process.stdout.write(typeof Bun === 'undefined' ? 'node' : 'bun')`)
    expect((await spawnEntrypoint({entrypoint})).stdout).toBe('bun')
    expect((await spawnEntrypoint({entrypoint, runtime: 'node'})).stdout).toBe('node')
  })

  it('rejects when the runtime cannot start', async () => {
    const entrypoint = await script('missing-path.ts', `process.exitCode = 0`)
    await expect(spawnEntrypoint({entrypoint, env: {PATH: '/nonexistent'}})).rejects.toThrow()
  })
})
