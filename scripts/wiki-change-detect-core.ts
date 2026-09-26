import type {Buffer} from 'node:buffer'
import type {Dirent} from 'node:fs'

import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'

import {isAllowedWikiHandoffPath} from './wiki-handoff-core.ts'

/**
 * Content-only change detection for the wiki-scoped paths. Walks the filesystem directly
 * instead of hashing `git diff`/`git status` output, because `sync-wiki` restores `data`
 * content into the worktree only — the index is left untouched, so an index-only
 * operation (staging an edit that already existed at baseline, `git rm --cached`,
 * `git add -N`) would otherwise flip a diff/status-based hash with zero content change.
 *
 * Two eligibility filters narrow the raw filesystem walk down to what the wiki handoff can
 * actually carry, so a positive detection always corresponds to a real transferable delta:
 *   1. `isAllowedWikiHandoffPath` (shared with `scripts/wiki-handoff-core.ts`, unmodified —
 *      this coupling is intentional so the eligibility rule lives in exactly one place).
 *   2. `git check-ignore --no-index`, so editor swap files, `.DS_Store`, and anything else
 *      `.gitignore` excludes never register, matching what `wiki-handoff-build.ts`'s
 *      `git status` would actually carry.
 * `--no-index` means eligibility is independent of the git index: a tracked or
 * force-added file that matches an ignore pattern is still excluded (conservative — we
 * don't trust `git add -f` to signal real intent).
 */

export interface WikiChangeDetectEntry {
  relativePath: string
  hash: string
}

export type WikiChangeDetectLstatFn = (absolutePath: string) => Promise<{
  isSymbolicLink: () => boolean
  isDirectory: () => boolean
  isFile: () => boolean
}>
export type WikiChangeDetectReadDirFn = (absolutePath: string) => Promise<Dirent[]>
export type WikiChangeDetectReadFileFn = (absolutePath: string) => Promise<Buffer>
export type WikiChangeDetectHashFn = (contents: Buffer) => string
export type WikiChangeDetectCheckIgnoreRunnerFn = (params: {
  cwd: string
  stdinInput: string
}) => Promise<{stdout: string; exitCode: number}>

export interface CaptureWikiScopeSnapshotParams {
  cwd: string
  scopePaths: string[]
  lstatImpl?: WikiChangeDetectLstatFn
  readdirImpl?: WikiChangeDetectReadDirFn
  readFileImpl?: WikiChangeDetectReadFileFn
  hashImpl?: WikiChangeDetectHashFn
  checkIgnoreRunnerImpl?: WikiChangeDetectCheckIgnoreRunnerFn
}

function defaultHashContents(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

const defaultLstat: WikiChangeDetectLstatFn = async absolutePath => fs.lstat(absolutePath)
const defaultReadDir: WikiChangeDetectReadDirFn = async absolutePath => fs.readdir(absolutePath, {withFileTypes: true})
const defaultReadFile: WikiChangeDetectReadFileFn = async absolutePath => fs.readFile(absolutePath)

/** Generous cap: NUL-delimited paths only, never file content — a runaway wiki tree still fits comfortably. */
const CHECK_IGNORE_MAX_BUFFER = 64 * 1024 * 1024

// Synchronous on purpose: bounded, path-only input/output (never file content), so a
// blocking call is simpler and safer here than juggling an async child's stdin stream.
const defaultCheckIgnoreRunner: WikiChangeDetectCheckIgnoreRunnerFn = async ({cwd, stdinInput}) => {
  try {
    const stdout = execFileSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
      cwd,
      input: stdinInput,
      encoding: 'utf8',
      maxBuffer: CHECK_IGNORE_MAX_BUFFER,
    })
    return {stdout, exitCode: 0}
  } catch (error: unknown) {
    const failure = error as {status?: unknown; stdout?: unknown}
    // git check-ignore exits 1 (not a spawn/exec failure) when none of the given paths
    // are ignored — that is a real, parseable result, not an error.
    if (typeof failure.status === 'number') {
      return {stdout: typeof failure.stdout === 'string' ? failure.stdout : '', exitCode: failure.status}
    }
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as {code?: unknown}).code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface EnumerateDeps {
  lstatImpl: WikiChangeDetectLstatFn
  readdirImpl: WikiChangeDetectReadDirFn
}

/**
 * Recursively enumerates regular-file candidates under one scoped root — no content is
 * read here; eligibility filtering happens afterward, before any byte of an excluded
 * path is ever touched. `allowMissing` is true only for the top-level scope roots passed
 * in by the caller — a scope root that doesn't exist at all is a legitimate "nothing
 * here" state, not an error. Anything discovered mid-walk (via readdir) that then fails
 * to stat is a race (the entry disappeared between listing and statting) and fails
 * closed rather than silently dropping out of the snapshot.
 *
 * Symlinks are rejected outright — never followed, never distinguished from dangling
 * links — because recursing through every path segment from the scope root down means
 * any symlinked ancestor within the scoped subtree is caught at the point this function
 * lstats it, before ever descending into or reading through it.
 */
async function walkScopedPath(
  absolutePath: string,
  relativePath: string,
  allowMissing: boolean,
  candidates: string[],
  deps: EnumerateDeps,
): Promise<void> {
  let stats: Awaited<ReturnType<WikiChangeDetectLstatFn>>
  try {
    stats = await deps.lstatImpl(absolutePath)
  } catch (error: unknown) {
    if (allowMissing && isEnoent(error)) return
    throw new Error(`failed to stat ${relativePath}: ${errorMessage(error)}`)
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`refusing symlink in scope: ${relativePath}`)
  }

  if (stats.isDirectory()) {
    let entries: Dirent[]
    try {
      entries = await deps.readdirImpl(absolutePath)
    } catch (error: unknown) {
      throw new Error(`failed to enumerate ${relativePath}: ${errorMessage(error)}`)
    }
    for (const entry of entries) {
      await walkScopedPath(
        path.join(absolutePath, entry.name),
        `${relativePath}/${entry.name}`,
        false,
        candidates,
        deps,
      )
    }
    return
  }

  if (stats.isFile()) {
    candidates.push(relativePath)
    return
  }

  throw new Error(`non-regular entry in scope: ${relativePath}`)
}

/**
 * Runs one batched, NUL-safe `git check-ignore --no-index` call for every allowlisted
 * candidate and returns the subset that's ignored. Fails closed on anything but a clean
 * "some ignored" (exit 0) or "none ignored" (exit 1) result, and on any reported path
 * that wasn't actually in the candidate set — a subprocess or parsing failure must never
 * be read as "nothing ignored".
 */
async function checkIgnoredPaths(
  cwd: string,
  relativePaths: string[],
  runner: WikiChangeDetectCheckIgnoreRunnerFn,
): Promise<Set<string>> {
  if (relativePaths.length === 0) return new Set()

  const stdinInput = relativePaths.map(relativePath => `${relativePath}\0`).join('')

  let result: {stdout: string; exitCode: number}
  try {
    result = await runner({cwd, stdinInput})
  } catch (error: unknown) {
    throw new Error(`git check-ignore failed: ${errorMessage(error)}`)
  }

  if (result.exitCode === 1) return new Set()
  if (result.exitCode !== 0) {
    throw new Error(`git check-ignore exited with unexpected status ${result.exitCode}`)
  }

  const parts = result.stdout.split('\0')
  if (parts.at(-1) === '') parts.pop()

  const candidateSet = new Set(relativePaths)
  const ignored = new Set<string>()
  for (const relativePath of parts) {
    if (!candidateSet.has(relativePath)) {
      throw new Error(`git check-ignore returned a path outside the candidate set: ${relativePath}`)
    }
    ignored.add(relativePath)
  }
  return ignored
}

/**
 * Sorted `[relativePath, sha256(bytes)]` snapshot of every *eligible* scoped path that
 * currently exists on disk: allowlisted (matches the wiki handoff's own path rule) and
 * not git-ignored. Content is read only for paths that survive both filters.
 */
export async function captureWikiScopeSnapshot(
  params: CaptureWikiScopeSnapshotParams,
): Promise<WikiChangeDetectEntry[]> {
  const enumerateDeps: EnumerateDeps = {
    lstatImpl: params.lstatImpl ?? defaultLstat,
    readdirImpl: params.readdirImpl ?? defaultReadDir,
  }
  const readFileImpl = params.readFileImpl ?? defaultReadFile
  const hashImpl = params.hashImpl ?? defaultHashContents
  const checkIgnoreRunnerImpl = params.checkIgnoreRunnerImpl ?? defaultCheckIgnoreRunner

  const candidates: string[] = []
  for (const scopePath of params.scopePaths) {
    const relativeRoot = scopePath.replaceAll('\\', '/')
    await walkScopedPath(path.join(params.cwd, scopePath), relativeRoot, true, candidates, enumerateDeps)
  }

  const allowed = candidates.filter(relativePath => isAllowedWikiHandoffPath(relativePath))
  const ignored = await checkIgnoredPaths(params.cwd, allowed, checkIgnoreRunnerImpl)
  const eligible = allowed.filter(relativePath => !ignored.has(relativePath))

  const results: WikiChangeDetectEntry[] = []
  for (const relativePath of eligible) {
    let contents: Buffer
    try {
      contents = await readFileImpl(path.join(params.cwd, relativePath))
    } catch (error: unknown) {
      throw new Error(`failed to read ${relativePath}: ${errorMessage(error)}`)
    }
    results.push({relativePath, hash: hashImpl(contents)})
  }

  results.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
  return results
}

/**
 * Deterministic, unambiguous hash of an already-sorted snapshot: NUL-delimited
 * `[relativePath, contentHash]` tuples. Callers must pass a sorted snapshot (as
 * {@link captureWikiScopeSnapshot} returns) — this function does not re-sort, so it stays
 * a pure, cheap-to-test function of its input order.
 */
export function hashWikiScopeSnapshot(entries: WikiChangeDetectEntry[]): string {
  const hash = createHash('sha256')
  for (const entry of entries) {
    hash.update(entry.relativePath)
    hash.update('\0')
    hash.update(entry.hash)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export type ComputeWikiChangeHashParams = CaptureWikiScopeSnapshotParams

/** Baseline and detect share this: same scoped, eligibility-filtered content snapshot, hashed the same way. */
export async function computeWikiChangeHash(params: ComputeWikiChangeHashParams): Promise<string> {
  const snapshot = await captureWikiScopeSnapshot(params)
  return hashWikiScopeSnapshot(snapshot)
}
