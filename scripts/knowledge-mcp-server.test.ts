/**
 * The spawned-server contract for the `knowledge` MCP server. It runs the exact command the
 * `knowledge-mcp-config` composite writes into `opencode-config` (`["bun", "scripts/knowledge-mcp.ts"]`,
 * no extra argv) from a temp fixture checkout as cwd, and drives it over the real stdio transport with
 * the SDK client. The fixture holds a copy of the real shim and a link to the real `node_modules`, so
 * nothing under the repository's own `knowledge/` or `docs/solutions/` is read or written.
 */

import type {Buffer} from 'node:buffer'
import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

import {queryDescription} from '@fro-bot/wiki-ops/knowledge-mcp'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {getDefaultEnvironment, StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {McpError} from '@modelcontextprotocol/sdk/types.js'
import {afterAll, describe, expect, it} from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Exactly what the composite writes: no flag, no extra argv. */
const SERVER_COMMAND = ['bun', 'scripts/knowledge-mcp.ts'] as const

const READY_LINE = 'knowledge-mcp: ready'
const FIXED_STDERR_LINES = new Set([
  READY_LINE,
  'knowledge-mcp: error:no-handoff',
  'knowledge-mcp: error:handoff-malformed',
  'knowledge-mcp: error:invalid-query',
  'knowledge-mcp: error:corpus-unavailable',
  'knowledge-mcp: error:unexpected',
])

const AGENT_PAGE = [
  '---',
  'type: repo',
  'title: Fro Bot Agent',
  'tags: [agent]',
  '---',
  '',
  'Fro Bot Agent links to [[vitest]] and [[octokit]] for its workflow scripts.',
  '',
].join('\n')

const VITEST_PAGE = [
  '---',
  'type: topic',
  'title: Vitest',
  'tags: [testing]',
  '---',
  '',
  'Vitest is the repo test runner. A foo bar fixture lives here and it links to [[octokit]].',
  '',
].join('\n')

const OCTOKIT_PAGE = [
  '---',
  'type: entity',
  'title: Octokit',
  'tags: [github]',
  '---',
  '',
  'Octokit powers GitHub API access for automation scripts.',
  '',
].join('\n')

const HIDDEN_PAGE = [
  '---',
  'type: topic',
  'title: Hidden Widget',
  'tags: [widget]',
  '---',
  '',
  'Notes about acme-corp/hidden-repo and its widget pipeline.',
  '',
].join('\n')

const SOLUTION_DOC = [
  '---',
  'title: Cache invalidation after a region rotation',
  'module: cache-layer',
  'tags: [cache, redis]',
  'problem_type: best_practice',
  '---',
  '',
  'Clear region keys when the region rotates.',
  '',
].join('\n')

const REPOS_YAML = [
  'repos:',
  '  - owner: acme-corp',
  '    name: hidden-repo',
  '    private: true',
  '  - owner: "[REDACTED]"',
  '    name: "[REDACTED]"',
  '    private: true',
  '',
].join('\n')

const cleanups: (() => Promise<void>)[] = []

afterAll(async () => {
  await Promise.all(cleanups.splice(0).map(async cleanup => cleanup()))
})

interface FixtureOptions {
  readonly wiki?: boolean
  readonly solutions?: boolean
  readonly metadata?: boolean
}

/** A temp checkout: the real shim, the real `node_modules` by link, and a small corpus. */
async function makeCheckout(options: FixtureOptions = {}): Promise<string> {
  const {wiki = true, solutions = true, metadata = true} = options
  const root = await mkdtemp(join(tmpdir(), 'knowledge-mcp-server-'))
  cleanups.push(async () => rm(root, {recursive: true, force: true}))

  await mkdir(join(root, 'scripts'), {recursive: true})
  await writeFile(join(root, 'scripts/knowledge-mcp.ts'), await readFile(join(REPO_ROOT, 'scripts/knowledge-mcp.ts')))
  await symlink(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir')

  const files: Record<string, string> = {}
  if (wiki) {
    files['knowledge/wiki/repos/fro-bot--agent.md'] = AGENT_PAGE
    files['knowledge/wiki/topics/vitest.md'] = VITEST_PAGE
    files['knowledge/wiki/topics/hidden-widget.md'] = HIDDEN_PAGE
    files['knowledge/wiki/entities/octokit.md'] = OCTOKIT_PAGE
  }
  if (solutions) files['docs/solutions/best-practices/cache-invalidation.md'] = SOLUTION_DOC
  if (metadata) files['metadata/repos.yaml'] = REPOS_YAML

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), {recursive: true})
    await writeFile(join(root, path), content)
  }
  return root
}

interface Session {
  readonly client: Client
  readonly stderr: () => string
}

interface ConnectOptions {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  /** A script `bun` runs before the shim. Only the env-strip test sets it; every other test spawns the exact command. */
  readonly preload?: string
}

async function connect(options: ConnectOptions): Promise<Session> {
  const [command, ...rest] = SERVER_COMMAND
  const args = options.preload === undefined ? rest : ['--preload', options.preload, ...rest]
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: options.cwd,
    env: {...getDefaultEnvironment(), ...options.env},
    stderr: 'pipe',
  })
  let stderrText = ''
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString('utf8')
  })
  const client = new Client({name: 'knowledge-mcp-contract-test', version: '0.0.0'})
  cleanups.push(async () => client.close())
  await client.connect(transport)
  // The ready line is written after the transport connects; give the pipe a moment to flush it.
  await waitFor(() => stderrText.includes(READY_LINE))
  return {client, stderr: () => stderrText}
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the server')
    await new Promise<void>(settle => {
      setTimeout(settle, 20)
    })
  }
}

interface ToolOutcome {
  readonly isError: boolean
  readonly text: string
}

async function callTool(session: Session, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const result = await session.client.callTool({name, arguments: args})
  const blocks = result.content as {type: string; text?: string}[]
  return {isError: result.isError === true, text: blocks.map(block => block.text ?? '').join('')}
}

/** Runs `bun <script> <argv...>` with the fixture as cwd and returns stdout. The parity authority for a CLI. */
async function runCli(cwd: string, script: string, argv: readonly string[]): Promise<string> {
  return new Promise((settle, fail) => {
    const child = spawn('bun', [join(REPO_ROOT, script), ...argv], {
      cwd,
      env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? ''},
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', fail)
    child.on('close', () => {
      settle(stdout)
    })
  })
}

function stderrLines(session: Session): string[] {
  return session
    .stderr()
    .split('\n')
    .filter(line => line !== '')
}

describe('knowledge MCP server: the composite command, spawned', () => {
  it('lists exactly the three tools and writes the ready line to stderr', async () => {
    // #given the composite's exact command and a fixture checkout as cwd
    const session = await connect({cwd: await makeCheckout()})

    // #when a client lists tools
    const {tools} = await session.client.listTools()

    // #then exactly the three allowlisted tools exist and stderr is only the ready line
    expect(tools.map(tool => tool.name).sort()).toEqual(['solutions_search', 'wiki_linked', 'wiki_search'])
    expect(stderrLines(session)).toEqual([READY_LINE])

    // The query text the model reads over the real transport is the validator-shaped description.
    for (const name of ['wiki_search', 'solutions_search']) {
      const schema = tools.find(tool => tool.name === name)?.inputSchema
      expect((schema?.properties as {query: {description: string}}).query.description).toBe(queryDescription())
    }
  })

  it('wiki_search returns what wiki-context-expand query prints for the same input', async () => {
    const cwd = await makeCheckout()
    const session = await connect({cwd})

    const outcome = await callTool(session, 'wiki_search', {query: 'octokit github api access'})
    const cli = await runCli(cwd, 'scripts/wiki-context-expand.ts', ['query', 'octokit github api access'])

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toEqual(JSON.parse(cli))
    expect(JSON.parse(outcome.text)).toMatchObject({status: 'ok', mode: 'query'})
  })

  it('wiki_search gives `-foo bar` the result the CLI gives query "-foo bar"', async () => {
    const cwd = await makeCheckout()
    const session = await connect({cwd})

    const outcome = await callTool(session, 'wiki_search', {query: '-foo bar'})
    const cli = await runCli(cwd, 'scripts/wiki-context-expand.ts', ['query', '-foo bar'])

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toEqual(JSON.parse(cli))
    expect(JSON.parse(outcome.text)).toMatchObject({status: 'ok', selectedPaths: ['knowledge/wiki/topics/vitest.md']})
  })

  it('rejects a call without query before the handler runs', async () => {
    const session = await connect({cwd: await makeCheckout()})

    await expect(session.client.callTool({name: 'wiki_search', arguments: {}})).rejects.toBeInstanceOf(McpError)
    await expect(session.client.callTool({name: 'solutions_search', arguments: {}})).rejects.toBeInstanceOf(McpError)
    expect(stderrLines(session)).toEqual([READY_LINE])
  })

  it.each(['', '   ', 'wiki', '../etc/passwd'])(
    'answers the query %j with invalid-query as an error result',
    async query => {
      const session = await connect({cwd: await makeCheckout()})

      const search = await callTool(session, 'wiki_search', {query})
      const solutions = await callTool(session, 'solutions_search', {query})

      expect(search).toEqual({isError: true, text: '{"error":"invalid-query"}'})
      expect(solutions).toEqual({isError: true, text: '{"error":"invalid-query"}'})
    },
  )

  it('answers corpus-unavailable, not an empty match, when the corpus is missing', async () => {
    const session = await connect({cwd: await makeCheckout({wiki: false, solutions: false})})

    const search = await callTool(session, 'wiki_search', {query: 'octokit github api access'})
    const solutions = await callTool(session, 'solutions_search', {query: 'cache region rotation'})

    expect(search).toEqual({isError: true, text: '{"error":"corpus-unavailable"}'})
    expect(solutions).toEqual({isError: true, text: '{"error":"corpus-unavailable"}'})
  })

  it('wiki_linked returns the pages linked from the handoff', async () => {
    const cwd = await makeCheckout()
    const handoff = join(cwd, 'handoff.json')
    await writeFile(handoff, JSON.stringify({selectedPaths: ['knowledge/wiki/repos/fro-bot--agent.md']}))
    const session = await connect({cwd, env: {WIKI_CONTEXT_HANDOFF_PATH: handoff}})

    const outcome = await callTool(session, 'wiki_linked')

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toMatchObject({status: 'ok', mode: 'linked'})
    expect((JSON.parse(outcome.text) as {selectedPaths: string[]}).selectedPaths.sort()).toEqual([
      'knowledge/wiki/entities/octokit.md',
      'knowledge/wiki/topics/vitest.md',
    ])
  })

  it('wiki_linked answers no-handoff when no handoff path is configured', async () => {
    const session = await connect({cwd: await makeCheckout()})

    expect(await callTool(session, 'wiki_linked')).toEqual({isError: true, text: '{"error":"no-handoff"}'})
  })

  it('wiki_linked answers no-handoff for a missing file, naming no path', async () => {
    const cwd = await makeCheckout()
    const missing = join(cwd, 'does-not-exist-handoff.json')
    const session = await connect({cwd, env: {WIKI_CONTEXT_HANDOFF_PATH: missing}})

    const outcome = await callTool(session, 'wiki_linked')

    expect(outcome).toEqual({isError: true, text: '{"error":"no-handoff"}'})
    expect(outcome.text).not.toContain('does-not-exist')
    expect(session.stderr()).not.toContain('does-not-exist')
  })

  it('wiki_linked answers handoff-malformed even when the corpus is also missing', async () => {
    const cwd = await makeCheckout({wiki: false})
    const handoff = join(cwd, 'handoff.json')
    await writeFile(handoff, '{"selectedPaths": "not-an-array"}')
    const session = await connect({cwd, env: {WIKI_CONTEXT_HANDOFF_PATH: handoff}})

    expect(await callTool(session, 'wiki_linked')).toEqual({isError: true, text: '{"error":"handoff-malformed"}'})
  })

  it('solutions_search returns the matching fixture doc and stderr holds only the ready line', async () => {
    const cwd = await makeCheckout()
    const session = await connect({cwd})

    const outcome = await callTool(session, 'solutions_search', {query: 'cache invalidation region rotation'})

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toMatchObject({
      selectedPaths: ['docs/solutions/best-practices/cache-invalidation.md'],
    })
    expect(stderrLines(session)).toEqual([READY_LINE])
  })

  it('leaves out a page that names a private repository from repos.yaml, as the CLI does', async () => {
    const cwd = await makeCheckout()
    const session = await connect({cwd})

    const outcome = await callTool(session, 'wiki_search', {query: 'hidden widget pipeline'})
    const cli = await runCli(cwd, 'scripts/wiki-context-expand.ts', ['query', 'hidden widget pipeline'])

    expect(JSON.parse(outcome.text)).toEqual(JSON.parse(cli))
    expect(outcome.text).not.toContain('hidden-widget')
    expect(outcome.text).not.toContain('acme-corp')
  })

  it('never lets a sentinel credential reach a result or a stream', async () => {
    const cwd = await makeCheckout()
    const sentinels = {
      OPENCODE_PASSWORD: 'sentinel-password-5f2a',
      OPENCODE_CONFIG_CONTENT: 'sentinel-config-9c1d',
      GITHUB_TOKEN: 'sentinel-token-77be',
    }
    const session = await connect({cwd, env: sentinels})

    const seen = [
      (await callTool(session, 'wiki_search', {query: 'octokit github api access'})).text,
      (await callTool(session, 'wiki_search', {query: 'wiki'})).text,
      (await callTool(session, 'solutions_search', {query: 'cache invalidation region rotation'})).text,
      (await callTool(session, 'wiki_linked')).text,
      session.stderr(),
    ].join('\n')

    for (const value of Object.values(sentinels)) expect(seen).not.toContain(value)
  })

  it('removes OPENCODE_PASSWORD and OPENCODE_CONFIG_CONTENT from its own environment at startup', async () => {
    // #given a preload that records every deletion from process.env, and sentinel values for both variables
    const cwd = await makeCheckout()
    const log = join(cwd, 'env-deletions.log')
    const preload = join(cwd, 'record-env-deletions.ts')
    await writeFile(
      preload,
      [
        "import {appendFileSync} from 'node:fs'",
        'process.env = new Proxy(process.env, {',
        '  deleteProperty(target, key) {',
        String.raw`    appendFileSync(process.env.ENV_DELETION_LOG ?? "", String(key) + ":" + String(key in target) + "\n")`,
        '    return Reflect.deleteProperty(target, key)',
        '  },',
        '})',
        '',
      ].join('\n'),
    )
    const session = await connect({
      cwd,
      preload,
      env: {
        ENV_DELETION_LOG: log,
        OPENCODE_PASSWORD: 'sentinel-password-5f2a',
        OPENCODE_CONFIG_CONTENT: 'sentinel-config-9c1d',
      },
    })

    // #when the server has started and answers a call
    await callTool(session, 'wiki_search', {query: 'octokit github api access'})

    // #then both variables were present and removed, and nothing else was
    const deletions = (await readFile(log, 'utf8')).split('\n').filter(line => line !== '')
    expect(deletions).toEqual(['OPENCODE_PASSWORD:true', 'OPENCODE_CONFIG_CONTENT:true'])
  })

  it('writes only lines from the fixed set to stderr across every error case', async () => {
    const cwd = await makeCheckout()
    const handoff = join(cwd, 'bad-handoff.json')
    await writeFile(handoff, 'not json')
    const session = await connect({cwd, env: {WIKI_CONTEXT_HANDOFF_PATH: handoff}})

    await callTool(session, 'wiki_search', {query: 'wiki'})
    await callTool(session, 'solutions_search', {query: '../x'})
    await callTool(session, 'wiki_linked')

    const lines = stderrLines(session)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(FIXED_STDERR_LINES.has(line), line).toBe(true)
  })
})

describe('knowledge MCP server: the call log, spawned', () => {
  it('appends one `<tool> <code>` line per tools/call, and nothing the model sent', async () => {
    // #given the composite's environment variable naming an absolute log path
    const cwd = await makeCheckout()
    const log = join(cwd, 'knowledge-mcp-calls.log')
    const sentinel = 'sentinel-query-3c7a'
    const session = await connect({cwd, env: {KNOWLEDGE_MCP_CALL_LOG: log}})

    // #when a client makes real calls, one of them with a sentinel in the query
    await callTool(session, 'wiki_search', {query: 'octokit github api access'})
    await callTool(session, 'wiki_search', {query: `octokit ${sentinel}`})
    await callTool(session, 'wiki_search', {query: 'wiki'})
    await callTool(session, 'solutions_search', {query: 'cache invalidation region rotation'})
    await callTool(session, 'solutions_search', {query: '../x'})
    await callTool(session, 'wiki_linked')

    // #then the file holds exactly those calls' tool names and codes, and the sentinel is nowhere
    const text = await readFile(log, 'utf8')
    expect(text).toBe(
      [
        'wiki_search ok',
        'wiki_search ok',
        'wiki_search invalid-query',
        'solutions_search ok',
        'solutions_search invalid-query',
        'wiki_linked no-handoff',
        '',
      ].join('\n'),
    )
    expect(text).not.toContain(sentinel)
    expect(session.stderr()).not.toContain(sentinel)
  })

  it('records the other fixed codes: corpus-unavailable and handoff-malformed', async () => {
    const cwd = await makeCheckout({wiki: false, solutions: false})
    const log = join(cwd, 'knowledge-mcp-calls.log')
    const handoff = join(cwd, 'handoff.json')
    await writeFile(handoff, '{"selectedPaths": "not-an-array"}')
    const session = await connect({cwd, env: {KNOWLEDGE_MCP_CALL_LOG: log, WIKI_CONTEXT_HANDOFF_PATH: handoff}})

    await callTool(session, 'wiki_search', {query: 'octokit github api access'})
    await callTool(session, 'solutions_search', {query: 'cache region rotation'})
    await callTool(session, 'wiki_linked')

    expect(await readFile(log, 'utf8')).toBe(
      'wiki_search corpus-unavailable\nsolutions_search corpus-unavailable\nwiki_linked handoff-malformed\n',
    )
  })

  it('writes no file when the path is not absolute, and still answers', async () => {
    const cwd = await makeCheckout()
    const session = await connect({cwd, env: {KNOWLEDGE_MCP_CALL_LOG: 'relative-calls.log'}})

    const outcome = await callTool(session, 'wiki_search', {query: 'octokit github api access'})

    expect(outcome.isError).toBe(false)
    await expect(readFile(join(cwd, 'relative-calls.log'), 'utf8')).rejects.toMatchObject({code: 'ENOENT'})
  })

  it('answers and writes only fixed stderr lines when the log cannot be written', async () => {
    const cwd = await makeCheckout()
    const log = join(cwd, 'no-such-directory', 'calls.log')
    const session = await connect({cwd, env: {KNOWLEDGE_MCP_CALL_LOG: log}})

    const outcome = await callTool(session, 'wiki_search', {query: 'octokit github api access'})

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toMatchObject({status: 'ok', mode: 'query'})
    expect(stderrLines(session)).toEqual([READY_LINE])
  })
})

/**
 * A Bun preload that hooks the load of the server module (`packages/wiki-ops/src/knowledge-mcp.ts`, reached
 * as `@fro-bot/wiki-ops/knowledge-mcp`). `onLoad` runs when the shim imports that module, so whatever
 * the callback sees is what the module's own load sees.
 */
function modulePreload(onLoadBody: string): string {
  return [
    "import {appendFileSync} from 'node:fs'",
    'Bun.plugin({',
    "  name: 'knowledge-mcp-load-hook',",
    '  setup(build) {',
    String.raw`    build.onLoad({filter: /packages[\\/]wiki-ops[\\/]src[\\/]knowledge-mcp\.ts$/}, async args => {`,
    onLoadBody,
    "      return {contents: await Bun.file(args.path).text(), loader: 'ts'}",
    '    })',
    '  },',
    '})',
    '',
  ].join('\n')
}

interface ShimRun {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Runs the real shim under `bun --preload`, with stdin closed, and returns how it ended. */
async function runShim(cwd: string, preload: string, env: Readonly<Record<string, string>>): Promise<ShimRun> {
  return new Promise((settle, fail) => {
    const child = spawn('bun', ['--preload', preload, 'scripts/knowledge-mcp.ts'], {
      cwd,
      env: {...getDefaultEnvironment(), ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', fail)
    child.on('close', code => {
      settle({code, stdout, stderr})
    })
  })
}

describe('knowledge MCP server: the shim', () => {
  it('has no static import statement', async () => {
    const source = await readFile(join(REPO_ROOT, 'scripts/knowledge-mcp.ts'), 'utf8')

    expect(source).not.toMatch(/^\s*import\s[^(]/mu)
    expect(source).not.toMatch(/^\s*export\s.*\sfrom\s/mu)
  })

  it('starts no server when imported rather than run as the main module', async () => {
    const stdout: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(String(chunk))
      return true
    }

    try {
      await import(`../scripts/knowledge-mcp${'.ts'}`)
    } finally {
      process.stdout.write = write
    }

    expect(stdout).toEqual([])
  })

  it('removes both OpenCode variables before the server module is loaded', async () => {
    // #given a hook that records, as the server module loads, whether each variable is still in the environment
    const cwd = await makeCheckout()
    const log = join(cwd, 'env-at-load.log')
    const preload = join(cwd, 'record-env-at-load.ts')
    await writeFile(
      preload,
      modulePreload(
        String.raw`      appendFileSync(process.env.ENV_LOAD_LOG ?? "", String("OPENCODE_PASSWORD" in process.env) + ":" + String("OPENCODE_CONFIG_CONTENT" in process.env) + "\n")`,
      ),
    )

    // #when the real shim starts, with both variables set, and then ends because stdin is closed
    await runShim(cwd, preload, {
      ENV_LOAD_LOG: log,
      OPENCODE_PASSWORD: 'sentinel-password-5f2a',
      OPENCODE_CONFIG_CONTENT: 'sentinel-config-9c1d',
    })

    // #then the module loaded exactly once, and neither variable was there when it did
    expect((await readFile(log, 'utf8')).split('\n').filter(line => line !== '')).toEqual(['false:false'])
  })

  it('writes only the fixed startup line and exits non-zero when the server module cannot load', async () => {
    // #given a hook that makes the module's load throw an error whose message holds a path
    const cwd = await makeCheckout()
    const preload = join(cwd, 'fail-module-load.ts')
    await writeFile(
      preload,
      modulePreload('      throw new Error("cannot load /home/runner/work/private/secret-module.ts")'),
    )

    // #when the real shim starts
    const run = await runShim(cwd, preload, {})

    // #then stderr is the fixed line alone: no stack, no path, nothing on stdout
    expect(run.stderr).toBe('knowledge-mcp: error:startup\n')
    expect(run.stdout).toBe('')
    expect(run.code).not.toBe(0)
    expect(run.code).not.toBeNull()
  })
})
