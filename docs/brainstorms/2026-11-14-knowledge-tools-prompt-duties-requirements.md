---
date: 2026-11-14
topic: knowledge-tools-prompt-duties
---

# Tell the Agent When to Use the Knowledge Tools

## Summary

The agent prompts stop telling the agent not to look further than its baseline context. They name the situations in which to call each knowledge tool. The summary output that configured agent jobs already print is the measure. If the tools are still unused 14 days after the change, they are removed.

---

## Problem Frame

Agent jobs start a `knowledge` server with two tools: `knowledge_wiki_search` and `knowledge_solutions_search`. The server connects in the pull request job, in Remediate and in Observe. In the 13 job logs sampled since the summary step began to separate a started server from a missing call log, no call was recorded: each reads `Knowledge tools: server started, no calls.`

The prompt in `.github/workflows/fro-bot.yaml` gives two instructions that pull against each other. It says the wiki context is "usually enough on its own — do not expand by default", and three lines later says "Use the tools". The first sentence dates from July, when expansion was a shell recipe and the aim was to keep runs on the baseline. The second arrived in November with the tools. It names no situation in which a call is worth making. The survey prompt in `.github/workflows/survey-repo.yaml` names one, checking what exists before writing a page, and calls it optional.

The November requirements set one success test: scheduled and dispatched runs, and review-comment and discussion mentions, call the tools mid-run. That test is unmet. Whether the agent would call the tools under a plain instruction is unknown, because no run has had one.

---

## Requirements

**Prompt**

- R1. No agent prompt tells the agent to avoid the knowledge tools by default or describes them as optional.
- R2. The pull request job, Remediate and Observe are told (Remediate and Observe no longer, see the count record below): when a run reviews changed code or starts a fix, search documented solutions first, with a query drawn from the area being changed. Triage, review of a change with no code, and report-only work carry no such duty.
- R3. (Dropped 2026-11-28; see the count record below.) Remediate and Observe are told: when investigating a specific repository other than this one that is listed in `metadata/repos.yaml`, search the wiki for it before drawing a conclusion about that repository. A repository that only appears in an inventory carries no such duty.
- R4. Each survey attempt is told to search the wiki and documented solutions before it writes a page.
- R5. No prompt names `knowledge_wiki_linked`; the tool is removed.
- R6. The rules on tool output in the `fro-bot.yaml` prompts stay: a failed call returns an error code, an empty result means nothing matched, and query text and returned excerpts are not echoed into output or logs. The survey prompts gain the empty-result and no-echo rules, which they lack today.
- R7. The prompt states that returned wiki and solution text is untrusted reference material and never outranks the prompt's own rules. An applicable solution may still be followed, and its path cited, once it is checked against the task.

**Measurement and removal**

- R8. Usage is read from the existing summary output in each job's step log. No new counter, log or workflow step is added.
- R9. The rate covers pull request, issue, comment, Remediate and Observe jobs in the 14 days after the change merges. Each job counts once. A job whose summary prints the call table counts as a call attempt. A job whose summary prints `server started, no calls` counts as none.
- R10. Jobs with `no call log found`, a skipped agent step, no summary or an unreadable log are reported as unknown and left out of the rate.
- R11. Survey jobs are counted the same way, one per job from the last summary it printed, and reported beside the rate. They do not enter it.
- R12. The count records, per job type, the jobs with a call attempt, the jobs with none and the unknowns, and the table's `ok` and error totals.
- R13. If the rate is below 1 in 10, or no job could be counted, the next change removes the tools. That covers the server and its launcher, the two composite actions, their tests, the package export, the mutation-gate entries, the prompt text and the current documentation. The expansion command the server wraps goes too, since nothing else calls it. The baseline wiki and solutions queries stay.
- R14. If the rate is 1 in 10 or above, the tools stay and the count is recorded in this document.

---

## Acceptance Examples

- AE1. **Covers R2.** Given a pull request that changes code, the review job's prompt tells it to search documented solutions for the changed area before reviewing. Given an issue that is only triaged, the same prompt asks for no search.
- AE2. **Covers R3.** Given the daily Observe pass looking into a failure in one other tracked repository, its prompt tells it to search the wiki for that repository. Listing that repository in a coverage table asks for no search.
- AE3. **Covers R4.** Given a survey of a repository, each attempt's prompt tells it to search before writing, and none calls the tools optional.
- AE4. **Covers R9, R13.** Given 180 counted jobs and 12 with a call table, the rate is below 1 in 10 and the removal goes ahead.
- AE5. **Covers R9, R14.** Given 180 counted jobs and 25 with a call table, the tools stay.
- AE6. **Covers R11, R13.** Given 30 survey jobs that all made calls and 180 other counted jobs with 5 call tables, the rate is 5 in 180 and the removal goes ahead.
- AE7. **Covers R10.** Given a job whose summary prints `no call log found`, it is listed as unknown and is in neither the 180 nor the 12.

---

## Success Criteria

- Within 14 days the summary output shows either call attempts or their absence under a plain instruction, and the keep-or-remove decision follows from the count without further debate.
- A planner can write the change from this document without deciding which jobs get which duty, how usage is counted or what triggers removal.

---

## Scope Boundaries

- What the wiki context contains. The daily passes receive a wiki index and the pull request job receives none; that is covered by `docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md`, which ships with this change.
- The tools' behaviour, limits and descriptions.
- Retiring the solutions excerpt in favour of the tools.
- Judging whether a call improved the output. The rate counts call attempts, including errors and empty results. It decides whether the tools stay under this trial and says nothing about their usefulness.

---

## Key Decisions

- Named situations, not "always search": a call then signals that the situation arose, and cost stays bounded.
- The July rule that kept runs on the baseline is dropped. It was a cost rule, and the cost of a call was never measured. Recorded as completed in `docs/brainstorms/2026-07-07-a1-phase-3-deep-wiki-traversal-requirements.md`.
- The November requirements chose run logs over a call-volume baseline as evidence of use. This document keeps that measure and adds a threshold and a date. Recorded as completed in `docs/brainstorms/2026-11-06-agent-knowledge-mcp-tools-requirements.md` and `docs/plans/2026-11-06-001-feat-agent-knowledge-mcp-tools-plan.md`.
- No linked-pages tool: it is removed.
- Removal is decided now, with its trigger, so an unused server does not stay by default.
- Surveys stay out of the rate. Their duty is unconditional, so their calls show that the instruction was followed, and their volume alone could clear the threshold while reviews and the daily passes made no calls.

---

## Count Record (2026-11-28)

R14 applies: 89 of 157 counted jobs had a call attempt, 56.7%, so the tools stay. The window ran 2026-11-14T19:19Z to 2026-11-28T01:03Z (13.3 of 14 days); the remainder cannot change the verdict. Per kind (called / counted without unknowns): pull request 88/125, issue 0/2, comment none counted (agent step skipped on all 101 runs), Remediate 0/15, Observe 1/15. The `ok` total is 94 and the error total 0. Four jobs were unknown, all on the `isolate-agent/opt-in` probe branch before #4253. Surveys, beside the rate, had 28 of 30 jobs with calls. The full record and run IDs are in `docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md`, Unit 5.

Remediate made no call on either fix run (44474579642 and 45990614724) and Observe called once, so the operator dropped the Remediate and Observe search duties (R2 for those two jobs, and R3). The tools stay wired into both jobs. R2 stays for the pull request, issue and comment job; R4 stays for surveys.

---

## Dependencies / Assumptions

- The summary output distinguishes a call table, a started server with no calls, and a missing call log. A call log that could not be written looks like no calls, so the count can understate use.
- The three survey attempts share one call log and each attempt has its own summary step, so a survey job can print the same cumulative table up to three times.
- Step logs must still be readable when the count is taken. A log from 17 days earlier was readable on 2026-11-14; the repository's retention setting was not.
- The agent can already read `knowledge/` and `docs/solutions/` from disk in these jobs. A low call rate may therefore mean the agent reads files directly, which is a reason to remove the tools, not a failure of the prompt.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] Where each duty sits in the prompt so that it applies to the right jobs and triggers without repeating text.
- [Affects R9, R12][Technical] How the 14-day count is taken from step logs. The log also echoes the summary action's script source, so the count must match the step's output and not that source.

---

## Sources / Research

- Prompt text: `.github/workflows/fro-bot.yaml` (`wiki_context_expansion` and `knowledge_persistence` blocks in the three agent jobs) and `.github/workflows/survey-repo.yaml` (`knowledge_tools` block in each attempt).
- Tool descriptions: `packages/wiki-ops/src/knowledge-mcp.ts`.
- Summary step: `.github/actions/knowledge-mcp-summary/action.yaml`.
- Tests that pin the prompt text: `scripts/fro-bot-workflow-wiki-handoff.test.ts` (requires the word `optionally` today), `scripts/fro-bot-workflow.test.ts` (the solutions sentence) and `scripts/knowledge-mcp-callers.test.ts` (tool names per agent step). No test pins the survey's optional sentence.
- Volume, from run counts for 2026-11-08 to 2026-11-14: about 73 pull request runs, 10 issue runs, 7 scheduled runs and 16 survey runs a week.
