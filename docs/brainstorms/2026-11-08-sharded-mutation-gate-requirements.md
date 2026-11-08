---
date: 2026-11-08
topic: sharded-mutation-gate
---

# Sharded Mutation Gate

## Summary

Run the PR mutation gate as three Stryker shard jobs, then a final job that merges the three reports and classifies the merged report under today's fail-closed rules. The final job keeps the required check name `Check Mutation Guards`. Each `mutate` entry belongs to exactly one committed shard list. The local `bun run check:mutation-guards` stays a single full run.

---

## Problem Frame

`Check Mutation Guards` is the slowest required check on fro-bot/.github PRs. It runs the full `mutate` list on every applicable PR, Renovate bumps included, on a single 4-vCPU runner with 4 Stryker test runners. #4138 made the four costliest targets cheap, which cut the Stryker phase by about 13% once runner speed is normalized. Most of the remaining time is Vitest's per-run cost: starting a worker and importing and collecting each covering test file. A target-level fix cannot remove that.

A measurement probe in a scratch clone (`.context/mutation-overhead/probe/`) tested the levers that are left:

- **`isolate: false`.** With `isolate: false` across the whole suite, Stryker's dry run fails: 59 test failures in 3 files, and which tests fail depends on file order. Keeping the 10 leaky files isolated gave zero status flips across 5,521 mutants, but that run was 19–30% slower.
- **Two shards.** Two cost-balanced shards ran in 229 s and 183 s, against 437–440 s for one full run on the same machine. The merged report held all 5,521 mutants once, with identical statuses, and the gate's classifier returned `clean` on it. One shard's report, classified against the full config, fails closed with `AbsentFromReport`.
- **Larger runners.** GitHub offers them only to organizations on the Team or Enterprise Cloud plans.

fro-bot/.github is public, so the extra runner minutes cost nothing. What a sharded run adds is wall-clock time for the fixed per-shard setup (checkout, install, dry run), about 2–3 minutes per shard on CI.

---

## Requirements

**Shard runs**

- R1. On `pull_request`, the gate runs as three shard jobs in parallel. Each shard runs Stryker on its own committed subset of the `mutate` list and executes every configured test file in its dry run.
- R2. Every `mutate` entry belongs to exactly one shard. A test fails when an entry is missing from every shard, appears in more than one, or names a path that is not in `mutate`.
- R3. Each shard decides applicability with today's trigger rules. A not-applicable shard skips Stryker and reports that result. No separate job decides applicability first.
- R4. A shard's own output never sets the PR status. Only the final job does.

**Merge and classify**

- R5. A final job named `Check Mutation Guards` runs after all three shards, whether they succeed, fail or are cancelled. It is the only required check, and `.github/settings.yml` does not change.
- R6. When every shard reports not-applicable, the final job reports not-applicable. When the shards disagree on applicability, the job fails.
- R7. When the gate applies, the final job merges the three reports into one and classifies it against the full `stryker.config.json` with today's rules: Timeout, NoCoverage, Survived, instrumentation failure, missing configured targets, unexecuted configured test files and directive violations all fail.
- R8. The final job fails closed when a shard failed or was cancelled, a report is missing or unreadable, a report contains entries outside its shard's list, or two reports both cover the same entry.
- R9. The merged report is uploaded as the run's mutation report, as today.

**Local and docs**

- R10. `bun run check:mutation-guards` with no shard selection runs the full list in one Stryker run and gives the same verdict as today.
- R11. The repository docs that describe the gate (the mutation-guards solution docs, `.github/copilot-instructions.md` and the README if it describes the job) say how shards are assigned and how to rebalance them.

---

## Acceptance Examples

- AE1. A PR changes only `docs/`. All three shards report not-applicable, and `Check Mutation Guards` passes as not-applicable.
- AE2. A Renovate PR bumps `bun.lock`. All three shards run, the merged report is clean, and `Check Mutation Guards` passes.
- AE3. A mutant survives in a shard-2 target. Shard 2's job succeeds, because a shard never decides the verdict. The final job's merged classification reports `Survived` and fails.
- AE4. Shard 3 is cancelled or its runner dies. The final job fails and names the missing shard. It does not classify a partial report.
- AE5. A PR adds a new `mutate` entry without assigning it to a shard. The shard-coverage test fails in `Test`.
- AE6. A developer runs `bun run check:mutation-guards` locally and gets one full run, as today.

---

## Success Criteria

- On the implementing PR's own CI runs, `Check Mutation Guards` completes at least 30% sooner than the single-job runs measured on comparable runners. Comparable means a similar dry-run time. Wall time runs from the first shard's start to the final job's end.
- Verdicts do not change: the PR's merged report classifies `clean`, and a deliberately broken guard in any shard fails the final job.

---

## Scope Boundaries

- The near-timeout mutants (killed mutants at 36–48 s against a timeout of about 43 s) are not made cheaper here. That is separate work in the style of #4138.
- No PR scoping to reached targets, no full run on `main`, no incremental cache, and no `isolate: false`.
- No change to the shard count at runtime. Three is a committed choice, and changing it is a code change.
- No automatic rebalancing. A maintainer moves entries between shard lists when shard times drift.

---

## Key Decisions

- **Three shards.** The probe measured two shards at about 48% lower wall time. Three is an estimate: each shard also pays about 2–3 minutes of fixed setup on CI, so the required check should finish roughly 40–50% sooner. The 30% success floor allows for that uncertainty.
- **Committed shard lists, enforced by a test.** The lists are boring and reviewable, and there is no runtime splitting logic. A wrong split only changes timing, never the verdict, because the final job classifies against the full config.
- **Applicability is decided inside each shard, in parallel.** A separate decide job would add a serial setup in front of every applicable run, which is about 80% of PR runs. Not-applicable PRs pay three free setups instead.
- **No digest binding on shard reports.** The shards run the PR's own code, and the PR's own code already computes the verdict today, so a digest would not change who is trusted. The final job still checks that each report covers exactly its shard and that together they cover the full list. That catches lost or crossed artifacts.
- **The local run stays whole.** Developers keep one command and today's verdict. Sharding is a CI shape, not a second gate.
- Sharding was deferred in `docs/brainstorms/2026-11-07-cheaper-mutation-gate-requirements.md`, which is superseded by measurement: #4138 cut about 13% and the remaining time is per-run overhead. The full-run-per-PR, fail-closed design in `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md` (complete) is unchanged.

---

## Dependencies / Assumptions

- The gate's classifier can classify a merged report from outside a Stryker spawn. The probe did this through the exported classify function. Today `runMutationGuardCheck` hardcodes the config path and deletes the report before spawning.
- The workflow change (the job graph in `.github/workflows/main.yaml`) needs approval at the push gate.
- Unverified: whether three CI shards come in near the estimate. The plan measures it on the PR's own runs.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] How a shard selects its subset: a per-shard Stryker config, or a selector the gate passes to Stryker.
- [Affects R7][Technical] How the merge combines `testFiles`, which every shard records in full, so that the unexecuted-test-file check stays meaningful.
- [Affects R2][Technical] Where the shard lists live, and the initial three-way balance from the latest CI report.
- [Affects R3, R6][Technical] How a shard's applicability result reaches the final job.

---

## Sources / Research

- Probe artifacts: `.context/mutation-overhead/probe/out/` (local only).
- Overhead research: `.context/mutation-overhead/research.md` (local only).
- GitHub larger runners: https://docs.github.com/en/actions/concepts/runners/larger-runners
- `.github/workflows/main.yaml`, the `check-mutation-guards` job
- `packages/ci-checks/src/check-mutation-guards.ts`
- `.github/settings.yml`, the required checks
