/**
 * The runner every goke CLI goes through. It owns the exit code, stdout, stderr and help, and returns
 * them as `{exitCode, stdout, stderr}` so a test can drive a CLI without a subprocess.
 *
 * goke alone is not enough to guard a gate. Without help registered it exits 0 silently on an unknown
 * command or a stray positional; on a root that declares positionals it drops the extras and runs the
 * action; it enforces only an option's type, int and enum, not refinements such as `.min(1)`; and its
 * help goes to stdout. The runner closes each of those:
 *
 * - `.help()` is always registered, and goke's help is routed to the CLI's usage stream (stderr unless
 *   the CLI says otherwise).
 * - The runner counts the positionals itself and runs goke's own unknown-option, option-value and
 *   required-argument checks, because it parses with `run: false` and runs the action itself.
 * - Parsed options are validated again against the full zod schemas before the action runs.
 * - The exit code is recorded in a local variable. goke's `exit` is injected, records the code and
 *   throws a sentinel the runner catches around `parse()`; a no-op `exit` would let `parse()` reject
 *   with the original error on a parse error and resolve with the code only recorded on an async
 *   action error. The action wrapper never calls `exit`: it writes the CLI's message and records the
 *   code itself.
 * - A dotted option name (`--a.b`, `--a.b=v`) is rejected before goke sees argv, and no command may
 *   declare one. goke writes a dotted name into nested objects, and a path through an inherited
 *   property (`--toString.call=x`, `--a.0=x --a.map.call=x`) reaches a built-in prototype, so no list of
 *   forbidden segments is enough: the dotted form itself is not accepted.
 * - Defaults are applied once, by the zod schema: goke is told not to seed them, because it would hand
 *   the schema an already-defaulted value to parse a second time.
 * - `NO_COLOR` is set for the one load of goke, which every run shares, and every sink strips ANSI as a
 *   backstop: goke's output, the runner's own usage errors, and what an action writes.
 *
 * Output a command writes straight to `process.stdout` or `process.stderr` bypasses the sinks, so a
 * spawned test of the `scripts/<name>.ts` entrypoint is the parity authority for a CLI.
 */

import type * as GokeModule from 'goke'
import process from 'node:process'
import {z} from 'zod'

export {z}

export type CliStream = 'stdout' | 'stderr'

/** `required` is `<name>`, `optional` is `[name]` and `variadic` is `[...name]`, zero or more. */
export interface PositionalSpec {
  readonly name: string
  readonly kind: 'required' | 'optional' | 'variadic'
}

/**
 * `flag` is goke's syntax (`--promotion`, `--limit <n>`, `--dry-run`). The key the option is declared
 * under is the camelCase name goke parses the flag to (`dryRun` for `--dry-run`).
 */
export interface OptionSpec {
  readonly flag: string
  readonly schema: z.ZodType
}

export type OptionSpecs = Readonly<Record<string, OptionSpec>>

export type OptionValues<Specs extends OptionSpecs> = {
  readonly [Key in keyof Specs]: z.output<Specs[Key]['schema']>
}

export interface CommandContext<Specs extends OptionSpecs> {
  /** Declared positionals by name; a variadic one is an array. */
  readonly positionals: Readonly<Record<string, string | readonly string[] | undefined>>
  /** The options as the zod schemas parsed them. */
  readonly options: OptionValues<Specs>
  readonly env: Readonly<Record<string, string | undefined>>
  /** Output captured into the result. */
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

export interface CommandSpec<Specs extends OptionSpecs> {
  /** Omitted for the root command, which runs for no argv or for argv that names no command. */
  readonly name?: string
  /**
   * `false` if the command can mutate GitHub, `data`, an external service, or a tracked path in the
   * checkout; writes to a caller-supplied artifact path, `$GITHUB_OUTPUT` or stdout do not count.
   */
  readonly readOnly: boolean
  readonly positionals?: readonly PositionalSpec[]
  readonly options?: Specs
  /** A returned number is the exit code; anything else is 0. A throw is reported by the CLI's error format. */
  readonly action: (context: CommandContext<Specs>) => unknown
}

/** What a command's action reads besides its options. */
export type RunIo = Omit<CommandContext<OptionSpecs>, 'options'>

/** The outcome of checking raw options against a command's schemas. */
export type Prepared =
  {readonly ok: true; readonly run: (io: RunIo) => unknown} | {readonly ok: false; readonly message: string}

/**
 * A command with its option types erased, ready to sit in a list. Build one with `defineCommand`.
 * The only way to run its action is `prepare`, which validates the options first, so nothing that
 * holds a `Command` can hand the action a value its schemas did not parse.
 */
export interface Command {
  /** The command name; the empty string for the root command. */
  readonly name: string
  readonly readOnly: boolean
  readonly positionals: readonly PositionalSpec[]
  readonly options: OptionSpecs
  /** Parses `rawOptions` with the full schemas. On success, `run` calls the action with what they parsed. */
  readonly prepare: (rawOptions: Readonly<Record<string, unknown>>) => Prepared
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

export function defineCommand<const Specs extends OptionSpecs = Record<never, OptionSpec>>(
  spec: CommandSpec<Specs>,
): Command {
  const options: OptionSpecs = spec.options ?? {}
  const schema = z.object(Object.fromEntries(Object.entries(options).map(([key, option]) => [key, option.schema])))
  return {
    name: spec.name ?? '',
    readOnly: spec.readOnly,
    positionals: spec.positionals ?? [],
    options,
    prepare: rawOptions => {
      const parsed = schema.safeParse(rawOptions)
      if (!parsed.success) return {ok: false, message: describeIssues(parsed.error)}
      // `parsed.data` is what each of `Specs`' schemas produced.
      const parsedOptions = parsed.data as OptionValues<Specs>
      return {ok: true, run: io => spec.action({...io, options: parsedOptions})}
    },
  }
}

export interface CliConfig {
  /** The name goke prints in help. */
  readonly name: string
  readonly commands: readonly Command[]
  /**
   * What no argv means. `run` runs the root command, which must exist. `usage` prints usage and
   * returns the usage code without running anything. Default `run`.
   */
  readonly noArgv?: 'run' | 'usage'
  /** Exit code for argv that matches nothing declared. Default 1. */
  readonly usageCode?: number
  /** Where usage and help print. Default `stderr`. */
  readonly usageStream?: CliStream
  /** Exit code for an explicit `--help`. Default: the usage code. */
  readonly helpCode?: number
  /** Exit code when an action throws. Default 1. */
  readonly errorExitCode?: number
  /** Text written to stderr for a thrown action error, newline included. Default: the message and a newline. */
  readonly errorFormat?: (error: unknown) => string
}

export interface CliInput {
  /** The arguments after the script path. */
  readonly argv: readonly string[]
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Imports goke. The runner calls it with `NO_COLOR` set. A test passes a stand-in. */
  readonly importGoke?: () => Promise<typeof GokeModule>
}

export interface CliResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Thrown through goke's `exit` so a usage failure unwinds `parse()`. */
class ExitSignal extends Error {}

/** Removes SGR sequences (colour and style), the only ANSI goke and picocolors emit. */
function stripAnsi(text: string): string {
  const escape = String.fromCodePoint(27)
  return text.replaceAll(new RegExp(String.raw`${escape}\[[\d;]*m`, 'gu'), '')
}

function defaultErrorFormat(error: unknown): string {
  return `${error instanceof Error ? error.message : String(error)}\n`
}

async function importGokeModule(): Promise<typeof GokeModule> {
  return import('goke')
}

/** How many imports are in flight, and the `NO_COLOR` the first of them found. */
let importsInFlight = 0
let foundNoColor: string | undefined

/**
 * goke reads `NO_COLOR` when it loads, so it is set for the import and put back after. Overlapping
 * imports share one set and one restore: the first to start saves the value, the last to finish puts
 * it back, so no run restores another run's temporary value.
 */
async function importWithoutColor(importGoke: () => Promise<typeof GokeModule>): Promise<typeof GokeModule> {
  if (importsInFlight === 0) {
    foundNoColor = process.env.NO_COLOR
    process.env.NO_COLOR = '1'
  }
  importsInFlight += 1
  try {
    return await importGoke()
  } finally {
    importsInFlight -= 1
    if (importsInFlight === 0) {
      if (foundNoColor === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = foundNoColor
    }
  }
}

/** The one default import every run without a seam shares. */
let defaultGoke: Promise<typeof GokeModule> | undefined

/** A seam bypasses the shared import: it is a stand-in, and each run that passes one loads its own. */
async function loadGoke(importGoke: (() => Promise<typeof GokeModule>) | undefined): Promise<typeof GokeModule> {
  if (importGoke !== undefined) return importWithoutColor(importGoke)
  defaultGoke ??= importWithoutColor(importGokeModule)
  return defaultGoke
}

function positionalToken(positional: PositionalSpec): string {
  if (positional.kind === 'required') return `<${positional.name}>`
  if (positional.kind === 'optional') return `[${positional.name}]`
  return `[...${positional.name}]`
}

/** goke's name for a command: its words, then its positional tokens. */
function rawCommandName(command: Command): string {
  const tokens = command.positionals.map(positionalToken)
  return command.name === '' ? tokens.join(' ') : [command.name, ...tokens].join(' ')
}

function assertPositionalLayout(label: string, positionals: readonly PositionalSpec[]): void {
  let optional: PositionalSpec | undefined
  for (const [index, positional] of positionals.entries()) {
    if (positional.kind === 'variadic' && index !== positionals.length - 1) {
      throw new TypeError(`${label}: variadic positional \`${positional.name}\` must be the last positional`)
    }
    if (positional.kind === 'optional') optional ??= positional
    if (positional.kind === 'required' && optional !== undefined) {
      throw new TypeError(
        `${label}: required positional \`${positional.name}\` cannot follow optional positional \`${optional.name}\``,
      )
    }
  }
}

/** The flag names of a goke flag spec (`-p, --port <port>`): each comma item's first word, so a value placeholder is not read. */
function flagNames(flag: string): string[] {
  return flag.split(',').flatMap(item => item.trim().split(' ').slice(0, 1))
}

function assertNoDottedFlags(label: string, options: OptionSpecs): void {
  for (const option of Object.values(options)) {
    const dotted = flagNames(option.flag).find(name => name.includes('.'))
    if (dotted !== undefined) {
      throw new TypeError(`${label}: option flag \`${dotted}\` has a dotted name, which the runner does not accept`)
    }
  }
}

function assertConfig(config: CliConfig): void {
  const roots = config.commands.filter(command => command.name === '')
  if (roots.length > 1) throw new TypeError(`${config.name}: more than one root command`)
  if ((config.noArgv ?? 'run') === 'run' && roots.length === 0) {
    throw new TypeError(`${config.name}: a CLI that runs for no argv needs a root command`)
  }
  for (const command of config.commands) {
    const label = command.name === '' ? config.name : `${config.name} ${command.name}`
    assertPositionalLayout(label, command.positionals)
    assertNoDottedFlags(label, command.options)
  }
}

/** The goke instance after `.help()`. */
type GokeCli = ReturnType<InstanceType<typeof GokeModule.Goke>['help']>

interface Session {
  readonly cli: GokeCli
  readonly GokeError: typeof GokeModule.GokeError
  /** A command as goke registered it, next to the runner's own. */
  readonly registered: readonly {readonly goke: GokeModule.Command; readonly command: Command}[]
  /** What goke and the runner write to stderr, and what goke writes to stdout (help). */
  readonly output: {errors: string; help: string}
}

interface RunVerdict {
  readonly command: Command
  readonly args: readonly string[]
  readonly run: (io: RunIo) => unknown
}

/** A run, or the exit code of a usage error or help. */
type Verdict = RunVerdict | number

interface ExitCodes {
  readonly usage: number
  readonly help: number
}

/**
 * The first flag, before any `--`, whose name contains a `.`, as written and without its value. goke
 * splits a dotted option name on `.` and assigns down the path through whatever objects it finds,
 * inherited ones included, so this runs before goke parses anything. A negative number is a value, not
 * a flag, and a dot after `=` belongs to the value.
 */
function findDottedOptionName(argv: readonly string[]): string | undefined {
  for (const token of argv) {
    if (token === '--') return undefined
    if (!token.startsWith('-') || Number.isFinite(Number(token))) continue
    const flag = token.split('=')[0] ?? token
    if (flag.includes('.')) return flag
  }
  return undefined
}

/** Matches argv to a command and checks everything goke would check before an action, except the action. */
async function resolveVerdict(
  session: Session,
  config: CliConfig,
  argv: readonly string[],
  codes: ExitCodes,
): Promise<Verdict> {
  const {cli, output, GokeError} = session
  const usage = (message: string): number => {
    output.errors += stripAnsi(`error: ${message}\n`)
    return codes.usage
  }
  const dotted = findDottedOptionName(argv)
  if (dotted !== undefined) return usage(`unsupported dotted option name \`${dotted}\``)

  // No argv on a CLI whose no-argv mode is usage prints what `--help` prints.
  const noArgvUsage = argv.length === 0 && config.noArgv === 'usage'

  try {
    await cli.parse([config.name, config.name, ...(noArgvUsage ? ['--help'] : argv)], {run: false})
  } catch (error: unknown) {
    if (error instanceof ExitSignal) return codes.usage
    throw error
  }
  if (cli.options.help === true) return noArgvUsage ? codes.usage : codes.help

  const match = session.registered.find(entry => entry.goke === cli.matchedCommand)
  if (match === undefined) return usage(`unrecognized arguments: ${argv.join(' ')}`)

  try {
    match.goke.checkUnknownOptions()
    match.goke.checkRequiredArgs()
  } catch (error: unknown) {
    if (error instanceof GokeError) return usage(error.message)
    throw error
  }

  const {command} = match
  const args: readonly string[] = cli.args
  // goke has checked this already; the runner does not hand an action a gap in its own mapping.
  const missing = command.positionals.find(
    (positional, index) => positional.kind === 'required' && args[index] === undefined,
  )
  if (missing !== undefined) return usage(`missing required argument \`<${missing.name}>\``)
  const hasVariadic = command.positionals.some(positional => positional.kind === 'variadic')
  if (!hasVariadic && args.length > command.positionals.length) {
    return usage(`unexpected argument \`${args[command.positionals.length]}\``)
  }
  // A `--` terminator is never declared, so bare or followed by values it matches nothing.
  const afterDashes: unknown = cli.options['--']
  if (Array.isArray(afterDashes) && afterDashes.length > 0) return usage('unexpected arguments after `--`')
  if (argv.includes('--')) return usage('unexpected `--`')

  const prepared = command.prepare(cli.options)
  if (!prepared.ok) return usage(prepared.message)

  return {command, args, run: prepared.run}
}

function positionalValues(
  command: Command,
  args: readonly string[],
): Record<string, string | readonly string[] | undefined> {
  return Object.fromEntries(
    command.positionals.map((positional, index) => [
      positional.name,
      positional.kind === 'variadic' ? args.slice(index) : args[index],
    ]),
  )
}

export async function runCli(config: CliConfig, input: CliInput): Promise<CliResult> {
  assertConfig(config)
  const usageCode = config.usageCode ?? 1
  const usageStream = config.usageStream ?? 'stderr'
  const errorFormat = config.errorFormat ?? defaultErrorFormat

  const {Goke, GokeError} = await loadGoke(input.importGoke)
  const output = {errors: '', help: ''}
  const cli = new Goke(config.name, {
    stdout: {
      write: text => {
        output.help += stripAnsi(text)
      },
    },
    stderr: {
      write: text => {
        output.errors += stripAnsi(text)
      },
    },
    exit: () => {
      throw new ExitSignal()
    },
    columns: Number.POSITIVE_INFINITY,
  })
  cli.help()
  const registered = config.commands.map(command => {
    const goke = cli.command(rawCommandName(command))
    // The schemas apply their own defaults in `prepare`, once; goke only prints them in help.
    goke.ignoreOptionDefaultValue()
    for (const option of Object.values(command.options)) goke.option(option.flag, option.schema)
    // The runner runs actions itself, after its own checks. If goke ran one, the run would end as a usage error.
    goke.action(() => {
      throw new ExitSignal()
    })
    return {goke, command}
  })

  const verdict = await resolveVerdict({cli, GokeError, registered, output}, config, input.argv, {
    usage: usageCode,
    help: config.helpCode ?? usageCode,
  })

  if (typeof verdict !== 'number') {
    const stdout: string[] = []
    const stderr: string[] = []
    let exitCode = 0
    try {
      const result = await verdict.run({
        positionals: positionalValues(verdict.command, verdict.args),
        env: input.env ?? process.env,
        stdout: text => {
          stdout.push(text)
        },
        stderr: text => {
          stderr.push(text)
        },
      })
      if (typeof result === 'number') exitCode = result
    } catch (error: unknown) {
      stderr.push(errorFormat(error))
      exitCode = config.errorExitCode ?? 1
    }
    // Stripped after joining, so a sequence split across two writes is removed too.
    return {exitCode, stdout: stripAnsi(stdout.join('')), stderr: stripAnsi(stderr.join(''))}
  }

  if (output.help === '') cli.outputHelp()
  return {
    exitCode: verdict,
    stdout: usageStream === 'stdout' ? output.help : '',
    stderr: output.errors + (usageStream === 'stderr' ? output.help : ''),
  }
}

export interface CliStreams {
  readonly argv?: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly stdout?: (text: string) => void
  readonly stderr?: (text: string) => void
}

/**
 * The entry for a `scripts/<name>.ts` shim: runs the CLI against `process.argv`, writes the result to
 * the process streams and sets `process.exitCode`. It never calls `process.exit`, which would cut off
 * a large stdout write that is still draining when the pipe is a pipe.
 */
export async function runCliMain(config: CliConfig, streams: CliStreams = {}): Promise<void> {
  const result = await runCli(config, {argv: streams.argv ?? process.argv.slice(2), env: streams.env})
  const writeStdout = streams.stdout ?? (text => process.stdout.write(text))
  const writeStderr = streams.stderr ?? (text => process.stderr.write(text))
  if (result.stdout !== '') writeStdout(result.stdout)
  if (result.stderr !== '') writeStderr(result.stderr)
  process.exitCode = result.exitCode
}
