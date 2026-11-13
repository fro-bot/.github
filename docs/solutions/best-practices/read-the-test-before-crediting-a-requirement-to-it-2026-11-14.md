---
title: Read the test before crediting a requirement to it
date: 2026-11-14
category: best-practices
module: github-workflows
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - an acceptance or checklist line is closed on the strength of an automated test
  - a test is cited by its title or a search hit, not by what it asserts
  - a line says live, deployed or end to end and the cited test injects the fault
  - a review states that a requirement is covered by tests
tags:
  - acceptance-gates
  - test-evidence
  - traceability
  - injected-faults
  - review-claims
  - false-confidence
  - false-positive-verification
---

# Read the test before crediting a requirement to it

## Context

Tracker [fro-bot/.github#3512](https://github.com/fro-bot/.github/issues/3512) lists acceptance lines for the operator surface of `fro-bot/agent` and `fro-bot/dashboard`. Two comments of 2026-11-13 ([6862944679](https://github.com/fro-bot/.github/issues/3512#issuecomment-6862944679), [6862950504](https://github.com/fro-bot/.github/issues/3512#issuecomment-6862950504)) give the result of reading each cited test at the deployed tags, `v0.138.0` and `2026.11.18`. The tracker's [reply](https://github.com/fro-bot/.github/issues/3512#issuecomment-6863050079) opened all 67 test-line links: every file exists and every cited line is a test whose name matches the behavior described. That did not close the lines. Of the 22 lines in the two comments, 3 were ticked as worded and 19 were narrowed to a remainder that no cited test asserts. The reply says it read the test source and ran none of it.

## Guidance

1. **Open the test at the tag the release ships, through a permalink (`blob/<tag>/<path>#L<n>`), not at `main`.** Without it the line number names a different test after the next commit.
2. **Split the requirement into clauses and mark each one asserted or not asserted by this test.** A name match covers the clause the name mentions. The unknown-reason line below has two clauses, and only a test that checks both closes it.
3. **Read the setup, the fault and the assertions, then follow the production function the test drives.** A mock at the boundary proves the code behind it, not the boundary.
4. **Write the proof level beside every link: unit, registry or run level; injected or live; read or executed.** `packages/gateway/src/execute/run.quarantine-cancel.test.ts:99-101` in `fro-bot/agent` at `v0.138.0` builds the record store with `makeRecordStore(failPhases)`, and line 126 installs fake timers, so a line that says "live quarantine cancel" keeps a live remainder.
5. **Do not accept a shared word as a shared subject.** `packages/gateway/src/approvals/registry.test.ts:698` is named "closes a sibling card from its own echo" and sits in the describe block for a reject that upstream applies to every pending ask. It covers a reject cascade. The Always-grant siblings are covered by `run-grants.test.ts:91-156` and `coordinator.test.ts:692-734` in the same package.
6. **Check that the cited range runs in the release's CI job.** A `skipIf` or an environment gate removes the case from the run that matters. In this repository `scripts/knowledge-mcp-summary-action.test.ts:146-147` skips the unreadable-file case as root.
7. **Tick a line only when every clause is asserted at the level the line names. Otherwise reword the line to the remainder, add no line, drop no requirement and keep the proof links in a comment.** The 19 narrowed lines end with a pointer to the comment that holds the links, and each comment entry reads `Proven: … (level) (links). Still open: …`.
8. **List each sub-requirement the old wording named and the new wording drops, and get a decision.** The reply flagged six such groups (the unreadable-live-run exclusion, the terminal SSE notification and four more) that were absent after the rewording.

## Why This Matters

A tick that credits more than the test asserts closes a gate that was never checked, and the remainder disappears from the tracker. Here 19 of 22 lines had a remainder under a matching name. An injected fault (rule 4), one clause of several (rule 2) and a mocked boundary (rule 3) each hide behind a green test and a correct title. A narrowed line keeps the open part visible and keeps the proof where a reader can audit it.

## When to Apply

- Before ticking an acceptance line, release gate or checklist item that cites a test.
- When a review or status report says a requirement is "covered by tests".
- When a line says live, deployed, real, or end to end.
- When a title or a search hit is the only evidence for a citation.

## Examples

A name that matches and a test that proves the other field, for the line "unknown waitReason values behave as absent detail":

```text
Name hit  agent v0.138.0 packages/gateway/src/operator-contract/run-status.test.ts:642
          "(edge) empty string '' maps to 'unknown'": asserts toOperatorFailureKind(''), a failure kind.
Read      dashboard 2026.11.18 web/src/operator/wait-reason-label.test.ts:232-241
          pushes a running frame with reason 'future-reason'; asserts the card text is "Running"
          (:239) and that no label shows (:240): the reason is absent detail and the frame is applied.
Verdict   covered. Ticked with the permalink at the tag.
```

A line whose test injects the fault is narrowed, not ticked (comment 6862944679):

```text
Line      live quarantine cancel with failed FAILED persistence
Proven    a cancel on a quarantined run writes no CANCELLED, releases nothing and announces nothing
          (injected store, unit level): run.quarantine-cancel.test.ts:133, :155 at v0.138.0
Body now  the same on a live quarantined run, and quarantine starting during settlement; <proof comment link>
```

## Related

- [Check the first live event before trusting an event-driven workflow](check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md): the live event as the test no unit test replaces.
- [A mutation score can measure nothing](a-mutation-score-can-measure-nothing-2026-09-08.md): a passing number that does not measure the claim.
- [Test the integration seam, not the endpoints](test-the-integration-seam-not-the-endpoints-2026-07-06.md): tests that inject what the live path composes.
- [Verify in the CI topology, not just locally](verify-in-the-ci-topology-not-just-locally-2026-07-11.md): a check proves a claim only for environments that share the variable the claim depends on.
- [Writing a requirements doc that survives verification](requirements-doc-survives-verification-2026-06-24.md): every cited file, step and contract is opened and confirmed in the live tree.
- [An import closure does not see what a test reads at run time](an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md): a static proxy (an import closure, a test title) is not the thing it stands for.
- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): one line that covers two states hides which one a reader has.
- Tracker: [fro-bot/.github#3512](https://github.com/fro-bot/.github/issues/3512).
