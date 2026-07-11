---
date: 2026-07-02
topic: plan-consistency-claim-kind
title: Plan-consistency claim kind for Status Truth
---

# Plan-consistency claim kind for Status Truth

## Summary

Add a self-audit claim kind to the Status Truth loop: every plan under `docs/plans/` is implicitly
checked for consistency between its frontmatter `status` and its implementation-unit completion
markers. A shipped plan whose frontmatter still says `active` becomes a drifted finding and a
proposal issue through the existing proposal machinery.

---

## Problem Frame

Plan frontmatter goes stale silently. On 2026-07-02, three shipped capture plans still carried
`status: active` a week after their PRs merged; the drift was found only by manual reconciliation
during an A2 review. The existing `plan-status` claim kind cannot catch this class: it verifies
cross-file prose claims against frontmatter, so when the frontmatter itself is the stale artifact
and nobody wrote a prose claim about the plan, the drift is invisible to the loop.

Each plan already carries its own evidence of completion — per-unit checkboxes or per-unit status
lines — sitting in the same file as the frontmatter that contradicts them. No scanned surface, no
seeding convention, and no API call is needed to compare the two.

---

## Actors

- A1. Marcus: reviews proposal issues, applies outcome labels, fixes stale frontmatter.
- A2. Fro Bot: audits the plan corpus during Status Truth runs and plans proposals for drifted
  plans.
- A3. Plan authors (human or agent sessions): produce the frontmatter and unit markers the audit
  reads.

---

## Requirements

**Audit model**

- R1. Every file under `docs/plans/` is audited on each Status Truth run without requiring a prose
  claim or seeded sentence.
- R2. The audit emits one synthetic claim per plan file, fingerprinted by plan path and claim kind,
  flowing through the existing report contract, privacy gates, proposal caps, and outcome-label
  lifecycle.
- R3. The audit is file-parse only: no GitHub API calls, no tracker snapshot, no write credentials.

**Unit-marker grammar**

- R4. The audit recognizes exactly one unit-completion encoding: checkbox units
  (`- [x] **Unit N: ...**` / `- [ ] **Unit N: ...**`).
- R5. When a plan contains no recognizable unit markers, or its markers are malformed or mixed in a
  way the grammar cannot classify, the finding is unresolved, never drifted.
- R6. The one heading-encoded plan in the corpus
  (`docs/plans/2026-06-30-001-feat-status-truth-signal-completion-plan.md`) is normalized to
  checkbox encoding as part of this slice, so the audited corpus is uniformly checkbox-encoded at
  launch.

**Drift matrix**

- R7. When frontmatter status is `active` and every recognized unit is marked complete, the finding
  is drifted and proposal-eligible with proposed correction `status: complete`.
- R8. When frontmatter status is `complete` and at least one recognized unit is not marked
  complete, the finding is unresolved (attention signal), not drifted.
- R9. When frontmatter status is missing, malformed, or outside the supported vocabulary of the
  existing plan-status resolver, the finding is unresolved.
- R10. All other combinations — `active` with unfinished units, `complete` with all units done,
  `draft`, `cancelled`, or `superseded` with any unit state — are current.

**Output safety**

- R11. Workflow summaries and logs stay counts-only for this kind; plan paths and unit details
  appear only in artifacts and proposal bodies after the existing public-output gate. Plan paths
  are public repo paths and are safe in gated output.
- R12. Proposal bodies, evidence fields, and correction copy carry only normalized data: plan path,
  frontmatter status value, and unit counts. Raw plan body text, unit titles, and frontmatter
  excerpts are never copied into any public artifact.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R7.** Given a plan with `status: active` whose units are all `[x]`, when
  the Status Truth scan runs, one drifted, proposal-eligible finding is produced with proposed
  correction `status: complete` — without any prose claim referencing the plan.
- AE2. **Covers R8.** Given a plan with `status: complete` and one unchecked unit, when the scan
  runs, the finding is unresolved and no proposal is planned.
- AE3. **Covers R5.** Given a plan with no Implementation Units section, when the scan runs, the
  finding is unresolved and no proposal is planned.
- AE4. **Covers R9.** Given a plan with `status: code-complete-pending-verification`, when the scan
  runs, the finding is unresolved.
- AE5. **Covers R4, R5.** Given a plan whose units use a non-checkbox encoding (for example
  `### U1.` headings with `Status:` lines), when the scan runs, the finding is unresolved and no
  proposal is planned.
- AE6. **Covers R2.** Given more drifted plans than remaining mutation budget, when proposal
  planning runs, overflow findings are reported as blocked counts under the existing cap.
- AE7. **Covers R12.** Given a drifted plan whose body text contains an arbitrary repo reference,
  when a proposal is rendered, the proposal body contains the plan path, claimed status, live unit
  counts, and proposed correction — and no sentence copied from the plan body.

---

## Success Criteria

- Replaying the audit against the pre-reconciliation tree from 2026-07-02 yields exactly three
  drifted findings (the three stale capture plans) and zero false positives across the rest of the
  corpus.
- On the reconciled corpus with the heading-encoded plan normalized, the audit yields zero drifted
  findings and exactly one expected unresolved finding
  (`2026-06-15-001`, unsupported status `code-complete-pending-verification`).
- A future stale-frontmatter plan produces a proposal issue on the next Status Truth run instead of
  waiting for manual reconciliation.
- Planning can proceed without inventing behavior: drift matrix, unit grammar, and lifecycle
  integration are all specified here.

---

## Scope Boundaries

- No completion-date inference (`completed:` values come from humans or other tooling, not this
  audit).
- No cross-checking `completed:` dates against merge history.
- No prose rewriting or plan-body edits; the proposal proposes a frontmatter correction only.
- No auditing of non-plan documents (brainstorms, solutions, README).
- No bounded correction PR execution; proposals only, consistent with the A2 graduation gate.
- No corpus-wide format migration beyond normalizing the single heading-encoded plan (R6).
- No cross-kind dedupe of correlated findings in v1: a stale plan with a prose claim in
  `docs/status.md` may produce one self-audit finding and one prose-claim finding; the mutation cap
  bounds the noise and fixing the frontmatter clears both.

---

## Key Decisions

- **Self-audit over prose claims:** seeding prose claims for every plan recreates the
  signal-starvation problem this kind exists to fix; the corpus is small, local, and public, so
  implicit full coverage is safe and cheap.
- **One-directional drift:** only `active` + all-units-done drifts. The reverse
  (`complete` + unchecked) has legitimate explanations (descoped units, summary-style plans) and
  fails toward attention instead of proposals — protecting the first outcome-collecting claim kinds
  from false positives.
- **Proposal-eligible from day one:** the existing mutation cap, dry-run-first workflow, and
  post-reconciliation zero-drift baseline bound the blast radius.
- **Checkbox-only grammar with corpus normalization:** the corpus survey (2026-07-02) found 24
  checkbox-encoded plans and 1 heading-encoded plan. Supporting a second grammar forever for one
  file is worse than normalizing the file; the odd plan converts to checkbox encoding in this
  slice and unrecognized encodings degrade to unresolved, which is honest signal.
- **Terminal labels are per-plan opt-outs:** the synthetic claim fingerprints by plan path and
  kind, so a `rejected` or `false-positive` label permanently exempts that plan from future
  consistency proposals. This is intended semantics — the label says "my convention differs for
  this plan; stop auditing it" — and the operator docs must state it.
- **Implicit coverage is still a reviewable change:** the A2 rule that new claim kinds land as
  reviewable repo changes is satisfied by this document and its implementing PR; what is reviewed
  is the kind's definition and drift matrix, not a per-plan seeding decision.

---

## Dependencies / Assumptions

- Status Truth detect/proposal foundation (`scripts/status-truth-detect.ts`,
  `scripts/status-truth-proposals.ts`, `.github/workflows/status-truth.yaml`) remains the host.
- The existing extraction path is regex-over-text only; synthetic per-file claims need a new
  file-level claim builder alongside `extractStatusTruthClaimsFromText`. Planning owns the seam
  design; the report contract, privacy gates, caps, and lifecycle stay shared.
- Assumption (validated 2026-07-02): after normalizing the one heading-encoded plan, every current
  plan uses checkbox unit encoding or has no units; re-run the corpus survey during planning to
  catch changes.
- The supported status vocabulary stays aligned with the existing plan-status resolver
  (`SUPPORTED_PLAN_STATUSES`).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Whether the synthetic claim reuses the `plan-status` proposal body
  template or needs kind-specific correction copy (bounded by R12 either way).
- [Affects R4][Technical] Exact tolerance for unit-marker variations (bold-less unit labels,
  nested checkbox lists, lettered sub-units) — characterize from the corpus while writing tests.
- [Affects R7][Technical] Whether a drifted finding's proposed correction should also suggest a
  `completed:` date placeholder or leave the field to the operator.
