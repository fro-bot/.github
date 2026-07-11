---
date: 2026-07-04
topic: cross-repo-dispatch-tracking-push-model
title: Cross-repo dispatch tracking — push-model completion receipts
---

# Cross-repo dispatch tracking — push-model completion receipts

## Summary

The cross-repo goal dispatch loop works end to end up to dispatch: it parses a goal decomposition,
seeds state, gates targets, mints owner-aware tokens across two GitHub Apps, and triggers a worker
run in each target repo. It cannot track those runs to completion. The current design correlated a
dispatched item to its worker run by passing a `correlation_id` as a `workflow_dispatch` input and
matching it in the run name — but target repos are autonomous, their `fro-bot.yaml` files are
heterogeneous, and they only universally declare a `prompt` input, so GitHub rejects the dispatch
with `422 Unexpected inputs provided: ["correlation_id"]`. GitHub also exposes no reliable
dispatch-to-run-id primitive, so run correlation cannot be made robust without target-side changes
the control plane does not own.

This replaces pull-based run correlation with a push model. Dispatch sends only the universal
`prompt`, carrying the correlation id and receipt contract inside it. The worker reports its own
outcome as a mandatory, bot-authored completion receipt on the coordination issue. Tracking becomes
a watchdog whose only writes are to the coordination issue: it reads receipts, resolves state,
enforces an SLA, and closes the goal — it never dispatches and never polls target-repo PR state. No
target repo's workflow changes.

## Problem Frame

The tracking half assumed one dispatch contract shared by all targets, extensible with a
correlation input the run name echoes. That assumption is false: targets are independently managed
repos whose only common `workflow_dispatch` input is `prompt`, and the control plane neither owns
nor synchronizes their workflows. Polling GitHub's Actions API to infer an item's outcome is
inferring intent from plumbing exhaust — the API returns `204 No Content` on dispatch (no run id)
and never exposes dispatch inputs on a run. The worker already knows its own outcome and already
holds a cross-repo-capable credential (`FRO_BOT_PAT`) that can write the coordination issue. Invert
the flow: let the worker report, and let the control plane listen.

## Actors

- **Operator**: states goals, approves dispatch, resolves flagged items. Owns the goal issue.
- **Control loop (dispatch)**: seeds state, gates targets, mints tokens, triggers worker runs with a
  prompt-embedded correlation id and receipt contract.
- **Worker**: an ordinary `fro-bot/agent` run in a target repo; performs the item's work and posts a
  completion receipt back to the coordination issue.
- **Control loop (track)**: watchdog; reads bot-authored receipts, resolves terminal state, enforces
  the SLA, and closes the goal when every item is terminal. It never dispatches and never polls PR
  state; its only writes are coordination-issue marker/summary/flag/close.

## Key Flows

- F1. Dispatch carries the receipt contract
  - **Trigger:** an approved goal's item is dispatched.
  - **Actors:** Control loop (dispatch), Worker
  - **Steps:** dispatch calls the worker with only the `prompt` input; the prompt embeds the item's
    correlation id, a reference to the coordination issue, the exact receipt marker format, and the
    rule that a receipt is mandatory even when no change is made.
  - **Outcome:** the worker has everything it needs to report back; no target workflow input beyond
    `prompt` is used.
  - **Covered by:** R1, R2, R7
- F2. Worker reports completion
  - **Trigger:** the worker finishes its item (including deciding no change is needed).
  - **Actors:** Worker
  - **Steps:** the worker posts a comment on the coordination issue containing the hidden receipt
    marker with its correlation id, a status of `success`, `noop`, or `failed`, a short summary, and
    an optional PR URL. It writes via `FRO_BOT_PAT`, so the comment is Fro Bot-authored.
  - **Outcome:** the authoritative terminal signal exists on the shared issue.
  - **Covered by:** R3, R4, R5
- F3. Track resolves and closes
  - **Trigger:** scheduled track pass (and manual dispatch).
  - **Actors:** Control loop (track)
  - **Steps:** track reads the coordination issue's comments, accepts only receipts that are
    Fro Bot-authored and carry a correlation id matching a dispatched item, resolves each item's
    terminal state, and — when every item is terminal — posts a counts-only summary and closes the
    goal. Track performs no dispatch and no PR polling.
  - **Outcome:** goal state is driven by receipts; closure is deterministic.
  - **Covered by:** R6, R8, R9, R11
- F4. Missing receipt → needs-attention
  - **Trigger:** an item is dispatched but has no valid receipt past its SLA.
  - **Actors:** Control loop (track), Operator
  - **Steps:** track marks the item `needs-attention` (non-terminal), surfaces it on the goal issue
    for the operator, and keeps the goal open. It never auto-re-dispatches and never treats the
    absence as success.
  - **Outcome:** a lost or crashed worker is visible, not silently counted done; the operator decides
    how to resolve.
  - **Covered by:** R9, R10, R11

## Requirements

**Dispatch contract**

- R1. Dispatch passes only the `prompt` input to the target workflow — no `correlation_id` or any
  other input beyond `prompt`. This removes the current `422` and requires no change to any target
  repo's `fro-bot.yaml`.
- R2. The dispatch prompt embeds: the item's correlation id, a reference to the coordination issue
  (owner/repo/number), the exact receipt marker format, and the rule that a receipt is mandatory —
  including on a no-op. The correlation id is the same per-item id the control plane already mints
  into the seeded state marker; it is a join key that routes a receipt to its item, not a secret (it
  becomes public once the receipt is posted), so it is never the security factor — see R6.

**Completion receipt**

- R3. Every dispatched worker MUST post a completion receipt to the coordination issue, even when it
  makes no change. Emitting the receipt is part of the dispatch-eligible worker contract. A worker
  should post exactly one; if more than one authentic receipt appears for an item, R6a governs which
  wins, so correctness never depends on perfect single-post behavior.
- R4. The receipt is a comment containing a hidden marker
  `<!-- fro-bot:cross-repo-result {json} -->` whose JSON carries: `correlation_id`, `status` ∈
  `{success, noop, failed}`, a short `summary`, and an optional `pr` URL. Human-readable prose may
  surround the marker; only the marker is parsed. Parsing is tolerant of surrounding prose and
  strict on the marker's fields (the same region-tolerant, field-strict discipline used for the
  decomposition parser).
- R5. The worker's status vocabulary is exactly `success | noop | failed`. There is no worker
  `blocked` status: a worker that runs but cannot complete reports `failed` with an explanatory
  summary. `blocked` remains reserved system-wide for the pre-dispatch registry-gate outcome.

**Tracking and lifecycle**

- R6. Track accepts a receipt only when both hold: the comment author is a Fro Bot identity (the
  existing `FROBOT_COMMENT_AUTHORS` set) — this is the authorization gate, and a non-Fro Bot comment
  can never move state — AND the receipt's `correlation_id` matches a currently dispatched item on
  that goal — the join key that routes the receipt to its item, not a secret. A comment failing the
  author check is ignored entirely; a Fro Bot-authored comment whose id matches no dispatched item is
  ignored for state.
- R6a. When more than one authentic receipt exists for the same item, the FIRST authentic receipt
  (earliest comment) is authoritative and later duplicates are ignored; an item's state never flips
  once resolved from a receipt.
- R6b. A Fro Bot-authored comment that carries a `cross-repo-result` marker for a dispatched item but
  whose marker fails to parse (invalid JSON, missing `correlation_id`, or `status` outside
  `{success, noop, failed}`) is a receipt error, NOT an absent receipt: the worker reported but
  botched the format. Track surfaces it distinctly (reason `unparseable-receipt`) rather than
  collapsing it into silence — see R9.
- R7. Terminal state resolves as: gate failure → `blocked` (pre-dispatch, unchanged); authentic
  receipt `success` or `noop` → `completed`; authentic receipt `failed` → `failed`. The receipt is
  the sole terminal completion signal.
- R8. Track does not poll pull-request state. A receipt's `pr` URL is operator-facing metadata only;
  the goal loop does not follow it to merged/closed. Whether a referenced PR merges is the
  operator's normal review flow, outside the dispatch loop.
- R9. An item dispatched with no authentic receipt past its SLA resolves to `needs-attention`, which
  is NOT terminal: the goal issue stays open and track surfaces the item for the operator with a
  reason (`no-receipt`, or `unparseable-receipt` per R6b). The SLA is the wall-clock age of the item
  measured from its per-item dispatch `epoch` in the state marker against the track run's clock; the
  default is 24 hours — the exact value is tunable in planning, but the clock rule is fixed.
- R9a. `needs-attention` is REVERSIBLE: if an authentic, well-formed receipt later arrives for a
  `needs-attention` item, it resolves to `completed` or `failed` per R7 and the operator flag is
  cleared, so a late-report race never strands a goal open forever. A `needs-attention` item is
  never counted as completed on its own.
- R9b. Track performs no dispatch (no auto-re-dispatch); its only writes are to the coordination
  issue — the state marker, the counts summary, the operator flag, and the close event. It never
  writes to a target repo and never polls PR state.
- R10. A goal issue closes only when every item is terminal (`completed`, `failed`, or `blocked`).
  Any `needs-attention` or still-pending item keeps it open.
- R11. Snapshot writes remain idempotent (no-op when state is unchanged) and telemetry remains
  counts-only: no private repo identifiers, no receipt prose, no PR URLs in workflow summaries.

## Acceptance Examples

- AE1. **Covers R1.** Given an approved goal targeting a repo whose `fro-bot.yaml` declares only
  `prompt`, when dispatch runs, `createWorkflowDispatch` succeeds (no `422`) and the worker run
  starts.
- AE2. **Covers R2, R3, R4.** Given a dispatched worker that makes a change, when it finishes, it
  posts one receipt comment with a hidden marker whose status is `success`, its correlation id, a
  summary, and the PR URL.
- AE3. **Covers R3.** Given a dispatched worker that correctly decides no change is needed, when it
  finishes, it still posts one receipt with status `noop` — not silence.
- AE4. **Covers R6.** Given a third party posts a comment carrying a real-looking marker and a
  guessed id, when track reads it, the comment is rejected (author is not a Fro Bot identity) and
  does not affect state.
- AE5. **Covers R6.** Given a Fro Bot-authored comment whose correlation id matches no dispatched
  item, when track reads it, it is ignored for state.
- AE6. **Covers R7.** Given authentic receipts of `success`, `noop`, and `failed` for three items,
  when track resolves, they become `completed`, `completed`, and `failed` respectively.
- AE7. **Covers R8.** Given a receipt carrying a `pr` URL for an unmerged PR, when track resolves,
  the item is `completed` from the receipt and track never queries the PR's state.
- AE8. **Covers R9, R10.** Given an item dispatched with no receipt past its SLA, when track runs,
  the item is `needs-attention` with reason `no-receipt`, the goal stays open, and the operator is
  flagged; an item that never received a receipt is never counted as completed.
- AE9. **Covers R10.** Given all items terminal, when track runs, the goal issue closes with a
  counts-only summary; given one `needs-attention` item, the goal stays open.
- AE11. **Covers R6a.** Given two authentic receipts for the same item — an earlier `failed` and a
  later `success` — when track resolves, the item is `failed` from the first receipt and the second
  is ignored; the state does not flip.
- AE12. **Covers R6b.** Given a Fro Bot-authored comment whose `cross-repo-result` marker has
  malformed JSON (or a `status` outside the enum) for a dispatched item, when track runs before the
  SLA, the item is surfaced as `unparseable-receipt`, distinct from `no-receipt`, rather than being
  read as a valid outcome or as silence.
- AE13. **Covers R9a.** Given an item already marked `needs-attention`, when an authentic
  well-formed `success` receipt later arrives, the next track pass resolves it to `completed` and
  clears the operator flag; the goal can then close.
- AE10. **Covers R11.** Given any track run, when its summary renders, it contains only counts — no
  repo identifiers, receipt prose, or PR URLs.

## Success Criteria

- A real multi-repo goal dispatches without a `422` and every item resolves from a worker receipt —
  including a legitimate no-op — with the goal closing only after all items report.
- No target repo's `fro-bot.yaml` is modified to make tracking work.
- A worker that never reports is always visible as `needs-attention`, never silently completed.
- A forged or mismatched comment never moves an item's state.

## Scope Boundaries

- No PR-merge tracking, no cross-repo PR polling, no bot-authored-PR search in the completion path.
- No auto-re-dispatch or self-healing; track stays read-only apart from coordination-issue writes.
- No target-repo workflow change; the receipt contract rides the `prompt` only.
- No worker `blocked` status; `blocked` stays the pre-dispatch gate outcome.
- Run-name/run-id correlation is not a correctness dependency in v1.

### Deferred to Separate Tasks

- Formalizing the receipt contract into the agent persona or a bundled skill (v1 keeps it in the
  prompt).
- Optional per-target `correlation_id` + run-name echo as richer run telemetry for repos that opt in.
- Auto-re-dispatch of `needs-attention` items.

## Key Decisions

- **Push over pull.** The worker owns ground truth; the control plane listens. Polling the Actions
  API inferred intent from plumbing that doesn't expose it. This matches the agent-native discipline
  of explicit completion signals over heuristic detection.
- **Mandatory receipt makes tracking deterministic.** Requiring a receipt even on no-op removes the
  fatal ambiguity between "agent correctly did nothing" and "agent crashed." Absence past SLA is then
  a real signal, not a guess.
- **Receipt-only completion.** With a mandatory receipt that can name its own PR, independent PR
  tracking adds surface without changing correctness; drop it. The operator's PR review stays their
  normal flow.
- **Reuse the anti-spoof and parse patterns already shipped.** Bot-author + correlation-id trust is
  the existing marker-trust pattern; the hidden-marker + tolerant-region parse is the decomposition
  parser's hardening applied to the receipt — the same lesson, not new machinery.
- **needs-attention is non-terminal and track stays read-only.** A lost worker keeps the goal open
  and visible; the operator resolves it. This preserves the dispatch/track separation the two-phase
  design depends on.
- **Prompt-only instruction channel.** The whole point of prompt-only dispatch: the receipt contract
  travels in the one universal input, so autonomous target repos need no change.

## Dependencies / Assumptions

- `FRO_BOT_PAT` (the credential the target worker runs with) is the org-wide bot PAT and can write
  `fro-bot/.github` issues — verified; a worker comment via it is authored `fro-bot` and passes the
  author filter (the gateway rollout tracker already comments cross-repo this way). Planning should
  re-confirm the authored identity string a dispatched worker's comment actually carries.
- The correlation id the control plane mints per item lives in the seeded state marker, not the
  human-visible checklist. It is a per-item join key, not a security boundary — it becomes public the
  moment the worker posts a receipt — so authorization rests entirely on the Fro Bot author check
  (R6), and the id only routes an authentic receipt to its item.
- `fro-bot/agent` reliably follows a prompt instruction to post a structured comment; a worker that
  ignores the instruction surfaces as `needs-attention` (fail-safe, not silent success).

## Outstanding Questions

### Resolve Before Planning

- None. Product decisions are settled; the remaining items are implementation choices for planning.

### Deferred to Planning

- The exact SLA duration (R9 fixes the clock rule — wall-clock age from the per-item `epoch` — and
  defaults it to 24h; planning tunes the number).
- Whether to delete the now-dead run-lookup / bot-authored-PR machinery and the track token's
  `pull-requests: read` scope, or keep any of it as optional telemetry.
- How the correlation id is surfaced into the prompt text (format/placement) and how track extracts
  it back from the receipt marker.
- Whether `needs-attention` (and its `no-receipt` vs `unparseable-receipt` reason) is surfaced as an
  issue comment, a label, or both.

## Sources / Research

- Feature state and the five prior integration walls: project memory (cross-repo dispatch
  architecture) and `docs/plans/2026-07-04-001-feat-cross-repo-dispatch-loop-plan.md`.
- Origin requirements: `docs/brainstorms/2026-07-04-a3-cross-repo-dispatch-requirements.md`.
- Live evidence: dispatch run `422 Unexpected inputs provided: ["correlation_id"]`; target
  `fro-bot.yaml` files declare only `prompt` universally; `FRO_BOT_PAT` cross-repo write capability
  (gateway-rollout-tracker precedent).
- Correlation-design review: architecture advisor (push-model recommendation, no reliable
  dispatch-to-run-id primitive).
- Reused patterns: `scripts/cross-repo-dispatch.ts` (`FROBOT_COMMENT_AUTHORS` marker trust,
  `extractMarker` tolerant parse, idempotent snapshot).
