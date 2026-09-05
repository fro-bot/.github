import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import process from 'node:process'

import {describe, expect, it, vi} from 'vitest'

import {
  classifyMutationReport,
  defaultStrykerSpawner,
  flattenReport,
  mutationReportPath,
  runMutationGuardCheck,
  scanDirectiveViolations,
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
    expect(classifyMutationReport({files: {}, extra: true}, []).verdict).toBe('clean')
    expect(classifyMutationReport('a string, not a report', []).verdict).toBe('instrumentation-failed')
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

  // Verified against Stryker's own `^\s?Stryker ...` anchor (no multiline flag, matched
  // against the whole comment value): a directive on a *continuation* line of a block comment
  // (e.g. the ` * Stryker disable all` line inside a `/**` doc-style block) can never be the
  // start of `comment.value`, so Stryker itself never honors it. This scanner also has no
  // `/*` on that line to key off, so it correctly leaves the line unscanned — matching
  // Stryker's behavior rather than accidentally being stricter than it.
  it('does not flag a block-comment continuation line, matching Stryker\'s own "opening line only" anchor', () => {
    const violations = scan('/**\n * Stryker disable all\n */\nconst x = 1\n')
    expect(violations).toEqual([])
  })
})

describe('runMutationGuardCheck (stale-report fix)', () => {
  const reportDir = dirname(mutationReportPath)

  // Fix 3 (blocking): a report left over from a prior run must never be classified as the
  // current result. Stage a stale "all Killed" report, then run the check with a spawner
  // that dies without writing anything — the fix (`rmSync` before spawning) makes this
  // `instrumentation-failed` (no fresh report); without it, the stale report reads as `clean`.
  it('never classifies a stale on-disk report as a fresh clean result', () => {
    mkdirSync(reportDir, {recursive: true})
    writeFileSync(
      mutationReportPath,
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
      const result = runMutationGuardCheck(diedWithoutWriting)
      expect(result.verdict).toBe('instrumentation-failed')
      expect(result.verdict).not.toBe('clean')
    } finally {
      rmSync(mutationReportPath, {force: true})
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
