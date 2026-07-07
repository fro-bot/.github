---
title: Fix A3 receipt contract state handling
type: fix
status: active
date: 2026-07-07
source: https://github.com/fro-bot/.github/issues/3653
---

# Fix A3 receipt contract state handling

## Overview

Make A3 honest about which targets are receipt-accountable and what a missing receipt means. The first real cross-repo goal (#3652) proved the dispatch path, but also proved the current receipt contract is only a prompt payload: three workers posted accepted receipts, one worker completed local triage and refused the receipt as prompt-injection-shaped, and one worker completed without a visible receipt.

The fix is not stronger prompt wording, a prompt-delivered token, or hidden target workflow changes. The fix is an explicit coordinator-side contract model plus state semantics that distinguish “accepted receipt,” “dispatch accepted but no accepted receipt,” and “run evidence was observed as a diagnostic only.”

## Problem Frame

A3 currently treats the receipt prompt as universal protocol. It is not. Target repos can carry local response policies that say “post exactly one comment” or classify cross-repo comment instructions as suspicious. When that happens, the worker may complete useful work while the coordinator still has no accepted receipt.

The coordinator must keep receipts as the completion oracle for accountable targets, but it must stop pretending prompt text alone makes a target accountable. Receipt support needs to be an operator-managed metadata contract, snapshotted per item at dispatch, and reflected in the tracker state machine. That metadata is an administrative contract and routing gate, not cryptographic proof that a target will comply.

## Requirements Trace

- R1. Distinguish “accepted receipt,” “dispatch accepted but no accepted receipt,” and “run evidence observed without accepted receipt” without claiming `never-ran` from missing run-name correlation.
- R2. Make receipt accountability operator-declared through the data-branch metadata contract; a dispatched prompt cannot be the source of authority for the target’s response policy.
- R3. Preserve the existing receipt verifier: accepted Fro Bot author, item correlation id, and `hash(nonce) === nonceHash`.
- R4. Avoid fake hardening: no receipt-token prompt transport, no per-target workflow hacks hidden in the coordinator, no PR/local-comment polling as completion.
- R5. Document the trust boundary and the #3652 production finding so future A3 goals do not rediscover it.

## Scope Boundaries

- No changes to target repos in this plan.
- No special receipt writer token or GitHub App change.
- No stronger “MUST post receipt” prompt language as the security boundary.
- No regression to polling PRs or local comments for completion.
- No claim that Actions run lookup is authoritative; it remains supporting evidence only.

### Deferred to Separate Tasks

- Target-side policy adoption: individual repos can later document that cross-repo receipts are allowed protocol comments and do not count as the local user-facing response.
- Receipt broker or outer runtime channel: a larger design if the project wants receipt posting outside the LLM task payload.
- Fleet metadata values on the `data` branch: this plan documents the schema and reads the field, but actual target opt-in values should be written through the existing metadata authority path, not on a `main` feature branch.

## Context & Research

### Relevant Code and Patterns

- `scripts/cross-repo-dispatch.ts` owns `DispatchItem`, `ItemStatus`, receipt parsing, receipt resolution, dispatch seeding, SLA handling, and run diagnostics.
- `scripts/cross-repo-dispatch.test.ts` already contains receipt parser, nonce gate, hostile forgery, SLA, and diagnostic coverage to extend.
- `.github/workflows/cross-repo-dispatch.yaml` runs dispatch on approved label events and tracking on schedule/manual dispatch; run lookup is diagnostic-only.
- `README.md` documents the A3 push model and the shared worker-trust residual.
- #3652 is the production fixture: accepted receipts from `gpt`, `fro-bot/agent`, and `fro-bot/dashboard`; missing receipts from `containers` and `opencode-copilot-delegate`.

### Institutional Learnings

- `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md` — preserve the three-gate receipt model and earliest-authentic-receipt-wins.
- `docs/solutions/best-practices/repair-before-a-trust-gate-not-inside-it-2026-07-06.md` — parse tolerance can happen before the trust gate, never inside it.
- `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md` — test the real dispatch-to-track seam with production-shaped inputs.
- `docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md` — success state must cover every required step, not only the intuitive worker-completed step.

## Key Technical Decisions

- KTD1. Receipt accountability is an operator-managed metadata contract, not a prompt instruction or target self-report. The coordinator reads a field such as `cross_repo_receipts: coordination-issue-v1` from metadata and snapshots it onto each dispatched item.
- KTD2. Rollout is staged. Legacy targets without the field remain dispatchable as best-effort, but the tracker must not call missing receipts from those targets “never ran” or “completed.” Future accountable goals can require the metadata contract and block undeclared targets with `receipt-contract-missing` only after the schema ships and the operator has populated metadata through the data branch.
- KTD3. Run lookup remains diagnostic-only. Since dispatch sends only `prompt`, a missing run-name correlation is not proof the worker never ran. Observed runs may explain `no accepted receipt`; unobserved runs stay “not observed,” not evidence of absence.
- KTD4. Accepted receipts stay the only completion oracle. Local comments, PR state, and Actions success can explain a stuck item, but they cannot complete it.
- KTD5. Existing in-flight items keep their snapshotted semantics. Metadata drift after dispatch must not retroactively change whether an item expected a receipt.

## Open Questions

### Resolved During Planning

- Should the fix involve receipt-token/App-token hardening? No. GitHub has no issue-scoped token, and prompt-delivered tokens are theater.
- Should the fix live in target workflows? No for this plan. Target policy adoption is real but separate.
- Should local-only worker comments count as completion? No. They are diagnostics unless they include an accepted coordination receipt.

### Deferred to Implementation

- Exact metadata field name: choose the smallest name that fits existing metadata schema conventions and document its authority in `metadata/README.md`.
- Exact blocked/deferred status: use the existing status that produces the clearest operator behavior for future accountable goals without inventing a new terminal state unless tests prove the existing vocabulary is insufficient.

## Rollout Sequence

1. Ship schema/read support and tracker semantics with no `metadata/repos.yaml` value changes on `main`.
2. Treat existing markers and targets without the new field as legacy/best-effort. #3652 remains evidence for diagnostics and should not be retroactively reclassified as receipt-accountable.
3. Initial data-branch backfill candidates are only the #3652 targets that produced accepted coordination receipts: `marcusrbrown/gpt`, `fro-bot/agent`, and `fro-bot/dashboard`. Leave `marcusrbrown/containers` and `marcusrbrown/opencode-copilot-delegate` unset until target-side policy or a later accepted receipt justifies the assertion.
4. Backfill is forward-only. Open items created before the field exists keep their snapshotted legacy semantics forever; the tracker must not reread newer metadata to change their contract.
5. Enable blocking for future accountable A3 goals only after the data-branch backfill has promoted to `main`. Until then, non-declared targets can still be dispatched as best-effort, but missing receipts keep the goal open instead of producing false completion.
6. Future accountable goals evaluate receipt capability once at dispatch. They do not re-evaluate already-seeded items if metadata changes later.

## Implementation Units

- [x] **Unit 1: Metadata receipt contract model**

**Goal:** Represent the operator-managed receipt contract read by A3 dispatch.

**Requirements:** R2, R4

**Dependencies:** None

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`
- Modify: `scripts/cross-repo-dispatch.test.ts`
- Modify: `metadata/README.md`

**Approach:** Add an optional metadata capability for cross-repo receipts and parse it through the existing target registry gate. The field is authoritative only because `metadata/repos.yaml` is a data-branch, sole-writer contract; it is not target self-report and does not prove runtime compliance. Missing capability means “best-effort/no accountable receipt contract,” not “try harder with prompt wording.” Do not edit `metadata/repos.yaml` on `main`, and do not make missing values block legacy dispatch until the operator has populated data-branch values.

**Execution note:** Implement test-first with fixture metadata entries for opted-in and non-opted-in targets.

**Patterns to follow:** Existing `has_fro_bot_workflow`, `private`, owner allowlist, and `has_renovate` metadata handling.

**Test scenarios:**
- Happy path: target with receipt capability is classified as receipt-accountable.
- Happy path: target without the field is classified as best-effort/legacy, not as verified receipt-capable.
- Error path: future accountable dispatch mode rejects or blocks a target without the capability with a stable reason.
- Edge case: unknown capability value fails closed with a parse/validation error.
- Edge case: existing eligible targets remain dispatchable as best-effort before the data-branch backfill.
- Edge case: initial backfill candidates are exactly the #3652 accepted-receipt targets; local-only/no-receipt targets remain unset.

**Verification:** Target registry decisions are deterministic, metadata authority is documented, and no `metadata/repos.yaml` values are changed on `main`.

- [x] **Unit 2: Snapshot receipt contract per item**

**Goal:** Persist the target’s receipt contract mode onto every item at dispatch time.

**Requirements:** R1, R2, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`
- Modify: `scripts/cross-repo-dispatch.test.ts`

**Approach:** Add a snapshotted field to `DispatchItem` such as `receiptContract`. Dispatch should set it from the target capability before writing the marker. Tracking must read the snapshot, not current metadata, when deciding no-receipt diagnostics. Legacy markers without the field use legacy/best-effort semantics.

**Execution note:** Add characterization coverage for existing markers without the new field before changing marker handling.

**Patterns to follow:** Existing `promptHash`, `correlationId`, `nonceHash`, and `epoch` snapshots.

**Test scenarios:**
- Happy path: a new dispatched item stores the expected contract version.
- Backward compatibility: a legacy marker without the field still parses and tracks under legacy semantics.
- Edge case: metadata changes after dispatch do not change the item’s receipt expectation.
- Edge case: #3652-shaped markers are not retroactively made receipt-accountable by later metadata population.
- Edge case: a future metadata update does not mutate an already-seeded item’s contract or status.

**Verification:** Marker schema remains backward compatible and deterministic.

- [ ] **Unit 3: No-receipt diagnostic semantics**

**Goal:** Make missing-receipt state honest about what the coordinator can prove.

**Requirements:** R1, R3, R4

**Dependencies:** Unit 2

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`
- Modify: `scripts/cross-repo-dispatch.test.ts`

**Approach:** Keep accepted receipts as the only terminal completion source. For no-receipt items, annotate diagnostics based on the snapshotted contract and observable run evidence. Avoid a broad new taxonomy: use one conservative default such as `dispatch-accepted-no-receipt`, and optionally add `run-observed-no-receipt` when the Actions lookup finds a completed correlated run. Do not emit `never-ran` from missing lookup evidence.

**Execution note:** Extend existing SLA/diagnostic tests before changing names or state transitions.

**Patterns to follow:** Existing `needsAttentionReason`, `noReceiptDiagnostic`, `findWorkflowRunByCorrelationId`, and reversible `needs-attention` tests.

**Test scenarios:**
- Happy path: accepted receipt still resolves to `completed`, `failed`, or `noop` as before.
- Error path: opted-in target with no receipt after SLA becomes `needs-attention` with a no-receipt reason.
- Edge case: run lookup finds a completed run but no accepted receipt; item remains non-terminal with a run-observed diagnostic.
- Edge case: run lookup finds nothing; item remains non-terminal with no-receipt diagnostic and no claim that the worker never ran.
- Integration: late valid receipt after `needs-attention` still resolves and clears the flag.

**Verification:** State transitions are conservative and do not mark local-only worker success as completion.

- [ ] **Unit 4: Production-fixture regression for #3652**

**Goal:** Encode the first real A3 failure mode so it does not regress into false success.

**Requirements:** R1, R3, R4

**Dependencies:** Units 1-3

**Files:**
- Modify: `scripts/cross-repo-dispatch.test.ts`

**Approach:** Add a production-shaped integration test from #3652: three accepted receipts, one target with a local-only completion comment but no coordination receipt, and one target with no accepted receipt. The expected outcome is partial terminal state plus explicit needs-attention/diagnostic state, not closure.

**Execution note:** Use the real marker/result shape, but redact raw nonces and avoid embedding private tokens or full logs.

**Patterns to follow:** Existing golden-path and hostile-forgery integration tests.

**Test scenarios:**
- Integration: three valid receipts settle three items, two missing receipts keep the issue open.
- Integration: local-only diagnostic evidence does not complete an item.
- Error path: a malformed or absent receipt produces visible non-terminal state.

**Verification:** Removing receipt-gate enforcement or treating Actions success as completion fails the test.

- [ ] **Unit 5: Documentation and operator contract**

**Goal:** Update public docs and issue guidance to describe receipt opt-in, missing-receipt diagnostics, and the #3652 finding.

**Requirements:** R2, R4, R5

**Dependencies:** Units 1-4

**Files:**
- Modify: `README.md`
- Modify: `metadata/README.md`
- Modify: `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md`
- Modify: `docs/plans/2026-07-07-001-fix-a3-receipt-contract-state-plan.md`

**Approach:** State that A3 receipt completion is accountable only for metadata-declared receipt-capable targets. Keep the shared worker-trust residual and target policy boundary visible. Do not edit `.github/workflows/fro-bot.yaml` just to strengthen prompt wording; that would recreate the same overclaim.

**Test scenarios:**
- Test expectation: none for docs prose; lint verifies markdown formatting.

**Verification:** README, metadata docs, and solution docs no longer imply universal receipt authority for non-declared targets.

## System-Wide Impact

- **Interaction graph:** Goal issue → decomposition → dispatch marker → target run → coordination receipt → track state. This plan changes dispatch gating and track interpretation, not target worker execution.
- **Error propagation:** Missing receipts stay visible as `needs-attention`/diagnostic state. They do not silently complete and do not close the goal.
- **State lifecycle risks:** Existing markers must keep parsing. In-flight markers should not inherit new metadata after dispatch.
- **API surface parity:** `cross-repo-dispatch.ts dispatch` and `track` must agree on the receipt contract field.
- **Integration coverage:** The #3652 production shape becomes a permanent fixture.
- **Unchanged invariants:** Dispatch remains prompt-only; receipt trust remains author + correlation id + nonce hash; the target workflow still owns its local response policy.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Blocks currently dispatchable targets until metadata opts them in | Stage rollout: legacy targets remain best-effort; only future accountable dispatch mode blocks undeclared targets. |
| Operator loses useful local-only reports | Treat them as diagnostics and link them in summaries, but do not let them complete receipt-accountable items. |
| Diagnostic overclaim persists | Remove `never-ran` as an output from missing run lookup; reserve run lookup for supporting evidence only. |
| Docs drift back into token/prompt theater | Keep #3653 and the #3652 production fixture linked from README/solution docs. |

## Documentation / Operational Notes

- After implementation, update #3653 with the chosen metadata field and state vocabulary.
- Leave #3652 open until the tracker settles or the operator manually resolves it; it is evidence, not just cleanup.
- If a target becomes receipt-accountable later, record that through the data-branch metadata path and link any target policy docs as supporting evidence, not as the coordinator’s enforcement mechanism. The initial candidate set is `marcusrbrown/gpt`, `fro-bot/agent`, and `fro-bot/dashboard` because those targets posted accepted #3652 receipts.
- Do not enable accountable-goal blocking until at least one data-branch metadata promotion has carried the receipt capability values to `main`.

## Sources & References

- Source issue: https://github.com/fro-bot/.github/issues/3653
- Production goal: https://github.com/fro-bot/.github/issues/3652
- Dispatch run: https://github.com/fro-bot/.github/actions/runs/28834881437
- Track run: https://github.com/fro-bot/.github/actions/runs/28835357166
- Containers local-only triage: https://github.com/marcusrbrown/containers/issues/415#issuecomment-4899219084
- Parent plan: `docs/plans/2026-07-04-002-feat-cross-repo-dispatch-push-tracking-plan.md`
- Receipt learning: `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md`
- Parse learning: `docs/solutions/best-practices/repair-before-a-trust-gate-not-inside-it-2026-07-06.md`
- Integration learning: `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md`
