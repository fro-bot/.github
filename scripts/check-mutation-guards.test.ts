import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

import {
  classifyMutationReport,
  defaultStrykerSpawner,
  exitCodeFor,
  flattenReport,
  mutationReportPath,
  readMutateFileContents,
  runMutationGuardCheck,
  scanDirectiveViolations,
  VERDICTS,
  type DirectiveScanInput,
  type LocatedMutant,
} from './check-mutation-guards.ts'

// vi.mock calls are hoisted above all imports by Vitest's transform regardless of their
// physical position in the file, so `main()` cannot actually spawn anything here if the
// import.meta.main guard were ever broken.
const {mockSpawnSync} = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}))

// ---------------------------------------------------------------------------
// Fixture builder — mutation-testing-report-schema v2 shape
// ---------------------------------------------------------------------------

interface FixtureMutant {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly mutatorName: string
  readonly status: string
  readonly statusReason?: string
}

function buildReport(mutants: readonly FixtureMutant[]): unknown {
  const files: Record<string, {mutants: unknown[]}> = {}
  for (const [index, mutant] of mutants.entries()) {
    files[mutant.file] ??= {mutants: []}
    files[mutant.file]?.mutants.push({
      id: String(index),
      mutatorName: mutant.mutatorName,
      status: mutant.status,
      location: {start: {line: mutant.line, column: mutant.column}, end: {line: mutant.line, column: mutant.column}},
      ...(mutant.statusReason === undefined ? {} : {statusReason: mutant.statusReason}),
    })
  }
  return {schemaVersion: '2.0', files}
}

describe('check-mutation-guards import safety', () => {
  it('does not spawn Stryker merely by being imported (import.meta.main guard)', () => {
    expect(mockSpawnSync).not.toHaveBeenCalled()
  })
})

describe('classifyMutationReport', () => {
  it('reports clean when every mutant is Killed', () => {
    const report = buildReport([
      {file: 'a.ts', line: 1, column: 1, mutatorName: 'ConditionalExpression', status: 'Killed'},
    ])
    expect(classifyMutationReport(report, [])).toEqual({verdict: 'clean', mutants: []})
  })

  it('reports clean when an Ignored mutant carries a non-empty statusReason', () => {
    const report = buildReport([
      {
        file: 'a.ts',
        line: 1,
        column: 1,
        mutatorName: 'StringLiteral',
        status: 'Ignored',
        statusReason: 'inert log message',
      },
    ])
    expect(classifyMutationReport(report, [])).toEqual({verdict: 'clean', mutants: []})
  })

  it('reports mutants-survived and locates the survivor', () => {
    const report = buildReport([{file: 'a.ts', line: 12, column: 5, mutatorName: 'BooleanLiteral', status: 'Survived'}])
    const result = classifyMutationReport(report, [])
    expect(result.verdict).toBe('mutants-survived')
    expect(result.mutants).toEqual([
      {file: 'a.ts', line: 12, col: 5, mutator: 'BooleanLiteral', status: 'Survived', reason: undefined},
    ])
  })

  it('reports mutants-uncovered and locates the uncovered mutant', () => {
    const report = buildReport([{file: 'a.ts', line: 3, column: 2, mutatorName: 'ArrowFunction', status: 'NoCoverage'}])
    const result = classifyMutationReport(report, [])
    expect(result.verdict).toBe('mutants-uncovered')
    expect(result.mutants).toEqual([
      {file: 'a.ts', line: 3, col: 2, mutator: 'ArrowFunction', status: 'NoCoverage', reason: undefined},
    ])
  })

  it('reports mutant-timeout when a mutant times out', () => {
    const report = buildReport([{file: 'a.ts', line: 7, column: 9, mutatorName: 'EqualityOperator', status: 'Timeout'}])
    expect(classifyMutationReport(report, []).verdict).toBe('mutant-timeout')
  })

  it('reports instrumentation-failed when a RuntimeError mutant is present', () => {
    const report = buildReport([
      {file: 'a.ts', line: 1, column: 1, mutatorName: 'ObjectLiteral', status: 'RuntimeError'},
    ])
    expect(classifyMutationReport(report, []).verdict).toBe('instrumentation-failed')
  })

  it('reports instrumentation-failed when a mutant is left Pending (run stopped early)', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'ObjectLiteral', status: 'Pending'}])
    expect(classifyMutationReport(report, []).verdict).toBe('instrumentation-failed')
  })

  it('reports instrumentation-failed when a CompileError mutant is present', () => {
    const report = buildReport([
      {file: 'a.ts', line: 1, column: 1, mutatorName: 'ObjectLiteral', status: 'CompileError'},
    ])
    expect(classifyMutationReport(report, []).verdict).toBe('instrumentation-failed')
  })

  it('reports instrumentation-failed, never clean, when the report is missing', () => {
    expect(classifyMutationReport(undefined, []).verdict).toBe('instrumentation-failed')
  })

  it('reports instrumentation-failed, never clean, when the report is malformed JSON structure', () => {
    expect(classifyMutationReport({files: 'not-an-object'}, []).verdict).toBe('instrumentation-failed')
    expect(classifyMutationReport('a string, not a report', []).verdict).toBe('instrumentation-failed')
  })

  // Blocking: a well-formed report with zero mutants (every `mutate` entry failed to resolve
  // or instrument) means Stryker still exited 0 and wrote `{"files":{}}` — a ten-module
  // enumerated set cannot legitimately yield zero mutants, and `not-applicable` (Unit 4) is
  // the only verdict allowed to mean "nothing to check". Reading this as `clean` would be
  // exactly the vacuous pass this checker exists to catch. This is the inverse of the old
  // assertion that `{files: {}, extra: true}` was `clean`.
  it('reports instrumentation-failed, never clean, when the report is well-formed but contains zero mutants', () => {
    const result = classifyMutationReport({files: {}, extra: true}, [])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.verdict).not.toBe('clean')
    expect(result.mutants).toHaveLength(1)
    expect(result.mutants[0]).toMatchObject({status: 'EmptyReport'})
  })

  // The EmptyReport reason names the report file so a red build points at the right path.
  // Under an injected reportPath (see runMutationGuardCheck's report-path seam), the default
  // real path would name a file that was never read for this run.
  it('names the actual reportPath, not the hardcoded default, in the EmptyReport entry', () => {
    const result = classifyMutationReport({files: {}}, [], [], '/tmp/some-other/mutation.json')
    expect(result.mutants).toHaveLength(1)
    expect(result.mutants[0]?.file).toBe('/tmp/some-other/mutation.json')
  })

  // Blocking: Stryker's ProjectReader warns per unresolvable `mutate` pattern and continues,
  // so a majority of a `mutate` set can silently drop out while the remainder instruments and
  // reports `clean`. A single missing literal path must fail closed even when the report
  // itself is well-formed and non-empty (the surviving module's mutants all Killed, say).
  it('reports instrumentation-failed when any literal mutate entry is missing, even with a non-empty clean-looking report', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    const result = classifyMutationReport(report, [], ['scripts/missing-module.ts'])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.some(m => m.status === 'MissingMutateFile' && m.file === 'scripts/missing-module.ts')).toBe(
      true,
    )
  })

  it('reports clean when no mutate entries are missing', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    expect(classifyMutationReport(report, [], []).verdict).toBe('clean')
  })

  // Blocking: Stryker's own config-level suppression (ignoreStatic, excludedMutations, a
  // shadowing `!` exclude pattern) can make a listed, on-disk module silently absent from the
  // report's `files` map with no other observable signal — an all-Killed report for the
  // module that DID make it in must not read as `clean` when a listed module is missing.
  it('reports instrumentation-failed when a literal mutate entry is absent from the report files map', () => {
    const report = buildReport([
      {file: 'scripts/present.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'},
    ])
    const result = classifyMutationReport(report, [], [], mutationReportPath, [
      'scripts/present.ts',
      'scripts/absent.ts',
    ])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.some(m => m.status === 'AbsentFromReport' && m.file === 'scripts/absent.ts')).toBe(true)
  })

  it('reports clean when every literal mutate entry (normalizing a leading ./) appears in the report files map', () => {
    const report = buildReport([
      {file: 'scripts/x.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'},
    ])
    const result = classifyMutationReport(report, [], [], mutationReportPath, ['./scripts/x.ts'])
    expect(result.verdict).toBe('clean')
  })

  it('reports directive-violation when an Ignored mutant has an empty statusReason', () => {
    const report = buildReport([
      {file: 'a.ts', line: 4, column: 1, mutatorName: 'StringLiteral', status: 'Ignored', statusReason: ''},
    ])
    const result = classifyMutationReport(report, [])
    expect(result.verdict).toBe('directive-violation')
    expect(result.mutants).toEqual([
      {file: 'a.ts', line: 4, col: 1, mutator: 'StringLiteral', status: 'Ignored', reason: ''},
    ])
  })

  it('reports directive-violation when an Ignored mutant has no statusReason at all', () => {
    const report = buildReport([{file: 'a.ts', line: 4, column: 1, mutatorName: 'StringLiteral', status: 'Ignored'}])
    expect(classifyMutationReport(report, []).verdict).toBe('directive-violation')
  })

  it('resolves both Timeout and Survived to mutant-timeout and lists both mutants', () => {
    const report = buildReport([
      {file: 'a.ts', line: 5, column: 1, mutatorName: 'EqualityOperator', status: 'Timeout'},
      {file: 'a.ts', line: 9, column: 1, mutatorName: 'BooleanLiteral', status: 'Survived'},
    ])
    const result = classifyMutationReport(report, [])
    expect(result.verdict).toBe('mutant-timeout')
    expect(result.mutants).toHaveLength(2)
    expect(result.mutants.map(m => m.status).sort()).toEqual(['Survived', 'Timeout'])
  })

  it('lists mutants from every failing class, not only the winning precedence class', () => {
    const report = buildReport([
      {file: 'a.ts', line: 1, column: 1, mutatorName: 'ObjectLiteral', status: 'RuntimeError'},
      {file: 'a.ts', line: 2, column: 1, mutatorName: 'BooleanLiteral', status: 'Survived'},
      {file: 'a.ts', line: 3, column: 1, mutatorName: 'EqualityOperator', status: 'Timeout'},
      {file: 'a.ts', line: 4, column: 1, mutatorName: 'ArrowFunction', status: 'NoCoverage'},
      {file: 'a.ts', line: 5, column: 1, mutatorName: 'StringLiteral', status: 'Killed'},
    ])
    const result = classifyMutationReport(report, [])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.map(m => m.status).sort()).toEqual(['NoCoverage', 'RuntimeError', 'Survived', 'Timeout'])
  })

  it('folds source-level directive violations into the located list', () => {
    const report = buildReport([
      {file: 'a.ts', line: 1, column: 1, mutatorName: 'ConditionalExpression', status: 'Killed'},
    ])
    const violation: LocatedMutant = {
      file: 'a.ts',
      line: 10,
      col: 1,
      mutator: 'directive',
      status: 'DirectiveViolation',
      reason: 'Stryker disable directive must be next-line scoped; region/all suppression is rejected',
    }
    const result = classifyMutationReport(report, [violation])
    expect(result.verdict).toBe('directive-violation')
    expect(result.mutants).toContainEqual(violation)
  })
})

describe('flattenReport', () => {
  it('returns undefined for a non-object report', () => {
    expect(flattenReport(null)).toBeUndefined()
    expect(flattenReport(42)).toBeUndefined()
  })

  it('returns undefined when a mutant entry is missing a required field', () => {
    expect(flattenReport({files: {'a.ts': {mutants: [{mutatorName: 'X', status: 'Killed'}]}}})).toBeUndefined()
  })

  it('returns an empty array for a report with no files', () => {
    expect(flattenReport({files: {}})).toEqual([])
  })
})

describe('scanDirectiveViolations', () => {
  const scan = (content: string, file = 'a.ts'): LocatedMutant[] => scanDirectiveViolations([{file, content}])

  it('passes a next-line directive with a non-empty reason', () => {
    expect(scan('// Stryker disable next-line ConditionalExpression: reason\nconst x = 1\n')).toEqual([])
  })

  it('flags a bare disable-all directive', () => {
    const violations = scan('// Stryker disable all\nconst x = 1\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({file: 'a.ts', line: 1, mutator: 'directive', status: 'DirectiveViolation'})
  })

  it('flags a disable-all directive even when it carries a reason (region scope is rejected on its own)', () => {
    // Isolates the next-line requirement from the reason requirement: this line has a
    // well-formed `: reason` but is not next-line scoped, so it must still fail.
    const violations = scan('// Stryker disable all: this reason is not enough\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  it('flags a next-line directive with no reason at all', () => {
    const violations = scan('// Stryker disable next-line ConditionalExpression\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  it('flags a next-line directive with an empty reason after the colon', () => {
    const violations = scan('// Stryker disable next-line ConditionalExpression:\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  it('does not scan a directive-shaped string literal', () => {
    const violations = scan("const message = '// Stryker disable all'\n")
    expect(violations).toEqual([])
  })

  it('does not scan a file that is not passed in (non-mutated file)', () => {
    const files: DirectiveScanInput[] = [{file: 'included.ts', content: 'const x = 1\n'}]
    // "excluded.ts" is never included in the scan input, mirroring a file outside the mutate set.
    expect(scanDirectiveViolations(files)).toEqual([])
  })

  it('locates violations by file and line across multiple files', () => {
    const violations = scanDirectiveViolations([
      {file: 'a.ts', content: 'const a = 1\n// Stryker disable all\n'},
      {file: 'b.ts', content: '// Stryker disable next-line X\nconst b = 2\n'},
    ])
    expect(violations).toHaveLength(2)
    expect(violations.find(v => v.file === 'a.ts')?.line).toBe(2)
    expect(violations.find(v => v.file === 'b.ts')?.line).toBe(1)
  })

  // Fix 1 (blocking): the next-line scope check must not be a substring search over the
  // whole reason text — a reason that merely mentions "next-line" must not smuggle region
  // suppression past the rule written to reject it.
  it('rejects a disable-all directive whose reason text merely mentions "next-line"', () => {
    const violations = scan('// Stryker disable all: next-line scoping is impractical here\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  // Fix 2 (blocking): Stryker's DirectiveBookkeeper matches directives via Babel's
  // leadingComments, which includes CommentBlock as well as CommentLine — a standalone
  // block-comment directive is fully effective at suppressing mutants and must be scanned.
  it('flags a standalone block-comment disable-all directive', () => {
    const violations = scan('/* Stryker disable all */\nconst x = 1\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({file: 'a.ts', line: 1, mutator: 'directive', status: 'DirectiveViolation'})
  })

  it('passes a block-comment next-line directive with a non-empty reason', () => {
    expect(scan('/* Stryker disable next-line ConditionalExpression: reason */\nconst x = 1\n')).toEqual([])
  })

  it('does not scan a block-comment-shaped string literal', () => {
    const violations = scan("const message = '/* Stryker disable all */'\n")
    expect(violations).toEqual([])
  })

  // Fix 2 continued: empirically confirmed against a live Stryker run (see commit body) that
  // a directive trailing a statement on the same line is honored — Babel attaches it as a
  // leading comment of the following node — so the scanner must catch trailing directives,
  // not only directives that begin their own line.
  it('flags a trailing disable-all directive after code on the same line', () => {
    const violations = scan("if (flag) return 'a' // Stryker disable all\nreturn 'b'\n")
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({file: 'a.ts', line: 1, mutator: 'directive', status: 'DirectiveViolation'})
  })

  it('passes a trailing next-line directive with a non-empty reason after code', () => {
    expect(scan('const x = 1 // Stryker disable next-line ConditionalExpression: reason\n')).toEqual([])
  })

  it('does not scan a string literal containing directive text mid-line, even with real code after it', () => {
    const violations = scan("const message = 'Stryker disable all'; const y = 2\n")
    expect(violations).toEqual([])
  })

  // Blocking: Stryker's regex (`/^\s?Stryker (disable|restore).../`, no `m` flag) matches
  // against the whole leading-comment `comment.value`, so a directive on a block comment's
  // *opening* line is honored even when the comment doesn't close until a later line.
  // Previously the scanner bailed out entirely when `*/` was absent on the directive's line.
  it('flags a multi-line block-comment disable-all directive on its opening line', () => {
    const violations = scan('/* Stryker disable all\n   this module is generated */\nconst x = 1\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({file: 'a.ts', line: 1, mutator: 'directive', status: 'DirectiveViolation'})
  })

  it('passes a multi-line block-comment next-line directive with a reason, closed on a later line', () => {
    const violations = scan('/* Stryker disable next-line X: reason\n   still explaining */\nconst x = 1\n')
    expect(violations).toEqual([])
  })

  // Design change: the scanner now scans a line's whole stripped text for the phrase,
  // unanchored, instead of locating a specific comment first (see findDirectivesOnLine's
  // docstring). A JSDoc continuation line (` * Stryker disable all`) is therefore now
  // flagged even though Stryker's own `^`-anchored regex (matched against the whole comment
  // value, no `m` flag, so `^` only ever matches a comment's opening line) ignores it — an
  // accepted fail-closed false positive, the inverse of this scanner's previous behavior.
  it('flags a block-comment continuation line as a false positive, even though Stryker itself ignores it (fail-closed by design)', () => {
    const violations = scan('/**\n * Stryker disable all\n */\nconst x = 1\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({file: 'a.ts', line: 2, mutator: 'directive', status: 'DirectiveViolation'})
  })

  // Blocking (review case 1): the comment-locating scanner evaluated only the first comment
  // on a line and returned, so a leading, unrelated block comment hid a real trailing
  // line-comment directive that Stryker still honors.
  it('flags a line-comment directive that follows an unrelated block comment on the same line', () => {
    const violations = scan('/* a */ // Stryker disable all\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  // Blocking (review case 2): same defect, with the honored directive itself in a second
  // block comment rather than a line comment.
  it('flags a block-comment directive that follows an unrelated block comment on the same line', () => {
    const violations = scan('/* a */ /* Stryker disable all */\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  // CRLF: content.split('\n') on a CRLF-terminated file leaves a trailing '\r' on each line.
  // The original comment-locating regex's `$` (no `m` flag) required true end-of-string, and
  // `.` never matches '\r', so a directive on a CRLF line failed to match at all.
  it('flags a bare disable-all directive on a CRLF-terminated line', () => {
    const violations = scan('// Stryker disable all\r\nconst x = 1\r\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({file: 'a.ts', line: 1, mutator: 'directive', status: 'DirectiveViolation'})
  })

  it('passes a next-line directive with a non-empty reason on a CRLF-terminated line', () => {
    const violations = scan('// Stryker disable next-line ConditionalExpression: reason\r\nconst x = 1\r\n')
    expect(violations).toEqual([])
  })

  // Blocking: an odd quote count earlier on the line (an apostrophe in ordinary prose, not
  // just a regex literal) opened a phantom string that swallowed a later comment-initial
  // directive, because the string-stripper had no idea a `//` or `/*` started a comment
  // first — it just counted quote characters left to right across the whole line.
  it('flags a line-comment directive after a block comment containing an apostrophe', () => {
    const violations = scan("/* what's up */ // Stryker disable all\nconst x = 1\n")
    expect(violations).toHaveLength(1)
  })

  it('flags a block-comment directive after a line comment containing an apostrophe', () => {
    const violations = scan("const x = 1 // it's fine /* Stryker disable all */\nconst y = 2\n")
    expect(violations).toHaveLength(1)
  })

  // Known, verified, narrow gap (fails open) that the apostrophe fix does NOT close: a quote
  // inside an actual regex literal precedes the comment, and the regex's `/` is ordinary code
  // (not `//` or `/*`), so comment-detection never triggers before the quote is reached. The
  // unmatched `'` inside `['"]` opens a string that never finds its closing quote on this
  // line, blanking the trailing directive along with everything else after it.
  it('does not flag a directive hidden behind a same-line regex literal (documented gap, unchanged)', () => {
    const violations = scan(`const re = /['"]/ // Stryker disable all\nconst x = 1\n`)
    expect(violations).toEqual([])
  })

  // Blocking: a non-global pattern that returns on the first hit evaluates only the first
  // directive on a line, swallowing a second, independently honored directive into the
  // first's remainder text. Stryker honors both comments on this line; the module is fully
  // suppressed. Both orderings must each yield their own violation, not just one combined.
  it('flags both directives when a block-comment directive with a reason precedes a bare block-comment directive', () => {
    const violations = scan('/* Stryker disable next-line all: ok */ /* Stryker disable all */\nconst x = 1\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({status: 'DirectiveViolation'})
  })

  it('flags both directives when a block-comment directive with a reason precedes a bare line-comment directive', () => {
    const violations = scan('/* Stryker disable next-line all: ok */ // Stryker disable all\nconst x = 1\n')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({status: 'DirectiveViolation'})
  })

  it('flags the same pair with the bare directive first (order-independent)', () => {
    const violations = scan('// Stryker disable all /* Stryker disable next-line all: ok */\nconst x = 1\n')
    expect(violations).toHaveLength(1)
  })

  it('flags a trailing disable-all directive even when an earlier string on the line contains a fake, well-formed directive', () => {
    const violations = scan("const s = 'Stryker disable next-line all: fake' // Stryker disable all\nconst x = 1\n")
    expect(violations).toHaveLength(1)
  })
})

describe('readMutateFileContents (documented policy decisions)', () => {
  // The repo root itself always exists and contains predictable fixtures for this test.
  const root = resolve(import.meta.dirname, '..')

  it('silently skips reading a glob entry rather than throwing, and never reports it as missing', () => {
    const result = readMutateFileContents(['scripts/*.ts'], root)
    expect(result.files).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('skips reading a literal entry that does not exist on disk rather than throwing, and reports it as missing', () => {
    const result = readMutateFileContents(['scripts/this-file-does-not-exist.ts'], root)
    expect(result.files).toEqual([])
    expect(result.missing).toEqual(['scripts/this-file-does-not-exist.ts'])
  })

  it('reads the content of an existing literal entry, reporting nothing missing', () => {
    const result = readMutateFileContents(['package.json'], root)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.file).toBe('package.json')
    expect(result.files[0]?.content).toContain('"name"')
    expect(result.missing).toEqual([])
  })

  // Blocking: Stryker filters `mutate` through minimatch, whose grammar is wider than
  // `*`/`?` — braces, character classes, and extglobs are all patterns too. Treating any of
  // them as literal would try to readFileSync a path no one meant to exist verbatim, feeding
  // a false MissingMutateFile into instrumentation-failed for a working Stryker config.
  it('treats a brace-expansion entry as a glob (skipped, never reported missing)', () => {
    const result = readMutateFileContents(['scripts/{a,b}.ts'], root)
    expect(result.files).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('treats a character-class entry as a glob (skipped, never reported missing)', () => {
    const result = readMutateFileContents(['scripts/a[k].ts'], root)
    expect(result.files).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('treats an extglob entry as a glob (skipped, never reported missing)', () => {
    const result = readMutateFileContents(['scripts/+(a).ts'], root)
    expect(result.files).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('treats a leading-! ignore pattern as a glob (Stryker strips the prefix; it is never a path)', () => {
    const result = readMutateFileContents(['!scripts/a.ts'], root)
    expect(result.files).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('treats a plain literal path as literal, not a glob', () => {
    const result = readMutateFileContents(['scripts/a.ts'], root)
    expect(result.missing).toEqual(['scripts/a.ts'])
  })

  it('mixes skipped, read, and missing entries in one call, preserving order of the readable ones', () => {
    const result = readMutateFileContents(['scripts/*.ts', 'package.json', 'scripts/nonexistent.ts'], root)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.file).toBe('package.json')
    expect(result.missing).toEqual(['scripts/nonexistent.ts'])
  })
})

describe('exitCodeFor (exit-code contract)', () => {
  it('exits 0 for clean', () => {
    expect(exitCodeFor('clean')).toBe(0)
  })

  it('exits 0 for not-applicable', () => {
    expect(exitCodeFor('not-applicable')).toBe(0)
  })

  it('exits 1 for instrumentation-failed', () => {
    expect(exitCodeFor('instrumentation-failed')).toBe(1)
  })

  it('exits 1 for directive-violation', () => {
    expect(exitCodeFor('directive-violation')).toBe(1)
  })

  it('exits 1 for mutant-timeout', () => {
    expect(exitCodeFor('mutant-timeout')).toBe(1)
  })

  it('exits 1 for mutants-uncovered', () => {
    expect(exitCodeFor('mutants-uncovered')).toBe(1)
  })

  it('exits 1 for mutants-survived', () => {
    expect(exitCodeFor('mutants-survived')).toBe(1)
  })

  // Set-equality: the seven verdicts asserted individually above must equal the full
  // Verdict union, sourced from the same VERDICTS runtime array exitCodeFor is defined
  // against — so a new verdict added to VERDICTS fails this test until exitCodeFor (and a
  // dedicated assertion above) accounts for it.
  it('asserts an exit code for every member of the Verdict union, and no more', () => {
    const assertedVerdicts = [
      'clean',
      'not-applicable',
      'instrumentation-failed',
      'directive-violation',
      'mutant-timeout',
      'mutants-uncovered',
      'mutants-survived',
    ]
    expect(new Set(assertedVerdicts)).toEqual(new Set(VERDICTS))
    expect(assertedVerdicts).toHaveLength(VERDICTS.length)
  })
})

describe('runMutationGuardCheck (stale-report fix)', () => {
  // A dedicated temp directory, never the real reports/mutation/mutation.json, so this test
  // cannot clobber a real report a concurrent or subsequent run depends on.
  const tempReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-test-')), 'mutation.json')

  // Fix 3 (blocking): a report left over from a prior run must never be classified as the
  // current result. Stage a stale "all Killed" report, then run the check with a spawner
  // that dies without writing anything — the fix (`rmSync` before spawning) makes this
  // `instrumentation-failed` (no fresh report); without it, the stale report reads as `clean`.
  it('never classifies a stale on-disk report as a fresh clean result', () => {
    writeFileSync(
      tempReportPath,
      JSON.stringify({
        files: {
          'stale-file.ts': {
            mutants: [{mutatorName: 'StringLiteral', status: 'Killed', location: {start: {line: 1, column: 1}}}],
          },
        },
      }),
      'utf8',
    )

    try {
      const diedWithoutWriting = (): void => {
        // Simulates Stryker dying before it writes a report (dry-run timeout, missing
        // binary, crash): the spawner runs and returns, but the report file is untouched.
      }
      const result = runMutationGuardCheck(diedWithoutWriting, tempReportPath)
      expect(result.verdict).toBe('instrumentation-failed')
      expect(result.verdict).not.toBe('clean')
    } finally {
      rmSync(tempReportPath, {force: true})
    }
  })

  // Sentinel proof: a real file at the real mutationReportPath must survive this whole test
  // untouched, proving reportPath injection actually redirects rmSync/readFileSync away from
  // the real path rather than merely accepting the parameter and ignoring it. Pre-existing
  // content at that real path (e.g. a report from a real local run) is NEVER overwritten, even
  // transiently — a marker is written only when nothing already exists there, and only that
  // marker (never real content) is ever removed in `finally`. Whatever was actually at the
  // real path before this test ran — marker or genuine pre-existing content — is asserted to
  // survive byte-for-byte.
  it('never touches the real mutationReportPath when a reportPath override is given', () => {
    const realReportDir = dirname(mutationReportPath)
    mkdirSync(realReportDir, {recursive: true})

    const preExistingContent = existsSync(mutationReportPath) ? readFileSync(mutationReportPath, 'utf8') : undefined
    if (preExistingContent === undefined) {
      // Nothing was there before: safe to write a disposable marker, since "nothing existed"
      // is exactly the state `finally` restores by removing it again.
      writeFileSync(mutationReportPath, `sentinel-${String(Date.now())}`, 'utf8')
    }
    const expectedContent = readFileSync(mutationReportPath, 'utf8')

    try {
      const otherTempReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-sentinel-')), 'mutation.json')
      const noOpSpawner = (): void => {
        // Runs and returns without touching any report file.
      }
      runMutationGuardCheck(noOpSpawner, otherTempReportPath)

      expect(readFileSync(mutationReportPath, 'utf8')).toBe(expectedContent)
      rmSync(dirname(otherTempReportPath), {recursive: true, force: true})
    } finally {
      if (preExistingContent === undefined) {
        rmSync(mutationReportPath, {force: true})
      }
      // else: preExistingContent was never overwritten, so there is nothing to restore.
    }
  })
})

describe('defaultStrykerSpawner (CI step-summary isolation)', () => {
  // Vitest 4's auto-registered github-actions reporter appends a "## Vitest Test Report"
  // block to GITHUB_STEP_SUMMARY on every run. Stryker's vitest runner spawns Vitest once for
  // the dry run and again per mutant batch, each inheriting the job env by default, so an
  // unfiltered spawn floods the step summary. Only this wrapper's own printResult should ever
  // write to it.
  it('spawns Stryker with GITHUB_STEP_SUMMARY removed from the child env, without mutating the parent env', () => {
    const original = process.env.GITHUB_STEP_SUMMARY
    process.env.GITHUB_STEP_SUMMARY = '/tmp/parent-step-summary.md'
    mockSpawnSync.mockReturnValue({error: undefined, status: 0})

    try {
      defaultStrykerSpawner()

      const call = mockSpawnSync.mock.calls.at(-1) as [string, string[], {env?: NodeJS.ProcessEnv}] | undefined
      const childEnv = call?.[2]?.env
      expect(childEnv).toBeDefined()
      expect(childEnv).not.toHaveProperty('GITHUB_STEP_SUMMARY')

      // The parent process env must be untouched — only the child spawn's env is filtered.
      expect(process.env.GITHUB_STEP_SUMMARY).toBe('/tmp/parent-step-summary.md')
    } finally {
      if (original === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY
      } else {
        process.env.GITHUB_STEP_SUMMARY = original
      }
      mockSpawnSync.mockReset()
    }
  })
})
