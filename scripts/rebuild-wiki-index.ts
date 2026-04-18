import type {Dirent} from 'node:fs'
import {readdir, readFile, writeFile} from 'node:fs/promises'
import process from 'node:process'

import {mergeWikiLogs, rebuildWikiIndex} from './wiki-ingest.ts'

/**
 * Heal `knowledge/index.md` (and optionally `knowledge/log.md`) after merge
 * conflicts on the shared wiki catalog files.
 *
 * Usage:
 *   node scripts/rebuild-wiki-index.ts
 *     Rebuild `knowledge/index.md` from all files under `knowledge/wiki/**`.
 *
 *   node scripts/rebuild-wiki-index.ts --merge-logs <path1> <path2> [...]
 *     Merge multiple log.md files chronologically into `knowledge/log.md`.
 *     Dedupes entries by `(timestamp, target)`; preserves canonical header.
 *
 * Rationale: the one-PR-per-survey flow in the current architecture serializes
 * through `knowledge/index.md` and `knowledge/log.md`. Every survey after the
 * first on the same cycle hits a merge conflict on those two files. This script
 * replaces hand-merging — regenerate the index from ground truth (the set of
 * wiki pages on disk) and merge log entries chronologically. When the `data`
 * branch flow lands (fro-bot/agent#511), this stops being load-bearing but
 * remains useful for post-incident healing.
 */

const WIKI_ROOT = 'knowledge/wiki'
const INDEX_PATH = 'knowledge/index.md'
const LOG_PATH = 'knowledge/log.md'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args[0] === '--merge-logs') {
    await runMergeLogs(args.slice(1))
    return
  }
  await runRebuildIndex()
}

async function runRebuildIndex(): Promise<void> {
  const wikiFiles = await loadWikiFilesFromDisk()
  const existingIndex = await readFileOrUndefined(INDEX_PATH)
  const nextIndex = rebuildWikiIndex({existingIndex, wikiFiles})
  await writeFile(INDEX_PATH, nextIndex, 'utf8')
  process.stdout.write(`rebuilt ${INDEX_PATH} from ${Object.keys(wikiFiles).length} wiki file(s)\n`)
}

async function runMergeLogs(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    throw new Error('rebuild-wiki-index: --merge-logs requires at least one log.md path')
  }
  const logs = await Promise.all(paths.map(readFileOrUndefined))
  const merged = mergeWikiLogs(logs)
  await writeFile(LOG_PATH, merged, 'utf8')
  process.stdout.write(`merged ${paths.length} log source(s) into ${LOG_PATH}\n`)
}

async function loadWikiFilesFromDisk(): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const directory of ['repos', 'topics', 'entities', 'comparisons']) {
    const directoryPath = `${WIKI_ROOT}/${directory}`
    let entries: Dirent[]
    try {
      entries = await readdir(directoryPath, {withFileTypes: true})
    } catch (error: unknown) {
      if (isEnoentError(error)) continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = `${directoryPath}/${entry.name}`
      files[path] = await readFile(path, 'utf8')
    }
  }
  return files
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

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
