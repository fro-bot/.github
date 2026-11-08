import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  evaluateTriggerGate,
  mutationReportPath,
  readStrykerConfig,
  strykerConfigPath,
  type ClassificationResult,
  type StrykerConfigShape,
} from './check-mutation-guards.ts'
import {readMutationShards} from './mutation-shard-lists.ts'
import {
  defaultShardDeps,
  parseShardEnv,
  parseShardManifest,
  runMutationShard,
  shardArtifactName,
  shardManifestFileName,
  shardReportFileName,
  type ShardDeps,
} from './mutation-shard.ts'
import {findRepositoryRoot} from './repository-root.ts'

// Nothing here may start Stryker: `spawnSync` is the one child-process entry point the spawner uses, so it is replaced
// and every other export (the `execFileSync` of the HEAD lookup) stays real. A test that reaches Stryker through it
// fails on the throw instead of starting a nested run from inside a mutated test file.
const {mockSpawnSync} = vi.hoisted(() => ({mockSpawnSync: vi.fn()}))
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: mockSpawnSync,
}))

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const REPORT = '{"files":{},"testFiles":{},"schemaVersion":"2"}'

let root = ''
let counter = 0

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mutation-shard-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
beforeEach(() => {
  mockSpawnSync.mockImplementation(() => {
    throw new Error('Stryker must not be started from a test')
  })
})
afterEach(() => {
  mockSpawnSync.mockReset()
  vi.unstubAllEnvs()
})

function scratch(name: string): string {
  counter += 1
  const directory = join(root, `${name}-${String(counter)}`)
  mkdirSync(directory, {recursive: true})
  return directory
}

const FAKE_CONFIG: StrykerConfigShape = {
  mutate: ['m1.ts', 'm2.ts', 'm3.ts', 'm4.ts', 'm5.ts'],
  testFiles: ['t1.test.ts', 't2.test.ts'],
  reporters: ['json'],
  jsonReportFileName: 'reports/mutation/mutation.json',
}
const FAKE_SHARDS = [['m1.ts', 'm2.ts'], ['m3.ts'], ['m4.ts', 'm5.ts']]

interface Harness {
  readonly deps: ShardDeps
  readonly reportPath: string
  readonly outputDir: string
  readonly spawn: ReturnType<typeof vi.fn<(args: readonly string[]) => void>>
  readonly evaluateGate: ReturnType<
    typeof vi.fn<(config: StrykerConfigShape) => Promise<ClassificationResult | undefined>>
  >
  readonly input: (shard: number) => Record<string, string>
}

function harness(overrides: Partial<ShardDeps> = {}, reportBody: string | null = REPORT): Harness {
  const directory = scratch('harness')
  const reportPath = join(directory, 'reports', 'mutation.json')
  const spawn = vi.fn<(args: readonly string[]) => void>(() => {
    if (reportBody === null) return
    mkdirSync(join(directory, 'reports'), {recursive: true})
    writeFileSync(reportPath, reportBody)
  })
  const evaluateGate = vi.fn<(config: StrykerConfigShape) => Promise<ClassificationResult | undefined>>(
    async () => undefined,
  )
  const deps: ShardDeps = {
    readShards: () => FAKE_SHARDS,
    readConfig: () => FAKE_CONFIG,
    evaluateGate,
    readHead: () => SHA,
    reportPath: () => reportPath,
    spawn,
    ...overrides,
  }
  const outputDir = join(directory, 'out', 'mutation-shard')
  return {
    deps,
    reportPath,
    outputDir,
    spawn,
    evaluateGate,
    input: shard => ({
      MUTATION_SHARD: String(shard),
      MUTATION_SHARD_EVENT_SHA: SHA,
      MUTATION_SHARD_OUTPUT_DIR: outputDir,
    }),
  }
}

const gateResult = (verdict: ClassificationResult['verdict'], reason: string): ClassificationResult => ({
  verdict,
  mutants: [{file: 'trigger-gate', line: 0, col: 0, mutator: 'trigger-gate', status: 'S', reason}],
})

describe('the artifact layout', () => {
  it('names the artifact and its two files', () => {
    expect(shardArtifactName(1)).toBe('mutation-shard-1')
    expect(shardArtifactName(3)).toBe('mutation-shard-3')
    expect(shardManifestFileName()).toBe('manifest.json')
    expect(shardReportFileName()).toBe('mutation.json')
  })
})

describe('parseShardEnv', () => {
  const good = {MUTATION_SHARD: '2', MUTATION_SHARD_EVENT_SHA: SHA, MUTATION_SHARD_OUTPUT_DIR: '/tmp/out'}

  it('reads the shard, the event SHA and the output directory', () => {
    expect(parseShardEnv(good)).toEqual({ok: true, input: {shard: 2, eventSha: SHA, outputDir: '/tmp/out'}})
  })

  it.each([
    ['unset', undefined, 'MUTATION_SHARD must be a positive integer (got unset)'],
    ['empty', '', 'MUTATION_SHARD must be a positive integer (got "")'],
    ['zero', '0', 'MUTATION_SHARD must be a positive integer (got "0")'],
    ['negative', '-1', 'MUTATION_SHARD must be a positive integer (got "-1")'],
    ['fractional', '1.5', 'MUTATION_SHARD must be a positive integer (got "1.5")'],
    ['padded', '01', 'MUTATION_SHARD must be a positive integer (got "01")'],
    ['trailing text', '2x', 'MUTATION_SHARD must be a positive integer (got "2x")'],
    ['leading text', 'x2', 'MUTATION_SHARD must be a positive integer (got "x2")'],
    ['spaced', ' 2', 'MUTATION_SHARD must be a positive integer (got " 2")'],
  ])('rejects a shard id that is %s', (_name, value, message) => {
    expect(parseShardEnv({...good, MUTATION_SHARD: value})).toEqual({ok: false, message})
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['short', 'a'.repeat(39)],
    ['long', 'a'.repeat(41)],
    ['upper case', 'A'.repeat(40)],
    ['not hex', 'g'.repeat(40)],
    ['a branch name', 'refs/heads/main'],
    ['padded', ` ${'a'.repeat(40)}`],
    ['suffixed', `${'a'.repeat(40)}\n`],
  ])('rejects an event SHA that is %s', (_name, value) => {
    const parsed = parseShardEnv({...good, MUTATION_SHARD_EVENT_SHA: value})
    expect(parsed.ok).toBe(false)
    expect(parsed.ok ? '' : parsed.message).toContain(
      'MUTATION_SHARD_EVENT_SHA must be a 40-character lowercase hex commit SHA',
    )
  })

  it('names what it got for a bad event SHA', () => {
    expect(parseShardEnv({...good, MUTATION_SHARD_EVENT_SHA: 'abc'})).toEqual({
      ok: false,
      message: 'MUTATION_SHARD_EVENT_SHA must be a 40-character lowercase hex commit SHA (got "abc")',
    })
    expect(parseShardEnv({...good, MUTATION_SHARD_EVENT_SHA: undefined})).toEqual({
      ok: false,
      message: 'MUTATION_SHARD_EVENT_SHA must be a 40-character lowercase hex commit SHA (got unset)',
    })
  })

  it('rejects an unset or empty output directory', () => {
    expect(parseShardEnv({...good, MUTATION_SHARD_OUTPUT_DIR: undefined})).toEqual({
      ok: false,
      message: 'MUTATION_SHARD_OUTPUT_DIR must be set (got unset)',
    })
    expect(parseShardEnv({...good, MUTATION_SHARD_OUTPUT_DIR: ''})).toEqual({
      ok: false,
      message: 'MUTATION_SHARD_OUTPUT_DIR must be set (got "")',
    })
  })

  it('reports the shard id first, then the SHA, then the directory', () => {
    expect(parseShardEnv({}).ok ? '' : (parseShardEnv({}) as {message: string}).message).toContain(
      'MUTATION_SHARD must',
    )
    expect((parseShardEnv({MUTATION_SHARD: '1'}) as {message: string}).message).toContain('MUTATION_SHARD_EVENT_SHA')
    expect(
      (parseShardEnv({MUTATION_SHARD: '1', MUTATION_SHARD_EVENT_SHA: SHA}) as {message: string}).message,
    ).toContain('MUTATION_SHARD_OUTPUT_DIR')
  })
})

describe('parseShardManifest', () => {
  const manifest = {shard: 2, head: SHA, eventSha: OTHER_SHA, applicability: 'applicable'}

  it('reads a manifest and returns exactly its four fields', () => {
    expect(parseShardManifest(manifest)).toEqual(manifest)
    expect(parseShardManifest({...manifest, shard: 1})).toEqual({...manifest, shard: 1})
    expect(parseShardManifest({...manifest, applicability: 'not-applicable'})).toEqual({
      ...manifest,
      applicability: 'not-applicable',
    })
  })

  it.each([
    ['null', null],
    ['an array', [manifest]],
    ['a string', 'manifest'],
    ['missing shard', {...manifest, shard: undefined}],
    ['a string shard', {...manifest, shard: '2'}],
    ['a zero shard', {...manifest, shard: 0}],
    ['a fractional shard', {...manifest, shard: 1.5}],
    ['a missing head', {...manifest, head: undefined}],
    ['a numeric head', {...manifest, head: 7}],
    ['a missing event SHA', {...manifest, eventSha: undefined}],
    ['a numeric event SHA', {...manifest, eventSha: 7}],
    ['an unknown applicability', {...manifest, applicability: 'maybe'}],
    ['a missing applicability', {...manifest, applicability: undefined}],
    ['an extra field', {...manifest, extra: true}],
  ])('rejects %s', (_name, value) => {
    expect(parseShardManifest(value)).toBeUndefined()
  })
})

describe('runMutationShard', () => {
  it('runs an applicable shard: Stryker gets exactly its list, and the manifest and report are written (R1, R3)', async () => {
    const h = harness()
    const result = await runMutationShard(h.input(1), h.deps)

    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.spawn).toHaveBeenCalledWith(['--mutate', 'm1.ts,m2.ts'])
    expect(result).toEqual({
      kind: 'written',
      manifest: {shard: 1, head: SHA, eventSha: SHA, applicability: 'applicable'},
    })
    expect(readFileSync(join(h.outputDir, 'manifest.json'), 'utf8')).toBe(
      `${JSON.stringify({shard: 1, head: SHA, eventSha: SHA, applicability: 'applicable'}, null, 2)}\n`,
    )
    expect(readFileSync(join(h.outputDir, 'mutation.json'), 'utf8')).toBe(REPORT)
    expect(readdirSync(h.outputDir).toSorted()).toEqual(['manifest.json', 'mutation.json'])
  })

  it.each([
    [2, 'm3.ts'],
    [3, 'm4.ts,m5.ts'],
  ])('gives shard %i its own list and no other', async (shard, list) => {
    const h = harness()
    await runMutationShard(h.input(shard), h.deps)
    expect(h.spawn).toHaveBeenCalledWith(['--mutate', list])
    expect(parseShardManifest(JSON.parse(readFileSync(join(h.outputDir, 'manifest.json'), 'utf8')))?.shard).toBe(shard)
  })

  it('records the checked-out HEAD and the event SHA separately, and does not judge them', async () => {
    const h = harness({readHead: () => OTHER_SHA})
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result).toEqual({
      kind: 'written',
      manifest: {shard: 1, head: OTHER_SHA, eventSha: SHA, applicability: 'applicable'},
    })
  })

  it('edge: the argv adds --mutate only and never overrides testFiles', async () => {
    const h = harness()
    await runMutationShard(h.input(1), h.deps)
    const args = h.spawn.mock.calls[0]?.[0] ?? []
    expect(args).toHaveLength(2)
    expect(args[0]).toBe('--mutate')
    expect(args.join(' ')).not.toContain('testFiles')
    expect(args.join(' ')).not.toContain('t1.test.ts')
  })

  it('edge: the trigger gate is computed from the full config, never from the shard subset', async () => {
    const h = harness()
    await runMutationShard(h.input(2), h.deps)

    expect(h.evaluateGate).toHaveBeenCalledTimes(1)
    expect(h.evaluateGate).toHaveBeenCalledWith(FAKE_CONFIG)
    const config = h.evaluateGate.mock.calls[0]?.[0]
    expect(config?.mutate).toEqual(FAKE_CONFIG.mutate)
    expect(config?.mutate.length).toBeGreaterThan(FAKE_SHARDS[1]?.length ?? 0)
    expect(config?.testFiles).toEqual(FAKE_CONFIG.testFiles)
  })

  it('edge: the gate runs before anything is deleted, read or spawned', async () => {
    const order: string[] = []
    const h = harness({
      evaluateGate: async () => {
        order.push('gate')
        return undefined
      },
      readHead: () => {
        order.push('head')
        return SHA
      },
      spawn: () => {
        order.push('spawn')
      },
    })
    await runMutationShard(h.input(1), h.deps)
    expect(order[0]).toBe('gate')
    expect(order).toContain('spawn')
  })

  it('writes a not-applicable manifest only, and never spawns (AE1)', async () => {
    const h = harness({evaluateGate: async () => gateResult('not-applicable', 'nothing matched')})
    const result = await runMutationShard(h.input(2), h.deps)

    expect(h.spawn).not.toHaveBeenCalled()
    expect(result).toEqual({
      kind: 'written',
      manifest: {shard: 2, head: SHA, eventSha: SHA, applicability: 'not-applicable'},
    })
    expect(readdirSync(h.outputDir)).toEqual(['manifest.json'])
    expect(JSON.parse(readFileSync(join(h.outputDir, 'manifest.json'), 'utf8'))).toEqual({
      shard: 2,
      head: SHA,
      eventSha: SHA,
      applicability: 'not-applicable',
    })
  })

  it('removes a stale report and manifest from the output directory before a not-applicable manifest', async () => {
    const h = harness({evaluateGate: async () => gateResult('not-applicable', 'nothing matched')})
    mkdirSync(h.outputDir, {recursive: true})
    writeFileSync(join(h.outputDir, 'mutation.json'), 'stale')
    writeFileSync(join(h.outputDir, 'manifest.json'), 'stale')
    await runMutationShard(h.input(1), h.deps)
    expect(readdirSync(h.outputDir)).toEqual(['manifest.json'])
    expect(readFileSync(join(h.outputDir, 'manifest.json'), 'utf8')).toContain('"not-applicable"')
  })

  it('creates the output directory when it does not exist', async () => {
    const h = harness()
    expect(existsSync(h.outputDir)).toBe(false)
    await runMutationShard(h.input(1), h.deps)
    expect(existsSync(h.outputDir)).toBe(true)
  })

  it('deletes any old report before the spawn and copies the report that the spawn wrote', async () => {
    const h = harness()
    mkdirSync(join(h.reportPath, '..'), {recursive: true})
    writeFileSync(h.reportPath, '{"stale":true}')
    let atSpawn: boolean | undefined
    const spawn = vi.fn(() => {
      atSpawn = existsSync(h.reportPath)
      writeFileSync(h.reportPath, REPORT)
    })
    await runMutationShard(h.input(1), {...h.deps, spawn})
    expect(atSpawn).toBe(false)
    expect(readFileSync(join(h.outputDir, 'mutation.json'), 'utf8')).toBe(REPORT)
  })

  it('fails when the spawn writes no report, and never copies the stale one (error path)', async () => {
    const h = harness({}, null)
    mkdirSync(join(h.reportPath, '..'), {recursive: true})
    writeFileSync(h.reportPath, REPORT)
    const result = await runMutationShard(h.input(1), h.deps)

    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' ? result.reason : '').toContain(`could not read the Stryker report ${h.reportPath}`)
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it('fails on a report that is not JSON and writes nothing', async () => {
    const h = harness({}, '{ nope')
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' ? result.reason : '').toContain('could not read the Stryker report')
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it.each([['null'], ['[]'], ['"text"'], ['7']])('fails on a report whose JSON is %s, not an object', async body => {
    const h = harness({}, body)
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result).toEqual({kind: 'failed', reason: `the Stryker report ${h.reportPath} is not a JSON object`})
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it('fails when the spawner throws, even if a report exists, and writes nothing', async () => {
    const h = harness()
    const spawn = vi.fn(() => {
      writeFileSync(h.reportPath, REPORT)
      throw new Error('bunx missing')
    })
    mkdirSync(join(h.reportPath, '..'), {recursive: true})
    const result = await runMutationShard(h.input(1), {...h.deps, spawn})
    expect(result).toEqual({kind: 'failed', reason: 'bunx missing'})
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it('keeps a report written while Stryker exited non-zero, and exits as written (AE3)', async () => {
    // The default spawner reports a non-zero exit on stderr and returns, so the report is all the shard has.
    mockSpawnSync.mockReset()
    const h = harness({}, null)
    const deps = defaultShardDeps()
    mockSpawnSync.mockImplementation(() => {
      mkdirSync(join(h.reportPath, '..'), {recursive: true})
      writeFileSync(h.reportPath, REPORT)
      return {error: undefined, status: 1}
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const result = await runMutationShard(h.input(1), {...h.deps, spawn: deps.spawn})
      expect(result.kind).toBe('written')
      expect(readFileSync(join(h.outputDir, 'mutation.json'), 'utf8')).toBe(REPORT)
    } finally {
      stderr.mockRestore()
    }
  })

  it('fails on a ChangedFileGateFailed result: no manifest, no spawn (error path)', async () => {
    const h = harness({
      evaluateGate: async () => ({
        verdict: 'instrumentation-failed',
        mutants: [
          {
            file: 'trigger-gate',
            line: 0,
            col: 0,
            mutator: 'trigger-gate',
            status: 'ChangedFileGateFailed',
            reason: 'could not determine the changed-file trigger gate: gh: HTTP 502',
          },
        ],
      }),
    })
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result).toEqual({
      kind: 'failed',
      reason:
        'the trigger gate returned instrumentation-failed (ChangedFileGateFailed): could not determine the changed-file trigger gate: gh: HTTP 502',
    })
    expect(h.spawn).not.toHaveBeenCalled()
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it.each(['clean', 'mutants-survived', 'directive-violation'] as const)(
    'fails on any other non-applicable gate result (%s) instead of reading it as not-applicable',
    async verdict => {
      const h = harness({evaluateGate: async () => gateResult(verdict, 'odd')})
      const result = await runMutationShard(h.input(1), h.deps)
      expect(result).toEqual({
        kind: 'failed',
        reason: `the trigger gate returned ${verdict} (S): odd`,
      })
      expect(h.spawn).not.toHaveBeenCalled()
      expect(existsSync(h.outputDir)).toBe(false)
    },
  )

  it('describes a gate result whose mutant has no reason by its verdict and status', async () => {
    const h = harness({
      evaluateGate: async () => ({
        verdict: 'instrumentation-failed',
        mutants: [{file: 'trigger-gate', line: 0, col: 0, mutator: 'trigger-gate', status: 'Odd'}],
      }),
    })
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result).toEqual({kind: 'failed', reason: 'the trigger gate returned instrumentation-failed (Odd)'})
  })

  it('describes a gate result with no mutants by its verdict alone', async () => {
    const h = harness({evaluateGate: async () => ({verdict: 'instrumentation-failed', mutants: []})})
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result).toEqual({kind: 'failed', reason: 'the trigger gate returned instrumentation-failed'})
  })

  it('a trigger fetch failure through the real gate exits non-zero and writes no not-applicable manifest', async () => {
    const h = harness({
      evaluateGate: async config =>
        evaluateTriggerGate(config, {eventName: 'pull_request', eventPath: undefined}, undefined, () => ''),
    })
    const result = await runMutationShard(h.input(1), h.deps)
    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' ? result.reason : '').toContain('ChangedFileGateFailed')
    expect(result.kind === 'failed' ? result.reason : '').toContain('GITHUB_EVENT_PATH not set')
    expect(existsSync(h.outputDir)).toBe(false)
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('fails with the message when the gate throws', async () => {
    const h = harness({
      evaluateGate: async () => {
        throw new Error('boom')
      },
    })
    expect(await runMutationShard(h.input(1), h.deps)).toEqual({kind: 'failed', reason: 'boom'})
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it('fails with a stringified non-Error throw', async () => {
    const h = harness({
      readHead: () => {
        const plain: unknown = 'plain text'
        throw plain
      },
    })
    expect(await runMutationShard(h.input(1), h.deps)).toEqual({kind: 'failed', reason: 'plain text'})
  })

  it('fails when HEAD cannot be read, before the spawn', async () => {
    const h = harness({
      readHead: () => {
        throw new Error('not a git checkout')
      },
    })
    expect(await runMutationShard(h.input(1), h.deps)).toEqual({kind: 'failed', reason: 'not a git checkout'})
    expect(h.spawn).not.toHaveBeenCalled()
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it('fails when the shard lists cannot be read, and when the config cannot', async () => {
    const lists = harness({
      readShards: () => {
        throw new Error('no shards')
      },
    })
    expect(await runMutationShard(lists.input(1), lists.deps)).toEqual({kind: 'failed', reason: 'no shards'})
    const config = harness({
      readConfig: () => {
        throw new Error('no config')
      },
    })
    expect(await runMutationShard(config.input(1), config.deps)).toEqual({kind: 'failed', reason: 'no config'})
    expect(lists.spawn).not.toHaveBeenCalled()
    expect(config.spawn).not.toHaveBeenCalled()
  })

  it('is a usage error for a shard id past the last list, naming the range, and does nothing else', async () => {
    const h = harness()
    const result = await runMutationShard({...h.input(1), MUTATION_SHARD: '4'}, h.deps)
    expect(result).toEqual({kind: 'usage', message: 'MUTATION_SHARD must be one of 1-3 (got 4)'})
    expect(h.evaluateGate).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
    expect(existsSync(h.outputDir)).toBe(false)
  })

  it('accepts the last shard id and rejects the one past it', async () => {
    const h = harness()
    expect((await runMutationShard(h.input(3), h.deps)).kind).toBe('written')
    expect((await runMutationShard({...h.input(1), MUTATION_SHARD: '4'}, h.deps)).kind).toBe('usage')
  })

  it('is a usage error for a missing event SHA, without reading lists, config or the gate', async () => {
    const readShards = vi.fn(() => FAKE_SHARDS)
    const h = harness({readShards})
    const result = await runMutationShard({MUTATION_SHARD: '1', MUTATION_SHARD_OUTPUT_DIR: h.outputDir}, h.deps)
    expect(result).toEqual({
      kind: 'usage',
      message: 'MUTATION_SHARD_EVENT_SHA must be a 40-character lowercase hex commit SHA (got unset)',
    })
    expect(readShards).not.toHaveBeenCalled()
    expect(h.evaluateGate).not.toHaveBeenCalled()
  })

  it('is a usage error for an empty environment', async () => {
    const h = harness()
    const result = await runMutationShard({}, h.deps)
    expect(result).toEqual({kind: 'usage', message: 'MUTATION_SHARD must be a positive integer (got unset)'})
  })
})

describe('defaultShardDeps', () => {
  it('reads the repository lists, the repository config and the configured report path', () => {
    const deps = defaultShardDeps()
    expect(deps.readShards()).toEqual(readMutationShards())
    expect(deps.readConfig()).toEqual(readStrykerConfig(strykerConfigPath()))
    expect(deps.reportPath()).toBe(mutationReportPath())
  })

  it('reads HEAD of the checkout with git rev-parse HEAD', () => {
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: findRepositoryRoot(),
      encoding: 'utf8',
    }).trim()
    const head = defaultShardDeps().readHead()
    expect(head).toBe(expected)
    expect(head).toMatch(/^[0-9a-f]{40}$/u)
  })

  it('evaluates the trigger gate: applicable off a pull_request, a gate failure on one with no event payload', async () => {
    const deps = defaultShardDeps()
    const tiny: StrykerConfigShape = {mutate: [], testFiles: [], reporters: ['json'], jsonReportFileName: 'r.json'}

    vi.stubEnv('GITHUB_EVENT_NAME', 'push')
    expect(await deps.evaluateGate(tiny)).toBeUndefined()

    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request')
    vi.stubEnv('GITHUB_EVENT_PATH', '')
    const failed = await deps.evaluateGate(tiny)
    expect(failed?.verdict).toBe('instrumentation-failed')
    expect(failed?.mutants[0]?.status).toBe('ChangedFileGateFailed')
  })

  it('spawns Stryker through the gate spawner with the shard argv after the config', () => {
    mockSpawnSync.mockReset()
    mockSpawnSync.mockReturnValue({error: undefined, status: 0})
    defaultShardDeps().spawn(['--mutate', 'a.ts,b.ts'])

    const call = mockSpawnSync.mock.calls.at(-1) as [string, string[], {cwd?: string}] | undefined
    expect(call?.[0]).toBe('bunx')
    expect(call?.[1]).toEqual(['--no-install', 'stryker', 'run', strykerConfigPath(), '--mutate', 'a.ts,b.ts'])
    expect(call?.[2].cwd).toBe(findRepositoryRoot())
  })
})
