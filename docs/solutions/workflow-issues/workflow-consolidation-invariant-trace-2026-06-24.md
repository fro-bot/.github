---
title: 'Safe workflow consolidation: trace every invariant and caller'
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
  - workflow-consolidation
  - concurrency
  - invariants
  - dispatch-ergonomics
  - safety
applies_when:
  - two scheduled workflows are being collapsed into one
  - a retired workflow provided a workflow_dispatch entry point or concurrency group
  - a shared workflow_call interface is consumed by another workflow
  - notification copy in the surviving workflow may no longer accurately describe its broadened scope
---

# Safe workflow consolidation: trace every invariant and caller

## Context

Collapsing two scheduled workflows into one — for example, merging a daily oversight pass and a
separate autoheal pass — is a surface-area reduction on paper. In practice, the retired workflow
carried safety and ergonomics that lived nowhere else. If those are not explicitly traced into the
surviving workflow, they vanish silently: no CI failure, no test red, no lint error.

The risk is asymmetric. A merge that looks clean can silently drop:

- **Dispatch ergonomics** — a `workflow_dispatch` manual entry point and its defaulted prompt
  that operators relied on for ad-hoc runs.
- **Notification accuracy** — copy that described the retired workflow's narrower scope now
  undersells the surviving workflow's broadened responsibility.
- **Concurrency isolation** — a dedicated `concurrency.group` in the retired workflow fenced its
  heal pass from interactive runs on the same branch. Without it, scheduled runs keyed on
  `github.run_id` no longer fence the heal pass from a concurrent manual dispatch.
- **Remaining callers of a shared interface** — a `workflow_call` interface must stay alive if
  another workflow still consumes it (e.g., an `apply-branding` workflow that calls the
  consolidated workflow). Retiring the interface breaks the caller silently.

None of these failures surface in CI. They surface in production, under operator load, or during
an incident when the manual dispatch entry point is gone.

## Guidance

When consolidating workflows, surface area should go **down**, and you prove safety survives by
**tracing** — not assuming.

### 1. Carry safety invariants verbatim, not by re-derivation

Each safety invariant in the retired workflow — serial mutations, trusted-author gate, scope cap,
never-touch-main, never-weaken-guards — must be carried into the surviving workflow verbatim.
Re-deriving them from memory introduces drift. Copy the exact condition, then annotate why it
exists.

### 2. Enumerate every remaining caller of any shared interface

Before retiring a `workflow_call` interface, grep for every caller across the repository:

```bash
grep -r 'uses:.*<workflow-file>' .github/workflows/
```

A caller that still references the interface will break silently at runtime, not at merge time.
If a caller exists, the interface must survive — either in the consolidated workflow or as a
thin shim that delegates to it.

### 3. Preserve the dispatch entry point and its defaulted prompt

A `workflow_dispatch` trigger with a defaulted prompt is an operator affordance. If the retired
workflow had one, the surviving workflow must carry it forward. Operators who relied on the
manual entry point for ad-hoc runs will find it gone with no error — just a missing option in
the Actions UI.

### 4. Update notification copy to reflect broadened scope

When a workflow absorbs a second workflow's responsibility, its notification copy (run name,
step summaries, issue comments) must be updated to describe the combined scope. Copy that
accurately described the retired workflow's narrower scope now undersells the surviving
workflow's responsibility and misleads operators reading the run log.

### 5. Preserve or re-establish the concurrency group

A dedicated `concurrency.group` in the retired workflow fenced its execution from concurrent
runs on the same branch. Without it, scheduled runs keyed on `github.run_id` are unique per
run — they do not fence the heal pass from a concurrent manual dispatch. If the retired
workflow had a named concurrency group, carry it forward explicitly:

```yaml
concurrency:
  group: <workflow-name>-${{ github.ref }}
  cancel-in-progress: false
```

## Why This Matters

A consolidation that drops dispatch ergonomics, notification accuracy, or concurrency isolation
produces a workflow that is harder to operate and easier to race — without any signal that
something was lost. The invariant-trace discipline makes the loss visible at review time, not
at incident time.

The "remaining callers" check is the easiest to miss: a `workflow_call` interface that looks
unused from inside the consolidated workflow may be the only entry point for a downstream
automation. An empty grep result is the proof; anything else is a blocker.

## When to Apply

Apply this checklist any time you merge or retire a scheduled workflow, or collapse two
automation passes into one.

## Examples

### Consolidation checklist

Before merging the retirement PR, verify each item:

- [ ] **Invariants verbatim** — each safety condition from the retired workflow is present in
  the surviving workflow, copied not re-derived.
- [ ] **Remaining callers** — `grep -r 'uses:.*<retired-workflow>'` returns zero results, or
  the interface is preserved for any caller that remains.
- [ ] **Dispatch entry point** — if the retired workflow had `workflow_dispatch`, the surviving
  workflow carries it forward with the same (or updated) defaulted prompt.
- [ ] **Notification copy** — run name, step summaries, and issue comments accurately describe
  the surviving workflow's combined scope.
- [ ] **Concurrency group** — if the retired workflow had a named `concurrency.group`, it is
  carried forward or a new one is established for the consolidated pass.

---

## Operational pitfall: the cheapest class of CI red

A formatter-only lint failure — for example, Prettier wanting single quotes where double quotes
were used — is the cheapest CI red. Run the formatter or `eslint --fix` locally before pushing
so a mechanical reflow does not burn a review round. This is a sibling lesson observed in the
same class of consolidation changes, not a co-equal concern.

## See also

- [Autonomous rollout tracker workflows](autonomous-rollout-tracker-workflow-2026-06-17.md) —
  the concurrency-group and dedicated-caller patterns that consolidation must preserve.
- [Agent and automation steps need their GitHub token wired explicitly](required-github-token-for-agent-steps-2026-06-22.md) —
  a related case where a well-intentioned security change silently broke a step; the same
  "trace the invariant" discipline applies.
- [A second credential gives rotation isolation, not permission isolation](../best-practices/credential-mint-time-permission-scoping-2026-06-22.md) —
  verify security invariants against live source rather than prose; the same discipline applied
  to consolidation safety.
