import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {
  classifyReportFile,
  exitCodeFor,
  mutationReportPath,
  printResult,
  readStrykerConfig,
  strykerConfigPath,
  triggerGateSentinel,
  type ClassificationResult,
  type StrykerConfigShape,
} from './check-mutation-guards.ts'
import {
  defaultMergeDeps,
  mergeShardReports,
  parseMergeEnv,
  runMutationMerge,
  type MergeDeps,
  type MergeOutcome,
} from './mutation-merge.ts'
import {readMutationShards} from './mutation-shard-lists.ts'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)

interface TestEntry {
  readonly id: string
}
interface Report {
  files: Record<string, {mutants: {status: string; statusReason?: string}[]}>
  testFiles: Record<string, {tests: TestEntry[]}>
  config: {mutate: string[]; testFiles: string[]}
  [key: string]: unknown
}

function readFixture(name: string): Report {
  const parsed: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8'))
  return parsed as Report
}

const baseline = readFixture('mutation-report-baseline.json')
const fixtureConfig: StrykerConfigShape = {
  mutate: baseline.config.mutate,
  testFiles: baseline.config.testFiles,
  reporters: ['json', 'clear-text'],
  jsonReportFileName: 'reports/mutation/mutation.json',
}
// Three lists that partition the fixture's mutate list, dealt round-robin so every shard holds entries from every package.
const LISTS: readonly (readonly string[])[] = [0, 1, 2].map(offset =>
  fixtureConfig.mutate.filter((_entry, index) => index % 3 === offset),
)

function shardReport(shard: number, transform?: (report: Report) => void): Report {
  const report = structuredClone(baseline)
  const list = LISTS[shard - 1] ?? []
  report.files = Object.fromEntries(Object.entries(report.files).filter(([file]) => list.includes(file)))
  report.config.mutate = [...list]
  transform?.(report)
  return report
}

let root = ''
let counter = 0
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mutation-merge-'))
})
afterAll(() => {
  rmSync(root, {recursive: true, force: true})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

interface ShardSpec {
  /** `needs.<shard>.result`; default `success`. `null` leaves the variable unset. */
  readonly result?: string | null
  /** Default `applicable`. A not-applicable shard has no report unless one is given. */
  readonly applicability?: 'applicable' | 'not-applicable'
  /** `false` leaves the directory out. */
  readonly dir?: false
  /** A manifest object, a raw string, or `false` for no manifest file. */
  readonly manifest?: Record<string, unknown> | string | false
  /** A report object, a raw string, or `false` for no report file. */
  readonly report?: unknown
  /** `true` makes `mutation-shard-<n>` a regular file instead of a directory. */
  readonly dirIsFile?: true
}

interface Built {
  readonly env: Record<string, string>
  readonly deps: MergeDeps
  readonly artifactDir: string
  readonly reportPath: string
  readonly classify: ReturnType<typeof vi.fn<MergeDeps['classify']>>
}

function build(specs: Partial<Record<1 | 2 | 3, ShardSpec>> = {}, overrides: Partial<MergeDeps> = {}): Built {
  counter += 1
  const base = join(root, `case-${String(counter)}`)
  const artifactDir = join(base, 'shards')
  mkdirSync(artifactDir, {recursive: true})
  const env: Record<string, string> = {MUTATION_ARTIFACT_DIR: artifactDir, MUTATION_EVENT_SHA: SHA}

  for (const shard of [1, 2, 3] as const) {
    const spec = specs[shard] ?? {}
    if (spec.result !== null) env[`MUTATION_SHARD_${String(shard)}_RESULT`] = spec.result ?? 'success'
    if (spec.dir === false) continue
    const directory = join(artifactDir, `mutation-shard-${String(shard)}`)
    if (spec.dirIsFile === true) {
      writeFileSync(directory, 'not a directory')
      continue
    }
    mkdirSync(directory)
    const applicability = spec.applicability ?? 'applicable'
    if (spec.manifest !== false) {
      const manifest = spec.manifest ?? {shard, head: SHA, eventSha: SHA, applicability}
      writeFileSync(
        join(directory, 'manifest.json'),
        typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
      )
    }
    if (spec.report !== false && (applicability === 'applicable' || spec.report !== undefined)) {
      const report = spec.report ?? shardReport(shard)
      writeFileSync(join(directory, 'mutation.json'), typeof report === 'string' ? report : JSON.stringify(report))
    }
  }

  const reportPath = join(base, 'merged', 'mutation.json')
  const classify = vi.fn<MergeDeps['classify']>((config, path) =>
    classifyReportFile(config, path, {reporters: ['json'], resolvedJsonReportPath: path}),
  )
  const deps: MergeDeps = {
    readShards: () => LISTS,
    readConfig: () => fixtureConfig,
    reportPath: () => reportPath,
    classify,
    ...overrides,
  }
  return {env, deps, artifactDir, reportPath, classify}
}

function resultOf(outcome: MergeOutcome): ClassificationResult {
  if (outcome.kind !== 'result') throw new Error(`expected a result, got ${JSON.stringify(outcome)}`)
  return outcome.result
}

const located = (result: ClassificationResult): string[] => result.mutants.map(m => `${m.file}|${m.status}`)

describe('parseMergeEnv', () => {
  const good = {MUTATION_ARTIFACT_DIR: '/tmp/shards', MUTATION_EVENT_SHA: SHA}

  it('reads the artifact directory and the event SHA', () => {
    expect(parseMergeEnv(good)).toEqual({ok: true, input: {artifactDir: '/tmp/shards', eventSha: SHA}})
  })

  it.each([
    ['unset', undefined, 'MUTATION_ARTIFACT_DIR must be set (got unset)'],
    ['empty', '', 'MUTATION_ARTIFACT_DIR must be set (got "")'],
  ])('rejects an artifact directory that is %s', (_name, value, message) => {
    expect(parseMergeEnv({...good, MUTATION_ARTIFACT_DIR: value})).toEqual({ok: false, message})
  })

  it.each([
    ['unset', undefined, 'unset'],
    ['empty', '', '""'],
    ['short', 'a'.repeat(39), `"${'a'.repeat(39)}"`],
    ['upper case', 'A'.repeat(40), `"${'A'.repeat(40)}"`],
    ['suffixed', `${'a'.repeat(40)}\n`, String.raw`"${'a'.repeat(40)}\n"`],
    ['prefixed', `x${'a'.repeat(40)}`, `"x${'a'.repeat(40)}"`],
  ])('rejects an event SHA that is %s', (_name, value, shown) => {
    expect(parseMergeEnv({...good, MUTATION_EVENT_SHA: value})).toEqual({
      ok: false,
      message: `MUTATION_EVENT_SHA must be a 40-character lowercase hex commit SHA (got ${shown})`,
    })
  })

  it('reports the directory before the SHA', () => {
    const parsed = parseMergeEnv({})
    expect(parsed.ok ? '' : parsed.message).toContain('MUTATION_ARTIFACT_DIR')
  })
})

describe('runMutationMerge: a clean run', () => {
  it('merges three clean shard reports into clean, with every mutate entry once (AE2)', () => {
    const b = build()
    const outcome = runMutationMerge(b.env, b.deps)
    expect(outcome).toEqual({kind: 'result', result: {verdict: 'clean', mutants: []}})

    const merged = JSON.parse(readFileSync(b.reportPath, 'utf8')) as Report
    expect(Object.keys(merged.files).toSorted()).toEqual(fixtureConfig.mutate.toSorted())
    expect(Object.keys(merged.files)).toHaveLength(fixtureConfig.mutate.length)
    expect(Object.keys(merged.testFiles).toSorted()).toEqual(Object.keys(baseline.testFiles).toSorted())
    expect(merged.config.mutate.toSorted()).toEqual(fixtureConfig.mutate.toSorted())
    expect(b.classify).toHaveBeenCalledTimes(1)
    expect(b.classify).toHaveBeenCalledWith(fixtureConfig, b.reportPath)
  })

  it('merges three manifests that carry the event head SHA, whatever the SHA is (AE8)', () => {
    const b = build()
    b.env.MUTATION_EVENT_SHA = OTHER_SHA
    const manifests = [1, 2, 3].map(shard => ({
      shard,
      head: OTHER_SHA,
      eventSha: OTHER_SHA,
      applicability: 'applicable',
    }))
    for (const manifest of manifests) {
      writeFileSync(
        join(b.artifactDir, `mutation-shard-${String(manifest.shard)}`, 'manifest.json'),
        JSON.stringify(manifest),
      )
    }
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('clean')
  })

  it('overwrites a stale report at the configured path and classifies the merged one', () => {
    const b = build()
    mkdirSync(join(b.reportPath, '..'), {recursive: true})
    writeFileSync(b.reportPath, '{"files":{"stale.ts":{"mutants":[]}}}')
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('clean')
    expect(Object.keys((JSON.parse(readFileSync(b.reportPath, 'utf8')) as Report).files)).not.toContain('stale.ts')
  })

  it('creates the directory of the configured report path', () => {
    const b = build()
    expect(existsSync(join(b.reportPath, '..'))).toBe(false)
    runMutationMerge(b.env, b.deps)
    expect(existsSync(b.reportPath)).toBe(true)
  })
})

describe('runMutationMerge: not-applicable', () => {
  it('gives not-applicable for three not-applicable manifests, without a report or a classification (AE1)', () => {
    const na = {applicability: 'not-applicable'} as const
    const b = build({1: na, 2: na, 3: na})
    const outcome = runMutationMerge(b.env, b.deps)
    expect(outcome).toEqual({
      kind: 'result',
      result: triggerGateSentinel(
        'not-applicable',
        'NotApplicable',
        'all 3 shards found no changed file in the trigger set; nothing to check',
      ),
    })
    expect(resultOf(outcome).mutants).toEqual([
      {
        file: 'trigger-gate',
        line: 0,
        col: 0,
        mutator: 'trigger-gate',
        status: 'NotApplicable',
        reason: 'all 3 shards found no changed file in the trigger set; nothing to check',
      },
    ])
    expect(exitCodeFor(resultOf(outcome).verdict)).toBe(0)
    expect(b.classify).not.toHaveBeenCalled()
    expect(existsSync(b.reportPath)).toBe(false)
  })

  it('fails closed on mixed applicability, naming every shard and the split', () => {
    const b = build({2: {applicability: 'not-applicable'}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardApplicabilityMismatch',
      'mutation-shard-2|ShardApplicabilityMismatch',
      'mutation-shard-3|ShardApplicabilityMismatch',
    ])
    expect(result.mutants[0]?.reason).toBe(
      'applicability is "applicable"; applicable: shards 1 and 3; not-applicable: shard 2',
    )
    expect(result.mutants[1]?.reason).toBe(
      'applicability is "not-applicable"; applicable: shards 1 and 3; not-applicable: shard 2',
    )
    expect(b.classify).not.toHaveBeenCalled()
    expect(existsSync(b.reportPath)).toBe(false)
  })

  it('fails closed on two not-applicable shards and one applicable one', () => {
    const na = {applicability: 'not-applicable'} as const
    const b = build({1: na, 3: na})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants[0]?.reason).toBe(
      'applicability is "not-applicable"; applicable: shard 2; not-applicable: shards 1 and 3',
    )
  })
})

describe('runMutationMerge: the job results', () => {
  it.each(['failure', 'cancelled', 'skipped'])(
    'a %s result fails the job, names that shard and does not classify (AE4)',
    value => {
      const b = build({2: {result: value}})
      const result = resultOf(runMutationMerge(b.env, b.deps))
      expect(result.verdict).toBe('instrumentation-failed')
      expect(result.mutants).toEqual([
        {
          file: 'mutation-shard-2',
          line: 0,
          col: 0,
          mutator: 'shard-merge',
          status: 'ShardResultNotSuccess',
          reason: `the job result is "${value}", not "success"`,
        },
      ])
      expect(b.classify).not.toHaveBeenCalled()
      expect(existsSync(b.reportPath)).toBe(false)
    },
  )

  it.each([
    ['an unknown value', 'neutral', '"neutral"'],
    ['an empty value', '', '""'],
    ['a different case', 'Success', '"Success"'],
    ['a padded value', 'success ', '"success "'],
    ['no value at all', null, 'unset'],
  ])('%s fails and names the shard', (_name, value, shown) => {
    const b = build({3: {result: value}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants).toHaveLength(1)
    expect(result.mutants[0]?.file).toBe('mutation-shard-3')
    expect(result.mutants[0]?.status).toBe('ShardResultNotSuccess')
    expect(result.mutants[0]?.reason).toBe(`the job result is ${shown}, not "success"`)
  })

  it('names every shard that did not succeed, and only those', () => {
    const b = build({1: {result: 'failure'}, 3: {result: 'cancelled'}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardResultNotSuccess',
      'mutation-shard-3|ShardResultNotSuccess',
    ])
  })

  it('fails on three skipped results and never reports not-applicable', () => {
    const skipped = {result: 'skipped'}
    const b = build({1: skipped, 2: skipped, 3: skipped})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardResultNotSuccess',
      'mutation-shard-2|ShardResultNotSuccess',
      'mutation-shard-3|ShardResultNotSuccess',
    ])
  })

  it('reads no artifact file when a result is not success: a stale artifact of a failed shard is never looked at', () => {
    const b = build({2: {result: 'failure', manifest: '{ not json', report: '{ not json'}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-2|ShardResultNotSuccess'])
  })

  it('checks the results before it looks for any directory', () => {
    const b = build({1: {result: 'failure'}, 2: {dir: false}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-1|ShardResultNotSuccess'])
  })
})

describe('runMutationMerge: an empty or miscounted shard list never turns failed jobs green', () => {
  const all = (spec: ShardSpec): Partial<Record<1 | 2 | 3, ShardSpec>> => ({1: spec, 2: spec, 3: spec})
  const na = {applicability: 'not-applicable'} as const

  it('checks the three named job results without reading the lists or the config', () => {
    const readShards = vi.fn((): readonly (readonly string[])[] => {
      throw new Error('lists must not be read')
    })
    const readConfig = vi.fn((): StrykerConfigShape => {
      throw new Error('config must not be read')
    })
    const b = build({2: {result: 'failure'}}, {readShards, readConfig})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-2|ShardResultNotSuccess'])
    expect(readShards).not.toHaveBeenCalled()
    expect(readConfig).not.toHaveBeenCalled()
  })

  it('fails all three shards for shards: [] when the three jobs failed', () => {
    const b = build(all({result: 'failure'}), {readShards: () => []})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardResultNotSuccess',
      'mutation-shard-2|ShardResultNotSuccess',
      'mutation-shard-3|ShardResultNotSuccess',
    ])
  })

  it('fails shards: [] when the three jobs succeeded but left no artifacts', () => {
    const b = build(all({dir: false}), {readShards: () => []})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual(['mutation-guards.json|ShardListsInvalid'])
    expect(result.mutants[0]?.reason).toContain('expected 3 shards, found 0')
    expect(b.classify).not.toHaveBeenCalled()
  })

  it('fails shards: [] even when the three manifests are valid not-applicable ones', () => {
    const b = build(all(na), {readShards: () => []})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual(['mutation-guards.json|ShardListsInvalid'])
  })

  it.each([
    ['two lists', () => [LISTS[0] ?? [], [...(LISTS[1] ?? []), ...(LISTS[2] ?? [])]], 2],
    ['four lists', () => [LISTS[0] ?? [], LISTS[1] ?? [], LISTS[2] ?? [], []], 4],
  ])('fails with %s and valid not-applicable manifests', (_name, lists, count) => {
    const b = build(all(na), {readShards: lists})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants[0]?.status).toBe('ShardListsInvalid')
    expect(result.mutants[0]?.reason).toContain(`expected 3 shards, found ${String(count)}`)
  })

  it('checks the partition before it looks for any directory', () => {
    const lists = [LISTS[0] ?? [], (LISTS[1] ?? []).slice(1), LISTS[2] ?? []]
    const b = build({2: {dir: false}}, {readShards: () => lists})
    expect(located(resultOf(runMutationMerge(b.env, b.deps)))).toEqual(['mutation-guards.json|ShardListsInvalid'])
  })

  it('checks the partition before it decides applicability', () => {
    const lists = [LISTS[0] ?? [], (LISTS[1] ?? []).slice(1), LISTS[2] ?? []]
    const b = build(all(na), {readShards: () => lists})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual(['mutation-guards.json|ShardListsInvalid'])
  })
})

describe('runMutationMerge: the artifacts', () => {
  it('fails and names every shard when the pattern download matched nothing', () => {
    const b = build({1: {dir: false}, 2: {dir: false}, 3: {dir: false}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.map(m => [m.file, m.status, m.reason])).toEqual([
      ['mutation-shard-1', 'ShardArtifactMissing', 'no mutation-shard-1 directory in the downloaded artifacts'],
      ['mutation-shard-2', 'ShardArtifactMissing', 'no mutation-shard-2 directory in the downloaded artifacts'],
      ['mutation-shard-3', 'ShardArtifactMissing', 'no mutation-shard-3 directory in the downloaded artifacts'],
    ])
  })

  it('names only the shard whose directory is missing', () => {
    const b = build({2: {dir: false}})
    expect(located(resultOf(runMutationMerge(b.env, b.deps)))).toEqual(['mutation-shard-2|ShardArtifactMissing'])
  })

  it('fails when the artifact directory itself does not exist', () => {
    const b = build()
    b.env.MUTATION_ARTIFACT_DIR = join(b.artifactDir, 'nowhere')
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardArtifactMissing',
      'mutation-shard-2|ShardArtifactMissing',
      'mutation-shard-3|ShardArtifactMissing',
    ])
  })

  it('treats a regular file where the shard directory should be as missing', () => {
    const b = build({1: {dirIsFile: true}})
    expect(located(resultOf(runMutationMerge(b.env, b.deps)))).toEqual(['mutation-shard-1|ShardArtifactMissing'])
  })

  it('fails and names the shard for a missing manifest', () => {
    const b = build({2: {manifest: false}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-2|ShardManifestUnreadable'])
    expect(result.mutants[0]?.reason).toContain('manifest.json could not be read: ENOENT')
  })

  it('fails and names the shard for a manifest that is not JSON', () => {
    const b = build({3: {manifest: '{ nope'}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-3|ShardManifestUnreadable'])
    expect(result.mutants[0]?.reason).toMatch(/^manifest\.json could not be read: .*JSON/iu)
  })

  it.each([
    ['an extra field', {shard: 1, head: SHA, eventSha: SHA, applicability: 'applicable', extra: 1}],
    ['an unknown applicability', {shard: 1, head: SHA, eventSha: SHA, applicability: 'maybe'}],
    ['a missing field', {shard: 1, head: SHA, applicability: 'applicable'}],
    ['an array', [1, 2]],
  ])('fails and names the shard for a manifest with %s', (_name, manifest) => {
    const b = build({1: {manifest: manifest as Record<string, unknown>}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toHaveLength(1)
    expect(result.mutants[0]?.file).toBe('mutation-shard-1')
    expect(result.mutants[0]?.status).toBe('ShardManifestUnreadable')
    expect(result.mutants[0]?.reason).toBe('manifest.json is not a valid shard manifest')
  })

  it('fails when a manifest names a different shard than its directory', () => {
    const b = build({2: {manifest: {shard: 3, head: SHA, eventSha: SHA, applicability: 'applicable'}}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toEqual([
      {
        file: 'mutation-shard-2',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardManifestMismatch',
        reason: 'manifest.json says shard 3, not shard 2',
      },
    ])
  })

  it('fails when a manifest HEAD differs from the event head SHA, as a merge-commit checkout does', () => {
    const b = build({1: {manifest: {shard: 1, head: OTHER_SHA, eventSha: SHA, applicability: 'applicable'}}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toEqual([
      {
        file: 'mutation-shard-1',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardCommitMismatch',
        reason: `HEAD ${OTHER_SHA} and event SHA ${SHA} must both equal the pull request head ${SHA}`,
      },
    ])
    expect(b.classify).not.toHaveBeenCalled()
  })

  it('fails when a manifest event SHA differs from the event head SHA', () => {
    const b = build({3: {manifest: {shard: 3, head: SHA, eventSha: OTHER_SHA, applicability: 'applicable'}}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-3|ShardCommitMismatch'])
  })

  it('fails every shard of a not-applicable run whose manifest is on another commit', () => {
    const stale = (shard: number) => ({shard, head: OTHER_SHA, eventSha: OTHER_SHA, applicability: 'not-applicable'})
    const na = (shard: number) => ({applicability: 'not-applicable', manifest: stale(shard)}) as const
    const b = build({1: na(1), 2: na(2), 3: na(3)})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardCommitMismatch',
      'mutation-shard-2|ShardCommitMismatch',
      'mutation-shard-3|ShardCommitMismatch',
    ])
  })
})

describe('runMutationMerge: the lists and the reports', () => {
  it('fails when the shard lists are not a partition of the mutate list', () => {
    const lists = [LISTS[0] ?? [], (LISTS[1] ?? []).slice(1), LISTS[2] ?? []]
    const b = build({}, {readShards: () => lists})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toEqual([
      {
        file: 'mutation-guards.json',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardListsInvalid',
        reason: `the shard lists are not a partition of the mutate list: ${LISTS[1]?.[0] ?? ''}: in no shard`,
      },
    ])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(b.classify).not.toHaveBeenCalled()
  })

  it('joins several partition violations with a semicolon', () => {
    const lists = [LISTS[0] ?? [], (LISTS[1] ?? []).slice(2), LISTS[2] ?? []]
    const b = build({}, {readShards: () => lists})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants[0]?.reason).toBe(
      `the shard lists are not a partition of the mutate list: ${LISTS[1]?.[0] ?? ''}: in no shard; ${LISTS[1]?.[1] ?? ''}: in no shard`,
    )
  })

  it('fails and names the shard for a missing report', () => {
    const b = build({2: {report: false}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-2|ShardReportUnreadable'])
    expect(result.mutants[0]?.reason).toContain('mutation.json could not be read: ENOENT')
  })

  it('fails and names the shard for a report that is not JSON', () => {
    const b = build({1: {report: '{ nope'}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual(['mutation-shard-1|ShardReportUnreadable'])
    expect(result.mutants[0]?.reason).toMatch(/^mutation\.json could not be read: .*JSON/iu)
  })

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"x"'],
    ['an object with no files map', '{"testFiles":{}}'],
    ['an object whose files is an array', '{"files":[],"testFiles":{}}'],
    ['an object with no testFiles map', '{"files":{}}'],
    ['an object whose testFiles is an array', '{"files":{},"testFiles":[]}'],
  ])('fails and names the shard for a report that is %s', (_name, body) => {
    const b = build({3: {report: body}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toHaveLength(1)
    expect(result.mutants[0]?.file).toBe('mutation-shard-3')
    expect(result.mutants[0]?.status).toBe('ShardReportUnreadable')
    expect(result.mutants[0]?.reason).toBe('mutation.json is not a JSON object with files and testFiles maps')
  })

  it('names every shard whose report is unreadable', () => {
    const b = build({1: {report: false}, 3: {report: false}})
    expect(located(resultOf(runMutationMerge(b.env, b.deps)))).toEqual([
      'mutation-shard-1|ShardReportUnreadable',
      'mutation-shard-3|ShardReportUnreadable',
    ])
  })

  it('fails when a report holds a key outside its shard list (and no other shard has it)', () => {
    const report = shardReport(1, r => {
      r.files['packages/ci-checks/src/stray.ts'] = {mutants: [{status: 'Killed'}]}
    })
    const b = build({1: {report}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toEqual([
      {
        file: 'mutation-shard-1',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardFilesMismatch',
        reason: 'files keys differ from the shard list: unexpected packages/ci-checks/src/stray.ts',
      },
    ])
  })

  it('fails when an entry of the shard list is missing from its report', () => {
    const dropped = LISTS[1]?.[0] ?? ''
    const report = shardReport(2, r => {
      delete r.files[dropped]
    })
    const b = build({2: {report}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toEqual([
      {
        file: 'mutation-shard-2',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardFilesMismatch',
        reason: `files keys differ from the shard list: missing ${dropped}`,
      },
    ])
  })

  it('names both the missing and the unexpected keys, in that order', () => {
    const dropped = LISTS[0]?.[0] ?? ''
    const report = shardReport(1, r => {
      delete r.files[dropped]
      r.files['packages/ci-checks/src/stray.ts'] = {mutants: [{status: 'Killed'}]}
    })
    const b = build({1: {report}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants[0]?.reason).toBe(
      `files keys differ from the shard list: missing ${dropped}; unexpected packages/ci-checks/src/stray.ts`,
    )
  })

  it('lists several missing and several unexpected keys, comma separated', () => {
    const [first = '', second = ''] = LISTS[0] ?? []
    const report = shardReport(1, r => {
      delete r.files[first]
      delete r.files[second]
      r.files['packages/ci-checks/src/stray-one.ts'] = {mutants: [{status: 'Killed'}]}
      r.files['packages/ci-checks/src/stray-two.ts'] = {mutants: [{status: 'Killed'}]}
    })
    const b = build({1: {report}})
    expect(resultOf(runMutationMerge(b.env, b.deps)).mutants[0]?.reason).toBe(
      `files keys differ from the shard list: missing ${first}, ${second}; unexpected packages/ci-checks/src/stray-one.ts, packages/ci-checks/src/stray-two.ts`,
    )
  })

  it('compares keys with a single leading ./ stripped', () => {
    const entry = LISTS[0]?.[0] ?? ''
    const report = shardReport(1, r => {
      r.files[`./${entry}`] = r.files[entry] ?? {mutants: []}
      delete r.files[entry]
    })
    const b = build({1: {report}})
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('clean')
  })

  it('fails when two reports cover the same entry, naming both shards', () => {
    const shared = LISTS[1]?.[0] ?? ''
    const report = shardReport(1, r => {
      r.files[shared] = structuredClone(baseline.files[shared] ?? {mutants: []})
    })
    const b = build({1: {report}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants).toEqual([
      {
        file: 'mutation-shard-1',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardFilesOverlap',
        reason: `${shared} is in the reports of shards 1 and 2`,
      },
      {
        file: 'mutation-shard-2',
        line: 0,
        col: 0,
        mutator: 'shard-merge',
        status: 'ShardFilesOverlap',
        reason: `${shared} is in the reports of shards 1 and 2`,
      },
    ])
    expect(b.classify).not.toHaveBeenCalled()
  })

  it('names three shards that all cover one entry', () => {
    const shared = LISTS[0]?.[0] ?? ''
    const add = (r: Report) => {
      r.files[shared] = structuredClone(baseline.files[shared] ?? {mutants: []})
    }
    const b = build({2: {report: shardReport(2, add)}, 3: {report: shardReport(3, add)}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual([
      'mutation-shard-1|ShardFilesOverlap',
      'mutation-shard-2|ShardFilesOverlap',
      'mutation-shard-3|ShardFilesOverlap',
    ])
    expect(result.mutants[0]?.reason).toBe(`${shared} is in the reports of shards 1, 2 and 3`)
  })
})

describe('runMutationMerge: every configured test file ran in every shard', () => {
  const testFile = fixtureConfig.testFiles[0] ?? ''

  it('fails with an unexecuted test file when shard 2 ran it zero times while shards 1 and 3 ran it (AE7)', () => {
    const report = shardReport(2, r => {
      r.testFiles[testFile] = {tests: []}
    })
    const b = build({2: {report}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants).toEqual([
      {
        file: testFile,
        line: 0,
        col: 0,
        mutator: 'vitest-config',
        status: 'TestFileNotExecuted',
        reason: 'shard 2 ran no tests from this configured test file',
      },
    ])
    expect(b.classify).not.toHaveBeenCalled()
  })

  it('fails when a shard report has no entry for the test file at all', () => {
    const report = shardReport(3, r => {
      delete r.testFiles[testFile]
    })
    const b = build({3: {report}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(located(result)).toEqual([`${testFile}|TestFileNotExecuted`])
    expect(result.mutants[0]?.reason).toBe('shard 3 ran no tests from this configured test file')
  })

  it('names every shard that ran the file zero times, grouped on one located line per file', () => {
    const empty = (r: Report) => {
      r.testFiles[testFile] = {tests: []}
    }
    const b = build({1: {report: shardReport(1, empty)}, 3: {report: shardReport(3, empty)}})
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants).toHaveLength(1)
    expect(result.mutants[0]?.reason).toBe('shards 1 and 3 ran no tests from this configured test file')
  })

  it('names all three shards, one line per file, in config order', () => {
    const second = fixtureConfig.testFiles[1] ?? ''
    const empty = (r: Report) => {
      r.testFiles[testFile] = {tests: []}
      r.testFiles[second] = {tests: []}
    }
    const b = build({
      1: {report: shardReport(1, empty)},
      2: {report: shardReport(2, empty)},
      3: {report: shardReport(3, empty)},
    })
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.mutants.map(m => m.file).toSorted()).toEqual([testFile, second].toSorted())
    expect(result.mutants[0]?.reason).toBe('shards 1, 2 and 3 ran no tests from this configured test file')
  })

  it('does not require a report entry for a glob testFiles entry, which no report can name', () => {
    const config: StrykerConfigShape = {
      ...fixtureConfig,
      testFiles: [...fixtureConfig.testFiles, 'packages/**/*.test.ts'],
    }
    const b = build({}, {readConfig: () => config})
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('clean')
  })

  it('compares test file keys with a single leading ./ stripped', () => {
    const report = shardReport(2, r => {
      r.testFiles[`./${testFile}`] = r.testFiles[testFile] ?? {tests: []}
      delete r.testFiles[testFile]
    })
    const b = build({2: {report}})
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('clean')
  })
})

describe('runMutationMerge: the verdict is the classifier of a single run', () => {
  const setStatus = (status: string) => (report: Report) => {
    for (const file of Object.keys(report.files)) {
      const mutant = report.files[file]?.mutants.find(candidate => candidate.status === 'Killed')
      if (mutant !== undefined) {
        mutant.status = status
        return
      }
    }
    throw new Error('no killed mutant to change')
  }

  it.each([1, 2, 3] as const)(
    'a survivor in shard %i gives mutants-survived and exit 1 (AE3, success criterion 2)',
    shard => {
      const b = build({[shard]: {report: shardReport(shard, setStatus('Survived'))}})
      const result = resultOf(runMutationMerge(b.env, b.deps))
      expect(result.verdict).toBe('mutants-survived')
      expect(exitCodeFor(result.verdict)).toBe(1)
      expect(result.mutants).toHaveLength(1)
      expect(result.mutants[0]?.status).toBe('Survived')
      expect(LISTS[shard - 1]).toContain(result.mutants[0]?.file)
    },
  )

  it('a Timeout gives mutant-timeout', () => {
    const b = build({2: {report: shardReport(2, setStatus('Timeout'))}})
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('mutant-timeout')
  })

  it('a NoCoverage mutant gives mutants-uncovered', () => {
    const b = build({3: {report: shardReport(3, setStatus('NoCoverage'))}})
    expect(resultOf(runMutationMerge(b.env, b.deps)).verdict).toBe('mutants-uncovered')
  })

  it('lists the survivors of every shard in one result', () => {
    const b = build({
      1: {report: shardReport(1, setStatus('Survived'))},
      3: {report: shardReport(3, setStatus('Survived'))},
    })
    const result = resultOf(runMutationMerge(b.env, b.deps))
    expect(result.verdict).toBe('mutants-survived')
    expect(result.mutants).toHaveLength(2)
  })
})

describe('mergeShardReports', () => {
  const reportOf = (files: Record<string, number>, testFiles: Record<string, number>, extra: object = {}) => ({
    schemaVersion: '2',
    config: {mutate: Object.keys(files), testFiles: [], jsonReporter: {fileName: 'x'}},
    files: Object.fromEntries(Object.keys(files).map(file => [file, {mutants: [{id: file, status: 'Killed'}]}])),
    testFiles: Object.fromEntries(
      Object.entries(testFiles).map(([file, count]) => [
        file,
        {tests: Array.from({length: count}, (_, index) => ({id: `${file}#${String(index)}`}))},
      ]),
    ),
    ...extra,
  })

  it('unions the files of the reports and keeps the top-level fields of the first', () => {
    const merged = mergeShardReports(
      [
        reportOf({'a.ts': 1}, {}, {framework: {name: 'one'}}),
        reportOf({'b.ts': 1, 'c.ts': 1}, {}, {framework: {name: 'two'}}),
      ],
      [['a.ts'], ['b.ts', 'c.ts']],
    )
    expect(Object.keys(merged.files as object)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(merged.framework).toEqual({name: 'one'})
    expect(merged.schemaVersion).toBe('2')
    expect((merged.config as {mutate: string[]}).mutate).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect((merged.config as {jsonReporter: object}).jsonReporter).toEqual({fileName: 'x'})
  })

  it('keeps each test file entry from the report that ran it the fewest times', () => {
    const merged = mergeShardReports(
      [
        reportOf({'a.ts': 1}, {'t1.test.ts': 5, 't2.test.ts': 2}),
        reportOf({'b.ts': 1}, {'t1.test.ts': 3, 't2.test.ts': 4}),
      ],
      [['a.ts'], ['b.ts']],
    )
    const testFiles = merged.testFiles as Record<string, {tests: {id: string}[]}>
    expect(testFiles['t1.test.ts']?.tests).toHaveLength(3)
    expect(testFiles['t2.test.ts']?.tests).toHaveLength(2)
    expect(Object.keys(testFiles)).toEqual(['t1.test.ts', 't2.test.ts'])
  })

  it('keeps the first report entry on a tie, and the ids as written', () => {
    const first = reportOf({'a.ts': 1}, {'t.test.ts': 2})
    const second = reportOf({'b.ts': 1}, {'t.test.ts': 2})
    ;(first.testFiles as Record<string, object>)['t.test.ts'] = {from: 'first', tests: [{id: 'x#0'}, {id: 'x#1'}]}
    ;(second.testFiles as Record<string, object>)['t.test.ts'] = {from: 'second', tests: [{id: 'y#0'}, {id: 'y#1'}]}
    const merged = mergeShardReports([first, second], [['a.ts'], ['b.ts']])
    expect((merged.testFiles as Record<string, unknown>)['t.test.ts']).toEqual({
      from: 'first',
      tests: [{id: 'x#0'}, {id: 'x#1'}],
    })
  })

  it('keeps a test file only one report has', () => {
    const merged = mergeShardReports(
      [reportOf({'a.ts': 1}, {'only-a.test.ts': 1}), reportOf({'b.ts': 1}, {'only-b.test.ts': 2})],
      [['a.ts'], ['b.ts']],
    )
    expect(Object.keys(merged.testFiles as object).toSorted()).toEqual(['only-a.test.ts', 'only-b.test.ts'])
  })

  it('treats a report entry with no tests array as zero tests', () => {
    const odd = reportOf({'b.ts': 1}, {})
    ;(odd.testFiles as Record<string, unknown>)['t.test.ts'] = {}
    const merged = mergeShardReports([reportOf({'a.ts': 1}, {'t.test.ts': 2}), odd], [['a.ts'], ['b.ts']])
    expect((merged.testFiles as Record<string, unknown>)['t.test.ts']).toEqual({})
  })
})

describe('two real shard reports merge to the verdict and output of the single run', () => {
  it('classifies the probe two-shard fixtures the same as the single-run fixture', () => {
    const baselineReport = readFixture('mutation-report-baseline.json')
    const a = readFixture('mutation-report-two-shard-a.json')
    const b = readFixture('mutation-report-two-shard-b.json')
    const merged = mergeShardReports([a, b], [a.config.mutate, b.config.mutate])

    const dir = mkdtempSync(join(root, 'integration-'))
    const mergedPath = join(dir, 'merged.json')
    const baselinePath = join(dir, 'baseline.json')
    writeFileSync(mergedPath, JSON.stringify(merged))
    writeFileSync(baselinePath, JSON.stringify(baselineReport))

    const classify = (path: string) =>
      classifyReportFile(fixtureConfig, path, {reporters: ['json'], resolvedJsonReportPath: path})
    const fromMerged = classify(mergedPath)
    const fromBaseline = classify(baselinePath)
    expect(fromMerged.verdict).toBe('clean')
    expect(fromMerged).toEqual({...fromBaseline, mutants: fromBaseline.mutants})

    const printed = (result: ClassificationResult): string => {
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      try {
        printResult(result)
        return write.mock.calls.map(call => String(call[0])).join('')
      } finally {
        write.mockRestore()
      }
    }
    expect(printed(fromMerged)).toBe(printed(fromBaseline))
    expect(Object.keys(merged.files as object).toSorted()).toEqual(Object.keys(baselineReport.files).toSorted())
  })
})

describe('defaultMergeDeps', () => {
  it('reads the repository lists, the repository config and the configured report path', () => {
    const deps = defaultMergeDeps()
    expect(deps.readShards()).toEqual(readMutationShards())
    expect(deps.readConfig()).toEqual(readStrykerConfig(strykerConfigPath()))
    expect(deps.reportPath()).toBe(mutationReportPath())
  })

  it('classifies through the single-run seam, against the configured reporter paths', () => {
    const dir = mkdtempSync(join(root, 'default-classify-'))
    const missing = join(dir, 'nope.json')
    const tiny: StrykerConfigShape = {mutate: [], testFiles: [], reporters: ['json'], jsonReportFileName: 'r.json'}
    const result = defaultMergeDeps().classify(tiny, missing)
    expect(result).toEqual(classifyReportFile(tiny, missing))
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.some(m => m.status === 'RuntimeError')).toBe(true)
  })
})
