---
title: Bootstrap data branch before autonomous writes
date: 2026-05-09
category: integration-issues
module: data-branch-bootstrap
problem_type: integration_issue
component: tooling
severity: high
last_updated: 2026-05-09
verified: true
symptoms:
  - GitHub deleted the data source branch after a data-to-main promotion PR was squash-merged.
  - Autonomous metadata and wiki writers could not safely write to the missing data branch.
  - Manual branch restoration risked creating a human-authored data tip that failed integrity checks.
  - Concurrent writer startup could race while recreating the same missing data ref.
root_cause: missing_workflow_step
resolution_type: code_fix
related_components:
  - development_workflow
  - testing_framework
tags:
  - data-branch
  - bootstrap
  - autonomous-writes
  - branch-protection
  - commit-metadata
  - wiki-ingest
  - github-branches
  - integrity-guard
---

# Bootstrap data branch before autonomous writes

## Problem

Autonomous writers in this repository use the unprotected `data` branch as their durable write
target, then promote safe changes to `main` through a PR. After a data-to-main promotion PR was
squash-merged, GitHub deleted the `data` source branch. The next metadata or wiki write then had no
safe branch to target.

Recreating `data` directly from `main` is not enough. If the restored tip is authored by a human, the
data-branch integrity guard can reject it even when the tree contents are correct.

## Symptoms

- A data-to-main promotion PR succeeded, but the `data` source branch was deleted afterward.
- Metadata and wiki writers could fail before reading or updating their target files.
- Restoring `data` manually risked a wrong-author branch tip.
- Multiple autonomous writers could concurrently observe missing `data` and race on `createRef`.
- A writer could bootstrap `data`, then see a `404` if the branch disappeared again before a
  follow-on content or ref read.

## What Didn't Work

- **Relying on the promotion workflow to preserve `data`.** GitHub can delete the source branch after
  merge, so writers need their own safe bootstrap path.
- **Restoring `data` as a human actor.** That fixes branch existence but violates the author model
  enforced by the integrity guard.
- **Treating every GitHub `422` as benign.** For ref creation, `422` only means the create failed. It
  is safe to continue only after re-reading the branch and confirming it exists.
- **Bootstrapping every target branch.** Non-`data` branches are explicit test or maintenance targets;
  surprising bootstrap side effects there would hide configuration mistakes.
- **Checking wiki branch safety after creating Git objects.** Protected targets should fail before
  blobs, trees, commits, or ref updates are created.

## Solution

Centralize missing-`data` recovery in the shared writer path.

### Restore `data` with a Fro Bot-authored same-tree commit

`bootstrapDataBranch()` now no-ops when `data` exists. When `data` is missing, it reads `main`, uses
the `main` tree, and creates a new restore commit with Fro Bot bot author and committer metadata:

```ts
const restoreCommit = await octokit.rest.git.createCommit({
  owner,
  repo,
  message: 'chore(data): restore data branch',
  tree: baseCommit.data.tree.sha,
  parents: [main.data.commit.sha],
  author: FRO_BOT_BOT_AUTHOR,
  committer: FRO_BOT_BOT_AUTHOR,
})
```

The resulting `data` tree matches `main`, but the branch tip is valid for the autonomous integrity
model.

### Recover only safe `createRef` races

When creating `refs/heads/data` returns `422`, the bootstrapper re-reads `data`. If the branch exists,
the race is safe and the observed tip is returned. If the branch still does not exist, the bootstrapper
raises a structured API error.

This handles both concurrent restore and “another writer already advanced `data`” races without
requiring the current process to own the exact restore SHA.

### Bootstrap and retry metadata writes

`commitMetadata()` now bootstraps only for the canonical `data` branch before checking branch safety
or reading file contents:

```ts
const shouldBootstrapDataBranch = branch === DEFAULT_BRANCH

if (shouldBootstrapDataBranch) {
  await bootstrapDataBranch()
}
```

It rejects `main` and protected branches, and it retries after re-bootstrapping when recoverable
missing-branch signals happen during the write loop:

```ts
if (shouldBootstrapDataBranch && isRecoverableDataBranchMissingError(error) && attempt < maxRetries) {
  await bootstrapDataBranch()
  continue
}
```

### Bootstrap and guard wiki ingest writes

`commitWikiChanges()` now follows the same data-branch bootstrap pattern. It rejects literal `main`
before bootstrap, and it checks branch protection before creating wiki blobs, trees, commits, or ref
updates:

```ts
function rejectProtectedWikiBranchName(branch: string): void {
  if (branch === 'main') {
    throw new WikiIngestError({
      code: 'PROTECTED_BRANCH',
      message: 'wiki ingest refuses to write to main; use the data branch',
      remediation: 'Target the data branch. Promotions to main must go through the data-branch merge PR.',
    })
  }
}
```

It retries when `data` disappears before reading the wiki head ref.

## Why This Works

- The restored branch has the same tree as `main`, so bootstrap does not introduce content drift.
- The restore commit is authored and committed by `fro-bot[bot]`, preserving the data-branch
  integrity contract.
- The bootstrap path is idempotent: existing `data` is a no-op; missing `data` is restored;
  concurrent creation is accepted only after the branch exists.
- Shared writers recover from post-bootstrap `404` races instead of assuming the first bootstrap call
  made the rest of the write atomic.
- Branch-protection checks run before writes, so accidental `main` or protected-branch targets fail
  closed.
- Non-`data` branches keep explicit behavior and do not get hidden bootstrap side effects.

## Prevention

- Put missing-branch recovery in shared writer utilities, not individual workflow call sites.
- Treat ref-creation `422` responses as recoverable only after verifying the ref exists afterward.
- Restore `data` through `bootstrapDataBranch()` rather than manually recreating the branch.
- Check both GitHub branch protection shapes before writing:
  - `response.data.protected`
  - `response.data.protection?.enabled`
- Test writer behavior at the GitHub boundary: missing branch, branch deleted between steps,
  concurrent `createRef`, protected targets, and non-`data` branch bypass.

## Related Issues

- PR: [#3272 — Bootstrap data before autonomous writes](https://github.com/fro-bot/.github/pull/3272)
- Related promotion: [#3271 — Merge data into main](https://github.com/fro-bot/.github/pull/3271)
- Related alert: [#3256 — Reconcile integrity alert](https://github.com/fro-bot/.github/issues/3256)
- Related doc: [Data Merge PR recovery must distinguish GitHub 422s and mergeability races](merge-data-pr-github-422-race-recovery-2026-05-02.md)
- Related doc: [Silent failures in autonomous multi-step pipelines](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md)
- Related doc: [Normalize redacted metadata YAML quoting before data promotion](normalize-redacted-yaml-quotes-2026-05-09.md)
- Related doc: [Wiki lint must report against authoritative data snapshots](wiki-lint-authoritative-data-snapshot-reporting-2026-05-02.md)
