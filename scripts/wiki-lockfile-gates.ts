import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {join, resolve, sep} from 'node:path'
import process from 'node:process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuartzPluginObjectSource {
  repo?: string
  subdir?: string
  ref?: string
}

export interface QuartzConfigPlugin {
  enabled?: boolean
  source?: string | QuartzPluginObjectSource
}

export interface QuartzConfig {
  plugins?: QuartzConfigPlugin[]
}

export interface LockPluginEntry {
  // Quartz's plugin-git-handlers.js writes `source` verbatim from the config entry -- an object
  // config source produces an object here, not a normalized string.
  source: string | QuartzPluginObjectSource
  commit: string
  ref?: string
  subdir?: string
  resolved?: string
  installedAt?: string
}

export interface LockFile {
  plugins?: Record<string, LockPluginEntry>
}

export interface GateResult {
  ok: boolean
  errors: string[]
}

export interface CoverageGateResult extends GateResult {
  enabledRemoteCount: number
}

// ---------------------------------------------------------------------------
// checkLockfileCoverage — Gate A (pre-install): config<->lock coverage
// ---------------------------------------------------------------------------

/** Mirrors Quartz's `isLocalSource`: `./`, `../`, `/`, or a Windows drive path. */
export function isLocalPluginSource(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || /^[A-Z]:[\\/]/i.test(source)
}

/**
 * Whether a config-declared local source resolves to a path inside `root` (the directory
 * `quartz.config.yaml` lives in -- the same `cwd` the CLI is invoked with; in CI that is
 * `quartz-build/`, a scratch checkout of pinned upstream Quartz overlaid with this repo's config
 * and local plugin, NOT this repository's own checkout -- see `localSourceEscapesRootError`'s doc).
 * This is a DIFFERENT question from `isLocalPluginSource`'s "is this path-shaped" grammar check
 * (issue #3863): a path can be local-shaped and still point anywhere on disk (`/tmp/attacker`,
 * `../../outside`), so shape alone is not a boundary. Deliberately a SEPARATE predicate rather than
 * folded into `isLocalPluginSource` -- overloading one classifier to answer both "is this a local
 * path" and "is this an acceptable local path" is the same shape of bug that produced the lock-side
 * exemption failures in #3862-#3864 (one predicate, two questions, one bypass).
 *
 * A Windows drive-letter form (`C:\evil`) is rejected outright before resolution: `path.resolve` on
 * POSIX does not treat it as an absolute path (it would resolve AS IF relative, which could
 * spuriously pass the containment check), so the drive-letter shape is checked directly rather than
 * trusted to `resolve`'s platform-dependent behavior. Everything else is resolved with `node:path`'s
 * `resolve` (not string prefix matching) so that traversal is caught by where the path actually
 * lands, not by scanning its text for `..` -- `./a/../../outside` must fail by resolution, and
 * `./a/../local-plugin` (which also contains `..` but stays inside) must still pass.
 *
 * This containment check is LEXICAL, not realpath-strength: `resolve` does not traverse symlinks,
 * so a committed `local-plugin -> /etc` symlink resolves inside `root` textually and passes here.
 * Not an escalation in this threat model -- anyone who can commit that symlink into the repo can
 * commit the plugin code directly -- but do not mistake this function for a realpath-equivalent
 * boundary when reusing it elsewhere.
 */
export function isLocalPluginSourceWithinRoot(source: string, root: string): boolean {
  if (/^[A-Z]:[\\/]/i.test(source)) return false
  const resolvedRoot = resolve(root)
  const resolvedSource = resolve(root, source)
  return resolvedSource === resolvedRoot || resolvedSource.startsWith(resolvedRoot + sep)
}

/**
 * Extract the string form of a `string | QuartzPluginObjectSource` value, or `null` when none
 * exists (an object source with no string `repo`, or an absent source). Shared by the config-side
 * local-source derivation and the lock-side identification, since `QuartzConfigPlugin.source` and
 * `LockPluginEntry.source` are the same shape.
 */
function extractSourceString(source: string | QuartzPluginObjectSource | undefined): string | null {
  if (typeof source === 'string') return source
  if (source && typeof source.repo === 'string') return source.repo
  return null
}

/**
 * A lock entry may never be local. Four PRs in a row (#3862-#3864) tried narrowing an EXEMPTION
 * for local-looking lock entries by checking progressively more of the entry's own fields --
 * `commit`, then `source`, and review then found the pointer the build actually consumes
 * (`resolved`) was still unchecked. Every one of those fields lives INSIDE the lockfile, the
 * artifact this gate exists to distrust, so no combination of them can be a trusted exemption
 * basis. The fix is to stop granting the exemption at all: local plugins are resolved directly
 * from `quartz.config.yaml` at build time (see `isLocalPluginSource` above, still used on the
 * CONFIG side, unchanged) and never need a lock entry. A lock entry claiming a local-looking
 * source is therefore always wrong, in both gates, with no field check required.
 */
function lockEntryMustNotBeLocalError(name: string, sourceLabel: string): string {
  return `lock entry "${name}" (${sourceLabel}) has a local source -- local plugins are resolved from quartz.config.yaml and must not appear in quartz.lock.json`
}

/**
 * A lock entry whose source can't be identified as a string at all (`extractSourceString` returns
 * `null`) is malformed -- reported distinctly rather than silently falling through to the generic
 * orphan check with a source label that was never actually checked for local-declaration membership.
 */
function malformedLockSourceError(name: string, source: string | QuartzPluginObjectSource): string {
  return `lock entry "${name}" has a source that cannot be identified (neither a string nor an object with a string "repo"): ${JSON.stringify(source)}`
}

/**
 * A config-declared local source (issue #3863) resolves outside the build root -- named "build
 * root" rather than "repository" deliberately: the anchor is `cwd`, which in CI is `quartz-build/`
 * (the pinned upstream Quartz checkout plus this repo's overlay), not this repository's own
 * checkout. Quartz symlinks or copies from this path at build time with no boundary of its own, so
 * this gate is the only place that can be bounded. Rejected with guidance toward the fix rather
 * than left exempt.
 */
function localSourceEscapesRootError(source: string): string {
  return `enabled plugin declares a local source outside the build root: ${source} -- use a repo-relative "./" path instead`
}

/**
 * A malformed entry in `config.plugins` (not an object -- e.g. a YAML `plugins:` list containing a
 * bare `-` item, which parses to `null`) or `lock.plugins` (not an object -- e.g. a JSON `null`
 * value). Guarded at the top of BOTH loops in BOTH gate functions: this is the same class of gap
 * `loadQuartzConfig`/`loadLockFile` closed one grammar level up (the parsed document itself might
 * not be an object) -- a document can be a well-formed object while one of its own list/map entries
 * is not, and each position in the grammar needs its own check, not just the top of the document
 * (see docs/solutions/security-issues/mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md:
 * a check present at one grammar position and silently absent at the next one down is exactly the
 * failure mode mutation testing cannot surface, since no mutator inserts a missing validation).
 */
function malformedEntryError(location: string, entry: unknown): string {
  return `${location} is not a valid entry (not an object): ${JSON.stringify(entry)}`
}

/**
 * Classify a Quartz plugin-source string as remote per `parseGitSource`'s grammar (order matters:
 * `github:`, then `git+`, then `https://`; anything else is unparseable). There is no bare
 * two-part `owner/repo` shorthand here -- that form exists only in `gitLoader.ts::parsePluginSource`
 * (the build-time installer used by `install-plugins.ts`), not in `plugin-data.js::parseGitSource`
 * (what actually writes the lockfile in `plugin-git-handlers.js`). Callers must check
 * `isLocalPluginSource` first -- this function does not itself exempt local paths.
 */
function isRemotePluginSourceString(source: string): boolean {
  if (source.startsWith('github:')) return true
  if (source.startsWith('git+')) return true
  return source.startsWith('https://')
}

/**
 * Verify that every enabled remote plugin in `config` has a matching entry
 * in `lock`, and that every lock entry corresponds to an enabled config
 * plugin (no orphans).
 *
 * Quartz's plugin-source grammar, verified at the pinned SHA
 * `9cf87ff1c248a8ca551093214b0fec3b31415009`. Gate A models `quartz/cli/plugin-data.js::parseGitSource`,
 * not `quartz/plugins/loader/gitLoader.ts::parsePluginSource` -- the former is what
 * `plugin-git-handlers.js` calls to actually write `quartz.lock.json`, so it is the grammar that
 * governs lock coverage. `parseGitSource`, in order:
 * - `./p`, `../p`, `/p`, or a Windows drive path (`C:\p`) -> local, exempt.
 * - `github:owner/repo[#ref]` -> remote, checked against the lock verbatim.
 * - `git+<url>[#ref]` -> remote, checked against the lock verbatim.
 * - `https://<url>[#ref]` -> remote, checked against the lock verbatim.
 * - anything else -> Quartz throws `Cannot parse plugin source`; this gate reports it as an error
 *   instead of silently exempting it. (Note: `parsePluginSource` in `gitLoader.ts` additionally
 *   accepts a bare two-part `owner/repo` shorthand, but that parser never runs during lock writes,
 *   so a bare `owner/repo` here is correctly reported unparseable, not silently trusted.)
 *
 * Object sources are rejected outright unless their `repo` is local: Quartz's lockfile writer
 * stores the config `source` value verbatim, so an object config source produces an object in
 * `lock.plugins[x].source`, which can never `===`-match a normalized string. The gate compares
 * source strings, so a remote plugin must be declared as a string source to be lock-coverable.
 * `subdir` and `ref` are rejected the same way for the same reason -- both are stored as separate
 * lock fields alongside a verbatim `source`, so neither can be folded into a normalized string
 * identity either. An object source whose `repo` is neither local nor a usable non-empty string
 * (`{}`, `{repo: ''}`, `{repo: 123}`, `{name: 'x'}` with no `repo`) is reported as malformed rather
 * than silently ignored.
 *
 * Disabled plugins (`enabled === false`) are skipped entirely -- a disabled remote plugin's lock
 * entry is still an orphan (unchanged). A lock entry with a local-looking source is always an error
 * (see `lockEntryMustNotBeLocalError`'s doc): local plugins are resolved from config and must never
 * appear in the lockfile at all, so there is no config-declaration lookup to perform here.
 *
 * `root` is the build-root boundary anchor for `isLocalPluginSourceWithinRoot` (issue #3863): a
 * local-shaped config source must additionally resolve inside `root`, or it is rejected rather than
 * exempted. `root` is the directory `quartz.config.yaml` lives in -- i.e. the same `cwd` the CLI is
 * invoked with (`quartz-build/` in CI -- the scratch pinned-Quartz checkout, not this repository's
 * own checkout; `quartz-site/` when this repo's fixtures/CLI are exercised directly) -- because that
 * is the one path both the real local plugin (`./local-plugin`, `./local-plugin/sanitizer`) and
 * every local source string are already resolved relative to; anchoring anywhere else would accept
 * or reject paths using a root the source strings were never written against.
 */
export function checkLockfileCoverage(config: QuartzConfig, lock: LockFile, root: string): CoverageGateResult {
  const lockPlugins = lock.plugins ?? {}
  const errors: string[] = []
  const enabledRemoteSources = new Set<string>()

  for (const [index, plugin] of (config.plugins ?? []).entries()) {
    if (typeof plugin !== 'object' || plugin === null) {
      errors.push(malformedEntryError(`config.plugins[${index}]`, plugin))
      continue
    }
    if (plugin.enabled === false) continue
    const source = plugin.source

    if (typeof source === 'string') {
      if (isLocalPluginSource(source)) {
        if (!isLocalPluginSourceWithinRoot(source, root)) errors.push(localSourceEscapesRootError(source))
        continue // local path source: exempt from lock coverage either way (boundary violation is reported above, not converted into a lock requirement)
      }
      if (!isRemotePluginSourceString(source)) {
        errors.push(`unparseable plugin source (Quartz would throw "Cannot parse plugin source"): ${source}`)
        continue
      }
      enabledRemoteSources.add(source)
      const entry = Object.values(lockPlugins).some(p => p.source === source)
      if (!entry) errors.push(`missing lock entry for enabled remote plugin: ${source}`)
      continue
    }

    // `typeof source === 'string'` continued above, so this narrows to the object case; a truthy
    // non-object (malformed YAML) has no `.repo`/`subdir` and falls through every check inside with no error -- same as before.
    if (source) {
      // Ordering is intentional: a local `./` repo is exempt even if `subdir` is also present -- the
      // local-path check runs before the subdir/ref/remote-object-rejection checks below.
      if (typeof source.repo === 'string' && isLocalPluginSource(source.repo)) {
        if (!isLocalPluginSourceWithinRoot(source.repo, root)) errors.push(localSourceEscapesRootError(source.repo))
        continue // local path source: exempt from lock coverage either way, same as the string-source case above
      }
      if (Object.prototype.hasOwnProperty.call(source, 'subdir')) {
        errors.push(`enabled remote plugin uses rejected object-source subdir: ${JSON.stringify(source)}`)
        continue
      }
      if (Object.prototype.hasOwnProperty.call(source, 'ref')) {
        errors.push(`enabled remote plugin uses rejected object-source ref: ${JSON.stringify(source)}`)
        continue
      }
      // A remote object source is rejected outright -- Quartz's lockfile writer stores `source`
      // verbatim, so an object here produces an object in the lock, which can never `===`-match a
      // normalized string. Declare remote plugins as string sources so coverage can compare them.
      if (typeof source.repo === 'string' && source.repo.length > 0) {
        errors.push(
          `enabled remote plugin uses rejected object-source form; declare it as a string source instead: ${JSON.stringify(source)}`,
        )
      } else if (typeof source === 'object') {
        errors.push(
          `enabled plugin has a malformed object source (missing or invalid "repo"): ${JSON.stringify(source)}`,
        )
      }
    }
  }

  for (const [name, entry] of Object.entries(lockPlugins)) {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(malformedEntryError(`lock entry "${name}"`, entry))
      continue
    }
    const entrySourceString = extractSourceString(entry.source)
    if (entrySourceString === null) {
      errors.push(malformedLockSourceError(name, entry.source))
      continue
    }
    // Membership is tested on the rendered label rather than on `entry.source` itself: the set only
    // ever holds raw config strings, so a JSON-rendered object source can never match it, and an
    // object lock entry with no enabled counterpart is still reported rather than silently skipped.
    const sourceLabel = typeof entry.source === 'string' ? entry.source : JSON.stringify(entry.source)
    if (isLocalPluginSource(entrySourceString)) {
      errors.push(lockEntryMustNotBeLocalError(name, sourceLabel))
      continue
    }
    if (!enabledRemoteSources.has(sourceLabel)) {
      errors.push(`lock entry "${name}" (${sourceLabel}) is not an enabled plugin in quartz.config.yaml`)
    }
  }

  return {ok: errors.length === 0, errors, enabledRemoteCount: enabledRemoteSources.size}
}

// ---------------------------------------------------------------------------
// checkLockfileIntegrity — Gate B (post-install): lock<->.git/HEAD integrity
// ---------------------------------------------------------------------------

/**
 * Verify that every plugin's actual checked-out `.git/HEAD` matches its
 * lockfile commit SHA.
 *
 * `readHead(name)` returns the trimmed `.git/HEAD` content for the named
 * plugin, or `null` if the plugin directory/HEAD file is missing. A `ref:
 * refs/heads/...` line (branch checkout) never equals a pinned SHA, so it
 * naturally fails the equality check — this is how branch drift is caught.
 *
 * A lock entry with a local-looking source is an error here too, the SAME rule Gate A applies (see
 * `lockEntryMustNotBeLocalError`'s doc) -- neither gate needs `quartz.config.yaml` to make this
 * decision, since a local-looking lock entry is wrong regardless of what config says.
 */
export function checkLockfileIntegrity(lock: LockFile, readHead: (name: string) => string | null): GateResult {
  const errors: string[] = []
  const plugins = lock.plugins ?? {}

  for (const [name, entry] of Object.entries(plugins)) {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(malformedEntryError(`lock entry "${name}"`, entry))
      continue
    }
    const entrySourceString = extractSourceString(entry.source)
    if (entrySourceString === null) {
      errors.push(malformedLockSourceError(name, entry.source))
      continue
    }
    const sourceLabel = typeof entry.source === 'string' ? entry.source : JSON.stringify(entry.source)
    if (isLocalPluginSource(entrySourceString)) {
      errors.push(lockEntryMustNotBeLocalError(name, sourceLabel))
      continue
    }
    const head = readHead(name)
    if (head === null) {
      errors.push(`missing plugin directory/.git/HEAD for "${name}"`)
      continue
    }
    if (head !== entry.commit) {
      errors.push(`"${name}" .git/HEAD ("${head}") does not match lockfile commit ("${entry.commit}")`)
    }
  }

  return {ok: errors.length === 0, errors}
}

// ---------------------------------------------------------------------------
// runCli — testable seam (no process.exit reads; cwd is injected)
// ---------------------------------------------------------------------------

/**
 * Load and parse `quartz.config.yaml` from `cwd`, resolving the `yaml` package from the WORKING
 * DIRECTORY (e.g. quartz-build/), not from this script's own location. In the publish-wiki build
 * job, repo-root node_modules does not exist (that job never runs `pnpm bootstrap` — it only runs
 * `npm ci` inside quartz-build/), so a bare `import('yaml')` resolved from scripts/ would walk up
 * to repo root and fail every time. `createRequire` rooted at `cwd` resolves `yaml` the same way
 * the old inline script did when it ran with cwd=quartz-build (Quartz's own dependency).
 *
 * Used only by coverage mode -- integrity mode no longer needs `quartz.config.yaml` at all, since
 * neither gate exempts local-looking lock entries anymore (see `lockEntryMustNotBeLocalError`'s
 * doc), so it has nothing left to derive from config.
 */
async function loadQuartzConfig(cwd: string): Promise<{ok: true; config: QuartzConfig} | {ok: false; stderr: string}> {
  let YAML: typeof import('yaml')
  try {
    const requireFromCwd = createRequire(join(cwd, 'quartz.config.yaml'))
    YAML = requireFromCwd('yaml') as typeof import('yaml')
  } catch {
    return {
      ok: false,
      stderr: `wiki-lockfile-gates: could not resolve the 'yaml' package from "${cwd}" (expected in quartz-build/node_modules in CI)\n`,
    }
  }
  // Must return the gate's own {exitCode, stdout, stderr} envelope on failure, never an uncaught
  // exception -- a missing file, malformed YAML, or a valid-but-empty/comments-only YAML document
  // (which `YAML.parse` returns as `null` rather than throwing) should all read as a diagnosable
  // gate error, not a crash indistinguishable from a real bug.
  try {
    // Buffer.toString() defaults to utf8; no encoding literal to mutate.
    const configRaw = await readFile(join(cwd, 'quartz.config.yaml'))
    const parsed: unknown = YAML.parse(configRaw.toString())
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        ok: false,
        stderr: `wiki-lockfile-gates: quartz.config.yaml at "${cwd}" did not parse to an object (got ${JSON.stringify(parsed)})\n`,
      }
    }
    return {ok: true, config: parsed}
  } catch (error) {
    return {
      ok: false,
      stderr: `wiki-lockfile-gates: could not read or parse quartz.config.yaml from "${cwd}": ${String(error)}\n`,
    }
  }
}

/**
 * Load and parse `quartz.lock.json` from `cwd`, returning the gate's own failure envelope rather
 * than an uncaught exception. The lockfile is the artifact both gates exist to distrust, so a
 * missing or malformed lockfile deserves at least the same diagnosable-error treatment the config
 * file gets, not a raw stack trace. Shared by both CLI modes.
 */
async function loadLockFile(cwd: string): Promise<{ok: true; lock: LockFile} | {ok: false; stderr: string}> {
  try {
    // Buffer.toString() defaults to utf8; no encoding literal to mutate.
    const lockRaw = await readFile(join(cwd, 'quartz.lock.json'))
    const parsed: unknown = JSON.parse(lockRaw.toString())
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        ok: false,
        stderr: `wiki-lockfile-gates: quartz.lock.json at "${cwd}" did not parse to an object (got ${JSON.stringify(parsed)})\n`,
      }
    }
    return {ok: true, lock: parsed}
  } catch (error) {
    return {
      ok: false,
      stderr: `wiki-lockfile-gates: could not read or parse quartz.lock.json from "${cwd}": ${String(error)}\n`,
    }
  }
}

/**
 * Testable CLI entry point for both gate modes. Does NOT call `process.exit`
 * directly — all inputs (mode, env, cwd) are injected so tests can assert on
 * exit codes and output without spawning a subprocess.
 *
 * `main()` calls this with `process.cwd()` and maps the result to
 * `process.stdout`/`process.stderr`/`process.exit`.
 */
export async function runCli(argv: string[], cwd: string): Promise<{exitCode: number; stdout: string; stderr: string}> {
  const mode = argv[0]

  if (mode === 'coverage') {
    const loadedConfig = await loadQuartzConfig(cwd)
    if (!loadedConfig.ok) return {exitCode: 2, stdout: '', stderr: loadedConfig.stderr}
    const loadedLock = await loadLockFile(cwd)
    if (!loadedLock.ok) return {exitCode: 2, stdout: '', stderr: loadedLock.stderr}
    const lock = loadedLock.lock

    const result = checkLockfileCoverage(loadedConfig.config, lock, cwd)
    if (!result.ok) {
      const lines = ['Lockfile coverage gate failed:', ...result.errors.map(e => `  - ${e}`)]
      return {exitCode: 1, stdout: '', stderr: `${lines.join('\n')}\n`}
    }
    const lockCount = Object.keys(lock.plugins ?? {}).length
    return {
      exitCode: 0,
      stdout: `Lockfile coverage gate passed: ${result.enabledRemoteCount} enabled remote plugin(s) match ${lockCount} lock entr${lockCount === 1 ? 'y' : 'ies'}.\n`,
      stderr: '',
    }
  }

  if (mode === 'integrity') {
    // No `quartz.config.yaml` load here: neither gate exempts local-looking lock entries anymore,
    // so integrity mode has nothing to derive from config (see `checkLockfileIntegrity`'s doc).
    const loadedLock = await loadLockFile(cwd)
    if (!loadedLock.ok) return {exitCode: 2, stdout: '', stderr: loadedLock.stderr}
    const lock = loadedLock.lock

    const readHead = (name: string): string | null => {
      const headPath = join(cwd, '.quartz', 'plugins', name, '.git', 'HEAD')
      try {
        return readFileSync(headPath, 'utf8').trim()
      } catch {
        return null
      }
    }

    const result = checkLockfileIntegrity(lock, readHead)
    if (!result.ok) {
      const lines = ['Lockfile integrity gate failed:', ...result.errors.map(e => `  - ${e}`)]
      return {exitCode: 1, stdout: '', stderr: `${lines.join('\n')}\n`}
    }
    const count = Object.keys(lock.plugins ?? {}).length
    return {
      exitCode: 0,
      stdout: `Lockfile integrity gate passed: ${count} plugin(s) verified against .git/HEAD.\n`,
      stderr: '',
    }
  }

  return {
    exitCode: 2,
    stdout: '',
    stderr: `wiki-lockfile-gates: unknown mode "${mode ?? ''}" (expected "coverage" or "integrity")\n`,
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), process.cwd())
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
