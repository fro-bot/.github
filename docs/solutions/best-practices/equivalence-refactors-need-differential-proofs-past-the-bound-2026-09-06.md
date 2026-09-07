---
title: An equivalence refactor needs a differential proof past the bound — and pass structure is part of the equivalence
date: 2026-09-06
last_updated: 2026-09-06
verified: 2026-09-06
category: best-practices
module: packages/wiki-write-core
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - restructuring a scanner, parser, or multi-pass text transform and claiming the result is byte-identical to the original
  - a bounded exhaustive differential sweep (every string up to length N) reports zero divergences and is about to be cited as proof
  - a refactor changes how many passes run over the input, or converts a hand-rolled scanner into a regex
  - the only reason for the refactor is to remove Stryker mutant surface (timeouts, equivalent mutants)
tags:
  - mutation-testing
  - stryker
  - differential-testing
  - equivalence-refactors
  - property-testing
  - regex
  - counterexample
---

# An equivalence refactor needs a differential proof past the bound — and pass structure is part of the equivalence

## Context

Unit 5B of the counterexample-proven-guards plan drove `packages/wiki-write-core/src/corrections-survival.ts`
to a clean mutation run (PR #3845). Two "behavior-neutral" refactors made to remove mutant surface were
both non-equivalent, and one of them shipped a fail-open on the erosion gate. A clean kill score saw
neither. Both were caught by differential tests against a verbatim copy of the original — one of them
only after review pointed out the differential's bound was too short to reach the counterexample.

## Guidance

**1. A bounded exhaustive sweep is a corpus, not a proof.** `normalizeFormattingText` was split from one
`replaceAll` over a combined markdown/wiki-link alternation into two sequential passes. An exhaustive
differential to length 7 over an 8-symbol alphabet (2,396,744 inputs) reported zero divergences. The
shortest counterexample is length 10–11:

```text
[[[]()a|b]]                                    old: "a b"        new: "b"
See [[[Docs](https://x)Guide|the guide]] here.  old: "see docsguide the guide here"
                                               new: "see the guide here"
```

The markdown pass collapsed `[]()` to nothing, leaving `[[a|b]]`, and the wiki pass then matched a link
the first pass had synthesized. Pair every bounded sweep with seeded random sampling well past the bound
— 400k samples at length 9–20 found this in seconds — and state the bound in the test name so nobody
reads "exhaustive" as "complete".

**2. Pass structure is part of the equivalence.** Per-pass semantics were identical; the number of passes
was not. A single `replaceAll` never re-scans its own output; N sequential passes do. The same class
appeared in `maskMarkdownLinks`: a regex port of the char scanner diverged on malformed `[](]()` — the
scanner reuses a `[` after a failed `](` paren-scan, which no regex expresses. When the original's only
problem is deterministic-hang mutants on its loop counters, keep the original byte-for-byte and directive
the hangs; do not rewrite the algorithm to shrink mutant surface.

**3. The differential's oracle is a verbatim copy, kept in the test file.** Copy the pre-refactor
implementation into the test as `<name>Reference` and assert equality. Once the refactor is reverted or
proven, the reference stays — it pins that future edits don't drift.

```ts
function normalizeFormattingTextReference(value: string): string {
  /* verbatim copy of the implementation as of the merge base */
}

it('normalizeFormattingText matches the reference for every string up to length 6', () => {
  for (const s of enumerateStrings(['[', ']', '(', ')', '|', '!', 'a', ' '], 6))
    expect(normalizeFormattingText(s)).toBe(normalizeFormattingTextReference(s))
})

it('normalizeFormattingText matches the reference for 400k seeded random strings at length 9–20', () => {
  const rng = seeded(0x5b01)
  for (let i = 0; i < 400_000; i++) {
    const s = randomString(rng, alphabet, 9, 20)
    expect(normalizeFormattingText(s)).toBe(normalizeFormattingTextReference(s))
  }
})
```

Exhaustive-to-6 plus random sampling is cheaper than exhaustive-to-7 alone and strictly stronger; the
whole file runs in under 3 seconds, which matters because Stryker re-runs it per mutant.

## Why This Matters

The `normalizeFormattingText` divergence was fail-open on a blocking gate: a shorter formatting span is
easier to find in the body, so an eroded correction reported `correction-needs-reconfirmation` (advisory,
ingest proceeds) instead of `correction-eroded` (`ok: false`, ingest blocked). Nothing in the committed
corpus triggered it; the corpus is LLM-regenerated and the spans are operator-authored, so neither side
is a fixed input set.

Mutation coverage measures whether tests discriminate the code you wrote. It is structurally silent about
whether the code you wrote is the code you had — that is a different question, and a differential against
the original is the only test that answers it.

## When to Apply

- Any refactor of a text transform, scanner, or parser that is described as "equivalent" or "byte-identical".
- Any change from one pass to several, or from an imperative scanner to a regex.
- Any exhaustive differential whose alphabet size and length bound are chosen for runtime rather than for the
  input grammar — treat it as a corpus and add sampling past the bound.
- Any refactor whose motivation is a mutation-testing metric.

## Examples

Differential test, before and after:

| | Before (PR #3845 round 1) | After |
|---|---|---|
| Oracle | inline expected strings | verbatim reference copy in the test file |
| Coverage | exhaustive to length 7 | exhaustive to length 6 + 400k seeded random at length 9–20 |
| Found `[[[]()a|b]]`? | no | yes, in seconds |
| Wall time | 3.15 s | 1.55 s |

Refactor decision, before and after:

| | Before | After |
|---|---|---|
| `maskMarkdownLinks` | regex port, 4-item corpus | original scanner, 6 hang directives, differential proof |
| `normalizeFormattingText` | two-pass split | single-pass alternation restored |

## Related

- `docs/solutions/security-issues/mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md` —
  the same failure one level down: coverage is silent about the branch you didn't write; this doc is about
  the input you didn't enumerate.
- `docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md` —
  directive discipline, including the guard shape that cannot be cleanly directived (PR #3855).
- PR #3845 (`corrections-survival.ts`), PR #3855 (`corrections.ts`).
- `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`, Unit 5B-1 Result block.
