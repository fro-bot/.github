---
title: 'C2 — Failed-then-fixed capture trigger'
date: 2026-06-22
status: ready
scope: standard
kind: requirements
parent: docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md
---

# C2 — Failed-then-fixed capture trigger

## Purpose

Add the second capture trigger to the grow-and-learn pipeline. Today the capture run learns
only from PRs that went through multiple substantive review rounds. This adds PRs whose CI
**failed then passed before merge** — a concentrated mistake→correction signal — feeding the
same propose-only pipeline. The parent doc deferred this trigger to "Phase 2.5, once
multi-round-review precision is proven"; that precondition is met (the trigger shipped,
validated live, and review-prose enrichment raised proposal quality).

## The vision in one sentence

When a pull request breaks CI and a fix turns it green before merge, Fro Bot captures the
"this failure → this fix" lesson as a proposed learning, the same way it already learns from
review-heavy PRs.

## Problem frame

A CI failure that gets fixed is a clean, structured mistake→correction event: a named check
went red, a diff turned it green. That is exactly the kind of concrete signal the
review-prose enrichment proved produces good learnings — and exactly what the multi-round
trigger's title-only first cut lacked. The data is queryable: a PR's check-run history shows
the fail→pass transition, the failing run's logs carry the actual error, and the fixing
commits carry the diff. C3 (issue triage) is deferred because its resolution rationale lives
in free-text comments with no clean structured signal — the weak-signal trap the enrichment
follow-up (#3552) flagged.

## Accepted risk — value gate

C1's signal *precision* is proven (it finds real review-heavy PRs and authors specific,
useful learnings, and Phase 1 retrieval live-fired — Fro Bot cited a prior learning on a real
issue). What is **not** yet measured is corpus *adoption* over time: do the authored docs keep
getting retrieved and applied across many future runs? C2 broadens the "grow" half before that
slow signal is in. This is an accepted risk: C2's failed-then-fixed is an independently clean,
high-signal source (not speculative), and the cost of a second proven-clean trigger is low.
If corpus adoption later proves weak, the lever to revisit is the retrieval/authoring side, not
the number of capture triggers.

## Requirements

- R1. The capture run identifies merged PRs (in the existing lookback window, this repo only)
  whose required checks transitioned **failed → passed** before merge — a fail→fix event.
- R2. For each such PR, the digest carries: the failed check name(s), a **failing-step log
  excerpt** (ranked toward the error lines, budgeted per candidate), and the **fixing diff**
  (the change that turned the check green). This is the agent's primary signal — it distills
  "this failure → this fix."
- R3. The new digest content (logs and diffs) passes the existing fail-closed upstream
  private-repo-name scan **plus a stronger log/diff-specific scan**, applied before the content
  reaches the agent. CI logs and diffs are a wider leak surface than review prose: they can
  carry secrets/tokens (masked or not), internal hostnames/URLs, environment values, and file
  paths that the private-repo-name token scan does not catch — and the agent authors a
  **public** issue from this content. The log/diff scan must detect and redact (or drop on)
  secret-shaped strings, internal URLs/hostnames, and credential-shaped content, not only
  tracked private-repo-name tokens. Never unscanned log/diff content reaches the agent.
- R3a. On a privacy/secret hit in log/diff content, the safe default is to **drop the enriched
  log/diff for that candidate**; the candidate may proceed only on already-clean signal
  (e.g. the failed check name, which is not sensitive). The fallback signal must itself be
  proven non-sensitive — a candidate must never reach the public-issue step carrying
  unsanitized log/diff content.
- R4. A PR is proposed **at most once** regardless of how many triggers it matches — a PR that
  was both review-heavy and failed-then-fixed yields one learning-proposal. The existing
  merge-SHA body marker already dedups by merge SHA; C2 candidates dedup against the same set.
- R5. C2 reuses the existing pipeline end to end: the opaque digest contract, the shared
  privacy module, the merge-SHA marker, the `learning-proposal` label, the per-run cap, and
  the capture workflow. It is a **new candidate source**, not a new pipeline.
- R6. Telemetry stays counts-only (no owner/name/path in logs); the harvest summary gains a
  per-trigger candidate count so an operator can see C2's contribution.

## Scope boundaries

- C2 (failed-then-fixed) only. This repo only, same lookback as the existing harvest.
- "Failed then passed" is a transition on the PR's checks before merge — not a flaky single
  re-run with no diff. A fix with a real diff is required (a pure re-run that flips green with
  no code change is not a learning).
- No change to the propose-only model, the privacy contract, the dedup marker, or the cap.

### Deferred

- **C3 — Issue triage.** Murky free-text signal; revisit after C2 proves failed-then-fixed
  learning quality, and only with a structured proxy (e.g. issues closed by a linked PR).
- **C4 — Cross-run synthesis.** Phase 3.
- Cross-repo C2 (other fro-bot repos): later; v1 is this repo only.

## Open questions (for planning)

- **Q1 — Transition detection mechanism. THE LOAD-BEARING RISK.** Detecting a fail→pass
  transition is not a single cheap query: GitHub's check-runs / commit-status APIs report state
  **per head SHA**, not a PR-level history, so a transition must be reconstructed by correlating
  check state across a PR's successive head SHAs (an O(merged-PRs × pushes) fan-out). Planning
  must settle: which API (check-runs per SHA vs. commit-status timeline), how to bound the cost,
  how "required checks" are determined at merge time (branch-protection required contexts are
  current-state config, not necessarily historical), and how to require a real fixing diff (not
  a bare green re-run). If this proves too expensive or unreliable, C2's signal needs rethinking
  before build — this question gates the trigger.
- **Q1a — Log retention.** Actions logs are retention-bounded (default ~90 days, sometimes
  less), so a PR inside the lookback window may have purged failing logs. Planning must define
  the degrade/skip rule when logs are unavailable (e.g. proceed on diff + check name only, or
  skip the candidate) — the log excerpt cannot be assumed always fetchable.
- **Q2 — Failing-log fetch + ranking.** Which failing run/job/step to pull, how to rank the
  excerpt toward the error lines (mirror the correction-first ranking from enrichment), and the
  per-candidate budget. Logs/diffs are much larger than review prose — truncate to budget
  **before** the privacy/secret scan so the scan and the agent never see the full volume.
- **Q3 — Fixing-diff scope.** The diff "that fixed it" — the commits between the last failing
  SHA and the first passing SHA — vs. the whole PR diff. The narrower fixing-commit range is
  the sharper signal but needs the transition SHAs from Q1 (downstream of the hard part).
- **Q4 — Evidence model.** The existing `Candidate` shape is review-specific (`reviewRounds`,
  `reviewExcerpts`). Planning must decide whether C2 widens it to a shared evidence model or
  overloads those fields — "new source, not new pipeline" still requires a candidate shape that
  isn't review-only.

(Resolved by the requirements, not open: privacy hit → drop enriched content, keep clean
signal (R3a); per-run cap is the existing shared budget, not per-trigger (R5).)

## Success criteria

- **SC1** — A capture run identifies a real failed-then-fixed PR in the window and emits a
  candidate carrying the failed check name, a log excerpt, and the fixing diff.
- **SC2** — The new log/diff content passes the upstream scan fail-closed for BOTH a tracked
  private-repo-name token AND secret-shaped content with no repo-name present: fixtures with a
  secret/token-shaped string, an internal hostname/URL, and a credential-shaped string in a diff
  are each dropped/redacted (mutation-proven), not just the private-repo-name case.
- **SC3** — A PR matching both triggers yields exactly one learning-proposal (dedup holds).
- **SC4** — A produced proposal distills a specific "failure → fix" lesson grounded in the
  log/diff, not the PR title (the enrichment-quality bar).
- **SC5** — Telemetry shows the per-trigger candidate count; logs remain counts-only.

## Sources & references

- Parent: docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md (Phase 2.5
  deferred C2/C3; "add once multi-round-review precision is proven")
- Plan: docs/plans/2026-06-22-002-feat-capture-c1-proposals-plan.md (the propose-only pipeline)
- Plan: docs/plans/2026-06-22-003-feat-enrich-capture-digest-plan.md (review-prose enrichment
  + the upstream privacy-gate pattern C2 reuses)
- Code: scripts/capture-learnings-harvest.ts (the harvest to extend with a second source),
  scripts/capture-learnings-privacy.ts (the shared fail-closed gate), scripts/capture-learnings-open.ts,
  .github/workflows/capture-learnings.yaml
- Follow-up #3552 (digest-quality finding that motivates evidence-rich C2 content)
