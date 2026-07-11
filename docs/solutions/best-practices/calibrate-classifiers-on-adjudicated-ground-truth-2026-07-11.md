---
title: Calibrate automated classifiers on operator-adjudicated ground truth
date: 2026-07-11
category: best-practices
module: improvement-metrics
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "an automated scorer/classifier surfaces candidates for human review and its precision is unknown"
  - "a human has just adjudicated a full batch of the classifier's output"
  - "a heuristic matches an artifact against the very evidence it was created from"
related_components:
  - development_workflow
tags:
  - ground-truth
  - regression-fixture
  - classifier-precision
  - founding-evidence
  - scorer-tuning
---

# Calibrate automated classifiers on operator-adjudicated ground truth

## Context

The improvement-metrics loop surfaces candidate recurrence edges (proposal issue × codified solution class) for the operator to confirm. Its first live report surfaced 14 candidates; the first operator walkthrough adjudicated them: exactly one genuine recurrence, thirteen noise. Precision 1/14 — and, more valuably, thirteen *labeled false positives* with reasons.

Two defect classes fell out of the labels. Four edges were **founding evidence**: the events were the proposals the class docs had been authored *from*, so the scorer was counting a doc's own birth as its failure. Nine were **generic-token noise**: one or two shared title tokens ("status", "drift") cleared both the score threshold and the strong-match bar, linking plan-drift proposals to an unrelated wiki-ingest doc.

## Guidance

When a human adjudicates a full batch of classifier output, that adjudication is the most valuable tuning input the system will ever get — spend it deliberately:

1. **Freeze the adjudication as a permanent regression fixture** built from the *real* data (the actual issue titles/labels/dates, the actual doc frontmatter and git add-dates — public and immutable, so hardcoding them is safe). The fixture asserts exactly the true positives surface and every labeled false positive is suppressed. Future scorer changes now have ground truth to answer to.
2. **Fix the defect classes with principled rules, not fixture overfitting.** Each rule must have a rationale independent of the fixture:
   - *Founding evidence is not recurrence*: an event may only score against a class codified **strictly before** it (compare against the doc's git add timestamp). An artifact can never "recur" via the evidence it was created from.
   - *Generic overlap is not a match*: require a high-signal hit (tag match, ≥3 shared title tokens, or a title token corroborated by an independent module-token hit) — one or two generic shared tokens never qualify.
3. **Verify the true positives survive the tightening.** Before shipping, trace each true edge's exact match anatomy under the new rules (which tokens/fields carry it). A precision fix that silently kills the real signal is worse than the noise was.
4. **Check what the tightening does to neighboring tests.** Here a pre-existing mutation-proof privacy test had been passing for the wrong reason — its fixture's match anatomy depended on the same field the mutation corrupted, so the edge died before the gate was ever exercised. The new strength rule exposed it; the fixture was fixed to form its match independently.

## Why This Matters

Classifier noise compounds: every false candidate costs operator attention, and an unmaintained review queue quietly becomes a dead metric (the reflexive failure mode this loop was explicitly designed against). One adjudication pass converted 13 unlabeled annoyances into a permanent precision contract — the difference between "the scorer feels noisy" and "the scorer is provably 1-for-1 against ground truth." The founding-evidence rule in particular generalizes to any system that mines its own history: proposals→docs, incidents→runbooks, reviews→lint rules all risk scoring an artifact against its own origin.

## When to Apply

- After the first (or any full) human adjudication of an automated candidate queue.
- When designing any scorer that links later events to earlier artifacts derived from events — add the temporal founding-evidence rule from the start.
- When tightening any matcher: trace the surviving true positives' match anatomy before shipping.

## Examples

The regression fixture shape (real, immutable inputs):

```ts
// Ground truth from the 2026-07-11 walkthrough: 5 real events × 3 real
// class docs, adjudicated 1 true / 13 false. Real titles, labels,
// created-at dates, frontmatter, and git add-dates — hardcoded.
it('surfaces exactly the adjudicated true edge', () => {
  const {edges} = computeMetrics({solutionDocs: REAL_DOCS, proposalEvents: REAL_EVENTS, ...})
  expect(edges).toHaveLength(1)
  expect(edges[0].classKey).toBe(SELF_AUDIT_CLASS_KEY)
  expect(edges[0].eventId).toBe(ISSUE_3656_ID)
})
```

The founding-evidence rule:

```ts
// A doc's own origin proposals never count as its recurrence.
const classAddMs = new Date(classDoc.gitAddDate).getTime()
if (new Date(event.createdAt).getTime() <= classAddMs) continue
```

## Related

- [Closed-vocabulary identifiers for automated inspection](closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md) — designing the machine-readable surface the classifier consumes.
- [Status Truth synthetic self-audit claim kinds](status-truth-synthetic-self-audit-claim-kinds-2026-07-03.md) — the detect→propose→confirm loop this scorer feeds.
- [Edge-keyed confirmation markers](edge-keyed-confirmation-markers-2026-07-10.md) — the confirmation gesture that produced the adjudication.
