import {spawnSync} from 'node:child_process'
import {appendFileSync, existsSync, readFileSync, rmSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import process from 'node:process'

import {fetchChangedFiles, readPullRequestContext} from './check-wiki-authority.ts'

const repositoryRoot = resolve(import.meta.dirname, '..')
export const strykerConfigPath = join(repositoryRoot, 'stryker.config.json')
// Exported so tests can stage/inspect a stale report at the exact path the runner reads.
export const mutationReportPath = join(repositoryRoot, 'reports', 'mutation', 'mutation.json')

// ---------------------------------------------------------------------------
// Closed verdict vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed verdict vocabulary, in precedence order (top to bottom) for when several
 * conditions apply simultaneously: instrumentation-failed > directive-violation >
 * mutant-timeout > mutants-uncovered > mutants-survived > clean. `not-applicable` is produced
 * by the changed-file trigger gate (`evaluateTriggerGate`) when a `pull_request` event's
 * changed files do not intersect the trigger set derived from `stryker.config.json`.
 *
 * This `as const` array is the single runtime source of truth for the verdict set —
 * `Verdict` is derived from it, and `exitCodeFor` and its test both iterate it, so a new
 * verdict added here fails `exitCodeFor`'s exhaustiveness test until it is given an exit code.
 */
export const VERDICTS = [
  'instrumentation-failed',
  'directive-violation',
  'mutant-timeout',
  'mutants-uncovered',
  'mutants-survived',
  'clean',
  'not-applicable',
] as const

export type Verdict = (typeof VERDICTS)[number]

export interface LocatedMutant {
  readonly file: string
  readonly line: number
  readonly col: number
  readonly mutator: string
  readonly status: string
  readonly reason?: string
}

export interface ClassificationResult {
  readonly verdict: Verdict
  readonly mutants: readonly LocatedMutant[]
}

/**
 * The two Stryker config fields that determine where and whether a JSON report is written,
 * fully resolved by the caller before being passed in: `reporters` as declared, and
 * `resolvedJsonReportPath` as an absolute path, already resolved relative to the directory
 * containing the config file that declared it (see resolveReporterConfig), so
 * classifyMutationReport only ever compares two already-resolved absolute paths and never has
 * to know about the config file's location.
 */
export interface ReporterConfig {
  readonly reporters: readonly string[]
  readonly resolvedJsonReportPath: string
}

export interface DirectiveScanInput {
  readonly file: string
  readonly content: string
}

interface FlatMutant {
  readonly file: string
  readonly line: number
  readonly col: number
  readonly mutator: string
  readonly status: string
  readonly reason: string | undefined
}

const KNOWN_MUTANT_STATUSES: ReadonlySet<string> = new Set([
  'Killed',
  'Survived',
  'NoCoverage',
  'Timeout',
  'RuntimeError',
  'CompileError',
  'Ignored',
  'Pending',
])

// `Pending` is a valid mutation-testing-report-schema v2 status for a mutant a run never
// got to (e.g. the process was killed mid-run). It is listed in KNOWN_MUTANT_STATUSES so it
// is not merely "unrecognized", but it is treated as instrumentation-failed by name, below,
// so an incomplete run reads as the deliberate "not classifiable" decision it is, not an
// accidental fall-through of the unrecognized-status catch-all.
const INCOMPLETE_RUN_STATUSES: ReadonlySet<string> = new Set(['RuntimeError', 'CompileError', 'Pending'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Report parsing — mutation-testing-report-schema v2, narrowed defensively
// ---------------------------------------------------------------------------

/**
 * Flattens the mutation-testing-report-schema v2 `files` map into a flat mutant
 * list. Returns `undefined` for anything that does not match the expected shape
 * (missing report, malformed JSON, or a single mutant entry that violates the
 * schema) so the caller can fail closed with `instrumentation-failed` rather
 * than silently treating a broken report as `clean`.
 */
export function flattenReport(reportJson: unknown): FlatMutant[] | undefined {
  if (!isRecord(reportJson)) return undefined
  const files = reportJson.files
  if (!isRecord(files)) return undefined

  const mutants: FlatMutant[] = []

  for (const [filePath, fileEntry] of Object.entries(files)) {
    if (!isRecord(fileEntry)) return undefined
    const fileMutants = fileEntry.mutants
    if (!Array.isArray(fileMutants)) return undefined

    for (const mutantEntry of fileMutants) {
      if (!isRecord(mutantEntry)) return undefined
      const {status, mutatorName, location, statusReason} = mutantEntry
      if (typeof status !== 'string' || typeof mutatorName !== 'string' || !isRecord(location)) return undefined
      const start = location.start
      if (!isRecord(start) || typeof start.line !== 'number' || typeof start.column !== 'number') return undefined

      mutants.push({
        file: filePath,
        line: start.line,
        col: start.column,
        mutator: mutatorName,
        status,
        reason: typeof statusReason === 'string' ? statusReason : undefined,
      })
    }
  }

  return mutants
}

function isEmptyReason(reason: string | undefined): boolean {
  return reason === undefined || reason.trim().length === 0
}

/**
 * Names the cause of an unreadable report for the `RuntimeError` sentinel, covering all three
 * ways `flattenReport` can return `undefined`: a `readError` from the file-read/JSON.parse
 * attempt (ENOENT, syntax error — takes precedence, since it is the most specific available
 * cause); `reportJson` being the literal value `undefined` (no report was ever read); or a
 * successfully parsed JSON value that still does not match the expected report shape.
 */
function describeUnreadableReport(reportJson: unknown, readError: string | undefined): string {
  if (readError !== undefined) return readError
  if (reportJson === undefined) return 'no report was read (reportJson is undefined)'
  return 'report JSON does not match the expected mutation-testing-report-schema v2 shape'
}

/**
 * Returns the raw `files` map's keys from a report, or `undefined` if the report is not even
 * shaped enough to have a `files` record (mirrors flattenReport's own shape check, kept
 * separate since a file with an empty `mutants` array is a valid key this needs to see but
 * flattenReport's flat mutant list would never surface).
 */
function extractReportFileKeys(reportJson: unknown): string[] | undefined {
  if (!isRecord(reportJson)) return undefined
  const files = reportJson.files
  if (!isRecord(files)) return undefined
  return Object.keys(files)
}

/**
 * Returns a `Map` of the report's top-level `testFiles` keys to their `tests` array length, or
 * `undefined` if the report is not even shaped enough to have a `testFiles` record. A key
 * present with a non-array or missing `tests` field counts as zero — this mirrors the report's
 * own `files` shape check above and keeps a malformed entry from being silently skipped rather
 * than counted as "no tests executed".
 *
 * This is the shape that closes the fail-open this wrapper had until now: Stryker's Vite
 * dependency scan can silently drop one or more `testFiles` entries from dry-run collection
 * (see `hasTestFileNotExecuted` in classifyMutationReport for the confirmed mechanism — an
 * unrelated file's syntactically-invalid regex mutant, embedded as a ternary alternative,
 * fails to parse at load time and zeros collection for the whole run) while every *other*
 * configured test file still loads and the run still completes and writes a well-formed
 * report. The dropped test file's module then reads as `NoCoverage` across the board — a
 * `mutants-uncovered` verdict, not the `instrumentation-failed` the underlying tool failure
 * actually is. Verified against a live scratched-config run: the report's `testFiles` map
 * simply omits the dropped keys entirely (not present with zero tests) and nothing in the
 * dry-run log at `--logLevel debug` names the drop — `ProjectReader` and `DryRunExecutor` both
 * report success, just with fewer tests collected than configured test files would produce.
 */
function extractReportTestFileCounts(reportJson: unknown): Map<string, number> | undefined {
  if (!isRecord(reportJson)) return undefined
  const testFiles = reportJson.testFiles
  if (!isRecord(testFiles)) return undefined
  const counts = new Map<string, number>()
  for (const [key, entry] of Object.entries(testFiles)) {
    const tests = isRecord(entry) ? entry.tests : undefined
    counts.set(key, Array.isArray(tests) ? tests.length : 0)
  }
  return counts
}

/**
 * Strips a single leading `./` so a `mutate` entry and a report `files` key that refer to the
 * same file but were written with a different relative-path prefix compare equal.
 */
function normalizeMutatePath(entry: string): string {
  return entry.startsWith('./') ? entry.slice(2) : entry
}

/** A mutant is reported (listed in output) unless it was Killed or Ignored-with-a-reason. */
function isFailingMutant(mutant: FlatMutant): boolean {
  if (mutant.status === 'Killed') return false
  if (mutant.status === 'Ignored') return isEmptyReason(mutant.reason)
  return true
}

function toLocatedMutant(mutant: FlatMutant): LocatedMutant {
  return {
    file: mutant.file,
    line: mutant.line,
    col: mutant.col,
    mutator: mutant.mutator,
    status: mutant.status,
    reason: mutant.reason,
  }
}

// ---------------------------------------------------------------------------
// Pure classifier — report JSON in, verdict + located mutant list out
// ---------------------------------------------------------------------------

/**
 * Classifies a mutation run from the parsed JSON report plus a separately
 * computed set of source-level directive violations. Never trusts an exit
 * code: the report's per-mutant `status` values are the only classification
 * input. Every failing verdict lists every mutant in every failing class, not
 * only the class that won precedence, so a single run gives the whole picture.
 *
 * `missingMutateFiles` is the list of literal (non-glob) `mutate` entries that did not exist
 * on disk (see readMutateFileContents) — Stryker's ProjectReader warns per unresolvable
 * pattern and continues, so a majority of a `mutate` set can silently drop out while the
 * remainder instruments and reports `clean`. Any non-empty list here fails closed, with the
 * missing paths named in the reason so a red build says exactly what to fix. Glob entries are
 * exempt (see isLiteralPath's docstring) since a glob resolving to zero files is a config
 * shape the enumeration guard (`scripts/mutation-guards-config.test.ts`) owns, not this
 * wrapper.
 *
 * `reportPath` names the report file in the `EmptyReport` reason when the report is
 * well-formed but empty; it does not affect classification, only that message's accuracy
 * under an injected report path.
 *
 * `literalMutateEntries` is the full list of literal (non-glob) `mutate` entries — every one
 * of them, whether or not it existed on disk (see `missingMutateFiles` for the disk check).
 * This closes two specific config-level-suppression channels this wrapper otherwise has no
 * visibility into, each proven by its own test — no claim wider than that is made:
 * 1. **Absent key.** A listed entry, normalized, does not appear as a key in the report's
 *    `files` map at all. A `!x.ts` exclude pattern shadowing a listed entry can cause this.
 *    Entries already reported via `missingMutateFiles` are skipped here (they cannot possibly
 *    be report keys either, and are already explained by a more specific reason).
 * 2. **All-Ignored file.** A listed entry's key is present, but every mutant under it has
 *    status `Ignored` (including the vacuous case of zero mutants at all) — verified live
 *    against a real Stryker run: `ignoreStatic`/`excludedMutations` can leave the key present
 *    with every mutant `Ignored` and a non-empty framework `statusReason`, which
 *    `isFailingMutant` correctly treats as non-failing on its own, so a file entirely
 *    suppressed this way would otherwise silently read as `clean`.
 *
 * `reporterConfig`, when given, cross-checks `stryker.config.json` itself against the
 * `reportPath` this wrapper actually reads: `mutationReportPath` and the config's
 * `jsonReporter.fileName` are two independent declarations with no other cross-check, so a
 * config edit that changes one without the other (or drops `"json"` from `reporters`
 * entirely) would silently make the wrapper read a stale or nonexistent report. Fails closed
 * on either mismatch, naming both the expected and actual values.
 *
 * `readError`, when given, is the raw error message from the attempt to read/parse the
 * report file (see readMutationReport) — threaded through so the `RuntimeError` sentinel
 * below can name the actual cause (ENOENT, JSON syntax error) instead of a generic message,
 * for whichever of the three ways a report can be unreadable actually occurred.
 *
 * `configuredTestFiles` is the full list of literal (non-glob) `vitest.testFiles` entries from
 * `stryker.config.json`, normalized the same way as `literalMutateEntries`. Every entry must
 * appear in the report's top-level `testFiles` map with at least one test, or this fails
 * closed with `instrumentation-failed` — see `extractReportTestFileCounts`'s docstring for the
 * confirmed failure mode this closes: a configured test file the dry run silently dropped,
 * which otherwise reads as a legitimate `NoCoverage`/`mutants-uncovered` result for every
 * module that test file was the sole coverage for. Only meaningful when the report is
 * otherwise readable, mirroring `entriesAbsentFromReport` above. A readable report with no
 * `testFiles` map at all is a distinct, more severe case than any single entry being absent
 * from it — nothing about any configured test file can be verified — and fails closed
 * separately via `TestFilesMapMissing` rather than silently skipping the check (which is what
 * `extractReportTestFileCounts` returning `undefined` would otherwise cause).
 */
export function classifyMutationReport(
  reportJson: unknown,
  directiveViolations: readonly LocatedMutant[],
  missingMutateFiles: readonly string[] = [],
  reportPath: string = mutationReportPath,
  literalMutateEntries: readonly string[] = [],
  reporterConfig?: ReporterConfig,
  readError?: string,
  configuredTestFiles: readonly string[] = [],
): ClassificationResult {
  const flat = flattenReport(reportJson)

  const reportUnreadable = flat === undefined
  const hasMissingMutateFiles = missingMutateFiles.length > 0

  const reporterConfigMismatchReasons: string[] = []
  if (reporterConfig !== undefined) {
    if (!reporterConfig.reporters.includes('json')) {
      reporterConfigMismatchReasons.push(
        `stryker.config.json "reporters" does not include "json" (got ${JSON.stringify(reporterConfig.reporters)})`,
      )
    }
    if (reporterConfig.resolvedJsonReportPath !== reportPath) {
      reporterConfigMismatchReasons.push(
        `stryker.config.json "jsonReporter.fileName" resolves to "${reporterConfig.resolvedJsonReportPath}", but the wrapper reads "${reportPath}"`,
      )
    }
  }
  const hasReporterConfigMismatch = reporterConfigMismatchReasons.length > 0

  const normalizedMissing = new Set(missingMutateFiles.map(normalizeMutatePath))
  const reportFileKeys = extractReportFileKeys(reportJson)
  const normalizedReportFileKeys = new Set((reportFileKeys ?? []).map(normalizeMutatePath))
  // Only meaningful when the report is otherwise readable — an unreadable report already
  // fails via reportUnreadable, and reportFileKeys is undefined in that case anyway.
  const entriesAbsentFromReport =
    reportFileKeys === undefined
      ? []
      : literalMutateEntries
          .map(normalizeMutatePath)
          .filter(entry => !normalizedMissing.has(entry) && !normalizedReportFileKeys.has(entry))
  const hasEntriesAbsentFromReport = entriesAbsentFromReport.length > 0

  // Per-file grouping (keyed by the same normalization as the absent-key check) so an entry
  // present in `files` but whose mutants are all `Ignored` — config-level suppression via
  // `ignoreStatic`/`excludedMutations`, invisible any other way — can be told apart from a
  // file that genuinely has surviving/killed mutants.
  const flatByNormalizedFile = new Map<string, FlatMutant[]>()
  for (const mutant of flat ?? []) {
    const key = normalizeMutatePath(mutant.file)
    const bucket = flatByNormalizedFile.get(key)
    if (bucket === undefined) {
      flatByNormalizedFile.set(key, [mutant])
    } else {
      bucket.push(mutant)
    }
  }
  const vacuouslyIgnoredEntries =
    reportFileKeys === undefined
      ? []
      : literalMutateEntries.map(normalizeMutatePath).filter(entry => {
          if (normalizedMissing.has(entry) || !normalizedReportFileKeys.has(entry)) return false
          const mutants = flatByNormalizedFile.get(entry) ?? []
          return mutants.every(m => m.status === 'Ignored')
        })
  const hasVacuouslyIgnoredEntries = vacuouslyIgnoredEntries.length > 0

  // Only meaningful when the report is otherwise readable — an unreadable report already
  // fails via reportUnreadable, and reportTestFileCounts is undefined in that case anyway (the
  // report never gets far enough to have a testFiles map worth trusting).
  const reportTestFileCounts = extractReportTestFileCounts(reportJson)
  const normalizedReportTestFileCounts =
    reportTestFileCounts === undefined
      ? undefined
      : new Map([...reportTestFileCounts].map(([key, count]) => [normalizeMutatePath(key), count]))
  const testFilesNotExecuted =
    normalizedReportTestFileCounts === undefined
      ? []
      : configuredTestFiles
          .map(normalizeMutatePath)
          .filter(entry => (normalizedReportTestFileCounts.get(entry) ?? 0) === 0)
  const hasTestFileNotExecuted = testFilesNotExecuted.length > 0

  // A readable report with no top-level `testFiles` map at all cannot verify any configured
  // test file was executed — `extractReportTestFileCounts` returns `undefined` for this shape
  // exactly as it does for an unreadable report, but the two cases are not equivalent: an
  // unreadable report already fails via `reportUnreadable` on its own, while a *readable*
  // report missing only its `testFiles` map would otherwise silently skip the
  // configured-test-file check entirely (`testFilesNotExecuted` above is `[]` in both cases).
  // Gated on `configuredTestFiles.length > 0` so a caller that never passes any configured
  // test files (every existing call site before this check existed, and any fixture report
  // without a `testFiles` map) is unaffected.
  const hasTestFilesMapMissing =
    configuredTestFiles.length > 0 && flat !== undefined && reportTestFileCounts === undefined

  // A well-formed report whose flattened mutant list is empty means every `mutate` entry
  // failed to resolve or instrument (Stryker still exits 0 and writes `{"files":{}}` in this
  // case) — an enumerated set of real modules cannot legitimately yield zero mutants. Reading
  // this as `clean` would be the exact vacuous-pass this checker exists to prevent; only
  // `not-applicable` (the changed-file trigger gate) is allowed to mean "nothing to check", and
  // this classifier never produces that verdict, so an empty report always fails closed here.
  // Redundant with hasMissingMutateFiles whenever every `mutate` entry is literal (the missing
  // entries alone already explain the empty report), but still load-bearing for a `mutate`
  // set that is pure glob: a glob resolving to zero files produces no missingMutateFiles entry
  // (globs are exempt from that check) yet still yields an empty, invalid report.
  const reportEmpty = flat !== undefined && flat.length === 0
  const hasUnrecognizedStatus = (flat ?? []).some(
    m => INCOMPLETE_RUN_STATUSES.has(m.status) || !KNOWN_MUTANT_STATUSES.has(m.status),
  )
  const hasIgnoredWithoutReason = (flat ?? []).some(m => m.status === 'Ignored' && isEmptyReason(m.reason))

  let verdict: Verdict
  if (
    reportUnreadable ||
    reportEmpty ||
    hasMissingMutateFiles ||
    hasEntriesAbsentFromReport ||
    hasVacuouslyIgnoredEntries ||
    hasReporterConfigMismatch ||
    hasUnrecognizedStatus ||
    hasTestFileNotExecuted ||
    hasTestFilesMapMissing
  ) {
    verdict = 'instrumentation-failed'
  } else if (directiveViolations.length > 0 || hasIgnoredWithoutReason) {
    verdict = 'directive-violation'
  } else if (flat.some(m => m.status === 'Timeout')) {
    verdict = 'mutant-timeout'
  } else if (flat.some(m => m.status === 'NoCoverage')) {
    verdict = 'mutants-uncovered'
  } else if (flat.some(m => m.status === 'Survived')) {
    verdict = 'mutants-survived'
  } else {
    verdict = 'clean'
  }

  const unreadableReportMutant: LocatedMutant[] = reportUnreadable
    ? [
        {
          file: reportPath,
          line: 0,
          col: 0,
          mutator: 'ReportUnreadable',
          status: 'RuntimeError',
          reason: describeUnreadableReport(reportJson, readError),
        },
      ]
    : []

  const emptyReportMutant: LocatedMutant[] = reportEmpty
    ? [
        {
          file: reportPath,
          line: 0,
          col: 0,
          mutator: 'report',
          status: 'EmptyReport',
          reason: 'report contains no mutants; every `mutate` entry failed to resolve or instrument',
        },
      ]
    : []

  const reporterConfigMismatchMutants: LocatedMutant[] = hasReporterConfigMismatch
    ? [
        {
          file: 'stryker.config.json',
          line: 0,
          col: 0,
          mutator: 'report',
          status: 'ReporterConfigMismatch',
          reason: reporterConfigMismatchReasons.join('; '),
        },
      ]
    : []

  const missingMutateFileMutants: LocatedMutant[] = missingMutateFiles.map(missingPath => ({
    file: missingPath,
    line: 0,
    col: 0,
    mutator: 'mutate-config',
    status: 'MissingMutateFile',
    reason: 'listed in the `mutate` config but not found on disk; Stryker silently drops it and continues',
  }))

  const absentFromReportMutants: LocatedMutant[] = entriesAbsentFromReport.map(absentPath => ({
    file: absentPath,
    line: 0,
    col: 0,
    mutator: 'mutate-config',
    status: 'AbsentFromReport',
    reason:
      "listed in the `mutate` config and present on disk, but absent from the report's `files` map " +
      '(likely suppressed by `ignoreStatic`, `excludedMutations`, or a shadowing `!` exclude pattern)',
  }))

  const vacuouslyIgnoredMutants: LocatedMutant[] = vacuouslyIgnoredEntries.map(vacuousPath => {
    const count = (flatByNormalizedFile.get(vacuousPath) ?? []).length
    return {
      file: vacuousPath,
      line: 0,
      col: 0,
      mutator: 'mutate-config',
      status: 'AllMutantsIgnored',
      reason: `all ${String(count)} mutants ignored (likely \`ignoreStatic\` or \`excludedMutations\`); the file is present in the report but contributes no evaluable mutants`,
    }
  })

  const testFileNotExecutedMutants: LocatedMutant[] = testFilesNotExecuted.map(path => ({
    file: path,
    line: 0,
    col: 0,
    mutator: 'vitest-config',
    status: 'TestFileNotExecuted',
    reason:
      'no tests executed from a configured test file; the dry run dropped it ' +
      '(check for an unparseable instrumented module)',
  }))

  const testFilesMapMissingMutant: LocatedMutant[] = hasTestFilesMapMissing
    ? [
        {
          file: reportPath,
          line: 0,
          col: 0,
          mutator: 'report',
          status: 'TestFilesMapMissing',
          reason:
            `report has no top-level "testFiles" map, so ${String(configuredTestFiles.length)} configured ` +
            'test file(s) cannot be verified as executed',
        },
      ]
    : []

  const reportedFromReport = (flat ?? []).filter(isFailingMutant).map(toLocatedMutant)
  const mutants = [
    ...reportedFromReport,
    ...unreadableReportMutant,
    ...emptyReportMutant,
    ...missingMutateFileMutants,
    ...absentFromReportMutants,
    ...vacuouslyIgnoredMutants,
    ...reporterConfigMismatchMutants,
    ...testFileNotExecutedMutants,
    ...testFilesMapMissingMutant,
    ...directiveViolations,
  ].sort(compareLocatedMutants)

  return {verdict, mutants}
}

function compareLocatedMutants(a: LocatedMutant, b: LocatedMutant): number {
  return a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col
}

// ---------------------------------------------------------------------------
// Directive scanner — conservative textual rule over the `mutate` file set
// ---------------------------------------------------------------------------

/**
 * Replaces the contents of every string/template literal on a line with spaces of the same
 * length, so column offsets and downstream regex matches stay aligned. Comment-aware: a
 * quote character inside a `//` or `/* ... *\/` comment (an apostrophe in ordinary prose is
 * the common case, not just a regex literal) must never be treated as opening a string —
 * doing so would swallow everything after it on the line, including a directive that starts
 * a later comment on the same line (e.g. `/* what's up *\/ // Stryker disable all`, or
 * `const x = 1 // it's fine /* Stryker disable all *\/`). So while scanning outside a
 * string: a `//` stops all further stripping for the rest of the line (it is copied through
 * unmodified, since nothing after a line comment can be code); a `/*` is copied through
 * unmodified up to its matching `*\/` (or end of line, for a comment left open on this line)
 * and scanning resumes after it. Verified empirically that Stryker honors a directive
 * comment anywhere on a line — including trailing a statement, e.g. `if (flag) return 'a'
 * // Stryker disable all` — via Babel's `leadingComments` attachment to the following node,
 * so the scanner looks for the phrase anywhere on the line, not only at its start (see
 * findDirectivesOnLine). Stripping strings first keeps a directive-shaped string literal
 * (e.g. `const message = '// Stryker disable all'`) from ever being mistaken for a real
 * directive.
 *
 * Known narrow gap (fails open), verified: this stripper still has no regex-literal state,
 * so a quote inside a *regex literal* that precedes a comment (e.g.
 * `const re = /['"]/ // Stryker disable all`) still opens a phantom string — the regex's `/`
 * is ordinary code (not `//` or `/*`), so comment-detection never triggers, and the
 * unmatched `'` before the `"` inside `['"]` opens a string that never finds its closing
 * quote on this line, blanking everything after it, directive included. Accepted as a
 * narrow, documented limitation rather than a full tokenizer — a directive line sharing a
 * line with a regex literal is rare in this codebase's guard modules.
 */
function stripStringLiterals(line: string): string {
  let result = ''
  let quote: string | undefined
  let i = 0
  while (i < line.length) {
    const char = line[i] ?? ''
    if (quote !== undefined) {
      if (char === '\\') {
        result += '  '
        i += 2
        continue
      }
      if (char === quote) quote = undefined
      result += ' '
      i += 1
      continue
    }
    if (char === '/' && line[i + 1] === '/') {
      result += line.slice(i)
      break
    }
    if (char === '/' && line[i + 1] === '*') {
      const closeIndex = line.indexOf('*/', i + 2)
      const end = closeIndex === -1 ? line.length : closeIndex + 2
      result += line.slice(i, end)
      i = end
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      result += ' '
      i += 1
      continue
    }
    result += char
    i += 1
  }
  return result
}

interface DirectiveMatch {
  readonly remainder: string
  readonly col: number
}

// Deliberately unanchored, comment-agnostic, and global — see findDirectivesOnLine below for
// why every match on a line matters, not just the first. `\s+` between "Stryker" and
// "disable" (rather than a literal space) is a deliberate divergence beside the
// `\s*`-vs-`\s?` scope-anchor note below: Stryker's own grammar requires exactly one space,
// so `\s+` (one or more) is strictly a superset and fails closed the same direction as the
// rest of this scanner's divergences.
const STRYKER_DISABLE_SEARCH_PATTERN = /Stryker\s+disable\b/gu

/**
 * Finds every `Stryker disable` directive occurrence in a line's stripped text
 * (string/template literal contents blanked first by stripStringLiterals, so a
 * directive-shaped string is never matched), each paired with the remainder of the line
 * after that occurrence (trailing `\r` stripped, for a CRLF-terminated line).
 *
 * Deliberately does NOT try to locate or validate a surrounding comment. An earlier version
 * of this scanner located a specific `//` or `/* ... *\/` comment and evaluated only the
 * first one found per line — but Stryker's DirectiveBookkeeper attaches to *any* leading
 * comment on a node, and a line can carry more than one comment, each with its own
 * independently honored directive. Both `/* a *\/ // Stryker disable all` and
 * `/* a *\/ /* Stryker disable all *\/` suppress mutants under Stryker, and the
 * comment-locating version evaluated only the first, unrelated `/* a *\/` comment and
 * reported zero violations for either. A later fix scanned the whole stripped line for the
 * phrase but still returned only the *first* match — so a line carrying two independently
 * honored directives (e.g. `/* Stryker disable next-line all: ok *\/ // Stryker disable
 * all`) evaluated only the first, and the file-wide second directive was swallowed into the
 * first's remainder text and never separately judged, even though Stryker honors both and
 * would suppress the module entirely. This now finds every occurrence with a global regex
 * and evaluates each independently, so a line can produce more than one violation.
 *
 * Accepted consequences, all fail-closed (a false positive that fails loudly, never a false
 * negative that passes silently):
 * - A JSDoc continuation line (` * Stryker disable all`) is flagged even though Stryker's
 *   own `^`-anchored regex (matched against the whole comment value, no `m` flag) ignores it
 *   — that anchor only ever matches a comment's opening line.
 * - Ordinary prose containing the phrase (e.g. `// Stryker disable directives are banned
 *   here`) is flagged; the directive-violation reason string names this explicitly.
 * - A legitimate directive whose *reason text* itself contains the phrase (e.g. a next-line
 *   directive explaining why disabling is normally rejected) now produces a second,
 *   independent match against that reason text, which will itself fail the scope/reason
 *   check and add a second violation for the same line — an extra fail-closed false positive
 *   on an already-rare phrasing, not a missed real directive.
 * - Stryker's own looser anchor (`^\s?`, at most one leading space) vs. no anchor at all
 *   here is moot: unanchored scanning is strictly more permissive than either, by design.
 *
 * Known narrow gap, unchanged from stripStringLiterals: no regex-literal state, so a quote
 * inside a same-line regex literal can open a phantom string and hide a real directive.
 */
function findDirectivesOnLine(line: string): DirectiveMatch[] {
  const stripped = stripStringLiterals(line)
  const matches: DirectiveMatch[] = []
  for (const match of stripped.matchAll(STRYKER_DISABLE_SEARCH_PATTERN)) {
    const start = match.index
    const remainder = stripped.slice(start + match[0].length).replace(/\r$/u, '')
    matches.push({remainder, col: start + 1})
  }
  return matches
}

/**
 * Requires a literal `: ` (colon-space) before the reason. Stryker's own grammar is looser
 * — `(?::(.+)?)?` accepts `:reason` with no space — so this is a deliberate, stricter
 * divergence: it fails closed on `:reason` rather than accepting it, which is the safe
 * direction for a check whose whole point is refusing to guess at intent.
 */
function evaluateDirectiveLine(remainder: string): {ok: boolean; reason: string} {
  // Scope must be evaluated on a prefix anchored to the start of the remainder — a
  // substring search over the whole remainder (including the reason text) let a reason
  // that merely mentions "next-line" (e.g. `disable all: next-line scoping is
  // impractical here`) pass region/all suppression through undetected.
  if (!/^\s*next-line\b/u.test(remainder)) {
    return {
      ok: false,
      reason:
        'Stryker disable directive must be next-line scoped; region/all suppression is rejected ' +
        '(this also fires on ordinary prose that happens to contain "Stryker disable", e.g. ' +
        '"// Stryker disable directives are banned here" — rephrase the comment to avoid the phrase)',
    }
  }
  const colonIndex = remainder.indexOf(': ')
  const providedReason = colonIndex === -1 ? '' : remainder.slice(colonIndex + 2).trim()
  if (providedReason.length === 0) {
    return {ok: false, reason: 'Stryker disable next-line directive is missing a non-empty reason'}
  }
  return {ok: true, reason: ''}
}

/**
 * Scans the given files (expected to be exactly the configured `mutate` set) for `Stryker
 * disable` comment directives and reports every occurrence on every line that is not
 * `next-line` scoped with a non-empty reason. A single line can produce more than one
 * violation (see findDirectivesOnLine). Exported for unit testing.
 */
export function scanDirectiveViolations(files: readonly DirectiveScanInput[]): LocatedMutant[] {
  const violations: LocatedMutant[] = []

  for (const {file, content} of files) {
    const lines = content.split('\n')
    for (const [index, line] of lines.entries()) {
      for (const directive of findDirectivesOnLine(line)) {
        const evaluation = evaluateDirectiveLine(directive.remainder)
        if (evaluation.ok) continue
        violations.push({
          file,
          line: index + 1,
          col: directive.col,
          mutator: 'directive',
          status: 'DirectiveViolation',
          reason: evaluation.reason,
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Runner — spawns Stryker, reads the report, classifies, prints
// ---------------------------------------------------------------------------

export interface StrykerConfigShape {
  readonly mutate: readonly string[]
  /**
   * Explicit same-tree test list. Optional in Stryker's own schema (absent means Stryker's
   * `vitest.related` selection applies instead), so an absent field here defaults to `[]`
   * rather than throwing — this wrapper never spawns Stryker off a config-shape guess, and
   * the enumeration guard (`scripts/mutation-guards-config.test.ts`) is the consumer that
   * needs this field, not the classifier.
   */
  readonly testFiles: readonly string[]
  readonly reporters: readonly string[]
  /**
   * Raw `jsonReporter.fileName` from config, or Stryker's own documented default
   * (`reports/mutation/mutation.json`, relative to the config file's directory) when absent.
   */
  readonly jsonReportFileName: string
}

export function readStrykerConfig(path: string): StrykerConfigShape {
  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.mutate) ||
    !parsed.mutate.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new Error(`check-mutation-guards: ${path} is missing a string[] "mutate" field`)
  }

  if (
    parsed.testFiles !== undefined &&
    (!Array.isArray(parsed.testFiles) || !parsed.testFiles.every((entry): entry is string => typeof entry === 'string'))
  ) {
    throw new Error(`check-mutation-guards: ${path} "testFiles" must be a string[] when present`)
  }
  const testFiles: readonly string[] = Array.isArray(parsed.testFiles) ? parsed.testFiles : []

  // `reporters` is optional in Stryker's own schema, so an absent field defaults to `[]` here
  // (which then legitimately fails the "does not include json" cross-check downstream). A
  // *present* field of the wrong shape (e.g. a bare string instead of an array) is a config
  // error, not an empty list — it throws with the same named-error shape as "mutate" above,
  // rather than silently coercing to `[]` and reporting a misleading "got []" mismatch reason.
  if (
    parsed.reporters !== undefined &&
    (!Array.isArray(parsed.reporters) || !parsed.reporters.every((entry): entry is string => typeof entry === 'string'))
  ) {
    throw new Error(`check-mutation-guards: ${path} "reporters" must be a string[] when present`)
  }
  const reporters: readonly string[] = Array.isArray(parsed.reporters) ? parsed.reporters : []

  const jsonReporter = isRecord(parsed.jsonReporter) ? parsed.jsonReporter : undefined
  const jsonReportFileName =
    jsonReporter !== undefined && typeof jsonReporter.fileName === 'string'
      ? jsonReporter.fileName
      : 'reports/mutation/mutation.json'

  return {mutate: parsed.mutate, testFiles, reporters, jsonReportFileName}
}

/**
 * Resolves the default `ReporterConfig` for a given `stryker.config.json` path: its declared
 * `reporters`, and `jsonReporter.fileName` (or Stryker's own documented default) resolved
 * relative to the *directory containing the config file* — matching Stryker's own resolution
 * semantics — not the repository root. For this project's real config the two happen to be
 * the same directory, so this only matters when `configPath` is injected under a
 * subdirectory (as a test can do). Exported as the single seam `runMutationGuardCheck` uses
 * to build its default `reporterConfig` when no override is given.
 */
export function resolveReporterConfig(configPath: string): ReporterConfig {
  return reporterConfigFrom(readStrykerConfig(configPath), configPath)
}

// Same resolution from an already-parsed config, so the production path parses the file once.
function reporterConfigFrom(config: StrykerConfigShape, configPath: string): ReporterConfig {
  return {
    reporters: config.reporters,
    resolvedJsonReportPath: join(dirname(configPath), config.jsonReportFileName),
  }
}

// Stryker filters `mutate` entries through minimatch, whose pattern grammar is wider than
// `*`/`?`: braces (`{a,b}`), character classes (`[k]`), and the extglob forms `+(x)`, `@(x)`,
// `!(x)` are all patterns too, and a leading `!` is Stryker's own ignore-pattern prefix, stripped
// before matching. Any of these treated as literal here would make this function try to
// `readFileSync` a path that was never meant to exist verbatim, feeding a false
// `MissingMutateFile` into an `instrumentation-failed` decision for a working Stryker config.
export const MINIMATCH_METACHARACTER_PATTERN = /^!|[*?[\]{}]|[+@!]\(/u

/**
 * Glob metacharacters (minimatch's, not just `*`/`?`) mark an entry as out of scope for this
 * unit's literal enumerated set. A glob entry is silently skipped for directive scanning here
 * — once `mutate` grows a glob, directive coverage for the files it expands to stops with no
 * signal from this wrapper. The enumeration guard (`scripts/mutation-guards-config.test.ts`)
 * is the intended backstop: it asserts every mutated module is either explicitly listed or
 * explicitly excused, which catches a glob silently absorbing an undirected file the way it
 * catches any other unlisted module.
 */
export function isLiteralPath(entry: string): boolean {
  return !MINIMATCH_METACHARACTER_PATTERN.test(entry)
}

export interface MutateFileReadResult {
  readonly files: readonly DirectiveScanInput[]
  /**
   * Literal `mutate` entries that did not exist on disk. Glob entries are never included
   * here (see isLiteralPath) — this list is what classifyMutationReport's
   * `missingMutateFiles` fail-closed check is built from.
   */
  readonly missing: readonly string[]
}

/**
 * Reads the content of every literal (non-glob) `mutate` entry, for directive scanning, and
 * separately reports which literal entries were missing on disk. Exported for unit testing
 * of its two documented policy decisions: a glob entry is silently skipped for content-reading
 * purposes (see isLiteralPath), and a missing literal file's content is skipped rather than
 * thrown — but is now surfaced in `missing` rather than swallowed, since
 * classifyMutationReport fails closed on any non-empty `missing` list (a config problem this
 * wrapper used to leave entirely to the enumeration guard, but which also means Stryker
 * silently dropped a mutated module and could report a false `clean`).
 */
export function readMutateFileContents(mutate: readonly string[], root: string): MutateFileReadResult {
  const files: DirectiveScanInput[] = []
  const missing: string[] = []
  for (const relativePath of mutate) {
    if (!isLiteralPath(relativePath)) continue
    try {
      files.push({file: relativePath, content: readFileSync(join(root, relativePath), 'utf8')})
    } catch {
      missing.push(relativePath)
    }
  }
  return {files, missing}
}

interface MutationReportRead {
  readonly json: unknown
  /** The raw error message from the read/parse attempt, or `undefined` on success. */
  readonly readError: string | undefined
}

function readMutationReport(path: string): MutationReportRead {
  try {
    return {json: JSON.parse(readFileSync(path, 'utf8')) as unknown, readError: undefined}
  } catch (error) {
    return {json: undefined, readError: error instanceof Error ? error.message : String(error)}
  }
}

function formatMutantLine(mutant: LocatedMutant): string {
  return `${mutant.file}:${mutant.line}:${mutant.col} ${mutant.mutator} ${mutant.status}`
}

function printResult(result: ClassificationResult): void {
  const lines = [...result.mutants.map(formatMutantLine), result.verdict]
  const output = `${lines.join('\n')}\n`
  process.stdout.write(output)

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath !== undefined && summaryPath !== '') {
    // The step summary carries only the located list and verdict, never the raw
    // Stryker clear-text dump — that stays in the reports/ artifact.
    appendFileSync(summaryPath, output)
  }
}

/**
 * Builds the child env for the Stryker spawn: a copy of `process.env` with
 * `GITHUB_STEP_SUMMARY`, `GH_TOKEN`, and `GITHUB_TOKEN` deleted, never mutating the parent env.
 *
 * Vitest 4 auto-registers its `github-actions` reporter whenever `GITHUB_ACTIONS === 'true'`,
 * and that reporter appends a `## Vitest Test Report` block to `GITHUB_STEP_SUMMARY` on every
 * run. Stryker's vitest runner spawns Vitest once for the dry run and again for every mutant
 * batch, each inheriting the job env by default — so an unfiltered spawn floods the step
 * summary with dozens of blocks. This wrapper is the only writer of the step summary (in
 * `printResult`, after Stryker exits); deleting the key (rather than setting it to `''`) is
 * the safe default — an empty string is still a defined env var and some future check could
 * treat "set but empty" differently from "absent", so this closes the door entirely.
 *
 * `GH_TOKEN`/`GITHUB_TOKEN` are deleted for the same reason and the same way: by the time this
 * spawn happens, the changed-file trigger gate (`evaluateTriggerGate`) has already made every
 * `gh`/GitHub API call this check needs — the token has done its one job. Stryker's dry run and
 * every mutant batch execute this repository's own test suite, including tests that could spawn
 * arbitrary child processes reading `process.env`; neither the token nor its use is something
 * mutated test code should be able to observe or exercise, so it is removed before the spawn
 * rather than trusted to stay unused.
 *
 * Leaves `GITHUB_ACTIONS` untouched so nothing else about CI detection changes for the
 * Stryker/Vitest child process.
 */
function buildStrykerSpawnEnv(): NodeJS.ProcessEnv {
  const env = {...process.env}
  delete env.GITHUB_STEP_SUMMARY
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  return env
}

/**
 * Runs `stryker run` via `spawnSync`; the return value is used only to detect "Stryker did
 * not run at all" for an informational message — the verdict is always derived from the
 * JSON report, never this return value. Exported as an injectable seam for testing.
 */
export function defaultStrykerSpawner(): void {
  const run = spawnSync('pnpm', ['exec', 'stryker', 'run', strykerConfigPath], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: buildStrykerSpawnEnv(),
  })
  if (run.error) {
    process.stderr.write(`check-mutation-guards: stryker did not run: ${run.error.message}\n`)
  } else if (run.status !== 0) {
    process.stderr.write(
      `check-mutation-guards: stryker exited ${String(run.status)} — informational only; the verdict below is derived from the JSON report, not the exit code\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Import closure extractor — moved here from scripts/mutation-guards-config.test.ts so both
// the enumeration guard's same-tree pairing check and this wrapper's changed-file trigger
// gate share one implementation of "what does this file import", rather than two textual
// scanners drifting apart over time.
// ---------------------------------------------------------------------------

// Static `import ... from '...'` / `export ... from '...'` (type-only or not), one or two
// leading dots so both `./x.ts` and a deeper `../../scripts/x.ts` resolve.
const STATIC_RELATIVE_IMPORT_PATTERN = /from\s+['"](\.\.?\/[^'"]+)['"]/gu
// Dynamic `import('./x.ts')` — also matches inside `typeof import('./x.ts')`, since this is a
// plain textual scan with no regard for what precedes `import(`.
const DYNAMIC_IMPORT_STRING_PATTERN = /import\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/gu
// Dynamic `import(`./x${'.js'}`)` — the template literal's raw content is resolved separately
// (see resolveTemplateLiteralSpecifier) since it may carry a literal-only `${...}` interpolation.
const DYNAMIC_IMPORT_TEMPLATE_PATTERN = /import\(\s*`([^`]*)`\s*\)/gu
// A literal-only `${'...'}`/`${"..."}` interpolation inside a template literal specifier.
const TEMPLATE_LITERAL_LOOKUP_PATTERN = /\$\{\s*(['"])((?:\\.|(?!\1).)*)\1\s*\}/gu

/**
 * Injectable seam for every filesystem read the import-closure extractor performs
 * (`directSpecifiers`, `wikiWriteCoreSubpathSourceFiles`), defaulting to a real
 * `readFileSync(path, 'utf8')`. Exists so a test can inject a reader that throws (a
 * permission error, a symlink loop, a race with a concurrent delete) and prove
 * `evaluateTriggerGate` converts that into `instrumentation-failed` rather than letting it
 * escape as an uncaught exception — the same fail-closed contract every other read in this
 * module already has.
 */
export type SourceReader = (absolutePath: string) => string

function defaultReadSource(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
}

/** The one internal package this repo builds, and the two directories a subpath import maps between. */
const WIKI_WRITE_CORE_SRC_DIR = 'packages/wiki-write-core/src'
const WIKI_WRITE_CORE_DIST_DIR = 'packages/wiki-write-core/dist'
// `from '@fro-bot/wiki-write-core'` (bare, group 1 undefined) or
// `from '@fro-bot/wiki-write-core/wiki-slug'` (subpath, group 1 = 'wiki-slug') — matches the
// same three reference shapes as the relative patterns above (static from-clause, dynamic
// `import(...)`, and `export ... from`) in one pattern, since all three share the same
// `from '...'`/`import('...')` text shape this is a plain textual scan over.
const WIKI_WRITE_CORE_SPECIFIER_PATTERN =
  /(?:from\s+['"]|import\(\s*['"])@fro-bot\/wiki-write-core(?:\/([\w-]+))?['"]/gu

/**
 * Resolves a dynamic-import template literal's raw content (e.g. `./x${'.js'}`) by inlining
 * every literal-only `${'...'}`/`${"..."}` interpolation. Returns `undefined` if the result
 * still contains an unresolved `${` (a non-literal interpolation this scanner cannot follow)
 * or does not start with a relative-path dot, so a specifier this cannot safely resolve is
 * dropped rather than mis-resolved.
 */
function resolveTemplateLiteralSpecifier(raw: string): string | undefined {
  const resolved = raw.replaceAll(TEMPLATE_LITERAL_LOOKUP_PATTERN, (_match, _quote: string, inner: string) => inner)
  if (resolved.includes('${') || !resolved.startsWith('.')) return undefined
  return resolved
}

/**
 * A specifier ending `.js`/`.mjs`/`.cjs` is rewritten to `.ts` — this codebase's dynamic
 * imports and `typeof import(...)` type positions use the compiled-output extension by
 * convention (Node's type-stripping resolution accepts it), but the actual source file on
 * disk, and every `mutate`/`testFiles` config entry, uses `.ts`.
 */
function normalizeSpecifierExtension(specifier: string): string {
  return specifier.replace(/\.(?:js|mjs|cjs)$/u, '.ts')
}

function resolveSpecifier(repoRelativeFilePath: string, specifier: string): string {
  const fileDir = dirname(repoRelativeFilePath)
  return relative(repositoryRoot, resolve(repositoryRoot, fileDir, normalizeSpecifierExtension(specifier))).replaceAll(
    '\\',
    '/',
  )
}

/**
 * Strips `//` line comments and `/* ... *\/` block comments from file content before the
 * import/export patterns run against it, tracking quote state across the whole file (not
 * reset per line, unlike `stripStringLiterals` above) so a multi-line template literal's
 * contents are never mistaken for a comment. Deliberately does **not** reuse
 * `stripStringLiterals`: that function blanks string/template contents to spaces, which would
 * erase the very import specifiers this extractor needs to keep — comment stripping and
 * string blanking cannot share one pass when the specifier lives inside a string, so this is a
 * separate, narrower tool for a separate purpose (proving *reach*, not scanning directives).
 *
 * Only a line-comment's or block-comment's byte span is removed (dropped, not blanked to
 * spaces) — no column-offset preservation is needed here, unlike the directive scanner, since
 * nothing downstream reports a match's position within the original file.
 *
 * Two known gaps, one of them NOT narrow:
 *
 * 1. **Regex-literal quote, file-scoped — fail-open, not a narrow edge case.** Unlike
 *    `stripStringLiterals` (which resets its quote state every line, since it is called
 *    per-line by the directive scanner), this function tracks quote state across the *entire
 *    file* to correctly handle a multi-line template literal. That same file-wide tracking
 *    means an unbalanced quote inside a regex literal (no regex-literal state exists here
 *    either) does not just swallow the rest of one line — it opens a phantom string that can
 *    run to the next matching quote character *anywhere later in the file*, silently
 *    swallowing every comment boundary in between. Accepted only because no such regex
 *    literal currently appears in any file this extractor scans (pinned by a test in
 *    `scripts/mutation-guards-config.test.ts` so a future change to this behavior is
 *    deliberate, not accidental).
 * 2. **Import-shaped text inside a string literal.** An import-shaped specifier appearing
 *    inside* a string literal still matches the import patterns below, since this stripper
 *    never blanks string content — only comments are removed. `reachedModulesTransitive`
 *    filters its direct specifiers through `existsSync`, which closes this for a phantom
 *    target naming a module that does not exist; the residual gap is narrower than "any
 *    import-shaped string" — it is now only an import-shaped string that happens to name a
 *    module that *does* exist on disk. Accepted as a narrow, documented limitation: the
 *    alternative (blanking strings) would break every real specifier this extractor exists to
 *    find.
 */
export function stripComments(content: string): string {
  let result = ''
  let quote: string | undefined
  let i = 0
  while (i < content.length) {
    const char = content[i] ?? ''
    if (quote !== undefined) {
      if (char === '\\') {
        result += content.slice(i, i + 2)
        i += 2
        continue
      }
      if (char === quote) quote = undefined
      result += char
      i += 1
      continue
    }
    if (char === '/' && content[i + 1] === '/') {
      const newlineIndex = content.indexOf('\n', i)
      i = newlineIndex === -1 ? content.length : newlineIndex
      continue
    }
    if (char === '/' && content[i + 1] === '*') {
      const closeIndex = content.indexOf('*/', i + 2)
      i = closeIndex === -1 ? content.length : closeIndex + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      result += char
      i += 1
      continue
    }
    result += char
    i += 1
  }
  return result
}

/**
 * Every relative-path module specifier a file references directly: static import/export
 * `from` clauses, dynamic `import('...')` (including inside `typeof import('...')`), and
 * dynamic `import(\`...\`)` template literals with a literal-only interpolation. Resolved to
 * repo-relative paths. Package specifiers (`@fro-bot/...`, bare module names) never match —
 * every pattern requires a leading `./` or `../` (see `wikiWriteCoreSubpathSourceFiles` for
 * the separate package-specifier scan this wrapper's trigger-set closure also needs).
 */
function directSpecifiers(repoRelativeFilePath: string, readSource: SourceReader): string[] {
  const content = stripComments(readSource(join(repositoryRoot, repoRelativeFilePath)))
  const raw: string[] = []

  for (const match of content.matchAll(STATIC_RELATIVE_IMPORT_PATTERN)) {
    if (match[1] !== undefined) raw.push(match[1])
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_STRING_PATTERN)) {
    if (match[1] !== undefined) raw.push(match[1])
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_TEMPLATE_PATTERN)) {
    if (match[1] === undefined) continue
    const resolved = resolveTemplateLiteralSpecifier(match[1])
    if (resolved !== undefined) raw.push(resolved)
  }

  return raw.map(specifier => resolveSpecifier(repoRelativeFilePath, specifier))
}

/**
 * The set of repo-relative module paths a file "reaches", transitively: every direct
 * relative-path specifier it references (see `directSpecifiers`), plus — followed
 * transitively through any number of hops of ANY relative import (not just re-export barrel
 * hops; a regular `import {x} from './y.ts'` in a reached file is followed exactly the same
 * as an `export * from './y.ts'`), bounded by a visited set so an import cycle cannot loop
 * forever — every module reachable from the starting file by walking relative imports to
 * depth N. Used both by the enumeration guard's same-tree pairing check (a test file that
 * imports a mutated module, directly or via a chain of imports, is treated as covering it)
 * and by this wrapper's changed-file trigger gate (a `mutate`/`testFiles` entry's full import
 * closure, not just its direct imports, must be in the trigger set — a two-hop-away module
 * can still change a mutated module's behavior). Exported for both consumers and for direct
 * testing against a real file (Fro Bot's live `wiki-context-safety.ts`/
 * `wiki-context-safety.test.ts` counterexample, which reaches only through a dynamic
 * `import(\`./wiki-context-safety${'.js'}\`)`, no static import at all).
 *
 * Every direct specifier is filtered through `existsSync` before being added to `reached` —
 * `directSpecifiers` runs its patterns against comment-stripped-but-not-string-blanked content
 * (see `stripComments`), so ordinary fixture text in a `*.test.ts` file that merely *looks*
 * like an import still matches the import patterns and would otherwise produce a phantom
 * reach target that names a file that was never written and does not exist. This closes that
 * case for files that name a genuinely nonexistent module; the residual gap (see
 * `stripComments`'s docstring) is narrower than "any import-shaped string" — it is now only an
 * import-shaped string that happens to name a module that *does* exist on disk.
 */
export function reachedModulesTransitive(
  repoRelativeFilePath: string,
  readSource: SourceReader = defaultReadSource,
): Set<string> {
  const reached = new Set<string>()
  const visited = new Set<string>()
  const followQueue: string[] = []

  for (const target of directSpecifiers(repoRelativeFilePath, readSource)) {
    if (!existsSync(join(repositoryRoot, target))) continue
    reached.add(target)
    followQueue.push(target)
  }

  while (followQueue.length > 0) {
    const current = followQueue.shift()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    if (!existsSync(join(repositoryRoot, current))) continue
    for (const target of directSpecifiers(current, readSource)) {
      if (!existsSync(join(repositoryRoot, target))) continue
      if (reached.has(target)) continue
      reached.add(target)
      followQueue.push(target)
    }
  }

  return reached
}

/**
 * Resolves every `@fro-bot/wiki-write-core[/subpath]` specifier a file references directly
 * (static from-clause, dynamic `import(...)`, or `export ... from`) to the *source* file the
 * subpath's `package.json` `exports` map points to at build time — `<subpath>` (or `index` for
 * the bare package specifier) maps to `packages/wiki-write-core/src/<subpath>.ts`. This is the
 * relative-import extractor's blind spot: a `scripts/` file that imports the package by name
 * (e.g. `scripts/check-private-leak.ts`'s `import {checkPrivateLeak} from
 * '@fro-bot/wiki-write-core/private-leak'`) has no `./`/`../` specifier for `directSpecifiers`
 * to find, so the relative-only reach computation above would never connect it to the source
 * file whose compiled output it actually depends on.
 */
export function wikiWriteCoreSubpathSourceFiles(
  repoRelativeFilePath: string,
  readSource: SourceReader = defaultReadSource,
): string[] {
  const content = stripComments(readSource(join(repositoryRoot, repoRelativeFilePath)))
  const subpaths: string[] = []
  for (const match of content.matchAll(WIKI_WRITE_CORE_SPECIFIER_PATTERN)) {
    subpaths.push(match[1] ?? 'index')
  }
  return subpaths.map(subpath => `${WIKI_WRITE_CORE_SRC_DIR}/${subpath}.ts`)
}

export interface ImportClosure {
  readonly files: ReadonlySet<string>
  /**
   * True when any visited file references the `@fro-bot/wiki-write-core` package by name
   * (any subpath, or the bare barrel) rather than only by relative path — see
   * `wikiWriteCoreSubpathSourceFiles`. `buildTriggerSet` uses this to decide whether the
   * compiled* `packages/wiki-write-core/dist/` directory also needs to be a trigger: a
   * `scripts/` file importing the package resolves against `dist/` at runtime, so a change
   * there (a stale build, a hand-edited compiled file) can change this run's outcome even
   * though no `.ts` source file changed.
   */
  readonly hasWikiWriteCoreSubpathReference: boolean
}

/**
 * The transitive relative-import closure of every entry in `entries` — each entry's own
 * `reachedModulesTransitive` result, plus (recursively) the same for every
 * `@fro-bot/wiki-write-core` subpath specifier reference resolved to its source file (see
 * `wikiWriteCoreSubpathSourceFiles`), so a package-by-name reference from a `mutate`/
 * `testFiles` entry still pulls its source counterpart — and that counterpart's own further
 * imports — into the closure. `entries` itself is not included in the returned `files`; the
 * caller (`buildTriggerSet`) already has the raw config entries and unions them in separately.
 *
 * A glob entry (per `isLiteralPath`) or an entry that does not exist on disk is skipped
 * without attempting to read it — the same defensive posture as `readMutateFileContents`.
 */
export function buildImportClosure(
  entries: readonly string[],
  readSource: SourceReader = defaultReadSource,
): ImportClosure {
  const files = new Set<string>()
  const visited = new Set<string>()
  const queue: string[] = [...entries]
  let hasWikiWriteCoreSubpathReference = false

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) continue
    const normalized = normalizeMutatePath(current)
    if (visited.has(normalized)) continue
    visited.add(normalized)
    if (!isLiteralPath(normalized) || !existsSync(join(repositoryRoot, normalized))) continue

    for (const target of reachedModulesTransitive(normalized, readSource)) {
      files.add(target)
    }

    for (const srcFile of wikiWriteCoreSubpathSourceFiles(normalized, readSource)) {
      hasWikiWriteCoreSubpathReference = true
      files.add(srcFile)
      if (!visited.has(srcFile)) queue.push(srcFile)
    }
  }

  return {files, hasWikiWriteCoreSubpathReference}
}

// ---------------------------------------------------------------------------
// Changed-file trigger gate — short-circuits a pull_request run that cannot possibly be
// affected by anything Stryker mutates or executes.
// ---------------------------------------------------------------------------

/**
 * Fixed infrastructure files the mutation run depends on beyond the enumerated `mutate`/
 * `testFiles` set: the Stryker/vitest/package configs that shape how the run resolves and
 * executes; the wrapper and its own config-enumeration test (self-referential — a change to
 * either changes what this check enforces or how); the workflow file that defines this very
 * job (a job rename or trigger change is itself worth a run); the shared setup action every
 * job (including this one) depends on to install and cache dependencies; and the two
 * `tsconfig*.json` files whose settings affect how the mutated TypeScript compiles.
 * `quartz-site/tsconfig.json` is deliberately excluded — it configures an unrelated
 * documentation-site build, not anything Stryker mutates or runs.
 */
const FIXED_TRIGGER_FILES: readonly string[] = [
  'stryker.config.json',
  'mutation-guards.json',
  'vitest.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/check-mutation-guards.ts',
  'scripts/mutation-guards-config.test.ts',
  '.github/workflows/main.yaml',
  '.github/actions/setup/action.yaml',
  'packages/wiki-write-core/package.json',
  'tsconfig.json',
  'packages/wiki-write-core/tsconfig.build.json',
]

export interface TriggerSet {
  readonly files: ReadonlySet<string>
  /**
   * Directory-prefix triggers: a changed file matches when its normalized path *starts with*
   * one of these prefixes, not just on exact membership in `files`. Currently only ever
   * `packages/wiki-write-core/dist/` (see `hasGlobEntries`'s sibling concern, `hasGlobEntries`
   * below, for the analogous reasoning) — the compiled output of a package the trigger set's
   * import closure references by name, per `ImportClosure.hasWikiWriteCoreSubpathReference`.
   * Any file under it (an individual `dist/<x>.js`, its `.d.ts`, or a new file the build adds)
   * matches, since this gate has no reliable way to map a `scripts/` file's package-by-name
   * import to only the one compiled artifact it actually resolves to at run time.
   */
  readonly directoryPrefixes: readonly string[]
  /**
   * True when any `mutate`/`testFiles` entry contains a glob metacharacter (per
   * `isLiteralPath`). A glob's expansion depends on the file tree at run time, which this
   * gate has no cheap way to evaluate against a changed-file list without vendoring a
   * minimatch implementation — the simplest correct behavior is to never short-circuit when a
   * glob is present: `evaluateTriggerGate` always proceeds to run Stryker in that case, since
   * a changed file might be one the glob newly matches.
   */
  readonly hasGlobEntries: boolean
  /**
   * The number of `files` entries contributed solely by the import closure (`buildImportClosure`)
   * — i.e. `files.size` minus the raw `mutate`/`testFiles`/fixed-infrastructure entries. Printed
   * in the `not-applicable` summary so a red-team reading CI output can see at a glance whether
   * the closure computed anything beyond the literal enumerated set.
   */
  readonly closureSize: number
}

/**
 * Builds the changed-file trigger set from the Stryker config itself — every `mutate` and
 * `testFiles` entry (literal or glob), the fixed infrastructure list above, AND the transitive
 * relative-import closure of every `mutate`/`testFiles` entry (`buildImportClosure`) — rather
 * than a second, hand-maintained list that could silently drift out of sync with what this
 * check actually mutates or executes.
 *
 * The closure is load-bearing, not cosmetic: without it, a pull request touching only
 * `packages/wiki-write-core/src/wiki-slug.ts` (imported by the already-mutated
 * `private-leak-adapter.ts`, but itself only `not-mutated`/pending relocation) would read
 * `not-applicable` and never run Stryker at all — a fail-open this wrapper exists to prevent
 * for every other kind of drift. Entries are normalized the same way as everywhere else in
 * this module (`normalizeMutatePath`, stripping a single leading `./`).
 *
 * `readSource` is an injectable seam (defaults to a real `readFileSync`) passed straight
 * through to `buildImportClosure`, so a test can force the closure walk's filesystem reads to
 * throw — `evaluateTriggerGate` calls this from inside its own `try` specifically so that
 * throw is caught and converted to `instrumentation-failed`, never left to escape uncaught.
 */
export function buildTriggerSet(config: StrykerConfigShape, readSource: SourceReader = defaultReadSource): TriggerSet {
  const configEntries = [...config.mutate, ...config.testFiles]
  const hasGlobEntries = configEntries.some(entry => !isLiteralPath(entry))
  const baseFiles = new Set([...configEntries, ...FIXED_TRIGGER_FILES].map(normalizeMutatePath))
  const closure = buildImportClosure(configEntries, readSource)
  const files = new Set([...baseFiles, ...closure.files])
  const closureSize = [...closure.files].filter(file => !baseFiles.has(file)).length
  const directoryPrefixes = closure.hasWikiWriteCoreSubpathReference ? [`${WIKI_WRITE_CORE_DIST_DIR}/`] : []
  return {files, directoryPrefixes, hasGlobEntries, closureSize}
}

/**
 * Whether any changed file (normalized) is a member of the trigger set — an exact `files`
 * match, or a prefix match against one of `directoryPrefixes` (see `TriggerSet`'s docstring).
 */
export function changedFilesIntersectTriggerSet(changedFiles: readonly string[], triggerSet: TriggerSet): boolean {
  return changedFiles.some(file => {
    const normalized = normalizeMutatePath(file)
    if (triggerSet.files.has(normalized)) return true
    return triggerSet.directoryPrefixes.some(prefix => normalized.startsWith(prefix))
  })
}

/**
 * The two functions the changed-file gate needs from a `pull_request` event: reading the
 * event payload (`readPullRequestContext`) and fetching the PR's changed files
 * (`fetchChangedFiles`) — both reused directly from `scripts/check-wiki-authority.ts`, which
 * already implements this exact `pull_request`-event shape for its own PR-scoped guard, rather
 * than duplicating event-payload parsing and paginated-API fetching a second time.
 */
export interface ChangedFileGateDeps {
  readonly readPullRequestContext: typeof readPullRequestContext
  readonly fetchChangedFiles: typeof fetchChangedFiles
}

const defaultChangedFileGateDeps: ChangedFileGateDeps = {readPullRequestContext, fetchChangedFiles}

function triggerGateSentinel(
  verdict: 'not-applicable' | 'instrumentation-failed',
  status: string,
  reason: string,
): ClassificationResult {
  return {
    verdict,
    mutants: [{file: 'trigger-gate', line: 0, col: 0, mutator: 'trigger-gate', status, reason}],
  }
}

/**
 * The changed-file trigger gate: on a `pull_request` event, short-circuits to
 * `not-applicable` when none of the PR's changed files intersect the trigger set built by
 * `buildTriggerSet`, so a docs-only PR does not pay for a full Stryker run it cannot possibly
 * affect. Fails closed to `instrumentation-failed` — never `not-applicable` — when the event
 * context cannot be read or the changed-files API call fails, per R9: an inability to
 * determine the trigger set is never treated as "nothing to check".
 *
 * Returns `undefined` when the caller should proceed to run Stryker exactly as it did before
 * this gate existed: either the event is not a `pull_request` (a local run, `workflow_dispatch`,
 * or a post-merge `push` to `main` all run the full check unconditionally, unaffected by this
 * gate), or a `pull_request` event whose changed files DO intersect the trigger set (or whose
 * `mutate`/`testFiles` config contains a glob entry — see `TriggerSet.hasGlobEntries`).
 *
 * `env` and `deps` are injectable seams (both default to the real environment/functions) so
 * tests can drive every precedence case — no PR context, a fetch failure, no intersection, an
 * intersection — without setting real environment variables, writing a real event-payload
 * file, or ever invoking `gh`. `readSource` is a fourth injectable seam, passed straight
 * through to `buildTriggerSet`'s closure walk (defaults to a real `readFileSync`); a test can
 * inject a reader that throws to prove a filesystem failure during the closure walk itself
 * (not just the PR-context/API calls) is also caught here and converted to
 * `instrumentation-failed` rather than escaping uncaught to `main()`'s caller.
 *
 * `buildTriggerSet` is called from inside the `try` block, not before it: computing the
 * trigger set requires reading every `mutate`/`testFiles` entry's source (`buildImportClosure`),
 * and any read failure there is exactly the kind of "cannot determine the trigger set"
 * condition this gate must fail closed on, per the same R9 contract as an unreadable PR
 * context or a failed changed-files API call.
 */
export async function evaluateTriggerGate(
  config: StrykerConfigShape,
  env: {readonly eventName?: string; readonly eventPath?: string} = {
    eventName: process.env.GITHUB_EVENT_NAME,
    eventPath: process.env.GITHUB_EVENT_PATH,
  },
  deps: ChangedFileGateDeps = defaultChangedFileGateDeps,
  readSource: SourceReader = defaultReadSource,
): Promise<ClassificationResult | undefined> {
  if (env.eventName !== 'pull_request') return undefined

  try {
    const triggerSet = buildTriggerSet(config, readSource)

    if (env.eventPath === undefined || env.eventPath === '') {
      throw new Error('GITHUB_EVENT_PATH not set for a pull_request event')
    }
    const {prNumber, fullName} = await deps.readPullRequestContext(env.eventPath)
    if (fullName === null) {
      throw new Error('pull_request.base.repo.full_name missing from the event payload')
    }
    const changedFiles = deps.fetchChangedFiles(prNumber, fullName)

    if (triggerSet.hasGlobEntries || changedFilesIntersectTriggerSet(changedFiles, triggerSet)) {
      return undefined
    }

    return triggerGateSentinel(
      'not-applicable',
      'NotApplicable',
      `none of ${String(changedFiles.length)} changed file(s) matched the ${String(triggerSet.files.size)}-file trigger set ` +
        `(${String(triggerSet.closureSize)} from the import closure); nothing to check`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return triggerGateSentinel(
      'instrumentation-failed',
      'ChangedFileGateFailed',
      `could not determine the changed-file trigger gate: ${message}`,
    )
  }
}

/**
 * Runs the mutation guard check end to end: reads the config, clears any prior report,
 * spawns Stryker, classifies whatever report exists afterward, and returns the result
 * without printing or setting an exit code (both are `main()`'s concern).
 *
 * Clearing `reportPath` before the spawn is load-bearing: without it, a Stryker process
 * that dies before writing a report (dry-run timeout, missing binary, crash) would leave a
 * previous* run's report on disk, and this check would silently classify that stale report
 * as the current result — including a stale `clean` with exit 0. "Never fail open" is this
 * script's entire contract, so the report is always removed first.
 *
 * `spawner` is an injectable seam (defaults to `defaultStrykerSpawner`) so tests can drive
 * the "Stryker died without writing anything" path without actually running Stryker.
 * `reportPath` is a second injectable seam (defaults to `mutationReportPath`, the real path
 * Stryker writes to) so a test staging or clearing a report never touches the real
 * `reports/mutation/mutation.json` on disk. `reporterConfig` is a third injectable seam
 * (defaults to what is actually read from `stryker.config.json`) so a test injecting a
 * `reportPath` can also inject a `reporterConfig` that agrees with it — without this, every
 * temp-path test would trip the reporter/report-path cross-check regardless of what it is
 * actually trying to prove, since the real config's resolved path never matches a temp path.
 * `triggerGateEnv`/`triggerGateDeps` are the fourth and fifth injectable seams, passed straight
 * through to `evaluateTriggerGate` (the changed-file trigger gate) — both default to the real
 * environment/functions, so an uninjected call behaves exactly as it did before this gate
 * existed for any non-`pull_request` event. The gate runs before the report is cleared or
 * Stryker is spawned: a `not-applicable` or gate-failure result must never touch the report
 * file at all.
 */
export async function runMutationGuardCheck(
  spawner: () => void = defaultStrykerSpawner,
  reportPath: string = mutationReportPath,
  reporterConfig?: ReporterConfig,
  triggerGateEnv?: {readonly eventName?: string; readonly eventPath?: string},
  triggerGateDeps?: ChangedFileGateDeps,
): Promise<ClassificationResult> {
  const config = readStrykerConfig(strykerConfigPath)

  const gateResult = await evaluateTriggerGate(config, triggerGateEnv, triggerGateDeps)
  if (gateResult !== undefined) return gateResult

  rmSync(reportPath, {force: true})
  spawner()

  const {json: reportJson, readError} = readMutationReport(reportPath)
  const {files: directiveFiles, missing: missingMutateFiles} = readMutateFileContents(config.mutate, repositoryRoot)
  const directiveViolations = scanDirectiveViolations(directiveFiles)
  const literalMutateEntries = config.mutate.filter(isLiteralPath)
  const literalTestFileEntries = config.testFiles.filter(isLiteralPath)
  const effectiveReporterConfig: ReporterConfig = reporterConfig ?? reporterConfigFrom(config, strykerConfigPath)
  return classifyMutationReport(
    reportJson,
    directiveViolations,
    missingMutateFiles,
    reportPath,
    literalMutateEntries,
    effectiveReporterConfig,
    readError,
    literalTestFileEntries,
  )
}

/**
 * The exit-code contract for the closed verdict vocabulary: 0 for `clean` and
 * `not-applicable`, 1 for every failing verdict. Exported so the contract has a single,
 * directly testable definition instead of being reconstructed inline wherever a verdict
 * needs to become a process exit code.
 */
export function exitCodeFor(verdict: Verdict): number {
  return verdict === 'clean' || verdict === 'not-applicable' ? 0 : 1
}

async function main(): Promise<void> {
  const result = await runMutationGuardCheck()
  printResult(result)
  process.exitCode = exitCodeFor(result.verdict)
}

// Deliberately use Node's main-module check, exactly as scripts/build-wiki-write-core.ts does:
// `Test Scripts Load` imports every non-test scripts/*.ts, and an import-time Stryker spawn
// would make that job either run the mutation suite or fail.
if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
