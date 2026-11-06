/**
 * The warning router behind `scripts/route-stderr.ts`. It runs one command, replays the command's stderr
 * unchanged, and lifts the lines that start with a routed prefix into the job summary. It replaces four copies of
 * the same shell: capture stderr to a file, `cat` it back, `grep` and `sed` the prefixed lines into
 * `$GITHUB_STEP_SUMMARY`, and map one exit code to a step output.
 *
 * - The command is spawned from an argv array with no shell, with the supplied environment and the router's own
 *   working directory. Its stdin and stdout are inherited; only stderr is captured.
 * - The replay is the raw bytes, after the command exits. A line is matched on its text, so a prefix inside a line
 *   or after leading space does not route.
 * - A summary section is written only when at least one line matches. `filtered` writes the matching lines as
 *   bullets, one section per route in route order. `all` writes the heading and then the whole stderr, with the
 *   prefix of each matching line replaced by a bullet, and adds no newline the stderr did not have.
 * - The exit code is the command's. A command that ends on a signal exits 128 plus its number; one that cannot
 *   start exits 127 (not found) or 126, with a fixed line naming only the error code, never the command.
 * - No line the router writes names the wrapped command, its arguments or the environment.
 *
 * Nothing here runs a regular expression over the stderr: lines are split on `\n` and compared with `startsWith`.
 */

import {Buffer} from 'node:buffer'
import {spawn} from 'node:child_process'
import {constants} from 'node:os'
import {appendStepSummary, writeGithubOutputs} from '@fro-bot/core/output'

export interface Route {
  /** A line that starts with this is routed. */
  readonly prefix: string
  /** The Markdown heading text of the summary section, without the `### `. */
  readonly heading: string
}

export type SummaryMode = 'filtered' | 'all'

export interface RouteStderrConflict {
  /** The exit code that means a page conflict. */
  readonly exitCode: number
  /** The `$GITHUB_OUTPUT` name written as `<output>=true` on that exit code. */
  readonly output: string
}

export interface RouteStderrPlan {
  readonly routes: readonly Route[]
  readonly summary: SummaryMode
  readonly conflict?: RouteStderrConflict
  /** The program and its arguments, run as given. */
  readonly command: readonly string[]
}

export interface RouteStderrIo {
  /** The environment the command runs in and the runner files are read from. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Receives the command's stderr, as bytes, once it has exited. Not called for an empty stderr. */
  readonly replay: (stderr: Uint8Array) => void
}

/** The router was given something it will not run. The message is fixed text that never echoes an argument. */
export class RouteStderrUsageError extends Error {}

function hasLineBreak(value: string): boolean {
  return value.includes('\n') || value.includes('\r')
}

/** `<prefix>=<heading>`, split at the first `=`. Both sides are non-empty and on one line. */
export function parseRoute(spec: string): Route {
  const invalid = new RouteStderrUsageError(
    '--route needs <prefix>=<heading>, with a non-empty prefix and heading on one line',
  )
  // No `=` gives -1 and a leading `=` gives 0: either way the prefix is empty.
  const separator = spec.indexOf('=')
  if (separator < 1) throw invalid
  const prefix = spec.slice(0, separator)
  const heading = spec.slice(separator + 1)
  if (heading === '' || hasLineBreak(prefix) || hasLineBreak(heading)) throw invalid
  return {prefix, heading}
}

/** A name `$GITHUB_OUTPUT` can carry without a delimiter. The pattern is anchored and has no nested quantifier. */
function isOutputName(value: string): boolean {
  return /^[\w-]+$/u.test(value)
}

function assertPlan(plan: RouteStderrPlan): void {
  if (plan.routes.length === 0) throw new RouteStderrUsageError('at least one --route is required')
  if (plan.command.length === 0) throw new RouteStderrUsageError('a command to run is required')
  if (plan.summary === 'all' && plan.routes.length !== 1) {
    throw new RouteStderrUsageError('--summary all takes exactly one --route')
  }
  const prefixes = plan.routes.map(route => route.prefix)
  if (new Set(prefixes).size !== prefixes.length) {
    throw new RouteStderrUsageError('each --route prefix may appear once')
  }
  const {conflict} = plan
  if (conflict !== undefined) {
    if (!Number.isInteger(conflict.exitCode) || conflict.exitCode < 1 || conflict.exitCode > 255) {
      throw new RouteStderrUsageError('--conflict-exit must be an integer from 1 to 255')
    }
    if (!isOutputName(conflict.output)) {
      throw new RouteStderrUsageError('--conflict-output must be made of letters, digits, _ and -')
    }
  }
}

/** The summary Markdown for `stderr`, or the empty string when no line starts with a routed prefix. */
export function buildSummary(stderr: string, routes: readonly Route[], mode: SummaryMode): string {
  const lines = stderr.split('\n')
  return routes
    .map(route => {
      const matching = lines.filter(line => line.startsWith(route.prefix))
      if (matching.length === 0) return ''
      const bullet = (line: string): string => `- ${line.slice(route.prefix.length)}`
      if (mode === 'all') {
        const body = lines.map(line => (line.startsWith(route.prefix) ? bullet(line) : line))
        return `### ${route.heading}\n${body.join('\n')}`
      }
      return `### ${route.heading}\n${matching.map(line => `${bullet(line)}\n`).join('')}`
    })
    .join('')
}

interface CommandResult {
  readonly code: number
  readonly stderr: Buffer
}

function startFailure(errorCode: string): CommandResult {
  return {
    code: errorCode === 'ENOENT' ? 127 : 126,
    stderr: Buffer.from(`route-stderr: could not start the wrapped command (${errorCode})\n`),
  }
}

/** Node's spawn errors, thrown or emitted, always carry a string `code`. */
function errorCodeOf(error: unknown): string {
  return String((error as NodeJS.ErrnoException).code)
}

async function runCommand(command: readonly string[], env: RouteStderrIo['env']): Promise<CommandResult> {
  // `assertPlan` has already rejected an empty command.
  const file = command[0] as string
  const args = command.slice(1)
  // A failed start emits `error` and then `close`; a promise settles once, so the second call is a no-op.
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    try {
      // Node leaves a variable whose value is undefined out of the child's environment.
      const child = spawn(file, args, {env, stdio: ['inherit', 'inherit', 'pipe']})
      child.stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      child.once('error', error => {
        resolve(startFailure(errorCodeOf(error)))
      })
      child.once('close', (code, signal) => {
        // `close` reports a signal only when it has no exit code.
        const exitCode = code ?? 128 + constants.signals[signal as NodeJS.Signals]
        resolve({code: exitCode, stderr: Buffer.concat(chunks)})
      })
    } catch (error: unknown) {
      resolve(startFailure(errorCodeOf(error)))
    }
  })
}

/**
 * Runs the plan and returns the command's exit code. The plan is checked before the command runs, so a bad plan
 * never starts it. The replay comes first, then the summary, then the conflict output. The conflict output
 * throws when `GITHUB_OUTPUT` is unset, because a conflict that cannot be reported must fail the step.
 */
export async function runRouteStderr(plan: RouteStderrPlan, io: RouteStderrIo): Promise<number> {
  assertPlan(plan)
  const {code, stderr} = await runCommand(plan.command, io.env)
  if (stderr.length > 0) io.replay(stderr)
  appendStepSummary(buildSummary(stderr.toString('utf8'), plan.routes, plan.summary), {onMissing: 'skip', env: io.env})
  if (plan.conflict !== undefined && code === plan.conflict.exitCode) {
    writeGithubOutputs({[plan.conflict.output]: 'true'}, {onMissing: 'throw', env: io.env})
  }
  return code
}
