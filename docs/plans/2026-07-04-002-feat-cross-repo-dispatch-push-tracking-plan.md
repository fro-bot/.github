---
title: "feat: Cross-repo dispatch push-model completion tracking"
type: feat
status: complete
date: 2026-07-04
origin: docs/brainstorms/2026-07-04-cross-repo-dispatch-tracking-push-model-requirements.md
---

# feat: Cross-repo dispatch push-model completion tracking

## Overview

The cross-repo goal dispatch loop works end to end up to the moment a worker run is triggered, then
cannot track those runs to completion. It correlated a dispatched item to its worker run by passing a
`correlation_id` as a `workflow_dispatch` input and matching it in the run name — but target repos
are autonomous, their `fro-bot.yaml` files only universally declare a `prompt` input, so GitHub
rejects the dispatch with `422 Unexpected inputs provided: ["correlation_id"]`.

This replaces pull-based run correlation with a push model. Dispatch sends only the universal
`prompt`, carrying the item's correlation id, a per-item nonce, and the receipt contract inside it.
The worker posts a mandatory, bot-authored completion receipt (`success | noop | failed`) to the
coordination issue. `track` becomes a watchdog whose only writes are to the coordination issue: it
reads receipts, resolves terminal state, enforces a 24h SLA, and closes the goal when every item is
terminal. No target repo's workflow changes.

## Problem Frame

The tracking half assumed one dispatch contract shared by all targets, extensible with a correlation
input the run name echoes. That assumption is false: targets are independently managed repos whose
only common `workflow_dispatch` input is `prompt`, and the control plane neither owns nor
synchronizes their workflows. GitHub also exposes no reliable dispatch-to-run-id primitive
(`createWorkflowDispatch` returns `204 No Content`; the runs API never exposes dispatch inputs), so
run correlation cannot be made robust without target-side changes. The worker already knows its own
outcome and already holds a cross-repo-capable credential (`FRO_BOT_PAT`) that can write the
coordination issue. Invert the flow: the worker reports, the control plane listens.
See origin: docs/brainstorms/2026-07-04-cross-repo-dispatch-tracking-push-model-requirements.md.

## Requirements Trace

- R1. Dispatch passes only the `prompt` input — no `correlation_id` or other input (origin R1).
- R2. The prompt embeds the correlation id, the raw per-item nonce, a STRUCTURED coordination-issue
  reference (owner, repo, number, canonical URL as distinct fields), a literal example receipt
  (including a no-op example), the mandatory-receipt rule, and a self-validate step that echoes the
  resolved receipt destination before posting (origin R2, hardened by research). The raw nonce is
  delivered ONLY via the prompt and must NOT appear in the public marker NOR in any target-run public
  surface (logs, run summaries, or a prompt artifact) before the worker's receipt — see R13.
- R3. Every dispatched worker posts a completion receipt, even on no-op (origin R3).
- R4. The receipt is a bot comment carrying a delimited region
  `<!-- fro-bot:cross-repo-result:start --> … <!-- fro-bot:cross-repo-result:end -->` wrapping a
  `<!-- fro-bot:cross-repo-result {json} -->` marker; parse prefers the region, tolerates prose,
  strict on fields (origin R4, region convention added from wall-#3 evidence).
- R5. Worker status vocabulary is exactly `success | noop | failed`; `blocked` stays the pre-dispatch
  gate outcome (origin R5).
- R6. Track accepts a receipt only when all three hold: author ∈ `FROBOT_COMMENT_AUTHORS`, the
  receipt's `correlation_id` matches a dispatched item, AND `hash(receipt.nonce)` equals the item's
  stored `nonceHash`. The public marker stores ONLY `nonceHash`; the raw nonce lives only in that
  item's prompt. The nonce MUST be CSPRNG-generated with ≥128 bits of entropy (256 preferred);
  `nonceHash` is a FULL SHA-256 hex digest (NOT the 64-bit-truncated `hashState`, and NOT a
  `Date.now()+Math.random()` token). A plain SHA-256 is sufficient because the nonce is itself a
  high-entropy secret (no HMAC/salt needed). Preimage resistance then means reading the public marker
  reveals nothing forgeable, so a worker for item B cannot forge item A's receipt (origin R6; nonce
  third gate from the security audit, hash-bound after plan review found a bare public nonce is not a
  secret; entropy/hash spec set by Oracle verification).
- R6c. The raw nonce becomes PUBLIC the instant the worker posts its receipt (it is in the receipt
  body). This is safe ONLY because resolution is earliest-authentic-receipt-wins and terminal items
  are never reconsidered: track resolves each item from the EARLIEST authentic receipt by comment
  chronology — including when multiple receipts are first observed in the same track pass — and MUST
  NOT use the marker path's `findLast`/latest-wins semantics. A later receipt (including one an
  attacker posts after reading the now-public nonce) can never flip a resolved item.
- R7. Terminal state: gate failure → `blocked`; authentic `success`/`noop` → `completed`; authentic
  `failed` → `failed`; receipt is the sole terminal completion signal (origin R7).
- R8. Track does not poll PR state; a receipt's `pr` URL is operator-facing metadata only (origin R8).
- R9. No authentic receipt past the 24h SLA → `needs-attention` (non-terminal), surfaced with a
  reason (`no-receipt` or `unparseable-receipt`); SLA clock is wall-age from the per-item `epoch`,
  which is set at CONFIRMED-dispatch time only (never at intent), so an item that crashed between
  intent and confirm never ages into a spurious `needs-attention` — pre-confirm failures are tracked
  as dispatch failures, not SLA misses (origin R9, R6b).
- R10. `needs-attention` is reversible by a later authentic receipt; an item goes terminal the first
  time an authentic well-formed receipt resolves it, and never flips thereafter (origin R6a, R9a).
- R11. A goal closes only when every item is terminal (`completed`/`failed`/`blocked`) (origin R10).
- R12. Snapshot writes stay idempotent; telemetry stays counts-only — no repo identifiers, receipt
  prose, PR URLs, or nonce material (raw nonce or hash) in workflow summaries or logs (origin R11).
- R13. The raw nonce must not be exposed on any PUBLIC target-run surface before the worker's receipt.
  `.github/workflows/fro-bot.yaml` sets `OPENCODE_PROMPT_ARTIFACT: 'true'` and passes the prompt into
  the agent; Unit 3 must verify the dispatched prompt (carrying the raw nonce) is not published to a
  world-readable artifact/log for a cross-repo-goal run, and disable/redact it if it is. If this
  cannot be guaranteed, the plan states plainly that item isolation collapses to the shared-trust
  boundary (any worker could read another item's nonce from the artifact).

## Scope Boundaries

- No PR-merge tracking, no cross-repo PR polling, no bot-authored-PR search in the completion path.
- No auto-re-dispatch; `track` performs no dispatch — its only writes are coordination-issue
  marker/summary/flag/close.
- No target-repo workflow change; the receipt contract rides the `prompt` only.
- No worker `blocked` status.
- Run-name/run-id correlation is not a correctness dependency in v1.

### Deferred to Separate Tasks

- Confused-deputy hardening (HARD follow-up, not optional) — replacing `FRO_BOT_PAT` authorship with a
  per-dispatch, coordination-issue-scoped receipt token so a compromised org-wide PAT can no longer
  author receipts. Filed as a tracked fro-bot/.github issue + smart note BEFORE this ships. v1 accepts
  the residual risk explicitly (shared-trust-boundary: all workers are `fro-bot` agents).
- Worker-side receipt channel (drift mitigation) — a bundled skill or runtime receipt template in the
  fro-bot/agent repo so the receipt is generated from structured data rather than prompt prose. This
  is the real fix if live drift stays high after v1; tracked as a follow-up (its own brainstorm/plan,
  cross-repo).
- Optional per-target `correlation_id` + run-name echo as richer run telemetry for repos that opt in.

## Context & Research

### Relevant Code and Patterns

- `scripts/cross-repo-dispatch.ts` — the whole feature. Reuse verbatim:
  - `extractMarker` / `selectStateMarker` family (single-marker extraction with author filter +
    `findLast` semantics) — the receipt parser mirrors this as a `cross-repo-result` variant.
  - `FROBOT_COMMENT_AUTHORS` (`['fro-bot','fro-bot[bot]']`) — the R6 author gate.
  - `parseDecomposition` / `collectChecklistItems` / `extractItemsRegion` — the region-preference +
    loose-then-strict + "malformed vs absent" discipline the receipt parser reuses (region → body
    scan → strict-on-marker-presence).
  - CAS-write marker path + idempotent snapshot — track's state writes.
  - The per-item marker already carries a per-item `epoch` and a `nonce` field (both present in the
    `DispatchItem` schema). The SLA clock reuses `epoch`; the field currently stores a RAW nonce
    minted from `Date.now()+Math.random()` — rename it to `nonceHash` and store a full SHA-256 hex
    digest instead (do NOT reuse `hashState`, which truncates to 64 bits). Legacy in-flight markers
    that store a raw `nonce` are incompatible with hash verification and must be reseeded (see
    Operational Notes: #3633).
  - `extractItemsRegion` is file-private; Unit 1's receipt parser lives in the same file and reuses
    it directly (no export needed).
  - `runDispatch` / `runTrack` and their injectable collaborator seams; `runDispatchCli` /
    `runTrackCli` production wiring; the golden-path integration test pattern.
- `.github/workflows/cross-repo-dispatch.yaml` — dispatch prompt construction (drop `correlation_id`
  from `createWorkflowDispatch` inputs), track job. Track token's `pull-requests: read` scope becomes
  removable.
- `.github/workflows/fro-bot.yaml` — the `GOAL_DECOMPOSITION_PROMPT` block; the receipt instruction
  + literal example + self-validate step live in the cross-repo-goal prompt guidance here, mirroring
  the decomposition prompt's literal-example convention (its `:start`/`:end` region example).

### Institutional Learnings

- Wall-#3 forensics (PR #3635, commit `faa6e25`): the one existing LLM-emits-a-marker precedent (the
  decomposition checklist) drifted from the prompt on day one — the agent emitted items in prose
  without the delimited region, the strict parser rejected the whole comment, and approving a goal
  dispatched nothing. Live issue #3633 shows the agent still omits the region even after the prompt
  was updated. Lesson applied: the receipt inherits the delimited-region + tolerant-parse discipline
  by design, the prompt carries a literal example, and the worker self-validates — do not rediscover
  the drift.
- `docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md`:
  "round-trip every marker contract; test the round-trip, not just the producer." The receipt marker
  builder and parser must be round-trip tested.
- Security audit findings (this session): the `fro-bot` author identity is broadly shared and every
  item's correlation id is public on the issue, so author-check-alone permits cross-item receipt
  forgery by a buggy/injected worker. Plan review then found that a bare nonce stored in the PUBLIC
  marker is not a secret either (any worker reads it before the target posts). The gate is therefore
  hash-bound: the public marker stores `hash(nonce)`; the raw nonce is delivered only via the prompt;
  track verifies `hash(receipt.nonce)`. Preimage resistance closes the forgery within v1's trust
  boundary.

### External References

- None required — GitHub dispatch/runs API behavior (`204`, no dispatch inputs on runs) is already
  established in the origin doc and confirmed by the live `422`.

## Key Technical Decisions

- **Push over pull.** The worker owns ground truth; `track` listens. Polling the Actions API inferred
  intent from plumbing that does not expose it.
- **Hash-bound per-item nonce as a third trust gate.** Author check is necessary but not sufficient —
  all workers share the `fro-bot` identity and correlation ids are public. The gate is an unguessable
  per-item nonce whose HASH is stored in the public state marker while the raw nonce is delivered
  ONLY in that item's prompt (a dispatch input, never public). Track accepts a receipt only if
  `hash(receipt.nonce)` matches the item's stored `nonceHash`. Because the marker is public the
  instant it is written, storing the raw nonce there would make it forgeable by any other worker —
  hashing is what makes the third gate real. Neither the raw nonce nor the hash is emitted in
  telemetry/logs (R12).
- **Receipt reuses the delimited-region + tolerant-parse pattern.** Symmetry with decomposition, and
  the wall-#3 evidence says a bare marker will drift. Region preferred, body-scan fallback, strict on
  marker presence; a bot-authored comment with a malformed marker is `unparseable-receipt`, distinct
  from absent (mirrors the dispatch path's `seedRejected` vs "no checklist").
- **Receipt-only completion; run-lookup demoted to diagnostic, not deleted.** The receipt is the SOLE
  completion oracle — run-lookup and bot-authored-PR search no longer resolve terminal state. But
  rather than delete them, demote run-lookup to a NON-AUTHORITATIVE diagnostic: when an item has no
  authentic receipt, "the worker's run exists and concluded" is real forensic signal that makes
  `needs-attention` actionable ("ran but didn't report" vs "never ran") and preserves a crash-recovery
  path. This directly answers the drift risk (some workers will fail to post a well-formed receipt)
  and the recovery concern in one move. Bot-authored-PR search, which is not needed for either
  completion or diagnosis, is removed. The track token keeps `actions: read` for the diagnostic run
  lookup and drops `pull-requests: read`.
- **Earliest-authentic-receipt-wins, needs-attention reversible — no conflict.** An item goes terminal
  from the EARLIEST authentic receipt by comment chronology (including when several are first seen in
  one track pass) and never flips — this is what makes the post-receipt public nonce replay-safe
  (R6c): a later attacker receipt cannot flip a resolved item. This must NOT reuse the marker path's
  `findLast`/latest-wins. `needs-attention` only ever applies to an item with no terminal receipt
  yet, so a late receipt resolving it is consistent. An operator manual-override path (edit the state
  marker) covers a wrongly-locked `failed`.
- **Prompt-only instruction channel.** The receipt contract rides the one universal `prompt` input;
  autonomous target repos need no change.
- **Drift is expected, not assumed away.** The one LLM-emits-a-marker precedent drifted on day one and
  still drifts on live #3633. The plan treats prompt-only formatting as best-effort: delimited region
  + literal example + self-validate reduce drift; the diagnostic run-lookup makes the residual drift
  actionable rather than silent; and a drifted-but-present marker surfaces as `unparseable-receipt`,
  never as success. Prompt formatting is an optimization, not a correctness guarantee.
- **Structured, resolvable receipt destination.** The worker receives the coordination issue as
  distinct owner/repo/number + canonical URL fields (not prose), and self-checks the resolved
  destination before posting, so a worker in a target repo posts to the right issue deterministically.
- **Early-receipt tolerance.** A fast worker may post its receipt before the two-phase
  intent→confirm dispatch has durably persisted the item as confirmed. Track correlates receipts
  against the item set tolerantly: an authentic receipt whose item is not yet confirmed is retained
  and re-evaluated on the next pass rather than dropped, so no real completion is lost to the race.

## Open Questions

### Resolved During Planning

- SLA duration → 24h default; wall-age from the per-item `epoch`, which is set at confirmed-dispatch
  only (tunable constant).
- Run-lookup / bot-authored-PR machinery → run-lookup DEMOTED to non-authoritative diagnostic (not
  deleted); bot-authored-PR search removed. Receipts are the sole completion oracle.
- Nonce approach → hash-bound: `hash(nonce)` in the public marker, raw nonce only in the prompt,
  `hash(receipt.nonce)` verified by track (third gate).
- `first-wins` × `needs-attention` interaction → first-terminal-wins; `needs-attention` is the
  pre-terminal state, reversible by a later authentic receipt.
- Early-receipt race → track retains an authentic receipt for a not-yet-confirmed item and
  re-evaluates next pass (no drop).

**Glossary (state/reason terms):** `blocked` = pre-dispatch registry-gate refusal (never dispatched).
`completed`/`failed` = terminal, from an authentic receipt. `needs-attention` = non-terminal, no
authentic terminal receipt yet; reason `no-receipt` (none present past SLA) or `unparseable-receipt`
(a bot-authored receipt marker present but malformed). "authentic" = passes all three R6 gates.

### Deferred to Implementation

- Exact nonce encoding (e.g. 32 CSPRNG bytes as base64url or hex) within the R6 spec: CSPRNG,
  ≥128-bit (256 preferred), full SHA-256 hex digest.
- Exact prompt phrasing/placement of the correlation id, nonce, and literal example receipt.
- Whether `needs-attention` is surfaced as an issue comment, a label, or both, and the exact operator
  manual-override note.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation
> specification. The implementing agent should treat it as context, not code to reproduce.*

Dispatch (per item, at CONFIRMED-dispatch time):

    nonce      = CSPRNG randomBytes(≥16B)         # raw, in-memory only; high-entropy secret
    item = { id, target, correlationId, nonceHash: sha256hex(nonce), epoch: confirmedAt, status }
    marker(state) written via CAS  ── carries FULL-sha256 nonceHash (NOT raw nonce, NOT hashState)
    prompt = build(correlationId, rawNonce, {owner,repo,number,url}, literalExampleReceipt, rules)
    createWorkflowDispatch(target, workflow=fro-bot.yaml, inputs={ prompt })   # prompt only
    # epoch is set only on confirm; an item that crashes intent→confirm is a dispatch failure, not SLA

Worker (in target repo, general fro-bot/agent run):

    do the item's work
    post comment on the coordination issue {owner,repo,number} resolved from the prompt:
        <!-- fro-bot:cross-repo-result:start -->
        <!-- fro-bot:cross-repo-result {"correlation_id","nonce"(raw),"status","summary","pr"} -->
        <!-- fro-bot:cross-repo-result:end -->
    echo the resolved destination, then re-read the posted comment;
    if the marker is absent, edit to add it before declaring done

Track (watchdog, scheduled + manual):

    for each comment on the coordination issue:
        receipt = parseReceipt(region-preferred, tolerant)      # reuse extractMarker discipline
        accept iff author ∈ FROBOT_COMMENT_AUTHORS
                 and receipt.correlation_id ∈ dispatched items
                 and hash(receipt.nonce) == item.nonceHash       # third gate (hash-bound)
    receipt for a not-yet-confirmed item → retain, re-evaluate next pass (early-receipt tolerance)
    resolve item:
        authentic success|noop → completed   (first terminal wins, never flips)
        authentic failed        → failed
        bot marker present but malformed → unparseable-receipt (non-terminal)
        no authentic receipt and age(now, item.epoch) > SLA(24h) → needs-attention (non-terminal)
            diagnostic: run-lookup answers "ran but didn't report" vs "never ran" (non-authoritative)
    close goal iff every item terminal (completed|failed|blocked)
    writes: coordination-issue marker/summary/flag/close only.  No dispatch. No PR polling.

## Implementation Units

- [x] **Unit 1: Receipt marker schema, builder, and tolerant parser (pure core)**

**Goal:** Add the completion-receipt contract to the pure core: a typed receipt, a marker builder
that emits the delimited region, and a region-preferring tolerant parser that is strict on fields.

**Requirements:** R4, R5, R6 (parse+field validation portion), R10, R12 (nonce never in telemetry).

**Dependencies:** None.

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`
- Test: `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- Define a `CrossRepoResult` receipt type: `correlationId`, `nonce` (raw, as posted by the worker),
  `status ∈ {success,noop,failed}`, `summary`, optional `pr`.
- Add `buildResultMarker(receipt)` emitting the `:start`/`:end` region wrapping the JSON marker,
  mirroring the decomposition region constants.
- Add `parseResult(body)` reusing the file-private `extractItemsRegion` region-preference (Unit 1 lives
  in the same file, so no export is needed) and the loose-then-strict discipline: prefer the region,
  tolerate surrounding prose, strict on the JSON fields; classify a region/marker-present-but-invalid
  body as a distinct `malformed` outcome (feeds `unparseable-receipt`), distinct from "no receipt
  marker present".
- Status strictly one of the three; anything else → malformed. The parser returns the raw nonce; the
  hash comparison happens in Unit 4 (the parser never sees the stored `nonceHash`).

**Patterns to follow:** `extractMarker`/`extractItemsRegion`/`collectChecklistItems`,
`parseDecomposition`'s `{ok, reason}` result shape, the decomposition region constants.

**Test scenarios:**
- Happy path: a receipt comment (region + marker + surrounding prose) parses to the typed receipt for
  each of `success`, `noop`, `failed`, with round-trip against `buildResultMarker` (build→parse
  identity).
- Edge case: region present, marker inside a code fence or with adjacent prose → still parses.
- Edge case: bare marker without the region → parses via body-scan fallback (backward tolerant).
- Error path: marker with malformed JSON, missing `nonce`, missing `correlation_id`, or `status`
  outside the enum → `malformed` (not a valid receipt, not "absent").
- Error path: comment with no receipt marker at all → "absent" outcome, distinct from `malformed`.
- Edge case: nonce/summary containing characters that could break JSON quoting → round-trips safely.

**Verification:** Build→parse round-trips for all three statuses; malformed and absent are distinct
outcomes; no parser path returns a partial receipt.

- [x] **Unit 2: Mint per-item nonce and build the receipt-carrying prompt (dispatch core)**

**Goal:** At confirmed-dispatch, mint an unguessable per-item nonce, store only its HASH in the state
marker, and construct the prompt carrying the RAW nonce, correlation id, a structured
coordination-issue reference, a literal example receipt, the mandatory-receipt rule, and the
self-validate step.

**Requirements:** R2, R6 (nonce mint side), R9 (epoch-at-confirm), R12.

**Dependencies:** Unit 1 (receipt shape for the literal example).

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts`
- Test: `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- Rename the existing item `nonce` field to `nonceHash`. Mint a RAW nonce in-memory with a CSPRNG
  (`node:crypto` `randomBytes`, ≥128-bit — 256 preferred — as base64url/hex); store its FULL SHA-256
  hex digest in the CAS marker — never the raw nonce, and never via `hashState` (64-bit) or
  `Date.now()+Math.random()`. Two-phase precision: mint the raw nonce, persist only the hash with the
  intent write, and set `epoch` only on confirmed dispatch.
- Add a prompt builder composing: item prompt text + a machine-contract block containing the
  correlation id, the RAW nonce, the coordination issue as distinct `owner`/`repo`/`number` + a
  canonical URL, a literal example receipt (including a no-op example), the "receipt mandatory even on
  no-op" rule, and a self-validate instruction ("echo the resolved destination; re-read your posted
  comment; if the marker is absent, edit to add it").
- Ensure neither the raw nonce nor `nonceHash` is emitted on any counts/telemetry surface.

**Patterns to follow:** existing correlation-id/`epoch` minting and the `nonce` field already in
`DispatchItem` (renamed to `nonceHash`); `node:crypto` for CSPRNG + SHA-256; the decomposition
prompt's literal-example convention in `fro-bot.yaml`.

**Test scenarios:**
- Happy path: dispatching an item stores a full-SHA-256 `nonceHash` in the marker and the built prompt
  contains the correlation id, the RAW nonce, the structured issue reference (owner/repo/number/url),
  and a literal receipt example.
- Security: the raw nonce does NOT appear anywhere in the written marker (only its full-length hash);
  the stored hash is not the 64-bit `hashState` truncation.
- Edge case: two items in one goal get distinct nonces and distinct hashes.
- Integration: `hash(rawNonce in prompt)` equals the `nonceHash` stored in the marker (mint↔prompt
  consistency — the property Unit 4 verifies).
- Edge case: `epoch` is set at confirm; an item left at intent has no SLA-eligible epoch.
- Error path/telemetry: counts output for a dispatch run contains neither raw nonce nor hash.

**Verification:** Each dispatched item stores only a unique `nonceHash`; the raw nonce appears only in
the prompt; `epoch` is confirm-time; telemetry carries no nonce material.

- [x] **Unit 3: Prompt-only dispatch — remove the `correlation_id` input (dispatch shell + workflow)**

**Goal:** Stop passing `correlation_id` as a `workflow_dispatch` input so dispatch stops 422ing;
carry correlation via the prompt only.

**Requirements:** R1, R13.

**Dependencies:** Unit 2 (prompt now carries correlation id + nonce).

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts` (the `createWorkflowDispatch` inputs)
- Modify: `.github/workflows/cross-repo-dispatch.yaml` (if any input plumbing references it)
- Modify: `.github/workflows/fro-bot.yaml` (cross-repo-goal prompt guidance: add the receipt
  contract, literal example, self-validate step; verify the raw-nonce prompt is not published to a
  world-readable artifact/log — `OPENCODE_PROMPT_ARTIFACT` handling per R13)
- Test: `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- `createWorkflowDispatch` inputs become `{ prompt }` only.
- Add the receipt instruction + literal example + self-validate guidance to the cross-repo-goal
  prompt block in `fro-bot.yaml`, mirroring the decomposition prompt's shape. No target-repo change.
- R13 check: confirm the dispatched prompt (carrying the raw nonce) is not written to a world-readable
  artifact/log for these runs; disable/redact the prompt artifact for the cross-repo-goal path, or
  state plainly in the README that item isolation falls back to the shared-trust boundary.

**Patterns to follow:** the existing dispatch call; the decomposition prompt guidance block.

**Test scenarios:**
- Happy path: a dispatched item calls `createWorkflowDispatch` with exactly `{ prompt }` — assert no
  `correlation_id` (or any non-`prompt`) key is present.
- Integration: the golden-path CLI test (Unit 6) dispatches with prompt-only inputs against a target
  declaring only `prompt`.

**Verification:** Dispatch inputs are prompt-only; no dispatch passes `correlation_id`; the R13
prompt-artifact exposure is resolved (redacted) or explicitly documented as a residual.

- [x] **Unit 4: Receipt-driven terminal-state resolution + 24h SLA (track core)**

**Goal:** Resolve each item's terminal state from authentic receipts, apply the three-gate trust
check, enforce the 24h SLA → `needs-attention`, and make `needs-attention` reversible.

**Requirements:** R6, R7, R9, R10, R11.

**Dependencies:** Unit 1 (parser), Unit 2 (nonce in marker).

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts` (the `runTrack` resolver / `deriveTerminalState`)
- Test: `scripts/cross-repo-dispatch.test.ts`

**Approach:**
- Trust gate: accept a parsed receipt only if author ∈ `FROBOT_COMMENT_AUTHORS`, `correlation_id`
  maps to a dispatched item, AND `hash(receipt.nonce)` equals that item's stored `nonceHash`.
- Early-receipt tolerance: an authentic receipt whose item is not yet confirmed-dispatched is RETAINED
  and re-evaluated on the next pass, never dropped (handles the intent→confirm race).
- Resolve: authentic `success`/`noop` → `completed`; authentic `failed` → `failed`; the EARLIEST
  authentic receipt by comment chronology wins (never `findLast`/latest), and a resolved item never
  flips — this is the replay-safety property for the post-receipt public nonce (R6c).
- Bot marker present but malformed for a dispatched item → `needs-attention` reason
  `unparseable-receipt` (non-terminal).
- No authentic receipt and `now − item.epoch > SLA(24h)` → `needs-attention` reason `no-receipt`;
  epoch is confirm-time so a pre-confirm crash never triggers this.
- `needs-attention` reversible: a later authentic well-formed receipt resolves it per R7.
- Goal closes only when every item terminal; keep `blocked` (pre-dispatch gate) semantics intact.
- Add the SLA as a named tunable constant.

**Patterns to follow:** existing `deriveTerminalState`/terminal-precedence resolution; the
`epoch`-based timing already in the marker; reuse the same hash primitive chosen in Unit 2.

**Test scenarios:**
- Happy path: authentic `success`, `noop`, `failed` receipts (raw nonce hashing to the stored
  `nonceHash`) → `completed`, `completed`, `failed`.
- Security (R6): a receipt whose raw nonce does NOT hash to the item's `nonceHash` → rejected, item
  unresolved (cross-item forgery blocked even though the marker's hash is public).
- Security (R6): a receipt carrying item A's correlation id but item B's nonce → rejected (hash
  mismatch); cannot resolve A.
- Error path: non-Fro Bot-authored comment with a valid-looking marker → ignored.
- Error path: bot-authored malformed marker for a dispatched item pre-SLA → `unparseable-receipt`,
  non-terminal, goal stays open.
- Edge case (early-receipt): an authentic receipt for an item not yet confirmed → retained, resolves
  on the next pass once the item is confirmed (not dropped).
- Edge case (SLA): item with no receipt and confirm-age > 24h → `needs-attention`/`no-receipt`;
  age < 24h → still pending; an item never confirmed → not SLA-aged.
- Edge case (R10): item marked `needs-attention`, then a later authentic `success` arrives → resolves
  to `completed`; flag-clear reflected.
- Edge case (earliest-wins / replay): authentic `failed` then later authentic `success` → stays
  `failed`; a second authentic receipt reusing the now-public raw nonce, posted after the first,
  never flips the resolved item.
- Edge case (R11): all terminal → goal closeable; one `needs-attention` → stays open.

**Verification:** All three trust gates enforced with hash comparison; early receipts retained; SLA
keys off confirm-time epoch; reversibility behaves per R9/R10; a receipt whose nonce mishashes never
moves state.

- [x] **Unit 5: Demote run-lookup to diagnostic; remove PR-search; prune track token scope**

**Goal:** Make receipts the sole completion oracle while keeping run-lookup as a NON-AUTHORITATIVE
diagnostic that makes `needs-attention` actionable and preserves crash recovery. Remove the
bot-authored-PR search (needed for neither completion nor diagnosis) and drop the track token's
`pull-requests: read` scope.

**Requirements:** R8 (no PR polling for completion), supports R9 (actionable needs-attention), R12.

**Dependencies:** Unit 4 (the resolver must already resolve terminal state from receipts, so
run-lookup is no longer authoritative). Sequencing is load-bearing: run-lookup collaborators are still
hard-called by `runTrack` today, so this unit MUST follow Unit 4's rewire — do not pull the seams out
of a live resolver.

**Files:**
- Modify: `scripts/cross-repo-dispatch.ts` (keep `findRunByCorrelationId` as a diagnostic collaborator
  used ONLY to annotate a `no-receipt` `needs-attention` item with "ran but didn't report" vs "never
  ran"; remove `findBotAuthoredPrs` and its seam)
- Modify: `.github/workflows/cross-repo-dispatch.yaml` (drop `pull-requests: read` from the track
  token mints; keep `actions: read` for the diagnostic run-lookup; remove PR-search wiring)
- Test: `scripts/cross-repo-dispatch.test.ts` (adjust: run-lookup is diagnostic-only; delete PR-search
  tests)

**Approach:**
- Terminal state is resolved entirely by Unit 4 from receipts; run-lookup output NEVER changes an
  item's terminal state — it only annotates the diagnostic reason on an already-`needs-attention`
  item.
- Remove `findBotAuthoredPrs` and its collaborator seam; ensure no caller references it.
- Track token keeps `actions: read` (diagnostic run-lookup), drops `pull-requests: read`; control-plane
  token keeps `issues: write`.
- Confirm `Test Scripts Load` and the `import.meta.url` guard remain intact.

**Patterns to follow:** existing token-scoping in the two-App mint steps; existing collaborator-seam
structure.

**Test scenarios:**
- Happy path: track resolves a full goal from receipts only; run-lookup is not consulted for any item
  that has an authentic receipt.
- Diagnostic: a `no-receipt` `needs-attention` item where run-lookup finds a concluded run → annotated
  "ran but didn't report"; where it finds no run → "never ran". The terminal/non-terminal state is
  unchanged by this annotation.
- Error path: PR-search collaborator is gone (no reference remains).
- Verification: repo-wide type-check + test run green after removal (no dangling references).

**Verification:** Receipts are the sole completion oracle; run-lookup only annotates `needs-attention`
diagnostics and never moves state; PR-search removed; track token drops `pull-requests: read`, keeps
`actions: read`; suite green.

- [x] **Unit 6: Golden-path integration test (worker receipt → close) + README**

**Goal:** Lock the end-to-end contract with a golden-path CLI integration test driving the real
production composition, and document the push-model architecture.

**Requirements:** R1–R12 (integration), documentation.

**Dependencies:** Units 1–5.

**Files:**
- Modify: `scripts/cross-repo-dispatch.test.ts`
- Modify: the cross-repo-dispatch README/architecture doc (the file the prior units document to)
- Test: same test file

**Approach:**
- Golden-path test driving `runDispatchCli` → (simulated worker posts a realistic receipt comment:
  region + marker + prose + a run-summary block, authored `fro-bot`, correct nonce) → `runTrackCli`,
  asserting: dispatch is prompt-only, the receipt is accepted through all three gates, the item
  resolves `completed`/`failed`/`noop` as posted, and the goal closes when all items terminal.
- Include a hostile case in the same flow: a second bot-authored comment whose raw nonce does NOT hash
  to the item's `nonceHash` (cross-item forgery attempt reading the public marker) does not move state.
- Include an early-receipt case: a receipt arriving before the item is confirmed is retained and
  resolves on the next track pass.
- This test must fail if any unit regresses the contract (the standing anti-recurrence test).
- Update the README: push model, receipt contract + region format, three-gate trust, SLA,
  needs-attention, and the deferred token-scoping note.

**Execution note:** Start from the realistic-receipt golden-path test (contract-first), mirroring the
decomposition golden-path test that caught wall #3.

**Patterns to follow:** the existing decomposition golden-path integration test; the realistic-comment
fixture approach.

**Test scenarios:**
- Integration happy path: prompt-only dispatch → authentic receipt (raw nonce hashes to stored
  `nonceHash`) → item completed → goal closes; a no-op receipt closes its item too.
- Integration security: a receipt whose nonce mishashes (forgery from the public marker) never
  resolves the item; goal stays open until the real receipt.
- Integration SLA + diagnostic: an item with no receipt past 24h surfaces `needs-attention`; the
  diagnostic run-lookup annotates "ran but didn't report" vs "never ran"; goal stays open.
- Integration early-receipt: a receipt for a not-yet-confirmed item is retained, then resolves once
  confirmed.

**Verification:** The golden-path test exercises dispatch→worker-receipt→track→close end to end and
fails on any contract regression; README reflects the shipped design.

## System-Wide Impact

- **Interaction graph:** `issues.labeled` dispatch job and the scheduled/manual track job in
  `cross-repo-dispatch.yaml`; the cross-repo-goal prompt block in `fro-bot.yaml`; the pure core +
  CLI shells in `scripts/cross-repo-dispatch.ts`. No target-repo workflow is touched.
- **Error propagation:** a worker that never reports, or reports a malformed marker, surfaces as
  non-terminal `needs-attention` — never silently completed; the goal stays open for the operator.
- **State lifecycle risks:** first-terminal-wins prevents state flips; CAS marker writes stay
  idempotent; only `hash(nonce)` lives in the (public) marker and the raw nonce only in the prompt,
  neither in telemetry (R12); `epoch` at confirm-time avoids spurious SLA aging; early receipts are
  retained, not dropped.
- **Trust boundary (new completion oracle):** receipts on public issue comments are now the sole
  completion signal. A forged or malformed comment directly drives state, so acceptance is gated on
  author + correlation-id + nonce-HASH match, and the raw-nonce secret is never in public state. This
  is explicitly a shared-trust-boundary model — a compromised `FRO_BOT_PAT` or worker can still forge
  receipts for items it holds the nonce for; item-level isolation comes from the hash gate, not from
  the PAT.
- **API surface parity:** none — the dispatch/track contract is internal; the only external contract
  is the universal `prompt` input, which is unchanged for targets.
- **Integration coverage:** the Unit 6 golden-path test is the cross-layer proof (dispatch shell →
  worker receipt → track shell → close) that unit tests with injected fakes cannot fully establish.
- **Unchanged invariants:** the registry gate, owner-aware two-App token minting, actor+label
  approval gate, `blocked` (pre-dispatch) semantics, and the seed/marker CAS discipline are
  unchanged; this plan only replaces how completion is detected.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Worker drifts from the receipt format (wall-#3 class) — the highest-likelihood failure, evidenced on live #3633 | Prompt-only formatting is best-effort, not a correctness guarantee: delimited region + literal example + self-validate REDUCE drift; a drifted marker is `unparseable-receipt` (visible, never silent success); and the diagnostic run-lookup makes the residual `needs-attention` actionable ("ran but didn't report") so drift is triaged, not silent. A worker-side receipt channel is the tracked next step if drift stays high. |
| Cross-item receipt forgery reading the public marker | Hash-bound nonce (R6): the public marker stores only `hash(nonce)`; the raw nonce is prompt-only; track verifies `hash(receipt.nonce)`. Preimage resistance means reading the marker yields nothing forgeable. |
| Confused-deputy: ANY holder of `FRO_BOT_PAT` (every org workflow/agent that uses it, or a leaked PAT) can author receipts | NOT closed in v1. This is shared-trust-boundary security, not item-level authorization: the hash gate stops one worker forging ANOTHER item's receipt, but a compromised PAT can forge receipts for items whose nonce it holds. Accepted for v1 only because all workers are trusted `fro-bot` agents. Hard follow-up (tracked issue + smart note): mint a per-dispatch, coordination-issue-scoped receipt token instead of reusing the org-wide PAT. |
| Worker cannot resolve/write the coordination issue | Prompt carries structured `owner`/`repo`/`number` + canonical URL and a self-check echoing the resolved destination; `FRO_BOT_PAT` verified to carry cross-repo issue-write (gateway-rollout-tracker precedent); Unit 6 asserts the authored identity passes `FROBOT_COMMENT_AUTHORS`. |
| Premature `failed` locks an item | First-terminal-wins is deliberate anti-spoof; operator manual-override via marker edit documented. |
| Unit 5 sequencing pulls run-lookup out of a live resolver | Unit 5 explicitly depends on Unit 4's receipt-first rewire; run-lookup is DEMOTED (diagnostic-only), not deleted, preserving crash recovery; full green suite gate + golden-path test prove receipt-only closure. |
| Dispatch/receipt race (fast worker reports before confirm persists) | `epoch` and `nonceHash` are written at confirm; track RETAINS an authentic receipt for a not-yet-confirmed item and re-evaluates next pass, so no real completion is lost. |
| Raw nonce leaks via a public target-run surface (prompt artifact/logs) before the receipt — would re-open forgery despite the hashed marker | R13: Unit 3 verifies the raw-nonce prompt is not published to a world-readable artifact/log for cross-repo-goal runs (`OPENCODE_PROMPT_ARTIFACT`), redacts it, or documents the residual honestly. Hash-binding only protects the marker surface, not every prompt surface. |
| Receipt replay flips a resolved item using the now-public raw nonce | R6c earliest-authentic-wins: resolution keys off the earliest receipt by chronology (never `findLast`); a resolved item never flips, so a later replayed receipt is inert. |
| Nonce too weak to resist preimage/brute force | R6 spec: CSPRNG ≥128-bit (256 preferred), full SHA-256 hex; explicitly not `hashState` (64-bit) nor `Date.now()+Math.random()`. |

## Documentation / Operational Notes

- README/architecture doc updated (Unit 6): push model, receipt + region format, three-gate trust,
  24h SLA, `needs-attention` semantics, operator override, deferred token-scoping.
- File the confused-deputy token-scoping hardening as a tracked fro-bot/.github issue with a smart
  note before shipping.
- Rehearsal issue #3633 (checklist intact, stale marker cleared, labels present) is the live canary
  to re-exercise once this lands — it will exercise the receipt path for the first time in production.
- Legacy-marker migration: any in-flight marker that stored a RAW `nonce` (the prior schema) is
  incompatible with `nonceHash` verification and would strand its items. Reseed/clear such markers on
  rollout; #3633's marker is already cleared, so it cold-starts clean under the new schema.

## Sources & References

- **Origin document:** docs/brainstorms/2026-07-04-cross-repo-dispatch-tracking-push-model-requirements.md
- Related code: `scripts/cross-repo-dispatch.ts`, `.github/workflows/cross-repo-dispatch.yaml`,
  `.github/workflows/fro-bot.yaml`
- Related prior plan: docs/plans/2026-07-04-001-feat-cross-repo-dispatch-loop-plan.md
- Wall-#3 evidence: PR #3635 (commit `faa6e25`), live issue #3633
- Learnings: docs/solutions/best-practices/status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md
- Live evidence: dispatch `422 Unexpected inputs provided: ["correlation_id"]`; target `fro-bot.yaml`
  files declare only `prompt` universally; `FRO_BOT_PAT` cross-repo write capability.
