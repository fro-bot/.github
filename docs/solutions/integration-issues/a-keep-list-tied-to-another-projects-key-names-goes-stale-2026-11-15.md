---
title: A keep-list tied to another project's key names goes stale, and a silent cleanup hides it
date: 2026-11-15
category: integration-issues
module: .github/workflows/manage-cache.yaml
problem_type: integration_issue
component: infrastructure
severity: high
symptoms:
  - "The weekly cleanup of `main` printed no keep notice and no deleted key, so its log could not show what it removed"
  - "The next Fro Bot run on a pull request logged `Cache miss - starting with fresh state` for its session cache"
root_cause: config_error
resolution_type: code_fix
tags:
  - github-actions
  - cache
  - manage-cache
  - keep-list
  - session-memory
  - destructive-cleanup
  - audit-log
---

# A keep-list tied to another project's key names goes stale, and a silent cleanup hides it

## Problem

The weekly `Manage Cache` run deletes every cache on `main` except the agent's session caches, which it keeps by name (`opencode-storage-*`). The agent action renamed its keys to `opencode-v2-storage-…`. The keep rule matched nothing, the step deleted the session caches, and it printed no line for any key, so the loss showed only in the next run.

## Symptoms

- Run 43673955176 (`schedule`, 2026-11-15T03:47:56Z) succeeded. The step `Deleting workflow caches on refs/heads/main` printed no `keeping agent session cache` notice and no `deleted cache:` line.
- That notice appeared 32, 27 and 22 times in the runs of 2026-10-18, 10-25 and 11-01 (runs 39088881658, 40153874544, 41268283954). It appeared 0 times on 2026-11-08 (run 42442315067) and on 11-15.
- Run 42171018482 (2026-11-06) restored `opencode-v2-storage-github-fro-bot-.github-main-Linux-42044470943-2-fro-bot-observe`, so the renamed keys were on `main` before the 11-08 run. The step deletes every listed key it does not keep, so those keys were exposed from 11-08 on. The logs do not show which weekly run first removed the session caches.
- Run 43674145131, the Fro Bot run on pull request #4244 at 03:50Z, three minutes after the cleanup, matched neither its primary key nor any of its four restore keys: `Cache restore completed` with `cacheStatus: miss`.

## Solution

[#4246](https://github.com/fro-bot/.github/pull/4246) changed the step in `.github/workflows/manage-cache.yaml` (the keep pattern at line 56, the delete at line 68, the new output at line 79):

```diff
-                opencode-storage-*)
+                opencode-*storage-*)
                   echo "::notice::keeping agent session cache: $key"
                   continue
@@
-            if ! delete_output="$(gh cache delete "$key" -R "${{ github.repository }}" 2>&1)"; then
+            if ! delete_output="$(gh cache delete "$key" -R "$REPOSITORY" --ref "$REF" 2>&1)"; then
@@
               fi
+            else
+              echo "deleted cache: $key"
             fi
```

The expressions moved from `run:` into `env:` (`REPOSITORY`, `DEFAULT_BRANCH`). `scripts/manage-cache-workflow.test.ts` runs the step's real shell under bash with a stubbed `gh`.

## Why This Works

- `opencode-*storage-*` matches the old name, the current one and a later version. It does not match `opencode-tools-v2-…`, which stays deletable (`scripts/manage-cache-workflow.test.ts:86-91`).
- The delete API removes every cache with the given key on every ref unless a ref is passed ([REST API: delete caches by key](https://docs.github.com/en/rest/actions/cache#delete-github-actions-caches-for-a-repository-using-a-cache-key)). Keys such as `mise-v1-…` carry no ref (run 43674145131 on a pull request and run 43665263205 on `main` use the same `mise-v1-linux-x64-…` key), so by the documented behaviour a delete by key from a pull-request cleanup reaches `main`'s copy. No run log shows that happening. `--ref "$REF"` limits each delete to the ref that was listed.
- One `deleted cache:` line per delete makes a run readable after the fact. The first live run of the pull-request path, run 43676303451 (`refs/pull/4246/merge`), printed three: `opencode-tools-v2-…`, `opencode-v2-storage-…-4246/merge-…` and `fro-bot-dedup-v1-…`.

## Prevention

1. **Write the keep-list test from names in a live log, and add the next version.** The fixture holds `opencode-storage-a`, an `opencode-v2-storage-…` key shaped like the one run 43665263205 restored and `opencode-v3-storage-x` (`scripts/manage-cache-workflow.test.ts:86-90`).
2. **Make a destructive step print one line per key it keeps and one per key it deletes.** Without lines, run 43673955176 could not show its own effect. The step prints `::notice::keeping agent session cache: <key>` and `deleted cache: <key>` (`.github/workflows/manage-cache.yaml:57`, `:79`).
3. **Read a drop to zero in the kept count as a stopped rule.** The count went 32, 27, 22, then 0 on 11-08 and the run still concluded `success`. A green conclusion says nothing about what a cleanup matched.
4. **Delete by the narrowest identifier.** Pass the ref with the key (`--ref`), or delete by cache id (`.github/workflows/manage-cache.yaml:68`).
5. **Test the real `run:` text with a stubbed command and assert its arguments.** The test fails when `--ref` or the repository argument is missing, and covers the default branch, a pull-request ref, an evicted-cache race, another failure and an empty list (`scripts/manage-cache-workflow.test.ts:108-208`).
6. **Read the first live run of each branch of the step.** The pull-request delete is confirmed by run 43676303451. The default-branch keep path has run only under test, so the next Sunday run is its first live check.

## Related Issues

- [Check the first live event before trusting an event-driven workflow](../best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md): read the first live run after the merge.
- [A status line must not mean two things](../best-practices/a-status-line-must-not-mean-two-things-2026-11-14.md): an output that is silent in both the good and the bad case.
- [#3981](https://github.com/fro-bot/.github/pull/3981) added the keep rule; [#4246](https://github.com/fro-bot/.github/pull/4246) fixed it.
