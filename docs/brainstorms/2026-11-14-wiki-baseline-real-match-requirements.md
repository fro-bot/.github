---
date: 2026-11-14
topic: wiki-baseline-real-match
---

# Hand Over a Wiki Page Only When It Matches

## Summary

The wiki baseline gives a job a page only when the page is about the repository being worked on, or is a topic the event names. Otherwise it gives nothing. The daily passes get a short index of every wiki page in place of an excerpt from one topic. The step log shows what was selected.

---

## Problem Frame

Each agent job in `.github/workflows/fro-bot.yaml` receives a wiki excerpt of up to 5 KiB, chosen by `packages/wiki-ops/src/wiki-query.ts`. In every run measured, the excerpt was one page, cut at the cap.

The page is often the wrong one. Each query word found anywhere in a page body adds to its score, so long pages win. For a pull request in this repository the `fro-bot/agent` page and the GitHub Actions topic page tie, and the tie is broken alphabetically. The wiki has no page about this repository, which is not a surveyed repository, so no page is right. In 30 reviewed pull requests the reviews cited no wiki page.

The daily passes have no event to select with. They receive the first 5 KiB of the GitHub Actions topic page, which is its six most recent dated notes. Those passes work across every tracked repository and get no view of what else the wiki holds.

Nothing records which page a run received. The step writes the selected paths to an output that no workflow reads.

The wiki has 48 pages. Repository pages have a median body of 84 KB. `knowledge/index.md` is 255 KB, about 5 KB per entry, and pages have no summary field, so no compact list of the wiki exists today.

---

## Requirements

**Selection for pull request, issue and comment runs**

- R1. A repository page is handed over only when it is the page of the repository the event belongs to.
- R2. A topic or entity page is handed over only when the event's title names it, by the page's title, an alias or a tag.
- R3. A match on body text alone never selects a page. An owner name or repository name alone never selects a topic or entity page.
- R4. When no page qualifies, the job receives no wiki excerpt, and its prompt says that no wiki page matched.
- R5. An excerpt keeps today's 5 KiB limit.

**Index for the daily passes**

- R6. Remediate and Observe receive an index of every wiki page in place of an excerpt, on scheduled and dispatched runs alike.
- R7. Each index line gives the page's path, title, type and tags, and its first sentence when the page opens with one.
- R8. The index carries no page body.
- R9. The index has its own size limit of 12 KiB. When the full index would exceed it, first sentences are dropped before any page is left out, and the index says how many pages it lists and how many exist.
- R10. The prompt tells the agent that the index lists what the wiki holds, and that a page is read from disk or found with the wiki search tool.

**Visibility**

- R11. The step log states what the job received: the selected paths, that nothing matched, or the number of pages indexed, each with its size in bytes.

**Unchanged**

- R12. The documented-solutions baseline is unchanged.
- R13. Survey runs still receive no wiki baseline.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R4.** Given a pull request in this repository that changes workflow files, the job receives no wiki excerpt and its prompt says none matched. The `fro-bot/agent` page is not selected.
- AE2. **Covers R1.** Given a run whose event belongs to a surveyed repository, the job receives that repository's page, cut at 5 KiB.
- AE3. **Covers R2.** Given an issue in this repository titled about Probot settings, the job receives the Probot settings topic page.
- AE4. **Covers R3.** Given a pull request whose body mentions "GitHub Actions" many times and whose title does not, the GitHub Actions topic page is not selected.
- AE5. **Covers R6, R7, R8.** Given the scheduled daily run, Remediate and Observe each receive one line per wiki page and no page body.
- AE6. **Covers R9.** Given an index that would be 15 KiB with first sentences, the sentences are dropped, every page is still listed, and the index states the counts.
- AE7. **Covers R11.** Given AE1, the step log says nothing matched. Given AE5, it gives the page count and byte size.

---

## Success Criteria

- A pull request in this repository no longer receives a page about another repository, shown by the step log of the first runs after the change.
- The daily passes can see every page the wiki holds, shown by the page count in their step logs.
- A planner can build this without deciding what counts as a match, what an index line holds or what happens at the size limits.

---

## Scope Boundaries

- `knowledge/index.md`. The baseline index is built when the query runs and does not read or change that file.
- A summary field in page frontmatter, written by the survey. The index is derived from what pages already contain.
- Surveying this repository so that it has a page.
- The knowledge tools, their limits and their descriptions.
- Whether an index line or an excerpt was used by the agent. This change makes the selection visible; it does not measure use.

---

## Key Decisions

- Nothing is better than the wrong page. An off-topic excerpt costs tokens on every run and can mislead.
- The index is derived from title, type, tags and first sentence. This needs no schema change, no writer change and no backfill. Topic pages, which open with dated notes, will show title and tags only.
- The daily passes get the index alone. They have no event that names a page, and they can read any page from disk.
- The linked-pages tool has nothing to expand from when no page is selected. No prompt gives it a duty, so this is accepted.
- This ships together with the knowledge-tool prompt duties in `docs/brainstorms/2026-11-14-knowledge-tools-prompt-duties-requirements.md`, and that document's 14-day count starts from the shared merge date. Changing what the agent starts with during the count would make its result hard to read.
- The 5 KiB limit and type-priority ranking come from the original control-plane plan, recorded as completed in `docs/plans/2025-04-15-001-feat-frobot-control-plane-plan.md`. The limit stays for excerpts. Body-text scoring was never part of that plan's stated intent.

---

## Dependencies / Assumptions

- The `knowledge/` tree is on disk in these jobs, so a page named in the index can be read.
- Every wiki page is public by the wiki's own rule, so listing every title and path adds no exposure. The baseline applies no privacy filter today and gains none here.
- Remediate restores `knowledge/` to `main` before its agent runs, while the baseline is built from `data`. An index line can therefore name a page that Remediate's checkout lacks or holds in an older form.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] The exact matching rule for titles, aliases and tags, including which generic words never count. AE1, AE3 and AE4 are the fixtures it must satisfy.
- [Affects R7][Technical] What counts as a page's first sentence, and how a page that opens with a heading or a list is handled.
- [Affects R4, R10][Technical] Where the "no page matched" and index wording sit in the prompt, given the three jobs share one block.
- [Affects R11][Technical] Whether the step-log line goes through the existing warning router or is printed directly.

---

## Sources / Research

- Selection and scoring: `packages/wiki-ops/src/wiki-query.ts` (`collectTokens`, `scorePage`, `baseTypeWeight`, the cut-at-limit loop).
- Consumers of the baseline's shape: the `Query wiki context` steps and `WIKI_CONTEXT` in `.github/workflows/fro-bot.yaml`; the handoff read by `packages/wiki-ops/src/wiki-context-expand.ts`; `packages/wiki-ops/src/wiki-query.test.ts`, `packages/wiki-ops/src/wiki-query-bad-page.test.ts`, `scripts/wiki-ops-flows.test.ts` and `scripts/fro-bot-workflow-wiki-handoff.test.ts`.
- `wiki-query.ts` is recorded in `mutation-guards.json` as outside the mutation set.
- Scores for three inputs against the wiki on `data`: a workflow pull request here selects `repos/fro-bot--agent.md` on a tie with `topics/github-actions-ci.md`; a `wiki-write-core` pull request selects `repos/fro-bot--agent.md`; the scheduled run selects `topics/github-actions-ci.md`.
