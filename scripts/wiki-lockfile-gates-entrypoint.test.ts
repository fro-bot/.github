/**
 * Surface tier for `scripts/wiki-lockfile-gates.ts`: the shim runs in a child process the way
 * `publish-wiki.yaml` runs it (`bun --no-install --no-env-file <path> coverage|integrity`, cwd
 * `quartz-build`, with `yaml` resolvable only from that cwd). The gate logic and its in-process tests live
 * in `wiki-lockfile-gates-core.ts` and `wiki-lockfile-gates.test.ts`; this file pins the entry guard, which
 * is the one thing the shim adds and the one thing a mutation run does not cover.
 *
 * This file is not in Stryker's `testFiles`: the shim is registered `not-mutated`, and a spawned process is
 * not in-process coverage.
 */

import {copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {basename, dirname, join, resolve} from 'node:path'
import {spawnEntrypoint, type Runtime, type SpawnEntrypointResult} from '@fro-bot/test-kit/spawn-entrypoint'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = resolve(import.meta.dirname, '..')
const shim = join(repoRoot, 'scripts', 'wiki-lockfile-gates.ts')
const coreModule = join(repoRoot, 'scripts', 'wiki-lockfile-gates-core.ts')
const yamlPackageDirectory = dirname(require.resolve('yaml/package.json'))

// The flags `publish-wiki.yaml` passes.
const BUN_FLAGS = ['--no-install', '--no-env-file'] as const

const CONFIG = 'plugins:\n  - enabled: true\n    source: github:quartz-community/plugin-a\n'
const LOCK = JSON.stringify({plugins: {'plugin-a': {source: 'github:quartz-community/plugin-a', commit: 'abc123'}}})

let root = ''
let counter = 0

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wiki-lockfile-gates-entrypoint-'))
})

afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})

function scratch(name: string): string {
  counter += 1
  const directory = join(root, `${name}-${String(counter)}`)
  mkdirSync(directory, {recursive: true})
  return directory
}

interface FixtureOptions {
  readonly config?: string
  readonly lock?: string
  readonly head?: string
  readonly yaml?: boolean
}

/** A `quartz-build`-shaped cwd: config, lockfile, a plugin checkout and a cwd-local `yaml`. */
function quartzBuild(name: string, options: FixtureOptions = {}): string {
  const directory = scratch(name)
  if (options.config !== undefined) writeFileSync(join(directory, 'quartz.config.yaml'), options.config)
  if (options.lock !== undefined) writeFileSync(join(directory, 'quartz.lock.json'), options.lock)
  if (options.head !== undefined) {
    const git = join(directory, '.quartz', 'plugins', 'plugin-a', '.git')
    mkdirSync(git, {recursive: true})
    writeFileSync(join(git, 'HEAD'), `${options.head}\n`)
  }
  if (options.yaml !== false) {
    mkdirSync(join(directory, 'node_modules'), {recursive: true})
    symlinkSync(yamlPackageDirectory, join(directory, 'node_modules', 'yaml'), 'dir')
  }
  return directory
}

async function run(
  cwd: string,
  argv: readonly string[],
  entrypoint: string = shim,
  runtime: Runtime = 'bun',
): Promise<SpawnEntrypointResult> {
  return spawnEntrypoint({
    entrypoint,
    runtime,
    runtimeArgs: runtime === 'bun' ? BUN_FLAGS : [],
    argv,
    cwd,
  })
}

const UNKNOWN_MODE = (mode: string): string =>
  `wiki-lockfile-gates: unknown mode "${mode}" (expected "coverage" or "integrity")\n`

describe('scripts/wiki-lockfile-gates.ts run as the workflow runs it', () => {
  it('coverage mode passes from a foreign cwd with a cwd-local yaml', async () => {
    const cwd = quartzBuild('coverage-ok', {config: CONFIG, lock: LOCK})
    const result = await run(cwd, ['coverage'])
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'Lockfile coverage gate passed: 1 enabled remote plugin(s) match 1 lock entry.\n',
      stderr: '',
      githubOutput: '',
    })
  })

  it('integrity mode passes from a foreign cwd', async () => {
    const cwd = quartzBuild('integrity-ok', {lock: LOCK, head: 'abc123', yaml: false})
    const result = await run(cwd, ['integrity'])
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'Lockfile integrity gate passed: 1 plugin(s) verified against .git/HEAD.\n',
      stderr: '',
      githubOutput: '',
    })
  })

  it('ignores argv after the mode', async () => {
    const cwd = quartzBuild('extra-argv', {config: CONFIG, lock: LOCK, head: 'abc123'})
    const coverage = await run(cwd, ['coverage', 'extra'])
    const integrity = await run(cwd, ['integrity', 'extra'])
    expect([coverage.exitCode, integrity.exitCode]).toEqual([0, 0])
    expect(coverage.stdout).toContain('Lockfile coverage gate passed')
    expect(integrity.stdout).toContain('Lockfile integrity gate passed')
  })

  it.each([
    [[], ''],
    [['bogus'], 'bogus'],
    [['bogus', 'extra'], 'bogus'],
    [[''], ''],
    [['COVERAGE'], 'COVERAGE'],
  ] as const)('argv %j exits 2 naming the unknown mode', async (argv, mode) => {
    const cwd = quartzBuild('unknown-mode', {config: CONFIG, lock: LOCK})
    const result = await run(cwd, argv)
    expect(result).toEqual({exitCode: 2, stdout: '', stderr: UNKNOWN_MODE(mode), githubOutput: ''})
  })

  it('a rejected coverage lockfile exits 1 with the failure list on stderr', async () => {
    const cwd = quartzBuild('coverage-rejected', {config: CONFIG, lock: '{"plugins":{}}'})
    const result = await run(cwd, ['coverage'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Lockfile coverage gate failed:\n  - missing lock entry for enabled remote plugin: github:quartz-community/plugin-a\n',
    )
  })

  it('a rejected integrity lockfile exits 1 with the failure list on stderr', async () => {
    const cwd = quartzBuild('integrity-rejected', {lock: LOCK, head: 'deadbeef'})
    const result = await run(cwd, ['integrity'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Lockfile integrity gate failed:\n  - "plugin-a" .git/HEAD ("deadbeef") does not match lockfile commit ("abc123")\n',
    )
  })

  it.each([
    ['coverage', 'a missing lockfile', {config: CONFIG}, 'could not read or parse quartz.lock.json'],
    ['integrity', 'a missing lockfile', {}, 'could not read or parse quartz.lock.json'],
    ['coverage', 'a missing config', {lock: LOCK}, 'could not read or parse quartz.config.yaml'],
    [
      'coverage',
      'a malformed lockfile',
      {config: CONFIG, lock: '{not json'},
      'could not read or parse quartz.lock.json',
    ],
    ['integrity', 'a malformed lockfile', {lock: '{not json'}, 'could not read or parse quartz.lock.json'],
    ['coverage', 'a null lockfile', {config: CONFIG, lock: 'null'}, 'did not parse to an object (got null)'],
    [
      'coverage',
      'a comments-only config',
      {config: '# only a comment\n', lock: LOCK},
      'did not parse to an object (got null)',
    ],
  ] as const satisfies readonly (readonly [string, string, FixtureOptions, string])[])(
    '%s mode with %s exits 2',
    async (mode, _label, fixture, message) => {
      const cwd = quartzBuild('input-error', fixture)
      const result = await run(cwd, [mode])
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(`wiki-lockfile-gates: `)
      expect(result.stderr).toContain(message)
      expect(result.stderr).toContain(basename(cwd))
    },
  )

  it('coverage mode without a cwd-local yaml exits 2 naming the package', async () => {
    const cwd = quartzBuild('no-yaml', {config: CONFIG, lock: LOCK, yaml: false})
    const result = await run(cwd, ['coverage'])
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("could not resolve the 'yaml' package from")
  })
})

describe('a checkout path the URL form escapes still runs the gate', () => {
  // The previous guard compared `import.meta.url` with `file://${process.argv[1]}`, which is false for a
  // path containing a space, `#` or `%`: the shim exited 0 without running. `import.meta.main` has no such
  // gap. The core module is copied beside the shim, because the shim imports it by relative path.
  it.each([['with space'], ['hash#dir'], ['pct%dir']])('runs from a directory named %j', async name => {
    const scripts = join(scratch('escaped'), name)
    mkdirSync(scripts, {recursive: true})
    copyFileSync(shim, join(scripts, 'wiki-lockfile-gates.ts'))
    copyFileSync(coreModule, join(scripts, 'wiki-lockfile-gates-core.ts'))
    const cwd = quartzBuild('escaped-cwd', {config: CONFIG, lock: LOCK})

    const ok = await run(cwd, ['coverage'], join(scripts, 'wiki-lockfile-gates.ts'))
    expect(ok.exitCode).toBe(0)
    expect(ok.stdout).toBe('Lockfile coverage gate passed: 1 enabled remote plugin(s) match 1 lock entry.\n')

    const bad = await run(cwd, ['bogus'], join(scripts, 'wiki-lockfile-gates.ts'))
    expect(bad.exitCode).toBe(2)
    expect(bad.stderr).toBe(UNKNOWN_MODE('bogus'))
  })
})

describe('importing the shim runs nothing', () => {
  // An import from another module (a test, Test Scripts Load) must not read argv, print or set an exit
  // code. The harness passes a mode that would print or fail if the gate ran.
  it.each(['bun', 'node'] as const)('under %s leaves stdout, stderr and the exit code untouched', async runtime => {
    const directory = scratch('import-only')
    const harness = join(directory, 'import-shim.ts')
    writeFileSync(
      harness,
      `import {pathToFileURL} from 'node:url'
await import(pathToFileURL(${JSON.stringify(shim)}).href)
process.stdout.write('imported:' + String(process.exitCode ?? 'unset'))
`,
    )
    const result = await spawnEntrypoint({
      entrypoint: harness,
      runtime,
      argv: ['bogus'],
      cwd: directory,
    })
    expect(result).toEqual({exitCode: 0, stdout: 'imported:unset', stderr: '', githubOutput: ''})
  })
})
