---
title: 'fix: attach ci-fix evidence to dual-trigger candidates'
type: fix
status: complete
date: 2026-06-23
completed: 2026-06-24
origin: docs/brainstorms/2026-06-23-merged-candidate-evidence-requirements.md
---

# fix: attach ci-fix evidence to dual-trigger candidates

## Overview

A PR that matched both capture triggers loses its ci-fix evidence: within-run dedup runs before
the cap floor and drops the ci-fix candidate (review-heavy wins), so the floor has nothing to
reserve and a failed-then-fixed learning is never authored. Fix it by attaching the ci-fix
evidence to the surviving review candidate instead of dropping it, retargeting the floor to
"carries ci-fix evidence", and scanning every populated evidence field on the final candidate.

## Problem Frame

Live validation (capture run that examined 106 merged PRs) detected 3 ci-fix candidates yet
emitted 0: in this repo nearly every substantive PR also gets ≥2 review rounds, so the
review-heavy precedence in within-run dedup collapses every dual-trigger PR to review-heavy
before `selectWithCiFixFloor` runs. The dedup and the floor fight each other. The dual-trigger
PR is the richest learning source, so attach both evidence sets rather than arbitrate
(see origin).

## Requirements Trace

- R1. Keep the discriminated union; add optional `ciFix?` evidence to `ReviewCandidate` (origin R1).
- R2. Within-run collapse attaches the ci-fix evidence to the surviving review candidate instead
  of dropping it; one proposal per merge SHA still holds (origin R2).
- R3. The privacy scan runs on the final candidate, over every populated evidence field
  (`reviewExcerpts` and an attached `ciFix`), each redacted-then-dropped-on-residual
  independently (origin R3).
- R3a. Serialization allowlist: only allowlisted evidence/identifier fields reach the digest and
  public issue; no raw PR object or stale fragment rides along (origin R3a).
- R4. The agent prompt distills from both evidence sets when both are present (origin R4).
- R5. `selectWithCiFixFloor` reserves slots for candidates that carry ci-fix evidence — a pure
  `CiFixCandidate` or a `ReviewCandidate` with `ciFix` attached, via `hasCiFixEvidence` (origin R5).
- R6. Counts-only telemetry: per-evidence-type blocked counters and a dual-trigger (merged) count
  (origin R6).

## Scope Boundaries

- Keep the discriminated union; attach `ciFix` to `ReviewCandidate` on same-SHA dual-trigger collapse.
- No change to the propose-only model, dedup-by-merge-SHA, the per-run cap, the secret-scan
  pattern set, or the seen-set / solutions dedup.
- Pure-review and pure-ci-fix PRs are unchanged.

### Deferred to Separate Tasks

- C3 (issue triage), C4 (cross-run) — unchanged, still deferred.
- Collapsing the union into a fully unified optional-fields candidate — rejected as more churn
  than the bug needs (origin).

## Context & Research

### Relevant Code and Patterns

- `scripts/capture-learnings-harvest.ts`:
  - `Candidate = ReviewCandidate | CiFixCandidate` — add optional `ciFix?` to `ReviewCandidate`.
  - `buildCandidateDigest` within-run dedup (~line 361-367): the `byMergeSha` Map keeps one object
    per SHA with review-heavy precedence — change to attach the `CiFixCandidate`'s evidence onto
    the surviving `ReviewCandidate`.
  - The privacy branches (~line 385-413 ReviewCandidate, ~line 385-413 CiFixCandidate): a
    `ReviewCandidate` with `ciFix` must now scan BOTH `reviewExcerpts` and the attached `ciFix`
    evidence, each independently, on the final candidate.
  - `selectWithCiFixFloor` (~line 333): change the predicate from `trigger === 'ci-fail-then-pass'`
    to a `hasCiFixEvidence(candidate)` helper covering the attached and pure cases.
  - `applyEnrichmentScanAvailability`: when the scan is unavailable, also clear an attached `ciFix`
    on a `ReviewCandidate` (today it clears `reviewExcerpts` for review and diff/log for ci-fix).
- `scripts/capture-learnings-open.ts`: title/marker work off `mergeSha` — unaffected by the attach.
- `.github/workflows/capture-learnings.yaml`: the agent prompt — the review branch must mention
  the optional attached ci-fix evidence.

### Institutional Learnings

- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md` — the scan
  stays pure-core, mutation-proven; scanning the final candidate over all fields preserves the
  two-chokepoint fail-closed property.
- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md` — the attached
  evidence is a new field on the public-facing candidate; the allowlist (R3a) keeps the perimeter closed.

## Key Technical Decisions

- **Attach, don't collapse.** Keep `trigger` as the branch key; add `ciFix?` to `ReviewCandidate`.
  Preserves existing narrowing, privacy branches, emitters, and most tests. Lower churn than a
  unified optional-fields candidate, same outcome.
- **Attach runs in within-run dedup, before seen/solutions dedup and the floor**, so every later
  stage sees the merged candidate. Freshness order preserved (the review candidate keeps its
  position).
- **`hasCiFixEvidence(candidate)` helper** — true for a `CiFixCandidate` or a `ReviewCandidate`
  with a non-empty `ciFix`. Used by the floor; defines "carries ci-fix evidence" in one place.
- **Scan all populated evidence on the final candidate.** A `ReviewCandidate` with `ciFix` scans
  `reviewExcerpts` AND the attached diff/log independently; a hit in one drops only that one. The
  floor decides eligibility on harvested evidence, before any privacy drop (origin R5).

## Open Questions

### Resolved During Planning

- Shape → attach `ciFix?` to `ReviewCandidate`, keep the union (origin).
- Privacy on the merged candidate → scan every populated field on the final candidate, per-type
  independent drop (origin R3).
- Floor predicate → `hasCiFixEvidence` (origin R5).

### Deferred to Implementation

- The exact `ciFix` field name/shape on `ReviewCandidate` (reuse the `CiFixCandidate` evidence
  fields verbatim vs a nested object) — pick the minimal-diff form during implementation.
- Whether `applyEnrichmentScanAvailability` needs a new branch or a tweak to the existing review
  branch to also clear an attached `ciFix`.
- The exact telemetry field name for the dual-trigger count.

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
within-run dedup (buildCandidateDigest):
  for each candidate by mergeSha:
    same SHA, one ReviewCandidate + one CiFixCandidate
      → keep the ReviewCandidate, set reviewCandidate.ciFix = ciFixCandidate's evidence  (ATTACH)
    same SHA, two of the same trigger → existing behavior
    unique SHA → unchanged
  ↓ (seen-set dedup, solutions dedup — unchanged)
selectWithCiFixFloor(ordered, cap, floor):
  reserve = filter(hasCiFixEvidence)        // was: trigger === 'ci-fail-then-pass'
  ...unchanged...
  ↓
privacy scan (per candidate, final):
  if ReviewCandidate:
    scan reviewExcerpts (redact → drop-on-residual)            // existing
    if candidate.ciFix: scan ciFix.diff + ciFix.log (independently, same way)   // NEW
  if CiFixCandidate: scan ciFix evidence                        // existing
  ↓ opaque digest (allowlisted fields only)
agent prompt: review branch notes the optional attached failure→fix evidence
```

## Implementation Units

- [x] **Unit 1: Attach ci-fix evidence in within-run dedup + `hasCiFixEvidence` + floor predicate**

**Goal:** A same-SHA dual-trigger PR keeps its ci-fix evidence (attached to the review candidate),
and the floor reserves slots for any candidate carrying ci-fix evidence.

**Requirements:** R1, R2, R5.

**Dependencies:** None.

**Files:**
- Modify: `scripts/capture-learnings-harvest.ts`
- Test: `scripts/capture-learnings-harvest.test.ts`

**Approach:**
- Add optional `ciFix?` (the `CiFixCandidate` evidence: `failingCheckName`, `diffExcerpt`,
  `logExcerpt?`) to `ReviewCandidate`. Change the within-run dedup so when a SHA has both a review
  and a ci-fix record, the review candidate survives with `ciFix` attached. Add
  `hasCiFixEvidence(candidate)` and use it in `selectWithCiFixFloor` instead of the trigger check.

**Execution note:** Characterization-first — lock the current single-trigger dedup + floor behavior
before changing it.

**Patterns to follow:** the existing `byMergeSha` dedup, `selectWithCiFixFloor`, the `CiFixCandidate`
evidence fields.

**Test scenarios:**
- Characterization: a pure-review PR and a pure-ci-fix PR (distinct SHAs) still produce their
  current single-evidence candidates; the floor still reserves the pure-ci-fix one.
- Happy: a same-SHA review+ci-fix pair → one `ReviewCandidate` with `ciFix` attached (the
  regression for the live bug). Assert the ci-fix evidence is present on the survivor.
- Floor: a dual-trigger candidate (review + attached ci-fix) is reserved by the floor even when
  review-heavy candidates fill the rest — the exact production starvation, now fixed.
- Edge: `hasCiFixEvidence` true for pure ci-fix and for review-with-ciFix, false for pure review.
- Edge: two review records same SHA, or two ci-fix records same SHA → existing dedup unchanged.

**Verification:** gates green; the dual-trigger PR retains ci-fix evidence and the floor reserves it.

- [x] **Unit 2: Scan attached ci-fix evidence in the privacy step**

**Goal:** A `ReviewCandidate` with attached `ciFix` has BOTH its review prose and its diff/log
scanned independently, fail-closed, on the final candidate.

**Requirements:** R3, R3a.

**Dependencies:** Unit 1.

**Files:**
- Modify: `scripts/capture-learnings-harvest.ts`
- Modify: `scripts/capture-learnings-harvest.test.ts`

**Approach:**
- In `buildCandidateDigest`'s ReviewCandidate privacy branch, after scanning `reviewExcerpts`, also
  scan an attached `ciFix` (redact structural secrets, then drop the attached `ciFix` on a residual
  private-name or hard-secret hit) — independently from the review-prose result. Update
  `applyEnrichmentScanAvailability` so an unavailable scan also clears an attached `ciFix`. Keep the
  serialization allowlist: only allowlisted fields reach the digest.

**Execution note:** Test-first; the cross-field privacy mutation proof is load-bearing.

**Patterns to follow:** the existing ReviewCandidate and CiFixCandidate privacy branches (redact →
drop-on-residual), the truncate-then-scan ordering invariant.

**Test scenarios:**
- Happy: a dual candidate with clean review prose + clean diff → both survive, redacted.
- Privacy (independent drop): a secret in the attached diff drops ONLY the `ciFix`; clean
  `reviewExcerpts` survive. And the reverse (private name in review prose drops only review).
- Privacy (cross-field): a private name in BOTH review prose and the attached diff → caught in
  both (every populated field scanned every time). Mutation-proven: bypassing the attached-ciFix
  scan lets the diff secret reach the digest → test fails.
- Scan-unavailable: `applyEnrichmentScanAvailability(false)` clears reviewExcerpts AND attached ciFix.
- Allowlist: the emitted dual candidate carries only allowlisted keys (no owner/repo/number/title).

**Verification:** gates green; no unscanned attached evidence reaches the digest; mutation proof bites.

- [x] **Unit 3: Prompt + telemetry for dual-trigger candidates**

**Goal:** The agent distills from both evidence sets when present; telemetry counts dual-trigger
candidates and per-evidence-type blocks.

**Requirements:** R4, R6.

**Dependencies:** Unit 2.

**Files:**
- Modify: `.github/workflows/capture-learnings.yaml`
- Modify: `scripts/capture-learnings-harvest.ts` (telemetry counters)
- Modify: `scripts/capture-learnings-harvest.test.ts`

**Approach:**
- Update the agent prompt's review branch to note that a review candidate may also carry the
  failure→fix evidence (`ciFix`), and instruct distilling from both when present. Add a
  dual-trigger (merged) count and ensure the per-evidence-type blocked counters
  (`enrichmentBlocked`, `enrichmentBlockedBySecret`) cover the attached-ciFix drops. Surface the
  dual-trigger count in the step summary.

**Test scenarios:**
- Telemetry: a run with one dual-trigger candidate increments the merged count; a per-type drop
  increments the right blocked counter.

**Test expectation for the YAML prompt:** none — prompt wording, validated by actionlint + a manual
dispatch showing a dual-trigger proposal that cites the fixing diff.

**Verification:** actionlint clean; a manual capture run authors a proposal grounded in both the
review prose and the fixing diff (the live proof the original bug is fixed).

## System-Wide Impact

- **Interaction graph:** the attach changes only the within-run dedup branch; seen/solutions dedup,
  cap, floor (predicate swap), and privacy (added attached-field scan) are the touch points. The
  open step and emitters are unaffected.
- **Error propagation:** privacy scan stays fail-closed per evidence field; an attached-ciFix hit
  drops only that field.
- **State lifecycle risks:** none new — no persisted state; one proposal per merge SHA preserved.
- **API surface parity:** the shared privacy module is unchanged (the secret/redaction functions
  already exist); both chokepoints still use it.
- **Unchanged invariants:** propose-only model, merge-SHA marker, `learning-proposal` label, the
  per-run cap, opacity (allowlisted fields only), the discriminated union itself.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Attached ci-fix evidence bypasses the scan | R3: scan the final candidate over every populated field; mutation-proven |
| Floor predicate misses attached evidence | `hasCiFixEvidence` covers both pure and attached; tested |
| Refactor breaks current single-trigger behavior | Characterization-first locks pure-review/pure-ci-fix before the change |
| Empty-but-present `ciFix` confuses `hasCiFixEvidence` | Define "carries" precisely (non-empty diff); test the empty/absent boundary |

## Documentation / Operational Notes

- After it lands, dispatch a capture run to confirm a dual-trigger proposal opens grounded in the
  fixing diff — the live proof the delivery bug is fixed (SC4).

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-23-merged-candidate-evidence-requirements.md
- Parent: docs/brainstorms/2026-06-22-c2-failed-then-fixed-capture-requirements.md,
  docs/plans/2026-06-22-004-feat-c2-failed-then-fixed-capture-plan.md
- Code: scripts/capture-learnings-harvest.ts, scripts/capture-learnings-privacy.ts,
  scripts/capture-learnings-open.ts, .github/workflows/capture-learnings.yaml
- Learnings: docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md,
  docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md
