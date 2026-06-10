---
title: 'feat: Survey floor stuck-repo observability'
type: feat
status: active
date: 2026-06-09
origin: docs/brainstorms/2026-06-09-survey-floor-stuck-repo-observability-requirements.md
---

# feat: Survey floor stuck-repo observability

## Overview

Add a stateless, reconcile-time detector that counts onboarded repos whose
`last_survey_at` has stopped advancing past normal cadence — the fingerprint of a
repo the survey floor keeps re-selecting but that never makes progress (the
cancel-before-resolve window). The count is surfaced as counts-only telemetry in
the reconcile JSON summary and step summary. No new schema field; the structural
fix (stateful dispatch tracking) stays deferred behind this signal firing.

## Problem Frame

The survey floor selects the oldest-surveyed onboarded repos to guarantee
`FLOOR_MIN` dispatches per run. A survey cancelled/killed before its resolve step
completes records nothing, so `last_survey_at` never advances and the floor
re-selects the same repo every run. This is a latent edge — current data shows no
stuck repo — so the response is observability plus a documented residual, not a
schema change (see origin: docs/brainstorms/2026-06-09-survey-floor-stuck-repo-observability-requirements.md).

## Requirements Trace

- R1 (FR1): Stateless detection of stuck candidates from existing metadata at reconcile time.
- R2 (FR2): Threshold derived from the longest channel interval (collab = 30d) plus a grace margin that exceeds `JITTER_MAX_DAYS` (3d) so normal cadence never trips it.
- R3 (FR3): Counts-only telemetry in the JSON summary and step summary — no identifiers in logs.
- R4 (FR4): Document the cancel-before-resolve residual and the revisit trigger.

## Scope Boundaries

- No new `RepoEntry` field, dispatch counter, or dispatch history.
- No cooldown logic, auto-redispatch, or auto-remediation.
- No issue filing — the signal is telemetry, not an alert.
- No migration.

### Deferred to Separate Tasks

- Stateful `last_dispatched_at` + cooldown (the deferred "Option A"): only if R3's counter is ever non-zero across consecutive runs.

## Context & Research

### Relevant Code and Patterns

- `scripts/reconcile-repos.ts` — pure `reconcileRepos(input) -> result` engine. The `next.repos` summary loop (around the `summary.byChannel[...].tracked += 1` site) is where the stuck-candidate count is derived. `formatFloorTelemetry` is the pattern for a counts-only telemetry string. `ReconcileSummary` is the counter container; `FLOOR_MIN_GAP_DAYS`, `JITTER_MAX_DAYS`, and the channel interval constants already exist.
- `.github/workflows/reconcile-repos.yaml` — the step-summary block reads the result JSON and appends lines to `$GITHUB_STEP_SUMMARY`; add the stuck-candidate line there alongside the existing counters.
- `scripts/reconcile-repos.test.ts` — existing engine test suite; add scenarios here.

### Institutional Learnings

- Aggregate-only logging discipline: reconcile logs counts, never canonical repo identifiers (consistent with the privacy model).

## Key Technical Decisions

- Detection is derived in the existing `next.repos` summary pass — one extra comparison per onboarded entry, no new traversal.
- Threshold = longest channel base interval (30d) + grace, with grace strictly greater than `JITTER_MAX_DAYS` (3d) so a repo on normal collab cadence at max jitter never counts. A `null` `last_survey_at` on an onboarded repo counts as stuck (onboarded but never successfully surveyed).
- Output is a single new `ReconcileSummary` counter (e.g. `stuckCandidates`) rendered as one counts-only line, mirroring `flooredDispatches`/`refreshed`.

## Open Questions

### Resolved During Planning

- Population filter: `onboarded` only — pending/null-state repos use a different dispatch path; `lost-access` is excluded from dispatch. (Confirmed by document review.)

### Deferred to Implementation

- Exact grace constant value — chosen during implementation against `JITTER_MAX_DAYS` (must be > 3d; a small explicit margin such as a few days keeps the signal meaningful without false positives).

## Implementation Units

- [ ] **Unit 1: Stateless stuck-candidate detector + telemetry**

**Goal:** Derive a stuck-candidate count in the reconcile engine and surface it as counts-only telemetry in the JSON summary and step summary.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `scripts/reconcile-repos.ts` (add a threshold constant, a `stuckCandidates` field to `ReconcileSummary`, the derivation in the `next.repos` summary pass, and a counts-only telemetry line via the `formatFloorTelemetry` pattern)
- Modify: `.github/workflows/reconcile-repos.yaml` (render the new counter in the step-summary block)
- Test: `scripts/reconcile-repos.test.ts`

**Approach:**
- Add a `STUCK_STALENESS_DAYS` constant = longest channel interval (30) + grace (> `JITTER_MAX_DAYS`); document the derivation in a comment.
- In the existing `next.repos` loop, increment `summary.stuckCandidates` when an `onboarded` entry has `last_survey_at === null`, or its `last_survey_at` age in whole UTC days exceeds the threshold. Reuse the same whole-day UTC age computation the floor gap check uses, for consistency.
- Initialize `stuckCandidates: 0` in the summary alongside the other counters.
- Emit a counts-only telemetry line (no identifiers) when `stuckCandidates > 0`, mirroring `formatFloorTelemetry`.
- Add the counter to the workflow step-summary block.

**Execution note:** Implement test-first (`test-driven-development`).

**Patterns to follow:**
- `formatFloorTelemetry` for the telemetry string shape.
- The `summary.byChannel[...].tracked += 1` loop for where/how to derive per-entry counts.
- The floor gap check's whole-day UTC age computation for threshold comparison.

**Test scenarios:**
- Happy path: a metadata snapshot where all onboarded repos have recent `last_survey_at` → `stuckCandidates === 0` (no false positive on normal cadence, including a repo exactly at 30d + max jitter).
- Edge case: an onboarded repo with `last_survey_at` older than the threshold → counted.
- Edge case: an onboarded repo with `last_survey_at === null` → counted.
- Edge case: a `lost-access` repo with a very old `last_survey_at` → NOT counted (excluded population).
- Edge case: a `pending` repo with `null` survey state → NOT counted (different dispatch path).
- Telemetry: `stuckCandidates > 0` produces a counts-only line with no owner/name/node_id; `=== 0` produces no stuck line.

**Verification:**
- Engine returns `stuckCandidates` in the summary; `0` for current healthy fixtures, non-zero for a stale/null-onboarded fixture.
- Step summary renders the counter; run logs contain no canonical identifiers for stuck candidates.
- `pnpm check-types`, `pnpm lint`, `pnpm test`, and actionlint pass.

- [ ] **Unit 2: Document the accepted residual**

**Goal:** Record the cancel-before-resolve window as a known, accepted residual and the trigger for revisiting the structural fix.

**Requirements:** R4

**Dependencies:** Unit 1 (so the documented signal name matches the implemented counter)

**Files:**
- Modify: `metadata/README.md` (note the residual and that a sustained non-zero `stuckCandidates` count is the signal to implement stateful dispatch tracking)

**Approach:**
- Add a short operator note near the reconcile/survey-cadence documentation describing the residual, the detector, and the revisit trigger. Counts-only framing; no session/agent references.

**Test expectation:** none — documentation only.

**Verification:**
- `metadata/README.md` describes the residual, the `stuckCandidates` signal, and the revisit trigger; markdownlint passes.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Threshold too tight → false positives on normal cadence | Grace strictly greater than `JITTER_MAX_DAYS` (3d); explicit test at 30d + max jitter expects zero. |
| Detector silently smuggles in persistent state | Scope boundary + review: derivation reads only existing fields, no new schema. |
| Identifier leak in telemetry | Counts-only line; test asserts no owner/name/node_id in output. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-09-survey-floor-stuck-repo-observability-requirements.md](../brainstorms/2026-06-09-survey-floor-stuck-repo-observability-requirements.md)
- Related code: `scripts/reconcile-repos.ts`, `.github/workflows/reconcile-repos.yaml`, `scripts/reconcile-repos.test.ts`
