import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve} from 'node:path'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

import {
  buildImportClosure,
  buildTriggerSet,
  changedFilesIntersectTriggerSet,
  classifyMutationReport,
  defaultStrykerSpawner,
  evaluateTriggerGate,
  exitCodeFor,
  flattenReport,
  froBotPackageSourceFiles,
  mutationReportPath,
  reachedModulesTransitive,
  readMutateFileContents,
  readStrykerConfig,
  resolveReporterConfig,
  runMutationGuardCheck,
  scanDirectiveViolations,
  strykerConfigPath,
  VERDICTS,
  wikiWriteCoreSubpathSourceFiles,
  type ChangedFileGateDeps,
  type DirectiveScanInput,
  type LocatedMutant,
  type ReporterConfig,
  type StrykerConfigShape,
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

// Forces evaluateTriggerGate's env parameter default (real process.env) never to be used from
// this test suite's pre-trigger-gate call sites: without this, a `runMutationGuardCheck` call made from inside a
// pull_request CI run (this very test suite's own `Test` job in main.yaml) would pick up a
// real GITHUB_EVENT_NAME=pull_request from the ambient environment and try to run the real
// gate — reading a real GITHUB_EVENT_PATH and calling `fetchChangedFiles` (which this file's
// `node:child_process` mock does not even provide `execFileSync` for). Every pre-existing
// `runMutationGuardCheck` call below passes this explicitly so its behavior is identical
// whether run locally or inside any CI event type.
const NOT_A_PULL_REQUEST_ENV = {eventName: undefined, eventPath: undefined} as const

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

function buildReport(
  mutants: readonly FixtureMutant[],
  testFiles?: Record<string, {tests: readonly unknown[]}>,
): unknown {
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
  return {schemaVersion: '2.0', files, ...(testFiles === undefined ? {} : {testFiles})}
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
  // enumerated set cannot legitimately yield zero mutants, and `not-applicable` (the
  // changed-file trigger gate) is the only verdict allowed to mean "nothing to check". Reading
  // this as `clean` would be
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

  // Blocking: excludedMutations/ignoreStatic leave the report key present with every mutant
  // Ignored (non-empty framework statusReason), which isFailingMutant correctly treats as
  // non-failing on its own — the report-key cross-check alone cannot see this, since the key
  // IS present. Verified live: 92 mutants, 90 Ignored + 2 Survived; neutralizing the two
  // Survived leaves a `clean` verdict for a module that contributes nothing evaluable.
  it('reports instrumentation-failed when a listed mutate entry has every mutant Ignored', () => {
    const report = buildReport([
      {
        file: 'scripts/vacuous.ts',
        line: 1,
        column: 1,
        mutatorName: 'StringLiteral',
        status: 'Ignored',
        statusReason: 'Ignored by excludedMutations',
      },
      {
        file: 'scripts/vacuous.ts',
        line: 2,
        column: 1,
        mutatorName: 'BooleanLiteral',
        status: 'Ignored',
        statusReason: 'Ignored by excludedMutations',
      },
    ])
    const result = classifyMutationReport(report, [], [], mutationReportPath, ['scripts/vacuous.ts'])
    expect(result.verdict).toBe('instrumentation-failed')
    const sentinel = result.mutants.find(m => m.status === 'AllMutantsIgnored')
    expect(sentinel?.file).toBe('scripts/vacuous.ts')
    expect(sentinel?.reason).toContain('all 2 mutants ignored')
  })

  it('does not flag a listed mutate entry with a mix of Ignored and non-Ignored mutants', () => {
    const report = buildReport([
      {
        file: 'scripts/mixed.ts',
        line: 1,
        column: 1,
        mutatorName: 'StringLiteral',
        status: 'Ignored',
        statusReason: 'Ignored by excludedMutations',
      },
      {file: 'scripts/mixed.ts', line: 2, column: 1, mutatorName: 'BooleanLiteral', status: 'Killed'},
    ])
    const result = classifyMutationReport(report, [], [], mutationReportPath, ['scripts/mixed.ts'])
    expect(result.verdict).toBe('clean')
    expect(result.mutants.some(m => m.status === 'AllMutantsIgnored')).toBe(false)
  })

  // Blocking: mutationReportPath and stryker.config.json's jsonReporter.fileName are two
  // independent declarations with no other cross-check. A config edit to one without the
  // other would silently make the wrapper read a stale or nonexistent report.
  it('reports instrumentation-failed when reporters does not include "json"', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], {
      reporters: ['clear-text'],
      resolvedJsonReportPath: mutationReportPath,
    })
    expect(result.verdict).toBe('instrumentation-failed')
    const sentinel = result.mutants.find(m => m.status === 'ReporterConfigMismatch')
    expect(sentinel?.file).toBe('stryker.config.json')
    expect(sentinel?.reason).toContain('does not include "json"')
  })

  it('reports instrumentation-failed when the resolved jsonReporter.fileName does not match reportPath', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], {
      reporters: ['json', 'clear-text'],
      resolvedJsonReportPath: '/some/other/path/mutation.json',
    })
    expect(result.verdict).toBe('instrumentation-failed')
    const sentinel = result.mutants.find(m => m.status === 'ReporterConfigMismatch')
    expect(sentinel?.reason).toContain('/some/other/path/mutation.json')
    expect(sentinel?.reason).toContain(mutationReportPath)
  })

  it('reports clean when reporterConfig matches (reporters includes json, path matches)', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], {
      reporters: ['json', 'clear-text'],
      resolvedJsonReportPath: mutationReportPath,
    })
    expect(result.verdict).toBe('clean')
  })

  it('does not check reporterConfig at all when it is omitted', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    expect(classifyMutationReport(report, []).verdict).toBe('clean')
  })

  // Blocking: the full-run failure signature this closes — unlike the scoped-repro ConfigError
  // shape (no report written at all), Stryker can silently drop one configured test file from
  // dry-run collection while every other test file still loads, still complete, and still
  // write a well-formed report. The dropped file's module then reads as 100% `NoCoverage`
  // (`mutants-uncovered`), not the tool failure it actually is. Verified live: a scratch
  // 13-module `mutate` config (12 real entries + `wiki-ingest.ts`, whose Regex mutator embeds
  // one syntactically-invalid variant that fails to parse at load time) wrote a full report
  // with `corrections.ts` 553/553 and `corrections-survival.ts` 183/183 `NoCoverage`; the
  // dry-run log showed "Initial test run succeeded. Ran 316 tests" with no error or warning
  // naming the drop, and the report's top-level `testFiles` map simply omitted the three
  // dropped keys (`corrections.test.ts`, `corrections-survival.test.ts`,
  // `wiki-write-core.test.ts`) rather than listing them with zero tests.
  it('reports instrumentation-failed when a configured test file is absent from the report testFiles map', () => {
    const report = buildReport(
      [{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'NoCoverage'}],
      {'scripts/present.test.ts': {tests: [{id: '1', name: 'a test'}]}},
    )
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], undefined, undefined, [
      'scripts/present.test.ts',
      'scripts/dropped.test.ts',
    ])
    expect(result.verdict).toBe('instrumentation-failed')
    const sentinel = result.mutants.find(m => m.status === 'TestFileNotExecuted')
    expect(sentinel?.file).toBe('scripts/dropped.test.ts')
    expect(sentinel?.reason).toContain('no tests executed from a configured test file')
  })

  it('reports instrumentation-failed when a configured test file is present but has zero tests', () => {
    const report = buildReport(
      [{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'NoCoverage'}],
      {'scripts/dropped.test.ts': {tests: []}},
    )
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], undefined, undefined, [
      'scripts/dropped.test.ts',
    ])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.some(m => m.status === 'TestFileNotExecuted' && m.file === 'scripts/dropped.test.ts')).toBe(
      true,
    )
  })

  it('reports clean when every configured test file (normalizing a leading ./) has at least one test', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}], {
      'scripts/present.test.ts': {tests: [{id: '1', name: 'a test'}]},
    })
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], undefined, undefined, [
      './scripts/present.test.ts',
    ])
    expect(result.verdict).toBe('clean')
  })

  it('does not check configured test files at all when the list is empty (default)', () => {
    const report = buildReport([{file: 'a.ts', line: 1, column: 1, mutatorName: 'StringLiteral', status: 'Killed'}])
    expect(classifyMutationReport(report, []).verdict).toBe('clean')
  })

  it('does not double-report a dropped test file when the report itself is unreadable', () => {
    const result = classifyMutationReport(undefined, [], [], mutationReportPath, [], undefined, undefined, [
      'scripts/dropped.test.ts',
    ])
    expect(result.verdict).toBe('instrumentation-failed')
    expect(result.mutants.some(m => m.status === 'TestFileNotExecuted')).toBe(false)
  })

  // Blocking 1: extractReportTestFileCounts returns undefined both for an unreadable report
  // and for a readable report that simply has no top-level testFiles map — those are not the
  // same failure. A readable report (mutants present, `files` well-formed) missing its
  // testFiles map entirely must still fail closed when test files are configured, not silently
  // skip verification because there was nothing to compare against.
  it('reports instrumentation-failed when the report is readable but has no top-level testFiles map at all', () => {
    const report = {schemaVersion: '2.0', files: {'a.ts': {mutants: []}}}
    const result = classifyMutationReport(report, [], [], mutationReportPath, [], undefined, undefined, [
      'scripts/one.test.ts',
      'scripts/two.test.ts',
    ])
    expect(result.verdict).toBe('instrumentation-failed')
    const sentinel = result.mutants.find(m => m.status === 'TestFilesMapMissing')
    expect(sentinel?.reason).toContain('no top-level "testFiles" map')
    expect(sentinel?.reason).toContain('2 configured')
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

function writeScratchConfig(dir: string, configBody: Record<string, unknown>): string {
  const configPath = join(dir, 'stryker.config.json')
  writeFileSync(configPath, JSON.stringify(configBody), 'utf8')
  return configPath
}

describe('resolveReporterConfig (default reporterConfig resolution)', () => {
  const realConfigPath = resolve(import.meta.dirname, '..', 'stryker.config.json')

  it('reads the same config file the production run reads', () => {
    expect(realConfigPath).toBe(strykerConfigPath)
  })

  // Blocking: a `reporters` field present but the wrong shape (a bare string, not an array)
  // previously silently coerced to `[]`, then failed the downstream "does not include json"
  // check with a misleading reason — the actual problem was a config shape error, not an
  // empty list. It must now fail with the same named-error shape as an invalid "mutate".
  it('throws a named type error when reporters is present but not a string[]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-mutation-guards-reporters-type-'))
    try {
      const configPath = writeScratchConfig(dir, {mutate: ['a.ts'], reporters: 'json'})
      expect(() => resolveReporterConfig(configPath)).toThrow(/"reporters" must be a string\[\]/u)
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('defaults reporters to [] when the field is absent entirely (not a type error)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-mutation-guards-reporters-absent-'))
    try {
      const configPath = writeScratchConfig(dir, {mutate: ['a.ts']})
      expect(() => resolveReporterConfig(configPath)).not.toThrow()
      expect(resolveReporterConfig(configPath).reporters).toEqual([])
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  // Blocking: jsonReporter.fileName must resolve relative to the directory containing the
  // config file, not the repository root — the two happen to coincide for this project's real
  // config, so only an injected configPath under a subdirectory can discriminate this.
  it('resolves jsonReporter.fileName relative to the directory containing the config file, not the repository root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-mutation-guards-subdir-'))
    const subDir = join(dir, 'sub')
    mkdirSync(subDir, {recursive: true})
    try {
      const configPath = writeScratchConfig(subDir, {
        mutate: ['a.ts'],
        reporters: ['json'],
        jsonReporter: {fileName: 'reports/mutation.json'},
      })
      const result = resolveReporterConfig(configPath)
      expect(result.resolvedJsonReportPath).toBe(join(subDir, 'reports/mutation.json'))
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  // The production default: no override anywhere, resolved straight from the real
  // stryker.config.json. Must match mutationReportPath exactly and include "json".
  it('resolves the real stryker.config.json to reporters including "json" and resolvedJsonReportPath equal to mutationReportPath', () => {
    const result = resolveReporterConfig(realConfigPath)
    expect(result.reporters).toContain('json')
    expect(result.resolvedJsonReportPath).toBe(mutationReportPath)
  })

  // runMutationGuardCheck's default-construction line is `reporterConfig ??
  // reporterConfigFrom(config, strykerConfigPath)`; the exported resolveReporterConfig these
  // tests call delegates to that same reporterConfigFrom with the same configPath, and
  // `realConfigPath === strykerConfigPath` is asserted above. The function under test is not
  // the one production calls, but its body is, and its input is proven identical — so the
  // assertions here cover the production default without invoking runMutationGuardCheck
  // against the real, non-test-owned mutationReportPath.
})

// ---------------------------------------------------------------------------
// Changed-file trigger gate
// ---------------------------------------------------------------------------

function fakeTriggerConfig(overrides: Partial<StrykerConfigShape> = {}): StrykerConfigShape {
  return {
    mutate: ['scripts/a.ts'],
    testFiles: ['scripts/a.test.ts'],
    reporters: ['json'],
    jsonReportFileName: 'reports/mutation/mutation.json',
    ...overrides,
  }
}

function fakeGateDeps(overrides: Partial<ChangedFileGateDeps> = {}): ChangedFileGateDeps {
  return {
    readPullRequestContext: async () => ({
      prNumber: 42,
      author: 'someone',
      headRef: 'feature/x',
      headRepo: 'fro-bot/.github',
      fullName: 'fro-bot/.github',
    }),
    fetchChangedFiles: () => [],
    ...overrides,
  }
}

const PULL_REQUEST_EVENT = {eventName: 'pull_request', eventPath: '/fake/event.json'} as const

describe('buildTriggerSet', () => {
  it('includes every mutate and testFiles entry plus the fixed infrastructure files', () => {
    const triggerSet = buildTriggerSet(fakeTriggerConfig())
    expect(triggerSet.files.has('scripts/a.ts')).toBe(true)
    expect(triggerSet.files.has('scripts/a.test.ts')).toBe(true)
    expect(triggerSet.files.has('stryker.config.json')).toBe(true)
    expect(triggerSet.files.has('mutation-guards.json')).toBe(true)
    expect(triggerSet.files.has('package.json')).toBe(true)
    expect(triggerSet.files.has('bun.lock')).toBe(true)
    expect(triggerSet.files.has('bunfig.toml')).toBe(true)
    expect(triggerSet.files.has('scripts/check-mutation-guards.ts')).toBe(true)
    expect(triggerSet.files.has('scripts/mutation-guards-config.test.ts')).toBe(true)
    expect(triggerSet.files.has('.github/workflows/main.yaml')).toBe(true)
    expect(triggerSet.files.has('packages/wiki-write-core/package.json')).toBe(true)
    expect(triggerSet.files.has('tsconfig.json')).toBe(true)
    expect(triggerSet.files.has('packages/wiki-write-core/tsconfig.build.json')).toBe(true)
    expect(triggerSet.hasGlobEntries).toBe(false)
  })

  it('normalizes a leading ./ the same way as the rest of the module', () => {
    const triggerSet = buildTriggerSet(fakeTriggerConfig({mutate: ['./scripts/a.ts']}))
    expect(triggerSet.files.has('scripts/a.ts')).toBe(true)
  })

  it('sets hasGlobEntries when a mutate or testFiles entry contains a glob metacharacter', () => {
    expect(buildTriggerSet(fakeTriggerConfig({mutate: ['scripts/*.ts']})).hasGlobEntries).toBe(true)
    expect(buildTriggerSet(fakeTriggerConfig({testFiles: ['scripts/*.test.ts']})).hasGlobEntries).toBe(true)
    expect(buildTriggerSet(fakeTriggerConfig()).hasGlobEntries).toBe(false)
  })
})

describe('changedFilesIntersectTriggerSet', () => {
  it('is true when a changed file (normalized) is a trigger-set member', () => {
    const triggerSet = buildTriggerSet(fakeTriggerConfig())
    expect(changedFilesIntersectTriggerSet(['./scripts/a.ts'], triggerSet)).toBe(true)
  })

  it('is false when no changed file is a trigger-set member', () => {
    const triggerSet = buildTriggerSet(fakeTriggerConfig())
    expect(changedFilesIntersectTriggerSet(['docs/x.md'], triggerSet)).toBe(false)
  })
})

describe('evaluateTriggerGate (changed-file trigger gate scenarios)', () => {
  // Scenario: not a pull_request event (local/workflow_dispatch/push) — full check runs
  // unchanged, exactly as before this gate existed. No PR context is read, no fetch happens.
  it('runs the full check unconditionally when the event is not a pull_request (local use unchanged)', async () => {
    const fetchChangedFilesSpy = vi.fn(() => [])
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      {eventName: undefined, eventPath: undefined},
      fakeGateDeps({fetchChangedFiles: fetchChangedFilesSpy}),
    )
    expect(result).toBeUndefined()
    expect(fetchChangedFilesSpy).not.toHaveBeenCalled()
  })

  // Scenario (happy path 1): changed set ['docs/x.md'] — no intersection — not-applicable.
  it("reports not-applicable when the changed set is ['docs/x.md'] (no intersection)", async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['docs/x.md']}),
    )
    expect(result?.verdict).toBe('not-applicable')
    expect(result?.mutants[0]?.reason).toContain('changed file')
    expect(result?.mutants[0]?.reason).toContain('trigger set')
  })

  // Scenario (happy path 2): changed set includes a mutate entry — proceeds to run.
  it('proceeds to run when the changed set includes a mutate entry', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['docs/unrelated.md', 'scripts/a.ts']}),
    )
    expect(result).toBeUndefined()
  })

  // Scenario (edge case 1): changed set includes only bun.lock — a fixed infrastructure
  // file, not a mutate/testFiles entry — still proceeds to run.
  it('proceeds to run when the changed set includes only bun.lock', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['bun.lock']}),
    )
    expect(result).toBeUndefined()
  })

  // Scenario (edge case 2): changed set includes only a file genuinely outside the import
  // closure of the fake mutate/testFiles set — not-applicable. Uses docs/x.md (guaranteed
  // outside any closure, since it is not TypeScript and not on any import graph) rather than a
  // real not-mutated package module: the closure now follows testFiles' own imports too (not
  // just mutate's), and several real not-mutated modules (e.g. frontmatter.ts) turn out to be
  // reached transitively through a real testFiles entry's barrel import — see the
  // 'closure-based trigger set against the real config' describe block below for that
  // discrimination against the real config specifically.
  it('reports not-applicable when the changed set includes only a file outside the trigger set (docs/x.md)', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['docs/x.md']}),
    )
    expect(result?.verdict).toBe('not-applicable')
  })

  // Scenario (error path): files API call fails — instrumentation-failed, never
  // not-applicable, per R9 (fail closed).
  it('reports instrumentation-failed, never not-applicable, when the changed-files API call fails', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({
        fetchChangedFiles: () => {
          throw new Error('gh api call failed: rate limited')
        },
      }),
    )
    expect(result?.verdict).toBe('instrumentation-failed')
    expect(result?.verdict).not.toBe('not-applicable')
    expect(result?.mutants[0]?.reason).toContain('gh api call failed')
  })

  it('reports instrumentation-failed, never not-applicable, when reading the PR context fails', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({
        readPullRequestContext: async () => {
          throw new Error('event payload missing pull_request.number')
        },
      }),
    )
    expect(result?.verdict).toBe('instrumentation-failed')
    expect(result?.mutants[0]?.reason).toContain('event payload missing')
  })

  it('reports instrumentation-failed when GITHUB_EVENT_PATH is not set on a pull_request event', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      {eventName: 'pull_request', eventPath: undefined},
      fakeGateDeps(),
    )
    expect(result?.verdict).toBe('instrumentation-failed')
    expect(result?.mutants[0]?.reason).toContain('GITHUB_EVENT_PATH')
  })

  it('reports instrumentation-failed when the event payload has no base.repo.full_name', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({
        readPullRequestContext: async () => ({
          prNumber: 1,
          author: 'x',
          headRef: 'y',
          headRepo: undefined,
          fullName: null,
        }),
      }),
    )
    expect(result?.verdict).toBe('instrumentation-failed')
    expect(result?.mutants[0]?.reason).toContain('full_name')
  })

  // A glob entry in mutate/testFiles must never let this gate short-circuit to not-applicable
  // — its expansion is unknown to this gate, so the simplest correct behavior is always "run".
  it('always proceeds to run when the config has a glob mutate/testFiles entry, regardless of changed files', async () => {
    const result = await evaluateTriggerGate(
      fakeTriggerConfig({mutate: ['scripts/*.ts']}),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['docs/entirely-unrelated.md']}),
    )
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Closure-based trigger set against the REAL stryker.config.json / mutation-guards.json.
// Blocking fix: buildTriggerSet's import closure must catch a change to a module that is only
// *imported by* a mutate/testFiles entry, not itself listed — without it, a PR touching only
// packages/wiki-write-core/src/wiki-slug.ts (reached from the corrections testFiles entries via
// wiki-ingest.ts) would read not-applicable and never run Stryker at all.
// ---------------------------------------------------------------------------

describe('closure-based trigger set against the real config', () => {
  const realConfig = readStrykerConfig(strykerConfigPath)
  const realTriggerSet = buildTriggerSet(realConfig)

  // Sanity: the real config's closure actually adds something beyond the literal enumerated
  // set, so every test below is exercising real closure behavior, not an accidentally-empty one.
  it('the real trigger set has a non-zero closure size', () => {
    expect(realTriggerSet.closureSize).toBeGreaterThan(0)
  })

  // (a) Discrimination, red under the old (pre-closure) buildTriggerSet: wiki-slug.ts is not
  // itself a mutate/testFiles entry (it is `not-mutated`, pending relocation per
  // mutation-guards.json), but corrections.test.ts / corrections-survival.test.ts (real testFiles
  // entries) import wiki-ingest.ts, which imports it directly. A PR touching only this
  // file must never read not-applicable — that would be exactly the fail-open the review
  // flagged: a change that can affect a mutated module's behavior silently skipping the check.
  it('does NOT report not-applicable for a changed set of only wiki-slug.ts (reached transitively from the corrections testFiles entries)', async () => {
    const result = await evaluateTriggerGate(
      realConfig,
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['packages/wiki-write-core/src/wiki-slug.ts']}),
    )
    expect(result).toBeUndefined()
    expect(realTriggerSet.files.has('packages/wiki-write-core/src/wiki-slug.ts')).toBe(true)
  })

  // (b) A changed file under the compiled packages/wiki-write-core/dist/ directory must also
  // proceed to run: several scripts/ mutate/testFiles entries (e.g.
  // scripts/check-wiki-authority.ts) import the package by name
  // (`@fro.bot/wiki-write-core/...`), which resolves against dist/ at run time — a stale or
  // hand-edited compiled file there can change this run's outcome even with no .ts source change.
  it('does NOT report not-applicable for a changed set of only a file under packages/wiki-write-core/dist/', async () => {
    expect(realTriggerSet.directoryPrefixes).toContain('packages/wiki-write-core/dist/')
    const result = await evaluateTriggerGate(
      realConfig,
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['packages/wiki-write-core/dist/private-leak.js']}),
    )
    expect(result).toBeUndefined()
  })

  // (c) A file genuinely outside the real closure, computed from the real config rather than
  // hardcoded, and confirmed both to EXIST on disk and to be absent from the real trigger set
  // — so the premise ("this file really is unreachable from every mutate/testFiles entry") is
  // visible in the test itself, not asserted by fiat. `scripts/reconcile-repos.ts` is a large,
  // wholly separate control-plane module (repo reconciliation/star-sync) with no import path
  // — direct, transitive, or via a `@fro.bot/wiki-write-core` package-name reference — from any
  // `mutate` or `testFiles` entry in `stryker.config.json`; it does not itself import, or get
  // imported by, anything in the mutation set. (`markdown-links.ts`, this test's previous
  // subject, no longer qualifies: the transitive-import fix now correctly reaches it through
  // `wiki-lint.ts`, which is itself reached from the mutated `corrections-survival.ts`'s
  // `import type {WikiLintFinding} from './wiki-lint.ts'`.)
  it('reports not-applicable for a real file confirmed outside the real import closure (scripts/reconcile-repos.ts)', async () => {
    const outsideClosureFile = 'scripts/reconcile-repos.ts'
    expect(existsSync(join(resolve(import.meta.dirname, '..'), outsideClosureFile))).toBe(true)
    expect(realTriggerSet.files.has(outsideClosureFile)).toBe(false)

    const result = await evaluateTriggerGate(
      realConfig,
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => [outsideClosureFile]}),
    )
    expect(result?.verdict).toBe('not-applicable')
  })

  // (c2) Workspace packages. A PR that touches only @fro-bot/ code must run the check: a core module
  // is a mutate entry, and a test-kit helper is reached only through a package-name import from a
  // testFiles entry (packages/registry/src/merge-back-data.test.ts imports @fro-bot/test-kit/git-data-fake), which
  // only the exports-map resolver follows.
  it.each([
    'packages/core/src/guards.ts',
    'packages/core/src/json.ts',
    'packages/core/src/output.ts',
    'packages/core/package.json',
    'packages/test-kit/package.json',
    'packages/test-kit/src/git-data-fake.ts',
  ])('does NOT report not-applicable for a changed set of only %s', async changedFile => {
    const result = await evaluateTriggerGate(
      realConfig,
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => [changedFile]}),
    )
    expect(result).toBeUndefined()
  })

  it('reaches the test-kit helper only through a package name, so the exports-map resolver is what puts it in the closure', () => {
    const helper = 'packages/test-kit/src/git-data-fake.ts'
    expect(realTriggerSet.files.has(helper)).toBe(true)
    expect(realConfig.mutate).not.toContain(helper)
    expect(realConfig.testFiles).not.toContain(helper)
    expect(reachedModulesTransitive('packages/registry/src/merge-back-data.test.ts').has(helper)).toBe(false)
  })

  it('reports not-applicable for a package README, which is neither a manifest nor imported', async () => {
    const unreached = 'packages/core/README.md'
    expect(realTriggerSet.files.has(unreached)).toBe(false)
    const result = await evaluateTriggerGate(
      realConfig,
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => [unreached]}),
    )
    expect(result?.verdict).toBe('not-applicable')
  })

  // (d) Every not-mutated entry in mutation-guards.json that IS imported (directly or
  // transitively, per buildImportClosure) by a real mutate entry must be in the trigger set —
  // the table the review's discrimination case (a) generalizes to every such entry, not just
  // wiki-slug.ts.
  it('includes every not-mutated entry that is imported by a mutate entry in the trigger set', () => {
    const notMutated: {readonly path: string; readonly reason: string}[] = (
      JSON.parse(readFileSync(join(resolve(import.meta.dirname, '..'), 'mutation-guards.json'), 'utf8')) as {
        'not-mutated': {readonly path: string; readonly reason: string}[]
      }
    )['not-mutated']

    const mutateClosure = buildImportClosure(realConfig.mutate)
    const violations: string[] = []

    for (const entry of notMutated) {
      const isImportedByMutate = mutateClosure.files.has(entry.path)
      const isInTriggerSet = realTriggerSet.files.has(entry.path)
      if (isImportedByMutate && !isInTriggerSet) {
        violations.push(entry.path)
      }
    }

    expect(
      violations,
      violations.length === 0
        ? undefined
        : `not-mutated entr(y/ies) reached by a mutate entry but missing from the trigger set: ${violations.join(', ')}`,
    ).toEqual([])
  })

  // Item 1's regular-import fix: wiki-ingest.ts (a testFiles entry's direct import) imports
  // wiki-slug.ts directly; wiki-lint.ts (reached from corrections-survival.ts, mutate, via `import type
  // {WikiLintFinding} from './wiki-lint.ts'`) imports markdown-links.ts directly; wiki-ingest.ts
  // (a testFiles entry's direct import) imports data-branch-bootstrap.ts directly. None of
  // these three second-hop modules are themselves re-export barrels — they are only reachable
  // if the BFS follows a REGULAR import, not just a re-export. Pins the exact closure-size
  // delta this fix produces on the real config.
  it('reaches markdown-links.ts and data-branch-bootstrap.ts through a regular (non-re-export) two-hop import chain', () => {
    expect(realTriggerSet.files.has('packages/wiki-write-core/src/markdown-links.ts')).toBe(true)
    expect(realTriggerSet.files.has('packages/wiki-write-core/src/data-branch-bootstrap.ts')).toBe(true)
  })

  // Item 3: a filesystem read failure during the closure walk itself (not just the PR-context
  // or changed-files API calls) must also fail closed to instrumentation-failed, never escape
  // as an uncaught exception. Injects a readSource that always throws.
  it('reports instrumentation-failed, never throws, when the import-closure walk cannot read a source file', async () => {
    const throwingReadSource = (): string => {
      throw new Error('EACCES: permission denied (simulated)')
    }

    const result = await evaluateTriggerGate(
      realConfig,
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['packages/wiki-write-core/src/wiki-slug.ts']}),
      throwingReadSource,
    )

    expect(result?.verdict).toBe('instrumentation-failed')
    expect(result?.mutants[0]?.status).toBe('ChangedFileGateFailed')
    expect(result?.mutants[0]?.reason).toContain('EACCES')
  })

  // End-to-end: the same failure proven above against evaluateTriggerGate directly must also
  // be reachable through runMutationGuardCheck's public entry point — the sixth
  // `triggerGateReadSource` seam must actually reach evaluateTriggerGate, not just exist on
  // the signature. A spawner that throws if called proves the gate short-circuits before
  // Stryker would ever run.
  it('reports instrumentation-failed through runMutationGuardCheck when triggerGateReadSource throws', async () => {
    // A dedicated temp path, never the real reportPath default — the gate throws before
    // runMutationGuardCheck's own rmSync(reportPath) runs, but that ordering is exactly what
    // this test proves, so a gate regression here must not risk deleting a real report.
    const tempReportPath = join(
      mkdtempSync(join(tmpdir(), 'check-mutation-guards-trigger-readsource-throws-')),
      'mutation.json',
    )
    const throwingReadSource = (): string => {
      throw new Error('EACCES: permission denied (simulated, via runMutationGuardCheck)')
    }
    const spawnerThatMustNotRun = (): void => {
      throw new Error('Stryker must not be spawned when the trigger gate fails closed')
    }

    try {
      const result = await runMutationGuardCheck(
        spawnerThatMustNotRun,
        tempReportPath,
        undefined,
        PULL_REQUEST_EVENT,
        fakeGateDeps({fetchChangedFiles: () => ['packages/wiki-write-core/src/wiki-slug.ts']}),
        throwingReadSource,
      )

      expect(result.verdict).toBe('instrumentation-failed')
      expect(result.mutants[0]?.status).toBe('ChangedFileGateFailed')
      expect(result.mutants[0]?.reason).toContain('EACCES: permission denied (simulated, via runMutationGuardCheck)')
    } finally {
      rmSync(dirname(tempReportPath), {recursive: true, force: true})
    }
  })
})

describe('runMutationGuardCheck (stale-report fix)', () => {
  // A dedicated temp directory, never the real reports/mutation/mutation.json, so this test
  // cannot clobber a real report a concurrent or subsequent run depends on.
  const tempReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-test-')), 'mutation.json')

  // A reporterConfig that agrees with tempReportPath, so this test proves only the
  // stale-report behavior — without this, the real stryker.config.json's resolved path would
  // never match a temp path and ReporterConfigMismatch would supply `instrumentation-failed`
  // on its own, making the `rmSync` this test exists to prove entirely vacuous to remove.
  const matchingReporterConfig: ReporterConfig = {reporters: ['json'], resolvedJsonReportPath: tempReportPath}

  // Fix 3 (blocking): a report left over from a prior run must never be classified as the
  // current result. Stage a stale "all Killed" report, then run the check with a spawner
  // that dies without writing anything — the fix (`rmSync` before spawning) makes this
  // `instrumentation-failed` with a `ReportUnreadable` sentinel (no fresh report was read);
  // without it, the stale report reads as `clean`.
  it('never classifies a stale on-disk report as a fresh clean result', async () => {
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
      const result = await runMutationGuardCheck(
        diedWithoutWriting,
        tempReportPath,
        matchingReporterConfig,
        NOT_A_PULL_REQUEST_ENV,
      )
      expect(result.verdict).toBe('instrumentation-failed')
      expect(result.verdict).not.toBe('clean')
      const runtimeErrorSentinels = result.mutants.filter(m => m.status === 'RuntimeError')
      expect(runtimeErrorSentinels).toHaveLength(1)
      expect(runtimeErrorSentinels[0]?.reason).toMatch(/ENOENT/u)
      expect(result.mutants.some(m => m.status === 'ReporterConfigMismatch')).toBe(false)
    } finally {
      rmSync(tempReportPath, {force: true})
    }
  })

  // Blocking: an unreadable report previously produced instrumentation-failed with zero
  // located mutants, giving a red build no clue why. Each of the three read-failure causes
  // must now produce exactly one RuntimeError sentinel naming the path and the actual cause.
  it('emits exactly one RuntimeError sentinel naming the path and ENOENT when the report file does not exist', async () => {
    const missingReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-missing-')), 'mutation.json')
    const reporterConfigForPath: ReporterConfig = {reporters: ['json'], resolvedJsonReportPath: missingReportPath}
    const noOpSpawner = (): void => {
      // Runs and returns without writing anything — the report path never exists.
    }
    try {
      const result = await runMutationGuardCheck(
        noOpSpawner,
        missingReportPath,
        reporterConfigForPath,
        NOT_A_PULL_REQUEST_ENV,
      )
      expect(result.verdict).toBe('instrumentation-failed')
      const sentinels = result.mutants.filter(m => m.status === 'RuntimeError')
      expect(sentinels).toHaveLength(1)
      expect(sentinels[0]?.file).toBe(missingReportPath)
      expect(sentinels[0]?.mutator).toBe('ReportUnreadable')
      expect(sentinels[0]?.reason).toMatch(/ENOENT/u)
      expect(result.mutants.some(m => m.status === 'ReporterConfigMismatch')).toBe(false)
    } finally {
      rmSync(dirname(missingReportPath), {recursive: true, force: true})
    }
  })

  it('emits exactly one RuntimeError sentinel naming the path and the parse error when the report file is malformed JSON', async () => {
    const malformedReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-malformed-')), 'mutation.json')
    const reporterConfigForPath: ReporterConfig = {reporters: ['json'], resolvedJsonReportPath: malformedReportPath}
    // runMutationGuardCheck clears reportPath before invoking the spawner, so the malformed
    // content must be written BY the spawner (simulating Stryker writing bad output), not
    // staged beforehand — staging first would just be deleted by the pre-spawn rmSync.
    const spawnerThatWritesMalformedJson = (): void => {
      writeFileSync(malformedReportPath, '{not valid json', 'utf8')
    }
    try {
      const result = await runMutationGuardCheck(
        spawnerThatWritesMalformedJson,
        malformedReportPath,
        reporterConfigForPath,
        NOT_A_PULL_REQUEST_ENV,
      )
      expect(result.verdict).toBe('instrumentation-failed')
      const sentinels = result.mutants.filter(m => m.status === 'RuntimeError')
      expect(sentinels).toHaveLength(1)
      expect(sentinels[0]?.file).toBe(malformedReportPath)
      expect(sentinels[0]?.mutator).toBe('ReportUnreadable')
      expect(sentinels[0]?.reason?.length).toBeGreaterThan(0)
      expect(result.mutants.some(m => m.status === 'ReporterConfigMismatch')).toBe(false)
    } finally {
      rmSync(dirname(malformedReportPath), {recursive: true, force: true})
    }
  })

  // Blocking: the reporterConfig seam itself must be provably load-bearing on
  // runMutationGuardCheck, not just accepted and ignored. A mismatched override on a
  // perfectly good report must fail closed with the specific sentinel; a matching override
  // on the same report must pass clean.
  it('reports instrumentation-failed with a ReporterConfigMismatch sentinel when an injected reporterConfig disagrees with reportPath', async () => {
    const goodReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-mismatch-')), 'mutation.json')
    const spawnerThatWritesAGoodReport = (): void => {
      writeFileSync(
        goodReportPath,
        JSON.stringify({
          files: {
            'good-file.ts': {
              mutants: [{mutatorName: 'StringLiteral', status: 'Killed', location: {start: {line: 1, column: 1}}}],
            },
          },
        }),
        'utf8',
      )
    }
    const mismatchedReporterConfig: ReporterConfig = {
      reporters: ['json'],
      resolvedJsonReportPath: '/some/entirely/different/path/mutation.json',
    }
    try {
      const result = await runMutationGuardCheck(
        spawnerThatWritesAGoodReport,
        goodReportPath,
        mismatchedReporterConfig,
        NOT_A_PULL_REQUEST_ENV,
      )
      expect(result.verdict).toBe('instrumentation-failed')
      expect(result.mutants.some(m => m.status === 'ReporterConfigMismatch')).toBe(true)
    } finally {
      rmSync(dirname(goodReportPath), {recursive: true, force: true})
    }
  })

  // Note: cannot assert an overall 'clean' verdict here, because runMutationGuardCheck always
  // reads the real stryker.config.json's `mutate` list, and this synthetic report's single
  // fake file key will never satisfy the (unrelated) report-key cross-check against the real
  // ten-module `mutate` set. Asserting the absence of ReporterConfigMismatch specifically is
  // the precise claim this test exists to prove: a matching reporterConfig does not, on its
  // own, fail the check.
  it('does not report a ReporterConfigMismatch when an injected reporterConfig agrees with reportPath', async () => {
    const goodReportPath = join(mkdtempSync(join(tmpdir(), 'check-mutation-guards-match-')), 'mutation.json')
    const spawnerThatWritesAGoodReport = (): void => {
      writeFileSync(
        goodReportPath,
        JSON.stringify({
          files: {
            'good-file.ts': {
              mutants: [{mutatorName: 'StringLiteral', status: 'Killed', location: {start: {line: 1, column: 1}}}],
            },
          },
        }),
        'utf8',
      )
    }
    const matchingReporterConfig: ReporterConfig = {reporters: ['json'], resolvedJsonReportPath: goodReportPath}
    try {
      const result = await runMutationGuardCheck(
        spawnerThatWritesAGoodReport,
        goodReportPath,
        matchingReporterConfig,
        NOT_A_PULL_REQUEST_ENV,
      )
      expect(result.mutants.some(m => m.status === 'ReporterConfigMismatch')).toBe(false)
    } finally {
      rmSync(dirname(goodReportPath), {recursive: true, force: true})
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
  it('never touches the real mutationReportPath when a reportPath override is given', async () => {
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
      await runMutationGuardCheck(noOpSpawner, otherTempReportPath, undefined, NOT_A_PULL_REQUEST_ENV)

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

describe('defaultStrykerSpawner (CI step-summary and credential isolation)', () => {
  // Vitest's auto-registered github-actions reporter (unchanged in Vitest 5) appends a "## Vitest Test Report"
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

  // By the time this spawn happens, evaluateTriggerGate has already made every gh/GitHub API
  // call this check needs — the token has done its one job. Stryker's dry run and every
  // mutant batch execute this repository's own test suite; neither the token nor its use
  // should be observable to mutated test code, so both credential env vars are removed before
  // the spawn rather than trusted to stay unused.
  it('spawns Stryker with GH_TOKEN and GITHUB_TOKEN removed from the child env, without mutating the parent env', () => {
    const originalGhToken = process.env.GH_TOKEN
    const originalGithubToken = process.env.GITHUB_TOKEN
    process.env.GH_TOKEN = 'parent-gh-token'
    process.env.GITHUB_TOKEN = 'parent-github-token'
    mockSpawnSync.mockReturnValue({error: undefined, status: 0})

    try {
      defaultStrykerSpawner()

      const call = mockSpawnSync.mock.calls.at(-1) as [string, string[], {env?: NodeJS.ProcessEnv}] | undefined
      const childEnv = call?.[2]?.env
      expect(childEnv).toBeDefined()
      expect(childEnv).not.toHaveProperty('GH_TOKEN')
      expect(childEnv).not.toHaveProperty('GITHUB_TOKEN')

      // The parent process env must be untouched — only the child spawn's env is filtered.
      expect(process.env.GH_TOKEN).toBe('parent-gh-token')
      expect(process.env.GITHUB_TOKEN).toBe('parent-github-token')
    } finally {
      if (originalGhToken === undefined) {
        delete process.env.GH_TOKEN
      } else {
        process.env.GH_TOKEN = originalGhToken
      }
      if (originalGithubToken === undefined) {
        delete process.env.GITHUB_TOKEN
      } else {
        process.env.GITHUB_TOKEN = originalGithubToken
      }
      mockSpawnSync.mockReset()
    }
  })
})

describe('wikiWriteCoreSubpathSourceFiles specifier scan', () => {
  const sourceFilesFor = (source: string): string[] =>
    wikiWriteCoreSubpathSourceFiles('scripts/fixture.ts', () => source)

  it('maps the bare package specifier to the index source file', () => {
    expect(sourceFilesFor(`import {x} from '@fro.bot/wiki-write-core'`)).toEqual([
      'packages/wiki-write-core/src/index.ts',
    ])
  })

  it('maps every subpath specifier shape to its source file', () => {
    const source = [
      `import {a} from '@fro.bot/wiki-write-core/wiki-slug'`,
      `export * from '@fro.bot/wiki-write-core/private-leak'`,
      `const m = await import('@fro.bot/wiki-write-core/schemas')`,
    ].join('\n')
    expect(sourceFilesFor(source)).toEqual([
      'packages/wiki-write-core/src/wiki-slug.ts',
      'packages/wiki-write-core/src/private-leak.ts',
      'packages/wiki-write-core/src/schemas.ts',
    ])
  })

  it('maps a no-substitution template-literal specifier in a dynamic import and the vitest references', () => {
    const source = [
      'const a = await import(`@fro.bot/wiki-write-core/schemas`)',
      'await vi.importActual(`@fro.bot/wiki-write-core/wiki-slug`)',
      'vi.mock(`@fro.bot/wiki-write-core`)',
    ].join('\n')
    expect(sourceFilesFor(source)).toEqual([
      'packages/wiki-write-core/src/schemas.ts',
      'packages/wiki-write-core/src/wiki-slug.ts',
      'packages/wiki-write-core/src/index.ts',
    ])
  })

  it('leaves a template literal with a substitution alone', () => {
    expect(sourceFilesFor(`await import(\`@fro.bot/wiki-write-core/\${name}\`)`)).toEqual([])
  })

  it('maps a bare side-effect import and the vitest module references', () => {
    const source = [
      `import '@fro.bot/wiki-write-core/schemas'`,
      `const a = await vi.importActual('@fro.bot/wiki-write-core/wiki-slug')`,
      `vi.mock('@fro.bot/wiki-write-core')`,
    ].join('\n')
    expect(sourceFilesFor(source)).toEqual([
      'packages/wiki-write-core/src/schemas.ts',
      'packages/wiki-write-core/src/wiki-slug.ts',
      'packages/wiki-write-core/src/index.ts',
    ])
  })

  // The `@fro-bot/` scope names the private workspace packages. It is resolved through each
  // package's exports map by `froBotPackageSourceFiles`, never by this published-package scan.
  it('leaves the @fro-bot scope to the workspace-package resolver', () => {
    expect(sourceFilesFor(`import {x} from '@fro-bot/wiki-write-core'`)).toEqual([])
    expect(sourceFilesFor(`import {x} from '@fro-bot/wiki-write-core/wiki-slug'`)).toEqual([])
    expect(sourceFilesFor(`import {x} from '@fro-bot/core/guards'`)).toEqual([])
  })

  it('rejects a lookalike scope where the dot is any other character', () => {
    expect(sourceFilesFor(`import {x} from '@froxbot/wiki-write-core'`)).toEqual([])
    expect(sourceFilesFor(`import {x} from '@froxbot/wiki-write-core/wiki-slug'`)).toEqual([])
  })

  it('finds package references in the real scripts tree, so a scan that matches nothing cannot pass', () => {
    const scriptsDirectory = join(resolve(import.meta.dirname, '..'), 'scripts')
    const referencingFiles = readdirSync(scriptsDirectory)
      .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map(name => ({name, sources: wikiWriteCoreSubpathSourceFiles(`scripts/${name}`)}))
      .filter(({sources}) => sources.length > 0)

    expect(referencingFiles.length).toBeGreaterThanOrEqual(10)
    for (const {sources} of referencingFiles) {
      for (const source of sources) {
        expect(existsSync(join(resolve(import.meta.dirname, '..'), source)), source).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// `@fro-bot/<pkg>[/<sub>]` resolution through each workspace package's `exports` map, and the
// package-manifest triggers. The fake reader serves package manifests and sources from a map,
// so these tests do not depend on which packages exist on disk.
// ---------------------------------------------------------------------------

const repositoryRootForFakes = resolve(import.meta.dirname, '..')

/**
 * A `SourceReader` backed by a repo-relative path map. A `.ts` path missing from the map reads as
 * an empty module, so a closure walk that reaches a real file on disk stays inside the fake. Any
 * other missing path fails with ENOENT, the way a package that does not exist does.
 */
function fakeSourceReader(files: Readonly<Record<string, string>>): (absolutePath: string) => string {
  return absolutePath => {
    const repoRelative = relative(repositoryRootForFakes, absolutePath).replaceAll('\\', '/')
    const content = files[repoRelative]
    if (content !== undefined) return content
    if (repoRelative.endsWith('.ts')) return 'export {}\n'
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${repoRelative}'`), {code: 'ENOENT'})
  }
}

const CORE_MANIFEST = JSON.stringify({
  name: '@fro-bot/core',
  exports: {'./guards': './src/guards.ts', './output': './src/output.ts', '.': './src/index.ts'},
})
const WIKI_WRITE_CORE_MANIFEST = JSON.stringify({
  name: '@fro.bot/wiki-write-core',
  exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
})

describe('froBotPackageSourceFiles specifier scan', () => {
  const sourceFilesFor = (source: string, extra: Readonly<Record<string, string>> = {}): string[] =>
    froBotPackageSourceFiles(
      'scripts/fixture.ts',
      fakeSourceReader({
        'scripts/fixture.ts': source,
        'packages/core/package.json': CORE_MANIFEST,
        'packages/wiki-write-core/package.json': WIKI_WRITE_CORE_MANIFEST,
        ...extra,
      }),
    )

  it('maps a subpath specifier to the source file its exports entry names', () => {
    expect(sourceFilesFor(`import {isRecord} from '@fro-bot/core/guards'`)).toEqual(['packages/core/src/guards.ts'])
  })

  it('maps the bare package specifier through the "." exports entry', () => {
    expect(sourceFilesFor(`import {x} from '@fro-bot/core'`)).toEqual(['packages/core/src/index.ts'])
  })

  it('maps every reference shape: static from-clause, re-export and dynamic import', () => {
    const source = [
      `import {a} from '@fro-bot/core/guards'`,
      `export * from '@fro-bot/core/output'`,
      `const m = await import('@fro-bot/core/guards')`,
    ].join('\n')
    expect(sourceFilesFor(source)).toEqual([
      'packages/core/src/guards.ts',
      'packages/core/src/output.ts',
      'packages/core/src/guards.ts',
    ])
  })

  it('ignores a specifier inside a comment', () => {
    expect(sourceFilesFor(`// import {x} from '@fro-bot/core/guards'\n/* import('@fro-bot/core/output') */`)).toEqual(
      [],
    )
  })

  it('does not resolve a subpath the exports map does not name', () => {
    expect(sourceFilesFor(`import {x} from '@fro-bot/core/missing'`)).toEqual([])
  })

  it('does not resolve a package whose manifest does not exist', () => {
    expect(sourceFilesFor(`import {x} from '@fro-bot/absent/guards'`)).toEqual([])
  })

  it('does not resolve @fro-bot/wiki-write-core: the published package is @fro.bot/wiki-write-core', () => {
    expect(sourceFilesFor(`import {x} from '@fro-bot/wiki-write-core'`)).toEqual([])
    expect(sourceFilesFor(`import {x} from '@fro.bot/wiki-write-core'`)).toEqual([])
  })

  it('rejects a lookalike scope where the dash is any other character', () => {
    expect(sourceFilesFor(`import {x} from '@fro.bot/core/guards'`)).toEqual([])
    expect(sourceFilesFor(`import {x} from '@froxbot/core/guards'`)).toEqual([])
  })

  it('fails closed on a manifest it cannot read for any reason other than a missing file', () => {
    const reader = (absolutePath: string): string => {
      if (absolutePath.endsWith('package.json')) throw new Error('EACCES: permission denied (simulated)')
      return `import {x} from '@fro-bot/core/guards'`
    }
    expect(() => froBotPackageSourceFiles('scripts/fixture.ts', reader)).toThrow('EACCES')
  })

  it('fails closed on a manifest that is not valid JSON', () => {
    expect(() =>
      sourceFilesFor(`import {x} from '@fro-bot/core/guards'`, {'packages/core/package.json': '{not json'}),
    ).toThrow('packages/core/package.json')
  })

  it('fails closed on an exports entry that is not a plain string path', () => {
    const manifest = JSON.stringify({name: '@fro-bot/core', exports: {'./guards': {import: './src/guards.ts'}}})
    expect(() =>
      sourceFilesFor(`import {x} from '@fro-bot/core/guards'`, {'packages/core/package.json': manifest}),
    ).toThrow('@fro-bot/core/guards')
  })

  it('maps a bare side-effect import', () => {
    expect(sourceFilesFor(`import '@fro-bot/core/guards'`)).toEqual(['packages/core/src/guards.ts'])
  })

  it('maps a no-substitution template-literal specifier in a dynamic import', () => {
    expect(sourceFilesFor('const m = await import(`@fro-bot/core/output`)')).toEqual(['packages/core/src/output.ts'])
    expect(sourceFilesFor('const m = await import( `@fro-bot/core/output` )')).toEqual(['packages/core/src/output.ts'])
  })

  it('maps a template-literal specifier in every vitest module reference', () => {
    const source = [
      'await vi.importActual(`@fro-bot/core/guards`)',
      'await vi.importActual<typeof import(`@fro-bot/core/output`)>(`@fro-bot/core/output`)',
      'vi.mock(`@fro-bot/core/guards`)',
      'vi.doMock(`@fro-bot/core/output`, () => ({}))',
      'await vi.importMock(`@fro-bot/core/guards`)',
    ].join('\n')
    expect(new Set(sourceFilesFor(source))).toEqual(
      new Set(['packages/core/src/guards.ts', 'packages/core/src/output.ts']),
    )
  })

  it('leaves a template literal with a substitution alone: it cannot be resolved statically', () => {
    expect(sourceFilesFor(`await import(\`@fro-bot/core/\${name}\`)`)).toEqual([])
    expect(sourceFilesFor(`await import(\`@fro-bot/core/output\${suffix}\`)`)).toEqual([])
  })

  it('keeps `from` and bare `import` string-literal only: a backtick is not valid there', () => {
    expect(sourceFilesFor('import {x} from `@fro-bot/core/guards`')).toEqual([])
    expect(sourceFilesFor('import `@fro-bot/core/guards`')).toEqual([])
  })

  it('maps the vitest module references: importActual, importMock, mock and doMock', () => {
    const source = [
      `const a = await vi.importActual('@fro-bot/core/guards')`,
      `const b = await vi.importActual<typeof import('@fro-bot/core/output')>('@fro-bot/core/output')`,
      `vi.mock('@fro-bot/core/guards')`,
      `vi.doMock('@fro-bot/core/output', () => ({}))`,
      `const c = await vi.importMock('@fro-bot/core/guards')`,
    ].join('\n')
    expect(new Set(sourceFilesFor(source))).toEqual(
      new Set(['packages/core/src/guards.ts', 'packages/core/src/output.ts']),
    )
  })

  it('resolves a nested subpath key through the exports map', () => {
    const manifest = JSON.stringify({name: '@fro-bot/core', exports: {'./util/deep': './src/util/deep.ts'}})
    expect(
      sourceFilesFor(`import {x} from '@fro-bot/core/util/deep'`, {'packages/core/package.json': manifest}),
    ).toEqual(['packages/core/src/util/deep.ts'])
  })

  it('does not resolve a nested subpath the exports map does not name', () => {
    expect(sourceFilesFor(`import {x} from '@fro-bot/core/util/deep'`)).toEqual([])
  })

  it('does not stop a subpath at its first segment: the whole specifier is the exports key', () => {
    const manifest = JSON.stringify({name: '@fro-bot/core', exports: {'./util': './src/util.ts'}})
    expect(
      sourceFilesFor(`import {x} from '@fro-bot/core/util/deep'`, {'packages/core/package.json': manifest}),
    ).toEqual([])
  })

  it('ignores a manifest whose name is not the requested package', () => {
    const manifest = JSON.stringify({name: '@fro-bot/other', exports: {'./guards': './src/guards.ts'}})
    expect(sourceFilesFor(`import {x} from '@fro-bot/core/guards'`, {'packages/core/package.json': manifest})).toEqual(
      [],
    )
  })
})

describe('import closure through @fro-bot/ package names', () => {
  const files = {
    'scripts/check-mutation-guards.ts': `import {isRecord} from '@fro-bot/core/guards'\nexport {isRecord}\n`,
    'packages/core/package.json': CORE_MANIFEST,
  }
  const config = (overrides: Partial<StrykerConfigShape> = {}): StrykerConfigShape =>
    fakeTriggerConfig({
      mutate: ['scripts/check-mutation-guards.ts'],
      testFiles: ['scripts/check-mutation-guards.test.ts'],
      ...overrides,
    })

  it('adds the resolved package source file to the closure, without a dist directory trigger', () => {
    const closure = buildImportClosure(['scripts/check-mutation-guards.ts'], fakeSourceReader(files))
    expect(closure.files.has('packages/core/src/guards.ts')).toBe(true)
    expect(closure.hasWikiWriteCoreSubpathReference).toBe(false)
  })

  it('reports a change to the package file applicable when a mutate entry imports it only by name', async () => {
    const result = await evaluateTriggerGate(
      config(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['packages/core/src/guards.ts']}),
      fakeSourceReader(files),
    )
    expect(result).toBeUndefined()
  })

  describe('a package imported by a file the entry reaches, not by the entry itself', () => {
    const helperFiles = {
      ...files,
      'scripts/check-mutation-guards.ts': `import {helper} from './check-wiki-authority.ts'\nexport {helper}\n`,
      'scripts/check-wiki-authority.ts': `import {isRecord} from '@fro-bot/core/guards'\nexport const helper = isRecord\n`,
    }

    it('puts the package file in the closure', () => {
      const closure = buildImportClosure(['scripts/check-mutation-guards.ts'], fakeSourceReader(helperFiles))
      expect(closure.files.has('scripts/check-wiki-authority.ts')).toBe(true)
      expect(closure.files.has('packages/core/src/guards.ts')).toBe(true)
    })

    it('does not report not-applicable when only the package file changed', async () => {
      const result = await evaluateTriggerGate(
        config(),
        PULL_REQUEST_EVENT,
        fakeGateDeps({fetchChangedFiles: () => ['packages/core/src/guards.ts']}),
        fakeSourceReader(helperFiles),
      )
      expect(result).toBeUndefined()
    })

    it('reports a change to the package file applicable when a mutate entry imports it by a template literal', async () => {
      const reader = fakeSourceReader({
        ...files,
        'scripts/check-mutation-guards.ts': 'export const load = () => import(`@fro-bot/core/output`)\n',
      })
      const result = await evaluateTriggerGate(
        config(),
        PULL_REQUEST_EVENT,
        fakeGateDeps({fetchChangedFiles: () => ['packages/core/src/output.ts']}),
        reader,
      )
      expect(result).toBeUndefined()
    })

    it('does the same for a template-literal vi.importActual', async () => {
      const reader = fakeSourceReader({
        ...files,
        'scripts/check-mutation-guards.ts': 'export const load = () => vi.importActual(`@fro-bot/core/output`)\n',
      })
      const result = await evaluateTriggerGate(
        config(),
        PULL_REQUEST_EVENT,
        fakeGateDeps({fetchChangedFiles: () => ['packages/core/src/output.ts']}),
        reader,
      )
      expect(result).toBeUndefined()
    })

    it('marks the dist directory a trigger when a reached file imports @fro.bot/wiki-write-core by name', () => {
      const reader = fakeSourceReader({
        ...helperFiles,
        'scripts/check-wiki-authority.ts': `import {x} from '@fro.bot/wiki-write-core/schemas'\nexport const helper = x\n`,
      })
      const closure = buildImportClosure(['scripts/check-mutation-guards.ts'], reader)
      expect(closure.hasWikiWriteCoreSubpathReference).toBe(true)
      expect(closure.files.has('packages/wiki-write-core/src/schemas.ts')).toBe(true)
    })

    it('follows a package file reached from a reached file on to the package file it imports by relative path', () => {
      const reader = fakeSourceReader({
        ...helperFiles,
        'packages/core/src/guards.ts': `export * from './output.ts'\n`,
      })
      const closure = buildImportClosure(['scripts/check-mutation-guards.ts'], reader)
      expect(closure.files.has('packages/core/src/guards.ts')).toBe(true)
    })
  })

  it('still reports a package file the closure does not reach as not-applicable', async () => {
    const result = await evaluateTriggerGate(
      config(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['packages/core/src/unrelated.ts']}),
      fakeSourceReader(files),
    )
    expect(result?.verdict).toBe('not-applicable')
  })

  it('reports instrumentation-failed when a package manifest cannot be read during the closure walk', async () => {
    const reader = (absolutePath: string): string => {
      if (absolutePath.endsWith('package.json')) throw new Error('EACCES: permission denied (simulated manifest)')
      return files['scripts/check-mutation-guards.ts']
    }
    const result = await evaluateTriggerGate(
      config(),
      PULL_REQUEST_EVENT,
      fakeGateDeps({fetchChangedFiles: () => ['docs/x.md']}),
      reader,
    )
    expect(result?.verdict).toBe('instrumentation-failed')
    expect(result?.mutants[0]?.reason).toContain('EACCES')
  })
})

describe('package manifests are fixed triggers', () => {
  const evaluate = async (changed: string[]) =>
    evaluateTriggerGate(fakeTriggerConfig(), PULL_REQUEST_EVENT, fakeGateDeps({fetchChangedFiles: () => changed}))

  it.each(['packages/core/package.json', 'packages/test-kit/package.json', 'packages/brand-new/package.json'])(
    'runs for a changed %s',
    async manifest => {
      expect(await evaluate([manifest])).toBeUndefined()
    },
  )

  it('lists every existing package manifest in the trigger set, so the logged size counts them', () => {
    const triggerSet = buildTriggerSet(fakeTriggerConfig())
    for (const manifest of ['packages/core/package.json', 'packages/test-kit/package.json']) {
      expect(triggerSet.files.has(manifest), manifest).toBe(true)
    }
    expect(triggerSet.closureSize).toBe(0)
  })

  it('carries the manifest pattern on the trigger set, so membership is decided from the trigger set alone', () => {
    const triggerSet = buildTriggerSet(fakeTriggerConfig())
    expect(triggerSet.filePatterns.some(pattern => pattern.test('packages/brand-new/package.json'))).toBe(true)
    expect(triggerSet.filePatterns.some(pattern => pattern.test('packages/core/README.md'))).toBe(false)
    expect(changedFilesIntersectTriggerSet(['packages/brand-new/package.json'], triggerSet)).toBe(true)
  })

  it('reports the manifest-inclusive size in the not-applicable reason', async () => {
    const result = await evaluate(['docs/x.md'])
    const size = buildTriggerSet(fakeTriggerConfig()).files.size
    expect(result?.mutants[0]?.reason).toContain(`${String(size)}-file trigger set`)
    expect(size).toBeGreaterThanOrEqual(17)
  })

  it('keeps the wiki-write-core manifest in the explicit fixed list', () => {
    expect(buildTriggerSet(fakeTriggerConfig()).files.has('packages/wiki-write-core/package.json')).toBe(true)
  })

  it.each([
    'packages/core/README.md',
    'packages/core/src/nested/package.json',
    'package.json.bak',
    'docs/packages/core/package.json',
  ])('does not run for %s, which is not a package manifest', async changed => {
    expect((await evaluate([changed]))?.verdict).toBe('not-applicable')
  })

  it('matches a normalized path with a leading ./', () => {
    expect(
      changedFilesIntersectTriggerSet(['./packages/core/package.json'], buildTriggerSet(fakeTriggerConfig())),
    ).toBe(true)
  })
})
