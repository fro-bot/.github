---
title: Safely deleting a superseded workflow or signal path
date: 2026-06-24
last_updated: 2026-06-24
problem_type: best_practice
category: workflow-issues
component: development_workflow
module: github-actions-workflows
severity: medium
verified: 2026-06-24
tags:
  - github-actions
  - workflow-removal
  - signal-path
  - shared-dependencies
  - duplicate-paths
applies_when:
  - removing a workflow file that has been superseded by a replacement
  - a duplicate execution path (e.g. an old webhook poster running in parallel with its gateway replacement) is being retired
  - a shared script or dependency is referenced by the workflow being removed and by other workflows
  - secrets or step outputs tied to the deleted path may leave dangling declarations
---

# Safely deleting a superseded workflow or signal path

## Context

Removing a duplicate or superseded execution path — for example, an old webhook poster still
running in parallel with its gateway replacement, double-posting every event — is a correctness
fix. But the removal is only safe when four conditions are confirmed. Skipping any one of them
turns a safe wiring change into a capability regression or a dangling dependency.

The most commonly missed check is the shared-dependency check: a script or helper referenced by
the workflow being removed may also be referenced by another workflow. Removing the workflow
without confirming this leaves the other workflow broken at runtime, not at merge time.

## Guidance

Removal is safe only when you confirm all four of the following.

### 1. No remaining callers

The removed workflow's only invoker was a job deleted in the same diff. Confirm with an explicit
grep before merging:

```bash
grep -r 'uses:.*<workflow-file>' .github/workflows/
grep -r '<script-name>' .github/workflows/
```

An empty result is the proof. A non-empty result means the interface or script must survive for
its remaining caller — either kept in place or extracted into a shared location.

### 2. The replacement fires on every condition the old path handled

The replacement must cover every trigger condition the old path handled, so each event posts
exactly once. Map the old path's triggers (`schedule`, `workflow_dispatch`, `push`, etc.) against
the replacement's triggers and confirm coverage. A trigger present in the old path but absent
from the replacement leaves a gap.

### 3. Shared dependencies survive for their other consumers

A script, action, or helper referenced by the removed workflow may also be referenced by another
workflow. Preserving a shared script that another workflow references is a wiring change, not a
capability deletion — the script stays, only the caller is removed.

This is the check most likely to be missed. The removed workflow's job list looks self-contained;
the shared dependency is invisible until the other workflow fails at runtime.

### 4. Secrets and outputs leave nothing dangling

A step-level secret or output whose only consumer was the deleted job should be cleaned up in
the same diff. Confirm that no orphaned secret declarations or output references remain in the
surviving workflow after the deletion.

### Separate correctness from tidiness

A benign leftover — for example, job-level outputs whose only consumer was the deleted job — is
later-pass cleanup, not a blocker. Do not hold the removal PR for cosmetic tidiness. Ship the
correctness fix; schedule the cleanup separately.

## Why This Matters

The "shared dependencies must survive for other consumers" check is easy to miss because the
removed workflow looks self-contained from the inside. The dependency is only visible from the
other workflow's perspective. A removal that passes this check is a safe wiring change; one that
misses it is a capability regression that surfaces at runtime with no obvious connection to the
removal.

The "replacement fires on every condition" check closes the double-posting problem without
creating a coverage gap. Without it, the removal trades a duplicate-post bug for a missed-post
bug.

## When to Apply

Apply this checklist when deleting any workflow file or retiring any duplicate signal or
execution path.

## Examples

### Four-point removal checklist

Before merging the removal PR, verify each item:

- [ ] **No remaining callers** — `grep -r 'uses:.*<removed-workflow>'` and
  `grep -r '<removed-script>'` both return zero results, or the interface/script is preserved
  for any remaining caller.
- [ ] **Replacement coverage** — every trigger condition in the removed workflow (`schedule`,
  `workflow_dispatch`, event filters) is present in the replacement.
- [ ] **Shared dependencies preserved** — any script, action, or helper referenced by the
  removed workflow and by another workflow is kept in place; only the caller is removed.
- [ ] **No dangling declarations** — step-level secrets and outputs whose only consumer was the
  deleted job are cleaned up in the same diff, or explicitly deferred as later-pass cleanup.

### Shared-dependency wiring change

```yaml
# owner/example-repo — .github/workflows/announce.yaml (surviving workflow)
# The old poster workflow also called scripts/post-event.ts.
# Removing the poster workflow does NOT remove scripts/post-event.ts —
# announce.yaml still calls it. Only the caller is removed.
- name: Post event to gateway
  run: node scripts/post-event.ts
  env:
    GATEWAY_SECRET: ${{ secrets.GATEWAY_SECRET }}
```

## See also

- [Autonomous rollout tracker workflows](autonomous-rollout-tracker-workflow-2026-06-17.md) —
  the inverse lesson: don't create duplicate update paths; a dedicated caller workflow owns
  mutations so two agents don't race on the same state.
- [Agent and automation steps need their GitHub token wired explicitly](required-github-token-for-agent-steps-2026-06-22.md) —
  a related case where a removal (of a token) silently broke a step; the same "confirm no
  remaining consumers" discipline applies.
- [Loose-then-tight schema migration pattern](../best-practices/loose-then-tight-schema-migration-pattern-2026-05-05.md) —
  removal-leads-replacement sequencing: confirm the replacement is live before retiring the
  old path.
- [Inventory-driven doc drift cleanup pattern](../documentation-gaps/doc-drift-cleanup-pattern-2026-04-18.md) —
  the file-level analog: retiring a superseded file requires the same "no remaining references"
  confirmation before deletion.
