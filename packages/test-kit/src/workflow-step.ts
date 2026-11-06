/**
 * Test support: run a workflow step's `run:` block under bash with stub `git`, `bun`, `node` and `sleep`
 * (plus any `stubTools`) on PATH.
 *
 * The stubs log every invocation to a trace file and never touch the network or the repo, so a
 * contract test can assert what a step would have done for a given `git ls-remote` exit code.
 * `git ls-remote` exits per the configured code; every other git subcommand and every `bun` / `node`
 * invocation exits 0 (optionally overridden). `exitSequences` gives a git subcommand one exit code
 * per call, so a retry loop can see a failure and then a success. `sleep` records its argument and
 * returns at once. `git rev-parse` prints `revParseOutput`, and the step's `$GITHUB_OUTPUT` is read
 * back into the result.
 */

import {spawnSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

export interface StepRun {
  status: number
  stdout: string
  stderr: string
  /** One line per stubbed invocation, as `git <args>` / `bun <args>` / `node <args>` / `<tool> <args>`. `sleep` is not traced; see `sleeps`. */
  trace: string[]
  /** The first argument of each `sleep` call, in order. */
  sleeps: string[]
  /** The raw content the step appended to `$GITHUB_OUTPUT`. */
  githubOutput: string
  /** `githubOutput` parsed as `key=value` lines and `key<<DELIMITER` blocks. A repeated key keeps the last value. */
  outputs: Record<string, string>
}

export interface StepRunOptions {
  /** Exit code of the stubbed `git ls-remote`. Defaults to 0. */
  lsRemoteExit?: number
  /**
   * Exit codes per git subcommand, one per call. Once the codes run out the last one repeats. A nonzero
   * code also writes `fatal: simulated <subcommand> failure` to stderr. For `ls-remote` this overrides
   * `lsRemoteExit`.
   */
  exitSequences?: Readonly<Record<string, readonly number[]>>
  /** What `git rev-parse` prints. Without it `rev-parse` prints nothing. */
  revParseOutput?: string
  /** Environment the step sees, as the workflow's `env:` block would set it. */
  env?: Record<string, string>
  /** Further tools to stub, such as `gh`. Each logs its invocation to the trace and exits 0. */
  stubTools?: readonly string[]
  /** A git subcommand that fails (exit 128, with a `fatal:` line on stderr) instead of succeeding. */
  failSubcommand?: string
}

const SUBCOMMAND = /^[a-z][a-z-]*$/

const SLEEP_STUB = ['#!/bin/sh', 'echo "$1" >> "$STUB_SLEEPS"', 'exit 0'].join('\n')

const STUB = (tool: string): string =>
  [
    '#!/bin/sh',
    `echo "${tool} $*" >> "$STUB_TRACE"`,
    ...(tool === 'git'
      ? [
          'seq="$STUB_DIR/seq-$1"',
          'if [ -f "$seq" ]; then',
          '  n=$(cat "$STUB_DIR/count-$1" 2>/dev/null || echo 0)',
          '  total=$(wc -l < "$seq" | tr -d " ")',
          '  idx=$((n + 1))',
          '  if [ "$idx" -gt "$total" ]; then idx="$total"; fi',
          '  echo $((n + 1)) > "$STUB_DIR/count-$1"',
          '  code=$(sed -n "$idx"p "$seq")',
          '  if [ "$code" -ne 0 ]; then',
          '    echo "fatal: simulated $1 failure" >&2',
          '  fi',
          '  if [ "$1" = rev-parse ] && [ "$code" -eq 0 ] && [ -n "$STUB_GIT_REV_PARSE_OUTPUT" ]; then',
          '    echo "$STUB_GIT_REV_PARSE_OUTPUT"',
          '  fi',
          '  exit "$code"',
          'fi',
          'case "$1" in',
          '  ls-remote) exit "$STUB_GIT_LS_REMOTE_EXIT" ;;',
          '  rev-parse) if [ -n "$STUB_GIT_REV_PARSE_OUTPUT" ]; then echo "$STUB_GIT_REV_PARSE_OUTPUT"; fi ;;',
          'esac',
          'if [ -n "$STUB_GIT_FAIL_SUBCOMMAND" ] && [ "$1" = "$STUB_GIT_FAIL_SUBCOMMAND" ]; then',
          '  echo "fatal: simulated $1 failure" >&2',
          '  exit 128',
          'fi',
        ]
      : []),
    'exit 0',
  ].join('\n')

/** Parses a `$GITHUB_OUTPUT` file: `key=value` lines and `key<<DELIMITER` blocks. */
function parseGithubOutput(content: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const block = /^([^=<]+)<<(.+)$/.exec(line)
    if (block !== null) {
      const body: string[] = []
      index += 1
      while (index < lines.length && lines[index] !== block[2]) {
        body.push(lines[index] ?? '')
        index += 1
      }
      outputs[block[1] ?? ''] = body.join('\n')
      continue
    }
    const separator = line.indexOf('=')
    if (separator > 0) {
      outputs[line.slice(0, separator)] = line.slice(separator + 1)
    }
  }
  return outputs
}

/** Executes `script` under bash in a temp directory with stubbed `git`, `bun`, `node`, `sleep` and any `stubTools`. */
export function runStepWithStubs(script: string, options: StepRunOptions): StepRun {
  for (const subcommand of Object.keys(options.exitSequences ?? {})) {
    if (!SUBCOMMAND.test(subcommand)) {
      throw new Error(`exitSequences key is not a plain git subcommand: ${subcommand}`)
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'workflow-step-'))
  try {
    for (const tool of ['git', 'bun', 'node', ...(options.stubTools ?? [])]) {
      writeFileSync(join(dir, tool), STUB(tool))
      chmodSync(join(dir, tool), 0o755)
    }
    writeFileSync(join(dir, 'sleep'), SLEEP_STUB)
    chmodSync(join(dir, 'sleep'), 0o755)
    for (const [subcommand, codes] of Object.entries(options.exitSequences ?? {})) {
      if (codes.length > 0) {
        writeFileSync(join(dir, `seq-${subcommand}`), `${codes.join('\n')}\n`)
      }
    }
    const scriptPath = join(dir, 'step.sh')
    writeFileSync(scriptPath, script)
    const traceFile = join(dir, 'trace')
    writeFileSync(traceFile, '')
    const sleepsFile = join(dir, 'sleeps')
    writeFileSync(sleepsFile, '')
    const outputFile = join(dir, 'github-output')
    writeFileSync(outputFile, '')

    // The caller's PATH comes after the stubs so bash, head, echo, etc. stay real.
    const spawned = spawnSync('bash', [scriptPath], {
      cwd: dir,
      env: {
        ...options.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        STUB_DIR: dir,
        STUB_TRACE: traceFile,
        STUB_SLEEPS: sleepsFile,
        STUB_GIT_LS_REMOTE_EXIT: String(options.lsRemoteExit ?? 0),
        STUB_GIT_FAIL_SUBCOMMAND: options.failSubcommand ?? '',
        STUB_GIT_REV_PARSE_OUTPUT: options.revParseOutput ?? '',
        GITHUB_OUTPUT: outputFile,
        RUNNER_TEMP: dir,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // A spawn failure (ENOBUFS, ENOENT, a timeout) leaves the streams null or truncated; a test must not read them.
    if (spawned.error !== undefined) throw spawned.error
    const result = {status: spawned.status ?? 1, stdout: spawned.stdout, stderr: spawned.stderr}
    const githubOutput = readFileSync(outputFile, 'utf8')
    return {
      ...result,
      trace: readFileSync(traceFile, 'utf8').split('\n').filter(Boolean),
      sleeps: readFileSync(sleepsFile, 'utf8').split('\n').filter(Boolean),
      githubOutput,
      outputs: parseGithubOutput(githubOutput),
    }
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

/** True when the trace shows a step touched the working tree's metadata: a fetch, checkout, or restore. */
export function overlayWasAttempted(trace: readonly string[]): boolean {
  return trace.some(line => /^git (?:fetch|checkout|restore)\b/.test(line))
}
