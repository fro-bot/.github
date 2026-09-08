---
title: A policy scanner must parse tokens, not prose — and the tool may normalise away what you are checking for
date: 2026-09-08
last_updated: 2026-09-08
verified: 2026-09-08
category: best-practices
module: scripts/check-mutation-guards.ts
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - writing a check that enforces policy over directives, annotations, or pragmas in source
  - deriving a verdict from a tool's report rather than from its exit code
  - a check searches free-form text that also contains author-written prose
  - a report is keyed by file and the set of files is itself configurable
tags:
  - fail-closed
  - policy-enforcement
  - structured-output
  - stryker
  - closed-vocabulary
---

# A policy scanner must parse tokens, not prose — and the tool may normalise away what you are checking for

## Context

The mutation guard enforces a policy on `Stryker disable` directives: each must be `next-line`-scoped, name a single mutator, and carry a non-empty reason. Two layers were written to enforce it — a check over the JSON report, and a textual scan of the source.

Only one of them can enforce the reason rule, and it is not the obvious one. The report-level check is wired correctly — `check-mutation-guards.ts` preserves a missing `statusReason` as `undefined` and `isEmptyReason` treats that as a violation — but it can only fire if a reasonless directive reaches the report as an absent or blank reason. Whether it ever does is upstream behaviour, and this repo has evidence pointing the other way: a code comment recording a live Stryker run notes that framework-ignored mutants arrive with a **non-empty** `statusReason` supplied by the tool.

**What is verified, precisely:** the check is implemented and would fire on an absent or blank reason. Whether a directive written without a reason can produce that state has not been traced into upstream source here. If it cannot, the textual scanner is the sole enforcement of the reason rule and the report-level check is decorative — which is the state worth knowing about, and exactly what nothing in CI would tell you.

## Guidance

### Verify where enforcement actually lives before trusting a check

A check that cannot fail is worse than a missing check, because it reads as coverage. When two layers enforce the same policy, establish which one is load-bearing by making each fail on purpose. A layer that stays green against input it should reject is not redundancy.

### Match against parsed tokens, never substrings of free-form text

A directive line contains both structure and an author-written reason. `remainder.includes('next-line')` matches a directive that is correctly scoped and also matches a reason that happens to contain the phrase — so the scope check passes on text that has nothing to do with scope.

Parse the directive into its parts and match against those. While you are there, the same grammar carries three cases a substring approach misses entirely:

- block-comment forms alongside line comments
- multiple directives on one line
- directives whose reason spans a line break

### Cross-check report keys against the configured scope

A report can only describe files that were instrumented. If a module is in `mutate` but absent from the report, a per-file loop over report keys iterates zero times for it and reports clean. Intersect the report's keys with the configured `mutate` list and fail closed on any module that produced no entry — silence about a module is not evidence about it.

### Derive verdicts from structured output, fail closed on malformed entries

An exit code compresses everything the tool knows into one bit, and tools are inconsistent about which failures set it. Read the structured report and classify from it. Treat a malformed or unparseable entry as a failure rather than skipping it, so a shape change upstream cannot quietly reduce what the gate checks.

### Prove each rule discriminates

Delete the rule and confirm a test goes red. A policy rule that no test pins is a rule the next refactor can remove without resistance.

## Why This Matters

Every failure here is silent and in the reassuring direction. A vacuous check reports pass. An uninstrumented module reports clean. A substring match reports correctly-scoped. The gate keeps returning the answer everyone wants while enforcing progressively less, and nothing in CI distinguishes that from genuine compliance.

## When to Apply

- Writing any check that reads a tool's report to enforce a policy
- Enforcing rules over comment-embedded directives in any language
- A gate whose scope is configurable, where "no findings" and "not examined" are different states with the same output

## Examples

Scope matched against structure rather than text:

```ts
// Passes on a reason that merely mentions the phrase.
if (remainder.includes('next-line')) { /* treated as correctly scoped */ }

// Scope is a parsed token; the reason is a separate field.
const {scope, mutators, reason} = parseDirective(line)
if (scope !== 'next-line') { report(scope, mutators, reason) }
```

Silence distinguished from cleanliness:

```ts
// A module in `mutate` with no report entry must fail, not pass by omission.
const missing = configuredMutateTargets.filter(target => !(target in report.files))
if (missing.length > 0) { failClosed(missing) }
```

## Related

- [`enumerate-mutator-variants-before-a-stryker-directive`](enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md) — the policy this scanner enforces, from the directive author's side
- [`a-mutation-score-can-measure-nothing`](a-mutation-score-can-measure-nothing-2026-09-08.md) — the same silence one layer down, in the instrumentation
- [`status-vocabulary-must-cover-every-report-surface`](status-vocabulary-must-cover-every-report-surface-2026-08-31.md) — closed vocabularies across reporting surfaces
- Merge commit `796ddf2`
