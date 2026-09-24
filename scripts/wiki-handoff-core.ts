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
 * Parse `git status --porcelain=v1` output (expected to be scoped to the wiki paths via
 * `git status --porcelain=v1 -- knowledge/wiki knowledge/index.md knowledge/log.md`) into
 * changed (added/modified) and deleted path lists. A rename (`R  old -> new`) splits into
 * a deletion of `old` and a change of `new`.
 */
export function parseGitStatusPorcelain(output: string): GitStatusChanges {
  const changed: string[] = []
  const deleted: string[] = []

  for (const rawLine of output.split('\n')) {
    if (rawLine.trim() === '') continue
    const status = rawLine.slice(0, 2)
    const rest = rawLine.slice(3)

    if (status.includes('R')) {
      const arrowIndex = rest.indexOf(' -> ')
      if (arrowIndex === -1) {
        changed.push(rest)
        continue
      }
      deleted.push(rest.slice(0, arrowIndex))
      changed.push(rest.slice(arrowIndex + 4))
      continue
    }

    if (status.includes('D')) {
      deleted.push(rest)
      continue
    }

    changed.push(rest)
  }

  return {changed, deleted}
}

export interface BuildWikiHandoffParams {
  cwd: string
  outDir: string
  runGitStatus: () => Promise<string>
  readFileImpl?: typeof fs.readFile
  writeFileImpl?: typeof fs.writeFile
  mkdirImpl?: typeof fs.mkdir
  copyFileImpl?: typeof fs.copyFile
}

export interface BuildWikiHandoffResult {
  changed: string[]
  deleted: string[]
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

  const statusOutput = await params.runGitStatus()
  const {changed: rawChanged, deleted: rawDeleted} = parseGitStatusPorcelain(statusOutput)

  const outOfScope = [...rawChanged, ...rawDeleted].filter(p => !isAllowedWikiHandoffPath(p))
  if (outOfScope.length > 0) {
    throw new Error(`wiki-handoff-build: git status reported out-of-scope paths: ${outOfScope.join(', ')}`)
  }

  await mkdirImpl(path.join(params.outDir, 'files'), {recursive: true})
  for (const relativePath of rawChanged) {
    const dest = path.join(params.outDir, 'files', relativePath)
    await mkdirImpl(path.dirname(dest), {recursive: true})
    await copyFileImpl(path.join(params.cwd, relativePath), dest)
  }

  await writeFileImpl(
    path.join(params.outDir, 'manifest.json'),
    `${JSON.stringify({changed: rawChanged, deleted: rawDeleted}, null, 2)}\n`,
    'utf8',
  )

  return {changed: rawChanged, deleted: rawDeleted}
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
