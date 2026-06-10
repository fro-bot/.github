---
title: Survey floor stuck-repo observability
date: 2026-06-09
status: requirements
type: requirements
---

# Survey floor stuck-repo observability

## Problem

The reconcile survey floor (`FLOOR_MIN`) guarantees a minimum number of survey
dispatches per run by selecting the oldest-surveyed onboarded repos. Survey
completion advances `last_survey_at` via `recordSurveyResult`; the floor then
moves on to the next-oldest repo.

A survey that is cancelled or killed **before its resolve step completes** (hard
queue timeout, runner eviction, cancel during checkout/setup) records nothing —
the existing fallback recorder in `survey-repo.yaml` is gated on the resolve step
having succeeded. In that narrow window, `last_survey_at` never advances, so the
floor keeps re-selecting the same repo on every run, silently burning a floor
slot on a repo that can never make progress.

This is a **latent** edge, not an observed problem. Current evidence:

- Of the last 25 Survey Repo runs: 23 success, 1 failure, 1 cancelled.
- The `last_survey_at` distribution on `data` is healthy and well-spread; no
  onboarded repo shows a stale date stuck while others advance.
- The oldest entry (`marcusrbrown/copiloting`, 2026-04-23) is `lost-access`, so
  it is correctly excluded from dispatch — not stuck.
- The shipped failure-recording (the `survey-repo.yaml` fallback step) already
  covers the realistic failure/cancel cases where resolve succeeded.

So the structural fix (a stateful `last_dispatched_at` field + cooldown +
migration) would add permanent carrying cost to guard a window that current data
shows is not leaking. This document scopes the lighter response: make a stuck
repo **observable** if one ever emerges, and document the residual as accepted.

## Goals

- Surface a stuck-repo signal at reconcile time, derived purely from existing
  metadata (no new persistent state).
- Document the cancel-before-resolve window as a known, accepted residual.
- Keep the structural fix (stateful dispatch tracking) explicitly deferred behind
  this signal actually firing.

## Non-Goals

- No `last_dispatched_at` field or any new `RepoEntry` schema field.
- No dispatch counter or per-repo dispatch history (that would reintroduce the
  carrying cost this work avoids).
- No cooldown logic in floor/threshold selection.
- No auto-redispatch or auto-remediation.
- No issue filing — the signal is telemetry, not an alert.
- No migration.

## Requirements

### FR1 — Stateless stuck-repo detection

At reconcile time, the engine derives a stuck-repo candidate count from the
current metadata snapshot, with no new persistent fields:

- Consider only `onboarded` repos (the population the floor actually dispatches).
- A repo is a stuck candidate when its `last_survey_at` is older than a staleness
  threshold that exceeds normal cadence — the longest channel interval plus a
  grace margin, so normal scheduling never trips it.
- `null` `last_survey_at` on an onboarded repo (never successfully surveyed
  despite onboarding) also counts as a stuck candidate.

### FR2 — Threshold derived from cadence

The staleness threshold is the longest channel base interval (`collab` = 30 days)
plus a grace margin. The exact grace value is an implementation decision, chosen
so that a repo on a normal 30-day collab cadence with maximum jitter never counts
as stuck — only a repo that has genuinely stopped advancing does.

### FR3 — Counts-only telemetry

The reconcile run reports the stuck-candidate count in:

- the JSON summary (a new counter, consistent with existing summary counters), and
- the reconcile step summary (a counts-only line, consistent with the existing
  floor/refresh telemetry).

Output is counts-only — no repo names, owners, or `node_id`s in logs (consistent
with the repo's existing aggregate-only logging discipline). If an operator needs
to identify the specific stuck repo, they use existing local operator tooling
against the metadata, not the public run log.

### FR4 — Documented residual

The cancel-before-resolve window is documented as a known, accepted residual in
the operator docs (`metadata/README.md`) and/or the relevant plan, including the
trigger condition for revisiting the structural fix: if the stuck-candidate
counter from FR3 is ever non-zero across consecutive runs, that is the signal to
implement stateful dispatch tracking (the deferred Option A).

## Success Criteria

- SC1: A reconcile run against current healthy metadata reports zero stuck
  candidates (no false positives on normal cadence).
- SC2: A reconcile run against a fixture with an onboarded repo whose
  `last_survey_at` exceeds the threshold (or is `null`) reports a non-zero
  stuck-candidate count.
- SC3: No new `RepoEntry` field is introduced; the detector reads only existing
  metadata.
- SC4: Run logs contain no canonical repo identifiers for stuck candidates —
  counts only.
- SC5: The residual and its revisit trigger are documented.

## Open Questions

- Exact grace margin for the threshold (FR2) — resolved in planning against the
  jitter range (`JITTER_MAX_DAYS` = 3) so the floor's own scheduling never trips
  the detector.

## Decision Log

- Chose stateless detection over the stateful `last_dispatched_at` field after a
  pressure test showed no observed stuck-repo problem and confirmed the shipped
  failure-recording already covers the realistic failure modes. The structural
  fix stays deferred behind this signal firing.
