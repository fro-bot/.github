import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import process from 'node:process'

import {parse as parseYaml} from 'yaml'

/**
 * Verifies that every `overrides` floor in `pnpm-workspace.yaml` sits at or above the version
 * that patches its advisory, and that every advisory at or above `DEFAULT_SEVERITY_THRESHOLD`
 * has an override floor at all.
 *
 * `dependency-review.yaml` scans only manifest files that change in a pull request, so a
 * vulnerable transitive dependency already resting in the lockfile is invisible to it. Nothing
 * else in CI reads the standing lockfile.
 *
 * Advisories come from `pnpm audit --json`. Anything this script cannot interpret is a FAILURE,
 * not a skip: non-JSON output, missing `metadata.vulnerabilities`/`advisories`, an unreadable
 * workspace file, an advisory missing required fields, an unknown severity, or a range the
 * comparator below does not support. `pnpm audit` exits non-zero whenever any advisory exists,
 * so exit status alone is not the failure signal — unparseable output is.
 *
 * Threshold defaults to `high`. A `moderate` default would fail on `@humanfs/node`, an open
 * advisory this repo is deliberately not remediating on this gate's schedule.
 *
 * The comparator is minimal because no semver-range library is a declared dependency here
 * (`semver` resolves only transitively through eslint). It handles a bare `>=X`, an exact pin,
 * and a bounded `>=X <Y`; it rejects `||` and multiple lower bounds rather than guessing.
 */

const WORKSPACE_FILE = 'pnpm-workspace.yaml'

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

export interface FloorParseSuccess {
  readonly ok: true
  readonly version: SemverVersion
}
export interface FloorParseFailure {
  readonly ok: false
  readonly reason: string
}
export type FloorParseResult = FloorParseSuccess | FloorParseFailure

/**
 * Interprets an advisory's `patched_versions` as a single `>=X` floor. Deliberately strict:
 * a compound or disjoint `patched_versions` range means this advisory patches different
 * versions across incompatible branches, which a single override floor cannot represent —
 * failing closed here is safer than picking one branch's floor and silently ignoring the rest.
 */
export function parsePatchedFloor(patchedVersions: string): FloorParseResult {
  const trimmed = patchedVersions.trim()
  if (trimmed.length === 0) {
    return {ok: false, reason: 'patched_versions is empty'}
  }
  if (trimmed.includes('||')) {
    return {
      ok: false,
      reason: `patched_versions "${patchedVersions}" contains a disjoint (||) range, which this check does not interpret`,
    }
  }
  const parts = trimmed.split(/\s+/u).filter(part => part.length > 0)
  if (parts.length !== 1) {
    return {
      ok: false,
      reason: `patched_versions "${patchedVersions}" is a compound range (multiple comparators), which this check does not interpret`,
    }
  }
  const comparator = parseSingleComparator(parts[0] ?? '')
  if (!comparator) {
    return {ok: false, reason: `patched_versions "${patchedVersions}" could not be parsed as a semver comparator`}
  }
  if (comparator.operator !== '>=') {
    return {
      ok: false,
      reason: `patched_versions "${patchedVersions}" uses operator "${comparator.operator}", which this check only interprets as ">="`,
    }
  }
  return {ok: true, version: comparator.version}
}

/**
 * Interprets an `overrides` entry as a floor: exactly one lower-bound comparator (`>=`, `>`, or
 * a bare exact pin), plus any number of upper-bound comparators (`<`, `<=`) which are accepted
 * but ignored — an upper bound narrows the resolved range, it does not lower the floor. Anything
 * else (no lower bound, more than one, an unparseable token, a `||`) fails closed.
 */
export function parseOverrideFloor(overrideRaw: string): FloorParseResult {
  const trimmed = overrideRaw.trim()
  if (trimmed.length === 0) {
    return {ok: false, reason: 'override value is empty'}
  }
  if (trimmed.includes('||')) {
    return {
      ok: false,
      reason: `override "${overrideRaw}" contains a disjoint (||) range, which this check does not interpret`,
    }
  }
  const tokens = trimmed.split(/\s+/u).filter(token => token.length > 0)
  const comparators: Comparator[] = []
  for (const token of tokens) {
    const comparator = parseSingleComparator(token)
    if (!comparator) {
      return {ok: false, reason: `override "${overrideRaw}" could not be parsed as a semver comparator ("${token}")`}
    }
    comparators.push(comparator)
  }
  const lowerBounds = comparators.filter(
    comparator => comparator.operator === '>=' || comparator.operator === '>' || comparator.operator === '=',
  )
  const upperBounds = comparators.filter(comparator => comparator.operator === '<' || comparator.operator === '<=')
  const [lowerBound] = lowerBounds
  if (!lowerBound || lowerBounds.length !== 1 || lowerBounds.length + upperBounds.length !== comparators.length) {
    return {
      ok: false,
      reason: `override "${overrideRaw}" does not resolve to exactly one lower-bound comparator, which this check requires to establish a floor`,
    }
  }
  return {ok: true, version: lowerBound.version}
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

export function extractOverridesMap(workspaceYamlContent: string): Map<string, string> {
  const parsed = parseYaml(workspaceYamlContent) as unknown
  const overrides = isRecord(parsed) ? parsed.overrides : undefined
  const map = new Map<string, string>()
  if (!isRecord(overrides)) return map
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') continue
    map.set(overrideBaseName(key), value)
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

  let overridesMap: Map<string, string>
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

  audit.advisoryRecords.forEach((record, index) => {
    const advisory = parseRawAdvisory(record)
    if (!advisory) {
      problems.push({kind: 'unparseable-advisory-record', index})
      return
    }

    const rank = severityRank(advisory.severity)
    if (rank === -1) {
      problems.push({
        kind: 'unrecognized-severity',
        packageName: advisory.moduleName,
        advisoryId: advisory.id,
        severity: advisory.severity,
      })
      return
    }
    if (rank < thresholdRank) return // below threshold: intentionally not evaluated, not a problem

    evaluated += 1

    const patchedFloor = parsePatchedFloor(advisory.patchedVersions)
    if (!patchedFloor.ok) {
      problems.push({
        kind: 'unparseable-patched-range',
        packageName: advisory.moduleName,
        severity: advisory.severity,
        advisoryId: advisory.id,
        patchedVersions: advisory.patchedVersions,
        reason: patchedFloor.reason,
      })
      return
    }

    const overrideRaw = overridesMap.get(advisory.moduleName)
    if (overrideRaw === undefined) {
      problems.push({
        kind: 'missing-override',
        packageName: advisory.moduleName,
        severity: advisory.severity,
        advisoryId: advisory.id,
        patchedVersions: advisory.patchedVersions,
      })
      return
    }

    const overrideFloor = parseOverrideFloor(overrideRaw)
    if (!overrideFloor.ok) {
      problems.push({
        kind: 'unparseable-override',
        packageName: advisory.moduleName,
        overrideRaw,
        reason: overrideFloor.reason,
      })
      return
    }

    if (compareVersions(overrideFloor.version, patchedFloor.version) < 0) {
      problems.push({
        kind: 'floor-below-patched',
        packageName: advisory.moduleName,
        severity: advisory.severity,
        advisoryId: advisory.id,
        floor: overrideRaw,
        patchedVersions: advisory.patchedVersions,
      })
    }
  })

  return {ok: problems.length === 0, evaluated, problems}
}

function formatProblem(problem: FloorProblem): string {
  switch (problem.kind) {
    case 'floor-below-patched':
      return `${problem.packageName}: override floor "${problem.floor}" is below the patched range "${problem.patchedVersions}" (advisory ${String(problem.advisoryId)}, ${problem.severity.toUpperCase()})`
    case 'missing-override':
      return `${problem.packageName}: no override entry exists, but advisory ${String(problem.advisoryId)} (${problem.severity.toUpperCase()}) requires patched_versions "${problem.patchedVersions}"`
    case 'unparseable-patched-range':
      return `${problem.packageName}: advisory ${String(problem.advisoryId)} patched_versions "${problem.patchedVersions}" could not be interpreted: ${problem.reason}`
    case 'unparseable-override':
      return `${problem.packageName}: override "${problem.overrideRaw}" could not be interpreted: ${problem.reason}`
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
