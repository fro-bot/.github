---
category: best-practices
title: Autonomous pipeline minimum-progress floor for threshold-gated dispatch
date: 2026-05-17
last_updated: 2026-05-17
problem_type: best_practice
module: reconcile-repos
component: development_workflow
severity: medium
verified: 2026-05-17
tags:
  - reconcile-repos
  - survey-dispatch
  - deterministic-jitter
  - minimum-progress-floor
  - autonomous-pipeline
  - workflow-resilience
applies_when:
  - A scheduled pipeline can legitimately return zero work for many consecutive runs because threshold gating plus jitter has starved the population.
  - You need to preserve privacy/fail-closed behavior while still guaranteeing periodic progress.
  - A manual or clustered dispatch created a long next-eligible horizon and the system risks silence.
---

## Context

Threshold-gated dispatch in autonomous pipelines tends to bunch under bursty load: manual interventions, recovery runs, and bootstrap work create a short surge, then the system drains and idles for weeks. The cadence plan explicitly anticipated this follow-on condition, and production hit it after roughly 21 days. During a drought, the operator signal is just "success" with a zero counter, so the pipeline looks healthy while wiki accumulation stalls.

## Guidance

When a threshold gate acts as a ceiling on dispatch volume, pair it with a floor that guarantees some minimum progress.

1. Reuse the exact same fail-closed predicates as the threshold path. No weaker filter on the floor.
2. Add a separate gap-day cooldown so floor dispatches do not re-survey too soon.
3. Merge floor candidates into the existing dispatch list before cap/rotation logic. The floor should be transparent at the dispatch boundary.
4. Emit a dedicated counter and a counts-only log line so droughts become visible.

### Load-bearing implementation pattern

```ts
// Pass 2.5 — minimum-dispatch floor
// Fires when threshold-driven dispatches fall below FLOOR_MIN.
// Cap counting and rotation happen in the I/O shell as today.
// Floor dispatches look identical to threshold dispatches downstream — intentional.
if (dispatches.length < FLOOR_MIN) {
  const slotsNeeded = FLOOR_MIN - dispatches.length
  const dispatchedKeys = new Set(dispatches.map(d => repoKey(d.owner, d.repo)))

  const floorCandidates: {entry: RepoEntry; access: AccessListEntry}[] = []
  for (const entry of next.repos) {
    // Same eligibility universe as the threshold gate, minus next_survey_eligible_at —
    // the floor's whole job is to fire when the threshold has held repos back.
    if (entry.onboarding_status !== 'onboarded' && entry.onboarding_status !== 'pending') continue
    if (entry.onboarding_status === 'pending' && entry.last_survey_status === 'success') {
      // Mirrors the threshold gate's `pending` branch: a successful pending repo
      // waits for its eligibility timestamp; the floor doesn't override that.
      continue
    }

    const key = repoKey(entry.owner, entry.name)
    if (dispatchedKeys.has(key)) continue

    // Fail-closed privacy: stored AND live access-list must agree on public.
    const access = accessForTrackedEntry(entry, key, accessByKey, accessByNodeId)
    if (access === undefined) continue
    const accessPrivate = accessPrivateForStorage(access, accessNodePrivacy)
    if (entry.private !== false || accessPrivate) continue

    // Gap-days: strict greater-than on whole-day count.
    if (entry.last_survey_at !== null) {
      const surveyedMs = Date.parse(`${entry.last_survey_at}T00:00:00Z`)
      if (!Number.isFinite(surveyedMs)) continue
      const daysAgo = Math.floor((nowMs - surveyedMs) / 86_400_000)
      if (daysAgo <= FLOOR_MIN_GAP_DAYS) continue
    }

    floorCandidates.push({entry, access})
  }

  // Oldest-first sort — matches prioritizeDispatches ordering used by threshold path.
  floorCandidates.sort((left, right) =>
    compareBySurveyFreshness(
      left.entry.last_survey_at,
      right.entry.last_survey_at,
      repoKey(left.entry.owner, left.entry.name),
      repoKey(right.entry.owner, right.entry.name),
    ),
  )

  for (const {entry, access} of floorCandidates.slice(0, slotsNeeded)) {
    const key = repoKey(entry.owner, entry.name)
    if (dispatchedKeys.has(key)) continue // defensive dedup
    dispatchedKeys.add(key)
    dispatches.push({owner: access.owner, repo: access.name, node_id: access.node_id})
    summary.flooredDispatches += 1
  }
}
```

### Telemetry helper

```ts
export function formatFloorTelemetry(flooredDispatches: number, thresholdYield: number): string {
  return `floor fired: dispatched ${flooredDispatches} of FLOOR_MIN=${FLOOR_MIN} (threshold yielded ${thresholdYield})`
}
```

Emit through the injected logger boundary, best-effort:

```ts
if (plan.summary.flooredDispatches > 0) {
  const thresholdYield = plan.dispatches.length - plan.summary.flooredDispatches
  try {
    logger.warn(formatFloorTelemetry(plan.summary.flooredDispatches, thresholdYield))
  } catch (error) {
    // Telemetry is best-effort; substantive engine work has already completed.
    // A breadcrumb to stderr preserves visibility of programmer errors without
    // aborting the scheduled run.
    console.error('reconcile: floor telemetry emission failed', error)
  }
}
```

## Why This Matters

Without a floor, threshold-only cadence will produce multi-week droughts in any non-trivial population. Jitter spreads dispatches out; it does not prevent unbunching. A floor also makes silence loud: repeated floor fires show either healthy steady-state or a broken threshold model. Without it, both cases look identical — zero dispatches, success status.

The privacy invariant has to hold across both gates. A weaker floor predicate is effectively a back door for private repos.

## When to Apply

Use this pattern when you have:

- a real ceiling requirement on dispatch volume
- a population that can bunch up from manual intervention, recovery, or seasonality
- a need for continuous progress
- an operator who must notice droughts

## Examples

**Before:** cadence-only thresholding produces bursts, then long idle stretches. Operator sees `dispatches: 0, status: success` for weeks with no signal that anything is wrong.

**After:** cadence plus floor guarantees continuous minimum throughput, while preserving the ceiling and the same fail-closed filters. Operator sees `flooredDispatches: 2` on drought days — immediately actionable signal.

Reference implementation pattern:

- threshold path sets the ceiling
- floor path fills any shortfall
- both paths share privacy/exclusion predicates
- floor path respects gap-days cooldown
- floor telemetry reports counts only (no owner/repo identifiers)

## What Didn't Work

1. **`private !== true` was too weak** — it accepted `private: undefined`.
   - Fix: reuse the exact threshold-path predicate (`entry.private !== false || accessPrivate`).

2. **The initial plan dropped null-group rotation** — floor candidates with `null` last_survey_at would always win the oldest-first sort, starving dated candidates.
   - Fix: preserve rotation across the merged threshold+floor pool via `prioritizeDispatches`.

3. **The pure-engine/logger boundary was inconsistent** — early drafts emitted directly to `core.warning` inside the engine.
   - Fix: emit through the injected `ReconcileLogger` boundary; the engine stays pure.

4. **First test spec had impossible combinations** — e.g. "11 threshold + 5 floor + cap=12" when floor cannot fire if threshold already meets `FLOOR_MIN`.
   - Fix: model the test scenarios against the actual gate logic before writing assertions.

## Prevention

1. Design for both ceiling and floor requirements up front.
2. Use the same predicate for both gates — no weaker filter on the floor.
3. Add gap-days cooldown to prevent ping-pong (floor fires → repo surveyed → floor fires again next run).
4. Surface a counter plus counts-only log line for operator visibility.
5. Make telemetry best-effort so observability cannot abort the pipeline.

## Related

- [Silent Failures in Autonomous Multi-Step Pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md) — the "silence becomes loud" principle this floor implements
- [Private repo dispatch requires definitive public visibility](../security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md) — engine-side fail-closed privacy gate the floor inherits
- [Survey Repo dispatch boundary trusted caller-provided owner/repo](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md) — workflow-side counterpart; defense-in-depth pair
- [Loose-then-tight schema migration pattern](./loose-then-tight-schema-migration-pattern-2026-05-05.md) — the additive `flooredDispatches` field follows this approach
- [Observability before structural change](./observability-before-structural-change-2026-06-09.md) — before adding state to harden this floor, prove the gap is real; otherwise ship a derived counter and revisit trigger
