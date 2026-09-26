import type {Buffer} from 'node:buffer'
import type {Dirent} from 'node:fs'

import {createHash} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'

/**
 * Content-only change detection for the wiki-scoped paths. Walks the filesystem directly
 * instead of hashing `git diff`/`git status` output, because `sync-wiki` restores `data`
 * content into the worktree only — the index is left untouched, so an index-only
 * operation (staging an edit that already existed at baseline, `git rm --cached`,
 * `git add -N`) would otherwise flip a diff/status-based hash with zero content change.
 * Git tracked/untracked/ignored status is irrelevant here: if a byte lives under a scoped
 * path on disk, it counts, whether or not git can see it.
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

export interface CaptureWikiScopeSnapshotParams {
  cwd: string
  scopePaths: string[]
  lstatImpl?: WikiChangeDetectLstatFn
  readdirImpl?: WikiChangeDetectReadDirFn
  readFileImpl?: WikiChangeDetectReadFileFn
  hashImpl?: WikiChangeDetectHashFn
}

function defaultHashContents(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

const defaultLstat: WikiChangeDetectLstatFn = async absolutePath => fs.lstat(absolutePath)
const defaultReadDir: WikiChangeDetectReadDirFn = async absolutePath => fs.readdir(absolutePath, {withFileTypes: true})
const defaultReadFile: WikiChangeDetectReadFileFn = async absolutePath => fs.readFile(absolutePath)

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as {code?: unknown}).code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface WalkDeps {
  lstatImpl: WikiChangeDetectLstatFn
  readdirImpl: WikiChangeDetectReadDirFn
  readFileImpl: WikiChangeDetectReadFileFn
  hashImpl: WikiChangeDetectHashFn
}

/**
 * Recursively hashes one scoped root. `allowMissing` is true only for the top-level scope
 * roots passed in by the caller — a scope root that doesn't exist at all is a legitimate
 * "nothing here" state, not an error. Anything discovered mid-walk (via readdir) that then
 * fails to stat or read is a race (the entry disappeared between listing and reading) and
 * fails closed rather than silently dropping out of the snapshot.
 *
 * Symlinks are rejected outright — never followed, never distinguished from dangling links
 * — because recursing through every path segment from the scope root down means any
 * symlinked ancestor within the scoped subtree is caught at the point this function lstats
 * it, before ever descending into or reading through it.
 */
async function walkScopedPath(
  absolutePath: string,
  relativePath: string,
  allowMissing: boolean,
  results: WikiChangeDetectEntry[],
  deps: WalkDeps,
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
      await walkScopedPath(path.join(absolutePath, entry.name), `${relativePath}/${entry.name}`, false, results, deps)
    }
    return
  }

  if (stats.isFile()) {
    let contents: Buffer
    try {
      contents = await deps.readFileImpl(absolutePath)
    } catch (error: unknown) {
      throw new Error(`failed to read ${relativePath}: ${errorMessage(error)}`)
    }
    results.push({relativePath, hash: deps.hashImpl(contents)})
    return
  }

  throw new Error(`non-regular entry in scope: ${relativePath}`)
}

/** Sorted `[relativePath, sha256(bytes)]` snapshot of every scoped path that currently exists on disk. */
export async function captureWikiScopeSnapshot(
  params: CaptureWikiScopeSnapshotParams,
): Promise<WikiChangeDetectEntry[]> {
  const deps: WalkDeps = {
    lstatImpl: params.lstatImpl ?? defaultLstat,
    readdirImpl: params.readdirImpl ?? defaultReadDir,
    readFileImpl: params.readFileImpl ?? defaultReadFile,
    hashImpl: params.hashImpl ?? defaultHashContents,
  }

  const results: WikiChangeDetectEntry[] = []
  for (const scopePath of params.scopePaths) {
    const relativeRoot = scopePath.replaceAll('\\', '/')
    await walkScopedPath(path.join(params.cwd, scopePath), relativeRoot, true, results, deps)
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

/** Baseline and detect share this: same scoped filesystem-content snapshot, hashed the same way, so their outputs are directly comparable. */
export async function computeWikiChangeHash(params: ComputeWikiChangeHashParams): Promise<string> {
  const snapshot = await captureWikiScopeSnapshot(params)
  return hashWikiScopeSnapshot(snapshot)
}
