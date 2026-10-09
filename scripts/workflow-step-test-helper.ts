/**
 * Test support: run a workflow step's `run:` block under bash with stub `git` and `node` on PATH.
 *
 * The stubs log every invocation to a trace file and never touch the network or the repo, so a
 * contract test can assert what a step would have done for a given `git ls-remote` exit code.
 * `git ls-remote` exits per the configured code; every other git subcommand and every `node`
 * invocation exits 0 (optionally overridden).
 */

import {execFileSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

export interface StepRun {
  status: number
  stdout: string
  stderr: string
  /** One line per stubbed `git` / `node` invocation, as `git <args>` / `node <args>`. */
  trace: string[]
}

export interface StepRunOptions {
  /** Exit code of the stubbed `git ls-remote`. */
  lsRemoteExit: number
  /** A git subcommand that fails (exit 128, with a `fatal:` line on stderr) instead of succeeding. */
  failSubcommand?: string
}

const STUB = (tool: string): string =>
  [
    '#!/bin/sh',
    `echo "${tool} $*" >> "$STUB_TRACE"`,
    ...(tool === 'git'
      ? [
          'case "$1" in',
          '  ls-remote) exit "$STUB_GIT_LS_REMOTE_EXIT" ;;',
          'esac',
          'if [ -n "$STUB_GIT_FAIL_SUBCOMMAND" ] && [ "$1" = "$STUB_GIT_FAIL_SUBCOMMAND" ]; then',
          '  echo "fatal: simulated $1 failure" >&2',
          '  exit 128',
          'fi',
        ]
      : []),
    'exit 0',
  ].join('\n')

/** Executes `script` under bash in a temp directory with stubbed `git` and `node`. */
export function runStepWithStubs(script: string, options: StepRunOptions): StepRun {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-step-'))
  try {
    for (const tool of ['git', 'node']) {
      writeFileSync(join(dir, tool), STUB(tool))
      chmodSync(join(dir, tool), 0o755)
    }
    const scriptPath = join(dir, 'step.sh')
    writeFileSync(scriptPath, script)
    const traceFile = join(dir, 'trace')
    writeFileSync(traceFile, '')
    const outputFile = join(dir, 'github-output')
    writeFileSync(outputFile, '')

    let result: Pick<StepRun, 'status' | 'stdout' | 'stderr'>
    try {
      // The caller's PATH comes after the stubs so bash, head, echo, etc. stay real.
      const stdout = execFileSync('bash', [scriptPath], {
        cwd: dir,
        env: {
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          STUB_TRACE: traceFile,
          STUB_GIT_LS_REMOTE_EXIT: String(options.lsRemoteExit),
          STUB_GIT_FAIL_SUBCOMMAND: options.failSubcommand ?? '',
          GITHUB_OUTPUT: outputFile,
          RUNNER_TEMP: dir,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      result = {status: 0, stdout, stderr: ''}
    } catch (error: unknown) {
      const failure = error as {status?: number; stdout?: string; stderr?: string}
      result = {
        status: failure.status ?? 1,
        stdout: String(failure.stdout ?? ''),
        stderr: String(failure.stderr ?? ''),
      }
    }
    return {...result, trace: readFileSync(traceFile, 'utf8').split('\n').filter(Boolean)}
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

/** True when the trace shows a step touched the working tree's metadata: a fetch, checkout, or restore. */
export function overlayWasAttempted(trace: readonly string[]): boolean {
  return trace.some(line => /^git (?:fetch|checkout|restore)\b/.test(line))
}
