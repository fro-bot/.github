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

1. **Find the test at the deployed release tag and link the file and line at that tag (`blob/<tag>/<path>#L<n>`).** A link through `main` names different code after the next commit.
2. **Split the requirement into clauses and mark each one asserted or not asserted by this test.** A name match identifies a candidate test; only its setup and assertions show which clauses it covers. The unknown-reason line below has two clauses, and only a test that checks both closes it.
3. **Read the setup, the fault and the assertions, then follow the production function the test drives.** A mock shows how the code under test responds to the mock; it does not prove the real component behaves that way.
4. **Beside each link, name the tested scope, whether the fault was injected or live, and whether the test was read or run.** `packages/gateway/src/execute/run.quarantine-cancel.test.ts:99-101` in `fro-bot/agent` at `v0.138.0` supplies the failure through a test store (`makeRecordStore(failPhases)`), so it does not observe a live persistence failure, and a line that says "live quarantine cancel" keeps a live remainder.
5. **Check that the test exercises the same actor and behaviour as the requirement.** `packages/gateway/src/approvals/registry.test.ts:698` is named "closes a sibling card from its own echo" (a sibling card is another approval still pending in the same session) and sits in the describe block for a reject that upstream applies to every pending ask, so it covers a reject cascade. Tests for Always grants in the same package assert other things: `run-grants.test.ts:91-184` asserts resource and action matching, grant teardown and run isolation, and `coordinator.test.ts:692-796` asserts that nothing is auto-answered once a run starts ending, that one run's grant does not apply to another run, and that an ask arriving during an in-flight Always is not answered early and gets one reply. A line about Always grants is covered only for the clauses those assertions state.
6. **Check that the cited range runs in the release's CI job.** A `skipIf` or an environment gate removes the case from the run that matters. In this repository `scripts/knowledge-mcp-summary-action.test.ts:146-147` skips the unreadable-file case as root.
7. **Tick a line only when every clause is asserted at the level the line names; otherwise keep every unproven clause in the open line and keep the proof links beside it.** In the November 13 round the proof links sat in a comment, each entry read `Proven: … (level) (links). Still open: …`, and each of the 19 narrowed lines ended with a pointer to that comment.
8. **Compare the reworded line with the original clause by clause before applying it; a shorter "still open" sentence drops whatever it does not repeat.** The narrowing wording named none of six groups of sub-requirements: the unreadable-live-run exclusion and the first-actor and one-notice races, the live-owner, CAS and recent-hour safeguards with the terminal SSE notification and bounded terminal-write retries, the latest-turn terminal confirmation and the unsaved-child-notice residual, no log disclosure for approval resources, the proxy half of provider headers and proxy, and the rule that preserve-and-recover evidence tells apart the cancel request, the actual session stop and safe checkout reuse. The tracker's reply flagged them as absent from the body, and [a later comment](https://github.com/fro-bot/.github/issues/3512#issuecomment-6868099789) asked for all six to be restored, unticked, in their original wording.

## Why This Matters

A tick that credits more than the test asserts closes a gate that was never checked, and the remainder disappears from the tracker. Here 19 of 22 lines had a remainder under a matching name. An injected fault (rule 4), one clause of several (rule 2) and a mocked boundary (rule 3) each hide behind a green test and a correct title. A narrowed line keeps the open part visible and keeps the proof where a reader can audit it. A reworded line can also lose requirements that the original named (rule 8).

## When to Apply

- Before ticking an acceptance line, release gate or checklist item that cites a test.
- When a review or status report says a requirement is "covered by tests".
- When a line says live, deployed, real, or end to end.
- When a title or a search hit is the only evidence for a citation.

## Examples

A name that matches one test and a test that asserts both clauses, for the line "unknown waitReason values behave as absent detail":

```text
Line      unknown waitReason values behave as absent detail
Clauses   (1) no reason label shows  (2) the frame is not discarded: the card still shows Running
Name hit  agent v0.138.0 packages/gateway/src/operator-contract/run-status.test.ts:642
          "(edge) empty string '' maps to 'unknown'": asserts toOperatorFailureKind(''), a failure kind.
          A different field, so not a candidate.
Read      dashboard 2026.11.18 web/src/operator/wait-reason-label.test.ts:232-241
          stubs the stream fetch and pushes a running frame with reason 'future-reason'; asserts the
          card text is "Running" (:239) and that no label shows (:240).
Verdict   both clauses asserted. Ticked with the permalink at the tag.
```

A line whose test injects the fault is narrowed, not ticked (comment 6862944679):

```text
Line        live quarantine cancel with failed FAILED persistence
Proven      a cancel on a quarantined run writes no CANCELLED, releases nothing and announces nothing
            (injected store, unit level): run.quarantine-cancel.test.ts:133, :155 at v0.138.0
Still open  the same cancel on a live quarantined run, and quarantine that starts during settlement.
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
