---
date: 2026-10-20
topic: keep-data-branch-present
---

# Keep the `data` branch present through promotion

## Summary

Promotion no longer deletes `data`. A deletion-only ruleset with no bypass actors protects it. At the start of each merge-data run, the Fro Bot App writes a merge commit onto `data`. That commit takes data-owned paths from `data` and every other path from `main`, so the next promotion diff shows only new writes. The bootstrap stays as the path for first creation and recovery.

---

## Problem Frame

`data` serves live policy. The gateway's redaction denylist and the dashboard's monitoring snapshot read `metadata/repos.yaml` from it, as do most workflows in this repo.

Every `data` → `main` promotion squash-merges a PR whose head is `data`. Because `delete_branch_on_merge` is on, GitHub deletes `data` at the merge. Nothing recreates it until the next writer (Update Metadata, Reconcile Repos or wiki ingest) bootstraps it from `main`. Issue #4018 records two recent gaps: 53m21s after #3984 and 54m06s after #4007. During the 10-19 gap the gateway restarted and denied every repo for about 40 minutes. The restored `metadata/repos.yaml` was byte-identical to the one that was deleted. `wiki-lint` also fails closed while `data` is absent.

The delete-and-reseed cycle was deliberate. The 2026-09-26 ruleset plan left out a deletion rule because a kept `data` would still carry history that had already been squash-promoted, so the next promotion would replay it and conflict. A plain git merge of `main` back into `data` reproduces that conflict whenever a promoted line changes again on `data` before the merge. For example, a `repos.yaml` row goes from `pending` to `complete` (promoted), then to `stale`. Survey and reconcile rewrite exactly these rows.

---

## Requirements

**Branch persistence**

- R1. `data` survives every promotion merge. A ruleset that targets only `refs/heads/data`, has a `deletion` rule and no bypass actors, blocks its deletion for every actor. That includes automatic head-branch deletion, the Fro Bot App and admins in the UI.
- R2. The deletion ruleset is declared in `.github/settings.yml` beside the existing App-only write ruleset (update, non_fast_forward and creation, with the App as the only bypass actor). That ruleset stays as it is. The deletion rule lives in its own ruleset so that the App's bypass does not cover deletion.
- R3. `delete_branch_on_merge` stays on for the repository. Only `data` is exempt.

**Merge-back**

- R4. Each merge-data run first checks `data`. If `data` is missing, the run bootstraps it from `main`. Then, if `data` does not contain `main`'s tip, the App writes one commit to `data` whose parents are the current `data` tip and the `main` tip. All of this happens before the privacy gates and before the promotion compare.
- R5. The merge-back tree matches `data` exactly on data-owned paths and matches `main` exactly on every other path. "Exactly" covers absence too: a data-owned path missing on `data` is missing from the result, and so is any other path missing on `main`. Data-owned paths are the guarded paths of the wiki authority guard, and the merge-back and the guard share one definition of that set.
- R6. If `data` changed any path outside the data-owned set since its merge base with `main`, the merge-back writes nothing, fails the run and raises an operator alert through merge-data's existing deduplicated issue alerts.
- R7. The merge-back never force-updates `data`. If another writer advances `data` while the merge-back runs, it rebuilds from the fresh tip and re-applies the R6 check to it. It makes up to 3 attempts, the same bound `commitMetadata` and wiki ingest use. Once the attempts run out, it fails the run and leaves `data` unchanged.
- R8. When `data` already contains `main`'s tip, the merge-back writes nothing.
- R9. Commits written by the merge-back carry the Fro Bot App as author and committer, so they pass the reconcile integrity check on the `data` tip author.
- R10. Any merge-back failure ends the run before the promotion compare, PR creation, PR update or labelling.

**Promotion**

- R11. After the merge-back, the promotion diff contains only the data-owned changes written to `data` since the last promotion. When there are none, no promotion PR opens.
- R12. The 14-day stale-divergence alert keeps measuring how long `data` writes have waited for promotion, and merge-back commits do not reset that clock.

**Recovery and documentation**

- R13. The bootstrap remains the recovery path when `data` is missing. It is no longer part of the normal promotion cycle.
- R14. Settings comments, docs and tests that describe or enforce delete-and-reseed are updated to the persistent lifecycle. The settings test selects the App-only ruleset by name. It also asserts that the deletion ruleset has exactly the `deletion` rule and no bypass actors.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given the deletion ruleset is active, when the operator squash-merges a promotion PR, `data` still exists afterward at the same tip. A merged PR branch other than `data` is still deleted automatically.
- AE2. **Covers R4, R5, R11.** The last promotion changed a `repos.yaml` row to `complete`, and survey later set that row to `stale` on `data`. When merge-data runs, the merge-back commit lands without conflict, the row reads `stale`, and the promotion PR shows only that row change.
- AE3. **Covers R5, R11.** A rename deleted a repo page on `data` and added its new slug. After the merge-back, the old page is absent on `data`, and the promotion PR shows both the deletion and the addition.
- AE4. **Covers R6, R10.** A commit on `data` changed `metadata/README.md`, which is outside the data-owned set. When merge-data runs, `data` is unchanged, the promotion PR is neither created nor updated, the run fails, and an operator alert issue exists.
- AE5. **Covers R7.** A metadata write lands on `data` while the merge-back is building its commit. When the merge-back updates the ref, it rebuilds on the new tip, and the write is present in the result.
- AE6. **Covers R7.** An unowned write lands on `data` during the merge-back. When the merge-back rebuilds, it fails the run and leaves `data` unchanged.
- AE7. **Covers R8.** `data` already contains `main`'s tip. When merge-data runs twice, neither run writes to `data`.
- AE8. **Covers R4, R13.** `data` is missing because the ruleset was removed and the branch deleted. When merge-data runs, it bootstraps `data` from `main`, the merge-back writes nothing, and no promotion PR opens.

---

## Success Criteria

- After the first live promotion following rollout, `data` stays readable through the merge and nothing has to recreate it.
- The next promotion PR after that lists only files written to `data` since the previous promotion.
- A planner can implement the ownership rule, the failure behavior and the retry contract without inventing behavior.

---

## Scope Boundaries

- A gateway or dashboard fallback to `main` when `data` is missing. That work lives in other repositories.
- Turning off automatic branch deletion for the whole repository.
- Changing the allowed merge methods, or replacing `data` as the promotion PR head.
- Changing the reconcile integrity check from a tip-author check to a commit-range check.

---

## Key Decisions

- **Ownership merge over a git merge.** A three-way merge conflicts whenever a promoted line changes again on `data`. That is the replay conflict behind the 2026-09-26 choice. Taking each path from its single owner cannot conflict.
- **Merge-back at the start of merge-data, not right after a promotion.** This needs no new trigger, and it reuses merge-data's App token. Dispatch runs and manual or scheduled runs use separate concurrency groups, so two runs can overlap. R7's compare-and-set on the ref keeps `data` consistent when they do. Between a promotion and the next run, `data` and `main` have diverged ancestry, and only merge-data reads that ancestry.
- **Fail closed on unowned changes.** Silently taking `main`'s version would discard a `data` write. Failing surfaces the writer that broke the ownership rule.
- **A deletion ruleset with no bypass.** If the deletion rule sat in the App-only ruleset, the App's existing `always` bypass would cover deletion. As a result, deleting `data` on purpose requires the repository admin (the `fro-bot` account) to remove the deletion ruleset from `.github/settings.yml` first.
- **Tip-author integrity stays as is.** A merge-back commit always passes the tip-author check. Every ordinary App write on `data` already hides what lies beneath it, so this adds no new blind spot. The App-only update ruleset is the control that prevents non-App writes.

---

## Dependencies / Assumptions

- Verified: `main` changes guarded paths only through promotion. The authority guard (`scripts/check-wiki-authority.ts:36-44`) blocks a guarded-path change unless the author is Fro Bot and the head is the same-repo `data` branch.
- Verified: every current `data` writer stays inside the guarded set. That covers `commitMetadata`, wiki ingest and repair, and the rename writer. Status-truth branches from `main`, not `data`. R6 keeps this true as writers change.
- Verified: the reconcile integrity check reads only the `data` tip author (`scripts/reconcile-repos.ts:3174-3197`), and `fro-bot[bot]` is an expected author.
- Verified: the settings plugin removes any ruleset not declared in `.github/settings.yml` (`scripts/settings-data-ruleset.test.ts` header). That is why R2 declares the deletion ruleset there.
- Verified: GitHub documents that repository rules can prevent automatic head-branch deletion. The docs do not say whether a skipped deletion shows a message, or which actor performs the deletion.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] What readback proves, on the first live promotion, that the deletion rule blocked the automatic deletion?
- [Affects R4][Technical] Where does the merge-back sit relative to the `data` checkout that the privacy gates read, and does it live inside the promotion script or in its own step?
- [Affects R5, R11][Technical] Does the open-PR `updateBranch` path stay? It writes a server-side three-way merge onto `data`, outside the ownership rule.
- [Affects R11, R12][Technical] With history kept on `data`, the `ahead_by` and `total_commits` checks in the "no PR" gate can no longer fire. Which signal decides "no PR", and which commit date drives the stale-divergence alert?
- [Affects R4][Technical] When two runs overlap, can one leave a stale promotion PR body, and does the next run correct it?
- [Affects R5][Technical] How does the merge-back handle a truncated recursive tree read?

---

## Sources / Research

- Issue #4018 and Fro Bot's analysis comment on it.
- `docs/plans/2026-09-26-001-feat-data-branch-app-only-ruleset-plan.md`: the original reason for leaving out a deletion rule.
- `docs/solutions/integration-issues/bootstrap-data-branch-before-autonomous-writes-2026-05-09.md`: the bootstrap contract.
- `docs/brainstorms/2026-06-01-data-branch-sole-writer-requirements.md`: the sole-writer invariant.
- `.github/settings.yml:115-134`: the current ruleset and its lifecycle comment.
- `scripts/settings-data-ruleset.test.ts`: the plugin behavior and the test that forbids a deletion rule.
- `.github/workflows/merge-data.yaml:12-14` and `:51-55`: the concurrency groups and the `data` checkout.
- `scripts/merge-data-pr.ts:96-114`: the promotion compare and the "no PR" gate.
- `scripts/rename-tracked-repo.ts` and `packages/wiki-write-core/src/wiki-ingest.ts`: writers that delete guarded paths on `data`.
- GitHub docs, "Managing the automatic deletion of branches": repository rules can prevent automatic deletion.
