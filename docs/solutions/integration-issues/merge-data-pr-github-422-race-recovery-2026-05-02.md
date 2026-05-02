---
title: Data Merge PR Recovery Must Distinguish GitHub 422s and Mergeability Races
category: integration-issues
problem_type: integration_issue
component: tooling
root_cause: logic_error
resolution_type: code_fix
severity: high
date: 2026-05-02
last_updated: 2026-05-02
module: .github/workflows/merge-data.yaml + scripts/merge-data-pr.ts
tags:
  - merge-data
  - github-actions
  - octokit
  - pull-requests
  - mergeable-state
  - race-condition
  - data-branch
  - workflow-recovery
verified: true
symptoms:
  - Duplicate-PR 422 responses could be misrouted instead of reusing the existing data -> main PR
  - mergeable_state: unknown could leave a promotion PR behind main without attempting updateBranch
  - Retryable GitHub API failures after PR creation could abort the run even though the PR already existed
---

## Problem

`merge-data.yaml` needs to create or reuse the `data -> main` promotion PR and then bring it up to date when GitHub reports that the branch is behind. The old recovery logic in `scripts/merge-data-pr.ts` collapsed several different GitHub API states into the same outcome, so duplicate-PR races, true merge conflicts, eventually consistent mergeability, and transient API failures could all send the workflow down the wrong path.

That mattered in production because the repo had already needed operator recovery after the integrity guard rejected the `data` tip due to unexpected authorship. The long-term fix still had to make the promotion PR path resilient enough to recover on its own.

## Symptoms

- `merge-data.yaml` could treat a duplicate-PR create race like a merge conflict instead of rediscovering and reusing the already-created `data -> main` PR.
- A promotion PR with `mergeable_state: unknown` could miss `pulls.updateBranch`, leaving it behind `main` until a later manual retry.
- Retryable failures from `pulls.get`, `pulls.updateBranch`, or PR rediscovery could fail the run even after the promotion PR already existed.
- Integrity alert issues `#3204` and `#3208` stayed open until the recovery path was fixed and a clean `data -> main` promotion succeeded again.

## What Didn't Work

- **Treating broad 422 responses as merge conflicts.** GitHub uses `422` for real merge conflicts, duplicate PR creation, and other validation failures. One bucket was too blunt.
- **One-shot mergeability checks.** GitHub often reports `mergeable_state: unknown` briefly while it computes the real state. A single read is not a stable signal.
- **One-shot duplicate-PR recovery.** `pulls.create` can report that a PR already exists before `pulls.list` reliably shows that PR.
- **Failing hard on every post-create API error.** Once the PR exists, some follow-up failures should warn and defer instead of killing the whole run.

## Solution

The fix in PR `#3215` split create-time and update-time recovery into explicit paths that match GitHub's actual API behavior.

### 1. Distinguish duplicate-PR 422s from true merge conflicts

Create-time `422` handling now rediscovers an existing PR by branch when GitHub says the PR already exists, and only opens a conflict journal issue for an actual merge-conflict-shaped `422`:

```ts
if (isAlreadyExistsPullRequestError(error)) {
  const pullRequest = await waitForExistingPullRequestByBranch({
    octokit,
    owner,
    repo,
    headBranch,
    baseBranch,
  })

  if (pullRequest !== null) {
    await maybeUpdateBehindPullRequest({
      octokit,
      owner,
      repo,
      pullRequestNumber: pullRequest.number,
      logger,
    })
    await addLabel({octokit, owner, repo, issueNumber: pullRequest.number, label})

    return {
      createdPullRequest: true,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.html_url,
      label,
      journalIssueNumber: null,
      staleAlertIssueNumber,
    }
  }
}

if (!isMergeConflictError(error)) {
  throw toMergeDataPrError(error, `creating ${headBranch} -> ${baseBranch} pull request`)
}
```

The `422` classifiers were narrowed as well:

```ts
function isMergeConflictError(error: unknown): boolean {
  return has422Message(error, 'merge conflict')
}

function isAlreadyExistsPullRequestError(error: unknown): boolean {
  return has422Message(error, 'a pull request already exists')
}
```

`has422Message()` checks both the top-level API message and `response.data.errors[*].message`, which is important because GitHub does not always put the useful text in the same place.

### 2. Poll boundedly while mergeability is still unknown

The workflow now waits through GitHub's eventual-consistency window instead of treating the first `unknown` read as final:

```ts
async function waitForKnownMergeableState(params: {
  octokit: OctokitClient
  owner: string
  repo: string
  pullRequestNumber: number
}) {
  let pullRequest = await getPullRequest(params)

  for (
    let attemptsRemaining = MERGEABLE_STATE_RETRY_COUNT;
    pullRequest.data.mergeable_state === 'unknown';
    attemptsRemaining--
  ) {
    if (attemptsRemaining === 0) {
      return pullRequest
    }

    await delay(MERGEABLE_STATE_RETRY_DELAY_MS)
    pullRequest = await getPullRequest(params)
  }

  return pullRequest
}
```

If mergeability resolves to `behind`, the script calls `pulls.updateBranch`. If it stays `unknown` after the bounded retries, the workflow logs a warning and leaves the branch unchanged for that run.

### 3. Defer retryable follow-up failures, but keep permanent failures loud

Once the promotion PR exists, retryable follow-up failures should not destroy the whole run. `maybeUpdateBehindPullRequest()` now warns and continues on retryable fetch/update failures, but still throws on permanent ones:

```ts
if (isRetryableGitHubApiError(error)) {
  params.logger.warn(
    `${formatApiWarning(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)}; continuing because the PR already exists and a later run can retry the branch update.`,
  )

  return
}

throw toMergeDataPrError(error, `updating PR #${params.pullRequestNumber} branch from ${params.repo}`)
```

Retryable conditions now include `429`, `5xx`, common transport failures such as `ECONNRESET` and `ETIMEDOUT`, and timeout/secondary-rate-limit message shapes.

## Why This Works

The fix works because it models GitHub's real contract instead of pretending every `422` or every first-read PR state means the same thing.

- **Duplicate PR race**: recover by rediscovering the existing PR, then continue normal branch-update and labeling work.
- **True merge conflict**: journal it explicitly instead of pretending it is a duplicate or transient error.
- **`mergeable_state: unknown`**: wait through the bounded eventual-consistency window before deciding whether the PR is behind.
- **Retryable follow-up failures**: warn and defer because the primary goal, having a PR, has already succeeded.
- **Permanent failures**: still throw typed `MergeDataPrError`s so bad permissions, broken branch state, or invalid assumptions stay visible.

This is the right reliability model for autonomous workflow recovery: resilient to normal GitHub flakiness, but still honest when the system is actually broken.

## Prevention

1. **Keep create-time and update-time `422` handling separate.** Only actual merge conflicts should journal. Only `expected_head_sha` races on `pulls.updateBranch` should be treated as benign.

2. **Poll eventually consistent GitHub fields boundedly.** `mergeable_state` and list-after-create PR discovery are not always immediately stable. Bounded retries are enough; unbounded loops are not.

3. **Test workflow behavior, not just helper branches.** Cover the race and retry paths that matter to the end-to-end workflow, then add the remaining missing regression case for duplicate-PR rediscovery exhausting retries and returning `null`.

4. **Verify the fix with the real workflow path.** For GitHub API recovery logic, the strongest proof is a successful workflow dispatch and a clean promotion PR lifecycle, not just unit coverage.

## Verification

This learning is verified by one successful production recovery plus targeted unit coverage for the synthetic GitHub failure paths.

- **Production evidence:** PR `#3215` merged, manual dispatch of `merge-data.yaml` succeeded in run `25238381534`, PR `#3214` updated and merged cleanly, and integrity alert issues `#3204` / `#3208` were closed.
- **Automated evidence:** `scripts/merge-data-pr.test.ts` covers behind-update recovery for new and existing PRs, `mergeable_state: unknown` resolution and bounded timeout behavior, retryable and permanent `pulls.get` / `pulls.updateBranch` failures, duplicate-PR `422` recovery, duplicate-PR rediscovery after an empty list response, duplicate-PR rediscovery after a transient `pulls.list` failure, and non-conflict `422` failures surfacing as structured errors.
- **Known gap:** the suite still does not cover duplicate-PR rediscovery exhausting retries and returning `null`; keep that as follow-up regression coverage rather than treating it as already proven.

## Related Issues

- Fix PR: https://github.com/fro-bot/.github/pull/3215
- Verified promotion PR: https://github.com/fro-bot/.github/pull/3214
- Verified workflow run: https://github.com/fro-bot/.github/actions/runs/25238381534
- Closed integrity alerts: https://github.com/fro-bot/.github/issues/3204 and https://github.com/fro-bot/.github/issues/3208
- Related learning: [`docs/solutions/runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md`](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md)
