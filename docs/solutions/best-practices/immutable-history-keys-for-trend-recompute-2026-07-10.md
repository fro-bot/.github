---
title: Key trend recompute on immutable history (git add-date), never editable frontmatter
date: 2026-07-10
category: best-practices
module: improvement-metrics
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - a metric recomputes a trend or window-relative count from artifacts on every run
  - the event timestamp is currently read from an in-file annotation
  - the annotation is human-editable or non-universal across the corpus
  - a single edit rewriting past trend numbers would violate an immutability claim
tags:
  - trend-stability
  - git-add-date
  - immutable-history
  - recompute
  - frontmatter-hygiene
  - improvement-metrics
---

# Key trend recompute on immutable history (git add-date), never editable frontmatter

## Context

The improvement-metrics loop recomputes its trend every run from public artifacts and persists no snapshot. Discovery counts codified classes whose first appearance falls in a rolling 90-day window. The plan initially sourced that boundary from each solution doc's frontmatter `date`. Plan-review found two defects: frontmatter `date` is **mutable** — editing it silently moves a class between windows and rewrites every past discovery number derived from the metric — and **non-universal** — present on well under half the corpus. The "immutable trend, no store" design was only honest if the history it recomputes from is genuinely immutable, which an editable in-file field is not.

## Guidance

**A metric that recomputes a trend from history each run (instead of persisting snapshots) must key its event timestamps on genuinely immutable history — git commit dates, issue created-at — never on editable in-file annotations.**

Use the file's git first-commit (add) date:

```
git log --diff-filter=A --follow --format=%aI -- <path>
```

`--diff-filter=A` selects the add commit; `--follow` survives renames; the earliest entry is the codification event. Fail closed: if no add-date is resolvable for a path that exists on disk, treat git history as unavailable, emit an empty digest, and set a presence bit — never fall back to the editable field. The field carries an explicit contract in code (`SolutionDocRecord.gitAddDate`: "Immutable git first-commit (add) date … NEVER frontmatter `date`").

The recompute needs full history, so the CI job must set `fetch-depth: 0`. A default shallow clone silently turns the metric into "trend over the tip commit" — the explicit `fetch-depth: 0` is the canary that keeps the correctness claim true.

## Why This Matters

Frontmatter `date` is editable text. One correction to it rewrites past `discovery`/`priorDiscovery` numbers even though nothing happened in the world — the trend mutates under an unrelated edit. Git history is append-only; the window boundary becomes a property of the project, not of whichever contributor last touched the file. "No store, recompute from history" is a liability, not a virtue, if the history is mutable.

## When to Apply

- A metric recomputes a trend/aggregate from artifacts on every run rather than persisting snapshots.
- The event timestamp is sourced from a file, PR, or doc rather than an external event log.
- The same artifact type is authored and edited by many contributors over time.
- Correctness rests on "X happened in window W" being stable under later edits to X.
- A CI job runs the recompute — its checkout depth must be the full history the metric depends on.

## Examples

**Before:** discovery reads `doc.date`; a class sits in window W1. Months later a contributor corrects the frontmatter to the real date; the class moves to W0. Past `discovery=4, priorDiscovery=2` silently becomes `discovery=3, priorDiscovery=3`. The immutable-trend claim is false.

**After:** `gitAddDate` comes from `git log --diff-filter=A --follow --format=%aI`. The commit that added the file is the only authority; editing frontmatter cannot move the class. The workflow forces `fetch-depth: 0` so a shallow clone cannot truncate the history the metric reads.

## Related

- `docs/solutions/workflow-issues/classifying-github-review-events-for-iteration-signals-2026-06-22.md` — the closest match: don't classify a metric off your own mutable signal; ground it in real, immutable data
- `docs/solutions/best-practices/observability-before-structural-change-2026-06-09.md` — counts-only, derived at evaluation time, no persisted state
- `docs/solutions/best-practices/closed-vocabulary-telemetry-keys-from-public-bodies-2026-07-03.md` — marker-precedence-over-backfill for recovering historical state
- Source PR: #3672 (improvement-metrics loop)
