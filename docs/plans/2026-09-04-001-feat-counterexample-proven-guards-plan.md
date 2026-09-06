---
title: 'feat: Counterexample-proven guards via scoped mutation testing'
type: feat
status: active
date: 2026-09-04
origin: docs/brainstorms/2026-09-04-counterexample-proven-guards-requirements.md
deepened: 2026-09-04
---

# feat: Counterexample-proven guards via scoped mutation testing

## Overview

Add a required `Main` job that runs StrykerJS mutation testing over an enumerated set of gate modules and fails when any mutant survives. A surviving mutant is a check that can be removed without a test noticing — the vacuous-counterexample class that bit three times in two weeks. Exceptions are Stryker's line-scoped comment directives with a mandatory reason. The check runs only on pull requests that change what is mutated or how mutants execute, and is skipped (not left pending) everywhere else.

## Problem Frame

The repository's guards almost all have negative tests and several carry hand-written mutation proofs, but nothing verifies a negative test is load-bearing. Three guards this fortnight passed with their checks removed: a rewrite test whose fixture never reached the regex, two scaling guards that could not distinguish the vulnerable implementation from the fixed one, and a boundary test reading two of ninety-eight files. The only detector was a human asking "would this fail if I deleted the `if`?" (see origin: `docs/brainstorms/2026-09-04-counterexample-proven-guards-requirements.md`).

## Requirements Trace

- R1. A surviving mutant in a mutated module fails the check → Units 2, 3, 4
- R2. The mutated set is enumerated and limited to guard code → Units 2, 3
- R3. Timing guards are excluded from mutation and keep their meta-test → Unit 2
- R4. Per-mutant exceptions with a stated reason; no numeric threshold → Unit 2
- R5. Exceptions live in the repository and appear in the diff → Unit 2 (comment directives)
- R6. Exceptions are line-scoped; file- or region-wide suppression is rejected → Unit 2
- R7. Required status resolved by a job-level skip, never a workflow path filter → Units 4, 6
- R8. Runs when mutated modules, their tests, the mutation config, runner config, manifest, or lockfile change → Unit 4
- R9. Instrumentation failure, runner crash, and timeout fail closed with a distinct class → Unit 2
- R10. Each survivor reported with file, location, and mutation → Unit 2
- R11. Spike proves native-TS instrumentation before any wiring lands → Unit 1
- R12. Cleanup baseline before the check becomes required → Unit 5, then Unit 6

## Scope Boundaries

- Timing and complexity guards (`packages/wiki-write-core/src/regex-redos-regressions.test.ts`) are excluded from the mutation test set; the existing discrimination meta-test is unchanged.
- The mutated set is enumerated. No wholesale globbing of `scripts/**` or `packages/**`.
- A single exception mechanism: Stryker comment directives. No repository-owned ignorer plugin, no calendar expiry (see origin: Key Decisions).
- CI-topology fidelity for guards generally, and a guard registry, are separate ideas from the same ideation and are not folded in.

### Deferred to Separate Tasks

- `fro-bot/dashboard` `wiki-writer` guards: adopt the same shape once proven here — separate plan in that repository.
- Narrowing the manifest/lockfile trigger to dependency bumps that touch the mutation or test toolchain, if Renovate churn makes the cost material — future iteration after Unit 6 lands and cost is observed.
- A `docs/solutions/` learning capturing the vacuous-counterexample class and this remedy — write after Unit 6 via the compound workflow.

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/main.yaml` `check-wiki-authority`: required job gated by job-level `if: github.event_name == 'pull_request'` — the skip shape R7 reuses. Every job uses `./.github/actions/setup`.
- `scripts/check-private-leak.ts`: reads the pull request's changed-file set via `gh api repos/{owner}/{repo}/pulls/{n}/files --paginate` — the changed-file pattern Unit 4 reuses. No workflow in this repository uses a path-filter action.
- `scripts/build-wiki-write-core.ts` `--check` and the `Check Wiki Write Core Dist` job: a `scripts/check-*.ts` wrapper that runs a tool, classifies its outcome, exits non-zero with a locatable message, and is registered as a required context — the wrapper shape Unit 2 mirrors.
- `.github/settings.yml` `required_status_checks.contexts`: the registration surface for Unit 6. Context strings must match job `name:` byte-for-byte.
- Existing hand-written mutation proofs stay: `scripts/wiki-lockfile-gates.test.ts` (`MUTATION-PROOF: a tampered lock with one entry removed fails coverage`), `scripts/wiki-context-safety.test.ts` (`… — mutation gate proof (body)`), `scripts/build-wiki-write-core.test.ts`, `packages/wiki-write-core/src/regex-redos-regressions.test.ts` (`proves the scaling helper discriminates quadratic work`).
- Import boundary: `scripts/*.ts` import the shared package by name (`@fro-bot/wiki-write-core/...`), which resolves to committed `packages/wiki-write-core/dist/`. Package tests import `./module.ts` relatively. A mutant in `packages/wiki-write-core/src/` is visible only to tests in the same tree.
- `vitest.config.ts`: includes `scripts/**/*.test.ts` and `packages/**/*.test.ts`, 10-second default timeout, no aliases.
- `Test Scripts Load` job: imports every non-test `scripts/*.ts` under Node's strip-only loader; any new script must load without transpilation.
- `.gitignore`: already ignores `coverage`, `.vitest-cache`, `dist` (with the `packages/wiki-write-core/dist/` exception).
- Renovate (`.github/renovate.json5`): patch updates disabled except `python`/`typescript`; devDependencies pinned exact.

### Institutional Learnings

- `docs/solutions/workflow-issues/quoted-required-status-check-context-2026-06-09.md` — context strings must be identical across workflow, `settings.yml`, and docs; a mismatch leaves branch protection waiting on a ghost.
- `docs/solutions/best-practices/verify-in-the-ci-topology-not-just-locally-2026-07-11.md` — environment-sensitive claims (native-TS instrumentation, sandbox symlinks) must be verified in the workflow, not on a laptop.
- `docs/solutions/best-practices/make-failure-boundaries-and-shared-predicates-explicit-2026-08-25.md` — name failure states before side effects; "failed to instrument" is not "mutant survived".
- `docs/solutions/best-practices/status-vocabulary-must-cover-every-report-surface-2026-08-31.md` — the closed vocabulary must reach the step summary, the exit message, and the tests together.
- `docs/solutions/best-practices/calibrate-classifiers-on-adjudicated-ground-truth-2026-07-11.md` — tightening a gate exposes fixtures that passed for the wrong reason; keep the cleanup baseline separate from enforcement.
- `docs/solutions/workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md` — a devDependency claim is advisory until the CI path installs and exercises it.
- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md` — gates are pure cores behind thin CLI wrappers; mutate the core, not the shell.

### External References

- StrykerJS configuration: `mutate` globs with `!` exclusion, `testRunner: "vitest"`, `vitest.related` (default true), `testFiles`; the Vitest runner forces `coverageAnalysis: perTest`. https://stryker-mutator.io/docs/stryker-js/configuration/ and `/vitest-runner/`
- Disabling mutants: `// Stryker disable next-line <Mutator>[: reason]`; reason is optional natively and, when present, is recorded in the report. `disable all` / `restore` are region directives. https://stryker-mutator.io/docs/stryker-js/disable-mutants/
- Exit codes do not distinguish threshold failure, dry-run failure, and runner crash; the JSON report carries per-mutant `status` (`Killed`, `Survived`, `Timeout`, `Ignored`, `RuntimeError`, `CompileError`), `statusReason`, `location`, `mutatorName`. `thresholds.break: null` disables the numeric gate.
- `@stryker-mutator/typescript-checker` is optional; Stryker mutates TypeScript via Babel and re-emits source. Compatibility with Node's strip-only loader is undocumented — the spike's purpose.
- Stryker 10.0.0 (2026-08-14); Vitest 4 supported since 9.4.0; Node ≥ 22. Open upstream issues: #5928 (Vitest 4 coverage), #5459 (fixtures).

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "build-new-within-scope",
  "scope": "scripts + packages/wiki-write-core",
  "freshness": {
    "vcs_reference": "3443d38"
  },
  "budget": {
    "max_search_passes": 2,
    "max_candidate_inspections": 6,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "packages/wiki-write-core/src/regex-redos-regressions.test.ts",
      "description": "scaling meta-test that proves the helper discriminates quadratic work",
      "disposition": "insufficient",
      "insufficiency_reason": "detects complexity regressions, not a deliberately injected surviving mutant in a named gate module"
    },
    {
      "path_or_symbol": "scripts/build-wiki-write-core.test.ts",
      "description": "build-input and invalid-TS rejection tests for committed dist generation",
      "disposition": "insufficient",
      "insufficiency_reason": "verifies build invariants, not test-suite mutation survival"
    },
    {
      "path_or_symbol": "scripts/wiki-context-safety.test.ts",
      "description": "field-by-field private-token gate with mutation-proof cases",
      "disposition": "insufficient",
      "insufficiency_reason": "hand-written negative tests; no framework mutates the module and fails CI when tests stay green"
    },
    {
      "path_or_symbol": "scripts/wiki-lockfile-gates.test.ts",
      "description": "lockfile coverage and integrity rejection tests with a tampered-lock proof",
      "disposition": "insufficient",
      "insufficiency_reason": "proves specific examples, not a CI check that reports surviving mutants"
    }
  ]
}
```

## Key Technical Decisions

- **Same-tree test pairing.** Each mutated module runs only against tests in its own tree: `packages/wiki-write-core/src/*.test.ts` for package modules, `scripts/*.test.ts` for script modules. Scripts reach the package through committed `dist/`, so a package mutant is invisible to scripts tests; pairing across the boundary would report green while blind. A Vitest alias from the package name to `src/` was considered and rejected — it would change what every test exercises, not just the mutation run.
- **Wrapper classifies the JSON report; the exit code is not trusted.** `scripts/check-mutation-guards.ts` runs Stryker with `thresholds.break: null` and `reporters: ["json", "clear-text"]`, then derives one verdict from the closed set in the design table below. Only `clean` and `not-applicable` exit zero. `NoCoverage` — guard code no test reaches — is its own failing verdict, because an unreached rejection branch is the vacuity this check exists to find, and Stryker reports it separately from `Survived`. Tool failure and policy breach are separate verdicts (`instrumentation-failed`, `directive-violation`) so an operator can tell "the tool broke" from "a rule was violated" without reading logs; the repository's `scan_result: success|detection|error` and `verified-clean / could-not-check` conventions make the same distinction.
- **Comment directives are the only exception mechanism; the wrapper enforces what Stryker leaves optional.** Every `Ignored` mutant in the report must carry a non-empty `statusReason`; every `Stryker disable` in a mutated module must be `next-line` scoped. A bare `Stryker disable all` or region form fails the check. Enforcing from the report uses Stryker's own parser for reasons; the region ban is a conservative textual rule where a false positive fails loudly (see origin: Key Decisions).
- **Enumeration guarded by a shape test, not by memory.** A colocated test asserts two exhaustiveness rules: every non-test file under `packages/wiki-write-core/src/` appears in `mutate` or in a `not-mutated` list with a reason; every `scripts/` file matching `check-*.ts`, `wiki-*-gates.ts`, `wiki-context-safety.ts`, or `build-wiki-write-core.ts` does likewise. Path exhaustiveness for the package and name patterns for scripts replace the export-name heuristic from the first draft, which false-negatives on `runCheck` (`check-repo-onboarded.ts`) and false-positives on validators like `assertCorrectionsFile`. A new guard file that matches neither list fails `pnpm test` before it can bypass the check.
- **Cores are the target; shells are covered or listed.** Every candidate script already exports its decision logic (`checkWikiAuthority`, `runCheck`, and `checkPrivateLeak` from the package) behind a thin `main()`. Mutants in `main()` will report `NoCoverage` unless the assembled flow is tested. Unit 5 resolves each such file one of two ways, in order of preference: cover `main()` through the injected-seam pattern the repository already uses for assembled-flow tests, or list the file `not-mutated` naming the module that carries its core. Line-by-line directives over a shell are not an option — that is region suppression by another name (R6).
- **Changed-file detection reuses the pull-request files API.** The job always runs on `pull_request`; its first step fetches the changed paths the way `scripts/check-private-leak.ts` does and exits zero with a "not applicable" summary when none match the trigger set. `push` and `workflow_dispatch` are skipped by job-level `if`. No path-filter action is introduced.
- **Timing guards excluded by test file, not by module.** `regex-redos-regressions.test.ts` is omitted from `testFiles` so no mutant can trip a timing bound; the modules it exercises remain mutated against their correctness tests.
- **Spike targets a package core module.** `packages/wiki-write-core/src/corrections-survival.ts` is pure logic with colocated tests and no I/O, so the spike isolates the one unknown — does Stryker's re-emitted TypeScript load under Node's strip-only loader — from everything else.
- **Renovate pull requests run the check.** Manifest and lockfile changes are in the trigger set because a bump of the mutation or test toolchain is precisely a change that can blind the check. The cost is single-digit minutes per Renovate pull request; narrowing is deferred until observed.

## Open Questions

### Resolved During Planning

- Exception mechanism: line-scoped comment directive with enforced reason; content-bound ignorer rejected (see origin: Key Decisions).
- Where the changed-file set comes from: the pull-request files API, reused from `scripts/check-private-leak.ts`.
- Which package module the spike uses: `corrections-survival.ts`.
- Candidate list corrections: the origin doc's `privacy.ts` does not exist (the core is `private-leak.ts`); `gate-contract.ts` is constants and is not a rejection surface — excluded with a reason in the `not-mutated` list.
- Importable cores: `check-wiki-authority.ts` exports `checkWikiAuthority`, `check-repo-onboarded.ts` exports `runCheck`, `check-private-leak.ts` delegates to the package's `checkPrivateLeak`; all three stay in `mutate`.
- Changed-file listing: `fetchChangedFiles` and `readPullRequestContext` are already exported from `scripts/check-private-leak.ts`; Unit 4 imports them rather than extracting a helper module.
- Enumeration criterion: path exhaustiveness for the package plus name patterns for scripts; the export-name heuristic was rejected after it false-negatived on `runCheck` and false-positived on `assertCorrectionsFile`.
- Unit 3 disposition, `scripts/check-mutation-guards.ts`: `not-mutated`. A directive scanner cannot describe its own grammar in comments without matching it; the classifier and scanner are covered by their fixture tests, not by mutation.
- Unit 3 disposition, `packages/wiki-write-core/src/wiki-write-core.test.ts`: stays in `testFiles` without a 1:1 `mutate` filename partner. It imports `./index.ts` relatively and reaches `private-leak.ts` and `corrections-survival.ts` through the barrel, so it is a real same-tree test of listed modules; Unit 3's pairing check must accept a same-tree test that covers a listed module via relative import, not require 1:1 filename pairing.

### Deferred to Implementation

- Exact `mutate`/`testFiles` globs. The spike settled the shape: `related` over-selects because `regex-redos-regressions.test.ts` imports `wiki-ingest.ts`, which directly imports `corrections-survival.ts` — a real import edge, not a barrel artifact, so no barrel restructuring fixes it. `testFiles` is an explicit same-tree list and `vitest.related` is set `false`.
- Whether each script's `main()` is covered by an assembled-flow test today or reports `NoCoverage` on the first full run; decided by the run itself in Unit 5, with the two allowed resolutions named there.
- Runtime budget for the `Main` job: the ten-module set measured **5m29s** on the hosted runner (≈2.7× local, in line with the 2.2× estimate). That is the wall-clock cost added to every pull request that hits the R8 trigger set; Unit 4's `timeout-minutes` and the trigger-set breadth are decided against that number, not an extrapolation.
- Stryker `timeoutMS` and `dryRunTimeoutMinutes` values. The spike saw 5 timeouts in 183 mutants at default settings on one module (58.47% score = (102 killed + 5 timeout) / 183 — Stryker's default score counts `Timeout` as detected). The wrapper's closed vocabulary already refuses that conflation: `mutant-timeout` is its own failing verdict, never counted as killed. Local runs are roughly 2.2× faster than the hosted runner; the calibration input is the post-fix CI figure recorded in Unit 1's result (19 s Stryker / 20.9 s wall), with headroom, never a local number — otherwise a slow-but-terminating mutant on a loaded runner reclassifies as `Timeout` and the guard grades itself higher under load.
- Whether incremental mode (`--incremental`) is worth enabling on pull requests; content-based reuse is safe, but Vitest reports test locations per file, so gains may be small.
- Whether a mutant that flips the `import.meta.main` guard in `scripts/build-wiki-write-core.ts` runs a build inside the Stryker sandbox; if so, that line gets a directive with reason.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
  PR[pull_request] --> J{job if: event == pull_request}
  J -- push / dispatch --> SKIP[skipped → required context satisfied]
  J -- yes --> CF[fetch changed files via pulls/files API]
  CF -- none in trigger set --> NA[exit 0: not-applicable]
  CF -- match --> W[scripts/check-mutation-guards.ts]
  W --> S[stryker run → reports/mutation/mutation.json]
  S --> C{classify report}
  C -- all Killed/Ignored-with-reason --> OK[clean → exit 0]
  C -- any Survived --> SV[mutants-survived: file:line:mutator list → exit 1]
  C -- any Timeout --> TO[mutant-timeout → exit 1]
  C -- any NoCoverage --> UC[mutants-uncovered → exit 1]
  C -- dry-run failed / RuntimeError / CompileError / missing report --> IF[instrumentation-failed → exit 1]
  W --> D[directive scan: reason non-empty, next-line only]
  D -- violation --> DV[directive-violation → exit 1]
```

Verdict vocabulary (closed set, rendered identically in the exit message, the step summary, and the tests; precedence top to bottom when several apply):

| verdict | meaning | exit |
|---|---|---|
| `instrumentation-failed` | report missing or unreadable, dry run failed, any `RuntimeError`/`CompileError` mutant | 1 |
| `directive-violation` | a `Stryker disable` without `next-line` scope or without a reason; an `Ignored` mutant with empty `statusReason` | 1 |
| `mutant-timeout` | at least one mutant timed out (not counted as killed) | 1 |
| `mutants-uncovered` | at least one mutant has `NoCoverage` — no test reaches that guard code | 1 |
| `mutants-survived` | at least one mutant survived a test that reached it | 1 |
| `clean` | every mutant killed, or ignored with a reason | 0 |
| `not-applicable` | no trigger-set file changed | 0 |

The mermaid sketch above collapses the four failing report classes into two nodes for readability; the table is authoritative.

## Implementation Units

- [x] **Unit 1: Spike — instrument one package module under native TypeScript**

**Result:** the assumption holds. 183 mutants over `corrections-survival.ts`: 102 killed, 61 survived, 15 uncovered, 5 timeout, zero `RuntimeError`/`CompileError` — Node's strip-only loader accepted every re-emitted variant. Discrimination proven both directions at `corrections-survival.ts:60:29 ObjectLiteral`. Runtime 8–14 s for one module. Three findings feed Unit 2: (1) `plugins: ["@stryker-mutator/vitest-runner"]` must be explicit — the default plugin glob does not resolve under pnpm's layout; (2) `vitest.related` selected four test files including `regex-redos-regressions.test.ts` — not through any `index.ts` barrel, but because `regex-redos-regressions.test.ts` imports `wiki-ingest.ts`, which imports `corrections-survival.ts` directly, so Vitest's related-file analysis correctly (and unhelpfully) follows that direct edge; no barrel restructuring can break this coupling, so `testFiles` must be explicit and `vitest.related` set `false` for same-tree pairing; (3) a source-introspecting test asserted a byte-exact import line and failed under instrumentation because the generator re-emits `import { x } from '...';` — fixed with a whitespace-tolerant match, and any future test that reads its subject's source must tolerate generator formatting. CI-observed figures (hosted runner), identical mutant counts to local in every run (102 killed, 5 timeout, 61 survived, 15 uncovered, 0 errors): 26 s wall clock before `testFiles` was set; **19 s by Stryker's accounting, 20.9 s wall clock after** — this post-fix CI number is the calibration input for Unit 2. Local after the same fix: the dry run selects exactly one test file (`corrections-survival.test.ts`, 29 tests), ~8–9.7 s wall clock. The local/CI ratio is roughly 2.2× in both conditions.

**Goal:** Prove Stryker 10 with the Vitest runner can mutate a strip-only TypeScript module, load the mutated source under Node 24, run its colocated tests, and kill mutants — in the CI topology, not only locally. Measure runtime.

**Requirements:** R11

**Dependencies:** None. Operator approval for the devDependency and lockfile change.

**Files (as shipped):**
- Modify: `package.json` (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, exact pins), `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`qs: '>=6.15.2'` override for GHSA-q8mj-m7cp-5q26, reached only through Stryker's `typed-rest-client`)
- Create: `stryker.config.json` (spike scope: `mutate` = `corrections-survival.ts`, explicit `testFiles`, `vitest.related: false`, explicit `plugins`, `thresholds.break: null`, `reporters: ["json","clear-text"]`, `tempDirName: ".stryker-tmp"`, `allowConsoleColors: false`)
- Modify: `.gitignore` (`/.stryker-tmp/`, `/reports/` — root-anchored), `vitest.config.ts` (`test.exclude` spreads `defaultExclude` — the option replaces Vitest's defaults — plus coverage excludes), `eslint.config.ts` ignores, `.github/codeql/codeql-config.yml` `paths-ignore`
- Modify: `packages/wiki-write-core/src/corrections-survival.test.ts` (whitespace-tolerant source-introspection assertion)
- Create: `.github/workflows/mutation-spike.yaml` (temporary; `pull_request` on its own dependency paths plus `workflow_dispatch`, since dispatch resolves workflow files from the default branch; concurrency group as `main.yaml`; deleted in Unit 4 when the real job lands)

**Approach:**
- Install and run Stryker against the single module locally first; record whether the dry run passes and how many mutants are killed, survived, no-coverage, compile-error, runtime-error.
- Run the same config from the temporary workflow so the sandbox, symlinked `node_modules`, and Node version match `Main`.
- Deliberately plant a vacuous test: disable one assertion so a known mutant survives, run again, confirm it reports `Survived` at the expected location. Restore.
- Record: runtime for the one module, mutant count, any operators producing output the loader rejects, whether `vitest.related` selected the right test file.
- If mutated output fails to load under the strip-only loader for any operator, stop and report before Unit 2 — the design assumption is false and the plan needs revising, not patching.

**Patterns to follow:**
- `.github/workflows/main.yaml` job shape (checkout → `./.github/actions/setup` → run).
- `docs/solutions/best-practices/verify-in-the-ci-topology-not-just-locally-2026-07-11.md`.

**Test scenarios:**
- Happy path: Stryker dry run passes; the colocated test kills mutants; JSON report written with per-mutant `status` and `location`.
- Integration: the same run succeeds inside the workflow with `node_modules` symlinked into the sandbox.
- Discrimination: with one assertion disabled, at least one mutant reports `Survived` at the expected line; with it restored, that mutant is `Killed`.
- Error path: an operator whose output the loader rejects surfaces as `RuntimeError`/`CompileError` in the report, not as a silent kill.

**Verification:**
- The spike PR description records mutant counts, runtime, and the discrimination result; the plan's Deferred-to-Implementation items about globs and timeouts are answered there.
- `pnpm test`, `pnpm lint`, `pnpm check-types`, and `Test Scripts Load` still pass with the new devDependencies installed.

- [x] **Unit 2: Wrapper script with closed verdict vocabulary and directive rules**

**Result:** 89 classifier and directive tests on fixture reports (grown across several post-review fixes to the directive scanner (including multi-directive-per-line evaluation), exit-code contract, empty-report handling, missing-mutate-file detection matching minimatch's grammar, report-path injection, a report-key cross-check against the `mutate` list, a per-file all-Ignored check, a reporter/report-path config cross-check routed through its own injectable seam with a validated `reporters` shape and config-relative path resolution, and a named unreadable-report sentinel); three discrimination proofs (precedence, empty-reason, `next-line`) each went red with the rule removed — and the third exposed a fixture that passed for the wrong reason, now replaced. `timeoutMS: 30000` derived from Unit 1's CI figure (5 s default × 2.2 runner ratio, doubled for a cold runner); `dryRunTimeoutMinutes` widened from 5 to 8 for more headroom against a ~3 min extrapolation. Most recent live run over ten modules, with every fail-closed check now active: **`mutant-timeout`** — 2514 total mutants (1265 killed, 777 survived, 465 uncovered, 7 timeout, 0 errors), 1m41s–2m5s local across two runs; none of the config-integrity checks (empty report, missing literal entry, absent-from-report key, all-Ignored file, reporter mismatch) fired — the real config is well-formed. Heaviest: `check-private-leak.ts` 239 survived/81 uncovered, `corrections.ts` 171/109, `build-wiki-write-core.ts` 100/57. Confirmed the all-Ignored check fires correctly: a scratch, never-committed config that set `mutator.excludedMutations` broadly for `wiki-context-safety.ts` alone produced a report where all 45 mutants were `Ignored`, and `classifyMutationReport` returned `instrumentation-failed` naming that file and "all 45 mutants ignored". That survivor/uncovered baseline is Unit 5's.

**Goal:** A `scripts/check-*.ts`-style wrapper that runs Stryker over the configured set, classifies the JSON report into the closed verdict set, enforces directive rules, and prints locatable survivors.

**Requirements:** R1, R3, R4, R5, R6, R9, R10

**Dependencies:** Unit 1 (spike results calibrate timeouts and globs).

**Files:**
- Create: `scripts/check-mutation-guards.ts`
- Create: `scripts/check-mutation-guards.test.ts`
- Modify: `stryker.config.json` (full enumerated `mutate` and `testFiles`; `regex-redos-regressions.test.ts` excluded from `testFiles`; timeouts from the spike)
- Modify: `package.json` (`check:mutation-guards` script)

**Approach:**
- Separate the pure classifier (report JSON in → verdict + located mutant list out) from the runner (spawns Stryker, reads the report file) so the classifier is unit-testable with fixture reports and is itself a candidate for the mutated set later.
- Classify by the precedence table in the design section: `instrumentation-failed` → `directive-violation` → `mutant-timeout` → `mutants-uncovered` → `mutants-survived` → `clean`. Every failing verdict lists every mutant in every failing class, not only the class that won precedence, so one run gives the whole picture.
- Directive scan over the `mutate` file set: every line containing `Stryker disable` must contain `next-line` and a `: ` followed by non-whitespace; anything else → `directive-violation` naming file and line. Conservative by design — a false positive fails loudly.
- The script must be inert on import: all execution sits behind an `import.meta.main` guard, exactly as `scripts/build-wiki-write-core.ts` does, because `Test Scripts Load` imports every non-test `scripts/*.ts`. An import-time Stryker spawn would make that job either run the mutation suite or fail.
- Output: one line per survivor `path:line:col mutatorName` plus the verdict as the last line, and the same content into `GITHUB_STEP_SUMMARY` when set (reuse the summary pattern from `scripts/check-private-leak.ts`).
- Never read the exit code for classification; use it only to detect "Stryker did not run at all".
- Set `timeoutMS`/`dryRunTimeoutMinutes` from the CI-observed runtime with headroom, not the local one — the spike's local runtime ran ~2× faster than the hosted runner, and Stryker's default score already counts `Timeout` as detected, so a tight local-derived timeout would silently reclassify slow-but-terminating mutants as `mutant-timeout` under CI load. The wrapper's closed vocabulary keeps `mutant-timeout` a distinct failing verdict, never counted as killed, so this conflation cannot leak into `clean`.

**Patterns to follow:**
- `scripts/build-wiki-write-core.ts` for the wrapper/`--check` shape and message style.
- `scripts/check-private-leak.ts` for step-summary writing and the `scan_result`-style structured outcome.
- `docs/solutions/best-practices/make-failure-boundaries-and-shared-predicates-explicit-2026-08-25.md`.

**Test scenarios:**
- Happy path: fixture report with all `Killed` → `clean`, exit 0.
- Happy path: fixture with `Ignored` + non-empty `statusReason` → `clean`.
- Error path: one `Survived` → `mutants-survived`, output includes `file:line:col mutator` for it.
- Error path: one `NoCoverage` → `mutants-uncovered`, located the same way.
- Error path: one `Timeout` → `mutant-timeout`.
- Error path: `RuntimeError` or `CompileError` present → `instrumentation-failed`.
- Error path: report file missing or malformed JSON → `instrumentation-failed`, never `clean`.
- Error path: `Ignored` with empty `statusReason` → `directive-violation` naming the mutant.
- Edge case: a report with both a `Timeout` and a `Survived` reports `mutant-timeout` as the verdict and lists both mutants.
- Edge case: directive `// Stryker disable next-line ConditionalExpression: reason` passes; `// Stryker disable all`, `// Stryker disable next-line X` (no reason), `// Stryker disable next-line X:` (empty reason) each → `directive-violation` with file and line.
- Edge case: importing the module in a test spawns nothing and produces no output (the `import.meta.main` guard).
- Edge case: a directive inside a string literal or a non-mutated file is not scanned (scan is limited to the `mutate` set).
- Integration: running the wrapper end to end against the spike module produces the same verdict as classifying its report by hand.

**Verification:**
- `pnpm check:mutation-guards` prints a verdict from the closed set as its last line and exits non-zero for every verdict except `clean`/`not-applicable`.
- Every scenario above has a test; the classifier's tests use fixture JSON, not live Stryker runs.
- `Test Scripts Load` imports the new script without error and without side effects.

- [x] **Unit 3: Enumeration guard and same-tree pairing test**

**Result:** `mutation-guards.json` created at repo root holding `not-mutated: [{path, reason}]`; `scripts/mutation-guards-config.test.ts` created with the five tests. `stryker.config.json`'s `mutate` grew from 10 to 12 entries and `testFiles` from 10 to 12, after reading every module the initial disposition deferred and, for three of them, correcting course against a live `check:mutation-guards` run. Two `scripts/check-*.ts` files the origin research missed — `check-md-links.ts` and `check-wiki-private-presence.ts` — read as genuine gates structurally identical to the already-mutated `check-private-leak.ts` (classification logic + `main()` with `exitCode`), promoted to `mutate` with their existing same-tree tests (`check-md-links.test.ts`, `check-wiki-private-presence.test.ts`) added to `testFiles`. `packages/wiki-write-core/src/schemas.ts`, `wiki-ingest.ts`, and `wiki-slug.ts` each have a real throw/reject path (`assertReposFile`, `WikiIngestError`, `computeRepoSlug`) consumed by an already-mutated gate, and were initially promoted to `mutate` on that basis — but a live `check:mutation-guards` run caught the mistake: each module's *real* test lives in `scripts/` (`scripts/wiki-ingest.test.ts`, `scripts/wiki-slug.test.ts`, `scripts/schemas.test.ts`) and reaches the package source only through the built `dist/` output, via a `scripts/<x>.ts` re-export shell (`export * from '@fro-bot/wiki-write-core/<x>'`) — the exact wiki-lint.ts situation, not "already same-tree covered." Same-tree pairing therefore measured blind: the run showed `wiki-ingest.ts` at 1474/1474 `NoCoverage`, and instrumenting it alongside the others corrupted coverage attribution for the *entire* run — `corrections.ts` (553/553 `NoCoverage`) and `corrections-survival.ts` (183/183 `NoCoverage`) lost all coverage despite their dedicated same-tree tests being unchanged. Reverting the three promotions and re-running restored `corrections.ts` to 273 killed/171 survived/109 uncovered and `corrections-survival.ts` to 102 killed/61 survived/15 uncovered/5 timeout — exact matches to Unit 1/2's baseline — confirming the cause and the fix empirically rather than by inspection alone. All three now sit in `not-mutated` with the pending-relocation reason (naming their rejection path so Unit 5 knows to flip them to `mutate` after moving their tests beside the module, same pattern as `wiki-lint.ts`). Final disposition: 9 `not-mutated`-with-reason/pending-relocation package modules (`frontmatter.ts`, `rendering-policy.ts`, `wiki-utils.ts`, `markdown-links.ts`, `correction-text.ts`, `data-branch-bootstrap.ts`, `gate-contract.ts`, `wiki-lint.ts`, plus `index.ts` as a pure barrel) — 12 package `not-mutated` entries total once `wiki-ingest.ts`/`wiki-slug.ts`/`schemas.ts` are counted; 1 scripts `not-mutated` entry (`check-mutation-guards.ts`, per its Unit 2 disposition). `readStrykerConfig`, `isLiteralPath`, and `MINIMATCH_METACHARACTER_PATTERN` exported from `scripts/check-mutation-guards.ts` for reuse (previously module-private); `readStrykerConfig` extended to also parse and return `testFiles` (previously omitted, needed for Tests 3 and 4). All five discrimination proofs ran red before the corresponding fix and green after, with every temp edit reverted before landing. Final live `check:mutation-guards` run (12 `mutate` files, 2907 mutants, 1m45s wall clock): every `mutate` file shows non-zero `Killed`; totals match Unit 2's 2514-mutant baseline plus the two new scripts files' 393 mutants exactly. Gate: `pnpm check-types`, `pnpm lint`, and `pnpm test` (73 files, 2940 tests, 3 todo) all pass; `node -e "import('./scripts/check-mutation-guards.ts')"` remains inert. Root-caused the corrections.ts/corrections-survival.ts coverage loss (not just correlated it): `wiki-ingest.ts`'s Regex mutator produces a syntactically invalid mutant (`\v` → `\V` in a character class at line 706), and because Stryker embeds every regex-literal mutant as a literal alternative in a ternary chain, that one invalid variant fails to parse at load time — independent of which mutant is active — and Vite's shared dependency scan zeroes test collection for every file in the run, not only ones that import the broken module. Confirmed by a minimal scratch repro (`mutate: [corrections.ts, wiki-ingest.ts]`, `testFiles: [corrections.test.ts]`): 0 tests collected; a temporary `// Stryker disable next-line Regex` directive on that line restored normal collection (15 tests), then reverted (production `wiki-ingest.ts` is unchanged and matches HEAD). Recorded in the Risks table with the observable signature (`ConfigError`, no report file — already correctly mapped to `instrumentation-failed` by the wrapper, no wrapper change needed) and the concrete precondition for Unit 5 flipping `wiki-ingest.ts` to `mutate`: add that directive first.

**Addendum (post-landing correction):** the `ConfigError`/no-report signature above is only the scoped-repro shape (`mutate: [corrections.ts, wiki-ingest.ts]`, `testFiles: [corrections.test.ts]`) and was the only shape reproduced at the time this unit landed. A full-scale run — the real 12-entry `mutate`/`testFiles` config plus `wiki-ingest.ts`, every other entry unchanged — does not throw `ConfigError` and does write a complete, well-formed report (5130 mutants): the three test files whose sole coverage import reached `wiki-ingest.ts` (`corrections.test.ts`, `corrections-survival.test.ts`, `wiki-write-core.test.ts`) are silently dropped from dry-run collection while every other configured test file, including the `scripts/` ones, still loads — `--logLevel debug` shows the dry run reporting success at 316 tests collected with nothing naming the drop, and the report's top-level `testFiles` map simply omits the three dropped keys rather than listing them with zero tests. `corrections.ts` reads 553/553 `NoCoverage` and `corrections-survival.ts` 183/183 `NoCoverage` — the wrapper classified this as `mutants-uncovered`, not `instrumentation-failed`, because a report was written and Unit 2's report-missing rule never fires. This was a genuine fail-open the "no wrapper change is needed" conclusion above missed. Closed by adding a `configuredTestFiles` fail-closed check to `classifyMutationReport`: every configured `vitest.testFiles` entry (literal, non-glob), normalized like `mutate` entries, must appear in the report's `testFiles` map with at least one test, or the run fails closed with `instrumentation-failed` and a new `TestFileNotExecuted` sentinel naming the dropped file. Proven red-then-green against `scripts/check-mutation-guards.test.ts`, then reproduced end to end through the real wrapper machinery (`runMutationGuardCheck`'s classification path) against the full-run repro report: verdict now correctly reads `instrumentation-failed`, naming all three dropped test files, where it previously read `mutants-uncovered`. Gate wrapper test count grew from 89 to 94 with this fix (six new discrimination/behavior tests for `TestFileNotExecuted`, including the "skip check on empty `configuredTestFiles`" default-safety case and the "no double-report when the report itself is unreadable" precedence case).

**Second addendum (two more gaps closed in the same follow-up pass):**

1. **`extractReportTestFileCounts` conflated two distinct failure modes.** It returned `undefined` both for a genuinely unreadable report and for a readable, well-formed report that simply had no top-level `testFiles` map — the caller skipped the `TestFileNotExecuted` check in both cases, but only the first is already covered by `reportUnreadable`. A readable report missing its `testFiles` map is a *more* severe gap (nothing about any configured test file can be verified at all), not a reason to skip verification. Closed with a new `hasTestFilesMapMissing` check, gated on `configuredTestFiles.length > 0` and `flat !== undefined` (readable), producing a `TestFilesMapMissing` sentinel naming how many configured test files could not be verified. Discrimination: `{schemaVersion:'2.0', files:{'a.ts':{mutants:[]}}}` (readable, well-formed, no `testFiles` key) with two configured test files read `clean` under the prior code and `instrumentation-failed` under the fix — proven red→green in `scripts/check-mutation-guards.test.ts`.

2. **`mutation-guards-config.test.ts`'s Test 3 was blind to zero-coverage `mutate` entries.** The original `findCrossTreePairingViolations` only flagged a `testFiles` entry that reached a `mutate` entry in the *other* tree — a `mutate` entry reached by *no* same-tree test at all produced nothing to flag as "crossing", so it silently passed. Concretely: `scripts/wiki-slug.ts` is a `dist/`-shell re-export (`export * from '@fro-bot/wiki-write-core/wiki-slug'`) — a *package* specifier, invisible to any relative-import scanner — so a scripts-side test reaching only that shell gave zero same-tree signal for the package module it re-exports, and the old Test 3 had nothing to say about it. Renamed and inverted: `findMutateTestPairingViolations` now requires every `mutate` entry to be reached by at least one same-tree `testFiles` entry (via the new `reachedModulesTransitive`, which also follows `export * from`/`export {...} from` barrel chains transitively, resolves dynamic `import('...')`/`import(\`...\`)` (including a literal-only `${'...'}`  interpolation and the `.js`/`.mjs`/`.cjs` → `.ts` extension rewrite), and supports multi-level `../` specifiers — none of which the original one-level, static-only `reachedModules` handled), in addition to keeping the original cross-tree check. Discrimination proven three ways: (a) the wiki-slug shape (fake `mutate`/`testFiles`/`reach`) — zero violations under the old function, one under the new, red pasted in the session transcript; (b) Fro Bot's live counterexample, `scripts/wiki-context-safety.ts`/`scripts/wiki-context-safety.test.ts`, which reaches its module *only* through `import(\`./wiki-context-safety${'.js'}\`)` with no static import anywhere in the test file — run against the real files with the real `reachedModulesTransitive`, this reports zero violations, proving the new dynamic-import/template-literal resolution actually works, not just against a fake `reach`; (c) a zero-reach entry and a cross-tree entry each still produce their expected violation. Test 3 itself, run against the real `stryker.config.json`, passes: every one of the 12 real `mutate` entries is reached by a same-tree test under the new extractor.

Also landed as non-blocking hardening in the same pass: `walkNonTestTsFiles` now recurses (`{recursive: true}`) under every `packages/*/src/` directory and `scripts/`, rather than a single-level `readdirSync`, so a future nested source file is not silently invisible to Tests 1/2; **Test 6** asserts every `not-mutated` entry exists on disk; **Test 7** asserts no path is listed in both `mutate` and `not-mutated` (mutual exclusion). `mutation-guards-config.test.ts` grew from 5 tests to 12 (7 new: 2 more enumeration tests (Test 6, Test 7) plus 5 pure-function discrimination tests for `findMutateTestPairingViolations`, including the wiki-slug and wiki-context-safety cases). Combined wrapper + config-enumeration test count: 107 (95 + 12).

**Third addendum (review pass — reach is not coverage, plus four extractor hardenings):** `findMutateTestPairingViolations` and `reachedModulesTransitive` prove a `mutate` entry is *touched* by a same-tree test, not that it is *exercised* — the barrel `packages/wiki-write-core/src/index.ts` (eight `export *` targets) makes `wiki-write-core.test.ts` reach 11 package modules, so this positive rule is a near-vacuous structural floor for `packages/`, not evidence a promotion is safe (documented directly on `findMutateTestPairingViolations`'s docstring; the corresponding one-sentence caveat is now also on Unit 5's execution note, above). Four more gaps closed in the extractor: (1) a commented-out import (`// import ... from './x.ts'` or a `/* ... */` block form) was still counted as reach — closed by stripping comments (a new, file-scoped `stripComments`, deliberately not the shared `stripStringLiterals`, since that blanks string content and would erase the specifiers this extractor needs to keep) before running the import patterns; discrimination proven red→green: a fixture test file with both comment forms wrapping an import no longer reaches that import's target, while a real adjacent import on the next line still does. (2) `REEXPORT_PATTERN` now accepts `export type {...} from` and `export type * from`, proven with a fixture barrel chain. (3) A glob `testFiles` entry (`isLiteralPath`) is filtered before `reach` would `readFileSync` it (ENOENT) and reported as its own violation ("glob testFiles entries are not supported for pairing") instead. (4) The prior test at this location, named after the wiki-slug fixture data, is renamed to describe the general shape it tests ("flags a mutate entry when reach resolves only to the other tree's shell"). `mutation-guards-config.test.ts` grew from 12 tests to 16. Combined wrapper + config-enumeration test count: 111 (95 + 16).

**Fourth addendum (Unit 5 scope correction — supersedes the "genuine gates" criterion above):** "Structural gate shape" (classification + `main()` with `exitCode`) was necessary but not sufficient, and drew the mutated set too wide. Corrected criterion:

> Mutate a module when it runs in CI or an autonomous write/read path AND owns a material trust/security decision, persisted state later trusted by such a decision, or a generated artifact whose correctness is not independently validated — and the plausible failure is wrong-but-valid, not a loud crash. Structural gate shape alone is not sufficient.

Three demotions from `mutate` to `not-mutated` (with their `testFiles` pairs) under this criterion:
- `packages/wiki-write-core/src/private-leak-adapter.ts`: no production caller, only its own tests and the barrel reference it.
- `scripts/check-repo-onboarded.ts`: a routing predicate, not an independent write/promotion authority; both failure directions are bounded by downstream gates.
- `scripts/check-md-links.ts`: a documentation-quality lint, no security/trust/artifact boundary.

`scripts/build-wiki-write-core.ts` stays despite being a build script: its `main()` validates the committed dist against its own `compareTrees`, so a defect there is self-consistently green — wrong-but-valid, not a crash.

**Fifth addendum (Fro Bot's standing follow-up from #3833 — barrel-reach hole closed):** `findMutateTestPairingViolations` counts reach through a re-export barrel as reach (documented in its own "Reach is not coverage" paragraph as a near-vacuous floor for `packages/`), which is why removing `private-leak-adapter.test.ts` from `testFiles` on #3833's first push left `private-leak.ts` passing the pairing check even though its only remaining same-tree exerciser was a single `it()` in `wiki-write-core.test.ts`, reached solely through `index.ts`'s `export *` forwarding. Added a second, stricter check in `scripts/mutation-guards-config.test.ts`: `findMutateEntriesWithoutSourceReach`, built on a new `sourceReachTransitive` walk that never steps through a "pure re-export barrel" (a module whose entire body, after stripping comments, is only `export * from`/`export {...} from` statements — `index.ts` is the canonical case). Every `mutate` entry must have at least one same-tree `testFiles` entry reaching it through a chain with no barrel hop; "same-tree" reuses the existing `packages/` vs `scripts/` definition. Deliberately does not replace or weaken `findMutateTestPairingViolations`, and does not touch `reachedModulesTransitive` (the trigger gate needs it wide — see the "Shared walk, opposing preferences" paragraph). Proven red→green: with barrel-exclusion temporarily disabled, both the real-config discrimination test (private-leak.ts flagged once its adapter test is removed) and the synthetic barrel-stepping fixture lose their violation entirely; restored, both pass again. Passes against the real config today (mutate=9/testFiles=10, zero violations).

**Goal:** Make the mutated set structurally complete and the pairing structurally safe: a new guard file cannot be forgotten, and a package module cannot be paired with scripts tests.

**Requirements:** R2, R3

**Dependencies:** Unit 2 (config shape settled).

**Files:**
- Create: `scripts/mutation-guards-config.test.ts`
- Modify: `stryker.config.json` (add a top-level comment-free sibling list, or a small `mutation-guards.json` if JSON comments are unavailable, holding `not-mutated: [{path, reason}]`)

**Approach:**
- Test 1 (package, exhaustive): every non-test `.ts` under `packages/wiki-write-core/src/` appears in `mutate` or `not-mutated`. Anything unlisted fails with the path and the two lists it could join.
- Test 2 (scripts, by name): every file matching `scripts/check-*.ts`, `scripts/wiki-*-gates.ts`, `scripts/wiki-context-safety.ts`, `scripts/build-wiki-write-core.ts` appears in `mutate` or `not-mutated`.
- Test 3 (same-tree pairing): for each `mutate` entry under `packages/`, every `testFiles` entry lives under `packages/`; for each under `scripts/`, under `scripts/`. A cross-tree pairing fails naming both paths.
- Test 4: `regex-redos-regressions.test.ts` is not in `testFiles`.
- Test 5: every `not-mutated` reason is non-empty and names the module that carries the core when the entry is a shell.
- Initial dispositions from research, to be confirmed by reading each file: `mutate` — `check-private-leak.ts`, `check-wiki-authority.ts` (exports `checkWikiAuthority`), `check-repo-onboarded.ts` (exports `runCheck`), `wiki-lockfile-gates.ts`, `wiki-context-safety.ts`, `build-wiki-write-core.ts`, and in the package `private-leak.ts` (covered through `private-leak-adapter.test.ts` and the `index.ts` barrel: 47 killed in Unit 2's live run), `private-leak-adapter.ts`, `corrections.ts`, `corrections-survival.ts`; `not-mutated` pending relocation — `wiki-lint.ts`, whose real tests are `scripts/wiki-lint.test.ts` reaching it through `dist/` (same-tree pairing measured 441 uncovered / 10 killed); Unit 5 moves those tests beside the module they test, then Unit 3's list flips it to `mutate`; `not-mutated` with reason — `gate-contract.ts` (constants), and the transform/type modules (`frontmatter.ts`, `rendering-policy.ts`, `wiki-ingest.ts`, `wiki-slug.ts`, `wiki-utils.ts`, `markdown-links.ts`, `schemas.ts`, `index.ts`) unless reading shows a rejection path.

**Patterns to follow:**
- `scripts/wiki-write-core-contract.test.ts` and `scripts/improvement-metrics-workflow.test.ts` — tests that parse a config artifact and assert structural properties.
- The set-equality contract test shape used for `failure_code_descriptions` (assert the full set so a new key forces a conscious update).

**Test scenarios:**
- Happy path: current config passes all five tests.
- Discrimination: inject a fake `packages/wiki-write-core/src/new-gate.ts` into the file list → Test 1 fails naming it.
- Discrimination: inject a fake `scripts/check-fake.ts` → Test 2 fails naming it; inject `scripts/helper.ts` → no failure (pattern miss is intended).
- Discrimination: move one package module's test path into `scripts/` in an injected config → Test 3 fails naming both.
- Discrimination: inject the redos test into `testFiles` → Test 4 fails.
- Edge case: a `not-mutated` entry with whitespace-only reason → Test 5 fails.

**Verification:**
- `pnpm test` includes the new file; each discrimination scenario has been run red-then-green and the outputs recorded in the PR.

- [x] **Unit 4: `Main` job with changed-file gating (not yet required)**

**Goal:** Land the `Check Mutation Guards` job in `Main`, always running on `pull_request`, short-circuiting to `not-applicable` when nothing in the trigger set changed, skipped on other events.

**Requirements:** R7, R8

**Dependencies:** Unit 2. Unit 3 should land first or together so the config is guarded before it is enforced.

**Files:**
- Modify: `.github/workflows/main.yaml` (new job `check-mutation-guards`, `name: Check Mutation Guards`)
- Delete: `.github/workflows/mutation-spike.yaml`
- Modify: `scripts/check-mutation-guards.ts` (changed-file step inside the wrapper: `readPullRequestContext` and `fetchChangedFiles(prNumber, fullName)` imported from `scripts/check-private-leak.ts`, which already exports both; compare against the trigger set)
- Create: `scripts/main-workflow.test.ts` (no shape test for `main.yaml` exists today; mirror `scripts/merge-data-workflow.test.ts`: `readFileSync` + `parse`, a narrowing `assertMainWorkflow`, then assertions on the job: present, `if:` is `github.event_name == 'pull_request'`, uses `./.github/actions/setup`, permissions `contents: read` + `pull-requests: read`, `name:` equals `Check Mutation Guards`)
- Test: `scripts/check-mutation-guards.test.ts` (trigger-set matching)

**Approach:**
- Trigger set: the `mutate` and `testFiles` entries, `stryker.config.json`, `mutation-guards.json` (if introduced), `vitest.config.ts`, `package.json`, `pnpm-lock.yaml`, `scripts/check-mutation-guards.ts`, `scripts/mutation-guards-config.test.ts`. Derive it from the config, not a second hand-maintained list.
- The changed-file step is a function of the wrapper, not a separate script: one script, one `import.meta.main`, one entry in `Test Scripts Load`.
- `not-applicable` is a real verdict: exit 0, summary line says which trigger set was checked and that nothing matched.
- Fork pull requests: the files API is readable with the default token on a public repository; no write permission is requested.
- Do not add the context to `.github/settings.yml` in this unit.
- The real job must carry a `concurrency` group like `main.yaml`'s other jobs — the spike workflow lacked one.

**Patterns to follow:**
- `check-wiki-authority` job in `.github/workflows/main.yaml`.
- `scripts/check-private-leak.ts` for `GITHUB_EVENT_PATH` parsing and paginated file listing.
- `docs/solutions/workflow-issues/quoted-required-status-check-context-2026-06-09.md` — fix the job `name:` now; it becomes the required context string in Unit 6.

**Test scenarios:**
- Happy path: changed set `['docs/x.md']` → `not-applicable`.
- Happy path: changed set includes a `mutate` entry → proceeds to run.
- Edge case: changed set includes only `pnpm-lock.yaml` → proceeds to run.
- Edge case: changed set includes only a `not-mutated` file → `not-applicable` (it is not in the trigger set).
- Error path: files API call fails → `instrumentation-failed`, never `not-applicable` (fail closed, per R9).
- Integration: `scripts/main-workflow.test.ts` asserts the job's `if:`, name, permissions, and setup action, and fails if the job is removed.

**Verification:**
- On a docs-only pull request the job reports success in seconds with a `not-applicable` summary; on a pull request touching a mutated module it runs Stryker and reports a verdict.
- The job is visible in `Main` but not yet listed in `.github/settings.yml`.

**Result:** Correction to the Approach section's named source: `readPullRequestContext` and `fetchChangedFiles` do not live in `scripts/check-private-leak.ts` (verified by reading it — it has its own, unrelated `workflow_run`-event reader for the private-leak check, not a `pull_request` one). Both live in `scripts/check-wiki-authority.ts`, which already implements this exact `pull_request`-event shape for its own PR-scoped guard; `fetchChangedFiles` was already exported there, `readPullRequestContext` was module-private and is now exported alongside it, and `check-mutation-guards.ts` imports both from `./check-wiki-authority.ts` rather than duplicating event-payload parsing and paginated-API fetching a second time.

Trigger set is built (`buildTriggerSet`, exported) directly from the just-read `StrykerConfigShape`: every `mutate` and `testFiles` entry (literal or glob, normalized the same way as everywhere else in the module) plus a fixed infrastructure list — `stryker.config.json`, `mutation-guards.json`, `vitest.config.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/check-mutation-guards.ts`, `scripts/mutation-guards-config.test.ts`, `.github/workflows/main.yaml`, `packages/wiki-write-core/package.json`, `tsconfig.json`, and `packages/wiki-write-core/tsconfig.build.json` (`quartz-site/tsconfig.json` deliberately excluded — unrelated documentation-site build). A glob entry in `mutate`/`testFiles` sets `hasGlobEntries`, which unconditionally proceeds to run rather than attempting minimatch-style expansion against the changed-file list — the real config has no glob entries today, so this is a defensive branch, not the common path.

`evaluateTriggerGate` (exported, async, injectable `env`/`deps` seams) is the single gate function, called from inside `runMutationGuardCheck` (now async) before the report is cleared or Stryker is spawned. Precedence, matching the Approach exactly: not a `pull_request` event → returns `undefined` (full check runs unconditionally, local/`workflow_dispatch`/post-merge `push` all unaffected); `pull_request` event with no `GITHUB_EVENT_PATH`, an unreadable event payload, a payload missing `pull_request.base.repo.full_name`, or a failed `fetchChangedFiles` call → `instrumentation-failed` with a `ChangedFileGateFailed` sentinel naming the cause, never `not-applicable`; `pull_request` event with changed files intersecting the trigger set (or any glob entry present) → `undefined` (proceeds to run); otherwise → `not-applicable` with a `NotApplicable` sentinel naming the changed-file count and trigger-set size. `runMutationGuardCheck` becoming async required updating its eight existing call sites in `scripts/check-mutation-guards.test.ts` to `await` and explicitly pass a non-`pull_request` `triggerGateEnv` override (`{eventName: undefined, eventPath: undefined}`) — without that override, those pre-Unit-4 tests would pick up a real ambient `GITHUB_EVENT_NAME=pull_request` when this very test suite runs inside this repository's own `Test` job in `main.yaml`, and try to invoke the real gate.

All five plan scenarios have discrimination tests in `scripts/check-mutation-guards.test.ts` (15 new tests total, covering the five plus the not-a-pull_request pass-through, missing-event-path, missing-full_name, and glob-bypass cases): `runs the full check unconditionally when the event is not a pull_request`, `reports not-applicable when the changed set is ['docs/x.md'] (no intersection)`, `proceeds to run when the changed set includes a mutate entry`, `proceeds to run when the changed set includes only pnpm-lock.yaml`, `reports not-applicable when the changed set includes only a not-mutated file`, `reports instrumentation-failed, never not-applicable, when the changed-files API call fails`.

`.github/workflows/main.yaml` gained the `check-mutation-guards` job (name `Check Mutation Guards`, modeled directly on `check-wiki-authority`: same `if: github.event_name == 'pull_request'`, same `permissions: {contents: read, pull-requests: read}`, same checkout/setup steps, no build step since `dist/` is committed and verified by the separate `Check Wiki Write Core Dist` job) with `timeout-minutes: 20` (a local full run with no PR context completed in 1m36s wall-clock on this machine after this unit; CI's own baseline reference, 5m29s for ten modules, predates the two newer scripts entries). No per-job `concurrency` group was added — verified against the real `main.yaml` that none of its seven existing jobs (`lint`, `check-types`, `test`, `check-wiki-write-core-dist`, `test-scripts-load`, `check-workflows`, `check-wiki-authority`) declare one; all inherit the workflow-level `concurrency` block. (The Approach note above claiming "the real job must carry a concurrency group like main.yaml's other jobs" was itself wrong about what those other jobs do — corrected here rather than left standing.) `.github/workflows/mutation-spike.yaml` deleted; nothing else referenced it (`.gitignore`'s `/.stryker-tmp/` and the CodeQL config's `.stryker-tmp/**`/`reports/**` exclusions are shared with the real check and were kept).

`scripts/main-workflow.test.ts` created (9 tests): job presence, exact `name: Check Mutation Guards` (the string Unit 6 will register as the required context), the `if:` condition, permissions, the setup-action step, the `pnpm check:mutation-guards` step with `GH_TOKEN` set, the 20-minute timeout, absence of a per-job `concurrency` key, and a top-level sanity check that every job in `main.yaml` has at least one step.

**Until Unit 5 lands, this job is expected to report `mutants-survived` (or, as observed in the actual local full run during this unit, `mutant-timeout`) on any pull request touching the trigger set — the mutated set has not yet been driven to `clean`. This is by design: the job is visible in `Main` for observation, not required, and Unit 6 gates registering it as a required check on Unit 5's `clean` baseline.**

Gate: `pnpm check-types`, `pnpm lint`, `pnpm test` (74 files, 2983 tests + 3 todo, up from 73/2959+3), `actionlint .github/workflows/main.yaml` (clean), import-inertness for both modified scripts, and a local `pnpm check:mutation-guards` run with no `GITHUB_EVENT_NAME`/`GITHUB_EVENT_PATH` set, confirming the gate returns `undefined` (no `not-applicable`/`instrumentation-failed` sentinel appears in the output) and the full 12-module Stryker run proceeds and classifies normally.

**Follow-up fix (post-review): the trigger set is now the transitive import closure, not just the literal enumerated entries.** Blocking review finding: `buildTriggerSet` originally unioned only `mutate` + `testFiles` + the fixed infrastructure list, so a pull request changing only `packages/wiki-write-core/src/wiki-slug.ts` (a `not-mutated` module *imported by* the mutated `private-leak-adapter.ts`) read `not-applicable` and never ran Stryker — a fail-open, since a change to an imported-but-unlisted module can change a mutated module's behavior without appearing in its own right in either enumerated list.

Fix: `reachedModulesTransitive` and `stripComments` — the relative-import-closure extractor `scripts/mutation-guards-config.test.ts` already had for same-tree pairing (static/dynamic/type-only/`export … from`, `.js`→`.ts` extension normalization, `existsSync` filtering, comment stripping) — moved into the wrapper module (`scripts/check-mutation-guards.ts`, both exported) so the enumeration guard and the trigger gate share one implementation instead of two textual scanners drifting apart. `scripts/mutation-guards-config.test.ts` now imports both from there; nothing in its own behavior or its 18 tests changed (same file used to define these functions, only its location moved).

A new package-specifier extractor, `wikiWriteCoreSubpathSourceFiles`, closes the relative-import extractor's blind spot: a `scripts/` file that imports `@fro-bot/wiki-write-core[/subpath]` by package name (not a relative path) has no `./`/`../` specifier for the relative scanner to find, so it would never connect to the source file whose compiled `dist/` output it actually depends on. `<subpath>` (or `index` for the bare package specifier) maps to `packages/wiki-write-core/src/<subpath>.ts`, and that source file's own further imports are then followed transitively too, exactly like any other closure entry.

`buildImportClosure(entries)` (exported) computes the full closure: each entry's `reachedModulesTransitive` result, plus every `@fro-bot/wiki-write-core` subpath reference resolved to source and recursively expanded. `buildTriggerSet` now unions the literal `mutate`/`testFiles`/fixed-infrastructure files with this closure's `files`, and `TriggerSet` grew two new fields: `closureSize` (the count of closure-only additions, for observability) and `directoryPrefixes` — populated with `packages/wiki-write-core/dist/` whenever `ImportClosure.hasWikiWriteCoreSubpathReference` is true, since a `scripts/` file importing the package by name resolves against its *compiled* output at run time, so a stale or hand-edited `dist/` file can change the run's outcome even with no `.ts` source change. `changedFilesIntersectTriggerSet` now checks directory-prefix membership in addition to exact-path membership. The `not-applicable` summary line now prints the closure size alongside the trigger-set size ("matched the N-file trigger set (M from the import closure)") so a CI reader can see at a glance whether the closure contributed anything.

`.github/actions/setup/action.yaml` added to the fixed infrastructure list — every job depends on it to install and cache dependencies, and it was a gap in the original fixed list.

Against the real config: closure size is **15** (52 total trigger-set files against ~37 literal `mutate`/`testFiles`/fixed entries), and `directoryPrefixes` includes `packages/wiki-write-core/dist/` (several mutated `scripts/` files import the package by name). Four new tests in `scripts/check-mutation-guards.test.ts` prove discrimination against the real `stryker.config.json`/`mutation-guards.json`: (a) a changed set of only `wiki-slug.ts` no longer reads `not-applicable` — confirmed red under the pre-fix `buildTriggerSet` by temporarily restoring the prior committed implementation and rerunning this test suite, which failed with `expected { verdict: 'not-applicable', … } to be undefined`; (b) a changed set of only `packages/wiki-write-core/dist/private-leak.js` also proceeds to run; (c) a real file confirmed (via `realTriggerSet.files.has(...)` before relying on the absence) to be genuinely outside the closure (`markdown-links.ts`) still reports `not-applicable`; (d) every `not-mutated` entry in `mutation-guards.json` that IS reached by `buildImportClosure(realConfig.mutate)` is asserted to be in the trigger set — the generalized form of case (a). The pre-existing "only a not-mutated file" fake-config scenario test was renamed and switched to `docs/x.md` (guaranteed outside any closure) rather than a real not-mutated package module, since the closure now legitimately reaches several real not-mutated modules (e.g. `frontmatter.ts`, via `wiki-write-core.test.ts`'s barrel import) through `testFiles`' own imports, not just `mutate`'s.

**Non-blocking fixes taken:** (1) `buildStrykerSpawnEnv` now also deletes `GH_TOKEN`/`GITHUB_TOKEN` from the Stryker child spawn's env — the trigger gate has already made every `gh`/API call this check needs before the spawn happens, so neither the token nor its use should be observable to the mutated test suite Stryker executes; new test proves the child env lacks both while the parent env is untouched. (2) `printResult`'s comment claiming the raw Stryker clear-text dump "stays in the reports/ artifact" is now true: `.github/workflows/main.yaml`'s `check-mutation-guards` job gained an `actions/upload-artifact` step (`if: always()`, same pinned SHA as `wiki-lint.yaml:93`) uploading `reports/mutation/`; `scripts/main-workflow.test.ts` gained an assertion for it. (3) `scripts/main-workflow.test.ts`'s `MainWorkflowJob.steps` is now optional (`readonly steps?: ...`) and the top-level "every job has at least one step" assertion uses `job.steps?.length ?? 0` so a future reusable-workflow job (no `steps` key at all) fails with a clear message instead of throwing a `TypeError` on `undefined.length`.

Updated counts: `scripts/main-workflow.test.ts` now 10 tests (was 9, +1 upload-artifact assertion); `scripts/check-mutation-guards.test.ts` grew by 7 (5 real-config closure discrimination tests + 1 renamed fake-config scenario + 1 `GH_TOKEN`/`GITHUB_TOKEN` spawn-env test); `scripts/mutation-guards-config.test.ts` stayed at 18 tests (same functions, moved not rewritten). Full suite: 74 files, 2990 tests + 3 todo.

Gate: `pnpm check-types`, `pnpm lint`, `pnpm test` (74 files, 2990 tests + 3 todo, up from 2983+3), `actionlint .github/workflows/main.yaml` (clean), import-inertness for every non-test `scripts/*.ts` (unchanged loop, all pass).

**Second follow-up fix (post-review): the import-closure walk was only transitive through re-export barrels, not regular imports.** Blocking review finding: `reachedModulesTransitive`'s BFS follow step called `directReexportSpecifiers` (only `export … from` forms), not `directSpecifiers` (all relative specifiers), on every hop past the first. A file reached one hop in that itself made a *regular* import — not a re-export — to a second file never had that second file added to the closure. Concretely: `corrections-survival.ts` (mutate) has `import type {WikiLintFinding} from './wiki-lint.ts'`, a direct hit; `wiki-lint.ts` itself has `import {resolveMarkdownLinks} from './markdown-links.ts'`, a *regular* import the old BFS never followed, so `markdown-links.ts` was invisible to the closure despite being two hops from a mutated module. Same shape for `wiki-ingest.ts` → `data-branch-bootstrap.ts`.

Fix: `reachedModulesTransitive`'s follow loop now calls `directSpecifiers` (a strict superset of the old `directReexportSpecifiers` — the general `from '...'` pattern already matches every re-export form) at every hop, so a regular import is followed to depth N exactly like a re-export hop always was. `directReexportSpecifiers` and its now-unused `REEXPORT_PATTERN` were deleted rather than left as dead code.

Against the real config: closure size grew **15 → 17** (54 total trigger-set files), the two new members being exactly the two the review predicted: `packages/wiki-write-core/src/markdown-links.ts` (via `wiki-lint.ts`) and `packages/wiki-write-core/src/data-branch-bootstrap.ts` (via `wiki-ingest.ts`). Confirmed red under the one-hop implementation by temporarily restoring the prior committed `check-mutation-guards.ts` and rerunning the new pinning test, which failed with `expected false to be true` on `realTriggerSet.files.has('packages/wiki-write-core/src/markdown-links.ts')`.

The existing "real file confirmed outside the real import closure" test (previously `markdown-links.ts`) needed a new subject once `markdown-links.ts` correctly joined the closure: replaced with `scripts/reconcile-repos.ts`, a real, large, wholly separate control-plane module with no relative or package-name import path to or from anything in `stryker.config.json`'s `mutate`/`testFiles` — the test now asserts both that the file exists on disk (`existsSync`) and that it is absent from the real trigger set before relying on that absence, so the "genuinely unreachable" premise is verified in the test itself rather than asserted by fiat.

`buildTriggerSet(config)` moved inside `evaluateTriggerGate`'s `try` block (was called before it): computing the trigger set requires reading every `mutate`/`testFiles` entry's source through the closure walk, and a read failure there is exactly the "cannot determine the trigger set" condition R9 requires this gate to fail closed on, same as an unreadable PR context or a failed changed-files API call. A new injectable `SourceReader` seam (`readSource`, defaulting to a real `readFileSync`) threads through `directSpecifiers` → `wikiWriteCoreSubpathSourceFiles` → `reachedModulesTransitive` → `buildImportClosure` → `buildTriggerSet` → `evaluateTriggerGate`, so a test can inject a throwing reader and prove the failure is caught and converted to `instrumentation-failed` (`ChangedFileGateFailed` sentinel) rather than escaping uncaught to `main()`'s caller.

Updated counts: `scripts/check-mutation-guards.test.ts` grew by 2 (a closure-membership pinning test for both new members, and the `readSource`-throws `instrumentation-failed` test); the outside-closure test was rewritten in place (same count). Full suite: 74 files, 2992 tests + 3 todo.

Gate: `pnpm check-types`, `pnpm lint`, `pnpm test` (74 files, 2992 tests + 3 todo, up from 2990+3), `actionlint .github/workflows/main.yaml` (clean), import-inertness for every non-test `scripts/*.ts` (unchanged loop, all pass).

**Third follow-up pass (Fro Bot re-review of the second follow-up: PASS, zero blocking, three non-blocking taken).**

1. **Opposite-direction tension on the shared `reachedModulesTransitive`, documented.** Widening the walk to follow regular imports (not just re-export barrels) moved its two consumers in opposite safety directions: the trigger gate wants reach as WIDE as possible (more triggers = strictly safer), while `findMutateTestPairingViolations`'s "unreached entry" rule wants reach as NARROW as possible (a wider walk only ever lowers how often that violation can fire, never raises it). No behavior change today — verified every `packages/`-tree `mutate` entry already had barrel reach via `index.ts`'s `export *` targets under the old re-export-only walk, and every `scripts/`-tree entry has a direct same-tree test, so nothing that used to be flagged stops being flagged. Documented in `findMutateTestPairingViolations`'s "Reach is not coverage" docstring paragraph (extended to disclaim arbitrary-depth regular-import chains, not just barrels) plus a new terse "Shared walk, opposing preferences" paragraph naming the direction explicitly. No depth-bounded reach variant added — one shared implementation, tuned wide, is correct; splitting it would add machinery for a floor that's already documented as weak.
2. **`runMutationGuardCheck` now threads the `SourceReader` seam.** Gained a sixth parameter, `triggerGateReadSource?: SourceReader`, passed straight through to `evaluateTriggerGate`'s fourth parameter (previously silently dropped, defaulting `evaluateTriggerGate`'s own default every time regardless of what was passed to `runMutationGuardCheck`). New end-to-end test drives a throwing reader through the public `runMutationGuardCheck` entry point with a spawner that throws if ever called, proving the gate short-circuits to `instrumentation-failed` before Stryker would run — not just provable against `evaluateTriggerGate` directly. Confirmed red by temporarily reverting the fifth positional argument to the old two-argument `evaluateTriggerGate(config, triggerGateEnv, triggerGateDeps)` call and rerunning: the test failed with `Error: Stryker must not be spawned when the trigger gate fails closed` thrown from inside the spawner — without the seam reaching the gate, the throwing reader was never invoked, the gate reported no problem, and `runMutationGuardCheck` proceeded to spawn Stryker for real.
3. **Fork-PR `base.repo.full_name` boundary pinned.** New test in `scripts/check-wiki-authority.test.ts`, `readPullRequestContext (base vs head repo)`, writes a real temp event-payload file with DIFFERENT `full_name` values for `pull_request.base.repo` and `pull_request.head.repo`, and asserts the returned `fullName` is the base repo's, not the head repo's — the property that makes a fork PR's changed-file lookup resolve against the right API endpoint at all (only the base repo has a `/pulls/{n}/files` route for this PR). Confirmed red by temporarily flipping `readPullRequestContext`'s field read from `parsed.pull_request?.base?.repo?.full_name` to `parsed.pull_request?.head?.repo?.full_name` and rerunning: `AssertionError: expected 'contributor-fork/.github' to be 'fro-bot/.github'`. Reverted immediately after capturing the failure.

Updated counts: `scripts/check-wiki-authority.test.ts` grew by 1 (fork-PR base/head test); `scripts/check-mutation-guards.test.ts` grew by 1 (`runMutationGuardCheck` end-to-end `SourceReader` test); `scripts/mutation-guards-config.test.ts` unchanged (docstring-only). Full suite: 74 files, 2994 tests + 3 todo.

Gate: `pnpm check-types`, `pnpm lint`, `pnpm test` (74 files, 2994 tests + 3 todo, up from 2992+3), `actionlint .github/workflows/main.yaml` (clean), import-inertness for every non-test `scripts/*.ts` (unchanged loop, all pass).

**Fourth follow-up (Fro Bot re-review of the third pass: PASS, no blocking, no missing tests).** The `SourceReader`-throws end-to-end test passed the real `mutationReportPath` instead of a `mkdtempSync` temp path like every sibling `runMutationGuardCheck` test — safe today only because the gate throws before `rmSync(reportPath)` runs, which is exactly the ordering the test exists to prove, so a gate regression could have deleted a real local report. Fixed with a dedicated temp path; reran and confirmed the identical sentinel (`instrumentation-failed`/`ChangedFileGateFailed`) still fires — the path swap changes nothing since the throw happens before any report/reporter-config read. Test count and full-suite counts unchanged (74 files, 2994 tests + 3 todo).

- [ ] **Unit 5: Cleanup baseline**

**Requirements:** R12

**Dependencies:** Unit 4 (job exists), Unit 3 (set is complete).

**Measured baseline:** CI run 34002642010 on `45a1864`, full (then-12-entry) set: 2907 mutants, 53.77% score, 1351 non-clean, verdict `mutant-timeout`. Scope corrected per Unit 3's fourth addendum (three demotions). Re-measured on the corrected 9-module set in CI run 34007429970 on `e975fd9`: 2558 mutants, 1402 killed, 787 survived, 362 no-coverage, 7 timeout — **1156 non-clean**, per-module counts identical to the pre-correction figures. The 5A/5B counts below are that measured baseline.

**5A — Tier 0 (privacy and sole-writer boundaries), 591 non-clean, one PR per module, in order:**
1. `private-leak.ts` (88)
2. `check-private-leak.ts` (326, includes 2 timeout directives)
3. `check-wiki-private-presence.ts` + `wiki-context-safety.ts` (79)
4. `check-wiki-authority.ts` (98)

**5B — Tier 1 (persisted trust state, supply chain, build contract), 565 non-clean, one PR per module, in order — deferred until 5A's measured cost is known; if budget won't cover it, 5B is cut consciously, not diluted:**
1. `corrections.ts` (280)
2. `corrections-survival.ts` (81, includes 5 timeout directives)
3. `wiki-lockfile-gates.ts` (47)
4. `build-wiki-write-core.ts` (157)

**Approach:**
- One pull request per module or small cluster, not one giant baseline PR — each survivor is a small, reviewable fix with its own reasoning.
- Prefer fixing the test over adding a directive. A directive is for mutants that are genuinely inert (logging branches, message text, defensive duplicates) — the reason must say why the mutation has no rejection consequence.
- For `mutants-uncovered` in a script's `main()`: cover the assembled flow with the injected-seam pattern already used in `scripts/check-private-leak.test.ts` and `scripts/wiki-context-safety.test.ts`, or move the file to `not-mutated` naming the module that carries its core. Never a directive per line.
- Each pull request records the before/after survivor count in its description.
- Survivor priority within each PR: `ConditionalExpression`, `LogicalOperator`, `EqualityOperator`, `Regex`, meaningful `CallExpression`/`ObjectLiteral` first; meaningful `NoCoverage` branches second; cosmetic/diagnostic/defensive-duplicate directives last.
- **StringLiteral policy:** stays enabled — no global or per-file `excludedMutations`. Semantic strings (verdict/`scan_result` vocabulary, diff markers, `/dev/null`, `[REDACTED]`, guarded-path patterns, env names, API routes, lifecycle names) get killed by assertions; human-readable prose gets a `next-line` directive with a reason of the form "diagnostic text does not affect classification, exit status, redaction, or downstream parsing."
- **Timeout policy:** the 7 timeouts are deterministic infinite-loop mutants (`Hit limit reached` at `301/300`, `6001/6000`, `65501/65500` — not 30s wall-clock). All are induction-variable destruction in `corrections-survival.ts:127-144` (`maskMarkdownLinks`) and `check-private-leak.ts:666` (loop counter). They get line-scoped directives naming the destroyed loop progress. Do NOT lower `timeoutMS`, do NOT add runtime iteration guards to production code.

**Execution note:** For every survivor fixed by a test change, keep the mutant's location in the commit message so the pairing is auditable. Unit 3's `findMutateTestPairingViolations` passing is a structural floor only — it proves a test *reaches* the module, not that it *exercises* it; the only evidence a survivor fix is safe is a live `pnpm check:mutation-guards` run showing that module's per-mutant kill count.

**Test scenarios:**
- Test expectation: none as a unit — this unit is the application of Units 2–4's checks to existing code; each fix carries its own test change or directive.

**Verification:**
- `pnpm check:mutation-guards` reports `clean` on the full retained set on `main`.
- Every directive in the mutated set has a non-empty reason and is `next-line` scoped (enforced by Unit 2).

**Result (Unit 5A-1 — `private-leak.ts`):** Baseline 88 non-clean (52 Survived, 36 NoCoverage, 0 Timeout, CI run 34007429970). This module had no dedicated same-tree source exerciser under Stryker: `private-leak-adapter.test.ts` only covers it through the adapter's one fixed diff shape, `wiki-write-core.test.ts` has one `it()`, and `regex-redos-regressions.test.ts`'s richer direct calls are deliberately excluded from `testFiles` (Unit 3's Test 4). Added `packages/wiki-write-core/src/private-leak.test.ts` (35 tests), registered in `stryker.config.json`'s `testFiles`. Final result: **117 Killed, 0 Survived, 0 NoCoverage, 0 Timeout, 2 Ignored (directives)**, 119 mutants total — module fully clean. Overall verdict stays `mutant-timeout` (other 8 modules untouched).

**Directive history: 10 → 5 → 2.** First pass shipped 10 `next-line` directives. Fro Bot's review of the follow-up commit caught the actual defect: `disable next-line` is **mutator-scoped, not variant-scoped** — a directive naming `ConditionalExpression` suppresses every variant that mutator generates (`true` AND `false`), and naming `EqualityOperator` suppresses every relational swap it produces, not just the one variant the reason happened to argue. Three directives argued only one variant while silently also suppressing others that were live bugs or genuinely killable:
1. **Line 60's `hasRoomAfterSeparator` clause was dead code, not equivalent code.** Its `EqualityOperator` mutant (`<` → `>=`) makes the clause permanently false, forcing every `diff --git` line down the else branch — genuinely killed by the existing boundary-value fixture (`private-leak.test.ts:66`, a real base/mutant `{ok:false}` vs `{ok:true}` divergence), which the directive was silently hiding. Proof the clause itself is a tautology: `lastIndexOf`'s `fromIndex` argument (`line.length - separator.length - 1`) bounds any hit to `foundIndex + separator.length <= line.length - 1`, so a found index always leaves room; the miss case (`-1`) is already rejected by the `separatorIndex > diffPrefix.length` floor on the line above. **Deleted the clause, the `const`, and the directive** — dead code doesn't get a chaperone. The `if` reverted to testing `separatorIndex > diffPrefix.length` alone, with a plain comment (no directive) explaining why no upper-bound check is needed.
2. **Line 34's early-return block covered three variants but not the fourth.** The reason argued `ConditionalExpression`'s `false` variant, the `&&` `LogicalOperator` variant, and an emptied `BlockStatement` — all correctly equivalent — but never addressed `ConditionalExpression`'s `true` variant, which disables the guard entirely and would return `{ok:true}` on a genuinely leaking diff. The reason's own logic (`lowerNames = []` when `privateNames` is empty, so `.some(...)` never matches; `''.split('\n')` yields one non-matching line) proves the early return was a pure optimization over an already-correct fallthrough, for every variant including the dangerous one. **Deleted the block and the directive**; the fallthrough is now pinned directly by two tests (`privateNames: []` and `diff: ''`, both returning `{ok: true}` through the main path with no special-casing).
3. **Line 97's `checkPathAsNew` reset directive was flatly false**, not partially covered. "Never read before the next reset" assumed only one `+++` line ever follows a `diff --git` section, but real diffs can carry two consecutive `+++` lines (added content itself starting with `++`, e.g. a diff-of-a-diff). Reproduction: `diff --git a/private-repo.md b/private-repo.md` + two consecutive `+++ b/unrelated` lines — base `{ok:true}`, mutant (the reset flipped to `true`) `{ok:false, matchedFiles:['private-repo.md']}`. **Deleted the directive** (it named only `BooleanLiteral`, nothing else, so nothing remained to keep) and added that exact two-consecutive-`+++` case as a real kill.

**Kept, re-verified against the variant rule:** the two `BooleanLiteral` directives on `checkPathAsNew`'s initial value (was line 42) and the else-branch reset (was line 73) both hold for BOTH `BooleanLiteral` variants trivially — mutating a literal `false` produces only `true` (there is no third boolean value), so a `BooleanLiteral` directive's variant set is always exactly one, and "currentFile only becomes non-null via a branch that also resets this value" holds regardless of which single variant `false` mutates to.

**Final shipped directive list (2 directives, each covering exactly one variant, both `BooleanLiteral` on a literal `false`):**
- `let checkPathAsNew = false` (line 42): `currentFile` only ever becomes non-null via the `diff --git a/` true-branch, which in that same branch also resets `checkPathAsNew` to `false`, or the else-branch resets both `currentFile` and `checkPathAsNew` together — whenever `currentFile !== null` is later read, this initial value has already been overwritten.
- Else-branch `checkPathAsNew = false` (line 74): `currentFile` is reset to `null` in this same branch, so the `+++` handler's `currentFile !== null` guard blocks any read of `checkPathAsNew` until the next `diff --git a/` line resets it again anyway.

**Standing rule for 5A-2 onward:** see `docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md` — every directive must address every variant its named mutator(s) generate, not just the one first noticed.

**Non-blocking, filed as an issue, not fixed:** `line.startsWith('+++')` treats any line beginning with three `+` characters as a diff header, including a genuine added line whose own content starts with `++` — a real detection false-negative. Fixing it is a behavior change in a Tier 0 privacy module, out of scope for a mutation-cleanup PR. The existing test pinning this shape is retitled to make clear it documents current behavior pending that issue, not that the behavior is desired.

Live `pnpm check:mutation-guards` run confirms the module's own final per-mutant counts above (117 Killed / 0 non-clean / 2 Ignored, 119 total — down from 136 since the two deleted dead-code branches removed their own mutant variants entirely); `pnpm test`: 75 files, 3037 tests + 3 todo (up from 3002+3).

**Follow-up (#3838 → #3839, PRs fix/private-leak-plus-header-bypass → fix/private-leak-plus-header-bypass 2nd commit):** the 2 remaining `Ignored` directives above (both on `checkPathAsNew`'s state) turned out to be a symptom of a real defect, not equivalence. Filed as #3838 in review: `line.startsWith('+++')` treated ANY line starting with three `+` characters as a diff header, so an added content line whose own text begins with `++` (e.g. `+++ see acme/secret-repo...`) escaped the content scan entirely — a false negative in this Tier 0 disclosure guard. First fix attempt gated on adjacency alone (`+++` is a header only if the immediately preceding line was `--- `), tracked with one `pendingNewFileCheck: boolean | undefined` flag replacing the old persistent `checkPathAsNew` boolean; that refactor made every one of `checkPathAsNew`'s resets (initial value, both `diff --git` branches, the `+++` handler's own reset) provably dead, deleting both `Ignored` directives along with them. But adjacency alone still leaked on the single most common diff shape — a modified line, whose removed half renders as `--- ...` and added replacement as `+++ ...`, arming the same false pairing. The correct invariant is positional, not adjacency-based: `---`/`+++` are headers only in a file's header block, before its first `@@` hunk marker. Added an `inHunk: boolean | undefined` flag (no initial-literal `false`, for the same not-observable-before-first-diff-git-line reason as the deleted `checkPathAsNew`/`expectPlusHeader` initial values — avoiding the mutant rather than directive-excusing it), set true on any `@@`-prefixed line (fall-through, not `continue` — a `continue` would be an equivalent mutant since a hunk marker never starts with `+` and the content scan skips it regardless) and reset false on each new `diff --git a/` section. Both header branches gated with `!inHunk &&`. Final result: **130 Killed, 0 Survived, 0 NoCoverage, 0 Timeout, 0 Ignored** — 130 total mutants, 0 directives (up from 117/119 with 2 Ignored, since the module now has more logic, all fully killed). `pnpm test`: 75 files, 3046 tests + 3 todo (up from 3002+3 at Unit 5A-1's original baseline).

**Learning doc:** `docs/solutions/security-issues/mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md` — why 117/0/0/2 on #3837 still shipped a reachable false negative, and the grammar-before-coverage rule for trust-boundary parsers going forward.

**Result (Unit 5A-2 — `scripts/check-private-leak.ts`): CLEAN.** Baseline (run 34007429970): 326 non-clean (248 Survived, 76 NoCoverage, 2 Timeout) out of ~640 mutants. A first WIP pass (commit `9efaecf`) landed the sentinel-loop timeout directives, `isGh404Error`'s remaining kills, and four `private-leak.test.ts` inverse-control tests, moving the module to 314 non-clean. A second pass (commit `6bd7f3d`) finished the module to 580 Killed / 0 non-clean / 18 Ignored. A third, self-audit pass (`11da178`) found 7 of those 18 directives wrong or unnecessarily broad and fixed all seven, reaching 574 Killed / 0 non-clean / 16 Ignored. **A fourth pass, from PR #3841 review (Fro Bot: CONDITIONAL, 2 blocking, both correct), fixed a remaining `StringLiteral`-directive-sweeps-a-killable-node case in `isGh404Error`, corrected the plan doc's own Class-1 enumeration (named the wrong two arrays), added a schema-invariant pin `hasNonEmptyNodeId` depends on, and refreshed a stale doc example; final state: 571 Killed, 0 Survived, 0 NoCoverage, 0 Timeout, 13 Ignored (directives)** — 584 total mutants.

| | Baseline (34007429970) | WIP (`9efaecf`) | Pass 2 (`6bd7f3d`) | Pass 3 (`11da178`) | Final (PR review) |
|---|---|---|---|---|---|
| Killed | — | 323 | 580 | 574 | 571 |
| Survived | 248 | 233 | 0 | 0 | 0 |
| NoCoverage | 76 | 81 | 0 | 0 | 0 |
| Timeout | 2 | 0 | 0 | 0 | 0 |
| Ignored (directives) | — | 3 | 18 | 16 | 13 |
| Total mutants | ~640 | ~637 | 598 | 590 | 584 |

**Test count:** `check-private-leak.test.ts` grew from 113 tests (on `main`) to 185 (+72 across all four passes). `pnpm test`: 75 files, 3178 tests + 3 todo (up from pass 3's 3177+3).

**Audit findings (7 of 18 directives from pass 2, all fixed):**
1. **`OPERATOR_LOGIN` StringLiteral (wrong).** The pass-2 reason argued only that the mutant (`''`) can't turn a non-operator into an operator; it ignored the reverse direction — with `OPERATOR_LOGIN = ''`, the real operator's `[allow-private-leak]` override would never fire. Empirically confirmed observable (breaks 5 tests when applied directly), but the mutant still reported `Survived` under live Stryker even AFTER deleting the directive and relying on existing tests, because a top-level `const` string literal is a **static mutant**: the ESM module instance is cached across mutants within a Stryker worker process, so the mutated value doesn't reliably take effect per-mutant even though it demonstrably changes behavior when run directly. Fixed the same way as `largeOutputMaxBufferBytes`'s existing static-mutant workaround: converted to a `function operatorLogin(): string` returning the literal, called at the one comparison site. No directive; the mutant is now an ordinary per-call mutant, killed by the existing operator-override tests (which already used the real login `'marcusrbrown'`).
2. **`hasNonEmptyNodeId` `EqualityOperator,ConditionalExpression` (wrong).** The pass-2 reason argued the `>=` `EqualityOperator` variant (valid, per the schema invariant) but not `ConditionalExpression`'s `true` variant, which (in the OLD plain-boolean-returning form) let `node_id: undefined` through the filter and an unchecked `.map(r => r.node_id as string)` cast turned it into a literal `undefined` flowing into `string[]`-typed arrays. Restructured `hasNonEmptyNodeId` into a real type guard (`r is T & {node_id: string}`, generic over `T extends Pick<RepoEntry, 'node_id'>` so `Array.prototype.filter`'s type-predicate overload narrows correctly), removing the cast at all three call sites. The type guard's own body was then split across two lines specifically because Stryker's `disable next-line` directive is line-scoped, not sub-expression-scoped: `if (typeof r.node_id !== 'string') return false` carries zero directives (both its `ConditionalExpression`/`EqualityOperator` variants are genuine, killable bugs, confirmed via the existing test suite). The final `return r.node_id.length > 0` line was deleted entirely rather than directived: given the invariant, the comparison is a tautology (always `true`) — and a live `ConditionalExpression` mutant there has two variants (`true`/`false`), only one of which is equivalent, so no single directive could correctly cover the line. Replaced with a bare `return true` plus a comment naming the invariant; the tautological comparison — and its mutant surface — no longer exists in the source. Added a discrimination test (resolver-call-recording, asserts it's never called with `undefined`) as a regression pin, though the actual kill mechanism is the restructure itself.
3-5. **Redundant conjuncts at three sites (all deleted, not fixed with a directive).** `GuardResult`'s `!scanResult.ok && 'matchedFiles' in scanResult`, `PromotionScanResult`'s `'resolutionFailed' in result && result.resolutionFailed`, and the trailing `if ('matchedFiles' in result)` guard were each excusing a conjunct TypeScript's own discriminated-union narrowing already makes redundant — `!scanResult.ok` alone narrows `GuardResult` to its `matchedFiles` arm; `'resolutionFailed' in result` alone narrows `PromotionScanResult` (the key is only ever present as literal `true`); and after the two preceding early returns, TypeScript already narrows `result` to `{ok: false, matchedFiles}` with no runtime check needed at all. Confirmed via `tsc --noEmit`: all three simplifications compile clean with no narrowing lost. Mutants that don't exist need no directive.
6-7. **The missing-node-id sentinel loop (`UpdateOperator`/`EqualityOperator` timeout directives, both eliminated).** Replaced the hand-rolled `for (let i = 0; i < missingNodeIdCount; i++) failedNodeIds.push(...)` counting loop with `failedNodeIds.push(...Array.from({length: missingNodeIdCount}, () => '<missing-node-id>'))` — no induction variable, so no wrong-direction/wrong-guard mutant can produce a deterministic hang. `{length: missingNodeIdCount}`'s own `ArithmeticOperator`/`ObjectLiteral` mutants are ordinary, per-test-killable mutants, confirmed killed by the existing exact-sentinel-count assertions.

**Enumeration follow-up (not user-flagged, found during the audit's own empirical verification pass):** two directives the audit did NOT name were also found broad-but-wrong once every remaining directive was individually re-verified by manually applying each mutant variant and re-running the suite (the same discipline the audit applied to its seven). `runPromotionScan`'s `missingNodeIdCount` had its own `ConditionalExpression`-on-`||`-predicate directive covering FOUR distinct mutants at one line (whole-expression forced true/false, each operand forced false individually) while the reason argued only one; rather than re-argue the other three, the duplicate predicate was deleted and `missingNodeIdCount` is now computed by subtraction against the same `hasNonEmptyNodeId`-filtered array `runPromotionCli` already used this pattern for. Separately, the `validCandidates[0] === undefined` defensive throw guard's `ConditionalExpression` directive covered a `true` variant that, when manually applied, broke 52 tests (every successful PR validation would throw the internal-error message) — not equivalent at all. Fixed by removing the runtime guard and using a non-null assertion (`validCandidates[0]!`, `eslint-disable-next-line @typescript-eslint/no-non-null-assertion`, matching the one existing precedent for this pattern in `scripts/status-truth-proposals.ts:2116`) instead of a directive-chaperoned `if`/`throw` — the invariant is airtight (the preceding `.length !== 1` throw already guarantees it) but not provable to `noUncheckedIndexedAccess`, so the assertion is the correct tool, not a runtime branch with no reachable input.

**Verification discipline used throughout this audit:** for every directive kept or newly written, each named mutator's variant was applied to the source BY HAND (not just read about) and the full `check-private-leak.test.ts` suite re-run before restoring — a directive was only kept when every variant it names produced zero test failures. This caught both the two additional bugs above that the user's audit list didn't name.

**PR #3841 review findings (2 blocking, both correct, plus 1 missing test and 1 stale doc):**
1. **Blocking — `isGh404Error`'s fallback line carried two `StringLiteral` nodes under one directive.** The pass-3 ternary `isRecord(error) && typeof error.stdout === 'string' ? error.stdout : ''` put the `'string'` typeof-comparison literal and the `''` fallback literal on the SAME line; naming `StringLiteral` in a `disable next-line` directive swept BOTH, including the `'string'` literal, which is genuinely killable (confirmed: mutating `'string'` to `''` breaks 11 tests). This was the source of the 16-vs-14-ish discrepancy the reviewer flagged. Fixed by isolating the fallback onto its own `stringFieldOrEmpty(error, key)` helper: `if (typeof value === 'string') return value` carries zero directives (its own `'string'` literal is now alone on its line and killable, confirmed), and only the trailing `return ''` carries the fallback directive. Reviewed every other directive line in the file for the same species (a directive line with more than one node of the named mutator) — none found; the BooleanLiteral/ObjectLiteral directive on the promotion-mode override object legitimately has two `BooleanLiteral` nodes (`titlePrefixed: false`, `isOperator: false`) but the existing reasoning already argues flipping EITHER one alone, individually re-verified for all three variants (`titlePrefixed: true`, `isOperator: true`, `{}`).
2. **Blocking — plan doc's Class-1 enumeration named the wrong arrays.** It said `privateTokens` in `main()` and `resolvedNames`; the actual `ArrayDeclaration` directives are on `pullRequests` (line 258, argued via `isRecord()` filtering in `extractNumbers`) and `resolvedNames` (line 814, argued via `buildPrivateNameTokens` requiring `/`). Corrected below.
3. **Missing test — the empty-`node_id` schema invariant `hasNonEmptyNodeId` depends on.** `hasNonEmptyNodeId`'s tautological-length-check deletion (pass 3, finding 2) relies on `assertRepoEntry` (`packages/wiki-write-core/src/schemas.ts:295-296`) rejecting `node_id: ""` before any entry reaches the filter — and `schemas.ts` is `not-mutated`, so nothing in the suite pinned that exact input directly. Added a `runPromotionScan` test feeding `private: true, node_id: ""` and asserting the run rejects with the schema's own message (`/node_id.*expected non-empty string or omitted/`), proving the invariant `hasNonEmptyNodeId`'s reasoning depends on actually holds.
4. **Stale doc — `docs/solutions/best-practices/size-subprocess-buffers-selectively-at-call-sites-2026-08-31.md:90,95`.** Presented `export const LARGE_OUTPUT_MAX_BUFFER_BYTES = ...` as the pattern — the exact top-level-const shape pass 3 identified as an unkillable static mutant. Updated to the function form the file now uses (`largeOutputMaxBufferBytes()`), with a one-sentence note on why (module-level const initializers run once per Stryker worker process, not per call; a function body is re-evaluated per call).

**Final directive count by reason class (13 total, each covering every variant its named mutator(s) generate; empirically re-verified across passes 3 and 4):**
1. **Unobservable fallback/seed value (3):** `isGh404Error`'s `''` string fallback (isolated onto a dedicated `stringFieldOrEmpty` helper so the fallback's `StringLiteral` directive doesn't also sweep the co-located, killable `'string'` typeof-comparison literal — observed only through two fixed regexes that never match the Stryker placeholder text) plus two `ArrayDeclaration` seed-pollution guards — `pullRequests` in `main()`'s `readWorkflowRunContext` (a non-record placeholder element fails `isRecord()` in `extractNumbers`, yielding the same zero-candidates outcome as the real `[]` fallback) and `resolvedNames: string[] = []` in `runPromotionScan` (seeded with `['Stryker was here']` contributes zero scan tokens because `buildPrivateNameTokens` requires a `/` the seed text lacks).
2. **Redundant downstream duplicate-check (1):** `fetchPrsByHeadSha`'s `.filter(isRecord)` — kept for the exported `PrApiResolver` interface's type contract (not deleted, since other implementations/callers may rely on the declared return type), but unobservable through this repo's own call site because `extractNumbers` re-applies the identical `isRecord` predicate.
3. **Single-variant/no-override boolean (3 mutants, 1 directive line):** the promotion path's `checkPrivateLeak(privateTokens, diff, {titlePrefixed: false, isOperator: false})` call carries two `BooleanLiteral` mutants (one per `false`) plus one `ObjectLiteral` mutant (the whole object to `{}`) — no override is ever offered on the operator-supervised scheduled path, so flipping either boolean alone, or emptying the object, cannot change the no-override outcome. All three variants individually re-verified.
4. **Operator-facing diagnostic prose (6 mutants, 3 directive lines):** the three remediation-instruction `process.stderr.write` calls at the end of the PR-diff detection path (`GH_TOKEN=<operator-PAT> node scripts/resolve-private.ts ...`, the node_id table note, the bypass instructions) each carry one `StringLiteral` and one `CallExpression` mutant — human-readable only, not parsed, not asserted, does not affect classification/exit status/redaction.

**Classes eliminated entirely by this audit (were 3 classes, 9 directives, in pass 2 — now 0):** "unreachable-by-construction defensive invariant" and "type-contract exhaustiveness" (both replaced by TypeScript narrowing / restructuring rather than runtime checks) and "deterministic-hang prevention" (replaced by an induction-variable-free loop). None of these code shapes exist in the source anymore, so none carry mutant surface to directive.

**Seams added/extended (following the file's existing injected-optional-param pattern, no second pattern introduced):** none new this pass — the seam surface (`workflowRunReader`, `prApiResolver`, `dataBranchChecker`, `mainReposYamlReader` on `main()`; `gitDiffRunner`, `reposYamlReader`, `resolverFactory` on `runPromotionCli()`) was already complete from earlier work. What was missing was *tests that drive the uninjected default path* — closed with dedicated "default seam coverage" test groups for both `main()` and `runPromotionCli()` that call the functions with zero/partial arguments and assert on defaults-only side effects (e.g. `defaultWorkflowRunReader` asserts `mockReadFile` was called with `'utf8'`; `defaultDataBranchChecker` gets both a 404-fallback test and a non-404-rethrow test; `defaultPrApiResolver.fetchPrsByHeadSha` gets a non-array-throws test).

**Restructures + neutrality proofs (audit pass, 6 total — supersedes pass 2's 2):**
1. `hasNonEmptyNodeId` converted from a plain boolean predicate to a real TypeScript type guard (`r is T & {node_id: string}`, generic over `T extends Pick<RepoEntry, 'node_id'>`), removing the `.map(r => r.node_id as string)` cast at all three call sites — neutral because every call site's runtime behavior is unchanged; only the compile-time narrowing changes, closing the gap that made the old `ConditionalExpression` mutant on this function a genuine bug rather than equivalent code.
2. `hasNonEmptyNodeId`'s body split across two statements (`if (typeof r.node_id !== 'string') return false` then, after deleting the tautological length check, `return true`) — neutral because the observable return value is identical for every input the schema invariant permits; the split exists so each remaining mutant is on its own line (Stryker's directive is line-scoped), and the length check's own mutant surface was eliminated by deletion rather than moved.
3. `runPromotionScan`'s `missingNodeIdCount` changed from a second, independently-worded filter predicate (`typeof r.node_id !== 'string' || r.node_id.length === 0`) to subtraction against the same `hasNonEmptyNodeId`-filtered `privateNodeIds` array (`privateEntries.length - privateNodeIds.length`) — neutral because both formulations partition the same `privateEntries` array by the same underlying condition; subtraction against a single source of truth cannot disagree with itself the way two independently-mutable predicates can.
4. `readWorkflowRunContext`'s `prNum` PR-number extraction: the runtime `if (prNum === undefined) throw ...` guard replaced with a non-null assertion (`validCandidates[0]!`) — neutral because the guard's `false` branch (never throw) was already the only reachable outcome; `validCandidates.length !== 1` throws earlier in the same block, so `validCandidates[0]` is always defined at this point, a fact `noUncheckedIndexedAccess` cannot see but the assertion states directly instead of via an unreachable runtime branch.
5. `GuardResult`/`PromotionScanResult` narrowing: three redundant conjuncts (`!scanResult.ok && 'matchedFiles' in scanResult`; `'resolutionFailed' in result && result.resolutionFailed`; a trailing `if ('matchedFiles' in result)` after two prior early returns) deleted down to the minimal check TypeScript's own discriminated-union narrowing needs — neutral, confirmed via `tsc --noEmit`: removing each redundant half compiles clean with no narrowing lost, meaning the deleted mutants never existed as reachable branches in the first place.
6. The missing-node-id sentinel-seeding `for` loop replaced with `Array.from({length: missingNodeIdCount}, () => '<missing-node-id>')` — neutral (same output array, same order, same values) and removes the induction variable that made the loop's own mutants a deterministic hang instead of an ordinary killable mutant.

**Line-1206 self-invoke-guard root cause (resolved, no longer a survivor):** the guard (`import.meta.url === \`file://${process.argv[1]}\``) was fully covered by three dedicated tests already present from the WIP pass's later work, not written in this session: each dynamically re-imports the module with a cache-busting query string (`?guard-test-main`, `?guard-test-promotion`, `?guard-test-noop`) after setting `process.argv = [node, modulePath.pathname, ...]` to force the guard's condition to actually evaluate `true` for the *real* code (every other test in the file imports the module without ever matching `process.argv[1]`, which only trivially covers the `false` branch identically for every mutant). The `--promotion` branch and the plain-`main()` branch are each asserted via their own unmistakable failure-message signature (`FRO_BOT_POLL_PAT not set. This is required for promotion mode` vs `GITHUB_EVENT_PATH not set`), and a fourth non-matching-argv test proves the guard does NOT fire when `process.argv[1]` differs. `check-wiki-authority.ts`'s structurally identical guard was never actually compared line-by-line because it was unnecessary: this file's guard is 100% killed via the mechanism above, not via a directive.

Gate for pass 3 (`11da178`): `pnpm exec eslint --fix scripts/check-private-leak.ts scripts/check-private-leak.test.ts` (clean, including the `no-non-null-assertion` warning on the new `validCandidates[0]!` suppressed with a scoped `eslint-disable-next-line`, matching existing repo precedent); `pnpm check-types` (clean); `pnpm lint` (clean); `pnpm test` (75 files, 3177 tests + 3 todo, up from 3176+3); `pnpm exec vitest run scripts/mutation-guards-config.test.ts` (26/26). Live `pnpm check:mutation-guards` full run confirmed `check-private-leak.ts` at 100.00%/100.00%, 574/0/0/0/0 in the per-file table.

Gate for the PR-review pass (final): same sequence, re-run clean; `pnpm test` 75 files, 3178 tests + 3 todo (up from 3177+3); `pnpm exec vitest run scripts/mutation-guards-config.test.ts` 26/26. Live `pnpm check:mutation-guards` full run confirms `check-private-leak.ts` at 100.00%/100.00%, 571/0/0/0/0 (Killed/Survived/NoCoverage/Timeout/Errors) in the per-file table. Overall verdict remains `mutant-timeout` as expected (`corrections-survival.ts`'s timeouts and the other unfinished modules — `wiki-context-safety.ts`, `wiki-lockfile-gates.ts`, `check-wiki-private-presence.ts` — are untouched by this PR and still report Survived/NoCoverage mutants; Unit 5A-2 scoped this pass to `check-private-leak.ts` only).

- [ ] **Unit 6: Register the required context and document the check**

**Goal:** Make `Check Mutation Guards` a required status on `main`, and document the verification command and the exception rule.

**Requirements:** R7, R12

**Dependencies:** Unit 5A and 5B both `clean` on `main` (whether 5B is formally cut, rather than deferred, is decided after 5A's measured cost). Operator approval for the branch-protection change.

**Files:**
- Modify: `.github/settings.yml` (add `Check Mutation Guards` to `required_status_checks.contexts`)
- Modify: `.github/copilot-instructions.md` (verification commands: add `pnpm check:mutation-guards` under the "if you touched gate code" guidance; one paragraph on the directive rule)
- Modify: `README.md` if it lists CI checks
- Test: the existing settings/required-context test if one asserts the context list, else `scripts/main-workflow.test.ts` asserting the job name equals the settings context string byte-for-byte

**Approach:**
- The context string is the job `name:` from Unit 4, unchanged.
- After the settings workflow applies, confirm the check appears in the branch-protection required list via the `Update Repo Settings` run, not by assumption.

**Test scenarios:**
- Happy path: settings context equals the workflow job name exactly.
- Integration: a pull request that changes nothing in the trigger set still merges (job reports `not-applicable` and the required context is satisfied).

**Verification:**
- `Update Repo Settings` run succeeds after merge; a subsequent unrelated pull request shows `Check Mutation Guards` as a satisfied required check.

## System-Wide Impact

- **Interaction graph:** `Main` gains one job; `Test Scripts Load` imports one more script (inert on import); `pnpm test` gains three test files (`check-mutation-guards`, `mutation-guards-config`, `main-workflow`). Renovate pull requests now run the mutation job whenever they touch `package.json` or the lockfile. No runtime script behavior changes.
- **Error propagation:** all failing verdicts exit 1 with the verdict as the last stdout line and in the step summary, listing every mutant in every failing class; the workflow surfaces it as a failed required check with a locatable list.
- **State lifecycle risks:** Stryker's sandbox (`.stryker-tmp/`) and report directory (`reports/`) are gitignored, and must also be excluded from `pnpm coverage`'s include globs, ESLint's file set, and any CodeQL path config so the sandbox copy is never linted, covered, or scanned as source. A mutant of `build-wiki-write-core.ts` that runs a build does so inside the sandbox copy, not the working tree (verified in Unit 1's deferred item).
- **Build invariant:** `scripts/` tests resolve the package through committed `dist/`, and Stryker invokes Vitest directly without the `pnpm build` step that `pnpm test` runs first. The mutation run therefore assumes `dist/ == build(src)`. That assumption is enforced independently on every pull request by the required `Check Wiki Write Core Dist` job; the mutation job does not rebuild and does not need to.
- **API surface parity:** none — no exported package surface changes. `stryker.config.json` becomes a build-verified artifact via Unit 3's tests.
- **Integration coverage:** Unit 1 proves the loader path in CI; Unit 4's docs-only and gate-touching pull requests prove both branches of the trigger; Unit 6's post-merge unrelated pull request proves the required context resolves.
- **Unchanged invariants:** hand-written mutation proofs remain; `regex-redos-regressions.test.ts` remains the sole detector for complexity regressions; the `Check Wiki Write Core Dist` drift check is untouched; `dist/` stays the import target for `scripts/`; the pure-core-behind-thin-shell shape of every `scripts/check-*.ts` is unchanged (no logic moves).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Stryker's re-emitted TypeScript uses syntax Node's strip-only loader rejects | Unit 1 exists to find this first; a failure there halts the plan for revision, not a workaround. |
| Package mutants paired with scripts tests → green while blind | Same-tree pairing decision plus Unit 3's cross-tree test; Unit 1's discrimination run proves a package mutant is killed. |
| Directive scanner more permissive than Stryker's parser → silent bypass | Reasons enforced from the report (Stryker's parser); scope enforced by a conservative textual ban that fails on anything not `next-line`. |
| New gate module silently outside the set | Unit 3's enumeration test fails `pnpm test` on any unlisted match. |
| Renovate pull requests pay single-digit minutes per bump | Accepted; toolchain bumps are exactly when the check can go blind. Narrowing deferred until cost is observed. |
| Flaky timeouts under contention (the #3818 class) | `Timeout` is its own verdict, never counted as killed or survived; timeouts calibrated from the spike, not guessed. |
| Shell `main()` mutants report `NoCoverage` and the baseline stalls | Two named resolutions in Unit 5 (assembled-flow test via the existing injected-seam pattern, or `not-mutated` naming the core); per-line directives over a shell are ruled out. |
| Sandbox copy linted, covered, or scanned as source | `.stryker-tmp/` and `reports/` excluded from `.gitignore`, coverage globs, ESLint, and CodeQL in Unit 1/2. |
| A test reads its subject's source text and breaks under instrumentation | Seen once in the spike. Such tests must match structurally (whitespace-tolerant), never byte-exact; Unit 5 treats a dry-run failure of this shape as a test fix, not a directive. |
| Required context string drifts from job name | Unit 6 test asserts byte equality; the learnings doc on quoted contexts is cited in the unit. |
| Exceptions accrete into a threshold by another name | Every directive carries a reviewable reason and sits on the excused line; Unit 5 prefers test fixes over directives. |
| Timeouts calibrated from a fast machine | Derive from CI-observed runtime with headroom; `Timeout` is its own failing verdict. |
| A regex literal's Regex-mutator variant is itself syntactically invalid, and Stryker embeds every mutant of a regex literal as a literal alternative in a ternary chain (not a string compiled later) — one invalid variant fails to *parse*, at load time, independent of which mutant is active. Confirmed on `packages/wiki-write-core/src/wiki-ingest.ts:706`: the instrumented sandbox turns `\v` into `\V` inside a character class (`Invalid regular expression: ... Invalid escape`), which is not a valid RegExp escape. Because Vite's dependency scan processes every requested mutate-set file together, this silently zeroes test collection for *every* test file in that run, not only ones that import the broken module — this is what produced Unit 3's corrections.ts/corrections-survival.ts coverage loss once `wiki-ingest.ts` entered `mutate`. **Two distinct observable signatures, not one**, both reproduced live: (1) **scoped repro** (`mutate: [corrections.ts, wiki-ingest.ts]`, `testFiles: [corrections.test.ts]`) — zero tests collected, Vitest throws `ConfigError('No tests were executed...')`, **no report file is written at all**; the wrapper's existing "report file missing → `instrumentation-failed`, never `clean`" rule (Unit 2) already covers this correctly. (2) **full-run repro** (the real 12-entry `mutate`/`testFiles` config plus `wiki-ingest.ts`, all other entries unchanged) — Stryker does **not** throw and **does** write a complete, well-formed report (5130 mutants): the three test files whose sole coverage import reached `wiki-ingest.ts` (`corrections.test.ts`, `corrections-survival.test.ts`, `wiki-write-core.test.ts`) are silently absent from the dry run's test collection while every other configured test file loads normally — `--logLevel debug` shows "Initial test run succeeded. Ran 316 tests" with no error or warning naming the drop, and the report's top-level `testFiles` map simply omits the three dropped keys rather than listing them with zero tests. This second shape read as `mutants-uncovered` (`corrections.ts` 553/553, `corrections-survival.ts` 183/183 `NoCoverage`) — a legitimate-looking failing verdict, not the tool failure it actually was, and Unit 2's report-missing rule never fires because a report *was* written. | Signature 1 is not a config error and needs no wrapper change — confirmed by the scoped repro above; adding a temporary `// Stryker disable next-line Regex` directive on wiki-ingest.ts:706 restored normal collection (15 tests) in that scoped run. Signature 2 **is** a wrapper gap, now closed: `classifyMutationReport` takes a `configuredTestFiles` param and fails closed with `instrumentation-failed` (sentinel `TestFileNotExecuted`) whenever a configured `vitest.testFiles` entry is absent from the report's `testFiles` map or present with zero tests — proven red→green against `scripts/check-mutation-guards.test.ts` and reproduced end to end through the real wrapper (`runMutationGuardCheck` machinery) against the full-run repro report, which now correctly verdicts `instrumentation-failed` naming all three dropped test files, instead of the `mutants-uncovered` it produced before this fix. This is why `wiki-ingest.ts` stays `not-mutated`, not merely for the dist/relocation reason: Unit 5, when relocating its test and flipping it to `mutate`, must also add a permanent `// Stryker disable next-line Regex` directive (with a reason) on this line, or Stryker must ship a fix upstream, before this file can safely enter `mutate`. |

## Documentation / Operational Notes

- Two operator gates inside this plan: the devDependency/lockfile change (Unit 1) and the branch-protection change (Unit 6). Neither lands without explicit approval.
- After Unit 6, write the `docs/solutions/` learning for the vacuous-counterexample class (deferred above).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-09-04-counterexample-proven-guards-requirements.md](../brainstorms/2026-09-04-counterexample-proven-guards-requirements.md)
- Ideation: `docs/ideation/2026-09-04-open-ideation.md` (idea 1; rejected alternatives)
- Related code: `.github/workflows/main.yaml`, `scripts/check-private-leak.ts`, `scripts/build-wiki-write-core.ts`, `.github/settings.yml`, `vitest.config.ts`
- Related PRs: #3810 (removed two non-discriminating guards), #3813 (fixture that could not fail), #3818 (timing-guard deflake)
- External docs: https://stryker-mutator.io/docs/stryker-js/configuration/ · https://stryker-mutator.io/docs/stryker-js/vitest-runner/ · https://stryker-mutator.io/docs/stryker-js/disable-mutants/
