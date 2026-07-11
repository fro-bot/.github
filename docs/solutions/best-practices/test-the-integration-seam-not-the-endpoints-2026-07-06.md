---
title: A code path exercised only by pre-built fixtures is an untested seam — test the seam, not the endpoints
date: 2026-07-06
last_updated: 2026-07-10
category: best-practices
module: scripts/cross-repo-dispatch.ts
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - a function has unit tests but its real callers feed it differently than the fixtures do
  - bugs keep recurring at the same integration boundary despite green unit suites
  - you are writing a parser for input that legitimately mixes free-text and structured content
  - the boundary is mediated by a file or shell pipeline between steps, not a function call
tags:
  - integration-test
  - golden-path
  - test-seam
  - two-phase-parser
  - anti-recurrence
  - fixtures
---

# A code path exercised only by pre-built fixtures is an untested seam — test the seam, not the endpoints

## Context

The planner → dispatch bridge in the cross-repo loop broke in production three times in a row, each
caught only by a live rehearsal after passing unit tests and review. The pattern was identical every
time: unit tests injected **pre-built markers** directly and never exercised the real
planner-comment → seeded-marker → dispatch composition. `parseDecomposition` existed and was
unit-tested, but the one seam that mattered was never walked — approving a fresh goal would have
dispatched into the void. Separately, a strict parser that failed on the first prose line was the
wrong shape for input that legitimately mixes prose and checklist items.

## Guidance

**Whenever a transformation's real callers are bypassed by fixtures, treat that seam as untested
regardless of unit coverage.** A function that is only ever exercised with hand-built inputs is a
bridge built and never walked. The fix is a **golden-path integration test** that drives the actual
production composition (here: dispatch → track) against a *captured real* input — a planner comment
with prose, checklist, and a run-summary block, no pre-seeded marker. It must fail against the old
code and pass against the new, so it becomes a standing contract rather than a unit-tested island.

For the parser shape specifically, prefer a **two-phase** design over strict-line-by-line:

1. A scope-narrowing step that isolates the delimited region when present.
2. A collection step that **skips** non-checklist-shaped lines but still fails `malformed` on a
   task-list-*shaped* line that breaks the grammar.

That distinction is the whole point: a typo'd item stays an error while surrounding prose stays
invisible. Decouple ordinal ids from the source line index so that adding prose does not shift ids.

## Why This Matters

Comprehensive unit tests create false confidence exactly where systems break: at the boundaries the
tests do not cross. Three PRs shipped green through the same un-integration-tested seam. The
golden-path test is the correct answer whenever bugs keep recurring at one boundary — it converts a
repeated failure mode into a regression that cannot ship silently.

## When to Apply

- A function has unit tests but its real callers feed it differently than the fixtures do.
- Bugs keep recurring at the same integration boundary despite green unit suites.
- You are writing a parser for input that legitimately mixes free-text and structured content.

## Examples

The seed path added no new trust surface, which is the clean way to introduce a new entry point:
seeded items enter the existing state machine as `pending` and then flow through every existing
control — the registry gate, the approval-fingerprint CAS, the prompt-safety policy, and the
two-phase intent → dispatched write — exactly like a hand-authored marker. Reusing the existing gates
rather than bypassing them is what keeps a new entry point from widening the boundary.

Two secondary notes worth carrying forward:

1. **Avoid parsing the winning input twice** (once inside a `findLast` predicate, once after) — hoist
   the parsed result if the seam needs tightening.
2. **A fail-closed rejection is the safe direction, but emit a distinct diagnostic.** An over-cap
   checklist that makes the parse fail and the run bail should be distinguishable from "no checklist
   found" — `checklist rejected by cap` vs `no checklist present`.
3. **Sibling functions that share a documented grammar should share rejection semantics.** One path
   returning `malformed` on a bad line while the other silently continues is a latent divergence —
   reconcile it or document why the scopes differ.

### Recurrence: file-mediated step boundary (improvement-metrics loop, 2026-07-10)

A fourth instance of the same lesson, four days later, in a different module — this time the seam was
a **file between two workflow steps**, not a function call. The detect step wrote a structured
`{digest, edges}` object to `IMPROVEMENT_METRICS_DIGEST_PATH`, and a *flatter* `DetectResult` (no
`digest`/`edges` wrapper) to stdout. The workflow ran `node scripts/improvement-metrics-detect.ts |
tee "$SAME_PATH"`, so `tee` overwrote the file with the stdout shape after the script's own write.
The report step read `{digest: undefined, edges: undefined}` and the live path was dead on arrival on
the first real dispatch. Every unit test passed, because every test crossed the detect → report
boundary **in-memory**, passing pre-built `{digest, edges}` objects straight into the consumer — none
ran the detect subprocess against a real file, and none parsed the workflow's `run:` string.

The fix needed **two** complementary regression guards, and they are not interchangeable:

1. A **real-file round-trip** integration test: write the digest with the real writer to a temp path,
   read it back with the real reader, then drive the consumer end-to-end and assert it produces a
   result rather than throwing on `undefined`. This fails against the tee-clobber code.
2. A **workflow-contract** test: parse the workflow YAML and assert the detect step's `run` is exactly
   `node scripts/improvement-metrics-detect.ts` with no `tee` over its own digest path. This fails the
   moment someone re-adds the redirect, even if the script's file-write shape is unchanged.

The generalization: the prevention rule extends from *function-mediated composition* to **any step
boundary that production walks differently than the fixtures do** — a file, a shell pipeline, a
subprocess. When one side writes a structured artifact to a sink *and* writes a different shape to
stdout, a shell redirect can collapse them onto the same path; you need one test for the on-disk
shape and one for the pipeline that produced it. Either alone leaves a single line of YAML one revert
away from re-introducing the bug.

## Related

- Source PRs (merge commits): `faa6e2569e110d7cf272bbc9e2d60679d4ba7230` (two-phase parser +
  golden-path test) and `a2fda59d7a76b7a6b4c8a44eee4f6fdc23e17c55` (the seed-path seam that the same
  live rehearsal first exposed)
- `docs/solutions/best-practices/worker-authored-hash-bound-receipts-2026-07-06.md` — the same loop's
  completion half, verified with the same golden-path discipline
- Fourth recurrence (file-mediated step boundary): PR #3672, `fix(improvement-metrics): stop tee from
  clobbering the detect digest file` — regression guards in
  `scripts/improvement-metrics-integration.test.ts` (real-file round-trip) and
  `scripts/improvement-metrics-workflow.test.ts` (detect step does not tee over its own digest path)
- `docs/solutions/best-practices/edge-keyed-confirmation-markers-2026-07-10.md` and
  `docs/solutions/best-practices/immutable-history-keys-for-trend-recompute-2026-07-10.md` — sibling
  learnings from the same PR
