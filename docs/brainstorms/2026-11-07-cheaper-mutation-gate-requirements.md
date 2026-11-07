---
date: 2026-11-07
topic: cheaper-mutation-gate
---

# Cheaper Mutation Gate

## Summary

Cut the mutation gate's wall time without weakening its verdicts. First make the few slow mutation targets cheap, which speeds up every run. Then run code-only PRs against the `mutate` targets they can reach. A full run on `main` catches anything the scoping misses and opens an issue when it fails.

---

## Problem Frame

`Check Mutation Guards` is the slowest required check on fro-bot/.github PRs. Over 60 recent PR runs, 80% reached Stryker. Completed runs took a median of 949 s and a p90 of 1165 s, against the job's 1200 s `timeout-minutes` cap. The mutant phase is about 94% of a run; the initial test run takes about 41 s.

The cost is concentrated. In run 42392597566, four targets took 66% of the summed mutant time while holding 20% of the mutants:

- `scripts/build-wiki-write-core.ts`: 19%
- `scripts/wiki-lockfile-gates.ts`: 16%
- `packages/wiki-ops/src/route-stderr.ts`: 15%
- `packages/ci-checks/src/repository-root.ts`: 15%, from 4 mutants at about 38 s each

Renovate opened 42 of the 60 runs. Its lockfile and manifest changes are fixed triggers that force a full run by design, because a toolchain bump can blind the gate (`docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`). Scoping by import reach alone would leave those runs unchanged.

The job runs only on `pull_request` (`.github/workflows/main.yaml:239`), so `main` never gets a full mutation run.

---

## Requirements

**Per-target cost**

- R1. Every run, Renovate bumps included, finishes with a p90 well under the job's timeout cap.
- R2. The four dominant targets get cheaper by changing how their tests exercise them, not by removing them from `mutate` or adding `Stryker disable` directives.
- R3. Each speedup keeps that target's mutants killed, and a target that is 100% today stays at 100%.

**Scoped PR runs**

- R4. A PR whose changes reach only some `mutate` targets runs Stryker on just those targets.
- R5. A target is reached when its own file, any module in its import closure, or a configured test whose closure includes it changes.
- R6. A change to a fixed trigger, a package manifest, the lockfile, the gate's own files or the Stryker configuration still forces a full run.
- R7. A PR that reaches no target stays `not-applicable`, as today.
- R8. The verdict rules do not change. Timeout, NoCoverage, survived mutants, instrumentation failure and directive violations all fail a scoped run the same way they fail a full run.
- R9. A scoped run judges only the targets it selected. An unselected target is never reported as absent or unexecuted.

**Full run on main**

- R10. The full `mutate` list runs on `main` after merges or on a schedule.
- R11. When that run fails, an issue names the verdict and the failing mutants so Fro Bot can pick it up, and the run itself also fails.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** Given a PR that changes only `packages/wiki-ops/src/route-stderr.ts`, when the gate runs, Stryker mutates `route-stderr.ts` and any other target whose closure includes it, and nothing else.
- AE2. **Covers R5.** Given a PR that changes only a test file configured in `testFiles`, when the gate runs, it mutates the targets that test's imports reach.
- AE3. **Covers R6.** Given a Renovate PR that changes `bun.lock`, when the gate runs, it runs the full `mutate` list.
- AE4. **Covers R8, R9.** Given a scoped run where a selected target has a timed-out mutant, the verdict is `mutant-timeout`. A target that was not selected does not appear in the verdict.
- AE5. **Covers R11.** Given a merge after which the full run on `main` finds a survived mutant in a target no PR selected, the run fails and an issue lists that mutant.

---

## Success Criteria

- p90 for applicable PR runs drops well below 1200 s, and Renovate runs get faster too.
- Code-only PRs that touch one package finish their mutation check in a fraction of today's median.
- No verdict rule changes. Every `mutate` target is fully mutated on `main` at least once per merge or schedule window.
- Planning can choose the scoping mechanism and the hot-spot fixes without inventing behaviour.

---

## Scope Boundaries

- Sharding the run across parallel jobs.
- Stryker's incremental mode or any persisted mutation cache.
- Gating on mutation score.
- Changing which modules are in `mutate`.

---

## Key Decisions

- Hot spots before scoping: per-target speedups help every run, including the Renovate majority that scoping cannot help.
- Toolchain changes keep the full PR run, the original design's protection against a bump that blinds the gate.
- A gap left by scoping is caught after merge, by the full run on `main`, not before. The PR then merges with that gap open.
- A failed full run on `main` opens an issue. A red run alone on `main` is easy to miss.
- Previously recorded: the gate was designed in `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md` (recorded complete) to run in full on every applicable PR, and narrowing was deferred until its cost could be measured. The measurements above are that cost.

---

## Dependencies / Assumptions

- The four hot spots are slow because each mutant spawns processes, builds the package or waits for a timeout. Unverified; the planner confirms per target.
- The gate already computes each target's import closure before it unions them (`packages/ci-checks/src/check-mutation-guards.ts:1465`).
- Stryker 10.1.1 accepts `--mutate` and `--testFiles` overrides. How an override combines with the configured lists is unverified.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Needs research] Why each of the four hot spots is slow, and the smallest test change that fixes it.
- [Affects R4, R9][Technical] Whether scoping passes a subset to Stryker or writes a scoped configuration, and how the classifier learns which targets were selected.
- [Affects R5][Technical] Whether scoped runs also narrow `testFiles`, which shortens the initial test run, or keep every configured test.
- [Affects R10][Technical] Run on every push to `main` or on a schedule, given the runner cost of about 16 minutes per run.
- [Affects R11][Technical] Whether a repeat failure updates one open issue or opens a new one.

---

## Sources / Research

- `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`: the original gate design and its full-run rationale.
- `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`: reach and pairing rules that any scoped run must keep.
- `packages/ci-checks/src/check-mutation-guards.ts`: trigger gate (`:1669-1710`), closure (`:1448-1489`), launch (`:954-967`) and classification (`:299-547`).
- `stryker.config.json`: 50 `mutate` entries, 54 `testFiles`, `perTest` coverage by default, and `timeoutMS` 30000.
