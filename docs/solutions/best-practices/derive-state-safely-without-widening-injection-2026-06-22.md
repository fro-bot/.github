---
title: Derive State from the System of Record Without Widening Shell Injection Surface
date: 2026-06-22
last_updated: 2026-06-22
problem_type: best_practice
category: best-practices
component: development_workflow
module: github-workflows
severity: high
verified: 2026-06-22
tags:
  - system-of-record
  - derived-state
  - injection-surface
  - argv-form
  - shell-safety
applies_when:
  - a previously hardcoded or static value is replaced with one derived from live data (e.g. a Project board query)
  - the derived value flows into a shell command or child process invocation
  - a filter or transform runs across multiple call paths and may emit duplicate output
  - switching from a static list to a derived set could silently drop entries
---

# Derive State from the System of Record Without Widening Shell Injection Surface

## Context

A rollout tracker script maintained a hardcoded list of repositories to operate on. When items
move through a workflow, that list drifts — someone has to edit the script on every transition.
The right fix is to derive the set from the live Project board: query the board, filter by
column/status, and operate on whatever is there. The static list becomes dead weight.

The PR that made this change earned praise for the derivation itself. The review also caught a
security regression it introduced: `repo` now flowed from Project board data into
`execSync(\`gh ... --repo ${repo} ...\`)`. A previously-trusted constant became a data-derived
value interpolated into a shell string — widening the injection surface to anything the Project
board could return.

The fix is argv form: `execFileSync('gh', ['...', '--repo', repo, '...'])`. No shell, no
interpolation, no injection surface. The test file already used this form; the implementation
just hadn't caught up.

Two secondary issues rounded out the review: the filter ran in multiple call paths and emitted
duplicate warnings on the env-injected path; and switching from a static list to a derived set
quietly dropped entries that weren't Project items — a behavior change worth auditing before
shipping.

Merged at `f6df711b11cc7360f90a1a698edebe97c2903e21`.

## Guidance

### 1. Prefer the system of record over hand-maintained state lists

When state changes as items move through a workflow, derive it from the authoritative source
(a Project board, a database, a config file) rather than encoding it in a script that must be
edited on every transition. The static list is a maintenance liability and a drift risk.

```ts
// Before: hardcoded, drifts on every transition
const ROLLOUT_REPOS = ['owner/repo-a', 'owner/repo-b']

// After: derived from the live Project board
const rolloutRepos = await queryProjectBoard(projectId, {status: 'In Progress'})
```

### 2. Switch to argv form when a derived value feeds a shell call

When a previously-trusted constant becomes data-derived, re-evaluate every place it is
interpolated into a shell. Template-string interpolation into `execSync` is an injection surface
regardless of where the value came from. Switch to `execFileSync` with an explicit argv array:

```ts
// Wrong: data-derived value interpolated into a shell string
execSync(`gh issue edit --repo ${repo} --add-label rollout`)

// Right: argv form — no shell, no interpolation
execFileSync('gh', ['issue', 'edit', '--repo', repo, '--add-label', 'rollout'])
```

This is not a theoretical concern. Project board data is user-controlled. A repo name with
shell metacharacters (`$(...)`, backticks, semicolons) would execute in the shell context.

### 3. Avoid re-running filters across call paths

If a filter or transform (e.g. "exclude archived repos") runs in multiple call paths, it will
emit duplicate warnings or side effects on paths that hit it more than once. Derive from the
already-filtered set once, at the top of the call graph, and pass the result down:

```ts
// Derive and filter once
const activeRepos = rolloutRepos.filter(r => !r.isArchived)

// Pass activeRepos to all downstream call paths — don't re-filter inside each
```

### 4. Audit the derived set against the static list before shipping

Switching from a static list to a derived set can silently drop entries that aren't represented
in the source of record. Before shipping, diff the two sets and confirm nothing downstream
depends on the dropped entries:

```ts
const staticSet = new Set(ROLLOUT_REPOS)
const derivedSet = new Set(rolloutRepos.map(r => r.nameWithOwner))
const dropped = [...staticSet].filter(r => !derivedSet.has(r))
if (dropped.length > 0) console.warn('Entries in static list not in derived set:', dropped)
```

## Related

- [GitHub Actions step output interpolation](../workflow-issues/github-actions-step-output-interpolation-2026-04-21.md) — the same injection-surface concern in workflow YAML: untrusted values interpolated into `run:` steps.
- [Autonomous rollout tracker workflow](../workflow-issues/autonomous-rollout-tracker-workflow-2026-06-17.md) — the workflow this derivation pattern was applied to.
- [Observability before structural change](../best-practices/observability-before-structural-change-2026-06-09.md) — audit behavior before refactoring; the same discipline applies to verifying the derived set covers the static list's entries.
