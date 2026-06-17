---
title: Autonomous rollout tracker workflows
module: gateway-rollout-tracker
date: 2026-06-17
last_updated: 2026-06-17
problem_type: workflow_issue
component: development_workflow
severity: medium
verified: true
applies_when:
  - a cross-repo rollout needs ongoing autonomous status tracking
  - a reusable agent workflow is called from a dedicated scheduled workflow
  - tracker comments and project fields can be updated by the same agent workflow
related_components:
  - fro-bot-workflow
  - github-projects
  - daily-digest
tags:
  - github-actions
  - fro-bot
  - rollout-tracking
  - projects
  - reusable-workflows
---

# Autonomous rollout tracker workflows

## Context

The Gateway operator control-surface rollout spans `fro-bot/agent`, `fro-bot/dashboard`,
`marcusrbrown/infra`, and this control-plane repository. A static tracker issue is not enough: as
agent units land, deployment topology changes, and dashboard issues close, the matrix needs a
routine updater that can post status and keep the `fro-bot` user-owned GitHub Project fields
current.

The first implementation added a dedicated scheduled workflow that calls the reusable Fro Bot
workflow with a focused tracker prompt. Review found two important hazards before the PR was ready:
reusable calls could accidentally run daily-digest side effects, and overlapping tracker runs could
race on comments and Project state.

## Guidance

Use a dedicated caller workflow for autonomous tracker updates, and keep the general daily prompt
awareness-only:

```yaml
concurrency:
  group: gateway-rollout-tracker
  cancel-in-progress: false

jobs:
  update-rollout-tracker:
    uses: ./.github/workflows/fro-bot.yaml
    with:
      prompt: >-
        Update the rollout tracker and linked GitHub Project only when tracked
        state changed since the latest @fro-bot tracker status comment.
    secrets:
      FRO_BOT_PAT: ${{ secrets.FRO_BOT_PAT }}
      OPENCODE_AUTH_JSON: ${{ secrets.OPENCODE_AUTH_JSON }}
      OMO_PROVIDERS: ${{ secrets.OMO_PROVIDERS }}
      OPENCODE_CONFIG: ${{ secrets.OPENCODE_CONFIG }}
```

When the reusable workflow also supports daily reports or digest announcements, gate those
daily-only steps away from custom-prompt reusable calls:

```yaml
if: >-
  (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') &&
  inputs.prompt == ''
```

The dedicated tracker prompt should be explicit about idempotency:

- use the tracker issue as the routine status log
- compare against the latest `@fro-bot` tracker comment before posting
- update Project fields when readiness evidence changes
- comment on tracked issues only for issue-specific transitions that were not already acknowledged
- link transition comments back to the tracker issue

## Why This Matters

Reusable workflow calls keep the caller's `github` context. A scheduled tracker workflow that calls
the generic Fro Bot workflow still looks like `github.event_name == 'schedule'` inside the reusable
workflow. Without an extra `inputs.prompt == ''` guard, daily-report discovery, digest counting, and
gateway announcements can run from the tracker path.

Tracker updates are also write operations against shared state: one issue thread and one GitHub
Project. Without a caller-level concurrency group, a manual dispatch can overlap the scheduled run
and both agents can decide the same state transition needs a comment.

Explicit secret mapping keeps the caller aligned with least-privilege workflow conventions and avoids
spreading unrelated repository secrets into reusable workflow calls.

## When to Apply

Apply this pattern when a Fro Bot scheduled workflow is responsible for tracking progress across
multiple repositories, especially when it updates both GitHub issues and Projects.

Do not use the general daily oversight prompt as the primary tracker writer. It can report drift, but
the dedicated workflow should own comments and Project mutations so duplicate update paths do not
fight each other.

## Examples

Good split:

- daily oversight: notices tracker drift and reports it in the daily issue
- dedicated tracker: updates Project fields and posts `@fro-bot` status comments when state changed

Bad split:

- daily oversight and dedicated tracker both post routine tracker comments
- reusable tracker calls inherit every repository secret
- tracker runs have no concurrency group
- daily-digest announce steps run during custom tracker prompts
