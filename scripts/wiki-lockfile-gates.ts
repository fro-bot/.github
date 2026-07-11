import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuartzPluginObjectSource {
  repo?: string
  subdir?: string
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

// ---------------------------------------------------------------------------
// checkLockfileCoverage — Gate A (pre-install): config<->lock coverage
// ---------------------------------------------------------------------------

/**
 * Verify that every enabled remote (github:) plugin in `config` has a
 * matching entry in `lock`, and that every lock entry corresponds to an
 * enabled config plugin (no orphans).
 *
 * Ported verbatim from the workflow's inline Gate A `node -e` script:
 * - String sources not prefixed `github:` are treated as local and skipped.
 * - Object sources with a `repo` starting `./` are local and exempt.
 * - Object sources with a `subdir` property are rejected outright.
 * - Object sources with `repo` are normalized to a `github:` prefix before matching.
 * - Disabled plugins (`enabled === false`) are skipped entirely.
 * - Lock entries whose source isn't in the enabled-remote-source set are orphans.
 */
export function checkLockfileCoverage(config: QuartzConfig, lock: LockFile): GateResult {
  const lockPlugins = lock.plugins ?? {}
  const errors: string[] = []
  const enabledRemoteSources = new Set<string>()

  for (const plugin of config.plugins ?? []) {
    if (plugin.enabled === false) continue
    const source = plugin.source

    if (typeof source === 'string') {
      if (!source.startsWith('github:')) continue // not a remote plugin
      enabledRemoteSources.add(source)
      const entry = Object.values(lockPlugins).find(p => p.source === source)
      if (!entry) errors.push(`missing lock entry for enabled remote plugin: ${source}`)
      continue
    }

    if (source && typeof source === 'object') {
      if (typeof source.repo === 'string' && source.repo.startsWith('./')) continue // local path source, exempt
      if (Object.prototype.hasOwnProperty.call(source, 'subdir')) {
        errors.push(`enabled remote plugin uses rejected object-source subdir: ${JSON.stringify(source)}`)
        continue
      }
      if (typeof source.repo === 'string' && source.repo.length > 0) {
        const normalized = `github:${source.repo}`
        enabledRemoteSources.add(normalized)
        const entry = Object.values(lockPlugins).find(p => p.source === normalized)
        if (!entry) errors.push(`missing lock entry for enabled remote plugin: ${normalized}`)
      }
    }
  }

  for (const [name, entry] of Object.entries(lockPlugins)) {
    if (!enabledRemoteSources.has(entry.source)) {
      errors.push(`lock entry "${name}" (${entry.source}) is not an enabled plugin in quartz.config.yaml`)
    }
  }

  return {ok: errors.length === 0, errors}
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
export async function runCli(
  argv: string[],
  _env: Record<string, string | undefined>,
  cwd: string,
): Promise<{exitCode: number; stdout: string; stderr: string}> {
  const mode = argv[0]

  if (mode === 'coverage') {
    let YAML: typeof import('yaml')
    try {
      YAML = await import('yaml')
    } catch {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          "wiki-lockfile-gates: the 'yaml' package is required for coverage mode (available in quartz-build/node_modules in CI)\n",
      }
    }
    const configRaw = await readFile(join(cwd, 'quartz.config.yaml'), 'utf8')
    const config = YAML.parse(configRaw) as QuartzConfig
    const lockRaw = await readFile(join(cwd, 'quartz.lock.json'), 'utf8')
    const lock = JSON.parse(lockRaw) as LockFile

    const result = checkLockfileCoverage(config, lock)
    if (!result.ok) {
      const lines = ['Lockfile coverage gate failed:', ...result.errors.map(e => `  - ${e}`)]
      return {exitCode: 1, stdout: '', stderr: `${lines.join('\n')}\n`}
    }
    const lockCount = Object.keys(lock.plugins ?? {}).length
    return {
      exitCode: 0,
      stdout: `Lockfile coverage gate passed: ${lockCount} lock entr${lockCount === 1 ? 'y' : 'ies'} verified.\n`,
      stderr: '',
    }
  }

  if (mode === 'integrity') {
    const lockRaw = await readFile(join(cwd, 'quartz.lock.json'), 'utf8')
    const lock = JSON.parse(lockRaw) as LockFile

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
  const result = await runCli(process.argv.slice(2), process.env as Record<string, string | undefined>, process.cwd())
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
