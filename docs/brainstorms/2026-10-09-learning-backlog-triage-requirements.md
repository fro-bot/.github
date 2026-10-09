---
date: 2026-10-09
topic: learning-backlog-triage
---

# Learning Backlog Triage

## Summary

Clear all 13 open learning-proposal issues in one pass. Twelve become four new solution docs and four extensions of existing docs, grouped by incident or theme; #3906 closes as already covered. Every doc goes through `ce:compound`, and one PR closes each proposal it addresses.

---

## Problem Frame

`capture-learnings` opens a learning-proposal issue for each merged PR that needed multiple review rounds or went red-then-green in CI. The proposals are drafts: they only become durable knowledge when someone authors them into `docs/solutions/`. That authoring happens in occasional manual batches (the last was #3868, five proposals on 2026-09-08), so proposals accumulate between batches.

Thirteen are open now, the oldest from 2026-09-14. The daily report has listed the backlog under "Needs Human Attention" since the pipeline resumed producing proposals. Several proposals describe the same incident from different merge commits — three cover the `_extends` label-prune saga, two cover calibrating performance guards — so authoring them one-to-one would scatter single lessons across multiple docs. One (#3906) restates a lesson `docs/solutions/` already holds.

---

## Requirements

**Consolidation**

- R1. #3962, #3963 and #3964 become one new doc on reviewing shared-settings changes against the full effective inherited configuration, using labels as the worked example and covering array replace-versus-merge semantics, sibling arrays such as branch protection, and destructive label removal.
- R2. #3908 and #3909 become one new doc on calibrating performance and scaling guards: a guard must trip on the reconstructed pre-fix defect, CPU-time assertions stay separate from wall-clock timeouts, and an uncalibrated guard is removed while behavioral coverage is kept.
- R3. #3887 becomes one new doc on treating the agent's credential preflight and checkout credential settings as a functional contract, including gating untrusted issue-triggered runs.
- R4. #3888 becomes one new doc on LFS checkout that exits 0 without materializing content, and on verifying postconditions instead of exit codes.
- R5. #3907 extends `docs/solutions/best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md` with a guard that returns the same value for unreadable data and an absent signal, which builds a fail-open into its type.
- R6. #3905 extends `docs/solutions/workflow-issues/quoted-required-status-check-context-2026-06-09.md` with deriving required-status-check context strings from the workflow instead of restating them.
- R7. #3890 and #3891 extend `docs/solutions/workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md` with mirroring the producer's parser grammar and removing an exemption whose trust decision keeps getting relocated.
- R8. #3889 extends `docs/solutions/best-practices/dependency-holds-need-lift-conditions-2026-08-31.md` with "a satisfied floor is not a safe floor", plus the override-floor deadlock: per-package remediation PRs cannot pass a gate that audits every advisory at once (resolved by #3959 and #3968). The deadlock material is verified against #3959, #3968 and the failing `main` Lint runs from 2026-09-30 to 2026-10-08, like any proposal claim.
- R9. #3906 closes with a pointer to `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`; no doc change.

**Authoring quality**

- R10. Every new doc and extension is authored through the `ce:compound` phased process, not as an ad-hoc writeup.
- R11. Each claim taken from a proposal is verified against the merged PR or current code before it is codified; unverifiable claims are dropped.
- R12. When a proposal's core lesson cannot be verified, it is not folded into any doc; it closes with a comment naming what could not be verified.
- R13. Before authoring, each target is re-checked against `docs/solutions/` so an existing doc is extended rather than duplicated.
- R14. New docs follow the repository's existing frontmatter and filename conventions.
- R15. No doc names or describes a private repository.

**Delivery**

- R16. All docs land in one PR, with a separate closing keyword per addressed issue.
- R17. The PR body records, per proposal, its disposition (new doc, extension, covered, or unverified), its source merge SHA, and any claims dropped or narrowed during verification, as evidence for the follow-up pipeline brainstorm.
- R18. The repository's lint gate passes, including solution link and example checks.

---

## Acceptance Examples

- AE1. **Covers R11, R17.** Given a proposal claims a reviewer found a specific defect, when the merged PR or current code does not show that defect but the proposal's core lesson still holds, the claim is left out, the proposal closes into its doc, and the PR body lists the dropped claim.
- AE2. **Covers R12.** Given a proposal whose core lesson cannot be verified, it closes with an "unverified" disposition and a comment naming the gap, and no doc absorbs it.
- AE3. **Covers R13.** Given the overlap re-check finds an existing doc that already covers a planned new doc's core lesson, the content goes into that doc as an extension instead.

---

## Success Criteria

- No proposal from this batch remains open, and each closed issue links to the doc that absorbed it, the doc that already covered it, or a comment explaining why it could not be verified.
- Fro Bot's review of the PR passes without factual corrections to the codified claims.
- The next daily report no longer lists the learning backlog under "Needs Human Attention" for these proposals.
- The pipeline brainstorm can start from the recorded dispositions without re-reading the 13 proposals.

---

## Scope Boundaries

- Changing the capture pipeline (filtering, drafted-doc PRs, synthesis cadence) — deferred to its own brainstorm after this pass.
- Proposals opened after this pass begins.
- Rewriting existing solution docs beyond the extension sections named above.
- Wiki (`knowledge/`) edits.

---

## Key Decisions

- One doc per incident or theme, not per proposal: keeps the label and performance-guard lessons whole instead of spread across six docs.
- The override-floor deadlock joins the `dependency-holds` extension: it is the same root topic as #3889, and no proposal captured it.
- One PR for the whole batch: matches the #3868 precedent and gives one review of the full knowledge delta.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R4][Technical] Category, title, and filename for each new doc.
- [Affects R10][Technical] Whether docs are authored serially or as parallel isolated lanes merged into one branch.

---

## Sources

- Coverage map of all 13 proposals against `docs/solutions/`, with issue numbers re-verified against the proposal bodies: only #3906 fully covered; partial coverage for #3887, #3888, #3889, #3890, #3891, #3905, #3907.
- #3868 — prior batch of five proposals compounded into one PR.
- #3966 — daily report item 1 that raised this backlog.
