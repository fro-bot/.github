---
title: A keep-list tied to another project's key names goes stale, and a silent cleanup hides it
date: 2026-11-15
category: integration-issues
module: .github/workflows/manage-cache.yaml
problem_type: integration_issue
component: infrastructure
severity: high
symptoms:
  - "The weekly cleanup of `main` printed no keep notice and no deleted key, so its log does not show what it kept or removed"
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

Test a cleanup's keep-list against the names its producer uses, and log each item the cleanup keeps or deletes. The weekly `Manage Cache` workflow lists up to 100 caches on `main` (the default branch), keeps those whose key matches the agent's session-cache name (`opencode-storage-*`; a session cache holds the agent's session history) and attempts to delete the others. The agent's keys changed from `opencode-storage-*` to `opencode-v2-storage-…`, so the keep rule no longer matched them and they were exposed to deletion. The cleanup logged neither kept nor deleted keys, so its logs do not establish when the session caches disappeared.

## Symptoms

- Runs 39088881658, 40153874544 and 41268283954 (the weekly runs of 2026-10-18, 10-25 and 11-01) printed 32, 27 and 22 keep notices, the line `::notice::keeping agent session cache: <key>`. Runs 42442315067 (11-08) and 43673955176 (11-15, `schedule`, 03:47:56Z) printed none, and run 43673955176 printed no deleted key and concluded `success`.
- Run 42171018482 (2026-11-06) restored `opencode-v2-storage-github-fro-bot-.github-main-Linux-42044470943-2-fro-bot-observe` before run 42442315067, so the renamed keys were exposed to the cleanup from then on. The logs do not identify which cleanup first removed a session cache.
- Run 43674145131 on pull request #4244, three minutes after run 43673955176, matched neither its primary key nor its four restore keys (`cacheStatus: miss`).

## Solution

[#4246](https://github.com/fro-bot/.github/pull/4246) changed the step in `.github/workflows/manage-cache.yaml` (the keep pattern at line 56, the delete at line 68, the new output at line 79). A ref is the branch or pull-request reference a cache is scoped to, such as `refs/heads/main` or `refs/pull/4246/merge`.

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

- `opencode-*storage-*` matches the old name, the current one and the `opencode-v3-storage-x` the test uses. It does not match `opencode-tools-v2-…`, which stays deletable (`scripts/manage-cache-workflow.test.ts:86-91`). It does not cover every possible future name; Prevention rule 3 is the check for a rule that stops matching.
- The delete API removes every cache with the given key on every ref unless a ref is passed ([REST API: delete caches by key](https://docs.github.com/en/rest/actions/cache#delete-github-actions-caches-for-a-repository-using-a-cache-key)). Keys such as `mise-v1-…` carry no ref (run 43674145131 on a pull request and run 43665263205 on `main` use the same `mise-v1-linux-x64-…` key), so by the documented behaviour a delete by key from a pull-request cleanup reaches `main`'s copy. No run log proves that it did. `--ref "$REF"` limits each delete to the ref that was listed.
- A `deleted cache:` line records each successful delete command, so a run shows what it removed. The first live run of the pull-request path, run 43676303451 (`refs/pull/4246/merge`), printed three: `opencode-tools-v2-…`, `opencode-v2-storage-…-4246/merge-…` and `fro-bot-dedup-v1-…`.

## Prevention

1. **Test preservation rules against observed names.** The fixture holds the old name, the current name and a plausible next version: `opencode-storage-a`, an `opencode-v2-storage-…` key shaped like the one run 43665263205 restored, and `opencode-v3-storage-x` (`scripts/manage-cache-workflow.test.ts:86-90`).
2. **Make a destructive step print one line per key it keeps and one per key it deletes.** Without lines, run 43673955176 could not show its effect. The step prints `::notice::keeping agent session cache: <key>` and `deleted cache: <key>` (`.github/workflows/manage-cache.yaml:57`, `:79`).
3. **Investigate an unexpected drop in the number of preserved items.** The keep notices fell from 22 on 2026-11-01 to 0 on 11-08 and the run still concluded `success`; a green conclusion says nothing about what a cleanup matched.
4. **Scope a deletion to the item and its intended location.** Pass the ref with the key (`--ref`), or delete by cache id (`.github/workflows/manage-cache.yaml:68`).
5. **Test the real `run:` text with a stubbed command and assert its arguments.** A missing `--ref` or repository argument fails the test, which covers the default branch, a pull-request ref, an evicted-cache race, another failure and an empty list (`scripts/manage-cache-workflow.test.ts:108-208`).
6. **Read the first live run of each branch of the step.** Run 43676303451 confirms the pull-request delete. The default-branch keep path has run only under test, so the next Sunday run is its first live check.

## Related Issues

- [Check the first live event before trusting an event-driven workflow](../best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md): read the first live run after the merge.
- [A status line must not mean two things](../best-practices/a-status-line-must-not-mean-two-things-2026-11-14.md): an output that is silent in both the good and the bad case.
- [#3981](https://github.com/fro-bot/.github/pull/3981) added the keep rule; [#4246](https://github.com/fro-bot/.github/pull/4246) fixed it.
