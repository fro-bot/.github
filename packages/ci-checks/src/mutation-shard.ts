import {execFileSync} from 'node:child_process'
import {copyFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {isRecord} from '@fro-bot/core/guards'
import {
  defaultStrykerSpawner,
  evaluateTriggerGate,
  mutationReportPath,
  readMutationReport,
  readStrykerConfig,
  strykerConfigPath,
  type ClassificationResult,
  type StrykerConfigShape,
} from './check-mutation-guards.ts'
import {readMutationShards} from './mutation-shard-lists.ts'
import {findRepositoryRoot} from './repository-root.ts'

/**
 * One shard of the PR mutation gate. It decides applicability from the FULL Stryker config, then writes a
 * not-applicable manifest or runs Stryker on its list (`--mutate` only, so `testFiles` stay whole) and writes the
 * manifest and the report.
 *
 * Output directory, uploaded as `mutation-shard-<n>`: `manifest.json` (a `ShardManifest`) and, when applicable,
 * `mutation.json` (Stryker's report, copied as written). `mutation-merge.ts` reads the directory together with the shard
 * lists and the Stryker config.
 *
 * A shard fails (non-zero) only on infrastructure: a gate result other than applicable or `not-applicable`, a spawn that
 * threw, or a missing or unreadable report. Stryker's exit code and the mutant statuses are the merge step's verdict.
 */

/** The shard's applicability for this pull request, as decided from the full config. */
export type ShardApplicability = 'applicable' | 'not-applicable'

export interface ShardManifest {
  /** One-based shard number. */
  readonly shard: number
  /** `git rev-parse HEAD` in the shard's checkout. */
  readonly head: string
  /** The pull request head SHA the workflow gave the shard. */
  readonly eventSha: string
  readonly applicability: ShardApplicability
}

export interface ShardInput {
  readonly shard: number
  readonly eventSha: string
  readonly outputDir: string
}

export type ShardEnvParse =
  {readonly ok: true; readonly input: ShardInput} | {readonly ok: false; readonly message: string}

export type ShardResult =
  | {readonly kind: 'written'; readonly manifest: ShardManifest}
  | {readonly kind: 'usage'; readonly message: string}
  | {readonly kind: 'failed'; readonly reason: string}

/** The effects of a shard run. */
export interface ShardDeps {
  readonly readShards: () => readonly (readonly string[])[]
  readonly readConfig: () => StrykerConfigShape
  readonly evaluateGate: (config: StrykerConfigShape) => Promise<ClassificationResult | undefined>
  readonly readHead: () => string
  readonly reportPath: () => string
  readonly spawn: (extraArgs: readonly string[]) => void
}

/** The artifact name of shard `shard`; the merge step finds the shard's directory by it. */
export function shardArtifactName(shard: number): string {
  return `mutation-shard-${String(shard)}`
}

export function shardManifestFileName(): string {
  return 'manifest.json'
}

export function shardReportFileName(): string {
  return 'mutation.json'
}

/** An environment value for a message: `unset`, or the value quoted. */
export function describeEnvValue(value: string | undefined): string {
  return value === undefined ? 'unset' : JSON.stringify(value)
}

/**
 * Reads `MUTATION_SHARD` (positive integer), `MUTATION_SHARD_EVENT_SHA` (40 lowercase hex) and
 * `MUTATION_SHARD_OUTPUT_DIR` (non-empty); reports the first that is wrong. The shard number is checked against the
 * lists later.
 */
export function parseShardEnv(env: Readonly<Record<string, string | undefined>>): ShardEnvParse {
  // `String(...)` turns an unset variable into the text "undefined", which neither pattern matches, so no separate
  // unset branch is needed (one would be an equivalent mutant).
  const shardText = env.MUTATION_SHARD
  if (!/^[1-9]\d*$/u.test(String(shardText))) {
    return {ok: false, message: `MUTATION_SHARD must be a positive integer (got ${describeEnvValue(shardText)})`}
  }
  const eventSha = env.MUTATION_SHARD_EVENT_SHA
  if (!/^[0-9a-f]{40}$/u.test(String(eventSha))) {
    return {
      ok: false,
      message: `MUTATION_SHARD_EVENT_SHA must be a 40-character lowercase hex commit SHA (got ${describeEnvValue(eventSha)})`,
    }
  }
  const outputDir = env.MUTATION_SHARD_OUTPUT_DIR
  if (outputDir === undefined || outputDir === '') {
    return {ok: false, message: `MUTATION_SHARD_OUTPUT_DIR must be set (got ${describeEnvValue(outputDir)})`}
  }
  return {ok: true, input: {shard: Number(shardText), eventSha: String(eventSha), outputDir}}
}

/** A manifest read back from disk, or `undefined` when it is not exactly the four-field shape a shard writes. */
export function parseShardManifest(value: unknown): ShardManifest | undefined {
  if (!isRecord(value)) return undefined
  const {shard, head, eventSha, applicability} = value
  if (Object.keys(value).length !== 4) return undefined
  // `Number.isInteger` is false for anything that is not a number, so no separate `typeof` test is needed for `shard`.
  if (!Number.isInteger(shard) || Number(shard) < 1) return undefined
  if (typeof head !== 'string' || typeof eventSha !== 'string') return undefined
  if (applicability !== 'applicable' && applicability !== 'not-applicable') return undefined
  return {shard: Number(shard), head, eventSha, applicability}
}

function describeGateResult(result: ClassificationResult): string {
  const first = result.mutants[0]
  if (first === undefined) return `the trigger gate returned ${result.verdict}`
  const detail = first.reason === undefined ? '' : `: ${first.reason}`
  return `the trigger gate returned ${result.verdict} (${first.status})${detail}`
}

function writeManifest(outputDir: string, manifest: ShardManifest): void {
  writeFileSync(join(outputDir, shardManifestFileName()), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Runs one shard and returns the outcome; the CLI prints. Nothing is written on a usage error or a failure, and a stale
 * manifest or report in `outputDir` is removed before new ones are written.
 */
export async function runMutationShard(
  env: Readonly<Record<string, string | undefined>>,
  deps: ShardDeps,
): Promise<ShardResult> {
  const parsed = parseShardEnv(env)
  if (!parsed.ok) return {kind: 'usage', message: parsed.message}
  const {shard, eventSha, outputDir} = parsed.input

  try {
    const shards = deps.readShards()
    const list = shards[shard - 1]
    if (list === undefined) {
      return {kind: 'usage', message: `MUTATION_SHARD must be one of 1-${String(shards.length)} (got ${String(shard)})`}
    }

    // The full config, not the shard's subset: every shard reaches the same applicability.
    const config = deps.readConfig()
    const gate = await deps.evaluateGate(config)
    if (gate !== undefined && gate.verdict !== 'not-applicable') {
      return {kind: 'failed', reason: describeGateResult(gate)}
    }

    const head = deps.readHead()
    const manifest: ShardManifest = {
      shard,
      head,
      eventSha,
      applicability: gate === undefined ? 'applicable' : 'not-applicable',
    }

    if (gate !== undefined) {
      mkdirSync(outputDir, {recursive: true})
      rmSync(join(outputDir, shardManifestFileName()), {force: true})
      rmSync(join(outputDir, shardReportFileName()), {force: true})
      writeManifest(outputDir, manifest)
      return {kind: 'written', manifest}
    }

    // Cleared first, so a Stryker that dies before writing leaves no earlier report to copy.
    const reportPath = deps.reportPath()
    rmSync(reportPath, {force: true})
    deps.spawn(['--mutate', list.join(',')])

    const report = readMutationReport(reportPath)
    if (report.readError !== undefined) {
      return {kind: 'failed', reason: `could not read the Stryker report ${reportPath}: ${report.readError}`}
    }
    if (!isRecord(report.json)) {
      return {kind: 'failed', reason: `the Stryker report ${reportPath} is not a JSON object`}
    }

    mkdirSync(outputDir, {recursive: true})
    rmSync(join(outputDir, shardManifestFileName()), {force: true})
    copyFileSync(reportPath, join(outputDir, shardReportFileName()))
    writeManifest(outputDir, manifest)
    return {kind: 'written', manifest}
  } catch (error) {
    return {kind: 'failed', reason: error instanceof Error ? error.message : String(error)}
  }
}

/** The real effects. */
export function defaultShardDeps(): ShardDeps {
  return {
    readShards: () => readMutationShards(),
    readConfig: () => readStrykerConfig(strykerConfigPath()),
    evaluateGate: async config => evaluateTriggerGate(config),
    readHead: () => execFileSync('git', ['rev-parse', 'HEAD'], {cwd: findRepositoryRoot(), encoding: 'utf8'}).trim(),
    reportPath: () => mutationReportPath(),
    spawn: extraArgs => {
      defaultStrykerSpawner(extraArgs)
    },
  }
}
