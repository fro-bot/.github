/**
 * Test support: the four workflow steps that run through `scripts/route-stderr.ts`, read from the real workflow
 * YAML, with the step's `run:` line tokenised the way the shell would split it. A step that smuggles anything the
 * tokenizer does not model (a pipe, a substitution, a redirect, a second line) fails to load, so what a test runs is
 * exactly what the shell would run.
 */

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'

export type RouterStepKey = 'fro-bot-ingest' | 'survey-wiki-commit' | 'survey-corrections'

export interface RouterStep {
  readonly key: RouterStepKey
  readonly file: string
  readonly job: string
  readonly name: string
  /** The step's `run:` text. */
  readonly run: string
  /** Every token after `scripts/route-stderr.ts`: the router's flags, then the wrapped command. */
  readonly argv: readonly string[]
  /** The wrapped command, the last two tokens: `bun scripts/<name>.ts`. */
  readonly wrapped: readonly string[]
  /** `argv` without the wrapped command. */
  readonly routerFlags: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

interface YamlStep {
  readonly name?: string
  readonly run?: string
  readonly env?: Record<string, string>
}
interface YamlWorkflow {
  readonly jobs: Record<string, {readonly steps?: readonly YamlStep[]}>
}

const SHELL_SPECIALS = new Set(['$', '`', ';', '|', '&', '>', '<', '(', ')', '"', '\\', '\n', '\t', '*', '?', '{', '}'])

/** Splits a one-line command on spaces; single quotes group. Throws on anything else the shell would act on. */
export function tokenizeShellLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let quoted = false
  for (const char of line) {
    if (quoted) {
      if (char === "'") quoted = false
      else current += char
      continue
    }
    if (char === "'") {
      quoted = true
      inToken = true
    } else if (char === ' ') {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
    } else if (SHELL_SPECIALS.has(char)) {
      throw new Error(`the run line uses shell syntax the tokenizer does not model: ${JSON.stringify(char)}`)
    } else {
      current += char
      inToken = true
    }
  }
  if (quoted) throw new Error('the run line has an unterminated single quote')
  if (inToken) tokens.push(current)
  return tokens
}

const ROUTER = 'scripts/route-stderr.ts'

function load(file: string): YamlWorkflow {
  const url = new URL(`../../../.github/workflows/${file}`, import.meta.url)
  return parse(readFileSync(fileURLToPath(url), 'utf8')) as YamlWorkflow
}

function toStep(key: RouterStepKey, file: string, job: string, name: string, workflow: YamlWorkflow): RouterStep {
  const step = workflow.jobs[job]?.steps?.find(candidate => candidate.name === name)
  if (step?.run === undefined) throw new Error(`${file}: no step "${name}" in job ${job}`)
  const line = step.run.trim()
  const tokens = tokenizeShellLine(line)
  const at = tokens.indexOf(ROUTER)
  if (tokens[0] !== 'bun' || at !== 1) throw new Error(`${file}: "${name}" does not start with bun ${ROUTER}`)
  const argv = tokens.slice(at + 1)
  const wrapped = argv.slice(-2)
  return {key, file, job, name, run: step.run, argv, wrapped, routerFlags: argv.slice(0, -2), env: step.env ?? {}}
}

/** The four steps, in workflow order: both fro-bot ingest steps, the survey commit, the survey corrections load. */
export function loadRouterSteps(): RouterStep[] {
  const froBot = load('fro-bot.yaml')
  const survey = load('survey-repo.yaml')
  return [
    toStep('fro-bot-ingest', 'fro-bot.yaml', 'fro-bot-wiki-ingest', 'Ingest wiki insight changes', froBot),
    toStep('fro-bot-ingest', 'fro-bot.yaml', 'fro-bot-observe-wiki-ingest', 'Ingest wiki insight changes', froBot),
    toStep('survey-wiki-commit', 'survey-repo.yaml', 'survey-persist', 'Commit wiki ingest to data branch', survey),
    toStep('survey-corrections', 'survey-repo.yaml', 'survey-repo', 'Load correction context', survey),
  ]
}
