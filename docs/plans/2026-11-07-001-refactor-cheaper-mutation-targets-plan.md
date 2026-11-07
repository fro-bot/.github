---
title: "refactor: Make the four slowest mutation targets cheap"
type: refactor
status: active
date: 2026-11-07
origin: docs/brainstorms/2026-11-07-cheaper-mutation-gate-requirements.md
---

# refactor: Make the four slowest mutation targets cheap

## Overview

Four `mutate` targets account for 66% of summed mutant time in `Check Mutation Guards`. Two are slow because code runs at module load and makes their mutants static. Two are slow because their tests run real processes. This plan fixes each target at its cause: module-level work becomes lazy, and process spawning and config resolution get injectable seams. Every mutant keeps a fast, direct killer, and the gate's verdict rules and trigger behaviour stay as they are (see origin: `docs/brainstorms/2026-11-07-cheaper-mutation-gate-requirements.md`).

## Problem Frame

Full mutation runs take a median of 949 s and a p90 of 1165 s against the job's 1200 s cap. Renovate is 36 of the 48 applicable runs, and those always run in full, so per-target speed is the lever that helps every run. In run 42392597566 the measured causes were:

- **`packages/ci-checks/src/repository-root.ts`:** 4 static mutants, 36–40 s each. `check-mutation-guards.ts` calls `findRepositoryRoot()` at module load (`:12-15`), and so does `mutation-guards-reach.test.ts:25`.
- **`scripts/wiki-lockfile-gates.ts`:** the module-level self-invoke guard (`:497`) carries 5 mutants, 4 of them static at 38–42 s each. Importing the file in its test evaluates the guard.
- **`packages/wiki-ops/src/route-stderr.ts`:** 8 mutants in `runCommand` (`:166-188`) hang their first test until Vitest's 10 s `testTimeout` (about 80 s total), and a ninth takes about 12 s. Validation mutants are killed only by tests that run after about 44 real-process tests (about 53 s total).
- **`scripts/build-wiki-write-core.ts`:** every `runBuild` test runs real `bunx tsc --showConfig` through `computeSourceTreeHash`. Mutants that swap a seam default (`?? → &&`) run real builds and `npm pack`.

None of these mutants times out today. Static mutants run against every covering test, in an order that depends on scheduling, so their cost cannot be reproduced locally.

## Requirements Trace

- R1. Full-run p90 ≤ 700 s, nearest rank over at least 10 completed applicable PR runs after merge (Unit 5).
- R2. Each target gets cheaper through test changes or source restructuring (Units 1–4).
- R3. The logic of all four targets stays in `mutate`. No new `Stryker disable` directive, and `ignoreStatic` stays off (Units 1–4). Amendment: the lockfile entry guard leaves `mutate` with the shim, because spawned entrypoint tests are not in-process coverage and its mutants would report NoCoverage.
- R4. Each target keeps a 100% kill rate (Units 1–4, verified in Unit 5).
- R5. Runtime behaviour is unchanged for callers, including CLI exit codes, output and self-invoke. The one intended change is that an entrypoint path the URL form escapes (a space, `#` or `%`) now runs (Unit 2). Export shape changes are listed under System-Wide Impact.
- R6. Trigger set, verdict rules and full-run behaviour are unchanged (Units 1, 2).

## Scope Boundaries

- No change to the gate's verdict rules, applicability rules, Stryker configuration other than the lockfile `mutate` path, or `main.yaml`.
- No speedups for other targets.
- The existing `Stryker disable` directive on the `build-wiki-write-core.ts` entry guard (`:633`) stays as it is.

### Deferred to Separate Tasks

- Scoping PR runs to reached targets, a full run on `main`, and a failure issue: revisit only if R1 is missed after this plan lands (see origin).

## Context & Research

### Relevant Code and Patterns

- Entry shims: six-line `scripts/<name>.ts` files that import `main` and guard on `import.meta.main`. `scripts/check-mutation-guards.ts` and `scripts/knowledge-mcp.ts` are registered `not-mutated` in `mutation-guards.json` with a reason. The lockfile shim must be registered too, because `mutation-guards-config.test.ts` Test 2 name-matches `wiki-*-gates.ts`.
- Shim parity tests spawn the real entrypoint with `@fro-bot/test-kit/spawn-entrypoint` and live outside `testFiles` (`scripts/registry-entrypoints.test.ts`, `scripts/privacy-entrypoints.test.ts`). `scripts/registry-entrypoints.test.ts:331-370` is the "importing a shim runs nothing" harness.
- Seams: options-object injection on `runBuild` (`runTypeScriptBuild`, `verifyPackage`, `write`), the `{spawn}` option of `resolveBuildConfig` in `scripts/build-wiki-write-core.ts`, the existing `resolvedBuildConfig` option of `computeSourceTreeHash`, and the default-parameter seam `runBunAudit(exec = execFileSync)` in `packages/ci-checks/src/check-override-floors.ts`.
- `vi.hoisted` + `vi.mock('node:child_process')` as a default-deny guard: `packages/ci-checks/src/check-mutation-guards-cli.test.ts:12-13`, `packages/core/src/wiki-authority.test.ts:17-21`.

### Institutional Learnings

- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`: module-level initializers make mutants static; keep mutation-sensitive values behind functions; tests import the mutated module by relative path; a timeout fails the gate.
- `docs/solutions/best-practices/moving-a-script-into-a-workspace-package-changes-its-contract-2026-11-05.md`: capture parity before restructuring; shims use `import.meta.main`, because the `file://${argv[1]}` comparison is false for escaped paths.
- `docs/plans/2026-10-19-001-refactor-mutation-guards-reach-module-plan.md` (recorded complete): a module-level regex constant cost about 4 extra minutes in static mutants; shared Stryker workers can collide on disk fixtures.
- Stryker mutants of file-system code that take paths from argv once deleted a real Node binary. Build code must not read argv outside its entry guard (project memory).

## Prior-Art Survey

```json
{
  "schema_version": 2,
  "verdict": "extend",
  "scope": "root workspace: scripts/, packages/{ci-checks,wiki-ops,test-kit,core,privacy,registry}/src, stryker.config.json, mutation-guards.json",
  "freshness": {
    "vcs_reference": "3e69886432ac401cb39a924f1fe224d5d4bfa08d"
  },
  "budget": {
    "max_search_passes": 6,
    "max_candidate_inspections": 20,
    "exhausted": false
  },
  "candidates": [
    {
      "path_or_symbol": "scripts/check-mutation-guards.ts, scripts/route-stderr.ts, scripts/knowledge-mcp.ts",
      "description": "import.meta.main entry shims over a separately mutated module",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "mutation-guards.json not-mutated shim entries",
      "description": "registration precedent for an unmutated shim with a reason",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "@fro-bot/test-kit/spawn-entrypoint",
      "description": "child-process parity runner for shims",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/registry-entrypoints.test.ts",
      "description": "importing a shim runs nothing harness",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "scripts/build-wiki-write-core.ts RunBuildOptions seams",
      "description": "injectable build seams; config resolution lacks one on the runBuild path",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/ci-checks/src/check-override-floors.ts runBunAudit",
      "description": "default-parameter process seam",
      "disposition": "reuse"
    },
    {
      "path_or_symbol": "packages/wiki-ops/src/route-stderr.ts runCommand",
      "description": "private spawn wrapper with no seam",
      "disposition": "extend"
    },
    {
      "path_or_symbol": "packages/ci-checks/src/check-mutation-guards.ts module-level paths",
      "description": "repository root and derived paths computed at module load",
      "disposition": "extend"
    }
  ]
}
```

## Key Technical Decisions

- **Lazy root lookup, no new module.** `check-mutation-guards.ts` exposes `strykerConfigPath()` and `mutationReportPath()` as functions, and the reach test resolves the root inside its helper. Only the gate and its tests use the two exports.
- **The lockfile logic moves to `scripts/wiki-lockfile-gates-core.ts`.** `scripts/wiki-lockfile-gates.ts` becomes a shim that imports `main` and runs it under `import.meta.main`, with no re-exports. Its one test importer moves to the core module. The `mutate` entry moves to the core path. The shim goes into `mutation-guards.json` as `not-mutated`, and into `FIXED_TRIGGER_FILES`, so a shim-only PR still runs the full gate. The core stays a relative sibling import because `publish-wiki.yaml` runs the script with `bun --no-install` before dependencies are installed.
- **The guard predicate is no longer mutated.** Its five mutants go with it. Spawned entrypoint tests pin the entry behaviour, as with the other shims. This is the recorded amendment to R3.
- **`import.meta.main` fixes a silent no-op.** A path the URL form escapes (a space, `#` or `%`) used to exit 0 without running. This is the only intended behaviour change.
- **`runCommand` is exported with a default `spawn` parameter.** Fake-child tests import it by relative path. `runRouteStderr`, `RouteStderrIo` and the CLI are unchanged. The fake-child and validation tests run before the real-process tests, so hang and validation mutants die in the first tests. Real-process tests stay as the killers for stdio, environment, cwd, signal and exit-code behaviour.
- **`runBuild` forwards the existing `resolvedBuildConfig` option to `computeSourceTreeHash`.** No new option is added, so nothing shadows the exported `resolveBuildConfig`. The fixture passes a config, and a distinguishable-config test proves it reaches the hash. Build code still reads no argv or environment outside the entry guard.
- **Each seam default needs a killing test.** For every `?? default` on a seam path, the first test that covers it asserts the injected value was used. A default-swap mutant then runs at most one real tool call before it is killed.
- **R1 is proven after merge.** Summed mutant duration does not translate into wall-clock time, so pre-merge evidence is predictive only.

## Open Questions

### Resolved During Planning

- Lockfile shim exports: none. The test imports the core module.
- Seam for the router: an exported `runCommand` with a default `spawn`, the seam the prototype used (214 of 214 killed). An `io.spawn` field is not needed.
- Where the lockfile logic lives: in `scripts/`, not a package, so it still runs without installed dependencies.

### Deferred to Implementation

- Who kills the `repository-root` mutants once they stop being static. In the baseline, `knowledge-mcp.test.ts` killed one and the reach tests killed three, while `repository-root.test.ts` only covered them. A local run without `knowledge-mcp.test.ts` still killed all four, but that is unverified in CI. Unit 1 records the killers.
- Whether `build-wiki-write-core` needs the default-deny `node:child_process` mock after the seam. Add it only if default-swap mutants still run real tools in the after report.
- The exact fake-child timeout. Start from 500 ms; widen it if repeated loaded runs flake.

## Implementation Units

- [ ] **Unit 1: Lazy repository root in the mutation gate**

**Goal:** Remove the module-load calls of `findRepositoryRoot()` so its mutants are no longer static.

**Requirements:** R2, R3, R4, R6

**Dependencies:** None

**Files:**

- Modify: `packages/ci-checks/src/check-mutation-guards.ts`
- Modify: `packages/ci-checks/src/check-mutation-guards.test.ts`
- Modify: `packages/ci-checks/src/mutation-guards-reach.test.ts`
- Test: `packages/ci-checks/src/repository-root.test.ts` (existing, unchanged)

**Approach:**

- Replace the module-level root binding and the two path constants with functions. Every use of the root, `strykerConfigPath` and `mutationReportPath` becomes a call, including default parameters.
- Update the two test files the same way: every value read of the two exports becomes a call, including the reach test's reads at `:418` and `:427`. Move the reach test's root lookup inside `toRepoRelative`.
- `check-mutation-guards.test.ts:1666` and `mutation-guards-config.test.ts:15` are outside `testFiles` and stay as they are.

**Patterns to follow:** the "function, not a module-level const" comments in `repository-root.ts` and `check-mutation-guards-cli.ts`.

**Test scenarios:**

- Happy path: `strykerConfigPath()` and `mutationReportPath()` return absolute paths under the repository root.
- Happy path: the report-path override behaviour (`check-mutation-guards.test.ts:1461-1492`) is unchanged.
- Integration: a Stryker run on `repository-root.ts` reports its 4 mutants as non-static and `Killed`, with each mutant's `killedBy` recorded.
- Integration: if a mutant's only killer is `knowledge-mcp.test.ts`, add a direct assertion in `repository-root.test.ts` that kills it.

**Verification:** The after report shows no static mutants in `repository-root.ts`, 4 of 4 killed with named killers, and the gate's own tests pass.

- [ ] **Unit 2: Split the lockfile gate into core and shim**

**Goal:** Move the lockfile gate's logic out of the entry file so that no mutated code runs at module load.

**Requirements:** R2, R3, R4, R5, R6

**Dependencies:** None

**Files:**

- Create: `scripts/wiki-lockfile-gates-core.ts`
- Modify: `scripts/wiki-lockfile-gates.ts` (becomes the shim)
- Modify: `scripts/wiki-lockfile-gates.test.ts` (imports the core module)
- Create: `scripts/wiki-lockfile-gates-entrypoint.test.ts` (not in `testFiles`)
- Modify: `stryker.config.json` (`mutate` path)
- Modify: `mutation-guards.json` (shim `not-mutated` entry with a reason)
- Modify: `packages/ci-checks/src/check-mutation-guards.ts` (`FIXED_TRIGGER_FILES` gains the shim)
- Modify: `packages/ci-checks/src/check-mutation-guards.test.ts` (trigger test for the shim)
- Modify: `.github/copilot-instructions.md` (the `scripts/` contract sentence gains `wiki-lockfile-gates-core.ts` and the reason: `publish-wiki.yaml` runs the gate before dependencies are installed)
- Modify: `README.md` (the `scripts/` container description) and `docs/solutions/workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md` (the file reference)

**Approach:**

- The core module exports everything the file exports today, plus `main`. The shim imports only `main`.
- The two direct `main()` tests call the exported `main` with the existing argv, cwd, stdout and exit spies, and no cache-busting reimport.
- The positive-control self-invoke test moves to the entrypoint test, which spawns the shim.

**Execution note:** Capture the shim's current CLI behaviour (each mode, exit codes, stdout and stderr) before the split, and assert the same after it.

**Patterns to follow:** `scripts/check-mutation-guards.ts` (shim), `scripts/registry-entrypoints.test.ts` (spawned parity and import-runs-nothing), `symlinkRepoYamlInto` in `scripts/wiki-lockfile-gates.test.ts` (cwd-local `yaml`).

**Test scenarios:**

- Happy path: spawning the shim as `bun --no-install --no-env-file <path> coverage` from a foreign cwd with a cwd-local `yaml` succeeds with the same stdout as today. The same holds for `integrity`.
- Error path: an unknown mode, no mode or extra argv exits 2 with today's message. A rejected lockfile exits 1. A missing or malformed input, or missing `yaml`, exits 2.
- Edge case: a shim path containing a space, `#` or `%` runs the gate, with the core module copied beside the shim in the fixture. This is the intended change; today it exits 0 without running.
- Edge case: importing the shim under Node and under Bun runs nothing and leaves the exit code unset.
- Integration: a PR changing only `scripts/wiki-lockfile-gates.ts` is applicable to the mutation gate. A PR changing only an unrelated doc stays `not-applicable`.
- Integration: the core module's mutants are all `Killed`, none static, and `main()`'s branches are killed by the direct tests.

**Verification:** `mutation-guards-config.test.ts` accepts the new layout. The Node strip-only loop in Test Scripts Load imports both files. The after report has no static mutants in the core module.

- [ ] **Unit 3: Spawn seam and test order for the router**

**Goal:** Make `route-stderr` mutants that hang, or that only late tests kill, fail in its first fast tests.

**Requirements:** R2, R4, R5

**Dependencies:** None

**Files:**

- Modify: `packages/wiki-ops/src/route-stderr.ts`
- Modify: `packages/wiki-ops/src/route-stderr.test.ts`

**Approach:**

- Export `runCommand` with a `spawn` parameter defaulting to the real `spawn`. `runRouteStderr` and the CLI call it unchanged. The fake-child tests import `runCommand` by relative path.
- A fake-child group runs first, with a short per-test timeout. Next come the usage and conflict-validation groups. The real-process tests run last and keep the default timeout.

**Execution note:** Write the fake-child tests first and confirm each fails against the corresponding hand mutation before relying on it.

**Patterns to follow:** `runBunAudit(exec = execFileSync)` in `packages/ci-checks/src/check-override-floors.ts`.

**Test scenarios:**

- Happy path: the fake receives the command, args, environment and stdio settings. `data` then `close` yields the exit code and the captured stderr.
- Edge case: `close` with a signal yields 128 plus the signal number. `error` then `close` keeps the first outcome.
- Error path: `error` with `ENOENT` yields 127, and `EACCES` yields 126, each with the fixed line that does not name the command. A spawn that throws synchronously yields 126.
- Integration: the existing real-process tests for stdio identity, environment, cwd, PATH, large stderr, signals and exit codes still pass.
- Integration: the default spawn is the real one. A test that runs a real child through `runRouteStderr` passes without injecting anything.

**Verification:** The after report shows 214 of 214 killed, no mutant waiting out the 10 s timeout, and the route-stderr CLI parity tests unchanged.

- [ ] **Unit 4: Config-resolution seam for the build script**

**Goal:** Stop `runBuild` tests from running real `tsc --showConfig`, and make seam default swaps fail before real tools run.

**Requirements:** R2, R4, R5

**Dependencies:** None

**Files:**

- Modify: `scripts/build-wiki-write-core.ts`
- Modify: `scripts/build-wiki-write-core.test.ts`

**Approach:**

- `RunBuildOptions` gains the optional `resolvedBuildConfig` that `computeSourceTreeHash` already accepts, and `runBuild` forwards it.
- `makeRunBuildFixture` passes a config. The expected-hash computation in the source-tree hash test (`scripts/build-wiki-write-core.test.ts:1239-1243`) passes the same config.
- Move the cheap, decisive tests for each seam ahead of slow ones.
- Leave the entry guard and its existing directive alone.

**Execution note:** Add the distinguishable-config test first and confirm it fails when the forwarding is removed by hand.

**Patterns to follow:** the existing `runTypeScriptBuild` and `verifyPackage` options on `RunBuildOptions`, and `resolvedBuildConfig` on `computeSourceTreeHash`.

**Test scenarios:**

- Happy path: two distinguishable `resolvedBuildConfig` values passed to `runBuild` produce different source-tree hashes in the marker.
- Edge case: without `resolvedBuildConfig`, `computeSourceTreeHash` resolves the config at `buildConfigPath`.
- Integration: one test still runs the real default resolution against the repository's config.
- Integration: the existing real `--check --verify --stage`, safe-stage refusal and import-has-no-side-effects tests still pass.
- Error path: no test path lets a mutant resolve a stage or output target outside a test-owned temporary directory.

**Verification:** The after report shows every non-ignored mutant killed, and no default-swap mutant running more than one real tool call.

- [ ] **Unit 5: Measure and confirm**

**Goal:** Prove kill preservation before merge and the timing target after merge.

**Requirements:** R1, R4

**Dependencies:** Units 1–4

**Files:**

- Test expectation: none -- this unit measures and records results; it changes no code.

**Approach:**

- Before merge: run `bun run check:mutation-guards` on the branch with a clean Vitest cache. Compare per-target summed duration, static counts and statuses against run 42392597566. Record the comparison in the PR body.
- Run the pre-merge check after `bun run bootstrap`, so every configured test file loads in the dry run.
- After merge: collect `Check Mutation Guards` job durations from `main.yaml` `pull_request` runs for 14 days. Use the first 10 completed applicable runs, Renovate included, and take the 9th of the durations sorted ascending as p90. Report timed-out or cancelled applicable runs separately. If fewer than 10 land in the window, report the runs that exist. If p90 exceeds 700 s, report it and reopen the deferred scoping work.

**Verification:** The pre-merge report shows the four targets at 100% with no static mutants in `repository-root.ts` or the lockfile core module, and a clean verdict. A smart note records the post-merge p90.

## System-Wide Impact

- **Interaction graph:** `check-mutation-guards.ts` is the gate itself and a fixed trigger, so this PR runs the full gate. `publish-wiki.yaml:118,137` runs the lockfile shim. Workflows run route-stderr through its existing shim, and the release workflow runs the build script.
- **Error propagation:** exit codes and stderr text of all three CLIs are unchanged, apart from the escaped-path fix.
- **API surface parity:** `strykerConfigPath` and `mutationReportPath` change from strings to functions, and only the gate and its tests use them. Importers of `scripts/wiki-lockfile-gates.ts` must import the core module instead; the only importer is its test.
- **Unchanged invariants:** verdict classification, applicability, the trigger set for every other file, the Stryker configuration apart from one path, and `main.yaml`.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| Static-mutant cost depends on test order, so local timings mislead | Compare static counts and statuses, not local timings. CI is the timing source. |
| A fake makes a mutant survive by masking real behaviour | Every seam has a test proving the injected fake is used, and a test proving the real default works. |
| A short fake-child timeout flakes under CI load | Fake tests do no I/O. Widen the timeout if repeated loaded runs flake. |
| A build-script mutant writes to a real path in the Stryker sandbox | Fixtures use test-owned temporary roots, and no new code reads argv or environment. |
| The wall-clock gain is smaller than the summed-duration gain | R1 is checked after merge, and a miss reopens scoping. |

## Documentation / Operational Notes

- `.github/copilot-instructions.md`, `README.md` and the lockfile solution doc are updated where they describe `scripts/wiki-lockfile-gates.ts`.
- The PR body records before and after per-target mutation figures.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-11-07-cheaper-mutation-gate-requirements.md](../brainstorms/2026-11-07-cheaper-mutation-gate-requirements.md)
- Related past work: `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`, recorded complete. That plan designed the full run; this one keeps it and makes it cheaper.
- Related past work: `docs/plans/2026-10-19-001-refactor-mutation-guards-reach-module-plan.md`, recorded complete. It met the same static-mutant cost with a regex constant.
- Measurements: mutation report of run 42392597566 (CI artifact `mutation-report`).
