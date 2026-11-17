import {Buffer} from 'node:buffer'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {isRecord} from '@fro-bot/core/guards'

import {findRepositoryRoot} from './repository-root.ts'

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
 *
 * `accepted-advisories.json` at the repository root is the one exception list: a temporary acceptance of a
 * `high` or `critical` advisory that has no fixed version yet. An entry skips a blocking record only when its
 * `package` AND its `advisory` (the bun audit `id`) both match and its `expires` day has not passed: the
 * expiry day itself is still valid, and the day is judged in UTC. Every skip prints a line naming the
 * advisory, its expiry and the reason. The file fails closed: a missing file is an empty list, but text that
 * is not JSON, a top level that is not an array, an entry with a missing or mistyped field, an invalid date
 * or a repeated package and advisory is a failure. An expired entry is a failure even when its advisory is
 * no longer reported, so a stale entry gets removed; an unexpired entry that matches nothing reported prints
 * a notice, so it can be removed once the fix has landed. An entry never excuses an unknown severity or an
 * unparseable record. `docs/override-floors.md` describes the file for people.
 */

// Functions rather than module-level constants, so the mutants of the severity vocabulary are covered by the tests.
function blockingSeverities(): readonly string[] {
  return ['high', 'critical']
}

function skippedSeverities(): readonly string[] {
  return ['info', 'low', 'moderate']
}

// A function rather than a constant, so the mutants of the file name are covered by the tests.
function acceptedAdvisoriesFileName(): string {
  return 'accepted-advisories.json'
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

// ─── Accepted advisories ─────────────────────────────────────────────────────

export interface AcceptedAdvisory {
  /** The exact package name `bun audit` reports. */
  readonly package: string
  /** The `bun audit` advisory `id`, the number the gate sees, not the GHSA. */
  readonly advisory: number
  /** The GHSA id, for people. */
  readonly ghsa: string
  /** One sentence: why the advisory is accepted while no fixed version exists. */
  readonly reason: string
  /** The last day the entry is valid, as `YYYY-MM-DD`. The day after, it fails the gate. */
  readonly expires: string
}

export interface AcceptedAdvisoriesSuccess {
  readonly ok: true
  readonly entries: readonly AcceptedAdvisory[]
}
export interface AcceptedAdvisoriesFailure {
  readonly ok: false
  readonly reason: string
}
export type AcceptedAdvisoriesResult = AcceptedAdvisoriesSuccess | AcceptedAdvisoriesFailure

/** A real calendar day written `YYYY-MM-DD`: the round trip through a UTC date rejects every other spelling. */
function isIsoDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00.000Z`)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** The entry, or the reason it is not one. `index` is its position in the file. */
function parseAcceptedEntry(value: unknown, index: number): AcceptedAdvisory | string {
  const where = `${acceptedAdvisoriesFileName()} entry ${String(index)}`
  if (!isRecord(value)) return `${where} is not an object`
  const {package: packageName, advisory, ghsa, reason, expires} = value
  if (!isNonEmptyString(packageName)) return `${where}: "package" must be a non-empty string`
  if (!isInteger(advisory)) return `${where}: "advisory" must be an integer`
  if (!isNonEmptyString(ghsa)) return `${where}: "ghsa" must be a non-empty string`
  if (!isNonEmptyString(reason)) return `${where}: "reason" must be a non-empty string`
  if (!isNonEmptyString(expires) || !isIsoDate(expires)) return `${where}: "expires" must be a date written YYYY-MM-DD`
  return {package: packageName, advisory, ghsa, reason, expires}
}

/**
 * Parses the text of `accepted-advisories.json`. Every shape this cannot read is a failure, never an empty
 * list: a file that silently excuses nothing, or excuses the wrong thing, is how an exception outlives its reason.
 */
export function parseAcceptedAdvisories(text: string): AcceptedAdvisoriesResult {
  const fileName = acceptedAdvisoriesFileName()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {ok: false, reason: `${fileName} did not parse as JSON: ${errorMessage(error)}`}
  }
  if (!Array.isArray(parsed)) return {ok: false, reason: `${fileName} must hold a JSON array of entries`}

  const entries: AcceptedAdvisory[] = []
  for (const [index, value] of (parsed as unknown[]).entries()) {
    const entry = parseAcceptedEntry(value, index)
    if (typeof entry === 'string') return {ok: false, reason: entry}
    if (entries.some(seen => seen.package === entry.package && seen.advisory === entry.advisory)) {
      return {
        ok: false,
        reason: `${fileName} entry ${String(index)} repeats ${entry.package} advisory ${String(entry.advisory)}`,
      }
    }
    entries.push(entry)
  }
  return {ok: true, entries}
}

/**
 * Reads the accepted advisories (default: the repository's own file). A missing file is an empty list, so the
 * gate behaves as it did before the file existed; any other read failure, or a file that does not parse, fails.
 */
export function readAcceptedAdvisories(
  path: string = join(findRepositoryRoot(), acceptedAdvisoriesFileName()),
  read: typeof readFileSync = readFileSync,
): AcceptedAdvisoriesResult {
  let text: string
  try {
    text = read(path, 'utf8')
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {ok: true, entries: []}
    return {ok: false, reason: `${acceptedAdvisoriesFileName()} could not be read: ${errorMessage(error)}`}
  }
  return parseAcceptedAdvisories(text)
}

/** Whether `today` (a UTC `YYYY-MM-DD`) is after the entry's last valid day. Both are validated dates, so strings order as dates. */
function isExpired(entry: AcceptedAdvisory, today: string): boolean {
  return today > entry.expires
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
  | {
      readonly kind: 'accepted-advisories-invalid'
      readonly reason: string
    }
  | {
      readonly kind: 'accepted-advisory-expired'
      readonly packageName: string
      readonly advisoryId: number
      readonly ghsa: string
      readonly expires: string
    }

/** A blocking advisory that an unexpired accepted entry excused. */
export interface SkippedAdvisory {
  readonly packageName: string
  readonly advisoryId: number | string
  readonly severity: string
  readonly expires: string
  readonly reason: string
}

export interface CheckOverrideFloorsResult {
  readonly ok: boolean
  readonly problems: readonly FloorProblem[]
  /** Blocking advisories skipped because an unexpired accepted entry matches them. */
  readonly skipped: readonly SkippedAdvisory[]
  /** Unexpired accepted entries that match no reported blocking advisory: removable once the fix has landed. */
  readonly unmatched: readonly AcceptedAdvisory[]
  /** Set (with `ok: false`) when `bun audit` could not be run or parsed at all. */
  readonly auditFailure?: string
}

export interface CheckOverrideFloorsOptions {
  readonly runAudit?: () => AuditRunResult
  /** Where the accepted advisories come from; default: `accepted-advisories.json` at the repository root. */
  readonly readAccepted?: () => AcceptedAdvisoriesResult
  /** The clock the expiry is judged against; default: the real one. Only its UTC day matters. */
  readonly now?: () => Date
}

export function checkOverrideFloors(options: CheckOverrideFloorsOptions = {}): CheckOverrideFloorsResult {
  const runAudit = options.runAudit ?? (() => runBunAudit())
  const readAccepted = options.readAccepted ?? (() => readAcceptedAdvisories())
  const now = options.now ?? (() => new Date())

  const audit = runAudit()
  if (!audit.ok) {
    return {ok: false, problems: [], skipped: [], unmatched: [], auditFailure: audit.reason}
  }

  const problems: FloorProblem[] = []
  const skipped: SkippedAdvisory[] = []

  // Only unexpired entries excuse anything; an unreadable file excuses nothing and is itself a problem.
  const today = now().toISOString().slice(0, 10)
  const accepted = readAccepted()
  const entries = accepted.ok ? accepted.entries : []
  const live = entries.filter(entry => !isExpired(entry, today))
  const matched = new Set<AcceptedAdvisory>()

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

      if (blockingSeverities().includes(advisory.severity)) {
        const entry = live.find(candidate => candidate.package === packageName && candidate.advisory === advisory.id)
        if (entry === undefined) {
          problems.push({
            kind: 'blocking-advisory',
            packageName,
            advisoryId: advisory.id,
            severity: advisory.severity,
            vulnerableVersions: advisory.vulnerableVersions,
            url: advisory.url,
          })
        } else {
          matched.add(entry)
          skipped.push({
            packageName,
            advisoryId: advisory.id,
            severity: advisory.severity,
            expires: entry.expires,
            reason: entry.reason,
          })
        }
      } else if (!skippedSeverities().includes(advisory.severity)) {
        problems.push({
          kind: 'unrecognized-severity',
          packageName,
          advisoryId: advisory.id,
          severity: advisory.severity,
        })
      }
    }
  }

  if (!accepted.ok) {
    problems.push({kind: 'accepted-advisories-invalid', reason: accepted.reason})
  }
  for (const entry of entries) {
    if (isExpired(entry, today)) {
      problems.push({
        kind: 'accepted-advisory-expired',
        packageName: entry.package,
        advisoryId: entry.advisory,
        ghsa: entry.ghsa,
        expires: entry.expires,
      })
    }
  }

  return {ok: problems.length === 0, problems, skipped, unmatched: live.filter(entry => !matched.has(entry))}
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
    case 'accepted-advisories-invalid':
      return problem.reason
    case 'accepted-advisory-expired':
      return `${problem.packageName}: accepted advisory ${String(problem.advisoryId)} (${problem.ghsa}) expired on ${problem.expires}; remove its entry from ${acceptedAdvisoriesFileName()} or renew it after review`
  }
}

export function formatSkippedAdvisory(skipped: SkippedAdvisory): string {
  return `${skipped.packageName}: advisory ${String(skipped.advisoryId)} (${skipped.severity.toUpperCase()}) accepted until ${skipped.expires}: ${skipped.reason}`
}

export function formatUnmatchedAcceptance(entry: AcceptedAdvisory): string {
  return `notice: ${entry.package}: accepted advisory ${String(entry.advisory)} (${entry.ghsa}) matches no reported advisory; remove its entry from ${acceptedAdvisoriesFileName()} once the fix has landed`
}

/**
 * The CLI's body: runs the audit, prints every skipped advisory, every notice and every problem through
 * `writeStderr` and returns the exit code. It is 1 when `bun audit` could not be run or parsed, or when any
 * problem was found, and 0 otherwise. The agent prompt
 * (`fro-bot.yaml`) acts on that exit code alone.
 */
export function runCheckOverrideFloors(
  writeStderr: (text: string) => void,
  options: CheckOverrideFloorsOptions = {},
): number {
  const result = checkOverrideFloors(options)

  if (result.auditFailure !== undefined) {
    writeStderr(`check-override-floors: ${result.auditFailure}\n`)
    return 1
  }

  for (const skipped of result.skipped) {
    writeStderr(`check-override-floors: ${formatSkippedAdvisory(skipped)}\n`)
  }
  for (const entry of result.unmatched) {
    writeStderr(`check-override-floors: ${formatUnmatchedAcceptance(entry)}\n`)
  }
  for (const problem of result.problems) {
    writeStderr(`check-override-floors: ${formatProblem(problem)}\n`)
  }

  return result.ok ? 0 : 1
}
