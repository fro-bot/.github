---
title: An inventory handed to an agent must say when it is partial
date: 2026-11-14
category: best-practices
module: packages/wiki-ops/src/wiki-index.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a job lists the members of a corpus in an agent prompt
  - a member can be skipped (unreadable) or cut (size limit) without failing the job
  - a listed field comes from user-authored text such as a title or a file name
  - prompt text describes the listing
tags:
  - agent-context
  - wiki-index
  - inventory
  - untrusted-text
  - prompt-contract
  - single-line-fields
---

# An inventory handed to an agent must say when it is partial

## Context

The two daily agent jobs, Remediate and Observe, receive an index of the wiki: one line per page, `path | title | type | opening sentence`, within 12 KiB (`packages/wiki-ops/src/wiki-index.ts:1-8`, `MAX_INDEX_BYTES` at `:24`). A page can be left out for three reasons: its file cannot be read, its metadata (the block at the start of the page) is invalid, or the size limit cuts it.

The first index listed one of two pages without saying why the other was missing, and its prompt described the list as complete. The shipped index reports `1 could not be read` and `skipped=1`, and its prompt allows for an unavailable index. The fix is commit [`3ab7962`](https://github.com/fro-bot/.github/commit/3ab796298c474fd4741dfd811f3812ec7f92225c).

## Guidance

1. **Show how many items the list contains and how many exist.** The first line reads `Wiki index: <listed> of <held> pages listed.` (`countLine`, `wiki-index.ts:398-401`). The agent sees a gap without reading the lines.
2. **Report omitted items by cause, and make the counts add up.** `held` is `listed` plus `skipped` plus the pages the size limit cut (`wiki-index.ts:324`). The count line adds ` N could not be read.` when `N` is above zero, and the status line carries `skipped=<n>` (`wiki-index.ts:451-455`). "Could not be read" covers an unreadable file and invalid metadata, not only a failed read (`SkippedPageReason`, `:308`). Tests pin both causes (`packages/wiki-ops/src/wiki-index.test.ts:502-525`).
3. **If a field can contain text someone else wrote, escape separators and line breaks so it cannot create a fake entry.** `oneLine` turns each control character, line break and U+2028 or U+2029 into a space, and replaces `<`, `>` and `|` (`wiki-index.ts:273-287`). `encodePath` percent-encodes every byte outside `A-Z a-z 0-9 . _ - /` (`wiki-index.ts:294-303`). The plan set this rule before the first build (`docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md:115`). Tests cover a title with line breaks, a file name with a control character and a title that imitates the count line (`wiki-index.test.ts:415-429`, `:431-439`, `:535-550`).
4. **Make the prompt's description true in every state.** The prompts of the two daily agent jobs begin `When the wiki index above is available,` (`.github/workflows/fro-bot.yaml:1077-1080` and `:1287-1290`). When the index cannot be built, the prompt holds the unavailable note instead (`.github/workflows/fro-bot.yaml:118-119`). Tests pin the sentence (`scripts/fro-bot-workflow-wiki-handoff.test.ts:46` and `:199`).
5. **When the list and the tools that read the listed items may see different copies, say so.** Here the index describes the wiki on the `data` branch. In Remediate, reading a page from disk and `knowledge_wiki_search` both use the checkout, which may hold an older copy or lack a listed page (`.github/workflows/fro-bot.yaml:1081-1083`, pinned at `scripts/fro-bot-workflow-wiki-handoff.test.ts:49`).

## Why This Matters

An agent reads an inventory as the whole set unless the inventory says otherwise. A silent skip reads as a page that does not exist, and a title with a line break can add a line that looks like a count. Rules 1 and 2 give the agent and the reader of the log the same numbers. Rule 3 keeps text written by the wiki's authors from becoming structure. Rules 4 and 5 stop the prompt from contradicting the listing it introduces.

## When to Apply

- When a prompt lists files, pages, repositories or tools gathered from disk or an API.
- When the list has a size limit or skips members it cannot read.
- When a field is a title, a name or a sentence taken from the corpus.

## Examples

The opening sentence of the Observe prompt, before and after the fix (`.github/workflows/fro-bot.yaml` in `3ab7962`):

```diff
-The wiki index above lists the pages the wiki holds:
+When the wiki index above is available,
```

With one valid page and one page with invalid metadata, the count line and the status line read:

```text
Wiki index: 1 of 2 pages listed. 1 could not be read.
wiki-index: listed=1 held=2 skipped=1 sentences=kept bytes=<n>
```

| Input | Output |
| --- | --- |
| A title that contains line breaks and a copy of the count line | One page line: `x Wiki index: 1 of 1 pages listed. Index incomplete…` |
| A file name `a⏎b \| c<NUL>d.md` | `knowledge/wiki/topics/a%0Ab%20%7C%20c%00d.md \| Hostile \| topic` |

## Related

- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): one fixed line per state; the rules for the status line are there.
- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): the metadata splitter the index reads through.
- [Plan](../../plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md), Unit 2.
