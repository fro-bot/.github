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
 */
export function classifyMutationReport(
  reportJson: unknown,
  directiveViolations: readonly LocatedMutant[],
  missingMutateFiles: readonly string[] = [],
  reportPath: string = mutationReportPath,
): ClassificationResult {
  const flat = flattenReport(reportJson)

  const reportUnreadable = flat === undefined
  const hasMissingMutateFiles = missingMutateFiles.length > 0
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
  if (reportUnreadable || reportEmpty || hasMissingMutateFiles || hasUnrecognizedStatus) {
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

  const missingMutateFileMutants: LocatedMutant[] = missingMutateFiles.map(missingPath => ({
    file: missingPath,
    line: 0,
    col: 0,
    mutator: 'mutate-config',
    status: 'MissingMutateFile',
    reason: 'listed in the `mutate` config but not found on disk; Stryker silently drops it and continues',
  }))

  const reportedFromReport = (flat ?? []).filter(isFailingMutant).map(toLocatedMutant)
  const mutants = [
    ...reportedFromReport,
    ...emptyReportMutant,
    ...missingMutateFileMutants,
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
 * findDirectiveOnLine). Stripping strings first keeps a directive-shaped string literal
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

// Deliberately unanchored and comment-agnostic — see findDirectiveOnLine below for why.
// `\r?$` strips a trailing CRLF carriage return so a directive at the end of a
// CRLF-terminated line is still evaluated correctly (its remainder must not include `\r`,
// or a trailing `\r` would make an otherwise-valid `: reason` look non-empty-but-wrong).
// `\s+` between "Stryker" and "disable" (rather than a literal space) is a second, deliberate
// divergence beside the `\s*`-vs-`\s?` scope-anchor note above: Stryker's own grammar
// requires exactly one space, so `\s+` (one or more) is strictly a superset and fails closed
// the same direction as the rest of this scanner's divergences.
const STRYKER_DISABLE_PATTERN = /Stryker\s+disable\b(.*)\r?$/u

/**
 * Finds a `Stryker disable` directive anywhere in a line's stripped text (string/template
 * literal contents blanked first by stripStringLiterals, so a directive-shaped string is
 * never matched).
 *
 * Deliberately does NOT try to locate or validate a surrounding comment. An earlier version
 * of this scanner located a specific `//` or `/* ... *\/` comment and evaluated only the
 * first one found per line — but Stryker's DirectiveBookkeeper attaches to *any* leading
 * comment on a node, and a line can carry more than one comment. Both
 * `/* a *\/ // Stryker disable all` and `/* a *\/ /* Stryker disable all *\/` suppress
 * mutants under Stryker, and the comment-locating version evaluated only the first,
 * unrelated `/* a *\/` comment and reported zero violations for either. Rather than keep
 * extending the scanner to mirror every shape of Stryker's comment attachment, it now scans
 * the whole stripped line for the phrase, unanchored: any line whose stripped text contains
 * "Stryker disable" is evaluated by the scope/reason rules below.
 *
 * Accepted consequences, all fail-closed (a false positive that fails loudly, never a false
 * negative that passes silently):
 * - A JSDoc continuation line (` * Stryker disable all`) is now flagged even though
 *   Stryker's own `^`-anchored regex (matched against the whole comment value, no `m` flag)
 *   ignores it — that anchor only ever matches a comment's opening line.
 * - Ordinary prose containing the phrase (e.g. `// Stryker disable directives are banned
 *   here`) is flagged; the directive-violation reason string names this explicitly.
 * - Stryker's own looser anchor (`^\s?`, at most one leading space) vs. no anchor at all
 *   here is moot now: unanchored scanning is strictly more permissive than either, by design.
 *
 * Known narrow gap, unchanged from stripStringLiterals: no regex-literal state, so a quote
 * inside a same-line regex literal can open a phantom string and hide a real directive.
 */
function findDirectiveOnLine(line: string): DirectiveMatch | undefined {
  const stripped = stripStringLiterals(line)
  const match = STRYKER_DISABLE_PATTERN.exec(stripped)
  if (match === null) return undefined
  return {remainder: match[1] ?? '', col: (match.index ?? 0) + 1}
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
 * `reports/mutation/mutation.json` on disk.
 */
export function runMutationGuardCheck(
  spawner: () => void = defaultStrykerSpawner,
  reportPath: string = mutationReportPath,
): ClassificationResult {
  const config = readStrykerConfig(strykerConfigPath)

  rmSync(reportPath, {force: true})
  spawner()

  const reportJson = readMutationReport(reportPath)
  const {files: directiveFiles, missing: missingMutateFiles} = readMutateFileContents(config.mutate, repositoryRoot)
  const directiveViolations = scanDirectiveViolations(directiveFiles)
  return classifyMutationReport(reportJson, directiveViolations, missingMutateFiles, reportPath)
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
