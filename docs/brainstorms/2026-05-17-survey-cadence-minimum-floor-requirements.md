---
title: Survey cadence — minimum-dispatch floor
type: feat
status: draft
date: 2026-05-17
---

# Survey cadence — minimum-dispatch floor

## Origin

The trigger condition documented in `docs/plans/2026-05-05-001-feat-survey-cadence-and-multi-channel-discovery-plan.md` (line 53, "Deferred to Separate Tasks") has been met in production:

> Trigger for that plan: 30 days of operation under this plan show consecutive-zero-day stretches >7 days even with jitter applied.

As of 2026-05-17, the Reconcile Repos workflow has reported `success` with `dispatches: 0` on **9 consecutive scheduled runs** (last dispatch fired 2026-05-08 via manual `workflow_dispatch`). The proximate cause is exactly the clustering scenario the cadence plan predicted: a triple-dispatch in early May pushed every repo's `next_survey_eligible_at` into a 4-day window in early-to-mid June. Jitter (±3 days) widened the cluster but did not break it.

## Problem Frame

The current cadence model is a strict threshold gate: a repo dispatches only when `next_survey_eligible_at <= today (UTC)`. When a tracked-repo population of N=20+ all bunch together, the gate emits zero dispatches for the duration of the cycle gap, then drains the herd in a 2-3 day burst, then idles again. The wiki goes silent for weeks at a time. Operator-visible signal is "success" with a zero counter — there is no warning that the pipeline has stopped producing knowledge.

The threshold model is correct as a *ceiling* (don't over-survey), but it lacks a *floor* (always make some progress). The Karpathy wiki pattern this entire system implements depends on continuous knowledge accumulation — silence for 2-3 weeks at a time defeats the point.

## Posture

Add a per-day floor that always dispatches a small number of oldest-`last_survey_at` repos, regardless of the threshold. The threshold gate continues to cap the upper end (no more than 12 dispatches per run, never re-survey within ~14 days even with floor pressure). The floor decouples wiki growth from cluster timing.

## Goals

- **Continuous wiki growth.** Reconcile dispatches at least N (TBD, probably 1-3) surveys per scheduled run, even when nothing is threshold-eligible.
- **Operator-visible drought signal.** When the floor fires because the threshold gate produced nothing, the run summary surfaces a distinct counter / log line — silence becomes loud.
- **Bounded re-survey frequency.** A repo dispatched by the floor on day D should not be re-eligible (by floor) for at least M days (TBD, probably 7-10), independent of its `next_survey_eligible_at`. Prevents the floor from re-surveying the same repo every day.
- **Preserve existing cap.** The 12-dispatch-per-run cap (`DEFAULT_MAX_DISPATCHES_PER_RUN`) and 90s stagger apply to floor dispatches too. The floor adds to the dispatch pool; it does not bypass capacity controls.

## Non-Goals

- **Eliminating the threshold model.** The per-channel intervals (owned=14d, contrib=21d, collab=30d) still drive the ceiling. The floor is additive.
- **Operator-tunable floor count via env var.** Ship a constant first. Promote to env later if real cadence needs it.
- **Backfill / smoothing of the existing cluster.** This plan ships the floor logic; the existing June-cluster smooths itself as floor dispatches gradually re-jitter `next_survey_eligible_at` across the population.
- **Per-channel floor counts.** Single global floor across all channels. Per-channel sub-floors are deferred unless real operation shows a channel starvation pattern.

## Requirements

| # | Requirement |
|---|---|
| R1 | Reconcile dispatches at least `FLOOR_MIN` repos per run when the tracked population has any eligible candidates, regardless of `next_survey_eligible_at`. |
| R2 | The floor picks repos by oldest `last_survey_at` first (nulls first, matching existing prioritization). |
| R3 | The floor excludes repos surveyed within the last `FLOOR_MIN_GAP_DAYS` (TBD, ~7-10 days) to prevent rapid re-surveying. |
| R4 | The floor excludes `pending-review`, `lost-access`, and `private: true` repos for the same reasons the existing dispatch gate does. |
| R5 | When the floor fires (i.e., threshold-eligible count was below `FLOOR_MIN`), the run summary surfaces a `summary.flooredDispatches` counter and a single stderr log line `floor fired: N dispatches added because threshold yielded M`. |
| R6 | The dispatch cap (`DEFAULT_MAX_DISPATCHES_PER_RUN`) is enforced after the floor merges into the dispatch pool. A run that hits the cap reports `dispatchesDeferred` as usual. |
| R7 | A successful floor dispatch updates `last_survey_at` and `next_survey_eligible_at` exactly the same way a threshold dispatch does — no special-case state. |
| R8 | All floor logic lives in the pure `reconcileRepos` decision engine, fully unit-tested. The I/O shell remains untouched. |

## Success Criteria

| # | Criterion |
|---|---|
| SC1 | Across any 7-day window post-rollout, at least 5 of those days have `dispatches > 0`. (Compare to current state: 9-day silence and counting.) |
| SC2 | No repo is re-surveyed more than once per `FLOOR_MIN_GAP_DAYS`-day window by floor action alone. |
| SC3 | A scheduled `Reconcile Repos` run with `summary.flooredDispatches > 0` shows the floor log line in the workflow log. |
| SC4 | Existing tests still pass — floor is additive, doesn't change threshold semantics. |

## Open Questions (Deferred to Planning)

1. **What is `FLOOR_MIN`?** Initial proposal: 2 per run. Daily cron × 2 = ~14/week, comfortable on the Anthropic seat capacity at 90s stagger. Confirm during planning.
2. **What is `FLOOR_MIN_GAP_DAYS`?** Initial proposal: 7 days. Long enough to prevent ping-pong, short enough to make the floor meaningful at N=20+. Confirm during planning.
3. **Floor vs threshold ordering in the dispatch list.** When both fire, do threshold-eligible repos go first (prioritizing the channel-cycle math) or oldest-`last_survey_at` regardless of source? Initial proposal: oldest-first regardless of source — keeps the dispatch order deterministic and explainable.
4. **Drought-detection issue.** Should reconcile auto-open a `reconcile:cadence-drought` GitHub issue if the floor itself yields zero dispatches (e.g., every repo was within `FLOOR_MIN_GAP_DAYS`)? Probably yes, but verify the issue lifecycle pattern matches existing `reconcile:pending-review` handling.
5. **Backfill stragglers.** Should the floor also pick from `pending-review` if they've been waiting longer than X days? Probably no (those are explicitly human-gated) but worth a question during planning.

## Scope Boundaries

- **In scope:** `scripts/reconcile-repos.ts` engine logic, `scripts/reconcile-repos.test.ts` coverage, observable counter + log surface.
- **Out of scope:** Anthropic seat capacity work, per-channel sub-floors, env-var tuning, cluster-smoothing migrations, alternate dispatch ordering algorithms.

## Rejected Alternatives

- **Re-jitter all `next_survey_eligible_at` values on every run.** Solves bunching but mutates state unpredictably and makes the field non-meaningful. The threshold model is correct; it just needs a complement.
- **Lower the per-channel intervals (e.g. collab=14d).** Halves the cycle but proportionally doubles seat pressure. Doesn't address the structural "ceiling without floor" gap.
- **Trigger reconcile more often (every 6h cron).** Increases workflow runs without changing the eligibility math. Same cluster, same droughts.
- **Per-day pull-based model where Fro Bot picks N to survey via agent prompt.** Adds an agent decision layer where a pure function suffices. Defer until pure logic proves insufficient.
