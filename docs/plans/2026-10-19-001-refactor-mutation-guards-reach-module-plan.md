---
title: 'refactor: Move the source-reach guard into a mutated module'
type: refactor
status: complete
date: 2026-10-19
---

# refactor: Move the source-reach guard into a mutated module

## Overview

The source-reach guard functions `isPureReexportBarrel`, `sourceReachTransitive` and `findMutateEntriesWithoutSourceReach` live in `scripts/mutation-guards-config.test.ts`. `walkNonTestTsFiles` filters out `*.test.ts`, so these functions can never enter `stryker.config.json` `mutate`. The guard that requires every gate module to be mutation-covered is not mutation-covered itself.

This plan moves them into `scripts/mutation-guards-reach.ts` and registers that module in `mutate`. It restructures the traversal so every branch is killable, replaces the disk fixtures with in-memory ones, and ships when a live `pnpm check:mutation-guards` returns `clean`.

## Problem Frame

Issue #3835, refined by Fro Bot's acceptance criteria in its first comment there. Simply relocating the functions would not reach 100%:

- `sourceReachTransitive` dedups twice. Every enqueue inside the loop is gated by `reached.has`, which makes the `visited` set and the `current === undefined` guard redundant there. The initial scan checks only `existsSync`, so a duplicated direct specifier is queued twice, and only `visited` removes it. A cycle fixture cannot kill the `||`→`&&` mutant, and `followQueue.length > 0`→`>= 0` loops forever. `scripts/check-mutation-guards.ts` scores that loop as `mutant-timeout`, not `clean`.
- The `existsSync` check after dequeue is dead, because both push sites filter on `existsSync`. The same dead line appears in `reachedModulesTransitive` in `scripts/check-mutation-guards.ts`.
- Tests 3a and 3b write fixtures under `scripts/.mutation-guards-source-reach-*`, and a `beforeAll` sweep deletes every directory matching that pattern. Stryker 10 runs all workers in one shared sandbox (4 on CI). The sweep re-runs on every mutant run, so it can delete a sibling worker's live fixture, which counts a survivor as killed.
- `BARREL_EXPORT_STATEMENT_PATTERN` is a module-level const. Its roughly 56 regex mutants would be static mutants that run every test file, adding about 4 minutes to a job that currently takes 5–8 minutes.
- `docs/solutions/best-practices/a-docstring-that-enumerates-forms-is-a-test-table-2026-09-08.md` carries a `verify:` marker that `check:solutions-examples`, which `pnpm lint` runs, resolves against the current file.

## Requirements Trace

- R1. The three guard functions, plus `normalizePath` and `treeOf`, live in a non-test module that is listed in `mutate`. Its colocated test is listed in `testFiles`.
- R2. The module is enumerated by the gate-file naming convention. It has no `mutation-guards.json` entry, because a path cannot appear in both `mutate` and `not-mutated`.
- R3. Behavior is unchanged. The real-config check still reports zero violations, and still flags `private-leak.ts` when its direct exercisers are removed.
- R4. Every mutant Stryker generates in the module is killed. No `Stryker disable` directive is added.
- R5. No test writes fixtures to disk under `scripts/`. The fixture sweep and its `.gitignore` entry are removed.
- R6. The dead `existsSync` line is removed from both traversals.
- R7. `pnpm lint` passes, including `check:solutions-examples`.
- R8. A live `pnpm check:mutation-guards` returns `clean`. Per-module kill counts are recorded in the PR body, and the new test file appears in the report's `testFiles`.

## Scope Boundaries

- `findMutateTestPairingViolations` and `reachedModulesTransitive` stay where they are. The only change to them is deleting the dead line from `reachedModulesTransitive`.
- `normalizeMutatePath` in `scripts/check-mutation-guards.ts` stays a private duplicate. Importing from the reach module would create a cycle.
- No trigger-set edit. `buildTriggerSet` already includes every `mutate` and `testFiles` entry.
- The barrel regex pattern is unchanged byte-for-byte. Only its container changes, from const to function.

## Context & Research

### Relevant Code and Patterns

- `scripts/mutation-guards-config.test.ts` contains the following:
  - `listScriptsGateFiles` and the `CHECK_SCRIPT_PATTERN` and `WIKI_GATES_PATTERN` conventions.
  - `normalizePath` and `treeOf`. These are shared with the pairing check, which stays.
  - `BARREL_EXPORT_STATEMENT_PATTERN`, `isPureReexportBarrel`, `sourceReachTransitive` and `findMutateEntriesWithoutSourceReach`.
  - The `findMutateEntriesWithoutSourceReach (barrel exclusion)` describe, with Tests 1–6 and the `beforeAll` sweep.
  - The `findMutateTestPairingViolations (pure)` describe. Its fake-`reach` style is the fixture pattern to follow.
- `scripts/check-mutation-guards.ts` exports `SourceReader`, `isLiteralPath`, `stripComments` and `directSpecifiers`. `defaultReadSource` is private. The verdict comes from `classifyMutationReport`, and the closure from `buildTriggerSet`. Both reach modules import only from this not-mutated file, so nothing extra is instrumented and no cycle forms.
- `stryker.config.json` has 9 `mutate` entries and 11 `testFiles` entries, no `concurrency` key, and `ignorePatterns: [".worktrees"]`.
- `.github/workflows/main.yaml` has the `Check Mutation Guards` job, a required context with a 20-minute cap that uploads `reports/mutation/mutation.json`. A strip-only module-load step requires that new scripts load under Node strip-only mode and do nothing on import.

### Institutional Learnings

- `docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md`: a directive suppresses every variant of its mutator, so prefer deleting dead code.
- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`: keep guarded logic in callable function form, and confirm tests import the instrumented tree.
- `docs/solutions/best-practices/a-docstring-that-enumerates-forms-is-a-test-table-2026-09-08.md`: every documented barrel form is an executable fixture row.
- `docs/solutions/best-practices/equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md`: do not change the regex just to silence mutants.
- `docs/solutions/best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md`: Stryker can omit a test file without saying so, so verify the new test is actually collected.

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "build-new-within-scope",
  "scope": "scripts/ (gate-module tree: stryker.config.json mutate/testFiles, mutation-guards.json, and the guard and test files that enforce them)",
  "freshness": {
    "vcs_reference": "c3147b25d431917bb32a57db5c4feebb013dc7a7"
  },
  "budget": {
    "max_search_passes": 8,
    "max_candidate_inspections": 6,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "scripts/mutation-guards-config.test.ts",
      "description": "Enumeration guard holding Tests 1-7, findMutateTestPairingViolations, isPureReexportBarrel, sourceReachTransitive, findMutateEntriesWithoutSourceReach, treeOf and normalizePath.",
      "disposition": "insufficient",
      "insufficiency_reason": "walkNonTestTsFiles excludes *.test.ts files from the mutation universe, and this file is a testFiles entry, so mutation testing cannot reach guard logic hosted here."
    },
    {
      "path_or_symbol": "scripts/check-mutation-guards.ts",
      "description": "Verdict wrapper: classifyMutationReport, the reachedModulesTransitive import-closure walk, directSpecifiers, buildTriggerSet and evaluateTriggerGate.",
      "disposition": "insufficient",
      "insufficiency_reason": "mutation-guards.json lists it as not-mutated because a directive scanner cannot describe its own grammar, so hosting the strict reach guard here keeps it unmutated. Its reach walk is deliberately wide for the trigger gate, the opposite of what this guard needs."
    },
    {
      "path_or_symbol": "scripts/check-mutation-guards.test.ts",
      "description": "Behavior tests for the wrapper: verdict classes, trigger-gate precedence and real-config closure checks, using tmpdir fixtures.",
      "disposition": "insufficient",
      "insufficiency_reason": "It is a test file, which walkNonTestTsFiles excludes from mutate, so it cannot hold mutable guard logic."
    }
  ],
  "excluded_scopes": [
    {
      "scope": "packages/wiki-write-core/src",
      "reason": "Package sources publish to npm as @fro.bot/wiki-write-core, so test-only guard logic cannot live there. They are enumerated by the config test and hold no scripts gate-module enforcement. Not searched."
    },
    {
      "scope": ".github/workflows",
      "reason": "Relocating pure functions and config changes no job wiring or required-context registration. Not searched for an alternative enforcement home."
    }
  ]
}
```

## Key Technical Decisions

- **The traversal gets one enqueue-time guard.** It walks a growing array with `for...of` instead of an index or `shift()`, so no loop mutant can hang on `undefined`. It drops `visited`, the `undefined` check and the dead `existsSync`. The initial scan and the loop share one guard: skip when the target does not exist or is already reached. The barrel check stays where it is today, at the point a module is followed. This leaves only killable branches, and the reached set is unchanged.
- **The traversal takes an injected `exists`**, defaulting to `existsSync`, alongside the existing `readSource`. Tests run fully in memory. A strict reader that throws on the fourth read of any path turns lost dedup into a fast failure instead of a timeout. Correct code reads a file at most three times: the entry's initial scan, then one barrel probe and one specifier scan when the entry is re-reached through a cycle or self-import. Lost dedup follows a node twice, which takes it to four reads or more.
- **No disk fixtures.** `findMutateEntriesWithoutSourceReach` is tested with fake `reach` functions, and the traversal and barrel classification with in-memory readers. This removes the shared-sandbox sweep race and stranded fixture directories entirely.
- **The barrel regex is returned from a function.** The literal stays byte-identical, so no differential proof is needed. Its mutants get per-test coverage and run only against the barrel tests.
- **`normalizePath` and `treeOf` move and are exported.** The config test imports them for the pairing check. That leaves two copies (this one and the private `normalizeMutatePath`), not three, and puts the `./`-stripping mutants inside the mutated file.
- **The convention is a pattern, not a list entry.** `listScriptsGateFiles` gains `mutation-guards-*.ts`, which ratchets: any future file with that name must be dispositioned.
- **Test 2 splits.** Its strict half, and the premise that `wiki-write-core.test.ts` has no direct specifier to `private-leak.ts`, move to the reach test. The blindness half, `findMutateTestPairingViolations` returning `[]`, stays in the config test and duplicates the small `testFiles` filter. Test files never import each other.

## Open Questions

### Resolved During Planning

- Whether a `mutation-guards.json` entry is an option: no. Test 7 forbids a path appearing in both `mutate` and `not-mutated`.
- Whether the trigger set needs an edit: no. The `configEntries` union picks up the new pair.
- Whether the cycle fixture alone satisfies Fro Bot's AC5: no. It does once the traversal is restructured and the strict reader is in place.

### Deferred to Implementation

- Whether each guard mutant is scored Killed, rather than Timeout or Survived, in a real Stryker run. Confirm from the JSON `status` field.
- Whether the function-wrapped regex mutants report `static: false`, and the real job runtime.
- Whether `tsc` or ESLint objects to the defaulted `exists` parameter when the function is passed as a `reach` callback.

## Implementation Units

- [x] **U1: Reach module and its test**

**Goal:** Put the guard logic in a mutated module, with a test that kills every mutant.

**Requirements:** R1, R3, R4, R5

**Dependencies:** None

**Files:**
- Create: `scripts/mutation-guards-reach.ts`
- Create: `scripts/mutation-guards-reach.test.ts`
- Modify: `stryker.config.json` (`mutate` and `testFiles`)

**Approach:**
- The module holds `normalizePath`, `treeOf`, the barrel-pattern function, `isPureReexportBarrel`, `sourceReachTransitive` (restructured as described in Key Technical Decisions) and `findMutateEntriesWithoutSourceReach`, along with its own default source reader and repository root.
- It imports `SourceReader`, `isLiteralPath`, `stripComments` and `directSpecifiers` from `scripts/check-mutation-guards.ts`.
- It must load under Node strip-only mode and do nothing on import: no enums, no parameter properties, no top-level side effects.
- Fixture source text uses names such as `./fixture-barrel.ts` that never resolve to a real script. `stripComments` scans the test file's import-shaped text when the closure is computed.

**Patterns to follow:**
- The `findMutateTestPairingViolations (pure)` describe for fake `reach`.
- The `it.each(... () => source)` form from the docstring-test-table learning for barrel rows.

**Test scenarios:**
- Happy path: the real config, with the default reader and `exists`, yields zero violations.
- Happy path: the real config with `private-leak-adapter.test.ts` and `private-leak.test.ts` removed from `testFiles` flags `private-leak.ts`. A length check confirms the removal, and the premise check confirms `wiki-write-core.test.ts` has no direct specifier to `private-leak.ts`.
- Happy path, fake reach: a same-tree `scripts/` pair and a same-tree `packages/` pair each report nothing.
- Edge case, fake reach: a glob `testFiles` entry whose reach returns the mutate entry still reports a violation.
- Edge case, fake reach: mutate `docs/a.ts` with test `docs/a.test.ts`, reach returning `docs/a.ts`, reports `docs/a.ts`. This kills the undefined-tree skip.
- Edge case, fake reach: a `scripts/` test that reaches a `packages/` mutate entry reports a violation.
- Edge case, fake reach: a `./` prefix on the mutate entry, on the `testFiles` entry (reach keyed on the normalized name) and on the reached path. The output is exactly the normalized path.
- Edge case, fake reach: reach returns a path that is not in `mutate`, with two mutate entries.
- `treeOf` and `normalizePath` rows: `packages/x`, `scripts/x`, `./scripts/x`, `./packages/x`, `docs/x` and `''`.
- Traversal, in memory with the strict reader: a cycle `E→A→B→A`, a self-import, a diamond, duplicate initial specifiers, a missing target at depth 1, and a missing target at depth 2.
- Traversal: a barrel is marked reached but its targets are not, compared against a regular two-hop chain whose targets are all reached. A barrel whose target is itself a barrel.
- Barrel truth table: the six existing forms, plus these nine rows. Each expected value comes from the unchanged regex:
  - `export  type  *  as  NS  from  './a.ts'  ;`
  - `export  type  {a}  from  './a.ts'  ;`
  - `export  {a,\n b}  from  './a.ts'  ;`
  - `export  *  from  './a.ts'` with no trailing newline
  - `export * from './a.ts';` at end of file
  - `export * from './a.ts' ;`
  - `export type{a}from'./a.ts';`
  - `export {} from './a.ts'`
  - `export type* from './a.ts'`
- Compact forms such as `export *from'./a.ts'` and `export type{a}from'./a.ts';` are valid TypeScript, but the regex does not strip them, so a barrel written that way counts as direct reach. Their rows carry a comment marking them as a known fail-open, pinned and not endorsed. Prettier formatting makes these forms unlikely in this repo.
- Barrel negatives: a module's own function next to a re-export, a bare side-effect import, and trailing non-whitespace.

**Verification:**
- The new test passes under `pnpm test`.
- The closure walk from `scripts/mutation-guards-reach.test.ts` contains exactly the reach module and its intended imports, with no phantom fixture targets.

- [x] **U2: Trim the config test and extend the convention**

**Goal:** Remove the moved code from the enumeration guard and enumerate the new module by name.

**Requirements:** R2, R3, R5

**Dependencies:** U1

**Files:**
- Modify: `scripts/mutation-guards-config.test.ts`
- Modify: `.gitignore` (remove the `scripts/.mutation-guards-source-reach-*` pattern and the comment above it)

**Approach:**
- Delete the moved functions, the regex const, `defaultTestReadSource`, the barrel-exclusion describe and its `beforeAll` sweep. Remove imports that are no longer used.
- Delete the enumeration describe's real-config test titled "Test 3b: every mutate entry has at least one same-tree exerciser reached WITHOUT stepping through a barrel". It is not the barrel describe's control test, which shares the "Test 3b" label. The reach test's real-config check makes the same assertion, and Stryker credits that one.
- Import `normalizePath` and `treeOf` from the reach module.
- Add `/^mutation-guards-.+\.ts$/u` to `listScriptsGateFiles` and its docstring.
- Move Test 2's blindness half into a new test in the enumeration describe, duplicating the small `testFiles` filter and its length check. Update the docstrings that point at code that moved.

**Test scenarios:**
- Happy path: `listScriptsGateFiles` includes `scripts/mutation-guards-reach.ts` and excludes both `.test.ts` files.
- Happy path: with the same filtered `testFiles`, `findMutateTestPairingViolations` still returns `[]` (the blindness half).
- Integration: the existing Tests 1–7 pass with the new module in `mutate`.

**Verification:**
- `pnpm test` passes.
- Nothing writes under `scripts/` during the run.

- [x] **U3: Delete the twin dead line**

**Goal:** Remove the same dead `existsSync` check from `reachedModulesTransitive`.

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `scripts/check-mutation-guards.ts`

**Approach:**
- Delete the post-dequeue `existsSync` continue. Both push sites already filter on it.
- Update the `directSpecifiers` doc comment, which names the config test as the consumer that builds the stricter walk. Point it at `scripts/mutation-guards-reach.ts`.

**Test scenarios:**
- Test expectation: none. The line is unreachable, and the existing closure tests in `scripts/check-mutation-guards.test.ts` pin the behavior.

**Verification:**
- `scripts/check-mutation-guards.test.ts` passes unchanged.

- [x] **U4: Repoint the solutions doc**

**Goal:** Keep `check:solutions-examples` green and make the doc's example match the live table.

**Requirements:** R7

**Dependencies:** U1

**Files:**
- Modify: `docs/solutions/best-practices/a-docstring-that-enumerates-forms-is-a-test-table-2026-09-08.md`

**Approach:**
- Point the `verify:` marker and the "live table" prose at `scripts/mutation-guards-reach.ts` and its test.
- Correct the expected value in the `export {a} from "./x"` row to match the live truth table.

**Test scenarios:**
- Test expectation: none. This is a docs change enforced by `check:solutions-examples`.

**Verification:**
- `pnpm lint` passes.

## System-Wide Impact

- **Interaction graph:** `Check Mutation Guards`, a required context, now mutates one more module and runs one more test file. The trigger set grows through the existing union.
- **Unchanged invariants:**
  - The real-config verdict is still zero violations.
  - The pairing check and the trigger-gate closure keep their current reach semantics.
  - `check-mutation-guards.ts` stays `not-mutated`.
- **Integration coverage:** Only a live Stryker run proves R4 and R8. Unit tests cannot.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A guard mutant survives or times out | The strict reader turns lost dedup into a throw within a few steps. Fix the cause with a fixture or by deleting dead code. Never use a directive. |
| Job runtime nears the 20-minute cap | The function-wrapped regex keeps its mutants per-test. Measure the live runtime and record it in the PR. |
| Stryker silently skips the new test file | Confirm the file appears in the report's `testFiles` map. The wrapper's `TestFileNotExecuted` check fails the run if it is missing. |
| Import-shaped fixture text produces phantom closure targets | Use fixture names that never resolve to real files, and check the closure. |

## Documentation / Operational Notes

- The PR body quotes the live verdict and the per-module kill counts. Get them from the Stryker clear-text table, or from `reports/mutation/mutation.json` grouped by file and status.

## Sources & References

- Issue: #3835, including Fro Bot's acceptance criteria.
- Origin of the guard: #3834.
- Related plan: `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`.
