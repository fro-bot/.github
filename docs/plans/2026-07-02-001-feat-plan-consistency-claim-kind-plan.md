---
title: 'feat: Plan-consistency claim kind for Status Truth'
type: feat
status: complete
date: 2026-07-02
completed: 2026-07-02
origin: docs/brainstorms/2026-07-02-plan-consistency-claim-kind-requirements.md
---

# feat: Plan-consistency claim kind for Status Truth

## Overview

Add a self-audit claim kind to the Status Truth loop. Every plan under `docs/plans/` is implicitly
checked for consistency between its frontmatter `status` and its implementation-unit checkbox
markers. A shipped plan whose frontmatter still says `active` becomes a drifted finding and a
proposal issue through the existing proposal machinery — without requiring a prose claim or seeded
sentence.

## Problem Frame

Plan frontmatter goes stale silently. Three shipped capture plans carried `status: active` a week
after their PRs merged; the drift was found only by manual reconciliation (see origin:
`docs/brainstorms/2026-07-02-plan-consistency-claim-kind-requirements.md`). The existing
`plan-status` kind verifies cross-file prose claims against frontmatter, so when the frontmatter
itself is stale and no prose claim exists, the loop is blind. Each plan already carries its own
completion evidence — unit checkboxes — in the same file as the contradicting frontmatter.

## Requirements Trace

From the origin document:

- R1. Every `docs/plans/*.md` audited each run, no prose claim required.
- R2. One synthetic claim per plan, fingerprinted by plan path and claim kind, flowing through the
  existing report contract, privacy gates, caps, and outcome-label lifecycle.
- R3. File-parse only: no API calls, no snapshot, no write credentials.
- R4. Checkbox unit grammar only (`- [x] **Unit N: ...**` / `- [ ] **Unit N: ...**`).
- R5. Unrecognizable/malformed unit markers → unresolved, never drifted.
- R6. Normalize the one heading-encoded plan to checkbox encoding in this slice.
- R7. `active` + all units checked → drifted, proposal-eligible, correction `status: complete`.
- R8. `complete` + any unchecked unit → unresolved.
- R9. Missing/malformed/unsupported frontmatter status → unresolved.
- R10. All other combinations → current.
- R11. Counts-only summaries and logs; details only in gated artifacts/proposals.
- R12. Every public surface a plan-consistency finding touches — report artifact JSON, proposal
  title, proposal body, update/recurrence/close comments, and stdout summary — carries normalized
  data only (path, normalized status, unit counts). Raw plan body text, unit titles, and
  frontmatter excerpts never appear on any of them.

## Scope Boundaries

- No completion-date inference or `completed:` cross-checks against merge history.
- No plan-body edits by the loop; proposals suggest a frontmatter correction only.
- No auditing of non-plan documents.
- No bounded correction PR execution (A2 graduation gate unchanged).
- No corpus-wide format migration beyond the single R6 normalization.
- No cross-kind dedupe of correlated findings (a stale plan with a prose claim in `docs/status.md`
  may yield two findings; the mutation cap bounds noise).
- No new malformed-attention counter: malformed states are plain unresolved in v1.

## Context & Research

### Relevant Code and Patterns

- `scripts/status-truth-detect.ts` — host module. Key seams: `ClaimKind` union (~line 7);
  `CLAIM_KIND_DEFINITIONS` (regex-extraction registry — the new kind does NOT join it);
  `StatusTruthClaim` interface; `computeClaimFingerprint(kind, path, sourceRef, normalizedText)`;
  `classifyClaim` (naive `liveState === claimedState` equality — insufficient for this kind, see
  Key Technical Decisions); `parsePlanFrontmatterStatus` and `SUPPORTED_PLAN_STATUSES` (reuse);
  `resolveFileParseClaims` (file-parse resolver precedent); `runDetect` orchestration
  (fileLister/read → scan → resolve → classify → report).
- `scripts/status-truth-proposals.ts` — planner consumes generic `PublicStatusTruthFinding`
  fields; no kind-specific plumbing expected. Body copy in `buildProposalTitle`/`buildProposalBody`;
  all surfaces gated via `applyPublicOutputGate`.
- `scripts/status-truth-public-output.ts` — gate API unchanged.
- `.github/workflows/status-truth.yaml` — unchanged; plans are already inside the scanned
  `docs/**/*.md` set and the report/summary path is kind-agnostic.
- No existing checkbox parser anywhere in `scripts/` — the unit-marker parser is net-new.
- Test fixture patterns: `makeClaim`/`makeReport`/`makeFinding` helpers and inline-string
  `FileReader` fakes in `scripts/status-truth-detect.test.ts`.

### Institutional Learnings

- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`: keep
  parsing/classification pure; file-read failures live in the I/O shell.
- `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`: fail
  closed on ambiguity at the trusted chokepoint.
- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`: verify every
  public surface (report artifact, proposal title/body, summary) for the normalized-data-only rule.
- `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`:
  report-only machinery; failures still produce durable reports.

## Key Technical Decisions

- **Separate synthetic claim builder, not a `CLAIM_KIND_DEFINITIONS` entry:** the extraction
  registry is regex-over-text; forcing a pattern would be fiction. A file-level builder emits one
  synthetic claim per plan from already-read file contents inside `runDetect`.
- **Single resolver returns the final verdict:** `classifyClaim` equality would mark `complete` +
  unchecked units as drifted, violating R8. The plan-consistency resolver is one function that
  returns the final verdict (`current | drifted | unresolved`) from the R7–R10 matrix; no
  equality-based fallback path exists for this kind. The matrix is encoded in exactly one place
  and table-tested.
- **Stable fingerprint excludes unit state:** fingerprint inputs are kind, path, and a constant
  normalized text (no checkbox counts), so a plan's fingerprint is stable across drift episodes.
  Terminal labels (`rejected`/`false-positive`) therefore act as permanent per-plan opt-outs —
  intended semantics, documented in README operator docs.
- **claimedState is normalized at ingestion:** the claim carries the frontmatter status only when
  it is in `SUPPORTED_PLAN_STATUSES`; anything else collapses to the fixed sentinel `unsupported`
  before the claim is built, so arbitrary frontmatter text can never reach report JSON or any
  public surface. liveState is the unit-derived state. Proposed correction copy is built from
  normalized fields only (R12), not from `buildProposedCorrection`'s text-replacement path.
- **Plan deletion or rename clears the finding:** a removed/renamed plan drops its fingerprint
  from the next complete scan, and the existing close-on-clear lifecycle closes any open proposal
  as a resolved positive. Accepted v1 semantics: the audited inconsistency ceased to exist with
  the file. The rename case re-emerges under the new path's fingerprint if drift persists.
- **Reuse `parsePlanFrontmatterStatus` and `SUPPORTED_PLAN_STATUSES`:** one frontmatter grammar
  across plan-status and plan-consistency kinds.

## Open Questions

### Resolved During Planning

- Does the planner need kind-specific changes? No — findings that fit `PublicStatusTruthFinding`
  flow through generic lifecycle, caps, and gates.
- Does the workflow need changes? No — file enumeration, report artifact, and counts-only summary
  are kind-agnostic.

### Deferred to Implementation

- Exact tolerance for checkbox variations (bold-less labels, nested lists, lettered sub-units):
  characterize from the corpus while writing parser tests; anything outside the recognized grammar
  is unresolved.
- Whether the proposal body reuses the shared body template verbatim or adds a unit-count line:
  bounded either way by R12.

## Implementation Units

- [x] **Unit 1: Checkbox unit-marker parser**

**Goal:** Pure parser extracting unit-completion counts from plan markdown.

**Requirements:** R4, R5

**Dependencies:** None

**Files:**
- Modify: `scripts/status-truth-detect.ts`
- Test: `scripts/status-truth-detect.test.ts`

**Approach:**
- Pure function: plan file content in, `{checkedUnits, uncheckedUnits}` or a no-markers/malformed
  signal out. No I/O.
- Recognize only `- [x] **Unit N: ...**` / `- [ ] **Unit N: ...**` top-level markers; everything
  else (including `### U<n>.` heading units) is unrecognized.
- Checkboxes outside unit-marker form (verification checklists, nested task lists) must not count.

**Execution note:** Test-first; this parser is the correctness seam for the whole kind.

**Test scenarios:**
- Happy path: mixed checked/unchecked unit markers → exact counts.
- Edge case: checkboxes that are not unit markers (plain `- [x]` list items, indented sub-tasks) →
  not counted.
- Edge case: no unit markers at all → no-markers signal.
- Edge case: heading-encoded units (`### U1.` + `Status:` lines) → no-markers signal (unrecognized
  encoding).
- Edge case: bold-less or malformed unit labels → not counted as units.

**Verification:**
- Parser results over the current 25-plan corpus match a manual survey (24 checkbox plans counted
  correctly; the heading-encoded plan reports no recognizable markers until Unit 4 normalizes it).

- [x] **Unit 2: Synthetic claim builder and drift-matrix resolver**

**Goal:** Emit one plan-consistency claim per plan file and classify it per the drift matrix.

**Requirements:** R1, R2, R3, R7, R8, R9, R10

**Dependencies:** Unit 1

**Files:**
- Modify: `scripts/status-truth-detect.ts`
- Test: `scripts/status-truth-detect.test.ts`

**Approach:**
- Add `plan-consistency` to the `ClaimKind` union; do not add a `CLAIM_KIND_DEFINITIONS` entry.
- The scan shell consumes file contents internally and returns only claims, so the builder makes
  its own bounded second pass: reuse the injected `fileLister`/`fileReader` seams, filter to
  `docs/plans/*.md`, and read each plan (small corpus; avoids widening the scan API and keeps the
  pure-core/shell split).
- Emit one synthetic claim per plan: claimedState from `parsePlanFrontmatterStatus` normalized to
  `SUPPORTED_PLAN_STATUSES` or the `unsupported` sentinel; sourceRef = plan path; constant
  normalized text for fingerprint stability.
- Resolver applies the one-directional drift matrix: only `active` + all-checked is drifted
  (correction `status: complete`); `complete` + unchecked, unsupported status, missing frontmatter,
  and no/malformed markers are unresolved; all else current.
- Proposed correction is built from normalized fields only.

**Execution note:** Test-first with table tests over the full drift matrix.

**Test scenarios:**
- Happy path: `active` + all `[x]` → drifted, proposal-eligible, correction `status: complete`
  (AE1).
- Happy path: `complete` + all `[x]` → current.
- Edge case: `complete` + one `[ ]` → unresolved, not proposal-eligible (AE2).
- Edge case: no Implementation Units section → unresolved (AE3).
- Edge case: `status: code-complete-pending-verification` → unresolved with claimedState
  `unsupported`, not the raw string (AE4).
- Privacy path: a malformed multi-word `status:` value never appears verbatim in the claim,
  report JSON, or any rendered surface.
- Edge case: heading-encoded units → unresolved (AE5).
- Edge case: `draft`/`cancelled`/`superseded` with any unit state → current.
- Edge case: fingerprint identical for the same plan across differing unit states.
- Error path: file read failure → unresolved via the shell's failure accounting, no clean report
  fabrication.

**Verification:**
- Replaying the three pre-reconciliation stale capture plans as fixtures yields exactly three
  drifted findings; the remaining corpus yields zero drifted.

- [x] **Unit 3: Detect-flow integration and report wiring**

**Goal:** Plan-consistency findings appear in the report with correct counts and proposal flow.

**Requirements:** R2, R11, R12

**Dependencies:** Unit 2

**Files:**
- Modify: `scripts/status-truth-detect.ts`
- Test: `scripts/status-truth-detect.test.ts`
- Test: `scripts/status-truth-proposals.test.ts`

**Approach:**
- Wire the builder into `runDetect` between file scan and classification; reuse the existing
  fileLister/FileReader seams so tests inject fixtures.
- Findings enter the shared report (`findings`, `counts`) with no new report fields.
- Confirm planner passthrough: a drifted plan-consistency finding plans an open action, is capped,
  deduped, and gated exactly like existing kinds.

**Test scenarios:**
- Integration: full detect run over fixture corpus produces plan-consistency findings alongside
  prose-claim findings in one report.
- Integration: drifted plan-consistency finding flows through proposal planning (open action,
  fingerprint marker, gated body) with no planner changes (AE1, AE6 cap behavior).
- Privacy: rendered proposal body for a drifted fixture contains path, statuses, unit counts, and
  correction — and no sentence copied from the plan body (AE7).
- Privacy: one assertion per public surface (report JSON finding fields, proposal title, proposal
  body, update/recurrence/close comments, stdout summary) proving only normalized fields are
  emitted for plan-consistency findings.
- Integration: deleting a fixture plan between two runs closes its open proposal via the existing
  close-on-clear path (documented v1 semantics).

**Verification:**
- A dry-run-shaped local execution over the real corpus reports the expected verdict distribution
  (zero drifted, one unresolved for the unsupported-status plan after Unit 4 lands).

- [x] **Unit 4: Corpus normalization and operator docs**

**Goal:** Uniform checkbox corpus at launch and documented operator semantics.

**Requirements:** R6, plus terminal-label semantics documentation

**Dependencies:** Units 1–3 (verification uses the parser)

**Files:**
- Modify: `docs/plans/2026-06-30-001-feat-status-truth-signal-completion-plan.md`
- Modify: `README.md`

**Approach:**
- Convert the plan's `### U<n>.` + `Status: complete.` units to `- [x] **Unit N: ...**` checkbox
  encoding, preserving all body content.
- README Status-Truth section: document the plan-consistency kind, the drift matrix in operator
  terms, and that `rejected`/`false-positive` labels permanently exempt a plan from consistency
  proposals.

**Test scenarios:**
- Test expectation: none — docs-only unit; correctness is verified by Unit 1's parser accepting
  the normalized plan and by markdown lint.

**Verification:**
- The normalized plan resolves current (`complete` + all checked) through the new resolver.
- README documents the kind, matrix, and opt-out semantics without plan-speak or private
  identifiers.

## System-Wide Impact

- **Interaction graph:** detect gains one synthetic-claim pass; planner, gate, workflow, and
  schedule untouched.
- **Error propagation:** file-read and parse failures degrade to unresolved counts; no failure
  path fabricates a clean report.
- **State lifecycle risks:** stable per-plan fingerprints mean terminal labels suppress a plan
  forever (intended, documented); correlated prose+consistency findings for one stale plan are
  accepted and bounded by the mutation cap; plan deletion/rename auto-closes its proposal as a
  resolved positive (accepted v1 semantics, documented in README).
- **Dogfooding closeout:** this plan itself becomes `active` + all-units-checked at completion;
  its own closing PR must flip the frontmatter to `complete` in the same commit that checks the
  last unit, or the first post-merge run correctly proposes the fix — an acceptable live test, not
  a failure.
- **API surface parity:** report schema unchanged (new kind value only); consumers reading counts
  by verdict are unaffected.
- **Integration coverage:** report-to-proposal handoff for the new kind is tested end-to-end at
  the planner boundary.
- **Unchanged invariants:** proposal-only boundary, mutation caps, cooldowns, outcome labels,
  branch protection, credential split, and counts-only telemetry all remain as shipped.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Checkbox grammar miscounts non-unit checklists | Grammar anchored to `**Unit N:**` label form; non-matching checkboxes ignored; corpus-survey verification in Unit 1. |
| Fingerprint instability re-fires suppressed proposals | Fingerprint excludes unit state by construction; test asserts stability across drift episodes. |
| Proposal body echoes plan text | Body built from normalized fields only; AE7 privacy test pins it; existing gate is a second layer. |
| Correlated duplicate proposals annoy the operator | Accepted v1 trade-off; cap bounds volume; revisit only if it proves noisy. |
| Drift matrix regression via naive equality reuse | Matrix encoded in one resolver with exhaustive table tests. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-02-plan-consistency-claim-kind-requirements.md](../brainstorms/2026-07-02-plan-consistency-claim-kind-requirements.md)
- Related code: `scripts/status-truth-detect.ts`, `scripts/status-truth-proposals.ts`,
  `scripts/status-truth-public-output.ts`, `.github/workflows/status-truth.yaml`
- Prior plans: [docs/plans/2026-06-26-001-feat-status-truth-maintenance-loop-plan.md](2026-06-26-001-feat-status-truth-maintenance-loop-plan.md),
  [docs/plans/2026-06-30-001-feat-status-truth-signal-completion-plan.md](2026-06-30-001-feat-status-truth-signal-completion-plan.md)
- Related learnings: `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`,
  `docs/solutions/best-practices/privacy-gate-promotion-leak-prevention-2026-06-04.md`,
  `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`,
  `docs/solutions/integration-issues/wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md`
