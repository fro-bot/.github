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

The daily passes receive an index of the wiki: one line per page, `path | title | type | opening sentence`, within 12 KiB (`packages/wiki-ops/src/wiki-index.ts:1-8`, `MAX_INDEX_BYTES` at `:24`). A page can be left out for three reasons: its file cannot be read, its frontmatter cannot be parsed, or the size limit cuts it.

The plan set the one-line encoding of every field (`docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md:115`), and the first build ([`ddb01a6`](https://github.com/fro-bot/.github/blob/ddb01a6e4cd84a1fae5f00cb31e2e1f3468a70d9/packages/wiki-ops/src/wiki-index.ts#L286)) had it. The first build printed `Wiki index: 1 of 2 pages listed.` for one valid page and one page with invalid frontmatter, with nothing that said a page was missing, and its status line had no skipped count. Its prompt said that the index above lists the pages the wiki holds, in every state. The shipped build prints `Wiki index: 1 of 2 pages listed. 1 could not be read.` and `skipped=1`, and its prompt begins `When the wiki index above is available,` (commit [`3ab7962`](https://github.com/fro-bot/.github/commit/3ab796298c474fd4741dfd811f3812ec7f92225c) in PR #4232).

## Guidance

1. **Put the listed and held counts on the first line of the inventory.** `countLine` writes `Wiki index: <listed> of <held> pages listed.` (`wiki-index.ts:398-401`). The agent can see a gap without reading the lines.
2. **Count each way a member goes missing, and keep the sum exact.** `held` is `listed` plus `skipped` plus the pages the size limit cut (`wiki-index.ts:324`). The count line adds ` N could not be read.` when `N` is above zero. Tests pin `1 of 2 pages listed. 1 could not be read.` for a page with invalid frontmatter and for an unreadable file (`packages/wiki-ops/src/wiki-index.test.ts:502-525`). The status line carries the same count as `skipped=<n>` (`wiki-index.ts:451-455`; `wiki-index.test.ts:803-808`).
3. **Make every field one line of plain text.** `oneLine` turns each control character, line break and U+2028 or U+2029 into a space, collapses runs, and replaces `<`, `>` and `|` (`wiki-index.ts:273-287`). `encodePath` percent-encodes every byte outside `A-Z a-z 0-9 . _ - /` (`wiki-index.ts:294-303`). Tests show that a title with line breaks and a file name with a control character each give one line, and that a title cannot forge a count line or the incomplete marker (`wiki-index.test.ts:415-429`, `:431-439`, `:535-550`).
4. **Make the prompt sentence true in every state.** The daily prompts begin `When the wiki index above is available,` (`.github/workflows/fro-bot.yaml:1077-1080` and `:1287-1290`; pinned at `scripts/fro-bot-workflow-wiki-handoff.test.ts:46` and `:199`). When the index cannot be built, the prompt holds the unavailable note instead (`.github/workflows/fro-bot.yaml:118-119`).
5. **Say what the agent's other tools read.** The index describes the wiki on `data`. In Remediate, reading a page from disk and `knowledge_wiki_search` both use the checkout, which may hold an older copy or lack a listed page (`.github/workflows/fro-bot.yaml:1081-1083`; pinned at `scripts/fro-bot-workflow-wiki-handoff.test.ts:49`).

## Why This Matters

An agent reads an inventory as the whole set unless the inventory says otherwise. A silent skip reads as a page that does not exist, and a title with a line break can add a line that looks like a count. Rules 1 and 2 give the agent and the reader of the log the same numbers. Rule 3 keeps text that the wiki's authors wrote from becoming structure. Rules 4 and 5 stop the prompt from contradicting the listing it introduces.

## When to Apply

- When a prompt lists files, pages, repositories or tools gathered from disk or an API.
- When the list has a size limit or skips members it cannot read.
- When a field is a title, a name or a sentence taken from the corpus.

## Examples

The Observe prompt before and after the fix (`.github/workflows/fro-bot.yaml` in `3ab7962`):

```diff
-The wiki index above lists the pages the wiki holds: each line gives the path, title
-and type of a page, and its opening sentence when it has one. Read a page from disk,
-or find one with `knowledge_wiki_search`.
+When the wiki index above is available, each line gives a page's path, title and
+type, and its opening sentence when it has one, and the first line says how many
+pages it lists out of how many the wiki holds. Read a page from disk, or find one
+with `knowledge_wiki_search`.
```

A title with a line break stays on its page line:

<!-- verify: oneLine from packages/wiki-ops/src/wiki-index.ts -->
```ts
import {oneLine} from '@fro-bot/wiki-ops/wiki-index'

function pageLine(path: string, title: string, type: string): string {
  return `${path} | ${oneLine(title)} | ${type}`
}
```

With one valid page and one page with invalid frontmatter, the count line and the status line read:

```text
Wiki index: 1 of 2 pages listed. 1 could not be read.
wiki-index: listed=1 held=2 skipped=1 sentences=kept bytes=<n>
```

## Related

- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): one fixed line per state; the rules for the status line are there.
- [Replace copied parsers with one contract that returns a tagged result](replace-copied-parsers-with-one-contract-that-returns-a-tagged-result-2026-11-12.md): the frontmatter splitter the index reads through.
- [Plan](../../plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md), Unit 2.
