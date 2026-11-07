---
date: 2026-11-07
topic: cheaper-mutation-gate
---

# Cheaper Mutation Gate

## Summary

Make the four slowest mutation targets cheap so that every full mutation run, Renovate bumps included, finishes well inside the job's timeout. The gate still runs the full `mutate` list on every applicable PR with today's verdict rules. Scoping PR runs to the targets a change can reach is deferred until these speedups are measured.

---

## Problem Frame

`Check Mutation Guards` is the slowest required check on fro-bot/.github PRs. Over 60 recent PR runs, 48 reached Stryker. The 33 that completed had a median of 949 s and a p90 of 1165 s by nearest rank, and the job's `timeout-minutes` cap is 1200 s. The mutant phase takes about 93% of the job. The initial test run takes about 41 s.

Renovate opened 36 of the 48 applicable runs. Its lockfile and manifest changes are fixed triggers, and they force a full run on purpose, because a toolchain bump can blind the gate (`docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`). That plan expected Renovate runs to take single-digit minutes. They now take 14 to 19.

The cost is concentrated. In run 42392597566, four targets took 66% of the summed mutant time while holding 20% of the mutants. The mutation report shows a different mechanism for each:

- `scripts/build-wiki-write-core.ts`, 19%: 511 mutants with cost spread across most of them. Importing the module in its tests runs a real `tsc` build.
- `scripts/wiki-lockfile-gates.ts`, 16%: four static mutants on the module-level `import.meta.url` self-invoke guard take about 162 of the target's 171 s.
- `packages/wiki-ops/src/route-stderr.ts`, 15%: the slow mutants sit in the code that spawns the wrapped command.
- `packages/ci-checks/src/repository-root.ts`, 15%: four static mutants at about 38 s each. Each one reruns every covering test (59 for this target), and one is killed only by a test that reaches it through a spawned process.

None of these mutants time out. All four are `Killed` or `Ignored`. Static mutants run against every test that covers them, so module-level code is the most expensive code to mutate.

---

## Requirements

**Speed**

- R1. Full mutation runs reach a p90 of 700 s or less, measured by nearest rank over at least 10 completed applicable PR runs after the change.
- R2. Each of the four targets gets cheaper through changes to its tests or through restructuring its source. Restructuring includes moving module-level code into functions.

**Guarantees kept**

- R3. The logic of all four targets stays in `mutate`. No `Stryker disable` directive is added, and `ignoreStatic` stays off.
- R4. Each target keeps a 100% kill rate. Every behaviour its mutants check today is still checked after the change.
- R5. Restructured source behaves the same for its callers, including CLI exit codes, output and the self-invoke behaviour of entrypoints. The one intended change: an entrypoint whose path contains a space or `#` now runs instead of exiting 0 without running.
- R6. The gate's trigger set, verdict rules and full-run behaviour do not change.

---

## Acceptance Examples

- AE1. **Covers R2, R5.** Given `wiki-lockfile-gates.ts` with its self-invoke guard moved into a function, when the script runs as an entrypoint it behaves as before. When it is imported, it does not run `main`.
- AE2. **Covers R4.** Given a speedup to a target, the mutation report after the change shows every mutant in that target `Killed` or `Ignored` with a reason, and none `Survived`, `NoCoverage` or `Timeout`.

---

## Success Criteria

- R1's p90 is met on the first 10 completed applicable runs after merge, Renovate runs included.
- The four targets' combined share of summed mutant time drops well below today's 66%.
- No verdict rule changes. The only `mutate` change is where the lockfile gate's logic lives, and its entry script still triggers the gate.
- Planning can choose a fix for each target without inventing behaviour.

---

## Scope Boundaries

- Scoping PR runs to the `mutate` targets a change can reach. The full run on `main` and the failure issue go with it. Deferred.
- Sharding, Stryker incremental mode and gating on mutation score.
- Speeding up targets other than these four.

---

## Key Decisions

- Fix the hot spots and defer scoping. Scoping would save real time only on PRs that edit a leaf module. Renovate PRs and test edits would still need full runs. Measured with the gate's own closure, shared modules (`wiki-slug.ts`, `core/cli.ts`, `core/guards.ts`) select 21 to 24 of the 50 targets. Scoping would also need a change to the classifier's verdict inputs, a reach rule that covers runtime coverage, and a new CI permission. Revisit it only if full runs miss R1 after the speedups.
- Restructuring the source is allowed. The cost of static mutants lives in module-level code, and tests cannot remove that cost. Repository guidance already says to keep constants whose mutants matter inside functions.
- Kill sets are kept, not traded for speed. A faster test that no longer kills a mutant fails R4.

---

## Dependencies / Assumptions

- The per-target figures come from one run's report. Per-mutant `duration` is summed across workers, so the 66% share does not translate one-for-one into wall-clock savings.
- The four `mutant-timeout` verdicts in the sampled runs all predate #4123, which fixed the `wiki-change-detect-core.ts` readdir fake.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] For each target, the smallest change that removes most of its cost: moving module-level code into functions (`repository-root.ts`, `wiki-lockfile-gates.ts`), a cheaper process path in the `route-stderr` tests, and a seam so `build-wiki-write-core` tests do not run `tsc` for every mutant.
- [Affects R4][Needs research] Which `repository-root.ts` mutants are killed only by spawned-process tests such as `knowledge-mcp.test.ts`, and whether a direct test needs to replace that kill.

---

## Sources / Research

- `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`: why the gate runs every applicable PR in full.
- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`: reach rules and why a timeout counts as a failure.
- `docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md`: why disable directives are out.
- `stryker.config.json`: 50 `mutate` entries, 54 `testFiles`, `perTest` coverage by default, and `timeoutMS` 30000.
- `.github/workflows/main.yaml:233-266`: the job, its `pull_request`-only condition and its 20-minute cap.
