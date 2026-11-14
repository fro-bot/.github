---
title: A relevance scorer always returns something, so read what it returned
date: 2026-11-14
category: best-practices
module: packages/wiki-ops/src/wiki-index.ts
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - a job injects the top-ranked item of a corpus into an agent prompt
  - you are about to tune weights or add a match rule to a selector
  - the item a selector should find may not exist in the corpus
tags:
  - relevance-scoring
  - agent-context
  - wiki
  - run-logs
  - empty-context
  - selector-audit
---

# A relevance scorer always returns something, so read what it returned

## Context

Each agent job in `.github/workflows/fro-bot.yaml` started with a wiki excerpt of up to 5 KiB, chosen by a scorer. A pull request excerpt was usually a page about another repository. Run [43607605007](https://github.com/fro-bot/.github/actions/runs/43607605007) got `knowledge/wiki/repos/fro-bot--agent.md`, cut at 5,120 bytes, and the six earlier pull request runs back to 43538493746 print the same path. Both daily passes in run [43562899904](https://github.com/fro-bot/.github/actions/runs/43562899904) (the Remediate and Observe jobs) got the first 5,120 bytes of `knowledge/wiki/topics/github-actions-ci.md`, a page whose body is about 433 KiB at `data` commit `07793bef`.

This repository has no wiki page. `metadata/repos.yaml` on `data` lists `.github` only for `marcusrbrown` and `bfra-me`, and `knowledge/wiki/repos/` has no `fro-bot--github.md`.

## Guidance

1. **Read what the selector picked on real runs before you tune it.** The step printed `selectedPaths` and `byteLength` in its log. The pull request run's line names a page about another repository, and the daily run's line names the head of one long topic page.
2. **Read the formula for what it cannot refuse.** For each distinct token of three or more characters from the event, `scorePage` added 25 for a slug hit, 15 for a title hit, 10 for a tag hit and 4 for a hit anywhere in the body, plus a type weight (`wiki-query.ts` at [`fa525df`](https://github.com/fro-bot/.github/blob/fa525df4f952471834bc6fe5d19ea89f34456c51/packages/wiki-ops/src/wiki-query.ts#L147-L198), lines 147-180 and 190-198). Only a score of 0 dropped a page (lines 161-163 and 67), ties went to title order (line 68) and the output was cut at 5 KiB (line 14). A page that mentions any token is a candidate, so something is always chosen.
3. **Ask whether the thing you look up can exist.** The exact-slug bonus of 1000 (line 150) is for `owner--repo`. For this repository that slug is `fro-bot--github`, and no page has it. A bonus that cannot fire leaves the weak terms to decide.
4. **Test a proposed rule on real inputs before you build it.** Matching on tags fails on this corpus: `ci` is a tag of `polyglot-monorepo` and `security-remediation-integration`, and `workflow` is a tag of `opencode-plugins` and `marcusrbrown--systematic`. Matching a page's full title selects almost nothing (`docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md:20`). Tags also made a list too big: the wiki at `data` commit `07793bef` holds 826 tags, and `github-actions-ci` alone has 65.
5. **When no rule passes, remove the lookup and say that nothing was provided.** Pull request runs now carry `No wiki context is provided for this run.` (`.github/workflows/fro-bot.yaml:794`, pinned at `scripts/fro-bot-workflow.test.ts:2058`).
6. **Word the failure note as unavailable, never empty.** When the daily-pass index cannot be built, the prompt says the index was unavailable (`.github/workflows/fro-bot.yaml:118-119`). A test rejects the words `empty`, `no pages` and `nothing` in that note (`scripts/fro-bot-workflow-wiki-index.test.ts:138-141`).

## Why This Matters

A scorer with an unconditional output passes every test that checks the output is well formed. The fault shows only in what a real run was handed: a page about another repository, in a slot the prompt calls context (`docs/brainstorms/2026-11-14-wiki-baseline-index-requirements.md:16-22`). Tuning weights would have tuned toward a page that does not exist.

## When to Apply

- Before changing a ranking, a threshold or a weight that feeds an agent prompt.
- When a lookup key is built from names, and the corpus may lack the named thing.
- When a selector's result is printed in a log and nobody has read it.

## Examples

Before, the selector's output was a page chosen by token hits. In the daily passes it was the head of one long page. After, the daily passes build an index of every page, and a build that lists nothing is reported as unavailable. The function below returns the status line for each state.

<!-- verify: assembleWikiIndex from packages/wiki-ops/src/wiki-index.ts -->
<!-- verify: statusLine from packages/wiki-ops/src/wiki-index.ts -->
```ts
import {assembleWikiIndex, statusLine, type WikiTree} from '@fro-bot/wiki-ops/wiki-index'

function describeWikiIndex(tree: WikiTree): string {
  // `undefined` means no page could be listed. The line then says `unavailable`, not `empty`.
  return statusLine(assembleWikiIndex(tree))
}
```

```text
wiki-index: listed=48 held=48 skipped=0 sentences=kept bytes=7374
wiki-index: unavailable
```

The first line is the build against the wiki at `data` commit `07793bef` (`docs/plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md:267`). The second is the fixed line for an index that could not be built (`packages/wiki-ops/src/wiki-index.ts:452`).

## Related

- [A status line must not mean two things](a-status-line-must-not-mean-two-things-2026-11-14.md): one fixed line per state.
- [Observability before structural change](observability-before-structural-change-2026-06-09.md): read live evidence before you add something permanent.
- [Enumerate every no-match path before narrowing a row matcher](enumerate-no-match-paths-before-narrowing-a-matcher-2026-10-10.md): a stricter match rule needs a check of what it matches on real inputs.
- [Requirements](../../brainstorms/2026-11-14-wiki-baseline-index-requirements.md) and [plan](../../plans/2026-11-14-001-feat-wiki-index-for-daily-passes-plan.md) for the index.
