/**
 * The `knowledge` MCP server: three read-only lookups an agent run can call mid-run, `wiki_search`,
 * `wiki_linked` and `solutions_search`. OpenCode names them `knowledge_wiki_search` and so on.
 *
 * The server owns a private goke instance and serves it through `@goke/mcp`. Each command calls the
 * code behind an existing CLI in-process (`runWikiContextExpandCli`, `searchSolutions`), so the query
 * validation, private-name filter and byte and page caps are the CLIs' own. Tool arguments arrive as
 * JSON, so no flag parsing touches them: a query that starts with `-` is just text.
 *
 * Boundaries:
 * - Stdout is the JSON-RPC channel. Nothing here writes to it; `@goke/mcp` captures what a command
 *   writes through its own context.
 * - A handler never throws. It returns the JSON result, or `isError` with one fixed code, and the
 *   code is the only thing that leaves: no query, no path, no error message.
 * - Stderr carries `knowledge-mcp: ready` and one fixed `knowledge-mcp: error:<code>` line per error
 *   result, nothing else.
 * - There is no path argument. The handoff path comes from the server definition, as the
 *   `WIKI_CONTEXT_HANDOFF_PATH` variable, and the corpus is read relative to the working directory,
 *   which the definition sets to the checkout root.
 * - The server writes no file and needs no credential. `scripts/knowledge-mcp.ts` removes the two
 *   OpenCode variables from the process before this module loads.
 *
 * This file stays loadable under Node's strip-only mode: no enums, no parameter properties, no
 * namespaces.
 */

import {readdir, readFile} from 'node:fs/promises'
import process from 'node:process'

import {createMcpAction} from '@goke/mcp'
import {goke} from 'goke'
import {z} from 'zod'

import {searchSolutions} from './solutions-query.ts'
import {parseHandoffContent, runWikiContextExpandCli} from './wiki-context-expand.ts'

/** The only text an error result carries. */
export type KnowledgeErrorCode =
  'no-handoff' | 'handoff-malformed' | 'invalid-query' | 'corpus-unavailable' | 'unexpected'

/** A function so a mutant in the names is exercised whenever a test reads them. */
export function knowledgeToolNames(): readonly string[] {
  return ['wiki_search', 'wiki_linked', 'solutions_search']
}

/** What a handler returns: the MCP result shape, built here so `@goke/mcp` passes it through as is. */
export interface KnowledgeToolResult {
  readonly content: readonly {readonly type: 'text'; readonly text: string}[]
  readonly isError?: true
}

export interface KnowledgeDeps {
  /** Only `WIKI_CONTEXT_HANDOFF_PATH` is read. */
  readonly env: Readonly<Record<string, string | undefined>>
  readonly readDir: (path: string) => Promise<{name: string; isFile: () => boolean}[]>
  readonly readFile: (path: string) => Promise<string>
  /** Receives whole lines, newline included. */
  readonly writeStderr: (line: string) => void
  readonly expand: typeof runWikiContextExpandCli
  readonly searchSolutions: typeof searchSolutions
}

/** The deps a served process uses: the checkout-relative disk, the process env and real stderr. */
export function defaultKnowledgeDeps(): KnowledgeDeps {
  return {
    env: process.env,
    readDir: async path => readdir(path, {withFileTypes: true}),
    readFile: async path => readFile(path, 'utf8'),
    writeStderr: line => {
      process.stderr.write(line)
    },
    expand: runWikiContextExpandCli,
    searchSolutions,
  }
}

function succeed(value: unknown): KnowledgeToolResult {
  return {content: [{type: 'text', text: JSON.stringify(value)}]}
}

function fail(deps: KnowledgeDeps, code: KnowledgeErrorCode): KnowledgeToolResult {
  deps.writeStderr(`knowledge-mcp: error:${code}\n`)
  return {isError: true, content: [{type: 'text', text: JSON.stringify({error: code})}]}
}

/** Runs a handler body and turns anything it throws into the fixed `unexpected` result. */
async function guarded(deps: KnowledgeDeps, run: () => Promise<KnowledgeToolResult>): Promise<KnowledgeToolResult> {
  try {
    return await run()
  } catch {
    return fail(deps, 'unexpected')
  }
}

function ignore(): void {
  // A sink for the streams `runWikiContextExpandCli` writes to; the tool answers in its response only.
}

type ExpandOutcome = Awaited<ReturnType<typeof runWikiContextExpandCli>>

/**
 * Maps the CLI outcome onto the tool contract: an empty match is a result, a broken corpus or handoff
 * is an error. A result with no reason is a populated one. A non-zero exit or no result at all means
 * the arguments were not accepted (bad argv or help), so the query never reached the corpus.
 */
function fromExpand(deps: KnowledgeDeps, outcome: ExpandOutcome): KnowledgeToolResult {
  const {exitCode, result} = outcome
  if (exitCode !== 0 || result === undefined) return fail(deps, 'invalid-query')

  switch (result.reason) {
    case 'invalid-query':
    case 'bad-args':
      return fail(deps, 'invalid-query')
    case 'no-corpus':
    case 'private-token-load-failed':
      return fail(deps, 'corpus-unavailable')
    case 'no-handoff':
      return fail(deps, 'no-handoff')
    case 'malformed-handoff':
      return fail(deps, 'handoff-malformed')
    case 'no-match':
    case 'no-links':
    case undefined:
      return succeed(result)
  }
}

async function wikiSearch(deps: KnowledgeDeps, query: unknown): Promise<KnowledgeToolResult> {
  return guarded(deps, async () => {
    if (typeof query !== 'string') return fail(deps, 'invalid-query')

    const outcome = await deps.expand({
      argv: ['query', query],
      env: {},
      readDir: deps.readDir,
      readFile: deps.readFile,
      writeStdout: ignore,
      writeStderr: ignore,
    })
    return fromExpand(deps, outcome)
  })
}

async function wikiLinked(deps: KnowledgeDeps): Promise<KnowledgeToolResult> {
  return guarded(deps, async () => {
    // The handoff is checked before the corpus loads, so a broken handoff is never reported as an empty expansion.
    const handoffPath = deps.env.WIKI_CONTEXT_HANDOFF_PATH
    if (handoffPath === undefined || handoffPath === '') return fail(deps, 'no-handoff')

    let content: string
    try {
      content = await deps.readFile(handoffPath)
    } catch {
      return fail(deps, 'no-handoff')
    }
    if (parseHandoffContent(content).status !== 'ok') return fail(deps, 'handoff-malformed')

    const outcome = await deps.expand({
      argv: ['linked'],
      env: {WIKI_CONTEXT_HANDOFF_PATH: handoffPath},
      readDir: deps.readDir,
      readFile: deps.readFile,
      writeStdout: ignore,
      writeStderr: ignore,
    })
    return fromExpand(deps, outcome)
  })
}

async function solutionsSearch(deps: KnowledgeDeps, query: unknown): Promise<KnowledgeToolResult> {
  return guarded(deps, async () => {
    if (typeof query !== 'string') return fail(deps, 'invalid-query')

    const outcome = await deps.searchSolutions(query, {readDir: deps.readDir, readFile: deps.readFile})
    if (outcome.ok) return succeed(outcome.result)
    return fail(deps, outcome.reason === 'invalid-query' ? 'invalid-query' : 'corpus-unavailable')
  })
}

/**
 * Registers the three commands on a fresh goke instance. The query is a required `--query` option, not
 * a positional: `@goke/mcp` gives a positional a plain string schema, while an option carries its zod
 * schema and the adapter rejects a call that leaves it out before the handler runs.
 */
export function buildKnowledgeCli(deps: KnowledgeDeps): ReturnType<typeof goke> {
  const cli = goke('knowledge')

  cli
    .command(
      'wiki_search',
      'Search the Fro Bot knowledge wiki for pages relevant to a short plain-language query. Returns at most three pages as JSON with their paths.',
    )
    .option('--query <query>', z.string().describe('What to look for, in plain words. Free text; it is never a path.'))
    .required()
    .action(async options => wikiSearch(deps, options.query))

  cli
    .command(
      'wiki_linked',
      'Expand the wiki pages this run already received: returns the pages they link to as JSON. Takes no arguments.',
    )
    .action(async () => wikiLinked(deps))

  cli
    .command(
      'solutions_search',
      'Search the documented solutions (docs/solutions) for prior learnings relevant to a short plain-language query. Returns the best matches as JSON with their paths.',
    )
    .option('--query <query>', z.string().describe('What to look for, in plain words. Free text; it is never a path.'))
    .required()
    .action(async options => solutionsSearch(deps, options.query))

  return cli
}

export interface ServeOptions {
  readonly deps?: KnowledgeDeps
  /** Defaults to `buildKnowledgeCli(deps)`. A test passes one with extra commands to prove the allowlist hides them. */
  readonly cli?: ReturnType<typeof buildKnowledgeCli>
  /** Defaults to stdio. A test passes an in-memory transport. */
  readonly createTransport?: Parameters<typeof createMcpAction>[0]['createTransport']
}

/**
 * Starts the server and returns once it is connected. It calls the `createMcpAction` callback
 * directly (the server takes its name, `knowledge`, from the goke instance): with an empty argv goke would match no command, exit, and never speak JSON-RPC. A startup
 * failure writes one fixed line and sets the exit code; the agent then runs without the tools.
 */
export async function serve(options: ServeOptions = {}): Promise<void> {
  const deps = options.deps ?? defaultKnowledgeDeps()
  try {
    const names = new Set(knowledgeToolNames())
    const start = createMcpAction({
      cli: options.cli ?? buildKnowledgeCli(deps),
      commandFilter: name => names.has(name),
      createTransport: options.createTransport,
    })
    await start()
    deps.writeStderr('knowledge-mcp: ready\n')
  } catch {
    deps.writeStderr('knowledge-mcp: error:startup\n')
    process.exitCode = 1
  }
}
