import {spawnSync} from 'node:child_process'
import {appendFileSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import process from 'node:process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const strykerConfigPath = join(repositoryRoot, 'stryker.config.json')
const mutationReportPath = join(repositoryRoot, 'reports', 'mutation', 'mutation.json')

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
])

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
    m => m.status === 'RuntimeError' || m.status === 'CompileError' || !KNOWN_MUTANT_STATUSES.has(m.status),
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
 * A directive line must be a standalone `//` comment line (matching Stryker's
 * own `next-line` convention of sitting alone above the mutated line). This
 * also keeps the scan from tripping over a directive-shaped string literal,
 * since a string assignment does not begin the line with `//`.
 */
const DIRECTIVE_LINE_PATTERN = /^\s*\/\/\s*Stryker disable\b(.*)$/u

function evaluateDirectiveLine(remainder: string): {ok: boolean; reason: string} {
  if (!remainder.includes('next-line')) {
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
 * for `Stryker disable` comment directives and reports every line that is not
 * `next-line` scoped with a non-empty reason. Exported for unit testing.
 */
export function scanDirectiveViolations(files: readonly DirectiveScanInput[]): LocatedMutant[] {
  const violations: LocatedMutant[] = []

  for (const {file, content} of files) {
    const lines = content.split('\n')
    for (const [index, line] of lines.entries()) {
      const match = DIRECTIVE_LINE_PATTERN.exec(line)
      if (match === null) continue
      const remainder = match[1] ?? ''
      const evaluation = evaluateDirectiveLine(remainder)
      if (evaluation.ok) continue
      violations.push({
        file,
        line: index + 1,
        col: line.length - line.trimStart().length + 1,
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

/** Glob metacharacters mark an entry as out of scope for this unit's literal enumerated set. */
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

async function main(): Promise<void> {
  const config = readStrykerConfig(strykerConfigPath)

  // Exit status is used only to detect "Stryker did not run at all" for an informational
  // message; the verdict is derived exclusively from the JSON report below.
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

  const reportJson = readMutationReport(mutationReportPath)
  const directiveFiles = readMutateFileContents(config.mutate, repositoryRoot)
  const directiveViolations = scanDirectiveViolations(directiveFiles)
  const result = classifyMutationReport(reportJson, directiveViolations)

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
