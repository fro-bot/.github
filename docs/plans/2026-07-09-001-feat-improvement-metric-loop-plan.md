---
title: "feat: self-improvement metric loop (discovery + recidivism)"
type: feat
status: complete
date: 2026-07-09
origin: docs/brainstorms/2026-07-09-o8-improvement-metric-requirements.md
---

# feat: self-improvement metric loop (discovery + recidivism)

## Overview

Add a report-only metric loop that measures whether Fro Bot's self-improvement loops actually reduce repeated work. Each run recomputes two paired numbers over a window — discovery (distinct classes newly codified) and recidivism (codified classes that recurred and a human confirmed) — plus a pending-candidate backlog, then rewrites one perpetual public report issue with a fixed report state. The report issue is also the confirmation surface: each candidate recurrence is a checklist line the operator ticks, and O8 preserves and re-reads that checkbox state across rewrites. It clones the proven Capture Patterns two-job workflow shape (manual dispatch, dry-run default, scoped token, reusable public-output gate) and drops the agent step, since the render is deterministic.

## Problem Frame

Fro Bot runs several self-improvement loops (learning capture, pattern synthesis, Status Truth drift) that each emit counts of what they did. None answers whether the same class of fix/finding/lesson keeps recurring, or whether that recurrence is trending down. The Capture Patterns requirements doc closed by forbidding that loop from claiming improvement and handed measurement to this slice (see origin: `docs/brainstorms/2026-07-09-o8-improvement-metric-requirements.md`). The risk this plan guards against is a vanity number — a report that reads clean because nobody maintains it, or because a metric derived from mutable history quietly rewrites its own past.

## Requirements Trace

- R1. Report discovery and recidivism as one paired reading per run.
- R2. Discovery counts a class only on first codification; never re-counts from repeated proposals; a pattern recurrence assertion is not discovery unless newly codified in the window.
- R3. Show the prior-window delta for each measure, computed only from immutable timestamps and stable class identity.
- R4. Derive only from `learning-proposal` / `pattern-proposal` (with outcome labels) / Status Truth proposals / `docs/solutions/`.
- R5. Canonical codified-class anchor is `docs/solutions/`; accepted `pattern-proposal` issues are evidence, never a second anchor.
- R6. No mining of transcripts, logs, autoheal PR frequency, review-churn, private-only artifacts, or cross-repo bodies.
- R7. Recidivism counts a link only after a human confirms; O8 never self-confirms.
- R8. Detect and surface candidate recurrence links for review without asserting them.
- R9. Confirmation is a fixed-vocabulary gesture re-readable by a later run; no freeform text read; no bespoke store.
- R10. Maintain a single perpetual report issue, rewritten each run; never one issue per run.
- R11. Report-only: change no solution docs, prompts, personas, skills, workflow instructions, or any loop's logic.
- R12. Manual dispatch, dry-run default.
- R13. Recompute both measures from source history and confirmation gestures each run; no new durable metric store.
- R14. State the window and source counts behind each measure.
- R15. Render exactly one fixed state: `insufficient-signal` / `ambiguous` / `healthy` / `failing`, selected deterministically.
- R16. Below minimum volume, render `insufficient-signal` with no interpretation or trend claim.
- R17. Pending backlog is a first-class count with oldest-candidate age; a stale backlog raises a visible warning.
- R18. A falling discovery rate renders `ambiguous`, never improvement; make no measurable-improvement claim.
- R19. Reuse the deterministic public-output gate with fail-closed policy; no advisory-only fallback.
- R20. Candidate/evidence text is public-safe by construction (class key, public issue URL, fixed marker only); denylist source titles, body excerpts, branch/repo names, quoted snippets.

## Scope Boundaries

- No autoheal-PR-frequency or review-churn mining (deferred).
- No durable committed metrics file and no time-series beyond the single prior-window delta.
- No operator-web/dashboard surfacing.
- No automatic scheduling — manual dispatch only in v1.
- No LLM/agent step — the report is deterministically rendered.
- O8 measures only; it does not act on regressions or edit any loop.

### Deferred to Separate Tasks

- Graduating the highest-recurring class into an action loop: future slice — O8 exists to inform that decision, not perform it.
- Multi-class disambiguation when one proposal plausibly maps to several codified classes: v1 surfaces every over-threshold `(event → class)` edge as its own checklist line and lets the operator confirm each independently; a smarter single-best ranking is a later refinement.

## Context & Research

### Relevant Code and Patterns

- Two-job detect/open workflow with `dry_run` default `true`, `concurrency` no-cancel, scoped app-token mint (`repositories: ${{ github.event.repository.name }}`, `permission-issues: write`), artifact handoff via `*_DIGEST_PATH` env + `actions/upload|download-artifact`, `data`-branch metadata overlay: `.github/workflows/capture-patterns.yaml`. O8 mirrors this and **drops the agent step**; it additionally needs `fetch-depth: 0` on the detect checkout for git-history codification dates.
- Pure vocabulary/markers/classification library (namespaced markers, closed outcome-label set, `parse(build(x))===x` round-trip, `classifyPatternProposalOutcome`): `scripts/capture-patterns-synthesis.ts`.
- Detect entrypoint (pure core + I/O shell; `octokit.paginate(listForRepo,{labels,state:'all'})`; token-load-before-API fail-closed ordering; counts-only stdout JSON; `applyPublicOutputGate` on every source title): `scripts/capture-patterns-cluster.ts`. Its `computeSourceOverlapScore` is **not exported and assumes symmetric frontmatter on both sides**, which a proposal issue lacks — O8 does not reuse it; see Key Technical Decisions.
- Open entrypoint (pure planning core + I/O shell; `ensure*LabelsExist` 404→create/422-idempotent; per-issue try/catch; fail-closed on unavailable label): `scripts/capture-patterns-open.ts`.
- Reusable public-output gate: `scripts/status-truth-public-output.ts` — `applyPublicOutputGate({surface,...})` (closed `PublicOutputSurface` union; `fingerprint` must be `undefined` for counts-only surfaces), `makePublicOutputTokens`. Already reused by capture-patterns; O8 reuses unchanged.
- Checklist live-state encoding + marker precedence (marker → visible field → sentinel), close-on-clear idempotency, stable fingerprint from immutable inputs: `scripts/status-truth-proposals.ts` (`recoverProposalKind`, `classifyProposalOutcome`, `checked-N-unchecked-M` live-state), `scripts/status-truth-detect.ts`. This is the pattern O8's checkbox-confirmation preservation reuses.
- Same-run list-after-create staleness guard (in-memory created-ID `Set`): `scripts/reconcile-repos.ts` (`selfHealRollups`, `currentRunRollupOwners`).
- Workflow-shape test style (pure YAML parse + per-contract `it` blocks, asserts perms/`if`/token boundary/no-`cat`-of-secrets/no internal taxonomy): `scripts/capture-patterns-workflow.test.ts`.

### Institutional Learnings

- Closed-vocabulary identifiers for automated inspection — enumerate at the boundary, normalize before rendering/deciding, share one classification pass: `docs/solutions/best-practices/closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md`, `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md`.
- Verify the whole public perimeter (issue body, title, run name, summary, logs, stdout, concurrency group all accounted for): `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`, `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`.
- Pure-core privacy gate in a shared module + mutation-proof test that exercises the real compose path and fails on bypass: `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`.
- Observability before structural change — counts-only, derived, no persisted state, paired with an explicit revisit trigger: `docs/solutions/best-practices/observability-before-structural-change-2026-06-09.md`.
- "Success with a zero counter" ≠ health — render insufficient-signal distinctly: `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`.
- Ground a signal-classifying heuristic in real state distributions, not fixtures: `docs/solutions/workflow-issues/classifying-github-review-events-for-iteration-signals-2026-06-22.md`.
- Test the seam, not the endpoints — golden-path test drives the real compose path with real-shaped bodies: `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md`.
- Same-run GitHub Issues list-after-create is stale for seconds — carry a created-ID set if the report issue is ever rotated: `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`.

## Key Technical Decisions

- Clone Capture Patterns' workflow + script split, drop the agent step: O8's render is deterministic, so no LLM belongs in the loop. Lowest-risk path — reuses a proven, tested shape.
- Canonical anchor is `docs/solutions/`; a codified class's identity key derives from its frontmatter (`module` / `component` / `problem_type`), matching the closed-vocabulary-identifiers learning. Accepted `pattern-proposal` issues are evidence, not anchors — a recurrence counts against exactly one solution doc.
- **Codification timestamp = the git first-commit (add) date of the solution doc**, not frontmatter `date`. Review found frontmatter `date` is both mutable (an edit can silently move a class between windows and rewrite the trend) and non-universal (present on well under half the corpus). The git add-date is immutable and exists for every committed doc, which fixes the discovery-undercount blocker and the false "immutable trend" claim together. Requires `fetch-depth: 0` on the detect checkout and a single `git log --diff-filter=A` pass over `docs/solutions/`.
- **O8-native candidate scorer over honestly-asymmetric signals.** The capture-patterns scorer assumes both sides carry `problem_type`/`module`/`tags`; a proposal issue carries only title/body/labels. O8 defines its own `scoreCandidateLink(event, class)` that matches the proposal's title/label tokens against the class's title/tag/module tokens — a deliberately weak recall signal, with the human confirm as the precision gate. It does not import the private capture-patterns function.
- **Confirmation is an edge-keyed checklist on O8's own report issue, not a label on the proposal issue.** A bare label cannot preserve which class a proposal recurred against when several score over threshold (a one-bit label can't encode a many-to-one edge). Instead, O8 renders each candidate `(event → class)` edge as its own checklist line carrying a stable hidden edge fingerprint `hash(classKey + eventId)`; the operator ticks the specific edge; O8 re-reads its own report body next run, counts ticked edges as confirmed recidivism, and preserves tick state across rewrites via the status-truth `checked-N-unchecked-M` live-state pattern. This closes the loop on one surface (read the report, tick inline) and keeps the confirmed edge explicit and reproducible. Supersedes the brainstorm's proposal-issue-label gesture.
- Perpetual report is upsert-by-marker: find the report issue by a fixed label, parse `<!-- improvement-metrics:report:version=N -->`, and rewrite the body in place, preserving operator tick-state for edges still present. If absent, create with a static title. This is the repo's first in-place body rewrite — isolated in its own unit and its own review surface.
- Trend is bounded to a single prior-window delta over immutable timestamps (git add-date) + stable class identity, so source edits cannot silently rewrite history; a class whose anchor was deleted/renamed renders the run non-comparable rather than retroactively changing past numbers.
- Fixed report-state union at the boundary; state selection is a deterministic function of the counts, the volume floor, the prior-window delta, and backlog staleness — never free-form prose.

## Open Questions

### Resolved During Planning

- Codified-class identity key: frontmatter `module`/`component`/`problem_type` (per the closed-vocabulary learning).
- Codification date source: git first-commit (add) date of the doc (immutable, universal) — replaces frontmatter `date`.
- Candidate-link heuristic: O8-native `scoreCandidateLink` over asymmetric signals (proposal title/labels vs class title/tags/module) with a strong-match minimum, not the capture-patterns scorer.
- Confirm gesture: an edge-keyed checkbox on O8's report issue, tick-state preserved across rewrites; no proposal-issue labels, no freeform text.

### Deferred to Implementation

- Exact starting thresholds are seeded as tunable constants (window `90d`; `insufficient-signal` when window has `< 3` codified anchors or `< 2` discovery events; backlog-staleness warning when the oldest ticked-but-unconfirmed candidate `> 14d`; candidate surfacing requires score ≥ threshold AND ≥1 strong-field token match) — final values tuned against real corpus volume after first runs.
- Exact helper/function names within each new module.
- Whether `pattern-proposal:superseded` proposals are excluded from candidate detection (likely yes) — confirmed against real label distributions during implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Report-state selection (deterministic, evaluated in order):

```
inputs: anchors, discovery, priorDiscovery, confirmedRecidivism, pendingBacklog, oldestPendingAgeDays

1. anchors < MIN_ANCHORS  OR  discovery < MIN_DISCOVERY      -> insufficient-signal
2. confirmedRecidivism > 0 and >= discovery                  -> failing
3. discovery < priorDiscovery  OR  oldestPendingAgeDays > STALE_AGE  -> ambiguous
4. otherwise                                                 -> healthy
(pendingBacklog count + oldestPendingAgeDays are ALWAYS rendered, in every state)
```

Data flow (deterministic, no agent):

```
detect:  solution docs (frontmatter identity + git add-date) + proposal issues (labels/markers)
           + prior report body (operator tick-state)
           -> classify each source once (shared pass)
           -> discovery = distinct anchors whose git add-date is in window
           -> candidates = scoreCandidateLink(newEvent, anchor) >= THRESHOLD and strong-match,
                           one checklist line per (event -> class) edge, each with edge fingerprint
           -> confirmedRecidivism = edges whose checkbox is ticked in the prior report body
           -> backlog = surfaced edges not yet ticked, with oldest age
           -> priorDiscovery = same over the immediately prior window (git dates, immutable)
           -> select state -> counts-only digest JSON (+ edge list with fingerprints, no raw titles)
report:  digest + prior report tick-state -> render public-safe body
           (class keys + public issue URLs + edge checkboxes only)
           -> applyPublicOutputGate(every surface) [fail-closed]
           -> upsert perpetual report issue by marker/version, preserving ticked edges still present
```

## Implementation Units

- [x] **Unit 1: Closed vocabulary, class identity, edge fingerprints, and markers (pure core)**

**Goal:** The pure library every other unit imports: the fixed report-state union, the codified-class identity key, source-type classification, the `(event → class)` edge fingerprint, and the report-issue marker + checklist live-state build/parse with round-trip guarantees.

**Requirements:** R2, R4, R5, R9, R15

**Dependencies:** None

**Files:**
- Create: `scripts/improvement-metrics-core.ts`
- Test: `scripts/improvement-metrics-core.test.ts`

**Approach:**
- Declare `REPORT_STATES = ['insufficient-signal','ambiguous','healthy','failing'] as const` and a recovery function that rejects any out-of-set string (never renders it).
- Derive a codified-class identity key from solution-doc frontmatter (`module`/`component`/`problem_type`) with a sentinel segment for missing fields; define the source-type closed set (`learning-proposal`/`pattern-proposal`/`status-truth`) and a single classifier.
- Edge fingerprint `buildEdgeFingerprint(classKey, eventId)` — stable hash over immutable inputs so an operator tick survives body rewrites and reordering.
- Marker build/parse for `<!-- improvement-metrics:report:version=N -->` and the per-edge checklist encoding (a hidden `<!-- improvement-metrics:edge=<fp> -->` beside a `- [ ] ` / `- [x] ` line), plus a `checked-N-unchecked-M` summary parse mirroring status-truth. All fail-fast on bad input, `null` on absent/malformed.
- Fixed report-issue label constant + descriptor row ready for `.github/settings.yml`.

**Patterns to follow:**
- `scripts/capture-patterns-synthesis.ts` (marker helpers, closed label sets, `parse(build(x))===x`).
- `scripts/status-truth-proposals.ts` (`checked-N-unchecked-M` live-state encoding/parse).
- Closed-vocabulary discipline: `docs/solutions/best-practices/closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md`.

**Test scenarios:**
- Happy path: build→parse the version marker and an edge checklist line round-trip; class-key derives stably from frontmatter regardless of field order; edge fingerprint stable across input reordering.
- Edge case: missing/extra frontmatter field → deterministic key with a sentinel segment, never a throw.
- Edge case: out-of-set report-state string → rejected, never rendered.
- Edge case: checklist line with `[x]` vs `[ ]` parses to ticked/unticked; malformed checkbox → treated as unticked (fail-safe), never as ticked.
- Error path: marker build with control chars/newlines → fail-fast; parse of absent marker → `null`.

**Verification:** Core types and helpers importable; round-trip, closed-set, and tick-state tests green; no I/O in this module.

- [x] **Unit 2: Detect — sources, discovery, recidivism, backlog, state (pure core + I/O shell)**

**Goal:** The detect entrypoint: fetch the structured sources and the prior report tick-state, classify each once, compute discovery / confirmed-recidivism / backlog / prior-window delta / report state from immutable git dates, and emit a counts-only digest plus the edge list.

**Requirements:** R1, R2, R3, R6, R7, R8, R16, R17, R18

**Dependencies:** Unit 1

**Files:**
- Create: `scripts/improvement-metrics-detect.ts`
- Test: `scripts/improvement-metrics-detect.test.ts`

**Approach:**
- Pure core `computeMetrics(input)` takes loaded solution-doc records (frontmatter identity + git add-date) + proposal issues (labels/markers) + prior report tick-state + `now` + tunable constants, returns the digest + edge list. Discovery = distinct anchors whose git add-date is in window. Candidates = `scoreCandidateLink(event, anchor) >= THRESHOLD` AND ≥1 strong-field token match, emitted one edge per `(event → class)` pair with its fingerprint. Confirmed-recidivism = edges whose fingerprint is ticked in the prior report tick-state. Backlog = surfaced edges not ticked, with oldest age from the event's created-at. Prior-window delta recomputed over the immediately prior window using git add-dates + issue created-at only (immutable).
- `scoreCandidateLink` is O8-native and asymmetric: proposal title/label tokens vs class title/tag/module tokens.
- Single shared classification pass feeds all counts. Deterministic state selection per the HTD ladder; `insufficient-signal` gated by `MIN_ANCHORS`/`MIN_DISCOVERY`; candidate surfacing suppressed entirely below the floor (prevents low-volume backlog flooding); backlog counts always populated otherwise.
- I/O shell `main()`: token-load-before-API fail-closed ordering; `octokit.paginate(listForRepo,{labels,state:'all'})` per source label; load solution docs from disk; obtain git add-dates via one `git log --diff-filter=A --format` pass over `docs/solutions/` (needs `fetch-depth: 0`, provided by the workflow); read the prior report issue body for tick-state; write counts-only digest (+ fingerprint edge list, no raw titles) to `IMPROVEMENT_METRICS_DIGEST_PATH`; stdout = result JSON with `tokenLoadFailure`/`scanFailure`/`gitHistoryUnavailable` presence bits.
- Constants seeded as named tunables: `WINDOW_DAYS=90`, `MIN_ANCHORS=3`, `MIN_DISCOVERY=2`, `STALE_AGE_DAYS=14`, `SCORE_THRESHOLD` + strong-match rule.

**Execution note:** Implement the pure `computeMetrics` core test-first — it is the heart of the metric and every state boundary needs a failing test before the implementation.

**Patterns to follow:**
- `scripts/capture-patterns-cluster.ts` (pure core + shell split, token-load ordering, counts-only digest schema, fetch helpers).
- Marker→visible→sentinel precedence + one shared classification pass: `scripts/status-truth-proposals.ts` (`recoverProposalKind`), `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md`.
- Ground the classifier in real label distributions: `docs/solutions/workflow-issues/classifying-github-review-events-for-iteration-signals-2026-06-22.md`.

**Test scenarios:**
- Happy path: two anchors with git add-date in-window + repeated proposals for one existing class → discovery counts 2, not the repeats (R2); a ticked edge raises recidivism, an unticked one does not (R7).
- Edge case: window below floor (`<3` anchors or `<2` discovery) → state `insufficient-signal`, no candidates surfaced, no trend interpretation (R16).
- Edge case: discovery below prior window, no confirmed recidivism → `ambiguous`, not improvement (R18).
- Edge case: stale unticked candidate (`age > STALE_AGE_DAYS`) → backlog count + oldest-age surfaced and `ambiguous`/warning even when discovery healthy (R17).
- Edge case: one event scores over threshold for two anchors → two independent edges surfaced, each separately tickable (no silent single-best collapse).
- Edge case: frontmatter `date` differs from git add-date → discovery uses git add-date (immutability guard).
- Error path: token load failure OR git history unavailable → empty digest, presence bit set, exit 0 (no partial counts).
- Integration: a ticked edge fingerprint in the prior report body flows through read→classify→confirmed-recidivism count (mock octokit + prior body).

- [x] **Unit 3: Public-safe report rendering + gate (pure)**

**Goal:** Render the report body and workflow summary from the digest + edge list, public-safe by construction, and route every surface through the public-output gate fail-closed.

**Requirements:** R14, R19, R20

**Dependencies:** Unit 1, Unit 2

**Files:**
- Create: `scripts/improvement-metrics-report.ts` (render functions only in this unit; upsert I/O added in Unit 4)
- Test: `scripts/improvement-metrics-report.test.ts`

**Approach:**
- Pure `renderReportBody(digest, priorTickState)` and `renderRunSummary(digest)` emit counts, the window, source counts behind each measure, the report state, the backlog count + oldest age, and the candidate checklist. Each checklist line is built only from a class key, the event's public issue URL, and the edge checkbox+fingerprint — never a source title, body excerpt, or repo/branch name (R20 denylist enforced structurally: render functions receive the fingerprint edge list, not raw titles). Ticked edges still present are re-emitted as `[x]`.
- Every rendered surface passes `applyPublicOutputGate({surface,...})` with `fingerprint: undefined` for the counts-only surfaces; any gate failure blocks the surface with no advisory fallback (R19).
- Append the version marker via Unit 1's builder.

**Patterns to follow:**
- `scripts/capture-patterns-cluster.ts` `buildCandidateDigest` (gate every surfaced field; failed gate → withheld sentinel).
- `scripts/status-truth-public-output.ts` gate usage; `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`.

**Test scenarios:**
- Happy path: a full digest renders a body containing counts, window, state, backlog, and a checklist with edge fingerprints; the version marker round-trips.
- Edge case: `insufficient-signal` digest renders no trend/interpretation line and no candidate checklist.
- Error path (mutation-proof): a digest carrying a private-identifier-shaped string in any field → the gate blocks that surface; test injects private prose and asserts the gate refuses (fails if the gate is bypassed).
- Edge case: candidate render uses only class key + public URL + checkbox; assert no source title/body text appears in output.

- [x] **Unit 4: Perpetual report upsert with tick-state preservation (I/O shell — net-new body rewrite)**

**Goal:** Maintain the single perpetual report issue: find by label, decide create-vs-update by version marker, rewrite the body in place while preserving operator tick-state for edges still present — the repo's first `issues.update({body})`.

**Requirements:** R10, R13

**Dependencies:** Unit 1, Unit 3

**Files:**
- Modify: `scripts/improvement-metrics-report.ts` (add the upsert shell + `main()`)
- Test: `scripts/improvement-metrics-report.test.ts` (extend)

**Approach:**
- `listForRepo({labels: report-issue-label, state:'open'})` → if found, parse the version marker and the prior tick-state, then `issues.update({issue_number, body})` with the freshly rendered body that re-emits still-present ticked edges as `[x]`; if the marker is at the current version and content is unchanged, no-op. If not found, `issues.create` with a **static title** (`Improvement Metrics`, never data-derived) after ensuring the report-issue label exists (`ensure*LabelsExist` pattern).
- Carry an in-memory created-ID guard for the create path against same-run list-after-create staleness.
- `main()` reads `IMPROVEMENT_METRICS_DIGEST_PATH` / `IMPROVEMENT_METRICS_RESULT_PATH`; token-load failure → fail-closed (no write); result JSON to stdout with `created`/`updated`/`noop`/`tokenLoadFailure` presence bits. Best-effort result-file write (stderr on failure, never throw).

**Patterns to follow:**
- `scripts/capture-patterns-open.ts` (`ensurePatternProposalLabelsExist`, per-issue try/catch, fail-closed on unavailable label, `main()` env contract).
- Same-run staleness guard: `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`.
- Marker-versioned upsert with tick preservation (net-new): find-by-label → parse version + tick-state → update-or-create.

**Test scenarios:**
- Happy path: no existing report issue → `issues.create` once with static title + body + marker; result `created`.
- Happy path: existing issue with lower version marker → `issues.update` body in place, no new issue; result `updated`.
- Critical: an edge ticked `[x]` in the prior body that is still present in the new digest is re-emitted `[x]` (operator confirmation is never clobbered by the rewrite).
- Edge case: a ticked edge no longer present in the new digest drops out cleanly (close-on-clear); its tick does not resurrect.
- Edge case: existing issue at current version, unchanged content → no-op, no write; result `noop`.
- Edge case: existing issue missing/malformed marker → treated as supersedable (update), never duplicated.
- Error path: token load failure → no create/update attempted, `tokenLoadFailure` true.
- Integration: create-then-relist within a run does not duplicate (created-ID guard) — mock stale `listForRepo`.

- [x] **Unit 5: Workflow + label + perimeter**

**Goal:** The `Improvement Metrics` workflow (detect + report jobs, dry-run default, scoped token, full-history checkout) and the report-issue label, wiring the deterministic pipeline with no agent step and an explicit gated public perimeter.

**Requirements:** R11, R12, R19

**Dependencies:** Unit 2, Unit 4

**Files:**
- Create: `.github/workflows/improvement-metrics.yaml`
- Modify: `.github/settings.yml`
- Test: `scripts/improvement-metrics-workflow.test.ts`

**Approach:**
- Two jobs mirroring `capture-patterns.yaml`: `detect` (`contents:read`, `issues:read`, checkout with **`fetch-depth: 0`** for git add-dates + `./.github/actions/setup` + `data`-branch metadata overlay + run `improvement-metrics-detect.ts` piped to a `tee`'d digest under `bash -Eeuo pipefail`, upload digest artifact, jq step-summary) and `report` (`needs: detect`, `if: always() && workflow_dispatch && inputs.dry_run == 'false'`, download digest, mint app-token scoped to `github.event.repository.name` with `permission-issues: write`, run `improvement-metrics-report.ts`, jq step-summary). No agent step.
- `workflow_dispatch` only, `inputs.dry_run` choice default `'true'`; **static `concurrency` group** no-cancel; top-level `contents: read`; **no `run-name` interpolation** (static default); token boundary — detect never holds a write token.
- Public perimeter (all counts-only / gated, enumerated here so a future ungated surface fails review): (a) report issue body — `applyPublicOutputGate` fail-closed; (b) report issue title — static `Improvement Metrics`, never data-derived; (c) run-name — static default; (d) both step-summaries — jq counts-only; (e) stdout/stderr — counts-only result JSON; (f) logs — only counts-only script output; (g) concurrency group — static string; (h) digest artifact — fingerprints + public URLs, 1-day retention.
- `.github/settings.yml`: add the report-issue label with description/color matching existing label style. (No proposal-issue confirmation labels — confirmation lives in the report checklist.)

**Patterns to follow:**
- `.github/workflows/capture-patterns.yaml` (job/step shape, dry-run gate, scoped mint, artifact handoff, no-`cat`-of-secrets).
- Static-run-name / no-input-echo: `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`.
- `scripts/capture-patterns-workflow.test.ts` (assertion style).

**Test scenarios:**
- Happy path: `report` job `if` requires `dry_run == 'false'`; detect job has no write token; mint step scoped to repo name with issues:write.
- Edge case: detect checkout sets `fetch-depth: 0`; workflow declares no `schedule`; `workflow_dispatch` only; `dry_run` default `'true'`.
- Edge case: no step `cat`s/`echo`s the digest file or the token; run-name and concurrency group are static (no `${{ inputs.* }}` interpolation).
- Edge case: workflow file contains no internal tier taxonomy (no `O8`, `Unit \d`); operator-facing text only.
- Integration: both jobs pass the same `IMPROVEMENT_METRICS_DIGEST_PATH`.

- [x] **Unit 6: Golden-path integration test + README**

**Goal:** Lock the real detect→render→upsert compose path with a golden-path test on real-shaped inputs, and document the loop operator-facing.

**Requirements:** R1, R3, R7, R17 (end-to-end), R11

**Dependencies:** Units 1-5

**Files:**
- Create: `scripts/improvement-metrics-integration.test.ts`
- Modify: `README.md`

**Approach:**
- Golden-path test drives the actual composition (detect core → render → upsert shell) with realistic solution-doc records (frontmatter identity + git add-dates) + realistic proposal issue bodies/labels + a prior report body containing one ticked and one unticked edge, asserting the paired counts, the selected state, the backlog surfacing, tick-state preservation, and a public-safe body. It exercises the **real** `renderReportBody`→upsert path (does not mock the gate) and must fail if `applyPublicOutputGate` is removed from the render path or a state-ladder threshold is altered — the anti-recurrence contract.
- README: an operator-facing section — what the metric measures, how discovery/recidivism/backlog read, how to confirm a recurrence (tick the checklist line on the report issue) and how it persists, and how to run it (dry-run default). No internal taxonomy, in Marcus's voice.

**Execution note:** Write the golden-path test first from real-shaped fixtures; it is the seam that unit tests alone would ship green past.

**Patterns to follow:**
- `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md`.
- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md` (real-compose gate test, not mocked).
- Existing README loop sections for voice and structure.

**Test scenarios:**
- Integration: real-shaped corpus → correct paired counts + state + backlog; a ticked edge counts as recidivism, an unticked one stays backlog, end-to-end.
- Integration (tick preservation): a prior ticked edge still present is re-emitted ticked after upsert.
- Integration (anti-recurrence): removing the gate call from the render path or altering a state-ladder threshold fails the test.
- Verification: `README.md` renders, markdown lint clean, no internal taxonomy.

## System-Wide Impact

- **Interaction graph:** New manual workflow; reads the same proposal issues the existing loops write. No existing workflow calls O8; O8 calls no existing loop. The only new writes are the perpetual report issue + its label ensure.
- **Error propagation:** Detect fails closed on token-load/scan/git-history failure (empty digest, exit 0); report fails closed on token-load failure (no write). Rendering/summary are best-effort and must not abort the run.
- **State lifecycle risks:** The perpetual issue is the only mutable state; upsert-by-version-marker + created-ID guard prevent duplicates; tick-state preservation prevents clobbering operator confirmation. No `data`-branch write, no metrics store.
- **API surface parity:** This is the first in-place issue-body rewrite in the repo — review the `issues.update({body})` call for blast radius; every other loop only creates or flips state.
- **Integration coverage:** The detect→render→upsert seam is covered by the Unit 6 golden-path test on real-shaped inputs with the real gate, not just per-unit mocks.
- **Unchanged invariants:** No solution doc, prompt, persona, skill, or existing loop logic changes (R11). The public-output gate is reused unchanged. Existing proposal loops are untouched.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Reflexive dead metric — operator never ticks a candidate, so recidivism reads 0 forever | Backlog is a first-class count with oldest-age + stale warning (R17); an unmaintained checklist is loud, not silent-clean. Confirmation lives inline on the report the operator is already reading. |
| Lost confirmed edge — a bare gesture can't say which class recurred | Confirmation is an edge-keyed checkbox: the checklist line *is* the `(event → class)` edge O8 rendered, keyed by a stable fingerprint; the confirmed edge is explicit and reproducible each run. |
| Trend instability from a mutable date source | Codification timestamp is the git first-commit date (immutable, universal), not frontmatter `date`; a deleted/renamed anchor marks the run non-comparable rather than rewriting past windows. |
| Candidate heuristic over/under-links (asymmetric, weak signal) | Recall-oriented O8-native scorer + strong-match minimum; human tick is the precision gate; every over-threshold edge surfaced independently so confirmation is unambiguous. |
| Low corpus volume floods the backlog with noise candidates | Candidate surfacing suppressed entirely below the `insufficient-signal` floor; strong-match requirement on top of the score threshold. |
| First in-place `issues.update({body})` in the repo | Isolated in Unit 4 with tick-preservation + created-ID staleness tests; called only under the scoped report token on non-dry-run. |
| Public-output leak via aggregated candidate/evidence text | Public-safe by construction (class key + public URL + checkbox only); render functions never receive raw titles/bodies; mutation-proof real-compose gate test (R20, Unit 6). |
| git add-dates need full history | Detect checkout sets `fetch-depth: 0`; `gitHistoryUnavailable` presence bit fails closed if history is missing. |
| Depends on existing proposal-loop labels/markers staying stable | Reuses their published label sets; classification uses marker→visible→sentinel precedence so a missing marker degrades to a sentinel, not a crash. |

## Documentation / Operational Notes

- README gains an operator-facing section (Unit 6): what the metric means, how to tick a recurrence on the report issue, dry-run-default run instructions.
- No monitoring/rollout infra beyond the workflow; manual dispatch only. Revisit trigger: a sustained non-zero confirmed-recidivism count is the signal to consider an action-graduation slice (see Deferred to Separate Tasks).

## Sources & References

- **Origin document:** `docs/brainstorms/2026-07-09-o8-improvement-metric-requirements.md`
- Template loop: `.github/workflows/capture-patterns.yaml`, `scripts/capture-patterns-cluster.ts`, `scripts/capture-patterns-open.ts`, `scripts/capture-patterns-synthesis.ts`
- Reused gate: `scripts/status-truth-public-output.ts`
- Checklist live-state + upsert/staleness precedent: `scripts/status-truth-proposals.ts`, `scripts/reconcile-repos.ts`, `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`
- Closed-vocabulary + perimeter learnings: `docs/solutions/best-practices/closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md`, `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`, `docs/solutions/security-issues/survey-workflow-side-privacy-gate-2026-05-16.md`
