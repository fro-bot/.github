/**
 * Contract tests for `.github/actions/knowledge-mcp-summary`, which turns the `knowledge` MCP server's call
 * log into a table in the job summary. The cases run the action's `run:` text under real bash
 * (`@fro-bot/test-kit/workflow-step`). The log is data the model's queries never reach (the server writes
 * only a tool name and a fixed code), but the action still prints nothing from the file except tokens that
 * match the fixed line shape.
 */

import {Buffer} from 'node:buffer'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {runStepWithStubs} from '@fro-bot/test-kit/workflow-step'
import {afterEach, describe, expect, it} from 'vitest'
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
  outputs?: Record<string, unknown>
  runs?: {using?: string; steps?: ActionStep[]}
}

const actionPath = resolve(import.meta.dirname, '../.github/actions/knowledge-mcp-summary/action.yaml')
const action = parse(readFileSync(actionPath, 'utf8')) as ActionFile
const summaryStep = action.runs?.steps?.[0]
const runScript = String(summaryStep?.run ?? '')
const expressionStart = '$' + '{{'

const NO_CALLS = 'Knowledge tools: no calls recorded.\n\n'
const HEADING = '### Knowledge tool calls\n\n| Tool | Code | Calls |\n| --- | --- | ---: |\n'
const SENTINEL = 'sentinel-log-content-6a1c'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-mcp-summary-'))
  dirs.push(dir)
  return dir
}

interface SummaryRun {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  /** What the step appended to the job summary, or `undefined` when the file was never created. */
  readonly summary: string | undefined
}

interface RunOptions {
  /** The `call-log` input. */
  readonly input?: string
  /** What the job summary already holds from earlier steps. */
  readonly summaryBefore?: string
  readonly summaryPath?: 'unset' | 'unwritable'
}

/** Runs the step with the log at `<scratch>/calls.log` holding `content`, or absent when `content` is undefined. */
function run(content: string | Uint8Array | undefined, options: RunOptions = {}): SummaryRun {
  const dir = scratch()
  const log = join(dir, 'calls.log')
  if (content !== undefined) writeFileSync(log, content)
  const summaryFile = join(dir, 'summary.md')
  if (options.summaryBefore !== undefined) writeFileSync(summaryFile, options.summaryBefore)
  const unwritable = join(dir, 'a-directory')
  mkdirSync(unwritable)

  const summaryEnv: Record<string, string> =
    options.summaryPath === 'unset'
      ? {}
      : {GITHUB_STEP_SUMMARY: options.summaryPath === 'unwritable' ? unwritable : summaryFile}
  const result = runStepWithStubs(runScript, {
    env: {KNOWLEDGE_MCP_CALL_LOG: options.input ?? log, ...summaryEnv},
  })
  let summary: string | undefined
  try {
    summary = readFileSync(summaryFile, 'utf8')
  } catch {
    summary = undefined
  }
  return {status: result.status, stdout: result.stdout, stderr: result.stderr, summary}
}

const row = (tool: string, code: string, count: number): string => `| ${tool} | ${code} | ${count} |\n`

describe('knowledge-mcp-summary action: shape', () => {
  it('finds the summary step', () => {
    expect(summaryStep).toBeDefined() // guards against a vacuous pass if the step were renamed or removed
  })

  it('is a composite action with one bash step that runs under always()', () => {
    expect(action.runs?.using).toBe('composite')
    expect(action.runs?.steps).toHaveLength(1)
    expect(summaryStep?.shell).toBe('bash')
    expect(summaryStep?.if).toBe(`${expressionStart} always() }}`)
  })

  it('takes one optional input, call-log, and has no output', () => {
    expect(Object.keys(action.inputs ?? {})).toStrictEqual(['call-log'])
    expect(action.inputs?.['call-log']?.required).toBe(false)
    expect(action.outputs).toBeUndefined()
  })

  it('reaches the shell through env: only, so no expression sits inside run:', () => {
    expect(summaryStep?.env).toStrictEqual({KNOWLEDGE_MCP_CALL_LOG: `${expressionStart} inputs.call-log }}`})
    expect(runScript).not.toContain(expressionStart)
  })

  it('matches only lines of the exact shape, with the tool names spelled out', () => {
    expect(runScript).toContain('^(wiki_search|wiki_linked|solutions_search) [a-z-]+$')
  })

  it('asks for no secret and for no network', () => {
    expect(summaryStep?.env).not.toHaveProperty('GITHUB_TOKEN')
    expect(runScript).not.toMatch(/\b(curl|wget|gh|git)\b/u)
  })
})

describe('knowledge-mcp-summary action: nothing recorded', () => {
  it.each([
    ['an empty input', undefined, ''],
    ['a file that is missing', undefined, undefined],
    ['an empty file', '', undefined],
    ['a file of blank lines', '\n\n\n', undefined],
  ] as const)('writes the one fixed line for %s', (_label, content, input) => {
    const result = run(content, input === undefined ? {} : {input})

    expect(result.status).toBe(0)
    expect(result.summary).toBe(NO_CALLS)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('writes the fixed line when the input names a directory', () => {
    const dir = scratch()

    const result = run(undefined, {input: dir})

    expect(result.status).toBe(0)
    expect(result.summary).toBe(NO_CALLS)
  })

  it('writes the fixed line when the file holds only lines that are not of the shape', () => {
    const result = run(
      [
        `${SENTINEL}`,
        'wiki_search',
        'wiki_search ',
        'wiki_search ok extra',
        'WIKI_SEARCH ok',
        'wiki_search OK',
        'wiki_search ok1',
        'wiki_search ok_ok',
        'other_tool ok',
        ' wiki_search ok',
        'wiki_search ok ',
        'wiki_search  ok',
        'knowledge_wiki_search ok',
        'prefix wiki_search ok',
        '',
      ].join('\n'),
    )

    expect(result.status).toBe(0)
    expect(result.summary).toBe(NO_CALLS)
  })
})

describe('knowledge-mcp-summary action: a table of counts', () => {
  it('counts each tool and code pair under the fixed heading, sorted by tool then code', () => {
    const result = run(
      [
        'wiki_search ok',
        'wiki_search ok',
        'wiki_search invalid-query',
        'solutions_search ok',
        'wiki_linked no-handoff',
        'wiki_search ok',
        'solutions_search corpus-unavailable',
        'wiki_linked handoff-malformed',
        'wiki_search unexpected',
        '',
      ].join('\n'),
    )

    expect(result.status).toBe(0)
    expect(result.summary).toBe(
      `${HEADING}${row('solutions_search', 'corpus-unavailable', 1)}${row('solutions_search', 'ok', 1)}${row('wiki_linked', 'handoff-malformed', 1)}${row('wiki_linked', 'no-handoff', 1)}${row('wiki_search', 'invalid-query', 1)}${row('wiki_search', 'ok', 3)}${row('wiki_search', 'unexpected', 1)}\n`,
    )
    expect(result.stdout).toBe('')
  })

  it('counts a last line that has no trailing newline', () => {
    const result = run('wiki_search ok\nwiki_search ok')

    expect(result.summary).toBe(`${HEADING}${row('wiki_search', 'ok', 2)}\n`)
  })

  it('counts ten or more repeats as one number', () => {
    const result = run('wiki_linked ok\n'.repeat(12))

    expect(result.summary).toBe(`${HEADING}${row('wiki_linked', 'ok', 12)}\n`)
  })

  it('ignores every other line and prints none of its text', () => {
    const result = run(
      [
        'wiki_search ok',
        `${SENTINEL} $(touch /tmp/${SENTINEL}) \`id\``,
        `wiki_search ok; echo ${SENTINEL}`,
        `wiki_linked ok | ${SENTINEL}`,
        `solutions_search ok ${SENTINEL}`,
        'wiki_search ok\r',
        `# ${SENTINEL}`,
        '| a | b |',
        'wiki_linked no-handoff',
        '',
      ].join('\n'),
    )

    expect(result.status).toBe(0)
    expect(result.summary).toBe(`${HEADING}${row('wiki_linked', 'no-handoff', 1)}${row('wiki_search', 'ok', 1)}\n`)
    expect(result.summary).not.toContain(SENTINEL)
    expect(result.stdout + result.stderr).not.toContain(SENTINEL)
  })

  it('reads a file with binary bytes between valid lines without printing them', () => {
    const bytes = Buffer.concat([
      Buffer.from('wiki_search ok\n'),
      Buffer.from([0x00, 0xff, 0xfe, 0x0a]),
      Buffer.from('wiki_search ok\n'),
    ])

    const result = run(bytes)

    expect(result.status).toBe(0)
    expect(result.summary).toBe(`${HEADING}${row('wiki_search', 'ok', 2)}\n`)
    expect(result.stdout + result.stderr).toBe('')
  })

  it('appends to what earlier steps wrote and does not truncate it', () => {
    const result = run('wiki_search ok\n', {summaryBefore: 'earlier step\n'})

    expect(result.summary).toBe(`earlier step\n${HEADING}${row('wiki_search', 'ok', 1)}\n`)
  })

  it('appends the fixed line after what earlier steps wrote', () => {
    const result = run('', {summaryBefore: 'earlier step\n'})

    expect(result.summary).toBe(`earlier step\n${NO_CALLS}`)
  })
})

describe('knowledge-mcp-summary action: it always succeeds', () => {
  it.each([
    ['no summary file is set', {summaryPath: 'unset'}],
    ['the summary path cannot be written', {summaryPath: 'unwritable'}],
  ] as const)('exits zero when %s', (_label, options) => {
    expect(run('wiki_search ok\n', options).status).toBe(0)
    expect(run('', options).status).toBe(0)
    expect(run(undefined, options).status).toBe(0)
  })

  it('exits zero for an input that is not a path', () => {
    for (const input of ['\n', '-', '--help', '-n', `${SENTINEL}/`, '/dev/null/x', '/proc/does/not/exist']) {
      const result = run(undefined, {input})

      expect(result.status, input).toBe(0)
      expect(result.summary, input).toBe(NO_CALLS)
    }
  })
})
