---
title: Check the first live event before trusting an event-driven workflow
date: 2026-11-11
last_updated: 2026-11-12
category: best-practices
module: github-workflows
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - a workflow orders or compares events by a field of a webhook payload
  - a hidden marker or stored format changes while older runs can still be re-run
  - automation gains write authority behind a repository variable
  - a gate decides from git output
  - a settings file declares labels
tags:
  - webhooks
  - branch-protection
  - dry-run
  - rollout
  - backward-compatibility
  - label-limits
  - git-paths
---

# Check the first live event before trusting an event-driven workflow

## Context

The promotion self-merge and the protection drift watcher passed their tests, their mutation gate and several reviews, and still failed three times on their first live events. The design of both is in [Native auto-merge refuses a clean PR, and protection edits persist](../workflow-issues/auto-merge-refuses-a-clean-pr-and-protection-edits-persist-2026-11-09.md). This document holds what only live runs and late reviews showed.

## Guidance

### Order events by a value you have seen change

`rule.updated_at` in a `branch_protection_rule` payload does not change when the rule is edited. Three edits on 2026-11-10 (19:13:42Z, :45Z and :49Z) all carried `2026-11-08T11:13:10Z`, so a rule of "close only on a strictly newer event" could never close issue #4172.

The watcher now uses the creation time of its own workflow run, which GitHub sets when it receives the event (`eventTimeOf` in `packages/registry/src/protection-drift.ts`). It reads the run with `GET /repos/{owner}/{repo}/actions/runs/{GITHUB_RUN_ID}`, and the job needs `actions: read`. A run that cannot be read leaves the event with no usable time, and a matching settings write with no usable time never closes a report.

Before a workflow orders, deduplicates or compares by a payload field, capture two real events and compare the field.

### A new format must be safe under the previous version's reader

A re-run of a workflow run uses the workflow and code of the commit that run was created on. When the drift marker changed from `updated_at=` to `event_at=`, the old reader found no marker on a new report and would have closed an active report on an obsolete match.

Every report therefore carries both markers. The old reader counts the empty one as newer than anything and closes nothing, and the new reader ignores it:

```html
<!-- protection-drift:updated_at= -->
<!-- protection-drift:event_at=2026-11-10T19:13:49Z -->
```

`protection-drift.test.ts` keeps a copy of the previous reader (`baseVersionMayClose`) and runs it against reports the current version writes. When a stored format changes, test the old reader against the new writer, as well as the new reader against old data.

### Fix the mode when the step starts

The self-merge step waits up to 60 minutes for checks. A step that starts as a dry run stays one, even when the switch is turned on during the wait. A fresh read of the switch can stop a live run and can never start one (`promotion-self-merge.ts`):

```ts
if (input.switchAtStart !== "on") return outcomeOf(state, "DRY_RUN")
```

### Roll out in dry run, read it back, then switch on once

1. Ship with the switch unset. The earlier steps still merge back and open the PR. The self-merge step waits for the checks, then stops before the approval and the merge.
2. Read back the first scheduled run. Run 42940189403 pinned `data`, passed both gates, opened #4175 and logged `promotion-self-merge: DRY_RUN`.
3. Set the variable, then dispatch one run. Run 42942262202 approved #4175 as `fro-bot` at the pinned commit and squash-merged it three seconds later.

Step 3 showed that GitHub counts the `fro-bot` user's approval as the required code-owner review. Nothing before it had tested that.

### Find other writers in the actors of past runs

`GET /repos/{owner}/{repo}/actions/runs?event=branch_protection_rule` lists the runs the event started, and each run's `actor` is the account that created, edited or deleted a rule. The event fires for every branch rule, so check which rule a run was about before naming an editor of `main`. The Scorecard workflow also runs on that event, so the history is older than the watcher. It showed two writes by `settings[bot]` (id 26100684) before each write by the declared settings automation, `fro-bot[bot]` (id 109017866), from 2026-11-09 on. The watcher matches the settings automation by actor type and numeric id.

### Smaller rules from the same work

- **Label descriptions stop at 100 characters.** A longer one makes `POST /repos/{owner}/{repo}/labels` answer 422 and fails every Update Repo Settings run (run 42847754180) until it is fixed. `scripts/settings-labels-effective-set.test.ts` holds every label in `common-settings.yaml` and `.github/settings.yml` to the limit.
- **Decode git output strictly.** The promotion gate drops a changed path whose tree entry already equals `main`, and a path absent on both sides counts as equal. Decoded with replacement characters, a path with an invalid byte becomes another string, is found on neither side, and leaves the allowlist check. `promotion-qualify-cli.ts` decodes with `new TextDecoder('utf-8', {fatal: true})`, disqualifies the promotion on a decoding error and runs git with `--literal-pathspecs`.
- **Search a run log for what a step printed, not for its script.** `gh run view --log` prints each step's `run:` script before its output. A search for an error message can match the `echo` line of a branch that never ran. In Survey Repo run 43023418386 the text "no transferable wiki delta" appears only as script source (`.github/workflows/survey-repo.yaml:532`); the step failed with `CONFLICT_EXHAUSTED`. Read `gh run view --log-failed`, or look for the thrown error code or a `::error::` line without the script's prefix.
- **A check run and a commit status with the same name must both pass.** When a required context has both, GitHub requires both, so a passing run must not hide a pending or failed status (`evaluateChecks` in `required-checks.ts`). When it has only one, that one decides.

## Why This Matters

The timestamp failed on the first live event and the label limit on the first push after merge, with every check green. The marker change would have failed on the first re-run of an older run. A watcher that cannot close its issue, or closes the wrong one, trains the operator to ignore it. A dry run that turns live merges a PR the operator did not ask it to merge.

## When to Apply

- Before merging a workflow that reacts to a webhook event: capture real payloads for every field it compares.
- When a marker, comment or artifact format changes and runs created before the change can be re-run.
- When automation gets a new write permission: ship it behind a switch that defaults to a dry run.
- When a gate reads paths from `git diff`, `git ls-tree` or `git status`.
- When `.github/settings.yml` or `common-settings.yaml` gains a label.

## Examples

Reading who edited branch rules from run history (the newest 50 runs; add `--paginate` for all of them):

```sh
gh api 'repos/fro-bot/.github/actions/runs?event=branch_protection_rule&per_page=50' \
  --jq '.workflow_runs[] | "\(.created_at) \(.name) \(.actor.login) \(.actor.id)"'
```
