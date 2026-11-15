---
title: Inspect what a relevance search returned before you tune it
date: 2026-11-14
category: best-practices
module: packages/wiki-ops/src/wiki-index.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a search or ranking step supplies context to an agent
  - the search returns irrelevant results or misses the intended page
  - you plan to change ranking weights or match rules
  - the item being looked up may not exist in the corpus
tags:
  - relevance-scoring
  - agent-context
  - wiki
  - run-logs
  - selector-audit
  - empty-context
---

# Inspect what a relevance search returned before you tune it

## Context

Each agent job in `.github/workflows/fro-bot.yaml` started with a wiki excerpt of up to 5 KiB. A scorer chose the page. It gave points for each distinct word of three or more characters from the event that appeared in a page's identifier, title, tags or body. It dropped pages that scored zero and broke ties by title (`wiki-query.ts` at [`fa525df`](https://github.com/fro-bot/.github/blob/fa525df4f952471834bc6fe5d19ea89f34456c51/packages/wiki-ops/src/wiki-query.ts#L147-L166)). A page that mentions any of those words can qualify, so common words select an unrelated page. The scorer returned no page only when every page scored zero.

In pull request run [43607605007](https://github.com/fro-bot/.github/actions/runs/43607605007) the excerpt was `knowledge/wiki/repos/fro-bot--agent.md`, cut at 5,120 bytes. The six earlier pull request runs back to 43538493746 print the same path. In run [43562899904](https://github.com/fro-bot/.github/actions/runs/43562899904) the two daily agent jobs, Remediate and Observe, each got the first 5,120 bytes of `knowledge/wiki/topics/github-actions-ci.md`, a page whose body is about 433 KiB at `data` commit `07793bef`.

## Guidance

1. **Read what the search returned on real runs before you tune it.** The step printed `selectedPaths` and `byteLength` in its log. Those lines showed a page about another repository, and the head of one long topic page.
2. **Check that the thing you look up can exist.** An exact-identifier bonus of 1000 applied only to a page named `owner--repo` (`wiki-query.ts:150` at `fa525df`). For this repository that name is `fro-bot--github`, and no page has it. A bonus that cannot fire leaves weak word matches to decide.
3. **Test a proposed rule on real recent inputs before you build it.** Matching on tags fails on this corpus. `ci` is a tag of two unrelated pages, and `workflow` is a tag of two others. Matching a full title selects almost nothing (`docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md:20`). A list with tags is also too big: the wiki at `data` commit `07793bef` holds 826 tags, and `github-actions-ci` alone has 65.
4. **If no tested rule selects useful context, omit the lookup and tell the agent that no context was supplied.** Pull request runs now say `No wiki context is provided for this run.` (`.github/workflows/fro-bot.yaml:794`, pinned at `scripts/fro-bot-workflow.test.ts:2058`).
5. **Word a failure note as unavailable, not empty.** The status-line doc covers this: [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md).

## Why This Matters

A well-formed result does not prove that the selected page is relevant. The fault showed only in what a real run was handed: a page about another repository, in a slot the prompt calls context (`docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md:16-22`). Tuning the weights would have tuned toward a page that does not exist.

## When to Apply

- Before changing a ranking, a threshold or a weight that feeds an agent prompt.
- When a lookup key is built from names, and the corpus may lack the named thing.
- When a search result is printed in a log and nobody has read it.

## Examples

| Check | Result |
| --- | --- |
| Search for this repository, whose wiki page does not exist | A page about another repository matched on common words: run 43607605007 selected `fro-bot--agent.md`. |
| Inspect the result and check that the expected page exists | Report that no context was supplied, instead of tuning a bonus for a missing page. |

After the change, pull request runs get no wiki context. The two daily agent jobs get an index of every page; see [An inventory handed to an agent must say when it is partial](an-inventory-handed-to-an-agent-must-say-when-it-is-partial-2026-11-14.md).

## Related

- [Observability before structural change](observability-before-structural-change-2026-06-09.md): read live evidence before you add something permanent.
- [Enumerate every no-match path before narrowing a row matcher](enumerate-no-match-paths-before-narrowing-a-matcher-2026-10-10.md): a stricter match rule needs a check of what it matches on real inputs.
- [Requirements](../../brainstorms/2026-11-14-wiki-baseline-index-requirements.md) and [plan](../../plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md) for the index.
