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

In the ingest jobs the checkout is `main` with `knowledge/` restored from `data`, so `git status` lists every page where `data` differs from `main`. The writer passed all of them to the ingest as the pages to write. The hand-off manifest already listed exactly what the agent changed and was already read for the staleness check, but the write did not use it.

## Symptoms

- One call held two lists. The staleness guard got the manifest's paths (`paths: handoff.pagePaths`, [line 1925 at `466b7f1`](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1925)). The pages to write came from `git status` (`loadWorkingTreeWikiFiles(changedPaths)`, [line 1873](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1873)), and `pagesChanged` counted that list ([line 1899](https://github.com/fro-bot/.github/blob/466b7f1/packages/wiki-write-core/src/wiki-ingest.ts#L1899)).
- In run 43681628468 (a survey, 2026-11-15T05:34Z) `main` was at `9be739e` and `data` at `fe019d7`. `git diff --name-only 9be739e fe019d7 -- knowledge/wiki` lists five pages. The agent changed none of them.
- Against the writer from before the fix, 11 of the 16 "page input" tests of #4244 fail, among them `leaves a non-canonical page the handoff does not carry as it is on data` and `succeeds when a page the handoff does not carry has invalid frontmatter`. To reproduce, check out `a032557^1` (the parent of the #4244 merge commit `a032557`), keep the PR's `scripts/wiki-ingest.test.ts` and run its "page input" tests.
- The earlier log-only test passed `[]` as the status result. An empty list is a tree where `data` and `main` agree. It never held the drift a real tree holds between daily promotions, so the code passed.

## Solution

[#4244](https://github.com/fro-bot/.github/pull/4244): with a hand-off, the page input is the manifest's changed pages, and `git status` is not consulted. Without a hand-off nothing changes (`packages/wiki-write-core/src/wiki-ingest.ts:1946`, wrapped in a function here):

```ts
async function pageInput(handoff: LoadedHandoff | undefined, getChangedWikiPathsImpl: () => Promise<string[]>) {
  // before: const changedPaths = await getChangedWikiPathsImpl()
  return handoff === undefined ? await getChangedWikiPathsImpl() : handoff.changedPagePaths
}
```

`loadHandoff` builds `changedPagePaths` once (`:1822`): each path once, only under the four page directories (`isWikiPageFilePath`, `:1721`), and without any path the manifest also lists as deleted, because the apply step copies a changed page and then deletes a listed one (`packages/wiki-ops/src/wiki-handoff-core.ts:707-718`).

The new tests give the writer a status result that lists pages the hand-off does not carry (`scripts/wiki-ingest.test.ts:3563`, `:3575`, `:3692`):

<!-- verify: runWikiIngestCli from packages/wiki-write-core/src/wiki-ingest.ts -->
```ts
async function run(octokit: OctokitClient, commit: CommitFn, statusPaths: string[]) {
  await runWikiIngestCli({getChangedWikiPaths: async () => statusPaths, commitWikiChanges: commit, octokit})
}
```

## Why This Works

The manifest is what the agent job's baseline comparison produced and the apply step validated. It leaves out differences already present before the agent ran (`packages/wiki-ops/src/wiki-handoff-core.ts:200-206`). `git status` in the trusted job also holds what the restore put there. The write set is now the validated artifact, and the staleness guard and the page input read one list.

Reads did not change: the index rebuild and the link check still read every page in the tree, so a page with no readable frontmatter still fails a write (`scripts/wiki-ingest.test.ts:3604`, `:3682`).

Live: run 43681628468 committed only `knowledge/log.md` in `ec6df56`, with `"pagesChanged":0`, while the five pages above differed.

## Prevention

1. **A trusted step takes its work list from the artifact it validated.** Do not re-derive it from the checkout, the index or the environment. The checkout holds what other writers left there.
2. **When a step has two sources for one list, make them one value.** Here the guard read the manifest and the writer read `git status`, so "the pages" meant two things.
3. **Build the test fixture from the caller's real environment.** Ask what state the caller holds when it runs, then put that in the fixture: a tree that differs from `main` by pages the hand-off does not carry. An empty status models a quiet repository, not the ingest job.
4. **Run the new tests against the old code before merging.** If they pass there, they do not pin the fix. Against the writer from before the fix, 11 of the 16 "page input" tests fail (see Symptoms to reproduce).
5. **Keep the old path for callers without the artifact, and say so in a test.** `scripts/wiki-ingest.test.ts:3716` checks that, with no hand-off, every status-listed page is still written.
6. **Compare what the artifact omits with what the writer still reads.** Page input shrank; the index rebuild did not. Document that split (`packages/wiki-write-core/README.md:70`).

## Related Issues

- [Agent handoff snapshots replaced shared wiki files](agent-handoff-snapshots-replaced-shared-wiki-files-2026-10-22.md): the same hand-off, an earlier gap (shared files and the staleness base).
- [Agent drafts, trusted job publishes](../best-practices/agent-drafts-trusted-publish-split-2026-10-10.md): the trust boundary.
- [Silent failures in autonomous multi-step pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md): the `git status` page input and its deletion filter.
