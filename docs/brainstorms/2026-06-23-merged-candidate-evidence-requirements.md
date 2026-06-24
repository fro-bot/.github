---
title: 'Merged-candidate evidence for dual-trigger PRs'
date: 2026-06-23
status: ready
scope: standard
kind: requirements
parent: docs/brainstorms/2026-06-22-c2-failed-then-fixed-capture-requirements.md
---

# Merged-candidate evidence for dual-trigger PRs

## Purpose

Fix a delivery bug exposed by live validation of the failed-then-fixed (ci-fix) capture
trigger: a PR that matched both triggers loses its ci-fix evidence before it can be authored.
Attach the ci-fix evidence to the review candidate instead of dropping it, so the
most-informative PRs — those that both drew review rounds and broke then fixed CI — yield one
proposal grounded in both signals.

## The vision in one sentence

When a PR both drew substantive review and failed-then-fixed CI, Fro Bot learns from the whole
story — what the reviewers flagged and what broke and got fixed — in a single proposal.

## Problem frame

Live validation proved the ci-fix trigger detects correctly (real candidates, real fixing
diffs, privacy gate clean) but never authored a proposal. Root cause: `buildCandidateDigest`
runs within-run dedup (one candidate per merge SHA, review-heavy precedence) *before* the cap
floor. In this repo nearly every substantive PR gets ≥2 Fro Bot review rounds, so a
failed-then-fixed PR is almost always also review-heavy; within-run dedup collapses it to
review-heavy and discards the ci-fix evidence, leaving the floor nothing to reserve. The two
mechanisms — R4 within-run dedup (drop, review-heavy wins) and the ci-fix cap floor — fight
each other.

The fix reframes the conflict: a PR matching both triggers is not a tiebreak to arbitrate, it
is the **richest** learning source. Attach the ci-fix evidence to the surviving review
candidate instead of dropping it, so one proposal carries both signals.

## Requirements

- R1. Keep the discriminated `Candidate` union (`ReviewCandidate | CiFixCandidate`) — `trigger`
  stays the branch key, preserving existing narrowing, privacy branches, emitters, and tests.
  Add one optional field to `ReviewCandidate`: `ciFix?` (`failingCheckName`, `diffExcerpt`,
  `logExcerpt?`). A `ReviewCandidate` may now carry attached ci-fix evidence; `CiFixCandidate`
  remains for pure-ci-fix PRs (failed CI, no substantive review). This lower-churn shape was
  chosen over collapsing the union into optional-everywhere fields, which is more refactor than
  the bug needs.
- R2. Within-run collapse for a same-SHA dual-trigger PR becomes an **attach**, not a drop: the
  `ReviewCandidate` survives (review prose is the richer base) and the `CiFixCandidate`'s
  evidence is attached to its `ciFix` field. Pure single-trigger PRs are unchanged. One proposal
  per merge SHA still holds (parent doc R4) — now via attach, not drop, so ci-fix evidence is
  no longer discarded.
- R3. The upstream privacy scan runs **per evidence type, independently and fail-closed**, on
  the **final merged candidate** (after the same-SHA merge, never on pre-merge fragments — merged
  evidence must not bypass the scan). The scan iterates **every populated evidence field every
  time**, not only the field where a hit was found: each present evidence type is redacted for
  structural secrets first, then dropped if a private-repo-name or residual hard-secret survives.
  A hit in one evidence type drops only that type; clean evidence of the other survives. Because
  every populated type is always scanned, a private identifier appearing in both diff and review
  prose is caught in both. No unscanned evidence of any type reaches the agent.
- R3a. **Serialization allowlist.** Only the allowlisted evidence/identifier fields may survive
  into the digest the agent sees and the public issue. Absent evidence fields carry no metadata
  forward; no raw PR object, owner/repo/number/title, or stale fragment may ride along on the
  candidate. The authored body is built only from already-scanned evidence, and the open step's
  body scan remains the final backstop.
- R4. The agent prompt has one branch that describes whatever evidence is present and instructs
  the agent to distill from both when both exist (review prose + the failure→fix story).
- R5. The cap floor (`selectWithCiFixFloor`) stays, retargeted to reserve slots for candidates
  that **carry ci-fix evidence** — a pure `CiFixCandidate` OR a `ReviewCandidate` with a `ciFix`
  field attached (a `hasCiFixEvidence(candidate)` helper) — so ci-fix learnings are guaranteed
  authoring slots regardless of the review-heavy backlog. The floor runs on the merged candidate set
  **before** the privacy scan drops any evidence, so a candidate's floor eligibility is decided
  by the ci-fix evidence it was harvested with, not by whether that evidence later survived
  redaction. (A candidate selected by the floor whose ci-fix evidence is then dropped on a
  privacy hit still proceeds — title-only or on its surviving review evidence — exactly as a
  privacy hit behaves today.)
- R6. Telemetry stays counts-only: per-evidence-type blocked counters and a count of merged
  (dual-trigger) candidates. "Merged" is counted by candidates carrying both evidence types;
  review/ci-fix membership derives from which evidence fields are present (no separate
  double-counted trigger tally).

## Scope boundaries

- Keep the discriminated union; attach `ciFix` evidence to the review candidate on a same-SHA
  dual-trigger collapse.
- No change to the propose-only model, dedup-by-merge-SHA (still one proposal per SHA), the
  per-run cap, the secret-scan pattern set, or the seen-set / solutions dedup behavior.
- Pure-review and pure-ci-fix PRs still produce single-evidence candidates — the merge only
  changes the overlap case.

### Deferred

- C3 (issue triage), C4 (cross-run) — unchanged from the parent, still deferred.
- Any change to per-trigger cap budgeting beyond the existing floor.

## Open questions (for planning)

- **Q2 — Merge mechanics + ordering.** Where the same-SHA merge runs (it must run first, before
  seen-set and solutions dedup, so later stages see the merged candidate), how freshness order
  is preserved for the merged record, and the field-collision rules: `signals` when the two
  records differ (review vs ci-fix harvested distinct token sets), and how a merged record's
  evidence is assembled when one side was already empty.
- **Q5 — Prompt evidence presentation.** How the prompt presents both evidence sets so the
  agent distills a unified learning rather than two stapled-together ones.

(Resolved by the requirements, not open: the union is KEPT, with `ciFix?` attached to
`ReviewCandidate` (R1) — not a union collapse; the floor keys on `hasCiFixEvidence` covering
both the attached and pure cases (R5); the scan runs on the final candidate over every populated
evidence field incl. an attached `ciFix` (R3). Refactor posture: characterization-first to lock
current single-evidence behavior before adding the attach path.)

## Success criteria

- **SC1** — A PR that matched both triggers yields ONE candidate carrying both `reviewExcerpts`
  and `ciFix` evidence (not collapsed to one source).
- **SC2** — A private-name or secret in the diff drops only the ci-fix evidence; clean review
  prose on the same candidate survives (and vice versa). Mutation-proven per evidence type.
- **SC3** — The cap floor reserves a slot for a candidate carrying ci-fix evidence even when it
  also carries review evidence and review-heavy candidates fill the rest.
- **SC4** — A live capture run authors a proposal grounded in ci-fix evidence (the bug this doc
  fixes): `emitted` includes a candidate with ci-fix evidence, and the opened proposal
  references the fixing diff.
- **SC5** — Pure-review and pure-ci-fix candidates still behave as before (characterization).

## Sources & references

- Parent: docs/brainstorms/2026-06-22-c2-failed-then-fixed-capture-requirements.md
- Plan: docs/plans/2026-06-22-004-feat-c2-failed-then-fixed-capture-plan.md
- The validation finding: capture run 28069117571 emitted 0 ci-fix candidates despite
  detecting 3, because within-run dedup ran before the floor (memory of the diagnosis).
- Code: scripts/capture-learnings-harvest.ts (`Candidate` union, `buildCandidateDigest`
  within-run dedup + `selectWithCiFixFloor`, `applyEnrichmentScanAvailability`),
  scripts/capture-learnings-privacy.ts (the shared gate), scripts/capture-learnings-open.ts
  (title/marker), .github/workflows/capture-learnings.yaml (the prompt)
