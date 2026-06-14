---
title: 'feat: Survey cadence minimum-dispatch floor'
type: feat
status: complete
date: 2026-05-17
completed: 2026-06-09
origin: docs/brainstorms/2026-05-17-survey-cadence-minimum-floor-requirements.md
---

# feat: Survey cadence minimum-dispatch floor

## Overview

Add a minimum-dispatch floor to `scripts/reconcile-repos.ts` so that scheduled Reconcile Repos runs always make some wiki progress, even when no repo's `next_survey_eligible_at` is ≤ today. The threshold model (per-channel intervals + jitter) continues to set the upper bound on dispatch volume; the floor sets the lower bound on continuous knowledge accumulation.

## Problem Frame

The cadence work shipped in May 2026 (see origin: `docs/brainstorms/2026-05-17-survey-cadence-minimum-floor-requirements.md`) deliberately deferred a per-day quota model and documented the trigger condition for follow-on work: "consecutive-zero-day stretches >7 days even with jitter applied." As of 2026-05-17 the production pipeline has reported `success` with `dispatches: 0` for 9 consecutive daily reconcile runs. The wiki has gone silent for 9 days while every onboarded repo's `next_survey_eligible_at` sits 18-20 days in the future from a May 7-8 clustering event.

The threshold gate is correct as a ceiling. It lacks a floor. This plan ships the floor.

## Requirements Trace

(Mapping origin requirements to plan units; full text in origin.)

- R1 (always dispatch at least `FLOOR_MIN` when candidates exist) → Unit 1
- R2 (pick oldest `last_survey_at` first; nulls first) → Unit 1
- R3 (exclude repos surveyed within `FLOOR_MIN_GAP_DAYS`) → Unit 1
- R4 (exclude `pending-review` / `lost-access` / `private: true`) → Unit 1
- R5 (`summary.flooredDispatches` counter + stderr log line) → Unit 1
- R6 (cap enforced after floor merges into pool) → Unit 1
- R7 (floor dispatch updates state identically) → Unit 1 (no special-case; existing `recordSurveyResult` path)
- R8 (pure decision-engine logic, fully unit-tested) → Unit 1

(All requirements land in Unit 1 — the floor is a single coherent change.)

## Scope Boundaries

- **Engine logic only.** The change lives in the pure `reconcileRepos` decision function and its test file plus the engine's existing `ReconcileLogger` boundary. The I/O shell, dispatch staggering, App-token plumbing, and workflow YAML are untouched. The floor-fired stderr signal is emitted via the existing `ReconcileLogger` interface that already crosses the pure-engine boundary by injection — same pattern the engine already uses for `warn`-class messages, not a new I/O coupling.
- **Single global floor.** No per-channel sub-floors. If channel starvation becomes a real pattern, a follow-up plan adds them.
- **Constant configuration.** `FLOOR_MIN = 2` and `FLOOR_MIN_GAP_DAYS = 7` ship as `const`. Env-var override is deferred until real cadence shows the constants need tuning.

### Deferred to Separate Tasks

- **Drought-detection issue lifecycle.** If the floor itself yields zero dispatches (every repo is within `FLOOR_MIN_GAP_DAYS`), the run reports `flooredDispatches: 0` and the operator sees the counter via run summary. Filing a GitHub issue for that condition is deferred — the counter is sufficient signal until operation shows it isn't.
- **Cluster smoothing migration.** This plan does not retroactively re-jitter the existing June-cluster. Floor dispatches will naturally re-spread the population over the next 2-3 weeks as they update `next_survey_eligible_at`.
- **Env-var tunable constants.** `RECONCILE_FLOOR_MIN` and `RECONCILE_FLOOR_GAP_DAYS` overrides can ship if production needs them. Not now.
- **Per-channel floor counts.** Single global floor is sufficient for v1.
- **`pending-review` backfill from floor.** `pending-review` exists because a human hasn't approved the repo. Floor must not bypass that gate.

## Context & Research

### Relevant Code and Patterns

- `scripts/reconcile-repos.ts:578-595` — current dispatch-eligibility logic in `classifyTracked`. Floor replaces the eligibility check at the dispatch-loop merge step (around line 1172), not in `classifyTracked` itself.
- `scripts/reconcile-repos.ts:1180-1185` — existing prioritization: nulls-first, then oldest `last_survey_at`. Floor reuses this ordering.
- `scripts/reconcile-repos.ts:1184` — `repoSurveyMap = new Map(plan.nextRepos.repos.map(r => [\`${r.owner}/${r.name}\`, r.last_survey_at]))`. Floor logic can reuse this map for gap-days filtering.
- `scripts/reconcile-repos.test.ts` — existing test patterns for the engine. Test file co-located. `makeEntry()` / `makeAccess()` helpers. Use Vitest `describe` / `it` blocks following the same convention as the new dispatch-loop tests added in PR #3293.
- `scripts/reconcile-repos.ts` summary type — extend `ReconcileSummary` with `flooredDispatches: number` next to `dispatchesDeferred`.

### Institutional Learnings

- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — the "silence becomes loud" principle. The floor's log line + counter exists specifically to make zero-dispatch days operator-visible.
- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — dispatch logic must never expose private repos. Floor inherits this constraint via R4 (exclude `private: true`).

### External References

None needed. Internal engine logic, no framework or API surface to research.

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| `FLOOR_MIN = 2` | Brainstorm-proposed value. Daily cron × 2 = 14/week steady throughput. Comfortable margin from the 12-cap. Single-seat Anthropic capacity handles 2 sequential surveys per run without bunching. |
| `FLOOR_MIN_GAP_DAYS = 7` | Long enough to prevent ping-pong. Short enough that with N=20+ collab repos, the floor will reliably find 2 candidates outside the gap. |
| **Oldest-first regardless of source** when threshold and floor candidates merge | Determinism + explainability. Matches existing prioritization (nulls-first, then oldest `last_survey_at`). The merged dispatch list is sorted once; no separate threshold-priority lane. |
| **`flooredDispatches` counter as the drought signal** | Counter visible in JSON summary + stderr log line. No issue lifecycle in v1. If the counter pattern proves insufficient, follow-up plan adds drought-issue dedup/close. |
| **Floor adds to pool *before* cap enforcement** | Per R6. Cap remains the upper bound. Floor merges into the candidate list, then `slice(0, MAX_DISPATCHES_PER_RUN)` truncates. `dispatchesDeferred` continues to count what got cut. |
| **Pure-function placement** | Floor logic lives entirely in `reconcileRepos` (the pure decision engine), including the floor-fired log emission via the existing injected `ReconcileLogger`. I/O shell, workflow, and dispatch staggering remain identical. Test coverage is unit-level only — the log injection point is testable via a mocked logger in the same pattern existing dispatch-path tests use. |
| **Single-pass merge that preserves existing null-group rotation** | Build the threshold-eligible list, build the floor-eligible list (gap-filtered), merge and dedupe by `owner/name`, then apply the existing null-group rotation step (rotate the null-`last_survey_at` leading group by day ordinal so all never-surveyed repos cycle through dispatch slots across successive runs) **before** sorting the rest by `last_survey_at` ascending and slicing to cap. The rotation is not optional — dropping it would re-introduce the alphabetical-starvation pattern the existing dispatch loop explicitly avoids. |

## Open Questions

### Resolved During Planning

- **What is `FLOOR_MIN`?** Resolved: `2`.
- **What is `FLOOR_MIN_GAP_DAYS`?** Resolved: `7`.
- **Floor vs threshold ordering?** Resolved: oldest-first regardless of source.
- **Drought-detection issue lifecycle?** Resolved: deferred. Counter + log line is sufficient v1.
- **Backfill `pending-review` from floor?** Resolved: no. Excluded with `lost-access` and `private: true`.

### Deferred to Implementation

- **Exact stderr log message wording.** Implementer picks something clear that includes the floor count and the threshold count, e.g., `floor fired: dispatched N because threshold yielded M`. Not architecturally significant.
- **Whether to log when the floor finds zero candidates.** Probably yes (drought-of-drought signal), but the message vs silence decision is best made when the code is in front of someone. Same counts-only constraint applies if the log fires.
- **Whether `flooredDispatches` should be reflected in `byChannel` breakdowns.** Probably no (single global floor is global), but if every floor dispatch happened to come from one channel, surfacing that may help. Decide while wiring the counter.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                ┌─────────────────────────────────────────┐
                │  current tracked repos (plan.nextRepos) │
                └────────────────┬────────────────────────┘
                                 │
                ┌────────────────┴───────────────┐
                │                                │
         ┌──────▼──────┐                  ┌──────▼───────┐
         │  threshold  │                  │    floor     │
         │  eligible   │                  │  eligible    │
         │  candidates │                  │  candidates  │
         └──────┬──────┘                  └──────┬───────┘
                │                                │
                │  - filter: not pending-review  │  - filter: not pending-review
                │  - filter: not lost-access     │  - filter: not lost-access
                │  - filter: not private         │  - filter: not private
                │  - filter: next_survey_eligible│  - filter: not surveyed within
                │    _at ≤ today                 │    FLOOR_MIN_GAP_DAYS
                │                                │
                └────────────────┬───────────────┘
                                 │
                            ┌────▼─────┐
                            │  merge   │
                            │  dedupe  │
                            │  sort    │  oldest last_survey_at first
                            │          │  (nulls first)
                            └────┬─────┘
                                 │
                       ┌─────────▼──────────┐
                       │  slice(0, CAP)     │
                       │  CAP=12            │
                       └─────────┬──────────┘
                                 │
                       ┌─────────▼──────────┐
                       │  dispatch (90s     │
                       │  stagger, existing │
                       │  I/O shell)        │
                       └─────────┬──────────┘
                                 │
                       ┌─────────▼──────────┐
                       │  summary updates:  │
                       │  - dispatches      │
                       │  - flooredDispatches│
                       │  - dispatchesDeferred│
                       └────────────────────┘
```

Floor logic conceptually:

```
flooredDispatches = max(0, FLOOR_MIN - thresholdEligibleCount)
                    bounded by len(floorEligibleCandidates)
                    bounded by remaining cap budget after threshold dispatches
```

Note the third constraint: the floor never pushes total dispatches over the cap. If the threshold alone produced ≥ cap candidates, the floor adds zero (since it would only push deferred count higher without dispatching anything new).

## Implementation Units

- [x] **Unit 1: Add minimum-dispatch floor to `reconcileRepos`**

**Goal:** Implement the floor logic in the pure decision engine. Floor merges into the existing dispatch list before cap enforcement. Counter and log line surface the floor's activity.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8

**Dependencies:** None.

**Files:**

- Modify: `scripts/reconcile-repos.ts` — extend `ReconcileSummary` with `flooredDispatches`, add floor logic to the dispatch-loop merge step, emit log line when floor fires.
- Modify: `scripts/reconcile-repos.test.ts` — add test scenarios covering the floor's behavior, edge cases, and interaction with the threshold and cap.

**Approach:**

- Add two `const` declarations near the existing `DEFAULT_MAX_DISPATCHES_PER_RUN`: `FLOOR_MIN = 2` and `FLOOR_MIN_GAP_DAYS = 7`.
- Extend `ReconcileSummary` with `flooredDispatches: number` initialized to 0 in `createEmptySummary` (or wherever the existing counters initialize).
- In the dispatch-loop merge step (around `scripts/reconcile-repos.ts:1170-1200`):
  1. Build `thresholdEligible: RepoEntry[]` as today (the result of `classifyTracked` filtered for dispatch).
  2. If `thresholdEligible.length < FLOOR_MIN`, compute `floorEligible: RepoEntry[]` by filtering `plan.nextRepos.repos` for entries that:
     - Have `onboarding_status === 'onboarded' || onboarding_status === 'pending'` (same as today's gate, just without the `next_survey_eligible_at` check).
     - Are NOT in `thresholdEligible` (dedupe).
     - Pass the same fail-closed publicness check the existing dispatch gate uses (`entry.private === false` AND the access-list entry's `private === false` AND the node-level privacy index reports no non-public aliases and no duplicate-node conflicts — i.e., reuse the existing `wouldDispatchIfPublic` predicate / shared helper, do not introduce a separate stored-field-only filter). `private: undefined` (legacy or transient unknown) is treated as not-public and excluded, matching the existing fail-closed posture (R4).
     - Have `last_survey_at` either `null` OR more than `FLOOR_MIN_GAP_DAYS` days ago relative to `params.now` (R3).
  3. Sort `floorEligible` by `last_survey_at` ascending (nulls first), matching existing prioritization.
  4. Take `floorNeeded = min(FLOOR_MIN - thresholdEligible.length, floorEligible.length)` entries from the head.
  5. Merge: `dispatchCandidates = [...thresholdEligible, ...floorTaken]`.
  6. Re-sort the merged list by `last_survey_at` ascending (nulls first) so threshold-eligible repos don't always land before floor-eligible ones in dispatch order.
  7. Slice to `MAX_DISPATCHES_PER_RUN` (cap enforcement unchanged).
  8. Increment `summary.flooredDispatches` by the count of `floorTaken` entries that survived the cap. Repos cut by the cap that came from the floor count toward `dispatchesDeferred` exactly like threshold-deferred entries.
- When the floor fires (`floorTaken.length > 0`), emit a single stderr log line via the existing `ReconcileLogger` boundary (mirror the engine's existing warn-class emission pattern). **The log line must contain counts only — no `owner`, `repo`, `node_id`, or any other per-repo identifier.** Per-repo identity leakage through dispatch-path logs has been a regression class before in this codebase (see the privacy-gate compound docs); the floor signal must hold the same line.
- Keep `ReconcileLogger.warn` / `info` channels intact; the floor log goes through whichever channel matches existing dispatch-related operator messaging.
- No changes to `recordSurveyResult`, `dispatchRenovate`, or any I/O shell — the floor is transparent to downstream code paths.

**Execution note:** Test-first. The pure-function placement makes RED-first natural: write all 12 test scenarios below, confirm they fail, then implement the floor logic until GREEN. Existing tests in `scripts/reconcile-repos.test.ts` must remain green throughout.

**Technical design:** See High-Level Technical Design section above. The floor is a single merge step inserted between the existing classification and the existing cap. No new data structures, no priority queue, no nested loops.

**Patterns to follow:**

- `scripts/reconcile-repos.ts:1180-1185` — existing prioritization sort. Reuse the same comparator (`null`-first, then string-ascending).
- `scripts/reconcile-repos.ts:1184` — `repoSurveyMap` pattern. Build a similar lookup of `last_survey_at` keyed by `owner/name` for the gap-days filter.
- `scripts/reconcile-repos.test.ts` dispatch-loop describe blocks — same `makeEntry()` / `makeAccess()` fixtures, same `mockOctokit` boundary.
- `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — engine-level privacy gating. Floor must inherit the `private: true` exclusion.

**Test scenarios:**

- **Happy path — threshold yields 5, floor needed: 0.** Run with 5 threshold-eligible repos; assert `flooredDispatches: 0` and that the dispatch list contains exactly the 5 threshold repos.
- **Happy path — threshold yields 0, floor finds 2.** All repos are inside their `next_survey_eligible_at` window. Floor finds 2 repos outside the 7-day gap. Assert `dispatches: 2`, `flooredDispatches: 2`, and the 2 oldest-`last_survey_at` repos got dispatched.
- **Happy path — threshold yields 1, floor adds 1.** Mixed pool. Assert `dispatches: 2`, `flooredDispatches: 1`, and the dispatch list contains the threshold repo plus the oldest floor-eligible repo.
- **Edge case — threshold yields 2, floor not needed.** Assert `dispatches: 2`, `flooredDispatches: 0`.
- **Edge case — threshold yields 0, floor candidate pool empty.** All repos were surveyed within the last 7 days. Assert `dispatches: 0`, `flooredDispatches: 0`, no log line.
- **Edge case — threshold yields 0, floor finds 1 only (population is tiny).** Only 1 repo passes all floor filters. Assert `dispatches: 1`, `flooredDispatches: 1` — floor takes what it can.
- **Edge case — null `last_survey_at` repos sort first under floor.** A never-surveyed repo and an old-surveyed repo are both floor-eligible; assert the null-surveyed repo dispatches first.
- **Edge case — cap interaction.** Threshold yields 11, floor finds 5 more candidates. Cap is 12. Assert `dispatches: 12`, `flooredDispatches: 1`, `dispatchesDeferred: 4` (the 4 floor candidates that didn't make the cap).
- **Edge case — gap-days boundary.** A repo surveyed exactly `FLOOR_MIN_GAP_DAYS` days ago is OUT (boundary is strict-greater-than). A repo surveyed `FLOOR_MIN_GAP_DAYS + 1` days ago is IN. Cover both with explicit `params.now` and `last_survey_at` values.
- **Error path — `private: true` repo excluded from floor.** Floor pool would otherwise include a private repo; assert it's filtered out and not in the dispatch list.
- **Error path — `private: undefined` (legacy or transient unknown) repo excluded from floor.** Stored privacy is unset; assert the fail-closed posture excludes it from the floor pool, matching the threshold gate's behavior.
- **Error path — access-list flags repo as private even though stored `private: false`.** The live access list says private; assert the floor pool excludes the repo because both stored AND live must agree on public.
- **Error path — node-level duplicate / non-public alias triggers fail-closed.** Two access-list entries share a `node_id` and one is private; assert the floor pool excludes the matching tracked repo via the same node-level rule the threshold gate uses.
- **Edge case — null-group rotation persists across merged floor + threshold pool.** Three never-surveyed repos (alphabetically `a-repo`, `b-repo`, `c-repo`) all eligible. Simulate three successive runs with different day ordinals; assert each repo gets a turn at the head of the rotation rather than `a-repo` perpetually winning.
- **Error path — `pending-review` repo excluded from floor.** Same shape: assert it's filtered out.
- **Error path — `lost-access` repo excluded from floor.** Same shape: assert it's filtered out.

**Verification:**

- All test scenarios green; no existing tests regress (current baseline verified 2026-05-17: 539 passing across 21 test files; the new floor scenarios should push the total higher without changing any existing assertion).
- `pnpm check-types` clean.
- `pnpm lint` clean.
- The `reconcileRepos` return value's `summary.flooredDispatches` field is present and accurately reflects the floor-driven additions in every scenario.
- A manual mental simulation of the current production state (20 collab repos with `next_survey_eligible_at` in June, last surveyed early May) confirms the floor would dispatch 2 repos on the next reconcile run.

## System-Wide Impact

- **Interaction graph:** The floor sits inside the pure `reconcileRepos` engine. No changes to the I/O shell (`main()` body), no changes to `survey-repo.yaml`, no changes to `commitMetadata`, no changes to `dispatch-renovate.ts`. Downstream consumers see additional dispatch payloads but with the same shape — they cannot distinguish floor dispatches from threshold dispatches (intentional: floor is transparent at the dispatch boundary).
- **Error propagation:** Floor failures are not possible — it's a pure filter + sort. Any errors during floor logic are programmer errors (e.g., undefined `last_survey_at` slipping through), caught by tests.
- **State lifecycle risks:** None new. Floor uses the existing `repoSurveyMap` pattern for `last_survey_at` lookups; no new state, no caching, no persistence concerns. The downstream `recordSurveyResult` path writes the same `last_survey_at` + `next_survey_eligible_at` regardless of dispatch origin.
- **API surface parity:** `ReconcileSummary` gains one field (`flooredDispatches`). Any consumer reading the summary JSON (the workflow log, future drought-detection tooling) sees the new field. No breaking change — existing consumers ignoring the field continue to work.
- **Integration coverage:** Unit tests on `reconcileRepos` are sufficient. The dispatch I/O shell does not branch on dispatch origin, so no integration-level coverage is needed for the floor specifically — existing dispatch-loop integration tests apply unchanged.
- **Unchanged invariants:** Threshold gate semantics (`next_survey_eligible_at ≤ today` for `onboarded`; `last_survey_status !== 'success' || ...` for `pending`) are not modified. Per-channel intervals (`OWNED_INTERVAL_DAYS = 14`, `CONTRIB_INTERVAL_DAYS = 21`, `COLLAB_INTERVAL_DAYS = 30`) are not modified. Jitter logic is not modified. Dispatch cap (`DEFAULT_MAX_DISPATCHES_PER_RUN = 12`) is not modified. Stagger (`DEFAULT_DISPATCH_STAGGER_MS = 90_000`) is not modified. Privacy exclusion (`private: true` skipped) is not modified. Identity / authority / integrity-check rules are not modified.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Floor accidentally re-surveys the same repo every day. | `FLOOR_MIN_GAP_DAYS = 7` plus the gap-filter logic ensures a 7-day cooldown. Test scenario explicitly covers the boundary. |
| Floor's privacy filter is weaker than the threshold gate's. | Floor reuses the same fail-closed `wouldDispatchIfPublic` predicate as the threshold path (stored `private === false` AND access-list `private === false` AND node-level no-non-public-aliases AND no duplicate-node conflicts). Treating `private: undefined` as not-public matches the existing posture. Two error-path test scenarios explicitly cover unknown-privacy and node-level fail-closed cases. |
| Floor starves later-sorting repos by always picking alphabetically earliest. | The single-pass merge preserves the existing null-group rotation step; floor candidates fold into the rotation. New test scenario asserts rotation order across simulated successive runs. |
| Floor masks a real bug in the threshold model (e.g., `next_survey_eligible_at` corruption causes all repos to look ineligible forever). | Operator sees `flooredDispatches > 0` paired with `dispatches == flooredDispatches` for many consecutive runs — that pattern is a visible signal that the threshold has stopped working. The `summary.byChannel.collab.dispatched` field continues to break down per channel for diagnostics. |
| Floor adds Anthropic seat pressure on quiet days. | `FLOOR_MIN = 2` is well within capacity (single-seat handles 2 sequential 5-min sessions with 90s stagger). Cap remains 12. |
| New `flooredDispatches` field breaks a downstream consumer. | None today — the JSON summary is consumed only by the run log. Even if future consumers depend on the shape, adding a field is backward-compatible (existing field set unchanged). |
| Floor over-disrupts the existing cadence cluster. | Floor only fires when threshold yields fewer than `FLOOR_MIN`. As the cluster naturally drains (June ~5-10), threshold will yield ≥ `FLOOR_MIN` and floor sleeps. The natural equilibrium is "floor fills the trough, threshold handles the peak." |
| `pending` repos with `last_survey_status !== 'success'` (failed initial surveys) might be picked up by floor and re-dispatched even though they're churning. | The existing threshold gate for `pending` already allows dispatch if `last_survey_status !== 'success'` — the floor would either match the same behavior or be redundant. Worst case is a slight increase in retry frequency for failing repos, which is operator-desirable for getting unstuck. |

## Documentation / Operational Notes

- **No new docs files required.** The plan itself is the documentation surface. The brainstorm and plan together capture the rationale for the constants chosen.
- **Operator-visible signal.** After the first successful production run with the floor active, the `summary.flooredDispatches` field appears in the reconcile run log. No additional dashboards, no notifications, no escalation. If a drought pattern emerges *of the floor itself* (e.g., `flooredDispatches: 0` for 7+ days), file a follow-up plan for drought-detection issue lifecycle.
- **Existing learnings updates.** `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` may benefit from a cross-reference to this plan once it ships, framed as "the floor is another instance of the same principle." Optional cleanup, not part of this plan's scope.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-17-survey-cadence-minimum-floor-requirements.md](../brainstorms/2026-05-17-survey-cadence-minimum-floor-requirements.md)
- **Related plan:** [docs/plans/2026-05-05-001-feat-survey-cadence-and-multi-channel-discovery-plan.md](2026-05-05-001-feat-survey-cadence-and-multi-channel-discovery-plan.md) — the cadence plan that explicitly deferred this work; line 53 documents the trigger condition this plan satisfies.
- **Related code:** `scripts/reconcile-repos.ts` — the engine being modified.
- **Related compound docs:**
  - `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — "silence becomes loud" principle.
  - `docs/solutions/security-issues/private-repo-dispatch-visibility-gate-2026-05-08.md` — engine-level privacy gating that the floor inherits.
