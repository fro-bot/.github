import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  checkLockfileCoverage,
  checkLockfileIntegrity,
  runCli,
  type LockFile,
  type QuartzConfig,
} from './wiki-lockfile-gates.ts'

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

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], {}, dir)

    // #then it exits 0 with a summary
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('passed')
  })

  it('coverage mode exits 1 with the error on stderr when the lock is tampered', async () => {
    // #given a config requiring a plugin that the lock omits (tampered/incomplete lock)
    await writeFile(
      join(dir, 'quartz.config.yaml'),
      'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n',
      'utf8',
    )
    await writeFile(join(dir, 'quartz.lock.json'), JSON.stringify({plugins: {}}), 'utf8')

    // #when running the coverage CLI mode
    const result = await runCli(['coverage'], {}, dir)

    // #then it exits 1 and reports the error on stderr
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('github:quartz-community/plugin-a')
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
    const result = await runCli(['integrity'], {}, dir)

    // #then it exits 0 with a summary
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('passed')
  })

  it('integrity mode exits 1 with the error on stderr when a plugin dir is missing', async () => {
    // #given a lock entry with no corresponding .quartz/plugins directory
    await writeFile(
      join(dir, 'quartz.lock.json'),
      JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'sha-a'}}}),
      'utf8',
    )

    // #when running the integrity CLI mode
    const result = await runCli(['integrity'], {}, dir)

    // #then it exits 1 and reports the missing plugin on stderr
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('plugin-a')
  })
})
