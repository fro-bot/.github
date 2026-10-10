---
title: Enumerate every no-match path before narrowing a row matcher
date: 2026-10-10
last_updated: 2026-10-10
verified: 2026-10-10
category: best-practices
module: scripts/repos-metadata.ts
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - a lookup drops a fallback key such as owner/name and keeps only node_id
  - a helper's no-match return was an implicit signal for redaction, re-keying, or dispatch
  - a caller adds an early return to skip a no-op write before the helper's transform runs
tags:
  - identity-matching
  - fallback-removal
  - no-match-path
  - privacy-downgrade
  - write-back
  - redaction
  - node-id
  - dispatch-suppression
---

# Enumerate every no-match path before narrowing a row matcher

## Context

PR #3977 narrowed the survey and invitation write-backs in `scripts/repos-metadata.ts` to match a row by `node_id` only, so a write-back can never rename a row. Before the PR, `findRepoEntryIndex` fell through `node_id`, then `database_id`, then owner/name. Removing the last two steps for write-back callers changed what each caller's no-match path did implicitly.

Two regressions in that change were found during pre-merge review, both on a no-match or name-conflict path:

1. **A recreated repo: same owner/name, new `node_id`.** `addRepoEntry` returned the file unchanged, as it should, but the invitation handler still dispatched a survey. The survey would have written the new repo's content into the old node's tracked page. The fix is a separate predicate, `findNameHeldByOtherNode`, which suppresses the dispatch and leaves the file unchanged.
2. **A private invitation for a node tracked publicly under another name.** The invitation mutator gained an early return for the name-conflict case, and that return skipped `addRepoEntry` before it could redact the row. The row stayed `private: false` and unredacted, which defeats the privacy downgrade. Fro Bot flagged this in its review of #3977, with a reproduction that used injected clients and no live writes. The fix limits the early return to non-private inputs.

Before #3977 the mutator was `mutator: current => addRepoEntry(current, entryInput)`, with no shortcut.

## Guidance

1. **Before narrowing a matcher, enumerate every caller's no-match path.** For each caller, record what the no-match branch did implicitly: redact, re-key, dispatch or survey. Include callers you are not changing, since they may still depend on the old chain.
2. **Keep the transform on the write path and gate only the outward effect.** A caller must not short-circuit the helper's transform to avoid a no-op write. The early return should suppress the survey dispatch, not the redaction.
3. **Make "name held by another identity" its own predicate**, separate from the node match, so a caller can suppress an effect without changing the write.
4. **Make asymmetries visible in code.** If one caller keeps the old fallback chain, say so in a comment and test it. `resetSurveyResult` (`scripts/repos-metadata.ts:555`) still calls `findRepoEntryIndex` without `identityOnly`, so it keeps the full chain. "Match by node ID only" is true for write-backs, not for the module.

## Why This Matters

Both regressions were silent. The happy-path tests passed, because redaction and dispatch suppression only run on the no-match and name-conflict paths. Redaction is a side effect of the match branch, so an early return that skips that branch skips redaction with it. Neither failure produces an error: one leaves a private repo's row public, the other surveys the wrong node.

## When to Apply

- Removing a fallback key (owner/name, `database_id`) from a lookup.
- A helper's no-match return (`-1`, `undefined`) doubles as a caller's signal to do something else.
- A caller adds an early return "to avoid a no-op write" before the helper's transform runs.
- Any write path that carries a privacy transform (redaction) or an identity transform (re-keying).

## Examples

The matcher tail before the change (`git show 8792b53^1:scripts/repos-metadata.ts`, lines 86-90):

```ts fragment
  if (identityMatches.length === 1) {
    return identityMatches[0] ?? -1
  }

  return repos.findIndex(entry => entry.owner === input.owner && entry.name === input.repo)
```

The identity-only gate after it (`scripts/repos-metadata.ts:108-112`):

```ts fragment
  if (options.identityOnly === true) {
    return -1
  }

  return repos.findIndex(entry => entry.owner === input.owner && entry.name === input.repo)
```

The separate predicate (`scripts/repos-metadata.ts:145-160`):

```ts
export function findNameHeldByOtherNode(repos: readonly RepoEntry[], input: RepoIdentityInput): boolean {
  if (input.private === true || input.node_id === undefined) {
    return false
  }
  if (findRepoEntryIndex(repos, input, {identityOnly: true}) !== -1) {
    return false
  }

  return repos.some(
    entry =>
      entry.owner !== REDACTED_OWNER &&
      entry.node_id !== undefined &&
      entry.owner === input.owner &&
      entry.name === input.repo,
  )
}
```

The invitation mutator (`scripts/handle-invitation.ts:264-271`). The early return applies only to non-private inputs, and the dispatch is gated on both flags:

```ts fragment
      mutator: current => {
        assertReposFile(current, 'repos')
        nameConflict = findNodeNameConflict(current.repos, entryInput)
        // The same hold-off for a recreated repository: a new node whose owner/name another node's row
        // still holds. `addRepoEntry` would leave the file alone, but a survey must not run either.
        nameHeldByOtherNode = !nameConflict && findNameHeldByOtherNode(current.repos, entryInput)
        return nameConflict && entryInput.private !== true ? current : addRepoEntry(current, entryInput)
      },
```

The line before the fix was `return nameConflict ? current : addRepoEntry(current, entryInput)`.

The regression tests in `scripts/handle-invitation.test.ts`:

- `redacts the row, stores no new name and dispatches no survey %s` (`:1393`), run on the first attempt and after a 409 retry. It asserts `owner: '[REDACTED]'` and that the new name appears nowhere in the persisted file or the warning.
- `never takes the held-by-another-node path: a private input is stored redacted under its node ID` (`:1412`).
- `leaves the file unchanged and dispatches no survey, so the old node's page is never written into` (`:1429`).
- `still adds and surveys the recreated node when its name is free` (`:1450`), the guard against over-blocking.

## Related

- [Make failure boundaries and shared predicates explicit](make-failure-boundaries-and-predicates-explicit-2026-08-25.md) covers the neighboring rule: one nullable result must not carry two meanings.
- [Normalize redacted metadata YAML quoting before data promotion](../integration-issues/normalize-redacted-yaml-quotes-2026-05-09.md): `normalizeRepoEntryForStorage` is the single write choke point for redaction.
- [Survey workflow-side privacy gate](../security-issues/survey-workflow-side-privacy-gate-2026-05-16.md)
- [Anchor Identity Guards on a Stable Scalar Fallback, Captured Defensively](identity-guard-stable-scalar-fallback-2026-06-22.md) is the contrast: that change adds a fallback, this one removes one.
- [An identity probe that follows redirects cannot detect a repo rename](../integration-issues/identity-probe-follows-redirects-hides-repo-renames-2026-10-10.md) is the change that motivated the narrowing.
- PR #3977 (merge `8792b53`).
