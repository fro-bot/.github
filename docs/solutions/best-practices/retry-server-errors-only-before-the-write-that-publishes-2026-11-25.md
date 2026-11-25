---
title: Retry server errors only before the write that publishes
date: 2026-11-25
category: best-practices
module: packages/wiki-write-core
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - a write is a sequence of calls that ends in one call that moves shared state, such as a ref update
  - a server error on that last call leaves unknown whether the change landed
  - the retry loop already has its own conflict handling and exit code
  - review keeps finding gaps in code that confirms an ambiguous write
tags:
  - retry
  - server-error
  - ambiguous-write
  - exit-codes
  - git-data-api
  - wiki-writer
---

# Retry server errors only before the write that publishes

## Context

Retry a server error only before the call that publishes the change. If that call returns a server error, stop with an "unconfirmed" outcome; do not guess from a read-back.

`commitWikiChanges` in `packages/wiki-write-core/src/wiki-ingest.ts` creates blobs, a tree and a commit, then moves the `data` branch (where the bot stores its automated changes) with `updateRef`. It retried only a ref race. Observe, the daily job that records wiki learnings, failed twice on `POST /git/blobs` returning 500, in runs [43690899321](https://github.com/fro-bot/.github/actions/runs/43690899321) and [45363171280](https://github.com/fro-bot/.github/actions/runs/45363171280), and each failure lost that day's learnings.

## Guidance

1. **Retry before the publishing call.** A 500, 502, 503 or 504 from a read inside the attempt loop, or from creating the blob, tree or commit, is retried, because none of them moves the branch. The hand-off base check and the first data-branch bootstrap run before the loop and are not retried.
2. **Pin the base as soon as a head read succeeds.** Without an explicit base, the writer records the first head it reads successfully, before any further call, and uses that commit as the base on every retry. A change made before that first read is not part of the check. Otherwise a retry can take a head that another writer reached during the backoff as its base, and the conflict check then sees no change and lets the write overwrite the other writer's edit.
3. **Stop at an ambiguous publish.** A server error from `updateRef` raises `SERVER_ERROR_UNCONFIRMED`, which names the attempted commit so an operator can check whether it is in the branch history.
4. **Pick the exit code by what the caller does with it.** Exit 3 tells a survey that another writer changed `data`, and the survey dispatches itself again. An outage is not that, so both server-error codes exit 1.

## Why This Matters

The first version also retried after `updateRef`, with a read-back to tell whether the commit had landed. Each review round found another sequence where the read-back misled the retry: a failed read-back made the next attempt see its own commit as a conflict, and a 504 followed by a read of the old parent did not prove the update had stopped. Stopping at the publishing call removed that code and every one of those cases ([#4325](https://github.com/fro-bot/.github/pull/4325)). Both observed failures happened before anything was written.

## When to Apply

Any multi-step write that ends in one call that moves shared state: a Git Data commit, a ref or tag move, a status change after an upload, a merge after an approval.

## Examples

The try block sets `updatingRef` just before it sends the ref update, and the catch handles only 500, 502, 503 and 504 as server errors. Before the flag is set, a server error is retried; after it, the write stops as unconfirmed.

## Related

- [Agent hand-off snapshots replaced shared wiki files](../integration-issues/agent-handoff-snapshots-replaced-shared-wiki-files-2026-10-22.md)
- [Weigh a review finding by whether its input can occur](../workflow-issues/weigh-a-review-finding-by-whether-its-input-can-occur-2026-11-17.md)
