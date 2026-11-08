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

- **`isolate: false`.** With `isolate: false` across the whole suite, Stryker's dry run aborts on failed tests. A plain Vitest run under the same setting shows 59 failures in 3 files, and which tests fail depends on file order. Keeping the 10 leaky files isolated gave zero status flips across 5,521 mutants, but that run was 19–30% slower.
- **Two shards.** Two cost-balanced shards ran in 229 s and 183 s, against 437–440 s for one full run on the same machine. The merged report held all 5,521 mutants once, with identical statuses, and the gate's classifier returned `clean` on it. One shard's report, classified against the full config, fails closed with `AbsentFromReport`.
- **Larger runners.** GitHub offers them only to organizations on the Team or Enterprise Cloud plans.

fro-bot/.github is public, so the extra runner minutes cost nothing. What a sharded run adds is fixed wall-clock time:

- **Each shard** pays checkout and the cached Setup action (about 10 s in recent runs), plus Stryker's instrumentation and dry run (about 50–65 s).
- **The final job** pays its own checkout and Setup before classifying.

On the current single job, `Check Mutation Guards` took 712–925 s in runs 42392597566, 42411246900 and 42422641309. Almost all of that is the gate step: Setup took 6–9 s.

---

## Requirements

**Shard runs**

- R1. On `pull_request`, the gate runs as three shard jobs in parallel.
  - Each shard checks out the PR's head commit, not the branch tip, and runs Stryker on its own committed subset of the `mutate` list.
  - Each shard keeps the full configured `testFiles` list, so every configured test file runs in its dry run.
- R2. Every `mutate` entry belongs to exactly one shard.
  - A test fails when an entry is missing from every shard, appears in more than one, or names a path that is not in `mutate`.
  - A test pins that a shard's Stryker run keeps the full `testFiles` list.
- R3. Each shard decides applicability with today's trigger rules, computed from the full config, not its own subset. A not-applicable shard skips Stryker and reports that result. No separate job decides applicability first.
- R4. The shard lists, the merge step and the final job's entrypoint are part of the gate's fixed trigger set. A PR that changes only one of them is applicable.
- R5. A shard's own output never sets the PR status. Only the final job does. Each shard's result (applicability, head commit, report) reaches the final job on its own, so one shard's result can never overwrite another's.

**Merge and classify**

- R6. A final job named `Check Mutation Guards` runs on every `pull_request` after all three shards, whether they succeed, fail, are skipped or are cancelled. A skipped required job counts as passing, so this job must never be skipped on a PR. It is the only required check, and `.github/settings.yml` does not change.
- R7. The final job fails, naming the shard, when any shard did not succeed or reported a different head commit from the PR's.
- R8. When every shard reports not-applicable, the final job reports not-applicable. When the shards disagree on applicability, the job fails.
- R9. When the gate applies, the final job checks the three raw reports before merging them. It fails, naming the shard, when a report is missing or unreadable, a report covers an entry outside its shard's list, or two reports cover the same entry.
- R10. The final job then merges the reports and classifies the result against the full `stryker.config.json` with today's rules. Timeout, NoCoverage, Survived, instrumentation failure, missing configured targets and directive violations all fail. A configured test file fails as unexecuted when any shard ran it zero times.
- R11. The merged report is uploaded as the run's mutation report, as today.

**Local and docs**

- R12. `bun run check:mutation-guards` with no shard selection runs the full list in one Stryker run and gives the same verdict as today.
- R13. The repository docs that describe the gate (the mutation-guards solution docs, `.github/copilot-instructions.md` and the README if it describes the job) say how shards are assigned and how to rebalance them.

---

## Acceptance Examples

- AE1. A PR changes only `docs/`. All three shards report not-applicable, and `Check Mutation Guards` passes as not-applicable.
- AE2. A Renovate PR bumps `bun.lock`. All three shards run, the merged report is clean, and `Check Mutation Guards` passes.
- AE3. A mutant survives in a shard-2 target. Shard 2's job succeeds, because a shard never decides the verdict. The final job's merged classification reports `Survived` and fails.
- AE4. Shard 3 is cancelled or its runner dies. The final job fails and names shard 3. It does not classify a partial report.
- AE7. Shard 2's dry run executes zero tests from one configured test file, while shards 1 and 3 execute it. The final job fails with an unexecuted test file.
- AE8. After a new push, a re-run of only the failed shard checks out the run's head commit. The other shards' reports from the first attempt carry the same head commit, so they merge.
- AE5. A PR adds a new `mutate` entry without assigning it to a shard. The shard-coverage test fails in `Test`.
- AE6. A developer runs `bun run check:mutation-guards` locally and gets one full run, as today.

---

## Success Criteria

- On the implementing PR's own CI runs, the gate's wall time (first shard start to final job end) is at least 30% below the median of the single-job runs 42392597566, 42411246900 and 42422641309 (858 s). Runs with a dry run within 10 s of each other count as comparable. The PR body records the numbers.
- Verdicts do not change: the PR's merged report classifies `clean`, and a deliberately broken guard in any shard fails the final job.

Status (2026-11-08): built locally in Units 1 to 5 of `docs/plans/2026-11-08-001-refactor-sharded-mutation-gate-plan.md`. The second criterion is covered by tests that run a survivor through each of the three shards (`mutation-merge.test.ts`). The wall-time criterion and the re-run behaviour are measured on the pull request's own runs (Unit 6) and are not yet verified.

---

## Scope Boundaries

- The near-timeout mutants (killed mutants at about 36–42 s against a timeout of about 43 s) are not made cheaper here. That is separate work in the style of #4138.
- No PR scoping to reached targets, no full run on `main`, no incremental cache, and no `isolate: false`.
- No change to the shard count at runtime. Three is a committed choice, and changing it is a code change.
- No automatic rebalancing. A maintainer moves entries between shard lists when shard times drift.

---

## Key Decisions

- **Three shards.** The probe measured two shards locally at about 48% lower Stryker time. Three is an estimate. On an 858 s single job, about 70 s of fixed shard cost plus a third of the remaining mutant phase, plus the final job, comes to roughly 350–450 s with imperfect balance. That is about 45–60% sooner. The 30% floor allows for imbalance and runner variance.
- **Committed shard lists, enforced by a test.** The lists are boring and reviewable, and there is no runtime splitting logic. A lopsided split only changes timing. An invalid split (unassigned or duplicated entries) fails the coverage test and the final job.
- **Applicability is decided inside each shard, in parallel.** A separate decide job would add a serial setup in front of every applicable run. In the earlier sample, 48 of 60 PR runs reached Stryker (`docs/brainstorms/2026-11-07-cheaper-mutation-gate-requirements.md`). Not-applicable PRs pay three free setups instead.
- **No digest binding on shard reports.** The shards run the PR's own code, and the PR's own code already computes the verdict today, so a digest would not change who is trusted. The final job still checks that each report covers exactly its shard and that together they cover the full list. That catches lost or crossed artifacts. Checking out the head commit and binding each report to it stops a re-run from mixing in code from an older attempt.
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
- [Affects R2][Technical] Where the shard lists live, and the initial three-way balance from the latest CI report.
- [Affects R5, R8][Technical] How each shard's result reaches the final job: named shard jobs, or one artifact per shard. Matrix job outputs are last-writer-wins, so they cannot carry per-shard results.
- [Affects R9, R10][Technical] Where the raw-report checks and the merge live, so that the classifier can run without a Stryker spawn. Today `runMutationGuardCheck` deletes the report before spawning.

---

## Sources / Research

- Probe artifacts: `.context/mutation-overhead/probe/out/` (local only).
- Overhead research: `.context/mutation-overhead/research.md` (local only).
- GitHub larger runners: https://docs.github.com/en/actions/concepts/runners/larger-runners
- `.github/workflows/main.yaml`, the `check-mutation-guards` job
- `packages/ci-checks/src/check-mutation-guards.ts`
- `.github/settings.yml`, the required checks
