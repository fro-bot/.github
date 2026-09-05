import {spawnSync} from 'node:child_process'
import {appendFileSync, readFileSync, rmSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'

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
 * mutant-timeout > mutants-uncovered > mutants-survived > clean. `not-applicable` is a typed
 * seam for Unit 4's changed-file gating; this module never produces it.
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
 * shape Unit 3's enumeration guard owns, not this wrapper.
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
 * otherwise readable, mirroring `entriesAbsentFromReport` above.
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

  // A well-formed report whose flattened mutant list is empty means every `mutate` entry
  // failed to resolve or instrument (Stryker still exits 0 and writes `{"files":{}}` in this
  // case) — an enumerated set of real modules cannot legitimately yield zero mutants. Reading
  // this as `clean` would be the exact vacuous-pass this checker exists to prevent; only
  // `not-applicable` (Unit 4's changed-file gating) is allowed to mean "nothing to check", and
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
    hasTestFileNotExecuted
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
   * Unit 3's enumeration guard is the consumer that needs this field, not the classifier.
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
 * signal from this wrapper. Unit 3's enumeration guard is the intended backstop: it asserts
 * every mutated module is either explicitly listed or explicitly excused, which catches a
 * glob silently absorbing an undirected file the way it catches any other unlisted module.
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
 * wrapper used to leave entirely to Unit 3's enumeration guard, but which also means Stryker
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
 * `GITHUB_STEP_SUMMARY` deleted, never mutating the parent env.
 *
 * Vitest 4 auto-registers its `github-actions` reporter whenever `GITHUB_ACTIONS === 'true'`,
 * and that reporter appends a `## Vitest Test Report` block to `GITHUB_STEP_SUMMARY` on every
 * run. Stryker's vitest runner spawns Vitest once for the dry run and again for every mutant
 * batch, each inheriting the job env by default — so an unfiltered spawn floods the step
 * summary with dozens of blocks. This wrapper is the only writer of the step summary (in
 * `printResult`, after Stryker exits); deleting the key (rather than setting it to `''`) is
 * the safe default — an empty string is still a defined env var and some future check could
 * treat "set but empty" differently from "absent", so this closes the door entirely. Leaves
 * `GITHUB_ACTIONS` untouched so nothing else about CI detection changes for the Stryker/Vitest
 * child process.
 */
function buildStrykerSpawnEnv(): NodeJS.ProcessEnv {
  const env = {...process.env}
  delete env.GITHUB_STEP_SUMMARY
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
 */
export function runMutationGuardCheck(
  spawner: () => void = defaultStrykerSpawner,
  reportPath: string = mutationReportPath,
  reporterConfig?: ReporterConfig,
): ClassificationResult {
  const config = readStrykerConfig(strykerConfigPath)

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
  const result = runMutationGuardCheck()
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
