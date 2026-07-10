---
title: A one-bit confirmation gesture can't encode which of several candidate edges was approved
date: 2026-07-10
category: best-practices
module: improvement-metrics
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - a human confirmation is the only record of which (event, target) edge was approved
  - one source event can plausibly map to several candidate targets in the same window
  - the confirmed edge must stay reproducible across later re-derivations of the same event
  - confirmation state must survive periodic rewrites of the artifact it lives in
tags:
  - confirmation-gesture
  - edge-identity
  - fingerprint-hash
  - many-to-one
  - checklist-state
  - improvement-metrics
---

# A one-bit confirmation gesture can't encode which of several candidate edges was approved

## Context

The improvement-metrics loop asks a human to confirm that a proposal recurred against a codified class. The first design (approved in brainstorm) used a bare `recurrence-confirmed` label on the proposal issue. Plan-review killed it before a line was written: the candidate scorer can emit several `(event → class)` edges for one proposal when multiple classes clear the threshold, and a bare label is one bit of evidence for an N-way choice. A later run can re-rank and re-derive a *different* best-match class for the same label — so "confirmed" silently drifts from "confirmed against class X" to "confirmed against whatever class ranks first this run." The confirmed edge is not reproducible.

## Guidance

**When a confirmation feeds a metric or state machine and the thing being confirmed is one of several candidate relationships, the confirmation artifact must carry the specific edge identity — not just a boolean.**

Encode the edge, then confirm the encoded edge:

- Derive a stable edge key from immutable inputs: `buildEdgeFingerprint(classKey, eventId)` = `sha256(classKey + '\u0001' + eventId)` (`scripts/improvement-metrics-core.ts`). It survives body rewrites, line reordering, and class-name spelling; a line index or username would not.
- Render each candidate as its own checklist line carrying a hidden marker: `- [ ] <!-- improvement-metrics:edge=<fp> -->` (`buildEdgeChecklistLine`). Ticking *that* line confirms *that* edge.
- Recover confirmations by fingerprint, not position: `recoverPriorTickState(body)` returns the set of ticked fingerprints; a `[x]` without the hidden marker is uncounted by construction.
- Preserve tick-state across rewrites: on upsert, `ticked: edge.ticked || priorTickState.has(edge.fingerprint)` — the operator's confirmation is never clobbered by a regeneration, and an edge that drops out of the new run simply disappears (close-on-clear), it does not resurrect.

## Why This Matters

The loop's whole promise is that its counts are recomputable from public artifacts with no durable store. That contract only holds if the confirmation *is* the durable record of the specific edge. A bare label makes the confirmed count non-reproducible the moment the candidate ranking can change — which, with a scoring heuristic over a growing corpus, it always can.

## When to Apply

- A human/machine confirmation is the input to a metric or state machine, and the target is one of several candidate relationships.
- The matching is computed (scored/ranked) and not injective — different runs may rank differently.
- The confirmation lives in a rewritable artifact (issue body, comment, file) that is regenerated periodically.
- The confirmed count must be reconstructable from the artifact alone, with no side channel or human memory.

## Examples

**Before:** a `recurrence-confirmed` label on the proposal issue. Next run re-derives a different best-match class for that proposal; the confirmed `(event → class)` edge is undefined and the count shifts with no real-world event.

**After:** the report issue lists each candidate edge as its own line —

```
- [x] <!-- improvement-metrics:edge=a3f1…64hex -->
  - class: `auth-token-refresh␁oauth␁race` — https://github.com/…/issues/402
```

Re-rendering preserves the tick via `recoverPriorTickState`; confirmed recidivism is the count of ticked fingerprints that reappear in this run's edges. The confirmed edge is exactly reproducible.

## Related

- `docs/solutions/best-practices/closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md` — the hidden-marker / fingerprint / live-state toolkit this reuses, applied to machine recognition rather than a human gesture
- `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md` — marker → visible → sentinel recovery precedence
- `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md` — the related hash-bound approval pattern (CAS nonce) from a sibling loop
- Source PR: #3672 (improvement-metrics loop)
