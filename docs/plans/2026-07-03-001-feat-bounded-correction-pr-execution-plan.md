---
title: 'feat: Bounded correction PR execution for Status Truth'
type: feat
status: complete
completed: 2026-07-03
date: 2026-07-03
origin: docs/brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md
---

# feat: Bounded correction PR execution for Status Truth

## Overview

Replace the Status Truth workflow's disabled PR placeholder with a real, tested execution path
that ships fully disarmed. The slice extends the pure planner with close actions, budget
semantics, and corrector/re-verification seams; adds a PR execution shell with independent
safety enforcement; wires the workflow job behind a three-key arming model; and implements the
first kind-specific corrector (plan-consistency) — untriggerable until a kind graduates, which
this slice deliberately does not do.

## Problem Frame

The A2 arc's first proposal lifecycle completed (three drifted findings → three proposals → fix →
three resolved positives, zero false positives), but the execution machinery for the graduation
path is a documented no-op: no close action, no corrected-content computation, no write
credential path (see origin: `docs/brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md`).
Building the machinery and graduating a kind are separate reviewed decisions; only the first has
evidence today.

## Requirements Trace

From the origin document: R1–R2 (three-key arming, ships disarmed), R3–R4 (graduation policy,
reviewed-code-change-only), R5–R7 (pure correctors, execution-time re-verification, single-file
bounds), R8–R9 (per-fingerprint dedupe, one-new-open budget with rediscovery exempt), R10/R10b
(close-on-clear and terminal-label closure, merged PRs untouched), R11–R11d (mint-time scoping,
shell-side diff validation, correction-branch-pattern-only writes, same-run outputs only),
R12–R14 (no protected mutations, gated rendered surfaces, counts-only telemetry).

## Scope Boundaries

- `GRADUATED_CLAIM_KINDS` ships empty; no kind graduates.
- No autonomous merge, approve, automerge, force-push, retarget, or branch-protection interaction.
- No multi-file or multi-finding PRs; no corrections outside allowed-path prefixes.
- No changes to detect resolvers, the proposal loop, or scheduled-run behavior.
- Scheduled runs never open PRs regardless of arming state.

### Deferred to Separate Tasks

- Graduating plan-consistency (or any kind): separate one-line reviewed change once ≥1 explicit
  `status-truth:accepted` outcome exists.
- Lifting the one-new-open-per-run cap: separate reviewed change if review throughput warrants.

## Context & Research

### Relevant Code and Patterns

- `scripts/status-truth-prs.ts` — pure planner to extend. Today: three action types
  (`open-pr`, `rediscover-pr`, `downgrade-to-proposal`), empty `GRADUATED_CLAIM_KINDS`,
  allow/forbid path prefixes, `deriveOpaqueDigest`/`buildOpaqueBranchName`/`buildOpaqueTitle`,
  `findMatchingExistingPr` (open + bot-owned + main-target + digest + branch-prefix checks).
  Missing: close action type, rediscovery-exempt open budget (rediscovery currently consumes the
  slot), corrector/re-verification seams.
- `scripts/status-truth-proposals.ts` — executor shell pattern to mirror: dry-run short-circuit
  (counts only, zero API calls), preflight before writes, per-action isolated try/catch with
  failure accounting, result JSON to a path env var, counts-only stdout. `TERMINAL_LABELS`
  (`rejected`, `false-positive`) is the R10b source.
- `scripts/status-truth-detect.ts` — re-verification composition for plan-consistency:
  `parsePlanFrontmatterStatus` (line-based `status:` regex enables a bounded line rewrite),
  `buildPlanConsistencyClaim`, `parsePlanUnitCheckboxes`, `resolvePlanConsistencyVerdict`.
- `scripts/commit-metadata.ts` — single-file API commit precedent
  (`repos.createOrUpdateFileContents` with 409 retry and conflict-exhausted accounting).
- `scripts/wiki-ingest.ts` — multi-file branch/commit API pattern (`git.getRef` → `createBlob` →
  `createTree` → `createCommit` → `updateRef`) with retry/backoff; reference if the single-file
  path needs branch-creation mechanics (`git.createRef`).
- `.github/workflows/status-truth.yaml` — prs placeholder job (gated on
  `vars.STATUS_TRUTH_PRS_ENABLED`); the open job's token mint
  (`actions/create-github-app-token`, repo-scoped, `permission-issues: write`,
  `permission-contents: read`) is the mint pattern; the PR job's mint raises contents to write.
  Detect→open handoff uses the report artifact + result JSON paths.
- `scripts/status-truth-prs.test.ts` — planner test fixtures (`makeReport`,
  `makeDriftedFinding`, `makeInput`) and invariant-sectioned describe blocks to extend.

### Institutional Learnings

- `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`:
  round-trip every marker contract; sentinel normalization; passthrough dividend.
- `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md`:
  privilege is bounded at mint time, not by having a second token.
- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`: every rendered PR
  surface (title, branch, body, close comment) is a public perimeter needing gate coverage.
- `docs/solutions/best-practices/pure-core-privacy-gates-shared-module-2026-06-22.md`: planner
  stays pure; I/O failures live in the shell.
- `docs/solutions/best-practices/github-issues-api-same-run-eventual-consistency-2026-05-20.md`:
  same-run created-state discipline when the shell mutates then reports.

## Key Technical Decisions

- **Planner plans, shell enforces:** the planner remains pure and computes intended actions; the
  execution shell independently re-validates every safety property before any write (single-file
  diff match, correction-branch pattern, live-content re-verification). Neither layer trusts the
  other — planner bugs cannot push, and shell bugs cannot plan.
- **Corrector seam is per-kind and pure:** a corrector map keyed by claim kind exposes
  `content → corrected content`. Only plan-consistency ships a corrector (bounded frontmatter
  `status:` line rewrite). Kinds without correctors downgrade to proposal-only even if graduated.
- **Re-verification lives in the shell only:** the report artifact carries normalized fields, not
  file content, so the planner cannot verify corrected content. The planner gates on structural
  facts (graduated kind, corrector exists, path allowed, budget); the shell re-reads the live
  base-branch file, runs the corrector, and requires the corrected content to re-resolve current
  before any write (R6 TOCTOU guard). Re-verification failure is a distinct downgrade count.
- **Terminal-label state is fetched by the shell:** the shell lists open/closed `status-truth`
  proposal issues (the open job's listing pattern), derives per-fingerprint terminal state from
  `TERMINAL_LABELS`, and passes it into the planner input as a terminal-fingerprints set. This is
  why the PR-job mint carries `permission-issues: read` — operator labels land between runs and
  must be read live, not from the previous run's result JSON.
- **Close actions cover two causes:** drift-cleared (complete scan, fingerprint absent) and
  terminal-labeled proposal (R10b). One `close-pr` action type with a reason field; merged PRs
  are excluded by the open-state check in rediscovery.
- **Budget semantics are explicit:** `newOpenBudget = 1` per run; rediscovery, close, and
  downgrade actions never consume it. This replaces the current cap logic where rediscovery
  consumes the slot.
- **Branch mechanics via API, not git CLI:** create ref from base HEAD, single-file commit via
  `createOrUpdateFileContents` on the correction branch (the live re-read via `repos.getContent`
  supplies both the content for re-verification and the blob `sha` the update call requires),
  following the commit-metadata retry pattern. Branch deletion via `git.deleteRef`. All three
  write primitives — createRef, file update, deleteRef — independently validate the
  correction-branch pattern before calling (R11c); every validation runs before the first write
  call of an action, so a refused action creates no branch object at all.
- **Branch collision policy:** deletion failures are counted-not-fatal, so stale correction
  branches are inevitable. On createRef 422 (ref exists): fetch the existing tip; if its
  single-file diff equals the freshly computed corrected content, reuse the branch; otherwise
  refuse with a counted safety error. Never force-update. The same policy covers leftover
  branches from closed-but-not-merged PRs (rediscovery matches open PRs only; a new drift episode
  plans a fresh open and hits this policy on the stale branch).
- **Minted tokens never serialize:** the write token lives in step env only; it never enters
  result JSON, summaries, rendered surfaces, or failure logs.
- **Arming is evaluated in three places:** workflow `if:` (variable + dispatch input), shell
  startup (env re-check, exits disarmed-counts-only), and planner (`enabled` flag downgrades
  everything). Defense in depth over a single gate.

## Open Questions

### Resolved During Planning

- Re-verification placement: both planner (detect-time) and shell (live content) — see Key
  Technical Decisions.
- Credential precedent: the open job's `actions/create-github-app-token` mint, raised to
  `permission-contents: write` and `permission-pull-requests: write`, repo-scoped.
- PR-action counts surface: a result JSON path env var consumed by the workflow summary,
  mirroring the open job; counts join the job summary, not the detect report artifact.

### Deferred to Implementation

- Exact `close-pr` reason vocabulary (`drift-cleared` vs `terminal-label`) naming.
- Whether branch deletion failures (already-deleted, protected-by-race) are retried or counted
  and skipped — follow the proposals shell's isolated-failure pattern.
- Exact dispatch input name (`open_prs` vs `enable_prs`) — match existing input naming style.

## Implementation Units

- [x] **Unit 1: Planner extensions — close actions, budgets, corrector seam**

**Goal:** The pure planner models the full correction-PR lifecycle under the new safety contract.

**Requirements:** R5 (seam), R6 (planner-side re-verification), R8, R9, R10, R10b

**Dependencies:** None

**Files:**
- Modify: `scripts/status-truth-prs.ts`
- Test: `scripts/status-truth-prs.test.ts`

**Approach:**
- Add `close-pr` action type with a reason field (drift-cleared, terminal-label) and branch
  name; extend `ExistingStatusTruthPr` with the branch data closure needs.
- Extend the planner input with a shell-supplied terminal-fingerprints set (derived from proposal
  issue labels; the planner never does I/O to obtain it).
- Replace the cap logic: `newOpenBudget` counts only `open-pr` actions; rediscovery, close, and
  downgrades are exempt.
- Add the corrector seam: a per-kind registry the planner consults for existence only — a
  graduated kind without a registered corrector downgrades with a distinct reason. Content-level
  re-verification is shell-only (the planner has no file content).
- Ownership split with Unit 3: this unit owns pure planning exports (action modeling, budgets,
  closure/downgrade decisions); Unit 3 owns execution functions and API calls. The boundary is
  the action schema — the shell consumes planned actions and re-validates them; it never reaches
  into planner internals.
- Closure planning: fingerprint absent from a complete, non-execution-failure report while an
  open bot-owned PR exists → close-pr (drift-cleared); linked proposal carries a terminal label →
  close-pr (terminal-label) regardless of drift.

**Execution note:** Test-first; every budget/closure/downgrade rule is a table-testable invariant.

**Test scenarios:**
- Happy path: graduated drifted finding with passing corrector → one open-pr with opaque
  branch/title (AE3).
- Edge case: three eligible findings → one open-pr + two overflow downgrades (AE4).
- Edge case: existing open PR rediscovered + a second eligible finding → rediscovery does not
  consume the budget; the second finding gets the open-pr slot.
- Edge case: fingerprint cleared on complete scan with open PR → close-pr(drift-cleared);
  incomplete scan → no close action (AE5).
- Edge case: terminal-labeled proposal with open PR and persisting drift → close-pr
  (terminal-label) (AE8).
- Edge case: graduated kind without a corrector → downgrade with distinct reason.
- Error path: graduated finding whose fingerprint is in the terminal set with no open PR → no
  action (suppression, not closure).
- Invariant: no action type beyond the four; disabled/ungraduated inputs produce zero PR actions
  (AE1).

**Verification:**
- Planner functions remain pure (no I/O in any planning code path; the file hosts the Unit 3
  shell alongside them, matching the proposals-module pattern); all existing planner tests still
  pass unchanged except deliberate cap-semantics updates.

- [x] **Unit 2: Plan-consistency corrector**

**Goal:** First kind-specific pure corrector: bounded frontmatter status-line rewrite.

**Requirements:** R5, R6, R7

**Dependencies:** Unit 1 (seam shape)

**Files:**
- Modify: `scripts/status-truth-detect.ts`
- Test: `scripts/status-truth-detect.test.ts`

**Approach:**
- Pure function: plan content in → corrected content out, rewriting exactly the frontmatter
  `status:` line to `status: complete`; every other byte preserved.
- Composes with existing pieces for re-verification: corrected content → claim → checkbox parse →
  verdict must be current.
- Exported for both planner (Unit 1 seam) and shell (Unit 3 live re-check) use.

**Execution note:** Test-first.

**Test scenarios:**
- Happy path: stale-active fixture → corrected content resolves current; only the status line
  differs.
- Edge case: quoted status values (`status: "active"`) rewritten preserving no quotes or matching
  file style — characterize corpus, pick one canonical output.
- Edge case: `status:` text in the plan body (outside frontmatter) is not touched.
- Error path: content without parseable frontmatter → corrector returns a no-correction signal,
  never a mangled file.
- Round-trip: corrected fixture re-verifies current through the full resolver composition.

**Verification:**
- Diff between fixture and corrected output is exactly one line across all corpus-shaped
  fixtures.

- [x] **Unit 3: PR execution shell with independent safety enforcement**

**Goal:** The Octokit shell executes planned actions with its own validation of every safety
property.

**Requirements:** R6 (live re-check), R11b, R11c, R11d, R12, R13, R14

**Dependencies:** Units 1–2

**Files:**
- Modify: `scripts/status-truth-prs.ts`
- Test: `scripts/status-truth-prs.test.ts`

**Approach:**
- Mirror the proposals executor: per-action isolated try/catch, result JSON to an env-var path,
  counts-only stdout. Dry-run contract: read-only API calls are permitted (proposal-issue
  listing, live file re-read, re-verification) so dry-run exercises the real safety pipeline;
  zero mutating calls; result carries a dry-run marker with would-act counts.
- Fetch proposal-issue label state and build the terminal-fingerprints set for the planner input
  (Unit 1 seam).
- Validation order for open-pr, all before ANY write call (createRef included): re-read the
  target file from live base branch via `repos.getContent` (content + blob sha in one call);
  re-run corrector + re-verification (R6 TOCTOU guard); validate the planned diff is exactly one
  allowed-path file (R11b); validate the branch name matches the correction pattern for the
  current fingerprint (R11c). Any failure aborts the action with a safety-refusal count (AE7,
  AE9) and no branch object exists.
- Branch + commit via API: `git.createRef` from base HEAD, `repos.createOrUpdateFileContents`
  (passing the fetched blob sha) with the commit-metadata 409-retry pattern; PR create with
  opaque title, gated body. On createRef 422: apply the branch collision policy (reuse only if
  the existing tip matches the computed correction; otherwise counted refusal; never
  force-update).
- Close-pr execution: close own PR with a brief gated comment, delete branch via `git.deleteRef`
  only when the branch matches the correction pattern (R11c); deletion failures counted, not
  fatal.
- All rendered surfaces (title, body, close comment) pass `applyPublicOutputGate`; gate failure →
  action aborted, counted (AE6).
- Shell startup re-checks arming env; disarmed → counts-only exit (AE1).

**Execution note:** Test-first with a mocked Octokit following the proposals-shell test pattern;
assert exact API call shapes and the refusal paths.

**Test scenarios:**
- Happy path: open-pr action → createRef + createOrUpdateFileContents + pulls.create with opaque
  metadata; result counts opened=1.
- Happy path: close-pr → pulls.update(closed) + gated comment + deleteRef on pattern-matching
  branch.
- Edge case: live content changed since detection and fails re-verification → no push,
  downgraded count (AE7).
- Edge case: branch name not matching the correction pattern → refusal count, no API write (AE9).
- Edge case: planned diff touches a second file → refusal, no push (R11b).
- Edge case: deleteRef 422 (already gone) → counted, run continues.
- Edge case: createRef 422 with a stale branch whose tip differs from the computed correction →
  counted refusal, no force-update, no PR.
- Edge case: createRef 422 with a branch tip identical to the computed correction → branch
  reused, PR opened.
- Error path: pulls.create failure → isolated failure count, remaining actions still execute.
- Privacy: PR body/close comment failing the gate → action aborted (AE6); all rendered fixtures
  contain only opaque digests and normalized fields; result JSON and stdout contain no token
  material.
- Dry-run: full action list produces zero mutating API calls (read-only listing/re-read calls
  permitted) and would-act counts with a dry-run marker.

**Verification:**
- No API call in any test occurs before every applicable safety validation has passed.

- [x] **Unit 4: Workflow wiring — armed job, dispatch input, scoped mint**

**Goal:** Replace the placeholder prs job with the real gated execution job.

**Requirements:** R1, R2, R11, R11d, R14

**Dependencies:** Unit 3

**Files:**
- Modify: `.github/workflows/status-truth.yaml`

**Approach:**
- Add a string-choice `workflow_dispatch` input matching the existing `dry_run` convention
  (`'true'`/`'false'`, default `'false'`); the prs job's `if:` requires
  `vars.STATUS_TRUTH_PRS_ENABLED == 'true'` AND `github.event_name == 'workflow_dispatch'` AND
  the input string equal to `'true'` (string-to-string comparison per the existing input
  pattern; scheduled runs are structurally excluded by the event check).
- Arming × dry-run matrix is explicit and test-pinned in the shell: armed + `dry_run=true` → the
  prs job runs the full read-only pipeline and reports would-act counts with a dry-run marker;
  armed + `dry_run=false` → mutating execution; any other combination → job skipped or
  counts-only exit with a stated reason.
- Mint the write token inside the prs job only: `actions/create-github-app-token`, repo-scoped,
  `permission-contents: write`, `permission-pull-requests: write`, `permission-issues: read`
  (terminal-label reads).
- Consume the same-run report artifact and open-result JSON (R11d — same-run producer outputs);
  pass paths via env.
- Summary step reports counts only from the shell's result JSON.
- Remove the placeholder stub steps and the "disabled placeholder" naming; keep the graduation
  criteria comment block updated to reflect the shipped three-key model.

**Test scenarios:**
- Test expectation: none — workflow YAML; verified by actionlint-equivalent CI (`Check
  Workflows`), a dry-run dispatch on merged main, and the arming matrix below.

**Verification:**
- With defaults (variable unset), the job is skipped on schedule and dispatch.
- With the variable set but input off, the job is skipped (AE2 shape).
- A fully armed dispatch on a corpus with no graduated kinds runs the shell and reports zero PR
  actions, disarmed-kind counts only (AE1).

- [x] **Unit 5: Operator documentation**

**Goal:** README documents the arming model, graduation policy, and PR lifecycle.

**Requirements:** R3, R4, R12 (documented boundaries)

**Dependencies:** Units 1–4

**Files:**
- Modify: `README.md`

**Approach:**
- Extend the Status-Truth section: three-key arming, graduation policy (explicit accepted
  outcomes required; false-positive removes the kind via reviewed change), one-PR-per-run
  posture, close-on-clear and terminal-label closure semantics, and the human-merge-always
  boundary.

**Test scenarios:**
- Test expectation: none — docs-only; markdown lint and operator-accuracy review.

**Verification:**
- A reader can determine why no PRs open today and exactly which three reviewed steps arm the
  path.

## System-Wide Impact

- **Interaction graph:** detect/open jobs unchanged; prs job goes from no-op to gated executor
  consuming same-run outputs; proposal lifecycle untouched.
- **Error propagation:** every shell action fails in isolation with counts; safety refusals are
  distinct from failures; disarmed states exit clean with counts.
- **State lifecycle risks:** correction branches are created and deleted only under the pattern
  guard; fingerprint → branch mapping is deterministic (opaque digest), so re-drift after
  closure recreates the same branch name from fresh base content.
- **API surface parity:** result-JSON + summary pattern matches the open job; no new report
  artifact fields.
- **Integration coverage:** planner→shell handoff, arming matrix, and refusal paths are all
  test-pinned; live verification is a fully-armed dispatch against an empty graduated set.
- **Unchanged invariants:** `main` protection, human merge, data-branch authority, proposal
  caps/cooldowns/labels, detect resolvers, scheduled-run behavior, and the counts-only telemetry
  contract.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| First contents-write credential in this workflow | Mint-time repo scoping; minted only in the prs job on armed dispatches; R11c pattern refusal at execution; R11b diff validation before push. |
| Planner/shell drift on safety rules | Both layers tested independently; shell never trusts planner output (re-validates path, branch, content). |
| TOCTOU between detect and push | Live re-read + re-verification in the shell; fail-closed downgrade (AE7). |
| Zombie or orphaned correction branches | Close actions delete branches; deletion failures counted; deterministic branch names make orphans discoverable. |
| Accidental arming | Three independent keys; scheduled runs structurally excluded; shell re-checks env at startup. |
| Cap starvation of eligible findings | Rediscovery exempt from the new-open budget (R9); starvation scenario test-pinned. |

## Documentation / Operational Notes

- First armed rehearsal after merge: set the variable, dispatch with the input on, graduated set
  still empty — expect zero PR actions and clean disarmed-kind counts (AE1 live).
- Real graduation later requires: reviewed code change adding the kind + variable + dispatch —
  documented in README (Unit 5).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md](../brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md)
- Related code: `scripts/status-truth-prs.ts`, `scripts/status-truth-proposals.ts`,
  `scripts/status-truth-detect.ts`, `scripts/commit-metadata.ts`, `scripts/wiki-ingest.ts`,
  `.github/workflows/status-truth.yaml`
- Prior plans: [docs/plans/2026-07-02-001-feat-plan-consistency-claim-kind-plan.md](2026-07-02-001-feat-plan-consistency-claim-kind-plan.md)
- Related learnings: `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`,
  `docs/solutions/best-practices/credential-mint-time-permission-scoping-2026-06-22.md`,
  `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md`
