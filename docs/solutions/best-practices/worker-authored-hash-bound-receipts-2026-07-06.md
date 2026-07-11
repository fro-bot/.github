---
title: When a platform gives no reliable correlation handle, invert poll to a worker-authored hash-bound receipt
date: 2026-07-06
category: best-practices
module: scripts/cross-repo-dispatch.ts
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - a coordinator dispatches work to an autonomous worker it cannot poll reliably for completion
  - the platform returns no correlation handle (e.g. GitHub dispatch returns 204 with no run id)
  - a completion signal must travel back over a public channel but must be authentic
  - modifying every worker/target to accept a correlation input is infeasible
tags:
  - cross-repo-dispatch
  - push-vs-poll
  - completion-tracking
  - hash-bound-nonce
  - trust-gate
  - replay-safety
---

# When a platform gives no reliable correlation handle, invert poll to a worker-authored hash-bound receipt

## Context

The cross-repo dispatch loop needed to track a dispatched worker run to completion. The first
design correlated a dispatched item to its worker run by passing a `correlation_id` as a
`workflow_dispatch` input and matching it in the run name. That failed in production two ways:
target repos are autonomous and only universally declare a `prompt` input, so a `correlation_id`
input returned `422 Unexpected inputs provided`; and GitHub's dispatch API returns `204 No Content`
with no run id and never exposes dispatch inputs on a run, so run-correlation cannot be made robust
without changing every target repo.

## Guidance

When the platform will not hand you a reliable correlation handle, **invert the flow**: stop polling
the coordinator's guess and have the worker — which already knows how the run went and already holds
a credential that can write back — author its own completion receipt to the coordination surface. The
worker becomes the source of truth instead of the coordinator inferring it from plumbing that does
not expose intent.

The load-bearing part is the trust model, and it generalizes to any cross-boundary completion signal
posted over a public channel. Gate acceptance on **three** checks:

1. **Author** — the receipt was posted by a trusted identity (an allowlisted bot author).
2. **Correlation mapping** — the receipt's id maps to a currently dispatched item.
3. **Hash-bound nonce** — `hash(receipt.nonce)` equals the item's stored `nonceHash`.

Only the **hash** of the nonce ever appears in the public marker; the raw nonce is delivered to the
worker through the prompt, not as its own dispatch input. Reading the public marker therefore yields
nothing forgeable — a worker for item B cannot forge item A's receipt from marker state alone. Resolution is
**earliest-authentic-receipt-wins**: the raw nonce becomes public the instant the real worker posts
its receipt, so a later replay of that now-public nonce must not be able to flip an already-resolved
item.

## Why This Matters

A public channel (a GitHub issue) is being used to carry a private authenticity claim. The naive
version — "trust any comment from the bot author" — fails because the bot identity is broadly shared
and correlation ids sit in plain sight, so any worker could forge another item's receipt. The
hash-binding is what makes the third gate real: storing the raw nonce publicly would be security
theater (any other worker reads it before its own receipt), while storing only the hash keeps the
secret out of public state. Preimage resistance does the rest.

Two failure modes must fail safe, not silent:

- A worker that never reports, or reports past an SLA, resolves to a **non-terminal**
  `needs-attention` — never a silent "completed." The goal stays open for a human.
- A receipt that is present but malformed is a distinct `unparseable-receipt`, not treated as
  absent — a botched receipt is visible, not swallowed.

## When to Apply

- A coordinator dispatches to workers it cannot reliably poll for a run outcome.
- The completion signal must cross a trust boundary over a public medium.
- You are tempted to add a correlation input to every worker — and cannot, because the workers are
  autonomous and heterogeneous.

## Examples

The anti-recurrence contract worth emulating is a **hostile-forgery test that drives the real
dispatch → track composition**, not a stub: a guessed/mismatched nonce never moves state, the genuine
receipt still resolves, and a forgery attempt cannot permanently poison the item. Removing the
nonce-hash gate or reverting resolution to latest-wins must fail that test.

Nonce spec that made the gate sound: minted from `randomBytes(32).toString('base64url')` (CSPRNG,
256-bit), stored as a full (untruncated) SHA-256 hex digest. A truncated hash or a
`Date.now()+Math.random()` token would undermine the whole gate.

## Update (2026-07-07): receipt accountability is metadata-declared, not prompt-declared

#3652, A3's first real cross-repo goal, proved the receipt contract above was only a prompt
payload: three targets posted accepted receipts, one completed local triage and refused the
receipt as prompt-injection-shaped, one completed with no visible receipt. A dispatched prompt
cannot make a target accountable — target repos can carry local response policies (e.g. "post
exactly one comment") that a prompt has no authority over.

The fix: whether a missing receipt is a broken contract is now an operator-declared capability in
`metadata/repos.yaml` (`cross_repo_receipts`), authoritative only because that file is a
`data`-branch, sole-writer contract — never a target self-report, never inferred from prompt
wording. The coordinator snapshots this onto each item at dispatch (`receiptContract`); it does not
reread metadata later, so drift after dispatch can't retroactively change what an in-flight item
expected. Targets without the capability are `legacy-best-effort`: still dispatchable, and accepted
nonce-verified receipts from them still resolve items, but a missing receipt is diagnostic only, not
a broken contract.

Local-only completion comments and Actions run results remain diagnostic evidence
(`dispatch-accepted-no-receipt` vs. `run-observed-no-receipt`) — useful for an operator deciding
whether to nudge a stuck item, but neither ever completes one. Only an accepted, nonce-verified
receipt resolves state. Prompt wording and target-workflow rewrites do not enforce compliance; they
cannot, because the coordinator has no authority over a target's local policy.

## Related

- Source PR (merge commit): `e406ff157a5dbfecdd298942ab83a165ad42ea2f`
- `docs/solutions/best-practices/repair-before-a-trust-gate-not-inside-it-2026-07-06.md` — the
  companion parse-tolerance invariant for the same receipts
- `docs/solutions/best-practices/per-owner-installation-tokens-2026-07-06.md` — the credential
  topology the dispatch half depends on
- `docs/plans/2026-07-07-001-fix-a3-receipt-contract-state-plan.md` — the metadata-declared
  receipt-accountability fix and the #3652 production finding
- Known residual: worker receipt authorship is a shared-trust boundary. GitHub does not provide an
  issue-scoped receipt token, and passing a separate token through the prompt would only move the
  secret. Further hardening requires target-side policy or a receipt broker, not coordinator-only
  code.
