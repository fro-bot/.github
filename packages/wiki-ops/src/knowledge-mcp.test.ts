/**
 * In-process behavior of the `knowledge` MCP server. It imports the module by relative path (so a
 * Stryker mutant runs against these tests) and drives it over an in-memory MCP transport. The spawned
 * contract on the composite's exact command is `scripts/knowledge-mcp-server.test.ts`.
 */

import type {ExpandResult} from './wiki-context-expand.ts'
import {readdirSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import process from 'node:process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {McpError} from '@modelcontextprotocol/sdk/types.js'
import {goke} from 'goke'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  buildKnowledgeCli,
  defaultKnowledgeDeps,
  knowledgeToolNames,
  serve,
  type KnowledgeDeps,
} from './knowledge-mcp.ts'

const SRC_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = resolve(SRC_DIR, '../..')

const AGENT_PAGE =
  '---\ntype: repo\ntitle: Fro Bot Agent\ntags: [agent]\n---\n\nFro Bot Agent links to [[vitest]] for its workflow scripts.\n'
const VITEST_PAGE =
  '---\ntype: topic\ntitle: Vitest\ntags: [testing]\n---\n\nVitest is the repo runner fixture and a foo bar fixture.\n'
const SOLUTION_DOC =
  '---\ntitle: Cache invalidation after a region rotation\nmodule: cache-layer\ntags: [cache]\n---\n\nClear region keys.\n'
const HANDOFF_PATH = '/work/checkout/handoff.json'
const HANDOFF = JSON.stringify({selectedPaths: ['knowledge/wiki/repos/fro-bot--agent.md']})

const FULL_CHECKOUT: Readonly<Record<string, string>> = {
  'knowledge/wiki/repos/fro-bot--agent.md': AGENT_PAGE,
  'knowledge/wiki/topics/vitest.md': VITEST_PAGE,
  'docs/solutions/best-practices/cache-invalidation.md': SOLUTION_DOC,
  'metadata/repos.yaml': 'repos: []\n',
  [HANDOFF_PATH]: HANDOFF,
}

interface Harness {
  readonly deps: KnowledgeDeps
  readonly stderr: string[]
  readonly session: Client
}

/** An in-memory checkout: a path is a directory when a file sits directly beneath it. */
function memoryDeps(
  files: Readonly<Record<string, string>>,
  overrides: Partial<KnowledgeDeps> = {},
): {deps: KnowledgeDeps; stderr: string[]} {
  const stderr: string[] = []
  const deps: KnowledgeDeps = {
    env: {WIKI_CONTEXT_HANDOFF_PATH: HANDOFF_PATH},
    readDir: async path => {
      const prefix = `${path}/`
      const names = Object.keys(files)
        .filter(file => file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
        .map(file => file.slice(prefix.length))
      if (names.length === 0) throw new Error(`ENOENT: ${path}`)
      return names.map(name => ({name, isFile: () => true}))
    },
    readFile: async path => {
      const content = files[path]
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
    writeStderr: line => stderr.push(line),
    expand: defaultKnowledgeDeps().expand,
    searchSolutions: defaultKnowledgeDeps().searchSolutions,
    ...overrides,
  }
  return {deps, stderr}
}

const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async client => client.close()))
  vi.restoreAllMocks()
})

async function harness(
  files: Readonly<Record<string, string>> = FULL_CHECKOUT,
  overrides: Partial<KnowledgeDeps> = {},
): Promise<Harness> {
  const {deps, stderr} = memoryDeps(files, overrides)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await serve({deps, createTransport: () => serverSide})
  const session = new Client({name: 'knowledge-mcp-test', version: '0.0.0'})
  clients.push(session)
  await session.connect(clientSide)
  return {deps, stderr, session}
}

async function call(
  h: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{isError: boolean; text: string}> {
  const result = await h.session.callTool({name, arguments: args})
  const blocks = result.content as {type: string; text?: string}[]
  return {isError: result.isError === true, text: blocks.map(block => block.text ?? '').join('')}
}

const errorText = (code: string): string => JSON.stringify({error: code})

describe('knowledge tool surface', () => {
  it('names exactly the three tools', () => {
    expect(knowledgeToolNames()).toEqual(['wiki_search', 'wiki_linked', 'solutions_search'])
  })

  it('never names a write-marked command, resolve-private or enumerate-existing-leaks', async () => {
    // #given every CLI config the packages export, read from the running modules rather than their text
    // (a mutated module's source is rewritten by Stryker, a loaded module's values are not)
    const writeMarked = new Set<string>()
    const everyName = new Set<string>()
    for (const pkg of readdirSync(PACKAGES_DIR, {withFileTypes: true})) {
      if (!pkg.isDirectory()) continue
      const srcDir = join(PACKAGES_DIR, pkg.name, 'src')
      let entries: string[]
      try {
        entries = readdirSync(srcDir)
      } catch {
        continue
      }
      for (const entry of entries.filter(name => name.endsWith('-cli.ts') && !name.endsWith('.test.ts'))) {
        const loaded = (await import(pathToFileURL(join(srcDir, entry)).href)) as Record<string, unknown>
        for (const [exportName, value] of Object.entries(loaded)) {
          // A config factory is `<name>Cli()`; `run*Cli` functions run a command, so they are never called.
          if (!exportName.endsWith('Cli') || exportName.startsWith('run') || typeof value !== 'function') continue
          const config: unknown = (value as () => unknown)()
          if (typeof config !== 'object' || config === null || !('commands' in config) || !('name' in config)) continue
          for (const command of (config as {commands: readonly {name: string; readOnly: boolean}[]}).commands) {
            const name = command.name === '' ? String((config as {name: unknown}).name) : command.name
            everyName.add(name)
            if (!command.readOnly) writeMarked.add(name)
          }
        }
      }
    }
    const spellings = (names: ReadonlySet<string>): Set<string> =>
      new Set([...names].flatMap(name => [name, name.replaceAll('-', '_')]))

    // #then the scan saw the write-marked and the sensitive read-only commands, and the allowlist names none of them
    expect(writeMarked.size).toBeGreaterThan(5)
    expect(writeMarked.has('merge-back-data')).toBe(true)
    expect(everyName.has('resolve-private')).toBe(true)
    expect(everyName.has('enumerate-existing-leaks')).toBe(true)
    const forbidden = spellings(new Set([...writeMarked, 'resolve-private', 'enumerate-existing-leaks']))
    for (const name of knowledgeToolNames()) {
      expect(forbidden.has(name), `${name} is a write-marked or sensitive command`).toBe(false)
    }
    expect(relative(PACKAGES_DIR, SRC_DIR)).toBe('wiki-ops/src')
  })

  it('registers exactly the allowlisted commands on its own goke instance', () => {
    const {deps} = memoryDeps({})

    const cli = buildKnowledgeCli(deps)

    expect(cli.commands.map(command => command.name)).toEqual(knowledgeToolNames())
    expect(cli.name).toBe('knowledge')
  })

  it('lists three tools with model-facing descriptions and a required query on the two searches', async () => {
    const h = await harness()

    const {tools} = await h.session.listTools()

    expect(tools.map(tool => tool.name).sort()).toEqual(['solutions_search', 'wiki_linked', 'wiki_search'])
    expect(h.session.getServerVersion()?.name).toBe('knowledge')
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(40)
    const byName = new Map(tools.map(tool => [tool.name, tool]))
    for (const name of ['wiki_search', 'solutions_search']) {
      const schema = byName.get(name)?.inputSchema
      expect(schema?.required).toEqual(['query'])
      expect(JSON.stringify(schema?.properties)).toContain('"type":"string"')
      expect(JSON.stringify(schema?.properties)).toContain('plain words')
    }
    expect(byName.get('wiki_linked')?.inputSchema.required).toBeUndefined()
    expect(byName.get('wiki_search')?.description).toContain('wiki')
    expect(byName.get('wiki_linked')?.description).toContain('link')
    expect(byName.get('solutions_search')?.description).toContain('solutions')
  })

  it('exposes only allowlisted commands even when the goke instance holds others', async () => {
    // #given a goke instance with a fourth command outside the allowlist
    const {deps, stderr} = memoryDeps(FULL_CHECKOUT)
    const cli = buildKnowledgeCli(deps)
    cli.command('resolve-private', 'prints private names').action(() => 'private')
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()

    // #when the server is served over it
    await serve({deps, cli, createTransport: () => serverSide})
    const session = new Client({name: 'knowledge-mcp-test', version: '0.0.0'})
    clients.push(session)
    await session.connect(clientSide)
    const {tools} = await session.listTools()

    // #then the extra command is not a tool and cannot be called
    expect(tools.map(tool => tool.name).sort()).toEqual(['solutions_search', 'wiki_linked', 'wiki_search'])
    await expect(session.callTool({name: 'resolve-private', arguments: {}})).rejects.toBeInstanceOf(McpError)
    await expect(session.callTool({name: 'resolve_private', arguments: {}})).rejects.toBeInstanceOf(McpError)
    expect(stderr).toEqual(['knowledge-mcp: ready\n'])
  })
})

describe('serve', () => {
  it('writes the ready line once the transport is connected', async () => {
    const h = await harness()

    expect(h.stderr).toEqual(['knowledge-mcp: ready\n'])
  })

  it('writes one fixed line and sets the exit code when the transport cannot start', async () => {
    const {deps, stderr} = memoryDeps({})
    const previous = process.exitCode
    try {
      process.exitCode = undefined

      await serve({
        deps,
        createTransport: () => {
          throw new Error('/secret/path with a query inside')
        },
      })

      expect(stderr).toEqual(['knowledge-mcp: error:startup\n'])
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previous
    }
  })
})

describe('wiki_search', () => {
  it('returns the expansion result as JSON text for a matching query', async () => {
    const h = await harness()

    const outcome = await call(h, 'wiki_search', {query: 'runner fixture'})

    expect(outcome.isError).toBe(false)
    const result = JSON.parse(outcome.text) as ExpandResult
    expect(result).toMatchObject({status: 'ok', mode: 'query', selectedPaths: ['knowledge/wiki/topics/vitest.md']})
    expect(h.stderr).toEqual(['knowledge-mcp: ready\n'])
  })

  it('passes the query to the expansion as one argv element, so a leading dash is text', async () => {
    const expand = vi.fn<KnowledgeDeps['expand']>(async () => ({exitCode: 0}))
    const h = await harness(FULL_CHECKOUT, {expand})

    await call(h, 'wiki_search', {query: '-foo bar'})

    expect(expand).toHaveBeenCalledTimes(1)
    const deps = expand.mock.calls[0]?.[0]
    expect(deps?.argv).toEqual(['query', '-foo bar'])
    expect(deps?.env).toEqual({})
    expect(deps?.readDir).toBe(h.deps.readDir)
    expect(deps?.readFile).toBe(h.deps.readFile)
    // The tool answers in its response only: the expansion's own streams go nowhere.
    expect(() => {
      deps?.writeStdout('x')
      deps?.writeStderr('y')
    }).not.toThrow()
    expect(h.stderr).not.toContain('x')
    expect(h.stderr).not.toContain('y')
  })

  it('answers a match with no pages as a result, not an error', async () => {
    const h = await harness()

    const outcome = await call(h, 'wiki_search', {query: 'zzzzqqqq nonexistent'})

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toMatchObject({status: 'empty', reason: 'no-match'})
  })

  it.each([
    ['empty', ''],
    ['overbroad', 'wiki'],
    ['path-like', '../etc/passwd'],
  ])('answers a %s query with invalid-query', async (_label, query) => {
    const h = await harness()

    const outcome = await call(h, 'wiki_search', {query})

    expect(outcome).toEqual({isError: true, text: errorText('invalid-query')})
    expect(h.stderr).toEqual(['knowledge-mcp: ready\n', 'knowledge-mcp: error:invalid-query\n'])
  })

  it('answers corpus-unavailable when the wiki is missing', async () => {
    const h = await harness({'metadata/repos.yaml': 'repos: []\n'})

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({
      isError: true,
      text: errorText('corpus-unavailable'),
    })
  })

  it('answers corpus-unavailable when the private-name list cannot be read', async () => {
    const files = Object.fromEntries(Object.entries(FULL_CHECKOUT).filter(([path]) => path !== 'metadata/repos.yaml'))
    const h = await harness(files)

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({
      isError: true,
      text: errorText('corpus-unavailable'),
    })
  })

  it('rejects a call without query before the handler runs', async () => {
    const expand = vi.fn<KnowledgeDeps['expand']>(async () => ({exitCode: 0}))
    const h = await harness(FULL_CHECKOUT, {expand})

    await expect(h.session.callTool({name: 'wiki_search', arguments: {}})).rejects.toBeInstanceOf(McpError)

    expect(expand).not.toHaveBeenCalled()
  })

  it('maps a non-string query that reaches the handler to invalid-query', async () => {
    const expand = vi.fn<KnowledgeDeps['expand']>(async () => ({exitCode: 0}))
    const {deps, stderr} = memoryDeps(FULL_CHECKOUT, {expand})
    const command = buildKnowledgeCli(deps).commands.find(candidate => candidate.name === 'wiki_search')

    const result: unknown = await command?.commandAction?.({query: 5})

    expect(result).toEqual({isError: true, content: [{type: 'text', text: errorText('invalid-query')}]})
    expect(expand).not.toHaveBeenCalled()
    expect(stderr).toEqual(['knowledge-mcp: error:invalid-query\n'])
  })
})

describe('how an expansion outcome maps onto the tool contract', () => {
  const empty = (reason: NonNullable<ExpandResult['reason']>): ExpandResult => ({
    status: 'empty',
    mode: 'query',
    selectedPaths: [],
    excerpt: '',
    byteLength: 0,
    pageCount: 0,
    reason,
  })

  it.each([
    ['bad-args', 'invalid-query'],
    ['invalid-query', 'invalid-query'],
    ['no-corpus', 'corpus-unavailable'],
    ['private-token-load-failed', 'corpus-unavailable'],
    ['no-handoff', 'no-handoff'],
    ['malformed-handoff', 'handoff-malformed'],
  ] as const)('maps the empty reason %s to the code %s', async (reason, code) => {
    const expand: KnowledgeDeps['expand'] = async () => ({exitCode: 0, result: empty(reason)})
    const h = await harness(FULL_CHECKOUT, {expand})

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({isError: true, text: errorText(code)})
  })

  it.each(['no-match', 'no-links'] as const)('returns the empty reason %s as a result', async reason => {
    const expand: KnowledgeDeps['expand'] = async () => ({exitCode: 0, result: empty(reason)})
    const h = await harness(FULL_CHECKOUT, {expand})

    const outcome = await call(h, 'wiki_search', {query: 'runner fixture'})

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toEqual(empty(reason))
  })

  it('maps a non-zero exit to invalid-query whatever the result says', async () => {
    const okResult: ExpandResult = {...empty('no-match'), status: 'ok', reason: undefined}
    const expand: KnowledgeDeps['expand'] = async () => ({exitCode: 1, result: okResult})
    const h = await harness(FULL_CHECKOUT, {expand})

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({
      isError: true,
      text: errorText('invalid-query'),
    })
  })

  it('maps an outcome with no result, which the CLI gives only to help, to invalid-query', async () => {
    const expand: KnowledgeDeps['expand'] = async () => ({exitCode: 0})
    const h = await harness(FULL_CHECKOUT, {expand})

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({
      isError: true,
      text: errorText('invalid-query'),
    })
  })

  it('returns a populated result as JSON text', async () => {
    const populated: ExpandResult = {
      status: 'ok',
      mode: 'query',
      selectedPaths: ['knowledge/wiki/topics/vitest.md'],
      excerpt: 'x',
      byteLength: 1,
      pageCount: 1,
    }
    const expand: KnowledgeDeps['expand'] = async () => ({exitCode: 0, result: populated})
    const h = await harness(FULL_CHECKOUT, {expand})

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({
      isError: false,
      text: JSON.stringify(populated),
    })
  })
})

describe('wiki_linked', () => {
  it('returns the linked pages for a valid handoff and hands the expansion the configured path', async () => {
    const expand = vi.fn(defaultKnowledgeDeps().expand)
    const h = await harness(FULL_CHECKOUT, {expand})

    const outcome = await call(h, 'wiki_linked')

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toMatchObject({
      status: 'ok',
      mode: 'linked',
      selectedPaths: ['knowledge/wiki/topics/vitest.md'],
    })
    const deps = expand.mock.calls[0]?.[0]
    expect(deps?.argv).toEqual(['linked'])
    expect(deps?.env).toEqual({WIKI_CONTEXT_HANDOFF_PATH: HANDOFF_PATH})
    expect(() => {
      deps?.writeStdout('x')
      deps?.writeStderr('y')
    }).not.toThrow()
  })

  it.each([
    ['unset', {}],
    ['empty', {WIKI_CONTEXT_HANDOFF_PATH: ''}],
  ])('answers no-handoff when the handoff path is %s, before touching the corpus', async (_label, env) => {
    const expand = vi.fn<KnowledgeDeps['expand']>(async () => ({exitCode: 0}))
    const readFile = vi.fn(async () => '')
    const h = await harness(FULL_CHECKOUT, {env, expand, readFile})

    expect(await call(h, 'wiki_linked')).toEqual({isError: true, text: errorText('no-handoff')})
    expect(expand).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('answers no-handoff for a missing file and names no path anywhere', async () => {
    const h = await harness(FULL_CHECKOUT, {env: {WIKI_CONTEXT_HANDOFF_PATH: '/work/checkout/gone-handoff.json'}})

    const outcome = await call(h, 'wiki_linked')

    expect(outcome).toEqual({isError: true, text: errorText('no-handoff')})
    expect(h.stderr.join('')).not.toContain('gone-handoff')
  })

  it.each([['not json'], ['[]'], ['{"selectedPaths": "x"}'], ['{"selectedPaths": [1]}']])(
    'answers handoff-malformed for the file %j, even when the corpus is missing',
    async content => {
      const h = await harness({[HANDOFF_PATH]: content})

      expect(await call(h, 'wiki_linked')).toEqual({isError: true, text: errorText('handoff-malformed')})
    },
  )

  it('answers corpus-unavailable for a valid handoff when the wiki is missing', async () => {
    const h = await harness({[HANDOFF_PATH]: HANDOFF, 'metadata/repos.yaml': 'repos: []\n'})

    expect(await call(h, 'wiki_linked')).toEqual({isError: true, text: errorText('corpus-unavailable')})
  })
})

describe('solutions_search', () => {
  it('returns the matching doc and writes nothing to stderr beyond the ready line', async () => {
    const h = await harness()

    const outcome = await call(h, 'solutions_search', {query: 'cache invalidation region rotation'})

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toMatchObject({
      selectedPaths: ['docs/solutions/best-practices/cache-invalidation.md'],
    })
    expect(h.stderr).toEqual(['knowledge-mcp: ready\n'])
  })

  it('calls the query entry with the checkout readers and the query as given', async () => {
    const search = vi.fn<KnowledgeDeps['searchSolutions']>(async () => ({
      ok: true,
      result: {excerpt: '', selectedPaths: [], byteLength: 0},
    }))
    const h = await harness(FULL_CHECKOUT, {searchSolutions: search})

    await call(h, 'solutions_search', {query: '-flag-like text'})

    expect(search).toHaveBeenCalledWith('-flag-like text', {readDir: h.deps.readDir, readFile: h.deps.readFile})
  })

  it('answers an empty match as a result', async () => {
    const h = await harness()

    const outcome = await call(h, 'solutions_search', {query: 'zzzzqqqq nonexistent'})

    expect(outcome.isError).toBe(false)
    expect(JSON.parse(outcome.text)).toEqual({excerpt: '', selectedPaths: [], byteLength: 0})
  })

  it('answers invalid-query for a rejected query', async () => {
    const h = await harness()

    expect(await call(h, 'solutions_search', {query: '../x'})).toEqual({
      isError: true,
      text: errorText('invalid-query'),
    })
  })

  it('answers corpus-unavailable for a missing docs/solutions tree and for an unreadable repos.yaml', async () => {
    const noDocs = await harness({'metadata/repos.yaml': 'repos: []\n'})
    const noMetadata = await harness({'docs/solutions/best-practices/cache-invalidation.md': SOLUTION_DOC})

    expect(await call(noDocs, 'solutions_search', {query: 'cache region rotation'})).toEqual({
      isError: true,
      text: errorText('corpus-unavailable'),
    })
    expect(await call(noMetadata, 'solutions_search', {query: 'cache region rotation'})).toEqual({
      isError: true,
      text: errorText('corpus-unavailable'),
    })
  })

  it('maps a non-string query that reaches the handler to invalid-query', async () => {
    const search = vi.fn<KnowledgeDeps['searchSolutions']>()
    const {deps} = memoryDeps(FULL_CHECKOUT, {searchSolutions: search})
    const command = buildKnowledgeCli(deps).commands.find(candidate => candidate.name === 'solutions_search')

    const result: unknown = await command?.commandAction?.({query: ['x']})

    expect(result).toEqual({isError: true, content: [{type: 'text', text: errorText('invalid-query')}]})
    expect(search).not.toHaveBeenCalled()
  })
})

describe('a handler never throws and never echoes what it was given', () => {
  const SECRET_PATH = '/home/runner/work/private/secret-corpus.md'
  const SECRET_QUERY = 'cache region rotation sentinel-query-4d1e'

  it.each([
    ['wiki_search', {query: SECRET_QUERY}],
    ['wiki_linked', {}],
    ['solutions_search', {query: SECRET_QUERY}],
  ] as const)(
    'turns a throwing dependency under %s into unexpected, with no path or query in the result',
    async (name, args) => {
      const boom = new Error(`failed reading ${SECRET_PATH} for ${SECRET_QUERY}`)
      const h = await harness(FULL_CHECKOUT, {
        expand: async () => {
          throw boom
        },
        searchSolutions: async () => {
          throw boom
        },
      })

      const outcome = await call(h, name, args)

      expect(outcome).toEqual({isError: true, text: errorText('unexpected')})
      expect(outcome.text).not.toContain(SECRET_PATH)
      expect(outcome.text).not.toContain(SECRET_QUERY)
      expect(h.stderr.join('')).not.toContain(SECRET_PATH)
      expect(h.stderr.join('')).not.toContain(SECRET_QUERY)
      expect(h.stderr.at(-1)).toBe('knowledge-mcp: error:unexpected\n')
    },
  )

  it('turns a thrown non-error into unexpected too', async () => {
    const h = await harness(FULL_CHECKOUT, {
      expand: async () => {
        throw SECRET_PATH
      },
    })

    expect(await call(h, 'wiki_search', {query: 'runner fixture'})).toEqual({
      isError: true,
      text: errorText('unexpected'),
    })
  })
})

describe('the default deps', () => {
  it('read the process env, the checkout-relative disk and stderr', async () => {
    const deps = defaultKnowledgeDeps()
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    deps.writeStderr('knowledge-mcp: ready\n')

    expect(deps.env).toBe(process.env)
    expect(write).toHaveBeenCalledWith('knowledge-mcp: ready\n')
    const entries = await deps.readDir('packages/wiki-ops/src')
    expect(entries.some(entry => entry.name === 'knowledge-mcp.ts' && entry.isFile())).toBe(true)
    expect(await deps.readFile('packages/wiki-ops/package.json')).toContain('"@fro-bot/wiki-ops"')
  })

  it('builds a goke instance that is not the shared core runner', () => {
    const cli = buildKnowledgeCli(memoryDeps({}).deps)

    expect(cli).not.toBe(goke('knowledge'))
    expect(cli.commands).toHaveLength(3)
  })
})
