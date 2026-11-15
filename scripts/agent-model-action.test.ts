/**
 * Contract tests for `.github/actions/agent-model`, the one place an agent step's model is chosen. The
 * shell cases run the action's `run:` text under real bash (`@fro-bot/test-kit/workflow-step`), so they cost
 * no network. Which job passes which tier is pinned in `agent-model-callers.test.ts`.
 */

import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
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
  outputs?: Record<string, {description?: string; value?: string}>
  runs?: {using?: string; steps?: ActionStep[]}
}

const actionPath = resolve(import.meta.dirname, '../.github/actions/agent-model/action.yaml')
const action = parse(readFileSync(actionPath, 'utf8')) as ActionFile
const resolveStep = action.runs?.steps?.find(step => step.id === 'resolve')
const runScript = String(resolveStep?.run ?? '')
const expressionStart = '$' + '{{'

type Tier = 'review' | 'act' | 'light'

const TIERS = ['review', 'act', 'light'] as const satisfies readonly Tier[]
const VARIABLE: Record<Tier, string> = {
  review: 'FRO_BOT_MODEL_REVIEW',
  act: 'FRO_BOT_MODEL_ACT',
  light: 'FRO_BOT_MODEL_LIGHT',
}
const SENTINEL = 'sentinel-model-value-5b2f'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true})
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-model-'))
  dirs.push(dir)
  return dir
}

interface ResolveOptions {
  readonly tier: string
  readonly review?: string
  readonly act?: string
  readonly light?: string
  readonly fallback?: string
}

function resolveModel(options: ResolveOptions): ReturnType<typeof runStepWithStubs> {
  return runStepWithStubs(runScript, {
    env: {
      AGENT_MODEL_TIER: options.tier,
      AGENT_MODEL_REVIEW: options.review ?? '',
      AGENT_MODEL_ACT: options.act ?? '',
      AGENT_MODEL_LIGHT: options.light ?? '',
      AGENT_MODEL_FALLBACK: options.fallback ?? '',
    },
  })
}

/** The one input a tier reads, under the key the option object uses for it. */
const own = (tier: Tier, value: string): Partial<Record<Tier, string>> => ({[tier]: value})

const logLine = (model: string, source: string): string => `Agent model: ${model} (from ${source})\n`
const emptyMessage = (tier: Tier): string =>
  `::error::agent-model: no model is set. Set ${VARIABLE[tier]} or FRO_BOT_MODEL in the repository variables.\n`
const lineMessage = (source: string): string => `::error::agent-model: ${source} must be a single line.\n`
const TIER_MESSAGE = '::error::agent-model: tier must be review, act or light.\n'

describe('agent-model action: shape', () => {
  it('finds the resolve step', () => {
    expect(resolveStep).toBeDefined() // guards against a vacuous pass if the step were renamed or removed
  })

  it('is a composite action with one bash step', () => {
    expect(action.runs?.using).toBe('composite')
    expect(action.runs?.steps).toHaveLength(1)
    expect(resolveStep?.shell).toBe('bash')
  })

  it('takes tier, the three tier values and the fallback, and returns one model output', () => {
    expect(Object.keys(action.inputs ?? {})).toStrictEqual(['tier', 'review', 'act', 'light', 'fallback'])
    expect(action.inputs?.tier?.required).toBe(true)
    for (const name of ['review', 'act', 'light', 'fallback']) expect(action.inputs?.[name]?.required, name).toBe(false)
    expect(Object.keys(action.outputs ?? {})).toStrictEqual(['model'])
    expect(action.outputs?.model?.value).toBe(`${expressionStart} steps.resolve.outputs.model }}`)
  })

  it('reaches the shell through env: only, so no expression sits inside run:', () => {
    expect(resolveStep?.env).toStrictEqual({
      AGENT_MODEL_TIER: `${expressionStart} inputs.tier }}`,
      AGENT_MODEL_REVIEW: `${expressionStart} inputs.review }}`,
      AGENT_MODEL_ACT: `${expressionStart} inputs.act }}`,
      AGENT_MODEL_LIGHT: `${expressionStart} inputs.light }}`,
      AGENT_MODEL_FALLBACK: `${expressionStart} inputs.fallback }}`,
    })
    expect(runScript).not.toContain(expressionStart)
  })

  it('sets its own strict mode, because the harness and the runner differ in how they start bash', () => {
    expect(runScript).toMatch(/^set -euo pipefail$/mu)
  })

  it('asks for no secret and for no network', () => {
    expect(resolveStep?.env).not.toHaveProperty('GITHUB_TOKEN')
    expect(runScript).not.toMatch(/\b(curl|wget|gh|git)\b/u)
  })
})

describe('agent-model action: the tier value wins', () => {
  it.each(TIERS)('%s with its own value set returns that value and names its variable', tier => {
    const result = resolveModel({tier, ...own(tier, 'provider/own'), fallback: 'provider/fallback'})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: 'provider/own'})
    expect(result.githubOutput).toBe('model=provider/own\n')
    expect(result.stdout).toBe(logLine('provider/own', VARIABLE[tier]))
    expect(result.stderr).toBe('')
  })

  it.each(TIERS)('%s with no fallback set still returns its own value', tier => {
    const result = resolveModel({tier, ...own(tier, 'provider/own')})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: 'provider/own'})
  })
})

describe('agent-model action: the fallback', () => {
  it.each(TIERS)('%s with its own value empty returns the fallback and names FRO_BOT_MODEL', tier => {
    const result = resolveModel({tier, fallback: 'provider/fallback'})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: 'provider/fallback'})
    expect(result.stdout).toBe(logLine('provider/fallback', 'FRO_BOT_MODEL'))
    expect(result.stderr).toBe('')
  })

  it.each(TIERS)('%s never takes another tier value, whatever the other two hold', tier => {
    const others = {review: 'provider/review', act: 'provider/act', light: 'provider/light'}
    const result = resolveModel({tier, ...others, [tier]: '', fallback: 'provider/fallback'})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: 'provider/fallback'})
    expect(result.stdout).toBe(logLine('provider/fallback', 'FRO_BOT_MODEL'))
  })

  it.each(TIERS)('%s with the other two tiers set and no fallback fails', tier => {
    const others = {review: 'provider/review', act: 'provider/act', light: 'provider/light'}
    const result = resolveModel({tier, ...others, [tier]: ''})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(emptyMessage(tier))
    expect(result.githubOutput).toBe('')
  })
})

describe('agent-model action: whitespace', () => {
  it.each([
    ['spaces', '   '],
    ['a tab', '\t'],
    ['a line break', '\n'],
    ['a carriage return and a line break', '\r\n'],
    ['mixed whitespace', ' \t\r\n '],
  ] as const)('a tier value of only %s counts as empty', (_label, value) => {
    const result = resolveModel({tier: 'review', ...own('review', value), fallback: 'provider/fallback'})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: 'provider/fallback'})
    expect(result.stdout).toBe(logLine('provider/fallback', 'FRO_BOT_MODEL'))
  })

  it('a fallback of only whitespace counts as empty', () => {
    const result = resolveModel({tier: 'light', fallback: ' \n '})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(emptyMessage('light'))
    expect(result.githubOutput).toBe('')
  })

  it.each([
    ['padded with spaces', '  provider/own  '],
    ['followed by a line break', 'provider/own\n'],
    ['followed by a carriage return and a line break', 'provider/own\r\n'],
    ['preceded by a line break', '\nprovider/own'],
    ['wrapped in tabs', '\tprovider/own\t'],
  ] as const)('a tier value %s resolves to the model alone, naming the tier variable', (_label, value) => {
    const result = resolveModel({tier: 'act', ...own('act', value), fallback: 'provider/fallback'})

    expect(result.status).toBe(0)
    expect(result.githubOutput).toBe('model=provider/own\n')
    expect(result.stdout).toBe(logLine('provider/own', 'FRO_BOT_MODEL_ACT'))
  })

  it('a padded fallback resolves to the model alone, naming FRO_BOT_MODEL', () => {
    const result = resolveModel({tier: 'act', fallback: ' provider/fallback \n'})

    expect(result.status).toBe(0)
    expect(result.githubOutput).toBe('model=provider/fallback\n')
    expect(result.stdout).toBe(logLine('provider/fallback', 'FRO_BOT_MODEL'))
  })
})

describe('agent-model action: failures', () => {
  it.each(TIERS)(
    '%s with its own value and the fallback both empty names both variables and writes no output',
    tier => {
      const result = resolveModel({tier})

      expect(result.status).not.toBe(0)
      expect(result.stderr).toBe(emptyMessage(tier))
      expect(result.stderr).toContain(VARIABLE[tier])
      expect(result.stderr).toContain('FRO_BOT_MODEL ')
      expect(result.stdout).toBe('')
      expect(result.githubOutput).toBe('')
    },
  )

  it.each([
    ['an empty tier', ''],
    ['an unknown tier', 'heavy'],
    ['a tier in the wrong case', 'Review'],
    ['a tier with padding', ' review '],
    ['a tier that is a variable name', 'FRO_BOT_MODEL_REVIEW'],
  ] as const)('%s fails with the fixed message and writes no output', (_label, tier) => {
    const result = resolveModel({
      tier,
      review: 'provider/review',
      act: 'provider/act',
      light: 'provider/light',
      fallback: 'provider/fallback',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(TIER_MESSAGE)
    expect(result.stdout).toBe('')
    expect(result.githubOutput).toBe('')
  })

  it('does not echo a hostile tier', () => {
    const result = resolveModel({tier: `::error::${SENTINEL}\nreview`, fallback: 'provider/fallback'})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(TIER_MESSAGE)
    expect(result.stdout + result.stderr + result.githubOutput).not.toContain(SENTINEL)
  })

  it.each(TIERS)('a %s value with a line break inside it fails, names the variable and writes no output', tier => {
    const result = resolveModel({
      tier,
      ...own(tier, `provider/one\nprovider/${SENTINEL}`),
      fallback: 'provider/fallback',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(lineMessage(VARIABLE[tier]))
    expect(result.stdout).toBe('')
    expect(result.githubOutput).toBe('')
    expect(result.stdout + result.stderr + result.githubOutput).not.toContain(SENTINEL)
  })

  it('a value with a carriage return inside it fails the same way', () => {
    const result = resolveModel({
      tier: 'light',
      ...own('light', `provider/one\r${SENTINEL}`),
      fallback: 'provider/fallback',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(lineMessage('FRO_BOT_MODEL_LIGHT'))
    expect(result.githubOutput).toBe('')
    expect(result.stdout + result.stderr).not.toContain(SENTINEL)
  })

  it('a fallback with a line break inside it fails when the tier value is empty, naming FRO_BOT_MODEL', () => {
    const result = resolveModel({tier: 'review', fallback: `provider/one\nprovider/${SENTINEL}`})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toBe(lineMessage('FRO_BOT_MODEL'))
    expect(result.githubOutput).toBe('')
    expect(result.stdout + result.stderr).not.toContain(SENTINEL)
  })

  it('a multi-line value that is never used does not fail the run', () => {
    const result = resolveModel({tier: 'review', review: 'provider/review', light: 'a\nb', fallback: 'c\nd'})

    expect(result.status).toBe(0)
    expect(result.githubOutput).toBe('model=provider/review\n')
  })

  it('a multi-line tier value does not fall through to the fallback', () => {
    const result = resolveModel({tier: 'review', ...own('review', 'a\nb'), fallback: 'provider/fallback'})

    expect(result.status).not.toBe(0)
    expect(result.githubOutput).toBe('')
  })
})

describe('agent-model action: output and log', () => {
  it('prints one line on success and nothing on stderr', () => {
    const result = resolveModel({tier: 'review', ...own('review', 'provider/review')})

    expect(result.stdout.split('\n').filter(line => line !== '')).toStrictEqual([
      'Agent model: provider/review (from FRO_BOT_MODEL_REVIEW)',
    ])
    expect(result.stderr).toBe('')
  })

  it('writes exactly one output line, with no delimiter block', () => {
    const result = resolveModel({tier: 'act', fallback: 'provider/fallback'})

    expect(result.githubOutput).toBe('model=provider/fallback\n')
  })

  it('does not execute a value that holds shell metacharacters, and passes it through unchanged', () => {
    const marker = join(scratch(), 'marker')
    const value = `provider/$(touch ${marker})\`touch ${marker}\`;touch ${marker}|touch ${marker}&&touch ${marker}`
    const result = resolveModel({tier: 'review', ...own('review', value)})

    expect(result.status).toBe(0)
    expect(existsSync(marker)).toBe(false)
    expect(result.outputs).toStrictEqual({model: value})
    expect(result.stdout).toBe(logLine(value, 'FRO_BOT_MODEL_REVIEW'))
  })

  it('keeps a value that starts with the workflow command marker off the start of a line', () => {
    const result = resolveModel({tier: 'review', ...own('review', '::add-mask::value')})

    expect(result.status).toBe(0)
    for (const line of result.stdout.split('\n')) expect(line.startsWith('::')).toBe(false)
  })

  it('treats a glob character and a leading dash as plain text', () => {
    const result = resolveModel({tier: 'light', ...own('light', '-n *')})

    expect(result.status).toBe(0)
    expect(result.outputs).toStrictEqual({model: '-n *'})
    expect(result.stdout).toBe(logLine('-n *', 'FRO_BOT_MODEL_LIGHT'))
  })
})
