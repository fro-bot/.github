---
date: 2026-07-07
topic: a1-phase-3-deep-wiki-traversal
---

# A1 Phase 3 — Deep wiki traversal

## Summary

C-deep is an agent-invoked wiki deepening step for runs where baseline context is not enough. Fro Bot may request either first-hop wikilink expansion or a targeted wiki query, and the control plane returns a small, public-safe, cited excerpt set.

---

## Problem Frame

A1 already retrieves prior learnings and injects shallow wiki context into agent runs. That baseline covers common work, but it leaves two gaps: adjacent context hidden behind wikilinks and follow-up context the agent can only name after reading the task and baseline excerpt.

The failure to avoid is not “too little text.” It is an agent making a decision after manually guessing which repo docs or wiki pages to inspect. C-deep should give the agent a bounded retrieval move when it can state the missing context, while keeping most runs on the cheap baseline path.

---

## Actors

- A1. Marcus: reviews whether C-deep improves agent judgment without turning wiki retrieval into prompt fog.
- A2. Fro Bot agent: starts with baseline context, decides whether deeper wiki grounding is needed, requests traversal, and cites returned wiki paths when using them.
- A3. Wiki corpus: the public-safe `knowledge/wiki/` content available to workflow runs through the data-branch overlay.
- A4. Control plane: owns the deterministic traversal surface, output budget, and privacy boundary.

---

## Key Flows

- F1. Linked deepening
  - **Trigger:** Baseline wiki context names a page or concept, and a first-hop wikilink is likely to clarify a relationship needed for the task.
  - **Actors:** A2, A3, A4
  - **Steps:** The agent requests expansion from baseline-selected pages, the control plane follows only first-hop wiki links, filters for public-safe wiki pages, applies the budget, and returns cited excerpts.
  - **Outcome:** The agent gets adjacent context without expanding every run by default.
  - **Covered by:** R1, R2, R4, R5, R6, R10
- F2. Query deepening
  - **Trigger:** Baseline context is insufficient and the agent can express the missing context as a short query grounded in the task or baseline excerpt.
  - **Actors:** A2, A3, A4
  - **Steps:** The agent submits the query, the control plane ranks public-safe wiki pages, applies the same budget, and returns cited excerpts or an explicit no-match result.
  - **Outcome:** The agent can recover relevant wiki context even when the wiki graph is sparse.
  - **Covered by:** R1, R3, R4, R5, R7, R10
- F3. No deepening
  - **Trigger:** Baseline wiki and solutions context are enough for the task.
  - **Actors:** A2
  - **Steps:** The agent continues without invoking C-deep.
  - **Outcome:** Most runs stay cheap and focused.
  - **Covered by:** R8, R9

---

## Requirements

**Invocation and behavior**
- R1. C-deep must be agent-invoked, not automatically appended to every run.
- R2. Linked deepening must start from pages selected by the baseline wiki context for the current run.
- R3. Query deepening must accept a short agent-stated query grounded in the task or baseline excerpt.
- R4. v1 traversal must be one hop deep.
- R5. Linked and query modes must use the same corpus, output budget, privacy filter, and citation format.
- R6. Linked deepening must return only pages reached by explicit wiki links from the selected baseline page set.
- R7. Query deepening must treat an irrelevant, overbroad, or no-match query as an empty result, not as permission to dump the corpus.
- R8. The agent must be allowed to skip C-deep when baseline context is sufficient.

**Budget and output contract**
- R9. v1 must return at most 3 additional pages.
- R10. v1 must return at most 8 KiB of additional excerpt text.
- R11. Every returned excerpt must include its wiki path.
- R12. Empty or no-match traversal must return an explicit empty result.
- R13. Traversal output must contain excerpts and paths only; it must not include hidden state, raw workflow context, token values, or agent reasoning.

**Safety and trust boundaries**
- R14. C-deep must read only the wiki corpus made available to the workflow as public-safe prompt context.
- R15. Each candidate page must pass the same public-context safety posture before any excerpt is returned.
- R16. C-deep must not read private repo state, workflow artifacts, metadata internals, `docs/solutions/`, or arbitrary repository files.
- R17. External logs and workflow outputs must remain counts/path-only.
- R18. If a page cannot be classified as safe for prompt context, traversal must exclude it and continue with the remaining candidates.

**Agent use and evidence**
- R19. When Fro Bot uses C-deep output to justify a recommendation, the explanation must cite the returned wiki path that grounded the claim.
- R20. The workflow prompt must make C-deep optional and describe the allowed triggers so the agent does not use it as a default crutch.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4, R6, R9, R10, R11.** Given baseline wiki context includes a page with two wikilinks, when Fro Bot requests linked deepening from that page, the result includes only first-hop linked pages, at most 3 pages, no more than 8 KiB of excerpts, and a path for each excerpt.
- AE2. **Covers R3, R5, R7, R9, R10, R11, R12.** Given baseline wiki context does not include the needed topic, when Fro Bot submits a grounded query, the result contains ranked wiki excerpts within the same budget or an explicit empty result.
- AE3. **Covers R8, R20.** Given baseline context is enough, when the agent proceeds without C-deep, the run does not lose required context and does not emit a warning or placeholder.
- AE4. **Covers R14, R15, R16, R17, R18.** Given a linked or queried page fails the public-context safety check, when traversal evaluates it, the page is excluded and external telemetry stays counts/path-only.
- AE5. **Covers R19.** Given Fro Bot relies on C-deep output to explain a recommendation, when it writes that explanation, it cites the wiki path that grounded the claim.

---

## Success Criteria

- A fixture with baseline-linked wiki pages proves first-hop traversal returns the expected cited pages within the v1 budget.
- A fixture with sparse links proves query deepening can return relevant cited pages without using link traversal.
- A no-match or unsafe-page fixture proves C-deep returns empty or filtered results without failing the run.
- In a representative agent prompt fixture, C-deep is presented as optional and baseline context remains the default path.
- The first live dry-run shows zero private identifiers in outputs and no more than 8 KiB of extra wiki context.

---

## Scope Boundaries

- No automatic expansion of every baseline wiki match.
- No multi-hop traversal in v1.
- No adaptive or large-budget traversal in v1.
- No operator-web decision-log surfacing.
- No true recurring-pattern synthesis or improvement metric work in this slice.
- No write path to the wiki, metadata branch, `docs/solutions/`, or generated learnings.
- No arbitrary repository search under the C-deep label.

---

## Key Decisions

- **Agent-invoked deepening:** The agent chooses when to deepen context because automatic expansion would punish every run for the few that need more context.
- **Links plus query:** Linked traversal preserves explainability from the baseline graph; query traversal handles sparse wiki links without opening the whole repo.
- **Tight v1 budget:** One hop, at most 3 extra pages, and at most 8 KiB of excerpts keeps the first slice reviewable.
- **Public-safe wiki corpus only:** “Wiki-only” is not enough; returned excerpts must be safe for prompt context.
- **Path citations:** C-deep is useful only when the agent can show which wiki page changed its understanding.

---

## Dependencies / Assumptions

- Baseline wiki context injection remains in place and continues to select initial pages for a run.
- The workflow wiki overlay continues to provide public-safe `knowledge/wiki/` content during agent runs.
- The current wiki corpus may have sparse wikilinks; query mode exists to keep v1 useful while linked coverage improves.
- Planning must verify the public-context safety gate used for wiki content before deciding whether to reuse or extend an existing privacy check.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] Should linked traversal and query traversal share one command with explicit modes or two separate commands?
- [Affects R15, R18][Technical] Which existing privacy gate is the right public-context safety check for wiki excerpts?
- [Affects R19, R20][Technical] How should tests prove the prompt contract encourages optional use without brittle assertions about model prose?

---

## Sources / Research

- Parent requirements: `docs/brainstorms/2026-06-22-skill-saving-grow-and-learn-requirements.md`
- North-star map: `docs/brainstorms/2026-06-15-fro-bot-personal-agent-north-star-requirements.md`
- Baseline retrieval plan: `docs/plans/2026-06-22-001-feat-solutions-retrieval-injection-plan.md`
- Baseline wiki query script: `scripts/wiki-query.ts`
- Current workflow injection surface: `.github/workflows/fro-bot.yaml`
