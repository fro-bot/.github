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
  - delete
  - rename
---

# Search for every consumer before a plan orders units that delete

## Context

The plan for the wiki index splits its work into units. A unit is a separately mergeable change that must pass checks on its own. The plan removes the `wiki_linked` tool first so that "each unit is green alone" (`docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md:109`). Its first draft listed files per unit from memory. A search for each removed name corrected the lists in [`920bf85`](https://github.com/fro-bot/.github/commit/920bf855cb44e593578aa768291e975a61657fb1), a commit in the commit list of PR #4232. In the text below, "the parent" is `fa525df`, the commit before that merge.

## Guidance

1. **Before you schedule a deletion or rename, search the repository for its symbol, path, workflow step, output, environment variable and diagnostic text. Include tests, fixtures, configuration and documentation in the results.** The function `writeSelectedPathsHandoff`, which wrote the selected page paths to a file for a later step, had two importing tests at the parent: `packages/wiki-ops/src/wiki-query.test.ts:12-14` and `packages/wiki-ops/src/wiki-context-expand.test.ts:7`. The first was missing from Unit 1's first list.
2. **Search for text consumers, not only imports.** At the parent, a guard test read the warning kinds a module can write from its source text (`packages/wiki-ops/src/route-stderr-prefixes.test.ts:295` read `packages/wiki-ops/src/wiki-query.ts`). No import connects them. Unit 1 now says that the guard changes with the warning kind (plan line 176).
3. **Update a fixture in the same change that changes the file or step names it reads.** At the parent, `packages/wiki-ops/fixtures/route-stderr-workflow-steps.ts:74-77` loaded `.github/workflows/fro-bot.yaml`, and `:80` found each step by job and step name. On `main` it names the `Build wiki index` steps (`:103-104`), so it cannot move before the workflow has them. The plan puts it in Unit 3 (plan line 282).
4. **List documents that no check follows.** At the parent, `llms.txt:42` linked the module that the plan deletes. At that time the link check read root `*.md` files and `docs/**/*.md` only, and no script, test or workflow named `llms.txt`, so no check read that link. The plan fixes it in Unit 3 (plan line 282). [#4237](https://github.com/fro-bot/.github/pull/4237) later added the root `llms.txt` to the link check.
5. **Check that each path in a list exists.** The first draft named `scripts/route-stderr-prefixes.test.ts`. The test lives at `packages/wiki-ops/src/route-stderr-prefixes.test.ts`.

## Why This Matters

A unit that is "green alone" is a claim about every consumer. A file list written from memory holds the consumers that the author remembers. The missing ones fail in CI one unit later than the unit that broke them, or they fail nowhere because no check covers them (rule 4).

## When to Apply

- When a plan removes or renames something and splits the work into units.
- When a test reads a module's text, a workflow's YAML or a generated file.
- When a link, list or table sits in a file that no lint reads.

## Examples

At the parent, the names that the removal deletes occur in 20 files outside `docs/`:

```sh
git grep -l -E "writeSelectedPathsHandoff|handoff-write-failed|WIKI_CONTEXT_HANDOFF_PATH|handoff-path" fa525df -- . ':!docs'
```

Inspect every match. A text search also finds references that a later change will handle, and those decide the order of the units as much as the file lists.

## Related

- [An import closure does not see what a test reads at run time](an-import-closure-does-not-see-what-a-test-reads-at-run-time-2026-11-14.md): tests that read files at run time are invisible to a search that follows imports.
- [Safely deleting a superseded workflow or signal path](../workflow-issues/safe-superseded-workflow-removal-2026-06-24.md): callers and shared dependencies are confirmed before a deletion.
- [Plan](../../plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md).
