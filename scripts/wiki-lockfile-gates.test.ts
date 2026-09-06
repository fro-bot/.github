import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import process from 'node:process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  checkLockfileCoverage,
  checkLockfileIntegrity,
  runCli,
  type LockFile,
  type QuartzConfig,
} from './wiki-lockfile-gates.ts'

const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// checkLockfileCoverage — Gate A
// ---------------------------------------------------------------------------

describe('checkLockfileCoverage', () => {
  it('passes when every enabled github plugin has a matching lock entry (N==N)', () => {
    // #given a config with one enabled remote plugin and a lock with exactly one matching entry
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'github:quartz-community/plugin-a'}],
    }
    const lock: LockFile = {
      plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes with no errors
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails when an enabled remote plugin has no lock entry', () => {
    // #given an enabled github plugin absent from the lock
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: 'github:quartz-community/plugin-a'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails naming the missing plugin
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('github:quartz-community/plugin-a'))).toBe(true)
  })

  it('fails when a lock entry is not an enabled config plugin (orphan)', () => {
    // #given a lock entry whose source is not in the enabled config plugin list
    const config: QuartzConfig = {plugins: []}
    const lock: LockFile = {
      plugins: {orphan: {source: 'github:quartz-community/ghost', commit: 'def456'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails naming the orphan entry
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('orphan'))).toBe(true)
  })

  it('fails when an object-source plugin uses a rejected subdir property', () => {
    // #given an enabled plugin with object source containing a subdir key
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-b', subdir: 'packages/x'}}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails rejecting the subdir usage
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('subdir'))).toBe(true)
  })

  it('exempts a local "./" string source from requiring a lock entry', () => {
    // #given an enabled plugin with a local relative-path string source and no lock entries
    const config: QuartzConfig = {plugins: [{enabled: true, source: './local-plugin'}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — local sources are exempt
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('exempts a local "./" object-form repo source from requiring a lock entry', () => {
    // #given an enabled plugin with an object source whose repo is a local relative path
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: './local-plugin'}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — local object-form sources are exempt
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does not require a lock entry for a disabled plugin', () => {
    // #given a disabled remote plugin absent from the lock
    const config: QuartzConfig = {
      plugins: [{enabled: false, source: 'github:quartz-community/disabled-plugin'}],
    }
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — disabled plugins are not required to be locked
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('normalizes object-form {repo} to a github: prefix and matches the lock entry', () => {
    // #given an enabled plugin with object source repo (no github: prefix) matching a lock entry with the normalized source
    const config: QuartzConfig = {
      plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-c'}}],
    }
    const lock: LockFile = {
      plugins: {'plugin-c': {source: 'github:quartz-community/plugin-c', commit: 'ghi789'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes — normalization matches
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does not error and requires no lock entry when an enabled plugin has no source at all', () => {
    // #given an enabled plugin whose `source` key is entirely absent (a valid QuartzConfigPlugin shape)
    const config: QuartzConfig = {plugins: [{enabled: true}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes silently — an absent source is neither remote nor local, so nothing is required
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does not throw and requires no lock entry when an object source has neither repo nor subdir', () => {
    // #given an enabled plugin with an empty object source (no repo, no subdir — a degenerate but
    // #type-legal QuartzPluginObjectSource)
    const config: QuartzConfig = {plugins: [{enabled: true, source: {}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes silently — no repo means nothing to classify as remote or local
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does not require a lock entry when an object-source repo normalizes to an empty string', () => {
    // #given an enabled plugin whose object-source repo is present but empty
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: ''}}]}
    const lock: LockFile = {plugins: {}}

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it passes silently — an empty repo is not a valid remote source to require or normalize
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('matches an object-form repo via .some() even when other lock entries do not match it', () => {
    // #given one enabled object-source plugin and a lock with two entries, only one of which matches
    // #the normalized source — proves the entry lookup uses "any entry matches" (.some), not
    // #"every entry matches" (.every)
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-q'}}]}
    const lock: LockFile = {
      plugins: {
        'plugin-q': {source: 'github:quartz-community/plugin-q', commit: 'sha-q'},
        orphan: {source: 'github:quartz-community/unrelated', commit: 'sha-o'},
      },
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then the matching entry satisfies coverage — no "missing lock entry" error for plugin-q — but the
    // #unrelated entry is still flagged as an orphan
    expect(result.errors.some(e => e.includes('missing lock entry'))).toBe(false)
    expect(result.errors.some(e => e.includes('orphan') && e.includes('unrelated'))).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('fails naming the specific missing object-form entry, distinguished from unrelated orphans', () => {
    // #given one enabled object-source plugin and a lock with two entries, neither matching it
    const config: QuartzConfig = {plugins: [{enabled: true, source: {repo: 'quartz-community/plugin-q'}}]}
    const lock: LockFile = {
      plugins: {
        other1: {source: 'github:quartz-community/other1', commit: 'sha-1'},
        other2: {source: 'github:quartz-community/other2', commit: 'sha-2'},
      },
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails naming plugin-q as missing, plus both unrelated lock entries as orphans
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('missing lock entry for enabled remote plugin: github:quartz-community/plugin-q')
    expect(result.errors.some(e => e.includes('other1'))).toBe(true)
    expect(result.errors.some(e => e.includes('other2'))).toBe(true)
  })

  it('MUTATION-PROOF: a tampered lock with one entry removed fails coverage', () => {
    // #given two enabled remote plugins but a lock with only one of the two entries (tampered/incomplete)
    const config: QuartzConfig = {
      plugins: [
        {enabled: true, source: 'github:quartz-community/plugin-a'},
        {enabled: true, source: 'github:quartz-community/plugin-b'},
      ],
    }
    const lock: LockFile = {
      plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}},
    }

    // #when checking coverage
    const result = checkLockfileCoverage(config, lock)

    // #then it fails — proving the gate is load-bearing and would catch a tampered lockfile
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('github:quartz-community/plugin-b'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// checkLockfileIntegrity — Gate B
// ---------------------------------------------------------------------------

describe('checkLockfileIntegrity', () => {
  it('passes when every plugin HEAD matches its lock commit', () => {
    // #given a lock with two entries whose readHead returns the exact matching commit SHA
    const lock: LockFile = {
      plugins: {
        'plugin-a': {source: 'github:x/a', commit: 'sha-a'},
        'plugin-b': {source: 'github:x/b', commit: 'sha-b'},
      },
    }
    const readHead = (name: string): string | null => (name === 'plugin-a' ? 'sha-a' : 'sha-b')

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it passes
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails and names the plugin when a HEAD SHA does not match the lock commit', () => {
    // #given a plugin whose HEAD is a different commit than the lock records
    const lock: LockFile = {plugins: {'plugin-a': {source: 'github:x/a', commit: 'sha-a'}}}
    const readHead = (): string => 'sha-drifted'

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails naming the plugin
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('plugin-a'))).toBe(true)
  })

  it('fails when HEAD contains a branch ref instead of a pinned commit', () => {
    // #given a plugin checked out to a branch (HEAD is a ref line, not a SHA)
    const lock: LockFile = {plugins: {'plugin-a': {source: 'github:x/a', commit: 'sha-a'}}}
    const readHead = (): string => 'ref: refs/heads/main'

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails — branch drift never equals a pinned SHA
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('plugin-a'))).toBe(true)
  })

  it('fails when the plugin directory/.git/HEAD is missing', () => {
    // #given a lock entry whose readHead returns null (directory absent)
    const lock: LockFile = {plugins: {'plugin-a': {source: 'github:x/a', commit: 'sha-a'}}}
    const readHead = (): null => null

    // #when checking integrity
    const result = checkLockfileIntegrity(lock, readHead)

    // #then it fails naming the missing plugin
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('plugin-a') && e.toLowerCase().includes('missing'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// runCli — CLI integration against tmpdir fixtures
// ---------------------------------------------------------------------------

// These `runCli` tests exercise coverage mode against a real fixture cwd, so
// they need `yaml` resolvable from that cwd — mirroring the CI topology by
// symlinking THIS repo's own installed `yaml` package into the fixture's
// node_modules, rather than relying on a bare `import('yaml')` resolving
// upward from the script's own directory (the exact P0 this gate exists to
// avoid re-introducing).
async function symlinkRepoYamlInto(dir: string): Promise<void> {
  const repoYamlPkgJson = require.resolve('yaml/package.json')
  const repoYamlDir = dirname(repoYamlPkgJson)
  const nodeModules = join(dir, 'node_modules')
  await mkdir(nodeModules, {recursive: true})
  await symlink(repoYamlDir, join(nodeModules, 'yaml'), 'dir')
}

describe('runCli', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiki-lockfile-gates-'))
  })

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('coverage mode exits 0 on a valid fixture pair', async () => {
    // #given a config and lock that fully match, written to fixture files in cwd
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}}}),
      'utf8',
    )
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then it exits 0 with a summary naming both the enabled-source and lock-entry counts
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Lockfile coverage gate passed: 1 enabled remote plugin(s) match 1 lock entry.\n')
  })

  it('coverage mode pluralizes "entries" when more than one plugin is locked', async () => {
    // #given two enabled remote plugins each with a matching lock entry
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n  - enabled: true\n    source: github:quartz-community/plugin-b\n',
      'utf8',
    )
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({
        plugins: {
          'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'},
          'plugin-b': {source: 'github:quartz-community/plugin-b', commit: 'def456'},
        },
      }),
      'utf8',
    )
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then it exits 0 with the plural "lock entries" wording, not the singular "lock entry"
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Lockfile coverage gate passed: 2 enabled remote plugin(s) match 2 lock entries.\n')
  })

  it('coverage mode exits 1 with the error on stderr when the lock is tampered', async () => {
    // #given a config requiring a plugin that the lock omits (tampered/incomplete lock)
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then it exits 1 and reports the error on stderr
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('github:quartz-community/plugin-a')
  })

  it('coverage mode joins multiple failure lines with real newlines and leaves stdout empty', async () => {
    // #given two enabled remote plugins, both absent from the lock (tampered/incomplete lock)
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n  - enabled: true\n    source: github:quartz-community/plugin-b\n',
      'utf8',
    )
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')
    await symlinkRepoYamlInto(dir)

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], dir)

    // #then stdout stays empty and stderr is the exact heading plus both errors joined by real newlines
    // #(not concatenated together)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Lockfile coverage gate failed:\n' +
        '  - missing lock entry for enabled remote plugin: github:quartz-community/plugin-a\n' +
        '  - missing lock entry for enabled remote plugin: github:quartz-community/plugin-b\n',
    )
  })

  it('integrity mode exits 0 when all plugin HEADs match the lock', async () => {
    // #given a lock and a matching .quartz/plugins/<name>/.git/HEAD fixture
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'}}}),
      'utf8',
    )
    const headDir = join(dir, '.quartz', 'plugins', 'plugin-a', '.git')
    await mkdir(headDir, {recursive: true})
    await writeFile(join(headDir, 'HEAD'), 'sha-a\n', 'utf8')

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then it exits 0 with a summary and stderr stays empty
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('passed')
    expect(result.stderr).toBe('')
  })

  it('integrity mode treats a lockfile with no "plugins" key as zero plugins, without throwing', async () => {
    // #given a lock file that omits the "plugins" key entirely (not even an empty object)
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({}), 'utf8')

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then it exits 0 reporting zero plugins verified, not a thrown error
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Lockfile integrity gate passed: 0 plugin(s) verified against .git/HEAD.\n')
    expect(result.stderr).toBe('')
  })

  it('integrity mode exits 1 with the error on stderr when a plugin dir is missing', async () => {
    // #given a lock entry with no corresponding .quartz/plugins directory
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'}}}),
      'utf8',
    )

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then it exits 1 and reports the missing plugin on stderr, naming it "missing" (not "does not
    // #match", the message used for a HEAD/commit mismatch) -- proves the readHead directory-absent
    // #path is distinguished from the value-mismatch path
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('plugin-a')
    expect(result.stderr.toLowerCase()).toContain('missing')
    expect(result.stderr.toLowerCase()).not.toContain('does not match')
  })

  it('integrity mode joins multiple failure lines with real newlines and leaves stdout empty', async () => {
    // #given two lock entries, neither with a corresponding .quartz/plugins directory
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({
        plugins: {
          'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'},
          'plugin-b': {source: 'github:quartz-community/plugin-b', commit: 'sha-b'},
        },
      }),
      'utf8',
    )

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], dir)

    // #then stdout stays empty and stderr is the exact heading plus both errors joined by real newlines
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Lockfile integrity gate failed:\n' +
        '  - missing plugin directory/.git/HEAD for "plugin-a"\n' +
        '  - missing plugin directory/.git/HEAD for "plugin-b"\n',
    )
  })

  it('exits 2 with a clear message for an unknown mode', async () => {
    // #when running the CLI with a mode that isn't "coverage" or "integrity"
    const result = await runCli(['bogus-mode'], dir)

    // #then it exits 2 naming the unknown mode, with stdout left empty
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('unknown mode "bogus-mode"')
  })

  it('exits 2 with the mode rendered as an empty string when no mode argument is given', async () => {
    // #when running the CLI with no argv at all (argv[0] is undefined)
    const result = await runCli([], dir)

    // #then it exits 2, stdout stays empty, and the unknown mode renders as "" rather than "undefined"
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('wiki-lockfile-gates: unknown mode "" (expected "coverage" or "integrity")\n')
  })
})

// ---------------------------------------------------------------------------
// runCli coverage mode — yaml resolution topology (the P0 this gate exists to catch)
// ---------------------------------------------------------------------------
//
// The publish-wiki build job's coverage step runs with cwd=quartz-build/ and
// NEVER runs `pnpm bootstrap` at the repo root — only `npm ci` inside
// quartz-build/. So repo-root node_modules does not exist in that job, and a
// bare `import('yaml')` resolved from this script's own directory (scripts/)
// would walk up to repo root and fail every time. These tests prove
// `runCli` resolves `yaml` from the WORKING DIRECTORY instead, by building a
// CI-shaped fixture tree that lives outside the repo (a fake
// quartz-build/node_modules/yaml, and — separately — no yaml at all).
describe('runCli coverage mode — yaml resolution topology', () => {
  let ciDir: string

  beforeEach(async () => {
    ciDir = await mkdtemp(join(tmpdir(), 'wiki-lockfile-gates-ci-topology-'))
  })

  afterEach(async () => {
    await rm(ciDir, {recursive: true, force: true})
  })

  it('resolves yaml from cwd/node_modules (not the script location) and exits 0', async () => {
    // #given a CI-shaped quartz-build/ dir with its OWN node_modules/yaml (Quartz's dependency,
    // not a repo-root one) plus a config with no plugins and a matching empty lock
    const quartzBuild = join(ciDir, 'quartz-build')
    await mkdir(quartzBuild, {recursive: true})
    await writeFile(join(quartzBuild, 'quartz.config.yaml'), 'plugins: []\n', 'utf8')
    await writeFile(join(quartzBuild, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')

    const fakeYamlDir = join(quartzBuild, 'node_modules', 'yaml')
    await mkdir(fakeYamlDir, {recursive: true})
    await writeFile(
      join(fakeYamlDir, 'package.json'),
      JSON.stringify({name: 'yaml', version: '0.0.0', main: 'index.js'}),
      'utf8',
    )
    // The fake only needs to prove RESOLUTION (found in quartz-build/node_modules,
    // not repo-root), not parsing fidelity — so it returns a hardcoded empty-plugins
    // config regardless of input, matching the empty-lock fixture above.
    await writeFile(
      join(fakeYamlDir, 'index.js'),
      'exports.parse = function parse() { return {plugins: []} }\n',
      'utf8',
    )

    // #when running the coverage CLI mode with cwd=quartz-build (the CI topology)
    const result = await runCli(['coverage'], quartzBuild)

    // #then it resolves the fake yaml from quartz-build/node_modules and passes
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('passed')
  })

  it('exits 2 with a clear resolution error when yaml is unreachable from cwd', async () => {
    // #given a CI-shaped quartz-build/ dir with NO node_modules/yaml at all, outside
    // the repo tree (so the createRequire-from-cwd walk-up never reaches this repo's
    // node_modules — proving the negative path is real, not an artifact of running
    // the test process from inside the repo)
    const quartzBuild = join(ciDir, 'quartz-build')
    await mkdir(quartzBuild, {recursive: true})
    await writeFile(join(quartzBuild, 'quartz.config.yaml'), 'plugins: []\n', 'utf8')
    await writeFile(join(quartzBuild, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], quartzBuild)

    // #then it exits 2 with a message naming the resolution root, not a hard crash, and stdout is empty
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('yaml')
    expect(result.stderr).toContain(quartzBuild)
  })
})

// ---------------------------------------------------------------------------
// main() — CLI self-invoke guard (import.meta.url === file://<argv[1]>)
// ---------------------------------------------------------------------------

// Every runCli-level test above imports the module without ever setting process.argv[1] to its own
// path, so the `false` branch of every mutator variant on the guard/main() wiring is trivially
// exercised already -- that alone does not kill the mutants on `main()`'s body or the guard condition
// itself. Cache-busts the dynamic import (unique query string) so the module's top-level code
// re-executes with the manipulated argv/cwd, rather than returning the already-cached module instance.
describe('main() CLI self-invoke guard', () => {
  it("does NOT invoke main() when process.argv[1] does not match the module's own path (positive control)", async () => {
    const modulePath = new URL('./wiki-lockfile-gates.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', '/some/unrelated/entrypoint.js']
    try {
      await import(`${modulePath.href}?guard-test-noop`)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
    }
  })

  it('invokes main() and writes the coverage-mode success message to stdout without calling process.exit', async () => {
    const modulePath = new URL('./wiki-lockfile-gates.ts', import.meta.url)
    const originalArgv = [...process.argv]
    const dir = await mkdtemp(join(tmpdir(), 'wiki-lockfile-gates-main-'))

    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}}}),
      'utf8',
    )
    await symlinkRepoYamlInto(dir)

    const stdoutOutput: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
      stdoutOutput.push(String(msg))
      return true
    })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    // `process.chdir()` is unsupported inside vitest's worker threads -- stub `process.cwd()` instead,
    // which is the only thing main() actually reads (`runCli(process.argv.slice(2), process.cwd())`).
    vi.spyOn(process, 'cwd').mockReturnValue(dir)

    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname, 'coverage']
    try {
      await import(`${modulePath.href}?guard-test-main-coverage-ok`)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stdoutOutput.join('')).toBe(
        'Lockfile coverage gate passed: 1 enabled remote plugin(s) match 1 lock entry.\n',
      )
      expect(stderrSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
      await rm(dir, {recursive: true, force: true})
    }
  })

  it('invokes main() and exits with the unknown-mode message on stderr for a nonzero exit code', async () => {
    const modulePath = new URL('./wiki-lockfile-gates.ts', import.meta.url)
    const originalArgv = [...process.argv]

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrOutput: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      stderrOutput.push(String(msg))
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    process.argv = [originalArgv[0] ?? 'node', modulePath.pathname, 'totally-bogus']
    try {
      await expect(import(`${modulePath.href}?guard-test-main-bogus-mode`)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(2)
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrOutput.join('')).toBe(
        'wiki-lockfile-gates: unknown mode "totally-bogus" (expected "coverage" or "integrity")\n',
      )
    } finally {
      exitSpy.mockRestore()
      vi.restoreAllMocks()
      process.argv = originalArgv
    }
  })
})
