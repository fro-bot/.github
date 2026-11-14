---
title: Search for every consumer before a plan orders units that delete
date: 2026-11-14
category: best-practices
module: docs/plans
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - a plan splits a removal or rename into units that must each pass CI alone
  - a unit deletes a symbol, a module, a step name, an env name or a warning kind
  - a test or fixture reads source text or the real workflow YAML
  - a file lists links that no check follows
tags:
  - planning
  - consumer-search
  - unit-ordering
  - fixtures
  - guard-tests
  - llms-txt
---

# Search for every consumer before a plan orders units that delete

## Context

The plan for the wiki index states that `wiki_linked` goes first so that "each unit is green alone" (`docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md:109`). Its first draft ([`30f83f9`](https://github.com/fro-bot/.github/commit/30f83f978acc08e277c03d673f84fa206fe3ec6c)) listed files per unit from memory. The next commit ([`920bf85`](https://github.com/fro-bot/.github/commit/920bf855cb44e593578aa768291e975a61657fb1)) and one that followed ([`56998a7`](https://github.com/fro-bot/.github/commit/56998a7df4f00c3673f038584fd1f872731382f9)) corrected the lists. The squash merge dropped these commits from `main`; they stay in the commit list of PR #4232 and at `refs/pull/4232/head`. "The parent" below is `fa525df`, the commit before that merge.

## Guidance

1. **Search the tree for each thing a unit removes before you write the unit's file list.** The hand-off writer `writeSelectedPathsHandoff` had two importing tests at the parent (`packages/wiki-ops/src/wiki-query.test.ts:12-14` and `packages/wiki-ops/src/wiki-context-expand.test.ts:7`). The first was not in Unit 1's list. `920bf85` added four test files to Unit 1: `wiki-query.test.ts`, `wiki-query-route.test.ts`, `route-stderr-prefixes.test.ts` and `scripts/wiki-ops-flows.test.ts`.
2. **Search for text consumers, not only imports.** At the parent, a guard test read the warning kinds a module can write from its source text (`packages/wiki-ops/src/route-stderr-prefixes.test.ts:295` read `packages/wiki-ops/src/wiki-query.ts`). Removing the `handoff-write-failed` kind changes what that guard finds, with no import involved. Unit 1 now says the guard is updated with the kind (plan line 176).
3. **Move a fixture in the same unit as the file it reads.** At the parent, `packages/wiki-ops/fixtures/route-stderr-workflow-steps.ts:74-77` loaded `.github/workflows/fro-bot.yaml` and `:80` found each step by job and step name. On `main` the same fixture names the `Build wiki index` steps (`:103-104`), so it cannot describe them before the workflow has them. `920bf85` moved it from Unit 2 to Unit 3 (plan line 282).
4. **List documents that no check follows.** At the parent, `llms.txt:42` linked the deleted query module. The link check reads only root `*.md` files and `docs/**/*.md` (`packages/ci-checks/src/check-md-links.ts:13` and `:30-44`), and no script, test or workflow under `scripts/`, `packages/` or `.github/` names `llms.txt`. On 2026-11-14 no check read that link. In the first draft `llms.txt` sat in Unit 4, after Unit 3 deleted its target. The plan now lists it in Unit 3 (plan line 282).
5. **Check that each path in a list exists.** The first draft named `scripts/route-stderr-prefixes.test.ts`. The test lives at `packages/wiki-ops/src/route-stderr-prefixes.test.ts` (fixed in `920bf85` and `56998a7`).
6. **Search by every name a removal has.** Symbol, path, step id, output name, env name and warning kind each have their own consumers.

## Why This Matters

A unit that is "green alone" is a claim about every consumer. A file list written from memory holds the consumers that the author remembers. The missing ones fail in CI, one unit later than the unit that broke them, or they fail nowhere because no check covers them (rule 4).

## When to Apply

- When a plan removes or renames something and splits the work into units.
- When a test reads a module's text, a workflow's YAML or a generated file.
- When a link, list or table sits in a file that no lint reads.

## Examples

At the parent, the removed hand-off names occur in 20 files outside `docs/`:

```sh
git grep -l -E "writeSelectedPathsHandoff|handoff-write-failed|WIKI_CONTEXT_HANDOFF_PATH|handoff-path" fa525df -- . ':!docs'
```

The first draft of Unit 1 named 9 test files. After the search it names 12, including the four above (plan line 169 on `main`). The grep also matches files that the plan deletes in Unit 3, which is why the search shapes the order of units as well as the lists.

## Related

- [An import closure does not see what a test reads at run time](an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md): tests that read files at run time are invisible to a search that follows imports.
- [Safely deleting a superseded workflow or signal path](../workflow-issues/safe-superseded-workflow-removal-2026-06-24.md): callers and shared dependencies are confirmed before a deletion.
- [Plan](../../plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md).
