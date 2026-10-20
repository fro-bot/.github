import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import process from 'node:process'

/**
 * Fails when the locked dependency tree carries an advisory at `high` or `critical` severity.
 *
 * `dependency-review.yaml` scans only manifest files that change in a pull request, so a
 * vulnerable transitive dependency already resting in the lockfile is invisible to it. Nothing
 * else in CI reads the standing lockfile.
 *
 * Advisories come from `bun audit --json`, which audits the locked package graph in `bun.lock`,
 * including devDependencies and other-platform optional packages, because no `--prod` flag is
 * passed. Its output is a map keyed by package name; each value is an array of advisory records
 * carrying `id`, `severity` and `vulnerable_versions` (no patched range), and usually a `url`.
 * `{}` means the tree is clean. The gate does not read the `overrides` map: any locked copy
 * inside a high or critical vulnerable range fails, even when a floored copy of the same package
 * sits beside it.
 *
 * Anything this script cannot interpret is a FAILURE, not a skip: empty or non-JSON output, a
 * top level that is not a package map, a package entry that is not an array, an advisory record
 * missing `id`, `severity` or `vulnerable_versions`, or a severity outside info, low, moderate,
 * high and critical. `bun audit` exits non-zero whenever any advisory exists, so exit status alone is not
 * the failure signal — unparseable output is. Records below `high` are skipped.
 */

const BLOCKING_SEVERITIES: readonly string[] = ['high', 'critical']
const SKIPPED_SEVERITIES: readonly string[] = ['info', 'low', 'moderate']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── bun audit ───────────────────────────────────────────────────────────────

export interface AuditRunSuccess {
  readonly ok: true
  /** The parsed `bun audit --json` map: package name to that package's advisory records. */
  readonly advisories: Readonly<Record<string, unknown>>
}
export interface AuditRunFailure {
  readonly ok: false
  readonly reason: string
}
export type AuditRunResult = AuditRunSuccess | AuditRunFailure

/**
 * Parses `bun audit --json`'s stdout. The top level must be a package map; anything else
 * (including empty output) is a failure, never a pass-with-warning. Exported separately from
 * `runBunAudit` so the parse logic is testable without spawning a subprocess.
 */
export function parseAuditOutput(stdout: string): AuditRunResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    return {ok: false, reason: `bun audit output did not parse as JSON: ${errorMessage(error)}`}
  }
  if (!isRecord(parsed)) {
    return {ok: false, reason: 'bun audit output did not match the expected shape (a map of package names)'}
  }
  return {ok: true, advisories: parsed}
}

function extractStdoutFromExecError(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  const {stdout} = error
  if (typeof stdout === 'string') return stdout
  if (Buffer.isBuffer(stdout)) return stdout.toString('utf8')
  return undefined
}

/**
 * Runs `bun audit --json`. `bun audit` exits non-zero whenever ANY advisory exists at ANY
 * severity, so a non-zero exit is expected and NOT itself a failure signal — the failure signal
 * is stdout that does not parse as a package map (see `parseAuditOutput`). `execFileSync`
 * throws on a non-zero exit; the thrown error's `.stdout` is still the real audit payload in
 * that case, so it is recovered and parsed exactly as a zero-exit run would be. An error with no
 * captured `.stdout` at all (the binary could not be spawned, e.g. ENOENT) is a real failure.
 */
export function runBunAudit(exec: typeof execFileSync = execFileSync): AuditRunResult {
  let stdout: string
  try {
    stdout = exec('bun', ['audit', '--json'], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024})
  } catch (error) {
    const stdoutFromError = extractStdoutFromExecError(error)
    if (stdoutFromError === undefined) {
      return {ok: false, reason: `bun audit could not be executed: ${errorMessage(error)}`}
    }
    stdout = stdoutFromError
  }
  return parseAuditOutput(stdout)
}

// ─── Checking ────────────────────────────────────────────────────────────────

interface RawAdvisory {
  readonly id: number | string
  readonly severity: string
  readonly vulnerableVersions: string
  readonly url: string | undefined
}

function parseRawAdvisory(value: unknown): RawAdvisory | undefined {
  if (!isRecord(value)) return undefined
  const {id, severity, vulnerable_versions: vulnerableVersions, url} = value
  if (
    (typeof id !== 'number' && typeof id !== 'string') ||
    typeof severity !== 'string' ||
    typeof vulnerableVersions !== 'string'
  ) {
    return undefined
  }
  return {id, severity, vulnerableVersions, url: typeof url === 'string' ? url : undefined}
}

export type FloorProblem =
  | {
      readonly kind: 'blocking-advisory'
      readonly packageName: string
      readonly advisoryId: number | string
      readonly severity: string
      readonly vulnerableVersions: string
      /** The advisory page, which names the fixed release. Absent when `bun audit` omits it. */
      readonly url: string | undefined
    }
  | {
      readonly kind: 'unrecognized-severity'
      readonly packageName: string
      readonly advisoryId: number | string
      readonly severity: string
    }
  | {
      readonly kind: 'unparseable-package-entry'
      readonly packageName: string
    }
  | {
      readonly kind: 'unparseable-advisory-record'
      readonly packageName: string
      readonly index: number
    }

export interface CheckOverrideFloorsResult {
  readonly ok: boolean
  readonly problems: readonly FloorProblem[]
  /** Set (with `ok: false`) when `bun audit` could not be run or parsed at all. */
  readonly auditFailure?: string
}

export interface CheckOverrideFloorsOptions {
  readonly runAudit?: () => AuditRunResult
}

export function checkOverrideFloors(options: CheckOverrideFloorsOptions = {}): CheckOverrideFloorsResult {
  const runAudit = options.runAudit ?? (() => runBunAudit())

  const audit = runAudit()
  if (!audit.ok) {
    return {ok: false, problems: [], auditFailure: audit.reason}
  }

  const problems: FloorProblem[] = []

  for (const [packageName, records] of Object.entries(audit.advisories)) {
    if (!Array.isArray(records)) {
      problems.push({kind: 'unparseable-package-entry', packageName})
      continue
    }

    for (const [index, record] of (records as unknown[]).entries()) {
      const advisory = parseRawAdvisory(record)
      if (!advisory) {
        problems.push({kind: 'unparseable-advisory-record', packageName, index})
        continue
      }

      if (BLOCKING_SEVERITIES.includes(advisory.severity)) {
        problems.push({
          kind: 'blocking-advisory',
          packageName,
          advisoryId: advisory.id,
          severity: advisory.severity,
          vulnerableVersions: advisory.vulnerableVersions,
          url: advisory.url,
        })
      } else if (!SKIPPED_SEVERITIES.includes(advisory.severity)) {
        problems.push({
          kind: 'unrecognized-severity',
          packageName,
          advisoryId: advisory.id,
          severity: advisory.severity,
        })
      }
    }
  }

  return {ok: problems.length === 0, problems}
}

export function formatProblem(problem: FloorProblem): string {
  switch (problem.kind) {
    case 'blocking-advisory':
      return `${problem.packageName}: advisory ${String(problem.advisoryId)} (${problem.severity.toUpperCase()}) affects an installed version in vulnerable range "${problem.vulnerableVersions}"${problem.url === undefined ? '' : `; advisory: ${problem.url}`}`
    case 'unrecognized-severity':
      return `${problem.packageName}: advisory ${String(problem.advisoryId)} has an unrecognized severity "${problem.severity}"`
    case 'unparseable-package-entry':
      return `${problem.packageName}: bun audit entry is not an array of advisory records`
    case 'unparseable-advisory-record':
      return `${problem.packageName}: bun audit advisory record at index ${String(problem.index)} is missing required fields (id, severity, vulnerable_versions)`
  }
}

export function main(): void {
  const result = checkOverrideFloors()

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
  main()
}
