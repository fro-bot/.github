---
title: Mutation coverage is silent about the branch you didn't write — scope a trust-boundary parser by grammar, not by test count
category: security-issues
problem_type: security_issue
component: tooling
module: packages/wiki-write-core/src/private-leak.ts
severity: high
date: 2026-09-05
last_updated: 2026-09-05
verified: 2026-09-05
applies_when:
  - writing a branch condition on a line-oriented format using a line prefix test (`startsWith`) rather than a position in the grammar
  - a parser on a trust boundary reaches a clean mutation run and the score is about to be cited as evidence of correctness
  - a mutation-testing directive survives on parser state and its equivalence argument depends on where the line sits in the input
related_components:
  - testing_framework
tags:
  - mutation-testing
  - stryker
  - parser-correctness
  - unified-diff
  - trust-boundary
  - false-negative
  - privacy
root_cause: missing_validation
resolution_type: code_fix
symptoms:
  - A Tier 0 privacy-boundary parser reached 117 killed / 0 survived / 0 no-coverage / 2 directives (119 mutants) while still carrying a reachable false negative
  - "`line.startsWith('+++')` routed any `++`-prefixed added content line to the header branch, unscanned, on #3837's clean run"
  - The first fix (adjacency: a `+++` line is a header iff the previous line was `--- `) still leaked on the single most common diff shape — a modified line
  - No mutator flagged either defect; both were found only by manual review, after the mutation gate reported clean
---

# Mutation coverage is silent about the branch you didn't write — scope a trust-boundary parser by grammar, not by test count

## Problem

`packages/wiki-write-core/src/private-leak.ts` scans a unified diff for private-repository name
disclosure. PR #3837 drove it to 117 killed / 0 survived / 0 no-coverage / 2 directives out of 119
mutants — zero survivors, with the two `BooleanLiteral` directives each argued as an equivalence — while `line.startsWith('+++')` still routed **any** line starting with
three `+` characters to the file-header branch, `continue`-ing past the content scan. An added line
whose own text happens to start with `++` (e.g. `+++ see acme/secret-repo for the rollout plan`)
escaped detection entirely. Filed as #3838.

The first fix scoped the header branch to adjacency: a `+++` line is a header only if the
immediately preceding line was `--- `. That closed #3838's exact reproduction but still leaked on
the single most common diff shape of all — a modified line. Its removed half renders as
`-- see acme/public-repo...` → `--- see acme/public-repo...`, and its added replacement can just as
easily render as `++ see acme/secret-repo...` → `+++ see acme/secret-repo...`, arming the same false
pairing. Caught in review on #3839. Adjacency alone was insufficient; the missing conjunct was
positional. The shipped check is `!inHunk && line.startsWith('+++') && expectingPlusHeader !== undefined`:
`---`/`+++` are headers only in a file's header block, before that file section's first `@@` hunk
marker, *and* only as an adjacent pair. Dropping the adjacency half reopens the consecutive-`+++` case.

## Why Mutation Coverage Didn't Catch It

Mutation testing proves your tests discriminate the code you wrote. It is structurally silent about
the branch you didn't write. Stryker's mutators flip operators, literals, and conditions that already
exist in the source — no mutator inserts "add a hunk-position check" or "add an adjacency guard."
The closest a mutator gets to a missing-grammar-check defect is flipping a condition that's already
there, which only ever probes the wrong grammar more thoroughly. A perfect kill score on a parser
whose grammar model is incomplete is a perfect kill score on the wrong grammar — the tests agree
with the code, and the code agrees with a spec that isn't the real one.

The two residual directives were the visible symptom of the invisible defect. Both sat on
`checkPathAsNew`'s state, both were argued as equivalences under the code as written, and both
dissolved when the grammar was corrected — the state they excused only existed because the parser
was tracking the wrong thing. A surviving directive on parser state is a prompt to re-derive the
grammar, not to sharpen the equivalence argument.

## The Rule

For a parser sitting on a trust boundary, **before** collecting mutation coverage:

1. **Write down the grammar the input actually has.** For a unified diff:
   `diff --git` → header block (`--- `, `+++`, `rename to`, `copy to`) → `@@` hunk marker →
   hunk lines prefixed ` `/`-`/`+`.
2. **Check every branch condition against a *position* in that grammar, not a *prefix* of the
   line.** `line.startsWith('+++')` is a prefix test with no positional awareness — it fires
   identically whether the line is at the header-block position or three hunk lines deep. Prefix
   tests on a line-oriented format are exactly where content masquerades as structure: any content
   that happens to reproduce a structural marker's leading bytes is misclassified, unconditionally,
   regardless of how well-tested the branch containing the prefix test is.
3. **Bound the residual risk by the threat model**, don't leave it unstated. Who controls the input
   *structure* versus the input *content*? Here, `scripts/check-private-leak.ts` builds the diff via
   `execFileSync git diff` — an adversary controls file content (what appears after `+`/`-`), not the
   diff frame (`diff --git`/`---`/`+++`/`@@` placement). The remaining theoretical gap — a header-block
   `--- `/`+++` pair whose *path itself* leaks a private name — requires forging the diff frame, which
   is strictly weaker than an adversary who can simply omit the file from tracked content. Say this
   explicitly rather than leaving the boundary implicit.

## Ordering

**Scope-narrow by grammar first, then collect coverage.** Coverage collected before the grammar is
right gets re-done, not preserved. #3837's 35 tests all passed and its two `BooleanLiteral`
directives looked justified under the code as written — but both directives were symptoms of the
same defect the #3838/#3839 fixes removed; they didn't survive the grammar correction and had to be
deleted, not re-verified. Fixing the grammar first would have made those two directives — and the
review round that caught them — unnecessary.

## Verification Shape That Would Have Caught It

For each structural token the parser recognizes, write one test where that exact token's text
appears as **content** — inside the position where content is legal, prefixed the way real added
content is prefixed — carrying a value the guard must catch. That's the inverse control: prove the
structural branch does NOT fire when the token appears in a content position, by using a payload
that only a broken parser would miss. #3839 landed this for `---`/`+++` (a private name inside a
`+++`-shaped line, positioned after a `@@` hunk marker, must still be caught). The same test does not
yet exist for `diff --git`, `rename to`/`copy to`, or `@@` itself — add them in Unit 5A-2, where
`check-private-leak.ts` consumes this parser. Note the asymmetry: the `rename to`/`copy to` branch
is not gated by `inHunk`. No live exploit exists (hunk body lines always carry a ` `/`-`/`+`
prefix, so a bare `rename to <name>` cannot appear as content), but the 5A-2 test should assert on
that asymmetry explicitly rather than mirror the `+++` test shape.

## Related

- `docs/solutions/best-practices/enumerate-mutator-variants-before-a-stryker-directive-2026-09-05.md`
  — the companion learning from the same module: once a directive-worthy mutant survives review, this
  is how to scope the directive correctly. This doc is upstream of that one — get the grammar right
  first, and fewer directives get shipped to argue over.
- `docs/solutions/best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md` — the
  related boundary-testing principle: test where the trust boundary actually is, not where it's
  convenient to assert.
- PR #3837 — the "clean" mutation run that still carried the defect
- Issue #3838 — `++`-prefixed added lines escape the content scan (prefix-test defect)
- PR #3839 — the fix; its first round used adjacency and still leaked on a modified line, the
  second used hunk position
- `docs/plans/2026-09-04-001-feat-counterexample-proven-guards-plan.md`, Unit 5A-1 Result block
