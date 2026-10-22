---
title: Autonomous rollout tracker workflows
module: gateway-rollout-tracker
date: 2026-06-17
last_updated: 2026-10-22
problem_type: workflow_issue
component: development_workflow
severity: medium
verified: true
applies_when:
  - a cross-repo rollout needs ongoing autonomous status tracking
  - a reusable agent workflow is called from a dedicated scheduled workflow
  - an operator comment must start a run that holds write credentials
  - tracker comments, the issue body and project fields are updated by the same agent workflow
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
  - issue-comment
---

# Autonomous rollout tracker workflows

## Context

The Gateway operator control-surface rollout spans `fro-bot/agent`, `fro-bot/dashboard`,
`marcusrbrown/infra`, and this control-plane repository. A static tracker issue is not enough: as
agent units land, deployments ship, and dashboard issues close, the issue body, the dependency
matrix and the `fro-bot` user-owned GitHub Project (project 1) need a routine updater.

Fro Bot owns three surfaces for the tracker `fro-bot/.github#3512`: the issue body, the comment
thread and the Project 1 fields. It writes them directly with `FRO_BOT_PAT`. There is no separate
state store or writer layer.

## Guidance

### Two entrances, one credentialed run

`gateway-rollout-tracker.yaml` is the only workflow that writes the tracker. It calls the reusable
Fro Bot workflow with one tracker prompt and has two entrances:

- the daily schedule and manual dispatch, which run a preflight and wake the agent only when the
  rollout moved;
- a `comment_id` dispatch from `rollout-tracker-mention.yaml`, which wakes the agent for an
  operator mention.

```yaml
concurrency:
  group: gateway-rollout-tracker
  cancel-in-progress: false

on:
  workflow_dispatch:
    inputs:
      comment_id:
        required: false
        default: ''
        type: string

jobs:
  update-rollout-tracker:
    needs: preflight
    if: >-
      needs.preflight.result == 'success' &&
      (inputs.comment_id != '' || needs.preflight.outputs.should_comment == 'true')
    uses: ./.github/workflows/fro-bot.yaml
```

Both entrances share the caller-level concurrency group, so only one run edits the body and the
Project at a time. The dispatch input is `comment_id`, never `prompt`: in a called workflow
`github.event` is the caller's, and `fro-bot.yaml` prefers `github.event.inputs.prompt` over its own
`inputs.prompt`.

### Why mentions need a hop

`fro-bot/agent` withholds the `gh` credential from the model on `issue_comment`, `issues` and
`pull_request` runs. A run started by a comment can read and reply in conversation but cannot edit
the body or the Project. `schedule` and `workflow_dispatch` runs receive the credential.

`rollout-tracker-mention.yaml` bridges the two. On `issue_comment` `created` it runs one job when
all of these hold:

- the issue number is 3512 and the comment is not on a pull request;
- the comment author is `marcusrbrown`;
- the body contains `@fro-bot`.

The job has workflow `permissions: {}`, job permission `actions: write` only, no checkout and a
single step. The step checks that the comment ID matches `^[0-9]+$`, then runs
`gh workflow run gateway-rollout-tracker.yaml --ref main -f comment_id=<id>` with `GH_TOKEN` set to
the job `GITHUB_TOKEN` and `GH_REPO` set to the repository. A `workflow_dispatch` created with
`GITHUB_TOKEN` starts a run, so no App token is minted. Only the numeric ID crosses the hop; the
tracker run reads the comments itself.

The content job of `fro-bot.yaml` excludes exactly these comments (issue 3512, not a pull request,
author `marcusrbrown`), so the operator gets one reply. Mentions from other trusted authors, and
`marcusrbrown` mentions on other issues, still go to the general reply job.

### The preflight and its wake inputs

The preflight runs `scripts/rollout-tracker-snapshot.ts`, which makes no model call. It hashes:

- each tracked Project item's identity and issue state;
- the latest `releases/latest` tag of `fro-bot/agent` and `fro-bot/dashboard`;
- the run ID and head SHA of the latest successful run of `deploy-gateway.yaml`,
  `deploy-dashboard.yaml` and `deploy.yaml` in `marcusrbrown/infra`;
- the `contractVersion` from `https://dashboard.fro.bot/operator/health`.

infra's own release tags are not an input: they do not identify what is deployed. A router run
that deploys nothing wakes the agent once, and that run posts nothing.

Project field values, labels and prose stay out of the hash. Every read fails closed: a failed or
empty fetch ends the preflight with a `FATAL` line on stderr, empty stdout and a non-zero exit. A
failed read never counts as "no change". The update job requires a successful preflight in both
modes, so every agent run has a valid hash and snapshot to write into its marker.

A pending operator mention is a separate wake condition, not a hash input. It is true when a
`marcusrbrown` comment containing `@fro-bot` is newer than the latest marker comment. `decideComment`
returns `should_comment` when the hash changed or a mention is pending. Answering the mention does
not change the next hash comparison. A mention that a dropped run, a failed hop or a failed
preflight leaves unanswered wakes the next daily run.

### The marker

Every tracker reply on #3512 ends with `<!-- gateway-rollout-tracker:{"hash":…,"snapshot":…} -->`,
built from the preflight outputs. The latest marker comment authored by `fro-bot` or `fro-bot[bot]`
is the only gate record; the script writes no state. The parser requires a string `hash` and an
object `snapshot`, so a marker written for an older snapshot shape still parses. Its hash differs
from the current one, so it wakes the tracker once.

### Catch-up

A run handles every operator `@fro-bot` comment newer than the latest marker comment, not only the
comment named by `comment_id`. GitHub keeps one running and one pending run per concurrency group,
so a newer queued run replaces an older pending one. Because each reply ends with a marker, the
anchor always advances and no mention is lost.

### The prompt

One prompt serves both modes. It tells the agent to verify claims against linked issue and pull
request state, releases, the infra deploy runs, the health contract and the acceptance-run results
the operator posts. It then rewrites every stale section of the body, updates Project 1 and adds
missing dependencies, and maintains the acceptance list. Each acceptance entry is labelled
operator-reported or agent-verified, and an unmet gate is never removed silently. In mention mode
the agent always replies; in scheduled mode it replies only when something changed.

### Daily-only work

Reusable calls keep the caller's `event_name`. Gate daily-only steps away from custom-prompt calls:

```yaml
if: >-
  (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') &&
  inputs.prompt == ''
```

## Why This Matters

Reusable workflow calls keep the caller's `github` context. A scheduled tracker workflow that calls
the generic Fro Bot workflow still looks like `github.event_name == 'schedule'` inside the reusable
workflow. Without the `inputs.prompt == ''` guard, daily-report discovery, digest counting and
gateway announcements can run from the tracker path.

Tracker updates are write operations against shared state: one issue body, one thread and one
GitHub Project. The shared concurrency group serializes them.

The hop is its own workflow because `fro-bot.yaml` runs under `contents: read` for its callers. A
job inside it that requests `actions: write` exceeds the caller's ceiling and fails at startup.

Explicit secret mapping keeps the caller aligned with least-privilege workflow conventions and avoids
spreading unrelated repository secrets into reusable workflow calls.

The snapshot script also runs in Status Truth as a best-effort step. When one of its reads fails
there, rollout claims stay unresolved and the job continues.

## When to Apply

Apply this pattern when a Fro Bot workflow tracks progress across multiple repositories and updates
issues and Projects, or when a trusted operator's comment must start a credentialed run.

Do not use the general daily oversight prompt as the tracker writer. It reports drift; the dedicated
workflow owns the body, comments and Project mutations so duplicate update paths do not fight each
other.

## Examples

Good split:

- daily oversight: notices tracker drift and reports it in the daily issue
- dedicated tracker: rewrites the body, updates Project fields and posts `@fro-bot` status comments
- mention workflow: dispatches the tracker with a numeric comment ID and writes nothing

Bad split:

- daily oversight and dedicated tracker both post routine tracker comments
- the general reply job and the tracker both answer the same operator mention
- a dispatch input named `prompt` on the tracker
- comment text interpolated into a `run:` block or a prompt
- tracker runs without a concurrency group
- daily-digest announce steps running during custom tracker prompts
- a failed fetch recorded as an empty value in the snapshot

## Related

- [Agent credential preflights are workflow contracts](agent-credential-preflights-are-workflow-contracts-2026-10-09.md) —
  `issue_comment` runs are credential-withheld; gate on the comment author with a closed set and
  test step shells through the helper.
- [Safe workflow consolidation: trace every invariant and caller](workflow-consolidation-invariant-trace-2026-06-24.md) —
  when collapsing two scheduled workflows into one, trace each safety invariant and remaining
  caller explicitly; the concurrency-group and dispatch-entry-point patterns here are the
  invariants that consolidation must preserve.
- [Safely deleting a superseded workflow or signal path](safe-superseded-workflow-removal-2026-06-24.md) —
  the inverse lesson: before retiring a duplicate execution path, confirm no remaining callers,
  full replacement coverage, shared dependencies preserved, and no dangling declarations.
