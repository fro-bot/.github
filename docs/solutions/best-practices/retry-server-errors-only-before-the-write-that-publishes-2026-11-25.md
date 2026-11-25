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

Retry a server error only on calls that have not changed the shared state yet. When the call that publishes the change returns a server error, stop at once with an "unconfirmed" outcome. Do not read back and guess.

`commitWikiChanges` in `packages/wiki-write-core/src/wiki-ingest.ts` builds blobs, a tree and a commit, then moves the `data` branch with `updateRef`. It retried only a ref race. Observe's wiki ingest failed twice on `POST /git/blobs` returning 500, in runs [43690899321](https://github.com/fro-bot/.github/actions/runs/43690899321) and [45363171280](https://github.com/fro-bot/.github/actions/runs/45363171280), and each failure lost that day's wiki learnings.

## Guidance

1. **Retry before the publishing call.** A 500, 502, 503 or 504 from the reads or from creating the blob, tree or commit is retried, because none of them moves the branch.
2. **Pin the base before the first call that can fail.** Without an explicit base, the writer records the first head it reads and resolves the base from that commit on every retry. Otherwise a retry can adopt a head another writer reached during the backoff as its base, and the conflict guard then sees no change and lets the write overwrite the other writer's edit.
3. **Stop at an ambiguous publish.** A server error from `updateRef` raises `SERVER_ERROR_UNCONFIRMED` and names the attempted commit, so an operator can check whether it is in the branch history.
4. **Choose the exit code by what the caller does with it.** Exit 3 tells a survey that another writer changed `data`, and the survey dispatches itself again. A GitHub outage is not that, so both server-error codes exit 1.
5. **Keep the response body out of logs.** GitHub's 5xx body is an HTML page. The errors carry the status only.

## Why This Matters

The first version also retried after `updateRef`, with a read-back to tell whether the commit had landed. Each review round found another sequence where the read-back was wrong: a failed read-back made the next attempt see its own commit as a conflict, and a 504 followed by a read of the old parent did not prove the update had stopped. Cutting the retry at the publishing call removed that code and every one of those cases ([#4325](https://github.com/fro-bot/.github/pull/4325)). Both observed failures happened before anything was written.

## When to Apply

Any multi-step write that ends in one state-moving call: Git Data commits, a ref or tag move, a status flip after an upload, a merge after an approval.

## Examples

The catch in `commitWikiChanges` sets `updatingRef` just before the ref update is sent, so it can tell the two cases apart:

```ts
declare const updatingRef: boolean
declare const status: number | undefined

function serverErrorOutcome(attempt: number, maxRetries: number): 'unconfirmed' | 'retry' | 'exhausted' | 'other' {
  if (status === undefined) return 'other'
  if (updatingRef) return 'unconfirmed'
  return attempt < maxRetries ? 'retry' : 'exhausted'
}
```

## Related

- [Agent hand-off snapshots replaced shared wiki files](../integration-issues/agent-handoff-snapshots-replaced-shared-wiki-files-2026-10-22.md)
- [Weigh a review finding by whether its input can occur](../workflow-issues/weigh-a-review-finding-by-whether-its-input-can-occur-2026-11-17.md)
