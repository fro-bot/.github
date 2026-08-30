import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'

import {
  CORRECTIONS_PATH,
  CorrectionStoreError,
  readCorrections,
  reconfirmCorrection,
  recordCorrection,
  retireCorrection,
  writeCorrections,
  type CorrectionAttribution,
  type CorrectionRecord,
  type CorrectionsFile,
  type ReadUtf8File,
  type WriteUtf8File,
} from '@fro-bot/wiki-write-core/corrections'

type LifecycleCommand = 'record' | 'retire' | 'reconfirm' | 'supersede'

const LIFECYCLE_COMMANDS = ['record', 'retire', 'reconfirm', 'supersede'] as const

export interface CorrectionLifecycleCliDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly now?: () => Date
  readonly readFile?: ReadUtf8File
  readonly writeFile?: WriteUtf8File
  readonly stdout?: (value: string) => void
  readonly stderr?: (value: string) => void
  readonly cwd?: string
  readonly repositoryRoot?: string
}

export interface CorrectionLifecycleCliSuccess {
  readonly ok: true
  readonly command: LifecycleCommand
  readonly path: typeof CORRECTIONS_PATH
  readonly correction: CorrectionRecord
}

export interface CorrectionLifecycleCliErrorPayload {
  readonly code: string
  readonly message: string
  readonly remediation: string
  readonly path?: string
}

export interface CorrectionLifecycleCliFailure {
  readonly ok: false
  readonly error: CorrectionLifecycleCliErrorPayload
}

export type CorrectionLifecycleCliResult = CorrectionLifecycleCliSuccess | CorrectionLifecycleCliFailure

export interface CorrectionLifecycleCliHelp {
  readonly ok: true
  readonly command: 'help'
  readonly commands: Readonly<
    Record<LifecycleCommand, {readonly required: readonly string[]; readonly optional: readonly string[]}>
  >
  readonly failure_codes: readonly string[]
  readonly failure_code_descriptions: Readonly<Record<string, string>>
}

export interface CorrectionLifecycleCliCommandHelp {
  readonly ok: true
  readonly command: LifecycleCommand
  readonly required: readonly string[]
  readonly optional: readonly string[]
  readonly failure_codes: readonly string[]
  readonly failure_code_descriptions: Readonly<Record<string, string>>
}

export class CorrectionLifecycleCliError extends Error {
  readonly code: 'INVALID_ARGUMENT' | 'MISSING_ACTOR' | 'INVALID_CONTEXT'
  readonly remediation: string

  constructor(code: 'INVALID_ARGUMENT' | 'MISSING_ACTOR' | 'INVALID_CONTEXT', message: string, remediation: string) {
    super(message)
    this.name = 'CorrectionLifecycleCliError'
    this.code = code
    this.remediation = remediation
  }
}

interface ParsedArguments {
  readonly command: LifecycleCommand
  readonly options: ReadonlyMap<string, string>
}

export async function executeCorrectionLifecycle(
  args: readonly string[],
  dependencies: Omit<CorrectionLifecycleCliDependencies, 'stdout' | 'stderr'> = {},
): Promise<CorrectionLifecycleCliSuccess> {
  const parsed = parseArguments(args)
  assertRepositoryRoot(dependencies.cwd ?? process.cwd(), dependencies.repositoryRoot)
  const readFileImpl = dependencies.readFile ?? (async (path, encoding) => readFile(path, encoding))
  const writeFileImpl =
    dependencies.writeFile ?? (async (path, content, encoding) => writeFile(path, content, encoding))
  const {corrections} = await readCorrections(readFileImpl)
  const next = applyCommand(
    parsed,
    corrections,
    dependencies.env ?? process.env,
    dependencies.now ?? (() => new Date()),
  )
  await writeCorrections(next.file, writeFileImpl, CORRECTIONS_PATH)

  return {
    ok: true,
    command: parsed.command,
    path: CORRECTIONS_PATH,
    correction: next.correction,
  }
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CorrectionLifecycleCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? (value => process.stdout.write(value))
  const stderr = dependencies.stderr ?? (value => process.stderr.write(value))
  const helpIndex = findHelpOption(args)
  if (args[0] === 'help' || args[0] === '--help') {
    stdout(`${JSON.stringify(buildHelp())}\n`)
    return 0
  }
  if (helpIndex !== -1) {
    const command = args[0]
    stdout(`${JSON.stringify(isLifecycleCommand(command) ? buildCommandHelp(command) : buildHelp())}\n`)
    return 0
  }
  try {
    const result = await executeCorrectionLifecycle(args, dependencies)
    stdout(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error: unknown) {
    const payload = toFailure(error)
    stderr(`${JSON.stringify(payload)}\n`)
    return 1
  }
}

export function buildHelp(): CorrectionLifecycleCliHelp {
  return {
    ok: true,
    command: 'help',
    commands: {
      record: {required: ['--id', '--node-id', '--text'], optional: ['--start', '--end']},
      retire: {required: ['--id'], optional: []},
      reconfirm: {required: ['--id'], optional: []},
      supersede: {required: ['--id', '--supersedes-id', '--node-id', '--text'], optional: ['--start', '--end']},
    },
    failure_codes: [
      'INVALID_ARGUMENT',
      'MISSING_ACTOR',
      'INVALID_CONTEXT',
      'INVALID_CORRECTIONS',
      'CORRECTION_NOT_FOUND',
      'INVALID_TRANSITION',
      'READ_FAILED',
      'WRITE_FAILED',
      'IO_FAILURE',
      'RUNTIME_FAILURE',
    ],
    failure_code_descriptions: {
      INVALID_ARGUMENT: 'Fix the command options.',
      MISSING_ACTOR: 'Run with authenticated server identity; never supply identity as an argument.',
      INVALID_CONTEXT: 'Run with the repository root as the working directory.',
      INVALID_CORRECTIONS: 'Repair the corrections store before retrying.',
      CORRECTION_NOT_FOUND: 'Use an existing correction id.',
      INVALID_TRANSITION: 'Choose a lifecycle operation valid for the current state.',
      READ_FAILED: 'Fix store access and retry.',
      WRITE_FAILED: 'Fix store write access and retry.',
      IO_FAILURE: 'Inspect filesystem or runtime I/O and retry.',
      RUNTIME_FAILURE: 'Rare fallback: inspect the emitted message and execution context.',
    },
  }
}

export function buildCommandHelp(command: LifecycleCommand): CorrectionLifecycleCliCommandHelp {
  const help = buildHelp()
  return {
    ok: true,
    command,
    required: help.commands[command].required,
    optional: help.commands[command].optional,
    failure_codes: help.failure_codes,
    failure_code_descriptions: help.failure_code_descriptions,
  }
}

function isLifecycleCommand(value: string | undefined): value is LifecycleCommand {
  return value !== undefined && (LIFECYCLE_COMMANDS as readonly string[]).includes(value)
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const command = args[0]
  if (command !== 'record' && command !== 'retire' && command !== 'reconfirm' && command !== 'supersede') {
    throw new CorrectionLifecycleCliError(
      'INVALID_ARGUMENT',
      'correction-lifecycle requires record, retire, reconfirm, or supersede',
      'Run `node scripts/correction-lifecycle.ts <command> --help` for the command fields.',
    )
  }

  const options = new Map<string, string>()
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index]
    if (token === undefined || !token.startsWith('--'))
      throw invalidArguments('Each option must be a `--name value` pair.')
    const equalsIndex = token.indexOf('=')
    const option = equalsIndex === -1 ? token : token.slice(0, equalsIndex)
    const value = equalsIndex === -1 ? args[index + 1] : token.slice(equalsIndex + 1)
    if (value === undefined || (equalsIndex === -1 && value.startsWith('--'))) {
      throw invalidArguments('Each option must be a `--name value` pair.')
    }
    if (options.has(option)) throw invalidArguments(`Option ${option} was provided more than once.`)
    options.set(option, value)
    if (equalsIndex === -1) index += 1
  }

  const allowed = new Set(
    command === 'record' || command === 'supersede'
      ? ['--id', '--node-id', '--text', '--start', '--end', ...(command === 'supersede' ? ['--supersedes-id'] : [])]
      : ['--id'],
  )
  for (const option of options.keys()) {
    if (!allowed.has(option)) throw invalidArguments(`Unsupported option ${option}; attribution is server-derived.`)
  }
  requireOption(options, '--id')
  if (command === 'record' || command === 'supersede') {
    requireOption(options, '--node-id')
    requireOption(options, '--text')
  }
  if (command === 'supersede') requireOption(options, '--supersedes-id')
  return {command, options}
}

function applyCommand(
  parsed: ParsedArguments,
  file: CorrectionsFile,
  env: Readonly<Record<string, string | undefined>>,
  now: () => Date,
): {readonly file: CorrectionsFile; readonly correction: CorrectionRecord} {
  const id = getOption(parsed.options, '--id')
  let next: CorrectionsFile
  if (parsed.command === 'record' || parsed.command === 'supersede') {
    const attribution = deriveServerAttribution(env, now())
    next = recordCorrection(file, {
      id,
      pageNodeId: getOption(parsed.options, '--node-id'),
      span: parseSpan(parsed.options),
      serverDerivedAttribution: attribution,
      supersedesId: parsed.command === 'supersede' ? getOption(parsed.options, '--supersedes-id') : undefined,
    })
  } else if (parsed.command === 'retire') {
    next = retireCorrection(file, id)
  } else {
    next = reconfirmCorrection(file, id)
  }

  const correction = next.corrections.find(entry => entry.id === id)
  if (correction === undefined) throw new Error(`correction ${id} was not present after ${parsed.command}`)
  return {file: next, correction}
}

export function deriveServerAttribution(
  env: Readonly<Record<string, string | undefined>>,
  recordedAt: Date,
): CorrectionAttribution {
  const actor = env.GITHUB_ACTOR?.trim()
  if (actor === undefined || actor === '') {
    throw new CorrectionLifecycleCliError(
      'MISSING_ACTOR',
      'correction-lifecycle requires the server-provided GITHUB_ACTOR',
      'Run this command from an authenticated GitHub Actions context; identity cannot be supplied as an argument.',
    )
  }
  return {actor, recorded_at: recordedAt.toISOString()}
}

function parseSpan(options: ReadonlyMap<string, string>): {
  readonly text: string
  readonly start?: number
  readonly end?: number
} {
  const text = getOption(options, '--text')
  const start = parseOptionalInteger(options, '--start')
  const end = parseOptionalInteger(options, '--end')
  return {...(start === undefined ? {} : {start}), ...(end === undefined ? {} : {end}), text}
}

function parseOptionalInteger(options: ReadonlyMap<string, string>, option: string): number | undefined {
  const value = options.get(option)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw invalidArguments(`${option} must be a non-negative integer.`)
  return parsed
}

function requireOption(options: ReadonlyMap<string, string>, option: string): void {
  if (options.get(option) === undefined || options.get(option)?.trim() === '')
    throw invalidArguments(`${option} is required and must not be empty.`)
}

function getOption(options: ReadonlyMap<string, string>, option: string): string {
  const value = options.get(option)
  if (value === undefined) throw invalidArguments(`${option} is required and must not be empty.`)
  return value
}

function invalidArguments(message: string): CorrectionLifecycleCliError {
  return new CorrectionLifecycleCliError(
    'INVALID_ARGUMENT',
    message,
    'Use the documented command options and do not provide an attribution or actor argument.',
  )
}

export function toFailure(error: unknown): CorrectionLifecycleCliFailure {
  if (error instanceof CorrectionStoreError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        remediation: 'Fix the corrections store or lifecycle transition and retry.',
        path: error.path,
      },
    }
  }
  if (error instanceof CorrectionLifecycleCliError)
    return {ok: false, error: {code: error.code, message: error.message, remediation: error.remediation}}
  if (isErrnoError(error))
    return {
      ok: false,
      error: {code: 'IO_FAILURE', message: error.message, remediation: 'Inspect filesystem or runtime I/O and retry.'},
    }
  const message = error instanceof Error ? error.message : 'unknown correction lifecycle failure'
  return {
    ok: false,
    error: {
      code: 'RUNTIME_FAILURE',
      message,
      remediation: 'Rare fallback: inspect the emitted message and execution context.',
    },
  }
}

function assertRepositoryRoot(cwd: string, repositoryRoot: string | undefined): void {
  const root = repositoryRoot ?? findRepositoryRoot(cwd)
  if (root === undefined || resolve(cwd) !== resolve(root))
    throw new CorrectionLifecycleCliError(
      'INVALID_CONTEXT',
      'correction-lifecycle must run from the repository root',
      'Run this command with the repository root as the working directory.',
    )
}

export function findRepositoryRoot(start: string): string | undefined {
  let current = resolve(start)
  while (true) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'knowledge'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function findHelpOption(args: readonly string[]): number {
  let index = 1
  while (index < args.length) {
    const token = args[index]
    if (token === '--help') return index
    if (token === undefined || !token.startsWith('--')) return -1
    index += token.includes('=') ? 1 : 2
  }
  return -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isErrnoError(error: unknown): error is {readonly code: string; readonly message: string} {
  return isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main()
}
