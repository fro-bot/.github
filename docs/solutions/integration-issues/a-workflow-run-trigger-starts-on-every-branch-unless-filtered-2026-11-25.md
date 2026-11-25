---
title: A workflow_run trigger starts on every branch unless it is filtered
date: 2026-11-25
category: integration-issues
module: github-workflows
problem_type: integration_issue
component: development_workflow
severity: medium
symptoms:
  - "Renovate Approve started 875 times from workflow_run in 7 days and approved 11 PRs; 176 starts were cancelled while pending"
  - "Sweeps started on main pushes, data promotions, other PRs and drafted-solution branches"
  - "A listed trigger workflow, Check Private Leak, could never start a useful sweep"
root_cause: config_error
resolution_type: config_change
tags:
  - workflow-run
  - branches-filter
  - head-branch
  - trigger-scoping
  - renovate-approve
---

# A workflow_run trigger starts on every branch unless it is filtered

## Problem

A `workflow_run` trigger with no `branches:` filter starts on every completion of every listed workflow, on any branch. Filter it on the branch of the triggering run, and list only workflows whose runs can carry that branch.

A sweep is one run of `.github/workflows/renovate-approve.yaml`: it lists the open Renovate pull requests and approves at most one that is ready. It started when Main, CodeQL, Dependency Review, Renovate or Check Private Leak completed on any branch, so it ran for every `main` push, every promotion of the `data` branch (where the bot stores its automated changes) and every other pull request. In the 7 days to 2026-11-23 it started 875 times from `workflow_run`, 176 of those starts were cancelled while pending, and 11 pull requests were approved ([#4317](https://github.com/fro-bot/.github/pull/4317)).

## Symptoms

- Many runs cancelled by the workflow's own concurrency group, which keeps one running and one pending sweep.
- The header comment said `Check Private Leak` "posts the last required status", so it had to be listed. On the Renovate PRs measured it was never the last check.

## What Didn't Work

- **Triggering on the Renovate workflow alone.** On 7 of the 10 Renovate pull requests measured, Renovate's own check did not finish last. A Renovate-only trigger would leave those approvals to the 30-minute backstop schedule, which GitHub starts late and often skips.
- **Keeping `Check Private Leak` behind the filter.** Its runs are themselves started by `workflow_run`, and such a run's head branch is the default branch. A `renovate/**` filter can never match it.

## Solution

`.github/workflows/renovate-approve.yaml`:

```yaml
on:
  workflow_run:
    workflows: [Main, CodeQL, Dependency Review, Renovate]
    branches: ['renovate/**']
    types: [completed]
```

Over the measured week the filter would have removed 551 of the 875 starts and kept the start behind every approval. The first Renovate pull request after the merge, [#4315](https://github.com/fro-bot/.github/pull/4315), was approved 22 seconds after its last required check.

## Why This Works

GitHub applies `workflow_run.branches` to the head branch of the run that completed. Every measured approval was started by a run on a `renovate/` branch, and the schedule still covers a missed event.

## Prevention

- Give every `workflow_run` trigger a `branches:` filter, or a written reason why every branch matters.
- Before listing a workflow as a trigger, check the `head_branch` its runs carry. A workflow that is itself started by `workflow_run` runs on the default branch.
- Pin the trigger list and the filter in a workflow test. `scripts/renovate-approve-workflow.test.ts` pins both.
- Count starts against useful outcomes, by triggering workflow and branch, before trusting a header comment about why a trigger is there.

## Related

- [Check the first live event before trusting a workflow](../best-practices/check-the-first-live-event-before-trusting-a-workflow-2026-11-11.md)
- [A yield-to-people rule must exempt your own service account](../best-practices/a-yield-to-people-rule-must-exempt-your-own-service-account-2026-11-25.md)
