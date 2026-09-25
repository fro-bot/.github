import type {Buffer} from 'node:buffer'

import {createHash} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'

/**
 * Shared core for the cross-job wiki-ingest handoff protocol.
 *
 * The agent job (untrusted: the LLM agent's shell can rewrite any file in the checkout,
 * including this script) builds a delta artifact describing only knowledge/wiki/**,
 * knowledge/index.md, and knowledge/log.md changes. A separate, trusted job (fresh
 * checkout of the default branch, no agent step) downloads and validates that artifact
 * before applying it to a clean tree and running the privileged wiki-ingest / metadata
 * writers with an App installation token.
 *
 * Security property: the build side never holds a write credential, so a tampered build
 * script can at most smuggle bad *content* into the artifact — never exfiltrate a token or
 * write outside the allowed scope — because every path is re-validated in the trusted job
 * before touching disk there.
 *
 * The artifact carries ONLY `manifest.json` (the changed/deleted path lists) and a
 * `files/` directory holding the changed files' contents — nothing else. In particular it
 * never carries ingest metadata (commit message, target, sources): a tampered build
 * script could otherwise forge those values (e.g. smuggle a private repo name into
 * `WIKI_TARGET`) and have the trusted job commit them unvalidated. Every trusted job
 * derives `WIKI_*` env from its own trusted sources (`github.*` context, `inputs.*`, or
 * pre-agent `needs.*` job outputs) instead. {@link validateAndApplyWikiHandoff} rejects
 * any unexpected top-level entry in the artifact, so even a compromised build script
 * cannot resurrect a metadata file.
 *
 * Baseline scoping: `sync-wiki` restores `knowledge/` from the `data` branch into the
 * `main` checkout before the agent runs, so a plain `git status` diffed against `HEAD`
 * (main's committed content) reports every path where `data` differs from `main` — not
 * just what the agent touched. Left unfiltered, the handoff would carry a stale snapshot
 * of `data` wide enough to revert a concurrent writer's update. {@link captureWikiBaseline}
 * (run before the agent, right after sync) records a content hash for every changed
 * candidate path, plus the set of paths already deleted (sync-wiki's `git restore
 * --worktree` deletes any path `main` tracks that `data` doesn't); {@link buildWikiHandoff}
 * / {@link scopeToBaseline}, given that baseline, include only what actually happened
 * during the agent step: a path whose content hash changed, a path new since baseline, a
 * path deleted since baseline (excluding paths already deleted BY sync-wiki, so those
 * don't get forwarded as phantom agent deletions), and — the subtle case — a path that
 * differed from baseline but the agent edited back to `main`'s exact content, which
 * produces no `git status` entry at all yet is still a real change relative to `data`.
 */

/**
 * Reject `.`/`..` path segments and require the wiki-scoped extension/location contract:
 * exactly `knowledge/index.md`, exactly `knowledge/log.md`, or any `.md` file under
 * `knowledge/wiki/`.
 */
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
 * Parse `git status --porcelain=v1 -z --untracked-files=all` output (NUL-record format;
 * expected to be scoped to the wiki paths via `-- knowledge/wiki knowledge/index.md
 * knowledge/log.md`) into changed (added/modified/untracked) and deleted path lists.
 *
 * `-z` disables the quoting/escaping `git status` otherwise applies to paths containing
 * spaces or non-ASCII characters, and separates records with NUL instead of newline —
 * required because a bare newline-delimited parse cannot distinguish a literal `\n` inside
 * a quoted path from a record separator. `--untracked-files=all` expands a new untracked
 * directory into its individual files instead of collapsing it to one `?? dir/` entry that
 * would otherwise fail {@link isAllowedWikiHandoffPath}'s exact-file-extension check.
 *
 * A rename/copy record (`R`/`C` status) is followed, per `-z`'s contract, by a second
 * NUL-terminated field holding the original path — not `old -> new` inline. That field is
 * consumed as the deletion; the record's own path is the change.
 */
export function parseGitStatusPorcelainZ(output: string): GitStatusChanges {
  const changed: string[] = []
  const deleted: string[] = []

  const records = output.split('\0')
  // A trailing NUL (the normal case for well-formed `-z` output) produces one empty
  // trailing element after split; drop it so it isn't misread as a record.
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
      // The original path is the NEXT NUL-terminated field, not part of this record.
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
   * Allowlisted paths already deleted (tracked-in-HEAD, git-status `D`) at baseline time.
   * `sync-wiki` restores `data`'s content by running `git restore --source FETCH_HEAD
   * --worktree -- knowledge` over a `main` checkout; any path that exists in `main`'s
   * history but not on `data` disappears from the working tree as a result, and
   * `git status` reports it as deleted BEFORE the agent ever runs. Without recording
   * these here, {@link scopeToBaseline} cannot tell a sync-caused deletion from a real
   * agent-caused one — both show up identically in the post-agent `git status` deleted
   * list.
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
 * Capture a content-hash snapshot of every wiki-scoped path that currently differs from
 * `HEAD` (i.e. every path `git status` would report — untracked or modified), plus the
 * set of wiki-scoped paths already deleted at this moment. Run this BEFORE the agent
 * step, immediately after `sync-wiki` restores `data`'s content, so the snapshot reflects
 * "what `data` looks like right now", before any agent edits.
 *
 * The deleted set matters because `sync-wiki` itself can delete tracked-in-HEAD paths
 * (any path `main` tracks that `data` doesn't) via `git restore --worktree`. Without
 * recording those here, {@link scopeToBaseline} would have no way to distinguish that
 * sync-caused deletion from a real deletion the agent makes later — both look identical
 * in the post-agent `git status` output.
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
  /**
   * Path to a {@link WikiBaselineManifest} written by {@link captureWikiBaseline} before
   * the agent ran. When provided, the manifest is scoped to only what changed since that
   * baseline (see the module doc's "Baseline scoping" section). When omitted, every path
   * `git status` reports is included, unscoped — the pre-baseline-support behavior.
   */
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
 * Scope raw git-status changed/deleted lists to only what changed since `baseline`:
 * - a changed path whose content hash matches the baseline is a pre-existing data-vs-main
 *   difference the agent never touched — excluded.
 * - a changed path with no baseline entry, or a different hash, is agent-caused — included.
 * - a git-reported deletion already present in `baseline.deleted` was caused by `sync-wiki`
 *   restoring `data` over a `main` checkout (a path `main` tracks that `data` doesn't),
 *   not by the agent — excluded. Every other git-reported deletion is agent-caused — included.
 * - a baseline `files` path absent from BOTH the current changed and deleted lists but
 *   missing from disk was removed from disk since baseline without producing its own
 *   git-status entry (an untracked file's removal does this) — included as a deletion.
 * - a baseline `files` path absent from BOTH lists but STILL present on disk has
 *   produced no git-status entry, meaning its current content now matches `HEAD`
 *   (`main`) exactly — including the case where the agent edited a data-only
 *   difference back to `main`'s exact content. If its content hash differs from the
 *   baseline hash, that's a real change relative to `data` and must still be included
 *   (as changed, with `main`'s content) even though git sees no diff against `HEAD`.
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
 * Build the handoff artifact directory: `files/<path>` for each changed/added path plus
 * `manifest.json` (`{changed, deleted}`). Never writes anything else — no ingest metadata
 * of any kind — so the artifact carries no forgeable commit message, target, or sources.
 *
 * Throws if git reports any path outside the allowed wiki scope — this should be
 * unreachable in practice (the workflow scopes `git status` to the same paths), but a
 * fail-closed check here means a future workflow drift can't silently widen the artifact.
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

/**
 * Reject `..`/`.` traversal segments, absolute paths, and anything outside the wiki
 * allowlist (see {@link isAllowedWikiHandoffPath}).
 */
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

/**
 * The only entries a valid handoff artifact may contain. `files/` is required even for an
 * empty (no-op) manifest — {@link buildWikiHandoff} always creates it. Anything else
 * (notably a resurrected `metadata.json`) is rejected before any file is read.
 */
const ALLOWED_TOP_LEVEL_ENTRIES = new Set(['manifest.json', 'files'])

export interface ApplyWikiHandoffResult {
  applied: string[]
  deleted: string[]
}

/**
 * Validate an artifact built by {@link buildWikiHandoff} and, only if every entry passes,
 * apply it to `workspaceDir` (write changed files, remove deleted files).
 *
 * Validation rejects: any path outside the allowlist, `..`/`.` traversal segments,
 * absolute paths, symlinks, non-regular files, non-`.md` files under `knowledge/wiki`,
 * and a manifest whose total changed-file size exceeds {@link WIKI_HANDOFF_MAX_TOTAL_BYTES}.
 * Nothing is written until every entry has passed validation.
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
