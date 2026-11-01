/**
 * Runs a `scripts/<name>.ts` entrypoint in a child process, the way a workflow does, and returns what
 * a workflow sees: the exit code, stdout, stderr and the `$GITHUB_OUTPUT` file.
 *
 * This is the parity authority for a CLI. A module that writes straight to `process.stdout` or
 * `process.stderr` bypasses the in-process runner's sinks, and only a real process shows the bytes a
 * step reads and the exit code the job gets.
 *
 * The child starts with a minimal environment (`PATH`, `HOME`) plus the caller's, so nothing from the
 * developer's shell leaks into a result. `GITHUB_OUTPUT` is applied last and always points at a fresh
 * temp file, whatever the caller's `env` says.
 *
 * `bun` and `node` are found on `PATH`, never from the parent's `process.execPath`: a Bun parent would
 * otherwise run the `node` runtime on Bun. `executable` names the program outright.
 */

import {Buffer} from 'node:buffer'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

export type Runtime = 'bun' | 'node'

export interface SpawnEntrypointOptions {
  /** Absolute path to the `.ts` entrypoint. */
  readonly entrypoint: string
  /** Arguments to the runtime before the script path, for example `--no-install --no-env-file` for `bun`. */
  readonly runtimeArgs?: readonly string[]
  /** Arguments after the script path. */
  readonly argv?: readonly string[]
  /** Added to the base environment; an `undefined` value removes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** `bun` is what the workflows run for most scripts; `node` is what Test Scripts Load and a few steps use. Default `bun`. */
  readonly runtime?: Runtime
  /** The program to run instead of `bun` or `node` found on `PATH`, for example an absolute path. */
  readonly executable?: string
  readonly cwd?: string
  /**
   * `file` (default) points `GITHUB_OUTPUT` at a fresh temp file. `unset` removes the variable, for a
   * run that must behave as it does outside Actions; `githubOutput` in the result is then empty.
   */
  readonly githubOutput?: 'file' | 'unset'
  /** The child is killed and the call rejects after this long. Default 30 s. */
  readonly timeoutMs?: number
}

export interface SpawnEntrypointResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  /** What the child appended to `$GITHUB_OUTPUT`, or an empty string. */
  readonly githubOutput: string
}

function baseEnvironment(): Record<string, string> {
  const base: Record<string, string> = {}
  for (const name of ['PATH', 'HOME'] as const) {
    const value = process.env[name]
    if (value !== undefined) base[name] = value
  }
  return base
}

export async function spawnEntrypoint(options: SpawnEntrypointOptions): Promise<SpawnEntrypointResult> {
  const workDirectory = await mkdtemp(join(tmpdir(), 'spawn-entrypoint-'))
  const outputPath = join(workDirectory, 'github-output')
  const environment: Record<string, string> = baseEnvironment()
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete environment[name]
    else environment[name] = value
  }
  if (options.githubOutput === 'unset') delete environment.GITHUB_OUTPUT
  else environment.GITHUB_OUTPUT = outputPath

  try {
    const command = options.executable ?? options.runtime ?? 'bun'
    const child = spawn(command, [...(options.runtimeArgs ?? []), options.entrypoint, ...(options.argv ?? [])], {
      cwd: options.cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`${options.entrypoint} did not exit within ${String(options.timeoutMs ?? 30_000)} ms`))
      }, options.timeoutMs ?? 30_000)
      child.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        resolve(code ?? (signal === null ? -1 : 128))
      })
    })

    const githubOutput = await readFile(outputPath, 'utf8').catch(() => '')
    return {
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      githubOutput,
    }
  } finally {
    await rm(workDirectory, {recursive: true, force: true})
  }
}
