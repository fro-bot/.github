import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'

/**
 * Verifies that every version an `overrides` entry in `pnpm-workspace.yaml` could resolve to is
 * covered by a patched region of its advisory's `patched_versions`, and that every advisory at
 * or above `DEFAULT_SEVERITY_THRESHOLD` has an override entry at all.
 *
 * `dependency-review.yaml` scans only manifest files that change in a pull request, so a
 * vulnerable transitive dependency already resting in the lockfile is invisible to it. Nothing
 * else in CI reads the standing lockfile.
 *
 * Advisories come from `pnpm audit --json`. Anything this script cannot interpret is a FAILURE,
 * not a skip: non-JSON output, missing `metadata.vulnerabilities`/`advisories`, an unreadable
 * workspace file, an advisory missing required fields, an unknown severity, or a range whose
 * comparator groups don't resolve cleanly (see below). `pnpm audit` exits non-zero whenever any
 * advisory exists, so exit status alone is not the failure signal — unparseable output is.
 *
 * Threshold defaults to `high`. A `moderate` default would fail on `@humanfs/node`, an open
 * advisory this repo is deliberately not remediating on this gate's schedule.
 *
 * BOTH an `overrides` entry and an advisory's `patched_versions` are parsed by the SAME function,
 * `parseRangeGroups`, into a set of `||`-separated half-open intervals `[lo, hi)` (`hi` undefined
 * means unbounded above). The question this script asks is interval coverage
 * (`overrideCoveredByPatched`): is EVERY version the override could resolve to covered by SOME
 * patched interval? This script has arrived here after two narrower, and wrong, formulations of
 * that question — each one reduced a range to a single point and lost what the range actually
 * described:
 *
 *   1. Reducing `patched_versions` to "is the floor above SOME point in the range" false-
 *      positived on a safe compound range (`>=4.17.21` against `>=4.17.21 <5.0.0`).
 *   2. Reducing `patched_versions` to its lowest lower bound false-negatived on a floor sitting
 *      in the unpatched gap of a disjoint range (`>=2.0.0` against `>=1.2.3 <2.0.0 || >=2.1.0`
 *      admits the gap `[2.0.0, 2.1.0)`).
 *   3. Reducing the OVERRIDE side to its own floor (ignoring any ceiling it declares, and
 *      treating an unbounded override as just "a point") false-negatived on an override with an
 *      unpatched tail above a bounded patched range (`>=1.2.3 <5.0.0` against `>=1.2.3 <2.0.0`
 *      admits `[2.0.0, 5.0.0)` unpatched; `>=4.17.21` — unbounded — against
 *      `>=4.17.21 <5.0.0 || >=5.0.3` admits the gap `[5.0.0, 5.0.3)`).
 *
 * There is no `parseRangeFloor`/single-point collapse left in this file. A reduced-form parser
 * sitting beside the correct interval-based one is exactly how this bug propagated three times;
 * every comparison here goes through intervals end to end. An unbounded override interval is
 * only covered if some patched interval is ALSO unbounded above and starts at or below the
 * override's lower bound — this is not special-cased away, it falls out of the coverage
 * algorithm (`isCoveredByUnion`) directly.
 *
 * `patched_versions` of exactly `<0.0.0` is the npm advisory convention for "no fix has been
 * published yet" — not a malformed range — and is classified as its own `no-fix-available`
 * problem kind with an accurate message, checked before general range parsing so it never falls
 * through to a generic "could not be interpreted" failure.
 *
 * An `overrides` key may carry a version selector (`ajv@7`, `ajv@8`) to pin different major
 * lines separately. Every entry sharing a base package name is collected and checked
 * independently — a Map keyed by base name with last-write-wins would silently drop all but one
 * selector-scoped floor, which is exactly the kind of invisible floor this script exists to
 * surface.
 *
 * The comparator is minimal because no semver-range library is a declared dependency here
 * (`semver` resolves only transitively through eslint). An exclusive bound (`>X` as a lower
 * bound, `<=X` normalized... see below) is approximated by stepping to the adjacent patch
 * version rather than modeling true open-interval boundaries — the same approximation applied
 * consistently to both `>` lower bounds and `<=` upper bounds (an inclusive `<=X` ceiling is
 * normalized to an exclusive one at `X`'s next patch), which is what lets every interval in this
 * file be represented uniformly as half-open `[lo, hi)`. A bare exact pin (`8.20.0`, no
 * comparator prefix) is its own degenerate one-patch-wide interval, not an unbounded `>=`
 * floor — pnpm resolves that entry to EXACTLY that version. Prerelease ordering is handled by
 * `compareVersions` and is unrelated to this boundary approximation.
 */

const WORKSPACE_FILE = 'pnpm-workspace.yaml'
// The npm advisory convention for "an advisory exists but no version has been published that
// fixes it" — a real, well-formed value, not malformed input.
const NO_FIX_AVAILABLE_PATCHED_VERSIONS = '<0.0.0'

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'] as const
export type Severity = (typeof SEVERITY_ORDER)[number]
export const DEFAULT_SEVERITY_THRESHOLD: Severity = 'high'

function severityRank(severity: string): number {
  return SEVERITY_ORDER.indexOf(severity as Severity)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── Minimal semver support ─────────────────────────────────────────────────

export interface SemverVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

// Accepts 1-3 numeric components (a bare "<4" upper bound is common in this repo's own
// overrides, e.g. `nanoid: '>=3.3.18 <4'`) plus an optional dot-separated prerelease suffix.
const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\d.A-Za-z-]+))?$/u

export function parseVersion(raw: string): SemverVersion | undefined {
  const match = VERSION_PATTERN.exec(raw.trim())
  if (!match) return undefined
  const [, majorRaw, minorRaw, patchRaw, prereleaseRaw] = match
  return {
    major: Number(majorRaw),
    minor: minorRaw === undefined ? 0 : Number(minorRaw),
    patch: patchRaw === undefined ? 0 : Number(patchRaw),
    prerelease: prereleaseRaw === undefined || prereleaseRaw.length === 0 ? [] : prereleaseRaw.split('.'),
  }
}

export function compareVersions(a: SemverVersion, b: SemverVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1 // a release outranks any prerelease of the same core version
  if (b.length === 0) return -1
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const identifierA = a[i]
    const identifierB = b[i]
    if (identifierA === undefined) return -1
    if (identifierB === undefined) return 1
    const numericA = /^\d+$/u.test(identifierA)
    const numericB = /^\d+$/u.test(identifierB)
    if (numericA && numericB) {
      const diff = Number(identifierA) - Number(identifierB)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (numericA !== numericB) {
      return numericA ? -1 : 1 // numeric identifiers always sort before alphanumeric ones
    } else if (identifierA !== identifierB) {
      return identifierA < identifierB ? -1 : 1
    }
  }
  return 0
}

/** Steps `version` to the adjacent patch release, dropping any prerelease suffix. */
function bumpPatch(version: SemverVersion): SemverVersion {
  return {major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: []}
}

type ComparatorOperator = '=' | '<' | '<=' | '>' | '>='

interface Comparator {
  readonly operator: ComparatorOperator
  readonly version: SemverVersion
}

const COMPARATOR_PATTERN = /^(>=|<=|[><=])?(.+)$/u

function parseSingleComparator(raw: string): Comparator | undefined {
  const match = COMPARATOR_PATTERN.exec(raw.trim())
  if (!match) return undefined
  const operator = (match[1] ?? '=') as ComparatorOperator
  const version = parseVersion(match[2] ?? '')
  if (!version) return undefined
  return {operator, version}
}

export interface RangeParseFailure {
  readonly ok: false
  readonly reason: string
}

/**
 * A half-open interval `[lo, hi)`. `hi` undefined means unbounded above. An exclusive `>`
 * lower bound and an inclusive `<=` upper bound are both normalized here (via `bumpPatch`) so
 * every interval in this file has the same uniform shape and every comparison is a plain `<`.
 */
export interface RangeInterval {
  readonly lo: SemverVersion
  readonly hi?: SemverVersion
}

/**
 * Parses one AND-group (no `||`) of whitespace-separated comparators into an interval: exactly
 * one lower-bound comparator (required), plus at most one upper-bound comparator (optional). A
 * group with zero or more than one lower bound, or more than one upper bound, fails closed
 * rather than guessing which one is intended. A single bare token with no comparator prefix
 * (`8.20.0`) is an exact pin — pnpm resolves it to EXACTLY that version — represented as its own
 * one-patch-wide interval rather than an unbounded `>=` floor.
 */
function parseGroupBounds(
  group: string,
  rawForMessage: string,
): {readonly ok: true; readonly interval: RangeInterval} | RangeParseFailure {
  const tokens = group.split(/\s+/u).filter(token => token.length > 0)
  if (tokens.length === 0) {
    return {ok: false, reason: `range "${rawForMessage}" has an empty comparator group`}
  }
  const comparators: Comparator[] = []
  for (const token of tokens) {
    const comparator = parseSingleComparator(token)
    if (!comparator) {
      return {ok: false, reason: `range "${rawForMessage}" could not be parsed as a semver comparator ("${token}")`}
    }
    comparators.push(comparator)
  }
  const lowerBounds = comparators.filter(
    comparator => comparator.operator === '>=' || comparator.operator === '>' || comparator.operator === '=',
  )
  const upperBounds = comparators.filter(comparator => comparator.operator === '<' || comparator.operator === '<=')
  const [lowerBound] = lowerBounds
  const [upperBound] = upperBounds
  if (
    !lowerBound ||
    lowerBounds.length !== 1 ||
    upperBounds.length > 1 ||
    lowerBounds.length + upperBounds.length !== comparators.length
  ) {
    return {
      ok: false,
      reason: `range "${rawForMessage}" does not resolve to exactly one lower-bound comparator (and at most one upper-bound comparator) per comparator group, which this check requires`,
    }
  }

  if (tokens.length === 1 && lowerBound.operator === '=') {
    // A bare exact pin: pnpm resolves this to EXACTLY that version, not "at least" it.
    return {ok: true, interval: {lo: lowerBound.version, hi: bumpPatch(lowerBound.version)}}
  }

  const lo = lowerBound.operator === '>' ? bumpPatch(lowerBound.version) : lowerBound.version
  const hi = upperBound
    ? upperBound.operator === '<='
      ? bumpPatch(upperBound.version)
      : upperBound.version
    : undefined
  return {ok: true, interval: {lo, hi}}
}

export interface RangeGroupsParseSuccess {
  readonly ok: true
  readonly groups: readonly RangeInterval[]
}
export type RangeGroupsParseResult = RangeGroupsParseSuccess | RangeParseFailure

/**
 * Parses `raw` into its `||`-separated comparator groups, each a half-open interval
 * `[lo, hi)`/`[lo, ∞)`. This is the ONLY range parser in this file — both an `overrides` entry
 * and an advisory's `patched_versions` are parsed with it, and both are compared as intervals via
 * `overrideCoveredByPatched`. See the module docstring for why a separate single-point parser for
 * either side is what let this class of bug reappear three times.
 */
export function parseRangeGroups(raw: string): RangeGroupsParseResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return {ok: false, reason: 'range is empty'}
  }
  const rawGroups = trimmed.split('||').map(group => group.trim())
  if (rawGroups.some(group => group.length === 0)) {
    return {ok: false, reason: `range "${raw}" has an empty branch in a disjoint (||) range`}
  }
  const groups: RangeInterval[] = []
  for (const rawGroup of rawGroups) {
    const result = parseGroupBounds(rawGroup, raw)
    if (!result.ok) return result
    groups.push(result.interval)
  }
  return {ok: true, groups}
}

/**
 * True iff `target` is entirely covered by the union of `coverers` — every version `target`
 * admits is admitted by some coverer, with no gap. Sweeps `coverers` overlapping `target` in
 * lower-bound order, tracking how far coverage extends (`frontier`); a coverer starting after
 * the current frontier is a gap and fails immediately. An unbounded `target` (`hi` undefined)
 * can only be covered by reaching an unbounded coverer.
 */
function isCoveredByUnion(target: RangeInterval, coverers: readonly RangeInterval[]): boolean {
  const relevant = coverers
    .filter(
      coverer =>
        (coverer.hi === undefined || compareVersions(coverer.hi, target.lo) > 0) &&
        (target.hi === undefined || compareVersions(coverer.lo, target.hi) < 0),
    )
    .toSorted((a, b) => compareVersions(a.lo, b.lo))

  let frontier = target.lo
  for (const coverer of relevant) {
    if (compareVersions(coverer.lo, frontier) > 0) return false // gap before this coverer starts
    if (coverer.hi === undefined) return true // reaches infinity: covers the rest of target too
    if (compareVersions(coverer.hi, frontier) > 0) frontier = coverer.hi
    if (target.hi !== undefined && compareVersions(frontier, target.hi) >= 0) return true
  }
  if (target.hi === undefined) return false // never reached an unbounded coverer
  return compareVersions(frontier, target.hi) >= 0
}

/**
 * True iff EVERY version an `overrides` entry could resolve to (its parsed groups) is covered by
 * SOME patched interval. An unbounded override (`>=X`, no ceiling) is covered only if a patched
 * group is ALSO unbounded above and starts at or below `X` — that is not special-cased, it is
 * what `isCoveredByUnion` computes directly for an unbounded `target`.
 */
export function overrideCoveredByPatched(
  overrideGroups: readonly RangeInterval[],
  patchedGroups: readonly RangeInterval[],
): boolean {
  return overrideGroups.every(group => isCoveredByUnion(group, patchedGroups))
}

/**
 * True iff `patchedVersions` is the npm advisory convention for "no fix has been published
 * yet" — a real, well-formed value that a general range parser would otherwise (correctly, but
 * unhelpfully) reject as having no lower bound.
 */
export function isNoFixAvailable(patchedVersions: string): boolean {
  return patchedVersions.trim() === NO_FIX_AVAILABLE_PATCHED_VERSIONS
}

/**
 * Strips a version selector suffix from an `overrides` key (e.g. `ajv@8` -> `ajv`,
 * `@scope/pkg@1` -> `@scope/pkg`) so it can be compared against an advisory's `module_name`.
 */
export function overrideBaseName(key: string): string {
  if (key.startsWith('@')) {
    const secondAt = key.indexOf('@', 1)
    return secondAt === -1 ? key : key.slice(0, secondAt)
  }
  const at = key.indexOf('@')
  return at === -1 ? key : key.slice(0, at)
}

export interface OverrideEntry {
  /** The raw `overrides` key as written, e.g. `ajv@7` — may carry a version selector. */
  readonly key: string
  /** The raw floor string as written, e.g. `'>=7.0.5'`. */
  readonly raw: string
}

/**
 * Maps each base package name to EVERY `overrides` entry that names it, selector-scoped or not.
 * A single Map<string, string> with last-write-wins would silently drop all but the final
 * selector-scoped entry (`ajv@7` and `ajv@8` would collapse to just `ajv@8`'s floor) — exactly
 * the kind of invisible floor this script exists to surface, so every matching entry is kept and
 * checked independently.
 */
export function extractOverridesMap(workspaceYamlContent: string): Map<string, readonly OverrideEntry[]> {
  const parsed = parseYaml(workspaceYamlContent) as unknown
  const overrides = isRecord(parsed) ? parsed.overrides : undefined
  const map = new Map<string, OverrideEntry[]>()
  if (!isRecord(overrides)) return map
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') continue
    const baseName = overrideBaseName(key)
    const entries = map.get(baseName)
    if (entries) {
      entries.push({key, raw: value})
    } else {
      map.set(baseName, [{key, raw: value}])
    }
  }
  return map
}

// ─── pnpm audit ──────────────────────────────────────────────────────────────

export interface AuditRunSuccess {
  readonly ok: true
  readonly advisoryRecords: readonly unknown[]
}
export interface AuditRunFailure {
  readonly ok: false
  readonly reason: string
}
export type AuditRunResult = AuditRunSuccess | AuditRunFailure

/**
 * Parses `pnpm audit --json`'s stdout. Requires `metadata.vulnerabilities` and `advisories` to
 * both be present objects; anything else is a failure, never a pass-with-warning. Exported
 * separately from `runPnpmAudit` so the parse/shape-validation logic is testable without
 * spawning a subprocess.
 */
export function parseAuditOutput(stdout: string): AuditRunResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    return {ok: false, reason: `pnpm audit output did not parse as JSON: ${errorMessage(error)}`}
  }
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.metadata) ||
    !isRecord(parsed.metadata.vulnerabilities) ||
    !isRecord(parsed.advisories)
  ) {
    return {
      ok: false,
      reason: 'pnpm audit output did not match the expected shape (missing metadata.vulnerabilities or advisories)',
    }
  }
  return {ok: true, advisoryRecords: Object.values(parsed.advisories)}
}

function extractStdoutFromExecError(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  const {stdout} = error
  if (typeof stdout === 'string') return stdout
  if (Buffer.isBuffer(stdout)) return stdout.toString('utf8')
  return undefined
}

/**
 * Runs `pnpm audit --json`. `pnpm audit` exits non-zero whenever ANY advisory exists at ANY
 * severity, so a non-zero exit is expected and NOT itself a failure signal — the failure signal
 * is stdout that does not parse as valid audit JSON (see `parseAuditOutput`). `execFileSync`
 * throws on a non-zero exit; the thrown error's `.stdout` is still the real audit payload in
 * that case, so it is recovered and parsed exactly as a zero-exit run would be. An error with no
 * captured `.stdout` at all (the binary could not be spawned, e.g. ENOENT) is a real failure.
 */
export function runPnpmAudit(exec: typeof execFileSync = execFileSync): AuditRunResult {
  let stdout: string
  try {
    stdout = exec('pnpm', ['audit', '--json'], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024})
  } catch (error) {
    const stdoutFromError = extractStdoutFromExecError(error)
    if (stdoutFromError === undefined) {
      return {ok: false, reason: `pnpm audit could not be executed: ${errorMessage(error)}`}
    }
    stdout = stdoutFromError
  }
  return parseAuditOutput(stdout)
}

// ─── Checking ────────────────────────────────────────────────────────────────

interface RawAdvisory {
  readonly id: number | string
  readonly moduleName: string
  readonly severity: string
  readonly patchedVersions: string
}

function parseRawAdvisory(value: unknown): RawAdvisory | undefined {
  if (!isRecord(value)) return undefined
  const {id, module_name: moduleName, severity, patched_versions: patchedVersions} = value
  if (
    (typeof id !== 'number' && typeof id !== 'string') ||
    typeof moduleName !== 'string' ||
    typeof severity !== 'string' ||
    typeof patchedVersions !== 'string'
  ) {
    return undefined
  }
  return {id, moduleName, severity, patchedVersions}
}

export type FloorProblem =
  | {
      readonly kind: 'floor-below-patched'
      readonly packageName: string
      readonly overrideKey: string
      readonly severity: string
      readonly advisoryId: number | string
      readonly floor: string
      readonly patchedVersions: string
    }
  | {
      readonly kind: 'missing-override'
      readonly packageName: string
      readonly severity: string
      readonly advisoryId: number | string
      readonly patchedVersions: string
    }
  | {
      readonly kind: 'no-fix-available'
      readonly packageName: string
      readonly severity: string
      readonly advisoryId: number | string
      readonly patchedVersions: string
    }
  | {
      readonly kind: 'unparseable-patched-range'
      readonly packageName: string
      readonly severity: string
      readonly advisoryId: number | string
      readonly patchedVersions: string
      readonly reason: string
    }
  | {
      readonly kind: 'unparseable-override'
      readonly packageName: string
      readonly overrideKey: string
      readonly overrideRaw: string
      readonly reason: string
    }
  | {
      readonly kind: 'unrecognized-severity'
      readonly packageName: string
      readonly advisoryId: number | string
      readonly severity: string
    }
  | {
      readonly kind: 'unparseable-advisory-record'
      readonly index: number
    }

export interface CheckOverrideFloorsResult {
  readonly ok: boolean
  readonly evaluated: number
  readonly problems: readonly FloorProblem[]
  /** Set (with `ok: false`) when `pnpm audit` or `pnpm-workspace.yaml` could not be read at all. */
  readonly auditFailure?: string
}

export interface CheckOverrideFloorsOptions {
  readonly rootDir?: string
  readonly severityThreshold?: Severity
  readonly runAudit?: () => AuditRunResult
}

export async function checkOverrideFloors(
  options: CheckOverrideFloorsOptions = {},
): Promise<CheckOverrideFloorsResult> {
  const rootDir = options.rootDir ?? process.cwd()
  const severityThreshold = options.severityThreshold ?? DEFAULT_SEVERITY_THRESHOLD
  const runAudit = options.runAudit ?? (() => runPnpmAudit())
  const thresholdRank = severityRank(severityThreshold)

  const audit = runAudit()
  if (!audit.ok) {
    return {ok: false, evaluated: 0, problems: [], auditFailure: audit.reason}
  }

  let workspaceYamlContent: string
  try {
    workspaceYamlContent = await readFile(join(rootDir, WORKSPACE_FILE), 'utf8')
  } catch (error) {
    return {
      ok: false,
      evaluated: 0,
      problems: [],
      auditFailure: `${WORKSPACE_FILE} could not be read: ${errorMessage(error)}`,
    }
  }

  let overridesMap: Map<string, readonly OverrideEntry[]>
  try {
    overridesMap = extractOverridesMap(workspaceYamlContent)
  } catch (error) {
    return {
      ok: false,
      evaluated: 0,
      problems: [],
      auditFailure: `${WORKSPACE_FILE} could not be parsed: ${errorMessage(error)}`,
    }
  }

  const problems: FloorProblem[] = []
  let evaluated = 0

  for (const [index, record] of audit.advisoryRecords.entries()) {
    const advisory = parseRawAdvisory(record)
    if (!advisory) {
      problems.push({kind: 'unparseable-advisory-record', index})
      continue
    }

    const rank = severityRank(advisory.severity)
    if (rank === -1) {
      problems.push({
        kind: 'unrecognized-severity',
        packageName: advisory.moduleName,
        advisoryId: advisory.id,
        severity: advisory.severity,
      })
      continue
    }
    if (rank < thresholdRank) continue // below threshold: intentionally not evaluated, not a problem

    evaluated += 1

    if (isNoFixAvailable(advisory.patchedVersions)) {
      problems.push({
        kind: 'no-fix-available',
        packageName: advisory.moduleName,
        severity: advisory.severity,
        advisoryId: advisory.id,
        patchedVersions: advisory.patchedVersions,
      })
      continue
    }

    const patchedRanges = parseRangeGroups(advisory.patchedVersions)
    if (!patchedRanges.ok) {
      problems.push({
        kind: 'unparseable-patched-range',
        packageName: advisory.moduleName,
        severity: advisory.severity,
        advisoryId: advisory.id,
        patchedVersions: advisory.patchedVersions,
        reason: patchedRanges.reason,
      })
      continue
    }

    const entries = overridesMap.get(advisory.moduleName) ?? []
    if (entries.length === 0) {
      problems.push({
        kind: 'missing-override',
        packageName: advisory.moduleName,
        severity: advisory.severity,
        advisoryId: advisory.id,
        patchedVersions: advisory.patchedVersions,
      })
      continue
    }

    for (const entry of entries) {
      const overrideRanges = parseRangeGroups(entry.raw)
      if (!overrideRanges.ok) {
        problems.push({
          kind: 'unparseable-override',
          packageName: advisory.moduleName,
          overrideKey: entry.key,
          overrideRaw: entry.raw,
          reason: overrideRanges.reason,
        })
        continue
      }

      if (!overrideCoveredByPatched(overrideRanges.groups, patchedRanges.groups)) {
        problems.push({
          kind: 'floor-below-patched',
          packageName: advisory.moduleName,
          overrideKey: entry.key,
          severity: advisory.severity,
          advisoryId: advisory.id,
          floor: entry.raw,
          patchedVersions: advisory.patchedVersions,
        })
      }
    }
  }

  return {ok: problems.length === 0, evaluated, problems}
}

function formatProblem(problem: FloorProblem): string {
  switch (problem.kind) {
    case 'floor-below-patched':
      return `${problem.overrideKey}: override "${problem.floor}" admits a version not covered by the patched range "${problem.patchedVersions}" (advisory ${String(problem.advisoryId)}, ${problem.severity.toUpperCase()})`
    case 'missing-override':
      return `${problem.packageName}: no override entry exists, but advisory ${String(problem.advisoryId)} (${problem.severity.toUpperCase()}) requires patched_versions "${problem.patchedVersions}"`
    case 'no-fix-available':
      return `${problem.packageName}: advisory ${String(problem.advisoryId)} (${problem.severity.toUpperCase()}) has no patched version published yet (patched_versions "${problem.patchedVersions}") — no override floor can close this; the dependency itself needs review`
    case 'unparseable-patched-range':
      return `${problem.packageName}: advisory ${String(problem.advisoryId)} patched_versions "${problem.patchedVersions}" could not be interpreted: ${problem.reason}`
    case 'unparseable-override':
      return `${problem.overrideKey}: override "${problem.overrideRaw}" could not be interpreted: ${problem.reason}`
    case 'unrecognized-severity':
      return `${problem.packageName}: advisory ${String(problem.advisoryId)} has an unrecognized severity "${problem.severity}"`
    case 'unparseable-advisory-record':
      return `pnpm audit advisory record at index ${String(problem.index)} is missing required fields (id, module_name, severity, patched_versions)`
  }
}

export async function main(): Promise<void> {
  const result = await checkOverrideFloors()

  if (result.auditFailure !== undefined) {
    process.stderr.write(`check-override-floors: ${result.auditFailure}\n`)
    process.exitCode = 1
    return
  }

  for (const problem of result.problems) {
    process.stderr.write(`check-override-floors: ${formatProblem(problem)}\n`)
  }

  if (!result.ok) {
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
