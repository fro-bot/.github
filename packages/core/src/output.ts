/**
 * The two files a GitHub Actions step writes to: `$GITHUB_OUTPUT` (step outputs) and
 * `$GITHUB_STEP_SUMMARY` (the job summary).
 *
 * Callers disagree on a missing variable, so the policy is a required option and not a default:
 * `dispatch-renovate` and `wiki-change-detect` throw when `$GITHUB_OUTPUT` is unset, the rest skip
 * the write. An empty variable counts as unset in both cases.
 */

import {randomUUID} from 'node:crypto'
import {appendFileSync} from 'node:fs'
import process from 'node:process'

/** What to do when the runner file's variable is unset or empty. */
export type MissingPolicy = 'skip' | 'throw'

export interface RunnerFileOptions {
  readonly onMissing: MissingPolicy
  /** The error message under `throw`. Defaults to `<VARIABLE> is required`. */
  readonly missingMessage?: string
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Defaults to `appendFileSync`. */
  readonly append?: (path: string, content: string) => void
}

export interface GithubOutputOptions extends RunnerFileOptions {
  /** Makes the delimiter for a multiline value. Defaults to `randomUUID`. */
  readonly delimiter?: () => string
}

// The patterns below sit inside functions on purpose. Stryker marks a mutant in a module-level
// constant as static and covers it with no test, so it survives (observed with the six regex
// mutants of the constants these functions replaced).

/** Whether `value` is made only of characters that cannot carry a line break, `=` or `<<` into the file format. */
function isSafeToken(value: string): boolean {
  return /^[\w-]+$/u.test(value)
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/u.test(value)
}

function appendToRunnerFile(variable: string, content: string, options: RunnerFileOptions): boolean {
  const path = (options.env ?? process.env)[variable]
  if (path === undefined || path === '') {
    if (options.onMissing === 'throw') throw new Error(options.missingMessage ?? `${variable} is required`)
    return false
  }
  const append = options.append ?? appendFileSync
  append(path, content)
  return true
}

/**
 * One `$GITHUB_OUTPUT` entry. A value without a line break is `name=value`. A multiline value uses
 * the heredoc form `name<<DELIMITER`, and is rejected when it contains the delimiter, because the
 * runner would end the value there and read the rest as further outputs.
 */
function formatOutputEntry(name: string, value: string, makeDelimiter: () => string): string {
  if (!isSafeToken(name)) throw new Error(`invalid GITHUB_OUTPUT name: ${JSON.stringify(name)}`)
  if (!hasLineBreak(value)) return `${name}=${value}\n`

  const delimiter = makeDelimiter()
  if (!isSafeToken(delimiter)) {
    throw new Error(`invalid GITHUB_OUTPUT delimiter: ${JSON.stringify(delimiter)}`)
  }
  if (value.includes(delimiter)) {
    throw new Error(`GITHUB_OUTPUT value for ${name} contains its delimiter ${delimiter}`)
  }
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`
}

/**
 * Appends every entry to `$GITHUB_OUTPUT` in one write, in object order. Returns whether it wrote.
 * Every entry is formatted first, so an invalid name or a colliding value throws before anything
 * is written, whatever the policy.
 */
export function writeGithubOutputs(outputs: Readonly<Record<string, string>>, options: GithubOutputOptions): boolean {
  const makeDelimiter = options.delimiter ?? randomUUID
  const content = Object.entries(outputs)
    .map(([name, value]) => formatOutputEntry(name, value, makeDelimiter))
    .join('')
  return appendToRunnerFile('GITHUB_OUTPUT', content, options)
}

/** Appends `markdown` to `$GITHUB_STEP_SUMMARY` as given. Returns whether it wrote. */
export function appendStepSummary(markdown: string, options: RunnerFileOptions): boolean {
  return appendToRunnerFile('GITHUB_STEP_SUMMARY', markdown, options)
}
