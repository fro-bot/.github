---
title: A trusted writer takes its work list from the validated hand-off, not from the working tree
date: 2026-11-15
category: integration-issues
module: packages/wiki-write-core/src/wiki-ingest.ts
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "The ingest's page list held every page where `data` differs from `main`, not the pages the agent changed"
  - "A page the agent never touched could be written into the commit, could fail the whole write, and was counted in `pagesChanged`"
  - "The test for a log-only hand-off passed an empty changed-path list, so no test saw the drift"
root_cause: logic_error
resolution_type: code_fix
tags:
  - wiki-ingest
  - hand-off
  - trusted-writer
  - git-status
  - ambient-state
  - test-fixture
  - survey
---

# A trusted writer takes its work list from the validated hand-off, not from the working tree

## Problem

A trusted writer selects its work from the artifact it validated, not from unrelated changes in its checkout. The wiki writer (`runWikiIngestCli`) commits wiki pages for an untrusted agent job. The agent job uploads a hand-off, an artifact whose manifest lists the paths the agent changed and deleted, and the trusted job validates it, applies it and writes from the checkout. That checkout is `main` (the default branch) with `knowledge/` restored from `data` (the branch that holds autonomous writes until a daily promotion into `main`), so `git status` lists every page where `data` differs from `main`. Before #4244 the writer took that list as the page input (the pages the ingest writes), while the staleness guard (the check that handed-off pages did not change on `data` since the agent's base commit) read the manifest. The manifest lists the changes detected against the agent's baseline; an edit that restores `main`'s exact content produces no status entry and is not carried (`packages/wiki-ops/src/wiki-handoff-core.ts:200-208`).

## Symptoms

- One call took two lists. The staleness guard read the manifest's paths (`paths: handoff.pagePaths`, [line 1925 of the `466b7f1` blob](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1925)). The page input came from `git status` (`loadWorkingTreeWikiFiles(changedPaths)`, [line 1873](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1873)), `changedPaths` became `committedPagePaths` ([line 1899](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1899)), and `pagesChanged` counted it ([line 1928](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1928)).
- In run 43681628468 (a survey, 2026-11-15T05:34Z) `main` was at `9be739e` and `data` at `fe019d7`. `git diff --name-only 9be739e fe019d7 -- knowledge/wiki` lists five pages. The agent changed none of them.
- Against the writer from before #4244, 11 of the 16 "page input" tests of that PR fail, among them `leaves a non-canonical page the handoff does not carry as it is on data` and `succeeds when a page the handoff does not carry has invalid frontmatter`. To reproduce, check out `a032557^1` (the parent of the #4244 merge commit `a032557`), keep the PR's `scripts/wiki-ingest.test.ts` and run its "page input" tests, making sure `@fro.bot/wiki-write-core/wiki-ingest` resolves to that checked-out writer and not to a current workspace copy, or all 16 pass.
- The log-only test passed `[]` as the status result. An empty list is a tree where `data` and `main` agree. It never held the drift a real tree holds between daily promotions, so the code passed.

## Solution

[#4244](https://github.com/fro-bot/.github/pull/4244): with a hand-off, the page input is the manifest's changed pages and `git status` is not consulted; without a hand-off nothing changes. This expression selects the changed pages (`packages/wiki-write-core/src/wiki-ingest.ts:1946`); deletions come from the manifest's deleted list:

```ts
// before: const changedPaths = await getChangedWikiPathsImpl()
const changedPaths = handoff === undefined ? await getChangedWikiPathsImpl() : handoff.changedPagePaths
```

`loadHandoff` builds `changedPagePaths` once (`:1822`): each path once, only under the four page directories (`isWikiPageFilePath`, `:1721`), and without any path the manifest also lists as deleted, because the apply step copies a changed page and then deletes a listed one (`packages/wiki-ops/src/wiki-handoff-core.ts:707-718`).

The new tests give the writer a status result that lists pages the hand-off does not carry (`scripts/wiki-ingest.test.ts:3563`, `:3575`, `:3692`).

## Why This Works

The manifest comes from comparing the agent's tree with a baseline taken before it ran, so it leaves out differences already present (`packages/wiki-ops/src/wiki-handoff-core.ts:200-208`), and the apply step validated it. The staleness guard and the page input now derive their paths from the same manifest: the guard gets the changed and deleted paths, the page input gets the filtered changed pages. `git status` in the trusted job also holds what the restore put there, and it is no longer consulted when there is a hand-off.

Reads did not change: the index rebuild and the link check still read every page in the tree, so a page with no readable frontmatter still fails a write (`scripts/wiki-ingest.test.ts:3604`, `:3682`).

Live: run 43681628468 committed only `knowledge/log.md` in `ec6df56`, with `"pagesChanged":0`, while the five pages above differed.

## Prevention

1. **A trusted step takes its work list from the artifact it validated.** Do not re-derive it from the checkout, the index or the environment. The checkout holds what other writers left there.
2. **Derive checks and writes from the same authority.** Their sets can differ where the operation treats changed and deleted paths differently: the guard reads both lists, the page input only the changed pages that no deletion cancels.
3. **Build the test fixture from the caller's real environment.** Ask what state the caller holds when it runs, then put that in the fixture: a tree that differs from `main` by pages the hand-off does not carry. An empty status models a quiet repository, not the ingest job.
4. **Run the new tests against the old code before merging.** If they pass there, they do not pin the fix (see Symptoms for the count and how to reproduce it).
5. **Keep the old path for callers without the artifact, and say so in a test.** `scripts/wiki-ingest.test.ts:3716` checks that, with no hand-off, every status-listed page is still written.
6. **Test reads separately from writes.** The page input shrank; the index rebuild and the link check still read every page, and the README documents the split (`packages/wiki-write-core/README.md:70`).

## Related Issues

- [Agent handoff snapshots replaced shared wiki files](agent-handoff-snapshots-replaced-shared-wiki-files-2026-10-22.md): the same hand-off, an earlier gap (shared files and the staleness base).
- [Agent drafts, trusted job publishes](../best-practices/agent-drafts-trusted-publish-split-2026-10-10.md): the trust boundary.
- [Silent failures in autonomous multi-step pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md): the `git status` page input and its deletion filter.
