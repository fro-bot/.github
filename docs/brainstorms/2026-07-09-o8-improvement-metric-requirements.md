---
date: 2026-07-09
topic: o8-improvement-metric
---

# O8 — Self-Improvement Metric

## Summary

Add a report-only metric loop that answers whether Fro Bot's self-improvement loops actually reduce repeated work. Each run recomputes two paired numbers — how many distinct new classes got codified in the window (discovery), and how many already-codified classes recurred anyway (recidivism) — and rewrites one perpetual report issue. Recidivism links are proposed by the loop but count only after a human confirms them, and the report renders a fixed set of states so the number can never quietly read as success.

---

## Problem Frame

Fro Bot now runs several self-improvement loops: A1 learning capture opens `learning-proposal` issues, C4 pattern synthesis opens `pattern-proposal` issues with accept/reject/defer/supersede outcomes, and Status Truth opens drift proposals. Each loop already emits counts of what it did. C4's requirements doc closed by forbidding the loop from claiming improvement (R21) and handed that measurement to "the O8 metric slice."

What no existing count answers: is the same class of fix, finding, or lesson still recurring, and is that recurrence trending down? A metric that merely re-aggregates the loops' own output counts would add a scoreboard without adding judgment — the same "fake insight" failure C4 warned about, one tier up. The cost of getting this wrong is a vanity number that looks like progress while repeated work continues unmeasured — or worse, a number that reads clean precisely because nobody maintains it.

---

## Actors

- A1. Marcus: reads the O8 report, confirms or rejects candidate recurrence links, and decides what the paired reading means for action.
- A2. O8 metric loop: scans the structured source set, computes the discovery and recidivism halves, proposes candidate recurrence links, renders a fixed report state, and rewrites the report issue each run.
- A3. Existing proposal loops (A1 capture, C4 synthesis, Status Truth): emit the proposal issues and outcomes O8 reads; their labels and markers are O8 inputs.
- A4. `docs/solutions/` corpus: the canonical codified-class anchor that recidivism links point back to; accepted `pattern-proposal` issues are supporting evidence, not anchors.

---

## Key Flows

- F1. Metric recompute run
  - **Trigger:** Manual `workflow_dispatch` (dry-run default), same posture as C4.
  - **Actors:** A2, A3, A4
  - **Steps:** Scan the structured source set over the window; count distinct newly-codified classes (discovery); recompute confirmed recidivism from human-confirmed markers; detect new candidate links; compute the prior-window delta over immutable timestamps; select the report state; rewrite the perpetual report issue.
  - **Outcome:** One report issue shows discovery, confirmed recidivism, the pending-candidate backlog, the report state, and the prior-window delta.
  - **Covered by:** R1, R2, R3, R4, R9, R10, R12, R13, R14

- F2. Recidivism link confirmation
  - **Trigger:** O8 surfaces a candidate link ("this new event looks like codified class X") in the report.
  - **Actors:** A1, A2
  - **Steps:** Marcus reviews the candidate; if it is a real recurrence he applies the fixed-vocabulary confirm marker; the next run reads that marker and counts the link as confirmed recidivism.
  - **Outcome:** Only human-confirmed links move the recidivism number; unconfirmed candidates stay in the visible pending backlog.
  - **Covered by:** R5, R6, R7, R8, R11

- F3. State-selection rendering
  - **Trigger:** A run has computed its measures and backlog.
  - **Actors:** A2
  - **Steps:** Apply the deterministic state rules — insufficient-signal below minimum volume; ambiguous on a falling discovery rate; healthy/failing per the paired reading; flag a stale pending backlog as a warning regardless of state.
  - **Outcome:** The report renders one of a fixed set of states and cannot be misread as improvement caused by silence.
  - **Covered by:** R15, R16, R17, R18

---

## Requirements

**Metric definition**
- R1. O8 must report two paired measures per run: discovery (the count of distinct classes first codified in the window) and recidivism (the count of already-codified classes that recurred anyway), presented together as one reading.
- R2. Discovery must count a class only on its first codification; it must not re-count an existing class from repeated proposals, and it must not treat a C4 recurrence assertion as discovery unless that class is newly codified in the window.
- R3. O8 must show the prior-window delta for each measure, computed only from immutable event timestamps and stable class identity, so a run is situated against the immediately prior window without building a general time-series store.

**Source set and anchor**
- R4. O8 must derive discovery and recidivism only from structured public artifacts in this repo: `learning-proposal` issues, `pattern-proposal` issues with their outcome labels, Status Truth proposals, and the `docs/solutions/` corpus.
- R5. The canonical codified-class anchor is the `docs/solutions/` corpus; accepted `pattern-proposal` issues are supporting evidence for a candidate link, never a second anchor, so a recurrence is counted against exactly one codified class.
- R6. O8 must not mine raw agent transcripts, workflow logs, autoheal fix-PR frequency, review-churn cycles, private-only artifacts, or cross-repo issue bodies as inputs in this slice.

**Recidivism link lifecycle**
- R7. A recidivism count must include a link only after a human confirms that a new event is a recurrence of a codified class; O8 must never self-confirm a link.
- R8. O8 must detect and surface candidate recurrence links for human review, doing the work of spotting likely recurrences without asserting them.
- R9. Confirmation must be a fixed-vocabulary marker (a label or checklist toggle) on the report issue or the candidate's own issue, re-readable by a later run — no freeform confirmation text is read by O8, and no bespoke confirmation store is introduced.

**Output surface**
- R10. O8 must maintain a single perpetual report issue, rewriting it each run with the current measures, prior-window delta, report state, and the pending-candidate backlog; it must not open a new issue per run.
- R11. O8 must be report-only: it must not author or modify `docs/solutions/` documents, prompts, personas, skills, workflow instructions, or any proposal loop's logic.
- R12. O8 must run on manual dispatch with a dry-run default, matching the existing proposal loops' operational posture.
- R13. O8 must recompute both measures from source history and confirmation markers each run, introducing no new durable metric store in this slice.

**Honesty guards**
- R14. The report must state the window and the source counts behind each measure so a reader can see what produced the number.
- R15. The report must render exactly one of a fixed set of states — `insufficient-signal`, `ambiguous`, `healthy`, `failing` — selected by deterministic rules, rather than free-form prose that different runs could phrase inconsistently.
- R16. Below a minimum volume of discovery events and codified anchors in the window, the report must render `insufficient-signal` and must not present any paired interpretation or trend claim.
- R17. The pending-candidate backlog must be a first-class count in the report, showing the number of unconfirmed candidates and the age of the oldest; a backlog older than a staleness threshold must raise a visible warning so an unmaintained metric cannot read as `0 recidivism`.
- R18. A falling discovery rate must render as `ambiguous` — it may mean fewer repeats or a quieter/degraded loop — and must never be rendered as improvement on its own; O8 must make no claim that Fro Bot is measurably improving.

**Public-output safety**
- R19. Every report body must pass the same deterministic public-output/private-token gate the existing proposal loops use, with the same fail-closed policy: any gate failure blocks the post, with no advisory-only fallback.
- R20. Candidate and evidence text must be public-safe by construction — built only from a class key, a public issue URL, or a fixed label — with a denylist for source issue titles, body excerpts, branch names, repo names, and quoted snippets, so aggregation across sources cannot re-identify a private origin.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a window with two newly-codified classes and repeated proposals for an already-codified class, when O8 runs, discovery counts two (not the repeat proposals), recidivism reflects only confirmed recurrences, and each measure shows its prior-window delta.
- AE2. **Covers R7, R8, R17.** Given a new `learning-proposal` that resembles a codified class, when O8 runs, it lists the candidate as pending, the recidivism count does not rise until a human confirms it, and the pending backlog count and oldest-candidate age appear in the report.
- AE3. **Covers R9, R13.** Given a candidate a human confirmed in a prior run via the fixed marker, when O8 runs again, it recomputes that link as confirmed recidivism from the marker without reading any private store.
- AE4. **Covers R5.** Given a recurrence whose codified class has both a `docs/solutions/` doc and an accepted `pattern-proposal`, when O8 counts it, it counts against the solution doc once and treats the accepted pattern as evidence, not as a second anchor.
- AE5. **Covers R15, R16.** Given a window below the minimum volume, when O8 renders, the report state is `insufficient-signal` and presents no trend interpretation.
- AE6. **Covers R17, R18.** Given a window where discovery fell to zero while unconfirmed candidates remain, when O8 renders, the state is `ambiguous`, the stale backlog raises a warning, and nothing reads as improvement.
- AE7. **Covers R11, R18.** Given any run, when the report is written, it changes no solution doc, prompt, persona, skill, or workflow, and makes no claim that Fro Bot is improving.
- AE8. **Covers R19, R20.** Given a candidate whose only distinguishing evidence is a private identifier, when the report body is rendered, that evidence is omitted, the text is built only from public-safe keys/URLs, and the public-output gate passes.

---

## Success Criteria

- Marcus can read one report issue and tell whether repeated work is trending down, and whether the metric is being maintained, without reconstructing history from the underlying proposal issues.
- The recidivism number reflects only human-confirmed recurrences, and an unmaintained confirm backlog is visible rather than masquerading as zero recidivism.
- A falling discovery rate and a low-volume window each render a distinct, non-improvement state.
- The report contains no private identifiers, raw logs, or transcript content, even under aggregation across sources.
- A downstream planner can implement the loop from this doc without inventing what the measures mean, which single anchor defines a codified class, how a link becomes confirmed, or the state-selection rules.

---

## Scope Boundaries

### Deferred for later

- Mining autoheal fix-PR frequency and review-churn / re-review cycles as additional repeated-work signal — real toil signal, deferred until the structured half is proven.
- A durable committed metrics file (e.g., on the `data` branch) and any time-series beyond the prior-window delta — revisit only if recompute-from-history proves insufficient.
- Any operator-web or dashboard surfacing of the metric — the north-star report-only boundary holds for this slice.
- Automatic scheduling — v1 is manual dispatch until the report proves trustworthy.

### Outside this product's identity

- O8 measures; it does not act. Turning a measured regression into a fix is a separate action-graduation loop's job. O8 exists to inform that graduation decision, not to be a perpetual dashboard nobody acts on.
- O8 does not re-aggregate the individual loops' own operational throughput counts; it measures recurrence across them, not their internal volume.

---

## Key Decisions

- Paired reading over either half alone: discovery alone cannot distinguish healthy quiet from broken quiet; pairing it with recidivism disambiguates.
- Proposal-confirm recidivism links over auto-inference: keeps the headline honest and mirrors C4's proposal-only posture one tier up; auto-fuzzy-linking would import the exact fake-insight risk C4 exists to avoid.
- Single canonical anchor (`docs/solutions/`), patterns as evidence: prevents a recurrence being double-counted against two codified representations of the same class.
- Discovery as first-codification, not proposal traffic: de-circularizes the measure so O8 does not count a detector's own recurrence assertions as fresh discovery.
- Deterministic report states over prose: a fixed `insufficient-signal | ambiguous | healthy | failing` vocabulary makes the honesty guards testable and keeps runs comparable — the same closed-vocabulary discipline the codified-identifiers learning established.
- Recompute-from-history over a new metric store: proposal issues and confirmation markers already hold the events, so no durable store is added and the privacy surface stays identical to C4 and Status Truth. Trend is bounded to the prior-window delta over immutable timestamps to stay stable under source edits.

---

## Dependencies / Assumptions

- The A1 capture, C4 synthesis, and Status Truth proposal loops remain the source of events and keep their current labels and markers stable enough to query.
- The reusable public-output gate `applyPublicOutputGate` / `makePublicOutputTokens` in `scripts/status-truth-public-output.ts` is available for reuse as the mandatory report-body validator (confirmed present; already reused by capture-patterns).
- The `docs/solutions/` corpus remains the codified-class anchor, and accepted `pattern-proposal` issues remain visible as durable evidence.
- Proposal-issue created-at timestamps and outcome labels are sufficient to compute the window and prior-window delta without a separate event store.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R5][Technical] How is a codified class's identity keyed for matching — does it lean on `docs/solutions/` frontmatter (module/component/problem_type) as the class key, and how does a new event get matched to it as a candidate?
- [Affects R8][Technical] What candidate-link detection heuristic best spots a likely recurrence without over-claiming, given confirmation stays human?
- [Affects R9][Technical] Which fixed marker (issue label vs report-body checklist toggle) is the most durable, re-readable confirm gesture, and does it live on the report issue or the candidate's own issue?
- [Affects R16, R17][Technical] What minimum-volume thresholds and backlog-staleness age produce meaningful states at current proposal volume?
- [Affects R3][Technical] What window length balances cost against signal given current proposal volume?

---

## Sources / Research

- North-star context: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`
- C4 predecessor that defers measurement to O8 (R21): `docs/brainstorms/2026-07-07-a1-recurring-pattern-synthesis-requirements.md`, `docs/plans/2026-07-07-004-feat-recurring-pattern-synthesis-plan.md`
- Codified-class anchor and closed-vocabulary state precedent: `docs/solutions/best-practices/closed-vocabulary-identifiers-for-automated-inspection-2026-07-09.md`
- Reusable public-output gate and source-query machinery: `scripts/status-truth-public-output.ts`, `scripts/capture-patterns-cluster.ts`, `scripts/capture-learnings-harvest.ts`, `scripts/status-truth-proposals.ts`
