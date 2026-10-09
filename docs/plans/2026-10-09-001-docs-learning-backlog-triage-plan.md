---
title: 'docs: Clear the learning-proposal backlog into docs/solutions'
type: docs
status: active
date: 2026-10-09
origin: docs/brainstorms/2026-10-09-learning-backlog-triage-requirements.md
---

# Clear the learning-proposal backlog into docs/solutions

## Overview

Author the 13 open learning proposals into `docs/solutions/` as four new docs and four extensions (final counts set by reconciliation), close #3906 as covered after verifying the coverage, and close any proposal whose core lesson fails verification as unverified. One PR carries every doc, the brainstorm, this plan, and a per-proposal evidence table (see origin).

## Problem Frame

Proposals from `capture-learnings` only become durable knowledge when authored into `docs/solutions/`. Authoring happens in occasional batches, so 13 proposals have accumulated since 2026-09-14, several describing the same incident from different merge commits (see origin: Problem Frame).

## Requirements Trace

- R1–R8. Consolidation targets: one new doc each for labels/effective inherited config (#3962–#3964), performance-guard calibration (#3908, #3909), agent credential preflight (#3887), LFS checkout postconditions (#3888); extensions for #3907, #3905, #3890+#3891, #3889 plus the override-floor deadlock.
- R9. #3906 closes as covered by `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`.
- R10. Every doc through `ce:compound` Full mode.
- R11–R12. Claims verified before codifying; unverifiable core lessons close as unverified.
- R13. Overlap re-check before each new doc.
- R14–R15. Repo frontmatter/filename conventions; no private-repo references.
- R16–R18. One PR, one closing keyword per issue, evidence table, lint gate green.

## Scope Boundaries

- No changes to the capture pipeline, its scripts, or the solution-doc gates.
- No rewrites of existing docs beyond the named extension sections.
- No `knowledge/` edits; no proposals opened after this pass starts.

### Deferred to Separate Tasks

- Capture-pipeline change so proposals stop accumulating: its own brainstorm, seeded by this PR's evidence table.

## Context & Research

### Relevant Code and Patterns

- Knowledge-track section order: Context, Guidance, Why This Matters, When to Apply, Examples, Related (e.g. `docs/solutions/best-practices/a-mutation-score-can-measure-nothing-2026-09-08.md`).
- Frontmatter in use: `title`, `date`, `category` (matches directory), `module`, `problem_type`, `component`, `severity`, `applies_when`, `tags`; updates add `last_updated`. Filename `slug-YYYY-MM-DD.md`; stems must be unique across categories (`scripts/capture-patterns-synthesis.ts` excludes duplicates).
- Cross-links: bare filename within a category, `../<category>/file.md` across; PRs/issues as plain text.
- Gates touching `docs/solutions/`: `scripts/check-md-links.ts` (relative links) and `scripts/check-solutions-examples.ts` (TS fences parse; ```` ```ts fragment ```` escape; opt-in `<!-- verify: SYMBOL from path -->`). markdownlint and ESLint exclude `docs/solutions/`, `docs/plans/`, `docs/brainstorms/`.
- Consumers of frontmatter: `scripts/solutions-query.ts`, `scripts/capture-learnings-harvest.ts`, `scripts/improvement-metrics-core.ts` (care about `module`, `tags`, `problem_type`, `applies_when`, `last_updated`, `verified`).
- Batch precedent: #3868 (four new docs, two updates, a "claims I had to walk back" section).

### Institutional Learnings

- `docs/solutions/best-practices/requirements-doc-survives-verification-2026-06-24.md` — verify every cited file, step, and contract against the live tree before codifying.
- `docs/solutions/documentation-gaps/verify-doc-slugs-before-linking-2026-08-25.md` — resolve link targets against the live tree.
- `docs/solutions/workflow-issues/required-github-token-for-agent-steps-2026-06-22.md` — adjacent to #3887; cross-link, do not merge (different failure mechanism).
- `docs/solutions/best-practices/exact-match-trust-gates-need-type-discipline-2026-09-08.md` and `docs/solutions/workflow-issues/jq-falsy-coalesce-trap-in-shell-gates-2026-05-17.md` — adjacent fail-open patterns for the #3907 extension's Related section.
- `docs/solutions/workflow-issues/verify-renovate-predicates-against-live-taxonomy-2026-08-31.md` — adjacent settings-contract doc for the labels doc's Related section.

Prior-art survey: exempt — documentation-only work with no behavior change.

## Key Technical Decisions

- Research in parallel, write serially: each doc gets a read-only research lane (`ce:compound` Full-mode Phase 1 — context, solution extraction, related-docs overlap, plus claim verification); one writer lane assembles all docs in one isolated worktree. Matches `ce:compound`'s "subagents return text, orchestrator writes" contract and avoids concurrent writers in one checkout.
- Overlap verdict can re-route a planned new doc to an extension (High overlap) per `ce:compound`; the re-route is recorded in the evidence table.
- The override-floor deadlock is evidenced from #3959, #3968, and `main` Lint failures 2026-09-30 to 2026-10-08, held to the same verification bar as proposal claims (see origin: R8).
- All issues close through PR keywords, one per issue (`Closes #N` repeated), including #3906 and any unverified proposal; the PR body explains each non-doc closure, and each unverified issue also gets a comment naming the gap.
- The merged PR body is the durable evidence record; the follow-up pipeline brainstorm cites that PR.
- The brainstorm and this plan ship in the same PR.

## Open Questions

### Resolved During Planning

- Category/filename per new doc: decided by each research lane's Context Analyzer against `ce:compound`'s schema and the repo's existing categories.
- Serial vs parallel authoring: parallel research, serial writing (above).

### Deferred to Implementation

- Final titles and slugs: depend on what verification leaves standing.
- Whether any proposal ends unverified: only known after verification.

## Implementation Units

- [ ] **Unit 1: Research and verify each target**

**Goal:** Produce, per target, a verified claim set and `ce:compound` Phase 1 output.

**Requirements:** R1–R9, R11–R13, R15

**Dependencies:** None

**Files:** none written (read-only lanes)

**Approach:**
- Nine lanes: the four new-doc groups, four extension targets, and #3906. The #3906 lane verifies, claim by claim, which section of the existing doc covers each reusable claim; any uncovered remainder becomes an extension of that doc. Each reads its proposal bodies, the source merge commits and PRs, and current code; runs Context Analyzer, Solution Extractor, and Related Docs Finder per `ce:compound` Full mode.
- Each lane returns: claims kept, dropped, or narrowed with evidence; source merge SHA(s); frontmatter skeleton and target path; overlap verdict with per-dimension counts; draft section text; any private-repo reference found.
- A lane whose core lesson fails verification returns an unverified verdict naming the gap.

**Test expectation:** none -- research only; Unit 4 gates the written output.

**Verification:**
- Every proposal maps to exactly one outcome: new doc, extension, covered, or unverified.

- [ ] **Unit 1b: Reconcile lane outputs**

**Goal:** Resolve cross-lane conflicts before anything is written.

**Requirements:** R13–R15

**Dependencies:** Unit 1

**Files:** none written

**Approach:**
- Compare all lane outputs for duplicate filename stems across categories, overlapping themes, two lanes targeting the same existing doc, and inconsistent frontmatter (`module`, `tags`, `problem_type`).
- Sweep every draft for private-repository names or descriptions.
- Produce the final target list for Units 2 and 3; record merges and reroutes in the evidence table.

**Test expectation:** none -- reconciliation only.

**Verification:**
- Final target list has unique stems, one owner per existing doc, and no private-repo references.

- [ ] **Unit 2: Write the new docs**

**Goal:** Author the new solution docs from Unit 1's verified output.

**Requirements:** R1–R4, R10, R14, R15

**Dependencies:** Unit 1b

**Files:**
- Create: the new docs on Unit 1b's final target list under `docs/solutions/<category>/` (four expected; fewer if any reroute to Unit 3)

**Approach:**
- One writer in one worktree. Knowledge-track section order; frontmatter validated against `ce:compound`'s schema; Related links to the adjacent docs above.
- Labels doc covers the full effective inherited configuration, with labels as the worked example and branch-protection arrays included (see origin: R1).
- Run `ce:compound`'s Phase 2.5 refresh check per doc; recommend, do not run, any refresh.

**Test expectation:** none -- documentation; gated in Unit 4.

**Verification:**
- Each doc's claims match Unit 1's kept set; no dropped claim reappears.

- [ ] **Unit 3: Extend the existing docs**

**Goal:** Add the extension sections on Unit 1b's final target list.

**Requirements:** R5–R9, R10, R15

**Dependencies:** Unit 1b

**Files:** the four expected targets below, plus any doc that Unit 1b reroutes a new doc or #3906 remainder into

- Modify: `docs/solutions/best-practices/make-failure-boundaries-and-predicates-explicit-2026-08-25.md`
- Modify: `docs/solutions/workflow-issues/quoted-required-status-check-context-2026-06-09.md`
- Modify: `docs/solutions/workflow-issues/lockfiles-are-advisory-until-gated-2026-07-11.md`
- Modify: `docs/solutions/best-practices/dependency-holds-need-lift-conditions-2026-08-31.md`

**Approach:**
- Preserve each doc's path, title, and frontmatter shape; add `last_updated: 2026-10-09`. Add content inside existing sections where it fits; a new section only when nothing fits.
- The dependency-holds extension covers "a satisfied floor is not a safe floor" and the per-package remediation deadlock.

**Test expectation:** none -- documentation; gated in Unit 4.

**Verification:**
- Each extension adds only its lesson; surrounding content is unchanged.

- [ ] **Unit 4: Assemble and gate the PR**

**Goal:** Land everything in one PR with the evidence table and per-issue closures.

**Requirements:** R9, R12, R16–R18

**Dependencies:** Units 2, 3

**Files:**
- Add: `docs/brainstorms/2026-10-09-learning-backlog-triage-requirements.md`, `docs/plans/2026-10-09-001-docs-learning-backlog-triage-plan.md`

**Approach:**
- PR body: short summary, then a table per proposal — issue, outcome, target doc, source merge SHA, claims dropped or narrowed. Then one `Closes #N` line per issue.
- #3906 and any unverified proposal get a sentence in the body naming the covering doc or the verification gap; each unverified issue also gets an issue comment naming the gap, posted with the PR.

**Test scenarios:**
- Happy path: link and example gates pass on every new and modified doc.
- Edge case: a doc with a TypeScript fence either parses or is marked as a fragment.
- Error path: a link to a renamed or missing doc fails `check:md-links` before push.

**Verification:**
- `pnpm bootstrap`, `pnpm check-types`, `pnpm lint`, `pnpm test` exit 0.
- PR body lists all 13 issues, each with its own closing keyword.
- After merge, all 13 issues are closed.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A proposal's lesson rests on a misread review | Unit 1 verifies against the merged PR and code; core-lesson failure closes as unverified |
| Grouped doc blurs distinct lessons | Overlap counts and per-claim evidence decide; extension re-route recorded |
| Private-repo detail leaks from a proposal or review thread | Unit 1 flags it; Unit 1b sweeps every draft; writer omits it |
| Comma-separated closing keywords close only the first issue | One keyword per issue (`Closes #N` repeated) |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-10-09-learning-backlog-triage-requirements.md](../brainstorms/2026-10-09-learning-backlog-triage-requirements.md)
- Proposals: #3887, #3888, #3889, #3890, #3891, #3905, #3906, #3907, #3908, #3909, #3962, #3963, #3964
- Precedent: #3868; daily report #3966
- Deadlock evidence: #3959, #3968
