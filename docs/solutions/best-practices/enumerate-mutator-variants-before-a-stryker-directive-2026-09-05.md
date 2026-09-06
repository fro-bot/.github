---
title: A Stryker disable directive is mutator-scoped, not variant-scoped — enumerate every variant before shipping one
date: 2026-09-05
last_updated: 2026-09-05
verified: 2026-09-05
category: best-practices
module: packages/wiki-write-core/src/private-leak.ts
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - writing a `// Stryker disable next-line <Mutator>: <reason>` directive during mutation-testing cleanup
  - a directive's reason argues equivalence for only one output of a mutator (e.g. only `if (false)`, not `if (true)`)
  - a directive's reason depends on an assumption about input shape ("realistic input", "never contains X") rather than the code's own logic
tags:
  - mutation-testing
  - stryker
  - test-directives
  - equivalent-mutants
  - dead-code
  - invariant-verification
---

# A Stryker disable directive is mutator-scoped, not variant-scoped — enumerate every variant before shipping one

## Context

Unit 5A-1 of the counterexample-proven-guards plan drove `packages/wiki-write-core/src/private-leak.ts`
to a clean mutation run. The first pass shipped ten `// Stryker disable next-line <Mutator>: <reason>`
directives. Review caught three that were wrong, and a follow-up caught two more — five directives
total across two review passes, out of ten shipped. `evaluateDirectiveLine` in
`scripts/check-mutation-guards.ts` only validates that a directive is `next-line` scoped and carries a
non-empty reason; it cannot see whether the reason is *true*. That gap is structural, not a bug to fix
in the scanner — the discipline has to live in how directives get written.

## Guidance

**A `Stryker disable next-line <Mutator>` directive suppresses every variant that mutator generates on
that line, not just the one the reason argues.** Naming `ConditionalExpression` suppresses both
`if (true)` and `if (false)`; naming `EqualityOperator` suppresses `>=`, `<=`, and every other relational
swap it produces. Before shipping a directive:

1. **Enumerate every variant the named mutator generates for that expression.** A `ConditionalExpression`
   on an `if` has two variants (forced true, forced false); a `LogicalOperator` on `||` has one variant
   (`&&`); a `BooleanLiteral` on a literal has exactly one variant (`false` can only become `true` — there
   is no third boolean value, so a one-variant reason is trivially complete there and needs no further
   argument).
2. **Confirm the reason addresses every variant, not just the one that prompted the directive.** Two of
   the three blocking findings on this PR argued only one variant while silently suppressing another that
   was a live, killable bug: an `EqualityOperator` directive covering `<` but not the `>=` variant that
   made a clause permanently false; a `ConditionalExpression` directive covering `if (false)` but not
   `if (true)`, which disabled a guard entirely and would have returned a false-negative on a real leak.
3. **Prefer deletion over a directive when the equivalence proof shows the code itself is unnecessary** —
   a tautology, or a pure optimization over an already-correct fallthrough path. Two of the three findings
   here resolved this way: a redundant bounds-check clause (the underlying `lastIndexOf` call already
   guaranteed it) and an early-return block that was strictly equivalent to falling through to the main
   path. Dead code doesn't get a chaperone comment; it gets deleted.
4. **Never write "not observable under realistic input" as the reason.** That is a claim about the
   *input*, not the code — and it needs to be backed by an actual enforced constraint, or it isn't true.
   Either cite the exact upstream schema rule that rules the input out (file and field), or kill the
   mutant with a test using the excluded input. On this PR, `packages/wiki-write-core/src/schemas.ts`'s
   `assertRepoEntry`/`isRepoEntry` constrain `owner`/`name` to `typeof === 'string'` only — no
   non-empty or character-class constraint like `node_id`'s pattern check — so `''` and a private name
   starting with `+` were both legal inputs. Both became real tests instead of directives.

## Why This Matters

A directive that hides a real bug is worse than a survived mutant: a survived mutant is visible in the
report and fails the gate; a wrongly-scoped directive makes Stryker report `clean` while a genuine defect
sits under a Stryker-ignored line. In a Tier 0 privacy-boundary module, that is exactly the failure mode
the mutation gate exists to catch.

## When to Apply

- Writing any `Stryker disable next-line` directive during mutation-cleanup work (Units 5A/5B and any
  future survivor PR).
- Reviewing a directive someone else wrote — check the reason against every variant the named mutator(s)
  produce, not just the variant the PR's diff shows.

## Verification Shape

- For each directive removed in favor of a test: prove red→green — apply the mutant the directive used to
  suppress, confirm the new test fails with the exact divergence the mutant would cause, restore, confirm
  green.
- After the file's directives are finalized, run the full `pnpm check:mutation-guards` and confirm the
  module's own per-mutant counts (0 Survived / 0 NoCoverage / 0 Timeout, only genuinely-equivalent
  `Ignored` mutants remaining).

## Related

- PR #3837 (`fix(wiki-write-core): fix three mutator-scoped directive violations in private-leak.ts` and
  its preceding commits)
- `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`, Unit 5A-1 Result block
