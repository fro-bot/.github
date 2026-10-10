---
date: 2026-10-09
topic: drafted-solution-docs
---

# Drafted Solution Docs

## Summary

A scheduled job turns open learning proposals into one drafted docs PR: each claim verified against its source evidence, related proposals consolidated, new or extended `docs/solutions/` docs written, and a per-proposal evidence table recorded. A no-write agent drafts; a trusted publish job gates and opens the PR. Fro Bot reviews it through a narrow exception to its self-skip rule; the operator reviews and merges, and the proposals close with it.

---

## Problem Frame

`capture-learnings` opens learning-proposal issues weekly. They become durable knowledge only when someone authors them into `docs/solutions/`, and that authoring is a manual batch the operator has to start, research, consolidate, verify, and ship. Proposals wait until the next batch: 53 have been opened since June, and the two most recent batches (#3868 with five proposals, #3970 with thirteen) each took a full multi-step session.

Human authoring was a deliberate June decision: unreviewed docs in `docs/solutions/` would poison what agents retrieve later (see `docs/plans/2026-06-22-002-feat-capture-c1-proposals-plan.md`). The cost the operator wants removed is the batching labor, not the review. The #3970 pass showed the labor follows a fixed process — verify each claim, check overlap, consolidate, write, gate — and that independent review still matters: Fro Bot's review caught a factual error the verification lanes had missed.

Fro Bot's PR review currently skips any PR whose author ends in `[bot]` or is `fro-bot` (`.github/workflows/fro-bot.yaml`), so a PR opened by automation gets no review today.

---

## Requirements

**Drafting**

- R1. A scheduled run processes every open learning proposal opened by capture when at least one is open; with none open it does nothing.
- R2. Each claim taken from a proposal is verified against its merged PR, that PR's reviews and CI runs, and current `main`. Claims that do not hold, or that depend on evidence outside those sources, are dropped or narrowed and never codified.
- R3. Proposals that describe the same lesson are consolidated into one doc; a lesson an existing doc already covers extends that doc instead of creating a new one.
- R4. A proposal whose core lesson cannot be verified, or that an existing doc already fully covers, gets no new doc text; its outcome and reason are recorded.
- R5. Drafted docs follow the repository's existing solution-doc conventions and pass the repository's lint gate, including the solution link and example checks.
- R6. The drafting agent treats proposal bodies and PR, review, and CI content as data, not instructions.

**Delivery**

- R7. The drafting agent holds no repository write credential. It hands its drafted changes and PR metadata to a trusted publish job that holds the only write credential and contains no agent step.
- R8. The publish job writes all drafted docs from a run to one PR on a stable branch; if that PR is still open, the run updates it instead of opening another.
- R9. The PR body carries a per-proposal evidence table — outcome, target doc, source merge SHA, claims dropped or narrowed — and a separate closing keyword for each proposal it addresses, so every addressed proposal closes when the PR merges.
- R10. When a run produces no doc changes, the publish job comments on each processed proposal with its outcome and reason and closes it; no PR is opened.
- R11. The drafted PR never merges without the operator; automerge is not used.
- R12. Nothing in the drafting run writes to `main` or to the `data` branch.

**Review and privacy**

- R13. Fro Bot reviews a PR authored by the publish job's App identity only when its head branch is the drafted-docs branch. Every other bot- or `fro-bot`-authored PR keeps being skipped.
- R14. Drafted docs, the PR body, and every proposal comment pass the same private-repository check that gates proposal issues before posting; a failure blocks publication and is reported.

**Reporting**

- R15. While an open drafted PR covers open proposals, the daily report's "Progressive Improvement" section points to that PR instead of reporting those proposals as stalled.

---

## Acceptance Examples

- AE1. **Covers R1, R8.** Given two open proposals and no open drafted PR, a run opens one PR addressing both; given a third proposal next week while that PR is still open, the next run adds it to the same PR.
- AE2. **Covers R4, R9.** Given one verified proposal and one already covered by an existing doc, the PR changes docs for the first, records the second as covered with its covering doc, and both close on merge.
- AE3. **Covers R10.** Given only proposals that are covered or unverifiable, no PR opens; each proposal gets a comment with its outcome and closes.
- AE4. **Covers R14.** Given a drafted doc or comment that names a private repository, nothing is published and the block is reported.
- AE5. **Covers R13.** Given a Renovate PR authored by the same App on a `renovate/*` branch, Fro Bot still skips it.
- AE6. **Covers R15.** Given open proposals covered by an open drafted PR, the daily report points to the PR instead of reporting a stalled pipeline.

---

## Success Criteria

- The operator's only step between capture and a merged solution doc is reviewing and merging one PR.
- Every open proposal is drafted, or closed with a reason, within one run.
- Fro Bot's review runs on every drafted PR, and its findings are resolved before merge.
- No agent step in the drafting run holds a repository write credential.

---

## Scope Boundaries

- Changing how proposals are captured, filtered, or deduplicated at capture time (drafting-time consolidation in R3 is in scope).
- Changing capture-patterns clustering or the O8 improvement metric.
- Automerge of drafted PRs.
- Drafting from sources other than open learning-proposal issues.
- A size or age limit that splits the rolling PR.

---

## Key Decisions

- Draft-and-review, not auto-publish: docs reach `docs/solutions/` only through a reviewed merge, preserving the June reason for human authoring while removing the batching.
- Proposal issues stay: they already provide capture-time dedup and feed capture-patterns.
- No-write agent plus trusted publish job: the same split `capture-learnings` and the wiki handoff already use; it bounds what injected proposal text can do.
- Review exception keyed on App author and drafted-docs branch together: narrow enough that Renovate, autoheal, and other automation PRs keep their current skip.
- One rolling PR with no split rule: nothing merges without the operator, so a size limit buys nothing yet.

---

## Dependencies / Assumptions

- The App identity the publish job uses can create branches and PRs in this repository.
- Fro Bot's review job can run on App-authored PRs once the skip exception admits them; whether any credential or branch-protection rule blocks that review is a planning check.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7, R8][Technical] Artifact format for the drafted changes and PR metadata, and how the publish job applies them to the stable branch.
- [Affects R13][Technical] Whether `require_last_push_approval` or any other branch-protection rule interacts with Fro Bot reviewing an App-pushed PR.
- [Affects R1][Technical] Schedule: a separate workflow after the weekly capture run, or a job within it.
- [Affects R2, R3][Technical] How much of the `ce:compound` research and verification process runs inside one CI agent session.

---

## Sources

- #3868, #3970 — manual batches this replaces; #3970's PR body is the evidence-table template.
- `docs/plans/2026-06-22-002-feat-capture-c1-proposals-plan.md` — human-authoring decision and its rationale.
- `.github/workflows/capture-learnings.yaml` — no-write agent plus trusted publish split.
- `.github/workflows/fro-bot.yaml` — PR review skip condition; daily report "Progressive Improvement" rule for open proposals.
