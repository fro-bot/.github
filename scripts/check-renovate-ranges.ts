import {readFile} from 'node:fs/promises'
import process from 'node:process'

import {loadRenovateRuntime, readPinnedVersion, resolvePrefix} from './renovate-runtime.ts'

/**
 * Statically checks every `allowedVersions` value in a set of Renovate configs.
 *
 * `renovate-config-validator` validates option names and shapes, but it never evaluates an
 * `allowedVersions` string: `"<=3.13 || not-a-range(("` passes `--strict --no-global` with exit 0.
 * Renovate only evaluates the value at lookup time (`lookup/filter.ts`), where an unparseable value
 * throws `CONFIG_VALIDATION` and fails the whole repository run for every consumer of a shared preset.
 *
 * This mirrors the branch order in Renovate 44's `filterVersions`, using Renovate's own versioning
 * API (loaded from the pinned scratch install, see renovate-runtime.ts) rather than a
 * re-implementation:
 *
 *   1. Template compile. A value containing `{{` is expanded with per-dependency data before
 *      anything else happens, so it cannot be judged statically. It is reported as skipped, never
 *      silently passed.
 *   2. `getRegexPredicate(value)`: `/.../` and `!/.../` forms. A regex Renovate cannot compile
 *      yields no predicate and falls through to the next branches, where it fails.
 *   3. `versioning.isValid(value)` for the rule's `versioning`.
 *   4. raw `semver.validRange(value)` as a last-resort npm syntax fallback, for every versioning.
 *      It is the `semver` package from the same scratch install, called without the legacy-x-range
 *      normalization the npm versioning applies in step 3: `1.x.5` is valid for `npm` but not here.
 *   5. Otherwise Renovate throws. This script reports the rule instead.
 *
 * Deliberate divergence: when a rule sets no `versioning`, Renovate's runtime default depends on the
 * manager and datasource, and the global fallback is `semver-coerced`, whose `isValid` accepts
 * everything (it coerces garbage to a version). Judging against that would make this check vacuous,
 * so a rule without `versioning` is judged as `npm`. A value that is valid for the manager's real
 * versioning but not for npm semver must therefore declare that `versioning` on the rule.
 */

const DEFAULT_VERSIONING = 'npm'
const ALLOWED_VERSIONS_KEY = 'allowedVersions'
const VERSIONING_KEY = 'versioning'
const RULE_LABEL_MAX_LENGTH = 80

/**
 * The slice of Renovate this check needs. Real implementation: `loadRenovateRuntime`. Tests inject a
 * fake, so unit tests need neither the network nor a Renovate install.
 */
export interface VersioningEngine {
  /** Whether Renovate has a versioning of this name (the part before any `:`). */
  readonly isKnownVersioning: (spec: string) => boolean
  /** Whether `getRegexPredicate(value)` yields a predicate (`/.../` or `!/.../` that compiles). */
  readonly hasRegexPredicate: (value: string) => boolean
  /** `versioning.get(spec).isValid(value)`. */
  readonly isValid: (spec: string, value: string) => boolean
  /** Raw `semver.validRange(value) !== null`, the fallback `filterVersions` tries after `isValid`. */
  readonly isValidSemverRange: (value: string) => boolean
}

export const DEFAULT_CONFIG_FILES = ['default.json', '.github/renovate.json5'] as const

export interface AllowedVersionsEntry {
  /** File path or preset ref the value came from. */
  readonly source: string
  /** JSON path of the owning object, for example `$.packageRules[2]`. */
  readonly location: string
  /** Human-readable rule identity (description or matchers), empty when none exists. */
  readonly rule: string
  readonly value: unknown
  /** The `versioning` in effect for the owning object; `undefined` when no enclosing object sets one. */
  readonly versioning: string | undefined
}

export type RangeVerdict =
  | {readonly kind: 'valid'; readonly via: 'regex' | 'versioning' | 'semver-fallback'}
  | {readonly kind: 'templated'}
  | {readonly kind: 'invalid'; readonly reason: string}

export interface ConfigSource {
  readonly source: string
  readonly config: unknown
}

export interface RangeProblem {
  readonly entry: AllowedVersionsEntry
  readonly reason: string
}

export interface RangeSkip {
  readonly entry: AllowedVersionsEntry
  readonly reason: string
}

export interface RangeCheckResult {
  readonly ok: boolean
  readonly checked: number
  readonly problems: readonly RangeProblem[]
  readonly skipped: readonly RangeSkip[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return []
}

function truncate(text: string): string {
  return text.length > RULE_LABEL_MAX_LENGTH ? `${text.slice(0, RULE_LABEL_MAX_LENGTH - 1)}…` : text
}

/** Identifies a rule by its first description line, else by its package matchers. */
function describeRule(node: Record<string, unknown>): string {
  const [description] = stringList(node.description)
  if (description !== undefined) return truncate(description)
  for (const key of ['matchPackageNames', 'matchDepNames', 'matchSourceUrls', 'matchDatasources']) {
    const values = stringList(node[key])
    if (values.length > 0) return truncate(`${key}: ${values.join(', ')}`)
  }
  return ''
}

/**
 * Collects every `allowedVersions` key at any depth, so rules nested under other options are not
 * missed. `versioning` is inherited from the nearest enclosing object that declares one, matching
 * how Renovate merges a rule over its parent config.
 */
export function collectAllowedVersions(config: unknown, source: string): AllowedVersionsEntry[] {
  const entries: AllowedVersionsEntry[] = []

  function walk(node: unknown, location: string, inheritedVersioning: string | undefined): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, `${location}[${index}]`, inheritedVersioning)
      })
      return
    }
    if (!isRecord(node)) return

    const declared = node[VERSIONING_KEY]
    const versioning = typeof declared === 'string' ? declared : inheritedVersioning

    for (const [key, value] of Object.entries(node)) {
      if (key === ALLOWED_VERSIONS_KEY) {
        entries.push({source, location, rule: describeRule(node), value, versioning})
      } else {
        walk(value, `${location}.${key}`, versioning)
      }
    }
  }

  walk(config, '$', undefined)
  return entries
}

/** Judges one `allowedVersions` value the way Renovate's `filterVersions` would parse it. */
export function checkAllowedVersion(entry: AllowedVersionsEntry, engine: VersioningEngine): RangeVerdict {
  const {value} = entry
  if (typeof value !== 'string') {
    return {kind: 'invalid', reason: `must be a string, got ${Array.isArray(value) ? 'array' : typeof value}`}
  }
  if (value.includes('{{')) return {kind: 'templated'}

  const versioningSpec = entry.versioning ?? DEFAULT_VERSIONING
  // Renovate silently falls back to `semver-coerced` for an unknown name, which would make every
  // value "valid". A typo in `versioning` must fail here instead.
  if (!engine.isKnownVersioning(versioningSpec)) {
    return {kind: 'invalid', reason: `unknown versioning ${JSON.stringify(versioningSpec)}`}
  }

  if (engine.hasRegexPredicate(value)) return {kind: 'valid', via: 'regex'}

  try {
    if (engine.isValid(versioningSpec, value)) return {kind: 'valid', via: 'versioning'}
    if (engine.isValidSemverRange(value)) return {kind: 'valid', via: 'semver-fallback'}
  } catch (error) {
    return {kind: 'invalid', reason: `versioning ${JSON.stringify(versioningSpec)} failed: ${errorMessage(error)}`}
  }

  return {
    kind: 'invalid',
    reason: `does not parse as a valid version or range with versioning=${JSON.stringify(versioningSpec)}`,
  }
}

export function checkRenovateRanges(sources: readonly ConfigSource[], engine: VersioningEngine): RangeCheckResult {
  const problems: RangeProblem[] = []
  const skipped: RangeSkip[] = []
  let checked = 0

  for (const {source, config} of sources) {
    for (const entry of collectAllowedVersions(config, source)) {
      checked += 1
      const verdict = checkAllowedVersion(entry, engine)
      if (verdict.kind === 'invalid') problems.push({entry, reason: verdict.reason})
      if (verdict.kind === 'templated') {
        skipped.push({entry, reason: 'templated value is expanded per dependency and cannot be checked statically'})
      }
    }
  }

  return {ok: problems.length === 0, checked, problems, skipped}
}

export function formatRangeFinding(finding: RangeProblem | RangeSkip): string {
  const {entry, reason} = finding
  const rule = entry.rule === '' ? '' : ` (${entry.rule})`
  return `${entry.source} ${entry.location}${rule}: allowedVersions ${JSON.stringify(entry.value)}: ${reason}`
}

export async function readConfigSources(
  paths: readonly string[],
  parseConfig: (text: string) => unknown,
  readText: (path: string) => Promise<string> = async path => readFile(path, 'utf8'),
): Promise<ConfigSource[]> {
  const sources: ConfigSource[] = []
  for (const path of paths) {
    // JSON5 is a superset of JSON, so one parser covers `default.json` and `renovate.json5`.
    sources.push({source: path, config: parseConfig(await readText(path))})
  }
  return sources
}

export function reportRangeCheck(result: RangeCheckResult): void {
  for (const skip of result.skipped) {
    process.stderr.write(`check-renovate-ranges: SKIPPED ${formatRangeFinding(skip)}\n`)
  }
  for (const problem of result.problems) {
    process.stderr.write(`check-renovate-ranges: ${formatRangeFinding(problem)}\n`)
  }
  if (result.ok) {
    process.stdout.write(
      `check-renovate-ranges: ${result.checked} allowedVersions value(s) checked, ${result.skipped.length} skipped\n`,
    )
  }
}

export async function main(paths: readonly string[] = DEFAULT_CONFIG_FILES): Promise<void> {
  let result: RangeCheckResult
  try {
    const version = await readPinnedVersion(process.cwd())
    const runtime = await loadRenovateRuntime(resolvePrefix(version), version)
    result = checkRenovateRanges(await readConfigSources(paths, runtime.parseConfig), runtime.versioning)
  } catch (error) {
    process.stderr.write(`check-renovate-ranges: ${errorMessage(error)}\n`)
    process.exitCode = 1
    return
  }
  reportRangeCheck(result)
  if (!result.ok) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argumentPaths = process.argv.slice(2)
  await main(argumentPaths.length > 0 ? argumentPaths : DEFAULT_CONFIG_FILES)
}
