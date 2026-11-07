/**
 * Contract tests for `.github/actions/knowledge-mcp-config`, the one place the `knowledge` MCP server is
 * merged into an agent step's `opencode-config`. The shell cases run the action's `run:` text under
 * real bash and real `jq` (`@fro-bot/test-kit/workflow-step`), so they cost no network. The server
 * entry is checked against a copy of the shape rules fro-bot/agent applies to a local server
 * (`src/services/setup/mcp-servers-v2.ts`), which reject a string `command` and fail the whole setup.
 */

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'

interface ActionStep {
  name?: string
  id?: string
  if?: string
  run?: string
  shell?: string
  env?: Record<string, unknown>
}

interface ActionFile {
  inputs?: Record<string, {description?: string; required?: boolean; default?: unknown}>
  outputs?: Record<string, {description?: string; value?: string}>
  runs?: {using?: string; steps?: ActionStep[]}
}

const actionPath = resolve(import.meta.dirname, '../.github/actions/knowledge-mcp-config/action.yaml')
const action = parse(readFileSync(actionPath, 'utf8')) as ActionFile
const mergeStep = action.runs?.steps?.find(step => step.id === 'merge')
const runScript = String(mergeStep?.run ?? '')
const expressionStart = '$' + '{{'

const WORKSPACE = '/home/runner/work/repo/repo'
const HANDOFF = '/home/runner/work/_temp/wiki-context-handoff.json'
const SERVER_COMMAND = ['bun', 'scripts/knowledge-mcp.ts']
const SENTINEL = 'sentinel-secret-value-7d3e'

interface MergeOptions {
  config?: string
  handoff?: string
  fork?: string
  workspace?: string
}

function runMerge(options: MergeOptions = {}) {
  return runStepWithStubs(runScript, {
    env: {
      KNOWLEDGE_MCP_CONFIG: options.config ?? '',
      KNOWLEDGE_MCP_HANDOFF_PATH: options.handoff ?? HANDOFF,
      KNOWLEDGE_MCP_FORK: options.fork ?? '',
      GITHUB_WORKSPACE: options.workspace ?? WORKSPACE,
    },
  })
}

type Json = Record<string, unknown>

function merged(options: MergeOptions = {}): {result: ReturnType<typeof runMerge>; config: Json} {
  const result = runMerge(options)
  expect(result.status, result.stderr).toBe(0)
  return {result, config: JSON.parse(result.outputs['opencode-config'] ?? 'null') as Json}
}

/** The agent's rule for a server entry: a `type`-carrying value under `servers` is one server named `servers`. */
function isDirectServer(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const type = (value as Json).type
  return (
    type === 'local' ||
    type === 'remote' ||
    (typeof type === 'string' && (type.includes('{env:') || type.includes('{file:')))
  )
}

/** A copy of the local-server rules at mcp-servers-v2.ts:171-192. Returns the reason it is rejected, or undefined. */
function localServerFault(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object'
  const server = value as Json
  if (server.type !== 'local') return 'type must be "local"'
  const {command} = server
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every(part => typeof part === 'string') ||
    command[0] === ''
  ) {
    return 'local servers need a non-empty command array of strings'
  }
  if (server.cwd !== undefined && typeof server.cwd !== 'string') return 'cwd must be a string'
  const {environment} = server
  if (
    environment !== undefined &&
    !(
      typeof environment === 'object' &&
      environment !== null &&
      !Array.isArray(environment) &&
      Object.values(environment).every(entry => typeof entry === 'string')
    )
  ) {
    return 'environment must be an object of strings'
  }
  return undefined
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReference(value: unknown): boolean {
  return typeof value === 'string' && (value.includes('{env:') || value.includes('{file:'))
}

function isPositiveInt(value: unknown): boolean {
  return isReference(value) || (typeof value === 'number' && Number.isInteger(value) && value > 0)
}

/** `isEnabledOnly` at mcp-servers-v2.ts:136-138: a legacy `{enabled: <boolean>}` entry with no `type` key is skipped. */
function isEnabledOnly(value: unknown): boolean {
  return isRecord(value) && !('type' in value) && typeof value.enabled === 'boolean'
}

interface AgentEntry {
  readonly name: string
  readonly value: unknown
  readonly origin: 'legacy' | 'native'
}

/**
 * A port of the entry selection in `parseMcpServersV2` (fro-bot/agent v0.136.0, mcp-servers-v2.ts:229-262):
 * which keys are servers, which spelling declares each, and where it fails before any server is parsed.
 */
function agentEntries(mcp: unknown): {ok: true; entries: AgentEntry[]} | {ok: false; message: string} {
  if (!isRecord(mcp)) return {ok: false, message: 'mcp must be a JSON object'}
  const entries: AgentEntry[] = []
  for (const [key, value] of Object.entries(mcp)) {
    if (isEnabledOnly(value)) continue
    if (key === 'servers' && !isDirectServer(value)) {
      if (!isRecord(value)) return {ok: false, message: 'mcp.servers must be a JSON object'}
      for (const [name, server] of Object.entries(value)) entries.push({name, value: server, origin: 'native'})
      continue
    }
    if (key === 'timeout' && !isDirectServer(value)) {
      if (!(isPositiveInt(value) || (isRecord(value) && Object.values(value).every(isPositiveInt)))) {
        return {ok: false, message: 'mcp.timeout is malformed'}
      }
      continue
    }
    entries.push({name: key, value, origin: 'legacy'})
  }
  return {ok: true, entries}
}

/** Decodes a workflow command's data the way the runner does. */
function decodeCommandData(data: string): string {
  return data.replaceAll('%0D', '\r').replaceAll('%0A', '\n').replaceAll('%25', '%')
}

const maskLines = (stdout: string): string[] => stdout.split('\n').filter(line => line.startsWith('::add-mask::'))

describe('knowledge-mcp-config action: shape', () => {
  it('finds the merge step', () => {
    expect(mergeStep).toBeDefined() // guards against a vacuous pass if the step were renamed or removed
  })

  it('is a composite action whose run step pins shell: bash and runs under always()', () => {
    expect(action.runs?.using).toBe('composite')
    expect(mergeStep?.shell).toBe('bash')
    expect(mergeStep?.if).toBe(`${expressionStart} always() }}`)
  })

  it('takes opencode-config, handoff-path and fork, all optional, and returns opencode-config', () => {
    expect(Object.keys(action.inputs ?? {}).toSorted()).toStrictEqual(['fork', 'handoff-path', 'opencode-config'])
    for (const input of Object.values(action.inputs ?? {})) expect(input.required).toBe(false)
    expect(Object.keys(action.outputs ?? {})).toStrictEqual(['opencode-config'])
    expect(action.outputs?.['opencode-config']?.value).toBe(`${expressionStart} steps.merge.outputs.opencode-config }}`)
  })

  it('reaches the shell through an exact env: map, so no expression sits inside any run:', () => {
    expect(mergeStep?.env).toStrictEqual({
      KNOWLEDGE_MCP_CONFIG: `${expressionStart} inputs.opencode-config }}`,
      KNOWLEDGE_MCP_HANDOFF_PATH: `${expressionStart} inputs.handoff-path }}`,
      KNOWLEDGE_MCP_FORK: `${expressionStart} inputs.fork }}`,
    })
    for (const step of action.runs?.steps ?? []) {
      expect(String(step.run ?? '')).not.toContain(expressionStart)
    }
  })

  it('discards the stderr of every jq call, and never uses // as a presence test', () => {
    const calls = runScript.match(/\| jq /gu)?.length ?? 0
    expect(calls).toBeGreaterThanOrEqual(5)
    expect(runScript.match(/2>\/dev\/null|2>&1/gu)).toHaveLength(calls)
    expect(runScript).not.toMatch(/\/\/ ?\{/u)
  })

  it('masks the merged value before it writes the output, and writes the output once on the merge path', () => {
    const maskAt = runScript.indexOf('::add-mask::')
    const lastWriteAt = runScript.lastIndexOf('>> "$GITHUB_OUTPUT"')
    expect(maskAt).toBeGreaterThan(runScript.indexOf('jq -c'))
    expect(lastWriteAt).toBeGreaterThan(maskAt)
    expect(runScript.slice(maskAt, lastWriteAt)).not.toContain('GITHUB_OUTPUT')
    // One write for the fork pass-through, one for the merge.
    expect(runScript.match(/GITHUB_OUTPUT/gu)).toHaveLength(2)
  })

  it('writes the server command as a JSON array, never a string', () => {
    expect(runScript).toContain('command: ["bun", "scripts/knowledge-mcp.ts"]')
  })
})

describe('knowledge-mcp-config action: the server entry', () => {
  it('adds mcp.knowledge to an empty secret, with an array command, the handoff path and an absolute cwd', () => {
    const {config} = merged()

    expect(config).toStrictEqual({
      mcp: {
        knowledge: {
          type: 'local',
          command: SERVER_COMMAND,
          cwd: WORKSPACE,
          environment: {WIKI_CONTEXT_HANDOFF_PATH: HANDOFF},
        },
      },
    })
  })

  it('treats a whitespace-only secret as empty', () => {
    const {config} = merged({config: '  \n\t '})

    expect(Object.keys(config)).toStrictEqual(['mcp'])
  })

  it('keeps the other keys and the other mcp servers unchanged and adds knowledge beside them', () => {
    const secret = {
      model: 'anthropic/claude',
      agent: {build: {steps: 3}},
      mcp: {other: {type: 'remote', url: 'https://example.com/mcp'}, timeout: 5000},
    }

    const {config} = merged({config: JSON.stringify(secret)})

    expect(config.model).toBe(secret.model)
    expect(config.agent).toStrictEqual(secret.agent)
    const mcp = config.mcp as Json
    expect(mcp.other).toStrictEqual(secret.mcp.other)
    expect(mcp.timeout).toBe(5000)
    expect(localServerFault(mcp.knowledge)).toBeUndefined()
  })

  it('accepts a pretty-printed multi-line secret', () => {
    const {config} = merged({
      config: JSON.stringify({model: 'm', mcp: {a: {type: 'remote', url: 'https://x.test'}}}, null, 2),
    })

    expect(config.model).toBe('m')
    expect((config.mcp as Json).a).toStrictEqual({type: 'remote', url: 'https://x.test'})
  })

  it('adds knowledge under a native mcp.servers map', () => {
    const secret = {mcp: {servers: {other: {type: 'local', command: ['node', 'x.js']}}}}

    const {config} = merged({config: JSON.stringify(secret)})

    const mcp = config.mcp as {servers: Json; knowledge?: unknown}
    expect(mcp.knowledge).toBeUndefined()
    expect(mcp.servers.other).toStrictEqual(secret.mcp.servers.other)
    expect(localServerFault(mcp.servers.knowledge)).toBeUndefined()
  })

  it('adds knowledge beside a legacy server that happens to be named servers', () => {
    // A `servers` value that carries `type` is one server, not the native map.
    const secret = {mcp: {servers: {type: 'remote', url: 'https://example.com/mcp'}}}
    expect(isDirectServer(secret.mcp.servers)).toBe(true)

    const {config} = merged({config: JSON.stringify(secret)})

    const mcp = config.mcp as Json
    expect(mcp.servers).toStrictEqual(secret.mcp.servers)
    expect(localServerFault(mcp.knowledge)).toBeUndefined()
  })

  it.each([
    ['a referenced type', {type: '{env:SERVER_TYPE}'}],
    ['a local type', {type: 'local', command: ['x']}],
  ])('treats a servers value with %s as a server named servers, not the native map', (_label, servers) => {
    const {config} = merged({config: JSON.stringify({mcp: {servers}})})

    const mcp = config.mcp as Json
    expect(mcp.servers).toStrictEqual(servers)
    expect(localServerFault(mcp.knowledge)).toBeUndefined()
  })

  it('treats a servers value that is not an object as no native map and writes mcp.knowledge', () => {
    const {config} = merged({config: JSON.stringify({mcp: {servers: 5}})})

    const mcp = config.mcp as Json
    expect(mcp.servers).toBe(5)
    expect(localServerFault(mcp.knowledge)).toBeUndefined()
  })

  it.each([
    ['an empty mcp', {}, 'legacy'],
    ['another legacy server', {other: {type: 'remote', url: 'https://example.com/mcp'}}, 'legacy'],
    ['a native servers map', {servers: {other: {type: 'local', command: ['node', 'x.js']}}}, 'native'],
    ['a native servers map that is empty', {servers: {}}, 'native'],
    ['a legacy server named servers', {servers: {type: 'remote', url: 'https://example.com/mcp'}}, 'legacy'],
    ['an enabled-only servers entry (false)', {servers: {enabled: false}}, 'legacy'],
    ['an enabled-only servers entry (true)', {servers: {enabled: true}}, 'legacy'],
    ['an mcp.timeout block beside a server', {timeout: 5000, other: {type: 'remote', url: 'https://x.test'}}, 'legacy'],
  ] as const)('the agent finds exactly one valid knowledge server beside %s', (_label, mcp, origin) => {
    // #given an mcp block of this shape
    const {config} = merged({config: JSON.stringify({mcp})})

    // #when the agent's entry selection reads the merged block
    const selection = agentEntries(config.mcp)

    // #then it finds exactly one knowledge entry, under the spelling the agent would read it from, with a valid local shape
    expect(selection.ok).toBe(true)
    if (!selection.ok) return
    const found = selection.entries.filter(entry => entry.name === 'knowledge')
    expect(found).toHaveLength(1)
    expect(found[0]?.origin).toBe(origin)
    expect(localServerFault(found[0]?.value)).toBeUndefined()
    // The operator's own entries are untouched.
    for (const [key, value] of Object.entries(mcp)) {
      if (key === 'servers' && origin === 'native') continue
      expect((config.mcp as Json)[key]).toStrictEqual(value)
    }
  })

  it('writes mcp.knowledge, not mcp.servers.knowledge, beside an enabled-only servers entry', () => {
    const {config} = merged({config: JSON.stringify({mcp: {servers: {enabled: false}}})})

    const mcp = config.mcp as Json
    expect(mcp.servers).toStrictEqual({enabled: false})
    expect(localServerFault(mcp.knowledge)).toBeUndefined()
  })

  it('writes no environment when the handoff path is empty', () => {
    const {config} = merged({handoff: ''})

    const knowledge = (config.mcp as Json).knowledge as Json
    expect(knowledge).toStrictEqual({type: 'local', command: SERVER_COMMAND, cwd: WORKSPACE})
    expect(localServerFault(knowledge)).toBeUndefined()
  })

  it('resolves a relative handoff path against the workspace', () => {
    const {config} = merged({handoff: '.github/handoff.json'})

    const knowledge = (config.mcp as Json).knowledge as {environment: Json}
    expect(knowledge.environment.WIKI_CONTEXT_HANDOFF_PATH).toBe(`${WORKSPACE}/.github/handoff.json`)
  })

  it('passes the entry through a copy of the agent shape rules, and a string command would fail them', () => {
    const {config} = merged()
    const knowledge = (config.mcp as Json).knowledge as Json

    expect(localServerFault(knowledge)).toBeUndefined()
    expect(localServerFault({...knowledge, command: 'bun scripts/knowledge-mcp.ts'})).toBe(
      'local servers need a non-empty command array of strings',
    )
  })

  it('writes no {env:} or {file:} reference, whatever the handoff path says', () => {
    const {result} = merged()

    expect(result.outputs['opencode-config']).not.toContain('{env:')
    expect(result.outputs['opencode-config']).not.toContain('{file:')
  })

  it('emits compact single-line JSON', () => {
    const {result} = merged({config: JSON.stringify({model: 'm'}, null, 2)})

    expect(result.githubOutput).toMatch(/^opencode-config=\{.*\}\n$/u)
    expect(result.githubOutput.split('\n').filter(line => line !== '')).toHaveLength(1)
  })
})

describe('knowledge-mcp-config action: a fork', () => {
  it('passes the secret through unchanged and adds nothing', () => {
    const secret = JSON.stringify({model: 'm', mcp: {other: {type: 'remote', url: 'https://x.test'}}}, null, 2)

    const result = runMerge({config: secret, fork: 'true'})

    expect(result.status).toBe(0)
    expect(result.outputs['opencode-config']).toBe(secret)
    expect(result.outputs['opencode-config']).not.toContain('knowledge')
    expect(maskLines(result.stdout)).toStrictEqual([])
  })

  it('passes an empty secret through as empty', () => {
    const result = runMerge({config: '', fork: 'true'})

    expect(result.status).toBe(0)
    expect(result.outputs['opencode-config']).toBe('')
  })

  it('passes a secret that is not valid JSON through without judging it', () => {
    const result = runMerge({config: 'not json', fork: 'true'})

    expect(result.status).toBe(0)
    expect(result.outputs['opencode-config']).toBe('not json')
  })

  it('does not treat any other fork value as a fork', () => {
    const {config} = merged({fork: 'false'})

    expect((config.mcp as Json).knowledge).toBeDefined()
  })
})

describe('knowledge-mcp-config action: refusals', () => {
  const FAILURES = {
    json: '::error::knowledge-mcp-config: opencode-config is not valid JSON\n',
    object: '::error::knowledge-mcp-config: opencode-config must be a JSON object\n',
    mcp: '::error::knowledge-mcp-config: opencode-config mcp must be a JSON object\n',
    collision: '::error::knowledge-mcp-config: opencode-config already defines a knowledge MCP server\n',
  } as const

  it.each([
    ['malformed JSON', `{"mcp": {"x": "${SENTINEL}"`, FAILURES.json],
    ['a bare word', SENTINEL, FAILURES.json],
    ['an array', JSON.stringify([SENTINEL]), FAILURES.object],
    ['a string', JSON.stringify(SENTINEL), FAILURES.object],
    ['a number', '7', FAILURES.object],
    ['null', 'null', FAILURES.object],
    ['an mcp string', JSON.stringify({mcp: SENTINEL}), FAILURES.mcp],
    ['an mcp array', JSON.stringify({mcp: [SENTINEL]}), FAILURES.mcp],
    ['an mcp false', JSON.stringify({mcp: false}), FAILURES.mcp],
    ['an mcp null', JSON.stringify({mcp: null}), FAILURES.mcp],
    [
      'a legacy knowledge server',
      JSON.stringify({mcp: {knowledge: {type: 'remote', url: `https://${SENTINEL}.test`}}}),
      FAILURES.collision,
    ],
    [
      'a native knowledge server',
      JSON.stringify({mcp: {servers: {knowledge: {type: 'local', command: [SENTINEL]}}}}),
      FAILURES.collision,
    ],
    ['a disabled legacy knowledge entry', JSON.stringify({mcp: {knowledge: {enabled: false}}}), FAILURES.collision],
    ['a null knowledge entry', JSON.stringify({mcp: {knowledge: null}}), FAILURES.collision],
  ])(
    '%s: exits non-zero with a fixed message, writes no output and prints no part of the secret',
    (_label, config, message) => {
      const result = runMerge({config})

      expect(result.status).not.toBe(0)
      expect(result.stderr).toBe(message)
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('')
      expect(result.stdout + result.stderr).not.toContain(SENTINEL)
    },
  )

  it('refuses a workspace path that is not absolute', () => {
    const result = runMerge({workspace: 'relative/path'})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe('::error::knowledge-mcp-config: the workspace path is not absolute\n')
    expect(result.githubOutput).toBe('')
  })

  it('refuses an unset workspace', () => {
    const result = runMerge({workspace: ''})

    expect(result.status).not.toBe(0)
    expect(result.githubOutput).toBe('')
  })
})

describe('knowledge-mcp-config action: the secret stays out of the log', () => {
  it('prints the merged value only on its mask line, and writes the output only on one output line', () => {
    const secret = JSON.stringify({model: SENTINEL, mcp: {other: {type: 'remote', url: `https://${SENTINEL}.test`}}})

    const result = runMerge({config: secret})

    expect(result.status).toBe(0)
    const outsideMask = result.stdout
      .split('\n')
      .filter(line => !line.startsWith('::add-mask::'))
      .join('\n')
    expect(outsideMask).not.toContain(SENTINEL)
    expect(result.stderr).toBe('')
    expect(result.githubOutput.split('\n').filter(line => line.includes(SENTINEL))).toHaveLength(1)
    expect(maskLines(result.stdout)).toHaveLength(1)
  })

  it('masks a value whose decoded form equals the emitted output, through %-sequences in the secret', () => {
    const secret = JSON.stringify({note: '100%25 literal %0A and %0D and %', model: 'm'})

    const result = runMerge({config: secret})

    expect(result.status).toBe(0)
    const [line] = maskLines(result.stdout)
    expect(line).toBeDefined()
    expect(decodeCommandData((line ?? '').slice('::add-mask::'.length))).toBe(result.outputs['opencode-config'])
    // The escaping is real: the raw line holds no bare % that was not escaped from the value.
    expect(line).toContain('%2525')
  })

  it('masks a value that carries a newline-bearing escape sequence without breaking the command line', () => {
    const secret = JSON.stringify({note: 'line one\nline two\r\nline three'})

    const result = runMerge({config: secret})

    expect(result.status).toBe(0)
    expect(maskLines(result.stdout)).toHaveLength(1)
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(decodeCommandData((maskLines(result.stdout)[0] ?? '').slice('::add-mask::'.length))).toBe(
      result.outputs['opencode-config'],
    )
  })

  it('never prints the sentinel from a wrong-typed mcp value', () => {
    const result = runMerge({config: JSON.stringify({mcp: {knowledge: SENTINEL}})})

    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr + result.githubOutput).not.toContain(SENTINEL)
  })
})
