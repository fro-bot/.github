import {spawnSync} from 'node:child_process'
import {appendFileSync, readFileSync, rmSync} from 'node:fs'
import {join, resolve} from 'node:path'
import process from 'node:process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const strykerConfigPath = join(repositoryRoot, 'stryker.config.json')
// Exported so tests can stage/inspect a stale report at the exact path the runner reads.
export const mutationReportPath = join(repositoryRoot, 'reports', 'mutation', 'mutation.json')

// ---------------------------------------------------------------------------
// Closed verdict vocabulary
// ---------------------------------------------------------------------------

/**
 * Precedence (top to bottom) when several conditions apply simultaneously:
 * instrumentation-failed > directive-violation > mutant-timeout > mutants-uncovered
 * > mutants-survived > clean. `not-applicable` is a typed seam for Unit 4's
 * changed-file gating; this module never produces it.
 */
export type Verdict =
  | 'instrumentation-failed'
  | 'directive-violation'
  | 'mutant-timeout'
  | 'mutants-uncovered'
  | 'mutants-survived'
  | 'clean'
  | 'not-applicable'

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
 */
export function classifyMutationReport(
  reportJson: unknown,
  directiveViolations: readonly LocatedMutant[],
): ClassificationResult {
  const flat = flattenReport(reportJson)

  const reportUnreadable = flat === undefined
  const hasUnrecognizedStatus = (flat ?? []).some(
    m => INCOMPLETE_RUN_STATUSES.has(m.status) || !KNOWN_MUTANT_STATUSES.has(m.status),
  )
  const hasIgnoredWithoutReason = (flat ?? []).some(m => m.status === 'Ignored' && isEmptyReason(m.reason))

  let verdict: Verdict
  if (reportUnreadable || hasUnrecognizedStatus) {
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

  const reportedFromReport = (flat ?? []).filter(isFailingMutant).map(toLocatedMutant)
  const mutants = [...reportedFromReport, ...directiveViolations].sort(compareLocatedMutants)

  return {verdict, mutants}
}

function compareLocatedMutants(a: LocatedMutant, b: LocatedMutant): number {
  return a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col
}

// ---------------------------------------------------------------------------
// Directive scanner — conservative textual rule over the `mutate` file set
// ---------------------------------------------------------------------------

/**
 * Replaces the contents of every string/template literal on a line with spaces
 * of the same length, so column offsets stay aligned. Verified empirically that
 * Stryker honors a directive comment anywhere on a line — including trailing a
 * statement, e.g. `if (flag) return 'a' // Stryker disable all` — via Babel's
 * `leadingComments`/attachment to the following node, so the scanner must look
 * for `//` and `/* ... *\/` comments anywhere on the line, not only at the line
 * start. Stripping strings first keeps a directive-shaped string literal (e.g.
 * `const message = '// Stryker disable all'`) from being mistaken for a real
 * comment, since the only remaining `//`/`/*` sequences are genuine comment
 * markers.
 */
function stripStringLiterals(line: string): string {
  let result = ''
  let quote: string | undefined
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? ''
    if (quote !== undefined) {
      if (char === '\\') {
        result += '  '
        i += 1
        continue
      }
      if (char === quote) quote = undefined
      result += ' '
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      result += ' '
      continue
    }
    result += char
  }
  return result
}

interface DirectiveMatch {
  readonly remainder: string
  readonly col: number
}

const STRYKER_DISABLE_PATTERN = /^\s*Stryker disable\b(.*)$/u

/**
 * Finds the first `Stryker disable` directive comment on a line — either a
 * `//` line comment or a single-line `/* ... *\/` block comment — searching
 * anywhere on the line, not only at its start. String/template literal
 * contents are stripped first so a directive-shaped string is never matched.
 * A multi-line block comment (no closing `*\/` on the same line) is out of
 * this conservative scanner's scope and is not matched.
 */
function findDirectiveOnLine(line: string): DirectiveMatch | undefined {
  const stripped = stripStringLiterals(line)
  const lineCommentIndex = stripped.indexOf('//')
  const blockCommentIndex = stripped.indexOf('/*')

  // A `//` comment consumes the rest of the line, so if it appears before any `/*`,
  // the `/*` (if any) is just comment text, not the start of a separate comment.
  if (lineCommentIndex !== -1 && (blockCommentIndex === -1 || lineCommentIndex < blockCommentIndex)) {
    const match = STRYKER_DISABLE_PATTERN.exec(line.slice(lineCommentIndex + 2))
    if (match === null) return undefined
    return {remainder: match[1] ?? '', col: lineCommentIndex + 1}
  }

  if (blockCommentIndex !== -1) {
    const closeIndex = stripped.indexOf('*/', blockCommentIndex + 2)
    if (closeIndex === -1) return undefined
    const match = STRYKER_DISABLE_PATTERN.exec(line.slice(blockCommentIndex + 2, closeIndex))
    if (match === null) return undefined
    return {remainder: match[1] ?? '', col: blockCommentIndex + 1}
  }

  return undefined
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
      reason: 'Stryker disable directive must be next-line scoped; region/all suppression is rejected',
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
 * Scans the given files (expected to be exactly the configured `mutate` set)
 * for `Stryker disable` comment directives and reports every one that is not
 * `next-line` scoped with a non-empty reason. Exported for unit testing.
 */
export function scanDirectiveViolations(files: readonly DirectiveScanInput[]): LocatedMutant[] {
  const violations: LocatedMutant[] = []

  for (const {file, content} of files) {
    const lines = content.split('\n')
    for (const [index, line] of lines.entries()) {
      const directive = findDirectiveOnLine(line)
      if (directive === undefined) continue
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

  return violations
}

// ---------------------------------------------------------------------------
// Runner — spawns Stryker, reads the report, classifies, prints
// ---------------------------------------------------------------------------

interface StrykerConfigShape {
  readonly mutate: readonly string[]
}

function readStrykerConfig(path: string): StrykerConfigShape {
  const raw = readFileSync(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.mutate) ||
    !parsed.mutate.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new Error(`check-mutation-guards: ${path} is missing a string[] "mutate" field`)
  }
  return {mutate: parsed.mutate}
}

/**
 * Glob metacharacters mark an entry as out of scope for this unit's literal enumerated set.
 * A glob entry is silently skipped for directive scanning here — once `mutate` grows a glob,
 * directive coverage for the files it expands to stops with no signal from this wrapper.
 * Unit 3's enumeration guard is the intended backstop: it asserts every mutated module is
 * either explicitly listed or explicitly excused, which catches a glob silently absorbing an
 * undirected file the way it catches any other unlisted module.
 */
function isLiteralPath(entry: string): boolean {
  return !/[*?!]/u.test(entry)
}

function readMutateFileContents(mutate: readonly string[], root: string): DirectiveScanInput[] {
  const files: DirectiveScanInput[] = []
  for (const relativePath of mutate) {
    if (!isLiteralPath(relativePath)) continue
    try {
      files.push({file: relativePath, content: readFileSync(join(root, relativePath), 'utf8')})
    } catch {
      // A missing mutate target is a config problem for Unit 3's enumeration guard to catch;
      // this wrapper does not fail closed on it so a stale config entry doesn't mask real results.
    }
  }
  return files
}

function readMutationReport(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
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
 * Runs `stryker run` via `spawnSync`; the return value is used only to detect "Stryker did
 * not run at all" for an informational message — the verdict is always derived from the
 * JSON report, never this return value. Exported as an injectable seam for testing.
 */
export function defaultStrykerSpawner(): void {
  const run = spawnSync('pnpm', ['exec', 'stryker', 'run', strykerConfigPath], {
    cwd: repositoryRoot,
    stdio: 'inherit',
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
 * Clearing `mutationReportPath` before the spawn is load-bearing: without it, a Stryker
 * process that dies before writing a report (dry-run timeout, missing binary, crash) would
 * leave a *previous* run's report on disk, and this check would silently classify that
 * stale report as the current result — including a stale `clean` with exit 0. "Never fail
 * open" is this script's entire contract, so the report is always removed first.
 *
 * `spawner` is an injectable seam (defaults to `defaultStrykerSpawner`) so tests can drive
 * the "Stryker died without writing anything" path without actually running Stryker.
 */
export function runMutationGuardCheck(spawner: () => void = defaultStrykerSpawner): ClassificationResult {
  const config = readStrykerConfig(strykerConfigPath)

  rmSync(mutationReportPath, {force: true})
  spawner()

  const reportJson = readMutationReport(mutationReportPath)
  const directiveFiles = readMutateFileContents(config.mutate, repositoryRoot)
  const directiveViolations = scanDirectiveViolations(directiveFiles)
  return classifyMutationReport(reportJson, directiveViolations)
}

async function main(): Promise<void> {
  const result = runMutationGuardCheck()
  printResult(result)
  process.exitCode = result.verdict === 'clean' || result.verdict === 'not-applicable' ? 0 : 1
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
