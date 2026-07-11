---
date: 2026-07-07
topic: a1-recurring-pattern-synthesis
---

# A1 — Recurring Pattern Synthesis

## Summary

Add a proposal-only synthesis loop that finds repeated learning patterns across prior Fro Bot work. The loop should identify when the same mistake, fix, or operating lesson appears across multiple public-safe artifacts and open decision-ready pattern proposals for human review.

---

## Problem Frame

A1 already helps Fro Bot retrieve known lessons and capture new ones from high-signal work. That makes individual learnings durable, but it does not yet tell whether multiple solved incidents are pointing at the same deeper pattern.

The current capture path is intentionally candidate-oriented: each proposal is anchored to a concrete PR or solved incident. That keeps quality high, but it leaves recurring behavior scattered across proposal issues and solution docs. Fro Bot can remember individual lessons, but it cannot yet notice that the same class of correction keeps returning.

The risk is fake insight. A loop that clusters shallow keywords would add another review queue without improving judgment. The first C4 slice must therefore prove decision-ready proposals from a narrow source set before any metric, dashboard, or authoring automation is added.

---

## Actors

- A1. Marcus: reviews pattern proposals and decides whether they become durable guidance.
- A2. Fro Bot synthesis loop: detects recurring patterns, summarizes public-safe evidence, and opens proposal issues.
- A3. Existing learning corpus: accepted `docs/solutions/` docs and learning-proposal issues in this repo.
- A4. Future planner/compound workflow: turns accepted pattern proposals into focused docs or plan changes.

---

## Key Flows

- F1. Pattern proposal flow
  - **Trigger:** A scheduled or manually dispatched synthesis run scans the allowed learning corpus.
  - **Actors:** A2, A3
  - **Steps:** The loop groups related artifacts, filters keyword-only or weak clusters, validates a public-safe summary, and opens a proposal issue for clusters that satisfy the evidence threshold.
  - **Outcome:** Marcus sees a pattern proposal with enough summary and evidence links to decide without reconstructing the source history.
  - **Covered by:** R1, R2, R3, R4, R6, R7, R8, R9
- F2. Accepted pattern handoff
  - **Trigger:** Marcus accepts or acts on a pattern proposal.
  - **Actors:** A1, A4
  - **Steps:** The accepted proposal provides a concise pattern statement, source links, rationale, and suggested durable-home options for later compound or planning work.
  - **Outcome:** The pattern can become reusable guidance without the synthesis loop directly authoring it.
  - **Covered by:** R5, R10, R11, R14
- F3. Suppression flow
  - **Trigger:** A pattern proposal is rejected, closed as low-signal, or superseded by better guidance.
  - **Actors:** A1, A2
  - **Steps:** The synthesis loop records the cluster identity in the proposal issue and suppresses repeat proposals unless later public-safe evidence changes that identity.
  - **Outcome:** Rejected weak patterns do not become recurring noise.
  - **Covered by:** R12, R13, R15

---

## Requirements

**Allowed source set**
- R1. The loop must synthesize only from accepted `docs/solutions/` documents and learning-proposal issues in this repo.
- R2. The loop must not read raw agent transcripts, workflow logs, unpublished local notes, private-only artifacts, or cross-repo issue bodies as synthesis inputs.
- R3. Proposal issues are the durable decision log for C4; no new metric store or secondary index is required in this slice.

**Pattern quality**
- R4. A pattern candidate must draw evidence from at least two independent source artifacts that describe the same correction behavior, not only the same tag or keyword.
- R5. A pattern proposal must state the reusable lesson in plain operational language and explain why the sources are the same pattern.
- R6. A proposal must be decision-ready: it must include the pattern statement, a short rationale, public-safe evidence links, and suggested next human action.
- R7. The loop must suppress keyword-only, taxonomy-only, or over-generalized clusters even when they meet the two-artifact minimum.

**Proposal behavior**
- R8. The first slice must be proposal-only and must not author or modify `docs/solutions/` documents.
- R9. The loop must open at most three proposals per run and must order candidates by evidence strength before applying the cap.
- R10. Each proposal must suggest one next human action: compound into a solution doc, fold into an existing doc, defer for more evidence, or reject.
- R11. Accepted pattern proposals must remain visible as issue-based evidence for future metric planning; the issue itself is the source of truth.

**Lifecycle and deduplication**
- R12. Each proposal must carry a stable public cluster identity derived from sorted source artifact identifiers; the pattern statement is display metadata, not part of the identity hash.
- R13. Rejected, low-signal, or superseded proposals must suppress repeat proposals with the same cluster identity.
- R14. The loop may propose a new version only when later public-safe evidence adds enough new independent source artifacts to cross the upgrade threshold.
- R15. Unsafe or blocked clusters must be counted as skipped for the run but must not create durable suppression state.

**Public-output safety**
- R16. Every proposal body must pass the same deterministic public-output/private-token gate stack used by existing proposal loops before posting; C4 must not introduce a weaker advisory-only scan.
- R17. Proposal bodies must not include private repo identifiers, branch names, issue titles, raw run-log text, transcript snippets, or private-only evidence links.
- R18. Evidence links must be public-safe and dereferenceable by the public proposal audience; private or opaque links must be omitted.
- R19. Missing, unsafe, or private-only evidence must cause a candidate to be skipped rather than summarized vaguely.

**Self-improvement boundary**
- R20. The loop must not edit prompts, persona files, skills, workflow instructions, or `docs/solutions/` directly.
- R21. The loop must not claim Fro Bot is measurably improving from synthesis alone; outcome measurement is deferred to the O8 metric slice.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R5, R6.** Given three accepted learning proposals about repeated workflow-state drift, when the synthesis loop runs, it opens one proposal that names the operational pattern, explains the repeated correction behavior, and links the source proposals.
- AE2. **Covers R4, R7.** Given two artifacts that share only a generic tag like `testing` but describe unrelated lessons, when the synthesis loop runs, it does not open a pattern proposal.
- AE3. **Covers R2, R16, R17, R19.** Given a cluster whose only useful evidence requires raw logs or a private repo name, when the loop evaluates it, the candidate is skipped and no proposal body is posted.
- AE4. **Covers R6, R8, R10, R20.** Given a strong recurring pattern, when the proposal is opened, it suggests human next actions but does not change any prompt, persona, skill, workflow, or solution-doc file.
- AE5. **Covers R12, R13, R14.** Given a rejected low-signal pattern proposal, when the same weak cluster appears again, the loop suppresses it; when a later public-safe artifact adds independent evidence, the loop may propose a new version.
- AE6. **Covers R9, R15, R21.** Given more than three candidate clusters in one run, when the proposal cap is reached, the loop posts only the three strongest candidates, reports capped/skipped counts, and does not claim improved outcomes.
- AE7. **Covers R18.** Given a candidate with one public source and one private evidence link, when the proposal body is rendered, the private link is omitted; if the remaining public evidence no longer meets threshold, the candidate is skipped.

---

## Success Criteria

- Marcus can accept, reject, or defer a pattern proposal from the proposal body alone, without re-reading every source artifact.
- The first evaluated batch produces decision-ready proposals or clear skip counts, not keyword-cluster noise.
- Public proposal output contains no private repo identifiers, branch names, issue titles, raw run-log content, transcript snippets, or private-only links.
- A rejected pattern does not repeatedly reappear unless new public-safe evidence crosses the upgrade threshold.
- The accepted/rejected/deferred pattern proposal outcomes give enough signal to plan the O8 improvement metric slice.

---

## Scope Boundaries

- No autonomous authoring or editing of `docs/solutions/` documents in the first slice.
- No prompt, persona, workflow-instruction, or skill self-editing.
- No operator-web/dashboard surfacing.
- No improvement metric or claim that Fro Bot is improving.
- No raw transcript, workflow-log, unpublished note, or private-only evidence mining.
- No cross-repo dispatch expansion; A3 production goals remain separate.
- No new persistent store beyond issue markers and existing proposal issue state.

---

## Key Decisions

- **Proposal-only first:** Pattern synthesis is judgment-heavy, so human review stays in the loop until proposal quality is known.
- **Narrow public source set:** The first slice uses accepted solution docs and learning-proposal issues, not raw run history.
- **Evidence clusters over taxonomy counts:** Repeated tags are a weak signal; proposals need repeated correction substance.
- **Issue-based lifecycle:** Proposal issues remain the decision log and suppression surface for this slice.
- **Separate synthesis from metrics:** C4 finds candidate patterns; O8 later measures whether those patterns improve future outcomes.

---

## Dependencies / Assumptions

- The existing A1 capture/proposal machinery is available and remains the source of individual learning artifacts.
- The current public-output/private-identifier gate is mandatory for any proposal body the loop emits.
- C-deep/wiki context expansion improves agent grounding but is not required for every synthesis run.
- Learning-proposal issue labels and markers remain stable enough for planning to define the exact query and fingerprint mechanics.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R7][Technical] What exact evidence signals best distinguish repeated correction behavior from keyword overlap?
- [Affects R9][Technical] What lookback window is small enough for cost control but large enough to produce signal?
- [Affects R14][Technical] What upgrade threshold is high enough to avoid superset spam but flexible enough to surface stronger later evidence?
- [Affects R16][Technical] Which existing public-output validation module should be reused for final proposal-body validation?

---

## Sources / Research

- North-star context: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`
- A1 origin: `docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md`
- C-deep predecessor: `docs/brainstorms/2026-07-07-a1-phase-3-deep-wiki-traversal-requirements.md`
- Existing capture scripts: `scripts/capture-learnings-harvest.ts`, `scripts/capture-learnings-open.ts`, `scripts/capture-learnings-privacy.ts`
