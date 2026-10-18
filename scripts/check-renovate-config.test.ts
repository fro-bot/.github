import type {MockInstance} from 'vitest'
import type {FetchText, PinnedPreset, RunValidator} from './check-renovate-config.ts'
import type {VersioningEngine} from './check-renovate-ranges.ts'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'
import {pathToFileURL} from 'node:url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  checkRenovateConfig,
  classifyExtends,
  fetchPinnedPreset,
  rawUrl,
  runRenovateValidator,
} from './check-renovate-config.ts'
import {loadRenovateRuntime, readPinnedVersion, resolvePrefix} from './renovate-runtime.ts'

const PINNED = 'github>bfra-me/renovate-config:fro-bot.json5#5.1.0'

function preset(overrides: Partial<PinnedPreset> = {}): PinnedPreset {
  return {
    spec: PINNED,
    owner: 'bfra-me',
    repo: 'renovate-config',
    ref: '5.1.0',
    candidates: ['fro-bot.json5'],
    ...overrides,
  }
}

describe('classifyExtends', () => {
  it('pins github presets that carry a ref and resolves the file Renovate would read', () => {
    const result = classifyExtends([
      {
        extends: [
          'github>bfra-me/renovate-config#5.1.0',
          PINNED,
          'github>acme/cfg:security#v2',
          'github>acme/cfg:rules.json#v2',
        ],
      },
    ])

    expect(result.pinned.map(found => [found.spec, found.ref, found.candidates])).toEqual([
      ['github>bfra-me/renovate-config#5.1.0', '5.1.0', ['default.json', 'renovate.json']],
      [PINNED, '5.1.0', ['fro-bot.json5']],
      ['github>acme/cfg:security#v2', 'v2', ['security.json']],
      ['github>acme/cfg:rules.json#v2', 'v2', ['rules.json']],
    ])
    expect(result.floating).toEqual([])
    expect(result.unsupported).toEqual([])
  })

  it.each([
    ['github>acme/cfg#v1', ['default.json', 'renovate.json']],
    ['github>acme/cfg:default#v1', ['default.json', 'renovate.json']],
    ['github>acme/cfg:default.json5#v1', ['default.json5']],
    ['github>acme/cfg:rules#v1', ['rules.json']],
    ['github>acme/cfg:rules.json5#v1', ['rules.json5']],
    ['github>acme/cfg:rules.jsonc#v1', ['rules.jsonc']],
    ['github>acme/cfg:rules.yaml#v1', ['rules.yaml.json']],
  ])('resolves %s to the files Renovate reads, in order', (spec, candidates) => {
    expect(classifyExtends([{extends: [spec]}]).pinned.map(found => found.candidates)).toEqual([candidates])
  })

  it('reports floating presets instead of fetching a moving target', () => {
    const result = classifyExtends([{extends: ['github>sanity-io/renovate-config:security']}])

    expect(result.pinned).toEqual([])
    expect(result.floating).toEqual(['github>sanity-io/renovate-config:security'])
  })

  it('ignores local and built-in presets, and tolerates configs with no extends', () => {
    const result = classifyExtends([
      {extends: ['local>fro-bot/.github', ':assignAndReview(fro-bot)', 'config:recommended']},
      {},
      null,
      'string',
      {extends: 'github>acme/cfg#v1'},
    ])

    expect(result).toEqual({pinned: [], floating: [], unsupported: []})
  })

  it('fails closed on a github preset shape it cannot resolve', () => {
    const result = classifyExtends([{extends: ['github>acme/cfg//nested/path#v1', 'github>no-repo']}])

    expect(result.unsupported).toEqual(['github>acme/cfg//nested/path#v1', 'github>no-repo'])
  })

  it.each([
    'github>acme/cfg:rules/sub#v1',
    'github>acme/cfg:default/sub#v1',
    'github>acme/cfg:rules.json/sub#v1',
    'github>acme/cfg:rules/sub',
  ])('fails closed on the sub-preset selector in %s', spec => {
    const result = classifyExtends([{extends: [spec]}])

    expect(result).toEqual({pinned: [], floating: [], unsupported: [spec]})
  })

  it('de-duplicates a preset extended by more than one config', () => {
    const result = classifyExtends([{extends: [PINNED]}, {extends: [PINNED]}])

    expect(result.pinned).toHaveLength(1)
  })
})

describe('rawUrl', () => {
  it('builds an unauthenticated raw URL at the exact ref', () => {
    expect(rawUrl(preset(), 'fro-bot.json5')).toBe(
      'https://raw.githubusercontent.com/bfra-me/renovate-config/5.1.0/fro-bot.json5',
    )
  })

  it('keeps slashes in a branch-style ref and encodes everything else', () => {
    expect(rawUrl(preset({ref: 'feat/a b'}), 'x.json')).toBe(
      'https://raw.githubusercontent.com/bfra-me/renovate-config/feat/a%20b/x.json',
    )
  })
})

describe('fetchPinnedPreset', () => {
  it('falls through to the next candidate on 404', async () => {
    const calls: string[] = []
    const fetchText: FetchText = async url => {
      calls.push(url)
      return url.endsWith('/default.json') ? {status: 404, text: ''} : {status: 200, text: '{}'}
    }

    const fetched = await fetchPinnedPreset(preset({candidates: ['default.json', 'renovate.json']}), fetchText)

    expect(fetched.file).toBe('renovate.json')
    expect(calls).toHaveLength(2)
  })

  it('reads renovate.json for a default preset that has no default.json, never default.json5', async () => {
    const defaultPreset = classifyExtends([{extends: ['github>acme/cfg#v1']}]).pinned[0]
    if (defaultPreset === undefined) throw new Error('expected a pinned preset')
    const repository = (files: Record<string, string>): FetchText => {
      return async url => {
        const text = files[url.split('/').pop() ?? '']
        return text === undefined ? {status: 404, text: ''} : {status: 200, text}
      }
    }

    const fromRenovateJson = await fetchPinnedPreset(
      defaultPreset,
      repository({'renovate.json': '{"from":"renovate.json"}', 'default.json5': '{"from":"default.json5"}'}),
    )
    const fromDefaultJson = await fetchPinnedPreset(
      defaultPreset,
      repository({'default.json': '{"from":"default.json"}', 'renovate.json': '{"from":"renovate.json"}'}),
    )

    expect(fromRenovateJson.file).toBe('renovate.json')
    expect(fromDefaultJson.file).toBe('default.json')
    await expect(fetchPinnedPreset(defaultPreset, repository({'default.json5': '{}'}))).rejects.toThrow(
      /none of default\.json, renovate\.json exist/,
    )
  })

  it('does not guess a .json5 file for an extensionless named preset', async () => {
    const named = classifyExtends([{extends: ['github>acme/cfg:security#v1']}]).pinned[0]
    if (named === undefined) throw new Error('expected a pinned preset')

    await expect(
      fetchPinnedPreset(named, async url =>
        url.endsWith('/security.json5') ? {status: 200, text: '{}'} : {status: 404, text: ''},
      ),
    ).rejects.toThrow(/none of security\.json exist/)
  })

  it('retries transient failures and then succeeds', async () => {
    let attempts = 0
    const fetchText: FetchText = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('socket hang up')
      if (attempts === 2) return {status: 503, text: ''}
      return {status: 200, text: '{}'}
    }

    const fetched = await fetchPinnedPreset(preset(), fetchText)

    expect(fetched.text).toBe('{}')
    expect(attempts).toBe(3)
  })

  it('fails (never skips) when the network keeps failing', async () => {
    const fetchText: FetchText = async () => {
      throw new Error('offline')
    }

    await expect(fetchPinnedPreset(preset(), fetchText)).rejects.toThrow(/offline after 3 attempts/)
  })

  it('fails when no candidate exists at the ref', async () => {
    const fetchText: FetchText = async () => ({status: 404, text: ''})

    await expect(fetchPinnedPreset(preset(), fetchText)).rejects.toThrow(/none of fro-bot\.json5 exist at ref 5\.1\.0/)
  })
})

// Unit tests inject JSON.parse and a stub engine: no network and no Renovate install needed.
const harness = {
  parseConfig: (text: string): unknown => JSON.parse(text),
  engine: {
    isKnownVersioning: () => true,
    hasRegexPredicate: () => false,
    isValid: (_spec: string, value: string) => !value.includes('(('),
    isValidSemverRange: () => false,
  } satisfies VersioningEngine,
}

describe('checkRenovateConfig', () => {
  let rootDir: string
  let stdout: MockInstance<typeof process.stdout.write>

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'check-renovate-config-test-'))
    await mkdir(join(rootDir, '.github'))
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(rootDir, {recursive: true, force: true})
  })

  async function writeConfigs(defaultJson: unknown, consumer = '{"extends": ["local>fro-bot/.github"]}') {
    await writeFile(join(rootDir, 'default.json'), JSON.stringify(defaultJson))
    await writeFile(join(rootDir, '.github', 'renovate.json5'), consumer)
  }

  const okValidator: RunValidator = () => ({exitCode: 0, output: ''})
  const okFetch: FetchText = async () => ({status: 200, text: '{"packageRules": [{"allowedVersions": "<2"}]}'})

  it('passes and hands the validator the local configs plus the fetched pinned preset', async () => {
    await writeConfigs({extends: [PINNED, 'github>sanity-io/renovate-config:security']})
    const seen: string[][] = []

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      fetchText: okFetch,
      runValidator: files => {
        seen.push([...files])
        return {exitCode: 0, output: ''}
      },
    })

    expect(result.ok).toBe(true)
    expect(result.floating).toEqual(['github>sanity-io/renovate-config:security'])
    const [files] = seen
    expect(files).toHaveLength(3)
    expect(files?.slice(0, 2)).toEqual([join(rootDir, 'default.json'), join(rootDir, '.github', 'renovate.json5')])
    expect(files?.[2]).toMatch(/fro-bot\.json5$/)
  })

  it('lists a floating ref inside a fetched preset as not validated', async () => {
    await writeConfigs({extends: [PINNED]})
    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: okValidator,
      fetchText: async () => ({
        status: 200,
        text: '{"extends": ["github>bfra-me/renovate-config:default.json5", "local>fro-bot/.github"]}',
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.floating).toEqual(['github>bfra-me/renovate-config:default.json5'])
    expect(stdout).toHaveBeenCalledWith(
      'check-renovate-config: not validated (no #ref, floating): github>bfra-me/renovate-config:default.json5\n',
    )
  })

  it('fetches and validates a pinned preset reached through another preset, once', async () => {
    const nested = 'github>acme/cfg:rules#v1'
    await writeConfigs({extends: [PINNED]})
    const urls: string[] = []
    const seen: string[][] = []

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: files => {
        seen.push([...files])
        return {exitCode: 0, output: ''}
      },
      fetchText: async url => {
        urls.push(url)
        if (url.endsWith('/fro-bot.json5')) return {status: 200, text: `{"extends": ["${nested}"]}`}
        if (url.endsWith('/rules.json')) return {status: 200, text: '{"extends": ["github>acme/cfg:rules#v1"]}'}
        return {status: 404, text: ''}
      },
    })

    expect(result.ok).toBe(true)
    expect(urls).toEqual([
      'https://raw.githubusercontent.com/bfra-me/renovate-config/5.1.0/fro-bot.json5',
      'https://raw.githubusercontent.com/acme/cfg/v1/rules.json',
    ])
    expect(seen[0]).toHaveLength(4)
  })

  it('fails closed on an unresolvable github ref inside a fetched preset', async () => {
    await writeConfigs({extends: [PINNED]})

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: okValidator,
      fetchText: async () => ({status: 200, text: '{"extends": ["github>acme/cfg//nested#v1"]}'}),
    })

    expect(result).toMatchObject({ok: false, unsupported: ['github>acme/cfg//nested#v1']})
  })

  it('fails closed on a sub-preset selector inside a fetched preset', async () => {
    await writeConfigs({extends: [PINNED]})

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: okValidator,
      fetchText: async () => ({status: 200, text: '{"extends": ["github>acme/cfg:rules/sub#v1"]}'}),
    })

    expect(result).toMatchObject({ok: false, unsupported: ['github>acme/cfg:rules/sub#v1']})
  })

  it('fails when the validator exits non-zero', async () => {
    await writeConfigs({packageRules: []})

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: () => ({exitCode: 1, output: 'WARN: Config migration necessary\n'}),
    })

    expect(result).toMatchObject({ok: false, validatorOk: false, rangesOk: true})
  })

  it('fails on a malformed allowedVersions even though the validator passes', async () => {
    await writeConfigs({packageRules: [{matchPackageNames: ['python'], allowedVersions: '<=3.13 || not-a-range(('}]})

    const result = await checkRenovateConfig({...harness, rootDir, runValidator: okValidator})

    expect(result).toMatchObject({ok: false, validatorOk: true, rangesOk: false})
  })

  it('validates ranges inside the fetched preset too', async () => {
    await writeConfigs({extends: [PINNED]})

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: okValidator,
      fetchText: async () => ({status: 200, text: '{"packageRules": [{"allowedVersions": "nope(("}]}'}),
    })

    expect(result).toMatchObject({ok: false, rangesOk: false})
  })

  it('fails when a pinned preset cannot be fetched', async () => {
    await writeConfigs({extends: [PINNED]})

    const result = await checkRenovateConfig({
      ...harness,
      rootDir,
      runValidator: okValidator,
      fetchText: async () => ({status: 404, text: ''}),
    })

    expect(result.ok).toBe(false)
    expect(result.fetchFailures).toHaveLength(1)
  })

  it('fails closed on an unsupported github preset shape', async () => {
    await writeConfigs({extends: ['github>acme/cfg//nested#v1']})

    const result = await checkRenovateConfig({...harness, rootDir, runValidator: okValidator})

    expect(result).toMatchObject({ok: false, unsupported: ['github>acme/cfg//nested#v1']})
  })

  it('fails when a local config file is missing', async () => {
    await expect(checkRenovateConfig({...harness, rootDir, runValidator: okValidator})).rejects.toThrow(/ENOENT/)
  })
})

// Exercises the real validator binary from the pinned install, so the flags (`--strict --no-global`)
// and exit-code contract this gate relies on are pinned by tests. Skipped unless RENOVATE_PREFIX is
// set. `pnpm test` leaves it unset (no network, no install); the `Check Workflows` CI job installs
// the pin, sets RENOVATE_PREFIX and runs these files in a dedicated step.
describe.skipIf(process.env.RENOVATE_PREFIX === undefined)('real validator (pinned Renovate install)', () => {
  let dir: string
  let validatorPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'renovate-validator-test-'))
    const version = await readPinnedVersion(process.cwd())
    validatorPath = (await loadRenovateRuntime(resolvePrefix(version), version)).validatorPath
  })

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  async function validate(config: unknown, extraArgs: readonly string[] = []) {
    const path = join(dir, 'config.json')
    await writeFile(path, JSON.stringify(config))
    return runRenovateValidator(validatorPath, [path], dir, extraArgs)
  }

  it('accepts a valid repo config', async () => {
    const outcome = await validate({packageRules: [{matchPackageNames: ['python'], allowedVersions: '<=3.13'}]})

    expect(outcome.exitCode).toBe(0)
  }, 60_000)

  it('rejects an unknown option name', async () => {
    const outcome = await validate({packageRules: [{matchPackageNames: ['python'], automergeTypo: true}]})

    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.output).toContain('automergeTypo')
  }, 60_000)

  it('rejects a deprecated option that needs migration (--strict)', async () => {
    const outcome = await validate({
      packageRules: [{matchSourceUrlPrefixes: ['https://github.com/fro-bot'], automerge: true}],
    })

    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.output).toContain('Config migration necessary')
  }, 60_000)

  it('exits non-zero on an unknown CLI flag', async () => {
    const outcome = await validate({}, ['--strikt'])

    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.output).toContain("unknown option '--strikt'")
  }, 60_000)

  it('parses JSON5 config text with Renovate parser', async () => {
    const version = await readPinnedVersion(process.cwd())
    const {parseConfig} = await loadRenovateRuntime(resolvePrefix(version), version)

    expect(parseConfig("{ // comment\n a: 'x', b: [1,], }")).toEqual({a: 'x', b: [1]})
  }, 60_000)
})

// The whole gate against the pinned runtime and its real validator, with the network replaced by a
// fixture repository. Pins the preset-file lookup to Renovate's own resolver and the RE2 requirement.
describe.skipIf(process.env.RENOVATE_PREFIX === undefined)('gate end to end (pinned Renovate install)', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'check-renovate-config-e2e-'))
    await mkdir(join(rootDir, '.github'))
    await writeFile(join(rootDir, 'default.json'), JSON.stringify({extends: ['github>acme/cfg#v1']}))
    await writeFile(join(rootDir, '.github', 'renovate.json5'), '{extends: ["local>fro-bot/.github"]}')
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(rootDir, {recursive: true, force: true})
  })

  async function runGate(files: Record<string, string>) {
    const version = await readPinnedVersion(process.cwd())
    const runtime = await loadRenovateRuntime(resolvePrefix(version), version)
    return checkRenovateConfig({
      rootDir,
      parseConfig: runtime.parseConfig,
      engine: runtime.versioning,
      runValidator: (validatorFiles, cwd) => runRenovateValidator(runtime.validatorPath, validatorFiles, cwd),
      fetchText: async url => {
        const text = files[url.split('/').pop() ?? '']
        return text === undefined ? {status: 404, text: ''} : {status: 200, text}
      },
    })
  }

  it('validates renovate.json when the preset has no default.json, and ignores default.json5', async () => {
    const result = await runGate({
      'renovate.json': '{"packageRules": [{"matchPackageNames": ["a"], "allowedVersions": "/^(?!2)/"}]}',
      'default.json5': '{"packageRules": [{"matchPackageNames": ["a"], "allowedVersions": "<2"}]}',
    })

    // With RE2 both the validator and the range check reject the lookahead; renovate.json was the file read.
    expect(result).toMatchObject({ok: false, fetchFailures: [], validatorOk: false, rangesOk: false})
  }, 120_000)

  it('does not resolve a default preset that only exists as default.json5', async () => {
    const result = await runGate({'default.json5': '{"packageRules": [{"allowedVersions": "<2"}]}'})

    expect(result.ok).toBe(false)
    expect(result.fetchFailures).toHaveLength(1)
    expect(result.fetchFailures[0]).toMatch(/none of default\.json, renovate\.json exist/)
  }, 120_000)

  it('fails a sub-preset selector whose key is missing from an otherwise valid file', async () => {
    await writeFile(join(rootDir, 'default.json'), JSON.stringify({extends: ['github>acme/cfg:rules/missing#v1']}))

    const result = await runGate({'rules.json': '{"packageRules": []}'})

    // Renovate throws "preset not found" for this extends; the containing file itself is valid.
    expect(result).toMatchObject({
      ok: false,
      validatorOk: true,
      rangesOk: true,
      fetchFailures: [],
      unsupported: ['github>acme/cfg:rules/missing#v1'],
    })
  }, 120_000)

  it('prefers default.json over renovate.json', async () => {
    const result = await runGate({
      'default.json': '{"packageRules": [{"matchPackageNames": ["a"], "allowedVersions": "<2"}]}',
      'renovate.json': '{"packageRules": [{"matchPackageNames": ["a"], "allowedVersions": "/^(?!2)/"}]}',
    })

    expect(result).toMatchObject({ok: true, rangesOk: true, validatorOk: true})
  }, 120_000)
})

/** The file names Renovate's own `fetchPreset` requests for `spec`, in order, from the pinned install. */
async function renovateRequests(spec: string): Promise<string[]> {
  const version = await readPinnedVersion(process.cwd())
  const dist = join(resolvePrefix(version), 'node_modules', 'renovate', 'dist', 'config', 'presets')
  const {parsePreset} = (await import(pathToFileURL(join(dist, 'parse.js')).href)) as {
    parsePreset: (input: string) => {repo: string; presetName: string; presetPath?: string; tag?: string}
  }
  const {fetchPreset} = (await import(pathToFileURL(join(dist, 'util.js')).href)) as {
    fetchPreset: (options: Record<string, unknown>) => Promise<unknown>
  }
  const parsed = parsePreset(spec)
  const requested: string[] = []
  await fetchPreset({
    repo: parsed.repo,
    filePreset: parsed.presetName,
    presetPath: parsed.presetPath,
    endpoint: 'https://api.github.com/',
    tag: parsed.tag,
    fetch: async (_repo: string, fileName: string) => {
      requested.push(fileName)
      throw new Error('dep not found')
    },
  }).catch(() => undefined)
  return requested
}

// Renovate's own `fetchPreset` decides which file a `github>` preset reads; the gate's candidates must
// be exactly the files it asks for, in order.
describe.skipIf(process.env.RENOVATE_PREFIX === undefined)('preset file lookup (pinned Renovate resolver)', () => {
  it.each([
    'github>acme/cfg#v1',
    'github>acme/cfg:default#v1',
    'github>acme/cfg:default.json5#v1',
    'github>acme/cfg:rules#v1',
    'github>acme/cfg:rules.json#v1',
    'github>acme/cfg:rules.json5#v1',
    'github>acme/cfg:rules.jsonc#v1',
    'github>acme/cfg:rules.yaml#v1',
  ])(
    'asks for the same files as the gate for %s',
    async spec => {
      const [found] = classifyExtends([{extends: [spec]}]).pinned

      expect(found?.candidates).toEqual(await renovateRequests(spec))
    },
    60_000,
  )
})
