---
title: Observability Before Structural Change
category: best-practices
problem_type: best_practice
applies_when:
  - A proposed schema or state change is meant to fix a latent gap.
  - Live production evidence is available and should be checked before adding permanent state.
  - The failure mode may already be covered by existing workflow behavior.
module: scripts/reconcile-repos
component: development_workflow
severity: low
tags:
  - observability
  - production-evidence
  - statefulness
  - reconciliation
  - canary
date: 2026-06-09
---

# Observability Before Structural Change

## Context

A robustness gap often looks like a schema problem before it is actually a production
problem. When a plausible failure mode is identified, the instinct is to add durable
state to prevent it — a new field, a write-on-event path, a cooldown, a migration. But
adding persistent state carries permanent cost, and the failure mode may be hypothetical
(never observed) or already covered by existing behavior. The risk is overfitting a
permanent stateful fix to a problem that has not happened.

A concrete instance: the survey-dispatch pipeline schedules surveys without mutating any
per-repo state. Cadence only advances when a survey *completes* and records its result.
A survey killed before it can record leaves its `last_survey_at` stale, so the
minimum-dispatch floor — which selects the oldest-surveyed repos — could re-target that
same repo every run, burning a floor slot indefinitely. The proposed fix was a stateful
`last_dispatched_at` field plus write-on-dispatch, a cooldown in the selection logic, and
a schema migration.

## Guidance

When a stateful fix is proposed for a latent gap:

1. **Gather live evidence before adding structure.** Pull the actual run history and the
   current state distribution. Is the failure mode happening now, or is it theoretical?
2. **Separate observed failures from hypothetical ones.** A failure mode that *can* occur
   is not the same as one that *is* occurring. Check whether existing behavior already
   covers the realistic cases.
3. **If the problem is not showing up, ship a stateless observability canary plus a clear
   revisit trigger** instead of new schema. The canary turns a hypothetical into a
   measurable signal; the trigger states exactly what evidence would justify the
   structural fix later.
4. **Make sure the detector does not smuggle in the same state cost it avoids.** A
   detector that needs "N consecutive misses" must persist a counter — that is the same
   carrying cost in disguise. Prefer a signal *derived* from existing fields at evaluation
   time.

## Why This Matters

Schema fields, migrations, cooldown logic, and extra write paths all carry permanent
cost: more complexity, more contention on the shared write path, and more surface to
maintain and reason about forever. If the problem is only hypothetical, that cost is
wasted. A derived canary is cheap, adds no persisted state, and produces the real
production data that would justify the structural fix — but only if the signal ever
trips. You defer the expensive decision until evidence demands it, rather than paying for
it up front against a guess.

## When to Apply

Use this pattern when:

- a stateful change is being proposed for a latent, not-yet-observed gap;
- the signal can be derived from existing state at evaluation time;
- the structural fix can safely wait behind an observability canary;
- you want a documented trigger for revisiting the decision.

Do **not** use it to dodge a fix for a problem that is actively happening — if the
evidence shows the failure in the wild, build the fix. The pattern is about sequencing,
not avoidance.

## Examples

**Stateful option vs. derived canary.** Instead of adding a `last_dispatched_at` field
plus migration and cooldown logic, derive a `stuckCandidates` count from current metadata
at reconcile time: onboarded repos whose `last_survey_at` is null or older than a
staleness threshold. No new field, no migration, no write-on-dispatch path.

**Thresholding from known cadence.** Anchor the staleness threshold to the existing
cadence plus a grace margin that exceeds the jitter window — e.g. `37d` for a 30-day
interval with a 7-day buffer (buffer > the 3-day jitter), so normal scheduling never
trips the canary. (A single-threshold canary is deliberately less sensitive for shorter
channels; that is acceptable for a counts-only signal and noted as a future refinement.)

**Telemetry shape.** Emit the signal as a counts-only number at evaluation time, derived
from existing fields. No identifiers, no persisted state — it rides along with the
existing summary output.

**The detector trap.** Avoid "N consecutive misses" detectors when they require storing
dispatch history. That reintroduces exactly the carrying cost the canary was meant to
avoid. The age of the oldest entry, derived from a timestamp that already exists, is the
stateless equivalent.

**The documented residual.** Pair the canary with an explicit revisit trigger: a
sustained non-zero count is the signal to build the stateful fix. Until then, the
structural change stays deferred — justified by data, not by guesswork.

## Related

- [`autonomous-pipeline-minimum-progress-floor-2026-05-17.md`](./autonomous-pipeline-minimum-progress-floor-2026-05-17.md)
  — the minimum-floor mechanism this canary observes. If tempted to add state to harden
  the floor, prove the problem is real first; otherwise ship a derived counter.
- [`loose-then-tight-schema-migration-pattern-2026-05-05.md`](./loose-then-tight-schema-migration-pattern-2026-05-05.md)
  — schema pressure should be justified by observed need; not every pressure to store new
  state deserves a migration.
- [`diagnostic-patches-observability-discipline-2026-05-20.md`](./diagnostic-patches-observability-discipline-2026-05-20.md)
  — the same observability-first philosophy, applied at the diagnostic layer rather than
  the design-decision layer.
- [`autonomous-pipeline-silent-failures-2026-04-19.md`](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md)
  — observability canaries help detect silent regressions before adding durable state.
