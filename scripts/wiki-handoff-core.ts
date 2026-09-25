import type {Buffer} from 'node:buffer'

import {createHash} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'

/**
 * Untrusted agent job builds a manifest.json + files/ delta (no ingest metadata — that's
 * forgeable) for a trusted, agent-free job to validate and apply with an App token.
 *
 * Baseline scoping (captureWikiBaseline/scopeToBaseline) diffs against a pre-agent
 * snapshot instead of HEAD, because sync-wiki restores `data` over `main` and an unscoped
 * diff would report every main-vs-data difference, not just the agent's edits.
 */

/** Wiki path allowlist: exactly knowledge/index.md, exactly knowledge/log.md, or any .md under knowledge/wiki/. */
export function isAllowedWikiHandoffPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/')
  if (normalized === 'knowledge/index.md' || normalized === 'knowledge/log.md') return true
  return normalized.startsWith('knowledge/wiki/') && normalized.endsWith('.md')
}

export interface GitStatusChanges {
  changed: string[]
  deleted: string[]
}

/**
 * Parses `-z --untracked-files=all` porcelain output: NUL-delimited (no quoting/escaping
 * of spaces or non-ASCII paths), untracked dirs expanded to individual files. A rename/copy
 * record's original path is the NEXT NUL field, not an inline `old -> new`.
 */
export function parseGitStatusPorcelainZ(output: string): GitStatusChanges {
  const changed: string[] = []
  const deleted: string[] = []

  const records = output.split('\0')
  // Drop the trailing empty element that a well-formed trailing NUL produces.
  if (records.at(-1) === '') records.pop()

  let index = 0
  while (index < records.length) {
    const record = records[index]
    index += 1
    if (record === undefined || record.length < 3) continue

    const status = record.slice(0, 2)
    const currentPath = record.slice(3)
    const isRenameOrCopy = status.includes('R') || status.includes('C')

    if (isRenameOrCopy) {
      // Original path is the next NUL field, not part of this record.
      const originalPath = records[index]
      index += 1
      if (originalPath !== undefined) deleted.push(originalPath)
      changed.push(currentPath)
      continue
    }

    if (status.includes('D')) {
      deleted.push(currentPath)
      continue
    }

    changed.push(currentPath)
  }

  return {changed, deleted}
}

/** Default content-hash implementation: sha256, hex-encoded. */
function defaultHashContents(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

export interface WikiBaselineManifest {
  /** Map of allowlisted relative path → sha256 hex digest, as it existed at baseline time. */
  files: Record<string, string>
  /**
   * Paths already deleted (git-status `D`) at baseline time — sync-wiki's `git restore
   * --worktree` removes any path `main` tracks that `data` doesn't. Lets scopeToBaseline
   * tell that apart from a real agent deletion.
   */
  deleted: string[]
}

export interface CaptureWikiBaselineParams {
  cwd: string
  baselinePath: string
  runGitStatus: () => Promise<string>
  readFileImpl?: typeof fs.readFile
  writeFileImpl?: typeof fs.writeFile
  hashImpl?: (contents: Buffer) => string
}

/**
 * Hashes wiki-scoped paths that differ from HEAD and records already-deleted ones. Run
 * right after sync-wiki restores `data`, before the agent, as scopeToBaseline's reference point.
 */
export async function captureWikiBaseline(params: CaptureWikiBaselineParams): Promise<WikiBaselineManifest> {
  const readFileImpl = params.readFileImpl ?? fs.readFile
  const writeFileImpl = params.writeFileImpl ?? fs.writeFile
  const hashImpl = params.hashImpl ?? defaultHashContents

  const statusOutput = await params.runGitStatus()
  const {changed, deleted} = parseGitStatusPorcelainZ(statusOutput)

  const files: Record<string, string> = {}
  for (const relativePath of changed) {
    if (!isAllowedWikiHandoffPath(relativePath)) continue
    const contents = await readFileImpl(path.join(params.cwd, relativePath))
    files[relativePath] = hashImpl(contents)
  }

  const allowedDeleted = deleted.filter(relativePath => isAllowedWikiHandoffPath(relativePath))

  const manifest: WikiBaselineManifest = {files, deleted: allowedDeleted}
  await writeFileImpl(params.baselinePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

export interface BuildWikiHandoffParams {
  cwd: string
  outDir: string
  runGitStatus: () => Promise<string>
  /** Baseline from {@link captureWikiBaseline}; when set, scopes the manifest to post-baseline changes only. */
  baselinePath?: string
  readFileImpl?: typeof fs.readFile
  writeFileImpl?: typeof fs.writeFile
  mkdirImpl?: typeof fs.mkdir
  copyFileImpl?: typeof fs.copyFile
  existsImpl?: (absolutePath: string) => Promise<boolean>
  hashImpl?: (contents: Buffer) => string
}

export interface BuildWikiHandoffResult {
  changed: string[]
  deleted: string[]
}

async function defaultExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

function assertBaselineShape(value: unknown, baselinePath: string): asserts value is WikiBaselineManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as {files?: unknown}).files !== 'object' ||
    (value as {files?: unknown}).files === null ||
    !Array.isArray((value as {deleted?: unknown}).deleted) ||
    !(value as {deleted: unknown[]}).deleted.every(entry => typeof entry === 'string')
  ) {
    throw new Error(`wiki-handoff-build: baseline at ${baselinePath} has unexpected shape`)
  }
}

async function loadBaseline(baselinePath: string, readFileImpl: typeof fs.readFile): Promise<WikiBaselineManifest> {
  const raw = await readFileImpl(baselinePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  assertBaselineShape(parsed, baselinePath)
  return parsed
}

/**
 * Scopes raw git-status changed/deleted to only what the agent did: a baseline-hash match
 * is excluded (pre-existing data-vs-main diff); a deletion already in `baseline.deleted` is
 * sync-wiki-caused, not agent-caused, and excluded; a baseline path missing from disk with
 * no git-status entry is a deletion (untracked-file removals produce none); a baseline path
 * still on disk with a changed hash but no git-status entry means the agent reverted it to
 * exactly HEAD's content, which still differs from `data` — included as changed.
 */
async function scopeToBaseline(params: {
  cwd: string
  rawChanged: string[]
  rawDeleted: string[]
  baseline: WikiBaselineManifest
  readFileImpl: typeof fs.readFile
  existsImpl: (absolutePath: string) => Promise<boolean>
  hashImpl: (contents: Buffer) => string
}): Promise<GitStatusChanges> {
  const {cwd, rawChanged, rawDeleted, baseline, readFileImpl, existsImpl, hashImpl} = params

  const changed: string[] = []
  for (const relativePath of rawChanged) {
    const contents = await readFileImpl(path.join(cwd, relativePath))
    const currentHash = hashImpl(contents)
    if (baseline.files[relativePath] !== currentHash) {
      changed.push(relativePath)
    }
  }

  const deleted: string[] = []
  for (const relativePath of rawDeleted) {
    if (baseline.deleted.includes(relativePath)) continue
    deleted.push(relativePath)
  }

  for (const relativePath of Object.keys(baseline.files)) {
    if (rawChanged.includes(relativePath) || rawDeleted.includes(relativePath)) continue
    const exists = await existsImpl(path.join(cwd, relativePath))
    if (!exists) {
      deleted.push(relativePath)
      continue
    }
    const contents = await readFileImpl(path.join(cwd, relativePath))
    const currentHash = hashImpl(contents)
    if (baseline.files[relativePath] !== currentHash) {
      changed.push(relativePath)
    }
  }

  return {changed: [...new Set(changed)], deleted: [...new Set(deleted)]}
}

/**
 * Builds `files/<path>` + `manifest.json` for changed/deleted paths; never writes ingest
 * metadata. Throws on any out-of-scope path from git status — should be unreachable, fails
 * closed on workflow drift.
 */
export async function buildWikiHandoff(params: BuildWikiHandoffParams): Promise<BuildWikiHandoffResult> {
  const mkdirImpl = params.mkdirImpl ?? fs.mkdir
  const copyFileImpl = params.copyFileImpl ?? fs.copyFile
  const writeFileImpl = params.writeFileImpl ?? fs.writeFile
  const readFileImpl = params.readFileImpl ?? fs.readFile
  const existsImpl = params.existsImpl ?? defaultExists
  const hashImpl = params.hashImpl ?? defaultHashContents

  const statusOutput = await params.runGitStatus()
  const {changed: rawChanged, deleted: rawDeleted} = parseGitStatusPorcelainZ(statusOutput)

  const outOfScope = [...rawChanged, ...rawDeleted].filter(p => !isAllowedWikiHandoffPath(p))
  if (outOfScope.length > 0) {
    throw new Error(`wiki-handoff-build: git status reported out-of-scope paths: ${outOfScope.join(', ')}`)
  }

  let changed = rawChanged
  let deleted = rawDeleted

  if (params.baselinePath !== undefined) {
    const baseline = await loadBaseline(params.baselinePath, readFileImpl)
    const scoped = await scopeToBaseline({
      cwd: params.cwd,
      rawChanged,
      rawDeleted,
      baseline,
      readFileImpl,
      existsImpl,
      hashImpl,
    })
    changed = scoped.changed
    deleted = scoped.deleted
  }

  await mkdirImpl(path.join(params.outDir, 'files'), {recursive: true})
  for (const relativePath of changed) {
    const dest = path.join(params.outDir, 'files', relativePath)
    await mkdirImpl(path.dirname(dest), {recursive: true})
    await copyFileImpl(path.join(params.cwd, relativePath), dest)
  }

  await writeFileImpl(
    path.join(params.outDir, 'manifest.json'),
    `${JSON.stringify({changed, deleted}, null, 2)}\n`,
    'utf8',
  )

  return {changed, deleted}
}

export interface WikiHandoffManifest {
  changed: string[]
  deleted: string[]
}

export class WikiHandoffValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WikiHandoffValidationError'
  }
}

/** Generous cap for a wiki-page delta; catches a runaway or malicious artifact early. */
export const WIKI_HANDOFF_MAX_TOTAL_BYTES = 5 * 1024 * 1024

/** Rejects traversal segments, absolute paths, and anything outside the wiki allowlist. */
export function assertSafeWikiHandoffPath(relativePath: string): void {
  if (relativePath === '') {
    throw new WikiHandoffValidationError('wiki handoff path is empty')
  }
  if (path.isAbsolute(relativePath)) {
    throw new WikiHandoffValidationError(`wiki handoff path must be relative: ${relativePath}`)
  }
  const normalized = relativePath.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (segments.includes('..') || segments.includes('.') || segments.includes('')) {
    throw new WikiHandoffValidationError(`wiki handoff path contains traversal or empty segments: ${relativePath}`)
  }
  if (!isAllowedWikiHandoffPath(normalized)) {
    throw new WikiHandoffValidationError(`wiki handoff path is outside the allowed wiki scope: ${relativePath}`)
  }
}

function assertManifestShape(value: unknown): asserts value is WikiHandoffManifest {
  if (typeof value !== 'object' || value === null) {
    throw new WikiHandoffValidationError('manifest.json must be a JSON object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.changed) || !record.changed.every(v => typeof v === 'string')) {
    throw new WikiHandoffValidationError('manifest.json "changed" must be a string array')
  }
  if (!Array.isArray(record.deleted) || !record.deleted.every(v => typeof v === 'string')) {
    throw new WikiHandoffValidationError('manifest.json "deleted" must be a string array')
  }
}

export interface ApplyWikiHandoffParams {
  handoffDir: string
  workspaceDir: string
  readFileImpl?: typeof fs.readFile
  lstatImpl?: typeof fs.lstat
  writeFileImpl?: typeof fs.writeFile
  mkdirImpl?: typeof fs.mkdir
  rmImpl?: typeof fs.rm
  readdirImpl?: typeof fs.readdir
}

/** Only entries a valid artifact may contain — anything else (e.g. a resurrected metadata.json) is rejected before any file read. */
const ALLOWED_TOP_LEVEL_ENTRIES = new Set(['manifest.json', 'files'])

export interface ApplyWikiHandoffResult {
  applied: string[]
  deleted: string[]
}

/**
 * Validates a {@link buildWikiHandoff} artifact (allowlist, traversal, symlinks,
 * non-regular files, size cap) and only then applies it. Nothing is written until every
 * entry passes.
 */
export async function validateAndApplyWikiHandoff(params: ApplyWikiHandoffParams): Promise<ApplyWikiHandoffResult> {
  const readFileImpl = params.readFileImpl ?? fs.readFile
  const lstatImpl = params.lstatImpl ?? fs.lstat
  const writeFileImpl = params.writeFileImpl ?? fs.writeFile
  const mkdirImpl = params.mkdirImpl ?? fs.mkdir
  const rmImpl = params.rmImpl ?? fs.rm
  const readdirImpl = params.readdirImpl ?? fs.readdir

  const topLevelEntries = await readdirImpl(params.handoffDir)
  const unexpectedEntries = topLevelEntries.filter(entry => !ALLOWED_TOP_LEVEL_ENTRIES.has(entry))
  if (unexpectedEntries.length > 0) {
    throw new WikiHandoffValidationError(
      `wiki handoff artifact contains unexpected top-level entries: ${unexpectedEntries.join(', ')}`,
    )
  }

  const manifestPath = path.join(params.handoffDir, 'manifest.json')
  let manifestRaw: string
  try {
    manifestRaw = await readFileImpl(manifestPath, 'utf8')
  } catch (error: unknown) {
    throw new WikiHandoffValidationError(
      `failed to read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(manifestRaw)
  } catch (error: unknown) {
    throw new WikiHandoffValidationError(
      `manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  assertManifestShape(manifest)

  for (const relativePath of [...manifest.changed, ...manifest.deleted]) {
    assertSafeWikiHandoffPath(relativePath)
  }

  let totalBytes = 0
  for (const relativePath of manifest.changed) {
    const sourcePath = path.join(params.handoffDir, 'files', relativePath)
    const stats = await lstatImpl(sourcePath)
    if (stats.isSymbolicLink()) {
      throw new WikiHandoffValidationError(`refusing symlink in wiki handoff: ${relativePath}`)
    }
    if (!stats.isFile()) {
      throw new WikiHandoffValidationError(`wiki handoff entry is not a regular file: ${relativePath}`)
    }
    totalBytes += stats.size
    if (totalBytes > WIKI_HANDOFF_MAX_TOTAL_BYTES) {
      throw new WikiHandoffValidationError(
        `wiki handoff exceeds the ${WIKI_HANDOFF_MAX_TOTAL_BYTES}-byte size cap (running total ${totalBytes})`,
      )
    }
  }

  const applied: string[] = []
  for (const relativePath of manifest.changed) {
    const sourcePath = path.join(params.handoffDir, 'files', relativePath)
    const destPath = path.join(params.workspaceDir, relativePath)
    const contents = await readFileImpl(sourcePath)
    await mkdirImpl(path.dirname(destPath), {recursive: true})
    await writeFileImpl(destPath, contents)
    applied.push(relativePath)
  }

  const deleted: string[] = []
  for (const relativePath of manifest.deleted) {
    const destPath = path.join(params.workspaceDir, relativePath)
    await rmImpl(destPath, {force: true})
    deleted.push(relativePath)
  }

  return {applied, deleted}
}
