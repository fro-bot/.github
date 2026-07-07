---
title: 'feat: Graduate plan-consistency Status Truth correction PRs'
type: feat
status: active
date: 2026-07-07
origin: docs/brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md
---

# feat: Graduate plan-consistency Status Truth correction PRs

## Overview

Graduate the `plan-consistency` Status Truth claim kind from proposal-only signal to bounded correction PR eligibility. The graduation is backed by real operator evidence: one explicit accepted proposal (#3656) and three resolved-positive historical proposals (#3614–#3616). The change must also finish the PR execution CLI path that the bounded-correction slice intentionally left inert while no claim kinds were graduated.

This does not arm autonomous PR creation by itself. Correction PRs still require all three keys: reviewed graduated kind, repository variable enabled, and a manual workflow dispatch with PR execution requested. This plan exists to make `plan-consistency` graduation meaningful by unblocking the already-designed PR runner; it is not a broader rewrite of Status Truth.

## Problem Frame

Status Truth now has enough evidence to graduate `plan-consistency`, but the runtime path is not functionally complete. `GRADUATED_CLAIM_KINDS` is empty, and `scripts/status-truth-prs.ts` still exits from the armed path after printing `{armed: true, dryRun}`. A one-line set change would be theater: it would make the kind look graduated while armed runs still produce zero correction PR actions.

The work therefore needs to graduate the kind and complete the same-run report-read → plan → execute loop behind the existing arming model.

## Requirements Trace

- R1. Graduate only `plan-consistency`, citing #3656 as the explicit accepted outcome and #3614–#3616 as resolved-positive supporting signal.
- R2. Preserve the three-key arming model: repository variable, non-empty reviewed graduated set, and manual `open_prs=true` dispatch input.
- R3. Scheduled runs and normal dry-runs must never open correction PRs.
- R4. Replace the armed CLI stub with the real same-run pipeline: read report artifact, fetch existing correction PR/proposal state, plan actions, and execute through the existing executor.
- R5. Keep correction PR writes bounded to the already-built safety model: one-file corrections, allowed paths only, live re-read/re-verification, opaque branch/title metadata, public-output gate, and one-new-open-per-run cap.
- R6. Fix the App-token mint scope in `.github/workflows/status-truth.yaml`: the `actions/create-github-app-token` step in the PR job must request `permission-issues: write` because `executeStatusTruthPrActions` closes stale/terminal correction PRs by calling `issues.createComment`; job-level `permissions` stay read-only.
- R7. Update tests to pin both the new graduation evidence and the functional CLI path; no change may rely on manual inspection of workflow logs.
- R8. Do not set or change the `STATUS_TRUTH_PRS_ENABLED` repository variable and do not dispatch a live PR-opening run as part of implementation.
- R9. Preserve the public-output contract: stdout, result JSON, step summaries, and failure messages carry only counts and closed-vocabulary reason keys, never report paths, source paths, fingerprints, branch names, PR/proposal identifiers, titles, bodies, or token material.
- R10. Preserve serialized execution and branch ownership: the existing `status-truth` workflow concurrency group serializes runs, and every write/delete must re-check the bot-owned `status-truth/correction-*` branch pattern before mutation.

## Scope Boundaries

- In scope: `plan-consistency` graduation, PR CLI runner completion, workflow token permission correction, tests, and minimal operator docs.
- Out of scope: enabling the repo variable, running `open_prs=true`, changing the one-new-open-per-run cap, graduating other claim kinds, adding new correctors, broad Status Truth redesign, automerge, or branch-protection changes.
- Out of scope: re-litigating the proposal loop, detector claim kinds, or the outcome taxonomy; those are already shipped and verified.

### Deferred to Separate Tasks

- Lifting the one-new-open-per-run cap remains out of scope.
- Removing `plan-consistency` after a future false-positive remains out of scope and requires a separate reviewed change.

## Context & Research

### Relevant Code and Patterns

- `scripts/status-truth-prs.ts` — contains `GRADUATED_CLAIM_KINDS`, `planStatusTruthPrActions`, `executeStatusTruthPrActions`, the corrector/re-verifier registries, and the current stubbed `runPrs()` entry point.
- `scripts/status-truth-prs.test.ts` — already tests planner and executor behavior with injected `new Set(['plan-consistency'])`; the production constant test currently expects an empty set.
- `.github/workflows/status-truth.yaml` — hosts the three-job detect/open/prs workflow and the PR job's write-token mint.
- `scripts/status-truth-proposals.ts` — proposal executor pattern to mirror for label/fetch/plan/execute sequencing and counts-only outputs.
- `README.md` — documents the Status Truth outcome labels, three-key PR arming model, and graduation policy.

### Institutional Learnings

- `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md` — `plan-consistency` is a synthetic self-audit kind; do not add a prose-regex definition for it.
- `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md` — outcome counts by kind must stay closed-vocabulary and counts-only.
- `docs/solutions/security-issues/verify-whole-public-perimeter-2026-06-22.md` — every PR/output surface must pass the existing public-output gate; the gate is the invariant, not intent.
- `docs/solutions/best-practices/observability-before-structural-change-2026-06-09.md` — the accepted/resolved proposal history is the live evidence justifying this structural step.

## Key Technical Decisions

- Graduate only `plan-consistency`: it has the required explicit accepted proposal (#3656) and already has a bounded corrector/re-verifier.
- Complete the CLI runner before relying on the graduated set: a set-only change would satisfy documentation but not behavior.
- Keep arming operationally separate from graduation: implementation changes code only; operators still choose whether to set `STATUS_TRUTH_PRS_ENABLED` and dispatch `open_prs=true`.
- Use `issues: write` on the PR job's minted GitHub App token, not the job token: pull request comments are Issues API comments, and stale/terminal closure is part of the already-designed executor. `pull-requests: write` alone cannot create the closure comment.
- Do not update historical plan/requirements docs that described earlier shipped state; cite the new evidence in the new plan, code comments, tests, README, and PR body instead.

## Open Questions

### Resolved During Planning

- Should this be a set-only graduation? No. The current `runPrs()` armed path is a stub, so set-only graduation would be functionally inert.
- Should the repo variable be enabled as part of this change? No. The repository variable is an operational arming key, not part of the reviewed graduation PR.

### Deferred to Implementation

- Exact helper names inside `runPrsCore()`: choose names during implementation, but the seam itself is required.

## Implementation Units

- [x] **Unit 1: Complete the PR execution CLI runner**

**Goal:** Replace the armed `runPrs()` stub with the real same-run report-read, state-fetch, planning, and execution path.

**Requirements:** R2, R3, R4, R5, R7

**Dependencies:** None

**Files:**
- Modify: `scripts/status-truth-prs.ts`
- Test: `scripts/status-truth-prs.test.ts`

**Approach:**
- Keep the disarmed path unchanged: counts-only result and no write-token requirement.
- Extract an exported, testable `runPrsCore()` seam with explicit dependencies for environment flags, report loading, Octokit/client creation, public-output token loading, existing-PR fetch, terminal-fingerprint fetch, planner, executor, stdout/result writing, and process-exit signaling. `runPrs()` stays a thin environment wrapper.
- In the armed path, read `STATUS_TRUTH_REPORT_PATH`, parse the same-run detect report, fetch `existingPrs` from open pull requests created by the bot whose head branch starts with `status-truth/correction-` and base is `main`, and fetch `terminalFingerprints` from status-truth proposal issues carrying terminal labels (`status-truth:rejected` or `status-truth:false-positive`) by strict extraction of the existing `<!-- status-truth:fingerprint=<hex> -->` marker format.
- Terminal fingerprint extraction is fail-closed per issue: malformed, missing, non-hex, or duplicate terminal fingerprints are excluded and counted as skipped/invalid terminal records; they must never suppress another fingerprint by fuzzy matching.
- Call `planStatusTruthPrActions`, then `executeStatusTruthPrActions`. Existing proposal labels are read only to derive terminal fingerprints; accepted/resolved labels are evidence and outcome math, not terminal suppressors.
- Preserve counts-only stdout/result JSON and the existing failure posture: missing report, malformed report, unavailable state fetch, or token/public-output load failure fails closed before writes.
- Mode matrix: scheduled and manual `open_prs=false` skip the PR job; manual `open_prs=true` with the repo variable unset is disarmed counts-only; manual armed dry-run may perform read-only discovery/planning and reports would-act counts with zero mutating calls; manual armed live may mutate only through executor actions after all safety checks.

**Execution note:** Test-first; start with a `runPrsCore()` test that would fail against the current `{armed:true,dryRun}` stub.

**Patterns to follow:**
- `scripts/status-truth-proposals.ts` `runOpen()` for report/result-path handling and counts-only output.
- Existing `status-truth-prs` planner/executor tests for injected Octokit shape and per-action accounting.

**Test scenarios:**
- Integration: armed dry-run with a report containing one graduated `plan-consistency` drift produces planned would-open counts and no mutating API calls.
- Happy path: armed live mode with one eligible finding calls the executor path and reports opened counts when the mocked executor succeeds.
- Edge case: disarmed mode still exits counts-only and does not require `STATUS_TRUTH_REPORT_PATH`.
- Edge case: terminal-label proposal issue contributes its fingerprint to `terminalFingerprints`; accepted/resolved labels do not.
- Edge case: terminal-label proposal issue with malformed, missing, or non-hex fingerprint marker is ignored and counted, never converted into a terminal suppression.
- Edge case: existing bot-owned `status-truth/correction-*` PR targeting `main` is passed into planner rediscovery; non-bot, non-main, or non-prefix PRs are ignored.
- Recovery: if a previous run created the branch/PR but failed later, the next run rediscovers the existing bot-owned correction PR and plans rediscovery/closure rather than opening a duplicate.
- Error path: missing report path, malformed report, failed state fetch, or failed public-output token load exits non-zero before any mutation.
- Privacy/output: stdout, result JSON, and error messages contain only counts and reason keys; no source path, report path, fingerprint, branch name, PR/proposal number, title, body, token, or rendered PR body.

**Verification:**
- The current armed stub behavior is gone; the CLI path exercises real planning/execution while preserving the disarmed no-op and counts-only output contract.
- Tests prove partial-success recovery: an existing matching correction PR from a prior partially successful run prevents duplicate PR creation and still allows stale/terminal closure planning.

- [ ] **Unit 2: Correct PR job token permissions**

**Goal:** Give the PR execution job exactly the write permissions its executor already needs for stale/terminal PR closure comments.

**Requirements:** R6, R8

**Dependencies:** Unit 1

**Files:**
- Modify: `.github/workflows/status-truth.yaml`
- Test: `scripts/status-truth-prs.test.ts`

**Approach:**
- Change only the PR job's `actions/create-github-app-token` inputs from `permission-issues: read` to `permission-issues: write`, preserving repo scoping plus `permission-contents: write` and `permission-pull-requests: write`.
- Do not change job-level default permissions or the detect/open credential split.
- Add an automated workflow assertion, mirroring `scripts/wiki-lint-issues.test.ts`, that parses `.github/workflows/status-truth.yaml` and pins the PR job App-token inputs (`contents: write`, `pull-requests: write`, `issues: write`) plus the read-only job token permissions.

**Patterns to follow:**
- Existing open job's scoped token mint for proposal issues.
- Existing comments in `.github/workflows/status-truth.yaml` that explain credential boundaries.

**Test scenarios:**
- Workflow contract: parsed workflow test finds the PR job App-token step and asserts `permission-issues: write`, `permission-pull-requests: write`, `permission-contents: write`, repo scoping, and job-level `permissions.contents: read`.
- Regression: workflow `if:` still requires repo variable, workflow_dispatch event, and `open_prs == 'true'`.

**Verification:**
- Workflow lint and the parsed workflow test pass; the PR job is still reachable only through the existing arming `if:` gate.

- [ ] **Unit 3: Graduate `plan-consistency` and update operator docs**

**Goal:** Add `plan-consistency` to the reviewed graduated set and update tests/docs with the evidence trail.

**Requirements:** R1, R2, R7, R8

**Dependencies:** Units 1–2

**Files:**
- Modify: `scripts/status-truth-prs.ts`
- Modify: `scripts/status-truth-prs.test.ts`
- Modify: `README.md`

**Approach:**
- Change `GRADUATED_CLAIM_KINDS` to include exactly `plan-consistency`.
- Update the production JSDoc and the exported-constant test to cite #3656 as explicit accepted evidence and #3614–#3616 as resolved-positive support.
- Keep README's three-key arming language intact; add a terse note that `plan-consistency` is the first graduated kind, while PR creation still requires the variable and manual dispatch input.

**Execution note:** Test-first for the exported constant and arming behavior.

**Patterns to follow:**
- Existing tests that inject `new Set(['plan-consistency'])` for planner behavior.
- README Status Truth section's terse operator-facing label/arming style.

**Test scenarios:**
- Happy path: `GRADUATED_CLAIM_KINDS` contains exactly `plan-consistency`.
- Safety: `isPrExecutionArmed` remains false unless repo variable, dispatch input, and non-empty graduated set are all true.
- Regression: scheduled/default dispatch assumptions remain documented and unaffected.

**Verification:**
- Full repo gate passes; no workflow variable is set and no PR-opening run is dispatched.

## System-Wide Impact

- **Interaction graph:** Status Truth detect/open behavior stays unchanged. Only the PR execution job becomes functionally capable when all arming keys are present.
- **Error propagation:** Failures before safety validation perform no writes. Failures after an individual action succeeds are partial-success states: earlier writes are not rolled back, later failures are counted, and the next run must rediscover/close/update through existing idempotent branch and PR checks.
- **State lifecycle risks:** Correction PR branches and stale PR closure are bounded by opaque branch names, bot ownership checks, workflow-level `status-truth` concurrency, branch-collision fail-closed behavior, and close/delete safeguards.
- **Partial-success recovery:** The runner does not roll back already-created branches or PRs. Recovery is by rediscovery: subsequent runs identify matching bot-owned correction PRs and avoid duplicates, then close/delete through the normal stale/terminal path when appropriate.
- **API surface parity:** The CLI result remains counts-only JSON; the workflow summary can continue reading the same result shape.
- **Integration coverage:** The critical integration seam is `runPrs()` calling the existing planner/executor, not the planner in isolation.
- **Unchanged invariants:** No automerge, no direct `main` writes, no scheduled PR execution, no repo variable change, no broad claim-kind graduation.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| Set-only graduation creates a false sense of functionality | Unit 1 completes the runner before Unit 3 graduates the kind. |
| Permission widening surprises reviewers | Limit the change to the PR job's minted token and explain Issues API comments require `issues: write`. |
| A future armed run opens an unexpected PR | Three-key arming remains; implementation does not set the repo variable or dispatch with `open_prs=true`. |
| Public PR surfaces leak sensitive identifiers | Reuse existing public-output gate and opaque branch/title machinery; no new rendered fields. |

## Documentation / Operational Notes

- After this lands, `plan-consistency` is PR-eligible only when operators deliberately arm the workflow with both the repo variable and manual dispatch input.
- A future operator rehearsal can use `open_prs=true` with `dry_run=true` to prove would-act counts before any live PR creation; that rehearsal is not part of this implementation.

## Sources & References

- Origin document: [docs/brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md](../brainstorms/2026-07-03-bounded-correction-pr-execution-requirements.md)
- Foundation plan: [docs/plans/2026-07-03-001-feat-bounded-correction-pr-execution-plan.md](2026-07-03-001-feat-bounded-correction-pr-execution-plan.md)
- Accepted evidence: [#3656](https://github.com/fro-bot/.github/issues/3656)
- Supporting resolved-positive proposals: [#3614](https://github.com/fro-bot/.github/issues/3614), [#3615](https://github.com/fro-bot/.github/issues/3615), [#3616](https://github.com/fro-bot/.github/issues/3616)
