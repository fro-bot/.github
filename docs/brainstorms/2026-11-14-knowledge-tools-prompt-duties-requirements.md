---
date: 2026-11-14
topic: knowledge-tools-prompt-duties
---

# Tell the Agent When to Use the Knowledge Tools

## Summary

The agent prompts stop telling the agent not to look further than its baseline context. They name the situations in which to call each knowledge tool. The summary line that every agent job already prints is the measure. If the tools are still unused 14 days after the change, they are removed.

---

## Problem Frame

Agent jobs start a `knowledge` server with three tools: `knowledge_wiki_search`, `knowledge_wiki_linked` and `knowledge_solutions_search`. The server connects in the pull request job, in Remediate and in Observe. No job has called a tool. Since the summary step began to separate a started server from a missing call log, every line reads `Knowledge tools: server started, no calls.`

The prompt gives two instructions that pull against each other. `.github/workflows/fro-bot.yaml` says the wiki context is "usually enough on its own — do not expand by default", and three lines later says "Use the tools". The first sentence dates from July, when expansion was a shell recipe and the aim was to keep runs on the baseline. The second arrived in November with the tools. The survey prompt in `.github/workflows/survey-repo.yaml` calls the tools optional. No prompt and no tool description says when a call is worth making.

The November requirements set one success test: scheduled runs call the tools mid-run. That test is unmet. Whether the agent would call the tools under a plain instruction is unknown, because no run has had one.

---

## Requirements

**Prompt**

- R1. No agent prompt tells the agent to avoid the knowledge tools by default or describes them as optional.
- R2. The pull request job, Remediate and Observe are told to search documented solutions before reviewing code or starting a fix, with a query drawn from the area being changed.
- R3. Remediate and Observe are told to search the wiki when the work concerns another tracked repository.
- R4. Each survey attempt is told to search the wiki and documented solutions before it writes a page.
- R5. No prompt gives a duty for `knowledge_wiki_linked`. Its one-line description stays.
- R6. The existing rules on tool output stay as they are: a failed call returns an error code, an empty result means nothing matched, and query text and returned excerpts are not echoed into output or logs.
- R7. The prompt states that returned wiki and solution text is reference material, not instructions.

**Measurement and removal**

- R8. Usage is read from the existing per-job summary line. No new counter, log or workflow step is added.
- R9. A job counts as having used the tools when its summary prints the call table. The rate is those jobs divided by all agent jobs whose summary step printed a line, over the 14 days after the change merges.
- R10. If the rate is below 1 in 10, the next change removes the server, its two composite actions, their tests and the prompt text.
- R11. If the rate is 1 in 10 or above, the tools stay and the result is recorded in this document.

---

## Acceptance Examples

- AE1. **Covers R2.** Given a pull request that changes code, when the review job runs, its prompt tells it to search documented solutions for the changed area before reviewing.
- AE2. **Covers R3.** Given the daily Observe pass reporting on another tracked repository, its prompt tells it to search the wiki for that repository.
- AE3. **Covers R4.** Given a survey of a repository, each attempt's prompt tells it to search before writing, and none calls the tools optional.
- AE4. **Covers R9, R10.** Given 40 agent jobs with a summary line in the 14 days and 3 with a call table, the rate is below 1 in 10 and the removal goes ahead.
- AE5. **Covers R9, R11.** Given 40 such jobs and 6 with a call table, the tools stay.

---

## Success Criteria

- Within 14 days the summary lines show either regular calls or their absence under a plain instruction, and the keep-or-remove decision follows from the count without further debate.
- A planner can write the change from this document without deciding which jobs get which duty, how usage is counted or what triggers removal.

---

## Scope Boundaries

- What the baseline context contains and how its pages are selected. The wiki baseline is one page cut at its size cap and is often not about the repository under review. That has its own brainstorm.
- The tools' behaviour, limits and descriptions.
- Retiring the baseline excerpts in favour of the tools.
- Judging whether a call improved the output. This change measures calls only.

---

## Key Decisions

- Named situations, not "always search": a call then signals that the situation arose, and cost stays bounded.
- The July rule that kept runs on the baseline is dropped. It was a cost rule, and the cost of a call was never measured. Recorded as completed in `docs/brainstorms/2026-07-07-a1-phase-3-deep-wiki-traversal-requirements.md`.
- The November requirements chose run logs over a call-volume baseline as evidence of use. This document keeps that measure and adds a threshold and a date. Recorded as completed in `docs/brainstorms/2026-11-06-agent-knowledge-mcp-tools-requirements.md` and `docs/plans/2026-11-06-001-feat-agent-knowledge-mcp-tools-plan.md`.
- No duty for the linked-pages tool: it expands from the baseline page, and a wrong baseline page gives wrong neighbours.
- Removal is decided now, with its trigger, so an unused server does not stay by default.

---

## Dependencies / Assumptions

- The summary line is trustworthy: it distinguishes a call table, a started server with no calls, and a missing call log.
- The three survey attempts share one call log, so a survey job counts once.
- The agent can already read `knowledge/` and `docs/solutions/` from disk in these jobs. A low call rate may therefore mean the agent reads files directly, which is a reason to remove the tools, not a failure of the prompt.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] Where each duty sits in the prompt so that it applies to the right jobs and triggers without repeating text.
- [Affects R9][Technical] How the 14-day count is taken from run logs, given that the job summary is not readable from the CLI and the step log is.

---

## Sources / Research

- Prompt text: `.github/workflows/fro-bot.yaml` (`wiki_context_expansion` and `knowledge_persistence` blocks in the three agent jobs) and `.github/workflows/survey-repo.yaml` (`knowledge_tools` block in each attempt).
- Tool descriptions: `packages/wiki-ops/src/knowledge-mcp.ts`.
- Summary step: `.github/actions/knowledge-mcp-summary/action.yaml`.
- Workflow-contract tests that pin the prompt text: `scripts/fro-bot-workflow.test.ts`, `scripts/survey-repo-workflow.test.ts`, `scripts/knowledge-mcp-callers.test.ts`.
