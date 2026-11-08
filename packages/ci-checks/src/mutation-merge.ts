import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

import {isRecord} from '@fro-bot/core/guards'
import {
  classifyReportFile,
  isLiteralPath,
  mutationReportPath,
  readStrykerConfig,
  strykerConfigPath,
  triggerGateSentinel,
  type ClassificationResult,
  type LocatedMutant,
  type StrykerConfigShape,
} from './check-mutation-guards.ts'
import {normalizePath} from './mutation-guards-reach.ts'
import {findShardPartitionViolations, mutationShardCount, readMutationShards} from './mutation-shard-lists.ts'
import {
  describeEnvValue,
  parseShardManifest,
  shardArtifactName,
  shardManifestFileName,
  shardReportFileName,
  type ShardManifest,
} from './mutation-shard.ts'

/**
 * The final job of the PR mutation gate: checks the shard artifacts, merges the reports and classifies the merge against
 * the full config with `classifyReportFile`. A failed check ends the run as `instrumentation-failed` with a fixed status
 * and the shard involved (`mutation-shard-<n>` as the located file); no merged report is classified then. In order:
 *
 *  1. the three job results (`MUTATION_SHARD_1..3_RESULT`) are exactly `success`, checked before anything else is read;
 *  2. the shard lists are an exact partition of `mutate` into three;
 *  3. every `mutation-shard-<n>` directory exists;
 *  4. every manifest is valid and names its directory's shard;
 *  5. every manifest's `HEAD` and event SHA equal the pull request head SHA;
 *  6. the shards agree on applicability (all not-applicable is a not-applicable result);
 *  7. every report is parseable and has `files` and `testFiles` maps;
 *  8. no entry is in two reports;
 *  9. every report's `files` keys are exactly its list;
 * 10. every configured literal test file has tests in every report.
 */

export interface MergeInput {
  readonly artifactDir: string
  readonly eventSha: string
}

export type MergeEnvParse =
  {readonly ok: true; readonly input: MergeInput} | {readonly ok: false; readonly message: string}

export type MergeOutcome =
  {readonly kind: 'usage'; readonly message: string} | {readonly kind: 'result'; readonly result: ClassificationResult}

/** The effects of a merge run. */
export interface MergeDeps {
  readonly readShards: () => readonly (readonly string[])[]
  readonly readConfig: () => StrykerConfigShape
  /** Where the merged report is written and classified from. */
  readonly reportPath: () => string
  readonly classify: (config: StrykerConfigShape, reportPath: string) => ClassificationResult
}

/** A parsed shard report: a JSON object with a `files` map and a `testFiles` map, every other field as written. */
export type ShardReportJson = Readonly<Record<string, unknown>> & {
  readonly files: Readonly<Record<string, unknown>>
  readonly testFiles: Readonly<Record<string, unknown>>
}

/** Reads `MUTATION_ARTIFACT_DIR` (non-empty) and `MUTATION_EVENT_SHA` (40 lowercase hex); reports the first that is wrong. */
export function parseMergeEnv(env: Readonly<Record<string, string | undefined>>): MergeEnvParse {
  const artifactDir = env.MUTATION_ARTIFACT_DIR
  if (artifactDir === undefined || artifactDir === '') {
    return {ok: false, message: `MUTATION_ARTIFACT_DIR must be set (got ${describeEnvValue(artifactDir)})`}
  }
  const eventSha = env.MUTATION_EVENT_SHA
  if (!/^[0-9a-f]{40}$/u.test(String(eventSha))) {
    return {
      ok: false,
      message: `MUTATION_EVENT_SHA must be a 40-character lowercase hex commit SHA (got ${describeEnvValue(eventSha)})`,
    }
  }
  return {ok: true, input: {artifactDir, eventSha: String(eventSha)}}
}

function describeShards(shards: readonly number[]): string {
  if (shards.length === 1) return `shard ${String(shards[0])}`
  return `shards ${shards.slice(0, -1).join(', ')} and ${String(shards.at(-1))}`
}

function locatedFailure(file: string, mutator: string, status: string, reason: string): LocatedMutant {
  return {file, line: 0, col: 0, mutator, status, reason}
}

function shardFailure(shard: number, status: string, reason: string): LocatedMutant {
  return locatedFailure(shardArtifactName(shard), 'shard-merge', status, reason)
}

function failed(mutants: readonly LocatedMutant[]): MergeOutcome {
  return {kind: 'result', result: {verdict: 'instrumentation-failed', mutants}}
}

type JsonRead = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly message: string}

function readJsonFile(path: string): JsonRead {
  try {
    return {ok: true, value: JSON.parse(readFileSync(path).toString()) as unknown}
  } catch (error) {
    // A JSON.parse message quotes the file, so only a fixed phrase or the fs error code is reported.
    const code = (error as {code?: unknown}).code
    return {ok: false, message: error instanceof SyntaxError ? 'invalid JSON' : String(code)}
  }
}

function isDirectory(path: string): boolean {
  return statSync(path, {throwIfNoEntry: false})?.isDirectory() === true
}

function isShardReport(value: unknown): value is ShardReportJson {
  return isRecord(value) && isRecord(value.files) && isRecord(value.testFiles)
}

function testCount(entry: unknown): number {
  return isRecord(entry) && Array.isArray(entry.tests) ? entry.tests.length : 0
}

/** A report's `files` keys, with a single leading `./` stripped. */
function fileKeys(report: ShardReportJson): string[] {
  return Object.keys(report.files).map(normalizePath)
}

function qualifyId(shard: number, id: unknown): string {
  return `s${String(shard)}:${String(id)}`
}

function qualifyMutant(shard: number, mutant: unknown): unknown {
  if (!isRecord(mutant)) return mutant
  const qualified = ['killedBy', 'coveredBy']
    .filter(key => Array.isArray(mutant[key]))
    .map(key => [key, (mutant[key] as unknown[]).map(id => qualifyId(shard, id))])
  return {...mutant, ...Object.fromEntries(qualified)}
}

function qualifiedFileEntry(shard: number, entry: unknown): unknown {
  if (!isRecord(entry) || !Array.isArray(entry.mutants)) return entry
  return {...entry, mutants: entry.mutants.map(mutant => qualifyMutant(shard, mutant))}
}

function qualifiedTests(shard: number, entry: unknown): unknown[] {
  const tests: unknown[] = isRecord(entry) && Array.isArray(entry.tests) ? entry.tests : []
  return tests.map(test => (isRecord(test) ? {...test, id: qualifyId(shard, test.id)} : test))
}

/**
 * Merges shard reports; report `i` is shard `i + 1`. Stryker numbers test ids per run, so every test id is rewritten to
 * `s<shard>:<id>`, in the `testFiles` definitions and in the mutants' `killedBy` and `coveredBy`. `files` is the union
 * (the caller has checked that no entry is in two). Each test file's `tests` is the union of all shards' qualified
 * definitions, and its other fields come from the first shard that has it. Other top-level fields come from the first
 * report; `config.mutate` is `lists` flattened.
 */
export function mergeShardReports(
  reports: readonly ShardReportJson[],
  lists: readonly (readonly string[])[],
): Record<string, unknown> {
  const top: Record<string, unknown> = Object.fromEntries(
    reports.toReversed().flatMap(report => Object.entries(report)),
  )
  const files = Object.fromEntries(
    reports.flatMap((report, index) =>
      Object.entries(report.files).map(([file, entry]) => [file, qualifiedFileEntry(index + 1, entry)]),
    ),
  )

  const byFile = new Map<string, {readonly entry: unknown; readonly tests: readonly unknown[]}>()
  for (const [index, report] of reports.entries()) {
    for (const [file, entry] of Object.entries(report.testFiles)) {
      const tests = qualifiedTests(index + 1, entry)
      const current = byFile.get(file)
      byFile.set(file, {entry: current?.entry ?? entry, tests: [...(current?.tests ?? []), ...tests]})
    }
  }
  const testFiles = Object.fromEntries(
    [...byFile].map(([file, {entry, tests}]) => [file, {...(isRecord(entry) ? entry : {}), tests}]),
  )

  const config = top.config as Record<string, unknown> | undefined
  return {...top, config: {...config, mutate: lists.flat()}, files, testFiles}
}

/**
 * Runs the final job and returns what the CLI prints. A usage error is the only non-result outcome; an unreadable config
 * or list throws. The merged report is written to the configured report path, which `main.yaml` uploads, and classified
 * from there.
 */
export function runMutationMerge(env: Readonly<Record<string, string | undefined>>, deps: MergeDeps): MergeOutcome {
  const parsed = parseMergeEnv(env)
  if (!parsed.ok) return {kind: 'usage', message: parsed.message}
  const {artifactDir, eventSha} = parsed.input

  // First and on their own: an empty or miscounted list cannot hide a failed job.
  const resultFailures = Array.from({length: mutationShardCount()}, (_, index) => index + 1)
    .filter(shard => env[`MUTATION_SHARD_${String(shard)}_RESULT`] !== 'success')
    .map(shard =>
      shardFailure(
        shard,
        'ShardResultNotSuccess',
        `the job result is ${describeEnvValue(env[`MUTATION_SHARD_${String(shard)}_RESULT`])}, not "success"`,
      ),
    )
  if (resultFailures.length > 0) return failed(resultFailures)

  const lists = deps.readShards()
  const config = deps.readConfig()
  const partitionViolations = findShardPartitionViolations(config.mutate, lists)
  if (partitionViolations.length > 0) {
    return failed([
      locatedFailure(
        'mutation-guards.json',
        'shard-merge',
        'ShardListsInvalid',
        `the shard lists are not a partition of the mutate list: ${partitionViolations.join('; ')}`,
      ),
    ])
  }
  const shards = lists.map((list, index) => ({shard: index + 1, list}))

  const shardDirectory = (shard: number): string => join(artifactDir, shardArtifactName(shard))
  const missingDirectories = shards
    .filter(({shard}) => !isDirectory(shardDirectory(shard)))
    .map(({shard}) =>
      shardFailure(
        shard,
        'ShardArtifactMissing',
        `no ${shardArtifactName(shard)} directory in the downloaded artifacts`,
      ),
    )
  if (missingDirectories.length > 0) return failed(missingDirectories)

  const manifestFailures: LocatedMutant[] = []
  const loaded: {readonly shard: number; readonly list: readonly string[]; readonly manifest: ShardManifest}[] = []
  for (const {shard, list} of shards) {
    const read = readJsonFile(join(shardDirectory(shard), shardManifestFileName()))
    if (!read.ok) {
      manifestFailures.push(
        shardFailure(shard, 'ShardManifestUnreadable', `${shardManifestFileName()} could not be read: ${read.message}`),
      )
      continue
    }
    const manifest = parseShardManifest(read.value)
    if (manifest === undefined) {
      manifestFailures.push(
        shardFailure(shard, 'ShardManifestUnreadable', `${shardManifestFileName()} is not a valid shard manifest`),
      )
    } else if (manifest.shard === shard) {
      loaded.push({shard, list, manifest})
    } else {
      manifestFailures.push(
        shardFailure(
          shard,
          'ShardManifestMismatch',
          `${shardManifestFileName()} says shard ${String(manifest.shard)}, not shard ${String(shard)}`,
        ),
      )
    }
  }
  if (manifestFailures.length > 0) return failed(manifestFailures)

  const commitFailures = loaded
    .filter(({manifest}) => manifest.head !== eventSha || manifest.eventSha !== eventSha)
    .map(({shard, manifest}) =>
      shardFailure(
        shard,
        'ShardCommitMismatch',
        `HEAD ${manifest.head} and event SHA ${manifest.eventSha} must both equal the pull request head ${eventSha}`,
      ),
    )
  if (commitFailures.length > 0) return failed(commitFailures)

  const applicable = loaded.filter(({manifest}) => manifest.applicability === 'applicable').map(({shard}) => shard)
  const notApplicable = loaded
    .filter(({manifest}) => manifest.applicability === 'not-applicable')
    .map(({shard}) => shard)
  if (applicable.length === 0) {
    return {
      kind: 'result',
      result: triggerGateSentinel(
        'not-applicable',
        'NotApplicable',
        `all ${String(loaded.length)} shards found no changed file in the trigger set; nothing to check`,
      ),
    }
  }
  if (notApplicable.length > 0) {
    return failed(
      loaded.map(({shard, manifest}) =>
        shardFailure(
          shard,
          'ShardApplicabilityMismatch',
          `applicability is "${manifest.applicability}"; applicable: ${describeShards(applicable)}; not-applicable: ${describeShards(notApplicable)}`,
        ),
      ),
    )
  }

  const reportFailures: LocatedMutant[] = []
  const reports: {readonly shard: number; readonly list: readonly string[]; readonly report: ShardReportJson}[] = []
  for (const {shard, list} of loaded) {
    const read = readJsonFile(join(shardDirectory(shard), shardReportFileName()))
    if (!read.ok) {
      reportFailures.push(
        shardFailure(shard, 'ShardReportUnreadable', `${shardReportFileName()} could not be read: ${read.message}`),
      )
    } else if (isShardReport(read.value)) {
      reports.push({shard, list, report: read.value})
    } else {
      reportFailures.push(
        shardFailure(
          shard,
          'ShardReportUnreadable',
          `${shardReportFileName()} is not a JSON object with files and testFiles maps`,
        ),
      )
    }
  }
  if (reportFailures.length > 0) return failed(reportFailures)

  // Before the exact-keys check, so an entry in two reports is named as an overlap.
  const owners = new Map<string, number[]>()
  for (const {shard, report} of reports) {
    for (const key of fileKeys(report)) owners.set(key, [...(owners.get(key) ?? []), shard])
  }
  const overlapFailures = [...owners]
    .filter(([, shardsWithKey]) => shardsWithKey.length > 1)
    .flatMap(([key, shardsWithKey]) =>
      shardsWithKey.map(shard =>
        shardFailure(shard, 'ShardFilesOverlap', `${key} is in the reports of ${describeShards(shardsWithKey)}`),
      ),
    )
  if (overlapFailures.length > 0) return failed(overlapFailures)

  const keyFailures: LocatedMutant[] = []
  for (const {shard, list, report} of reports) {
    const expected = list.map(normalizePath)
    const keys = fileKeys(report)
    const missing = expected.filter(entry => !keys.includes(entry))
    const unexpected = keys.filter(key => !expected.includes(key))
    const differences = [
      ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
      ...(unexpected.length > 0 ? [`unexpected ${unexpected.join(', ')}`] : []),
    ]
    if (differences.length > 0) {
      keyFailures.push(
        shardFailure(shard, 'ShardFilesMismatch', `files keys differ from the shard list: ${differences.join('; ')}`),
      )
    }
  }
  if (keyFailures.length > 0) return failed(keyFailures)

  const testCounts = reports.map(({shard, report}) => ({
    shard,
    counts: new Map(Object.entries(report.testFiles).map(([key, entry]) => [normalizePath(key), testCount(entry)])),
  }))
  const testFileFailures: LocatedMutant[] = []
  for (const testFile of config.testFiles.filter(isLiteralPath).map(normalizePath)) {
    const idle = testCounts.filter(({counts}) => (counts.get(testFile) ?? 0) === 0).map(({shard}) => shard)
    if (idle.length > 0) {
      testFileFailures.push(
        locatedFailure(
          testFile,
          'vitest-config',
          'TestFileNotExecuted',
          `${describeShards(idle)} ran no tests from this configured test file`,
        ),
      )
    }
  }
  if (testFileFailures.length > 0) return failed(testFileFailures)

  const merged = mergeShardReports(
    reports.map(({report}) => report),
    lists,
  )
  const reportPath = deps.reportPath()
  mkdirSync(dirname(reportPath), {recursive: true})
  writeFileSync(reportPath, JSON.stringify(merged))
  return {kind: 'result', result: deps.classify(config, reportPath)}
}

/** The real effects. */
export function defaultMergeDeps(): MergeDeps {
  return {
    readShards: () => readMutationShards(),
    readConfig: () => readStrykerConfig(strykerConfigPath()),
    reportPath: () => mutationReportPath(),
    classify: (config, reportPath) => classifyReportFile(config, reportPath),
  }
}
