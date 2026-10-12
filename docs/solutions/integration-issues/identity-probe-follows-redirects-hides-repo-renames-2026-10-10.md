---
title: An identity probe that follows redirects cannot detect a repo rename
date: 2026-10-10
last_updated: 2026-10-10
verified: 2026-10-10
category: integration-issues
module: scripts/reconcile-repos.ts
problem_type: integration_issue
component: development_workflow
severity: medium
symptoms:
  - Reconcile reported `renamed: 0` for a tracked repo that GitHub had renamed
  - "`repos.get` on the stored name followed the redirect, returned the same `node_id`, and the row was classified `matched`"
  - "`metadata/repos.yaml` kept the old name while the survey wrote the wiki page under the new name"
root_cause: wrong_api
resolution_type: code_fix
tags:
  - github-redirects
  - repo-rename
  - identity-probe
  - node-id
  - reconcile
  - operator-workflow
---

# An identity probe that follows redirects cannot detect a repo rename

## Problem

Reconcile classified a renamed tracked repo (`marcusrbrown/panthe.ai` renamed to `marcusrbrown/panthea`) as `matched` and reported `renamed: 0`. The stored row kept the old name. The survey resolves a repo by node ID, so it wrote the wiki page under the new name. Metadata and wiki drifted apart and nothing signaled it.

## Symptoms

- Reconcile reported `renamed: 0` for a repo GitHub had renamed.
- `repos.get` on the stored name followed GitHub's redirect and returned the same `node_id`, so the row was classified `matched`.
- The probe had already captured the returned name. Before #3977 it was set at `scripts/reconcile-repos.ts:2533` (at `8792b53^1`), but the classification at `:1060` compared only `returned_node_id` and `resolution`. The only place a rename was noticed was the GraphQL-fallback branch (`renameTarget`, assigned at `:1120`), which a redirect-following probe never reached.

## What Didn't Work

These were design alternatives that the plan rejected, not fixes that were tried and reverted.

- **Applying the rename automatically inside reconcile.** An unattended scheduled job that deletes wiki pages is the largest risk in this area, so reconcile detects and reports, and an operator applies the rename.
- **Moving the page with an alias.** `validateWikilinks` ignores aliases while `buildWikiTargetIndex` honors them, and a later repo that reused the old name would make the alias ambiguous. The page moves without one.
- **Letting the old page vanish.** Links to it would fail `validateWikilinks` on every later ingest, so the page has to move.

## Solution

1. **Detect.** `detectRenames` (`scripts/reconcile-repos.ts:815-858`) takes the returned name from a `matched` probe and compares every observed name against the stored row:

   ```ts
   if (identity.returned_node_id === nodeId && identity.resolution === 'matched') {
     if (identity.returned_owner !== undefined && identity.returned_name !== undefined) {
       observed.push({owner: identity.returned_owner, name: identity.returned_name})
     }
   }
   ```

   A different owner is a transfer. A different name on a non-archived repo is a pending rename (`:850-855`):

   ```ts
   if (observed.some(seen => seen.owner.toLowerCase() !== row.owner.toLowerCase())) {
     detection.transfers.push({key, node_id: nodeId})
   } else if (!access.archived && observed.some(seen => seen.name !== row.name)) {
     detection.pending.push({key, node_id: nodeId})
   }
   ```

2. **Report, and keep the node out of every survey path.** The pending set and the blocked transfers form one exclusion set (`:505-506`), applied once after every dispatch path has pushed (`:582`, and the final filter at `:2162`). Each pending rename gets a `reconcile:rename-pending` issue that names the node by ID only (`renderRenamePendingIssue`, `:3767-3788`).
3. **Apply only by operator dispatch.** `.github/workflows/rename-tracked-repo.yaml` proves the rename again at write time. `proveIdentity` (`scripts/rename-tracked-repo.ts:320-331`) reads the repository by its database ID and requires the same node ID, the same owner and `private === false`. When the row already holds the new name, the operator must also pass `old_name`, and `proveResidueOldName` (`:347-371`) requires that name to redirect to the same node.
4. **Write one commit.** The row rename, the page move, the link repairs, the index and the log entry land in one non-force Git Data commit (`writeCommit`, `:704-746`). The caller rebuilds from the current head on a ref race and gives up after three attempts (`:612-621`):

   ```ts fragment
   let lastRace = 409
   for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
     try {
       return await attemptOnce(attempt)
     } catch (error: unknown) {
       if (!(error instanceof RefRaceError)) throw error
       lastRace = error.status
     }
   }
   ```

The evidence reads use the workflow's `GITHUB_TOKEN`. The job grants itself `contents: read` for checkout, and the write goes through a repository-scoped App token that only the rename step receives.

## Why This Works

- A node ID is stable across renames by design, so a match proves only that this is the same repository. The name is a separate claim and has to be compared against the stored row.
- Detect-and-report keeps unattended code away from deletions. The operator dispatch re-proves the rename from GitHub when it writes.
- Metadata and wiki never disagree, because the row and the page land in the same commit. A non-force `updateRef` turns a concurrent write into a rebuild instead of an overwrite.

The first live use of this path was the rename that motivated it: the workflow run triggered by `workflow_dispatch` on `main` printed `{"result":"renamed","page":"moved","attempts":1,...}`, and the resulting commit on `data` was authored by `fro-bot[bot]` as `chore(rename): marcusrbrown/panthe.ai -> marcusrbrown/panthea`.

## Prevention

- Use the node ID as the join key and treat the name as an observed claim. When a probe matches on identity, compare every returned descriptor field against the stored row, not only the ID.
- A `noop` has to check the content it claims was applied. Before reporting `noop`, require the page to carry the node ID, the new title and the new source URL (`pageReflectsRename`, `packages/wiki-write-core/src/repo-page-move.ts:219-230`). A page that has the node ID but its old frontmatter is a half-applied rename.
- For an operator writer that moves data:
  - prove the change from the source at dispatch time;
  - allowlist the paths it can write;
  - throw on a truncated tree;
  - allow deletions only under one directory.
- Retry only the ref race. A `createTree` 422 is terminal.
- Two further defects were found in this change during pre-merge review, both in the write-back matcher rather than the rename path. They are covered in [Enumerate every no-match path before narrowing a row matcher](../best-practices/enumerate-no-match-paths-before-narrowing-a-matcher-2026-10-10.md).

## Related Issues

- [Anchor Identity Guards on a Stable Scalar Fallback, Captured Defensively](../best-practices/identity-guard-stable-scalar-fallback-2026-06-22.md) is the closest sibling. It covers `node_id` format migration in the same identity-probe area, not redirects.
- [Shared invariants need one implementation and an explicit removal path](../best-practices/shared-invariants-need-one-implementation-2026-08-31.md): the change moved branch safety and page attribution into shared modules.
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md)
- [Autonomous pipeline silent failures](../runtime-errors/autonomous-pipeline-silent-failures-2026-04-19.md) covers a rename landing while a survey is in flight.
- PR #3977 (merge `8792b53`). The plan is `docs/plans/2026-10-09-004-fix-reconcile-redirect-rename-plan.md`.
