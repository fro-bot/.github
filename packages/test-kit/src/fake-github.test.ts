import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'
import {createFakeGithub, fakeGithubPreloadPath, parseCall, route, type FakeGithub} from './fake-github.ts'
import {spawnEntrypoint, type Runtime} from './spawn-entrypoint.ts'

let scratch = ''
let fake: FakeGithub | undefined

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'fake-github-test-'))
})

afterAll(() => {
  rmSync(scratch, {recursive: true, force: true})
})

afterEach(() => {
  fake?.cleanup()
  fake = undefined
})

/** A script that makes the requests in `requests` through `fetch` and prints each status and body. */
async function run(requests: string, runtime: Runtime = 'bun') {
  const github = fake ?? createFakeGithub()
  fake = github
  const entrypoint = join(scratch, `requests-${runtime}-${String(Math.random()).slice(2)}.ts`)
  writeFileSync(
    entrypoint,
    `const out: unknown[] = []
${requests}
process.stdout.write(JSON.stringify(out))
`,
  )
  const result = await spawnEntrypoint({
    entrypoint,
    runtime,
    runtimeArgs: github.runtimeArgs(runtime),
    env: {FAKE_GH_DIR: github.directory},
  })
  return {result, github}
}

describe('createFakeGithub', () => {
  it.each(['bun', 'node'] as const)('answers a matching route and logs the call under %s', async runtime => {
    fake = createFakeGithub([route('GET', '/repos/o/r', {b: {name: 'r'}})])
    const {result, github} = await run(
      `const response = await fetch('https://api.github.com/repos/o/r?per_page=100&x=1', {headers: {authorization: 'token tok'}})
out.push(response.status, await response.json())`,
      runtime,
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([200, {name: 'r'}])
    expect(github.calls()).toEqual(['GET /repos/o/r?x=1 auth=tok'])
  })

  it('answers an unmatched request 404 and marks it UNHANDLED', async () => {
    const {result, github} = await run(
      `const response = await fetch('https://api.github.com/nope', {method: 'POST', body: '{"b":1,"a":2}'})
out.push(response.status)`,
    )
    expect(JSON.parse(result.stdout)).toEqual([404])
    expect(github.calls()).toEqual(['UNHANDLED POST /nope auth=- body={"a":2,"b":1}'])
  })

  it('counts an unmatched write in requests() and unhandledMutations(), which a prefix match on calls() misses', async () => {
    const {github} = await run(
      `await fetch('https://api.github.com/repos/o/r/contents/f', {method: 'PUT', body: '{}'})
await fetch('https://api.github.com/repos/o/r/actions/workflows/w/dispatches', {method: 'POST', body: '{}'})
await fetch('https://api.github.com/repos/o/r', {method: 'PATCH', body: '{}'})
await fetch('https://api.github.com/repos/o/r/labels/x', {method: 'DELETE'})
await fetch('https://api.github.com/repos/o/r')`,
    )
    // The raw log carries the marker, so a `PUT /repos` prefix match finds none of the four.
    expect(github.calls().filter(call => call.startsWith('PUT /repos'))).toEqual([])
    expect(github.requests().map(request => `${request.method} ${request.handled ? 'handled' : 'unhandled'}`)).toEqual([
      'PUT unhandled',
      'POST unhandled',
      'PATCH unhandled',
      'DELETE unhandled',
      'GET unhandled',
    ])
    expect(github.requests().filter(request => request.line.startsWith('PUT /repos'))).toHaveLength(1)
    expect(github.unhandledMutations().map(request => request.method)).toEqual(['PUT', 'POST', 'PATCH', 'DELETE'])
  })

  it('does not count a matched write or an unmatched read as an unhandled mutation', async () => {
    fake = createFakeGithub([route('PUT', '/repos/o/r/contents/f', {b: {}})])
    const {github} = await run(
      `await fetch('https://api.github.com/repos/o/r/contents/f', {method: 'PUT', body: '{}'})
await fetch('https://api.github.com/missing')`,
    )
    expect(github.requests().map(request => request.handled)).toEqual([true, false])
    expect(github.unhandledMutations()).toEqual([])
  })

  it('matches a regex route, a query filter and a method, and steps through a seq', async () => {
    fake = createFakeGithub([
      route('GET', '~^/repos/o/[^/]+/issues$', {q: 'state=open', seq: [{s: 500, b: {message: 'boom'}}, {b: [1]}]}),
    ])
    const {result} = await run(
      `const url = 'https://api.github.com/repos/o/x/issues?state=open'
out.push((await fetch(url)).status, (await fetch(url)).status, (await fetch(url)).status)
out.push((await fetch('https://api.github.com/repos/o/x/issues?state=closed')).status)
out.push((await fetch(url, {method: 'DELETE'})).status)`,
    )
    expect(JSON.parse(result.stdout)).toEqual([500, 200, 200, 404, 404])
  })

  it('sends a 204 with no body and decodes a contents write in the log', async () => {
    fake = createFakeGithub([route('PUT', '/repos/o/r/contents/f', {s: 204, b: {ignored: true}})])
    const {result, github} = await run(
      `const response = await fetch('https://api.github.com/repos/o/r/contents/f', {method: 'PUT', body: JSON.stringify({message: 'm', content: Buffer.from('hello').toString('base64')})})
out.push(response.status, await response.text())`,
    )
    expect(JSON.parse(result.stdout)).toEqual([204, ''])
    expect(github.calls()).toEqual([
      'PUT /repos/o/r/contents/f auth=- body={"content":"<b64>","content_decoded":"hello","message":"m"}',
    ])
  })

  it('refuses a request to any other host and exits non-zero', async () => {
    const {result} = await run(`await fetch('https://example.com/')`)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('blocked request to example.com')
  })

  it('has no calls before a run and replaces its routes with setRoutes', async () => {
    const github = createFakeGithub([route('GET', '/a', {b: 'a'})])
    fake = github
    expect(github.calls()).toEqual([])
    github.setRoutes([route('GET', '/b', {b: 'b'})])
    const {result} = await run(
      `out.push((await fetch('https://api.github.com/a')).status, (await fetch('https://api.github.com/b')).status)`,
    )
    expect(JSON.parse(result.stdout)).toEqual([404, 200])
  })

  it('parses a log line with and without the UNHANDLED marker', () => {
    expect(parseCall('GET /a?x=1 auth=tok')).toEqual({
      method: 'GET',
      target: '/a?x=1',
      handled: true,
      line: 'GET /a?x=1 auth=tok',
    })
    expect(parseCall('UNHANDLED POST /b auth=- body={}')).toEqual({
      method: 'POST',
      target: '/b',
      handled: false,
      line: 'POST /b auth=- body={}',
    })
  })

  it('removes its directory on cleanup', () => {
    const github = createFakeGithub()
    expect(existsSync(github.directory)).toBe(true)
    github.cleanup()
    expect(existsSync(github.directory)).toBe(false)
  })

  it('points the preload at the fixture file', () => {
    expect(existsSync(fakeGithubPreloadPath)).toBe(true)
    expect(createFakeGithub().runtimeArgs('bun')).toEqual([
      '--no-install',
      '--no-env-file',
      '--preload',
      fakeGithubPreloadPath,
    ])
    expect(createFakeGithub().runtimeArgs('node')).toEqual(['--import', fakeGithubPreloadPath])
  })
})
