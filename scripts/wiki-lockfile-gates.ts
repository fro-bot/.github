import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {join} from 'node:path'
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
 * Derive the source string a lock entry would need to be classified as local -- a string source is
 * itself; an object source uses `.repo` when it is a string. Returns `null` when no usable source
 * string exists (e.g. an object source with no `repo`).
 */
function lockEntrySourceString(entry: LockPluginEntry): string | null {
  if (typeof entry.source === 'string') return entry.source
  if (typeof entry.source.repo === 'string') return entry.source.repo
  return null
}

/**
 * Whether a lock entry's own `source` shape is local, per `isLocalPluginSource`. This is the ONLY
 * predicate either gate may use to exempt a lock entry from remote-plugin handling --
 * `entry.commit` must never participate in that decision. `commit` is a value the lockfile itself
 * controls, so keying an exemption on `commit === 'local'` lets a forged lock entry (a remote
 * `source` paired with a hand-written `commit: 'local'`) claim the local exemption and slip both
 * Gate A's orphan check and Gate B's HEAD-integrity check. `source` shape cannot be forged the same
 * way: it is either the literal config-declared source (Gate A) or an already-trusted lock field
 * that Gate B's integrity check is the very thing verifying (Gate B does not re-derive `source`
 * from anywhere the plugin controls).
 */
export function isLocalLockEntry(entry: LockPluginEntry): boolean {
  const sourceString = lockEntrySourceString(entry)
  return sourceString !== null && isLocalPluginSource(sourceString)
}

/**
 * Message for a lock entry whose `source` is local but whose `commit` isn't the local sentinel --
 * an inconsistency worth failing on rather than silently accepting, now that `commit` no longer
 * grants the local exemption itself.
 */
function localCommitMismatchError(name: string, entry: LockPluginEntry): string {
  return `lock entry "${name}" has a local source but commit "${entry.commit}" is not "local" -- local plugins must record commit: "local"`
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
 * Disabled plugins (`enabled === false`) are skipped entirely. Lock entries are exempted from the
 * orphan check by `isLocalLockEntry` -- their OWN `source` shape, never `entry.commit` (see that
 * function's doc for why keying the exemption on `commit` is a fail-open). A local lock entry
 * whose `commit` isn't the `'local'` sentinel is a self-inconsistency and is reported as an error.
 */
export function checkLockfileCoverage(config: QuartzConfig, lock: LockFile): CoverageGateResult {
  const lockPlugins = lock.plugins ?? {}
  const errors: string[] = []
  const enabledRemoteSources = new Set<string>()

  // Stryker disable next-line ArrayDeclaration: the placeholder element has no .enabled/.source, so
  // every branch below skips it like an empty array.
  for (const plugin of config.plugins ?? []) {
    if (plugin.enabled === false) continue
    const source = plugin.source

    if (typeof source === 'string') {
      if (isLocalPluginSource(source)) continue // local path source, exempt
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
      if (typeof source.repo === 'string' && isLocalPluginSource(source.repo)) continue // local path source, exempt
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
    if (isLocalLockEntry(entry)) {
      if (entry.commit !== 'local') errors.push(localCommitMismatchError(name, entry))
      continue
    }
    // Membership is tested on the rendered label rather than on `entry.source` itself: the set only
    // ever holds raw config strings, so a JSON-rendered object source can never match it, and an
    // object lock entry with no enabled counterpart is still reported rather than silently skipped.
    const sourceLabel = typeof entry.source === 'string' ? entry.source : JSON.stringify(entry.source)
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
 * Local entries (`isLocalLockEntry`, the SAME predicate Gate A uses) are skipped: a local plugin is
 * symlinked, not cloned, so it has no meaningful `.git/HEAD` to compare against a pinned commit --
 * without this exemption it would fail either as a missing HEAD or as a branch-ref mismatch. A local
 * entry whose `commit` isn't the `'local'` sentinel is still reported, the same as in Gate A.
 */
export function checkLockfileIntegrity(lock: LockFile, readHead: (name: string) => string | null): GateResult {
  const errors: string[] = []
  const plugins = lock.plugins ?? {}

  for (const [name, entry] of Object.entries(plugins)) {
    if (isLocalLockEntry(entry)) {
      if (entry.commit !== 'local') errors.push(localCommitMismatchError(name, entry))
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
    // Resolve `yaml` from the WORKING DIRECTORY (e.g. quartz-build/), not
    // from this script's own location. In the publish-wiki build job,
    // repo-root node_modules does not exist (that job never runs `pnpm
    // bootstrap` — it only runs `npm ci` inside quartz-build/), so a bare
    // `import('yaml')` resolved from scripts/ would walk up to repo root
    // and fail every time. `createRequire` rooted at `cwd` resolves `yaml`
    // the same way the old inline script did when it ran with
    // cwd=quartz-build (Quartz's own dependency).
    let YAML: typeof import('yaml')
    try {
      const requireFromCwd = createRequire(join(cwd, 'quartz.config.yaml'))
      YAML = requireFromCwd('yaml') as typeof import('yaml')
    } catch {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `wiki-lockfile-gates: could not resolve the 'yaml' package from "${cwd}" (expected in quartz-build/node_modules in CI)\n`,
      }
    }
    // Buffer.toString() defaults to utf8; no encoding literal to mutate.
    const configRaw = await readFile(join(cwd, 'quartz.config.yaml'))
    const config = YAML.parse(configRaw.toString()) as QuartzConfig
    const lockRaw = await readFile(join(cwd, 'quartz.lock.json'))
    const lock = JSON.parse(lockRaw.toString()) as LockFile

    const result = checkLockfileCoverage(config, lock)
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
    // Buffer.toString() defaults to utf8; no encoding literal to mutate.
    const lockRaw = await readFile(join(cwd, 'quartz.lock.json'))
    const lock = JSON.parse(lockRaw.toString()) as LockFile

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
