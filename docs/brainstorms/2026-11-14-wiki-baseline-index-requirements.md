---
date: 2026-11-14
topic: wiki-baseline-index
---

# Replace the Wiki Excerpt with an Index for the Daily Passes

## Summary

Pull request, issue and comment runs stop receiving a wiki excerpt. The daily passes receive a short index of every wiki page in place of an excerpt from one topic. The code that scores pages and cuts an excerpt is removed, along with the linked-pages tool that expanded from it. The step log shows what the daily passes received.

---

## Problem Frame

The three agent jobs in `.github/workflows/fro-bot.yaml` each receive a wiki excerpt of up to 5 KiB, chosen by `packages/wiki-ops/src/wiki-query.ts`. In every run measured, the excerpt was one page, cut at the limit.

The page is often the wrong one. Each query word that appears in a page body adds to its score, so long pages win. For a pull request in this repository the `fro-bot/agent` page and the GitHub Actions topic page tie, and the tie is broken alphabetically. The wiki has no page about this repository, which has never been surveyed, so no page is right. In 30 reviewed pull requests the reviews cited no wiki page.

A stricter rule does not rescue the excerpt. Matching on tags selects unrelated pages: recent titles with a `ci` scope match the Polyglot Monorepo page, and "workflow" matches OpenCode Plugin Development. Matching only on a page's full title or alias selects almost nothing. A repository's own page cannot be selected either, because no surveyed repository runs this job.

The daily passes have no event to select with. They receive the first 5 KiB of the GitHub Actions topic page, which is its six most recent dated notes. They work across every tracked repository and get no view of what else the wiki holds.

The wiki has 48 pages. `knowledge/index.md` is 255 KB, about 5 KB per entry, and pages have no summary field, so no compact list of the wiki exists. Pages carry 826 tags between them. A list with tags does not fit 12 KiB even with nothing else on each line.

---

## Requirements

**Pull request, issue and comment runs**

- R1. These runs receive no wiki excerpt and no wiki index.
- R2. Their prompt says that no wiki context is provided for the run.

**Index for the daily passes**

- R3. Remediate and Observe receive an index of every wiki page whenever either job runs, custom dispatches included.
- R4. Each index line gives the page's path, title and type, and its opening sentence when it has one.
- R5. The opening sentence is the only text taken from a page body. It is the one complete prose sentence directly after the page's top heading. A page that opens with a heading, list, table or code block has none.
- R6. The index does not list tags.
- R7. Pages are listed in a fixed order, so the same wiki gives the same index.
- R8. The index has a size limit of 12 KiB. When the full index would exceed it, every opening sentence is dropped. If it still exceeds the limit, the index lists the pages that fit, in order, and says it is incomplete.
- R9. The index states how many pages it lists and how many the wiki holds.
- R10. The prompt tells the agent that the index lists what the wiki holds, and that a page is read from disk or found with the wiki search tool.
- R11. When the index cannot be built, the prompt says the wiki index was unavailable. It does not say the wiki is empty.
- R12. In Remediate, the prompt says the index reflects the wiki on `data` and that the checkout may hold an older copy of a listed page or lack it.

**Removed**

- R13. Page scoring, the excerpt and its 5 KiB limit, and the hand-off of selected pages are removed.
- R14. The linked-pages tool is removed from the server and from every prompt. It expanded from the selected pages, and none are selected any more.

**Visibility**

- R15. The step log of each daily pass has one line stating what the job received: the number of pages listed, the number in the wiki, whether opening sentences were kept, and the size in bytes. When the index was unavailable, the line says so.

**Unchanged**

- R16. The documented-solutions baseline is unchanged in all three jobs.
- R17. Survey runs still receive no wiki baseline.
- R18. The wiki search tool and the solutions search tool are unchanged.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a pull request in this repository that changes workflow files, the job receives no wiki text, and its prompt says none is provided. The documented-solutions excerpt is still there.
- AE2. **Covers R3, R4, R6.** Given the scheduled daily run against today's wiki, Remediate and Observe each receive 48 lines with path, title and type, and no tags.
- AE3. **Covers R5.** Given a repository page whose top heading is followed by a prose sentence, its line ends with that sentence. Given a topic page whose top heading is followed by a dated sub-heading, its line has no sentence.
- AE4. **Covers R8, R9.** Given an index that would be 15 KiB with opening sentences and 9 KiB without, the sentences are dropped, all pages are listed, and the counts are equal.
- AE5. **Covers R8, R9.** Given an index that would be 14 KiB even without opening sentences, it lists the pages that fit, says it is incomplete, and gives both counts.
- AE6. **Covers R11, R15.** Given a wiki tree that cannot be read, the prompt says the index was unavailable, and the step log says the same.
- AE7. **Covers R14.** Given any agent job, its prompt names the wiki search and solutions search tools and no linked-pages tool, and the server lists two tools.

---

## Success Criteria

- A pull request in this repository no longer starts from a page about another repository.
- The daily passes can see every page the wiki holds, shown by equal counts in their step logs on the first runs after the change.
- A planner can build this without deciding what an index line holds, what happens at the size limit, or what each job's prompt says about wiki context.

---

## Scope Boundaries

- `knowledge/index.md`. The index is built when the daily pass starts and does not read or change that file.
- A summary field in page frontmatter, written by the survey.
- Surveying this repository so that it has a page.
- Handing a repository's own page to a job that runs for that repository. No such job exists. A page lookup can be added when one does.
- Whether the agent used an index line. This change makes what was handed over visible; it does not measure use.

---

## Key Decisions

- Nothing is better than the wrong page. For runs in this repository no wiki page is right, and the documented-solutions baseline already supplies what reviews cite.
- The excerpt is removed, not repaired. No matching rule tested against recent titles both selects useful pages and avoids unrelated ones.
- The index is derived from path, title, type and opening sentence. This needs no schema change, no writer change and no backfill. About two thirds of pages open with a usable sentence.
- Tags are left out. They are what makes the list too large, and they are too generic to help a reader choose a page.
- The linked-pages tool goes with the excerpt. It has no input once no page is selected, and no prompt gave it a duty.
- This ships together with the knowledge-tool prompt duties in `docs/brainstorms/2026-11-14-knowledge-tools-prompt-duties-requirements.md`, and that document's 14-day count starts from the shared merge date.
- The 5 KiB limit and type-priority ranking come from the original control-plane plan, recorded as completed in `docs/plans/2025-04-15-001-feat-frobot-control-plane-plan.md`.

---

## Dependencies / Assumptions

- The `knowledge/` tree is on disk in the daily passes, so a page named in the index can be read.
- The wiki is public-only by its own rule. That rule is enforced for repository pages and rests on authoring discipline elsewhere. Listing every path and title exposes nothing a page excerpt could not already expose.
- By the measured sizes, 48 lines without tags come to roughly 5 to 7 KiB with opening sentences. That figure is an estimate; the limit and R8 hold whatever the real size is.
- The companion prompt change describes the linked-pages tool and calls the excerpt "the baseline context above". Both lines change with this work.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] How the opening sentence is found without splitting an abbreviation or a Markdown link, and its maximum length.
- [Affects R2, R10, R11][Technical] Where the wording sits, given the three jobs share one prompt block today.
- [Affects R13][Technical] Which of the query module, its command and its outputs remain as the index builder, and which tests that pin excerpt sizes are replaced.
- [Affects R14][Technical] Whether the expansion command behind the linked-pages tool keeps a purpose once the tool is gone. The wiki search tool uses the same module.
- [Affects R15][Technical] The step-log line must not be confused with the JSON the step already prints.

---

## Sources / Research

- Selection and scoring: `packages/wiki-ops/src/wiki-query.ts`. The step already prints the selected paths and byte length as JSON to its log.
- Consumers: the `Query wiki context` steps and `WIKI_CONTEXT` in `.github/workflows/fro-bot.yaml`; the hand-off read by `packages/wiki-ops/src/wiki-context-expand.ts`; the tools in `packages/wiki-ops/src/knowledge-mcp.ts`.
- Tests that pin today's shape: `packages/wiki-ops/src/wiki-query.test.ts`, `wiki-query-bad-page.test.ts`, `wiki-query-reason.test.ts`, `wiki-query-route.test.ts` and `wiki-context-expand.test.ts`; `scripts/wiki-ops-flows.test.ts`, `scripts/fro-bot-workflow-wiki-query.test.ts`, `scripts/fro-bot-workflow-wiki-handoff.test.ts` and `scripts/knowledge-mcp-callers.test.ts`.
- `wiki-query.ts` is outside the mutation set, but a change to it starts the mutation gate, because a command module imports it. `knowledge-mcp.ts` is in the mutation set.
- Measured against the wiki on `data`: 48 pages; a list of path, title, type and tags is 14.0 KB, and 16.7 KB with opening sentences; 23 of 33 repository pages, 9 of 12 topic pages and 3 of 3 entity pages open with a usable sentence.
- Jobs and triggers: the `fro-bot` job runs on pull request, issue and comment events only. Remediate runs on the schedule and on dispatches. Observe runs on the schedule and on working-directory dispatches.
