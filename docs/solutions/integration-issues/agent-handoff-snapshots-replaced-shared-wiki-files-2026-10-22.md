---
title: Agent handoff snapshots replaced shared wiki files and lost survey updates
date: 2026-10-22
category: integration-issues
module: packages/wiki-write-core
problem_type: integration_issue
component: tooling
severity: high
verified: 2026-10-22
symptoms:
  - "Log entries and index rows from an earlier daily survey disappeared from origin/data after a later survey committed (1182a0b -> dcc9366)"
  - "A topic page edit (knowledge/wiki/topics/github-actions-ci.md) was reverted by a later survey (b2a3dd7 -> 0ac011e)"
  - "knowledge/log.md entry counts stayed flat across both pairs (530 -> 530, 534 -> 534), so entries were replaced, not rotated"
  - "No job failed, and the write-set guard from #4032 passed the stale bytes"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  - wiki-handoff
  - lost-updates
  - data-branch
  - snapshot-handoff
  - staleness-guard
  - concurrency-diagnosis
  - survey-workflow
  - wiki-ingest
---

# Agent handoff snapshots replaced shared wiki files and lost survey updates

## Problem

Every daily survey batch silently lost wiki writes on `data`. A later survey replaced the log entries, index rows and shared topic-page edits that an earlier survey had just committed. Each survey's agent handoff carried full copies of `knowledge/log.md`, `knowledge/index.md` and the pages it touched, all taken from the agent's own sync. The trusted writer applied them over its fresh sync and committed.

## Symptoms

- `1182a0b` → `dcc9366`: two log entries and two of the three index rows from the ha-config survey disappeared.
- `b2a3dd7` → `0ac011e`: the same loss for the infra survey. The later survey also reverted the earlier one's edit to `knowledge/wiki/topics/github-actions-ci.md`.
- The `knowledge/log.md` entry count stayed flat (530 → 530, 534 → 534). The entries had been replaced, not rotated out.
- All four runs concluded `success`.

Per-job timings, from `gh api repos/fro-bot/.github/actions/runs/<id>/jobs`:

| Run         | Survey Repo (agent) | Persist survey results |
| ----------- | ------------------- | ---------------------- |
| 39405714364 | 10:07:59 – 10:15:42 | 10:15:44 – 10:16:21    |
| 39405901498 | 10:09:30 – 10:16:54 | 10:16:56 – 10:17:32    |
| 39583085685 | 10:14:22 – 10:20:40 | 10:20:43 – 10:21:19    |
| 39583278657 | 10:15:56 – 10:21:56 | 10:21:58 – 10:22:26    |

The agent jobs overlap. The persist jobs never do.

## What Didn't Work

- **Treating dispatch spacing as overlap.** Reconcile dispatches surveys about 90 s apart, which led to a theory that two `survey-persist` jobs raced on `log.md` and `index.md`. Nobody checked the job timings first. When they were checked, the persist jobs ran strictly in sequence.
- **A guard based on the writer's own sync (#4032).** `commitWikiChanges` refuses when a write-set path changed between `baseCommitSha` and head. The survey passed the persist job's own `sync-wiki` commit as that base. The stale bytes came from the artifact after that sync, so head still matched the base and the guard passed. It could not make the loss loud.
- **A writer queue.** A job-level concurrency group with `queue: max` was planned to serialize the writers. It cannot help, because the agent reads `data` before any persist job runs, and serializing persist doesn't change what the agent read. The pinned actionlint (1.7.12) also rejects the `queue` key.
- **Assuming a refused survey retries the next day.** A recorded failure sets `next_survey_eligible_at` to the channel interval (14, 21 or 30 days) plus jitter, in `computeNextEligibleAt` in `scripts/repos-metadata.ts`.

## Solution

Fixed in #4040.

**Apply never writes or deletes the shared files.** `WIKI_HANDOFF_POLICY` in `scripts/wiki-handoff-core.ts` marks them unapplied:

```ts
export const WIKI_HANDOFF_POLICY: HandoffPolicy = {
  name: "wiki",
  isAllowedPath: isAllowedWikiHandoffPath,
  allowDeletions: true,
  isUnappliedPath: isSharedWikiFile,
  maxTotalBytes: WIKI_HANDOFF_MAX_TOTAL_BYTES,
}
```

`isSharedWikiFile` in `packages/wiki-write-core/src/wiki-ingest.ts` matches `knowledge/index.md` and `knowledge/log.md`. Ingest rebuilds the index from the writer's own sync.

**The agent's log entries are derived, not shipped.** The writer reads `log.md` at the agent's sync commit and keeps only what the agent appended:

```ts
export function deriveAgentLogEntries(baseLog: string, handoffLog: string): string | undefined {
  const base = toLfWithSingleFinalNewline(baseLog)
  const handoff = toLfWithSingleFinalNewline(handoffLog)
  if (base === "" || !handoff.startsWith(base)) return undefined
  return handoff.slice(base.length)
}
```

Those entries are appended to the writer's synced `log.md`. If the agent rewrote any earlier entry, its entries are dropped with an `agent-log-entries-dropped` warning.

**Handed-off pages are checked against the commit the agent read.** The agent job exports its sync commit before the agent runs, and the writer receives it:

```yaml
# survey-repo job outputs
agent-base-sha: ${{ steps.sync-wiki.outputs.data-sha }}

# survey-persist wiki-commit step env
WIKI_HANDOFF_DIR: ${{ runner.temp }}/wiki-handoff
WIKI_HANDOFF_BASE_SHA: ${{ needs.survey-repo.outputs.agent-base-sha }}
```

`assertHandoffPagesCurrent` compares the handed-off pages and deletions between that commit and head before any content validation, and `commitWikiChanges` repeats the check on every attempt. The commit must be an ancestor of head. A changed page refuses with `HANDOFF_PAGE_CHANGED`, which exits 3. A survey that exits 3 is re-dispatched from a fresh sync (up to 3 attempts), and a conflict failure becomes eligible again the next day.

Agent page deletions are now committed from the manifest. Before this change, the porcelain filter dropped them.

## Why This Works

Shared files no longer travel in a handoff. The writer builds `index.md` and `log.md` from its own fresh sync, so one agent's snapshot cannot replace another writer's entries. Page staleness is judged against the commit the content was derived from, not the writer's sync, so a stale page fails loudly instead of silently overwriting. The preflight runs before content validation, so a stale page that links to a since-deleted page surfaces as a conflict and is re-dispatched. Otherwise it would surface as an `INVALID_WIKILINK` failure and never be retried.

## Prevention

- **Measure overlap before designing a concurrency fix.** Pull per-job timings first:

  ```sh
  gh api repos/<owner>/<repo>/actions/runs/<id>/jobs --paginate \
    --jq '.jobs[] | [.name, .started_at, .completed_at] | @tsv'
  ```

  Dispatch spacing is not overlap. Check which jobs actually overlap.

- **Handoffs ship deltas only.** A file that is derived from the whole store (an index) or appended to by several writers (a log) must not cross a handoff as a full file. Rebuild it on the trusted side.
- **A staleness base is the commit the content was derived from.** For agent handoffs that is the agent job's sync commit, carried as a job output the agent cannot rewrite, never the writer's own sync.
- **Check staleness before content validation.** If validation runs first, it turns a recoverable conflict into a terminal error class and skips the retry path.
- **Regression coverage:** `scripts/wiki-handoff-sequence.test.ts` replays both incident sequences on `scripts/git-data-fake.ts`. On the pre-fix code, 12 of its 13 cases failed.

## Related Issues

- #4031 (issue), #4032 (writer-base guard), #4040 (fix)
- [Agent drafts, trusted job publishes](../best-practices/agent-drafts-trusted-publish-split-2026-10-10.md): the trusted boundary for agent artifacts
- [Bootstrap data branch before autonomous writes](bootstrap-data-branch-before-autonomous-writes-2026-05-09.md): the shared Git Data writer contract
- [Silent failures in autonomous multi-step pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md): survey status semantics and the porcelain deletion filter
- [Test the integration seam, not the endpoints](../best-practices/test-the-integration-seam-not-the-endpoints-2026-07-06.md): why the replay tests exercise apply, ingest and commit together
- [Pin every App token mint in a repo-wide contract test](../best-practices/repo-wide-app-token-scope-contract-2026-10-10.md): the redispatch token's scope row
