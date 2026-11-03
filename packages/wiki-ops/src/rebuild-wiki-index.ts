import type {Dirent} from 'node:fs'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {mergeWikiLogs, rebuildWikiIndex} from '@fro.bot/wiki-write-core'

/**
 * Heal `knowledge/index.md` (and optionally `knowledge/log.md`) after merge
 * conflicts on the shared wiki catalog files.
 *
 * Usage:
 *   bun scripts/rebuild-wiki-index.ts
 *     Rebuild `knowledge/index.md` from all files under `knowledge/wiki/**`.
 *
 *   bun scripts/rebuild-wiki-index.ts --merge-logs <path1> <path2> [...]
 *     Merge multiple log.md files chronologically into `knowledge/log.md`.
 *     Dedupes entries by `(timestamp, target)`; preserves canonical header.
 *
 * Rationale: autonomous wiki writes go to the `data` branch through `wiki-ingest`, which
 * rebuilds `knowledge/index.md` and merges `knowledge/log.md` itself, and the Merge Data
 * Branch workflow promotes `data` to `main`. No workflow runs this command. It is an
 * operator tool for healing the two shared catalog files when they are out of step with the
 * wiki pages, for example after a merge conflict on either file or an incident: it
 * regenerates the index from ground truth (the set of wiki pages on disk) and merges log
 * entries chronologically instead of hand-merging them.
 */

const WIKI_ROOT = 'knowledge/wiki'
const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'

export interface RebuildWikiIndexIo {
  readonly stdout: (text: string) => void
}

export interface RebuildWikiIndexOptions {
  /** The log paths to merge. Omitted rebuilds the index. */
  readonly mergeLogs?: readonly string[]
  /** The checkout the relative `knowledge/` paths resolve against. Omitted, paths stay relative to the working directory. */
  readonly cwd?: string
}

export async function runRebuildWikiIndex(
  io: RebuildWikiIndexIo,
  options: RebuildWikiIndexOptions = {},
): Promise<void> {
  const cwd = options.cwd
  if (options.mergeLogs !== undefined) {
    await runMergeLogs(options.mergeLogs, io, cwd)
    return
  }
  await runRebuildIndex(io, cwd)
}

async function runRebuildIndex(io: RebuildWikiIndexIo, cwd: string | undefined): Promise<void> {
  const wikiFiles = await loadWikiFilesFromDisk(cwd)
  const existingIndex = await readFileOrUndefined(at(cwd, INDEX_PATH))
  const nextIndex = rebuildWikiIndex({existingIndex, wikiFiles})
  await writeFile(at(cwd, INDEX_PATH), nextIndex, 'utf8')
  io.stdout(`rebuilt ${INDEX_PATH} from ${Object.keys(wikiFiles).length} wiki file(s)\n`)
}

async function runMergeLogs(paths: readonly string[], io: RebuildWikiIndexIo, cwd: string | undefined): Promise<void> {
  if (paths.length === 0) {
    throw new Error('rebuild-wiki-index: --merge-logs requires at least one log.md path')
  }
  const logs = await Promise.all(paths.map(async path => readFileOrUndefined(at(cwd, path))))
  const merged = mergeWikiLogs(logs)
  await writeFile(at(cwd, LOG_PATH), merged, 'utf8')
  io.stdout(`merged ${paths.length} log source(s) into ${LOG_PATH}\n`)
}

async function loadWikiFilesFromDisk(cwd: string | undefined): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries: Dirent[]
    try {
      entries = await readdir(at(cwd, directoryPath), {withFileTypes: true})
    } catch (error: unknown) {
      if (isEnoentError(error)) continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = `${directoryPath}/${entry.name}`
      files[path] = await readFile(at(cwd, path), 'utf8')
    }
  }
  return files
}

/** The path against `cwd`; with no `cwd` it stays as written, so errors name the same relative path. */
function at(cwd: string | undefined, path: string): string {
  return cwd === undefined ? path : resolve(cwd, path)
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isEnoentError(error)) return undefined
    throw error
  }
}

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
