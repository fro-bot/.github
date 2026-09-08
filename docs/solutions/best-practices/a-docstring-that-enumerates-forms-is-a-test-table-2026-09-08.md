---
title: A docstring that enumerates accepted forms is a test table, not prose
date: 2026-09-08
last_updated: 2026-09-08
verified: 2026-09-08
category: best-practices
module: scripts/check-mutation-guards.ts
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - a matcher, classifier, or parser documents the syntactic forms it accepts
  - the documented enumeration was written from a specification rather than from the pattern
  - review catches a case the implementation misses and the fix lands without a regression test
tags:
  - fail-open
  - classifier
  - counterexample
  - regression-tests
  - grammar
---

# A docstring that enumerates accepted forms is a test table, not prose

## Context

When a matcher's documentation lists the forms it accepts, that list is a specification the code is claiming to satisfy. Nothing checks the claim. The enumeration and the pattern drift independently, and the drift is invisible because the doc reads as authoritative and the tests were usually written from the same mental model as the pattern.

Found in a barrel-detection matcher whose docstring enumerated re-export forms the regex did not all cover. The consequence is not a crash — the classifier silently returns the wrong answer for that form, and whatever it gates fails open.

## Guidance

### Drive every enumerated form through the actual matcher

Take the list from the docstring, feed each entry to the real implementation, and assert the result. Record it as a truth table so the correspondence is visible rather than assumed. A form in the docs with no row in the table is an untested claim.

Divergence fails in the direction the guard exists to prevent: a form the docs say is recognised, and the matcher does not, is accepted when it should be caught.

### Keep the counterexample as an executable artifact

When review catches a missed case, fixing the pattern is half the work. Add a test that reconstructs the failing input and asserts the pre-fix logic misses it — proving the test discriminates, not merely that the current code passes. Without that, the catch survives only as a comment in a closed review thread, and the next refactor can reintroduce the gap against a green suite.

The generalisation: prove each rule discriminates by deleting it and watching a test go red. A rule whose removal breaks nothing is not being enforced by the suite.

## Why This Matters

Documentation drift is normally a readability problem. In a classifier it is a correctness problem, because the enumeration is load-bearing: reviewers reason from it, and the next person to extend the matcher treats it as the contract. A docstring that overstates what the pattern matches is a latent fail-open with a comment vouching for it.

## When to Apply

- Writing or reviewing a regex, parser, or classifier whose documentation lists accepted inputs
- Any review round that produces a "it also needs to handle X" finding
- Two call sites needing the same extraction with different tolerance

## Examples

Enumeration as a table rather than prose:

<!-- verify: isPureReexportBarrel from scripts/mutation-guards-config.test.ts -->
```ts
// Every form the docstring claims, driven through the real matcher. The matcher takes
// a path and a source reader, so each row is a fixture file rather than a bare line.
it.each([
  ['export * from "./x"', true],
  ['export type * from "./x"', true],   // the form the pattern originally missed
  ['export {a} from "./x"', false],
])('classifies %s as barrel=%s', (source, expected) => {
  expect(isPureReexportBarrel('fixture.ts', () => source)).toBe(expected)
})
```

The live table is in `scripts/mutation-guards-config.test.ts`.

## Related

- [`a-mutation-score-can-measure-nothing`](a-mutation-score-can-measure-nothing-2026-09-08.md) — the other way a green signal can mean nothing was checked
- [`equivalence-refactors-need-differential-proofs-past-the-bound`](equivalence-refactors-need-differential-proofs-past-the-bound-2026-09-06.md) — bounded verification that reads as exhaustive
- [`mutation-coverage-is-silent-about-unwritten-branches`](../security-issues/mutation-coverage-is-silent-about-unwritten-branches-2026-09-05.md) — reading the grammar before trusting the coverage
- Merge commit `69a99af`
