import type {InstallCommand} from './renovate-runtime.ts'

import {spawnSync} from 'node:child_process'
import {mkdirSync, writeFileSync} from 'node:fs'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  assertRegexEngineIsRe2,
  assertRenovateInstalled,
  installRenovate,
  loadRenovateRuntime,
  parsePinnedVersion,
  readInstalledVersion,
  resolvePrefix,
} from './renovate-runtime.ts'

const WORKFLOW = (envLine: string) => `name: Main\nenv:\n${envLine}\njobs: {}\n`

describe('parsePinnedVersion', () => {
  it('reads the exact version from the workflow-level env, ignoring the renovate comment', () => {
    expect(
      parsePinnedVersion(WORKFLOW('  RENOVATE_VERSION: 44.165.2 # renovate: datasource=npm depName=renovate')),
    ).toBe('44.165.2')
  })

  it.each([
    ['a range', '  RENOVATE_VERSION: ^44.165.2'],
    ['a tag', '  RENOVATE_VERSION: latest'],
    ['a partial version', '  RENOVATE_VERSION: 44.165'],
    ['a number', '  RENOVATE_VERSION: 44'],
  ])('rejects %s', (_label, line) => {
    expect(() => parsePinnedVersion(WORKFLOW(line))).toThrow(/must be an exact x\.y\.z version/)
  })

  it('rejects a workflow with no env block or no key', () => {
    expect(() => parsePinnedVersion('name: Main\njobs: {}\n')).toThrow(/RENOVATE_VERSION/)
    expect(() => parsePinnedVersion(WORKFLOW('  OTHER: 1.2.3'))).toThrow(/RENOVATE_VERSION/)
  })
})

describe('resolvePrefix', () => {
  it('prefers RENOVATE_PREFIX', () => {
    expect(resolvePrefix('1.2.3', {RENOVATE_PREFIX: '/custom', RUNNER_TEMP: '/runner'})).toBe('/custom')
  })

  it('falls back to a per-version directory under RUNNER_TEMP, then the OS temp dir', () => {
    expect(resolvePrefix('1.2.3', {RUNNER_TEMP: '/runner'})).toBe(join('/runner', 'renovate-1.2.3'))
    expect(resolvePrefix('1.2.3', {})).toBe(join(tmpdir(), 'renovate-1.2.3'))
  })

  it('treats an empty RENOVATE_PREFIX as unset', () => {
    expect(resolvePrefix('1.2.3', {RENOVATE_PREFIX: '', RUNNER_TEMP: '/runner'})).toBe(
      join('/runner', 'renovate-1.2.3'),
    )
  })
})

describe('installed version checks', () => {
  let prefix: string

  async function fakeInstall(version: string): Promise<void> {
    const directory = join(prefix, 'node_modules', 'renovate')
    await mkdir(directory, {recursive: true})
    await writeFile(join(directory, 'package.json'), JSON.stringify({name: 'renovate', version}))
  }

  beforeEach(async () => {
    prefix = await mkdtemp(join(tmpdir(), 'renovate-runtime-test-'))
  })

  afterEach(async () => {
    await rm(prefix, {recursive: true, force: true})
  })

  it('reads the installed version, or undefined when nothing is installed', async () => {
    expect(await readInstalledVersion(prefix)).toBeUndefined()
    await fakeInstall('1.2.3')
    expect(await readInstalledVersion(prefix)).toBe('1.2.3')
  })

  it('fails loudly when the prefix has no install', async () => {
    await expect(assertRenovateInstalled(join(prefix, 'missing'), '1.2.3')).rejects.toThrow(
      /not installed under RENOVATE_PREFIX=/,
    )
    await expect(loadRenovateRuntime(prefix, '1.2.3')).rejects.toThrow(/not installed/)
  })

  it('fails loudly when the installed version differs from the pin', async () => {
    await fakeInstall('1.2.4')

    await expect(assertRenovateInstalled(prefix, '1.2.3')).rejects.toThrow(/is 1\.2\.4 but .* pins 1\.2\.3/)
    await expect(loadRenovateRuntime(prefix, '1.2.3')).rejects.toThrow(/pins 1\.2\.3/)
  })

  it('returns the package directory when the version matches', async () => {
    await fakeInstall('1.2.3')

    expect(await assertRenovateInstalled(prefix, '1.2.3')).toBe(join(prefix, 'node_modules', 'renovate'))
  })

  it('runs nothing when the pinned version is installed and RE2 already works', async () => {
    await fakeInstall('1.2.3')
    const commands: InstallCommand[] = []

    const outcome = await installRenovate(
      prefix,
      '1.2.3',
      command => {
        commands.push(command)
        return {status: 0}
      },
      () => true,
    )

    expect(outcome).toBe('already-installed')
    expect(commands).toEqual([])
  })

  it('builds only re2 when a reused install has no working RE2', async () => {
    await fakeInstall('1.2.3')
    const commands: InstallCommand[] = []
    let built = false

    const outcome = await installRenovate(
      prefix,
      '1.2.3',
      command => {
        commands.push(command)
        built = true
        return {status: 0}
      },
      () => built,
    )

    expect(outcome).toBe('already-installed')
    expect(commands).toEqual([
      {
        command: 'npm',
        args: ['run', 'install', '--no-audit', '--no-fund'],
        cwd: join(prefix, 'node_modules', 're2'),
      },
    ])
  })

  it('installs the exact version with scripts off, then builds only re2', async () => {
    const commands: InstallCommand[] = []
    let built = false

    const outcome = await installRenovate(
      prefix,
      '1.2.3',
      command => {
        commands.push(command)
        if (command.args[0] === 'install') {
          // Stand-in for npm: leave behind what a successful install would.
          const directory = join(prefix, 'node_modules', 'renovate')
          mkdirSync(directory, {recursive: true})
          writeFileSync(join(directory, 'package.json'), JSON.stringify({version: '1.2.3'}))
        } else {
          built = true
        }
        return {status: 0}
      },
      () => built,
    )

    expect(outcome).toBe('installed')
    expect(commands).toHaveLength(2)
    const [install, rebuild] = commands
    expect(install?.command).toBe('npm')
    // cwd is the scratch prefix, so npm can never see the repository's package.json.
    expect(install?.cwd).toBe(prefix)
    expect(install?.args).toEqual([
      'install',
      '--prefix',
      prefix,
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      'renovate@1.2.3',
    ])
    // The build is `npm run install` inside re2 alone: no `--ignore-scripts`, no other package.
    expect(rebuild).toEqual({
      command: 'npm',
      args: ['run', 'install', '--no-audit', '--no-fund'],
      cwd: join(prefix, 'node_modules', 're2'),
    })
  })

  it('fails when the re2 build exits non-zero or cannot start', async () => {
    await fakeInstall('1.2.3')

    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: 1}),
        () => false,
      ),
    ).rejects.toThrow(/npm run install \(re2\) exited 1/)
    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: null, error: new Error('ENOENT npm')}),
        () => false,
      ),
    ).rejects.toThrow(/npm run install \(re2\) failed to start: ENOENT npm/)
  })

  it('fails when the re2 build exits 0 but RE2 still does not load', async () => {
    await fakeInstall('1.2.3')

    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: 0}),
        () => false,
      ),
    ).rejects.toThrow(/RE2 is still not usable/)
  })

  it('fails when npm exits non-zero, and when it cannot start', async () => {
    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: 1}),
        () => true,
      ),
    ).rejects.toThrow(/exited 1/)
    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: null, error: new Error('ENOENT npm')}),
        () => true,
      ),
    ).rejects.toThrow(/failed to start: ENOENT npm/)
  })

  it('fails when npm exits 0 but the pinned version is not what landed', async () => {
    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: 0}),
        () => true,
      ),
    ).rejects.toThrow(/not installed/)

    await mkdir(join(prefix, 'node_modules', 'renovate'), {recursive: true})
    await writeFile(join(prefix, 'node_modules', 'renovate', 'package.json'), JSON.stringify({version: '9.9.9'}))
    await expect(
      installRenovate(
        prefix,
        '1.2.3',
        () => ({status: 0}),
        () => true,
      ),
    ).rejects.toThrow(/is 9\.9\.9 but .* pins 1\.2\.3/)
  })
})

describe('assertRegexEngineIsRe2', () => {
  it('accepts only an available RE2 engine', () => {
    expect(() => {
      assertRegexEngineIsRe2({regexEngineStatus: {type: 'available'}}, '/p')
    }).not.toThrow()
  })

  it.each([
    ['unavailable', {type: 'unavailable', err: new Error('Cannot find module re2.node')}, /unavailable.*re2\.node/],
    ['ignored', {type: 'ignored'}, /"ignored"/],
    ['missing', undefined, /undefined/],
  ])('fails closed when the engine status is %s', (_label, status, message) => {
    expect(() => {
      assertRegexEngineIsRe2({regexEngineStatus: status}, '/p')
    }).toThrow(message)
  })

  it('fails closed when the regex module has no status export at all', () => {
    expect(() => {
      assertRegexEngineIsRe2({}, '/p')
    }).toThrow(/not using the RE2 regex engine/)
  })
})

// Needs the pinned install in RENOVATE_PREFIX (the `Check Workflows` job and `pnpm check:renovate-config`
// provide it); skipped by a plain `pnpm test`.
describe.skipIf(process.env.RENOVATE_PREFIX === undefined)('against the pinned Renovate install', () => {
  const runtimeModule = fileURLToPath(new URL('renovate-runtime.ts', import.meta.url))

  // Fresh process per case: Renovate picks its regex engine once, at module load.
  function loadInFreshProcess(env: NodeJS.ProcessEnv) {
    const script = String.raw`
      import {loadRenovateRuntime, readPinnedVersion, resolvePrefix} from ${JSON.stringify(runtimeModule)}
      const version = await readPinnedVersion(process.cwd())
      const runtime = await loadRenovateRuntime(resolvePrefix(version), version)
      process.stdout.write(JSON.stringify({
        lookaheadIsPredicate: runtime.versioning.hasRegexPredicate('/^(?!2)/'),
        unanchoredIsPredicate: runtime.versioning.hasRegexPredicate('/^1\./'),
      }))
    `
    return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {...process.env, ...env},
    })
  }

  it('loads with a working RE2, which rejects the lookahead JavaScript accepts', () => {
    const result = loadInFreshProcess({})

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({lookaheadIsPredicate: false, unanchoredIsPredicate: true})
  }, 60_000)

  it('refuses to load when RE2 is not the active regex engine', () => {
    const result = loadInFreshProcess({RENOVATE_X_IGNORE_RE2: 'true'})

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('not using the RE2 regex engine')
  }, 60_000)
})
