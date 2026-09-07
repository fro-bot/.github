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
  source: string
  commit: string
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
 * Classify a Quartz plugin-source string as remote per `parsePluginSource`'s
 * grammar (order matters: `github:`, then `git+`, then `https://`, then a
 * bare two-part `owner/repo` -- literally "exactly two `/`-separated parts",
 * with no non-emptiness check, mirroring Quartz's own
 * `if (parts.length === 2)`). Callers must check `isLocalPluginSource` first
 * -- this function does not itself exempt local paths.
 */
function isRemotePluginSourceString(source: string): boolean {
  if (source.startsWith('github:')) return true
  if (source.startsWith('git+')) return true
  if (source.startsWith('https://')) return true
  return source.split('/').length === 2
}

/**
 * Normalize an object-source `repo` string to the form Quartz would resolve
 * it to, recursing the same classification `parsePluginSource` applies to a
 * top-level string source. A bare `owner/repo` normalizes to a `github:`
 * prefix (matching Quartz's GitHub default); a source already prefixed
 * `github:`, `git+`, or `https://` passes through unchanged -- fixing the
 * latent double-prefix bug where `{repo: 'github:owner/repo'}` used to
 * become `github:github:owner/repo`. Returns `null` when Quartz itself
 * would throw (unparseable).
 */
function normalizeRemotePluginSourceRepo(repo: string): string | null {
  if (repo.startsWith('github:') || repo.startsWith('git+') || repo.startsWith('https://')) return repo
  if (repo.split('/').length === 2) return `github:${repo}`
  return null
}

/**
 * Verify that every enabled remote plugin in `config` has a matching entry
 * in `lock`, and that every lock entry corresponds to an enabled config
 * plugin (no orphans).
 *
 * Quartz's plugin-source grammar, verified at the pinned SHA
 * `9cf87ff1c248a8ca551093214b0fec3b31415009` (`quartz/plugins/loader/gitLoader.ts`,
 * `parsePluginSource`), tried in order:
 * - `./p`, `../p`, `/p`, or a Windows drive path (`C:\p`) -> local, exempt.
 * - `github:owner/repo[#ref]` -> remote, checked against the lock verbatim.
 * - `git+<url>[#ref]` -> remote, checked against the lock verbatim.
 * - `https://<url>[#ref]` -> remote, checked against the lock verbatim.
 * - a bare source with exactly two `/`-separated parts -> remote, treated as GitHub.
 *   This is a raw `parts.length === 2` test upstream, so `gitlab:owner/repo` and
 *   `git@host:owner/repo.git` land here rather than throwing.
 * - anything else -> Quartz throws `Cannot parse plugin source`; this gate reports it
 *   as an error instead of silently exempting it.
 *
 * Object sources recurse the same classification over `source.repo`. `subdir` and
 * `ref` are rejected outright, since neither can be expressed in lock identity.
 * Disabled plugins (`enabled === false`) are skipped entirely. Lock entries whose
 * source isn't in the enabled-remote-source set are orphans.
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
      // local-path check runs before the subdir/ref-rejection checks below.
      if (typeof source.repo === 'string' && isLocalPluginSource(source.repo)) continue // local path source, exempt
      if (Object.prototype.hasOwnProperty.call(source, 'subdir')) {
        errors.push(`enabled remote plugin uses rejected object-source subdir: ${JSON.stringify(source)}`)
        continue
      }
      // `ref` is rejected the same way `subdir` is: lock identity is the source string alone, so a
      // ref-bearing object source cannot be expressed in the lock. We prefer rejection over folding
      // ref into identity because there is no ground truth for what Quartz writes to the lock for a
      // refed object source, and a wrong guess would fail open. The string-form equivalent
      // (`github:owner/repo#ref`) already fails closed for free, since the whole string including
      // `#ref` is stored verbatim and won't match an unrefed lock entry.
      if (Object.prototype.hasOwnProperty.call(source, 'ref')) {
        errors.push(`enabled remote plugin uses rejected object-source ref: ${JSON.stringify(source)}`)
        continue
      }
      if (typeof source.repo === 'string' && source.repo.length > 0) {
        const normalized = normalizeRemotePluginSourceRepo(source.repo)
        if (normalized === null) {
          errors.push(
            `unparseable object-source repo (Quartz would throw "Cannot parse plugin source"): ${JSON.stringify(source)}`,
          )
          continue
        }
        enabledRemoteSources.add(normalized)
        const entry = Object.values(lockPlugins).some(p => p.source === normalized)
        if (!entry) errors.push(`missing lock entry for enabled remote plugin: ${normalized}`)
      }
    }
  }

  for (const [name, entry] of Object.entries(lockPlugins)) {
    if (!enabledRemoteSources.has(entry.source)) {
      errors.push(`lock entry "${name}" (${entry.source}) is not an enabled plugin in quartz.config.yaml`)
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
 */
export function checkLockfileIntegrity(lock: LockFile, readHead: (name: string) => string | null): GateResult {
  const errors: string[] = []
  const plugins = lock.plugins ?? {}

  for (const [name, entry] of Object.entries(plugins)) {
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
